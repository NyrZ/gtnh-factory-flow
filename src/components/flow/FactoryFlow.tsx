"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  ConnectionMode,
  EdgeLabelRenderer,
  Position,
  ReactFlow,
  applyNodeChanges,
  getNodesBounds,
  getSmoothStepPath,
  getViewportForBounds,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  useStore,
  useStoreApi,
  ViewportPortal,
} from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import {
  Ban,
  Cable,
  Ellipsis,
  Flame,
  Gauge,
  Grid3x3,
  Grip,
  LoaderCircle,
  Magnet,
  MoveUpRight,
  Paintbrush,
  Palette,
  Plus,
  Redo2,
  Sprout,
  Square,
  Trash,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
} from "@/lib/import-export/plan-image";
import type { Theme } from "@/lib/theme";
import { useThemeStore } from "@/store/theme-store";
import {
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
  applyMachineHandlerToRecipe,
  isRecipeInputConsumed,
  makeResourceKey,
  formatNumberWithThousands,
  resourceMatchesInput,
  trimTrailingDecimalZeros,
} from "@/lib/model";
import { applyMachineOutputMultipliers } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import type {
  EdgeThroughput,
  FactoryAnnotationKind,
  FactoryEdge,
  FactoryNodeColorTag,
  FactoryProject,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { RecipeNode, type RecipeFlowNode } from "./RecipeNode";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE, flowRampColor } from "./node-colors";
import {
  CANVAS_PATTERNS,
  useBoardView,
  writeBoardView,
  type BoardView,
  type CanvasPattern,
} from "./board-view";
import { getDeleteCursor, getPaintBrushCursor } from "./paint-cursor";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
  parseResourceHandleId,
} from "./resource-handles";
import {
  findOrthogonalRoute,
  polylineCrossesRect,
  scoreOrthogonalPath,
} from "./orthogonal-router";
import {
  describeEdgeRate,
  formatEdgeRateLabel,
  formatEdgeValue,
  getEdgeSupplyRatio,
  isEdgeStarved,
  isEdgeSurplus,
} from "./edge-labels";
import { buildEdgeStory } from "./flow-explainers";
import { CUSTOM_RATE_ANY_RESOURCE_ID } from "@/lib/model/custom-rate";
import { isTrashRecipe, TRASH_ANY_RESOURCE_ID } from "@/lib/model/trash";
import { rateUnitSuffix, type RateUnit } from "@/lib/model/rate-unit";
import { getSupplyCeiling } from "@/components/inspector/usage-limits";
import {
  EDGE_DETAIL_ARROWS,
  EDGE_DETAIL_GLOBAL,
  EDGE_DETAIL_LABELS,
  getEdgeDetailLevel,
  hasEdgeDetail,
  reuseDeepObjectIdentity,
  reuseObjectIdentity,
} from "./edge-detail";
import { assignEdgeLanes, compareEdgeDepth, edgeCasingWidth } from "./edge-geometry";
import { StorageNode, type StorageFlowNode } from "./StorageNode";
import { TrashNode, type TrashFlowNode } from "./TrashNode";
import {
  ANNOTATION_DRAG_HANDLE_CLASS,
  AnnotationNode,
  type AnnotationFlowNode,
} from "./AnnotationNode";

const nodeTypes = {
  recipeNode: RecipeNode,
  storageNode: StorageNode,
  trashNode: TrashNode,
  annotationNode: AnnotationNode,
} satisfies NodeTypes;

type BoardFlowNode = RecipeFlowNode | StorageFlowNode | TrashFlowNode | AnnotationFlowNode;

interface AnnotationDraft {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const ResourceEdge = memo(ResourceEdgeComponent);

const edgeTypes = {
  resourceEdge: ResourceEdge,
} satisfies EdgeTypes;

function selectEdgeDetailLevel(store: { transform: [number, number, number] }) {
  return getEdgeDetailLevel(store.transform[2]);
}

const connectionLineStyle = {
  stroke: "#00d9ff",
  strokeWidth: 5,
  strokeOpacity: 0.95,
  filter: "drop-shadow(0 0 5px rgba(0,217,255,0.9))",
};

const DEFAULT_ITEM_EDGE_COLOR = "#8b8f98";
const DEFAULT_FLUID_EDGE_COLOR = "#2f89c5";

// React Flow's Background and the html-to-image exporter both need a concrete
// colour rather than a CSS variable, so these mirror --canvas / --canvas-dot.
const CANVAS_COLOR: Record<Theme, string> = {
  light: "#f5f5f5",
  dark: "#1b1d21",
};
const CANVAS_DOT_COLOR: Record<Theme, string> = {
  light: "#b8b8b8",
  dark: "#4a4d55",
};

/** Snap step, and the background gap — same number so nodes land on marks. */
const BOARD_GRID_SIZE = 24;
/** Stable identity: a fresh array each render would re-init React Flow's snap. */
const BOARD_GRID_SNAP: [number, number] = [BOARD_GRID_SIZE, BOARD_GRID_SIZE];
const CANVAS_PATTERN_LABEL: Record<CanvasPattern, string> = {
  dots: "Background: dots",
  lines: "Background: grid lines",
  cross: "Background: crosses",
  none: "Background: blank",
};
const CANVAS_PATTERN_VARIANT: Record<
  Exclude<CanvasPattern, "none">,
  (typeof BackgroundVariant)[keyof typeof BackgroundVariant]
> = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
};

/**
 * Thickness-mode line widths. Deliberately heavy: this mode is a pipe diagram,
 * and a 3px "thin" line was too close to a normal one to read as a volume at
 * all. The ceiling is a constant because the value driving it is NORMALISED —
 * a recipe moving billions per second still lands at 1.0 and gets exactly this
 * width, so no rate can blow the board up.
 */
const FLOW_MODE_MIN_WIDTH = 9;
const FLOW_MODE_MAX_WIDTH = 34;
/**
 * Dash travel in flow pixels per second: the quietest line on the board, and
 * the busiest. Expressed as a velocity rather than a duration so the speed
 * reads as flow and nothing else — see the note where it is applied.
 */
const PULSE_MIN_VELOCITY = 130;
const PULSE_MAX_VELOCITY = 434;

/**
 * How far apart parallel runs sit, as a multiple of EDGE_LANE_SPACING.
 *
 * Lane spacing was chosen for ~3px wires: at 14px apart they read as separate
 * lines with room to spare. A 34px pipe in a 14px lane overlaps its neighbour
 * by more than half, so thickness mode widens every lane to clear the widest
 * line it can draw. Published as a module value (not a prop) because the
 * routing functions that consume it are pure and module-level; the board bumps
 * it and drops the route caches, which is the same discipline every other
 * geometry input here follows.
 */
let publishedEdgeLaneScale = 1;
const THICK_LINE_LANE_SCALE = 2.8;
/** Below this a rate is display noise, not a flow — it must not set the floor. */
const RATE_DISPLAY_EPSILON = 1e-6;

/**
 * How much of a line's weight comes from its RANK among the other lines rather
 * than from its value. This is the knob that buys resolution.
 *
 * A pure value scale is honest and useless: one fluid line at 10,000/s squashes
 * every other line on the board into the bottom pixel of the range. A pure log
 * scale fixes the squashing across orders of magnitude but still cannot
 * separate 10,000 from 10,005 — they are the same width to any eye.
 *
 * Rank separates them perfectly (adjacent values are adjacent ranks, always one
 * step apart) but throws away magnitude: it cannot tell you that one line moves
 * a thousand times more than another, only that it moves more. Neither alone is
 * what you want, so the two are blended — rank leading, because the reading
 * being asked for is "which of these is bigger", not "how big exactly".
 */
const FLOW_RANK_WEIGHT = 0.62;

/** value -> its 0..1 position among the distinct values present, ascending. */
function distinctRankIndex(sortedValues: number[]): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const value of sortedValues) {
    if (!ranks.has(value)) {
      ranks.set(value, ranks.size);
    }
  }
  const last = ranks.size - 1;
  if (last <= 0) {
    for (const value of ranks.keys()) {
      ranks.set(value, 1);
    }
    return ranks;
  }
  for (const [value, index] of ranks) {
    ranks.set(value, index / last);
  }
  return ranks;
}

/**
 * A line's weight, 0 (quietest on the board) to 1 (busiest), blending its
 * logarithmic share of the range with its rank among the other lines.
 */
function flowHeatFor(
  value: number,
  min: number,
  max: number,
  ranks: Map<number, number>,
): number {
  if (value <= RATE_DISPLAY_EPSILON || !Number.isFinite(min)) {
    return 0;
  }
  // One line, or every line equal: it is the biggest there is.
  if (max - min <= RATE_DISPLAY_EPSILON) {
    return 1;
  }
  // log1p keeps this well behaved for the sub-1/s rates chanced outputs
  // produce, where a plain log would dive toward negative infinity.
  const logSpan = Math.log1p(max) - Math.log1p(min);
  const logShare = logSpan > 1e-9 ? (Math.log1p(value) - Math.log1p(min)) / logSpan : 1;
  const rankShare = ranks.get(value) ?? logShare;
  return Math.min(
    Math.max(rankShare * FLOW_RANK_WEIGHT + logShare * (1 - FLOW_RANK_WEIGHT), 0),
    1,
  );
}
/**
 * Which scale a line is measured on. Fluids move in litres and everything else
 * in whole units, so they are ranged apart; aspects are counted like items.
 */
function flowBucketFor(kind: ResourceKind): "item" | "fluid" {
  return kind === "fluid" ? "fluid" : "item";
}

const RECIPE_SLOT_EDGE_OFFSET = 20;
const STORAGE_SLOT_EDGE_OFFSET = 55;
const EDGE_BUNDLE_CLEARANCE = 30;
// Wires were correct but claustrophobic at 18 — they hugged node walls.
const BASE_EDGE_NODE_CLEARANCE = 30;
// Parallel wires were shoulder-to-shoulder at 8; lanes now sit visibly apart.
const EDGE_LANE_SPACING = 14;
const EDGE_LANE_BUCKETS = 4;
const BASE_EDGE_LINK_CLEARANCE = 12;

/**
 * How much room a wire keeps off a node wall, and how close two wires may run
 * before the scorer charges for it.
 *
 * Both were tuned for a ~3px wire, where the stroke is thinner than the
 * measurement error and a centreline clearance IS a visual clearance. In
 * thickness mode a line is up to 34px wide, so a route whose CENTRELINE clears
 * a node by 30px leaves a 13px gap, and two centrelines 12px apart overlap by
 * 22px of solid colour — the scorer calls that clear because it only ever
 * measures centre to centre.
 *
 * So the clearances become mode-scoped and are published the same way lane
 * width is: derived from the widest line the mode can draw, never from any
 * individual edge's width. That distinction is the whole point — per-edge
 * widths come from normalised throughput, so folding them into routing inputs
 * would make every solver run reshuffle the ranks, change a width, and reroute
 * the board. Mode-scoped values change only when the user toggles the mode.
 */
let publishedDirectEdgeNodeClearance = BASE_EDGE_NODE_CLEARANCE;
let publishedEdgeLinkClearance = BASE_EDGE_LINK_CLEARANCE;

function edgeClearancesForMode(thicknessMode: boolean) {
  if (!thicknessMode) {
    return { node: BASE_EDGE_NODE_CLEARANCE, link: BASE_EDGE_LINK_CLEARANCE };
  }
  // Half of the widest pipe is the amount of stroke that hangs off the
  // centreline, so adding it restores the gap the base numbers describe.
  const halfWidest = FLOW_MODE_MAX_WIDTH / 2;
  return {
    node: BASE_EDGE_NODE_CLEARANCE + halfWidest,
    // Two lines both hang half a stroke into the gap between them.
    link: BASE_EDGE_LINK_CLEARANCE + halfWidest * 2,
  };
}
const EDGE_ENDPOINT_SPACING = 5;
const EDGE_ROUTE_RELAXATION_PASSES = 2;
const EDGE_ROUTE_SNAP_GRID = 4;
const EXPORT_IMAGE_PADDING = 80;
const EXPORT_PNG_PIXEL_RATIO = 2;
const EXPORT_PNG_MAX_PIXEL_SIDE = 8192;
const FLOW_EDGE_LABEL_SELECT_EVENT = "gtnh-flow.edge-label-select";
type ResourceEdgeData = {
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
  color: string;
  demand: number;
  transferred?: number;
  /** What the consumer wants at 100%, so a shortfall can be shown as a ratio. */
  nameplateDemand?: number;
  /** Producer's full output rate; set only when this edge is its sole outlet. */
  sourceCapacity?: number;
  unit: string;
  isLimited: boolean;
  /** Producer is maxed out and the consumer is going hungry. */
  isSupplyCapped: boolean;
  /** The line ends in a barrel or tank rather than a machine. */
  isStorageTarget?: boolean;
  isStorageEdge: boolean;
  showLabel: boolean;
  labelOffset?: { x: number; y: number };
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  sourceSlotEndpoint: boolean;
  targetSlotEndpoint: boolean;
  sourceStorageEndpoint: boolean;
  targetStorageEndpoint: boolean;
  sourceEndpointOffset?: number;
  targetEndpointOffset?: number;
  routeIndex: number;
  bundle?: {
    role: "primary" | "member";
    mode: "single-target" | "multi-target";
    size: number;
    sourceHandleIds: string[];
    primarySourceHandleId: string;
    edgeIds: string[];
    demand?: number;
    transferred?: number;
    nameplateDemand?: number;
    sourceCapacity?: number;
    isLimited: boolean;
    isSupplyCapped: boolean;
  };
  isFlowHighlighted?: boolean;
  /**
   * Set when any of the three line modes is on. `heat` is this line's share of
   * its own kind's range, 0 for the quietest line on the board and 1 for the
   * busiest; the flags say which of colour, thickness and marching dashes to
   * apply, so the three mix freely.
   */
  flowRate?: {
    heat: number;
    kind: "item" | "fluid";
    color: boolean;
    thickness: boolean;
    pulse: boolean;
  };
  /**
   * Bust token for the edge-identity cache. Node size changes bump it, which
   * makes every rebuilt edge structurally new so all of them re-render and
   * re-measure; without it the deep-identity reuse would hand back the old
   * object and the stale route would never redraw.
   */
  layoutEpoch: number;
};

type ResourceFlowEdge = Edge<ResourceEdgeData, "resourceEdge">;

type SlotEdgeEndpoint = {
  x: number;
  y: number;
  side: Position;
  // Whether this side may transit its own node body for free (a slot's
  // logical exit side, and every side of a small storage node). Other sides
  // only get a short allowance, so routes cannot tunnel the length of a
  // recipe node just because a slot technically offers that side.
  freeExit?: boolean;
};
type RoutedEdgePath = {
  path: string;
  labelX: number;
  labelY: number;
  /**
   * Crammed board: the label's only seat is on top of some node, so it
   * doesn't render at all (a user-dragged offset always overrides this).
   */
  labelHidden?: boolean;
  points: Array<{ x: number; y: number }>;
};

const directRouteCache = new Map<
  string,
  {
    signature: string;
    routeIndex: number;
    route: RoutedEdgePath;
    segments: ReturnType<typeof getPolylineSegments>;
  }
>();

/**
 * A hidden single-target bundle member draws nothing — the primary draws the
 * whole bundle. Routing it anyway cached an invisible standalone route that
 * other edges hopped over (phantom humps) and steered around (phantom walls);
 * skip the work and drop any entry left from before it joined the bundle.
 */
function getHiddenBundleMemberRoute(
  edgeId: string,
  source: { x: number; y: number },
): RoutedEdgePath {
  directRouteCache.delete(edgeId);
  return { path: "", labelX: source.x, labelY: source.y, points: [] };
}
// Measured geometry is stored in FLOW coordinates, which are invariant under pan
// and zoom: translating the viewport cannot move a node relative to the graph
// origin. Keying these caches on the viewport transform (as they once were) threw
// every entry away on every pan frame and forced a full re-measure of the whole
// board, which is what made panning and zooming crawl.
//
// Instead they are keyed on a layout epoch that the board bumps when node
// positions or sizes actually change. Only `viewportTransformCache` is
// frame-scoped, because the screen->flow conversion genuinely does depend on the
// live transform.
type MeasuredBounds = { left: number; right: number; top: number; bottom: number };

const missingRecipePlaceholders = new Map<string, RecipeFlowNode["data"]["recipe"]>();

/**
 * Stable stand-in for a recipe the dataset no longer contains. Built once per id
 * so the node's `data` keeps a constant identity across rebuilds.
 */
function getMissingRecipePlaceholder(recipeId: string) {
  const existing = missingRecipePlaceholders.get(recipeId);
  if (existing) {
    return existing;
  }

  const placeholder = {
    id: recipeId,
    name: "Missing recipe",
    machineType: "Unknown",
    minimumTier: "DEMO",
    durationTicks: 20,
    eut: 0,
    inputs: [],
    outputs: [],
  } satisfies RecipeFlowNode["data"]["recipe"];
  missingRecipePlaceholders.set(recipeId, placeholder);
  return placeholder;
}

// Identity caches for node `data`. These are memoisation caches in the same
// spirit as useMemo â€” the value returned is always derived purely from the
// inputs, so a render that is discarded or replayed cannot produce a wrong
// result, only a different (equivalent) object identity. They live at module
// scope rather than in a ref because reading a ref during render is not allowed.
const recipeNodeDataCache = new Map<string, RecipeFlowNode["data"]>();
const storageNodeDataCache = new Map<string, StorageFlowNode["data"]>();
const trashNodeDataCache = new Map<string, TrashFlowNode["data"]>();
const annotationNodeDataCache = new Map<string, AnnotationFlowNode["data"]>();
// Same idea for edges, but with structural comparison: an edge object nests
// fresh data/style objects on every rebuild, and handing React Flow an equal-
// but-new identity re-renders the edge — which re-runs the route solver. Most
// rebuilds (hover, solver run) leave most edges untouched.
const edgeObjectCache = new Map<string, ResourceFlowEdge>();

function pruneNodeDataCaches(
  recipeNodeIds: Set<string>,
  storageIds: Set<string>,
  annotationIds: Set<string>,
  edgeIds: Set<string>,
) {
  for (const id of edgeObjectCache.keys()) {
    if (!edgeIds.has(id)) {
      edgeObjectCache.delete(id);
    }
  }

  // A deleted edge's cached route otherwise lives on as a ghost: hop
  // rendering bumps over it and nearness scoring steers around it.
  for (const id of directRouteCache.keys()) {
    if (!edgeIds.has(id)) {
      directRouteCache.delete(id);
    }
  }

  for (const id of annotationNodeDataCache.keys()) {
    if (!annotationIds.has(id)) {
      annotationNodeDataCache.delete(id);
    }
  }

  for (const id of recipeNodeDataCache.keys()) {
    if (!recipeNodeIds.has(id)) {
      recipeNodeDataCache.delete(id);
    }
  }

  for (const id of trashNodeDataCache.keys()) {
    if (!recipeNodeIds.has(id)) {
      trashNodeDataCache.delete(id);
    }
  }

  for (const id of storageNodeDataCache.keys()) {
    if (!storageIds.has(id)) {
      storageNodeDataCache.delete(id);
    }
  }
}

/**
 * Set whenever a render writes a route into directRouteCache, so the board can
 * run one more pass and let hop rendering see a complete cache. See the settle
 * effect in FactoryFlow.
 */
let routeCacheGrewThisPass = false;
const MAX_HOP_SETTLE_PASSES = 2;

// Node ids currently being dragged. While a drag is live, edges touching these
// nodes drop to cheap estimated routing (so they can follow the pointer without
// DOM measurement), every other edge keeps its cached route untouched, and the
// full precise reroute runs once on drop. Module state rather than React state:
// the edges that need it re-render every frame anyway via their position props.
const activelyDraggedNodeIds = new Set<string>();

const measuredNodeBoundsCache = new Map<string, MeasuredBounds | undefined>();
// Obstacle geometry for route avoidance, published by the board from React
// Flow's node state (positions plus measured sizes). The sweep used to scan
// `.react-flow__node` elements, but with `onlyRenderVisibleElements` the DOM
// only holds the nodes currently on screen — so every pan frame changed the
// obstacle set, invalidating every cached route (and quietly making routes
// depend on the viewport, which AGENTS.md forbids).
let publishedBoardBounds: Array<{ id: string; bounds: MeasuredBounds }> | undefined;
let publishedBoardGeometryById = new Map<
  string,
  { x: number; y: number; width: number; height: number }
>();

// Slot endpoints cached relative to their node's origin, keyed by node size.
// Measuring through the DOM made an edge's endpoints depend on whether its
// node happened to be mounted (`onlyRenderVisibleElements` culls off-screen
// nodes), so routes flip-flopped between measured and estimated shapes as the
// viewport moved — re-scoring on every flip. A slot cannot move inside its
// node without the node changing size, so node-relative points survive
// unmounts and moves alike; absolute positions come from the published
// geometry above.
const relativeSlotEndpointCache = new Map<string, { x: number; y: number }>();
const relativeSlotCenterCache = new Map<string, { x: number; y: number }>();

function boardGeometryDimsKey(geometry: { width: number; height: number } | undefined) {
  return geometry ? `${Math.round(geometry.width)}x${Math.round(geometry.height)}` : "?";
}
let measuredAvoidanceSweep:
  | { epoch: number; bounds: Array<{ id: string; bounds: MeasuredBounds }>; hash: string }
  | undefined;
let measuredLayoutEpoch = 0;

let viewportTransformCache:
  | {
      rendererLeft: number;
      rendererTop: number;
      translateX: number;
      translateY: number;
      scaleX: number;
      scaleY: number;
    }
  | undefined;
let viewportTransformClearScheduled = false;

/**
 * Drops every flow-space measurement. Call this when node positions or node
 * inner layout change â€” never on pan or zoom, which cannot affect flow-space
 * geometry.
 */
function invalidateMeasuredLayout() {
  measuredLayoutEpoch += 1;
  measuredNodeBoundsCache.clear();
  measuredAvoidanceSweep = undefined;
}

type DraggedResourceConnection = Pick<
  ResourceAmount,
  | "kind"
  | "id"
  | "displayName"
  | "iconPath"
  | "iconAtlas"
  | "dominantColor"
  | "tooltip"
  | "alternatives"
> & {
  nodeId: string;
  side: "input" | "output";
  handleId: string;
};

interface ResolvedResourceHandle {
  nodeId: string;
  handleId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
}

