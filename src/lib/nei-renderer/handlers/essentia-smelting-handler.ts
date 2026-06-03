import type { NeiDrawCommand } from "../core/commands";
import type { NeiPositionedStack } from "../core/positioned-stack";
import type { NeiRecipeHandler } from "../core/recipe-handler";
import type { NeiSize } from "../core/render-model";
import { NEI_DEFAULT_HANDLER_WIDTH } from "../theme/constants";
import { NEI_PALETTE } from "../theme/palette";
import {
  aspectToPositionedStack,
  basePanel,
  gridPositions,
  resourceToPositionedStack,
  slotCommand,
} from "./command-helpers";

const INPUT_POSITION = { x: 24, y: 32 };
const ASPECT_POSITIONS = gridPositions(6, 118, 14, 2, 8);

export const EssentiaSmeltingHandler: NeiRecipeHandler = {
  id: "essentia-smelting",
  label: "Essentia Smelting",

  canHandle(recipe) {
    return recipe.kind === "essentia_smelting";
  },

  getDimensions(recipe, ctx): NeiSize {
    if (ctx.options.aspectDisplay === "text" || ctx.options.aspectDisplay === "badge") {
      return { width: 220, height: Math.max(82, 28 + (recipe.aspectOutputs?.length ?? 0) * 18) };
    }
    return { width: NEI_DEFAULT_HANDLER_WIDTH, height: 82 };
  },

  drawBackground(recipe, ctx): NeiDrawCommand[] {
    const dimensions = this.getDimensions(recipe, ctx);
    const aspectCount = recipe.aspectOutputs?.length ?? 0;
    const useTextAspects =
      ctx.options.aspectDisplay === "text" || ctx.options.aspectDisplay === "badge";

    return [
      basePanel(dimensions.width, dimensions.height),
      {
        type: "rect",
        layer: "decoration",
        x: 70,
        y: 35,
        width: 34,
        height: 3,
        color: NEI_PALETTE.thaumcraft,
      },
      {
        type: "rect",
        layer: "decoration",
        x: 98,
        y: 30,
        width: 6,
        height: 13,
        color: NEI_PALETTE.thaumcraft,
      },
      slotCommand({ ...INPUT_POSITION, side: "input", kind: "item", slotIndex: 0 }),
      ...(useTextAspects
        ? []
        : ASPECT_POSITIONS.map((position, index) =>
            slotCommand({
              ...position,
              side: "output",
              kind: "aspect",
              slotIndex: index,
              empty: index >= aspectCount,
              framed: false,
            }),
          )),
    ];
  },

  getInputs(recipe): NeiPositionedStack[] {
    const input = recipe.inputs[0];
    return input
      ? [
          resourceToPositionedStack({
            resource: input,
            side: "input",
            x: INPUT_POSITION.x,
            y: INPUT_POSITION.y,
            slotIndex: 0,
            resourceIndex: 0,
          }),
        ]
      : [];
  },

  getOutputs(recipe, ctx): NeiPositionedStack[] {
    const useTextAspects =
      ctx.options.aspectDisplay === "text" || ctx.options.aspectDisplay === "badge";
    return (recipe.aspectOutputs ?? []).slice(0, ASPECT_POSITIONS.length).map((aspect, index) => {
      const position = useTextAspects ? { x: 112, y: 16 + index * 18 } : ASPECT_POSITIONS[index];
      return aspectToPositionedStack({
        aspect,
        side: "output",
        x: position.x,
        y: position.y,
        slotIndex: index,
        semanticTags: ["essentia-output"],
      });
    });
  },

  drawForeground(recipe, ctx): NeiDrawCommand[] {
    const useTextAspects =
      ctx.options.aspectDisplay === "text" || ctx.options.aspectDisplay === "badge";
    if (!useTextAspects) {
      return [];
    }

    return (recipe.aspectOutputs ?? []).map(
      (aspect, index): NeiDrawCommand => ({
        type: "text",
        layer: "text",
        x: 136,
        y: 18 + index * 18,
        width: 78,
        text: `${aspect.name} x${aspect.amount}`,
        color: "#22122f",
        fontSize: 10,
        semanticTags: ["essentia-output", "thaumcraft-info"],
      }),
    );
  },
};
