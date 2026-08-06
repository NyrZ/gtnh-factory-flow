import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

/**
 * The board's help corner: a "?" where the zoom buttons used to live.
 * Hovering it lays a glance sheet over the whole window: every toolbar and
 * panel gets a dashed ring, a solid arrow, and a terse card saying what
 * lives there, and a tips card above the button covers the gestures no
 * button reveals (wiring, pockets, waypoint dots). Pure glance layer:
 * pointer-events stay off, and moving away folds the whole thing up again.
 *
 * The sheet portals to <body>: the board, the browser and the inspector each
 * sit in their own stacking contexts, so a scrim rendered inside the board
 * could never dim its neighbours.
 *
 * Regions are found by their `data-help-anchor` attribute and measured once
 * per open, so the overlay follows the real layout instead of hardcoding it.
 * Several elements may share one anchor id; their rects union (the paint row
 * uses this to ring only its visible buttons, not the folded-away palette).
 */

type HelpRect = { left: number; top: number; right: number; bottom: number };

type Measured = {
  rects: Record<string, HelpRect>;
  button?: HelpRect;
  vw: number;
  vh: number;
};

/** Which side of its anchor a callout card sits on. */
type CalloutSide = "left" | "right" | "above" | "below";
type CalloutAlign = "start" | "center" | "end";

/** Card edge to ring edge: room for the arrow to read as an arrow. */
const CALLOUT_GAP = 18;
const RING_PAD = 5;
const ARROW_HEAD = 12;
/** Long enough to cross the gap from the button to the tips card. */
const HIDE_GRACE_MS = 160;

// The app's tooltip purple (NEI tooltips, pocket chrome): reads as "guide"
// here without the neon glare an accent like cyan brings at this size.
const ACCENT = "#8d6fd1";

const CALLOUTS: Array<{
  anchor: string;
  side: CalloutSide;
  align: CalloutAlign;
  /** Extra push away from the anchor, past the standard gap. */
  offset?: number;
  /** Slide along the anchor's edge, in px, after align. */
  shift?: number;
  title: string;
  rows: string[];
}> = [
  {
    anchor: "browser",
    side: "right",
    align: "center",
    title: "Item browser",
    rows: [
      "Every item and fluid",
      "Click one, pick a recipe",
      "The machine lands on the board",
      "Blueprints: saved chunks",
    ],
  },
  {
    anchor: "tabs",
    side: "below",
    align: "center",
    // Slid left into the corridor between the build ring and the paint card.
    shift: -125,
    title: "Designs",
    rows: ["One tab, one board", "+ starts fresh"],
  },
  {
    anchor: "build",
    side: "below",
    align: "start",
    // Dropped below the designs card's band; the longer arrow reads better.
    offset: 50,
    title: "Board tools",
    rows: ["Undo and redo", "Add crop farm, trash, rate tap", "/s /m /h sets the time unit"],
  },
  {
    anchor: "paint",
    side: "left",
    align: "start",
    // Pushed further out so the card clears the view row's ring below.
    offset: 56,
    title: "Dress it up",
    rows: ["Paint cards any colour", "Boxes, arrows, text notes", "Bin deletes what you click"],
  },
  {
    anchor: "view",
    side: "below",
    align: "end",
    title: "View switches",
    rows: [
      "Looks only, never the plan",
      "Line colour, width, dashes, tags",
      "Wire docking, calm colours",
    ],
  },
  {
    anchor: "glance",
    side: "above",
    align: "end",
    title: "Card faces",
    rows: ["Box: what a machine is", "Gauge: how hard it runs"],
  },
  {
    anchor: "inspector",
    side: "left",
    align: "center",
    title: "Plan totals",
    rows: [
      "NEED: bring in from outside",
      "OUTPUT: leaves the plan",
      "INTERNAL: made and used here",
      "Hover a row: lights the board",
    ],
  },
];

