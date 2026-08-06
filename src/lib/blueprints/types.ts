import type { BoardClipboardPayload } from "@/store/factory-store";
import type { PlanResourceStat } from "@/lib/community/types";

/** One line of a blueprint's stat card — same shape community plans use. */
export type BlueprintResourceStat = PlanResourceStat;

/** Stat lines kept per side; matches the community plan cap. */
export const BLUEPRINT_RESOURCE_STAT_LIMIT = 64;

export const BLUEPRINT_NAME_MAX_LENGTH = 60;
export const BLUEPRINT_DESCRIPTION_MAX_LENGTH = 500;
/** A blueprint is a fragment, not a whole plan; half the community cap. */
export const BLUEPRINT_PAYLOAD_MAX_BYTES = 1_500_000;
/** Per user. Generous — the list UI stays honest well past this. */
export const BLUEPRINT_MAX_PER_USER = 200;
/** One page of the public shelf. */
export const PUBLIC_BLUEPRINT_PAGE_SIZE = 30;

export interface BlueprintSummary {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  storageCount: number;
  edgeCount: number;
  pocketCount: number;
  machineCount: number;
  /** Published to the network. Private rows always carry false. */
  isPublic: boolean;
  description: string;
  authorName?: string;
  publishedAt?: string;
  upvotes: number;
  downvotes: number;
  score: number;
  downloads: number;
  /** Public listings: this row belongs to the session user. */
  isMine?: boolean;
  /** Public listings: the vote this browser has cast, if any. */
  myVote?: 1 | -1;
  /** The stat card: external needs and unconsumed outputs at save time. */
  needs: BlueprintResourceStat[];
  outputs: BlueprintResourceStat[];
}

export interface BlueprintDetail extends BlueprintSummary {
  payload: BoardClipboardPayload;
}

export interface BlueprintListResponse {
  blueprints: BlueprintSummary[];
  /** Public scope only: another page exists past this one. */
  hasMore?: boolean;
}

export interface BlueprintVoteResponse {
  upvotes: number;
  downvotes: number;
  score: number;
  myVote?: 1 | -1;
}

export type BlueprintSort = "newest" | "oldest" | "name" | "largest";

export const BLUEPRINT_SORTS: Record<BlueprintSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  name: "Name",
  largest: "Largest",
};

export type PublicBlueprintSort = "top" | "newest" | "downloads";

export const PUBLIC_BLUEPRINT_SORTS: Record<PublicBlueprintSort, string> = {
  top: "Top",
  newest: "New",
  downloads: "Placed",
};

export interface PublicBlueprintListRequest {
  sort?: PublicBlueprintSort;
  search?: string;
  page?: number;
}

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
