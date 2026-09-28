// store/calendar.js — month-grid helpers for the customer's "pick a delivery
// day" calendar. Weeks start on Sunday, matching the app's own calendar. No DOM
// — runs under Node for tests. Cell values are ISO "YYYY-MM-DD" strings for the
// displayed month; adjacent-month padding cells are null.
//
// Deliberately copies of the grid AND occasion helpers in admin/js/calendar.js
// rather than imports: the shop must not depend on the backoffice tree (same
// reasoning as the duplicated waNumber in app.js). test/store-cal.test.js
// asserts the two copies agree, so they cannot drift apart — which matters most
// for the occasion helpers, because the whole point of the shop's marks is that
// a day looks the same to the customer as it does in the baker's own calendar.

function pad(n) { return String(n).padStart(2, "0"); }

function iso(y, m1, d) { return `${y}-${pad(m1)}-${pad(d)}`; }

// Grid for `year` (4-digit) and `month` (0-based). Rows are Sun-first weeks;
// each row is 7 cells, blank padding is null. Every date of the month appears
// exactly once; weeks never spill into adjacent months.
export function monthWeeks(year, month) {
  const first = new Date(year, month, 1);
  const lead = first.getDay(); // 0 Sun … 6 Sat
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(iso(year, month + 1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The month `delta` months away from (year, month) → { year, month }.
export function addMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// ── the rolling window the customer's picker draws ───────────────────────────
// A month grid is the wrong shape for a delivery picker. At the end of a month
// almost every day on screen is already past, and the days before the 1st and
// after the last of the month are invisible padding — so the grid reads as empty
// exactly when the customer has come to order. This window follows today
// instead: five Sun-first weeks beginning with the week just gone, so the row
// above today is always last week and today is always in the second row. Every
// cell is a real date; nothing is padded.

export const WINDOW_WEEKS = 5;

// `offset` whole weeks forward from today's own window. All ISO "YYYY-MM-DD",
// no nulls anywhere in the grid.
export function rollingWeeks(todayISO, { offset = 0, rows = WINDOW_WEEKS } = {}) {
  const t = new Date(`${todayISO}T00:00:00`);
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay() - 7 + offset * 7);
  const out = [];
  for (let w = 0; w < rows; w++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + c);
      row.push(iso(d.getFullYear(), d.getMonth() + 1, d.getDate()));
    }
    out.push(row);
  }
  return out;
}

// The whole weeks from the one `todayISO` sits in: 0 is this week, -1 last week,
// 1 next week. This is the unit the picker's arrows move in.
export function weekIndex(todayISO, dateISO) {
  const t = new Date(`${todayISO}T00:00:00`);
  const d = new Date(`${dateISO}T00:00:00`);
  const tSun = new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay());
  const dSun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return Math.round((dSun - tSun) / 604800000);
}

// Where the window sits for a given set of dates on sale, in whole weeks.
//
// `home` is where it sits on arrival: today's own window — unless nothing on sale
// is inside it, which happens when the baker has published only dates further
// out. Then home slides forward to the first window that holds one, rather than
// opening on a page with nothing to book.
//
// `last` is as far forward as it is worth paging: the window that brings the last
// date on sale to the bottom row. So no date the baker has published can ever be
// paged out of reach.
export function windowBounds(todayISO, firstISO, lastISO) {
  const home = Math.max(0, weekIndex(todayISO, firstISO) - 1);
  return { home, last: Math.max(home, weekIndex(todayISO, lastISO) - (WINDOW_WEEKS - 2)) };
}

// ── the occasion marks ───────────────────────────────────────────────────────
// The same five helpers the app's own calendar uses, copied verbatim so a day
// wears exactly the same mark on the shop as it does in the back office. The
// shop publishes only {label, from, to, colour}, which is all these need.

export const OCC_COLOURS = ["red", "orange", "yellow", "green", "blue",
  "purple", "pink", "grey"];

// A mark's colour is whatever the baker chose — an older mark that carries no
// colour (or an unrecognised one) counts as grey.
export function occColour(occ) {
  return occ && occ.colour && OCC_COLOURS.includes(occ.colour) ? occ.colour : "grey";
}

// A mark's inclusive length in days (1 = a single day).
export function occDays(occ) {
  if (!occ || !occ.from || !occ.to) return 0;
  return Math.round(
    (new Date(`${occ.to}T00:00:00`) - new Date(`${occ.from}T00:00:00`)) / 86400000) + 1;
}

// How "solid" a mark's wash should be, from how long it runs: a 1–3 day mark is
// STRONG (it pops — the specific, noticeable day), a stretch of 12+ days is SOFT
// (a pale background wash), between the two is MID. The longer a mark, the less
// solid its wash, so a short holiday stands out even when it sits inside a long
// school-holiday break.
export function occStrength(occ) {
  const d = occDays(occ);
  if (d === 0) return "mid"; // a degenerate/no-dates mark is never painted anyway
  return d <= 3 ? "strong" : d >= 12 ? "soft" : "mid";
}

// The occasion holding dateISO. When two marks overlap on one day, the SHORTER
// one wins that day — it is the more specific mark, so its (stronger) colour
// shows, while the long one stays behind it on the days they don't share. Ties
// keep the earlier entry in the list.
export function occForDate(occasions, dateISO) {
  let best = null;
  let bestDays = Infinity;
  for (const occ of occasions || []) {
    if (!occ || !occ.from || !occ.to) continue;
    if (occ.from <= dateISO && dateISO <= occ.to) {
      const d = occDays(occ);
      if (d < bestDays) { best = occ; bestDays = d; }
    }
  }
  return best;
}

// The single-day mark a date's solid box shows. A 1-day mark is the most
// specific thing that can sit on one day; when several coincide, the red one
// wins the cell — red is the "important" mark (the imported public holidays are
// red, so a red holiday must not hide under an orange family day that falls on
// the same date). Any other tie keeps the first in the list. Longer marks are
// painted as the translucent bands, never here.
export function occSingleDay(occasions, dateISO) {
  const one = (occasions || [])
    .filter((occ) => occDays(occ) === 1 && occ.from <= dateISO && dateISO <= occ.to);
  if (!one.length) return null;
  return one.find((occ) => occColour(occ) === "red") || one[0];
}
