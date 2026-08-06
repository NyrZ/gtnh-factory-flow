"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowBigUp,
  Check,
  Cog,
  Download,
  Factory,
  FolderOpen,
  Globe,
  Link2,
  LoaderCircle,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  deleteCommunityPlan,
  downloadCommunityPlan,
  listCommunityPlans,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import type { CommunityPlanSort, CommunityPlanSummary } from "@/lib/community/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { formatRate } from "@/lib/model";
import { OPEN_SETUPS_EVENT, takePendingSetupsScope, type SetupsScope } from "@/lib/setups-tab";
import { useCommunityUser } from "@/components/community/auth";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useDesignStore } from "@/store/design-store";
import { formatRelativeDate, renderIoStats } from "./BlueprintPanel";

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
  const [busyId, setBusyId] = useState<string>();
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
    setBusyId(plan.id);
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
      setBusyId(undefined);
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
            placeholder={scope === "mine" ? "Search my setups..." : "Search the network..."}
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
                  isBusy={busyId === plan.id}
                  isCopied={copiedId === plan.id}
                  canManage={plan.isMine === true || user?.isAdmin === true}
                  onVote={() => void vote(plan)}
                  onOpen={() => void open(plan)}
                  onCopyLink={() => void copyLink(plan)}
                  onDelete={() => void remove(plan)}
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

function SetupRow({
  plan,
  isBusy,
  isCopied,
  canManage,
  onVote,
  onOpen,
  onCopyLink,
  onDelete,
}: {
  plan: CommunityPlanSummary;
  isBusy: boolean;
  isCopied: boolean;
  canManage: boolean;
  onVote: () => void;
  onOpen: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="group rounded-[4px] border border-neutral-700 bg-[#25272c] px-1.5 py-1.5 hover:border-neutral-500"
      // Double-click anywhere that isn't a button opens the setup — the
      // folder button stays as the single-click way.
      onDoubleClick={(event) => {
        if (!isBusy && !(event.target as HTMLElement).closest("button")) {
          onOpen();
        }
      }}
    >
      <MinecraftTooltip label={plan.name} content={renderSetupDetails(plan)}>
        <div className="flex items-stretch gap-1.5">
          <span className="w-16 shrink-0 self-stretch overflow-hidden rounded-[3px] border border-neutral-700 bg-[#17191d]">
            {plan.thumbnailDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={plan.thumbnailDataUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-neutral-600">
                <Factory className="h-5 w-5" />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="block min-w-0 flex-1 truncate text-[13px] leading-5 text-neutral-100">
                {plan.name}
              </span>
              <button
                type="button"
                onClick={onVote}
                title={plan.myVote === 1 ? "Upvoted. Click to retract" : "Upvote"}
                aria-label={`Upvote ${plan.name}`}
                className={[
                  "flex shrink-0 items-center gap-0.5 rounded-[4px] border px-1 py-0.5 text-[11px] font-bold tabular-nums",
                  plan.myVote === 1
                    ? "border-emerald-600 bg-emerald-500/15 text-emerald-300"
                    : "border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-emerald-600 hover:text-emerald-300",
                ].join(" ")}
              >
                <ArrowBigUp className="h-3.5 w-3.5" />
                {plan.score}
              </button>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-neutral-500">
              {plan.authorName ? (
                <span className="truncate text-neutral-400" title={`By ${plan.authorName}`}>
                  {plan.authorName}
                </span>
              ) : null}
              <span
                className="shrink-0"
                title={`Shared ${new Date(plan.createdAt).toLocaleString()}`}
              >
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
            <div className="mt-1 flex items-center gap-1">
              {plan.highestTier ? (
                <span
                  className="rounded-[3px] border border-neutral-700 bg-[#17191d] px-1 py-px text-[9px] font-bold leading-3 text-amber-300"
                  title={`Machines up to ${plan.highestTier}`}
                >
                  {plan.highestTier}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onCopyLink}
                title="Copy a link that opens this setup in a friend's planner"
                aria-label={`Copy a link to ${plan.name}`}
                className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
              >
                {isCopied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
              </button>
              {canManage ? (
                <button
                  type="button"
                  onClick={onDelete}
                  title="Take this post down"
                  aria-label={`Take down ${plan.name}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 hover:border-red-500 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                disabled={isBusy}
                onClick={onOpen}
                title="Open as its own design tab"
                aria-label={`Open setup ${plan.name}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-neutral-700 bg-[#17191d] text-neutral-400 enabled:hover:border-emerald-500 enabled:hover:text-emerald-300 disabled:opacity-50"
              >
                {isBusy ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-300" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </MinecraftTooltip>
    </li>
  );
}
