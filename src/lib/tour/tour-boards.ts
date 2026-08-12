"use client";

import { loadBiodieselDemoProject } from "@/examples";
import { downloadCommunityPlan, tagPlanWithCommunityId } from "@/lib/community/client";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { FactoryProject } from "@/lib/model/types";
import { closeBoundaries } from "@/lib/solver/close-boundaries";
import { getStorageRoles, type StorageRole } from "@/lib/model/storage-role";
import { deriveNodeVerdict } from "@/components/flow/node-verdict";
import { readWorkspaceViewSnapshot, writeWorkspaceView } from "@/lib/workspace-view";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore, type BoardFraming } from "@/store/factory-store";
import { subscribeTourState } from "./tour-state";

/**
 * Putting a factory on the board for a lesson to point at.
 *
 * The first lesson deliberately points at an empty board: it is about where
 * everything IS, and a plan under the spotlight is just noise. The second one
 * is about reading a plan, so it opens a real posted setup - the same titanium
 * line anyone can pull off the Setups shelf.
 *
 * It arrives as a design of its OWN, never over whatever the user had open.
 * Running the lesson twice reuses that tab rather than stacking copies up, and
 * closing it afterwards is the ordinary tab close.
 */
export const TOUR_PLAN_DESIGN_NAME = "Titanium Line (tour)";

/** The posted setup the second lesson walks. */
const TOUR_PLAN_COMMUNITY_ID = "bbb75edc-74fc-4fc5-b5a3-f44623c9a94b";

/**
 * The one in flight, if any.
 *
 * Opening the design is several awaits long, and "is it already there?" is
 * answered at the start of it. Two overlapping calls - which is exactly what
 * React's development double-invoke of an effect produces - would both find
 * nothing and both create one, so the second waits on the first instead.
 */
let opening: Promise<void> | undefined;

/**
 * The card the second lesson reads, and the two cards either side of it.
 *
 * Worked out lazily, the first time a step asks: picking needs the solver's
 * verdict on every card, and that has not run at the moment the plan lands.
 */
interface TourPicks {
  cardId: string;
  /** Who feeds it. A storage drawer first, if one does. */
  supplierIds: string[];
  /** Fed fine and still short: the one card where "build more" is the answer. */
  bottleneckId?: string;
  /** Short itself, several inputs low, one of them actually setting the pace. */
  blockedId?: string;
  /**
   * EVERY drawer of each job, not one specimen. A step that says "these are
   * your byproducts" and rings one of the two on the board has told a small
   * lie, and the reader is left wondering what is different about the other.
   */
  sourceDrawerIds: string[];
  productDrawerIds: string[];
  byproductDrawerIds: string[];
  bufferDrawerIds: string[];
}

let picks: TourPicks | undefined;

export function openTourPlan(): Promise<void> {
  opening ??= openPlan().finally(() => {
    opening = undefined;
  });
  return opening;
}

async function openPlan(): Promise<void> {
  const store = useDesignStore.getState();
  const existing = store.designs.find((design) => design.name === TOUR_PLAN_DESIGN_NAME);

  if (existing) {
    if (existing.id !== store.activeDesignId) {
      await store.switchToDesign(existing.id);
    }
    // Back to the posted original, every single time. The lesson reads real
    // numbers off this plan and half its steps are about a machine that is
    // short, so a tab somebody edited last week would quietly make the words
    // wrong. It is also how a re-upload of the setup reaches the lesson.
    useFactoryStore.getState().markHydratedProject(await fetchTourProject());
  } else {
    await store.importProjectAsDesign(await fetchTourProject(), TOUR_PLAN_DESIGN_NAME);
  }

  // A fresh plan is a fresh set of picks, and a fresh lab: the hydrate above
  // rebuilt the pristine board, so a stage or snapshot held over from an
  // earlier run would only lie about it.
  picks = undefined;
  drawerLabBaseline = undefined;
  labStageApplied = "baseline";
  moveCamera(() => {
    if (useFactoryStore.getState().project.nodes.length === 0) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes(undefined, WHOLE_BOARD);
    return true;
  });
}

