"use client";

import { create } from "zustand";
import { createEmptyProject } from "@/examples";
import type { DatasetManifest, RecipeDataset } from "@/lib/datasets";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { setActiveRateUnit, type RateUnit } from "@/lib/model/rate-unit";
import { calculateThroughput } from "@/lib/solver";
import {
  applyRecipeInputOverrides,
  crossKindInputOverrideAmount,
} from "@/lib/model/recipe-input-overrides";
import { createCropFarmPlaceholderRecipe } from "@/lib/model/passive-production";
import {
  createCustomRatePlaceholderRecipe,
  getCustomRateSlot,
  isCustomRateRecipe,
  withCustomRateSlot,
  type CustomRateMode,
} from "@/lib/model/custom-rate";
import {
  createTrashPlaceholderRecipe,
  isTrashRecipe,
  TRASH_ANY_RESOURCE_ID,
} from "@/lib/model/trash";
import { optimizeMachineCountsForProject } from "@/lib/solver/machine-count-optimizer";
import {
  BOARD_GRID,
  RECIPE_NODE_WIDTH,
  snapPositionToGrid,
  snapSizeUpToGrid,
} from "@/lib/board-grid";
import {
  getFilledCellFluidEquivalent,
  getResourceKey,
  isOreDictionaryResource,
  isRecipeInputConsumed,
  resourceMatchesInput,
  resourceLabel,
} from "@/lib/model/resources";
import type {
  FactoryAnnotation,
  FactoryEdge,
  FactoryNode,
  FactoryNodeColorTag,
  FactoryPocket,
  FactoryProject,
  FactoryStorage,
  MachineTier,
  Recipe,
  ResourceAmount,
  ResourceKind,
  TargetRate,
  ThroughputResult,
} from "@/lib/model/types";

export const LOCAL_STORAGE_KEY = "gtnh-factory-flow.project.v2";
export const RESOURCE_HISTORY_STORAGE_KEY = "gtnh-factory-flow.resource-history.v1";
const RESOURCE_HISTORY_LIMIT = 30;
const PROJECT_HISTORY_LIMIT = 100;

