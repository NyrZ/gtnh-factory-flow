"use client";

import { useState } from "react";
import { APP_VERSION } from "@/lib/version";
import { AccountMenu } from "./community/AccountMenu";
import { AppIdentity } from "./AppIdentity";
import { BoardActions } from "./BoardActions";
import { ChangelogDialog } from "./ChangelogDialog";
import { HeaderLinks } from "./HeaderLinks";

interface AppHeaderProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

/**
 * The one top bar for the whole app: title, version chip, game version, board
 * actions, account. The old Community page folded into the sidebar's Setups
 * tab, so there is no page switch up here anymore.
 */
export function AppHeader({ onLoadDatasetVersion }: AppHeaderProps) {
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
        {/* The pack picker rides up here beside the app version rather than at
            the head of the browser column. Two versions that are easy to
            confuse now sit together and read as a pair, and the column below
            gets a whole row of its height back. */}
        <span className="ml-3 h-5 w-px bg-line" aria-hidden />
        <AppIdentity onLoadDatasetVersion={onLoadDatasetVersion} />
      </h1>
      {isChangelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}
      <div className="flex items-center gap-2">
        <HeaderLinks />
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <BoardActions />
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}
