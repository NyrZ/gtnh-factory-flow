"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { findLesson, type TourLesson, type TourSide, type TourStep } from "@/lib/tour/lessons";
import { GLANCE_ACCENT, GLANCE_LINE, GlanceRows, GlanceTitle } from "./card-parts";
import {
  endLesson,
  finishLesson,
  goToStep,
  nextStep,
  previousStep,
  useTourState,
} from "@/lib/tour/tour-state";

/**
 * The guided tour, drawn over the live app.
 *
 * One dimmed sheet with a hole cut in it around whatever the current step
 * points at, and a card beside the hole saying what that is. Both glide from
 * one step to the next, so a lesson reads as one thing moving rather than
 * eleven overlays in a row.
 *
 * The dimming is the SPOTLIGHT's own enormous box-shadow rather than a separate
 * scrim: one element, no mask to composite, and the move between steps is a
 * plain animation of four numbers. A shadow cannot be clicked, though, so a
 * transparent blocker sits underneath to keep the pointer off the board while a
 * lesson runs. That is what lets a step say "this button does X" without anyone
 * pressing it halfway through the sentence.
 *
 * Anchors are measured every frame while a step is up. A step can open a
 * column, the column slides, the toolbars inside it reflow, and the hole has to
 * land where the thing ended up rather than where it was when the step began.
 * One rect per frame, only while a tour is running, and state is written only
 * when the numbers actually move.
 */

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Ring around the target, card to ring, card to the edge of the window. */
const RING_PAD = 6;
const CARD_GAP = 18;
const EDGE_MARGIN = 12;
const CARD_WIDTH = 560;
const ARROW = 10;

const ACCENT = GLANCE_ACCENT;
const LINE = GLANCE_LINE;

/** On show, not merely present: `visibility` and `opacity` both count. */
function isVisible(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  const style = window.getComputedStyle(element);
  return style.visibility === "visible" && style.opacity !== "0";
}

