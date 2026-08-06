"use client";

import { create } from "zustand";
import {
  deleteBlueprint,
  getBlueprint,
  listBlueprints,
  saveBlueprint,
} from "@/lib/blueprints/client";
import type { BlueprintSort, BlueprintSummary } from "@/lib/blueprints/types";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library: per-user, cloud-stored sub-assemblies. Summaries
 * load once per session (and after every mutation); payloads are fetched
 * only when a blueprint is actually placed on the board.
 */
interface BlueprintStore {
  blueprints: BlueprintSummary[];
  sort: BlueprintSort;
  hasLoaded: boolean;
  isLoading: boolean;
  /** The blueprint currently saving/loading/deleting, for row spinners. */
  busyId?: string;
  isSaving: boolean;
  error?: string;
  setSort: (sort: BlueprintSort) => void;
  refresh: () => Promise<void>;
  /** Forget everything (sign-out): the library belongs to the account. */
  reset: () => void;
  save: (name: string, payload: BoardClipboardPayload) => Promise<boolean>;
  load: (blueprintId: string) => Promise<BoardClipboardPayload | undefined>;
  remove: (blueprintId: string) => Promise<void>;
}

export const useBlueprintStore = create<BlueprintStore>((set, get) => ({
  blueprints: [],
  sort: "newest",
  hasLoaded: false,
  isLoading: false,
  busyId: undefined,
  isSaving: false,
  error: undefined,
  setSort: (sort) => set({ sort }),
  refresh: async () => {
    if (get().isLoading) {
      return;
    }

    set({ isLoading: true, error: undefined });
    try {
      set({ blueprints: await listBlueprints(), hasLoaded: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprints could not be loaded." });
    } finally {
      set({ isLoading: false });
    }
  },
  reset: () =>
    set({ blueprints: [], hasLoaded: false, isLoading: false, error: undefined }),
  save: async (name, payload) => {
    set({ isSaving: true, error: undefined });
    try {
      const created = await saveBlueprint(name, payload);
      set((state) => ({ blueprints: [created, ...state.blueprints] }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprint could not be saved." });
      return false;
    } finally {
      set({ isSaving: false });
    }
  },
  load: async (blueprintId) => {
    set({ busyId: blueprintId, error: undefined });
    try {
      const detail = await getBlueprint(blueprintId);
      return detail.payload;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprint could not be loaded." });
      return undefined;
    } finally {
      set((state) => (state.busyId === blueprintId ? { busyId: undefined } : state));
    }
  },
  remove: async (blueprintId) => {
    set({ busyId: blueprintId, error: undefined });
    try {
      await deleteBlueprint(blueprintId);
      set((state) => ({
        blueprints: state.blueprints.filter((blueprint) => blueprint.id !== blueprintId),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprint could not be deleted." });
    } finally {
      set((state) => (state.busyId === blueprintId ? { busyId: undefined } : state));
    }
  },
}));
