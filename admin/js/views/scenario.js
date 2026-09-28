// views/scenario.js — the scenario planner (21 Sep 2026).
//
// She asked to design the line rather than only read it: modules she assembles
// like Lego, each scenario revealing its cycle time, and the module start times
// tuned to shrink the people it needs. All the arithmetic is in js/scenario.js
// — this screen only draws it, so the two can never disagree.
//
// The method it is built around is hers, in her words: ask for more pans than
// the line makes, find the one module that stops you, relieve exactly that, and
// meet the next wall. That ladder is the climb card, and it is computed from the
// modules rather than written down — change one number and it is a different
// climb.
//
// The second round of asks, in her words again: a start time she can set ("say
// i want a start at 8am"), "an time scale ruler", modules she can "create, edit
// and delete" and "move the sequence of", scenarios she can "save and name …
// edit or delete", "one person for each module" with "a Total person showing
// overlapping persons time slot", a module that can "restart", modules she can
// "drag to move the start time", and the fold module showing its 28 minutes with
// its person's 2 minutes.
//
// It is a planner she types into: nothing here reads an order, and nothing here
// blocks a sale.

import { el, button, select, showPopup, toast, confirmDialog } from "../ui.js";
import { save } from "../state.js";
import { trim } from "../production.js";
import {
  computeScenario, climbSteps, descentSteps, DEFAULT_SCENARIO, SISTER_SCENARIO, ONE_BAKER_SCENARIO,
  hoursAndMinutes,
  clockOf, moveModule, removeModule, newModuleId, blankModule, copyScenario,
  PX_PER_MIN_CHOICES, scenarioFacts, moduleFacts, chainLine, latestStarts,
  combinedScenario, reassignSlot, pinArrangement, linesInForce, moduleOf, minuteAtPx, placesOn, clampBatchStart,
  alignBatches, batchMismatches, personName, callWindows, jobKey,
  START_MODES, START_MODE_LABELS, START_MODE_HINTS, START_MODE_READINGS,
  startModeOf, setStartMode, skillsOf,
} from "../scenario.js";

// A colour per PERSON, so a row reads as one worker's day rather than as a
// patchwork of the modules they passed through. The person rows used to be tinted
// by the module each stretch of work came from, which made one person's row eight
// different colours and told her nothing about the person.
const PERSON_TONES = 8;
const personTone = (who) => `ptone-${((Math.max(1, Math.round(Number(who) || 1)) - 1) % PERSON_TONES) + 1}`;

// A colour per module, so a bar on the timeline and the person carrying it can be
// matched by eye. It cycles, so a module added later still gets a colour.
const TONES = 8;

// The shortest bar that still carries its minutes inside it.
const LAB_MIN_PX = 26;

// The narrowest a stretch of her hands is ever drawn inside a bar. A minute of
// the fold is under two pixels at the scale the day is read in, and drawn at
// that width it lands exactly on the seam between two cycles and reads as that
// seam rather than as her working there. It is the same floor the person rows
// give a stretch of her day, so a bar and the person row that attends it agree
// about what a one-minute job looks like.
const MIN_TOUCH_PX = 4;

// When a module's cycles overlap, they are stacked in lanes rather than painted
// over each other. These are the same numbers as the single-lane bar's box, so a
// row that does not overlap is drawn exactly as it always was: one 16px bar at
// top 9. A row that does overlap splits that same 16px into as many lanes as it
// needs — two lanes still fit the 34px track it always had, and a third grows the
// row's own track to fit.
const LANE_TOP = 3;
const LANE_PITCH = 11;
const LANE_H = 9;
const TRACK_MIN_H = 34;
const laneTrackH = (lanes) => Math.max(TRACK_MIN_H, LANE_TOP + lanes * LANE_PITCH + 4);

// How many shades the cycles inside a batch are drawn in. Four is what a batch
// of four needs to be read as four, and the palest of them is lifted off the
// floor so it still shows over the pastel bar tones. A fifth cycle and beyond
// reuse the darkest shade rather than falling back to the palest — a long batch
// must never end on the faintest band — and the bar's own tooltip names each one.
const CYCLE_SHADES = 4;

// The band at the top of a track that carries the batch numbers. A tag cannot be
// drawn inside its bar — `.tl-bar` is 16px tall with overflow hidden, so anything
// written in there is clipped — so each row grows by this much and the tags sit in
// the space above the bars.
const TAG_BAND = 11;

// Above which scale the hold is printed beside the batch number. It is the
// widest stop and nothing else, chosen by her own rule rather than by a
// measurement: "if the scale is too wide to show batch no. and delta t then
// forgo delta t". So at the widest scale a tag reads `B2` and no more, and at
// the five nearer stops it reads `B2 Δt=+5`. See batchTags.
const DELTA_TAG_MIN_PX = 1.2;

const DAY_MIN = 24 * 60;

// The six stops of the scale, in the order of PX_PER_MIN_CHOICES: a whole day,
// the standard reading, close, closer, closest, and detail. Since v157 the control
// is a step of two buttons and one of these words stands between them as the stop
// in force. Closer, Closest and Detail all draw a one-minute ruler, so the word is
// what tells them apart and it must be worth reading on a 62px chip.
const SCALE_NAMES = ["Wide", "Standard", "Close", "Closer", "Closest", "Detail"];

// How fine the clock ruler is drawn, one entry per stop of PX_PER_MIN_CHOICES.
//
// Her ask of 22 September: "make the ruler resolution to 1min". A minute hairline
// is only a reading if it can be told apart from the one beside it, and at the two
// wide stops a minute is 1.2px and 1.6px — a solid band of them is a grey smear,
// not a ruler. So the step follows the scale, which is her own answer ("a minute
// where it can be drawn"): half hours across a whole day, quarter hours at the
// standard reading, five minutes at Close, and a minute at the three closest stops,
// where she is lining two bars up and the minute is the thing she is looking at. A
// minute is also the floor — the day has nothing finer for a ruler to step by.
//
// A table and not a formula, because which step is worth drawing at which scale is
// a reading decision, and it should be possible to read it here. One entry per stop
// of PX_PER_MIN_CHOICES, read by index: a short table leaves tickStepFor with
// nothing to return, and an undefined step is not a coarse ruler, it is an infinite
// loop in rulerRow.
const TICK_MIN = [30, 15, 5, 1, 1, 1];

// The step of the grid carried down every row under the ruler. A second ladder,
// and not the ruler's own step, because a ruler may step by a minute where a grid
// may not: at the closest stop a minute is 3.2 pixels wide, and a line every 3.2
// pixels is not a grid, it is a wash of grey. So the grid takes the smallest step
// that is BOTH at least the ruler's step — which makes every grid line a tick as
// well, so the two can never disagree about where a minute is — and at least
// GRID_MIN_PX wide. 60 is deliberately absent: the hour line is already drawn by
// --hour-w, and a second layer under it would only double it.
const TICK_GRID_MIN = [1, 5, 15, 30];
const GRID_MIN_PX = 12;

export function renderScenario(root, state) {
  return plannerInto(root, state, false);
}

// The same day, drawn for somebody who did not plan it. Her words, 23 September
// 2026: "copy the chart into Prodcution line, but should not be editable, it become
// a dashboard for worker, give the worker good inform of what next for them, how
// long". So it is this file's own chart and not a second drawing of it: two
// renderers of one day drift apart, and this app's rule is that two screens may not
// disagree about the same day.
//
// A second EXPORT rather than a third argument on renderScenario, deliberately:
// app.js already passes the route's own params as the third argument, so an options
// object in that position would be a URLSearchParams and the board would switch
// itself on for any address carrying a query string.
export function renderBoard(root, state) {
  return plannerInto(root, state, true);
}

function plannerInto(root, state, board) {
  const sc = board ? boardScenario(state) : ensureScenario(state);
  const ask = board ? null : el("div", {});
  const readout = el("div", {});
  let dead = false;

  // What the day is DOING, as opposed to what it says it will do. Never stored:
  // `sc` IS the saved scenario, so anything written here would be saved with it and
  // a clock would start ticking again the next time she opened the screen. Held in
  // this closure for as long as the screen is open, and thrown away with it.
  const run = {
    on: false,          // whether the day is being walked through right now
    startedMs: 0,       // the wall clock when she pressed Start
    nowMin: 0,          // where the now-line is, in minutes from the start of her day
    lastMin: -1,        // the last minute already called, so no call is made twice
    lines: [],          // the now-line elements, one per window, kept across repaints
    rulerLeft: 0,       // the ruler's own offset, measured once per repaint
    pxPerMin: 1,        // this scenario's scale, so the line can be placed
    dayStart: 0,        // the clock minute 0 of THIS run, so its label reads true
    host: root,         // where a call card is drawn — dies with the screen
    timer: null,
    wake: null,
    audio: null,
    pending: null,      // the call waiting for an OK
    // The start times of every module, as they were before her first press on
    // the day's own card — so working the day backwards is never a one-way door.
    // Here for the same reason as everything else above: this is what the screen
    // is DOING, not something she has said about her bake day, so it is never
    // saved and it is gone when the screen is.
    dayBefore: null,
    // Whether this screen is a BOARD — the same chart with nothing to edit. Kept on
    // this record rather than threaded through every signature, because `run` already
    // reaches every row, every bar and every card here, and a flag passed down a dozen
    // calls is a dozen chances to forget one. It is true of `run` the same way the
    // rest of this object is: it is what the screen is DOING, not anything she said
    // about her bake day, so it is never saved.
    board: false,
    boardR: null,     // the computed day the board's own clock is placed against
    callsOn: false,   // whether a board is calling people (needs her press, for sound)
    nowNote: "",      // what the now-line says when the real clock is outside her day
    // The board's trains, one entry per person's row, and the calls they are measured
    // against. Both are what the screen is DOING and neither is ever saved: the trains
    // are emptied and rebuilt by every draw (see timeline) and the calls are the model's
    // own windows, keyed so a coach can be told when it is due without a second
    // spelling of "one minute before it starts".
    trains: [],
    calls: null,
    peoplePane: null, // the people's window itself, which the train is measured off
    // The workers' clock FACE: the one label at the top of the workers' window, which
    // every person's own ruler is read off. Held here for the same reason the trains are
    // — this is what the screen is DOING, and a repaint must be able to reach the face
    // and the strips it is read against without walking the tree for them. The rulers
    // themselves hang off their own rows (see trainRow), because each one belongs to the
    // person whose line it stands on.
    clockLab: null,
    // Whether the gesture that just ended was a DRAG rather than a tap. A drag that let
    // go over a coach must not also count as a tap on it, which is the same rule the
    // right-press pan has for cards (see isPrimaryClick) arrived at from the other side:
    // one gesture, one meaning.
    scrubbed: false,
    // The press that puts the clock back where it belongs, listened for on the document
    // rather than on any window, because no handler INSIDE a window can ever see a press
    // outside it — which is her clause 10 exactly ("when i click outside the person
    // window, the clock back to center"). Registered once for the screen and taken off
    // again with it, so a board cannot leave a listener behind on a screen that is gone.
    offPane: null,
    trainGeo: null,   // the widths the strips were last measured at
    // How far the whole line has been dragged sideways, in pixels, with 0 being the
    // line standing where the day puts it. It is ONE number for every person's window,
    // because her clause is that one hand moves them all together ("All windows move
    // together"), and a per-row offset would be four answers to one gesture.
    //
    // It is never stored. A drag is a thing she is DOING with the screen — she is
    // looking further along the line — and not something she has said about her bake
    // day, so it is held here and dies with the closure exactly as the rest of `run`
    // does.
    pan: 0,
    // How fast a run moves: minutes of her day per minute of the wall clock. 1 is her
    // day at its own pace; 10 and 60 are the two speeds a rehearsal is worth watching
    // at. A speed is about this sitting and not about her day, so it lives here and
    // never in her settings.
    speed: 1,
  };
  run.board = board;

  // Work a card asks for once it is actually on the screen. A block cannot measure
  // itself while it is being built — the node it would measure is not attached yet,
  // and a detached node answers every question with 0 — so it registers the job here
  // and `refresh` runs it immediately after the subtree is in the document. The
  // queue is emptied before the paint so a job can never run against a card that has
  // been replaced, and jobs are taken off it in one go so a job that registers
  // another cannot run twice in the same pass.
  const pending = [];

  // A repaint must never move what she is looking at.
  //
  // Her words, 23 September 2026: "Few problem of screen jump here and there. One
  // obvious one is the scenario windows, when i click, window reset." Every press that
  // changes the day repaints this screen wholesale — that is what refresh() is — and a
  // replaced element is a NEW element, which starts its own scroll at zero. So pressing
  // a button on a batch card threw both windows of the day chart back to the far left
  // and the top, and opening a day from the shelf threw the shelf back to its first
  // row. Measured at a phone's width with the modules' window panned 300 pixels: one
  // press of + 5 min on a batch card left both windows reading 0.
  //
  // Where she was is read before the paint and written back after the queued jobs have
  // run — and that order is the whole of it. A box can only hold a scroll once it has
  // the overflow to hold it, and the shelf's own height comes from one of those jobs;
  // and the measurement that job makes has to be taken while the box is still at its
  // own top, which a box just drawn always is. So nothing is scrolled until the jobs
  // have measured, and the jobs all run before the browser paints, so she never sees
  // the day sitting at its start either. Both windows are kept apart rather than given
  // one number: they pan together, and a repaint is not the place to discover that they
  // had drifted.
  // Every node of a class, in document order, and not just the first. One class can be
  // on more than one window: a board draws the train AND the planner's people's window,
  // and both carry `.tl-pane-people`. Keeping only the first would quietly lose the
  // second one's pan on the next repaint — the exact fault this exists to prevent, one
  // window along. Each node is remembered by its POSITION in that class's matches,
  // because a repaint replaces every node and identity does not survive it.
  //
  // A hand walk and not a query, for the reason this file already carries: the repaint
  // runs on every press and this has to be cheap and exact, and a selector the browser
  // answers but a test's stand-in screen does not is a rule the tests cannot see.
  const KEPT_SCROLL = [".tl-pane-proc", ".tl-pane-people", ".sc-shelf"];
  const findAllIn = (root, cls) => {
    const out = [];
    const want = ` ${String(cls).replace(/^\./, "")} `;
    const walk = (n) => {
      for (const c of Array.from((n && n.children) || [])) {
        if (c.nodeType !== 1) continue;
        if (` ${c.className} `.includes(want)) out.push(c);
        walk(c);
      }
    };
    walk(root);
    return out;
  };
  const scrollKept = () => KEPT_SCROLL.flatMap((sel) => findAllIn(readout, sel)
    .map((n, i) => [sel, i, Number(n.scrollLeft) || 0, Number(n.scrollTop) || 0]))
    .filter(([, , left, top]) => left || top);
  const scrollBack = (kept) => {
    for (const [sel, at, left, top] of kept) {
      const n = findAllIn(readout, sel)[at];
      if (!n) continue;
      if (left) n.scrollLeft = left;
      if (top) n.scrollTop = top;
    }
  };

  // Only the answers are repainted when something changes — never the fields —
  // so the box she is typing in keeps its place and its cursor.
  const on = {
    refresh: () => {
      if (dead) return;
      const kept = scrollKept();
      pending.length = 0;
      readout.replaceChildren(...blocks(sc, state, on, run));
      const jobs = pending.slice();
      pending.length = 0;
      for (const fn of jobs) fn();
      scrollBack(kept);
    },
    afterPaint: (fn) => { if (!dead) pending.push(fn); },
    // The one thing that does redraw the fields. Opening a saved scenario, or
    // renaming the one she is in, replaces the name, the start time and the
    // target as well as the modules — and with only the answers repainted the
    // top of the screen went on describing the scenario she had just left while
    // the timeline below drew the one she had opened. Only ever called for an
    // action she took deliberately, never while she is typing.
    reload: () => {
      if (dead) return;
      if (ask) ask.replaceChildren(askCard(sc, on));
      on.refresh();
    },
    // Every edit goes through the app's own save, which is what the sync engine
    // and the storefront both hang off — so the other phone's planner catches up
    // the same way the rest of the settings do.
    persist: () => save(state),
  };

  root.classList.add("wide");
  const tabbar = document.getElementById("tabbar");
  if (tabbar) tabbar.classList.add("wide");

  // The ask strip is left OUT on a board rather than passed as a null: the real
  // `replaceChildren` does not skip a null the way `el()` skips a null child, it
  // converts it with String() — so `replaceChildren(null, readout)` puts the word
  // "null" on the screen above the day.
  root.replaceChildren(...(ask ? [ask] : []), readout);

  // A board's clock is the REAL clock, and where it stands is worked out BEFORE the
  // first paint rather than after it. The strip at the top of a board says what each
  // person is at and what comes next, and that answer depends on the minute it is
  // now — so a strip drawn for minute zero with only the line moved afterwards would
  // be telling the worker the wrong thing until something else happened to redraw it.
  if (board) {
    const r0 = computeScenario(sc);
    run.dayStart = Number(sc.dayStartMin) || 0;
    run.boardR = boardDay(r0, run);
    const at = boardNow(sc, r0);
    run.nowMin = at.min;
    run.nowNote = at.note;
    // Her clause 10: "when i click outside the person window, the clock back to center."
    //
    // On the DOCUMENT and in the capture phase, because this is a statement about every
    // press that is NOT on the workers' line — on the chart, on a card, on the page's own
    // paper — and no handler inside the window can ever see a press outside it. Capture,
    // so that the press is answered before whatever it lands on opens a card over the
    // line it is about to move.
    //
    // A press ON the window is not this gesture, and the test for that is a walk up the
    // node's own parents rather than `closest`: this file already runs without `closest`
    // on the same reasoning elsewhere (see wireTrainClock), and a rule the browser answers
    // but the tests' own stand-in screen does not is a rule the tests cannot see.
    run.offPane = (e) => {
      if (dead) return;
      if (inTheTrains(e && e.target)) return;
      panBack(run);
    };
    const doc = docOf(root);
    if (doc && doc.addEventListener) doc.addEventListener("pointerdown", run.offPane, true);
  }

  on.reload();

  // The line is placed at once and then kept placed with no press at all — a
  // dashboard nobody has touched yet still has to say what time it is. It rides the
  // same interval slot the planner's walk-through uses, so the teardown below
  // (stopDay) is the whole undo for either of them.
  if (board) {
    const beat = () => tickBoard(run, sc, state, on);
    beat();
    run.timer = setInterval(beat, 1000);
  }

  return () => {
    dead = true;
    // The sheet outlives this screen, so it is told there is nothing left for it to
    // pan. Without this a right press on another screen's card would be handed a
    // chart that is no longer on the page.
    dragPanes.length = 0;
    // And the board's own listener comes off with it. A listener left on the document
    // would go on answering presses made on whatever screen she opened next, reaching for
    // a `run` whose windows are gone.
    const doc = docOf(root);
    if (run.offPane && doc && doc.removeEventListener) {
      doc.removeEventListener("pointerdown", run.offPane, true);
      run.offPane = null;
    }
    // Leaving the screen stops the day. A clock that went on ticking behind another
    // tab would be a call with nothing on screen saying where it came from.
    stopDay(run, on);
    root.classList.remove("wide");
    if (tabbar) tabbar.classList.remove("wide");
  };
}

// The day a BOARD draws.
//
// A board is a screen somebody else reads, and opening it must not put anything into
// her settings — least of all a whole scenario she did not build. `ensureScenario`
// seeds a bare scenario from the default, which is right on the planner (a screen she
// came to in order to lay a day out has to open on something) and wrong here: on the
// Production line it would write modules, a name, a start time and a target into her
// settings, and the sync engine would carry them to her other phone as though she had
// made them.
//
// So a board with no day of her own draws a deep copy of the default instead. Deep,
// and not a spread: the drawing is allowed to write an arrangement onto the modules it
// is given, and `{ ...DEFAULT_SCENARIO }` shares the module OBJECTS with the constant
// itself — the one write would then follow every future reader of the default. The
// copy is plain JSON data, so a JSON round-trip is exact.
function boardScenario(state) {
  const s = state.settings.scenario;
  if (s && Array.isArray(s.modules) && s.modules.length) return s;
  return JSON.parse(JSON.stringify(DEFAULT_SCENARIO));
}

// The day as a BOARD reads it: the computed day, with the clock its labels are written
// from moved to the minute this sitting began at when a run is walking it.
//
// Her words, 24 September 2026, choosing what a run does to the borrowed windows: "The
// planner dual window window start will change to the current time, person's working
// hour also offested from this current time." So a rehearsal started at 9 am reads its
// whole day from 9 am — the ruler's own hours, the coaches' clocks, the person's hours
// — instead of leaving a 4 am label under a clock that says 9.
//
// It is a SHALLOW override on a copy, and that is the whole of what it touches. The
// bars are drawn from each job's own minutes from the start of the day, so none of them
// moves: what changes is the number a minute is READ as, which is the one thing her
// sentence is about. Her stored scenario is never written — the copy is what the screen
// draws and it is thrown away with the screen.
//
// The copy is made only when the run has actually moved the start, so a board reading
// the real clock hands back the very object it was given and the two cannot drift.
function boardDay(r0, run) {
  if (!run || !run.board) return r0;
  const start = Number(run.dayStart);
  if (!Number.isFinite(start) || start === (Number(r0.dayStartMin) || 0)) return r0;
  return { ...r0, dayStartMin: start };
}

// The stored scenario, seeded on first open so the screen says something true
// before she has typed anything. Once seeded it is hers — a default never
// overwrites a number she has changed.
function ensureScenario(state) {
  const s = state.settings.scenario || (state.settings.scenario = {});
  if (!Array.isArray(s.modules) || !s.modules.length) {
    s.modules = DEFAULT_SCENARIO.modules.map((m) => ({ ...m }));
  }
  if (s.target == null) s.target = DEFAULT_SCENARIO.target;
  if (!s.name) s.name = DEFAULT_SCENARIO.name;
  if (s.note == null) s.note = DEFAULT_SCENARIO.note;
  if (s.dayStartMin == null) s.dayStartMin = DEFAULT_SCENARIO.dayStartMin;
  if (s.pxPerMin == null) s.pxPerMin = DEFAULT_SCENARIO.pxPerMin;
  return s;
}

// ── The clock ──────────────────────────────────────────────────────────────
//
// Every minute on this screen is counted from the start of HER day, and shown
// as the time of day it really is. So minute 0 with a 3 pm start reads "3:00
// pm", and the overnight retard crosses midnight the way it does in life.
function clockAt(dayStartMin, min) {
  return clockOf(dayStartMin + Math.round(Number(min) || 0));
}

function timeFieldValue(dayStartMin) {
  const m = ((Math.round(Number(dayStartMin) || 0) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function minutesOfTime(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins % DAY_MIN : null;
}

// ── A person's own hours ───────────────────────────────────────────────────
//
// Counted from the start of HER day, exactly as every other minute on this screen
// is, so moving the day's start slides everybody's hours with it and nothing is
// retyped. The boxes show clock times, which is what she reads; the store keeps
// minutes from that start, which is what survives the move.
//
// EMPTY IS AN ANSWER, and it has one spelling: an empty "from" is the day's own
// start (minute 0) and an empty "until" is the day's own end (minute 1440), so
// empty in both boxes is the whole day — which the model already spells as "no
// entry at all", the same absence every day read before this existed. That is why
// neither box needs a value written for her, and why clearing both really does put
// a person back to "here all day" rather than leaving a number behind.
function shiftFieldValue(dayStartMin, min) {
  if (min == null) return "";
  return timeFieldValue(dayStartMin + Math.round(Number(min) || 0));
}

function shiftMinutesOf(dayStartMin, value) {
  const m = minutesOfTime(value);
  if (m == null) return null;
  // Read forward from the day's start, the way the overnight retard is read: a
  // clock that falls before the start belongs to the day after it, never to a
  // negative minute. A pair that comes out back-to-front is refused at the card,
  // not silently wrapped here.
  const rel = m - (Math.round(Number(dayStartMin) || 0));
  return ((rel % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

// ── What she is asking for ─────────────────────────────────────────────────
function askCard(sc, on) {
  const name = el("input", { class: "input", type: "text", value: sc.name || "" });
  name.addEventListener("input", () => { sc.name = name.value; on.persist(); });

  const target = el("input", {
    class: "input", type: "number", inputmode: "numeric", min: "0", step: "1",
    value: sc.target == null ? "" : String(sc.target),
  });
  target.addEventListener("input", () => {
    const n = Number(target.value);
    if (Number.isFinite(n) && n >= 0) { sc.target = n; on.persist(); }
    on.refresh();
  });

  const start = el("input", {
    class: "input", type: "time", step: "900", value: timeFieldValue(sc.dayStartMin),
  });
  start.addEventListener("input", () => {
    const m = minutesOfTime(start.value);
    if (m == null) return;
    sc.dayStartMin = m;
    on.persist();
    on.refresh();
  });

  return el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 12px" },
      "Design the line the way you would build it: modules on a clock, each with its own minutes. Every figure here is a starting number you are meant to change — nothing on this screen reads an order or blocks a sale."),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "This scenario"),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "A scenario is the sum of its modules. Scenario 1 is the line you have now with no fridge in it — the fridge is in the list switched off, so you can see what adding one would buy without buying one."),
      el("div", { class: "field" },
        el("label", {}, "What this scenario is called"),
        name),
      el("div", { class: "field" },
        el("label", {}, "My day starts at"),
        start,
        el("div", { class: "hint" },
          "The time you begin. Every other time on this screen is counted from it, and the ruler along the top is drawn from it — so a module that starts an hour in reads one hour after this.")),
      el("div", { class: "field" },
        el("label", {}, "Pans a day you want from it"),
        target,
        el("div", { class: "hint" },
          "Raise this and the ladder below answers again: it names the module that stops you at this number, what to change to get past it, and what becomes the wall next."))));
}

function blocks(sc, state, on, run) {
  const r = run.board ? boardDay(computeScenario(sc), run) : computeScenario(sc);
  if (run.board) run.boardR = r;
  const climb = climbSteps(sc, r.target);
  // A board is the day drawn for somebody who did not plan it: the same chart, the
  // same read-only answer card, and a strip saying what is next for each person —
  // and none of the cards that change the day, because there is nothing here to
  // change. The two cards that are hers to edit (the climb ladder and the shelf of
  // saved days) are simply not drawn, rather than drawn dead.
  if (run.board) return [boardTopCard(r, sc, state, run, on), dayCard(r, sc, on, state, run)];
  return [
    answerCard(r), climbCard(r, climb, sc, on), dayCard(r, sc, on, state, run),
    parkedCard(r, sc, on), scenariosCard(sc, state, on),
  ];
}

// ── What it makes ──────────────────────────────────────────────────────────
function answerCard(r) {
  const kids = [
    el("p", { style: "margin:0 0 6px" },
      "This scenario makes ",
      el("b", {}, `${r.pansPerDay} ${r.pansPerDay === 1 ? "pan" : "pans"}`),
      r.target > 0 ? `, and you want ${r.target}.` : "."),
  ];

  if (r.target > 0 && r.shortfall > 0) {
    kids.push(el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `That is ${r.shortfall} ${r.shortfall === 1 ? "pan" : "pans"} short of the day.`));
  } else if (r.target > 0) {
    const spare = r.pansPerDay - r.target;
    kids.push(el("p", { class: "card-sub", style: "margin:0 0 10px" },
      spare > 0
        ? `That covers the day, with ${spare} ${spare === 1 ? "pan" : "pans"} to spare.`
        : "That is exactly the day — there is no slack in it at all."));
  }

  kids.push(el("div", { class: "plan-cost" },
    el("span", { class: "plan-cost-lab" }, "What this plan costs:"),
    el("b", {}, `${r.people} ${r.people === 1 ? "person" : "people"}`),
    el("span", { class: "plan-cost-dot" }, "·"),
    el("b", {}, `${hoursAndMinutes(r.personMin)} of hands`),
    el("span", { class: "plan-cost-dot" }, "·"),
    el("b", {}, `a ${hoursAndMinutes(r.runMin)} day`),
    el("div", { class: "card-sub", style: "margin:4px 0 0" },
      "The three things you are buying down together — the most hands at any one minute, the total minutes of somebody's time, and how long the run takes. Move a module, or one batch of it, and all three answer again — so a change that helps one and costs another is visible rather than hidden in a single number.")));

  kids.push(factGrid(r));
  kids.push(el("p", { style: "margin:10px 0 0" },
    el("b", {}, `${r.wall.icon} ${r.wall.name} sets your pace.`)));
  kids.push(el("p", { class: "card-sub", style: "margin:4px 0 0" }, wallWhy(r)));

  return el("div", {}, el("h2", { class: "section" }, "What it makes"), el("div", { class: "card" }, ...kids));
}

function factGrid(r) {
  return el("div", { class: "facts" },
    fact("Pans a day", String(r.pansPerDay), "the least any module turns out"),
    // The minutes a pan costs the line, counted off the slowest module. It is
    // labelled "minutes a pan" and NOT "cycle time", because "cycle" is now her own
    // word for one piece of work inside a batch, and one word with two meanings on
    // one screen is how a new vocabulary fails to take.
    fact("Minutes a pan", `${trim(round1(r.cycleMin))} min`, "off the slowest module"),
    fact("People needed", String(r.people), r.people === 1 ? "pair of hands" : "pairs of hands"),
    // "The day" would be a lie the moment the chiller cycles twice: a 12-hour
    // retard makes a run span more than 24 hours of clock, so the number beside
    // "pans a day" must not also claim to be a day. This is how long the run
    // takes, with the two real times of day it runs between.
    fact(
      "The run",
      hoursAndMinutes(r.runMin),
      `${clockAt(r.dayStartMin, r.firstMin)} → ${clockAt(r.dayStartMin, r.endMin)}`));
}

function fact(label, value, sub) {
  return el("div", { class: "fact" },
    el("div", { class: "fact-label" }, label),
    el("div", { class: "fact-value" }, value),
    el("div", { class: "fact-sub" }, sub));
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Why this module and not another — in the module's own numbers, and naming the
// tie when there is one. A tie matters: several modules passing the same small
// number is one shared limit wearing several hats, and relieving just one of
// them will not move the day at all.
function wallWhy(r) {
  const w = r.wall;
  if (!w.id) return "Switch a module on and the line will answer.";
  if (w.batch <= 0 || w.repeatsHeld <= 0) {
    return `${w.name} turns out nothing at all — it has no pans in a batch or no batches in the day.`;
  }
  const tied = r.on.filter((f) => f.id !== w.id && f.output === w.output);
  const above = r.on
    .filter((f) => f.output > w.output)
    .sort((a, b) => a.output - b.output)[0];

  const lead = `${w.repeatsHeld} ${w.repeatsHeld === 1 ? "batch" : "batches"} of ${w.batch} pans is ${w.output} pans a day`;
  if (w.capped) {
    return `${lead} — but a ${hoursAndMinutes(w.cycleMin)} batch only fits ${w.fitsInDay} times in a day, so running it more often is not something a day can hold. This one has to take more pans at once.`;
  }
  if (tied.length) {
    return `${lead} — and ${tied.length === 1 ? "one other module turns out" : `${tied.length} other modules turn out`} the same ${w.output}, so they are one limit between them. Relieving only one of them will not move the day.`;
  }
  if (above) {
    return `${lead}, and the next tightest is ${above.icon} ${above.name} at ${above.output}. That is what the day can deliver.`;
  }
  return `${lead}, and nothing else is anywhere near it. That is what the day can deliver.`;
}

// ── The climb ──────────────────────────────────────────────────────────────
//
// The method she described, run for her: raise the number until something stops
// her, relieve that one thing, and meet the next wall. Every rung is one module
// and one change, so the list reads as the order she would do them in.
function climbCard(r, climb, sc, on) {
  // The day above the number in the box — the way down. The climb only ever adds
  // a batch, so a day that overshoots had nothing to press at all.
  const down = r.target > 0 && r.pansPerDay > r.target ? descentSteps(sc, r.target) : null;
  const downReady = !!(down && down.steps.length);
  // The heading and the card's own opening line follow the SUBJECT — which way the
  // numbers say the day has to move — and not whether there is a button to press.
  // A day above her number with a batch too big to come down past has no button and
  // is still entirely about coming down; headed "The climb" it would read as the
  // wrong card, and the paragraph under the heading would be telling her to raise a
  // day that is already too high.
  const overshoot = r.target > 0 && r.pansPerDay > r.target;
  const kids = [
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      overshoot
        ? "Your day makes more than the number you asked for, so this is the ladder read the other way: the batches to take off to bring it down. Every rung of the climb adds a batch and none takes one away, which is why this half had to be built separately."
        : "Raise the day until something stops you, fix that one thing, and meet the next wall. This is that ladder, for the number you asked for."),
  ];

  // NOTE the order: `climb.reached` means the LADDER gets there, not that the
  // line already does. Read the wrong way round, a 12-pan line asking for 36
  // reports "already makes your 36" and never shows the ladder at all.
  if (r.target <= 0) {
    kids.push(el("p", { class: "card-sub" },
      "Type how many pans a day you want above, and the ladder appears here."));
  } else if (r.pansPerDay > r.target) {
    // The day, not the ladder, is what stops this one: every module at the day's
    // own number is holding it there, and running fewer batches in all of them is
    // the only way down that does not go through a bigger batch.
    kids.push(el("p", { style: "margin:0 0 6px" },
      el("b", {}, `This scenario makes ${r.pansPerDay} pans, and you want ${r.target}.`)));
    const spare = r.pansPerDay - r.target;
    kids.push(el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `That is ${spare} ${spare === 1 ? "pan" : "pans"} more than you asked for.`));
    if (downReady) {
      kids.push(el("div", { class: "climb-list" }, down.steps.map(descentRow)));
      kids.push(el("p", { class: "card-sub", style: "margin:10px 0 0" },
        down.reached
          ? `That brings it to the ${down.want} pans you asked for.`
          : `That brings it to ${down.end.pansPerDay} pans, which is as low as running fewer batches can take it.`));
      kids.push(el("div", { class: "popup-actions" },
        button("Use these numbers", () => applyDescent(sc, down, on), "primary")));
    } else {
      // The mirror of the climb's "it has to take more pans at once": a batch is
      // already bigger than the day she asked for, so no count of them is small
      // enough. Said plainly, because a card with no button reads as a bug.
      kids.push(el("p", { class: "card-sub", style: "margin:0" },
        `Running fewer batches cannot get there: one batch is ${down.tooBig.batch} pans, so this line can never come below ${down.tooBig.batch}. To go under that, a batch has to take fewer pans at once — ${down.tooBig.batch} in a batch becoming less than ${down.tooBig.batch}, on every module that is holding the day up.`));
    }
  } else if (r.pansPerDay === r.target) {
    kids.push(el("p", { style: "margin:0 0 6px" },
      el("b", {}, `This scenario already makes your ${r.target} pans.`)));
    kids.push(el("p", { class: "card-sub", style: "margin:0" },
      "Raise the number you want and the ladder will find the next thing in the way."));
  } else if (climb.steps.length) {
    kids.push(el("div", { class: "climb-list" }, ...climb.steps.map((s, i) => climbRow(s, i))));
    kids.push(el("p", { class: "card-sub", style: "margin:10px 0 0" },
      climb.reached
        ? `That reaches the ${climb.want} pans you asked for.`
        : `That takes it to ${climb.end.pansPerDay}. ${climb.end.wall.icon} ${climb.end.wall.name} is still the wall at the end, and running that one more often will not move it — it needs a different answer.`));
    // The wall that ends the ladder when the day, not her, is what stopped it.
    // This is the buying decision, said plainly: a pass that is already running
    // as often as a day allows cannot be run more often, so it has to take more
    // at once. For her chiller that is trays, and it is the whole reason this
    // screen can also tell her NOT to buy.
    const stuck = climb.end.wall;
    if (!climb.reached && stuck.id && stuck.repeatsHeld >= stuck.fitsInDay && stuck.batch > 0) {
      kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
        `A ${hoursAndMinutes(stuck.cycleMin)} batch fits ${stuck.fitsInDay} ${stuck.fitsInDay === 1 ? "time" : "times"} in a day, and it is already running that often — and a second one of it has been tried too. So this one cannot be run more often either way. It has to take more pans at once, which means ${stuck.batch} in a batch becoming more than ${stuck.batch}.`));
    }
    kids.push(el("div", { class: "popup-actions" },
      button("Use these numbers", () => applyClimb(sc, climb, on), "primary")));
  } else {
    kids.push(el("p", { class: "card-sub" },
      "Nothing on this ladder moves that number. Look at the modules below — one of them turns out nothing at all."));
  }

  // The same button sits on the heading as well as at the foot of the card. The
  // ladder can be a dozen rungs long — a day of nine modules gives nine — and a
  // control she has to scroll past the whole thing to reach is a control that has
  // gone missing. Both press the same thing, and the heading carries it only when
  // the card below really has something to apply.
  const canApply = r.target > 0 && ((r.pansPerDay < r.target && climb.steps.length > 0) || downReady);
  const apply = downReady ? () => applyDescent(sc, down, on) : () => applyClimb(sc, climb, on);
  return el("div", {},
    el("div", { class: canApply ? "section-row" : "" },
      el("h2", { class: "section" }, overshoot ? "The way down" : "The climb"),
      canApply ? button("Use these numbers", apply, "primary") : null),
    el("div", { class: "card" }, ...kids));
}

// One rung of the way down. It names every module the move touches, because a
// move that quietly rewrites eight of her modules and says one name would be a
// worse lie than the sentence this half exists to fix. Where they all change the
// same way — which is the usual case, since a day run in step is a day whose
// modules all hold it up together — one line says the change and the names follow
// it, so eight identical lines do not have to be read to learn one fact.
function descentRow(d) {
  const items = d.items;
  const one = items.length === 1;
  const same = items.every((x) => x.from === items[0].from && x.to === items[0].to);
  const change = (x) => `${x.from} → ${x.to} ${x.to === 1 ? "batch" : "batches"} in the day, at ${x.batch} pans a batch.`;
  return el("div", { class: "climb-step" },
    el("div", { class: "climb-num" }, "↓"),
    el("div", { class: "climb-body" },
      el("div", { class: "climb-what" },
        one
          ? `${items[0].icon} ${items[0].name}`
          : `All ${items.length} modules holding the day at ${d.before} pans`),
      ...(same
        ? [el("div", { class: "li-sub" },
          one ? change(items[0]) : `${change(items[0])} The same change in each of them.`)]
        : items.map((x) => el("div", { class: "li-sub" }, `${x.icon} ${x.name} — ${change(x)}`))),
      ...(!one
        ? [el("div", { class: "li-sub" }, items.map((x) => x.name).join(", "))]
        : []),
      el("div", { class: "li-sub" }, `That takes the day from ${d.before} to ${d.after} pans.`),
      // A move that changes nothing has to say why, or it reads as a dud. A module
      // whose batches are already capped by the day's own room holds its output
      // wherever its count is, so taking batches off it cannot move it.
      d.after === d.before
        ? el("div", { class: "li-sub" }, "On its own that buys nothing — the day's own limit is holding this one at the same number.")
        : null));
}

