import type { FactoryProject } from "./types";
import { normalizeProjectFuelProfiles } from "./fuels";
import { repairFilledCellInputOverrides } from "./recipe-input-overrides";
import { snapPositionToGrid, snapSizeUpToGrid } from "@/lib/board-grid";

/**
 * Everything a project must go through on its way in, whether it arrives from
 * IndexedDB, a JSON import, an embedded plan image or the community hub.
 *
 * One funnel on purpose. These repairs were previously applied by whoever
 * remembered to call them, which is how a load path ends up quietly skipping a
 * migration — every caller now gets the full set by construction.
 */
export function normalizeLoadedProject(project: FactoryProject): FactoryProject {
  return snapProjectToGrid(
    repairPocketReferences(repairFilledCellInputOverrides(normalizeProjectFuelProfiles(project))),
  );
}

/**
 * A card pointing at a pocket that no longer exists would vanish from every
 * view — not on the root board, not inside any pocket. Dangling `pocketId`s
 * are cleared (the card surfaces on the root board), and a pocket whose
 * parent is missing or cyclic is re-rooted for the same reason.
 */
function repairPocketReferences(project: FactoryProject): FactoryProject {
  const pockets = project.pockets ?? [];
  if (
    pockets.length === 0 &&
    !project.nodes.some((node) => node.pocketId) &&
    !project.storages?.some((storage) => storage.pocketId) &&
    !project.annotations?.some((annotation) => annotation.pocketId)
  ) {
    return project;
  }

  const pocketIds = new Set(pockets.map((pocket) => pocket.id));
  const repairedPockets = pockets.map((pocket) => {
    if (!pocket.parentPocketId) {
      return pocket;
    }
    // Walk the parent chain; a missing link or a loop back to this pocket
    // means the chain never reaches the root board.
    let parentId: string | undefined = pocket.parentPocketId;
    const seen = new Set<string>([pocket.id]);
    while (parentId) {
      if (!pocketIds.has(parentId) || seen.has(parentId)) {
        return { ...pocket, parentPocketId: undefined };
      }
      seen.add(parentId);
      parentId = pockets.find((entry) => entry.id === parentId)?.parentPocketId;
    }
    return pocket;
  });

  const clearDangling = <T extends { pocketId?: string }>(item: T): T =>
    item.pocketId && !pocketIds.has(item.pocketId) ? { ...item, pocketId: undefined } : item;

  return {
    ...project,
    pockets: repairedPockets,
    nodes: project.nodes.map(clearDangling),
    storages: project.storages?.map(clearDangling),
    annotations: project.annotations?.map(clearDangling),
  };
}

/**
 * Every plan made before the board had a grid arrives with positions at
 * arbitrary pixels. There is no "unsnapped" board any more, so rather than
 * leave old plans looking ragged next to new ones, they land on the grid the
 * first time they are opened — and stay there, since the load is what the next
 * autosave writes back.
 */
function snapProjectToGrid(project: FactoryProject): FactoryProject {
  return {
    ...project,
    nodes: project.nodes.map((node) => ({
      ...node,
      position: snapPositionToGrid(node.position),
    })),
    edges: project.edges.map((edge) =>
      edge.waypoints && edge.waypoints.length > 0
        ? { ...edge, waypoints: edge.waypoints.map((point) => snapPositionToGrid(point)) }
        : edge,
    ),
    storages: project.storages?.map((storage) => ({
      ...storage,
      position: snapPositionToGrid(storage.position),
    })),
    annotations: project.annotations?.map((annotation) => ({
      ...annotation,
      position: snapPositionToGrid(annotation.position),
      size: {
        width: snapSizeUpToGrid(annotation.size.width),
        height: snapSizeUpToGrid(annotation.size.height),
      },
    })),
    pockets: project.pockets?.map((pocket) => ({
      ...pocket,
      position: snapPositionToGrid(pocket.position),
    })),
  };
}
