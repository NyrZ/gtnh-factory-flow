import { NextResponse } from "next/server";
import { boardSelectionPayloadSchema } from "@/lib/model/schemas";
import {
  BLUEPRINT_MAX_PER_USER,
  BLUEPRINT_NAME_MAX_LENGTH,
  BLUEPRINT_PAYLOAD_MAX_BYTES,
  type BlueprintListResponse,
} from "@/lib/blueprints/types";
import {
  checkRateLimit,
  getCommunityDb,
  getSessionUser,
  isCommunityConfigured,
} from "@/lib/server/community";
import {
  BLUEPRINT_SUMMARY_COLUMNS,
  BLUEPRINT_TABLE_MISSING_MESSAGE,
  isMissingBlueprintTable,
  rowToBlueprintSummary,
  type BlueprintRow,
} from "@/lib/server/blueprints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to use blueprints." }, { status: 401 });
  }

  const db = getCommunityDb();
  const { data, error } = await db
    .from("blueprints")
    .select(BLUEPRINT_SUMMARY_COLUMNS)
    .eq("user_id", sessionUser.id)
    .order("created_at", { ascending: false })
    .limit(BLUEPRINT_MAX_PER_USER);
  if (error) {
    return NextResponse.json(
      {
        error: isMissingBlueprintTable(error)
          ? BLUEPRINT_TABLE_MISSING_MESSAGE
          : "Blueprints could not be loaded.",
      },
      { status: 500 },
    );
  }

  const response: BlueprintListResponse = {
    blueprints: (data as BlueprintRow[]).map(rowToBlueprintSummary),
  };
  return NextResponse.json(response);
}

export async function POST(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to save blueprints." }, { status: 401 });
  }

  if (!(await checkRateLimit(`user:${sessionUser.id}`, "blueprint-save", 60, 60 * 60))) {
    return NextResponse.json(
      { error: "Blueprint save limit reached — try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, payload } = (body ?? {}) as { name?: unknown; payload?: unknown };
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || trimmedName.length > BLUEPRINT_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Blueprint names run 1–${BLUEPRINT_NAME_MAX_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (JSON.stringify(payload ?? null).length > BLUEPRINT_PAYLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "Blueprint is too large to save." }, { status: 413 });
  }

  const parsedPayload = boardSelectionPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return NextResponse.json({ error: "Blueprint payload is not valid." }, { status: 400 });
  }
  const captured = parsedPayload.data;
  if (captured.nodes.length + captured.storages.length + captured.pockets.length === 0) {
    return NextResponse.json({ error: "Blueprint has no cards in it." }, { status: 400 });
  }

  const db = getCommunityDb();
  const { count } = await db
    .from("blueprints")
    .select("id", { count: "exact", head: true })
    .eq("user_id", sessionUser.id);
  if ((count ?? 0) >= BLUEPRINT_MAX_PER_USER) {
    return NextResponse.json(
      { error: `Blueprint library is full (${BLUEPRINT_MAX_PER_USER}). Delete some first.` },
      { status: 409 },
    );
  }

  // Stats are always derived server-side from the validated payload.
  const { data, error } = await db
    .from("blueprints")
    .insert({
      user_id: sessionUser.id,
      name: trimmedName,
      payload: captured,
      node_count: captured.nodes.length,
      storage_count: captured.storages.length,
      edge_count: captured.edges.length,
      pocket_count: captured.pockets.length,
      machine_count: captured.nodes.reduce(
        (sum, node) => sum + Math.max(0, Math.round(node.machineCount)),
        0,
      ),
    })
    .select(BLUEPRINT_SUMMARY_COLUMNS)
    .single();
  if (error || !data) {
    return NextResponse.json(
      {
        error: isMissingBlueprintTable(error)
          ? BLUEPRINT_TABLE_MISSING_MESSAGE
          : "Blueprint could not be saved.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ blueprint: rowToBlueprintSummary(data as BlueprintRow) });
}
