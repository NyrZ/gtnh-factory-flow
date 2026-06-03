"use client";

import type { ComponentProps } from "react";
import type { NeiAspectCommand } from "@/lib/nei-renderer/core/commands";
import { StackIconButton } from "./NeiItemView";

export function NeiAspectView({
  command,
  ...props
}: Omit<ComponentProps<typeof StackIconButton>, "command"> & { command: NeiAspectCommand }) {
  return <StackIconButton command={{ ...command, type: "item", layer: "item" }} {...props} />;
}
