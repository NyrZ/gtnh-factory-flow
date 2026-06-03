import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { recipeToRenderModel } from "../adapters/recipe-to-render-model";
import { selectNeiRecipeHandler } from "../adapters/handler-selection";
import { renderNeiRecipe } from "../core/render-pipeline";

describe("NEI recipe handlers", () => {
  it("generates GregTech slot, progress, and stack commands", () => {
    const result = render(recipe({ machineType: "Ore Washer" }));

    expect(result.handlerId).toBe("gregtech-machine");
    expect(result.commands.some((command) => command.type === "slot")).toBe(true);
    expect(result.commands.some((command) => command.type === "progress")).toBe(true);
    expect(result.positionedStacks.map((stack) => [stack.side, stack.kind])).toEqual([
      ["input", "item"],
      ["output", "item"],
    ]);
  });

  it("generates bee produce commands without using a machine fallback", () => {
    const result = render(
      recipe({
        kind: "bee_produce",
        machineType: "Bee Produce",
        inputs: [{ kind: "item", id: "factoryflow:bee_species:test", amount: 1 }],
        outputs: [{ kind: "item", id: "comb", amount: 1, chance: 0.2 }],
      }),
    );

    expect(result.handlerId).toBe("bee-produce");
    expect(result.commands.filter((command) => command.type === "slot")).toHaveLength(7);
    expect(result.positionedStacks[1]?.chance).toBe(0.2);
  });

  it("generates crop produce commands", () => {
    const result = render(
      recipe({
        kind: "crop_produce",
        machineType: "IC2 Crop",
        inputs: [{ kind: "item", id: "seed", amount: 1 }],
        outputs: [{ kind: "item", id: "drop", amount: 2 }],
      }),
    );

    expect(result.handlerId).toBe("crop-produce");
    expect(result.positionedStacks.map((stack) => stack.side)).toEqual(["input", "output"]);
  });

  it("renders essentia outputs as aspect stacks and readable text", () => {
    const result = render(
      recipe({
        kind: "essentia_smelting",
        machineType: "Thaumcraft Essentia Smelting",
        inputs: [{ kind: "item", id: "minecraft:rotten_flesh", amount: 1 }],
        outputs: [
          { kind: "aspect", id: "thaumcraft:aspect:corpus", amount: 4, displayName: "Corpus" },
        ],
      }),
      { preset: "readable", aspectDisplay: "text" },
    );

    expect(result.handlerId).toBe("essentia-smelting");
    expect(result.commands.some((command) => command.type === "aspect")).toBe(true);
    expect(
      result.commands.some((command) => command.type === "text" && command.text.includes("Corpus")),
    ).toBe(true);
  });

  it("filters empty slots when requested", () => {
    const result = render(
      recipe({
        kind: "bee_produce",
        machineType: "Bee Produce",
        outputs: [{ kind: "item", id: "comb", amount: 1 }],
      }),
      { showEmptySlots: false },
    );

    expect(result.commands.some((command) => command.semanticTags?.includes("empty-slot"))).toBe(
      false,
    );
  });
});

function render(recipeValue: Recipe, options = {}) {
  const model = recipeToRenderModel(recipeValue);
  return renderNeiRecipe(model, selectNeiRecipeHandler(model), options);
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe",
    name: "Recipe",
    kind: "gregtech_machine",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [{ kind: "item", id: "input", amount: 1 }],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
    ...overrides,
  };
}
