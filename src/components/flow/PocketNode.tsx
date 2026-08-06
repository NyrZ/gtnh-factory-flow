"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState } from "react";
import { Copy, Expand, PackageOpen, Save } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";
import { makeResourceHandleId } from "./resource-handles";
import { formatSlotRateOrNull } from "./flow-explainers";
import { isWiringConnection, wasRecentWireDrop } from "./connection-drag";
import { NodeGlanceText } from "./NodeGlance";
import type { PocketPortSummary, PocketSummary } from "./pocket-summary";

export interface PocketNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  summary?: PocketSummary;
}

export type PocketFlowNode = Node<PocketNodeData, "pocketNode">;

/**
 * A pocket card is a recipe card that happens to hold a whole sub-factory:
 * same 18-cell width, same 40px head row, same 40px port rows with the icon,
 * the name and the rate — inputs on the left rail, outputs on the right —
 * and the same drag-to-wire ports. Only the paint says "pocket universe":
 * star-field purple, so it can never pass for one machine.
 *
 * Head 40 + rows of 40 + footer 40 keeps the whole card on the grid and
 * every port row's centre exactly on a grid line (60, 100, 140, … from the
 * card's top), which the router requires of every port.
 */
export const POCKET_NODE_WIDTH = RECIPE_NODE_WIDTH;

/** The purple ink pair: names in white, figures a step down. */
const INK_MUTED = "text-[#c9b8ec]";

