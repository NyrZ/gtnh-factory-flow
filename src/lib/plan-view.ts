"use client";

import {
  CANVAS_PATTERNS,
  readBoardViewSnapshot,
  writeBoardView,
  type CanvasPattern,
  type GlanceMode,
} from "@/components/flow/board-view";
import { isCompactViewport } from "./compact-view";
import type { PlanViewState } from "./model/types";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "./workspace-view";
import { getActiveRateUnit } from "./model/rate-unit";
import { useFactoryStore } from "@/store/factory-store";

/**
 * Reading and restoring the workspace arrangement a shared setup carries.
 *
 * Three separate homes feed this: the board's own view settings, the resource
 * panel's marks and toggles, and the board-wide rate unit. Gathering them in
 * one place means the share dialog and the open-a-setup path each deal with a
 * single object rather than knowing where each setting lives.
 */

/** Everything the current workspace would hand to someone opening this plan. */
export function capturePlanView(): PlanViewState {
  const board = readBoardViewSnapshot();
  const workspace = readWorkspaceViewSnapshot();

  return {
    canvasPattern: board.canvasPattern,
    lineHeatMode: board.lineHeatMode,
    lineThicknessMode: board.lineThicknessMode,
    freeDockMode: board.freeDockMode,
    lineLabelsMode: board.lineLabelsMode,
    linePulseMode: board.linePulseMode,
    calmMode: board.calmMode,
    glanceMode: board.glanceMode,
    rateUnit: getActiveRateUnit(),
    leftPanelOpen: workspace.leftPanelOpen,
    rightPanelOpen: workspace.rightPanelOpen,
    showHiddenResources: workspace.showHiddenResources,
    favouritesOnly: workspace.favouritesOnly,
    trendsOpen: workspace.trendsOpen,
    hiddenResourceKeys: workspace.hiddenResourceKeys,
    favouriteResourceKeys: workspace.favouriteResourceKeys,
  };
}

/**
 * How much of a saved arrangement to put back.
 *
 * `all` is someone OPENING a shared setup: they asked to see it the way its
 * author left it, columns and resource marks included.
 *
 * `board` is switching between your own tabs. The board's own look belongs to
 * the plan - a build you dressed in rate labels and thick lines should still be
 * wearing them when you come back to it - but the COLUMNS do not. Those are
 * where you are working, not what you are working on, and having them slide
 * open and shut every time you touch a tab is the kind of help nobody asked
 * for. Hidden and starred resources stay out for the same reason: someone who
 * never wants to see Water never wants to see it on any board.
 */
export type PlanViewScope = "all" | "board";

/**
 * Put a saved arrangement, and the plan itself, on screen.
 */
export function applyPlanView(view: PlanViewState | undefined, scope: PlanViewScope = "all"): void {
  applyViewSettings(view, scope);

  // Last, so the panel toggles above have already given the board its width.
  //
  // A shared plan carries its author's card positions and nothing at all about
  // where their camera was, and plenty of factories are built thousands of
  // cells from the origin. Opening one used to drop the viewer wherever they
  // happened to be looking, with the whole build off the edge of the board.
  useFactoryStore.getState().frameBoardNodes();
}

/**
 * The view settings themselves. Values the running build does not recognise
 * are dropped rather than written through, so a plan from a newer version
 * cannot leave the board in a state with no control that undoes it. Absent
 * fields leave the viewer's own setting alone.
 */
function applyViewSettings(view: PlanViewState | undefined, scope: PlanViewScope): void {
  if (!view) {
    return;
  }

  const flag = (value: boolean | undefined) => (typeof value === "boolean" ? { value } : undefined);
  const boardPatch: Parameters<typeof writeBoardView>[0] = {};

  if (view.canvasPattern && CANVAS_PATTERNS.includes(view.canvasPattern as CanvasPattern)) {
    boardPatch.canvasPattern = view.canvasPattern as CanvasPattern;
  }
  if (view.glanceMode === "identity" || view.glanceMode === "status") {
    boardPatch.glanceMode = view.glanceMode as GlanceMode;
    // The heatmap rides the status glance view rather than having its own
    // switch, so it is derived here exactly as board-view derives it on load.
    boardPatch.heatmapMode = view.glanceMode === "status";
  }
  for (const key of [
    "lineHeatMode",
    "lineThicknessMode",
    "freeDockMode",
    "lineLabelsMode",
    "linePulseMode",
    "calmMode",
  ] as const) {
    const set = flag(view[key]);
    if (set) {
      boardPatch[key] = set.value;
    }
  }
  if (Object.keys(boardPatch).length > 0) {
    writeBoardView(boardPatch);
  }

  if (scope === "board") {
    // Everything below here is the workspace around the board rather than the
    // board itself, and a tab switch leaves it alone. See PlanViewScope.
    if (view.rateUnit) {
      useFactoryStore.getState().setRateUnit(view.rateUnit);
    }
    return;
  }

  const workspacePatch: Parameters<typeof writeWorkspaceView>[0] = {};
  // Which columns the author had open is advice for a window with columns. On a
  // phone they are drawers over the board, one at a time, so a plan that carries
  // both would land the reader under two stacked panels with nothing to look at.
  const panelKeys = isCompactViewport() ? [] : (["leftPanelOpen", "rightPanelOpen"] as const);
  for (const key of [
    ...panelKeys,
    "showHiddenResources",
    "favouritesOnly",
    "trendsOpen",
  ] as const) {
    const set = flag(view[key]);
    if (set) {
      workspacePatch[key] = set.value;
    }
  }
  if (view.favouriteResourceKeys) {
    workspacePatch.favouriteResourceKeys = [...view.favouriteResourceKeys];
  }
  if (view.hiddenResourceKeys) {
    // Starred always wins over hidden - the same rule the marks are written
    // under - so a plan that somehow carries a key in both cannot land the
    // viewer in a state the UI has no button for.
    const starred = new Set(workspacePatch.favouriteResourceKeys ?? []);
    workspacePatch.hiddenResourceKeys = view.hiddenResourceKeys.filter(
      (key) => !starred.has(key),
    );
  }
  if (Object.keys(workspacePatch).length > 0) {
    writeWorkspaceView(workspacePatch);
  }

  if (view.rateUnit) {
    // Through the store, not the module singleton: flipping the unit also
    // re-solves, which is what gives every rate on screen a fresh identity.
    useFactoryStore.getState().setRateUnit(view.rateUnit);
  }
}
