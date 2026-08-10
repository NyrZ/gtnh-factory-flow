/**
 * What's new, in players' words.
 *
 * Read by people planning factories, not by developers: say what changed on
 * THEIR board, never how it was built. Newest first. Add an entry with every
 * version bump (see version.ts).
 *
 * KEEP IT SHORT, and keep the list short. This is read in two situations, and
 * both are impatient: someone clicked the version chip out of mild curiosity,
 * or the update popup put it in front of them uninvited. A headline plus two
 * or three lines is the whole budget, and about half a dozen releases is as
 * far back as anyone cares. Older entries are not history worth carrying in
 * the bundle; they are in the git log if anyone ever wants them.
 *
 * An entry can also carry ACTIONS. A release that adds something you have to
 * DO to understand - a tour, a demo board - should offer it as a button rather
 * than describing it and hoping, because the reader is already right here with
 * the app open.
 */
export interface ChangelogAction {
  label: string;
  /** Starts this tour lesson and closes the dialog. */
  lessonId?: string;
  /** Or opens a link, for anything that lives outside the app. */
  href?: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date, rendered in the reader's locale. */
  date: string;
  headline: string;
  notes: string[];
  /**
   * For a release that changed what the app MEANS rather than what it can do.
   *
   * Reserve it for the ones where a plan somebody saved months ago will now
   * read differently, because that reader has no reason to suspect anything
   * and every reason to think they have found a bug. Rendered loudly, with the
   * entry's actions inside it, so the warning and the thing that explains it
   * are one block instead of a sentence and a button that got separated.
   */
  warning?: string;
  /** Offered as buttons under the notes. */
  actions?: ChangelogAction[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.47.0",
    date: "2026-08-10",
    headline: "The planner says when it has changed",
    notes: [
      "Come back after an update and it tells you what moved. *A first visit stays quiet.*",
      "A *What's new* button in the top bar, with a dot when there is something unread.",
      "Undo and redo have left the top bar. They are on the *board's own toolbar*, next to what you are undoing.",
    ],
  },
  {
    version: "1.46.0",
    date: "2026-08-10",
    headline: "Shorter hovers, and a rebuilt tour",
    notes: [
      "Hovers give you *the state and one line why*, not a table.",
      "Output tells *products from byproducts*, products first.",
      "The tour walks a real factory, then *breaks it* to show why.",
    ],
  },
  {
    version: "1.45.0",
    date: "2026-08-10",
    headline: "Drawers do four different jobs",
    notes: [
      "Round is a *SOURCE*, square a *BUFFER*, stop sign a *PRODUCT*, funnel a *BYPRODUCT*.",
      "A product *pulls its machine flat out*. A byproduct *asks for nothing*.",
      "Swap between them with the button in the drawer's top right.",
    ],
  },
  {
    version: "1.44.0",
    date: "2026-08-09",
    headline: "Every slot has to be wired now",
    notes: [
      "A slot with no wire *stops the machine*. It reads *NO WIRES*.",
      "Spare output needs somewhere to go, or the machine reads *CLOGGED*.",
      "*Old boards will light up with slots to connect.* Nothing is broken.",
    ],
    // On THIS release, not the newest one. This is the one that changed what a
    // saved plan means, so this is the entry a reader has to stop at - and the
    // warning belongs beside the change that caused it, not floating at the
    // top of the list attached to whatever shipped most recently.
    warning:
      "*Your saved setups will act different.* Some machines will have stopped until you say where things go.",
    actions: [{ label: "Take the tour", lessonId: "read-the-board" }],
  },
];
