import { describe, expect, it } from "vitest";
import {
  canonicalizeResourceHandleId,
  dedupeEdgeWires,
  findDuplicateEdge,
  isSameEdgeWire,
} from "./edge-identity";
import type { FactoryEdge } from "./types";

function edge(patch: Partial<FactoryEdge> = {}): FactoryEdge {
  return {
    id: "edge-1",
    source: "maker",
    target: "taker",
    sourceHandle: "output:item:cobble",
    targetHandle: "input:item:cobble",
    resourceKind: "item",
    resourceId: "cobble",
    label: "Cobblestone",
    ...patch,
  };
}

describe("canonicalizeResourceHandleId", () => {
  it("drops a trailing slot index", () => {
    expect(canonicalizeResourceHandleId("output:item:cobble:0")).toBe("output:item:cobble");
    expect(canonicalizeResourceHandleId("input:fluid:water:12")).toBe("input:fluid:water");
  });

  it("leaves an index-less handle alone", () => {
    expect(canonicalizeResourceHandleId("output:item:cobble")).toBe("output:item:cobble");
  });

  it("keeps the encoded resource id byte for byte", () => {
    expect(canonicalizeResourceHandleId("input:item:oredict%3AstickWood:3")).toBe(
      "input:item:oredict%3AstickWood",
    );
  });

  it("passes anything it cannot read through untouched", () => {
    expect(canonicalizeResourceHandleId("storage-top")).toBe("storage-top");
    expect(canonicalizeResourceHandleId(undefined)).toBeUndefined();
    expect(canonicalizeResourceHandleId("")).toBeUndefined();
  });
});

describe("isSameEdgeWire", () => {
  it("matches the same rows however the handles spell the slot", () => {
    expect(
      isSameEdgeWire(
        edge({ id: "a", sourceHandle: "output:item:cobble:0", targetHandle: "input:item:cobble:2" }),
        edge({ id: "b" }),
      ),
    ).toBe(true);
  });

  it("separates different resources on the same pair of cards", () => {
    expect(
      isSameEdgeWire(
        edge({ id: "a" }),
        edge({
          id: "b",
          resourceId: "gravel",
          sourceHandle: "output:item:gravel",
          targetHandle: "input:item:gravel",
        }),
      ),
    ).toBe(false);
  });

  it("separates the two forms of a resource", () => {
    expect(
      isSameEdgeWire(
        edge({ id: "a" }),
        edge({
          id: "b",
          resourceKind: "fluid",
          sourceHandle: "output:fluid:cobble",
          targetHandle: "input:fluid:cobble",
        }),
      ),
    ).toBe(false);
  });

  it("separates an ore dictionary slot from a concrete one", () => {
    expect(
      isSameEdgeWire(
        edge({ id: "a", targetHandle: "input:item:oredict%3AstickWood:0" }),
        edge({ id: "b", targetHandle: "input:item:minecraft%3Astick%400" }),
      ),
    ).toBe(false);
  });

  it("separates different cards", () => {
    expect(isSameEdgeWire(edge({ id: "a" }), edge({ id: "b", target: "other-taker" }))).toBe(false);
  });
});

describe("findDuplicateEdge", () => {
  it("finds the wire an auto-connected edge would double", () => {
    const existing = edge({
      id: "auto",
      sourceHandle: "output:item:cobble:0",
      targetHandle: "input:item:cobble:0",
    });

    expect(findDuplicateEdge([existing], edge({ id: "dragged" }))?.id).toBe("auto");
  });

  it("returns nothing when the board has no such wire", () => {
    expect(findDuplicateEdge([], edge())).toBeUndefined();
  });
});

describe("dedupeEdgeWires", () => {
  it("keeps the first of each wire and drops the copies", () => {
    const kept = dedupeEdgeWires([
      edge({ id: "first", sourceHandle: "output:item:cobble:0" }),
      edge({ id: "copy", sourceHandle: "output:item:cobble:1" }),
      edge({ id: "copy-again" }),
      edge({ id: "other", target: "second-taker" }),
    ]);

    expect(kept.map((entry) => entry.id)).toEqual(["first", "other"]);
  });

  it("returns the same array when there is nothing to drop", () => {
    const edges = [edge({ id: "a" }), edge({ id: "b", target: "second-taker" })];
    expect(dedupeEdgeWires(edges)).toBe(edges);
  });
});
