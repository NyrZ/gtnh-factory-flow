"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowBigUp,
  Download,
  Globe,
  LoaderCircle,
  MapPinPlus,
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
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { formatSlotRate } from "@/components/flow/flow-explainers";
import { useBlueprintStore } from "@/store/blueprint-store";
import { useFactoryStore } from "@/store/factory-store";
import type { BoardClipboardPayload } from "@/store/factory-store";

/**
 * The blueprint library, owning the whole left column while the sidebar's
 * master switch points at it. Two shelves: MINE is the account's private
 * collection (saved from pocket cards, published with one click); PUBLIC is
 * the network — everyone's published sub-assemblies, searchable, sortable,
 * upvoteable, placeable. Hovering any row reveals the blueprint's stat card:
 * what it needs from outside and what it makes, the same reading the
 * zoomed-out board gives a hovered machine.
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

  const scopeTabs = (
    <div className="grid grid-cols-2 gap-1">
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
  );

  return scope === "mine" ? (
    <MineShelf scopeTabs={scopeTabs} />
  ) : (
    <PublicShelf scopeTabs={scopeTabs} />
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

/** The controls card: scope tabs on top, the active shelf's own tools under. */
function ControlsCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-2">
      {children}
    </div>
  );
}

/**
 * The hover reveal: what this blueprint needs from outside and what it
 * makes, icons and rates — the same reading a hovered machine gives on the
 * zoomed-out board. Returns undefined for stat-less rows (older saves), so
 * the tooltip simply doesn't open.
 */
function renderBlueprintIo(blueprint: BlueprintSummary): ReactNode {
  const needs = blueprint.needs ?? [];
  const outputs = blueprint.outputs ?? [];
  if (needs.length === 0 && outputs.length === 0) {
    return undefined;
  }

  const section = (label: string, stats: typeof needs) =>
    stats.length > 0 ? (
      <div className="mt-1.5 first:mt-0">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        {stats.slice(0, 8).map((stat) => (
          <div
            key={`${stat.kind}:${stat.resourceId}`}
            className="flex items-center gap-1.5 py-0.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
              <ResourceIcon
                resource={{ ...stat, id: stat.resourceId, amount: 1 }}
                bare
                tooltip={false}
                showAmount={false}
                iconPixelSize={stat.kind === "fluid" ? 36 : undefined}
                className={stat.kind === "fluid" ? "!h-5 !w-5" : "!h-5 !w-5 origin-center scale-150"}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">
              {stat.displayName ?? stat.resourceId}
            </span>
            <span className="shrink-0 tabular-nums text-[12px] text-slate-400">
              {formatSlotRate(stat.ratePerSecond, stat.kind)}
            </span>
          </div>
        ))}
        {stats.length > 8 ? (
          <div className="text-[10px] text-slate-500">+{stats.length - 8} more</div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="w-64">
      {section("Needs", needs)}
      {section("Makes", outputs)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MINE: the private collection, with publishing.
// ---------------------------------------------------------------------------

function MineShelf({ scopeTabs }: { scopeTabs: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const blueprints = useBlueprintStore((state) => state.blueprints);
  const sort = useBlueprintStore((state) => state.sort);
  const setSort = useBlueprintStore((state) => state.setSort);
  const hasLoaded = useBlueprintStore((state) => state.hasLoaded);
  const isLoading = useBlueprintStore((state) => state.isLoading);
  const isSaving = useBlueprintStore((state) => state.isSaving);
  const busyId = useBlueprintStore((state) => state.busyId);
  const error = useBlueprintStore((state) => state.error);
  const load = useBlueprintStore((state) => state.load);
  const remove = useBlueprintStore((state) => state.remove);
  const publish = useBlueprintStore((state) => state.publish);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [pocketsOnly, setPocketsOnly] = useState(false);

  const place = async (blueprintId: string) => {
    const payload = await load(blueprintId);
    if (payload) {
      placePayload(payload);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sortBlueprints(blueprints, sort).filter(
    (blueprint) =>
      (!pocketsOnly || blueprint.pocketCount > 0) &&
      (normalizedQuery.length === 0 || blueprint.name.toLowerCase().includes(normalizedQuery)),
  );
  const isFiltering = pocketsOnly || normalizedQuery.length > 0;

  return (
    <>
      <ControlsCard>
        {scopeTabs}
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
        {isSaving ? (
          <p className="mt-1.5 flex items-center gap-1 px-0.5 text-[10px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Saving…
          </p>
        ) : null}
      </ControlsCard>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{error}</p> : null}

        {isAuthLoading ? null : !user ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Sign in (top right) to keep a cloud library of sub-assemblies: hit the save button on
            any pocket card to shelve it here, publish your best to the network.
          </p>
        ) : isLoading && !hasLoaded ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading your blueprints…
          </p>
        ) : blueprints.length === 0 ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing saved yet. Compact cards into a pocket (Ctrl+G), then hit the save button on
            the pocket card — the whole dimension lands here under the pocket&apos;s name.
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
                    <MinecraftTooltip
                      label={blueprint.name}
                      content={renderBlueprintIo(blueprint)}
                    >
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
                        <span className="truncate text-[13px] leading-5 text-neutral-100">
                          {blueprint.name}
                        </span>
                      </button>
                    </MinecraftTooltip>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void publish(blueprint.id, !blueprint.isPublic)}
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
                        title={`On the network: ${blueprint.upvotes} upvotes, placed ${blueprint.downloads} times`}
                      >
                        <ArrowBigUp className="h-3 w-3" /> {blueprint.upvotes}
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

function PublicShelf({ scopeTabs }: { scopeTabs: ReactNode }) {
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
      <ControlsCard>
        {scopeTabs}
        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
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
      </ControlsCard>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {publicError ? (
          <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{publicError}</p>
        ) : null}

        {isPublicLoading && !hasLoadedPublic ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading the network…
          </p>
        ) : publicBlueprints.length === 0 && hasLoadedPublic && !publicError ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Nothing published{query.trim() ? " that matches" : " yet"}. Save a pocket on the Mine
            shelf and hit its globe — your build becomes the network&apos;s first.
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
                  onUpvote={() => void vote(blueprint.id, 1)}
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
  onUpvote,
}: {
  blueprint: BlueprintSummary;
  isBusy: boolean;
  onPlace: () => void;
  onUpvote: () => void;
}) {
  return (
    <li className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onUpvote}
          title={blueprint.myVote === 1 ? "Upvoted — click to retract" : "Upvote"}
          aria-label={`Upvote ${blueprint.name}`}
          className={[
            "flex shrink-0 items-center gap-0.5 rounded-[4px] border px-1 py-0.5 text-[11px] font-bold tabular-nums",
            blueprint.myVote === 1
              ? "border-emerald-600 bg-emerald-500/15 text-emerald-300"
              : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-emerald-600 hover:text-emerald-300",
          ].join(" ")}
        >
          <ArrowBigUp className="h-3.5 w-3.5" />
          {blueprint.upvotes}
        </button>
        <MinecraftTooltip label={blueprint.name} content={renderBlueprintIo(blueprint)}>
          <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
            {blueprint.name}
          </span>
        </MinecraftTooltip>
        <button
          type="button"
          disabled={isBusy}
          onClick={onPlace}
          title="Download onto your board"
          aria-label={`Download blueprint ${blueprint.name}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
        >
          {isBusy ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-300" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-0.5 text-[10px] text-neutral-500">
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