function climbRow(s, i) {
  // A rung is either "run it more often" or "have a second one", and the two
  // read nothing alike — one buys cycles out of the same day, the other buys
  // capacity she does not have. Naming which is the difference between a ladder
  // she can act on and a number that moved.
  const how = s.kind === "count"
    ? `${s.from} → ${s.to} of them, run ${s.patch && s.patch.repeats} times over.`
    : `${s.from} → ${s.to} ${s.to === 1 ? "batch" : "batches"} in the day, at ${s.batch} pans a batch.`;
  return el("div", { class: "climb-step" },
    el("div", { class: "climb-num" }, String(i + 1)),
    el("div", { class: "climb-body" },
      el("div", { class: "climb-what" }, `${s.icon} ${s.module}`),
      el("div", { class: "li-sub" }, how),
      s.kind === "count"
        ? el("div", { class: "li-sub" },
          "A day cannot hold this one any more often, so that is a second one to buy — and while it runs you need a second pair of hands if it is a job you do by hand.")
        : null,
      el("div", { class: "li-sub" },
        `That takes the day from ${s.before} to ${s.after} pans` +
          (s.wallThen && s.wallThen.id ? `, and then ${s.wallThen.icon} ${lower(s.wallThen.name)} is the wall.` : ".")),
      // A rung that moves nothing has to say why, or it reads as a dud. Tied
      // modules are one limit wearing several hats: the chiller's three batches
      // only free the day once all three have been raised.
      s.after === s.before
        ? el("div", { class: "li-sub" }, "On its own that buys nothing — the other batches of this same limit are still where they were. Keep going.")
        : null));
}

// The one tap that makes the ladder real. Each rung writes the change the ladder
// itself computed — `repeats`, or `count` with the cycles that go with it — and
// only on the modules the ladder named. Every other number she has typed is left
// alone.
function applyClimb(sc, climb, on) {
  const to = new Map(climb.steps.map((s) => [s.id, s.patch || { repeats: s.to }]));
  sc.modules = sc.modules.map((m) => (to.has(m.id) ? { ...m, ...to.get(m.id) } : m));
  on.persist();
  toast("The ladder is in the modules now");
  on.refresh();
}

// The way down, applied. Deliberately NOT a call into applyClimb with a reshaped
// ladder: the move names several modules at once, and it writes `repeats` and
// nothing else. `starts` is left exactly as she set it — see descentSteps for why
// the climb re-spaces the times and this does not.
function applyDescent(sc, down, on) {
  const to = new Map(down.steps[0].items.map((it) => [it.id, it.to]));
  sc.modules = sc.modules.map((m) => (to.has(m.id) ? { ...m, repeats: to.get(m.id) } : m));
  on.persist();
  toast("The day is down to the number you asked for");
  on.refresh();
}

// ── The day ────────────────────────────────────────────────────────────────
//
// The timing diagram: one row per module, the whole day across, then one row per
// person and a total row underneath. It is the thing the capacity screen cannot
// draw — not how fast a station is, but WHEN it runs and which of those times
// collide.
// The day's own card. Two paragraphs used to stand above the chart — the one
// explaining how to read it, and the one naming the moment her day hangs from —
// and she asked for both of them gone, which is 330 pixels of a phone screen she
// no longer scrolls past to reach the chart. Nothing is lost by it: the reading of
// the chart is section 23 of the operations guide, and the button that moves the
// day now says its own name in the row under the chart, so the move is findable
// without a sentence pointing at it.
function dayCard(r, sc, on, state, run) {
  return el("div", {},
    el("h2", { class: "section" }, run.board ? "The day as planned" : "The day"),
    el("div", { class: "card tl-card" },
      // The scale, the People box, the two day-shaping presses and "New module" are
      // all ways of changing the day, so a board has none of them — it is the day as
      // the planner left it. Nothing is hidden behind them: the chart below is the
      // whole of what they were for.
      run.board ? null : controlsRow(r, sc, on, state, run),
      timeline(r, sc, on, state, run),
      batchNote(r),
      clashNotes(r, state)));
}

// Her rule's other half, said out loud: "say when it does not". A module whose
// batch count is not the module before it is named here, with both numbers, so a
// count that differs is a sentence she reads rather than a difference she has to
// spot. Nothing is locked by it — the day is drawn exactly as the numbers say.
function batchNote(r) {
  const off = batchMismatches(r.modules);
  if (!off.length) return null;
  const shown = off.slice(0, 3);
  const rest = off.length - shown.length;
  return el("div", { class: "tl-notes" },
    el("div", { class: "tl-note" },
      el("div", { class: "tl-note-who" },
        "Batch counts that differ from the module before them"),
      ...shown.map((m) => el("div", { class: "tl-note-job" },
        `${m.name} — ${m.repeats} ${m.repeats === 1 ? "batch" : "batches"}, ` +
        `${m.before.name} — ${m.before.repeats}`)),
      rest
        ? el("div", { class: "tl-note-job" },
            `…and ${rest} more ${rest === 1 ? "module" : "modules"} that differ.`)
        : null,
      el("div", { class: "tl-note-how" },
        "This is only a note, not a rule: the day runs on the numbers you have put in. Changing a module's batch count carries the ones after it with you and stops where a module has a number of its own — set that one to the same, or leave the day as you planned it.")));
}

function controlsRow(r, sc, on, state, run) {
  // The jobs that actually need hands, and how many LINES those jobs are. The two
  // numbers differ only when a module she has two of is drawn as two lines — and
  // that is exactly when the People box below is about to hand out a person per
  // line rather than per module, so it is also when its wording has to change.
  const jobs = r.modules.filter((m) => m.on !== false && Number(m.touchMin) > 0);
  const lineJobs = jobs.reduce((t, m) => t + Math.max(1, m.lines || 0), 0);
  const perLine = lineJobs > jobs.length;

  // The scale as a step rather than as six chips. Chips were the stops of one dial
  // said as buttons, and she uses two of them: the step she makes is wider or
  // closer, so those are the two buttons and the stop she is standing on is the
  // word between them. Nothing about the scale itself changed by adding two stops —
  // the same pixels per minute, the same stop she left it on, and `at` and the two
  // ends of the dial are read off the list's own length rather than off a count.
  const at = PX_PER_MIN_CHOICES.findIndex((px) => Math.abs(r.pxPerMin - px) < 0.01);
  const step = (by) => {
    const to = Math.max(0, Math.min(PX_PER_MIN_CHOICES.length - 1, at + by));
    if (to === at) return; // the end of the dial is not a move
    sc.pxPerMin = PX_PER_MIN_CHOICES[to];
    on.persist();
    on.refresh();
  };

  return el("div", { class: "tl-ctl" },
    el("div", { class: "tl-ctl-group" },
      el("span", { class: "tl-ctl-lab" }, "Scale"),
      el("button", {
        type: "button", class: "tl-step", disabled: at <= 0,
        "aria-label": "A wider view — more of the day on the screen",
        onclick: () => step(-1),
      }, "−"),
      el("span", { class: "tl-step-name" }, at < 0 ? `${r.pxPerMin}x` : SCALE_NAMES[at]),
      el("button", {
        type: "button", class: "tl-step", disabled: at >= PX_PER_MIN_CHOICES.length - 1,
        "aria-label": "A closer view — the minutes, larger",
        onclick: () => step(1),
      }, "+")),
    el("div", { class: "tl-ctl-group" },
      el("span", { class: "tl-ctl-lab" }, "People"),
      peoplePicker(r, sc, on, state, perLine)),
    // The day worked backwards, as a real button in the row rather than only behind
    // a tap on one particular bar — and, since v157, as nothing but the button.
    //
    // v152 first shipped this place as a chip that NAMED the moment and then told
    // her which bar to tap, and she reported it as what it looks like: "why no
    // button for work backward, this is to reeposition the batches latest start
    // time". A control shaped like a button whose whole effect is to send her
    // elsewhere is a control that reads as dead. So this one does the work — the
    // card's own press, one press, no card in the way — and the card keeps the
    // whole chain laid out and the way back.
    //
    // It is drawn on every line, including one already worked back and one too
    // short to work back along, because a button that comes and goes reads as a
    // fault. On a finished day the press says so and writes nothing, which
    // moveDayBack already answers; on a line with no module above its last one the
    // card does not exist at all, so saying so is workDayBack's own job.
    //
    // The label that used to stand above it is gone: it re-stated the button's own
    // name and, at 375 pixels, wrapped to two lines — 54 pixels of a phone screen
    // spent explaining a button that already says what it does.
    el("div", { class: "tl-ctl-group" },
      el("button", {
        type: "button", class: "tl-chip",
        // No popup to repaint from here: on.refresh() already redraws this whole
        // card, and this row is inside it. moveDayBack takes a second repaint for
        // the popup that opened it; from the row there is none to give it.
        onclick: () => workDayBack(r, sc, on, () => {}, run),
      }, "Work the day backwards"),
      // The way back, on the button that moved the day, and only while there is
      // something to put back — Stop beside Start's pattern. Without it a press
      // from here would move her whole day and leave the undo three taps away on
      // one bar, which is the same hunt this button exists to end.
      //
      // `run` and never `state`: the snapshot lives on the screen's own record, so
      // a press here and a press on the card share one snapshot and one way back.
      // Writing it to the saved state instead would put it in her data blob, where
      // a reload would resurrect a day she has since left and offer to put her
      // times back to a shape that is no longer hers.
      run.dayBefore
        ? el("button", {
          type: "button", class: "tl-chip",
          onclick: () => undoDayBack(r, sc, on, () => {}, run),
        }, "Put my start times back")
        : null),
    el("div", { class: "tl-ctl-group" },
      el("span", { class: "tl-ctl-lab" }, "Walk the day"),
      el("button", {
        type: "button", class: `tl-chip${run.on ? " on" : ""}`,
        onclick: () => (run.on ? stopDay(run, on) : startDay(run, sc, state, on)),
      }, run.on ? "Stop" : "Start the day now"),
      el("button", {
        type: "button", class: "tl-chip",
        onclick: () => {
          // Nothing to set here: who gets called is set on the person's own card,
          // where their name is. This only says how many of them it is — a number
          // she can see without opening anybody, and a signpost when it is none.
          const n = callCount(r, state);
          toast(n
            ? `${n} of ${r.rows.length} ${r.rows.length === 1 ? "person" : "people"} will be called — one minute before their next job. Tap a person's row to name them or to stop their calls.`
            : "Nobody will be called. Tap a person's row below the day and switch their calls back on.");
        },
      }, callCount(r, state) ? `🔔 ${callCount(r, state)} called` : "🔔 Calls off")),
    el("div", { class: "tl-ctl-group" },
      el("button", {
        type: "button", class: "tl-chip add",
        onclick: () => addModule(sc, on),
      }, "＋ New module")));
}

// One of the two things the People box does to the day, in the words it has
// always toasted with. The arrangement now in force is the box's closed label —
// "one a module", "one to a line", "sharing them out", "combined" — and a day she
// arranged herself says exactly that, because calling it "one a module" would be a
// promise about a day nobody made that way.
function peopleState(r, sc, perLine) {
  const mods = sc.modules || [];
  if (Object.keys(sc.merges || {}).length) return "Combined";
  // A crew counts as an arrangement only where it NAMES somebody. A day written back
  // whole — which is what every hand-over does — carries a crew on every module, and
  // a crew of zeroes is "whoever is free" said five times: reading it as one person
  // per job would have the box naming an arrangement that is not on the screen, on a
  // day that has not moved at all. A person anywhere in the crew still reads as the
  // arrangement it is.
  if (mods.some((m) => (m.crew || []).some((p) => Number(p) > 0))) return perLine ? "One to a line" : "One to a module";
  // A stretch she has placed by hand counts as hers even where no module carries a
  // person: a hand-over is written per stretch (slotPerson), and a day with one on it
  // is not "sharing them out" any more — the box would be naming an arrangement that
  // is no longer in force. Only a stretch given to a PERSON counts; a stored 0 is the
  // way back to the day's own arrangement and leaves the day sharing them out.
  if (mods.some((m) => Number(m.person) > 0
    || Object.values(m.slotPerson || {}).some((v) => Number(v) > 0))) return "Your own";
  return "Sharing them out";
}

// The hands, as a drop-down. Three arrangements, each of which redraws the whole
// day's people at once, behind one box that says which of them is in force now.
// It was three chips and it wrapped to two lines on her phone; the box is the one
// line, and it still names the arrangement rather than hiding it, because a
// control that does not say what it has done is a control she has to open to find
// out.
//
// Both of the full-day presses also take back every stretch she placed by hand, and
// that is not a detail of the writing. A hand-placed stretch is read FIRST, ahead of
// the module's own person (touchWindows), so a stretch left behind would keep the old
// arrangement on the chart while the box said the day had been handed back — the press
// would promise one day and draw another. Measured on her own day: pressing "Share them
// out" left solo_top's hand-placed stretch on Wei and the box still reading "Your own".
//
// And because taking a stretch back is a decision of HERS being overruled, the press
// says how many it took back rather than doing it quietly. A day with none adds nothing
// to the sentence: a count of zero is not news.
function handPlacedCount(sc) {
  return (sc.modules || []).reduce((n, m) => n
    + Object.values(m.slotPerson || {}).filter((v) => Number(v) > 0).length, 0);
}

function handedBack(n) {
  if (!n) return "";
  return ` ${n} ${n === 1 ? "stretch you had placed by hand goes" : "stretches you had placed by hand go"} back on the day's own arrangement.`;
}

// A module with nobody on it, hand-placed or otherwise. `slotPerson` is deleted rather
// than set to an empty object: "not placed by hand" has one spelling in this app, and it
// is the key not being there at all.
function unarranged(m) {
  const out = { ...m, person: 0, crew: undefined };
  delete out.slotPerson;
  return out;
}

function peoplePicker(r, sc, on, state, perLine) {
  const sel = select([
    {
      value: "one",
      label: perLine
        ? "One a line — a person for each line, one job each"
        : "One a module — a person for each job, one job each",
    },
    { value: "share", label: "Share them out — as few hands as can cover the day" },
    { value: "combine", label: "Combine two people…" },
  ], "", () => {
    const pick = sel.value;
    // Back to the arrangement the box names, whatever this turns out to be: the
    // menu is three presses, not a fourth setting standing beside them.
    sel.value = "";
    if (pick === "one") {
      // Her starting point: one person standing at every job that needs hands. And,
      // like the press below, it takes back every stretch she had placed by hand —
      // one left behind would sit on its own row inside the new arrangement, so the
      // day would be one-to-a-module everywhere except the stretch nobody assigned.
      // A job is a LINE, so a module she has two of takes two people here and not
      // one — which is what she wants this for: each worker on one line, learning
      // one job rather than wearing every hat in the day. The clashes that appear
      // are exactly what she then slides the modules to remove, and it is the
      // honest first answer, because a person per line really does cover the day.
      const dropped = handPlacedCount(sc);
      let n = 0;
      sc.modules = sc.modules.map((m) => {
        const needsHands = m.on !== false && Number(m.touchMin) > 0;
        if (!needsHands) return unarranged(m);
        const have = Math.max(1, linesInForce(m));
        const crew = [];
        for (let i = 0; i < have; i += 1) { n += 1; crew.push(n); }
        const out = { ...m, crew, person: crew[0] };
        delete out.slotPerson;
        return out;
      });
      // Every job has just been given its own person, so any combination label
      // from before is describing a day that no longer exists.
      sc.merges = {};
      on.persist();
      toast(`${n} ${n === 1 ? "person" : "people"}, one to ${perLine ? "a line" : "a module"} — now move the modules closer together.${handedBack(dropped)}`);
      on.refresh();
    } else if (pick === "share") {
      const dropped = handPlacedCount(sc);
      sc.modules = sc.modules.map(unarranged);
      // Nobody is named any more, so nothing is being covered by anybody — a
      // leftover combination label would be a lie about the day.
      sc.merges = {};
      on.persist();
      toast(`Sharing them out — every job reassigned to as few hands as can cover the day.${handedBack(dropped)}`);
      on.refresh();
    } else if (pick === "combine") {
      combinePopup(r, sc, on, state);
    }
  }, peopleState(r, sc, perLine));
  sel.className = "tl-select";
  return sel;
}

// How many of the people on the screen the day would actually call.
function callCount(r, state) {
  const calls = state.settings.personCalls || {};
  return r.rows.filter((row) => calls[row.person] !== false).length;
}

// How many modules are waiting on the one above them.
function chainedCount(r) {
  return r.on.filter((m) => m.follow).length;
}

// The line's own floor, set on every module at once. This was a chip in the
// control row until v157 — she asked for that row to be shorter, and for what it
// said to sit on the module's own card, which is where the setting has always been
// made one module at a time.
//
// It goes through the model's own writer, so the whole line and one module's card
// cannot end up with two answers to "what is this module set to". The bulk press
// sets the floor, which is the answer this has always given; the tight follow is a
// per-module choice, made on that module's own card.
function chainAll(sc, on, yes) {
  sc.modules = sc.modules.map((m) => {
    if (m.on === false) return m;
    const next = { ...m };
    setStartMode(next, yes ? "wait" : "own");
    return next;
  });
  on.persist();
  on.refresh();
  toast(yes ? "Every module now waits for the one above it" : "Nothing waits any more — your own times are in charge");
}

// Which modules are waiting on the one above them, said by name — the sentence the
// chain card used to open with, now read on the module's own card. Zero is the
// honest answer for a line whose times she placed herself, and it is worth saying
// out loud: nothing on the screen is being moved behind her back.
function chainSentence(r) {
  const waiting = r.on.filter((m) => m.follow);
  return waiting.length
    ? `${waiting.length} of your ${r.on.length} modules ${waiting.length === 1 ? "waits" : "wait"} on the module above: ${waiting.map((m) => `${m.icon} ${m.name}`).join(", ")}. The rest keep the times you placed.`
    : "Nothing is waiting right now, so every module keeps the time you gave it. Switch the chain on and the line answers as one line rather than a set of separate jobs.";
}

function addModule(sc, on) {  const id = newModuleId(sc.modules);
  sc.modules = [...sc.modules, blankModule(id)];
  on.persist();
  on.refresh();
  const added = sc.modules.find((m) => m.id === id);
  toast("New module added — switch it on once its numbers are in");
  editModule(added, sc, on, true);
}

function timeline(r, sc, on, state, run) {
  const trackW = Math.round(r.windowMin * r.pxPerMin);
  // Two elements, one minute: the hairline down the day, and the reading that
  // rides beside it. The reading is not a child of the line because the line is
  // drawn at 75% opacity, which makes a stacking context — a reading inside it
  // could never be lifted over the pinned clock strip. See .tl-cursor-lab.
  const cursor = el("div", { class: "tl-cursor", hidden: true });
  const lab = el("span", { class: "tl-cursor-lab", hidden: true });
  // The same hairline again, in the people's window. It takes no pointer of its
  // own — the reading is taken in the modules window and copied here — and that is
  // the whole reason it exists: the two windows pan together and share the same
  // 156px name column, so a line lands on the same minute in both, and a hairline
  // that stopped at the seam between them would stop exactly where the question
  // she asks of it begins. See wirePaneScroll for the panning and wireTimeCursor
  // for the placement.
  const cursor2 = el("div", { class: "tl-cursor", hidden: true });
  // The clock the day is being walked against. Its own line, its own label, and a
  // different colour from the hairlines she points with — a reading she takes must
  // never be mistaken for the minute the day is actually at. Drawn in both windows
  // from one computation, for the same reason the hairline is.
  const nowLab = el("span", { class: "tl-now-lab" }, "now");
  const now = el("div", { class: "tl-now", hidden: !(run.on || run.board) }, nowLab);
  const nowLab2 = el("span", { class: "tl-now-lab" }, "now");
  // The day's clock stands in the people's window on both screens, because the people's
  // window is the planner's own on both screens. v184 hid it on a board — the train had
  // taken that window over and its strip carries no minute axis for a clock to stand on
  // — but she put the window back (see the note at the train, below), so the line comes
  // back with it. One clock, placed in both windows from one computation, as it always
  // was.
  const now2 = el("div", { class: "tl-now", hidden: !run.on }, nowLab2);
  // The clock, drawn at the top of the modules window. Held here rather than found
  // again by class name, so the cursor is wired to the clock the chart actually
  // drew.
  const headClock = rulerRow(r, trackW);
  // The modules window: the clock strip, then the day's modules. Its own scroll
  // container, so the day's rows scroll under their own pinned clock without the
  // people's window having to move with them.
  const proc = el("div", { class: "tl tl-pane-proc" },
    el("div", { class: "tl-inner" },
      headClock,
      ...r.modules.map((m, i) => moduleRow(r, m, i, trackW, sc, on, state, run)),
      // The day's own reading, drawn last so it runs over every bar rather than
      // under one. See wireTimeCursor for what it does and who it answers to.
      cursor,
      lab,
      // And the clock, drawn over everything, because it is the one thing on the
      // chart that is happening rather than planned.
      now));
  // The people are the answer to her question, so they are drawn as what they are:
  // a row each, carrying the modules that row attends. See .tl-people for why the
  // block is opaque.
  //
  // The stacked "People at once" row is NOT here, and that is her own call of 23
  // September: "im thinking of remove the people at once?", settled by "you can just
  // show when there is overlapping highligt in red box, like previously have". She is
  // right that the day already says it three times without that row: the red outline
  // on a colliding bar, the colliding stretch of a person's own row (the same
  // outline), the red line in their tip, and the collisions written out under the
  // diagram by clashNotes. It was a second copy of one person's own row until she
  // hires, and it comes back in one line when there is a second pair of hands to
  // weigh up. Nothing stored changed, and no collision is hidden by its going.
  //
  // On a board this window is the TRAIN — one coach per job, joined in the order they
  // happen — and the class on the pane is what says so to the stylesheet. `trains` is
  // emptied first so a redraw leaves no entry behind from the screen that was there
  // before; `calls` is the model's own windows keyed by job, which is how a coach knows
  // when it is due without the view inventing a second rule for it.
  run.calls = run.board ? new Map(callWindows(sc).map((w) => [jobKey(w), w])) : null;
  run.trains = [];
  // The train's two numbers, decided BEFORE a single row is built, because a coach's own
  // `left` and `width` are computed as it is built (see trainRow and coachGeom). A row
  // drawn before its scale was known would carry `left:NaNpx` in its style — a coach that
  // has vanished rather than an error anybody sees, which is the one kind of fault this
  // part of the screen is written to refuse.
  //
  // They are the day's OWN scale and the day's own length, so the train is measured in the
  // same units as the modules' window above it (whose track is the same two numbers) and
  // the two windows can never come to disagree about where a minute is. `run.pxPerMin` is
  // set below from the same `r` for the same reason.
  run.scale = trainScale({ pxPerMin: r.pxPerMin });
  run.lineW = Math.round(lineWidth(r.windowMin, run.scale));
  // The workers' CLOCK FACE — her "the current time at the center sharing with all
  // person" — and ONE face for the whole window.
  //
  // v185 drew one red line spanning every row, with this label riding it. She has
  // changed the arithmetic of it, 24 September 2026: "Each of the person line has a clock
  // line at centre of line", and then, on the label, "the 2nd person and subsequent person
  // have the centered red ruler, but the 2nd and other don have to show the clock face."
  // So every person's window now carries its own ruler — see trainRow, and placeTrain for
  // the one number that stands all of them — and the face is drawn ONCE, here, at the top
  // of the window, at exactly the pixel every one of those rulers stands on.
  //
  // Once, and not on the first row, for a reason that is about being able to read it at
  // all: a ruler is drawn inside its own track, and the track is the clip line that stops
  // a translated train running under the name column (see .tl-track). A label riding a
  // line at the track's own left edge — which is where the sweep puts it for the first
  // half of a walk, and where a run spends its first minutes — would be cut in half by
  // that clip. Up here it is on paper of its own and can never be clipped, and there is
  // still exactly one reading of the time on the window, which is the whole of her clause.
  //
  // Its label is the CLOCK TIME and never the word "now". The modules above still draw
  // the day's own now-line with its own label, and two lines on one screen both saying
  // "now" would be two answers to one question.
  const clockLab = el("span", { class: "tl-clock-lab" });
  const clockHead = el("div", { class: "tl-clock-head" }, clockLab);
  // The people's window, on BOTH screens and unchanged: a row each, carrying the modules
  // that row attends, on the day's own minute axis. v184 replaced this window with the
  // train on a board; she has put it back — "the production page start with the person's
  // window the train inside, after the N person, we have the 2windows that we bring in
  // from scenario planning, we keep it original" — so a board now carries the train
  // ABOVE the planner's two windows and leaves the two windows below it exactly as the
  // planner draws them, both hairline and day's clock included.
  const people = el("div", { class: "tl tl-pane-people" },
    el("div", { class: "tl-inner" },
      el("div", { class: "tl-people" },
        ...r.rows.map((row) => personRow(r, row, trackW, sc, on, state, run))),
      cursor2,
      now2));
  // The train: a board's own window, built only there so the planner's tree keeps its
  // two children exactly as they were. It sits FIRST on the page, above the planner's
  // two windows, because the line a worker reads is the thing that answers "what is
  // next and has anybody picked it up" — and the chart underneath is what answers "why
  // is it then".
  //
  // It keeps the class `.tl-pane-people.train` rather than a class of its own, so the
  // whole train block in the stylesheet goes on hanging off one selector, and it is
  // still the FIRST `.tl-pane-people` on the page — which is what the board's own
  // readers (run.peoplePane, and the tests) mean by the people's window on a board.
  const train = run.board ? el("div", { class: "tl tl-pane-people train" },
    el("div", { class: "tl-inner" },
      el("div", { class: "tl-people" },
        // The walk's own presses first — her "these button are for the person's
        // windows" — then the clock face, then the lines they both belong to.
        boardControls(r, sc, state, on, run),
        clockHead,
        ...r.rows.map((row) => trainRow(r, row, sc, on, state, run))))) : null;
  // Who the people's window IS, kept on the run rather than looked up by class
  // afterwards. The train's measures are taken from this element's own width, and a
  // walk of the tree would find the window the chart drew a moment ago; this is the
  // one that is on the page. Replaced by every draw, which is exactly right — the
  // measurement is always of the strip that is standing.
  run.peoplePane = train || people;
  run.clockLab = clockLab;
  // --hour-w is the hour line every track has always drawn. --tick-w is the grid
  // v160 carries down under it, set from the same scale so the two stay in step —
  // see gridStepFor for why it is a coarser step than the ruler's at the two
  // closest stops.
  //
  // Both are set HERE, on the wrapper, and inherited by both windows. Two inline
  // copies could drift apart and nothing on the screen would say so, and the whole
  // point of the grid is that the lines and the ruler cannot disagree about where a
  // minute is.
  //
  // The two windows are stacked with nothing at all between them, and each one's own
  // horizontal scrollbar is the pan. v167 put a shared slider here as well; she took
  // it back out — "since the both windows have their own slider, additional slider is
  // redundent. Remove that" — and the half of that release she wanted, the two
  // windows staying in step, is what wirePaneScroll still does.
  //
  // v171 adds the third way to move a window: right-press and hold and the day comes
  // with her hand, both ways at once. See wirePaneDrag — and isPrimaryClick, which is
  // the other half of that release, the half that keeps a press for panning from
  // opening a card.
  // The children, in the order she asked for them: on a board the train stands first and
  // the planner's two windows follow it; on the planner itself the two windows are all
  // there is, exactly as they always were. One list, built once, so the board and the
  // planner cannot come to disagree about what the chart is made of.
  const wrap = el("div", {
    class: "tl-wrap",
    style: `--hour-w:${Math.round(60 * r.pxPerMin)}px;--tick-w:${Math.round(gridStepFor(r.pxPerMin) * r.pxPerMin)}px`,
  }, ...(run.board ? [train, proc, people] : [proc, people]));
  // The header, kept so the now-line can be placed against it. ONE origin: both
  // windows put their ruler's track at the same offset, because the name column is
  // 156px wide in both and box-sizing is border-box throughout, so the same left is
  // correct in either — which is what lets one computation place both lines.
  run.lines = [now, now2];
  run.ruler = trackOf(headClock);
  run.pxPerMin = r.pxPerMin;
  // A board places its line from the real clock, so it keeps the day it was drawn
  // against: the minute the line sits on is read against the day's own width and
  // its own start, and reading those off a stale snapshot is how a clock ends up
  // naming a minute the chart no longer has.
  if (run.board) run.boardR = r;
  if (run.on) placeNow(run);
  // The trains are measured once the subtree is on the page, because that is the first
  // moment the pane has a width at all. Registered here and run by `refresh`, which is
  // the same door the shelf's own measurement goes through — see trainGeometry.
  //
  // And then PLACED, in the same job and for the same reason. A freshly built strip has
  // no transform at all and a freshly built ruler has no `left`, and the only other thing
  // that writes either is the beat — a second away. So every press that repaints this
  // screen (a coach ticked, the bell thrown, Start, Stop, a Clear) threw the whole train
  // back to the left edge of its line and blanked the clock face for up to a second, which
  // is the one thing this app refuses to do to a screen somebody is reading: a repaint must
  // never move what she is looking at. The measurement comes first because `restate` places
  // every strip from the widths and the segment map `trainGeometry` has just written.
  if (run.board) on.afterPaint(() => { trainGeometry(run); restate(run, state); });
  // The two windows are tied together by their SHARED MINUTE AXIS: a scroll in one
  // puts the other at the same pixel, and a reading taken in one is drawn in the
  // other. That is now true on BOTH screens, because the planner's people's window is
  // on both — she put it back on the board, so the guard v184 put here is gone with it.
  //
  // The train is the odd one out and it is deliberately left out of all three tie-ups.
  // It has no minute axis at all — a coach is the same width whatever the job is worth,
  // and the strip never scrolls sideways — so a scroll it cannot make, a drag that would
  // scroll it if it could, and a hairline standing on a strip with no minutes under it
  // would be three quiet lies. Her architecture, 24 September: "The train is its own
  // strip." Only the people's window takes those wires now, and the train takes none.
  wireTimeCursor(proc, r, cursor, lab, headClock, cursor2);
  wirePaneScroll(proc, people);
  wirePaneDrag(proc, people);
  // The workers' clock is read by hand and only there: the planner points at a day it
  // is walking, and a drag in the workers' window on a board is somebody asking "how
  // long have I got" rather than moving the day. See wireTrainClock.
  wireTrainClock(train, run);
  return wrap;
}

// The clock row's own track. The row is its name cell and the track it names, in
// that order, because rulerRow builds it that way — and it is read here rather
// than looked up by class afterwards so that what the cursor is wired to is what
// the chart drew.
//
// Array.from and not find on the collection itself: a browser hands back an
// HTMLCollection, which has no find at all, and the shim the tests run under hands
// back an array, which has. Written the short way the screen threw on load and
// every test stayed green.
const trackOf = (clock) => Array.from((clock && clock.children) || [])
  .find((c) => c.nodeType === 1 && /\btl-track\b/.test(c.className || "")) || null;

// Move the now-line to where the day has got to. Only its own position is
// touched — nothing else on the chart is repainted, because the day's numbers do
// not change as the clock runs and repainting them every second would fight the
// scroll she is reading.
function placeNow(run) {
  const lines = run.lines;
  if (!lines || !lines.length || !run.pxPerMin) return;
  // The ruler's own offset is measured HERE and not when the chart was built,
  // and that is the whole point of the line being right: the chart is assembled
  // before it is on the page, and an element that is not on the page has no
  // offset at all — so the offset read at build time is always zero, and the line
  // was drawn in the name column, 138px and about an hour and a half left of the
  // minute it was naming. It moves the way she scrolls, so it is asked for its
  // offset again each time rather than cached.
  const ruler = run.ruler && run.ruler.isConnected ? run.ruler : null;
  const left = ruler ? ruler.offsetLeft : (run.rulerLeft || 0);
  const at = `${Math.round(left + run.nowMin * run.pxPerMin)}px`;
  // A board reading a real clock that has not reached her day yet (or has gone past
  // it) parks the line at the day's own edge and says so, rather than wrapping round
  // into a part of the day that is not the one on the screen. `nowNote` is that
  // sentence; on the planner's walk-through, and on a board inside the day, it is
  // empty and the label is simply the time of day the line is standing on.
  const label = run.nowNote || clockOf(run.dayStart + run.nowMin);
  // Both windows: one line is the day happening in the modules, the other is it
  // happening to the people. One left serves both, for the reason run.ruler is one
  // origin — the name column is 156px in both windows.
  for (const line of lines) {
    line.style.left = at;
    const lab = line.children && line.children[0];
    if (lab) lab.textContent = label;
  }
}

// Walk the day for real.
//
// She asked for the announcement as a live clock rather than a play-through, so
// this is not a rehearsal of her plan and it never rewrites one. The chart keeps
// the times she planned — the ruler still reads 4:00 am, because that is her day
// — and the now-line reads out the actual clock, because that is what time it is.
// Nothing here is saved, so nothing here can surprise her tomorrow: the run lives
// in a closure and dies with the screen.
//
// The one thing that could not be done quietly is the sound. A phone blocks audio
// until a real finger has touched the page, and the Start press is that finger,
// so the audio context is made here and not later.
const atMinute = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

function startDay(run, sc, state, on) {
  if (run.on) return;
  const now = new Date();
  run.on = true;
  // Minute 0 of the plan is this very minute, so a 4:01 am plan started at 9 am
  // calls at 9 am. Held on the run and never written to the scenario: her day
  // start is a number she set, and a walk-through must not move it.
  run.dayStart = now.getHours() * 60 + now.getMinutes();
  run.startedMs = Date.now();
  run.nowMin = 0;
  run.lastMin = -1;

  // Best effort, all of it. A browser without audio, a phone that refuses a wake
  // lock, a page that is not allowed either — the day still walks and calls are
  // still drawn, so none of these may be allowed to stop the run.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !run.audio) run.audio = new Ctx();
  } catch { run.audio = null; }
  try {
    if (navigator.wakeLock && !run.wake) {
      navigator.wakeLock.request("screen").then((s) => { run.wake = s; }).catch(() => {});
    }
  } catch { /* nothing to do: the run does not depend on it */ }

  if (run.timer) clearInterval(run.timer);
  run.timer = setInterval(() => tickDay(run, sc, state, on), 1000);

  on.refresh();
  toast(`Walking the day from ${clockOf(run.dayStart)}. A call comes one minute before each job, in that person's own colour — tap a person's row below the day to name them or to stop their calls.`);
}

// Stop is the whole undo. The plan was never touched, so there is nothing to put
// back: the line goes, the card goes, and the sound and the wake lock are let go
// of so a phone that is left on the table goes back to sleep.
function stopDay(run, on) {
  if (run.timer) { clearInterval(run.timer); run.timer = null; }
  run.on = false;
  run.callsOn = false;
  run.nowMin = 0;
  run.lastMin = -1;
  run.lines = [];
  if (run.pending) { run.pending.remove(); run.pending = null; }
  try { if (run.audio) run.audio.close(); } catch { /* already gone */ }
  run.audio = null;
  try { if (run.wake) run.wake.release(); } catch { /* already gone */ }
  run.wake = null;
  if (on) on.refresh();
}

// One second of the day. The line is the only thing that moves — the bars are the
// plan and the plan does not change as the clock runs — so this never repaints,
// which is what keeps a chart she is reading still under her finger.
function tickDay(run, sc, state, on) {
  if (!run.on) return;
  const nowMin = (Date.now() - run.startedMs) / 60000;
  const whole = Math.floor(nowMin);
  run.nowMin = nowMin;
  placeNow(run);
  if (whole <= run.lastMin) return;

  // Everything due in the minute just gone. Only the LAST one is shown, which is
  // her own rule: an announcement she has not acknowledged is replaced by the one
  // after it rather than queuing up behind it.
  const calls = state.settings.personCalls || {};
  const due = callWindows(sc)
    .filter((w) => calls[w.who] !== false && w.at > run.lastMin && w.at <= whole);
  run.lastMin = whole;
  if (!due.length) return;
  const w = due[due.length - 1];
  showCall(run, w, sc, state, on);
}

// The call. His name, his own colour, what he is about to do and the real clock
// time he has to be there — and one OK, which is the only thing she has to do.
// Undismissed it does not go away on a timer, because a call that vanishes while
// she is walking to the bench is a call she never got.
function showCall(run, w, sc, state, on) {
  if (run.pending) { run.pending.remove(); run.pending = null; }
  const who = w.who;
  const at = run.dayStart + w.from;
  const host = run.host;
  if (!host) return;

  // Which cycle of that batch the hands are for, when she has named it: the fold
  // inside a rest is the one worth saying, because "the rests and the stretch and
  // folds" is not a thing anybody can go and do.
  const mod = chainLine(sc.modules || []).map(moduleFacts).find((m) => m.id === w.module);
  // String(name).trim(), NOT trim() — the imported trim is production.js's number
  // formatter, and on an unnamed cycle it answers "0", which is what the card used
  // to print above the clock. An unnamed cycle says nothing here.
  const cyc = mod && w.cycle >= 0 && mod.cycles[w.cycle] ? String(mod.cycles[w.cycle].name || "").trim() : "";

  const card = el("div", { class: `tl-call ${personTone(who)}` },
    el("div", { class: "tl-call-who" }, personName(who, namesOf(state))),
    el("div", { class: "tl-call-what" }, jobName(w)),
    cyc ? el("div", { class: "tl-call-cyc" }, cyc) : null,
    el("div", { class: "tl-call-when" }, `${clockOf(at)} — ${atMinute(Math.max(0, Math.round((w.at - run.nowMin) * 60)))} from now`),
    el("button", {
      type: "button", class: "tl-call-ok",
      onclick: () => { if (run.pending === card) { card.remove(); run.pending = null; } },
    }, "OK"));
  run.pending = card;
  host.append(card);
  chirp(run, who);
}

