import type { BoardClipboardPayload } from "@/store/factory-store";

export const BLUEPRINT_NAME_MAX_LENGTH = 60;
/** A blueprint is a fragment, not a whole plan; half the community cap. */
export const BLUEPRINT_PAYLOAD_MAX_BYTES = 1_500_000;
/** Per user. Generous — the list UI stays honest well past this. */
export const BLUEPRINT_MAX_PER_USER = 200;

export interface BlueprintSummary {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  storageCount: number;
  edgeCount: number;
  pocketCount: number;
  machineCount: number;
}

export interface BlueprintDetail extends BlueprintSummary {
  payload: BoardClipboardPayload;
}

export interface BlueprintListResponse {
  blueprints: BlueprintSummary[];
}

export type BlueprintSort = "newest" | "oldest" | "name" | "largest";

export const BLUEPRINT_SORTS: Record<BlueprintSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  name: "Name",
  largest: "Largest",
};

export function sortBlueprints(
  blueprints: BlueprintSummary[],
  sort: BlueprintSort,
): BlueprintSummary[] {
  const sorted = [...blueprints];
  switch (sort) {
    case "newest":
      return sorted.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    case "oldest":
      return sorted.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    case "name":
      return sorted.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
    case "largest":
      return sorted.sort(
        (left, right) =>
          right.nodeCount + right.storageCount - (left.nodeCount + left.storageCount) ||
          right.machineCount - left.machineCount,
      );
  }
}
