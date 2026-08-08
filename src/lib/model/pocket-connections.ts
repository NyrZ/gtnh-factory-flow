import type {
  FactoryNode,
  FactoryProject,
  FactoryStorage,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "./types";
import { isRecipeInputConsumed, resourceMatchesInput } from "./resources";
import {
  applyRecipeInputOverrides,
} from "./recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "./recipe-rules";
import { applyMachineOutputMultipliers } from "../solver/machine-effects";
import { getOverclockedRecipeStats } from "../solver/overclock";

/**
 * A pocket card is a VIEW over hidden members — the flat graph never holds an
 * edge whose endpoint is a pocket. So a wire aimed at a pocket's port has to
 * land on real member nodes, and these helpers answer the two questions that
 * takes: which resources does a pocket expose as ports, and which members
 * stand behind one port. A port fans out: wiring redstone to a pocket whose
 * two machines both drink redstone feeds both of them.
 */

/**
 * The recipe a node actually presents on the board: concrete oredict
 * overrides applied, the selected machine handler folded in, and tiered
 * output multipliers taken into account. Handle ids, port lists and
 * compatibility checks must all read THIS recipe, never the raw one
 * (see AGENTS.md on effective rendered resources).
 */
export function getEffectiveNodeRecipe(recipe: Recipe, node: FactoryNode): Recipe {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
  const overclockedStats = getOverclockedRecipeStats(nodeRecipe, node);
  const adjustedRecipe = applyMachineOutputMultipliers(
    effectiveRecipe,
    node,
    overclockedStats.tier,
  );
  return {
    ...effectiveRecipe,
    ...adjustedRecipe,
  };
}

export function isPocketId(project: FactoryProject, id: string): boolean {
  return (project.pockets ?? []).some((pocket) => pocket.id === id);
}

/** The pocket plus every pocket nested inside it, transitively. */
function collectPocketIdsWithin(project: FactoryProject, pocketId: string): Set<string> {
  const pockets = project.pockets ?? [];
  const ids = new Set<string>([pocketId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const pocket of pockets) {
      if (
        pocket.parentPocketId !== undefined &&
        ids.has(pocket.parentPocketId) &&
        !ids.has(pocket.id)
      ) {
        ids.add(pocket.id);
        grew = true;
      }
    }
  }
  return ids;
}

export interface PocketMembers {
  nodes: FactoryNode[];
  storages: FactoryStorage[];
}

/** Every concrete card inside a pocket, nested pockets included. */
export function collectPocketMembers(project: FactoryProject, pocketId: string): PocketMembers {
  const ids = collectPocketIdsWithin(project, pocketId);
  return {
    nodes: project.nodes.filter((node) => node.pocketId !== undefined && ids.has(node.pocketId)),
    storages: (project.storages ?? []).filter(
      (storage) => storage.pocketId !== undefined && ids.has(storage.pocketId),
    ),
  };
}

/**
 * Expand a board selection through pocket membership: selecting a pocket
 * card means selecting everything inside it, transitively. Returns the
 * concrete item ids (nodes/storages/annotations) and the pocket ids.
 *
 * Every feature that acts on "what is selected" runs through here — copy,
 * blueprint capture, compact, and the selection-scoped flow panel — so a
 * pocket card always means the same thing to all of them.
 */
export function expandPocketSelection(
  project: FactoryProject,
  selectedIds: Iterable<string>,
): { itemIds: Set<string>; pocketIds: Set<string> } {
  const pockets = project.pockets ?? [];
  const selected = new Set(selectedIds);
  const pocketIds = new Set<string>();
  const queue: string[] = [];
  for (const pocket of pockets) {
    if (selected.has(pocket.id)) {
      pocketIds.add(pocket.id);
      queue.push(pocket.id);
    }
  }
  while (queue.length > 0) {
    const parentId = queue.pop();
    for (const pocket of pockets) {
      if (pocket.parentPocketId === parentId && !pocketIds.has(pocket.id)) {
        pocketIds.add(pocket.id);
        queue.push(pocket.id);
      }
    }
  }

  const itemIds = new Set<string>();
  const isMember = (item: { id: string; pocketId?: string }) =>
    selected.has(item.id) || (item.pocketId !== undefined && pocketIds.has(item.pocketId));
  for (const node of project.nodes) {
    if (isMember(node)) {
      itemIds.add(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (isMember(storage)) {
      itemIds.add(storage.id);
    }
  }
  for (const annotation of project.annotations ?? []) {
    if (isMember(annotation)) {
      itemIds.add(annotation.id);
    }
  }
  return { itemIds, pocketIds };
}

function storageResource(storage: FactoryStorage): ResourceAmount {
  return {
    kind: storage.kind,
    id: storage.resourceId,
    amount: 1,
    displayName: storage.displayName,
    iconPath: storage.iconPath,
    iconAtlas: storage.iconAtlas,
    dominantColor: storage.dominantColor ?? storage.iconAtlas?.dominantColor,
  };
}

function memberSideResources(
  project: FactoryProject,
  member: FactoryNode,
  side: "input" | "output",
): ResourceAmount[] {
  const recipe = project.recipes.find((entry) => entry.id === member.recipeId);
  if (!recipe) {
    return [];
  }
  const effective = getEffectiveNodeRecipe(recipe, member);
  const resources = side === "input" ? effective.inputs : effective.outputs;
  // Non-consumed inputs (catalysts, NC slots) are not wireable on a machine
  // card, so a pocket must not offer them either.
  return side === "input" ? resources.filter(isRecipeInputConsumed) : resources;
}

/**
 * The distinct resources a pocket's members expose on one side — the pool a
 * whole-card drop tests against. One entry per kind:id; the first member's
 * entry supplies the display metadata (and oredict alternatives) for all of
 * them, exactly as its own card would.
 */
export function listPocketPortResources(
  project: FactoryProject,
  pocketId: string,
  side: "input" | "output",
): ResourceAmount[] {
  const members = collectPocketMembers(project, pocketId);
  const seen = new Set<string>();
  const resources: ResourceAmount[] = [];
  const push = (resource: ResourceAmount) => {
    const key = `${resource.kind}:${resource.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      resources.push(resource);
    }
  };
  for (const node of members.nodes) {
    for (const resource of memberSideResources(project, node, side)) {
      push(resource);
    }
  }
  for (const storage of members.storages) {
    push(storageResource(storage));
  }
  return resources;
}

/**
 * Display metadata for a resource the members do not name themselves. Read
 * from anywhere in the plan, because a port that outlives the recipe entry
 * behind it still has to draw an icon and a name.
 */
function describeProjectResource(
  project: FactoryProject,
  resource: { kind: ResourceKind; id: string },
): ResourceAmount {
  for (const recipe of project.recipes) {
    for (const entry of [...recipe.inputs, ...recipe.outputs]) {
      if (entry.kind === resource.kind && entry.id === resource.id) {
        return { ...entry, amount: 1 };
      }
    }
  }
  for (const storage of project.storages ?? []) {
    if (storage.kind === resource.kind && storage.resourceId === resource.id) {
      return storageResource(storage);
    }
  }
  return { kind: resource.kind, id: resource.id, amount: 1 };
}

/**
 * The pocket's own resource entry for one port.
 *
 * A port you can SEE must always be a port you can drag, and that is not
 * automatic here: the card's ports come from a scoped solve plus every wire
 * crossing the boundary (`computePocketSummaries`), while this list is built
 * from member recipes. The two can name one physical resource differently —
 * a wire stored against a concrete oredict form, a member whose effective
 * recipe resolves to a compatible one — and a port that fell down the gap
 * used to refuse the drag before it began, silently.
 *
 * So: exact identity first, keeping the rule that a member consuming a
 * genuinely distinct form gets its own port. Then the same compatibility rule
 * the rest of the board matches by, keeping the PORT's identity (the handle
 * and the card already agree on it) and borrowing the member's metadata.
 * Then a plain description, so the answer is never "nothing".
 */
export function getPocketResourceForHandle(
  project: FactoryProject,
  pocketId: string,
  side: "input" | "output",
  resource: { kind: ResourceKind; id: string },
): ResourceAmount {
  const ports = listPocketPortResources(project, pocketId, side);
  const exact = ports.find(
    (entry) => entry.kind === resource.kind && entry.id === resource.id,
  );
  if (exact) {
    return exact;
  }

  const compatible = ports.find((entry) => resourceMatchesInput(resource, entry));
  if (compatible) {
    return { ...compatible, kind: resource.kind, id: resource.id };
  }

  return describeProjectResource(project, resource);
}

/**
 * The member cards a wire docked on one pocket port actually connects to:
 * every node whose effective recipe carries exactly this resource on this
 * side, plus every matching drawer/tank. Exact identity on purpose — a
 * member consuming a different (merely compatible) form gets its own port.
 */
export function resolvePocketMemberIds(
  project: FactoryProject,
  pocketId: string,
  side: "input" | "output",
  resource: { kind: ResourceKind; id: string },
): string[] {
  const members = collectPocketMembers(project, pocketId);
  const memberIds = new Set<string>([
    ...members.nodes.map((node) => node.id),
    ...members.storages.map((storage) => storage.id),
  ]);
  return resolveMemberIdsForResource(project, memberIds, side, resource);
}

/**
 * Same resolution over an arbitrary member set — how a PROSPECTIVE pocket
 * (a selection about to be compacted) answers the question before the
 * pocket exists.
 */
export function resolveMemberIdsForResource(
  project: FactoryProject,
  memberIds: ReadonlySet<string>,
  side: "input" | "output",
  resource: { kind: ResourceKind; id: string },
): string[] {
  const collect = (
    matchesMember: (entry: ResourceAmount) => boolean,
    matchesStorage: (storage: FactoryStorage) => boolean,
  ): string[] => {
    const ids: string[] = [];
    for (const node of project.nodes) {
      if (!memberIds.has(node.id)) {
        continue;
      }
      if (memberSideResources(project, node, side).some(matchesMember)) {
        ids.push(node.id);
      }
    }
    for (const storage of project.storages ?? []) {
      if (memberIds.has(storage.id) && matchesStorage(storage)) {
        ids.push(storage.id);
      }
    }
    return ids;
  };

  const exact = collect(
    (entry) => entry.kind === resource.kind && entry.id === resource.id,
    (storage) => storage.kind === resource.kind && storage.resourceId === resource.id,
  );
  if (exact.length > 0) {
    return exact;
  }

  // Nothing named it exactly. Rather than drop the wire on the floor, fall
  // back to the board's own compatibility rule — the same one that lets a
  // concrete Spruce Log satisfy an oredict logWood slot. Second, never first:
  // an exact match still wins, so a member drinking a genuinely different
  // form keeps its own port instead of being swept into this one.
  return collect(
    (entry) => resourceMatchesInput(resource, entry),
    (storage) =>
      resourceMatchesInput(resource, {
        kind: storage.kind,
        id: storage.resourceId,
        displayName: storage.displayName,
      }),
  );
}