// One short note per person, a different one each, so two people called in the
// same minute are two sounds and not one. Whole tones apart rather than fractions
// of a tone: a phone's own speaker is small and two notes have to be obviously
// two notes. A run with no audio at all simply skips this.
function chirp(run, who) {
  const ctx = run.audio;
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 440 * Math.pow(2, ((((who || 1) - 1) % 6) * 2) / 12);
    // A shape rather than a click: up in a few milliseconds, held, and gone
    // inside a fifth of a second so it reads as a call and not as an alarm.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  } catch { /* a phone that will not make a sound still shows the card */ }
}

// ── The board ──────────────────────────────────────────────────────────────
//
// The same day, drawn for whoever is standing at the bench rather than for the
// person who planned it. Her words, 23 September 2026: "copy the chart into
// Prodcution line, but should not be editable, it become a dashboard for worker,
// give the worker good inform of what next for them, how long, and others".
//
// Nothing on a board may be a control that does nothing — a tap that answers with
// silence reads as a fault — so every tap on this chart opens a card that READS:
// one batch, one module, one person, or one stretch of somebody's day. Each of
// those cards is built from values the chart has already worked out, and the two
// that have anything to say reuse the planner's own moduleNotes and personNotes,
// so a board cannot drift from the day it is showing.
//
// The one thing a board adds to the day is the clock, and it is the real one.

// Where the real clock falls inside her planned day, and what to say when it falls
// outside it.
//
// Outside is not an error and it is not a wrap. Her day starts at a time she set, so
// a board opened before it says so rather than leaving the line on the left edge for
// the worker to interpret. Wrapping round to the other end is the tempting wrong
// answer: the seeded retard day runs past midnight, so a "now" that has gone past
// the day's end would come back in the middle of a day that is not the one on
// screen.
//
// The one carry backwards is the overnight shift, and it is not a wrap: a day of more
// than twenty-four hours really can still be running after midnight, so if
// yesterday's start plus the minutes elapsed still lands inside the day's own real
// end, that is where now is. A day that finished at 11 am is not carried into the
// small hours, because `endMin` says it is over.
function boardNow(sc, r) {
  const now = new Date();
  const real = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const dayStart = Number(sc.dayStartMin) || 0;
  const endMin = Number(r && r.endMin) || 0;
  let t = real - dayStart;
  if (t < 0 && t + DAY_MIN <= endMin) t += DAY_MIN;
  if (t < 0) return { min: 0, note: `day starts ${clockOf(dayStart)}` };
  if (t > endMin) return { min: endMin, note: `day ended ${clockOf(dayStart + endMin)}` };
  return { min: t, note: "" };
}

// ── the train's own geometry (v193) ───────────────────────────────────────
//
// The workers' window on a board is a TRAIN: one coach per job, with the clock
// sweeping across the line. Her ask, 24 September 2026: "for each of person line,
// make his series of work join up like a train, coaches represent work, the current
// time at the center sharing with all person, showing next work in minutes on top,
// something like next station countdown for subway. Person should click on their
// work to turn it green indicating acknowledgement."
//
// v184 answered that with a strip of WORK: all coaches one width, joined in job
// order, and a piecewise-linear map from a minute of her day to a pixel along each
// row. One consequence of that she has now named as a fault, 25 September 2026:
//
//   "Make the coach width relative to its duration, and others batch duration,
//   their labour requirement mark by hand needed, not batch arrival"
//
//   "So the 3 person's train head, should be timed and position relatively to each
//   other, when time start, 3 train started together"
//
// The two sentences are one change. With a per-row map, the same clock minute lands
// at a different pixel in every person's row, so the three trains cannot be compared
// at all. With ONE scale — the day's own, in pixels per minute, the same figure the
// modules' window above is drawn from — every row is a piece of the same clock and a
// coach is exactly as long as the stretch her hand is needed on it.
//
// This deliberately reverses v184's own comment, which refused proportionality in as
// many words ("a twelve-minute job drawn smaller than a forty-minute one would make
// this a length chart, and it is not one"). She has asked for the length chart. What
// says how long a job takes is now the length of the coach, and the clock is printed
// on its face as well.
//
// These are pure, exported, and unit-tested with no DOM at all, for the reason v184
// wrote its own: this is the one part of the screen where being wrong is SILENT.
// `translateX(NaNpx)` is a train that has vanished rather than an error anybody sees.

// A finite number, or the fallback. The clock reaches these maps from a real clock
// and from pointer coordinates, so a value that is not a number must never be able to
// travel any further than here.
function trainNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// The day's own scale: pixels per minute. ONE number for one day, so no two people's
// rows can be drawn at different sizes, and so the train cannot come to disagree with
// the modules' window above it — which is drawn from the same figure. Read off the
// scenario, which is where her own Scale presses write it, and never cached.
export function trainScale(sc) {
  const k = trainNum(sc && sc.pxPerMin, 0);
  return k > 0 ? k : PX_PER_MIN_CHOICES[0];
}

// Where a coach stands and how wide it is: its own minutes, times that scale.
//
// Her words, 25 September 2026: "Make the coach width relative to its duration". The
// `from` and `to` are the model's own hands window (see touchWindows) — the stretch
// her hand is actually needed for — so the width is her "labour requirement mark by
// hand needed, not batch arrival" drawn rather than described.
//
// EXACTLY proportional, with no floor. Asked what a one-minute fold should look like
// she answered "and if it is not show as no space big enough, just dont show, as we
// have another place shown it under person's name" — so a hairline coach is drawn as a
// hairline with no face on it, and the row's own next line carries the words. The one
// exception is a job of nought minutes, which is given a single pixel rather than
// none: a coach that is not drawn at all is a job nobody can see, and the row would be
// quietly short of a coach.
export function coachGeom(job, k) {
  const scale = Math.max(0, trainNum(k, 0));
  const from = trainNum(job && job.from, 0);
  const to = Math.max(from, trainNum(job && job.to, from));
  return { left: from * scale, width: Math.max(1, (to - from) * scale) };
}

// The whole line, in pixels: the day's own end, times that scale. Taken from the DAY
// and not from the last job on it, so the line reaches the end of the morning she
// planned even on a row whose person finished hours before it.
export function lineWidth(endMin, k) {
  return Math.max(0, trainNum(endMin, 0)) * Math.max(0, trainNum(k, 0));
}

// Where the window is standing on the line, and where the ruler therefore stands in
// the window. Her own design, in her own words, 25 September 2026: "the ruler sweeps,
// untill reach center, it stop, then the train move. The advantage of this is we see
// more coaches queues yet to come without having to drug the line, as when getting
// started, person only see one train head, the rest might shill hiden until you drag
// it to the left. Start left is convenient in this way."
//
//   xNow = nowMin * k              the minute the morning is at, along the line
//   if xNow <= visW / 2  s = 0     the day's OWN START is glued to the LEFT edge
//   else s = xNow - visW / 2       the ruler has reached the middle and stops; the LINE moves
//   s += pan                       her own hand, clamped to the travel the line has
//   ruler = xNow - s               swept in from the left edge, then pinned at the centre
//
// `s` is bounded twice over, and both bounds are worth stating. The window may not
// slide past either end of the line's own paper, which is the `[0, span - win]` half.
// And the minute she is reading may not leave the window, which is the `[xNow - win,
// xNow]` half: without it a drag far enough to the left would carry the ruler off the
// right edge and leave her looking at a line with no clock on it at all.
export function trainPlacement(nowMin, k, visW, pan, lineW) {
  const scale = Math.max(0, trainNum(k, 0));
  const win = Math.max(0, trainNum(visW, 0));
  const span = Math.max(0, trainNum(lineW, 0));
  const raw = Math.max(0, trainNum(nowMin, 0)) * scale;
  // Clamped to the line: a day being WALKED keeps counting past its own end, and a
  // ruler that ran off the paper after it would be a clock standing on a minute the
  // day does not have. It parks at the line's own end instead.
  const xNow = span > 0 ? Math.min(raw, span) : raw;
  const half = win / 2;
  const follow = xNow <= half ? 0 : xNow - half;
  const lo = Math.max(0, xNow - win);
  const hi = Math.max(lo, Math.min(Math.max(0, span - win), xNow));
  const s = Math.min(hi, Math.max(lo, follow + trainNum(pan, 0)));
  return { s, ruler: xNow - s, lo, hi, follow, xNow, win, span };
}

// How far her own hand may carry the line, at the minute the day is standing on.
//
// It is the two bounds above expressed as a range for `pan`, and it always contains
// nought — which is what makes the resting placement reachable, and therefore what
// makes "Back to now" and a press off the line ways home rather than wishes.
export function panRange(nowMin, k, visW, lineW) {
  const p = trainPlacement(nowMin, k, visW, 0, lineW);
  return {
    lo: Math.min(0, Math.round(p.lo - p.follow)),
    hi: Math.max(0, Math.round(p.hi - p.follow)),
  };
}

// A span of time, in the words somebody standing at a bench reads it in.
//
// Her ask, 25 September 2026: "can the time show under their names, accurate to 5m
// 55s?" So the countdown under a person's name is to the second and not rounded to the
// minute — a countdown rounded to the minute is wrong by up to fifty-nine seconds at
// exactly the moment the answer matters, which is the minute before her hand is
// needed. Under a minute it says the seconds alone.
export function minsWords(v) {
  const whole = Math.max(0, Math.round(trainNum(v, 0) * 60));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

// ── what a coach is made of (v184) ────────────────────────────────────────

// The words a short name is not. A module called "Into the proofer" is not about
// "Into", and a coach that says "Into" has told her nothing she did not already see.
const SHORT_STOP = new Set([
  "the", "of", "in", "into", "and", "a", "an", "before", "again",
  "by", "out", "at", "to", "on", "for", "with", "from",
]);

// A module's name cut down to the one word that names it, for a coach about fifty
// pixels wide. DERIVED and not truncated, because her refinement was "if the coach
// box is too smalll to house the full words, then just show meaningful" — and
// "Cutting and packin…" is not a shorter name, it is a broken one.
//
// It is a guess at her own vocabulary, and it is on the screen where she can see it
// and say otherwise: a leading "The" goes, then the first word that is not a stop
// word, and only when every word is a stop word does it fall back to the longest.
// So "Into the proofer" reads proofer, "Dimple and top" reads Dimple, "Cutting and
// packing" reads Cutting, "The oven swap and the bake" reads oven.
//
// The punctuation goes with the words it is not part of. Found by reading the drawn
// board rather than by reasoning: the stock module "Wash, oil and fill" named its
// coach "Wash," — a trailing comma on the face, which is a broken label in exactly the
// way her refinement refuses ("just show meaningful"): the box was not too small, the
// word was simply cut wrong. The stop-word test already strips punctuation to READ a
// word; this strips it from the word that is handed back, at both ends, so "Wash, oil
// and fill" reads Wash and "(overnight) retard" reads overnight.
function shortName(name) {
  const whole = String(name == null ? "" : name).trim();
  if (!whole) return "";
  const words = whole.split(/\s+/).filter(Boolean);
  const bare = (w) => String(w).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  const keep = words.filter((w) => !SHORT_STOP.has(bare(w).toLowerCase()));
  if (keep.length) return bare(keep[0]) || keep[0];
  const longest = words.slice().sort((a, b) => b.length - a.length)[0] || whole;
  return bare(longest) || longest;
}

// The line a coach may stand on: the pane's own width less the name column the board
// draws its people in. Narrower than the planner's 156px on purpose — these 48 pixels
// are what let a phone's line still carry several coaches at once.
//
// Since v193 this column is the ONLY thing between the pane's edge and minute nought of
// every row, which is what lets her point 3 stand: with one scale and one left edge, a
// coach's x IS its minute, so the three trains begin together and stay comparable.
const TRAIN_NAME_W = 108;

// The narrowest a coach can be and still hold a face. It is not a floor on the coach
// itself — the coach is exactly as wide as its minutes (see coachGeom) — it is the
// width below which the face is not drawn at all. Her words: "if it is not show as no
// space big enough, just dont show, as we have another place shown it under person's
// name". A coach of a whole minute at the widest scale is 7.2 pixels, so the face is
// absent on every genuinely short job and the row's own next line is what names it.
const TRAIN_FACE_MIN = 43;

// The least a coach may be drawn for the finger to reach it. Purely a hit area and never
// a width: the coach is drawn hairline-true and this is an invisible widening laid over
// it (see .tl-coach::before), so a one-minute fold is still a press and still a
// hairline. This app's own tap target floor, and the one place the train still honours
// it now that the drawn width may be two pixels.
const TRAIN_TAP_MIN = 36;

// The gap between two coaches, drawn as its own element (`.tl-link`) so the countdown
// can sit inside a stretch of the line that belongs to no job.
//
// It is a MINIMUM and not a width. v184 sized the links from the pane's width and put
// them between fixed-width coaches; with everything now measured in minutes a gap that
// was widened to hold a number would move every coach after it off its own minute, so
// the gap is drawn as the minutes really are and the number is drawn only where those
// minutes left room (see trainRow). A gap too narrow for its countdown shows none, and
// the person's own next line still says it.
const GAP_MIN_W = 22;

// One job as the drawing needs it: the model's own hands window, the words for it, and
// the minute it is called at.
//
// Built once per row, so the coach, its face, its tip, its countdown and the row's own
// next line are all reading ONE object. Before v193 the row worked these out in four
// places as it built each element, which is how a second story about the same job gets
// into a screen. `at` is looked up rather than recomputed (see callAtOf), so a coach
// turns red at the same minute the bell rings.
function trainJob(r, run, state, w, who) {
  const key = keyOf(w, who);
  const from = trainNum(w && w.from, 0);
  const name = String((w && w.name) || "").trim() || "Work";
  return {
    w,
    key,
    from,
    to: Math.max(from, trainNum(w && w.to, from)),
    at: callAtOf(run, key, from),
    icon: (w && w.icon) || "•",
    name,
    short: shortName(name) || name,
    when: `${trainClock(r.dayStartMin, from)} → ${trainClock(r.dayStartMin, trainNum(w && w.to, from))}`,
    ack: ackOn(state, key),
  };
}

// The clock on a coach. The am/pm is dropped because it will not fit — "4:13" is what
// a fifty-pixel coach holds and what somebody reading an oven clock needs; the whole
// "4:13 am → 4:25 am" is on the coach's own tip.
function trainClock(dayStartMin, min) {
  return clockAt(dayStartMin, min).replace(/\s*[ap]m$/i, "");
}

// How many batches the module behind this job runs today — read exactly the way the
// batch card reads it, so a coach saying B2 and a card saying "batch 2 of 4" cannot
// come to disagree.
function batchesOf(r, id) {
  const m = ((r && r.modules) || []).find((x) => String(x.id) === String(id));
  if (!m) return 1;
  return Math.max(1, Number(m.repeatsHeld || (m.passes || []).length || m.repeats) || 1);
}

// One job's key with the person the row IS put onto it. The model keys a job by its
// person deliberately — a green coach claims that person has seen that job, so a job
// that changes hands is not the same job — but `row.items` carry the module, the
// batch, the slot and the cycle and no person, because the person is the row. One
// helper, so the tick, the lookup and the drawing cannot key one job three ways.
const keyOf = (w, who) => jobKey({ ...w, who });

// Whether a coach has been taken, read off what this phone holds. Read as
// absent-versus-stored, so a board nobody has touched answers exactly as one that is
// silent about this job — and read with `||` and never `||=`, because opening a board
// must not write the key (see board-view.test.js, "opening the board writes nothing").
function ackOn(state, key) {
  const a = (state && state.settings && state.settings.boardAcks) || null;
  return Boolean(a && a[key]);
}

// How many jobs on this board are marked as taken. Asked for one reason only: the Clear
// press is drawn at every width of the day, and this is what tells it whether there is
// anything for it to clear — see clearBoard.
function ackCount(state) {
  const a = (state && state.settings && state.settings.boardAcks) || null;
  return a ? Object.keys(a).length : 0;
}

// One tap on a coach, which is the whole of what a worker does on this screen. Her
// words, 24 September 2026: "Person should click on their work to turn it green
// indicating acknowledgement", and "Anyone, on any line" may do it.
//
// It is written STRAIGHT into her settings and saved there, because the sentence this
// screen exists to answer is "has anybody picked this up": a tick that lived in the
// drawing would be gone at the next beat and would never reach her other phone. The key
// names the person (see keyOf), so a job handed to somebody else starts unanswered —
// which is the safe reading at a bench, and is said out loud in the CHANGELOG rather
// than left to be discovered.
//
// The same tap takes it back, because a finger that slips must not need a second button
// to undo it. Unticking DELETES the key rather than leaving an empty map behind: an
// empty object in her stored settings is a thing to explain, and there is nothing to
// explain about a job nobody has taken. (The Clear press writes the empty instead —
// see clearBoard for why that one is the opposite.)
//
// What is said back is the JOB and the CLOCK TIME it is at, because a module that runs
// two batches gives two coaches and the clock time is the only thing that tells them
// apart.
function toggleAck(state, run, j, on) {
  const settings = (state.settings ||= {});
  const acks = settings.boardAcks || (settings.boardAcks = {});
  const was = Boolean(acks[j.key]);
  if (was) {
    delete acks[j.key];
    if (!ackCount(state)) delete settings.boardAcks;
  } else {
    acks[j.key] = 1;
  }
  if (on && on.persist) on.persist();
  const when = clockAt(run.dayStart, j.from);
  toast(was
    ? `${jobName(j.w)} at ${when} is not marked as taken any more.`
    : `✓ ${jobName(j.w)} at ${when} — marked as taken.`);
  // Say it again rather than reach into the coach: the tick changes the coach, the link
  // beside it, the tip's own sentence and the Clear press's own state, and a screen
  // repainted from the settings is the one way all four cannot disagree.
  if (on && on.refresh) on.refresh();
}

// Clear the board: every job back to unanswered, in one press.
//
// It is the one control here that throws information away, so it asks first — through
// the app's own confirm card, dressed as a danger, exactly as every other control that
// discards does. It is drawn at every width and every state of the day, because a
// button that comes and goes reads as a fault; while nothing is ticked it is drawn
// disabled, which is the app's own inert look (.btn[disabled]).
//
// It writes the EMPTY MAP and never deletes the key. That difference is the whole
// reason this comment exists: the sync engine tells a phone that has no opinion about a
// key from a phone that has decided to empty it by whether the key is SPOKEN in what it
// publishes (see SPEAK_EMPTY and the v181 rules in sync.js). Deleting here would make
// the clear silent, the other phone would read that silence as ignorance, and rule 3
// would put every cleared tick straight back.
function clearBoard(run, state, on) {
  const ticks = ackCount(state);
  if (!ticks) return;
  confirmDialog(
    ticks === 1
      ? "Clear the board? One job is marked as taken. Every coach goes back to unanswered on both phones — your day itself is not changed."
      : `Clear the board? ${ticks} jobs are marked as taken. Every coach goes back to unanswered on both phones — your day itself is not changed.`,
    () => {
      (state.settings ||= {}).boardAcks = {};
      if (on && on.persist) on.persist();
      toast("The board is clear — every job is unanswered again.");
      if (on && on.refresh) on.refresh();
    },
    { danger: true, yesLabel: "Clear the board" });
}

// The minute this job is called at, in the one spelling the app has for it: the
// model's own `at`, one minute before the job starts. Looked up in the board's call
// list by key rather than worked out again, so a coach turns red at the same minute
// the bell rings and there is no second story about when that is.
function callAtOf(run, key, from) {
  const call = run.calls && run.calls.get(key);
  if (call) return call.at;
  return Math.max(0, (Number(from) || 0) - 1);
}

// The coach the clock is standing in right now. A job of no length can never be the
// one running, because there is no minute inside it to be at.
function isHere(run, j) {
  return j.to > j.from && run.nowMin >= j.from && run.nowMin < j.to;
}

// Red, green — TWO colours, since v193, and no third.
//
// Her words, 25 September 2026: "The coach should have 2 color only. Green and light
// red, the coach change to red only when their hand needed time is up."
//
// So the person's own tone is off the coach (it stays on the row's rail), green means
// nothing is outstanding, and red means exactly one thing: the minute her hand is
// needed has arrived and nobody has taken it. It STAYS red once the clock has gone
// past, which is her older clause: "The coach can pass the current timeline, but stay
// red, click it turn green." There is deliberately no upper bound on the due test.
//
// A taken coach goes back to GREEN rather than getting a colour of its own, and that is
// what keeps the count at two: a taken job is a job with nothing outstanding on it,
// which is precisely what green already means. What says it was taken is the tick on
// its face (see .tl-cack), not a third shade.
function coachState(state, run, j) {
  if (j.ack || ackOn(state, j.key)) return "ack";
  return run.nowMin >= j.at ? "due" : "coming";
}

function coachWords(state, run, j) {
  const s = coachState(state, run, j);
  const here = isHere(run, j);
  if (s === "ack") return here ? "On it now, and taken" : "Taken — somebody is on it";
  if (s === "due") return here ? "Due now and running — nobody has taken it" : "Due now — nobody has taken it yet";
  return here ? "Running now" : "Coming up";
}

// The second line of a person's cell: what they are on, or how long until the next
// thing starts. It is on the row and not only in a tip for the reason the call card
// exists at all — a phone has no hover, and the person standing at the bench is the
// one reader who cannot ask the screen a question.
//
// The last branch is the one that has to be careful. When nothing is left in front of
// this person there are two different facts and they must not be said with one word:
// the day has nothing more for them, and every job of theirs has been taken. "All done"
// is only true of the second. Measured live at 4:30 am on her own day: Person 3's one
// job ran 4:00 to 4:12, so the row read "All done" beside a coach that was standing
// RED and untaken — the board telling a worker they had finished something nobody had
// touched, and talking them out of the very tap her clause 3 asks for ("the coach can
// pass the current timeline, but stay red, click it turn green"). So a row with work
// still untaken counts it instead, in the board's own words for it ("nobody has taken
// it", see coachWords), and gives up the count the moment the last coach goes green.
function trainNextLine(state, run, jobs) {
  const now = run.nowMin;
  const here = jobs.find((j) => isHere(run, j));
  if (here) return { text: `Now: ${here.short}`, due: true };
  const next = jobs.find((j) => j.from > now);
  if (next) {
    if (next.at <= now) return { text: `Due: ${next.short}`, due: true };
    // To the SECOND, which is her ask of 25 September 2026: "can the time show under
    // their names, accurate to 5m 55s?" A countdown rounded to the whole minute is
    // wrong by up to fifty-nine seconds, and it is wrong at exactly the moment the
    // answer is being read — the minute before her hand is needed. `minsWords` is the
    // same formatter the countdown between two coaches uses, so the row's own line and
    // the link on the line can never state one instant at two precisions.
    const left = next.from - now;
    return { text: `Next ${minsWords(left)}`, due: left <= 1 };
  }
  if (!jobs.length) return { text: "Nothing on", due: false };
  const left = jobs.filter((j) => coachState(state, run, j) !== "ack").length;
  return left ? { text: `${left} not taken`, due: true } : { text: "All done", due: false };
}

// A coach's tip is opened by the pointer over the coach, and it is opened by hand
// rather than by a `:hover` rule, because the tip is not inside the coach (see the
// note where it is built) and so no selector can reach it from there. The media query
// in the stylesheet is what keeps a phone from ever showing it: a tap that fires a
// synthetic hover would otherwise open a box nobody asked for and would put a second
// meaning on the one tap that means "I'm on it".
function wireCoachTip(coach, tip) {
  if (!coach || !coach.addEventListener) return;
  coach.addEventListener("mouseenter", () => tip.classList.add("on"));
  coach.addEventListener("mouseleave", () => tip.classList.remove("on"));
  wirePersonTip(coach, tip);
}

// One person's line on a board, as a TRAIN: a coach for every job they have, each one
// standing at its own minute and exactly as long as her hand is needed on it, with the
// clock sweeping along the line.
//
// v184 built this as a strip of WORK — all coaches one width, joined in job order, on a
// private piecewise-linear map. Her instruction of 25 September 2026 replaces that with
// a strip of TIME, and the two sentences that do it belong next to the code:
//
//   "Make the coach width relative to its duration, and others batch duration, their
//   labour requirement mark by hand needed, not batch arrival"
//
//   "So the 3 person's train head, should be timed and position relatively to each
//   other, when time start, 3 train started together"
//
// Which is why nothing here computes a position of its own any more. A coach's `left` is
// its own minute times the day's scale and its `width` is its own minutes times the same
// scale (coachGeom), and the strip is as wide as the whole day (run.lineW) — so the same
// clock minute is the same pixel in every person's row. That is the property her third
// point asks for, and the one the private map could never give: a per-row map puts one
// clock minute at a different pixel in every row, which makes the three trains
// incomparable exactly when she wants to compare them.
//
// `run.scale` and `run.lineW` are read off the RUN rather than worked out again here, so
// that the geometry a test pins and the geometry a row draws are the same two numbers.
// Both are set by trainGeometry from the day's own Scale — the same figure the modules'
// window above is drawn from, so the train and the chart cannot come to disagree.
function trainRow(r, row, sc, on, state, run) {
  const who = row.person;
  const tone = personTone(who);
  const notes = personNotes(row, sc, state, r.dayStartMin);
  const k = run.scale;
  const jobs = (row.items || []).filter(Boolean).map((w) => trainJob(r, run, state, w, who));

  // The strip is the whole day's paper, not the coaches' own width: absolutely placed
  // children need a box that reaches to the end of the line, or the last coaches would
  // fall off the end of their own container.
  const strip = el("div", { class: "tl-train", style: `width:${run.lineW}px` });
  const tips = [];
  const coaches = [];
  const counts = [];
  const links = [];
  // Each coach's tip keeps its own copy of the state sentence, so the beat can keep the
  // opened tip honest as the clock runs (see restate). The tip is the one place a coach's
  // state is written in WORDS, and a card still saying "Coming up" about a job that has
  // been due for ten minutes would be the very second story this screen refuses.
  const states = [];

  jobs.forEach((j, i) => {
    const batches = batchesOf(r, j.w.module);
    const owner = ((r.modules || []).find((x) => String(x.id) === String(j.w.module)) || {});
    const cyc = j.w.cycle >= 0 ? (owner.cycles || [])[j.w.cycle] : null;
    const cycName = cyc ? String(cyc.name || "").trim() : "";
    const g = coachGeom(j, k);
    const here = isHere(run, j);
    const st = coachState(state, run, j);

    // The face, and the tick, and NOT the person's tone. Her "2 color only" settles the
    // second thing v184's coach carried: the eight person tones are gone from here — they
    // stay on the row's rail, where they still say whose line it is — so that green and
    // light red are the only two answers a coach can give. A taken coach is GREEN with a
    // tick on it, because "taken" is a kind of "nothing outstanding", which is what green
    // already means (see coachState).
    const coach = el("div", {
      class: `tl-coach ${st}${here ? " here" : ""}`,
      // `left` and `width` in real pixels, and in the inline style, so the two numbers the
      // drawing is made of are the two numbers a reader can measure. The width is exactly
      // the job's own minutes and is never widened for looks or for the finger: v184's
      // 34-pixel floor is gone with the uniform budget, so a one-minute fold is drawn as a
      // hairline. What keeps that hairline pressable is the invisible `.tl-coach::before`
      // hit area in the stylesheet, which moves nothing and widens nothing.
      style: `left:${g.left}px;width:${g.width}px`,
    },
      el("div", { class: "tl-cface" },
        el("span", { class: "tl-cicon" }, j.icon),
        el("span", { class: "tl-cname" }, j.short),
        el("span", { class: "tl-cwhen" }, trainClock(r.dayStartMin, j.from)),
        batches > 1 ? el("span", { class: "tl-cbatch" }, `B${j.w.batch + 1}`) : null),
      st === "ack" ? el("span", { class: "tl-cack" }, "✓") : null);

    // The tip is a SIBLING of the strip and never a child of the coach, and that is
    // forced rather than chosen: the strip is translated to hold the clock at its
    // centre, and a transform is both a stacking context and a containing block for
    // anything fixed inside it, so a tip drawn in there would be measured against the
    // train instead of the screen — and the track that holds the train is a clip line
    // on both sides. It is the lesson the people's tip was taken out of its own window
    // for at v167, arrived at from the other end.
    const stateEl = el("div", { class: "tl-sub tl-cstate" }, coachWords(state, run, j));
    const tip = el("div", { class: "tl-tip tl-tip-coach" },
      el("div", { class: "tl-sub" }, `${j.icon ? `${j.icon} ` : ""}${jobName(j.w)}`),
      el("div", { class: "tl-sub" }, `${clockAt(r.dayStartMin, j.from)} → ${clockAt(r.dayStartMin, j.to)} · ${trim(j.to - j.from)} min`),
      batches > 1 ? el("div", { class: "tl-sub" }, `Batch ${j.w.batch + 1} of ${batches}`) : null,
      cycName ? el("div", { class: "tl-sub" }, cycName) : null,
      el("div", { class: "tl-sub" }, `👤 ${notes.who}`),
      stateEl);
    tips.push(tip);
    states.push({ el: stateEl, j });
    wireCoachTip(coach, tip);

    // The tap, and the tap only. A right press pans the day, a drag along the line is a
    // reading (see wireTrainClock), and the name column is where the person's card is
    // opened — so the one thing left for a finger on a coach to mean is "I'm on it".
    //
    // `stopPropagation` matters twice: without it the row's own handler opens the
    // person's card underneath the tick, and a click that is really the END OF A
    // READING must be swallowed here rather than reaching that card as a tap.
    coach.addEventListener("click", (e) => {
      if (!isPrimaryClick(e)) return;
      e.stopPropagation();
      // A click that follows a reading is the end of that reading and not a tap on the
      // work. The flag is put back by the NEXT press on the pane, so a reading can lose
      // at most the one click it caused.
      if (run.scrubbed) return;
      toggleAck(state, run, j, on);
    });

    coaches.push(coach);
    strip.append(coach);

    // The wait between this job and the next, drawn as its own minutes and nothing else.
    //
    // v184 widened this gap to hold its countdown, which was harmless while the coaches
    // were a fixed width and is not harmless now: a gap drawn wider than the minutes it
    // stands for would push every coach after it off the minute it belongs to, and a
    // coach's position meaning something is the whole point of this release. So the gap
    // is drawn TRUE, and the countdown is drawn inside it only where those minutes left
    // the room to read one (GAP_MIN_W) — otherwise there is a gap with nothing written
    // on it, and the person's own next line, under their name, says how long it is. Two
    // jobs that run back to back get no element at all.
    const next = jobs[i + 1];
    if (next && next.from > j.to) {
      const wpx = (next.from - j.to) * k;
      const link = el("div", { class: "tl-link", style: `left:${j.to * k}px;width:${wpx}px` });
      if (wpx >= GAP_MIN_W) {
        const count = el("span", { class: "tl-count" }, trainCount(state, run, next));
        counts.push({ el: count, next });
        link.append(count);
      }
      links.push(link);
      strip.append(link);
    }
  });

  const nextLine = el("div", { class: "tl-next" });
  paintNextLine(nextLine, trainNextLine(state, run, jobs));

  const tip = personTip(notes);
  const nameCell = el("div", { class: "tl-name" },
    el("div", { class: "tl-name-top" },
      el("span", { class: "tl-name-txt" }, `👤 ${notes.who}`)),
    nextLine,
    tip);
  wirePersonTip(nameCell, tip);

  // This person's own ruler — her "Each of the person line has a clock line at centre of
  // line". One per row, and NO label on any of them: the window carries one face, at the
  // top (see the clock face in `timeline`), and a column of four identical time labels
  // would be four answers to one question. It is drawn AFTER the strip, so tree order
  // puts it over the coaches the way the day's own line runs over the bars, and it
  // declares no z-index of its own — the v174 rule, kept flat.
  //
  // It is inside the TRACK and not in the pane, which is what makes it the person's own
  // line: the track is the clip line that stops a translated train running under the name
  // column, and every track is the same width, so one number from placeTrain stands all of
  // them at the same pixel.
  const clock = el("div", { class: "tl-clock" });
  const track = el("div", { class: "tl-track train-track" }, strip, clock);
  // The ROW ITSELF is kept on the record and not only the model row it was built from:
  // a gesture arrives as an event whose target is a node, and the reading has to find
  // which person's strip her hand is on from that node and nothing else.
  const box = el("div", {
    // `train` and NOT `person`, and that is a statement rather than an omission: every
    // rule the stylesheet writes for `.tl-row.person` — the bar's own top and height,
    // the white it is painted, the band — is a rule about a strip of TIME, and this row
    // is not drawn on that axis. The row keeps the person's own tone class, which is
    // what colours it, and the planner's row keeps `person`, which is what colours that.
    class: `tl-row train tappable ${tone}`,
    // A right press pans the day and opens nothing. See isPrimaryClick.
    onclick: (e) => {
      if (!isPrimaryClick(e)) return;
      boardPersonCard(row, sc, state, r);
    },
  },
    nameCell,
    track,
    ...tips);
  run.trains.push({ row, box, who, track, strip, clock, jobs, coaches, counts, links, nextLine, states });
  return box;
}

// What a wait between two coaches counts: how long until the next job starts, "due"
// once it is within its own minute, and a tick once somebody has taken it — at which
// point the wait is no longer the thing to watch.
//
// The same `minsWords` the row's own next line uses, so the two places on this screen
// that count down to one moment can never state it at two precisions — her "accurate to
// 5m 55s", 25 September 2026.
function trainCount(state, run, next) {
  if (next.ack || ackOn(state, next.key)) return "✓";
  if (run.nowMin >= next.at) return "due";
  return minsWords(next.from - run.nowMin);
}

function paintNextLine(node, line) {
  if (node.textContent !== line.text) node.textContent = line.text;
  node.classList.toggle("due", Boolean(line.due));
}

// The train's own measures, taken from the line the pane has actually got.
//
// Asked on the first paint AND on every beat, and never cached — for the reason the
// chart's own --hour-w is never cached. The pane is measured before it is on the page
// during the first paint, and an element that is not on the page answers every
// measurement with nought, so a width read once at build time would be zero in a test
// and stale in a browser whose window was resized with the board open.
//
// What it writes now is ONE custom property — the line's full width — and it exists for
// a reason that is about measurement rather than looks: `.tl-train` is the paper the
// absolutely placed coaches stand on, and its width has to reach the end of the day even
// when a row's own last coach finishes at half past five. The scale and that width are
// NOT decided here (they are set before the rows are built, see the assembly), because a
// coach's `left` is computed as it is built: a row built before its scale was known would
// carry `left:NaNpx` in its own style, which is a coach that has vanished rather than an
// error anybody sees.
function trainGeometry(run) {
  const axis = trainAxis(run);
  for (const t of run.trains) {
    // Through `setProperty`, which is the only door a CUSTOM property has: assigning
    // `style["--coach-w"]` writes nothing at all in a browser — it leaves an expando on
    // the style object and the declarations untouched — so every coach would fall
    // through to the stylesheet's own fallback width and the line would be drawn at a
    // size nothing measured. Measured live at 375px: 34px coaches with six of them
    // filling the visible line, where this asks for 36 and four.
    t.track.style.setProperty("--line-w", `${run.lineW}px`);
  }
  return { scale: run.scale, lineW: run.lineW, visW: Math.max(0, axis.inner - TRAIN_NAME_W) };
}

// The line a coach may stand on, in the pane's own pixels: where it begins, how wide
// the pane is, and where the middle of the line therefore is.
//
// The origin is MEASURED off the track itself — it is the board's name column — and the
// declared 108 is only the floor for a track that is not on the page, because a detached
// element answers every measurement with nought and a clock drawn at nought would sit
// under the names. It is measured rather than taken from TRAIN_NAME_W so that the clock
// and the strips cannot come to disagree about where the line starts: the face and every
// ruler are placed from the one placement (see placeTrain), which is computed against
// this same origin.
//
// The centre is what is left of the pane after the names, halved — the middle of the
// line the coaches actually stand on, and not the middle of the pane, because the names
// are not part of the line. It is the pixel the clock stops at once the morning has
// reached it, which is her own third design (see trainPlacement).
//
// Nothing here is cached: this is asked afresh by every beat and by every drag, which is
// what lets a board survive a rotation.
function trainAxis(run) {
  const pane = run.peoplePane;
  const inner = Math.max(0, trainNum(pane && pane.clientWidth, 0));
  const first = run.trains.find((x) => x.track);
  const own = first ? trainNum(first.track.offsetLeft, 0) : 0;
  const origin = own > 0 ? Math.round(own) : TRAIN_NAME_W;
  const trackW = Math.max(0, inner - origin);
  return { origin, inner, trackW, centre: Math.round(origin + trackW / 2) };
}

// Where the whole line stands, and what the single face on the window says — ONE
// computation for the strips, the rulers and the face.
//
// They are one function because they are one number. v184 placed the strips and then
// placed the rulers from a second expression that happened to agree; here there is a
// single `trainPlacement` answer and every drawn thing is read off it, so a finger can
// never make a line and its ruler come to disagree about the minute either is standing on.
// That is the whole of her "when we drag to the right, the train move to right and the
// clock and red ruler move relatively".
//
// THE ANCHOR, which is her own third design of 25 September 2026 and the first time this
// window has started on the left at all: "the ruler sweeps, untill reach center, it stop,
// then the train move. The advantage of this is we see more coaches queues yet to come
// without having to drug the line, as when getting started, person only see one train head,
// the rest might shill hiden until you drag it to the left. Start left is convenient in
// this way." See trainPlacement for the arithmetic and the two clamps.
//
// So at the start of the morning the ruler is at the line's own left edge and the whole
// queue of coaches ahead is visible at once; it sweeps rightwards until it reaches the
// middle of the line, and from then on it is pinned there and the line slides under it.
// Every row is drawn from the same minute and the same scale, so the trains stand in the
// same place relative to one another — her point 3, "when time start, 3 train started
// together" — which is the property a per-row map could never give.
//
// `alongLine` and `screen` are one number in two coordinate spaces, and both come from the
// one placement so they cannot come to disagree: a ruler is drawn INSIDE its track, so it
// is told a pixel counted from the track's own left edge, while the face is drawn in the
// window, so it is told the same pixel counted from the pane's edge. The distance between
// the two is the name column, and nothing else.
//
// A ruler is NEVER brown, and v185's `.reading` is gone with the thing it was for. It
// existed because a drag in that build moved the clock line on its own, leaving the line
// reading a minute the day was not at; here the line moves WITH the clock, so a panned
// ruler is still standing on the minute the morning is actually at and red is still the
// truth about it. What the pan changes is WHERE on the line that minute stands, and
// nothing else.
//
// The face names the CLOCK TIME and never the word "now" — the module window above still
// draws the day's own now-line with its own label, and two lines on one screen both saying
// "now" would be two answers to one question.
function placeTrain(run, axis) {
  const p = trainPlacement(run.nowMin, run.scale, axis.trackW, run.pan, run.lineW);
  // The line slides LEFT as the window moves right along it. The strip is the whole day's
  // paper, so this is what brings the minute being read into the window.
  const slide = `translateX(${Math.round(-p.s)}px)`;
  const alongLine = `${Math.round(p.ruler)}px`;
  for (const t of run.trains) {
    if (t.strip && t.strip.style.transform !== slide) t.strip.style.transform = slide;
    if (!t.clock) continue;
    if (t.clock.style.left !== alongLine) t.clock.style.left = alongLine;
  }
  if (run.clockLab) {
    const at = `${Math.round(axis.origin + p.ruler)}px`;
    if (run.clockLab.style.left !== at) run.clockLab.style.left = at;
    const said = clockOf(run.dayStart + run.nowMin);
    if (run.clockLab.textContent !== said) run.clockLab.textContent = said;
  }
  // Kept on the run, so a drag's own clamp and the drawn screen answer from one piece of
  // arithmetic instead of two copies of it.
  run.placed = p;
  return p;
}

// One write-only pass over a board's trains: where each strip stands, what each coach
// is, what each link counts, and where the clock is. Called by every beat and by every
// reading — and it writes nothing but text and style strings, which is the whole reason
// a worker's view of the line survives the clock moving. It touches nothing above the
// workers' window, so the rule tickBoard is built on still holds: the chart is the plan,
// and a plan does not change as the clock runs.
//
// Each write is guarded by its own inequality, so a beat that has nothing to say writes
// nothing at all: an unguarded write is a DOM mutation per row per second, and on a
// board left open all morning that is a great many mutations to say the same number.
function restate(run, state) {
  const r = run.boardR;
  if (!run.board || !r) return;
  const axis = trainAxis(run);
  // The pixels first — every strip, every ruler and the face, all from the one placement.
  // Then the words and the colours. "Due" is a claim about now, and a finger on the glass
  // does not change who is late, so both are answered from run.nowMin.
  placeTrain(run, axis);
  for (const t of run.trains) {
    paintNextLine(t.nextLine, trainNextLine(state, run, t.jobs));
    for (let i = 0; i < t.coaches.length; i += 1) {
      const j = t.jobs[i];
      const c = t.coaches[i];
      const st = coachState(state, run, j);
      c.classList.toggle("due", st === "due");
      c.classList.toggle("ack", st === "ack");
      c.classList.toggle("here", isHere(run, j));
    }
    for (const c of t.counts) {
      const said = trainCount(state, run, c.next);
      if (c.el.textContent !== said) c.el.textContent = said;
    }
    // The tip's own sentence, kept true between taps. Only the text is written, so an
    // open tip stays open and stays where it was put.
    for (const s of t.states || []) {
      const said = coachWords(state, run, s.j);
      if (s.el.textContent !== said) s.el.textContent = said;
    }
  }
}

// A pointer's x in the pane's own coordinates. A reading is taken along a line the pane
// draws, and an event's own coordinate is measured from the window, so the two have to
// be brought together in one place and one place only — with the pane's own scroll added
// back, because a box that has been scrolled left hands back a box that has moved and
// not a coordinate that has.
function paneX(pane, e) {
  const box = pane && pane.getBoundingClientRect ? pane.getBoundingClientRect() : null;
  return trainNum(e && e.clientX, 0) - (box ? trainNum(box.left, 0) : 0) + trainNum(pane && pane.scrollLeft, 0);
}

// The drag: one hand moves the whole line sideways.
//
// Her words, 24 September 2026: "Create windows for each person, the detail able to be
// drag left or right", then "when we drag to the right, the train move to right and
// the clock and red ruler move relatively", and then "when i click outside the person
// window, the clock back to center." And her correction of 25 September 2026, which is
// the only thing this release changes about it: "and the drag, should be by right mouse
// button hold down" — with, for the phone, "handphone can accept double finger gesture".
//
// So a drag PANS, and it is now a RIGHT-button hold on a computer and TWO FINGERS on a
// phone. One finger and one left press are left free to mean exactly one thing on this
// window: the tap on a coach that says somebody has picked the work up, and the tap on a
// name that opens that person's card. Before this, a left press began a drag as well, so
// the gesture that means "I'm on it" and the gesture that moves the day started the same
// way — which is the fault her correction names.
//
// The line moves, and every ruler moves with it by the same single number (see placeTrain,
// where all of it is one computation), so the ruler goes on naming the minute the morning
// is actually at: what the drag changes is where on the line that minute stands. Her
// pointing at one end of it brings the work before that minute into view; the other end
// brings the work after it. If the ruler alone moved, the line would be left standing at a
// minute the day is not at, which is a board quietly telling a worker something untrue.
//
// Letting go LEAVES the line where she put it, and that is the point of the gesture on a
// phone: her own fingers are over the part of the line she is trying to see, so a drag
// that snapped back on release would show her nothing at all. The two ways back are her
// own clause 10 — a press anywhere off the person's window — and the ⟲ Back to now button,
// which is the same thing on a button.
//
// Nothing about what is DUE is answered from the pan. Red, green and the countdowns are
// claims about the minute the morning is at, and looking further along the line does not
// change who is late — so this writes pixels and nothing else, and `restate` is not called
// from here at all.
//
// The gesture is tracked on the pane and no pointer capture is asked for: a hand that
// leaves the pane has stopped dragging it, which is why leaving ends the gesture. The one
// thing listened for on the document is the press that puts the line back, which no handler
// on the pane could ever see — see plannerInto, where it is registered once for the screen
// and taken off again with it.
function wireTrainClock(pane, run) {
  if (!run.board || !pane || !pane.addEventListener) return;
  const SLOP = 4;
  // The buttons this gesture answers to. Her correction of 25 September 2026: "and the
  // drag, should be by right mouse button hold down". Before it, a left press dragged
  // the line — and a left press is also the tap on a coach, which meant the one gesture
  // that says "I'm on it" and the one that moves the day began the same way.
  const isRight = (e) => !e || Number(e && e.button) === 2;
  const isTouch = (e) => String((e && e.pointerType) || "") === "touch";

  let from = null;   // the row the mouse's gesture began on
  let x0 = 0;
  let y0 = 0;
  let pan0 = 0;      // where the line stood when the gesture began
  let live = false;  // whether this gesture has become a drag at all
  // The fingers down on the pane, by pointer id. Only used for touch, where the gesture
  // is TWO fingers and not one — her answer of 25 September 2026: "handphone can accept
  // double finger gesture". One finger therefore stays what it always was on this screen:
  // a tap on a coach, or on the person's name.
  const fingers = new Map();

  const stop = () => { from = null; live = false; };

  // Everything the pan itself writes, once, for both gestures: the clamp, the position,
  // and then the screen. `pan0 - dx` and not `pan0 + dx`, because `pan` is where the
  // WINDOW stands along the line and not where the finger has got to: the paper has to
  // follow the hand — her clause 9, "when we drag to the right, the train move to right"
  // — and advancing the window would carry it the other way. It is the same sign the
  // planner's own panes already use (`scrollLeft = held.left - (clientX - held.x)`, see
  // wirePaneDrag), so a hand learns one direction for the whole app. `pan0` and not
  // nought, so a second drag that begins on a line already carried on from where it
  // stands rather than jumping back to the day's own placement.
  const carry = (dx, moved) => {
    const axis = trainAxis(run);
    const range = panRange(run.nowMin, run.scale, axis.trackW, run.lineW);
    run.pan = Math.round(Math.min(range.hi, Math.max(range.lo, pan0 - dx)));
    if (moved) {
      // The click that follows this gesture, if it lands on a coach, is the end of a
      // drag and not a tap on the work. See where the board's taps read this.
      run.scrubbed = true;
      live = true;
    }
    placeTrain(run, axis);
  };

  pane.addEventListener("pointerdown", (e) => {
    // Every press puts the spent flag back, before anything else can return: the click
    // that follows a drag is told apart from a tap by this flag, and a flag left
    // standing would eat the next real tap on the work.
    run.scrubbed = false;
    if (isTouch(e)) {
      fingers.set((e && e.pointerId) ?? 1, { x: paneX(pane, e), y: trainNum(e && e.clientY, 0) });
      if (fingers.size !== 2) return;
      // Two fingers are down: this is the phone's pan, and it may begin anywhere on the
      // window rather than only over a row, because two fingertips landing on one row is
      // not a thing a hand can be asked to manage.
      const pts = Array.from(fingers.values());
      x0 = (pts[0].x + pts[1].x) / 2;
      y0 = (pts[0].y + pts[1].y) / 2;
      pan0 = trainNum(run.pan, 0);
      live = false;
      from = { touch: true };
      return;
    }
    if (!isRight(e)) return;
    // A press that lands inside a person's window is where a drag may begin. The name
    // column is inside the window but off the line, and it is where the person's card
    // is opened — a press that lands there is asking about the person, so it starts no
    // drag and the line stays exactly where she left it.
    const target = e && e.target;
    if (target && target.closest && target.closest(".tl-name")) { stop(); return; }
    const row = target && target.closest ? target.closest(".tl-row.train") : null;
    const train = row ? run.trains.find((t) => t.box === row) : null;
    if (!train) { stop(); return; }
    from = train;
    x0 = paneX(pane, e);
    y0 = trainNum(e && e.clientY, 0);
    pan0 = trainNum(run.pan, 0);
    live = false;
  });

  pane.addEventListener("pointermove", (e) => {
    if (!from) return;
    if (from.touch) {
      const id = (e && e.pointerId) ?? 1;
      if (!fingers.has(id)) return;
      fingers.set(id, { x: paneX(pane, e), y: trainNum(e && e.clientY, 0) });
      if (fingers.size < 2) return;
      const pts = Array.from(fingers.values());
      const dx = (pts[0].x + pts[1].x) / 2 - x0;
      const dy = (pts[0].y + pts[1].y) / 2 - y0;
      if (!live && (Math.abs(dx) < SLOP || Math.abs(dx) <= Math.abs(dy))) return;
      carry(dx, true);
      return;
    }
    const x = paneX(pane, e);
    const y = trainNum(e && e.clientY, 0);
    const dx = x - x0;
    if (!live) {
      // Four pixels of sideways travel with the hand going further sideways than up or
      // down. The vertical half of that test is what keeps a press that is scrolling the
      // page from being read as a drag along the line.
      if (Math.abs(dx) < SLOP || Math.abs(dx) <= Math.abs(y - y0)) return;
      carry(dx, true);
      return;
    }
    carry(dx, false);
  });

  const lift = (e) => {
    if (e && isTouch(e)) {
      fingers.delete((e && e.pointerId) ?? 1);
      if (fingers.size < 2) { fingers.clear(); stop(); }
      return;
    }
    stop();
  };
  pane.addEventListener("pointerup", lift);
  pane.addEventListener("pointercancel", lift);
  pane.addEventListener("pointerleave", lift);

  // A right press is the gesture now, so the browser's own menu would open on every one
  // of them — and it opens on RELEASE, after the flag has been set. Suppressed for a drag
  // and for nothing else: a right press that landed off the line still belongs to
  // whatever is under it.
  pane.addEventListener("contextmenu", (e) => {
    if (!run.scrubbed) return;
    if (e && e.preventDefault) e.preventDefault();
  });
}

// Back to the current time: the line is placed where the day puts it again.
//
// Her clause 10, as a press — "left buttton make the clock back to current" — and the
// same thing a press anywhere off a person's window does (see plannerInto). It answers
// whether it moved anything, so the button can say plainly that there was nothing to
// put back rather than looking like a control that does nothing.
// Whether a node is inside the workers' line — the thing a drag moves, and therefore the
// thing a press has to be ON for the line to stay where she put it.
//
// The `train` class and not `tl-pane-people`, which both windows on a board carry: the
// planner's own people's window is borrowed and stands BELOW the train, and a press in it
// is a press away from the line she was dragging, so it puts the clock back like any other
// press off the train. That is her clause 10 read literally — "outside the person window"
// is outside the window whose pan she is resetting, and only one window on this page has
// one.
//
// A walk up the node's own parents and not `closest`, for the reason this file already
// carries: the tests' own stand-in screen is a hand walk, and a rule it cannot answer is a
// rule no test can hold.
function inTheTrains(node) {
  for (let n = node; n; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    if (String(n.className || "").split(/\s+/).includes("train")) return true;
  }
  return false;
}

// The document a node belongs to. `ownerDocument` is where a real node keeps it; the
// global is the floor, for a tree that was built without one — which is every test in
// this repo, since the stand-in screen hands back plain objects. Both spellings name the
// same document in a browser, so nothing here is a compromise.
const docOf = (n) => (n && n.ownerDocument) || (typeof document === "undefined" ? null : document);

function panBack(run) {
  if (!run.board || !run.pan) return false;
  run.pan = 0;
  placeTrain(run, trainAxis(run));
  return true;
}

// One second of a board's clock: the line, and the one call that came due in the
// minute just gone. It repaints nothing, which is the planner's own rule at
// tickDay — the chart is the plan, the plan does not change as the clock runs, and
// redrawing it every second would fight the scroll a worker is reading.
//
// Two clocks live here and only one of them is ever running. LEFT ALONE, a board reads
// the real wall clock: `run.dayStart` is the day's own start and the line is parked at
// whatever minute of the morning it now is. WALKED — her "START THE DAY NOW" — the
// board counts from the minute she pressed it, at the speed she chose, and the day's own
// labels move with it, so a rehearsal begun at 9 am reads its whole day from 9 am. That
// shift is `run.dayStart` and nothing else: no module, batch, start time or saved day is
// touched, and the copy that carries the shift is thrown away with the screen (see
// boardDay).
//
// The real-clock branch is also what puts the day's start BACK when she presses Stop,
// on the very next beat, without Stop having to know anything about it.
function tickBoard(run, sc, state, on) {
  if (!run.board) return;
  const r = run.boardR;
  if (!r) return;
  if (run.on) {
    run.nowMin = Math.max(0, ((Date.now() - run.startedMs) / 60000) * run.speed);
    run.nowNote = "";
  } else {
    const at = boardNow(sc, r);
    run.dayStart = Number(sc.dayStartMin) || 0;
    run.nowMin = at.min;
    run.nowNote = at.note;
  }
  placeNow(run);
  // And the train's own measures, taken again every second. A window that changed size
  // while the board is open changes how many coaches the line holds, and a strip drawn
  // to the old width would carry a coach off the edge it was measured against.
  trainGeometry(run);
  // Then the strips are re-placed and every number on them re-said — in place, which is
  // the whole design of this beat: a worker's reading of the line is never thrown away
  // and rebuilt, so nothing they are looking at moves under them.
  restate(run, state);
  // The strip is the one thing on a board that is not the plan: "what is next" is a
  // question about the clock, so it is answered again whenever the clock has changed
  // the answer — and left alone the rest of the time. The chart is not redrawn here,
  // which is the planner's own rule and the reason a worker's scroll is never lost.
  if (run.strip) {
    const key = boardAheadKey(r, sc, state, run);
    if (key !== run.stripKey) {
      run.stripKey = key;
      run.strip.replaceChildren(...boardTopBody(r, sc, state, run, on));
    }
  }
  if (!run.callsOn) return;
  const whole = Math.floor(run.nowMin);
  if (whole <= run.lastMin) return;
  const calls = state.settings.personCalls || {};
  // Only the LAST call due is shown, which is her own rule: an announcement nobody
  // has acknowledged is replaced by the one after it rather than queued behind it.
  const due = callWindows(sc)
    .filter((w) => calls[w.who] !== false && w.at > run.lastMin && w.at <= whole);
  run.lastMin = whole;
  if (!due.length) return;
  showCall(run, due[due.length - 1], sc, state, on);
}

// The three speeds a day may be walked at, and what each one is worth.
//
// Her words, 24 September 2026: "for simulation, i want some button to do this, left
// buttton make the clock back to current, Right button, when clicked, dropdown a choice
// list, slow, Mid, fast. This button is to make the chart move faster for simulation
// purpose." So the three names are hers, and the multiple beside each name is there
// because a number field has to name its own unit: Slow IS real time, one minute of her
// day to one minute of the wall clock, and the other two are that minute multiplied.
// On a four-hour bake day Slow takes four hours, Mid twenty-four minutes and Fast four
// minutes — which is the whole of what a rehearsal is for.
//
// It is a speed of the SCREEN and never of her day: it is held on the run, it is never
// saved, and it is gone when she leaves the page.
const BOARD_SPEEDS = [
  { value: "1", label: "Slow 1×", per: 1 },
  { value: "10", label: "Mid 10×", per: 10 },
  { value: "60", label: "Fast 60×", per: 60 },
];

const speedOf = (n) => BOARD_SPEEDS.find((s) => s.per === Number(n)) || BOARD_SPEEDS[0];

// Start the day now: walk the morning from this very minute.
//
// Her button, and the three things it does are all one press because they all need the
// same finger. It moves the day's own start to the minute she pressed it, so the whole
// day is then read from now — "The planner dual window window start will change to the
// current time, person's working hour also offested from this current time." It puts
// the clock at minute nought, so the ruler walks in from the left of every window. And
// it takes the audio context, because a phone blocks sound until something real has
// touched the page and this press is that something.
//
// What it does NOT do is touch a single thing she has planned. `run.dayStart` is where
// the labels are read from and it dies with the screen; the scenario's own day start,
// every module, batch, start time and saved day are exactly as she left them. The one
// visible consequence is worth saying out loud: the borrowed planner windows below are
// re-labelled from the new start, which is precisely what she asked for, while the bars
// themselves do not move a pixel.
//
// The beat is NOT restarted. A board's second-by-second interval belongs to the screen
// and not to the walk (see plannerInto), so Stop can stop the walk without ever
// stopping the clock — which is why neither of these calls stopDay, whose whole job
// would be to clear the interval this screen still needs.
function boardStart(run, sc, state, on) {
  if (run.on) return;
  const now = new Date();
  run.on = true;
  run.dayStart = now.getHours() * 60 + now.getMinutes();
  run.startedMs = Date.now();
  run.nowMin = 0;
  run.lastMin = -1;
  // A walk begins at the current time, so the line goes back to where the day puts it:
  // a rehearsal starting with the window dragged somewhere she left it last minute
  // would be two things happening at once on one press.
  run.pan = 0;
  // The sound, taken here because this is the finger. Turning the bell ON with the
  // walk is not a separate decision — a day being walked with nobody called would be a
  // rehearsal of a morning with the bell switched off.
  run.callsOn = true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !run.audio) run.audio = new Ctx();
  } catch { run.audio = null; }
  try {
    if (navigator.wakeLock && !run.wake) {
      navigator.wakeLock.request("screen").then((s) => { run.wake = s; }).catch(() => {});
    }
  } catch { /* the board does not depend on it */ }
  toast(`Walking the day from ${clockOf(run.dayStart)}, ${speedOf(run.speed).label}. Stop puts the line back on the real clock.`);
  on.refresh();
}

