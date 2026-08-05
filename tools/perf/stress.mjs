/**
 * Board stress harness.
 *
 * Seeds a plan into IndexedDB, reloads, then drives pan / zoom / node-drag /
 * hover while sampling rAF frame deltas and (optionally) the CDP CPU profiler.
 * Prints an FPS table plus the top self-time functions so a regression or a win
 * is a number, not a feeling.
 *
 * Usage:
 *   node tools/perf/stress.mjs --plan plan.json [--label before] [--profile 1]
 *                              [--throttle 1] [--headed 1]
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const PLAN_PATH = args.get("plan") ?? "plan.json";
const LABEL = args.get("label") ?? "run";
const BASE = args.get("base") ?? "http://localhost:3000";
const PROFILE = args.get("profile") === "1";
const THROTTLE = Number(args.get("throttle") ?? 1);
const HEADED = args.get("headed") === "1";
const ZOOM = args.get("zoom") ? Number(args.get("zoom")) : undefined;
const OUT_JSON = args.get("out");
const ONLY = args.get("only");
const BOARD_VIEW = args.get("boardView") ? JSON.parse(args.get("boardView")) : undefined;

const project = JSON.parse(readFileSync(PLAN_PATH, "utf8"));

const browser = await chromium.launch({
  headless: !HEADED,
  args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
// Let the dataset land before we swap the plan under it.
await page.waitForSelector(".react-flow", { timeout: 60_000 });
await page.waitForTimeout(6000);

await page.evaluate(async (plan) => {
  const DB_NAME = "gtnh-factory-flow-designs";
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("design-meta")) {
          db.createObjectStore("design-meta", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("design-plans")) {
          db.createObjectStore("design-plans", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const db = await open();
  const now = new Date().toISOString();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["design-meta", "design-plans"], "readwrite");
    transaction
      .objectStore("design-meta")
      .put({ id: plan.id, name: plan.name, createdAt: now, updatedAt: now });
    transaction.objectStore("design-plans").put({ id: plan.id, project: plan });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  localStorage.setItem("gtnh-factory-flow.active-design.v1", plan.id);
}, project);

if (BOARD_VIEW) {
  await page.evaluate((view) => {
    const raw = localStorage.getItem("gtnh-factory-flow-board-view");
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem(
      "gtnh-factory-flow-board-view",
      JSON.stringify({ ...current, ...view }),
    );
  }, BOARD_VIEW);
}

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 120_000 });
// Settle: dataset resolve, solver, first routing pass.
await page.waitForTimeout(12_000);

const counts = await page.evaluate(() => ({
  nodes: document.querySelectorAll(".react-flow__node").length,
  edges: document.querySelectorAll(".react-flow__edge").length,
}));
console.log(`[${LABEL}] mounted: ${counts.nodes} nodes, ${counts.edges} edges (DOM)`);

const cdp = await context.newCDPSession(page);
if (THROTTLE > 1) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
}

if (ZOOM !== undefined) {
  await page.evaluate((zoom) => {
    const viewport = document.querySelector(".react-flow__viewport");
    if (viewport) viewport.dispatchEvent(new Event("noop"));
    window.__setZoom = zoom;
  }, ZOOM);
}

// rAF sampler installed once; each scenario resets it.
await page.evaluate(() => {
  window.__frames = [];
  window.__sampling = false;
  const tick = (time) => {
    if (window.__sampling) window.__frames.push(time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await cdp.send("Performance.enable");
async function readMetrics() {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

async function measure(name, action) {
  const before = await readMetrics();
  await page.evaluate(() => {
    window.__frames = [];
    window.__sampling = true;
  });
  await action();
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    return window.__frames;
  });
  const after = await readMetrics();
  const delta = (key) => Number((((after[key] ?? 0) - (before[key] ?? 0)) * 1000).toFixed(0));
  const cost = {
    scriptMs: delta("ScriptDuration"),
    layoutMs: delta("LayoutDuration"),
    styleMs: delta("RecalcStyleDuration"),
    taskMs: delta("TaskDuration"),
    layoutCount: Math.round((after.LayoutCount ?? 0) - (before.LayoutCount ?? 0)),
    styleCount: Math.round((after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0)),
    nodes: Math.round(after.Nodes ?? 0),
  };
  const deltas = [];
  for (let i = 1; i < frames.length; i += 1) deltas.push(frames[i] - frames[i - 1]);
  if (deltas.length === 0) return { name, fps: 0, medianMs: 0, p95Ms: 0, worstMs: 0, frames: 0, ...cost };
  const sorted = [...deltas].sort((a, b) => a - b);
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
  return {
    name,
    fps: Number((1000 / mean).toFixed(1)),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
    p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    worstMs: Number(sorted[sorted.length - 1].toFixed(2)),
    frames: deltas.length,
    ...cost,
  };
}

const board = await page.$(".react-flow");
const box = await board.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function pan() {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.move(cx + Math.sin(step / 6) * 400, cy + Math.cos(step / 9) * 260);
  }
  await page.mouse.up();
}

async function zoom() {
  await page.mouse.move(cx, cy);
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, step % 20 < 10 ? -120 : 120);
    await page.waitForTimeout(16);
  }
}

async function dragNode() {
  const node = await page.$(".react-flow__node");
  if (!node) return;
  const nodeBox = await node.boundingBox();
  if (!nodeBox) return;
  const startX = nodeBox.x + nodeBox.width / 2;
  const startY = nodeBox.y + 12;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 0; step < 50; step += 1) {
    await page.mouse.move(startX + step * 6, startY + Math.sin(step / 5) * 60);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function hover() {
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.move(cx + Math.sin(step / 3) * 500, cy + Math.cos(step / 4) * 300);
    await page.waitForTimeout(20);
  }
}

async function idle() {
  await page.waitForTimeout(1500);
}

if (PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
  await cdp.send("Profiler.start");
}

const scenarios = [
  ["idle", idle],
  ["pan", pan],
  ["zoom", zoom],
  ["hover", hover],
  ["drag-node", dragNode],
];
const results = [];
for (const [name, action] of scenarios) {
  if (ONLY && name !== ONLY) continue;
  results.push(await measure(name, action));
}

let topFunctions = [];
if (PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTime = new Map();
  const total = profile.samples?.length ?? 0;
  const interval =
    profile.endTime && profile.startTime && total
      ? (profile.endTime - profile.startTime) / total / 1000
      : 0.25;
  for (const sampleId of profile.samples ?? []) {
    const node = byId.get(sampleId);
    if (!node) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || "(anonymous)"} @ ${(frame.url || "").split("/").pop()}:${frame.lineNumber}`;
    selfTime.set(key, (selfTime.get(key) ?? 0) + interval);
  }
  topFunctions = [...selfTime.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, ms]) => ({ name, ms: Number(ms.toFixed(1)) }));
}

console.log(`\n=== ${LABEL} (${counts.nodes} nodes / ${counts.edges} edges, throttle ${THROTTLE}x) ===`);
for (const row of results) {
  console.log(
    `${row.name.padEnd(12)} fps=${String(row.fps).padStart(6)}  median=${String(row.medianMs).padStart(7)}ms  p95=${String(row.p95Ms).padStart(7)}ms  worst=${String(row.worstMs).padStart(8)}ms  | script=${String(row.scriptMs).padStart(6)}ms style=${String(row.styleMs).padStart(6)}ms(${row.styleCount}) layout=${String(row.layoutMs).padStart(6)}ms(${row.layoutCount}) task=${String(row.taskMs).padStart(6)}ms`,
  );
}
if (topFunctions.length) {
  console.log("\ntop self-time:");
  for (const entry of topFunctions) {
    console.log(`  ${String(entry.ms).padStart(8)}ms  ${entry.name}`);
  }
}

if (OUT_JSON) {
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify({ label: LABEL, counts, results, topFunctions }, null, 2));
}

await browser.close();
