// test/order-stage-whole-order.test.js — changing an order's status must move the WHOLE order,
// not just the lines that happen to be on the day she is looking at.
//
// Her report: __"why a new order already change to confirm yet appear in new order at the top of
// order page?"__
//
// ⚠️⚠️ THE DAY LIST HANDS `setStage` ONLY THE ROWS ON THAT DAY — `orderList` builds
// `state.orders.filter((o) => o.deliveryDateId === dateId)`. So an order whose lines had drifted
// onto two different bake days had **only half of itself moved**: the lines on the day she was
// looking at changed, and the rest stayed New. **The New-orders inbox scans EVERY day**, so it went
// on showing the order she had just handled — under the same order code, because the rows share
// one `groupId` — and a reload was needed before it agreed with her.
//
// ⭐ REPRODUCED LIVE BEFORE THIS WAS WRITTEN: one order, two lines on two days, confirmed on the
// 12th, and the inbox kept showing that order (now reported as the 14th).
//
// ⭐ THE RULE THIS FILE PINS: an order is ONE thing. Its lines move together wherever they sit.
// ⚠️ And the two cases that must NOT change: a single-line order carries no `groupId` at all, and
// an ordinary multi-line order on one day was already right.
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
    appendChild(c) { this._adopt(c); if (c != null) this.children.push(c); this._takeOptionValue(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; this._adopt(c); this.children.push(c); this._takeOptionValue(c); } },
    replaceChildren(...cs) {
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    _adopt(c) { if (c && c.nodeType === 1) c.parentNode = this; },
    // ⚠️ A REAL <select> TAKES THE VALUE OF ITS SELECTED <option>, and nothing in the shim did
    // that: `select()` marks the chosen option with `selected` and never sets the select's own
    // value, so every status dropdown read `""` and the handler that asks for `this.value` was
    // handed nothing. **A shim that cannot express what the view does hides the fault it is meant
    // to catch** — so the shim is fixed here rather than the test worked around.
    _takeOptionValue(c) {
      if (!c || c.nodeType !== 1) return;
      if (String(this.tagName) !== "SELECT" || String(c.tagName) !== "OPTION") return;
      if (c.selected) this.value = c.value;
    },
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

const DAY_A = { id: "dA", date: "2026-09-12" };
const DAY_B = { id: "dB", date: "2026-09-14" };
const GID = "ordg_aa11bb22cc33";

function row(over) {
  return {
    id: "ord_111111111111", groupId: GID, deliveryDateId: DAY_A.id, deliveryDate: DAY_A.date,
    orderDate: "2026-09-10", createdAt: "2026-09-10T09:00:00.000Z", productId: "p1", qty: 1,
    customerName: "Lucy", whatsapp: "60124689299", status: "new", fulfillment: "collect",
    ...over,
  };
}

function state(over = {}) {
  return {
    settings: { cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4], supabase: { url: "" } },
    products: [{ id: "p1", name: "Focaccia", price: 16, active: true, unit: "pc", recipe: [] }],
    deliveryDates: [DAY_A, DAY_B],
    orders: [],
    ingredients: [], occasions: [], customers: [], expenses: [], deposits: [],
    ...over,
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};

// Walk in exactly as she does: the Orders screen on that day, then the row's own status dropdown.
function confirmOnDay(st, dateId, to = "confirmed") {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: dateId }));
  const sel = all(root).find((n) => n.tagName === "SELECT" && n.value === "new");
  assert.ok(sel, "the day drew no row with a New status dropdown, so this proves nothing");
  sel.value = to;
  sel._listeners.change[0]();
  return root;
}

const statusesIn = (st) => (st.orders || []).map((o) => `${o.deliveryDateId}:${o.status}`);

test("★★ confirming an order moves EVERY line of it, even a line on another bake day", () => {
  // ⚠️⚠️ THE FAULT SHE REPORTED. The day list only holds the lines on THAT day, so the other
  // day's line was left at New — and the inbox, which scans every day, kept showing the order
  // she had just confirmed.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`, `${DAY_B.id}:confirmed`],
    "★ a line on another bake day was left behind — that is the order still showing in the New-orders list");
});

test("★★ and the New-orders list clears — the thing she was actually looking at", () => {
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date })] });
  const root = confirmOnDay(st, DAY_A.id);

  // The inbox is drawn on the screen itself; the press repaints it.
  assert.equal(all(root).filter((n) => String(n.className).includes("inbox-item")).length, 0,
    "★ the order is still listed under New orders after being confirmed");
});

test("★ an ordinary order on one day is unchanged — every line still moves together", () => {
  // The case that always worked, pinned so the fix cannot break it.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", qty: 2 })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`, `${DAY_A.id}:confirmed`],
    "a normal two-line order did not move as one");
});

test("★ a single-line order — which carries NO group — is not disturbed", () => {
  // ⚠️ The import gives a one-line storefront order `groupId: null`, so it is only ever its own
  // row. A fix that assumed a group existed would have to invent one here.
  const st = state({ orders: [row({ id: "ord_cccccccccccc", groupId: undefined, qty: 2 })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`], "a lone order did not move");
});

test("★ the status she did NOT touch, on the day she was not looking at, is left alone", () => {
  // ⚠️ The other half of "move the whole order": it must move the ORDER, not sweep up an
  // unrelated order that happens to sit on the same day. Two orders, one touched.
  const other = "ordg_999999999999";
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa" }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date }),
    row({ id: "ord_dddddddddddd", groupId: other, deliveryDateId: DAY_A.id }),
  ] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st),
    [`${DAY_A.id}:confirmed`, `${DAY_B.id}:confirmed`, `${DAY_A.id}:new`],
    "★ the fix moved an order that was never touched");
});