/**
 * Both side columns out of the way for the duration of a canvas lesson, and
 * back exactly as they were afterwards.
 *
 * Not tidiness: room. The lesson's whole job is to magnify one card until it
 * fills the eye, and with both columns open the board is a third of the window
 * and there is nothing left to magnify INTO. What they were is captured, so a
 * lesson never decides someone's layout for them.
 */
let columnsBefore: { leftPanelOpen: boolean; rightPanelOpen: boolean } | undefined;

export function clearTheDecks(): void {
  const view = readWorkspaceViewSnapshot();
  columnsBefore ??= { leftPanelOpen: view.leftPanelOpen, rightPanelOpen: view.rightPanelOpen };
  writeWorkspaceView({ leftPanelOpen: false, rightPanelOpen: false });
}

export function restoreTheDecks(): void {
  if (columnsBefore) {
    writeWorkspaceView(columnsBefore);
    columnsBefore = undefined;
  }
}

/**
 * The tour's camera moves: the newest one wins, and it keeps trying until the
 * board is in a state where it can actually happen.
 *
 * Both halves were bugs. A move cannot fire the instant a step asks for it -
 * framing reads the cards the BOARD has laid out, and the plan is at least one
 * render behind the request - so every move waits a beat, which means a second
 * step can ask while the first is still pending. The whole-board fit is queued
 * the moment a plan lands, and pressing Next inside that window used to fire
 * the fly-to-one-card and then let the fit land on top and undo it.
 *
 * And a step reached before the download finished found no cards to frame, did
 * nothing, and never looked again: the close-up was simply skipped, and the
 * next four steps talked about a card the camera had never gone to.
 *
 * So intentions are numbered and retried. `run` reports whether it managed it;
 * a newer intention silently abandons every older one, mid-retry or not.
 */
let cameraIntent = 0;

const CAMERA_SETTLE_MS = 80;
/** About three seconds of patience, which covers a slow shelf download. */
const CAMERA_ATTEMPTS = 40;

function moveCamera(run: () => boolean) {
  const mine = ++cameraIntent;
  const attempt = (left: number) => {
    if (mine !== cameraIntent) {
      return;
    }
    if (run() || left <= 0) {
      return;
    }
    window.setTimeout(() => attempt(left - 1), CAMERA_SETTLE_MS);
  };
  window.setTimeout(() => attempt(CAMERA_ATTEMPTS), CAMERA_SETTLE_MS);
}

/**
 * The posted setup, or the packaged demo if the network is not having it.
 *
 * A lesson that cannot reach the shelf is still worth walking, and a board with
 * SOMETHING on it is the whole point of this module, so a failed download falls
 * back rather than leaving the tour pointing at nothing.
 */
async function fetchTourProject(): Promise<FactoryProject> {
  // Both routes go through closeBoundaries. Every plan worth teaching from was
  // authored before a plan had to declare its own edges, so its raw ingredients
  // arrive from nowhere and its product goes nowhere - and under the closed
  // rules that is a board of machines all reading NO WIRES at 0%. Nobody
  // learns to read a factory from a dead one. Closing it puts a SOURCE on
  // every raw input and a PRODUCT drawer on every finished output, which is
  // exactly what the lesson goes on to teach.
  try {
    const { plan } = await downloadCommunityPlan(TOUR_PLAN_COMMUNITY_ID);
    const project = parseFactoryProjectJson(
      JSON.stringify(tagPlanWithCommunityId(plan, TOUR_PLAN_COMMUNITY_ID)),
    );
    return closeBoundaries({ ...project, name: TOUR_PLAN_DESIGN_NAME });
  } catch {
    const project = loadBiodieselDemoProject();
    return closeBoundaries({ ...project, name: TOUR_PLAN_DESIGN_NAME });
  }
}

/**
 * Which card the lesson reads.
 *
 * The most wired-up machine that is NOT running flat out. Both halves matter: a
 * card with one wire has nothing to say about who asks and who gives, and a
 * card sitting at a happy 100% has nothing to say about why a number is low,
 * which is the whole second half of the lesson. A board where everything is
 * fine falls back to the busiest card and the lesson still reads.
 */
