import {
  Anchor,
  Box,
  Cable,
  Ellipsis,
  Download,
  Factory,
  Gauge,
  Grid3x3,
  MoveUpRight,
  Paintbrush,
  Palette,
  Presentation,
  Search,
  Sprout,
  Square,
  Tag,
  Trash,
  Trash2,
  Type,
  Undo2,
  Upload,
  type LucideIcon,
} from "lucide-react";
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
 * panel gets a dashed ring, a solid arrow, and a card naming EVERY button in
 * it — the same icon you see on the board, beside what pressing it does. A
 * tips card above the button covers the gestures no button reveals (wiring,
 * pockets, waypoint dots). Pure glance layer: pointer-events stay off, and
 * moving away folds the whole thing up again.
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

/**
 * The whole sheet is one soft blue-grey. Loud enough to read over a dimmed
 * board, quiet enough that eight cards at once do not shout.
 */
const ACCENT = "#93a4bb";
const ACCENT_DIM = "rgba(147, 164, 187, 0.5)";

/**
 * One line of a card: the button's own icon (or a text chip, for the ones
 * that are text), and what it does.
 */
type HelpRow = { icon?: LucideIcon; chip?: string; text: string };

const CALLOUTS: Array<{
  anchor: string;
  side: CalloutSide;
  align: CalloutAlign;
  /** Extra push away from the anchor, past the standard gap. */
  offset?: number;
  /** Slide along the anchor's edge, in px, after align. */
  shift?: number;
  title: string;
  rows: HelpRow[];
}> = [
  {
    // One card for the whole column: its three tabs, then how the item
    // search is meant to flow. Two cards up here fought the Designs card
    // for the same corner.
    anchor: "browser",
    side: "right",
    align: "center",
    title: "The left column",
    rows: [
      { icon: Search, text: "Items: every item and fluid in the pack" },
      { chip: "✦", text: "Pockets: chunks you saved, and everyone else's" },
      { icon: Factory, text: "Setups: whole factories people have shared" },
      { text: "Search an item, click it, pick a recipe" },
      { text: "The machine lands on the board" },
      { text: "Hover any row for what it needs and makes" },
    ],
  },
  {
    // The top-right band is three deep (header buttons, paint row, view
    // row), so this card slides right until it clears the paint ring and
    // rides over the inspector's dimmed head instead. Rows stay short to
    // keep it narrow enough for that gap. The design tabs get their line
    // here rather than a card of their own: every spot below them is a
    // toolbar, and a card there covered one.
    anchor: "plan-actions",
    side: "below",
    align: "end",
    shift: 150,
    title: "This plan",
    rows: [
      { icon: Undo2, text: "Undo and redo" },
      { icon: Trash2, text: "Clean the board" },
      { icon: Upload, text: "Import a plan" },
      { icon: Download, text: "Export it out" },
      { text: "Tabs left: one tab, one board" },
    ],
  },
  {
    anchor: "build",
    side: "below",
    align: "start",
    // Dropped below the designs card's band; the longer arrow reads better.
    offset: 50,
    title: "Build tools",
    rows: [
      { icon: Undo2, text: "Undo, and redo beside it (Ctrl+Z)" },
      { icon: Sprout, text: "Crop farm: pick a crop, it grows at the right rate" },
      { icon: Trash, text: "Trash can: wire spare output in, it stops counting" },
      { icon: Gauge, text: "Custom rate: dial any number in or out by hand" },
      { chip: "/s", text: "Per second, minute or hour, everywhere at once" },
    ],
  },
  {
    anchor: "paint",
    side: "left",
    align: "start",
    // Pushed further out so the card clears the view row's ring below.
    offset: 56,
    title: "Dressing it up",
    rows: [
      { icon: Paintbrush, text: "Pick a colour, then click cards to paint them" },
      { icon: Square, text: "Draw a box around a section" },
      { icon: MoveUpRight, text: "Draw an arrow" },
      { icon: Type, text: "Drop a text note" },
      { icon: Trash2, text: "Bin: click anything to delete it" },
    ],
  },
  {
    anchor: "view",
    side: "below",
    align: "end",
    title: "How it looks",
    rows: [
      { text: "These change the view, never the plan" },
      { icon: Grid3x3, text: "Background: dots, lines, crosses or none" },
      { icon: Palette, text: "Colour wires by how much they carry" },
      { icon: Cable, text: "Thicken wires by how much they carry" },
      { icon: Ellipsis, text: "Marching dashes show which way things flow" },
      { icon: Tag, text: "Rate labels on the wires" },
      { icon: Anchor, text: "Wires dock anywhere, or at fixed ports" },
      { icon: Presentation, text: "Calm colours: drops the alarm reds" },
    ],
  },
  {
    anchor: "glance",
    side: "above",
    align: "end",
    title: "Card faces",
    rows: [
      { icon: Box, text: "What each card IS: its machine, big when zoomed out" },
      { icon: Gauge, text: "How hard it runs: red idle, green flat out" },
    ],
  },
  {
    anchor: "inspector",
    side: "left",
    align: "center",
    title: "Plan totals",
    rows: [
      { text: "NEED: you must bring this in" },
      { text: "OUTPUT: this leaves the plan" },
      { text: "INTERNAL: made and used here" },
      { text: "Hover a row to light up the board" },
      { text: "Select cards to total just those" },
    ],
  },
];