// Stop the walk. The line goes back to reading the real clock.
//
// The real clock is read here rather than left to the next beat, so the repaint this
// press causes already reads the real day: without it the whole day would go on being
// labelled — and drawn — from the minute the walk started until the clock caught up, and
// for that second the board would be showing times that are not the morning's.
//
// The BELL is deliberately left where she put it. It is the third of her three buttons
// and it has its own press, so stopping the walk is not also a decision about sound —
// and clearing run.lastMin is what stops a call being made for a minute the real clock
// has already gone past.
function boardStop(run, sc, on) {
  if (!run.on) return;
  run.on = false;
  run.lastMin = -1;
  run.pan = 0;
  // The real clock, read here rather than waited for. The beat would put the day back on
  // its own start a second later, and until then the whole day would go on being labelled
  // from the minute the walk began — and, now that a repaint places the line itself, the
  // line would be DRAWN there too, so Stop would flash the day at the wrong minute on the
  // one press whose whole job is to put it back. Taken from the same function the beat
  // takes it from, so the two cannot disagree about where the day is.
  const at = boardNow(sc, run.boardR);
  run.dayStart = Number(sc.dayStartMin) || 0;
  run.nowMin = at.min;
  run.nowNote = at.note;
  toast("Stopped — the line is back on the real clock.");
  on.refresh();
}

// The board's own control row: three presses for the walk, two for the line.
//
// Her list, 24 September 2026: "I need walk the day, Button 'START THE DAY NOW',
// 'STOP', 'The N Called', these button are for the person's windows", and then, for the
// simulation: "left buttton make the clock back to current, Right button, when clicked,
// dropdown a choice list, slow, Mid, fast."
//
// Every press is DRAWN at every state of the day and goes inert rather than absent,
// which is this app's own rule for a control: a button that comes and goes reads as a
// fault, and Start vanishing the instant it is pressed would leave her wondering
// whether the press had been taken at all. Start and Stop are drawn as a pair with one
// of them disabled, which is also what tells her at a glance which of the two the day
// is doing.
//
// The row sits INSIDE the train's own window, above the person's windows, so the three
// press that work the walk are standing next to the lines they work — her "these button
// are for the person's windows."
function boardControls(r, sc, state, on, run) {
  const called = callCount(r, state);
  // Read back through the node rather than from the event: the app's own `select` calls
  // its handler with no arguments (see ui.js), so the value it has just taken is the
  // only place the new choice can be read from.
  let box = null;
  const pick = () => {
    run.speed = speedOf(box && box.value).per;
    toast(`Walking at ${speedOf(run.speed).label} — ${speedOf(run.speed).per === 1 ? "her own morning's pace" : `${speedOf(run.speed).per} minutes of the day a minute`}.`);
  };
  box = select(
    BOARD_SPEEDS.map((s) => ({ value: s.value, label: s.label })),
    String(speedOf(run.speed).value),
    pick,
  );

  // The Scale, on the board's own row. Asked for directly on 25 September 2026 — "Yes, add
  // Scale to the board" — and it had to be asked for, because the train did not obey the
  // Scale at all before this release and there was nothing here to change.
  //
  // It writes `sc.pxPerMin`, which is the one setting the planner's own Scale step already
  // saves, and it can: since v193 the train is drawn in the day's own units, so the two
  // screens' Scales are the same number rather than two numbers that happen to look alike.
  // Moving it here therefore moves the train AND the planner's windows below it, which is
  // honest — they are one day at one scale — and there is no new stored key and no SQL.
  //
  // The hand's own offset is dropped on a Scale press, deliberately. `run.pan` is measured
  // in the OLD pixels, so keeping it would leave her looking at a stretch of the day she
  // never chose; and the honest answer to "draw this bigger" is to draw the same moment,
  // which is what the day's own placement does. Nothing else about her scroll is touched.
  const at = PX_PER_MIN_CHOICES.findIndex((px) => Math.abs(r.pxPerMin - px) < 0.01);
  const step = (by) => {
    const to = Math.max(0, Math.min(PX_PER_MIN_CHOICES.length - 1, at + by));
    if (to === at) return;
    sc.pxPerMin = PX_PER_MIN_CHOICES[to];
    run.pan = 0;
    on.persist();
    on.refresh();
  };
  const scaleName = at < 0 ? `${r.pxPerMin}x` : SCALE_NAMES[at];

  return el("div", { class: "tr-ctl" },
    el("div", { class: "tr-ctl-row" },
      el("button", {
        type: "button", class: "tl-chip",
        disabled: run.on,
        onclick: () => boardStart(run, sc, state, on),
      }, "▶ Start the day now"),
      el("button", {
        type: "button", class: "tl-chip",
        disabled: !run.on,
        onclick: () => boardStop(run, sc, on),
      }, "■ Stop"),
      // The bell, as one press. It says how many people it will ring for and it throws
      // the ringing on and off — the same count the planner's own bell chip gives her,
      // and the same sound a board has always had. The label moves with the state the
      // way Start's and Stop's do, because a switch that does not say which way it is
      // thrown is a switch she has to press to find out.
      el("button", {
        type: "button", class: `tl-chip${run.callsOn ? " on" : ""}`,
        onclick: () => (run.callsOn ? boardCallsOff(run, on) : boardCallsStart(run, on)),
      }, called
        ? (run.callsOn ? `🔔 Calling ${called}` : `🔔 ${called} called`)
        : "🔔 Nobody to call")),
    el("div", { class: "tr-ctl-row" },
      // Her left button: the line back where the day puts it. While it has nothing to
      // put back it says so rather than sitting there doing nothing quietly.
      el("button", {
        type: "button", class: "tl-chip",
        onclick: () => {
          if (!panBack(run)) toast("The line is already at the current time.");
        },
      }, "⟲ Back to now"),
      // Her right button: a drop-down of the three speeds. Changing it repaints
      // nothing, because nothing on the screen says the speed yet — the box itself is
      // what says which one is in force, and a repaint here would move nothing and cost
      // her the scroll she is reading.
      el("div", { class: "tr-ctl-speed" },
        el("span", { class: "tr-ctl-lab" }, "Walk speed"),
        box)),
    // The Scale, drawn exactly as the planner draws its own step — same classes, same
    // order, same disabled ends — so the two screens' Scales look and behave alike. Its
    // ends are DISABLED rather than absent, which is this app's rule for a control that
    // cannot act: a press at the end of the six stops does nothing and says so by looking
    // inert instead of by quietly refusing.
    el("div", { class: "tr-ctl-row" },
      el("div", { class: "tl-ctl-group" },
        el("span", { class: "tl-ctl-lab" }, "Scale"),
        el("button", {
          type: "button", class: "tl-step",
          disabled: at <= 0,
          onclick: () => step(-1),
        }, "−"),
        el("span", { class: "tl-step-name" }, scaleName),
        el("button", {
          type: "button", class: "tl-step",
          disabled: at >= PX_PER_MIN_CHOICES.length - 1,
          onclick: () => step(1),
        }, "+"))));
}

// Calls, switched on by a finger.
//
// This is the whole of what a board borrows from the planner's walk-through, and it
// borrows it for one reason: a phone blocks sound until something real has touched
// the page, and this press is that touch. It does NOT call startDay — a board is
// reading the day's real clock, not walking her day from this minute — so all it
// takes are the audio context, the wake lock, and the promise that the minute just
// gone has already been answered for. Seeded from the minute the board is standing
// on, so switching calls on at 9:40 does not fire every call the morning has already
// made.
function boardCallsStart(run, on) {
  if (run.callsOn) return;
  run.lastMin = Math.floor(run.nowMin);
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !run.audio) run.audio = new Ctx();
  } catch { run.audio = null; }
  try {
    if (navigator.wakeLock && !run.wake) {
      navigator.wakeLock.request("screen").then((s) => { run.wake = s; }).catch(() => {});
    }
  } catch { /* the board does not depend on it */ }
  run.callsOn = true;
  on.refresh();
  toast("Calls are on — one minute before each job, in that person's own colour.");
}

function boardCallsOff(run, on) {
  if (!run.callsOn) return;
  run.callsOn = false;
  run.lastMin = -1;
  if (run.pending) { run.pending.remove(); run.pending = null; }
  on.refresh();
  toast("Calls are off.");
}

// What is next, and how long it is. This is the whole of what she asked a board to
// say — "give the worker good inform of what next for them, how long" — and it says
// it in CLOCK TIMES, never in countdowns. A countdown means rewriting a box on the
// screen every second, which is the repaint-under-her-scroll this app has already
// been bitten by.
//
// By person where the day has people of its own, because that is the question a
// worker asks — "what am I on now, and what is after it". A day that is sharing
// them out has no people of its own: its row numbers are the packing's invention
// and they are renamed whenever anything moves, so the board names the JOBS instead.
// That is not a lesser answer — the job and the time are what somebody standing at
// the bench acts on.
function boardAhead(sc, state, run) {
  const calls = state.settings.personCalls || {};
  const mine = callWindows(sc).filter((w) => calls[w.who] !== false && w.to > run.nowMin);
  const shared = (sc.modules || []).some((m) => Number(m.person) > 0
    || (m.crew || []).some((p) => Number(p) > 0)
    || Object.values(m.slotPerson || {}).some((v) => Number(v) > 0));
  if (!shared) return { people: [], jobs: mine.slice(0, 3) };
  const byWho = new Map();
  for (const w of mine) {
    if (!byWho.has(w.who)) byWho.set(w.who, []);
    byWho.get(w.who).push(w);
  }
  return {
    people: [...byWho].slice(0, 6).map(([who, list]) => ({
      who, doing: list[0], then: list[1] || null,
    })),
    jobs: [],
  };
}

// Everything the board's heading card holds. Split out from the card itself because
// what it says is about the CLOCK and not about the plan: "what is next" stops being
// true the moment that job starts, so this is the one piece of the board that has to
// be said again as the day runs. See `boardAheadKey` for when.
function boardTopBody(r, sc, state, run, on) {
  const ahead = boardAhead(sc, state, run);
  const called = callCount(r, state);
  // The clock has already gone past the day's last job. `boardAhead` drops everything
  // whose end has gone by, so on this one day its list is empty for a reason that is
  // the opposite of "there is nothing here to do" — see the two sentences below.
  const over = /^day ended /.test(run.nowNote);
  // `r.dayStartMin` and not `sc.dayStartMin`: while the day is being walked the run's own
  // start is the hour she pressed "Start the day now" at, and the trains and the countdowns
  // are all read against that. A strip naming clocks off the PLAN's start would name hours
  // the workers' lines are not showing — two answers to one question, on one screen.
  const what = (w) => `${jobName(w)} — ${clockAt(r.dayStartMin, w.from)} · ${trim(w.to - w.from)} min`;
  const lines = [];
  if (ahead.people.length) {
    for (const a of ahead.people) {
      lines.push(el("div", { class: "bd-next" },
        el("div", { class: "bd-job" },
          el("span", { class: `bd-who ${personTone(a.who)}` }, personName(a.who, namesOf(state))),
          el("span", { class: "bd-what" }, what(a.doing))),
        a.then
          ? el("div", { class: "bd-then" }, `then ${jobName(a.then)} at ${clockAt(r.dayStartMin, a.then.from)}`)
          : null));
    }
  } else {
    for (const w of ahead.jobs) {
      lines.push(el("div", { class: "bd-next" }, el("div", { class: "bd-job" },
        el("span", { class: "bd-what" }, what(w)))));
    }
  }

  // A real `replaceChildren` does NOT skip a null the way `el()` skips a null child —
  // it converts every argument with String(), so one null here puts the word "null" on
  // the screen. Nothing in this array may be a null; leave the sentence out instead.
  const parked = run.nowNote
    // The board says when the real clock is outside the day it is drawing. The
    // line itself carries the short form; this is the sentence that explains it.
    ? [el("div", { class: "bd-note" },
      `It is ${clockOf(Math.round(currentMinutesOfDay()))} now, and ${run.nowNote.replace(/^day /, "your day ")} — so the line on the chart is parked at that edge.`)]
    : [];

  const next = lines.length
    ? lines
    : [el("div", { class: "bd-note" }, over
      ? "The day is finished — every job on it has been and gone."
      : "Nothing on this day needs hands, so there is nobody to be anywhere next.")];

  // "Keep the Next Up" is her clause 1, and the strip keeps its own label because the
  // heading above the card is the DAY'S own name (her clause 7) — a name tells her which
  // morning this is, and says nothing about the three lines under it. Two labels, two
  // jobs: the name above the card, the words "Next up" over the lines. The label is drawn
  // even when there is nothing to name, because a strip that loses its title on a quiet
  // day reads as a strip that has gone wrong.
  const head = el("h3", { class: "bd-head" }, "Next up");

  // A day the clock has already passed is the one case where the count below is not
  // the whole truth. The board seeds `lastMin` from the minute it is standing on, so
  // switching calls on now would ring for nobody — the offer is withdrawn rather than
  // left to promise a sound it cannot make. Stop stays, because calls turned on
  // earlier must always be switchable off.
  //
  // The Clear press is a control of a different kind and is NOT withdrawn with it: the
  // offer to make sound is about this minute, and clearing the board is about the whole
  // morning — a finished day can still be carrying ticks nothing will ever answer. So
  // the actions row is always drawn and Clear is always in it, going quiet rather than
  // disappearing while there is nothing to clear (see clearBoard).
  const ticks = ackCount(state);
  const clear = button("Clear the board", () => clearBoard(run, state, on), ticks ? "danger" : "ghost");
  clear.disabled = !ticks;

  const foot = [el("div", { class: "bd-foot" },
    // How many of them would be called, said before the button rather than behind it
    // — the same count the planner's own bell chip gives her.
    over && !run.callsOn ? null : el("div", { class: "bd-note" }, run.callsOn
      ? (over
        ? "Calling is on, but this day is finished — there is nothing left to call."
        : `Calling ${called} ${called === 1 ? "person" : "people"} — one minute before each job, in that person's own colour.`)
      : (called
        ? `${called} ${called === 1 ? "person" : "people"} would be called. Sound needs a press, so start it here.`
        : "Nobody is set to be called on this day.")),
    // What the Clear press is about to throw away, said before it is pressed rather
    // than behind the question it opens — the same shape as the count above it.
    el("div", { class: "bd-note" }, ticks
      ? `${ticks} ${ticks === 1 ? "job is" : "jobs are"} marked as taken${over ? " on this finished day" : ""}.`
      : "Nothing is marked as taken, so there is nothing to clear yet."),
    el("div", { class: "bd-actions" },
      over && !run.callsOn ? null : (run.callsOn
        ? button("Stop calling", () => boardCallsOff(run, on), "ghost")
        : button("Start calling", () => boardCallsStart(run, on), "primary")),
      clear))];

  return [...parked, head, ...next, ...foot];
}

// The board's own heading card: what is next, and the one button a board has.
//
// The button is not "start the day" — a board is not walking anything — and the
// only reason it exists at all is that a phone will not make a sound until a real
// finger has touched the page. It reads as an offer rather than as a step, because
// that is what it is: everything on this screen works with it left alone.
function boardTopCard(r, sc, state, run, on) {
  const card = el("div", { class: "card bd-top" }, ...boardTopBody(r, sc, state, run, on));
  run.strip = card;
  run.stripKey = boardAheadKey(r, sc, state, run);
  // The heading is the DAY'S OWN NAME — her "Name of the scenario should be on Top of
  // page" — and not the words "Next up", which have moved in under it. The name is what
  // tells a worker, and her, WHICH day this board is walking: the app can hold more than
  // one, the board is opened on whichever she was last in, and a screen that led with a
  // label true of every day on earth was the one thing here that could not be told apart
  // from the same screen showing another morning. It falls back to "The day" only for a
  // scenario that has not been named — the same fallback the shelf uses.
  const title = String(sc.name || "").trim() || "The day";
  return el("div", {}, el("h2", { class: "section bd-title" }, title), card);
}

// What the strip would say, boiled down to one string, so the board's own beat can
// tell whether the answer has changed without building anything to compare.
//
// It has to be watched at all because what is next moves as the clock runs, and a
// strip drawn once when the board was opened would still be naming a job that finished
// hours ago — which is the whole of what this screen is for. It is compared rather
// than rebuilt so the card is left stone still through the long stretches where
// nothing has changed, and the chart under it is never touched either way.
//
// The live minute rides on this key ONLY while the line is parked outside her day.
// Inside the day `nowNote` is empty and nothing here is a clock reading, so the key
// holds until a job really starts or ends. Parked, the sentence above the strip names
// the time on the wall, and a sentence naming the wrong hour is worse than the work of
// saying it again.
function boardAheadKey(r, sc, state, run) {
  const a = boardAhead(sc, state, run);
  const id = (w) => `${w.module}.${w.cycle}.${w.batch}.${w.slot}`;
  return [
    run.callsOn ? "on" : "off",
    /^day ended /.test(run.nowNote) ? "over" : "running",
    callCount(r, state),
    run.nowNote ? String(Math.floor(currentMinutesOfDay())) : "",
    a.people.map((p) => `${p.who}=${id(p.doing)}>${p.then ? id(p.then) : ""}`).join(","),
    a.jobs.map(id).join(","),
  ].join("|");
}

// The minute of the day the wall clock is on, as a number. Kept beside boardNow and
// read the same way, so the sentence above the strip cannot name a different time
// from the line on the chart.
function currentMinutesOfDay() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

// A read-only card: a list of readings, and nothing that writes. Every card on a
// board is built from this, so there is exactly one place a board's card can be
// shaped and no card can quietly acquire a control.
//
// A row whose value is empty is dropped rather than drawn blank — a board's card
// lists what is true of this batch, this module or this person, and "Cycle: (nothing)"
// is a line about a thing that is not there.
function boardReadout(title, lines) {
  const rows = lines.filter((r) => r && r[1] != null && r[1] !== "");
  showPopup(title, () => el("div", { class: "bd-card" },
    ...rows.map(([lab, val]) => el("div", { class: "bd-row" },
      lab ? el("span", { class: "bd-lab" }, lab) : null,
      el("span", { class: "bd-val" }, val)))));
}

// One batch, as a worker reads it: which batch of how many, the two clock times,
// how long the dough is in it and how much of that is hands, and who is on it.
function boardJobCard(r, m, live, sc, state, k) {
  // `m` is the module as the DAY has it (its computed passes) and `live` the stored
  // module; a module that is switched off has only the one. So the times come from
  // whichever of them is carrying a pass, and nothing here computes a time of its own.
  const here = r.modules.find((x) => x.id === live.id) || m;
  const p = (here.passes || [])[k] || null;
  // How many batches the DAY runs, not how many she asked for: a module asked for six
  // batches that a day can only hold four of draws four bars, and a card calling the
  // fourth "4 of 6" would be describing a bar that is not on the chart.
  const n = here.repeatsHeld || (here.passes || []).length || here.repeats || 1;
  const at = p ? p.at : Number((cycleStarts(live))[k]) || 0;
  const end = p ? p.end : at + (here.cycleMin || 0);
  // Which cycle of the batch these hands are for, when she has named it. String(…).trim()
  // and NOT trim() — the imported trim is production.js's number formatter and answers
  // "0" for an unnamed cycle, which is what the module's card used to print above the clock.
  const win = callWindows(sc).find((w) => w.module === live.id && w.batch === k) || null;
  const cyc = win && win.cycle >= 0 ? (here.cycles || [])[win.cycle] : null;
  const name = cyc ? String(cyc.name || "").trim() : "";
  boardReadout(`${live.icon || m.icon} ${live.name} · batch ${k + 1} of ${n}`, [
    ["When", `${clockAt(sc.dayStartMin, at)} → ${clockAt(sc.dayStartMin, end)}`],
    ["How long", `${trim(here.cycleMin)} min a batch` + (here.touchMin ? `, ${trim(here.touchMin)} min of hands` : ", no hands")],
    ["Where", here.lines > 1 ? `line ${(p && p.line != null ? p.line : 0) + 1} of ${here.lines}` : null],
    ["What for", name || null],
    ["Who", win ? personName(win.who, namesOf(state)) : null],
  ]);
}

