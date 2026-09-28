// views/production.js — the production line, as a board (23 Sep 2026).
//
// Her words: "can we simplify the productioon portion, it ask for alot of key in",
// and then "maybe one function for production line, 1. copy the chart into Prodcution
// line, but should not be editable, it become a dashboard for worker, give the worker
// good inform of what next for them, how long, and others, you can be creeative".
//
// So the screen is the day chart itself, brought over READ-ONLY from the Scenario
// planner — the same code that draws the planner (views/scenario.js's renderBoard),
// because two renderers of one day drift apart and this app's rule is that two
// screens may not disagree about the same day. Over it sits a strip saying what each
// person is on now and what comes next, in clock times.
//
// Seventeen of the twenty-one boxes this screen used to ask her for are gone. Nine of
// them are read off her planner day (see derivedPlan), four are left as hers, and the
// eight the backwards timetable works from are folded away under it. All the
// arithmetic is still in js/production.js — this screen only draws it.

import { el } from "../ui.js";
import { save } from "../state.js";
import { computeLine, proofCycleOf, trim } from "../production.js";
import { planBackwards } from "../bakeday.js";
import { clockOf, scenarioPlanPatch } from "../scenario.js";
// The day chart, from the file that draws the planner's own. Two renderers of one day
// would drift, and this app's rule is that two screens may not disagree about it.
import { renderBoard } from "./scenario.js";

// ── The four numbers that are only hers ────────────────────────────────────
//
// A scenario is a day laid out in time and it holds nothing about the line's own
// size: it does not know how many pans she owns, how long she is willing to stand at
// it, or how big her proofer is. Those four are what is left to type, and each one
// names its own unit — a field that says "Minutes" and leaves her to guess whether
// that means for one pan, for six, or for a whole tub is a field she cannot fill in
// with confidence.
const LINE_FIELDS = [
  { key: "hours", label: "Hours you'll bake for", step: 0.5,
    hint: "How long you're willing to stand at it on a delivery day." },
  { key: "pans", label: "Baking pans you own", step: 1 },
  { key: "prooferPans", label: "Pans your proofer holds at once", step: 1,
    hint: "The ceiling on your day, and it is the one you worked out yourself: a batch is in the cabinet for 81 minutes, so 12 pans means one batch every 40.5 minutes and no faster. Count the shelves honestly — if it holds 18, type 18 and everything below changes." },
  { key: "rhythmMin", label: "Minutes between batches you would like", step: 1,
    hint: "Fifteen for you — the length of one oven turn, so a fresh batch is ready each time the oven comes free. The timetable below will tell you honestly whether the line can give you that." },
];

// ── The eight the timetable is built from ──────────────────────────────────
//
// Kept, and folded, rather than dropped with the rest. Two reasons, and both stand:
// the timetable IS worker information — it is the latest a stage may start, which is
// what somebody standing at the bench needs — and these eight numbers are read by
// nothing else in the app. Dropping the card would leave them unreachable and the
// whole of js/bakeday.js dead code beside it.
//
// The fold and proof numbers are deliberately NOT read off the scenario. The
// translation does not line up: her planner's fold module is one 28-minute pass with
// a 2-minute fold at the end of it, against the plan's "four rests of thirty and a
// fold of one", and the planner reports that module as one it cannot map for exactly
// that reason. Until a release can derive them and prove it, they stay hers.
const TIME_FIELDS = [
  { key: "foldRests", label: "How many rests the dough takes", step: 1,
    hint: "How many times the dough sits before it goes into the pans — four, in your day." },
  { key: "foldRestMin", label: "Minutes each rest lasts", step: 1,
    hint: "Thirty minutes a rest for you." },
  { key: "foldMin", label: "Minutes one stretch and fold takes", step: 1,
    hint: "One minute for you. The last rest is a rest and nothing else, so a day with four rests carries three folds." },
  { key: "proofMin1", label: "Minutes in the proofer before the dimple", step: 1,
    hint: "Forty-five for you." },
  { key: "proofMin2", label: "Minutes in the proofer after the dimple", step: 1,
    hint: "Thirty for you. This is the second half of the 81 the cabinet holds a batch for." },
  { key: "coolWaitMin", label: "Minutes the baked pans cool before they are cut", step: 1,
    hint: "Thirty for you. This is waiting time, not hand-work — it sits after the 254 minutes, not inside them." },
  { key: "readyAtMin", label: "Minutes after midnight the first 6 pans must be at the oven", step: 15,
    clock: true,
    hint: "480 is 8:00 am. Set the clock you want the first batch standing at the oven, and every start time below is worked back from it — which is how the dough is kept from being mixed too early." },
  { key: "tolMin", label: "Minutes earlier than a start time that are still fine", step: 1,
    hint: "Five for you. This is the soft band around each start — a stage may begin this much early without the dough suffering, which is where you can shuffle work to suit your own hands." },
];

