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

const OUTPUT_POSITIONS = gridPositions(6, 106, 17, 3, 18);

export const BeeProduceHandler: NeiRecipeHandler = {
  id: "bee-produce",
  label: "Bee Produce",

  canHandle(recipe) {
    return recipe.kind === "bee_produce";
  },

  getDimensions(): NeiSize {
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: NEI_DEFAULT_HANDLER_HEIGHT };
  },

  drawBackground(recipe): NeiDrawCommand[] {
    return [
      basePanel(NEI_DEFAULT_HANDLER_WIDTH, NEI_DEFAULT_HANDLER_HEIGHT),
      { type: "rect", layer: "decoration", x: 6, y: 6, width: 158, height: 70, color: "#d8d0a4" },
      {
        type: "rect",
        layer: "decoration",
        x: 78,
        y: 37,
        width: 24,
        height: 3,
        color: NEI_PALETTE.bee,
      },
      {
        type: "rect",
        layer: "decoration",
        x: 96,
        y: 32,
        width: 6,
        height: 13,
        color: NEI_PALETTE.bee,
      },
      slotCommand({ x: 48, y: 35, side: "input", kind: "item", slotIndex: 0 }),
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
    const bee = recipe.inputs[0];
    return bee
      ? [
          resourceToPositionedStack({
            resource: bee,
            side: "input",
            x: 48,
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
    const condition = recipe.metadata?.condition;
    return typeof condition === "string"
      ? [
          {
            type: "text",
            layer: "text",
            x: 8,
            y: 70,
            text: condition,
            fontSize: 8,
            color: "#262018",
          },
        ]
      : [];
  },
};
