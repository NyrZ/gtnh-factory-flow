"use client";

/**
 * The link you send someone: `/?plan=<community id>`, which opens that setup in
 * a tab of its own.
 *
 * One module because four places care about it: the two Share buttons that
 * write the link, the import that runs on arrival, and the Welcome tab, which
 * has to know that this page load already has somewhere to be.
 */
const SHARED_PLAN_PARAM = "plan";

/** The link to put on someone's clipboard. */
export function sharedPlanLink(planId: string): string {
  return `${window.location.origin}/?${SHARED_PLAN_PARAM}=${encodeURIComponent(planId)}`;
}

/** The setup this page load was opened for, if the address names one. */
export function readSharedPlanId(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get(SHARED_PLAN_PARAM) || undefined;
  } catch {
    // Rendered on the server, or a test that stubs a window without a location:
    // either way, this is not a visit that came in on a shared link.
    return undefined;
  }
}

/**
 * Takes the id back out of the address bar once the setup is open, so a reload
 * does not import a second copy of it.
 */
export function forgetSharedPlanId(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    params.delete(SHARED_PLAN_PARAM);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  } catch {
    // A tidy address bar is never worth breaking the import for.
  }
}