interface FactoryStore {
  project: FactoryProject;
  undoHistory: FactoryProject[];
  redoHistory: FactoryProject[];
  datasetManifest?: DatasetManifest;
  dataset?: RecipeDataset;
  datasetManifestUrl?: string;
  selectedDatasetVersionId?: string;
  isDatasetLoading: boolean;
  isProjectImporting: boolean;
  datasetError?: string;
  recipeSearch: string;
  /**
   * Debounced mirror of `recipeSearch`, published by the recipe browser and read
   * by the canvas.
   *
   * The raw query changes on every keystroke, and everything that highlights
   * against it — every node, every storage, the whole edge array — is expensive
   * to re-render. Splitting the two keeps typing local to the browser panel.
   */
  highlightSearch: string;
  maxTierFilter: TierFilter;
  recipeBrowserResource?: RecipeBrowserResource;
  recipeBrowserMode: RecipeBrowserMode;
  recipeResourceHistory: RecipeBrowserResource[];
  pendingResourceConnection?: PendingResourceConnection;
  nodeColorPaintMode?: FactoryNodeColorTag | null;
  // The read-only display modes (heatmap, the three line modes) are NOT here:
  // they are per-person view settings that must survive a reload, so they live
  // in `board-view.ts` behind localStorage. Keeping them in this store would
  // have meant either losing them on refresh or persisting them with the plan.
  hoveredStorageResourceKey?: string;
  hoveredFlowResourceKey?: string;
  selectedFlowResourceKey?: string;
  /**
   * The flow neighbourhood under the cursor: hovering a port lights every
   * edge on it plus their far-end ports; hovering an edge label lights that
   * line and both endpoints. Maps give O(1) membership for per-element
   * selectors.
   */
  hoveredFlowScope?: {
    edges: Record<string, true>;
    ports: Record<string, true>;
    nodes: Record<string, true>;
  };
  hoveredNodeBottlenecks: boolean;
  selectedNodeBottlenecks: boolean;
  /** Node hovered in the inspector's usage grid, highlighted on the canvas. */
  hoveredUsageNodeId?: string;
  flowViewportCenter?: FactoryNode["position"];
  selectedNodeId?: string;
  selectedRecipeId?: string;
  lastResult: ThroughputResult;
  /** Board-wide display unit for rates: per second / minute / hour. */
  rateUnit: RateUnit;
  setRateUnit: (unit: RateUnit) => void;
  setProject: (project: FactoryProject) => void;
  markHydratedProject: (project: FactoryProject) => void;
  undo: () => void;
  redo: () => void;
  setDatasetManifest: (manifest: DatasetManifest, manifestUrl: string) => void;
  setDataset: (dataset: RecipeDataset) => void;
  refreshProjectRecipes: (recipes: Recipe[]) => void;
  clearDataset: () => void;
  setDatasetLoading: (isLoading: boolean) => void;
  setProjectImporting: (isImporting: boolean) => void;
  setDatasetError: (error?: string) => void;
  setRecipeSearch: (query: string) => void;
  setHighlightSearch: (query: string) => void;
  setMaxTierFilter: (tier: TierFilter) => void;
  hydrateResourceHistory: (history: RecipeBrowserResource[]) => void;
  browseResource: (resource: RecipeBrowserResource, mode?: RecipeBrowserMode) => void;
  clearResourceBrowser: () => void;
  cleanBoard: () => void;
  selectResourceConnectionSlot: (slot: PendingResourceConnection) => void;
  cancelResourceConnection: () => void;
  setNodeColorPaintMode: (colorTag?: FactoryNodeColorTag | null) => void;
  setHoveredStorageResourceKey: (key?: string) => void;
  setHoveredFlowResourceKey: (key?: string) => void;
  setHoveredFlowScope: (scope?: {
    edges: Record<string, true>;
    ports: Record<string, true>;
    nodes: Record<string, true>;
  }) => void;
  selectFlowResourceKey: (key?: string) => void;
  setHoveredNodeBottlenecks: (isHovered: boolean) => void;
  toggleNodeBottlenecks: () => void;
  setHoveredUsageNodeId: (nodeId?: string) => void;
  setFlowViewportCenter: (position: FactoryNode["position"]) => void;
  recalculate: () => void;
  selectNode: (nodeId?: string) => void;
  selectRecipe: (recipeId?: string) => void;
  addNodeForRecipe: (recipeId: string) => void;
  addNodeForRecipeObject: (
    recipe: Recipe,
    resource?: RecipeInputContextResource,
    options?: { machineHandlerId?: string },
  ) => void;
  addConnectedNodeForRecipe: (
    recipeId: string,
    anchorNodeId: string,
    resource: RecipeInputContextResource,
  ) => void;
  addConnectedNodeForRecipeObject: (
    recipe: Recipe,
    anchorNodeId: string,
    resource: RecipeInputContextResource,
  ) => void;
  updateNode: (nodeId: string, patch: Partial<FactoryNode>) => void;
  /** Drops an empty crop source node; a crop is picked on the node itself. */
  addCropFarmNode: () => void;
  /** A dial-a-rate source/sink node; adopts its resource from the first wire. */
  addCustomRateNode: () => void;
  /** Rate stored per second. Flipping the mode reverses direction and drops wires. */
  setCustomRateConfig: (
    nodeId: string,
    patch: { perSecond?: number; mode?: CustomRateMode },
  ) => void;
  /** Wire landed on a custom-rate node's universal port: adopt + connect. */
  connectCustomRate: (
    customNodeId: string,
    customSide: "input" | "output",
    machine: { nodeId: string; handleId?: string },
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
    >,
  ) => void;
  /** Drops a trash can node: anything wired in is voided, never an output. */
  addTrashNode: () => void;
  /** Wire landed on a trash can: void whatever the far end's output carries. */
  connectTrash: (
    trashNodeId: string,
    source: { nodeId: string; handleId?: string },
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName">,
  ) => void;
  /** Swaps the node onto another recipe (crop pick), resetting per-recipe state. */
  setNodeRecipe: (nodeId: string, recipe: Recipe) => void;
  deleteNode: (nodeId: string) => void;
  addResourceStorage: (
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
    > &
      Partial<Pick<ResourceAmount, "tooltip" | "amount" | "alternatives">>,
  ) => void;
  addStorageForConnection: (
    resource: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
    > &
      Partial<Pick<ResourceAmount, "tooltip" | "amount" | "alternatives">>,
    nodeId: string,
    side: "input" | "output",
    position: FactoryStorage["position"],
    handleId: string,
  ) => void;
  deleteStorage: (storageId: string) => void;
  /** Clone a node (same recipe/config, no wires) beside the original. */
  duplicateNode: (nodeId: string) => void;
  /** Clone a tank/drawer (same resource/color, no wires) beside the original. */
  duplicateStorage: (storageId: string) => void;
  autoRouteStorage: (storageId: string) => void;
  updateStorage: (storageId: string, patch: Partial<FactoryStorage>) => void;
  setStoragePosition: (storageId: string, position: FactoryStorage["position"]) => void;
  /** Records which community post the current design belongs to (no undo entry). */
  setProjectCommunityLink: (communityPlanId: string) => void;
  addAnnotation: (annotation: Omit<FactoryAnnotation, "id">) => void;
  updateAnnotation: (annotationId: string, patch: Partial<FactoryAnnotation>) => void;
  deleteAnnotation: (annotationId: string) => void;
  setAnnotationPosition: (annotationId: string, position: FactoryAnnotation["position"]) => void;
  setNodePosition: (nodeId: string, position: FactoryNode["position"]) => void;
  /**
   * One drop for a whole dragged selection - machines, drawers and
   * annotations land together as a single undo entry. Ids that match nothing
   * are ignored; a drop where nothing actually moved writes no history.
   */
  moveBoardItems: (moves: Array<{ id: string; position: FactoryNode["position"] }>) => void;
  /**
   * Delete a whole selection as a single undo entry. `nodeIds` may hold any
   * mix of machine, storage and annotation ids; wires touching deleted cards
   * go with them, exactly as the one-at-a-time deletes do.
   */
  deleteBoardSelection: (selection: { nodeIds?: string[]; edgeIds?: string[] }) => void;
  /**
   * Paste a copied selection: fresh ids, wires remapped onto the copies,
   * per-node recipes cloned, everything offset and snapped to the grid - one
   * undo entry. Root-level items land in the pocket the board is currently
   * showing. Returns the new ids visible at that level so the caller can
   * select them.
   */
  pasteBoardItems: (payload: BoardClipboardPayload, offset: { x: number; y: number }) => string[];
  /** The pocket dimension the board is currently zoomed into; absent = root. */
  activePocketId?: string;
  /** Zoom the board into a pocket, or back to the root with undefined. */
  enterPocket: (pocketId?: string) => void;
  /**
   * Collapse a selection into a new pocket dimension: members keep their
   * positions and wires, the parent board shows one pocket card in their
   * place. Selected pocket cards nest whole. Returns the new pocket id, or
   * undefined when the selection held nothing.
   */
  compactSelectionIntoPocket: (ids: string[], name?: string) => string | undefined;
  /** Unpack a pocket: members surface on the pocket's parent board. */
  dissolvePocket: (pocketId: string) => void;
  renamePocket: (pocketId: string, name: string) => void;
  /**
   * Ids the board should hand the selection to after the next project sync -
   * how a paste or a blueprint load arrives already selected.
   */
  pendingBoardSelectionIds?: string[];
  setPendingBoardSelection: (ids?: string[]) => void;
  /** The board's live selection, published for panels outside the canvas. */
  selectedBoardIds: string[];
  setSelectedBoardIds: (ids: string[]) => void;
  connectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    resource?: Pick<
      ResourceAmount,
      "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
    > & {
      sourceHandle?: string;
      targetHandle?: string;
    },
  ) => void;
  reconnectEdge: (
    edgeId: string,
    connection: {
      source?: string | null;
      target?: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void;
  updateEdge: (edgeId: string, patch: Partial<FactoryEdge>) => void;
  autoConnectNode: (nodeId: string) => void;
  optimizeMachineCount: (nodeId: string) => void;
  optimizeMachineCounts: () => void;
  deleteEdge: (edgeId: string) => void;
  setTargetRate: (targetRate?: TargetRate) => void;
  selectFuelProfile: (fuelProfileId: string) => void;
  renameProject: (name: string) => void;
}

const initialProject = createEmptyProject();

/**
 * What Ctrl+C lifts off the board: the selected items verbatim, the wires
 * that run between two selected items, and the recipes those items lean on -
 * carried along so a paste into another design (or after the originals were
 * deleted) still has everything it needs. Selecting a pocket card lifts the
 * whole pocket: the pocket itself, every member, and every nested pocket.
 * Blueprints save exactly this payload.
 */
export interface BoardClipboardPayload {
  nodes: FactoryNode[];
  storages: FactoryStorage[];
  annotations: FactoryAnnotation[];
  pockets: FactoryPocket[];
  edges: FactoryEdge[];
  recipes: Recipe[];
}

/**
 * Expand a board selection through pocket membership: selecting a pocket
 * card means selecting everything inside it, transitively. Returns the
 * concrete item ids (nodes/storages/annotations) and the pocket ids.
 */
function collectPocketSelection(
  project: FactoryProject,
  selectedIds: Iterable<string>,
): { itemIds: Set<string>; pocketIds: Set<string> } {
  const pockets = project.pockets ?? [];
  const selected = new Set(selectedIds);
  const pocketIds = new Set<string>();
  const queue: string[] = [];
  for (const pocket of pockets) {
    if (selected.has(pocket.id)) {
      pocketIds.add(pocket.id);
      queue.push(pocket.id);
    }
  }
  while (queue.length > 0) {
    const parentId = queue.pop();
    for (const pocket of pockets) {
      if (pocket.parentPocketId === parentId && !pocketIds.has(pocket.id)) {
        pocketIds.add(pocket.id);
        queue.push(pocket.id);
      }
    }
  }

  const itemIds = new Set<string>();
  const isMember = (item: { id: string; pocketId?: string }) =>
    selected.has(item.id) || (item.pocketId !== undefined && pocketIds.has(item.pocketId));
  for (const node of project.nodes) {
    if (isMember(node)) {
      itemIds.add(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (isMember(storage)) {
      itemIds.add(storage.id);
    }
  }
  for (const annotation of project.annotations ?? []) {
    if (isMember(annotation)) {
      itemIds.add(annotation.id);
    }
  }
  return { itemIds, pocketIds };
}

/**
 * Snapshot a board selection as a clipboard/blueprint payload. Pocket cards
 * expand to their full contents; wires survive only when both feet stand
 * inside the capture. Returns undefined when the selection holds nothing.
 */
export function captureBoardSelection(
  project: FactoryProject,
  selectedIds: Iterable<string>,
): BoardClipboardPayload | undefined {
  const { itemIds, pocketIds } = collectPocketSelection(project, selectedIds);
  const nodes = project.nodes.filter((node) => itemIds.has(node.id));
  const storages = (project.storages ?? []).filter((storage) => itemIds.has(storage.id));
  const annotations = (project.annotations ?? []).filter((annotation) =>
    itemIds.has(annotation.id),
  );
  if (nodes.length + storages.length + annotations.length + pocketIds.size === 0) {
    return undefined;
  }

  const recipeIds = new Set(nodes.map((node) => node.recipeId));
  // Snapshotted, not referenced: the capture must not change when the
  // originals are edited or deleted afterwards.
  return structuredClone({
    nodes,
    storages,
    annotations,
    pockets: (project.pockets ?? []).filter((pocket) => pocketIds.has(pocket.id)),
    edges: project.edges.filter(
      (edge) => itemIds.has(edge.source) && itemIds.has(edge.target),
    ),
    recipes: project.recipes.filter((recipe) => recipeIds.has(recipe.id)),
  });
}

export type RecipeBrowserMode = "recipes" | "uses";
export type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

type RecipeInputContextResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip" | "modId"
> & {
  mode: RecipeBrowserMode;
  inputIndex?: number;
  neiSlot?: ResourceAmount["neiSlot"];
};

export interface RecipeBrowserResource {
  kind: ResourceKind;
  id: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  anchorNodeId?: string;
}

export interface PendingResourceConnection {
  nodeId: string;
  side: "input" | "output";
  kind: ResourceKind;
  resourceId: string;
  alternatives?: ResourceAmount["alternatives"];
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  handleId: string;
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  project: initialProject,
  undoHistory: [],
  redoHistory: [],
  datasetManifest: undefined,
  dataset: undefined,
  datasetManifestUrl: undefined,
  selectedDatasetVersionId: undefined,
  isDatasetLoading: false,
  isProjectImporting: false,
  datasetError: undefined,
  recipeSearch: "",
  highlightSearch: "",
  maxTierFilter: "all",
  recipeBrowserResource: undefined,
  recipeBrowserMode: "recipes",
  recipeResourceHistory: [],
  pendingResourceConnection: undefined,
  nodeColorPaintMode: undefined,
  hoveredStorageResourceKey: undefined,
  hoveredFlowResourceKey: undefined,
  hoveredFlowScope: undefined,
  selectedFlowResourceKey: undefined,
  hoveredNodeBottlenecks: false,
  selectedNodeBottlenecks: false,
  hoveredUsageNodeId: undefined,
  selectedNodeId: undefined,
  selectedRecipeId: undefined,
  activePocketId: undefined,
  pendingBoardSelectionIds: undefined,
  selectedBoardIds: [],
  lastResult: calculateThroughput(initialProject),
  rateUnit: "second",
  setRateUnit: (unit) => {
    // The formatters read a module singleton; recomputing the result gives
    // every rate surface a fresh identity so nothing shows a stale unit.
    setActiveRateUnit(unit);
    const { project } = get();
    set({ rateUnit: unit, lastResult: calculateThroughput(project) });
  },
  setProject: (project) => {
    const nextProject = touchProject(normalizeLoadedProject(project));
    set({
      project: nextProject,
      selectedNodeId: nextProject.nodes[0]?.id,
      selectedRecipeId: nextProject.nodes[0]?.recipeId ?? nextProject.recipes[0]?.id,
      activePocketId: undefined,
      pendingBoardSelectionIds: undefined,
      selectedBoardIds: [],
      lastResult: calculateThroughput(nextProject),
      undoHistory: [],
      redoHistory: [],
    });
  },
  markHydratedProject: (project) => {
    const nextProject = normalizeLoadedProject(project);
    set({
      project: nextProject,
      selectedNodeId: nextProject.nodes[0]?.id,
      selectedRecipeId: nextProject.nodes[0]?.recipeId ?? nextProject.recipes[0]?.id,
      activePocketId: undefined,
      pendingBoardSelectionIds: undefined,
      selectedBoardIds: [],
      lastResult: calculateThroughput(nextProject),
      undoHistory: [],
      redoHistory: [],
    });
  },
  undo: () => {
    set((state) => {
      const previousProject = state.undoHistory.at(-1);
      if (!previousProject) {
        return state;
      }

      return {
        ...restoreProjectState(state, previousProject),
        undoHistory: state.undoHistory.slice(0, -1),
        redoHistory: pushProjectHistory(state.redoHistory, state.project),
      };
    });
  },
  redo: () => {
    set((state) => {
      const nextProject = state.redoHistory.at(-1);
      if (!nextProject) {
        return state;
      }

      return {
        ...restoreProjectState(state, nextProject),
        undoHistory: pushProjectHistory(state.undoHistory, state.project),
        redoHistory: state.redoHistory.slice(0, -1),
      };
    });
  },
  setDatasetManifest: (manifest, manifestUrl) => {
    set((state) => ({
      datasetManifest: manifest,
      datasetManifestUrl: manifestUrl,
      selectedDatasetVersionId:
        state.selectedDatasetVersionId ??
        manifest.latestStableVersion ??
        manifest.latestDailyVersion ??
        manifest.versions[0]?.id,
      datasetError: undefined,
    }));
  },
  setDataset: (dataset) => {
    set((state) => ({
      dataset,
      project: refreshProjectResourceIcons(state.project, dataset),
      recipeResourceHistory: refreshResourceHistoryIcons(state.recipeResourceHistory, dataset),
      recipeBrowserResource: state.recipeBrowserResource
        ? refreshBrowserResourceIcon(state.recipeBrowserResource, dataset)
        : undefined,
      pendingResourceConnection: state.pendingResourceConnection
        ? refreshPendingResourceConnectionIcon(state.pendingResourceConnection, dataset)
        : undefined,
      selectedDatasetVersionId: dataset.datasetVersionId,
      selectedRecipeId: state.selectedRecipeId ?? dataset.recipes[0]?.id,
      datasetError: undefined,
      isDatasetLoading: false,
    }));
  },
  refreshProjectRecipes: (recipes) => {
    set((state) => {
      if (recipes.length === 0) {
        return state;
      }

      const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe] as const));
      const project = {
        ...state.project,
        recipes: state.project.recipes.map((recipe) => {
          const refreshedRecipe = recipesById.get(recipe.id);
          return refreshedRecipe ? mergeRefreshedRecipe(refreshedRecipe) : recipe;
        }),
        nodes: state.project.nodes.map((node) => {
          const recipe = state.project.recipes.find((entry) => entry.id === node.recipeId);
          const refreshedRecipe = recipe ? recipesById.get(recipe.id) : undefined;
          if (!recipe || !refreshedRecipe) {
            return node;
          }

          const contextualInputOverrides = buildRecipeInputOverridesFromContextualRecipeInputs(
            recipe,
            refreshedRecipe,
          );
          const validMachineHandlerIds = new Set(
            (refreshedRecipe.machineHandlers ?? []).map((handler) => handler.id),
          );
          const nextRecipeInputOverrides = {
            ...contextualInputOverrides,
            ...node.recipeInputOverrides,
          };
          const nextNode: FactoryNode = Object.keys(nextRecipeInputOverrides).length
            ? {
                ...node,
                recipeInputOverrides: nextRecipeInputOverrides,
              }
            : node;
          return nextNode.machineHandlerId && !validMachineHandlerIds.has(nextNode.machineHandlerId)
            ? { ...nextNode, machineHandlerId: undefined }
            : nextNode;
        }),
      };

      return {
        project,
        lastResult: calculateThroughput(project),
      };
    });
  },
  clearDataset: () => {
    set({
      dataset: undefined,
      recipeSearch: "",
      highlightSearch: "",
      selectedRecipeId: undefined,
      selectedDatasetVersionId: undefined,
    });
  },
  setDatasetLoading: (isLoading) => {
    set({ isDatasetLoading: isLoading });
  },
  setProjectImporting: (isImporting) => {
    set({ isProjectImporting: isImporting });
  },
  setDatasetError: (error) => {
    set({ datasetError: error, isDatasetLoading: false });
  },
  setRecipeSearch: (query) => {
    set({ recipeSearch: query });
  },
  setHighlightSearch: (query) => {
    set({ highlightSearch: query });
  },
  setMaxTierFilter: (tier) => {
    set({ maxTierFilter: tier });
  },
  hydrateResourceHistory: (history) => {
    set({ recipeResourceHistory: normalizeResourceHistory(history) });
  },
  browseResource: (resource, mode = "recipes") => {
    let nextHistory: RecipeBrowserResource[] | undefined;
    set((state) => {
      const recipeResourceHistory = updateResourceHistory(state.recipeResourceHistory, resource);
      nextHistory = recipeResourceHistory;

      return {
        recipeBrowserResource: resource,
        recipeBrowserMode: mode,
        recipeResourceHistory,
        selectedNodeId: resource.anchorNodeId,
      };
    });

    const historyToSave = nextHistory;
    if (historyToSave) {
      scheduleIdleBrowserWork(() => saveResourceHistory(historyToSave));
    }
  },
  clearResourceBrowser: () => {
    set({
      recipeBrowserResource: undefined,
      recipeSearch: "",
      highlightSearch: "",
    });
  },
  cleanBoard: () => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        recipes: [],
        nodes: [],
        storages: [],
        edges: [],
        targetRate: undefined,
      });

      return withProjectHistory(state, {
        project,
        recipeBrowserResource: undefined,
        pendingResourceConnection: undefined,
        selectedNodeId: undefined,
        selectedRecipeId: state.dataset?.recipes[0]?.id,
        lastResult: calculateThroughput(project),
      });
    });
  },
  selectResourceConnectionSlot: (slot) => {
    set((state) => {
      const pending = state.pendingResourceConnection;

      if (!pending) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      if (pending.nodeId === slot.nodeId && pending.handleId === slot.handleId) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      if (!canConnectPendingSlots(pending, slot)) {
        return {
          pendingResourceConnection: slot,
          selectedNodeId: slot.nodeId,
        };
      }

      const source = pending.side === "output" ? pending : slot;
      const target = pending.side === "input" ? pending : slot;
      const resource = {
        kind: source.kind,
        id: source.resourceId,
        displayName: source.displayName ?? target.displayName,
        iconPath: source.iconPath ?? target.iconPath,
        iconAtlas: source.iconAtlas ?? target.iconAtlas,
        dominantColor:
          source.dominantColor ??
          source.iconAtlas?.dominantColor ??
          target.dominantColor ??
          target.iconAtlas?.dominantColor,
        sourceHandle: source.handleId,
        targetHandle: target.handleId,
      };
      const edge = buildEdgeBetweenNodes(state.project, source.nodeId, target.nodeId, resource);

      if (!edge) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      const duplicateEdge = findDuplicateEdge(state.project.edges, edge);
      if (duplicateEdge) {
        const project = touchProject({
          ...state.project,
          edges: state.project.edges.filter((entry) => entry.id !== duplicateEdge.id),
        });
        return withProjectHistory(state, {
          project,
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
          lastResult: calculateThroughput(project),
        });
      }

      if (hasStorageEndpointConflict(state.project, edge)) {
        return {
          pendingResourceConnection: undefined,
          selectedNodeId: slot.nodeId,
        };
      }

      const project = touchProject(
        applyEdgeInputOverride(
          {
            ...state.project,
            edges: [...state.project.edges, edge],
          },
          edge,
          resource,
        ),
      );

      return withProjectHistory(state, {
        project,
        pendingResourceConnection: undefined,
        selectedNodeId: slot.nodeId,
        lastResult: calculateThroughput(project),
      });
    });
  },
  cancelResourceConnection: () => {
    set({ pendingResourceConnection: undefined });
  },
  setNodeColorPaintMode: (colorTag) => {
    set({ nodeColorPaintMode: colorTag });
  },
  setHoveredStorageResourceKey: (key) => {
    set({ hoveredStorageResourceKey: key });
  },
  setHoveredFlowResourceKey: (key) => {
    set({ hoveredFlowResourceKey: key });
  },
  setHoveredFlowScope: (scope) => {
    set({ hoveredFlowScope: scope });
  },
  selectFlowResourceKey: (key) => {
    set((state) => ({
      selectedFlowResourceKey: state.selectedFlowResourceKey === key ? undefined : key,
    }));
  },
  setHoveredNodeBottlenecks: (isHovered) => {
    set({ hoveredNodeBottlenecks: isHovered });
  },
  toggleNodeBottlenecks: () => {
    set((state) => ({ selectedNodeBottlenecks: !state.selectedNodeBottlenecks }));
  },
  setHoveredUsageNodeId: (nodeId) => {
    set({ hoveredUsageNodeId: nodeId });
  },
  setFlowViewportCenter: (position) => {
    set({ flowViewportCenter: position });
  },
  recalculate: () => {
    const { project } = get();
    set({ lastResult: calculateThroughput(project) });
  },
  selectNode: (nodeId) => {
    const node = get().project.nodes.find((entry) => entry.id === nodeId);
    set({
      selectedNodeId: nodeId,
      selectedRecipeId: node?.recipeId ?? get().selectedRecipeId,
    });
  },
  selectRecipe: (recipeId) => {
    set({ selectedRecipeId: recipeId, selectedNodeId: undefined });
  },
  addNodeForRecipe: (recipeId) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      if (!recipe) {
        return state;
      }

      return addRecipeNodeToState(state, recipe);
    });
  },
  addNodeForRecipeObject: (recipe, resource, options) => {
    set((state) => addRecipeNodeToState(state, recipe, resource, options));
  },
  addConnectedNodeForRecipe: (recipeId, anchorNodeId, resource) => {
    set((state) => {
      const recipe = findRecipeForPlanning(state, recipeId);
      if (!recipe) {
        return state;
      }

      return addConnectedRecipeNodeToState(state, recipe, anchorNodeId, resource);
    });
  },
  addConnectedNodeForRecipeObject: (recipe, anchorNodeId, resource) => {
    set((state) => addConnectedRecipeNodeToState(state, recipe, anchorNodeId, resource));
  },
  updateNode: (nodeId, patch) => {
    set((state) => {
      const project = touchProject(
        pruneInvalidEdgesAndOrphanStorages({
          ...state.project,
          nodes: state.project.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...patch } : node,
          ),
        }),
      );
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  addCropFarmNode: () => {
    // Crop sources spawn green by default, like drawers/tanks spawn with the
    // active paint color; the user can still repaint them.
    set((state) =>
      addRecipeNodeToState(state, createCropFarmPlaceholderRecipe(), undefined, {
        colorTag: "green",
      }),
    );
  },
  addCustomRateNode: () => {
    // Each custom rate node owns its recipe (the rate lives on it).
    set((state) =>
      addRecipeNodeToState(
        state,
        createCustomRatePlaceholderRecipe(createId("recipe")),
        undefined,
        { colorTag: "blue" },
      ),
    );
  },
  setCustomRateConfig: (nodeId, patch) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isCustomRateRecipe(recipe)) {
        return state;
      }
      const slot = getCustomRateSlot(recipe);
      if (!slot) {
        return state;
      }
      const mode = patch.mode ?? slot.mode;
      const perSecond = patch.perSecond ?? slot.resource.amount;
      const nextRecipe = withCustomRateSlot(recipe, slot.resource, mode, perSecond);
      const modeFlipped = mode !== slot.mode;
      const project = touchProject({
        ...state.project,
        recipes: state.project.recipes.map((entry) =>
          entry.id === recipe.id ? nextRecipe : entry,
        ),
        // A flipped mode reverses the node's direction — old wires point the
        // wrong way, so they drop.
        edges: modeFlipped
          ? state.project.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
          : state.project.edges,
      });
      return withProjectHistory(state, { project, lastResult: calculateThroughput(project) });
    });
  },
  connectCustomRate: (customNodeId, customSide, machine, resource) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === customNodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isCustomRateRecipe(recipe)) {
        return state;
      }
      const existing = getCustomRateSlot(recipe);
      const mode: CustomRateMode = customSide === "output" ? "supply" : "request";
      const perSecond = existing?.resource.amount ?? 1;
      const resourceChanged =
        existing !== undefined &&
        (existing.resource.kind !== resource.kind || existing.resource.id !== resource.id);
      const modeChanged = existing !== undefined && existing.mode !== mode;
      const nextRecipe = withCustomRateSlot(recipe, resource, mode, perSecond);
      const canonicalHandle = makeResourceHandleId(customSide, {
        kind: resource.kind,
        id: resource.id,
      });
      const edge: FactoryEdge = {
        id: createId("edge"),
        source: mode === "supply" ? customNodeId : machine.nodeId,
        target: mode === "supply" ? machine.nodeId : customNodeId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        label: resource.displayName,
        sourceHandle: mode === "supply" ? canonicalHandle : machine.handleId,
        targetHandle: mode === "supply" ? machine.handleId : canonicalHandle,
      };
      const keptEdges =
        resourceChanged || modeChanged
          ? state.project.edges.filter(
              (entry) => entry.source !== customNodeId && entry.target !== customNodeId,
            )
          : state.project.edges;
      const project = touchProject({
        ...state.project,
        recipes: state.project.recipes.map((entry) =>
          entry.id === recipe.id ? nextRecipe : entry,
        ),
        edges: [...keptEdges, edge],
      });
      return withProjectHistory(state, {
        project,
        selectedNodeId: customNodeId,
        lastResult: calculateThroughput(project),
      });
    });
  },
  addTrashNode: () => {
    // Each can owns its recipe like custom rate nodes do; the recipe stays
    // slotless forever - the solver voids by edge role, not by recipe slots.
    set((state) =>
      addRecipeNodeToState(state, createTrashPlaceholderRecipe(createId("recipe")), undefined, {
        colorTag: "gray",
      }),
    );
  },
  connectTrash: (trashNodeId, source, resource) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === trashNodeId);
      const recipe = node
        ? state.project.recipes.find((entry) => entry.id === node.recipeId)
        : undefined;
      if (!node || !recipe || !isTrashRecipe(recipe) || source.nodeId === trashNodeId) {
        return state;
      }
      // One line per source and resource is enough - the can eats everything
      // on it either way, and duplicates would just split the same leftovers.
      const alreadyWired = state.project.edges.some(
        (edge) =>
          edge.source === source.nodeId &&
          edge.target === trashNodeId &&
          edge.resourceKind === resource.kind &&
          edge.resourceId === resource.id,
      );
      if (alreadyWired) {
        return state;
      }
      const edge: FactoryEdge = {
        id: createId("edge"),
        source: source.nodeId,
        target: trashNodeId,
        resourceKind: resource.kind,
        resourceId: resource.id,
        label: resource.displayName,
        sourceHandle: source.handleId,
        targetHandle: makeResourceHandleId("input", { kind: "item", id: TRASH_ANY_RESOURCE_ID }),
      };
      const project = touchProject({
        ...state.project,
        edges: [...state.project.edges, edge],
      });
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  setNodeRecipe: (nodeId, recipe) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node || node.recipeId === recipe.id) {
        return state;
      }

      const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          recipes: recipeAlreadyInProject
            ? state.project.recipes.map((entry) =>
                entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
              )
            : [...state.project.recipes, recipe],
          nodes: state.project.nodes.map((entry) =>
            entry.id === nodeId
              ? {
                  ...entry,
                  recipeId: recipe.id,
                  overclockTier: recipe.minimumTier,
                  machineConfigTiers: undefined,
                  machineHandlerId: undefined,
                  coilTier: undefined,
                  recipeInputOverrides: undefined,
                }
              : entry,
          ),
          // The old recipe's resources no longer exist on this node.
          edges: state.project.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          ),
        }),
      );

      return withProjectHistory(state, {
        project,
        selectedNodeId: nodeId,
        selectedRecipeId: recipe.id,
        lastResult: calculateThroughput(project),
      });
    });
  },
  deleteNode: (nodeId) => {
    set((state) => {
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          nodes: state.project.nodes.filter((node) => node.id !== nodeId),
          edges: state.project.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          ),
        }),
      );
      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          state.pendingResourceConnection?.nodeId === nodeId
            ? undefined
            : state.pendingResourceConnection,
        selectedNodeId: project.nodes[0]?.id,
        selectedRecipeId: project.nodes[0]?.recipeId ?? state.selectedRecipeId,
        lastResult: calculateThroughput(project),
      });
    });
  },
  addResourceStorage: (resource) => {
    set((state) => {
      const storage: FactoryStorage = {
        id: createId("storage"),
        kind: resource.kind,
        resourceId: resource.id,
        displayName: resource.displayName,
        iconPath: resource.iconPath,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
        position: snapPositionToGrid({
          x: 180 + (state.project.storages?.length ?? 0) * 80,
          y: 180 + (state.project.storages?.length ?? 0) * 60,
        }),
      };
      const project = touchProject({
        ...state.project,
        storages: [...(state.project.storages ?? []), storage],
      });

      return withProjectHistory(state, {
        project,
        selectedNodeId: undefined,
        lastResult: calculateThroughput(project),
      });
    });
  },
  addStorageForConnection: (resource, nodeId, side, position, handleId) => {
    set((state) => {
      const storageResource = getStorageResourceForConnection(resource);
      const storage: FactoryStorage = {
        id: createId("storage"),
        kind: storageResource.kind,
        resourceId: storageResource.id,
        displayName: storageResource.displayName,
        iconPath: storageResource.iconPath,
        iconAtlas: storageResource.iconAtlas,
        dominantColor: storageResource.dominantColor ?? storageResource.iconAtlas?.dominantColor,
        position: snapPositionToGrid(position),
      };
      const projectWithStorage: FactoryProject = {
        ...state.project,
        storages: [...(state.project.storages ?? []), storage],
      };
      const selectedResource = {
        kind: storageResource.kind,
        id: storageResource.id,
        amount: storageResource.amount,
        displayName: storageResource.displayName,
        iconPath: storageResource.iconPath,
        iconAtlas: storageResource.iconAtlas,
        dominantColor: storageResource.dominantColor ?? storageResource.iconAtlas?.dominantColor,
        tooltip: storageResource.tooltip,
        sourceHandle:
          side === "output"
            ? handleId
            : makeResourceHandleId("output", { kind: storageResource.kind, id: storageResource.id }),
        targetHandle:
          side === "input"
            ? handleId
            : makeResourceHandleId("input", { kind: storageResource.kind, id: storageResource.id }),
      };
      const edge =
        side === "output"
          ? buildEdgeBetweenNodes(projectWithStorage, nodeId, storage.id, selectedResource)
          : buildEdgeBetweenNodes(projectWithStorage, storage.id, nodeId, selectedResource);

      if (!edge) {
        const project = touchProject(projectWithStorage);
        return withProjectHistory(state, {
          project,
          selectedNodeId: undefined,
          hoveredStorageResourceKey: getResourceKey(storageResource),
          lastResult: calculateThroughput(project),
        });
      }

      const duplicateEdge = findDuplicateEdge(projectWithStorage.edges, edge);
      if (!duplicateEdge && hasStorageEndpointConflict(projectWithStorage, edge)) {
        const project = touchProject(pruneOrphanStorages(projectWithStorage));
        return withProjectHistory(state, {
          project,
          selectedNodeId: undefined,
          hoveredStorageResourceKey: getResourceKey(storageResource),
          lastResult: calculateThroughput(project),
        });
      }

      const projectWithEdge = {
        ...projectWithStorage,
        edges: duplicateEdge
          ? projectWithStorage.edges.filter((entry) => entry.id !== duplicateEdge.id)
          : [...projectWithStorage.edges, edge],
      };
      const project = touchProject(
        pruneOrphanStorages(
          duplicateEdge ? projectWithEdge : applyEdgeInputOverride(projectWithEdge, edge, selectedResource),
        ),
      );

      return withProjectHistory(state, {
        project,
        selectedNodeId: undefined,
        hoveredStorageResourceKey: getResourceKey(storageResource),
        lastResult: calculateThroughput(project),
      });
    });
  },
  deleteStorage: (storageId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).filter((storage) => storage.id !== storageId),
        edges: state.project.edges.filter(
          (edge) => edge.source !== storageId && edge.target !== storageId,
        ),
      });

      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          state.pendingResourceConnection?.nodeId === storageId
            ? undefined
            : state.pendingResourceConnection,
        lastResult: calculateThroughput(project),
      });
    });
  },
  duplicateNode: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return state;
      }
      const clone = structuredClone(node);
      clone.id = createId("node");
      // Two cells down and across: far enough to see, still on the grid.
      clone.position = snapPositionToGrid({
        x: node.position.x + CLONE_OFFSET,
        y: node.position.y + CLONE_OFFSET,
      });
      // Custom rate nodes own their recipe (the dialed rate lives on it), so
      // the clone gets its own copy — otherwise both nodes share one dial.
      const recipe = state.project.recipes.find((entry) => entry.id === node.recipeId);
      let clonedRecipe: Recipe | undefined;
      if (recipe && isCustomRateRecipe(recipe)) {
        clonedRecipe = { ...structuredClone(recipe), id: createId("recipe") };
        clone.recipeId = clonedRecipe.id;
      }
      const project = touchProject({
        ...state.project,
        recipes: clonedRecipe ? [...state.project.recipes, clonedRecipe] : state.project.recipes,
        nodes: [...state.project.nodes, clone],
      });
      return withProjectHistory(state, {
        project,
        selectedNodeId: clone.id,
        selectedRecipeId: clone.recipeId,
        lastResult: calculateThroughput(project),
      });
    });
  },
  duplicateStorage: (storageId) => {
    set((state) => {
      const storage = (state.project.storages ?? []).find((entry) => entry.id === storageId);
      if (!storage) {
        return state;
      }
      const clone = structuredClone(storage);
      clone.id = createId("storage");
      clone.position = snapPositionToGrid({
        x: storage.position.x + CLONE_OFFSET,
        y: storage.position.y + CLONE_OFFSET,
      });
      const project = touchProject({
        ...state.project,
        storages: [...(state.project.storages ?? []), clone],
      });
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  autoRouteStorage: (storageId) => {
    set((state) => {
      const storage = (state.project.storages ?? []).find((entry) => entry.id === storageId);
      if (!storage) {
        return state;
      }

      const edges = buildCompatibleEdgesForStorage(state.project, storage);
      const missingEdges: FactoryEdge[] = [];
      for (const edge of edges) {
        const projectWithPendingEdges = {
          ...state.project,
          edges: [...state.project.edges, ...missingEdges],
        };
        if (
          !hasDuplicateEdge(projectWithPendingEdges.edges, edge) &&
          !hasStorageEndpointConflict(projectWithPendingEdges, edge)
        ) {
          missingEdges.push(edge);
        }
      }
      if (missingEdges.length === 0) {
        return state;
      }

      const project = touchProject(
        applyEdgeInputOverrides(
          {
            ...state.project,
            edges: [...state.project.edges, ...missingEdges],
          },
          missingEdges,
        ),
      );

      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  updateStorage: (storageId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, ...patch } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  setStoragePosition: (storageId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        storages: (state.project.storages ?? []).map((storage) =>
          storage.id === storageId ? { ...storage, position } : storage,
        ),
      });

      return withProjectHistory(state, {
        project,
      });
    });
  },
  setProjectCommunityLink: (communityPlanId) => {
    set((state) => ({
      project: {
        ...state.project,
        metadata: { ...state.project.metadata, communityPlanId },
      },
    }));
  },
  addAnnotation: (annotation) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: [
          ...(state.project.annotations ?? []),
          { ...annotation, ...snapAnnotationToGrid(annotation), id: createId("annotation") },
        ],
      });

      return withProjectHistory(state, { project });
    });
  },
  updateAnnotation: (annotationId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).map((annotation) =>
          annotation.id === annotationId
            ? { ...annotation, ...patch, ...snapAnnotationToGrid(patch) }
            : annotation,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  deleteAnnotation: (annotationId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).filter(
          (annotation) => annotation.id !== annotationId,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  setAnnotationPosition: (annotationId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        annotations: (state.project.annotations ?? []).map((annotation) =>
          annotation.id === annotationId ? { ...annotation, position } : annotation,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  setNodePosition: (nodeId, position) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((node) =>
          node.id === nodeId ? { ...node, position } : node,
        ),
      });

      return withProjectHistory(state, { project });
    });
  },
  moveBoardItems: (moves) => {
    set((state) => {
      const positionById = new Map(moves.map((move) => [move.id, move.position] as const));
      let moved = false;
      const applyMoves = <T extends { id: string; position: { x: number; y: number } }>(
        items: T[],
      ): T[] =>
        items.map((item) => {
          const position = positionById.get(item.id);
          if (!position || (position.x === item.position.x && position.y === item.position.y)) {
            return item;
          }
          moved = true;
          return { ...item, position };
        });

      const nodes = applyMoves(state.project.nodes);
      const storages = state.project.storages ? applyMoves(state.project.storages) : undefined;
      const annotations = state.project.annotations
        ? applyMoves(state.project.annotations)
        : undefined;
      const pockets = state.project.pockets ? applyMoves(state.project.pockets) : undefined;
      // A drag that ends where it started is not an edit; recording it would
      // burn an undo step on nothing.
      if (!moved) {
        return state;
      }

      const project = touchProject({ ...state.project, nodes, storages, annotations, pockets });
      return withProjectHistory(state, { project });
    });
  },
  deleteBoardSelection: ({ nodeIds = [], edgeIds = [] }) => {
    set((state) => {
      // Deleting a pocket card deletes the dimension AND everything in it,
      // the way deleting a folder deletes its files.
      const { itemIds: doomedItems, pocketIds: doomedPockets } = collectPocketSelection(
        state.project,
        nodeIds,
      );
      const doomedEdges = new Set(edgeIds);
      const nodes = state.project.nodes.filter((node) => !doomedItems.has(node.id));
      const storages = (state.project.storages ?? []).filter(
        (storage) => !doomedItems.has(storage.id),
      );
      const annotations = (state.project.annotations ?? []).filter(
        (annotation) => !doomedItems.has(annotation.id),
      );
      const pockets = (state.project.pockets ?? []).filter(
        (pocket) => !doomedPockets.has(pocket.id),
      );
      const edges = state.project.edges.filter(
        (edge) =>
          !doomedEdges.has(edge.id) &&
          !doomedItems.has(edge.source) &&
          !doomedItems.has(edge.target),
      );
      const nothingDeleted =
        nodes.length === state.project.nodes.length &&
        storages.length === (state.project.storages ?? []).length &&
        annotations.length === (state.project.annotations ?? []).length &&
        pockets.length === (state.project.pockets ?? []).length &&
        edges.length === state.project.edges.length;
      if (nothingDeleted) {
        return state;
      }

      const project = touchProject(
        pruneOrphanStorages({ ...state.project, nodes, storages, annotations, pockets, edges }),
      );
      const pendingConnectionNodeId = state.pendingResourceConnection?.nodeId;
      return withProjectHistory(state, {
        project,
        pendingResourceConnection:
          pendingConnectionNodeId && doomedItems.has(pendingConnectionNodeId)
            ? undefined
            : state.pendingResourceConnection,
        selectedNodeId:
          state.selectedNodeId && doomedItems.has(state.selectedNodeId)
            ? undefined
            : state.selectedNodeId,
        activePocketId:
          state.activePocketId && doomedPockets.has(state.activePocketId)
            ? undefined
            : state.activePocketId,
        lastResult: calculateThroughput(project),
      });
    });
  },
  pasteBoardItems: (payload, offset) => {
    const pastedIds: string[] = [];
    set((state) => {
      const shift = (position: { x: number; y: number }) =>
        snapPositionToGrid({ x: position.x + offset.x, y: position.y + offset.y });
      const payloadRecipesById = new Map(payload.recipes.map((recipe) => [recipe.id, recipe]));
      const projectRecipeIds = new Set(state.project.recipes.map((recipe) => recipe.id));
      const addedRecipes: Recipe[] = [];
      const idMap = new Map<string, string>();

      // Pockets first: items need the new pocket ids to re-home into. A
      // payload item at the payload's root lands in whatever pocket the
      // board is currently showing.
      const pastePockets = payload.pockets ?? [];
      for (const pocket of pastePockets) {
        idMap.set(pocket.id, createId("pocket"));
      }
      const rehome = (pocketId: string | undefined): string | undefined =>
        (pocketId !== undefined ? idMap.get(pocketId) : undefined) ?? state.activePocketId;
      const pockets = pastePockets.map((pocket) => {
        const clone = structuredClone(pocket);
        clone.id = idMap.get(pocket.id) as string;
        clone.parentPocketId = rehome(pocket.parentPocketId);
        clone.position = shift(pocket.position);
        return clone;
      });

      const nodes: FactoryNode[] = [];
      for (const node of payload.nodes) {
        const recipe =
          payloadRecipesById.get(node.recipeId) ??
          state.project.recipes.find((entry) => entry.id === node.recipeId);
        // A node whose recipe survived nowhere would paste as a broken card.
        if (!recipe) {
          continue;
        }
        const clone = structuredClone(node);
        clone.id = createId("node");
        idMap.set(node.id, clone.id);
        clone.position = shift(node.position);
        clone.pocketId = rehome(node.pocketId);
        // Custom rate nodes own their recipe (the dialed rate lives on it) -
        // same rule as duplicateNode, or both cards would share one dial.
        if (isCustomRateRecipe(recipe)) {
          const recipeClone = { ...structuredClone(recipe), id: createId("recipe") };
          clone.recipeId = recipeClone.id;
          addedRecipes.push(recipeClone);
        } else if (!projectRecipeIds.has(recipe.id)) {
          // Pasting into a design that has never seen this recipe: the
          // clipboard carries the copy, exactly like plan import does.
          addedRecipes.push(structuredClone(recipe));
          projectRecipeIds.add(recipe.id);
        }
        nodes.push(clone);
      }
      const storages = payload.storages.map((storage) => {
        const clone = structuredClone(storage);
        clone.id = createId("storage");
        idMap.set(storage.id, clone.id);
        clone.position = shift(storage.position);
        clone.pocketId = rehome(storage.pocketId);
        return clone;
      });
      const annotations = payload.annotations.map((annotation) => {
        const clone = structuredClone(annotation);
        clone.id = createId("annotation");
        idMap.set(annotation.id, clone.id);
        clone.position = shift(annotation.position);
        clone.pocketId = rehome(annotation.pocketId);
        return clone;
      });
      // Only wires interior to the copied selection can come along - a wire
      // with one foot outside has nothing on the pasted side to stand on.
      const edges: FactoryEdge[] = [];
      for (const edge of payload.edges) {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) {
          continue;
        }
        const clone = structuredClone(edge);
        clone.id = createId("edge");
        clone.source = source;
        clone.target = target;
        // Waypoints are absolute board corners; they ride along with the paste.
        clone.waypoints = clone.waypoints?.map((waypoint) => shift(waypoint));
        edges.push(clone);
      }
      if (nodes.length + storages.length + annotations.length + pockets.length === 0) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        recipes: addedRecipes.length
          ? [...state.project.recipes, ...addedRecipes]
          : state.project.recipes,
        nodes: [...state.project.nodes, ...nodes],
        storages: storages.length
          ? [...(state.project.storages ?? []), ...storages]
          : state.project.storages,
        annotations: annotations.length
          ? [...(state.project.annotations ?? []), ...annotations]
          : state.project.annotations,
        pockets: pockets.length
          ? [...(state.project.pockets ?? []), ...pockets]
          : state.project.pockets,
        edges: edges.length ? [...state.project.edges, ...edges] : state.project.edges,
      });
      // Only what surfaces at the level the board is showing can be
      // selected; cards pasted deeper inside a pocket are reachable by
      // entering it.
      pastedIds.push(
        ...nodes
          .filter((node) => node.pocketId === state.activePocketId)
          .map((node) => node.id),
        ...storages
          .filter((storage) => storage.pocketId === state.activePocketId)
          .map((storage) => storage.id),
        ...annotations
          .filter((annotation) => annotation.pocketId === state.activePocketId)
          .map((annotation) => annotation.id),
        ...pockets
          .filter((pocket) => pocket.parentPocketId === state.activePocketId)
          .map((pocket) => pocket.id),
      );
      const lastPastedNode = nodes.at(-1);
      return withProjectHistory(state, {
        project,
        selectedNodeId: lastPastedNode?.id ?? state.selectedNodeId,
        selectedRecipeId: lastPastedNode?.recipeId ?? state.selectedRecipeId,
        lastResult: calculateThroughput(project),
      });
    });
    return pastedIds;
  },
  enterPocket: (pocketId) => {
    set((state) => {
      if (
        pocketId !== undefined &&
        !(state.project.pockets ?? []).some((pocket) => pocket.id === pocketId)
      ) {
        return state;
      }
      return { activePocketId: pocketId };
    });
  },
  compactSelectionIntoPocket: (ids, name) => {
    let createdPocketId: string | undefined;
    set((state) => {
      const selected = new Set(ids);
      const memberNodes = state.project.nodes.filter((node) => selected.has(node.id));
      const memberStorages = (state.project.storages ?? []).filter((storage) =>
        selected.has(storage.id),
      );
      const memberAnnotations = (state.project.annotations ?? []).filter((annotation) =>
        selected.has(annotation.id),
      );
      const memberPockets = (state.project.pockets ?? []).filter((pocket) =>
        selected.has(pocket.id),
      );
      const memberCount =
        memberNodes.length +
        memberStorages.length +
        memberAnnotations.length +
        memberPockets.length;
      if (memberCount === 0) {
        return state;
      }

      // The card spawns at the centre of the cards it swallows, so the board
      // reads "that cluster became this" rather than teleporting the work.
      const positions = [
        ...memberNodes.map((node) => node.position),
        ...memberStorages.map((storage) => storage.position),
        ...memberAnnotations.map((annotation) => annotation.position),
        ...memberPockets.map((pocket) => pocket.position),
      ];
      const centroid = snapPositionToGrid({
        x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
        y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
      });

      const pocket: FactoryPocket = {
        id: createId("pocket"),
        name: name?.trim() || `Pocket ${(state.project.pockets ?? []).length + 1}`,
        parentPocketId: state.activePocketId,
        position: centroid,
      };
      createdPocketId = pocket.id;

      const intoPocket = <T extends { id: string; pocketId?: string }>(items: T[]): T[] =>
        items.map((item) => (selected.has(item.id) ? { ...item, pocketId: pocket.id } : item));

      // The graph itself does not change - wires keep running, the solver
      // never notices. Only what the board SHOWS changes, so no recalc.
      const project = touchProject({
        ...state.project,
        nodes: intoPocket(state.project.nodes),
        storages: state.project.storages ? intoPocket(state.project.storages) : undefined,
        annotations: state.project.annotations
          ? intoPocket(state.project.annotations)
          : undefined,
        pockets: [
          ...(state.project.pockets ?? []).map((entry) =>
            selected.has(entry.id) ? { ...entry, parentPocketId: pocket.id } : entry,
          ),
          pocket,
        ],
      });
      return withProjectHistory(state, { project });
    });
    return createdPocketId;
  },
  dissolvePocket: (pocketId) => {
    set((state) => {
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket) {
        return state;
      }

      // Members surface on the pocket's parent board, exactly where they
      // always were - positions never changed, only visibility.
      const surface = <T extends { pocketId?: string }>(items: T[]): T[] =>
        items.map((item) =>
          item.pocketId === pocketId ? { ...item, pocketId: pocket.parentPocketId } : item,
        );

      const project = touchProject({
        ...state.project,
        nodes: surface(state.project.nodes),
        storages: state.project.storages ? surface(state.project.storages) : undefined,
        annotations: state.project.annotations ? surface(state.project.annotations) : undefined,
        pockets: (state.project.pockets ?? [])
          .filter((entry) => entry.id !== pocketId)
          .map((entry) =>
            entry.parentPocketId === pocketId
              ? { ...entry, parentPocketId: pocket.parentPocketId }
              : entry,
          ),
      });
      return withProjectHistory(state, {
        project,
        activePocketId:
          state.activePocketId === pocketId ? pocket.parentPocketId : state.activePocketId,
      });
    });
  },
  renamePocket: (pocketId, name) => {
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return state;
      }
      const pocket = (state.project.pockets ?? []).find((entry) => entry.id === pocketId);
      if (!pocket || pocket.name === trimmed) {
        return state;
      }

      const project = touchProject({
        ...state.project,
        pockets: (state.project.pockets ?? []).map((entry) =>
          entry.id === pocketId ? { ...entry, name: trimmed } : entry,
        ),
      });
      return withProjectHistory(state, { project });
    });
  },
  setPendingBoardSelection: (ids) => {
    set({ pendingBoardSelectionIds: ids });
  },
  setSelectedBoardIds: (ids) => {
    set((state) => {
      if (
        state.selectedBoardIds.length === ids.length &&
        state.selectedBoardIds.every((id, index) => id === ids[index])
      ) {
        return state;
      }
      return { selectedBoardIds: ids };
    });
  },
  connectNodes: (sourceNodeId, targetNodeId, resource) => {
    set((state) => {
      const edge = buildEdgeBetweenNodes(state.project, sourceNodeId, targetNodeId, resource);
      if (!edge) {
        return state;
      }

      const duplicateEdge = findDuplicateEdge(state.project.edges, edge);
      if (duplicateEdge) {
        const project = touchProject(
          pruneOrphanStorages({
            ...state.project,
            edges: state.project.edges.filter((entry) => entry.id !== duplicateEdge.id),
          }),
        );
        return withProjectHistory(state, {
          project,
          lastResult: calculateThroughput(project),
        });
      }

      if (hasStorageEndpointConflict(state.project, edge)) {
        return state;
      }

      const project = touchProject(
        applyEdgeInputOverride(
          {
            ...state.project,
            edges: [...state.project.edges, edge],
          },
          edge,
          resource,
        ),
      );
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  reconnectEdge: (edgeId, connection) => {
    set((state) => {
      const oldEdge = state.project.edges.find((edge) => edge.id === edgeId);
      if (!oldEdge || !connection.source || !connection.target) {
        return state;
      }

      const sourceHandle = parseResourceHandleId(connection.sourceHandle);
      const targetHandle = parseResourceHandleId(connection.targetHandle);
      const isReverseHandleDirection =
        sourceHandle?.side === "input" && targetHandle?.side === "output";
      const resource =
        sourceHandle &&
        targetHandle &&
        sourceHandle.side !== targetHandle.side &&
        sourceHandle.kind === targetHandle.kind &&
        sourceHandle.resourceId === targetHandle.resourceId
          ? {
              kind: sourceHandle.kind,
              id: sourceHandle.resourceId,
              displayName: oldEdge.label,
              sourceHandle: isReverseHandleDirection
                ? (connection.targetHandle ?? undefined)
                : (connection.sourceHandle ?? undefined),
              targetHandle: isReverseHandleDirection
                ? (connection.sourceHandle ?? undefined)
                : (connection.targetHandle ?? undefined),
            }
          : undefined;
      const sourceNodeId = isReverseHandleDirection ? connection.target : connection.source;
      const targetNodeId = isReverseHandleDirection ? connection.source : connection.target;

      if (connection.sourceHandle || connection.targetHandle) {
        if (!resource) {
          return state;
        }
      }

      const projectWithoutOld = {
        ...state.project,
        edges: state.project.edges.filter((edge) => edge.id !== edgeId),
      };
      const edge = buildEdgeBetweenNodes(projectWithoutOld, sourceNodeId, targetNodeId, resource);
      if (!edge) {
        const project = touchProject(pruneOrphanStorages(projectWithoutOld));
        return withProjectHistory(state, {
          project,
          lastResult: calculateThroughput(project),
        });
      }

      const duplicateEdge = findDuplicateEdge(projectWithoutOld.edges, edge);
      if (!duplicateEdge && hasStorageEndpointConflict(projectWithoutOld, edge)) {
        return state;
      }

      const projectWithEdge = pruneOrphanStorages({
        ...projectWithoutOld,
        edges: duplicateEdge
          ? projectWithoutOld.edges.filter((entry) => entry.id !== duplicateEdge.id)
          : [...projectWithoutOld.edges, edge],
      });
      const project = touchProject(
        duplicateEdge ? projectWithEdge : applyEdgeInputOverride(projectWithEdge, edge),
      );

      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  updateEdge: (edgeId, patch) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        edges: state.project.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...patch } : edge,
        ),
      });

      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  autoConnectNode: (nodeId) => {
    set((state) => {
      const node = state.project.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return state;
      }

      const edges: FactoryEdge[] = [];
      const existingAndPending = [...state.project.edges];

      for (const otherNode of state.project.nodes) {
        if (otherNode.id === nodeId) {
          continue;
        }

        for (const edge of [
          ...buildCompatibleEdgesBetweenNodes(state.project, otherNode.id, nodeId),
          ...buildCompatibleEdgesBetweenNodes(state.project, nodeId, otherNode.id),
        ]) {
          if (!hasDuplicateEdge(existingAndPending, edge)) {
            edges.push(edge);
            existingAndPending.push(edge);
          }
        }
      }

      if (edges.length === 0) {
        return state;
      }

      const project = touchProject(
        applyEdgeInputOverrides(
          {
            ...state.project,
            edges: [...state.project.edges, ...edges],
          },
          edges,
        ),
      );

      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  optimizeMachineCount: (nodeId) => {
    set((state) => {
      const currentNode = state.project.nodes.find((node) => node.id === nodeId);
      if (!currentNode) {
        return state;
      }

      const machineCount = optimizeMachineCountsForProject(state.project).machineCounts.get(nodeId);
      if (machineCount === undefined || machineCount === currentNode.machineCount) {
        return state;
      }

      const touchedProject = touchProject({
        ...state.project,
        nodes: state.project.nodes.map((node) =>
          node.id === nodeId ? { ...node, machineCount } : node,
        ),
      });
      return withProjectHistory(state, {
        project: touchedProject,
        lastResult: calculateThroughput(touchedProject),
      });
    });
  },
  optimizeMachineCounts: () => {
    set((state) => {
      if (state.project.nodes.length === 0) {
        return state;
      }

      const optimized = optimizeMachineCountsForProject(state.project);
      const project = {
        ...state.project,
        nodes: state.project.nodes.map((node) => {
          const machineCount = optimized.machineCounts.get(node.id);
          return machineCount === undefined || machineCount === node.machineCount
            ? node
            : { ...node, machineCount };
        }),
      };

      if (haveSameMachineCounts(state.project, project)) {
        return state;
      }

      const touchedProject = touchProject(project);
      return withProjectHistory(state, {
        project: touchedProject,
        lastResult: calculateThroughput(touchedProject),
      });
    });
  },
  deleteEdge: (edgeId) => {
    set((state) => {
      const project = touchProject(
        pruneOrphanStorages({
          ...state.project,
          edges: state.project.edges.filter((edge) => edge.id !== edgeId),
        }),
      );
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  setTargetRate: (targetRate) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        targetRate,
      });
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  selectFuelProfile: (fuelProfileId) => {
    set((state) => {
      const project = touchProject({
        ...state.project,
        selectedFuelProfileId: fuelProfileId,
      });
      return withProjectHistory(state, {
        project,
        lastResult: calculateThroughput(project),
      });
    });
  },
  renameProject: (name) => {
    set((state) => {
      if (name === state.project.name) {
        return state;
      }

      // No throughput recalculation: a name cannot change a rate, and the solve
      // is the expensive part of every other mutation here.
      return withProjectHistory(state, {
        project: touchProject({ ...state.project, name }),
      });
    });
  },
}));

function withProjectHistory(
  state: FactoryStore,
  updates: Partial<FactoryStore> & { project?: FactoryProject },
): Partial<FactoryStore> {
  if (!updates.project || updates.project === state.project) {
    return updates;
  }

  return {
    ...updates,
    undoHistory: pushProjectHistory(state.undoHistory, state.project),
    redoHistory: [],
  };
}

function pushProjectHistory(history: FactoryProject[], project: FactoryProject): FactoryProject[] {
  return [...history, project].slice(-PROJECT_HISTORY_LIMIT);
}

function restoreProjectState(
  state: FactoryStore,
  project: FactoryProject,
): Pick<
  FactoryStore,
  "project" | "selectedNodeId" | "selectedRecipeId" | "activePocketId" | "lastResult"
> {
  const selectedNode = state.selectedNodeId
    ? project.nodes.find((node) => node.id === state.selectedNodeId)
    : undefined;
  const selectedRecipe = state.selectedRecipeId
    ? project.recipes.find((recipe) => recipe.id === state.selectedRecipeId)
    : undefined;

  return {
    project,
    selectedNodeId: selectedNode?.id ?? project.nodes[0]?.id,
    selectedRecipeId:
      selectedNode?.recipeId ??
      selectedRecipe?.id ??
      project.nodes[0]?.recipeId ??
      project.recipes[0]?.id,
    // Undoing past a pocket's creation while zoomed into it would leave the
    // board showing a dimension that no longer exists.
    activePocketId:
      state.activePocketId &&
      (project.pockets ?? []).some((pocket) => pocket.id === state.activePocketId)
        ? state.activePocketId
        : undefined,
    lastResult: calculateThroughput(project),
  };
}

function canConnectPendingSlots(
  first: PendingResourceConnection,
  second: PendingResourceConnection,
): boolean {
  const firstResource = {
    kind: first.kind,
    id: first.resourceId,
    alternatives: first.alternatives,
  };
  const secondResource = {
    kind: second.kind,
    id: second.resourceId,
    alternatives: second.alternatives,
  };
  const input = first.side === "input" ? firstResource : secondResource;
  const output = first.side === "output" ? firstResource : secondResource;

  return (
    first.nodeId !== second.nodeId &&
    first.side !== second.side &&
    first.kind === second.kind &&
    resourceMatchesInput(output, input)
  );
}

function findRecipeForPlanning(state: FactoryStore, recipeId: string): Recipe | undefined {
  return (
    state.dataset?.recipes.find((recipe) => recipe.id === recipeId) ??
    state.project.recipes.find((recipe) => recipe.id === recipeId)
  );
}

function addRecipeNodeToState(
  state: FactoryStore,
  recipe: Recipe,
  resource?: RecipeInputContextResource,
  options?: { colorTag?: FactoryNodeColorTag; machineHandlerId?: string },
): Partial<FactoryStore> {
  const index = state.project.nodes.length;
  const viewportPosition = state.flowViewportCenter
    ? snapPositionToGrid({
        x: state.flowViewportCenter.x - RECIPE_NODE_WIDTH / 2,
        y: state.flowViewportCenter.y - 160,
      })
    : undefined;
  // A machine picked in the recipe finder spawns the node with that handler
  // selected, at the handler's own minimum tier.
  const spawnHandler = options?.machineHandlerId
    ? recipe.machineHandlers?.find((handler) => handler.id === options.machineHandlerId)
    : undefined;
  const node: FactoryNode = {
    id: createId("node"),
    recipeId: recipe.id,
    machineCount: 1,
    parallel: 1,
    machineHandlerId: spawnHandler?.id,
    overclockTier: spawnHandler?.minimumTier ?? recipe.minimumTier,
    recipeInputOverrides: resource ? buildRecipeInputOverrides(recipe, resource) : undefined,
    colorTag: options?.colorTag,
    enabled: true,
    position:
      viewportPosition ??
      snapPositionToGrid({
        x: 100 + index * 80,
        y: 120 + (index % 4) * 80,
      }),
  };
  const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
  const project = touchProject({
    ...state.project,
    recipes: recipeAlreadyInProject
      ? state.project.recipes.map((entry) =>
          entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
        )
      : [...state.project.recipes, recipe],
    nodes: [...state.project.nodes, node],
  });

  return withProjectHistory(state, {
    project,
    selectedNodeId: node.id,
    selectedRecipeId: recipe.id,
    lastResult: calculateThroughput(project),
  });
}

function addConnectedRecipeNodeToState(
  state: FactoryStore,
  recipe: Recipe,
  anchorNodeId: string,
  resource: RecipeInputContextResource,
): Partial<FactoryStore> {
  const anchorNode = state.project.nodes.find((node) => node.id === anchorNodeId);
  const anchorRecipe = state.project.recipes.find((entry) => entry.id === anchorNode?.recipeId);

  if (!anchorNode || !anchorRecipe) {
    return state;
  }

  const recipeAlreadyInProject = state.project.recipes.some((entry) => entry.id === recipe.id);
  const nextNode: FactoryNode = {
    id: createId("node"),
    recipeId: recipe.id,
    machineCount: 1,
    parallel: 1,
    overclockTier: recipe.minimumTier,
    recipeInputOverrides: buildRecipeInputOverrides(recipe, resource),
    enabled: true,
    position: snapPositionToGrid(
      resource.mode === "recipes"
        ? { x: anchorNode.position.x - 440, y: anchorNode.position.y }
        : { x: anchorNode.position.x + 440, y: anchorNode.position.y },
    ),
  };

  const projectWithNode: FactoryProject = {
    ...state.project,
    recipes: recipeAlreadyInProject
      ? state.project.recipes.map((entry) =>
          entry.id === recipe.id ? mergeRecipe(entry, recipe) : entry,
        )
      : [...state.project.recipes, recipe],
    nodes: [...state.project.nodes, nextNode],
  };

  const project = touchProject(projectWithNode);

  return withProjectHistory(state, {
    project,
    selectedNodeId: nextNode.id,
    selectedRecipeId: recipe.id,
    lastResult: calculateThroughput(project),
  });
}

function buildRecipeInputOverrides(
  recipe: Recipe,
  resource: RecipeInputContextResource,
): FactoryNode["recipeInputOverrides"] {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  recipe.inputs.forEach((input, index) => {
    if (input.kind !== resource.kind) {
      return;
    }
    const matchesSlot =
      resource.neiSlot &&
      input.neiSlot &&
      resource.neiSlot.x === input.neiSlot.x &&
      resource.neiSlot.y === input.neiSlot.y;
    const matchesIndex = resource.neiSlot === undefined && resource.inputIndex === index;
    const matchesResource =
      resource.neiSlot === undefined &&
      resource.inputIndex === undefined &&
      resourceMatchesInput(resource, input);
    if (!matchesSlot && !matchesIndex && !matchesResource) {
      return;
    }

    const alternative = input.alternatives?.find(
      (entry) => entry.kind === resource.kind && entry.id === resource.id,
    );

    overrides[String(index)] = {
      ...input,
      ...alternative,
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName ?? alternative?.displayName ?? input.displayName,
      iconPath: resource.iconPath ?? alternative?.iconPath ?? input.iconPath,
      iconAtlas: resource.iconAtlas ?? alternative?.iconAtlas ?? input.iconAtlas,
      dominantColor: resource.dominantColor ?? alternative?.dominantColor ?? input.dominantColor,
      tooltip: resource.tooltip ?? alternative?.tooltip ?? input.tooltip,
      modId: resource.modId ?? alternative?.modId ?? input.modId,
      alternatives: undefined,
    };
  });

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function mergeRecipe(existing: Recipe, incoming: Recipe): Recipe {
  return {
    ...existing,
    ...incoming,
    inputs: incoming.inputs.length > 0 ? incoming.inputs : existing.inputs,
    outputs: incoming.outputs.length > 0 ? incoming.outputs : existing.outputs,
    nei: incoming.nei ?? existing.nei,
    machineHandlers: incoming.machineHandlers ?? existing.machineHandlers,
    machineConfigControls: incoming.machineConfigControls ?? existing.machineConfigControls,
  };
}

function mergeRefreshedRecipe(incoming: Recipe): Recipe {
  return {
    ...incoming,
  };
}

function buildRecipeInputOverridesFromContextualRecipeInputs(
  existingRecipe: Recipe,
  refreshedRecipe: Recipe,
): NonNullable<FactoryNode["recipeInputOverrides"]> {
  const overrides: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  refreshedRecipe.inputs.forEach((refreshedInput, index) => {
    const existingInput = existingRecipe.inputs[index];
    if (!existingInput || !isContextualRecipeInput(existingInput, refreshedInput)) {
      return;
    }

    overrides[String(index)] = {
      ...refreshedInput,
      id: existingInput.id,
      displayName: existingInput.displayName ?? refreshedInput.displayName,
      iconPath: existingInput.iconPath ?? refreshedInput.iconPath,
      iconAtlas: existingInput.iconAtlas ?? refreshedInput.iconAtlas,
      dominantColor: existingInput.dominantColor ?? refreshedInput.dominantColor,
      tooltip: existingInput.tooltip ?? refreshedInput.tooltip,
      alternatives: undefined,
    };
  });

  return overrides;
}

function isContextualRecipeInput(
  existingInput: Recipe["inputs"][number],
  refreshedInput: Recipe["inputs"][number],
): boolean {
  return (
    existingInput.kind === refreshedInput.kind &&
    existingInput.id !== refreshedInput.id &&
    !isOreDictionaryResource(existingInput) &&
    resourceMatchesInput({ kind: existingInput.kind, id: existingInput.id }, refreshedInput)
  );
}

function applyEdgeInputOverrides(project: FactoryProject, edges: FactoryEdge[]): FactoryProject {
  return edges.reduce((nextProject, edge) => applyEdgeInputOverride(nextProject, edge), project);
}

function applyEdgeInputOverride(
  project: FactoryProject,
  edge: FactoryEdge,
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  > &
    Partial<Pick<ResourceAmount, "amount">>,
): FactoryProject {
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);
  if (!targetNode || !targetRecipe) {
    return project;
  }

  const targetHandle = parseResourceHandleId(edge.targetHandle);
  const inputIndex =
    targetHandle?.side === "input" && targetHandle.slotIndex !== undefined
      ? targetHandle.slotIndex
      : targetRecipe.inputs.findIndex(
          (input) =>
            isRecipeInputConsumed(input) &&
            resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
        );
  const input = inputIndex >= 0 ? targetRecipe.inputs[inputIndex] : undefined;
  if (
    !input ||
    !isRecipeInputConsumed(input) ||
    !resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input)
  ) {
    return project;
  }

  const alternative = input.alternatives?.find(
    (entry) => entry.kind === edge.resourceKind && entry.id === edge.resourceId,
  );
  const override: Recipe["inputs"][number] = {
    ...input,
    ...alternative,
    kind: edge.resourceKind,
    id: edge.resourceId,
    // Only converts when the kind actually changes — see the helper. Taking
    // the cell's fluid amount unconditionally inflated same-kind cell wiring
    // by 1000×.
    amount: resource?.amount ?? crossKindInputOverrideAmount(input, edge.resourceKind, alternative),
    displayName:
      resource?.displayName ?? edge.label ?? alternative?.displayName ?? input.displayName,
    iconPath: resource?.iconPath ?? alternative?.iconPath ?? input.iconPath,
    iconAtlas: resource?.iconAtlas ?? alternative?.iconAtlas ?? input.iconAtlas,
    dominantColor: resource?.dominantColor ?? alternative?.dominantColor ?? input.dominantColor,
    tooltip: resource?.tooltip ?? alternative?.tooltip ?? input.tooltip,
    alternatives: undefined,
  };

  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === targetNode.id
        ? {
            ...node,
            recipeInputOverrides: {
              ...node.recipeInputOverrides,
              [String(inputIndex)]: override,
            },
          }
        : node,
    ),
  };
}

