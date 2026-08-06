"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState, type CSSProperties } from "react";
import { Maximize2, Ungroup } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { makeResourceHandleId } from "./resource-handles";
import { formatSlotRateOrNull } from "./flow-explainers";
import type { PocketSummary } from "./pocket-summary";

export interface PocketNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  summary?: PocketSummary;
}

export type PocketFlowNode = Node<PocketNodeData, "pocketNode">;

/**
 * Card metrics on the grid: 30px header + 20px port rows + 10px footer keeps
 * the total height a whole number of cells AND puts every port row's centre
 * exactly on a grid line (40, 60, 80, … from the card's top), which the
 * router requires of every port.
 */
export const POCKET_NODE_WIDTH = 280;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 20;
const FOOTER_HEIGHT = 10;

// Inline styles so React Flow's own handle stylesheet can never reposition
// or resize the port dots; they straddle the card edge like machine rails.
const PORT_HANDLE_BASE: CSSProperties = {
  position: "absolute",
  width: 10,
  height: 10,
  minWidth: 0,
  minHeight: 0,
  margin: 0,
  borderRadius: 2,
  border: "2px solid #241b33",
  transform: "translateY(-50%)",
  zIndex: 30,
};

function PocketNodeComponent({ data, selected }: NodeProps<PocketFlowNode>) {
  const { pocket, summary } = data;
  const enterPocket = useFactoryStore((state) => state.enterPocket);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);

  const inputs = summary?.inputs ?? [];
  const outputs = summary?.outputs ?? [];
  const rowCount = Math.max(inputs.length, outputs.length, 1);
  const bodyHeight = rowCount * ROW_HEIGHT + FOOTER_HEIGHT;

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  return (
    <div
      className={[
        "group relative font-mono",
        selected ? "ring-2 ring-fuchsia-300" : "",
      ].join(" ")}
      style={{ width: POCKET_NODE_WIDTH }}
      onDoubleClick={(event) => {
        // The name field manages its own double-click; everywhere else on
        // the card, a double-click dives into the dimension.
        if (!(event.target as HTMLElement).closest("input")) {
          enterPocket(pocket.id);
        }
      }}
    >
      {/* Star-field purple: a pocket universe should not pass for a machine. */}
      <div
        className="relative flex items-center gap-1.5 bg-[#3b2d52] px-2 text-white shadow-[inset_0_0_0_2px_#8d6fd1,inset_2px_2px_0_#5e4a85,inset_-2px_-2px_0_#241b33]"
        style={{ height: HEADER_HEIGHT }}
      >
        {draftName === undefined ? (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-bold leading-none"
            title={`${pocket.name} — double-click the card to open, double-click the name to rename`}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraftName(pocket.name);
            }}
          >
            ✦ {pocket.name}
          </span>
        ) : (
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitRename();
              }
              if (event.key === "Escape") {
                setDraftName(undefined);
              }
              event.stopPropagation();
            }}
            className="nodrag min-w-0 flex-1 border border-[#8d6fd1] bg-[#241b33] px-1 text-[13px] leading-none text-white outline-none"
          />
        )}
        {summary ? (
          <span
            className="shrink-0 text-[10px] leading-none text-[#c9b8ec]"
            title={`${summary.machineCount} machines, ${summary.memberCount} cards inside`}
          >
            {summary.machineCount > 0 ? `${summary.machineCount}⚙ ` : ""}
            {summary.memberCount}▪
          </span>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            enterPocket(pocket.id);
          }}
          title="Open this pocket dimension"
          aria-label={`Open pocket ${pocket.name}`}
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center border border-[#8d6fd1] bg-[#241b33] text-white hover:bg-[#5e4a85]"
        >
          <Maximize2 aria-hidden className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            dissolvePocket(pocket.id);
          }}
          title="Unpack: spill everything back onto this board"
          aria-label={`Unpack pocket ${pocket.name}`}
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center border border-[#8d6fd1] bg-[#241b33] text-white hover:bg-[#5e4a85]"
        >
          <Ungroup aria-hidden className="h-3 w-3" />
        </button>
      </div>

      <div
        className="relative bg-[#2b2140] text-white shadow-[inset_0_0_0_2px_#5e4a85,inset_2px_2px_0_#3b2d52,inset_-2px_-2px_0_#1a1326]"
        style={{ height: bodyHeight }}
      >
        {inputs.length === 0 && outputs.length === 0 ? (
          <div className="flex h-full items-center justify-center pb-1 text-[10px] text-[#8d7ab0]">
            self-contained
          </div>
        ) : null}
        {inputs.map((port, index) => {
          const rowCenter = index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const rate = formatSlotRateOrNull(port.ratePerSecond, port.kind);
          return (
            <div
              key={`in:${port.kind}:${port.resourceId}`}
              className="absolute left-2 flex items-center gap-1"
              style={{ top: rowCenter, transform: "translateY(-50%)", maxWidth: "46%" }}
              title={`needs ${port.displayName ?? port.resourceId}`}
            >
              <ResourceIcon
                resource={{ ...port, id: port.resourceId, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-4 !w-4"
              />
              {rate ? (
                <span className="truncate text-[10px] leading-none text-[#d8ccf0]">{rate}</span>
              ) : null}
            </div>
          );
        })}
        {outputs.map((port, index) => {
          const rowCenter = index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const rate = formatSlotRateOrNull(port.ratePerSecond, port.kind);
          return (
            <div
              key={`out:${port.kind}:${port.resourceId}`}
              className="absolute right-2 flex flex-row-reverse items-center gap-1"
              style={{ top: rowCenter, transform: "translateY(-50%)", maxWidth: "46%" }}
              title={`offers ${port.displayName ?? port.resourceId}`}
            >
              <ResourceIcon
                resource={{ ...port, id: port.resourceId, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-4 !w-4"
              />
              {rate ? (
                <span className="truncate text-[10px] leading-none text-[#d8ccf0]">{rate}</span>
              ) : null}
            </div>
          );
        })}
        {/* Handles are the body's own children: the row wrappers carry CSS
            transforms, which would otherwise become the dots' containing
            blocks and drag them off the card edge. */}
        {inputs.map((port, index) => (
          <Handle
            key={`hin:${port.kind}:${port.resourceId}`}
            type="target"
            position={Position.Left}
            id={makeResourceHandleId("input", { kind: port.kind, id: port.resourceId })}
            isConnectable={false}
            style={{
              ...PORT_HANDLE_BASE,
              left: -5,
              top: index * ROW_HEIGHT + ROW_HEIGHT / 2,
              background: port.dominantColor ?? "#8d6fd1",
            }}
          />
        ))}
        {outputs.map((port, index) => (
          <Handle
            key={`hout:${port.kind}:${port.resourceId}`}
            type="source"
            position={Position.Right}
            id={makeResourceHandleId("output", { kind: port.kind, id: port.resourceId })}
            isConnectable={false}
            style={{
              ...PORT_HANDLE_BASE,
              left: "auto",
              right: -5,
              top: index * ROW_HEIGHT + ROW_HEIGHT / 2,
              background: port.dominantColor ?? "#8d6fd1",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export const PocketNode = memo(PocketNodeComponent);
