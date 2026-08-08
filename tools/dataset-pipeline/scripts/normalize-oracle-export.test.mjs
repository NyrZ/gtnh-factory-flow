import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./normalize-oracle-export.mjs", import.meta.url));

/**
 * The normalizer runs work at import time, so it is exercised the way the
 * pipeline runs it: as a subprocess over a fixture export.
 */
function normalize(rawExport) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-oracle-"));
  const input = path.join(dir, "oracle-export.json");
  const output = path.join(dir, "recipes.json");
  fs.writeFileSync(input, JSON.stringify(rawExport));
  execFileSync(process.execPath, [scriptPath, input, output], {
    env: {
      ...process.env,
      GTNH_DATASET_VERSION_ID: "test-fixture",
      GTNH_DATASET_VERSION_LABEL: "test",
    },
    stdio: "pipe",
  });
  const dataset = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return dataset;
}

function fluid(id, amount, displayName) {
  return { kind: "fluid", id, amount, displayName };
}

/**
 * The Circuit Assembler recipe for an Electronic Circuit, cut down to the part
 * under test. GregTech registers its fluid with
 * `SubstituteFluidStack.soldering(HALF_INGOTS)`, which is why the slot lists
 * three fluids at three different amounts, and registers the resistor and the
 * vacuum tube as plain stacks, which is why they list nothing.
 */
const RAW_EXPORT = {
  schemaVersion: 1,
  exporter: "gtnh-oracle",
  format: "dev.gtnhplanner.oracle.v1",
  generatedAt: "2026-08-08T05:00:00.000Z",
  minecraftVersion: "1.7.10",
  loadedMods: [],
  adapters: [],
  recipeCount: 1,
  domains: [
    {
      id: "gregtech",
      recipeMaps: [
        {
          id: "gt.recipe.circuitassembler",
          name: "Circuit Assembler",
          sourceClass: "gregtech.api.recipe.RecipeMap",
          catalysts: [],
          recipes: [
            {
              id: "electronic-circuit",
              enabled: true,
              durationTicks: 200,
              eut: 15,
              itemInputs: [
                {
                  kind: "item",
                  id: "gregtech:gt.metaitem.01@32716",
                  amount: 2,
                  displayName: "Resistor",
                },
              ],
              itemOutputs: [
                { kind: "item", id: "ic2:itempartcircuit", amount: 1, displayName: "Electronic Circuit" },
              ],
              fluidInputs: [
                {
                  ...fluid("molten.solderingalloy", 72, "Molten Soldering Alloy"),
                  alternatives: [
                    fluid("molten.solderingalloy", 72, "Molten Soldering Alloy"),
                    fluid("molten.tin", 144, "Molten Tin"),
                    fluid("molten.lead", 288, "Molten Lead"),
                  ],
                },
              ],
              fluidOutputs: [],
              nonConsumedInputs: [],
            },
          ],
        },
      ],
    },
  ],
};

describe("what a recipe slot accepts", () => {
  let dataset;
  let recipe;

  beforeAll(() => {
    dataset = normalize(RAW_EXPORT);
    recipe = dataset.recipes[0];
  });

  afterAll(() => {
    dataset = undefined;
    recipe = undefined;
  });

  it("keeps the slot's other fluids on the input", () => {
    const solder = recipe.inputs.find((input) => input.id === "molten.solderingalloy");

    expect(solder.alternatives?.map((entry) => entry.displayName)).toEqual([
      "Molten Soldering Alloy",
      "Molten Tin",
      "Molten Lead",
    ]);
  });

  it("stores each substitute as a ratio, not a stack size", () => {
    // 72 L of soldering alloy, 144 L of tin, 288 L of lead. Storing the ratio
    // means the slot can be switched on a recipe of any size, so the amount is
    // divided out here and multiplied back when the swap actually happens.
    const solder = recipe.inputs.find((input) => input.id === "molten.solderingalloy");
    const byId = new Map(solder.alternatives.map((entry) => [entry.id, entry.amount]));

    expect(byId.get("molten.solderingalloy")).toBe(1);
    expect(byId.get("molten.tin")).toBe(2);
    expect(byId.get("molten.lead")).toBe(4);
    expect(solder.amount * byId.get("molten.lead")).toBe(288);
  });

  it("invents nothing for a slot that named one exact item", () => {
    const resistor = recipe.inputs.find((input) => input.id === "gregtech:gt.metaitem.01@32716");

    expect(resistor.alternatives).toBeUndefined();
  });

  it("never lets one recipe's substitutes follow the item into the catalog", () => {
    // The catalog is keyed by id and shared by every recipe. Soldering alloy is
    // swappable in THIS slot; writing that onto the item would offer tin and
    // lead in every other machine that uses solder.
    const solder = dataset.resources.find((entry) => entry.id === "molten.solderingalloy");

    expect(solder).toBeDefined();
    expect(solder.alternatives).toBeUndefined();
  });

  it("does not ship the marker that told the writer which kind these were", () => {
    for (const input of recipe.inputs) {
      expect(input).not.toHaveProperty("slotChoice");
    }
  });
});
