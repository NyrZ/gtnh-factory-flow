import { expandPocketSelection } from "../model/pocket-connections";
import type { FactoryProject, ResourceBalance, ResourceKey } from "../model/types";
import { selectInternalBalances } from "./balances";
import { calculateThroughput } from "./throughput";

/**
 * The Need/Output/Internal books for a subset of the board.
 *
 * Same three lists as a plan-wide result, same shapes, so the flow panel can
 * swap one for the other without knowing which it holds.
 */
export interface SelectionFlow {
  resources: Record<ResourceKey, ResourceBalance>;
  externalInputs: ResourceBalance[];
  unconsumedOutputs: ResourceBalance[];
  internal: ResourceBalance[];
  /** Machine cards counted, for the "scoped to N machines" strip. */
  machineCount: number;
  /** Drawers and tanks caught by the selection, counted the same way. */
  storageCount: number;
}

/**
 * Solve the selection as if it were the whole board: these cards exist,
 * everything else is gone, and any wire with one foot outside is gone with it.
 * The severed wires are what make the panel interesting - a resource the plan
 * makes internally becomes a Need when only its consumer is selected, and an
 * Output when only its maker is.
 *
 * This is a real second solve, not a re-tally of the plan's numbers, and the
 * difference shows at the boundary. A machine the board throttles to half
 * speed because its supplier is small runs at FULL speed here once that
 * supplier is outside the box - so the panel answers "what would this chunk
 * need to run properly", not "what is it managing right now". That is the same
 * question a pocket card and a saved blueprint answer about their contents
 * (see `computeBlueprintIo`), so all three agree.
 *
 * Selecting a pocket card counts everything inside it. Returns undefined when
 * the selection holds no machine cards at all, which is the panel's signal to
 * keep showing the whole plan.
 */
export function calculateSelectionFlow(
  project: FactoryProject,
  selectedIds: readonly string[],
): SelectionFlow | undefined {
  if (selectedIds.length === 0) {
    return undefined;
  }

  const { itemIds } = expandPocketSelection(project, selectedIds);
  if (itemIds.size === 0) {
    return undefined;
  }

  const nodes = project.nodes.filter((node) => itemIds.has(node.id));
  // Drawers and notes carry no recipe, so a selection of nothing but those has
  // no flows to book. The plan is more useful there than an empty scope.
  if (nodes.length === 0) {
    return undefined;
  }
  const storages = (project.storages ?? []).filter((storage) => itemIds.has(storage.id));

  const scoped: FactoryProject = {
    ...project,
    nodes,
    storages,
    annotations: [],
    // Wires survive only with both feet inside, exactly as a copy or a
    // blueprint capture takes them.
    edges: project.edges.filter(
      (edge) => itemIds.has(edge.source) && itemIds.has(edge.target),
    ),
  };

  // Not cloned: the solver only reads the project, and a selection re-solves
  // often enough that a deep copy of every selected card would show.
  const result = calculateThroughput(scoped, { generatedAt: "selection" });

  return {
    resources: result.resources,
    externalInputs: result.externalInputs,
    unconsumedOutputs: result.unconsumedOutputs,
    internal: selectInternalBalances(Object.values(result.resources)),
    machineCount: nodes.length,
    storageCount: storages.length,
  };
}
