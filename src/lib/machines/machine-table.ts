/**
 * Curated machine behaviour: what each multiblock does to a recipe.
 *
 * A recipe export tells us the ingredients, the duration and the EU/t. It does
 * not tell us that titanium pipe casings give a chem plant six parallels, that
 * TPV coils run it at 200%, or that a large chemical reactor overclocks
 * perfectly. That behaviour lives in each multiblock's Java code, so it has to
 * be written down somewhere.
 *
 * We used to scrape it out of multiblock tooltips in the dataset pipeline.
 * Tooltips are prose, and the scraper produced values that were shaped right
 * and meant the wrong thing - most visibly a heat capacity stamped onto coils
 * for machines with no heat mechanic, which handed the chem plant, pyrolyse
 * oven, oil cracker and coke oven overclocks they never get in game.
 *
 * These numbers are transcribed from ShadowTheAge's GTNH calculator
 * (https://github.com/ShadowTheAge/gtnh, MIT), whose `src/machines.ts` was
 * checked against the mod source machine by machine. Two indexing differences
 * are worth knowing when comparing the two files:
 *
 *   - Their voltage tiers start at LV = 0; ours start at ULV = 0. Their
 *     `recipe.voltageTier + 1` is therefore our `ctx.voltageTier`.
 *   - Their `speed` is a throughput multiplier (2 = twice as fast). We divide
 *     duration by it, so a machine's duration multiplier is `1 / speed`.
 *
 * Machines absent from this table keep using the values the dataset carries,
 * so partial coverage is safe. Add entries as they are verified; do not guess.
 */

/** How a machine turns spare voltage into speed. */
export type OverclockStyle =
  /** 2x speed for 4x EU/t. The GTNH default. */
  | "normal"
  /** 4x speed for 4x EU/t, so total energy is unchanged. */
  | "perfect"
  /** Extra voltage buys nothing. */
  | "none"
  /**
   * Blast furnace family: coil heat above the recipe's requirement buys
   * perfect overclocks, then normal ones. Handled by the heat path in
   * `overclock.ts` because it needs the recipe's heat requirement.
   */
  | "heat";

export interface MachineContext {
  /**
   * Zero-based index of the selected tier for one of our machine config
   * controls, e.g. `tier("heatingCoil")` is 0 for cupronickel and 3 for TPV.
   * Returns 0 when the recipe carries no such control.
   */
  tier: (controlId: string) => number;
  /**
   * Voltage tier ordinal of the tier the machine runs at, counting ULV as 0
   * and LV as 1. Equals the reference's `voltageTier + 1`.
   */
  voltageTier: number;
}

type Coefficient = number | ((ctx: MachineContext) => number);

export interface MachineBehaviour {
  /** Throughput multiplier: 2 means the recipe finishes in half the time. */
  speed?: Coefficient;
  /** EU/t multiplier applied before parallels. */
  power?: Coefficient;
  /** Parallels the structure offers, before the voltage has to pay for them. */
  parallels?: Coefficient;
  overclock: OverclockStyle;
  /** Names this machine also goes by, including the reference's own name. */
  aliases?: string[];
  /** A known gap, carried over from the reference. */
  note?: string;
}

export function resolveCoefficient(
  coefficient: Coefficient | undefined,
  ctx: MachineContext,
  fallback: number,
): number {
  if (coefficient === undefined) {
    return fallback;
  }
  return typeof coefficient === "function" ? coefficient(ctx) : coefficient;
}

const COIL = "heatingCoil";
const PIPE = "pipeCasing";
const SOLENOID = "solenoidCoil";

/**
 * Keyed by the machine name our dataset uses. `aliases` cover the reference's
 * name where it differs, plus any handler name the dataset also emits.
 */