function pickCards(): TourPicks | undefined {
  const { project, lastResult: result } = useFactoryStore.getState();
  // Not until the plan has landed AND been solved. Picking off a half-arrived
  // board would answer, and the answer would be memoised: every card would look
  // like it was running flat out, so the "not flat out" half of the rule would
  // be decided by nothing. An undefined answer is retried on the next ask.
  if (!result || project.nodes.length === 0) {
    return undefined;
  }

  const machineIds = new Set(project.nodes.map((node) => node.id));

  // Picked by the STATE each step exists to teach, not by a general "most
  // interesting card" score. A BOTTLENECK is the one place where "build more
  // of this" is the answer; a BLOCKED card is the opposite lesson, and needs
  // several inputs for the point to be visible - that only one of the low ones
  // is actually setting the speed.
  const verdicts = new Map(
    project.nodes.map((node) => [node.id, deriveNodeVerdict(project, result, node.id)]),
  );
  const inputCount = (id: string) => Object.keys(result.nodes[id]?.inputs ?? {}).length;

  const bottleneckId = project.nodes.find(
    (node) => verdicts.get(node.id)?.kind === "bottleneck",
  )?.id;

  // A truly BLOCKED card first: the step's chip says BLOCKED and its copy says
  // the next machine goes short, neither of which is true of a starved card,
  // which only stands in when the board has nothing better to show.
  const blockedId = project.nodes
    .filter((node) => {
      const kind = verdicts.get(node.id)?.kind;
      return kind === "blocked" || kind === "starved";
    })
    .sort((a, b) => {
      const blockedFirst =
        Number(verdicts.get(b.id)?.kind === "blocked") -
        Number(verdicts.get(a.id)?.kind === "blocked");
      return blockedFirst || inputCount(b.id) - inputCount(a.id);
    })[0]?.id;

  const cardId = bottleneckId ?? blockedId ?? project.nodes[0]?.id;
  if (!cardId) {
    return undefined;
  }

  const roles = getStorageRoles(project);
  const drawersOf = (role: StorageRole) =>
    (project.storages ?? [])
      .filter((storage) => roles.get(storage.id) === role)
      .map((storage) => storage.id);

  // A drawer first among the suppliers: "this comes out of a pile you say you
  // have" is the one supply story the board cannot tell by itself.
  const supplierIds = project.edges
    .filter((edge) => edge.target === cardId)
    .map((edge) => edge.source)
    .sort((a, b) => Number(machineIds.has(a)) - Number(machineIds.has(b)));

  return {
    cardId,
    supplierIds,
    bottleneckId,
    blockedId,
    sourceDrawerIds: drawersOf("source"),
    productDrawerIds: drawersOf("product"),
    byproductDrawerIds: drawersOf("byproduct"),
    bufferDrawerIds: drawersOf("buffer"),
  };
}

function ensurePicks(): TourPicks | undefined {
  picks ??= pickCards();
  return picks;
}

/**
 * How a tour frames what it is talking about.
 *
 * A tour is allowed to magnify, which the board's own framing is not: "look at
 * THIS card" has to fill the eye, and at the board's 1:1 ceiling one card is a
 * third of the screen and the move reads as a pan. The inset is the strip the
 * step's own card sits in, kept clear and framed around, so the subject lands
 * beside the words about it rather than underneath them.
 */
const CLOSE_UP: BoardFraming = { maxZoom: 2, padding: 0.35, insetRight: 600 };
const GROUP_SHOT: BoardFraming = { maxZoom: 1.2, padding: 0.25, insetRight: 600 };
/** The opening wide shot. Never magnified, and it keeps the card's strip free. */
const WHOLE_BOARD: BoardFraming = { padding: 0.15, insetRight: 600 };

/**
 * Fly the camera in on that one card.
 *
 * The picks are resolved inside the move, not before it: a step reached while
 * the plan is still arriving would otherwise find no cards to choose between.
 */
export function focusTourCard(): void {
  moveCamera(() => {
    const cardId = ensurePicks()?.cardId;
    if (!cardId) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([cardId], CLOSE_UP);
    return true;
  });
}

