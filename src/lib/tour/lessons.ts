"use client";

import {
  Anchor,
  Box,
  Cable,
  Compass,
  Ellipsis,
  Factory,
  Focus,
  Gauge,
  Grid3x3,
  Link,
  MoveUpRight,
  Paintbrush,
  Palette,
  Search,
  Share2,
  Sprout,
  Square,
  Tag,
  Trash,
  Trash2,
  Type,
  Undo2,
  User,
} from "lucide-react";
import type { GlanceRow } from "@/components/tour/card-parts";
import { openSidebarTab } from "@/lib/sidebar-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import {
  clearTheDecks,
  cutTourProduct,
  restoreTourProduct,
  frameTourWholeBoard,
  frameTourBlocked,
  frameTourBottleneck,
  frameTourBufferDrawer,
  frameTourByproductDrawer,
  frameTourProductDrawer,
  frameTourSourceDrawer,
  openTourPlan,
  restoreTheDecks,
  tourBlockedInputsSelector,
  tourBlockedOutputsSelector,
  tourBlockedSelector,
  tourBlockedUsageSelector,
  tourBottleneckInputsSelector,
  tourBottleneckOutputsSelector,
  tourBottleneckSelector,
  tourBottleneckUsageSelector,
  tourBufferDrawerSelector,
  tourByproductDrawerSelector,
  tourProductDrawerSelector,
  tourSourceDrawerSelector,
} from "./tour-boards";

/**
 * The guided walks behind the Welcome tab.
 *
 * A lesson is a list of steps, and a step is a place on the screen plus what
 * that place is for. The overlay (`TourOverlay`) does the pointing: it finds
 * the step's anchor, cuts a hole in a dimmed screen around it, and parks a card
 * beside it.
 *
 * An anchor is an id, not a selector. The overlay looks for
 * `[data-tour-anchor="<id>"]` first and falls back to `[data-help-anchor=...]`,
 * which the hover help sheet already puts on every toolbar and column, so most
 * steps cost no markup at all. Several elements may share one id; their
 * rectangles union, and anything hidden is skipped, so a folded compact toolbar
 * points at its trigger instead of at the invisible row above the board.
 *
 * WRITING A STEP. A wall of prose gets skipped, so a step is a short stack of
 * ROWS, and every row leads with the same mark the screen does: the button's
 * own icon, a key chip, or a little mouse with the right button lit. Keep a row
 * to one line's worth of words, put the words that matter between *asterisks*
 * so they come out lit, and let the icon carry the rest. Six rows is the most
 * any step should ever want.
 *
 * `before` runs just ahead of the step and is for making the target visible:
 * opening a column, landing the sidebar on a tab. A step must never leave the
 * app somewhere the user then has to dig their way out of.
 */

/** Where a step's card sits relative to the thing it points at. */
export type TourSide = "top" | "bottom" | "left" | "right" | "inside";

export interface TourStep {
  /**
   * The `data-tour-anchor` / `data-help-anchor` id to point at. Left out, or
   * missing from the page, the card sits in the middle of a dimmed screen.
   */
  anchor?: string;
  /**
   * A CSS selector worked out at the moment the step runs, for pointing at
   * something that has no anchor because it did not exist until now: one card
   * of a plan the lesson has just downloaded. Read every frame, and it wins
   * over `anchor`.
   */
  anchorSelector?: () => string | undefined;
  title: string;
  rows: GlanceRow[];
  /** Preferred side. Ignored when there is no room for it. */
  side?: TourSide;
  /** Make the target reachable before the step is measured. */
  before?: () => void;
}

export interface TourLesson {
  id: string;
  /** Shown on the Welcome tab's card. */
  title: string;
  blurb: string;
  /**
   * Worth pressing even if you think you know the app.
   *
   * Stays on after the lesson has been completed, deliberately. The rules this
   * one teaches - what the words on a card mean, what each drawer shape asks
   * for - are the ones that CHANGE, and somebody who walked it three releases
   * ago is exactly the person who now believes something that is no longer
   * true. A badge that disappears the moment you have seen it once only ever
   * reaches people on their first day.
   */
  recommended?: boolean;
  /** Put something on the board worth pointing at, before step one. */
  setup?: () => void | Promise<void>;
  /** Undo whatever `setup` did to the layout, however the lesson ends. */
  teardown?: () => void;
  /** Offered as a second button on the last step: keep going into this one. */
  nextLessonId?: string;
  steps: TourStep[];
}

