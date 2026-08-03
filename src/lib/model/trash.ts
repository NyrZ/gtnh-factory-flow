import type { Recipe } from "./types";

/**
 * The trash can: a pure void. Anything wired into it is eaten at whatever
 * rate arrives and never counts as an output. Unlike the custom rate node it
 * never adopts a resource or grows recipe slots — the recipe stays empty and
 * the solver treats edges INTO a trash node as leftover-drinkers (see
 * equilibrium.ts, role "trash"). One can takes any number of inputs.
 */
export const TRASH_MACHINE_TYPE = "Trash Can";
/** The can's universal wire-here port: accepts any concrete resource. */
export const TRASH_ANY_RESOURCE_ID = "trash-any";

export function isTrashRecipe(recipe: Pick<Recipe, "machineType"> | undefined): boolean {
  return recipe?.machineType === TRASH_MACHINE_TYPE;
}

export function createTrashPlaceholderRecipe(id: string): Recipe {
  return {
    id,
    name: "Trash Can",
    kind: "custom",
    category: "trash",
    machineType: TRASH_MACHINE_TYPE,
    minimumTier: "NONE",
    durationTicks: 20,
    eut: 0,
    inputs: [],
    outputs: [],
    notes: "Voids everything piped in — trashed resources never show as outputs.",
    source: { recipeMap: "trash" },
  };
}

/** Trash node ids in a project — the solver and balance layers key off this. */
export function collectTrashNodeIds(project: {
  nodes: Array<{ id: string; recipeId: string }>;
  recipes: Array<Pick<Recipe, "id" | "machineType">>;
}): Set<string> {
  const trashRecipeIds = new Set<string>();
  for (const recipe of project.recipes) {
    if (isTrashRecipe(recipe)) {
      trashRecipeIds.add(recipe.id);
    }
  }
  const ids = new Set<string>();
  if (trashRecipeIds.size === 0) {
    return ids;
  }
  for (const node of project.nodes) {
    if (trashRecipeIds.has(node.recipeId)) {
      ids.add(node.id);
    }
  }
  return ids;
}
