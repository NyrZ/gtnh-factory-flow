"use client";

import type { ReactNode } from "react";

/**
 * The rounded grey panel the browser column's search and filter controls sit
 * in, above whatever list they are filtering.
 *
 * One component rather than the same class string written out per tab: Items,
 * Blueprints and Setups are three views of one column, and a search box that
 * is boxed on two of them and bare on the third reads as a different kind of
 * control rather than the same one.
 */
export function ControlsCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-2">
      {children}
    </div>
  );
}
