/**
 * How much of a node is worth drawing at the current zoom.
 *
 * Zoomed out, a card's contents are noise: the slot sprites are sub-pixel, the
 * dials are a grey smear, and the machine name is three pixels tall. The board
 * still pays full price for them — a 300-node plan puts ~29,000 elements and
 * ~2,250 sprites on screen, and everything that uncovers new pixels (pan, zoom,
 * a node moving) has to rasterise them.
 *
 * So there is ONE step, and it is all-or-nothing: either the node is drawn, or
 * it is reduced to the single fact that still means something at that size —
 * how hard a machine is running, or what is in a drawer. A middle step that
 * dropped "just the dials" was worse than either end: parts of a card vanished
 * while the rest stayed, which reads as the board glitching rather than as a
 * deliberate zoom level.
 *
 * TUNING: the two numbers below are the whole control surface. They are a pair
 * rather than one threshold because a single boundary flickers — a board parked
 * exactly on it flips detail on and off with every sub-pixel of zoom drift. The
 * gap between them is the dead zone that stops that.
 *
 * Nothing here may change a node's SIZE. Detail is dropped with `visibility`,
 * never `display`, so every element keeps its layout box: the router measures
 * node bounds and slot anchors through those boxes, and a card that changed
 * shape with zoom would reroute the board every time you scrolled the wheel —
 * exactly the viewport-dependent routing ARCHITECTURE.md forbids.
 */

export const NODE_DETAIL_FULL = 0;
export const NODE_DETAIL_GLANCE = 1;

export type NodeDetailLevel = typeof NODE_DETAIL_FULL | typeof NODE_DETAIL_GLANCE;

/** Below this a node drops to its glance figure. */
export const NODE_GLANCE_ENTER_ZOOM = 0.55;
/** And above this it comes back. The gap is the anti-flicker dead zone. */
export const NODE_GLANCE_LEAVE_ZOOM = 0.62;

/**
 * The level for this zoom, given the level currently in force.
 *
 * Passing the current level is what makes the threshold hysteretic: the step is
 * only entered below `ENTER` and only left above `LEAVE`, so zoom noise around
 * the boundary cannot make the board strobe.
 */
export function getNodeDetailLevel(zoom: number, current: NodeDetailLevel): NodeDetailLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return current;
  }
  if (zoom < NODE_GLANCE_ENTER_ZOOM) {
    return NODE_DETAIL_GLANCE;
  }
  if (zoom >= NODE_GLANCE_LEAVE_ZOOM) {
    return NODE_DETAIL_FULL;
  }
  return current;
}

/** Board-root class for a level; the CSS in globals.css hangs off this. */
export function nodeDetailClass(level: NodeDetailLevel): string {
  return level === NODE_DETAIL_GLANCE ? "factory-flow-board--detail-glance" : "";
}

export const NODE_DETAIL_CLASSES = ["factory-flow-board--detail-glance"];
