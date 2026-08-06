import { NextResponse } from "next/server";
import type { BoardClipboardPayload } from "@/store/factory-store";
import { getCommunityDb, getSessionUser, isCommunityConfigured } from "@/lib/server/community";
import {
  BLUEPRINT_SUMMARY_COLUMNS,
  blueprintStorageErrorMessage,
  rowToBlueprintSummary,
  type BlueprintRow,
} from "@/lib/server/blueprints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ blueprintId: string }> };

/**
 * The full payload, fetched only when a blueprint is actually placed. The
 * owner always may; anyone may once it is published — a public blueprint IS
 * its payload. (The counted download path is POST [id]/download; this GET
 * stays count-free for owners placing their own work.)
 */
export async function GET(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  const { blueprintId } = await context.params;
  const db = getCommunityDb();
  // Ownership is the cookie's user id, never a client-supplied owner.
  const { data, error } = await db
    .from("blueprints")
    .select(`${BLUEPRINT_SUMMARY_COLUMNS},payload`)
    .eq("id", blueprintId)
    .or(`is_public.eq.true${sessionUser ? `,user_id.eq.${sessionUser.id}` : ""}`)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: blueprintStorageErrorMessage(error, "Blueprint could not be loaded.") },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Blueprint not found." }, { status: 404 });
  }

  const row = data as BlueprintRow & { payload: BoardClipboardPayload };
  return NextResponse.json({
    blueprint: { ...rowToBlueprintSummary(row, sessionUser?.id), payload: row.payload },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Cloud storage is not configured." }, { status: 503 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Sign in to use blueprints." }, { status: 401 });
  }

  const { blueprintId } = await context.params;
  const db = getCommunityDb();
  const { error } = await db
    .from("blueprints")
    .delete()
    .eq("id", blueprintId)
    .eq("user_id", sessionUser.id);
  if (error) {
    return NextResponse.json(
      { error: blueprintStorageErrorMessage(error, "Blueprint could not be deleted.") },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
