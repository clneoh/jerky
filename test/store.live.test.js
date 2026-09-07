// test/store.live.test.js — the storefront's live auto-refresh: while the page
// is on screen it re-checks availability every 30s (or when the tab regains
// focus) and repaints the date pills + product stamps, WITHOUT touching what the
// customer has already typed or chosen.

import { test } from "node:test";
import assert from "node:assert/strict";

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
const docListeners = {};
const winListeners = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
  visibilityState: "visible",
  body: createEl("body"),
};
globalThis.window = { open() {}, addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); } };

// Freeze "now" so the pill dates are deterministic: Tue 1 Sep 2026, 10:00 AM.
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

// Capture the 30s poll instead of letting it keep the process alive.
let intervalCb = null;
globalThis.setInterval = (fn) => { intervalCb = fn; return 1; };
globalThis.clearInterval = () => {};

const { CONFIG } = await import("../store/config.js");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function upcomingDates(cfg) {
  const out = [];
  const now = new Date();
  for (let i = 1; out.length < cfg.upcomingCount && i < 365; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (cfg.deliveryDays.includes(d.getDay())) out.push(d);
  }
  return out;
}
const dates = upcomingDates(CONFIG);
const k = (d) => dateKey(d);

let dayData = [
  { date: k(dates[0]), slots_left: 0 }, // Wed — sold out
  { date: k(dates[1]), slots_left: 2 }, // Fri — open, auto-selected
  { date: k(dates[2]), slots_left: 5 }, // Mon — open
];
let prodData = []; // per-product counts; tests fill it in when they need one
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  const u = String(url);
  if (u.includes("product_availability")) return { ok: true, json: async () => prodData };
  if (u.includes("storefront_config")) return { ok: true, json: async () => [] };
  return { ok: true, json: async () => dayData };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const { fmtDay } = await import("../store/app.js");

test("live refresh updates sold-out pills but never clears what the customer typed", async () => {
  await settle(); await settle(); await settle(); // boot + first live refresh

  const pills = registry["dates"].children;
  assert.ok(pills[0].className.includes("soldout"), "Wed stays sold out");
  assert.ok(pills[1].className.includes("active") && !pills[1].className.includes("soldout"),
    "Fri is the auto-selected open day");

  // The customer has started filling the order form…
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("note-input").value = "no onions please";
  const before = pills[1];

  // …then Fri sells out while the page is open. The next poll repaints.
  dayData = [
    { date: k(dates[0]), slots_left: 0 },
    { date: k(dates[1]), slots_left: 0 }, // now sold out too
    { date: k(dates[2]), slots_left: 5 },
  ];
  const callsBefore = fetchCalls;
  await intervalCb();
  await settle(); await settle(); await settle();

  const pills2 = registry["dates"].children;
  assert.ok(pills2[1].className.includes("soldout"), "Fri now shows sold out after the refresh");
  assert.ok(pills2[2].className.includes("active") && !pills2[2].className.includes("soldout"),
    "selection moves to Mon, the next open day");
  assert.notEqual(pills2[1], before, "the sold-out pill was repainted");
  assert.ok(fetchCalls > callsBefore, "the poll really did re-check the live data");

  // The form the customer typed into is untouched by any of that.
  assert.equal(document.getElementById("name-input").value, "Aunty Bee");
  assert.equal(document.getElementById("whatsapp-input").value, "60123456789");
  assert.equal(document.getElementById("note-input").value, "no onions please");
});

test("no data change means no repaint — and a hidden tab stops polling", async () => {
  await settle(); await settle(); await settle();

  const pills = registry["dates"].children;
  const before = pills[1];
  const callsBefore = fetchCalls;

  // Identical data on the next poll → nothing rebuilds.
  await intervalCb();
  await settle(); await settle(); await settle();
  assert.equal(registry["dates"].children[1], before, "no DOM churn when nothing changed");

  // Background the tab → the poll no longer fetches.
  document.visibilityState = "hidden";
  const callsHidden = fetchCalls;
  await intervalCb();
  await settle();
  assert.equal(fetchCalls, callsHidden, "no fetch while the tab is hidden");
  document.visibilityState = "visible";
});

test("live storefront still renders on day text for every pill", () => {
  const pills = registry["dates"].children;
  assert.equal(pills[0].children[0].children[0].text, fmtDay(dates[0]));
  assert.equal(pills[1].children[0].children[0].text, fmtDay(dates[1]));
  assert.equal(pills[2].children[0].children[0].text, fmtDay(dates[2]));
});

test("a refresh that depletes an ordered item fixes the cart, bar and tells the customer", async () => {
  // Earlier tests left Fri sold out — restore a clean state: Fri orderable,
  // no per-product counts yet (so the steppers aren't capped).
  dayData = [
    { date: k(dates[0]), slots_left: 0 },
    { date: k(dates[1]), slots_left: 2 },
    { date: k(dates[2]), slots_left: 5 },
  ];
  prodData = [];
  await intervalCb();
  await settle(); await settle(); await settle();
  registry["dates"].children[1]._listeners.click[0](); // select Fri
  assert.ok(registry["dates"].children[1].className.includes("active"), "Fri is the selected day");

  const cards = registry["menu"].children;
  // The shim renders text as a child node (el() sets .text, not .textContent);
  // a click updates .textContent. Read whichever source is populated.
  const labelVal = (labelEl) => (labelEl.textContent !== ""
    ? String(labelEl.textContent)
    : (labelEl.children.find((c) => c && c.nodeType === 3) || {}).text ?? "");
  const qty = (i) => labelVal(cards[i].children[1].children[1]);
  const clickInc = (i) => cards[i].children[1].children[2]._listeners.click[0];
  clickInc(0)(); clickInc(0)();        // Focaccia ×2
  clickInc(1)(); clickInc(1)(); clickInc(1)(); // Sandwich ×3
  assert.equal(qty(0), "2");
  assert.equal(qty(1), "3");
  document.getElementById("name-input").value = "Aunty Bee";

  // Next poll: Focaccia sold out, Sandwich down to 1 — more than she asked for
  // on the first, more than is left on the second.
  prodData = [
    { date: k(dates[1]), product: CONFIG.products[0].name, slots_left: 0 },
    { date: k(dates[1]), product: CONFIG.products[1].name, slots_left: 1 },
  ];
  const callsBefore = fetchCalls;
  await intervalCb();
  await settle(); await settle(); await settle();
  assert.ok(fetchCalls > callsBefore, "the poll re-checked the live data");

  const cards2 = registry["menu"].children;
  assert.equal(labelVal(cards2[0].children[1].children[1]), "0",
    "the sold-out item is removed from the cart");
  assert.equal(labelVal(cards2[1].children[1].children[1]), "1",
    "a quantity above what's left is clamped down");
  assert.equal(document.getElementById("bar-count").textContent, "1 item",
    "the bar reflects the corrected cart");

  const note = document.getElementById("menu-note");
  assert.equal(note.hidden, false, "a notice tells the customer what changed");
  const text = note.children.map((p) => p.children[0].text).join(" · ");
  assert.ok(text.includes(CONFIG.products[0].name) && text.includes("sold out"),
    "notice names the sold-out item");
  assert.ok(text.includes(CONFIG.products[1].name) && text.includes("only 1"),
    "notice explains the clamped quantity");

  assert.equal(document.getElementById("name-input").value, "Aunty Bee",
    "the typed name survives the fixing refresh");
});
