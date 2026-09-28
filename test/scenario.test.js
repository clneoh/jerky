// The scenario planner's model. The figures asserted here are the ones the whole
// screen rests on, and they are worked out by hand from the seeded day rather
// than read off the code: nine modules on, eleven modules in the list, and the
// smallest thing any of them passes is what the day can deliver.
//
// The one that matters most is the last: the chiller. Twelve trays held for a
// twelve-hour retard is twelve pans a day, and the same arithmetic read the
// other way says how many trays a bigger day would need. If this file ever
// disagrees with that, the screen is lying to her.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DAY_START, DEFAULT_SCENARIO, PX_PER_MIN_CHOICES, blankModule, chainLine, clockOf,
  climbSteps, descentSteps, combinedScenario, reassignSlot, computeScenario, concurrency, copyScenario, cycleOffsets,
  cycleTouches, hoursAndMinutes, linesInForce, minuteAtPx, moduleFacts, moduleOf, moveModule, newModuleId,
  passesOf, pickLines, peopleRows, placesOn, removeModule, repeatsToPass, scenarioOf, touchWindows,
  shiftOf, coversWindow, skillsOf, canWork, skillRank,
  clampBatchStart, alignBatches, batchMismatches, callWindows, latestStarts,
  START_MODES, START_MODE_LABELS, startModeOf, setStartMode,
  LINE_JOBS, jobOf, scenarioPlanPatch, scenarioSummary, SISTER_SCENARIO,
  ONE_BAKER_SCENARIO,
} from "../admin/js/scenario.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} (got ${a})`);
const of = (r, id) => r.modules.find((m) => m.id === id);

// A module with only the numbers a test cares about spelled out, so the test says
// what it is testing rather than spending ten lines setting up a kitchen.
const module = (m) => ({
  id: "b", name: "A module", on: true, cycleMin: 10, batch: 1, touchMin: 0,
  everyMin: 10, repeats: 1, startMin: 0, people: 1, ...m,
});
// A scenario of nothing but the modules handed in, so a test about the line is
// never accidentally also a test about the seeded day.
const scenario = (s) => ({ ...DEFAULT_SCENARIO, target: 0, modules: [], ...s });

test("the seeded day makes twelve pans, and the chiller is what stops it", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  assert.equal(r.pansPerDay, 12, "one 12-tray pass over the chiller is the smallest output on the line");
  assert.equal(r.wall.id, "load", "ties go to the earliest module in the day's order");
  near(r.cycleMin, 1.25, "15 minutes to load 12 pans is 48 pans an hour, so a pan every 1.25 min");
});

test("the chiller is one limit wearing three hats, and the screen says so", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  // Loading, retarding and unloading all pass the same 12, because they are the
  // same trays counted three times. Relieving only one of them buys nothing.
  const tied = r.on.filter((f) => f.id !== "load" && f.output === 12).map((f) => f.id);
  assert.deepEqual(tied, ["retard", "unload"]);
  assert.equal(of(r, "mixer").output, 28);
  assert.equal(of(r, "fold").output, 112);
});

test("the fridge is a module in the list and out of the scenario", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  assert.equal(r.on.some((f) => f.id === "fridge"), false);
  assert.deepEqual(r.parked.map((m) => m.id), ["fridge"]);
  // A module that is off cannot hold the day back.
  assert.notEqual(r.wall.id, "fridge");
});

test("the seeded day is one pair of hands", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  assert.equal(r.people, 1);
  assert.equal(r.rows.length, 1);
  // The two ways of counting the same thing must agree: a greedy colouring of
  // the touch windows cannot find fewer people than the peak overlap.
  assert.equal(r.demand.peak, r.rows.length);
});

test("the day runs through the night, so the window is a full 24 hours", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  // The last pack finishes at 1095 + 5x15 + 12.
  assert.equal(r.endMin, 1182);
  assert.equal(r.windowMin, 1440, "a day, because the retard is in it");
  assert.equal(r.hours, 24);
});

test("a start time moved is a person added — the whole point of the screen", () => {
  const sc = scenarioOf(DEFAULT_SCENARIO);
  assert.equal(computeScenario(sc).people, 1);

  // Move one packing pass onto a pass of topping and the day needs two people,
  // while everything the line makes stays exactly the same.
  const moved = { ...sc, modules: sc.modules.map((m) => (m.id === "pack" ? { ...m, startMin: 1008 } : m)) };
  const after = computeScenario(moved);
  assert.equal(after.people, 2, "topping 1008-1016 and packing 1008-1020 need two pairs of hands");
  assert.equal(after.pansPerDay, 12, "and not one pan more or less comes off the line");
});

test("a 12-hour retard fits twice in a day, and the model will not pretend otherwise", () => {
  // The one figure that keeps this screen honest. Three 12-hour retards is 36
  // hours of work in a 24-hour day, and the ladder is not allowed to propose it
  // — otherwise it would promise 36 pans and hide the real answer, more trays.
  const retard = moduleFacts({ id: "r", cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 5 });
  assert.equal(retard.fitsInDay, 2);
  assert.equal(retard.repeatsHeld, 2, "five passes asked for, two of them a day can hold");
  assert.equal(retard.capped, true);
  assert.equal(retard.output, 24, "twelve trays twice a day is twenty-four pans, and that is the ceiling");
  assert.equal(repeatsToPass(retard, 36), 2, "and it will not be talked up to three");
});

test("the ladder climbs while the day has room, then names what to buy", () => {
  // Thirty-six pans is not reachable by running anything MORE OFTEN: a 12-hour
  // retard fits twice in a day on one chiller, and the chiller holds twelve bins.
  // So the ladder runs out of free rungs exactly where she asked it to change the
  // subject — and it changes it to the thing that buys the number: a SECOND
  // chiller, which holds twice the bins and so makes a third retard possible at
  // all. Every rung it names is still one the day can really hold.
  const climb = climbSteps(DEFAULT_SCENARIO, 36);
  assert.equal(climb.reached, true);
  assert.equal(climb.end.pansPerDay, 36);
  // The free rungs come first, and they are the same ones they always were.
  assert.deepEqual(climb.steps.slice(0, 3).map((s) => s.id), ["load", "retard", "unload"]);
  assert.deepEqual(climb.steps.slice(0, 3).map((s) => [s.from, s.to]), [[1, 3], [1, 2], [1, 2]]);
  assert.ok(climb.steps.slice(0, 3).every((s) => s.kind === "repeats"), "free rungs come first");
  assert.equal(climb.steps[0].before, 12);
  assert.equal(climb.steps[0].wallThen.id, "retard", "relieving the first tie reveals the next");
  assert.equal(climb.steps[2].after, 24);
  // And then it stops proposing more runs and starts naming what to buy.
  const buys = climb.steps.filter((s) => s.kind === "count");
  assert.ok(buys.length >= 1, "the ladder reaches the buying decision instead of stopping short");
  const retard = climb.end.modules.find((m) => m.id === "retard");
  assert.equal(retard.count, 2, "the buying decision lands on the module as two of it");
  assert.equal(retard.repeats, 3, "and it carries the cycles that second one makes possible");
  assert.ok(retard.repeatsHeld <= retard.fitsInDay, "and never a cycle the day cannot hold");
  assert.equal(retard.output, 36, "twelve bins, three times, on the chiller she would own two of");
});

test("a number the day can hold is still climbed to, all the way", () => {
  // Twenty-four is reachable, and the ladder gets there inside the day's limit.
  const climb = climbSteps(DEFAULT_SCENARIO, 24);
  assert.equal(climb.reached, true);
  assert.equal(climb.end.pansPerDay, 24);
  assert.deepEqual(climb.steps.map((s) => s.id), ["load", "retard", "unload"]);
});

test("a climb that runs out of rungs says so rather than pretending it arrived", () => {
  // A thousand pans a day is nothing this line is going to do, and the ladder is
  // capped: three rungs in, the chiller chain is relieved and the day itself is
  // the wall — which is where the climb has to stop and change the subject.
  const climb = climbSteps(DEFAULT_SCENARIO, 1000, 3);
  assert.equal(climb.reached, false);
  assert.equal(climb.steps.length, 3);
  assert.equal(climb.end.pansPerDay, 24, "the day's own limit, not her hands");
  assert.equal(climb.end.wall.id, "retard");
});

test("the trays a day needs is the same arithmetic as the pans a day", () => {
  // trays = pans a day x retard hours / 24 — the formula this line has used all
  // along, now holding the ladder to account. Thirty-six pans on a twelve-hour
  // retard wants eighteen trays, and twelve trays cannot stand in for them: a
  // day holds two twelve-hour retards, not three. That difference IS the buying
  // decision, so it is worth a test.
  const r = computeScenario(DEFAULT_SCENARIO);
  const retard = r.modules.find((m) => m.id === "retard");
  near((36 * retard.cycleMin) / 1440, 18, "36 pans over a 720-minute retard needs 18 trays");
  assert.equal(repeatsToPass(retard, 36), 2, "but 12 trays cannot be passed 3 times in a day");
  assert.equal(retard.batch * repeatsToPass(retard, 36), 24, "so twelve trays tops out at 24 pans");
});

test("a module with no gap of its own runs back to back", () => {
  const m = moduleOf({ id: "x", cycleMin: 20, batch: 4, touchMin: 5, repeats: 3, startMin: 10 });
  assert.equal(m.everyMin, 20, "an unset gap is the cycle time, not zero");
  assert.deepEqual(passesOf(m).map((p) => p.at), [10, 30, 50]);
});

test("a touch longer than its pass is clamped to the pass", () => {
  const [p] = passesOf({ cycleMin: 5, batch: 1, touchMin: 30, repeats: 1, startMin: 0 });
  assert.equal(p.touchTo, 5, "you cannot still be at a module the dough has left");
});

test("a module is a whole pass or nothing, and never a fraction of one", () => {
  const m = moduleFacts({ id: "x", cycleMin: 15, batch: 6, touchMin: 0, everyMin: 15, repeats: 6 });
  assert.equal(m.output, 36);
  assert.equal(m.needsYou, false, "no minutes of her is a module that runs itself");
  assert.equal(m.touchTotal, 0);
  near(m.rate, 24, "6 pans every 15 minutes is 24 an hour");
  near(m.perPan, 2.5, "15 minutes over 6 pans");
});

test("a person free at the minute the next job starts is free", () => {
  // peopleRows reads module FACTS — the shape computeScenario hands it, with
  // every pass already worked out. Two jobs that meet at minute 10 are one pair
  // of hands, not two.
  const at = (id, startMin) => moduleFacts({
    id, icon: "•", name: id, on: true, person: 0, cycleMin: 10, batch: 1,
    touchMin: 10, everyMin: 10, repeats: 1, startMin, people: 1,
  });
  const rows = peopleRows([at("a", 0), at("b", 10)]);
  assert.equal(rows.length, 1, "finishing at 10 and starting at 10 is one pair of hands, not two");
  assert.deepEqual(rows[0].items.map((w) => w.module), ["a", "b"]);
  assert.equal(rows[0].clashes.length, 0, "meeting but not overlapping is not a collision");
  assert.equal(concurrency([at("a", 0), at("b", 10)]).peak, 1, "and the total person row agrees");
});

test("a module she has given to a person goes there, collision and all", () => {
  // Her ask: one person per module, then slide the modules until the collisions
  // are gone. A named person is her plan, so the plan is SHOWN rather than
  // quietly rearranged onto somebody who happens to be free — otherwise the
  // collision she is trying to see would be hidden from her.
  const at = (id, startMin, person) => moduleFacts({
    id, icon: "•", name: id, on: true, person, cycleMin: 10, batch: 1,
    touchMin: 10, everyMin: 10, repeats: 1, startMin, people: 1,
  });
  const rows = peopleRows([at("a", 0, 1), at("b", 5, 1)]);
  assert.equal(rows.length, 1, "one named person, one row — not a second pair of hands");
  assert.equal(rows[0].items.length, 2);
  assert.equal(rows[0].clashes.length, 1, "b starts before a finishes, and that is the collision");
  assert.equal(rows[0].clashes[0].from, 5);
  assert.equal(rows[0].clashes[0].to, 10);
  assert.equal(rows[0].busy, 15, "the union of the two windows, not the sum (20)");
  // And the day still NEEDS two people at minute 5, whatever the plan says: that
  // gap is exactly the manpower the combination cannot pay for.
  assert.equal(concurrency([at("a", 0, 1), at("b", 5, 1)]).peak, 2);
});

test("the only stretch a person's row carries is the hours she typed, worked out nowhere (v182)", () => {
  // Her rule of 24 September, retiring the computed shade that v179 drew and v180
  // suppressed: "Wei should not have any shade because there is no work time set for
  // him, shade should just follow what i set, not other consideration." So there is no
  // `span` and no `shade` on a row at all — nothing in the model works a working day out
  // from the jobs. Where she has typed hours, `row.shift` carries them, and that is what
  // the view draws; where she has not, the row is drawn with no band.
  const at = (id, startMin, touchMin, person = 0) => moduleFacts({
    id, icon: "•", name: id, on: true, person, cycleMin: touchMin, batch: 1,
    touchMin, everyMin: touchMin, repeats: 1, startMin, people: 1,
  });
  const on = [at("a", 0, 4, 1), at("b", 30, 4, 1)];

  const plain = peopleRows(on);
  assert.equal(plain.length, 1, "two jobs on one person are one row");
  assert.equal("span" in plain[0], false,
    "the row still carries a working stretch worked out from the day");
  assert.equal("shade" in plain[0], false,
    "the row still carries a shade to draw, so a person with no hours typed is shaded anyway");
  assert.strictEqual(plain[0].shift, null,
    "a person whose hours nobody typed has no band");
  assert.equal(plain[0].busy, 8, "the minutes they actually work are untouched by this");
  assert.equal(plain[0].items.length, 2, "and so are their jobs");

  const typed = peopleRows(on, { 1: { startMin: 0, endMin: 600 } });
  assert.deepEqual(typed[0].shift, { startMin: 0, endMin: 600 },
    "the hours she typed are what the row draws");
  // A shift is a fact about a person, never about the day: typing hours over one person
  // leaves every other row alone.
  const two = peopleRows([at("a", 30, 4, 1), at("b", 0, 10, 2)], { 1: { startMin: 0, endMin: 600 } });
  assert.deepEqual(two.find((r) => r.person === 1).shift, { startMin: 0, endMin: 600 });
  assert.strictEqual(two.find((r) => r.person === 2).shift, null,
    "somebody else's hours were put on a person nobody typed them for");
});

test("the total person row stacks whoever is working, named or not", () => {
  // The row she asked for: person 1, person 2, person 3 added up, so a doubled
  // stretch is a shape rather than a number. A named module and a shared-out one
  // are the same thing to this count.
  const at = (id, startMin, person) => moduleFacts({
    id, icon: "•", name: id, on: true, person, cycleMin: 10, batch: 1,
    touchMin: 10, everyMin: 10, repeats: 1, startMin, people: 1,
  });
  const d = concurrency([at("a", 0, 1), at("b", 0, 3), at("c", 20, 0)]);
  assert.equal(d.peak, 2, "person 1 and person 3 both working from minute 0");
  assert.deepEqual(d.segments, [
    { from: 0, to: 10, count: 2 },
    { from: 20, to: 30, count: 1 },
  ]);
  assert.equal(d.overlapMin, 10, "ten minutes of the day wants two people at once");
});

test("combining two people is a label, and it stops claiming them when undone", () => {
  // Her own example: person 1 combined with person 3 is "person 1_3". The modules
  // are what the day is built from, so the combination is stored as a label and
  // the arithmetic is unchanged by it.
  const sc = scenarioOf({ ...DEFAULT_SCENARIO, merges: { 1: [1, 3], 9: [9], bad: "x", 2: [2] } });
  assert.deepEqual(sc.merges, { 1: [3] }, "only real person numbers survive, and a row is never listed as covering itself");
  assert.deepEqual(copyScenario(sc, "copy", "s2").merges, { 1: [3] });
  // The copy's label is its own: editing it cannot rewrite the original's.
  const copy = copyScenario(sc, "copy", "s2");
  copy.merges["1"].push(4);
  assert.deepEqual(sc.merges["1"], [3]);
});

test("the day starts when she says it does, and the scale is one of the six", () => {
  // "i cannot change the time scale, say i want a start at 8am" — so the start is
  // a field, and every time on screen is counted from it.
  const r = computeScenario({ ...DEFAULT_SCENARIO, dayStartMin: 8 * 60 });
  assert.equal(r.dayStartMin, 480);
  assert.equal(clockOf(r.dayStartMin + 0), "8:00 am", "minute zero of the day is 8 am");
  assert.equal(clockOf(r.dayStartMin + of(r, "load").startMin), "12:18 pm");
  // A day wraps rather than rejecting 25:00, and the scale snaps to a choice she
  // can actually read — a hand-typed number must not make a day a hair's width.
  assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, dayStartMin: -60 }).dayStartMin, 1380);
  assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, dayStartMin: 25 * 60 }).dayStartMin, 60);
  assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, pxPerMin: 1.65 }).pxPerMin, 1.6);
  // The nearest stop of SIX, not of four: 999 is 7.2 where it used to be 3.2. That
  // is a real change on her phone and not only a number in a test — a stored
  // pxPerMin anywhere in (3.2, 7.2] opens one stop closer from v184 on.
  assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, pxPerMin: 999 }).pxPerMin, 7.2);
  assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, pxPerMin: 0 }).pxPerMin, 1.2);
  // Every stop she can pick survives the round trip, so no stop of the dial is one
  // the day cannot be left standing on.
  for (const px of PX_PER_MIN_CHOICES) {
    assert.equal(scenarioOf({ ...DEFAULT_SCENARIO, pxPerMin: px }).pxPerMin, px,
      `${px} is not a stop the day can be left on`);
  }
  assert.equal(DEFAULT_SCENARIO.dayStartMin, DEFAULT_DAY_START);
});