/** Pull back until the card and everything feeding it are both on screen. */
export function frameTourSuppliers(): void {
  moveCamera(() => {
    const found = ensurePicks();
    if (!found) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([found.cardId, ...found.supplierIds], GROUP_SHOT);
    return true;
  });
}

function cardSelector(id: string | undefined): string | undefined {
  return id ? `.react-flow__node[data-id="${CSS.escape(id)}"]` : undefined;
}

/**
 * The read card as a live CSS selector, for a step that has to ring something
 * the board only rendered a moment ago and that has no anchor of its own.
 */
export function tourCardSelector(): string | undefined {
  return cardSelector(ensurePicks()?.cardId);
}

/** One part of it: the column of asks, the column of makes, the usage strip. */
export function tourCardPartSelector(part: "inputs" | "outputs"): () => string | undefined {
  return () => {
    const card = tourCardSelector();
    return card ? `${card} [data-tour-part="${part}"]` : undefined;
  };
}

export function tourCardUsageSelector(): string | undefined {
  const card = tourCardSelector();
  return card ? `${card} .flow-usage-stat` : undefined;
}

/** The first thing feeding it. */
export function tourSupplierSelector(): string | undefined {
  return cardSelector(ensurePicks()?.supplierIds[0]);
}

/**
 * The two machines the walk reads, and one drawer of each job.
 *
 * Each gets a selector AND a camera move, because a step that rings a card the
 * camera never flew to is pointing at nothing. A pick the board cannot supply
 * (no byproduct drawer on it, say) resolves to undefined, and the step's card
 * then sits in the middle of a dimmed screen with its words intact rather than
 * ringing the wrong thing.
 */
type MachineKey = "bottleneckId" | "blockedId";
type DrawerKey = "sourceDrawerIds" | "productDrawerIds" | "byproductDrawerIds" | "bufferDrawerIds";

function pickSelector(key: MachineKey): () => string | undefined {
  return () => cardSelector(ensurePicks()?.[key]);
}

function pickPartSelector(key: MachineKey, part: "inputs" | "outputs"): () => string | undefined {
  return () => {
    const card = cardSelector(ensurePicks()?.[key]);
    return card ? `${card} [data-tour-part="${part}"]` : undefined;
  };
}

function pickUsageSelector(key: MachineKey): () => string | undefined {
  return () => {
    const card = cardSelector(ensurePicks()?.[key]);
    return card ? `${card} .flow-usage-stat` : undefined;
  };
}

function framePick(key: MachineKey): () => void {
  return () => {
    moveCamera(() => {
      const id = ensurePicks()?.[key];
      if (!id) {
        return false;
      }
      useFactoryStore.getState().frameBoardNodes([id], CLOSE_UP);
      return true;
    });
  };
}

/**
 * Every drawer of one job at once, comma-joined: the overlay unions the
 * rectangles into a single hole (see `measureSelector`), so a board with two
 * byproducts rings both rather than picking a favourite.
 */
function drawerSelector(key: DrawerKey): () => string | undefined {
  return () => {
    const ids = ensurePicks()?.[key] ?? [];
    const selectors = ids.map((id) => cardSelector(id)).filter(Boolean);
    return selectors.length > 0 ? selectors.join(", ") : undefined;
  };
}

function frameDrawers(key: DrawerKey): () => void {
  return () => {
    moveCamera(() => {
      const ids = ensurePicks()?.[key] ?? [];
      if (ids.length === 0) {
        return false;
      }
      // One drawer can be flown right up to; two sitting apart on the board
      // need the wider shot or the pair does not fit the hole.
      useFactoryStore
        .getState()
        .frameBoardNodes(ids, ids.length === 1 ? CLOSE_UP : GROUP_SHOT);
      return true;
    });
  };
}

export const tourBottleneckSelector = pickSelector("bottleneckId");
export const tourBottleneckInputsSelector = pickPartSelector("bottleneckId", "inputs");
export const tourBottleneckOutputsSelector = pickPartSelector("bottleneckId", "outputs");
export const tourBottleneckUsageSelector = pickUsageSelector("bottleneckId");
export const frameTourBottleneck = framePick("bottleneckId");

