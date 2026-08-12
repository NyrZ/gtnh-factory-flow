"use client";

import {
  ArrowBigUp,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Link2,
  LoaderCircle,
  RotateCcw,
  Save,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCommunityPlan,
  getCommunityPlan,
  patchCommunityPlan,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import { planContentFingerprint } from "@/lib/community/plan-fingerprint";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { EntryIcon, FactoryProject } from "@/lib/model/types";
import { notifySetupsChanged } from "@/lib/setups-tab";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";

/**
 * The plan card: a drawer along the bottom of the board holding the plan's
 * own face - icon, name, blurb - and, when the plan is linked to a community
 * post, that post's face too: author, dates, votes, and the way back to the
 * posted version.
 *
 * Every plan has the identity half, shared or not: it is where a build gets
 * its description BEFORE the share dialog ever opens, and the dialog seeds
 * from it. The network half appears only when `metadata.communityPlanId`
 * says this board came from (or became) a post.
 *
 * Collapsed to one slim bar by default. The bar is one big button - tap to
 * open, tap to close - deliberately no swipe gesture: the board above it owns
 * the touch gestures, and a bar you tap cannot be claimed by a pan.
 */

const OPEN_STORAGE_KEY = "gtnh-factory-flow.plan-card-open.v1";

export function PlanIdentityDrawer() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const setProjectIdentity = useFactoryStore((state) => state.setProjectIdentity);

  // Closed until the browser says otherwise. Read in an effect rather than in
  // the initializer so the server-rendered bar matches the first client paint.
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_STORAGE_KEY) === "1");
    } catch {
      // Blocked storage just means the card starts closed every visit.
    }
  }, []);
  const toggleOpen = () => {
    setOpen((open) => {
      try {
        window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "0" : "1");
      } catch {
        // Same: the toggle still works for the session.
      }
      return !open;
    });
  };

  // The name is the design tab's name (every save stamps the tab's name over
  // the plan), so committing it is a tab rename - once, on blur or Enter,
  // never per keystroke. An emptied field snaps back to the stored name.
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const [nameDraft, setNameDraft] = useState<string>();
  const commitName = () => {
    const next = nameDraft?.trim();
    setNameDraft(undefined);
    if (next && next !== project.name && activeDesignId) {
      void renameDesign(activeDesignId, next);
    }
  };
  const [isPickingIcon, setPickingIcon] = useState(false);

  // The blurb commits on a short debounce (plus blur), not per keystroke:
  // everything subscribed to the project re-renders per commit, and typing
  // deserves better than a board-wide render per letter.
  const [descriptionDraft, setDescriptionDraft] = useState<string>();
  const descriptionTimer = useRef<number | undefined>(undefined);
  const commitDescription = (value: string) => {
    window.clearTimeout(descriptionTimer.current);
    setProjectIdentity({ description: value });
    setDescriptionDraft(undefined);
  };
  useEffect(() => () => window.clearTimeout(descriptionTimer.current), []);

  const stats = useMemo(
    () => computeCommunityPlanStats(project, lastResult),
    [project, lastResult],
  );

  const linkedPlanId = project.metadata?.communityPlanId;

  return (
    <section
      data-help-anchor="plan-card"
      className="shrink-0 border-t border-line bg-surface"
    >
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close the plan card" : "Open the plan card"}
        className="flex h-7 w-full items-center gap-2 px-2 text-xs text-fg-subtle hover:bg-surface-raised"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        )}
        <EntryIconSlot icon={project.icon} className="!h-5 !w-5 shrink-0" />
        <span className="min-w-0 truncate font-medium text-fg">{project.name}</span>
        {linkedPlanId ? (
          <span className="shrink-0 rounded border border-line px-1 py-px text-[10px] text-fg-muted">
            On the network
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-widest text-fg-muted compact:hidden">
          Plan card
        </span>
      </button>

      {isOpen ? (
        <div className="grid max-h-[45vh] grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-3 overflow-y-auto border-t border-line p-3 compact:grid-cols-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <EntryIconSlot
                icon={project.icon}
                editable
                onEdit={() => setPickingIcon(true)}
                className="!h-9 !w-9 shrink-0 border border-line-strong bg-surface-sunken"
              />
              <input
                value={nameDraft ?? project.name}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                maxLength={80}
                aria-label="Plan name"
                title="Also the tab's name: renaming here renames the tab"
                className="w-full min-w-0 rounded border border-line-strong bg-surface-sunken px-2 py-1.5 text-sm"
              />
            </div>
            <textarea
              value={descriptionDraft ?? project.description ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setDescriptionDraft(value);
                window.clearTimeout(descriptionTimer.current);
                descriptionTimer.current = window.setTimeout(() => commitDescription(value), 400);
              }}
              onBlur={(event) => commitDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What does it make? Any setup notes?"
              aria-label="Plan description"
              className="mt-2 w-full resize-y rounded border border-line-strong bg-surface-sunken px-2 py-1.5 text-xs"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              Saved with this plan. Sharing posts it under this name, icon and description.
            </p>
          </div>

          {linkedPlanId ? (
            <LinkedPostPanel key={linkedPlanId} planId={linkedPlanId} project={project} />
          ) : (
            <div className="rounded border border-line bg-surface-raised p-2.5 text-[11px] leading-relaxed text-fg-muted">
              Not on the network. The Share button at the top of the page posts this plan, and
              this card then shows the post: author, votes, and a reset back to the posted
              version.
            </div>
          )}
        </div>
      ) : null}

      {isPickingIcon ? (
        <IconPicker
          title="Pick this plan's icon"
          suggestions={iconSuggestionsFromStats(stats.needs, stats.outputs)}
          onPick={(picked) => {
            setProjectIdentity({ icon: picked });
            setPickingIcon(false);
          }}
          onClear={
            project.icon
              ? () => {
                  setProjectIdentity({ icon: null });
                  setPickingIcon(false);
                }
              : undefined
          }
          onClose={() => setPickingIcon(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * The network half of the card, mounted only while the card is open and the
 * plan carries a post link - so the summary fetch and the fingerprint math
 * only ever run for someone actually looking at them.
 */
function LinkedPostPanel({ planId, project }: { planId: string; project: FactoryProject }) {
  const setProject = useFactoryStore((state) => state.setProject);
  const frameBoardNodes = useFactoryStore((state) => state.frameBoardNodes);
  const clearProjectCommunityLink = useFactoryStore((state) => state.clearProjectCommunityLink);

  const [post, setPost] = useState<CommunityPlanSummary>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<"reset" | "save" | "vote">();
  const [actionError, setActionError] = useState<string>();
  const [isLinkCopied, setLinkCopied] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    // A background lookup, not a reader opening the post: no view counted.
    void getCommunityPlan(planId, { countView: false }).then(
      (summary) => {
        if (!cancelled) {
          setPost(summary);
          setLoadState("ready");
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Loading the post failed.";
        if (/not found/i.test(message)) {
          setLoadState("gone");
        } else {
          setLoadError(message);
          setLoadState("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [planId, refreshTick]);

  // What the board IS right now, against what it was when board and post
  // last agreed. Recomputed per board edit, but only while this panel is
  // mounted - an open card with a linked plan.
  const boardFingerprint = useMemo(() => planContentFingerprint(project), [project]);
  const baseline = project.metadata?.communityFingerprint;
  // A copy from before fingerprints existed has no baseline; reset stays
  // offered, because "unchanged" cannot be proven.
  const isUnchanged = Boolean(baseline) && baseline === boardFingerprint;

  const reset = async () => {
    if (
      !window.confirm(
        `Put the posted version of "${post?.name ?? project.name}" back on this board? ` +
          "Your changes here will be lost, and this cannot be undone.",
      )
    ) {
      return;
    }

    setBusy("reset");
    setActionError(undefined);
    try {
      const { plan } = await downloadCommunityPlan(planId);
      const restored = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(plan, planId)),
      );
      setProject(restored);
      frameBoardNodes();
    } catch (resetError) {
      setActionError(resetError instanceof Error ? resetError.message : "Reset failed.");
    } finally {
      setBusy(undefined);
    }
  };

  const saveDetails = async () => {
    setBusy("save");
    setActionError(undefined);
    try {
      await patchCommunityPlan(planId, {
        name: project.name,
        description: project.description ?? "",
        icon: project.icon ?? null,
      });
      setPost((current) =>
        current
          ? {
              ...current,
              name: project.name,
              description: project.description ?? "",
              icon: project.icon,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      notifySetupsChanged();
    } catch (saveError) {
      setActionError(
        saveError instanceof Error ? saveError.message : "Saving to the post failed.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const vote = async () => {
    setBusy("vote");
    setActionError(undefined);
    try {
      const response = await voteCommunityPlan(planId, 1);
      setPost((current) =>
        current
          ? {
              ...current,
              upvotes: response.upvotes,
              downvotes: response.downvotes,
              score: response.score,
              myVote: response.myVote,
            }
          : current,
      );
    } catch (voteError) {
      setActionError(voteError instanceof Error ? voteError.message : "Voting failed.");
    } finally {
      setBusy(undefined);
    }
  };

  const copyLink = async () => {
    const url = sharedPlanLink(planId);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
  };

  if (loadState === "loading") {
    return (
      <div className="grid place-items-center rounded border border-line bg-surface-raised p-4 text-fg-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (loadState === "gone") {
    return (
      <div className="rounded border border-line bg-surface-raised p-2.5 text-[11px] leading-relaxed text-fg-muted">
        <p>The post this plan came from is no longer on the network.</p>
        <button
          type="button"
          onClick={clearProjectCommunityLink}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-line-strong px-2 py-1 text-xs text-fg-subtle hover:bg-surface-sunken"
        >
          <Unlink className="h-3.5 w-3.5" /> Detach from it
        </button>
      </div>
    );
  }

  if (loadState === "error" || !post) {
    return (
      <div className="rounded border border-line bg-surface-raised p-2.5 text-[11px] leading-relaxed text-fg-muted">
        <p>{loadError ?? "Loading the post failed."}</p>
        <button
          type="button"
          onClick={() => setRefreshTick((tick) => tick + 1)}
          className="mt-2 rounded border border-line-strong px-2 py-1 text-xs text-fg-subtle hover:bg-surface-sunken"
        >
          Try again
        </button>
      </div>
    );
  }

  // updated_at is stamped on insert too, so "edited" only means anything once
  // it has drifted a minute past "posted".
  const wasEdited =
    post.updatedAt &&
    new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 60_000;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded border border-line bg-surface-raised p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <EntryIconSlot icon={post.icon} className="!h-5 !w-5 shrink-0" />
        <span className="min-w-0 truncate font-medium text-fg">{post.name}</span>
        <button
          type="button"
          onClick={() => void copyLink()}
          title="Copy the link to this post"
          aria-label="Copy the link to this post"
          className="ml-auto shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-sunken"
        >
          {isLinkCopied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <p className="text-[11px] text-fg-muted">
        {post.isMine ? "Your post" : post.authorName ? `By ${post.authorName}` : "On the network"}
        {" · posted "}
        {formatRelativeDate(post.createdAt)}
        {wasEdited && post.updatedAt ? ` · edited ${formatRelativeDate(post.updatedAt)}` : ""}
      </p>

      {post.description ? (
        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-fg-subtle">
          {post.description}
        </p>
      ) : null}

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void vote()}
          disabled={busy === "vote"}
          title={post.myVote === 1 ? "You voted this setup up" : "Vote this setup up"}
          className={[
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 tabular-nums",
            post.myVote === 1
              ? "border-emerald-600 text-emerald-500"
              : "border-line-strong text-fg-subtle hover:bg-surface-sunken",
          ].join(" ")}
        >
          <ArrowBigUp className="h-3.5 w-3.5" /> {post.score}
        </button>
        <span
          title={`Downloaded ${post.downloads} times`}
          className="inline-flex items-center gap-1 text-fg-muted tabular-nums"
        >
          <Download className="h-3.5 w-3.5" /> {post.downloads}
        </span>

        <span className="ml-auto inline-flex items-center gap-1.5">
          {post.isMine ? (
            <button
              type="button"
              onClick={() => void saveDetails()}
              disabled={busy === "save"}
              title="Rename the post to this card's name, icon and description. The board itself is only re-posted through Share."
              className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 text-fg-subtle hover:bg-surface-sunken disabled:cursor-wait disabled:text-fg-muted"
            >
              {busy === "save" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save details to post
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void reset()}
            disabled={isUnchanged || busy === "reset"}
            title={
              isUnchanged
                ? "The board still matches the post: nothing to reset"
                : "Replace this board with the version on the network"
            }
            className="inline-flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:border-line disabled:text-fg-muted"
          >
            {busy === "reset" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Reset to posted version
          </button>
        </span>
      </div>

      {actionError ? <p className="text-[11px] text-red-500">{actionError}</p> : null}
    </div>
  );
}