test("a module can be made, moved in the order, and deleted", () => {
  const mods = DEFAULT_SCENARIO.modules.map((m) => ({ ...m }));
  const id = newModuleId(mods);
  assert.equal(id, "brick1", "a name no other module is using");

  // A new module arrives SWITCHED OFF: a module with no numbers in it must not
  // become the wall and answer the day with "1 pan".
  const fresh = blankModule(id);
  assert.equal(fresh.on, false);
  assert.equal(computeScenario({ ...DEFAULT_SCENARIO, modules: [...mods, fresh] }).pansPerDay, 12);

  // Switched on with 6 pans a pass it takes its place in the day like any other.
  const on = { ...fresh, on: true, batch: 6, repeats: 6, cycleMin: 15, touchMin: 0, everyMin: 15 };
  const grown = [...mods, on];
  assert.equal(computeScenario({ ...DEFAULT_SCENARIO, modules: grown }).pansPerDay, 12);

  // The order of the list IS the order of the day, so moving one is a real edit.
  const moved = moveModule(grown, "fold", -1);
  assert.deepEqual(moved.slice(0, 2).map((m) => m.id), ["fold", "mixer"]);
  assert.equal(moved.length, grown.length, "moving is a reorder, never a copy");
  assert.deepEqual(moveModule(grown, "mixer", -1).map((m) => m.id), grown.map((m) => m.id), "the first module cannot move up");
  assert.deepEqual(moveModule(grown, "brick1", 1).map((m) => m.id), grown.map((m) => m.id), "nor the last down");
  assert.equal(moveModule(grown, "nope", -1).length, grown.length);

  assert.equal(removeModule(grown, "brick1").some((m) => m.id === "brick1"), false);
  assert.equal(removeModule(grown, "nope").length, grown.length, "deleting something that is not there is not an error");
  assert.equal(newModuleId(removeModule(grown, "brick1")), "brick1", "and its name comes free again");
});

test("a batch stepped by the buttons lands on the minute a typed time lands on", () => {
  // The screen has TWO ways to move one batch: press the pair at 5 minutes or the
  // pair at 1, or type the minute. They must be the same answer, and the only way
  // to promise that is for both to go through one function — which is why
  // clampBatchStart lives in the model. This walks the view's own write path:
  // clamp the wanted minute, write it into that batch's slot, keep startMin equal
  // to the first batch, then read the batch back OFF the model.
  const seed = module({ id: "m", cycleMin: 15, everyMin: 15, repeats: 4, startMin: 60 });
  // The typed path in three lines: the minute she types goes through the same
  // clamp, startMin is kept equal to the first batch the way moduleOf keeps it, and
  // the batch is read back OFF the model.
  const place = (starts) => {
    const mod = moduleOf(seed);
    const next = starts.map((v) => clampBatchStart(v, mod));
    return moduleOf({ ...seed, starts: next, startMin: next[0] }).starts;
  };
  // One press, mirrored exactly: setBatchStart asks for the current minute plus the
  // step and writes the clamped answer into that batch's slot, leaving the others.
  const press = (starts, k, by) => {
    const next = starts.slice();
    next[k] = next[k] + by;
    return place(next);
  };
  const presses = (times, by, k = 3) => {
    let list = moduleOf(seed).starts;
    for (let i = 0; i < times; i += 1) list = press(list, k, by);
    return list[k];
  };
  assert.deepEqual(moduleOf(seed).starts, [60, 75, 90, 105], "evenly spaced until she moves one");

  // Four presses of the big pair, on the last batch, is twenty minutes.
  const stepped = presses(4, 5);
  const typed = place([60, 75, 90, 105 + 20])[3];
  assert.equal(stepped, 125, "4 x +5 on 105");
  assert.equal(stepped, typed, "and a typed 125 is the same minute, not a nearby one");

  // Twenty presses of the small pair is the same twenty minutes.
  assert.equal(presses(20, 1), stepped, "20 x +1 agrees with 4 x +5 to the minute");

  // One batch moves and the others do not — the shape she has set is kept.
  assert.deepEqual(press(moduleOf(seed).starts, 1, 5), [60, 80, 90, 105], "only the batch she pressed moves");

  // The ends of the day hold for a press and for a typed number alike. The ceiling
  // is the last minute at which the batch still finishes inside the day.
  assert.equal(place([60, 75, 90, -30])[3], 0, "a typed negative is midnight, not an error");
  assert.equal(presses(30, -5), 0, "and pressing earlier past midnight stops at midnight too");
  const ceiling = 24 * 60 - 15;
  assert.equal(place([60, 75, 90, 9999])[3], ceiling, "a typed number past the day stops at the ceiling");
  assert.equal(presses(300, 5), ceiling, "and pressing later past the day stops at the same minute");
});

test("a batch count follows the module before it, and says when it does not", () => {
  // Her rule, 2026-09-22: "follow the one before, and say when it does not". A
  // fresh line each time, because both halves write the modules they are given.
  const line = (counts) => counts.map((n, i) => module({ id: `m${i}`, name: `Step ${i + 1}`, repeats: n }));
  const counts = (list) => list.map((m) => m.repeats);

  // A line in step: editing the first carries every one of them with it.
  assert.deepEqual(
    counts(alignBatches(line([4, 4, 4, 4, 4, 4]), "m0", 3)),
    [3, 3, 3, 3, 3, 3],
    "the whole line follows");
  assert.deepEqual(batchMismatches(line([3, 3, 3, 3, 3, 3])), [], "and nothing is left out of step");

  // A module with a number of her own is never quietly overwritten, and the carry
  // stops AT it rather than reaching past it.
  assert.deepEqual(
    counts(alignBatches(line([4, 4, 6, 4, 4, 4]), "m0", 2)),
    [2, 2, 6, 4, 4, 4],
    "2 and 6 are hers, and the fours behind the 6 are not touched");
  assert.deepEqual(
    batchMismatches(line([2, 2, 6, 4, 4, 4])).map((m) => [m.name, m.repeats, m.before.name, m.before.repeats]),
    [["Step 3", 6, "Step 2", 2], ["Step 4", 4, "Step 3", 6]],
    "both steps in the counts are named, with both numbers");

  // A module switched out of the day is not in the chain: it neither follows nor
  // breaks a run of them.
  const off = line([4, 4, 4, 4]);
  off[1].on = false;
  assert.deepEqual(counts(alignBatches(off, "m0", 5)), [5, 4, 5, 5], "the off module is stepped over");
  assert.deepEqual(batchMismatches(off), [], "and it is not named as out of step");

  // Editing something that is not there is not an error.
  assert.equal(alignBatches(line([4, 4]), "nope", 2).length, 2, "a module that is not in the line is left alone");
});

test("a saved scenario is a copy, not a second name for the same modules", () => {
  // Two designs side by side — the line without a fridge and the line with one —
  // must not be able to edit each other.
  const sc = scenarioOf(DEFAULT_SCENARIO);
  const saved = copyScenario(sc, "With a fridge", "s1");
  assert.equal(saved.name, "With a fridge");
  assert.equal(saved.id, "s1");
  assert.equal(saved.pansPerDay, undefined, "a stored scenario is the plan, not the answer");
  saved.modules[0].batch = 999;
  assert.equal(sc.modules[0].batch, 28, "editing the copy leaves the one she was working on alone");
  assert.equal(computeScenario(saved).pansPerDay, 12, "and the fridge is still switched off in it");
});

test("every touch window is the minutes of a person, and nothing else is", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  const windows = touchWindows(r.on);
  // Nine modules, but only the ones that need her: the retard runs itself, and a
  // 6-pass loop is six windows, not one.
  assert.equal(windows.filter((w) => w.module === "retard").length, 0);
  assert.equal(windows.filter((w) => w.module === "fold").length, 4);
  // The fold's 2 minutes are inside its own 28, so each window is 2 minutes wide
  // and they are 30 minutes apart — rest, fold, rest, fold.
  const folds = windows.filter((w) => w.module === "fold");
  assert.deepEqual(folds.map((w) => w.from), [30, 60, 90, 120]);
  assert.deepEqual(folds.map((w) => w.to), [32, 62, 92, 122]);
});

test("a plan half typed in is clamped rather than believed", () => {
  const s = scenarioOf({ name: "", target: -5, modules: [{ id: "z", cycleMin: 0, batch: 0, touchMin: 0, repeats: 0, startMin: -100 }] });
  assert.equal(s.target, 0);
  assert.equal(s.modules[0].repeats, 1, "a scenario has at least one pass of something");
  assert.equal(s.modules[0].startMin, 0);
  assert.equal(s.name, DEFAULT_SCENARIO.name);
});

test("the clock reads the way she would say it", () => {
  assert.equal(clockOf(0), "12:00 am");
  assert.equal(clockOf(450), "7:30 am");
  assert.equal(clockOf(720), "12:00 pm");
  assert.equal(clockOf(1008), "4:48 pm");
  assert.equal(clockOf(1440), "12:00 am", "a full day is back where it started");
  assert.equal(hoursAndMinutes(90), "1 h 30 min");
  assert.equal(hoursAndMinutes(120), "2 h");
  assert.equal(hoursAndMinutes(45), "45 min");
});

// ── Handing a module to the Production line ─────────────────────────────────
//
// These are the figures that cross from one screen to the other, and the point
// of each is the same: only what she typed into a module may cross. The seeded
// day is the case that matters, because it is the one she will load first.

test("the seeded modules carry the line's own numbers across", () => {
  const p = scenarioPlanPatch(DEFAULT_SCENARIO, {});
  // The mixer's 6 minutes a mix, its 28-pan tub; the wash module's 18 minutes and
  // the top's 8; the oven module's 4 minutes of hands, its 6 pans and its
  // 15-minute turn. Every one of them is a number she typed.
  //
  // The wash module fills the one field the wash and the weighing-out share, so it
  // arrives as scaleMin6 under its new single name. The retard module no longer
  // crosses at all: the chiller is not a station of the line she has, so its
  // trays are named as skipped rather than written to a field that is gone.
  // The hands are the peak at once, not the number of rows she has drawn: the
  // seeded day is laid out so one pair covers every job, module by module.
  assert.deepEqual(p.patch, {
    target: 36, people: 1,
    mixMin: 6, mixerPans: 28,
    scaleMin6: 18, topMin6: 8, coolMin6: 12,
    swapMin6: 4, ovenPans: 6, ovenMin: 15,
  });
  // Every step of the line is answered for by one module or another, so nothing is
  // left over — the wash and the weighing-out are one job and one field now.
  assert.deepEqual(p.left, [], "every step of the line has a module feeding it");
  // And the modules that are not a step of the line are named, not silently lost.
  assert.deepEqual(p.unmapped,
    ["The fold loop", "Load the chiller", "Retard overnight", "Unload the chiller"]);
});

test("a module's minutes are scaled onto six pans, not handed over raw", () => {
  // One wash module that does 12 pans in 30 minutes is 15 minutes for every 6.
  const s = scenarioOf({
    target: 0,
    modules: [{ id: "wash", name: "Wash, oil and fill", job: "wash", on: true,
      cycleMin: 30, batch: 12, touchMin: 30, everyMin: 30, repeats: 1, startMin: 0, people: 1 }],
  });
  const p = scenarioPlanPatch(s, { scaleMin6: 18 });
  assert.equal(p.patch.scaleMin6, 15);
  const line = p.lines.find((l) => l.key === "scaleMin6");
  assert.equal(line.from, 18);
  assert.equal(line.changes, true, "18 → 15 is a real change and the screen has to say so");
});

test("a module saved before jobs existed is matched on the name it was seeded with", () => {
  const old = { id: "w", name: "Wash, oil and fill", on: true, cycleMin: 18, batch: 6,
    touchMin: 20, everyMin: 18, repeats: 6, startMin: 0, people: 1 };
  assert.equal(jobOf(old), "wash", "no job field, and the name is the one the app seeded");
  assert.equal(scenarioPlanPatch({ modules: [old] }, {}).patch.scaleMin6, 20);
  // A name of her own with no job is honestly none of the line's steps.
  assert.equal(jobOf({ id: "x", name: "My own thing", on: true, cycleMin: 5, batch: 1, touchMin: 5 }), "");
});

test("a job is kept apart from the name, so renaming a module cannot break the link", () => {
  const renamed = { id: "w", name: "The oily pan bit", job: "wash", on: true,
    cycleMin: 18, batch: 6, touchMin: 18, everyMin: 18, repeats: 6, startMin: 0, people: 1 };
  assert.equal(jobOf(renamed), "wash");
  assert.equal(jobOf({ ...renamed, job: "" }), "", "and the name it now wears is nobody's step");
});

test("a switched-off module crosses over as nothing at all", () => {
  const s = scenarioOf({
    target: 20,
    modules: [
      { id: "oven", name: "The oven", job: "oven", on: false, cycleMin: 15, batch: 6,
        touchMin: 4, everyMin: 15, repeats: 6, startMin: 0, people: 1 },
      { id: "wash", name: "Wash, oil and fill", job: "wash", on: true, cycleMin: 18, batch: 6,
        touchMin: 18, everyMin: 18, repeats: 6, startMin: 0, people: 1 },
    ],
  });
  const p = scenarioPlanPatch(s, {});
  assert.equal(p.patch.scaleMin6, 18);
  assert.equal(p.patch.ovenMin, undefined, "the module is off, so the line answers without it");
  assert.deepEqual(p.unmapped, [], "and it is not even named as skipped work");
});

test("two modules that admit to the same job are named, and the first one wins", () => {
  const module = (id, touchMin) => ({ id, name: id, job: "wash", on: true,
    cycleMin: 18, batch: 6, touchMin, everyMin: 18, repeats: 1, startMin: 0, people: 1 });
  const p = scenarioPlanPatch(scenarioOf({ modules: [module("a", 18), module("b", 25)] }), {});
  assert.equal(p.patch.scaleMin6, 18, "the first module in the day's order is the one that crosses");
  assert.deepEqual(p.doubled, ["Wash, oil and fill"]);
});

test("a wash module and a weighing-out module are one job, and neither is reported missing", () => {
  // The two were always one job under two names, so a scenario holding both was
  // counting the same work twice. The fuller reading crosses — it never
  // understates her hands — and the single step they share is not then listed as
  // one the scenario said nothing about.
  const both = (id, job, touchMin) => ({ id, name: id, job, on: true, cycleMin: 18, batch: 6,
    touchMin, everyMin: 18, repeats: 1, startMin: 0, people: 1 });
  const p = scenarioPlanPatch(scenarioOf({
    modules: [both("w", "wash", 18), both("s", "scale", 25)],
  }), {});
  assert.equal(p.patch.scaleMin6, 25, "the fuller of the two is taken");
  assert.ok(!p.left.includes("Weighing the dough out into pans"),
    "and the one step they share is not then named as unfed");
  assert.deepEqual(p.unmapped, [], "nor is either module named as work that feeds nothing");
});

test("the load says what it did and did not change", () => {
  const p = scenarioPlanPatch(DEFAULT_SCENARIO, { scaleMin6: 18, ovenMin: 12 });
  const line = (key) => p.lines.find((l) => l.key === key);
  assert.equal(line("scaleMin6").changes, false, "the same number is not a change");
  assert.equal(line("ovenMin").from, 12);
  assert.equal(line("ovenMin").to, 15);
  // A step she has never timed arrives as blank rather than as a nought.
  assert.equal(line("mixMin").from, 0);
  assert.equal(line("mixMin").changes, true);
});

test("the summary of a scenario reads the same on both screens", () => {
  assert.equal(scenarioSummary(DEFAULT_SCENARIO), "12 pans a day · 9 modules");
  assert.equal(LINE_JOBS.length, 7, "the steps of the line a module can be, plus the retard");
  assert.equal(new Set(LINE_JOBS.map((j) => j.key)).size, LINE_JOBS.length);
});

// ── Her sister's line, the second scenario ─────────────────────────────────
//
// The numbers asserted below are the ones she gave on 21 Sep 2026: a tub that
// fills four, a fold every 30 minutes three times, a proofer holding twelve
// with a one-hour hold, a minute a pan for dimple and oil, and 30 minutes of
// rest before the oven. If this file ever disagrees with those, the second
// scenario is no longer the line her sister described.

test("her sister's line is a different kitchen: no mixer and no chiller", () => {
  const r = computeScenario(SISTER_SCENARIO);
  const ids = r.modules.map((m) => m.id);
  assert.equal(r.scenario.name, "My sister proposal 21/9/2026");
  assert.equal(ids.includes("mixer"), false, "the dough is mixed by hand in the tub, so there is no mixer module");
  assert.equal(ids.includes("retard"), false, "a proofing cabinet takes the chiller's place");
  assert.equal(ids.includes("load"), false, "and with it the loading and unloading of the chiller");
  assert.equal(ids.includes("proofer"), true);
  assert.equal(ids.includes("bench"), true, "the 30 minutes of rest before the oven is its own module");
});

test("her sister's numbers are the ones on the modules", () => {
  const r = computeScenario(SISTER_SCENARIO);
  const folds = of(r, "tubfold");
  assert.equal(folds.batch, 4, "the tub fills four doughs");
  assert.equal(folds.repeats, 3, "a stretch and fold every 30 minutes, three times");
  assert.equal(folds.everyMin, 30);
  near(folds.passes[1].at - folds.passes[0].at, 30, "one fold every half hour");

  const proofer = of(r, "proofer");
  assert.equal(proofer.cycleMin, 60, "proofed for an hour");
  assert.equal(proofer.batch, 12, "and the cabinet holds twelve pans at any time");
  assert.equal(proofer.needsYou, false, "the dough waits in the cabinet while she does something else");

  const dimple = of(r, "dimpleoil");
  assert.equal(dimple.batch, 4);
  assert.equal(dimple.touchMin, 4, "a minute a pan, four pans");

  const bench = of(r, "bench");
  assert.equal(bench.cycleMin, 30, "then 30 minutes before the oven");
  assert.equal(bench.needsYou, false, "standing still is not work");
});

test("her sister's day reads as four pans, and the tub is what stops it", () => {
  const r = computeScenario(SISTER_SCENARIO);
  assert.equal(r.pansPerDay, 4, "one tub of four is all the day passes");
  assert.equal(r.wall.id, "tubmix", "ties go to the earliest module, and mixing is the first thing the day does");
  assert.equal(scenarioSummary(SISTER_SCENARIO), "4 pans a day · 8 modules");
});