function PocketNodeComponent({ data, selected }: NodeProps<PocketFlowNode>) {
  const { pocket, summary } = data;
  const enterPocket = useFactoryStore((state) => state.enterPocket);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);

  const inputs = summary?.inputs ?? [];
  const outputs = summary?.outputs ?? [];

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  // Clone the whole dimension — the pocket, every member, every internal
  // wire — through the same capture/paste path Ctrl+C/Ctrl+V uses, so the
  // copy lands beside the original, selected and ready to drag.
  const duplicatePocket = () => {
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, [pocket.id]);
    if (!payload) {
      return;
    }
    const pastedIds = state.pasteBoardItems(payload, { x: POCKET_NODE_WIDTH + 40, y: 0 });
    if (pastedIds.length > 0) {
      state.setPendingBoardSelection(pastedIds);
    }
  };

  // Shelve the whole dimension as a blueprint, no questions asked: the
  // pocket's own name IS the blueprint's name (rename the pocket to rename
  // the next save). The blueprint panel's Mine shelf shows the result.
  const saveAsBlueprint = () => {
    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocket.id]);
    if (payload) {
      void useBlueprintStore.getState().save(pocket.name, payload);
    }
  };

  return (
    <div
      className={[
        "group relative font-mono text-white",
        selected ? "ring-2 ring-fuchsia-300" : "",
      ].join(" ")}
      style={{ width: POCKET_NODE_WIDTH }}
      onDoubleClick={(event) => {
        // The name field manages its own double-click; the buttons and the
        // port handles are their own controls; and the mouseup that lands a
        // wire must never read as "dive into the dimension".
        if (isWiringConnection() || wasRecentWireDrop()) {
          return;
        }
        const target = event.target as HTMLElement;
        if (!target.closest("input, button, .react-flow__handle")) {
          enterPocket(pocket.id);
        }
      }}
    >
      {/* The window: same inset-frame construction as a recipe card (a real
          border would push the rows off the grid), painted star-field purple. */}
      <div
        data-node-glance-root=""
        className="relative bg-[#3b2d52] shadow-[inset_0_0_0_2px_#241b33,inset_4px_4px_0_#5e4a85,inset_-4px_-4px_0_#1a1326]"
      >
        {/* Zoomed out, the card is a star on purple — a pocket, not a machine.
            Hovering opens the same I/O reveal a machine card gives: name bar
            plus needs → offers, scaled to screen size by the glance CSS. */}
        <NodeGlanceText text="✦" className={INK_MUTED} />
        <PocketGlanceReveal name={pocket.name} inputs={inputs} outputs={outputs} />
        <div className="px-2">
          {/* One head row, exactly two cells tall, like every machine card. */}
          <div className="grid h-[40px] min-w-0 grid-cols-[24px_24px_24px_24px_minmax(0,1fr)] items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                enterPocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
              title="Open this pocket dimension (or double-click the card)"
              aria-label={`Open pocket ${pocket.name}`}
            >
              <Expand aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                duplicatePocket();
              }}
              className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
              title="Clone this pocket dimension (everything inside comes along)"
              aria-label={`Clone pocket ${pocket.name}`}
            >
              <Copy aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                saveAsBlueprint();
              }}
              className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
              title={`Save "${pocket.name}" to my blueprints (sign in required)`}
              aria-label={`Save pocket ${pocket.name} as a blueprint`}
            >
              <Save aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                dissolvePocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
              title="Unpack: spill everything back onto this board"
              aria-label={`Unpack pocket ${pocket.name}`}
            >
              <PackageOpen aria-hidden className="h-3.5 w-3.5" />
            </button>
            {draftName === undefined ? (
              <div
                className="minecraft-title flex h-6 min-w-0 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[13px] leading-[18px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]"
                title={`${pocket.name} — double-click the name to rename, double-click the card to open`}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setDraftName(pocket.name);
                }}
              >
                <span className="mx-auto min-w-0 truncate">✦ {pocket.name}</span>
              </div>
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
                className="nodrag h-6 min-w-0 border-2 border-[#8d6fd1] bg-[#241b33] px-1 text-[13px] leading-none text-white outline-none"
              />
            )}
          </div>

          {/* The rails ARE the node, exactly like a machine card: what the
              dimension needs from outside on the left, what it offers on the
              right. Every row is a wireable port. */}
          {inputs.length === 0 && outputs.length === 0 ? (
            <div className={`flex h-[40px] items-center justify-center text-[10px] ${INK_MUTED}`}>
              self-contained — nothing crosses the boundary
            </div>
          ) : (
            <div
              className={[
                "flex items-start gap-1",
                inputs.length > 0 && outputs.length > 0
                  ? "justify-between"
                  : outputs.length > 0
                    ? "justify-end"
                    : "justify-start",
              ].join(" ")}
            >
              <PocketPortRail nodeId={pocket.id} side="input" ports={inputs} />
              {inputs.length > 0 && outputs.length > 0 ? (
                <div
                  className={`flex w-4 shrink-0 items-center justify-center self-stretch text-[15px] font-black ${INK_MUTED}`}
                >
                  →
                </div>
              ) : null}
              <PocketPortRail nodeId={pocket.id} side="output" ports={outputs} />
            </div>
          )}

          {/* The stat footer, pocket edition. */}
          <div
            className={`flex h-[40px] min-w-0 items-center justify-center gap-2 border-t border-[#5e4a85] text-[11px] leading-4 ${INK_MUTED}`}
          >
            <span className="truncate">
              {summary
                ? `${summary.machineCount}× ${summary.machineCount === 1 ? "machine" : "machines"} · ${summary.memberCount} ${summary.memberCount === 1 ? "card" : "cards"} inside`
                : "pocket dimension"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering while
// its wrapper is translated (see RecipeNode for the long version).
export const PocketNode = memo(
  PocketNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/**
 * The zoomed-out hover reveal, pocket edition: the machine card's glance
 * panel in purple. Pure CSS shows it (globals.css `.glance-io`) only at the
 * glance detail level on hover, scaled to screen size — the panel is in the
 * DOM from the start, so hovering never rebuilds the board. `absolute
 * inset-0` like every glance layer: no say in the card's size, invisible to
 * the router.
 */
function PocketGlanceReveal({
  name,
  inputs,
  outputs,
}: {
  name: string;
  inputs: PocketPortSummary[];
  outputs: PocketPortSummary[];
}) {
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center"
    >
      <span className="glance-io absolute left-1/2 top-full z-30 w-[560px] origin-top flex-col gap-2 border-2 border-[#241b33] bg-[#3b2d52] p-3 font-mono text-white shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
        <span className="minecraft-title flex h-8 min-w-0 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[16px] leading-[22px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]">
          <span className="mx-auto min-w-0 truncate">✦ {name}</span>
        </span>
        {inputs.length > 0 || outputs.length > 0 ? (
          <span className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
            <span className="flex min-w-0 flex-col gap-1">
              {inputs.map((port) => (
                <PocketGlanceIoRow key={`${port.kind}:${port.resourceId}`} port={port} />
              ))}
            </span>
            <span className={`flex items-start justify-center pt-2 text-[20px] font-black leading-6 ${INK_MUTED}`}>
              →
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              {outputs.map((port) => (
                <PocketGlanceIoRow key={`${port.kind}:${port.resourceId}`} port={port} />
              ))}
            </span>
          </span>
        ) : (
          <span className={`text-center text-[13px] ${INK_MUTED}`}>
            self-contained — nothing crosses the boundary
          </span>
        )}
      </span>
    </div>
  );
}

/** One chip of the pocket reveal, in the pocket's own chip clothes. */
function PocketGlanceIoRow({ port }: { port: PocketPortSummary }) {
  const rate = formatSlotRateOrNull(port.ratePerSecond, port.kind);
  return (
    <span className="pocket-port flex items-center gap-1.5 px-1 py-0.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
        <ResourceIcon
          resource={{ ...port, id: port.resourceId, amount: 1 }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={port.kind === "fluid" ? 50 : undefined}
          className={port.kind === "fluid" ? "!h-9 !w-9" : "!h-9 !w-9 origin-center scale-150"}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-bold leading-[17px] text-white">
          {port.displayName ?? port.resourceId}
        </span>
        {rate ? (
          <span className={`truncate text-[13px] leading-4 tabular-nums ${INK_MUTED}`}>{rate}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * One side of the rails: 140px chips in 40px rows with no gaps, the same
 * vertical rhythm as a machine card, so port centres land on grid lines.
 */
function PocketPortRail({
  nodeId,
  side,
  ports,
}: {
  nodeId: string;
  side: "input" | "output";
  ports: PocketPortSummary[];
}) {
  if (ports.length === 0) {
    return null;
  }

  return (
    <div className="flex w-[140px] shrink-0 flex-col justify-start gap-0 py-0">
      {ports.map((port) => (
        <PocketPortChip
          key={`${side}:${port.kind}:${port.resourceId}`}
          nodeId={nodeId}
          side={side}
          port={port}
        />
      ))}
    </div>
  );
}

/**
 * A pocket port chip: icon, name, rate — the same surface a machine port
 * shows, minus the machine-only health bar. The whole row is the React Flow
 * handle (drag to wire) and the edge anchor the router measures.
 */
function PocketPortChip({
  nodeId,
  side,
  port,
}: {
  nodeId: string;
  side: "input" | "output";
  port: PocketPortSummary;
}) {
  const isInput = side === "input";
  const handleId = makeResourceHandleId(side, { kind: port.kind, id: port.resourceId });
  const rate = formatSlotRateOrNull(port.ratePerSecond, port.kind);
  const name = port.displayName ?? port.resourceId;

  return (
    <div
      className="pocket-port relative flex h-[40px] w-full flex-none items-center gap-1 px-0.5 py-0"
      data-resource-edge-anchor="true"
      data-resource-node-id={nodeId}
      data-resource-handle-id={handleId}
      title={
        isInput
          ? `The dimension needs ${name} — drag to wire a supplier`
          : `The dimension offers ${name} — drag to wire a taker`
      }
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden">
        <ResourceIcon
          resource={{ ...port, id: port.resourceId, amount: 1 }}
          bare
          tooltip={false}
          showAmount={false}
          // Same crop trick as machine chips: item art carries baked-in
          // transparent padding, so items zoom and clip while fluids keep
          // their exact square.
          iconPixelSize={port.kind === "fluid" ? 50 : undefined}
          className={port.kind === "fluid" ? "" : "!h-7 !w-7 origin-center scale-150"}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center pr-0.5">
        <span className="block truncate text-[11px] font-bold leading-[13px] text-white">
          {name}
        </span>
        {rate ? (
          <span
            className={`block truncate text-[10px] leading-[12px] tabular-nums ${INK_MUTED} opacity-90`}
          >
            {rate}
          </span>
        ) : null}
      </span>
      <Handle
        id={handleId}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        data-resource-handle="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={handleId}
        title={`${isInput ? "Input" : "Output"}: ${name} — drag to wire`}
        className={[
          "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
          "!rounded-none !border-0 !bg-transparent !opacity-0",
          "cursor-crosshair",
        ].join(" ")}
      />
    </div>
  );
}
