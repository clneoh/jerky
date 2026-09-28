// The production line model. The figures asserted here are the ones the whole
// screen rests on, and every one of them is hers — the hand-work and the proofer
// rhythm were both worked out by hand before any of this was written.
//
// Her own numbers, in her own units: 46 minutes of hand-work for every 6 pans is
// 7.67 minutes a pan, so one pair of hands moves 7.83 pans an hour. The oven
// beside it does 24. A batch sits in the proofer for 81 minutes and the cabinet
// holds 12 pans, so it finishes a batch every 40.5 minutes — 8.89 pans an hour,
// which is why the hands are the wall today and the proofer is 5.5 minutes
// behind them, waiting.
//
// If this file ever disagrees with those, the screen is lying to her.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PLAN, allocation, computeLine, foldsIn, labourPerPanOf, planOf, proofCycleOf, usefulPeople,
} from "../admin/js/production.js";
import { scenarioOf, scenarioPlanPatch } from "../admin/js/scenario.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} (got ${a})`);
const stationOf = (r, key) => r.stations.find((s) => s.key === key);

// Minutes of hand-work in one batch of six pans — the figure she counts in.
const handWorkPer6 = (p) => labourPerPanOf(p) * 6;

test("at her measured numbers the hands run at 7.83 pans an hour, the proofer at 8.89, the oven at 24", () => {
  const r = computeLine(DEFAULT_PLAN);
  near(r.labourPerPan, 7.6667, "46 minutes of work for 6 pans is 7.67 minutes a pan");
  near(stationOf(r, "hands").rate, 7.8261, "so one pair of hands moves 7.83 pans an hour");
  near(stationOf(r, "proofer").rate, 8.8889,
    "12 pans in an 81-minute proof is 8.89 pans an hour — her own 40.5 minutes a batch");
  near(stationOf(r, "oven").rate, 24, "6 pans every 15 min is 24 an hour");
});

test("her chain is 254 minutes, and 239 of them are before the oven", () => {
  // The one arithmetic the whole backwards plan hangs on, in one place: mix 20,
  // four 30-minute rests with a 1-minute fold inside the first three, 15 to oil
  // the pans and weigh the dough out, 45 in the proofer, 6 to dimple, 30 in the
  // proofer again, then 15 for the oven's turn — bake and swap together.
  const p = DEFAULT_PLAN;
  const folds = foldsIn(p);
  assert.equal(folds, 3, "four rests carry three folds — the last rest is a rest and nothing else");
  const rests = p.foldRests * p.foldRestMin + folds * p.foldMin;
  assert.equal(rests, 123, "four half-hours plus three single minutes");
  near(proofCycleOf(p), 81, "the two proofs with the dimple between them, all in the cabinet at once");
  const toOven = p.mixMin + rests + p.scaleMin6 + p.proofMin1 + p.topMin6 + p.proofMin2;
  assert.equal(toOven, 239, "ready at the oven 239 minutes after the mix starts");
  assert.equal(toOven + p.ovenMin, 254, "and unloaded fourteen minutes later");
  near(handWorkPer6(p), 46, "and the whole batch asks for 46 minutes of her hands");
});

test("the hands are the wall at her numbers, and the proofer is 5.5 minutes behind them", () => {
  const r = computeLine(DEFAULT_PLAN);
  assert.equal(r.bottleneck.key, "hands",
    "7.83 pans an hour from one pair of hands is less than the proofer's 8.89");
  assert.equal(r.dayCapacity, 39, "five hours of that is 39 pans");
  assert.equal(r.shortfall, 21, "against the 60 she wants");
  // The proofer is not idle noise: the moment she is not alone it becomes the
  // wall, which is the whole reason she is checking her cabinet's pan count.
  near(stationOf(r, "proofer").rate - stationOf(r, "hands").rate, 1.06,
    "the proofer is barely ahead of one pair of hands, and behind two");
});

test("a bigger proofer buys nothing while she is alone, and her own time buys the most", () => {
  const r = computeLine(DEFAULT_PLAN);
  assert.equal(r.levers[0].key, "hours", "one more hour of her time is worth more pans than anything else");
  assert.equal(r.levers[0].gain, 7, "a sixth hour at 7.83 pans an hour is seven more pans");

  const flat = r.levers.filter((l) => l.gain <= 0).map((l) => l.key);
  assert.deepEqual(flat.sort(), ["oven", "pans", "prooferPans"],
    "and a bigger proofer, a bigger oven and more pans all buy nothing today — each still gets a row saying so");
});

test("with the proofer out of the way the hands are already the wall", () => {
  const r = computeLine({ ...DEFAULT_PLAN, prooferPans: 300 });
  assert.equal(r.bottleneck.key, "hands", "30 pans of proofer cannot outrun 7.83 pans an hour of hands");
  assert.equal(r.dayCapacity, 39, "so the day is still 39 pans");
});

