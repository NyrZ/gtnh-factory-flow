"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MapPinPlus, Save, Search, Trash2, X } from "lucide-react";
import { BLUEPRINT_SORTS, sortBlueprints, type BlueprintSort } from "@/lib/blueprints/types";
import { snapPositionToGrid } from "@/lib/board-grid";
import { useCommunityUser } from "@/components/community/auth";
import { useBlueprintStore } from "@/store/blueprint-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library, owning the whole left column while the sidebar's
 * master switch points at it. Save the board's current selection as a named
 * sub-assembly, search and filter the shelf (pockets get their own filter —
 * a saved dimension is the blueprint most worth finding again), stamp one
 * back onto the board, delete. Cloud, per account; blueprints are immutable —
 * delete and save a new one.
 */
export function BlueprintPanel() {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const blueprints = useBlueprintStore((state) => state.blueprints);
  const sort = useBlueprintStore((state) => state.sort);
  const setSort = useBlueprintStore((state) => state.setSort);
  const hasLoaded = useBlueprintStore((state) => state.hasLoaded);
  const isLoading = useBlueprintStore((state) => state.isLoading);
  const isSaving = useBlueprintStore((state) => state.isSaving);
  const busyId = useBlueprintStore((state) => state.busyId);
  const error = useBlueprintStore((state) => state.error);
  const refresh = useBlueprintStore((state) => state.refresh);
  const reset = useBlueprintStore((state) => state.reset);
  const save = useBlueprintStore((state) => state.save);
  const load = useBlueprintStore((state) => state.load);
  const remove = useBlueprintStore((state) => state.remove);

  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [pocketsOnly, setPocketsOnly] = useState(false);

  useEffect(() => {
    if (!user) {
      reset();
      return;
    }
    void refresh();
  }, [user, refresh, reset]);

  const beginSave = () => {
    setDraftName(`Blueprint ${blueprints.length + 1}`);
  };

  const commitSave = async () => {
    const name = draftName?.trim();
    setDraftName(undefined);
    if (!name) {
      return;
    }
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, state.selectedBoardIds);
    if (!payload) {
      return;
    }
    await save(name, payload);
  };

  const placeBlueprint = async (blueprintId: string) => {
    const payload = await load(blueprintId);
    if (!payload) {
      return;
    }

    const state = useFactoryStore.getState();
    // Land the copy under the player's eye: shift the payload so the cards
    // it shows at its top level centre on where the board is looking now.
    const centre = payloadCentre(payload) ?? { x: 0, y: 0 };
    const viewCentre = state.flowViewportCenter ?? { x: 0, y: 0 };
    const offset = snapPositionToGrid({
      x: viewCentre.x - centre.x,
      y: viewCentre.y - centre.y,
    });
    const pastedIds = state.pasteBoardItems(payload, offset);
    if (pastedIds.length > 0) {
      // Arrives selected, ready to drag into place — same handoff as paste.
      state.setPendingBoardSelection(pastedIds);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sortBlueprints(blueprints, sort).filter(
    (blueprint) =>
      (!pocketsOnly || blueprint.pocketCount > 0) &&
      (normalizedQuery.length === 0 || blueprint.name.toLowerCase().includes(normalizedQuery)),
  );
  const isFiltering = pocketsOnly || normalizedQuery.length > 0;
  const canSave = Boolean(user) && selectedBoardIds.length > 0 && !isSaving;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-800 px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Blueprints
            {blueprints.length > 0 ? (
              <span className="ml-1 text-neutral-600">({blueprints.length})</span>
            ) : null}
          </span>
          {user ? (
            <button
              type="button"
              disabled={!canSave}
              onClick={beginSave}
              title={
                canSave
                  ? `Save the ${selectedBoardIds.length} selected card${selectedBoardIds.length === 1 ? "" : "s"} as a blueprint`
                  : "Select cards on the board first"
              }
              className="flex h-6 items-center gap-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-100 enabled:hover:border-cyan-500 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save selection
            </button>
          ) : null}
        </div>

        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blueprints..."
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear blueprint search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>

        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPocketsOnly(false)}
            className={[
              "h-7 shrink-0 whitespace-nowrap rounded-[4px] border px-2.5 text-xs font-medium",
              !pocketsOnly
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setPocketsOnly(true)}
            title="Only blueprints that carry a pocket dimension"
            className={[
              "h-7 shrink-0 whitespace-nowrap rounded-[4px] border px-2.5 text-xs font-medium",
              pocketsOnly
                ? "border-[#8d6fd1] bg-[#8d6fd1]/15 text-[#c9b8ec]"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            ✦ Pockets
          </button>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BlueprintSort)}
            aria-label="Sort blueprints"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            {Object.entries(BLUEPRINT_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {draftName !== undefined ? (
          <div className="mb-1.5 flex items-center gap-1">
            <input
              autoFocus
              value={draftName}
              maxLength={60}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void commitSave();
                }
                if (event.key === "Escape") {
                  setDraftName(undefined);
                }
              }}
              placeholder="Blueprint name"
              className="h-7 min-w-0 flex-1 rounded-[4px] border border-cyan-600 bg-[#17191d] px-1.5 text-xs text-neutral-100 outline-none"
            />
            <button
              type="button"
              onClick={() => void commitSave()}
              title="Save"
              aria-label="Save blueprint"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-100 hover:border-cyan-500"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDraftName(undefined)}
              title="Cancel"
              aria-label="Cancel saving blueprint"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {error ? <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{error}</p> : null}

        {isAuthLoading ? null : !user ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Sign in (top right) to keep a cloud library of sub-assemblies: select cards on the
            board, save them here, stamp them into any design later.
          </p>
        ) : isLoading && !hasLoaded ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading your blueprints…
          </p>
        ) : blueprints.length === 0 ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing saved yet. Select cards on the board, then hit Save above — the selection
            becomes a reusable sub-assembly. A selected pocket card saves the whole dimension.
          </p>
        ) : filtered.length === 0 && isFiltering ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            No blueprints match{pocketsOnly ? " — none of these carry a pocket" : ""}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((blueprint) => {
              const isBusy = busyId === blueprint.id;
              const confirming = confirmDeleteId === blueprint.id;
              return (
                <li
                  key={blueprint.id}
                  className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void placeBlueprint(blueprint.id)}
                      title="Place this blueprint on the board"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      {isBusy ? (
                        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />
                      ) : (
                        <MapPinPlus className="h-3.5 w-3.5 shrink-0 text-neutral-500 group-hover:text-cyan-300" />
                      )}
                      <span className="truncate text-xs text-neutral-100">{blueprint.name}</span>
                    </button>
                    {confirming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(undefined);
                          void remove(blueprint.id);
                        }}
                        className="shrink-0 rounded-[4px] border border-red-800 bg-red-950 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900"
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(blueprint.id)}
                        onBlur={() => setConfirmDeleteId(undefined)}
                        title="Delete this blueprint (blueprints can't be edited — delete and save a new version)"
                        aria-label={`Delete blueprint ${blueprint.name}`}
                        className="shrink-0 rounded-[4px] p-0.5 text-neutral-600 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 pl-5 text-[10px] text-neutral-500">
                    <span title={new Date(blueprint.createdAt).toLocaleString()}>
                      {formatRelativeDate(blueprint.createdAt)}
                    </span>
                    <span>
                      {blueprint.nodeCount + blueprint.storageCount} cards
                      {blueprint.machineCount > 0 ? ` · ${blueprint.machineCount} machines` : ""}
                      {blueprint.pocketCount > 0
                        ? ` · ✦ ${blueprint.pocketCount} pocket${blueprint.pocketCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Centre of what the payload shows at its own top level. */
function payloadCentre(payload: BoardClipboardPayload): { x: number; y: number } | undefined {
  const capturedPockets = new Set(payload.pockets.map((pocket) => pocket.id));
  const atRoot = (pocketId?: string) => pocketId === undefined || !capturedPockets.has(pocketId);
  const positions = [
    ...payload.nodes.filter((node) => atRoot(node.pocketId)).map((node) => node.position),
    ...payload.storages
      .filter((storage) => atRoot(storage.pocketId))
      .map((storage) => storage.position),
    ...payload.annotations
      .filter((annotation) => atRoot(annotation.pocketId))
      .map((annotation) => annotation.position),
    ...payload.pockets
      .filter((pocket) => atRoot(pocket.parentPocketId))
      .map((pocket) => pocket.position),
  ];
  if (positions.length === 0) {
    return undefined;
  }

  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return "";
  }
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 86400 * 30) {
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}
