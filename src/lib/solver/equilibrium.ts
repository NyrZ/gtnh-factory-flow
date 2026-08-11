import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { isRecipeInputConsumed, makeResourceKey, resourceMatchesInput } from "../model/resources";
import { getStorageRoles, isDrainRole } from "../model/storage-role";
import { collectTrashNodeIds } from "../model/trash";
import type {
  FactoryProject,
  FactoryStorage,
  NodeThroughputResult,
  ResourceAmount,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "../model/types";

const EPSILON = 0.000001;

/**
 * Equilibrium solver for the wired factory graph.
 *
 * The old iteration seeded every node from a demand-only guess and let asks
 * chase each other around the graph. That system has many self-consistent
 * answers: "F asks for no apples because it has no bananas, B makes no
 * bananas because F is not asking" is as stable as the fully running plan,
 * and real boards kept landing on the starved one (community gridlock
 * report, 2026-08-02: 26.67/s of toluene in the tank, consumers granted
 * 1.8/s of it, everything downstream at 0.5%).
 *
 * This solver removes the low answers instead of damping toward them, the
 * same way Helmod's matrix solver (MIT, github.com/Helfima/helmod) treats a
 * production block: solve the coupled system simultaneously rather than
 * propagate asks sequentially. Our unknowns differ - machine counts are
 * fixed here, so we solve for per-node utilizations - which turns the
 * problem into a monotone fixed point:
 *
 * - every node starts at FULL BLAST (capability 1, demand 1); the board is
 *   born jump-started, so a feedback loop that can sustain itself never
 *   needs a phantom source to prove it;
 * - each Jacobi round recomputes offers, honest asks, and allocations from
 *   the previous round's vectors only (no mid-pass reads, so wiring order
 *   cannot change the answer), and utilizations descend until the real
 *   constraints - machine counts, genuinely scarce inputs - stop them;
 * - lossy loops decay geometrically, so a per-component geometric
 *   extrapolation jumps them straight to their limit instead of grinding
 *   thousands of passes.
 *
 * Scarce supply is split by water-filling (progressive filling): every
 * hungry line gets an equal share, lines that need less than their share
 * are capped at their ask, and the slack is re-offered to the still-hungry.
 * A 2000/s fleet next to a 400/s fleet on a 26/s tank therefore cannot
 * crush the small asker out of the trickle it needs.
 *
 * CONSERVATION. The plan is a CLOSED system. Nothing appears from nowhere and
 * nothing vanishes, and the only places that rule is suspended are the two a
 * player declares by hand:
 *
 *   a SOURCE drawer  nothing feeds it, so it invents its resource
 *   a DRAIN drawer   nothing draws from it, so it swallows what arrives
 *
 * plus the trash can, which is a drain you can see destroying things. A
 * BUFFER is neither: it passes on exactly what its consumers pull.
 *
 * So a machine is bounded at BOTH ends. `capableByNode` asks whether every
 * ingredient has somewhere to come from, `disposalByNode` whether everything
 * it makes has somewhere to go, and it runs at the lesser. A port with no
 * wire on it is not an escape hatch in either direction: an input with no
 * feeder is an empty bus and an output with no taker is a full one, and both
 * stop the machine dead. A node standing on the disposal limit is CLOGGED.
 *
 * This is a real cost and it is the point. Every plan now has to say where
 * its raw materials come from and where its product goes, in drawers, on the
 * board - and until it does, it reads zero rather than quietly inventing the
 * answer at both ends.
 */

export interface EdgeAllocationResult {
  role: "machine" | "storage-source" | "storage-sink" | "trash";
  resourceKey: ResourceKey;
  targetDemandKey: ResourceKey;
  needKey: string;
  /** Nameplate output rate of the feeding machine (Infinity for storages). */
  sourceCapacityPerSecond: number;
  /** What the line could carry if the consumer wanted it (capability fill). */
  availablePerSecond: number;
  /** What the line actually carries (desire fill / sink absorption). */
  transferredPerSecond: number;
  /** Carried plus this line's share of the consumer's unmet desire. */
  demandPerSecond: number;
}

export interface EquilibriumSolution {
  capableByNode: Map<string, number>;
  /** Demand-side pressure, unclamped: >1 means "wants more than the fleet". */
  demandByNode: Map<string, number>;
  /**
   * How hard each node could run before a wired output it cannot get rid of
   * backs up on it. 1 when nothing binds; absent when the node has no bounded
   * output at all. See the conservation note at the top of this file.
   */
  disposalByNode: Map<string, number>;
  /** The output resource whose surplus sets `disposalByNode`, when one does. */
  clogOutputByNode: Map<string, ResourceKey>;
  edgeAllocations: Map<string, EdgeAllocationResult>;
  eatenByNeed: Map<string, number>;
  unmetDesireByNeed: Map<string, number>;
  needEdgeCounts: Map<string, number>;
  rounds: number;
}

interface PreparedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  role: "machine" | "storage-source" | "storage-sink" | "trash";
  resourceKey: ResourceKey;
  targetDemandKey: ResourceKey;
  /** `${target}|${targetDemandKey}` for machine targets, "" for sinks/trash. */
  needKey: string;
  /** `${source}|${outputKey}` for machine sources, "" for storage sources. */
  budgetKey: string;
  /** The drawer this line touches (its node id) for storage roles, else "". */
  poolKey: string;
  /**
   * This line can swallow anything the producer sends: a trash can, or a
   * drain drawer nothing draws from. A buffer sink is deliberately NOT free -
   * it relays its consumers' pull and stops there.
   */
  freeDisposal: boolean;
  /**
   * Absorbs but never asks: a BYPRODUCT drawer. Its demand is reported as
   * zero, so the pace comes from whoever genuinely wants the output.
   */
  silent: boolean;
  /**
   * An OVERFLOW buffer sink: a buffer that catches what its takers leave
   * instead of clogging its feeder, filling at a visible rate. It relays only
   * its takers' pull as demand (it never drives production), and it can never
   * run net-negative: its outflow is still bounded by what really arrived.
   * A buffer set to `strict` opts back into the pass-through-only rule.
   */
  overflow: boolean;
  sourceCapacityPerSecond: number;
}

interface Budget {
  ownerId: string;
  outputKey: ResourceKey;
  makePerSecond: number;
  sinkEdges: PreparedEdge[];
  /** The subset of `sinkEdges` that feed a DRAIN: those absorb without limit. */
  drainEdges: PreparedEdge[];
  /** Every edge drawing on this budget (machine consumers and tank sinks). */
  edges: PreparedEdge[];
  /**
   * Trash cans on this output. They live outside `edges` because they never
   * ask - they drink the leftovers - while their mere presence pins the
   * budget fully demanded (a voided output can never pace its machine down).
   */
  trashEdges: PreparedEdge[];
  /**
   * Somewhere on this output there is a can or a drain, so the surplus always
   * has a home and this output can never clog its machine.
   */
  freeDisposal: boolean;
}

interface Need {
  targetId: string;
  demandKey: ResourceKey;
  nameplatePerSecond: number;
  machineEdges: PreparedEdge[];
  storageEdges: PreparedEdge[];
  edgeCount: number;
}

interface Pool {
  sinkEdges: PreparedEdge[];
  /** Sinks into a BUFFER: bounded by what the pool's consumers pull. */
  bufferSinkEdges: PreparedEdge[];
  sourceEdges: PreparedEdge[];
  /** Trash cans draining this tank: they take what real consumers leave. */
  trashEdges: PreparedEdge[];
}

