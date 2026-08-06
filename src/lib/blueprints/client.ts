"use client";

import type { BoardClipboardPayload } from "@/store/factory-store";
import type { BlueprintDetail, BlueprintListResponse, BlueprintSummary } from "./types";

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return body;
}

export async function listBlueprints(): Promise<BlueprintSummary[]> {
  const response = await fetch("/api/blueprints");
  const body = await parseJsonOrThrow<BlueprintListResponse>(response);
  return body.blueprints;
}

export async function saveBlueprint(
  name: string,
  payload: BoardClipboardPayload,
): Promise<BlueprintSummary> {
  const response = await fetch("/api/blueprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, payload }),
  });
  const body = await parseJsonOrThrow<{ blueprint: BlueprintSummary }>(response);
  return body.blueprint;
}

export async function getBlueprint(blueprintId: string): Promise<BlueprintDetail> {
  const response = await fetch(`/api/blueprints/${encodeURIComponent(blueprintId)}`);
  const body = await parseJsonOrThrow<{ blueprint: BlueprintDetail }>(response);
  return body.blueprint;
}

export async function deleteBlueprint(blueprintId: string): Promise<void> {
  const response = await fetch(`/api/blueprints/${encodeURIComponent(blueprintId)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: boolean }>(response);
}
