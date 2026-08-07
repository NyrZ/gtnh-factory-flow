"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  DEFAULT_DATASET_MANIFEST_URL,
  fetchDatasetManifest,
  pickDefaultDatasetVersion,
} from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  initRecipeDatasetVersion,
} from "@/lib/datasets/browser-loader";
import { loadResourceHistory, useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { recordResourceTrend, resetResourceTrends } from "@/lib/resource-trends";
import { useWorkspaceView, writeWorkspaceView } from "@/lib/workspace-view";
import { downloadCommunityPlan, tagPlanWithCommunityId } from "@/lib/community/client";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { AppHeader } from "./AppHeader";
import { BlueprintSaveDialog } from "./BlueprintSaveDialog";
import { DesignTabs } from "./DesignTabs";
import { FactoryFlow } from "./flow/FactoryFlow";
import { InspectorPanel } from "./InspectorPanel";
import { RecipeBrowser } from "./RecipeBrowser";

export function FactoryPlannerApp() {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const workspace = useWorkspaceView();
  const hydrateResourceHistory = useFactoryStore((state) => state.hydrateResourceHistory);
  const hydrateDesigns = useDesignStore((state) => state.hydrate);
  const saveActiveProject = useDesignStore((state) => state.saveActiveProject);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const setDatasetManifest = useFactoryStore((state) => state.setDatasetManifest);
  const setDataset = useFactoryStore((state) => state.setDataset);
  const refreshProjectRecipes = useFactoryStore((state) => state.refreshProjectRecipes);
  const setDatasetLoading = useFactoryStore((state) => state.setDatasetLoading);
  const setDatasetError = useFactoryStore((state) => state.setDatasetError);
  const hydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  const loadDatasetVersion = useCallback(
    async (versionId: string) => {
      const state = useFactoryStore.getState();
      const manifest = state.datasetManifest;
      const manifestUrl = state.datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;
      const version = manifest?.versions.find((entry) => entry.id === versionId);

      if (!manifest || !version) {
        setDatasetError(`Dataset version "${versionId}" is not available in the manifest.`);
        return;
      }

      try {
        setDatasetLoading(true);
        const dataset = await initRecipeDatasetVersion(manifestUrl, version);
        setDataset(dataset);
        const projectRecipes = useFactoryStore.getState().project.recipes;
        if (projectRecipes.length > 0) {
          const refreshedRecipes = (
            await Promise.allSettled(
              projectRecipes.map((recipe) =>
                getRecipeDatasetRecipe(manifestUrl, version, recipe.id),
              ),
            )
          )
            .filter((result): result is PromiseFulfilledResult<(typeof projectRecipes)[number]> => {
              return result.status === "fulfilled";
            })
            .map((result) => result.value);
          refreshProjectRecipes(refreshedRecipes);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dataset load failed.";
        setDatasetError(message);
      }
    },
    [refreshProjectRecipes, setDataset, setDatasetError, setDatasetLoading],
  );

  useEffect(() => {
    const cancelHydration = scheduleIdleWork(() => {
      hydrateResourceHistory(loadResourceHistory());

      void hydrateDesigns()
        .then(async () => {
          // A setup opened from a shared link becomes its own design tab, so
          // it never overwrites whatever the user was working on.
          const importAsDesign = async (raw: unknown) => {
            const project = parseFactoryProjectJson(JSON.stringify(raw));
            await useDesignStore
              .getState()
              .importProjectAsDesign(project, project.name || "Shared setup");
          };

          try {
            // Shared "open to edit" links: /?plan=<community id>.
            const params = new URLSearchParams(window.location.search);
            const sharedPlanId = params.get("plan");
            if (sharedPlanId) {
              try {
                const { plan } = await downloadCommunityPlan(sharedPlanId);
                await importAsDesign(tagPlanWithCommunityId(plan, sharedPlanId));
              } finally {
                params.delete("plan");
                const query = params.toString();
                window.history.replaceState(
                  null,
                  "",
                  `${window.location.pathname}${query ? `?${query}` : ""}`,
                );
              }
            }
          } catch (error) {
            console.error(
              error instanceof Error ? error.message : "Importing the shared setup failed.",
            );
          }
        })
        .finally(() => {
          // Autosave stays parked until the stored design is on the canvas.
          // Releasing it earlier would let the empty starting plan be written
          // over the design that is still loading.
          hydratedRef.current = true;
        });
    }, 800);

    return cancelHydration;
  }, [hydrateDesigns, hydrateResourceHistory]);

  // Recorded here rather than in the resource panel: the charts must not lose
  // their history because the right column happened to be closed, and every
  // path that re-solves lands in `lastResult` whether it came from the board,
  // an undo, or a dataset reload.
  useEffect(() => {
    recordResourceTrend(lastResult);
  }, [lastResult]);

  // A different design is a different story, so the chart starts over.
  useEffect(() => {
    resetResourceTrends();
  }, [activeDesignId]);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest() {
      try {
        setDatasetLoading(true);
        const manifest = await fetchDatasetManifest(DEFAULT_DATASET_MANIFEST_URL);
        if (cancelled) {
          return;
        }

        setDatasetManifest(manifest, DEFAULT_DATASET_MANIFEST_URL);
        if (!pickDefaultDatasetVersion(manifest)) {
          setDatasetLoading(false);
          return;
        }

        void loadDatasetVersion(pickDefaultDatasetVersion(manifest)!.id);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Dataset manifest load failed.";
        setDatasetError(message);
      }
    }

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [loadDatasetVersion, setDatasetError, setDatasetLoading, setDatasetManifest]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }

    if (saveTimeoutRef.current !== undefined) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    // The design id is captured here, alongside the plan it belongs to. The
    // save can land up to ~1.5s later, by which point the active design may
    // have changed; the store drops the write rather than misfiling it.
    const savingDesignId = activeDesignId;
    saveTimeoutRef.current = window.setTimeout(() => {
      scheduleIdleWork(() => {
        void saveActiveProject(savingDesignId, project);
      }, 1200);
    }, 350);

    return () => {
      if (saveTimeoutRef.current !== undefined) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeDesignId, project, saveActiveProject]);

  return (
    <div className="flex h-screen min-h-[720px] flex-col bg-canvas text-fg">
      <AppHeader />
      {/* 344/332: the browser column carries three iconed tabs and the setup
          shelf, so it gets a touch more than the old 312; the resource column
          went from 277 to fit a rate, a name and the mark buttons on one line
          without the name truncating to nothing. A closed column drops to a
          rail wide enough for one button, so the way back is always on screen
          and the board never has to give the width back to a hover target. */}
      <main
        className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
        style={{
          gridTemplateColumns: [
            workspace.leftPanelOpen ? "344px" : `${RAIL_WIDTH}px`,
            "minmax(0,1fr)",
            workspace.rightPanelOpen ? "332px" : `${RAIL_WIDTH}px`,
          ].join(" "),
        }}
      >
        {/* Each column carries its own header row, all the same height, so the
            three line up where the full-width bar used to be. */}
        {/* The browser owns its own header row, so no wrapper here — it stays a
            direct grid item at exactly the column width, as it was before. */}
        {workspace.leftPanelOpen ? (
          <RecipeBrowser onLoadDatasetVersion={loadDatasetVersion} />
        ) : (
          <PanelRail side="left" label="Items, blueprints and setups" />
        )}
        {/*
          The tab strip belongs to the canvas, not the window: designs switch
          what is on the board, while the browser and inspector are fixed
          furniture. Rows rather than flex so the board keeps its `h-full`.
        */}
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
          <DesignTabs />
          <FactoryFlow />
        </div>
        {workspace.rightPanelOpen ? (
          <InspectorPanel />
        ) : (
          <PanelRail side="right" label="Resources" />
        )}
      </main>
      {/* Every pocket-to-blueprint path (card save, share-a-pocket,
          overwrite) confirms through this one dialog. */}
      <BlueprintSaveDialog />
    </div>
  );
}

