/**
 * The grid edge router.
 *
 * Wires live on the same 20px grid the cards are built from (`board-grid.ts`):
 * every straight run of every wire travels along a grid line, and no run ever
 * comes within one cell of a card. The one sanctioned exception is the port
 * stub — the last hop from a card's margin to the port itself, which by
 * definition has to cross the margin.
 *
 * A grid line is a LANE with 16 usable pixels of width. Wires are fractions
 * of a lane (a full pipe is 16px, never the whole 20 — two full pipes in
 * neighbouring lanes keep 4px of daylight), and wires whose fractions fit
 * side by side SHARE the lane: a ¼ wire and a ½ wire ride the same line with
 * a 2px gap between them, packed around the line's centre. The A* cost makes
 * riding an occupied-but-not-full lane slightly CHEAPER than an empty one, so
 * wires heading the same way find each other, travel together as a ribbon,
 * and peel off near their destinations. A full lane costs heavily instead,
 * which pushes latecomers into the next line over — overlap is never chosen
 * while any separated path exists. Only the port stubs may stack, because
 * arbitrarily many wires can meet one port and a port row is one lane tall.
 *
 * Everything here is a pure function of its inputs: flow-space geometry in,
 * polylines out. No DOM, no React, no viewport — the same inputs give the
 * same routes at every zoom, which is the routing invariant ARCHITECTURE.md
 * demands. The host feeds it published geometry and caches the result by
 * content fingerprint.
 */

import { BOARD_GRID } from "@/lib/board-grid";

/** One cell of clearance between any wire run and any card. */
export const WIRE_NODE_MARGIN = BOARD_GRID;

/** Usable stroke pixels inside one lane; the rest is guaranteed daylight. */
export const LANE_CAPACITY = 16;

/** Breathing room between two wires sharing a lane. */
export const LANE_GAP = 2;

/**
 * The widths wires are allowed to draw at: fractions of a lane. Dynamic
 * thickness picks from this menu, so any two wires either fit a lane
 * together or visibly do not — no in-between widths that almost fit.
 * The floor is an EIGHTH, not a sixteenth: a 1px hairline read as a scratch
 * on the canvas, not a wire.
 */
export const LANE_FRACTIONS = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1] as const;

