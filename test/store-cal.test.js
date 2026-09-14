// test/store-cal.test.js — the shop's month-grid and occasion helpers
// (store/calendar.js). The shop carries its own copies of these rather than
// importing the backoffice tree (like the duplicated waNumber), so the first test
// here pins the two copies together: any edit to one that is not made to the other
// fails loudly instead of drifting on the customer's page. It matters most for the
// occasion helpers, because the whole point of the shop's marks is that a day looks
// the same to the customer as it does in the baker's own calendar.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  monthWeeks, addMonth, occColour, occDays, occStrength, occForDate, occSingleDay,
} from "../store/calendar.js";
import {
  monthWeeks as adminWeeks, addMonth as adminAddMonth,
  occColour as adminColour, occDays as adminDays, occStrength as adminStrength,
  occForDate as adminForDate, occSingleDay as adminSingleDay,
} from "../admin/js/calendar.js";

// Every month of two years plus a couple of far ones — leap years, 31/30/28-day
// months, months starting on each weekday.
function spread() {
  const out = [];
  for (const y of [2026, 2027, 2028]) for (let m = 0; m < 12; m++) out.push([y, m]);
  out.push([1999, 1], [2000, 1], [2100, 1]);
  return out;
}

test("the shop's grid is identical to the app's, month for month", () => {
  for (const [y, m] of spread()) {
    assert.deepEqual(monthWeeks(y, m), adminWeeks(y, m), `${y}-${m} weeks agree`);
    for (const delta of [-13, -1, 0, 1, 13]) {
      assert.deepEqual(addMonth(y, m, delta), adminAddMonth(y, m, delta),
        `${y}-${m} ${delta} months agree`);
    }
  }
});

// The marks the shop draws are the app's own vocabulary copied across, so the two
// copies of the occasion helpers have to agree on every shape a mark can take: the
// eight colours, a missing or unrecognised colour, a single day, a run just long
// enough to change strength and just long enough to change again, overlapping marks
// (shortest wins the day), and a mark with no dates at all.
const MARKS = [
  { label: "one day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
  { label: "three days", from: "2026-09-19", to: "2026-09-21", colour: "orange" },
  { label: "four days", from: "2026-09-19", to: "2026-09-22", colour: "yellow" },
  { label: "eleven days", from: "2026-09-19", to: "2026-09-29", colour: "green" },
  { label: "twelve days", from: "2026-09-19", to: "2026-09-30", colour: "blue" },
  { label: "no colour", from: "2026-10-01", to: "2026-10-02" },
  { label: "odd colour", from: "2026-10-03", to: "2026-10-04", colour: "teal" },
  { label: "no dates" },
  { label: "backwards", from: "2026-10-10", to: "2026-10-01", colour: "purple" },
  { label: "pink one", from: "2026-09-19", to: "2026-09-19", colour: "pink" },
  { label: "red one", from: "2026-09-19", to: "2026-09-19", colour: "red" },
];

test("the shop's occasion helpers are the app's, mark for mark", () => {
  for (const m of MARKS) {
    assert.equal(occColour(m), adminColour(m), `${m.label} colour agrees`);
    assert.equal(occDays(m), adminDays(m), `${m.label} length agrees`);
    assert.equal(occStrength(m), adminStrength(m), `${m.label} strength agrees`);
  }
  // Every day of a fortnight that the marks above overlap on: the day's mark and
  // its single-day box have to be the same one on both sides.
  for (let d = 1; d <= 14; d++) {
    const iso = `2026-09-${String(d).padStart(2, "0")}`;
    assert.equal(occForDate(MARKS, iso)?.label, adminForDate(MARKS, iso)?.label,
      `${iso} is named by the same mark`);
    assert.equal(occSingleDay(MARKS, iso)?.label, adminSingleDay(MARKS, iso)?.label,
      `${iso} draws the same single-day box`);
  }
});

test("the strength steps at three and twelve days", () => {
  assert.equal(occStrength({ from: "2026-09-01", to: "2026-09-01" }), "strong");
  assert.equal(occStrength({ from: "2026-09-01", to: "2026-09-03" }), "strong");
  assert.equal(occStrength({ from: "2026-09-01", to: "2026-09-04" }), "mid");
  assert.equal(occStrength({ from: "2026-09-01", to: "2026-09-11" }), "mid");
  assert.equal(occStrength({ from: "2026-09-01", to: "2026-09-12" }), "soft");
});

test("a month grid is whole Sun-first weeks with null padding", () => {
  for (const [y, m] of spread()) {
    const weeks = monthWeeks(y, m);
    for (const w of weeks) assert.equal(w.length, 7, "seven cells in every row");
    const days = weeks.flat().filter(Boolean);
    const daysIn = new Date(y, m + 1, 0).getDate();
    assert.equal(days.length, daysIn, "every date of the month appears once");
    assert.equal(days[0], `${y}-${String(m + 1).padStart(2, "0")}-01`, "starts on the 1st");
    assert.equal(new Set(days).size, daysIn, "no date appears twice");
    // Padding is only ever null, and each real date sits in its own weekday column.
    for (const w of weeks) {
      for (let i = 0; i < 7; i++) {
        if (w[i] == null) continue;
        assert.equal(new Date(`${w[i]}T00:00:00`).getDay(), i, `${w[i]} sits on its weekday`);
      }
    }
  }
});

test("February 2028 starts on a Tuesday and ends in a full row", () => {
  const weeks = monthWeeks(2028, 1); // Feb 2028 — a leap year, 29 days
  assert.equal(weeks[0][0], null, "Sunday before the 1st is blank");
  assert.equal(weeks[0][2], "2028-02-01", "the 1st sits in the Tuesday column");
  assert.equal(weeks[0][6], "2028-02-05");
  assert.deepEqual(weeks.at(-1), ["2028-02-27", "2028-02-28", "2028-02-29", null, null, null, null],
    "the leap day closes the month and the tail is padded out");
});

test("addMonth crosses year boundaries in both directions", () => {
  assert.deepEqual(addMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(addMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(addMonth(2026, 5, 12), { year: 2027, month: 5 });
  assert.deepEqual(addMonth(2026, 5, 0), { year: 2026, month: 5 });
});
