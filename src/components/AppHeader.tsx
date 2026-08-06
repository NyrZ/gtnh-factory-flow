"use client";

import { useState } from "react";
import { APP_VERSION } from "@/lib/version";
import { AccountMenu } from "./community/AccountMenu";
import { BoardActions } from "./BoardActions";
import { ChangelogDialog } from "./ChangelogDialog";

/**
 * The one top bar for the whole app: title, version chip, board actions,
 * account. The old Community page folded into the sidebar's Setups tab, so
 * there is no page switch up here anymore.
 */
export function AppHeader() {
  const [isChangelogOpen, setChangelogOpen] = useState(false);

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
      <h1 className="flex items-center gap-2 text-sm font-bold tracking-tight">
        <span>
          GTNH <span className="text-cyan-500">Planner</span>
        </span>
        <button
          type="button"
          onClick={() => setChangelogOpen(true)}
          title="What's new in GTNH Planner"
          aria-label={`Version ${APP_VERSION} — see what's new`}
          className="rounded border border-line px-1 py-px text-[10px] font-semibold leading-none text-fg-muted tabular-nums hover:border-cyan-600 hover:text-cyan-500"
        >
          v{APP_VERSION}
        </button>
      </h1>
      {isChangelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}
      <div className="flex items-center gap-2">
        <BoardActions />
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}
