import {
  getFilledCellFluidEquivalent,
  makeResourceKey,
  resourceMatchesInput,
} from "../model/resources";
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

export function calculateEffectiveBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
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

  applyConvertedStorageOutputBalances(project, nodes, edgeResults, storagesById, balances);
  applyTrashedOutputBalances(project, edgeResults, balances);

  return balances;
}

/**
 * Whatever flows into a trash can never existed as far as the plan's books
 * are concerned: it leaves the produced column (floored at zero, so a mid-
 * convergence overshoot can never mint a phantom deficit) and therefore
 * never appears in the unconsumed-outputs panel. Runs after the cell/fluid
 * conversion pass so a tank-drained fluid subtracts from the converted row.
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

function applyConvertedStorageOutputBalances(
  project: FactoryProject,
  nodes: Record<string, NodeThroughputResult>,
  edgeResults: Record<string, EdgeThroughput>,
  storagesById: Map<string, FactoryStorage>,
  balances: Map<ResourceKey, ResourceBalance>,
): void {
  for (const edge of project.edges) {
    if (!storagesById.has(edge.target) || storagesById.has(edge.source)) {
      continue;
    }

    const transferredPerSecond = edgeResults[edge.id]?.transferredPerSecond ?? 0;
    if (transferredPerSecond <= EPSILON) {
      continue;
    }

    const sourceResult = nodes[edge.source];
    const output = sourceResult
      ? Object.values(sourceResult.outputs).find(
          (candidate) =>
            candidate.kind !== edge.resourceKind &&
            resourceMatchesInput(
              { kind: edge.resourceKind, id: edge.resourceId },
              {
                kind: candidate.kind,
                id: candidate.resourceId,
                displayName: candidate.displayName,
              },
            ),
        )
      : undefined;
    if (!sourceResult || !output) {
      continue;
    }

    const outputResource = {
      kind: output.kind,
      id: output.resourceId,
      displayName: output.displayName,
      alternatives: output.alternatives,
      amount: transferredPerSecond,
    };
    const edgeResource = {
      kind: edge.resourceKind,
      id: edge.resourceId,
      displayName: edge.label,
      amount: transferredPerSecond,
    };

    if (edge.resourceKind === "fluid" && output.kind === "item") {
      const fluid = getFilledCellFluidEquivalent(outputResource);
      if (fluid?.id !== edge.resourceId || !fluid.amount || fluid.amount <= 0) {
        continue;
      }

      const cellAmountPerSecond = transferredPerSecond * (output.amountPerSecond / fluid.amount);
      subtractBalanceProduction(balances, outputResource, cellAmountPerSecond);
      addBalanceProduction(balances, edgeResource, transferredPerSecond);
    }
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
export function selectInternalBalances(
  balances: Iterable<ResourceBalance>,
): ResourceBalance[] {
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
