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
  return snapProjectToGrid(repairFilledCellInputOverrides(normalizeProjectFuelProfiles(project)));
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
  };
}
