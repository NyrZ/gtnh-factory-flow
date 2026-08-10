"use client";

import { Handle, Position, useStoreApi, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import type {
  FactoryStorage,
  StorageDrainMode,
  StorageThroughputResult,
} from "@/lib/model/types";
import { makeResourceKey, trimTrailingDecimalZeros } from "@/lib/model";
import { isDrainRole, type StorageRole } from "@/lib/model/storage-role";
import { rateUnitMultiplier, rateUnitSuffix } from "@/lib/model/rate-unit";
import { FLUID_ICON_SCALE, ResourceIcon, getFallbackFluidColor } from "@/components/nei/ResourceIcon";
import { NodeGlanceIcon } from "./NodeGlance";
import { isWiringConnection } from "./connection-drag";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { useFactoryStore } from "@/store/factory-store";
import { useBoardView } from "./board-view";
import { formatSlotRate } from "./flow-explainers";
import { makeResourceHandleId } from "./resource-handles";
import { GT_NODE_COLORS } from "./node-colors";
import { getPaintBrushCursor } from "./paint-cursor";

export interface StorageNodeData extends Record<string, unknown> {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
}

export type StorageFlowNode = Node<StorageNodeData, "storageNode">;

/**
 * The header word, the tone it wears, and the one line the hover leads with.
 *
 * A source and a drain are the plan's BOUNDARY: they break conservation on
 * purpose, one inventing its resource and one swallowing whatever arrives, and
 * they are the only cards on the board still allowed to. A buffer does no such
 * thing, so it must never wear the same badge. See `storage-role.ts`.
 */
const ROLE_PRESENTATION: Record<
  StorageRole,
  { word: string; boundary: boolean; line: string }
> = {
  source: {
    word: "SOURCE",
    boundary: true,
    line: "Nothing feeds this, so it never runs out. Whatever leaves it counts as something the plan imports.",
  },
  product: {
    word: "PRODUCT",
    boundary: true,
    line: "The thing this factory is for. It asks the machine feeding it for everything that machine can make.",
  },
  byproduct: {
    word: "BYPRODUCT",
    boundary: true,
    line: "Catches what is left over. It asks for nothing, so the pace is set by whatever really wants the output.",
  },
  buffer: {
    word: "BUFFER",
    boundary: false,
    line: "Fed and drawn from, so it passes on exactly what its takers pull. It is not a place to dump a surplus.",
  },
  idle: {
    word: "STORAGE",
    boundary: false,
    line: "Unwired. Feed it to make a product, draw from it to make a source, or both for a buffer.",
  },
};

// Inline (not utility classes) so React Flow's own handle stylesheet can
// never reposition or resize these: the well is the wire zone, exactly.
const WELL_HANDLE_BASE: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: "50%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  margin: 0,
  transform: "none",
  borderRadius: 0,
  border: "none",
  background: "transparent",
  opacity: 0,
  zIndex: 30,
};
const WELL_HANDLE_LEFT: CSSProperties = { ...WELL_HANDLE_BASE, left: 0, right: "auto" };
const WELL_HANDLE_RIGHT: CSSProperties = { ...WELL_HANDLE_BASE, left: "auto", right: 0 };

/**
 * Item icon box on the card face; fluids invert FLUID_ICON_SCALE to match.
 * Square and fixed, NOT the well's full box: the well is flexible (a drain
 * spends a row on its mode) and stretching a sprite to a non-square hole
 * distorts it.
 */
const CARD_ICON_PX = 60;
/**
 * Plain-fluid swatches draw edge to edge — no baked-in margin like item
 * sprites — so undiluted they brush right up against the name above and the
 * net line below. Shrink only them; items keep the full box.
 */
const FLUID_BREATHE_PX = 8;
/** Oversized glance icon (zoomed out) — deliberately larger than the card. */
const GLANCE_ICON_PX = 168;

/**
 * Rendered and atlas item sprites carry a big baked-in transparent margin —
 * the art never fills more than ~51% of the canvas (measured across the
 * rendered set). Drawing the sprite at 2× the box and letting the icon's
 * overflow-hidden crop the empty margin makes the art itself fill the box.
 * Same convention as ResourceIcon's default calc(200% - 8px) slot rendering.
 */
const ITEM_SPRITE_MARGIN_SCALE = 2;

