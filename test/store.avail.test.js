import { test } from "node:test";
import assert from "node:assert/strict";

// DOM shim (same as store.test.js) so store/app.js can render at import time.
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
}
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };

// Freeze "now" so the storefront's upcoming-dates + cutoff logic is
// deterministic: Tue 1 Sep 2026, 10:00 AM — before Wednesday's 6pm cutoff, so
// all three delivery days (Wed 2, Fri 4, Mon 7 Sep) render as marked cells on
// the September calendar.
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { CONFIG } = await import("../store/config.js");

// Replicate the storefront's upcoming-dates + date-key logic so the stub rows
// match exactly the days the page renders.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function upcomingDates(cfg) {
  const out = [];
  const now = new Date();
  for (let i = 1; out.length < cfg.upcomingCount && i < 365; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (cfg.deliveryDays.includes(d.getDay())) out.push(d);
  }
  return out;
}
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const dates = upcomingDates(CONFIG);
// Day 0 fully sold out; day 1 has Chicken Jerky left but Duck Jerky gone; day 2 open.
const agg = dates.map((d, i) => ({ date: dateKey(d), slots_left: [0, 2, 21][i] }));
const prodRows = [
  { date: dateKey(dates[0]), product: "Chicken Jerky", slots_left: 0 },
  { date: dateKey(dates[0]), product: "Duck Jerky", slots_left: 0 },
  { date: dateKey(dates[1]), product: "Chicken Jerky", slots_left: 2 },
  { date: dateKey(dates[1]), product: "Duck Jerky", slots_left: 0 },
  { date: dateKey(dates[2]), product: "Chicken Jerky", slots_left: 9 },
  { date: dateKey(dates[2]), product: "Duck Jerky", slots_left: 12 },
];
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => (String(url).includes("product_availability") ? prodRows : agg),
});

const { daySpecs, fmtDay, resolveDates, dateKey: appDateKey } = await import("../store/app.js");

test("resolveDates uses the published dates, including one outside the weekday pattern", () => {
  const today = new Date();
  const thu = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (((4 - today.getDay()) + 7) % 7 || 7));
  const thuKey = dateKey(thu);
  const gen = upcomingDates(CONFIG);
  assert.ok(!gen.some((d) => dateKey(d) === thuKey), "precondition: Thursday is not in the generated Mon/Wed/Fri list");

  const rows = gen.concat([thu]).map((d) => ({ date: dateKey(d), slots_left: 5 }));
  const out = resolveDates(gen, rows, dateKey(today));
  assert.equal(out.length, 4);
  assert.ok(out.some((d) => appDateKey(d) === thuKey), "the added Thursday shows up as a markable day");
  const keys = out.map(appDateKey);
  assert.deepEqual(keys, [...keys].sort(), "published dates stay sorted ascending");
});

test("resolveDates falls back to the generated list when nothing is published", () => {
  const gen = upcomingDates(CONFIG);
  const today = dateKey(new Date());
  assert.deepEqual(resolveDates(gen, [], today), gen);
  assert.deepEqual(resolveDates(gen, null, today), gen);
  assert.deepEqual(resolveDates(gen, [{ date: "2020-01-01", slots_left: 0 }], today), gen);
});

test("daySpecs flags sold-out days and leaves open days plain", () => {
  const specs = daySpecs(dates, Object.fromEntries(agg.map((r) => [r.date, r.slots_left])));
  assert.deepEqual(specs.map((s) => s.soldOut), [true, false, false]);
  assert.deepEqual(specs.map((s) => appDateKey(s.date)), dates.map(appDateKey));
});

// The calendar as rendered, pulled apart for the two tests below. `cells` drops
// the seven weekday headings, so it starts at the padding before the 1st.
function calendar() {
  const cal = registry["dates"].children[0];
  const grid = cal.children.find((c) => c.className === "cal-grid");
  return {
    cal,
    head: cal.children.find((c) => c.className === "cal-head"),
    cells: grid.children.filter((c) => !c.className.includes("cal-dow")),
    chosen: cal.children.find((c) => c.className === "cal-chosen"),
    notes: cal.children.filter((c) => c.className === "cal-note"),
  };
}

