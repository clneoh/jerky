// test/order-line-note.test.js — v236: the note a customer attaches to ONE item
// ("no nuts", "write Happy Birthday"), and the same box in the baker's own app.
//
// The shop side is driven in store.test.js. This file drives HER side: the note
// box in the New-order card and in the Edit pop-up, and the one thing that can go
// wrong silently there — `applyPopupEdits` copies its shared fields onto EVERY row
// of an order group with Object.assign (`admin/js/views/orders.js`), and a line's
// note riding along in that object would give all three items the same words. That
// is the trap this file exists for; it is the reason a group test sits next to the
// single-item ones rather than instead of them.
//
// Both forms are module-private, so this drives them through renderOrders and the
// pop-up layer, exactly as order-address-suggest.test.js does.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    // Faithful on purpose, the same rule order-address-suggest.test.js carries: the
    // real `append` and `replaceChildren` have NO null filter and convert every
    // argument with String(), so a bare `?: null` left in a list prints the literal
    // word "null". A forgiving shim would hide exactly that on this feature, whose
    // whole job is a box that is sometimes absent.
    append(...cs) { for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) }); },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) });
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
};
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

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

// ── the app ────────────────────────────────────────────────────────────────

function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    // No `askNote` anywhere: her own app must offer the box regardless of what the
    // shop asks, which is half of what this file proves.
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    orders: [
      { id: "o1", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-01",
        productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "012-345 6789" },
    ],
    ingredients: [],
    occasions: [],
    settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM" },
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));
const type = (box, text) => {
  box.value = text;
  (box._listeners.input || []).forEach((f) => f.call(box));
};

// Found by its own placeholder, never by walking order: the form carries several
// inputs, and a helper that took the first one would measure the note box in one
// test and the address in the next (the parcel tick's lesson, products-editor).
const NOTE_PH = "Note for this item (optional) — e.g. no nuts";
const noteBoxes = (root) => all(root).filter(
  (n) => n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === NOTE_PH);

