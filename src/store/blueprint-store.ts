"use client";

import { create } from "zustand";
import {
  deleteBlueprint,
  downloadBlueprint,
  getBlueprint,
  listBlueprints,
  listPublicBlueprints,
  publishBlueprint,
  saveBlueprint,
  updateBlueprint,
  voteBlueprint,
} from "@/lib/blueprints/client";
import { computeBlueprintIo } from "@/lib/blueprints/io-stats";
import type {
  BlueprintSort,
  BlueprintSummary,
  PublicBlueprintSort,
} from "@/lib/blueprints/types";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library, both shelves: the user's own cloud-stored
 * sub-assemblies and the public network everyone publishes to. Own
 * summaries load once per session (and after every mutation); the public
 * shelf pages server-side by sort and search; payloads are fetched only
 * when a blueprint is actually placed on the board.
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

  publicBlueprints: BlueprintSummary[];
  publicSort: PublicBlueprintSort;
  publicSearch: string;
  publicPage: number;
  publicHasMore: boolean;
  hasLoadedPublic: boolean;
  isPublicLoading: boolean;
  publicError?: string;

  /**
   * Pocket-picker mode: an owned blueprint is waiting for the user to click
   * a pocket on the board to overwrite it with. The board reads this to
   * wear the mode — banner up top, every pocket card ringed as a target.
   */
  overwritePicking?: { blueprintId: string; name: string };
  setOverwritePicking: (picking?: { blueprintId: string; name: string }) => void;

  setSort: (sort: BlueprintSort) => void;
  refresh: () => Promise<void>;
  /** Forget the private shelf (sign-out); the public network stays browsable. */
  reset: () => void;
  save: (name: string, payload: BoardClipboardPayload) => Promise<boolean>;
  load: (blueprintId: string) => Promise<BoardClipboardPayload | undefined>;
  remove: (blueprintId: string) => Promise<void>;
  /**
   * Edit in place — rename, overwrite the payload from a board pocket, or
   * both. The row keeps its id, votes, downloads and publish state.
   */
  update: (
    blueprintId: string,
    patch: { name?: string; payload?: BoardClipboardPayload; tags?: string[] },
  ) => Promise<boolean>;

  setPublicSort: (sort: PublicBlueprintSort) => void;
  setPublicSearch: (search: string) => void;
  refreshPublic: () => Promise<void>;
  loadMorePublic: () => Promise<void>;
  /** Publish to (or pull from) the network. Owner only, enforced server-side. */
  publish: (blueprintId: string, publish: boolean, description?: string) => Promise<boolean>;
  /** Cast/switch/retract a vote; counts land on whichever shelves show the row. */
  vote: (blueprintId: string, value: 1 | -1) => Promise<void>;
  /** Public payload fetch for placing — counts the download for non-authors. */
  downloadPublic: (blueprintId: string) => Promise<BoardClipboardPayload | undefined>;
}

