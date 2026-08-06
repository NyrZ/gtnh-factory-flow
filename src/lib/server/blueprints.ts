import type { BlueprintSummary } from "@/lib/blueprints/types";

export const BLUEPRINT_SUMMARY_COLUMNS =
  "id,name,node_count,storage_count,edge_count,pocket_count,machine_count,created_at";

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

export interface BlueprintRow {
  id: string;
  name: string;
  node_count: number;
  storage_count: number;
  edge_count: number;
  pocket_count: number;
  machine_count: number;
  created_at: string;
}

export function rowToBlueprintSummary(row: BlueprintRow): BlueprintSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    nodeCount: row.node_count,
    storageCount: row.storage_count,
    edgeCount: row.edge_count,
    pocketCount: row.pocket_count,
    machineCount: row.machine_count,
  };
}
