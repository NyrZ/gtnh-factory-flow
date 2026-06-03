"use client";

import type { ReactNode } from "react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import type { NeiPositionedSlot, NeiRecipeLayout } from "@/lib/nei/layout";
import { NeiRecipeSurface } from "@/components/nei-renderer/NeiRecipeSurface";

interface NeiRecipeCanvasProps {
  recipe: Recipe;
  scale?: number;
  slotPixelSize?: number;
  iconPixelSize?: number;
  className?: string;
  hideCollapseControls?: boolean;
  layout?: NeiRecipeLayout;
  contextResource?: Pick<ResourceAmount, "kind" | "id">;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
}

export function NeiRecipeCanvas(props: NeiRecipeCanvasProps) {
  const renderScale = props.slotPixelSize
    ? props.slotPixelSize / (props.layout?.slotSize ?? 18)
    : (props.scale ?? 2);

  return (
    <NeiRecipeSurface
      recipe={props.recipe}
      options={{ preset: props.hideCollapseControls ? "compact" : "native", scale: renderScale }}
      iconPixelSize={props.iconPixelSize ?? 16 * renderScale}
      className={props.className}
      renderHandle={props.renderHandle}
      getSlotConnectionAttributes={props.getSlotConnectionAttributes}
      onSlotClick={props.onSlotClick}
      suppressSlotHover={props.suppressSlotHover}
      suppressConsumedState={props.suppressConsumedState}
      getSlotZIndex={props.getSlotZIndex}
      slotTooltip={props.slotTooltip}
    />
  );
}
