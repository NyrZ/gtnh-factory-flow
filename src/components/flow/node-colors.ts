import type { FactoryNodeColorTag } from "@/lib/model/types";

/**
 * Perceived brightness of a hex colour, 0 (black) to 1 (white) — the sRGB
 * relative luminance from WCAG, not a naive channel average, because green
 * reads far brighter than blue at the same numeric value.
 */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The ink a tinted node has to switch to. Black text on the black tag and
 * white text on the white tag were both unreadable — the paint decides the
 * ink, so every swatch stays legible. The threshold sits where white and
 * black text reach equal contrast against the panel.
 */
export function inkFor(panel: string): { ink: string; inkMuted: string } {
  return relativeLuminance(panel) < 0.34
    ? { ink: "#f2f3f7", inkMuted: "rgba(242,243,247,0.74)" }
    : { ink: "#16161a", inkMuted: "rgba(22,22,26,0.66)" };
}

export const GT_NODE_COLORS: Record<
  FactoryNodeColorTag,
  { swatch: string; panel: string; header: string; border: string; shadow: string }
> = {
  white: {
    swatch: "#f0f0f0",
    panel: "#d8d8d8",
    header: "#c8c8c8",
    border: "#9f9f9f",
    shadow: "#f0f0f0",
  },
  orange: {
    swatch: "#f9801d",
    panel: "#d4945d",
    header: "#c96b1e",
    border: "#914811",
    shadow: "#f9801d",
  },
  magenta: {
    swatch: "#c74ebd",
    panel: "#b983b4",
    header: "#a8439f",
    border: "#7d2c76",
    shadow: "#c74ebd",
  },
  light_blue: {
    swatch: "#3ab3da",
    panel: "#9eb6ce",
    header: "#7f99b8",
    border: "#637999",
    shadow: "#9eb6ce",
  },
  yellow: {
    swatch: "#fed83d",
    panel: "#d2bd68",
    header: "#c8a929",
    border: "#957912",
    shadow: "#fed83d",
  },
  lime: {
    swatch: "#80c71f",
    panel: "#9db76e",
    header: "#68a31c",
    border: "#487612",
    shadow: "#80c71f",
  },
  pink: {
    swatch: "#f38baa",
    panel: "#d0a0b0",
    header: "#c66f89",
    border: "#955168",
    shadow: "#f38baa",
  },
  gray: {
    swatch: "#474f52",
    panel: "#6b6f70",
    header: "#565e61",
    border: "#33383a",
    shadow: "#474f52",
  },
  light_gray: {
    swatch: "#9d9d97",
    panel: "#a6a6a0",
    header: "#85857f",
    border: "#62625e",
    shadow: "#9d9d97",
  },
  cyan: {
    swatch: "#169c9c",
    panel: "#73a6a6",
    header: "#168282",
    border: "#0e6262",
    shadow: "#169c9c",
  },
  purple: {
    swatch: "#8932b8",
    panel: "#9275a7",
    header: "#74309a",
    border: "#562172",
    shadow: "#8932b8",
  },
  blue: {
    swatch: "#3c44aa",
    panel: "#8f9ab8",
    header: "#6f7ea6",
    border: "#586484",
    shadow: "#3c44aa",
  },
  brown: {
    swatch: "#835432",
    panel: "#8b735f",
    header: "#70482d",
    border: "#50331f",
    shadow: "#835432",
  },
  green: {
    swatch: "#5e7c16",
    panel: "#788767",
    header: "#536c16",
    border: "#394b0d",
    shadow: "#5e7c16",
  },
  red: {
    swatch: "#b02e26",
    panel: "#a87572",
    header: "#962a24",
    border: "#6f1c18",
    shadow: "#b02e26",
  },
  black: {
    swatch: "#1d1d21",
    panel: "#555559",
    header: "#303033",
    border: "#111114",
    shadow: "#1d1d21",
  },
};

/**
 * The ink each tag needs, keyed the same way as the colours. Node components
 * push these into `--mc-ink` / `--mc-ink-muted` on the card root, so every
 * label, rate and stat inside inherits readable text without any component
 * knowing which colour it was painted.
 */
