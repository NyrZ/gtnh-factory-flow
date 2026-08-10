import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Conservation: a wired output may not vanish.
 *
 * Only a trash can, a DRAIN drawer (one nothing draws from) and a port with no
 * wire on it can absorb a surplus nobody asked for. A buffer passes on what
 * its consumers pull and no more, so a machine whose leftovers have nowhere to
 * go is capped by its ability to shift them, and reads CLOGGED.
 *
 * Every recipe here runs exactly one operation per second: 20 ticks at 20
 * ticks/s, one machine, no parallel, and LV on an LV recipe is not an
 * overclock. So an output of `n` is a rate of `n` per second and the
 * percentages below can be read straight off the amounts.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: inputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
    outputs: outputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
  };
}

function node(id: string, recipeId: string) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 } };
}

function wire(id: string, source: string, target: string, resourceId: string) {
  return { id, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "conservation",
    name: "conservation",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  };
}

const DUAL = [
  recipe("dual", [], [["redstone", 10], ["gold", 5]]),
  recipe("eat-redstone", [["redstone", 5]], [["rsblock", 1]]),
  recipe("eat-gold", [["gold", 5]], [["goldblock", 1]]),
];

describe("conservation: a wired surplus has to go somewhere", () => {
  it("clogs a machine whose wired output makes more than its takers pull", () => {
    // 10 redstone + 5 gold. Redstone taker wants 5, gold taker wants 5. The
    // gold coupling wants the machine at 100%; the spare 5 redstone has
    // nowhere to go, so disposal pins it at 50% and the gold taker goes short.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        edges: [wire("r1", "dual", "rs", "redstone"), wire("g1", "dual", "au", "gold")],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    expect(dual.utilization).toBeCloseTo(0.5);
    expect(dual.disposalUtilization).toBeCloseTo(0.5);
    expect(dual.clogOutputKey).toBe("item:redstone");
    // The gold taker is genuinely starved by the clog, and the books say so.
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(2.5);
    // Nothing is invented and nothing vanishes: 5 redstone made, 5 taken.
    expect(result.unconsumedOutputs.find((b) => b.resourceId === "redstone")).toBeUndefined();
  });

  it("a DRAIN drawer on the spare output unclogs it", () => {
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("rs", "eat-redstone"), node("au", "eat-gold")],
        storages: [drawer("spare", "redstone")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "spare", "redstone"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    expect(dual.utilization).toBeCloseTo(1);
    expect(dual.clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
    // The drain takes exactly the 5 that had nowhere to go.
    expect(result.storages["spare"].producedPerSecond).toBeCloseTo(5);
  });

  it("a BUFFER is not a dump: it only takes what its own takers pull", () => {
    // Same drawer, but something draws from it. It stops being the boundary
    // and becomes a pass-through, so it can only relay the 1/s its taker
    // wants, and the machine clogs again at the level that adds up.
    const result = calculateThroughput(
      project({
        recipes: [...DUAL, recipe("sip-redstone", [["redstone", 1]], [["rsdust", 1]])],
        nodes: [
          node("dual", "dual"),
          node("rs", "eat-redstone"),
          node("au", "eat-gold"),
          node("sip", "sip-redstone"),
        ],
        storages: [drawer("mid", "redstone")],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "mid", "redstone"),
          wire("r3", "mid", "sip", "redstone"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    const dual = result.nodes["dual"];
    // 5 to the taker + 1 through the buffer = 6 of 10 redstone can move.
    expect(dual.utilization).toBeCloseTo(0.6);
    expect(dual.clogOutputKey).toBe("item:redstone");
    expect(result.storages["mid"].producedPerSecond).toBeCloseTo(1);
  });

  it("a trash can absorbs without limit, exactly as before", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          ...DUAL,
          {
            ...recipe("void", [], []),
            machineType: "Trash Can",
            name: "Trash Can",
          },
        ],
        nodes: [
          node("dual", "dual"),
          node("rs", "eat-redstone"),
          node("au", "eat-gold"),
          node("can", "void"),
        ],
        edges: [
          wire("r1", "dual", "rs", "redstone"),
          wire("g1", "dual", "au", "gold"),
          wire("r2", "dual", "can", "redstone"),
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(1);
    expect(result.nodes["dual"].clogOutputKey).toBeUndefined();
    expect(result.edges["g1"].transferredPerSecond).toBeCloseTo(5);
  });

  it("an UNWIRED output is the outside world, not a clog", () => {
    // The mirror of the hand-fed input. Without this the last machine of every
    // chain ever built would stall for making the thing the plan is for.
    const result = calculateThroughput(
      project({
        recipes: DUAL,
        nodes: [node("dual", "dual"), node("au", "eat-gold")],
        edges: [wire("g1", "dual", "au", "gold")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["dual"].utilization).toBeCloseTo(1);
    expect(result.nodes["dual"].clogOutputKey).toBeUndefined();
    expect(
      result.unconsumedOutputs.find((b) => b.resourceId === "redstone")?.surplusPerSecond,
    ).toBeCloseTo(10);
  });

  it("a fed drawer still hands out only what it received", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("make-cobble", [], [["cobble", 10]]),
          recipe("eat-cobble", [["cobble", 20]], [["gravel", 1]]),
        ],
        nodes: [node("producer", "make-cobble"), node("taker", "eat-cobble")],
        storages: [drawer("mid", "cobble")],
        edges: [wire("e1", "producer", "mid", "cobble"), wire("e2", "mid", "taker", "cobble")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.edges["e2"].transferredPerSecond).toBeCloseTo(10);
    expect(result.nodes["taker"].utilization).toBeCloseTo(0.5);
    // The buffer's taker wants 20, so the producer is asked for 20 and reads
    // as under-built rather than clogged: its output moves everything it makes.
    expect(result.nodes["producer"].clogOutputKey).toBeUndefined();
    expect(result.externalInputs).toHaveLength(0);
  });

  it("an unfed drawer is still the declared import", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("eat-cobble", [["cobble", 20]], [["gravel", 1]])],
        nodes: [node("taker", "eat-cobble")],
        storages: [drawer("src", "cobble")],
        edges: [wire("e2", "src", "taker", "cobble")],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.edges["e2"].transferredPerSecond).toBeCloseTo(20);
    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    expect(result.externalInputs[0]?.resourceId).toBe("cobble");
  });
});
