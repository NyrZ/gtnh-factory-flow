import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { recipeToRenderModel } from "./recipe-to-render-model";

describe("recipeToRenderModel", () => {
  it("preserves machine metadata and splits item, fluid, and aspect resources", () => {
    const model = recipeToRenderModel(
      recipe({
        machineType: "Thaumcraft Essentia Smelting",
        kind: "essentia_smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: [
          { kind: "aspect", id: "thaumcraft:aspect:corpus", amount: 4, displayName: "Corpus" },
          { kind: "fluid", id: "water", amount: 1000 },
        ],
      }),
    );

    expect(model.kind).toBe("essentia_smelting");
    expect(model.inputs).toHaveLength(1);
    expect(model.fluidOutputs?.[0]?.id).toBe("water");
    expect(model.aspectOutputs?.[0]).toMatchObject({
      aspectId: "corpus",
      name: "Corpus",
      amount: 4,
    });
  });

  it("infers bee and crop kinds for older datasets", () => {
    expect(recipeToRenderModel(recipe({ machineType: "Bee Produce" })).kind).toBe("bee_produce");
    expect(recipeToRenderModel(recipe({ machineType: "IC2 Crop" })).kind).toBe("crop_produce");
  });
});

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    ...overrides,
  };
}
