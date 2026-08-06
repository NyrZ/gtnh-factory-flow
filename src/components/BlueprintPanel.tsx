"use client";

import { useEffect, useState } from "react";
import {
  ArrowBigDown,
  ArrowBigUp,
  Download,
  Globe,
  LoaderCircle,
  MapPinPlus,
  Save,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  BLUEPRINT_SORTS,
  PUBLIC_BLUEPRINT_SORTS,
  sortBlueprints,
  type BlueprintSort,
  type BlueprintSummary,
  type PublicBlueprintSort,
} from "@/lib/blueprints/types";
import { snapPositionToGrid } from "@/lib/board-grid";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useCommunityUser } from "@/components/community/auth";
import { useBlueprintStore } from "@/store/blueprint-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library, owning the whole left column while the sidebar's
 * master switch points at it. Two shelves: MINE is the account's private
 * collection (save a selection, publish the good ones); PUBLIC is the
 * network — everyone's published sub-assemblies, searchable, sortable,
 * voteable, placeable. Payloads are immutable either way: delete and save
 * a new one, never edit.
 */
export function BlueprintPanel() {
  const { user } = useCommunityUser();
  const refresh = useBlueprintStore((state) => state.refresh);
  const reset = useBlueprintStore((state) => state.reset);
  const [scope, setScope] = useState<"mine" | "public">("mine");

  useEffect(() => {
    if (!user) {
      reset();
      return;
    }
    void refresh();
  }, [user, refresh, reset]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-neutral-800 px-3 py-2">
        <button
          type="button"
          onClick={() => setScope("mine")}
          className={[
            "flex h-7 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
            scope === "mine"
              ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
              : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
          ].join(" ")}
        >
          <User className="h-3.5 w-3.5" />
          Mine
        </button>
        <button
          type="button"
          onClick={() => setScope("public")}
          className={[
            "flex h-7 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
            scope === "public"
              ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
              : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
          ].join(" ")}
        >
          <Globe className="h-3.5 w-3.5" />
          Public
        </button>
      </div>
      {scope === "mine" ? <MineShelf /> : <PublicShelf />}
    </div>
  );
}

/** Stamp a fetched payload onto the board, centred on the current view. */
function placePayload(payload: BoardClipboardPayload) {
  const state = useFactoryStore.getState();
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
}

// ---------------------------------------------------------------------------
// MINE: the private collection, with publishing.
// ---------------------------------------------------------------------------

