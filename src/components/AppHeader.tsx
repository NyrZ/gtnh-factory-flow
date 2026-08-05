"use client";

import { useState } from "react";
import { PencilRuler, Users } from "lucide-react";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { AccountMenu } from "./community/AccountMenu";
import { BoardActions } from "./BoardActions";
import { ChangelogDialog } from "./ChangelogDialog";

/**
 * The one top bar for the whole app. Title and account are always there;
 * the board actions only exist on the editor; the nav button flips
 * between Community and Editor so switching feels like changing panels, not
 * changing sites.
 */
export function AppHeader({ page }: { page: "editor" | "community" }) {
  const [isChangelogOpen, setChangelogOpen] = useState(false);

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
      <h1 className="flex items-center gap-2 text-sm font-bold tracking-tight">
        <span>
          GTNH <span className="text-cyan-500">Planner</span>
          {page === "community" ? (
            <span className="ml-2 font-medium text-fg-muted">Community</span>
          ) : null}
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
        {page === "editor" ? <BoardActions /> : null}
        {page === "editor" ? (
          <Link
            href="/community"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Users className="h-3.5 w-3.5" /> Community
          </Link>
        ) : (
          <Link
            href="/"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <PencilRuler className="h-3.5 w-3.5" /> Editor
          </Link>
        )}
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}