// The cell holding day N of the September 2026 grid — the 1st is a Tuesday, so
// two null padding cells sit in front of it.
function cell(day) {
  const c = calendar().cells[2 + (day - 1)];
  assert.ok(c, `the grid holds a cell for ${day} Sep`);
  return c;
}

test("live availability renders: full day struck out, first open day chosen, per-product stamps", async () => {
  // Let the availability fetches' promise chains settle so the calendar + menu re-render.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const c = calendar();
  assert.equal(c.head.children.length, 3, "an arrow, the month title, an arrow");
  assert.equal(c.head.children[1].children[0].text, "September 2026");
  assert.equal(c.cells.length, 35, "September 2026 pads out to five whole weeks");
  assert.ok(c.cells[0].className.includes("blank") && c.cells[1].className.includes("blank"),
    "the grid opens with the two days before the 1st left empty");
  assert.equal(c.cells[2].children[0].children[0].text, "1", "…then the 1st sits in the Tuesday column");

  // Wed 2 Sep is full: not a button, plainly struck through, and not offered.
  const d2 = cell(2);
  assert.equal(d2.tagName, "SPAN", "a full day is not tappable");
  assert.ok(d2.className.includes("full") && !d2.className.includes("avail"));
  assert.ok(!d2._listeners.click, "and carries no click handler");
  assert.equal(d2.children[0].children[0].text, "2", "the number is still drawn");

  // Fri 4 Sep is the first day with room, so the customer is given it.
  const d4 = cell(4);
  assert.equal(d4.tagName, "BUTTON", "an open delivery day is tappable");
  assert.ok(d4.className.includes("avail") && d4.className.includes("sel"));
  assert.equal(d4.children[0].children[0].text, "4");

  // Mon 7 Sep is open too, but not the chosen one.
  const d7 = cell(7);
  assert.equal(d7.tagName, "BUTTON");
  assert.ok(d7.className.includes("avail") && !d7.className.includes("sel"));

  // One line under the grid names the day they are getting, and one names the
  // full day in this month rather than leaving them to spot the strikethrough.
  assert.equal(c.chosen.children[0].text, `Your posting day: ${fmtDay(dates[1])}`);
  assert.equal(c.notes.length, 1);
  assert.equal(c.notes[0].children[0].text, "Sold out: 2 Sep");

  // Menu reflects the selected day (dates[1]): Chicken Jerky 2 left, Duck Jerky sold out.
  const cards = registry["menu"].children;
  assert.equal(cards.length, 2);

  const f = cards[0];
  const fStamp = f.children[0].children[1];
  assert.ok(fStamp.className.includes("prod-stamp") && !fStamp.className.includes("soldout"));
  assert.equal(fStamp.children[0].text, "Only 2 left");

  const s = cards[1];
  const sStamp = s.children[0].children[1];
  assert.ok(sStamp.className.includes("prod-stamp") && sStamp.className.includes("soldout"));
  assert.equal(sStamp.children[0].text, "Sold out");
  assert.equal(s.children[1].children[2].disabled, true, "sold-out product's + button is disabled");

  // Stepper caps at the remaining count: Chicken Jerky has 2 left.
  const fStep = f.children[1];
  const fQty = fStep.children[1];
  const fDec = fStep.children[0];
  const fInc = fStep.children[2];
  fInc._listeners.click[0]();
  fInc._listeners.click[0]();
  fInc._listeners.click[0]();
  fInc._listeners.click[0]();
  assert.equal(fQty.textContent, "2", "+ stops at the 2 left");
  fDec._listeners.click[0]();
  assert.equal(fQty.textContent, "1", "− still works");
});

test("tapping another open day moves the marker and swaps the product stamps", () => {
  cell(7)._listeners.click[0]();

  const c = calendar();
  assert.ok(cell(7).className.includes("sel"), "the tapped day is now the chosen one");
  assert.ok(cell(4).className.includes("avail") && !cell(4).className.includes("sel"), "the previous day is released");
  assert.equal(c.chosen.children[0].text, `Your posting day: ${fmtDay(dates[2])}`);

  const cards = registry["menu"].children;
  assert.equal(cards[0].children[0].children[1].children[0].text, "Only 9 left");
  const sStamp = cards[1].children[0].children[1];
  assert.ok(sStamp.className.includes("prod-stamp") && !sStamp.className.includes("soldout"));
  assert.equal(sStamp.children[0].text, "Only 12 left");
});
