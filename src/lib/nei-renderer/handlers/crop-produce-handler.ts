import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiSize } from "../core/render-model";
import { NEI_DEFAULT_HANDLER_HEIGHT, NEI_DEFAULT_HANDLER_WIDTH } from "../theme/constants";
import { NEI_PALETTE } from "../theme/palette";
import {
  basePanel,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

const OUTPUT_POSITIONS = gridPositions(3, 124, 35, 3);

export const CropProduceHandler: NeiRecipeHandler = {
  id: "crop-produce",
  label: "Crop Produce",

  canHandle(recipe) {
    return recipe.kind === "crop_produce";
  },

  getDimensions(): NeiSize {
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: NEI_DEFAULT_HANDLER_HEIGHT };
  },

  drawBackground(recipe): NeiDrawCommand[] {
    return [
      basePanel(NEI_DEFAULT_HANDLER_WIDTH, NEI_DEFAULT_HANDLER_HEIGHT),
      { type: "rect", layer: "decoration", x: 16, y: 50, width: 148, height: 16, color: "#7b5b35" },
      { type: "rect", layer: "decoration", x: 16, y: 42, width: 148, height: 8, color: "#5a963e" },
      {
        type: "rect",
        layer: "decoration",
        x: 78,
        y: 39,
        width: 24,
        height: 3,
        color: NEI_PALETTE.crop,
      },
      {
        type: "rect",
        layer: "decoration",
        x: 96,
        y: 34,
        width: 6,
        height: 13,
        color: NEI_PALETTE.crop,
      },
      slotCommand({ x: 34, y: 35, side: "input", kind: "item", slotIndex: 0 }),
      ...OUTPUT_POSITIONS.map((position, index) =>
        slotCommand({
          ...position,
          side: "output",
          kind: "item",
          slotIndex: index,
          empty: index >= recipe.outputs.length,
        }),
      ),
    ];
  },

  getInputs(recipe): NeiPositionedStack[] {
    const crop = recipe.inputs[0];
    return crop
      ? [
          resourceToPositionedStack({
            resource: crop,
            side: "input",
            x: 34,
            y: 35,
            slotIndex: 0,
            resourceIndex: 0,
          }),
        ]
      : [];
  },

  getOutputs(recipe): NeiPositionedStack[] {
    return recipe.outputs.slice(0, OUTPUT_POSITIONS.length).map((resource, index) =>
      resourceToPositionedStack({
        resource,
        side: "output",
        x: OUTPUT_POSITIONS[index].x,
        y: OUTPUT_POSITIONS[index].y,
        slotIndex: index,
        resourceIndex: index,
      }),
    );
  },

  drawForeground(recipe): NeiDrawCommand[] {
    const soil = recipe.metadata?.soil;
    return typeof soil === "string"
      ? [{ type: "text", layer: "text", x: 8, y: 70, text: soil, fontSize: 8, color: "#1f2c18" }]
      : [];
  },
};