// One module, as a worker reads it: the tags it wears, when it starts and how many
// batches it runs, what a batch costs it, and then one line per batch. The first
// three lines are the planner's own moduleNotes, which is the whole point — the
// module's card on a board and the module's card in the planner cannot say different
// things about the same module.
//
// `m` is the module as the day has it, `live` the module as stored; the times come
// from `m` because only it has been through the chain.
function boardModuleCard(r, m, live, sc, state) {
  const notes = moduleNotes(r, m, live);
  const batches = (m.passes || []).map((p, k) => ["", `Batch ${k + 1}: ${clockAt(sc.dayStartMin, p.at)} → ${clockAt(sc.dayStartMin, p.end)}`]);
  boardReadout(`${(live.icon || m.icon)} ${live.name || m.name}`, [
    ["", notes.tags.length ? notes.tags.map((t) => t.text).join(" · ") : null],
    ["When", notes.when],
    ["One batch", notes.cost],
    ...(batches.length > 1 ? [["", "Every batch in this module"], ...batches] : []),
  ]);
}

// One person's whole day, as a worker reads it — the same words their card carries in
// the planner, from the same builder, plus their name and how much of the day is
// theirs.
function boardPersonCard(row, sc, state, r) {
  const notes = personNotes(row, sc, state, r.dayStartMin);
  boardReadout(`👤 ${notes.who}`, [
    // The hours come first, because "when am I here" is the first question of a
    // worker's own day and a card printing their jobs without it would be answering
    // the second question first. What is deliberately NOT on a board is how many
    // modules they are trained for: that is a planning number, and the worker's own
    // "What they do" list is the bench answer and is a few lines below.
    ["Their hours", notes.shiftLine],
    ["Their day", hoursAndMinutes(notes.busy) + (notes.places > 1 ? ` of work, in ${notes.places} places` : " of work")],
    ...(notes.clashes ? [["Watch out", notes.clash]] : []),
    ...(notes.outside.length
      ? [["Cannot fit", el("div", { class: "bd-sub" },
        ...notes.outside.map((o) => el("div", { class: "bd-sub" }, o.text)),
        notes.outsideMore > 0
          ? el("div", { class: "bd-sub" }, `…and ${notes.outsideMore} more like that.`)
          : null)]]
      : []),
    ["What they do", el("div", { class: "bd-sub" },
      ...(notes.jobs.length
        ? notes.jobs.map((j) => el("div", { class: "bd-sub" }, j))
        : [el("div", { class: "bd-sub" }, "Nothing on this person yet.")]),
      notes.more > 0 ? el("div", { class: "bd-sub" }, `…and ${notes.more} more.`) : null)],
  ]);
}

// The time cursor: a hairline down the whole day that reads the clock at
// wherever she points. The ruler along the top says 8:00; this is what answers
// "and what is here?" — which is the question she asks of a chart when she is
// lining two modules up. It only ever reads: nothing here writes a module, moves a
// bar, or changes a number.
//
// A mouse can hover and a finger cannot, so the two get the gestures they
// actually have. Over the chart the line follows the pointer and leaves with it.
// Along the clock strip the drag belongs to the cursor instead of the scroll —
// that one band is the only part of the chart that does not pan — and because a
// finger never hovers, the cursor it places simply stays where she let go, which
// is what a finger needs to read a time against two bars. Swipe the chart
// afterwards and the line travels with the minute it names.
function wireTimeCursor(tl, r, cursor, lab, clock, mirror) {
  // `clock` is the clock the chart actually drew, handed over rather than looked up
  // by class afterwards — so what is wired is what is on the screen, and a test can
  // see the wiring rather than only the promise of it. Its own offset is what the
  // hairline is placed against, so every reading is measured from it and from
  // nowhere else.
  const ruler = trackOf(clock);
  if (!ruler) return;
  const frame = cursor.parentNode;
  let dragging = false;
  // Both hairlines go together, always: a reading taken in one window and left
  // standing in the other would be two different answers on one chart.
  const hide = () => { cursor.hidden = true; lab.hidden = true; if (mirror) mirror.hidden = true; };
  const place = (clientX, clientY) => {
    const rr = ruler.getBoundingClientRect();
    // The reading is only taken where the DAY is in front of her. The ruler's own
    // track scrolls with the day, so once she pans right its left edge has travelled
    // off behind the pinned titles and `clientX - rr.left` stays positive over the
    // title column as well — enough to place a number and a hairline on top of the
    // module names, which is the writing she reported seeing between the titles. The
    // ruler's left edge plus what she has panned by is where the titles end and the
    // day begins, measured rather than assumed from the name column's own width, and
    // at rest this is exactly rr.left, so nothing about an unpanned day changes.
    const dayLeft = rr.left + (tl.scrollLeft || 0);
    if (clientX < dayLeft) { hide(); return; }
    const t = minuteAtPx(clientX - rr.left, r.pxPerMin, r.windowMin);
    if (t == null) { hide(); return; }
    cursor.hidden = false;
    lab.hidden = false;
    const x = t * r.pxPerMin;
    const left = Math.round(ruler.offsetLeft + x);
    cursor.style.left = `${left}px`;
    lab.style.left = `${left}px`;
    // The same minute in the people's window, at the same pixel — the two name
    // columns are the same width, so one left is right for both. The READING is
    // not copied: its height comes from where the pointer is, which is a place the
    // other window has nothing to do with, so a reading pinned there would name a
    // minute at a height that means nothing. The line travels, the number stays
    // where she is looking.
    if (mirror) { mirror.hidden = false; mirror.style.left = `${left}px`; }
    // The reading follows the pointer down the day as well as across it. It used
    // to sit at the top of the chart, which is the right place only while the top
    // of the chart is on screen: with a mouse the pointer reads a bar four rows
    // down and the clock is a screen away, and only a mouse ever hovers, so the
    // one gesture that could not use it was the one that had it. Kept inside the
    // chart, so a reading can never be parked off the edge of the day.
    if (frame && Number.isFinite(clientY)) {
      const box = frame.getBoundingClientRect();
      const h = lab.offsetHeight || 18;
      const y = clientY - box.top;
      // Clear of the pointer rather than on it: a reading under her own finger is
      // a reading that hides the bar she is holding it against. Her words of 23
      // September: "put the clock balon 2 inches higher than. cursor" — so it is
      // lifted well clear of the line rather than sitting a hair above the pointer,
      // which is where a reading read as part of her hand.
      //
      // The lift is named in the unit she used. A CSS inch is 96 pixels by
      // definition, so two of them is a number this can be held to rather than a
      // feeling: raise or lower LIFT and the balloon follows, and it follows in
      // one place only, because this one line places the one reading both windows
      // share.
      //
      // It goes UP by preference, and the whole two inches of it or nothing: a
      // balloon that came to rest at the window's top when it ran out of room would
      // be lying on her hand exactly where she took hold of the clock strip, which
      // is at the top of the modules' window and is the one place on this chart she
      // presses with a finger. So when the two inches do not fit above her pointer
      // the reading takes the same two inches BELOW it — the distance she asked for
      // is kept, and only the side of it changes.
      //
      // And it is held to the WINDOW rather than to the day. The day can be taller
      // than the window she is looking through, and a lift measured against the
      // day would carry the balloon off the window and hide it exactly when there
      // is a full day to read. Measured against the window, two inches of lift or
      // the window's own top, whichever she reaches first — so the reading is
      // always on the screen in front of her.
      const LIFT = 2 * 96;
      const win = frame.parentNode ? frame.parentNode.getBoundingClientRect() : box;
      const visTop = win.top - box.top;
      const visBottom = Math.max(visTop + h, Math.min(win.bottom - box.top, box.height));
      const above = y - h - LIFT;
      const below = y + LIFT;
      const top = above >= visTop ? above
        : (below + h <= visBottom ? below : visTop);
      lab.style.top = `${Math.round(Math.min(Math.max(visTop, top), visBottom - h))}px`;
    }
    lab.textContent = clockAt(r.dayStartMin, t);
    // The reading hangs off the right of the line, so at the far end of the day
    // there is no room for it and it has to hang to the left instead. Measured
    // in px rather than minutes, so it holds at every scale she can pick.
    lab.classList.toggle("at-end", x > r.windowMin * r.pxPerMin - 60);
  };

  // The clock strip only. Capture means the drag keeps working once the finger
  // wanders off the strip, so a time stays as easy to hit at the far left of the
  // day as in the middle of it.
  const end = () => { dragging = false; };
  ruler.addEventListener("pointerdown", (e) => {
    // The reading is taken with the left button, or with a finger. The RIGHT button
    // belongs to the pan (see wirePaneDrag), and a press that is moving the day must
    // not drag a reading along with it: one press, one gesture.
    if (!isPrimaryClick(e)) return;
    dragging = true;
    place(e.clientX, e.clientY);
    // A pointer already gone by the time this runs cannot be captured, and it
    // throws rather than saying so — but the reading is placed either way, so
    // losing the capture must not lose the drag or the cursor with it.
    try { ruler.setPointerCapture(e.pointerId); } catch { dragging = false; }
  });
  ruler.addEventListener("pointermove", (e) => { if (dragging) place(e.clientX, e.clientY); });
  ruler.addEventListener("pointerup", end);
  ruler.addEventListener("pointercancel", end);

  // Everywhere else. A pen and a mouse read the chart without touching it, and
  // the line leaves when the pointer does; a touch is skipped because there is
  // no hovering one — its gesture is the strip above.
  tl.addEventListener("pointermove", (e) => {
    if (dragging || e.pointerType === "touch") return;
    place(e.clientX, e.clientY);
  });
  tl.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") hide();
  });
}

// The two windows pan as one. Each keeps its own horizontal overflow — that is what
// pins its name column, and a pane with no horizontal overflow slides its names off
// the left edge with the day — so the two are kept in step rather than being one
// scrollport.
//
// v167 shared one horizontal slider between them. She took it back out, 23 September:
// "since the both windows have their own slider, additional slider is redundent.
// Remove that" — so each window's own scrollbar is the pan, and what is left to do
// here is the half of that release she did want: "let the ruler sync in the 2
// windows". Kept in step by a DEADBAND, not a lock. Assigning scrollLeft does not
// fire a scroll event synchronously in Chrome or WebKit; it is queued to the next
// rendering opportunity. So a flag set before the write and cleared after it is
// already clear by the time the echo arrives, the echo is not suppressed, and it
// writes back to the window her finger is on — which is the documented way to kill
// momentum scrolling on iOS, and the pan under her thumb stops dead. A tolerance of
// one pixel drops the echo of our own write and can never oscillate on a fractional
// scrollLeft. The writer is coalesced to one per frame for the same reason: one
// forced layout a frame on a phone under momentum, not one per event.
//
// scrollLeft ONLY. The two windows' vertical positions are independent on purpose
// (that is the whole point of splitting them, so growing people cannot squeeze the
// processes), and a handler that mirrored both would still pass every horizontal
// check anyone would think to write.
//
// Neither window is clamped to the other's travel, and it does not need to be: both
// hold the same day, so both can pan to the same place. What used to make them
// differ is gone — see .tl-tick.last, where the last hour of the ruler stopped
// hanging its name off the end of the day and making the modules window 47 pixels
// wider than the people's.
function wirePaneScroll(a, b) {
  const panes = [a, b];
  const after = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));
  let queued = 0;
  const follow = (from) => {
    if (queued) return;
    queued = after(() => {
      queued = 0;
      const x = Math.max(0, Number(from.scrollLeft) || 0);
      for (const other of panes) {
        if (other !== from && Math.abs((Number(other.scrollLeft) || 0) - x) > 1) other.scrollLeft = x;
      }
    });
  };
  for (const p of panes) p.addEventListener("scroll", () => follow(p));
}

// Is this an activation by the primary button — the left button, a finger, a pen?
//
// It is a question the chart has to ask because the RIGHT button is how she pans it
// (see wirePaneDrag), and a press that pans the day must open nothing. Her words, 23
// September: "can i drag the module window up/down, left/right by right click and
// hold? Dont let this action open up the card." A browser fires no click at all for
// the right button, so this guard is the belt to that pair of braces rather than the
// whole of it — but it is the half the app owns, and it is the half a test can prove.
//
// It matters most on a bar, because a bar is where she will press: the bars cover
// most of the day, and every one of them opens a card on a left press. An activation
// with no button number at all is primary — that is what a keyboard's own click and a
// test's synthetic event are, and neither is a right press.
function isPrimaryClick(e) {
  return !e || e.button == null || Number(e.button) === 0;
}

// Right-press and hold to drag a window's day about, up and down as well as sideways.
//
// Three things are in her sentence above and all three are here. One: the gesture is
// the RIGHT button, so it can never be confused with the left press that opens a card.
// Two: it moves both axes, because the day is wider than the window and, on a day of
// six modules, taller too. Three: it is a PAN and not a nudge — the day travels with
// her hand, which is why the scroll position moves the OPPOSITE way to the pointer,
// exactly as if she had taken hold of the paper and pulled it.
//
// Both windows are wired in one statement, deliberately. They are the same kind of
// pane, and a gesture that worked in the modules' window and did nothing in the
// people's would read as a fault. Sideways, this needs no second write path: setting
// scrollLeft fires the scroll event the sync above is already listening for, so a drag
// on either window brings the other with it and the two cannot disagree about a minute.
//
// A finger can never set button 2, so nothing here is reachable from her phone and the
// touch behaviour is untouched: this is a computer's gesture.
//
// The gesture is wired on three surfaces and the day under the hand is what moves.
// The two windows are the obvious two. The third is the sheet a card opens on, and it
// is there because of her report of 23 September: "right button drug dont work". The
// card is drawn on a full-screen sheet, so with a card open her right press landed on
// the sheet and the day behind it — the thing she was actually looking at — could not
// be moved at all. Measured at a phone's width with a batch card open: a right press
// 200 pixels into the day, dragged 60 to the left, left the window reading 200 exactly
// where it started. On the sheet the event's own target belongs to no window, so the
// window is found by where her hand is instead. Her own card is left out of it (see
// press below): this is a gesture for the day behind a card, not for the card.
//
// The two windows are rebuilt on every repaint, so they are bound afresh each time —
// but the sheet is a single element belonging to the whole app, not to this screen
// (ui.js owns it and hides it rather than throwing it away), so it is wired ONCE and
// asks this list which windows are on the screen at the press. Wiring it every time
// would stack one more copy of the same gesture on it for every visit to the screen.
const dragPanes = [];

function wirePaneDrag(a, b) {
  dragPanes.length = 0;
  for (const p of [a, b]) if (p && p.addEventListener) dragPanes.push(p);
  for (const pane of dragPanes) bindDrag(pane, () => pane);
  const layer = document.getElementById("popup-layer");
  if (layer && layer.addEventListener && !layer.tlPanWired) {
    layer.tlPanWired = true;
    bindDrag(layer, (e) => paneAt(dragPanes, e));
  }
}

// Which window a press is over, by where the hand is. Only needed for a press that
// arrives on the card's own sheet, whose target is the sheet.
function paneAt(panes, e) {
  const x = Number(e && e.clientX) || 0;
  const y = Number(e && e.clientY) || 0;
  return panes.find((p) => {
    const r = p.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }) || null;
}

function bindDrag(surface, choose) {
  // The gesture in progress: where the pointer went down, and where the day was at
  // that moment. Held in a closure rather than on the node, so two surfaces cannot
  // share one drag.
  let held = null;
  let pane = null;
  const press = (e) => {
    if (!e || Number(e.button) !== 2) return;
    // Her card keeps its own presses. A right press on the card's body or its buttons
    // is not a pan, or the day would slide about while she is reading the card that
    // describes it.
    if (e.target && e.target.closest && e.target.closest(".popup-card")) return;
    pane = choose(e);
    if (!pane) return;
    held = {
      id: e.pointerId,
      x: Number(e.clientX) || 0,
      y: Number(e.clientY) || 0,
      left: Math.max(0, Number(pane.scrollLeft) || 0),
      top: Math.max(0, Number(pane.scrollTop) || 0),
    };
    pane.classList.add("tl-dragging");
    e.preventDefault();
    // Keep the moves coming after the pointer leaves the pane, which it does within
    // a few pixels of a drag — without this the day stops dead at the window's own
    // edge with her finger still down. Capture can throw rather than say so when the
    // pointer has already gone, and losing the capture must not lose the drag or the
    // class that says it is happening.
    try { if (surface.setPointerCapture && held.id != null) surface.setPointerCapture(held.id); } catch { /* the drag is the gesture; capture only widens it */ }
  };
  const move = (e) => {
    if (!held || !e || !pane) return;
    // A move with no right button held is not a drag — the press ended somewhere the
    // release never reached. Drop it rather than leave the pane stuck to the pointer.
    if (e.buttons != null && (Number(e.buttons) & 2) === 0) { release(); return; }
    pane.scrollLeft = Math.max(0, held.left - ((Number(e.clientX) || 0) - held.x));
    pane.scrollTop = Math.max(0, held.top - ((Number(e.clientY) || 0) - held.y));
    e.preventDefault();
  };
  const release = () => {
    if (!held) return;
    if (pane) pane.classList.remove("tl-dragging");
    held = null;
    pane = null;
  };
  surface.addEventListener("pointerdown", press);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);
  // The browser's own menu is the one thing a right press would otherwise put on the
  // screen, and it would land in the middle of the gesture that press is starting.
  // Nothing of hers is behind it: the chart has no menu of its own.
  surface.addEventListener("contextmenu", (e) => e.preventDefault());
}

// How many minutes the ruler steps by at the scale the day is drawn at. Nearest
// stop, the same match the scale's own step uses — a hand-typed pixels-per-minute
// is normalised to one of the six, so this only ever has to land on the stop she
// is actually reading at. The fallback is not decoration: a short TICK_MIN would
// hand rulerRow an undefined step, and its `for (m = 0; m < end; m += step)` would
// never advance — a hang, not a message.
function tickStepFor(pxPerMin) {
  const at = PX_PER_MIN_CHOICES.reduce(
    (best, c, i) => (Math.abs(c - pxPerMin) < Math.abs(PX_PER_MIN_CHOICES[best] - pxPerMin) ? i : best), 0);
  return TICK_MIN[at] || TICK_MIN[TICK_MIN.length - 1];
}

// How far apart the grid drawn under the ruler is, in minutes. See TICK_GRID_MIN
// for why it is not simply the ruler's step: 30 minutes at the widest reading, the
// quarter hour at the standard one, and five minutes at all four of the close
// readings — 36, 24, 12, 16, 24 and 36 pixels apart, so no stop is ever asked to
// draw a line it cannot separate from its neighbour. It is a search over the table
// and not a fourth index, so the two new stops need no entry of their own.
function gridStepFor(pxPerMin) {
  const scale = Number(pxPerMin) > 0 ? Number(pxPerMin) : PX_PER_MIN_CHOICES[1];
  const ruler = tickStepFor(scale);
  return TICK_GRID_MIN.find((s) => s >= ruler && s * scale >= GRID_MIN_PX)
    || TICK_GRID_MIN[TICK_GRID_MIN.length - 1];
}

function rulerRow(r, trackW) {
  const step = tickStepFor(r.pxPerMin || PX_PER_MIN_CHOICES[1]);
  // The last hour the day reaches, and the room a name needs beside its own line: a
  // label is about 45 pixels of 10.5px type set 5 pixels to the right of its tick.
  // Only the last hour can be short of that room.
  const lastHour = Math.floor(r.windowMin / 60) * 60;
  const LABEL_ROOM = 50;
  const ticks = [];
  for (let t = 0; t <= r.windowMin; t += step) {
    const x = Math.round(t * r.pxPerMin);
    if (t % 60 === 0) {
      // On the hour: solid, and it says the time. The last one writes its name on the
      // other side of its own line when there is no longer a day to its right to
      // write it in — see .tl-tick.last for why that is not a detail: a name hanging
      // off the end of the day made the modules window 47 pixels wider than the
      // people's, and two windows that can pan to different places are two windows
      // that can disagree about where a minute is. Not the tick at zero: with less
      // than an hour of day there is one name and it sits on the day's own start.
      ticks.push(el("div", {
        class: t === lastHour && t > 0 && trackW - x < LABEL_ROOM ? "tl-tick last" : "tl-tick",
        style: `left:${x}px`,
      },
        el("span", {}, clockAt(r.dayStartMin, t))));
    } else if (t % 30 === 0) {
      // The half hour: the dashed tick that has always been here, and still the
      // landmark a quarter-hour pass is judged against.
      ticks.push(el("div", { class: "tl-tick minor", style: `left:${x}px` }));
    } else {
      // Everything finer than the half hour, and it only ever appears at the two
      // closest stops. A thin solid hairline and not a dash: sixty dashes an hour
      // is noise on a ruler, and a dashed mark beside the half hour's dashes would
      // read as the same kind of landmark when it is not.
      ticks.push(el("div", { class: "tl-tick fine", style: `left:${x}px` }));
    }
  }
  return el("div", { class: "tl-row tl-ruler" },
    el("div", { class: "tl-name" }, el("div", { class: "tl-sub" }, "the clock")),
    el("div", { class: "tl-track", style: `width:${trackW}px` }, ...ticks));
}

// The bars of one module: one bar per BATCH, and a batch's cycles are drawn
// inside its own bar as shaded segments in the order she works them. Drawing
// them inside rather than as bars of their own is her own answer for how to
// show them, and it is what keeps a day of four batches of four cycles a
// phone-height chart instead of sixteen rows.
//
// A batch with a single cycle draws as one plain bar with no segments at all,
// which is her point three's last sentence: a single-cycle batch shows up as a
// batch. That is also every module she has today, drawn to the pixel as before.
//
// A module drawn as one row draws all of its batches and first-fits the lanes,
// because a module whose batches are free to overlap — her own ask — can put
// two of them in the same minutes, and drawn on one row they would paint over
// each other and read as one long batch. A module drawn as several LINES draws
// one line's batches here, and its first-fit is then over just those: normally
// one lane, and two only if something really has put two of one line's lots in
// the same minutes.
// Which batch each bar is, said above the bar: her ask of 22 Sep 2026, "I want
// the each batch to be labeled, B=?, small word above it ... at every module,
// every production line". So there is one for every bar of every module, drawn as
// a row-line as well as a single-row module.
//
// The nudge she has put on a batch rides beside the number — dt=+5 — which is the
// other half of the same ask. It is read off the STORED module rather than off the
// computed one, because chainLine consumes the delta into the times it hands back;
// what she typed lives on the module itself. See chainLine.
//
// A tag cannot live inside its bar — the bar is 16px tall and clips — so it is a
// sibling in the track, in the band the row grew for it. It carries the same
// `data-k` the bar does and the track's own click handler accepts either, so the
// number is a handle she can hit rather than a label she has to aim past.
function batchTags(r, m, live, line = null, board = false) {
  const { ks } = lineLanes(m, line);
  const trackW = r.windowMin * r.pxPerMin;
  const deltas = Array.isArray(live.startDelta) ? live.startDelta : [];
  const out = [];
  ks.forEach((k) => {
    const p = m.passes[k];
    if (p.at >= r.windowMin) return;
    // Kept on the chart at the very end of the day, so the last batch's number is
    // never half off the edge of the screen.
    const x = Math.max(0, Math.min(Math.round(p.at * r.pxPerMin), Math.max(0, trackW - 26)));
    const d = Math.max(0, Math.round(Number(deltas[k]) || 0));
    // Her own rule for what the tag does when it runs out of room, 23 September:
    // "if the scale is too wide to show batch no. and delta t then forgo delta t".
    // So the hold is printed only above the widest scale, and at the widest scale
    // the number wins — because the number is the thing that tells one batch from
    // another, and the hold is the thing that can be read elsewhere. The tint
    // stays either way: it takes no room, and it still answers "which of these
    // batches is held" at a glance. The tip keeps the hold in full at every scale.
    const showDelta = d > 0 && Number(r.pxPerMin) > DELTA_TAG_MIN_PX;
    // The tip on a board describes and never invites. "Tap to move it" is the
    // planner's own words and they are true there; a board's tap opens a read-only
    // card, so a tooltip promising a move would be advertising the one thing this
    // screen will not do.
    const said = d
      ? `Batch ${k + 1} of ${m.name}: held back ${d} min from where the line puts it`
      : (board ? `Batch ${k + 1} of ${m.name}` : `Batch ${k + 1} of ${m.name} — tap to move it`);
    out.push(el("div", {
      class: `tl-btag${d ? " nudged" : ""}`,
      "data-k": String(k),
      style: `left:${x}px`,
      title: said,
    }, `B${k + 1}${showDelta ? ` Δt=+${d}` : ""}`));
  });
  return out;
}

function passBars(m, tone, r, line = null) {
  const bars = [];
  const { ks, laneOf, lanes } = lineLanes(m, line);
  ks.forEach((k, i) => {
    const p = m.passes[k];
    if (p.at >= r.windowMin) return;
    const left = Math.round(p.at * r.pxPerMin);
    const right = Math.round(Math.min(p.end, r.windowMin) * r.pxPerMin);
    const w = Math.max(4, right - left);
    // The bar always carries its own top now, because every row has grown by the
    // batch-number band and the bar has to sit BELOW it. The single-lane top is the
    // one CSS gave it, pushed down by the band, so a row that does not overlap is
    // still the 16px bar it always was, in the same place relative to its own track.
    const top = TAG_BAND + (lanes > 1 ? LANE_TOP + laneOf[i] * LANE_PITCH : 9);
    const h = lanes > 1 ? LANE_H : null;
    bars.push(el("div", {
      class: `tl-bar ${tone}${m.follow ? " locked" : ""}${lanes > 1 ? " laned" : ""}`,
      // Which batch this bar is, so the +/- control knows which start it moves.
      "data-k": String(k),
      style: `left:${left}px;width:${w}px;top:${top}px` +
        (h == null ? "" : `;height:${h}px`),
      // What the bar holds, in her terms: how many minutes the dough is in it,
      // and how much of that is her hands.
      title: `${m.name}${line == null ? "" : `, line ${line + 1}`}, batch ${k + 1}: ${trim(m.cycleMin)} min` +
        (m.touchMin ? `, ${trim(m.touchMin)} min of you` : ", no hands"),
    },
      ...cycleMarks(m, p, r, w),
      // Only the first batch of a row carries the number, so a fold loop does
      // not repeat "28" four times across the day — and a laned bar is too short
      // to hold it, so the number is left to the row's own line instead.
      i === 0 && w >= LAB_MIN_PX && h == null ? el("span", { class: "tl-lab" }, String(Math.round(m.cycleMin))) : null));
  });
  return bars;
}

// What is inside one batch's bar: a shaded segment per cycle, and her hands
// drawn where she really works them — at a cycle's load, at its unload, or at
// both ends of it.
//
// Every position here is the model's own doing. The cycle offsets and the labour
// windows both come from the same arithmetic the day itself is built from, so
// the picture cannot drift from the plan by a minute: the fold sits at the end
// of its rest and the oven swap sits after its bake because the model says so,
// not because this function knows anything about folding or baking.
function cycleMarks(m, p, r, w) {
  const list = m.cycles || [];
  const px = (min) => Math.round(min * r.pxPerMin);
  const out = [];

  // One shade per cycle, so a batch of four reads as four cycles. A single-cycle
  // batch draws no segments — that bar IS its cycle.
  if (list.length > 1) {
    let off = 0;
    list.forEach((c, i) => {
      const from = px(off);
      const to = Math.min(w, px(off + c.min));
      if (to > from) {
        out.push(el("div", {
          class: `tl-cycle shade-${Math.min(i, CYCLE_SHADES - 1)}`,
          style: `left:${from}px;width:${to - from}px`,
          title: `${c.name || `Cycle ${i + 1}`}: ${trim(c.min)} min`,
        }));
      }
      off += c.min;
    });
  }

  for (const t of p.touches || []) {
    const from = Math.max(0, px(t.from - p.at));
    const trueW = Math.min(w, px(t.to - p.at)) - from;
    if (trueW <= 0) continue;
    // Drawn from its real minute and no wider than the bar leaves it, so the
    // picture still says WHEN; only the width is floored, and the bar's own
    // tooltip and the cycle's name still carry the true minutes.
    out.push(el("div", {
      class: "tl-touch",
      style: `left:${from}px;width:${Math.min(Math.max(MIN_TOUCH_PX, trueW), w - from)}px`,
      title: `${t.name ? `${t.name}: ` : ""}${trim(t.to - t.from)} min of you at ${clockAt(r.dayStartMin, t.from)}`,
    }));
  }
  return out;
}

// The cycles one row draws and the lanes they need: every cycle of the module for
// a module drawn as a single row, or one line's worth of them for a module worked as
// several lines. The lane assignment is a first-fit over that row's own cycles, in
// TIME order (not cycle order — she can have dragged cycle 4 before cycle 1), and
// two cycles that merely touch are not overlapping, so a pass ending exactly where
// the next one starts stays in the same lane and a row does not grow for a day
// that has not changed.
//
// Both the bars and the row's height come from here, so a row can never be drawn
// taller than the bars it holds — or hold bars nothing has made room for.
function lineLanes(m, line = null) {
  const ks = [];
  for (let k = 0; k < m.passes.length; k += 1) {
    if (line == null || m.passes[k].line === line) ks.push(k);
  }
  const passes = ks.map((k) => m.passes[k]);
  const order = passes.map((_, i) => i).sort((a, b) => (passes[a].at - passes[b].at) || (passes[a].end - passes[b].end));
  const laneOf = passes.map(() => 0);
  const ends = [];
  for (const i of order) {
    let lane = ends.findIndex((t) => t <= passes[i].at);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = passes[i].end;
    laneOf[i] = lane;
  }
  return { ks, laneOf, lanes: Math.max(1, ends.length) };
}

// Where each cycle of a module is, as a plain array of minutes — the module as the
// model has placed it, ready for one index to be overwritten by a drag. Reading
// it from the computed `starts` (rather than re-deriving it) is what keeps the
// cycles she has already dragged while she drags the next one.
function cycleStarts(m) {
  const out = [];
  for (let k = 0; k < m.repeats; k += 1) {
    const t = Number(m.starts && m.starts[k]);
    out.push(Number.isFinite(t) ? t : 0);
  }
  return out;
}

// The module a chained module is waiting on: the one above it in the list that is
// actually switched on. A machine that is off cannot pass dough down the line,
// which is exactly how chainLine skips it.
function chainAbove(r, m) {
  if (!m.follow) return null;
  const at = r.modules.findIndex((x) => x.id === m.id);
  for (let i = at - 1; i >= 0; i -= 1) if (r.modules[i].on) return r.modules[i];
  return null;
}

// What a module has to say about itself beyond its name: when its first batch
// starts and how many it runs, what it is waiting on, and what one batch costs it
// in minutes and in her hands.
//
// These two sentences used to sit under every module name, and they were what made
// the row tall: eight modules of notes is 400px of a phone screen spent repeating
// what the module's own card says. They are built in one place now, because two
// places print them — the row shows them on hover on a computer, and the card a
// tap opens shows them always — and two printings of one sentence is how a screen
// ends up disagreeing with itself.
function moduleNotes(r, m, live, line = null) {
  const above = chainAbove(r, m);
  const after = above ? startModeOf(live) === "after" : false;
  return {
    above,
    when: timeLine(m, r.dayStartMin) +
      (above ? (after ? ` · starts as ${above.name} finishes` : ` · waits on ${above.name}`) : ""),
    cost: costLine(m),
    tags: moduleTags(m, above, after, line),
  };
}

// The tags a row used to wear, in the order it wore them — every one of them now
// in the module's own tip, and on the module's own card, because a finger has no
// hover to open a tip with.
//
// Built here rather than in the row for the same reason the notes are: two places
// print them now, and two printings of one tag is how a screen ends up telling her
// two stories. The colours are the row's own — a limit being hit and a module
// running itself are both worth noticing, and they are not the same kind of thing.
function moduleTags(m, above, after, line = null) {
  const { lanes } = lineLanes(m, line);
  const tags = [];
  if (line == null && m.count > 1) tags.push({ text: `${m.count} of them`, cls: "badge-multi" });
  if (line != null && m.lines > 1) tags.push({ text: `${m.lines} lines`, cls: "badge-multi" });
  if (above) tags.push({ text: after ? "follows above" : "waits above", cls: "badge-past" });
  if (line == null && lanes > 1) tags.push({ text: `${lanes} at once`, cls: "badge-over" });
  if (!m.needsYou) tags.push({ text: "itself", cls: "badge-past" });
  // She has asked for more passes than a day holds. The number is kept as she
  // typed it — the row just counts honestly and says why.
  if (m.capped) tags.push({ text: "a day's limit", cls: "badge-over" });
  return tags;
}

// The tip a module's title opens on a computer, in the order the module's card
// says them: the tags it wears, when it starts and how many batches it runs, then
// what one batch costs it in minutes and in her hands. One builder, because the
// card prints the same three lines and a second printing is how the two drift.
function tipBody(notes) {
  return el("div", { class: "tl-tip" },
    notes.tags.length
      ? el("div", { class: "tl-sub tl-tag-line" }, notes.tags.map((t) => t.text).join(" · "))
      : null,
    el("div", { class: "tl-sub" }, notes.when),
    el("div", { class: "tl-sub" }, notes.cost));
}

// What one person's row has to say about itself beyond their name: how much of
// the day is theirs and how many places it puts them in, whether anything of
// theirs collides, and the jobs themselves.
//
// Built here, beside the module's own notes, for exactly the same reason: two
// places print them — the tip that opens under the pointer on a computer, and the
// person's card, which is what a tap opens — and a second printing is how the two
// end up telling her two stories. On a phone the tip never opens at all, so the
// card is not a copy of it; it is the only place these words can be read.
//
// The cap on the list is here and not at either printing: two caps for one list is
// the same drift in a different coat.
const PERSON_JOB_CAP = 6;
// And one cap for the jobs that do not fit their hours or their training, for the
// same reason: the card and the tip must not print a different number of them.
const PERSON_OUTSIDE_CAP = 3;

function personNotes(row, sc, state, dayStartMin) {
  const places = placesOn(row);
  const who = personLabel(row, sc, state);
  const all = (row.items || []).map((w) => `${clockAt(dayStartMin, w.from)} — ${jobName(w)}`);
  const jobs = all.slice(0, PERSON_JOB_CAP);
  const clashes = row.clashes.length;
  const shift = row.shift || null;
  // The jobs this person has been given that their own hours or their own training
  // say they should not have. Built here, once, because three places print them —
  // the tip, the row's own mark and the card — and a second builder is how the three
  // end up telling her three stories about the same day.
  const outside = (row.outside || []).map((w) => ({
    name: jobName(w),
    text: w.outsideHours === true
      ? `${who} is set to be here ${clockAt(dayStartMin, shift ? shift.startMin : 0)} → ${clockAt(dayStartMin, shift ? shift.endMin : 0)}, but ${jobName(w)} runs to ${clockAt(dayStartMin, w.to)} — a job that cannot fit inside those hours.`
      : `${who} is not trained for ${jobName(w)}, which runs ${clockAt(dayStartMin, w.from)} → ${clockAt(dayStartMin, w.to)} — they work it anyway, and it is said here rather than the job being quietly moved.`,
  }));
  // Which modules they are trained for, in the names she reads and not the ids the
  // store keeps. Ticked nothing is every day built before this existed: trained for
  // anything, and the line says so rather than reading as a blank.
  const ids = skillsOf(sc && sc.skills, row.person);
  const trained = ids.map((id) => {
    const m = ((sc && sc.modules) || []).find((x) => String(x.id) === id);
    return m ? `${m.icon || ""} ${m.name || id}`.trim() : id;
  });
  return {
    who,
    busy: row.busy,
    places,
    clashes,
    clash: clashes ? (clashes === 1 ? "two jobs at once" : `${clashes} collisions`) : null,
    jobs,
    more: all.length - jobs.length,
    shift,
    shiftLine: shift
      ? `Here ${clockAt(dayStartMin, shift.startMin)} → ${clockAt(dayStartMin, shift.endMin)}`
      : "Here all day",
    // There is no "Working …" line, and its absence is deliberate. It was worked out
    // from the day (v179) and printed beside "11 min of work" while claiming 93, so the
    // card answered one question twice with two different answers. Her word of
    // 24 September: the shade follows what she set and nothing else, and this line was
    // the same invention in words.
    outside: outside.slice(0, PERSON_OUTSIDE_CAP),
    outsideMore: Math.max(0, outside.length - PERSON_OUTSIDE_CAP),
    trained,
    trainedLine: trained.length
      ? `Trained for ${trained.length} module${trained.length === 1 ? "" : "s"}: ${trained.join(", ")}.`
      : null,
  };
}

// The tip a person's title opens on a computer: everything their row used to
// print, and everything their card prints, in the card's own order. Their row is
// one line and their height cannot move — a strip pinned to the foot of the panel
// that grew a line whenever two of their jobs collided was the last thing on the
// chart that moved while she scrolled it.
// A person's card is taller than the window it lives in, so part of it can never be
// read there. Measured at 1280x900 on her own day: the first person's card is 180
// pixels tall and the people's window is 69 — two thirds of it fell below the window's
// edge, and no amount of scrolling could show it, because a scroll of that window
// shows 69 of those 180 pixels at a time. She reported the short window herself and
// asked for two windows in its place; this is the part of that change that has to be
// paid for, and it is paid here rather than by making the window tall again.
//
// So the card leaves the window and is pinned to the screen, beside the name she is
// pointing at and level with that name's own row, clamped so it can never land off the
// screen. The words are untouched and the reason she asked for them is untouched — v158,
// "everything about a person goes into a tip on their own name". It is still a hover
// card, so on a phone, which has no hover, nothing about this is drawn at all.
function wirePersonTip(nameCell, tip) {
  if (typeof window === "undefined" || !nameCell.addEventListener) return;
  // The card's own size, which the clamping below needs. It is display:none until
  // something hovers it, and a hidden element measures as nothing — so where it measures
  // empty it is shown for the length of one read and handed straight back to the
  // stylesheet. Nothing is painted in between: the write and the read are one task.
  const size = () => {
    const box = tip.getBoundingClientRect();
    if (box.height) return box;
    const was = tip.style.display;
    tip.style.display = "block";
    const shown = tip.getBoundingClientRect();
    tip.style.display = was;
    return shown;
  };
  const place = () => {
    const name = nameCell.getBoundingClientRect();
    const box = size();
    const pad = 8;
    const vw = Number(window.innerWidth) || 0;
    const vh = Number(window.innerHeight) || 0;
    // Beside the name column and level with the row — where the card has always opened.
    // It moves only when leaving it there would put part of the card off the screen.
    let left = name.right + 6;
    let top = name.top;
    if (vw) left = Math.min(left, vw - pad - box.width);
    if (vh) top = Math.min(top, vh - pad - box.height);
    tip.style.left = `${Math.round(Math.max(pad, left))}px`;
    tip.style.top = `${Math.round(Math.max(pad, top))}px`;
  };
  // mouseenter places the card before the first paint of it. mousemove keeps it placed,
  // and is not the same job: the card is now pinned to the screen, so a page scrolled
  // under a pointer that has not moved would otherwise leave the card sitting beside a
  // row it no longer belongs to, until the pointer left the name and came back.
  nameCell.addEventListener("mouseenter", place);
  nameCell.addEventListener("mousemove", place);
}

