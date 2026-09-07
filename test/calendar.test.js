// test/calendar.test.js — the month-grid helpers behind the delivery-date
// picker (admin/js/calendar.js). Sun-first weeks, ISO date cells.

import { test } from "node:test";
import assert from "node:assert/strict";

const { addMonth, DOW, OCC_COLOURS, monthLabel, monthWeeks, occColour,
  occForDate, occForDateAll, occDays, occRange, occSingleDay, occStrength } =
  await import("../admin/js/calendar.js");

function flatDates(grid) { return grid.flat().filter(Boolean); }

test("DOW starts on Sunday", () => {
  assert.deepEqual(DOW, ["S", "M", "T", "W", "T", "F", "S"]);
});

test("September 2026: Sun-first padding, exactly 30 real dates, rows of 7", () => {
  const weeks = monthWeeks(2026, 8); // Sep 2026 starts on a Tuesday
  for (const row of weeks) assert.equal(row.length, 7, "every row is a week of 7 cells");

  const dates = flatDates(weeks);
  assert.equal(dates.length, 30, "one cell per September day");
  assert.equal(dates[0], "2026-09-01", "first cell is the 1st after the padding");
  assert.equal(dates[dates.length - 1], "2026-09-30");
  assert.equal(new Set(dates).size, 30, "no duplicates");
  assert.equal(weeks[0][0], null, "row 0 starts blank (weekday gap)");
  assert.equal(weeks[0][2], "2026-09-01", "Tuesday 1 Sep sits in the Tuesday column");
  assert.equal(weeks.length, 5);
});

test("a Sunday-start month begins in the first cell with no padding", () => {
  const weeks = monthWeeks(2026, 10); // 1 Nov 2026 is a Sunday
  assert.equal(weeks[0][0], "2026-11-01");
  const dates = flatDates(weeks);
  assert.equal(dates.length, 30);
});

test("February: leap year has 29 days, plain year has 28", () => {
  const leap = flatDates(monthWeeks(2024, 1)); // leap Feb, starts Thursday
  assert.equal(leap.length, 29);
  assert.equal(leap[leap.length - 1], "2024-02-29");
  assert.equal(leap[0], "2024-02-01");

  const plain = monthWeeks(2026, 1); // 1 Feb 2026 is a Sunday, 28 days → exact weeks
  assert.equal(flatDates(plain).length, 28);
  assert.equal(plain.length, 4, "28 days in a Sunday-start month fills exactly 4 rows");
  const p = (d) => `2026-02-${String(d).padStart(2, "0")}`;
  for (let r = 0; r < 4; r++) {
    assert.deepEqual(plain[r], Array.from({ length: 7 }, (_, c) => p(r * 7 + c + 1)),
      `row ${r} holds dates ${r * 7 + 1}–${r * 7 + 7} with no blanks`);
  }
});

test("a six-row month pads the tail, never spills into the next month", () => {
  const weeks = monthWeeks(2026, 7); // Aug 2026 starts Saturday
  assert.equal(weeks.length, 6);
  const dates = flatDates(weeks);
  assert.equal(dates.length, 31);
  assert.equal(weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1], null, "trailing blanks");
  for (const d of dates) assert.ok(d.startsWith("2026-08-"), "every cell stays inside August");
});

