/**
 * Board background themes: the paper the factory is drawn on.
 *
 * A theme is three things: the flat base colour (also what image exports use
 * for their background), the ink the dot/line/cross pattern is drawn in, and
 * an optional SCREEN-SPACE texture layered over the base. The texture is the
 * desk pad under the glass - it does not pan or zoom with the factory, which
 * is exactly how a real sheet under a lens behaves, and it costs nothing per
 * frame because it is a static CSS background on the board container.
 *
 * The pattern (dots/lines/cross/none) stays its own independent toggle; a
 * theme only decides what colour that pattern is inked in.
 *
 * Inside a pocket dimension none of this applies: the violet room IS the
 * pocket's theme, and it must read the same on every board.
 */
export type CanvasThemeId =
  | "slate"
  | "void"
  | "blueprint"
  | "chalkboard"
  | "graphite"
  | "parchment"
  | "notepad"
  | "graph";

export interface CanvasTheme {
  id: CanvasThemeId;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** The flat paper colour. Exports use this as their background. */
  base: string;
  /** The ink the background pattern (dots/lines/crosses) is drawn in. */
  patternColor: string;
  /** Optional screen-space texture: a CSS background-image layer list. */
  texture?: string;
}

/** Film-grain noise, white at 5%: chalk dust and tooth for the dark papers. */
const NOISE_LIGHT =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The same grain in dark ink, for the light papers. */
const NOISE_DARK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.055 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const CANVAS_THEMES: CanvasTheme[] = [
  {
    id: "slate",
    name: "Slate",
    blurb: "The board as it has always been",
    base: "#1b1d21",
    patternColor: "#4a4d55",
  },
  {
    id: "void",
    name: "Void",
    blurb: "Near black, for boards that glow",
    base: "#0b0c0f",
    patternColor: "#303339",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    blurb: "Deep drafting blue with a cold sheen",
    base: "#152540",
    patternColor: "#3d5a88",
    texture: [
      "radial-gradient(120% 90% at 28% 18%, rgba(130,175,255,0.07), transparent 55%)",
      "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,10,30,0.35) 100%)",
    ].join(", "),
  },
  {
    id: "chalkboard",
    name: "Chalkboard",
    blurb: "Dusty green slate",
    base: "#243329",
    patternColor: "#54695b",
    texture: [
      NOISE_LIGHT,
      "radial-gradient(90% 70% at 70% 30%, rgba(255,255,255,0.03), transparent 60%)",
    ].join(", "),
  },
  {
    id: "graphite",
    name: "Graphite",
    blurb: "Warm sketchbook grey with tooth",
    base: "#272522",
    patternColor: "#585349",
    texture: NOISE_LIGHT,
  },
  {
    id: "parchment",
    name: "Parchment",
    blurb: "Aged paper, dark ink",
    base: "#e7ddc4",
    patternColor: "#b3a682",
    texture: [
      NOISE_DARK,
      "radial-gradient(80% 60% at 22% 24%, rgba(140,105,50,0.06), transparent 60%)",
      "radial-gradient(70% 80% at 78% 72%, rgba(140,105,50,0.07), transparent 55%)",
      "radial-gradient(140% 120% at 50% 50%, transparent 60%, rgba(110,80,35,0.16) 100%)",
    ].join(", "),
  },
  {
    id: "notepad",
    name: "Notepad",
    blurb: "Ruled paper with a margin line",
    base: "#f3f1e8",
    patternColor: "#d8d4c5",
    texture: [
      // The red margin, then the rules: the pad under the glass, so neither
      // moves with the factory - by design, not by accident.
      "linear-gradient(90deg, transparent 0 96px, rgba(214,92,92,0.4) 96px 98px, transparent 98px)",
      "repeating-linear-gradient(180deg, transparent 0 39px, rgba(96,132,196,0.3) 39px 40px)",
      NOISE_DARK,
    ].join(", "),
  },
  {
    id: "graph",
    name: "Graph paper",
    blurb: "Fine engineering grid",
    base: "#f2f5f6",
    patternColor: "#c3cfd8",
    texture: [
      "repeating-linear-gradient(0deg, rgba(84,130,168,0.2) 0 1px, transparent 1px 100px)",
      "repeating-linear-gradient(90deg, rgba(84,130,168,0.2) 0 1px, transparent 1px 100px)",
      "repeating-linear-gradient(0deg, rgba(84,130,168,0.09) 0 1px, transparent 1px 20px)",
      "repeating-linear-gradient(90deg, rgba(84,130,168,0.09) 0 1px, transparent 1px 20px)",
    ].join(", "),
  },
];

export const DEFAULT_CANVAS_THEME_ID: CanvasThemeId = "slate";

const themesById = new Map(CANVAS_THEMES.map((theme) => [theme.id, theme]));

export function isCanvasThemeId(value: unknown): value is CanvasThemeId {
  return typeof value === "string" && themesById.has(value as CanvasThemeId);
}

/** Always answers: an unknown id (older saved blob, newer plan) gets Slate. */
export function getCanvasTheme(id: string | undefined): CanvasTheme {
  return themesById.get((id ?? DEFAULT_CANVAS_THEME_ID) as CanvasThemeId) ?? CANVAS_THEMES[0];
}
