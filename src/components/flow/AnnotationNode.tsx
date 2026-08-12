"use client";

import { NodeResizer, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import type { FactoryAnnotation } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";
import {
  ANNOTATION_MIN_ARROW,
  ANNOTATION_MIN_BOX,
  ANNOTATION_MIN_TEXT,
  BOARD_GRID,
} from "@/lib/board-grid";

export interface AnnotationNodeData extends Record<string, unknown> {
  annotation: FactoryAnnotation;
}

export type AnnotationFlowNode = Node<AnnotationNodeData, "annotationNode">;

const DEFAULT_ANNOTATION_COLOR = "yellow" as const;

/**
 * Box and arrow annotations set `pointerEvents: none` on their node wrapper so
 * the empty interior stays click-through (a box drawn around machines must not
 * swallow their clicks). Only elements carrying this class stay interactive,
 * and the same selector doubles as the React Flow `dragHandle`.
 */
export const ANNOTATION_DRAG_HANDLE_CLASS = "annotation-drag-handle";

/** Text notes: 14px matches the old fixed `text-sm`, so existing notes look identical. */
const DEFAULT_ANNOTATION_FONT_SIZE = 14;
const MIN_ANNOTATION_FONT_SIZE = 8;
const MAX_ANNOTATION_FONT_SIZE = 96;
const ANNOTATION_FONT_STEP = 2;

function clampFontSize(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_ANNOTATION_FONT_SIZE), MAX_ANNOTATION_FONT_SIZE);
}

const ANNOTATION_STEP_BUTTON_CLASS =
  "flex h-5 w-5 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)] disabled:cursor-not-allowed disabled:opacity-40";

function AnnotationNodeComponent({ data, selected, width, height }: NodeProps<AnnotationFlowNode>) {
  const { annotation } = data;
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const color = GT_NODE_COLORS[annotation.colorTag ?? DEFAULT_ANNOTATION_COLOR];
  const nodeWidth = width ?? annotation.size.width;
  const nodeHeight = height ?? annotation.size.height;

  const resizer = (
    <NodeResizer
      isVisible={selected}
      minWidth={annotation.kind === "text" ? ANNOTATION_MIN_TEXT.width : ANNOTATION_MIN_BOX}
      minHeight={annotation.kind === "text" ? ANNOTATION_MIN_TEXT.height : ANNOTATION_MIN_ARROW}
      // A box's edges belong to its MOVE strips (which are fat and overlap the
      // resize lines); giving both a claim to the same pixels made each a
      // coin-toss. Corners resize, edges move. A note has no strips, so its
      // edges keep resizing.
      lineStyle={{
        pointerEvents: annotation.kind === "box" ? "none" : "all",
        borderColor: "#22d3ee",
      }}
      handleStyle={{
        pointerEvents: "all",
        width: 16,
        height: 16,
        borderRadius: 0,
        backgroundColor: "#22d3ee",
        border: "1px solid #0e7490",
        // Above the shape and its move strips: the corner grabbers sat half
        // hidden behind the box frame, which read as "less important" when
        // they are the whole resize story.
        zIndex: 10,
      }}
      // The store rounds both the corner and the size to whole cells, so a
      // freehand resize still lands on the grid the moment you let go.
      onResizeEnd={(_, params) =>
        updateAnnotation(annotation.id, {
          position: { x: params.x, y: params.y },
          size: { width: params.width, height: params.height },
        })
      }
    />
  );

  if (annotation.kind === "arrow") {
    // No resize box: an arrow is two ends and a line, so editing it is
    // dragging an end, not working out which side of a rectangle to pull.
    return (
      <ArrowAnnotation
        annotation={annotation}
        width={nodeWidth}
        height={nodeHeight}
        swatch={color.swatch}
        selected={selected ?? false}
      />
    );
  }

  if (annotation.kind === "zone") {
    // Like the arrow: the outline's own corners are the editor, no resize box.
    return (
      <ZoneAnnotation
        annotation={annotation}
        width={nodeWidth}
        height={nodeHeight}
        swatch={color.swatch}
        selected={selected ?? false}
      />
    );
  }

  if (annotation.kind === "text") {
    return (
      <>
        {resizer}
        <TextShape annotation={annotation} color={color} />
      </>
    );
  }

  return (
    <>
      {resizer}
      <BoxShape swatch={color.swatch} />
    </>
  );
}

