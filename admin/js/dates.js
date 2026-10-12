// dates.js — delivery-date generation, cut-off derivation, countdown.
// Pure module: no DOM, no localStorage. Runs under Node for tests.

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function todayISO() {
  return toISODate(new Date());
}

// Cut-off = the day BEFORE the delivery date at the configured local time.
export function cutoffTimestamp(dateStr, settings) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const [hh, mm] = String(settings.cutoff || "18:00").split(":").map(Number);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function deliveryStatus(dateStr, settings, now = new Date()) {
  const cutoff = cutoffTimestamp(dateStr, settings);
  const closed = now > cutoff;
  const past = dateStr < todayISO();
  let countdown = "";
  if (!closed && !past) {
    const diffMs = cutoff - now;
    countdown = formatCountdown(diffMs);
  }
  return { closed, past, countdown, cutoff };
}

export function formatCountdown(ms) {
  if (ms <= 0) return "";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (h < 24) return `${h}h ${m}m`;
  const days = Math.floor(h / 24);
  return `${days}d ${h % 24}h`;
}

// Next `n` delivery dates from TOMORROW onward matching settings.deliveryDays,
// skipping dates that already exist in `existing`.
export function generateUpcomingDates(settings, n = 8, existing = []) {
  const existingSet = new Set(existing);
  const days = new Set(settings.deliveryDays || []);
  const out = [];
  let cursor = addDays(todayISO(), 1);
  let guard = 0;
  while (out.length < n && guard < 400) {
    const dayNum = new Date(`${cursor}T00:00:00`).getDay();
    if (days.has(dayNum) && !existingSet.has(cursor)) out.push(cursor);
    cursor = addDays(cursor, 1);
    guard++;
  }
  return out;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayName(dateStr) {
  return WEEKDAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()];
}

// The same names the other way round: a weekday NUMBER (0 = Sunday) as a name, for
// naming a weekday rule rather than a date — a delivery-day pattern, or "the next
// Monday" on a calendar column.
export function dayName(n) {
  return WEEKDAY_NAMES[Number(n)] || "";
}

// "Mon, Wed and Fri" — a list of weekday numbers said the way a person would,
// wherever the app names her pattern back to her.
export function dayListLabel(days) {
  const names = (days || []).map(dayName).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function longDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// "1 Oct" — the day and the month, without the year. ★ IT IS A COLUMN-WIDTH DECISION (v390): on the
// stock card the When cell is the NARROW one, and "Thu, 1 Oct 2026" would be cut to "Thu, 1…" — the
// same trap the filing page's fixed widths set at v385. ⚠️ The full date stays in the sentence every
// renderer reads, so nothing is lost by shortening the cell.
export function dayMonth(dateStr) {
  return longDate(dateStr).slice(0, -5);
}

// Compact "Wed, 9 Sep" — same style as the storefront's chosen delivery day, so
// the two pages show dates the same way.
export function shortDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${weekdayName(dateStr)}, ${d.getDate()} ${months[d.getMonth()]}`;
}

// When an order was placed, for the "Placed …" line: "1 Sep · 14:32" from the
// full createdAt timestamp, falling back to the order's date when the
// timestamp is missing or malformed. Never writes time into orderDate — other
// callers slice orderDate's first 10 chars as a pure date.
export function fmtPlaced(createdAt, orderDate) {
  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${d.getDate()} ${months[d.getMonth()]} · ${hh}:${mm}`;
    }
  }
  return orderDate ? String(orderDate) : "";
}

// ★★ IS THIS DAY INSIDE THE WINDOW? — AND AN EMPTY BOUND MEANS "NO BOUND" (v403).
//
// ⚠️⚠️ THIS RULE HAD BEEN WRITTEN OUT THREE TIMES — `isWithin` in `money.js:32`, `inRange` in
// `profit.js:35`, and a third copy inline in `weekly.js:46` — and the duplication bit the moment it
// mattered. Her words: __"I need something more vasatile, like what we have for invoice"__, and the
// invoice answers "all of it" with the pair `{from:"", to:""}` (`periodSpan`). ⚠️ **`"2026-10-01" <=
// ""` is FALSE**, so an unbounded window matched NOTHING: Profit's "All" read **Sales RM 0.00** beside
// a month of real orders, with no error anywhere. Fixing it in one copy left the other two broken —
// which is the argument for it living HERE, once.
//
// ⚠️ Every caller that passes real dates is unaffected: `!from` and `!to` are only true for "".
export function isWithin(iso, from, to) {
  const day = String(iso || "").slice(0, 10);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}
