import { calculateThroughput } from "@/lib/solver";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { PlanResourceStat } from "@/lib/community/types";
import type { FactoryProject, MachineTier } from "@/lib/model/types";
import type { BoardClipboardPayload } from "@/store/factory-store";
import { createEmptyProject } from "@/examples";

export interface BlueprintIo {
  needs: PlanResourceStat[];
  outputs: PlanResourceStat[];
  highestTier?: Exclude<MachineTier, "DEMO">;
  highestTierIndex: number;
}

/**
 * What a blueprint eats, makes and runs at, computed the way a pocket card
 * computes its ports: solve the captured payload as its own little plan and
 * read the external inputs, unconsumed outputs and top voltage tier. Runs
 * client-side at save time — the same trust model as community plan stats —
 * and rides along to the server so listings can show it without ever
 * fetching payloads.
 */
export function computeBlueprintIo(payload: BoardClipboardPayload): BlueprintIo {
  try {
    const project: FactoryProject = {
      ...createEmptyProject(),
      nodes: payload.nodes,
      storages: payload.storages,
      annotations: [],
      pockets: payload.pockets,
      edges: payload.edges,
      recipes: payload.recipes,
    };
    const stats = computeCommunityPlanStats(project, calculateThroughput(project));
    return {
      needs: stats.needs,
      outputs: stats.outputs,
      highestTier: stats.highestTier,
      highestTierIndex: stats.highestTierIndex,
    };
  } catch {
    // A payload the solver chokes on still deserves saving; it just gets a
    // blank stat card.
    return { needs: [], outputs: [], highestTierIndex: -1 };
  }
}
