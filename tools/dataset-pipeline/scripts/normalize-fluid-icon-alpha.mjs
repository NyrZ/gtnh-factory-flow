import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { PNG } from "pngjs";

/**
 * Make ghost fluids visible: raise the alpha of fluid icons that the game
 * rendered nearly transparent.
 *
 * The oracle exporter captures fluid icons exactly as the game draws them,
 * and the game draws gases at 10-30% opacity. NEI paints them over a light
 * grey slot where that still reads; the planner's board is dark, so Oxygen,
 * Hydrogen, Nitrogen and friends simply vanish. This pass rescales the alpha
 * channel of any FLUID icon whose most opaque pixel sits under the threshold,
 * so the brightest pixel lands near full opacity while the texture keeps its
 * relative translucency. Item icons are never touched: some are legitimately
 * translucent, and none of them hide behind a fluid's render alpha.
 *
 * Two modes:
 *
 * - In-place (default), for a dataset BUILD. Nothing has shipped yet, and a
 *   new dataset version gets fresh texture URLs anyway, so the files can be
 *   rewritten under their own names. generate-dataset.mjs runs this after the
 *   indexes are built and before recipes.json is compressed.
 *
 * - `--rename`, for a dataset that is ALREADY PUBLISHED. Textures are served
 *   `immutable, max-age=1yr`, so a browser that has seen the ghost keeps it
 *   for a year no matter what the file says now. The fixed icon therefore
 *   gets a NEW name (content-hash suffix, same length as the old one), the
 *   old file stays behind for stale caches, and every reference in the
 *   compressed artifacts is patched byte-for-byte - same-length names make
 *   that safe without parsing half a gigabyte of JSON.
 *
 * Usage: normalize-fluid-icon-alpha.mjs <dataset-dir> [--rename]
 */

const args = process.argv.slice(2);
const rename = args.includes("--rename");
const datasetDir = args.find((arg) => !arg.startsWith("--"));

if (!datasetDir || !fs.existsSync(datasetDir)) {
  throw new Error("Usage: normalize-fluid-icon-alpha.mjs <dataset-dir> [--rename]");
}

/** Below this max alpha (0.7) an icon is illegible on the dark board. */
const THRESHOLD_ALPHA = 179;
/** Rescale so the most opaque pixel lands here (0.95): visible, still a fluid. */
const TARGET_ALPHA = 242;

const renderedDir = path.join(datasetDir, "textures", "rendered");
const indexFiles = ["resource-index.json.gz", "recipe-index.json.gz"]
  .map((name) => path.join(datasetDir, name))
  .filter((file) => fs.existsSync(file));

if (indexFiles.length === 0) {
  throw new Error(
    `No resource-index.json.gz or recipe-index.json.gz in ${datasetDir}; ` +
      "run this after the indexes are built.",
  );
}
if (!fs.existsSync(renderedDir)) {
  console.log("No rendered texture directory; nothing to normalize.");
  process.exit(0);
}

// Every icon file any FLUID resource points at, wherever it appears: the
// resource catalog, recipe summaries, recipe map icons, machine handlers.
const fluidIconBasenames = new Set();
for (const file of indexFiles) {
  collectFluidIcons(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()));
}
console.log(`${fluidIconBasenames.size} fluid icon files referenced by ${datasetDir}.`);

const renames = new Map();
let normalized = 0;
let alreadyVisible = 0;
let missing = 0;
const report = [];

for (const basename of [...fluidIconBasenames].sort()) {
  const filePath = path.join(renderedDir, basename);
  if (!fs.existsSync(filePath)) {
    missing += 1;
    continue;
  }

  const png = PNG.sync.read(fs.readFileSync(filePath));
  let maxAlpha = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] > maxAlpha) {
      maxAlpha = png.data[i];
    }
  }
  if (maxAlpha === 0 || maxAlpha >= THRESHOLD_ALPHA) {
    alreadyVisible += 1;
    continue;
  }

  const gain = TARGET_ALPHA / maxAlpha;
  for (let i = 3; i < png.data.length; i += 4) {
    png.data[i] = Math.min(255, Math.round(png.data[i] * gain));
  }
  const buffer = PNG.sync.write(png);
  report.push(`${basename}: max alpha ${(maxAlpha / 255).toFixed(2)} -> 0.95`);

  if (!rename) {
    fs.writeFileSync(filePath, buffer);
    normalized += 1;
    continue;
  }

  const suffixMatch = basename.match(/^(.*-)[0-9a-f]{12}\.png$/);
  if (!suffixMatch) {
    // Without the hash suffix there is no same-length name to swap in, so the
    // byte patch cannot carry it. Fix the pixels anyway for uncached readers.
    console.warn(`No hash suffix on ${basename}; normalized in place instead of renaming.`);
    fs.writeFileSync(filePath, buffer);
    normalized += 1;
    continue;
  }

  const newBasename = `${suffixMatch[1]}${crypto
    .createHash("sha1")
    .update(buffer)
    .digest("hex")
    .slice(0, 12)}.png`;
  // The ghost file stays: a browser holding a cached recipe response may still
  // ask for the old name, and a missing icon is worse than a faint one.
  fs.writeFileSync(path.join(renderedDir, newBasename), buffer);
  renames.set(basename, newBasename);
  normalized += 1;
}

console.log(
  `Normalized ${normalized} fluid icons ` +
    `(${alreadyVisible} already visible, ${missing} missing files).`,
);
for (const line of report) {
  console.log(`  ${line}`);
}

if (renames.size > 0) {
  const artifacts = [
    "resource-index.json.gz",
    "recipe-index.json.gz",
    "recipe-lookup-index.json.gz",
    "recipes.json.gz",
    "recipes.json",
    ...listShardFiles(),
  ];
  for (const artifact of artifacts) {
    patchArtifact(path.join(datasetDir, artifact));
  }
}

function collectFluidIcons(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFluidIcons(entry);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (
    value.kind === "fluid" &&
    typeof value.iconPath === "string" &&
    value.iconPath.includes("/textures/rendered/")
  ) {
    fluidIconBasenames.add(path.posix.basename(value.iconPath));
  }
  for (const entry of Object.values(value)) {
    collectFluidIcons(entry);
  }
}

function listShardFiles() {
  const shardsDir = path.join(datasetDir, "recipes-shards");
  if (!fs.existsSync(shardsDir)) {
    return [];
  }
  return fs
    .readdirSync(shardsDir)
    .filter((name) => name.endsWith(".json.gz") || name.endsWith(".json"))
    .map((name) => path.posix.join("recipes-shards", name));
}

/**
 * Swap every renamed basename inside one artifact. Old and new names are the
 * same length, so the patch mutates the decompressed buffer in place; only an
 * artifact that actually changed is recompressed and rewritten.
 */
function patchArtifact(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const isGz = filePath.endsWith(".gz");
  const buffer = isGz ? zlib.gunzipSync(fs.readFileSync(filePath)) : fs.readFileSync(filePath);

  let replaced = 0;
  for (const [oldBasename, newBasename] of renames) {
    const needle = Buffer.from(oldBasename);
    const replacement = Buffer.from(newBasename);
    let position = 0;
    while ((position = buffer.indexOf(needle, position)) !== -1) {
      replacement.copy(buffer, position);
      position += needle.length;
      replaced += 1;
    }
  }
  if (replaced === 0) {
    return;
  }

  fs.writeFileSync(
    filePath,
    isGz ? zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_COMPRESSION }) : buffer,
  );
  console.log(`Patched ${replaced} references in ${path.relative(datasetDir, filePath)}.`);
}
