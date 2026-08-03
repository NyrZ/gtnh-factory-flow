"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

/**
 * What's new, opened by the version chip in the header. Same centered-overlay
 * shape as the share/preview dialogs, kept deliberately short: the newest
 * release first, a headline and a couple of plain-English lines each.
 */
export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-neutral-950/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new in GTNH Planner"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded border border-line-strong bg-surface p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">What&apos;s new</h2>
            <p className="text-xs text-fg-muted">You&apos;re on v{APP_VERSION}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-4">
          {CHANGELOG.map((entry) => (
            <li key={entry.version}>
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{entry.headline}</h3>
                <span className="text-[11px] tabular-nums text-fg-muted">
                  v{entry.version} · {formatEntryDate(entry.date)}
                </span>
              </div>
              <ul className="mt-1 space-y-1">
                {entry.notes.map((note) => (
                  <li key={note} className="flex gap-2 text-sm leading-snug text-fg-muted">
                    <span aria-hidden className="text-cyan-500">
                      •
                    </span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function formatEntryDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
