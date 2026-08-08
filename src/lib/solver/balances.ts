import { makeResourceKey } from "../model/resources";
import type {
  EdgeThroughput,
  FactoryProject,
  FactoryStorage,
  NodeThroughputResult,
  ResourceAmount,
  ResourceBalance,
  ResourceKey,
} from "../model/types";
import { collectTrashNodeIds } from "../model/trash";
import { clampUtilization } from "./equilibrium";

const EPSILON = 0.000001;

/**
 * The resource books: what a plan makes, what it eats, and therefore what it is
 * short of or has spare. Deliberately a bag-of-cards sum rather than a walk of
 * the wires — two machines making and eating the same item balance out whether
 * or not a line runs between them.
 *
 * Lives apart from the solver proper because the flow panel derives the same
 * three groups from a selection's own solve (see `selection-flow.ts`), and the
 * two views must never disagree about what counts as a need, an output, or an
 * internal loop.
 */
function ensureBalance(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
): ResourceBalance {
  const key = makeResourceKey(resource.kind, resource.id);
  const existing = balances.get(key);

  if (existing) {
    return existing;
  }

  const balance: ResourceBalance = {
    key,
    kind: resource.kind,
    resourceId: resource.id,
    displayName: resource.displayName,
    producedPerSecond: 0,
    consumedPerSecond: 0,
    netPerSecond: 0,
    surplusPerSecond: 0,
    deficitPerSecond: 0,
  };
  balances.set(key, balance);
  return balance;
}

function addBalanceProduction(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.producedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function subtractBalanceProduction(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.producedPerSecond = Math.max(0, balance.producedPerSecond - amountPerSecond);
  updateBalanceNet(balance);
}

function addBalanceConsumption(
  balances: Map<ResourceKey, ResourceBalance>,
  resource: ResourceAmount,
  amountPerSecond: number,
): void {
  const balance = ensureBalance(balances, resource);
  balance.consumedPerSecond += amountPerSecond;
  updateBalanceNet(balance);
}

function updateBalanceNet(balance: ResourceBalance): void {
  balance.netPerSecond = balance.producedPerSecond - balance.consumedPerSecond;
  balance.surplusPerSecond = Math.max(0, balance.netPerSecond);
  balance.deficitPerSecond = Math.max(0, -balance.netPerSecond);
}

/**
 * How close to zero a leftover has to be before it is float dust rather than a
 * real shortfall or surplus.
 *
 * It has to SCALE with the flows, which a fixed epsilon does not. A machine
 * that is throttled has its intake recomputed as `need * (supply / need)`, and
 * in floating point that is not `supply` - it is one unit in the last place
 * away from it. Every other source of this residue is the same shape: a
 * rounding step on the rates themselves. So the leftover is proportional to
 * how big the rates are, and a flat 1e-6 tolerance quietly changed meaning
 * with the size of the plan. At 12,000/s it caught the dust; by the time a
 * line moves enough for one ULP to clear 1e-6, the same harmless rounding
 * surfaced as a resource sitting in Need at "-0.0000012/s" with nothing
 * actually wrong.
 *
 * 1e-9 of throughput is roughly ten million ULPs of headroom - room for the
 * residue to accumulate across a large board - while still being far below any
 * imbalance a player could create on purpose. Being short by one part in a
 * billion is not being short.
 */
const ABSOLUTE_SETTLE_EPSILON = 0.000001;
const RELATIVE_SETTLE_EPSILON = 1e-9;

function settleTolerance(balance: ResourceBalance): number {
  const scale = Math.max(balance.producedPerSecond, balance.consumedPerSecond);
  return Math.max(ABSOLUTE_SETTLE_EPSILON, scale * RELATIVE_SETTLE_EPSILON);
}

/**
 * Snap dust to exactly zero, once, where the books are closed.
 *
 * Done here rather than in each reader so every surface agrees: the three
 * panel groups, the trend charts that plot `netPerSecond`, and anything added
 * later all see a balanced resource as balanced rather than each applying its
 * own threshold and drifting apart.
 */
function settleBalances(balances: Map<ResourceKey, ResourceBalance>): void {
  for (const balance of balances.values()) {
    if (balance.netPerSecond !== 0 && Math.abs(balance.netPerSecond) <= settleTolerance(balance)) {
      balance.netPerSecond = 0;
      balance.surplusPerSecond = 0;
      balance.deficitPerSecond = 0;
    }
  }
}

export function calculateEffectiveBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
): Map<ResourceKey, ResourceBalance> {
  const balances = new Map<ResourceKey, ResourceBalance>();

  for (const node of Object.values(nodes)) {
    if (!node.enabled || node.status === "missing-recipe") {
      continue;
    }

    const utilization = clampUtilization(node.utilization);
    for (const input of Object.values(node.inputs)) {
      addBalanceConsumption(
        balances,
        {
          kind: input.kind,
          id: input.resourceId,
          displayName: input.displayName,
          amount: 0,
        },
        input.amountPerSecond * utilization,
      );
    }

    for (const output of Object.values(node.outputs)) {
      addBalanceProduction(
        balances,
        {
          kind: output.kind,
          id: output.resourceId,
          displayName: output.displayName,
          amount: 0,
        },
        output.amountPerSecond * utilization,
      );
    }
  }

  applyTrashedOutputBalances(project, edgeResults, balances);
  // Last, so it also settles whatever the two passes above left behind.
  settleBalances(balances);

  return balances;
}