export const tourBlockedSelector = pickSelector("blockedId");
export const tourBlockedInputsSelector = pickPartSelector("blockedId", "inputs");
export const tourBlockedOutputsSelector = pickPartSelector("blockedId", "outputs");
export const tourBlockedUsageSelector = pickUsageSelector("blockedId");
export const frameTourBlocked = framePick("blockedId");

export const tourSourceDrawerSelector = drawerSelector("sourceDrawerIds");
export const frameTourSourceDrawer = frameDrawers("sourceDrawerIds");
export const tourProductDrawerSelector = drawerSelector("productDrawerIds");
export const frameTourProductDrawer = frameDrawers("productDrawerIds");
export const tourByproductDrawerSelector = drawerSelector("byproductDrawerIds");
export const frameTourByproductDrawer = frameDrawers("byproductDrawerIds");
export const tourBufferDrawerSelector = drawerSelector("bufferDrawerIds");
export const frameTourBufferDrawer = frameDrawers("bufferDrawerIds");

/**
 * The lesson reads its rates per MINUTE. The titanium line's numbers are
 * honest but small - a freezer sipping 0.006/s reads as noise, while 0.38/m
 * reads as a rate - so the lesson turns the dial for the duration and puts
 * it back exactly as it found it, the same contract as the columns.
 */
let rateUnitBefore: ReturnType<(typeof useFactoryStore)["getState"]>["rateUnit"] | undefined;

export function tuneTourRateUnit(): void {
  const store = useFactoryStore.getState();
  rateUnitBefore ??= store.rateUnit;
  if (store.rateUnit !== "minute") {
    store.setRateUnit("minute");
  }
}

export function restoreTourRateUnit(): void {
  if (rateUnitBefore === undefined) {
    return;
  }
  const store = useFactoryStore.getState();
  if (store.rateUnit !== rateUnitBefore) {
    store.setRateUnit(rateUnitBefore);
  }
  rateUnitBefore = undefined;
}

/** The whole line at once, for the steps that talk about all of it. */
export function frameTourWholeBoard(): void {
  moveCamera(() => {
    if (useFactoryStore.getState().project.nodes.length === 0) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes(undefined, WHOLE_BOARD);
    return true;
  });
}

/**
 * The drawer laboratory: the states the drawers-and-buffers lesson walks the
 * board through, each rebuilt whole from a pristine snapshot.
 *
 *   quiet   every product drawer flipped to byproduct. Nothing asks for
 *           titanium, so ONLY the freezer stops - the furnace was never
 *           working for the freezer, and the buffer quietly banks the hot
 *           ingots it keeps making.
 *   strict  quiet, plus every buffer set strict. The refused surplus backs
 *           up into the furnace, the furnace stops, and the stall rolls all
 *           the way upstream: the whole line reads zero.
 *
 * Rebuilt from the snapshot rather than toggled, because the progress dots
 * let a reader jump to any step from any other, and a toggle would need to
 * know where it was coming from. Every state frames the same whole-board
 * shot: the states are the pictures being compared, so the camera must not
 * be part of the difference. Routed through `moveCamera` for its
 * retry-and-supersede behaviour - it keeps trying until the picks resolve,
 * and a newer intention cancels a flip that has not landed yet.
 */
/**
 * A change never rides a timer and never rides the camera: it lands on the
 * PRESS. Each flip is two steps. The GET READY step frames the whole line,
 * changes nothing, and keeps the target tiles FLASHING until the reader
 * commits; pressing Next enters the flip step, whose arrival applies the
 * change with one bright pulse on the tiles that did it. The tour is a
 * TIMELINE: every step's entry rebuilds its own stage from the pristine
 * snapshot, so stepping back across a flip undoes it the same way stepping
 * forward made it, and the progress dots can land anywhere on a consistent
 * frame.
 */
type LabStage = "baseline" | "quiet" | "strict";
let drawerLabBaseline: FactoryProject | undefined;
let labStageApplied: LabStage = "baseline";
let flashing: Animation[] = [];

