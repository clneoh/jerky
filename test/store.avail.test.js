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
// all three delivery days (Wed/Fri/Mon) render as pills.
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

const { pillSpecs, fmtDay, resolveDates, dateKey: appDateKey } = await import("../store/app.js");

test("resolveDates uses the published dates, including one outside the weekday pattern", () => {
  const today = new Date();
  const thu = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (((4 - today.getDay()) + 7) % 7 || 7));
  const thuKey = dateKey(thu);
  const gen = upcomingDates(CONFIG);
  assert.ok(!gen.some((d) => dateKey(d) === thuKey), "precondition: Thursday is not in the generated Mon/Wed/Fri list");

  const rows = gen.concat([thu]).map((d) => ({ date: dateKey(d), slots_left: 5 }));
  const out = resolveDates(gen, rows, dateKey(today));
  assert.equal(out.length, 4);
  assert.ok(out.some((d) => appDateKey(d) === thuKey), "the added Thursday shows up as a pill date");
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

test("pillSpecs flags sold-out days and leaves open days plain", () => {
  const specs = pillSpecs(dates, Object.fromEntries(agg.map((r) => [r.date, r.slots_left])));
  assert.equal(specs[0].soldOut, true);
  assert.equal(specs[0].avail, "Sold out");
  assert.equal(specs[0].label, `${fmtDay(dates[0])} Sold out`);
  assert.equal(specs[1].soldOut, false);
  assert.equal(specs[1].label, fmtDay(dates[1]));
  assert.equal(specs[2].soldOut, false);
  assert.equal(specs[2].label, fmtDay(dates[2]));
});

test("live availability renders: sold-out pill greyed, first open selected, per-product stamps", async () => {
  // Let the availability fetches' promise chains settle so pills + menu re-render.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const pills = registry["dates"].children;
  assert.equal(pills.length, 3);

  const p0 = pills[0];
  assert.ok(p0.className.includes("soldout"), "sold-out pill is greyed");
  assert.ok(!p0.className.includes("active"), "sold-out pill is not selected");
  assert.equal(p0.attrs.disabled, "true", "sold-out pill is disabled");
  assert.equal(p0.children.length, 2, "sold-out pill = date line + red badge line");
  assert.equal(p0.children[0].children[0].text, fmtDay(dates[0]), "the date is still readable, never covered");
  assert.equal(p0.children[1].children[0].text, "Sold out", "clear Sold out badge sits under the date");

  const p1 = pills[1];
  assert.ok(p1.className.includes("active"), "first open day is auto-selected");
  assert.ok(!p1.attrs.disabled, "open pill stays clickable");
  assert.equal(p1.children.length, 2, "open pill keeps the reserved line so all pills match in height");
  assert.equal(p1.children[0].children[0].text, fmtDay(dates[1]));
  assert.equal(p1.children[1].children[0].text, "", "no badge on an open day");

  const p2 = pills[2];
  assert.ok(!p2.className.includes("soldout") && !p2.className.includes("active"));
  assert.equal(p2.children[0].children[0].text, fmtDay(dates[2]));

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

  // Stepper caps at the remaining count: Focaccia has 2 left.
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

test("selecting another open day swaps the product stamps", async () => {
  const p2 = registry["dates"].children[2];
  p2._listeners.click[0]({ currentTarget: p2 });

  const cards = registry["menu"].children;
  assert.equal(cards[0].children[0].children[1].children[0].text, "Only 9 left");
  const sStamp = cards[1].children[0].children[1];
  assert.ok(sStamp.className.includes("prod-stamp") && !sStamp.className.includes("soldout"));
  assert.equal(sStamp.children[0].text, "Only 12 left");
});