function personTip(notes) {
  return el("div", { class: "tl-tip tl-tip-person" },
    el("div", { class: "tl-sub" }, `👤 ${notes.who}`),
    el("div", { class: "tl-sub" },
      `${hoursAndMinutes(notes.busy)} of work` + (notes.places > 1 ? ` · in ${notes.places} places` : "")),
    el("div", { class: "tl-sub" }, notes.shiftLine),
    notes.trainedLine ? el("div", { class: "tl-sub" }, notes.trainedLine) : null,
    notes.clash ? el("div", { class: "tl-sub bad" }, notes.clash) : null,
    ...notes.outside.map((o) => el("div", { class: "tl-sub bad" }, o.text)),
    notes.outsideMore > 0
      ? el("div", { class: "tl-sub bad" }, `…and ${notes.outsideMore} more like that.`)
      : null,
    el("div", { class: "tl-sub" },
      el("div", { class: "tl-note-who" }, "What they do today"),
      ...(notes.jobs.length
        ? notes.jobs.map((j) => el("div", { class: "tl-note-job" }, j))
        : [el("div", { class: "tl-note-job" }, "Nothing on this person yet.")]),
      notes.more > 0 ? el("div", { class: "tl-note-job" }, `…and ${notes.more} more.`) : null));
}

function moduleRow(r, m, idx, trackW, sc, on, state, run) {
  const tone = `tone-${idx % TONES}`;

  if (!m.on) {
    // A module that is switched off is still a thing on the day's own list, so a tap
    // on it on a board says what it is rather than doing nothing at all.
    return el("div", { class: "tl-row off", onclick: () => (run.board
      ? boardModuleCard(r, m, sc.modules.find((x) => x.id === m.id) || m, sc, state)
      : editModule(m, sc, on, false, r, state)) },
      el("div", { class: "tl-name" },
        el("div", { class: "tl-name-top" }, el("span", { class: "tl-name-txt" }, `${m.icon} ${m.name}`)),
        el("div", { class: "tl-sub" }, "not in this scenario")),
      el("div", { class: "tl-track", style: `width:${trackW}px` }));
  }

  // The raw module in the stored scenario, which is what a drag writes to.
  const live = sc.modules.find((x) => x.id === m.id) || m;

  // A module she has two of is worked as two LINES — the copies take the lots in
  // turn, odd lots on one and even on the other — so it is drawn as two rows, one
  // per line, each naming the person on it. That is her own ask, and it is also
  // the only drawing that can show two lines at all: the two lines' lots need not
  // overlap in time, so flattening them onto one row would draw a single stream
  // where there are really two.
  //
  // A module that is not worked as lines gets the single row it has always had, to
  // the pixel — which is every module she has today.
  const lines = m.lines || 0;
  if (!lines) return timelineRow(r, m, live, sc, on, tone, trackW, null, state, run);

  const block = el("div", { class: "tl-block" });
  for (let line = 0; line < lines; line += 1) {
    block.append(timelineRow(r, m, live, sc, on, tone, trackW, line, state, run));
  }
  return block;
}

// One row of a module: the whole module, or one of its lines. Its own name cell
// and its own track are here, so a module drawn as two lines is simply two of
// these and nothing else on the screen has to know.
function timelineRow(r, m, live, sc, on, tone, trackW, line, state, run) {
  // A row whose bars overlap needs a taller track to draw them in lanes. A row
  // whose bars do not gets the track it has always had, plus the band at the top
  // that carries the batch numbers — see BATCH_TAG_BAND.
  const { lanes } = lineLanes(m, line);
  const track = el("div", {
    class: "tl-track",
    style: `width:${trackW}px;height:${laneTrackH(lanes) + TAG_BAND}px`,
  });
  track.replaceChildren(...batchTags(r, m, live, line, run.board), ...passBars(m, tone, r, line));

  let whenLine = null;
  let name = null;

  // Built before the branch, because both branches wear the waiting badge — and
  // because the badge on a module drawn as lines used to be read from a name that
  // only existed on the other side of this if. A module with two production line
  // that also waits on the module above threw instead of drawing.
  const notes = moduleNotes(r, m, live, line);

  if (line == null) {
    // The module above is named the way THIS module is set to take its start from
    // it. "waits on" and "starts as … finishes" are two different promises — the
    // first is a floor, the second has no gap at all — so a row that used one
    // phrase for both would be telling her the wrong one on half her modules.
    //
    // The row is the name and its bars and nothing else. Its tags and its two
    // notes are in the tip that opens when she points at the title (.tl-tip), and
    // word for word on the card her tap opens — which is where her phone reads
    // them, because a finger has no hover to open a tip with.
    name = el("div", { class: "tl-name" },
      el("div", { class: "tl-name-top" },
        // Its own span, so a long name is shortened with an ellipsis at the column's
        // edge instead of wrapping the row taller than the bars it draws. The whole
        // name is on the card, one tap away.
        el("span", { class: "tl-name-txt" }, `${m.icon} ${m.name}`)),
      tipBody(notes));
  } else {
    // A line of a module: who is on it, how many lots it takes and the minutes it
    // really runs, read off the cycles the chain has already placed rather than
    // worked out again here.
    //
    // A line's own clock and the hands on it are the ONE thing a second line has to
    // say — nothing else on the screen says it — so they stay on the row. Its cost
    // line and its waiting are the module's own words twice over, so they go into
    // .tl-tip with the rest.
    const stats = lineStats(m, line);
    const who = lineWho(m, line, state) + (stats ? ` · ${stats.lots} ${stats.lots === 1 ? "lot" : "lots"}` : "");
    whenLine = el("div", { class: "tl-sub" }, stats
      ? `${clockAt(r.dayStartMin, stats.from)} → ${clockAt(r.dayStartMin, stats.to)}`
      // A line with nothing on it is the second machine she has bought and not
      // yet used — so it says so, rather than looking like a module that is simply
      // empty for no reason.
      : "nothing on this line yet — raise how many times it runs");
    name = el("div", { class: "tl-name" },
      line === 0
        ? el("div", { class: "tl-name-top" },
          el("span", { class: "tl-name-txt" }, `${m.icon} ${m.name}`))
        : null,
      el("div", { class: "tl-sub" }, who),
      whenLine,
      line === 0 ? tipBody(notes) : null);
  }

  // A module that is not drawn as lines gets the class list it has always had, to
  // the letter — everything CSS says about a plain module still applies to it.
  const row = el("div", {
    class: `tl-row${line == null ? "" : ` tl-line${line > 0 ? " tl-line-sub" : ""}`}`,
  }, name, track);

  // Two taps, two jobs, and which one she gets is decided by what is under the
  // finger: a BAR opens that batch's own clock, and anything else on the row —
  // the name, the empty track — opens the module's editor. That is her point
  // four, and it is why the drag is gone: a hairline was being chased across the
  // day by a bar as she dragged, and a fingertip sliding is the wrong tool for
  // deciding a minute anyway.
  // The bar AND its batch number open the same card: they are the same batch, and
  // a number she has just been handed as the way to tell one batch from another is
  // no use if it is not also a way to pick one.
  track.addEventListener("click", (e) => {
    // A right press pans the day and opens nothing. See isPrimaryClick.
    if (!isPrimaryClick(e)) return;
    const hit = e.target && e.target.closest ? e.target.closest(".tl-bar, .tl-btag") : null;
    if (!hit) return;
    e.stopPropagation();
    const k = Math.max(0, Math.round(Number(hit.dataset.k) || 0));
    // A board reads and a planner writes, and the two are the same tap: which card
    // opens is decided by what this screen is for, not by where the finger landed.
    if (run.board) return boardJobCard(r, m, live, sc, state, k);
    batchPopup(m, live, sc, on, k, run);
  });

  row.addEventListener("click", (e) => {
    if (!isPrimaryClick(e)) return;
    if (run.board) return boardModuleCard(r, m, live, sc, state);
    editModule(live, sc, on, false, r, state);
  });

  return row;
}

// Which module owns the end of the day's first batch — the one the whole day is
// hung from when she works it backwards.
//
// It is the last module in the build and NOT the first, and both halves of that
// matter. The first module's batch 1 has a meaning of its own (it is the module's
// own start time, and the first thing in the day), so it keeps it. A line of a
// single module is not a chain at all — there is nothing above the last thing to
// work back through — so it is left exactly as it was too. Null means "this tap is
// an ordinary batch tap", and every caller reads it that way.
function dayEndOf(r, sc) {
  const on = r.on || [];
  if (on.length < 2) return null;
  const last = on[on.length - 1];
  const at = (sc.modules || []).findIndex((x) => x.id === last.id);
  return at > 0 ? last : null;
}

// One batch's own clock, and the only place a batch's start time is set from the
// chart. A big pair of buttons at five minutes and a small pair at one, because
// five is the amount the day is read in and one is the nudge that lifts a batch
// off a collision — her own answer for the two amounts.
//
// Nothing here does arithmetic of its own. Every press goes through the same
// clampStart a typed time goes through and is then read back OFF the model, so a
// pressed time and a typed one are the same answer, and when the model's own rule
// puts the batch somewhere else she is told which rule it was — the same sentence
// the drag used to give.
function batchPopup(m, live, sc, on, k, hold) {
  const n = live.repeatsHeld || live.repeats || 1;
  // The last module in the build is not one batch among many: its first batch is
  // the moment the whole day hangs from, and its card is the day's own card. The
  // heading is set before the card is built so it can say which of the two this
  // tap opened — the two cards carry the same two button pairs, and a heading
  // that named only the module would leave her unable to tell them apart.
  const owner = dayEndOf(computeScenario(sc), sc);
  const isDay = !!owner && k === 0 && owner.id === live.id;
  showPopup(`${live.icon || m.icon} ${live.name} · ` + (isDay
    ? "the end of your first batch"
    : `batch ${k + 1} of ${n}`), (refresh, close) => {
    // Read afresh every time this card is built, because a press moves the day:
    // the times below have to be the ones the model has just answered with, not
    // the ones it answered with before the press.
    const r = computeScenario(sc);
    const here = r.modules.find((x) => x.id === live.id) || moduleFacts(live);
    const p = (here.passes || [])[k] || null;
    const at = p ? p.at : Number((cycleStarts(live))[k]) || 0;
    const end = p ? p.end : at + (here.cycleMin || 0);

    // The first module has nothing above it to hold a batch back FROM, so a move
    // there is its own start time — which is what every move has always been.
    // Every later module writes a delta instead, so the batch rides the chain:
    // move the module above and this batch follows, keeping its offset.
    const first = sc.modules.findIndex((x) => x.id === live.id) === 0;
    const mode = startModeOf(live);
    const deltas = Array.isArray(live.startDelta) ? live.startDelta : [];
    const delta = Math.max(0, Math.round(Number(deltas[k]) || 0));
    // With no hold on it, what is read out is what PLACES the batch, and for batch 1
    // that is the answer she gave the module — her own ask of 22 September, "just
    // need to show delta on the batch 1st offset only, then following module of that
    // step dont have to show the delta because it follow the previous module
    // tightly". Below batch 1 the batches run at this module's own pace, so there is
    // no module-level answer to read there; a batch that is held back on purpose
    // still says so, on its own card and on its own bar, because a batch that is off
    // the line must not look like one that is on it. Since v182 that hold is the
    // batch's own on batch 1 as on every other, so this reading is about where the
    // module starts and never about a press that moves the rest of it.
    const showsModuleOffset = !first && k === 0;

    const step = (by, label, hint) => {
      const press = (sign) => el("button", {
        type: "button",
        "aria-label": `${by} minute${by === 1 ? "" : "s"} ${sign > 0 ? "later" : "earlier"}`,
        onclick: () => moveBatch(r, live, sc, on, refresh, k, at, sign * by),
      }, sign > 0 ? `+ ${by} min` : `− ${by} min`);

      return el("div", { class: "field" },
        el("label", {}, label),
        el("div", { class: "step-pair" }, press(-1), press(1)),
        hint ? el("div", { class: "hint" }, hint) : null);
    };

    // A nudge can only ever hold a batch BACK, so below the first module the
    // buttons can go one way and no further. That is right — it is a delay and not
    // a schedule — but it would also be a one-way door, and a door with no handle is
    // the fault v149 was built to fix. So the way back is here, named, and only when
    // there is something to undo, and it takes off the hold the press beside it put
    // on: one batch's, on the batch it is standing on, for the reason in moveBatch.
    //
    // It carries no sentence of its own, for the same reason the pairs lost theirs:
    // the line above the button already reads out the hold it takes off, and the
    // toast names the minute it lands on. A second paragraph saying the same thing
    // is length, not information.
    const back = (delta && !first)
      ? el("div", { class: "field" },
        button("Back onto the line", () => {
          const next = deltas.slice();
          next[k] = 0;
          live.startDelta = next;
          on.persist();
          on.refresh();
          refresh();
          // Where it lands is named against the rule that actually put it there:
          // this batch rides the module above and this module's own pace, so the
          // sentence it has always had stands.
          toast(`Batch ${k + 1} back at ${clockAt(r.dayStartMin, at - delta)} — exactly where the line puts it.`);
        }, "ghost"))
      : null;

    // "the batch pop up, make it as brief as possible" — her words of 23 September.
    // So the card says the four readings and offers the three presses, and nothing
    // else. What left with her ask: the paragraph that used to sit under each pair
    // explaining what a move means in this module's own terms, and the second line
    // that repeated the two times the line above it already reads out.
    //
    // The hints were true and they stay true; they are simply not what she needs in
    // front of her to move a batch five minutes. What the pair does in this module's
    // terms is still on the press itself, as its accessible name, and every press
    // still answers in words when it lands — including when the module above or the
    // module's own minutes moved the batch somewhere other than where she aimed.
    const readings = el("div", {},
      // One line for the four facts, in the order she reads them: which batch, how
      // it sits against the line, the two times, and what it costs her hands.
      el("div", { class: "cyc-line", style: "margin:0 0 10px" },
        el("span", { class: "cyc-lab" }, `Batch ${k + 1}`),
        el("span", { class: `cyc-at${delta ? " nudged" : ""}` },
          delta ? `Δt = +${delta} min`
            : first ? "its own start"
              : showsModuleOffset ? START_MODE_READINGS[mode] : "on the line"),
        el("span", { class: "cyc-at" },
          `${clockAt(r.dayStartMin, at)} → ${clockAt(r.dayStartMin, end)}`),
        el("span", { class: "cyc-at" },
          `${trim(here.cycleMin)} min · ${trim(here.touchMin)} by hand`)),

      // The two pairs, on EVERY batch now. They used to be refused on a module set
      // to wait, with a sentence telling her to go and change the module instead —
      // and "each batch start time adjustable, like the 1st module" is the thing
      // she asked for. What keeps that honest is the model underneath: every press
      // goes through the same clamp a typed time goes through, the answer is read
      // back off the model, and when the module above or the module's own minutes
      // put the batch somewhere else the toast names which rule did it.
      el("div", {},
        step(5, "Five minutes"),
        step(1, "One minute"),
        back),
    );

    // The last module's first batch is where the whole day is hung from, so its card
    // carries two cards' worth: the batch's own four readings and its own pair,
    // exactly as every other bar on the chart has them, and the day's backward reading
    // below it.
    //
    // Which is her report of 23 September, on tapping that bar: "the last module batch
    // pop up, still dont mark his delta?" She is right, and it was the one bar on her
    // chart whose card said nothing about the batch it belongs to and could take no
    // hold at all, because dayEndOf routed the tap straight past the batch card and
    // the readings and the pair were never built. Nothing about the day card was wrong
    // — it is the card behind her own "how to make the calculate backward works?", and
    // every word of it stands — but a bar that opens a different card from every other
    // bar asking the same question is two taps that look alike behaving unlike, which
    // is the fault the dead-control rule names.
    //
    // And the two belong on one card rather than behind another press, because they
    // are two halves of one thought: holding this batch later hands every module above
    // it exactly those minutes as slack, and the list below is where that slack is read
    // and taken. Hold the finish later, then work the day back into the room it made.
    return isDay
      ? el("div", {}, readings, dayBackCard(r, live, sc, on, refresh, hold, end))
      : readings;
  });
}

// The end of the first batch at the last module of the build, and the day that
// hangs from it — the card behind her question, "how to make the calculate
// backward works?".
//
// Every other card on this screen reads the day FORWARDS, and so does the model
// under it: chainLine walks the modules in order and can only ever push one
// later. This is the other direction, in the words she settled it in on 22
// September: "work backwards, from end of process, the previous process should
// have a latest start time, by going this way, we prevent preparing dough too
// early". The Production line's own day-backwards card is the same idea on the
// same day; this is it for her planner.
//
// So the card does three things and nothing else. It says what the backward
// calculation says — every switched-on module, where it starts today and the
// latest it may start — it gives her one button to take that slack out, and the
// two step pairs she already knows from moving a batch, doing the other thing a
// time on this chart can do: moving the whole day by the same amount everywhere,
// so the shape of the day she arranged is kept and only the clock on it moves.
// She sees the answer before she presses anything, which is the whole rule of
// this app: a guide, never a gate.
//
// It is the last module in the build and not the first, deliberately. The first
// module's batch 1 IS its own start time and the first thing in the day, so it
// keeps that meaning; the END of the first batch at the last module is the
// moment her whole day is hung from, whatever that last thing happens to be.
function dayBackCard(r, live, sc, on, refresh, hold, anchor) {
  const latest = latestStarts(r.on);
  const dayEnd = r.on.reduce((t, f) => Math.max(t, f.endMin), 0);
  const rows = [];
  let loose = 0;

  for (const f of r.on) {
    const want = latest.get(f.id);
    if (want == null) continue;
    const at = Number(f.startMin) || 0;
    // A module that waits on the one above it has no start of its own to move:
    // the line places it, and it comes along with the press anyway.
    const held = !!f.follow;
    const canMove = !held && Math.round(want) > Math.round(at);
    if (canMove) loose += 1;
    rows.push(el("div", { class: "cyc-row" },
      el("span", { class: "cyc-lab" }, `${f.icon} ${f.name}`),
      el("span", { class: "cyc-at" }, held
        ? `${clockAt(r.dayStartMin, at)} · the line places it`
        : (canMove
          ? `${clockAt(r.dayStartMin, at)} → ${clockAt(r.dayStartMin, want)}`
          : `${clockAt(r.dayStartMin, at)} ✓`))));
  }

  // The same two pairs she already knows from moving a batch, doing the one other
  // thing a time on this chart can do: moving the whole day. Five first, because
  // five is the amount the day is read in.
  //
  // The label names the scope outright and no longer says "at a time", because since
  // v180 this card carries a second pair of the same two presses, an inch above it,
  // moving this batch on its own. Two pairs whose buttons both read "+ 5 min" is the
  // ambiguity the dead-control rule is about, so the scope is on the label where a
  // person looks before the hint where they read.
  const step = (by) => el("div", { class: "field" },
    el("label", {}, by === 5 ? "Five minutes, the whole day" : "One minute, the whole day"),
    el("div", { class: "step-pair" },
      el("button", {
        type: "button",
        "aria-label": `the whole day ${by} minute${by === 1 ? "" : "s"} earlier`,
        onclick: () => shiftDay(r, sc, on, refresh, hold, -by),
      }, `− ${by} min`),
      el("button", {
        type: "button",
        "aria-label": `the whole day ${by} minute${by === 1 ? "" : "s"} later`,
        onclick: () => shiftDay(r, sc, on, refresh, hold, by),
      }, `+ ${by} min`)),
    el("div", { class: "hint" },
      "This moves the WHOLE day, every module of it by the same amount, so the " +
      "shape of your day is kept exactly as it is and only the clock on it moves. " +
      "To move this batch on its own instead, use the pair at the top of this card."));

  return el("div", {},
    el("div", { class: "cyc-line", style: "margin:0 0 4px" },
      el("span", { class: "cyc-lab" }, `${live.icon || "•"} ${live.name} · batch 1 ends`),
      el("span", { class: "cyc-at" }, clockAt(r.dayStartMin, anchor))),
    el("div", { class: "cyc-line", style: "margin:0 0 10px" },
      el("span", { class: "cyc-lab" }, "Your day finishes"),
      el("span", { class: "cyc-at" }, clockAt(r.dayStartMin, dayEnd))),

    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `${live.name} is the last thing your line does for your first batch, so this ` +
      "is the moment the whole day hangs from. Working back through the modules " +
      "above it gives each one a latest start — the last minute it may begin and " +
      "still have this batch come out of your last module on time, which is how " +
      "the dough is kept from being mixed earlier than it has to be."),

    el("div", { class: "cyc-list", style: "margin:0 0 8px" }, ...rows),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "A tick means that module is already as late as the line allows: mix the dough " +
      "any later and your first batch comes out of this module after the moment above."),

    loose
      ? el("div", { class: "field" },
        button("Pull them back to their latest start",
          () => moveDayBack(r, sc, on, refresh, hold), "primary"),
        el("div", { class: "hint" },
          `This moves the ${loose} module${loose === 1 ? "" : "s"} that can still ` +
          "come later, and leaves every other one exactly where it is. It writes " +
          "those start times into your scenario, so it is a real change to the day — " +
          "the button below puts it back. A tighter day can also put two of your " +
          "jobs in the same minute; if it does, the People area below says so."))
      : el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Every module of your line is already as late as it can go — there is " +
        "nothing to pull back. The buttons below move the whole day instead."),

    step(5),
    step(1),

    // The way back. The day she had before her first press is kept once, in this
    // screen's own memory, so working the day backwards is a calculation she can
    // try rather than a door that closes behind her.
    hold.dayBefore
      ? el("div", { class: "field" },
        button("Put my start times back", () => undoDayBack(r, sc, on, refresh, hold), "ghost"),
        el("div", { class: "hint" },
          "Every module's start time, exactly as it was before your first press " +
          "on this card. It lasts while you are on this screen — nothing about it " +
          "is saved, the same way the running clock is not."))
      : null,
  );
}

// The day she had, kept before the first press of either pair of buttons on this
// card and never overwritten by a later one, so the way back is the day she
// began with rather than the step before the last one. Only modules that are
// switched on are kept, because only those are the ones a press writes.
function takeDayBefore(r, sc, hold) {
  if (hold.dayBefore) return;
  const ids = new Set(r.on.map((f) => f.id));
  hold.dayBefore = sc.modules
    .filter((m) => ids.has(m.id))
    .map((m) => ({ id: m.id, starts: m.starts, startMin: m.startMin }));
}

// One press of the card's own button: every module pulled back to its latest
// start, as the chain measures it from the end of her first batch.
//
// Only a module's FIRST batch is written, and through the same writer a typed
// time and the batch buttons already use. That is what keeps everything else of
// hers intact: startsOf re-bases a stored list onto the new first time and
// continues at the module's own pace, so Auto spacing, her un-even spacing, her
// per-batch deltas and her cycles all come through the press untouched.
//
// The day's own forward pass still has the last word. This can only see the
// chain — her hands are not something a measurement can see — so anything the
// line pushes later than its latest start stays later, and the reading back at
// the end says what actually happened rather than what was asked for.
function moveDayBack(r, sc, on, refresh, hold) {
  const latest = latestStarts(r.on);
  if (!latest.size) return;
  const wasAt = new Map(r.on.map((f) => [f.id, Number(f.startMin) || 0]));
  takeDayBefore(r, sc, hold);

  for (const m of sc.modules) {
    const want = latest.get(m.id);
    if (want == null) continue;
    writeBatchStart(m, 0, want);
  }
  on.persist();
  on.refresh();
  refresh();

  // What the day did with it, read back off the model rather than assumed — the
  // same rule every other press here follows.
  const after = computeScenario(sc);
  const moved = [];
  for (const f of after.on) {
    const was = Number(wasAt.get(f.id));
    if (Number.isFinite(was) && Math.round(was) !== Math.round(f.startMin)) {
      moved.push({ name: f.name, was });
    }
  }
  const owner = dayEndOf(after, sc);
  const anchor = owner && (owner.passes || [])[0] ? owner.passes[0].end : null;
  const end = after.on.reduce((t, f) => Math.max(t, f.endMin), 0);
  const plural = moved.length === 1 ? "" : "s";
  toast(moved.length
    ? `${moved.length} module${plural} worked back to their latest start — your first batch still ends ` +
      `${clockAt(after.dayStartMin, anchor == null ? end : anchor)}` +
      (Math.round(end) === Math.round(anchor == null ? end : anchor)
        ? ", and that is where the day ends too."
        : ` and the day finishes at ${clockAt(after.dayStartMin, end)}.`) +
      peopleNote(r, after)
    : "Every module of your line is already as late as it can go — there is nothing left to pull back.");
}

// The same press, made from the day's own controls row.
//
// It IS the card's press and nothing else — one writer, one wording, one snapshot
// and one way back — so a press from the row and a press from the card are the
// same day, and neither can drift from the other.
//
// The one thing it answers for itself is a line with no module above its last one.
// There the card does not exist and never has, because dayEndOf has nothing to
// give it, so a press that drew nothing would look broken. It says which of the
// two it is instead of inventing a move: a single module's first batch is that
// module's own start time, and there is no chain above it to measure a latest
// start against.
function workDayBack(r, sc, on, refresh, hold) {
  if (!dayEndOf(r, sc)) {
    toast("This line has no module above its last one, so there is no chain to " +
      "work back along: the first batch of your only module is simply that " +
      "module's own start time. Add a module below it and every one above gets " +
      "its latest start.");
    return;
  }
  moveDayBack(r, sc, on, refresh, hold);
}

// What the pressing cost her hands, when it cost her any.
//
// A backwards pass is only ever asked about the CHAIN — the modules' own minutes.
// Squeezing the day to the shortest span the chain allows is exactly what puts two
// of her jobs in the same minute, so the honest thing is to say the price at the
// moment it is paid rather than to leave her to find a red outline further down the
// screen. The People area shows the collision itself; this is the one-line warning.
function peopleNote(before, after) {
  if (!before || !after || after.people <= before.people) return "";
  return ` The day is now as tight as the chain allows, and at that length your jobs ` +
    `overlap: it reads ${after.people} people where it read ${before.people}.`;
}

// The whole day moved, every module of it by the same amount.
//
// This is the other thing a time on this chart can do and it is deliberately the
// simpler of the two: a uniform move keeps the shape of her day exactly as she
// arranged it, so it is the move for "the same day, an hour later" rather than a
// re-lay. The pull-back above is the one that re-lays.
//
// Spacing survives it for the same reason it survives the pull-back — only each
// module's first batch is written, and its own pace carries the rest. A day whose
// first module is already at midnight cannot move earlier at all, and that is said
// rather than pressed into nothing.
function shiftDay(r, sc, on, refresh, hold, by) {
  const list = r.on.map((f) => ({ f, at: Number(f.startMin) || 0 }));
  if (!list.length) return;
  const lowest = list.reduce((t, x) => Math.min(t, x.at), Infinity);
  const step = by < 0 ? -Math.min(Math.abs(by), Math.round(lowest)) : by;
  if (step === 0) {
    toast("Your first module already starts at midnight, so the whole day cannot move any earlier.");
    return;
  }
  takeDayBefore(r, sc, hold);
  for (const { f, at } of list) {
    const live = sc.modules.find((m) => m.id === f.id);
    if (live) writeBatchStart(live, 0, at + step);
  }
  on.persist();
  on.refresh();
  refresh();

  const after = computeScenario(sc);
  const end = after.on.reduce((t, f) => Math.max(t, f.endMin), 0);
  const firstStart = after.on.reduce((t, f) => Math.min(t, Number(f.startMin) || 0), Infinity);
  const amount = `${Math.abs(step)} minute${Math.abs(step) === 1 ? "" : "s"}`;
  const where = after.on.reduce((best, f) => ((Number(f.startMin) || 0) < (Number(best.startMin) || 0) ? f : best), after.on[0]);
  toast(`The whole day moved ${amount} ${step > 0 ? "later" : "earlier"} — it now starts with ` +
    `${where.name} at ${clockAt(after.dayStartMin, firstStart)} and finishes at ` +
    `${clockAt(after.dayStartMin, end)}.${peopleNote(r, after)}`);
}

// The other half of that press: the day she had, put back exactly as it was, and
// the snapshot cleared so the button goes with it. Restoring the stored `starts`
// rather than re-deriving a time is deliberate — a module whose spacing was Auto
// before the press must have no stored list at all afterwards either, or it
// would come back as an even spacing she never asked for.
function undoDayBack(r, sc, on, refresh, hold) {
  for (const keep of hold.dayBefore || []) {
    const live = sc.modules.find((m) => m.id === keep.id);
    if (!live) continue;
    if (keep.starts == null) delete live.starts;
    else live.starts = keep.starts;
    live.startMin = keep.startMin;
  }
  hold.dayBefore = null;
  on.persist();
  on.refresh();
  refresh();
  toast("Your start times are back exactly where they were.");
}

// One press of those buttons. On the first module the move IS the start time, and
// the arithmetic is setBatchStart's. On any module after it the move is a DELTA
// from where the chain puts the batch — a HOLD — and that is true of every batch
// of every later module, batch 1 included, whatever that module is set to take
// her start from.
//
// The one exception this rule ever had is gone. It was narrowed at v154 to "below
// batch 1, or batch 1 of a module set to start as the one above finishes", on the
// argument that a module keeping its own time has a start of its own to write. Her
// report of 23 September is what that narrowing cost: "i ask for delta time, that
// function is not worker across the chart ... Before this the delta t was there,
// why it disappeared." Every module of her own day is set to "Its own time", so
// batch 1 of every one of her modules took the absolute path — no hold was ever
// written, so no Δt was ever drawn anywhere on her chart, and the card's own way
// back, which only exists while a hold does, went with it. The v151 rule is put
// back, one line, and the two readings it restores come back with it.
//
// One press moves ONE batch, and only the one it was pressed on. Her rule of 24
// September: "delta t on one batch of the module dont change the module batches, it
// should not be." Batch 1 used to be the exception — its press read as the module's
// own offset and carried the rest of the module with it — and that is retired here;
// see the measurement in moveBatch, and the module's own start time for the one
// press that moves a module whole.
//
// A hold is still only ever a HOLD and never a schedule: it is added after the
// latest of the module's own time, the chain above and the module's own machine,
// so it can push a batch later and can never put one in front of the dough it is
// made of.
//
// What gets said about it is toastBatch's in the first case, so the timeline's tap
// and the editor's old buttons stay one answer in one wording. A delta is a
// different fact and says so in its own words.
function moveBatch(run, live, sc, on, refresh, k, from, by) {
  const first = sc.modules.findIndex((x) => x.id === live.id) === 0;
  const held = !first;
  if (!held) {
    const landed = setBatchStart(live, sc, on, k, from + by);
    toastBatch(live, k, from + by, landed, run.dayStartMin);
  } else {
    const deltas = (Array.isArray(live.startDelta) ? live.startDelta : []).slice();
    while (deltas.length < Math.max(1, moduleOf(live).repeats)) deltas.push(0);
    const before = Math.max(0, Math.round(Number(deltas[k]) || 0));
    const after = Math.max(0, before + by);
    // A press moves the batch it was pressed on, and nothing else. Her report of
    // 24 September: "delta t on one batch of the module dont change the module
    // batches, it should not be." Until now batch 1 was the exception: its press
    // read as the module's own offset and carried every other batch of the module
    // with it, so a hold of 5 minutes on batch 1 moved twelve folds on a module she
    // had only touched once. Measured on her own day at a 4:00 am start, holding
    // batch 1 of The oven swap and the bake by five minutes read [240, 327, 414,
    // 501] before and [245, 332, 419, 506] after — all four batches moved. Holding
    // batch 3 by the same five minutes moved batch 3 alone, which is the answer she
    // is asking for everywhere: [240, 327, 419, 501].
    //
    // Moving a whole module is still one press away, and it is the honest one: the
    // module's own start time on the module card, which every other batch is then
    // spaced from by the module's own pace.
    deltas[k] = after;
    live.startDelta = deltas;
    on.persist();
    on.refresh();
    if (after === before) {
      toast(by < 0
        ? `Batch ${k + 1} is already on the line — there is nothing left to take off.`
        : `Batch ${k + 1} stays where it is.`);
    } else if (after === 0) {
      // The hold taken all the way off is a real change and says so: "held 0
      // minutes behind" is not a sentence about a hold coming off, it is a
      // sentence about nothing happening.
      toast(`Batch ${k + 1} is back on the line, where the module above and this module's own minutes put it.`);
    } else {
      toast(`Batch ${k + 1} held back ${after} minute${after === 1 ? "" : "s"} from where the line puts it — move the module above it and this batch comes with it.`);
    }
  }
  // And the card itself, so the clock at the top of it reads the time the batch
  // is at now rather than the one it was at when she opened it.
  refresh();
}

// One line of a module: the lots on it and the minutes they take, read off the
// cycles the chain has already placed. Null when the line has nothing on it yet.
function lineStats(m, line) {
  let from = Infinity;
  let to = -Infinity;
  let lots = 0;
  for (const p of m.passes) {
    if (p.line !== line) continue;
    from = Math.min(from, p.at);
    to = Math.max(to, p.end);
    lots += 1;
  }
  return lots ? { from, to, lots } : null;
}

// Who is on a line: the person she named, or whoever is free — the same two
// answers the rest of the screen gives, in the same words.
function lineWho(m, line, state) {
  const p = m.crew ? m.crew[line] : 0;
  return p > 0 ? `👤 ${personName(p, namesOf(state))}` : "👤 whoever is free";
}

// The names she has typed, one table for the whole app so a person keeps their
// name from one scenario to the next. Read through here rather than touched at
// each call site, so there is one answer to "who is person 3" on every screen.
function namesOf(state) {
  return (state && state.settings && state.settings.personNames) || {};
}

// Where a cycle she has just dropped actually ends up, straight from the model —
// so the screen can tell her when her own module's rule moved it, and where to.
// Asking the model rather than re-deriving the rule here is the point: a second
// copy of the arithmetic in the view is a second answer waiting to disagree.
function cycleLanded(sc, m, k, dropped) {
  const placed = chainLine(sc.modules).find((x) => x.id === m.id);
  const at = placed && placed.starts ? Number(placed.starts[k]) : NaN;
  return Number.isFinite(at) ? Math.max(at, dropped) : dropped;
}

// One batch's start can move within the day, but a batch still has to finish
// inside one — dough still in the oven at midnight is a typing mistake, not a
// plan. Every batch is `cycleMin` long, so the same ceiling holds for each. The
// arithmetic itself lives in the model (clampBatchStart) because the typed box and
// the +/- buttons must give the same answer, and the model's test is where that is
// checked.
function clampStart(start, m) {
  return clampBatchStart(start, m);
}

function timeLine(m, dayStartMin) {
  const runs = m.repeatsHeld > 1 ? ` · ${m.repeatsHeld} batches` : "";
  return `starts ${clockAt(dayStartMin, m.startMin)}${runs}`;
}

// The two numbers she reads off a module at a glance: how long one batch holds
// it, and how much of a person that batch costs. For her fold that is 31 and 1,
// because the fold now sits where she really does it: at the end of the rest.
function costLine(m) {
  if (!m.needsYou) return `${trim(m.cycleMin)} min a batch · no hands`;
  return `${trim(m.cycleMin)} min a batch · ${trim(m.touchMin)} min of you`;
}

