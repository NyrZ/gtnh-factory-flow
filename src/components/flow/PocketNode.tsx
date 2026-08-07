"use client";

import { type Node, type NodeProps } from "@xyflow/react";
import { memo, useState } from "react";
import { Copy, Expand, PackageOpen, Save } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";

import { formatSlotRateOrNull } from "./flow-explainers";
import { OutputSocketRow, PORT_CHIP_WIDTH_CLASS, PortChip } from "./RecipeNode";
import type { RailPort } from "./node-verdict";
import { isWiringConnection, wasRecentWireDrop } from "./connection-drag";
import { useBoardView } from "./board-view";
import { NodeGlanceText } from "./NodeGlance";
import type { PocketPortSummary, PocketSummary } from "./pocket-summary";

export interface PocketNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  summary?: PocketSummary;
  /** The machine-card rails for this pocket, built once per project commit. */
  railPorts?: { inputs: RailPort[]; outputs: RailPort[] };
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
  const { pocket, summary, railPorts } = data;
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const enterPocket = useFactoryStore((state) => state.enterPocket);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  // Presentation mode: the head row loses its edit chrome, exactly as a
  // machine card's does. A rename half-typed when the mode flips goes back to
  // being a plain name bar rather than stranding an input on a calm board.
  const { calmMode } = useBoardView();
  const isRenaming = draftName !== undefined && !calmMode;

  const inputs = summary?.inputs ?? [];
  const outputs = summary?.outputs ?? [];
  // Pointing at a resource in the right-hand panel lights every card that
  // touches it. A pocket touches one whenever the resource crosses its
  // boundary, so it lights up on exactly the same terms as a machine card:
  // the dimension is a card on this board, and leaving it dark made a lit
  // board read as "nothing in here uses that".
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const litResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const isResourceHighlighted =
    litResourceKey !== undefined &&
    [...inputs, ...outputs].some(
      (port) => `${port.kind}:${port.resourceId}` === litResourceKey,
    );

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

  // Shelve the whole dimension: the save dialog opens
  // prefilled with the pocket's name and stat card, plus an icon to pick.
  const saveAsBlueprint = () => {
    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocket.id]);
    if (payload) {
      useBlueprintStore.getState().setSaveRequest({ payload, name: pocket.name });
    }
  };

  return (
    <div
      className={[
        "group relative font-mono text-white",
        selected ? "ring-2 ring-purple-500" : "",
        // On the shell, exactly where a machine card wears it, so the outline
        // frames the whole dimension rather than its inner window.
        isResourceHighlighted ? "resource-glow" : "",
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
          {/* One head row, exactly two cells tall, like every machine card:
              delete/clone/open on the left like every card's edit chrome, the
              name in the middle, and the two "send it away" actions — shelve
              to the shelf, unpack — on the right. Calm mode drops all six and
              gives the whole row to the name, the same trade a machine card
              makes; the row stays 40px either way, so the ports below keep
              their grid lines. */}
          <div
            className={[
              "grid h-[40px] min-w-0 items-center gap-1",
              calmMode
                ? "grid-cols-[minmax(0,1fr)]"
                : "grid-cols-[24px_24px_24px_minmax(0,1fr)_24px_24px]",
            ].join(" ")}
          >
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteBoardSelection({ nodeIds: [pocket.id] });
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-red-700"
                  title="Delete this pocket (everything inside goes with it)"
                  aria-label={`Delete pocket ${pocket.name}`}
                >
                  {/* Drawn rather than a "-" glyph: at this size Monocraft's
                      metrics baseline-align the hyphen low instead of centring. */}
                  <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
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
                    enterPocket(pocket.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title="Open this pocket dimension (or double-click the card)"
                  aria-label={`Open pocket ${pocket.name}`}
                >
                  <Expand aria-hidden className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
            {!isRenaming ? (
              <div
                className="minecraft-title flex h-6 min-w-0 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[13px] leading-[18px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]"
                title={
                  calmMode
                    ? `${pocket.name} — double-click the card to open`
                    : `${pocket.name} — double-click the name to rename, double-click the card to open`
                }
                onDoubleClick={
                  // Renaming is editing, so calm mode lets the double-click
                  // fall through to the card and just open the dimension.
                  calmMode
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        setDraftName(pocket.name);
                      }
                }
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
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveAsBlueprint();
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title={`Save "${pocket.name}" to my pocket shelf (sign in required)`}
                  aria-label={`Save pocket ${pocket.name} to my shelf`}
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
              </>
            ) : null}
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
              {/* The machine card's own rails, not a lookalike. A pocket is a
                  card on this board that takes things in and gives things
                  out, so it gets the same chips, the same bars, the same
                  HAND-FED mark and the same output couplings — and inherits
                  calm mode's trade with them for free. */}
              <PocketPortRail
                nodeId={pocket.id}
                side="input"
                ports={railPorts?.inputs ?? []}
                pending={pendingResourceConnection}
              />
              {inputs.length > 0 && outputs.length > 0 ? (
                <div
                  className={`flex w-4 shrink-0 items-center justify-center self-stretch text-[15px] font-black ${INK_MUTED}`}
                >
                  →
                </div>
              ) : null}
              <PocketPortRail
                nodeId={pocket.id}
                side="output"
                ports={railPorts?.outputs ?? []}
                pending={pendingResourceConnection}
              />
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
 * One side of a pocket's rails.
 *
 * The chips are the machine card's own: a pocket takes things in and gives
 * things out like any other card, so it earns the same bar, the same
 * HAND-FED mark, and the same output coupling telling you who is drinking.
 * Widths match a machine rail exactly (140px in, chip plus coupling out),
 * which is what keeps port centres on the grid lines the router measures.
 */
function PocketPortRail({
  nodeId,
  side,
  ports,
  pending,
}: {
  nodeId: string;
  side: "input" | "output";
  ports: RailPort[];
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"];
}) {
  if (ports.length === 0) {
    return null;
  }

  const isInput = side === "input";
  return (
    <div
      className={[
        "flex shrink-0 flex-col justify-start gap-0 py-0",
        isInput ? PORT_CHIP_WIDTH_CLASS : "w-[176px]",
      ].join(" ")}
    >
      {ports.map((port) =>
        isInput ? (
          <PortChip key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ) : (
          <OutputSocketRow key={port.key} nodeId={nodeId} port={port} pending={pending} />
        ),
      )}
    </div>
  );
}
