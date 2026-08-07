import { describe, expect, it } from "vitest";
import {
  getMachineBehaviour,
  HEAT_OVERCLOCK,
  machineTableNames,
  normalizeMachineName,
  OVERCLOCK,
  resolveCoefficient,
  resolveOverclockSpec,
} from "./machine-table";
import referenceCoefficients from "./__fixtures__/reference-coefficients.json";
import {
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import type { MachineConfigControl, Recipe } from "@/lib/model/types";

interface ReferenceSample {
  voltageTier: number;
  choiceValue: number;
  speed: number | string;
  power: number | string;
  parallels: number | string;
  overclocker:
    | { kind: string; maxPerfect?: number | "inf"; maxNormal?: number | "inf"; multiplier?: number }
    | string
    | null;
}

interface ReferenceEntry {
  choiceKeys: string[];
  samples: ReferenceSample[];
}

function close(a: number, b: number, epsilon = 1e-9) {
  return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

function resource() {
  return { kind: "item" as const, id: "x", amount: 1, consumed: false };
}

function coilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    tiers: [
      // Deliberately carrying the wrong scraped effects, to prove the table wins.
      {
        key: "cupronickel",
        label: "Cupronickel",
        heat: 1801,
        durationMultiplier: 99,
        resource: resource(),
      },
      {
        key: "kanthal",
        label: "Kanthal",
        heat: 2701,
        durationMultiplier: 99,
        resource: resource(),
      },
      {
        key: "nichrome",
        label: "Nichrome",
        heat: 3601,
        durationMultiplier: 99,
        resource: resource(),
      },
      { key: "tpv", label: "TPV-Alloy", heat: 4501, durationMultiplier: 99, resource: resource() },
    ],
  };
}

function pipeControl(): MachineConfigControl {
  return {
    id: "pipeCasing",
    label: "Pipe Casing",
    minimumKey: "bronze",
    tiers: [
      { key: "bronze", label: "Bronze", parallelMultiplier: 99, resource: resource() },
      { key: "steel", label: "Steel", parallelMultiplier: 99, resource: resource() },
      { key: "titanium", label: "Titanium", parallelMultiplier: 99, resource: resource() },
    ],
  };
}

const chemPlant = {
  machineType: "Chemical Plant",
  minimumTier: "HV",
  eut: 480,
  machineConfigControls: [coilControl(), pipeControl()],
} as unknown as Recipe;

