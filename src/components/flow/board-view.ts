"use client";

import { useSyncExternalStore } from "react";

/**
 * Board view settings: how the canvas looks, and which of the read-only display
 * modes are on.
 *
 * This module holds the LIVE settings, the ones the board is drawing with right
 * now, in localStorage and outside the Zustand store so they can be read
 * without an effect.
 *
 * They are not global taste, though. How a factory is drawn belongs to the
 * factory: one build wants rate labels and fat lines, the next wants a clean
 * board, and a plan that was dressed to be readable should still be wearing
 * that when you come back to it. So a snapshot goes into every design as it is
 * saved and comes back out when you switch to it (`plan-view.ts`, and
 * `showProject` in the design store), which is the same snapshot a SHARED setup
 * has always carried. Switching tabs therefore rewrites what is here — the
 * localStorage copy is what the board reads, not the record of what any one
 * plan wants.
 *
 * The columns and the resource marks deliberately do NOT work this way; see
 * PlanViewScope.
 *
 * Read through useSyncExternalStore: localStorage does not exist during SSR,
 * so the server renders the defaults and the browser swaps in the saved values
 * on hydration. That is the one shape that neither mismatches the server HTML
 * nor sets state from inside an effect.
 */
export type CanvasPattern = "dots" | "lines" | "cross" | "none";

export const CANVAS_PATTERNS: CanvasPattern[] = ["dots", "lines", "cross", "none"];

/**
 * What a zoomed-out card leads with. `identity` is the big machine icon with
 * the count and name, and hovering reveals the I/O rates; `status` is the
 * utilisation percentage with the hop-distance map on hover. Always exactly
 * one of these — the smart-view buttons in the board's bottom right switch.
 */
export type GlanceMode = "identity" | "status";

export interface BoardView {
  // No `snapToGrid`. Snapping was a preference back when cards were sized by
  // their contents; now they are sized in grid cells, so it is a fact.
  canvasPattern: CanvasPattern;
  /**
   * Machines take their colour from how hard they run. Not its own toggle
   * any more: it rides the status glance view (the gauge button, bottom
   * right), so "show me usage" is one mode at every zoom — percentages far
   * out, heat colours up close.
   */
  heatmapMode: boolean;
  /** Lines take their colour from how much moves through them. */
  lineHeatMode: boolean;
  /** Lines take their thickness from how much moves through them. */
  lineThicknessMode: boolean;
  /** Wires attach anywhere on a card (on) or at their fixed ports (off). */
  freeDockMode: boolean;
  /** Rate pills on the lines. Off by default; the ports carry the numbers. */
  lineLabelsMode: boolean;
  /** Dashes march along each line in the direction of flow. */
  linePulseMode: boolean;
  /**
   * Every status colour steps down to neutral steel: the words, bars and
   * badges still say bottleneck / over-asked / fed, they just stop shouting
   * it in red, amber and green. For showing a plan off, not fixing it.
   */
  calmMode: boolean;
  /** What the glance (zoomed-out) view shows. See GlanceMode. */
  glanceMode: GlanceMode;
}

const BOARD_VIEW_STORAGE_KEY = "gtnh-factory-flow-board-view";

export const DEFAULT_BOARD_VIEW: BoardView = {
  canvasPattern: "dots",
  heatmapMode: false,
  lineHeatMode: false,
  // On out of the box: between them these two say which way everything runs
  // and which lines carry the load, which is most of what a first look at a
  // plan is for. Colour modes stay off — those override what the board is
  // already telling you with resource colours and paint tags.
  freeDockMode: true,
  lineLabelsMode: false,
  lineThicknessMode: true,
  linePulseMode: true,
  calmMode: false,
  glanceMode: "identity",
};

let boardViewState: BoardView = DEFAULT_BOARD_VIEW;
let boardViewLoaded = false;
const listeners = new Set<() => void>();

function readBoardView(): BoardView {
  try {
    const raw = window.localStorage.getItem(BOARD_VIEW_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_BOARD_VIEW;
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof BoardView, unknown>>;
    // A key that is ABSENT falls back to the default; only an explicit `false`
    // means off. Reading a missing key as false would mean anyone with a saved
    // blob from before a setting existed silently opts out of its default —
    // and every new default would ship switched off for existing users.
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    const glanceMode =
      parsed.glanceMode === "status" || parsed.glanceMode === "identity"
        ? parsed.glanceMode
        : DEFAULT_BOARD_VIEW.glanceMode;
    return {
      canvasPattern: CANVAS_PATTERNS.includes(parsed.canvasPattern as CanvasPattern)
        ? (parsed.canvasPattern as CanvasPattern)
        : DEFAULT_BOARD_VIEW.canvasPattern,
      // Derived, not read: the heatmap rides the status glance view, and a
      // saved blob from when it had its own button must not strand a heated
      // board with no control that turns it off.
      heatmapMode: glanceMode === "status",
      lineHeatMode: flag(parsed.lineHeatMode, DEFAULT_BOARD_VIEW.lineHeatMode),
      freeDockMode: flag(parsed.freeDockMode, DEFAULT_BOARD_VIEW.freeDockMode),
      lineLabelsMode: flag(parsed.lineLabelsMode, DEFAULT_BOARD_VIEW.lineLabelsMode),
      lineThicknessMode: flag(parsed.lineThicknessMode, DEFAULT_BOARD_VIEW.lineThicknessMode),
      linePulseMode: flag(parsed.linePulseMode, DEFAULT_BOARD_VIEW.linePulseMode),
      calmMode: flag(parsed.calmMode, DEFAULT_BOARD_VIEW.calmMode),
      glanceMode,
    };
  } catch {
    // Corrupt or unreadable storage is not worth breaking the board over.
    return DEFAULT_BOARD_VIEW;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Identity is stable between writes, which is what useSyncExternalStore needs
// to avoid an infinite render loop.
function getSnapshot(): BoardView {
  if (!boardViewLoaded) {
    boardViewLoaded = true;
    boardViewState = readBoardView();
  }
  return boardViewState;
}

function getServerSnapshot(): BoardView {
  return DEFAULT_BOARD_VIEW;
}

export function writeBoardView(patch: Partial<BoardView>) {
  boardViewState = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(BOARD_VIEW_STORAGE_KEY, JSON.stringify(boardViewState));
  } catch {
    // A full or blocked storage quota must never break the board.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useBoardView(): BoardView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The same value the hook returns, for callers outside React. */
export function readBoardViewSnapshot(): BoardView {
  return getSnapshot();
}
