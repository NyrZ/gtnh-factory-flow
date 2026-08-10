// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/version", () => ({ APP_VERSION: "1.46.0" }));
vi.mock("@/lib/changelog", () => ({
  CHANGELOG: [
    { version: "1.46.0", date: "2026-08-10", headline: "c", notes: [] },
    { version: "1.45.0", date: "2026-08-10", headline: "b", notes: [] },
    // The one that changed what a saved plan means.
    { version: "1.44.0", date: "2026-08-09", headline: "a", notes: [], warning: "setups differ" },
  ],
}));

const { compareVersions, markVersionSeen, needsInterrupting, unseenEntries } = await import(
  "@/lib/whats-new"
);

const KEY = "gtnh-factory-flow.last-seen-version.v1";

describe("compareVersions", () => {
  it("orders by number, not by string", () => {
    // The reason this is not localeCompare: "1.9.0" sorts ABOVE "1.10.0" as
    // text, so a tenth minor release would silently show nobody anything.
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.46.0", "1.46.0")).toBe(0);
    expect(compareVersions("1.44.0", "1.45.0")).toBeLessThan(0);
    expect(compareVersions("1.46", "1.46.0")).toBe(0);
  });
});

describe("unseenEntries", () => {
  beforeEach(() => window.localStorage.clear());

  it("says nothing on a first visit, and remembers where they came in", () => {
    // Someone new has no idea what any of it used to do, so a list of changes
    // is noise in front of the thing they came for.
    expect(unseenEntries()).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBe("1.46.0");
  });

  it("returns only what shipped since they last looked", () => {
    window.localStorage.setItem(KEY, "1.44.0");
    expect(unseenEntries().map((entry) => entry.version)).toEqual(["1.46.0", "1.45.0"]);
  });

  it("says nothing when they are already current", () => {
    window.localStorage.setItem(KEY, "1.46.0");
    expect(unseenEntries()).toEqual([]);
  });

  it("says nothing to somebody ahead of this bundle", () => {
    // A tab on the new version and a stamp from a newer one: possible while a
    // deploy is rolling out across servers, and showing a negative diff would
    // be nonsense.
    window.localStorage.setItem(KEY, "1.47.0");
    expect(unseenEntries()).toEqual([]);
  });

  it("interrupts only for a release that changes what a plan means", () => {
    // Missed the breaking one: worth a dialog.
    window.localStorage.setItem(KEY, "1.43.0");
    expect(needsInterrupting(unseenEntries())).toBe(true);

    // Already had it, and only quiet releases since: the dot on the button is
    // the whole announcement. A modal on every bump is how a product teaches
    // people to dismiss it without reading.
    window.localStorage.setItem(KEY, "1.44.0");
    expect(unseenEntries()).toHaveLength(2);
    expect(needsInterrupting(unseenEntries())).toBe(false);
  });

  it("only marks seen when the notes are dismissed", () => {
    window.localStorage.setItem(KEY, "1.44.0");
    expect(unseenEntries()).toHaveLength(2);
    // Still unread: closing the tab mid-read must not lose them.
    expect(window.localStorage.getItem(KEY)).toBe("1.44.0");
    markVersionSeen();
    expect(unseenEntries()).toEqual([]);
  });
});
