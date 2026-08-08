import { describe, expect, it } from "vitest";

import {
  createCustomRatePlaceholderRecipe,
  getCustomRateDial,
  getCustomRateSlot,
  isCustomRateNodeId,
  releaseCustomRates,
  withCustomRateSlot,
} from "./custom-rate";
import type { FactoryNode, Recipe } from "./types";

const WATER = { kind: "fluid", id: "water", displayName: "Water" } as const;

function card(overrides: Partial<FactoryNode> = {}): FactoryNode {
  return {
    id: "dial",
    recipeId: "dial-recipe",
    machineCount: 1,
    parallel: 1,
    overclockTier: "NONE",
    enabled: true,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function project(recipe: Recipe, edges: Array<{ source: string; target: string }>) {
  return { nodes: [card(), machineNode], recipes: [recipe, machineRecipe], edges };
}

const machineRecipe: Recipe = {
  id: "boiler-recipe",
  name: "Boiler",
  machineType: "Boiler",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 16,
  inputs: [{ kind: "fluid", id: "water", amount: 100 }],
  outputs: [{ kind: "fluid", id: "steam", amount: 150 }],
};

const machineNode = card({ id: "boiler", recipeId: "boiler-recipe" });

describe("releaseCustomRates", () => {
  it("empties a card nothing is wired to", () => {
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "supply",
      50,
    );

    const released = releaseCustomRates(project(held, []));

    const recipe = released.recipes.find((entry) => entry.id === "dial-recipe")!;
    expect(getCustomRateSlot(recipe)).toBeUndefined();
    expect(recipe.name).toBe("Custom Rate");
  });

  it("leaves a wired card holding what it holds", () => {
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "supply",
      50,
    );

    const kept = releaseCustomRates(project(held, [{ source: "dial", target: "boiler" }]));

    expect(getCustomRateSlot(kept.recipes[0]!)?.resource.id).toBe("water");
  });

  it("counts a wire in either direction", () => {
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "request",
      50,
    );

    const kept = releaseCustomRates(project(held, [{ source: "boiler", target: "dial" }]));

    expect(getCustomRateSlot(kept.recipes[0]!)?.mode).toBe("request");
  });

  it("returns the same project when there is nothing to release", () => {
    // The common case runs on every edit, so it must not churn identities.
    const empty = project(createCustomRatePlaceholderRecipe("dial-recipe"), []);

    expect(releaseCustomRates(empty)).toBe(empty);
  });
});

describe("getCustomRateDial", () => {
  it("prefers the number on the card over the live slot", () => {
    // The card is the memory: the slot is emptied and rewritten every time the
    // card changes hands.
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "supply",
      7,
    );

    expect(
      getCustomRateDial(card({ customRate: { perSecond: 50, mode: "request" } }), held),
    ).toEqual({ perSecond: 50, mode: "request" });
  });

  it("falls back to the slot for cards saved before the dial moved", () => {
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "request",
      7,
    );

    expect(getCustomRateDial(card(), held)).toEqual({ perSecond: 7, mode: "request" });
  });

  it("gives a fresh card one a second, supplying", () => {
    expect(getCustomRateDial(card(), createCustomRatePlaceholderRecipe("dial-recipe"))).toEqual({
      perSecond: 1,
      mode: "supply",
    });
  });
});

describe("isCustomRateNodeId", () => {
  it("answers for the card, not for the port it is showing", () => {
    const held = withCustomRateSlot(
      createCustomRatePlaceholderRecipe("dial-recipe"),
      WATER,
      "supply",
      1,
    );
    const board = project(held, []);

    expect(isCustomRateNodeId(board, "dial")).toBe(true);
    expect(isCustomRateNodeId(board, "boiler")).toBe(false);
    expect(isCustomRateNodeId(board, undefined)).toBe(false);
  });
});
