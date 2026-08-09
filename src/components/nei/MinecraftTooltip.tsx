"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isTouchPointer } from "@/lib/pointer-kind";

/**
 * Marks an element that turns the wheel into its own state change rather than
 * scrolling: it stays put, so a tooltip over it stays too.
 */
export const WHEEL_STEPS_IN_PLACE_ATTRIBUTE = "data-tooltip-wheel-steps";


export function MinecraftTooltip({
  label,
  content,
  children,
}: {
  label?: string | string[];
  /** Rich panel body; wins over `label` and brings its own typography. */
  content?: ReactNode;
  children: ReactNode;
}) {
  const lines = useMemo(
    () => (Array.isArray(label) ? label : label ? label.split("\n") : []),
    [label],
  );
  const hasContent = content !== undefined && content !== null;
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>();
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const handleMouseMove = (event: MouseEvent) => {
    if (lines.length === 0 && !hasContent) {
      return;
    }

    // A finger has no hover to answer, and no way to stop hovering.
    if (isTouchPointer()) {
      clearTooltip();
      return;
    }

    // Tooltips nest: a row-wide reveal can hold buttons with their own
    // tips. Whoever is CLOSEST to the pointer owns it — an outer tooltip
    // yields (and hides) over any inner tooltip region or anything marked
    // data-tooltip-stop (tag chips, editors).
    const owner = (event.target as HTMLElement | null)?.closest(
      "[data-tooltip-root], [data-tooltip-stop]",
    );
    if (owner && owner !== rootRef.current) {
      clearTooltip();
      return;
    }

    if (event.buttons !== 0) {
      pendingPositionRef.current = undefined;
      if (position !== undefined) {
        setPosition(undefined);
      }
      return;
    }

    // Clamp to the measured panel so wide or tall tooltips stay fully on
    // screen; before the first paint we fall back to a generous estimate.
    const panelWidth = panelRef.current?.offsetWidth ?? (hasContent ? 340 : 260);
    const panelHeight = panelRef.current?.offsetHeight ?? (hasContent ? 240 : 80);
    pendingPositionRef.current = {
      x: Math.max(4, Math.min(event.clientX + 12, window.innerWidth - panelWidth - 8)),
      y: Math.max(4, Math.min(event.clientY + 12, window.innerHeight - panelHeight - 8)),
    };

    if (frameRef.current !== undefined) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      const nextPosition = pendingPositionRef.current;
      if (!nextPosition) {
        return;
      }

      setPosition((currentPosition) =>
        currentPosition &&
        Math.abs(currentPosition.x - nextPosition.x) < 2 &&
        Math.abs(currentPosition.y - nextPosition.y) < 2
          ? currentPosition
          : nextPosition,
      );
    });
  };

  const clearTooltip = useCallback(() => {
    pendingPositionRef.current = undefined;
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (position !== undefined) {
      setPosition(undefined);
    }
  }, [position]);

  useEffect(() => {
    if (!position) {
      return undefined;
    }

    const clearOnInteraction = () => clearTooltip();
    // A wheel normally scrolls the thing out from under the pointer, so the tip
    // has to go with it. A slot that rotates through what it accepts is the
    // exception: it EATS the wheel to step through its items and never moves, so
    // clearing there made the tip blink out on every notch, exactly while you
    // were reading which item you had landed on. Marked slots keep theirs, and
    // it re-labels itself as the slot steps.
    const clearOnWheel = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(`[${WHEEL_STEPS_IN_PLACE_ATTRIBUTE}]`) &&
        rootRef.current?.contains(target)
      ) {
        return;
      }
      clearTooltip();
    };
    const options = { capture: true, passive: true } as const;

    window.addEventListener("wheel", clearOnWheel, options);
    window.addEventListener("pointerdown", clearOnInteraction, options);
    window.addEventListener("pointercancel", clearOnInteraction, options);
    window.addEventListener("resize", clearOnInteraction, options);
    window.addEventListener("blur", clearOnInteraction, options);
    return () => {
      window.removeEventListener("wheel", clearOnWheel, options);
      window.removeEventListener("pointerdown", clearOnInteraction, options);
      window.removeEventListener("pointercancel", clearOnInteraction, options);
      window.removeEventListener("resize", clearOnInteraction, options);
      window.removeEventListener("blur", clearOnInteraction, options);
    };
  }, [clearTooltip, position]);

  return (
    <span
      ref={rootRef}
      data-tooltip-root=""
      className="contents"
      onMouseEnter={handleMouseMove}
      onMouseMove={handleMouseMove}
      onMouseLeave={clearTooltip}
    >
      {children}
      {position && (lines.length > 0 || hasContent) && typeof document !== "undefined"
        ? createPortal(
            hasContent ? (
              <div
                ref={panelRef}
                data-minecraft-tooltip="true"
                className="pointer-events-none fixed z-[9999] max-w-[640px] border-2 border-[#2a005f] bg-[#100010] px-3 py-2.5 text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.8)]"
                style={{ left: position.x, top: position.y }}
              >
                {content}
              </div>
            ) : (
              <div
                ref={panelRef}
                data-minecraft-tooltip="true"
                className="pointer-events-none fixed z-[9999] max-w-[340px] border-2 border-[#2a005f] bg-[#100010] px-2 py-1 font-mono text-[16px] leading-[19px] text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.8)] [text-shadow:2px_2px_0_#3f3f3f]"
                style={{ left: position.x, top: position.y }}
              >
                {lines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className={index === 0 ? "text-white" : "text-[#aaaaff]"}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ),
            document.body,
          )
        : null}
    </span>
  );
}