/** The sprite size that makes the ART fill a box of the given size. */
function storageIconPixelSize(
  boxPx: number,
  storage: Pick<FactoryStorage, "kind" | "iconPath" | "iconAtlas">,
): number {
  const isPlainFluid = storage.kind === "fluid" && !storage.iconPath && !storage.iconAtlas;
  if (isPlainFluid) {
    // The fluid swatch insets itself to FLUID_ICON_SCALE of the request.
    return Math.round(boxPx / FLUID_ICON_SCALE);
  }
  if (storage.kind === "item") {
    return boxPx * ITEM_SPRITE_MARGIN_SCALE;
  }
  // Aspects (and anything else) draw edge-to-edge already — no margin to crop.
  return boxPx;
}

function StorageNodeComponent({ data, selected }: NodeProps<StorageFlowNode>) {
  const { storage, result } = data;
  const reactFlowStore = useStoreApi();
  // The invisible wire handles blanket the card body, and React Flow does not
  // select a node for clicks that land on a handle - so a plain click (no
  // drag) selects explicitly, keeping Delete-to-remove reachable for tanks.
  const selectOnHandleClick = () => {
    reactFlowStore.getState().addSelectedNodes([storage.id]);
  };
  const recipeSearch = useFactoryStore((state) => state.highlightSearch);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const setHoveredStorageResourceKey = useFactoryStore(
    (state) => state.setHoveredStorageResourceKey,
  );
  // Read off this drawer's own wires rather than through getStorageRoles: the
  // whole-board map would make every drawer re-render whenever any OTHER
  // drawer's wiring changed, and cards are the hot path. Same rule, one card.
  const role = useFactoryStore((state): StorageRole => {
    let hasIn = false;
    let hasOut = false;
    for (const edge of state.project.edges) {
      if (edge.target === storage.id) {
        hasIn = true;
      } else if (edge.source === storage.id) {
        hasOut = true;
      }
      if (hasIn && hasOut) {
        break;
      }
    }
    return hasIn
      ? hasOut
        ? "buffer"
        : storage.drainMode === "byproduct"
          ? "byproduct"
          : "product"
      : hasOut
        ? "source"
        : "idle";
  });
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  // Lit when a hovered port/label pulls this buffer into its flow scope.
  const isFlowScopeLit = useFactoryStore((state) =>
    Boolean(state.hoveredFlowScope?.nodes[storage.id]),
  );
  const isHighlighted =
    hoveredStorageResourceKey === resourceKey ||
    (hoveredFlowResourceKey ?? selectedFlowResourceKey) === resourceKey;
  const isSearchHighlighted = storageMatchesSearch(storage, recipeSearch);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const { glanceMode } = useBoardView();
  const paintCursor =
    nodeColorPaintMode !== undefined
      ? getPaintBrushCursor(
          nodeColorPaintMode ? GT_NODE_COLORS[nodeColorPaintMode].swatch : undefined,
        )
      : undefined;
  const net = result?.netPerSecond ?? 0;
  const title = storage.displayName ?? storage.resourceId;
  const isTank = storage.kind === "fluid";
  const isPlainFluid = isTank && !storage.iconPath && !storage.iconAtlas;
  // The whole card wears the item's colour: paint (colorTag) wins if the user
  // painted it, then the item's dominant sprite colour, then the same fallback
  // colour the fluid swatch itself renders in, then neutral steel.
  const tint =
    (storage.colorTag ? GT_NODE_COLORS[storage.colorTag].swatch : undefined) ??
    storage.dominantColor ??
    storage.iconAtlas?.dominantColor ??
    (isTank ? getFallbackFluidColor(storage.resourceId) : "#8a93a6");
  const borderColor = `color-mix(in srgb, ${tint} 55%, #262b34)`;
  const inputHandleId = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const outputHandleId = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });

  return (
    <div
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      className={[
        "group relative text-[#e8e9ee]",
        selected ? "ring-2 ring-purple-500" : "",
        isFlowScopeLit && !isHighlighted ? "flow-scope-glow" : "",
        isHighlighted ? "resource-glow" : "",
      ].join(" ")}
      style={paintCursor ? { cursor: paintCursor } : undefined}
    >
      {/* Wires dock anywhere on the card's PERIMETER — the anchors span the
          whole card, and the router already picks the best side. */}
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={outputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <div
        // Glance root is the CARD, not the wrapper: the tinted frame stays,
        // and only what is written on it goes. A copper drawer zoomed out
        // still reads as a copper-coloured card.
        data-node-glance-root=""
        className={[
          // Six cells by seven, fixed. Wires dock on the card's perimeter, so
          // an off-grid edge would mean off-grid endpoints.
          "storage-node-card relative flex h-[140px] w-[120px] flex-col p-1",
          isHighlighted || isSearchHighlighted ? "brightness-125 saturate-150" : "",
        ].join(" ")}
      >
        {/* The SHAPE, on its own layer rather than on the card.
            Two reasons it cannot live on the card div. The glance icon is
            deliberately bigger than the card and spills past the frame, and a
            clip-path on the card would cut it off. And an octagon needs its
            outline drawn on the diagonals, which a clipped `border` cannot do:
            the border paints first and the clip then removes it. So the outer
            span is the border colour, the inner one is the fill inset by 2px,
            and both carry the same clip - which leaves a real 2px edge all the
            way round whatever the silhouette is. */}
        <span
          aria-hidden
          data-storage-shape={role}
          className="storage-shape pointer-events-none absolute inset-0"
          style={{ background: borderColor }}
        >
          <span
            className="storage-shape-fill absolute inset-[2px]"
            style={{
              background: `color-mix(in srgb, ${tint} 24%, #101318)`,
              boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.08), inset -2px -2px 0 rgba(0,0,0,0.45)",
            }}
          />
        </span>
        <NodeGlanceIcon tileTint={tint}>
          {/* Deliberately bigger than the card it sits on (w-[140px]).
              Zoomed out, WHAT is in the drawer is the only thing worth
              reading, and a sprite confined inside the frame is a few pixels
              on screen. Nothing clips it — the card sets no overflow — so it
              spills a little past the frame and reads as the node's identity
              rather than as its contents. Node SIZE is untouched, which is
              what the router cares about. */}
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            showAmount={false}
            bare
            iconPixelSize={storageIconPixelSize(GLANCE_ICON_PX, storage)}
            className="!h-[168px] !w-[168px]"
          />
          {glanceMode === "identity" ? (
            // The hover reveal, same machinery as the recipe cards' (see
            // GlanceIdentityLayer): in the DOM from the start, pure CSS shows
            // it on hover at the glance step and scales it to SCREEN size.
            // A drawer has exactly two facts worth revealing: what it holds
            // and how fast it is filling or draining.
            <span className="glance-io absolute left-1/2 top-full z-30 w-[320px] origin-top flex-col gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-82)] p-3 shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
              <span className="minecraft-title flex h-8 min-w-0 items-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 text-[16px] leading-[22px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]">
                <span className="mx-auto min-w-0 truncate">{title}</span>
              </span>
              <span
                className={[
                  "text-center text-[24px] font-black leading-7 tabular-nums",
                  net > 0.005
                    ? "text-[var(--mc-good)]"
                    : net < -0.005
                      ? "text-[var(--mc-bad)]"
                      : "text-[var(--mc-ink-muted)]",
                ].join(" ")}
              >
                {net >= 0 ? "+" : ""}
                {formatCompactRate(net, storage.kind)}
              </span>
            </span>
          ) : null}
        </NodeGlanceIcon>
        {/* The content carries the SAME silhouette as the frame. Without it
            the header and the mode button paint their own square backgrounds
            straight through the cut corners, and the card reads as a rectangle
            wearing an octagon. The glance icon stays outside this wrapper on
            purpose: it is deliberately bigger than the card and spills past
            the frame, which a clip would eat. */}
        <div
          data-storage-shape={role}
          className="storage-shape-content relative z-10 flex min-h-0 flex-1 flex-col"
        >
          <StorageHeader storageId={storage.id} isTank={isTank} tint={tint} role={role} />
        {/* The name sits ABOVE the item, not in the header — the header
            carries the setting word; this line says what is inside. */}
        <div
          title={title}
          className="minecraft-title relative z-10 h-4 truncate px-1 text-center text-[10px] leading-4"
        >
          {title}
        </div>
        <MinecraftTooltip content={renderStorageHoverContent(storage, role)}>
          {/* The icon well is the wire zone: drag from its left/right half
              to pull a wire. Everything around it - header, frame, name,
              net line - is plain card, so grabbing the border moves the
              node. The handles carry inline styles pinned to the well box;
              stylesheet !important wars once let them blanket the whole
              card and swallow the header buttons.
              The well is also the resource-hover trigger — the ITEM lights
              the flow, not the card around it. Wiring is a mode; a held
              wire must not also be lighting up cards. */}
          <div
            // Flexible, not fixed: the mode pill only exists on a drain, and
            // the well simply takes whatever height is left over either way.
            className="relative mx-auto min-h-0 w-full flex-1"
            onMouseEnter={() =>
              isWiringConnection() ? undefined : setHoveredStorageResourceKey(resourceKey)
            }
            onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
          >
            <Handle
              id={inputHandleId}
              type="target"
              position={Position.Left}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={inputHandleId}
              onClick={selectOnHandleClick}
              className="nodrag"
              style={WELL_HANDLE_LEFT}
            />
            <Handle
              id={outputHandleId}
              type="source"
              position={Position.Right}
              data-resource-handle="true"
              data-resource-node-id={storage.id}
              data-resource-handle-id={outputHandleId}
              onClick={selectOnHandleClick}
              className="nodrag"
              style={WELL_HANDLE_RIGHT}
            />
            {/* No wood face, no glass box: the dark tinted card IS the
                surface, and the item fills nearly the whole well. */}
            <div className="grid h-full w-full place-items-center">
              <ResourceIcon
                resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                showAmount={false}
                bare
                iconPixelSize={storageIconPixelSize(
                  isPlainFluid ? CARD_ICON_PX - FLUID_BREATHE_PX : CARD_ICON_PX,
                  storage,
                )}
                className="!h-[60px] !w-[60px]"
              />
            </div>
          </div>
        </MinecraftTooltip>
        <div
          className={[
            // No "Net" word: the sign and the colour already say it, and the
            // number is the thing worth reading.
            "storage-net-line relative z-10 h-4 text-center text-[13px] font-bold leading-4 tabular-nums",
            net > 0.005 ? "text-[#7ede96]" : net < -0.005 ? "text-[#ff9191]" : "text-[#a8afbb]",
          ].join(" ")}
        >
          {net >= 0 ? "+" : ""}
          {formatCompactRate(net, storage.kind)}
        </div>
        </div>
      </div>
    </div>
  );
}

// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering while
// its wrapper is translated (see RecipeNode for the long version).
export const StorageNode = memo(
  StorageNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

function StorageHeader({
  storageId,
  isTank,
  tint,
  role,
}: {
  storageId: string;
  isTank: boolean;
  tint: string;
  role: StorageRole;
}) {
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const noun = isTank ? "tank" : "drawer";
  const presentation = ROLE_PRESENTATION[role];

  return (
    <div
      // relative z-40: the invisible wire handles (z-30) blanket the card,
      // and without a higher stacking position they swallow every click
      // aimed at the delete/clone buttons underneath.
      className="storage-node-header relative z-40 flex h-5 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]"
      style={{
        borderColor: `color-mix(in srgb, ${tint} 55%, #262b34)`,
        background: `color-mix(in srgb, ${tint} 32%, #0a0c10)`,
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          deleteStorage(storageId);
        }}
        className="board-edit-chrome nodrag flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-red-700"
        title={`Delete ${noun}`}
        aria-label={`Delete ${noun}`}
      >
        {/* Drawn rather than a "-" glyph: at this size Monocraft's metrics
            baseline-align the hyphen low instead of centring it. */}
        <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
      </button>
      {/* The role, centred, and the only word on the card that is not the
          item's name. One colour for all four: the SILHOUETTE is what tells
          them apart now, so tinting the word too would be saying the same
          thing twice in a channel the item's own colour already owns.
          storage-node-word: calm mode leans on this hook too. */}
      <div
        title={presentation.line}
        className="storage-node-word pointer-events-none absolute inset-x-0 truncate text-center text-[8px] font-black tracking-[0.4px] text-[#e8e9ee] [text-shadow:1px_1px_0_rgba(0,0,0,0.65)]"
      >
        {presentation.word}
      </div>
      {isDrainRole(role) ? <DrainModeSwap storageId={storageId} role={role} /> : null}
    </div>
  );
}

/**
 * The one thing about a drawer you CHOOSE. Source and buffer are read off the
 * wiring and cannot be picked; which kind of end-of-the-line this is cannot be
 * read off anything, so it gets a control.
 *
 * Both halves are always shown rather than one label that toggles: the whole
 * point is that a reader who has never met the distinction can see there IS
 * one, and read both answers, without clicking anything.
 */
function DrainModeSwap({ storageId, role }: { storageId: string; role: StorageRole }) {
  const setStorageDrainMode = useFactoryStore((state) => state.setStorageDrainMode);
  const next: StorageDrainMode = role === "byproduct" ? "product" : "byproduct";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setStorageDrainMode(storageId, next);
      }}
      title={
        role === "byproduct"
          ? "Byproduct: this asks for nothing and catches what is left over. Switch it to a product to pull the machine feeding it flat out."
          : "Product: this asks the machine feeding it for everything it can make. Switch it to a byproduct to only catch the extra."
      }
      aria-label={`Switch to ${next}`}
      className="board-edit-chrome nodrag relative z-40 ml-auto flex h-4 w-4 shrink-0 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]"
    >
      <ArrowLeftRight aria-hidden className="h-2.5 w-2.5" />
    </button>
  );
}