/** Half a percent: below this, two utilizations are the same number. */
const CLOG_EPSILON = 0.005;

interface MachineNodeInfo {
  id: string;
  /** Consumed inputs that have at least one incoming wire. */
  wiredInputs: Array<{ needKey: string; nameplatePerSecond: number }>;
  /** Consumed inputs with NO incoming wire: nothing declares where they come
   * from, so the machine cannot run. */
  bareInputKeys: ResourceKey[];
  /** Outputs with NO outgoing wire: nothing carries them away, so they back
   * up and the machine cannot run. */
  bareOutputKeys: ResourceKey[];
  hasOutputs: boolean;
  hasOutgoingWires: boolean;
  budgets: Budget[];
  targetFloors: Array<{ key: ResourceKey; amountPerSecond: number }>;
}

const ROUND_CAP = 512;
const CONVERGENCE_EPS = 1e-9;
const ZERO_SNAP = 1e-7;
const MACHINE_FILL_ROUNDS = 32;
const STORAGE_FILL_ROUNDS = 8;

export function solveEquilibrium(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  storagesById: Map<string, FactoryStorage>,
): EquilibriumSolution {
  // ---- Preparation: resolve every edge once. --------------------------------
  const edges: PreparedEdge[] = [];
  const budgets = new Map<string, Budget>();
  const needs = new Map<string, Need>();
  const pools = new Map<string, Pool>();
  const trashNodeIds = collectTrashNodeIds(project);
  const storageRoles = getStorageRoles(project);

  for (const edge of project.edges) {
    const sourceStorage = storagesById.get(edge.source);
    const targetStorage = storagesById.get(edge.target);
    if (sourceStorage && targetStorage) {
      continue;
    }

    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    const targetDemandKey = getEdgeTargetDemandKey(project, edge) ?? key;
    const sourceResult = sourceStorage ? undefined : nodes[edge.source];
    const sourceOutputFlow = getCompatibleOutputFlow(sourceResult, edge);
    const role: PreparedEdge["role"] = trashNodeIds.has(edge.target)
      ? "trash"
      : targetStorage
        ? "storage-sink"
        : sourceStorage
          ? "storage-source"
          : "machine";
    // A pool is ONE DRAWER, not one item.
    //
    // This used to key on the resource, which quietly rebuilt the drawer
    // network the conservation rework exists to remove: every drawer holding
    // carbon dust anywhere on the board was one tank, so a product drawer
    // parked beside an unrelated chain gave a source drawer on the titanium
    // line `sinkEdges`, dropped its offer from infinite to that OTHER chain's
    // output, and starved a line it shares no wire with. Material teleported
    // between drawers nobody had connected.
    //
    // Keyed by node, every drawer is its own container and the roles fall out
    // of its own wires: nothing feeds a SOURCE, so it has no sinks and offers
    // without limit; a BUFFER's outflow is bounded by its own inflow, which is
    // exactly "you can never take out more than you put in". Two drawers of
    // the same item are two containers, whatever their roles - to move goods
    // between them you wire them together, like everything else on the board.
    const poolKey = targetStorage?.id ?? sourceStorage?.id ?? "";
    // A buffer catches overflow unless the player set it strict. This is what
    // makes "machine into tank into machine" behave like the in-game build:
    // the tank soaks up a surplus (visibly, at a net fill rate) instead of
    // backing it up into the feeder as a clog.
    const isOverflowBufferSink =
      role === "storage-sink" &&
      storageRoles.get(edge.target) === "buffer" &&
      targetStorage?.bufferMode !== "strict";
    const prepared: PreparedEdge = {
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      role,
      resourceKey: key,
      targetDemandKey,
      needKey: targetStorage || role === "trash" ? "" : `${edge.target}|${targetDemandKey}`,
      budgetKey: sourceStorage ? "" : `${edge.source}|${sourceOutputFlow?.key ?? key}`,
      poolKey,
      // A can always. A drawer only when nothing draws from it, which is what
      // makes it the plan's declared export rather than an ordinary buffer.
      // BOTH kinds of drain accept without limit; they differ only in whether
      // they ask (see `silent` below). An overflow buffer accepts freely too,
      // but unlike a drain the material stays in the plan's books: it piles up
      // in the tank at a rate the card shows.
      freeDisposal:
        role === "trash" ||
        isOverflowBufferSink ||
        (role === "storage-sink" && isDrainRole(storageRoles.get(edge.target) ?? "idle")),
      // A BYPRODUCT drawer takes what is left and asks for nothing, so it must
      // not report what it absorbed as demand: doing so would pace its feeder
      // to full blast purely by existing, which is what a PRODUCT drawer is
      // for. This is the one flag that separates the two.
      silent: role === "storage-sink" && storageRoles.get(edge.target) === "byproduct",
      overflow: isOverflowBufferSink,
      sourceCapacityPerSecond:
        sourceStorage || !sourceResult
          ? Number.POSITIVE_INFINITY
          : (sourceOutputFlow?.amountPerSecond ?? 0),
    };
    edges.push(prepared);

    if (prepared.budgetKey && sourceResult) {
      const existing = budgets.get(prepared.budgetKey);
      const budget = existing ?? {
        ownerId: edge.source,
        outputKey: sourceOutputFlow?.key ?? key,
        makePerSecond: sourceOutputFlow?.amountPerSecond ?? 0,
        sinkEdges: [],
        drainEdges: [],
        edges: [],
        trashEdges: [],
        freeDisposal: false,
      };
      if (!existing) {
        budgets.set(prepared.budgetKey, budget);
      }
      if (role === "trash") {
        budget.trashEdges.push(prepared);
      } else {
        budget.edges.push(prepared);
        if (role === "storage-sink") {
          budget.sinkEdges.push(prepared);
          if (prepared.freeDisposal) {
            budget.drainEdges.push(prepared);
          }
        }
      }
      budget.freeDisposal = budget.freeDisposal || prepared.freeDisposal;
    }

    if (prepared.needKey) {
      const targetResult = nodes[edge.target];
      const existing = needs.get(prepared.needKey);
      const need = existing ?? {
        targetId: edge.target,
        demandKey: targetDemandKey,
        nameplatePerSecond: targetResult?.inputs[targetDemandKey]?.amountPerSecond ?? 0,
        machineEdges: [],
        storageEdges: [],
        edgeCount: 0,
      };
      if (!existing) {
        needs.set(prepared.needKey, need);
      }
      need.edgeCount += 1;
      if (role === "storage-source") {
        need.storageEdges.push(prepared);
      } else {
        need.machineEdges.push(prepared);
      }
    }

    if (poolKey) {
      const existing = pools.get(poolKey);
      const pool = existing ?? {
        sinkEdges: [],
        bufferSinkEdges: [],
        sourceEdges: [],
        trashEdges: [],
      };
      if (!existing) {
        pools.set(poolKey, pool);
      }
      if (role === "storage-sink") {
        pool.sinkEdges.push(prepared);
        if (!prepared.freeDisposal) {
          pool.bufferSinkEdges.push(prepared);
        }
      } else if (role === "trash") {
        pool.trashEdges.push(prepared);
      } else {
        pool.sourceEdges.push(prepared);
      }
    }
  }

  const machineNodes: MachineNodeInfo[] = [];
  const infoById = new Map<string, MachineNodeInfo>();
  const budgetsByOwner = new Map<string, Budget[]>();
  for (const budget of budgets.values()) {
    budgetsByOwner.set(budget.ownerId, [...(budgetsByOwner.get(budget.ownerId) ?? []), budget]);
  }
  const targetShares = calculateProjectTargetShares(project, nodes);

  for (const node of project.nodes) {
    const nodeResult = nodes[node.id];
    if (!nodeResult || !nodeResult.enabled || nodeResult.status === "missing-recipe") {
      continue;
    }

    const wiredInputs: MachineNodeInfo["wiredInputs"] = [];
    const bareInputKeys: ResourceKey[] = [];
    for (const [inputKey, flow] of Object.entries(nodeResult.inputs)) {
      if (flow.amountPerSecond <= EPSILON) {
        continue;
      }
      const needKey = `${node.id}|${inputKey}`;
      if (needs.has(needKey)) {
        wiredInputs.push({ needKey, nameplatePerSecond: flow.amountPerSecond });
      } else {
        // Nothing feeds this ingredient. In a closed plan that is not a
        // standing assumption that you carry it in by hand, it is a machine
        // with an empty input bus: it does not run until something declares
        // where the ingredient comes from.
        bareInputKeys.push(inputKey as ResourceKey);
      }
    }

    const targetFloors: MachineNodeInfo["targetFloors"] = [];
    if (node.targetOutput) {
      targetFloors.push({
        key: makeResourceKey(node.targetOutput.kind, node.targetOutput.resourceId),
        amountPerSecond: node.targetOutput.amountPerSecond,
      });
    }
    const projectShare = targetShares.get(node.id);
    if (projectShare) {
      targetFloors.push(projectShare);
    }

    // Outputs with no wire on them. Same rule as a bare input, the other way
    // round: a full output bus with nothing carrying it away stops the machine.
    const bareOutputKeys: ResourceKey[] = [];
    for (const [outputKey, flow] of Object.entries(nodeResult.outputs)) {
      if (flow.amountPerSecond <= EPSILON) {
        continue;
      }
      if (!budgets.has(`${node.id}|${outputKey}`)) {
        bareOutputKeys.push(outputKey as ResourceKey);
      }
    }

    const info: MachineNodeInfo = {
      id: node.id,
      wiredInputs,
      bareInputKeys,
      bareOutputKeys,
      hasOutputs: Object.keys(nodeResult.outputs).length > 0,
      hasOutgoingWires: (budgetsByOwner.get(node.id) ?? []).length > 0,
      budgets: budgetsByOwner.get(node.id) ?? [],
      targetFloors,
    };
    machineNodes.push(info);
    infoById.set(node.id, info);
  }

  // Structural and fixed for the whole solve: these machines have a slot with
  // no wire on it, so they ship nothing no matter what anybody downstream
  // wants. See the offer split in runRound.
  const stoppedByBareSlot = new Set(
    machineNodes.filter((info) => info.bareOutputKeys.length > 0).map((info) => info.id),
  );

  // ---- Iteration state: everything starts at full blast. -------------------
  const cap = new Map<string, number>();
  const dem = new Map<string, number>();
  const disp = new Map<string, number>();
  for (const info of machineNodes) {
    cap.set(info.id, 1);
    dem.set(info.id, 1);
    disp.set(info.id, 1);
  }
  // The priority tranche starts empty: round one splits fairly, and from the
  // second round on each output's must-ship rate is served first (see the
  // priority map in runRound).
  let unconditionalByBudget = new Map<string, number>();
  // A tank's sustainable outflow is last round's inflow; before the first
  // round assume every feeder ships nameplate (full blast, like the rest).
  let poolInflow = new Map<string, number>();
  for (const [poolKey, pool] of pools) {
    let inflow = 0;
    for (const sinkEdge of pool.sinkEdges) {
      inflow += budgets.get(sinkEdge.budgetKey)?.makePerSecond ?? 0;
    }
    poolInflow.set(poolKey, inflow);
  }

  interface RoundOutput {
    capNext: Map<string, number>;
    demNext: Map<string, number>;
    disposalNext: Map<string, number>;
    clogOutputNext: Map<string, ResourceKey>;
    /** Per budget: the rate its owner runs at regardless of this output's
     * takers - the priority tranche of the next round's fills. */
    unconditionalNext: Map<string, number>;
    poolInflowNext: Map<string, number>;
    availableByEdge: Map<string, number>;
    eatenByEdge: Map<string, number>;
    demandByEdge: Map<string, number>;
    unmetDesireByNeed: Map<string, number>;
  }

  const runRound = (): RoundOutput => {
    // TWO offers, because the two fills ask different questions.
    //
    // `budgetOffer` is capability: what this producer could ship if everything
    // upstream ran flat out. A clog is deliberately absent from it. Capability
    // answers "are my inputs short", the clog is the player's own wiring, and
    // one wire clears it - so a consumer downstream of a clogged machine must
    // not read as INPUT-starved, and a ring idling for want of a customer must
    // keep the capability that proves it is not a dead loop.
    //
    // `budgetOfferActual` is what really moves this round. A machine sitting
    // at 50% because its other output has nowhere to go cannot hand anybody
    // its full-blast rate; without this the desire fill would mint the very
    // resource conservation is here to protect.
    const budgetOffer = new Map<string, number>();
    const budgetOfferActual = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      const capable = clampUtilization(cap.get(budget.ownerId) ?? 1);
      const disposal = disp.get(budget.ownerId) ?? 1;
      // STOPPED is not THROTTLED, and the difference is STRUCTURAL, not a
      // matter of the number reaching zero.
      //
      // A machine with a slot nobody has wired can never ship anything, so it
      // advertises nothing. Without this a consumer downstream computed a
      // utilization out of material that never arrives - a card reading 12.5%
      // on a line carrying 0/s, fed by a machine sitting at 0% because one of
      // its OWN slots is bare.
      //
      // A machine whose disposal merely converged to zero is a different
      // animal and keeps advertising its capability: that is a ring idling for
      // want of a customer, and collapsing its capability would resurrect the
      // gridlock lie this solver exists to kill (it would read as a dead loop).
      // Hence the test is `bareOutputKeys`, never `disposal <= 0`.
      budgetOffer.set(
        budgetKey,
        stoppedByBareSlot.has(budget.ownerId) ? 0 : budget.makePerSecond * capable,
      );
      // The actual offer is floored at the budget's own must-ship rate. The
      // disposal throttle exists so a machine choked by ANOTHER output cannot
      // hand out material it will not make - but a budget's own clog must not
      // cap its own offer, or the fill can never drain the clog it is being
      // asked to relieve: the throttled offer keeps the demand low, the low
      // demand keeps the clog, and a loop that one more grant would clear
      // settles half-dead instead. The must-ship rate already respects the
      // machine's inputs and its OTHER outputs' throttles, so nothing here
      // offers material that would not exist.
      budgetOfferActual.set(
        budgetKey,
        stoppedByBareSlot.has(budget.ownerId)
          ? 0
          : Math.max(
              budget.makePerSecond * clampUtilization(Math.min(capable, disposal)),
              Math.min(
                unconditionalByBudget.get(budgetKey) ?? 0,
                budget.makePerSecond * capable,
              ),
            ),
      );
    }
    // TWO offers again, for the same reason the budgets have two.
    //
    // `poolOffer` is what a tank can really hand out this round: last round's
    // inflow, which is the rule that stops a buffer inventing material.
    //
    // `poolOfferCapable` is what its feeders COULD put in if everything ran
    // flat out. Capability has to be demand-blind or a buffer launders a
    // downstream choke into an upstream shortage: a consumer thottled to 91%
    // by its own clogged output pulls 91% of the nitrogen, so 91% is all that
    // ever entered the tank, so the tank offers 91%, so the consumer reads as
    // STARVED of nitrogen - by a producer sitting at 4% with plenty to spare.
    // Wire the same producer straight in and it reads correctly, because a
    // machine budget already answers this question with `budgetOffer`. A tank
    // in the middle must not change the diagnosis.
    const poolOffer = new Map<string, number>();
    const poolOfferCapable = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length === 0) {
        // Nothing feeds it: a SOURCE drawer, infinite by construction.
        poolOffer.set(poolKey, Number.POSITIVE_INFINITY);
        poolOfferCapable.set(poolKey, Number.POSITIVE_INFINITY);
        continue;
      }
      poolOffer.set(poolKey, poolInflow.get(poolKey) ?? 0);
      let capable = 0;
      for (const sink of pool.sinkEdges) {
        capable += budgetOffer.get(sink.budgetKey) ?? 0;
      }
      poolOfferCapable.set(poolKey, capable);
    }

    // Potentials: what each input could draw if everything else wanted it -
    // sibling ceilings judge by capability, never by the current starved
    // state, or the gridlock lie re-enters through the side door.
    const potentialByNeed = new Map<string, number>();
    for (const [needKey, need] of needs) {
      let potential = 0;
      for (const edge of need.machineEdges) {
        potential += budgetOffer.get(edge.budgetKey) ?? 0;
      }
      for (const edge of need.storageEdges) {
        potential += poolOfferCapable.get(edge.poolKey) ?? 0;
      }
      potentialByNeed.set(needKey, potential);
    }

    const sibCeil = (info: MachineNodeInfo, exceptNeedKey: string): number => {
      let ceil = 1;
      for (const input of info.wiredInputs) {
        if (input.needKey === exceptNeedKey) {
          continue;
        }
        const potential = potentialByNeed.get(input.needKey);
        if (potential === undefined || !Number.isFinite(potential)) {
          continue;
        }
        ceil = Math.min(ceil, clampUtilization(potential / input.nameplatePerSecond));
      }
      return ceil;
    };

    const askAvailability = new Map<string, number>();
    const askDesire = new Map<string, number>();
    for (const [needKey, need] of needs) {
      const info = infoById.get(need.targetId);
      if (!info || need.nameplatePerSecond <= EPSILON) {
        askAvailability.set(needKey, 0);
        askDesire.set(needKey, 0);
        continue;
      }
      const ceiling = sibCeil(info, needKey);
      askAvailability.set(needKey, need.nameplatePerSecond * ceiling);
      askDesire.set(
        needKey,
        need.nameplatePerSecond * Math.min(clampUtilization(dem.get(need.targetId) ?? 1), ceiling),
      );
    }

    const availabilityFill = runFill(
      needs,
      budgetOffer,
      poolOfferCapable,
      askAvailability,
      unconditionalByBudget,
    );
    const desireFill = runFill(
      needs,
      budgetOfferActual,
      poolOffer,
      askDesire,
      unconditionalByBudget,
    );

    // Sinks absorb whatever production the desire fill left unclaimed, so a
    // buffered producer keeps running at capability. A tank running dry on
    // its consumers additionally passes the shortfall back as demand.
    const availableByEdge = availabilityFill.grants;
    const eatenByEdge = desireFill.grants;
    const demandByEdge = new Map<string, number>();
    const poolInflowNext = new Map<string, number>();
    const poolDeficit = new Map<string, number>();
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length === 0) {
        continue;
      }
      const requested = desireFill.poolRequested.get(poolKey) ?? 0;
      const offered = poolOffer.get(poolKey) ?? 0;
      poolDeficit.set(poolKey, Math.max(0, requested - offered));
    }

    // A BUFFER takes exactly what its own consumers pull, never the whole
    // leftover: it is a pass-through, not a hole in the plan's books. What it
    // declines stays on the producer's budget, where either a drain/can takes
    // it or it clogs the machine. Buffers are served first because a drain is
    // the last resort by definition.
    const bufferAbsorbByEdge = new Map<string, number>();
    const freeLeftoverByBudget = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      // What the owner actually RUNS at, not what it could offer. A sink can
      // never absorb more than the machine makes, and the offer above is
      // deliberately demand-blind - so without this a BYPRODUCT drawer would
      // bank the full nameplate off a machine idling at a fifth of it, which
      // is exactly the conservation break the drawer exists to prevent.
      const runs = clampUtilization(
        Math.min(
          cap.get(budget.ownerId) ?? 1,
          disp.get(budget.ownerId) ?? 1,
          clampUtilization(dem.get(budget.ownerId) ?? 1),
        ),
      );
      const offered = budgetOfferActual.get(budgetKey) ?? 0;
      const takenByMachines = Math.max(
        0,
        offered - (desireFill.remainingBudget.get(budgetKey) ?? 0),
      );
      let leftover = Math.max(0, budget.makePerSecond * runs - takenByMachines);
      const bufferSinks = budget.sinkEdges.filter((sink) => !sink.freeDisposal);
      if (bufferSinks.length > 0) {
        const evenShare = leftover / bufferSinks.length;
        for (const sink of bufferSinks) {
          const pool = pools.get(sink.poolKey);
          const pull =
            (desireFill.poolRequested.get(sink.poolKey) ?? 0) /
            Math.max(1, pool?.bufferSinkEdges.length ?? 1);
          const take = Math.max(0, Math.min(evenShare, pull));
          bufferAbsorbByEdge.set(sink.id, take);
          leftover -= take;
        }
      }
      freeLeftoverByBudget.set(budgetKey, Math.max(0, leftover));
    }

    /**
     * How much of the surplus a drain that ASKS is asking on behalf of.
     *
     * The leftover splits evenly across every drain on an output, which is
     * what each one physically catches. Demand cannot be read off that share
     * directly once some of the drains are silent: a product drawer beside a
     * byproduct drawer would ask for half the output, the machine would drop
     * to half, that halves the leftover, and the whole thing spirals to zero -
     * a machine wired to a drawer that wants everything it makes sitting at 0%.
     *
     * So the askers claim the silent ones' shares as well. One product drawer
     * next to one byproduct drawer asks for the lot, the machine runs flat out,
     * and the two still catch half each. With no silent drains this is 1 and
     * nothing changes.
     */
    const drainClaimByBudget = new Map<string, number>();
    for (const [budgetKey, budget] of budgets) {
      const drains = budget.drainEdges.length + budget.trashEdges.length;
      let asking = budget.trashEdges.length;
      for (const drain of budget.drainEdges) {
        // An overflow buffer catches a share of the leftovers like any drain,
        // but it never asks on its own behalf - its demand is its takers'
        // pull, computed below - so it counts as a catcher here, not an asker.
        if (!drain.silent && !drain.overflow) {
          asking += 1;
        }
      }
      drainClaimByBudget.set(budgetKey, asking > 0 ? drains / asking : 1);
    }

    for (const edge of edges) {
      // Drains and trash cans on a machine output drink whatever is left after
      // the buffers, splitting it evenly; the difference is that a drain
      // relays its tank's unmet pull as demand while trash never begs - its
      // demand IS what it carries, so nothing upstream reads hunger off it.
      if (edge.role === "storage-sink" || (edge.role === "trash" && edge.budgetKey)) {
        const budget = budgets.get(edge.budgetKey);
        const absorbed = edge.freeDisposal
          ? (freeLeftoverByBudget.get(edge.budgetKey) ?? 0) /
            Math.max(1, (budget?.drainEdges.length ?? 0) + (budget?.trashEdges.length ?? 0))
          : (bufferAbsorbByEdge.get(edge.id) ?? 0);
        availableByEdge.set(edge.id, absorbed);
        eatenByEdge.set(edge.id, absorbed);
        if (edge.role === "trash") {
          demandByEdge.set(edge.id, absorbed);
          continue;
        }
        const pool = pools.get(edge.poolKey);
        const deficitShare =
          (poolDeficit.get(edge.poolKey) ?? 0) / Math.max(1, pool?.sinkEdges.length ?? 1);
        // A PRODUCT drawer's absorption IS its demand: it asks its feeder for
        // everything the machine can make, which is what pins a terminal
        // machine at full blast and is exactly what you want from the thing
        // the factory is for.
        //
        // A BYPRODUCT drawer asks for nothing. It still eats the surplus
        // (`eatenByEdge` above, so conservation holds and nothing clogs), it
        // simply never begs, which leaves the pace to real consumers and to
        // the plan's target rate.
        //
        // An OVERFLOW buffer asks for what its takers pull, and not one item
        // more. It still catches the whole surplus (so the feeder never clogs
        // on it), but reporting the catch as demand would drive the feeder to
        // produce FOR the tank, and a buffer that manufactures demand is a
        // product drawer wearing the wrong badge.
        const overflowPull =
          (desireFill.poolRequested.get(edge.poolKey) ?? 0) /
          Math.max(1, pool?.sinkEdges.length ?? 1);
        demandByEdge.set(
          edge.id,
          edge.silent
            ? 0
            : edge.overflow
              ? Math.min(absorbed, overflowPull) + deficitShare
              : absorbed *
                  (edge.freeDisposal ? (drainClaimByBudget.get(edge.budgetKey) ?? 1) : 1) +
                deficitShare,
        );
        poolInflowNext.set(edge.poolKey, (poolInflowNext.get(edge.poolKey) ?? 0) + absorbed);
        continue;
      }

      if (edge.role === "trash") {
        // Tank -> trash: drain what the tank's real consumers left. An unfed
        // (infinite) tank has no surplus to void, so the can sips nothing.
        const pool = pools.get(edge.poolKey);
        const remaining = desireFill.remainingPool.get(edge.poolKey) ?? 0;
        const drained = Number.isFinite(remaining)
          ? Math.max(0, remaining) / Math.max(1, pool?.trashEdges.length ?? 1)
          : 0;
        availableByEdge.set(edge.id, drained);
        eatenByEdge.set(edge.id, drained);
        demandByEdge.set(edge.id, drained);
        continue;
      }

      const eaten = eatenByEdge.get(edge.id) ?? 0;
      const need = needs.get(edge.needKey);
      const unmet = Math.max(0, desireFill.remainingNeed.get(edge.needKey) ?? 0);
      demandByEdge.set(edge.id, eaten + unmet / Math.max(1, need?.edgeCount ?? 1));
    }
    for (const [poolKey, pool] of pools) {
      if (pool.sinkEdges.length > 0 && !poolInflowNext.has(poolKey)) {
        poolInflowNext.set(poolKey, 0);
      }
    }

    // New capability: what could this node run at if wanted, given what its
    // wired inputs can actually deliver. New demand: what its consumers pull
    // (plus tank absorption), over its nameplate output.
    const capNext = new Map<string, number>();
    const demNext = new Map<string, number>();
    const disposalNext = new Map<string, number>();
    const clogOutputNext = new Map<string, ResourceKey>();
    const unconditionalNext = new Map<string, number>();
    for (const info of machineNodes) {
      // A closed plan has to say where every ingredient comes from. An input
      // with no wire is an empty bus, not a standing delivery.
      let capability = info.bareInputKeys.length > 0 ? 0 : 1;
      for (const input of info.wiredInputs) {
        const need = needs.get(input.needKey);
        if (!need) {
          continue;
        }
        let supplied = 0;
        for (const edge of [...need.machineEdges, ...need.storageEdges]) {
          supplied += availableByEdge.get(edge.id) ?? 0;
        }
        capability = Math.min(capability, clampUtilization(supplied / input.nameplatePerSecond));
      }
      capNext.set(info.id, capability);

      if (!info.hasOutputs) {
        // Pure sink: nothing downstream can pace it; it always wants full
        // blast and only its input supply throttles it.
        demNext.set(info.id, 1);
        continue;
      }
      // One walk over the budgets collects everything the three verdicts and
      // the priority map below read: what each output is asked for, and
      // whether a can or an asking drain pins it fully demanded.
      const nodeResult = nodes[info.id];
      const budgetStats = info.budgets.map((budget) => {
        let demandSum = 0;
        for (const edge of budget.edges) {
          demandSum += demandByEdge.get(edge.id) ?? 0;
        }
        let required = demandSum;
        for (const floor of info.targetFloors) {
          if (floor.key === budget.outputKey) {
            required = Math.max(required, floor.amountPerSecond);
          }
        }
        // A voided output is a fully demanded output: the can drinks whatever
        // arrives, so this budget can never pace the machine below full blast
        // (the in-game void-pipe semantic, the jump-start trick built in).
        //
        // A DRAIN deliberately does not do this. The two are different asks: a
        // can says "run flat out and destroy the rest", a drain says only
        // "a surplus here is allowed". Pinning drains too would drive every
        // machine feeding a dead-end drawer to full blast for no reason but
        // the drawer's existence. Overflow buffers are absent from the pin for
        // the same reason: catching a surplus is not wanting one, and a tank
        // must never be the reason a machine runs flat out.
        const pinned =
          budget.trashEdges.length > 0 ||
          budget.drainEdges.some((e) => !e.silent && !e.overflow);
        return { budget, demandSum, required, pinned };
      });
      // Target floors on outputs no wire carries still ask the machine to run.
      let floorPressure = 0;
      for (const floor of info.targetFloors) {
        if (info.budgets.some((budget) => budget.outputKey === floor.key)) {
          continue;
        }
        const flow = nodeResult ? getCompatibleOutputFlowForKey(nodeResult, floor.key) : undefined;
        if (flow && flow.amountPerSecond > EPSILON) {
          floorPressure = Math.max(floorPressure, floor.amountPerSecond / flow.amountPerSecond);
        }
      }

      let pressure = floorPressure;
      for (const stat of budgetStats) {
        if (stat.pinned) {
          pressure = Math.max(pressure, 1);
        }
        if (stat.budget.makePerSecond > EPSILON) {
          pressure = Math.max(pressure, stat.required / stat.budget.makePerSecond);
        } else if (stat.required > EPSILON) {
          pressure = Number.POSITIVE_INFINITY;
        }
      }

      // CONSERVATION. Demand says how fast this node is WANTED; disposal says
      // how fast it CAN go before a wired output it cannot shift backs up on
      // it. A budget with a drain or a can on it can always shift everything.
      // Any other one moves only what its consumers pull, and the tightest of
      // those is the ceiling. Target floors are asks, not outlets, so they are
      // deliberately absent here: dialling a rate does not create somewhere to
      // put the result.
      let disposal = Number.POSITIVE_INFINITY;
      let clogKey: ResourceKey | undefined;
      for (const stat of budgetStats) {
        if (stat.budget.freeDisposal || stat.budget.makePerSecond <= EPSILON) {
          continue;
        }
        const ceiling = stat.demandSum / stat.budget.makePerSecond;
        if (ceiling < disposal) {
          disposal = ceiling;
          clogKey = stat.budget.outputKey;
        }
      }

      // THE PRIORITY MAP. For each output, the rate the machine would run at
      // even if this output's takers pulled nothing: what the REST of the node
      // wants of it (its other outputs' demand and pins, the plan's dialled
      // floors), bounded by what its inputs allow. Whatever this output makes
      // at that rate exists whether or not anybody drinks it - so next round's
      // fills serve it FIRST, before any feeder that is free to idle. This is
      // what lets a byproduct return-feed be drained ahead of an honest supply
      // line instead of clogging its machine while the supply line hogs the
      // ask (the NyrZ collapse), without touching the fairness rule between
      // competing consumers.
      for (const stat of budgetStats) {
        let pressureExcl = floorPressure;
        let dispExcl = Number.POSITIVE_INFINITY;
        for (const other of budgetStats) {
          if (other === stat) {
            continue;
          }
          if (other.pinned) {
            pressureExcl = Math.max(pressureExcl, 1);
          }
          if (other.budget.makePerSecond > EPSILON) {
            pressureExcl = Math.max(pressureExcl, other.required / other.budget.makePerSecond);
          } else if (other.required > EPSILON) {
            pressureExcl = Number.POSITIVE_INFINITY;
          }
          if (!other.budget.freeDisposal && other.budget.makePerSecond > EPSILON) {
            dispExcl = Math.min(dispExcl, other.demandSum / other.budget.makePerSecond);
          }
        }
        unconditionalNext.set(
          `${info.id}|${stat.budget.outputKey}`,
          stat.budget.makePerSecond *
            clampUtilization(Math.min(capability, pressureExcl, dispExcl)),
        );
      }
      // A wired output moving exactly what is asked of it is DEMAND, not a
      // clog: the takers simply want no more. Only an output held below what
      // something is still asking for has anything stuck in it.
      if (clogKey !== undefined && !(disposal < pressure - CLOG_EPSILON)) {
        clogKey = undefined;
      }
      // A bare output is a hard zero, but it is never NAMED as the clog: a
      // slot with no wire on it is reported as UNWIRED, which says the same
      // thing in a word the reader can act on without any arithmetic.
      if (info.bareOutputKeys.length > 0) {
        disposal = 0;
        clogKey = undefined;
      }
      disposalNext.set(info.id, disposal);
      if (clogKey !== undefined) {
        clogOutputNext.set(info.id, clogKey);
      }
      demNext.set(info.id, Math.min(pressure, disposal));
    }

    return {
      capNext,
      demNext,
      disposalNext,
      clogOutputNext,
      unconditionalNext,
      poolInflowNext,
      availableByEdge,
      eatenByEdge,
      demandByEdge,
      unmetDesireByNeed: desireFill.remainingNeed,
    };
  };

  // ---- Descend to the fixed point. ------------------------------------------
  let lastRound: RoundOutput | undefined;
  let rounds = 0;
  const prevDelta = new Map<string, number>();
  let roundsSinceJump = 0;

  for (let round = 0; round < ROUND_CAP; round += 1) {
    const output = runRound();
    rounds = round + 1;
    roundsSinceJump += 1;

    let maxDelta = 0;
    const currentDelta = new Map<string, number>();
    for (const info of machineNodes) {
      const capDelta = (cap.get(info.id) ?? 1) - (output.capNext.get(info.id) ?? 1);
      const demDelta =
        clampUtilization(dem.get(info.id) ?? 1) -
        clampUtilization(output.demNext.get(info.id) ?? 1);
      currentDelta.set(`c|${info.id}`, capDelta);
      currentDelta.set(`d|${info.id}`, demDelta);
      // Disposal counts toward CONVERGENCE but is deliberately kept out of
      // `currentDelta`: the geometric jump below routes every entry into
      // either `cap` or `dem` by key prefix, and it is re-derived from the
      // edge demands each round anyway, so extrapolating it would only let it
      // disagree with the numbers it came from.
      const dispDelta =
        clampUtilization(disp.get(info.id) ?? 1) -
        clampUtilization(output.disposalNext.get(info.id) ?? 1);
      maxDelta = Math.max(maxDelta, Math.abs(capDelta), Math.abs(demDelta), Math.abs(dispDelta));
    }

    for (const info of machineNodes) {
      cap.set(info.id, output.capNext.get(info.id) ?? 1);
      dem.set(info.id, output.demNext.get(info.id) ?? 1);
      disp.set(info.id, output.disposalNext.get(info.id) ?? 1);
    }
    poolInflow = output.poolInflowNext;
    unconditionalByBudget = output.unconditionalNext;
    lastRound = output;

    if (maxDelta < CONVERGENCE_EPS) {
      break;
    }

    // Late-phase safety valve for the rare oscillating board: average with
    // the previous vector so the hard cap cannot freeze a mid-swing state.
    if (round >= ROUND_CAP - 128) {
      for (const info of machineNodes) {
        const key = info.id;
        const capPrev = (output.capNext.get(key) ?? 1) + (currentDelta.get(`c|${key}`) ?? 0);
        const demPrev =
          clampUtilization(output.demNext.get(key) ?? 1) + (currentDelta.get(`d|${key}`) ?? 0);
        cap.set(key, ((output.capNext.get(key) ?? 1) + capPrev) / 2);
        if (Number.isFinite(output.demNext.get(key) ?? 1)) {
          dem.set(key, ((output.demNext.get(key) ?? 1) + demPrev) / 2);
        }
      }
    }

    // Geometric extrapolation: a lossy loop shrinks by a stable factor every
    // round; once two consecutive deltas agree on that factor, jump each
    // component the rest of the way (sum of the geometric series) instead of
    // decaying for thousands of rounds.
    if (round >= 8 && roundsSinceJump >= 4) {
      let jumped = false;
      for (const [key, delta] of currentDelta) {
        const previous = prevDelta.get(key) ?? 0;
        if (Math.abs(delta) <= 1e-12 || Math.abs(previous) <= 1e-12) {
          continue;
        }
        if (Math.sign(delta) !== Math.sign(previous)) {
          continue;
        }
        const ratio = delta / previous;
        if (ratio < 0.2 || ratio > 0.9995) {
          continue;
        }
        const isCap = key.startsWith("c|");
        const nodeId = key.slice(2);
        const vector = isCap ? cap : dem;
        const current = vector.get(nodeId);
        if (current === undefined || !Number.isFinite(current)) {
          continue;
        }
        const limit = clampUtilization(current - (delta * ratio) / (1 - ratio));
        vector.set(nodeId, limit < ZERO_SNAP ? 0 : limit);
        jumped = true;
      }
      if (jumped) {
        roundsSinceJump = 0;
      }
    }

    prevDelta.clear();
    for (const [key, delta] of currentDelta) {
      prevDelta.set(key, delta);
    }
  }

  // Snap converged dust to hard zero so an unfed loop reads 0%, not 1e-9%.
  for (const info of machineNodes) {
    if ((cap.get(info.id) ?? 1) < ZERO_SNAP) {
      cap.set(info.id, 0);
    }
    const demValue = dem.get(info.id) ?? 1;
    if (Number.isFinite(demValue) && demValue < ZERO_SNAP) {
      dem.set(info.id, 0);
    }
  }
  const settled = runRound();
  lastRound = settled;

  const edgeAllocations = new Map<string, EdgeAllocationResult>();
  for (const edge of edges) {
    edgeAllocations.set(edge.id, {
      role: edge.role,
      resourceKey: edge.resourceKey,
      targetDemandKey: edge.targetDemandKey,
      needKey: edge.needKey,
      sourceCapacityPerSecond: edge.sourceCapacityPerSecond,
      availablePerSecond: lastRound.availableByEdge.get(edge.id) ?? 0,
      transferredPerSecond: lastRound.eatenByEdge.get(edge.id) ?? 0,
      demandPerSecond: lastRound.demandByEdge.get(edge.id) ?? 0,
    });
  }
  const eatenByNeed = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.needKey) {
      continue;
    }
    eatenByNeed.set(
      edge.needKey,
      (eatenByNeed.get(edge.needKey) ?? 0) + (lastRound.eatenByEdge.get(edge.id) ?? 0),
    );
  }
  const needEdgeCounts = new Map<string, number>();
  for (const [needKey, need] of needs) {
    needEdgeCounts.set(needKey, need.edgeCount);
  }

  return {
    capableByNode: cap,
    demandByNode: dem,
    disposalByNode: lastRound.disposalNext,
    clogOutputByNode: lastRound.clogOutputNext,
    edgeAllocations,
    eatenByNeed,
    unmetDesireByNeed: lastRound.unmetDesireByNeed,
    needEdgeCounts,
    rounds,
  };
}

