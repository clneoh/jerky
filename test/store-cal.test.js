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
  rollingWeeks, weekIndex, windowBounds, WINDOW_WEEKS,
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

// ── the rolling window the customer's picker draws ───────────────────────────
// Nothing in the backoffice has an equivalent, so these are not pinned to the app
// copy the way the helpers above are: they are tested on their own terms. The
// window replaces a month grid for one reason — at the end of a month almost every
// day on a month grid is already past, and the days before the 1st and after the
// last are invisible padding — so the tests are about it always being whole weeks
// of real dates, and never able to hide a date the baker has published.

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Plain calendar arithmetic, the same rollover the window does — so the expected
// dates are computed without reusing the code under test.
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const daysFrom = (iso, n) => range(0, n - 1).map((i) => plusDays(iso, i));

test("the window is whole Sun-first weeks, and today's own week is the second row", () => {
  const weeks = rollingWeeks("2026-09-01"); // a Tuesday
  assert.equal(weeks.length, WINDOW_WEEKS, "five rows");
  assert.ok(weeks.every((w) => w.length === 7), "seven days in each");
  const days = weeks.flat();
  assert.equal(new Set(days).size, days.length, "no day appears twice");
  assert.deepEqual(days, daysFrom(days[0], WINDOW_WEEKS * 7),
    "every cell is a real, consecutive date — nothing padded, nothing skipped");
  assert.equal(new Date(`${days[0]}T00:00:00`).getDay(), 0, "the first cell is a Sunday");

  // Whichever weekday today is, the week just gone sits above it. That is what
  // makes the days already past read as context for today rather than as the page.
  for (const iso of daysFrom("2026-09-01", 7)) {
    const w = rollingWeeks(iso);
    assert.ok(w[1].includes(iso), `${iso} is on the second row`);
    assert.ok(w[0].every((d) => d < iso), `every day above ${iso} is already past`);
    assert.equal(new Date(`${w[1][0]}T00:00:00`).getDay(), 0, "…and that row starts on its Sunday");
  }
});

test("the window pages by whole weeks, and the row count is the caller's", () => {
  const base = rollingWeeks("2026-09-01");
  const next = rollingWeeks("2026-09-01", { offset: 1 });
  assert.equal(next[0][0], plusDays(base[0][0], 7), "one week on starts a week later");
  assert.ok(next[0].includes("2026-09-01"), "and today has moved up into the top row");
  assert.ok(!rollingWeeks("2026-09-01", { offset: 2 }).flat().includes("2026-09-01"),
    "two weeks on, today is behind the window");
  assert.equal(rollingWeeks("2026-09-01", { offset: -1 })[0][0], plusDays(base[0][0], -7),
    "a week back starts a week earlier");
  const three = rollingWeeks("2026-09-01", { rows: 3 });
  assert.equal(three.length, 3, "three rows asked for, three drawn");
  assert.deepEqual(three[0], base[0], "and a shorter window starts in the same place");
});

test("a week index counts whole weeks from today's own", () => {
  assert.equal(weekIndex("2026-09-01", "2026-09-01"), 0, "a day in today's week is week 0");
  assert.equal(weekIndex("2026-09-01", "2026-09-05"), 0, "…wherever in that week it falls");
  assert.equal(weekIndex("2026-09-01", "2026-08-31"), 0,
    "the day before today is still this week — weeks run Sunday to Saturday");
  assert.equal(weekIndex("2026-09-01", "2026-08-30"), 0, "…back to its own Sunday");
  assert.equal(weekIndex("2026-09-01", "2026-08-29"), -1, "the Saturday before that is last week");
  assert.equal(weekIndex("2026-09-01", "2026-09-06"), 1, "the Sunday after is the next week");
  assert.equal(weekIndex("2026-09-01", "2026-09-20"), 3, "three whole weeks out");
  // It agrees with the window itself: the row a day sits in is its index + 1.
  for (const iso of rollingWeeks("2026-09-01").flat()) {
    const row = rollingWeeks("2026-09-01").findIndex((w) => w.includes(iso));
    assert.equal(row, weekIndex("2026-09-01", iso) + 1, `${iso} sits in its own week's row`);
  }
});

test("wherever the window opens there is a date to book, and every date stays reachable", () => {
  const today = "2026-09-01";
  const dates = ["2026-09-02", "2026-09-17", "2026-10-05", "2026-10-31", "2026-12-24"];
  const window = (o) => rollingWeeks(today, { offset: o }).flat();
  for (const first of dates) {
    for (const last of dates.filter((d) => d >= first)) {
      const { home, last: far } = windowBounds(today, first, last);
      const where = `${first}→${last}`;
      assert.ok(home >= 0, `${where}: the window never opens on a week already gone`);
      assert.ok(far >= home, `${where}: the far end is never behind the near one`);
      // Opening on a page with nothing to book is the failure this guards, and it
      // is the one case a fixed "today" window would produce whenever the baker has
      // published only dates further out.
      assert.ok(window(home).includes(first), `${where}: ${first} is on screen when it opens`);
      assert.ok(window(far).includes(last), `${where}: ${last} is on screen at the far end`);
      // And no date in between can be paged past: each one has a window of its own.
      const spanned = 1 + (new Date(`${last}T00:00:00`) - new Date(`${first}T00:00:00`)) / 86400000;
      for (const iso of daysFrom(first, spanned)) {
        assert.ok(range(home, far).some((o) => window(o).includes(iso)), `${iso} can be paged to`);
      }
    }
  }
});
