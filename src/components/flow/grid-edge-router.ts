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
 * The menu bottoms out at ⅛ (2px): the 1/16 sliver read as a hairline
 * scratch on the canvas, not as a wire.
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
/* Occupancy: who is already riding which stretch of which line        */
/* ------------------------------------------------------------------ */

interface LaneClaim {
  lo: number;
  hi: number;
}

/**
 * Claims are tracked per CELL of a line (each 20px stretch), because two
 * wires can share a line for part of its length and part company later —
 * capacity is a property of a stretch, not of the whole line.
 */
class LaneOccupancy {
  private cells = new Map<string, LaneClaim[]>();

  private key(axis: "h" | "v", line: number, cell: number): string {
    return `${axis}:${line}:${cell}`;
  }

  claimsFor(axis: "h" | "v", line: number, from: number, to: number): LaneClaim[] {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.ceil(Math.max(from, to) / BOARD_GRID) - 1;
    const merged: LaneClaim[] = [];
    for (let cell = lo; cell <= hi; cell += 1) {
      const claims = this.cells.get(this.key(axis, line, cell));
      if (claims) {
        merged.push(...claims);
      }
    }
    return merged;
  }

  /** Total stroke already claimed on the busiest cell of the stretch. */
  usedWidth(axis: "h" | "v", line: number, from: number, to: number): number {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.ceil(Math.max(from, to) / BOARD_GRID) - 1;
    let worst = 0;
    for (let cell = lo; cell <= hi; cell += 1) {
      const claims = this.cells.get(this.key(axis, line, cell));
      if (!claims) {
        continue;
      }
      let total = 0;
      for (const claim of claims) {
        total += claim.hi - claim.lo;
      }
      if (total > worst) {
        worst = total;
      }
    }
    return worst;
  }

  claim(axis: "h" | "v", line: number, from: number, to: number, claimInterval: LaneClaim) {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.ceil(Math.max(from, to) / BOARD_GRID) - 1;
    for (let cell = lo; cell <= hi; cell += 1) {
      const key = this.key(axis, line, cell);
      const claims = this.cells.get(key);
      if (claims) {
        claims.push(claimInterval);
      } else {
        this.cells.set(key, [claimInterval]);
      }
    }
  }
}

/**
 * Where in the lane a new wire of `width` sits, given what is already there:
 * the free interval closest to the line's centre. First wire rides dead
 * centre; the next slots beside it; a wire that fits nowhere returns centre
 * again — that is the sanctioned port-stub overlap, and the A* cost has
 * already made sure it only happens where there was no alternative.
 */
function packIntoLane(existing: LaneClaim[], width: number): LaneClaim {
  const half = LANE_CAPACITY / 2;
  const tryAt = (center: number): LaneClaim | undefined => {
    const lo = center - width / 2;
    const hi = center + width / 2;
    if (lo < -half - 1e-6 || hi > half + 1e-6) {
      return undefined;
    }
    for (const claim of existing) {
      if (lo < claim.hi + LANE_GAP - 1e-6 && hi > claim.lo - LANE_GAP + 1e-6) {
        return undefined;
      }
    }
    return { lo, hi };
  };

  const candidates: number[] = [0];
  for (const claim of existing) {
    candidates.push(claim.hi + LANE_GAP + width / 2);
    candidates.push(claim.lo - LANE_GAP - width / 2);
  }
  candidates.sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
  for (const center of candidates) {
    const slot = tryAt(center);
    if (slot) {
      return slot;
    }
  }
  return { lo: -width / 2, hi: width / 2 };
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
  occupancy: LaneOccupancy;
}

export function solveGridRoutes(
  obstacles: GridObstacle[],
  requests: GridRouteRequest[],
): Map<string, GridRoutedEdge> {
  const context: SolveContext = { obstacles, occupancy: new LaneOccupancy() };
  const results = new Map<string, GridRoutedEdge>();
  const sorted = [...requests].sort(
    (left, right) => left.order - right.order || (left.edgeId < right.edgeId ? -1 : 1),
  );
  for (const request of sorted) {
    results.set(request.edgeId, routeOne(context, request));
  }
  return results;
}

function routeOne(context: SolveContext, request: GridRouteRequest): GridRoutedEdge {
  const sources = request.sources.filter(isFiniteEndpoint);
  const targets = request.targets.filter(isFiniteEndpoint);
  if (sources.length === 0 || targets.length === 0) {
    return { edgeId: request.edgeId, points: [] };
  }

  let pad = WINDOW_PAD;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const routed = routeWithinWindow(context, request, sources, targets, pad);
    if (routed) {
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
    edgeId: request.edgeId,
    points: compactPoints([
      { x: source.x, y: source.y },
      sourceApron,
      { x: sourceApron.x, y: targetApron.y },
      targetApron,
      { x: target.x, y: target.y },
    ]),
  };
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
): GridRoutedEdge | undefined {
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
      const used = context.occupancy.usedWidth(laneAxis, laneLine, from, to);
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
    edgeId: request.edgeId,
    points: claimAndAssemble(context, request, source, target, compactPoints(vertices)),
  };
}