// Module scope, so a fresh visit starts folded — the house pattern (views/deliveries.js,
// views/products.js). Both cards are shut because the BOARD is what the screen is for;
// these are the numbers and the timetable behind it.
const LINE_FOLD = { open: false };
const TIME_FOLD = { open: false };

export function renderProduction(root, state) {
  const plan = state.settings.production || (state.settings.production = {});

  // The board draws into the view itself, exactly as the planner does, and hands back
  // the teardown that stops its clock. It is drawn FIRST and the two cards are appended
  // after it: the board measures its own windows while it draws, and appending below it
  // afterwards is what keeps those measurements taken against the screen they are on.
  const teardown = renderBoard(root, state);

  const lineAns = el("div", {});
  const timeAns = el("div", {});
  // Only the answers are repainted when a number changes — never the inputs — so the
  // box she is typing in keeps its place and its cursor.
  const paint = () => {
    lineAns.replaceChildren(capacityAnswer(state, plan));
    timeAns.replaceChildren(timetableAnswer(state, plan));
  };
  const onEdit = (key, raw) => { writeField(plan, state, key, raw); paint(); };
  paint();

  root.append(
    foldCard("The line behind this day", LINE_FOLD, lineAns,
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Everything else this screen needs — how many pairs of hands, the pans a tub makes, oiling and weighing out, the dimple, the packing, the oven and the bake-and-swap — is read off the day you built under More → Scenario planner. Asked once and answered on both screens, so the two can never disagree about it."),
      ...LINE_FIELDS.map((f) => fieldRow(f, plan, onEdit))),
    // The timetable is behind its own fold, and the answer div is its first child so a
    // number typed below it repaints the times without rebuilding the box she is in.
    // Shut, this card costs the screen nothing but its own head — which is the whole
    // reason to fold it: it is planning advice ("the last moment I may mix"), and the
    // board above is what a worker opens this screen to read.
    foldCard("The last moment each stage may start", TIME_FOLD, null,
      timeAns,
      ...TIME_FIELDS.map((f) => fieldRow(f, plan, onEdit))));

  return teardown;
}

// What a field writes. A cleared box is mid-typing, not a request for zero pans, so
// the last good number is held rather than a 0 the whole screen would have to explain.
function writeField(plan, state, key, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return;
  plan[key] = n;
  save(state);
}

// ── The day she has built, read as a plan for this line ────────────────────
//
// READ, never written. `scenarioPlanPatch` hands back a patch, this spreads it into a
// throwaway object, and `planOf` (production.js) returns an explicit literal of its own
// named keys — so there is no path from here back into her stored scenario or her
// stored plan. A stage a scenario says nothing about is left out of the patch entirely,
// so her own stored number stands rather than falling to zero.
//
// Gated on the scenario having modules of its own, and that gate is the whole safety of
// it: `scenarioOf({})` answers a scenario with nothing in it with the whole
// DEFAULT_SCENARIO, and the planner seeds an empty one from that default the first time
// it is opened. Deriving without the gate would quietly move her line onto a template
// she never built. With no day of her own, her own four numbers plus her stored plan
// are the whole of the answer — which is exactly how this screen read before.
function derivedPlan(state, plan) {
  const sc = state.settings.scenario;
  if (!sc || !Array.isArray(sc.modules) || !sc.modules.length) return plan;
  return { ...plan, ...scenarioPlanPatch(sc, plan).patch };
}

// The one line worth reading without opening anything: what the day can deliver, and
// the single thing holding it back. Computed from the same computeLine() every other
// answer on this screen comes from, so it cannot contradict the timetable below it.
function capacityAnswer(state, plan) {
  const r = computeLine(derivedPlan(state, plan));
  const why = bottleneckWhy(r);
  return el("div", {},
    el("p", { style: "margin:0" },
      el("b", {}, `${r.dayCapacity} ${r.dayCapacity === 1 ? "pan" : "pans"} today`),
      ` · ${lower(r.bottleneck.name)} ${be(r.bottleneck)} the wall that holds it back.`),
    why ? el("p", { class: "card-sub", style: "margin:6px 0 0" }, why) : null);
}