const TIPS: Array<{ chip: string; result: string }> = [
  { chip: "Drag a slot", result: "wires it to another card" },
  { chip: "Drop on empty", result: "becomes a storage drawer" },
  { chip: "Shift+drag", result: "box-selects cards" },
  { chip: "Ctrl+G", result: "packs them into a pocket" },
  { chip: "Dbl-click pocket", result: "steps inside, Esc backs out" },
  { chip: "Ctrl+C/X/V", result: "copy, cut, paste" },
  { chip: "Delete", result: "removes the selection" },
  { chip: "Scroll / drag", result: "zoom and pan" },
  { chip: "Dbl-click a wire", result: "pins a steering dot" },
];

const CARD_CLASS =
  "absolute border-2 border-[#8d6fd1] bg-[#171021] font-mono text-neutral-100 shadow-[6px_6px_0_rgba(0,0,0,0.6)]";
const TITLE_CLASS =
  "bg-[#3b2d52] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-[#e6dcff]";

function toHelpRect(rect: DOMRect): HelpRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function measureAnchors(): Record<string, HelpRect> {
  const rects: Record<string, HelpRect> = {};
  document.querySelectorAll<HTMLElement>("[data-help-anchor]").forEach((element) => {
    const id = element.dataset.helpAnchor;
    const rect = element.getBoundingClientRect();
    if (!id || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const seen = rects[id];
    rects[id] = seen
      ? {
          left: Math.min(seen.left, rect.left),
          top: Math.min(seen.top, rect.top),
          right: Math.max(seen.right, rect.right),
          bottom: Math.max(seen.bottom, rect.bottom),
        }
      : toHelpRect(rect);
  });
  return rects;
}

function calloutStyle(
  callout: (typeof CALLOUTS)[number],
  rect: HelpRect,
  vw: number,
  vh: number,
): CSSProperties {
  const { side, align } = callout;
  const push = RING_PAD + CALLOUT_GAP + (callout.offset ?? 0);
  const style: CSSProperties = {};
  if (side === "right") {
    style.left = rect.right + push;
  } else if (side === "left") {
    style.right = vw - rect.left + push;
  } else if (side === "below") {
    style.top = rect.bottom + push;
  } else {
    style.bottom = vh - rect.top + push;
  }
  const shift = callout.shift ?? 0;
  if (side === "left" || side === "right") {
    if (align === "center") {
      style.top = (rect.top + rect.bottom) / 2 + shift;
      style.transform = "translateY(-50%)";
    } else if (align === "end") {
      style.bottom = vh - rect.bottom - shift;
    } else {
      style.top = rect.top + shift;
    }
  } else {
    if (align === "end") {
      style.right = vw - rect.right - shift;
    } else if (align === "center") {
      style.left = (rect.left + rect.right) / 2 + shift;
      style.transform = "translateX(-50%)";
    } else {
      style.left = rect.left + shift;
    }
  }
  return style;
}

/**
 * A solid arrow growing out of the card's facing edge: stem from the card,
 * chunky head touching the target's ring. Sized to span the exact gap.
 */
function CalloutArrow({
  side,
  align,
  length,
}: {
  side: CalloutSide;
  align: CalloutAlign;
  length: number;
}) {
  const vertical = side === "below" || side === "above";
  const wrapper: CSSProperties = vertical
    ? { height: length, width: 16 }
    : { width: length, height: 16 };
  if (side === "below") {
    wrapper.bottom = "100%";
  } else if (side === "above") {
    wrapper.top = "100%";
  } else if (side === "right") {
    wrapper.right = "100%";
  } else {
    wrapper.left = "100%";
  }
  if (vertical) {
    if (align === "center") {
      wrapper.left = "50%";
      wrapper.transform = "translateX(-50%)";
    } else if (align === "end") {
      wrapper.right = 20;
    } else {
      wrapper.left = 20;
    }
  } else {
    if (align === "center") {
      wrapper.top = "50%";
      wrapper.transform = "translateY(-50%)";
    } else if (align === "end") {
      wrapper.bottom = 12;
    } else {
      wrapper.top = 12;
    }
  }
  // The head aims at the anchor, so it leads on the anchor-facing end.
  const head: CSSProperties =
    side === "below"
      ? { borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: `${ARROW_HEAD}px solid ${ACCENT}` }
      : side === "above"
        ? { borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: `${ARROW_HEAD}px solid ${ACCENT}` }
        : side === "right"
          ? { borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: `${ARROW_HEAD}px solid ${ACCENT}` }
          : { borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: `${ARROW_HEAD}px solid ${ACCENT}` };
  const headFirst = side === "below" || side === "right";
  return (
    <span
      className={["absolute flex items-center", vertical ? "flex-col" : "flex-row"].join(" ")}
      style={wrapper}
    >
      {headFirst ? <span className="h-0 w-0" style={head} /> : null}
      <span className={vertical ? "w-[3px] flex-1 bg-[#8d6fd1]" : "h-[3px] flex-1 bg-[#8d6fd1]"} />
      {headFirst ? null : <span className="h-0 w-0" style={head} />}
    </span>
  );
}

function HelpGlanceSheet({
  measured,
  onEnter,
  onLeave,
}: {
  measured: Measured;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { rects, button, vw, vh } = measured;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120]"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      {CALLOUTS.map((callout) => {
        const rect = rects[callout.anchor];
        if (!rect) {
          return null;
        }
        return (
          <Fragment key={callout.anchor}>
            <div
              className="absolute border-2 border-dashed border-[#8d6fd1]/90"
              style={{
                left: rect.left - RING_PAD,
                top: rect.top - RING_PAD,
                width: rect.right - rect.left + RING_PAD * 2,
                height: rect.bottom - rect.top + RING_PAD * 2,
              }}
            />
            <div className={CARD_CLASS} style={calloutStyle(callout, rect, vw, vh)}>
              <CalloutArrow
                side={callout.side}
                align={callout.align}
                length={CALLOUT_GAP + (callout.offset ?? 0)}
              />
              <p className={TITLE_CLASS}>{callout.title}</p>
              <ul className="flex flex-col gap-1 p-2.5 pt-2 text-[12px] leading-snug">
                {callout.rows.map((row) => (
                  <li key={row} className="flex gap-1.5">
                    <span className="shrink-0 text-[#c9b8ec]">▸</span>
                    <span className="whitespace-nowrap">{row}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Fragment>
        );
      })}
      {button ? (
        <Fragment>
          {/* A lit stand-in over the real (now dimmed) button, so the corner
              the sheet grew from stays readable. Hover still lands on the
              real button underneath. */}
          <div
            className="absolute flex items-center justify-center border-2 border-[#8d6fd1] bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
            style={{
              left: button.left,
              top: button.top,
              width: button.right - button.left,
              height: button.bottom - button.top,
            }}
          >
            ?
          </div>
          <div
            className={`${CARD_CLASS} pointer-events-auto`}
            style={{ left: button.left, bottom: vh - button.top + 8 }}
          >
            <p className={TITLE_CLASS}>Good to know</p>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5 p-2.5 pt-2">
              {TIPS.map((tip) => (
                <Fragment key={tip.chip}>
                  <span className="justify-self-start border border-[#8d6fd1]/70 bg-[#241b33] px-1.5 py-[1px] text-[10px] font-bold leading-[14px] text-[#d9c8f5]">
                    {tip.chip}
                  </span>
                  <span className="whitespace-nowrap text-[12px] leading-snug">{tip.result}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </Fragment>
      ) : null}
    </div>
  );
}

export const BoardHelp = memo(function BoardHelp() {
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    setMeasured({
      rects: measureAnchors(),
      button: buttonRect ? toHelpRect(buttonRect) : undefined,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
  }, []);
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setMeasured(undefined), HIDE_GRACE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  return (
    <div
      className="absolute bottom-3 left-3 z-30"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        ref={buttonRef}
        type="button"
        onFocus={show}
        onBlur={scheduleHide}
        className="pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
        title="What does everything do?"
        aria-label="Show board help"
      >
        ?
      </button>
      {measured
        ? createPortal(
            <HelpGlanceSheet measured={measured} onEnter={show} onLeave={scheduleHide} />,
            document.body,
          )
        : null}
    </div>
  );
});
