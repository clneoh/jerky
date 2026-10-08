// test/order-deeplink.test.js — pressing an order number anywhere in the app opens THAT
// order (v381).
//
// Her words: __"can make the order number clickable to bring us to the order so i can
// admen it, or look at it detail"__.
//
// ⚠️ WHY THIS FILE EXISTS AT ALL. The receipt register deliberately had NO press on its rows
// for three versions, and the reason is written at the top of that view: a control that
// landed on the Orders screen *without opening that order* would not do what it says, and
// this app treats that as a bug everywhere else. So the feature is only worth having if the
// link really opens the order — which is what these tests are for, and why they drive the
// screen for real rather than asserting that a string was built.
//
// ⚠️⚠️ THE SHIM ANSWERS `querySelector` FOR THE TWO SELECTORS THE REVEAL USES, on purpose. A
// shim returning null would let `revealOrderRow` return early and every assertion here would
// pass over a screen that never lit a row — the exact kind of vacuous test that has shipped
// twice in this project. "Now" is frozen at Thu 10 Sep 2026.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {}, _scrolled: null,
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    // ⚠️ REAL CLASS TRACKING, not a no-op: the reveal's whole job is to put "hit" on a row,
    // and a shim that swallowed it could not tell a lit row from an unlit one.
    classList: {
      add(c) { const s = new Set(String(node.className).split(/\s+/).filter(Boolean)); s.add(c); node.className = [...s].join(" "); },
      remove(c) { node.className = String(node.className).split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains(c) { return String(node.className).split(/\s+/).includes(c); },
      toggle(c, on) { if (on) this.add(c); else this.remove(c); },
    },
    scrollIntoView(opts) { this._scrolled = opts; },
    // ⚠️ THE REVEAL'S OWN LOOKUPS, answered for real — see the note at the top of this file.
    querySelector(sel) {
      const m = /^\[data-(order|group)="(.+)"\]$/.exec(String(sel));
      if (m) return walk(this).find((n) => n.dataset && n.dataset[m[1]] === m[2]) || null;
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      if (cls) return walk(this).find((n) => String(n.className).split(/\s+/).includes(cls[1])) || null;
      return null;
    },
    querySelectorAll(sel) {
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      return cls ? walk(this).filter((n) => String(n.className).split(/\s+/).includes(cls[1])) : [];
    },
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
function walk(n, out = []) { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; }

const layers = {};
let toastEl = null;
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  // ⚠️ The toast is the one thing a not-found code says with, so it has to be observable —
  // created lazily exactly as ui.js's `toast` creates it.
  querySelector(sel) {
    if (String(sel) !== ".toast") return null;
    if (!toastEl) { toastEl = createEl("div"); toastEl.className = "toast"; this.body.append(toastEl); }
    return toastEl;
  },
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };

// ── a MINI ROUTER, so "the param is consumed" can be proved rather than asserted ──────
// ⚠️ `history.replaceState` really moves the address here, and `route()` re-reads it the way
// app.js's `render()` does on a hashchange. That is what makes the second render below a fair
// test of the reopen bug instead of a restatement of the first one.
let hash = "";
globalThis.location = { get hash() { return hash; }, set hash(v) { hash = v; } };
globalThis.history = {
  replaceState(_s, _t, url) { if (url) hash = String(url); },
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// ⚠️ `defineProperty`, not assignment: this Node gives globalThis a GETTER-ONLY `navigator`,
// and `globalThis.navigator = {...}` throws before a single test runs.
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", clipboard: null }, configurable: true, writable: true,
});

globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 10, 10, 0, 0); } // Thu 10 Sep 2026
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

document.body.append(document.getElementById("popup-layer"));

const { renderOrders } = await import("../admin/js/views/orders.js");
const { orderCode, orderHref } = await import("../admin/js/state.js");

// The address, read back the way app.js's parseHash() reads it.
function route(root, state) {
  const qs = String(hash).split("?")[1] || "";
  return renderOrders(root, state, new URLSearchParams(qs));
}
const go = (href) => { hash = href; };