test("a second pair of hands is worth having, and the oven needs four", () => {
  // A proofer far bigger than her cabinet, so only the hands and the oven can
  // bind — which is the question "how many people would this line use".
  const big = { ...DEFAULT_PLAN, prooferPans: 300, hours: 10 };
  const one = computeLine({ ...big, people: 1 });
  const three = computeLine({ ...big, people: 3 });
  const four = computeLine({ ...big, people: 4 });
  const five = computeLine({ ...big, people: 5 });

  near(stationOf(one, "hands").rate, 7.83, "one pair");
  near(stationOf(three, "hands").rate, 23.48, "three pairs — still short of the oven's 24");
  near(stationOf(four, "hands").rate, 31.3, "four pairs is the first that clears it");

  assert.equal(three.bottleneck.key, "hands", "at three pairs her hands are still the slow one");
  assert.equal(four.bottleneck.key, "oven", "at four the oven takes over");
  assert.equal(five.dayCapacity, four.dayCapacity,
    "so the fifth pair stands about — the oven sets the pace now");
});

test("usefulPeople is where another pair of hands stops buying anything", () => {
  assert.equal(usefulPeople(DEFAULT_PLAN), 2,
    "her proofer will use two pairs and no more — the third would stand about");
  assert.equal(usefulPeople({ ...DEFAULT_PLAN, prooferPans: 300, hours: 10 }), 4,
    "with the proofer out of the way, four pairs are what the 24-an-hour oven can use");
});

test("the seats split by largest remainder, so a fraction of a person is never left over", () => {
  // Named rather than positional: with six jobs on the list an array of seats
  // says nothing about who stands where.
  const seats = (people) => Object.fromEntries(
    allocation({ ...DEFAULT_PLAN, people }).map((j) => [j.key, j.seats]));
  assert.deepEqual(seats(1),
    { mix: 1, fold: 0, scale: 0, top: 0, swap: 0, cool: 0 },
    "one pair starts on the mixing, which is far the biggest single job");
  assert.deepEqual(seats(2),
    { mix: 1, fold: 0, scale: 1, top: 0, swap: 0, cool: 0 },
    "the second goes to oiling the pans and weighing the dough out");
  assert.deepEqual(seats(3),
    { mix: 1, fold: 0, scale: 1, top: 1, swap: 0, cool: 0 },
    "the third goes to the dimpling and topping");
  assert.deepEqual(seats(4),
    { mix: 2, fold: 0, scale: 1, top: 1, swap: 0, cool: 0 },
    "and the fourth back to the mixing, where the work is");
  const all = Object.values(seats(4));
  assert.equal(all.reduce((s, n) => s + n, 0), 4, "every pair is placed somewhere");
});

test("an empty field or an unmeasured station is left out rather than breaking the line", () => {
  const r = computeLine({ ...DEFAULT_PLAN, ovenMin: 0, mixerPans: 0 });
  assert.ok(!Number.isFinite(stationOf(r, "oven").rate),
    "an oven with no minutes is not a limit at all");
  assert.equal(r.bottleneck.key, "proofer", "so the next real constraint is named instead");

  const none = computeLine({ people: 0, topMin6: 0, swapMin6: 0, scaleMin6: 0 });
  assert.equal(none.plan.people, 1, "zero pairs of hands still counts as one person");
});

test("a day bigger than one tub says how many mixes it takes", () => {
  const r = computeLine({ ...DEFAULT_PLAN, prooferPans: 300, mixerPans: 20 });
  assert.equal(r.dayCapacity, 60, "a 20-pan tub spreads the 20-minute mix further, so the day is 60 pans");
  assert.equal(r.mixes, 3, "and 60 pans out of a 20-pan tub is three mixes, at 20, 20 and 20");
  const big = computeLine({ ...DEFAULT_PLAN, prooferPans: 300, mixerPans: 100 });
  assert.equal(big.mixes, 1, "a tub that covers the day is never mentioned");
});

// An untimed step is NAMED, never silently counted as free.

test("a step she has not timed is named, not counted as free", () => {
  const r = computeLine(DEFAULT_PLAN);
  assert.deepEqual(r.unmeasured, ["Cutting and packing"],
    "the one step with no minutes on it is reported, by name");
  near(r.labourPerPan, 7.6667, "and it adds nothing to the work until she times it");
});

test("once the last missing step is timed the hands slow down and the day shortens", () => {
  const r = computeLine({ ...DEFAULT_PLAN, coolMin6: 12 });
  // Twelve minutes of cutting and packing for six pans is two minutes a pan, on
  // top of the 7.67 of mixing, folding, oiling, dimpling and swapping.
  near(r.labourPerPan, 9.6667, "the whole day's hand-work, per pan");
  assert.deepEqual(r.unmeasured, [], "nothing is left untimed");
  near(stationOf(r, "hands").rate, 6.2069, "one pair now does about 6.2 pans an hour, not 7.83");
  assert.equal(r.dayCapacity, 31, "so five hours makes 31 pans, not the 39 it promised");
});

