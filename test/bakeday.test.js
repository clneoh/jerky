// Her bake day, solved backwards.
//
// Every figure in this file is hers and was worked out by hand before any of
// this was written — she corrected her own step order on 2026-09-22 and derived
// the proofer's 40.5 minutes a batch herself. If this file ever disagrees with
// those, the screen is telling her something she did not say.
//
// The release's whole claim is that the app reproduces her own arithmetic from
// her own fields, so the arithmetic is asserted here rather than eyeballed: the
// chain sums to 254, ready-at-the-oven is 239, her hands carry 46 minutes of a
// six-pan batch, and the proofer gives one every 40.5 minutes at 12 pans.
//
// The last test is the one that keeps two screens honest: `dayLimits` reads the
// same limits as the Production line's stations, from the other end of the
// fraction, so the two can never drift apart.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHAIN, chainOf, dayLimits, planBackwards, restMinutesOf,
} from "../admin/js/bakeday.js";
import { DEFAULT_PLAN, computeLine, labourPerPanOf, proofCycleOf } from "../admin/js/production.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} (got ${a})`);
const stepOf = (r, key) => r.steps.find((s) => s.key === key);
// The plan as one pair of hands, which is how she works today.
const alone = (extra = {}) => ({ ...DEFAULT_PLAN, people: 1, ...extra });

test("her chain is 254 minutes, and every step is her own figure", () => {
  const steps = chainOf(DEFAULT_PLAN);
  const at = (key) => stepOf({ steps }, key);

  assert.deepEqual(steps.map((s) => s.key),
    ["mix", "rest", "pan", "proof1", "dimple", "proof2", "oven", "cool"],
    "the order she corrected it to, mix first and the proofer twice");

  assert.equal(at("mix").minutes, 20, "twenty minutes mixing in the tub");
  assert.equal(at("rest").minutes, 123, "four half-hours with a one-minute fold inside the first three");
  assert.equal(at("pan").minutes, 15, "oiling the pans and weighing the dough out");
  assert.equal(at("proof1").minutes, 45, "the first proof");
  assert.equal(at("dimple").minutes, 6, "a minute a pan");
  assert.equal(at("proof2").minutes, 30, "the second proof");
  assert.equal(at("oven").minutes, 15, "bake and swap together, one turn of the oven");
  assert.equal(at("cool").minutes, 30, "and the cooling that follows it");

  near(restMinutesOf(DEFAULT_PLAN), 123, "the rests and the folds, the same figure the chain uses");
  near(proofCycleOf(DEFAULT_PLAN), 81, "a batch is in the proofer for the whole 81 minutes");
});

test("the chain sums to 254, and 239 of them are before the oven", () => {
  const r = planBackwards(DEFAULT_PLAN);
  const toOven = r.steps.filter((s) => !s.beyond).reduce((sum, s) => sum + s.minutes, 0);

  near(toOven, 254, "mix to unloaded is her own 254 minutes");
  near(r.spanMin, 254, "and the plan says the same thing");
  near(r.readyAtMin - r.mixStartMin, 239, "ready at the oven 239 minutes after the mix starts");
  near(stepOf(r, "mix").latestStart, r.readyAtMin - 239, "which is the number the whole plan hangs on");
});

test("her hands carry 46 minutes of a six-pan batch, and the proofer asks for none of them", () => {
  const r = planBackwards(DEFAULT_PLAN);
  near(r.handWork, 46, "twenty mixing, three folding, fifteen oiling, six dimpling, two swapping");
  near(r.handWork, labourPerPanOf(DEFAULT_PLAN) * DEFAULT_PLAN.ovenPans,
    "the chain's own sum and the Production line's per-pan figure are the same number");

  const stepOf2 = (key) => stepOf(r, key);
  assert.equal(stepOf2("mix").hands, 20, "the mix is all hers");
  assert.equal(stepOf2("rest").hands, 3, "only the three one-minute folds — the half-hours are the dough's");
  assert.equal(stepOf2("pan").hands, 15, "the oiling and weighing is hers");
  assert.equal(stepOf2("proof1").hands, 0, "a machine step asks nothing of her");
  assert.equal(stepOf2("proof2").hands, 0, "and neither does the second proof");
  assert.equal(stepOf2("dimple").hands, 6, "a minute a pan is hers");
  assert.equal(stepOf2("oven").hands, 2, "the swap is hers, the baking is not");
});