// A state the Edit card can actually open on: a day, a product with a price, and orders.
// ⚠️ THE IDS ARE HEX ON PURPOSE — `orderCode` strips anything that is not, so an "o1" would
// make every code the single character "1" and every test here would pass while proving
// nothing (the v378 lesson).
function state(over = {}) {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    orders: [
      { id: "a3f9c2", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-01",
        productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "60123456789" },
      { id: "b7d104", deliveryDateId: "d20", deliveryDate: "2026-09-20", orderDate: "2026-09-01",
        productId: "p1", qty: 1, customerName: "Mei Ling", whatsapp: "60123456789" },
    ],
    ingredients: [], occasions: [], customers: [],
    settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM", deliveryDays: [4],
      supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" } },
    ...over,
  };
}

const pop = () => layers["popup-layer"];
const isOpen = () => !!pop() && pop().hidden === false;
const popText = () => (isOpen() ? pop().textContent : "");
// The card's own title carries the order code, which is the one fact `textContent` can read
// back: an input's VALUE is not text, so a customer's name sitting in a field is invisible
// here even though she can read it on the screen.
const popTitle = () => {
  const t = isOpen() ? pop().querySelector(".popup-title") : null;
  return t ? t.textContent : "";
};

// ⚠️⚠️ THE POP-UP LAYER IS MODULE STATE AND OUTLIVES A TEST. `showPopup` sets `layer.hidden =
// false` and never unhides anything by itself, so a test that leaves a card open makes the
// NEXT test's "no card opened" pass or fail for a reason that has nothing to do with it. This
// closes it the way the card's own ✕ does, before every test.
const closeLayer = () => { const l = pop(); if (l) { l.hidden = true; l.replaceChildren(); } };

// ── the address itself ────────────────────────────────────────────────────────────────

test("orderHref builds the address the Orders screen answers", () => {
  assert.equal(orderHref("a3f9c2"), "#/orders?order=A3F9C2", "uppercased, so a typed code still matches");
  assert.equal(orderHref(" a3f9c2 "), "#/orders?order=A3F9C2", "and trimmed");
  assert.equal(orderHref(""), "#/orders?order=", "an empty code is not a crash");
});

// ── the deep link ─────────────────────────────────────────────────────────────────────

test("★★ an order number opens THAT order's own Edit card", () => {
  closeLayer();
  const st = state();
  const code = orderCode(st.orders[1]); // the SECOND order — opening the wrong one must fail
  go(orderHref(code));
  route(createEl("div"), st);

  assert.equal(isOpen(), true, "the card did not open at all");
  assert.match(popTitle(), new RegExp(`#${code}`),
    `the wrong order's card opened — the title says ${JSON.stringify(popTitle())}`);
});

test("★★ the day opens behind the card, and the row is lit", () => {
  closeLayer();
  const st = state();
  go(orderHref(orderCode(st.orders[1])));
  const root = createEl("div");
  route(root, st);

  const row = root.querySelector('[data-order="b7d104"]');
  assert.ok(row, "the order's own row was not drawn — so the wrong day was opened");
  assert.equal(row.classList.contains("hit"), true,
    "the row is not lit, so she cannot see WHICH order the card belongs to");
  assert.ok(row._scrolled && row._scrolled.block === "center", "the row was not brought to the middle of the screen");
});

test("★★⚠️ AND THE PARAM IS CONSUMED — the card does not reopen on the next render", () => {
  // ⚠️⚠️ THE BUG THIS PINS IS THE ONE THAT WOULD RUIN THE FEATURE. app.js re-renders the whole
  // screen on every hashchange, on every cloud answer, and after every save — INCLUDING the
  // Edit card's own Save. Left in the address, she would close the card and it would come
  // straight back, for ever.
  closeLayer();
  const st = state();
  go(orderHref(orderCode(st.orders[1])));
  route(createEl("div"), st);
  assert.equal(isOpen(), true, "first render: the card opened");
  assert.doesNotMatch(String(hash), /order=/, "the order param is still in the address after it was honoured");

  // The rebuild the app really does — she closes the card, and the screen is redrawn from the
  // address the way render() redraws it. ⚠️ The layer is closed by hand first, because that is
  // what her ✕ does; measuring "did it reopen" against a layer nobody ever closed would be
  // measuring nothing.
  closeLayer();
  route(createEl("div"), st);
  assert.equal(isOpen(), false, "the card reopened on a rebuild — it would never close");
});

