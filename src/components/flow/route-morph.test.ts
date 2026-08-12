import { describe, expect, it } from "vitest";

import {
  lerpSampledPolylines,
  morphPointsToPath,
  morphSampleCount,
  polylineLength,
  polylinesEqual,
  resamplePolyline,
} from "./route-morph";

describe("polylineLength", () => {
  it("sums segment lengths", () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
      ]),
    ).toBe(70);
  });

  it("is zero for degenerate polylines", () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });
});

describe("resamplePolyline", () => {
  it("keeps the exact endpoints", () => {
    const samples = resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
      ],
      17,
    );
    expect(samples).toHaveLength(17);
    expect(samples[0]).toEqual({ x: 0, y: 0 });
    expect(samples[16]).toEqual({ x: 100, y: 60 });
  });

  it("spaces samples evenly along the arc", () => {
    const samples = resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      5,
    );
    expect(samples.map((point) => point.x)).toEqual([0, 25, 50, 75, 100]);
  });

  it("walks corners without losing arc distance", () => {
    // An L of 50 + 50: the middle sample of five sits exactly on the corner.
    const samples = resamplePolyline(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      5,
    );
    expect(samples[2]).toEqual({ x: 50, y: 0 });
    expect(samples[3]).toEqual({ x: 50, y: 25 });
  });

  it("pins every sample to a zero-length polyline's point", () => {
    const samples = resamplePolyline([{ x: 7, y: 9 }], 4);
    expect(samples).toEqual([
      { x: 7, y: 9 },
      { x: 7, y: 9 },
      { x: 7, y: 9 },
      { x: 7, y: 9 },
    ]);
  });

  it("returns nothing for an empty polyline", () => {
    expect(resamplePolyline([], 8)).toEqual([]);
  });
});

describe("lerpSampledPolylines", () => {
  const from = resamplePolyline(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    9,
  );
  const to = resamplePolyline(
    [
      { x: 0, y: 40 },
      { x: 100, y: 40 },
    ],
    9,
  );

  it("is the source at t=0 and the target at t=1", () => {
    expect(lerpSampledPolylines(from, to, 0)).toEqual(from);
    expect(lerpSampledPolylines(from, to, 1)).toEqual(to);
  });

  it("blends linearly in between", () => {
    const half = lerpSampledPolylines(from, to, 0.5);
    expect(half[0]).toEqual({ x: 0, y: 20 });
    expect(half[8]).toEqual({ x: 100, y: 20 });
  });
});

describe("morphSampleCount", () => {
  it("grows with corner count and stays bounded", () => {
    expect(morphSampleCount([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toBe(12);
    const many = Array.from({ length: 40 }, (_, index) => ({ x: index, y: 0 }));
    expect(morphSampleCount(many, [])).toBe(48);
  });
});

describe("polylinesEqual", () => {
  it("compares content, not identity", () => {
    const a = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    expect(polylinesEqual(a, [...a.map((point) => ({ ...point }))])).toBe(true);
    expect(polylinesEqual(a, [{ x: 1, y: 2 }])).toBe(false);
    expect(
      polylinesEqual(a, [
        { x: 1, y: 2 },
        { x: 3, y: 5 },
      ]),
    ).toBe(false);
    expect(polylinesEqual(undefined, a)).toBe(false);
    expect(polylinesEqual(undefined, undefined)).toBe(true);
  });
});

describe("morphPointsToPath", () => {
  it("draws M/L legs", () => {
    expect(
      morphPointsToPath([
        { x: 0, y: 0 },
        { x: 20.004, y: 0 },
        { x: 20.004, y: 40 },
      ]),
    ).toBe("M 0,0 L 20,0 L 20,40");
  });

  it("is empty for no points", () => {
    expect(morphPointsToPath([])).toBe("");
  });
});
