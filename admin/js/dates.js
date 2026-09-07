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

export function weekdayName(dateStr) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[new Date(`${dateStr}T00:00:00`).getDay()];
}

export function longDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Compact "Wed, 9 Sep" — same style as the storefront's date pills, so the two
// pages show dates the same way.
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