test("addMonth wraps across year boundaries", () => {
  assert.deepEqual(addMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(addMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(addMonth(2026, 8, 1), { year: 2026, month: 9 });
  assert.deepEqual(addMonth(2026, 8, 12), { year: 2027, month: 8 });
});

test("monthLabel renders 'September 2026' style", () => {
  assert.equal(monthLabel(2026, 8), "September 2026");
  assert.equal(monthLabel(2026, 0), "January 2026");
  assert.equal(monthLabel(2027, 11), "December 2027");
});

// ── occasion marks (delivery-calendar reminders) ─────────────────────────

test("OCC_COLOURS is the 8-colour palette the baker picks from", () => {
  assert.deepEqual(OCC_COLOURS, [
    "red", "orange", "yellow", "green", "blue", "purple", "pink", "grey",
  ]);
});

test("occColour reports each of the 8 colours, defaulting anything else to grey", () => {
  for (const colour of OCC_COLOURS) {
    assert.equal(occColour({ id: "a", from: "2026-09-14", to: "2026-09-22", label: "X", colour }), colour,
      `${colour} is kept as-is`);
  }
  assert.equal(occColour({ id: "b", from: "2026-09-28", to: "2026-09-28", label: "Y" }), "grey",
    "a mark without an explicit colour counts as grey");
  assert.equal(occColour({ id: "c", from: "2026-09-14", to: "2026-09-22", label: "Z", colour: "teal" }), "grey",
    "an unrecognised colour falls back to grey");
  assert.equal(occColour(null), "grey", "missing occasion is safe");
});

test("occForDate finds the occasion holding a day, inclusive of both ends", () => {
  const occs = [
    { id: "a", from: "2026-09-14", to: "2026-09-22", label: "School holiday" },
    { id: "b", from: "2026-09-28", to: "2026-09-28", label: "Hari Raya" }, // single day
  ];
  assert.equal(occForDate(occs, "2026-09-01"), null, "before any range");
  assert.equal(occForDate(occs, "2026-09-13"), null, "the day before a range");
  assert.equal(occForDate(occs, "2026-09-14").id, "a", "first day is inside");
  assert.equal(occForDate(occs, "2026-09-22").id, "a", "last day is inside");
  assert.equal(occForDate(occs, "2026-09-23"), null, "the day after a range");
  assert.equal(occForDate(occs, "2026-09-28").id, "b", "a single-day mark holds its one day");
  assert.equal(occForDate([], "2026-09-14"), null, "no occasions → nothing");
  assert.equal(occForDate(null, "2026-09-14"), null, "missing list is safe");
});

test("occDays counts a mark's inclusive length in days", () => {
  assert.equal(occDays({ from: "2026-09-21", to: "2026-09-21" }), 1, "a single day");
  assert.equal(occDays({ from: "2026-09-21", to: "2026-09-29" }), 9, "both ends count");
  assert.equal(occDays({ from: "2026-12-31", to: "2027-01-02" }), 3, "across a year boundary");
  assert.equal(occDays({ from: "2026-09-01", to: "2026-09-30" }), 30, "a full month");
  assert.equal(occDays(null), 0, "missing occasion is safe");
  assert.equal(occDays({ from: "", to: "" }), 0, "missing dates are safe");
});

test("occStrength fades with length: short is strong, a long stretch is soft", () => {
  const span = (from, to) => ({ from, to });
  assert.equal(occStrength(span("2026-09-28", "2026-09-28")), "strong", "1 day");
  assert.equal(occStrength(span("2026-09-28", "2026-09-30")), "strong", "3 days");
  assert.equal(occStrength(span("2026-09-21", "2026-09-24")), "mid", "4 days");
  assert.equal(occStrength(span("2026-09-21", "2026-09-30")), "mid", "10 days");
  assert.equal(occStrength(span("2026-09-21", "2026-10-02")), "soft", "12 days is the soft boundary");
  assert.equal(occStrength(span("2026-09-21", "2026-10-03")), "soft", "13 days");
  assert.equal(occStrength(null), "mid", "a missing mark counts as mid");
});

test("occForDate: when two marks overlap, the SHORTER one wins the shared day", () => {
  const longFirst = [
    { id: "long", from: "2026-09-01", to: "2026-09-12" },
    { id: "short", from: "2026-09-08", to: "2026-09-10" },
  ];
  const shortFirst = [...longFirst].reverse();
  assert.equal(occForDate(longFirst, "2026-09-09").id, "short", "short wins regardless of list order");
  assert.equal(occForDate(shortFirst, "2026-09-09").id, "short", "short wins even when listed second");
  assert.equal(occForDate(longFirst, "2026-09-05").id, "long", "the long mark alone holds its other days");
  assert.equal(occForDate(longFirst, "2026-09-13"), null, "a day outside both is free");
});

test("occSingleDay: a 1-day mark is the cell's solid; two same-day singles pick red", () => {
  const occs = [
    { id: "band", from: "2026-09-08", to: "2026-09-10", colour: "green" },
    { id: "teach", from: "2026-05-16", to: "2026-05-16", colour: "orange" }, // "Teacher's Day"
    { id: "arafat", from: "2026-05-16", to: "2026-05-16", colour: "red" },   // state public holiday
    { id: "raja", from: "2026-05-17", to: "2026-05-17", colour: "red" },    // another public holiday
    { id: "bothRed", from: "2026-05-17", to: "2026-05-17", colour: "red" },
  ];
  assert.equal(occSingleDay(occs, "2026-09-09"), null, "a multi-day band is painted as a paper, not a solid");
  assert.equal(occSingleDay(occs, "2026-09-11"), null, "a day with no 1-day mark has no solid");
  assert.equal(occSingleDay(occs, "2026-05-16").id, "arafat",
    "an orange family day must not hide a red public holiday on the same date");
  assert.equal(occSingleDay(occs, "2026-05-17").id, "raja",
    "two reds on one date keep the earlier row");
  assert.equal(occSingleDay(occs, "2026-05-15"), null, "off-date is free");
  assert.equal(occSingleDay([], "2026-05-16"), null, "no occasions → nothing");
  assert.equal(occSingleDay(null, "2026-05-16"), null, "missing list is safe");
});

test("occForDateAll lists every overlapping mark, shortest first", () => {
  const occs = [
    { id: "long", from: "2026-09-01", to: "2026-09-12" },
    { id: "short", from: "2026-09-08", to: "2026-09-10" },
  ];
  assert.deepEqual(occForDateAll(occs, "2026-09-09").map((o) => o.id), ["short", "long"]);
  assert.deepEqual(occForDateAll(occs, "2026-09-05").map((o) => o.id), ["long"]);
  assert.deepEqual(occForDateAll(occs, "2026-09-13"), []);
  assert.deepEqual(occForDateAll([], "2026-09-09"), []);
  assert.deepEqual(occForDateAll(null, "2026-09-09"), [], "missing list is safe");
});

test("occRange normalises a backwards drag to earlier → later", () => {
  assert.deepEqual(occRange("2026-09-29", "2026-09-21"), ["2026-09-21", "2026-09-29"]);
  assert.deepEqual(occRange("2026-09-21", "2026-09-29"), ["2026-09-21", "2026-09-29"]);
  assert.deepEqual(occRange("2026-09-25", "2026-09-25"), ["2026-09-25", "2026-09-25"], "single day");
  assert.equal(occRange("", "2026-09-29"), null);
  assert.equal(occRange(null, null), null);
});
