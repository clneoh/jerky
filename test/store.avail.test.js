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
  // The REAL document has these. A shim without them is not a smaller DOM, it is a
  // different one: the shop registers a visibilitychange listener at start-up (v292),
  // and a missing method is a TypeError at import — every store test dies at once.
  _docListeners: {},
  addEventListener(t, f) { (this._docListeners[t] ||= []).push(f); },
  removeEventListener() {},
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
const { rollingWeeks } = await import("../store/calendar.js");

// ⚠️ THIS FILE'S MENU IS ITS OWN FIXTURE, AND IT IS DECLARED BEFORE THE PAGE
// RENDERS (v347). Every test here is about PER-PRODUCT availability — two
// products carrying different sold-out stamps on the same day — so it needs two
// products of its own rather than whatever the shop's fallback menu happens to
// hold, which is the owner's to change whenever she likes. ⚠️ The names must match
// the `product` field in prodRows below — that is how the stamps are matched up.
CONFIG.products = [
  { name: "Chicken Jerky", price: 22, unit: "100g pouch" },
  { name: "Duck Jerky", price: 24, unit: "100g pouch" },
];

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

// The calendar as rendered, pulled apart for the test below. `cells` drops the
// seven weekday headings, leaving the window's own dates in reading order.
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

// The picker draws a rolling five-week window that follows today (Tue 1 Sep 2026):
// the week just gone is the first row, this week the second, and every cell is a
// real date — so a day is found by its own place in that window, not by padding in
// front of the 1st.
const WINDOW = rollingWeeks("2026-09-01").flat();
function cell(day) {
  const i = WINDOW.indexOf(`2026-09-${String(day).padStart(2, "0")}`);
  assert.ok(i >= 0, `${day} Sep is inside the window on screen`);
  return calendar().cells[i];
}

// The photo, when a card has one, is the card's own first column, so the words
// and the stepper live one level in. Found by name, and it throws if the body is
// missing rather than quietly reading an empty string.
const bodyOf = (card) => {
  const b = card.children.find((c) => c.className === "card-body");
  assert.ok(b, "the card body");
  return b;
};

test("live availability renders: full day struck out, first open day chosen, per-product stamps", async () => {
  // Let the availability fetches' promise chains settle so the calendar + menu re-render.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const c = calendar();
  // All three dates on sale (2, 4 and 7 Sep) fall inside today's own window, so
  // there is nowhere to page: the slots either side of the title hold nothing rather
  // than a control with nothing to do.
  assert.deepEqual(c.head.children.map((x) => x.className), ["cal-slot", "cal-title", "cal-slot"],
    "the title, with empty slots either side — nowhere earlier or later to go");
  assert.equal(c.head.children[1].children[0].text, "23 Aug – 26 Sep",
    "the title names the window's own two ends, not a month");
  // Five whole weeks, and every cell in them a real date — there is no padding, so
  // nothing is left blank. It opens on the Sunday of the week just gone, which puts
  // today (Tue 1 Sep) in the second row with last week above it.
  assert.equal(c.cells.length, 35, "five whole weeks, every cell a real day");
  assert.equal(c.cells[0].children[0].children[0].text, "23", "the window opens on Sun 23 Aug");
  assert.equal(c.cells[9].children[0].children[0].text, "1", "…and today sits in the second row");

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
  const fStamp = bodyOf(f).children[0].children[1];
  assert.ok(fStamp.className.includes("prod-stamp") && !fStamp.className.includes("soldout"));
  assert.equal(fStamp.children[0].text, "Only 2 left");

  const s = cards[1];
  const sStamp = bodyOf(s).children[0].children[1];
  assert.ok(sStamp.className.includes("prod-stamp") && sStamp.className.includes("soldout"));
  assert.equal(sStamp.children[0].text, "Sold out");
  assert.equal(bodyOf(s).children[1].children[2].disabled, true, "sold-out product's + button is disabled");

  // Stepper caps at the remaining count: Chicken Jerky has 2 left.
  const fStep = bodyOf(f).children[1];
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
  assert.equal(bodyOf(cards[0]).children[0].children[1].children[0].text, "Only 9 left");
  const sStamp = bodyOf(cards[1]).children[0].children[1];
  assert.ok(sStamp.className.includes("prod-stamp") && !sStamp.className.includes("soldout"));
  assert.equal(sStamp.children[0].text, "Only 12 left");
});
