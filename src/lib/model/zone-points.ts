/**
 * Settling clicked zone corners into an editable zone annotation.
 *
 * A zone is drawn corner by corner - click, click, click, then close on the
 * first corner - so every point is deliberate and none are simplified away.
 * The corners snap to the board grid, consecutive duplicates collapse, and
 * the result is rebased so `position` is the bounding box corner and every
 * vertex is local to it - the same contract the other annotations follow.
 */

export interface ZonePoint {
  x: number;
  y: number;
}

export interface SettledZone {
  position: ZonePoint;
  size: { width: number; height: number };
  /** Local to `position`, in order, an implicit edge closing last back to first. */
  points: ZonePoint[];
}

/** Matches the schema's ceiling. */
const MAX_ZONE_POINTS = 64;

/**
 * Settle clicked corners (flow coordinates) into a zone, or nothing when they
 * never made an area: fewer than three distinct corners, or a loop thinner
 * than a cell.
 */
export function settleZonePoints(corners: ZonePoint[], grid: number): SettledZone | undefined {
  const snapped: ZonePoint[] = [];
  for (const point of corners) {
    const next = {
      x: Math.round(point.x / grid) * grid,
      y: Math.round(point.y / grid) * grid,
    };
    const previous = snapped[snapped.length - 1];
    if (!previous || previous.x !== next.x || previous.y !== next.y) {
      snapped.push(next);
    }
  }
  // The final click lands on the first corner to close; that edge is implicit.
  while (
    snapped.length > 1 &&
    snapped[0].x === snapped[snapped.length - 1].x &&
    snapped[0].y === snapped[snapped.length - 1].y
  ) {
    snapped.pop();
  }

  if (snapped.length < 3 || snapped.length > MAX_ZONE_POINTS) {
    return undefined;
  }

  const minX = Math.min(...snapped.map((point) => point.x));
  const minY = Math.min(...snapped.map((point) => point.y));
  const width = Math.max(...snapped.map((point) => point.x)) - minX;
  const height = Math.max(...snapped.map((point) => point.y)) - minY;
  if (width < grid || height < grid) {
    return undefined;
  }

  return {
    position: { x: minX, y: minY },
    size: { width, height },
    points: snapped.map((point) => ({ x: point.x - minX, y: point.y - minY })),
  };
}
