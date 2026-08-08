import type { FactoryNode, FactoryProject, Recipe, ResourceAmount, ResourceKind } from "./types";
import { getFilledCellFluidEquivalent, resourceMatchesInput } from "./resources";

/** A GT cell holds 1000 L, unless the dataset says otherwise for this pair. */
const DEFAULT_CELL_FLUID_AMOUNT = 1000;

/**
 * The recipe's input amount, restated in the units of the resource actually
 * being wired in.
 *
 * A filled cell and its fluid are the same substance counted two ways: one
 * cell is 1000 L. So wiring a fluid into a cell input (or the reverse) has to
 * CONVERT the amount — and wiring like into like must not touch it.
 *
 * That second half is what was broken. The amount was taken from the cell's
 * fluid equivalent whenever one existed, regardless of what was actually being
 * connected, so plugging cells into a cell input multiplied the requirement by
 * 1000: a reactor wanting 2 cells/s asked for 2,000 cells/s and every producer
 * upstream of it looked hopelessly undersized.
 *
 * The per-unit ratio is read off the matched alternative when the dataset has
 * one (`alternatives` carry target-units-per-source-unit, so 1000 on a cell's
 * fluid and 1/1000 on a fluid's cell), and falls back to the 1000 L cell.
 */
export function crossKindInputOverrideAmount(
  input: Pick<ResourceAmount, "kind" | "id" | "displayName" | "amount" | "alternatives">,
  targetKind: ResourceKind,
  alternative?: { amount?: number; kind?: ResourceKind },
): number {
  const perUnit = alternative?.amount;
  const hasRatio = perUnit !== undefined && Number.isFinite(perUnit) && perUnit > 0;

  if (input.kind === targetKind) {
    // Substitutes within one kind are not always one for one: a slot wanting
    // 72 L of soldering alloy wants 144 L of tin, and the ratio says so. Ore
    // dictionary members carry 1 and so leave the amount exactly as it was.
    //
    // The alternative's own kind has to be checked. A cell input also lists its
    // FLUID equivalent at 1000, and that entry says nothing about how many
    // CELLS to use -- reading it here is what once turned 2 cells into 2,000.
    return hasRatio && alternative?.kind === targetKind ? input.amount * perUnit : input.amount;
  }

  if (hasRatio) {
    return input.amount * perUnit;
  }

  if (input.kind === "item" && targetKind === "fluid") {
    return getFilledCellFluidEquivalent(input)?.amount ?? input.amount;
  }

  if (input.kind === "fluid" && targetKind === "item") {
    return input.amount / DEFAULT_CELL_FLUID_AMOUNT;
  }

  return input.amount;
}

/**
 * Repairs input overrides that were stored with a filled cell's FLUID amount.
 *
 * The override was written on every connect, and until this was fixed it took
 * the cell's fluid amount whenever one existed — so wiring cells into a cell
 * input stored 1000× the real requirement, and it was saved that way. Fixing
 * the write is not enough: existing plans carry the inflated number and would
 * keep reading wrong until every affected wire was deleted and remade.
 *
 * Deliberately narrow. It only rewrites an override whose stored amount is
 * EXACTLY what the old expression produced and whose correct amount differs.
 * A legitimate cell-to-fluid override (2 cells -> 2000 L) is untouched because
 * there the old and new answers agree, and anything a person chose themselves
 * never matches the buggy formula in the first place.
 */
export function repairFilledCellInputOverrides(project: FactoryProject): FactoryProject {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  let projectChanged = false;

  const nodes = project.nodes.map((node) => {
    const overrides = node.recipeInputOverrides;
    const recipe = overrides ? recipesById.get(node.recipeId) : undefined;
    if (!overrides || !recipe) {
      return node;
    }

    let nodeChanged = false;
    const repaired: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
    for (const [slot, override] of Object.entries(overrides)) {
      repaired[slot] = override;
      const input = recipe.inputs[Number(slot)];
      if (!input || override?.amount === undefined) {
        continue;
      }

      const legacyAmount = getFilledCellFluidEquivalent(input)?.amount;
      if (legacyAmount === undefined) {
        continue;
      }

      const alternative = input.alternatives?.find(
        (entry) => entry.kind === override.kind && entry.id === override.id,
      );
      const correctAmount = crossKindInputOverrideAmount(input, override.kind, alternative);
      if (
        Math.abs(override.amount - legacyAmount) < 1e-6 &&
        Math.abs(correctAmount - legacyAmount) > 1e-6
      ) {
        repaired[slot] = { ...override, amount: correctAmount };
        nodeChanged = true;
      }
    }

    if (!nodeChanged) {
      return node;
    }
    projectChanged = true;
    return { ...node, recipeInputOverrides: repaired };
  });

  return projectChanged ? { ...project, nodes } : project;
}

export function applyRecipeInputOverrides(
  recipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
): Recipe {
  if (!node.recipeInputOverrides) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    if (!override) {
      return input;
    }
    changed = true;
    return {
      ...input,
      ...override,
      amount: override.amount ?? input.amount,
      optional: input.optional,
      consumed: input.consumed,
      neiSlot: input.neiSlot,
      alternatives: undefined,
    };
  });

  return changed ? { ...recipe, inputs } : recipe;
}

export function restoreCrossKindInputOverrideVisuals(
  displayRecipe: Recipe,
  baseRecipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
): Recipe {
  if (!node.recipeInputOverrides) {
    return displayRecipe;
  }

  let changed = false;
  const inputs = displayRecipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    const baseInput = baseRecipe.inputs[index];
    if (
      !override ||
      !baseInput ||
      override.kind === baseInput.kind ||
      !resourceMatchesInput(override, baseInput)
    ) {
      return input;
    }

    changed = true;
    return {
      ...baseInput,
      amount: baseInput.amount,
      optional: input.optional,
      consumed: input.consumed,
      neiSlot: input.neiSlot,
    };
  });

  return changed ? { ...displayRecipe, inputs } : displayRecipe;
}
