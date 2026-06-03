import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiRecipeRenderModel } from "../core/render-model";
import { BeeProduceHandler } from "../handlers/bee-produce-handler";
import { CropProduceHandler } from "../handlers/crop-produce-handler";
import { EssentiaSmeltingHandler } from "../handlers/essentia-smelting-handler";
import { GregTechMachineHandler } from "../handlers/gregtech-machine-handler";

export const defaultNeiRecipeHandlers: NeiRecipeHandler[] = [
  BeeProduceHandler,
  CropProduceHandler,
  EssentiaSmeltingHandler,
  GregTechMachineHandler,
];

export function selectNeiRecipeHandler(
  recipe: NeiRecipeRenderModel,
  handlers: NeiRecipeHandler[] = defaultNeiRecipeHandlers,
): NeiRecipeHandler {
  const handler = handlers.find((candidate) => candidate.canHandle(recipe));
  if (!handler) {
    throw new Error(`No NEI recipe handler registered for recipe kind "${recipe.kind}".`);
  }
  return handler;
}
