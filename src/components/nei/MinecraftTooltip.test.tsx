// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinecraftTooltip, WHEEL_STEPS_IN_PLACE_ATTRIBUTE } from "./MinecraftTooltip";

describe("MinecraftTooltip", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("clears an open tooltip when the viewport is zoomed", async () => {
    render(
      <MinecraftTooltip label="Tooltip line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.wheel(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });

  it("keeps the tooltip while a slot uses the wheel to step through its items", async () => {
    // Scrolling a rotating slot changes what the slot shows without moving it, so
    // the tip has to stay put and re-label itself rather than blink out on every
    // notch while you are reading which item you landed on.
    render(
      <MinecraftTooltip label="Oak Log">
        <button type="button" {...{ [WHEEL_STEPS_IN_PLACE_ATTRIBUTE]: "" }}>
          Hover target
        </button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Hover target" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Oak Log")).toBeTruthy();

    fireEvent.wheel(target);

    expect(screen.getByText("Oak Log")).toBeTruthy();
  });

  it("clears an open tooltip when panning starts", async () => {
    render(
      <MinecraftTooltip label="Tooltip line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.pointerDown(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });
});
