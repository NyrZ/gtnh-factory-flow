"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowBigUp,
  Check,
  Cog,
  Download,
  FolderOpen,
  Globe,
  Link2,
  LoaderCircle,
  Package,
  Search,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import {
  deleteCommunityPlan,
  downloadCommunityPlan,
  listCommunityPlans,
  tagPlanWithCommunityId,
  updateCommunityPlanTags,
  voteCommunityPlan,
} from "@/lib/community/client";
import type { CommunityPlanSort, CommunityPlanSummary } from "@/lib/community/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { formatRate } from "@/lib/model";
import { OPEN_SETUPS_EVENT, takePendingSetupsScope, type SetupsScope } from "@/lib/setups-tab";
import { useCommunityUser } from "@/components/community/auth";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { GT_TIER_COLORS } from "@/components/flow/tier-colors";
import { useDesignStore } from "@/store/design-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import type { FactoryProject } from "@/lib/model/types";
import { formatRelativeDate, placePayload, renderIoStats, TagChips } from "./BlueprintPanel";

const SETUP_SORTS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
];

const PAGE_SIZE = 24;

/** What the shelf currently shows: which query it answers and how deep. */
interface SetupShelf {
  key: string;
  page: number;
  total: number;
  plans: CommunityPlanSummary[];
}

/**
 * The Setups shelf: everyone's shared factories, browsed without leaving the
 * board. The old community page folded into this column — search, sort,
 * vote, and one click opens a setup as its own design tab (never on top of
 * the open board). NETWORK is the whole hub; MINE is the account's own
 * posts, where take-down lives.
 */
