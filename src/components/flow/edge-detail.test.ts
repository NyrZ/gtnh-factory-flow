import { describe, expect, it } from "vitest";
import {
  EDGE_ARROW_ZOOM,
  EDGE_DETAIL_ARROWS,
  EDGE_DETAIL_GLOBAL,
  EDGE_DETAIL_LABELS,
  EDGE_DETAIL_PULSE,
  EDGE_GLOBAL_ZOOM,
  EDGE_LABEL_ZOOM,
  getEdgeDetailLevel,
  hasEdgeDetail,
  reuseObjectIdentity,
} from "./edge-detail";

/**
 * Two zooms from inside each band the thresholds carve out.
 *
 * Derived from the constants rather than written as literals, and without
 * assuming what ORDER the thresholds are in — retuning them has twice turned
 * hand-picked sample points into a test of nothing (or into a failure), which
 * is the opposite of what these are for.
 */
function samplesPerBand(): Array<[number, number]> {
  const edges = [...new Set([EDGE_LABEL_ZOOM, EDGE_ARROW_ZOOM, EDGE_GLOBAL_ZOOM])]
    .filter((zoom) => zoom > 0)
    .sort((left, right) => left - right);
  const bounds = [0, ...edges, edges[edges.length - 1]! + 1];
  const samples: Array<[number, number]> = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const low = bounds[index]!;
    const high = bounds[index + 1]!;
    const span = high - low;
    // A third and two thirds in: both strictly inside the band.
    samples.push([low + span / 3, low + (span * 2) / 3]);
  }
  return samples;
}

describe("getEdgeDetailLevel", () => {
  it("is stable across a zoom gesture that crosses no threshold", () => {
    // The whole point of the bitmask: panning the zoom slider within a band must
    // not produce a new value, or every edge re-renders and re-routes per frame.
    expect(getEdgeDetailLevel(1.0)).toBe(getEdgeDetailLevel(1.4));
    for (const [low, high] of samplesPerBand()) {
      expect(getEdgeDetailLevel(low)).toBe(getEdgeDetailLevel(high));
    }
  });

  it("shows arrows and labels when zoomed in", () => {
    const detail = getEdgeDetailLevel(1.5);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_ARROWS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_LABELS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_GLOBAL)).toBe(false);
  });

  it("keeps arrows and labels at the zooms they can still be read at", () => {
    const detail = getEdgeDetailLevel(EDGE_LABEL_ZOOM + 0.01);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_ARROWS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_LABELS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_PULSE)).toBe(true);
  });

  it("strips the line down to its route once nothing on it can be read", () => {
    // Past this the chip is a few pixels tall, the arrowhead is a smudge and
    // the dashes are a shimmer — and there are hundreds of each.
    const detail = getEdgeDetailLevel(EDGE_LABEL_ZOOM - 0.01);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_LABELS)).toBe(false);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_ARROWS)).toBe(false);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_PULSE)).toBe(false);
  });

  it("treats each threshold as inclusive at its exact value", () => {
    expect(hasEdgeDetail(getEdgeDetailLevel(EDGE_ARROW_ZOOM), EDGE_DETAIL_ARROWS)).toBe(true);
    expect(hasEdgeDetail(getEdgeDetailLevel(EDGE_LABEL_ZOOM), EDGE_DETAIL_LABELS)).toBe(true);
    expect(hasEdgeDetail(getEdgeDetailLevel(EDGE_GLOBAL_ZOOM), EDGE_DETAIL_GLOBAL)).toBe(false);
  });
});

describe("reuseObjectIdentity", () => {
  const recipe = { id: "recipe" };
  const node = { id: "node" };

  it("returns the same reference when nothing moved", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    const second = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    expect(second).toBe(first);
  });

  it("returns the new object when a field changes", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    const second = reuseObjectIdentity(cache, "a", { node, recipe, result: { utilization: 1 } });
    expect(second).not.toBe(first);
    expect(second.result).toEqual({ utilization: 1 });
  });

  it("compares by reference, not by value", () => {
    // A structurally equal but freshly built field is a real change to React, and
    // pretending otherwise would render stale data.
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { recipe: { id: "recipe" } });
    const second = reuseObjectIdentity(cache, "a", { recipe: { id: "recipe" } });
    expect(second).not.toBe(first);
  });

  it("keeps entries for different ids apart", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const a = reuseObjectIdentity(cache, "a", { node, recipe });
    const b = reuseObjectIdentity(cache, "b", { node, recipe });
    expect(b).not.toBe(a);
    expect(reuseObjectIdentity(cache, "a", { node, recipe })).toBe(a);
  });

  it("does not reuse when a field is removed", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe });
    const second = reuseObjectIdentity(cache, "a", { node });
    expect(second).not.toBe(first);
  });
});
