import type { BlueprintSummary } from "@/lib/blueprints/types";

export const BLUEPRINT_SUMMARY_COLUMNS =
  "id,name,node_count,storage_count,edge_count,pocket_count,machine_count,created_at";

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
