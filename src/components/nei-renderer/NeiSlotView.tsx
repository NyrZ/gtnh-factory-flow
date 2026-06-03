"use client";

import type { NeiSlotCommand } from "@/lib/nei-renderer/core/commands";

export function NeiSlotView({ command, scale }: { command: NeiSlotCommand; scale: number }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width * scale,
        height: command.height * scale,
        backgroundImage: command.framed === false ? undefined : `url('${command.texturePath}')`,
        backgroundSize: command.framed === false ? undefined : "100% 100%",
      }}
    />
  );
}