interface FillResult {
  grants: Map<string, number>;
  remainingNeed: Map<string, number>;
  remainingBudget: Map<string, number>;
  /** What each tank still holds after the fill (trash cans drain this). */
  remainingPool: Map<string, number>;
  /** First-shot storage requests per pool (the honest pull on each tank). */
  poolRequested: Map<string, number>;
}

/**
 * Water-filling over the edge graph, in FOUR passes, and the order of the
 * passes is drain priority:
 *
 *   1. must-ship machine output   (the priority tranche: co-products of
 *                                  machines that run anyway - see the
 *                                  priority map in runRound)
 *   2. tanks                      (material already committed into a buffer)
 *   3. machine supply free to idle
 *   4. source drawers             (bottomless makeup, always last)
 *
 * A consumer therefore drinks what EXISTS before asking anybody to make more,
 * and asks everybody real before touching the infinite drawer. This is what
 * lets a byproduct return-feed or a recycling loop be drained first while the
 * honest supply line paces down to cover the difference - the fix for the
 * whole-board collapse a closed loop used to cause. Within every pass the
 * max-min rule stands unchanged: each hungry line gets an equal share of a
 * contended budget, small askers saturate, and the slack is re-offered, so a
 * 2000/s zombie ask still cannot crush a 10/s asker out of its trickle.
 * Grant factors are frozen per budget per round so iteration order cannot
 * shortchange later edges.
 */
