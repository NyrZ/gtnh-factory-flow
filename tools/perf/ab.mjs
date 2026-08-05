/**
 * Averages several stress runs into one row per scenario, so an A/B decision
 * rests on a mean rather than on whichever single sample came back first.
 *
 * Usage: node tools/perf/ab.mjs out-dir/label-1.json out-dir/label-2.json ...
 */
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const byScenario = new Map();
let label = "";
let counts;
for (const file of files) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  label = run.label;
  counts = run.counts;
  for (const row of run.results) {
    if (!byScenario.has(row.name)) byScenario.set(row.name, []);
    byScenario.get(row.name).push(row);
  }
}

const mean = (rows, key) => rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) / rows.length;
console.log(`\n${label} — mean of ${files.length} runs (${counts?.nodes} nodes / ${counts?.edges} edges DOM)`);
for (const [name, rows] of byScenario) {
  const fps = rows.map((row) => row.fps);
  console.log(
    `${name.padEnd(12)} fps=${mean(rows, "fps").toFixed(1).padStart(6)}  ` +
      `median=${mean(rows, "medianMs").toFixed(1).padStart(6)}ms  ` +
      `p95=${mean(rows, "p95Ms").toFixed(1).padStart(7)}ms  ` +
      `[${fps.join(", ")}]`,
  );
}
