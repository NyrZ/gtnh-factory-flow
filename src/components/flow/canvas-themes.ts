/**
 * Board background themes: the paper the factory is drawn on.
 *
 * A theme is three things: the flat base colour (also what image exports use
 * for their background), the ink the background pattern is drawn in, and an
 * optional texture layered over the base. The texture is GRAIN - noise, tooth,
 * mottling, a vignette - and deliberately carries no lines or rulings: paper
 * structure that reads as marks (ruled lines, graph grids) belongs to the
 * PATTERN selector, which draws in board space and pans with the factory.
 * Grain has no landmarks, so it can stay a static screen-space CSS layer that
 * costs nothing per frame.
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
  | "paper";

export interface CanvasTheme {
  id: CanvasThemeId;
  name: string;
  /** The flat paper colour. Exports use this as their background. */
  base: string;
  /** The ink the background pattern (dots, lines, rulings) is drawn in. */
  patternColor: string;
  /** Optional screen-space grain: a CSS background-image layer list. */
  texture?: string;
}

/** Film-grain noise in white: chalk dust and tooth for the dark papers. */
const NOISE_LIGHT =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.13 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The same grain in dark ink, for the light papers. */
const NOISE_DARK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.11 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Broad, soft blotching: the uneven soak of old paper. */
const MOTTLE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='420'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.3 0 0 0 0 0.12 0 0 0 0.16 0'/%3E%3C/filter%3E%3Crect width='420' height='420' filter='url(%23m)'/%3E%3C/svg%3E\")";

export const CANVAS_THEMES: CanvasTheme[] = [
  {
    id: "slate",
    name: "Slate",
    base: "#1b1d21",
    patternColor: "#4a4d55",
  },
  {
    id: "void",
    name: "Void",
    base: "#0b0c0f",
    patternColor: "#303339",
    texture:
      "radial-gradient(140% 120% at 50% 42%, rgba(90,110,160,0.08), transparent 55%)",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    base: "#152540",
    patternColor: "#48699c",
    texture: [
      NOISE_LIGHT,
      "radial-gradient(120% 90% at 28% 18%, rgba(130,175,255,0.1), transparent 55%)",
      "radial-gradient(140% 120% at 50% 50%, transparent 52%, rgba(0,8,26,0.45) 100%)",
    ].join(", "),
  },
  {
    id: "chalkboard",
    name: "Chalkboard",
    base: "#243329",
    patternColor: "#5d7465",
    texture: [
      NOISE_LIGHT,
      // The ghosts of old erasing: two wide soft wipes of chalk haze.
      "linear-gradient(105deg, transparent 12%, rgba(255,255,255,0.05) 30%, transparent 46%, rgba(255,255,255,0.04) 68%, transparent 84%)",
      "radial-gradient(90% 70% at 70% 30%, rgba(255,255,255,0.05), transparent 60%)",
    ].join(", "),
  },
  {
    id: "graphite",
    name: "Graphite",
    base: "#272522",
    patternColor: "#5f5a4f",
    texture: [
      NOISE_LIGHT,
      "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.3) 100%)",
    ].join(", "),
  },
  {
    id: "parchment",
    name: "Parchment",
    base: "#e7ddc4",
    patternColor: "#a4966e",
    texture: [
      NOISE_DARK,
      MOTTLE,
      "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(110,80,35,0.24) 100%)",
    ].join(", "),
  },
  {
    id: "paper",
    name: "Paper",
    base: "#f3f1e8",
    patternColor: "#b4bac8",
    texture: NOISE_DARK,
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
