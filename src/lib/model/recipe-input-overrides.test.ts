import { describe, expect, it } from "vitest";
import type { FactoryNode, FactoryProject, Recipe } from "./types";
import {
  applyRecipeInputOverrides,
  crossKindInputOverrideAmount,
  repairFilledCellInputOverrides,
  restoreCrossKindInputOverrideVisuals,
} from "./recipe-input-overrides";

describe("crossKindInputOverrideAmount", () => {
  const cellInput = {
    kind: "item" as const,
    id: "gregtech:gt.metaitem.01@30734",
    displayName: "Sulfuric Gas Cell",
    amount: 2,
    alternatives: [{ kind: "fluid" as const, id: "gas_sulfuricgas", amount: 1000 }],
  };
  const fluidInput = {
    kind: "fluid" as const,
    id: "gas_sulfuricgas",
    displayName: "Sulfuric Gas",
    amount: 16000,
    alternatives: [
      { kind: "item" as const, id: "gregtech:gt.metaitem.01@30734", amount: 1 / 1000 },
    ],
  };

  // The bug: a recipe wanting 2 cells asked for 2,000 the moment anything was
  // wired into it, because the cell's FLUID amount was used no matter what was
  // being connected. Cells into a cell input must not be converted at all.
  it("leaves a cell input alone when cells are what is wired in", () => {
    expect(crossKindInputOverrideAmount(cellInput, "item")).toBe(2);
    expect(
      crossKindInputOverrideAmount(cellInput, "item", { amount: 1000 }),
    ).toBe(2);
  });

  it("converts a cell input to litres when the fluid is wired in", () => {
    expect(crossKindInputOverrideAmount(cellInput, "fluid")).toBe(2000);
    expect(crossKindInputOverrideAmount(cellInput, "fluid", { amount: 1000 })).toBe(2000);
  });

  it("converts a fluid input to cells when cells are wired in", () => {
    expect(crossKindInputOverrideAmount(fluidInput, "item")).toBe(16);
    expect(crossKindInputOverrideAmount(fluidInput, "item", { amount: 1 / 1000 })).toBe(16);
  });

  it("leaves a fluid input alone when the fluid is wired in", () => {
    expect(crossKindInputOverrideAmount(fluidInput, "fluid")).toBe(16000);
  });

  it("honours a non-standard cell size from the dataset over the 1000 L default", () => {
    // A 500 L cell: 2 of them are 1000 L, not 2000.
    expect(crossKindInputOverrideAmount(cellInput, "fluid", { amount: 500 })).toBe(1000);
  });

  it("falls back to the default cell size when the ratio is missing or nonsense", () => {
    expect(crossKindInputOverrideAmount(cellInput, "fluid", { amount: 0 })).toBe(2000);
    expect(
      crossKindInputOverrideAmount(
        { ...fluidInput, alternatives: undefined },
        "item",
        { amount: Number.NaN },
      ),
    ).toBe(16);
  });
});