test("the mix and the folds are spread over the batch, so a bigger tub is less work a pan", () => {
  const small = { ...DEFAULT_PLAN, mixerPans: 25 };
  const big = { ...DEFAULT_PLAN, mixerPans: 50 };
  assert.ok(labourPerPanOf(big) < labourPerPanOf(small),
    "the same mixing and folding costs less labour over twice the dough");
  near(labourPerPanOf(small), 4.7533, "a 25-pan tub, on top of the oiling, dimpling and swapping");
  near(labourPerPanOf(big), 4.2933, "the same work over a 50-pan tub");
});

test("a tub with no size set cannot spread its time, and says so rather than dividing by zero", () => {
  const r = computeLine({ ...DEFAULT_PLAN, mixerPans: 0 });
  near(r.labourPerPan, 3.8333, "with no batch to spread them over, the mixing and folding count for nothing");
  assert.ok(r.unmeasured.includes("Mixing the dough in the tub"),
    "and both are reported as untimed, because a time with nowhere to go is not a measurement");
  assert.ok(r.unmeasured.includes("The rests and the stretch and folds"));
});

// ── The plan the line is read from, and the day it must never invent (v176) ──
//
// The Production line screen now reads nine of its numbers off her Scenario planner
// day instead of asking her for them. That makes two things load-bearing that were
// not before, and both of them are silent when they break: the object the line is
// computed from must not be hers, so nothing the screen does can reach her stored
// settings; and with no day of her own stored, the screen must read HER plan and not
// a default day it made up.

test("planOf keeps its own twenty-three keys and drops anything else it was handed", () => {
  // The screen builds a throwaway plan by spreading her stored settings and the
  // numbers it read off her day together. `planOf` answering with an explicit
  // literal is what stops that throwaway carrying an unknown key forward into
  // computeLine, where a station would read it and behave differently.
  const p = planOf({ ...DEFAULT_PLAN, capacity: 99, band: "late", modules: [1, 2, 3] });
  assert.equal("capacity" in p, false, "an unknown key reached the line's arithmetic");
  assert.equal("band" in p, false);
  assert.equal("modules" in p, false);
  assert.equal(Object.keys(p).length, 23, `planOf answers with ${Object.keys(p).length} keys`);
  assert.equal(Object.keys(p).length, Object.keys(planOf({})).length,
    "the keys depend on what was handed in, so a screen can change the shape of a plan");
});

test("computeLine does not write to the plan it was handed", () => {
  // ES modules are strict, so a write to a frozen object THROWS rather than being
  // swallowed — which is what makes this a measurement and not a hope. Every level
  // is frozen, because a shallow freeze would let a nested object be written and
  // this test would still pass.
  const deepFreeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
    return Object.freeze(o);
  };
  const frozen = deepFreeze({ ...DEFAULT_PLAN });
  const r = computeLine(frozen);
  assert.ok(r.dayCapacity > 0, "the frozen plan did not compute at all");
  assert.notEqual(r.plan, frozen, "the line hands back the very object it was given, so a caller can write through it");
  assert.equal(frozen.target, DEFAULT_PLAN.target, "the plan came back changed");
});

test("the plan the screen builds is a copy, so computing it cannot touch what she stored", () => {
  // The exact shape the screen uses: her stored row, then the numbers read off her
  // day spread over it. If this were not a copy, the spread would BE her settings and
  // the first derived number would be written straight into her stored plan.
  const stored = { ...DEFAULT_PLAN };
  const before = JSON.stringify(stored);
  const merged = { ...stored, target: 36, people: 2 };
  computeLine(planOf(merged));
  assert.equal(JSON.stringify(stored), before, "computing the line wrote into her stored settings");
  assert.equal(stored.target, DEFAULT_PLAN.target);
});

test("with no day of her own the screen reads her plan, not a day it invented", () => {
  // The trap the screen's gate closes, measured rather than argued. An empty scenario
  // is not an empty day: the model's own reader falls back to a full ten-module
  // default day, and its patch then hands the line ten numbers off a day she never
  // built. Measured here: her own plan says 39 pans today and that invented day says
  // 40 — the screen would have been quietly reading the wrong day, and saying a
  // number she never chose.
  const mine = computeLine(planOf(DEFAULT_PLAN)).dayCapacity;
  const invented = computeLine({ ...DEFAULT_PLAN, ...scenarioPlanPatch({}, DEFAULT_PLAN).patch }).dayCapacity;
  assert.notEqual(mine, invented,
    "the two days no longer tell apart, so this test cannot see which one the screen read");
  assert.equal(scenarioOf({}).modules.length, 10,
    "scenarioOf no longer falls back to a default day, so the gate is guarding nothing");
  assert.equal(Object.keys(scenarioPlanPatch({}, DEFAULT_PLAN).patch).length, 10,
    "an empty scenario no longer patches the plan, so the gate is guarding nothing");
});
