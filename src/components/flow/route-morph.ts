/**
 * Pure geometry for animating one wire route into another.
 *
 * The grid router replaces a route wholesale: a new solve hands every edge a
 * fresh polyline with its own corner count, and the SVG snaps to it in one
 * frame. To glide instead, both the old and the new polyline are resampled to
 * the same number of arc-length-uniform points, and the drawn line is the
 * point-by-point blend of the two. Mid-flight the corners melt — a blend of
 * two orthogonal paths is not orthogonal — which is fine, because the final
 * frame of every morph is the router's exact polyline again, corners and all.
 *
 * Everything here is pure over its inputs (no module state, no clock), so the
 * board's determinism rule holds: the same two routes always morph through
 * the same in-between shapes.
 */

export interface MorphPoint {
  x: number;
  y: number;
}

/** Total arc length of a polyline; 0 for fewer than two points. */
export function polylineLength(points: readonly MorphPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
}

/**
 * The polyline redrawn as `count` points spaced evenly along its arc, first
 * and last exactly the original endpoints. A degenerate input (one point, or
 * zero total length) pins every sample to the first point rather than
 * dividing by zero.
 */
export function resamplePolyline(points: readonly MorphPoint[], count: number): MorphPoint[] {
  const samples: MorphPoint[] = [];
  if (points.length === 0 || count <= 0) {
    return samples;
  }
  const total = polylineLength(points);
  if (points.length === 1 || total <= 0 || count === 1) {
    for (let index = 0; index < count; index += 1) {
      samples.push({ x: points[0].x, y: points[0].y });
    }
    return samples;
  }

  let segmentIndex = 1;
  let segmentStartArc = 0;
  let segmentLength = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  for (let index = 0; index < count; index += 1) {
    const target = (total * index) / (count - 1);
    while (segmentStartArc + segmentLength < target && segmentIndex < points.length - 1) {
      segmentStartArc += segmentLength;
      segmentIndex += 1;
      segmentLength = Math.hypot(
        points[segmentIndex].x - points[segmentIndex - 1].x,
        points[segmentIndex].y - points[segmentIndex - 1].y,
      );
    }
    const start = points[segmentIndex - 1];
    const end = points[segmentIndex];
    const ratio = segmentLength > 0 ? Math.min((target - segmentStartArc) / segmentLength, 1) : 0;
    samples.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    });
  }
  // Exactness at the ends is what lets a settled morph hand back to the
  // router's own points without a visible seam at the ports.
  samples[0] = { x: points[0].x, y: points[0].y };
  samples[count - 1] = {
    x: points[points.length - 1].x,
    y: points[points.length - 1].y,
  };
  return samples;
}

/** How many shared samples a morph between these two shapes deserves. */
export function morphSampleCount(from: readonly MorphPoint[], to: readonly MorphPoint[]): number {
  const corners = Math.max(from.length, to.length);
  return Math.min(48, Math.max(12, corners * 3));
}

/**
 * The blend of two same-length sample arrays at progress `t` (0 = from,
 * 1 = to). Caller is expected to have resampled both to the same count; if
 * the counts differ anyway, the shorter array's last point stands in.
 */
export function lerpSampledPolylines(
  from: readonly MorphPoint[],
  to: readonly MorphPoint[],
  t: number,
): MorphPoint[] {
  const count = Math.max(from.length, to.length);
  const blended: MorphPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const a = from[Math.min(index, from.length - 1)];
    const b = to[Math.min(index, to.length - 1)];
    if (!a || !b) {
      continue;
    }
    blended.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return blended;
}

/** Content equality, the identity the morph watches (solves rebuild arrays). */
export function polylinesEqual(
  a: readonly MorphPoint[] | undefined,
  b: readonly MorphPoint[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].x !== b[index].x || a[index].y !== b[index].y) {
      return false;
    }
  }
  return true;
}

/**
 * A plain M/L path for a mid-morph polyline. Rounded to centipixels so the
 * transient strings stay short; the settled frame uses the router's own
 * hopped path, not this.
 */
export function morphPointsToPath(points: readonly MorphPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  let path = `M ${round(points[0].x)},${round(points[0].y)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` L ${round(points[index].x)},${round(points[index].y)}`;
  }
  return path;
}