function showColumn(side: "left" | "right") {
  writeWorkspaceView(side === "left" ? { leftPanelOpen: true } : { rightPanelOpen: true });
}

/** Open the left column AND land it on one tab: the tour walks all three. */
function showSidebarTab(tab: "items" | "blueprints" | "setups") {
  return () => {
    showColumn("left");
    openSidebarTab(tab);
  };
}

const LOOK_AROUND: TourLesson = {
  id: "look-around",
  title: "A look around the planner",
  blurb: "Where everything is: the board, every toolbar around it, and both columns.",
  nextLessonId: "read-the-board",
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "This is the board",
      rows: [
        { text: "Your factory gets built here." },
        { mouse: "left", text: "Drag the background to *move around*." },
        { mouse: "scroll", text: "Scroll to *zoom*." },
      ],
    },
    {
      anchor: "build",
      side: "bottom",
      title: "Build tools",
      rows: [
        { icon: Undo2, text: "Undo and redo. *Ctrl+Z*." },
        { icon: Sprout, text: "*Crop farm*: CropsNH (2.9)." },
        { icon: Trash, text: "*Trash can*: things wired in 100% go away." },
        { icon: Gauge, text: "*Custom rate*: dial any number in or out by hand." },
        { chip: "/s", text: "Per tick, second, minute or hour." },
      ],
    },
    {
      anchor: "paint",
      side: "left",
      title: "Dressing it up",
      rows: [
        { icon: Paintbrush, text: "Pick a shade, then click cards to *paint them*." },
        { icon: Square, text: "Draw a *box* round a section." },
        { icon: MoveUpRight, text: "Draw an *arrow*." },
        { icon: Type, text: "Drop a *note*." },
        { icon: Trash2, text: "*Bin*: click anything to delete it." },
      ],
    },
    {
      anchor: "view",
      side: "left",
      title: "How it looks",
      rows: [
        { text: "These change *the view*, never the plan. Nothing here can break anything." },
        { icon: Grid3x3, text: "Background: dots, lines, crosses or none." },
        { icon: Palette, text: "Shade the wires by *how much they carry*." },
        { icon: Cable, text: "Thicken them the same way." },
        { icon: Ellipsis, text: "Marching dashes show *which way it flows*." },
        { icon: Tag, text: "Rate labels, right on the lines." },
        { icon: Anchor, text: "Wires dock anywhere, or at fixed ports." },
      ],
    },
    {
      anchor: "glance",
      side: "left",
      title: "Framing",
      rows: [
        { icon: Focus, text: "Lost? This *fits the whole plan* on the screen." },
        { icon: Box, text: "Cards lead with *what they are*." },
        { icon: Gauge, text: "Cards lead with *how hard they run*. Red idle, green flat out." },
      ],
    },
    {
      anchor: "inspector",
      side: "left",
      before: () => showColumn("right"),
      title: "What the plan needs",
      rows: [
        { text: "Empty right now. Put a machine down and it fills up with three lists." },
        { chip: "NEED", tone: "need", text: "You have to bring this in yourself." },
        { chip: "OUT", tone: "output", text: "This leaves the plan." },
        { chip: "IN", tone: "internal", text: "Made and used right here." },
        { text: "Hover a row and every card carrying it *lights up*." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("items"),
      title: "Every item in the pack",
      rows: [
        { icon: Search, text: "Search it the way you search *NEI* in game." },
        { mouse: "left", text: "Left click asks *what makes it*." },
        { mouse: "right", text: "Right click asks *what uses it*." },
        { text: "Pick a recipe and the machine *lands on the board*, wired up and running." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("blueprints"),
      title: "Pockets: chunks you reuse",
      rows: [
        { chip: "Ctrl+G", text: "Select a few cards and they *fold into one pocket*." },
        { mouse: "left", text: "Double click a pocket to *step inside*. Esc backs out." },
        { chip: "✦", text: "This shelf holds yours, and everyone else's." },
        { text: "Drag one onto the board and it *unpacks*, wires and all." },
      ],
    },
    {
      anchor: "tabs",
      side: "bottom",
      title: "One tab, one factory",
      rows: [
        { chip: "+", text: "A new empty board." },
        { mouse: "left", text: "Double click a tab to *rename* it." },
        { chip: "⋯", text: "Copy it, close it, or close every tab to one side." },
        { text: "It all saves in this browser as you work. *Nothing to press*." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("setups"),
      title: "Whole factories, shared",
      rows: [
        { icon: Factory, text: "*Public*: every setup people have posted." },
        { icon: User, text: "*Mine*: the ones you have put up yourself." },
        { mouse: "left", text: "Open one and it arrives as *a tab of your own* to pull apart." },
        { text: "Vote the good ones up so they are easier to find." },
      ],
    },
    {
      anchor: "share-setup",
      side: "right",
      before: showSidebarTab("setups"),
      title: "And putting yours up",
      rows: [
        { icon: Share2, text: "Shares *the board you have open*, under a name you pick." },
        { icon: Link, text: "You get a *link to send a friend*. It opens straight into their tabs." },
        { text: "It sits on the Public shelf too. Take it down whenever you like." },
      ],
    },
    {
      anchor: "help",
      side: "right",
      title: "And when you forget",
      rows: [
        { chip: "?", text: "Names *every button on the screen* at once." },
        { icon: Compass, text: "Both tours live on the *Welcome* tab, any time you want them." },
        { text: "That is where everything is. Next one opens a real factory and reads it." },
      ],
    },
  ],
};

/**
 * The second walk: the canvas and nothing else.
 *
 * It opens a real posted setup, says what the board is at arm's length, then
 * flies in on one machine and reads it out loud. The card it picks is the most
 * wired-up one that is NOT running flat out (see `pickCards`), so there is
 * always a real number to explain rather than a shrug.
 */
const READ_THE_BOARD: TourLesson = {
  id: "read-the-board",
  title: "Read the board",
  recommended: true,
  blurb:
    "Opens a real titanium line, flies in on one machine and reads it out, then shows what the drawers around it are for.",
  // Both columns out of the way for the duration: this lesson is about the
  // canvas and nothing else, and with them open there is not enough board left
  // to magnify a card into. They come back exactly as they were.
  setup: () => {
    clearTheDecks();
    return openTourPlan();
  },
  // The last step cuts a drawer off the board to make its point. However the
  // lesson ends - finished, skipped, closed - the plan goes back as it was.
  teardown: () => {
    restoreTourProduct();
    restoreTheDecks();
  },
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "A factory is boxes and lines",
      rows: [
        { text: "Every box is *one machine doing one recipe*." },
        { text: "Every line is *one thing moving*, from whoever makes it to whoever wants it." },
        { text: "That is the whole board. Everything else is detail on a box." },
      ],
    },
    {
      anchorSelector: tourBottleneckSelector,
      side: "right",
      before: frameTourBottleneck,
      title: "Here is one recipe",
      rows: [
        { text: "Three parts, always in the same places." },
        { text: "*Left*: what it wants. *Right*: what it makes." },
        { text: "*Along the bottom*: how it is actually doing." },
      ],
    },
    {
      anchorSelector: tourBottleneckInputsSelector,
      side: "right",
      title: "This one is being fed just fine",
      rows: [
        { text: "One row per ingredient. The bar is how much of it is actually turning up." },
        { text: "Nothing this machine wants is running short." },
      ],
    },
    {
      anchorSelector: tourBottleneckOutputsSelector,
      side: "right",
      title: "But look what is being asked of it",
      rows: [
        { text: "One row per product, at the rate it is managing right now." },
        {
          text: "The machine downstream wants *far more* of one of these than this machine can make.",
        },
        {
          text: "The *percentage* on a row is that machine saying how much of what it asked for actually arrived.",
        },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      title: "Which makes this a bottleneck",
      rows: [
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "“I am fed fine, and somebody is *still* not getting what they asked of me.”",
        },
        {
          text: "This is the one word that means *build more of this machine*. Nothing upstream will help: it already has everything it wants.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedSelector,
      side: "right",
      before: frameTourBlocked,
      title: "Now a different machine",
      rows: [
        { text: "Further down the chain." },
        { text: "Same three parts." },
      ],
    },
    {
      anchorSelector: tourBlockedInputsSelector,
      side: "right",
      title: "Only one of these is the problem",
      rows: [
        { text: "*Teo* of these inputs arent getting what they want." },
        {
          text: "But only the slowest of them is marked, and that is the one actually setting the speed.",
        },
        { text: "A machine only ever has *one* thing holding it back." },
      ],
    },
    {
      anchorSelector: tourBlockedUsageSelector,
      side: "right",
      title: "And why it does not say bottleneck",
      rows: [
        {
          chip: "BLOCKED",
          tone: "blocked",
          text: "“I am technically bottlenecked, but but only because I am not being fed enough.”",
        },
        {
          text: "Building more of *this* machine would achieve nothing. It cannot use all of what it has already.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedOutputsSelector,
      side: "right",
      title: "And it drags the next one down too",
      rows: [
        { text: "What it makes is nowhere near enough." },
        { text: "The machine waiting on it gets *a fraction* of what it asked for." },
        { text: "That is how one shortage near the top becomes a whole chain of slow cards." },
      ],
    },
    {
      anchorSelector: tourSourceDrawerSelector,
      side: "right",
      before: frameTourSourceDrawer,
      title: "Drawers: where the plan meets the world",
      rows: [
        { text: "Not a machine. A *Source* is where a plan actually gets resources." },
        {
          text: "Sources are denoted with rounded corners.",
        },
        {
          chip: "NEED",
          tone: "need",
          text: "What comes out of it is listed under NEED. It is considered a input of the plan itself.",
        },
      ],
    },
    {
      anchorSelector: tourProductDrawerSelector,
      side: "right",
      before: frameTourProductDrawer,
      title: "A product asks for everything",
      rows: [
        { text: "This is the thing your factory is *for*." },
        {
          text: "A product drawer asks the machine feeding it for *100% of what that machine can make*.",
        },
        { text: "Which is why a machine with one of these on it runs flat out." },
        {
          text: "Products are consited primary outputs of a plan."
        }
      ],
    },
    {
      anchorSelector: tourByproductDrawerSelector,
      side: "right",
      before: frameTourByproductDrawer,
      title: "A byproduct asks for nothing",
      rows: [
        { text: "A byproduct drawer asks for *nothing at all*. It just takes whatever it is given." },
        {
          text: "So it never speeds a machine up. Use it for the second thing a machine spits out that you only need *somewhere to put*.",
        },
        { text: "Swap a drawer between the two with the button in its *top right button*." },
      ],
    },
    {
      anchorSelector: tourBufferDrawerSelector,
      side: "right",
      before: frameTourBufferDrawer,
      title: "And a buffer does no magic at all",
      rows: [
        {
          text: "An input and an output. *It can never put out more than it takes in.*",
        },
        {
          text: "So it is no place to dump a surplus, and it cannot rescue a machine that is not being fed enough. It passes along what its takers pull, and no more.",
        },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      // Also puts the product drawer back, so stepping BACK out of the last
      // step undoes the cut the same way stepping forward made it.
      before: () => {
        restoreTourProduct();
        frameTourBottleneck();
      },
      title: "Two more words you will meet",
      rows: [
        {
          chip: "NO WIRES",
          tone: "starved",
          text: "“A slot on me has nothing on it, so I cannot run at all.” The bare slots *flash white*. Wire them and the word goes.",
        },
        {
          chip: "CLOGGED",
          tone: "blocked",
          text: "“I am wired up, but I make more of something than anyone takes, and *the extra has nowhere to go*.”",
        },
        {
          text: "A machine stops when an output backs up, exactly as it would in game. Give the spare a byproduct drawer and it runs again.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      // Frames the whole line and puts the drawer back if we have arrived here
      // by stepping BACK out of the cut. The camera settles HERE, and the next
      // step deliberately does not touch it: the before and the after have to
      // be the same picture or there is nothing to compare.
      before: () => {
        restoreTourProduct();
        frameTourWholeBoard();
      },
      title: "So let us break it on purpose",
      rows: [
        { text: "The whole line, running. Every machine on it is doing something." },
        {
          text: "That *titanium ingot drawer* is the only thing taking the finished titanium off the end of it.",
        },
        { text: "Press next and we delete it. *Nothing else will move.* Watch the board." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: cutTourProduct,
      title: "And there it goes",
      rows: [
        {
          chip: "NO WIRES",
          tone: "starved",
          text: "The freezer that made the titanium now has an output with *nothing on it*, so it stops dead.",
        },
        {
          text: "And look at the rest. *Every machine on the board is at 0%.* Nobody is asking for anything any more, so the whole line behind it has nothing left to do.",
        },
        {
          text: "One drawer. Six machines. *Everything a machine makes has to be going somewhere*, or it does not run at all, exactly as in game.",
        },
        { text: "Leave the tour and the drawer comes back." },
      ],
    },
  ],
};

export const TOUR_LESSONS: TourLesson[] = [LOOK_AROUND, READ_THE_BOARD];

export function findLesson(lessonId: string | undefined): TourLesson | undefined {
  return lessonId ? TOUR_LESSONS.find((lesson) => lesson.id === lessonId) : undefined;
}

