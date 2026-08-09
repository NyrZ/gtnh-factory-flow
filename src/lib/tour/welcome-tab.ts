"use client";

import { useSyncExternalStore } from "react";

/**
 * The Welcome tab: whether it sits in the tab strip, and whether it is the one
 * showing.
 *
 * It is not a design. It rides at the head of the same strip because that is
 * where people already look for "what am I working on", and it covers the board
 * rather than replacing it, so nothing about the plan is unmounted while it is
 * up.
 *
 * `open` and `showOnStartup` persist; `active` deliberately does not. Coming
 * back to a page that had opened over your factory a week ago and finding it
 * still there reads as the app losing your work. So every visit starts on the
 * Welcome tab if the checkbox says so, and clicking a design puts it away for
 * the rest of the session.
 */
export interface WelcomeTabState {
  /** The tab is in the strip. */
  open: boolean;
  /** It is the tab being shown, covering the board. */
  active: boolean;
  /** Land here on every visit. Unticking it is how a regular gets rid of it. */
  showOnStartup: boolean;
}

const WELCOME_TAB_STORAGE_KEY = "gtnh-factory-flow-welcome-tab";

const CLOSED: WelcomeTabState = { open: false, active: false, showOnStartup: true };

let state: WelcomeTabState = CLOSED;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): WelcomeTabState {
  try {
    const raw = window.localStorage.getItem(WELCOME_TAB_STORAGE_KEY);
    if (!raw) {
      // Nobody has been here before: the tab is in the strip and open on it.
      return { open: true, active: true, showOnStartup: true };
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof WelcomeTabState, unknown>>;
    // An absent key takes the default, so a blob saved before a setting existed
    // does not silently opt out of it.
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    const open = flag(parsed.open, true);
    const showOnStartup = flag(parsed.showOnStartup, true);
    return { open, showOnStartup, active: open && showOnStartup };
  } catch {
    return { open: true, active: true, showOnStartup: true };
  }
}

function getSnapshot(): WelcomeTabState {
  if (!loaded) {
    loaded = true;
    state = readStored();
  }
  return state;
}

function getServerSnapshot(): WelcomeTabState {
  return CLOSED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(patch: Partial<WelcomeTabState>) {
  state = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(
      WELCOME_TAB_STORAGE_KEY,
      JSON.stringify({ open: state.open, showOnStartup: state.showOnStartup }),
    );
  } catch {
    // A full or blocked storage quota must never break the tab strip.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useWelcomeTab(): WelcomeTabState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Put the Welcome tab in the strip and show it. */
export function openWelcomeTab() {
  write({ open: true, active: true });
}

/** Step off it onto a design. The tab stays in the strip. */
export function leaveWelcomeTab() {
  if (!getSnapshot().active) {
    return;
  }
  write({ active: false });
}

/** The tab's own close button: out of the strip entirely. */
export function closeWelcomeTab() {
  write({ open: false, active: false });
}

export function setWelcomeOnStartup(showOnStartup: boolean) {
  write({ showOnStartup });
}
