/**
 * The board grid.
 *
 * One number governs the whole canvas: the background pattern, the snap step,
 * every card's width and height, and the vertical pitch of the port rows. If a
 * card is a whole number of cells tall and sits on a cell corner, then every
 * one of its ports lands on a grid line too — which is the point. Wires can
 * then run along the same lines the cards are built from.
 *
 * The rules, in order of importance:
 *
 *  1. Node positions are multiples of `BOARD_GRID`.
 *  2. Node widths and heights are multiples of `BOARD_GRID`.
 *  3. A port row is `PORT_ROW_HEIGHT` tall (two cells), and the block above
 *     the rails is a whole number of `HEAD_ROW_HEIGHT` (also two cells), so
 *     port centres land on a grid line: head + 20 + 40i.
 *
 * Rule 3 is why the head, the footer and the config panels have fixed heights
 * rather than sizing to their content. Content that used to set the height now
 * sits inside a box whose height the grid sets.
 */

/** The cell. Everything on the board is a whole number of these. */
export const BOARD_GRID = 20;

/** Snap a scalar to the nearest grid line. */
export function snapToGrid(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/** Snap a board position to the nearest cell corner. */
export function snapPositionToGrid<T extends { x: number; y: number }>(position: T): T {
  return { ...position, x: snapToGrid(position.x), y: snapToGrid(position.y) };
}

/** Grow a measurement to the next whole cell (never shrink — content must fit). */
export function snapSizeUpToGrid(value: number): number {
  return Math.max(BOARD_GRID, Math.ceil(value / BOARD_GRID) * BOARD_GRID);
}

/** `n` cells, in pixels. */
export function cells(n: number): number {
  return n * BOARD_GRID;
}

/* ---------------------------------------------------------------------- */
/* Card geometry — the sizes every node component builds itself out of.    */
/* ---------------------------------------------------------------------- */

/** Every recipe card is this wide. 18 cells. */
export const RECIPE_NODE_WIDTH = cells(18); // 360

/** Card padding either side of the rails (inside the 2px frame). */
export const RECIPE_NODE_PAD_X = 8;

/** Inner width available to the rails: 360 − 2×(2 frame + 8 pad). */
export const RECIPE_RAIL_AREA_WIDTH = RECIPE_NODE_WIDTH - 2 * (2 + RECIPE_NODE_PAD_X); // 340

/** The input chip, and the chip half of an output row. */
export const PORT_CHIP_WIDTH = 140; // 7 cells

/** The `→` divider between the two rails. */
export const RAIL_DIVIDER_WIDTH = 16;

/** Chip + 2px gap + the 34px coupling (`.flow-plug` in globals.css). */
export const OUTPUT_RAIL_WIDTH = PORT_CHIP_WIDTH + 2 + 34; // 176

/** One port row. Two cells, so a rail of any length stays on the grid. */
export const PORT_ROW_HEIGHT = cells(2); // 40

/** The title row, and one row of the machine tab strip. */
export const HEAD_ROW_HEIGHT = cells(2); // 40

/** The stat footer. */
export const FOOTER_HEIGHT = cells(2); // 40

/** One row of a machine-config panel (label over a dropdown). */
export const CONFIG_PANEL_ROW_HEIGHT = cells(3); // 60

/**
 * Drawers and tanks. One cell narrower and one shorter than they used to be:
 * a drawer holds one thing and says one word about it, so it never needed the
 * footprint of a machine card.
 */
export const STORAGE_NODE_WIDTH = cells(6); // 120
export const STORAGE_NODE_HEIGHT = cells(7); // 140

/** Trash cans. */
export const TRASH_NODE_WIDTH = cells(6); // 120
export const TRASH_NODE_HEIGHT = cells(7); // 140

/** Default sizes for the annotation shapes, all whole cells. */
export const ANNOTATION_DEFAULT_BOX = { width: cells(14), height: cells(9) }; // 280×180
export const ANNOTATION_DEFAULT_TEXT = { width: cells(12), height: cells(4) }; // 240×80
export const ANNOTATION_DEFAULT_ARROW = { width: cells(10), height: cells(1) }; // 200×20
export const ANNOTATION_MIN_BOX = cells(2); // 40
export const ANNOTATION_MIN_ARROW = cells(1); // 20
export const ANNOTATION_MIN_TEXT = { width: cells(5), height: cells(2) }; // 100×40
