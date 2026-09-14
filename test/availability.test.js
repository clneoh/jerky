// test/availability.test.js — the pure sell-day rules in availability.js, the
// one shared copy the backoffice's Availability card and the shop both read.
//
// A mark is a span with a weekday set: { days: [6, 0], from, to }. An empty
// weekday set means every day of the span, either end may be left open, and no
// marks at all means every delivery day. These tests pin the reading of a mark,
// what the card's header reads, and the month bounds a weekday tap writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availRules, availSummary, dayOfWeek, isDayKey, monthBounds, normDays, normRule,
  normRules, ruleLabel, ruleOpen, rulesOpen, rulesSummary, sellOpen,
  sellReason,
} from "../availability.js";

// 2026-12: the 1st is a Tuesday; 5 Dec a Saturday, 6 Dec a Sunday, 7 Dec a Monday.
const SAT = "2026-12-05";
const SUN = "2026-12-06";
const MON = "2026-12-07";

test("dayOfWeek numbers days the way settings.deliveryDays does", () => {
  assert.equal(dayOfWeek(SUN), 0, "Sunday is 0");
  assert.equal(dayOfWeek(MON), 1, "Monday is 1");
  assert.equal(dayOfWeek(SAT), 6, "Saturday is 6");
});

test("isDayKey accepts only a real YYYY-MM-DD string", () => {
  assert.equal(isDayKey("2026-12-05"), true);
  assert.equal(isDayKey("2026-12-05T00:00:00"), false);
  assert.equal(isDayKey("5 Dec 2026"), false);
  assert.equal(isDayKey(""), false);
  assert.equal(isDayKey(null), false);
  assert.equal(isDayKey(20261205), false);
});

test("normDays keeps whole days 0-6, once each, ascending", () => {
  assert.deepEqual(normDays([6, 0]), [0, 6], "sorted, not as typed");
  assert.deepEqual(normDays([1, 1, 1]), [1], "a repeat is kept once");
  assert.deepEqual(normDays([7, -1, 2.5, "3", null, undefined]), [3], "junk is dropped, not trusted");
  assert.deepEqual(normDays("6"), [], "a bare string is not a list");
  assert.deepEqual(normDays(null), []);
});

test("normRule needs one end or one weekday, and swaps a backwards span", () => {
  assert.deepEqual(normRule({ days: [6, 0], from: "2026-12-01", to: "2026-12-24" }),
    { days: [0, 6], from: "2026-12-01", to: "2026-12-24" });
  assert.deepEqual(normRule({ days: [], from: "2026-12-10", to: "2026-12-16" }),
    { days: [], from: "2026-12-10", to: "2026-12-16" });
  assert.deepEqual(normRule({ days: [6, 0] }), { days: [0, 6], from: "", to: "" },
    "weekdays alone mean 'every one of these, always'");
  assert.deepEqual(normRule({ days: [], from: "2026-12-24", to: "2026-12-01" }),
    { days: [], from: "2026-12-01", to: "2026-12-24" }, "a drag may go either way");
  assert.deepEqual(normRule({ days: [], to: "2026-12-24" }), { days: [], from: "", to: "2026-12-24" },
    "an open start is allowed");
  assert.equal(normRule({ days: [], from: "", to: "" }), null, "no days and no ends says nothing");
  assert.equal(normRule({ days: [9] }), null, "junk weekdays and no ends says nothing");
  assert.equal(normRule(null), null);
  assert.equal(normRule("x"), null);
});

test("normRules drops what says nothing and keeps the order", () => {
  assert.deepEqual(normRules([{ days: [], from: "2026-12-01", to: "2026-12-05" }, null, {}, "x"]),
    [{ days: [], from: "2026-12-01", to: "2026-12-05" }]);
  assert.deepEqual(normRules(undefined), []);
  assert.deepEqual(normRules("nonsense"), []);
});

test("ruleOpen: inside the span and on one of its weekdays", () => {
  const weekendDec = { days: [6, 0], from: "2026-12-01", to: "2026-12-24" };
  assert.equal(ruleOpen(weekendDec, SAT), true);
  assert.equal(ruleOpen(weekendDec, SUN), true);
  assert.equal(ruleOpen(weekendDec, MON), false, "right span, wrong weekday");
  assert.equal(ruleOpen(weekendDec, "2026-11-29"), false, "a Sunday, but before the span");
  assert.equal(ruleOpen(weekendDec, "2026-12-26"), false, "a Saturday, but after the span");
  assert.equal(ruleOpen(weekendDec, "2026-12-24"), false, "the last day is inside, but it is a Thursday");
  assert.equal(ruleOpen(weekendDec, "2026-12-19"), true, "the last Saturday inside the span");
  assert.equal(ruleOpen({ days: [], from: "2026-12-10", to: "2026-12-16" }, "2026-12-13"), true,
    "an empty weekday set means every day of the span");
  assert.equal(ruleOpen({ days: [6] }, "2027-06-05"), true, "weekdays alone never end");
  assert.equal(ruleOpen({ days: [6] }, "2027-06-04"), false);
  assert.equal(ruleOpen(weekendDec, "not-a-date"), false);
  assert.equal(ruleOpen(null, SAT), false);
});

