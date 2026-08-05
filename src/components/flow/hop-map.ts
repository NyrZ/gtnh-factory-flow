"use client";

import { useSyncExternalStore } from "react";

import type { FactoryEdge } from "@/lib/model/types";
import { inkFor } from "./node-colors";

/**
 * How far every node is from the one under the cursor, in wires.
 *
 * Zoomed out the board is a field of cards and the shape of the plant is the
 * only thing left to read — but "what feeds this, and what does it feed, and
 * how far away is any of it" is exactly what you cannot see when the lines are
 * hairlines crossing a hundred other lines. So hovering a card at that zoom
 * turns the board into a distance map: the hovered node is the hub, everything
 * one wire away takes the first colour of the ramp, everything two wires away
 * the next, and so on out to the far edge of its chain. Anything the hub can't
 * reach at all drops out to grey.
 *
 * Distance is UNDIRECTED. "Two wires from here" is a statement about the
 * plant's layout, not about which way the items move; a node that feeds the hub
 * is as near to it as one the hub feeds, and treating them differently would
 * leave half of every chain grey for no reason a player would recognise.
 *
 * Three things about how it is built, all of them about cost:
 *
 * - NOTHING RE-RENDERS. The colours are written straight onto each mounted node
 *   element as two custom properties, and CSS in globals.css paints the glance
 *   layer from them. The first cut of this did it the React way — one
 *   `useSyncExternalStore` per card — and it cost 5× the frame rate while the
 *   pointer crossed the board: 150 components reconciling per hovered node.
 *   ARCHITECTURE.md's rule that hover must not rebuild the board is not a style
 *   preference, and a feature that only fires on hover is exactly where it
 *   bites. The one React subscriber left is the legend, which is one component.
 * - The map waits for the pointer to SETTLE. Sweeping the cursor towards a
 *   target crosses a dozen cards on the way, and rebuilding on each of them is
 *   both a flicker and a pile of work nobody asked for. A short rest before
 *   painting means the cost is paid once, when a hover is actually meant.
 * - The whole thing only exists at the glance zoom step. Zoomed in a card shows
 *   its real contents and painting over them would be vandalism, so
 *   NodeDetailController clears the map on the way back to full detail.
 */

/**
 * The ramp: one colour to one other colour, and nothing in between.
 *
 * A multi-stop rainbow discriminates more steps, but it reads as CATEGORIES —
 * "the yellow ones, the red ones, the blue ones" — and every stop is a place
 * where two adjacent rings look unrelated. A single fade has no seams in it, so
 * the eye reads it as one continuous quantity, which is what distance is. Hot
 * amber at the hub's doorstep, deep crimson at the far end of its chain.
 *
 * Held in HSL and mixed there rather than as two hex codes mixed channel by
 * channel. Straight RGB between a bright amber and a dark crimson runs through
 * mud — the saturation collapses in the middle and the halfway ring comes out
 * the colour of cardboard. Rotating the hue and dropping the lightness keeps
 * every step as vivid as the ends. The far hue is negative on purpose: it winds
 * DOWN through orange and red into crimson, the warm way round, instead of
 * taking the long way through green.
 */
const HOP_NEAR = { h: 40, s: 100, l: 64 };
const HOP_FAR = { h: -20, s: 72, l: 26 };

/** The hub is off the ramp on purpose: nothing else on the board is white. */
const HUB_FILL = "#fff6df";

/**
 * Nothing the hub touches. Present, but not competing.
 *
 * A light grey with faded ink rather than a dark tile: dark tiles read as
 * ANOTHER end of the ramp — "very far" instead of "not connected" — and the
 * whole point of this colour is to be outside the scale entirely.
 */
const UNREACHABLE_FILL = "#c9ccd1";
const UNREACHABLE_INK = "rgba(22,22,26,0.42)";

interface HopMap {
  hubId: string;
  maxDepth: number;
  depthById: Map<string, number>;
}

function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rampColor(t: number): string {
  const value = Math.min(Math.max(t, 0), 1);
  const lerp = (from: number, to: number) => from + (to - from) * value;
  return hslHex(
    lerp(HOP_NEAR.h, HOP_FAR.h),
    lerp(HOP_NEAR.s, HOP_FAR.s),
    lerp(HOP_NEAR.l, HOP_FAR.l),
  );
}

