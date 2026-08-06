"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AlertTriangle, ChevronDown, Copy, Minus, Plus, Sprout } from "lucide-react";
import type {
  FactoryNode,
  MachineConfigTierOption,
  MachineTier,
  NodeThroughputResult,
  Recipe,
  ResourceAmount,
} from "@/lib/model/types";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import {
  applyMachineOutputMultipliers,
  getMachineParallelMultiplier,
} from "@/lib/solver/machine-effects";
import {
  formatCompact,
  formatRate,
  applyMachineHandlerToRecipe,
  GT_OVERCLOCK_TIERS,
  getHighestFiniteVoltageTier,
  getRecipeMachineHandlers,
  getRecipeMachineConfigTierControls,
  getRecipeCoilTierControl,
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
  getRecipePowerTier,
  getSelectedMachineHandler,
  getCropsNhStats,
  getVoltageTierIndex,
  BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID,
  BEE_INDUSTRIAL_SPEED_CONTROL_ID,
  isSteamMachineHandler,
  isBeeFrameSlotControlId,
  isBeeProductionConfigControl,
  isBeeProductionRecipe,
  isCropFarmRecipe,
  isCropProductionConfigControl,
  isCropProductionRecipe,
  isIndustrialApiaryMachineType,
  isVoltageTierAbove,
  makeResourceKey,
  resourceMatchesInput,
  resourceLabel,
  type MachineConfigTierControl,
} from "@/lib/model";
import {
  CUSTOM_RATE_ANY_RESOURCE_ID,
  getCustomRateSlot,
  isCustomRateRecipe,
  type CustomRateMode,
} from "@/lib/model/custom-rate";
import { rateUnitMultiplier, rateUnitSuffix } from "@/lib/model/rate-unit";
import { BOARD_GRID, CONFIG_PANEL_ROW_HEIGHT, RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { CropPickerMenu } from "./CropPickerMenu";
import { MachineCompareTable, MachineIconTab, MachineTabStrip } from "./MachinePicker";
import { NodeGlanceText } from "./NodeGlance";
import { isWiringConnection } from "./connection-drag";
import { useMachineHandlerIcons } from "./machine-icons";
import { MinecraftSelect } from "./MinecraftSelect";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { MachineStatsContent } from "./MachineStatsContent";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import {
  canonicalizeResourceHandleId,
  makeResourceHandleId,
} from "./resource-handles";
import {
  buildLimitLadder,
  buildRailPorts,
  deriveNodeVerdict,
  type NodeVerdict,
  type RailPort,
} from "./node-verdict";
import {
  edgeTouchesResource,
  explainPlug,
  explainPort,
  formatPct,
  formatSlotRate,
  formatSlotRateBare,
  formatSlotRateOrNull,
  formatTimes,
  type PortStory,
} from "./flow-explainers";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS, heatmapColorFor, heatmapInkFor } from "./node-colors";
import { useBoardView } from "./board-view";
import { getPaintBrushCursor } from "./paint-cursor";
import { GT_TIER_COLORS } from "./tier-colors";

// Full width so the crop config panel and stat grid line up with the recipe
// canvas edge instead of forcing their own wider box.
const CROP_CONFIG_PANEL_WIDTH_CLASS = "w-full";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