function BoxShape({ swatch }: { swatch: string }) {
  // The visible frame is inert; four invisible strips along the edges are what
  // take clicks and drags, so the interior stays fully click-through. 24px
  // deep (12 out, 12 in): grabbing "roughly the frame" has to count.
  const stripBase = `${ANNOTATION_DRAG_HANDLE_CLASS} absolute`;
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      <div
        className="pointer-events-none absolute inset-0 border-4"
        style={{
          borderColor: swatch,
          backgroundColor: `${swatch}14`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.35)`,
        }}
      />
      {/* Inset from the ends: the corners belong to the resize grabbers. */}
      <div className={`${stripBase} -top-3 left-4 right-4 h-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -bottom-3 left-4 right-4 h-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -left-3 bottom-4 top-4 w-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -right-3 bottom-4 top-4 w-6 cursor-grab`} style={{ pointerEvents: "all" }} />
    </div>
  );
}

type ArrowPoint = { x: number; y: number };

/**
 * The zone with a grab point on every corner. Same contract as the arrow:
 * selecting it offers the corners themselves, a dragged corner redraws the
 * outline live, and the new bounding box and rebased points are committed
 * once on release (the store snaps them to the grid).
 */
function ZoneAnnotation({
  annotation,
  width,
  height,
  swatch,
  selected,
}: {
  annotation: FactoryAnnotation;
  width: number;
  height: number;
  swatch: string;
  selected: boolean;
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const { screenToFlowPosition } = useReactFlow();
  const [draftPoints, setDraftPoints] = useState<ArrowPoint[]>();
  const points = draftPoints ?? annotation.points ?? [];

  const beginCornerDrag =
    (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const settled = annotation.points ?? [];
      const localPoint = (client: { clientX: number; clientY: number }): ArrowPoint => {
        const flow = screenToFlowPosition({ x: client.clientX, y: client.clientY });
        return { x: flow.x - annotation.position.x, y: flow.y - annotation.position.y };
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const moving = localPoint(moveEvent);
        setDraftPoints(settled.map((point, i) => (i === index ? moving : point)));
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDraftPoints(undefined);

        const moving = localPoint(upEvent);
        const next = settled.map((point, i) =>
          i === index
            ? {
                x: Math.round(moving.x / BOARD_GRID) * BOARD_GRID,
                y: Math.round(moving.y / BOARD_GRID) * BOARD_GRID,
              }
            : point,
        );
        // Rebase onto the new bounding box, which may have moved or grown.
        const minX = Math.min(...next.map((point) => point.x));
        const minY = Math.min(...next.map((point) => point.y));
        updateAnnotation(annotation.id, {
          position: {
            x: annotation.position.x + minX,
            y: annotation.position.y + minY,
          },
          size: {
            width: Math.max(Math.max(...next.map((point) => point.x)) - minX, BOARD_GRID),
            height: Math.max(Math.max(...next.map((point) => point.y)) - minY, BOARD_GRID),
          },
          points: next.map((point) => ({ x: point.x - minX, y: point.y - minY })),
        });
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  return (
    <>
      <ZoneShape points={points} width={width} height={height} swatch={swatch} />
      {selected
        ? points.map((point, index) => (
            <ArrowEndpointHandle
              key={index}
              point={point}
              label={`Drag corner ${index + 1} of the zone`}
              onPointerDown={beginCornerDrag(index)}
            />
          ))
        : null}
    </>
  );
}

function ZoneShape({
  points,
  width,
  height,
  swatch,
}: {
  points: ArrowPoint[];
  width: number;
  height: number;
  swatch: string;
}) {
  if (points.length < 3) {
    return null;
  }

  const outline = `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")} Z`;

  // Like the box: the interior is a faint wash and fully click-through; only
  // the outline itself (via the fat transparent stroke) takes the pointer.
  return (
    <svg
      className="h-full w-full overflow-visible"
      style={{ pointerEvents: "none" }}
      viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      preserveAspectRatio="none"
    >
      <path
        d={outline}
        fill={`${swatch}14`}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <path d={outline} fill="none" stroke={swatch} strokeWidth={4} strokeLinejoin="round" />
      <path
        d={outline}
        className={`${ANNOTATION_DRAG_HANDLE_CLASS} cursor-grab`}
        fill="none"
        stroke="transparent"
        strokeWidth={28}
        strokeLinejoin="round"
        style={{ pointerEvents: "stroke" }}
      />
    </svg>
  );
}

/** The arrow's two ends in node-local coordinates, from its direction. */
function arrowEndpoints(
  annotation: FactoryAnnotation,
  width: number,
  height: number,
): { from: ArrowPoint; to: ArrowPoint } {
  const direction = annotation.arrowDirection ?? "down-right";
  return {
    from: {
      x: direction.endsWith("left") ? width : 0,
      y: direction.startsWith("up") ? height : 0,
    },
    to: {
      x: direction.endsWith("left") ? 0 : width,
      y: direction.startsWith("up") ? 0 : height,
    },
  };
}

/**
 * The arrow with its two grab points. Selecting it offers the ends
 * themselves; dragging one redraws the line live from the other end, and the
 * new box, size and direction are committed once on release (the store snaps
 * them to the grid, same as a box resize).
 */
function ArrowAnnotation({
  annotation,
  width,
  height,
  swatch,
  selected,
}: {
  annotation: FactoryAnnotation;
  width: number;
  height: number;
  swatch: string;
  selected: boolean;
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const { screenToFlowPosition } = useReactFlow();
  const [draft, setDraft] = useState<{ from: ArrowPoint; to: ArrowPoint }>();
  const { from, to } = draft ?? arrowEndpoints(annotation, width, height);

  const beginEndpointDrag =
    (which: "from" | "to") => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const settled = arrowEndpoints(annotation, width, height);
      const fixedLocal = which === "from" ? settled.to : settled.from;
      const localPoint = (client: { clientX: number; clientY: number }): ArrowPoint => {
        const flow = screenToFlowPosition({ x: client.clientX, y: client.clientY });
        return { x: flow.x - annotation.position.x, y: flow.y - annotation.position.y };
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const moving = localPoint(moveEvent);
        setDraft(
          which === "from" ? { from: moving, to: fixedLocal } : { from: fixedLocal, to: moving },
        );
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDraft(undefined);

        const moving = localPoint(upEvent);
        const fromLocal = which === "from" ? moving : fixedLocal;
        const toLocal = which === "to" ? moving : fixedLocal;
        const base = annotation.position;
        const fromFlow = { x: base.x + fromLocal.x, y: base.y + fromLocal.y };
        const toFlow = { x: base.x + toLocal.x, y: base.y + toLocal.y };
        updateAnnotation(annotation.id, {
          position: {
            x: Math.min(fromFlow.x, toFlow.x),
            y: Math.min(fromFlow.y, toFlow.y),
          },
          size: {
            width: Math.max(Math.abs(toFlow.x - fromFlow.x), ANNOTATION_MIN_ARROW),
            height: Math.max(Math.abs(toFlow.y - fromFlow.y), ANNOTATION_MIN_ARROW),
          },
          arrowDirection: `${toFlow.y < fromFlow.y ? "up" : "down"}-${
            toFlow.x < fromFlow.x ? "left" : "right"
          }` as FactoryAnnotation["arrowDirection"],
        });
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  return (
    <>
      <ArrowShape from={from} to={to} width={width} height={height} swatch={swatch} />
      {selected ? (
        <>
          <ArrowEndpointHandle
            point={from}
            label="Drag the arrow's tail"
            onPointerDown={beginEndpointDrag("from")}
          />
          <ArrowEndpointHandle
            point={to}
            label="Drag the arrow's head"
            onPointerDown={beginEndpointDrag("to")}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Same cyan square the resize corners wear, sitting on the end it moves. The
 * visible square rides inside a 32px invisible halo, so "grab the end" works
 * for a thumb and a rough mouse, not only a pixel-perfect one.
 */
function ArrowEndpointHandle({
  point,
  label,
  onPointerDown,
}: {
  point: ArrowPoint;
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className="nodrag absolute z-10 flex h-8 w-8 cursor-crosshair items-center justify-center"
      style={{
        left: point.x - 16,
        top: point.y - 16,
        pointerEvents: "all",
        touchAction: "none",
      }}
    >
      <div
        aria-hidden
        className="h-4 w-4"
        style={{ backgroundColor: "#22d3ee", border: "1px solid #0e7490" }}
      />
    </div>
  );
}

function ArrowShape({
  from,
  to,
  width,
  height,
  swatch,
}: {
  from: ArrowPoint;
  to: ArrowPoint;
  width: number;
  height: number;
  swatch: string;
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 18;
  const headSpread = 0.5;
  const headLeft = {
    x: to.x - headLength * Math.cos(angle - headSpread),
    y: to.y - headLength * Math.sin(angle - headSpread),
  };
  const headRight = {
    x: to.x - headLength * Math.cos(angle + headSpread),
    y: to.y - headLength * Math.sin(angle + headSpread),
  };
  const linePoints = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const headPoints = `M ${headLeft.x} ${headLeft.y} L ${to.x} ${to.y} L ${headRight.x} ${headRight.y}`;

  return (
    <svg
      className="h-full w-full overflow-visible"
      style={{ pointerEvents: "none" }}
      viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      preserveAspectRatio="none"
    >
      <path
        d={linePoints}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={headPoints}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d={linePoints} stroke={swatch} strokeWidth={5} strokeLinecap="round" fill="none" />
      <path
        d={headPoints}
        stroke={swatch}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d={linePoints}
        className={`${ANNOTATION_DRAG_HANDLE_CLASS} cursor-grab`}
        stroke="transparent"
        strokeWidth={28}
        strokeLinecap="round"
        fill="none"
        style={{ pointerEvents: "stroke" }}
      />
    </svg>
  );
}

function TextShape({
  annotation,
  color,
}: {
  annotation: FactoryAnnotation;
  color: (typeof GT_NODE_COLORS)[keyof typeof GT_NODE_COLORS];
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const [isEditing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(annotation.text ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [isEditing]);

  const commit = () => {
    setEditing(false);
    if (draftText !== (annotation.text ?? "")) {
      updateAnnotation(annotation.id, { text: draftText });
    }
  };

  const fontSize = clampFontSize(annotation.fontSize ?? DEFAULT_ANNOTATION_FONT_SIZE);
  const stepFontSize = (delta: number) => {
    const next = clampFontSize(fontSize + delta);
    if (next !== fontSize) {
      updateAnnotation(annotation.id, { fontSize: next });
    }
  };

  return (
    <div
      className="group/text relative h-full w-full border-2 font-mono shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),3px_3px_0_rgba(0,0,0,0.25)]"
      style={{
        // The paint reaches the face, not just the frame: a 20% wash of the
        // border's colour over the slab. Capped low so the ink stays readable
        // against every swatch - even pure white at 20% leaves the face dark
        // enough for light text.
        backgroundColor: "var(--mc-78)",
        backgroundImage: `linear-gradient(${color.swatch}33, ${color.swatch}33)`,
        borderColor: color.swatch,
        color: "var(--mc-ink)",
        fontSize,
        // Notes are set at any size from a caption to a section heading, so a
        // fixed line-height would either crush the big ones or air out the
        // small ones.
        lineHeight: 1.25,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraftText(annotation.text ?? "");
        setEditing(true);
      }}
      title={isEditing ? undefined : "Double-click to edit"}
    >
      {/* Size controls, top right, on hover only: a note is something you read,
          and two buttons parked on every note permanently would be furniture in
          the way of the text. They sit above the text layer so they stay
          clickable over long content. */}
      <div className="nodrag absolute -top-3 right-0 z-10 hidden gap-0.5 group-hover/text:flex">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepFontSize(-ANNOTATION_FONT_STEP);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={fontSize <= MIN_ANNOTATION_FONT_SIZE}
          className={ANNOTATION_STEP_BUTTON_CLASS}
          title="Smaller text"
          aria-label="Smaller text"
        >
          <span aria-hidden className="block h-[2px] w-[8px] bg-current" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepFontSize(ANNOTATION_FONT_STEP);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={fontSize >= MAX_ANNOTATION_FONT_SIZE}
          className={ANNOTATION_STEP_BUTTON_CLASS}
          title="Bigger text"
          aria-label="Bigger text"
        >
          <span aria-hidden className="relative block h-[8px] w-[8px]">
            <span className="absolute left-0 top-[3px] block h-[2px] w-[8px] bg-current" />
            <span className="absolute left-[3px] top-0 block h-[8px] w-[2px] bg-current" />
          </span>
        </button>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan h-full w-full resize-none bg-transparent p-2 font-mono outline-none"
          style={{ fontSize, lineHeight: 1.25 }}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setDraftText(annotation.text ?? "");
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="h-full w-full overflow-hidden whitespace-pre-wrap p-2">
          {annotation.text?.length ? annotation.text : "Double-click to edit"}
        </div>
      )}
    </div>
  );
}

// Position props change every drag frame; this component reads only `data`,
// `selected` and its size, so comparing exactly those keeps annotation bodies
// from re-rendering while their wrapper is translated (see RecipeNode).
export const AnnotationNode = memo(
  AnnotationNodeComponent,
  (previous, next) =>
    previous.data === next.data &&
    previous.selected === next.selected &&
    previous.width === next.width &&
    previous.height === next.height,
);