export function FactoryFlow() {
  const theme = useThemeStore((state) => state.theme);
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const selectNode = useFactoryStore((state) => state.selectNode);
  const setNodePosition = useFactoryStore((state) => state.setNodePosition);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const updateStorage = useFactoryStore((state) => state.updateStorage);
  const setStoragePosition = useFactoryStore((state) => state.setStoragePosition);
  const connectNodes = useFactoryStore((state) => state.connectNodes);
  const connectCustomRate = useFactoryStore((state) => state.connectCustomRate);
  const connectTrash = useFactoryStore((state) => state.connectTrash);
  const addStorageForConnection = useFactoryStore((state) => state.addStorageForConnection);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const addAnnotation = useFactoryStore((state) => state.addAnnotation);
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const deleteAnnotation = useFactoryStore((state) => state.deleteAnnotation);
  const setAnnotationPosition = useFactoryStore((state) => state.setAnnotationPosition);
  const cancelResourceConnection = useFactoryStore((state) => state.cancelResourceConnection);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const boardView = useBoardView();
  const { lineHeatMode, lineThicknessMode, linePulseMode } = boardView;
  const anyLineMode = lineHeatMode || lineThicknessMode || linePulseMode;
  const setFlowViewportCenter = useFactoryStore((state) => state.setFlowViewportCenter);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const hoveredUsageNodeId = useFactoryStore((state) => state.hoveredUsageNodeId);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const activeFlowResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const activeNodeBottlenecks = hoveredNodeBottlenecks || selectedNodeBottlenecks;
  const recipesById = useMemo(
    () => new Map(project.recipes.map((recipe) => [recipe.id, recipe])),
    [project.recipes],
  );
  const storagesById = useMemo(
    () => new Map((project.storages ?? []).map((storage) => [storage.id, storage])),
    [project.storages],
  );

  const nodesFromProject = useMemo<BoardFlowNode[]>(
    () => [
      ...project.nodes.map((node): BoardFlowNode => {
        const recipe = recipesById.get(node.recipeId) ?? getMissingRecipePlaceholder(node.recipeId);
        // Trash cans get their own compact card; a distinct node TYPE (not a
        // branch inside RecipeNode) so the hook order of the big machine card
        // never depends on what recipe a node holds.
        if (isTrashRecipe(recipe)) {
          return {
            id: node.id,
            type: "trashNode",
            position: node.position,
            data: reuseObjectIdentity(trashNodeDataCache, node.id, {
              projectNode: node,
            }),
          } satisfies TrashFlowNode;
        }
        return {
          id: node.id,
          type: "recipeNode",
          position: node.position,
          zIndex:
            hoveredUsageNodeId === node.id
              ? 1500
              : activeNodeBottlenecks && result.nodes[node.id]?.status === "bottleneck"
                ? 1500
                : activeFlowResourceKey && recipeContainsResourceKey(recipe, activeFlowResourceKey)
                  ? 1500
                  : undefined,
          // Reusing the previous `data` object when nothing in it moved is what
          // lets RecipeNode's memo actually hold. Rebuilding it â€” which this memo
          // does whenever a resource is hovered or the solver re-runs â€” otherwise
          // re-renders every node on the board for a change affecting one.
          data: reuseObjectIdentity(recipeNodeDataCache, node.id, {
            projectNode: node,
            recipe,
            result: result.nodes[node.id],
          }),
        } satisfies RecipeFlowNode;
      }),
      ...(project.storages ?? []).map(
        (storage) =>
          ({
            id: storage.id,
            type: "storageNode",
            position: storage.position,
            zIndex:
              activeFlowResourceKey === makeResourceKey(storage.kind, storage.resourceId)
                ? 1500
                : undefined,
            data: reuseObjectIdentity(storageNodeDataCache, storage.id, {
              storage,
              result: result.storages[storage.id],
            }),
          }) satisfies StorageFlowNode,
      ),
      ...(project.annotations ?? []).map(
        (annotation) =>
          ({
            id: annotation.id,
            type: "annotationNode",
            position: annotation.position,
            width: annotation.size.width,
            height: annotation.size.height,
            // Boxes sit under everything so they read as grouping frames;
            // arrows and text notes float above the nodes they point at.
            zIndex: annotation.kind === "box" ? -5 : 1000,
            // Box/arrow interiors must stay click-through; only their
            // drag-handle elements take pointer events (see AnnotationNode).
            dragHandle: annotation.kind === "text" ? undefined : `.${ANNOTATION_DRAG_HANDLE_CLASS}`,
            style: annotation.kind === "text" ? undefined : { pointerEvents: "none" as const },
            data: reuseObjectIdentity(annotationNodeDataCache, annotation.id, { annotation }),
          }) satisfies AnnotationFlowNode,
      ),
    ],
    [
      activeFlowResourceKey,
      activeNodeBottlenecks,
      hoveredUsageNodeId,
      project.annotations,
      project.nodes,
      project.storages,
      recipesById,
      result.nodes,
      result.storages,
    ],
  );
  const [flowNodes, setFlowNodes] = useState<BoardFlowNode[]>(() => nodesFromProject);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isNodeDragging, setNodeDragging] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<FactoryAnnotationKind | undefined>(
    undefined,
  );
  // Shared by the brush and the annotation tools: the last colour picked in
  // the palette is what a new box/arrow/note is created with.
  const [activeColorTag, setActiveColorTag] = useState<FactoryNodeColorTag>("yellow");
  const [isDeleteMode, setDeleteMode] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | undefined>(undefined);
  const annotationDraftRef = useRef<AnnotationDraft | undefined>(undefined);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const draggingNodeRef = useRef(false);
  const draggedResourceRef = useRef<DraggedResourceConnection | undefined>(undefined);
  const lastConnectionPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const connectCompletedRef = useRef(false);
  const exportInProgressRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<BoardFlowNode, ResourceFlowEdge> | null>(null);

  useEffect(() => {
    if (draggingNodeRef.current) {
      return;
    }

    // Rebuilt node objects don't carry React Flow's `measured` sizes; syncing
    // them in verbatim would zero every node's dimensions until React Flow
    // re-measures, which the geometry fingerprints below would read as the
    // whole board resizing twice — rerouting everything on every hover.
    setFlowNodes((current) => {
      const measuredById = new Map(current.map((node) => [node.id, node.measured]));
      return nodesFromProject.map((node) => {
        const measured = measuredById.get(node.id);
        return measured ? { ...node, measured } : node;
      });
    });
  }, [nodesFromProject]);

  useEffect(() => {
    pruneNodeDataCaches(
      new Set(project.nodes.map((node) => node.id)),
      new Set((project.storages ?? []).map((storage) => storage.id)),
      new Set((project.annotations ?? []).map((annotation) => annotation.id)),
      new Set(project.edges.map((edge) => edge.id)),
    );
  }, [project.nodes, project.storages, project.annotations, project.edges]);

  // Flow-space measurements are cached across frames, so anything that can move
  // a node or change its size has to drop them explicitly. `flowNodes` changes
  // identity for plenty of reasons that move nothing — hover zIndex, solver
  // results, drag frames — and invalidating on each of those used to force the
  // whole board to re-measure and reroute every edge per frame, which is what
  // made pans and drags stutter on large graphs. Geometry is therefore reduced
  // to a fingerprint of positions and React Flow's measured sizes (its own
  // ResizeObserver reports content growth, e.g. when icons or NEI layout
  // resolve, through `onNodesChange`).
  // Dimensions are rounded so re-measure jitter (remounts under culling,
  // sub-pixel differences) can't masquerade as a resize.
  const nodeGeometryFingerprint = useMemo(
    () =>
      flowNodes
        .map(
          (node) =>
            `${node.id}:${node.position.x},${node.position.y},${Math.round(
              node.measured?.width ?? node.width ?? 0,
            )}x${Math.round(node.measured?.height ?? node.height ?? 0)}`,
        )
        .join(";"),
    [flowNodes],
  );
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;
  // Publish the obstacle set for route avoidance from state, not the DOM: with
  // `onlyRenderVisibleElements` the DOM only holds on-screen nodes, so a
  // DOM-derived obstacle set changed on every pan and invalidated every cached
  // route. Reads through the ref so identity-only `flowNodes` churn (hover
  // zIndex, solver results) doesn't feed it.
  const publishBoardGeometry = useCallback(() => {
    // Lane width is a routing input just like node bounds, so it is published
    // from here — and because thickness mode is in this callback's deps, the
    // layout effect below re-runs on toggle and bumps the layout epoch, which
    // is what makes every edge reroute against the new lanes. Widening the
    // lanes invalidates every cached route, so they go too.
    const nextLaneScale = lineThicknessMode ? THICK_LINE_LANE_SCALE : 1;
    // Clearances are a routing input for the same reason lane width is, and
    // they move together: both are functions of the widest line the current
    // mode can draw. See edgeClearancesForMode.
    const nextClearances = edgeClearancesForMode(lineThicknessMode);
    if (
      publishedEdgeLaneScale !== nextLaneScale ||
      publishedDirectEdgeNodeClearance !== nextClearances.node ||
      publishedEdgeLinkClearance !== nextClearances.link
    ) {
      publishedEdgeLaneScale = nextLaneScale;
      publishedDirectEdgeNodeClearance = nextClearances.node;
      publishedEdgeLinkClearance = nextClearances.link;
      // Hop size follows the stroke widths now (see hopRadiusFor), and those
      // are republished on every pass — the routes just have to be rebuilt so
      // the new bumps are drawn.
      directRouteCache.clear();
    }
    const geometryById = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of flowNodesRef.current) {
      geometryById.set(node.id, {
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      });
    }
    publishedBoardGeometryById = geometryById;
    // Annotations are ink on the board, not furniture. A box drawn AROUND a
    // cluster used to be a solid obstacle spanning all of it, so every wire
    // inside was forced to detour around its own group — the drawing changed
    // the routing without changing the factory. Wires now pass straight
    // through boxes, arrows and notes as if they were not there.
    const annotationIds = new Set(
      flowNodesRef.current
        .filter((node) => node.type === "annotationNode")
        .map((node) => node.id),
    );
    publishedBoardBounds = [...geometryById.entries()]
      .filter(([id]) => !annotationIds.has(id))
      .map(([id, geometry]) => ({
        id,
        bounds: {
          left: geometry.x,
          top: geometry.y,
          right: geometry.x + geometry.width,
          bottom: geometry.y + geometry.height,
        },
      }))
      .filter((entry) => entry.bounds.right > entry.bounds.left)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    invalidateMeasuredLayout();
  }, [lineThicknessMode]);
  useLayoutEffect(() => {
    // Drag frames rewrite positions constantly. Measurements stay frozen for
    // the whole drag: untouched edges keep their cached routes and edges on
    // the dragged node use estimated endpoints. The drop republishes
    // explicitly (see handleNodeDragStop) — it has to, because React Flow
    // streams the final position into `flowNodes` during the last drag frame,
    // so this fingerprint does NOT change again after the drag ends.
    if (draggingNodeRef.current) {
      return;
    }

    publishBoardGeometry();
    // Edges rendered in the pass that carried this geometry change computed
    // their routes against the PREVIOUS published geometry (render runs before
    // layout effects), so a moved node's edges would keep pointing at where it
    // used to be. Re-issuing the edge objects makes them recompute against
    // what was just published; this also covers nodes growing when icons or
    // NEI layout resolve.
    setLayoutVersion((version) => version + 1);
  }, [nodeGeometryFingerprint, publishBoardGeometry]);

  // Settle the hop pass. Hops are drawn against the routes of lower-index
  // edges, read from directRouteCache — which is filled AS edges render. React
  // promises no order there, so an edge that rendered before its neighbours saw
  // an incomplete cache, drew a flat crossing, and then never recomputed,
  // because its own route signature never changed again. That is why hops went
  // missing at random rather than consistently.
  //
  // Forcing a render order is not on offer, so let the pass settle instead:
  // whenever a render added routes to the cache, run exactly one more. By then
  // every route is present and every hop is drawn against the full picture.
  // The extra pass writes nothing new — same signatures, all cache hits — so it
  // terminates on its own; the counter is a backstop against a route whose
  // signature is somehow unstable, and resets as soon as a pass adds nothing.
  const hopSettlePassesRef = useRef(0);
  useEffect(() => {
    // Mid-drag the cache is deliberately frozen and edges route cheaply; the
    // drop already forces a full precise pass.
    if (draggingNodeRef.current) {
      return;
    }
    if (!routeCacheGrewThisPass) {
      hopSettlePassesRef.current = 0;
      return;
    }

    routeCacheGrewThisPass = false;
    if (hopSettlePassesRef.current >= MAX_HOP_SETTLE_PASSES) {
      return;
    }

    hopSettlePassesRef.current += 1;
    setLayoutVersion((version) => version + 1);
  });

  const handleNodesChange = useCallback(
    (changes: NodeChange<BoardFlowNode>[]) => {
      setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as BoardFlowNode[]);
    },
    [],
  );

  const edges = useMemo<ResourceFlowEdge[]>(() => {
    // A producer starved of its own inputs cannot offer its nameplate, so
    // every capacity the labels see is scaled by the producer's real ceiling.
    // A machine merely idle for lack of demand keeps a ceiling of 1 - hooking
    // up a new consumer genuinely would speed it up.
    const supplyCeilings = new Map<string, number>();
    const ceilingFor = (sourceId: string) => {
      let ceiling = supplyCeilings.get(sourceId);
      if (ceiling === undefined) {
        ceiling = getSupplyCeiling(project, result, sourceId);
        supplyCeilings.set(sourceId, ceiling);
      }
      return ceiling;
    };
    const edgeBundles = getEdgeBundles(project, project.edges, result.edges, ceilingFor);
    const endpointOffsets = getEdgeEndpointOffsets(project);
    // The solver reports storage-bound edges at the producer's full-speed
    // rate on purpose - that is the mechanism that lets drawers absorb
    // surplus. For display we want what actually flows in: the producer's
    // real output minus what its machine consumers take, split across sinks.
    const directTakenBySourceResource = new Map<string, number>();
    const storageSinkCounts = new Map<string, number>();
    for (const edge of project.edges) {
      const key = `${edge.source}|${makeResourceKey(edge.resourceKind, edge.resourceId)}`;
      if (storagesById.has(edge.target)) {
        storageSinkCounts.set(key, (storageSinkCounts.get(key) ?? 0) + 1);
      } else {
        directTakenBySourceResource.set(
          key,
          (directTakenBySourceResource.get(key) ?? 0) +
            (result.edges[edge.id]?.transferredPerSecond ?? 0),
        );
      }
    }
    // How many lines each producer splits a resource across. The solver's
    // sourceCapacityPerSecond is the producer's total, so the surplus ratio is
    // only honest when a single edge (or single-target bundle) carries it all.
    const outletCounts = new Map<string, number>();
    for (const edge of project.edges) {
      const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
      outletCounts.set(key, (outletCounts.get(key) ?? 0) + 1);
    }

    // What actually moves on each line, storage adjustment included, resolved
    // up front because flow mode has to see every edge's figure before it can
    // style any one of them.
    //
    // Written as a bare loop with no local helper functions on purpose: a
    // function declared and called inside this memo makes the React Compiler
    // drop its memoization of the whole thing, and this is the hottest memo
    // on the board. Verified with eslint, not assumed.
    //
    // Items and fluids get their own scale. A busy item line moves tens per
    // second and a busy fluid line moves tens of thousands, so one shared
    // range would paint every item line at the cold end for ever.
    const transferredById = new Map<string, number>();
    const itemValues: number[] = [];
    const fluidValues: number[] = [];
    let itemMin = Number.POSITIVE_INFINITY;
    let itemMax = 0;
    let fluidMin = Number.POSITIVE_INFINITY;
    let fluidMax = 0;
    for (const edge of project.edges) {
      const edgeResult = result.edges[edge.id];
      const targetStorage = storagesById.get(edge.target);
      const sourceStorage = storagesById.get(edge.source);
      const sourceResult = result.nodes[edge.source];
      const resourceKey = makeResourceKey(edge.resourceKind, edge.resourceId);
      let value = edgeResult?.transferredPerSecond ?? edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      if (targetStorage && !sourceStorage && sourceResult) {
        const speed = Number.isFinite(sourceResult.utilization)
          ? Math.min(Math.max(sourceResult.utilization, 0), 1)
          : 0;
        const effectiveOutput = (sourceResult.outputs[resourceKey]?.amountPerSecond ?? 0) * speed;
        const taken = directTakenBySourceResource.get(`${edge.source}|${resourceKey}`) ?? 0;
        const sinks = storageSinkCounts.get(`${edge.source}|${resourceKey}`) ?? 1;
        value = Math.min(value, Math.max(0, effectiveOutput - taken) / sinks);
      }
      transferredById.set(edge.id, value);
      if (value > RATE_DISPLAY_EPSILON) {
        if (edge.resourceKind === "fluid") {
          fluidMin = Math.min(fluidMin, value);
          fluidMax = Math.max(fluidMax, value);
          fluidValues.push(value);
        } else {
          itemMin = Math.min(itemMin, value);
          itemMax = Math.max(itemMax, value);
          itemValues.push(value);
        }
      }
    }
    // Sorted distinct values per kind, for the rank half of the scale below.
    itemValues.sort((left, right) => left - right);
    fluidValues.sort((left, right) => left - right);
    const itemRanks = distinctRankIndex(itemValues);
    const fluidRanks = distinctRankIndex(fluidValues);

    // Each line's weight and the width that follows from it, resolved before
    // anything renders. The widths go to module scope because hops are built
    // at ROUTE time and need to know how thick the line they cross will be.
    const flowHeatById = new Map<string, number>();
    publishedEdgeStrokeWidths.clear();
    for (const edge of project.edges) {
      const isFluidEdge = edge.resourceKind === "fluid";
      const heat = anyLineMode
        ? flowHeatFor(
            transferredById.get(edge.id) ?? 0,
            isFluidEdge ? fluidMin : itemMin,
            isFluidEdge ? fluidMax : itemMax,
            isFluidEdge ? fluidRanks : itemRanks,
          )
        : 0;
      flowHeatById.set(edge.id, heat);
      publishedEdgeStrokeWidths.set(
        edge.id,
        lineThicknessMode
          ? FLOW_MODE_MIN_WIDTH + heat * (FLOW_MODE_MAX_WIDTH - FLOW_MODE_MIN_WIDTH)
          : DEFAULT_EDGE_STROKE_WIDTH,
      );
    }

    // Which parallel run each edge takes. Published before anything renders,
    // for the same reason the widths are: routing happens inside the edge
    // components, and by then this has to be settled. A changed lane offset is
    // part of the route signature, so reassignment reroutes exactly the edges
    // that moved and leaves the rest cached.
    publishEdgeLanes(project.edges);

    // Prune ghost routes synchronously (the pruneNodeDataCaches effect runs
    // after render): edges rendered this pass must not hop over or steer
    // around routes of edges that were just deleted.
    const liveEdgeIds = new Set(project.edges.map((edge) => edge.id));
    for (const id of directRouteCache.keys()) {
      if (!liveEdgeIds.has(id)) {
        directRouteCache.delete(id);
      }
    }

    const builtEdges = project.edges.map((edge, edgeIndex) => {
      const edgeResult = result.edges[edge.id];
      const unit = rateUnitSuffix(edge.resourceKind === "fluid").trim();
      const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
      const sourceStorage = storagesById.get(edge.source);
      const targetStorage = storagesById.get(edge.target);
      // Pre-computed above, storage adjustment and all.
      const transferred = transferredById.get(edge.id) ?? 0;
      // This line's place in its own kind's range: 0 is the quietest line on
      // the board, 1 the busiest. A single line, or a board where every line
      // is equal, reads as the biggest there is.
      const flowHeat = flowHeatById.get(edge.id) ?? 0;
      // isLimited almost never survives the solver's utilisation convergence,
      // since demand gets scaled down to whatever supply exists. The nameplate
      // comparison is what actually catches a starved machine. Storage soaks
      // up whatever arrives, so a line into a barrel is never starved.
      const isSupplyCapped = edgeResult?.constraint === "supply" && !targetStorage;
      const isStarvedEdge =
        isSupplyCapped || (edgeResult?.isLimited === true && !targetStorage);
      const isStorageEdge = Boolean(sourceStorage || targetStorage);
      const storageResourceKey = sourceStorage
        ? `${sourceStorage.kind}:${sourceStorage.resourceId}`
        : targetStorage
          ? `${targetStorage.kind}:${targetStorage.resourceId}`
          : undefined;
      const resource = getEdgeResource(project, edge);
      const edgeColor = getInitialResourceColor(resource);
      const sourceHandle = parseResourceHandleId(edge.sourceHandle);
      const targetHandle = parseResourceHandleId(edge.targetHandle);
      // A trash can is a small any-side card like a tank, not a machine with
      // a left input rail: routed as a "storage" endpoint so the wire docks
      // on whichever side of the can faces the producer.
      const targetIsTrashCan = targetHandle?.resourceId === TRASH_ANY_RESOURCE_ID;
      // Rails render one canonical (index-less) handle per resource; stored
      // edges may carry legacy per-slot ids. Collapse them here or React Flow
      // refuses to draw the edge and the anchor lookup misses the port.
      const canonicalSourceHandle = canonicalizeResourceHandleId(edge.sourceHandle);
      const canonicalTargetHandle = canonicalizeResourceHandleId(edge.targetHandle);
      const isStorageEdgeActive =
        !isStorageEdge || hoveredStorageResourceKey === storageResourceKey;
      const isSearchEdgeActive = edgeMatchesSearch(edge, resource, recipeSearch);
      const isStorageEdgeEmphasized = Boolean(
        isStorageEdge && (isStorageEdgeActive || isSearchEdgeActive),
      );
      const isFlowHighlighted =
        activeFlowResourceKey === makeResourceKey(edge.resourceKind, edge.resourceId);

      // Structural reuse: hover and solver rebuilds leave most edges equal,
      // and returning the previous identity lets React Flow skip re-rendering
      // (and re-routing) them entirely.
      return reuseDeepObjectIdentity(edgeObjectCache, edge.id, {
        id: edge.id,
        // Thick lines dive UNDER the cards. At 3px a wire crossing a node
        // edge-on was a detail; at 34px it buries the very ports it docks
        // into, so in thickness mode the pipe passes behind the card and only
        // its approach is visible. -1 keeps it above annotation boxes (-5),
        // which must stay the backmost thing on the board.
        zIndex: isNodeDragging
          ? 2000
          : lineThicknessMode
            ? -1
            : isFlowHighlighted
              ? 1200
              : 20,
        source: edge.source,
        target: edge.target,
        sourceHandle: canonicalSourceHandle,
        targetHandle: canonicalTargetHandle,
        type: "resourceEdge",
        data: {
          resource,
          color: edgeColor,
          demand,
          // Always the real flow. demand can sit at the full-speed rate on
          // lines the solver never converges (storage sinks), and a label
          // must never show more than actually moves.
          transferred,
          nameplateDemand: targetStorage ? undefined : edgeResult?.nameplateDemandPerSecond,
          sourceCapacity:
            outletCounts.get([edge.source, edge.resourceKind, edge.resourceId].join("|")) === 1 &&
            edgeResult?.sourceCapacityPerSecond !== undefined
              ? edgeResult.sourceCapacityPerSecond * ceilingFor(edge.source)
              : undefined,
          unit,
          isLimited: edgeResult?.isLimited === true && !targetStorage,
          isSupplyCapped,
          isStorageTarget: Boolean(targetStorage),
          isStorageEdge,
          showLabel: true,
          labelOffset: edge.labelOffset,
          sourceHandleId: canonicalSourceHandle,
          targetHandleId: canonicalTargetHandle,
          sourceSlotEndpoint: Boolean(sourceHandle && !sourceStorage),
          targetSlotEndpoint: Boolean(targetHandle && !targetStorage && !targetIsTrashCan),
          sourceStorageEndpoint: Boolean(sourceHandle && sourceStorage),
          targetStorageEndpoint: Boolean(targetHandle && (targetStorage || targetIsTrashCan)),
          sourceEndpointOffset: endpointOffsets.get(`${edge.id}:source`),
          targetEndpointOffset: endpointOffsets.get(`${edge.id}:target`),
          routeIndex: edgeIndex,
          bundle: edgeBundles.get(edge.id),
          isFlowHighlighted,
          // Flow mode: how big this line is on its own kind's scale, 0 (the
          // quietest line on the board) to 1 (the busiest). The edge draws
          // marching dashes over itself when this is set.
          flowRate: anyLineMode
            ? {
                heat: flowHeat,
                kind: flowBucketFor(edge.resourceKind),
                color: lineHeatMode,
                thickness: lineThicknessMode,
                pulse: linePulseMode,
              }
            : undefined,
          layoutEpoch: layoutVersion,
        },
        style: {
          stroke: lineHeatMode ? flowRampColor(flowHeat) : edgeColor,
          // Volume is the whole message in thickness mode, so the starved
          // dashes stand down rather than chopping up a fat pipe.
          strokeDasharray: isStarvedEdge && !lineThicknessMode ? "4 6" : undefined,
          strokeOpacity: lineThicknessMode
            ? 0.95
            : isFlowHighlighted
              ? 1
              : isStarvedEdge
                ? 0.58
                : isStorageEdge
                  ? 0.86
                  : 0.92,
          strokeWidth: lineThicknessMode
            ? FLOW_MODE_MIN_WIDTH + flowHeat * (FLOW_MODE_MAX_WIDTH - FLOW_MODE_MIN_WIDTH)
            : isFlowHighlighted
              ? 5.5
              : isStorageEdge
                ? isStorageEdgeEmphasized
                  ? 4
                  : 3.1
                : isStarvedEdge
                  ? 2.7
                  : edge.resourceKind === "fluid"
                    ? 3.4
                    : 2.9,
        },
      });
    });

    // Paint order IS depth, and it has to be the SAME order hop rendering
    // uses — otherwise a line hops over something that is drawn on top of it
    // anyway. compareEdgeDepth is that single order; see it for why thin goes
    // on top.
    //
    // Some overlap in thickness mode is not a routing failure and cannot be
    // routed away: ports on one face sit ~18px apart and a pipe can be 34px
    // wide, so two wires into two neighbouring inputs must share pixels. What
    // that overlap must not be is ambiguous or unstable — and left alone it is
    // both, because React Flow paints edges in array order and this array's
    // order came from whatever the project happened to hold.
    //
    // Applied in both modes. In thin mode every line publishes the same width,
    // so this collapses to routeIndex order — exactly the order the array was
    // already in, and not a single edge moves.
    return [...builtEdges].sort((left, right) =>
      compareEdgeDepth(
        {
          width: ownStrokeWidth(left.id),
          routeIndex: left.data?.routeIndex ?? 0,
        },
        {
          width: ownStrokeWidth(right.id),
          routeIndex: right.data?.routeIndex ?? 0,
        },
      ),
    );
  }, [
    activeFlowResourceKey,
    anyLineMode,
    hoveredStorageResourceKey,
    lineHeatMode,
    linePulseMode,
    lineThicknessMode,
    isNodeDragging,
    layoutVersion,
    project,
    recipeSearch,
    result,
    storagesById,
  ]);

  const connectResourceEdges = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      resource?: Pick<
        ResourceAmount,
        "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
      > & {
        sourceHandle?: string;
        targetHandle?: string;
      },
    ) => {
      const sourceHandleIds =
        resource?.sourceHandle && resource.kind && resource.id
          ? getRepeatedOutputHandleIds(project, sourceNodeId, resource)
          : [];
      const shouldBatchRepeatedOutputs =
        resource?.sourceHandle &&
        sourceHandleIds.length > 1 &&
        sourceHandleIds.includes(resource.sourceHandle);

      if (!resource || !shouldBatchRepeatedOutputs) {
        connectNodes(sourceNodeId, targetNodeId, resource);
        return;
      }

      const allRepeatedEdgesExist = sourceHandleIds.every((sourceHandle) =>
        project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        ),
      );

      for (const sourceHandle of sourceHandleIds) {
        const alreadyExists = project.edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.target === targetNodeId &&
            edge.resourceKind === resource.kind &&
            edge.resourceId === resource.id &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === resource.targetHandle,
        );

        if (!allRepeatedEdgesExist && alreadyExists) {
          continue;
        }

        connectNodes(sourceNodeId, targetNodeId, {
          ...resource,
          sourceHandle,
        });
      }
    },
    [connectNodes, project],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectCompletedRef.current = true;
      if (connection.source && connection.target) {
        const sourceHandle = parseResourceHandleId(connection.sourceHandle);
        const targetHandle = parseResourceHandleId(connection.targetHandle);

        if (sourceHandle && targetHandle && sourceHandle.side !== targetHandle.side) {
          // A trash can's universal port only drinks: the far end must be an
          // OUTPUT with a concrete resource, and the can takes it as-is.
          const sourceIsTrash = sourceHandle.resourceId === TRASH_ANY_RESOURCE_ID;
          const targetIsTrash = targetHandle.resourceId === TRASH_ANY_RESOURCE_ID;
          if (sourceIsTrash || targetIsTrash) {
            if (sourceIsTrash && targetIsTrash) {
              return;
            }
            const trashNodeId = sourceIsTrash ? connection.source : connection.target;
            const farEnd = sourceIsTrash
              ? {
                  nodeId: connection.target,
                  handleId: connection.targetHandle ?? undefined,
                  side: targetHandle.side,
                }
              : {
                  nodeId: connection.source,
                  handleId: connection.sourceHandle ?? undefined,
                  side: sourceHandle.side,
                };
            if (farEnd.side !== "output" || !farEnd.handleId) {
              return;
            }
            const farResource = getResourceForHandle(project, farEnd.nodeId, farEnd.handleId);
            if (farResource) {
              connectTrash(
                trashNodeId,
                { nodeId: farEnd.nodeId, handleId: farEnd.handleId },
                farResource,
              );
            }
            return;
          }

          // A custom-rate node's universal port adopts whatever it's wired to.
          const sourceIsAny = sourceHandle.resourceId === CUSTOM_RATE_ANY_RESOURCE_ID;
          const targetIsAny = targetHandle.resourceId === CUSTOM_RATE_ANY_RESOURCE_ID;
          if (sourceIsAny !== targetIsAny) {
            const customEnd = sourceIsAny
              ? { nodeId: connection.source, side: sourceHandle.side }
              : { nodeId: connection.target, side: targetHandle.side };
            const machineEnd = sourceIsAny
              ? { nodeId: connection.target, handleId: connection.targetHandle ?? undefined }
              : { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined };
            const machineResource = machineEnd.handleId
              ? getResourceForHandle(project, machineEnd.nodeId, machineEnd.handleId)
              : undefined;
            if (machineResource) {
              connectCustomRate(customEnd.nodeId, customEnd.side, machineEnd, machineResource);
            }
            return;
          }
          if (sourceIsAny && targetIsAny) {
            return;
          }

          const outputHandle =
            sourceHandle.side === "output"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const inputHandle =
            sourceHandle.side === "input"
              ? { nodeId: connection.source, handleId: connection.sourceHandle ?? undefined }
              : { nodeId: connection.target, handleId: connection.targetHandle ?? undefined };
          const outputResource = outputHandle.handleId
            ? getResourceForHandle(project, outputHandle.nodeId, outputHandle.handleId)
            : undefined;
          const inputResource = inputHandle.handleId
            ? getResourceForHandle(project, inputHandle.nodeId, inputHandle.handleId)
            : undefined;

          if (
            !outputResource ||
            !inputResource ||
            !resourceMatchesInput(outputResource, inputResource)
          ) {
            return;
          }

          connectResourceEdges(outputHandle.nodeId, inputHandle.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: outputHandle.handleId,
            targetHandle: inputHandle.handleId,
          });
          return;
        }

        if (connection.sourceHandle || connection.targetHandle) {
          return;
        }

        connectResourceEdges(connection.source, connection.target);
      }
    },
    [connectCustomRate, connectResourceEdges, connectTrash, project],
  );

  const isValidResourceConnection = useCallback(
    (connection: Connection | Edge) => isCompatibleResourceConnection(project, connection),
    [project],
  );

  const handleConnectStart = useCallback(
    (
      event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null },
    ) => {
      const eventHandle =
        event.target instanceof Element
          ? readResourceHandleElement(
              event.target.closest<HTMLElement>("[data-resource-handle='true']"),
            )
          : undefined;
      const nodeId = params.nodeId ?? eventHandle?.nodeId;
      const handleId = params.handleId ?? eventHandle?.handleId;

      connectCompletedRef.current = false;
      lastConnectionPointerRef.current = getClientPosition(event);
      draggedResourceRef.current =
        nodeId && handleId ? getDraggedResourceForHandle(project, nodeId, handleId) : undefined;
    },
    [project],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const draggedResource = draggedResourceRef.current;
      draggedResourceRef.current = undefined;
      const clientPosition = getClientPosition(event) ?? lastConnectionPointerRef.current;
      lastConnectionPointerRef.current = undefined;
      const targetHandle =
        getResourceHandleAtPosition(clientPosition) ??
        getResourceHandleAtPointer(event) ??
        getStorageHandleAtPosition(clientPosition, draggedResource) ??
        getStorageHandleAtPointer(event, draggedResource) ??
        // Anywhere on a trash card counts as its well: dropping an output on
        // the frame or header must void it, never spawn a tank on top.
        getTrashHandleAtPosition(clientPosition, draggedResource, event);

      if (connectCompletedRef.current) {
        return;
      }

      if (draggedResource && targetHandle) {
        // Dropped onto a custom-rate node's universal port: the machine side
        // decides direction (an output feeds it, an input drinks from it).
        if (
          targetHandle.resourceId === CUSTOM_RATE_ANY_RESOURCE_ID &&
          draggedResource.id !== CUSTOM_RATE_ANY_RESOURCE_ID &&
          draggedResource.id !== TRASH_ANY_RESOURCE_ID &&
          draggedResource.nodeId !== targetHandle.nodeId
        ) {
          connectCompletedRef.current = true;
          connectCustomRate(
            targetHandle.nodeId,
            draggedResource.side === "input" ? "output" : "input",
            { nodeId: draggedResource.nodeId, handleId: draggedResource.handleId },
            draggedResource,
          );
          return;
        }
        // Dropped onto a trash can: only an OUTPUT can be voided.
        if (
          targetHandle.resourceId === TRASH_ANY_RESOURCE_ID &&
          draggedResource.side === "output" &&
          draggedResource.id !== CUSTOM_RATE_ANY_RESOURCE_ID &&
          draggedResource.id !== TRASH_ANY_RESOURCE_ID &&
          draggedResource.nodeId !== targetHandle.nodeId
        ) {
          connectCompletedRef.current = true;
          connectTrash(
            targetHandle.nodeId,
            { nodeId: draggedResource.nodeId, handleId: draggedResource.handleId },
            draggedResource,
          );
          return;
        }
        if (isCompatibleDraggedResourceTarget(project, draggedResource, targetHandle)) {
          const source =
            draggedResource.side === "output"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };
          const target =
            draggedResource.side === "input"
              ? {
                  nodeId: draggedResource.nodeId,
                  handleId: draggedResource.handleId,
                }
              : {
                  nodeId: targetHandle.nodeId,
                  handleId: targetHandle.handleId,
                };
          const outputResource =
            draggedResource.side === "output"
              ? draggedResource
              : getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

          if (!outputResource) {
            return;
          }

          connectCompletedRef.current = true;
          connectResourceEdges(source.nodeId, target.nodeId, {
            kind: outputResource.kind,
            id: outputResource.id,
            displayName: outputResource.displayName,
            iconPath: outputResource.iconPath,
            iconAtlas: outputResource.iconAtlas,
            dominantColor: outputResource.dominantColor ?? outputResource.iconAtlas?.dominantColor,
            tooltip: outputResource.tooltip,
            sourceHandle: source.handleId,
            targetHandle: target.handleId,
          });
        }
        return;
      }

      const flowInstance = flowInstanceRef.current;
      if (
        !draggedResource ||
        connectCompletedRef.current ||
        isPointerOverIncompatibleFlowHandle(project, event, draggedResource) ||
        !flowInstance
      ) {
        return;
      }

      if (!clientPosition) {
        return;
      }

      if ((project.storages ?? []).some((storage) => storage.id === draggedResource.nodeId)) {
        return;
      }

      const position = flowInstance.screenToFlowPosition(clientPosition);
      addStorageForConnection(
        draggedResource,
        draggedResource.nodeId,
        draggedResource.side,
        { x: position.x - 78, y: position.y - 62 },
        draggedResource.handleId,
      );
    },
    [addStorageForConnection, connectCustomRate, connectResourceEdges, connectTrash, project],
  );

  useEffect(() => {
    const updatePointerPosition = (event: PointerEvent | MouseEvent | TouchEvent) => {
      if (!draggedResourceRef.current) {
        return;
      }

      lastConnectionPointerRef.current = getClientPosition(event);
    };

    window.addEventListener("pointermove", updatePointerPosition, { passive: true });
    window.addEventListener("mousemove", updatePointerPosition, { passive: true });
    window.addEventListener("touchmove", updatePointerPosition, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointerPosition);
      window.removeEventListener("mousemove", updatePointerPosition);
      window.removeEventListener("touchmove", updatePointerPosition);
    };
  }, []);

  const updateFlowViewportCenter = useCallback(() => {
    const instance = flowInstanceRef.current;
    const board = boardRef.current;
    if (!instance || !board) {
      return;
    }

    const rect = board.getBoundingClientRect();
    setFlowViewportCenter(
      instance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    );
  }, [setFlowViewportCenter]);

  const handleMoveStart = useCallback(() => {
    boardRef.current?.classList.add("factory-flow-board--moving");
  }, []);

  const handleMoveEnd = useCallback(() => {
    boardRef.current?.classList.remove("factory-flow-board--moving");
    updateFlowViewportCenter();
  }, [updateFlowViewportCenter]);

  const handleInit = useCallback(
    (instance: ReactFlowInstance<BoardFlowNode, ResourceFlowEdge>) => {
      flowInstanceRef.current = instance;
      window.requestAnimationFrame(updateFlowViewportCenter);
      window.setTimeout(updateFlowViewportCenter, 120);
    },
    [updateFlowViewportCenter],
  );

  const exportFlowImage = useCallback(
    async (
      format: "svg" | "png",
      requestId: string,
      fileName: string,
      projectJson: string,
      capture = false,
    ) => {
      if (exportInProgressRef.current) {
        dispatchImageExportComplete(requestId);
        return;
      }

      const viewportElement = boardRef.current?.querySelector<HTMLElement>(".react-flow__viewport");

      if (!viewportElement) {
        dispatchImageExportComplete(requestId);
        return;
      }

      exportInProgressRef.current = true;
      await nextAnimationFrame();

      const nodesBounds = getNodesBounds(flowNodes);
      const imageWidth = getExportImageSize(nodesBounds.width);
      const imageHeight = getExportImageSize(nodesBounds.height);
      const viewport = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.15,
        1.8,
        EXPORT_IMAGE_PADDING / Math.max(imageWidth, imageHeight),
      );
      const options = {
        // Read lazily so switching theme does not rebuild this callback.
        backgroundColor: CANVAS_COLOR[useThemeStore.getState().theme],
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      };

      let capturedDataUrl: string | undefined;
      try {
        if (format === "svg") {
          const svgText = embedProjectJsonInSvg(
            dataUrlToText(
              await toSvg(viewportElement, {
                ...options,
                filter: exportNodeFilter,
                skipFonts: true,
              }),
            ),
            projectJson,
          );
          downloadBlob(new Blob([svgText], { type: "image/svg+xml" }), `${fileName}.svg`);
          return;
        }

        const imageBlob = await toBlob(viewportElement, {
          ...options,
          filter: exportNodeFilter,
          pixelRatio: capture ? 1 : getExportPngPixelRatio(imageWidth, imageHeight),
          skipFonts: true,
        });
        if (!imageBlob) {
          return;
        }

        if (capture) {
          // Capture mode hands a thumbnail back to the caller (community
          // share dialog) instead of saving a file.
          capturedDataUrl = await makeThumbnailDataUrl(imageBlob);
          return;
        }

        const pngBlob = await embedProjectJsonInPng(imageBlob, projectJson);
        downloadBlob(pngBlob, `${fileName}.png`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Plan image export failed.");
      } finally {
        exportInProgressRef.current = false;
        dispatchImageExportComplete(requestId, capturedDataUrl);
      }
    },
    [flowNodes],
  );

  useEffect(() => {
    const handleExportImage = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            format?: unknown;
            requestId?: unknown;
            fileName?: unknown;
            projectJson?: unknown;
            capture?: unknown;
          }
        | undefined;

      if (
        (detail?.format !== "svg" && detail?.format !== "png") ||
        typeof detail.requestId !== "string" ||
        typeof detail.fileName !== "string" ||
        typeof detail.projectJson !== "string"
      ) {
        return;
      }

      void exportFlowImage(
        detail.format,
        detail.requestId,
        detail.fileName,
        detail.projectJson,
        detail.capture === true,
      );
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_EVENT, handleExportImage);
  }, [exportFlowImage]);

  useEffect(() => {
    const handleEdgeLabelSelect = (event: Event) => {
      const detail = (event as CustomEvent).detail as { edgeIds?: unknown } | undefined;
      if (
        !Array.isArray(detail?.edgeIds) ||
        !detail.edgeIds.every((edgeId) => typeof edgeId === "string")
      ) {
        return;
      }

      setSelectedEdgeIds(detail.edgeIds);
      setSelectedNodeIds([]);
      selectNode(undefined);
    };

    window.addEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
    return () => window.removeEventListener(FLOW_EDGE_LABEL_SELECT_EVENT, handleEdgeLabelSelect);
  }, [selectNode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        if (selectedEdgeIds.length > 0 || selectedNodeIds.length > 0) {
          selectedEdgeIds.forEach((edgeId) => deleteEdge(edgeId));
          selectedNodeIds.forEach((nodeId) => {
            if (project.nodes.some((node) => node.id === nodeId)) {
              deleteNode(nodeId);
              return;
            }

            if ((project.storages ?? []).some((storage) => storage.id === nodeId)) {
              deleteStorage(nodeId);
              return;
            }

            if ((project.annotations ?? []).some((annotation) => annotation.id === nodeId)) {
              deleteAnnotation(nodeId);
            }
          });
          setSelectedEdgeIds([]);
          setSelectedNodeIds([]);
          selectNode(undefined);
          return;
        }

        if (selectedNodeId) {
          if (project.nodes.some((node) => node.id === selectedNodeId)) {
            deleteNode(selectedNodeId);
            return;
          }

          if ((project.storages ?? []).some((storage) => storage.id === selectedNodeId)) {
            deleteStorage(selectedNodeId);
            selectNode(undefined);
            return;
          }

          if ((project.annotations ?? []).some((annotation) => annotation.id === selectedNodeId)) {
            deleteAnnotation(selectedNodeId);
            selectNode(undefined);
            return;
          }
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        setAnnotationTool(undefined);
        setDeleteMode(false);
        return;
      }

      if (event.key === "Escape") {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        cancelResourceConnection();
        setNodeColorPaintMode(undefined);
        setAnnotationTool(undefined);
        setDeleteMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cancelResourceConnection,
    deleteAnnotation,
    deleteEdge,
    deleteNode,
    deleteStorage,
    project.annotations,
    project.nodes,
    project.storages,
    selectNode,
    selectedEdgeIds,
    selectedNodeIds,
    selectedNodeId,
    setNodeColorPaintMode,
  ]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      setSelectedNodeIds(selectedNodes.map((node) => node.id));
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));

      const selectedRecipeNode = [...selectedNodes]
        .reverse()
        .find((node) => node.type === "recipeNode");
      selectNode(selectedRecipeNode?.id);
    },
    [selectNode],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (isDeleteMode) {
        if (node.type === "recipeNode" || node.type === "trashNode") {
          deleteNode(node.id);
        } else if (node.type === "storageNode") {
          deleteStorage(node.id);
        } else if (node.type === "annotationNode") {
          deleteAnnotation(node.id);
        }
        return;
      }

      if (nodeColorPaintMode !== undefined) {
        if (node.type === "recipeNode" || node.type === "trashNode") {
          updateNode(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "storageNode") {
          updateStorage(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        if (node.type === "annotationNode") {
          updateAnnotation(node.id, { colorTag: nodeColorPaintMode ?? undefined });
          return;
        }

        return;
      }

      selectNode(node.id);
    },
    [
      deleteAnnotation,
      deleteNode,
      deleteStorage,
      isDeleteMode,
      nodeColorPaintMode,
      selectNode,
      updateAnnotation,
      updateNode,
      updateStorage,
    ],
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      if (!isDeleteMode) {
        return;
      }

      event.stopPropagation();
      deleteEdge(edge.id);
    },
    [deleteEdge, isDeleteMode],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(undefined);
    cancelResourceConnection();
  }, [cancelResourceConnection, selectNode]);

  // Stable references keep the memoized PaintToolbar from re-rendering on the
  // per-frame FactoryFlow renders a node drag produces.
  const handlePaintModeChange = useCallback(
    (tag: FactoryNodeColorTag | null | undefined) => {
      setAnnotationTool(undefined);
      setDeleteMode(false);
      // Picking up the brush drops the heatmap: painting under it would look
      // like nothing happened, because the heat is covering every colour.
      if (tag !== undefined) {
        writeBoardView({ heatmapMode: false });
      }
      setNodeColorPaintMode(tag);
    },
    [setNodeColorPaintMode],
  );
  const handlePaintColorSelect = useCallback(
    (tag: FactoryNodeColorTag) => {
      setActiveColorTag(tag);
      // Changing colour mid-paint keeps painting with the new colour.
      if (nodeColorPaintMode !== undefined) {
        setNodeColorPaintMode(tag);
      }
    },
    [nodeColorPaintMode, setNodeColorPaintMode],
  );
  const handleAnnotationToolChange = useCallback(
    (tool: FactoryAnnotationKind | undefined) => {
      setNodeColorPaintMode(undefined);
      setDeleteMode(false);
      setAnnotationTool(tool);
    },
    [setNodeColorPaintMode],
  );
  const handleDeleteModeChange = useCallback(
    (enabled: boolean) => {
      setNodeColorPaintMode(undefined);
      setAnnotationTool(undefined);
      setDeleteMode(enabled);
    },
    [setNodeColorPaintMode],
  );

  const handleNodeDragStart = useCallback((_: unknown, node: Node, draggedNodes: Node[]) => {
    activelyDraggedNodeIds.clear();
    activelyDraggedNodeIds.add(node.id);
    for (const dragged of draggedNodes) {
      activelyDraggedNodeIds.add(dragged.id);
    }
    draggingNodeRef.current = true;
    setNodeDragging(true);
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "storageNode") {
        setStoragePosition(node.id, node.position);
      } else if (node.type === "annotationNode") {
        setAnnotationPosition(node.id, node.position);
      } else {
        setNodePosition(node.id, node.position);
      }

      activelyDraggedNodeIds.clear();
      draggingNodeRef.current = false;
      // The geometry-publish effect can't see the drop: React Flow streamed
      // the final position into `flowNodes` during the last drag frame, so
      // its fingerprint won't change again. Republish here — the ref already
      // holds the final layout — so the reroutes triggered by the project
      // update below compute against current positions, and bump the layout
      // version so every stale route is reissued.
      publishBoardGeometry();
      setLayoutVersion((version) => version + 1);
      setNodeDragging(false);
      setFlowNodes((currentNodes) =>
        currentNodes.map((entry) =>
          entry.id === node.id ? ({ ...entry, position: node.position } as typeof entry) : entry,
        ),
      );
    },
    [publishBoardGeometry, setAnnotationPosition, setNodePosition, setStoragePosition],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      deletedEdges.forEach((edge) => deleteEdge(edge.id));
    },
    [deleteEdge],
  );

  const commitAnnotationDraft = useCallback(
    (tool: FactoryAnnotationKind, draft: AnnotationDraft) => {
      const width = Math.abs(draft.end.x - draft.start.x);
      const height = Math.abs(draft.end.y - draft.start.y);
      const corner = {
        x: Math.min(draft.start.x, draft.end.x),
        y: Math.min(draft.start.y, draft.end.y),
      };

      if (tool === "box") {
        // A bare click (no meaningful drag) drops a default-sized shape.
        const isClick = width < 12 && height < 12;
        addAnnotation({
          kind: "box",
          colorTag: activeColorTag,
          position: isClick ? draft.start : corner,
          size: isClick
            ? { width: 280, height: 180 }
            : { width: Math.max(width, 48), height: Math.max(height, 48) },
        });
        return;
      }

      if (tool === "arrow") {
        const isClick = width < 16 && height < 16;
        addAnnotation({
          kind: "arrow",
          colorTag: activeColorTag,
          position: isClick ? draft.start : corner,
          size: isClick
            ? { width: 200, height: 8 }
            : { width: Math.max(width, 8), height: Math.max(height, 8) },
          arrowDirection: `${draft.end.y >= draft.start.y ? "down" : "up"}-${
            draft.end.x >= draft.start.x ? "right" : "left"
          }` as const,
        });
        return;
      }

      const isClick = width < 12 && height < 12;
      addAnnotation({
        kind: "text",
        colorTag: activeColorTag,
        text: "",
        position: isClick ? draft.start : corner,
        size: isClick
          ? { width: 240, height: 80 }
          : { width: Math.max(width, 96), height: Math.max(height, 40) },
      });
    },
    [activeColorTag, addAnnotation],
  );

  const handleAnnotationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tool = annotationTool;
      if (!tool || event.button !== 0) {
        return;
      }

      // The tool buttons live inside the board wrapper; they must keep working.
      if ((event.target as HTMLElement).closest("[data-board-toolbar]")) {
        return;
      }

      const instance = flowInstanceRef.current;
      if (!instance) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const start = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const draft = { start, end: start };
      annotationDraftRef.current = draft;
      setAnnotationDraft(draft);

      const handleMove = (moveEvent: PointerEvent) => {
        const current = annotationDraftRef.current;
        if (!current) {
          return;
        }

        const end = instance.screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        const next = { start: current.start, end };
        annotationDraftRef.current = next;
        setAnnotationDraft(next);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        const current = annotationDraftRef.current;
        annotationDraftRef.current = undefined;
        setAnnotationDraft(undefined);
        setAnnotationTool(undefined);
        if (current) {
          commitAnnotationDraft(tool, current);
        }
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [annotationTool, commitAnnotationDraft],
  );

  const fitViewOptions = useMemo(() => ({ padding: 0.18 }), []);

  // Turning the heat on drops the brush: painting while every node is showing
  // heat would have you picking colours you cannot see land.
  const handleHeatmapChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setNodeColorPaintMode(undefined);
      }
      writeBoardView({ heatmapMode: enabled });
    },
    [setNodeColorPaintMode],
  );

  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;

  return (
    <div
      ref={boardRef}
      className={[
        "factory-flow-board relative h-full min-h-[520px] overflow-hidden border-x border-line bg-canvas",
        isNodeDragging ? "factory-flow-board--dragging" : "",
        paintCursor ? "factory-flow-board--painting" : "",
        annotationTool ? "factory-flow-board--annotating" : "",
        isDeleteMode ? "factory-flow-board--deleting" : "",
        lineThicknessMode ? "factory-flow-board--edges-under" : "",
      ].join(" ")}
      style={
        {
          ...(paintCursor ? { "--paint-cursor": paintCursor } : undefined),
          ...(isDeleteMode ? { "--delete-cursor": getDeleteCursor() } : undefined),
        } as CSSProperties
      }
      onPointerDownCapture={handleAnnotationPointerDown}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        isValidConnection={isValidResourceConnection}
        connectionLineComponent={ResourceConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={18}
        elevateNodesOnSelect={false}
        edgesReconnectable={false}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        fitView
        fitViewOptions={fitViewOptions}
        onlyRenderVisibleElements
        minZoom={0.15}
        maxZoom={1.8}
        colorMode={theme}
        // React Flow's default ("basic") raises every edge to at least the
        // z-index of its two endpoint nodes, so an edge can never be told to
        // pass BEHIND a node it connects to — which is why asking for -1 did
        // nothing. Manual mode takes the zIndex we publish literally. This
        // board already sets an explicit zIndex on every edge, so nothing else
        // depended on the automatic elevation.
        zIndexMode="manual"
        snapToGrid={boardView.snapToGrid}
        snapGrid={BOARD_GRID_SNAP}
      >
        {boardView.canvasPattern === "none" ? null : (
          <Background
            variant={CANVAS_PATTERN_VARIANT[boardView.canvasPattern]}
            gap={BOARD_GRID_SIZE}
            // Lines tile edge to edge, so they need to be thinner than a dot
            // to read as a background instead of as graph paper.
            size={boardView.canvasPattern === "lines" ? 1 : 2}
            color={CANVAS_DOT_COLOR[theme]}
          />
        )}
        <Controls position="bottom-left" />
        {annotationDraft && annotationTool ? (
          <AnnotationDraftPreview
            tool={annotationTool}
            draft={annotationDraft}
            swatch={GT_NODE_COLORS[activeColorTag].swatch}
          />
        ) : null}
      </ReactFlow>
      <PaintToolbar
        paintMode={nodeColorPaintMode}
        onPaintModeChange={handlePaintModeChange}
        activeColorTag={activeColorTag}
        onColorSelect={handlePaintColorSelect}
        annotationTool={annotationTool}
        onAnnotationToolChange={handleAnnotationToolChange}
        isDeleteMode={isDeleteMode}
        onDeleteModeChange={handleDeleteModeChange}
      />
      <BoardViewToolbar
        view={boardView}
        onChange={writeBoardView}
        onHeatmapChange={handleHeatmapChange}
      />
      <SourceToolbar />
      {isProjectImporting ? <FlowLoadingOverlay /> : null}
    </div>
  );
}