function runFill(
  needs: Map<string, Need>,
  budgetOfferBase: Map<string, number>,
  poolOfferBase: Map<string, number>,
  asks: Map<string, number>,
  unconditionalByBudget: Map<string, number>,
): FillResult {
  const remainingBudget = new Map(budgetOfferBase);
  const remainingPool = new Map(poolOfferBase);
  const remainingNeed = new Map<string, number>();
  const grants = new Map<string, number>();
  for (const [needKey] of needs) {
    remainingNeed.set(needKey, asks.get(needKey) ?? 0);
  }

  // The priority tranche, bounded by what the budget can offer at all this
  // round (a must-ship rate above a throttled offer is wishful thinking).
  const remainingUnconditional = new Map<string, number>();
  for (const [budgetKey, amount] of unconditionalByBudget) {
    const capped = Math.min(amount, remainingBudget.get(budgetKey) ?? 0);
    if (capped > EPSILON) {
      remainingUnconditional.set(budgetKey, capped);
    }
  }

  const runMachinePass = (tranche: Map<string, number> | undefined) => {
    for (let round = 0; round < MACHINE_FILL_ROUNDS; round += 1) {
      const requestByEdge = new Map<PreparedEdgeRef, number>();
      for (const [needKey, need] of needs) {
        const rem = remainingNeed.get(needKey) ?? 0;
        if (rem <= EPSILON) {
          continue;
        }
        const liveEdges = need.machineEdges.filter((edge) => {
          if ((remainingBudget.get(edge.budgetKey) ?? 0) <= EPSILON) {
            return false;
          }
          return tranche === undefined || (tranche.get(edge.budgetKey) ?? 0) > EPSILON;
        });
        if (liveEdges.length === 0) {
          continue;
        }
        const perEdge = rem / liveEdges.length;
        for (const edge of liveEdges) {
          requestByEdge.set(edge, perEdge);
        }
      }

      if (requestByEdge.size === 0) {
        break;
      }

      const liveCountByBudget = new Map<string, number>();
      for (const [edge] of requestByEdge) {
        liveCountByBudget.set(edge.budgetKey, (liveCountByBudget.get(edge.budgetKey) ?? 0) + 1);
      }
      const shareByBudget = new Map<string, number>();
      for (const [budgetKey, liveCount] of liveCountByBudget) {
        const available = Math.min(
          remainingBudget.get(budgetKey) ?? 0,
          tranche === undefined
            ? Number.POSITIVE_INFINITY
            : (tranche.get(budgetKey) ?? 0),
        );
        shareByBudget.set(budgetKey, available / Math.max(1, liveCount));
      }

      let granted = 0;
      for (const [edge, request] of requestByEdge) {
        const grant = Math.min(request, shareByBudget.get(edge.budgetKey) ?? 0);
        if (grant <= EPSILON) {
          continue;
        }
        grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
        remainingBudget.set(edge.budgetKey, (remainingBudget.get(edge.budgetKey) ?? 0) - grant);
        if (tranche !== undefined) {
          tranche.set(edge.budgetKey, (tranche.get(edge.budgetKey) ?? 0) - grant);
        }
        remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
        granted += grant;
      }
      if (granted <= EPSILON) {
        break;
      }
    }
  };

  const grantsByPool = new Map<string, number>();
  const runStoragePass = (finitePools: boolean) => {
    for (let round = 0; round < STORAGE_FILL_ROUNDS; round += 1) {
      const requestByEdge = new Map<PreparedEdgeRef, number>();
      for (const [needKey, need] of needs) {
        const rem = remainingNeed.get(needKey) ?? 0;
        if (rem <= EPSILON) {
          continue;
        }
        const liveEdges = need.storageEdges.filter((edge) => {
          const pool = remainingPool.get(edge.poolKey) ?? 0;
          return Number.isFinite(pool) === finitePools && pool > EPSILON;
        });
        if (liveEdges.length === 0) {
          continue;
        }
        const perEdge = rem / liveEdges.length;
        for (const edge of liveEdges) {
          requestByEdge.set(edge, perEdge);
        }
      }

      if (requestByEdge.size === 0) {
        break;
      }

      const liveCountByPool = new Map<string, number>();
      for (const [edge] of requestByEdge) {
        liveCountByPool.set(edge.poolKey, (liveCountByPool.get(edge.poolKey) ?? 0) + 1);
      }
      const shareByPool = new Map<string, number>();
      for (const [poolKey, liveCount] of liveCountByPool) {
        const pool = remainingPool.get(poolKey) ?? 0;
        shareByPool.set(
          poolKey,
          Number.isFinite(pool) ? pool / Math.max(1, liveCount) : Number.POSITIVE_INFINITY,
        );
      }

      let granted = 0;
      for (const [edge, request] of requestByEdge) {
        const grant = Math.min(request, shareByPool.get(edge.poolKey) ?? 0);
        if (grant <= EPSILON) {
          continue;
        }
        grants.set(edge.id, (grants.get(edge.id) ?? 0) + grant);
        grantsByPool.set(edge.poolKey, (grantsByPool.get(edge.poolKey) ?? 0) + grant);
        const pool = remainingPool.get(edge.poolKey) ?? 0;
        if (Number.isFinite(pool)) {
          remainingPool.set(edge.poolKey, pool - grant);
        }
        remainingNeed.set(edge.needKey, (remainingNeed.get(edge.needKey) ?? 0) - grant);
        granted += grant;
      }
      if (granted <= EPSILON) {
        break;
      }
    }
  };

  runMachinePass(remainingUnconditional);
  runStoragePass(true);
  runMachinePass(undefined);
  runStoragePass(false);

  // The honest pull on each tank: what it actually gave, plus its share of
  // whatever the consumers still want after every supplier has spoken.
  const poolRequested = new Map(grantsByPool);
  for (const [needKey, need] of needs) {
    const rem = remainingNeed.get(needKey) ?? 0;
    if (rem <= EPSILON || need.storageEdges.length === 0) {
      continue;
    }
    const perEdge = rem / need.storageEdges.length;
    for (const edge of need.storageEdges) {
      poolRequested.set(edge.poolKey, (poolRequested.get(edge.poolKey) ?? 0) + perEdge);
    }
  }

  return { grants, remainingNeed, remainingBudget, remainingPool, poolRequested };
}