// ── Your day, backwards ────────────────────────────────────────────────────
// The one thing the rest of this screen cannot answer. The flow settles what happens
// in what order; this settles when each stage has to START, and it is worked back from
// the oven because that is the only direction a start time can be told the truth from.
//
// Mixed too early and the dough over-ferments — her own sentence, and the whole reason
// this card exists. So every stage gets a latest start and a soft band of minutes
// before it that are still fine, which is where she can shuffle work to suit her own
// hands.
//
// It gates nothing and it changes nothing. Every time here is advice; the dough is
// judged by eye, and the card says so on the screen rather than leaving her to
// remember it.
function timetableAnswer(state, plan) {
  const b = planBackwards(derivedPlan(state, plan));
  const worst = b.limits.length ? b.limits[0] : null;

  const kids = [
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `Every time below is the last moment that stage may start, so no dough is ever mixed before it is needed. It is a timetable, not a clock — you watch the dough and judge it by eye, and any stage may start up to ${trim(b.plan.tolMin)} ${b.plan.tolMin === 1 ? "minute" : "minutes"} early to suit your hands.`),
  ];

  // The anchor, then the answer that falls out of it: a time to put the dough in the tub.
  kids.push(el("p", { style: "margin:0 0 10px" },
    `For the first ${trim(b.batchPans)} pans to be standing at the oven at `,
    el("b", {}, b.readyClock),
    `, the dough goes into the tub at `,
    el("b", {}, b.mixClock),
    ` — ${trim(b.readyAtMin - b.mixStartMin)} minutes before.`));

  kids.push(el("div", { class: "job-list" }, ...b.steps.map(backwardsStep)));

  kids.push(el("p", { class: "card-sub", style: "margin:10px 0 0" },
    `One batch is ${trim(b.spanMin)} minutes from the tub to out of the oven, and ${trim(b.handWork)} of those minutes are your hands.`));

  // The three limits, each with its own unit, and the one that decides the day.
  if (worst) {
    kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
      "Minutes a batch, at their own pace: ",
      `${listWords(b.limits.map((l) => `${lower(l.label)} ${trim(l.perBatch)} min`))}. `,
      `The longest sets the day, and that is ${lower(worst.label)}.`));
  }

  // What she asked the rhythm to be against what the line will actually give — the
  // honest answer, because a timetable that pretended otherwise would have her starting
  // tubs the oven cannot take.
  kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
    b.rhythm.beats
      ? `You wanted a batch every ${trim(b.rhythm.asked)} min, and the line can keep to that.`
      : `You wanted a batch every ${trim(b.rhythm.asked)} min. The line gives you one every ${trim(b.rhythm.allowed)} min, and not faster.`));

  if (b.batches > 1) {
    const last = b.batchPlan[b.batchPlan.length - 1];
    kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
      `A ${trim(b.plan.target)}-pan day is ${b.batches} batches, so the last tub goes in at ${last.mixClock} and that batch is at the oven at ${last.readyClock}.`));
  }

  if (b.notes.tubs > 0) {
    kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
      `That holds ${b.notes.tubs} ${b.notes.tubs === 1 ? "tub" : "tubs"} at once — a tub is busy from the mixing until the last fold is done.`));
  }

  // A stage with no minutes on it is not part of the 254, and saying so here is the
  // difference between a timetable and a promise.
  if (b.untimed.length) {
    kids.push(el("p", { class: "card-sub", style: "margin:6px 0 0" },
      `${listWords(b.untimed.map(lower))} ${b.untimed.length === 1 ? "is" : "are"} not timed yet, so ${b.untimed.length === 1 ? "it is" : "they are"} not counted in those ${trim(b.spanMin)} minutes.`));
  }

  return el("div", {}, ...kids);
}

// One stage of the clock: its latest start on the right, and underneath the minutes it
// takes, how many of them are her hands, and how early it may begin.
function backwardsStep(s) {
  const bits = [`${trim(s.minutes)} min`];
  if (s.hands > 0) bits.push(`${trim(s.hands)} min of your hands`);
  else if (s.machine) bits.push("no hands — the machine works");
  if (s.beyond) bits.push("after the bake, outside the 254 minutes");
  if (s.window && s.window.early !== s.window.late) bits.push(`earliest ${s.earlyClock}`);

  return el("div", {},
    el("div", { class: "info-row journal-line" },
      el("span", { class: "j-what" }, s.label),
      el("span", { class: "info-val" }, s.clock)),
    el("div", { class: "li-sub", style: "margin:-2px 0 6px" }, bits.join(" · ")));
}

