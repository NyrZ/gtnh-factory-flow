import type { FactoryProject } from "./types";

/**
 * What a drawer IS. Four jobs that happen to share one card, and they mean
 * such different things that the board draws each as a different shape.
 *
 * Three are read off the WIRING and cannot be chosen:
 *
 * - `source`  nothing feeds it, so it invents its resource. The plan's
 *             declared import, and one of the two cards still allowed to
 *             break conservation.
 * - `buffer`  fed and drawn from, so it is neither end of anything. The only
 *             one of the four that lives INSIDE the system: it passes on what
 *             its takers pull and not one item more, so a producer cannot use
 *             it as a quiet dump.
 * - `idle`    unwired. Barely exists in practice - `pruneOrphanStorages`
 *             sweeps a drawer the moment its last wire goes - but a drawer
 *             mid-drag has to be called something.
 *
 * The fourth is a CHOICE, and it only exists once nothing draws from the
 * drawer (see StorageDrainMode):
 *
 * - `product`    pulls its feeder flat out. The thing the factory is for.
 * - `byproduct`  asks for nothing and catches what is left over.
 *
 * That last pair is the difference between "make as much of this as you can"
 * and "the extra has to go somewhere", which is the difference between a
 * product and a byproduct in every real base.
 */
export type StorageRole = "source" | "buffer" | "product" | "byproduct" | "idle";

/** The three that sit ON the boundary rather than inside it. */
export function isBoundaryRole(role: StorageRole): boolean {
  return role === "source" || role === "product" || role === "byproduct";
}

/** The two ends of a drain: both accept freely, only one of them asks. */
export function isDrainRole(role: StorageRole): boolean {
  return role === "product" || role === "byproduct";
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
      fed
        ? drawn
          ? "buffer"
          : storage.drainMode === "byproduct"
            ? "byproduct"
            : "product"
        : drawn
          ? "source"
          : "idle",
    );
  }
  return roles;
}

/**
 * A drawer's name as the rest of the UI should say it: the item, then which
 * of the four jobs it is doing.
 *
 * Everything used to append a flat "(buffer)", which is now wrong three times
 * out of four - a SOURCE is the opposite of a buffer, and calling it one in a
 * tooltip teaches the reader the wrong word for the thing they are about to
 * go and look at.
 */
export function describeStorage(
  storage: { displayName?: string; resourceId: string },
  role: StorageRole | undefined,
): string {
  const name = storage.displayName ?? storage.resourceId;
  return role && role !== "idle" ? `${name} (${role})` : name;
}

/** One drawer's role. Prefer `getStorageRoles` when asking about several. */
export function getStorageRole(project: FactoryProject, storageId: string): StorageRole {
  return getStorageRoles(project).get(storageId) ?? "idle";
}
