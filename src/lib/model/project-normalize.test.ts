import { describe, expect, it } from "vitest";
import type { FactoryProject } from "./types";
import { normalizeLoadedProject } from "./project-normalize";

const PROJECT_SCHEMA_VERSION = 1;

/**
 * A plan built while a filled cell could stand in for its fluid: a Dehydrator
 * making Oxygen Cells, wired to a TANK of Oxygen, with the consumer's cell slot
 * renamed to the fluid and its amount inflated to litres.
 */
function createCrossFormProject(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "cross-form",
    name: "Cross form",
    recipes: [
      {
        id: "cell-source",
        name: "Oxygen Cell Source",
        machineType: "Dehydrator",
        minimumTier: "LV",
        durationTicks: 196,
        eut: 16,
        inputs: [{ kind: "item", id: "empty_cell", amount: 14, displayName: "Empty Cell" }],
        outputs: [{ kind: "item", id: "oxygen_cell", amount: 14, displayName: "Oxygen Cell" }],
      },
      {
        id: "cell-consumer",
        name: "Cell Consumer",
        machineType: "Chemical Reactor",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "oxygen_cell", amount: 2, displayName: "Oxygen Cell" }],
        outputs: [{ kind: "item", id: "plate", amount: 1 }],
      },
    ],
    nodes: [
      {
        id: "source",
        recipeId: "cell-source",
        machineCount: 1,
        parallel: 1,
        position: { x: 0, y: 0 },
      },
      {
        id: "consumer",
        recipeId: "cell-consumer",
        machineCount: 1,
        parallel: 1,
        position: { x: 400, y: 0 },
        recipeInputOverrides: {
          "0": { kind: "fluid", id: "oxygen", amount: 2000, displayName: "Oxygen" },
        },
      },
    ],
    storages: [
      {
        id: "tank",
        kind: "fluid",
        resourceId: "oxygen",
        displayName: "Oxygen",
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "source-to-tank",
        source: "source",
        target: "tank",
        resourceKind: "fluid",
        resourceId: "oxygen",
      },
      {
        id: "source-to-consumer",
        source: "source",
        target: "consumer",
        resourceKind: "item",
        resourceId: "oxygen_cell",
      },
    ],
    fuelProfiles: [],
  } as unknown as FactoryProject;
}

describe("dropping cross-form connections on load", () => {
  it("drops a wire that crosses a cell and its fluid, and keeps the honest one", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    // The Dehydrator makes an ITEM. It never fed that Oxygen tank without a
    // Canner, so the wire goes and the chain reads short by exactly that much.
    expect(normalized.edges.map((edge) => edge.id)).toEqual(["source-to-consumer"]);
  });

  it("drops a slot override that renamed a cell slot into its fluid", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    // The override also carried 2000, converted at a guessed 1000 L per cell.
    // Leaving it would keep that guess in the numbers.
    expect(normalized.nodes.find((node) => node.id === "consumer")?.recipeInputOverrides).toEqual(
      {},
    );
  });

  it("leaves the tank on the board rather than deleting someone's card", () => {
    const normalized = normalizeLoadedProject(createCrossFormProject());

    expect(normalized.storages?.map((storage) => storage.id)).toEqual(["tank"]);
  });

  it("returns a plan with nothing to repair unchanged", () => {
    const clean = createCrossFormProject();
    clean.edges = clean.edges.filter((edge) => edge.id === "source-to-consumer");
    clean.nodes = clean.nodes.map((node) => ({ ...node, recipeInputOverrides: undefined }));

    const normalized = normalizeLoadedProject(clean);
    expect(normalized.edges).toHaveLength(1);
    expect(
      normalized.nodes.find((node) => node.id === "consumer")?.recipeInputOverrides,
    ).toBeUndefined();
  });
});
