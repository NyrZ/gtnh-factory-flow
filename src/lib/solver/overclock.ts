import {
  getRecipeMinimumVoltageTier,
  getVoltageTierForEuT,
  getVoltageTierIndex,
  resolveVoltageTier,
} from "@/lib/model/tiers";
import {
  applyMachineHandlerToRecipe,
  getRecipeCoilTierControl,
  getRecipeSpecialValue,
} from "@/lib/model/recipe-rules";
import {
  getBeeMegaApiaryTierEutMultiplier,
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
  isMegaApiaryMachineType,
} from "./machine-effects";

const VOLTAGE_TIER_INDEX_MV = 2;
import { isIndustrialApiaryMachineType } from "@/lib/model/passive-production";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";
import {
  resolveRuntimeTier,
  runtimeOverclockSteps,
  selectRuntimeCalculationVariant,
} from "./runtime-calculation";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type OverclockRecipeInput = Pick<Recipe, "durationTicks" | "eut" | "minimumTier"> &
  Partial<
    Pick<
      Recipe,
      | "machineType"
      | "source"
      | "nei"
      | "machineHandlers"
      | "machineProfile"
      | "machineConfigControls"
      | "runtimeCalculation"
    >
  >;

export interface OverclockedRecipeStats {
  tier: VoltageTier;
  minimumTier: VoltageTier;
  overclockSteps: number;
  durationTicks: number;
  eut: number;
}

export function getOverclockedRecipeStats(
  recipe: OverclockRecipeInput,
  node: Pick<FactoryNode, "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers">,
): OverclockedRecipeStats {
  const effectiveRecipe = recipe.machineType
    ? applyMachineHandlerToRecipe(recipe as Recipe, node)
    : recipe;
  const minimumTier = getRecipeMinimumVoltageTier(effectiveRecipe);
  const requestedTier = resolveVoltageTier(node.overclockTier, minimumTier);
  const tier =
    getVoltageTierIndex(requestedTier) < getVoltageTierIndex(minimumTier)
      ? minimumTier
      : requestedTier;
  const overclockSteps = Math.max(0, getVoltageTierIndex(tier) - getVoltageTierIndex(minimumTier));
  const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
  if (runtimeVariant) {
    const runtimeTier = resolveRuntimeTier(runtimeVariant, tier);
    return {
      tier: runtimeTier,
      minimumTier,
      overclockSteps: runtimeOverclockSteps(runtimeTier, minimumTier),
      durationTicks: runtimeVariant.durationTicks,
      eut: runtimeVariant.eut,
    };
  }
  if (isFixedTimeTierDrivenOutputRecipe(effectiveRecipe)) {
    return {
      tier,
      minimumTier,
      overclockSteps,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut,
    };
  }
  if (effectiveRecipe.machineType && isIndustrialApiaryMachineType(effectiveRecipe.machineType)) {
    const durationMultiplier = getMachineDurationMultiplier(effectiveRecipe as Recipe, node);
    const eutMultiplier = getMachineEutMultiplier(effectiveRecipe as Recipe, node);
    return {
      tier: minimumTier,
      minimumTier,
      overclockSteps: 0,
      durationTicks: Math.max(1, effectiveRecipe.durationTicks * durationMultiplier),
      eut: effectiveRecipe.eut * eutMultiplier,
    };
  }
  if (effectiveRecipe.machineType && isMegaApiaryMachineType(effectiveRecipe.machineType)) {
    const eutMultiplier =
      getMachineEutMultiplier(effectiveRecipe as Recipe, node) *
      getBeeMegaApiaryTierEutMultiplier(tier);
    return {
      tier,
      minimumTier,
      overclockSteps,
      durationTicks: effectiveRecipe.durationTicks,
      eut: effectiveRecipe.eut * eutMultiplier,
    };
  }

  const heatOverclock = getHeatOverclockStats(effectiveRecipe, node, tier, overclockSteps);
  const durationMultiplier = effectiveRecipe.machineType
    ? getMachineDurationMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  const eutMultiplier = effectiveRecipe.machineType
    ? getMachineEutMultiplier(effectiveRecipe as Recipe, node)
    : 1;

  // Parallels are spent before overclocks: they multiply EU/t one-for-one, so
  // only the voltage headroom left over after every parallel is paid for can
  // buy an overclock. A chem plant running six parallels of a 480 EU/t recipe
  // draws 2880 EU/t, which already fills an IV hatch - no overclock, however
  // far above the recipe's HV minimum the machine is powered.
  const parallels = effectiveRecipe.machineType
    ? getMachineParallelMultiplier(effectiveRecipe as Recipe, node)
    : 1;
  const parallelEuT =
    Math.abs(effectiveRecipe.eut) *
    eutMultiplier *
    heatOverclock.heatDiscountMultiplier *
    parallels;
  const affordableSteps = Math.max(
    0,
    getVoltageTierIndex(tier) - getVoltageTierIndex(getVoltageTierForEuT(parallelEuT)),
  );
  const steps = Math.min(overclockSteps, affordableSteps);
  const heatSteps = Math.min(steps, heatOverclock.heatOverclockSteps);
  const regularSteps = steps - heatSteps;
  // Machines that state perfect overclocks in their tooltip quarter the
  // duration on every step instead of halving it.
  const perfectSteps = effectiveRecipe.machineProfile?.perfectOverclock ? regularSteps : 0;

  return {
    tier,
    minimumTier,
    overclockSteps: steps,
    durationTicks: Math.max(
      1,
      (effectiveRecipe.durationTicks /
        4 ** (heatSteps + perfectSteps) /
        2 ** (regularSteps - perfectSteps)) *
        durationMultiplier,
    ),
    eut: effectiveRecipe.eut * heatOverclock.heatDiscountMultiplier * eutMultiplier * 4 ** steps,
  };
}

