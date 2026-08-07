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
    version: "1.17.0",
    date: "2026-08-06",
    headline: "No more phantom shortages of a hundred-thousandth",
    notes: [
      "A resource that one machine makes and another eats in equal measure now reads as balanced, instead of sometimes turning up under Need or Output with a number like -0.0000012.",
      "Those came from rounding, not from anything wrong with your plan, and they got bigger the bigger your rates were. They are gone at every scale now.",
      "Real shortages and real spare output are untouched.",
      "Rates in the resource list now sit right against the edge of the panel instead of stopping short.",
      "The Need, Output and Internal headings dropped their explanatory lines.",
      "Hovering a resource no longer pops up the browser's own tooltip trailing your cursor down the list.",
      "A resource chart only shows a number while you are pointing at a point on it, since the row above already says what it is right now.",
      "A very long name still ends in an ellipsis when even the widened row cannot fit it.",
    ],
  },
  {
    version: "1.16.0",
    date: "2026-08-06",
    headline: "Double click a resource to fly to the machine that makes it",
    notes: [
      "Double click any resource and the board flies to a machine that uses it, centred and back at normal zoom. Double click again to step to the next one.",
      "Machines carrying the resource you are pointing at now glow and breathe, so they stand out on a busy board instead of just wearing a thin outline. They light up zoomed out too.",
      "Clicking a resource no longer locks the highlight on. Point at it to light the board, look away and it goes out.",
      "Hover a resource and it widens out over the board, so long names are readable in full.",
      "The charts moved: each starred resource now carries its own graph right underneath it, and there is a new button to hide or show all of them at once.",
      "Hover a graph to read what the number was at any point in its history.",
      "The resource panel got wider, and its rates now follow the per second, per minute and per hour switch like the rest of the board.",
      "Starred resources cannot be hidden. Starring something that was hidden brings it straight back.",
      "Selected machines wear the same purple as the selection panel, instead of cyan.",
      "Graphs step aside while you have a selection: the history follows your whole plan, not each selection you might make.",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-08-06",
    headline: "Hide what you do not care about, watch what you do",
    notes: [
      "Hover any resource and two buttons appear: a star to watch it, an eye to hide it.",
      "Hidden resources drop out of the list. The eye button at the top brings them back greyed out, so you can find one and unhide it.",
      "Starred resources float to the top of their group and keep a star beside the name.",
      "New Watching panel at the foot of the list: every starred resource gets its own chart.",
      "The charts run along your edits, not along the clock. Each change that moves a number adds a point, so after an edit that shifted fifty things you can see which of them went up and which went down.",
      "Each chart shows spare above the line and short below it, with the change since the chart started.",
      "Both side columns fold away now. Use the arrow beside Game version on the left, or the one in the resources toolbar on the right, and a thin strip stays behind to bring them back.",
      "Your stars, your hidden resources and your folded columns are remembered between visits.",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-08-06",
    headline: "Select part of your factory, see what just that part needs",
    notes: [
      "Pick some cards and the panel on the right switches to them alone: what they need, what they make, what stays inside.",
      "It works out the answer as if the rest of the board was not there, so anything piped in from outside now shows up under Need.",
      "The panel wears a purple ring while it is showing a selection, so you always know which numbers you are reading.",
      "Click an empty bit of the board to go back to the whole plan.",
      "Shift click now adds a card to your selection instead of starting over. Shift drag still lassoes, and Ctrl click still works too.",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-08-06",
    headline: "The community hub moved in next door",
    notes: [
      "The Community page is gone. Everyone's shared factories now live in a Setups tab, right beside Items and Blueprints.",
      "Browse, search, sort and upvote without leaving your board. Hover a setup to read its story: what it needs, what it makes.",
      "One click opens a setup as its own design tab, so it never lands on top of your work. Your own posts sit under Mine.",
      "Or drop a setup straight onto the board you have open: the box button lands the whole thing as one pocket card, wired and ready.",
      "Setups wear tags now, just like blueprints: search with #tag, pick from the new tags dropdown, or tag your own posts from the shelf or the share dialog.",
      "Every setup shows its top voltage tier in that tier's own colour, the same badge machines wear on the board.",
      "Your own posts get a globe button, same as blueprints: click to take a setup private or publish it again. Private posts keep their votes and downloads.",
      "The two shelves speak one language now: Mine and Public tabs, matching buttons, and every button explains itself when you hover it.",
      "Both shelves grew a share button beside Mine and Public. On Setups it shares the board you have open. On Blueprints it asks for a pocket: click one and it lands on your shelf as a new blueprint.",
      "Setups and blueprints can wear an item's face now: click the little square left of a name and pick an icon. The picker offers the build's own ins and outs first, with full search under them.",
      "Saving a pocket as a blueprint confirms in one dialog: name, icon, tags, what it needs and makes, and a tick box to publish it the moment it saves. The pocket card's save button, the share flow and overwriting all land there.",
      "Hover any row on either shelf and one card tells the whole story: the full name, who made it and when, cards and machines with the tier badge, the description, then what it needs on the left and what it makes on the right.",
      "Blueprints show their top voltage tier too now, in the same coloured badge setups wear.",
      "Your own setup rows grew a save button too: the tab you have open replaces the post's contents, after an are-you-sure that names both.",
      "The share dialog says plainly what you are posting: the open tab, its cards, machines and power, then the post's icon, name, description and tags.",
      "The header's share and link buttons retired. Sharing lives on the shelves now, and every row carries its own copy-link button.",
      "Old community links still work: they open the shared setup straight in the planner.",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-08-06",
    headline: "Pocket dimensions, a blueprint shelf, and a board that explains itself",
    notes: [
      "Shift+drag a box around machines, then Ctrl+G: they compact into one pocket card carrying the group's ins and outs. Double-click it to step inside its own purple room. Esc steps back out.",
      "Pocket cards wire like machines: one port per resource at the boundary. Compacting warns first when it would pool supplies that came from different places.",
      "A Blueprints tab now sits beside the item search: save a pocket as a blueprint, publish it, browse and vote on everyone else's, and place one straight onto your board.",
      "Blueprints take tags and search by them. Rename in place, overwrite one from your board, and double-click a public row to download it.",
      "Drawers, tanks and trash cans went dark and wear their item's colour. Zoomed out, hovering one shows its item and rate.",
      "Zoomed way out the board becomes an LED wall: card faces glow their item's colour with bright rims, and wires light up gold to match.",
      "Box select got real: drag, then copy, cut, paste, delete and undo the whole selection at once.",
      "The zoom buttons are gone; the scroll wheel does that job. In their corner lives a question mark: hover it and every toolbar and panel explains itself, with a cheat sheet of the mouse and key moves.",
    ],
  },
  {
    version: "1.11.2",
    date: "2026-08-05",
    headline: "Dots, pills and dashes all know their place now",
    notes: [
      "Steering dots refuse to sit on a machine: drag one over a card and it rides the nearest clear grid corner instead — dropping it there is where it stays.",
      "Rate labels only appear where there is open wire to sit on, and the moving dashes pass underneath them instead of marching across.",
      "Wires and their dashes stay off the machine tabs at the top of a card — they land on the card itself, past the tabs.",
    ],
  },
  {
    version: "1.11.1",
    date: "2026-08-05",
    headline: "One click rewires the whole board",
    notes: [
      "Flipping the anchor between free docking and classic ports now redraws every wire at once — no more waving the mouse over each machine to wake its wires up.",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-05",
    headline: "A show-off mode, and machines you can recognise from orbit",
    notes: [
      "New screen button in the board toolbar: presentation mode. The warning colours calm down to steel, the fix-it dials and buttons step aside, and every card slims to its name, its rates and a machine count — made for showing a build off.",
      "Machine tabs sit on top of the card like real tabs now, and in presentation mode the chosen machine rides up there as one big icon.",
      "Zoomed way out, cards now show what they ARE — the machine's icon, big. Hover one and a full-size readout opens with the machine, its count and everything going in and out. Two buttons in the bottom right switch between this and the classic usage view with the distance map.",
      "The side panel now opens straight onto your resources — needs, outputs and internal flows — with the power figures retired.",
    ],
  },
  {
    version: "1.10.1",
    date: "2026-08-05",
    headline: "Wires you can actually see",
    notes: [
      "Every wire is about twice as thick — the thinnest lines were reading as scratches.",
      "Thickness-by-volume mode has eight width steps now instead of four, so a 5k line and a 10k line look different even with a 100k pipe on the same board.",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-05",
    headline: "Wires live on the grid — and you can steer them",
    notes: [
      "Every wire now travels along the grid, keeps a clear gap off every card, and never draws on top of another wire. Wires heading the same way ride side by side like a cable run.",
      "Double-click a wire to pin a dot on it. The wire must pass through the dot — drag it (it clicks along the grid) to steer the wire wherever you want, and double-click the dot to remove it. Dots save with your plan.",
      "Wires attach wherever on a card routes cleanest. The anchor button switches back to classic port attachment; it asks first on big boards since rewiring everything can take a moment.",
      "Direction cues got calmer: the marching dashes move slower, and when you turn them off, small arrows sit near each end of every wire instead.",
      "Rate labels on wires are now behind the tag button, off by default — the ports carry the numbers.",
      "Dragging feels honest now: the card in your hand rides above the wires, everything holds still while you drag, and the real wiring lands the moment you drop. Double-click no longer zooms the board.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-05",
    headline: "The whole board is built on one grid now",
    notes: [
      "Every machine, drawer, tank and trash can is now an exact number of grid squares wide and tall, and always sits on a grid square. Boards line up on their own instead of needing you to nudge cards into place.",
      "Item and fluid slots line up with the grid too, so the same slot on two different machines sits at the same height.",
      "The grid lock button is gone — it is always on. Plans you made before this update snap onto the grid the first time you open them.",
      "Machines are all one width now, so a long recipe name no longer makes a card wider than the one next to it.",
      "The EU/t figure has left the bottom of every card. It is still in the power panel on the right, where the whole plan's draw is.",
      "Nothing at the bottom of a card gets cut off any more: if a machine needs more room, the card grows by a whole square instead of squeezing.",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-08-05",
    headline: "Drop a wire anywhere on a machine and it finds the right slot",
    notes: [
      "You no longer have to land on the exact little slot. Drag from any item or fluid and let go anywhere on the machine you want it to go to — the wire snaps onto whichever slot takes it.",
      "While you are dragging, every card tells you the answer up front: a soft green wash means that machine takes what you are holding, a soft red one means it does not.",
      "The pipe you are drawing commits as soon as you are over a green card — it jumps straight to the slot it is going to land in instead of trailing your cursor across the machine.",
      "Drawing a wire is now its own mode. The board stops reacting to everything else while you hold one: lines and their labels do not light up as you sweep past, slots stop highlighting, and no tooltips open. The only thing that answers is the machine you are pointing at.",
      "Letting go on a red card now does nothing at all, instead of dropping a drawer on top of it.",
      "The site is dark all the time now. The light theme and the switch in the header are gone.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-05",
    headline: "Hover a machine, see how far everything else is from it",
    notes: [
      "Zoomed out, resting on any machine now colours the whole board by how many wires away each other machine is from it. Its direct neighbours glow hot, and the colour fades further out along the chain.",
      "Every card shows that count while you hover, so you can tell two steps from five without squinting at colours. Anything not connected to the machine you are on goes grey and empty.",
      "Drawers, tanks and buffers do not add distance. A machine feeding another one through a drawer counts as one step away, not two, because the drawer is where the items wait rather than somewhere the chain goes.",
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
