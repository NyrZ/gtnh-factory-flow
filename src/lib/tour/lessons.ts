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
  focusTourCard,
  frameTourSuppliers,
  frameTourSupplement,
  openTourPlan,
  restoreTheDecks,
  tourCardPartSelector,
  tourCardSelector,
  tourCardUsageSelector,
  tourSupplementPairSelector,
  tourSupplierSelector,
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
        { text: "Your factory gets built here, one machine card at a time." },
        { mouse: "left", text: "Drag the background to *move around*." },
        { mouse: "scroll", text: "Scroll to *zoom*." },
        { text: "Everything that puts something on it lives around the edges. That is this tour." },
      ],
    },
    {
      anchor: "build",
      side: "bottom",
      title: "Build tools",
      rows: [
        { icon: Undo2, text: "Undo and redo, out on their own. *Ctrl+Z*." },
        { icon: Sprout, text: "*Crop farm*: pick a crop, it grows at the right rate." },
        { icon: Trash, text: "*Trash can*: wire spare output in, it stops counting." },
        { icon: Gauge, text: "*Custom rate*: dial any number in or out by hand." },
        { chip: "/s", text: "Per second, minute or hour. *Everywhere at once*." },
      ],
    },
    {
      anchor: "paint",
      side: "left",
      title: "Dressing it up",
      rows: [
        { icon: Paintbrush, text: "Pick a shade, then click cards to *tag them*." },
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
  blurb:
    "Opens a real titanium line, flies in on one machine and reads it out, then shows what the drawers around it are for.",
  // Both columns out of the way for the duration: this lesson is about the
  // canvas and nothing else, and with them open there is not enough board left
  // to magnify a card into. They come back exactly as they were.
  setup: () => {
    clearTheDecks();
    return openTourPlan();
  },
  teardown: restoreTheDecks,
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "A factory is boxes and lines",
      rows: [
        { text: "Every box is *one machine doing one recipe*." },
        { text: "Every line is *one thing moving*, from whoever makes it to whoever wants it." },
        { text: "Thicker lines carry more. The dashes run the way the stuff runs." },
        { text: "That is the whole board. Everything else is detail on a box." },
      ],
    },
    {
      anchorSelector: tourCardSelector,
      side: "right",
      before: focusTourCard,
      title: "So here is one box",
      rows: [
        { text: "Three parts, always in the same places." },
        { text: "*Left*: what it wants. *Right*: what it makes." },
        { text: "*Along the bottom*: how it is actually doing." },
      ],
    },
    {
      anchorSelector: tourCardPartSelector("inputs"),
      side: "right",
      title: "The left side is what it wants",
      rows: [
        { text: "One row per ingredient. The bar is how much of it is actually turning up." },
        {
          text: "A machine can only ever have *one bottlenecked input*. Here it is the highlighted one.",
        },
        {
          text: "The other rows are just being slowed down by it. Feed the bottleneck and they all speed up.",
        },
      ],
    },
    {
      anchorSelector: tourCardPartSelector("outputs"),
      side: "right",
      title: "The right side is what it makes",
      rows: [
        { text: "One row per product, at the rate it is managing right now." },
        {
          text: "The *percentage* is not about this machine. It is the machine downstream saying how much of what it wanted arrived.",
        },
        { text: "So a low one means somebody further along is going hungry." },
        {
          text: "Every output needs *somewhere to go*, even the ones you do not want. A full output bus stops a machine dead.",
        },
      ],
    },
    {
      anchorSelector: tourCardUsageSelector,
      side: "right",
      title: "The bottom is how it is doing",
      rows: [
        { text: "*Usage* is how hard it is running. 100% is flat out." },
        { text: "*Reason* is one word for why." },
        { text: "A low number is not automatically a problem. The word is what tells you." },
      ],
    },
    {
      anchorSelector: tourCardUsageSelector,
      side: "right",
      title: "The words it uses",
      rows: [
        {
          chip: "FULL",
          tone: "fine",
          text: "“Everyone who asked me got it. Nothing to do here.”",
        },
        {
          chip: "STARVED",
          tone: "starved",
          text: "“I am short, but nobody is waiting on me anyway. Leave me be.”",
        },
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "“I am fed fine and somebody is still going without. *I am the problem: build more of me.*”",
        },
        {
          chip: "BLOCKED",
          tone: "blocked",
          text: "“Somebody downstream is going without, but only because *I* am not being fed. Go fix whoever feeds me.”",
        },
      ],
    },
    {
      anchorSelector: tourCardUsageSelector,
      side: "right",
      title: "And two about where stuff goes",
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
          text: "A machine stops when its output backs up, exactly as it would in game. Give the spare somewhere to go and it speeds up.",
        },
      ],
    },
    {
      anchorSelector: tourSupplierSelector,
      side: "right",
      before: frameTourSuppliers,
      title: "This one is a drawer",
      rows: [
        { text: "Not a machine. A drawer is where your plan *touches the outside world*." },
        {
          text: "A plan has to say where everything comes from and where it goes. Drawers are how it says it, and *the shape tells you which*.",
        },
        {
          text: "Round corners: a *SOURCE*. Nothing feeds it, so it never runs out, and what leaves it is something you bring in yourself.",
        },
        {
          chip: "NEED",
          tone: "need",
          text: "Whatever comes out of a source is listed under NEED. Same as it always was: *stuff you have to supply*.",
        },
      ],
    },
    {
      anchorSelector: tourSupplementPairSelector,
      side: "right",
      before: frameTourSupplement,
      title: "The other three shapes",
      rows: [
        {
          text: "An *eight-sided stop sign* is a PRODUCT. It asks the machine feeding it for everything that machine can make. This is the thing your factory is *for*.",
        },
        {
          text: "*Corners cut off the bottom* is a BYPRODUCT. It asks for nothing and just catches the extra, so it never speeds a machine up. Use it for the stuff you only need somewhere to put.",
        },
        {
          text: "Swap between those two with the button in the drawer's *top right*.",
        },
        {
          text: "A plain *square* is a BUFFER: fed and drawn from, sitting in the middle of your chain. It passes on exactly what its takers pull, so it is *not* a place to dump a surplus.",
        },
      ],
    },
  ],
};

export const TOUR_LESSONS: TourLesson[] = [LOOK_AROUND, READ_THE_BOARD];

export function findLesson(lessonId: string | undefined): TourLesson | undefined {
  return lessonId ? TOUR_LESSONS.find((lesson) => lesson.id === lessonId) : undefined;
}