/** Normalized flow heat (0..1) → the stroke width for dynamic-width mode. */
export function laneWidthForHeat(heat: number): number {
  const clamped = Math.min(Math.max(heat, 0), 1);
  for (const fraction of LANE_FRACTIONS) {
    if (clamped <= fraction + 1e-6) {
      return Math.round(fraction * LANE_CAPACITY * 100) / 100;
    }
  }
  return LANE_CAPACITY;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridObstacle {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type GridSide = "left" | "right" | "top" | "bottom";

/**
 * One place a wire may start or end: the true anchor (on the card border, or
 * a few pixels inside at a coupling) plus which side of the card it faces.
 */
export interface GridEndpoint {
  x: number;
  y: number;
  side: GridSide;
  /**
   * How far past the anchor the wire tucks INTO the card, along the side's
   * normal. Storage and trash docks use this so a wire visibly slides under
   * the card instead of stopping dead at its border; ports leave it 0.
   */
  inset?: number;
}

export interface GridRouteRequest {
  edgeId: string;
  /** Deterministic priority: lower routes first and claims lanes first. */
  order: number;
  /** Candidate endpoints; the router picks the pair that routes cheapest. */
  sources: GridEndpoint[];
  targets: GridEndpoint[];
  /** Stroke this wire draws at, in px. Must be ≤ LANE_CAPACITY. */
  strokeWidth: number;
}

export interface GridRoutedEdge {
  edgeId: string;
  points: GridPoint[];
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** Cost per pixel on an empty lane. */
const COST_EMPTY = 1;
/**
 * Cost per pixel on a lane that already carries wires this one FITS beside.
 * Below 1 on purpose: wires prefer to travel together, which is what forms
 * ribbons. The heuristic uses this same factor to stay admissible.
 */
const COST_SHARED = 0.85;
/**
 * Cost per pixel on a lane this wire does NOT fit into. High enough that any
 * one-lane detour (two turns + a cell over and back) beats overlapping for
 * more than a couple of cells, low enough that a wire boxed in on every side
 * still routes instead of failing.
 */
const COST_OVERFLOW = 6;
/** Cost of one 90° turn, in pixel-equivalents. */
const TURN_COST = 30;
/** A* gives up after this many pops and the caller falls back. */
const MAX_ASTAR_POPS = 40_000;
/** Search-window padding around the endpoints, then the growth factor. */
const WINDOW_PAD = 400;
const WINDOW_GROWTH = 4;

/* ------------------------------------------------------------------ */
/* Lane load: how much stroke already rides each stretch of each line  */
/* ------------------------------------------------------------------ */

/**
 * Load is tracked per CELL of a line (each 20px stretch), because two wires
 * can share a line for part of its length and part company later — capacity
 * is a property of a stretch, not of the whole line. Only WIDTH totals live
 * here: where in the lane each wire actually sits is decided later, in one
 * pass over every routed wire, so the ordering can be chosen to avoid
 * crossings instead of by whoever happened to route first.
 */
class LaneLoad {
  private cells = new Map<string, number>();

  private key(axis: "h" | "v", line: number, cell: number): string {
    return `${axis}:${line}:${cell}`;
  }

  /** Heaviest cell of the stretch, in stroke px. */
  usedWidth(axis: "h" | "v", line: number, from: number, to: number): number {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.ceil(Math.max(from, to) / BOARD_GRID) - 1;
    let worst = 0;
    for (let cell = lo; cell <= hi; cell += 1) {
      const total = this.cells.get(this.key(axis, line, cell)) ?? 0;
      if (total > worst) {
        worst = total;
      }
    }
    return worst;
  }

  add(axis: "h" | "v", line: number, from: number, to: number, width: number) {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.ceil(Math.max(from, to) / BOARD_GRID) - 1;
    for (let cell = lo; cell <= hi; cell += 1) {
      const key = this.key(axis, line, cell);
      this.cells.set(key, (this.cells.get(key) ?? 0) + width);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The line graph                                                      */
/* ------------------------------------------------------------------ */

function snapLine(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/** Sorted unique array plus index lookup. */
function buildAxis(values: Iterable<number>): { coords: number[]; index: Map<number, number> } {
  const coords = [...new Set(values)].sort((left, right) => left - right);
  const index = new Map<number, number>();
  coords.forEach((coord, i) => index.set(coord, i));
  return { coords, index };
}

interface BlockedIntervals {
  /** Per line index: sorted merged [lo, hi] intervals a run may not overlap. */
  byLine: Array<Array<[number, number]>>;
}

function buildBlocked(
  lineCoords: number[],
  obstacles: GridObstacle[],
  pickSpan: (obstacle: GridObstacle) => [number, number],
  pickBlock: (obstacle: GridObstacle) => [number, number],
): BlockedIntervals {
  const byLine: Array<Array<[number, number]>> = lineCoords.map(() => []);
  for (const obstacle of obstacles) {
    const [spanLo, spanHi] = pickSpan(obstacle);
    const [blockLo, blockHi] = pickBlock(obstacle);
    // Lines STRICTLY inside the margin-inflated span are blocked; the
    // boundary lines are exactly one cell out and stay legal.
    let lo = binarySearchAbove(lineCoords, spanLo - WIRE_NODE_MARGIN);
    for (; lo < lineCoords.length && lineCoords[lo] < spanHi + WIRE_NODE_MARGIN; lo += 1) {
      byLine[lo].push([blockLo - WIRE_NODE_MARGIN, blockHi + WIRE_NODE_MARGIN]);
    }
  }
  for (const intervals of byLine) {
    intervals.sort((left, right) => left[0] - right[0]);
  }
  return { byLine };
}

/** First index whose coord is strictly greater than `value`. */
function binarySearchAbove(coords: number[], value: number): number {
  let lo = 0;
  let hi = coords.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (coords[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** May a run travel [from, to] on this line without entering a margin? */
function runIsFree(intervals: Array<[number, number]>, from: number, to: number): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (const [blockLo, blockHi] of intervals) {
    if (blockLo >= hi) {
      break;
    }
    // Open-interval overlap: touching a margin boundary is allowed,
    // entering it is not.
    if (hi > blockLo + 1e-6 && lo < blockHi - 1e-6) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Endpoint plumbing                                                   */
/* ------------------------------------------------------------------ */

/** The apron vertex: the endpoint pushed one cell out of its card, on-grid. */
function apronPoint(endpoint: GridEndpoint): GridPoint {
  switch (endpoint.side) {
    case "left":
      return { x: snapLine(endpoint.x) - WIRE_NODE_MARGIN, y: snapLine(endpoint.y) };
    case "right":
      return { x: snapLine(endpoint.x) + WIRE_NODE_MARGIN, y: snapLine(endpoint.y) };
    case "top":
      return { x: snapLine(endpoint.x), y: snapLine(endpoint.y) - WIRE_NODE_MARGIN };
    case "bottom":
      return { x: snapLine(endpoint.x), y: snapLine(endpoint.y) + WIRE_NODE_MARGIN };
  }
}

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/* ------------------------------------------------------------------ */
/* The solve                                                           */
/* ------------------------------------------------------------------ */

interface SolveContext {
  obstacles: GridObstacle[];
  load: LaneLoad;
}

/** One straight run of one wire, waiting for its lane slot. */
interface PendingRun {
  axis: "h" | "v";
  line: number;
  from: number;
  to: number;
  width: number;
  order: number;
  /**
   * Which side of the lane the wire leaves toward at this run's end:
   * -1 = toward the negative perpendicular axis, +1 = positive, 0 = straight.
   */
  exitSide: -1 | 0 | 1;
  /** Ascending = exits earlier along this run's own direction of travel. */
  exitRank: number;
  /** Assigned by the lane pass. */
  offset: number;
}

/** A routed wire between A* and final assembly. */
interface PendingEdge {
  request: GridRouteRequest;
  source: GridEndpoint;
  target: GridEndpoint;
  vertices: GridPoint[];
  runs: PendingRun[];
  /** Boxed-in fallback: already-final points, no lanes involved. */
  fallbackPoints?: GridPoint[];
}

export function solveGridRoutes(
  obstacles: GridObstacle[],
  requests: GridRouteRequest[],
): Map<string, GridRoutedEdge> {
  const context: SolveContext = { obstacles, load: new LaneLoad() };
  const sorted = [...requests].sort(
    (left, right) => left.order - right.order || (left.edgeId < right.edgeId ? -1 : 1),
  );

  // Pass 1: route every wire (earlier wires' lane LOAD steers later ones),
  // but decide nothing about where in each lane anybody sits.
  const pending: PendingEdge[] = [];
  for (const request of sorted) {
    const routed = routeOne(context, request);
    if (routed) {
      pending.push(routed);
    }
  }

  // Pass 2: with every wire known, hand out lane slots ordered so wires that
  // peel off earlier sit on the side they peel toward — the assignment that
  // avoids two wires swapping sides at their turns.
  assignLaneSlots(pending);

  // Pass 3: geometry.
  const results = new Map<string, GridRoutedEdge>();
  for (const entry of pending) {
    results.set(entry.request.edgeId, {
      edgeId: entry.request.edgeId,
      points: entry.fallbackPoints ?? assemblePendingEdge(entry),
    });
  }
  for (const request of sorted) {
    if (!results.has(request.edgeId)) {
      results.set(request.edgeId, { edgeId: request.edgeId, points: [] });
    }
  }
  return results;
}

function routeOne(context: SolveContext, request: GridRouteRequest): PendingEdge | undefined {
  const sources = request.sources.filter(isFiniteEndpoint);
  const targets = request.targets.filter(isFiniteEndpoint);
  if (sources.length === 0 || targets.length === 0) {
    return undefined;
  }

  let pad = WINDOW_PAD;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const routed = routeWithinWindow(context, request, sources, targets, pad);
    if (routed) {
      registerPendingRuns(context, routed);
      return routed;
    }
    pad *= WINDOW_GROWTH;
  }

  // Boxed in (touching cards, sealed pockets): a plain L so the wire still
  // exists. It may cross things; there was no legal grid path to take.
  const source = sources[0];
  const target = targets[0];
  const sourceApron = apronPoint(source);
  const targetApron = apronPoint(target);
  return {
    request,
    source,
    target,
    vertices: [],
    runs: [],
    fallbackPoints: compactPoints([
      endpointAnchor(source),
      sourceApron,
      { x: sourceApron.x, y: targetApron.y },
      targetApron,
      endpointAnchor(target),
    ]),
  };
}

/**
 * Splits the vertex chain into runs, computes each run's exit side and rank
 * for the lane pass, and adds this wire's width to the lane load so later
 * A* searches see the corridor filling up.
 */
function registerPendingRuns(context: SolveContext, entry: PendingEdge) {
  const { vertices, target } = entry;
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const run: PendingRun =
      a.y === b.y
        ? { axis: "h", line: a.y, from: a.x, to: b.x, width: entry.request.strokeWidth, order: entry.request.order, exitSide: 0, exitRank: 0, offset: 0 }
        : { axis: "v", line: a.x, from: a.y, to: b.y, width: entry.request.strokeWidth, order: entry.request.order, exitSide: 0, exitRank: 0, offset: 0 };
    const next = vertices[i + 2];
    if (next) {
      // The next run is perpendicular; its direction of travel IS this run's
      // exit side in the lane's cross-axis.
      const perpDelta = run.axis === "v" ? next.x - b.x : next.y - b.y;
      run.exitSide = perpDelta > 0.01 ? 1 : perpDelta < -0.01 ? -1 : 0;
    } else {
      // Last run: the stub leaves toward the anchor.
      const perpDelta = run.axis === "v" ? target.x - run.line : target.y - run.line;
      run.exitSide = perpDelta > 0.01 ? 1 : perpDelta < -0.01 ? -1 : 0;
    }
    // dir * to: ascending compares as "exits earlier along its own travel",
    // for either direction of travel.
    const dir = Math.sign(run.to - run.from) || 1;
    run.exitRank = dir * run.to;
    entry.runs.push(run);
    context.load.add(run.axis, run.line, run.from, run.to, run.width);
  }
}

/**
 * The lane pass: every run of every wire, grouped by line and overlapping
 * span, spread across the lane's 16px band.
 *
 * Two rules, both about reading clearly:
 *
 * ORDER — wires exiting toward the lane's negative side sit on that side,
 * positives on theirs, and within a side the wire that peels off EARLIEST
 * sits outermost. Two wires out of one output that both turn left used to
 * get arbitrary slots, and half the time the inner one turned first and
 * crossed its neighbour right at the corner. Sorted this way the corridor
 * unzips: each wire leaves from the edge of the bundle, crossing nobody.
 *
 * SPREAD — slots are distributed evenly across the whole band rather than
 * packed shoulder-to-shoulder at the centre. Wires travel together because
 * their corridors coincide, but they only get CLOSE when the lane is
 * genuinely crowded.
 */
function assignLaneSlots(pending: PendingEdge[]) {
  const byLine = new Map<string, PendingRun[]>();
  for (const entry of pending) {
    for (const run of entry.runs) {
      const key = `${run.axis}:${run.line}`;
      const list = byLine.get(key);
      if (list) {
        list.push(run);
      } else {
        byLine.set(key, [run]);
      }
    }
  }

  for (const runs of byLine.values()) {
    // Cluster strictly-overlapping spans; runs merely meeting end-to-end are
    // independent stretches and each gets the full band.
    runs.sort(
      (left, right) =>
        Math.min(left.from, left.to) - Math.min(right.from, right.to) ||
        left.order - right.order,
    );
    let cluster: PendingRun[] = [];
    let clusterHi = -Infinity;
    const flush = () => {
      if (cluster.length > 0) {
        spreadCluster(cluster);
      }
      cluster = [];
      clusterHi = -Infinity;
    };
    for (const run of runs) {
      const lo = Math.min(run.from, run.to);
      const hi = Math.max(run.from, run.to);
      if (cluster.length > 0 && lo >= clusterHi - 0.5) {
        flush();
      }
      cluster.push(run);
      clusterHi = Math.max(clusterHi, hi);
    }
    flush();
  }
}

function spreadCluster(cluster: PendingRun[]) {
  cluster.sort((left, right) => {
    if (left.exitSide !== right.exitSide) {
      return left.exitSide - right.exitSide;
    }
    if (left.exitSide === -1 && left.exitRank !== right.exitRank) {
      // Negative side, outermost (most negative offset) first: earliest exit.
      return left.exitRank - right.exitRank;
    }
    if (left.exitSide === 1 && left.exitRank !== right.exitRank) {
      // Positive side, outermost LAST in left-to-right order: latest first.
      return right.exitRank - left.exitRank;
    }
    return left.order - right.order;
  });

  const totalWidth = cluster.reduce((sum, run) => sum + run.width, 0);
  const slack = Math.max(0, LANE_CAPACITY - totalWidth);
  const gap = slack / (cluster.length + 1);
  // Full band when there is slack; an overfull cluster (port aprons) just
  // centres its total width and spills the band symmetrically.
  let cursor = -(totalWidth + slack) / 2 + gap;
  for (const run of cluster) {
    run.offset = cursor + run.width / 2;
    cursor += run.width + gap;
  }
}

function endpointAnchor(endpoint: GridEndpoint): GridPoint {
  const inset = endpoint.inset ?? 0;
  switch (endpoint.side) {
    case "left":
      return { x: endpoint.x + inset, y: endpoint.y };
    case "right":
      return { x: endpoint.x - inset, y: endpoint.y };
    case "top":
      return { x: endpoint.x, y: endpoint.y + inset };
    case "bottom":
      return { x: endpoint.x, y: endpoint.y - inset };
  }
}

function isFiniteEndpoint(endpoint: GridEndpoint): boolean {
  return Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y);
}

function routeWithinWindow(
  context: SolveContext,
  request: GridRouteRequest,
  sources: GridEndpoint[],
  targets: GridEndpoint[],
  pad: number,
): PendingEdge | undefined {
  const sourceAprons = sources.map(apronPoint);
  const targetAprons = targets.map(apronPoint);

  let windowLeft = Infinity;
  let windowRight = -Infinity;
  let windowTop = Infinity;
  let windowBottom = -Infinity;
  for (const point of [...sourceAprons, ...targetAprons]) {
    if (point.x < windowLeft) windowLeft = point.x;
    if (point.x > windowRight) windowRight = point.x;
    if (point.y < windowTop) windowTop = point.y;
    if (point.y > windowBottom) windowBottom = point.y;
  }
  const span = windowRight - windowLeft + (windowBottom - windowTop);
  const grownPad = Math.max(pad, 0.5 * span);
  windowLeft -= grownPad;
  windowRight += grownPad;
  windowTop -= grownPad;
  windowBottom += grownPad;

  // Candidate lines: every card boundary pushed one and two cells out (the
  // travel lane and its overflow neighbour), plus each endpoint's own apron
  // lines so starts and goals always exist in the graph.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const obstacle of context.obstacles) {
    if (
      obstacle.right < windowLeft - 2 * BOARD_GRID ||
      obstacle.left > windowRight + 2 * BOARD_GRID ||
      obstacle.bottom < windowTop - 2 * BOARD_GRID ||
      obstacle.top > windowBottom + 2 * BOARD_GRID
    ) {
      continue;
    }
    const left = snapLine(obstacle.left);
    const right = snapLine(obstacle.right);
    const top = snapLine(obstacle.top);
    const bottom = snapLine(obstacle.bottom);
    xs.push(left - BOARD_GRID, left - 2 * BOARD_GRID, right + BOARD_GRID, right + 2 * BOARD_GRID);
    ys.push(top - BOARD_GRID, top - 2 * BOARD_GRID, bottom + BOARD_GRID, bottom + 2 * BOARD_GRID);
  }
  for (const point of [...sourceAprons, ...targetAprons]) {
    xs.push(point.x);
    ys.push(point.y);
  }
  // The window's own edges, so two far-apart cards always have an outer
  // corridor between them even when nothing else contributes a line.
  xs.push(snapLine(windowLeft), snapLine(windowRight));
  ys.push(snapLine(windowTop), snapLine(windowBottom));

  const xAxis = buildAxis(xs.filter((x) => x >= windowLeft && x <= windowRight));
  const yAxis = buildAxis(ys.filter((y) => y >= windowTop && y <= windowBottom));
  if (xAxis.coords.length === 0 || yAxis.coords.length === 0) {
    return undefined;
  }

  const windowObstacles = context.obstacles.filter(
    (obstacle) =>
      obstacle.right >= windowLeft &&
      obstacle.left <= windowRight &&
      obstacle.bottom >= windowTop &&
      obstacle.top <= windowBottom,
  );
  // For a vertical line x=v: blocked while v is strictly inside the inflated
  // horizontal span, over the inflated vertical extent (and vice versa).
  const verticalBlocked = buildBlocked(
    xAxis.coords,
    windowObstacles,
    (o) => [o.left, o.right],
    (o) => [o.top, o.bottom],
  );
  const horizontalBlocked = buildBlocked(
    yAxis.coords,
    windowObstacles,
    (o) => [o.top, o.bottom],
    (o) => [o.left, o.right],
  );

  const xCount = xAxis.coords.length;
  const yCount = yAxis.coords.length;
  const vertexCount = xCount * yCount;
  const stateCount = vertexCount * 4;

  const starts: Array<{ vertex: number; endpointIndex: number }> = [];
  for (let i = 0; i < sourceAprons.length; i += 1) {
    const xi = xAxis.index.get(sourceAprons[i].x);
    const yi = yAxis.index.get(sourceAprons[i].y);
    if (xi !== undefined && yi !== undefined) {
      starts.push({ vertex: xi * yCount + yi, endpointIndex: i });
    }
  }
  const goals = new Map<number, number>();
  for (let i = 0; i < targetAprons.length; i += 1) {
    const xi = xAxis.index.get(targetAprons[i].x);
    const yi = yAxis.index.get(targetAprons[i].y);
    if (xi !== undefined && yi !== undefined) {
      goals.set(xi * yCount + yi, i);
    }
  }
  if (starts.length === 0 || goals.size === 0) {
    return undefined;
  }

  const heuristic = (vertex: number): number => {
    const x = xAxis.coords[Math.floor(vertex / yCount)];
    const y = yAxis.coords[vertex % yCount];
    let best = Infinity;
    for (const apron of targetAprons) {
      const manhattan = Math.abs(apron.x - x) + Math.abs(apron.y - y);
      if (manhattan < best) {
        best = manhattan;
      }
    }
    return best * COST_SHARED;
  };

  // g-scores per (vertex, incoming direction); direction 0..3, plus the
  // virtual "no direction yet" handled by seeding all four at the start.
  const gScores = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const startOf = new Int32Array(stateCount).fill(-1);

  interface HeapEntry {
    f: number;
    g: number;
    state: number;
    /** Monotone tiebreak keeps the pop order deterministic. */
    seq: number;
  }
  const heap: HeapEntry[] = [];
  let seq = 0;
  const push = (entry: HeapEntry) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareHeap(heap[parent], heap[i]) <= 0) {
        break;
      }
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): HeapEntry | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const leftChild = i * 2 + 1;
        const rightChild = leftChild + 1;
        let smallest = i;
        if (leftChild < heap.length && compareHeap(heap[leftChild], heap[smallest]) < 0) {
          smallest = leftChild;
        }
        if (rightChild < heap.length && compareHeap(heap[rightChild], heap[smallest]) < 0) {
          smallest = rightChild;
        }
        if (smallest === i) {
          break;
        }
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };
  const compareHeap = (left: HeapEntry, right: HeapEntry): number =>
    left.f - right.f || left.g - right.g || left.seq - right.seq;

  for (const start of starts) {
    for (let dir = 0; dir < 4; dir += 1) {
      const state = start.vertex * 4 + dir;
      gScores[state] = 0;
      startOf[state] = start.endpointIndex;
      push({ f: heuristic(start.vertex), g: 0, state, seq: (seq += 1) });
    }
  }

  let goalState = -1;
  let pops = 0;
  while (heap.length > 0) {
    const current = pop();
    if (!current) {
      break;
    }
    if (current.g > gScores[current.state] + 1e-9) {
      continue;
    }
    pops += 1;
    if (pops > MAX_ASTAR_POPS) {
      return undefined;
    }
    const vertex = Math.floor(current.state / 4);
    const currentDir = current.state % 4;
    if (goals.has(vertex)) {
      goalState = current.state;
      break;
    }

    const xi = Math.floor(vertex / yCount);
    const yi = vertex % yCount;
    for (let dir = 0; dir < 4; dir += 1) {
      const { dx, dy } = DIRECTIONS[dir];
      const nxi = xi + dx;
      const nyi = yi + dy;
      if (nxi < 0 || nxi >= xCount || nyi < 0 || nyi >= yCount) {
        continue;
      }
      const fromX = xAxis.coords[xi];
      const fromY = yAxis.coords[yi];
      const toX = xAxis.coords[nxi];
      const toY = yAxis.coords[nyi];
      let laneAxis: "h" | "v";
      let laneLine: number;
      let from: number;
      let to: number;
      if (dy === 0) {
        // Horizontal move rides the horizontal line y = fromY.
        laneAxis = "h";
        laneLine = fromY;
        from = fromX;
        to = toX;
        if (!runIsFree(horizontalBlocked.byLine[yi], fromX, toX)) {
          continue;
        }
      } else {
        laneAxis = "v";
        laneLine = fromX;
        from = fromY;
        to = toY;
        if (!runIsFree(verticalBlocked.byLine[xi], fromY, toY)) {
          continue;
        }
      }

      const distance = Math.abs(to - from);
      const used = context.load.usedWidth(laneAxis, laneLine, from, to);
      const fits = used === 0 || used + LANE_GAP + request.strokeWidth <= LANE_CAPACITY;
      const factor = used === 0 ? COST_EMPTY : fits ? COST_SHARED : COST_OVERFLOW;
      const stepCost = distance * factor + (dir === currentDir ? 0 : TURN_COST);
      const nextState = (nxi * yCount + nyi) * 4 + dir;
      const nextG = current.g + stepCost;
      if (nextG < gScores[nextState] - 1e-9) {
        gScores[nextState] = nextG;
        cameFrom[nextState] = current.state;
        startOf[nextState] = startOf[current.state];
        push({
          f: nextG + heuristic(nxi * yCount + nyi),
          g: nextG,
          state: nextState,
          seq: (seq += 1),
        });
      }
    }
  }

  if (goalState < 0) {
    return undefined;
  }

  // Reconstruct the vertex chain, oldest first.
  const chain: number[] = [];
  for (let state = goalState; state >= 0; state = cameFrom[state]) {
    chain.push(Math.floor(state / 4));
  }
  chain.reverse();
  const vertices = chain.map((vertex) => ({
    x: xAxis.coords[Math.floor(vertex / yCount)],
    y: yAxis.coords[vertex % yCount],
  }));

  const source = sources[startOf[goalState]] ?? sources[0];
  const target = targets[goals.get(Math.floor(goalState / 4)) ?? 0] ?? targets[0];

  return {
    request,
    source,
    target,
    vertices: compactPoints(vertices),
    runs: [],
  };
}

/* ------------------------------------------------------------------ */
/* The final polyline                                                  */
/* ------------------------------------------------------------------ */

/**
 * Turns the on-line vertex chain into the drawn polyline: every straight run
 * shifts sideways to its assigned lane slot, corners re-join at the offset
 * intersections, and the true anchors (plus any tuck-under inset) go on the
 * ends. The stubs — anchor to first/last corner — stay at the anchor's exact
 * coordinate, so a wire always leaves a port dead straight.
 */
function assemblePendingEdge(entry: PendingEdge): GridPoint[] {
  const { source, target, vertices, runs } = entry;
  if (vertices.length === 0) {
    return [];
  }

  const sourceAnchor = endpointAnchor(source);
  const targetAnchor = endpointAnchor(target);
  const sourceStubAxis: "h" | "v" =
    source.side === "left" || source.side === "right" ? "h" : "v";
  const targetStubAxis: "h" | "v" =
    target.side === "left" || target.side === "right" ? "h" : "v";

  // No moves at all: the two aprons share a vertex (adjacent ports). Pure
  // stub work, no lanes involved.
  if (vertices.length === 1) {
    const apron = vertices[0];
    const stubCorner = (endpoint: GridEndpoint, stubAxis: "h" | "v"): GridPoint =>
      stubAxis === "h" ? { x: apron.x, y: endpoint.y } : { x: endpoint.x, y: apron.y };
    return compactPoints([
      sourceAnchor,
      stubCorner(source, sourceStubAxis),
      apron,
      stubCorner(target, targetStubAxis),
      targetAnchor,
    ]);
  }

  // The coordinate each run actually draws at: its line plus its lane slot —
  // except that a first/last run riding the port's own line keeps the
  // anchor's exact coordinate, so the wire leaves and enters dead straight
  // rather than jogging a few pixels at the coupling.
  const drawnOf = (index: number): number => {
    const run = runs[index];
    if (index === 0 && run.axis === sourceStubAxis) {
      return sourceStubAxis === "h" ? source.y : source.x;
    }
    if (index === runs.length - 1 && run.axis === targetStubAxis) {
      return targetStubAxis === "h" ? target.y : target.x;
    }
    return run.line + run.offset;
  };

  const points: GridPoint[] = [sourceAnchor];

  // Source stub onto the first run.
  const first = runs[0];
  if (first.axis !== sourceStubAxis) {
    points.push(
      sourceStubAxis === "h" ? { x: drawnOf(0), y: source.y } : { x: source.x, y: drawnOf(0) },
    );
  }

  // Interior corners: intersection of neighbouring drawn lines.
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const drawnA = drawnOf(i);
    const drawnB = drawnOf(i + 1);
    points.push({
      x: runs[i].axis === "v" ? drawnA : drawnB,
      y: runs[i].axis === "h" ? drawnA : drawnB,
    });
  }

  // Target stub off the last run.
  const lastIndex = runs.length - 1;
  const last = runs[lastIndex];
  if (last.axis !== targetStubAxis) {
    points.push(
      targetStubAxis === "h"
        ? { x: drawnOf(lastIndex), y: target.y }
        : { x: target.x, y: drawnOf(lastIndex) },
    );
  } else if (runs.length === 1 && first.axis === sourceStubAxis) {
    // One run shared by both stubs (straight shot port to port): the run is
    // pinned to the SOURCE anchor, so jog across to the target's coordinate
    // at the run's midpoint if the two anchors disagree.
    const sourceCoord = sourceStubAxis === "h" ? source.y : source.x;
    const targetCoord = targetStubAxis === "h" ? target.y : target.x;
    if (Math.abs(sourceCoord - targetCoord) > 0.5) {
      const mid = snapLine((first.from + first.to) / 2);
      if (first.axis === "h") {
        points.push({ x: mid, y: source.y }, { x: mid, y: target.y });
      } else {
        points.push({ x: source.x, y: mid }, { x: target.x, y: mid });
      }
    }
  }
  points.push(targetAnchor);

  return compactPoints(points);
}

/** Drops zero-length and collinear intermediate points. */
export function compactPoints(points: GridPoint[]): GridPoint[] {
  const kept: GridPoint[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 0.01 && Math.abs(prev.y - point.y) < 0.01) {
      continue;
    }
    kept.push(point);
    while (kept.length >= 3) {
      const a = kept[kept.length - 3];
      const b = kept[kept.length - 2];
      const c = kept[kept.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
        (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      if (!collinear) {
        break;
      }
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept;
}