function measureSelector(selector: string): Rect | undefined {
  const elements = document.querySelectorAll<HTMLElement>(selector);

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  // Several elements may share one id; their rects union, the way the help
  // sheet rings a toolbar split around a folded-away palette. Anything not
  // actually on show is left out: a folded compact toolbar keeps its row in the
  // DOM, laid out and hidden, and ringing that is a ring around empty board.
  elements.forEach((element) => {
    if (!isVisible(element)) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  });

  if (left === Number.POSITIVE_INFINITY) {
    return undefined;
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * What a step is pointing at, as one selector.
 *
 * The tour's own anchors win, and the hover help sheet's are the fallback: it
 * already marks every toolbar and column, so most steps need no markup at all.
 * A step may instead work its target out at the moment it runs, for something
 * that had no anchor because it did not exist until then.
 */
function stepSelector(step: TourStep): string | undefined {
  const live = step.anchorSelector?.();
  if (live) {
    return live;
  }
  return step.anchor
    ? `[data-tour-anchor="${step.anchor}"],[data-help-anchor="${step.anchor}"]`
    : undefined;
}

function sameRect(a: Rect | undefined, b: Rect | undefined) {
  if (!a || !b) {
    return a === b;
  }
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

interface Placement {
  left: number;
  top: number;
  /** `inside` means no arrow: the card is over the target, or adrift. */
  side: TourSide;
  /** Where the arrow sits along the card's facing edge. */
  arrow: number;
}

/**
 * Where the card goes.
 *
 * The preferred side wins if the card fits there, otherwise the roomiest side
 * does. A target the size of the board has no "beside", so those steps ask for
 * `inside` and the card sits in the middle of the hole.
 */
function placeCard(
  hole: Rect,
  card: { width: number; height: number },
  preferred: TourSide | undefined,
  vw: number,
  vh: number,
): Placement {
  const over = (top: number): Placement => ({
    left: clamp(
      hole.left + (hole.width - card.width) / 2,
      EDGE_MARGIN,
      Math.max(EDGE_MARGIN, vw - card.width - EDGE_MARGIN),
    ),
    top: clamp(top, EDGE_MARGIN, Math.max(EDGE_MARGIN, vh - card.height - EDGE_MARGIN)),
    side: "inside",
    arrow: 0,
  });

  // Dead centre when the card is adrift, but LOW when a step deliberately sits
  // over its target: `inside` is asked for by the steps that spotlight the
  // whole board, and a card in the middle of it covers the very thing the step
  // is telling you to look at.
  const centred = () => over(hole.top + (hole.height - card.height) / 2);

  if (preferred === "inside") {
    return over(hole.top + hole.height - card.height - 28);
  }

  const room: Record<Exclude<TourSide, "inside">, number> = {
    top: hole.top - CARD_GAP - EDGE_MARGIN - card.height,
    bottom: vh - (hole.top + hole.height) - CARD_GAP - EDGE_MARGIN - card.height,
    left: hole.left - CARD_GAP - EDGE_MARGIN - card.width,
    right: vw - (hole.left + hole.width) - CARD_GAP - EDGE_MARGIN - card.width,
  };

  const order: Array<Exclude<TourSide, "inside">> = ["bottom", "right", "left", "top"];
  const best =
    preferred && room[preferred] >= 0
      ? preferred
      : order.filter((side) => room[side] >= 0).sort((a, b) => room[b] - room[a])[0];

  if (!best) {
    // Nowhere beside it: the card takes the middle of the window and the ring
    // alone says what the step is about.
    return centred();
  }

  if (best === "top" || best === "bottom") {
    const left = clamp(
      hole.left + hole.width / 2 - card.width / 2,
      EDGE_MARGIN,
      Math.max(EDGE_MARGIN, vw - card.width - EDGE_MARGIN),
    );
    return {
      left,
      top: best === "top" ? hole.top - CARD_GAP - card.height : hole.top + hole.height + CARD_GAP,
      side: best,
      arrow: clamp(hole.left + hole.width / 2 - left, 18, Math.max(18, card.width - 18)),
    };
  }

  const top = clamp(
    hole.top + hole.height / 2 - card.height / 2,
    EDGE_MARGIN,
    Math.max(EDGE_MARGIN, vh - card.height - EDGE_MARGIN),
  );
  return {
    left: best === "left" ? hole.left - CARD_GAP - card.width : hole.left + hole.width + CARD_GAP,
    top,
    side: best,
    arrow: clamp(hole.top + hole.height / 2 - top, 18, Math.max(18, card.height - 18)),
  };
}

/** The little triangle on the card's facing edge, aimed at the ring. */
function arrowStyle(placement: Placement): CSSProperties | undefined {
  const transparent = `${ARROW}px solid transparent`;
  const solid = `${ARROW}px solid ${ACCENT}`;

  switch (placement.side) {
    case "top":
      return {
        left: placement.arrow - ARROW,
        top: "100%",
        borderLeft: transparent,
        borderRight: transparent,
        borderTop: solid,
      };
    case "bottom":
      return {
        left: placement.arrow - ARROW,
        bottom: "100%",
        borderLeft: transparent,
        borderRight: transparent,
        borderBottom: solid,
      };
    case "left":
      return {
        top: placement.arrow - ARROW,
        left: "100%",
        borderTop: transparent,
        borderBottom: transparent,
        borderLeft: solid,
      };
    case "right":
      return {
        top: placement.arrow - ARROW,
        right: "100%",
        borderTop: transparent,
        borderBottom: transparent,
        borderRight: solid,
      };
    default:
      return undefined;
  }
}

export function TourOverlay() {
  const { lessonId, stepIndex } = useTourState();
  const lesson = findLesson(lessonId);

  if (!lesson || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <RunningTour lesson={lesson} stepIndex={Math.min(stepIndex, lesson.steps.length - 1)} />,
    document.body,
  );
}

function RunningTour({ lesson, stepIndex }: { lesson: TourLesson; stepIndex: number }) {
  const step = lesson.steps[stepIndex];
  const cardRef = useRef<HTMLDivElement>(null);
  const [hole, setHole] = useState<Rect | undefined>(undefined);
  const [card, setCard] = useState({ width: CARD_WIDTH, height: 220 });
  const [viewport, setViewport] = useState({ vw: 1280, vh: 800 });

  const isLast = stepIndex === lesson.steps.length - 1;
  const nextLesson = findLesson(lesson.nextLessonId);

  // Whatever the lesson needs on the board before step one, once per run. This
  // effect is declared FIRST so the demo plan is on its way in before the first
  // step starts measuring anchors against it.
  useEffect(() => {
    void lesson.setup?.();
    // However the lesson ends - Done, Esc, or straight into the next one - the
    // layout it borrowed goes back.
    return () => lesson.teardown?.();
  }, [lesson]);

  // Make the target reachable, then follow it. `before` may open a column that
  // takes a few hundred milliseconds to slide, so the hole is tracked rather
  // than measured once.
  useEffect(() => {
    step.before?.();

    let frame = 0;
    let last: Rect | undefined;
    // The first tick always publishes. A step whose anchor is not on the page
    // measures as `undefined`, which matches the initial `last` and would leave
    // the PREVIOUS step's hole burning a ring around the wrong thing.
    let published = false;
    const follow = () => {
      const selector = stepSelector(step);
      const measured = selector ? measureSelector(selector) : undefined;
      const next = measured
        ? {
            left: measured.left - RING_PAD,
            top: measured.top - RING_PAD,
            width: measured.width + RING_PAD * 2,
            height: measured.height + RING_PAD * 2,
          }
        : undefined;
      if (!published || !sameRect(last, next)) {
        published = true;
        last = next;
        setHole(next);
      }
      frame = window.requestAnimationFrame(follow);
    };
    follow();

    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useLayoutEffect(() => {
    const read = () => setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // The card's own size decides which side it fits on, so it is measured rather
  // than guessed: the steps are not all the same number of lines.
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setCard((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Capture phase on the window: every board shortcut listens on the bubble,
    // and Delete or Ctrl+Z reaching the plan from behind the sheet would be the
    // tour editing someone's factory.
    const onKeyDown = (event: KeyboardEvent) => {
      const handled =
        event.key === "Escape" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft" ||
        event.key === "Enter" ||
        event.key === " ";
      if (!handled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        endLesson();
      } else if (event.key === "ArrowLeft") {
        previousStep();
      } else {
        nextStep();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const { vw, vh } = viewport;
  const target = hole ?? { left: vw / 2, top: vh / 2, width: 0, height: 0 };
  const placement = placeCard(target, card, hole ? step.side : "inside", vw, vh);
  const arrow = arrowStyle(placement);

  return (
    <div className="fixed inset-0 z-[200] font-mono">
      {/* Transparent, and here only to keep clicks off the board: the dimming
          is the spotlight's shadow, and a shadow is not a hit target. */}
      <div className="absolute inset-0" aria-hidden />

      {hole ? (
        <div aria-hidden className="tour-spotlight pointer-events-none absolute" style={target} />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(6,9,13,0.74)]" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={`${lesson.title}: step ${stepIndex + 1} of ${lesson.steps.length}`}
        className="absolute bg-[#151a21] text-[#dbe3ec] shadow-[8px_8px_0_rgba(0,0,0,0.55)] transition-[left,top] duration-200 ease-out"
        style={{
          left: placement.left,
          top: placement.top,
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 24px)",
          border: `2px solid ${LINE}`,
        }}
      >
        {arrow ? <span aria-hidden className="absolute h-0 w-0" style={arrow} /> : null}

        {/* No header bar, no lesson name, no "3 of 8". The step's own sentence
            is the first thing in the card and the biggest thing in it; the dots
            along the bottom already say how far along this is. */}
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-start justify-between gap-3">
            <GlanceTitle>{step.title}</GlanceTitle>
            <button
              type="button"
              onClick={endLesson}
              aria-label="Leave the tour"
              title="Leave the tour (Esc)"
              className="-mr-1 -mt-0.5 shrink-0 px-1 text-[15px] leading-none text-[#8fa3b8] hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="mt-3">
            <GlanceRows rows={step.rows} />
          </div>
        </div>

        {/* The only progress there is, and it is clickable: a step you skimmed
            is one press away rather than a walk back. */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
          style={{ borderTop: `1px solid ${LINE}` }}
        >
          <div className="flex items-center gap-1.5">
            {lesson.steps.map((entry, index) => (
              <button
                key={entry.title}
                type="button"
                onClick={() => goToStep(index)}
                aria-label={`Step ${index + 1}: ${entry.title}`}
                aria-current={index === stepIndex}
                title={entry.title}
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    index === stepIndex ? ACCENT : index < stepIndex ? "#4a5a6b" : LINE,
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={previousStep}
                className="px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#8fa3b8] hover:text-white"
                style={{ border: `1px solid ${LINE}` }}
              >
                Back
              </button>
            ) : null}
            {/* A lesson that leads somewhere offers it at the end. Finishing
                stays the plain button beside it, so carrying on is a choice
                rather than the only way out. */}
            {isLast && nextLesson ? (
              <>
                <button
                  type="button"
                  onClick={() => finishLesson()}
                  className="px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#8fa3b8] hover:text-white"
                  style={{ border: `1px solid ${LINE}` }}
                >
                  Done
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => finishLesson(nextLesson.id)}
                  title={nextLesson.title}
                  className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#a5f3fc] hover:brightness-125"
                  style={{ border: `1px solid ${ACCENT}`, backgroundColor: "rgba(34,211,238,0.16)" }}
                >
                  Next tour ▸
                </button>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={nextStep}
                className="px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#a5f3fc] hover:brightness-125"
                style={{ border: `1px solid ${ACCENT}`, backgroundColor: "rgba(34,211,238,0.16)" }}
              >
                {isLast ? "Done" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
