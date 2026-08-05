/**
 * Pixel diff between two screenshot directories, so "it still looks the same"
 * is a number rather than an impression.
 *
 * Usage: node tools/perf/diff-shots.mjs before/ after/ [--out diff/]
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [beforeDir, afterDir] = process.argv.slice(2, 4);
const outFlag = process.argv.indexOf("--out");
const outDir = outFlag > 0 ? process.argv[outFlag + 1] : undefined;
if (outDir) mkdirSync(outDir, { recursive: true });

const names = readdirSync(beforeDir).filter((name) => name.endsWith(".png"));
for (const name of names) {
  let before;
  let after;
  try {
    before = PNG.sync.read(readFileSync(join(beforeDir, name)));
    after = PNG.sync.read(readFileSync(join(afterDir, name)));
  } catch {
    console.log(`${name.padEnd(26)} MISSING on one side`);
    continue;
  }
  if (before.width !== after.width || before.height !== after.height) {
    console.log(`${name.padEnd(26)} size differs ${before.width}x${before.height} vs ${after.width}x${after.height}`);
    continue;
  }

  const diff = new PNG({ width: before.width, height: before.height });
  let changed = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const delta =
      Math.abs(before.data[index] - after.data[index]) +
      Math.abs(before.data[index + 1] - after.data[index + 1]) +
      Math.abs(before.data[index + 2] - after.data[index + 2]);
    // A few levels of difference is antialiasing, not a visible change.
    const isChanged = delta > 24;
    if (isChanged) changed += 1;
    diff.data[index] = isChanged ? 255 : before.data[index] * 0.25;
    diff.data[index + 1] = isChanged ? 0 : before.data[index + 1] * 0.25;
    diff.data[index + 2] = isChanged ? 255 : before.data[index + 2] * 0.25;
    diff.data[index + 3] = 255;
  }
  const total = before.width * before.height;
  console.log(
    `${name.padEnd(26)} ${((changed / total) * 100).toFixed(3)}% of pixels differ (${changed}/${total})`,
  );
  if (outDir) writeFileSync(join(outDir, name), PNG.sync.write(diff));
}
