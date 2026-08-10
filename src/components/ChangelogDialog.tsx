"use client";

import { useEffect } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { startLesson } from "@/lib/tour/tour-state";
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
export function ChangelogDialog({
  onClose,
  entries = CHANGELOG,
  title = "What's new",
  subtitle,
  tone = "normal",
}: {
  onClose: () => void;
  /** Defaults to the whole list; the update popup passes only what is new. */
  entries?: ChangelogEntry[];
  title?: string;
  subtitle?: string;
  /**
   * `interrupt` is for the copy that ARRIVED rather than the one that was
   * asked for.
   *
   * A dialog you opened can sit politely over a board you can still read -
   * you know why it is there. One that appears by itself is competing with
   * whatever you came to do, and a light scrim just makes it look like a thing
   * to click past. So it takes the board away properly: much darker, and
   * blurred enough that there is nothing legible behind it to keep half an eye
   * on.
   */
  tone?: "normal" | "interrupt";
}) {
  const isInterrupt = tone === "interrupt";
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
      className={[
        "fixed inset-0 z-[120] grid place-items-center p-4",
        // The blur is deliberately modest. It is composited once over a board
        // that is not animating while a modal is up, so it costs nothing to
        // hold - but a heavy radius over a full-screen canvas is a real bill
        // on a weak machine, and 6px already removes every readable word.
        isInterrupt
          ? "bg-neutral-950/85 backdrop-blur-[6px]"
          : "bg-neutral-950/50",
      ].join(" ")}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new in GTNH Planner"
        className={[
          "max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded bg-surface p-5 compact:p-4",
          isInterrupt
            ? "border-2 border-cyan-700/70 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_24px_70px_rgba(0,0,0,0.75)]"
            : "border border-line-strong shadow-xl",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-xs text-fg-muted">
              {subtitle ?? `You're on v${APP_VERSION}`}
            </p>
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
          {entries.map((entry) => (
            <li
              key={entry.version}
              // A rule between releases, not a gap: at this width the eye needs
              // telling where one entry stops. Stacked on a narrow window,
              // where a rail plus a column of prose has no room to be two
              // things.
              //
              // `last:pb-0` pairs with `first:pt-0`. Without it the last entry
              // kept its own bottom padding on top of the dialog's, so the gap
              // under the list was twice the one above it and the whole sheet
              // looked bottom-heavy.
              className="grid gap-x-6 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div className="mb-1.5 sm:mb-0">
                <p
                  className={[
                    "text-lg font-black leading-none tabular-nums",
                    entry.version === APP_VERSION ? "text-cyan-300" : "text-fg",
                  ].join(" ")}
                >
                  v{entry.version}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-fg-muted">
                  {formatEntryDate(entry.date)}
                </p>
                {entry.version === APP_VERSION ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-cyan-500/70 bg-cyan-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-cyan-200">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    You are here
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                {/* The headline is the entry's title, so it reads like one. It
                    used to be set smaller and dimmer than the notes under it,
                    which made every release look like a list of bullets with a
                    caption nobody's eye stopped on. */}
                <h3 className="text-base font-bold leading-snug text-fg">{entry.headline}</h3>
                <ul className="mt-2 space-y-2">
                  {entry.notes.map((note) => (
                    <li key={note} className="flex gap-2 text-sm leading-relaxed text-fg-muted">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                      <span>{renderEmphasis(note)}</span>
                    </li>
                  ))}
                </ul>
                {/* Some things are only understood by doing them, so a release
                    that adds a tour offers it right here rather than
                    describing it and hoping. A release that also carries a
                    WARNING puts the two in one block: a caution the reader
                    believes and a button that answers it, side by side, rather
                    than a worrying sentence and an unrelated-looking link. */}
                {entry.warning || (entry.actions && entry.actions.length > 0) ? (
                  <div
                    className={[
                      "mt-3 rounded border p-3",
                      entry.warning
                        ? "border-amber-600 bg-amber-500/15"
                        : "border-transparent bg-transparent p-0",
                    ].join(" ")}
                  >
                    {entry.warning ? (
                      <div className="mb-2.5 flex items-start gap-2.5">
                        <AlertTriangle
                          className="mt-px h-4 w-4 shrink-0 text-amber-400"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-wide text-amber-300">
                            Heads up
                          </p>
                          {/* Lit in the callout's OWN colour. The cyan the
                              notes use is the app's "this is a link, this is
                              fine" colour, and inside an amber warning it read
                              as a different message sitting in the middle of
                              this one. */}
                          <p className="mt-1 text-sm leading-relaxed text-amber-100/90">
                            {renderEmphasis(entry.warning, "text-amber-200")}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {(entry.actions ?? []).map((action) =>
                        action.lessonId ? (
                          <button
                            key={action.label}
                            type="button"
                            onClick={() => {
                              onClose();
                              startLesson(action.lessonId!);
                            }}
                            className={[
                              "rounded border px-3 py-1.5 text-xs font-bold",
                              entry.warning
                                ? "border-amber-400 bg-amber-500/25 text-amber-100 hover:bg-amber-500/40"
                                : "border-cyan-500/60 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25",
                            ].join(" ")}
                          >
                            {action.label} ▸
                          </button>
                        ) : (
                          <a
                            key={action.label}
                            href={action.href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-line-strong px-3 py-1.5 text-xs font-bold text-fg-subtle hover:bg-surface-raised"
                          >
                            {action.label}
                          </a>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * `*asterisks*` come out lit, the same convention the tour cards use.
 *
 * Release notes are one paragraph after another of even grey, and a reader
 * skimming for the thing that affects them has nothing to catch on. Marking
 * the two or three words that carry each line - the state a card now shows,
 * the button that appeared - turns a wall into something scannable, without
 * pulling in a markdown renderer for one piece of syntax.
 */
function renderEmphasis(text: string, litClass = "text-cyan-200"): React.ReactNode[] {
  return text.split(/\*([^*]+)\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className={`font-bold ${litClass}`}>
        {part}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function formatEntryDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
