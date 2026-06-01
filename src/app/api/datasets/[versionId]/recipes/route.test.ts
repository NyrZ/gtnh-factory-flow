import { describe, expect, it, vi } from "vitest";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import { GET } from "./route";

vi.mock("@/lib/server/dataset-query", () => ({
  queryDatasetRecipes: vi.fn(async () => ({
    recipes: [],
    total: 0,
    recipeMaps: [],
    recipeMapIcons: {},
    offset: 0,
    limit: 48,
    hasMore: false,
  })),
}));

describe("recipe dataset API route", () => {
  it("accepts aspect resources for recipe lookups", async () => {
    await GET(
      new Request(
        "http://localhost/api/datasets/stable/recipes?resourceKind=aspect&resourceId=thaumcraft%3Aaspect%3Aaer&mode=recipes",
      ),
      { params: Promise.resolve({ versionId: "stable" }) },
    );

    expect(queryDatasetRecipes).toHaveBeenCalledWith(
      "stable",
      expect.objectContaining({
        resource: { kind: "aspect", id: "thaumcraft:aspect:aer" },
        mode: "recipes",
      }),
    );
  });
});