/**
 * Board tools that drop in source-style nodes (things that produce without
 * crafting, like crop farms). Lives top-left, mirroring the paint toolbar.
 */
const RATE_UNIT_CHOICES: Array<{ unit: RateUnit; label: string; title: string }> = [
  { unit: "second", label: "/s", title: "Show all rates per second" },
  { unit: "minute", label: "/m", title: "Show all rates per minute" },
  { unit: "hour", label: "/h", title: "Show all rates per hour" },
];

const SourceToolbar = memo(function SourceToolbar() {
  const addCropFarmNode = useFactoryStore((state) => state.addCropFarmNode);
  const addTrashNode = useFactoryStore((state) => state.addTrashNode);
  const addCustomRateNode = useFactoryStore((state) => state.addCustomRateNode);
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const setRateUnit = useFactoryStore((state) => state.setRateUnit);
  // Subscribe to the DEPTHS, not the history arrays: a selector returning the
  // array itself would re-render this toolbar on every project edit.
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const canUndo = useFactoryStore((state) => state.undoHistory.length > 0);
  const canRedo = useFactoryStore((state) => state.redoHistory.length > 0);
  const historyButtonClass = (enabled: boolean) =>
    [
      "pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
      enabled ? "hover:brightness-110" : "cursor-not-allowed opacity-40",
    ].join(" ");

  return (
    <div
      data-board-toolbar
      className="nodrag pointer-events-none absolute left-3 top-3 z-20 flex items-start gap-2"
    >
      {/* History first, and set apart: it undoes everything the rest of the
          board does, so it does not belong inside the add-a-node group. */}
      <div className="pointer-events-auto mr-1 flex gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className={historyButtonClass(canUndo)}
          title={canUndo ? "Undo (Ctrl+Z)" : "Nothing to undo"}
          aria-label="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          className={historyButtonClass(canRedo)}
          title={canRedo ? "Redo (Ctrl+Shift+Z)" : "Nothing to redo"}
          aria-label="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={addCropFarmNode}
        className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
        title="Add crop farm: pick a crop and stats, it produces at the computed rate"
        aria-label="Add crop farm"
      >
        <Sprout className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={addTrashNode}
        className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
        title="Add trash can: wire any output into it — whatever flows in is voided and never shows as an output"
        aria-label="Add trash can"
      >
        <Trash className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={addCustomRateNode}
        className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110"
        title="Add custom rate node: wire it to any port, dial a rate — supplies the resource, or flips to a constant request drain"
        aria-label="Add custom rate node"
      >
        <Gauge className="h-4 w-4" />
      </button>
      <div className="pointer-events-auto flex">
        {RATE_UNIT_CHOICES.map((choice) => (
          <button
            key={choice.unit}
            type="button"
            onClick={() => setRateUnit(choice.unit)}
            title={choice.title}
            aria-pressed={rateUnit === choice.unit}
            className={[
              "flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] font-mono text-[12px] font-black",
              rateUnit === choice.unit
                ? "bg-[var(--mc-85)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                : "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110",
            ].join(" ")}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
});

function FlowLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-neutral-950/18 backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-3 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] px-4 py-3 text-sm font-semibold text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.18)]">
        <LoaderCircle className="h-5 w-5 animate-spin" />
        <span>Loading flowchart...</span>
      </div>
    </div>
  );
}

function AnnotationDraftPreview({
  tool,
  draft,
  swatch,
}: {
  tool: FactoryAnnotationKind;
  draft: AnnotationDraft;
  swatch: string;
}) {
  const x = Math.min(draft.start.x, draft.end.x);
  const y = Math.min(draft.start.y, draft.end.y);
  const width = Math.max(Math.abs(draft.end.x - draft.start.x), 2);
  const height = Math.max(Math.abs(draft.end.y - draft.start.y), 2);

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute"
        style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      >
        {tool === "arrow" ? (
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
          >
            <line
              x1={draft.start.x - x}
              y1={draft.start.y - y}
              x2={draft.end.x - x}
              y2={draft.end.y - y}
              stroke={swatch}
              strokeWidth={5}
              strokeDasharray="8 6"
              strokeLinecap="round"
            />
          </svg>
        ) : tool === "box" ? (
          <div
            className="h-full w-full border-4 border-dashed"
            style={{ borderColor: swatch, backgroundColor: `${swatch}14` }}
          />
        ) : (
          <div
            className="h-full w-full border-2 border-dashed"
            style={{ borderColor: swatch, backgroundColor: "var(--mc-78)", opacity: 0.85 }}
          />
        )}
      </div>
    </ViewportPortal>
  );
}

const ANNOTATION_TOOLS: Array<{
  kind: FactoryAnnotationKind;
  label: string;
  Icon: typeof Square;
}> = [
  { kind: "box", label: "Draw box", Icon: Square },
  { kind: "arrow", label: "Draw arrow", Icon: MoveUpRight },
  { kind: "text", label: "Add text note", Icon: Type },
];

// Memoized because FactoryFlow re-renders every frame of a node drag; with
// stable callbacks this toolbar renders only when a tool or colour changes.
/**
 * Board VIEW controls, deliberately set apart from the paint and annotation
 * tools above them. Those change the plan; these only change how you look at
 * it, and mixing the two in one strip made "does this edit my factory?" a
 * question you had to answer per button.
 */
const BoardViewToolbar = memo(function BoardViewToolbar({
  view,
  onChange,
  onHeatmapChange,
}: {
  view: BoardView;
  onChange: (patch: Partial<BoardView>) => void;
  /** Heatmap also drops the paint brush, which lives in the Zustand store. */
  onHeatmapChange: (enabled: boolean) => void;
}) {
  const { snapToGrid, canvasPattern, heatmapMode, lineHeatMode, lineThicknessMode, linePulseMode } =
    view;
  const PatternIcon =
    canvasPattern === "lines"
      ? Grid3x3
      : canvasPattern === "cross"
        ? Plus
        : canvasPattern === "none"
          ? Ban
          : Grip;
  const buttonClass = (active: boolean) =>
    [
      "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
      active ? "ring-2 ring-cyan-300" : "",
    ].join(" ");

  return (
    <div
      data-board-toolbar
      // top-16, not top-3: a clear gap below the editing tools is the whole
      // point of the grouping.
      className="nodrag pointer-events-none absolute right-3 top-16 z-20 flex items-start gap-1"
    >
      <button
        type="button"
        onClick={() =>
          onChange({
            canvasPattern:
              CANVAS_PATTERNS[
                (CANVAS_PATTERNS.indexOf(canvasPattern) + 1) % CANVAS_PATTERNS.length
              ],
          })
        }
        className={buttonClass(false)}
        title={`${CANVAS_PATTERN_LABEL[canvasPattern]} — click to change`}
        aria-label={CANVAS_PATTERN_LABEL[canvasPattern]}
      >
        <PatternIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ snapToGrid: !snapToGrid })}
        className={buttonClass(snapToGrid)}
        title={
          snapToGrid
            ? `Grid lock on — nodes snap to ${BOARD_GRID_SIZE}px`
            : "Grid lock off — nodes move freely"
        }
        aria-label={snapToGrid ? "Turn grid lock off" : "Turn grid lock on"}
        aria-pressed={snapToGrid}
      >
        <Magnet className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onHeatmapChange(!heatmapMode)}
        className={buttonClass(heatmapMode)}
        title={
          heatmapMode
            ? "Heatmap on — colours show how hard each machine runs. Click to restore your colours."
            : "Heatmap: colour every machine by how hard it runs (red = idle, green = full)"
        }
        aria-label={heatmapMode ? "Turn heatmap off" : "Turn heatmap on"}
        aria-pressed={heatmapMode}
      >
        <Flame className="h-4 w-4" />
      </button>
      {/* The three line modes, independent and mixable. Volume is always
          ranked within a kind, items against items and fluids against fluids. */}
      <button
        type="button"
        onClick={() => onChange({ lineHeatMode: !lineHeatMode })}
        className={buttonClass(lineHeatMode)}
        title={
          lineHeatMode
            ? "Line colour: by volume. Click to restore resource colours."
            : "Colour every line by how much moves through it (red = least, green = most)"
        }
        aria-label={lineHeatMode ? "Turn line colour off" : "Colour lines by volume"}
        aria-pressed={lineHeatMode}
      >
        <Palette className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ lineThicknessMode: !lineThicknessMode })}
        className={buttonClass(lineThicknessMode)}
        title={
          lineThicknessMode
            ? "Line thickness: by volume. Click to restore normal widths."
            : "Thicken every line by how much moves through it"
        }
        aria-label={lineThicknessMode ? "Turn line thickness off" : "Thicken lines by volume"}
        aria-pressed={lineThicknessMode}
      >
        <Cable className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange({ linePulseMode: !linePulseMode })}
        className={buttonClass(linePulseMode)}
        title={
          linePulseMode
            ? "Moving dashes: on. Click to stop them."
            : "Show which way each line flows, with dashes that march faster on busier lines"
        }
        aria-label={linePulseMode ? "Stop the moving dashes" : "Show moving dashes"}
        aria-pressed={linePulseMode}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
    </div>
  );
});

