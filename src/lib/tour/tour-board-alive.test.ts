import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import { closeBoundaries } from "@/lib/solver/close-boundaries";
import { calculateThroughput } from "@/lib/solver";
import { findUnwiredNodeIds } from "@/components/flow/node-verdict";

/**
 * The tour teaches you to read a factory, which only works if the factory it
 * opens is running.
 *
 * Every plan worth teaching from was authored before a plan had to declare its
 * own edges, so raw ingredients arrive from nowhere and the product goes
 * nowhere. Under the closed rules that is a board of machines all reading NO
 * WIRES at 0%, which teaches nothing at all. `fetchTourProject` runs both its
 * routes through `closeBoundaries`; this is the guard on the fallback one,
 * which is the only route a test can reach without the network.
 */
describe("the tour board", () => {
  it("is dead on arrival without closed boundaries", () => {
    const raw = loadBiodieselDemoProject();
    const result = calculateThroughput(raw, { generatedAt: "fixed" });
    expect(findUnwiredNodeIds(raw, result).length).toBeGreaterThan(0);
  });

  it("runs once its boundaries are declared", () => {
    const closed = closeBoundaries(loadBiodieselDemoProject());
    const result = calculateThroughput(closed, { generatedAt: "fixed" });

    expect(findUnwiredNodeIds(closed, result)).toEqual([]);
    // And actually turning over, not merely wired: a board of zeroes would
    // pass the check above and still teach nothing.
    const running = closed.nodes.filter(
      (node) => (result.nodes[node.id]?.utilization ?? 0) > 0.001,
    );
    expect(running.length).toBe(closed.nodes.length);
  });

  it("gives every added drawer its own place on the board", () => {
    // Piled on the origin they would sit on top of one another, which on a
    // lesson about reading the canvas is worse than not adding them.
    const closed = closeBoundaries(loadBiodieselDemoProject());
    const added = (closed.storages ?? []).filter((storage) => storage.id.startsWith("boundary-"));
    expect(added.length).toBeGreaterThan(0);
    const spots = new Set(added.map((storage) => `${storage.position.x},${storage.position.y}`));
    expect(spots.size).toBe(added.length);
  });
});