/**
 * The hover: in/out totals, every feeder and drainer by name and rate, and a
 * one-line reading of what this buffer IS right now. Rates live here instead
 * of on the card — the card only carries the net.
 */
function renderStorageHoverContent(storage: FactoryStorage, role: StorageRole): ReactNode {
  const { project, lastResult } = useFactoryStore.getState();
  const nodesById = new Map(project.nodes.map((entry) => [entry.id, entry]));
  const recipesById = new Map(project.recipes.map((entry) => [entry.id, entry]));
  const storagesById = new Map((project.storages ?? []).map((entry) => [entry.id, entry]));
  const nameOf = (id: string): string => {
    const other = storagesById.get(id);
    if (other) {
      return `${other.displayName ?? other.resourceId} (buffer)`;
    }
    const node = nodesById.get(id);
    const recipe = node ? recipesById.get(node.recipeId) : undefined;
    return recipe?.machineType ?? recipe?.name ?? "Machine";
  };

  const feeders: Array<{ name: string; rate: number }> = [];
  const drainers: Array<{ name: string; rate: number }> = [];
  let inTotal = 0;
  let outTotal = 0;
  for (const edge of project.edges) {
    const rate = lastResult?.edges[edge.id]?.transferredPerSecond ?? 0;
    if (edge.target === storage.id) {
      inTotal += rate;
      feeders.push({ name: nameOf(edge.source), rate });
    } else if (edge.source === storage.id) {
      outTotal += rate;
      drainers.push({ name: nameOf(edge.target), rate });
    }
  }
  feeders.sort((left, right) => right.rate - left.rate);
  drainers.sort((left, right) => right.rate - left.rate);
  const net = inTotal - outTotal;

  const presentation = ROLE_PRESENTATION[role];

  const section = (label: string, rows: Array<{ name: string; rate: number }>) =>
    rows.length > 0 ? (
      <div className="mt-1.5 border-t border-white/15 pt-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        {rows.map((row, index) => (
          <div key={index} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-slate-300">{row.name}</span>
            <span className="shrink-0 tabular-nums text-slate-200">
              {formatSlotRate(row.rate, storage.kind)}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div className="w-60">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">In</span>
        <span className="font-semibold tabular-nums text-slate-200">
          {formatSlotRate(inTotal, storage.kind)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Out</span>
        <span className="font-semibold tabular-nums text-slate-200">
          {formatSlotRate(outTotal, storage.kind)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-slate-400">Net</span>
        <span
          className={[
            "font-semibold tabular-nums",
            net > 0.005 ? "text-emerald-300" : net < -0.005 ? "text-red-300" : "text-slate-200",
          ].join(" ")}
        >
          {net >= 0 ? "+" : ""}
          {formatSlotRate(net, storage.kind)}
        </span>
      </div>
      {section("Fed by", feeders)}
      {section("Drains to", drainers)}
      <div className="mt-1.5 border-t border-white/15 pt-1">
        <div
          className={[
            "text-[10px] font-black uppercase tracking-wide",
            presentation.boundary ? "text-amber-200" : "text-slate-400",
          ].join(" ")}
        >
          {presentation.boundary ? `∞ ${presentation.word}` : presentation.word}
        </div>
        <p className="text-[12px] leading-snug text-slate-300">{presentation.line}</p>
      </div>
    </div>
  );
}

function storageMatchesSearch(storage: FactoryStorage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${storage.displayName ?? ""} ${storage.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function formatCompactRate(value: number, kind: string): string {
  const scaled = value * rateUnitMultiplier();
  const unit = rateUnitSuffix(kind === "fluid").trimStart();
  const abs = Math.abs(scaled);

  if (!Number.isFinite(scaled) || abs < 0.005) {
    return `0${unit.startsWith("L") ? ` ${unit}` : unit}`;
  }
  const body =
    abs >= 1_000_000
      ? `${trimFlow(scaled / 1_000_000)}M`
      : abs >= 1_000
        ? `${trimFlow(scaled / 1_000)}k`
        : trimFlow(scaled);
  return unit.startsWith("L") ? `${body} ${unit}` : `${body}${unit}`;
}

function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimTrailingDecimalZeros(value.toFixed(decimals));
}
