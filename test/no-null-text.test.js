// test/no-null-text.test.js — no screen may ever draw the word "null".
//
// A conditional child passed straight to a DOM call — replaceChildren(a, cond ?
// b : null, c) — is NOT dropped: the real DOM stringifies it, so the owner sees a
// stray "null" printed on the page. The test shims in this repo are lenient (they
// skip null children, because el() does), which is exactly why the defect survived
// here: the v96 "How the day adds up" grid printed "null" under the total, and the
// Settings screen printed one at the very bottom under Delete all data. Both were
// fixed on 16 Sep 2026; the shim below is strict, so a re-copied file that brings
// the pattern back fails here instead of reaching her phone.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, scrollHeight: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    // append() matches the real DOM too: a string/null argument becomes text.
    append(...cs) {
      for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) });
    },
    // The strict one: this is how the browser behaves — null is not skipped, it is
    // converted to the string "null".
    replaceChildren(...cs) {
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
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
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.window = { open() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.confirm = () => false;
globalThis.prompt = () => null;

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0); // Thu 10 Sep 2026
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");
const { renderSettings } = await import("../admin/js/views/settings.js");

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));

// The literal words that must never reach the page: a null child in the real DOM.
const strays = (node) =>
  all(node).filter((n) => n.nodeType === 3 && /^\s*(null|undefined)\s*$/.test(n.text)).map((n) => n.text);

function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }],
    products: [
      { id: "p1", name: "Chicken Jerky 100g", limit: 12, active: true, recipe: [], unit: "pouch" },
      // Marked Saturdays only, so on this Thursday it is the one NOT counted.
      { id: "p2", name: "Duck Jerky 100g", limit: 8, active: true, recipe: [], unit: "pouch",
        sellRules: [{ days: [6] }] },
    ],
    orders: [{ id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2 }],
    ingredients: [],
    occasions: [],
    customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [1, 3, 5],
      storefront: {}, wishList: [],
    },
  };
}

test("the day's availability pop-up draws no stray null, with a product counted and one off sale", () => {
  const st = state();
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Set day's availability")._listeners.click[0]();

  const pop = layers["popup-layer"];
  assert.deepEqual(strays(pop), [], "no 'null' text node in the pop-up");
  // Both branches must have really rendered — otherwise this test would pass on an
  // empty screen.
  assert.ok(byClass(pop, "cost-sum-title"), "the add-up grid is there");
  assert.match(all(pop).map((n) => n.textContent).join(" "), /Not counted: Duck Jerky 100g/);
});

test("the pop-up with every product counted draws no stray null either", () => {
  const st = state();
  st.products[1].sellRules = []; // now both sell on the Thursday
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Set day's availability")._listeners.click[0]();

  const pop = layers["popup-layer"];
  assert.deepEqual(strays(pop), [], "the optional 'Not counted' line was left out, not printed as null");
  assert.ok(byClass(pop, "cost-total-row"), "the total row is there");
});

test("the Settings screen draws no stray null when the sample-data card is not shown", () => {
  const root = createEl("div");
  renderSettings(root, state());
  assert.deepEqual(strays(root), [], "no 'null' after the Danger zone card");
});
