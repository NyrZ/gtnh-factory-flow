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
const dockTopInsets = new Map<string, { inset: number; tabsRight: number }>();

export function publishDockTopInset(nodeId: string, insetPx: number, tabsRightPx = 0) {
  if (insetPx > 0) {
    dockTopInsets.set(nodeId, { inset: insetPx, tabsRight: tabsRightPx });
  } else {
    dockTopInsets.delete(nodeId);
  }
}

export function getDockTopInset(nodeId: string): number {
  return dockTopInsets.get(nodeId)?.inset ?? 0;
}

/**
 * How far right of the card's left edge the tab ART reaches, in px. A
 * top-dock stub descends straight through the zone at its dock's x, so docks
 * left of this line would draw the wire (and its dashes) across a tab; the
 * candidate builder simply refuses them. Zero when the zone is empty.
 */
export function getDockTabsRight(nodeId: string): number {
  return dockTopInsets.get(nodeId)?.tabsRight ?? 0;
}
