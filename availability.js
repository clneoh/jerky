// availability.js — a product's SELL DAYS: the pure rules behind the Availability
// card, shared by the backoffice (admin/js/views/products.js) and the shop
// (store/pool.js). No DOM, no localStorage — runs under Node for tests.
//
// A product sells on the dates its MARKS point at. A mark is a span with a weekday
// set:
//
//   { days: [6, 0], from: "2026-12-01", to: "2026-12-24" }   every Sat & Sun, 1-24 Dec
//   { days: [],     from: "2026-12-10", to: "2026-12-16" }   every day, 10-16 Dec
//   { days: [6, 0] }                                        every Sat & Sun, always
//
// `days` are JS getDay() ints (0 Sun … 6 Sat — the same numbering as
// settings.deliveryDays), and an empty set means every day of the span. Marks OR
// together: a date sells when it falls inside SOME mark's span and matches that
// mark's weekdays. Either end may be left open, which is how a mark says "from
// here on" or "up to here" rather than naming both ends.
//
// NO marks at all means every delivery day. That is what every product did before
// marks existed, so a product the baker never opens keeps selling exactly as it
// does today — and it is why the card can honestly show all seven weekdays ticked
// without storing anything.
//
// ONE copy, imported by both trees, rather than the duplicate-and-drift-guard the
// two calendars use: this is a shared root module like i18n.js (which store/app.js
// already imports), not a backoffice file the shop would be reaching into. The
// shop's offline worker is network-first, so it needs no cache-list entry.

function pad2(n) { return String(n).padStart(2, "0"); }

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(k) {
  return typeof k === "string" && ISO_RE.test(k);
}

// The weekday a day key falls on, 0 Sun … 6 Sat. Parsed as a LOCAL date, like
// every other day key in the app (see admin/js/dates.js toISODate).
export function dayOfWeek(iso) {
  return new Date(`${iso}T00:00:00`).getDay();
}

// A mark's weekday set: whole numbers 0-6, each once, ascending. Anything else —
// a stray 7, a repeat — is dropped rather than trusted. A blank (null, undefined,
// "", false) is NOT zero: Number(null) is 0, and that would silently mean Sunday.
export function normDays(days) {
  const out = [];
  for (const d of Array.isArray(days) ? days : []) {
    if (d == null || d === "" || d === false) continue;
    if (typeof d !== "number" && typeof d !== "string") continue;
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

// One mark, or null when it says nothing usable. A mark needs at least one end OR
// at least one weekday — `{days:[6,0]}` alone is "every Sat & Sun, always" — but a
// mark with neither says nothing at all and is dropped. A backwards span is
// swapped rather than rejected, because a drag may go either way and the baker
// should not have to care which end she started from.
export function normRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const from = isDayKey(rule.from) ? rule.from : "";
  const to = isDayKey(rule.to) ? rule.to : "";
  const days = normDays(rule.days);
  if (!from && !to && !days.length) return null;
  return from && to && from > to ? { days, from: to, to: from } : { days, from, to };
}

export function normRules(rules) {
  const out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    const n = normRule(r);
    if (n) out.push(n);
  }
  return out;
}

// The marks a product carries, including the field names products used before the
// card existed: an older product states its period as validFrom/validTo, which is
// exactly a mark with no weekdays. Read as one rather than migrated, so a product
// she never re-saves keeps selling what it always did. Either end may be the only
// one set — the old fields allowed that too.
export function availRules(product) {
  const p = product || {};
  const out = normRules(p.sellRules);
  const from = isDayKey(p.validFrom) ? p.validFrom : "";
  const to = isDayKey(p.validTo) ? p.validTo : "";
  if (from || to) {
    const legacy = normRule({ days: [], from, to });
    // Only if it is not already stated as a mark (a save writes both out for one
    // release, so the same period must not count twice).
    if (legacy && !out.some((r) => !r.days.length && r.from === legacy.from && r.to === legacy.to)) {
      out.push(legacy);
    }
  }
  return out;
}

// Does this one mark cover this day?
export function ruleOpen(rule, iso) {
  const r = normRule(rule);
  if (!r || !isDayKey(iso)) return false;
  if (r.from && iso < r.from) return false;
  if (r.to && iso > r.to) return false;
  return r.days.length ? r.days.includes(dayOfWeek(iso)) : true;
}

export function rulesOpen(rules, iso) {
  return normRules(rules).some((r) => ruleOpen(r, iso));
}