describe("curated machine table", () => {
  it("is keyed by our names and by the reference's names", () => {
    expect(getMachineBehaviour("Chemical Plant")?.overclock).toEqual(OVERCLOCK.normal());
    expect(getMachineBehaviour("ExxonMobil Chemical Plant")?.overclock).toEqual(OVERCLOCK.normal());
    expect(getMachineBehaviour("Blast Furnace")?.overclock).toBe(HEAT_OVERCLOCK);
    expect(getMachineBehaviour("Electric Blast Furnace")?.overclock).toBe(HEAT_OVERCLOCK);
    expect(getMachineBehaviour("Large Chemical Reactor")?.overclock).toEqual(OVERCLOCK.perfect());
  });

  it("overrides the effects the dataset scraped off tooltips", () => {
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // The controls above claim a 99x duration and 99 parallels. The table's
    // numbers are the ones that count: TPV coils are 200% speed, titanium pipe
    // casings are six parallels.
    expect(getMachineDurationMultiplier(chemPlant, node)).toBeCloseTo(0.5, 10);
    expect(getMachineParallelMultiplier(chemPlant, node)).toBe(6);
    expect(getMachineEutMultiplier(chemPlant, node)).toBe(1);
  });

  it("reads coil and pipe casing tiers as zero-based indices", () => {
    const bronzeCupronickel = {
      overclockTier: "IV",
      coilTier: "cupronickel",
      machineConfigTiers: { pipeCasing: "bronze" },
    };

    // Cupronickel is 50% speed, so the recipe takes twice as long.
    expect(getMachineDurationMultiplier(chemPlant, bronzeCupronickel)).toBeCloseTo(2, 10);
    expect(getMachineParallelMultiplier(chemPlant, bronzeCupronickel)).toBe(2);
  });

  it("scales voltage-driven parallels off our ULV-based tier ordinal", () => {
    // The reference counts LV as 0, we count it as 1. Zhuhai is
    // ((theirTier + 1) + 1) * 2, which is (ourTier + 1) * 2.
    const zhuhai = getMachineBehaviour("Zhuhai - Fishing Port");
    expect(
      resolveCoefficient(zhuhai?.parallels, { tier: () => 0, value: () => 0, voltageTier: 1 }, 1),
    ).toBe(4);
    expect(
      resolveCoefficient(zhuhai?.parallels, { tier: () => 0, value: () => 0, voltageTier: 8 }, 1),
    ).toBe(18);

    // Density^2 is floor((theirTier + 1) / 2) + 1 = floor(ourTier / 2) + 1.
    const density = getMachineBehaviour("Density^2");
    for (const [ordinal, expected] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
    ]) {
      expect(
        resolveCoefficient(
          density?.parallels,
          { tier: () => 0, value: () => 0, voltageTier: ordinal },
          1,
        ),
      ).toBe(expected);
    }
  });

  it("reproduces the reference's own numbers for every machine it claims", () => {
    // `reference-coefficients.json` is ShadowTheAge's machines.ts evaluated over
    // a grid of voltage tiers and choice indices. Regenerate it by dropping a
    // probe into that repo's src/ that walks `machines`, calls GetParameter for
    // speed/power/parallels and describes the overclocker, then running jest.
    //
    // Their voltageTier counts LV as 0; ours counts ULV as 0, so a sample's
    // voltageTier maps to ours by adding one.
    const reference = referenceCoefficients as Record<string, ReferenceEntry>;
    const problems: string[] = [];
    let checked = 0;

    for (const [name, entry] of Object.entries(reference)) {
      const behaviour = getMachineBehaviour(name);
      if (!behaviour) {
        continue;
      }

      for (const sample of entry.samples) {
        if (
          typeof sample.speed !== "number" ||
          typeof sample.power !== "number" ||
          typeof sample.parallels !== "number"
        ) {
          continue;
        }

        const ctx = {
          tier: () => sample.choiceValue,
          value: () => sample.choiceValue,
          voltageTier: sample.voltageTier + 1,
        };
        const at = `${name} @tier${sample.voltageTier} choice${sample.choiceValue}`;

        const speed = resolveCoefficient(behaviour.speed, ctx, 1);
        const power = resolveCoefficient(behaviour.power, ctx, 1);
        const parallels = resolveCoefficient(behaviour.parallels, ctx, 1);
        const spec = resolveOverclockSpec(behaviour, ctx);

        if (!close(speed, sample.speed)) problems.push(`${at}: speed ${speed} vs ${sample.speed}`);
        if (!close(parallels, sample.parallels)) {
          problems.push(`${at}: parallels ${parallels} vs ${sample.parallels}`);
        }
        // The heat machines are the one place the two models put a number in
        // different homes: the reference folds the coil heat EU discount into
        // `power`, while we apply it in the heat path in overclock.ts, where
        // the recipe's heat requirement is known. Their `power` is therefore
        // expected to differ, and is checked by the overclock tests instead.
        if (spec !== HEAT_OVERCLOCK && !close(power, sample.power)) {
          problems.push(`${at}: power ${power} vs ${sample.power}`);
        }
        const expected = sample.overclocker;
        if (spec !== HEAT_OVERCLOCK && expected && typeof expected === "object") {
          if (expected.kind === "null") {
            // Their NullOverclocker and our zero-step rule say the same thing.
            if (spec && (spec.maxPerfect !== 0 || spec.maxNormal !== 0)) {
              problems.push(`${at}: expected no overclocks, got ${JSON.stringify(spec)}`);
            }
          } else {
            const maxPerfect = expected.maxPerfect === "inf" ? Infinity : expected.maxPerfect;
            const maxNormal = expected.maxNormal === "inf" ? Infinity : expected.maxNormal;
            if (
              spec?.maxPerfect !== maxPerfect ||
              spec?.maxNormal !== maxNormal ||
              spec?.multiplier !== expected.multiplier
            ) {
              problems.push(
                `${at}: overclock ${JSON.stringify(spec)} vs ${JSON.stringify(expected)}`,
              );
            }
          }
        }
        checked++;
      }
    }

    expect(problems.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });

  it("only claims machines the reference actually defines", () => {
    const referenceNames = new Set(
      Object.keys(referenceCoefficients as Record<string, unknown>).map(normalizeMachineName),
    );
    // Every entry must trace back to a reference definition, under its own name
    // or one of its aliases, so nothing in the table is invented.
    const untraceable = machineTableNames().filter((name) => {
      const behaviour = getMachineBehaviour(name);
      const candidates = [name, ...(behaviour?.aliases ?? [])].map(normalizeMachineName);
      return !candidates.some((candidate) => referenceNames.has(candidate));
    });

    expect(untraceable).toEqual([]);
  });

  it("leaves machines it does not cover on the dataset's own values", () => {
    expect(getMachineBehaviour("Some Machine We Have Not Verified")).toBeUndefined();

    const unlisted = { ...chemPlant, machineType: "Some Machine We Have Not Verified" } as Recipe;
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // Falls back to the scraped 99s rather than silently reading as 1.
    expect(getMachineDurationMultiplier(unlisted, node)).toBe(99);
    expect(getMachineParallelMultiplier(unlisted, node)).toBe(17);
  });
});