function pruneOrphanStorages(project: FactoryProject): FactoryProject {
  const storages = project.storages ?? [];
  if (storages.length === 0) {
    return project;
  }

  const linkedStorageIds = new Set<string>();
  for (const edge of project.edges) {
    linkedStorageIds.add(edge.source);
    linkedStorageIds.add(edge.target);
  }

  const nextStorages = storages.filter((storage) => linkedStorageIds.has(storage.id));
  return nextStorages.length === storages.length ? project : { ...project, storages: nextStorages };
}

function pruneInvalidEdgesAndOrphanStorages(project: FactoryProject): FactoryProject {
  const validEdges = project.edges.filter((edge) => isFactoryEdgeStillValid(project, edge));
  const projectWithValidEdges =
    validEdges.length === project.edges.length ? project : { ...project, edges: validEdges };
  return pruneOrphanStorages(projectWithValidEdges);
}

function isFactoryEdgeStillValid(project: FactoryProject, edge: FactoryEdge): boolean {
  const sourceNode = project.nodes.find((node) => node.id === edge.source);
  const targetNode = project.nodes.find((node) => node.id === edge.target);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === edge.source);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === edge.target);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if ((!sourceNode && !sourceStorage) || (!targetNode && !targetStorage)) {
    return false;
  }

  // Trash cans have no recipe slots to match: a line into one stays valid as
  // long as the far end still produces the wired resource.
  if (targetRecipe && isTrashRecipe(targetRecipe)) {
    if (sourceStorage) {
      return (
        edge.resourceKind === sourceStorage.kind && edge.resourceId === sourceStorage.resourceId
      );
    }
    if (!sourceNode || !sourceRecipe) {
      return false;
    }
    const effectiveSourceRecipe = applyRecipeInputOverrides(sourceRecipe, sourceNode);
    return effectiveSourceRecipe.outputs.some((output) =>
      resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
    );
  }

  if (sourceStorage && targetRecipe) {
    const effectiveTargetRecipe = targetNode
      ? applyRecipeInputOverrides(targetRecipe, targetNode)
      : targetRecipe;
    return (
      edge.resourceKind === sourceStorage.kind &&
      edge.resourceId === sourceStorage.resourceId &&
      effectiveTargetRecipe.inputs.some(
        (input) =>
          isRecipeInputConsumed(input) &&
          resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
      )
    );
  }

  if (sourceRecipe && targetStorage) {
    const effectiveSourceRecipe = sourceNode
      ? applyRecipeInputOverrides(sourceRecipe, sourceNode)
      : sourceRecipe;
    return (
      edge.resourceKind === targetStorage.kind &&
      edge.resourceId === targetStorage.resourceId &&
      effectiveSourceRecipe.outputs.some(
        (output) => resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
      )
    );
  }

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return false;
  }

  const effectiveSourceRecipe = applyRecipeInputOverrides(sourceRecipe, sourceNode);
  const effectiveTargetRecipe = applyRecipeInputOverrides(targetRecipe, targetNode);

  return (
    effectiveSourceRecipe.outputs.some(
      (output) => resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, output),
    ) &&
    effectiveTargetRecipe.inputs.some(
      (input) =>
        isRecipeInputConsumed(input) &&
        resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
    )
  );
}

function buildEdgeBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
  selectedResource?: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
  > & {
    amount?: number;
    sourceHandle?: string;
    targetHandle?: string;
  },
): FactoryEdge | undefined {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceStorage = (project.storages ?? []).find((storage) => storage.id === sourceNodeId);
  const targetStorage = (project.storages ?? []).find((storage) => storage.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if ((!sourceNode && !sourceStorage) || (!targetNode && !targetStorage)) {
    return undefined;
  }

  if (sourceStorage && targetRecipe && selectedResource) {
    const effectiveTargetRecipe = targetNode
      ? applyRecipeInputOverrides(targetRecipe, targetNode)
      : targetRecipe;
    const matchedInput = effectiveTargetRecipe.inputs.find(
      (input) =>
        sourceStorage.kind === selectedResource.kind &&
        sourceStorage.resourceId === selectedResource.id &&
        resourceMatchesInput(sourceStorageResource(sourceStorage), input) &&
        isRecipeInputConsumed(input),
    );
    if (!matchedInput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceStorage.id,
      target: targetNodeId,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: sourceStorage.kind,
      resourceId: sourceStorage.resourceId,
      label: resourceLabel(matchedInput),
    };
  }

  if (sourceRecipe && targetStorage && selectedResource) {
    const effectiveSourceRecipe = sourceNode
      ? applyRecipeInputOverrides(sourceRecipe, sourceNode)
      : sourceRecipe;
    const matchedOutput = effectiveSourceRecipe.outputs.find(
      (output) =>
        resourceMatchesInput(sourceStorageResource(targetStorage), output),
    );
    if (!matchedOutput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceNodeId,
      target: targetStorage.id,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: targetStorage.kind,
      resourceId: targetStorage.resourceId,
      label: resourceLabel(matchedOutput),
    };
  }

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return undefined;
  }

  if (selectedResource?.sourceHandle && selectedResource.targetHandle) {
    const matchedInput = getExplicitTargetInput(targetRecipe, targetNode, selectedResource);
    if (!matchedInput) {
      return undefined;
    }

    return {
      id: createId("edge"),
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: selectedResource.sourceHandle,
      targetHandle: selectedResource.targetHandle,
      resourceKind: selectedResource.kind,
      resourceId: selectedResource.id,
      label: selectedResource.displayName ?? resourceLabel(matchedInput),
    };
  }

  const matchedOutput = selectedResource
    ? sourceRecipe.outputs.find(
        (output) =>
          output.kind === selectedResource.kind &&
          output.id === selectedResource.id &&
          targetRecipe.inputs.some(
            (input) => isRecipeInputConsumed(input) && resourceMatchesInput(output, input),
          ),
      )
    : sourceRecipe.outputs.find((output) =>
        targetRecipe.inputs.some(
          (input) => isRecipeInputConsumed(input) && resourceMatchesInput(output, input),
        ),
      );

  if (!matchedOutput) {
    return undefined;
  }

  return {
    id: createId("edge"),
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle: selectedResource?.sourceHandle,
    targetHandle: selectedResource?.targetHandle,
    resourceKind: matchedOutput.kind,
    resourceId: matchedOutput.id,
    label: resourceLabel(matchedOutput),
  };
}