// Why *that* is the slow one, in the one comparison that makes it obvious. The same
// sentence the planner's own wall uses, because one day cannot have two explanations.
function bottleneckWhy(r) {
  const p = r.plan;
  if (r.bottleneck.key === "proofer") {
    return `A batch is in the cabinet for the whole ${trim(proofCycleOf(p))} minutes — both proofs with the dimple between them — and the cabinet holds ${trim(p.prooferPans)} pans. Nothing else you change can push past that.`;
  }
  if (r.bottleneck.key === "hands") {
    return `That is ${trim(r.labourPerPan)} minutes of hand-work for every pan, shared between ${trim(p.people)} ${p.people === 1 ? "pair of hands" : "pairs of hands"}.`;
  }
  if (r.bottleneck.key === "oven") {
    return `The oven bakes ${trim(p.ovenPans)} pans every ${trim(p.ovenMin)} minutes, and only one bake fits at a time.`;
  }
  if (r.bottleneck.key === "pans") {
    return `${trim(p.pans)} pans is not many to keep turning over — oiling the pans and weighing the dough out waits on pans coming back out of the oven.`;
  }
  return "";
}

// ── The fold ───────────────────────────────────────────────────────────────
// The app's own fold chrome (admin/css/app.css, .fold-head/.fold-caret/.fold-body), with
// one addition: an `answers` element may sit between the head and the body rather than
// inside it, so the number the card is FOR is readable while the card is shut. What she
// has to type is always behind the fold; an answer is out on the screen only where it is
// a line worth reading at a glance — the line card's capacity, and nothing else. The
// timetable passes `null` here and puts its answer inside the body instead: it is a page
// of advice, not a glance, and a shut card that already showed a page of it would be a
// caret saying "there is more" over the whole of what there is.
//
// Opened and closed IN PLACE, never by redrawing the screen: the board above keeps a
// live clock and a scroll that is hers, and a rebuild is exactly what throws those
// away. The flag is the module's, so the next visit starts folded again.
function foldCard(title, flag, answers, ...bodyKids) {
  const caret = el("span", { class: "fold-caret" }, flag.open ? "▾" : "▸");
  const body = el("div", { class: "fold-body", hidden: !flag.open }, ...bodyKids);
  const head = el("button", { class: "fold-head", type: "button",
    onclick: () => {
      flag.open = !flag.open;
      body.hidden = !flag.open;
      caret.textContent = flag.open ? "▾" : "▸";
    } },
    el("span", {}, title),
    caret);
  return el("div", { class: "card" }, head, answers, body);
}

function fieldRow(f, plan, onEdit) {
  const input = el("input", {
    class: "input", type: "number", inputmode: "decimal",
    min: "1", step: String(f.step || 1),
    value: plan[f.key] == null ? "" : String(plan[f.key]),
  });
  // One field is a time of day, and asking her to work out that 480 means 8:00 am every
  // time she wants to move it would be the screen making its own arithmetic her problem.
  // The clock is written back underneath as she types — the field itself is never
  // rebuilt, so her cursor and her keypad stay where they are.
  let clock = null;
  if (f.clock) {
    clock = el("div", { class: "li-sub" }, clockReadout(input.value));
  }
  input.addEventListener("input", () => {
    if (clock) clock.textContent = clockReadout(input.value);
    onEdit(f.key, input.value);
  });
  return el("div", { class: "field" },
    el("label", {}, f.label),
    input,
    clock,
    f.hint ? el("div", { class: "hint" }, f.hint) : null);
}

function clockReadout(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? `That is ${clockOf(n)}.` : "";
}

// "a, b and c" — so a sentence naming three stages still reads as a sentence.
function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function lower(s) {
  return String(s || "").charAt(0).toLowerCase() + String(s || "").slice(1);
}

// Two of the stations are plural — "Your hands", "Your pans" — so a sentence that reads
// perfectly for the proofer ("the proofer is what sets the pace") comes out wrong for
// them. The model marks which is which and this helper agrees with it.
const be = (st) => (st && st.plural ? "are" : "is");