type PreparedEdgeRef = Pick<PreparedEdge, "id" | "budgetKey" | "needKey" | "poolKey">;

/**
 * Project-level target rate, split across producers of the target resource
 * that have no outgoing wire for it (the plan's terminal makers).
 */
/**
 * Producers that carry the plan's target rate: the ones with nowhere for the
 * target resource to go except out of the plan.
 *
 * A wire into a DRAIN or a trash can does NOT count as somewhere it goes.
 * Those accept without asking, so a node that drains its product is still the
 * end of the line and still on the hook for the rate you dialled. That matters
 * far more than it used to: draining the product IS how a closed plan says
 * "this is the thing I make", so without this exception dialling a target and
 * then declaring your export would silently cancel the target.
 *
 * Shared with the reporting pass in throughput.ts, which has to pick the same
 * nodes or the two would disagree about who owes the rate.
 */
export function selectProjectTargetNodes(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  targetKey: ResourceKey,
): FactoryProject["nodes"] {
  const roles = getStorageRoles(project);
  const trashIds = collectTrashNodeIds(project);
  return project.nodes.filter(
    (node) =>
      nodes[node.id]?.outputs[targetKey] !== undefined &&
      !project.edges.some(
        (edge) =>
          edge.source === node.id &&
          makeResourceKey(edge.resourceKind, edge.resourceId) === targetKey &&
          !trashIds.has(edge.target) &&
          !isDrainRole(roles.get(edge.target) ?? "idle"),
      ),
  );
}

