import type { FactoryProject } from "./types";
import { normalizeProjectFuelProfiles } from "./fuels";
import { repairFilledCellInputOverrides } from "./recipe-input-overrides";

/**
 * Everything a project must go through on its way in, whether it arrives from
 * IndexedDB, a JSON import, an embedded plan image or the community hub.
 *
 * One funnel on purpose. These repairs were previously applied by whoever
 * remembered to call them, which is how a load path ends up quietly skipping a
 * migration — every caller now gets the full set by construction.
 */
export function normalizeLoadedProject(project: FactoryProject): FactoryProject {
  return repairFilledCellInputOverrides(normalizeProjectFuelProfiles(project));
}
