import { describe, expect, it } from "vitest";
import {
  BOARD_CAMERA_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  cardRect,
  framingRect,
  rectCentre,
  zoomForRect,
} from "./board-camera";
import { RECIPE_NODE_WIDTH, STORAGE_NODE_HEIGHT, STORAGE_NODE_WIDTH } from "@/lib/board-grid";

const FIT = { padding: 0.2, minZoom: BOARD_MIN_ZOOM, maxZoom: BOARD_CAMERA_MAX_ZOOM };

describe("cardRect", () => {
  it("uses the measured size once the board has rendered the card", () => {
    const rect = cardRect(
      { id: "a", type: "recipeNode", position: { x: 100, y: 200 } },
      { width: 360, height: 500 },
    );
    expect(rect).toEqual({ x: 100, y: 200, width: 360, height: 500 });
  });

  it("falls back to the grid's size for a card that has never been on screen", () => {
    const rect = cardRect({ id: "a", type: "storageNode", position: { x: 0, y: 0 } });
    expect(rect.width).toBe(STORAGE_NODE_WIDTH);
    expect(rect.height).toBe(STORAGE_NODE_HEIGHT);
  });

  it("treats a zero measurement as no measurement", () => {
    // This is what an unmeasured card actually reports, and taking it at face
    // value is what collapsed a framing move onto a card's top-left corner.
    const rect = cardRect(
      { id: "a", type: "recipeNode", position: { x: 0, y: 0 } },
      { width: 0, height: 0 },
    );
    expect(rect.width).toBe(RECIPE_NODE_WIDTH);
    expect(rect.height).toBeGreaterThan(0);
  });

  it("keeps an annotation's own size", () => {
    const rect = cardRect({
      id: "a",
      type: "annotationNode",
      position: { x: 20, y: 40 },
      width: 280,
      height: 180,
    });
    expect(rect).toEqual({ x: 20, y: 40, width: 280, height: 180 });
  });
});

describe("framingRect", () => {
  it("spans every card, including the far one", () => {
    const rect = framingRect(
      [
        { id: "near", type: "recipeNode", position: { x: 0, y: 0 } },
        { id: "far", type: "recipeNode", position: { x: 9000, y: 4000 } },
      ],
      new Map([
        ["near", { width: 360, height: 200 }],
        ["far", { width: 360, height: 200 }],
      ]),
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 9360, height: 4200 });
  });

  it("is undefined for an empty board", () => {
    expect(framingRect([])).toBeUndefined();
  });

  it("centres on the middle of what it framed", () => {
    const rect = framingRect([
      { id: "a", type: "storageNode", position: { x: 100, y: 100 } },
    ]);
    expect(rectCentre(rect!)).toEqual({
      x: 100 + STORAGE_NODE_WIDTH / 2,
      y: 100 + STORAGE_NODE_HEIGHT / 2,
    });
  });
});

describe("zoomForRect", () => {
  it("zooms out far enough for a factory much wider than the screen", () => {
    const zoom = zoomForRect(
      { x: 0, y: 0, width: 6000, height: 3000 },
      { width: 1200, height: 800 },
      FIT,
    );
    expect(zoom).toBeCloseTo(1200 / (6000 * 1.2), 5);
    // The whole factory, padding included, is on screen at that zoom.
    expect(zoom * 6000 * 1.2).toBeLessThanOrEqual(1200 + 1e-6);
  });

  it("never zooms in past 1:1 for one small card", () => {
    const zoom = zoomForRect(
      { x: 0, y: 0, width: 140, height: 160 },
      { width: 1200, height: 800 },
      FIT,
    );
    expect(zoom).toBe(BOARD_CAMERA_MAX_ZOOM);
  });

  it("stops at the board's own floor rather than vanishing", () => {
    // A plan too big to fit even fully zoomed out still lands centred on
    // itself, which is the most the board's own zoom limit allows.
    const zoom = zoomForRect(
      { x: 0, y: 0, width: 400000, height: 400000 },
      { width: 1200, height: 800 },
      FIT,
    );
    expect(zoom).toBe(BOARD_MIN_ZOOM);
  });

  it("fits the tighter of the two axes", () => {
    const zoom = zoomForRect(
      { x: 0, y: 0, width: 2000, height: 4000 },
      { width: 1000, height: 1000 },
      FIT,
    );
    expect(zoom).toBeCloseTo(1000 / (4000 * 1.2), 5);
  });
});
