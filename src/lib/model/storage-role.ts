import type { FactoryProject } from "./types";

/**
 * What a drawer IS, read from its wiring alone.
 *
 * This is the plan's boundary declaration. A closed board only exchanges with
 * the outside world through the two ends of this list, and everything between
 * them has to balance:
 *
 * - `source`  nothing feeds it, so it invents its resource. The RESERVOIR:
 *             the declared import, and the one card on the board still
 *             allowed to break conservation.
 * - `drain`   nothing draws from it, so it swallows whatever arrives. The
 *             declared export, and the only place a machine may put a surplus
 *             nobody wants.
 * - `buffer`  fed and drawn from, so it is neither end of anything. It plays
 *             by the full rule book: it passes on what its consumers pull and
 *             not one item more, which means a producer cannot use it as a
 *             quiet dump the way it can use a drain.
 * - `idle`    unwired, so it does nothing at all.
 *
 * The distinction is load-bearing in the solver (`equilibrium.ts` lets only
 * drains and trash cans absorb a leftover) and it is what the drawer card
 * puts in its header, so a reader can see where a plan is leaning on the
 * outside world without tracing a single wire.
 */
export type StorageRole = "source" | "drain" | "buffer" | "idle";

/** The two roles that sit ON the system boundary rather than inside it. */
export function isBoundaryRole(role: StorageRole): boolean {
  return role === "source" || role === "drain";
}

/**
 * Every drawer's role in one pass over the edges.
 *
 * Built whole rather than per-drawer because both callers (the solver's edge
 * preparation and the board's cards) need most of the map at once, and the
 * per-drawer version would have been O(storages x edges) on the hot path.
 */
export function getStorageRoles(project: FactoryProject): Map<string, StorageRole> {
  const roles = new Map<string, StorageRole>();
  const storages = project.storages ?? [];
  if (storages.length === 0) {
    return roles;
  }

  const hasIn = new Set<string>();
  const hasOut = new Set<string>();
  const ids = new Set(storages.map((storage) => storage.id));
  for (const edge of project.edges) {
    if (ids.has(edge.target)) {
      hasIn.add(edge.target);
    }
    if (ids.has(edge.source)) {
      hasOut.add(edge.source);
    }
  }

  for (const storage of storages) {
    const fed = hasIn.has(storage.id);
    const drawn = hasOut.has(storage.id);
    roles.set(
      storage.id,
      fed ? (drawn ? "buffer" : "drain") : drawn ? "source" : "idle",
    );
  }
  return roles;
}

/** One drawer's role. Prefer `getStorageRoles` when asking about several. */
export function getStorageRole(project: FactoryProject, storageId: string): StorageRole {
  return getStorageRoles(project).get(storageId) ?? "idle";
}
