// calendar.js — pure month-grid helpers for the "manage delivery dates"
// calendar picker. Weeks start on Sunday (the app's week). No DOM — runs under
// Node for tests. Cell values are ISO "YYYY-MM-DD" strings for the displayed
// month; adjacent-month padding cells are null.

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

// ── the rolling window the delivery-day picker draws ─────────────────────────
// A month grid is the wrong shape for a delivery picker. At the end of a month
// almost every day on screen is already past, and the days before the 1st and
// after the last of the month are invisible padding — so the grid reads as empty
// exactly when the baker has come to work on it. This window follows today
// instead: five Sun-first weeks beginning with the week just gone, so the row
// above today is always last week and today is always in the second row. Every
// cell is a real date; nothing is padded.
//
// Copied verbatim from store/calendar.js, where the customer's own picker draws
// the same window, and pinned against it by test/store-cal.test.js — a day must
// sit in the same place on the shop as it does in the back office.

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

// Where the window sits for the delivery days there are, in whole weeks.
//
// A window at offset `o` holds week indices o-1 … o+3, so the day at index `i`
// is on screen for every `o` in [i-3, i+1].
//
// `min` and `max` are as far back and as far forward as it is worth paging: just
// far enough for the earliest and the latest day to reach the far edge of the
// window, so no row is ever shown past the end of the days she has set, no day
// can be paged out of reach, and neither arrow leads to an empty page. `max` is
// the shop's own bound (windowBounds), so both calendars stop in the same place
// for the same list; `min` is the mirror of it, and exists only because the back
// office reviews and backfills days already gone — the shop's picker never looks
// back at all.
//
// `home` is where it opens: today's own window whenever a delivery day is on it,
// and otherwise the nearest window that holds the day nearest to today, so it
// never opens on a page with nothing on it. A list of only-future days and a
// list of only-past ones are the same rule seen from either side.
export function deliveryWindow(todayISO, dayISOs) {
  const idx = (dayISOs || []).filter(Boolean)
    .map((d) => weekIndex(todayISO, d)).sort((a, b) => a - b);
  if (!idx.length) return { min: 0, max: 0, home: 0 };
  const first = idx[0];
  const last = idx[idx.length - 1];
  const min = Math.min(0, first + 1);
  const max = Math.max(0, last - (WINDOW_WEEKS - 2));
  const nearest = idx.reduce((best, i) =>
    (Math.abs(i) < Math.abs(best) || (Math.abs(i) === Math.abs(best) && i > best) ? i : best), idx[0]);
  const onHome = idx.some((i) => i >= -1 && i <= WINDOW_WEEKS - 2);
  return { min, max, home: onHome ? 0 : Math.min(max, Math.max(min, nearest)) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The window's title — the span of dates it covers, not a month name, because
// the window follows today rather than the month. "20 Sep – 10 Oct", and
// "20 – 26 Sep" when both ends share a month. The back office is
// single-language, so this is the shop's English wording verbatim
// (store/app.js windowTitle) and the two calendars therefore read the same.
export function windowTitle(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${fromIso} – ${toIso}`;
  const m = MONTHS_SHORT;
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return same
    ? `${a.getDate()} – ${b.getDate()} ${m[a.getMonth()]}`
    : `${a.getDate()} ${m[a.getMonth()]} – ${b.getDate()} ${m[b.getMonth()]}`;
}

export const DOW = ["S", "M", "T", "W", "T", "F", "S"];

// ── occasion marks (delivery-calendar reminders) ─────────────────────────────
// A period of days the baker wants to remember when planning — a public
// holiday, a school-holiday stretch, CNY, Hari Raya... Purely a reminder: an
// occasion never adds or removes delivery dates or changes ordering. The baker
// picks each mark's colour from the eight below and types its own name.

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

// Every occasion holding dateISO, shortest first — a delivery day can sit
// inside several overlapping marks and its card lists them all.
export function occForDateAll(occasions, dateISO) {
  return (occasions || [])
    .filter((occ) => occ && occ.from && occ.to && occ.from <= dateISO && dateISO <= occ.to)
    .sort((a, b) => occDays(a) - occDays(b));
}

// The single-day mark a date's solid box shows. A 1-day mark is the most
// specific thing that can sit on one day; when several coincide, the red one
// wins the cell — red is the "important" mark (her Malaysia import paints
// public holidays red, so a red state holiday must not hide under an orange
// family day that falls on the same date). Any other tie keeps the first in
// the list. Longer marks are painted as the translucent bands, never here.
export function occSingleDay(occasions, dateISO) {
  const one = (occasions || [])
    .filter((occ) => occDays(occ) === 1 && occ.from <= dateISO && dateISO <= occ.to);
  if (!one.length) return null;
  return one.find((occ) => occColour(occ) === "red") || one[0];
}

// Normalise a chosen range to [earlier, later] — the drag may go backwards.
export function occRange(from, to) {
  if (!from || !to) return null;
  return from <= to ? [from, to] : [to, from];
}

// The occasions still to come from `today` (inclusive), soonest first. A mark
// needs a real end date at or after today; malformed marks are skipped. Used by
// the Home "Upcoming holidays" card so it always sees the same list the
// Delivery calendar paints.
export function upcomingOccasions(occasions, today) {
  return (occasions || [])
    .filter((o) => o && o.from && o.to && o.to >= today)
    .sort((a, b) => a.from.localeCompare(b.from));
}