test("the clocks march backwards from the oven, and each step ends when the next begins", () => {
  const r = planBackwards(alone({ readyAtMin: 480 }));
  assert.equal(r.readyClock, "8:00 am", "the anchor is the minute the pans must be at the oven");
  assert.equal(r.mixClock, "4:01 am", "so a day ready at 8 starts mixing at 4:01, which is what she asked to be told");

  const inPlan = r.steps.filter((s) => !s.beyond);
  for (let i = 1; i < inPlan.length; i += 1) {
    assert.equal(inPlan[i].latestStart, inPlan[i - 1].latestEnd,
      `${inPlan[i].key} must start exactly when ${inPlan[i - 1].key} ends — the chain has no gaps`);
  }
  assert.equal(stepOf(r, "oven").latestStart, 480, "the oven turn starts at the anchor");
  assert.equal(stepOf(r, "oven").latestEnd, 495, "and runs the 15 minutes of bake and swap from there");
  assert.equal(stepOf(r, "cool").latestStart, 495, "so the cooling sits after the oven, not before it");
});

test("the window is a soft five minutes early, and it is a field she can widen", () => {
  const r = planBackwards(alone({ readyAtMin: 480, tolMin: 5 }));
  const pan = stepOf(r, "pan");
  assert.equal(pan.window.late, pan.latestStart, "the latest start is the edge of the window");
  assert.equal(pan.window.late - pan.window.early, 5, "and it opens five minutes earlier than that");

  const wide = planBackwards(alone({ readyAtMin: 480, tolMin: 20 }));
  assert.equal(stepOf(wide, "pan").window.late - stepOf(wide, "pan").window.early, 20,
    "widen the field and the band widens with it — nothing is hard-coded");
});

test("her own limits, biggest first, and the proofer is her 40.5", () => {
  const limits = dayLimits(alone());
  assert.deepEqual(limits.map((l) => l.key), ["hands", "proofer", "oven"],
    "ranked by the minutes each takes to let a batch through, slowest first");
  near(limits[0].perBatch, 46, "one pair of hands takes 46 minutes a batch");
  near(limits[1].perBatch, 40.5, "12 pans held for 81 minutes is a batch every 40.5 — her own figure");
  near(limits[2].perBatch, 15, "the oven is the quick one");

  const r = planBackwards(alone());
  assert.equal(r.rhythm.binds, "hands", "so her own hands are the wall today, as she found");
  assert.equal(r.rhythm.asked, 15, "she asked for a batch every 15 minutes");
  assert.equal(r.rhythm.beats, false, "and the honest answer is no");
});

test("an 18-pan proofer moves the wall back onto her hands", () => {
  // She is checking her cabinet's pan count — if it holds 18 the rhythm shortens
  // to 27, which is still behind her 46, so the wall does not move and buying one
  // buys her nothing while she is alone. The field answers it either way.
  const proofer = dayLimits(alone({ prooferPans: 18 })).find((l) => l.key === "proofer");
  near(proofer.perBatch, 27, "18 pans is a batch every 27 minutes");
  const r = planBackwards(alone({ prooferPans: 18 }));
  assert.equal(r.rhythm.binds, "hands", "and her hands at 46 are still the slower of the two");
  assert.equal(r.rhythm.allowed, 46, "so the day does not go any faster");
});

test("a second pair of hands hands the wall to the proofer", () => {
  const two = dayLimits({ ...DEFAULT_PLAN, people: 2 });
  near(two.find((l) => l.key === "hands").perBatch, 23,
    "the same 46 minutes of work split over two pairs of hands");
  assert.equal(two[0].key, "proofer", "so the proofer at 40.5 is now the slower of the two");
  const r = planBackwards({ ...DEFAULT_PLAN, people: 2 });
  assert.equal(r.rhythm.binds, "proofer", "her own finding, from the other direction");
});

test("a day's batches start on the line's own rhythm, not the one she asked for", () => {
  const r = planBackwards(alone({ target: 60, readyAtMin: 480 }));
  assert.equal(r.batches, 10, "sixty pans of six to an oven load is ten batches");
  assert.equal(r.batchPlan.length, 10, "and every one of them is laid out");
  assert.equal(r.batchPlan[0].mixStart, r.mixStartMin, "the first mix starts where the plan puts it");
  near(r.batchPlan[1].mixStart - r.batchPlan[0].mixStart, 46,
    "each one after it starts 46 minutes later — the line's pace, not the 15 she asked for");

  const big = planBackwards(alone({ target: 12, readyAtMin: 480 }));
  assert.equal(big.batches, 2, "a small day is fewer batches");
});

