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
    version: "1.7.0",
    date: "2026-08-05",
    headline: "Hover a machine, see how far everything else is from it",
    notes: [
      "Zoomed out, resting on any machine now colours the whole board by how many wires away each other machine is from it. Its direct neighbours glow hot, and the colour fades further out along the chain.",
      "Every card shows that count while you hover, so you can tell two steps from five without squinting at colours. Anything not connected to the machine you are on goes grey and empty.",
      "Wires fade back while you are reading the map, and everything snaps back to normal the moment you move away, zoom in, or drag the board.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-05",
    headline: "Zoom out and read the whole factory at once",
    notes: [
      "Zoomed out, machines now show one big number: how hard they are running. Red means starved, amber means more is being asked of it than it can give, plain means fine — so a whole plan reads as a health map at a glance instead of a wall of unreadable cards.",
      "Drawers, tanks and trash cans do the same, showing a large picture of what is inside. Zoom back in and everything returns exactly as it was.",
      "At that distance lines drop their rate chips, arrowheads and moving dashes too — none of it could be read at that size, and leaving it out makes zoomed-out boards far smoother.",
      "Big plans are quicker everywhere. Opening one takes about half as long, and boards that used to crawl while panning or zooming now keep up.",
      "The moving dashes used to keep the whole board busy redrawing itself even when you were not touching it. They no longer do, so a plan left alone now costs nothing.",
      "A few wires take tidier paths than before. The planner was throwing away most of what it knew about neighbouring lines while working out where each one should go; now it sees all of them, and the route you get is the same every time.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-04",
    headline: "Lines that stop piling up",
    notes: [
      "Wires running the same way no longer land on top of each other. Every line leaving a machine, and every line arriving at one, now gets its own track instead of picking one at random — so a machine with four outputs shows you four lines, not two.",
      "Thick lines keep their distance. With line thickness on, wires now leave more room around machines and around each other, instead of using the spacing meant for thin ones and ending up squeezed against the cards.",
      "Where one line crosses another it hops over it with a visible bump, and it is always the thinner line that does the hopping. Those bumps used to go missing on some crossings depending on how the board happened to draw itself, and sometimes appeared on the line hidden underneath; now every crossing gets one and you can always see it.",
      "When lines do overlap, the thinner one stays on top and every line has a darker outline, so you can still follow each one through the pile instead of losing it.",
      "Thick lines are easier to point at — hovering anywhere on a fat pipe now lights it up, instead of only a narrow strip down its middle.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-08-04",
    headline: "Cell recipes asked for 1000× too much",
    notes: [
      "Wiring anything into a recipe that takes filled cells multiplied what it needed by a thousand: a reactor wanting 2 Sulfuric Gas Cells a second asked for 2,000, and every machine feeding it looked far too small.",
      "Cells and their fluid are the same stuff counted two ways — one cell is 1000 L — and the planner was converting even when it did not need to. It now converts only when you actually wire a fluid into a cell slot, or the other way round.",
      "Plans you already saved are repaired when you open them. Nothing to redo.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-04",
    headline: "Watch your factory run",
    notes: [
      "Lines now show what they carry: the busier a line, the thicker it is, with dashes marching along it in the direction things flow. Both are on from the start, and both have a button in the top right if you want them off.",
      "Two more views up there: colour every machine by how hard it is working, and colour every line by how much moves through it. Red is idle, green is flat out.",
      "Undo and redo buttons in the top left, a grid lock that snaps nodes as you drag, and a background you can switch between dots, lines, crosses or nothing.",
      "Boxes and arrows you draw no longer shove your wires around — they are drawings again, not walls. Text notes can be resized with + and − when you hover them.",
      "Your view settings stick between visits, and a coloured node keeps its text readable instead of going dark on dark.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-03",
    headline: "Smaller nodes, straighter answers",
    notes: [
      "Nodes take up far less room. Icons, ports and couplings are all tighter, so more of your factory fits on screen at once — the name and rate still read on every input and output.",
      "Bottlenecks fed through a tank or drawer were never marked. The machine said it was starved but no ingredient turned red, and every one of them claimed something else was to blame. The real one is now highlighted.",
      "Hovering the usage box lights only what is actually holding the machine back, instead of everything on the card that looks unhappy.",
      "An output going nowhere now says where it ends — TRASH, TANK or STORE — instead of calling every one of them a dump.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-03",
    headline: "Nodes read at a glance",
    notes: [
      "Every node now ends in one line: USAGE with the percentage, and REASON with one word for why — bottleneck, over-asked, on demand, full or hand-fed. The big coloured banner is gone.",
      "Hover the usage box and the port it blames lights up, with the full story behind it: what it gets, what it wants, where to add machines, and what caps the node next.",
      "Item and fluid icons are much larger, ports carry the resource name, and huge numbers finally fit: 2,147,483,648 EU/t reads as 2.15G, and a slow line at 0.004/s no longer shows as zero.",
      "Wires can be dragged straight from an output's coupling chip, and the machines you can switch to now sit in tabs across the top of the node.",
    ],
  },
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
