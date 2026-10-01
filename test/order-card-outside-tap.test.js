// test/order-card-outside-tap.test.js — what folds the ＋ New order card, and what
// must NOT.
//
// The card folds on a press anywhere else on the page (admin/js/views/orders.js,
// installOrderCollapseOutside). That rule is right for a press on the page. It is
// WRONG for a press on a layer ABOVE the page — the confirmation the card itself
// opened, a pop-up, the lock — and that was the fault she hit: the door's
// "Look this address up again" asks before it replaces a door, she tapped "Reset
// the pin" in the confirmation, and the order card she was writing folded out from
// under her while the look-up went on to write the order.
//
// It survived three releases because the layers are stateless in most of this
// suite's shims: getElementById handing back a fresh node each call means the
// rule's own layer test can never see a real overlay. This file gives the layers a
// real home, and checks BOTH halves — a press on the page still folds the card, and
// a press on an overlay does not.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {}, parent: null, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(ev) { ev.target = ev.target || this; (this._listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    // Ancestor-aware, like the browser's: the whole rule rests on this question.
    contains(c) { for (let n = c; n; n = n.parent || null) if (n === this) return true; return false; },
    get isConnected() { for (let n = this; n; n = n.parent || null) if (n === globalThis.document.body) return true; return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }; },
    focus() {}, click() {}, remove() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

const LAYER_IDS = ["confirm-layer", "popup-layer", "lock-layer", "view", "view-title-text", "view-sub", "tabbar"];
const layers = {};
for (const id of LAYER_IDS) layers[id] = createEl("div");
const docListeners = {};

globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => layers[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
  removeEventListener() {},
  dispatchEvent(ev) { ev.target = ev.target || this; (docListeners[ev.type] || []).forEach((f) => f(ev)); return true; },
};
globalThis.window = { open() {}, addEventListener() {} };
globalThis.history = { replaceState() {} };

const { renderOrders } = await import("../admin/js/views/orders.js");
const { confirmDialog } = await import("../admin/js/ui.js");

const STATE = {
  deliveryDates: [{ id: "d10", date: "2026-09-10" }],
  products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" }],
  orders: [], ingredients: [], occasions: [], customers: [],
  settings: { cutoff: "18:00", defaultCapacity: 12 },
};

function all(node, out = []) { for (const c of node.children || []) { out.push(c); all(c, out); } return out; }
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));

// Build the screen and open the card; hand back the card's own panel so a test can
// ask whether it is open. `panel.hidden === false` is the card being open.
function openCard() {
  for (const id of LAYER_IDS) layers[id].replaceChildren();
  layers["confirm-layer"].hidden = true;
  layers["popup-layer"].hidden = true;
  const root = createEl("main");
  document.body.appendChild(root);
  renderOrders(root, STATE, new URLSearchParams({ date: "d10" }));
  byClass(root, "fold-head")._listeners.click[0]();
  const card = all(root).find((n) => String(n.className).split(/\s+/).includes("card")
    && n.children.some((c) => String(c.className).includes("fold-head")));
  return card.children[1];
}

const press = (target) => document.dispatchEvent({ type: "pointerdown", target, clientX: 10, clientY: 10 });

test("a press on the page outside the card still folds it", () => {
  const panel = openCard();
  assert.equal(panel.hidden, false, "the card did not open");
  press(byClass(layers["view"], "nothing") || createEl("p"));
  assert.equal(panel.hidden, true, "a press on the page must still fold the card");
});

test("a press on the confirmation the card opened does NOT fold it", () => {
  const panel = openCard();
  confirmDialog("Resetting replaces the door. Continue?", () => {}, { danger: true, yesLabel: "Reset the pin" });
  const yes = all(layers["confirm-layer"]).find((n) => n.tagName === "BUTTON" && n.textContent === "Reset the pin");
  assert.ok(yes, "the confirmation's own button was not found");
  press(yes);
  assert.equal(panel.hidden, false,
    "tapping the card's own confirmation folded the order card out from under her");
});

test("a press on a pop-up does NOT fold it", () => {
  const panel = openCard();
  const inPopup = createEl("button");
  layers["popup-layer"].hidden = false;
  layers["popup-layer"].replaceChildren(inPopup);
  press(inPopup);
  assert.equal(panel.hidden, false, "a press on a pop-up folded the order card");
});

test("a HIDDEN layer does not shield a press on the page", () => {
  const panel = openCard();
  // The confirm layer is hidden, and the press lands on a node that happens to sit
  // inside it (a stale child). A hidden layer is not on the screen, so the press is
  // a press on the page and the card must fold.
  const stale = createEl("button");
  layers["confirm-layer"].hidden = true;
  layers["confirm-layer"].replaceChildren(stale);
  press(stale);
  assert.equal(panel.hidden, true, "a hidden layer must not swallow a press on the page");
});
