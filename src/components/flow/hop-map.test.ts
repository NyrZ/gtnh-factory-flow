import { describe, expect, it } from "vitest";

import type { FactoryEdge } from "@/lib/model/types";
import { computeHopDepths, hopFill } from "./hop-map";

function edge(id: string, source: string, target: string): FactoryEdge {
  return { id, source, target, resourceKind: "item", resourceId: "item:x" };
}

describe("computeHopDepths", () => {
  it("counts wires outwards from the hub", () => {
    const depths = computeHopDepths("a", [edge("1", "a", "b"), edge("2", "b", "c")]);
    expect(depths.get("a")).toBe(0);
    expect(depths.get("b")).toBe(1);
    expect(depths.get("c")).toBe(2);
  });

  it("ignores direction — a feeder is as near as a consumer", () => {
    const depths = computeHopDepths("b", [edge("1", "a", "b"), edge("2", "b", "c")]);
    expect(depths.get("a")).toBe(1);
    expect(depths.get("c")).toBe(1);
  });

  it("takes the shortest route when a chain also has a shortcut", () => {
    const depths = computeHopDepths("a", [
      edge("1", "a", "b"),
      edge("2", "b", "c"),
      edge("3", "c", "d"),
      edge("4", "a", "d"),
    ]);
    expect(depths.get("d")).toBe(1);
  });

  it("leaves anything the hub cannot reach out of the map", () => {
    const depths = computeHopDepths("a", [edge("1", "a", "b"), edge("2", "y", "z")]);
    expect(depths.has("y")).toBe(false);
    expect(depths.has("z")).toBe(false);
  });

  it("counts a round trip through a buffer as one hop", () => {
    const depths = computeHopDepths(
      "a",
      [edge("1", "a", "drawer"), edge("2", "drawer", "b")],
      new Set(["drawer"]),
    );
    expect(depths.get("drawer")).toBe(1);
    expect(depths.get("b")).toBe(1);
  });

  it("charges for leaving the hub even when the hub is a buffer", () => {
    const depths = computeHopDepths(
      "drawer",
      [edge("1", "drawer", "a"), edge("2", "a", "b")],
      new Set(["drawer"]),
    );
    expect(depths.get("a")).toBe(1);
    expect(depths.get("b")).toBe(2);
  });

  it("does not let a buffer shortcut a longer way round", () => {
    // b is two machines out the long way, one hop through the drawer.
    const depths = computeHopDepths(
      "a",
      [edge("1", "a", "mid"), edge("2", "mid", "b"), edge("3", "a", "drawer"), edge("4", "drawer", "b")],
      new Set(["drawer"]),
    );
    expect(depths.get("b")).toBe(1);
  });

  it("keeps buffers back to back from costing twice", () => {
    const depths = computeHopDepths(
      "a",
      [edge("1", "a", "d1"), edge("2", "d1", "d2"), edge("3", "d2", "b")],
      new Set(["d1", "d2"]),
    );
    expect(depths.get("d2")).toBe(1);
    expect(depths.get("b")).toBe(1);
  });

  it("still counts every wire when nothing is pass-through", () => {
    const depths = computeHopDepths("a", [edge("1", "a", "drawer"), edge("2", "drawer", "b")]);
    expect(depths.get("b")).toBe(2);
  });

  it("terminates on a cycle", () => {
    const depths = computeHopDepths("a", [
      edge("1", "a", "b"),
      edge("2", "b", "c"),
      edge("3", "c", "a"),
    ]);
    expect(depths.get("c")).toBe(1);
    expect(depths.size).toBe(3);
  });
});

describe("hopFill", () => {
  it("gives the hub its own colour, off the ramp", () => {
    expect(hopFill(0, 4)).not.toBe(hopFill(1, 4));
  });

  it("spans the whole ramp however deep the chain runs", () => {
    expect(hopFill(1, 3)).toBe(hopFill(1, 9));
    expect(hopFill(3, 3)).toBe(hopFill(9, 9));
  });

  it("fades in one direction, with no stop to cross", () => {
    const brightness = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) +
      Number.parseInt(hex.slice(3, 5), 16) +
      Number.parseInt(hex.slice(5, 7), 16);
    const steps = [1, 2, 3, 4, 5, 6].map((depth) => brightness(hopFill(depth, 6)));
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]!).toBeLessThan(steps[index - 1]!);
    }
  });

  it("uses the near end when everything is one wire away", () => {
    expect(hopFill(1, 1)).toBe(hopFill(1, 5));
  });

  it("has one colour for out of reach", () => {
    expect(hopFill(-1, 4)).toBe(hopFill(-1, 9));
  });
});
