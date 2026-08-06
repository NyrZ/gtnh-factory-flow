import { calculateThroughput } from "@/lib/solver";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { PlanResourceStat } from "@/lib/community/types";
import type { FactoryProject } from "@/lib/model/types";
import type { BoardClipboardPayload } from "@/store/factory-store";
import { createEmptyProject } from "@/examples";

/**
 * What a blueprint eats and makes, computed the way a pocket card computes
 * its ports: solve the captured payload as its own little plan and read the
 * external inputs and unconsumed outputs. Runs client-side at save time —
 * the same trust model as community plan stats — and rides along to the
 * server so listings can show I/O without ever fetching payloads.
 */
export function computeBlueprintIo(payload: BoardClipboardPayload): {
  needs: PlanResourceStat[];
  outputs: PlanResourceStat[];
} {
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
    return { needs: stats.needs, outputs: stats.outputs };
  } catch {
    // A payload the solver chokes on still deserves saving; it just gets a
    // blank stat card.
    return { needs: [], outputs: [] };
  }
}