function getExplicitTargetInput(
  targetRecipe: Recipe,
  targetNode: FactoryNode,
  selectedResource: Pick<ResourceAmount, "kind" | "id"> & {
    targetHandle?: string;
  },
): Recipe["inputs"][number] | undefined {
  const targetHandle = parseResourceHandleId(selectedResource.targetHandle);
  const targetRecipeWithOverrides = applyRecipeInputOverrides(targetRecipe, targetNode);
  const indexedInput =
    targetHandle?.side === "input" && targetHandle.slotIndex !== undefined
      ? targetRecipeWithOverrides.inputs[targetHandle.slotIndex]
      : undefined;

  if (
    indexedInput &&
    isRecipeInputConsumed(indexedInput) &&
    resourceMatchesInput(selectedResource, indexedInput)
  ) {
    return indexedInput;
  }

  return targetRecipeWithOverrides.inputs.find(
    (input) => isRecipeInputConsumed(input) && resourceMatchesInput(selectedResource, input),
  );
}

function buildCompatibleEdgesBetweenNodes(
  project: FactoryProject,
  sourceNodeId: string,
  targetNodeId: string,
): FactoryEdge[] {
  const sourceNode = project.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = project.nodes.find((node) => node.id === targetNodeId);
  const sourceRecipe = project.recipes.find((recipe) => recipe.id === sourceNode?.recipeId);
  const targetRecipe = project.recipes.find((recipe) => recipe.id === targetNode?.recipeId);

  if (!sourceNode || !targetNode || !sourceRecipe || !targetRecipe) {
    return [];
  }

  const edges: FactoryEdge[] = [];

  sourceRecipe.outputs.forEach((output, outputIndex) => {
    targetRecipe.inputs.forEach((input, inputIndex) => {
      if (!isRecipeInputConsumed(input) || !resourceMatchesInput(output, input)) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: output.kind,
        resourceId: output.id,
        label: resourceLabel(output),
      });
    });
  });

  return edges;
}

