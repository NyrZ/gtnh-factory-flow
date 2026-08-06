"use client";

import { LoaderCircle, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { computeBlueprintIo } from "@/lib/blueprints/io-stats";
import type { EntryIcon } from "@/lib/community/types";
import { useBlueprintStore, type BlueprintSaveRequest } from "@/store/blueprint-store";
import { renderIoStats } from "./BlueprintPanel";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "./IconPicker";

/**
 * The one confirmation every pocket-to-blueprint path lands in: the pocket
 * card's save button, the shelf's share-a-pocket flow, and overwriting an
 * owned row. Mostly filled out already — the pocket's name, its needs and
 * makes, the machine count — plus an icon to wear on the shelf.
 */
export function BlueprintSaveDialog() {
  const request = useBlueprintStore((state) => state.saveRequest);
  if (!request) {
    return null;
  }

  // Keyed so switching targets never leaks a half-edited name across.
  return <SaveDialogBody key={request.blueprintId ?? "create"} request={request} />;
}

function SaveDialogBody({ request }: { request: BlueprintSaveRequest }) {
  const setSaveRequest = useBlueprintStore((state) => state.setSaveRequest);
  const save = useBlueprintStore((state) => state.save);
  const update = useBlueprintStore((state) => state.update);
  const [name, setName] = useState(request.name);
  const [icon, setIcon] = useState<EntryIcon | undefined>(request.icon);
  const [isPickingIcon, setPickingIcon] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const io = useMemo(() => computeBlueprintIo(request.payload), [request.payload]);
  const cardCount = request.payload.nodes.length + request.payload.storages.length;
  const machineCount = request.payload.nodes.reduce(
    (sum, node) => sum + Math.max(0, Math.round(node.machineCount)),
    0,
  );
  const isOverwrite = Boolean(request.blueprintId);

  const close = () => setSaveRequest(undefined);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setSaving(true);
    setError(undefined);
    const ok = request.blueprintId
      ? await update(request.blueprintId, {
          name: trimmed,
          payload: request.payload,
          icon: icon ?? null,
        })
      : await save(trimmed, request.payload, icon);
    setSaving(false);
    if (ok) {
      close();
    } else {
      setError(useBlueprintStore.getState().error ?? "Saving failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-neutral-950/50 p-4">
      <div className="w-full max-w-sm rounded-[6px] border border-neutral-600 bg-[#25272c] p-3 text-neutral-100 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Save className="h-4 w-4" />
            {isOverwrite ? "Overwrite this blueprint" : "Save as a blueprint"}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isOverwrite ? (
          <p className="mb-2 text-[11px] leading-relaxed text-amber-300">
            The picked pocket replaces this blueprint&apos;s contents. Its votes, downloads and
            publish state stay.
          </p>
        ) : null}

        <div className="flex items-center gap-1.5">
          <EntryIconSlot
            icon={icon}
            editable
            onEdit={() => setPickingIcon(true)}
            className="!h-8 !w-8"
          />
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void commit();
              }
            }}
            placeholder="Blueprint name"
            className="h-8 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-[13px] outline-none focus:border-cyan-600"
          />
        </div>

        <div className="mt-2 rounded-[4px] border border-neutral-700 bg-[#17191d] p-2">
          <p className="text-[10px] tabular-nums text-neutral-400">
            {cardCount} cards inside, {machineCount} machines configured.
          </p>
          <div className="mt-1 max-h-44 overflow-y-auto">
            {renderIoStats(io.needs, io.outputs) ?? (
              <p className="text-[10px] text-neutral-500">No outside needs or leftovers.</p>
            )}
          </div>
        </div>

        {error ? <p className="mt-2 text-[11px] text-red-400">{error}</p> : null}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-[4px] border border-neutral-700 bg-[#17191d] px-3 text-xs text-neutral-300 hover:border-neutral-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || !name.trim()}
            onClick={() => void commit()}
            className="flex h-8 items-center gap-1.5 rounded-[4px] border border-cyan-700 bg-cyan-600 px-3 text-xs font-medium text-white enabled:hover:bg-cyan-500 disabled:opacity-50"
          >
            {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {isOverwrite ? "Overwrite" : "Save to my shelf"}
          </button>
        </div>
      </div>
      {isPickingIcon ? (
        <IconPicker
          title="Pick this blueprint's icon"
          suggestions={iconSuggestionsFromStats(io.needs, io.outputs)}
          onPick={(picked) => {
            setIcon(picked);
            setPickingIcon(false);
          }}
          onClear={
            icon
              ? () => {
                  setIcon(undefined);
                  setPickingIcon(false);
                }
              : undefined
          }
          onClose={() => setPickingIcon(false)}
        />
      ) : null}
    </div>
  );
}
