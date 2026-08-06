"use client";

import { Check, Link2, LoaderCircle, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import {
  listCommunityPlans,
  updateCommunityPlan,
  uploadCommunityPlan,
} from "@/lib/community/client";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { formatRate } from "@/lib/model";
import { serializeFactoryProject } from "@/lib/import-export";
import { openSetupsTab } from "@/lib/setups-tab";
import { useFactoryStore } from "@/store/factory-store";
import { AuthForm, useCommunityUser } from "./auth";

export function SharePlanDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const setProjectCommunityLink = useFactoryStore((state) => state.setProjectCommunityLink);
  const { user, isLoading: isUserLoading, setUser } = useCommunityUser();

  const [name, setName] = useState(project.name || "My factory");
  const [description, setDescription] = useState("");
  const [myPostsFor, setMyPostsFor] = useState<{
    username: string;
    posts: CommunityPlanSummary[];
  }>();
  const [postAsNew, setPostAsNew] = useState(false);
  const myPosts = user && myPostsFor?.username === user.username ? myPostsFor.posts : [];
  // The design remembers which post it was shared as / imported from; Share
  // only ever targets that one post (or creates a new one).
  const linkedPost = myPosts.find((post) => post.id === project.metadata?.communityPlanId);
  const updateTargetId = linkedPost && !postAsNew ? linkedPost.id : "";
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [shared, setShared] = useState<{ kind: "created" | "updated"; planId: string }>();
  const [isLinkCopied, setLinkCopied] = useState(false);

  const stats = useMemo(() => computeCommunityPlanStats(project, result), [project, result]);
  const datasetVersion = manifest?.versions.find(
    (version) => version.id === selectedDatasetVersionId,
  );

  // Once signed in, load the user's existing posts so they can update one.
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    void listCommunityPlans({ mine: true, pageSize: 48 }).then(
      (response) => {
        if (!cancelled) {
          setMyPostsFor({ username: user.username, posts: response.plans });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Updating an existing post starts from its current tags; a fresh post
  // starts blank. Seeded the moment the linked post arrives (adjust-during-
  // render, so the user's later edits are never overwritten).
  const [seededPostId, setSeededPostId] = useState<string>();
  if (linkedPost && seededPostId !== linkedPost.id) {
    setSeededPostId(linkedPost.id);
    setTags(linkedPost.tags ?? []);
  }

  const addTagFromInput = () => {
    const next = normalizeBlueprintTags([...tags, tagInput]);
    setTags(next);
    setTagInput("");
    return next;
  };

  const share = async () => {
    setUploading(true);
    setError(undefined);
    try {
      // Whatever is still sitting in the tag input counts as one last tag.
      const finalTags = tagInput.trim() ? addTagFromInput() : tags;
      const payload = {
        name,
        description,
        gameVersion: datasetVersion?.gtnhVersion ?? "",
        datasetVersionId: selectedDatasetVersionId ?? "",
        plan: JSON.parse(serializeFactoryProject(project)) as unknown,
        tags: finalTags,
      };

      if (updateTargetId) {
        await updateCommunityPlan(updateTargetId, payload);
        setShared({ kind: "updated", planId: updateTargetId });
        setProjectCommunityLink(updateTargetId);
      } else {
        const { id } = await uploadCommunityPlan(payload);
        setShared({ kind: "created", planId: id });
        setProjectCommunityLink(id);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Sharing failed.");
    } finally {
      setUploading(false);
    }
  };

  const copyShareLink = async () => {
    if (!shared) {
      return;
    }

    const url = `${window.location.origin}/?plan=${shared.planId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="w-full max-w-lg rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Share2 className="h-4 w-4" /> Share your setup
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {shared ? (
          <div className="space-y-3">
            <p className="text-sm">
              {shared.kind === "updated"
                ? "Your post has been updated."
                : "Your plan is live. Thanks for sharing!"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyShareLink()}
                title="The link opens this setup in a friend's planner"
                className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                {isLinkCopied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Copy link
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                openSetupsTab();
              }}
              className="inline-flex rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              See it on the Setups shelf
            </button>
          </div>
        ) : isUserLoading ? (
          <div className="grid place-items-center py-8 text-fg-muted">
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </div>
        ) : !user ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-subtle">
              Sharing needs an account so your posts stay yours â€” just a username and password.
            </p>
            <AuthForm onSignedIn={setUser} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              Posting as <span className="font-semibold text-fg">{user.username}</span>
            </p>

            {linkedPost ? (
              <div className="flex gap-3 rounded border border-line bg-surface-raised p-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-target"
                    checked={!postAsNew}
                    onChange={() => setPostAsNew(false)}
                  />
                  Update â€œ{linkedPost.name}â€
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-target"
                    checked={postAsNew}
                    onChange={() => setPostAsNew(true)}
                  />
                  Post as new
                </label>
              </div>
            ) : null}

            <div className="rounded border border-line bg-surface-raised p-2 text-xs text-fg-subtle">
              <p>
                {stats.nodeCount} nodes Â· {stats.machineCount} machines
                {stats.highestTier ? ` Â· up to ${stats.highestTier}` : ""}
                {` Â· ${formatRate(Math.abs(stats.totalEuT), 3)} EU/t`}
              </p>
              <p className="truncate">
                {datasetVersion?.gtnhVersion
                  ? `GTNH ${datasetVersion.gtnhVersion}`
                  : (selectedDatasetVersionId ?? "no dataset")}
              </p>
              <p className="mt-1 text-fg-muted">
                Needs {stats.needs.length} resources, produces {stats.outputs.length}.
              </p>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                className="w-full rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Description (optional)</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="What does it make? Any setup notes?"
                className="w-full resize-y rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
              />
            </label>
            <div className="block text-sm">
              <span className="mb-1 block font-medium">Tags (optional)</span>
              <div className="flex flex-wrap items-center gap-1 rounded border border-line-strong bg-surface-sunken px-2 py-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                    title={`Remove #${tag}`}
                    className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-subtle hover:border-red-500 hover:text-red-500"
                  >
                    #{tag} ×
                  </button>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTagFromInput();
                    }
                  }}
                  placeholder={tags.length === 0 ? "platline, oil, early game..." : ""}
                  className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void share()}
                disabled={isUploading || !name.trim() || project.nodes.length === 0}
                className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {updateTargetId ? "Update post" : "Share plan"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