// The New-order card stands on a day that is still open: on the day of delivery
// itself today's cutoff has passed, and Place Order answers with the backfill
// confirmation instead of committing — a real path, but not the one under test.
function openNewCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  return root;
}
function openEdit(st, orderId) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  const row = all(root).find((n) => n.dataset && n.dataset.order === orderId);
  tap(buttonByText(row, "Edit"));
  return root;
}
// Picking the product is what makes the note box appear — a note with no item to
// belong to has nowhere to go.
const pickProduct = (root, value = "p1") => {
  const sel = all(root).find((n) => n.tagName === "SELECT"
    && n.children.some((o) => o.value === value));
  sel.value = value;
  (sel._listeners.change || []).forEach((f) => f.call(sel));
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── the New-order card ─────────────────────────────────────────────────────

test("the New-order card offers a note on the line she is adding, and saves it on that line", () => {
  const st = state();
  const root = openNewCard(st);
  assert.equal(noteBoxes(root).length, 0, "no product picked yet, so no line to note");

  pickProduct(root);
  assert.equal(noteBoxes(root).length, 1, "picking a product gives that line its note box");
  assert.equal(noteBoxes(root)[0].value, "", "and it opens empty, not carrying anything over");

  type(noteBoxes(root)[0], "  no nuts  ");
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal(added.lineNote, "no nuts", "trimmed, and carried on the one line that was added");
});

test("a manual order with no note writes NO key at all — the row is byte-for-byte what it was", () => {
  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal(has(added, "lineNote"), false,
    "absent is how this app spells no note — an empty string would be a change to sync around");
});

test("she can note a line for a product whose shop switch is off", () => {
  // The switch decides what the CUSTOMER is asked and nothing else. If it gated her
  // own box, a phone order saying "no nuts" would have nowhere to be written down —
  // the same shape as the rule that no website setting may block a sale she takes
  // by hand. The product above carries no `askNote` at all.
  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  assert.equal(noteBoxes(root).length, 1,
    "the box is offered whatever the product's shop switch says");
  type(noteBoxes(root)[0], "write Happy Birthday");
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.equal(added.lineNote, "write Happy Birthday");
  assert.equal(has(st.products[0], "askNote"), false, "and nothing was written onto the product");
});

// ── the Edit pop-up ────────────────────────────────────────────────────────

test("the Edit pop-up opens on the line's own note, and Save writes the change back", () => {
  const st = state();
  st.orders[0].lineNote = "no nuts";
  openEdit(st, "o1");
  const pop = layers["popup-layer"];

  assert.equal(noteBoxes(pop).length, 1, "the pop-up carries one box for its one line");
  assert.equal(noteBoxes(pop)[0].value, "no nuts", "opened on what the row already holds");

  type(noteBoxes(pop)[0], "no nuts, extra rosemary");
  tap(buttonByText(pop, "Save changes"));
  assert.equal(st.orders.find((o) => o.id === "o1").lineNote, "no nuts, extra rosemary");
});

test("a note belongs to its LINE: saving a two-item order never gives both items the same words", () => {
  // THE trap. `applyPopupEdits` copies its shared fields onto every row of the group
  // with Object.assign — and a line's note riding in that object would be smeared
  // onto both rows here, silently, with no error and no other test to catch it.
  const st = state();
  st.orders = [
    { id: "o1", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 1, customerName: "Aunty Bee" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 3, customerName: "Aunty Bee",
      lineNote: "no nuts" },
  ];
  openEdit(st, "o1");
  const pop = layers["popup-layer"];

  const boxes = noteBoxes(pop);
  assert.equal(boxes.length, 2, "one box per line of the group");
  assert.equal(boxes[0].value, "", "the first line has no note, and its box says so");
  assert.equal(boxes[1].value, "no nuts", "the second line opens on its own words");
  assert.notEqual(boxes[0], boxes[1], "two separate boxes, not the same node drawn twice");

  type(boxes[1], "no nuts, please");
  tap(buttonByText(pop, "Save changes"));
  assert.equal(st.orders.find((o) => o.id === "o2").lineNote, "no nuts, please");
  assert.equal(has(st.orders.find((o) => o.id === "o1"), "lineNote"), false,
    "the line that never had a note must not have gained the other line's words");
});

test("emptying the box takes the key back off that row, and only that row", () => {
  const st = state();
  st.orders = [
    { id: "o1", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 1, customerName: "Aunty Bee",
      lineNote: "no nuts" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 3, customerName: "Aunty Bee",
      lineNote: "extra rosemary" },
  ];
  openEdit(st, "o1");
  const pop = layers["popup-layer"];

  type(noteBoxes(pop)[0], "   "); // cleared, and whitespace is not words
  tap(buttonByText(pop, "Save changes"));
  assert.equal(has(st.orders.find((o) => o.id === "o1"), "lineNote"), false,
    "the key is deleted, not set to an empty string");
  assert.equal(st.orders.find((o) => o.id === "o2").lineNote, "extra rosemary",
    "and the other line keeps its own note untouched");
});

test("a line swapped to a different product keeps the note she typed against it", () => {
  // The note is about what the CUSTOMER asked for on that line, not about the product
  // record — so changing which product fills the line must not quietly drop it.
  const st = state();
  st.products.push({ id: "p2", name: "Brownie", price: 9, active: true, recipe: [], unit: "pc" });
  st.orders[0].lineNote = "no nuts";
  openEdit(st, "o1");
  const pop = layers["popup-layer"];

  const sel = all(pop).find((n) => n.tagName === "SELECT"
    && n.children.some((o) => o.value === "p2"));
  sel.value = "p2";
  (sel._listeners.change || []).forEach((f) => f.call(sel));

  assert.equal(noteBoxes(pop)[0].value, "no nuts",
    "the words survive the rebuild a product swap causes");
  tap(buttonByText(pop, "Save changes"));
  const o = st.orders.find((x) => x.id === "o1");
  assert.equal(o.productId, "p2");
  assert.equal(o.lineNote, "no nuts");
});
