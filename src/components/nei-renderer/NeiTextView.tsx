"use client";

import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import type { NeiTextCommand } from "@/lib/nei-renderer/core/commands";

export function NeiTextView({ command, scale }: { command: NeiTextCommand; scale: number }) {
  const text = (
    <div
      className="pointer-events-none absolute overflow-hidden whitespace-nowrap font-mono"
      style={{
        left: command.x * scale,
        top: command.y * scale,
        width: command.width ? command.width * scale : undefined,
        height: command.height ? command.height * scale : undefined,
        color: command.color ?? "#111",
        fontSize: (command.fontSize ?? 8) * scale,
        lineHeight: `${(command.fontSize ?? 8) * scale}px`,
        textAlign: command.align,
      }}
    >
      {command.text}
    </div>
  );

  return command.tooltip ? (
    <MinecraftTooltip label={command.tooltip}>{text}</MinecraftTooltip>
  ) : (
    text
  );
}