export const useBlueprintStore = create<BlueprintStore>((set, get) => ({
  blueprints: [],
  sort: "newest",
  hasLoaded: false,
  isLoading: false,
  busyId: undefined,
  isSaving: false,
  error: undefined,

  publicBlueprints: [],
  publicSort: "top",
  publicSearch: "",
  publicPage: 0,
  publicHasMore: false,
  hasLoadedPublic: false,
  isPublicLoading: false,
  publicError: undefined,

  overwritePicking: undefined,
  setOverwritePicking: (overwritePicking) => set({ overwritePicking }),

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
      const created = await saveBlueprint(name, payload, computeBlueprintIo(payload));
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
  update: async (blueprintId, patch) => {
    set({ busyId: blueprintId, error: undefined });
    try {
      const updated = await updateBlueprint(blueprintId, {
        name: patch.name,
        payload: patch.payload,
        io: patch.payload ? computeBlueprintIo(patch.payload) : undefined,
        tags: patch.tags,
      });
      const apply = (list: BlueprintSummary[]) =>
        list.map((blueprint) =>
          blueprint.id === blueprintId ? { ...blueprint, ...updated } : blueprint,
        );
      set((state) => ({
        blueprints: apply(state.blueprints),
        publicBlueprints: apply(state.publicBlueprints),
      }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprint could not be updated." });
      return false;
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
        // Deleting takes a published copy off the network with it.
        publicBlueprints: state.publicBlueprints.filter(
          (blueprint) => blueprint.id !== blueprintId,
        ),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Blueprint could not be deleted." });
    } finally {
      set((state) => (state.busyId === blueprintId ? { busyId: undefined } : state));
    }
  },

  setPublicSort: (publicSort) => {
    if (publicSort === get().publicSort) {
      return;
    }
    set({ publicSort });
    void get().refreshPublic();
  },
  setPublicSearch: (publicSearch) => {
    if (publicSearch === get().publicSearch) {
      return;
    }
    set({ publicSearch });
    void get().refreshPublic();
  },
  refreshPublic: async () => {
    const { publicSort, publicSearch } = get();
    set({ isPublicLoading: true, publicError: undefined });
    try {
      const response = await listPublicBlueprints({
        sort: publicSort,
        search: publicSearch || undefined,
        page: 0,
      });
      set({
        publicBlueprints: response.blueprints,
        publicHasMore: Boolean(response.hasMore),
        publicPage: 0,
        hasLoadedPublic: true,
      });
    } catch (error) {
      set({
        publicError:
          error instanceof Error ? error.message : "Public blueprints could not be loaded.",
        // "Fetched at least once" even on failure — the panel's mount effect
        // keys off this, and leaving it false made an error retry forever.
        hasLoadedPublic: true,
      });
    } finally {
      set({ isPublicLoading: false });
    }
  },
  loadMorePublic: async () => {
    const { publicSort, publicSearch, publicPage, publicHasMore, isPublicLoading } = get();
    if (!publicHasMore || isPublicLoading) {
      return;
    }

    set({ isPublicLoading: true, publicError: undefined });
    try {
      const page = publicPage + 1;
      const response = await listPublicBlueprints({
        sort: publicSort,
        search: publicSearch || undefined,
        page,
      });
      set((state) => {
        // Pages can shift under votes; dedupe keeps a row from appearing twice.
        const seen = new Set(state.publicBlueprints.map((blueprint) => blueprint.id));
        return {
          publicBlueprints: [
            ...state.publicBlueprints,
            ...response.blueprints.filter((blueprint) => !seen.has(blueprint.id)),
          ],
          publicHasMore: Boolean(response.hasMore),
          publicPage: page,
        };
      });
    } catch (error) {
      set({
        publicError:
          error instanceof Error ? error.message : "Public blueprints could not be loaded.",
      });
    } finally {
      set({ isPublicLoading: false });
    }
  },
  publish: async (blueprintId, publish, description) => {
    set({ busyId: blueprintId, error: undefined });
    try {
      const updated = await publishBlueprint(blueprintId, publish, description);
      set((state) => ({
        blueprints: state.blueprints.map((blueprint) =>
          blueprint.id === blueprintId ? { ...blueprint, ...updated } : blueprint,
        ),
        // Unpublishing pulls the row off the shelf immediately; publishing
        // leaves the shelf to its own sort — it shows up on the next browse.
        publicBlueprints: publish
          ? state.publicBlueprints
          : state.publicBlueprints.filter((blueprint) => blueprint.id !== blueprintId),
      }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Publishing failed." });
      return false;
    } finally {
      set((state) => (state.busyId === blueprintId ? { busyId: undefined } : state));
    }
  },
  vote: async (blueprintId, value) => {
    try {
      const result = await voteBlueprint(blueprintId, value);
      const apply = (list: BlueprintSummary[]) =>
        list.map((blueprint) =>
          blueprint.id === blueprintId
            ? {
                ...blueprint,
                upvotes: result.upvotes,
                downvotes: result.downvotes,
                score: result.score,
                myVote: result.myVote,
              }
            : blueprint,
        );
      set((state) => ({
        publicBlueprints: apply(state.publicBlueprints),
        blueprints: apply(state.blueprints),
      }));
    } catch (error) {
      set({ publicError: error instanceof Error ? error.message : "Voting failed." });
    }
  },
  downloadPublic: async (blueprintId) => {
    set({ busyId: blueprintId, publicError: undefined });
    try {
      const detail = await downloadBlueprint(blueprintId);
      set((state) => ({
        publicBlueprints: state.publicBlueprints.map((blueprint) =>
          blueprint.id === blueprintId
            ? { ...blueprint, downloads: detail.downloads }
            : blueprint,
        ),
      }));
      return detail.payload;
    } catch (error) {
      set({
        publicError: error instanceof Error ? error.message : "Blueprint could not be loaded.",
      });
      return undefined;
    } finally {
      set((state) => (state.busyId === blueprintId ? { busyId: undefined } : state));
    }
  },
}));