test("⚠️ a code that is not on this phone SAYS SO rather than landing on nothing", () => {
  // A link kept, or an order removed since. The register offers no press for an order it
  // cannot see, so this is the stale case — and silence here is the control that does not do
  // what it says, which is the whole reason the feature had to be built properly.
  closeLayer();
  const st = state();
  go(orderHref("DEAD01"));
  route(createEl("div"), st);

  assert.equal(isOpen(), false, "a card opened for an order that does not exist");
  assert.ok(toastEl, "nothing was said at all");
  assert.match(toastEl.textContent, /#DEAD01/, "the message does not name the code she asked for");
  assert.match(toastEl.textContent, /not on this phone/);

  // ⚠️⚠️ AND IT IS CONSUMED HERE TOO, WHICH IS THE ONLY PLACE IT MATTERS. On the path where the
  // order IS found, `selectDate` rewrites the address anyway — so the consumption looks redundant.
  // **It is not: on THIS path nothing else rewrites it**, and a code left in the address would
  // toast "not on this phone" again on every rebuild the app does — for ever, on every save.
  assert.doesNotMatch(String(hash), /order=/,
    "a code that was not found stayed in the address, so the warning repeats on every rebuild");
});

test("★ a code is matched to the ORDER, not to a row — every item of a group shares one code", () => {
  // ⚠️ A multi-item order is several rows with one groupId, and `orderCode` reads the
  // groupId — so a code that matched only the FIRST row would open a card missing the rest.
  // ⚠️ COUNTED AS ITEM ROWS, not as occurrences of the word: the product picker lists
  // "Focaccia" once as an option whatever the order holds, so a text match would pass over a
  // card with one line in it.
  closeLayer();
  const st = state();
  st.orders = [
    { id: "a3f9c2", groupId: "beef01", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "60123456789" },
    { id: "c0ffee", groupId: "beef01", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 1, customerName: "Aunty Bee", whatsapp: "60123456789" },
  ];
  go(orderHref(orderCode(st.orders[0])));
  route(createEl("div"), st);

  assert.equal(isOpen(), true);
  assert.equal(pop().querySelectorAll(".add-item").length, 2,
    "the card does not hold one line per item — a multi-item order was opened as a single row");
});

test("★ an order whose bake day was DELETED still opens its card", () => {
  // ⚠️ THE SAME DOOR v332 OPENED, and it must not be lost here: a code pointing at an order
  // with no day has nowhere to jump to, and refusing to open would leave the one thing she
  // most wants to fix — an orphan — the one thing she cannot reach.
  closeLayer();
  const st = state();
  st.deliveryDates = [{ id: "d20", date: "2026-09-20" }]; // d10 is gone
  const code = orderCode(st.orders[0]);
  go(orderHref(code));
  route(createEl("div"), st);

  assert.equal(isOpen(), true, "an orphaned order could not be opened from its code");
  assert.match(popTitle(), new RegExp(`#${code}`), "the wrong order's card opened for an orphan");
});

test("⚠️ no order param at all leaves the screen exactly as it was", () => {
  // The plain case must not be disturbed by any of this: opening Orders by hand shows a day.
  closeLayer();
  const st = state();
  go("#/orders?date=d20");
  const root = createEl("div");
  route(root, st);

  assert.equal(isOpen(), false, "a card opened on a screen nobody asked to open one on");
  assert.match(root.textContent, /Focaccia/, "the day was not drawn");
});
