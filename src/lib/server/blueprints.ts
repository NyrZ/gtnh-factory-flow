import type { BlueprintResourceStat, BlueprintSummary } from "@/lib/blueprints/types";
import { getCommunityDb } from "@/lib/server/community";

export const BLUEPRINT_SUMMARY_COLUMNS =
  "id,user_id,name,node_count,storage_count,edge_count,pocket_count,machine_count,is_public,description,author_name,published_at,upvotes,downvotes,score,downloads,needs,outputs,created_at";

export interface BlueprintRow {
  id: string;
  user_id: string;
  name: string;
  node_count: number;
  storage_count: number;
  edge_count: number;
  pocket_count: number;
  machine_count: number;
  is_public: boolean;
  description: string;
  author_name: string;
  published_at: string | null;
  upvotes: number;
  downvotes: number;
  score: number;
  downloads: number;
  needs: BlueprintResourceStat[];
  outputs: BlueprintResourceStat[];
  created_at: string;
}

export function rowToBlueprintSummary(
  row: BlueprintRow,
  sessionUserId?: string,
): BlueprintSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    nodeCount: row.node_count,
    storageCount: row.storage_count,
    edgeCount: row.edge_count,
    pocketCount: row.pocket_count,
    machineCount: row.machine_count,
    isPublic: row.is_public,
    description: row.description,
    authorName: row.author_name || undefined,
    publishedAt: row.published_at ?? undefined,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
    downloads: row.downloads,
    isMine: Boolean(sessionUserId && row.user_id === sessionUserId),
    needs: row.needs ?? [],
    outputs: row.outputs ?? [],
  };
}

/** Marks each summary with the actor's own vote, exactly like plan listings. */
export async function attachMyBlueprintVotes(
  blueprints: BlueprintSummary[],
  actorKey: string,
): Promise<void> {
  if (blueprints.length === 0) {
    return;
  }

  const db = getCommunityDb();
  const { data, error } = await db
    .from("blueprint_votes")
    .select("blueprint_id,value")
    .eq("voter_key", actorKey)
    .in(
      "blueprint_id",
      blueprints.map((blueprint) => blueprint.id),
    );
  if (error || !data) {
    return;
  }

  const votes = new Map(data.map((vote) => [vote.blueprint_id as string, vote.value as 1 | -1]));
  for (const blueprint of blueprints) {
    blueprint.myVote = votes.get(blueprint.id);
  }
}

/**
 * PostgREST's "table not in schema cache" — the blueprints table has never
 * been created in this Supabase project. Every blueprint route hits this
 * until `supabase/schema.sql` is run, so the routes turn it into a message
 * that says what to actually do instead of a generic 500.
 */
export function isMissingBlueprintTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205";
}

export const BLUEPRINT_TABLE_MISSING_MESSAGE =
  "Blueprint storage is not set up yet — run supabase/schema.sql in the Supabase SQL editor.";
