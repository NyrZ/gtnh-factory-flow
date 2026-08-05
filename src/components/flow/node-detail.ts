/**
 * How much of a machine card is worth drawing at the current zoom.
 *
 * Zoomed out, a card is a few dozen pixels tall: the slot sprites are smaller
 * than a glyph, the stat row is a grey smear, and the rate on a port cannot be
 * read at all. The board still pays full price for them — a 300-node plan puts
 * ~29,000 elements and ~2,250 sprites on screen, and everything that uncovers
 * new pixels (pan, zoom, a node moving) has to rasterise them.
 *
 * So detail is dropped in two steps as the board shrinks. What is kept at each
 * step is chosen by what you can still USE at that size:
 *
 *  - full   everything.
 *  - coarse the card, its paint colour, its title and its ports. The footer
 *           dials and the machine tab strip go: they are controls, and at this
 *           size they are neither readable nor clickable.
 *  - block  the card, its paint colour and its title. Ports go too — at this
 *           zoom the plan reads as shapes and wires, which is what it is for.
 *
 * TUNING: the four numbers below are the whole control surface. They are
 * deliberately paired (an `enter` and a `leave` per step) rather than being one
 * threshold each, because a single boundary flickers: a board parked exactly on
 * it flips detail on and off with every sub-pixel of zoom drift. The gap
 * between the pair is the dead zone that stops that.
 *
 * Nothing here may change a node's SIZE. Detail is dropped with `visibility`,
 * never `display`, so every element keeps its layout box: the router measures
 * node bounds and slot anchors through those boxes, and a card that changed
 * shape with zoom would reroute the board every time you scrolled the wheel —
 * exactly the viewport-dependent routing ARCHITECTURE.md forbids.
 */

export const NODE_DETAIL_FULL = 0;
export const NODE_DETAIL_COARSE = 1;
export const NODE_DETAIL_BLOCK = 2;

export type NodeDetailLevel =
  | typeof NODE_DETAIL_FULL
  | typeof NODE_DETAIL_COARSE
  | typeof NODE_DETAIL_BLOCK;

/** Below this the footer dials and machine strip stop being drawn. */
export const NODE_COARSE_ENTER_ZOOM = 0.85;
/** And above this they come back. The gap is the anti-flicker dead zone. */
export const NODE_COARSE_LEAVE_ZOOM = 0.92;
/** Below this the card drops to its glance figure alone. */
export const NODE_BLOCK_ENTER_ZOOM = 0.55;
export const NODE_BLOCK_LEAVE_ZOOM = 0.62;

/**
 * The level for this zoom, given the level currently in force.
 *
 * Passing the current level is what makes the thresholds hysteretic: a step is
 * only entered below its `enter` zoom and only left above its `leave` zoom, so
 * zoom noise around a boundary cannot make the board strobe.
 */
export function getNodeDetailLevel(zoom: number, current: NodeDetailLevel): NodeDetailLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return current;
  }

  if (zoom < NODE_BLOCK_ENTER_ZOOM) {
    return NODE_DETAIL_BLOCK;
  }
  if (zoom < NODE_COARSE_ENTER_ZOOM) {
    // Already coarser than coarse? Only a zoom past the block step's own
    // `leave` releases it.
    return current === NODE_DETAIL_BLOCK && zoom < NODE_BLOCK_LEAVE_ZOOM
      ? NODE_DETAIL_BLOCK
      : NODE_DETAIL_COARSE;
  }
  if (zoom < NODE_COARSE_LEAVE_ZOOM) {
    return current === NODE_DETAIL_FULL ? NODE_DETAIL_FULL : NODE_DETAIL_COARSE;
  }
  return NODE_DETAIL_FULL;
}

/** Board-root class for a level; the CSS in globals.css hangs off these. */
export function nodeDetailClass(level: NodeDetailLevel): string {
  switch (level) {
    case NODE_DETAIL_BLOCK:
      return "factory-flow-board--detail-block";
    case NODE_DETAIL_COARSE:
      return "factory-flow-board--detail-coarse";
    default:
      return "";
  }
}

export const NODE_DETAIL_CLASSES = [
  "factory-flow-board--detail-coarse",
  "factory-flow-board--detail-block",
];
