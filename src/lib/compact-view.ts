"use client";

import { useSyncExternalStore } from "react";

/**
 * Compact mode: one column instead of three.
 *
 * Below this width the board cannot share the window with both side columns —
 * 344 + 332 leaves a phone nothing — so in compact mode the columns become
 * drawers that slide over the board, the top bar folds into one menu, and each
 * board toolbar folds into one button.
 *
 * `globals.css` defines a Tailwind `compact:` variant on the same number for the
 * style-only half of the switch (heights, min-heights, font sizes). The two must
 * stay in step; change one, change the other.
 */
export const COMPACT_MAX_WIDTH = 900;

/**
 * A short window is compact too, whatever its width.
 *
 * A phone held sideways is 932x430 on the newest iPhones — wide enough to clear
 * the width test and nowhere near tall enough for a 720px-tall app. It used to
 * get the desktop layout, whose minimum heights then pushed the board's bottom
 * corners off the screen.
 */
export const COMPACT_MAX_HEIGHT = 560;

/**
 * `max-width` rather than the `(width < 900px)` range form: the range syntax
 * needs a 2022-or-later browser, and this decides the whole layout. The 0.02
 * keeps a fractional window width (899.5px, which happens on scaled displays)
 * from landing between this query and its `min-width` complement.
 *
 * The comma is an OR: either measurement being short is enough.
 */
const COMPACT_MEDIA_QUERY = `(max-width: ${COMPACT_MAX_WIDTH - 0.02}px), (max-height: ${
  COMPACT_MAX_HEIGHT - 0.02
}px)`;

let mediaQuery: MediaQueryList | undefined;

function getMediaQuery(): MediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  mediaQuery ??= window.matchMedia(COMPACT_MEDIA_QUERY);
  return mediaQuery;
}

/**
 * Whether the window is compact right now, for callers outside React.
 *
 * A media query, not `window.innerWidth`: a mobile browser widens the layout
 * viewport when content overflows it, so `innerWidth` on a 390px phone can
 * report 935 and answer this question backwards. Media queries are evaluated
 * against the initial containing block, which is the number that matters.
 */
export function isCompactViewport(): boolean {
  return getMediaQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const query = getMediaQuery();
  if (!query) {
    return () => {};
  }

  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Re-renders when the window crosses the compact threshold.
 *
 * The server has no width to measure, so it renders the full three-column
 * layout and the client corrects on the first paint — the same deal the
 * workspace and board view settings make.
 */
export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, isCompactViewport, getServerSnapshot);
}
