"use client";

import { useStore } from "@xyflow/react";
import { useId } from "react";
import { BOARD_GRID } from "@/lib/board-grid";

/**
 * The two paper rulings the stock React Flow Background cannot draw: ruled
 * lines (horizontal only, like a notepad) and a graph grid (a fine grid with
 * a heavier line every five cells). Built exactly the way the stock
 * Background is - an SVG pattern offset and scaled by the viewport transform -
 * so the ruling is inked ON the board: it pans and zooms with the factory,
 * and line widths stay one screen pixel at every zoom, the same trick the
 * stock line variant uses.
 */
export function RuledBackground({
  mode,
  color,
}: {
  mode: "ruled" | "graph";
  color: string;
}) {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  const patternId = useId();

  // A notepad rules every 2 cells; graph paper repeats its heavy line every
  // 5, with a fine line on each cell inside.
  const gap = (mode === "ruled" ? 2 : 5) * BOARD_GRID * zoom;
  const cell = BOARD_GRID * zoom;

  return (
    // NOT the stock react-flow__background class: that class carries the
    // library's own dark background-color, the very layer the themed board
    // has to show through. Bare absolute positioning is all it needed.
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      aria-hidden
    >
      <pattern
        id={patternId}
        x={translateX % gap}
        y={translateY % gap}
        width={gap}
        height={gap}
        patternUnits="userSpaceOnUse"
      >
        {mode === "graph" ? (
          <>
            {[1, 2, 3, 4].map((step) => (
              <g key={step}>
                <line
                  x1={step * cell}
                  y1={0}
                  x2={step * cell}
                  y2={gap}
                  stroke={color}
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
                <line
                  x1={0}
                  y1={step * cell}
                  x2={gap}
                  y2={step * cell}
                  stroke={color}
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
              </g>
            ))}
            <line x1={0.5} y1={0} x2={0.5} y2={gap} stroke={color} strokeWidth={1.5} />
            <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1.5} />
          </>
        ) : (
          <line x1={0} y1={0.5} x2={gap} y2={0.5} stroke={color} strokeWidth={1} />
        )}
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
