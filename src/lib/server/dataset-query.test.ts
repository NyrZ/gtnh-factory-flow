import { describe, expect, it } from "vitest";
import {
  buildTextSearchIndex,
  getChoiceAlternativesByKey,
  getWildcardResource,
  queryTextSearchIndex,
  searchTokensMatch,
} from "./dataset-query";

describe("dataset query text search", () => {
  it("matches substrings inside tokens without matching across token boundaries", () => {
    const index = buildTextSearchIndex(["Hydrogen Sulfide"], [0]);

    const sulfideCandidates = queryTextSearchIndex(index, ["ulfide"]) ?? [0];
    expect(sulfideCandidates).toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["ulfide"])).toBe(true);

    const crossBoundaryCandidates = queryTextSearchIndex(index, ["nsu"]) ?? [0];
    expect(crossBoundaryCandidates).not.toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["nsu"])).toBe(false);
  });
});

describe("wildcard uses matching", () => {
  it("bridges damaged item ids to their any-damage wildcard", () => {
    expect(getWildcardResource({ kind: "item", id: "minecraft:log@1" })).toEqual({
      kind: "item",
      id: "minecraft:log@32767",
    });
  });

  it("bridges bare damage-0 item ids the same way", () => {
    // Regression: Oak Log ("minecraft:log", no "@") used to skip the wildcard
    // bridge entirely and lost every any-damage recipe (Coke Oven, Pyrolyse
    // Oven, Macerator, ...) from its uses listing.
    expect(getWildcardResource({ kind: "item", id: "minecraft:log" })).toEqual({
      kind: "item",
      id: "minecraft:log@32767",
    });
  });

  it("does not bridge wildcards or fluids", () => {
    expect(getWildcardResource({ kind: "item", id: "minecraft:log@32767" })).toBeUndefined();
    expect(getWildcardResource({ kind: "fluid", id: "water" })).toBeUndefined();
  });
});

describe("what an \"any of these\" placeholder stands for", () => {
  const catalog = () =>
    ({
      resources: [],
      resourceIndex: [
        {
          kind: "item",
          id: "oredict:circuitBasic",
          displayName: "Ore Dictionary: circuitBasic",
          alternatives: [
            { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit" },
            { kind: "item", id: "dreamcraft:circuitlv", displayName: "Any LV Circuit" },
            { kind: "item", id: "gregtech:circuit@2", displayName: "Integrated Logic Circuit" },
          ],
        },
        {
          kind: "item",
          id: "oredict:circuitGood",
          displayName: "Ore Dictionary: circuitGood",
          alternatives: [
            { kind: "item", id: "dreamcraft:circuitlv", displayName: "Any LV Circuit" },
            { kind: "item", id: "gregtech:circuit@9", displayName: "Good Electronic Circuit" },
          ],
        },
      ],
    }) as unknown as Parameters<typeof getChoiceAlternativesByKey>[0];

  it("expands a stand-in into the real items of its group", () => {
    const byKey = getChoiceAlternativesByKey(catalog());

    expect(byKey.get("item:dreamcraft:circuitlv")?.map((entry) => entry.displayName)).toEqual([
      "Electronic Circuit",
      "Integrated Logic Circuit",
      "Good Electronic Circuit",
    ]);
  });

  it("never hands alternatives to a concrete item", () => {
    // A recipe asking for this exact circuit does not accept the other three,
    // and saying it does would license a factory that cannot be built.
    const byKey = getChoiceAlternativesByKey(catalog());

    expect(byKey.get("item:gregtech:circuit@1")).toBeUndefined();
    expect(byKey.get("item:gregtech:circuit@2")).toBeUndefined();
  });

  it("does not list one stand-in as another's member", () => {
    const byKey = getChoiceAlternativesByKey(catalog());

    expect(
      byKey.get("item:dreamcraft:circuitlv")?.some((entry) => /^Any /.test(entry.displayName ?? "")),
    ).toBe(false);
  });
});
