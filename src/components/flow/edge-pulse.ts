/**
 * The marching dashes, moved off SVG.
 *
 * Pulse mode used to draw one extra `<path>` per edge with a CSS animation on
 * `stroke-dashoffset`. That property is a PAINT property: it cannot be
 * composited, so every frame of the animation invalidated the whole edge layer
 * and Chrome re-rastered every line on the board — 616 edges cost ~90ms a
 * frame with the board otherwise completely still. It was the single most
 * expensive thing the board did, and it did it forever, whether or not anyone
 * was looking.
 *
 * The dashes now live on one canvas sitting directly above the edge layer.
 * Geometry is the edges' own path strings handed to `Path2D`, and stroke
 * widths, dash lengths and speeds are the same numbers the SVG used, so what
 * is drawn is what was drawn before — one raster of the visible rectangle
 * instead of a repaint of the entire board.
 *
 * Everything here is pure module state in FLOW coordinates, the same
 * discipline the routing caches follow: nothing depends on zoom or pan.
 */

export interface EdgePulseSpec {
  /** The edge's route, exactly as the SVG draws it (hops included). */
  path: string;
  /** Stroke width of the dash overlay, in flow units. */
  width: number;
  dash: number;
  gap: number;
  /** Flow pixels per second the dashes travel. */
  velocity: number;
  /** Route bounding box, for viewport culling. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CompiledPulse extends EdgePulseSpec {
  path2d: Path2D | undefined;
  /**
   * A fixed head start, so lines do not all march in lockstep.
   *
   * Per-edge CSS animations each began whenever their element was created, so
   * the board's dashes were naturally scattered in phase. One shared clock
   * would snap every line of the same speed into a single marching column,
   * which reads as a synchronised light show rather than as flow. Derived from
   * the edge id, so a line's phase is stable across rerenders and reloads.
   */
  phase: number;
}

const pulses = new Map<string, CompiledPulse>();
/** Path2D is not free to build; route strings repeat across frames. */
const path2dCache = new Map<string, Path2D>();

function hashPhase(edgeId: string) {
  let hash = 0;
  for (let index = 0; index < edgeId.length; index += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function compilePath(path: string): Path2D | undefined {
  if (!path) {
    return undefined;
  }
  const cached = path2dCache.get(path);
  if (cached) {
    return cached;
  }
  // A malformed `d` throws in some engines; a missing pulse beats a dead frame.
  try {
    const compiled = new Path2D(path);
    // Routes churn while dragging; without a ceiling this grows unbounded.
    if (path2dCache.size > 4000) {
      path2dCache.clear();
    }
    path2dCache.set(path, compiled);
    return compiled;
  } catch {
    return undefined;
  }
}

export function publishEdgePulse(edgeId: string, spec: EdgePulseSpec) {
  const existing = pulses.get(edgeId);
  if (
    existing &&
    existing.path === spec.path &&
    existing.width === spec.width &&
    existing.dash === spec.dash &&
    existing.gap === spec.gap &&
    existing.velocity === spec.velocity
  ) {
    return;
  }

  pulses.set(edgeId, {
    ...spec,
    path2d: compilePath(spec.path),
    phase: existing?.phase ?? hashPhase(edgeId),
  });
}

export function retractEdgePulse(edgeId: string) {
  pulses.delete(edgeId);
}

export function clearEdgePulses() {
  pulses.clear();
  labelBoxes.clear();
}

export function edgePulseCount() {
  return pulses.size;
}

/**
 * Where each edge's rate chip sits, in flow units.
 *
 * The canvas has to sit at the very TOP of the paint order — anything drawn
 * above a composited layer has to be composited too, and letting 300 nodes and
 * 600 labels each become their own layer cost ~140ms of Layerize per frame. So
 * instead of relying on stacking to keep the dashes underneath the chips and
 * the cards, the canvas punches those rectangles back out after drawing. The
 * result on screen is the same; the layer tree stays at a handful.
 */
export interface EdgeLabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const labelBoxes = new Map<string, EdgeLabelBox>();

export function publishEdgeLabelBox(edgeId: string, box: EdgeLabelBox) {
  const existing = labelBoxes.get(edgeId);
  if (
    existing &&
    existing.left === box.left &&
    existing.top === box.top &&
    existing.width === box.width &&
    existing.height === box.height
  ) {
    return;
  }
  labelBoxes.set(edgeId, box);
}

export function retractEdgeLabelBox(edgeId: string) {
  labelBoxes.delete(edgeId);
}

/**
 * Clears the rectangles the dashes must not show through: the rate chips
 * always, and the machine cards whenever the edge layer is running beneath
 * them (thickness mode, where fat pipes deliberately dive under the cards).
 */
export function eraseEdgePulseOcclusion(
  context: CanvasRenderingContext2D,
  visible: { left: number; right: number; top: number; bottom: number },
  cardRects: Array<{ left: number; top: number; right: number; bottom: number }>,
) {
  const previousOperation = context.globalCompositeOperation;
  context.globalCompositeOperation = "destination-out";

  for (const rect of cardRects) {
    if (
      rect.right < visible.left ||
      rect.left > visible.right ||
      rect.bottom < visible.top ||
      rect.top > visible.bottom
    ) {
      continue;
    }
    context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  }

  for (const box of labelBoxes.values()) {
    if (
      box.left + box.width < visible.left ||
      box.left > visible.right ||
      box.top + box.height < visible.top ||
      box.top > visible.bottom
    ) {
      continue;
    }
    context.fillRect(box.left, box.top, box.width, box.height);
  }

  context.globalCompositeOperation = previousOperation;
}

/** Colour and cap match the SVG overlay this replaces, exactly. */
const PULSE_STROKE = "rgba(255,255,255,0.92)";

/**
 * Draws every pulse whose route intersects the visible flow rect.
 *
 * The context is expected to be in FLOW coordinates already (the caller
 * applies device pixel ratio and the viewport transform), so widths and dash
 * lengths are the same flow-space numbers the SVG used and scale with zoom the
 * same way.
 */
export function drawEdgePulses(
  context: CanvasRenderingContext2D,
  visible: { left: number; right: number; top: number; bottom: number },
  timeSeconds: number,
) {
  context.strokeStyle = PULSE_STROKE;
  context.lineCap = "butt";
  context.lineJoin = "round";

  let lastWidth = -1;
  let lastDash = -1;
  let lastGap = -1;
  for (const pulse of pulses.values()) {
    if (
      !pulse.path2d ||
      pulse.right < visible.left ||
      pulse.left > visible.right ||
      pulse.bottom < visible.top ||
      pulse.top > visible.bottom
    ) {
      continue;
    }

    if (pulse.width !== lastWidth) {
      context.lineWidth = pulse.width;
      lastWidth = pulse.width;
    }
    if (pulse.dash !== lastDash || pulse.gap !== lastGap) {
      context.setLineDash([pulse.dash, pulse.gap]);
      lastDash = pulse.dash;
      lastGap = pulse.gap;
    }
    const period = pulse.dash + pulse.gap;
    // Same sign convention as SVG stroke-dashoffset, and the same motion the
    // keyframes described: one whole period travelled per period/velocity
    // seconds, forever.
    context.lineDashOffset = -(((timeSeconds * pulse.velocity) / period + pulse.phase) % 1) * period;
    context.stroke(pulse.path2d);
  }
}