function calculateProjectTargetShares(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
): Map<string, { key: ResourceKey; amountPerSecond: number }> {
  const shares = new Map<string, { key: ResourceKey; amountPerSecond: number }>();
  if (!project.targetRate) {
    return shares;
  }

  const targetKey = makeResourceKey(project.targetRate.kind, project.targetRate.resourceId);
  const terminal = selectProjectTargetNodes(project, nodes, targetKey);
  if (terminal.length === 0) {
    return shares;
  }

  const share = project.targetRate.amountPerSecond / terminal.length;
  for (const node of terminal) {
    shares.set(node.id, { key: targetKey, amountPerSecond: share });
  }
  return shares;
}

// ---- Shared flow helpers (used by the reporting layer in throughput.ts). ----

export function clampUtilization(utilization: number): number {
  if (!Number.isFinite(utilization)) {
    return 1;
  }

  return Math.min(Math.max(utilization, 0), 1);
}

export function getEffectiveFlowRate(flow: ResourceFlow | undefined, utilization: number): number {
  return (flow?.amountPerSecond ?? 0) * clampUtilization(utilization);
}

export function getEdgeTargetDemandKey(
  project: FactoryProject,
  edge: FactoryProject["edges"][number],
): ResourceKey | undefined {
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);
  const edgeResource = { kind: edge.resourceKind, id: edge.resourceId };
  const effectiveTargetRecipe =
    targetNode && targetRecipe ? applyRecipeInputOverrides(targetRecipe, targetNode) : undefined;
  const input = effectiveTargetRecipe?.inputs.find(
    (entry) => isRecipeInputConsumed(entry) && resourceMatchesInput(edgeResource, entry),
  );

  return input ? makeResourceKey(input.kind, input.id) : undefined;
}