function MineShelf() {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const blueprints = useBlueprintStore((state) => state.blueprints);
  const sort = useBlueprintStore((state) => state.sort);
  const setSort = useBlueprintStore((state) => state.setSort);
  const hasLoaded = useBlueprintStore((state) => state.hasLoaded);
  const isLoading = useBlueprintStore((state) => state.isLoading);
  const isSaving = useBlueprintStore((state) => state.isSaving);
  const busyId = useBlueprintStore((state) => state.busyId);
  const error = useBlueprintStore((state) => state.error);
  const save = useBlueprintStore((state) => state.save);
  const load = useBlueprintStore((state) => state.load);
  const remove = useBlueprintStore((state) => state.remove);
  const publish = useBlueprintStore((state) => state.publish);

  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>(undefined);
  const [publishDraftId, setPublishDraftId] = useState<string | undefined>(undefined);
  const [publishDescription, setPublishDescription] = useState("");
  const [query, setQuery] = useState("");
  const [pocketsOnly, setPocketsOnly] = useState(false);

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

  const place = async (blueprintId: string) => {
    const payload = await load(blueprintId);
    if (payload) {
      placePayload(payload);
    }
  };

  const commitPublish = async (blueprintId: string) => {
    setPublishDraftId(undefined);
    await publish(blueprintId, true, publishDescription);
    setPublishDescription("");
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
    <>
      <div className="border-b border-neutral-800 px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            My blueprints
            {blueprints.length > 0 ? (
              <span className="ml-1 text-neutral-600">({blueprints.length})</span>
            ) : null}
          </span>
          {user ? (
            <button
              type="button"
              disabled={!canSave}
              onClick={() => setDraftName(`Blueprint ${blueprints.length + 1}`)}
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
            placeholder="Search my blueprints..."
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
            board, save them here, publish your best to the network.
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
              const drafting = publishDraftId === blueprint.id;
              return (
                <li
                  key={blueprint.id}
                  className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void place(blueprint.id)}
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
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        if (blueprint.isPublic) {
                          void publish(blueprint.id, false);
                        } else if (drafting) {
                          setPublishDraftId(undefined);
                        } else {
                          setPublishDraftId(blueprint.id);
                          setPublishDescription(blueprint.description ?? "");
                        }
                      }}
                      title={
                        blueprint.isPublic
                          ? "Published to the network — click to unpublish"
                          : "Publish to the network"
                      }
                      aria-label={
                        blueprint.isPublic
                          ? `Unpublish blueprint ${blueprint.name}`
                          : `Publish blueprint ${blueprint.name}`
                      }
                      className={[
                        "shrink-0 rounded-[4px] p-0.5",
                        blueprint.isPublic
                          ? "text-emerald-400 hover:text-neutral-400"
                          : "text-neutral-600 opacity-0 hover:text-emerald-400 focus:opacity-100 group-hover:opacity-100",
                      ].join(" ")}
                    >
                      <Globe className="h-3.5 w-3.5" />
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
                        title="Delete this blueprint (a published copy leaves the network too)"
                        aria-label={`Delete blueprint ${blueprint.name}`}
                        className="shrink-0 rounded-[4px] p-0.5 text-neutral-600 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {drafting ? (
                    <div className="mt-1 flex items-center gap-1 pl-5">
                      <input
                        autoFocus
                        value={publishDescription}
                        maxLength={500}
                        onChange={(event) => setPublishDescription(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void commitPublish(blueprint.id);
                          }
                          if (event.key === "Escape") {
                            setPublishDraftId(undefined);
                          }
                        }}
                        placeholder="One line about what this builds (optional)"
                        className="h-7 min-w-0 flex-1 rounded-[4px] border border-emerald-600 bg-[#17191d] px-1.5 text-xs text-neutral-100 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void commitPublish(blueprint.id)}
                        className="h-7 shrink-0 rounded-[4px] border border-emerald-700 bg-emerald-950 px-2 text-[11px] text-emerald-300 hover:bg-emerald-900"
                      >
                        Publish
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex items-center gap-2 pl-5 text-[10px] text-neutral-500">
                    <span title={new Date(blueprint.createdAt).toLocaleString()}>
                      {formatRelativeDate(blueprint.createdAt)}
                    </span>
                    <span className="truncate">
                      {blueprint.nodeCount + blueprint.storageCount} cards
                      {blueprint.machineCount > 0 ? ` · ${blueprint.machineCount} machines` : ""}
                      {blueprint.pocketCount > 0
                        ? ` · ✦ ${blueprint.pocketCount} pocket${blueprint.pocketCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    {blueprint.isPublic ? (
                      <span
                        className="ml-auto flex shrink-0 items-center gap-1.5 text-emerald-500"
                        title={`On the network: ${blueprint.upvotes} up, ${blueprint.downvotes} down, placed ${blueprint.downloads} times`}
                      >
                        {blueprint.score > 0 ? `+${blueprint.score}` : blueprint.score}
                        <Download className="h-3 w-3" /> {blueprint.downloads}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// PUBLIC: the network shelf.
// ---------------------------------------------------------------------------

function PublicShelf() {
  const publicBlueprints = useBlueprintStore((state) => state.publicBlueprints);
  const publicSort = useBlueprintStore((state) => state.publicSort);
  const setPublicSort = useBlueprintStore((state) => state.setPublicSort);
  const setPublicSearch = useBlueprintStore((state) => state.setPublicSearch);
  const refreshPublic = useBlueprintStore((state) => state.refreshPublic);
  const loadMorePublic = useBlueprintStore((state) => state.loadMorePublic);
  const publicHasMore = useBlueprintStore((state) => state.publicHasMore);
  const hasLoadedPublic = useBlueprintStore((state) => state.hasLoadedPublic);
  const isPublicLoading = useBlueprintStore((state) => state.isPublicLoading);
  const publicError = useBlueprintStore((state) => state.publicError);
  const busyId = useBlueprintStore((state) => state.busyId);
  const vote = useBlueprintStore((state) => state.vote);
  const downloadPublic = useBlueprintStore((state) => state.downloadPublic);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);

  // First visit loads the shelf; afterwards only the settled search re-hits
  // the network — half-typed words never do.
  useEffect(() => {
    setPublicSearch(debouncedQuery.trim());
  }, [debouncedQuery, setPublicSearch]);
  useEffect(() => {
    if (!hasLoadedPublic && !isPublicLoading) {
      void refreshPublic();
    }
  }, [hasLoadedPublic, isPublicLoading, refreshPublic]);

  const place = async (blueprintId: string) => {
    const payload = await downloadPublic(blueprintId);
    if (payload) {
      placePayload(payload);
    }
  };

  return (
    <>
      <div className="border-b border-neutral-800 px-3 py-3">
        <label className="flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the network..."
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear public blueprint search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>

        <div className="mt-2 flex items-center gap-1">
          {(Object.entries(PUBLIC_BLUEPRINT_SORTS) as Array<[PublicBlueprintSort, string]>).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPublicSort(value)}
                className={[
                  "h-7 min-w-0 flex-1 truncate rounded-[4px] border px-1 text-xs font-medium",
                  publicSort === value
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
                ].join(" ")}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {publicError ? (
          <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{publicError}</p>
        ) : null}

        {isPublicLoading && !hasLoadedPublic ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading the network…
          </p>
        ) : publicBlueprints.length === 0 && hasLoadedPublic && !publicError ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing published{query.trim() ? " that matches" : " yet"}. Save a selection on the
            Mine shelf and hit its globe — your build becomes the network&apos;s first.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {publicBlueprints.map((blueprint) => (
                <PublicBlueprintRow
                  key={blueprint.id}
                  blueprint={blueprint}
                  isBusy={busyId === blueprint.id}
                  onPlace={() => void place(blueprint.id)}
                  onVote={(value) => void vote(blueprint.id, value)}
                />
              ))}
            </ul>
            {publicHasMore ? (
              <button
                type="button"
                disabled={isPublicLoading}
                onClick={() => void loadMorePublic()}
                className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-neutral-700 bg-[#17191d] text-[11px] text-neutral-300 enabled:hover:border-neutral-500 disabled:opacity-50"
              >
                {isPublicLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function PublicBlueprintRow({
  blueprint,
  isBusy,
  onPlace,
  onVote,
}: {
  blueprint: BlueprintSummary;
  isBusy: boolean;
  onPlace: () => void;
  onVote: (value: 1 | -1) => void;
}) {
  return (
    <li className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500">
      <div className="flex items-center gap-1">
        {/* The vote column: score between the arrows, the browser's own vote lit. */}
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            onClick={() => onVote(1)}
            title="Upvote"
            aria-label={`Upvote ${blueprint.name}`}
            className={[
              "-my-0.5 rounded-[3px]",
              blueprint.myVote === 1
                ? "text-emerald-400"
                : "text-neutral-600 hover:text-emerald-400",
            ].join(" ")}
          >
            <ArrowBigUp className="h-4 w-4" />
          </button>
          <span
            className={[
              "text-[10px] font-bold leading-3 tabular-nums",
              blueprint.score > 0
                ? "text-emerald-400"
                : blueprint.score < 0
                  ? "text-red-400"
                  : "text-neutral-500",
            ].join(" ")}
          >
            {blueprint.score}
          </span>
          <button
            type="button"
            onClick={() => onVote(-1)}
            title="Downvote"
            aria-label={`Downvote ${blueprint.name}`}
            className={[
              "-my-0.5 rounded-[3px]",
              blueprint.myVote === -1 ? "text-red-400" : "text-neutral-600 hover:text-red-400",
            ].join(" ")}
          >
            <ArrowBigDown className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          disabled={isBusy}
          onClick={onPlace}
          title="Place this blueprint on the board"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {isBusy ? (
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-300" />
          ) : (
            <MapPinPlus className="h-3.5 w-3.5 shrink-0 text-neutral-500 group-hover:text-emerald-300" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-xs text-neutral-100">
              {blueprint.name}
              {blueprint.isMine ? <span className="ml-1 text-[9px] text-cyan-400">yours</span> : null}
            </span>
            {blueprint.description ? (
              <span
                className="block truncate text-[10px] text-neutral-500"
                title={blueprint.description}
              >
                {blueprint.description}
              </span>
            ) : null}
          </span>
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-6 text-[10px] text-neutral-500">
        {blueprint.authorName ? (
          <span className="truncate text-neutral-400">{blueprint.authorName}</span>
        ) : null}
        <span title={blueprint.publishedAt ? new Date(blueprint.publishedAt).toLocaleString() : ""}>
          {formatRelativeDate(blueprint.publishedAt ?? blueprint.createdAt)}
        </span>
        <span className="truncate">
          {blueprint.nodeCount + blueprint.storageCount} cards
          {blueprint.pocketCount > 0 ? ` · ✦ ${blueprint.pocketCount}` : ""}
        </span>
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5"
          title={`Placed ${blueprint.downloads} time${blueprint.downloads === 1 ? "" : "s"}`}
        >
          <Download className="h-3 w-3" /> {blueprint.downloads}
        </span>
      </div>
    </li>
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
