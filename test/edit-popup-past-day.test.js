// test/edit-popup-past-day.test.js — a past bake day must be pickable in the Edit pop-up, the
// same way it already is on the Orders screen's own calendar.
//
// Her question: __"when i edit an order should it allow me to select the past date,?"__
//
// ⚠️⚠️ IT DID NOT. `deliveryDayOptions` — the list the Edit pop-up's "Bake day" calendar was handed —
// dropped every day BEFORE TODAY except the one the order already sat on. So a past bake day came
// out as a dead grey square, identical to a day she never bakes, and an order taken by hand on
// Friday could only be entered against a FUTURE day: Friday's takings went nowhere and the order's
// stock came off the wrong bake.
//
// ⚠️⚠️ AND IT CONTRADICTED THE APP'S OWN WORDS IN TWO PLACES. The calendar's own comment says a day
// already gone still opens — __"she backfills and reviews old days"__ — and every OTHER calendar in
// the app (the Orders screen's `topCal` and the New order card's) has always been handed the whole
// list. This one picker alone filtered, and it is the one she answered with a question.
//
// ⭐ THE RULE THIS FILE PINS, NOT THE MECHANISM: **a bake day she has set behaves the same in the
// Edit pop-up as it does everywhere else** — past or future. And a day she does NOT bake stays a
// plain grey square, so the fix cannot be "make everything pressable".
//
// "Now" is frozen at Thu 10 Sep 2026, as in the other Orders harnesses.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this._adopt(c); if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; this._adopt(c); this.children.push(c); } },
    replaceChildren(...cs) {
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    _adopt(c) { if (c && c.nodeType === 1) c.parentNode = this; },
    get isConnected() {
      for (let n = this; n; n = n.parentNode) if (n === doc.body) return true;
      return false;
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
const layers = {};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.document = doc;
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", clipboard: null }, configurable: true, writable: true,
});
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" });

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 10, 10, 0, 0); } // Thu 10 Sep 2026
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

doc.body.append(doc.getElementById("popup-layer"));

const { renderOrders } = await import("../admin/js/views/orders.js");

// ⚠️ THE PAST DAY IS INSIDE THE WINDOW THE CALENDAR SHOWS. `rollingWeeks` opens on the Sunday of
// today's week MINUS one, so a day three days back is on the grid while a day from last month would
// fall off it — and a test whose subject is off-screen proves nothing either way.
const PAST = "2026-09-07";   // Mon — three days before the frozen today
const ORDER_DAY = "2026-09-16"; // Wed — the day the order is on
const NO_BAKE = "2026-09-08";   // Tue — a day she does NOT bake

function makeState() {
  return {
    deliveryDates: [{ id: "dPast", date: PAST }, { id: "dOrder", date: ORDER_DAY }],
    products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" }],
    orders: [{
      id: "o1", groupId: "o1", deliveryDateId: "dOrder", deliveryDate: ORDER_DAY,
      productId: "p1", qty: 2, price: 22, customerName: "Peggy", whatsapp: "60123456789",
      fulfillment: "collect", orderDate: "2026-09-08", status: "confirmed",
    }],
    ingredients: [], occasions: [], customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4],
      supabase: { url: "" },
      storefront: { name: "Jienluv2bake", whatsapp: "016 960 1268" },
    },
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const press = (btn) => btn._listeners.click[0]();

// Every drawn calendar cell, by the date it stands for.
function cellsIn(popup) {
  const out = new Map();
  for (const n of all(popup)) {
    if (!String(n.className).includes("cal-cell")) continue;
    const d = n.dataset && n.dataset.date;
    if (d && !out.has(d)) out.set(d, n);
  }
  return out;
}

// Walk to the calendar exactly as she does: the Orders screen for real, the row's own Edit button,
// then the grid inside the pop-up that comes up.
function openEdit(state) {
  const root = createEl("div");
  renderOrders(root, state, new URLSearchParams({ date: "dOrder" }));
  const edit = buttonByText(root, "Edit");
  assert.ok(edit, "the row drew no Edit button, so the pop-up never opened");
  press(edit);
  return layers["popup-layer"];
}

test("★★ a past bake day is pickable in the Edit pop-up, exactly as it is on the Orders screen", () => {
  const popup = openEdit(makeState());
  const cells = cellsIn(popup);
  assert.ok(cells.size > 0, "the Edit pop-up drew no calendar at all, so this proves nothing");

  const past = cells.get(PAST);
  assert.ok(past, `the calendar did not draw ${PAST} — it is inside the window it shows`);
  assert.match(String(past.className), /deliv/,
    `★ the past bake day came out as a plain grey square — the same as a day she never bakes — so an `
    + `order taken by hand last week cannot be put on it (class "${past.className}")`);
  assert.equal(past.tagName, "BUTTON", "the past bake day is drawn but cannot be pressed");
});

test("★ and a day she does not bake is still just a grey square", () => {
  // ⚠️ The other half. The fix must hand the picker every day SHE HAS SET — not every day of the
  // year. A calendar that made all 35 cells pressable would pass the test above and be useless.
  const popup = openEdit(makeState());
  const cells = cellsIn(popup);

  const idle = cells.get(NO_BAKE);
  assert.ok(idle, `the calendar did not draw ${NO_BAKE}`);
  assert.match(String(idle.className), /off/,
    `a day with no bake day on it is not drawn as one (class "${idle.className}")`);
  assert.notEqual(idle.tagName, "BUTTON",
    "★ a day she does not bake became pressable — the fix went too far");
});

test("★ and the day the order is already on keeps its place", () => {
  // The one thing the old filter existed for: an order left on a day of its own must still show
  // where it is. Handing the picker the whole list keeps that, and this pins it.
  const popup = openEdit(makeState());
  const cells = cellsIn(popup);

  const own = cells.get(ORDER_DAY);
  assert.ok(own, `the calendar did not draw the order's own day ${ORDER_DAY}`);
  assert.match(String(own.className), /deliv/, "the order's own bake day is not drawn as a bake day");
});

test("★★ and picking a past day still WARNS her — she is told, and she may still do it", () => {
  // ⚠️ The other half of "allow it". A picker that showed a past day and said nothing would let her
  // move an order onto a bake that has already happened with no word at all — the app's own note,
  // "That bake day is already past.", is what keeps this a choice rather than an accident.
  const popup = openEdit(makeState());
  const cell = cellsIn(popup).get(PAST);
  assert.ok(cell && cell.tagName === "BUTTON", "the past day is not pressable, so there is nothing to warn about");
  press(cell);

  const notes = all(popup)
    .filter((n) => String(n.className).includes("card-sub"))
    .map((n) => String(n.textContent).trim())
    .filter((t) => /past/i.test(t));
  assert.equal(notes.length, 1,
    `★ picking a day that has gone said nothing — she could move an order onto a past bake day `
    + `with no word at all (the notes drawn were ${JSON.stringify(notes)})`);
  assert.match(notes[0], /already past/, "the warning is not the app's own wording");
});