// The whole rule, for a product: true when the product may be ordered for this
// delivery date. No marks at all is every day.
export function sellOpen(product, iso) {
  if (!isDayKey(iso)) return true;
  const rules = availRules(product);
  return rules.length ? rulesOpen(rules, iso) : true;
}

// The weekday set of every mark whose SPAN holds this day, unioned — what a
// "only sold on …" sentence needs to name.
function spanDays(spans) {
  const out = [];
  for (const r of spans) for (const d of r.days) if (!out.includes(d)) out.push(d);
  return out.sort((a, b) => a - b);
}

// Why this day is not a sell day, or null when it is one. The reason comes back as
// DATA, never as a sentence: the shop writes it in the visitor's language and
// formats the date itself, so no English weekday or month may be baked in here.
//
//   { kind: "days", days: [..] }  inside a mark's span, but not one of its weekdays
//   { kind: "from", date }        before every mark's start
//   { kind: "to", date }          after every mark's end
//   { kind: "unmarked" }          in the gap between two marks
export function sellReason(product, iso) {
  if (!isDayKey(iso)) return null;
  const rules = availRules(product);
  if (!rules.length || rules.some((r) => ruleOpen(r, iso))) return null;

  const spans = rules.filter((r) => (!r.from || iso >= r.from) && (!r.to || iso <= r.to));
  const days = spanDays(spans);
  if (days.length) return { kind: "days", days };

  const starts = rules.map((r) => r.from).filter(Boolean).sort();
  const ends = rules.map((r) => r.to).filter(Boolean).sort();
  if (starts.length && iso < starts[0]) return { kind: "from", date: starts[0] };
  if (ends.length && iso > ends[ends.length - 1]) return { kind: "to", date: ends[ends.length - 1] };
  return { kind: "unmarked" };
}

// NOTE: a mark that has already ended is deliberately KEPT. Dropping it would leave
// the product with no marks at all, and no marks means every delivery day — so
// re-saving a product in January would silently re-open a December-only special to
// the whole year. Her own rule settles it: if no sell dates are indicated, it is not
// selling. A dated special therefore stays a dated special until she takes the mark
// off with the ✕, which is the one way to say "back to every day" on purpose.

// ── the card's own words (English, backoffice only) ──────────────────────────
// The shop never calls these: it words its own sentence in the visitor's language
// from the reason above.

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The order a label names weekdays in: the bakery's week starts on Monday (the
// same order settings.deliveryDays is written and shown in), so a weekend mark
// reads "Sat & Sun" rather than "Sun & Sat".
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// "Sat", "Sat & Sun", "Mon, Wed & Fri" — in the bakery's week order.
function dayList(days) {
  const names = normDays(days)
    .sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
    .map((d) => EN_DAYS[d]);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// "1-24 Dec 2026" inside one month, "28 Nov - 4 Jan 2027" across two, and a plain
// date when the mark starts and ends on the same day. An open end reads as such.
function spanLabel(from, to) {
  if (!from && !to) return "";
  if (!from) return `until ${fmt(to)}`;
  if (!to) return `from ${fmt(from)}`;
  if (from === to) return fmt(from);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm) return `${fd}-${td} ${EN_MONTHS[fm - 1]} ${fy}`;
  return `${fmt(from)} - ${fmt(to)}`;

  function fmt(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${EN_MONTHS[m - 1]} ${y}`;
  }
}

// A mark in one line — "Sat & Sun · 1-24 Dec 2026", "10-16 Dec 2026".
export function ruleLabel(rule) {
  const r = normRule(rule);
  if (!r) return "";
  const d = dayList(r.days);
  const s = spanLabel(r.from, r.to);
  return d && s ? `${d} · ${s}` : (d || s);
}

// What the folded header reads. Two marks fit; past that it is a count, because
// the header is one line and the marks themselves are listed inside the card.
export function rulesSummary(rules) {
  const labels = normRules(rules).map(ruleLabel).filter(Boolean);
  if (!labels.length) return "Every day";
  if (labels.length <= 2) return labels.join(" + ");
  return `${labels.slice(0, 2).join(" + ")} +${labels.length - 2} more`;
}

export function availSummary(product) {
  return rulesSummary(availRules(product));
}

// The month's own bounds — what tapping a weekday heading marks, so a mark made
// that way stays inside the month she was looking at and does not carry over.
export function monthBounds(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad2(month + 1)}-01`, to: `${year}-${pad2(month + 1)}-${pad2(last)}` };
}