function buildCompatibleEdgesForStorage(
  project: FactoryProject,
  storage: FactoryStorage,
): FactoryEdge[] {
  const edges: FactoryEdge[] = [];
  const storageInputHandle = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const storageOutputHandle = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });

  for (const node of project.nodes) {
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    if (!recipe) {
      continue;
    }
    const effectiveRecipe = applyRecipeInputOverrides(recipe, node);

    effectiveRecipe.outputs.forEach((output, outputIndex) => {
      if (!resourceMatchesInput(sourceStorageResource(storage), output)) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: node.id,
        target: storage.id,
        sourceHandle: makeResourceHandleId("output", output, outputIndex),
        targetHandle: storageInputHandle,
        resourceKind: storage.kind,
        resourceId: storage.resourceId,
        label: resourceLabel(output),
      });
    });

    effectiveRecipe.inputs.forEach((input, inputIndex) => {
      if (
        input.consumed === false ||
        !resourceMatchesInput(sourceStorageResource(storage), input)
      ) {
        return;
      }

      edges.push({
        id: createId("edge"),
        source: storage.id,
        target: node.id,
        sourceHandle: storageOutputHandle,
        targetHandle: makeResourceHandleId("input", input, inputIndex),
        resourceKind: storage.kind,
        resourceId: storage.resourceId,
        label: resourceLabel(input),
      });
    });
  }

  const deduped: FactoryEdge[] = [];
  for (const edge of edges) {
    if (!hasDuplicateEdge(deduped, edge)) {
      deduped.push(edge);
    }
  }

  return deduped;
}