test("an untimed step is named, never counted as free", () => {
  const r = planBackwards(DEFAULT_PLAN);
  assert.deepEqual(r.untimed, ["Cool, then cut"],
    "the cooling and cutting has no minutes on it, so it says so instead of costing nothing");
  near(r.handWork, 46, "and it adds nothing to her hands until she times it");

  const timed = planBackwards(alone({ coolMin6: 12 }));
  assert.deepEqual(timed.untimed, [], "time it and the note goes away");
  near(timed.handWork, 58, "twelve minutes of cutting and packing for six pans is twelve more of her time");
});

test("the limit she is not close to is still named, so an idle oven is visible", () => {
  const limits = dayLimits(alone());
  const oven = limits.find((l) => l.key === "oven");
  assert.equal(oven.perBatch, 15, "the oven lets a batch through every fifteen minutes");
  assert.match(oven.detail, /6 pans every 15 min/, "and says so in her units");
  const proofer = limits.find((l) => l.key === "proofer");
  assert.match(proofer.detail, /12 pans held for 81 min/, "the proofer names its pan count and its minutes");
});

test("four tubs is exactly enough, because a tub is held for 143 minutes", () => {
  // A tub is held from the moment the mix starts until the last fold is done —
  // her 20-minute mix and the 123 minutes of rests, 143 in all. At one batch
  // every 46 minutes that is 3.1 tubs in play at once, so the four she has cover
  // it, which is the answer she wanted from this number.
  const one = planBackwards(alone());
  assert.equal(one.notes.tubs, 4, "143 minutes of holding, a batch every 46");

  const two = planBackwards({ ...DEFAULT_PLAN, people: 2 });
  assert.equal(two.notes.tubs, 4,
    "and with help the proofer paces it at 40.5, which still fits inside four tubs");
});

test("the two screens cannot disagree: dayLimits is the Production line read backwards", () => {
  // The Production line measures a station in pans an hour; this measures the
  // same station in minutes between batches. They are reciprocals of one another,
  // so this asserts the one fact that keeps both screens honest — delete this and
  // the release loses its guarantee.
  const pairs = [
    { plan: alone(), prooferPans: 12 },
    { plan: alone({ prooferPans: 18 }), prooferPans: 18 },
    { plan: { ...DEFAULT_PLAN, people: 2 }, prooferPans: 12 },
    { plan: alone({ ovenMin: 20 }), prooferPans: 12 },
  ];
  for (const { plan, prooferPans } of pairs) {
    const limits = dayLimits(plan);
    const line = computeLine(plan);
    const rateOf = (key) => line.stations.find((s) => s.key === key).rate;
    const pans = Math.max(1, Number(plan.ovenPans) || 6);
    const label = `at prooferPans ${prooferPans}, people ${plan.people ?? 1}`;

    const byRate = (key) => (60 * pans) / rateOf(key);
    const limitOf = (key) => limits.find((l) => l.key === key).perBatch;

    near(limitOf("proofer"), byRate("proofer"), `${label}: the proofer's minutes a batch`);
    near(limitOf("oven"), byRate("oven"), `${label}: the oven's minutes a batch`);
    if (rateOf("hands") > 0) {
      near(limitOf("hands"), byRate("hands"), `${label}: the hands' minutes a batch`);
    }
    // And the wall is the same station said both ways round: the slowest station
    // is the longest wait between batches.
    assert.equal(line.bottleneck.key, limits[0].key, `${label}: the same station is the wall`);
  }
});

test("the chain it draws is hers, step for step", () => {
  assert.deepEqual(CHAIN.map((s) => s.job),
    ["mix", "fold", "scale", "proof", "top", "proof", "oven", "cool"],
    "the jobs each step belongs to, in the order the day runs them");
  assert.equal(CHAIN.filter((s) => s.job === "proof").length, 2,
    "the proofer is drawn twice — the dimple sits between the two proofs");
  assert.deepEqual(CHAIN.filter((s) => s.machine).map((s) => s.key), ["proof1", "proof2", "oven"],
    "only the proofer and the oven hold the dough without her");
  assert.deepEqual(CHAIN.filter((s) => s.beyond).map((s) => s.key), ["cool"],
    "and the cooling is the one step past the end of the 254 minutes");
});
