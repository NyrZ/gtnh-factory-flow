import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model";

/**
 * Death spirals: rings of machines that feed each other and cannot start.
 *
 * The solver already gets these right, and deliberately so. A ring that makes
 * more of the looped good than it eats sustains itself and runs flat out; a
 * ring that loses even a little on every pass winds down geometrically to
 * zero, because that is exactly what would happen in game. Nothing here
 * changes a single number.
 *
 * What it changes is that the board stops keeping the reason a secret. A dead
 * ring reads as a field of 0% cards, and — worse since the verdict split —
 * each one says "blocked, the fix is upstream" while pointing at the next
 * machine round the ring. A hundred cards can chase each other forever. The
 * "follow the amber cards up and you land on a red one" promise is only true
 * for acyclic chains; this is the terminator for the cyclic case.
 *
 * The catch that makes this worth detecting at all: an UNWIRED input is
 * assumed hand-fed, so the same ring reads perfectly healthy right up until
 * you wire it closed. Then it has to source the good from itself, cannot, and
 * everything falls to zero. That transition looks like the planner breaking,
 * and it is the planner finally telling the truth.
 */

/** Below this a node has converged to a hard stop, not merely to "slow". */
const DEAD_EPSILON = 1e-4;
const RATE_EPSILON = 1e-6;

export interface DeathSpiral {
  /** Stable id: the smallest member node id. Survives re-solves. */
  id: string;
  /** Every node in the ring, sorted, machines and pass-through buffers alike. */
  nodeIds: string[];
  /** Machine members only — what the copy counts. */
  machineIds: string[];
  /** Display names of the goods that travel round the ring. */
  resourceNames: string[];
  /** Something outside the ring is wired into it. */
  hasExternalSource: boolean;
  /** ...but it delivers nothing, so it cannot prime the ring either. */
  externalSourceDry: boolean;
  /** The outside supplier's name, when exactly one is wired in. */
  externalSourceName?: string;
}

/**
 * Strongly connected components, iteratively (Tarjan).
 *
 * Iterative on purpose: a 1,200-node plan is a supported board size and a
 * recursive walk over a long chain blows the stack. One pass, O(nodes+edges).
 */
function stronglyConnectedComponents(
  nodeIds: string[],
  outgoing: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodeIds) {
    if (index.has(root)) {
      continue;
    }

    // Explicit work stack: (node, how far through its edge list we are).
    const work: Array<{ id: string; edge: number }> = [{ id: root, edge: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const edges = outgoing.get(frame.id) ?? [];

      if (frame.edge < edges.length) {
        const next = edges[frame.edge]!;
        frame.edge += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ id: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(next)!));
        }
        continue;
      }

      // Every edge walked: close this node out.
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) {
            break;
          }
        }
        components.push(component);
      }
    }
  }

  return components;
}

export interface DeathSpiralIndex {
  /** Node id -> the spiral it is trapped in. */
  byNode: Map<string, DeathSpiral>;
  /** Every distinct spiral on the board, biggest first. */
  spirals: DeathSpiral[];
}

const EMPTY_INDEX: DeathSpiralIndex = { byNode: new Map(), spirals: [] };

// Keyed on object identity, like the board's other per-solve indexes: the
// solver hands out a fresh result per tick, so a stale index cannot outlive
// the numbers it was built from.
const cache = new WeakMap<
  FactoryProject,
  { result: ThroughputResult | undefined; index: DeathSpiralIndex }
>();

/**
 * Every ring on the board that has converged to a standstill.
 *
 * A ring only counts as dead when EVERY machine in it has stopped. One member
 * still turning means the loop sustains itself and there is nothing to report
 * — a surplus ring is a perfectly good build, and saying otherwise about a
 * working factory would be worse than saying nothing.
 */
