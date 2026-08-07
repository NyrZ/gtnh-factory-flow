// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { readBoardViewSnapshot, writeBoardView } from "@/components/flow/board-view";
import { getActiveRateUnit } from "./model/rate-unit";
import type { PlanViewState } from "./model/types";
import { applyPlanView, capturePlanView } from "./plan-view";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "./workspace-view";
import { useFactoryStore } from "@/store/factory-store";

describe("applying a shared plan's view", () => {
  beforeEach(() => {
    writeBoardView({
      canvasPattern: "dots",
      lineHeatMode: false,
      calmMode: false,
      glanceMode: "identity",
      heatmapMode: false,
    });
    writeWorkspaceView({
      leftPanelOpen: true,
      rightPanelOpen: true,
      showHiddenResources: false,
      favouritesOnly: false,
      trendsOpen: true,
      hiddenResourceKeys: [],
      favouriteResourceKeys: [],
    });
    useFactoryStore.getState().setRateUnit("second");
  });

  it("puts the author's whole arrangement on screen", () => {
    applyPlanView({
      canvasPattern: "cross",
      lineHeatMode: true,
      calmMode: true,
      glanceMode: "status",
      rateUnit: "hour",
      leftPanelOpen: false,
      showHiddenResources: true,
      trendsOpen: false,
      hiddenResourceKeys: ["item:cobblestone"],
      favouriteResourceKeys: ["item:iron_ingot"],
    });

    const board = readBoardViewSnapshot();
    const workspace = readWorkspaceViewSnapshot();

    expect(board.canvasPattern).toBe("cross");
    expect(board.lineHeatMode).toBe(true);
    expect(board.calmMode).toBe(true);
    expect(board.glanceMode).toBe("status");
    // Derived rather than carried: the heatmap rides the status glance view.
    expect(board.heatmapMode).toBe(true);
    expect(workspace.leftPanelOpen).toBe(false);
    expect(workspace.showHiddenResources).toBe(true);
    expect(workspace.trendsOpen).toBe(false);
    expect(workspace.hiddenResourceKeys).toEqual(["item:cobblestone"]);
    expect(workspace.favouriteResourceKeys).toEqual(["item:iron_ingot"]);
    expect(getActiveRateUnit()).toBe("hour");
  });

  it("leaves settings the plan says nothing about alone", () => {
    writeBoardView({ calmMode: true });
    applyPlanView({ rateUnit: "minute" });

    expect(getActiveRateUnit()).toBe("minute");
    // Untouched, because the plan never mentioned it.
    expect(readBoardViewSnapshot().calmMode).toBe(true);
  });

  it("does nothing at all for a plan with no view", () => {
    applyPlanView(undefined);

    expect(readBoardViewSnapshot().canvasPattern).toBe("dots");
    expect(getActiveRateUnit()).toBe("second");
  });

  it("drops values this build does not recognise", () => {
    // A plan from a newer build must not leave the board in a state no control
    // can undo.
    applyPlanView({ canvasPattern: "hexagons", glanceMode: "x-ray" } as PlanViewState);

    expect(readBoardViewSnapshot().canvasPattern).toBe("dots");
    expect(readBoardViewSnapshot().glanceMode).toBe("identity");
  });

  it("never lands the viewer with a resource both starred and hidden", () => {
    applyPlanView({
      favouriteResourceKeys: ["item:iron_ingot"],
      hiddenResourceKeys: ["item:iron_ingot", "item:cobblestone"],
    });

    const workspace = readWorkspaceViewSnapshot();
    expect(workspace.favouriteResourceKeys).toEqual(["item:iron_ingot"]);
    // A starred row shows no hide button, so a key in both would be stuck.
    expect(workspace.hiddenResourceKeys).toEqual(["item:cobblestone"]);
  });

  it("captures what it applies, so a re-share carries the same arrangement", () => {
    const view: PlanViewState = {
      canvasPattern: "none",
      calmMode: true,
      glanceMode: "status",
      rateUnit: "minute",
      rightPanelOpen: false,
      favouritesOnly: true,
      hiddenResourceKeys: ["fluid:water"],
      favouriteResourceKeys: ["item:tin"],
    };
    applyPlanView(view);

    expect(capturePlanView()).toMatchObject(view);
  });
});
