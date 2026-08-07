"use client";

import { Bug } from "lucide-react";
import { APP_VERSION } from "@/lib/version";

const GITHUB_URL = "https://github.com/jackwrichards/gtnh-factory-flow";

/**
 * The planner's thread in the Greg Tech: New Horizons Discord. This is a
 * thread inside the pack's own server, not a server invite, so it only opens
 * for people who are already in there.
 */
const DISCORD_THREAD_URL =
  "https://discord.com/channels/181078474394566657/1531402304530682036";

/**
 * Straight into the bug report form rather than a blank issue box, with the
 * version chip's value already filled in: the first thing anyone triaging a
 * report needs is which build it happened on, and that is the detail players
 * are least likely to think of.
 */
const BUG_REPORT_URL = `${GITHUB_URL}/issues/new?template=bug_report.yml&version=${encodeURIComponent(
  APP_VERSION,
)}`;

/**
 * Source, chat and bug report, sitting in the header beside the board actions.
 *
 * These are the three places someone goes when the planner is not doing what
 * they want, so they live together and read as one group.
 */
export function HeaderLinks() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <HeaderLink href={GITHUB_URL} label="Source code on GitHub">
        <GithubMark />
      </HeaderLink>
      <HeaderLink href={DISCORD_THREAD_URL} label="Planner thread in the GTNH Discord">
        <DiscordMark />
      </HeaderLink>
      <HeaderLink href={BUG_REPORT_URL} label="Report a bug">
        <Bug className="h-3.5 w-3.5" />
      </HeaderLink>
    </div>
  );
}

function HeaderLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised hover:text-fg"
    >
      {children}
    </a>
  );
}

/* Brand marks are drawn inline: lucide dropped its brand icons, and these two
   are the logos people scan for rather than read, so a generic glyph would
   cost more than the markup does. */

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z" />
    </svg>
  );
}
