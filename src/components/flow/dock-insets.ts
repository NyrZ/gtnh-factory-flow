/**
 * Where a card's REAL top edge sits below its routed box.
 *
 * The recipe card's machine tabs live in a zone above the painted window but
 * inside the node's box. The router must treat the zone as card — wires keep
 * their one-cell clearance over the tabs — but wires may not DOCK on its
 * phantom top edge: they cross the zone on the drawn stub and land on the
 * window's true edge (GridEndpoint.stubDepth), and side docks simply start
 * below it.
 *
 * Published by RecipeNode from a ResizeObserver on the zone, read lazily by
 * the route solver. A changed zone always changes the card's height too, so
 * the existing geometry invalidation re-solves routes; no listeners needed
 * here. Entries are deliberately never cleared on unmount: React Flow culls
 * off-screen nodes, and routes are viewport-independent — a culled card's
 * wires must keep docking exactly where they did while it was mounted.
 */
const dockTopInsets = new Map<string, number>();

export function publishDockTopInset(nodeId: string, px: number) {
  if (px > 0) {
    dockTopInsets.set(nodeId, px);
  } else {
    dockTopInsets.delete(nodeId);
  }
}

export function getDockTopInset(nodeId: string): number {
  return dockTopInsets.get(nodeId) ?? 0;
}
