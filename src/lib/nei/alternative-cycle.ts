import type { ResourceAmount } from "@/lib/model/types";
import { isVirtualChoiceResource } from "@/lib/model/resources";

/** How long each face of a cycling slot is shown, matching NEI's own rotation. */
export const ALTERNATIVE_CYCLE_INTERVAL_MS = 1500;

/**
 * A single face of a cycling slot: one concrete item an oredict input accepts.
 *
 * `amount` is NOT a stack size. Alternatives carry target-units-per-source-unit
 * (1000 on a cell's fluid, 1 on an ordinary oredict member), so it must never be
 * spread over a recipe input's real amount. See `crossKindInputOverrideAmount`.
 */
export type AlternativeCycleFace = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip" | "modId"
> &
  Partial<Pick<ResourceAmount, "amount">>;

type CycleResource = Pick<
  ResourceAmount,
  | "kind"
  | "id"
  | "displayName"
  | "iconPath"
  | "iconAtlas"
  | "dominantColor"
  | "tooltip"
  | "modId"
  | "alternatives"
>;

/**
 * ONE interval for the whole app, not one per slot.
 *
 * The recipe browser mounts these by the hundred. A timer and a piece of React
 * state per slot would mean hundreds of independent re-render storms; instead
 * every cycling slot derives its face from this single counter, so the cost is
 * one timer plus a re-render of only the slots that actually have alternatives.
 * The interval exists only while something is subscribed, so closing the browser
 * stops the clock rather than leaving it ticking behind a closed panel.
 */
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function startClock() {
  if (timer !== undefined || listeners.size === 0) {
    return;
  }
  // An icon that flips forever is exactly what this setting is for. The slot
  // still rotates on demand through hover and scroll, it just never moves on
  // its own.
  if (prefersReducedMotion()) {
    return;
  }
  timer = setInterval(() => {
    tick += 1;
    for (const listener of [...listeners]) {
      listener();
    }
  }, ALTERNATIVE_CYCLE_INTERVAL_MS);
}

function stopClock() {
  if (timer === undefined || listeners.size > 0) {
    return;
  }
  clearInterval(timer);
  timer = undefined;
}

export function subscribeToAlternativeCycle(listener: () => void): () => void {
  listeners.add(listener);
  startClock();
  return () => {
    listeners.delete(listener);
    stopClock();
  };
}

export function getAlternativeCycleTick(): number {
  return tick;
}

/** Server render has no clock, so every slot starts on its first face. */
export function getServerAlternativeCycleTick(): number {
  return 0;
}

/** Test seam: drops the clock and every subscriber. */
export function resetAlternativeCycleForTests() {
  listeners.clear();
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  tick = 0;
}

/** Test seam: advances the clock without waiting on real time. */
export function advanceAlternativeCycleForTests(steps = 1) {
  tick += steps;
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * The faces a slot rotates through, or an empty list when it does not rotate.
 *
 * Cross-kind alternatives are excluded deliberately: a filled cell and its fluid
 * are the same substance counted two ways, not a choice a player makes, and
 * flipping a slot between an item and a fluid would read as a different recipe.
 * This is the same filter that decides whether the slot shows its `+` marker.
 */
export function getAlternativeCycleFaces(resource: CycleResource): AlternativeCycleFace[] {
  const sameKind = (resource.alternatives ?? []).filter(
    (alternative) =>
      alternative.kind === resource.kind &&
      // One placeholder must never be a face of another: an ore dictionary
      // group lists "Any LV Circuit" beside the real circuits, and rotating
      // onto it would show a stand-in where an item should be.
      !isVirtualChoiceResource(alternative),
  );
  if (sameKind.length === 0) {
    return [];
  }

  // A placeholder is never a real item you could hold, so it is not one of its
  // own faces: NEI shows only the concrete members. This covers ore dictionary
  // entries and GTNH's "Any LV Circuit" style stand-ins alike. A concrete
  // resource that merely has substitutes stays in its own rotation.
  const faces = isVirtualChoiceResource(resource)
    ? sameKind
    : [
        {
          kind: resource.kind,
          id: resource.id,
          displayName: resource.displayName,
          iconPath: resource.iconPath,
          iconAtlas: resource.iconAtlas,
          dominantColor: resource.dominantColor,
          tooltip: resource.tooltip,
          modId: resource.modId,
        },
        ...sameKind,
      ];

  // A placeholder with a single member still returns it: the stand-in has no
  // art of its own, so painting that one member is the only way the slot shows
  // anything at all. Callers rotate only when there is more than one.
  return faces;
}

/**
 * Repaints a resource as one of its faces.
 *
 * `alternatives` is kept so the slot still advertises the full list in its
 * tooltip and still shows its marker while cycling.
 */
export function applyAlternativeCycleFace<T extends CycleResource>(
  resource: T,
  face: AlternativeCycleFace,
): T {
  // Icon path and atlas are one decision, not two. Taking the face's path but
  // falling back to the oredict's atlas would paint one item's name over
  // another's picture.
  const faceHasIcon = face.iconPath !== undefined || face.iconAtlas !== undefined;

  return {
    ...resource,
    kind: face.kind,
    id: face.id,
    displayName: face.displayName ?? resource.displayName,
    iconPath: faceHasIcon ? face.iconPath : resource.iconPath,
    iconAtlas: faceHasIcon ? face.iconAtlas : resource.iconAtlas,
    dominantColor: face.dominantColor ?? resource.dominantColor,
    tooltip: face.tooltip ?? resource.tooltip,
    modId: face.modId ?? resource.modId,
  };
}
