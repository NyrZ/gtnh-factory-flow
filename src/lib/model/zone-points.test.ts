import { describe, expect, it } from "vitest";
import { settleZonePoints } from "./zone-points";

const GRID = 20;

describe("settleZonePoints", () => {
  it("snaps clicked corners to the grid and rebases them to the bounding box", () => {
    const zone = settleZonePoints(
      [
        { x: 103, y: 98 },
        { x: 297, y: 102 },
        { x: 301, y: 221 },
        { x: 99, y: 218 },
      ],
      GRID,
    );
    expect(zone).toBeDefined();
    expect(zone!.position).toEqual({ x: 100, y: 100 });
    expect(zone!.size).toEqual({ width: 200, height: 120 });
    expect(zone!.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ]);
  });

  it("keeps every deliberate corner of an L-shape", () => {
    const zone = settleZonePoints(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 0, y: 200 },
      ],
      GRID,
    );
    expect(zone).toBeDefined();
    expect(zone!.points.length).toBe(6);
  });

  it("collapses corners that snap onto each other, and the closing duplicate", () => {
    const zone = settleZonePoints(
      [
        { x: 0, y: 0 },
        { x: 4, y: 3 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
        { x: 2, y: 1 },
      ],
      GRID,
    );
    expect(zone).toBeDefined();
    expect(zone!.points.length).toBe(4);
  });

  it("rejects too few corners and loops thinner than a cell", () => {
    expect(
      settleZonePoints(
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ],
        GRID,
      ),
    ).toBeUndefined();
    expect(
      settleZonePoints(
        [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 100, y: 6 },
        ],
        GRID,
      ),
    ).toBeUndefined();
  });
});