/** The colour for a given hop count, exported so the legend cannot drift. */
export function hopFill(depth: number, maxDepth: number): string {
  if (depth < 0) {
    return UNREACHABLE_FILL;
  }
  if (depth === 0) {
    return HUB_FILL;
  }
  // The ramp spans hop 1 to the furthest hop, so a three-deep chain uses the
  // whole fade rather than the first fifth of it — the reading is "near or far
  // for THIS plant", not an absolute number of wires. Safe to stretch this far
  // precisely because the ends are one colour fading into another: even a
  // two-ring map looks like two points on a scale, not like two categories.
  return rampColor(maxDepth > 1 ? (depth - 1) / (maxDepth - 1) : 0);
}

/** Legible ink for a hop colour — the legend uses it for its chip numbers. */
export function hopInk(depth: number, maxDepth: number): string {
  return depth < 0 ? UNREACHABLE_INK : inkFor(hopFill(depth, maxDepth)).ink;
}

/**
 * Breadth-first over the wires, from the hub outwards.
 *
 * Nodes are discovered from the edge list rather than from the node list: a
 * node with no wires at all can only ever be unreachable, and never appearing
 * in the map is the same answer as appearing at distance -1.
 *
 * `passThrough` — the drawers, tanks and buffers — are the exception to one hop
 * per wire. A machine feeding a drawer that feeds another machine is one step
 * away from it in the only sense a player cares about; the drawer is where the
 * items wait, not somewhere the chain goes. So going IN to a buffer costs a
 * hop and coming back out is free, which makes the round trip through it count
 * as one, and puts the buffer itself at the same distance as what it feeds.
 * Leaving the hub is never free, even when the hub is a buffer — hovering a
 * drawer has to put its neighbours at 1, not at 0.
 */
