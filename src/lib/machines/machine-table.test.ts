import { describe, expect, it } from "vitest";
import { getMachineBehaviour, resolveCoefficient } from "./machine-table";
import {
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import type { MachineConfigControl, Recipe } from "@/lib/model/types";

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
    expect(getMachineBehaviour("Chemical Plant")?.overclock).toBe("normal");
    expect(getMachineBehaviour("ExxonMobil Chemical Plant")?.overclock).toBe("normal");
    expect(getMachineBehaviour("Blast Furnace")?.overclock).toBe("heat");
    expect(getMachineBehaviour("Electric Blast Furnace")?.overclock).toBe("heat");
    expect(getMachineBehaviour("Large Chemical Reactor")?.overclock).toBe("perfect");
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
    expect(resolveCoefficient(zhuhai?.parallels, { tier: () => 0, voltageTier: 1 }, 1)).toBe(4);
    expect(resolveCoefficient(zhuhai?.parallels, { tier: () => 0, voltageTier: 8 }, 1)).toBe(18);

    // Density^2 is floor((theirTier + 1) / 2) + 1 = floor(ourTier / 2) + 1.
    const density = getMachineBehaviour("Density^2");
    for (const [ordinal, expected] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
    ]) {
      expect(
        resolveCoefficient(density?.parallels, { tier: () => 0, voltageTier: ordinal }, 1),
      ).toBe(expected);
    }
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