const TIPS: Array<{ chip: string; result: string }> = [
  { chip: "Drag a slot", result: "wires it to another card" },
  { chip: "Drop on empty", result: "becomes a storage drawer" },
  { chip: "Shift+drag", result: "box-selects cards" },
  { chip: "Shift+click", result: "adds one to the selection" },
  { chip: "Ctrl+G", result: "packs them into a pocket" },
  { chip: "Dbl-click pocket", result: "steps inside, Esc backs out" },
  { chip: "Ctrl+C/X/V", result: "copy, cut, paste" },
  { chip: "Delete", result: "removes the selection" },
  { chip: "Scroll / drag", result: "zoom and pan" },
  { chip: "Dbl-click a wire", result: "pins a steering dot" },
];

const CARD_CLASS =
  "absolute border border-[#48546857] bg-[#151a21] font-mono text-[#dbe3ec] shadow-[6px_6px_0_rgba(0,0,0,0.55)]";
const TITLE_CLASS =
  "border-b border-[#48546857] bg-[#1e2630] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]";

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
  const stem: CSSProperties = vertical
    ? { width: 3, backgroundColor: ACCENT }
    : { height: 3, backgroundColor: ACCENT };
  return (
    <span
      className={["absolute flex items-center", vertical ? "flex-col" : "flex-row"].join(" ")}
      style={wrapper}
    >
      {headFirst ? <span className="h-0 w-0" style={head} /> : null}
      <span className="flex-1" style={stem} />
      {headFirst ? null : <span className="h-0 w-0" style={head} />}
    </span>
  );
}

/** One card line: the button's own icon (or a text chip), then the words. */
function HelpRowLine({ row }: { row: HelpRow }) {
  const Icon = row.icon;
  return (
    <li className="flex items-center gap-2">
      <span className="flex h-4 w-5 shrink-0 items-center justify-center">
        {Icon ? (
          <Icon className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        ) : row.chip ? (
          <span
            className="text-[10px] font-black leading-none"
            style={{ color: ACCENT }}
          >
            {row.chip}
          </span>
        ) : (
          <span className="text-[10px] leading-none" style={{ color: ACCENT_DIM }}>
            ▸
          </span>
        )}
      </span>
      <span className="whitespace-nowrap">{row.text}</span>
    </li>
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
              className="absolute border border-dashed"
              style={{
                borderColor: ACCENT_DIM,
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
              <ul className="flex flex-col gap-1.5 p-2.5 pt-2 text-[12px] leading-snug">
                {callout.rows.map((row) => (
                  <HelpRowLine key={row.text} row={row} />
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
            className="absolute flex items-center justify-center border-2 bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
            style={{
              borderColor: ACCENT,
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
            <p className={TITLE_CLASS}>Moves worth knowing</p>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5 p-2.5 pt-2">
              {TIPS.map((tip) => (
                <Fragment key={tip.chip}>
                  <span
                    className="justify-self-start border bg-[#1b2430] px-1.5 py-[1px] text-[10px] font-bold leading-[14px]"
                    style={{ borderColor: ACCENT_DIM, color: "#b9c7d8" }}
                  >
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