function sourceStorageResource(storage: FactoryStorage): Pick<ResourceAmount, "kind" | "id"> {
  return { kind: storage.kind, id: storage.resourceId };
}

function getStorageResourceForConnection(
  resource: Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  > &
    Partial<Pick<ResourceAmount, "tooltip" | "amount" | "alternatives">>,
): Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
> &
  Partial<Pick<ResourceAmount, "amount">> {
  return getFilledCellFluidEquivalent(resource) ?? resource;
}

function hasDuplicateEdge(edges: FactoryEdge[], edge: FactoryEdge): boolean {
  return Boolean(findDuplicateEdge(edges, edge));
}

function findDuplicateEdge(edges: FactoryEdge[], edge: FactoryEdge): FactoryEdge | undefined {
  return edges.find(
    (existing) =>
      existing.source === edge.source &&
      existing.target === edge.target &&
      existing.resourceKind === edge.resourceKind &&
      existing.resourceId === edge.resourceId &&
      existing.sourceHandle === edge.sourceHandle &&
      existing.targetHandle === edge.targetHandle,
  );
}

function hasStorageEndpointConflict(project: FactoryProject, edge: FactoryEdge): boolean {
  if (!findEdgeStorage(project, edge)) {
    return false;
  }

  const recipeEndpointKey = getRecipeEndpointKey(project, edge);
  if (!recipeEndpointKey) {
    return false;
  }

  return project.edges.some(
    (existingEdge) =>
      findEdgeStorage(project, existingEdge) &&
      existingEdge.resourceKind === edge.resourceKind &&
      existingEdge.resourceId === edge.resourceId &&
      getRecipeEndpointKey(project, existingEdge) === recipeEndpointKey,
  );
}

