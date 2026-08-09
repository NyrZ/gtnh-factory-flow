"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";
import { APP_VERSION } from "@/lib/version";

/**
 * What's new, opened by the version chip in the header and the button on the
 * Welcome tab. Newest release first, a headline and a couple of plain-English
 * lines each.
 *
 * The VERSION leads. It is the thing a reader arrives holding - the chip in the
 * header told them theirs, a bug report asks for it - so each entry is anchored
 * on its number and date in a rail down the left, with the headline beside it
 * as a caption rather than as the entry's title. Wide enough for that rail and
 * a full line of notes beside it; the release notes are prose, and prose in a
 * narrow column is a lot of scrolling.
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
        className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded border border-line-strong bg-surface p-5 shadow-xl compact:p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
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

        <ul>
          {CHANGELOG.map((entry) => (
            <li
              key={entry.version}
              // A rule between releases, not a gap: at this width the eye needs
              // telling where one entry stops. Stacked on a narrow window,
              // where a rail plus a column of prose has no room to be two
              // things.
              className="grid gap-x-6 border-t border-line py-4 first:border-t-0 first:pt-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div className="mb-1.5 sm:mb-0">
                <p
                  className={[
                    "text-lg font-bold leading-none tabular-nums",
                    entry.version === APP_VERSION ? "text-cyan-400" : "text-fg",
                  ].join(" ")}
                >
                  v{entry.version}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-fg-muted">
                  {formatEntryDate(entry.date)}
                </p>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium leading-snug text-fg-subtle">
                  {entry.headline}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {entry.notes.map((note) => (
                    <li key={note} className="flex gap-2 text-sm leading-snug text-fg-muted">
                      <span aria-hidden className="text-cyan-500">
                        •
                      </span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
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
