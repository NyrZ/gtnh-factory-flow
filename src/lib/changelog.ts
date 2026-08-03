/**
 * What's new, in players' words.
 *
 * This is the list behind the version chip in the header, so it is read by
 * people planning factories, not by developers: say what changed on THEIR
 * board, never how it was built. Newest first, a headline and a couple of
 * short lines each. Add an entry with every version bump (see version.ts).
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date, rendered in the reader's locale. */
  date: string;
  headline: string;
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2026-08-03",
    headline: "Trash cans",
    notes: [
      "New trash can in the top-left tools: wire any output into it and that flow is voided.",
      "Trashed resources disappear from the Output list, so it only shows what your factory really produces.",
      "One can takes as many lines as you like, and it only ever eats leftovers — machines that want the resource are always served first.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-08-02",
    headline: "Tanks and drawers behave",
    notes: [
      "Drag a wire from the glass, drag the frame to move the buffer.",
      "The minus button deletes again, and long names are readable instead of cut off.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-02",
    headline: "No more stuck factories",
    notes: [
      "Machines that feed each other in a loop used to talk themselves into doing nothing — both sides waiting on the other, everything sat near 0%.",
      "The planner now solves the whole board at once and starts every machine at full speed, so loops run without a fake starter source.",
      "When a resource is tight it is shared fairly instead of one big machine starving out a small one. Real boards jumped from 58/s to 303/s.",
    ],
  },
];
