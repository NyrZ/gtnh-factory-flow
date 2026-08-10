import { describe, expect, it } from "vitest";
import { gtnhFuelProfiles } from "@/lib/model/fuels";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";
import { selectInternalBalances } from "./balances";
// These cases are about float dust in the resource books, not about the
// boundary, so the boundary is stated for them. See close-boundaries.ts.
import { closeBoundaries } from "./close-boundaries";

/**
 * A resource that one machine makes and another eats in equal measure has to
 * read as balanced no matter how big the numbers are.
 *
 * A throttled consumer's intake comes back as `need * (supply / need)`, which
 * in floating point is one unit in the last place away from `supply`. That
 * residue is proportional to the rates, so on a big enough plan it used to
 * clear the flat tolerance and put a perfectly balanced resource in Need at
 * something like "-0.0000012/s".
 */
function chainProject(outputAmount: number, inputAmount: number): FactoryProject {
  const recipe = (
    id: string,
    inputs: Recipe["inputs"],
    outputs: Recipe["outputs"],
    durationTicks: number,
  ): Recipe => ({
    id,
    name: id,
    kind: "custom",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks,
    eut: 30,
    inputs,
    outputs,
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "balance-dust",
    name: "Balance dust",
    recipes: [
      // Awkward durations on purpose: 3 and 7 do not divide evenly in binary,
      // so both sides of the wire land on inexact rates.
      recipe(
        "make",
        [{ kind: "item", id: "ore", amount: 1 }],
        [{ kind: "fluid", id: "gas", amount: outputAmount }],
        3,
      ),
      recipe(
        "eat",
        [{ kind: "fluid", id: "gas", amount: inputAmount }],
        [{ kind: "item", id: "out", amount: 1 }],
        7,
      ),
    ],
    nodes: [
      // The eater is far bigger than the maker, so it is supply-throttled and
      // its intake goes through the round-trip that leaves the residue.
      {
        id: "maker",
        recipeId: "make",
        machineCount: 13,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
      },
      {
        id: "eater",
        recipeId: "eat",
        machineCount: 400,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 400, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "maker", target: "eater", resourceKind: "fluid", resourceId: "gas" },
    ],
    fuelProfiles: gtnhFuelProfiles,
    selectedFuelProfileId: "biodiesel",
  };
}

describe("balance books settle float dust", () => {
  it("reports a fully consumed resource as exactly balanced", () => {
    const result = calculateThroughput(closeBoundaries(chainProject(144000, 37000)), { generatedAt: "fixed" });
    const gas = result.resources["fluid:gas"];

    expect(gas.producedPerSecond).toBeGreaterThan(0);
    expect(gas.netPerSecond).toBe(0);
    expect(gas.surplusPerSecond).toBe(0);
    expect(gas.deficitPerSecond).toBe(0);
  });

  it("keeps that resource out of Need and Output", () => {
    const result = calculateThroughput(closeBoundaries(chainProject(144000, 37000)), { generatedAt: "fixed" });

    expect(result.externalInputs.map((entry) => entry.key)).not.toContain("fluid:gas");
    expect(result.unconsumedOutputs.map((entry) => entry.key)).not.toContain("fluid:gas");
  });

  it("counts it as internal, which is where a balanced resource belongs", () => {
    const result = calculateThroughput(closeBoundaries(chainProject(144000, 37000)), { generatedAt: "fixed" });
    const internal = selectInternalBalances(Object.values(result.resources));

    expect(internal.map((entry) => entry.key)).toContain("fluid:gas");
  });

  it("settles dust at any scale, not only where a flat epsilon happened to reach", () => {
    // The point of a relative tolerance: the same rounding at a thousand times
    // the throughput is still rounding.
    for (const scale of [1, 1_000, 1_000_000]) {
      const result = calculateThroughput(
        closeBoundaries(chainProject(144000 * scale, 37000 * scale)),
        { generatedAt: "fixed" },
      );
      expect(result.resources["fluid:gas"].netPerSecond).toBe(0);
    }
  });

  it("still reports a real shortfall rather than swallowing it", () => {
    // A genuine gap has to survive: the eater wants far more than one part in
    // a billion beyond what the maker makes.
    const project = chainProject(144000, 37000);
    // Keep the eater and delete its maker, so the gas it eats has to come from
    // outside the plan. (Cutting the wire and leaving both is no longer the
    // way to write this: a machine with a bare input does not run at all, so
    // it would eat nothing and need nothing.)
    project.nodes = [project.nodes[1]];
    project.edges = [];
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });

    const need = result.externalInputs.find((entry) => entry.key === "fluid:gas");
    expect(need).toBeDefined();
    expect(need!.deficitPerSecond).toBeGreaterThan(1);
  });

  it("still reports a real surplus rather than swallowing it", () => {
    // Nothing downstream at all, so the maker runs at full blast and every
    // drop it makes is genuinely spare. (A maker with a SMALL consumer is not
    // the test to write here: the solver throttles it to what is asked for,
    // which is the right answer and leaves no surplus to check.)
    const project = chainProject(144000, 37000);
    project.nodes = [project.nodes[0]];
    project.edges = [];
    const result = calculateThroughput(closeBoundaries(project), { generatedAt: "fixed" });

    const spare = result.unconsumedOutputs.find((entry) => entry.key === "fluid:gas");
    expect(spare).toBeDefined();
    expect(spare!.surplusPerSecond).toBeGreaterThan(1);
  });
});