function findEdgeStorage(project: FactoryProject, edge: FactoryEdge): FactoryStorage | undefined {
  return (
    (project.storages ?? []).find((storage) => storage.id === edge.source) ??
    (project.storages ?? []).find((storage) => storage.id === edge.target)
  );
}

function getRecipeEndpointKey(project: FactoryProject, edge: FactoryEdge): string | undefined {
  const sourceIsStorage = (project.storages ?? []).some((storage) => storage.id === edge.source);
  const targetIsStorage = (project.storages ?? []).some((storage) => storage.id === edge.target);

  if (sourceIsStorage && !targetIsStorage) {
    return `target:${edge.target}:${edge.targetHandle ?? ""}`;
  }

  if (targetIsStorage && !sourceIsStorage) {
    return `source:${edge.source}:${edge.sourceHandle ?? ""}`;
  }

  return undefined;
}

function makeResourceHandleId(
  side: "input" | "output",
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

function parseResourceHandleId(handleId?: string | null):
  | {
      side: "input" | "output";
      kind: ResourceKind;
      resourceId: string;
      slotIndex?: number;
    }
  | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId, encodedSlotIndex] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid") ||
    !encodedResourceId
  ) {
    return undefined;
  }

  return {
    side,
    kind,
    resourceId: decodeURIComponent(encodedResourceId),
    slotIndex:
      encodedSlotIndex !== undefined && encodedSlotIndex.trim() !== ""
        ? Number.parseInt(encodedSlotIndex, 10)
        : undefined,
  };
}

function haveSameMachineCounts(left: FactoryProject, right: FactoryProject): boolean {
  if (left.nodes.length !== right.nodes.length) {
    return false;
  }

  const rightCounts = new Map(right.nodes.map((node) => [node.id, node.machineCount]));
  return left.nodes.every((node) => rightCounts.get(node.id) === node.machineCount);
}

function touchProject(project: FactoryProject): FactoryProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}

function updateResourceHistory(
  history: RecipeBrowserResource[],
  resource: RecipeBrowserResource,
): RecipeBrowserResource[] {
  const entry: RecipeBrowserResource = {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
  };
  const key = getResourceKey(entry);

  return [entry, ...history.filter((item) => getResourceKey(item) !== key)].slice(
    0,
    RESOURCE_HISTORY_LIMIT,
  );
}

export function loadResourceHistory(): RecipeBrowserResource[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawHistory = window.localStorage.getItem(RESOURCE_HISTORY_STORAGE_KEY);
    if (!rawHistory) {
      return [];
    }

    return normalizeResourceHistory(JSON.parse(rawHistory));
  } catch {
    return [];
  }
}

function saveResourceHistory(history: RecipeBrowserResource[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      RESOURCE_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeResourceHistory(history)),
    );
  } catch {
    // Best effort cache: failing to persist quick access should not block browsing.
  }
}

function scheduleIdleBrowserWork(callback: () => void) {
  if (typeof window === "undefined") {
    return;
  }

  const scheduler = window as Window & {
    requestIdleCallback?: (handler: () => void, options?: { timeout: number }) => number;
  };

  if (scheduler.requestIdleCallback) {
    scheduler.requestIdleCallback(callback, { timeout: 1000 });
    return;
  }

  queueMicrotask(callback);
}

function normalizeResourceHistory(value: unknown): RecipeBrowserResource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const history: RecipeBrowserResource[] = [];

  for (const item of value) {
    if (!isStoredRecipeBrowserResource(item)) {
      continue;
    }

    const entry: RecipeBrowserResource = {
      kind: item.kind,
      id: item.id,
      displayName: item.displayName,
      iconPath: item.iconPath,
      iconAtlas: item.iconAtlas,
      dominantColor: item.dominantColor ?? item.iconAtlas?.dominantColor,
    };
    const key = getResourceKey(entry);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    history.push(entry);
    if (history.length >= RESOURCE_HISTORY_LIMIT) {
      break;
    }
  }

  return history;
}

function isStoredRecipeBrowserResource(value: unknown): value is RecipeBrowserResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const resource = value as Partial<RecipeBrowserResource>;
  return (
    (resource.kind === "item" || resource.kind === "fluid") &&
    typeof resource.id === "string" &&
    resource.id.length > 0 &&
    (resource.displayName === undefined || typeof resource.displayName === "string") &&
    (resource.iconPath === undefined || typeof resource.iconPath === "string") &&
    (resource.iconAtlas === undefined || typeof resource.iconAtlas === "object") &&
    (resource.dominantColor === undefined || typeof resource.dominantColor === "string")
  );
}

type IconResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function refreshProjectResourceIcons(
  project: FactoryProject,
  dataset: RecipeDataset,
): FactoryProject {
  const iconsByResource = getDatasetIconLookup(dataset);

  return {
    ...project,
    recipes: project.recipes.map((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((input) => refreshResourceIcon(input, iconsByResource)),
      outputs: recipe.outputs.map((output) => refreshResourceIcon(output, iconsByResource)),
    })),
    storages: project.storages?.map((storage) => refreshStorageIcon(storage, iconsByResource)),
  };
}

function refreshResourceHistoryIcons(
  history: RecipeBrowserResource[],
  dataset: RecipeDataset,
): RecipeBrowserResource[] {
  const iconsByResource = getDatasetIconLookup(dataset);
  return history.map((resource) => refreshBrowserResourceIcon(resource, dataset, iconsByResource));
}

function refreshBrowserResourceIcon(
  resource: RecipeBrowserResource,
  dataset: RecipeDataset,
  iconsByResource = getDatasetIconLookup(dataset),
): RecipeBrowserResource {
  return refreshResourceIcon(resource, iconsByResource);
}

function refreshPendingResourceConnectionIcon(
  resource: PendingResourceConnection,
  dataset: RecipeDataset,
): PendingResourceConnection {
  const indexed = getDatasetIconLookup(dataset).get(`${resource.kind}:${resource.resourceId}`);
  if (!indexed) {
    return resource;
  }

  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

function refreshStorageIcon(
  storage: FactoryStorage,
  iconsByResource: Map<string, IconResource>,
): FactoryStorage {
  const indexed = iconsByResource.get(`${storage.kind}:${storage.resourceId}`);
  if (!indexed) {
    return storage;
  }

  return {
    ...storage,
    displayName: storage.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? storage.dominantColor,
  };
}

function refreshResourceIcon<T extends IconResource>(
  resource: T,
  iconsByResource: Map<string, IconResource>,
): T {
  const indexed = iconsByResource.get(getResourceKey(resource));
  if (!indexed) {
    return resource;
  }

  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: indexed.iconPath,
    iconAtlas: indexed.iconAtlas,
    dominantColor:
      indexed.dominantColor ?? indexed.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

function getDatasetIconLookup(dataset: RecipeDataset): Map<string, IconResource> {
  const iconsByResource = new Map<string, IconResource>();
  for (const resource of [...dataset.resources, ...(dataset.resourceIndex ?? [])]) {
    if (!resource.iconPath && !resource.iconAtlas) {
      continue;
    }

    const key = getResourceKey(resource);
    const existing = iconsByResource.get(key);
    if (
      !existing ||
      (!existing.iconPath && resource.iconPath) ||
      (!existing.iconAtlas && resource.iconAtlas)
    ) {
      iconsByResource.set(key, resource);
    }
  }

  return iconsByResource;
}

/** A clone lands two cells down and across from its original. */
const CLONE_OFFSET = BOARD_GRID * 2;

/**
 * Annotations are the one thing on the board the user sizes by hand, so they
 * get snapped on the way into the project rather than left to the magnet: a
 * box drawn freehand still ends up a whole number of cells, on a cell corner.
 * Only the keys present in the patch are touched.
 */
function snapAnnotationToGrid(
  patch: Partial<FactoryAnnotation>,
): Partial<FactoryAnnotation> {
  const snapped: Partial<FactoryAnnotation> = {};
  if (patch.position) {
    snapped.position = snapPositionToGrid(patch.position);
  }
  if (patch.size) {
    snapped.size = {
      width: snapSizeUpToGrid(patch.size.width),
      height: snapSizeUpToGrid(patch.size.height),
    };
  }
  return snapped;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