export function findDeathSpirals(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): DeathSpiralIndex {
  const cached = cache.get(project);
  if (cached && cached.result === result) {
    return cached.index;
  }
  if (!result) {
    return EMPTY_INDEX;
  }

  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const recipeById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  // Buffers ride in the graph as pass-through hops, so a ring that runs A ->
  // tank -> B -> A is still found. A hand-stocked tank has no inbound line at
  // all, so it can never sit inside a cycle — which is the correct answer:
  // stock in a tank IS the way out of a spiral.
  const outgoing = new Map<string, string[]>();
  const graphNodes: string[] = [];
  for (const node of project.nodes) {
    graphNodes.push(node.id);
  }
  for (const id of storageIds) {
    graphNodes.push(id);
  }
  for (const edge of project.edges) {
    const bucket = outgoing.get(edge.source);
    if (bucket) {
      bucket.push(edge.target);
    } else {
      outgoing.set(edge.source, [edge.target]);
    }
  }

  const selfLooped = new Set<string>();
  for (const edge of project.edges) {
    if (edge.source === edge.target) {
      selfLooped.add(edge.source);
    }
  }

  const byNode = new Map<string, DeathSpiral>();
  const spirals: DeathSpiral[] = [];

  for (const component of stronglyConnectedComponents(graphNodes, outgoing)) {
    // A ring is two or more nodes, or one node wired back into itself.
    if (component.length < 2 && !selfLooped.has(component[0]!)) {
      continue;
    }

    const members = new Set(component);
    const machineIds = component.filter((id) => !storageIds.has(id)).sort();
    if (machineIds.length === 0) {
      continue;
    }

    // Disabled machines are stopped because you stopped them; that is not a
    // spiral, and a ring containing one has an obvious explanation already.
    const anyDisabled = machineIds.some((id) => nodeById.get(id)?.enabled === false);
    if (anyDisabled) {
      continue;
    }

    // Stopped, AND stopped by capability. Both halves matter: a ring can also
    // read 0% across the board because nothing outside wants its product, and
    // that one has healthy capability, is not dying, and is fixed by wiring up
    // a consumer rather than by priming anything. Usage alone cannot tell the
    // two apart, so the test is on what the inputs would ALLOW.
    const allStarved = machineIds.every((id) => {
      const nodeResult = result.nodes[id];
      if (!nodeResult) {
        return false;
      }
      const capable = nodeResult.capableUtilization ?? 1;
      return nodeResult.utilization <= DEAD_EPSILON && capable <= DEAD_EPSILON;
    });
    if (!allStarved) {
      continue;
    }

    const resourceNames = new Set<string>();
    let hasExternalSource = false;
    let externalInflow = 0;
    const externalSourceNames = new Set<string>();
    for (const edge of project.edges) {
      const targetInside = members.has(edge.target);
      const sourceInside = members.has(edge.source);
      if (targetInside && sourceInside) {
        const key = makeResourceKey(edge.resourceKind, edge.resourceId);
        const flow =
          result.nodes[edge.source]?.outputs[key as keyof (typeof result.nodes)[string]["outputs"]];
        resourceNames.add(flow?.displayName ?? edge.label ?? edge.resourceId);
        continue;
      }
      if (targetInside && !sourceInside) {
        hasExternalSource = true;
        externalInflow += result.edges[edge.id]?.transferredPerSecond ?? 0;
        const storage = (project.storages ?? []).find((entry) => entry.id === edge.source);
        if (storage) {
          externalSourceNames.add(storage.displayName ?? storage.resourceId);
        } else {
          const sourceNode = nodeById.get(edge.source);
          const recipe = sourceNode ? recipeById.get(sourceNode.recipeId) : undefined;
          externalSourceNames.add(recipe?.machineType ?? recipe?.name ?? "a machine");
        }
      }
    }

    const spiral: DeathSpiral = {
      id: machineIds[0]!,
      nodeIds: [...component].sort(),
      machineIds,
      resourceNames: [...resourceNames].sort(),
      hasExternalSource,
      externalSourceDry: hasExternalSource && externalInflow <= RATE_EPSILON,
      externalSourceName:
        externalSourceNames.size === 1 ? [...externalSourceNames][0] : undefined,
    };
    spirals.push(spiral);
    for (const id of component) {
      byNode.set(id, spiral);
    }
  }

  spirals.sort((left, right) => right.machineIds.length - left.machineIds.length);
  const index: DeathSpiralIndex = { byNode, spirals };
  cache.set(project, { result, index });
  return index;
}

/**
 * The ring's story in plain words: what is happening, why, and the one thing
 * that fixes it. Deliberately says the planner is right — a player watching a
 * hundred machines fall to zero the moment they wired the last line needs to
 * hear that this is the game, not the tool.
 */
export function describeDeathSpiral(spiral: DeathSpiral): {
  title: string;
  what: string;
  why: string;
  fix: string;
} {
  const count = spiral.machineIds.length;
  const machines = count === 1 ? "This machine feeds itself" : `${count} machines feed each other`;
  const goods =
    spiral.resourceNames.length === 0
      ? "what they pass round"
      : spiral.resourceNames.length <= 2
        ? spiral.resourceNames.join(" and ")
        : `${spiral.resourceNames.slice(0, 2).join(", ")} and ${spiral.resourceNames.length - 2} more`;

  return {
    title: count === 1 ? "This loop cannot start itself" : "These machines are stuck in a loop",
    what: `${machines} in a ring, passing ${goods} round it. Every one of them sits at 0%.`,
    why: "More leaves the ring than comes back round it, so every lap starts with less than the last one and it winds down to nothing. That happens whether the recipes lose a little each time or something taps the ring for its own use. Nothing outside puts the difference back, and a ring cannot start itself from empty.",
    fix: spiral.externalSourceDry
      ? `The only thing feeding it, ${spiral.externalSourceName ?? "its supplier"}, has stopped too. Get that running and the ring comes back with it.`
      : spiral.hasExternalSource
        ? "What feeds it does not cover the losses. Send more in, or take less out of the ring."
        : "Wire a source into any machine in the ring, or hang a stocked barrel on one. Anything that puts the shortfall back in each pass will start it.",
  };
}
