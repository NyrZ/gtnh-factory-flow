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
    version: "1.29.0",
    date: "2026-08-07",
    headline: "Slots that take any of several items now show them, and let you choose",
    notes: [
      "A slot that stands for a group of items now behaves the way it does in game: the item rolls through the group, about one a second. An Any LV Circuit slot rolls through the four circuits that fit it, and a plank slot in a crafting recipe rolls through the planks.",
      "Hover a rolling slot to hold it still and read it. The tooltip lists everything it takes. Scroll on it to step through the group yourself, which stops the roll and settles on your pick, and the corner mark turns from a cyan plus to an orange square once a slot is set.",
      "Adding the recipe uses whatever the slot was showing at that moment, so you can either aim for the one you want or just take what comes up. Either way the machine lands on your board asking for a real item.",
      "Slots like these used to give nothing away. An Any LV Circuit slot named a stand-in you cannot craft and never said which circuits would do, and in crafting recipes the squares were simply blank.",
      "A slot that names one specific item is left alone. Sharing an ore dictionary entry is not the same as being interchangeable, and a recipe that wants a vacuum tube will not take a NAND chip.",
    ],
  },
  {
    version: "1.28.0",
    date: "2026-08-07",
    headline: "A machine can feed itself",
    notes: [
      "Plenty of machines put out the same item they take in. You can now wire one straight back into itself: drag from the output and drop it anywhere on the same machine, or aim at its own input slot. The wire loops around the card so the round trip is easy to see.",
      "The board always knew how to work these out, it just would not let you draw one. A loop that makes more than it eats keeps itself running. A loop that loses a little each pass winds down to nothing and wears the red dead loop ring, the same as a ring built from several machines.",
      "Setting machine counts automatically used to run away on a machine that loses a little of the item it feeds itself, asking for an impossible number of machines. It settles properly now.",
    ],
  },
  {
    version: "1.27.3",
    date: "2026-08-07",
    headline: "Every outline sits on the card, and selection always shows",
    notes: [
      "On a machine with a row of machine tabs above it, outlines were drawn around the tabs as well, so the card looked like it was sitting inside a box with empty space along the top. The red dead loop ring, the purple selection ring, the search glow and the over-tier warning all hug the card itself now.",
      "Selecting a machine in a dead loop shows the purple ring again. The red was drowning it, and a click that does not visibly land is a click you make twice.",
      "Outlines stack instead of hiding each other. A card that is selected and over tier wears both, purple inside red, so nothing is lost by picking it up.",
    ],
  },
  {
    version: "1.27.1",
    date: "2026-08-07",
    headline: "Dead loop markers blink together and hold their width",
    notes: [
      "Machines in the same loop blink in time again. They used to drift apart depending on when each one came on screen, which made a ring read as unrelated things flashing.",
      "Zoomed out, the ring thinned to nothing at the dim end of each blink and looked like it was flickering. It keeps its width now, and gets thicker the further out you go.",
    ],
  },
  {
    version: "1.27.0",
    date: "2026-08-07",
    headline: "The Blueprints tab is now the Pockets tab",
    notes: [
      "Everything on that shelf is a pocket: you save one from a pocket card and you place one back as a pocket card. Calling it a blueprint in between was a second name for the same thing.",
      "So it says pocket now, everywhere it used to say blueprint, and the tab wears the pocket star instead of the stack of sheets.",
      "Nothing moved and nothing was lost. Everything you saved is still there under the new name.",
    ],
  },
  {
    version: "1.26.0",
    date: "2026-08-07",
    headline: "Open a setup and the board goes to it",
    notes: [
      "Open someone else's setup and the board now flies to their factory and zooms out until all of it is on screen. People build a long way from where you happen to be looking, so opening one used to drop you on empty canvas with the whole thing off the edge.",
      "Importing a plan file lands the same way.",
      "Drop a setup onto your board as a pocket and the camera settles on the new card. Same for placing one off your pocket shelf: you see what just arrived, however far out you were reading the board.",
      "The board zooms out further than it used to, so even a very large factory fits on one screen.",
    ],
  },
  {
    version: "1.25.0",
    date: "2026-08-07",
    headline: "The board now tells you when machines are stuck in a loop",
    notes: [
      "Wire a set of machines so they feed each other in a ring, and if more leaves the ring than comes back round it, every machine in it falls to 0%. That is what would happen in game, and the planner was already right about it. It just never said why.",
      "Now it says so. Every machine caught in a dead ring reads DEAD LOOP and pulses red, and so do the wires between them, so you can see the whole circle at a glance. A line along the bottom names it and takes you to it.",
      "Hover any of those machines for the long version: what is going round, why it drains, and how to start it. The short answer is to put a source or a stocked barrel on any machine in the ring.",
      "This catches rings of any size, a machine wired back into itself, and rings that would hold on their own until something taps them for a couple of items a second.",
      "It stays quiet about rings that work. A ring that makes enough to keep itself going is a good build and gets no warning.",
      "Watch for this the moment you close the last wire on a loop. An input with nothing wired to it is assumed hand fed, so a ring can look perfectly healthy right up until you connect it and it has to supply itself.",
    ],
  },
  {
    version: "1.24.0",
    date: "2026-08-07",
    headline: "Machines only go red when they are the thing to fix",
    notes: [
      "Running below 100% is not a fault. A machine that hands every machine it feeds exactly what was asked now reads as fine, whatever its percent says.",
      "Starved, in soft yellow, means it is short on an ingredient but nothing is waiting on it. There is nothing to do.",
      "Blocked, in amber, means it is short and something downstream goes without because of it. The fix is further up the chain, and the hover says where.",
      "Bottleneck, in red, means everything it needs arrives and it still cannot keep up. That is the card to add machines to. Follow the amber cards upstream and you always land on a red one.",
      "A machine that misses a rate you set for it now counts as something going without, rather than reading as merely short.",
    ],
  },
  {
    version: "1.23.0",
    date: "2026-08-07",
    headline: "New parts to pick, and 61 machines now on checked numbers",
    notes: [
      "Machines that were missing a part you can choose have one now: arc furnace electrodes, cutting factory sawblades, electromagnets, anvils, item pipe casings, containment blocks, maceration upgrade chips, laser amperage and more. Pick the part and the rates follow.",
      "61 multiblocks now use figures checked against the game's code rather than read off tooltip text, up from about 45.",
      "The Industrial Arc Furnace was treated as a blast furnace and ran far too fast. It now runs on its electrodes, which is what actually drives it.",
      "Steam machines and the fusion reactors are not converted yet and are unchanged.",
    ],
  },
  {
    version: "1.22.0",
    date: "2026-08-07",
    headline: "Machine numbers now come from a checked list, not from reading tooltips",
    notes: [
      "The planner used to work out what coils and casings do by reading each machine's tooltip text. That guessed wrong often enough to matter, so around 45 multiblocks now use figures checked against the game's own code instead.",
      "Speed, power discount, parallels and overclock behaviour are all covered for those machines. Everything else keeps working exactly as before.",
      "Some numbers will move. Where they do, the new one is the one your factory will actually hit.",
      "Thanks to ShadowTheAge, whose open source GTNH calculator these figures are taken from.",
      "Found a rate that looks wrong? The Report Bug button in the header is now hard to miss, and it asks for a link to your published setup so it can be checked against your actual board.",
    ],
  },
  {
    version: "1.21.1",
    date: "2026-08-07",
    headline: "Machines with parallels no longer claim impossible output",
    notes: [
      "Parallels are paid for with power before any speed bonus from a higher tier. A chem plant with titanium pipe casings running nitrobenzene on IV spends all of it on its six parallels, so it now shows 2,000 L/s instead of 32,000 L/s, which is what the machine really does.",
      "Feeding a machine a higher tier only speeds it up if there is power left over once every parallel is running. Below that, extra voltage does nothing, exactly as in game.",
      "A machine can only run as many parallels as its power will carry. Six parallels of a 480 EU/t recipe need 2,880 EU/t, so on HV you get one.",
      "The chem plant, pyrolyse oven, oil cracker and coke oven were being paid a heat bonus meant for the blast furnace, and ran up to four times too fast. Only the blast furnace, Volcanus and the Exothermic Hearth get that bonus now.",
      "If a plan of yours drops after this update, the old number was wrong and the new one is what you will actually build.",
    ],
  },
  {
    version: "1.21.0",
    date: "2026-08-06",
    headline: "Pocket cards now read like machine cards",
    notes: [
      "Every resource going in or out of a pocket has a bar and two numbers: what it is moving right now, and the most it could move if it got everything it asks for.",
      "That second number comes from running every machine inside the pocket, not from scaling one figure, so a pocket short on one ingredient shows you exactly how much output you are losing.",
      "An ingredient with nothing wired to it now says HAND-FED, and each output tells you who is drinking from it, the same as any machine.",
      "A pocket that wanted one thing under two names used to show it twice, the second time with no rate at all. It is one row now.",
      "Pockets light up when you point at a resource in the list on the right. They used to stay dark.",
      "Dragging a resource off a pocket onto empty board makes a drawer. It quietly did nothing before.",
    ],
  },
  {
    version: "1.20.1",
    date: "2026-08-06",
    headline: "The item search sits in the same box as the other two tabs",
    notes: [
      "Items now keeps its search and filters in the rounded panel that Pockets and Setups already used, so all three tabs match.",
    ],
  },
  {
    version: "1.20.0",
    date: "2026-08-06",
    headline: "Three new buttons in the header",
    notes: [
      "The code, the Discord thread and a bug report are now one click away, up beside the import and export buttons.",
      "Reporting a bug opens a short form that asks the right questions instead of an empty box, and it already knows which planner version you are on.",
      "You can drag an exported plan straight into that form. The picture carries your whole board, so whatever went wrong can be opened and seen exactly as you had it.",
    ],
  },
  {
    version: "1.19.2",
    date: "2026-08-06",
    headline: "Close a whole run of tabs at once",
    notes: [
      "The tab menu can now close everything to the right, everything to the left, or every other tab, and each one says how many it will take.",
      "Closing tabs cannot be undone, so each of those asks once before it goes ahead.",
      "Game version moved up to the top bar, next to the app version, and its dropdown is wider so the name fits.",
      "Design tabs are a little shorter, so they sit closer to the text.",
      "The arrow that folds the left column away now sits on the far left, matching the one on the right.",
    ],
  },
  {
    version: "1.19.1",
    date: "2026-08-06",
    headline: "Calm mode now tidies pocket cards too",
    notes: [
      "With calm colours on, a pocket card drops its buttons like every other card and just shows its name across the top.",
      "The delete, clone, open, save and unpack buttons come straight back when you turn calm colours off.",
      "Double-clicking a pocket still opens it, and the card and its wires do not move.",
    ],
  },
  {
    version: "1.19.0",
    date: "2026-08-06",
    headline: "A shared setup now arrives set up the way you left it",
    notes: [
      "Sharing a setup saves how you had everything arranged, and opening someone else's puts it back exactly like that.",
      "That covers your starred resources and their charts, what you had hidden, whether hidden mode was on, and whether you were reading rates per second, per minute or per hour.",
      "It also covers the board: the background pattern, calm mode, the wire colour, thickness, label and flow settings, which card face you were on, and which side columns were open.",
      "Updating one of your own posts re-saves the arrangement too, so it never keeps the one from whenever you first published it.",
      "None of this touches your own designs. Switching between your tabs leaves your settings exactly where you put them, and dropping a setup onto the board you are working on will not rearrange anything.",
      "Older setups that were shared before this simply open with your own settings, as they always did.",
    ],
  },
  {
    version: "1.18.0",
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
    version: "1.17.0",
    date: "2026-08-06",
    headline: "The question mark in the corner now explains every button",
    notes: [
      "Hover the ? bottom left and each toolbar card lists its buttons one by one, next to the very icon each one wears. No more guessing which is which.",
      "The crop farm, the trash can and the custom rate tap get a line each. So do all seven view switches, both card faces, and every paint and note tool.",
      "The left column says what its three tabs are for: Items, Pockets and Setups.",
      "The undo, clean, import and export buttons up top were never explained at all. They are now.",
      "The whole sheet went from bright cyan to a soft blue grey, so it reads as notes over your board instead of shouting at you.",
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
      "The Community page is gone. Everyone's shared factories now live in a Setups tab, right beside Items and Pockets.",
      "Browse, search, sort and upvote without leaving your board. Hover a setup to read its story: what it needs, what it makes.",
      "One click opens a setup as its own design tab, so it never lands on top of your work. Your own posts sit under Mine.",
      "Or drop a setup straight onto the board you have open: the box button lands the whole thing as one pocket card, wired and ready.",
      "Setups wear tags now, just like pockets: search with #tag, pick from the new tags dropdown, or tag your own posts from the shelf or the share dialog.",
      "Every setup shows its top voltage tier in that tier's own colour, the same badge machines wear on the board.",
      "Your own posts get a globe button, same as pockets: click to take a setup private or publish it again. Private posts keep their votes and downloads.",
      "The two shelves speak one language now: Mine and Public tabs, matching buttons, and every button explains itself when you hover it.",
      "Both shelves grew a share button beside Mine and Public. On Setups it shares the board you have open. On Pockets it asks for a pocket: click one and it lands on your shelf.",
      "Setups and pockets can wear an item's face now: click the little square left of a name and pick an icon. The picker offers the build's own ins and outs first, with full search under them.",
      "Saving a pocket to the shelf confirms in one dialog: name, icon, tags, what it needs and makes, and a tick box to publish it the moment it saves. The pocket card's save button, the share flow and overwriting all land there.",
      "Hover any row on either shelf and one card tells the whole story: the full name, who made it and when, cards and machines with the tier badge, the description, then what it needs on the left and what it makes on the right.",
      "Pockets show their top voltage tier too now, in the same coloured badge setups wear.",
      "Your own setup rows grew a save button too: the tab you have open replaces the post's contents, after an are-you-sure that names both.",
      "The share dialog says plainly what you are posting: the open tab, its cards, machines and power, then the post's icon, name, description and tags.",
      "The header's share and link buttons retired. Sharing lives on the shelves now, and every row carries its own copy-link button.",
      "Old community links still work: they open the shared setup straight in the planner.",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-08-06",
    headline: "Pocket dimensions, a pocket shelf, and a board that explains itself",
    notes: [
      "Shift+drag a box around machines, then Ctrl+G: they compact into one pocket card carrying the group's ins and outs. Double-click it to step inside its own purple room. Esc steps back out.",
      "Pocket cards wire like machines: one port per resource at the boundary. Compacting warns first when it would pool supplies that came from different places.",
      "A Pockets tab now sits beside the item search: save a pocket to it, publish it, browse and vote on everyone else's, and place one straight onto your board.",
      "Pockets take tags and search by them. Rename in place, overwrite one from your board, and double-click a public row to download it.",
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