/**
 * Whatever flows into a trash can never existed as far as the plan's books
 * are concerned: it leaves the produced column (floored at zero, so a mid-
 * convergence overshoot can never mint a phantom deficit) and therefore
 * never appears in the unconsumed-outputs panel.
 */
function applyTrashedOutputBalances(
  project: FactoryProject,
  edgeResults: Record<string, EdgeThroughput>,
  balances: Map<ResourceKey, ResourceBalance>,
): void {
  const trashNodeIds = collectTrashNodeIds(project);
  if (trashNodeIds.size === 0) {
    return;
  }

  for (const edge of project.edges) {
    if (!trashNodeIds.has(edge.target)) {
      continue;
    }
    const transferredPerSecond = edgeResults[edge.id]?.transferredPerSecond ?? 0;
    if (transferredPerSecond <= EPSILON) {
      continue;
    }
    subtractBalanceProduction(
      balances,
      {
        kind: edge.resourceKind,
        id: edge.resourceId,
        displayName: edge.label,
        amount: 0,
      },
      transferredPerSecond,
    );
  }
}

/**
 * The two headline lists the books imply: what has to be imported, and what
 * nothing downstream drinks.
 */
export function splitBalances(balances: Iterable<ResourceBalance>): {
  externalInputs: ResourceBalance[];
  unconsumedOutputs: ResourceBalance[];
} {
  const all = [...balances];
  return {
    externalInputs: all
      .filter((balance) => balance.deficitPerSecond > EPSILON)
      .sort((a, b) => b.deficitPerSecond - a.deficitPerSecond),
    unconsumedOutputs: all
      .filter((balance) => balance.surplusPerSecond > EPSILON)
      .sort((a, b) => b.surplusPerSecond - a.surplusPerSecond),
  };
}

/**
 * Made and used in equal measure inside the scope — the "Internal" group.
 * Derived here rather than in the panel so the three groups always partition
 * the same book.
 */
export function selectInternalBalances(balances: Iterable<ResourceBalance>): ResourceBalance[] {
  return [...balances]
    .filter(
      (balance) =>
        balance.producedPerSecond > 0 &&
        balance.consumedPerSecond > 0 &&
        balance.deficitPerSecond <= EPSILON &&
        balance.surplusPerSecond <= EPSILON,
    )
    .sort((left, right) => right.consumedPerSecond - left.consumedPerSecond);
}