export function getCompatibleOutputFlow(
  nodeResult: NodeThroughputResult | undefined,
  resource: Pick<FactoryProject["edges"][number], "resourceKind" | "resourceId">,
): ResourceFlow | undefined {
  if (!nodeResult) {
    return undefined;
  }

  return getCompatibleOutputFlowForResource(nodeResult, {
    kind: resource.resourceKind,
    id: resource.resourceId,
  });
}

export function getCompatibleOutputFlowForKey(
  nodeResult: NodeThroughputResult,
  resourceKey: ResourceKey,
): ResourceFlow | undefined {
  return getCompatibleOutputFlowForResource(nodeResult, resourceFromKey(resourceKey));
}

export function getCompatibleOutputFlowForResource(
  nodeResult: NodeThroughputResult,
  resource: Pick<ResourceAmount, "kind" | "id">,
): ResourceFlow | undefined {
  const exact = nodeResult.outputs[makeResourceKey(resource.kind, resource.id)];
  if (exact) {
    return exact;
  }

  for (const output of Object.values(nodeResult.outputs)) {
    const outputResource = {
      kind: output.kind,
      id: output.resourceId,
      displayName: output.displayName,
      alternatives: output.alternatives,
    };
    if (!resourceMatchesInput(resource, outputResource)) {
      continue;
    }

    return output;
  }

  return undefined;
}

export function resourceFromKey(resourceKey: ResourceKey): Pick<ResourceAmount, "kind" | "id"> {
  const separatorIndex = resourceKey.indexOf(":");
  return {
    kind: resourceKey.slice(0, separatorIndex) as ResourceKind,
    id: resourceKey.slice(separatorIndex + 1),
  };
}

export function addRequiredRate(
  requiredByNodeAndResource: Map<string, Map<ResourceKey, number>>,
  nodeId: string,
  resourceKey: ResourceKey,
  amountPerSecond: number,
): void {
  const nodeRequirements = requiredByNodeAndResource.get(nodeId) ?? new Map<ResourceKey, number>();
  nodeRequirements.set(resourceKey, (nodeRequirements.get(resourceKey) ?? 0) + amountPerSecond);
  requiredByNodeAndResource.set(nodeId, nodeRequirements);
}