const PaintToolbar = memo(function PaintToolbar({
  paintMode,
  onPaintModeChange,
  activeColorTag,
  onColorSelect,
  annotationTool,
  onAnnotationToolChange,
  isDeleteMode,
  onDeleteModeChange,
}: {
  paintMode?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
  activeColorTag: FactoryNodeColorTag;
  onColorSelect: (tag: FactoryNodeColorTag) => void;
  annotationTool?: FactoryAnnotationKind;
  onAnnotationToolChange: (tool: FactoryAnnotationKind | undefined) => void;
  isDeleteMode: boolean;
  onDeleteModeChange: (enabled: boolean) => void;
}) {
  const activeColor = GT_NODE_COLORS[activeColorTag];
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  // A short grace period on close lets the pointer cross the tiny dead gaps
  // between the palette and the brush without the palette snapping shut.
  const paletteCloseTimerRef = useRef<number | undefined>(undefined);
  const openPalette = () => {
    window.clearTimeout(paletteCloseTimerRef.current);
    setPaletteOpen(true);
  };
  const scheduleClosePalette = () => {
    window.clearTimeout(paletteCloseTimerRef.current);
    paletteCloseTimerRef.current = window.setTimeout(() => setPaletteOpen(false), 250);
  };

  return (
    <div
      data-board-toolbar
      className="nodrag pointer-events-none absolute right-3 top-3 z-20 flex items-start"
    >
      <div
        className="flex items-start"
        onMouseEnter={openPalette}
        onMouseLeave={scheduleClosePalette}
      >
      <div
        className={[
          "mr-0 grid w-[156px] grid-cols-5 gap-1 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)] transition-[opacity,transform] duration-100",
          isPaletteOpen
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-2 opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => onPaintModeChange(paintMode === null ? undefined : null)}
          className={[
            "flex h-7 w-7 items-center justify-center border-2 bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]",
            paintMode === null ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
          ].join(" ")}
          title="Erase colors"
          aria-label="Erase colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {GT_NODE_COLOR_PALETTE.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            onClick={() => onColorSelect(entry.tag)}
            className={[
              "h-7 w-7 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
              activeColorTag === entry.tag
                ? "border-white ring-2 ring-cyan-300"
                : "border-[var(--mc-15)]",
            ].join(" ")}
            style={{ backgroundColor: entry.color.swatch }}
            title={entry.tag}
            aria-label={`Use ${entry.tag}`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen((open) => !open)}
        className="pointer-events-auto relative z-10 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
        title={`Color: ${activeColorTag}`}
        aria-label="Pick color"
      >
        <span
          className="h-5 w-5 border-2 border-[var(--mc-15)] shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
          style={{ backgroundColor: activeColor.swatch }}
        />
      </button>
      </div>
      <button
        type="button"
        onClick={() =>
          onPaintModeChange(paintMode !== undefined ? undefined : activeColorTag)
        }
        className={[
          "pointer-events-auto relative z-10 ml-1 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
          paintMode !== undefined ? "ring-2 ring-cyan-300" : "",
        ].join(" ")}
        title={
          paintMode !== undefined
            ? "Stop painting"
            : `Paint nodes ${activeColorTag}`
        }
        aria-label={paintMode !== undefined ? "Stop painting" : "Paint nodes"}
      >
        {paintMode === null ? <X className="h-4 w-4" /> : <Paintbrush className="h-4 w-4" />}
      </button>
      {ANNOTATION_TOOLS.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onAnnotationToolChange(annotationTool === kind ? undefined : kind)}
          className={[
            "pointer-events-auto relative z-10 ml-1 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
            annotationTool === kind ? "ring-2 ring-cyan-300" : "",
          ].join(" ")}
          title={annotationTool === kind ? "Cancel" : label}
          aria-label={annotationTool === kind ? "Cancel" : label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onDeleteModeChange(!isDeleteMode)}
        className={[
          "pointer-events-auto relative z-10 ml-1 flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]",
          isDeleteMode ? "ring-2 ring-red-400" : "",
        ].join(" ")}
        title={isDeleteMode ? "Stop deleting" : "Delete tool: click anything to remove it"}
        aria-label={isDeleteMode ? "Stop deleting" : "Delete tool"}
      >
        <Trash2 className={isDeleteMode ? "h-4 w-4 text-red-300" : "h-4 w-4"} />
      </button>
    </div>
  );
});

/** Matches the figures in a sentence: rates ("10/s", "12 L/s"), percents ("20%") and multipliers ("5×"). */
const RATE_TOKEN_PATTERN = /(\d[\d,]*(?:\.\d+)?(?:(?:\s?L)?\/[a-z]+|%|×))/g;

/**
 * Lifts the rates out of a plain-English sentence so they read as figures:
 * slightly brighter, semibold, tabular, tinted with the edge's status colour.
 */
function renderRateSentence(sentence: string, accentColor: string) {
  return sentence.split(RATE_TOKEN_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <span
        key={index}
        className="font-semibold tabular-nums"
        style={{ color: accentColor }}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ResourceEdgeComponent({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  source,
  sourceHandleId,
  targetX,
  targetY,
  targetPosition,
  target,
  targetHandleId,
  style,
  selected,
  data,
}: EdgeProps<ResourceFlowEdge>) {
  const updateEdge = useFactoryStore((state) => state.updateEdge);
  const detailLevel = useStore(selectEdgeDetailLevel);
  // Label dragging needs the exact zoom to convert a pointer delta into flow
  // units, but reading it through a subscription would re-render every edge on
  // every zoom frame. The store API gives the live value on demand instead.
  const flowStore = useStoreApi();
  const storedLabelOffsetX = data?.labelOffset?.x ?? 0;
  const storedLabelOffsetY = data?.labelOffset?.y ?? 0;
  const storedLabelOffset = { x: storedLabelOffsetX, y: storedLabelOffsetY };
  const [draftLabelOffset, setDraftLabelOffset] = useState(storedLabelOffset);
  const [isLabelDragging, setLabelDragging] = useState(false);
  const [isLabelHovered, setLabelHovered] = useState(false);
  const labelDragRef = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        offset: { x: number; y: number };
      }
    | undefined
  >(undefined);
  // While the cursor over this label sits on a slot handle underneath it, the
  // label "ducks" (pointer-events: none) so the handle receives the real,
  // trusted pointerdown and a connection can start. Geometry can force a
  // label onto a node (short edge into an overlapping drawer), and synthetic
  // event forwarding cannot start a React Flow connection.
  const labelDuckWatcherRef = useRef<((event: PointerEvent) => void) | undefined>(undefined);
  useEffect(
    () => () => {
      if (labelDuckWatcherRef.current) {
        window.removeEventListener("pointermove", labelDuckWatcherRef.current);
        labelDuckWatcherRef.current = undefined;
      }
    },
    [],
  );
  const duckLabelIfCoveringSlot = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (labelDuckWatcherRef.current) {
      return;
    }
    const labelElement = event.currentTarget;
    const coversHandle = document
      .elementsFromPoint(event.clientX, event.clientY)
      .some(
        (element) =>
          element instanceof HTMLElement &&
          !labelElement.contains(element) &&
          element.matches(".react-flow__handle[data-resource-handle='true']"),
      );
    if (!coversHandle) {
      return;
    }

    labelElement.style.pointerEvents = "none";
    setLabelHovered(false);
    const watch = (moveEvent: PointerEvent) => {
      // Mid-press (connection drag in progress): stay ducked until release.
      if (moveEvent.buttons > 0) {
        return;
      }
      const rect = labelElement.getBoundingClientRect();
      const insideLabel =
        moveEvent.clientX >= rect.left &&
        moveEvent.clientX <= rect.right &&
        moveEvent.clientY >= rect.top &&
        moveEvent.clientY <= rect.bottom;
      const stillOverHandle =
        insideLabel &&
        document
          .elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
          .some(
            (element) =>
              element instanceof HTMLElement &&
              element.matches(".react-flow__handle[data-resource-handle='true']"),
          );
      if (!stillOverHandle) {
        labelElement.style.pointerEvents = "";
        window.removeEventListener("pointermove", watch);
        labelDuckWatcherRef.current = undefined;
      }
    };
    labelDuckWatcherRef.current = watch;
    window.addEventListener("pointermove", watch);
  }, []);
  const resourceColor = data?.resource
    ? getInitialResourceColor(data.resource)
    : (data?.color ?? DEFAULT_ITEM_EDGE_COLOR);
  const theme = useThemeStore((state) => state.theme);
  // Dominant resource colours are averaged from item sprites, which makes them
  // muddy; boost saturation everywhere and lift toward white — a touch more
  // on the dark canvas.
  const vividColor = saturateHexColor(resourceColor, 0.6);
  const resolvedResourceColor =
    theme === "dark" ? brightenHexColor(vividColor, 0.2) : brightenHexColor(vividColor, 0.08);
  // Flow mode repaints the line by volume. The stroke colour is derived HERE
  // from the resource, not read from `style`, so setting style.stroke upstream
  // did nothing at all — the ramp has to be applied at the point of use.
  const flowRate = data?.flowRate;
  const edgeColor =
    flowRate?.color === true ? flowRampColor(flowRate.heat) : resolvedResourceColor;
  // Likewise the width: the branches below override style.strokeWidth for
  // highlighted and bundle-primary lines, which is exactly why only some lines
  // were thickening. In thickness mode the published width wins for every line.
  const flowWidth =
    flowRate?.thickness === true ? Number(style?.strokeWidth ?? FLOW_MODE_MIN_WIDTH) : undefined;
  // Dash geometry scales with the stroke so the marks read the same on a hair
  // line and on a fat pipe.
  const pulseStroke = flowWidth ?? Number(style?.strokeWidth ?? 3);
  const pulseDash = Math.round(Math.max(5, pulseStroke * 0.9));
  const pulseGap = Math.round(Math.max(10, pulseStroke * 1.9));
  // Speed is a real PIXELS-PER-SECOND velocity derived from volume, then
  // converted to a duration for this line's dash period. Setting the duration
  // directly made a fat line look faster than a thin one carrying the same
  // amount, because one period is further on a fat line — the width was
  // leaking into a reading that is supposed to be about flow alone.
  const pulseVelocity = PULSE_MIN_VELOCITY +
    (flowRate?.heat ?? 0) * (PULSE_MAX_VELOCITY - PULSE_MIN_VELOCITY);
  const pulseDuration = ((pulseDash + pulseGap) / pulseVelocity).toFixed(3);
  const isGlobalView = hasEdgeDetail(detailLevel, EDGE_DETAIL_GLOBAL);
  // Lit when a hovered port or label pulls this line into its flow scope.
  // Boolean selector: only involved edges re-render on hover changes.
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.edges[id]),
  );
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const isHighlighted = selected || data?.isFlowHighlighted === true || isFlowScopeLit;
  // The width this line actually draws at, resolved once. It used to be
  // written out twice — inline in the casing and again in the stroke — which
  // is how the two drifted apart in the first place.
  const coreStrokeWidth =
    flowWidth !== undefined
      ? flowWidth + (isHighlighted ? 2 : 0)
      : isHighlighted
        ? 6.5
        : data?.bundle?.role === "primary"
          ? Math.max(Number(style?.strokeWidth ?? 3.1) + 0.6, 3.7)
          : Number(style?.strokeWidth ?? 3.1);
  // AGENTS.md requires routing to be deterministic and independent of zoom
  // level. Precise routing used to be switched off below 0.45 because measuring
  // was expensive; now that measurements are cached across frames it always runs,
  // so a route no longer changes shape when the user zooms out. The one
  // exception is an edge whose endpoint node is mid-drag: measurements are
  // frozen for the whole drag, so this edge follows the pointer with cheap
  // estimated endpoints and gets its precise route back on drop.
  const shouldUsePreciseRouting =
    !activelyDraggedNodeIds.has(source) && !activelyDraggedNodeIds.has(target);
  const visualSourceCandidates = getSlotEdgeEndpointCandidates({
    nodeId: source,
    handleId: data?.sourceHandleId ?? sourceHandleId,
    position: sourcePosition,
    estimatedX: sourceX,
    estimatedY: sourceY,
    endpointOffset: data?.sourceEndpointOffset,
    isRecipeSlotEndpoint: data?.sourceSlotEndpoint,
    isStorageSlotEndpoint: data?.sourceStorageEndpoint,
    counterpartX: targetX,
    counterpartY: targetY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualTargetCandidates = getSlotEdgeEndpointCandidates({
    nodeId: target,
    handleId: data?.targetHandleId ?? targetHandleId,
    position: targetPosition,
    estimatedX: targetX,
    estimatedY: targetY,
    endpointOffset: data?.targetEndpointOffset,
    isRecipeSlotEndpoint: data?.targetSlotEndpoint,
    isStorageSlotEndpoint: data?.targetStorageEndpoint,
    counterpartX: sourceX,
    counterpartY: sourceY,
    measureEndpoints: shouldUsePreciseRouting,
  });
  const visualSource = visualSourceCandidates[0];
  const visualTarget = visualTargetCandidates[0];
  const rate = formatEdgeRateLabel(data);
  // One accent per flow state, shared by the label text, the hover ring and
  // the popover: red = starved consumer, green = producer headroom, cyan =
  // nothing to flag.
  const labelTone = isEdgeStarved(data)
    ? "starved"
    : isEdgeSurplus(data)
      ? "surplus"
      : getEdgeSupplyRatio(data) !== undefined
        ? "matched"
        : "normal";
  const labelTextColor =
    labelTone === "starved" ? "#fecaca" : labelTone === "surplus" ? "#bbf7d0" : "#f8fafc";
  const labelAccentColor =
    labelTone === "starved" ? "#f87171" : labelTone === "surplus" ? "#4ade80" : "#22d3ee";
  const labelToneWord =
    labelTone === "starved"
      ? "Starved"
      : labelTone === "surplus"
        ? "Spare capacity"
        : labelTone === "matched"
          ? "Matched"
          : undefined;
  const isHiddenBundleMember =
    data?.bundle?.role === "member" && data.bundle.mode === "single-target";
  const showLabel = Boolean(
    data?.showLabel &&
    !isHiddenBundleMember &&
      (selected || data.isFlowHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_LABELS)),
  );
  const showArrowHead = isHighlighted || hasEdgeDetail(detailLevel, EDGE_DETAIL_ARROWS);
  const labelOffset = isLabelDragging ? draftLabelOffset : storedLabelOffset;
  const routedEdge = isHiddenBundleMember
    ? getHiddenBundleMemberRoute(id, visualSource)
    : data?.bundle?.role === "primary"
      ? getBundledEdgePath({
          edgeId: id,
          routeIndex: data?.routeIndex ?? 0,
          sourceNodeId: source,
          sourceHandleIds: data.bundle.sourceHandleIds,
          sourcePosition: visualSource.side,
          estimatedSource: visualSource,
          targetNodeId: target,
          targetCandidates: visualTargetCandidates,
          targetX: visualTarget.x,
          targetY: visualTarget.y,
          targetPosition: visualTarget.side,
          usePreciseRouting: shouldUsePreciseRouting,
        })
      : data?.bundle?.mode === "multi-target"
        ? getBundledMemberEdgePath({
            edgeId: id,
            routeIndex: data?.routeIndex ?? 0,
            sourceNodeId: source,
            sourceHandleId: data.sourceHandleId ?? sourceHandleId ?? undefined,
            sourcePosition: visualSource.side,
            estimatedSource: visualSource,
            targetNodeId: target,
            targetCandidates: visualTargetCandidates,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
            bundleSourceHandleIds: data.bundle.sourceHandleIds,
            usePreciseRouting: shouldUsePreciseRouting,
          })
        : getDirectEdgePath({
            edgeId: id,
            routeIndex: data?.routeIndex ?? 0,
            sourceNodeId: source,
            sourceCandidates: visualSourceCandidates,
            sourceX: visualSource.x,
            sourceY: visualSource.y,
            sourcePosition: visualSource.side,
            targetNodeId: target,
            targetCandidates: visualTargetCandidates,
            targetX: visualTarget.x,
            targetY: visualTarget.y,
            targetPosition: visualTarget.side,
            laneOffset: getEdgeLaneOffset(id),
            useSmartRouting: shouldUsePreciseRouting,
            strokeWidth: coreStrokeWidth,
          });
  const labelX = routedEdge.labelX + labelOffset.x;
  const labelY = routedEdge.labelY + labelOffset.y;
  // Lights this line (or its whole bundle) plus both endpoint ports; shared
  // by the label and the hover-anywhere line surface below.
  const applyEdgeFlowScope = () => {
    const scopeEdges: Record<string, true> = {};
    for (const bundleEdgeId of data?.bundle?.edgeIds ?? [id]) {
      scopeEdges[bundleEdgeId] = true;
    }
    const scopePorts: Record<string, true> = {};
    const sourcePortHandle = canonicalizeResourceHandleId(data?.sourceHandleId);
    const targetPortHandle = canonicalizeResourceHandleId(data?.targetHandleId);
    if (sourcePortHandle) {
      scopePorts[`${source}|${sourcePortHandle}`] = true;
    }
    if (targetPortHandle) {
      scopePorts[`${target}|${targetPortHandle}`] = true;
    }
    setHoveredFlowScope({
      edges: scopeEdges,
      ports: scopePorts,
      nodes: { [source]: true, [target]: true },
    });
  };
  // The whole line is a hover surface now, not just the label - but it stops
  // short of the ports so it can never steal the pointer-down that starts a
  // wire drag from a chip (edges hit-test above nodes).
  const hoverTrimmedPoints = isHiddenBundleMember
    ? undefined
    : trimPolylineEnds(routedEdge.points, 26);
  const hoverPathD = hoverTrimmedPoints ? pointsToSvgPath(hoverTrimmedPoints) : undefined;


  const stopLabelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!labelDragRef.current) {
        return;
      }

      event.currentTarget.releasePointerCapture(labelDragRef.current.pointerId);
      labelDragRef.current = undefined;
      setLabelDragging(false);
      const nextOffset =
        Math.abs(draftLabelOffset.x) < 1 && Math.abs(draftLabelOffset.y) < 1
          ? undefined
          : draftLabelOffset;
      updateEdge(id, { labelOffset: nextOffset });
    },
    [draftLabelOffset, id, updateEdge],
  );

  return (
    <>
      {!isHiddenBundleMember ? (
        <>
          <path
            data-resource-edge-route={id}
            d={routedEdge.path}
            fill="none"
            stroke="transparent"
            strokeWidth="0"
            pointerEvents="none"
          />
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              stroke: "#111827",
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeOpacity: isHighlighted ? 0.95 : 0.72,
              strokeWidth: edgeCasingWidth(coreStrokeWidth),
              pointerEvents: "none",
            }}
          />
          <BaseEdge
            path={routedEdge.path}
            interactionWidth={0}
            style={{
              ...style,
              stroke: edgeColor,
              strokeDasharray: isGlobalView && isEdgeStarved(data) ? "2 8" : style?.strokeDasharray,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              // Zoom changes how much of the board you can see, never how the
              // board looks. Below 0.45 zoom every line used to drop to 0.52
              // opacity (0.28 when starved), which read as the whole plan
              // washing out for no reason the user did anything to cause.
              strokeOpacity: isHighlighted ? 1 : style?.strokeOpacity,
              strokeWidth: coreStrokeWidth,
              filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
              // Edges select/hover through their label, never the stroke:
              // edges render above nodes (zIndex 20) so their slot-anchored
              // stubs stay visible, and an interactive stroke there swallows
              // pointer-downs meant for the slot handles beneath it.
              pointerEvents: "none",
            }}
          />
          {flowRate?.pulse ? (
            // Which way it moves. Dashes march from source to target along the
            // route's own direction, faster on the busier lines. The dash and
            // gap scale with the line so they stay readable whether the stroke
            // is 3px or 34px, and the offset animates by exactly one dash+gap
            // period so the loop is seamless.
            //
            // The whole animation is declared inline as the `animation`
            // shorthand rather than as class longhands plus an inline
            // duration: one property, nothing to compose, nothing to be
            // overridden by a stale stylesheet chunk.
            <path
              d={routedEdge.path}
              fill="none"
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={Math.max(2, pulseStroke * 0.38)}
              strokeDasharray={`${pulseDash} ${pulseGap}`}
              strokeLinecap="butt"
              pointerEvents="none"
              style={{
                animation: `flow-rate-march ${pulseDuration}s linear infinite`,
                // The keyframe travels one period; this is that period.
                ["--flow-march-period" as string]: `${pulseDash + pulseGap}px`,
              }}
            />
          ) : null}
        </>
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            estimatedTargetX: visualTarget.x,
            estimatedTargetY: visualTarget.y,
            estimatedTargetPosition: visualTarget.side,
          })}
          stroke="var(--mc-15)"
          strokeWidth={isHighlighted ? 4 : 3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: isEdgeStarved(data) ? 0.72 : 0.95,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {!isHiddenBundleMember && showArrowHead ? (
        <polyline
          points={getArrowHeadPointsForRoute({
            points: routedEdge.points,
            estimatedTargetX: visualTarget.x,
            estimatedTargetY: visualTarget.y,
            estimatedTargetPosition: visualTarget.side,
          })}
          stroke={edgeColor}
          strokeWidth={isHighlighted ? 2.2 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: isEdgeStarved(data) ? 0.78 : 1,
            filter: isHighlighted ? "drop-shadow(0 0 4px rgba(34,211,238,0.9))" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {hoverPathD ? (
        <path
          d={hoverPathD}
          fill="none"
          stroke="transparent"
          // Has to cover the line it belongs to. A flat 14 was a comfortable
          // grab area for a 3px wire and a DEAD ZONE on a 34px pipe: the
          // pointer sat visibly on the pipe, outside the strip, and nothing
          // lit up. The margin keeps thin lines exactly as grabbable as they
          // were while a fat pipe is hoverable across its whole width.
          strokeWidth={Math.max(14, coreStrokeWidth + 6)}
          style={{ pointerEvents: "stroke" }}
          onMouseEnter={applyEdgeFlowScope}
          onMouseLeave={() => setHoveredFlowScope(undefined)}
          onPointerDown={(event) => {
            // Clicking the line selects the edge exactly like its label does.
            event.stopPropagation();
            window.dispatchEvent(
              new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                detail: { edgeIds: data?.bundle?.edgeIds ?? [id] },
              }),
            );
          }}
        />
      ) : null}
      {showLabel &&
      data &&
      // A crammed label (only seat is on a node) goes away — unless the user
      // parked it somewhere themselves.
      !(routedEdge.labelHidden && !data.labelOffset && !isLabelDragging) ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex cursor-grab items-center gap-1.5 border border-[var(--mc-15)] bg-[#2b2d32] px-2 py-1 text-[13px] font-medium text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.55)] transition-shadow duration-100 active:cursor-grabbing"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: labelTextColor,
              borderColor: isLabelHovered ? labelAccentColor : edgeColor,
              opacity: isHighlighted || isLabelHovered ? 1 : 0.94,
              boxShadow: isLabelHovered
                ? `0 0 0 2px ${labelAccentColor}, 0 0 12px ${labelAccentColor}66`
                : isHighlighted
                  ? "0 0 0 2px rgba(34,211,238,0.9)"
                  : undefined,
              zIndex: isLabelHovered ? 60 : undefined,
            }}
            onMouseEnter={() => {
              setLabelHovered(true);
              applyEdgeFlowScope();
            }}
            onMouseLeave={() => {
              setLabelHovered(false);
              setHoveredFlowScope(undefined);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              window.dispatchEvent(
                new CustomEvent(FLOW_EDGE_LABEL_SELECT_EVENT, {
                  detail: { edgeIds: data.bundle?.edgeIds ?? [id] },
                }),
              );
              event.currentTarget.setPointerCapture(event.pointerId);
              labelDragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                offset: labelOffset,
              };
              setLabelDragging(true);
              setDraftLabelOffset(labelOffset);
            }}
            onPointerMove={(event) => {
              const drag = labelDragRef.current;
              if (!drag) {
                duckLabelIfCoveringSlot(event);
                return;
              }

              event.stopPropagation();
              const flowPoint = screenToFlowPoint(
                { x: event.clientX, y: event.clientY },
                event.currentTarget,
              );
              const cablePoint = flowPoint
                ? getClosestPointOnPolyline(flowPoint, routedEdge.points)
                : undefined;

              if (cablePoint) {
                setDraftLabelOffset({
                  x: cablePoint.x - routedEdge.labelX,
                  y: cablePoint.y - routedEdge.labelY,
                });
              } else {
                const liveZoom = flowStore.getState().transform[2];
                const scale = liveZoom > 0 ? liveZoom : 1;
                setDraftLabelOffset({
                  x: drag.offset.x + (event.clientX - drag.clientX) / scale,
                  y: drag.offset.y + (event.clientY - drag.clientY) / scale,
                });
              }
            }}
            onPointerUp={stopLabelDrag}
            onPointerCancel={stopLabelDrag}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraftLabelOffset({ x: 0, y: 0 });
              updateEdge(id, { labelOffset: undefined });
            }}
          >
            <ResourceIcon
              resource={data.resource}
              size="sm"
              showAmount={false}
              bare
              className="!h-[22px] !w-[22px]"
            />
            <span className="font-semibold leading-none tracking-tight tabular-nums">{rate}</span>
          </div>
          {isLabelHovered && !isLabelDragging
            ? (() => {
                // The line's story from BOTH ends, built lazily on hover from
                // live store state: giver + state, each receiver + its honest
                // ask (with its share when lines pool), then who's limiting.
                const storeState = useFactoryStore.getState();
                const story = buildEdgeStory(
                  storeState.project,
                  storeState.lastResult,
                  data.bundle?.edgeIds ?? [id],
                );
                return (
                  <div
                    className="nodrag nopan pointer-events-none absolute w-72 border-2 bg-[#2b2d32] px-3 py-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.14),inset_-1px_-1px_0_rgba(0,0,0,0.55),0_6px_16px_rgba(0,0,0,0.55)]"
                    style={{
                      transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 22}px)`,
                      borderColor: labelAccentColor,
                      zIndex: 70,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <ResourceIcon
                        resource={data.resource}
                        size="sm"
                        showAmount={false}
                        bare
                        className="!h-[20px] !w-[20px]"
                      />
                      <span className="truncate text-[13px] font-semibold text-white">
                        {data.resource.displayName ?? data.resource.id}
                      </span>
                      <span
                        className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wide"
                        style={{ color: labelAccentColor }}
                      >
                        {story?.stateWord ?? labelToneWord}
                      </span>
                    </div>
                    {story ? (
                      <>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          carries{" "}
                          <span className="font-semibold tabular-nums text-slate-200">
                            {story.carriesText}
                          </span>
                        </div>
                        <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[12px] leading-snug">
                          <div className="flex gap-1.5">
                            <span className="w-9 shrink-0 text-right text-[9px] font-black uppercase leading-4 tracking-wide text-slate-500">
                              from
                            </span>
                            <span className="min-w-0 flex-1 text-slate-200">
                              {story.from.name}
                              {story.from.note ? (
                                <span className="text-slate-400"> — {story.from.note}</span>
                              ) : null}
                            </span>
                          </div>
                          {story.to.map((receiver, index) => (
                            <div key={index} className="mt-0.5 flex gap-1.5">
                              <span className="w-9 shrink-0 text-right text-[9px] font-black uppercase leading-4 tracking-wide text-slate-500">
                                to
                              </span>
                              <span className="min-w-0 flex-1 text-slate-200">
                                {receiver.name}
                                <span className="text-slate-400"> — {receiver.text}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[12px] leading-snug text-slate-300">
                          {story.lines.map((line, index) => (
                            <p key={index} className="mb-1 last:mb-0">
                              {renderRateSentence(line, labelAccentColor)}
                            </p>
                          ))}
                          {story.action ? (
                            <p
                              className={[
                                "mt-1 font-semibold",
                                story.action.tone === "fix"
                                  ? "text-amber-300"
                                  : story.action.tone === "fine"
                                    ? "text-emerald-300"
                                    : "text-slate-300",
                              ].join(" ")}
                            >
                              {story.action.text}
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-[12px] leading-snug text-slate-300">
                        {renderRateSentence(describeEdgeRate(data), labelAccentColor)}
                      </p>
                    )}
                  </div>
                );
              })()
            : null}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function ResourceConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps<BoardFlowNode>) {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const color = connectionStatus === "invalid" ? "#ef4444" : "#00d9ff";

  return (
    <g className="react-flow__connection">
      <path
        d={edgePath}
        fill="none"
        stroke="#052e36"
        strokeWidth={9}
        strokeLinecap="round"
        opacity={0.75}
      />
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        opacity={0.98}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      />
      <circle cx={toX} cy={toY} r={6} fill={color} stroke="#052e36" strokeWidth={2} />
    </g>
  );
}

function getEdgeBundles(
  project: FactoryProject,
  edges: FactoryEdge[],
  edgeResults: Record<
    string,
    {
      demandPerSecond?: number;
      transferredPerSecond?: number;
      isLimited?: boolean;
      nameplateDemandPerSecond?: number;
      sourceCapacityPerSecond?: number;
      constraint?: EdgeThroughput["constraint"];
    }
  >,
  ceilingFor: (sourceId: string) => number = () => 1,
) {
  const groups = new Map<string, FactoryEdge[]>();

  for (const edge of edges) {
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (edge.sourceHandle && (!sourceHandle || sourceHandle.side !== "output")) {
      continue;
    }

    const key = [edge.source, edge.resourceKind, edge.resourceId].join("|");
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const bundles = new Map<string, NonNullable<ResourceEdgeData["bundle"]>>();
  for (const group of groups.values()) {
    const explicitSourceHandleIds = [
      ...new Set(
        group
          .map((edge) => edge.sourceHandle)
          .filter((handleId): handleId is string => Boolean(handleId)),
      ),
    ];
    const inferredSourceHandleIds = group.some((edge) => edge.sourceHandle)
      ? []
      : inferRepeatedOutputHandleIds(project, group[0]);
    const sourceHandleIds =
      explicitSourceHandleIds.length > 1 ? explicitSourceHandleIds : inferredSourceHandleIds;
    if (sourceHandleIds.length < 2) {
      continue;
    }

    const primaryEdge = group[Math.floor(group.length / 2)];
    const targetKeys = new Set(
      group.map((edge) => `${edge.target}|${edge.targetHandle ?? ""}|${edge.resourceKind}`),
    );
    const mode = targetKeys.size === 1 ? "single-target" : "multi-target";
    const demand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.demandPerSecond ?? edge.ratePerSecond ?? 0),
      0,
    );
    const transferred = group.reduce(
      (sum, edge) =>
        sum +
        (edgeResults[edge.id]?.transferredPerSecond ??
          edgeResults[edge.id]?.demandPerSecond ??
          edge.ratePerSecond ??
          0),
      0,
    );
    const isLimited = group.some((edge) => edgeResults[edge.id]?.isLimited === true);
    const isSupplyCapped = group.some((edge) => edgeResults[edge.id]?.constraint === "supply");
    const nameplateDemand = group.reduce(
      (sum, edge) => sum + (edgeResults[edge.id]?.nameplateDemandPerSecond ?? 0),
      0,
    );
    // Every edge in the group leaves the same producer, so its capacity is one
    // shared total, not a per-edge amount to sum - scaled by how fast that
    // producer can actually run on its own inputs.
    const sourceCapacity =
      group.reduce(
        (max, edge) => Math.max(max, edgeResults[edge.id]?.sourceCapacityPerSecond ?? 0),
        0,
      ) * ceilingFor(group[0].source);
    const primarySourceHandleId = primaryEdge.sourceHandle ?? sourceHandleIds[0];
    const edgeIds = group.map((edge) => edge.id);
    if (!primarySourceHandleId) {
      continue;
    }

    for (const edge of group) {
      bundles.set(edge.id, {
        role: edge.id === primaryEdge.id ? "primary" : "member",
        mode,
        size: group.length,
        sourceHandleIds,
        primarySourceHandleId,
        edgeIds,
        demand: mode === "single-target" ? demand : undefined,
        transferred: mode === "single-target" ? transferred : undefined,
        nameplateDemand: mode === "single-target" ? nameplateDemand : undefined,
        sourceCapacity:
          mode === "single-target" && sourceCapacity > 0 ? sourceCapacity : undefined,
        isLimited,
        isSupplyCapped,
      });
    }
  }

  return bundles;
}

function getEdgeEndpointOffsets(project: FactoryProject) {
  const storagesById = new Set((project.storages ?? []).map((storage) => storage.id));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const groups = new Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >();

  const storageYById = new Map(
    (project.storages ?? []).map((storage) => [storage.id, storage.position?.y ?? 0]),
  );
  const counterpartYOf = (id: string) =>
    nodesById.get(id)?.position.y ?? storageYById.get(id) ?? 0;

  for (const edge of project.edges) {
    // Rails pool one port per resource, so every edge whose (possibly legacy
    // per-slot) handle collapses onto the same canonical id shares a port and
    // must fan out along it. Storages fan out too — several wires into one
    // tank used to dock on the same point and ride each other.
    const sourceHandle = parseResourceHandleId(edge.sourceHandle);
    if (storagesById.has(edge.source)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.source}|storage-out`,
        edgeId: edge.id,
        endpoint: "source",
        counterpartY: counterpartYOf(edge.target),
      });
    } else if (sourceHandle) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.source}|${canonicalizeResourceHandleId(edge.sourceHandle)}`,
        edgeId: edge.id,
        endpoint: "source",
        counterpartY: counterpartYOf(edge.target),
      });
    }

    const targetHandle = parseResourceHandleId(edge.targetHandle);
    if (storagesById.has(edge.target)) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.target}|storage-in`,
        edgeId: edge.id,
        endpoint: "target",
        counterpartY: counterpartYOf(edge.source),
      });
    } else if (targetHandle) {
      addEndpointOffsetGroupEntry(groups, {
        key: `${edge.target}|${canonicalizeResourceHandleId(edge.targetHandle)}`,
        edgeId: edge.id,
        endpoint: "target",
        counterpartY: counterpartYOf(edge.source),
      });
    }
  }

  const offsets = new Map<string, number>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    // Storage cards are wide open — spread their dock points far enough
    // apart to read as separate wires, not a 5px smear.
    const spacing = key.includes("|storage-") ? 16 : EDGE_ENDPOINT_SPACING;
    const sortedGroup = [...group].sort(
      (left, right) =>
        left.counterpartY - right.counterpartY ||
        left.edgeId.localeCompare(right.edgeId) ||
        left.endpoint.localeCompare(right.endpoint),
    );
    sortedGroup.forEach((entry, index) => {
      offsets.set(`${entry.edgeId}:${entry.endpoint}`, getStackedEndpointOffset(index, spacing));
    });
  }

  return offsets;
}