export const GT_NODE_INK: Record<FactoryNodeColorTag, { ink: string; inkMuted: string }> =
  Object.fromEntries(
    Object.entries(GT_NODE_COLORS).map(([tag, color]) => [tag, inkFor(color.panel)]),
  ) as Record<FactoryNodeColorTag, { ink: string; inkMuted: string }>;

export interface NodeSurfaceColor {
  swatch: string;
  panel: string;
  header: string;
  border: string;
  shadow: string;
}

/**
 * The custom rate card's own face: the app's deep blue, not a dye off the
 * palette above.
 *
 * The palette's panels are deliberately pale — they tint a card without
 * hiding what is written on it — and a card's ink stays light whatever it is
 * painted, since half of a card is inset chips and textures that do not
 * recolour. `blue` (#8f9ab8) came out just under the ink threshold, so the
 * card shipped as white text on a pale blue face, with every gap between its
 * panels reading as a bright band. This sits near an unpainted card's face in
 * darkness, so the card reads like every other card, and is unmistakably blue.
 */
export const CUSTOM_RATE_NODE_COLOR: NodeSurfaceColor = {
  swatch: "#3c6bb0",
  panel: "#2c3853",
  header: "#39496b",
  border: "#141a28",
  shadow: "#3c6bb0",
};

function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16);
  const blend = (offset: number) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

/**
 * The heatmap ramp: red at idle, amber at half, green at full blast.
 *
 * Deliberately NOT the cold-to-hot ramp a heatmap usually implies. Everywhere
 * else on this board red means "act here" and green means "done", and a mode
 * where red suddenly meant "running beautifully" would poison that reading.
 * So the question this answers is "where is my capacity going to waste?" — the
 * loudest nodes are the ones with the most slack.
 */
const HEAT_STOPS: Array<{ at: number; color: string }> = [
  { at: 0, color: "#b02e26" },
  { at: 0.5, color: "#c8a929" },
  { at: 1, color: "#5e7c16" },
];

/** A machine that is switched off has no heat to report — it reads neutral. */
const HEAT_OFF: NodeSurfaceColor = {
  swatch: "#6b6f70",
  panel: "#6b6f70",
  header: "#565e61",
  border: "#33383a",
  shadow: "#474f52",
};

export function heatmapColorFor(
  utilization: number | undefined,
  enabled = true,
): NodeSurfaceColor {
  if (!enabled || utilization === undefined || !Number.isFinite(utilization)) {
    return HEAT_OFF;
  }
  const value = Math.min(Math.max(utilization, 0), 1);
  let base = HEAT_STOPS[HEAT_STOPS.length - 1]!.color;
  for (let index = 0; index < HEAT_STOPS.length - 1; index += 1) {
    const low = HEAT_STOPS[index]!;
    const high = HEAT_STOPS[index + 1]!;
    if (value <= high.at) {
      const span = high.at - low.at;
      base = mixHex(low.color, high.color, span > 0 ? (value - low.at) / span : 0);
      break;
    }
  }
  return {
    swatch: base,
    // The card body is the ramp muted toward the panel grey, so the heat reads
    // as a wash rather than as a solid block of paint behind the text.
    panel: mixHex(base, "#8a8a8a", 0.42),
    header: mixHex(base, "#8a8a8a", 0.18),
    border: mixHex(base, "#101010", 0.42),
    shadow: base,
  };
}

/** Ink for a heat colour, same luminance rule as the paint tags. */
export function heatmapInkFor(panel: string): { ink: string; inkMuted: string } {
  return inkFor(panel);
}

/**
 * The same ramp the heatmap uses, as a bare colour — for lines in flow mode,
 * where the reading is "how much moves here" rather than "how busy is this
 * machine". One ramp across both so a red line and a red node mean the same
 * kind of thing: the quiet end of the scale.
 */
export function flowRampColor(normalized: number): string {
  return heatmapColorFor(normalized).swatch;
}

export const GT_NODE_COLOR_TAGS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] satisfies FactoryNodeColorTag[];

export const GT_NODE_COLOR_PALETTE: Array<{
  tag: FactoryNodeColorTag;
  color: (typeof GT_NODE_COLORS)[FactoryNodeColorTag];
}> = GT_NODE_COLOR_TAGS.map((tag) => ({
  tag,
  color: GT_NODE_COLORS[tag],
}));
