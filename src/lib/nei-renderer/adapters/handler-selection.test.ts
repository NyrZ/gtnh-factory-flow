import { describe, expect, it } from "vitest";
import type { NeiRecipeRenderModel } from "../core/render-model";
import { selectNeiRecipeHandler } from "./handler-selection";

describe("selectNeiRecipeHandler", () => {
  it("selects dedicated handlers by recipe kind", () => {
    expect(selectNeiRecipeHandler(model("bee_produce")).id).toBe("bee-produce");
    expect(selectNeiRecipeHandler(model("crop_produce")).id).toBe("crop-produce");
    expect(selectNeiRecipeHandler(model("essentia_smelting")).id).toBe("essentia-smelting");
    expect(selectNeiRecipeHandler(model("gregtech_machine")).id).toBe("gregtech-machine");
  });

  it("fails loudly for unhandled kinds", () => {
    expect(() => selectNeiRecipeHandler(model("unknown"))).toThrow(/No NEI recipe handler/);
  });
});

function model(kind: string): NeiRecipeRenderModel {
  return {
    id: kind,
    kind,
    inputs: [],
    outputs: [{ kind: "item", id: "output", amount: 1 }],
  };
}
