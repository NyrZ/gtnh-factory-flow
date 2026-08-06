"use client";

import { useId } from "react";

/**
 * One resource's balance across recent edits.
 *
 * Small, but not a bare squiggle: the zero line is drawn and labelled, and the
 * band's top and bottom carry their values, so a glance answers "how much" and
 * not only "which way". Zero is always inside the band even when every point
 * sits on one side of it - a surplus chart that never shows the line it would
 * have to cross to become a shortfall is telling half the story.
 *
 * Colour follows the LATEST value rather than the trend: green means the plan
 * currently has this spare, red means it is currently short. Whether that is
 * an improvement is what the shape is for.
 */
export function TrendSparkline({
  series,
  width,
  height,
  unit,
}: {
  series: number[];
  width: number;
  height: number;
  unit: string;
}) {
  const gradientId = useId();
  const latest = series[series.length - 1] ?? 0;
  const positive = latest >= 0;
  const stroke = positive ? "#34d399" : "#f87171";

  // One point cannot draw a line, so the chart holds its space and says why.
  if (series.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded border border-dashed border-line text-[10px] text-fg-muted"
      >
        Edit the board to start the chart
      </div>
    );
  }

  const rawMax = Math.max(...series, 0);
  const rawMin = Math.min(...series, 0);
  // A dead-flat line would give a zero-height band and divide by zero; give it
  // something to sit in the middle of.
  const span = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  // Breathing room so the stroke and its end dot are never clipped.
  const padY = 3;
  const plotHeight = height - padY * 2;
  const toY = (value: number) => padY + ((rawMax - value) / span) * plotHeight;
  const toX = (index: number) => (index / (series.length - 1)) * width;

  const line = series.map((value, index) => `${toX(index)},${toY(value)}`).join(" ");
  const zeroY = toY(0);
  const lastX = toX(series.length - 1);
  const lastY = toY(latest);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // Decorative: the numbers beside it carry the same information.
      aria-hidden
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The line the value would have to cross to change sign. */}
      <line
        x1="0"
        y1={zeroY}
        x2={width}
        y2={zeroY}
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 3"
        className="text-fg-muted/50"
      />

      {/* Fill down to zero, not to the floor, so the area reads as "distance
          from breaking even" rather than as an arbitrary column height. */}
      <polygon
        points={`0,${zeroY} ${line} ${lastX},${zeroY}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} />

      <title>
        {`${series.length} edits, now ${latest.toFixed(2)}${unit}`}
      </title>
    </svg>
  );
}