function getStackedEndpointOffset(index: number, spacing = EDGE_ENDPOINT_SPACING) {
  if (index === 0) {
    return 0;
  }

  const step = Math.ceil(index / 2) * spacing;
  return index % 2 === 1 ? step : -step;
}

function addEndpointOffsetGroupEntry(
  groups: Map<
    string,
    Array<{
      edgeId: string;
      endpoint: "source" | "target";
      counterpartY: number;
    }>
  >,
  entry: {
    key: string;
    edgeId: string;
    endpoint: "source" | "target";
    counterpartY: number;
  },
) {
  const group = groups.get(entry.key);
  if (group) {
    group.push(entry);
    return;
  }

  groups.set(entry.key, [entry]);
}

function inferRepeatedOutputHandleIds(project: FactoryProject, edge: FactoryEdge | undefined) {
  if (!edge) {
    return [];
  }

  return getRepeatedOutputHandleIds(project, edge.source, {
    kind: edge.resourceKind,
    id: edge.resourceId,
  });
}

function getRepeatedOutputHandleIds(
  project: FactoryProject,
  sourceNodeId: string,
  resource: Pick<ResourceAmount, "kind" | "id">,
) {
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  if (sourceStorage) {
    return [];
  }

  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  if (!sourceRecipe) {
    return [];
  }

  return sourceRecipe.outputs
    .map((output, outputIndex) =>
      output.kind === resource.kind && output.id === resource.id
        ? makeResourceHandleId("output", output, outputIndex)
        : undefined,
    )
    .filter((handleId): handleId is string => Boolean(handleId));
}

function getDirectEdgePath({
  edgeId,
  laneOffset = 0,
  routeIndex,
  sourceNodeId,
  sourceCandidates,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
  useSmartRouting = true,
  strokeWidth,
}: {
  edgeId?: string;
  laneOffset?: number;
  routeIndex?: number;
  /** Width this line will actually draw at, for hop sizing and dock tapers. */
  strokeWidth?: number;
  sourceNodeId?: string;
  sourceIsRecipeNode?: boolean;
  sourceCandidates?: SlotEdgeEndpoint[];
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetIsRecipeNode?: boolean;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
  useSmartRouting?: boolean;
}): RoutedEdgePath {
  const points =
    (useSmartRouting
      ? getBestDirectEdgePoints({
          edgeId,
          laneOffset,
          routeIndex,
          sourceNodeId,
          sourceCandidates,
          sourceX,
          sourceY,
          sourcePosition,
          targetNodeId,
          targetCandidates,
          targetX,
          targetY,
          targetPosition,
        })
      : undefined) ??
    getSimpleOrthogonalEdgePoints({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  // Labels are interactive (drag to reposition, click to select) and render
  // above nodes, so a label parked over a node blocks the slots beneath it —
  // short edges put the blind polyline midpoint exactly there. Prefer the
  // longest stretch of the route clear of EVERY node, then clear of the
  // edge's own nodes.
  const allNodeBounds = getMeasuredAvoidanceSweep().bounds.map((entry) => entry.bounds);
  const clearOfEverything =
    allNodeBounds.length > 0 ? getRouteLabelPoint(points, allNodeBounds) : undefined;
  const labelPoint = clearOfEverything ??
    getRouteLabelPoint(points, [
      getMeasuredNodeBoundsById(sourceNodeId),
      getMeasuredNodeBoundsById(targetNodeId),
    ]) ??
    getPointAtPolylineRatio(points, 0.5) ?? {
      x: (sourceX + targetX) / 2,
      y: (sourceY + targetY) / 2,
    };

  // A short edge (nodes dropped right next to each other) is narrower than
  // its own label box, so a centered label eclipses the entire line — the
  // classic "invisible edge" where only the arrowhead pokes out. Float the
  // label just above the route instead of on it.
  const routeLength = getPolylineSegments(points).reduce(
    (sum, segment) => sum + segment.length,
    0,
  );
  const labelLift = routeLength < SHORT_EDGE_LABEL_LIFT_THRESHOLD ? -SHORT_EDGE_LABEL_LIFT : 0;

  // Crammed board: when the label's seat (its whole box, not just its
  // center) would overlap any node, the label just goes away.
  const labelHidden = isPointInsideAnyMeasuredNode({
    x: labelPoint.x,
    y: labelPoint.y + labelLift,
  });

  // One collection pass, shared by the hop path below. Walking the route cache
  // is O(board), so doing it twice per edge would make a full render O(edges²)
  // — the exact shape ARCHITECTURE.md calls a bug.
  // Hop bumps are sized from the width this line actually draws at, so a
  // highlighted (thickened) line still clears what it crosses.
  const width = strokeWidth ?? ownStrokeWidth(edgeId);

  return {
    path: pointsToHoppedSvgPath(points, collectHoppedRouteSegments(edgeId, routeIndex), width),
    labelX: labelPoint.x,
    labelY: labelPoint.y + labelLift,
    labelHidden,
    points,
  };
}

// Labels render roughly 140-240px wide; below this route length a centered
// label hides more line than it annotates.
const SHORT_EDGE_LABEL_LIFT_THRESHOLD = 280;
const SHORT_EDGE_LABEL_LIFT = 40;

/**
 * Midpoint of the longest route stretch outside the given node rects, or
 * undefined when the route barely leaves them (then the plain midpoint is the
 * least-bad anchor anyway).
 */
function getRouteLabelPoint(
  points: Array<{ x: number; y: number }>,
  ownBounds: Array<{ left: number; right: number; top: number; bottom: number } | undefined>,
) {
  const rects = ownBounds.filter(
    (bounds): bounds is { left: number; right: number; top: number; bottom: number } =>
      bounds !== undefined,
  );
  if (rects.length === 0) {
    return undefined;
  }

  let bestLength = 0;
  let bestPoint: { x: number; y: number } | undefined;
  for (const segment of getPolylineSegments(points)) {
    if (segment.length < 1) {
      continue;
    }

    const insideIntervals = rects
      .map((rect) => clipSegmentToRectInterval(segment.start, segment.end, rect))
      .filter((interval): interval is [number, number] => interval !== undefined)
      .sort((left, right) => left[0] - right[0]);

    let cursor = 0;
    const gaps: Array<[number, number]> = [];
    for (const [enter, exit] of insideIntervals) {
      if (enter > cursor) {
        gaps.push([cursor, enter]);
      }
      cursor = Math.max(cursor, exit);
    }
    if (cursor < 1) {
      gaps.push([cursor, 1]);
    }

    for (const [gapStart, gapEnd] of gaps) {
      const gapLength = (gapEnd - gapStart) * segment.length;
      if (gapLength > bestLength) {
        const middle = (gapStart + gapEnd) / 2;
        bestLength = gapLength;
        bestPoint = {
          x: segment.start.x + (segment.end.x - segment.start.x) * middle,
          y: segment.start.y + (segment.end.y - segment.start.y) * middle,
        };
      }
    }
  }

  // Below ~three slot widths the label would poke past the stretch anyway.
  return bestLength >= 96 ? bestPoint : undefined;
}

/** Liang-Barsky clip: the [enter, exit] parameter interval of the segment inside the rect. */
function clipSegmentToRectInterval(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
): [number, number] | undefined {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let enter = 0;
  let exit = 1;

  const clips = [
    { p: -deltaX, q: start.x - bounds.left },
    { p: deltaX, q: bounds.right - start.x },
    { p: -deltaY, q: start.y - bounds.top },
    { p: deltaY, q: bounds.bottom - start.y },
  ];

  for (const { p, q } of clips) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) {
        return undefined;
      }
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      enter = Math.max(enter, ratio);
    } else {
      exit = Math.min(exit, ratio);
    }
    if (enter > exit) {
      return undefined;
    }
  }

  return enter < exit ? [enter, exit] : undefined;
}

function getSimpleOrthogonalEdgePoints({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceExit = offsetPointFromSide(source, sourcePosition, publishedDirectEdgeNodeClearance);
  const targetExit = offsetPointFromSide(target, targetPosition, publishedDirectEdgeNodeClearance);
  const sourceVertical = isVerticalSide(String(sourcePosition));
  const targetVertical = isVerticalSide(String(targetPosition));

  if (sourceVertical && targetVertical) {
    const routeY = (sourceExit.y + targetExit.y) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: sourceExit.x, y: routeY },
      { x: targetExit.x, y: routeY },
      targetExit,
      target,
    ]);
  }

  if (!sourceVertical && !targetVertical) {
    const routeX = (sourceExit.x + targetExit.x) / 2;
    return compactPolylinePoints([
      source,
      sourceExit,
      { x: routeX, y: sourceExit.y },
      { x: routeX, y: targetExit.y },
      targetExit,
      target,
    ]);
  }

  return compactPolylinePoints([
    source,
    sourceExit,
    sourceVertical ? { x: sourceExit.x, y: targetExit.y } : { x: targetExit.x, y: sourceExit.y },
    targetExit,
    target,
  ]);
}

function getBestDirectEdgePoints({
  edgeId,
  laneOffset,
  routeIndex,
  sourceNodeId,
  sourceCandidates,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
}: {
  edgeId?: string;
  laneOffset: number;
  routeIndex?: number;
  sourceNodeId?: string;
  sourceCandidates?: SlotEdgeEndpoint[];
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourceEndpoints =
    sourceCandidates && sourceCandidates.length > 0
      ? normalizeRouteEndpoints(sourceCandidates)
      : normalizeRouteEndpoints([{ x: sourceX, y: sourceY, side: sourcePosition }]);
  const targetEndpoints =
    targetCandidates && targetCandidates.length > 0
      ? normalizeRouteEndpoints(targetCandidates)
      : normalizeRouteEndpoints([{ x: targetX, y: targetY, side: targetPosition }]);

  // The signature reuses the shared board hash instead of serialising every
  // node's bounds per edge, so an unchanged board is an O(1) string compare and
  // a cache hit never touches the obstacle list at all.
  const routeSignature = getDirectRouteSignature({
    laneOffset,
    sourceEndpoints,
    targetEndpoints,
    boundsHash: getMeasuredAvoidanceSweep().hash,
  });
  const cachedRoute = edgeId ? directRouteCache.get(edgeId) : undefined;
  if (cachedRoute?.signature === routeSignature) {
    return cachedRoute.route.points;
  }

  // The edge's own nodes are excluded from the obstacle set below (an edge
  // must be allowed to leave its node), which made routes that tunnel through
  // their own node body score as free space — they rendered underneath the
  // node ("invisible" edges whose arrowheads poked out in odd places). The
  // crossing penalty here charges for own-node overlap beyond the unavoidable
  // stub from the slot to the node boundary, so exits still work but a route
  // that traverses the node loses to one that leaves it first.
  const sourceOwnBounds = getMeasuredNodeBoundsById(sourceNodeId);
  const targetOwnBounds = getMeasuredNodeBoundsById(targetNodeId);
  const allAvoidanceBounds = getMeasuredAvoidanceNodeBounds([sourceNodeId, targetNodeId]);
  // The edge's own nodes come back as CLIPPED obstacles: the sliver holding
  // the exit stays open (an edge must be allowed to leave), but the body is
  // solid — "come out of the output, turn around, and ride over your own
  // node" now triggers the same avoidance as crossing any other node.
  const ownClippedObstacles = [
    clipOwnBoundsForExits(sourceOwnBounds, sourceEndpoints),
    clipOwnBoundsForExits(targetOwnBounds, targetEndpoints),
  ].filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== undefined);
  const boardBounds = allAvoidanceBounds.concat(ownClippedObstacles);

  const buildCandidates = (extraRouteXs?: number[], extraRouteYs?: number[]) =>
    sourceEndpoints.flatMap((sourceEndpoint) =>
      targetEndpoints.flatMap((targetEndpoint) =>
        getDirectEdgePointCandidates({
          laneOffset,
          sourceX: sourceEndpoint.x,
          sourceY: sourceEndpoint.y,
          sourcePosition: sourceEndpoint.side,
          targetX: targetEndpoint.x,
          targetY: targetEndpoint.y,
          targetPosition: targetEndpoint.side,
          extraRouteXs,
          extraRouteYs,
          extrasOnly: Boolean(extraRouteXs || extraRouteYs),
        }).map((points) => ({
          points,
          endpointPenalty:
            getEndpointDirectionPenalty(sourceEndpoint, targetEndpoint) +
            getOwnNodeCrossingPenalty(points, sourceEndpoint, sourceOwnBounds) +
            getOwnNodeCrossingPenalty(points, targetEndpoint, targetOwnBounds),
        })),
      ),
    );
  const baseCandidates = buildCandidates();

  // The base shapes only know the two endpoints, so when a third node sits in
  // all of their corridors the least-bad candidate still crossed it. For every
  // node the base shapes could touch, add detour corridors hugging that rect
  // (and the whole blocking cluster) with clearance - the around-route the
  // scorer already prefers now always exists as a candidate.
  let blockReachLeft = Infinity;
  let blockReachRight = -Infinity;
  let blockReachTop = Infinity;
  let blockReachBottom = -Infinity;
  for (const candidate of baseCandidates) {
    for (const point of candidate.points) {
      if (point.x < blockReachLeft) blockReachLeft = point.x;
      if (point.x > blockReachRight) blockReachRight = point.x;
      if (point.y < blockReachTop) blockReachTop = point.y;
      if (point.y > blockReachBottom) blockReachBottom = point.y;
    }
  }
  const blockReachMargin = publishedEdgeLinkClearance + 1;
  const blockers = boardBounds.filter(
    (bounds) =>
      bounds.right >= blockReachLeft - blockReachMargin &&
      bounds.left <= blockReachRight + blockReachMargin &&
      bounds.bottom >= blockReachTop - blockReachMargin &&
      bounds.top <= blockReachBottom + blockReachMargin,
  );
  let candidates = baseCandidates;
  if (blockers.length > 0) {
    // Detours clear nodes by the same distance direct shapes do — corridors
    // derived from the (smaller) link clearance were the "traces around the
    // node way too close" paths.
    const detourMargin = publishedDirectEdgeNodeClearance + Math.max(publishedEdgeLinkClearance, laneOffset);
    const extraXs: number[] = [];
    const extraYs: number[] = [];
    let clusterLeft = Infinity;
    let clusterRight = -Infinity;
    let clusterTop = Infinity;
    let clusterBottom = -Infinity;
    for (const bounds of blockers) {
      if (bounds.left < clusterLeft) clusterLeft = bounds.left;
      if (bounds.right > clusterRight) clusterRight = bounds.right;
      if (bounds.top < clusterTop) clusterTop = bounds.top;
      if (bounds.bottom > clusterBottom) clusterBottom = bounds.bottom;
    }
    // Deterministic cap keeps the candidate count bounded on dense boards;
    // the cluster extremes stay uncapped so a clean outside line always
    // exists even past the cap.
    const cappedBlockers = [...blockers]
      .sort((left, right) => left.left - right.left || left.top - right.top)
      .slice(0, 6);
    for (const bounds of cappedBlockers) {
      extraXs.push(bounds.left - detourMargin, bounds.right + detourMargin);
      extraYs.push(bounds.top - detourMargin, bounds.bottom + detourMargin);
    }
    extraXs.push(clusterLeft - detourMargin, clusterRight + detourMargin);
    extraYs.push(clusterTop - detourMargin, clusterBottom + detourMargin);
    candidates = baseCandidates.concat(buildCandidates(extraXs, extraYs));
  }

  // Scoring every candidate against the whole board is what made rerouting
  // O(edges × nodes) as plans grew. A candidate can only collide with
  // geometry inside the candidates' own reach, so obstacles and existing
  // segments are prefiltered to that envelope (padded by the clearance the
  // scorer measures against) — scores are identical, the far board is skipped.
  let reachLeft = Infinity;
  let reachRight = -Infinity;
  let reachTop = Infinity;
  let reachBottom = -Infinity;
  for (const candidate of candidates) {
    for (const point of candidate.points) {
      if (point.x < reachLeft) reachLeft = point.x;
      if (point.x > reachRight) reachRight = point.x;
      if (point.y < reachTop) reachTop = point.y;
      if (point.y > reachBottom) reachBottom = point.y;
    }
  }
  const reachMargin = publishedEdgeLinkClearance + 1;
  reachLeft -= reachMargin;
  reachRight += reachMargin;
  reachTop -= reachMargin;
  reachBottom += reachMargin;

  const normalizedNodeBounds = boardBounds.filter(
    (bounds) =>
      bounds.right >= reachLeft &&
      bounds.left <= reachRight &&
      bounds.bottom >= reachTop &&
      bounds.top <= reachBottom,
  );
  const obstacleSegments = getIndexedRouteObstacleSegments(edgeId, routeIndex, routeSignature).filter(
    (segment) =>
      Math.max(segment.start.x, segment.end.x) >= reachLeft &&
      Math.min(segment.start.x, segment.end.x) <= reachRight &&
      Math.max(segment.start.y, segment.end.y) >= reachTop &&
      Math.min(segment.start.y, segment.end.y) <= reachBottom,
  );

  const bestRoute = candidates
    .map((candidate) => ({
      points: candidate.points,
      score:
        scoreEdgeRoute(candidate.points, normalizedNodeBounds, obstacleSegments) +
        candidate.endpointPenalty,
    }))
    .sort((left, right) => left.score - right.score)[0]?.points;
  if (!bestRoute) {
    return undefined;
  }

  let optimizedRoute = bestRoute;
  let optimizedScore = scoreEdgeRoute(bestRoute, normalizedNodeBounds, obstacleSegments);
  for (let pass = 0; pass < EDGE_ROUTE_RELAXATION_PASSES; pass += 1) {
    // The cache this reads from cannot change within the loop, so the filtered
    // obstacle set from above is still exact.
    const relaxedObstacleSegments = obstacleSegments;
    const relaxedRoute = candidates
      .map((candidate) => ({
        points: candidate.points,
        score:
          scoreEdgeRoute(candidate.points, normalizedNodeBounds, relaxedObstacleSegments) +
          candidate.endpointPenalty,
      }))
      .sort((left, right) => left.score - right.score)[0];
    const currentScore = scoreEdgeRoute(
      optimizedRoute,
      normalizedNodeBounds,
      relaxedObstacleSegments,
    );
    if (
      !relaxedRoute ||
      relaxedRoute.score >= currentScore ||
      relaxedRoute.score >= optimizedScore
    ) {
      break;
    }
    optimizedRoute = relaxedRoute.points;
    optimizedScore = relaxedRoute.score;
  }

  // The candidate menu can only jog once, so on packed boards its winner may
  // still cross a node - or lie exactly on top of a neighbouring wire when
  // every separated corridor scored worse. Either flaw sends the route to the
  // orthogonal A* router: its moves exist solely through free space (so a
  // found path cannot pass over any node, no matter how many bends), and its
  // congestion cost plus lane vertices beside busy wires pull it into an
  // adjacent channel instead of a stack. A failed search keeps the least-bad
  // candidate, and clean routes never pay for the search at all - which keeps
  // the initial mount cascade on big imports at the old router's speed.
  const candidateCrossesNode = boardBounds.some((bounds) =>
    polylineCrossesRect(optimizedRoute, bounds),
  );
  const candidateOverlap = routeCollinearOverlap(optimizedRoute, obstacleSegments);
  if (candidateCrossesNode || candidateOverlap > EDGE_OVERLAP_REROUTE_THRESHOLD) {
    const orthogonalRoute = findBestOrthogonalPortalRoute({
      sourceEndpoints,
      targetEndpoints,
      laneOffset,
      foreignBounds: boardBounds,
      sourceOwnBounds,
      targetOwnBounds,
      congestionSegments: obstacleSegments,
    });
    if (
      orthogonalRoute &&
      (candidateCrossesNode ||
        routeCollinearOverlap(orthogonalRoute, obstacleSegments) < candidateOverlap)
    ) {
      optimizedRoute = orthogonalRoute;
    }
  }

  if (edgeId && routeIndex !== undefined) {
    const route = buildRoutedEdgePath(optimizedRoute);
    directRouteCache.set(edgeId, {
      signature: routeSignature,
      routeIndex,
      route,
      segments: getPolylineSegments(optimizedRoute),
    });
    // Edges that already rendered this pass hopped against a cache without
    // this route in it; the board runs one more pass to fix that.
    routeCacheGrewThisPass = true;
  }

  return optimizedRoute;
}

/**
 * An edge's own node as a routing obstacle: the wall sliver holding its
 * exits stays open, the body becomes solid. Only when every endpoint sits on
 * ONE side (machine ports) — storages exit anywhere, so their bounds keep the
 * old full exemption rather than walling a legitimate exit.
 */
