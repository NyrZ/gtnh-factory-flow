"use client";

import { useEffect, useRef } from "react";

/**
 * Phase-locks a CSS animation to the document's timeline.
 *
 * A CSS animation's clock starts when the animation is applied to the element,
 * not when the page loads. So two cards showing the same 2.6s pulse breathe
 * together only if they happened to mount on the same frame — and on a board
 * they never do. Cards mount as they scroll into view, re-mount when React
 * Flow recycles them, and join a ring the moment the solver's answer changes.
 * The result was a ring where half the machines were bright while the other
 * half were dark, which reads as broken rather than as one shape.
 *
 * `startTime = 0` pins the animation to the origin of the document timeline,
 * which every element on the page shares. Set it on every mark in a ring and
 * they are all at the same point of the same cycle, whenever each one arrived.
 *
 * The cost is one property write per element per mount. There is no per-frame
 * work here at all, and no shared clock to keep — the timeline IS the clock.
 */
export function useSharedAnimationPhase<T extends Element>(
  active: boolean,
  /**
   * The `@keyframes` name to pin. Required, not optional: `subtree` sweeps up
   * every animation under the element, and silently re-timing an unrelated one
   * (a spinner, a transition someone adds later) would be a bug nobody would
   * think to look for here.
   */
  animationName: string,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    // One frame's grace: the animation does not exist on the element until
    // styles have been applied, and an effect can run before that. Without the
    // wait getAnimations() returns nothing and the element stays adrift.
    const frame = requestAnimationFrame(() => {
      const element = ref.current;
      if (!element?.getAnimations) {
        return;
      }
      // `subtree` because the glow is painted by a ::after, and a pseudo
      // element's animation is not on the element's own list.
      for (const animation of element.getAnimations({ subtree: true })) {
        if ((animation as Animation & { animationName?: string }).animationName !== animationName) {
          continue;
        }
        try {
          animation.startTime = 0;
        } catch {
          // A timeline that refuses the write is not worth a broken board;
          // the mark still shows, it just keeps its own phase.
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, animationName]);

  return ref;
}
