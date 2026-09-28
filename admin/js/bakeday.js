// bakeday.js — her bake day as a chain on a clock, solved BACKWARDS.
//
// Pure and DOM-free, so the arithmetic is testable with node --test
// (test/bakeday.test.js). The card in views/production.js draws whatever this
// returns and decides nothing itself.
//
// Why backwards at all, in her words: *"we cannot mix the dough too early, it
// will over fermented."* So every step gets a LATEST start, worked back from the
// moment the pans must be standing at the oven, and the dough is never left
// waiting on her. What she may still do — and asked for — is start a step a
// little early to suit her hands, which is what the window around each start is
// for. Nothing here gates anything: it is a timetable, and she judges the dough
// by eye.
//
// It reads every number through planOf() and takes the hand-work and the proofer
// rhythm from production.js rather than working out its own, so this screen and
// the Production line can never disagree about a figure.

import { PANS_PER_TASK, foldsIn, labourPerPanOf, planOf, proofCycleOf } from "./production.js";
import { clockOf } from "./scenario.js";

// One batch is one oven load, and one tub of dough fills one oven load — which
// is how her kitchen works and why her own figures land on round numbers. If she
// ever makes two oven loads from one tub the mix and the folds spread across
// both, and the per-6-pan steps scale up with the oven.
//
// `hand` says which plan field carries the minutes her HANDS are busy for, which
// is not the same as the minutes the step takes: the proofer holds the dough for
// 45 minutes and asks nothing of her at all.
export const CHAIN = [
  { key: "mix", job: "mix", label: "Mix the dough in the tub", hand: "mixMin" },
  { key: "rest", job: "fold", label: "The rests and the stretch and folds", hand: "foldMin" },
  { key: "pan", job: "scale", label: "Oil the pans and weigh the dough out", hand: "scaleMin6" },
  { key: "proof1", job: "proof", label: "Into the proofer", hand: "", machine: true },
  { key: "dimple", job: "top", label: "Dimple and top", hand: "topMin6" },
  { key: "proof2", job: "proof", label: "Proofer again", hand: "", machine: true },
  { key: "oven", job: "oven", label: "The oven — bake and swap", hand: "swapMin6", machine: true },
  // Past the end of the plan: the 254 minutes stop when the pans come out of the
  // oven, and this is what happens next, so the card can finish the story.
  { key: "cool", job: "cool", label: "Cool, then cut", hand: "coolMin6", beyond: true },
];

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;

// How much bigger one oven load is than the six pans every timed step was
// measured on. 1 at her numbers, and the whole chain is then her own figures.
const batchesPerTub = (p) => (num(p.mixerPans) > 0 ? num(p.mixerPans) : 0);

// The rests and the folds together: four half-hour gaps with a one-minute fold
// inside the first three, so the walls take 123 minutes while her hands are on
// the dough for 3 of them. Exported because the tubs-in-play note needs the same
// figure — a tub is held from the mix until the last fold is done.
export function restMinutesOf(plan) {
  const p = planOf(plan);
  return num(p.foldRests) * num(p.foldRestMin) + foldsIn(p) * num(p.foldMin);
}

// Her hands across a whole six-pan batch. The cooling and cutting is counted
// even though it sits past the end of the 254 minutes: it is still her time, and
// the Production line counts it, so leaving it out here would let the two screens
// drift apart the moment she times it.
const handWorkOf = (steps) => steps.reduce((sum, s) => sum + s.hands, 0);