function personRow(r, row, trackW, sc, on, state, run) {
  const who = row.person;
  const tone = personTone(who);
  // How wide a stretch has to be before it can hold a name. Measured in minutes at
  // the scale she is reading at, so the name appears at Close and Closest — where
  // she is studying one person — and not on a Wide day where every stretch is a
  // sliver.
  const nameFits = 46 / (r.pxPerMin || 1);

  // How many different places this person has to be in — a line of a module counts
  // as a place of its own, which is the rule the model owns (placesOn), so it is
  // tested there rather than here. The whole of what the row used to print is in
  // the notes now, built in one place with the card's.
  const notes = personNotes(row, sc, state, r.dayStartMin);

  // The hours they are here, as a wash on their own row. Drawn FIRST in the track and
  // with no z-index of its own, so every bar and every mark the DAY draws lands on top
  // of it — the band is the ground the day stands on, never a thing covering it. A
  // positioned element carrying a z-index creates a stacking context, which is exactly
  // how the v174 fault came back, so this one deliberately has none.
  //
  // Its geometry is the bars' own arithmetic one line below: both are offsets from the
  // start of the day, so nothing here has to know what time that was.
  const band = row.shift ? el("div", {
    class: "tl-shift",
    style: `left:${Math.round(row.shift.startMin * r.pxPerMin)}px;`
      + `width:${Math.max(1, Math.round((row.shift.endMin - row.shift.startMin) * r.pxPerMin))}px`,
    title: notes.shiftLine,
  }) : null;

  // There is no second, computed shape on this row. v179 drew one across the person's
  // work — first job to last, gaps included — and her word of 24 September retires it:
  // "shade should just follow what i set, not other consideration". The band above is
  // the only thing shaded on a person's row, and where she has typed no hours there is
  // no shade at all. See the model (scenario.js, peopleRows) for the measurement that
  // settled it.
  const bars = row.items.map((w) => el("div", {
    // The PERSON'S own colour, not the module's. Tinted by module, one person's row
    // was a patchwork of eight colours that said nothing about the person standing
    // there; tinted by person, a row is one worker's day and two rows are two
    // people. A collision still wears its red outline over the top.
    class: `tl-bar ${tone}${isClash(row, w) ? " clash" : ""}`,
    style: `left:${Math.round(w.from * r.pxPerMin)}px;width:${Math.max(4, Math.round((w.to - w.from) * r.pxPerMin))}px`,
    // Which line of which module this stretch of the person's day is, so a doubled
    // module reads as that person being on line 2 rather than on "the fold".
    title: `${w.name}${w.line >= 0 ? `, line ${w.line + 1}` : ""}: ${clockAt(r.dayStartMin, w.from)} → ${clockAt(r.dayStartMin, w.to)}`,
  }, w.to - w.from >= nameFits ? el("span", { class: "tl-pname" }, personName(who, namesOf(state))) : null));

  // The row is tappable, and that is the fix for what she reported: "in the person
  // card, now person card is not accessible". There was no handler here at all, so
  // the card that names her people could not be opened by any gesture.
  //
  // The name cell is the person and their tip and nothing else — the same two
  // things a module's name cell holds — so a person's row is the height of its own
  // bars and stays that height on a day where two of their jobs collide. The label
  // is in a span of its own for the same reason a module's is: a bare string in a
  // flex row is an anonymous flex item that no rule can reach, so without the span
  // the ellipsis never applies and a long "(with …)" label wraps the row taller
  // than the bars it is read against.
  // Two gestures on this row, and which one she gets is decided by where the
  // finger lands on the track — the same pair the module rows have had since v154.
  // A tap on a stretch of their day hands that job to somebody else; a tap
  // anywhere else on the row still opens the person's own card, which is what
  // every tap on this row did before. Her ask, 23 September: "can the personX
  // marker be click to change it job to personY, by a drop down person selector",
  // and then, asked which gesture she meant, "click on the person's occupied time
  // slot, a drop down list, list the other people available".
  //
  // The stretch is found by the MINUTE under the finger rather than by
  // closest(".tl-bar"), which is what the module rows do. A person's bar carries no
  // dataset at all, so a bar could not say which module it belongs to — and the
  // target is small twice over: the bar is 11 pixels in a 34-pixel row, and at the
  // widest reading a one-minute job is 1.2 pixels wide. Reading the minute gives
  // her the row's whole height, and nearestSlot gives her the sliver.
  const track = el("div", { class: "tl-track", style: `width:${trackW}px` }, band, ...bars);
  track.addEventListener("click", (e) => {
    // A right press pans the day and opens nothing. See isPrimaryClick.
    if (!isPrimaryClick(e)) return;
    // An activation that never had a pointer — a test's synthetic event, or a
    // keyboard's. There is no coordinate to read, so there is nothing to decide:
    // leave the event alone and let the row open the person's card.
    if (typeof e.clientX !== "number") return;
    const min = minuteAtPx(e.clientX - track.getBoundingClientRect().left, r.pxPerMin, r.windowMin);
    if (min == null) return;
    const hit = row.items.find((w) => min >= w.from && min < w.to)
      || nearestSlot(row.items, min, r.pxPerMin);
    // Nothing within reach: say nothing, and let the tap through to the row.
    if (!hit) return;
    e.stopPropagation();
    // This row is the PLANNER's, and on a board it is not built at all: a board's rows are
    // trains, and a tap on one of their coaches is the worker's own "I'm on it" (see
    // trainRow). The read-out card a board used to open here was retired with it, and the
    // board's person card is reached by the name column, as it always was.
    slotPopup(r, row, hit, sc, on, state);
  });
  const tip = personTip(notes);
  const nameCell = el("div", { class: "tl-name" },
    el("div", { class: "tl-name-top" },
      el("span", { class: "tl-name-txt" }, `👤 ${notes.who}`)),
    tip);
  wirePersonTip(nameCell, tip);
  return el("div", {
    class: `tl-row person tappable ${tone}`,
    // A right press pans the day and opens nothing. See isPrimaryClick.
    onclick: (e) => {
      if (!isPrimaryClick(e)) return;
      // The person's own card — the same words in both places, from the same
      // builder; a board's just has no switches on it, because who is called and who
      // is on what are hers to decide and not the worker's.
      if (run.board) return boardPersonCard(row, sc, state, r);
      personPopup(row, sc, on, state, r);
    },
  },
    nameCell,
    track);
}

// The stretch of a person's day nearest the minute she tapped, if that minute is
// within reach of it — measured in PIXELS and not in minutes, so the reach is the
// same distance under her finger at every scale. Six pixels either side is a
// fingertip; two minutes at the closest reading is the same six.
function nearestSlot(items, min, pxPerMin) {
  const scale = Number(pxPerMin) > 0 ? Number(pxPerMin) : 1;
  const reach = Math.max(2, 6 / scale);
  let best = null;
  let bestGap = Infinity;
  for (const w of items) {
    // Zero inside the stretch, and how far outside it otherwise — the half-open
    // rule the bars are drawn by, so a minute a job ends on is the next job's.
    const gap = Math.max(w.from - min, min - w.to + 1, 0);
    if (gap <= reach && gap < bestGap) { best = w; bestGap = gap; }
  }
  return best;
}

// The card a tap on a stretch of somebody's day opens: hand THAT STRETCH to another
// of the people on the chart.
//
// One stretch and not the module, not the batch and not the day. Her own correction
// of 23 September, after v160 shipped the move at module level: "The reassign job to
// next person is not whole day, it is that slot only", and then, asked what one tap
// should take with it, "we dont change the batch. Say a labour slot belongs to
// person1, clicking that slot, will offer to swap it to others, this basically to
// balance work load". So the thing that changes hands is the marker under her finger
// and nothing else — a fold loop that folds three times in a batch draws three
// markers, and the other two stay where they are.
//
// What is offered is the other people who have a row on this chart, plus "whoever is
// free". A person with no row is not standing anywhere on the day, so listing them
// would be offering an answer the day cannot give — but 0 is not a person, it is the
// day's own arrangement, and it is both the way back to automatic for a module nobody
// was put on and a legitimate answer on its own. Without it a stretch handed to a
// named person on such a module could never be handed back.
function slotPopup(r, row, w, sc, on, state) {
  const who = row.person;
  const others = r.rows.map((x) => x.person).filter((p) => p > 0 && p !== who).sort((a, b) => a - b);
  if (!others.length) {
    toast("Nobody else is on this day yet — give a module to a second person, and their row can take this job");
    return;
  }

  const job = `${jobName(w)}: ${clockAt(r.dayStartMin, w.from)} → ${clockAt(r.dayStartMin, w.to)}`;
  // How many other stretches of THIS batch are on the row she tapped. Not how many
  // batches the module runs — she is moving one stretch now, so what she needs told
  // is what is coming with it, which is: nothing. Said with the number rather than
  // left to be discovered, because the number is the whole reason the card was
  // rewritten.
  const beside = row.items.filter((x) => x.module === w.module && x.batch === w.batch).length;

  // Held out here and not inside the body builder, which runs again on every
  // repaint — a variable declared in there would be wiped by the first one. It opens
  // on a person rather than on "whoever is free", because the free answer is already
  // what the day is doing with this stretch and pressing it would change nothing.
  let to = others[0];
  showPopup(`Move this slot off ${personName(who, namesOf(state))}`, (refresh, close) => {
    const picker = select(
      [{ value: "0", label: "Whoever is free" },
        ...others.map((p) => ({ value: String(p), label: personName(p, namesOf(state)) }))],
      String(to),
      // Repainted rather than left alone, so the press below names whoever she has
      // just picked — the same reason combinePopup repaints its own card.
      () => {
        to = Math.max(0, Math.min(8, Math.round(Number(picker.value) || 0)));
        refresh();
      },
    );

    // And it says when this press is about more than the one stretch: on a day that is
    // sharing them out the rows have no numbers of their own, so naming one stretch is
    // what settles every row on the chart — see pinArrangement. Told here rather than
    // discovered afterwards, because the People box stops saying the day is sharing
    // them out, and a change she can see is one she is told about rather than left to
    // find.
    // And the note only ever claims what the press really does. On a day sharing them
    // out the rows have no numbers of her own to keep, so naming one stretch is what
    // settles every row on the chart, and the box does stop saying the day is sharing
    // them out. A day that already names its people is settled already: the press still
    // writes the arrangement down, but the box was naming an arrangement before it too,
    // so the note says only the part that is true of it.
    //
    // `perLine` is not passed to this card and is not needed for it: it can only choose
    // between "one to a line" and "one to a module", never "sharing them out", so the
    // box's own answer to the only question asked here is the same at either setting.
    const wasSharing = peopleState(r, sc, false) === "Sharing them out";
    const settled = to > 0 && pinArrangement(sc, r.rows).written > 0
      ? " This press settles the whole day, not just this stretch: every job is given the person it already has, and the one stretch you are moving is the only change."
        + (wasSharing ? " The People box stops saying it is sharing them out." : "")
      : "";

    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 10px" }, job),
      el("div", { class: "field" },
        el("label", {}, "Hand this stretch to"),
        picker,
        el("div", { class: "hint" },
          (beside > 1
            ? `This batch has ${beside} stretches on ${personName(who, namesOf(state))}'s row, and only the one you tapped moves — the other ${beside - 1} stay where they are.`
            : `Only this stretch moves: the rest of ${w.name} is untouched. The day is redrawn as soon as it goes, and anything that now collides is drawn red.`) + settled)),
      el("div", { class: "popup-actions" },
        // Named with who she picked, so the press says what it will do rather than
        // "confirm" — and it is the only press on the card, so nothing happens
        // until she makes it.
        button(`Move it to ${to > 0 ? personName(to, namesOf(state)) : "whoever is free"}`,
          () => doReassignSlot(sc, r, w, to, on, state, close), "primary")));
  });
}

function doReassignSlot(sc, r, w, to, on, state, close) {
  // The work itself is the model's, so it is one answer everywhere and can be
  // tested without a screen. `batch` and `slot` are the two numbers touchWindows
  // writes on every window, which is what makes this the stretch she tapped and not
  // its neighbours.
  //
  // The day's own arrangement goes down first, and only when the stretch is going to
  // a PERSON. On a day that is sharing them out, a row's number is what the packing
  // invented, so naming one stretch lets the packing re-number every row under her —
  // the fault she reported on 23 September, in her words "Jien disapper, and Jien name
  // chage to Wei". Writing the picture down first keeps every row where it is. Handing
  // a stretch back to "whoever is free" writes nothing down: that answer belongs to the
  // day's own arrangement, and pinning the rest around it would freeze a day she has
  // just handed back to the planner.
  const pinned = to > 0 ? pinArrangement(sc, r.rows) : null;
  const next = reassignSlot(pinned ? pinned.scenario : sc, w.module, w.batch, w.slot, to);
  sc.modules = next.modules;
  on.persist();
  on.refresh();
  const clock = `${clockAt(r.dayStartMin, w.from)} → ${clockAt(r.dayStartMin, w.to)}`;
  const settled = pinned && pinned.written ? " — the rest of the day keeps the row it has" : "";
  toast(`${w.name}, ${clock} — ${to > 0 ? `handed to ${personName(to, namesOf(state))}` : "back to whoever is free"}${settled}`);
  // The card goes with the move. Its heading says which person the stretch is being
  // taken off, and once the day has redrawn that is no longer true: the marker is
  // on somebody else's row, so leaving the card up would offer a press that names
  // a person who no longer holds it and does nothing when she takes it. The toast is
  // what confirms the move; a second tap on the marker — now on its new row — opens
  // a fresh card that says where it stands.
  if (typeof close === "function") close();
}

// The note a module's card wears when some of its stretches have been handed to
// somebody else. Null when none have, which is every module until she hands one over.
//
// A hand-over is ONE stretch and not the module (reassignSlot), so "Who is at this
// module" is the module's default and no longer the whole answer: without this the
// box could read 1 while three markers sat on person 2's row, and the card and the
// chart would be disagreeing about the same day. Counted off the chart's own windows
// rather than out of the stored map, because an entry that no longer resolves to a
// batch is not a stretch at all — and read as "differs from what this module would
// have given it anyway", so a stretch handed to whoever is free is still a hand-over
// on a module nobody was put on, and is not one on a module that was already free.
function handedOverNote(r, live, state) {
  if (!r || !Array.isArray(r.rows)) return null;
  const facts = (r.modules || []).find((x) => x.id === live.id);
  if (!facts) return null;
  const counts = new Map();
  for (const row of r.rows) {
    for (const w of row.items || []) {
      if (w.module !== live.id) continue;
      const own = facts.lines ? (facts.crew[w.line] || 0) : (facts.person || 0);
      if (w.person === own) continue;
      counts.set(w.person, (counts.get(w.person) || 0) + 1);
    }
  }
  if (!counts.size) return null;
  const total = [...counts.values()].reduce((t, n) => t + n, 0);
  const said = [...counts.keys()].sort((a, b) => a - b).map((p) => {
    const n = counts.get(p);
    return n > 1 ? `${n} to ${personName(p, namesOf(state))}` : personName(p, namesOf(state));
  }).join(", ");
  return el("div", { class: "field" },
    el("div", { class: "tl-ctl-lab" }, "Stretches handed on"),
    el("div", { class: "hint" },
      `${total === 1 ? "1 stretch of this module has" : `${total} stretches of this module have`} been handed to somebody else: ${said}. ` +
      "The person above is still who this module is put on; a hand-over is one stretch of it, and it is changed by tapping that stretch on the person's own row of the day."));
}

function personLabel(row, sc, state) {
  const also = mergeMembers(row.person, sc);
  const base = personName(row.person, namesOf(state));
  return also.length ? `${base} (with ${also.join(", ")})` : base;
}

// The card that could not be reached. Her words, 22 Sep 2026: "when we click on
// the person module, we should be allow to change person1 to a name, person2 to a
// name. Can we set whether to make announcement 1 min before the next cycle start
// he is responsible to?"
//
// Both answers live in the app's settings rather than in the scenario, so a name
// typed once is the name every scenario uses — and the card says so out loud,
// because person numbers restart at 1 in each scenario and that is hers to know.
function personPopup(row, sc, on, state, r) {
  const who = row.person;
  const settings = state.settings;
  const names = (settings.personNames ||= {});
  const calls = (settings.personCalls ||= {});

  let titleEl = null;
  showPopup(`👤 ${personName(who, names)}`, () => {
    const field = el("input", {
      class: "input", type: "text", value: names[who] || "", placeholder: `Person ${who}`,
    });
    const callLabel = el("label", {}, `Call ${personName(who, names)} a minute before their next job`);

    // Where they are now, off the day being drawn rather than off the row she tapped
    // with: setting an hour or a skill moves the day under an open card, and a card
    // that went on describing the day before that press would be telling her about a
    // day that is no longer on the screen.
    const freshRow = () => (computeScenario(sc).rows || []).find((x) => x.person === who) || row;
    const readout = el("div", { class: "card-sub", style: "margin:0 0 10px" });
    const jobsBox = el("div", {}, el("div", { class: "tl-note-who" }, "What they do today"));
    // Written straight into the two boxes rather than by rebuilding the card: a rebuilt
    // body would take the cursor out of the box she is typing in, which is the same
    // reason the name field below repaints the chart and not itself.
    const paint = () => {
      const n = personNotes(freshRow(), sc, state, sc.dayStartMin);
      // One sentence per line. These used to be bare text nodes in one box, which the
      // browser ran together with no space between them — "…and nothing collides.Here
      // all day." — so a sentence boundary read as a typo.
      readout.replaceChildren(...[
        `${hoursAndMinutes(n.busy)} of work` + (n.places > 1 ? `, in ${n.places} places` : "") +
        (n.clashes ? `, with ${n.clashes} collision${n.clashes === 1 ? "" : "s"} to sort out.` : ", and nothing collides."),
        n.shiftLine + ".",
        n.trainedLine,
        ...n.outside.map((o) => o.text),
        n.outsideMore > 0 ? `…and ${n.outsideMore} more like that.` : null,
      ].filter(Boolean).map((t) => el("div", {}, t)));
      const rows = (n.jobs.length ? n.jobs.map((j) => el("div", { class: "tl-note-job" }, j))
        : [el("div", { class: "tl-note-job" }, "Nothing on this person yet.")]);
      if (n.more > 0) rows.push(el("div", { class: "tl-note-job" }, `…and ${n.more} more.`));
      jobsBox.replaceChildren(el("div", { class: "tl-note-who" }, "What they do today"), ...rows);
    };

    field.addEventListener("input", () => {
      const typed = field.value.trim();
      if (typed) names[who] = typed;
      else delete names[who];
      on.persist();
      // The chart is repainted, never this card — so the name appears on the row
      // while she is still typing it and the box keeps its cursor.
      on.refresh();
      // The card's own two mentions of the person follow the name here, by hand,
      // rather than through the repaint above — the title lives outside this body
      // and rebuilding it is exactly what would take the cursor out of the box.
      // A text node through replaceChildren, not innerText, so the same code
      // updates the heading and the sentence in a browser and under the test shim.
      const said = `👤 ${personName(who, names)}`;
      if (titleEl) titleEl.replaceChildren(document.createTextNode(said));
      callLabel.replaceChildren(document.createTextNode(
        `Call ${personName(who, names)} a minute before their next job`));
    });

    // ── The hours they are here ──────────────────────────────────────────────
    //
    // Counted from the start of her day and shown as clock times, because the day's own
    // start is what the whole chart is measured from and she moves it. Empty is a real
    // answer in both boxes: an empty "from" is the day's own start and an empty "until"
    // is the day's own end, so clearing both puts the person straight back to "here all
    // day" — which is the same absence every day read before these existed.
    const stored = row.shift || null;
    const from = el("input", {
      class: "input", type: "time", step: "900",
      value: stored ? timeFieldValue(sc.dayStartMin + stored.startMin) : "",
    });
    const until = el("input", {
      class: "input", type: "time", step: "900",
      value: stored ? timeFieldValue(sc.dayStartMin + stored.endMin) : "",
    });
    const shiftHint = el("div", { class: "hint" });
    const shiftHintDefault = `Leave both empty and they are here all day. A time is read against your own day, which starts at ${clockAt(sc.dayStartMin, 0)}.`;
    shiftHint.replaceChildren(document.createTextNode(shiftHintDefault));

    const writeShift = () => {
      const fromRaw = from.value.trim();
      const untilRaw = until.value.trim();
      const startMin = fromRaw ? shiftMinutesOf(sc.dayStartMin, from.value) : 0;
      const endMin = untilRaw ? shiftMinutesOf(sc.dayStartMin, until.value) : DAY_MIN;
      // A pair that comes out back-to-front is refused and SAID, never swallowed: a box
      // that took a number and quietly did something else with it is the kind of thing
      // that reads as a fault for weeks. Both boxes go back to what is stored, so the
      // screen never wears a value the day is not using.
      if (startMin == null || endMin == null || endMin <= startMin) {
        from.value = stored ? timeFieldValue(sc.dayStartMin + stored.startMin) : "";
        until.value = stored ? timeFieldValue(sc.dayStartMin + stored.endMin) : "";
        shiftHint.replaceChildren(document.createTextNode(
          "That is the wrong way round — the second time has to be later in the day than the first. Both boxes have been put back to the hours the day is actually using."));
        return;
      }
      sc.shifts ||= {};
      // The whole day is stored as NO entry rather than as a pair covering it, so
      // "here all day" has one spelling and every day before this one already has it.
      if (startMin === 0 && endMin === DAY_MIN) delete sc.shifts[String(who)];
      else sc.shifts[String(who)] = { startMin, endMin };
      on.persist();
      on.refresh();
      shiftHint.replaceChildren(document.createTextNode(shiftHintDefault));
      paint();
    };
    from.addEventListener("input", writeShift);
    until.addEventListener("input", writeShift);

    // ── What they are trained for ────────────────────────────────────────────
    //
    // Her own words, 23 September: "a person we should be able to specify their skill,
    // by module, can be more then one, by module", and "module should select the one
    // that specialised". So this is a statement about TRAINING and not about placement:
    // she never places anybody by hand, and the day can never quietly put a pair of hands
    // on a job they were not hired for. Only the modules that actually hold hands are
    // offered — a tick against a module switched off, or against the proofer, would be a
    // tap that does nothing.
    const places = ((r && r.on) || []).filter((f) => (Number(f.touchMin) || 0) > 0);
    const tickBoxes = places.map((f) => {
      const box = el("input", { type: "checkbox", checked: skillsOf(sc.skills, who).includes(f.id) });
      box.addEventListener("change", () => {
        const list = tickBoxes.filter((b) => b.box.checked).map((b) => b.id);
        sc.skills ||= {};
        // Unticking everything is a real answer — "they can work anything", which is what
        // every day before this one says — so it DELETES the entry rather than leaving an
        // empty list behind, the same one-spelling-of-unset rule the hours follow.
        if (list.length) sc.skills[String(who)] = list;
        else delete sc.skills[String(who)];
        on.persist();
        on.refresh();
        paint();
      });
      return { id: f.id, box };
    });

    const call = el("input", { type: "checkbox", checked: calls[who] !== false });
    call.addEventListener("change", () => {
      // Kept as a real false rather than deleted, so "off" is a choice she made
      // and not an absence that a later default could quietly switch back on.
      calls[who] = call.checked;
      on.persist();
    });

    paint();

    return el("div", {},
      readout,

      el("div", { class: "field" },
        el("label", {}, "What you call them"),
        field,
        el("div", { class: "hint" },
          "The name is used in every scenario, not just this one — the person numbers start again at 1 in each scenario, so a name you give to person 1 shows wherever person 1 is working.")),

      el("div", { class: "field" },
        el("label", {}, "No name yet is fine"),
        el("div", { class: "hint", style: "margin:0" },
          `Leave it empty and the day goes on saying Person ${who}.`)),

      el("div", { class: "field" },
        el("label", {}, "When they are here"),
        el("div", { class: "two-col" },
          el("label", { class: "stack" }, el("span", { class: "hint" }, "Here from"), from),
          el("label", { class: "stack" }, el("span", { class: "hint" }, "Here until"), until)),
        shiftHint),

      el("div", { class: "field" },
        el("label", {}, "Which modules can they work?"),
        ...(tickBoxes.length
          ? tickBoxes.map((b) => el("label", { class: "row-check" }, b.box,
            el("span", {}, ((places.find((f) => f.id === b.id) || {}).name) || b.id)))
          : [el("div", { class: "hint", style: "margin:0" },
            "No module on this day is set to take hands, so there is nothing to train for yet.")]),
        el("div", { class: "hint" },
          "Tick nothing and they can work anything, as they do today. Tick one or more and the day only ever gives them those, and asks the person trained for the fewest modules first. Nothing here is ever a refusal: a job nobody trained is free for still goes to somebody, and the row says so.")),

      el("div", { class: "field" },
        callLabel,
        el("label", { class: "row-check" }, call,
          el("span", {}, "Tick to have the day call them")),
        el("div", { class: "hint" },
          "One minute, not at the minute — a call is a call to go and stand somewhere, and a fold is a one-minute job, so telling them the moment they should already be folding is too late. Off, they still work the day; they are simply not called.")),

      el("div", { class: "tl-notes", style: "margin-top:12px" },
        el("div", { class: "tl-note" }, jobsBox,
          // Her words, 24 Sep 2026, when she went looking for a reassign button on
          // this card: "if you know that reassignment is automatic, then forget about
          // my request for reassignment button, just need to mention work
          // reassignment is automatic with worker card detail change". So there is no
          // button here, and the card says why there is nothing to press. The reason
          // is the model's: the day gives out its own work from the hours and the
          // ticks on this very card (peopleRows), so changing either re-picks hands
          // on the spot — while a person she put on a module herself, or a stretch
          // she moved off somebody's row, is hers and is read first, so this card
          // moving it would be the app overruling her.
          el("div", { class: "hint" },
            "Nothing here needs a reassign button: the day gives out this work by itself, so changing the hours above or the ticks changes these lines on the spot, and a job that no longer fits is handed to somebody else. What you placed by hand stays yours — a person you put on a module yourself, or a stretch you moved off somebody's row, is not moved by this card."))));

  }, { onTitle: (node) => { titleEl = node; } });
}

// Which people this row is standing in for, kept only while it is true: the
// moment she gives a module back to person 3, person 3 has a row of its own again
// and the "1+3" label must stop claiming them.
//
// A person counts as still at work if ANY line they are on is theirs, so being
// the second pair of hands on somebody's line 2 is a job like any other.
function mergeMembers(person, sc) {
  const listed = ((sc && sc.merges) || {})[String(person)] || [];
  return listed.filter((who) => !(sc.modules || []).some((m) => (m.crew || [Number(m.person)])
    .some((p) => Number(p) === who)));
}

// Her own example, as a control: combine person 1 with person 3 and see the two
// rows become one — the modules move, the label follows, and whatever collides is
// exactly the manpower the combination cannot pay for. Two taps, because that is
// the sentence she said: this person, then that person.
function combinePopup(r, sc, on, state) {
  const named = r.rows.filter((x) => x.named);
  if (named.length < 2) {
    toast(named.length
      ? "Give a second person a module — a combination needs two people to join"
      : "Give two modules to two different people first — then there are two people to combine");
    return;
  }

  // Which person keeps the job. Held out here, not inside the body builder: the
  // builder runs again on every refresh, so a variable declared in there would be
  // wiped the moment the first tap repainted the pop-up.
  let into = null;
  showPopup("Combine two people", (refresh, close) => {
    const chipFor = (x) => el("button", {
      type: "button",
      class: `tl-chip${into === x.person ? " on" : ""}`,
      onclick: () => {
        if (into == null) { into = x.person; refresh(); return; }
        if (into === x.person) { into = null; refresh(); return; }
        doCombine(sc, into, x, on, state);
        close();
      },
    }, `${personLabel(x, sc, state)} · ${x.items.length} ${x.items.length === 1 ? "job" : "jobs"}, ${hoursAndMinutes(x.busy)}`);

    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Putting two people's modules on one pair of hands. That is how you find out what one person can really cover — and whatever collides is the part they cannot."),
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        into == null
          ? "Tap the person who keeps the job."
          : `Tap whose modules should move to ${personLabel({ person: into }, sc, state)}.`),
      el("div", {}, ...named.map(chipFor)),
      el("p", { class: "card-sub", style: "margin:10px 0 0" },
        "Every module keeps the job it does; only who is standing at it changes. Giving one module back is done in that module's own editor."));
  });
}

function doCombine(sc, into, from, on, state) {
  // The work itself is the model's, so it is the same answer every time and can
  // be tested without a screen: it hands back the modules and the new label.
  const next = combinedScenario(sc, into.person, from.person);
  sc.modules = next.modules;
  sc.merges = next.merges;
  on.persist();
  on.refresh();
  const members = (next.merges[String(into.person)] || []);
  toast(`${personName(into.person, namesOf(state))}${members.length ? ` +${members.join("+")}` : ""} — the collisions are what they cannot cover`);
}

// The collisions in words, under the diagram, because a red outline on a narrow
// bar is not an explanation. Two modules given to one person that overlap in time
// cannot both be done, and moving one of them is the fix. Her own reading of a
// collision is the point of the whole exercise: it is the manpower she is
// paying for twice, so it is counted as two people on the row above.
// A job named the way it is drawn on the timeline: the module, and which line of
// it when the module is worked as lines. Without the line, two lines of one module
// colliding read as the same module twice — "Person 2 is at the fold and the fold
// at the same time" — which is exactly the collision she is looking at.
function jobName(w) {
  if (!w) return "—";
  return w.line >= 0 ? `${w.name}, line ${w.line + 1}` : w.name;
}

// A collision, written so that it can actually be read. It used to be one
// sentence — "Person 1 is at X and Y at the same time" — and a module's name runs
// to forty characters ("Mixing by hand in the tub (set the minutes)"), so the two
// jobs the sentence is about were the one thing buried in it, and the word "and"
// between them was lost. Each job now gets a line of its own, under a first line
// that says who and when, and the two together are the whole of the fault. The
// line number stays spelled out, because two lines of one module read identically
// without it.
//
// A row with several clashes gives several blocks, and past three the rest are
// counted rather than dropped in silence — a list that quietly stops at four
// reads as though the day has four problems when it has nine.
function clashNotes(r, state) {
  const found = [];
  for (const row of r.rows) {
    for (const c of row.clashes) found.push({ row, c });
  }
  if (!found.length) return null;
  const shown = found.slice(0, 3);
  const rest = found.length - shown.length;
  return el("div", { class: "tl-notes" },
    ...shown.map(({ row, c }) => el("div", { class: "tl-note" },
      el("div", { class: "tl-note-who" },
        `👤 ${personLabel(row, r.scenario, state)} — two jobs at once, ` +
        `${clockAt(r.dayStartMin, c.from)} → ${clockAt(r.dayStartMin, c.to)}`),
      el("div", { class: "tl-note-job" }, jobName(c.before)),
      el("div", { class: "tl-note-job" }, jobName(c.after)),
      el("div", { class: "tl-note-how" },
        "Move one of them along the day, or combine with another person and accept the collision."))),
    rest
      ? el("div", { class: "tl-note" },
          `…and ${rest} more ${rest === 1 ? "pair of jobs" : "pairs of jobs"} on one person at once. ` +
          "Move the modules apart and they go.")
      : null);
}

function isClash(row, w) {
  return row.clashes.some((c) => c.after === w);
}

function toneIndex(r, id) {
  const at = r.modules.findIndex((m) => m.id === id);
  return at < 0 ? 0 : at;
}

