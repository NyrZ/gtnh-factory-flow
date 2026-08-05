import { NODE_BLOCK_ENTER_ZOOM } from "./node-detail";

/**
 * Zoom-derived edge detail, encoded as a bitmask.
 *
 * Zoom only ever feeds a few boolean thresholds, but edges used to subscribe to
 * the raw `transform[2]` scalar — which meant every visible edge re-rendered on
 * every frame of a zoom gesture, and each of those re-renders re-ran the route
 * solver. Selecting this mask instead means edges re-render only when a threshold
 * is actually crossed.
 */

/**
 * Below this zoom the rate chips stop being drawn.
 *
 * They used to fade out below ~0.7, which was wrong: a legend that disappears
 * while you can still read it reads as the board breaking, and the rates are
 * the main thing a plan is FOR. So this went to 0 and they stayed on at every
 * zoom.
 *
 * That is right up to the point where the chip is a few pixels tall and its
 * number cannot be read by anyone. Past there it is not a legend any more, it
 * is 600-odd bordered, inset-shadowed boxes with a sprite in each, and they are
 * the single most expensive thing left on a big board — measured on a 300-node
 * plan, dropping them takes panning from 22 to 59fps and an idle board from 46
 * to 81. The threshold is set where the digits stop being legible, not where
 * they get small, so nothing you could actually have read goes away.
 *
 * TUNING: raise it to drop the chips sooner (faster, less readable when zoomed
 * out), lower it to keep them longer. Setting it back to 0 restores the
 * always-on behaviour exactly.
 */
export const EDGE_LABEL_ZOOM = NODE_BLOCK_ENTER_ZOOM;
/**
 * Arrowheads and the marching dashes stop at the same place the chips do.
 *
 * Two polylines and a dashed stroke per line is cheap on one edge and is not
 * cheap on six hundred, and at this size an arrowhead is a smudge and the
 * dashes are a shimmer. The board zoomed out is a map: shapes, colour, and
 * which way things run — which the routes themselves already say.
 */
export const EDGE_ARROW_ZOOM = NODE_BLOCK_ENTER_ZOOM;
export const EDGE_PULSE_ZOOM = NODE_BLOCK_ENTER_ZOOM;
export const EDGE_GLOBAL_ZOOM = 0.45;

export const EDGE_DETAIL_GLOBAL = 1;
export const EDGE_DETAIL_ARROWS = 2;
export const EDGE_DETAIL_LABELS = 4;
export const EDGE_DETAIL_PULSE = 8;

export function getEdgeDetailLevel(zoom: number) {
  return (
    (zoom < EDGE_GLOBAL_ZOOM ? EDGE_DETAIL_GLOBAL : 0) |
    (zoom >= EDGE_ARROW_ZOOM ? EDGE_DETAIL_ARROWS : 0) |
    (zoom >= EDGE_LABEL_ZOOM ? EDGE_DETAIL_LABELS : 0) |
    (zoom >= EDGE_PULSE_ZOOM ? EDGE_DETAIL_PULSE : 0)
  );
}

export function hasEdgeDetail(detailLevel: number, flag: number) {
  return (detailLevel & flag) !== 0;
}

/**
 * Returns the cached object when every field still points at the same value.
 *
 * React Flow node `data` is rebuilt whenever anything on the board changes —
 * a hover, a solver run — and a fresh object identity defeats the `memo` on the
 * node components, re-rendering every node for a change affecting one. Handing
 * back the previous object when nothing in it moved keeps those memos effective.
 *
 * The result is always derived purely from `next`, so returning either identity
 * is equally correct; only the reference differs.
 */
export function reuseObjectIdentity<T extends Record<string, unknown>>(
  cache: Map<string, T>,
  id: string,
  next: T,
): T {
  const previous = cache.get(id);
  if (previous) {
    const keys = Object.keys(next);
    if (
      keys.length === Object.keys(previous).length &&
      keys.every((key) => previous[key] === next[key])
    ) {
      return previous;
    }
  }

  cache.set(id, next);
  return next;
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => deepEquals(entry, right[index]))
    );
  }

  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null ||
    Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)
  ) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      deepEquals((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}

/**
 * `reuseObjectIdentity` for objects whose fields are themselves rebuilt every
 * pass. Edge objects nest fresh `data`/`style`/`resource` objects on each
 * rebuild, so shallow comparison never matches; structural equality is what
 * decides whether the previous identity can stand in. Same purity argument as
 * above: both identities carry equal values, only the reference differs.
 */
export function reuseDeepObjectIdentity<T extends Record<string, unknown>>(
  cache: Map<string, T>,
  id: string,
  next: T,
): T {
  const previous = cache.get(id);
  if (previous && deepEquals(previous, next)) {
    return previous;
  }

  cache.set(id, next);
  return next;
}