// The steps of ONE oven load, in the order the day runs them, each with the
// minutes it takes and the minutes of that which are her hands.
//
// A step whose hands are missing is reported as `untimed` rather than counted as
// free — the same rule the Production line follows, because a step with no
// minutes on it is not a step that costs nothing.
export function chainOf(plan) {
  const p = planOf(plan);
  const ovenPans = num(p.ovenPans);
  const perOven = PANS_PER_TASK > 0 ? ovenPans / PANS_PER_TASK : 0; // 1 at her numbers
  const tubPans = batchesPerTub(p);
  const perTub = tubPans > 0 ? ovenPans / tubPans : 0;
  const folds = foldsIn(p);
  const rests = restMinutesOf(p);

  const rows = [
    { key: "mix", minutes: num(p.mixMin) * perTub, hands: num(p.mixMin) * perTub },
    { key: "rest", minutes: rests, hands: folds * num(p.foldMin) * perTub },
    { key: "pan", minutes: num(p.scaleMin6) * perOven, hands: num(p.scaleMin6) * perOven },
    { key: "proof1", minutes: num(p.proofMin1), hands: 0 },
    { key: "dimple", minutes: num(p.topMin6) * perOven, hands: num(p.topMin6) * perOven },
    { key: "proof2", minutes: num(p.proofMin2), hands: 0 },
    { key: "oven", minutes: num(p.ovenMin), hands: num(p.swapMin6) * perOven },
    { key: "cool", minutes: num(p.coolWaitMin), hands: num(p.coolMin6) * perOven },
  ];

  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return CHAIN.map((s) => {
    const r = byKey[s.key];
    const hands = round2(r.hands);
    return {
      key: s.key,
      label: s.label,
      job: s.job,
      machine: !!s.machine,
      beyond: !!s.beyond,
      minutes: round2(r.minutes),
      hands,
      // A machine step asks nothing of her and is not "untimed"; a hand step
      // with no minutes on it is, and gets named.
      untimed: !s.machine && hands <= 0,
    };
  });
}

// The whole answer: the chain, where it has to start, how many batches a day is,
// what she asked the rhythm to be against what the line will actually give, and
// which of her limits is the one holding it.
export function planBackwards(plan) {
  const p = planOf(plan);
  const steps = chainOf(p);
  const readyAtMin = num(p.readyAtMin);
  const tolMin = num(p.tolMin);

  const ovenIdx = steps.findIndex((s) => s.key === "oven");

  // The oven's own START is the anchor: she wants the pans standing at it at
  // readyAtMin, and the bake and the swap together run from there — so at her
  // numbers the pans are ready at 4:00, out at 4:13 and unloaded at 4:15, which
  // is the example she worked herself.
  steps[ovenIdx].latestStart = readyAtMin;
  steps[ovenIdx].latestEnd = readyAtMin + steps[ovenIdx].minutes;

  // Walk BACKWARDS from there: each earlier step's latest start is the one after
  // it, minus the minutes it takes, so the first step can never be earlier than
  // the dough can stand. That is the whole point of the release.
  let cursor = steps[ovenIdx].latestStart;
  for (let i = ovenIdx - 1; i >= 0; i -= 1) {
    steps[i].latestEnd = cursor;
    steps[i].latestStart = cursor - steps[i].minutes;
    cursor = steps[i].latestStart;
  }
  // Everything after the oven sits after it, in clock order.
  let after = steps[ovenIdx].latestEnd;
  for (let i = ovenIdx + 1; i < steps.length; i += 1) {
    steps[i].latestStart = after;
    steps[i].latestEnd = after + steps[i].minutes;
    after = steps[i].latestEnd;
  }

  for (const s of steps) {
    s.clock = clockOf(s.latestStart);
    s.endsAt = clockOf(s.latestEnd);
    // The band she is allowed to be early in: from the latest start back by the
    // tolerance. A field, not a constant, so she can widen or close it.
    s.window = { early: s.latestStart - tolMin, late: s.latestStart };
    s.earlyClock = clockOf(s.window.early);
  }

  const mixStartMin = steps[0].latestStart;
  const spanMin = steps[ovenIdx].latestEnd - mixStartMin;

  const ovenPans = Math.max(1, num(p.ovenPans));
  const batches = Math.max(1, Math.ceil(num(p.target) / ovenPans));

  const limits = dayLimits(p);
  const allowed = limits.length ? limits[0].perBatch : Infinity;
  const binds = limits.length ? limits[0].key : "";

  // Her hands for one six-pan batch, the cooling and cutting included — the same
  // figure the Production line counts, and a test asserts the two agree.
  const handWork = round2(handWorkOf(steps));

  return {
    plan: p,
    steps,
    readyAtMin,
    mixStartMin,
    readyClock: clockOf(readyAtMin),
    mixClock: clockOf(mixStartMin),
    spanMin,
    ovenAt: readyAtMin,
    unloadedAt: readyAtMin + num(p.ovenMin),
    batches,
    batchPans: ovenPans,
    handWork,
    handWorkPerPan: round2(labourPerPanOf(p)),
    // What she asked for against what the line will give her. `beats` is the
    // honest answer to "can I have one every 15 minutes" without pretending the
    // answer is yes when her own hands are the wall.
    rhythm: {
      asked: num(p.rhythmMin),
      allowed,
      binds,
      beats: Number.isFinite(allowed) ? allowed <= num(p.rhythmMin) : true,
    },
    limits,
    notes: { tubs: tubsInPlay(p, allowed) },
    // Every batch's mix start and the moment it is standing at the oven, so the
    // card can lay the day out rather than only its first batch.
    batchPlan: batchPlan(p, mixStartMin, allowed, batches),
    untimed: steps.filter((s) => s.untimed).map((s) => s.label),
  };
}