test("rulesOpen ORs the marks together", () => {
  const rules = [
    { days: [], from: "2026-12-01", to: "2026-12-05" },
    { days: [6, 0], from: "2026-12-20", to: "2026-12-31" },
  ];
  assert.equal(rulesOpen(rules, "2026-12-02"), true, "inside the first run");
  assert.equal(rulesOpen(rules, "2026-12-26"), true, "a Saturday inside the second");
  assert.equal(rulesOpen(rules, "2026-12-24"), false, "a Thursday in the second mark's span");
  assert.equal(rulesOpen(rules, "2026-12-12"), false, "the gap between the two runs");
});

test("sellOpen: no marks at all is every day, which is what every old product does", () => {
  assert.equal(sellOpen({ name: "Focaccia" }, "2026-12-07"), true);
  assert.equal(sellOpen({ sellRules: [] }, "2026-12-07"), true);
  assert.equal(sellOpen({ sellRules: [{ days: [6, 0] }] }, MON), false);
  assert.equal(sellOpen({ sellRules: [{ days: [6, 0] }] }, SAT), true);
  assert.equal(sellOpen(null, SAT), true, "a product that isn't ours is never locked");
  assert.equal(sellOpen({ sellRules: [{ days: [6] }] }, "nonsense"), true, "an unknown date never locks");
});

test("availRules reads an older product's validFrom/validTo as one mark", () => {
  const legacy = availRules({ validFrom: "2026-12-01", validTo: "2026-12-24" });
  assert.deepEqual(legacy, [{ days: [], from: "2026-12-01", to: "2026-12-24" }]);
  assert.deepEqual(availRules({ validFrom: "2026-12-01" }), [{ days: [], from: "2026-12-01", to: "" }],
    "one end alone was allowed too, and still is");
  assert.deepEqual(availRules({ validFrom: "junk", validTo: "2026-12-24" }),
    [{ days: [], from: "", to: "2026-12-24" }], "a malformed end is ignored, not trusted");
  assert.deepEqual(availRules({ sellRules: [{ days: [6] }] }), [{ days: [6], from: "", to: "" }]);
  assert.deepEqual(availRules({
    validFrom: "2026-12-01", validTo: "2026-12-24",
    sellRules: [{ days: [], from: "2026-12-01", to: "2026-12-24" }],
  }), [{ days: [], from: "2026-12-01", to: "2026-12-24" }],
  "the same period stated twice counts once, so a mid-release save cannot double it");
  assert.deepEqual(availRules(null), []);
});

test("sellReason names what blocks a day, as data — never a sentence", () => {
  assert.equal(sellReason({}, MON), null, "no marks blocks nothing");
  assert.deepEqual(sellReason({ sellRules: [{ days: [6, 0] }] }, MON), { kind: "days", days: [0, 6] });
  assert.deepEqual(sellReason({ sellRules: [{ days: [], from: "2026-12-10", to: "2026-12-16" }] }, "2026-12-09"),
    { kind: "from", date: "2026-12-10" });
  assert.deepEqual(sellReason({ sellRules: [{ days: [], from: "2026-12-10", to: "2026-12-16" }] }, "2026-12-17"),
    { kind: "to", date: "2026-12-16" });
  assert.deepEqual(sellReason({
    sellRules: [{ days: [], from: "2026-12-01", to: "2026-12-05" }, { days: [], from: "2026-12-20", to: "2026-12-24" }],
  }, "2026-12-12"), { kind: "unmarked" });
  assert.equal(sellReason({ sellRules: [{ days: [6, 0] }] }, SAT), null, "a sell day has no reason");
  assert.equal(sellReason({ sellRules: [{ days: [6] }] }, "nonsense"), null);
});

