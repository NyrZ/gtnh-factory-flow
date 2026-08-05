/**
 * Dragging a wire is a MODE, not just a gesture.
 *
 * While a wire is out, the only question on the board is "where does this
 * land", and the board answers it two ways: the green/red wash on every card
 * and the pipe snapping to the slot it will land in. Everything else that
 * normally answers the pointer — edge highlights, edge labels, per-slot hover
 * scopes, the hop map — is a different question, and having it fire under a
 * held wire reads as the board arguing with itself.
 *
 * The flag is read imperatively from inside event handlers rather than
 * subscribed to. A value every node and every edge subscribes to would rebuild
 * the whole board twice per gesture, which is the exact cost ARCHITECTURE.md's
 * hover rules exist to avoid. Purely visual suppression rides on the
 * `factory-flow-board--wiring` class instead, so CSS does that half for free.
 */
let wiringConnection = false;

export function isWiringConnection(): boolean {
  return wiringConnection;
}

export function setWiringConnection(active: boolean): void {
  wiringConnection = active;
}

export const WIRING_BOARD_CLASS = "factory-flow-board--wiring";