// A day's batches: the first mix starts where the backwards plan puts it, and
// each one after that starts by the line's own rhythm — which may be slower than
// she asked for, because the line decides, not the request.
function batchPlan(p, mixStartMin, allowed, batches) {
  const gap = Number.isFinite(allowed) ? allowed : 0;
  const out = [];
  for (let n = 1; n <= batches; n += 1) {
    const mix = mixStartMin + (n - 1) * gap;
    const ready = num(p.readyAtMin) + (n - 1) * gap;
    out.push({ n, mixStart: mix, readyAt: ready, mixClock: clockOf(mix), readyClock: clockOf(ready) });
  }
  return out;
}

// The three things that can hold a batch back, in MINUTES BETWEEN BATCHES, which
// is the unit she already thinks in — she worked the proofer's 40.5 out herself.
// The biggest one is the wall; the rest are the ones waiting behind it.
//
// This is the same fact as the Production line's bottleneck, read the other way
// up: a station that does fewer pans an hour means more minutes between batches.
// test/bakeday.test.js asserts the two agree, so the two screens cannot drift.
export function dayLimits(plan) {
  const p = planOf(plan);
  const ovenPans = Math.max(1, num(p.ovenPans));
  const people = Math.max(1, num(p.people));

  const steps = chainOf(p);
  const handWork = handWorkOf(steps);
  const hands = people > 0 ? handWork / people : Infinity;

  // A batch is in the cabinet for the whole proof, the dimple between the two
  // halves included — she dimples a pan at a time, so the cabinet is never
  // emptied and the full cycle stands. The cabinet holds prooferPans, which is
  // however many batches at once.
  const perProof = proofCycleOf(p);
  const cabinets = num(p.prooferPans) / ovenPans;
  const proofer = cabinets > 0 ? perProof / cabinets : Infinity;

  const oven = num(p.ovenMin);

  return [
    {
      key: "hands", label: "Your hands", perBatch: hands,
      detail: `${round2(handWork)} min of hand-work for ${ovenPans} pans, over ${people} ${people === 1 ? "pair of hands" : "pairs of hands"}`,
    },
    {
      key: "proofer", label: "The proofer", perBatch: proofer,
      detail: `${num(p.prooferPans)} pans held for ${round2(perProof)} min — a batch every ${round2(proofer)} min and no faster`,
    },
    {
      key: "oven", label: "The oven", perBatch: oven,
      detail: `${ovenPans} pans every ${round2(oven)} min`,
    },
  ]
    .filter((l) => Number.isFinite(l.perBatch) && l.perBatch > 0)
    .sort((a, b) => (b.perBatch - a.perBatch) || a.label.localeCompare(b.label));
}

// How many tubs are in play at once: a tub is held from the moment the mix
// starts until the last fold is done, and a new one has to start every time the
// line lets a batch through. She buys four of these, and this is the number that
// says whether that is enough.
function tubsInPlay(p, allowed) {
  const held = num(p.mixMin) + restMinutesOf(p);
  if (!(allowed > 0) || !(held > 0)) return 0;
  return Math.ceil(held / allowed);
}

// A step's clock as "7:01 am" — here so a caller does not have to reach into
// scenario.js for the one thing this module borrows.
export { clockOf };
