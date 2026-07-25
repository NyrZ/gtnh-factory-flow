import { describe, expect, it } from "vitest";
import { formatEdgeRateLabel, isEdgeStarved, type EdgeLabelInput } from "./edge-labels";

function makeEdge(overrides: Partial<EdgeLabelInput> = {}): EdgeLabelInput {
  return {
    demand: 100,
    unit: "/s",
    isLimited: false,
    isSupplyCapped: false,
    ...overrides,
  };
}

describe("isEdgeStarved", () => {
  it("returns without recursing", () => {
    // Guards the self-call that once made every edge render blow the stack.
    expect(isEdgeStarved(makeEdge())).toBe(false);
  });

  it("flags supply-capped edges", () => {
    expect(isEdgeStarved(makeEdge({ isSupplyCapped: true }))).toBe(true);
  });

  it("still honours the legacy isLimited flag", () => {
    expect(isEdgeStarved(makeEdge({ isLimited: true }))).toBe(true);
  });

  it("handles missing data", () => {
    expect(isEdgeStarved(undefined)).toBe(false);
  });
});

describe("formatEdgeRateLabel", () => {
  it("shows a plain rate when the consumer is fed", () => {
    expect(formatEdgeRateLabel(makeEdge({ demand: 100 }))).toBe("100 /s");
  });

  it("shows flowing over nameplate when starved", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({ demand: 1, transferred: 1, nameplateDemand: 100, isSupplyCapped: true }),
      ),
    ).toBe("1 / 100 /s");
  });

  it("keeps the fluid unit", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({
          demand: 12,
          transferred: 12,
          nameplateDemand: 480,
          unit: "L/s",
          isSupplyCapped: true,
        }),
      ),
    ).toBe("12 / 480 L/s");
  });

  it("does not show a ratio when the shortfall is negligible", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({ demand: 100, transferred: 100, nameplateDemand: 100, isSupplyCapped: true }),
      ),
    ).toBe("100 /s");
  });

  it("does not show a ratio for demand-capped edges with slack", () => {
    // Running below nameplate is normal when the plan simply wants less, and
    // must not be dressed up as a problem.
    expect(formatEdgeRateLabel(makeEdge({ demand: 5, nameplateDemand: 100 }))).toBe("5 /s");
  });

  it("prefers bundle totals over the individual edge", () => {
    expect(
      formatEdgeRateLabel(
        makeEdge({
          demand: 1,
          nameplateDemand: 100,
          isSupplyCapped: true,
          bundle: { demand: 3, nameplateDemand: 300, isSupplyCapped: true },
        }),
      ),
    ).toBe("3 / 300 /s");
  });

  it("returns an empty string without data", () => {
    expect(formatEdgeRateLabel(undefined)).toBe("");
  });
});
