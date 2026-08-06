import { calculateThroughput } from "@/lib/solver";
import type {
  FactoryEdge,
  FactoryPocket,
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
} from "@/lib/model/types";
import { parseResourceHandleId } from "./resource-handles";

/**
 * One port row on a collapsed pocket card: a resource the dimension needs
 * from the outside (input) or offers to it (output), at the rate the members
 * would move running by themselves.
 */
export interface PocketPortSummary {
  kind: ResourceBalance["kind"];
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  ratePerSecond: number;
}

export interface PocketSummary {
  inputs: PocketPortSummary[];
  outputs: PocketPortSummary[];
  /** Machines inside, nested pockets included. */
  machineCount: number;
  /** Cards inside, nested pockets included. */
  memberCount: number;
}

/**
 * What a pocket looks like from the outside: run the solver over ONLY its
 * members (wires to the rest of the plan dropped), and the sub-plan's
 * unmet inputs become the card's input ports while its unconsumed outputs
 * become the card's output ports — the same NEED/OUTPUT split the right-hand
 * panel shows for the whole plan, scoped to one dimension.
 *
 * Computed per project commit for the pockets on screen; the sub-plans are
 * small, so a full scoped solve is cheaper than it sounds.
 */
export function computePocketSummaries(
  project: FactoryProject,
  pockets: FactoryPocket[],
): Map<string, PocketSummary> {
  const summaries = new Map<string, PocketSummary>();
  if (pockets.length === 0) {
    return summaries;
  }

  const allPockets = project.pockets ?? [];
  const icons = buildResourceIconLookup(project);

  for (const pocket of pockets) {
    // Membership is transitive: a nested pocket's machines count toward the
    // outer card, because from out here they are all "inside".
    const pocketIds = new Set<string>([pocket.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of allPockets) {
        if (
          entry.parentPocketId !== undefined &&
          pocketIds.has(entry.parentPocketId) &&
          !pocketIds.has(entry.id)
        ) {
          pocketIds.add(entry.id);
          grew = true;
        }
      }
    }

    const nodes = project.nodes.filter(
      (node) => node.pocketId !== undefined && pocketIds.has(node.pocketId),
    );
    const storages = (project.storages ?? []).filter(
      (storage) => storage.pocketId !== undefined && pocketIds.has(storage.pocketId),
    );
    const memberIds = new Set<string>([
      ...nodes.map((node) => node.id),
      ...storages.map((storage) => storage.id),
    ]);
    const edges = project.edges.filter(
      (edge) => memberIds.has(edge.source) && memberIds.has(edge.target),
    );

    const scoped = calculateThroughput({
      ...project,
      nodes,
      storages,
      annotations: [],
      edges,
    });

    const toPort = (balance: ResourceBalance, ratePerSecond: number): PocketPortSummary => {
      const icon = icons.get(balance.key);
      return {
        kind: balance.kind,
        resourceId: balance.resourceId,
        displayName: balance.displayName ?? icon?.displayName,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond,
      };
    };

    const inputs = scoped.externalInputs.map((balance) =>
      toPort(balance, balance.deficitPerSecond),
    );
    const outputs = scoped.unconsumedOutputs.map((balance) =>
      toPort(balance, balance.surplusPerSecond),
    );

    // Every wire crossing the boundary gets a port even when the members-only
    // solve reports nothing for its resource (an internally covered input
    // also fed from outside, a fully consumed output also exported). Port
    // identity derives exactly as the board's edge remap does — the stored
    // handle first, the wire's resource as fallback — so a crossing wire
    // always finds its rendered port and can never turn invisible.
    const portFromEdge = (
      edge: FactoryEdge,
      side: "input" | "output",
    ): PocketPortSummary => {
      const parsed = parseResourceHandleId(
        side === "input" ? edge.targetHandle : edge.sourceHandle,
      );
      const kind = parsed?.kind ?? edge.resourceKind;
      const resourceId = parsed?.resourceId ?? edge.resourceId;
      const icon = icons.get(`${kind}:${resourceId}`);
      return {
        kind,
        resourceId,
        displayName: icon?.displayName ?? edge.label,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond: 0,
      };
    };
    const seenInputs = new Set(inputs.map((port) => `${port.kind}:${port.resourceId}`));
    const seenOutputs = new Set(outputs.map((port) => `${port.kind}:${port.resourceId}`));
    for (const edge of project.edges) {
      const sourceInside = memberIds.has(edge.source);
      const targetInside = memberIds.has(edge.target);
      if (sourceInside === targetInside) {
        continue;
      }
      const side = targetInside ? "input" : "output";
      const port = portFromEdge(edge, side);
      const key = `${port.kind}:${port.resourceId}`;
      const seen = targetInside ? seenInputs : seenOutputs;
      if (!seen.has(key)) {
        seen.add(key);
        (targetInside ? inputs : outputs).push(port);
      }
    }

    summaries.set(pocket.id, {
      inputs,
      outputs,
      machineCount: nodes.reduce((sum, node) => sum + Math.max(0, node.machineCount), 0),
      memberCount: memberIds.size,
    });
  }

  return summaries;
}

type ResourceIconMeta = Pick<
  ResourceAmount,
  "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildResourceIconLookup(project: FactoryProject): Map<string, ResourceIconMeta> {
  const icons = new Map<string, ResourceIconMeta>();
  const add = (resource: Pick<ResourceAmount, "kind" | "id"> & ResourceIconMeta) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = icons.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      icons.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      add(resource);
    }
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }
  return icons;
}
