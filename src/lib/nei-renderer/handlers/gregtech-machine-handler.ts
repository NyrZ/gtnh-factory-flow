import type { Recipe, ResourceAmount, ResourceKind } from "@/lib/model/types";
import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiRecipeRenderModel, NeiSize } from "../core/render-model";
import { NEI_ITEM_SLOT_SIZE, NEI_TEXT_COLORS } from "../theme/constants";
import { NEI_PALETTE } from "../theme/palette";
import {
  basePanel,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

type SlotSide = "input" | "output";
type StackGroup =
  | "itemInputs"
  | "itemOutputs"
  | "fluidInputs"
  | "fluidOutputs"
  | "aspectInputs"
  | "aspectOutputs";

interface NativeSlot {
  side: SlotSide;
  kind: ResourceKind;
  x: number;
  y: number;
  slotIndex: number;
  resourceIndex?: number;
  resource?: ResourceAmount;
}

interface NativeGregTechLayout {
  canvas: NeiSize;
  slots: NativeSlot[];
  progress: {
    x: number;
    y: number;
    width: number;
    height: number;
    direction: "right" | "up" | "circular";
    texture?: string;
  }[];
  statsY: number;
}

const PANEL_WIDTH = 196;
const MIN_PANEL_HEIGHT = 96;
const SLOT_STEP = NEI_ITEM_SLOT_SIZE + 2;
const INPUT_X = 12;
const OUTPUT_X = 128;
const START_Y = 18;
const SLOT_COLUMNS = 3;

export const GregTechMachineHandler: NeiRecipeHandler = {
  id: "gregtech-machine",
  label: "GregTech Machine",

  canHandle(recipe) {
    return recipe.kind === "gregtech_machine";
  },

  getDimensions(recipe): NeiSize {
    return createNativeGregTechLayout(recipe).canvas;
  },

  drawBackground(recipe): NeiDrawCommand[] {
    const layout = createNativeGregTechLayout(recipe);
    return [
      basePanel(layout.canvas.width, layout.canvas.height),
      {
        type: "rect",
        layer: "decoration",
        x: 82,
        y: Math.max(28, layout.progress[0]?.y ?? 36),
        width: 32,
        height: 18,
        color: "rgba(40, 40, 40, 0.08)",
        borderColor: "rgba(40, 40, 40, 0.25)",
        semanticTags: ["progress-arrow"],
      },
      ...layout.progress.map(
        (bar, index): NeiDrawCommand => ({
          type: "progress",
          layer: "progress",
          x: bar.x,
          y: bar.y,
          width: bar.width,
          height: bar.height,
          direction: bar.direction,
          texture: bar.texture ?? "arrow",
          semanticTags: ["progress-arrow"],
          id: `progress-${index}`,
        }),
      ),
      ...layout.slots.map((slot) =>
        slotCommand({
          x: slot.x,
          y: slot.y,
          side: slot.side,
          kind: slot.kind,
          slotIndex: slot.slotIndex,
          empty: !slot.resource,
        }),
      ),
    ];
  },

  getInputs(recipe): NeiPositionedStack[] {
    return createNativeGregTechLayout(recipe).slots.flatMap((slot) => {
      if (slot.side !== "input" || !slot.resource) return [];
      return [
        resourceToPositionedStack({
          resource: slot.resource,
          side: "input",
          x: slot.x,
          y: slot.y,
          slotIndex: slot.slotIndex,
          resourceIndex: slot.resourceIndex,
          semanticTags: slotSemanticTags(recipe, slot),
        }),
      ];
    });
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return createNativeGregTechLayout(recipe).slots.flatMap((slot) => {
      if (slot.side !== "output" || !slot.resource) return [];
      return [
        resourceToPositionedStack({
          resource: slot.resource,
          side: "output",
          x: slot.x,
          y: slot.y,
          slotIndex: slot.slotIndex,
          resourceIndex: slot.resourceIndex,
          semanticTags: "chance" in slot.resource ? ["chance"] : undefined,
        }),
      ];
    });
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const layout = createNativeGregTechLayout(recipe);
    const commands: NeiDrawCommand[] = [];

    if (recipe.durationTicks !== undefined) {
      commands.push({
        type: "text",
        layer: "stats",
        x: 12,
        y: layout.statsY,
        width: 78,
        text: `${formatDuration(recipe.durationTicks)}`,
        color: NEI_TEXT_COLORS.black,
        fontSize: 9,
        semanticTags: ["duration", "machine-info"],
      });
    }

    if (recipe.eut !== undefined) {
      commands.push({
        type: "text",
        layer: "stats",
        x: layout.canvas.width - 92,
        y: layout.statsY,
        width: 80,
        text: `${recipe.eut} EU/t`,
        align: "right",
        color: NEI_TEXT_COLORS.black,
        fontSize: 9,
        semanticTags: ["eut", "machine-info"],
      });
    }

    const specialInfo = formatSpecialValue(recipe.specialValue);
    if (specialInfo) {
      commands.push({
        type: "text",
        layer: "stats",
        x: 84,
        y: layout.statsY,
        width: 28,
        text: specialInfo,
        align: "center",
        color: NEI_PALETTE.panelDark,
        fontSize: 8,
        semanticTags: ["machine-info"],
      });
    }

    return commands;
  },
};

function createNativeGregTechLayout(recipe: NeiRecipeRenderModel): NativeGregTechLayout {
  const itemInputs = indexedResources(recipe, "input", "item");
  const itemOutputs = indexedResources(recipe, "output", "item");
  const fluidInputs = indexedResources(recipe, "input", "fluid");
  const fluidOutputs = indexedResources(recipe, "output", "fluid");
  const aspectInputs = indexedResources(recipe, "input", "aspect");
  const aspectOutputs = indexedResources(recipe, "output", "aspect");
  const capacities = getSlotCapacities(recipe.sourceRecipe);
  const itemInputCount = Math.max(itemInputs.length, capacities.maxItemInputs ?? 0);
  const itemOutputCount = Math.max(itemOutputs.length, capacities.maxItemOutputs ?? 0);
  const fluidInputCount = Math.max(fluidInputs.length, capacities.maxFluidInputs ?? 0);
  const fluidOutputCount = Math.max(fluidOutputs.length, capacities.maxFluidOutputs ?? 0);
  const aspectInputCount = aspectInputs.length;
  const aspectOutputCount = aspectOutputs.length;

  const itemInputRows = rowCount(itemInputCount);
  const itemOutputRows = rowCount(itemOutputCount);
  const fluidInputRows = rowCount(fluidInputCount);
  const fluidOutputRows = rowCount(fluidOutputCount);
  const aspectInputRows = rowCount(aspectInputCount);
  const aspectOutputRows = rowCount(aspectOutputCount);
  const leftHeight = groupHeight(itemInputRows, fluidInputRows, aspectInputRows);
  const rightHeight = groupHeight(itemOutputRows, fluidOutputRows, aspectOutputRows);
  const contentHeight = Math.max(leftHeight, rightHeight, NEI_ITEM_SLOT_SIZE);
  const canvasHeight = Math.max(MIN_PANEL_HEIGHT, START_Y + contentHeight + 24);
  const progressY = Math.round(START_Y + Math.max(0, contentHeight - 17) / 2);

  return {
    canvas: { width: PANEL_WIDTH, height: canvasHeight },
    slots: [
      ...createSlots("itemInputs", itemInputs, itemInputCount, INPUT_X, START_Y),
      ...createSlots(
        "fluidInputs",
        fluidInputs,
        fluidInputCount,
        INPUT_X,
        sectionY(START_Y, itemInputRows),
      ),
      ...createSlots(
        "aspectInputs",
        aspectInputs,
        aspectInputCount,
        INPUT_X,
        sectionY(START_Y, itemInputRows, fluidInputRows),
      ),
      ...createSlots("itemOutputs", itemOutputs, itemOutputCount, OUTPUT_X, START_Y),
      ...createSlots(
        "fluidOutputs",
        fluidOutputs,
        fluidOutputCount,
        OUTPUT_X,
        sectionY(START_Y, itemOutputRows),
      ),
      ...createSlots(
        "aspectOutputs",
        aspectOutputs,
        aspectOutputCount,
        OUTPUT_X,
        sectionY(START_Y, itemOutputRows, fluidOutputRows),
      ),
    ],
    progress: [
      {
        x: 88,
        y: progressY,
        width: 24,
        height: 17,
        direction: "right",
        texture: "arrow",
      },
    ],
    statsY: canvasHeight - 15,
  };
}

function createSlots(
  group: StackGroup,
  resources: Array<{ resource: ResourceAmount; resourceIndex: number }>,
  count: number,
  x: number,
  y: number,
): NativeSlot[] {
  if (count <= 0) return [];

  const side: SlotSide = group.endsWith("Inputs") ? "input" : "output";
  const kind: ResourceKind = group.startsWith("fluid")
    ? "fluid"
    : group.startsWith("aspect")
      ? "aspect"
      : "item";
  return Array.from({ length: count }, (_, index) => {
    const entry = resources[index];
    return {
      side,
      kind,
      x: x + (index % SLOT_COLUMNS) * SLOT_STEP,
      y: y + Math.floor(index / SLOT_COLUMNS) * SLOT_STEP,
      slotIndex: index,
      resourceIndex: entry?.resourceIndex,
      resource: entry?.resource,
    };
  });
}

function indexedResources(
  recipe: NeiRecipeRenderModel,
  side: SlotSide,
  kind: ResourceKind,
): Array<{ resource: ResourceAmount; resourceIndex: number }> {
  const sourceResources = side === "input" ? recipe.sourceRecipe?.inputs : recipe.sourceRecipe?.outputs;
  if (sourceResources) {
    return sourceResources.flatMap((resource, resourceIndex) =>
      resource.kind === kind ? [{ resource, resourceIndex }] : [],
    );
  }

  const resources =
    side === "input"
      ? kind === "fluid"
        ? recipe.fluidInputs ?? []
        : recipe.inputs
      : kind === "fluid"
        ? recipe.fluidOutputs ?? []
        : recipe.outputs;
  return resources.map((resource, resourceIndex) => ({ resource, resourceIndex }));
}

function getSlotCapacities(recipe?: Recipe) {
  return recipe?.nei?.slotCapacity ?? {};
}

function rowCount(count: number) {
  return Math.ceil(count / SLOT_COLUMNS);
}

function sectionY(startY: number, ...precedingRows: number[]) {
  let y = startY;
  let hasPreviousSection = false;
  for (const rows of precedingRows) {
    if (rows <= 0) continue;
    if (hasPreviousSection) y += 8;
    y += rows * SLOT_STEP;
    hasPreviousSection = true;
  }
  return hasPreviousSection ? y + 8 : startY;
}

function groupHeight(...sectionRows: number[]) {
  return sectionRows.reduce(
    (height, rows) => {
      if (rows <= 0) return height;
      return height + rows * SLOT_STEP + (height > 0 ? 8 : 0);
    },
    0,
  );
}

function slotSemanticTags(recipe: NeiRecipeRenderModel, slot: NativeSlot): string[] | undefined {
  if (
    slot.kind === "item" &&
    recipe.programmedCircuit &&
    slot.resource?.id === recipe.programmedCircuit.id
  ) {
    return ["catalyst-slot"];
  }
  return slot.resource && "consumed" in slot.resource && slot.resource.consumed === false
    ? ["catalyst-slot"]
    : undefined;
}

function formatDuration(durationTicks: number) {
  if (durationTicks <= 0) return "0 s";
  const seconds = durationTicks / 20;
  return seconds >= 10 ? `${seconds.toFixed(0)} s` : `${seconds.toFixed(1)} s`;
}

function formatSpecialValue(specialValue?: number) {
  if (specialValue === undefined || specialValue === 0) return undefined;
  return `SV ${specialValue}`;
}
