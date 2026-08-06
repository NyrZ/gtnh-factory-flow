"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  MapPinPlus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { BLUEPRINT_SORTS, sortBlueprints, type BlueprintSort } from "@/lib/blueprints/types";
import { snapPositionToGrid } from "@/lib/board-grid";
import { useCommunityUser } from "@/components/community/auth";
import { useBlueprintStore } from "@/store/blueprint-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library: the lower half of the left sidebar. Save the
 * board's current selection as a named sub-assembly, stamp one back onto the
 * board (it lands selected, at the viewport centre), sort, delete. Cloud,
 * per account; blueprints are immutable — delete and save a new one.
 */
export function BlueprintPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
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

  const sorted = sortBlueprints(blueprints, sort);
  const canSave = Boolean(user) && selectedBoardIds.length > 0 && !isSaving;

  return (
    <div
      className={[
        "flex flex-col border-t border-neutral-700 bg-[#2a2d33]",
        collapsed ? "shrink-0" : "min-h-0 flex-1 basis-0",
      ].join(" ")}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 px-0.5 text-left text-[10px] font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          Blueprints
          {blueprints.length > 0 ? (
            <span className="text-neutral-600">({blueprints.length})</span>
          ) : null}
        </button>
        {!collapsed && user ? (
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BlueprintSort)}
            aria-label="Sort blueprints"
            className="h-6 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-[11px] text-neutral-100 outline-none"
          >
            {Object.entries(BLUEPRINT_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : null}
        {!collapsed && user ? (
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
            Save
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <div className="pb-1.5" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
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
          ) : sorted.length === 0 ? (
            <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
              Nothing saved yet. Select cards on the board, then hit Save above — the selection
              becomes a reusable sub-assembly.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sorted.map((blueprint) => {
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
                        {blueprint.pocketCount > 0 ? ` · ${blueprint.pocketCount} pockets` : ""}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