function RecipeNodeComponent({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const [isCompareOpen, setCompareOpen] = useState(false);
  const [previewHandlerId, setPreviewHandlerId] = useState<string>();
  // Hovering a config option shows the node as if it were picked. Same shape
  // as the machine-tab preview: display-only, never written to the project.
  const [previewConfigTier, setPreviewConfigTier] = useState<{
    controlId: string;
    key: string;
  }>();
  const [isCropMenuOpen, setCropMenuOpen] = useState(false);
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const duplicateNode = useFactoryStore((state) => state.duplicateNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const maxTierFilter = useFactoryStore((state) => state.maxTierFilter);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const dataset = useFactoryStore((state) => state.dataset);
  const isSearchHighlighted = recipeContainsSearchResource(recipe, recipeSearch);
  const isFlowResourceHighlighted = recipeContainsResourceKey(
    recipe,
    hoveredFlowResourceKey ?? selectedFlowResourceKey,
  );
  const isNodeBottleneckHighlighted =
    (hoveredNodeBottlenecks || selectedNodeBottlenecks) && result?.status === "bottleneck";
  const isUsageHighlighted = useFactoryStore(
    (state) => state.hoveredUsageNodeId === projectNode.id,
  );
  const isInspectorHighlighted =
    isFlowResourceHighlighted || isNodeBottleneckHighlighted || isUsageHighlighted;
  // Heatmap wins over the paint tag while it is on, and gives it straight back
  // when it goes off — the tag is never written to or lost.
  const { heatmapMode, calmMode } = useBoardView();
  const paintColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;
  const heatColor = heatmapMode
    ? heatmapColorFor(result?.utilization, projectNode.enabled !== false)
    : undefined;
  const nodeColor = heatColor ?? paintColor;
  // Only the heatmap flips the ink. A hand-painted node keeps every element
  // in its theme colours and just tints the panels behind them: half the card
  // is textures and inset chips that don't recolour, and switching the text
  // under them to match the paint made those pieces harder to read, not
  // easier.
  const nodeInk = heatColor ? heatmapInkFor(heatColor.panel) : undefined;
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
  // Recipe derivation is pure in (recipe, projectNode, dataset) but ran on every
  // render, including renders caused by unrelated store writes such as hover or
  // search. It also rebuilt `overclockedRecipe` each time, whose fresh identity
  // defeated NeiRecipeWindow's memo and re-ran the whole NEI pipeline downstream.
  const previewedNode = useMemo(() => {
    if (!previewConfigTier) {
      return projectNode;
    }
    return {
      ...projectNode,
      machineConfigTiers: {
        ...(projectNode.machineConfigTiers ?? {}),
        [previewConfigTier.controlId]: previewConfigTier.key,
      },
      // The coil knob still has its own legacy field; a preview that only
      // wrote the generic map would show nothing on a heating coil.
      ...(previewConfigTier.controlId === "heatingCoil"
        ? { coilTier: previewConfigTier.key }
        : undefined),
    };
  }, [previewConfigTier, projectNode]);
  const derived = useMemo(() => {
    const projectNode = previewedNode;
    const machineHandlers = getRecipeMachineHandlers(recipe);
    const selectedMachineHandler = getSelectedMachineHandler(recipe, projectNode);
    const nodeRecipe = applyRecipeInputOverrides(recipe, projectNode);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, projectNode);
    const recipePowerTier = getRecipePowerTier(effectiveRecipe);
    // A vanilla furnace or steam machine draws no EU, so offering ULV/LV/...
    // voltage tiers on it is meaningless - the chip disappears instead.
    const machineDrawsEu =
      effectiveRecipe.eut > 0 && !isSteamMachineHandler(selectedMachineHandler);
    const tierControl = machineDrawsEu
      ? getNodeTierControl(effectiveRecipe, projectNode)
      : undefined;
    const coilControl = getRecipeCoilTierControl(effectiveRecipe, projectNode);
    const coilResource = coilControl
      ? resolveDatasetMachineConfigResource(coilControl.resource, dataset)
      : undefined;
    const machineConfigControls = getRecipeMachineConfigTierControls(
      effectiveRecipe,
      projectNode,
    ).map((control) => ({
      ...control,
      resource: resolveDatasetMachineConfigResource(control.resource, dataset),
    }));
    const cropProductionControls = isCropProductionRecipe(effectiveRecipe)
      ? machineConfigControls.filter((control) => isCropProductionConfigControl(control.id))
      : [];
    const beeProductionControls = isBeeProductionRecipe(effectiveRecipe)
      ? machineConfigControls.filter((control) => isBeeProductionConfigControl(control.id))
      : [];
    const isBeeProductionNode = beeProductionControls.length > 0;
    const beeFrameControls = beeProductionControls.filter((control) =>
      isBeeFrameSlotControlId(control.id),
    );
    const tgsToolControls = machineConfigControls.filter(isTreeGrowthSimulatorToolControl);
    const overclockedStats = getOverclockedRecipeStats(nodeRecipe, projectNode);
    const toolAdjustedRecipe = applyTreeGrowthSimulatorToolInputs(effectiveRecipe, tgsToolControls);
    const visualToolAdjustedRecipe = restoreCrossKindInputOverrideVisuals(
      toolAdjustedRecipe,
      recipe,
      projectNode,
    );
    const displayRecipe = isBeeProductionNode
      ? stripBeeFrameSlotInputs(visualToolAdjustedRecipe)
      : visualToolAdjustedRecipe;
    const adjustedRecipe = applyMachineOutputMultipliers(
      displayRecipe,
      projectNode,
      overclockedStats.tier,
    );
    const overclockedRecipe = {
      ...displayRecipe,
      ...adjustedRecipe,
      ...overclockedStats,
    };

    const cropSeedResource =
      cropProductionControls.length > 0
        ? effectiveRecipe.inputs.find(
            (input) =>
              input.id.startsWith("factoryflow:cropsnh_seed:") ||
              input.id.startsWith("factoryflow:ic2_crop_seed:"),
          )
        : undefined;
    const cropTitle =
      cropSeedResource && recipe.name.includes(": ")
        ? recipe.name.slice(recipe.name.indexOf(": ") + 2)
        : undefined;
    const isCropFarmNode = isCropFarmRecipe(effectiveRecipe);
    const isCropFarmPlaceholder = isCropFarmNode && effectiveRecipe.outputs.length === 0;
    // Custom rate nodes: the dialed rate lives on the raw recipe (the panel
    // writes it there), so the slot is read from `recipe`, not the effective
    // pipeline output.
    const isCustomRateNode = isCustomRateRecipe(recipe);
    const customRateSlot = isCustomRateNode ? getCustomRateSlot(recipe) : undefined;
    const isCustomRatePlaceholder = isCustomRateNode && !customRateSlot;

    return {
      machineHandlers,
      selectedMachineHandler,
      effectiveRecipe,
      recipePowerTier,
      tierControl,
      coilControl,
      coilResource,
      cropProductionControls,
      cropTitle,
      isCropFarmNode,
      isCropFarmPlaceholder,
      isCustomRateNode,
      customRateSlot,
      isCustomRatePlaceholder,
      isCropProductionNode: cropProductionControls.length > 0,
      beeFrameControls,
      beePanelControls: getBeePanelControls(beeProductionControls),
      tgsToolControls,
      statsMachineConfigControls: machineConfigControls.filter(
        (control) =>
          !isTreeGrowthSimulatorToolControl(control) &&
          !isDisplayOnlyParallelControl(control) &&
          !isCropProductionConfigControl(control.id) &&
          !isBeeProductionConfigControl(control.id),
      ),
      machineParallelMultiplier: getMachineParallelMultiplier(effectiveRecipe, projectNode),
      overclockedRecipe,
      tierColor: tierControl ? GT_TIER_COLORS[tierControl.current] : undefined,
    };
  }, [dataset, previewedNode, recipe]);

  const {
    machineHandlers,
    selectedMachineHandler,
    effectiveRecipe,
    recipePowerTier,
    tierControl,
    coilControl,
    coilResource,
    cropProductionControls,
    cropTitle,
    isCropFarmNode,
    isCropFarmPlaceholder,
    isCustomRateNode,
    customRateSlot,
    isCustomRatePlaceholder,
    isCropProductionNode,
    beeFrameControls,
    beePanelControls,
    tgsToolControls,
    statsMachineConfigControls,
    machineParallelMultiplier,
    overclockedRecipe,
    tierColor,
  } = derived;
  // Verdict + rail ports read the board lazily (no extra subscription): the
  // node re-renders on every solver tick, which is exactly when any of these
  // numbers can change.
  const { project: liveProject, lastResult } = useFactoryStore.getState();
  const verdict = deriveNodeVerdict(liveProject, lastResult, projectNode.id);
  const rails = buildRailPorts(
    liveProject,
    lastResult,
    projectNode.id,
    overclockedRecipe,
    verdict,
  );
  const exceedsMaxTier =
    tierControl !== undefined &&
    maxTierFilter !== "all" &&
    isVoltageTierAbove(recipePowerTier, maxTierFilter);
  const updateTier = (direction: -1 | 1) => {
    if (!tierControl) {
      return;
    }

    const nextTier = getAdjacentTier(tierControl.current, tierControl.minimum, direction);
    if (nextTier !== tierControl.current) {
      updateNode(projectNode.id, { overclockTier: nextTier });
    }
  };
  const updateCoilTier = (nextTier: string) => {
    updateNode(projectNode.id, { coilTier: nextTier });
  };
  const updateMachineConfigTier = (controlId: string, nextTier: string) => {
    const nextMachineConfigTiers = {
      ...(projectNode.machineConfigTiers ?? {}),
      [controlId]: nextTier,
    };
    if (controlId === BEE_INDUSTRIAL_SPEED_CONTROL_ID && nextTier === "speed-8-upgraded") {
      nextMachineConfigTiers[BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID] = "8";
    }

    updateNode(projectNode.id, {
      machineConfigTiers: nextMachineConfigTiers,
    });
  };
  // TGS tool slots and bee frame slots used to be icon menus painted over
  // recipe-canvas slots; with the canvas gone they join the regular config
  // panel as icon + dropdown rows (tiers filtered to each slot's category).
  const visibleMachineConfigControls = [
    ...(coilControl && coilResource ? [{ ...coilControl, resource: coilResource }] : []),
    ...tgsToolControls.map((control) => ({
      ...control,
      resource: getTreeGrowthSimulatorSlotResource(control),
      tiers: getTreeGrowthSimulatorSlotTiers(control),
    })),
    ...beeFrameControls,
    ...statsMachineConfigControls,
  ];
  const machineConfigPanel =
    visibleMachineConfigControls.length > 0 ? (
      <MachineConfigControlPanel
        controls={visibleMachineConfigControls}
        onPreview={(controlId, key) =>
          setPreviewConfigTier(key === undefined ? undefined : { controlId, key })
        }
        onSelect={(controlId, nextTier) => {
          setPreviewConfigTier(undefined);
          if (controlId === "heatingCoil") {
            updateCoilTier(nextTier);
            return;
          }
          updateMachineConfigTier(controlId, nextTier);
        }}
      />
    ) : undefined;
  const passiveProductionPanel =
    cropProductionControls.length > 0 ? (
      <PassiveProductionConfigPanel
        className={CROP_CONFIG_PANEL_WIDTH_CLASS}
        controls={cropProductionControls}
        onSelect={updateMachineConfigTier}
        getControlHelp={(controlId) => cropControlHelp(effectiveRecipe, controlId)}
      />
    ) : beePanelControls.length > 0 ? (
      <PassiveProductionConfigPanel
        controls={beePanelControls}
        onSelect={updateMachineConfigTier}
      />
    ) : undefined;
  const updateMachineHandler = (machineHandlerId: string) => {
    if (machineHandlers.length <= 1) {
      return;
    }

    const nextHandler =
      machineHandlers.find((handler) => handler.id === machineHandlerId) ?? selectedMachineHandler;
    updateNode(projectNode.id, {
      machineHandlerId: nextHandler.id,
      overclockTier: nextHandler.minimumTier,
    });
    setCompareOpen(false);
    setPreviewHandlerId(undefined);
  };

  const hasMachinePicker = machineHandlers.length > 1 && !isCropFarmNode;
  const machineIcons = useMachineHandlerIcons();
  // Presentation mode's tab zone: the selected machine's icon, big, and
  // nothing else. Crop farms and custom rate nodes have no machine to show.
  const machineTabIcon =
    calmMode && !isCropFarmNode && !isCustomRateNode
      ? machineIcons.get(selectedMachineHandler.id)
      : undefined;
  const previewHandler = hasMachinePicker
    ? (machineHandlers.find((handler) => handler.id === previewHandlerId) ?? selectedMachineHandler)
    : selectedMachineHandler;
  const isPreviewing = hasMachinePicker && previewHandler.id !== selectedMachineHandler.id;

  // Outputs end in coupling chips at the node's right edge — inside the
  // card, like inputs — so the node's box is the machine's box again and
  // wires reach the chips the same way they reach input chips.
  return (
    <div
      // The verdict gates WHICH rows the usage hover lights (globals.css):
      // a starved node blames its binding input, an over-asked one blames its
      // couplings, and lighting both at once answers the wrong question.
      data-verdict={verdict.kind}
      // Everything inside goes at the far zoom step except the glance layer;
      // see the rule in globals.css. Marking the root rather than listing the
      // sections means a panel added later is covered without being wired up.
      data-node-glance-root=""
      className={[
        // recipe-node-shell scopes the strip↔row hover link (globals.css):
        // hovering the verdict lights the input it blames, in pure CSS, so a
        // hover never re-renders a node.
        // The shell is the node's whole BOX — tab zone plus window — and is
        // deliberately unpainted: the frame and background live on the window
        // div below, so the tabs protrude over bare canvas. The router still
        // measures the shell, which is what keeps wires out of the tab zone.
        "recipe-node-shell group relative font-mono text-[var(--mc-ink)]",
        // Marker for the globals.css layer lift: with a picker popup open the
        // node (and the whole nodes layer) must paint above edges.
        isCompareOpen ? "recipe-node-popup-open" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
        isInspectorHighlighted
          ? "outline outline-4 outline-offset-4 outline-yellow-300 ring-8 ring-cyan-300 [filter:drop-shadow(0_0_16px_rgba(34,211,238,0.95))]"
          : "",
        exceedsMaxTier && !calmMode ? "ring-4 ring-red-500" : "",
      ].join(" ")}
      style={{
        // Every recipe card is the same 18 cells wide. Width used to be
        // content-driven (`w-max`), which put the card's right edge — and so
        // every output coupling — at an arbitrary sub-cell offset.
        width: RECIPE_NODE_WIDTH,
        ...(nodeColor
          ? ({
              // The paint decides the ink. Everything inside the card reads
              // its text colour from these two variables, so one assignment
              // here keeps names, rates and stats legible on black and on
              // white alike — no component needs to know its own colour.
              "--mc-ink": nodeInk?.ink,
              "--mc-ink-muted": nodeInk?.inkMuted,
            } as CSSProperties)
          : undefined),
        ...(paintCursor ? { cursor: paintCursor } : undefined),
      }}
    >
      {/* Zoomed out the card carries one fact: how hard this machine is
          running. Coloured by the same verdict tone the footer's state word
          uses, so a board full of these reads as a health map — red starved,
          amber over-asked, plain fine. */}
      <NodeGlanceText
        text={
          verdict.kind === "off" || verdict.kind === "no-recipe"
            ? "—"
            : `${verdict.pct > 0 && verdict.pct < 0.5 ? formatRate(verdict.pct, 1) : formatPct(verdict.pct)}%`
        }
        className={VERDICT_WORD_CLASS[verdictWord(verdict, isCustomRateNode).tone]}
      />
      {/* The tab zone: rows of whole cells ABOVE the window, over bare
          canvas — tabs, not a toolbar band inside the card. It is part of
          the shell's box, so the router keeps wires out of the space the
          tabs claim. Normal mode gets the picker strip; presentation mode
          gets the selected machine's icon, big, and nothing to click. */}
      {!calmMode && hasMachinePicker ? (
        <MachineTabStrip
          handlers={machineHandlers}
          selectedId={selectedMachineHandler.id}
          previewId={previewHandlerId}
          iconsById={machineIcons}
          onHover={setPreviewHandlerId}
          onSelect={updateMachineHandler}
          onToggleCompare={() => setCompareOpen((open) => !open)}
          isCompareOpen={isCompareOpen}
        />
      ) : machineTabIcon ? (
        <MachineIconTab icon={machineTabIcon} label={selectedMachineHandler.label} />
      ) : null}
      {/* The window: the painted card. The 2px frame is an INSET shadow, not
          a border — a real border sits outside the content box and would push
          every row 2px off the grid; painted inside, the window's box and its
          content box are the same rectangle, so a head of 40 and rows of 40
          land exactly on cell lines. The bevel is drawn at 4px and the frame
          covers its outer half, which reproduces the old 2px-inside-2px look
          exactly. */}
      <div
        className="relative bg-[var(--mc-78)] shadow-[inset_0_0_0_2px_var(--mc-96),inset_4px_4px_0_var(--mc-100),inset_-4px_-4px_0_var(--mc-33)]"
        style={
          nodeColor
            ? {
                backgroundColor: nodeColor.panel,
                boxShadow: `inset 0 0 0 2px ${nodeColor.border}, inset 4px 4px 0 var(--mc-100), inset -4px -4px 0 var(--mc-33), 0 0 0 2px ${nodeColor.shadow}`,
              }
            : undefined
        }
      >
      {exceedsMaxTier ? (
        <div
          className={[
            "pointer-events-none absolute -right-3 -top-3 z-40 flex max-w-[210px] items-center gap-2 border-4 px-2 py-1 font-mono text-[13px] font-black uppercase leading-tight shadow-[4px_4px_0_rgba(0,0,0,0.45)]",
            // Calm mode keeps the fact and drops the siren: same badge, steel.
            calmMode
              ? "border-[#28323d] bg-[#4a5a6c] text-white"
              : "border-red-700 bg-[#facc15] text-red-950 [text-shadow:1px_1px_0_rgba(255,255,255,0.45)]",
          ].join(" ")}
        >
          <AlertTriangle
            className={
              calmMode
                ? "h-7 w-7 shrink-0 text-white"
                : "h-7 w-7 shrink-0 fill-red-700 text-red-950"
            }
          />
          <span>{recipePowerTier} Required</span>
        </div>
      ) : null}
      {/* No vertical padding: the head, the rails, the panels and the footer
          each own a whole number of cells, and any padding here would push
          all of them off the grid. Horizontal padding is 8, which is what
          makes the rails add up to RECIPE_RAIL_AREA_WIDTH. */}
      <div className="px-2">
        {/* width:0 + min-width:100% — the picker header adapts to whatever
            width the recipe card sets and can never widen the node itself,
            no matter how long a machine name or tab strip gets. */}
        <div className="w-0 min-w-full">
        <div
          className={[
            // One head row, exactly two cells tall. The title bar inside it
            // stays 24px and centres in the row — the extra space is the
            // margin that puts the first port centre on a grid line.
            "grid h-[40px] min-w-0 items-center gap-1",
            // Calm mode drops the delete/clone chrome; the title takes the row.
            calmMode
              ? tierControl
                ? "grid-cols-[minmax(0,1fr)_50px]"
                : "grid-cols-[minmax(0,1fr)]"
              : tierControl
                ? "grid-cols-[24px_24px_minmax(0,1fr)_50px]"
                : "grid-cols-[24px_24px_minmax(0,1fr)]",
          ].join(" ")}
        >
          {!calmMode ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteNode(projectNode.id);
                }}
                className="nodrag h-6 w-6 border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-base leading-[16px] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-red-700"
                title="Delete node"
                aria-label="Delete node"
              >
                -
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  duplicateNode(projectNode.id);
                }}
                className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
                title="Clone node (same machine and settings, no wires)"
                aria-label="Clone node"
              >
                <Copy aria-hidden className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
          <div className="relative min-w-0">
            <MinecraftTooltip
              content={
                isCropFarmPlaceholder ? (
                  "Click to pick a crop"
                ) : isCustomRateNode ? (
                  customRateSlot ? (
                    customRateSlot.mode === "supply"
                      ? `Makes ${resourceLabel(customRateSlot.resource)} at the dialed rate for anything that asks.`
                      : `Constantly drains ${resourceLabel(customRateSlot.resource)} at the dialed rate.`
                  ) : (
                    "Wire any port to this — it adopts that resource."
                  )
                ) : (
                  <MachineStatsContent
                    recipe={recipe}
                    handler={selectedMachineHandler}
                    node={projectNode}
                  />
                )
              }
            >
              {/* One plain name bar for every node. Picker nodes already show
                  the selected machine in the tab strip above, so the old
                  icon-box + TIME/POWER/PARALLEL glance cells only overflowed
                  the narrow card; those numbers live in the hover and the
                  footer. */}
              <div
                role={isCropFarmNode ? "button" : undefined}
                tabIndex={isCropFarmNode ? 0 : undefined}
                onClick={
                  isCropFarmNode
                    ? (event) => {
                        event.stopPropagation();
                        setCropMenuOpen((open) => !open);
                      }
                    : undefined
                }
                className={[
                  // 13px: long GT machine names must read fully instead of
                  // getting chopped by the narrow card.
                  "minecraft-title flex h-6 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-[13px] leading-[18px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]",
                  // Symmetric padding keeps the crop name in the true middle;
                  // the picker chevron floats on the right without shifting it.
                  isCropFarmNode
                    ? "nodrag relative cursor-pointer px-5 hover:brightness-110"
                    : "px-2",
                ].join(" ")}
                style={nodeColor ? { backgroundColor: nodeColor.header } : undefined}
                title={isCropFarmNode ? "Pick a crop" : undefined}
              >
                <span className="mx-auto min-w-0 truncate">
                  {isCropFarmPlaceholder
                    ? "Pick a crop..."
                    : isCustomRateNode
                      ? // The resource is already on the port right below,
                        // with its icon. Repeating its name in the title only
                        // ever made the card wider.
                        "Custom Rate"
                      : (cropTitle ?? previewHandler.label)}
                  {isPreviewing ? " ?" : ""}
                </span>
                {isCropFarmNode ? (
                  <ChevronDown className="absolute right-1 top-1/2 h-3 w-3 shrink-0 -translate-y-1/2" />
                ) : null}
              </div>
            </MinecraftTooltip>
            {isCropMenuOpen ? (
              <CropPickerMenu
                nodeId={projectNode.id}
                onClose={() => setCropMenuOpen(false)}
              />
            ) : null}
            {hasMachinePicker && isCompareOpen && !calmMode ? (
              <MachineCompareTable
                recipe={recipe}
                handlers={machineHandlers}
                selectedId={selectedMachineHandler.id}
                iconsById={machineIcons}
                onHover={setPreviewHandlerId}
                onUse={updateMachineHandler}
                onClose={() => setCompareOpen(false)}
              />
            ) : null}
          </div>
          {tierControl && tierColor ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateTier(1);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateTier(-1);
              }}
              className="nodrag h-6 w-[50px] border-2 px-1 text-[11px] font-bold leading-[18px] shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
              style={{
                backgroundColor: tierColor.background,
                borderColor: tierColor.border,
                color: tierColor.text,
                textShadow: `1px 1px 0 ${tierColor.shadow}`,
              }}
              title={`Tier ${tierControl.current}. Left click up, right click down.`}
              aria-label={`Tier ${tierControl.current}`}
            >
              {tierControl.current}
            </button>
          ) : null}
        </div>
        </div>
        <div
          className={nodeColor ? "recipe-node-tinted-area" : undefined}
          style={
            nodeColor
              ? ({
                  "--recipe-node-tint": nodeColor.panel,
                  "--recipe-node-tint-header": nodeColor.header,
                  "--recipe-node-tint-border": nodeColor.border,
                } as CSSProperties)
              : undefined
          }
        >
          {isCropFarmPlaceholder ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCropMenuOpen(true);
              }}
              className="nodrag mx-auto my-0 flex h-[80px] w-[240px] items-center justify-center gap-2 border-2 border-dashed border-[var(--mc-33)] bg-[var(--mc-71)] text-[14px] font-bold text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
            >
              <Sprout className="h-5 w-5" /> Pick a crop
            </button>
          ) : isCustomRatePlaceholder ? (
            <CustomRateUniversalPorts nodeId={projectNode.id} />
          ) : (
          // The rails ARE the node now: ports carry the icons, rates, and
          // health that the recipe canvas used to duplicate. Recipe identity
          // lives in the header (name hover = full machine stats) and in the
          // port icons (click = recipes, right-click = uses).
          <div
            className={[
              "flex items-start gap-1",
              rails.inputs.length > 0 && rails.outputs.length > 0
                ? "justify-between"
                : rails.outputs.length > 0
                  ? "justify-end"
                  : "justify-start",
            ].join(" ")}
          >
            <PortRail
              nodeId={projectNode.id}
              side="input"
              ports={rails.inputs}
              pending={pendingResourceConnection}
            />
            {rails.inputs.length > 0 && rails.outputs.length > 0 ? (
              <div className="flex w-4 shrink-0 items-center justify-center self-stretch text-[15px] font-black text-[var(--mc-ink-muted)]">
                →
              </div>
            ) : null}
            <PortRail
              nodeId={projectNode.id}
              side="output"
              ports={rails.outputs}
              pending={pendingResourceConnection}
            />
          </div>
          )}
          {customRateSlot ? (
            <CustomRatePanel
              nodeId={projectNode.id}
              mode={customRateSlot.mode}
              kind={customRateSlot.resource.kind}
              perSecond={customRateSlot.resource.amount}
            />
          ) : null}
          {/* The bottom cluster: the config dials (coil tiers, TGS tools,
              crop knobs) and the stat footer, anchored together to the card's
              BOTTOM edge with a 6px inset clearing the frame's bevel. One
              rounded-up block for all of it, so the grid-rounding slack opens
              between the ports and the controls — never below the controls,
              where it read as the card trailing off. Calm mode drops the
              dials and the diagnostics; a custom rate node has no machine
              count, so calm mode drops its footer entirely. */}
          {!isCropFarmPlaceholder &&
          !isCustomRatePlaceholder &&
          (!calmMode || !isCustomRateNode) ? (
            <GridBlock minCells={3} align="end" className="min-w-0">
              {calmMode ? null : machineConfigPanel}
              {calmMode ? null : passiveProductionPanel}
              <div
                className={[
                  // A hairline over the stats: the knobs are one thing, the
                  // verdict below them is another.
                  "min-w-0 border-t border-[var(--mc-56)] pb-[6px] pt-[6px] text-[14px] leading-5 text-[var(--mc-ink)]",
                  nodeColor ? "recipe-node-stat-grid" : "",
                ].join(" ")}
                style={nodeColor ? { backgroundColor: nodeColor.panel } : undefined}
              >
                {calmMode ? (
                  /* Pure presentation: the count as one large line of text,
                     centred — no stepper, no box. The whole row is already
                     reserved, so the type gets to be big. */
                  <div className="flex min-w-0 items-center justify-center">
                    <span className="truncate text-[20px] font-bold leading-6 tabular-nums text-[var(--mc-ink)]">
                      {projectNode.machineCount}×{" "}
                      {isCropProductionNode
                        ? projectNode.machineCount === 1
                          ? "Seed"
                          : "Seeds"
                        : projectNode.machineCount === 1
                          ? "Machine"
                          : "Machines"}
                    </span>
                  </div>
                ) : (
                  <div
                    className={[
                      "grid min-w-0 items-center gap-1",
                      // Every cell sizes to its content except MACHINES, which
                      // takes the slack: a four-digit machine count is the one
                      // number here that legitimately gets wide. Parallel
                      // stretched to fill and then truncated its own label
                      // ("Parall…").
                      isCustomRateNode
                        ? "grid-cols-[auto]"
                        : machineParallelMultiplier > 1
                          ? "grid-cols-[auto_auto_minmax(84px,1fr)]"
                          : "grid-cols-[auto_minmax(84px,1fr)]",
                      isCropProductionNode ? CROP_CONFIG_PANEL_WIDTH_CLASS : "",
                    ].join(" ")}
                  >
                    <UsageStat
                      nodeId={projectNode.id}
                      verdict={verdict}
                      isCustomRate={isCustomRateNode}
                    />
                    {!isCustomRateNode ? (
                      <>
                        {machineParallelMultiplier > 1 ? (
                          <Stat
                            label="Parallel"
                            value={`×${formatMachineParallelMultiplier(machineParallelMultiplier)}`}
                          />
                        ) : null}
                        <MachineCountStat
                          label={isCropProductionNode ? "Seeds" : "Machines"}
                          machineCount={projectNode.machineCount}
                          onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
                        />
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </GridBlock>
          ) : null}
        </div>

        {isCropFarmPlaceholder || isCustomRatePlaceholder || (calmMode && isCustomRateNode) ? (
          /* No bottom cluster: a one-cell chin keeps the last row off the
             frame's inset bevel. Cards WITH the cluster get their clearance
             from its bottom inset instead. */
          <div aria-hidden className="h-[20px]" />
        ) : null}
      </div>
      </div>
    </div>
  );
}

// React Flow hands node components their live position (and dragging state) as
// props, so the default prop comparison fails on every drag frame — which
// re-rendered this entire NEI window per frame while its box moved. The
// component only reads `data` and `selected`; comparing exactly those keeps the
// heavy content inert while the wrapper is translated around it.
export const RecipeNode = memo(
  RecipeNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/** One word for the node's state, and where the fix lives. */
interface VerdictWord {
  word: string;
  /** red = something upstream holds this down. amber = fix is on this card. */
  tone: "short" | "over" | "calm";
}

function verdictWord(verdict: NodeVerdict, isCustomRate: boolean): VerdictWord {
  switch (verdict.kind) {
    case "starved":
      return { word: "bottleneck", tone: "short" };
    case "choke":
      return { word: "over-asked", tone: "over" };
    case "demand-set":
      return verdict.pct <= 0.05
        ? { word: "unused", tone: "calm" }
        : { word: isCustomRate ? "under the dial" : "on demand", tone: "calm" };
    case "balanced":
      return { word: isCustomRate ? "at the dial" : "full", tone: "calm" };
    case "unwired":
      return { word: isCustomRate ? "no wires" : "hand-fed", tone: "calm" };
    case "off":
      return { word: "off", tone: "calm" };
    case "no-recipe":
      return { word: "no recipe", tone: "calm" };
  }
}

const VERDICT_WORD_CLASS: Record<VerdictWord["tone"], string> = {
  short: "font-bold text-[var(--verdict-short-ink)]",
  over: "font-bold text-[var(--verdict-over-ink)]",
  calm: "text-[var(--mc-ink-muted)]",
};

/**
 * USAGE: the widest cell in the footer, carrying the number and one word for
 * why it reads that way. It replaced a four-line colored strip, and the two
 * rules that came out of that are worth keeping:
 *
 * - never a third line. The footer repeats on every node, so a line spent
 *   here is a line spent on the whole board; the fix note rides beside the
 *   USAGE label instead of below the number.
 * - the number is never colored. A node at 100% that still can't cover its
 *   asks proves the speed and the problem are different facts — color lives
 *   on the state word, which is the thing that says where to act.
 *
 * Everything longer (the honest rates, the culprit's own machine count, the
 * ladder of what caps this next) lives in the hover.
 */
function UsageStat({
  nodeId,
  verdict,
  isCustomRate = false,
}: {
  nodeId: string;
  verdict: NodeVerdict;
  isCustomRate?: boolean;
}) {
  const state = verdictWord(verdict, isCustomRate);
  const showPct = verdict.kind !== "off" && verdict.kind !== "no-recipe";

  return (
    <MinecraftTooltip
      content={<VerdictHoverContent nodeId={nodeId} verdict={verdict} isCustomRate={isCustomRate} />}
    >
      {/* One card, one divider: the number and the word are the same
          sentence — how hard it runs, and why. Two boxes read as two facts. */}
      <div className="flow-usage-stat flex min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
        <div className="min-w-0 px-1.5">
          <div className="text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
            Usage
          </div>
          <div className="text-[17px] font-bold leading-5 tabular-nums">
            {showPct ? (
              <>
                {/* Whole numbers — a decimal on a duty cycle is width, not
                    information. The exception is a node that runs so slowly it
                    would round to a flat 0% and read as dead. */}
                {verdict.pct > 0 && verdict.pct < 0.5
                  ? formatRate(verdict.pct, 1)
                  : formatPct(verdict.pct)}
                <span className="text-[13px]">%</span>
              </>
            ) : (
              <span className="text-[13px] text-[var(--mc-ink-muted)]">—</span>
            )}
          </div>
        </div>
        <div className="my-0.5 w-px shrink-0 bg-[var(--mc-47)]" />
        <div className="min-w-0 px-1.5">
          <div className="text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">
            Reason
          </div>
          <div
            className={[
              "truncate text-[13px] font-bold uppercase leading-5 tracking-[0.4px]",
              VERDICT_WORD_CLASS[state.tone],
            ].join(" ")}
          >
            {state.word}
          </div>
        </div>
      </div>
    </MinecraftTooltip>
  );
}

/**
 * The strip's hover: the sentence you'd say out loud, then where to act with
 * the culprit's OWN machine count, then the ladder — what caps this next and
 * where it lands once today's wall is gone.
 */
function VerdictHoverContent({
  nodeId,
  verdict,
  isCustomRate,
}: {
  nodeId: string;
  verdict: NodeVerdict;
  isCustomRate: boolean;
}) {
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const machineCount = Math.max(
    1,
    project.nodes.find((entry) => entry.id === nodeId)?.machineCount ?? 1,
  );
  const ladder = useMemo(
    () => buildLimitLadder(project, lastResult, nodeId),
    [lastResult, nodeId, project],
  );

  const title = verdictHoverTitle(verdict, isCustomRate);
  const detail = verdictHoverDetail(verdict, isCustomRate);
  const fix = verdictHoverFix(verdict, machineCount, isCustomRate);
  const next = ladder.length > 1 ? ladder[1] : undefined;

  return (
    <div className="w-64">
      <div className="text-[13px] font-semibold text-white">{title}</div>
      {detail ? <div className="mt-0.5 text-[11px] text-slate-300">{detail}</div> : null}
      {fix ? (
        <div className="mt-2 border-t border-white/15 pt-1.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
            {fix.heading}
          </div>
          <div className="text-[11px] leading-4 text-slate-200">{fix.body}</div>
        </div>
      ) : null}
      {ladder.length > 1 ? (
        <div className="mt-2 border-t border-white/15 pt-1.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
            What caps it next
          </div>
          {ladder.map((rung) => (
            <div
              key={`${rung.label}|${rung.pct}`}
              className={[
                "flex items-baseline gap-2 text-[11px] leading-4",
                rung.now ? "font-semibold text-white" : "text-slate-300",
              ].join(" ")}
            >
              <span className="w-10 shrink-0 text-right tabular-nums">{formatPct(rung.pct)}%</span>
              <span className="min-w-0 flex-1">{rung.label}</span>
            </div>
          ))}
          {/* Only a bottleneck can be "cleared" — on an over-asked node the
              wall it stands on is its own machine count, and "clear that" would
              be advice to delete the machines. */}
          {next && ladder[0]?.now && verdict.kind === "starved" ? (
            <div className="mt-0.5 text-[10px] leading-[14px] text-slate-400">
              Clear that and this lands at {formatPct(next.pct)}%, held by {next.label}.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function verdictHoverTitle(verdict: NodeVerdict, isCustomRate: boolean): string {
  switch (verdict.kind) {
    case "starved":
      return `${verdict.binding?.displayName ?? "An input"} is the bottleneck`;
    case "choke":
      return isCustomRate ? "Asked for more than the dialed rate" : "Asked for more than it makes";
    case "demand-set":
      return verdict.pct <= 0.05 ? "Nothing draws from this yet" : "Downstream sets the speed";
    case "balanced":
      return isCustomRate ? "Dialed rate met exactly" : "Full speed, all asks met";
    case "unwired":
      return isCustomRate ? "No wires on this dial" : "Hand-fed";
    case "off":
      return "Disabled";
    case "no-recipe":
      return "No recipe";
  }
}

function verdictHoverDetail(verdict: NodeVerdict, isCustomRate: boolean): string | undefined {
  switch (verdict.kind) {
    case "starved": {
      const binding = verdict.binding;
      if (!binding) {
        return undefined;
      }
      const supplied = formatSlotRate(binding.suppliedPerSecond, binding.kind);
      const needed = formatSlotRate(binding.neededPerSecond, binding.kind);
      const tied = binding.tiedWithNames?.length
        ? ` Tied with ${binding.tiedWithNames.join(", ")} — raise either.`
        : "";
      return `Gets ${supplied}, wants ${needed} at full speed.${tied}`;
    }
    case "choke": {
      const deficit = verdict.deficit;
      if (!deficit) {
        return undefined;
      }
      const missing = formatSlotRate(deficit.missingPerSecond, deficit.kind);
      return deficit.pluggedOutputs > 1
        ? `${deficit.hungryOutputs} of ${deficit.pluggedOutputs} wired outputs go unfilled, ${missing} short on ${deficit.displayName}.`
        : `${missing} short on ${deficit.displayName}.`;
    }
    case "demand-set":
      return verdict.headroomPct && verdict.headroomPct > 0
        ? `Nothing downstream wants the other ${formatPct(verdict.headroomPct)}%.`
        : undefined;
    case "balanced":
      return isCustomRate ? undefined : "Fed, full, and everything it makes gets taken.";
    case "unwired":
      return isCustomRate
        ? "This dial does nothing until something is wired to it."
        : "The plan assumes you keep it stocked by hand.";
    default:
      return undefined;
  }
}

function verdictHoverFix(
  verdict: NodeVerdict,
  machineCount: number,
  isCustomRate: boolean,
): { heading: string; body: string } | undefined {
  if (verdict.kind === "starved") {
    const upstream = verdict.binding?.upstream;
    if (!upstream) {
      return { heading: "Where to act", body: "Upstream, on the short line." };
    }
    if (upstream.kind === "loop") {
      return { heading: "Where to act", body: "Fed by its own loop. Prime it from a buffer." };
    }
    if (upstream.kind === "buffer") {
      return { heading: "Where to act", body: `${upstream.name} is running dry. Feed it faster.` };
    }
    const state = upstream.atFullSpeed
      ? `${upstream.name} is already flat out.`
      : upstream.hasHeadroom
        ? `${upstream.name} runs at ${formatPct(upstream.pct)}% and could make more.`
        : `${upstream.name} runs at ${formatPct(upstream.pct)}% and is held back itself.`;
    const count = upstream.machinesToAdd
      ? ` Add +${upstream.machinesToAdd} machine${upstream.machinesToAdd > 1 ? "s" : ""} there${
          upstream.machineCount ? ` (${upstream.machineCount} today)` : ""
        }.`
      : upstream.hasHeadroom || upstream.atFullSpeed
        ? " Add machines there, or a higher tier."
        : " Follow the chain up.";
    return { heading: "Where to act", body: `${state}${count}` };
  }
  if (verdict.kind === "choke") {
    const deficit = verdict.deficit;
    if (isCustomRate) {
      return {
        heading: "Fix here",
        body: deficit
          ? `Raise the rate by ${formatSlotRate(deficit.missingPerSecond, deficit.kind)}.`
          : "Raise the rate.",
      };
    }
    if (!deficit?.machinesToAdd) {
      return { heading: "Fix here", body: "Add machines, or a higher tier." };
    }
    const covers =
      deficit.hungryOutputs > 1 ? ` covers all ${deficit.hungryOutputs}` : " covers it";
    return {
      heading: "Fix here",
      body: `+${deficit.machinesToAdd} machine${
        deficit.machinesToAdd > 1 ? "s" : ""
      }${covers} (${machineCount} today), or a higher tier.`,
    };
  }
  return undefined;
}

/**
 * A block that is always a whole number of grid cells tall, and always tall
 * enough for what is inside it.
 *
 * The rails and the head are deterministic — a port row is 40px because we say
 * so — but the footer and the config panels hold text and controls whose height
 * depends on the recipe, the machine and the browser's font metrics. Pinning
 * those to a fixed height is what made stats hang out of the bottom of the
 * card. So they measure instead, and round UP: never compress to fit the grid,
 * take another cell.
 *
 * The observer fires when the content's own height changes — a different
 * recipe, a wider number — not on drags, hovers or frames, so it costs nothing
 * in the cases the board's performance is judged on.
 */
function GridBlock({
  children,
  className,
  minCells = 2,
  style,
  align = "center",
  clearancePx = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Floor, in cells. Two is the standard block. */
  minCells?: number;
  style?: CSSProperties;
  /** Where content sits in the rounded-up block. The footer bottom-aligns. */
  align?: "center" | "end";
  /**
   * Extra height the measurement must reserve beyond the content itself —
   * the caller's own padding and border, which scrollHeight cannot see.
   * Without it a content height near a cell boundary would round to a block
   * the padding no longer fits in.
   */
  clearancePx?: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [cellCount, setCellCount] = useState(minCells);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const needed = Math.ceil((element.scrollHeight + clearancePx) / BOARD_GRID - 0.001);
      const next = Math.max(minCells, needed);
      setCellCount((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [clearancePx, minCells]);

  return (
    <div className={className} style={{ ...style, height: cellCount * BOARD_GRID }}>
      {/* The measured div must be free to size to its content, or its own
          scrollHeight would just report the height we gave it and the block
          could never shrink again. The aligning wrapper takes the fixed
          height; the child stays auto. */}
      <div
        className={
          align === "end" ? "flex h-full flex-col justify-end" : "flex h-full flex-col justify-center"
        }
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}

/** Input chip width, shared by the input rail and the output rail's chip. */
const PORT_CHIP_WIDTH_CLASS = "w-[140px]";

/**
 * One side of the port rails. Every port always renders - a hidden port is a
 * port somebody can't wire, so tall nodes are the accepted trade for big
 * recipes. Rows on both rails share one height so input, output, and plug
 * line up straight across the node.
 */
function PortRail({
  nodeId,
  side,
  ports,
  pending,
}: {
  nodeId: string;
  side: "input" | "output";
  ports: RailPort[];
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  if (ports.length === 0) {
    return null;
  }

  const isInput = side === "input";
  return (
    <div
      className={[
        // No gap between rows: the row IS the grid unit (40px = two cells),
        // and a gap would put every row after the first off the grid.
        "flex shrink-0 flex-col justify-start gap-0 py-0",
        // Half the old rails. The rate text under each name was the thing that
        // demanded 210px of chip; with it gone the name is the only wide thing
        // left, and a truncated name plus a hover beats a board you can't fit.
        // The output rail is chip (140) + 2px gap + the coupling (34, in
        // globals.css) — anything wider and the couplings hang off the card.
        isInput ? PORT_CHIP_WIDTH_CLASS : "w-[176px]",
      ].join(" ")}
    >
      {ports.map((port) =>
        isInput ? (
          <PortChip key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ) : (
          <OutputSocketRow key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ),
      )}
    </div>
  );
}

/**
 * An output row: the maker chip plus the coupling chip at the node's right
 * edge — inside the card, like inputs. The row is the edge anchor, so wires
 * reach the coupling the same way they reach an input chip.
 */
function OutputSocketRow({
  nodeId,
  port,
  pending,
}: {
  nodeId: string;
  port: RailPort;
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  return (
    <div
      className="relative flex items-stretch"
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={port.handleId}
      // Wiring is a mode: a held wire must not also be lighting up slots.
      onPointerEnter={() =>
        isWiringConnection() ? undefined : setHoveredFlowScope(buildPortFlowScope(nodeId, port))
      }
      onPointerLeave={() => setHoveredFlowScope(undefined)}
    >
      <PortChip nodeId={nodeId} port={port} pending={pending} plugRow />
      {port.plug ? (
        <PlugBlock nodeId={nodeId} port={port} />
      ) : (
        <MinecraftTooltip
          label={
            formatSlotRateOrNull(port.currentPerSecond, port.kind)
              ? `Empty socket — ${formatSlotRate(port.currentPerSecond, port.kind)} vanishes. Wire it to keep it.`
              : "Empty socket — nothing plugged in."
          }
        >
          <span className="flow-socket-empty nodrag">
            <PlugDragHandle nodeId={nodeId} port={port} />—
          </span>
        </MinecraftTooltip>
      )}
    </div>
  );
}

/**
 * A second source handle over the coupling chip, sharing the port's handle
 * id — a connection dropped on either reads the same port. Geometry is
 * unaffected: edges anchor off the row's `data-resource-edge-anchor`, not
 * React Flow's handle bounds.
 */
function PlugDragHandle({ nodeId, port }: { nodeId: string; port: RailPort }) {
  return (
    <Handle
      id={port.handleId}
      type="source"
      position={Position.Right}
      data-resource-handle="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={port.handleId}
      title={`Drag to wire ${port.displayName}`}
      className={[
        "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-10 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
        "!rounded-none !border-0 !bg-transparent !opacity-0 cursor-crosshair",
      ].join(" ")}
    />
  );
}

/** Where a dead-end output actually ends. Trash destroys; the rest keeps. */
const PLUG_DUMP_WORD: Record<"trash" | "tank" | "store", string> = {
  trash: "TRASH",
  tank: "TANK",
  store: "STORE",
};

const PLUG_GLOW_STYLE: CSSProperties = {
  boxShadow: "0 0 0 2px #fde047, 0 0 0 5px #22d3ee, 0 0 14px 3px rgba(34,211,238,0.95)",
  filter: "brightness(1.22)",
  zIndex: 15,
};

/**
 * The coupling chip: how covered the askers are, as one percent over one
 * bar, colored by the coupling's state. Everything else — who asks, the
 * gets/asks rates, the ×N short multiplier, the fix — lives in the hover.
 */
function PlugBlock({ nodeId, port }: { nodeId: string; port: RailPort }) {
  const plug = port.plug!;
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.ports[`${nodeId}|${port.handleId}`]),
  );
  const coveredPct = Math.round(Math.min(Math.max(plug.coveredFraction, 0), 1) * 100);
  return (
    <MinecraftTooltip
      label={`${port.displayName} — the asker's side`}
      content={renderPlugHoverContent(port, nodeId)}
    >
      <span
        className={["flow-plug nodrag", `flow-plug--${plug.state}`].join(" ")}
        style={isFlowScopeLit ? PLUG_GLOW_STYLE : undefined}
      >
        {/* The coupling looks like the end of the wire, so it has to BE one:
            dragging from here pulls a new line. It sits inside the tooltip
            wrapper, so hovering the handle still opens the asker's story. */}
        <PlugDragHandle nodeId={nodeId} port={port} />
        {plug.state === "dump" ? (
          // No ask exists to be a percent of — flow just ends here. Name the
          // end it reaches: "DUMP" read as destruction even when the flow was
          // going somewhere perfectly safe.
          <span className="flow-plug-top">
            <b>{PLUG_DUMP_WORD[plug.dumpKind ?? "store"]}</b>
          </span>
        ) : (
          <>
            <span className="flow-plug-top">
              <b>{coveredPct}%</b>
            </span>
            <span className="flow-plug-bar">
              <span className="flow-plug-track">
                <i style={{ width: `${coveredPct}%` }} />
              </span>
            </span>
          </>
        )}
      </span>
    </MinecraftTooltip>
  );
}

/**
 * A rail port: the wire, the live rate, and the health bar share one surface.
 * The chip doubles as the React Flow handle (drag to wire) and as the edge
 * anchor element the router measures.
 */
/**
 * The flow neighbourhood a port hover lights up: every line on this port,
 * the far-end port of each line, and the nodes involved (so storages can
 * glow too). Built lazily on pointer-enter from live store state.
 */
function buildPortFlowScope(nodeId: string, port: RailPort) {
  const { project } = useFactoryStore.getState();
  const edges: Record<string, true> = {};
  const ports: Record<string, true> = { [`${nodeId}|${port.handleId}`]: true };
  const nodes: Record<string, true> = { [nodeId]: true };
  const isInput = port.side === "input";
  for (const edge of project.edges) {
    if ((isInput ? edge.target : edge.source) !== nodeId) {
      continue;
    }
    if (!edgeTouchesResource(edge, port.side, port.kind, port.resourceId)) {
      continue;
    }
    edges[edge.id] = true;
    const otherId = isInput ? edge.source : edge.target;
    nodes[otherId] = true;
    const rawOtherHandle = isInput ? edge.sourceHandle : edge.targetHandle;
    const otherHandle =
      canonicalizeResourceHandleId(rawOtherHandle) ??
      makeResourceHandleId(isInput ? "output" : "input", {
        kind: edge.resourceKind,
        id: edge.resourceId,
      });
    ports[`${otherId}|${otherHandle}`] = true;
  }
  return { edges, ports, nodes };
}

function PortChip({
  nodeId,
  port,
  pending,
  plugRow = false,
}: {
  nodeId: string;
  port: RailPort;
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
  /** Inside an OutputSocketRow: the row owns the edge anchor and hover scope. */
  plugRow?: boolean;
}) {
  const isInput = port.side === "input";
  const { calmMode } = useBoardView();
  const browseResource = useFactoryStore((state) => state.browseResource);
  const setHoveredFlowScope = useFactoryStore((state) => state.setHoveredFlowScope);
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.ports[`${nodeId}|${port.handleId}`]),
  );
  const slotState = getConnectionSlotState(
    pending,
    nodeId,
    port.side,
    port.kind,
    port.resourceId,
    port.resource?.alternatives,
    port.handleId,
  );
  const browse = (mode: "recipes" | "uses") =>
    browseResource(
      {
        kind: port.kind,
        id: port.resourceId,
        displayName: port.resource?.displayName ?? port.displayName,
        iconPath: port.resource?.iconPath,
        iconAtlas: port.resource?.iconAtlas,
        dominantColor: port.resource?.dominantColor ?? port.resource?.iconAtlas?.dominantColor,
        anchorNodeId: nodeId,
      },
      mode,
    );
  const toneClass =
    port.tone === "bind"
      ? "flow-port--bind"
      : port.tone === "hot"
        ? "flow-port--hot"
        : port.tone === "calm"
          ? "flow-port--calm"
          : port.tone === "slowed"
            ? "flow-port--slowed"
            : port.tone === "idle"
              ? "flow-port--idle"
              : "";
  // The rate reads under the name in a lighter grey — the number is worth a
  // line, it just isn't worth competing with the name for attention. The
  // binding input still shows both halves (what it gets over what it asks);
  // every other port shows the one number that matters. Calm mode always
  // shows the bare actual rate: no fraction, nothing to diagnose.
  const rateText =
    port.showNameplate && !calmMode
      ? `${formatSlotRateBare(port.currentPerSecond)} / ${formatSlotRate(
          port.nameplatePerSecond,
          port.kind,
        )}`
      : formatSlotRate(port.currentPerSecond, port.kind);

  // One bar, one ruler: 100% = full blast. Solid = now, hatch = would unlock
  // if fed. The caret/burst (the want) is an INPUT-side signal — on outputs
  // that story belongs to the asker and lives on the plug block instead.
  const nameplate = port.nameplatePerSecond;
  const fillPct = nameplate > 1e-9 ? Math.min(port.currentPerSecond / nameplate, 1) * 100 : 0;
  const couldPct = nameplate > 1e-9 ? Math.min(port.couldPerSecond / nameplate, 1) * 100 : 0;
  const ghostPct = Math.max(0, couldPct - fillPct);
  const wantRatio = nameplate > 1e-9 ? port.wantedPerSecond / nameplate : 0;
  const caretPct =
    isInput && port.wantedPerSecond > 1e-9 ? Math.min(Math.max(wantRatio, 0), 1) * 100 : undefined;
  const hasBurst = isInput && wantRatio > 1.005;

  return (
    <div
      className={[
        // 40px — two grid cells, fixed. The row is the board's vertical unit:
        // rails have no gaps and the head above them is a whole number of
        // 40s, so every port centre lands exactly on a grid line. Name, rate
        // and bar total 32px and centre inside it.
        "flow-port relative flex h-[40px] items-center gap-1 px-0.5 py-0",
        // flex-none both ways. An input chip used to be `flex-1`, and in a
        // column flex container that resolves the row's main size from its
        // content — quietly beating the 40px height and leaving the rail 4px
        // short per row, which is exactly how ports drift off the grid.
        plugRow ? `${PORT_CHIP_WIDTH_CLASS} flex-none` : "w-full flex-none",
        toneClass,
        isFlowScopeLit ? "flow-port--flow-lit" : "",
      ].join(" ")}
      // Inline so the highlight can never be lost to a stale stylesheet
      // chunk: this is the "you are looking at this port's flow" signal.
      style={
        isFlowScopeLit
          ? {
              boxShadow:
                "0 0 0 2px #fde047, 0 0 0 5px #22d3ee, 0 0 14px 3px rgba(34,211,238,0.95)",
              filter: "brightness(1.22)",
              zIndex: 15,
            }
          : undefined
      }
      // Inside a socket row the ROW is the anchor (wires dock at the plug's
      // right edge) and owns the hover scope; a second anchor here would win
      // the DOM lookup and pull edges back to the chip.
      {...(plugRow
        ? {}
        : {
            "data-resource-edge-anchor": "true",
            "data-resource-node-id": nodeId,
            "data-resource-handle-id": port.handleId,
            onPointerEnter: () =>
              isWiringConnection() ? undefined : setHoveredFlowScope(buildPortFlowScope(nodeId, port)),
            onPointerLeave: () => setHoveredFlowScope(undefined),
          })}
    >
      {slotState !== "idle" ? (
        <span
          className={[
            "pointer-events-none absolute inset-0 z-20",
            slotState === "selected" ? "ring-2 ring-amber-300" : "",
            slotState === "compatible" ? "ring-2 ring-cyan-300" : "",
          ].join(" ")}
        />
      ) : null}
      <span
        role="button"
        tabIndex={-1}
        className="nodrag relative z-40 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden cursor-pointer hover:brightness-125"
        title={`${port.displayName} — click: recipes, right-click: uses`}
        onClick={(event) => {
          event.stopPropagation();
          browse("recipes");
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          browse("uses");
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {port.resource ? (
          <ResourceIcon
            resource={{ ...port.resource, amount: 1, chance: undefined }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            // Item art ships with transparent padding baked into the sprite,
            // and that padding is a FRACTION of the cell — growing the box
            // grows the empty border with it. ResourceIcon's default already
            // zooms to 200%-8px inside an overflow-hidden box; items take
            // another 1.5x on top and get clipped by the box above, which is
            // what finally puts the art edge to edge. Fluids are a solid
            // square with nothing to crop, so they keep their exact size.
            iconPixelSize={port.kind === "fluid" ? 50 : undefined}
            className={port.kind === "fluid" ? "" : "!h-7 !w-7 origin-center scale-150"}
          />
        ) : (
          <span className="block h-7 w-7 border border-[var(--mc-47)] bg-[var(--mc-55)]" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center pr-0.5">
        {/* The name is what you look for on a rail of five ports; the rate is
            what you compare once you have found it. Name in full ink, rate a
            step down and a step lighter, so the pair reads in that order. */}
        <span className="block truncate text-[11px] font-bold leading-[13px] text-[var(--mc-ink)]">
          {port.displayName}
        </span>
        {calmMode ? (
          /* Presentation: no bar, no want marks — the room they used goes to
             the number, which is the thing a viewer actually reads. 14px is
             the ceiling: a five-digit fluid rate still fits the chip. */
          <span className="block truncate text-[14px] font-bold leading-[16px] tabular-nums text-[var(--mc-ink)]">
            {rateText}
          </span>
        ) : (
          <>
            {/* Neutral, quieter ink: the chip's BAR carries the machine
                story's color. Green text over a red bar told two stories at
                once. */}
            <span className="block truncate text-[10px] leading-[12px] tabular-nums text-[var(--mc-ink-muted)] opacity-80">
              {rateText}
            </span>
            {port.handFed ? (
              <span className="block text-[7px] font-black leading-3 tracking-[0.5px] text-[var(--mc-ink-muted)]">
                HAND-FED
              </span>
            ) : (
              <span className="mt-0.5 flex items-center gap-0.5">
                <span
                  className={["flow-port-bar block flex-1", hasBurst ? "flow-port-bar--burst" : ""]
                    .join(" ")
                    .trim()}
                >
                  <i style={{ width: `${fillPct}%` }} />
                  {ghostPct > 1 ? (
                    <s
                      className="flow-port-ghost"
                      style={{ left: `${fillPct}%`, width: `${ghostPct}%` }}
                    />
                  ) : null}
                  {caretPct !== undefined ? (
                    <u className="flow-port-caret" style={{ left: `${caretPct}%` }} />
                  ) : null}
                </span>
                {hasBurst ? (
                  <em className="flow-port-burst not-italic">{formatTimes(wantRatio)}</em>
                ) : null}
              </span>
            )}
          </>
        )}
      </span>
      <MinecraftTooltip
        label={port.resource?.tooltip ?? port.displayName}
        content={renderPortHoverContent(port, nodeId)}
      >
        <Handle
          id={port.handleId}
          type={isInput ? "target" : "source"}
          position={isInput ? Position.Left : Position.Right}
          data-resource-handle="true"
          data-resource-node-id={nodeId}
          data-resource-handle-id={port.handleId}
          title={`${isInput ? "Input" : "Output"}: ${port.displayName}`}
          className={[
            "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
            "!rounded-none !border-0 !bg-transparent !opacity-0",
            "cursor-crosshair",
          ].join(" ")}
        />
      </MinecraftTooltip>
    </div>
  );
}

// The custom rate placeholder's two wire-here ports. Both are universal: the
// connect handlers in FactoryFlow spot the `custom-any` resource id and adopt
// whatever resource the far end carries (the machine side decides direction).
function CustomRateUniversalPorts({ nodeId }: { nodeId: string }) {
  return (
    // Six cells: one row of ports over the explanation.
    <div className="flex h-[120px] flex-col gap-0">
      <div className="flex h-[40px] items-center justify-between gap-3">
        <UniversalPortChip nodeId={nodeId} side="input" label="Drain any" />
        <UniversalPortChip nodeId={nodeId} side="output" label="Supply any" />
      </div>
      <p className="mx-auto flex max-w-[300px] flex-1 items-center text-center text-[11px] leading-tight text-[var(--mc-ink-muted)]">
        Wire either port to any machine — this node adopts that resource. Right side
        supplies it at a dialed rate, left side constantly drains it.
      </p>
    </div>
  );
}

function UniversalPortChip({
  nodeId,
  side,
  label,
}: {
  nodeId: string;
  side: "input" | "output";
  label: string;
}) {
  const isInput = side === "input";
  const handleId = makeResourceHandleId(side, { kind: "item", id: CUSTOM_RATE_ANY_RESOURCE_ID });
  return (
    <div
      className="relative flex h-[40px] w-[160px] items-center justify-center border-2 border-dashed border-[var(--mc-33)] bg-[var(--mc-71)] text-[11px] font-bold uppercase tracking-wide text-[var(--mc-ink-muted)]"
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={handleId}
    >
      {label}
      <Handle
        id={handleId}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        data-resource-handle="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={handleId}
        title={
          isInput
            ? "Request side: wire a machine output (or tank) here"
            : "Supply side: wire a machine input (or tank) here"
        }
        className={[
          "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
          "!rounded-none !border-0 !bg-transparent !opacity-0",
          "cursor-crosshair",
        ].join(" ")}
      />
    </div>
  );
}

// Rate dial + Supply/Request flip for an adopted custom rate node. The store
// keeps the rate per second; the input shows it in the active board unit.
function CustomRatePanel({
  nodeId,
  mode,
  kind,
  perSecond,
}: {
  nodeId: string;
  mode: CustomRateMode;
  kind: ResourceAmount["kind"];
  perSecond: number;
}) {
  const setCustomRateConfig = useFactoryStore((state) => state.setCustomRateConfig);
  // Subscribe so the shown value re-derives when the board unit flips.
  useFactoryStore((state) => state.rateUnit);
  const multiplier = rateUnitMultiplier();
  const shownRate = String(Math.round(perSecond * multiplier * 1000) / 1000);
  const [draftState, setDraftState] = useState({ shownRate, draft: shownRate });
  const draft = draftState.shownRate === shownRate ? draftState.draft : shownRate;

  const commitDraft = (value: string) => {
    const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      setCustomRateConfig(nodeId, { perSecond: parsed / multiplier });
    }
  };
  const flipMode = (nextMode: CustomRateMode) => {
    if (nextMode !== mode) {
      setCustomRateConfig(nodeId, { mode: nextMode });
    }
  };
  const modeButtonClassName = (active: boolean) =>
    [
      "nodrag h-6 px-2 text-[11px] font-bold uppercase",
      active
        ? "bg-[var(--mc-49)] text-white shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-85)]"
        : "bg-[var(--mc-82)] text-[var(--mc-ink-muted)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-100)]",
    ].join(" ");

  return (
    // Two cells tall, or more if the dial needs them.
    <GridBlock className="nodrag border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
    <div className="flex items-center gap-1">
      <div className="flex border-2 border-[var(--mc-33)]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            flipMode("supply");
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={modeButtonClassName(mode === "supply")}
          title="Supply: makes the resource at this rate. Flipping reverses the node and drops its wires."
        >
          Supply
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            flipMode("request");
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={modeButtonClassName(mode === "request")}
          title="Request: constantly drains the resource at this rate. Flipping reverses the node and drops its wires."
        >
          Request
        </button>
      </div>
      <input
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraftState({ shownRate, draft: nextDraft });
          commitDraft(nextDraft);
        }}
        onBlur={() => {
          const parsed = Number.parseFloat(draft.replace(/,/g, "").trim());
          if (!Number.isFinite(parsed) || parsed < 0) {
            setDraftState({ shownRate, draft: shownRate });
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        inputMode="decimal"
        aria-label="Rate"
        title="Rate in the board's active unit"
        // Sized to the number, not to the row: `flex-1` made the field claim
        // every spare pixel and the card was permanently as wide as its
        // widest possible contents. In `ch` on a mono font this is exactly
        // the typed digits, so a "5" node is small and a "1000000000" node
        // grows only when it has to.
        style={{ width: `${Math.min(Math.max(draft.length + 2, 5), 16)}ch` }}
        className="nodrag h-6 shrink-0 border border-[var(--mc-33)] bg-[var(--mc-93)] px-1 text-right text-[13px] text-[var(--mc-ink)]"
      />
      <span className="shrink-0 pr-1 text-[11px] font-bold text-[var(--mc-ink-muted)]">
        {rateUnitSuffix(kind === "fluid").trim() || "/s"}
      </span>
    </div>
    </GridBlock>
  );
}

const STORY_TONE_TEXT: Record<PortStory["tone"], string> = {
  red: "text-red-300",
  amber: "text-amber-300",
  green: "text-emerald-300",
  steel: "text-slate-300",
  dim: "text-slate-400",
};

const STORY_TONE_FILL: Record<PortStory["tone"], string> = {
  red: "#e05252",
  amber: "#e0a63a",
  green: "#3fbf6f",
  steel: "#8aa0b8",
  dim: "#5a6a80",
};

const STORY_ACTION_TEXT: Record<"fix" | "fine" | "note", string> = {
  fix: "text-amber-300",
  fine: "text-emerald-300",
  note: "text-slate-300",
};

/**
 * The port hover panel — the big explainer: a thicker copy of the port's bar
 * with the same landmarks, the honest numbers, the per-line list, then the
 * plain answer to "why is it like this" and what to do. All copy comes from
 * explainPort; styles ride inline so no stale stylesheet chunk can mute the
 * teaching surface.
 */
function renderPortHoverContent(port: RailPort, nodeId: string) {
  if (port.nameplatePerSecond <= 1e-9 && port.currentPerSecond <= 1e-9) {
    return undefined;
  }

  const { project, lastResult } = useFactoryStore.getState();
  const verdict = deriveNodeVerdict(project, lastResult, nodeId);
  const story = explainPort(project, lastResult, nodeId, port, verdict);

  const nameplate = port.nameplatePerSecond;
  const fillPct = nameplate > 1e-9 ? Math.min(port.currentPerSecond / nameplate, 1) * 100 : 0;
  const couldPct = nameplate > 1e-9 ? Math.min(port.couldPerSecond / nameplate, 1) * 100 : 0;
  const ghostPct = Math.max(0, couldPct - fillPct);
  const wantRatio = nameplate > 1e-9 ? port.wantedPerSecond / nameplate : 0;
  const caretPct =
    port.wantedPerSecond > 1e-9 ? Math.min(Math.max(wantRatio, 0), 1) * 100 : undefined;
  const hasBurst = wantRatio > 1.005;
  const fillColor = STORY_TONE_FILL[story.tone];

  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-white">
          {port.displayName}
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {port.side === "input" ? "Input" : "Output"}
        </span>
        <span
          className={[
            "ml-auto shrink-0 text-[10px] font-black tracking-wide",
            STORY_TONE_TEXT[story.tone],
          ].join(" ")}
        >
          {story.stateWord}
        </span>
      </div>

      {!port.handFed ? (
        <div className={["mt-2 flex items-center gap-1", caretPct !== undefined ? "mb-2" : "mb-1"].join(" ")}>
          <div
            className="relative h-[9px] flex-1"
            style={{
              background: "#101826",
              border: "1px solid #2c3a52",
              borderRightWidth: hasBurst ? 2 : 1,
              borderRightColor: hasBurst ? "rgba(255,255,255,0.9)" : "#2c3a52",
            }}
          >
            <i
              className="absolute bottom-0 left-0 top-0 block"
              style={{ width: `${fillPct}%`, background: fillColor }}
            />
            {ghostPct > 1 ? (
              <s
                className="absolute bottom-0 top-0 block"
                style={{
                  left: `${fillPct}%`,
                  width: `${ghostPct}%`,
                  background:
                    "repeating-linear-gradient(45deg, rgba(220,228,245,0.35) 0 1.5px, transparent 1.5px 3px)",
                }}
              />
            ) : null}
            {caretPct !== undefined ? (
              <u
                className="absolute block"
                style={{
                  left: `${caretPct}%`,
                  top: "100%",
                  marginTop: 1,
                  width: 0,
                  height: 0,
                  borderLeft: "4px solid transparent",
                  borderRight: "4px solid transparent",
                  borderBottom: "5px solid #f5c542",
                  transform: "translateX(-4px)",
                }}
              />
            ) : null}
          </div>
          {hasBurst ? (
            <em className="shrink-0 border border-dashed border-amber-400/70 bg-amber-400/20 px-1 text-[9px] font-black not-italic leading-[13px] text-amber-300">
              {formatTimes(wantRatio)}
            </em>
          ) : null}
        </div>
      ) : null}

      <StoryBody story={story} />
    </div>
  );
}

/** The shared teaching body: honest rows, per-line list, plain answer, fix. */
function StoryBody({ story }: { story: PortStory }) {
  return (
    <>
      {story.rows.length > 0 ? (
        <div className="mt-1">
          {story.rows.map((row) => (
            <div key={row.k} className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="text-slate-400">{row.k}</span>
              <span className="font-semibold tabular-nums text-slate-200">{row.v}</span>
            </div>
          ))}
        </div>
      ) : null}

      {story.lineRows ? (
        <div className="mt-2 border-t border-white/15 pt-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {story.lineRows.title}
          </div>
          {story.lineRows.rows.map((row, index) => (
            <div
              key={index}
              className="mt-0.5 flex items-baseline justify-between gap-2 text-[12px]"
            >
              {/* Name and note truncate separately so "runs at 45%" never
                  disappears behind a long machine name. */}
              <span className="min-w-0 flex-1 truncate text-slate-300">{row.name}</span>
              {row.note ? (
                <span className="shrink-0 text-[11px] text-slate-500">{row.note}</span>
              ) : null}
              <span className="shrink-0 tabular-nums text-slate-200">{row.rate}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 border-t border-white/15 pt-1.5 text-[12px] leading-snug text-slate-200">
        {story.lines.map((line, index) => (
          <p key={index} className="mb-1 last:mb-0">
            {line}
          </p>
        ))}
        {story.action ? (
          <p className={["mt-1 font-semibold", STORY_ACTION_TEXT[story.action.tone]].join(" ")}>
            {story.action.text}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The plug hover — the asker's story at full length: who is plugged in, what
 * they ask, what they get, and the fix. The covered bar rides the asker's
 * own frame: full = the ask is covered.
 */
function renderPlugHoverContent(port: RailPort, nodeId: string) {
  const { project, lastResult } = useFactoryStore.getState();
  const story = explainPlug(project, lastResult, nodeId, port);
  if (!story) {
    return undefined;
  }
  const plug = port.plug!;

  return (
    <div className="w-64">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-white">
          {port.displayName}
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Plug
        </span>
        <span
          className={[
            "ml-auto shrink-0 text-[10px] font-black tracking-wide",
            STORY_TONE_TEXT[story.tone],
          ].join(" ")}
        >
          {story.stateWord}
          {plug.timesShort !== undefined ? ` ${formatTimes(plug.timesShort)}` : ""}
        </span>
      </div>

      <StoryBody story={story} />
    </div>
  );
}

function recipeContainsSearchResource(recipe: Recipe, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (normalizedQuery.length < 2) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some((resource) =>
    normalizeSearch(`${resourceLabel(resource)} ${resource.id}`).includes(normalizedQuery),
  );
}

function recipeContainsResourceKey(recipe: Recipe, resourceKey: string | undefined) {
  if (!resourceKey) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

type VoltageTier = Exclude<MachineTier, "DEMO">;

function getNodeTierControl(recipe: Recipe, node: FactoryNode) {
  if (isIndustrialApiaryMachineType(recipe.machineType)) {
    return undefined;
  }

  const hasVoltageTier = GT_OVERCLOCK_TIERS.some((entry) => entry.tier === recipe.minimumTier);
  if (
    recipe.durationTicks <= 0 ||
    (recipe.eut === 0 && !hasVoltageTier && !isTierDrivenOutputRecipe(recipe))
  ) {
    return undefined;
  }

  const minimum = getOverclockedRecipeStats(recipe, node).minimumTier;
  const current = clampTier(resolveVoltageTier(node.overclockTier, minimum), minimum);
  return { minimum, current };
}

function isTierDrivenOutputRecipe(recipe: Recipe) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeSearch(recipeMap) === "tree growth simulator";
}

function getAdjacentTier(current: VoltageTier, minimum: VoltageTier, direction: -1 | 1) {
  const currentIndex = getVoltageTierIndex(current);
  const minimumIndex = getVoltageTierIndex(minimum);
  const nextIndex = Math.min(
    GT_OVERCLOCK_TIERS.length - 1,
    Math.max(minimumIndex, currentIndex + direction),
  );
  return GT_OVERCLOCK_TIERS[nextIndex]?.tier ?? current;
}

function clampTier(tier: VoltageTier, minimum: VoltageTier) {
  return getVoltageTierIndex(tier) < getVoltageTierIndex(minimum) ? minimum : tier;
}

function resolveVoltageTier(value: string, defaultTier: VoltageTier): VoltageTier {
  const tier = GT_OVERCLOCK_TIERS.find((entry) => entry.tier === value)?.tier;
  if (tier) {
    return tier;
  }

  if (value === "MAX") {
    return getHighestFiniteVoltageTier();
  }

  return tier ?? defaultTier;
}

function resolveDatasetMachineConfigResource(
  configuredResource: ResourceAmount,
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"],
): ResourceAmount {
  const normalizedLabel = normalizeSearch(configuredResource.displayName ?? configuredResource.id);
  const indexed = [...(dataset?.resources ?? []), ...(dataset?.resourceIndex ?? [])].find(
    (resource) =>
      resource.kind === configuredResource.kind &&
      (resource.id === configuredResource.id ||
        normalizeSearch(resource.displayName ?? resource.id) === normalizedLabel),
  );

  if (!indexed) {
    return configuredResource;
  }

  return {
    ...configuredResource,
    id: indexed.id,
    displayName: indexed.displayName ?? configuredResource.displayName,
    iconPath: indexed.iconPath ?? configuredResource.iconPath,
    iconAtlas: indexed.iconAtlas ?? configuredResource.iconAtlas,
    dominantColor: indexed.dominantColor ?? configuredResource.dominantColor,
  };
}

function isTreeGrowthSimulatorToolControl(control: MachineConfigTierControl) {
  return (
    /^tgsToolSlot\d+$/.test(control.id) ||
    (control.id.startsWith("tgs") && control.id.endsWith("Tool"))
  );
}

function isDisplayOnlyParallelControl(control: MachineConfigTierControl) {
  return /^machineParallel/.test(control.id) && control.tiers.length <= 1;
}

const TREE_GROWTH_SIMULATOR_TOOL_SLOTS: Record<string, { x: number; y: number }> = {
  tgsToolSlot1: { x: 36, y: 36 },
  tgsToolSlot2: { x: 54, y: 36 },
  tgsToolSlot3: { x: 36, y: 54 },
  tgsToolSlot4: { x: 54, y: 54 },
  tgsLogTool: { x: 36, y: 36 },
  tgsSaplingTool: { x: 54, y: 36 },
  tgsLeavesTool: { x: 36, y: 54 },
  tgsFruitTool: { x: 54, y: 54 },
};

const BEE_FRAME_SLOTS: Record<string, { x: number; y: number }> = {
  beeFrameSlot1: { x: 66, y: 23 },
  beeFrameSlot2: { x: 66, y: 52 },
  beeFrameSlot3: { x: 66, y: 81 },
};

function getBeePanelControls(controls: MachineConfigTierControl[]): MachineConfigTierControl[] {
  const speedControl = controls.find((control) => control.id === BEE_INDUSTRIAL_SPEED_CONTROL_ID);
  if (speedControl?.current.key !== "speed-8-upgraded") {
    return controls;
  }

  return controls.map((control) => {
    if (control.id !== BEE_INDUSTRIAL_PRODUCTION_CONTROL_ID) {
      return control;
    }

    const production8 = control.tiers.find((tier) => tier.key === "8");
    if (!production8) {
      return control;
    }

    return {
      ...control,
      current: production8,
      resource: production8.resource,
      tiers: [production8],
    };
  });
}

function applyTreeGrowthSimulatorToolInputs(
  recipe: Recipe,
  controls: MachineConfigTierControl[],
): Recipe {
  if (controls.length === 0) {
    return recipe;
  }

  const inputs = recipe.inputs.map((input) => {
    const matchingControl = controls.find((control) => {
      const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
      return position?.x === input.neiSlot?.x && position.y === input.neiSlot?.y;
    });

    if (!matchingControl) {
      return input;
    }
    const resource = getTreeGrowthSimulatorSlotResource(matchingControl);

    return {
      ...input,
      ...resource,
      amount: 1,
      optional: true,
      consumed: false,
      neiSlot: input.neiSlot,
    };
  });

  return { ...recipe, inputs };
}

function stripBeeFrameSlotInputs(recipe: Recipe): Recipe {
  const inputs = recipe.inputs.filter((input) => !isBeeFrameSlotInput(input));
  const neiSlots = recipe.nei?.slots?.filter((slot) => !isBeeFrameSlotPosition(slot));
  const recipeChanged = inputs.length !== recipe.inputs.length;
  const neiChanged = neiSlots?.length !== recipe.nei?.slots?.length;

  if (!recipeChanged && !neiChanged) {
    return recipe;
  }

  return {
    ...recipe,
    inputs,
    nei: recipe.nei
      ? {
          ...recipe.nei,
          slots: neiSlots,
        }
      : recipe.nei,
  };
}

function isBeeFrameSlotInput(input: Recipe["inputs"][number]) {
  return /^factoryflow:bee_frame_slot_\d+$/.test(input.id);
}

function isBeeFrameSlotPosition(slot: NonNullable<NonNullable<Recipe["nei"]>["slots"]>[number]) {
  return Object.values(BEE_FRAME_SLOTS).some(
    (position) => position.x === slot.x && position.y === slot.y,
  );
}

function isTreeGrowthSimulatorEmptyTool(control: MachineConfigTierControl) {
  return (
    control.current.key === "none" ||
    getTreeGrowthSimulatorToolCategory(control.current.key) !==
      getTreeGrowthSimulatorSlotCategory(control.id)
  );
}

function getTreeGrowthSimulatorSlotResource(control: MachineConfigTierControl) {
  if (!isTreeGrowthSimulatorEmptyTool(control)) {
    return control.resource;
  }

  return control.tiers.find((tier) => tier.key === "none")?.resource ?? control.resource;
}

function getTreeGrowthSimulatorToolCategory(key: string): string | undefined {
  const [category] = key.split(":");
  return category && category !== "none" ? category : undefined;
}

function getTreeGrowthSimulatorSlotCategory(controlId: string): string | undefined {
  switch (controlId) {
    case "tgsToolSlot1":
    case "tgsLogTool":
      return "log";
    case "tgsToolSlot2":
    case "tgsSaplingTool":
      return "sapling";
    case "tgsToolSlot3":
    case "tgsLeavesTool":
      return "leaves";
    case "tgsToolSlot4":
    case "tgsFruitTool":
      return "fruit";
    default:
      return undefined;
  }
}

function getTreeGrowthSimulatorSlotTiers(control: MachineConfigTierControl) {
  const category = getTreeGrowthSimulatorSlotCategory(control.id);
  if (!category) {
    return control.tiers;
  }

  return control.tiers.filter(
    (tier) => tier.key === "none" || getTreeGrowthSimulatorToolCategory(tier.key) === category,
  );
}

/**
 * The block a config option means. `sizeClass` must be a literal Tailwind
 * pair — the class list is scanned at build time, so a computed size string
 * would silently produce no CSS at all.
 */
function ConfigTierIcon({
  resource,
  sizeClass,
}: {
  resource: ResourceAmount;
  sizeClass: string;
}) {
  if (!resource.iconPath && !resource.iconAtlas) {
    return (
      <span className="flex items-center justify-center whitespace-nowrap px-1 text-center text-[11px] font-black leading-none text-white [text-shadow:1px_1px_0_#000]">
        {shortConfigLabel(resource)}
      </span>
    );
  }
  return (
    <ResourceIcon
      resource={{ ...resource, amount: 1, chance: undefined }}
      bare
      tooltip={false}
      showAmount={false}
      showConsumedState={false}
      // No pixel size: ResourceIcon's zoom-and-clip crops the sprite's own
      // transparent padding, so the block fills its square instead of
      // floating in the middle of one.
      className={`shrink-0 ${sizeClass}`}
    />
  );
}

/**
 * What picking this option would change, against the one selected now. The
 * card's rates come from the solver, so they cannot move on hover without a
 * solve per mouse move; this says the same thing honestly and instantly.
 */
function configTierHint(
  option: MachineConfigTierOption,
  current: MachineConfigTierOption,
): string | undefined {
  const parts: string[] = [];
  const ratio = (next: number | undefined, now: number | undefined) => {
    const a = next ?? 1;
    const b = now ?? 1;
    return b === 0 ? undefined : a / b;
  };
  // A smaller duration multiplier is a faster machine, so speed inverts.
  const speed = ratio(current.durationMultiplier, option.durationMultiplier);
  if (speed !== undefined && Math.abs(speed - 1) > 0.005) {
    parts.push(`${formatTimes(speed)} speed`);
  }
  const parallel = ratio(option.parallelMultiplier, current.parallelMultiplier);
  if (parallel !== undefined && Math.abs(parallel - 1) > 0.005) {
    parts.push(`${formatTimes(parallel)} parallel`);
  }
  const output = ratio(option.outputMultiplier, current.outputMultiplier);
  if (output !== undefined && Math.abs(output - 1) > 0.005) {
    parts.push(`${formatTimes(output)} output`);
  }
  const eut = ratio(option.eutMultiplier, current.eutMultiplier);
  if (eut !== undefined && Math.abs(eut - 1) > 0.005) {
    parts.push(`${formatTimes(eut)} EU/t`);
  }
  return parts.slice(0, 2).join(" · ") || undefined;
}

function MachineConfigControlPanel({
  controls,
  onSelect,
  onPreview,
}: {
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hovering an option shows the node as if it were picked. */
  onPreview?: (controlId: string, tierKey: string | undefined) => void;
}) {
  if (controls.length === 0) {
    return null;
  }

  // Two controls per row (2 × 168 + 4 gap = the card's 340px inner width),
  // three cells per row — and GridBlock adds a cell if a label wraps rather
  // than letting the controls spill out of the panel.
  const rows = Math.ceil(controls.length / 2);
  return (
    <GridBlock
      className="nodrag border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]"
      minCells={(rows * CONFIG_PANEL_ROW_HEIGHT) / BOARD_GRID}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] items-center gap-x-1 gap-y-1">
        {controls.map((control) => (
          <label key={control.id} className="min-w-0">
            <span className="mb-0.5 block text-[12px] font-bold uppercase leading-[14px] text-[var(--mc-ink-muted)]">
              {control.label}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              {/* A square the block fills, not a wide box with a small block
                  adrift in it. */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border border-[var(--mc-33)] bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)]">
                <ConfigTierIcon
                  resource={control.current.resource ?? control.resource}
                  sizeClass="!h-[26px] !w-[26px]"
                />
              </span>
              <MinecraftSelect
                value={control.current.key}
                // Every option carries its own block, so the list is a row of
                // casings rather than a list of names to translate.
                options={control.tiers.map((tier) => ({
                  key: tier.key,
                  label: tier.label,
                  hint: configTierHint(tier, control.current),
                  icon: (
                    <ConfigTierIcon
                      resource={tier.resource ?? control.resource}
                      sizeClass="!h-[28px] !w-[28px]"
                    />
                  ),
                }))}
                onSelect={(key) => onSelect(control.id, key)}
                onPreview={
                  onPreview ? (key) => onPreview(control.id, key) : undefined
                }
                disabled={control.tiers.length <= 1}
                title={`${control.label}: ${control.current.label}`}
                ariaLabel={control.label}
                className="flex-1"
              />
            </span>
          </label>
        ))}
      </div>
    </GridBlock>
  );
}


function PassiveProductionConfigPanel({
  className = "",
  controls,
  onSelect,
  getControlHelp,
}: {
  className?: string;
  controls: MachineConfigTierControl[];
  onSelect: (controlId: string, nextTier: string) => void;
  /** Hover explanation per control (what the knob does and why it matters). */
  getControlHelp?: (controlId: string) => ReactNode;
}) {
  if (controls.length === 0) {
    return null;
  }

  // Same deal as MachineConfigControlPanel: two per row, three cells a row.
  const rows = Math.ceil(controls.length / 2);
  return (
    <GridBlock
      className={[
        "nodrag border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        className,
      ].join(" ")}
      minCells={(rows * CONFIG_PANEL_ROW_HEIGHT) / BOARD_GRID}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1 gap-y-1">
        {controls.map((control) => (
          <MinecraftTooltip key={control.id} content={getControlHelp?.(control.id)}>
          <label className="min-w-0">
            <span className="mb-0.5 block truncate text-[10px] font-bold uppercase leading-4 text-[var(--mc-ink-muted)]">
              {control.label}
            </span>
            <MinecraftSelect
              value={control.current.key}
              options={control.tiers}
              onSelect={(key) => onSelect(control.id, key)}
              disabled={control.tiers.length <= 1}
              title={`${control.label}: ${control.current.label}`}
              ariaLabel={control.label}
            />
          </label>
          </MinecraftTooltip>
        ))}
      </div>
    </GridBlock>
  );
}

const CROP_HELP_GOOD = "#4ade80";
const CROP_HELP_BAD = "#f87171";

function CropHelpPanel({
  title,
  children,
  finePrint,
  feeding,
}: {
  title: string;
  children: ReactNode;
  /** The exact formula, tucked away for the curious. */
  finePrint?: ReactNode;
  /** Shared "how feeding works" footer for the environment knobs. */
  feeding?: { tier: number };
}) {
  return (
    <div className="w-[400px]">
      <p className="text-[18px] font-semibold leading-snug text-amber-300">{title}</p>
      <div className="mt-1.5 space-y-2 text-[16px] leading-relaxed text-slate-100">{children}</div>
      {feeding ? (
        <p className="mt-2.5 border-t border-white/10 pt-2 text-[16px] leading-relaxed text-slate-100">
          Feeding basics: this crop is Tier {feeding.tier}, so it wants{" "}
          <span className="text-white">{feeding.tier * 10}</span> food out of a possible 275. Every
          point of extra food makes it grow{" "}
          <span style={{ color: CROP_HELP_GOOD }}>a little faster</span>; every missing point slows
          it <span style={{ color: CROP_HELP_BAD }}>four times as hard</span> — and if it&apos;s 25
          or more short, it <span style={{ color: CROP_HELP_BAD }}>stops growing completely</span>.
        </p>
      ) : null}
      {finePrint ? (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[13px] leading-relaxed text-slate-400">
          For the curious: {finePrint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Friendly hover explainers for the crop source dropdowns, with this crop's
 * own numbers. Plain words first, the exact formula as fine print.
 */
function cropControlHelp(recipe: Recipe, controlId: string): ReactNode {
  const stats = getCropsNhStats(recipe);
  if (!stats) {
    return undefined;
  }
  const meta = (recipe.metadata as { cropsNh?: { biomeTags?: string[] } } | undefined)?.cropsNh;
  const biomeTags = Array.isArray(meta?.biomeTags) ? meta.biomeTags : [];
  const good = (text: string) => <span style={{ color: CROP_HELP_GOOD }}>{text}</span>;
  const bad = (text: string) => <span style={{ color: CROP_HELP_BAD }}>{text}</span>;

  switch (controlId) {
    case "cropGrowthStat":
      return (
        <CropHelpPanel
          title="Growth — how fast it regrows"
          finePrint={
            <>
              every 12.8 s the plant gains (6 + Growth) points, scaled by feeding. This crop is
              ripe at {stats.growthPoints.toLocaleString()} points and restarts from 0 after each
              harvest.
            </>
          }
        >
          <p>
            The higher the Growth stat, the sooner each harvest comes around. A 31-Growth plant
            regrows {good("about five times faster")} than a 1-Growth one.
          </p>
          <p className="text-slate-300">
            In the game you raise Growth by cross-breeding crops between double crop sticks.
          </p>
        </CropHelpPanel>
      );
    case "cropGainStat":
      return (
        <CropHelpPanel
          title="Gain — how much loot per harvest"
          finePrint={
            <>
              drop rounds = {stats.dropChance.toFixed(3)} × 1.03^Gain, and every successful drop
              has a (Gain + 1)% chance of one bonus item.
            </>
          }
        >
          <p>
            The higher the Gain stat, the more items each harvest gives. At 31 you collect{" "}
            {good("roughly 2.5× as much")} as at 1.
          </p>
          <p className="text-slate-300">
            Like Growth, it&apos;s raised by cross-breeding. It never changes how fast the plant
            grows — only how much falls out.
          </p>
        </CropHelpPanel>
      );
    case "cropWater":
      return (
        <CropHelpPanel
          title="Water — keep it topped up"
          feeding={{ tier: stats.tier }}
          finePrint={<>water bonus = floor((water + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            A well-watered crop is a well-fed crop: full water is {good("+10 food")}, one of the
            two biggest boosts you control.
          </p>
          <p className="text-slate-300">
            A Crop Manager keeps water at full automatically, so &quot;Full&quot; matches an
            automated farm.
          </p>
        </CropHelpPanel>
      );
    case "cropFertilizer":
      return (
        <CropHelpPanel
          title="Fertilizer — food from a bag"
          feeding={{ tier: stats.tier }}
          finePrint={<>fertilizer bonus = floor((fertilizer + 9) ÷ 10): 0 → +1, 50 → +5, 100 → +10.</>}
        >
          <p>
            Fertilizer works exactly like water: keeping it full is {good("+10 food")}. Skip it and
            a hungry high-tier crop will {bad("crawl or stall")}.
          </p>
          <p className="text-slate-300">
            Crop Managers and Industrial Farms can supply it for you (Fertilia crops literally grow
            the stuff).
          </p>
        </CropHelpPanel>
      );
    case "cropSky":
      return (
        <CropHelpPanel
          title="Sky — a little sunshine"
          feeding={{ tier: stats.tier }}
          finePrint={<>sky bonus = +2 when the block above the crop can see the sky.</>}
        >
          <p>
            Plants under open sky get a small {good("+2 food")} bonus. Roofed or underground farms
            lose it — usually fine, unless the crop is right on the edge of being underfed.
          </p>
        </CropHelpPanel>
      );
    case "cropBiome":
      return (
        <CropHelpPanel
          title="Biome — plant it where it's happy"
          feeding={{ tier: stats.tier }}
          finePrint={
            <>
              biome bonus = max(humidity, likes): each matching tag +14, capped at 2 tags; humidity
              scales 0–14 between 50% and 80% biome humidity.
            </>
          }
        >
          <p>
            {biomeTags.length > 0 ? (
              <>
                This crop likes{" "}
                <span className="text-white">{biomeTags.join(" and ").toLowerCase()}</span> places.
              </>
            ) : (
              <>This crop has no favourite biome.</>
            )}{" "}
            Each matching like is {good("+14 food")}, so hitting both is {good("+28")} — the
            biggest feeding boost there is.
          </p>
          <p className="text-slate-300">
            No matching biome nearby? A wet one (80%+ humidity, like a swamp or jungle) still gives
            up to +14.
          </p>
        </CropHelpPanel>
      );
    default:
      return undefined;
  }
}

function shortConfigLabel(resource: ResourceAmount) {
  const label = resource.displayName ?? resource.id;
  if (/^\d+(\/\d+)*$/.test(label)) {
    // A number is already short, and initialling it ate digits: a slice count
    // of "55" came out as "5".
    return label;
  }
  if (label.length <= 4) {
    return label.toUpperCase();
  }
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function formatMachineParallelMultiplier(multiplier: number) {
  return Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

type ConnectionSlotState = "idle" | "selected" | "compatible";

function getConnectionSlotState(
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"],
  nodeId: string,
  side: "input" | "output",
  kind: string,
  resourceId: string,
  alternatives: Recipe["inputs"][number]["alternatives"],
  handleId: string,
): ConnectionSlotState {
  if (!pending) {
    return "idle";
  }

  // Ports carry canonical (index-less) ids while a pending selection can hold
  // a legacy per-slot id; compare on the canonical form.
  if (
    pending.nodeId === nodeId &&
    canonicalizeResourceHandleId(pending.handleId) === canonicalizeResourceHandleId(handleId)
  ) {
    return "selected";
  }

  if (pending.nodeId !== nodeId && pending.side !== side && pending.kind === kind) {
    const pendingResource = {
      kind: pending.kind,
      id: pending.resourceId,
      alternatives: pending.alternatives,
    };
    const slotResource = { kind, id: resourceId, alternatives };
    const input = side === "input" ? slotResource : pendingResource;
    const output = side === "output" ? slotResource : pendingResource;

    if (resourceMatchesInput(output, input)) {
      return "compatible";
    }
  }

  return "idle";
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">{label}</div>
      <div className={["truncate font-medium", valueClassName ?? ""].join(" ")}>{value}</div>
    </div>
  );
}

function MachineCountStat({
  label,
  machineCount,
  onChange,
}: {
  label: string;
  machineCount: number;
  onChange: (machineCount: number) => void;
}) {
  const machineCountText = String(machineCount);
  const [draftState, setDraftState] = useState({
    machineCount,
    draft: machineCountText,
  });
  const draft = draftState.machineCount === machineCount ? draftState.draft : machineCountText;

  const commitDraft = (value: string) => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return;
    }

    const next = Math.max(1, Number.parseInt(normalized, 10));
    if (Number.isFinite(next) && next !== machineCount) {
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  const stepBy = (direction: 1 | -1, event: React.MouseEvent) => {
    // Shift-click steps by 100, Ctrl-click (or Cmd on mac) by 10.
    const step = event.shiftKey ? 100 : event.ctrlKey || event.metaKey ? 10 : 1;
    const next = Math.max(1, machineCount + direction * step);
    if (next !== machineCount) {
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  const stepButtonClassName =
    "nodrag flex h-5 w-5 shrink-0 items-center justify-center border border-[var(--mc-33)] bg-[var(--mc-82)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-100)] active:shadow-[inset_1px_1px_0_var(--mc-47),inset_-1px_-1px_0_var(--mc-100)]";

  return (
    <div className="min-w-0 border border-[var(--mc-47)] bg-[var(--mc-71)] px-1 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
      <div className="truncate text-[11px] uppercase leading-[13px] text-[var(--mc-ink-muted)]">{label}</div>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepBy(-1, event);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={stepButtonClassName}
          title="Remove 1 (Shift: 100, Ctrl: 10)"
          aria-label={`Decrease ${label.toLowerCase()} count`}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraftState({ machineCount, draft: nextDraft });
            commitDraft(nextDraft);
          }}
          onBlur={() => {
            if (!/^\d+$/.test(draft.trim())) {
              setDraftState({ machineCount, draft: machineCountText });
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          inputMode="numeric"
          aria-label={`${label} count`}
          title={`Edit ${label.toLowerCase()} count`}
          className="nodrag h-[21px] w-0 min-w-0 flex-1 border border-[var(--mc-47)] bg-[var(--mc-85)] px-1 text-center text-[14px] font-medium leading-4 text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-100),inset_-1px_-1px_0_var(--mc-54)] outline-none focus:border-cyan-700 focus:bg-[var(--mc-100)] focus:ring-1 focus:ring-cyan-400"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepBy(1, event);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={stepButtonClassName}
          title="Add 1 (Shift: 100, Ctrl: 10)"
          aria-label={`Increase ${label.toLowerCase()} count`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
