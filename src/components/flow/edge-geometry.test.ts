import { describe, expect, it } from "vitest";

import {
  EDGE_LANE_CAP,
  assignEdgeLanes,
  compareEdgeDepth,
  edgeCasingWidth,
} from "./edge-geometry";

const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe("assignEdgeLanes", () => {
  it("gives every wire off one machine's outputs its own lane", () => {
    const lanes = assignEdgeLanes([
      edge("a", "smelter", "press"),
      edge("b", "smelter", "bender"),
      edge("c", "smelter", "drawer"),
    ]);

    expect(new Set(lanes.values()).size).toBe(3);
  });

  it("gives every wire into one machine's inputs its own lane", () => {
    const lanes = assignEdgeLanes([
      edge("a", "smelter", "assembler"),
      edge("b", "bender", "assembler"),
      edge("c", "wiremill", "assembler"),
    ]);

    expect(new Set(lanes.values()).size).toBe(3);
  });

  it("separates parallel wires between the same pair of machines", () => {
    // Two resources moving between one producer and one consumer: the case the
    // hash got wrong most visibly, since both endpoints coincide.
    const lanes = assignEdgeLanes([
      edge("plate", "smelter", "assembler"),
      edge("rod", "smelter", "assembler"),
    ]);

    expect(lanes.get("plate")).not.toBe(lanes.get("rod"));
  });

  it("reuses lanes across machines that share no endpoint", () => {
    // Unrelated wires are not conflicts — reusing lane 0 keeps offsets tight
    // rather than marching every wire on the board further out.
    const lanes = assignEdgeLanes([
      edge("a", "smelter", "press"),
      edge("b", "furnace", "bender"),
    ]);

    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(0);
  });

  it("wraps past the cap instead of running off the board", () => {
    const lanes = assignEdgeLanes(
      Array.from({ length: EDGE_LANE_CAP + 2 }, (_unused, index) =>
        edge(`e${index}`, "hub", `sink${index}`),
      ),
    );

    for (const lane of lanes.values()) {
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(EDGE_LANE_CAP);
    }
    // The wrap is the documented cost of a finite cap: wire 0 and wire
    // EDGE_LANE_CAP share a run again.
    expect(lanes.get("e0")).toBe(lanes.get(`e${EDGE_LANE_CAP}`));
  });

  it("is deterministic for the same input", () => {
    const edges = [
      edge("a", "smelter", "assembler"),
      edge("b", "smelter", "assembler"),
      edge("c", "bender", "assembler"),
    ];

    expect([...assignEdgeLanes(edges)]).toEqual([...assignEdgeLanes(edges)]);
  });

  it("does not depend on anything but source, target and order", () => {
    // Routing determinism rests on this: a solver run must never reshuffle
    // lanes, because a changed lane offset reroutes the edge.
    const before = assignEdgeLanes([
      edge("a", "smelter", "assembler"),
      edge("b", "bender", "assembler"),
    ]);
    const after = assignEdgeLanes([
      edge("a", "smelter", "assembler"),
      edge("b", "bender", "assembler"),
    ]);

    expect([...before]).toEqual([...after]);
  });
});

describe("compareEdgeDepth", () => {
  const thin = { width: 9, routeIndex: 0 };
  const fat = { width: 34, routeIndex: 1 };

  it("puts the thinner line on top, whatever the route order says", () => {
    // Sorting ascending is back-to-front, so "on top" is last.
    expect([thin, fat].sort(compareEdgeDepth)).toEqual([fat, thin]);
    expect([fat, thin].sort(compareEdgeDepth)).toEqual([fat, thin]);
  });

  it("makes the thinner line the one that hops", () => {
    // The hop rule is "positive means I am in front of you, so I hop".
    expect(compareEdgeDepth(thin, fat)).toBeGreaterThan(0);
    expect(compareEdgeDepth(fat, thin)).toBeLessThan(0);
  });

  it("is antisymmetric, so exactly one side of a crossing bumps", () => {
    // If both sides read the relation as "I hop", a crossing gets two humps;
    // if neither does, it gets none.
    const lines = [
      { width: 9, routeIndex: 0 },
      { width: 34, routeIndex: 1 },
      { width: 9, routeIndex: 2 },
      { width: 21, routeIndex: 3 },
    ];
    for (const left of lines) {
      for (const right of lines) {
        if (left === right) {
          continue;
        }
        expect(Math.sign(compareEdgeDepth(left, right))).toBe(
          -Math.sign(compareEdgeDepth(right, left)),
        );
        expect(compareEdgeDepth(left, right)).not.toBe(0);
      }
    }
  });

  it("falls back to route order at equal widths, preserving thin-mode behaviour", () => {
    // Thin mode publishes one width for every line, so this is the only branch
    // that runs there and it must match the old routeIndex precedence.
    const first = { width: 3, routeIndex: 0 };
    const second = { width: 3, routeIndex: 1 };
    expect(compareEdgeDepth(second, first)).toBeGreaterThan(0);
    expect([second, first].sort(compareEdgeDepth)).toEqual([first, second]);
  });

  it("leaves a uniform-width board in its original order", () => {
    const lines = [0, 1, 2, 3, 4].map((routeIndex) => ({ width: 3, routeIndex }));
    expect([...lines].sort(compareEdgeDepth)).toEqual(lines);
  });
});

describe("edgeCasingWidth", () => {
  it("keeps the old flat rim on thin wires", () => {
    expect(edgeCasingWidth(3)).toBeCloseTo(5);
    expect(edgeCasingWidth(3.1)).toBeCloseTo(5.1);
  });

  it("grows the rim with the stroke so fat pipes still separate", () => {
    // The bug: at 34px a flat +2 rim is 6% of the width and reads as nothing.
    const rimAt34 = edgeCasingWidth(34) - 34;
    expect(rimAt34).toBeGreaterThan(6);
  });

  it("is monotonic in the core width", () => {
    let previous = 0;
    for (const width of [3, 9, 16, 24, 34]) {
      const casing = edgeCasingWidth(width);
      expect(casing).toBeGreaterThan(previous);
      expect(casing).toBeGreaterThan(width);
      previous = casing;
    }
  });
});