test("a mark that has already ended still reads as a mark, so a dated special stays dated", () => {
  // Deliberately no pruning: if a finished mark were dropped, the product would be
  // left with no marks at all — and no marks means every delivery day, which would
  // silently re-open a December-only special the moment it was re-saved in January.
  const dec = { days: [], from: "2026-12-01", to: "2026-12-24" };
  assert.equal(sellOpen({ sellRules: [dec] }, "2027-03-08"), false,
    "March is not a sell day for a December-only special");
  assert.deepEqual(sellReason({ sellRules: [dec] }, "2027-03-08"), { kind: "to", date: "2026-12-24" });
  assert.equal(rulesSummary([dec]), "1-24 Dec 2026", "and the header still says which period it was");
});

test("ruleLabel writes a mark in one line", () => {
  assert.equal(ruleLabel({ days: [6, 0], from: "2026-12-01", to: "2026-12-24" }), "Sat & Sun · 1-24 Dec 2026");
  assert.equal(ruleLabel({ days: [], from: "2026-12-10", to: "2026-12-16" }), "10-16 Dec 2026");
  assert.equal(ruleLabel({ days: [6, 0] }), "Sat & Sun");
  assert.equal(ruleLabel({ days: [1] }), "Mon");
  assert.equal(ruleLabel({ days: [1, 3, 5] }), "Mon, Wed & Fri");
  assert.equal(ruleLabel({ days: [], from: "2026-12-01" }), "from 1 Dec 2026");
  assert.equal(ruleLabel({ days: [], to: "2026-12-24" }), "until 24 Dec 2026");
  assert.equal(ruleLabel({ days: [], from: "2026-12-24", to: "2026-12-24" }), "24 Dec 2026",
    "a one-day mark is just its date");
  assert.equal(ruleLabel(null), "", "nothing to say about nothing");
});

test("ruleLabel reads a span that crosses a month, or a year, out loud", () => {
  assert.equal(ruleLabel({ days: [], from: "2026-11-28", to: "2027-01-04" }), "28 Nov 2026 - 4 Jan 2027",
    "a mark running over the year end names both dates in full");
  assert.equal(ruleLabel({ days: [6, 0], from: "2026-12-28", to: "2027-01-04" }), "Sat & Sun · 28 Dec 2026 - 4 Jan 2027");
  assert.equal(ruleLabel({ days: [], from: "2026-12-28", to: "2027-01-04" }), "28 Dec 2026 - 4 Jan 2027");
});

test("rulesSummary is what the folded header reads", () => {
  assert.equal(rulesSummary([]), "Every day", "nothing marked is the honest answer");
  assert.equal(rulesSummary([{ days: [6, 0], from: "2026-12-01", to: "2026-12-24" }]), "Sat & Sun · 1-24 Dec 2026");
  assert.equal(rulesSummary([
    { days: [], from: "2026-12-01", to: "2026-12-05" },
    { days: [6, 0] },
  ]), "1-5 Dec 2026 + Sat & Sun", "two marks both fit on the line");
  assert.equal(rulesSummary([
    { days: [], from: "2026-12-01", to: "2026-12-05" },
    { days: [], from: "2026-12-10", to: "2026-12-16" },
    { days: [6, 0] },
  ]), "1-5 Dec 2026 + 10-16 Dec 2026 +1 more", "past two it is a count");
});

test("availSummary answers for a whole product, legacy pair included", () => {
  assert.equal(availSummary({ name: "Focaccia" }), "Every day");
  assert.equal(availSummary({ validFrom: "2026-12-01", validTo: "2026-12-24" }), "1-24 Dec 2026",
    "an old from–to product reads in the header before she ever opens the card");
  assert.equal(availSummary({ sellRules: [{ days: [6, 0] }] }), "Sat & Sun");
});

test("monthBounds is the whole month a weekday tap marks", () => {
  assert.deepEqual(monthBounds(2026, 11), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(monthBounds(2026, 1), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds(2024, 1), { from: "2024-02-01", to: "2024-02-29" }, "a leap February ends on the 29th");
  assert.deepEqual(monthBounds(2026, 0), { from: "2026-01-01", to: "2026-01-31" });
});

test("a weekday mark bounded by a month sells that weekday only, and stays inside it", () => {
  const dec = { days: [1], ...monthBounds(2026, 11) };
  assert.equal(sellOpen({ sellRules: [dec] }, "2026-12-07"), true, "the first Monday of December");
  assert.equal(sellOpen({ sellRules: [dec] }, "2026-12-28"), true, "the last Monday of December");
  assert.equal(sellOpen({ sellRules: [dec] }, "2027-01-04"), false,
    "the next month's Monday is not sold — this is what 'not default for next month' means");
  assert.deepEqual(sellReason({ sellRules: [dec] }, "2026-12-08"), { kind: "days", days: [1] });
  assert.deepEqual(sellReason({ sellRules: [dec] }, "2027-01-04"), { kind: "to", date: "2026-12-31" });
});
