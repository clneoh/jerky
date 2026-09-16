// test/orders-view.test.js — the shape of the Orders screen's ＋ New order card
// (admin/js/views/orders.js): it arrives folded, and when it is opened it reads
// the day calendar first, then the customer, then the items.
//
// The screens it lives on sit behind the sign-in, so this is the closest anyone
// gets to tapping it here: the card is built for real and then walked.
//
// "Now" is frozen at Thu 10 Sep 2026, as in orders-cal.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  // textContent is a real DOM property, not a string sitting beside the children:
  // the caret is written with `caret.textContent = "▾"`, and it has to read back
  // as what was written, and as the child it was built with before that.
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) {
      this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }];
    },
  });
  return node;
}
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
// selectDate writes the current date into the URL without firing the router.
globalThis.history = { replaceState() {} };

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");

const STATE = {
  deliveryDates: [
    { id: "d7", date: "2026-09-07" },
    { id: "d10", date: "2026-09-10" },
  ],
  products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" }],
  orders: [],
  ingredients: [],
  occasions: [],
  settings: { cutoff: "18:00", defaultCapacity: 12 },
};
const PARAMS = () => new URLSearchParams({ date: "d7" });

// Every node under a root, so the card can be found wherever it has been placed.
function all(node, out = []) {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
}
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
// el() puts a boolean attribute through setAttribute, while the code later flips
// `hidden` as a DOM property (which drops the attribute in a browser) — so both
// have to be read.
const isHidden = (n) => (n.hidden === undefined ? n.attrs.hidden === "true" : n.hidden === true);
const labelOf = (n) => {
  const l = all(n).find((c) => c.tagName === "LABEL");
  return l && l.children[0].text;
};

function build() {
  const root = createEl("div");
  const teardown = renderOrders(root, STATE, PARAMS());
  return { root, teardown };
}

test("renderOrders hands the router a teardown for the cards it opened", () => {
  const { teardown } = build();
  assert.equal(typeof teardown, "function", "so a later tap cannot reach a card that has gone");
  teardown();
});

test("the ＋ New order card arrives folded", () => {
  const { root } = build();
  const body = byClass(root, "fold-body");
  assert.ok(body, "the card has a body to fold away");
  assert.equal(isHidden(body), true, "and starts with it shut");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▸",
    "the caret points at what is hidden");
});

test("its title opens and shuts it, and the caret follows", () => {
  const { root } = build();
  const head = byClass(root, "fold-head");
  assert.equal(head.tagName, "BUTTON", "the title is the control");

  head._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), false, "a tap opens it");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▾", "and the caret turns over");

  head._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), true, "a second tap shuts it again");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▸");
});

test("opened, it reads the day calendar first, then the customer, then the items", () => {
  const { root } = build();
  const body = byClass(root, "fold-body");
  const dayIdx = body.children.findIndex((n) => labelOf(n) === "Delivery day");
  const customerIdx = body.children.findIndex((n) => labelOf(n) === "Customer");
  const itemsIdx = body.children.findIndex((n) => labelOf(n) === "Items");
  const addIdx = body.children.findIndex((n) => String(n.className).includes("block"));

  assert.equal(dayIdx, 0, "which day she is adding to comes first");
  assert.equal(body.children[0].children[1].className, "cal-wrap",
    "and under it is the month calendar, the same one the shop shows");
  assert.ok(customerIdx > dayIdx, "who the order is for comes after the day");
  assert.ok(itemsIdx > customerIdx, "and what they want comes after that");
  assert.ok(addIdx > itemsIdx, "with Add order last");
});

test("a rebuild around an open card leaves it open, and a fresh visit folds it", () => {
  const { root } = build();
  byClass(root, "fold-head")._listeners.click[0]();

  // Tapping a day in the calendar at the top rebuilds the day area underneath —
  // including the card — with no fresh visit to the screen.
  const dayCell = all(byClass(root, "cal-wrap"))
    .find((n) => n.tagName === "BUTTON" && String(n.className).includes("cal-cell"));
  assert.ok(dayCell, "the screen's own calendar offers a day to open");
  dayCell._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), false, "the open card comes back open");

  // Coming back to the screen later starts folded again.
  renderOrders(root, STATE, PARAMS());
  assert.equal(isHidden(byClass(root, "fold-body")), true);
});

// ── v97/v98: the last stage, and the courier's tracking number ───────────────
test("the last stage wears one label — Collected / Posted — on every order", () => {
  const order = (extra) => ({
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", ...extra,
  });
  const labelsFor = (extra) => {
    const root = createEl("div");
    renderOrders(root, { ...STATE, orders: [order(extra)] }, PARAMS());
    return all(root).filter((n) => String(n.className) === "oj-label").map((n) => n.children[0].text);
  };

  // v97 named this stage per order (Collected here, Shipped there). She asked for
  // the pair itself instead, so both endings read the same label (v98).
  assert.equal(labelsFor({ fulfillment: "courier" })[5], "Collected / Posted",
    "a posted order");
  assert.equal(labelsFor({ fulfillment: "collect" })[5], "Collected / Posted",
    "one the customer fetches");

  // The dropdown and the filter offer the same word, so nothing says Delivered.
  const root = createEl("div");
  renderOrders(root, { ...STATE, orders: [order({ fulfillment: "courier" })] }, PARAMS());
  const opts = all(root).filter((n) => n.tagName === "OPTION").map((n) => n.children[0].text);
  assert.ok(opts.includes("Collected / Posted"), "the status list offers the pair");
  assert.ok(!opts.includes("Delivered"), "and nothing still offers Delivered");
  assert.ok(!opts.includes("Shipped"), "nor a bare Shipped on its own");
});

test("every order offers Note / tracking beside Edit, and the message for how it leaves", () => {
  const root = createEl("div");
  renderOrders(root, { ...STATE, orders: [{
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", fulfillment: "courier", trackingNo: "JT123",
  }] }, PARAMS());
  const labels = all(root).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.ok(labels.includes("Note / tracking"),
    "the two fields she reaches for most have their own way in, without the whole Edit form");
  assert.ok(labels.includes("Edit"), "Edit stays for everything else");
  assert.ok(labels.includes("Send posted message"), "and the message that carries the number");

  const collect = createEl("div");
  renderOrders(collect, { ...STATE, orders: [{
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", fulfillment: "collect",
  }] }, PARAMS());
  const collectLabels = all(collect).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.ok(collectLabels.includes("Note / tracking"), "the same button on a self-collect order");
  assert.ok(collectLabels.includes("Send pickup reminder"), "which keeps the pickup reminder instead");
});
