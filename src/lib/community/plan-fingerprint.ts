/**
 * A small stable fingerprint of what a plan's board IS.
 *
 * It covers the content someone actually rebuilds in game — recipes, nodes,
 * wires, storages, pockets, annotations, fuel settings — and deliberately
 * ignores what the plan is CALLED (name, description, icon), how it is
 * dressed (view), and its bookkeeping (id, metadata). Renaming your copy of a
 * setup or picking it a new icon is not a change the "reset to the posted
 * version" button should wake up for; moving a machine is.
 *
 * Stamped into `metadata.communityFingerprint` whenever a plan is downloaded
 * from or posted to the network, and compared against the live board to
 * decide whether that board has drifted from its post. Not a security hash:
 * a 53-bit content checksum whose only job is telling "same board" from
 * "changed board".
 */

const EXCLUDED_TOP_LEVEL_KEYS = new Set(["id", "name", "description", "icon", "view", "metadata"]);

/**
 * Store objects are replaced, never mutated, so a plan object's fingerprint
 * is computed once however many places ask (the reset button and the
 * address-bar sync both do, on every edit).
 */
const fingerprintCache = new WeakMap<object, string>();

export function planContentFingerprint(plan: unknown): string {
  if (typeof plan !== "object" || plan === null) {
    return "";
  }

  const cached = fingerprintCache.get(plan);
  if (cached !== undefined) {
    return cached;
  }

  const record = plan as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!EXCLUDED_TOP_LEVEL_KEYS.has(key)) {
      content[key] = record[key];
    }
  }

  const fingerprint = hash53(stableStringify(content)).toString(36);
  fingerprintCache.set(plan, fingerprint);
  return fingerprint;
}

/**
 * JSON.stringify with every object's keys sorted, so the same plan produces
 * the same text whether it just came off the wire or has lived in the store
 * all session. `undefined` values drop exactly as JSON.stringify drops them,
 * so an absent key and an undefined key read the same.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry ?? null)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      parts.push(`${JSON.stringify(key)}:${stableStringify(entry)}`);
    }
  }
  return `{${parts.join(",")}}`;
}

/** cyrb53: a well-mixed 53-bit string hash, tiny and dependency-free. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
