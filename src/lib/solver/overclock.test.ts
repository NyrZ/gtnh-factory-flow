import { describe, expect, it } from "vitest";
import { getOverclockedRecipeStats } from "./overclock";
import { getMachineParallelMultiplier } from "./machine-effects";
import type { MachineConfigControl } from "@/lib/model/types";

const TICKS_PER_SECOND = 20;

/** Coil blocks that only carry a heat capacity: the blast furnace family. */
function heatCoilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    tiers: [
      { key: "cupronickel", label: "Cupronickel", heat: 1801, resource: coilResource() },
      { key: "naquadah", label: "Naquadah", heat: 7201, resource: coilResource() },
    ],
  };
}

/** Coil blocks that buy speed and carry a heat capacity only incidentally. */
function speedCoilControl(): MachineConfigControl {
  return {
    id: "heatingCoil",
    label: "Heating Coil",
    minimumKey: "cupronickel",
    defaultKey: "kanthal",
    tiers: [
      {
        key: "cupronickel",
        label: "Cupronickel",
        heat: 1801,
        durationMultiplier: 2,
        resource: coilResource(),
      },
      {
        key: "kanthal",
        label: "Kanthal",
        heat: 2701,
        durationMultiplier: 1,
        resource: coilResource(),
      },
      {
        key: "nichrome",
        label: "Nichrome",
        heat: 3601,
        durationMultiplier: 2 / 3,
        resource: coilResource(),
      },
      { key: "tpv", label: "TPV-Alloy", heat: 4501, durationMultiplier: 0.5, resource: coilResource() },
    ],
  };
}

function pipeCasingControl(): MachineConfigControl {
  return {
    id: "pipeCasing",
    label: "Pipe Casing",
    minimumKey: "bronze",
    tiers: [
      { key: "bronze", label: "Bronze", parallelMultiplier: 2, resource: coilResource() },
      { key: "steel", label: "Steel", parallelMultiplier: 4, resource: coilResource() },
      { key: "titanium", label: "Titanium", parallelMultiplier: 6, resource: coilResource() },
    ],
  };
}

function coilResource() {
  return { kind: "item" as const, id: "gregtech:gt.blockcasings5", amount: 1, consumed: false };
}

/**
 * Nitrobenzene in the ExxonMobil Chemical Plant, exactly as the dataset carries
 * it: 5000 L out of 5000 L benzene every 600 ticks at 480 EU/t, gated to HV by
 * titanium machine casings. "Special value: 4" is that casing tier, not heat.
 */
const NITROBENZENE = {
  machineType: "Chemical Plant",
  minimumTier: "HV",
  durationTicks: 600,
  eut: 480,
  nei: { additionalInfo: ["Special value: 4"] },
  machineConfigControls: [pipeCasingControl(), speedCoilControl()],
};

describe("GT overclocking", () => {
  it("treats MAX as a filter/display tier instead of an extra overclock voltage", () => {
    const stats = getOverclockedRecipeStats(
      {
        minimumTier: "MV",
        durationTicks: 80,
        eut: 120,
        machineType: "Alloy Blast Smelter",
      },
      {
        overclockTier: "MAX",
      },
    );

    expect(stats.tier).toBe("OpV");
    expect(stats.overclockSteps).toBe(11);
    expect(stats.eut).toBe(120 * 4 ** 11);
  });

  it("spends the voltage budget on parallels before overclocks", () => {
    const node = {
      overclockTier: "IV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };
    const stats = getOverclockedRecipeStats(NITROBENZENE, node);
    const parallels = getMachineParallelMultiplier(NITROBENZENE, node);

    // Six parallels of a 480 EU/t recipe already draw 2880 EU/t, which fills an
    // IV hatch. No headroom is left, so the recipe never overclocks.
    expect(parallels).toBe(6);
    expect(stats.overclockSteps).toBe(0);
    expect(stats.eut).toBe(480);
    // TPV-Alloy coils run the chem plant at 200% speed: 600 ticks becomes 300.
    expect(stats.durationTicks).toBe(300);

    const nitrobenzenePerSecond =
      (5000 * parallels * TICKS_PER_SECOND) / stats.durationTicks;
    expect(nitrobenzenePerSecond).toBe(2000);
  });

  it("buys an overclock once the hatch can carry the parallels and the step", () => {
    const stats = getOverclockedRecipeStats(NITROBENZENE, {
      overclockTier: "LuV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    });

    // 2880 EU/t of parallels leaves room for one 4x step inside LuV's 32768.
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(150);
    expect(stats.eut).toBe(480 * 4);
  });

  it("limits parallels to what the energy hatch can actually pay for", () => {
    const node = {
      overclockTier: "HV",
      coilTier: "tpv",
      machineConfigTiers: { pipeCasing: "titanium" },
    };

    // An HV hatch carries 512 EU/t, so it can only power one 480 EU/t parallel
    // of the six the titanium pipe casings offer.
    expect(getMachineParallelMultiplier(NITROBENZENE, node)).toBe(1);
    expect(getOverclockedRecipeStats(NITROBENZENE, node).overclockSteps).toBe(0);
  });

  it("does not grant heat overclocks to coils that buy speed instead of heat", () => {
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Pyrolyse Oven",
        minimumTier: "MV",
        durationTicks: 1280,
        eut: 96,
        nei: { additionalInfo: ["Special value: 0"] },
        machineConfigControls: [speedCoilControl()],
      },
      { overclockTier: "EV", coilTier: "nichrome" },
    );

    // Two imperfect overclocks halve the duration twice; nichrome coils then
    // run the oven at 150% speed. A heat overclock would have quartered a step.
    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBeCloseTo((1280 / 4) * (2 / 3), 6);
    expect(stats.eut).toBe(96 * 16);
  });

  it("does not grant heat overclocks to another machine running a blast furnace recipe", () => {
    // The Industrial Arc Furnace takes blast furnace recipes, heat requirement
    // and all, but overclocks on its electrodes. Only the machine decides.
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Industrial Arc Furnace",
        source: { recipeMap: "Blast Furnace" },
        minimumTier: "MV",
        durationTicks: 1000,
        eut: 120,
        nei: { additionalInfo: ["Special value: 1500"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "EV", coilTier: "naquadah" },
    );

    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBe(1000 / 4);
    expect(stats.eut).toBe(120 * 16);
  });

  it("still grants heat overclocks to the blast furnace family", () => {
    const stats = getOverclockedRecipeStats(
      {
        machineType: "Blast Furnace",
        minimumTier: "MV",
        durationTicks: 1000,
        eut: 120,
        nei: { additionalInfo: ["Special value: 1500"] },
        machineConfigControls: [heatCoilControl()],
      },
      { overclockTier: "EV", coilTier: "naquadah" },
    );

    // Naquadah coils sit 5901 K over the recipe's 1500 K, which is worth two
    // 4x steps and a 0.95^6 EU discount.
    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBe(1000 / 16);
    expect(stats.eut).toBeCloseTo(120 * 0.95 ** 6 * 16, 6);
  });
});
