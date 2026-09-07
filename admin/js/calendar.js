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

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
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
