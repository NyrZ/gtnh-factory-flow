/**
 * Handing a drawer-opening swipe from the board to the drawer.
 *
 * The gesture starts on the board — anywhere down its left or right side, which
 * is where a thumb naturally lands — but the thing that has to follow the finger
 * is the drawer, and the two live in different halves of the tree with the board
 * between them. So each drawer leaves its pull handlers here and the board's touch
 * layer drives them: one small registry rather than threading three callbacks
 * through the whole workspace.
 *
 * At most one drawer per side and one finger at a time, which is why a plain map
 * is enough.
 */

export type PanelSide = "left" | "right";

export interface PanelPull {
  /** The finger has claimed this drawer: mount it at the closed position. */
  start: () => void;
  /** How far the finger has travelled inwards, in px. */
  move: (travelled: number) => void;
  /** Let go: land it open or closed, whichever it was closer to. */
  end: (travelled: number) => void;
}

const pulls = new Map<PanelSide, PanelPull>();

export function registerPanelPull(side: PanelSide, pull: PanelPull): () => void {
  pulls.set(side, pull);
  return () => {
    if (pulls.get(side) === pull) {
      pulls.delete(side);
    }
  };
}

export function getPanelPull(side: PanelSide): PanelPull | undefined {
  return pulls.get(side);
}