/** Wide enough for one 24px button plus its border. */
const RAIL_WIDTH = 26;

/**
 * What a closed side column leaves behind: a rail carrying the button that
 * opens it again, plus the column's name set sideways.
 *
 * A rail rather than a hover-to-peek edge. Peeking hands the column back for
 * as long as the pointer stays put, which makes it useless for anything you
 * want to read while working on the board, and it fires by accident every time
 * the mouse crosses the edge. A rail costs 26px and is never ambiguous.
 */
function PanelRail({ side, label }: { side: "left" | "right"; label: string }) {
  const open = () =>
    writeWorkspaceView(side === "left" ? { leftPanelOpen: true } : { rightPanelOpen: true });

  return (
    <div
      className={[
        "flex h-full flex-col items-center gap-2 bg-surface py-2",
        side === "left" ? "border-r border-line" : "border-l border-line",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={open}
        title={`Show ${label}`}
        aria-label={`Show ${label}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line-strong text-fg-muted hover:border-cyan-600 hover:text-cyan-400"
      >
        <ChevronIcon direction={side === "left" ? "right" : "left"} />
      </button>
      <button
        type="button"
        onClick={open}
        tabIndex={-1}
        aria-hidden
        className="min-h-0 flex-1 cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-fg-muted hover:text-fg"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <span className={side === "right" ? "rotate-180" : undefined}>{label}</span>
      </button>
    </div>
  );
}

export function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "right" ? <path d="M6 3l5 5-5 5" /> : <path d="M10 3L5 8l5 5" />}
    </svg>
  );
}

function scheduleIdleWork(callback: () => void, timeout: number) {
  const browserWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

  if (browserWindow.requestIdleCallback && browserWindow.cancelIdleCallback) {
    const idleId = browserWindow.requestIdleCallback(callback, { timeout });
    return () => browserWindow.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timeoutId);
}