// ── A module, opened ────────────────────────────────────────────────────────
//
// Everything about one module in one place, in the order the day runs through it:
// what it is, how long it holds, how much of her it takes, when it starts, and
// who is standing at it. The start is the knob she named, so it sits beside the
// explanation of what turning it does.
function editModule(saved, sc, on, isNew = false, r = null, state = null) {
  showPopup(`${saved.icon} ${saved.name}`, (refresh, close) => {
    // The module list is edited in place, so each field writes only its own value
    // back; the screen behind the pop-up catches up when it closes.
    const live = sc.modules.find((m) => m.id === saved.id) || saved;

    const set = (key, raw, opt) => {
      const n = Number(raw);
      const min = opt && opt.min != null ? opt.min : 0;
      if (!Number.isFinite(n) || n < min) return;
      // A batch count carries down the modules that were in step with it — her
      // rule, "follow the one before, and say when it does not". It writes the
      // list in place, so `live` here is still the module she is working on.
      if (opt && opt.carry) {
        alignBatches(sc.modules, live.id, n);
        on.persist();
        on.refresh();
        return;
      }
      // A pace she has typed has to REACH the batches, and on a module that carries
      // a stored list it otherwise would not: a list answers for every batch, so the
      // box would be a control that does nothing at all. Re-spaced here, before the
      // new pace is written, so the module's own old pace is still there to measure
      // each batch's deviation from.
      if (opt && opt.repace) repaceBatches(live, n);
      live[key] = opt && opt.int ? Math.round(n) : n;
      on.persist();
      on.refresh();
    };

    const f = (key, label, hint, opt = {}) => {
      // Auto is an empty box with the word in it, and it writes a real 0 rather
      // than nothing: the model already reads a 0 spacing as "each batch starts
      // the moment the one before it ends", and a stored 0 is a number that
      // survives a reload. The flag beside it is what remembers that she did not
      // type it — so a module she has not paced keeps following its own cycle
      // length when she changes the cycle, which is the whole point of Auto.
      const auto = opt.auto ? live[opt.auto] === true : false;
      const input = el("input", {
        class: "input", type: "number", inputmode: "decimal",
        min: String(opt.min == null ? 0 : opt.min), step: String(opt.step || 1),
        placeholder: opt.auto ? "Auto" : null,
        value: auto ? "" : String(live[key] == null ? 0 : live[key]),
      });
      // A typed number is hers, so the flag goes off for good the moment she
      // types one — and comes back on only if she empties the box again.
      const write = (raw) => {
        if (opt.auto) {
          const blank = String(raw).trim() === "";
          live[opt.auto] = blank;
          if (blank) {
            // Auto means the module's own cycles decide the spacing, so the list it
            // may be carrying has to GO and not be re-spaced to 0. Re-spaced, it kept
            // a list with the OLD pace baked into it, that list then went on answering
            // for every batch, and Auto became a box that changed nothing — the second
            // half of her report of 23 September 2026: "set to 21, but no effect".
            // Batch one is the module's start time and stays exactly where it is; only
            // the batches after it go back to following the cycles.
            //
            // The 0 and the save are written here rather than through set(), and that is
            // not a detail: set() refuses any number under the box's own minimum, this
            // box's minimum is 1, and the refusal returned BEFORE the save and the
            // repaint — so Auto moved the flag and nothing else. Measured live on her own
            // mix, two batches: emptying the box left both batches 30 minutes apart and
            // the screen did not move, and the card reopened with its empty Auto box drawn
            // over the same unchanged chart; a reload then forgot the choice altogether.
            delete live.starts;
            live[key] = 0;
            on.persist();
            on.refresh();
            return;
          }
        }
        set(key, raw, opt);
      };
      // Typing writes the number and repaints the screen behind the pop-up, but
      // it must NOT rebuild this card: this card is tall, and rebuilding it under
      // her finger threw the scroll and destroyed the box she was typing in.
      // A box whose answer changes the CARD's shape — one more line, one more
      // cycle row — says so, and then it rebuilds once, when she leaves the box.
      //
      // The hint may be a FUNCTION, for the one field whose explanation depends on
      // what she has just typed. It is repainted in place rather than by rebuilding
      // the card, for the reason above — and because a box that quietly does nothing
      // reads as a fault, while a line that says why is the whole answer.
      const hintNode = hint ? el("div", { class: "hint" }) : null;
      const paintHint = () => {
        if (!hintNode) return;
        const said = String(typeof hint === "function" ? (hint() || "") : hint);
        hintNode.textContent = said;
        hintNode.style.display = said ? "" : "none";
      };
      paintHint();
      input.addEventListener("input", () => { write(input.value); paintHint(); });
      if (opt.rebuild) input.addEventListener("change", () => refresh());
      return el("div", { class: "field" }, el("label", {}, label), input, hintNode);
    };

    const t = (key, label, hint) => {
      const input = el("input", { class: "input", type: "text", value: String(live[key] || "") });
      input.addEventListener("input", () => {
        live[key] = input.value;
        on.persist();
        on.refresh();
      });
      return el("div", { class: "field" }, el("label", {}, label), input,
        hint ? el("div", { class: "hint" }, hint) : null);
    };

    const toggle = el("input", { type: "checkbox", checked: live.on !== false });
    toggle.addEventListener("change", () => {
      live.on = toggle.checked;
      on.persist();
      on.refresh();
    });

    // Whether this module is fed by the one above it. Her points three and four
    // were one switch; it is one CHOICE of three now, because her report of 22
    // September was that the switch could not do what its own label said — the
    // floor it really was cannot pull a packing step back onto the cooling's end,
    // which is the thing she was trying to do. See START_MODES in the model for
    // where the three live and chainLine for where they are obeyed.
    const startField = el("div", { class: "field" },
      el("label", {}, "How this module takes its start"),
      (() => {
        const row = el("div", { class: "pill-row" });
        for (const mode of START_MODES) {
          row.append(button(START_MODE_LABELS[mode], () => {
            setStartMode(live, mode);
            on.persist();
            on.refresh();
            refresh();
          }, `ghost small${startModeOf(live) === mode ? " cal-mode-on" : ""}`));
        }
        return row;
      })(),
      el("div", { class: "hint", style: "margin-top:2px" }, START_MODE_HINTS[startModeOf(live)]));

    // What the control row's "The line" chip used to carry, on the card of the
    // module whose own three answers set it — her ask, and a line off the row she
    // asked to shorten. Everything the chip's own card carried comes with it: the
    // sentence naming which modules wait, the same three cost numbers, and the same
    // two presses. What is gone is the chip that stood in the row saying them.
    //
    // `r` is the computed day, so a brand-new module has nothing here: there is no
    // day yet for a chain to be part of.
    const chainBlock = () => (r ? el("div", { class: "field" },
      el("div", { class: "tl-ctl-lab" }, "Waiting on the module above"),
      el("div", { class: "hint", style: "margin-top:4px" }, chainSentence(r)),
      el("div", { class: "hint", style: "margin-top:4px" },
        `${r.people} ${r.people === 1 ? "person" : "people"} · ` +
        `${hoursAndMinutes(r.personMin)} of hands · a ${hoursAndMinutes(r.runMin)} day.`),
      el("div", { class: "tl-ctl", style: "margin:6px 0 0" },
        el("div", { class: "tl-ctl-group" },
          chainedCount(r)
            ? el("button", {
              type: "button", class: "tl-chip",
              onclick: () => { chainAll(sc, on, false); refresh(); },
            }, "Take the waiting off")
            : null,
          el("button", {
            type: "button", class: "tl-chip",
            onclick: () => { chainAll(sc, on, true); refresh(); },
          }, chainedCount(r) ? "Chain the whole line" : "Chain every module")))) : null);

    // Her ask, as a switch: "allow each module cycle to overlap". Off, the module
    // holds its own cycles apart — one lot at a time — which is right when the
    // dough is physically IN the thing. On, each cycle sits where she put it.
    const overlapBox = el("input", { type: "checkbox", checked: live.overlap === true });
    overlapBox.addEventListener("change", () => {
      live.overlap = overlapBox.checked;
      on.persist();
      on.refresh();
      refresh();
    });

    // Her ask: "one module having 2 lines, each line can have its own person".
    // A module she has two of is two lines, so this is where she says who is
    // standing at each. Line 1 IS the module's own person — one number written in
    // two places, exactly as startMin is starts[0] — so a one-of-them module still
    // has the one box it always had, and the two can never disagree.
    const linesBlock = () => {
      const many = Math.max(1, Math.min(8, Math.round(Number(live.count) || 1)));
      if (many < 2) return null;
      if (live.overlap === true) {
        return el("div", { class: "field" },
          el("div", { class: "tl-ctl-lab" }, "Production line"),
          el("div", { class: "hint", style: "margin-top:4px" },
            "Allow multiple production line is switched ON, so this module's batches no longer take turns and it is drawn as one production line with one person. The people you set per line are kept, not thrown away — switch overlapping off and the module is drawn as its lines again, each with its own."));
      }
      const cur = Array.isArray(live.crew) ? live.crew : [];
      const who = (i) => {
        const stored = Number(cur[i]);
        return Number.isFinite(stored) ? stored : (Number(live.person) || 0);
      };
      const put = (i, raw) => {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return;
        const p = Math.max(0, Math.min(8, Math.round(n)));
        const next = [];
        for (let k = 0; k < many; k += 1) next.push(k === i ? p : who(k));
        live.crew = next;
        if (i === 0) live.person = p;
        on.persist();
        on.refresh();
      };
      const rows = [];
      for (let i = 0; i < many; i += 1) {
        const input = el("input", {
          class: "input", type: "number", inputmode: "numeric",
          min: "0", max: "8", step: "1", value: String(who(i)),
        });
        input.addEventListener("input", () => put(i, input.value));
        rows.push(el("div", { class: "field" },
          el("label", {}, `Production line ${i + 1} — who is on it`),
          input,
          i === 0
            ? el("div", { class: "hint" },
              "0 means whoever is free. Production line 1 is the module's own person — while the module is drawn as these lines, this box is the one that answers Who is at this module, and the two can never say different numbers.")
            : null));
      }
      return el("div", { class: "field" },
        el("div", { class: "tl-ctl-lab" }, "Production line"),
        ...rows,
        el("div", { class: "hint" },
          "A production line each, one under the other on the timeline, so the same number on two lines is one person covering both — and if those two lines really do need them in the same minute, that person's row in the People list goes red and names the minute. Give a production line 0 and it is whoever is free."));
    };

    // Who is at this module, for a module drawn as one row. It asks the MODEL what
    // the person is rather than reading the stored field, because the two can
    // differ: lower how many of a module she has and the second line's person goes
    // with the line, so line 1 — this box — is not always what was last typed into
    // it. Written back as both `person` and line 1 of the crew, so the box, the
    // lines above and the People rows cannot end up giving three answers.
    const personField = () => {
      const many = Math.max(1, Math.min(8, Math.round(Number(live.count) || 1)));
      const cur = Array.isArray(live.crew) ? live.crew : [];
      const input = el("input", {
        class: "input", type: "number", inputmode: "numeric",
        min: "0", max: "8", step: "1", value: String(moduleOf(live).person),
      });
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n) || n < 0) return;
        const p = Math.max(0, Math.min(8, Math.round(n)));
        const crew = [];
        for (let k = 0; k < many; k += 1) {
          const stored = Number(cur[k]);
          crew.push(k === 0 ? p : (Number.isFinite(stored) ? Math.max(0, Math.min(8, Math.round(stored))) : p));
        }
        live.crew = crew;
        live.person = p;
        on.persist();
        on.refresh();
      });
      return el("div", { class: "field" },
        el("label", {}, "Who is at this module"),
        input,
        el("div", { class: "hint" },
          "0 means whoever is free. Put 1, 2, 3… and that named person is given this module — so two modules on person 1 that overlap show up as a collision to move apart."));
    };

    // How many batches it runs in the day. Her ask: "It should be auto as it
    // should follow the earlier module, we just indicate in the 1st module."
    //
    // So the box is on the FIRST module, where the number is hers to set, and on
    // any module that already has a number of its own. Every module she has ever
    // saved keeps its number and keeps its box — an Auto state is only ever
    // arrived at by a module that had none, which is why nothing of hers moves.
    // An automatic module still says its number out loud, and still names what it
    // is following, because a count that is not on the screen is a count she
    // cannot check — and it says the same thing the note under the day says.
    const repeatsField = () => {
      const order = sc.modules.findIndex((m) => m.id === live.id);
      const auto = live.repeatsAuto === true;
      if (!auto || order <= 0) {
        return f("repeats", "How many batches it runs in the day",
          "Set this above 1 and the module runs again later in the day: the fold runs its batch four times. Change it and the modules after this one that were running the same number follow you, and stop where one has a number of its own — the line under the day names any that no longer match. The climb card raises this one for you — and a day can only hold so many, so a batch that takes hours is counted at the few that fit.",
          { min: 1, int: true, rebuild: true, carry: true });
      }

      const above = sc.modules.slice(0, order).reverse()
        .find((m) => m.on !== false && (Number(m.touchMin) > 0 || Number(m.cycleMin) > 0));
      const count = moduleOf(live).repeats;
      const aboveName = above ? above.name : "the module above";
      const aboveCount = above ? moduleOf(above).repeats : count;
      return el("div", { class: "field" },
        el("label", {}, "How many batches it runs in the day"),
        el("div", { class: "cyc-line" },
          el("div", { class: "input cyc-auto" },
            `${count} ${count === 1 ? "batch" : "batches"} — auto`),
          button("Give it its own number", () => {
            // A number of her own, written from what the day is already running so
            // that taking the wheel never moves the day a single minute.
            live.repeats = count;
            live.repeatsAuto = false;
            live.starts = undefined;
            on.persist();
            on.refresh();
            refresh();
          }, "ghost")),
        el("div", { class: "hint" },
          `Auto, so this module runs what the one before it runs — following ${aboveName}, which runs ${aboveCount}. A module follows the one above until one of them has a number of its own, and it is only the first module that has to have one, because that is where your day's number comes from. Take it on yourself and the module keeps the count it is running now: from there it is yours, and the modules after it follow you instead.`));
    };

    const order = sc.modules.findIndex((m) => m.id === live.id);
    const acts = [];

    if (!isNew && order >= 0) {
      acts.push(el("div", { class: "tl-ctl-group" },
        el("span", { class: "tl-ctl-lab" }, "Order"),
        el("button", {
          type: "button", class: "tl-chip", disabled: order === 0,
          onclick: () => { sc.modules = moveModule(sc.modules, live.id, -1); on.persist(); on.refresh(); close(); },
        }, "↑ Earlier"),
        el("button", {
          type: "button", class: "tl-chip", disabled: order === sc.modules.length - 1,
          onclick: () => { sc.modules = moveModule(sc.modules, live.id, 1); on.persist(); on.refresh(); close(); },
        }, "↓ Later")));
    }

    // The two sentences the row no longer carries, word for word and at the top of
    // the card the row's tap opens — which is where her phone reads them, because a
    // finger has no hover to bring them back with. Built by the same helper the row
    // uses, so the card and a computer's hover can never tell her two stories.
    //
    // A module the day could not place (a parked one) has no computed time, and a
    // module she has just added has not been laid out for her yet: neither shows a
    // summary, which is honest rather than a guess.
    const cm = r ? (r.modules || []).find((x) => x.id === live.id) : null;
    const summary = cm ? (() => {
      const n = moduleNotes(r, cm, live);
      return [
        // The tags the row used to wear, in the row's own colours, before the two
        // notes: since v157 the row is the name and its bars and nothing else, and
        // this is where a phone reads what it left behind.
        n.tags.length
          ? el("div", { class: "tl-tag-row" },
            ...n.tags.map((t) => el("span", { class: `badge ${t.cls}` }, t.text)))
          : null,
        el("p", { class: "card-sub", style: "margin:0 0 4px" }, n.when),
        el("p", { class: "card-sub", style: "margin:0 0 10px" }, n.cost),
      ];
    })() : null;

    return el("div", {},
      ...(summary || []),
      el("div", { class: "field" },
        el("label", { class: "check-row" }, toggle,
          el("span", { class: "check-label" }, "This module is in the scenario")),
        el("div", { class: "hint", style: "margin-top:6px" },
          "A module is one piece of your equipment and the hands that tend it, counted as one thing. Switch it off and the line answers without it, so you can see what a machine would buy you before you buy it. A brand new module arrives switched off until its numbers are in.")),
      t("name", "What this module is called", "Your words, so the timeline reads the way you would say it."),
      t("icon", "Its picture", "Any single emoji — it is what you will look for on the timeline."),
      f("batch", "Pans in one batch", "How many pans one batch deals with.", { min: 1 }),
      // The cycles come first among the numbers, because in this model they ARE
      // the numbers: the module's minutes and its minutes-of-you are the sum of
      // its cycles, so there is nothing left for a separate box to say. Her own
      // sentence is the reason: a batch is not a process, a cycle is.
      cyclesField(live, on, refresh),
      f("everyMin", "Minutes from one batch to the next",
        () => paceHint(live, sc),
        { min: 1, auto: "everyAuto", repace: true }),
      repeatsField(),
      // Her point one: the module that became the bottleneck, had twice over.
      f("count", "How many production line do you have",
        "Two mixers, two ovens, two chillers, two people folding. Two production line of one module take a batch side by side, so a batch stops waiting for the one before it and the day's room doubles. It does NOT make pans you did not plan — raise how many batches it runs to put the second one to work, or let the climb do it for you. A module you have two production line of is drawn as that many lines, one under the other, each with its own person — the boxes for that appear below as soon as this says 2. Put 1 here and Allow multiple production line ON: then this module is one line with one person, and this number is not in force.",
        { min: 1, int: true, rebuild: true }),
      startField,
      chainBlock(),
      el("div", { class: "field" },
        el("label", { class: "check-row" }, overlapBox,
          el("span", { class: "check-label" }, "Allow multiple production line")),
        el("div", { class: "hint", style: "margin-top:6px" },
          "Switch this ON when the minutes in one batch are the DOUGH's time and not a machine's — dough resting between folds, a second bin on the go. The module then stops holding its own batches apart, every batch sits where you put it, and two at once are drawn as two bars in their own lanes. Leave it OFF when the dough is physically IN the thing — a sink, an oven, one tub — because two batches cannot be in one of those at once; if you need two of those, that is How many production line do you have, which lets one batch in per production line you have. Either way, allowing them to overlap never lets a batch start before the dough exists: a module that waits for the module above still waits. And switch it on with one eye on the People rows — if two of your own batches need the same person in the same minute, that person's row goes red and names the minute. A new module arrives with this already on.")),
      linesBlock(),
      f("people", "People this batch needs", "Nearly always 1 — two people at one mixer is a different job.", { min: 1, int: true }),
      // A module drawn as lines is asked who is on each LINE, above — one box per
      // line, line 1 being this same number. Two boxes for one question is the
      // dead-control trap, so the module-level box steps aside while the lines are
      // in force and comes back when they are not.
      linesInForce(live) ? null : personField(),
      // And what of it is no longer that person's. Her ask of 23 September moved the
      // hand-over onto ONE stretch, so the box above is the module's default and the
      // note below is the exception — without it the card could read 1 while three
      // markers sat on person 2's row.
      handedOverNote(r, live, state),
      acts.length ? el("div", { class: "tl-ctl", style: "margin-top:4px" }, ...acts) : null,
      el("div", { class: "popup-actions" },
        // Her ask: "we can now add module as we wish, a button at the bottom
        // with, Duplicate this module, will be helpful."
        //
        // A copy is a COPY, not a new module: it carries the cycles, the numbers
        // and the person verbatim, so none of the new-module defaults reach it.
        // That is the whole point — two ovens of hers are two of the same thing,
        // and retyping eight numbers to say so is the chore this removes.
        button("Duplicate this module", () => {
          const copy = {
            ...JSON.parse(JSON.stringify(live)),
            id: newModuleId(sc.modules),
            name: `${live.name} (copy)`,
          };
          const at = sc.modules.findIndex((m) => m.id === live.id);
          const next = sc.modules.slice();
          next.splice(at + 1, 0, copy);
          sc.modules = next;
          on.persist();
          on.refresh();
          toast(`${copy.name} added just below it — change its name and its numbers to say how it is different.`);
          close();
        }, "ghost"),
        isNew ? null : button("Delete this module", () => confirmDialog(
          // Quoted, as every other delete in the app says it. Unquoted, a module
          // whose name opens with a capital read as one sentence and lost the
          // name inside it: "Delete The proofer again?".
          `Delete the module "${live.name}"? The day will answer without it.`,
          () => {
            sc.modules = removeModule(sc.modules, live.id);
            on.persist();
            on.refresh();
            toast("Module deleted");
            close();
          },
          { danger: true, yesLabel: "Delete" }), "danger"),
        button("Done", close, "primary")));
  });
}

// ── The cycles inside one batch ────────────────────────────────────────────
//
// Her point three, as a list: a batch is not a process, a cycle is. Each cycle
// owns its own minutes and its own hands, and the one below cannot start until
// the one above it ends — which is not a rule this screen has to enforce,
// because it is what the list IS. A cycle's start is the batch's start plus the
// minutes of every cycle above it, so there is no way to type a cycle into a gap
// it cannot occupy.
//
// Load and Unload are where her hands are: at the front of the cycle, at its
// end, or at both. That is the correction this release makes. Her fold is at the
// END of each rest, and her oven swap is AFTER the bake, and both were being
// drawn at the start of their block before.
//
// The module's own Minutes and Minutes of you are not boxes here. They are the
// sums of these rows — so a second box saying the same thing twice could only
// ever disagree with them.
function cyclesField(live, on, refresh) {
  // `list` builds the boxes; `now()` is the list to WRITE onto, read at the
  // moment a box is used rather than copied when the card was built. The card is
  // deliberately not repainted while she types (v142: a rebuild would throw the
  // box out from under her finger), so a copy taken at build time goes stale the
  // moment she touches the first box — and writing that stale copy back reverted
  // EVERY other box in the card to what it was when the card opened. Measured on
  // her own fold module: cycle 1's Minutes 31 → 40, then cycle 2's Unload, and
  // cycle 1 was back to 31 while the box under her finger still read 40. Each box
  // now changes only its own value on the list as it stands, so nothing else can
  // be dragged back with it.
  const list = cyclesIn(live);
  const now = () => cyclesIn(live);
  const rows = list.map((c, i) => {
    const name = el("input", {
      class: "input cyc-name", type: "text",
      value: String(c.name || ""), placeholder: `Cycle ${i + 1}`,
    });
    name.addEventListener("input", () => {
      putCycles(live, on, now().map((x, j) => (j === i ? { ...x, name: name.value } : x)));
    });

    const num = (key, label, min) => {
      const input = el("input", {
        class: "input cyc-in", type: "number", inputmode: "numeric",
        min: String(min), step: "1", value: String(round(c[key])),
        "aria-label": `${label} in cycle ${i + 1}`,
      });
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n) || n < min) return;
        const next = now().map((x, j) => (j === i ? { ...x, [key]: n } : x));
        // Written without rebuilding the card — a number here moves a bar on the
        // timeline behind the pop-up, and the box under her finger stays put.
        putCycles(live, on, next);
      });
      return el("label", { class: "cyc-num" }, el("span", {}, label), input);
    };

    return el("div", { class: "cyc-row cyc-cycle" },
      el("div", { class: "cyc-line" },
        name,
        list.length > 1
          ? el("button", {
            type: "button", class: "cyc-del", "aria-label": `Remove cycle ${i + 1}`,
            onclick: () => { putCycles(live, on, now().filter((_, j) => j !== i)); refresh(); },
          }, "✕")
          : null),
      el("div", { class: "cyc-nums" },
        num("min", "Minutes", 0),
        num("load", "Load", 0),
        num("unload", "Unload", 0)));
  });

  const add = button("＋ Add a cycle", () => {
    putCycles(live, on, [...now(), { name: "", min: 15, load: 0, unload: 0 }]);
    refresh();
  });

  return el("div", { class: "field" },
    el("label", {}, "Cycles in one batch"),
    el("div", { class: "cyc-list" }, ...rows),
    el("div", { class: "hint" },
      "Each cycle is one piece of this module's work, in the order you work them, and a cycle cannot start until the one above it ends — together they are the minutes one batch holds it. Load is your hands at the start of a cycle and Unload is your hands at the end: your weighing out is a load, and the fold at the end of a rest is an unload. A batch with a single cycle is drawn on the timeline as one plain bar."),
    el("div", { class: "popup-actions" }, add));
}

// The cycles as the model has them, copied — a module that has never had cycles
// of her own reads as the one cycle its Minutes and Minutes-of-you always said
// it was, so this list is never empty and never invents a second answer.
function cyclesIn(live) {
  const m = moduleFacts(live);
  return (m.cycles || []).map((c) => ({ ...c }));
}

// Writing them back. A number is written without rebuilding the card, because a
// rebuild would throw the box out from under her finger (v142); the caller
// refreshes the card itself for a change that alters its shape — a row added or
// removed.
function putCycles(live, on, next) {
  live.cycles = next.map((c) => ({
    name: String(c.name || ""),
    min: round(Math.max(0, Number(c.min) || 0)),
    load: round(Math.max(0, Number(c.load) || 0)),
    unload: round(Math.max(0, Number(c.unload) || 0)),
  }));
  on.persist();
  on.refresh();
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// What the pace box says, and the one case where it has to say something else.
//
// Almost always it is the explanation of what the pace IS. But a module that takes
// its batches one at a time cannot run two of them closer together than one batch
// lasts, and when the number she has typed is shorter than that the day will quietly
// run them at the longer one. That quiet is the whole fault of this version — her
// words, 23 September 2026: "cannot reflect even i reduce it to 13, look like
// something prevent it from loweriing below 25" — so the two ways to make the pace
// possible are named, and neither is a rule of the app's: how many production line
// she has, and whether those minutes are the machine's or the dough's.
const PACE_EXPLAINED =
  "The pace the batches repeat at. For your fold that is the whole rest with its fold inside it, so one batch restarts a rhythm after the last — not the 30 minutes of the gap alone. Left on Auto it is the length of the cycles you just set, which is one batch following the one before it end to end.";

function paceHint(live, sc) {
  const m = moduleOf(live);
  // A module that runs ONE batch in the day has no second batch for a pace to sit
  // between, so the box changes nothing at all — and a box that quietly does nothing
  // reads as a fault. That is the first thing her report of 23 September 2026 says:
  // "1st module, time betwenn each batch, set to 21, but no effect". The count is the
  // DAY's and not the stored one: a module that follows the one above it runs as many
  // batches as that one does, so the answer is read off the placed batches.
  if (live.on !== false) {
    const placed = sc && computeScenario(sc).modules.find((x) => x.id === live.id);
    const runs = placed && placed.passes ? placed.passes.length : m.repeats;
    if (runs <= 1) {
      return "This module runs one batch in the day, so there is no second batch for a "
        + "pace to sit between yet. How many batches it runs in the day is the box above "
        + "that sets it — make that two and these are the minutes between them.";
    }
  }
  // Only a module that really does take its batches in turn holds them apart: one
  // production line with its overlap switch off. Two of them are two lines with a
  // batch each, and a module whose minutes are the dough's own is free to overlap, so
  // in both of those the pace is honoured as typed and there is nothing to say.
  if (m.overlap || m.count > 1 || m.everyAuto === true) return PACE_EXPLAINED;
  if (!(m.everyMin < m.cycleMin - 0.01)) return PACE_EXPLAINED;
  return "One batch at a time, so two of them cannot start closer together than the " +
    `${round(m.cycleMin)} minutes one takes — this pace will run at ${round(m.cycleMin)}. ` +
    "Give the module a second production line under How many production line you have, " +
    "or switch on Allow multiple production line if those minutes are the dough's time " +
    "and not the machine's.";
}

// Spelling a stored start list out again at a new pace.
//
// `starts` is written out in full by the presses that move a batch, and a full list
// answers for every batch — so without this the pace box is a control that does
// nothing on any module that carries one. Every batch keeps what she has done to it:
// each moves by the amount the rhythm moved, not to a place of its own, so a batch she
// has held off a collision is still held off by the same minutes afterwards.
//
// Her report of 23 September 2026, in her own words: "1st module, time betwenn each
// batch, set to 21, but no effect, or the chart dont workout" — and, asked which of the
// two she saw, "both batch start the same time". Both were this one press.
//
// A batch she has pulled CLOSER by hand than the pace the module is stored with carries
// a NEGATIVE deviation, and re-spaced at the smaller pace that lands it in front of the
// batch above it. Measured on her own first module: a list of [0, 21] stored at a pace of
// 87, re-spaced at 21, came out as [0, −45] — and the day cannot read a batch starting
// before it begins, so both batches were drawn on minute 0, exactly what she described.
// Two rules therefore, and both are the app's own rules rather than new ones:
//
//   1. A hold is only ever a HOLD. Every other press in this screen already obeys it —
//      moveBatch's written deltas and chainLine's own are `Math.max(0, …)` — so a batch
//      can be held back off the rhythm and never pulled in front of it.
//   2. No batch may be left at or behind the batch above it. Where her hold has become
//      impossible in the new rhythm, the batch takes the rhythm rather than a minute
//      that is not its own.
function repaceBatches(live, pace) {
  if (!Array.isArray(live.starts) || live.starts.length < 2) return;
  const was = moduleOf(live).everyMin;
  const base = live.starts[0];
  let above = null;
  live.starts = live.starts.map((t, k) => {
    let at = round(base + k * pace + Math.max(0, t - (base + k * was)));
    if (above != null && at <= above) at = round(above + pace);
    above = at;
    return at;
  });
  live.startMin = live.starts[0];
}

// One batch's start time, written the way a typed time is written: into this
// batch's own slot, with the module's start time following batch one so the two
// can never disagree about where the module begins. Hands back where the batch
// really landed, because a module that takes one batch at a time puts it back
// after the one before it — and the model is what knows that, not this screen.
function setBatchStart(live, sc, on, k, want) {
  const landed = writeBatchStart(live, k, want);
  on.persist();
  on.refresh();
  return cycleLanded(sc, live, k, landed);
}

// The writing half on its own, with no save and no repaint, for the one press
// that moves several modules at once. That press has to have every module written
// BEFORE the day is asked where the batches really landed — the answer depends on
// all of them together — and it wants one save for the lot rather than one per
// module. There is still only one piece of arithmetic: clampStart, the same one a
// typed time goes through.
function writeBatchStart(live, k, want) {
  // The module as the model reads it, so the list written back is the module's
  // REAL one. Reading the stored list directly is what the day does not do: a
  // module that has never had a list of its own — which is every module of hers —
  // stores only its start time, and its other batches come from its own pace. Built
  // from the stored number instead, the list comes back as the one batch she moved
  // and a row of zeroes after it, and every one of those zeroes lands on the line
  // as a batch starting the moment the one before it ends. That is not a move, it
  // is the module's whole rhythm collapsing, and it is why a press here has to
  // read the model first.
  const m = moduleOf(live);
  const at = clampStart(want, m);
  // A module that has never had a list of its own KEEPS it that way. Batch one IS
  // the module's start time, so writing that one number here is the same answer
  // `startsOf` already gives from the module's own pace — and NOT writing a list is
  // what keeps that pace alive. A list is read as the whole truth about where every
  // batch sits, and it is written out in full, so a press that sprayed one onto a
  // module left its "Minutes from one batch to the next" box answering nothing at all
  // — her report of 23 September, exactly: "cannot reflect even i reduce it to 13,
  // look like something prevent it from loweriing below 25". The press that did it is
  // the day card's own (moveDayBack pulls every module back through here), so one tap
  // used to freeze the pace box of the whole line.
  if (k === 0 && !Array.isArray(live.starts)) {
    live.startMin = at;
    return at;
  }
  const from = (m.starts || []).slice();
  // Batch one IS the module's start time, so moving it moves the module: every
  // batch after it comes along at the spacing she already set. Any later batch is
  // a nudge on that batch alone, which is what lets one batch be held off a
  // collision without sliding the rest of the day with it.
  const starts = from.map((t, i) => (k === 0 ? t + (at - from[0]) : (i === k ? at : t)));
  starts[k] = at;
  live.starts = starts.map((t) => Math.max(0, Math.round(t * 100) / 100));
  live.startMin = live.starts[0];
  return live.starts[k];
}

// What a moved batch is told: the clock it asked for, and — when the module's own
// rule put it somewhere else — which rule it was, in the same words the timeline's
// tap uses. Only ever spoken when the two differ, because a note that always
// appears is a note she stops reading.
function toastBatch(live, k, asked, landed, dayStartMin) {
  const which = `${live.name}, batch ${k + 1}`;
  if (landed <= asked) { toast(`${which} → ${clockAt(dayStartMin, landed)}`); return; }
  toast(`${which} → ${clockAt(dayStartMin, landed)} — ` + (live.overlap
    ? "the module above holds it back, so move that one and this follows"
    : `the module holds it back: ${live.count > 1
      ? "one batch per line you have"
      : "one batch at a time"}, so switch on Let its batches overlap for two at once`));
}

// Which job of the line a module is, so the Production line screen can read
// this module's minutes and its batch straight off it. The answer is kept as a
// job of its own rather than matched on the module's name, so she is free to call
// the wash whatever she calls it at the bench.
function lower(s) {
  return String(s || "").charAt(0).toLowerCase() + String(s || "").slice(1);
}

// ── What is parked ─────────────────────────────────────────────────────────
function parkedCard(r, sc, on) {
  if (!r.parked.length) return el("div", {});
  return el("div", {},
    el("h2", { class: "section" }, "Not in this scenario"),
    el("div", { class: "card" },
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        "A module that is switched off cannot be the bottleneck, and adds nothing to the day. These are the modules you have set aside — tap one to put it in."),
      ...r.parked.map((m) => el("div", { class: "info-row tappable", onclick: () => editModule(m, sc, on, false, r) },
        el("span", { class: "j-what" }, `${m.icon} ${m.name}`),
        el("span", { class: "info-val" }, m.needsYou ? "needs you" : "runs itself")))));
}

// ── Your scenarios ─────────────────────────────────────────────────────────
//
// Saving is what lets her keep two designs side by side — the line without a
// fridge and the line with one — and come back to either. A scenario is stored
// as a named copy of the modules, so opening one cannot disturb the other.
function savedScenarios(state) {
  if (!Array.isArray(state.settings.scenarios)) state.settings.scenarios = [];
  return state.settings.scenarios;
}

function scenariosCard(sc, state, on) {
  const list = savedScenarios(state);
  const here = sc.id && list.some((s) => s.id === sc.id);

  const kids = [
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Save the scenario you have built under its own name, and open it again another day. Two saved side by side is how you compare the line you have with the line you are thinking of buying."),
  ];

  // The shelf is drawn as a TABLE, and the two facts about a day are columns of it.
  //
  // Her words, 23 September 2026: "reorganised it to a better visual clarity,
  // details in table, action button below". Measured at a phone's width, 375: the
  // old row was a name and a "24 pans a day · 9 modules" sentence sharing one line,
  // and at that width BOTH wrapped — "No fridge, 1 person" broke over two lines and
  // the sentence broke after its 9 — so the numbers came to rest at four different
  // x positions down the card and comparing two days meant reading two sentences.
  // In columns the numbers line up and are compared down the page, which is the one
  // thing this card exists for.
  if (!list.length) {
    kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" }, "Nothing saved yet."));
  } else {
    kids.push(scenarioShelf(list, sc, state, on));
    // A shelf that has stopped at four days has to say so, or the four days that are
    // not on it look like four days that are gone. On her phone there is no scrollbar
    // drawn at all until the list is already moving, so the count is the only thing
    // that can tell her the list is longer than it looks.
    if (list.length > SHELF_ROWS) {
      kids.push(el("p", { class: "card-sub", style: "margin:8px 0 0" },
        `Showing the first ${SHELF_ROWS} of your ${list.length} days. Slide the list itself up for the rest.`));
    }
  }

  // And the presses sit BELOW the table, as she asked. The table answers "which
  // day"; these change the shelf rather than one row of it, so they belong under
  // the whole thing rather than over it — where they also stop being the first
  // thing her thumb meets on a card she came to read.
  kids.push(el("div", { class: "tl-ctl", style: "margin-top:12px" },
    el("button", {
      type: "button", class: "tl-chip on",
      onclick: () => {
        const entry = copyScenario(sc, sc.name, sc.id || `s${Date.now().toString(36)}`);
        sc.id = entry.id;
        const at = list.findIndex((x) => x.id === entry.id);
        if (at >= 0) list[at] = entry; else list.push(entry);
        on.persist();
        on.refresh();
        toast(`Saved as "${entry.name}"`);
      },
    }, here ? "Save changes" : "Save this scenario"),
    el("button", {
      type: "button", class: "tl-chip",
      onclick: () => saveAsPopup(sc, state, on, list),
    }, "Save a copy…")));

  // The ready-made days are OFFERED, and the offer names none of them.
  //
  // Her words, 23 September 2026, looking at this card: "why the deleted scenario
  // stil listed?" She was right, and it was here. Each ready-made day used to be
  // offered BY NAME whenever it was missing from her shelf — so deleting one put its
  // name straight back on the card, in the position its saved row had just left and
  // dressed exactly like the rows above it. Measured by deleting "My sister proposal
  // 21/9/2026" from a copy of her own data: the list went
  //
  //   No fridge, 1 person · 24 pans a day · 9 modules
  //   My sister proposal 21/9/2026 · 4 pans a day · 8 modules     <- the one she deleted
  //   One baker day · 24 pans a day · 8 modules
  //
  // and came back as
  //
  //   No fridge, 1 person · 24 pans a day · 9 modules
  //   One baker day · 24 pans a day · 8 modules
  //   ＋ My sister proposal 21/9/2026 · Mix by hand, no chiller    <- her deleted day, still there
  //
  // The day itself was gone from storage both times. What stayed was its name, which
  // on a screen is the same thing. A deleted name is not an offer, it is a leftover.
  //
  // So there is one offer row, it names nothing, and the names live inside what it
  // opens — where they are plainly a menu of days she can add rather than scenarios
  // she already has. Nothing is stored to remember the deletion: a stored "she said
  // no" can be lost by a sync, and a day that has left her shelf simply stops being
  // shouted about by name on that shelf.
  const missingReadyMade = READY_MADE.filter(({ preset }) => !list.some((s) => s.id === preset.id));
  if (missingReadyMade.length) {
    kids.push(el("div", {
      class: "info-row tappable", style: "margin-top:10px",
      onclick: () => addReadyMadePopup(missingReadyMade, state, on, list),
    },
      el("span", { class: "j-what" }, "＋ Add a ready-made day"),
      el("span", { class: "info-val" }, missingReadyMade.length === 1
        ? "One day is set out and ready to open"
        : `${missingReadyMade.length} days are set out and ready to open`)));
  }

  return el("div", {}, el("h2", { class: "section" }, "Your scenarios"), el("div", { class: "card" }, ...kids));
}

// How many days of the shelf are on the card at once. Her words, 23 September
// 2026, on her eighth saved day: "now i had 8 scenario, we have to make the
// secenario just shown 4, the rest shown by slider". With no ceiling the card grew
// a row per day, and a shelf of eight days plus the buttons under it ran past the
// bottom of her phone. The rest of the days are not lost and are not behind
// anything: the list itself slides, which is what a slider is to her.
const SHELF_ROWS = 4;

// The shelf itself: one row a day, the name taking the slack and each number in a
// narrow column of its own so two days are compared down a column rather than read
// as two sentences. Every row is the same height whether or not it is the one open,
// because a table whose rows grow when you pick one makes the whole shelf jump
// under the finger that just tapped it.
//
// The shelf is capped at SHELF_ROWS rows, and the cap is MEASURED after the card is
// on the screen rather than written down here. A day's name wraps to a second line
// when it is long — "My sister proposal 21/9/2026" does at 375px — so the fourth
// row's foot is not the first row's foot plus three, and a number picked here would
// clip half a row off the day at the bottom or leave a sliver of the fifth. Only the
// browser knows where the fourth row ended, so it is asked. The shelf is only
// wrapped when there are more days than rows, so a card with four days or fewer
// carries no scroller, no height and no note, exactly as it does today.
function scenarioShelf(list, sc, state, on) {
  const body = el("tbody");
  for (const s of list) {
    const open = s.id === sc.id;
    const { pansPerDay, modules } = scenarioFacts(s);
    body.appendChild(el("tr", {
      class: `sc-row tappable${open ? " now" : ""}`,
      onclick: () => openScenario(s, state, on),
    },
      // The open day is marked by `.now`, and by nothing in this text: it used to be
      // prefixed with a bullet, which pushed that one name 17px right of the other
      // two and — at 375px, where the name column is the scarce thing — made it the
      // first row to wrap. A mark that costs the width it is marking with is not a
      // mark, it is a second fault.
      el("td", { class: "sc-name" }, s.name || "Untitled"),
      el("td", { class: "num" }, String(pansPerDay)),
      el("td", { class: "num" }, String(modules)),
      // The pencil keeps a cell of its own, and it stops the press reaching the row:
      // opening a day and renaming it are two different intentions, and a tap that
      // did both is how a name gets lost by someone who only meant to look at a day.
      el("td", { class: "sc-edit" },
        el("button", {
          type: "button", class: "tl-chip",
          "aria-label": `Rename or delete ${s.name || "Untitled"}`,
          onclick: (e) => { e.stopPropagation(); editSavedPopup(s, sc, state, on, list); },
        }, "✏️"))));
  }
  const table = el("table", { class: "sc-table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Scenario"),
      // The heading is written over two lines on purpose. At 375px the table has
      // 315px to spend and a heading is the widest thing in its own column by far:
      // "PANS A DAY" on one line claims 91 of those pixels to sit over a two-digit
      // number, and "MODULES" claims 78 to sit over a one-digit one — 170 of the 315
      // spent on two headings, which left the name 92px. Every name she has is wider
      // than that ("No fridge, 1 person" needs 123, "My sister proposal 21/9/2026"
      // 188), so every row wrapped, each to a different number of lines, and the shelf
      // read as three ragged paragraphs rather than a column she can run her eye down.
      // Put over two lines the heading gives its slack back to the name, which is the
      // only column whose content is not one or two digits: measured at 375px the name
      // goes from 92px to 138, both short names come back onto one line, and only the
      // long one wraps — and to two lines rather than three.
      // The space before "a day" is for the page's own text: a `<br>` leaves no
      // character behind, so without it the heading reads "Pansa day" to anything
      // that reads the markup rather than looks at it. A leading space sits at the
      // start of its line and is not drawn, so the two lines are unchanged by it.
      el("th", { class: "num" }, "Pans", el("br"), " a day"),
      el("th", { class: "num" }, "Modules"),
      el("th", { class: "sc-edit" }))),
    body);
  const shelf = el("div", { class: "sc-shelf" }, table);
  on.afterPaint(() => capShelf(shelf, body));
  return shelf;
}

// Hold the shelf to its four rows. The height comes off where the fourth row really
// ended, measured against the shelf's own top so the headings are counted in it —
// they are part of what four rows cost. Nothing is written when the measurement is
// no use (a card not yet laid out answers 0, and a shelf being measured before the
// browser has given it a box must not be given a height of nothing), so the worst
// case of this not running is the shelf she has today rather than a hidden one.
function capShelf(shelf, body) {
  const rows = (body && body.children) || [];
  if (rows.length <= SHELF_ROWS) return;
  const last = rows[SHELF_ROWS - 1];
  const cap = Math.round(last.getBoundingClientRect().bottom - shelf.getBoundingClientRect().top);
  if (!Number.isFinite(cap) || cap <= 0) return;
  shelf.style.maxHeight = `${cap}px`;
}

// The two days that ship with the app, with the one line each is described by. Her
// own day on one pair of hands, the eight modules of the Production line's chain each
// carrying the latest start the card works out from the oven; and the mix-by-hand day
// with no chiller. Kept as a list rather than two blocks of code so the offer row and
// the menu it opens cannot disagree about what can be added.
const READY_MADE = [
  { preset: ONE_BAKER_SCENARIO, blurb: "One pair of hands, set for you" },
  { preset: SISTER_SCENARIO, blurb: "Mix by hand, no chiller" },
];

// What the offer row opens: the ready-made days she does not have, by name. This is
// the only place their names are written down, and it is a menu rather than her shelf,
// so a name here is a day she can add and never a day she has deleted.
function addReadyMadePopup(missing, state, on, list) {
  showPopup("Add a ready-made day", (refresh, close) => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "These come with the app, already worked out. Adding one puts it on your own list, where it is yours to change like any other."),
    ...missing.map(({ preset, blurb }) => el("div", {
      class: "info-row tappable",
      onclick: () => {
        const entry = copyScenario(preset, preset.name, preset.id);
        list.push(entry);
        close();
        openScenario(entry, state, on);
      },
    },
      el("span", { class: "j-what" }, `＋ ${preset.name}`),
      el("span", { class: "info-val" }, blurb)))));
}

function saveAsPopup(sc, state, on, list) {
  showPopup("Save this as…", (refresh, close) => {
    const input = el("input", { class: "input", type: "text", value: String(sc.name || "A new scenario") });
    const save = () => {
      const entry = copyScenario(sc, input.value, `s${Date.now().toString(36)}`);
      list.push(entry);
      // The copy becomes the one she is working on, so "save as" behaves the way
      // it does everywhere else: a new named thing, and you are now in it.
      Object.assign(sc, { id: entry.id, name: entry.name });
      on.persist();
      on.reload();
      toast(`Saved as "${entry.name}" — you are editing that one now`);
      close();
    };
    input.addEventListener("input", () => { sc.name = input.value; });
    return el("div", {},
      el("div", { class: "field" },
        el("label", {}, "What should this copy be called"),
        input,
        el("div", { class: "hint" }, "The scenario you were editing stays saved exactly as it is. This copy is a new one, and you carry on in it.")),
      el("div", { class: "popup-actions" },
        button("Save the copy", save, "primary")));
  });
}

function openScenario(s, state, on) {
  const entry = copyScenario(s, s.name, s.id);
  Object.assign(state.settings.scenario, entry);
  on.persist();
  // The whole screen, not just the answers: the name, the start time and the
  // target are the opened scenario's now, and must not still read as the last
  // one's.
  on.reload();
  toast(`Opened "${entry.name}"`);
}

function editSavedPopup(s, sc, state, on, list) {
  showPopup(s.name || "Untitled", (refresh, close) => {
    const input = el("input", { class: "input", type: "text", value: String(s.name || "") });
    return el("div", {},
      el("div", { class: "field" },
        el("label", {}, "What it is called"),
        input,
        el("div", { class: "hint" }, "Renaming a saved scenario changes only its name — the modules inside are left alone.")),
      el("div", { class: "popup-actions" },
        button("Delete this scenario", () => confirmDialog(
          `Delete the saved scenario "${s.name || "Untitled"}"? The modules you are working on now are not affected.`,
          () => {
            const at = list.findIndex((x) => x.id === s.id);
            if (at >= 0) list.splice(at, 1);
            if (sc.id === s.id) sc.id = "";
            on.persist();
            on.refresh();
            toast("Scenario deleted");
            close();
          },
          { danger: true, yesLabel: "Delete" }), "danger"),
        button("Save the name", () => {
          const at = list.findIndex((x) => x.id === s.id);
          if (at >= 0) list[at] = { ...list[at], name: input.value };
          if (sc.id === s.id) sc.name = input.value;
          on.persist();
          // Renaming the scenario she is in has to reach the name box at the
          // top of the screen, which the answers-only repaint never touched.
          on.reload();
          toast("Renamed");
          close();
        }, "primary")));
  });
}