const MACHINES: Record<string, MachineBehaviour> = {
  // -- Heat: the only three machines that overclock on coil heat ------------
  "Blast Furnace": { overclock: "heat", aliases: ["Electric Blast Furnace"] },
  Volcanus: {
    overclock: "heat",
    speed: 2.2,
    power: 0.9,
    parallels: 8,
    note: "Blazing pyrotheum is not counted.",
  },
  "Exothermic Hearth": { overclock: "heat", parallels: 256 },

  // -- Perfect overclockers -------------------------------------------------
  "Large Chemical Reactor": { overclock: "perfect" },
  "Mega Chemical Reactor": { overclock: "perfect", parallels: 256 },
  "Circuit Assembly Line": { overclock: "perfect" },
  Digester: { overclock: "perfect" },
  "Elemental Duplicator": { overclock: "perfect", speed: 2, parallels: (c) => 8 * c.voltageTier },
  "IsaMill Grinding Machine": { overclock: "perfect" },
  "Flotation Cell Regulator": { overclock: "perfect" },

  // -- Coil-driven, no heat mechanic ---------------------------------------
  "Chemical Plant": {
    overclock: "normal",
    aliases: ["ExxonMobil Chemical Plant"],
    speed: (c) => c.tier(COIL) * 0.5 + 0.5,
    parallels: (c) => (c.tier(PIPE) + 1) * 2,
  },
  "Pyrolyse Oven": { overclock: "normal", speed: (c) => (c.tier(COIL) + 1) * 0.5 },
  "Oil Cracker": {
    overclock: "normal",
    aliases: ["Oil Cracking Unit"],
    power: (c) => 1 - Math.min(0.5, (c.tier(COIL) + 1) * 0.1),
  },
  "Mega Oil Cracker": {
    overclock: "normal",
    parallels: 256,
    power: (c) => 1 - Math.min(0.5, (c.tier(COIL) + 1) * 0.1),
  },
  Zyngen: {
    overclock: "normal",
    speed: (c) => 1 + c.tier(COIL) * 0.05,
    parallels: (c) => c.voltageTier * c.tier(COIL),
  },
  "Multi Smelter": {
    overclock: "normal",
    parallels: (c) => 8 * Math.pow(2, c.tier(COIL)),
    note: "Parallel count needs testing.",
  },
  "Mega Alloy Blast Smelter": {
    overclock: "normal",
    parallels: 256,
    speed: (c) => Math.max(1, 1 - 0.05 * (c.tier(COIL) - 3)),
    power: (c) => Math.pow(0.95, c.tier(COIL) - (c.voltageTier - 1)),
    note: "Assumes a matching glass tier.",
  },
  "Large Fluid Extractor": {
    overclock: "normal",
    speed: (c) => 1.5 + c.tier(COIL) * 0.1,
    power: (c) => 0.8 * Math.pow(0.9, c.tier(COIL)),
    parallels: (c) => (c.tier(SOLENOID) + 2) * 8,
  },
  "Large Thermal Refinery": {
    overclock: "normal",
    speed: (c) => 2.5 * (1 + (c.tier(COIL) + 1) * 0.05),
    power: (c) => 0.8 * Math.pow(0.95, c.tier(COIL) + 1),
    parallels: (c) => c.voltageTier * 8 + (c.tier(SOLENOID) + 1) * 2,
  },

  // -- Flat multiblocks -----------------------------------------------------
  "Alloy Blast Smelter": { overclock: "normal" },
  "Big Barrel Brewery": { overclock: "normal", speed: 1.5, parallels: (c) => c.voltageTier * 4 },
  Boldarnator: {
    overclock: "normal",
    speed: 3,
    power: 0.75,
    parallels: (c) => c.voltageTier * 8,
  },
  "Bricked Blast Furnace": { overclock: "normal" },
  "COMET - Compact Cyclotron": { overclock: "normal" },
  "Cryogenic Freezer": { overclock: "normal", speed: 2.2, power: 0.9, parallels: 8 },
  "Density^2": {
    overclock: "normal",
    speed: 2,
    parallels: (c) => Math.floor(c.voltageTier / 2) + 1,
  },
  "Dissolution Tank": { overclock: "normal" },
  "Distillation Tower": { overclock: "normal" },
  Furnace: { overclock: "normal" },
  "Implosion Compressor": { overclock: "normal" },
  "Industrial Centrifuge": {
    overclock: "normal",
    speed: 3,
    power: 0.9,
    parallels: (c) => c.voltageTier * 8,
    note: "Assumes max speed.",
  },
  "Industrial Extrusion Machine": {
    overclock: "normal",
    speed: 3.5,
    parallels: (c) => c.voltageTier * 6,
  },
  "Large Scale Auto-Assembler v1.01": {
    overclock: "normal",
    speed: 3,
    parallels: (c) => c.voltageTier * 2,
  },
  "Mega Distillation Tower": { overclock: "normal", parallels: 256 },
  "Molecular Transformer": { overclock: "normal" },
  "Nuclear Salt Processing Plant": {
    overclock: "normal",
    speed: 2.5,
    parallels: (c) => c.voltageTier * 2,
  },
  "Ore Washing Plant": { overclock: "normal", speed: 5, parallels: (c) => c.voltageTier * 4 },
  "Source Chamber": { overclock: "normal" },
  "Target Chamber": { overclock: "normal" },
  "Thermic Heating Device": {
    overclock: "normal",
    speed: 2.2,
    power: 0.9,
    parallels: (c) => c.voltageTier * 8,
  },
  "TurboCan Pro": { overclock: "normal", speed: 2, parallels: (c) => c.voltageTier * 8 },
  "Vacuum Freezer": { overclock: "normal" },
  "Zhuhai - Fishing Port": { overclock: "normal", parallels: (c) => (c.voltageTier + 1) * 2 },
};

const BY_NAME = new Map<string, MachineBehaviour>();
for (const [name, behaviour] of Object.entries(MACHINES)) {
  BY_NAME.set(normalizeMachineName(name), behaviour);
  for (const alias of behaviour.aliases ?? []) {
    BY_NAME.set(normalizeMachineName(alias), behaviour);
  }
}

export function getMachineBehaviour(machineType: string | undefined): MachineBehaviour | undefined {
  return machineType ? BY_NAME.get(normalizeMachineName(machineType)) : undefined;
}

export function normalizeMachineName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9^]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