test("the two numbers she never gave are named as hers to set", () => {
  const r = computeScenario(SISTER_SCENARIO);
  // A figure she did not give may not be dressed up as one she did — the same
  // rule the v135 mixer box was fixed under. Both are called out by name so she
  // finds them without reading a changelog.
  assert.match(of(r, "tubmix").name, /set the minutes/,
    "the mixing-by-hand placeholder says so on the module itself");
  assert.equal(of(r, "panfill").touchMin, 12,
    "tipping into the pans uses her own measured 3 minutes a pan, which is 12 for four");
});

test("every module of her sister's line is reachable from the module editor", () => {
  // Nothing is stored that moduleOf would drop, so every number she can see is
  // a number she can change -- which is what she meant by "numbers need to be
  // configurable". A field the model quietly discards would be a setting she
  // cannot reach.
  for (const m of SISTER_SCENARIO.modules) {
    const back = moduleOf(m);
    assert.equal(back.cycleMin, m.cycleMin, `${m.id}: cycle minutes survive`);
    assert.equal(back.batch, m.batch, `${m.id}: the batch survives`);
    assert.equal(back.touchMin, m.touchMin, `${m.id}: the hands minutes survive`);
    assert.equal(back.everyMin, m.everyMin, `${m.id}: the pace survives`);
    assert.equal(back.repeats, m.repeats, `${m.id}: the number of passes survives`);
    assert.equal(back.startMin, m.startMin, `${m.id}: the start time survives`);
    assert.equal(back.person, m.person, `${m.id}: the person survives`);
    assert.equal(back.job, m.job || "", `${m.id}: the line step survives`);
    // The chain and the per-cycle drag added three fields, and reading a module a
    // second time must not lose any of them — that is what makes a chained
    // placement survive being handed between the model and the screen.
    assert.equal(back.count, 1, `${m.id}: a module she has one of says so`);
    assert.equal(back.follow, false, `${m.id}: and no module waits for another until she says so`);
    assert.equal(back.overlap, false, `${m.id}: and none of them lets two lots in at once yet`);
    // A module she has one of is ONE line, so it carries the one person it always
    // had and no more — the extra lines arrive with the second one of them.
    assert.deepEqual(back.crew, [back.person], `${m.id}: one line, carrying the module's own person`);
    assert.deepEqual(moduleOf(back).starts, back.starts, `${m.id}: the cycle times read back the same`);
  }
  // Switched on, the switch itself is a value that has to survive the same trip —
  // it is the one field whose default is off and whose being on changes the clock.
  const on = moduleOf({ ...SISTER_SCENARIO.modules[0], count: 2, follow: true, overlap: true });
  assert.deepEqual(
    [on.count, on.follow, on.overlap],
    [2, true, true],
    "two of them, waiting on the module above, and free to hold two lots at once",
  );
  assert.deepEqual(moduleOf(on), on, "and a second read of it changes nothing at all");
});

// ── "One baker day", the third scenario ────────────────────────────────────
//
// Her ask, 22 Sep 2026: *"i need you to create one scenario and save it as One
// baker day. Set the modules for me, with latest start time each module batch."*
//
// So the arithmetic below is the load-bearing part of that scenario, not
// decoration: her own chain's minutes, the latest starts the Production line
// works out backwards from the oven, and the one number that is NOT simply her
// chain's offset — the packing, which alone she cannot start until the last
// tub's folds are done. Everything else here was swept against this file's own
// model rather than reasoned out by eye, so if the seeded day and the model ever
// drift apart, this is where it shows.

// The scenario with one number moved, so a claim about "this is the only rhythm
// that works" is tested by moving it rather than by asserting the sentence.
const soloWith = (every, packStart) => ({
  ...ONE_BAKER_SCENARIO,
  modules: ONE_BAKER_SCENARIO.modules.map((m) => ({
    ...m,
    everyMin: every,
    startMin: m.id === "solo_pack" ? packStart : m.startMin,
  })),
});

test("one baker day is her own chain on one pair of hands", () => {
  const r = computeScenario(ONE_BAKER_SCENARIO);
  assert.equal(r.pansPerDay, 24, "four batches of the six pans she bakes");
  assert.equal(r.people, 1, "and one pair of hands carries all of it");
  assert.equal(r.personMin, 232, "232 minutes of those hands across the day");
  assert.equal(r.rows.length, 1, "one row, because there is one person");
  assert.deepEqual(r.rows[0].clashes, [], "and nothing on the day collides with anything else");
  assert.equal(r.dayStartMin, 240, "the window starts at 4 am, an hour before the tub");
  assert.equal(clockOf(r.dayStartMin + r.firstMin), "4:01 am", "the first thing the day does is mix");
  assert.equal(clockOf(r.dayStartMin + r.endMin), "1:30 pm", "and the last pack ends at half past one");
  assert.equal(r.shortfall, 0, "the day she asked for is the day it delivers");
  assert.equal(scenarioSummary(ONE_BAKER_SCENARIO), "24 pans a day · 8 modules");
});

test("every module's cycles are the latest starts, 87 minutes apart", () => {
  const r = computeScenario(ONE_BAKER_SCENARIO);
  const at = (id) => clockOf(r.dayStartMin + of(r, id).passes[0].at);
  // The chain top to bottom, in the times the Production line's own card works
  // out backwards from the oven. The oven is the anchor: the first six pans are
  // at it at the minute she said, 8 am, which is 239 minutes after the tub. Not
  // one of these moved when the fold and the swap were put at their real end —
  // only the PACE between batches did.
  assert.equal(at("solo_mix"), "4:01 am", "the tub, 239 minutes before the oven");
  assert.equal(at("solo_fold"), "4:21 am", "the rests and the folds");
  assert.equal(at("solo_scale"), "6:24 am", "the pans oiled and the dough weighed out");
  assert.equal(at("solo_proof1"), "6:39 am", "into the proofer");
  assert.equal(at("solo_top"), "7:24 am", "the dimple and the topping");
  assert.equal(at("solo_proof2"), "7:30 am", "the proofer again");
  assert.equal(at("solo_oven"), "8:00 am", "the oven, batch one: the anchor of the whole day");
  assert.equal(at("solo_pack"), "8:57 am", "and the packing, which waits for the last fold");
  assert.equal(r.dayStartMin + of(r, "solo_oven").passes[0].at, 480,
    "8 am exactly, the minute the card counts backwards from");

  // Every module of her day runs at the same pace, so the four batches of a
  // 24-pan day line up the way the day does.
  for (const m of r.modules) {
    assert.equal(m.repeats, 4, `${m.id}: four batches, because a day of 24 is four of six pans`);
    assert.equal(m.batch, 6, `${m.id}: and every batch is the six pans of one oven load`);
    const gaps = m.passes.slice(1).map((p, i) => p.at - m.passes[i].at);
    assert.deepEqual(gaps, [87, 87, 87], `${m.id}: a batch every 87 minutes`);
  }
  // The two the corrected labour moved, read off the day itself: the fold is at
  // the END of a rest, and the swap is AFTER the bake.
  assert.deepEqual(of(r, "solo_fold").passes[0].touches.map((t) => [t.from, t.to]),
    [[51, 52], [82, 83], [113, 114]],
    "three 1-minute folds, each at the minute its 30-minute rest ends");
  assert.deepEqual(of(r, "solo_oven").passes[0].touches.map((t) => [t.from, t.to]),
    [[253, 255]], "and the 2-minute swap is the two minutes after the 13-minute bake");
});

test("87 minutes is the pace one pair of hands finishes soonest, and 81 no longer holds", () => {
  // The proofer on her own numbers would allow a batch every 40.5 minutes, and
  // her old 81-minute rhythm was the pace a single pair of hands could hold when
  // the drawing had her folding two rests early. Put the fold at the end of the
  // rest where she really does it and 81 is gone: the second rest's fold lands on
  // minute 82 and the second batch's mixing has to begin on minute 82 as well, so
  // the app puts a second person on it — and no start time for the packing can
  // undo a clash that happens that far upstream.
  for (const every of [40.5, 45, 55, 58, 60, 70, 80, 84]) {
    let anyStart = false;
    for (let s = 255; s <= 430; s += 1) if (computeScenario(soloWith(every, s)).people === 1) anyStart = true;
    assert.equal(anyStart, false,
      `a batch every ${every} min needs more than one pair of hands whatever the packing does`);
  }
  assert.equal(computeScenario(soloWith(81, 297)).people, 2,
    "and 81, the pace that used to hold, now asks for a second person");
  // The mechanism, named so a red test says why: batch one's second fold and
  // batch two's mixing are on the same minute.
  const r81 = computeScenario(soloWith(81, 297));
  assert.deepEqual(of(r81, "solo_fold").passes[0].touches.map((t) => [t.from, t.to])[1], [82, 83],
    "at 81 the second rest is folded from minute 82");
  assert.equal(of(r81, "solo_mix").passes[1].at, 82, "and batch two goes into the tub on minute 82");

  // 87 is where the day is seeded, and it is the soonest finish of any WHOLE
  // minute. The sweep is finer than whole minutes, and saying so is the point of
  // this block rather than a gap in it: 86 fails outright and 86.25 fails with
  // it, while 86.5 and 86.75 BOTH hold and both finish a shade sooner than 87 —
  // 568.5 and 569.25 against 570. The seed stays on 87 because a baker plans a
  // day in whole minutes: ninety seconds off a nine-and-a-half-hour day is not
  // worth reading every start time on the screen as half past something. So the
  // boundary is a choice she can see, not a claim the arithmetic does not support.
  const finish = (every) => {
    let soonest = null;
    for (let s = 255; s <= 520; s += 1) {
      const r = computeScenario(soloWith(every, s));
      if (r.people === 1 && (soonest === null || r.endMin < soonest)) soonest = r.endMin;
    }
    return soonest;
  };
  assert.equal(finish(87), 570, "87: the last pack ends at minute 570, half past one");
  for (const every of [88, 89, 90, 113, 116, 159, 210]) {
    assert.ok(finish(every) > 570, `a batch every ${every} min finishes later than 87 does`);
  }
  assert.equal(finish(86), null, "86 minutes holds nowhere at all");
  assert.equal(finish(86.25), null, "and neither does a quarter of a minute more");
  assert.equal(finish(86.5), 568.5, "86.5 holds, and finishes a minute and a half sooner");
  assert.equal(finish(86.75), 569.25, "86.75 too, and by three quarters of a minute");
  // Below 87 exactly one whole minute holds, and it can only pack from 9:40 am,
  // so it buys nothing back: it trades the day's whole morning for the pace.
  assert.equal(finish(85), 607, "85 holds, but only by pushing the packing to 9:40 am");
  assert.equal(of(computeScenario(ONE_BAKER_SCENARIO), "solo_proof1").everyMin, 87,
    "and the seeded rhythm is 87, the pace this day was swept to");
});

test("the packing waits for the last fold, and 8:57 is the first free minute", () => {
  // The deviation from her chain's own offsets: cutting and packing would start
  // fifteen minutes after the oven, but alone she is still folding the last tub
  // until 8:57. It is not a preference — a single minute earlier needs a second
  // pair of hands, and the clash that appears is upstream of the packing, so no
  // start time can undo it but the packing's own.
  assert.equal(ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_pack").startMin, 297,
    "8:57 am, counted from the 4 am window");
  assert.equal(computeScenario(soloWith(87, 296)).people, 2,
    "8:56 am, one minute earlier, needs two people");
  assert.equal(computeScenario(soloWith(87, 297)).people, 1, "and 8:57 am is the first minute that is hers");
  // The room she has to move it in without buying anybody, measured: four minutes
  // at the seed itself — 8:57 to 9:00 am — and three later windows in the morning
  // where it also holds, 9:44–10:02, 10:24–10:33 and 11:09–11:10. Everything
  // between is a minute where the packing would have to be in two places at once.
  const free = [];
  for (let start = 255; start <= 430; start += 1) {
    if (computeScenario(soloWith(87, start)).people === 1) free.push(start);
  }
  const runs = [];
  let runStart = free[0];
  for (let i = 1; i <= free.length; i += 1) {
    if (free[i] !== free[i - 1] + 1) { runs.push([runStart, free[i - 1]]); runStart = free[i]; }
  }
  assert.deepEqual(runs, [[297, 300], [344, 362], [384, 393], [429, 430]],
    "the packing's own free minutes, and the seed sits at the start of the first run");
  assert.equal(free.includes(296), false, "and it does not open a minute earlier");
});

test("no machine is ever doubled at her own pace", () => {
  // At one pair of hands the wall is her hands, not the cabinet — which is only
  // true if the cabinet is never asked to hold two batches at once. The fold is
  // left out on purpose: its 123 minutes are the DOUGH's, which is the criterion
  // its overlap switch is behind, so its own batches are meant to overlap.
  const r = computeScenario(ONE_BAKER_SCENARIO);
  for (const m of r.on) {
    if (m.overlap) continue;
    const ps = m.passes;
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) {
        const doubled = ps[i].at < ps[j].end && ps[j].at < ps[i].end;
        assert.equal(doubled, false, `${m.id}: batches ${i + 1} and ${j + 1} are in it at once`);
      }
    }
  }
});

