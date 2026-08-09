import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browseHoveredPort,
  clearHoveredPortBrowse,
  setHoveredPortBrowse,
} from "./port-browse";

describe("the port row under the pointer", () => {
  beforeEach(() => {
    clearHoveredPortBrowse("card", "in:item:iron");
    clearHoveredPortBrowse("other", "in:item:iron");
  });

  it("opens the book for the row being pointed at", () => {
    const open = vi.fn();
    setHoveredPortBrowse({ nodeId: "card", handleId: "in:item:iron", open });

    expect(browseHoveredPort("uses")).toBe(true);
    expect(open).toHaveBeenCalledWith("uses");
  });

  it("leaves the key unclaimed when the pointer is on nothing", () => {
    expect(browseHoveredPort("recipes")).toBe(false);
  });

  it("keeps the row the pointer has arrived at, not the one it left", () => {
    // Enter on the next row fires before leave on the last one, so a leave that
    // cleared blindly would throw away the row actually under the pointer.
    const leaving = vi.fn();
    const arriving = vi.fn();
    setHoveredPortBrowse({ nodeId: "card", handleId: "in:item:iron", open: leaving });
    setHoveredPortBrowse({ nodeId: "other", handleId: "in:item:iron", open: arriving });
    clearHoveredPortBrowse("card", "in:item:iron");

    expect(browseHoveredPort("recipes")).toBe(true);
    expect(arriving).toHaveBeenCalledWith("recipes");
    expect(leaving).not.toHaveBeenCalled();
  });

  it("forgets a row once the pointer has left it", () => {
    const open = vi.fn();
    setHoveredPortBrowse({ nodeId: "card", handleId: "in:item:iron", open });
    clearHoveredPortBrowse("card", "in:item:iron");

    expect(browseHoveredPort("recipes")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
