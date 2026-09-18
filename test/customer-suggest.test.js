// test/customer-suggest.test.js — v119: typing a customer's name into an order
// form offers the people she has already served, and a tap fills the name and the
// WhatsApp number in.
//
// Both forms are module-private (orderForm / popupEditBody), so this drives them
// through renderOrders, and the Edit form through the pop-up layer the same way
// orders-day-sum.test.js does. "Now" is frozen at Thu 10 Sep 2026.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
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
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
// A layer registry, so the pop-up held in "popup-layer" can be read back after it
// has been built.
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

// Aunty Bee has ordered twice (so "2 orders" and a favourite), Uncle Tan once.
// Their orders sit on Thu 10 Sep; the New-order card is opened on the later day
// d20 because a delivery date whose 6pm cutoff has passed asks for a backfill
// confirmation before it will add anything.
function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    orders: [
      { id: "o1", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-01",
        productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "012-345 6789" },
      { id: "o2", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-02",
        productId: "p1", qty: 1, customerName: "Aunty Bee", whatsapp: "012-345 6789" },
      { id: "o3", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-03",
        productId: "p1", qty: 1, customerName: "Uncle Tan", whatsapp: "016-222 3333" },
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
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));

const NAME_BOX = "Customer name (optional)";
const WA_BOX = "e.g. 012-345 6789";
const nameBox = (root) => all(root).find((n) => n.tagName === "INPUT" && n.attrs.placeholder === NAME_BOX);
const waBox = (root) => all(root).find((n) => n.tagName === "INPUT" && n.attrs.placeholder === WA_BOX);
// The suggestion panel and the rows currently offered under the name box. The
// row count is the honest reading: `hidden` means different things to different
// shims, but an empty panel means the same thing to all of them.
const panel = (root) => byClass(root, "sugg-panel");
const offered = (root) => (panel(root) ? panel(root).children : []);
// Typing: the handler reads this.value, so it is fired with the box as `this`.
const type = (box, text) => {
  box.value = text;
  (box._listeners.input || []).forEach((f) => f.call(box));
};
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));

function openNewCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  return root;
}

// ── the ＋ New order card ───────────────────────────────────────────────────

test("two letters of a name offer the people she has served, with their number and history", () => {
  const root = openNewCard(state());

  type(nameBox(root), "aun");
  const rows = offered(root);
  assert.equal(rows.length, 1, "one person matches, and only one");
  assert.equal(rows[0].textContent, "Aunty Bee012-345 6789 · 2 orders · usually Focaccia",
    "the name, then the number, how many orders and what they usually buy");
});

test("one letter is not a search, and a name nobody has shows nothing", () => {
  const root = openNewCard(state());

  type(nameBox(root), "a");
  assert.equal(offered(root).length, 0, "one letter would offer half the address book");

  type(nameBox(root), "uncle");
  assert.equal(offered(root).length, 1, "Uncle Tan is there for his own name");
  assert.match(offered(root)[0].textContent, /^Uncle Tan/);

  type(nameBox(root), "zzz");
  assert.equal(offered(root).length, 0, "and a name she has never served offers nothing at all");

  type(nameBox(root), "uncle");
  assert.equal(offered(root).length, 1, "…and the list comes back when the box does");
});

test("the number she has typed before finds them too, however it is spaced", () => {
  const root = openNewCard(state());
  type(nameBox(root), "012-345");
  assert.equal(offered(root).length, 1);
  assert.match(offered(root)[0].textContent, /^Aunty Bee/);

  type(nameBox(root), "6016");
  assert.equal(offered(root).length, 0, "a country code on its own is not a person");
});

test("a tap fills the name and the number — and Add order saves them onto the order", () => {
  const st = state();
  const root = openNewCard(st);

  type(nameBox(root), "aun");
  tap(offered(root)[0]);

  assert.equal(nameBox(root).value, "Aunty Bee", "the name is in the box");
  assert.equal(waBox(root).value, "012-345 6789", "and so is her number, as saved");
  assert.equal(offered(root).length, 0, "the list closes on a pick — the choice is made");

  // Pick the product, then add the order for real.
  const prodSel = all(root).find((n) => n.tagName === "SELECT"
    && n.children.some((o) => o.value === "p1"));
  prodSel.value = "p1";
  (prodSel._listeners.change || []).forEach((f) => f.call(prodSel));
  tap(buttonByText(root, "Add order"));

  const added = st.orders.find((o) => o.id !== "o1" && o.id !== "o2" && o.id !== "o3");
  assert.ok(added, "the order landed");
  assert.equal(added.customerName, "Aunty Bee", "under the name she picked");
  assert.equal(added.whatsapp, "60123456789", "and her number, in the WhatsApp form the app stores");
});

test("a completed add starts the card clean — the next order does not open on the last person", () => {
  const st = state();
  const root = openNewCard(st);

  type(nameBox(root), "aun");
  tap(offered(root)[0]);
  const prodSel = all(root).find((n) => n.tagName === "SELECT"
    && n.children.some((o) => o.value === "p1"));
  prodSel.value = "p1";
  (prodSel._listeners.change || []).forEach((f) => f.call(prodSel));
  tap(buttonByText(root, "Add order"));

  assert.equal(nameBox(root).value, "", "the name box is empty again, not holding the person just served");
  assert.equal(waBox(root).value, "", "and so is the number");
  // The panel's own list is rebuilt with the card, so it must not be sitting open.
  assert.equal(offered(root).length, 0);
});

// ── the Edit pop-up ────────────────────────────────────────────────────────

test("the Edit pop-up offers the same list, and a tap fills its name and number", () => {
  const st = state();
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const row = all(root).find((n) => n.dataset && n.dataset.order === "o1");
  assert.ok(row, "the order row is on screen");
  tap(buttonByText(row, "Edit"));

  const pop = layers["popup-layer"];
  assert.equal(offered(pop).length, 0, "the list is shut until she starts typing");
  assert.equal(all(pop).filter((n) => String(n.className).includes("sugg-panel")).length, 1,
    "but the panel itself is in the pop-up, under the name box");

  type(nameBox(pop), "uncle");
  const rows = offered(pop);
  assert.equal(rows.length, 1);
  tap(rows[0]);

  assert.equal(nameBox(pop).value, "Uncle Tan", "the name fills in");
  assert.equal(waBox(pop).value, "60162223333",
    "and the number, in the WhatsApp form this box already opens on");
});

test("saving the pop-up writes the picked number onto the order it edits", () => {
  const st = state();
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const row = all(root).find((n) => n.dataset && n.dataset.order === "o2");
  tap(buttonByText(row, "Edit"));
  const pop = layers["popup-layer"];

  type(nameBox(pop), "aun");
  tap(offered(pop)[0]);
  tap(buttonByText(pop, "Save changes"));

  assert.equal(st.orders.find((o) => o.id === "o2").whatsapp, "60123456789",
    "her own number is stored in the one WhatsApp form");
});
