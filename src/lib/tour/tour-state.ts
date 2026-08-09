"use client";

import { useSyncExternalStore } from "react";
import { findLesson } from "./lessons";

/**
 * Which lesson is being walked, and which lessons have been finished.
 *
 * Same shape as `board-view.ts`: module state read through
 * useSyncExternalStore, so the server can render "no tour running" without a
 * hydration mismatch and nothing has to set state from inside an effect. Only
 * the finished list is written to localStorage. A tour half walked is not worth
 * resuming a week later, and starting a page load inside a spotlight would be
 * alarming.
 */
export interface TourState {
  /** The lesson being walked, if any. */
  lessonId?: string;
  /** Which step of it, from zero. */
  stepIndex: number;
  /** Lessons walked all the way to the last step. */
  completedLessonIds: string[];
}

const COMPLETED_STORAGE_KEY = "gtnh-factory-flow-tours-done";

const IDLE: TourState = { stepIndex: 0, completedLessonIds: [] };

let state: TourState = IDLE;
let loaded = false;
const listeners = new Set<() => void>();

function readCompleted(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function getSnapshot(): TourState {
  if (!loaded) {
    loaded = true;
    state = { ...IDLE, completedLessonIds: readCompleted() };
  }
  return state;
}

function getServerSnapshot(): TourState {
  return IDLE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: TourState) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function rememberCompleted(completedLessonIds: string[]) {
  try {
    window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(completedLessonIds));
  } catch {
    // A full or blocked storage quota must never break the tour.
  }
}

export function useTourState(): TourState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function startLesson(lessonId: string) {
  if (!findLesson(lessonId)) {
    return;
  }
  publish({ ...getSnapshot(), lessonId, stepIndex: 0 });
}

/** Leave the tour where it stands. Nothing is marked finished. */
export function endLesson() {
  const current = getSnapshot();
  if (!current.lessonId) {
    return;
  }
  publish({ ...current, lessonId: undefined, stepIndex: 0 });
}

export function goToStep(stepIndex: number) {
  const current = getSnapshot();
  const lesson = findLesson(current.lessonId);
  if (!lesson) {
    return;
  }

  // Past the last step means the lesson is done. Before the first step is
  // simply the first step.
  if (stepIndex >= lesson.steps.length) {
    finishLesson();
    return;
  }

  publish({ ...current, stepIndex: Math.max(0, stepIndex) });
}

/**
 * Mark the running lesson finished and come down - or, with `nextLessonId`,
 * carry straight on into the one it offers.
 */
export function finishLesson(nextLessonId?: string) {
  const current = getSnapshot();
  const lesson = findLesson(current.lessonId);
  if (!lesson) {
    return;
  }

  const completedLessonIds = current.completedLessonIds.includes(lesson.id)
    ? current.completedLessonIds
    : [...current.completedLessonIds, lesson.id];
  rememberCompleted(completedLessonIds);

  const next = findLesson(nextLessonId);
  publish({ completedLessonIds, lessonId: next?.id, stepIndex: 0 });
}

export function nextStep() {
  goToStep(getSnapshot().stepIndex + 1);
}

export function previousStep() {
  goToStep(getSnapshot().stepIndex - 1);
}