function clipOwnBoundsForExits(
  bounds: { left: number; right: number; top: number; bottom: number } | undefined,
  endpoints: SlotEdgeEndpoint[],
) {
  if (!bounds || endpoints.length === 0) {
    return undefined;
  }
  const side = endpoints[0]!.side;
  if (!endpoints.every((endpoint) => endpoint.side === side)) {
    return undefined;
  }
  const PAD = 4;
  let clipped: { left: number; right: number; top: number; bottom: number };
  if (side === Position.Right) {
    clipped = { ...bounds, right: Math.min(...endpoints.map((endpoint) => endpoint.x)) - PAD };
  } else if (side === Position.Left) {
    clipped = { ...bounds, left: Math.max(...endpoints.map((endpoint) => endpoint.x)) + PAD };
  } else if (side === Position.Bottom) {
    clipped = { ...bounds, bottom: Math.min(...endpoints.map((endpoint) => endpoint.y)) - PAD };
  } else {
    clipped = { ...bounds, top: Math.max(...endpoints.map((endpoint) => endpoint.y)) + PAD };
  }
  return clipped.right - clipped.left > 8 && clipped.bottom - clipped.top > 8
    ? clipped
    : undefined;
}

function getDirectEdgePointCandidates({
  laneOffset,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  extraRouteXs,
  extraRouteYs,
  extrasOnly = false,
}: {
  laneOffset: number;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  /** Detour corridor positions derived from blocking nodes' bounds. */
  extraRouteXs?: number[];
  extraRouteYs?: number[];
  /** Emit only the extra corridors (base shapes were already generated). */
  extrasOnly?: boolean;
}) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceExit = offsetPointFromSide(source, sourcePosition, publishedDirectEdgeNodeClearance);
  const targetExit = offsetPointFromSide(target, targetPosition, publishedDirectEdgeNodeClearance);
  const lane = Math.max(publishedEdgeLinkClearance, laneOffset);
  const minX = Math.min(sourceExit.x, targetExit.x);
  const maxX = Math.max(sourceExit.x, targetExit.x);
  const minY = Math.min(sourceExit.y, targetExit.y);
  const maxY = Math.max(sourceExit.y, targetExit.y);
  const routeXs = extrasOnly
    ? (extraRouteXs ?? [])
    : [
        (sourceExit.x + targetExit.x) / 2,
        minX - 56 - lane,
        maxX + 56 + lane,
        sourceExit.x + (targetExit.x >= sourceExit.x ? 72 + lane : -72 - lane),
        targetExit.x + (targetExit.x >= sourceExit.x ? -72 - lane : 72 + lane),
        ...(extraRouteXs ?? []),
      ];
  const routeYs = extrasOnly
    ? (extraRouteYs ?? [])
    : [
        (sourceExit.y + targetExit.y) / 2,
        minY - 56 - lane,
        maxY + 56 + lane,
        sourceExit.y + (targetExit.y >= sourceExit.y ? 72 + lane : -72 - lane),
        targetExit.y + (targetExit.y >= sourceExit.y ? -72 - lane : 72 + lane),
        ...(extraRouteYs ?? []),
      ];
  const candidates = extrasOnly
    ? []
    : [
        getSimpleOrthogonalEdgePoints({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        }),
      ];

  for (const routeX of routeXs) {
    candidates.push(
      compactPolylinePoints([
        source,
        sourceExit,
        { x: routeX, y: sourceExit.y },
        { x: routeX, y: targetExit.y },
        targetExit,
        target,
      ]),
    );
  }

  for (const routeY of routeYs) {
    candidates.push(
      compactPolylinePoints([
        source,
        sourceExit,
        { x: sourceExit.x, y: routeY },
        { x: targetExit.x, y: routeY },
        targetExit,
        target,
      ]),
    );
  }

  return dedupePolylineCandidates(candidates);
}

// Wires keep a visible gap off every node wall; bundle lanes shift whole
// corridors apart (capped so detours stay tight); turns cost ~40px of length
// so bends stay purposeful without being avoided at crossing prices.
// A function, not a const: the link clearance is republished when the line
// mode changes, and a module const would freeze the thin-mode value for the
// life of the page.
function orthoForeignMargin() {
  return publishedEdgeLinkClearance + 16;
}
// Port chips sit a few pixels inside the node edge, so the exit stub lands
// ~9px past the wall. Own bounds must shrink (not grow) or the start vertex
// is born inside its own obstacle and every search dies immediately.
const ORTHO_OWN_INSET = -2;
const ORTHO_LANE_CAP = 24;
const ORTHO_TURN_COST = 40;
const ORTHO_CROSSING_COST = 220;
// Above this many pixels of exact co-linear overlap with existing wires, a
// candidate route reads as "two edges on top of each other" and gets sent to
// the A* router for a proper adjacent lane.
const EDGE_OVERLAP_REROUTE_THRESHOLD = 24;

/** Total co-linear overlap between a route and existing edge segments. */
function routeCollinearOverlap(
  points: Array<{ x: number; y: number }>,
  existingSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }>,
) {
  if (existingSegments.length === 0) {
    return 0;
  }
  let overlap = 0;
  for (const segment of getPolylineSegments(points)) {
    if (segment.length < 0.5) {
      continue;
    }
    for (const existing of existingSegments) {
      if (existing.length < 0.5) {
        continue;
      }
      overlap += getCollinearOverlapLength(segment, existing);
    }
  }
  return overlap;
}

function routeAxisForSide(side: Position): "h" | "v" {
  return side === Position.Left || side === Position.Right ? "h" : "v";
}

function findBestOrthogonalPortalRoute({
  sourceEndpoints,
  targetEndpoints,
  laneOffset,
  foreignBounds,
  sourceOwnBounds,
  targetOwnBounds,
  congestionSegments,
}: {
  sourceEndpoints: SlotEdgeEndpoint[];
  targetEndpoints: SlotEdgeEndpoint[];
  laneOffset: number;
  foreignBounds: Array<{ left: number; right: number; top: number; bottom: number }>;
  sourceOwnBounds?: { left: number; right: number; top: number; bottom: number };
  targetOwnBounds?: { left: number; right: number; top: number; bottom: number };
  congestionSegments: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>;
}) {
  const lane = Math.min(ORTHO_LANE_CAP, Math.max(0, laneOffset));
  // Generous clearance first; when fat margins seal every corridor on a
  // packed board, retry tighter — a squeezed pass always beats the fallback
  // route that crosses a node.
  for (const margin of [orthoForeignMargin() + lane, publishedEdgeLinkClearance, 6]) {
  const obstacles = [
    ...foreignBounds.map((bounds) => expandBounds(bounds, margin)),
    ...[sourceOwnBounds, targetOwnBounds]
      .filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))
      .map((bounds) => expandBounds(bounds, ORTHO_OWN_INSET)),
  ];

  let best: Array<{ x: number; y: number }> | undefined;
  let bestCost = Infinity;
  let pairsTried = 0;
  for (const sourceEndpoint of sourceEndpoints) {
    for (const targetEndpoint of targetEndpoints) {
      // Storage endpoints offer up to four sides each; a handful of searches
      // is plenty to find the good exits and keeps dense imports fast.
      if (pairsTried >= 6) {
        break;
      }
      pairsTried += 1;
      const sourceExit = offsetPointFromSide(
        sourceEndpoint,
        sourceEndpoint.side,
        publishedDirectEdgeNodeClearance,
      );
      const targetExit = offsetPointFromSide(
        targetEndpoint,
        targetEndpoint.side,
        publishedDirectEdgeNodeClearance,
      );
      const spanX = Math.abs(sourceExit.x - targetExit.x);
      const spanY = Math.abs(sourceExit.y - targetExit.y);
      const pad = Math.max(240, 0.3 * (spanX + spanY));
      const window = {
        left: Math.min(sourceExit.x, targetExit.x) - pad,
        right: Math.max(sourceExit.x, targetExit.x) + pad,
        top: Math.min(sourceExit.y, targetExit.y) - pad,
        bottom: Math.max(sourceExit.y, targetExit.y) + pad,
      };
      // Bound the grid: on packed boards keep the obstacles nearest the
      // source-target line; far rects can't shape a sane route anyway. The
      // no-crossing guarantee is unaffected - obstacles that remain are
      // still absolute, and a failed search falls back rather than crossing.
      // A foreign node that swallows an exit point (ports of tightly packed
      // neighbours) would wall the search in before it starts; hugging that
      // neighbour beats failing back to a crossing route.
      const containsExit = (bounds: { left: number; right: number; top: number; bottom: number }) =>
        (sourceExit.x > bounds.left &&
          sourceExit.x < bounds.right &&
          sourceExit.y > bounds.top &&
          sourceExit.y < bounds.bottom) ||
        (targetExit.x > bounds.left &&
          targetExit.x < bounds.right &&
          targetExit.y > bounds.top &&
          targetExit.y < bounds.bottom);
      let windowObstacles = obstacles.filter(
        (bounds) =>
          bounds.right >= window.left &&
          bounds.left <= window.right &&
          bounds.bottom >= window.top &&
          bounds.top <= window.bottom &&
          !containsExit(bounds),
      );
      if (windowObstacles.length > 48) {
        const midX = (sourceExit.x + targetExit.x) / 2;
        const midY = (sourceExit.y + targetExit.y) / 2;
        windowObstacles = windowObstacles
          .map((bounds) => ({
            bounds,
            distance:
              Math.abs((bounds.left + bounds.right) / 2 - midX) +
              Math.abs((bounds.top + bounds.bottom) / 2 - midY),
          }))
          .sort(
            (left, right) =>
              left.distance - right.distance ||
              left.bounds.left - right.bounds.left ||
              left.bounds.top - right.bounds.top,
          )
          .slice(0, 48)
          .map((entry) => entry.bounds);
      }
      const congestion = congestionSegments
        .filter(
          (segment) =>
            Math.max(segment.start.x, segment.end.x) >= window.left &&
            Math.min(segment.start.x, segment.end.x) <= window.right &&
            Math.max(segment.start.y, segment.end.y) >= window.top &&
            Math.min(segment.start.y, segment.end.y) <= window.bottom,
        )
        .slice(0, 40);
      const path = findOrthogonalRoute({
        source: { ...sourceExit, axis: routeAxisForSide(sourceEndpoint.side) },
        target: { ...targetExit, axis: routeAxisForSide(targetEndpoint.side) },
        obstacles: windowObstacles,
        window,
        congestion,
        turnCost: ORTHO_TURN_COST,
        crossingCost: ORTHO_CROSSING_COST,
        nearness: { distance: publishedEdgeLinkClearance, costPerPixel: 8 },
        maxPops: 4000,
      });
      if (!path) {
        continue;
      }
      const cost =
        scoreOrthogonalPath(path, ORTHO_TURN_COST) +
        getEndpointDirectionPenalty(sourceEndpoint, targetEndpoint);
      if (cost < bestCost) {
        bestCost = cost;
        best = compactPolylinePoints([
          { x: sourceEndpoint.x, y: sourceEndpoint.y },
          ...path,
          { x: targetEndpoint.x, y: targetEndpoint.y },
        ]);
      }
    }
    if (pairsTried >= 6) {
      break;
    }
  }
  if (best) {
    return best;
  }
  }

  return undefined;
}

function getDirectRouteSignature({
  laneOffset,
  sourceEndpoints,
  targetEndpoints,
  boundsHash,
}: {
  laneOffset: number;
  sourceEndpoints: SlotEdgeEndpoint[];
  targetEndpoints: SlotEdgeEndpoint[];
  boundsHash: string;
}) {
  return `${laneOffset}|${sourceEndpoints.map(serializeSlotEdgeEndpoint).join(",")}|${targetEndpoints
    .map(serializeSlotEdgeEndpoint)
    .join(",")}|${boundsHash}`;
}

function normalizeRouteEndpoints(endpoints: SlotEdgeEndpoint[]) {
  return [...endpoints]
    .map((endpoint) => ({
      x: snapRouteCoord(endpoint.x),
      y: snapRouteCoord(endpoint.y),
      side: endpoint.side,
      freeExit: endpoint.freeExit,
    }))
    .sort(
      (left, right) =>
        getRouteSideOrder(left.side) - getRouteSideOrder(right.side) ||
        left.x - right.x ||
        left.y - right.y,
    );
}

function serializeSlotEdgeEndpoint(endpoint: SlotEdgeEndpoint) {
  return `${endpoint.x}:${endpoint.y}:${String(endpoint.side)}`;
}

function snapRouteCoord(value: number) {
  return Math.round(value / EDGE_ROUTE_SNAP_GRID) * EDGE_ROUTE_SNAP_GRID;
}

function getRouteSideOrder(side: Position) {
  switch (side) {
    case Position.Left:
      return 0;
    case Position.Right:
      return 1;
    case Position.Top:
      return 2;
    case Position.Bottom:
      return 3;
    default:
      return 4;
  }
}

function getIndexedRouteObstacleSegments(
  edgeId: string | undefined,
  routeIndex: number | undefined,
  routeSignature: string,
) {
  if (routeIndex === undefined) {
    return [];
  }

  const segments: Array<{
    edgeId: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (const [cachedEdgeId, cachedRoute] of directRouteCache) {
    if (cachedEdgeId === edgeId || cachedRoute.routeIndex >= routeIndex) {
      continue;
    }

    segments.push(
      ...cachedRoute.segments.map((segment) => ({
        ...segment,
        edgeId: cachedEdgeId,
      })),
    );
  }

  pruneStaleDirectRoutes(edgeId, routeSignature, routeIndex);
  return segments;
}

function pruneStaleDirectRoutes(
  edgeId: string | undefined,
  routeSignature: string,
  routeIndex: number,
) {
  if (!edgeId) {
    return;
  }

  const cachedRoute = directRouteCache.get(edgeId);
  if (cachedRoute && cachedRoute.signature !== routeSignature) {
    directRouteCache.delete(edgeId);
  }

  for (const [cachedEdgeId, cachedRouteEntry] of directRouteCache) {
    if (cachedRouteEntry.routeIndex >= routeIndex + 128) {
      directRouteCache.delete(cachedEdgeId);
    }
  }
}

function buildRoutedEdgePath(points: Array<{ x: number; y: number }>): RoutedEdgePath {
  const labelPoint = getPointAtPolylineRatio(points, 0.5) ??
    points[Math.floor(points.length / 2)] ?? {
      x: 0,
      y: 0,
    };
  return {
    path: pointsToSvgPath(points),
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    labelHidden: isPointInsideAnyMeasuredNode(labelPoint),
    points,
  };
}

function scoreEdgeRoute(
  points: Array<{ x: number; y: number }>,
  nodeBounds: Array<{ left: number; right: number; top: number; bottom: number }>,
  existingEdgeSegments: Array<{
    edgeId: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [],
) {
  const segments = getPolylineSegments(points);
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  let nodeHits = 0;
  let nodeOverlapLength = 0;
  let edgeIntersections = 0;
  let edgeNearness = 0;
  let edgeOverlap = 0;
  let selfIntersections = 0;
  let selfOverlap = 0;
  let foldBacks = 0;

  for (const segment of segments) {
    for (const bounds of nodeBounds) {
      const overlapLength = getSegmentRectOverlapLength(
        segment.start,
        segment.end,
        expandBounds(bounds, publishedEdgeLinkClearance),
      );
      if (overlapLength > 0) {
        nodeHits += 1;
        nodeOverlapLength += overlapLength;
      }
    }

    for (const existing of existingEdgeSegments) {
      if (segment.length < 0.5 || existing.length < 0.5) {
        continue;
      }

      if (segmentsIntersect(segment.start, segment.end, existing.start, existing.end)) {
        edgeIntersections += 1;
      }

      edgeOverlap += getCollinearOverlapLength(segment, existing);

      const distance = getSegmentDistance(segment.start, segment.end, existing.start, existing.end);
      if (distance < publishedEdgeLinkClearance) {
        edgeNearness += ((publishedEdgeLinkClearance - distance) / publishedEdgeLinkClearance) * segment.length;
      }
    }
  }

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const previousDirection = getSegmentUnitVector(previous);
    const currentDirection = getSegmentUnitVector(current);
    const dot = previousDirection.x * currentDirection.x + previousDirection.y * currentDirection.y;

    if (dot < -0.85) {
      foldBacks += 1;
    }
  }

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < segments.length; rightIndex += 1) {
      if (leftIndex === 0 && rightIndex === segments.length - 1) {
        continue;
      }

      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (segmentsIntersect(left.start, left.end, right.start, right.end)) {
        selfIntersections += 1;
      }
      selfOverlap += getCollinearOverlapLength(left, right);
    }
  }

  const turns = countPolylineTurns(points);
  return (
    nodeOverlapLength * 25_000 +
    nodeHits * 5_000 +
    selfIntersections * 1_000_000 +
    foldBacks * 750_000 +
    selfOverlap * 40_000 +
    edgeOverlap * 9_000 +
    edgeIntersections * 80_000 +
    edgeNearness * 2_500 +
    turns * 700 +
    length
  );
}

const OWN_NODE_CROSSING_WEIGHT = 25_000;
const NON_LOGICAL_EXIT_STUB_ALLOWANCE = 56;

/**
 * Overlap of a candidate route with the edge's own node rect, minus the
 * unavoidable exit stub (endpoint to node boundary along the endpoint's side)
 * and a small tolerance. Weighted like foreign node crossings in
 * scoreEdgeRoute; endpoint-only, so it is computed once per candidate and
 * survives the relaxation passes untouched.
 */
function getOwnNodeCrossingPenalty(
  points: Array<{ x: number; y: number }>,
  endpoint: SlotEdgeEndpoint,
  bounds: { left: number; right: number; top: number; bottom: number } | undefined,
) {
  if (!bounds) {
    return 0;
  }

  let overlap = 0;
  for (const segment of getPolylineSegments(points)) {
    overlap += getSegmentRectOverlapLength(segment.start, segment.end, bounds);
  }
  if (overlap <= 0) {
    return 0;
  }

  let stub = 0;
  switch (endpoint.side) {
    case Position.Right:
      stub = Math.max(0, bounds.right - endpoint.x);
      break;
    case Position.Left:
      stub = Math.max(0, endpoint.x - bounds.left);
      break;
    case Position.Top:
      stub = Math.max(0, endpoint.y - bounds.top);
      break;
    case Position.Bottom:
      stub = Math.max(0, bounds.bottom - endpoint.y);
      break;
  }
  // Non-logical exit sides only get a short free stub: a deep recipe slot
  // technically offers a top exit, but riding it the full height of the node
  // (through crate lids, glance bars, config panels) is exactly the tunneling
  // this penalty exists to stop.
  if (endpoint.freeExit === false) {
    stub = Math.min(stub, NON_LOGICAL_EXIT_STUB_ALLOWANCE);
  }

  return Math.max(0, overlap - stub - 4) * OWN_NODE_CROSSING_WEIGHT;
}

function getEndpointDirectionPenalty(source: SlotEdgeEndpoint, target: SlotEdgeEndpoint) {
  const sourceToTarget = { x: target.x - source.x, y: target.y - source.y };
  const targetToSource = { x: source.x - target.x, y: source.y - target.y };
  return (
    getSideDirectionPenalty(source.side, sourceToTarget) +
    getSideDirectionPenalty(target.side, targetToSource)
  );
}

function getSideDirectionPenalty(side: Position, direction: { x: number; y: number }) {
  const sideDirection = getSideUnitVector(side);
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1) {
    return 0;
  }

  const dot = (sideDirection.x * direction.x + sideDirection.y * direction.y) / length;
  if (dot >= 0.15) {
    return 0;
  }

  if (dot >= -0.15) {
    return 80_000;
  }

  return 900_000 + Math.abs(dot) * 250_000;
}

function getSideUnitVector(side: Position) {
  switch (side) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Right:
    default:
      return { x: 1, y: 0 };
  }
}

function getSegmentUnitVector(segment: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
}) {
  return {
    x: (segment.end.x - segment.start.x) / segment.length,
    y: (segment.end.y - segment.start.y) / segment.length,
  };
}

function offsetPointFromSide(point: { x: number; y: number }, side: Position, distance: number) {
  switch (String(side)) {
    case "left":
      return { x: point.x - distance, y: point.y };
    case "top":
      return { x: point.x, y: point.y - distance };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "right":
    default:
      return { x: point.x + distance, y: point.y };
  }
}

function getCleanDirectEdgePoints({
  laneOffset = 0,
  sourceNodeId,
  sourceX,
  sourceY,
  sourcePosition,
  targetNodeId,
  targetX,
  targetY,
  targetPosition,
}: {
  laneOffset?: number;
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
  targetPosition: Position;
}) {
  const sourceBounds = sourceNodeId ? getMeasuredNodeBounds(sourceNodeId) : undefined;
  const targetBounds = targetNodeId ? getMeasuredNodeBounds(targetNodeId) : undefined;

  if (!sourceBounds && !targetBounds) {
    return undefined;
  }

  const sourceExit = getNodeClearancePoint({
    point: { x: sourceX, y: sourceY },
    bounds: sourceBounds,
    position: sourcePosition,
    role: "source",
  });
  const targetExit = getNodeClearancePoint({
    point: { x: targetX, y: targetY },
    bounds: targetBounds,
    position: targetPosition,
    role: "target",
  });

  if (!sourceExit && !targetExit) {
    return undefined;
  }

  const start = sourceExit ?? { x: sourceX, y: sourceY };
  const end = targetExit ?? { x: targetX, y: targetY };
  const sourceSide = String(sourcePosition);
  const targetSide = String(targetPosition);
  if (sourceNodeId && sourceNodeId === targetNodeId && sourceBounds) {
    return compactPolylinePoints([
      { x: sourceX, y: sourceY },
      start,
      ...getSelfNodeEdgePoints(start, end, sourceSide, targetSide, sourceBounds, laneOffset),
      end,
      { x: targetX, y: targetY },
    ]);
  }

  const points =
    isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)
      ? getHorizontalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        )
      : getVerticalLaneDirectPoints(
          start,
          end,
          sourceSide,
          targetSide,
          sourceBounds,
          targetBounds,
          laneOffset,
        );

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    start,
    ...points,
    end,
    { x: targetX, y: targetY },
  ]);
}

function getNodeClearancePoint({
  point,
  bounds,
  position,
  role,
}: {
  point: { x: number; y: number };
  bounds?: { left: number; right: number; top: number; bottom: number };
  position: Position;
  role: "source" | "target";
}) {
  if (!bounds) {
    return undefined;
  }

  const side = String(position);
  switch (side) {
    case "right":
      return {
        x: Math.max(point.x, bounds.right) + publishedDirectEdgeNodeClearance,
        y: point.y,
      };
    case "left":
      return {
        x: Math.min(point.x, bounds.left) - publishedDirectEdgeNodeClearance,
        y: point.y,
      };
    case "bottom":
      return {
        x: point.x,
        y: Math.max(point.y, bounds.bottom) + publishedDirectEdgeNodeClearance,
      };
    case "top":
      return {
        x: point.x,
        y: Math.min(point.y, bounds.top) - publishedDirectEdgeNodeClearance,
      };
    default:
      return role === "source"
        ? {
            x: point.x + publishedDirectEdgeNodeClearance,
            y: point.y,
          }
        : {
            x: point.x - publishedDirectEdgeNodeClearance,
            y: point.y,
          };
  }
}

function getHorizontalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const goesRight = end.x >= start.x;
  const sourceWantsRight = sourceSide === "right";
  const targetWantsLeft = targetSide === "left";
  const targetWantsRight = targetSide === "right";
  const hasVerticalGap =
    sourceBounds && targetBounds ? !boundsOverlapVertically(sourceBounds, targetBounds) : false;

  if (hasVerticalGap && sourceBounds && targetBounds && (targetWantsLeft || targetWantsRight)) {
    const sourceLaneY =
      end.y >= start.y
        ? sourceBounds.bottom + publishedDirectEdgeNodeClearance + laneOffset
        : sourceBounds.top - publishedDirectEdgeNodeClearance - laneOffset;
    const targetLaneX = targetWantsLeft
      ? Math.min(end.x, targetBounds.left - publishedDirectEdgeNodeClearance - laneOffset)
      : Math.max(end.x, targetBounds.right + publishedDirectEdgeNodeClearance + laneOffset);
    return [
      { x: start.x, y: sourceLaneY },
      { x: targetLaneX, y: sourceLaneY },
      { x: targetLaneX, y: end.y },
    ];
  }

  const routeOutsideRight =
    (sourceWantsRight && !targetWantsLeft) || (!sourceSide && goesRight) || sourceSide === "right";
  const routeX = routeOutsideRight
    ? Math.max(start.x, end.x, sourceBounds?.right ?? -Infinity, targetBounds?.right ?? -Infinity) +
      publishedDirectEdgeNodeClearance +
      laneOffset
    : Math.min(start.x, end.x, sourceBounds?.left ?? Infinity, targetBounds?.left ?? Infinity) -
      publishedDirectEdgeNodeClearance -
      laneOffset;

  if (
    sourceWantsRight &&
    targetWantsLeft &&
    Math.abs(end.x - start.x) > publishedDirectEdgeNodeClearance * 3
  ) {
    const midX = (start.x + end.x) / 2;
    return [
      { x: midX, y: start.y },
      { x: midX, y: end.y },
    ];
  }

  return [
    { x: routeX, y: start.y },
    { x: routeX, y: end.y },
  ];
}

function getVerticalLaneDirectPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  sourceBounds?: { left: number; right: number; top: number; bottom: number },
  targetBounds?: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  const routeBelow = sourceSide === "bottom" || (targetSide !== "bottom" && end.y >= start.y);
  const routeY = routeBelow
    ? Math.max(
        start.y,
        end.y,
        sourceBounds?.bottom ?? -Infinity,
        targetBounds?.bottom ?? -Infinity,
      ) +
      publishedDirectEdgeNodeClearance +
      laneOffset
    : Math.min(start.y, end.y, sourceBounds?.top ?? Infinity, targetBounds?.top ?? Infinity) -
      publishedDirectEdgeNodeClearance -
      laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function getSelfNodeEdgePoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: string,
  targetSide: string,
  bounds: { left: number; right: number; top: number; bottom: number },
  laneOffset = 0,
) {
  if (isHorizontalSide(sourceSide) || isHorizontalSide(targetSide)) {
    const useLeftLane =
      targetSide === "left" ||
      (sourceSide !== "right" && Math.abs(end.x - bounds.left) < Math.abs(end.x - bounds.right));
    const routeX = useLeftLane
      ? bounds.left - publishedDirectEdgeNodeClearance - laneOffset
      : bounds.right + publishedDirectEdgeNodeClearance + laneOffset;
    const routeAbove = end.y < start.y;
    const routeY = routeAbove
      ? bounds.top - publishedDirectEdgeNodeClearance - laneOffset
      : bounds.bottom + publishedDirectEdgeNodeClearance + laneOffset;

    return [
      { x: start.x, y: routeY },
      { x: routeX, y: routeY },
      { x: routeX, y: end.y },
    ];
  }

  const routeBelow = targetSide === "bottom" || end.y >= start.y;
  const routeY = routeBelow
    ? bounds.bottom + publishedDirectEdgeNodeClearance + laneOffset
    : bounds.top - publishedDirectEdgeNodeClearance - laneOffset;

  return [
    { x: start.x, y: routeY },
    { x: end.x, y: routeY },
  ];
}

function isHorizontalSide(side: string) {
  return side === "left" || side === "right";
}

function isVerticalSide(side: string) {
  return side === "top" || side === "bottom";
}

/**
 * Which parallel run each edge takes, by edge id. Republished by the board
 * (see the edges memo) before any edge renders, because routing happens inside
 * the edge components and by then this has to be settled. The allocator itself
 * lives in edge-geometry.ts — it is pure, and that is where it can be tested.
 */
let publishedEdgeLaneIndexById = new Map<string, number>();

function publishEdgeLanes(edges: FactoryProject["edges"]) {
  publishedEdgeLaneIndexById = assignEdgeLanes(edges);
}