describe("repairFilledCellInputOverrides", () => {
  const cellInput = {
    kind: "item" as const,
    id: "gregtech:gt.metaitem.01@30734",
    amount: 2,
    displayName: "Sulfuric Gas Cell",
    alternatives: [{ kind: "fluid" as const, id: "gas_sulfuricgas", amount: 1000 }],
  };
  const recipe = {
    id: "refinery-gas",
    name: "Chemical Reactor: Refinery Gas Cell",
    machineType: "Chemical Reactor",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [cellInput],
    outputs: [{ kind: "item" as const, id: "refinery-gas-cell", amount: 2 }],
  } as unknown as Recipe;

  const projectWith = (override: Record<string, unknown>) =>
    ({
      schemaVersion: 1,
      id: "p",
      name: "p",
      recipes: [recipe],
      nodes: [{ id: "n", recipeId: "refinery-gas", recipeInputOverrides: { "0": override } }],
      edges: [],
      storages: [],
      fuelProfiles: [],
    }) as unknown as FactoryProject;

  it("rescales a cell override that was stored in litres", () => {
    const repaired = repairFilledCellInputOverrides(
      projectWith({ ...cellInput, amount: 2000, alternatives: undefined }),
    );
    expect(repaired.nodes[0]!.recipeInputOverrides!["0"]!.amount).toBe(2);
  });

  it("leaves a genuine cell-to-fluid override alone", () => {
    // 2 cells -> 2000 L is correct, and happens to equal the buggy figure, so
    // the guard has to spare it.
    const project = projectWith({
      ...cellInput,
      kind: "fluid",
      id: "gas_sulfuricgas",
      amount: 2000,
      alternatives: undefined,
    });
    expect(repairFilledCellInputOverrides(project)).toBe(project);
  });

  it("leaves an amount nobody could have produced by accident alone", () => {
    const project = projectWith({ ...cellInput, amount: 7, alternatives: undefined });
    expect(repairFilledCellInputOverrides(project)).toBe(project);
  });

  it("returns the same project object when there is nothing to repair", () => {
    const project = {
      schemaVersion: 1,
      id: "p",
      name: "p",
      recipes: [recipe],
      nodes: [{ id: "n", recipeId: "refinery-gas" }],
      edges: [],
      storages: [],
      fuelProfiles: [],
    } as unknown as FactoryProject;
    expect(repairFilledCellInputOverrides(project)).toBe(project);
  });
});

describe("recipe input overrides", () => {
  it("keeps cross-kind filled-cell overrides calculable but restores the cell for display", () => {
    const recipe: Recipe = {
      id: "oxygen-cell-consumer",
      name: "Oxygen Cell Consumer",
      machineType: "Chemical Reactor",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [
        {
          kind: "item",
          id: "gregtech:gt.metaitem.01@32000",
          amount: 1,
          displayName: "Oxygen Cell",
          iconPath: "/items/oxygen-cell.png",
          alternatives: [{ kind: "fluid", id: "oxygen", displayName: "Oxygen" }],
          neiSlot: { x: 34, y: 17 },
        },
      ],
      outputs: [{ kind: "item", id: "dust", amount: 1 }],
    };
    const node: Pick<FactoryNode, "recipeInputOverrides"> = {
      recipeInputOverrides: {
        "0": {
          ...recipe.inputs[0],
          kind: "fluid",
          id: "oxygen",
          amount: 1000,
          displayName: "Oxygen",
          iconPath: "/fluids/oxygen.png",
          alternatives: undefined,
        },
      },
    };

    const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
    expect(effectiveRecipe.inputs[0]).toEqual(
      expect.objectContaining({
        kind: "fluid",
        id: "oxygen",
        amount: 1000,
      }),
    );

    const displayRecipe = restoreCrossKindInputOverrideVisuals(effectiveRecipe, recipe, node);
    expect(displayRecipe.inputs[0]).toEqual(
      expect.objectContaining({
        kind: "item",
        id: "gregtech:gt.metaitem.01@32000",
        amount: 1,
        displayName: "Oxygen Cell",
        iconPath: "/items/oxygen-cell.png",
      }),
    );
  });
});

describe("switching a slot to a substitute of the same kind", () => {
  it("scales the requirement by the substitute's ratio", () => {
    const solder = {
      kind: "fluid" as const,
      id: "molten.solderingalloy",
      displayName: "Molten Soldering Alloy",
      amount: 72,
      alternatives: [{ kind: "fluid" as const, id: "molten.lead", amount: 4 }],
    };

    expect(crossKindInputOverrideAmount(solder, "fluid", { kind: "fluid", amount: 4 })).toBe(288);
  });

  it("leaves an ore dictionary member's requirement untouched", () => {
    const planks = {
      kind: "item" as const,
      id: "oredict:plankWood",
      displayName: "Ore Dictionary: plankWood",
      amount: 3,
      alternatives: [{ kind: "item" as const, id: "minecraft:planks", amount: 1 }],
    };

    expect(crossKindInputOverrideAmount(planks, "item", { kind: "item", amount: 1 })).toBe(3);
    expect(crossKindInputOverrideAmount(planks, "item", undefined)).toBe(3);
  });
});