function getHeatOverclockStats(
  recipe: OverclockRecipeInput,
  node: Pick<FactoryNode, "coilTier">,
  tier: VoltageTier,
  overclockSteps: number,
) {
  const specialValue = getRecipeSpecialValue(recipe);
  const coilControl = recipe.machineType
    ? getRecipeCoilTierControl(
        {
          machineType: recipe.machineType,
          source: recipe.source,
          nei: recipe.nei,
          machineConfigControls: recipe.machineConfigControls,
        },
        node,
      )
    : undefined;
  if (
    specialValue === undefined ||
    specialValue <= 0 ||
    !coilControl?.current.heat ||
    !isHeatOverclockMachine(recipe.machineType)
  ) {
    return {
      heatOverclockSteps: 0,
      regularOverclockSteps: overclockSteps,
      heatDiscountMultiplier: 1,
    };
  }

  // Coil heat plus 100 K per voltage tier above MV.
  const machineHeat =
    coilControl.current.heat + 100 * Math.max(0, getVoltageTierIndex(tier) - VOLTAGE_TIER_INDEX_MV);
  const heatExcess = Math.max(0, machineHeat - specialValue);
  const heatOverclockSteps = Math.min(overclockSteps, Math.floor(heatExcess / 1800));

  return {
    heatOverclockSteps,
    regularOverclockSteps: overclockSteps - heatOverclockSteps,
    heatDiscountMultiplier: 0.95 ** Math.floor(heatExcess / 900),
  };
}

/**
 * The only machines that overclock on heat.
 *
 * These three compare their coil heat against the recipe's required heat and
 * turn the excess into 4x-per-tier overclocks. Every other coil in GTNH buys
 * something else - speed on the chem plant and pyrolyse oven, an EU discount on
 * the oil cracker and coke oven - or nothing at all, as on the large chemical
 * reactor, whose lone cupronickel block is pure structure.
 *
 * The list has to be explicit because the dataset cannot tell these apart on
 * its own: every coil block carries a heat capacity whether or not the machine
 * reads it, and every recipe carries a "Special value" line whose meaning
 * depends on the recipe map. On the chem plant that number is the machine
 * casing tier, so treating it as a heat requirement handed out free overclocks.
 */
const HEAT_OVERCLOCK_MACHINES = new Set([
  "blast furnace",
  "electric blast furnace",
  "volcanus",
  "exothermic hearth",
]);

function isHeatOverclockMachine(machineType: string | undefined): boolean {
  // Match the machine, never the recipe map: an Industrial Arc Furnace running
  // a blast furnace recipe overclocks on its electrodes, not on heat.
  return machineType ? HEAT_OVERCLOCK_MACHINES.has(normalizeRecipeMapName(machineType)) : false;
}

function isFixedTimeTierDrivenOutputRecipe(
  recipe: Pick<Recipe, "source"> & { machineType?: string },
) {
  if (!recipe.machineType) {
    return false;
  }
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeRecipeMapName(recipeMap) === "tree growth simulator";
}

function normalizeRecipeMapName(recipeMap: string): string {
  return recipeMap
    .trim()
    .toLowerCase()
    .replace(/\brecipes?\b/g, "")
    .replace(/\brecipe\s+map\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