export function SetupsPanel() {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const [scope, setScope] = useState<SetupsScope>(() => takePendingSetupsScope() ?? "network");
  const [sort, setSort] = useState<CommunityPlanSort>("new");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [shelf, setShelf] = useState<SetupShelf>();
  const [target, setTarget] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<{ id: string; kind: "open" | "pocket" }>();
  const [copiedId, setCopiedId] = useState<string>();

  // "My setups" in the account menu can retarget an already-open panel.
  useEffect(() => {
    const applyScope = () => {
      const requested = takePendingSetupsScope();
      if (requested) {
        setScope(requested);
      }
    };
    window.addEventListener(OPEN_SETUPS_EVENT, applyScope);
    return () => window.removeEventListener(OPEN_SETUPS_EVENT, applyScope);
  }, []);

  const username = user?.username ?? "";
  const search = debouncedQuery.trim();
  const key = `${scope}|${sort}|${search}|${username}`;
  // A "load more" targets deeper pages of the key it was clicked under; any
  // filter move leaves that target stale and the shelf falls back to page 1.
  const activePage = target.key === key ? target.page : 1;

  useEffect(() => {
    if (scope === "mine" && !username) {
      return;
    }

    let cancelled = false;
    void listCommunityPlans({
      sort,
      search: search || undefined,
      mine: scope === "mine" || undefined,
      page: activePage,
      pageSize: PAGE_SIZE,
    }).then(
      (response) => {
        if (cancelled) {
          return;
        }
        setError(undefined);
        setShelf((current) => ({
          key,
          page: activePage,
          total: response.total,
          plans:
            current && current.key === key && activePage > 1
              ? [...current.plans, ...response.plans]
              : response.plans,
        }));
      },
      (loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Loading setups failed.");
        setShelf({ key, page: activePage, total: 0, plans: [] });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key, activePage, scope, sort, search, username]);

  const isCurrent = shelf?.key === key;
  const plans = isCurrent ? shelf.plans : [];
  const needsAccount = scope === "mine" && !username;
  const isLoading = !needsAccount && (!isCurrent || shelf.page !== activePage);
  const hasMore = isCurrent && shelf.plans.length < shelf.total;

  const patchPlan = (
    planId: string,
    patch: (plan: CommunityPlanSummary) => CommunityPlanSummary,
  ) => {
    setShelf((current) =>
      current
        ? {
            ...current,
            plans: current.plans.map((plan) => (plan.id === planId ? patch(plan) : plan)),
          }
        : current,
    );
  };

  const vote = async (plan: CommunityPlanSummary) => {
    try {
      const response = await voteCommunityPlan(plan.id, 1);
      patchPlan(plan.id, (entry) => ({
        ...entry,
        upvotes: response.upvotes,
        downvotes: response.downvotes,
        score: response.score,
        myVote: response.myVote,
      }));
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "Voting failed.");
    }
  };

  const open = async (plan: CommunityPlanSummary) => {
    setBusy({ id: plan.id, kind: "open" });
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(planJson, plan.id)),
      );
      await useDesignStore.getState().importProjectAsDesign(project, project.name || plan.name);
      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the setup failed.");
    } finally {
      setBusy(undefined);
    }
  };

  // The whole setup lands on the CURRENT board as one pocket card: paste it
  // centred like a blueprint, then compact the pasted cards — same code path
  // as Ctrl+G, so ports, wiring and the purple room all come out right.
  const openAsPocket = async (plan: CommunityPlanSummary) => {
    setBusy({ id: plan.id, kind: "pocket" });
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(JSON.stringify(planJson));
      const payload = captureBoardSelection(project, rootBoardIds(project));
      if (!payload) {
        throw new Error("This setup has nothing to place.");
      }

      const pastedIds = placePayload(payload);
      if (pastedIds.length > 0) {
        const state = useFactoryStore.getState();
        const pocketId = state.compactSelectionIntoPocket(pastedIds, plan.name);
        if (pocketId) {
          state.setPendingBoardSelection([pocketId]);
        }
      }

      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (pocketError) {
      setError(
        pocketError instanceof Error ? pocketError.message : "Loading as a pocket failed.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const copyLink = async (plan: CommunityPlanSummary) => {
    const url = `${window.location.origin}/?plan=${plan.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setCopiedId(plan.id);
    window.setTimeout(
      () => setCopiedId((current) => (current === plan.id ? undefined : current)),
      1500,
    );
  };

  const saveTags = async (plan: CommunityPlanSummary, tags: string[]) => {
    try {
      await updateCommunityPlanTags(plan.id, tags);
      patchPlan(plan.id, (entry) => ({ ...entry, tags }));
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Saving tags failed.");
    }
  };

  const remove = async (plan: CommunityPlanSummary) => {
    if (!window.confirm(`Take down "${plan.name}" from the network?`)) {
      return;
    }

    try {
      await deleteCommunityPlan(plan.id);
      setShelf((current) =>
        current
          ? {
              ...current,
              total: Math.max(0, current.total - 1),
              plans: current.plans.filter((entry) => entry.id !== plan.id),
            }
          : current,
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Taking the post down failed.",
      );
    }
  };

  return (
    <>
      <div className="mx-2 mt-2 shrink-0 rounded-[6px] border border-neutral-700 bg-[#2a2d33] p-2">
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setScope("network")}
            className={[
              "flex h-7 items-center justify-center gap-1.5 rounded-[4px] border text-xs font-medium",
              scope === "network"
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            <Globe className="h-3.5 w-3.5" />
            Network
          </button>
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
        </div>
        <label className="mt-2 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              scope === "mine" ? "Search my setups... (#tag)" : "Search the network... (#tag)"
            }
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              title="Clear search"
              aria-label="Clear setup search"
              className="text-neutral-500 hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <div className="mt-2 flex items-center gap-1">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as CommunityPlanSort)}
            aria-label="Sort setups"
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-1 text-xs text-neutral-100 outline-none"
          >
            {SETUP_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? <p className="mb-1.5 px-0.5 text-[11px] text-red-400">{error}</p> : null}

        {needsAccount && !isAuthLoading ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            Sign in (top right) to see your own setups here. Share one with the board&apos;s Share
            button, then manage it from this shelf.
          </p>
        ) : isLoading && plans.length === 0 ? (
          <p className="flex items-center gap-1.5 px-0.5 pt-1 text-[11px] text-neutral-500">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading the network…
          </p>
        ) : plans.length === 0 && !error ? (
          <p className="px-0.5 pt-1 text-[11px] leading-relaxed text-neutral-500">
            {search
              ? "No setups match."
              : scope === "mine"
                ? "Nothing shared yet. Hit the Share button above the board to put a setup on the network."
                : "Nothing shared yet. Build a factory, hit the Share button up top, and yours becomes the network's first."}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {plans.map((plan) => (
                <SetupRow
                  key={plan.id}
                  plan={plan}
                  busy={busy?.id === plan.id ? busy.kind : undefined}
                  isCopied={copiedId === plan.id}
                  canManage={plan.isMine === true || user?.isAdmin === true}
                  onVote={() => void vote(plan)}
                  onOpen={() => void open(plan)}
                  onOpenAsPocket={() => void openAsPocket(plan)}
                  onCopyLink={() => void copyLink(plan)}
                  onDelete={() => void remove(plan)}
                  onSaveTags={(tags) => void saveTags(plan, tags)}
                  onTag={(tag) => setQuery(`#${tag}`)}
                />
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setTarget({ key, page: activePage + 1 })}
                className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-neutral-700 bg-[#17191d] text-[11px] text-neutral-300 enabled:hover:border-neutral-500 disabled:opacity-50"
              >
                {isLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/**
 * The hover reveal: the post's description and headline numbers, then the
 * same Needs/Makes reading blueprint rows give.
 */
function renderSetupDetails(plan: CommunityPlanSummary): ReactNode {
  const facts = [
    `${plan.nodeCount + plan.storageCount} cards`,
    `${plan.machineCount} machines`,
    ...(plan.highestTier ? [`up to ${plan.highestTier}`] : []),
    ...(plan.totalEuT ? [`${formatRate(Math.abs(plan.totalEuT), 3)} EU/t`] : []),
    ...(plan.gameVersion ? [`GTNH ${plan.gameVersion}`] : []),
  ];

  return (
    <div className="w-64">
      {plan.description ? (
        <p className="mb-1.5 max-h-28 overflow-hidden whitespace-pre-wrap text-[11px] leading-4 text-slate-300">
          {plan.description}
        </p>
      ) : null}
      <div className="text-[10px] text-slate-400">{facts.join(" · ")}</div>
      {renderIoStats(plan.needs ?? [], plan.outputs ?? [])}
    </div>
  );
}

/** Everything living at a project's top level — what a full-plan capture takes. */
function rootBoardIds(project: FactoryProject): string[] {
  return [
    ...project.nodes.filter((node) => !node.pocketId).map((node) => node.id),
    ...(project.storages ?? [])
      .filter((storage) => !storage.pocketId)
      .map((storage) => storage.id),
    ...(project.annotations ?? [])
      .filter((annotation) => !annotation.pocketId)
      .map((annotation) => annotation.id),
    ...(project.pockets ?? [])
      .filter((pocket) => !pocket.parentPocketId)
      .map((pocket) => pocket.id),
  ];
}

/**
 * The GT voltage badge, worn exactly like the tier button on a card — and a
 * fixed column: every badge is as wide as the widest tier label, so the
 * author names after them all start on the same line.
 */
const TIER_BADGE_WIDTH = "w-8";

function TierBadge({ tier }: { tier?: CommunityPlanSummary["highestTier"] }) {
  const color = tier ? GT_TIER_COLORS[tier] : undefined;
  if (!tier || !color) {
    return <span className={`${TIER_BADGE_WIDTH} shrink-0`} aria-hidden />;
  }
  return (
    <span
      className={`${TIER_BADGE_WIDTH} shrink-0 border text-center text-[9px] font-bold leading-[14px] shadow-[inset_1px_1px_0_rgba(255,255,255,0.55),inset_-1px_-1px_0_rgba(0,0,0,0.45)]`}
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      }}
      title={`Machines up to ${tier}`}
    >
      {tier}
    </span>
  );
}

function SetupRow({
  plan,
  busy,
  isCopied,
  canManage,
  onVote,
  onOpen,
  onOpenAsPocket,
  onCopyLink,
  onDelete,
  onSaveTags,
  onTag,
}: {
  plan: CommunityPlanSummary;
  busy?: "open" | "pocket";
  isCopied: boolean;
  canManage: boolean;
  onVote: () => void;
  onOpen: () => void;
  onOpenAsPocket: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onSaveTags: (tags: string[]) => void;
  onTag: (tag: string) => void;
}) {
  const isBusy = busy !== undefined;
  // The tag editor lives in the row: edits stay local as chips and save
  // once, on close — one PUT per session, same manners as blueprints.
  const [tagEditor, setTagEditor] = useState<{ draft: string[]; input: string }>();

  const addDraftTag = (editor: { draft: string[]; input: string }) => {
    const draft = normalizeBlueprintTags([...editor.draft, editor.input]);
    setTagEditor({ draft, input: "" });
    return draft;
  };

  // Closing saves — whatever is still in the input counts as one last tag.
  const closeTagEditor = () => {
    if (!tagEditor) {
      return;
    }
    const finalTags = tagEditor.input.trim() ? addDraftTag(tagEditor) : tagEditor.draft;
    setTagEditor(undefined);
    if (JSON.stringify(finalTags) !== JSON.stringify(plan.tags ?? [])) {
      onSaveTags(finalTags);
    }
  };

  return (
    <li
      className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1 hover:border-neutral-500"
      // Double-click anywhere that isn't a button opens the setup — the
      // folder button stays as the single-click way.
      onDoubleClick={(event) => {
        if (!isBusy && !(event.target as HTMLElement).closest("button, input")) {
          onOpen();
        }
      }}
    >
      <MinecraftTooltip label={plan.name} content={renderSetupDetails(plan)}>
        {/* The name owns the row: vote and action hardware run one size
            smaller than blueprints' so titles stop truncating at 300px. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onVote}
            title={plan.myVote === 1 ? "Upvoted. Click to retract" : "Upvote"}
            aria-label={`Upvote ${plan.name}`}
            className={[
              "flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] border px-1 text-[10px] font-bold tabular-nums",
              plan.myVote === 1
                ? "border-emerald-600 bg-emerald-500/15 text-emerald-300"
                : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-emerald-600 hover:text-emerald-300",
            ].join(" ")}
          >
            <ArrowBigUp className="h-3 w-3" />
            {plan.score}
          </button>
          <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
            {plan.name}
          </span>
          <button
            type="button"
            onClick={onCopyLink}
            title="Copy a link that opens this setup in a friend's planner"
            aria-label={`Copy a link to ${plan.name}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
          >
            {isCopied ? (
              <Check className="h-3 w-3 text-emerald-300" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
          </button>
          {canManage ? (
            <>
              <button
                type="button"
                onClick={() =>
                  tagEditor
                    ? closeTagEditor()
                    : setTagEditor({ draft: plan.tags ?? [], input: "" })
                }
                title={tagEditor ? "Save tags" : "Edit tags"}
                aria-label={`Edit tags for ${plan.name}`}
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border",
                  tagEditor
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-cyan-600 hover:text-cyan-300",
                ].join(" ")}
              >
                <Tags className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                title="Take this post down"
                aria-label={`Take down ${plan.name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-red-500 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={isBusy}
            onClick={onOpenAsPocket}
            title="Drop onto this board as one pocket card"
            aria-label={`Load setup ${plan.name} as a pocket`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-[#8d6fd1] enabled:hover:text-[#c9b8ec] disabled:opacity-50"
          >
            {busy === "pocket" ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-[#c9b8ec]" />
            ) : (
              <Package className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onOpen}
            title="Open as its own design tab"
            aria-label={`Open setup ${plan.name}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
          >
            {busy === "open" ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-emerald-300" />
            ) : (
              <FolderOpen className="h-3 w-3" />
            )}
          </button>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-0.5 text-[10px] tabular-nums text-neutral-500">
          <TierBadge tier={plan.highestTier} />
          {plan.authorName ? (
            <span className="truncate text-neutral-400" title={`By ${plan.authorName}`}>
              {plan.authorName}
            </span>
          ) : null}
          <span className="shrink-0" title={`Shared ${new Date(plan.createdAt).toLocaleString()}`}>
            {formatRelativeDate(plan.createdAt)}
          </span>
          {plan.machineCount > 0 ? (
            <span
              className="flex shrink-0 items-center gap-0.5"
              title={`${plan.machineCount} machines configured`}
            >
              <Cog className="h-3 w-3" /> {plan.machineCount}
            </span>
          ) : null}
          <span
            className="ml-auto flex shrink-0 items-center gap-0.5"
            title={`Opened ${plan.downloads} time${plan.downloads === 1 ? "" : "s"}`}
          >
            <Download className="h-3 w-3" /> {plan.downloads}
          </span>
        </div>
        {tagEditor ? (
          <div className="mt-1 flex flex-wrap items-center gap-1 rounded-[4px] border border-cyan-700 bg-[#17191d] p-1.5">
            {tagEditor.draft.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setTagEditor({
                    draft: tagEditor.draft.filter((entry) => entry !== tag),
                    input: tagEditor.input,
                  })
                }
                title={`Remove #${tag}`}
                className="rounded-[3px] border border-neutral-700 bg-[#25272c] px-1 py-px text-[9px] leading-3 text-neutral-300 hover:border-red-500 hover:text-red-400"
              >
                #{tag} ×
              </button>
            ))}
            <input
              autoFocus
              value={tagEditor.input}
              placeholder={tagEditor.draft.length === 0 ? "add tags..." : ""}
              onChange={(event) => setTagEditor({ ...tagEditor, input: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addDraftTag(tagEditor);
                }
                if (event.key === "Escape") {
                  setTagEditor(undefined);
                }
              }}
              className="h-5 min-w-16 flex-1 bg-transparent text-[11px] text-neutral-100 outline-none"
            />
          </div>
        ) : (
          <TagChips tags={plan.tags ?? []} onTag={onTag} className="pl-0.5" />
        )}
      </MinecraftTooltip>
    </li>
  );
}