function stopFlashing(): void {
  for (const animation of flashing) {
    animation.cancel();
  }
  flashing = [];
}

// ANY step change cancels the get-ready flash; the incoming step's own
// `before` re-requests one when it wants it - so leaving the lab sideways
// (Back into a close-up, a dot jump, Esc) can never leave a tile blinking.
// Subscribed on first use, not at module scope: lessons -> tour-boards ->
// tour-state -> lessons is a cycle, and an eval-time call could run against
// a half-initialised module.
let flashCancelArmed = false;

function armFlashCancel(): void {
  if (flashCancelArmed) {
    return;
  }
  flashCancelArmed = true;
  subscribeTourState(stopFlashing);
}

function labTiles(group: "products" | "buffers" | "both"): string[] {
  const found = ensurePicks();
  if (!found) {
    return [];
  }
  return group === "products"
    ? found.productDrawerIds
    : group === "buffers"
      ? found.bufferDrawerIds
      : [...found.productDrawerIds, ...found.bufferDrawerIds];
}

function tileElement(id: string): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
}

/** "I am about to change THIS one": a slow blink that lasts until the press. */
function flashTiles(ids: string[]): void {
  armFlashCancel();
  stopFlashing();
  for (const id of ids) {
    const animation = tileElement(id)?.animate(
      [
        { filter: "brightness(1) saturate(1)" },
        { filter: "brightness(2.2) saturate(1.5)" },
        { filter: "brightness(1) saturate(1)" },
      ],
      { duration: 1100, iterations: Number.POSITIVE_INFINITY, easing: "ease-in-out" },
    );
    if (animation) {
      flashing.push(animation);
    }
  }
}

/** "THIS one just did it": a single bright pulse as the change lands. */
function pulseTiles(ids: string[]): void {
  for (const id of ids) {
    tileElement(id)?.animate(
      [{ filter: "brightness(2.6) saturate(1.4)" }, { filter: "brightness(1) saturate(1)" }],
      { duration: 750, easing: "ease-out" },
    );
  }
}

function applyLabStage(stage: LabStage): boolean {
  const found = ensurePicks();
  if (!found) {
    return false;
  }
  const store = useFactoryStore.getState();
  if (stage === "baseline") {
    if (drawerLabBaseline && labStageApplied !== "baseline") {
      store.markHydratedProject(drawerLabBaseline);
    }
    labStageApplied = "baseline";
    return true;
  }
  if (labStageApplied === stage) {
    return true;
  }
  // The snapshot is only ever taken while the plan is pristine: any other
  // stage was itself built from a snapshot that already existed.
  drawerLabBaseline ??= store.project;
  const products = new Set(found.productDrawerIds);
  const buffers = new Set(found.bufferDrawerIds);
  store.markHydratedProject({
    ...drawerLabBaseline,
    storages: (drawerLabBaseline.storages ?? []).map((storage) =>
      products.has(storage.id)
        ? { ...storage, drainMode: "byproduct" as const }
        : stage === "strict" && buffers.has(storage.id)
          ? { ...storage, bufferMode: "strict" as const }
          : storage,
    ),
  });
  labStageApplied = stage;
  return true;
}

function runLabStep(
  stage: LabStage,
  fx: { flash?: "products" | "buffers" | "both"; pulse?: "products" | "buffers" | "both" },
): void {
  moveCamera(() => {
    if (!ensurePicks()) {
      return false;
    }
    // Every lab step frames the SAME whole-board shot, so between any two of
    // them the stage is the only thing that changes. Framed FIRST, and on
    // every retry: the board only renders on-screen cards, so a tile hidden
    // by the previous step's close-up does not exist until this camera move
    // lands - a guard that waited for the tile before framing would wait on
    // itself forever.
    useFactoryStore.getState().frameBoardNodes(undefined, WHOLE_BOARD);
    // The flash and the pulse land on real pixels or not at all: until the
    // target tiles are in the DOM this step has not really arrived, so keep
    // retrying rather than flipping a board nobody can see yet.
    const targetGroup = fx.flash ?? fx.pulse;
    const targetIds = targetGroup ? labTiles(targetGroup) : [];
    if (targetGroup && targetIds.length > 0 && targetIds.some((id) => !tileElement(id))) {
      return false;
    }
    if (!applyLabStage(stage)) {
      return false;
    }
    if (fx.flash) {
      flashTiles(targetIds);
    }
    if (fx.pulse) {
      pulseTiles(targetIds);
    }
    return true;
  });
}