function getEdgeLaneOffset(edgeId: string) {
  const laneIndex =
    publishedEdgeLaneIndexById.get(edgeId) ?? getEdgeHash(edgeId, EDGE_LANE_BUCKETS);
  return laneIndex * EDGE_LANE_SPACING * publishedEdgeLaneScale;
}

function getEdgeHash(edgeId: string, buckets: number) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) | 0;
  }

  return Math.abs(hash % buckets);
}

function boundsOverlapVertically(
  left: { top: number; bottom: number },
  right: { top: number; bottom: number },
) {
  return left.bottom >= right.top && right.bottom >= left.top;
}

function getBundledEdgePath({
  edgeId,
  routeIndex,
  sourceNodeId,
  sourceHandleIds,
  sourcePosition,
  estimatedSource,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
  usePreciseRouting = true,
}: {
  edgeId: string;
  routeIndex?: number;
  sourceNodeId: string;
  sourceHandleIds: string[];
  sourcePosition: Position;
  estimatedSource: { x: number; y: number };
  targetNodeId?: string;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
  usePreciseRouting?: boolean;
}) {
  if (!usePreciseRouting) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
      useSmartRouting: false,
    });
  }

  const sourcePoints = sourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  if (sourcePoints.length < 2) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...sourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...sourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  const minY = Math.min(...sourcePoints.map((point) => point.y));
  const maxY = Math.max(...sourcePoints.map((point) => point.y));
  const trunkY = sourcePoints[Math.floor(sourcePoints.length / 2)].y;
  // The trunk is an ordinary route from the bus to the target and must obey
  // the same never-cross rules as any direct edge; only the port-side stubs
  // and the bus line itself are bundle-specific geometry.
  const trunkPoints =
    getBestDirectEdgePoints({
      edgeId,
      laneOffset: getEdgeLaneOffset(edgeId),
      routeIndex,
      sourceNodeId,
      sourceX: busX,
      sourceY: trunkY,
      sourcePosition,
      targetNodeId,
      targetCandidates,
      targetX,
      targetY,
      targetPosition,
    }) ??
    getSimpleOrthogonalEdgePoints({
      sourceX: busX,
      sourceY: trunkY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  const path = [
    ...sourcePoints.map((point) => `M ${point.x},${point.y} L ${busX},${point.y}`),
    `M ${busX},${minY} L ${busX},${maxY}`,
    pointsToHoppedSvgPath(
      trunkPoints,
      collectHoppedRouteSegments(edgeId, routeIndex),
      ownStrokeWidth(edgeId),
    ),
  ].join(" ");
  const labelPoint = getPointAtPolylineRatio(trunkPoints, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (trunkY + targetY) / 2,
  };

  return {
    path,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    labelHidden: isPointInsideAnyMeasuredNode(labelPoint),
    points: trunkPoints,
  };
}

function getBundledMemberEdgePath({
  edgeId,
  routeIndex,
  sourceNodeId,
  sourceHandleId,
  sourcePosition,
  estimatedSource,
  targetNodeId,
  targetCandidates,
  targetX,
  targetY,
  targetPosition,
  bundleSourceHandleIds,
  usePreciseRouting = true,
}: {
  edgeId: string;
  routeIndex?: number;
  sourceNodeId: string;
  sourceHandleId?: string;
  sourcePosition: Position;
  estimatedSource: { x: number; y: number };
  targetNodeId?: string;
  targetCandidates?: SlotEdgeEndpoint[];
  targetX: number;
  targetY: number;
  targetPosition: Position;
  bundleSourceHandleIds: string[];
  usePreciseRouting?: boolean;
}) {
  if (!usePreciseRouting) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
      useSmartRouting: false,
    });
  }

  const allSourcePoints = bundleSourceHandleIds
    .map((handleId) =>
      getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId,
        edgeSide: String(sourcePosition),
      }),
    )
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const ownSourcePoint = sourceHandleId
    ? getMeasuredSlotEndpoint({
        nodeId: sourceNodeId,
        handleId: sourceHandleId,
        edgeSide: String(sourcePosition),
      })
    : undefined;

  if (allSourcePoints.length < 2 || !ownSourcePoint) {
    return getDirectEdgePath({
      sourceNodeId,
      sourceX: estimatedSource.x,
      sourceY: estimatedSource.y,
      sourcePosition,
      targetNodeId,
      targetX,
      targetY,
      targetPosition,
      laneOffset: getEdgeLaneOffset(edgeId),
    });
  }

  const isLeft = String(sourcePosition) === "left";
  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const busX = isLeft
    ? (sourceBounds?.left ?? Math.min(...allSourcePoints.map((point) => point.x))) -
      EDGE_BUNDLE_CLEARANCE
    : (sourceBounds?.right ?? Math.max(...allSourcePoints.map((point) => point.x))) +
      EDGE_BUNDLE_CLEARANCE;
  // Past the bus this is an ordinary route and must dodge nodes like one.
  const points =
    getBestDirectEdgePoints({
      edgeId,
      laneOffset: getEdgeLaneOffset(edgeId),
      routeIndex,
      sourceNodeId,
      sourceX: busX,
      sourceY: ownSourcePoint.y,
      sourcePosition,
      targetNodeId,
      targetCandidates,
      targetX,
      targetY,
      targetPosition,
    }) ??
    getSimpleOrthogonalEdgePoints({
      sourceX: busX,
      sourceY: ownSourcePoint.y,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  const labelPoint = getPointAtPolylineRatio(points, 0.55) ?? {
    x: (busX + targetX) / 2,
    y: (ownSourcePoint.y + targetY) / 2,
  };
  const path = pointsToHoppedSvgPath(
      points,
      collectHoppedRouteSegments(edgeId, routeIndex),
      ownStrokeWidth(edgeId),
    );
  const [estimatedPath, estimatedLabelX, estimatedLabelY] = getSmoothStepPath({
    sourceX: busX,
    sourceY: ownSourcePoint.y,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return {
    path: path || estimatedPath,
    labelX: path ? labelPoint.x : estimatedLabelX,
    labelY: path ? labelPoint.y : estimatedLabelY,
    labelHidden: isPointInsideAnyMeasuredNode(
      path ? labelPoint : { x: estimatedLabelX, y: estimatedLabelY },
    ),
    points,
  };
}

function getTopLaneEdgePoints({
  sourceNodeId,
  sourceX,
  sourceY,
  targetNodeId,
  targetX,
  targetY,
}: {
  sourceNodeId?: string;
  sourceX: number;
  sourceY: number;
  targetNodeId?: string;
  targetX: number;
  targetY: number;
}) {
  if (!sourceNodeId || !targetNodeId) {
    return undefined;
  }

  const sourceBounds = getMeasuredNodeBounds(sourceNodeId);
  const targetBounds = getMeasuredNodeBounds(targetNodeId);
  if (!sourceBounds || !targetBounds) {
    return undefined;
  }

  const goesRight = targetX >= sourceX;
  const horizontalGap = goesRight
    ? targetBounds.left - sourceBounds.right
    : sourceBounds.left - targetBounds.right;
  const sourcePointInsideNode = sourceY >= sourceBounds.top && sourceY <= sourceBounds.bottom;
  const targetPointInsideNode = targetY >= targetBounds.top && targetY <= targetBounds.bottom;
  const roughlySameRow = Math.abs(targetY - sourceY) <= 90;

  if (
    horizontalGap < 24 ||
    horizontalGap > 900 ||
    !sourcePointInsideNode ||
    !targetPointInsideNode
  ) {
    return undefined;
  }

  if (!roughlySameRow) {
    return undefined;
  }

  const laneY = Math.min(sourceBounds.top, targetBounds.top) - 10;
  const sourceExitX = sourceX + (goesRight ? 20 : -20);
  const targetApproachX = targetX + (goesRight ? -20 : 20);

  return compactPolylinePoints([
    { x: sourceX, y: sourceY },
    { x: sourceExitX, y: sourceY },
    { x: sourceExitX, y: laneY },
    { x: targetApproachX, y: laneY },
    { x: targetApproachX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function compactPolylinePoints(points: Array<{ x: number; y: number } | undefined>) {
  const compacted: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      continue;
    }

    const previous = compacted[compacted.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function pointsToSvgPath(points: Array<{ x: number; y: number }>) {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [`M ${first.x},${first.y}`, ...rest.map((point) => `L ${point.x},${point.y}`)].join(" ");
}

/**
 * The polyline with `startTrim`/`endTrim` px shaved off its ends, or
 * undefined when the route is too short to keep a meaningful middle. The
 * hover-anywhere surface uses this so it never reaches the port chips — and
 * so it clears the plug block a machine-output wire runs beneath.
 */
function trimPolylineEnds(
  points: Array<{ x: number; y: number }>,
  startTrim: number,
  endTrim = startTrim,
) {
  const segments = getPolylineSegments(points);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= startTrim + endTrim + 8) {
    return undefined;
  }

  const pointAtDistance = (distance: number) => {
    let cursor = 0;
    for (const segment of segments) {
      if (cursor + segment.length >= distance) {
        const ratio = segment.length > 0 ? (distance - cursor) / segment.length : 0;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
          y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
        };
      }
      cursor += segment.length;
    }
    return points[points.length - 1]!;
  };

  const startDistance = startTrim;
  const endDistance = total - endTrim;
  const trimmed: Array<{ x: number; y: number }> = [pointAtDistance(startDistance)];
  let cursor = 0;
  for (const segment of segments) {
    cursor += segment.length;
    if (cursor > startDistance && cursor < endDistance) {
      trimmed.push(segment.end);
    }
  }
  trimmed.push(pointAtDistance(endDistance));
  return trimmed;
}

/**
 * Hop size for normal wires. A 5px bump clears a 3px line with room to spare,
 * and vanishes completely under a 34px pipe — the crossing reads as a flat X
 * again, which is the exact thing hops exist to prevent. Thickness mode scales
 * the bump so it still clears whatever it is hopping over.
 */
/** Air between the two strokes at the top of a hop. Snug, not floating. */
const EDGE_HOP_GAP = 3;
/** Nothing sensible needs a bump taller than this, whatever the widths say. */
const EDGE_HOP_MAX_RADIUS = 44;

/**
 * Every line's current stroke width, by edge id, published by the board.
 *
 * Hops are built at ROUTE time, where the only thing known about the line
 * being crossed is its id — so the widths have to be reachable from module
 * scope, the same way node bounds are. A hop that ignores them is either a
 * pimple under a fat pipe or a hoop over a hair.
 */
const publishedEdgeStrokeWidths = new Map<string, number>();
const DEFAULT_EDGE_STROKE_WIDTH = 3;


/**
 * How far a line must lift to clear the one it crosses: half of each stroke,
 * plus a little air. Two 3px wires give ~6px, near the old fixed 5; two 34px
 * pipes give ~37px, which is what "snug over each other" actually costs at
 * that size.
 */
function hopRadiusFor(ownWidth: number, otherWidth: number): number {
  return Math.min(ownWidth / 2 + otherWidth / 2 + EDGE_HOP_GAP, EDGE_HOP_MAX_RADIUS);
}

function ownStrokeWidth(edgeId: string | undefined): number {
  return (
    (edgeId ? publishedEdgeStrokeWidths.get(edgeId) : undefined) ?? DEFAULT_EDGE_STROKE_WIDTH
  );
}

/**
 * Segments this edge should hop over: every other routed line that sits
 * BEHIND it (see compareEdgeDepth), so exactly one side of every crossing
 * bumps and it is always the side you can see.
 *
 * Reads the same cache the relaxation loop uses, with the same staleness
 * class: a neighbour's reroute refreshes this edge on the next epoch.
 */
function collectHoppedRouteSegments(edgeId: string | undefined, routeIndex: number | undefined) {
  if (routeIndex === undefined) {
    return [];
  }

  // Compared through the PUBLISHED widths on both sides, never the render
  // width: the render width picks up a highlight bump, and a comparison where
  // one side is measured differently is not antisymmetric — both edges of a
  // pair could decide to hop, or neither.
  const own = { width: ownStrokeWidth(edgeId), routeIndex };
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
  }> = [];
  for (const [otherId, entry] of directRouteCache) {
    if (
      otherId === edgeId ||
      compareEdgeDepth(own, {
        width: ownStrokeWidth(otherId),
        routeIndex: entry.routeIndex,
      }) <= 0
    ) {
      continue;
    }
    // Carry the crossed line's thickness along with its geometry: the hop is
    // sized from it, not from a constant.
    const width = publishedEdgeStrokeWidths.get(otherId) ?? DEFAULT_EDGE_STROKE_WIDTH;
    for (const segment of entry.segments) {
      segments.push({ ...segment, width });
    }
    if (segments.length > 600) {
      break;
    }
  }
  return segments;
}

/**
 * Like pointsToSvgPath, but wherever an orthogonal segment properly crosses
 * one of the given (earlier-routed) segments, the line lifts over it in a
 * small semicircular bump - the classic schematic hop that makes crossings
 * legible instead of a flat X. Horizontal runs bump upward, vertical runs
 * bump toward the left, so the same crossing always reads the same way.
 */
function pointsToHoppedSvgPath(
  points: Array<{ x: number; y: number }>,
  otherSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
  }>,
  ownWidth = DEFAULT_EDGE_STROKE_WIDTH,
) {
  if (points.length < 2 || otherSegments.length === 0) {
    return pointsToSvgPath(points);
  }

  const first = points[0]!;
  let path = `M ${first.x},${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const horizontal = Math.abs(from.y - to.y) < 0.01;
    const vertical = Math.abs(from.x - to.x) < 0.01;
    if ((!horizontal && !vertical) || (horizontal && vertical)) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }

    // Crossings close to a bend get a SHRUNKEN bump instead of no bump:
    // margin-hugging routes turn at node corners and cross right there, and
    // the old fixed-radius end margin silently dropped exactly those hops.
    const crossings: Array<{ at: number; radius: number }> = [];
    const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    // Room available on this run caps the bump, but the target height comes
    // from the two stroke widths.
    const radiusFor = (crossAt: number, otherWidth: number) =>
      Math.min(hopRadiusFor(ownWidth, otherWidth), crossAt - low - 1, high - crossAt - 1);
    // The other line must properly OVERSHOOT this one on both sides: a
    // segment that merely ends a pixel or two past the line (T-junctions at
    // docks, lane-adjacent turns) reads as a touch, not a crossing, and a
    // hump there looks like it sits over nothing.
    const OVERSHOOT = 4;
    for (const segment of otherSegments) {
      const segmentHorizontal = Math.abs(segment.start.y - segment.end.y) < 0.01;
      const segmentVertical = Math.abs(segment.start.x - segment.end.x) < 0.01;
      if (horizontal && segmentVertical) {
        const crossAt = segment.start.x;
        const otherLow = Math.min(segment.start.y, segment.end.y);
        const otherHigh = Math.max(segment.start.y, segment.end.y);
        const radius = radiusFor(crossAt, segment.width);
        if (radius >= 2.5 && from.y > otherLow + OVERSHOOT && from.y < otherHigh - OVERSHOOT) {
          crossings.push({ at: crossAt, radius });
        }
      } else if (vertical && segmentHorizontal) {
        const crossAt = segment.start.y;
        const otherLow = Math.min(segment.start.x, segment.end.x);
        const otherHigh = Math.max(segment.start.x, segment.end.x);
        const radius = radiusFor(crossAt, segment.width);
        if (radius >= 2.5 && from.x > otherLow + OVERSHOOT && from.x < otherHigh - OVERSHOOT) {
          crossings.push({ at: crossAt, radius });
        }
      }
    }

    if (crossings.length === 0) {
      path += ` L ${to.x},${to.y}`;
      continue;
    }

    const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
    crossings.sort((left, right) => (left.at - right.at) * direction);
    const merged: Array<{ at: number; radius: number }> = [];
    for (const crossing of crossings) {
      const previous = merged[merged.length - 1];
      if (!previous || Math.abs(crossing.at - previous.at) > previous.radius + crossing.radius + 2) {
        merged.push(crossing);
      }
    }

    for (const crossing of merged) {
      const radius = crossing.radius;
      if (horizontal) {
        const beforeX = crossing.at - radius * direction;
        const afterX = crossing.at + radius * direction;
        // SVG sweep=1 is clockwise on screen: traveling east that arcs over
        // the top; traveling west needs sweep=0 for the same upward bump.
        const sweep = direction > 0 ? 1 : 0;
        path += ` L ${beforeX},${from.y} A ${radius} ${radius} 0 0 ${sweep} ${afterX},${from.y}`;
      } else {
        const beforeY = crossing.at - radius * direction;
        const afterY = crossing.at + radius * direction;
        // Traveling south, clockwise (sweep 1) bulges toward the right;
        // traveling north, sweep 0 keeps the bump on that same side.
        const sweep = direction > 0 ? 1 : 0;
        path += ` L ${from.x},${beforeY} A ${radius} ${radius} 0 0 ${sweep} ${from.x},${afterY}`;
      }
    }
    path += ` L ${to.x},${to.y}`;
  }

  return path;
}

function getPointAtPolylineRatio(points: Array<{ x: number; y: number }>, ratio: number) {
  const segments = getPolylineSegments(points);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) {
    return points[0];
  }

  let remaining = totalLength * clamp(ratio, 0, 1);
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const t = segment.length <= 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      };
    }

    remaining -= segment.length;
  }

  return points[points.length - 1];
}

function getClosestPointOnPolyline(
  point: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
) {
  return getPolylineSegments(points)
    .map((segment) => getClosestPointOnSegment(point, segment.start, segment.end))
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.point;
}

function getPolylineSegments(points: Array<{ x: number; y: number }>) {
  const segments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
  }> = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0.5) {
      segments.push({ start, end, length });
    }
  }

  return segments;
}

function dedupePolylineCandidates(candidates: Array<Array<{ x: number; y: number }>>) {
  const seen = new Set<string>();
  return candidates.filter((points) => {
    const key = points.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`).join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return points.length >= 2;
  });
}

function countPolylineTurns(points: Array<{ x: number; y: number }>) {
  let turns = 0;
  for (let index = 2; index < points.length; index += 1) {
    const previous = points[index - 2];
    const current = points[index - 1];
    const next = points[index];
    const previousHorizontal = Math.abs(previous.y - current.y) < 0.5;
    const nextHorizontal = Math.abs(current.y - next.y) < 0.5;
    if (previousHorizontal !== nextHorizontal) {
      turns += 1;
    }
  }
  return turns;
}

/**
 * Measures every node on the board once per layout epoch.
 *
 * Each edge needs the same obstacle set minus its own two endpoints, so this
 * used to walk and measure the entire board once per edge â€” O(edges x nodes)
 * forced layouts every frame. The sweep is now shared and each edge only filters
 * it.
 *
 * Nodes are ordered by id rather than by DOM order so the obstacle list (and
 * therefore route scoring) does not depend on React's mount order.
 */
function getMeasuredAvoidanceSweep() {
  if (measuredAvoidanceSweep?.epoch === measuredLayoutEpoch) {
    return measuredAvoidanceSweep;
  }

  let bounds: Array<{ id: string; bounds: MeasuredBounds }> = [];
  if (publishedBoardBounds) {
    // Published geometry covers the whole board regardless of which nodes are
    // currently mounted, and needs no DOM reads.
    bounds = publishedBoardBounds;
  } else if (typeof document !== "undefined") {
    for (const element of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = element.dataset.id;
      // Same rule as the published set above: annotations never block a wire.
      if (!id || element.classList.contains("react-flow__node-annotationNode")) {
        continue;
      }

      const cacheKey = `${measuredLayoutEpoch}|${id}`;
      let measured = measuredNodeBoundsCache.get(cacheKey);
      if (!measuredNodeBoundsCache.has(cacheKey)) {
        measured = measureNodeElementBounds(element);
        measuredNodeBoundsCache.set(cacheKey, measured);
      }

      if (measured) {
        bounds.push({ id, bounds: measured });
      }
    }
    bounds.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  // Snap and geometry-sort once, in the order `normalizeRouteBounds` would have
  // produced. Filtering an already-sorted list preserves that order, so each edge
  // no longer has to re-sort the whole board.
  const normalized = bounds
    .map((entry) => ({
      id: entry.id,
      bounds: {
        left: snapRouteCoord(entry.bounds.left),
        right: snapRouteCoord(entry.bounds.right),
        top: snapRouteCoord(entry.bounds.top),
        bottom: snapRouteCoord(entry.bounds.bottom),
      },
    }))
    .sort(
      (left, right) =>
        left.bounds.left - right.bounds.left ||
        left.bounds.top - right.bounds.top ||
        left.bounds.right - right.bounds.right,
    );

  measuredAvoidanceSweep = {
    epoch: measuredLayoutEpoch,
    bounds: normalized,
    hash: bounds
      .map(
        (entry) =>
          `${entry.id}:${snapRouteCoord(entry.bounds.left)},${snapRouteCoord(entry.bounds.top)},${snapRouteCoord(entry.bounds.right)},${snapRouteCoord(entry.bounds.bottom)}`,
      )
      .join(";"),
  };
  return measuredAvoidanceSweep;
}

function getMeasuredAvoidanceNodeBounds(excludedNodeIds: Array<string | undefined>) {
  const excluded = new Set(excludedNodeIds.filter((id): id is string => Boolean(id)));
  return getMeasuredAvoidanceSweep()
    .bounds.filter((entry) => !excluded.has(entry.id))
    .map((entry) => entry.bounds);
}

function getMeasuredNodeBoundsById(nodeId: string | undefined) {
  if (!nodeId) {
    return undefined;
  }
  return getMeasuredAvoidanceSweep().bounds.find((entry) => entry.id === nodeId)?.bounds;
}

/**
 * Whether a label ANCHORED here would overlap some node: the margins are
 * half the label box, so this tests the box, not just the center point.
 */
function isPointInsideAnyMeasuredNode(
  point: { x: number; y: number },
  marginX = 60,
  marginY = 16,
) {
  for (const entry of getMeasuredAvoidanceSweep().bounds) {
    const bounds = entry.bounds;
    if (
      point.x >= bounds.left - marginX &&
      point.x <= bounds.right + marginX &&
      point.y >= bounds.top - marginY &&
      point.y <= bounds.bottom + marginY
    ) {
      return true;
    }
  }
  return false;
}

function expandBounds(
  bounds: { left: number; right: number; top: number; bottom: number },
  amount: number,
) {
  return {
    left: bounds.left - amount,
    right: bounds.right + amount,
    top: bounds.top - amount,
    bottom: bounds.bottom + amount,
  };
}

function getSegmentRectOverlapLength(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let entry = 0;
  let exit = 1;

  const clips = [
    { p: -deltaX, q: start.x - bounds.left },
    { p: deltaX, q: bounds.right - start.x },
    { p: -deltaY, q: start.y - bounds.top },
    { p: deltaY, q: bounds.bottom - start.y },
  ];

  for (const { p, q } of clips) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) {
        return 0;
      }
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      entry = Math.max(entry, ratio);
    } else {
      exit = Math.min(exit, ratio);
    }

    if (entry > exit) {
      return 0;
    }
  }

  return Math.hypot(deltaX, deltaY) * Math.max(0, exit - entry);
}

function pointInBounds(
  point: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function segmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  const d1 = direction(secondStart, secondEnd, firstStart);
  const d2 = direction(secondStart, secondEnd, firstEnd);
  const d3 = direction(firstStart, firstEnd, secondStart);
  const d4 = direction(firstStart, firstEnd, secondEnd);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (Math.abs(d1) < 0.001 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(d2) < 0.001 && pointOnSegment(firstEnd, secondStart, secondEnd)) ||
    (Math.abs(d3) < 0.001 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(d4) < 0.001 && pointOnSegment(secondEnd, firstStart, firstEnd))
  );
}

function direction(
  start: { x: number; y: number },
  end: { x: number; y: number },
  point: { x: number; y: number },
) {
  return (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
}

function pointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return (
    point.x >= Math.min(start.x, end.x) - 0.001 &&
    point.x <= Math.max(start.x, end.x) + 0.001 &&
    point.y >= Math.min(start.y, end.y) - 0.001 &&
    point.y <= Math.max(start.y, end.y) + 0.001
  );
}

function getClosestPointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  const distanceX = point.x - closest.x;
  const distanceY = point.y - closest.y;

  return {
    point: closest,
    distanceSquared: distanceX * distanceX + distanceY * distanceY,
  };
}

function getSegmentDistance(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }

  return Math.sqrt(
    Math.min(
      getClosestPointOnSegment(firstStart, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(firstEnd, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(secondStart, firstStart, firstEnd).distanceSquared,
      getClosestPointOnSegment(secondEnd, firstStart, firstEnd).distanceSquared,
    ),
  );
}

function getCollinearOverlapLength(
  first: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
  second: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
) {
  const firstHorizontal = Math.abs(first.start.y - first.end.y) < 0.5;
  const secondHorizontal = Math.abs(second.start.y - second.end.y) < 0.5;
  const firstVertical = Math.abs(first.start.x - first.end.x) < 0.5;
  const secondVertical = Math.abs(second.start.x - second.end.x) < 0.5;

  if (firstHorizontal && secondHorizontal && Math.abs(first.start.y - second.start.y) < 0.5) {
    return getRangeOverlapLength(first.start.x, first.end.x, second.start.x, second.end.x);
  }

  if (firstVertical && secondVertical && Math.abs(first.start.x - second.start.x) < 0.5) {
    return getRangeOverlapLength(first.start.y, first.end.y, second.start.y, second.end.y);
  }

  return 0;
}

function getRangeOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  const firstMin = Math.min(firstStart, firstEnd);
  const firstMax = Math.max(firstStart, firstEnd);
  const secondMin = Math.min(secondStart, secondEnd);
  const secondMax = Math.max(secondStart, secondEnd);
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSlotEdgeEndpointCandidates({
  nodeId,
  handleId,
  position,
  estimatedX,
  estimatedY,
  endpointOffset,
  isRecipeSlotEndpoint,
  isStorageSlotEndpoint,
  counterpartX,
  counterpartY,
  measureEndpoints = true,
}: {
  nodeId: string;
  handleId?: string | null;
  position: unknown;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isRecipeSlotEndpoint?: boolean;
  isStorageSlotEndpoint?: boolean;
  counterpartX?: number;
  counterpartY?: number;
  measureEndpoints?: boolean;
}) {
  const estimatedSide = positionToEdgeSide(position);
  if (!isRecipeSlotEndpoint && !isStorageSlotEndpoint) {
    return [{ x: estimatedX, y: estimatedY, side: estimatedSide }];
  }

  const handle = parseResourceHandleId(handleId);
  const logicalRecipeSide = handle?.side === "input" ? Position.Left : Position.Right;
  if (isRecipeSlotEndpoint) {
    // Machine ports are strict: inputs enter on the left, outputs leave on
    // the right - never the top, bottom, or wrong side. The router bends
    // around whatever that costs.
    return [
      {
        ...getSlotEdgeEndpointForSide({
          nodeId,
          handleId,
          edgeSide: logicalRecipeSide,
          estimatedX,
          estimatedY,
          endpointOffset,
          isStorageSlotEndpoint,
          measureEndpoint: measureEndpoints,
        }),
        freeExit: true,
      },
    ];
  }

  const preferredSide =
    measureEndpoints && counterpartX !== undefined && counterpartY !== undefined
      ? getSlotEdgeSideTowardPoint({
          nodeId,
          handleId,
          estimatedX,
          estimatedY,
          counterpartX,
          counterpartY,
          estimatedSide,
        })
      : estimatedSide;
  const sides = dedupeEdgeSides([
    preferredSide,
    estimatedSide,
    Position.Bottom,
    Position.Top,
    Position.Left,
    Position.Right,
  ]);

  // Storage nodes are small and legitimately enter/exit on any side.
  return sides.map((edgeSide) => ({
    ...getSlotEdgeEndpointForSide({
      nodeId,
      handleId,
      edgeSide,
      estimatedX,
      estimatedY,
      endpointOffset,
      isStorageSlotEndpoint,
      measureEndpoint: measureEndpoints,
    }),
    freeExit: true,
  }));
}

function getSlotEdgeEndpointForSide({
  nodeId,
  handleId,
  edgeSide,
  estimatedX,
  estimatedY,
  endpointOffset,
  isStorageSlotEndpoint,
  measureEndpoint = true,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: Position;
  estimatedX: number;
  estimatedY: number;
  endpointOffset?: number;
  isStorageSlotEndpoint?: boolean;
  measureEndpoint?: boolean;
}): SlotEdgeEndpoint {
  const measuredEndpoint = measureEndpoint
    ? getMeasuredSlotEndpoint({
        nodeId,
        handleId,
        edgeSide,
        endpointOffset,
      })
    : undefined;
  if (measuredEndpoint) {
    return { ...measuredEndpoint, side: edgeSide };
  }

  const offset = isStorageSlotEndpoint ? STORAGE_SLOT_EDGE_OFFSET : RECIPE_SLOT_EDGE_OFFSET;
  const endpointLaneOffset = endpointOffset ?? 0;

  switch (edgeSide) {
    case Position.Right:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? -offset : offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Left:
      return {
        x: estimatedX + (isStorageSlotEndpoint ? offset : -offset),
        y: estimatedY + endpointLaneOffset,
        side: edgeSide,
      };
    case Position.Top:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY - offset, side: edgeSide };
    case Position.Bottom:
      return { x: estimatedX + endpointLaneOffset, y: estimatedY + offset, side: edgeSide };
    default:
      return { x: estimatedX, y: estimatedY, side: edgeSide };
  }
}

