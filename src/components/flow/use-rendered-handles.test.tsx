// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRenderedHandles } from "./use-rendered-handles";

const updateNodeInternals = vi.fn();

vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => updateNodeInternals,
}));

function Card({ nodeId, handleIds }: { nodeId: string; handleIds: string[] }) {
  useRenderedHandles(nodeId, handleIds);
  return <div data-testid="card">{handleIds.join(",")}</div>;
}

describe("useRenderedHandles", () => {
  beforeEach(() => {
    updateNodeInternals.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it("leaves the mount measurement alone", () => {
    render(<Card nodeId="node-a" handleIds={["output:item:fish"]} />);

    // React Flow measures on mount already; a board of 200 cards must not pay
    // 200 more measurements just to load.
    expect(updateNodeInternals).not.toHaveBeenCalled();
  });

  it("re-measures when a card swaps its ports at an unchanged size", () => {
    const view = render(
      <Card
        nodeId="node-a"
        handleIds={["input:item:custom-any", "output:item:custom-any"]}
      />,
    );

    // A custom rate node adopting a resource: the two universal sockets are
    // replaced by the real port. Without the re-measure React Flow keeps
    // bounds for `custom-any` and drops every edge naming the new id.
    view.rerender(<Card nodeId="node-a" handleIds={["output:item:fish"]} />);

    expect(updateNodeInternals).toHaveBeenCalledTimes(1);
    expect(updateNodeInternals).toHaveBeenCalledWith("node-a");
  });

  it("stays quiet on the solver ticks that leave the ports alone", () => {
    const view = render(<Card nodeId="node-a" handleIds={["output:item:fish"]} />);

    // Cards re-render on every solve. Only the id SET matters.
    view.rerender(<Card nodeId="node-a" handleIds={["output:item:fish"]} />);
    view.rerender(<Card nodeId="node-a" handleIds={["output:item:fish"]} />);

    expect(updateNodeInternals).not.toHaveBeenCalled();
  });

  it("notices a port order change, which moves every row a wire docks on", () => {
    const view = render(
      <Card nodeId="node-a" handleIds={["input:item:fish", "input:fluid:water"]} />,
    );

    view.rerender(
      <Card nodeId="node-a" handleIds={["input:fluid:water", "input:item:fish"]} />,
    );

    expect(updateNodeInternals).toHaveBeenCalledTimes(1);
  });
});
