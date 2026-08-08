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

function item(id, amount, displayName) {
  return { kind: "item", id, amount, displayName };
}

const RESISTOR = "gregtech:gt.metaitem.01@32716";
const SMD_RESISTOR = "gregtech:gt.metaitem.03@32011";
const VACUUM_TUBE = "gregtech:gt.metaitem.01@32700";

/**
 * The Circuit Assembler recipe for an Electronic Circuit (the LV tier circuit),
 * as the oracle exports it from the running game. Every slot here is the real
 * thing, and each behaves differently on purpose:
 *
 *   Circuit Board 1x       one exact item, nothing else accepted
 *   Resistor 2x            also takes 2 SMD resistors: GregTech unifies them
 *                          through `componentCircuitResistor`, so NEI shows
 *                          the slot cycling between the two
 *   1x Red Alloy Wire 2x   its ore dictionary group has one member, so no
 *                          choice comes out of it
 *   Vacuum Tube 2x         shares `circuitPrimitive` with the NAND chip and
 *                          STILL takes only vacuum tubes, which is why ore
 *                          dictionary membership cannot be used as the rule
 *   Molten Soldering Alloy 72 L    or 144 L of tin, or 288 L of lead, from
 *                                  `SubstituteFluidStack.soldering(HALF_INGOTS)`
 *
 * Item substitutes come at the slot's own stack size (2 resistors, 2 SMD
 * resistors), fluid substitutes at their own amounts.
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
                item("gregtech:gt.metaitem.03@32100", 1, "Circuit Board"),
                {
                  ...item(RESISTOR, 2, "Resistor"),
                  alternatives: [
                    item(RESISTOR, 2, "Resistor"),
                    item(SMD_RESISTOR, 2, "SMD Resistor"),
                  ],
                },
                item("gregtech:gt.blockmachines@2000", 2, "1x Red Alloy Wire"),
                item(VACUUM_TUBE, 2, "Vacuum Tube"),
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

  it("offers the SMD resistor the resistor slot really takes", () => {
    const resistor = recipe.inputs.find((input) => input.id === RESISTOR);

    expect(resistor.alternatives?.map((entry) => entry.displayName)).toEqual([
      "Resistor",
      "SMD Resistor",
    ]);
  });

  it("keeps an item substitute at the slot's own count", () => {
    // The slot wants 2 resistors and takes 2 SMD resistors, so the ratio is
    // one to one and the count must not drift when the slot is switched.
    const resistor = recipe.inputs.find((input) => input.id === RESISTOR);
    const smd = resistor.alternatives.find((entry) => entry.id === SMD_RESISTOR);

    expect(smd.amount).toBe(1);
    expect(resistor.amount * smd.amount).toBe(2);
  });

  it("invents nothing for a slot that named one exact item", () => {
    // A vacuum tube shares `circuitPrimitive` with the NAND chip, and the
    // machine still takes only vacuum tubes. Offering the group here would
    // describe a recipe the game will not run.
    const vacuumTube = recipe.inputs.find((input) => input.id === VACUUM_TUBE);
    const board = recipe.inputs.find((input) => input.id === "gregtech:gt.metaitem.03@32100");

    expect(vacuumTube.alternatives).toBeUndefined();
    expect(board.alternatives).toBeUndefined();
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
