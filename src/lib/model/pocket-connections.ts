import type {
  FactoryNode,
  FactoryProject,
  FactoryStorage,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "./types";
import { isRecipeInputConsumed } from "./resources";
import {
  applyRecipeInputOverrides,
  restoreCrossKindInputOverrideVisuals,
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
  return restoreCrossKindInputOverrideVisuals(
    {
      ...effectiveRecipe,
      ...adjustedRecipe,
    },
    recipe,
    node,
  );
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

/** The pocket's own resource entry for one port, or undefined if no member backs it. */
export function getPocketResourceForHandle(
  project: FactoryProject,
  pocketId: string,
  side: "input" | "output",
  resource: { kind: ResourceKind; id: string },
): ResourceAmount | undefined {
  return listPocketPortResources(project, pocketId, side).find(
    (entry) => entry.kind === resource.kind && entry.id === resource.id,
  );
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
  const ids: string[] = [];
  for (const node of project.nodes) {
    if (!memberIds.has(node.id)) {
      continue;
    }
    const matches = memberSideResources(project, node, side).some(
      (entry) => entry.kind === resource.kind && entry.id === resource.id,
    );
    if (matches) {
      ids.push(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (
      memberIds.has(storage.id) &&
      storage.kind === resource.kind &&
      storage.resourceId === resource.id
    ) {
      ids.push(storage.id);
    }
  }
  return ids;
}
