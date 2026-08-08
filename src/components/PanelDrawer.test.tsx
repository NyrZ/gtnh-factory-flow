// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelDrawer } from "./PanelDrawer";

/** One finger, from where it went down to where it ended up. */
function swipe(target: Element, from: [number, number], to: [number, number]) {
  fireEvent.touchStart(target, { touches: [{ clientX: from[0], clientY: from[1] }] });
  fireEvent.touchMove(target, { touches: [{ clientX: to[0], clientY: to[1] }] });
  fireEvent.touchEnd(target, { touches: [] });
}

function renderDrawer({
  side = "left" as "left" | "right",
  open = false,
  onOpen = vi.fn(),
  onClose = vi.fn(),
} = {}) {
  const result = render(
    <PanelDrawer side={side} label="items" open={open} onOpen={onOpen} onClose={onClose}>
      <p>panel</p>
    </PanelDrawer>,
  );
  return { ...result, onOpen, onClose };
}

/** The strip down the edge that owns the pull-it-open gesture. */
function edgeStrip(container: HTMLElement): Element {
  const strip = container.querySelector(".touch-none");
  if (!strip) {
    throw new Error("no edge strip rendered");
  }
  return strip;
}

describe("compact side panels", () => {
  beforeEach(() => {
    // jsdom lays nothing out, so the panel measures 0 and the drag would have
    // nothing to divide by: this is the width the class asks for on a phone.
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 390,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens on a tap of the handle", () => {
    const { onOpen } = renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Show items" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens when pulled in from the edge", () => {
    const { container, onOpen } = renderDrawer();

    swipe(edgeStrip(container), [4, 400], [300, 404]);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back closed when the pull stops short", () => {
    // Under 40% of the panel's width, letting go puts it back.
    const { container, onOpen } = renderDrawer();

    swipe(edgeStrip(container), [4, 400], [60, 404]);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores a pull the wrong way", () => {
    const { container, onOpen } = renderDrawer({ side: "right" });

    // Inwards from the RIGHT edge is leftwards; this is the mirror image.
    swipe(edgeStrip(container), [380, 400], [386, 404]);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores a drag that is mostly vertical", () => {
    // The panels are long scrolling lists. A gesture that is only a little
    // sideways is someone scrolling one of them.
    const { container, onOpen } = renderDrawer();

    swipe(edgeStrip(container), [4, 200], [60, 520]);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes when thrown back towards its own edge", () => {
    const { onClose } = renderDrawer({ open: true });

    swipe(screen.getByText("panel").parentElement as Element, [340, 400], [20, 408]);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when the throw stops short", () => {
    const { onClose } = renderDrawer({ open: true });

    swipe(screen.getByText("panel").parentElement as Element, [340, 400], [300, 408]);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the dimmed board behind it is tapped", () => {
    const { container, onClose } = renderDrawer({ open: true });
    const scrim = container.querySelector(".bg-black\\/50");

    fireEvent.click(scrim as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires once per drag, however far the finger keeps going", () => {
    const { container, onOpen } = renderDrawer();
    const strip = edgeStrip(container);

    fireEvent.touchStart(strip, { touches: [{ clientX: 4, clientY: 400 }] });
    fireEvent.touchMove(strip, { touches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchMove(strip, { touches: [{ clientX: 340, clientY: 400 }] });
    fireEvent.touchEnd(strip, { touches: [] });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("stays on screen while it slides out, rather than blinking away", () => {
    // The drag holds it mounted past the moment it closed, which is what there is
    // to animate: without that the panel would vanish and the transition would
    // have nothing left to run on.
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container, rerender } = renderDrawer({ open: true, onClose });
    const panel = screen.getByText("panel").parentElement as Element;

    swipe(panel, [340, 400], [20, 408]);
    expect(onClose).toHaveBeenCalledTimes(1);

    // What the parent does with that: the panel is now closed as far as the rest
    // of the app is concerned, and still on screen finishing its slide.
    rerender(
      <PanelDrawer side="left" label="items" open={false} onOpen={vi.fn()} onClose={onClose}>
        <p>panel</p>
      </PanelDrawer>,
    );
    expect(container.textContent).toContain("panel");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(container.textContent).not.toContain("panel");
    vi.useRealTimers();
  });
});