/** Get ready: nothing changes, the product drawer blinks until the press. */
export function tourLabArmQuiet(): void {
  runLabStep("baseline", { flash: "products" });
}

/** The press lands: product to byproduct, one pulse on the drawer that did it. */
export function tourLabQuiet(): void {
  runLabStep("quiet", { pulse: "products" });
}

/** Get ready again: board holds the quiet stage, the buffer blinks. */
export function tourLabArmStrict(): void {
  runLabStep("quiet", { flash: "buffers" });
}

/** The press lands: the buffer refuses the surplus and the line goes dark. */
export function tourLabStrict(): void {
  runLabStep("strict", { pulse: "buffers" });
}

/** Back to the pristine plan, both flipped tiles pulsing their return. */
export function tourLabReset(): void {
  runLabStep("baseline", { pulse: "both" });
}

/**
 * Baseline without the camera. Runs on the way out of the lesson however it
 * ends - finished, skipped, closed - so the plan the tour borrowed goes back
 * exactly as it loaded.
 */
export function restoreDrawerLab(): void {
  stopFlashing();
  if (drawerLabBaseline && labStageApplied !== "baseline") {
    useFactoryStore.getState().markHydratedProject(drawerLabBaseline);
  }
  drawerLabBaseline = undefined;
  labStageApplied = "baseline";
}

/**
 * A drawer that is TOPPING UP an input, rather than being its only source.
 *
 * The two drawers teach different halves of the same thing. A drawer that is
 * the only source of an ingredient is just a NEED drawn on the board. A drawer
 * wired into an input a machine is ALSO feeding is the interesting one: that
 * input would be the thing holding the line back, and the drawer is what stops
 * it being that. Which is the whole reason to reach for one.
 *
 * Found by resource rather than by handle: the two wires legitimately land on
 * different handle ids for the same slot, so grouping on the handle finds
 * nothing.
 */
function findSupplementDrawer(): { drawerId: string; machineId: string } | undefined {
  const project = useFactoryStore.getState().project;
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const machineIds = new Set(project.nodes.map((node) => node.id));

  const fromDrawers = project.edges.filter(
    (edge) => storageIds.has(edge.source) && machineIds.has(edge.target),
  );

  const supplementing = fromDrawers.find((drawerEdge) =>
    project.edges.some(
      (other) =>
        other !== drawerEdge &&
        other.target === drawerEdge.target &&
        machineIds.has(other.source) &&
        other.resourceId === drawerEdge.resourceId &&
        other.resourceKind === drawerEdge.resourceKind,
    ),
  );

  // Failing that, any drawer feeding a machine: the copy still holds, it just
  // has a plainer example to point at.
  const chosen = supplementing ?? fromDrawers[0];
  return chosen ? { drawerId: chosen.source, machineId: chosen.target } : undefined;
}

/**
 * The topped-up machine AND the drawer topping it up, as one selector.
 *
 * Ringing only the drawer would leave the point half made: the interesting
 * thing is not the drawer, it is the arrangement. Two selectors comma-joined,
 * and the overlay unions their rectangles into one hole (see `measureSelector`).
 */
export function tourSupplementPairSelector(): string | undefined {
  const found = findSupplementDrawer();
  if (!found) {
    return undefined;
  }
  return [cardSelector(found.machineId), cardSelector(found.drawerId)].join(", ");
}

/** The topped-up machine and the drawer doing it, side by side. */
export function frameTourSupplement(): void {
  moveCamera(() => {
    const found = findSupplementDrawer();
    if (!found) {
      return false;
    }
    useFactoryStore.getState().frameBoardNodes([found.machineId, found.drawerId], GROUP_SHOT);
    return true;
  });
}