export function computeHopDepths(
  hubId: string,
  edges: readonly FactoryEdge[],
  passThrough?: ReadonlySet<string>,
): Map<string, number> {
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const existing = neighbours.get(from);
    if (existing) {
      existing.push(to);
    } else {
      neighbours.set(from, [to]);
    }
  };
  for (const edge of edges) {
    if (edge.source === edge.target) {
      continue;
    }
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  const depths = new Map<string, number>([[hubId, 0]]);
  let frontier = [hubId];
  let depth = 0;
  while (frontier.length > 0) {
    // Free first: anything reachable out of a buffer already in the frontier
    // joins it at the SAME distance, and can in turn leak through a buffer of
    // its own. Only then does the frontier take a real step.
    if (passThrough?.size) {
      const leaking = [...frontier];
      while (leaking.length > 0) {
        const id = leaking.pop()!;
        if (id === hubId || !passThrough.has(id)) {
          continue;
        }
        for (const neighbour of neighbours.get(id) ?? []) {
          if (depths.has(neighbour)) {
            continue;
          }
          depths.set(neighbour, depth);
          frontier.push(neighbour);
          leaking.push(neighbour);
        }
      }
    }

    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of neighbours.get(id) ?? []) {
        if (depths.has(neighbour)) {
          continue;
        }
        depths.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return depths;
}

let hopMap: HopMap | null = null;
const listeners = new Set<() => void>();

/**
 * The board wears "a map is up" as an attribute, and the wires read it in CSS.
 *
 * Under a distance map the wires have already said what they had to say — the
 * map IS the wiring, counted — and at this zoom they are a thicket that hides
 * the colours behind it. So they fade back. Done as an attribute plus a CSS
 * rule rather than as edge props for the reason ARCHITECTURE.md gives: hover
 * must not re-render the board, and this board can carry hundreds of edges.
 * The same trick, and the same warning about `className`, as node-detail.ts.
 */
export const HOP_MAP_ATTRIBUTE = "data-hop-map";

/** Set on the one node under the cursor, so CSS can give it its ring. */
export const HOP_HUB_ATTRIBUTE = "data-hop-hub";

/** The properties globals.css paints the glance layer from. */
const HOP_FILL_PROPERTY = "--hop-fill";
const HOP_INK_PROPERTY = "--hop-ink";
/**
 * The figure the card shows while a map is up — the hop count itself.
 *
 * A CSS string, quotes and all, because the rule that draws it is
 * `content: var(--hop-label)`. Doing it this way is what lets the card change
 * what it SAYS, not just what colour it is, without React hearing about it.
 * Out-of-reach cards get an empty label: their answer is "not from here", and
 * a number would be a lie.
 */
const HOP_LABEL_PROPERTY = "--hop-label";

let boardElement: HTMLElement | null = null;

export function registerHopMapBoard(element: HTMLElement | null) {
  boardElement = element;
  paint();
  return () => {
    if (boardElement === element) {
      boardElement = null;
    }
  };
}

/**
 * Write the current map onto the DOM — or wipe it off.
 *
 * Every mounted node gets a colour, including the ones the hub cannot reach:
 * "not connected to this" is part of the answer, and leaving those cards in
 * their normal colours would make them look like part of the map. Nodes that
 * are not mounted are not painted, which is fine and is why the map is dropped
 * the moment the board pans or zooms — see FactoryFlow's move handlers. React
 * Flow culls off-screen nodes, so a map held across a pan would arrive at cards
 * that never got the memo.
 */
function paint() {
  const board = boardElement;
  if (!board) {
    return;
  }
  const nodes = board.querySelectorAll<HTMLElement>(".react-flow__node");
  if (!hopMap) {
    board.removeAttribute(HOP_MAP_ATTRIBUTE);
    for (const node of nodes) {
      node.style.removeProperty(HOP_FILL_PROPERTY);
      node.style.removeProperty(HOP_INK_PROPERTY);
      node.style.removeProperty(HOP_LABEL_PROPERTY);
      node.removeAttribute(HOP_HUB_ATTRIBUTE);
    }
    return;
  }

  const { hubId, maxDepth, depthById } = hopMap;
  // One colour pair per DISTANCE rather than per node: a board where forty
  // cards sit two wires out does the colour maths once, not forty times.
  const fills = new Map<number, { fill: string; ink: string; label: string }>();
  const paintFor = (depth: number) => {
    let colour = fills.get(depth);
    if (!colour) {
      colour = {
        fill: hopFill(depth, maxDepth),
        ink: hopInk(depth, maxDepth),
        label: depth < 0 ? '""' : `"${depth}"`,
      };
      fills.set(depth, colour);
    }
    return colour;
  };

  board.setAttribute(HOP_MAP_ATTRIBUTE, "on");
  for (const node of nodes) {
    const id = node.getAttribute("data-id");
    const colour = paintFor(id ? (depthById.get(id) ?? -1) : -1);
    node.style.setProperty(HOP_FILL_PROPERTY, colour.fill);
    node.style.setProperty(HOP_INK_PROPERTY, colour.ink);
    node.style.setProperty(HOP_LABEL_PROPERTY, colour.label);
    if (id === hubId) {
      node.setAttribute(HOP_HUB_ATTRIBUTE, "on");
    } else {
      node.removeAttribute(HOP_HUB_ATTRIBUTE);
    }
  }
}

function publish() {
  paint();
  for (const listener of listeners) {
    listener();
  }
}

export function setHopMapHub(
  hubId: string,
  edges: readonly FactoryEdge[],
  passThrough?: ReadonlySet<string>,
) {
  if (hopMap?.hubId === hubId) {
    return;
  }
  const depthById = computeHopDepths(hubId, edges, passThrough);
  let maxDepth = 0;
  for (const depth of depthById.values()) {
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  }
  hopMap = { hubId, maxDepth, depthById };
  publish();
}

export function clearHopMap() {
  if (!hopMap) {
    return;
  }
  hopMap = null;
  publish();
}

export function getHopMapHubId(): string | undefined {
  return hopMap?.hubId;
}

export function subscribeHopMap(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The map as a whole, for the legend. Re-renders only when the hub changes. */
export function useHopMapSummary(): { hubId: string; maxDepth: number } | undefined {
  return useSyncExternalStore(subscribeHopMap, getHopMapSummary, () => undefined);
}

let summary: { hubId: string; maxDepth: number } | undefined;
let summarySource: HopMap | null = null;

function getHopMapSummary(): { hubId: string; maxDepth: number } | undefined {
  // Cached against the map it was derived from: getSnapshot must return the
  // same identity for the same state or useSyncExternalStore loops forever.
  if (summarySource !== hopMap) {
    summarySource = hopMap;
    summary = hopMap ? { hubId: hopMap.hubId, maxDepth: hopMap.maxDepth } : undefined;
  }
  return summary;
}
