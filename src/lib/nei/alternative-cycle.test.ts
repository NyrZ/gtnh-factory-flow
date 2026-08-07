// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALTERNATIVE_CYCLE_INTERVAL_MS,
  advanceAlternativeCycleForTests,
  applyAlternativeCycleFace,
  getAlternativeCycleFaces,
  getAlternativeCycleTick,
  resetAlternativeCycleForTests,
  subscribeToAlternativeCycle,
} from "./alternative-cycle";
import type { ResourceAmount } from "@/lib/model/types";

afterEach(() => {
  resetAlternativeCycleForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

function oredictInput(overrides: Partial<ResourceAmount> = {}): ResourceAmount {
  return {
    kind: "item",
    id: "oredict:circuitBasic",
    amount: 1,
    displayName: "Ore Dictionary: circuitBasic",
    alternatives: [
      { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit", amount: 1 },
      { kind: "item", id: "gregtech:circuit@2", displayName: "Integrated Logic Circuit", amount: 1 },
      { kind: "item", id: "gregtech:circuit@3", displayName: "Microprocessor", amount: 1 },
    ],
    ...overrides,
  };
}

describe("getAlternativeCycleFaces", () => {
  it("cycles only the concrete members of an oredict, never the placeholder", () => {
    const faces = getAlternativeCycleFaces(oredictInput());

    expect(faces.map((face) => face.displayName)).toEqual([
      "Electronic Circuit",
      "Integrated Logic Circuit",
      "Microprocessor",
    ]);
  });

  it("keeps a concrete resource in its own rotation", () => {
    const faces = getAlternativeCycleFaces({
      kind: "item",
      id: "minecraft:log@1",
      displayName: "Spruce Log",
      alternatives: [{ kind: "item", id: "minecraft:log@0", displayName: "Oak Log", amount: 1 }],
    });

    expect(faces.map((face) => face.displayName)).toEqual(["Spruce Log", "Oak Log"]);
  });

  it("does not rotate a cell against its own fluid", () => {
    // Same substance counted two ways, not a choice: flipping between them
    // would read as a different recipe.
    const faces = getAlternativeCycleFaces({
      kind: "item",
      id: "gregtech:cell@water",
      displayName: "Water Cell",
      alternatives: [{ kind: "fluid", id: "fluid:water", displayName: "Water", amount: 1000 }],
    });

    expect(faces).toEqual([]);
  });

  it("does not rotate a slot with nothing to rotate to", () => {
    expect(getAlternativeCycleFaces({ kind: "item", id: "minecraft:stone" })).toEqual([]);
  });

  it("treats a named stand-in as a placeholder, not one of its own faces", () => {
    // GTNH ships "Any LV Circuit" as a real item that means a set.
    const faces = getAlternativeCycleFaces({
      kind: "item",
      id: "dreamcraft:circuitlv",
      displayName: "Any LV Circuit",
      alternatives: [
        { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit" },
        { kind: "item", id: "gregtech:circuit@2", displayName: "Integrated Logic Circuit" },
      ],
    });

    expect(faces.map((face) => face.displayName)).toEqual([
      "Electronic Circuit",
      "Integrated Logic Circuit",
    ]);
  });

  it("never rotates one placeholder onto another", () => {
    // An ore dictionary group lists the stand-in beside the real items.
    const faces = getAlternativeCycleFaces({
      kind: "item",
      id: "oredict:circuitBasic",
      displayName: "Ore Dictionary: circuitBasic",
      alternatives: [
        { kind: "item", id: "gregtech:circuit@1", displayName: "Electronic Circuit" },
        { kind: "item", id: "dreamcraft:circuitlv", displayName: "Any LV Circuit" },
        { kind: "item", id: "minecraft:planks@32767", displayName: "Oak Planks" },
      ],
    });

    expect(faces.map((face) => face.displayName)).toEqual(["Electronic Circuit"]);
  });

  it("gives a single-member placeholder that member, so the slot is not blank", () => {
    const faces = getAlternativeCycleFaces({
      kind: "item",
      id: "oredict:somethingRare",
      displayName: "Ore Dictionary: somethingRare",
      alternatives: [{ kind: "item", id: "mod:only", displayName: "Only Member" }],
    });

    expect(faces.map((face) => face.displayName)).toEqual(["Only Member"]);
  });
});

describe("applyAlternativeCycleFace", () => {
  it("repaints the slot as the face but keeps the list it belongs to", () => {
    const input = oredictInput();
    const painted = applyAlternativeCycleFace(input, {
      kind: "item",
      id: "gregtech:circuit@2",
      displayName: "Integrated Logic Circuit",
      iconPath: "/icons/integrated.png",
    });

    expect(painted.id).toBe("gregtech:circuit@2");
    expect(painted.displayName).toBe("Integrated Logic Circuit");
    expect(painted.iconPath).toBe("/icons/integrated.png");
    // The slot must still advertise the whole list in its tooltip and marker.
    expect(painted.alternatives).toHaveLength(3);
    // A face's `amount` is a per-unit ratio, so it must not become the amount.
    expect(painted.amount).toBe(1);
  });

  it("does not paint one item's icon with another's atlas entry", () => {
    const painted = applyAlternativeCycleFace(
      oredictInput({
        iconPath: undefined,
        iconAtlas: {
          imagePath: "/atlas.png",
          atlasWidth: 256,
          atlasHeight: 256,
          x: 0,
          y: 0,
          width: 16,
          height: 16,
        },
      }),
      { kind: "item", id: "gregtech:circuit@2", iconPath: "/icons/integrated.png" },
    );

    expect(painted.iconPath).toBe("/icons/integrated.png");
    expect(painted.iconAtlas).toBeUndefined();
  });
});

describe("the shared clock", () => {
  it("runs one timer no matter how many slots are cycling", () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, "setInterval");

    const unsubscribes = Array.from({ length: 50 }, () => subscribeToAlternativeCycle(() => {}));

    expect(setInterval).toHaveBeenCalledTimes(1);
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  });

  it("stops ticking once the last slot unmounts", () => {
    vi.useFakeTimers();
    const clearInterval = vi.spyOn(globalThis, "clearInterval");

    const first = subscribeToAlternativeCycle(() => {});
    const second = subscribeToAlternativeCycle(() => {});
    first();
    expect(clearInterval).not.toHaveBeenCalled();

    second();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });

  it("advances every subscriber together", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeToAlternativeCycle(listener);

    vi.advanceTimersByTime(ALTERNATIVE_CYCLE_INTERVAL_MS * 3);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(getAlternativeCycleTick()).toBe(3);
    unsubscribe();
  });

  it("never starts a timer when the player asked for reduced motion", () => {
    vi.useFakeTimers();
    // jsdom ships no `matchMedia` at all, which is why the clock guards on it
    // being a function before asking.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const setInterval = vi.spyOn(globalThis, "setInterval");

    const unsubscribe = subscribeToAlternativeCycle(() => {});
    vi.advanceTimersByTime(ALTERNATIVE_CYCLE_INTERVAL_MS * 5);

    expect(setInterval).not.toHaveBeenCalled();
    expect(getAlternativeCycleTick()).toBe(0);
    unsubscribe();
  });

  it("wraps the face index across an arbitrary number of ticks", () => {
    const faces = getAlternativeCycleFaces(oredictInput());
    advanceAlternativeCycleForTests(7);

    // 7 ticks over 3 faces lands on the second one and keeps going.
    expect(faces[getAlternativeCycleTick() % faces.length].displayName).toBe(
      "Integrated Logic Circuit",
    );
  });
});