/* ------------------------------------------------------------------ */
/* Lane claiming and the final polyline                                */
/* ------------------------------------------------------------------ */

/**
 * Turns the on-line vertex chain into the drawn polyline: every straight run
 * claims its slice of its lane and shifts sideways to it, corners re-join at
 * the offset intersections, and the true anchors go on the ends. The stubs —
 * anchor to first/last corner — stay at the anchor's exact coordinate, so a
 * wire always leaves a port dead straight.
 */
function claimAndAssemble(
  context: SolveContext,
  request: GridRouteRequest,
  source: GridEndpoint,
  target: GridEndpoint,
  vertices: GridPoint[],
): GridPoint[] {
  if (vertices.length === 0) {
    return [];
  }

  const sourceStubAxis: "h" | "v" =
    source.side === "left" || source.side === "right" ? "h" : "v";
  const targetStubAxis: "h" | "v" =
    target.side === "left" || target.side === "right" ? "h" : "v";

  // No moves at all: the two aprons share a vertex (adjacent ports). Pure
  // stub work, nothing claims a lane.
  if (vertices.length === 1) {
    const apron = vertices[0];
    const stubCorner = (endpoint: GridEndpoint, stubAxis: "h" | "v"): GridPoint =>
      stubAxis === "h" ? { x: apron.x, y: endpoint.y } : { x: endpoint.x, y: apron.y };
    return compactPoints([
      { x: source.x, y: source.y },
      stubCorner(source, sourceStubAxis),
      apron,
      stubCorner(target, targetStubAxis),
      { x: target.x, y: target.y },
    ]);
  }

  interface Run {
    axis: "h" | "v";
    line: number;
    from: number;
    to: number;
    /** The coordinate this run actually draws at (line + lane offset). */
    drawn: number;
  }
  const runs: Run[] = [];
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const run: Run =
      a.y === b.y
        ? { axis: "h", line: a.y, from: a.x, to: b.x, drawn: a.y }
        : { axis: "v", line: a.x, from: a.y, to: b.y, drawn: a.x };
    const existing = context.occupancy.claimsFor(run.axis, run.line, run.from, run.to);
    const slot = packIntoLane(existing, request.strokeWidth);
    run.drawn = run.line + (slot.lo + slot.hi) / 2;
    context.occupancy.claim(run.axis, run.line, run.from, run.to, slot);
    runs.push(run);
  }

  // A first/last run that rides the port's own line keeps the anchor's exact
  // coordinate instead of its lane offset, so the wire leaves and enters a
  // port dead straight — the offset would be a pointless few-pixel jog right
  // at the coupling. Its lane claim stands either way.
  if (runs[0].axis === sourceStubAxis) {
    runs[0].drawn = sourceStubAxis === "h" ? source.y : source.x;
  }
  if (runs[runs.length - 1].axis === targetStubAxis) {
    const last = runs[runs.length - 1];
    last.drawn = targetStubAxis === "h" ? target.y : target.x;
  }

  const points: GridPoint[] = [{ x: source.x, y: source.y }];

  // Source stub onto the first run.
  const first = runs[0];
  if (first.axis !== sourceStubAxis) {
    // The run is perpendicular to the way the wire leaves the port: travel
    // straight out at the anchor's coordinate until the run's drawn line.
    points.push(
      sourceStubAxis === "h" ? { x: first.drawn, y: source.y } : { x: source.x, y: first.drawn },
    );
  }

  // Interior corners: intersection of neighbouring drawn lines.
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const runA = runs[i];
    const runB = runs[i + 1];
    points.push({
      x: runA.axis === "v" ? runA.drawn : runB.drawn,
      y: runA.axis === "h" ? runA.drawn : runB.drawn,
    });
  }

  // Target stub off the last run.
  const last = runs[runs.length - 1];
  if (last.axis !== targetStubAxis) {
    points.push(
      targetStubAxis === "h" ? { x: last.drawn, y: target.y } : { x: target.x, y: last.drawn },
    );
  } else if (runs.length === 1 && first.axis === sourceStubAxis) {
    // One run shared by both stubs (straight shot port to port): the run was
    // pinned to the SOURCE anchor above, so jog across to the target's
    // coordinate at the run's midpoint if the two anchors disagree.
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
  points.push({ x: target.x, y: target.y });

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
