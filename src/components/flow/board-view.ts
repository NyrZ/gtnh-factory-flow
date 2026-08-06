"use client";

import { useSyncExternalStore } from "react";

/**
 * Board view preferences: how the canvas looks, whether drags snap, and which
 * of the read-only display modes are on.
 *
 * These are personal taste, not part of the plan — a design shared with
 * someone else must not carry your grid setting or arrive with the heatmap
 * switched on. So they live in localStorage rather than in the project, and
 * outside the Zustand store so they can be read straight out of localStorage
 * without an effect.
 *
 * Read through useSyncExternalStore: localStorage does not exist during SSR,
 * so the server renders the defaults and the browser swaps in the saved values
 * on hydration. That is the one shape that neither mismatches the server HTML
 * nor sets state from inside an effect.
 */
export type CanvasPattern = "dots" | "lines" | "cross" | "none";

export const CANVAS_PATTERNS: CanvasPattern[] = ["dots", "lines", "cross", "none"];

export interface BoardView {
  // No `snapToGrid`. Snapping was a preference back when cards were sized by
  // their contents; now they are sized in grid cells, so it is a fact.
  canvasPattern: CanvasPattern;
  /** Machines take their colour from how hard they run. */
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
    return {
      canvasPattern: CANVAS_PATTERNS.includes(parsed.canvasPattern as CanvasPattern)
        ? (parsed.canvasPattern as CanvasPattern)
        : DEFAULT_BOARD_VIEW.canvasPattern,
      heatmapMode: flag(parsed.heatmapMode, DEFAULT_BOARD_VIEW.heatmapMode),
      lineHeatMode: flag(parsed.lineHeatMode, DEFAULT_BOARD_VIEW.lineHeatMode),
      freeDockMode: flag(parsed.freeDockMode, DEFAULT_BOARD_VIEW.freeDockMode),
      lineLabelsMode: flag(parsed.lineLabelsMode, DEFAULT_BOARD_VIEW.lineLabelsMode),
      lineThicknessMode: flag(parsed.lineThicknessMode, DEFAULT_BOARD_VIEW.lineThicknessMode),
      linePulseMode: flag(parsed.linePulseMode, DEFAULT_BOARD_VIEW.linePulseMode),
      calmMode: flag(parsed.calmMode, DEFAULT_BOARD_VIEW.calmMode),
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
