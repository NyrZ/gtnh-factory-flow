import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

/**
 * What version the SERVER is running.
 *
 * The point of asking is that it can disagree with the page. A tab left open
 * across a deploy is running the old bundle and has no way to know; this is
 * how it finds out (see `useDeployedVersion`). Deliberately uncached, because
 * a cached answer would report the version of whenever the cache was filled,
 * which is exactly the stale reading it exists to detect.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