test("every module of one baker day is reachable from the module editor", () => {
  // The same rule her sister's line is held to: a figure the model quietly
  // discards is a setting she cannot reach, and this scenario is hers to move.
  // The cycles are the process now, so this is where the minutes and the hands
  // are read back from — and the two mirrors beside them are checked to be the
  // sums of the cycles rather than numbers of their own.
  for (const m of ONE_BAKER_SCENARIO.modules) {
    const back = moduleOf(m);
    assert.deepEqual(back.cycles, m.cycles, `${m.id}: the cycles survive, loads and unloads and all`);
    assert.equal(back.cycleMin, back.cycles.reduce((n, c) => n + c.min, 0),
      `${m.id}: the module's minutes ARE its cycles, not a number beside them`);
    assert.equal(back.touchMin, back.cycles.reduce((n, c) => n + c.load + c.unload, 0),
      `${m.id}: and its hands are their loads and unloads`);
    assert.equal(back.batch, m.batch, `${m.id}: the batch survives`);
    assert.equal(back.everyMin, m.everyMin, `${m.id}: the pace survives`);
    assert.equal(back.repeats, m.repeats, `${m.id}: the number of batches survives`);
    assert.equal(back.startMin, m.startMin, `${m.id}: the start time survives`);
    assert.equal(back.person, m.person, `${m.id}: the person survives`);
    assert.equal(back.job, m.job || "", `${m.id}: the line step survives`);
    assert.equal(back.overlap, m.overlap === true, `${m.id}: and the fold keeps its overlap switch`);
  }
  // The fold is the one module whose minutes are the DOUGH's, not hers — which is
  // the criterion v140 put the overlap switch behind, and the reason its 123
  // minutes may sit inside an 87-minute batch rhythm at all.
  assert.equal(moduleOf(ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_fold")).overlap, true,
    "the rests and the folds are marked as the dough holding the time");
  assert.equal(of(computeScenario(ONE_BAKER_SCENARIO), "solo_fold").touchMin, 3,
    "and three of its minutes are hers: one per fold, her own number");
  // The two corrected modules, read as the cycles she would open in the editor.
  const fold = moduleOf(ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_fold"));
  assert.deepEqual(fold.cycles.map((c) => [c.min, c.load, c.unload]),
    [[31, 0, 1], [31, 0, 1], [31, 0, 1], [30, 0, 0]],
    "four rests, the first three folded at their end");
  const oven = moduleOf(ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_oven"));
  assert.deepEqual(oven.cycles.map((c) => [c.min, c.load, c.unload]),
    [[13, 0, 0], [2, 2, 0]],
    "the bake with nobody watching, then the swap in at its start");
});

test("one baker day loads her own numbers onto the Production line", () => {
  const patch = scenarioPlanPatch(ONE_BAKER_SCENARIO, null).patch;
  assert.deepEqual(patch, {
    target: 24, people: 1,
    mixMin: 20, mixerPans: 6,
    scaleMin6: 15, topMin6: 6, coolMin6: 12,
    swapMin6: 2, ovenPans: 6, ovenMin: 15,
  }, "every figure is the one she measured, not the seeded day's");
  // The fold and the two proofs are named as things the capacity screen has no
  // field for, rather than being written onto a field that means something else.
  const { unmapped } = scenarioPlanPatch(ONE_BAKER_SCENARIO, null);
  assert.deepEqual(unmapped.map((u) => u.name || u), [
    "The rests and the stretch and folds", "Into the proofer", "The proofer again",
  ], "and the three modules with no step on that screen say so by name");
});

// ── A module she has two of is two lines, and each line has its own person ───
//
// Her ask: "i want is just better drawing.. Since now one module having 2 lines,
// each line can have its own person, and few line can have a combine person
// sharing to different lines." So the arithmetic of "two of them" is untouched —
// this is the drawing and who stands at each line, and both have to be able to
// survive the trip through storage without her numbers moving.

test("a module carries a person for each line it is worked as", () => {
  // Nothing stored: every line gets the module's own person, and the module's
  // person is line 1's. One number written once, so they cannot disagree.
  assert.deepEqual(moduleOf(module({ person: 3 })).crew, [3],
    "one of a module is one line, and it is the person she named");
  assert.deepEqual(moduleOf(module({ person: 3, count: 2 })).crew, [3, 3],
    "two of them and nobody said otherwise: the same person on both, as before");
  // The array she typed is adopted only when it is exactly as long as the lines.
  assert.deepEqual(moduleOf(module({ person: 3, count: 2, crew: [1, 2] })).crew, [1, 2],
    "two lines, two people, read back as she set them");
  // Grown: the stored list is kept and the new lines take the module's person, so
  // raising how many she has never forgets who was on the lines she already had.
  assert.deepEqual(moduleOf(module({ person: 3, count: 3, crew: [1, 2] })).crew, [1, 2, 3],
    "a third one of them keeps lines 1 and 2 and gives line 3 the module's person");
  // Cut back: the extra entries are dropped rather than kept as lines that are
  // not there, because a crew longer than the lines is a line nobody can see. What
  // is KEPT is the person she set on a line that still exists — so lowering how
  // many she has never silently forgets who was standing at line 1, and raising it
  // again brings line 2's person straight back off the stored list.
  assert.deepEqual(moduleOf(module({ person: 3, count: 1, crew: [1, 2] })).crew, [1],
    "back to one of them keeps the person she had set on line 1");
  // Nonsense in storage is clamped, not carried: a person is 0…8, and 0 means
  // whoever is free — the same reading the editor and the People rows give it.
  assert.deepEqual(moduleOf(module({ person: 3, count: 2, crew: [-4, 99] })).crew, [0, 8],
    "a person outside 0…8 is clamped rather than drawn");
  // person is ALWAYS crew[0], the way startMin is always starts[0].
  assert.equal(moduleOf(module({ person: 3, count: 2, crew: [5, 6] })).person, 5,
    "the module's person is line 1's person, whether or not it was stored that way");
  // And a wrong-length list left behind by a hand-edited backup is replaced, not
  // partly adopted — half a crew is a line pointing at somebody who is not there.
  assert.deepEqual(moduleOf(module({ person: 2, count: 2, crew: "nonsense" })).crew, [2, 2],
    "a crew that is not a list is not a crew");
});

test("lines are in force only while the module's own cycles really take turns", () => {
  assert.equal(linesInForce(module({ count: 1 })), 0, "one of a module is not drawn as lines");
  assert.equal(linesInForce(module({ count: 2 })), 2, "two of them take turns, so two lines");
  assert.equal(linesInForce(module({ count: 3 })), 3, "three of them is three lines");
  // The overlap switch turns the taking-turns off, so there is only ever one lot
  // in the module — one row, one person, however many of it she has. The crew is
  // kept in storage (the editor says so), but it is not what the day is worked as.
  assert.equal(linesInForce(module({ count: 2, overlap: true })), 0,
    "free to overlap, the module is one row again");
  // A switched-off module is not worked at all, so it is not a line either.
  assert.equal(linesInForce(module({ count: 2, on: false })), 2,
    "switching a module off is the day's business, not the drawing's");
});

test("each lot knows which line it came off", () => {
  const m = moduleOf(module({ count: 2, repeats: 6, cycleMin: 28, everyMin: 30, touchMin: 2 }));
  assert.deepEqual(passesOf(m).map((p) => p.line), [0, 1, 0, 1, 0, 1],
    "two of them take the lots in turn, so the lines alternate all the way down");
  const one = moduleOf(module({ count: 1, repeats: 3 }));
  assert.deepEqual(passesOf(one).map((p) => p.line), [0, 0, 0],
    "one of a module puts every lot on its one line, exactly as it always did");
});

test("whichever line is free puts a batch exactly where taking turns did", () => {
  // Her rule is that a batch goes into whichever line is free rather than being
  // handed to the next line in turn. Every batch of a module is the same length,
  // so the line that has been free longest is always the one whose turn it is —
  // and the two rules agree on every day that can be built. This asserts that,
  // exhaustively, so a later change to the picker that would move a saved day
  // goes red here instead of silently re-drawing her week.
  const turns = (count, starts, cycleMin) => {
    const out = [];
    const own = [];
    for (let k = 0; k < starts.length; k += 1) {
      let at = starts[k];
      if (k >= count) at = Math.max(at, own[k - count]);
      out.push(k % count);
      own.push(at + cycleMin);
    }
    return out;
  };
  const seqs = [];
  const build = (len, max, cur) => {
    if (cur.length === len) { seqs.push([...cur]); return; }
    for (let v = cur.length ? cur[cur.length - 1] : 0; v <= max; v += 1) {
      cur.push(v); build(len, max, cur); cur.pop();
    }
  };
  let compared = 0;
  for (const count of [2, 3, 4]) {
    for (const cycleMin of [1, 2, 3, 5, 10]) {
      for (const len of [4, 5, 6]) {
        seqs.length = 0;
        build(len, 14, []);
        for (const starts of seqs) {
          compared += 1;
          assert.deepEqual(pickLines(count, starts, cycleMin, false), turns(count, starts, cycleMin),
            `count ${count}, span ${cycleMin}, starts ${starts.join(",")}`);
        }
      }
    }
  }
  assert.ok(compared > 700000, `the sweep really ran (${compared} rhythms compared)`);
});

test("a module with no cycles of its own reads as one cycle, to the digit", () => {
  // The migration. Every module she has ever saved, and every seeded one, carries
  // minutes and a touch and no cycles — so the model has to read each of those as
  // the single cycle it always was, or the day she has been looking at all along
  // would come back different. Proven, not asserted: the whole line is rebuilt
  // with the cycles written out by hand and every pass compared.
  const twins = [
    DEFAULT_SCENARIO,
    ONE_BAKER_SCENARIO,
    SISTER_SCENARIO,
  ];
  let checked = 0;
  for (const sc of twins) {
    for (const raw of sc.modules) {
      // A module that already carries cycles of its own is not a module this
      // migration can say anything about — its one cycle is not the point.
      if (Array.isArray(raw.cycles) && raw.cycles.length) continue;
      const legacy = moduleOf(raw);
      const spelledOut = {
        ...raw,
        cycles: [{ name: "", min: legacy.cycleMin, load: legacy.touchMin, unload: 0 }],
      };
      assert.deepEqual(passesOf(spelledOut), passesOf(raw),
        `${raw.id}: wording the one cycle out loud moves nothing`);
      assert.deepEqual(touchWindows([moduleFacts(spelledOut)]), touchWindows([moduleFacts(raw)]),
        `${raw.id}: and the hands are where they were`);
      checked += 1;
    }
  }
  // The seeded day (10) and her sister's line (8): every module of the three
  // seeded scenarios that has no cycles of its own. One baker day's eight are
  // skipped by name above, because they were authored with their cycles spelled
  // out — so this count is what stops a scenario changing shape unnoticed.
  assert.equal(checked, 18, "every cycle-less module of the three seeded scenarios was compared");
});

test("cycles are a batch's process, and the minutes and the hands add up from them", () => {
  const mod = moduleOf({
    ...module({ id: "day", repeats: 2 }),
    // A 30-minute rest folded at the end, then a 13-minute bake and the 2-minute
    // swap afterwards: the two ends of a cycle, which is what load and unload are.
    cycles: [
      { min: 30, load: 0, unload: 1 },
      { min: 13, load: 0, unload: 0 },
      { min: 2, load: 2, unload: 0 },
    ],
    // A stale mirror, deliberately wrong: the cycles win over it.
    cycleMin: 999,
    touchMin: 999,
  });
  assert.equal(mod.cycleMin, 45, "a batch is as long as its cycles, and not as long as a stale mirror");
  assert.equal(mod.touchMin, 3, "and its hands are every load and every unload in it");
  assert.deepEqual(mod.cycles.map((c) => c.min), [30, 13, 2], "the cycles are kept in her order");
  assert.deepEqual(passesOf(mod).map((p) => [p.at, p.end]), [[0, 45], [10, 55]],
    "and every batch of the module runs that same list from its own start");
  // Her own rule, from the model's side: a cycle cannot begin before the one
  // ahead of it ends, so its offset is the minutes of everything before it.
  assert.deepEqual(cycleOffsets(mod.cycles), [0, 30, 43]);
});

test("a cycle's hands are at the end she works them at, not at the module's door", () => {
  // Her own two corrections. The 30-minute rest is FOLDED AT ITS END: the dough
  // rests, then she folds it, and the old screen had her folding two rests early
  // because it put every module's hands at the module's start. And the oven's
  // 2-minute swap happens AFTER the bake, when the pans come out — the old drawing
  // had the swap at the minute the bake began.
  const rest = { name: "", min: 31, load: 0, unload: 1 };
  assert.deepEqual(cycleTouches([rest], 100), [{ from: 130, to: 131, cycle: 0, name: "" }],
    "one minute of hands, at the minute the rest ends");
  // The oven: 13 minutes of baking with nobody watching, then the swap.
  const bake = [{ name: "", min: 13, load: 0, unload: 0 }, { name: "", min: 2, load: 2, unload: 0 }];
  assert.deepEqual(cycleTouches(bake, 0), [{ from: 13, to: 15, cycle: 1, name: "" }],
    "the swap is the two minutes after the bake, named as the cycle it belongs to");
  // Both ends of one cycle: two windows, and the row can tell them apart.
  assert.deepEqual(cycleTouches([{ name: "mix", min: 20, load: 8, unload: 4 }], 0).map((w) => [w.from, w.to]),
    [[0, 8], [16, 20]], "a cycle she loads and unloads herself is two stretches of her time");
  // A cycle worked end to end is ONE window, not two that happen to touch.
  assert.deepEqual(cycleTouches([{ name: "", min: 10, load: 7, unload: 6 }], 0).map((w) => [w.from, w.to]),
    [[0, 10]], "hands from the start to the end of the cycle are one stretch");
  // And the migration's promise, read from the windows: a module with no cycles of
  // its own still has exactly the one window it always had.
  const plain = moduleFacts(module({ id: "w", repeats: 1, cycleMin: 15, touchMin: 4 }));
  assert.deepEqual(plain.passes[0].touches, [{ from: 0, to: 4, cycle: 0, name: "" }],
    "one cycle, one window, at the module's own start, exactly as before");
  assert.deepEqual(touchWindows([plain]).map((w) => [w.from, w.to]), [[0, 4]]);
});
test("two lines give their odd lots to one person and their even lots to the other", () => {
  const r = computeScenario(scenario({
    modules: [module({ id: "fold", count: 2, crew: [1, 2], repeats: 4, cycleMin: 20, everyMin: 30, touchMin: 2 })],
  }));
  const wins = touchWindows(r.on);
  // Four lots, two lines, two people: lots 1 and 3 to person 1, lots 2 and 4 to
  // person 2 — the lines take the lots in turn, so the people do too.
  assert.deepEqual(wins.map((w) => [w.person, w.line]), [[1, 0], [2, 1], [1, 0], [2, 1]],
    "the lines carry their own people, and each lot says which line it came off");
  const rows = peopleRows(r.on);
  assert.equal(rows.length, 2, "two lines with two people is two rows, not one");
  assert.deepEqual(rows.map((row) => row.person), [1, 2]);
  // Each of them is at ONE module — which is the count she asked this feature for,
  // because one person should not have to wear every hat in the day.
  assert.deepEqual(rows.map((row) => new Set(row.items.map((w) => w.module)).size), [1, 1],
    "each worker is at one line of one module");
});

test("the same person on both lines is one person, and a real clash says so", () => {
  // Both lines on person 1 with minutes that do not meet: one row, and every lot
  // still on it. One person covering two lines is what she asked for.
  const apart = computeScenario(scenario({
    modules: [module({ id: "fold", count: 2, crew: [1, 1], repeats: 4, cycleMin: 10, everyMin: 30, touchMin: 4 })],
  }));
  const rows = peopleRows(apart.on);
  assert.equal(rows.length, 1, "the same number on two lines is one person, not two");
  assert.equal(rows[0].items.length, 4, "and every lot is still on their row");
  assert.equal(rows[0].clashes.length, 0, "half an hour apart, so nothing of theirs collides");
  // Both lines on person 1 with minutes that DO meet — 35 minutes of hands inside
  // a 40-minute pass, with the next lot starting at 30. Same one row, now wearing
  // the collision: the honest answer, and what she slides the modules apart to fix.
  const clash = computeScenario(scenario({
    modules: [module({ id: "fold", count: 2, crew: [1, 1], repeats: 4, cycleMin: 40, everyMin: 30, touchMin: 35 })],
  }));
  const clashed = peopleRows(clash.on);
  assert.equal(clashed.length, 1, "one person is still one row");
  assert.ok(clashed[0].clashes.length > 0, "two of their own lines in the same minute is a clash");
  assert.equal(clashed[0].clashes[0].after.line, 1, "and the clash names the line that came second");
});

test("a person's places count the lines they are on, not just the modules", () => {
  // The fix: one person on BOTH lines of one module is in two places, and the count
  // of modules alone read that as one — so the doubling-up she is planning down was
  // the one thing the row said nothing about.
  const both = computeScenario(scenario({
    modules: [module({ id: "fold", count: 2, crew: [1, 1], repeats: 4, cycleMin: 10, everyMin: 30, touchMin: 4 })],
  }));
  const one = peopleRows(both.on);
  assert.equal(one.length, 1, "the same number on two lines is still one person");
  assert.equal(one[0].items.length, 4, "on all four lots");
  assert.equal(new Set(one[0].items.map((w) => w.module)).size, 1,
    "one module, which is what the old count saw");
  assert.equal(placesOn(one[0]), 2, "and two places, which is what she is counting");
  // Two lines, two people: each of them is in ONE place, so the count she is
  // driving to is a real answer and not just "the module again".
  const split = computeScenario(scenario({
    modules: [module({ id: "fold", count: 2, crew: [1, 2], repeats: 4, cycleMin: 10, everyMin: 30, touchMin: 4 })],
  }));
  assert.deepEqual(peopleRows(split.on).map(placesOn), [1, 1],
    "one person per line is one place each");
  // A module she has one of has no lines to count, so it counts as one place
  // whether or not anybody is named on it — every scenario built before lines
  // existed reads exactly as it did.
  const plain = computeScenario(scenario({
    modules: [module({ id: "fold", person: 2, repeats: 3, cycleMin: 10, everyMin: 20, touchMin: 3 })],
  }));
  assert.deepEqual(peopleRows(plain.on).map(placesOn), [1], "one module is one place");
  // Two modules really are two places, which the old count did get right.
  const two = computeScenario(scenario({
    modules: [
      module({ id: "a", person: 1, repeats: 1, cycleMin: 10, everyMin: 60, touchMin: 5 }),
      module({ id: "b", person: 1, startMin: 100, repeats: 1, cycleMin: 10, everyMin: 60, touchMin: 5 }),
    ],
  }));
  assert.deepEqual(peopleRows(two.on).map(placesOn), [2], "two modules is two places");
});

test("a module that is not drawn as lines gives the windows it always gave", () => {
  // The whole promise of this release: with no lines and no crew — which is every
  // module she has — the day is computed exactly as it was before the field existed.
  const bare = computeScenario(scenario({
    modules: [module({ id: "fold", person: 2, repeats: 3, cycleMin: 10, everyMin: 20, touchMin: 3 })],
  }));
  const crewed = computeScenario(scenario({
    modules: [module({ id: "fold", person: 2, crew: [2], repeats: 3, cycleMin: 10, everyMin: 20, touchMin: 3 })],
  }));
  assert.deepEqual(touchWindows(crewed.on), touchWindows(bare.on),
    "spelling the crew out says nothing the module did not already say");
  assert.deepEqual(concurrency(crewed.on), concurrency(bare.on), "and the day's hands are untouched");
});

test("copying a scenario copies the line crews, deeply", () => {
  const sc = scenario({
    modules: [module({ id: "fold", person: 1, count: 2, crew: [1, 2], repeats: 4 })],
  });
  const copy = copyScenario(sc, "A copy", "two");
  assert.deepEqual(copy.modules[0].crew, [1, 2], "the copy has the crew");
  copy.modules[0].crew[1] = 7;
  assert.deepEqual(sc.modules[0].crew, [1, 2],
    "and it is the copy's own array, so dragging in one scenario cannot rewrite the other");
});

test("combining two people moves their lines, and nobody is left pointing at a gone row", () => {
  const sc = scenario({
    modules: [
      module({ id: "fold", person: 2, count: 2, crew: [2, 5], repeats: 4 }),
      module({ id: "bake", person: 5, count: 1, repeats: 2 }),
    ],
  });
  const next = combinedScenario(sc, 2, 5);
  const fold = next.modules.find((m) => m.id === "fold");
  assert.deepEqual(fold.crew, [2, 2], "person 5's line becomes person 2's line");
  assert.equal(fold.person, 2, "and the module's own person follows line 1");
  assert.deepEqual(next.modules.find((m) => m.id === "bake").crew, [2],
    "the other module 5 was at moves with them");
  // 5 is now covered by 2, so their row is gone and the combination says who took
  // them — which is what makes the People list read as the day being worked.
  assert.deepEqual(next.merges, { 2: [5] }, "5 is combined into 2");
  // A person who was only ever on somebody's line 2 is still being covered — the
  // test for "is this person free now" has to read the crew, not just `person`.
  assert.deepEqual(combinedScenario(sc, 2, 5).merges, { 2: [5] });
  assert.deepEqual(sc.modules[0].crew, [2, 5], "and the scenario she was looking at is not edited in place");
  // Combining a person 2 already covers adds them rather than replacing them.
  assert.deepEqual(combinedScenario({ ...sc, merges: { 2: [4] } }, 2, 5).merges, { 2: [4, 5] },
    "what 2 already covered is kept, and the list stays in order");
});

test("one stretch of one batch changes hands, and nothing beside it does (v161)", () => {
  // Her correction of 23 September, after v160 shipped the move at module level:
  // "The reassign job to next person is not whole day, it is that slot only", and
  // then, asked what one tap should take with it, "we dont change the batch. Say a
  // labour slot belongs to person1, clicking that slot, will offer to swap it to
  // others, this basically to balance work load". The work itself is here, as one
  // pure answer, so the chart and the module editor cannot disagree about who is
  // standing where.
  //
  // So the write is per STRETCH — the batch she tapped and which stretch of it —
  // and it leaves the module's own person, its crew and its times exactly as they
  // were. A module that runs four batches has four of its stretches on one person,
  // and handing one over is handing one over.
  const sc = scenario({
    modules: [
      module({ id: "mix", person: 2, count: 2, crew: [2, 5], repeats: 3 }),
      module({ id: "bake", person: 5, count: 1, repeats: 2 }),
    ],
  });
  const held = JSON.stringify(sc);
  const next = reassignSlot(sc, "mix", 1, 0, 7);
  const mix = of(next, "mix");
  assert.deepEqual(mix.slotPerson, { "1.0": 7 }, "the stretch she tapped is not the one that changed hands");
  assert.deepEqual(mix.crew, [2, 5], "a stretch handed over changed a production line's person with it");
  assert.equal(mix.person, 2, "a stretch handed over changed the module's own person");
  assert.equal(JSON.stringify(sc), held, "and the scenario she was looking at was edited in place");

  // A second hand-over keeps the first, and brings nobody else's module with it.
  const two = reassignSlot(next, "mix", 2, 1, 4);
  assert.deepEqual(of(two, "mix").slotPerson, { "1.0": 7, "2.1": 4 }, "a second hand-over dropped the first");
  assert.deepEqual(of(two, "bake").slotPerson, {}, "a stretch on one module moved somebody else's module");

  // The number is held to the eight a day can hold, exactly as every other way of
  // naming a person is.
  assert.deepEqual(reassignSlot(sc, "mix", 0, 0, 99).modules[0].slotPerson, { "0.0": 8 },
    "a person out of range was taken");
});

test("a hand-over moves the one stretch onto the other person's row (v161)", () => {
  // The same answer read the way the chart reads it, because the rows are built
  // from these windows and nothing else. The fold is the case her own day is full
  // of: one batch, three stretches of hands at it, three markers on the row.
  // Three folds of one minute each, so one batch of this module draws three
  // separate stretches of hands — which is the shape that makes "one slot" and
  // "one batch" different answers. The pace is wide enough that the two batches
  // fall nowhere near each other, so the day begins clean.
  const fold = () => module({
    id: "fold", name: "The fold loop", person: 1, repeats: 2, everyMin: 200,
    cycles: [
      { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
      { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
      { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
    ],
  });
  const sc = scenario({ modules: [fold()] });
  const before = peopleRows(computeScenario(sc).on);
  assert.equal(before.length, 1, "the day does not begin as one person's");
  assert.equal(before[0].items.length, 6, "two batches of three stretches is not six windows");

  // Batch 0's third stretch — the second fold of the first batch — to person 2.
  const moved = scenario({ modules: [fold()] });
  const next = reassignSlot(moved, "fold", 0, 2, 2);
  const rows = peopleRows(computeScenario(next).on);
  const one = rows.find((x) => x.person === 1);
  const two = rows.find((x) => x.person === 2);
  assert.ok(two, "the stretch did not land on a row of its own");
  assert.equal(two.items.length, 1, "more than the one stretch she handed over moved");
  assert.equal(one.items.length, 5, "the stretches beside it did not stay where they were");
  // And it is the RIGHT one: the windows carry which batch and which stretch of it
  // they are, so the moved window is the one her finger was on.
  assert.deepEqual([two.items[0].batch, two.items[0].slot], [0, 2], "the wrong stretch changed hands");
  assert.equal(two.items[0].module, "fold", "the stretch that moved came off another module");

  // A module nobody was ever put on can still be handed one stretch — and given it
  // back. 0 is stored rather than dropped, because "whoever is free" is a real
  // answer and is the only way back to the day's own arrangement.
  const bare = scenario({ modules: [fold()] });
  const given = reassignSlot(bare, "fold", 0, 0, 3);
  assert.deepEqual(of(given, "fold").slotPerson, { "0.0": 3 });
  const back = reassignSlot(given, "fold", 0, 0, 0);
  assert.deepEqual(of(back, "fold").slotPerson, { "0.0": 0 },
    "giving a stretch back to whoever is free did not survive as its own answer");
  assert.equal(peopleRows(computeScenario(back).on).length, 1,
    "a stretch given back to whoever is free was not picked up by the day again");
});

test("a hand-over survives being read back, and is dropped when it means nothing (v161)", () => {
  const sc = scenario({
    modules: [module({ id: "mix", person: 2, repeats: 3 })],
  });
  const next = reassignSlot(sc, "mix", 1, 0, 7);
  // The round trip every screen makes: what she saved is what the next phone reads.
  const read = scenarioOf(next);
  assert.deepEqual(read.modules[0].slotPerson, { "1.0": 7 }, "the hand-over did not survive a re-read");
  assert.deepEqual(moduleOf(moduleOf(read.modules[0])).slotPerson, { "1.0": 7 },
    "reading the module twice gives two answers about who holds a stretch");
  // And a hand-edited import can put nothing but a batch and a stretch in it.
  const junk = scenarioOf({ ...DEFAULT_SCENARIO, modules: [{ ...module({ id: "mix" }), slotPerson: {
    "1.0": 4, "x": 4, "-1.0": 4, "1": 4, "0.0.0": 4, "2.1": "3",
  } }] });
  assert.deepEqual(junk.modules[0].slotPerson, { "1.0": 4, "2.1": 3 },
    "a key that is not a batch and a stretch was kept");
});


test("the lines never reach the Production line's plan", () => {
  // The bridge to the Production line reads named facts, not the module objects —
  // so a crew, which is a planner idea, cannot leak into the day it measures. The
  // guard is that the same modules, with lines and crews, carry the identical plan.
  const bare = scenarioPlanPatch(DEFAULT_SCENARIO, {}).patch;
  const withLines = DEFAULT_SCENARIO.modules.map((m) => (
    m.id === "mixer" ? { ...m, count: 2, crew: [1, 2] } : m
  ));
  const patch = scenarioPlanPatch({ ...DEFAULT_SCENARIO, modules: withLines }, {}).patch;
  assert.deepEqual(patch, bare, "two of them and two people move no number on the other screen");
  assert.equal(Object.keys(patch).some((k) => k === "crew" || k === "lines"), false,
    "the plan carries pans and minutes, not lines and people");
  // And the figure the pinned test above rests on is untouched.
  assert.equal(patch.mixerPans, 28, "two of them still buys cycles out of the same planned pans");
  assert.equal(patch.ovenPans, 6, "and the oven is where it always was");
});

// ── A module can be doubled, and every cycle has its own time ───────────────
//
// The three things she asked for by number: two of a module when it is the
// bottleneck, a start time of its own for every cycle, and "cycle 10 of this
// module cannot start until cycle 10 of the module before it has finished".
//
// The load-bearing claim under all of it is a NEGATIVE one, and it is the first
// test here: with nothing set to wait and one of every module, the model must
// answer exactly what it answered before any of this existed. Everything she
// already reasons with -- twelve pans, the chiller in the wall -- hangs on it.

test("a module she has one of, that waits for nothing, is the module it always was", () => {
  const r = computeScenario(DEFAULT_SCENARIO);
  for (const f of r.modules) {
    // The list is built from the same sum the day was always placed with, so a
    // module nobody has dragged sits exactly where `startMin + k x everyMin` put
    // it -- to the last hundredth of a minute.
    const spread = Array.from({ length: f.repeatsHeld }, (_, k) => f.startMin + k * f.everyMin);
    near(f.passes.length, spread.length, `${f.id}: the same number of cycles`);
    f.passes.forEach((p, k) => near(p.at, spread[k], `${f.id} cycle ${k + 1} is where it always was`));
  }
  // And the chained answer for a line with no chain is the line itself.
  const chained = chainLine(scenarioOf(DEFAULT_SCENARIO).modules);
  scenarioOf(DEFAULT_SCENARIO).modules.forEach((m, i) => {
    assert.deepEqual(chained[i].starts, m.starts, `${m.id}: nothing moved`);
  });
});

test("a cycle can be moved on its own, and the module keeps its shape", () => {
  // Cycle 2 of the fold pushed to 90 minutes: the others stay where they were,
  // which is the whole point of a list rather than a formula.
  const moved = { ...module({ id: "f", cycleMin: 28, batch: 28, touchMin: 2, everyMin: 30, repeats: 4, startMin: 30 }), starts: [30, 90, 90, 120] };
  const m = moduleFacts(moved);
  assert.deepEqual(m.passes.map((p) => p.at), [30, 90, 90, 120]);
  // And the day is as long as the LATEST cycle makes it, not as long as the
  // formula would have guessed — a cycle dragged later lengthens the day.
  assert.equal(m.endMin, 148, "120 + 28, the last cycle's own end");
});

test("typing a start time moves the whole module, dragged cycles and all", () => {
  // A start-time box and a drag are two ways to say one thing, so a typed number
  // must never be silently ignored by a list that is out of date. The module
  // moves; the shape she dragged comes with it.
  const dragged = module({ id: "f", cycleMin: 28, batch: 28, touchMin: 2, everyMin: 30, repeats: 4, startMin: 30, starts: [30, 90, 90, 120] });
  const retyped = moduleOf({ ...dragged, startMin: 130 });
  assert.deepEqual(retyped.starts, [130, 190, 190, 220], "every cycle moved by the same hundred minutes");
  // Which also means a module whose list disagrees with its cycle count is
  // repaired rather than believed.
  assert.deepEqual(moduleOf({ cycleMin: 10, everyMin: 10, repeats: 3, startMin: 0, starts: [0, 10, 20, 30, 40] }).starts, [0, 10, 20]);
  assert.deepEqual(moduleOf({ cycleMin: 10, everyMin: 10, repeats: 3, startMin: 5, starts: [5] }).starts, [5, 15, 25]);
});

test("cycle 10 waits for the module above to finish its cycle 10", () => {
  // The rule she wrote, on a line of two modules: mix four lots, then fold four
  // lots. The fold's first lot cannot start until the mix's first lot is out,
  // and the second fold waits on the second mix — not on the fold before it.
  const mix = module({ id: "mix", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 4, startMin: 0 });
  const fold = { ...module({ id: "fold", cycleMin: 28, batch: 6, touchMin: 2, everyMin: 30, repeats: 4, startMin: 0 }), follow: true };
  const r = computeScenario(scenario({ modules: [mix, fold] }));
  const f = of(r, "fold");
  assert.deepEqual(f.passes.map((p) => p.at), [20, 50, 80, 110],
    "each fold lot starts the minute its own lot left the mixer");
  // The mixer keeps its own pace: nothing waits for the mixer.
  assert.deepEqual(of(r, "mix").passes.map((p) => p.at), [0, 30, 60, 90]);
});

test("pushing one lot later carries that lot down the whole line", () => {
  // She drags the mixer's third lot later and the whole line re-forms around it.
  // No cascade code does this: the fold simply asks what the mixer has finished.
  const mix = { ...module({ id: "mix", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 4, startMin: 0 }), starts: [0, 30, 120, 150] };
  const fold = { ...module({ id: "fold", cycleMin: 28, batch: 6, touchMin: 2, everyMin: 30, repeats: 4, startMin: 0 }), follow: true };
  const r = computeScenario(scenario({ modules: [mix, fold] }));
  assert.deepEqual(of(r, "mix").passes.map((p) => p.at), [0, 30, 120, 150]);
  assert.deepEqual(of(r, "fold").passes.map((p) => p.at), [20, 50, 140, 170],
    "the fold's third and fourth lots moved with the mixer's, and the first two did not");
});

test("a module above with fewer cycles holds the extra ones at its last", () => {
  // Four mixes feeding six folds. Lots five and six have no counterpart above to
  // wait for, so they wait on the last lot that does exist -- the model names the
  // rule rather than inventing a time for a mix the mixer never runs.
  //
  // What the rule buys is both lots starting no earlier than the mixer's last lot
  // ending at 110: on the fold's own 10-minute rhythm they would have gone at 40
  // and 50, i.e. folding dough the mixer had not mixed. The floor is the chain,
  // but this fold's own one-lot-at-a-time rule is stronger than it, so lots four,
  // five and six queue behind the lot before them -- 138 and 166, not 110 three
  // times over. The next test is the switch that takes that own rule off.
  const mix = module({ id: "mix", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 4, startMin: 0 });
  const fold = { ...module({ id: "fold", cycleMin: 28, batch: 6, touchMin: 2, everyMin: 10, repeats: 6, startMin: 0 }), follow: true };

  const r = computeScenario(scenario({ modules: [mix, fold] }));
  const at = of(r, "fold").passes.map((p) => p.at);
  assert.deepEqual(at, [20, 50, 80, 110, 138, 166]);
  assert.ok(at.slice(3).every((t) => t >= 110), "no lot four, five or six before the mixer's last lot ends");
  // The mixer itself keeps its own pace -- nothing waits on the fold.
  assert.deepEqual(of(r, "mix").passes.map((p) => p.at), [0, 30, 60, 90]);
});

test("a module holds its own lots apart until she says its cycles may overlap", () => {
  // Her words: "allow overlap button and the overlapping criteria". Off -- where
  // every module starts, and every module she already has -- one lot at a time: a
  // fold cannot begin lot two until lot one is out. That is the right rule when the
  // dough is physically IN the thing, and the wrong one when the 28 minutes are
  // mostly the dough RESTING between folds. Switched on, her own times stand and
  // the chain above is the only thing left that can move a lot.
  const mix = module({ id: "mix", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 4, startMin: 0 });
  const apart = { ...module({ id: "fold", cycleMin: 5, batch: 6, touchMin: 2, everyMin: 10, repeats: 6, startMin: 0 }), follow: true };
  const free = { ...apart, overlap: true };

  const held = computeScenario(scenario({ modules: [mix, apart] }));
  const loose = computeScenario(scenario({ modules: [mix, free] }));
  assert.deepEqual(of(held, "fold").passes.map((p) => p.at), [20, 50, 80, 110, 115, 120],
    "switched off, each fold waits for the fold before it");
  assert.deepEqual(of(loose, "fold").passes.map((p) => p.at), [20, 50, 80, 110, 110, 110],
    "switched on, the fold's own lots are hers, and the chain is all that is left");
  assert.ok(of(loose, "fold").passes.slice(3).every((p) => p.at >= 110),
    "and never before the dough exists: the mixer's last lot ends at 110");
  // How many of these you have is NOT this switch: two folds means two lots at
  // once, which is one lot per module, not every lot at once.
  const two = computeScenario(scenario({ modules: [mix, { ...apart, count: 2 }] }));
  assert.deepEqual(of(two, "fold").passes.map((p) => p.at), [20, 50, 80, 110, 110, 115],
    "two modules: lot three may start while lot one is still folding, lot four may not");
  assert.equal(of(two, "fold").output, of(held, "fold").output, "and a second one never plans pans she did not");
});

test("a module she has said may overlap sits on her own rhythm, all of it at once", () => {
  // A 28-minute pass on a 10-minute rhythm is a module in two or three lots at once,
  // and this is the switch's whole point: dough resting between folds, a second bin
  // on the go. Switched on, her rhythm is passed through and the screen draws the
  // lots in lanes so all of them can be seen.
  const solo = module({ id: "s", cycleMin: 28, batch: 6, touchMin: 2, everyMin: 10, repeats: 4, startMin: 0 });
  const lot = { ...solo, overlap: true };
  const m = of(computeScenario(scenario({ modules: [lot] })), "s");
  assert.deepEqual(m.passes.map((p) => p.at), [0, 10, 20, 30]);
  assert.deepEqual(m.passes.map((p) => p.end), [28, 38, 48, 58]);
  // Three of the four are in the module at once at minute 20, which is what the
  // lanes on the timeline are for.
  const live = m.passes.filter((p) => p.at <= 20 && p.end > 20).length;
  assert.equal(live, 3);
  // And the day is as long as the last lot makes it, not as long as the rhythm
  // alone would suggest.
  assert.equal(m.endMin, 58);
  // Switched off, the same module on the same rhythm queues instead, because a lot
  // cannot begin until the one before it is out of the module.
  const queued = of(computeScenario(scenario({ modules: [solo] })), "s");
  assert.deepEqual(queued.passes.map((p) => p.at), [0, 28, 56, 84]);
  assert.equal(queued.endMin, 112, "and the day is longer for it, which is the trade she is being shown");
});

test("a switched-off module is not in the build, so nothing waits on it", () => {
  // The fridge parked, and the oven waiting on the fold rather than on a machine
  // that is not switched on -- which is what happens at the bench.
  const mix = module({ id: "mix", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 2, startMin: 0 });
  const off = { ...module({ id: "mid", cycleMin: 20, batch: 6, touchMin: 5, everyMin: 30, repeats: 2, startMin: 0 }), on: false };
  const oven = { ...module({ id: "oven", cycleMin: 15, batch: 6, touchMin: 0, everyMin: 30, repeats: 2, startMin: 0 }), follow: true };
  const r = computeScenario(scenario({ modules: [mix, off, oven] }));
  assert.deepEqual(of(r, "oven").passes.map((p) => p.at), [20, 50], "it waits on the mixer, not on the parked module");
});

test("a second module is more room in the day, and never pans she did not plan", () => {
  const one = moduleFacts({ id: "r", cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 5, count: 1 });
  const two = moduleFacts({ id: "r", cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 5, count: 2 });
  assert.equal(one.fitsInDay, 2);
  assert.equal(two.fitsInDay, 4, "two chillers hold two days' worth of twelve-hour retards");
  assert.equal(two.rate, one.rate * 2, "and pass them twice as fast");
  // What a second one does NOT do: invent cycles. She planned five and the day
  // now holds four, so four is what it passes -- the fifth is still hers to ask
  // for by raising how many times the module runs.
  assert.equal(two.repeatsHeld, 4);
  assert.equal(two.output, 48);
  assert.equal(two.perPan, one.perPan, "and a pan still costs the same minutes of it");
  // At one of it, every number is the number it was before `count` existed.
  const plain = moduleFacts({ id: "r", cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 5 });
  assert.equal(plain.fitsInDay, one.fitsInDay);
  assert.equal(plain.rate, one.rate);
  assert.equal(plain.output, one.output);
});

test("overlapping lots are only flagged when her own hands are really in two places", () => {
  // The honest half of the overlap switch. A module's pass
  // window is the whole cycle, but the minutes that need a PERSON are the touch —
  // so two lots resting at once cost nobody anything, and only a module she is
  // hands-on for the whole pass doubles her up. Same person, same overlap, two
  // different answers, and the difference is the touch minutes she typed.
  const resting = scenario({ modules: [{ ...module({ id: "fold", cycleMin: 28, batch: 6, touchMin: 2, everyMin: 10, repeats: 3, person: 1, overlap: true }), follow: false }] });
  const handsOn = scenario({ modules: [{ ...module({ id: "wash", cycleMin: 18, batch: 6, touchMin: 18, everyMin: 9, repeats: 3, person: 1, overlap: true }), follow: false }] });

  const rest = computeScenario(resting).rows.find((r) => r.person === 1);
  assert.equal(rest.clashes.length, 0, "three lots resting at once are not three of her at once");
  assert.equal(rest.busy, 6, "three passes, two minutes of her each");

  const worked = computeScenario(handsOn).rows.find((r) => r.person === 1);
  assert.equal(worked.clashes.length, 2, "nine minutes apart on an eighteen-minute job is a real collision");
  assert.equal(worked.busy, 36, "and the row counts the union, not 18+18+18");
});

test("a saved scenario keeps its own cycles, not a shared copy of them", () => {
  // `starts` is a list, so a shallow copy would give both scenarios the same one
  // and dragging a cycle in one would silently move the other.
  const sc = scenarioOf({ ...DEFAULT_SCENARIO, modules: [module({ id: "b", cycleMin: 28, batch: 28, touchMin: 2, everyMin: 30, repeats: 3, startMin: 30 })] });
  const copy = copyScenario(sc, "A copy", "two");
  assert.deepEqual(copy.modules[0].starts, sc.modules[0].starts);
  copy.modules[0].starts[1] = 999;
  assert.notEqual(sc.modules[0].starts[1], 999, "editing the copy cannot move the original");
});

test("a scenario saved before cycles existed can still be copied", () => {
  // Every module on her phone today has no `starts` list at all -- the field did
  // not exist when it was saved. Copying a scenario must not assume it is there,
  // and the copy must read the same day it did: the module's own start and pace
  // generate the cycles, which is exactly what it did before.
  const old = { ...DEFAULT_SCENARIO, modules: [{
    id: "b", icon: "🧱", name: "An old module", on: true, job: "", person: 0,
    cycleMin: 28, batch: 28, touchMin: 2, everyMin: 30, repeats: 3, startMin: 30, people: 1,
  }] };
  const copy = copyScenario(scenarioOf(old), "A copy", "two");
  assert.deepEqual(copy.modules[0].starts, [30, 60, 90], "the module's own start and pace, as they always were");
  const before = computeScenario(old);
  const after = computeScenario(scenarioOf({ ...copy, id: "" }));
  assert.equal(after.pansPerDay, before.pansPerDay);
  assert.deepEqual(
    after.on.map((m) => [m.id, m.startMin, m.endMin]),
    before.on.map((m) => [m.id, m.startMin, m.endMin]));
});

test("the ladder will buy a second module rather than promise a cycle a day cannot hold", () => {
  // The buying rung exists for exactly one case: the day is full. It must raise
  // the cycle count too -- a second chiller holds twice the bins but it does not
  // run cycles she never planned -- and it must still respect the day.
  const retard = { id: "r", cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 2, count: 1 };
  const climb = climbSteps(scenario({ target: 36, modules: [retard] }), 36);
  assert.equal(climb.reached, true);
  assert.equal(climb.steps[0].kind, "count", "there is no room left for another cycle, so it buys");
  const after = climb.end.modules.find((m) => m.id === "r");
  assert.equal(after.count, 2);
  assert.equal(after.repeats, 3, "and the cycles that second one makes room for");
  assert.ok(after.repeatsHeld <= after.fitsInDay, "and still nothing a day cannot hold");
  assert.equal(climb.end.pansPerDay, 36);
});

// ── The time cursor (v143, to the minute since v158) ────────────────────────
// The hairline she runs down the day to read the clock at a point. It is a
// READING, so the only thing it may ever get wrong is the number it shows — and
// this is that number, worked out from the scale she picked rather than read off
// the screen. Since v158 it reads the MINUTE the pointer is really on: it used to
// round to fives, which is the step the batch buttons take by FIVE AND BY ONE, so
// the cursor was stricter than the screen it was reading and named a time no
// closer than the ruler beside it. It still gives up rather than guessing past
// either end of the day.
test("the time cursor reads the clock to the minute (v158)", () => {
  // 1.6 px a minute is the scale the screen opens at, so 160px along the day is
  // 100 minutes in — and it must say 100, not the 160 px it was handed.
  assert.equal(minuteAtPx(160, 1.6, 720), 100);
  // To the minute: 101 and 104 minutes are 101 and 104, where the five-minute snap
  // read them as 100 and 105 — two readings the ruler could not have shown her.
  assert.equal(minuteAtPx(162, 1.6, 720), 101, "101 minutes in is read as 101, not 100");
  assert.equal(minuteAtPx(166, 1.6, 720), 104, "104 minutes in is read as 104, not 105");
  // And it is counted from the start of HER day, so the two together are the
  // reading she sees: her day's start plus the minute the cursor is standing on.
  const t = minuteAtPx(200, 1.6, 720);
  assert.equal(t, 125);
  assert.equal(clockOf(DEFAULT_DAY_START + t), clockOf(DEFAULT_DAY_START + 125));
});

test("the time cursor gives up rather than naming a time off the day (v143)", () => {
  // Past either end there is no time to read, and the caller is told so with a
  // null rather than with a number clamped to the edge — that is what lets the
  // cursor be taken away instead of lying against the last minute of the day.
  assert.equal(minuteAtPx(-4, 1.6, 720), null, "left of the day's first minute");
  assert.equal(minuteAtPx(720 * 1.6 + 20, 1.6, 720), null, "past the end of the day");
  assert.equal(minuteAtPx(720 * 1.6, 1.6, 720), 720, "the last minute itself is still a time");
  // A day that does not end on a five stops at its own last minute, which since
  // v158 is a minute it can name rather than the five below it.
  assert.equal(minuteAtPx(722 * 2, 2, 722), 722);
  // A chart with no scale on it has no times on it at all.
  assert.equal(minuteAtPx(100, 0, 720), null);
});

// ── The way down (v149) ─────────────────────────────────────────────────────
// The climb could raise a day to a number and could not bring it back down: every
// rung adds a batch and not one of them takes a batch away. Her report, 22 Sep
// 2026, on a One baker day she had climbed to 36 and then asked for 24: "this does
// not agrees?" — a card reading "already makes your 24 pans" directly under a line
// saying the day makes 36, with nothing to press anywhere on it.
//
// Coming down is one move rather than a ladder, and that is the arithmetic: the
// day is the LEAST any module turns out, so every module sitting on that least is
// holding it there, and lowering all of them to what the target needs lands the
// day on the number at once.

// Her own day, raised the way the climb raises it, so these tests start from the
// day she was actually looking at rather than from a number typed in here.
function raisedTo(scenario, want) {
  const climb = climbSteps(scenario, want);
  const out = copyScenario(scenario);
  for (const s of climb.steps) {
    out.modules = out.modules.map((m) => (m.id === s.id ? { ...m, ...(s.patch || { repeats: s.to }) } : m));
  }
  return out;
}

test("the way down brings the day to her number in one move (v149)", () => {
  const day = raisedTo(ONE_BAKER_SCENARIO, 36);
  assert.equal(computeScenario(day).pansPerDay, 36, "the climb did take her day to 36");
  const down = descentSteps(day, 24);
  assert.equal(down.steps.length, 1, "coming down is one settling move, not a ladder");
  assert.equal(down.reached, true);
  assert.equal(down.end.pansPerDay, 24);
  const step = down.steps[0];
  assert.equal(step.before, 36);
  assert.equal(step.after, 24);
  // Every module at the day's own number moves, because any one left high would
  // only become the wall again the moment the others came down.
  assert.equal(step.items.length, 8, "all eight modules are holding the day up");
  assert.ok(step.items.every((it) => it.from === 6 && it.to === 4), "six batches down to four, in every one");
  assert.ok(step.items.every((it) => it.batch === 6), "and at six pans a batch, unchanged");
});

test("the way down takes nothing off a day already at her number (v149)", () => {
  // Already there: nothing to move, and nothing offered to press. Asking for MORE
  // than the day makes is the climb's job, and this half must stay out of it.
  assert.deepEqual(descentSteps(ONE_BAKER_SCENARIO, 24).steps, []);
  assert.equal(descentSteps(ONE_BAKER_SCENARIO, 24).reached, false);
  assert.deepEqual(descentSteps(ONE_BAKER_SCENARIO, 36).steps, []);
  assert.equal(descentSteps(ONE_BAKER_SCENARIO, 0).steps.length, 0, "no number asked for, no way down");
});

test("the way down leaves the batch times she has dragged exactly where she put them (v149)", () => {
  // The one place the two directions deliberately differ. Raising a count is a new
  // rhythm, so the climb re-spaces a module's times from its start. LOWERING one
  // only takes batches off the END of the day, so the times she has already dragged
  // have to survive the move untouched.
  const day = raisedTo(ONE_BAKER_SCENARIO, 36);
  // She has dragged the mixing's third batch an hour later than its own rhythm.
  day.modules = day.modules.map((m) => (m.id === "solo_mix" ? { ...m, starts: [1, 88, 235, 262, 349, 436] } : m));
  const down = descentSteps(day, 24);
  // Applied the way the screen applies it: `repeats` and nothing else.
  const applied = {
    ...day,
    modules: day.modules.map((m) => {
      const it = down.steps[0].items.find((x) => x.id === m.id);
      return it ? { ...m, repeats: it.to } : m;
    }),
  };
  const mix = scenarioOf(applied).modules.find((m) => m.id === "solo_mix");
  assert.equal(mix.repeats, 4, "the mixing runs four batches");
  assert.deepEqual(mix.starts, [1, 88, 235, 262], "and her dragged batch is still at the minute she put it");
});

test("the way down says why when a batch is bigger than the number she wants (v149)", () => {
  // Six pans a batch, one batch a day, and she asks for three pans. Running fewer
  // batches cannot get there — one batch is already six — so there is no move to
  // offer and the card has to say that rather than show a button that would do
  // nothing. The mirror of the climb stopping at a day's own limit.
  const day = {
    ...ONE_BAKER_SCENARIO,
    modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, repeats: 1 })),
  };
  const down = descentSteps(day, 3);
  assert.equal(down.steps.length, 0, "nothing to press");
  assert.equal(down.reached, false);
  assert.equal(down.tooBig.batch, 6, "and the reason is the size of one batch");
  assert.equal(down.end.pansPerDay, 6, "the day is left exactly where it was");
});

// ── A new module arrives filled in (v151) ──────────────────────────────────
// Her ask, 22 Sep 2026: *"default: Cycle1: Minutes=20, load=20,unload=0"*, the
// pace *"should be empty? Or Auto"*, the batch count *"should be auto as it should
// follow the earlier module, we just indicate in the 1st module"*, and *"set as
// default tick for Wait for the module above"* and for multiple production lines.
//
// The rule underneath all of it is the one v147's cycles migration used: a default
// is for a module she has not filled in yet, and is never applied backwards onto a
// module that already carries her own numbers. That is what test 2 here pins.

test("a new module arrives with her own defaults, ready to use (v151)", () => {
  const fresh = blankModule("brick9");
  const cyc = fresh.cycles;
  assert.equal(cyc.length, 1, "one cycle to begin with");
  assert.equal(cyc[0].min, 20, "twenty minutes of work");
  assert.equal(cyc[0].load, 20, "all twenty of them with her hands on it");
  assert.equal(cyc[0].unload, 0, "and nothing at the far end");
  assert.equal(fresh.cycleMin, 20, "so the cycle is twenty minutes");
  assert.equal(fresh.touchMin, 20, "and so is the hands time");

  // Auto, both of them. The numbers are still resolved — nothing downstream has to
  // know about Auto — but the flags say she never typed them, which is what lets
  // the box open empty and go on following.
  assert.equal(fresh.everyAuto, true, "the pace is Auto");
  assert.equal(fresh.everyMin, 20, "which is this module's own cycle length");
  assert.equal(fresh.repeatsAuto, true, "the batch count is Auto");

  assert.equal(fresh.follow, true, "waiting on the module above, ticked from new");
  assert.equal(fresh.overlap, true, "and free to hold more than one production line");
  assert.equal(fresh.on, false, "still switched off until she fills it in, as before");
});

test("Auto follows the module above, and a number of her own is never overruled (v151)", () => {
  // Her line: a first module carrying the number, then two that have never been
  // given one. That is the shape a new module lands in, so it is the shape tested.
  const line = [
    module({ id: "a", name: "Mix", repeats: 4, cycleMin: 20, everyMin: 87, startMin: 1 }),
    module({ id: "b", name: "Rest", repeats: null, repeatsAuto: true, cycleMin: 30, everyMin: 30, startMin: 0 }),
    module({ id: "c", name: "Oven", repeats: null, repeatsAuto: true, cycleMin: 13, everyMin: 87, startMin: 0 }),
  ];
  const out = chainLine(line);
  assert.deepEqual(out.map((m) => m.repeats), [4, 4, 4], "the two with no number of their own followed the one above");

  // The module that HAS a number of her own keeps it, even when the module above
  // it says something else — "we just indicate in the 1st module" is a habit, not
  // a rule that seizes a number she typed.
  const own = chainLine([line[0], module({ id: "b", name: "Rest", repeats: 2, cycleMin: 30 })]);
  assert.deepEqual(own.map((m) => m.repeats), [4, 2], "a count she typed is hers and is not overwritten");

  // And the three scenarios on her shelf store a count on every module, so not one
  // of them is Auto and not one of their mixed counts moves.
  const kept = (sc) => chainLine(sc.modules).map((m) => m.repeats);
  assert.deepEqual(kept(DEFAULT_SCENARIO), DEFAULT_SCENARIO.modules.map((m) => m.repeats));
  assert.deepEqual(kept(SISTER_SCENARIO), SISTER_SCENARIO.modules.map((m) => m.repeats));
  assert.deepEqual(kept(ONE_BAKER_SCENARIO), ONE_BAKER_SCENARIO.modules.map((m) => m.repeats));
  assert.ok(DEFAULT_SCENARIO.modules.some((m) => m.repeats === 1) && DEFAULT_SCENARIO.modules.some((m) => m.repeats === 6),
    "the seeded day really does carry two different counts, so the line above is a real test");
  // An Auto module is never named as out of step: it cannot differ, it took the
  // number. A module with a count of its own still is.
  const mixed = [
    module({ id: "a", name: "Mix", repeats: 4 }),
    module({ id: "b", name: "Rest", repeats: null, repeatsAuto: true }),
    module({ id: "c", name: "Oven", repeats: 2 }),
  ];
  assert.deepEqual(batchMismatches(chainLine(mixed)).map((m) => m.name), ["Oven"],
    "an automatic module was named as out of step, or one with its own count was not");
});

test("a batch's own nudge rides the chain and can only hold it back (v151)", () => {
  const base = [
    module({ id: "a", name: "Mix", repeats: 2, cycleMin: 20, everyMin: 60, startMin: 0 }),
    module({ id: "b", name: "Oven", repeats: 2, cycleMin: 15, everyMin: 60, startMin: 0, startDelta: [0, 10], follow: true }),
  ];
  const out = chainLine(base);
  const b = out.find((m) => m.id === "b");
  // Batch 1 of Mix ends at 20, so the oven's own batch 1 waits for it; batch 2 at
  // 80. The nudge of 10 holds the SECOND batch ten minutes later and leaves the
  // first alone — it is per batch, not per module.
  assert.deepEqual(b.starts, [20, 90], "the nudge landed on the batch she put it on");

  // Move the whole module above an hour later. The nudge is a delta, so batch 2
  // follows with its ten minutes intact rather than staying where it was.
  const moved = chainLine(base.map((m) => (m.id === "a" ? { ...m, startMin: 60, starts: [60, 120] } : m)));
  assert.deepEqual(moved.find((m) => m.id === "b").starts, [80, 150], "the nudge rode the chain instead of pinning the batch");

  // It can only ever hold a batch back. A nudge would pull batch 1 to minute 5,
  // in front of the dough it is made from, and the chain refuses: the module above
  // still has the last word.
  const early = chainLine(base.map((m) => (m.id === "b" ? { ...m, starts: [5, 5], startDelta: [0, 0] } : m)));
  assert.deepEqual(early.find((m) => m.id === "b").starts, [20, 80], "a time in front of the module above is not honoured");

  // Reading the answer again moves nothing, and the nudge is consumed rather than
  // applied twice — the invariant the whole screen rests on, because chainLine's
  // result IS what every repaint reads.
  assert.deepEqual(chainLine(chainLine(base)).map((m) => m.starts), out.map((m) => m.starts),
    "a second read of the line moved a batch");
  assert.deepEqual(chainLine(base).find((m) => m.id === "b").startDelta, [0, 0],
    "the nudge is in the times now, and handing it back would apply it twice");
  // A nudge is never negative, whatever is stored, and the list is exactly as long
  // as the batches — the same shape `starts` and `crew` are kept in.
  const clean = moduleOf({ id: "x", repeats: 3, startDelta: [-5, "junk", 3] });
  assert.deepEqual(clean.startDelta, [0, 0, 3]);
  assert.equal(clean.startDelta.length, clean.repeats, "one nudge per batch, always");
});

test("nothing of hers moves: the three seeded lines read exactly as before (v151)", () => {
  // The three scenarios the app ships, read as the day she sees. Every one of them
  // stores its own numbers, so not one of them is Auto and not one new default can
  // reach them. Pinned here in full — pans, day length and every batch time — so a
  // future default cannot quietly rewrite a line she already has.
  // Every batch time of all three, as they read the moment before this release.
  const times = (sc) => Object.fromEntries(chainLine(sc.modules).map((m) => [m.id, m.starts]));
  assert.deepEqual(times(DEFAULT_SCENARIO), {
    mixer: [0], fold: [30, 60, 90, 120], wash: [150, 168, 186, 204, 222, 240],
    load: [258], retard: [273], unload: [993], top: [1008, 1023, 1038, 1053, 1068, 1083],
    oven: [1016, 1031, 1046, 1061, 1076, 1091], pack: [1095, 1110, 1125, 1140, 1155, 1170],
    fridge: [0],
  }, "the seeded day moved");
  assert.deepEqual(times(SISTER_SCENARIO), {
    tubmix: [0], tubfold: [30, 60, 90], panfill: [90], proofer: [102],
    dimpleoil: [162], bench: [166], oven: [196], pack: [211],
  }, "her sister's line moved");
  assert.deepEqual(times(ONE_BAKER_SCENARIO), {
    solo_mix: [1, 88, 175, 262], solo_fold: [21, 108, 195, 282], solo_scale: [144, 231, 318, 405],
    solo_proof1: [159, 246, 333, 420], solo_top: [204, 291, 378, 465], solo_proof2: [210, 297, 384, 471],
    solo_oven: [240, 327, 414, 501], solo_pack: [297, 384, 471, 558],
  }, "one baker day moved");

  assert.equal(computeScenario(DEFAULT_SCENARIO).pansPerDay, 12, "the seeded day still makes twelve pans");
  assert.equal(computeScenario(SISTER_SCENARIO).pansPerDay, 4, "her sister's line still makes four");
  assert.equal(computeScenario(ONE_BAKER_SCENARIO).pansPerDay, 24, "and one baker day still makes twenty-four");
  // Reading the line twice must still be a no-op, now that chainLine writes a count
  // and consumes a nudge.
  assert.deepEqual(chainLine(chainLine(DEFAULT_SCENARIO.modules)), chainLine(DEFAULT_SCENARIO.modules),
    "reading the seeded line twice gave two different days");

  // Auto is per module and reads from ABSENCE, so a stored scenario has none of it
  // — the whole protection in one assertion.
  for (const sc of [DEFAULT_SCENARIO, SISTER_SCENARIO, ONE_BAKER_SCENARIO]) {
    for (const m of sc.modules) {
      assert.equal(moduleOf(m).repeatsAuto, false, `${sc.id}/${m.id}: a stored count became Auto`);
      assert.equal(moduleOf(m).everyAuto, false, `${sc.id}/${m.id}: a stored pace became Auto`);
    }
  }
});

// ── When the day calls her people (v151) ──────────────────────────────────
// Her ask: "Can we set whether to make announcement 1 min before the next cycle
// start he is responsible to?" One minute early, and one minute early is not a
// rounding-up — her fold is a one-minute job, so a call at the minute of the job
// is a call after it has begun.

test("the call is a minute before the job, and it is the job's own person (v151)", () => {
  const mods = chainLine(ONE_BAKER_SCENARIO.modules).map(moduleFacts);
  const windows = touchWindows(mods);
  const calls = callWindows(ONE_BAKER_SCENARIO);
  assert.ok(calls.length > 0, "the day calls nobody");

  // One call per stretch of hands, each one minute before the stretch begins —
  // and never before the day itself starts, because minute zero minus one is not
  // a minute anybody can be called at.
  assert.equal(calls.length, windows.length, "a stretch of hands went uncalled, or was called twice");
  for (const c of calls) {
    assert.equal(c.at, Math.max(0, c.from - 1), `${c.name} is called at ${c.at} for a job at ${c.from}`);
  }
  // In clock order, so a tick that reads the list from where it got to can never
  // miss one and go back for it later.
  for (let i = 1; i < calls.length; i += 1) assert.ok(calls[i].at >= calls[i - 1].at);

  // The person a call names is the person the day gives that window — the same
  // answer the person rows are drawn from, so a call and the row it came from
  // cannot name two different people.
  const rows = peopleRows(mods);
  for (const c of calls) {
    const row = rows.find((x) => x.person === c.who);
    assert.ok(row, `a call names person ${c.who}, who has no row`);
    assert.ok(row.items.some((i) => i.from === c.from && i.module === c.module),
      `${c.name} is called for person ${c.who}, who is not on that job`);
  }
  // Her fold: the first rest is a rest and nothing else, and the one after it ends
  // in a one-minute fold — so the first call of the fold's day comes the minute
  // before that fold and not at the minute of it. The fold is at 51 (the batch
  // starts at 21 and its first rest runs 31 minutes) and the call is at 50.
  const fold = calls.find((c) => c.module === "solo_fold");
  assert.ok(fold, "the fold's own day has no call in it");
  assert.equal(fold.at, 50, "the fold is not called a minute before it happens");
  assert.equal(fold.from, 51, "the fold's own minute moved");
});

// ── Working the day backwards (v152) ──────────────────────────────────────
// Her ask of 22 September: "how to make the calculate backward works?" Every
// other time on this screen is worked out forwards, so a module can only ever be
// pushed later and the day can only spill; the seeded one baker day is the
// exception, and its eight times were worked out BACKWARDS by hand and stored as
// numbers. latestStarts is that arithmetic, in code, so the screen can do it.
//
// The anchor is the end of the first batch at the LAST module in the build, not
// the oven — add, remove or reorder a module and the moment the day hangs from
// moves with her line. On one baker day that last process is Cutting and packing.

test("the backward pass walks from the end of the first batch at the last module (v152)", () => {
  const r = computeScenario(ONE_BAKER_SCENARIO);
  // The anchor itself, read off the day rather than assumed: the last switched-on
  // module's first batch ends at minute 309, which is 9:09 am.
  const last = r.on[r.on.length - 1];
  assert.equal(last.id, "solo_pack", "the last thing the line does for a batch moved");
  assert.equal(last.passes[0].end, 309, "the end of the first batch is not where it was");

  const latest = latestStarts(r.on);
  assert.deepEqual(Object.fromEntries(latest), {
    solo_mix: 43, solo_fold: 63, solo_scale: 186, solo_proof1: 201,
    solo_top: 246, solo_proof2: 252, solo_oven: 282, solo_pack: 297,
  }, "the latest starts are not the chain's own answer");

  // Why those numbers are those numbers, measured off the day itself rather than
  // repeated a second time: the only room anywhere in one baker day's chain is the
  // forty-two minutes between the oven's first batch and the packing's, and every
  // module above it gives that room back and no more. Every other neighbouring pair
  // hands over with no minute to spare, so nothing else can move at all.
  const oven = r.on.find((m) => m.id === "solo_oven");
  const pack = r.on.find((m) => m.id === "solo_pack");
  assert.equal(pack.passes[0].at - oven.passes[0].end, 42,
    "the room between the oven and the packing is not forty-two minutes");
  for (let i = 0; i < r.on.length - 1; i += 1) {
    if (r.on[i].id === "solo_oven") continue;
    const above = r.on[i];
    const below = r.on[i + 1];
    let room = Infinity;
    for (let k = 0; k < above.passes.length; k += 1) {
      room = Math.min(room, below.passes[k].at - above.passes[k].end);
    }
    assert.equal(room, 0, `${above.name} no longer hands over to ${below.name} with no minute to spare`);
  }
  // The last module is the anchor and does not move; every module above it moves by
  // the room below it, which on this day is the same 42 all the way up.
  assert.equal(latest.get(last.id), last.startMin, "the module the day hangs from was moved");
  for (const f of r.on.slice(0, -1)) {
    assert.equal(latest.get(f.id) - f.startMin, 42, `${f.name}: the day's own room is not what moved it`);
  }

  // What the number is FOR: the dough does not have to go in at 4:01 am. Forty-two
  // minutes of that day are slack, and this is that slack as a number — the mix's
  // latest start against the 1 it is stored at.
  assert.equal(moduleOf(ONE_BAKER_SCENARIO.modules[0]).starts[0], 1, "the seeded mix no longer starts at 4:01 am");
  assert.equal(latest.get("solo_mix"), 43, "the mix was not handed 4:43 am as its latest start");

  // Nothing of hers moves: the pass only hands back an answer, and the line she
  // already has is still drawn from her own stored times.
  assert.deepEqual(chainLine(ONE_BAKER_SCENARIO.modules).map((m) => m.starts[0]),
    [1, 21, 144, 159, 204, 210, 240, 297], "reading the backward pass moved a stored time");
});

test("the backward pass is measured off the day, not subtracted from the anchor (v152)", () => {
  // The first version of this asked the anchor for the sum of every module's cycle
  // minutes, and on a day whose modules do NOT sit end to end that answer is not the
  // day she has. The seeded 12-pan line is exactly that day: its chain really spans
  // 1095 minutes where the cycle minutes only add up to 875, and the seeded one baker
  // day is the opposite case where the two agree by luck. So the pass has to measure
  // the room between neighbouring modules instead — and the two answers must differ
  // on the day that tells them apart.
  const r = computeScenario(DEFAULT_SCENARIO);
  const latest = latestStarts(r.on);
  const sum = r.on.reduce((t, f) => t + f.cycleMin, 0);
  const span = r.endMin - r.firstMin;
  assert.notEqual(Math.round(sum), Math.round(span), "the seeded days no longer tell a sum from a span, so this test covers nothing");

  // Measured room by room: the mixer may go in 220 minutes later than it does, which
  // is the packing's room (64) plus the wash's (90) plus the fold's (56) plus its own
  // (10) — the four places this day is not tight, added up the way the pass walks it.
  assert.equal(latest.get("mixer") - r.on.find((f) => f.id === "mixer").startMin, 220,
    "the mixer's latest start is not the day's own room walked back to it");
  assert.equal(latest.get("pack"), r.on.find((f) => f.id === "pack").startMin,
    "the module the day hangs from was moved");

  // And a module is never handed a start before the one it already has: the pass
  // gives room back, it does not take any away.
  for (const f of r.on) {
    assert.ok(latest.get(f.id) >= f.startMin, `${f.name} was handed an earlier start than it already has`);
  }
});

test("a module that is switched off is stepped over, and gets no latest start (v152)", () => {
  // The fridge sits in the seeded line switched off. A machine that is not switched
  // on is not in the build, so nothing is worked back through it and nothing waits
  // on it — exactly how chainLine steps over one.
  const r = computeScenario(DEFAULT_SCENARIO);
  const last = r.on[r.on.length - 1];
  assert.equal(last.id, "pack", "the last thing the seeded day does moved");
  assert.equal(r.on.some((f) => f.id === "fridge"), false, "the fridge is switched on, so this test is not covering it");
  const latest = latestStarts(r.on);
  assert.equal(latest.has("fridge"), false, "a switched-off module was given a latest start");
  assert.equal(latest.size, 9, "the backward pass answered for a module that is not in the build");
  // The pass walks the switched-on modules in the order they are built, so the last
  // one of them is the anchor whatever is switched off above or below it.
  assert.equal(latest.get("pack"), last.startMin, "the module the day hangs from is not the last one switched on");

  // And it reads nothing off the screen: an empty line is an empty answer, not a crash.
  assert.equal(latestStarts([]).size, 0, "an empty build answered for a module");
  assert.equal(latestStarts(null).size, 0, "a missing build answered for a module");
  assert.equal(latestStarts([{ id: "x" }, null]).size, 0, "a module with no passes drawn was answered for");
});

test("pressing the backward pass never moves a module earlier, and never twice (v152)", () => {
  // Two things a press must always be. A latest start is a LATER start or no start,
  // so no module is ever handed a time before the one it has — which is what makes a
  // second press impossible to feel: with every module already at its latest start,
  // the room between them all measures zero and there is nothing left to give.
  const r = computeScenario(ONE_BAKER_SCENARIO);
  const once = latestStarts(r.on);
  for (const f of r.on) {
    assert.ok(once.get(f.id) >= f.startMin, `${f.name} was handed an earlier start than the one it has`);
  }
  // The day as it stands after that press, fed back through the pass: every module
  // and every bar of it moved by what it was handed, which is what writing a
  // module's first batch does to a day whose spacing is its own.
  const pressed = r.on.map((f) => {
    const shift = once.get(f.id) - f.startMin;
    return {
      ...f,
      startMin: f.startMin + shift,
      passes: f.passes.map((p) => ({ ...p, at: p.at + shift, end: p.end + shift })),
    };
  });
  const twice = latestStarts(pressed);
  for (const f of pressed) {
    assert.equal(twice.get(f.id), f.startMin, `${f.name} would move again on a second press`);
  }
});

// Her report of 23 September, on the last module's own bar: "the last module batch pop
// up, still dont mark his delta?" That bar opened the day's card and nothing else, so
// the batch could take no hold at all. It can now, and this pins what a hold there does
// — because on THIS module a hold is not only that batch's own business.
//
// The press writes the shape below: every batch of the module, by the same amount, which
// is what batch 1 of any module writes. What it buys is the other end of the backward
// pass above — the anchor moves later, so the room between it and every module above
// grows by exactly those minutes, and the day's own card is where that room is read and
// taken. Hold the finish later, then work the day back into the room it made.
test("a hold on the last module hands every module above it the same minutes of slack (v180)", () => {
  const before = computeScenario(ONE_BAKER_SCENARIO);
  const was = latestStarts(before.on);
  const last = before.on[before.on.length - 1];
  const wasStart = new Map(before.on.map((f) => [f.id, Number(f.startMin)]));

  const sc = copyScenario(ONE_BAKER_SCENARIO);
  sc.modules.find((m) => m.id === last.id).startDelta = last.passes.map(() => 5);
  const after = computeScenario(sc);
  const now = latestStarts(after.on);

  // The anchor itself, five minutes later — and not one module above it moved.
  assert.equal(after.on[after.on.length - 1].startMin - last.startMin, 5,
    "the hold did not move the module the day hangs from");
  for (const f of after.on) {
    if (f.id === last.id) continue;
    assert.equal(Number(f.startMin), wasStart.get(f.id), `${f.name} moved with a hold on the last module`);
  }
  // The room it made, module by module.
  for (const f of after.on) {
    assert.equal(now.get(f.id) - was.get(f.id), 5,
      `${f.name} was not handed the minutes the hold made`);
  }
  // And nothing of the day's own figures came with it but the five minutes of clock.
  assert.equal(after.pansPerDay, before.pansPerDay, "the hold changed how many pans the day makes");
  assert.equal(after.endMin - before.endMin, 5, "the day's own finish did not move with the anchor");
});


// Her report of 22 September, in her own words and then her own correction:
// "the cut and packing batch din follow the earlier batch end", and then "cutting
// and packing sit below cooling down, so cutting and packing batch start should
// follow cooling down batch end".
//
// The answer to it cannot be a rule about cooling, and it is not one. The day
// below is the shape she described — the oven, the cooling, then the packing — and
// the only thing that changes between the readings is the packing module's own
// answer. Her directive for this release: "the behaviour has to base on
// configuration, not a hard wired".
const coolDay = (pack = {}) => scenario({
  modules: [
    // Four lots out of the oven 90 minutes apart, each 15 minutes in it.
    module({ id: "oven", name: "The oven swap and the bake", cycleMin: 15, everyMin: 90, repeats: 4, startMin: 0, overlap: true }),
    // A lot is 42 minutes cooling from the minute the oven lets go of it — set to
    // never before the oven, which is the old switch's answer — so its four lots end
    // at 57, 147, 237 and 327 minutes past the start of the day.
    module({ id: "cool", name: "Cooling down", cycleMin: 42, everyMin: 90, repeats: 4, startMin: 15, startMode: "wait", overlap: true }),
    // The packing is the one she wrote about: 12 minutes a lot, and the times
    // stored for it sit 8 minutes after the cooling ends each one.
    module({ id: "pack", name: "Cutting and packing", cycleMin: 12, everyMin: 90, repeats: 4, startMin: 65, overlap: true, ...pack }),
  ],
});
const startsIn = (mods, id) => mods.find((m) => m.id === id).starts;

test("the packing starts the minute the cooling ends, once she says so (v154)", () => {
  // Set to never before the cooling — which is what the old switch on, and the
  // default a new module arrives on, has always meant — the later time she set
  // stands and the day reads exactly as it did before this release.
  const wait = chainLine(coolDay({ startMode: "wait" }).modules);
  assert.deepEqual(startsIn(wait, "pack"), [65, 155, 245, 335],
    "a packing set to never-before-the-cooling stopped keeping the later time she set");

  // Set to start as the one above finishes, the packing lands on the cooling's own
  // end — lot 1 on the end of cooling lot 1, lot 2 on lot 2, and so on. That is the
  // eight minutes she was trying to take out of every lot.
  const after = chainLine(coolDay({ startMode: "after" }).modules);
  assert.deepEqual(startsIn(after, "pack"), [57, 147, 237, 327],
    "the packing did not land on the end of the cooling");
  const cool = startsIn(after, "cool");
  for (let k = 0; k < 4; k += 1) near(startsIn(after, "pack")[k], cool[k] + 42, `packing lot ${k + 1} is not on the cooling's end`);

  // And it is one module's answer and not the line's: the modules above it have not
  // moved, so what she sets below can never re-lay the day above her back.
  assert.deepEqual(startsIn(after, "cool"), startsIn(wait, "cool"), "setting the packing to follow moved the cooling");
  assert.deepEqual(startsIn(after, "oven"), startsIn(wait, "oven"), "setting the packing to follow moved the oven");

  // The three answers are a closed set of three and each one is named.
  assert.deepEqual(START_MODES, ["after", "wait", "own"]);
  for (const mode of START_MODES) assert.ok(START_MODE_LABELS[mode], `the mode ${mode} has no name to show her`);
});

test("the follow is a choice on the module, not a rule about a name (v154)", () => {
  // Her directive, kept as a test rather than as a promise: nothing here knows a
  // module by its name. The same three modules with every name replaced by
  // nonsense answer identically, because the answer is read off startMode and
  // nothing else.
  const renamed = coolDay({ startMode: "after" }).modules.map((m, i) => ({ ...m, name: `Step ${i + 1}` }));
  assert.deepEqual(startsIn(chainLine(renamed), "pack"), [57, 147, 237, 327],
    "the follow is reading a module's name");

  // And the same choice on a line she has never had is an ordinary choice there,
  // with no cooling and no packing anywhere in it.
  const other = scenario({ modules: [
    module({ id: "a", cycleMin: 20, everyMin: 60, repeats: 2, startMin: 0, overlap: true }),
    module({ id: "z", cycleMin: 5, everyMin: 60, repeats: 2, startMin: 7, startMode: "after", overlap: true }),
  ] });
  assert.deepEqual(startsIn(chainLine(other.modules), "z"), [20, 80],
    "the tight follow only works on the modules this release was written about");
});

test("a module that is switched off is stepped over, however she sets the one below it (v154)", () => {
  const off = coolDay({ startMode: "after" });
  // A machine between the two that is not switched on: it is not in the build, so
  // nothing waits on it and the packing still reads the cooling.
  off.modules.splice(2, 0, module({ id: "off", name: "A machine that is off", on: false, cycleMin: 200, everyMin: 90, repeats: 4, startMin: 300 }));
  assert.deepEqual(startsIn(chainLine(off.modules), "pack"), [57, 147, 237, 327],
    "the packing waited on a module that is not switched on");
});

test("a module above with fewer lots answers for the lots it has (v154)", () => {
  // Two lots cooling, four lots packing: the cooling has no third or fourth lot to
  // answer with, so the last one it does have is the answer — the same reading the
  // screen already gives, rather than a time invented for a lot that does not exist.
  const short = scenario({ modules: [
    module({ id: "cool", cycleMin: 42, everyMin: 90, repeats: 2, startMin: 15, overlap: true }),
    module({ id: "pack", cycleMin: 12, everyMin: 90, repeats: 4, startMin: 65, startMode: "after", overlap: true }),
  ] });
  assert.deepEqual(startsIn(chainLine(short.modules), "pack"), [57, 147, 147, 147]);
});

test("a hold can only ever push a batch later, and it rides the module above (v154)", () => {
  // The +/- pairs write this hold. It comes on TOP of the line's own answer rather
  // than instead of it, which is what lets the same pair move a batch at a module
  // whose start time is not stored on it at all — a module set to the tight follow
  // has no start of its own to write, so a press that wrote one would be the dead
  // control this screen is built to keep out.
  const held = chainLine(coolDay({ startMode: "after", startDelta: [5, 5, 5, 5] }).modules);
  assert.deepEqual(startsIn(held, "pack"), [62, 152, 242, 332], "the hold did not come on top of the line's own answer");

  // A negative hold would be a batch placed in front of the dough it is made of,
  // so it is read as no hold at all rather than as an earlier start.
  const pulled = chainLine(coolDay({ startMode: "after", startDelta: [-9, -9, -9, -9] }).modules);
  assert.deepEqual(startsIn(pulled, "pack"), [57, 147, 237, 327], "a negative hold pulled a batch in front of the cooling");

  // The hold is an offset and not a time, so a change she makes further up the line
  // carries the held lot with it instead of leaving it behind.
  const upstream = coolDay({ startMode: "after", startDelta: [5, 5, 5, 5] });
  upstream.modules[0].startMin = 10;
  assert.deepEqual(startsIn(chainLine(upstream.modules), "pack"), [72, 162, 252, 342],
    "the held lot did not come with the module above it");

  // The hold is handed back in the shape a second read can use, and the two shapes
  // are not the same. On a module whose start times are its own — "own" or "wait" —
  // the hold is already inside `starts`, so the delta comes back zeroed and reading
  // the answer again cannot count it twice.
  const ownHeld = chainLine([
    module({ id: "a", cycleMin: 10, everyMin: 60, repeats: 2, startMin: 0, overlap: true }),
    module({ id: "b", cycleMin: 10, everyMin: 60, repeats: 2, startMin: 60, startMode: "wait", overlap: true, startDelta: [7, 7] }),
  ]);
  assert.deepEqual(startsIn(ownHeld, "b"), [67, 127], "the hold did not come on top of the time she set");
  assert.deepEqual(ownHeld.find((m) => m.id === "b").startDelta, [0, 0],
    "a module whose times are its own handed the hold back as well as applying it, so a second read would count it twice");
  assert.deepEqual(startsIn(chainLine(ownHeld), "b"), [67, 127], "reading the chain's own answer moved the day");

  // A module set to the tight follow has no start times of its own to hold the
  // offset in, so there the delta IS the hold and it is handed back — a second read
  // has to give the same minute rather than quietly dropping the one she set.
  assert.deepEqual(held.find((m) => m.id === "pack").startDelta, [5, 5, 5, 5],
    "a module set to the tight follow dropped the hold on the way out");
  assert.deepEqual(startsIn(chainLine(held), "pack"), [62, 152, 242, 332], "reading the chain's own answer dropped the hold");
});

test("how a module takes its start is her choice of three, and a saved module keeps the answer it behaved with (v154)", () => {
  // Before this release a module carried one switch, Waits for the module above. On
  // meant the floor; off meant no touch at all. Those two answers map one for one
  // onto the two modes that keep her saved days behaving exactly as they did, and
  // that mapping is the reason nothing of hers moved.
  assert.equal(startModeOf({ follow: true }), "wait");
  assert.equal(startModeOf({ follow: false }), "own");
  assert.equal(startModeOf({}), "own");
  assert.equal(startModeOf({ follow: true, startMode: "after" }), "after", "an answer she gave later was overruled by the old switch");
  assert.equal(startModeOf({ startMode: "nonsense" }), "own", "a mode that is not one of the three was trusted");

  // moduleOf is where a stored module becomes a working one, and both keys have to
  // be on its answer: the new one for the three-way choice, and the old one because
  // the rest of the screen reads it and an older phone still writes it.
  assert.equal(moduleOf({ id: "x", follow: true }).startMode, "wait");
  assert.equal(moduleOf({ id: "x", follow: true }).follow, true);
  assert.equal(moduleOf({ id: "x", startMode: "after" }).startMode, "after");
  assert.equal(moduleOf({ id: "x", startMode: "after" }).follow, true, "a tight follow is still a module with a module above it");
  assert.equal(moduleOf({ id: "x", startMode: "own" }).follow, false);

  // The setter writes both, so the two can never come to disagree.
  const live = module({});
  setStartMode(live, "after");
  assert.equal(live.startMode, "after");
  assert.equal(live.follow, true);
  setStartMode(live, "own");
  assert.equal(live.follow, false);
  setStartMode(live, "nonsense");
  assert.equal(live.startMode, "own", "a mode that is not one of the three was stored");

  // A brand new module arrives on the old switch's answer, so adding one to a day
  // never re-lays it — "after" there would move the day the moment it appeared.
  assert.equal(blankModule("new").startMode, "wait");
});

test("not one module of hers was put on the tight follow by being read (v154)", () => {
  // Every day she has saved was built when a module's answer was a single switch,
  // so not one module of hers can be on the tight follow. If one is, a release has
  // silently re-laid her day. MEASURED, not promised: this reads her own lines.
  for (const [what, sc] of [["the seeded starting line", DEFAULT_SCENARIO], ["One baker day", ONE_BAKER_SCENARIO], ["My sister's line", SISTER_SCENARIO]]) {
    for (const m of scenarioOf(sc).modules) {
      assert.notEqual(m.startMode, "after", `${what}: ${m.name} was put on the tight follow`);
      assert.equal(m.startMode, m.follow ? "wait" : "own", `${what}: ${m.name} answers two ways at once`);
    }
  }
});

test("her own days read the same times after the three modes (v154)", () => {
  // The numbers her three saved days are made of, byte for byte: twenty-four pans
  // across the one baker day's eight modules, the twelve-pan seeded line, and her
  // sister's four. Pinned here because "nothing of hers moved" has to be measured
  // rather than intended.
  const one = computeScenario(ONE_BAKER_SCENARIO);
  assert.equal(one.pansPerDay, 24);
  assert.equal(one.endMin, 570, "the one baker day no longer finishes at 1:30 pm");
  assert.deepEqual(of(one, "solo_mix").starts, [1, 88, 175, 262]);
  assert.deepEqual(of(one, "solo_oven").starts, [240, 327, 414, 501]);
  assert.deepEqual(of(one, "solo_pack").starts, [297, 384, 471, 558]);

  const seed = computeScenario(DEFAULT_SCENARIO);
  assert.equal(seed.pansPerDay, 12, "the seeded line no longer makes twelve pans");
  assert.deepEqual(of(seed, "fold").starts, [30, 60, 90, 120]);
  assert.deepEqual(of(seed, "unload").starts, [993]);

  const sister = computeScenario(SISTER_SCENARIO);
  assert.equal(sister.pansPerDay, 4, "her sister's line no longer makes four pans");
  assert.deepEqual(of(sister, "tubfold").starts, [30, 60, 90]);
  assert.deepEqual(of(sister, "oven").starts, [196]);
});

// ── v177 · each person's hours, and what each of them is trained for ──────────
//
// Her ask, 23 September: "I need each person to have the start work time and end
// work time, 2. which module they. are dedicated for". And the two rules that
// settled it: the hours are counted from the start of her day ("relative to the
// chart, not exact hours"), and a module picks the person trained for it — "say
// one person have all skill, person2 have have the skill, person3 have only 1
// skill, module should select the one that specialised".
//
// Every test here is built so that the day WITHOUT hours and skills is the day
// this app has always drawn: that equality is the whole back-compat promise, and
// it is asserted first rather than assumed.

// One stretch of hands, at a minute, optionally named for somebody.
const job = (id, startMin, extra = {}) => moduleFacts({
  id, icon: "•", name: id, on: true, person: 0, cycleMin: 10, batch: 1,
  touchMin: 10, everyMin: 10, repeats: 1, startMin, people: 1, ...extra,
});
const shapeOf = (rows) => rows.map((r) => [r.person, r.items.map((w) => w.module)]);
const rowOf = (rows, p) => rows.find((r) => r.person === p);

test("no hours and no skills anywhere holds everything, and packs as it always did (v177)", () => {
  // The back-compat promise in one assertion: reading nothing at all is the same
  // day as reading two empty tables, because an absent shift is "here all day" and
  // an absent skill list is "can work anything".
  const mods = [job("a", 0), job("b", 5), job("c", 40), job("d", 5)];
  assert.deepEqual(shapeOf(peopleRows(mods, {}, {})), shapeOf(peopleRows(mods)),
    "no hours holds everything — a person with no entry is here all day");
  assert.deepEqual(shapeOf(peopleRows(mods, { 2: { startMin: 0, endMin: 5 } }, { 9: ["a"] })), shapeOf(peopleRows(mods, {}, {})),
    "a shift on a person who is not in the day, and a skill for a person who cannot exist, change nothing");
});

test("a free job goes to somebody trained for it, not to whoever is free (v177)", () => {
  const mods = [job("setup1", 0, { person: 1 }), job("setup2", 0, { person: 2 }), job("wash", 100)];
  // Person 1 is trained for something else, so person 2 is the only one who can
  // take the wash — even though person 1 has the lower number.
  const skills = { 1: ["oven"], 2: ["wash"] };
  assert.deepEqual(rowOf(peopleRows(mods, {}, skills), 2).items.map((w) => w.module), ["setup2", "wash"],
    "the job went to whoever was free, not to whoever can work it");
  assert.deepEqual(rowOf(peopleRows(mods, {}, skills), 1).items.map((w) => w.module), ["setup1"],
    "and the person who cannot work it was left alone");
});

test("between two people who can both work it, the more specialised one is asked first (v177)", () => {
  // Her own picture: "say one person have all skill, person2 have have the skill,
  // person3 have only 1 skill, module should select the one that specialised".
  const mods = [job("setup1", 0, { person: 1 }), job("setup2", 0, { person: 3 }), job("oven", 100)];
  const skills = { 1: ["oven", "wash", "fold", "mix"], 3: ["oven"] };
  assert.deepEqual(rowOf(peopleRows(mods, {}, skills), 3).items.map((w) => w.module), ["setup2", "oven"],
    "the specialist was left idle while the generalist did their job");
  // And the same with the numbers the other way round, so the rule is specialisation
  // and not the person number wearing a disguise.
  const swapped = { 1: ["oven"], 3: ["oven", "wash", "fold", "mix"] };
  assert.deepEqual(rowOf(peopleRows(mods, {}, swapped), 1).items.map((w) => w.module), ["setup1", "oven"],
    "the tie-break is how specialised they are, not which number they are");
});

test("a free job prefers somebody who is here when it runs (v177)", () => {
  const mods = [job("setup1", 0, { person: 1 }), job("setup2", 0, { person: 2 }), job("late", 100)];
  const shifts = { 1: { startMin: 0, endMin: 50 } };
  assert.deepEqual(rowOf(peopleRows(mods, shifts, {}), 2).items.map((w) => w.module), ["setup2", "late"],
    "the job went to somebody who had gone home");
});

test("a job nobody free can take still goes to a free pair of hands, and is written down (v177)", () => {
  const mods = [job("setup1", 0, { person: 1 }), job("late", 100)];
  const rows = peopleRows(mods, { 1: { startMin: 0, endMin: 50 } }, {});
  assert.equal(rows.length, 1, "the hours never invent a hand the day does not need");
  const row = rowOf(rows, 1);
  assert.deepEqual(row.items.map((w) => w.module), ["setup1", "late"], "the job is kept where the day put it");
  assert.deepEqual(row.outside.map((w) => w.module), ["late"], "and the row knows it cannot fit");
  assert.equal(row.items[1].outsideHours, true, "the stretch itself carries the mark");
});

test("when nobody is free the day still invents a pair of hands, exactly as before (v177)", () => {
  const mods = [job("busy", 0, { person: 1 }), job("over", 5)];
  const rows = peopleRows(mods, { 1: { startMin: 0, endMin: 1000 } }, { 1: ["busy"] });
  assert.equal(rows.length, 2, "an hour that covers nobody must not stop the day needing a hand");
  assert.deepEqual(rowOf(rows, 2).items.map((w) => w.module), ["over"]);
  assert.equal(rowOf(rows, 2).outside.length, 0, "a person the day just invented has no hours to be outside of");
});

test("a job she placed by hand is never moved off that person, whatever their hours or training (v177)", () => {
  const mods = [job("wash", 100, { person: 2 })];
  const rows = peopleRows(mods, { 2: { startMin: 0, endMin: 50 } }, { 2: ["oven"] });
  assert.equal(rows.length, 1, "her named person is her plan, hours or no hours");
  assert.deepEqual(rowOf(rows, 2).items.map((w) => w.module), ["wash"], "and the job did not move");
  assert.deepEqual(rowOf(rows, 2).outside.map((w) => w.module), ["wash"], "but the row says it does not fit");
  assert.equal(rowOf(rows, 2).items[0].outsideHours, true);
  assert.equal(rowOf(rows, 2).items[0].outsideSkill, true, "and that they are not trained for it either");
});

test("hours and skills are scrubbed on the way in, like the merge labels (v177)", () => {
  const sc = scenarioOf({
    ...DEFAULT_SCENARIO,
    shifts: {
      1: { startMin: 60, endMin: 0 },          // ends before it starts
      9: { startMin: 1, endMin: 2 },           // not a person
      bad: "x",                                // not a shift at all
      2: { startMin: 0, endMin: 1440 },        // the whole day, which is no shift
      3: { startMin: 60, endMin: 120 },
    },
    skills: { 1: ["oven", "oven", ""], 9: ["oven"], bad: ["oven"], 2: "oven", 3: [" wash "] },
  });
  assert.deepEqual(sc.shifts, { 3: { startMin: 60, endMin: 120 } },
    "only one real shift survives, and a shift that says the whole day is stored as no shift at all");
  assert.deepEqual(sc.skills, { 1: ["oven"], 3: ["wash"] },
    "only real person numbers, each module named once, and nothing that is not a list");
  assert.equal(shiftOf(sc.shifts, 3).startMin, 60);
  assert.equal(shiftOf(sc.shifts, 5), null, "a person with no entry is here all day, not here for no time");
  assert.equal(coversWindow(null, { from: 0, to: 9999 }), true, "and no hours at all holds everything");
  assert.equal(canWork({}, 1, "oven"), true, "an empty skill list can work anything");
  assert.equal(canWork({ 1: ["oven"] }, 1, "wash"), false, "a list that does not name it cannot do it");
  assert.equal(canWork({ 1: ["oven"] }, 1, ""), true, "and a module with no id of its own cannot be trained for");
  assert.equal(skillRank({}, 1), Infinity, "somebody who can work anything is the last resort");
  assert.equal(skillRank({ 1: ["oven"] }, 1), 1);
});

test("a copy of a day carries its hours and its training (v177)", () => {
  const sc = scenarioOf({
    ...DEFAULT_SCENARIO,
    shifts: { 2: { startMin: 60, endMin: 300 } },
    skills: { 2: ["oven", "pack"] },
  });
  const copy = copyScenario(sc, "copy", "s2");
  // What a copy must CARRY. These two are the round-trip trap: `copyScenario` returns
  // a fixed literal and `openScenario` assigns it onto the day already in memory, so a
  // key left out of the literal does not get dropped — it silently keeps the previous
  // day's hours, with nothing on the screen saying so.
  //
  // There is no third assertion here about the members being fresh objects, and that is
  // deliberate rather than an omission: `copyScenario` starts from `scenarioOf(sc)`,
  // which already rebuilds every shift and every skill list, so a claim that the two
  // days do not share a member is true whether or not the copy is done member by member
  // — a test that cannot fail. The copy is still written member by member, for the same
  // reason `merges` and `crew` are; the test for what she would actually notice lives
  // where she would notice it, in the view: opening a day must not wear the last day's
  // hours.
  assert.deepEqual(copy.shifts, { 2: { startMin: 60, endMin: 300 } }, "the copy lost the hours");
  assert.deepEqual(copy.skills, { 2: ["oven", "pack"] }, "the copy lost the training");
});

test("the two facts ride every spread, so a change of arrangement cannot lose them (v177)", () => {
  const sc = scenario({ modules: [module({ id: "a", touchMin: 10, person: 2 })], shifts: { 2: { startMin: 60, endMin: 300 } }, skills: { 2: ["a"] } });
  assert.deepEqual(combinedScenario(sc, 2, 5).shifts, { 2: { startMin: 60, endMin: 300 } },
    "combining two people lost the hours");
  assert.deepEqual(reassignSlot(sc, "a", 0, 0, 1).skills, { 2: ["a"] },
    "handing one stretch to somebody else lost the training");
});

test("hours never silence a call — a job outside them is still called (v177)", () => {
  const sc = scenario({
    modules: [module({ id: "late", startMin: 100, touchMin: 10, person: 1 })],
    shifts: { 1: { startMin: 0, endMin: 50 } },
  });
  const calls = callWindows(sc);
  assert.ok(calls.some((w) => w.module === "late"),
    "the day still calls the job, so a rule can never hide a sale");
  assert.ok(computeScenario(sc).rows[0].outside.some((w) => w.module === "late"),
    "even though the row is saying it cannot fit");
});

test("the calls follow the same arrangement the chart draws (v177)", () => {
  // The caller and the chart both go through peopleRows, so the two can never
  // disagree about who is where — and the job that only person 2 can work is
  // called for person 2, not for the lower number the older packing would have
  // reached for.
  const sc = scenario({
    modules: [
      module({ id: "one", startMin: 0, touchMin: 10, person: 1 }),
      module({ id: "two", startMin: 0, touchMin: 10, person: 2 }),
      module({ id: "wash", startMin: 100, touchMin: 10 }),
    ],
    skills: { 1: ["one"], 2: ["two", "wash"] },
  });
  const wash = callWindows(sc).find((w) => w.module === "wash");
  assert.equal(wash.who, 2, "the caller did not read the same skills the chart draws");
  assert.equal(computeScenario(sc).rows.find((r) => r.items.some((w) => w.module === "wash")).person, 2,
    "and the chart agrees with the caller");
});
