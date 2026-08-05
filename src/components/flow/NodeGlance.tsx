"use client";

import type { ReactNode } from "react";

/**
 * What a node shows once it is too small to read.
 *
 * Zoomed out, a card's contents are noise: the slot sprites are sub-pixel, the
 * dials are a grey smear, and the machine name is three pixels tall. The whole
 * interior stops being drawn (see node-detail.ts and the rules in globals.css)
 * and one of these takes its place — the single fact that still means something
 * at that size. For a machine that is how hard it is running; for a drawer, a
 * tank or a trash can it is what is in it.
 *
 * Two properties matter and are easy to lose:
 *
 * - It must not affect layout. Node size is a routing input, so a card that
 *   changed shape with zoom would reroute the board on every wheel tick. Hence
 *   `absolute inset-0`, and `display` rather than anything that reflows.
 * - It must fill whatever card it lands in. Cards range from a 132px drawer to
 *   a wide multiblock, so a fixed font size is either lost on one or overflows
 *   the other. The text is drawn in an SVG with a viewBox, which makes the
 *   browser scale it to the box for us — always as large as it can be, exactly.
 */

/*
 * The hop map paints this layer, and it does it in CSS.
 *
 * Hovering a card zoomed out floods the whole board with distance colours (see
 * hop-map.ts). None of that arrives as props: the map writes two custom
 * properties onto each node element and the rules in globals.css do the rest,
 * so a hover costs no React work at all on a board that may be carrying two
 * hundred cards. What that buys is why the glance layer takes no colour props
 * here — do not be tempted to "tidy" it into state.
 *
 * The paint lands on the glance layer and nowhere else, which is what keeps it
 * away from the board's geometry: that layer is `absolute inset-0`, it is only
 * displayed at the zoom step where the card's contents are already hidden, and
 * it has no say in the card's size. The router never sees it.
 */

export function NodeGlanceText({
  text,
  className,
}: {
  text: string;
  /** Tone colour for the figure; `fill` reads it through currentColor. */
  className?: string;
}) {
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center p-1"
    >
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="xMidYMid meet"
        className={["h-full w-full font-mono", className ?? ""].join(" ")}
      >
        <text
          x="50"
          y="24"
          textAnchor="middle"
          fontSize="30"
          fontWeight="900"
          fill="currentColor"
          className="tabular-nums"
        >
          {text}
        </text>
      </svg>
    </div>
  );
}

export function NodeGlanceIcon({ children }: { children: ReactNode }) {
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center p-1"
    >
      {/* Just centres. Sizing is the caller's job: a sprite is a
          background-image on a fixed-size span rather than an <img>, so it
          cannot be stretched from out here — it has to be asked for at the
          size you want. Drawers, tanks and cans are all fixed-width cards, so
          a size per call site is exact rather than a guess. */}
      <div className="flex h-full w-full items-center justify-center">{children}</div>
    </div>
  );
}
