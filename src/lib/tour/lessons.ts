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
  frameTourWholeBoard,
  frameTourBlocked,
  frameTourBottleneck,
  frameTourBufferDrawer,
  frameTourByproductDrawer,
  frameTourProductDrawer,
  frameTourSourceDrawer,
  openTourPlan,
  restoreDrawerLab,
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
  tourLabArmQuiet,
  tourLabArmStrict,
  tourLabQuiet,
  tourLabReset,
  tourLabStrict,
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
    "Opens a real titanium line and reads it out loud: the machines and their words first, then every drawer job, then it flips a product and a buffer live and lets you watch the board follow.",
  // Both columns out of the way for the duration: this lesson is about the
  // canvas and nothing else, and with them open there is not enough board left
  // to magnify a card into. They come back exactly as they were.
  setup: () => {
    clearTheDecks();
    return openTourPlan();
  },
  // The lab steps rewrite the plan to make their point. However the lesson
  // ends - finished, skipped, closed - the plan goes back exactly as it loaded.
  teardown: () => {
    restoreDrawerLab();
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
        { text: "*Two* of these inputs are not getting what they want." },
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
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      before: frameTourBottleneck,
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
      before: frameTourWholeBoard,
      title: "None of these words is an alarm",
      rows: [
        {
          text: "Step back and count: *almost nothing here sits at 100 percent*. A real line never does, and it does not have to.",
        },
        {
          text: "Machines come in whole numbers and recipes do not, so most cards idle part of the time. That is a factory *working*, not a factory broken.",
        },
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "The one worth hunting. Want more product? Find the bottleneck, *add machines there*, and watch the next one appear. That loop IS the game.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: frameTourWholeBoard,
      title: "Four jobs, four colours",
      rows: [
        { text: "Machines make. *Drawers decide*: what comes in, what leaves, what waits." },
        { chip: "SOURCE", tone: "need", text: "*Red, rounded*: never runs out. The plan's imports." },
        { chip: "PRODUCT", tone: "product", text: "*Blue, eight-sided*: what the plan is for." },
        { chip: "BYPRODUCT", tone: "output", text: "*Green, square*: catches what is left over." },
        { chip: "BUFFER", tone: "internal", text: "*Steel, shield*: holds stock and passes it on." },
        { text: "Same colours as the books on the right. Visit each in turn." },
      ],
    },
    {
      anchorSelector: tourSourceDrawerSelector,
      side: "right",
      before: frameTourSourceDrawer,
      title: "A source never runs out",
      rows: [
        { text: "Nothing feeds it, so it *invents* its item. These two are draining into the line." },
        {
          chip: "NEED",
          tone: "need",
          text: "Everything a source hands out is something your real base must supply.",
        },
        { text: "Draw a wire *out* of any drawer and it becomes one. That is the whole setup." },
      ],
    },
    {
      anchorSelector: tourProductDrawerSelector,
      side: "right",
      before: frameTourProductDrawer,
      title: "A product pulls",
      rows: [
        { text: "The *titanium ingot* drawer. Nothing draws from it, and it *asks*." },
        {
          chip: "PRODUCT",
          tone: "product",
          text: "It asks its machine for *everything that machine can make*. The pace of the whole line starts here.",
        },
        {
          text: "The button on its header flips it to a byproduct. Which is exactly what we are about to do.",
        },
      ],
    },
    {
      anchorSelector: tourByproductDrawerSelector,
      side: "right",
      before: frameTourByproductDrawer,
      title: "A byproduct only catches",
      rows: [
        { text: "Two of them here: *cast iron* and *carbon monoxide*." },
        {
          chip: "BYPRODUCT",
          tone: "output",
          text: "A byproduct asks for *nothing*. It takes what happens to arrive and never speeds a machine up.",
        },
        {
          text: "The number on its tile is live: the CO drawer is banking a rate it never asked for. That is the whole job.",
        },
      ],
    },
    {
      anchorSelector: tourBufferDrawerSelector,
      side: "right",
      before: frameTourBufferDrawer,
      title: "A buffer holds",
      rows: [
        { text: "*Hot titanium ingot*, sitting between the furnace and the freezer." },
        {
          chip: "BUFFER",
          tone: "internal",
          text: "It hands the freezer what the freezer pulls, and *catches anything extra* at the rate on its tile.",
        },
        {
          text: "It never invents supply: run it short and the taker slows. Its header button can also make it *strict*. Watch what both of those mean.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabArmQuiet,
      title: "Get ready: the product lets go",
      rows: [
        {
          text: "The whole line, running, and *the blue titanium drawer is blinking*: that is the one about to change.",
        },
        {
          text: "Press *Next* and it becomes a byproduct. Nothing on the board will ask for titanium after that.",
        },
        { text: "Keep your eyes on the *freezer* and on the *buffer*." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabQuiet,
      title: "Watch the product let go",
      rows: [
        {
          text: "The titanium drawer is a *byproduct* now. Nothing on the board asks for titanium any more.",
        },
        {
          chip: "UNUSED",
          tone: "internal",
          text: "*Only the freezer stopped.* Its ingots have no takers, so it has nothing to do.",
        },
        {
          text: "Everything upstream keeps running - and the *buffer is quietly banking* the hot ingots the furnace keeps making. Its tile shows the rate.",
        },
        { text: "A byproduct never sets the pace. That is the entire difference." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabArmStrict,
      title: "Get ready: the buffer goes strict",
      rows: [
        { text: "Same picture, and now *the buffer is blinking*." },
        {
          text: "Press *Next* and it goes strict: it will *refuse to bank the surplus* it has been catching.",
        },
        { text: "Watch the *furnace* first, then everything behind it." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabStrict,
      title: "Now the buffer is strict",
      rows: [
        { text: "The flip landed: the buffer *refuses to bank the surplus*." },
        {
          chip: "UNUSED",
          tone: "internal",
          text: "With nothing asking and nothing catching, the furnace has *nowhere to send a single ingot*. It stops, and every machine behind it follows. *The whole line reads zero.*",
        },
        {
          text: "Strict is the loud setting: nothing gets stored, so an imbalance stops the line instead of hiding in a tank.",
        },
        { text: "Press *Next* to put everything back." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabReset,
      title: "And put it back",
      rows: [
        { text: "Product asking, buffer catching. The line breathes again." },
        {
          text: "That is the whole grammar: *who asks, who catches, who holds*. Every drawer on any board is doing one of those.",
        },
        { text: "Flip them freely: the header buttons are always one click, and never a rewire." },
      ],
    },
    {
      anchor: "sketch",
      side: "bottom",
      title: "When you just want numbers",
      rows: [
        {
          text: "The wand is *sketch mode*: every unwired input is fed for free, and every unwired output is exported.",
        },
        {
          text: "For quick math on a half-built idea. Turn it off when you are ready to draw the boundary for real - with the drawers you now know.",
        },
      ],
    },
  ],
};

export const TOUR_LESSONS: TourLesson[] = [LOOK_AROUND, READ_THE_BOARD];

export function findLesson(lessonId: string | undefined): TourLesson | undefined {
  return lessonId ? TOUR_LESSONS.find((lesson) => lesson.id === lessonId) : undefined;
}