function dedupeEdgeSides(sides: Position[]) {
  const seen = new Set<string>();
  return sides.filter((side) => {
    const key = String(side);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function positionToEdgeSide(position: unknown): Position {
  switch (String(position)) {
    case "right":
      return Position.Right;
    case "left":
      return Position.Left;
    case "top":
      return Position.Top;
    case "bottom":
      return Position.Bottom;
    default:
      return Position.Right;
  }
}

function getSlotEdgeSideTowardPoint({
  nodeId,
  handleId,
  estimatedX,
  estimatedY,
  counterpartX,
  counterpartY,
  estimatedSide,
}: {
  nodeId: string;
  handleId?: string | null;
  estimatedX: number;
  estimatedY: number;
  counterpartX: number;
  counterpartY: number;
  estimatedSide: Position;
}) {
  const center = getMeasuredSlotCenter({ nodeId, handleId }) ?? { x: estimatedX, y: estimatedY };
  const distanceX = counterpartX - center.x;
  const distanceY = counterpartY - center.y;
  const horizontalSide = distanceX >= 0 ? Position.Right : Position.Left;
  const verticalSide = distanceY >= 0 ? Position.Bottom : Position.Top;

  if (Math.abs(distanceX) >= 36 && Math.abs(distanceX) > Math.abs(distanceY) * 1.15) {
    return horizontalSide;
  }

  if (Math.abs(distanceY) >= 24) {
    return verticalSide;
  }

  if (Math.abs(distanceY) > Math.abs(distanceX) * 0.45) {
    return verticalSide;
  }

  if (Math.abs(distanceX) > 1) {
    return horizontalSide;
  }

  return estimatedSide;
}

function getMeasuredSlotEndpoint({
  nodeId,
  handleId,
  edgeSide,
  endpointOffset = 0,
}: {
  nodeId: string;
  handleId?: string | null;
  edgeSide: string;
  endpointOffset?: number;
}) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const geometry = publishedBoardGeometryById.get(nodeId);
  const cacheKey = [nodeId, handleId, edgeSide, endpointOffset, boardGeometryDimsKey(geometry)].join(
    "|",
  );
  const cachedRelative = relativeSlotEndpointCache.get(cacheKey);
  if (cachedRelative && geometry) {
    return offsetFlowPointForEdgeSide(
      { x: geometry.x + cachedRelative.x, y: geometry.y + cachedRelative.y },
      edgeSide,
      endpointOffset,
    );
  }

  // Node element first: with viewport culling the node is often simply not
  // mounted, and the slot lookups below are document-wide attribute scans that
  // would run (twice, across every handle on the board) just to find nothing.
  // A miss is deliberately not cached — the next render after the node mounts
  // should measure.
  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }
  const slotElement =
    findResourceEndpointElement(nodeElement, "[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement(nodeElement, "[data-resource-handle='true']", nodeId, handleId);
  if (!slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const screenPoint = getSlotRectEdgePoint(slotRect, edgeSide);
  const relative = slotScreenPointToNodeRelative(screenPoint, nodeElement, geometry);
  if (!relative) {
    return undefined;
  }

  if (geometry) {
    relativeSlotEndpointCache.set(cacheKey, relative);
    return offsetFlowPointForEdgeSide(
      { x: geometry.x + relative.x, y: geometry.y + relative.y },
      edgeSide,
      endpointOffset,
    );
  }
  return undefined;
}

/**
 * Converts a screen point inside a node to node-relative FLOW coordinates
 * using only the node's own rect and its published flow size.
 *
 * This deliberately avoids the viewport transform: on reload React Flow
 * applies the restored viewport mid-frame, so a transform cached moments
 * earlier no longer matches the rects being measured - and the poisoned
 * offset used to be cached under a dims key that never changes, leaving
 * every edge of that node anchored to nonsense until the node was deleted.
 * Two rects read in the same instant always share whatever transform (and
 * browser zoom) is live, so their ratio is timing-proof.
 */
function slotScreenPointToNodeRelative(
  point: { x: number; y: number },
  nodeElement: HTMLElement,
  geometry: { width: number; height: number } | undefined,
) {
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) {
    return undefined;
  }

  const nodeRect = nodeElement.getBoundingClientRect();
  if (nodeRect.width <= 0 || nodeRect.height <= 0) {
    return undefined;
  }

  const scaleX = nodeRect.width / geometry.width;
  const scaleY = nodeRect.height / geometry.height;
  return {
    x: (point.x - nodeRect.left) / scaleX,
    y: (point.y - nodeRect.top) / scaleY,
  };
}

function getMeasuredSlotCenter({ nodeId, handleId }: { nodeId: string; handleId?: string | null }) {
  if (!handleId || typeof document === "undefined") {
    return undefined;
  }
  const geometry = publishedBoardGeometryById.get(nodeId);
  const cacheKey = [nodeId, handleId, boardGeometryDimsKey(geometry)].join("|");
  const cachedRelative = relativeSlotCenterCache.get(cacheKey);
  if (cachedRelative && geometry) {
    return { x: geometry.x + cachedRelative.x, y: geometry.y + cachedRelative.y };
  }

  // Same ordering rationale as the endpoint lookup above; never memoize a
  // miss, the node may just be culled right now.
  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    return undefined;
  }
  const slotElement =
    findResourceEndpointElement(nodeElement, "[data-resource-edge-anchor='true']", nodeId, handleId) ??
    findResourceEndpointElement(nodeElement, "[data-resource-handle='true']", nodeId, handleId);
  if (!slotElement) {
    return undefined;
  }

  const slotRect = slotElement.getBoundingClientRect();
  const relative = slotScreenPointToNodeRelative(
    { x: slotRect.left + slotRect.width / 2, y: slotRect.top + slotRect.height / 2 },
    nodeElement,
    geometry,
  );
  if (relative && geometry) {
    relativeSlotCenterCache.set(cacheKey, relative);
    return { x: geometry.x + relative.x, y: geometry.y + relative.y };
  }
  return undefined;
}

function getSlotRectEdgePoint(rect: DOMRect, edgeSide: string) {
  switch (edgeSide) {
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "left":
    default:
      return { x: rect.left, y: rect.top + rect.height / 2 };
  }
}

function offsetFlowPointForEdgeSide(
  point: { x: number; y: number },
  edgeSide: string,
  endpointOffset = 0,
) {
  switch (edgeSide) {
    case "top":
    case "bottom":
      return { x: point.x + endpointOffset, y: point.y };
    case "right":
    case "left":
    default:
      return { x: point.x, y: point.y + endpointOffset };
  }
}

function getMeasuredNodeBounds(nodeId: string) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const cacheKey = `${measuredLayoutEpoch}|${nodeId}`;
  if (measuredNodeBoundsCache.has(cacheKey)) {
    return measuredNodeBoundsCache.get(cacheKey);
  }

  const nodeElement = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${cssEscape(nodeId)}"]`,
  );
  if (!nodeElement) {
    measuredNodeBoundsCache.set(cacheKey, undefined);
    return undefined;
  }

  const bounds = measureNodeElementBounds(nodeElement);
  measuredNodeBoundsCache.set(cacheKey, bounds);
  return bounds;
}

function measureNodeElementBounds(nodeElement: HTMLElement) {
  const rect = nodeElement.getBoundingClientRect();
  const topLeft = screenToFlowPoint({ x: rect.left, y: rect.top }, nodeElement);
  const bottomRight = screenToFlowPoint({ x: rect.right, y: rect.bottom }, nodeElement);
  if (!topLeft || !bottomRight) {
    return undefined;
  }

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function screenToFlowPoint(point: { x: number; y: number }, element: HTMLElement) {
  const transform = getViewportTransform(element);
  if (!transform) {
    return undefined;
  }

  return {
    x: (point.x - transform.rendererLeft - transform.translateX) / transform.scaleX,
    y: (point.y - transform.rendererTop - transform.translateY) / transform.scaleY,
  };
}

/**
 * Reads the live viewport transform at most once per frame.
 *
 * `getComputedStyle(...).transform` forces a style recalculation, and this used
 * to run twice per node per edge â€” so a board with 40 nodes and 80 edges paid
 * over six thousand forced recalcs in a single frame.
 */
function getViewportTransform(element: HTMLElement) {
  if (viewportTransformCache) {
    return viewportTransformCache;
  }

  const root = element.closest<HTMLElement>(".react-flow");
  const viewport =
    element.closest<HTMLElement>(".react-flow__viewport") ??
    root?.querySelector<HTMLElement>(".react-flow__viewport");
  const renderer =
    element.closest<HTMLElement>(".react-flow__renderer") ??
    root?.querySelector<HTMLElement>(".react-flow__renderer");
  if (!viewport || !renderer) {
    return undefined;
  }

  const rendererRect = renderer.getBoundingClientRect();
  const matrix = parseCssMatrix(getComputedStyle(viewport).transform);
  viewportTransformCache = {
    rendererLeft: rendererRect.left,
    rendererTop: rendererRect.top,
    translateX: matrix.translateX,
    translateY: matrix.translateY,
    scaleX: matrix.scaleX,
    scaleY: matrix.scaleY,
  };
  scheduleViewportTransformClear();
  return viewportTransformCache;
}

function parseCssMatrix(transform: string) {
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  const values = transform
    .match(/matrix(?:3d)?\(([^)]+)\)/)?.[1]
    ?.split(",")
    .map((value) => Number.parseFloat(value.trim()));

  if (!values || values.some((value) => !Number.isFinite(value))) {
    return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
  }

  if (values.length === 16) {
    return {
      scaleX: values[0] || 1,
      scaleY: values[5] || values[0] || 1,
      translateX: values[12] ?? 0,
      translateY: values[13] ?? 0,
    };
  }

  return {
    scaleX: values[0] || 1,
    scaleY: values[3] || values[0] || 1,
    translateX: values[4] ?? 0,
    translateY: values[5] ?? 0,
  };
}

function findResourceEndpointElement(
  scope: ParentNode,
  selector: string,
  nodeId: string,
  handleId: string,
) {
  return scope.querySelector<HTMLElement>(
    `${selector}[data-resource-node-id="${cssEscape(nodeId)}"][data-resource-handle-id="${cssEscape(
      handleId,
    )}"]`,
  );
}

function scheduleViewportTransformClear() {
  if (viewportTransformClearScheduled || typeof window === "undefined") {
    viewportTransformCache = undefined;
    return;
  }

  viewportTransformClearScheduled = true;
  window.requestAnimationFrame(() => {
    viewportTransformCache = undefined;
    viewportTransformClearScheduled = false;
  });
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function trimEdgeNumber(value: number) {
  return formatEdgeValue(value);
}

function isPointerOverIncompatibleFlowHandle(
  project: FactoryProject,
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection,
) {
  const position = getClientPosition(event);
  if (!position || typeof document === "undefined") {
    return false;
  }

  return document.elementsFromPoint(position.x, position.y).some((element) => {
    const handleElement = element.closest<HTMLElement>(".react-flow__handle");
    if (!handleElement) {
      return false;
    }

    const resourceHandle = readResourceHandleElement(handleElement);
    if (!resourceHandle) {
      return true;
    }

    return !isCompatibleDraggedResourceTarget(project, draggedResource, resourceHandle);
  });
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getResourceHandleAtPointer(event: MouseEvent | TouchEvent) {
  const position = getClientPosition(event);
  return getResourceHandleAtPosition(position, event);
}

function getResourceHandleAtPosition(
  position: { x: number; y: number } | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || typeof document === "undefined") {
    return undefined;
  }

  const geometricMatch = findResourceHandleByGeometry(position);
  if (geometricMatch) {
    return geometricMatch;
  }

  if (estimatedEvent) {
    for (const element of document.elementsFromPoint(position.x, position.y)) {
      const match = readResourceHandleElement(
        element.closest<HTMLElement>("[data-resource-handle='true']"),
      );
      if (match) {
        return match;
      }
    }
  }

  return undefined;
}

function findResourceHandleByGeometry(position: { x: number; y: number }) {
  if (typeof document === "undefined") {
    return undefined;
  }

  const matches = [...document.querySelectorAll<HTMLElement>("[data-resource-handle='true']")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (
        position.x < rect.left ||
        position.x > rect.right ||
        position.y < rect.top ||
        position.y > rect.bottom
      ) {
        return undefined;
      }

      const handle = readResourceHandleElement(element);
      if (!handle) {
        return undefined;
      }

      return {
        handle,
        area: rect.width * rect.height,
      };
    })
    .filter(
      (
        match,
      ): match is { handle: ReturnType<typeof readResourceHandleElement> & {}; area: number } =>
        Boolean(match),
    )
    .sort((left, right) => left.area - right.area);

  return matches[0]?.handle;
}

function readResourceHandleElement(element: HTMLElement | null) {
  const nodeId = element?.dataset.resourceNodeId;
  const handleId = element?.dataset.resourceHandleId;
  const handle = parseResourceHandleId(handleId);

  if (nodeId && handleId && handle) {
    return {
      nodeId,
      handleId,
      side: handle.side,
      kind: handle.kind,
      resourceId: handle.resourceId,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

function isCompatibleDraggedResourceTarget(
  project: FactoryProject,
  draggedResource: DraggedResourceConnection,
  targetHandle: ResolvedResourceHandle,
) {
  const targetResource = getResourceForHandle(project, targetHandle.nodeId, targetHandle.handleId);

  if (!targetResource) {
    return false;
  }

  return (
    draggedResource.nodeId !== targetHandle.nodeId &&
    draggedResource.side !== targetHandle.side &&
    (targetHandle.side === "input"
      ? resourceMatchesInput(draggedResource, targetResource)
      : resourceMatchesInput(targetResource, draggedResource))
  );
}

function getStorageHandleAtPointer(
  event: MouseEvent | TouchEvent,
  draggedResource: DraggedResourceConnection | undefined,
) {
  const position = getClientPosition(event);
  return getStorageHandleAtPosition(position, draggedResource, event);
}

function getStorageHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (!position || !draggedResource || typeof document === "undefined") {
    return undefined;
  }

  const storageElements = [
    ...document.querySelectorAll<HTMLElement>("[data-storage-node-id]"),
    ...(estimatedEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-storage-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const storageElement of storageElements) {
    const rect = storageElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = storageElement?.dataset.storageNodeId;
    const kind = storageElement?.dataset.storageKind;
    const resourceId = storageElement?.dataset.storageResourceId;

    if (
      nodeId &&
      resourceId &&
      nodeId !== draggedResource.nodeId &&
      (kind === "item" || kind === "fluid") &&
      (draggedResource.side === "input"
        ? resourceMatchesInput({ kind, id: resourceId }, draggedResource)
        : resourceMatchesInput(draggedResource, { kind, id: resourceId }))
    ) {
      const side = draggedResource.side === "output" ? "input" : "output";
      return {
        nodeId,
        handleId: `${side}:${kind}:${encodeURIComponent(resourceId)}`,
        side,
        kind,
        resourceId,
      } satisfies ResolvedResourceHandle;
    }
  }

  return undefined;
}

/**
 * Drops anywhere on a trash card resolve to its universal drink-here port.
 * Only outputs qualify — a dragged INPUT looking for a supplier can't dock
 * on a can — and the whole card counts, so a drop landing on the frame or
 * header voids the line instead of spawning a tank on top of the can.
 */
function getTrashHandleAtPosition(
  position: { x: number; y: number } | undefined,
  draggedResource: DraggedResourceConnection | undefined,
  estimatedEvent?: MouseEvent | TouchEvent,
) {
  if (
    !position ||
    !draggedResource ||
    draggedResource.side !== "output" ||
    draggedResource.id === TRASH_ANY_RESOURCE_ID ||
    draggedResource.id === CUSTOM_RATE_ANY_RESOURCE_ID ||
    typeof document === "undefined"
  ) {
    return undefined;
  }

  const trashElements = [
    ...document.querySelectorAll<HTMLElement>("[data-trash-node-id]"),
    ...(estimatedEvent
      ? document
          .elementsFromPoint(position.x, position.y)
          .map((element) => element.closest<HTMLElement>("[data-trash-node-id]"))
          .filter((element): element is HTMLElement => Boolean(element))
      : []),
  ];

  for (const trashElement of trashElements) {
    const rect = trashElement.getBoundingClientRect();
    if (
      position.x < rect.left ||
      position.x > rect.right ||
      position.y < rect.top ||
      position.y > rect.bottom
    ) {
      continue;
    }

    const nodeId = trashElement.dataset.trashNodeId;
    if (!nodeId || nodeId === draggedResource.nodeId) {
      continue;
    }

    return {
      nodeId,
      handleId: `input:item:${encodeURIComponent(TRASH_ANY_RESOURCE_ID)}`,
      side: "input",
      kind: "item",
      resourceId: TRASH_ANY_RESOURCE_ID,
    } satisfies ResolvedResourceHandle;
  }

  return undefined;
}

function brightenHexColor(color: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const lift = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount));
  const r = lift((value >> 16) & 0xff);
  const g = lift((value >> 8) & 0xff);
  const b = lift(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Pushes every channel away from the pixel's grey point, which raises
// saturation without shifting hue or overall lightness.
function saturateHexColor(color: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const push = (channel: number) =>
    Math.min(255, Math.max(0, Math.round(grey + (channel - grey) * (1 + amount))));
  return `#${((push(r) << 16) | (push(g) << 8) | push(b)).toString(16).padStart(6, "0")}`;
}

function getInitialResourceColor(resource: ResourceEdgeData["resource"]) {
  return (
    resource.dominantColor ??
    resource.iconAtlas?.dominantColor ??
    (resource.kind === "fluid" ? DEFAULT_FLUID_EDGE_COLOR : DEFAULT_ITEM_EDGE_COLOR)
  );
}

function getArrowHeadPoints(targetX: number, targetY: number, targetPosition: unknown) {
  const length = 8;
  const width = 5;

  switch (String(targetPosition)) {
    case "right":
      return `${targetX + length},${targetY - width} ${targetX},${targetY} ${targetX + length},${targetY + width}`;
    case "top":
      return `${targetX - width},${targetY - length} ${targetX},${targetY} ${targetX + width},${targetY - length}`;
    case "bottom":
      return `${targetX - width},${targetY + length} ${targetX},${targetY} ${targetX + width},${targetY + length}`;
    case "left":
    default:
      return `${targetX - length},${targetY - width} ${targetX},${targetY} ${targetX - length},${targetY + width}`;
  }
}

function getArrowHeadPointsForRoute({
  points,
  estimatedTargetX,
  estimatedTargetY,
  estimatedTargetPosition,
}: {
  points: Array<{ x: number; y: number }>;
  estimatedTargetX: number;
  estimatedTargetY: number;
  estimatedTargetPosition: unknown;
}) {
  const routeTarget = points[points.length - 1];
  const routePrevious = points[points.length - 2];
  if (!routeTarget || !routePrevious) {
    return getArrowHeadPoints(estimatedTargetX, estimatedTargetY, estimatedTargetPosition);
  }

  const distanceX = routeTarget.x - routePrevious.x;
  const distanceY = routeTarget.y - routePrevious.y;
  const isVertical = Math.abs(distanceY) > Math.abs(distanceX);
  const targetPosition = isVertical
    ? distanceY >= 0
      ? Position.Top
      : Position.Bottom
    : distanceX >= 0
      ? Position.Left
      : Position.Right;

  return getArrowHeadPoints(routeTarget.x, routeTarget.y, targetPosition);
}

function isCompatibleResourceConnection(
  project: FactoryProject,
  connection: Connection | Edge,
): boolean {
  const sourceHandle = parseResourceHandleId(connection.sourceHandle);
  const targetHandle = parseResourceHandleId(connection.targetHandle);
  if (!sourceHandle || !targetHandle) {
    return false;
  }

  // Trash cans drink any concrete resource, but only from an OUTPUT.
  const sourceIsTrash = sourceHandle.resourceId === TRASH_ANY_RESOURCE_ID;
  const targetIsTrash = targetHandle.resourceId === TRASH_ANY_RESOURCE_ID;
  if (sourceIsTrash || targetIsTrash) {
    if (sourceIsTrash && targetIsTrash) {
      return false;
    }
    const farSide = sourceIsTrash ? targetHandle.side : sourceHandle.side;
    if (farSide !== "output") {
      return false;
    }
    const farNodeId = sourceIsTrash ? connection.target : connection.source;
    const farHandleId = sourceIsTrash ? connection.targetHandle : connection.sourceHandle;
    return Boolean(
      farNodeId && farHandleId && getResourceForHandle(project, farNodeId, farHandleId),
    );
  }

  // Custom-rate universal ports accept any concrete resource on the far end.
  const sourceIsAny = sourceHandle.resourceId === CUSTOM_RATE_ANY_RESOURCE_ID;
  const targetIsAny = targetHandle.resourceId === CUSTOM_RATE_ANY_RESOURCE_ID;
  if (sourceIsAny || targetIsAny) {
    if (sourceIsAny && targetIsAny) {
      return false;
    }
    if (sourceHandle.side === targetHandle.side) {
      return false;
    }
    const machineNodeId = sourceIsAny ? connection.target : connection.source;
    const machineHandleId = sourceIsAny ? connection.targetHandle : connection.sourceHandle;
    return Boolean(
      machineNodeId &&
        machineHandleId &&
        getResourceForHandle(project, machineNodeId, machineHandleId),
    );
  }

  const sourceResource =
    connection.source && connection.sourceHandle
      ? getResourceForHandle(project, connection.source, connection.sourceHandle)
      : undefined;
  const targetResource =
    connection.target && connection.targetHandle
      ? getResourceForHandle(project, connection.target, connection.targetHandle)
      : undefined;

  if (!sourceResource || !targetResource) {
    return false;
  }

  const output = sourceHandle.side === "output" ? sourceResource : targetResource;
  const input = sourceHandle.side === "input" ? sourceResource : targetResource;

  return sourceHandle.side !== targetHandle.side && resourceMatchesInput(output, input);
}

function getDraggedResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): DraggedResourceConnection | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      nodeId,
      side: handle.side,
      handleId,
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getNodeRecipeForHandles(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;
  const resource = resources.find(
    (entry) => entry.kind === handle.kind && entry.id === handle.resourceId,
  );
  if (!resource || (handle.side === "input" && !isRecipeInputConsumed(resource))) {
    return undefined;
  }

  return {
    nodeId,
    side: handle.side,
    handleId,
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
    tooltip: resource.tooltip,
    alternatives: resource.alternatives,
  };
}

function getResourceForHandle(
  project: FactoryProject,
  nodeId: string,
  handleId: string,
): ResourceAmount | undefined {
  const handle = parseResourceHandleId(handleId);
  if (!handle) {
    return undefined;
  }

  const storage = (project.storages ?? []).find((entry) => entry.id === nodeId);
  if (storage) {
    return {
      kind: storage.kind,
      id: storage.resourceId,
      amount: 1,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
    };
  }

  const node = project.nodes.find((entry) => entry.id === nodeId);
  const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
  if (!node || !recipe) {
    return undefined;
  }

  const contextualRecipe = getNodeRecipeForHandles(recipe, node);
  const resources = handle.side === "input" ? contextualRecipe.inputs : contextualRecipe.outputs;

  return resources?.find((entry) => entry.kind === handle.kind && entry.id === handle.resourceId);
}

function getNodeRecipeForHandles(recipe: Recipe, node: FactoryProject["nodes"][number]): Recipe {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
  const overclockedStats = getOverclockedRecipeStats(nodeRecipe, node);
  const adjustedRecipe = applyMachineOutputMultipliers(
    effectiveRecipe,
    node,
    overclockedStats.tier,
  );
  return restoreCrossKindInputOverrideVisuals(
    {
      ...effectiveRecipe,
      ...adjustedRecipe,
    },
    recipe,
    node,
  );
}

function getClientPosition(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return undefined;
}

function getExportImageSize(graphSize: number) {
  if (!Number.isFinite(graphSize) || graphSize <= 0) {
    return EXPORT_IMAGE_PADDING * 2;
  }

  return Math.ceil(graphSize + EXPORT_IMAGE_PADDING * 2);
}

function getExportPngPixelRatio(imageWidth: number, imageHeight: number) {
  const maxSide = Math.max(imageWidth, imageHeight);
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return EXPORT_PNG_PIXEL_RATIO;
  }

  return Math.min(EXPORT_PNG_PIXEL_RATIO, EXPORT_PNG_MAX_PIXEL_SIDE / maxSide);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dispatchImageExportComplete(requestId: string, dataUrl?: string) {
  window.dispatchEvent(
    new CustomEvent(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, {
      detail: { requestId, dataUrl },
    }),
  );
}

/**
 * Downscales a full board capture into a share-card thumbnail, shrinking
 * until it fits the upload limit so big factories don't silently lose their
 * preview image.
 */
async function makeThumbnailDataUrl(blob: Blob, maxBytes = 380_000): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const attempts: Array<{ maxSide: number; quality: number }> = [
      { maxSide: 720, quality: 0.82 },
      { maxSide: 560, quality: 0.72 },
      { maxSide: 420, quality: 0.62 },
      { maxSide: 320, quality: 0.5 },
    ];

    let smallest: string | undefined;
    for (const { maxSide, quality } of attempts) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas 2D context unavailable");
      }

      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= maxBytes) {
        return dataUrl;
      }
      smallest = dataUrl;
    }

    if (!smallest) {
      throw new Error("Thumbnail encode produced no image");
    }
    return smallest;
  } finally {
    bitmap.close();
  }
}

function getEdgeResource(
  project: FactoryProject,
  edge: FactoryEdge,
): Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
> {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const output = sourceRecipe?.outputs.find(
    (resource) => resource.kind === edge.resourceKind && resource.id === edge.resourceId,
  );
  const storage = sourceStorage ?? targetStorage;

  return {
    kind: edge.resourceKind,
    id: edge.resourceId,
    amount: 1,
    displayName: output?.displayName ?? storage?.displayName ?? edge.label,
    iconPath: output?.iconPath ?? storage?.iconPath,
    iconAtlas: output?.iconAtlas ?? storage?.iconAtlas,
    dominantColor:
      output?.dominantColor ??
      storage?.dominantColor ??
      output?.iconAtlas?.dominantColor ??
      storage?.iconAtlas?.dominantColor,
  };
}

function edgeMatchesSearch(
  edge: FactoryEdge,
  resource: Pick<ResourceAmount, "id" | "displayName">,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${resource.displayName ?? ""} ${resource.id} ${edge.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function recipeContainsResourceKey(recipe: Recipe | undefined, resourceKey: string) {
  if (!recipe) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function exportNodeFilter(domNode: HTMLElement) {
  const element = domNode instanceof Element ? domNode : undefined;

  return !(
    element?.classList.contains("react-flow__edgeupdater") ||
    element?.classList.contains("react-flow__selection") ||
    element?.classList.contains("react-flow__nodesselection") ||
    element?.classList.contains("react-flow__handle")
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
