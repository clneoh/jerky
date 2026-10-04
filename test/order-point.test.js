// test/order-point.test.js — v303: an order SHE TAKES can collect at a Self collection Point.
//
// Her words, mid-build: "how about + new order, and add edit order?" — and she had found the
// other half of a real gap. The shop has offered customers a Point since v299, and the run
// carries one since v301/v302. But her OWN ＋ New order and Edit cards offered only **Self
// collect** and **Courier delivery**, with no way to say WHERE. So an order taken over the
// phone could never be a Point order at all: not on the run, not in the Point's fee, and the
// customer was never told where to go. She takes a great many orders by hand, so this is the
// path that matters most.
//
// The two rules that can go wrong silently are here, not inferred:
//
//   1. THE NAME IS FROZEN ONTO THE ORDER. A Point she renames or deletes must leave every
//      order that already went there still saying where it went — the same rule that keeps a
//      sold price and an old product's name on an order (orderPointName reads it first).
//   2. THE KITCHEN IS THE ABSENCE OF A POINT, and choosing it must CLEAR both fields. An
//      order left carrying `pointId: ""` is an order pointing at a Point that exists and has
//      no name, and every reader downstream would have to know to treat that as nothing.
//
// "Now" is frozen at Thu 10 Sep 2026, as in order-line-note.test.js, whose shim this copies.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
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

const POINT = {
  id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik, 11500 Air Itam",
  receiver: "Aunty Lim", phone: "60123456789", feeRM: 0.5, paused: false,
  createdAt: "2026-08-12T00:00:00.000Z",
  place: { lat: 5.4, lng: 100.28, label: "Farlim, Air Itam" },
};

function state(extra = {}) {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    orders: [
      { id: "o1", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-01",
        productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "012-345 6789" },
    ],
    points: [POINT],
    ingredients: [],
    occasions: [],
    settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM" },
    ...extra,
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));
const setSel = (sel, value) => {
  sel.value = value;
  (sel._listeners.change || []).forEach((f) => f.call(sel));
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// What the picker SHOWS. In a browser `select.value` follows the selected option; this shim
// does not derive it, so the option wearing `selected` is the honest read — and it is also the
// thing she is actually looking at.
const selectedValue = (sel) => {
  const opt = (sel.children || []).find((c) => c.selected === true);
  return opt ? opt.value : "";
};
// `hidden` arrives as an attribute from el() and as a property once the code flips it.
const isHidden = (n) => (n.hidden === undefined ? n.attrs.hidden === "true" : n.hidden === true);

// A field found by the LABEL she reads, never by position — the form carries several.
function fieldByLabel(root, text) {
  return all(root).find((n) => String(n.className || "").split(/\s+/).includes("field")
    && n.children[0] && n.children[0].tagName === "LABEL"
    && n.children[0].textContent === text);
}
const collectSel = (root) => {
  const f = fieldByLabel(root, "Collect from");
  assert.ok(f, "the card offers a Collect from field");
  return f.children[1];
};
const fulfillmentSel = (root) => all(root).find((n) => n.tagName === "SELECT"
  && n.children.some((o) => o.value === "courier"));

function openNewCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  // The New-order draft lives at MODULE scope and outlives a render, so a test that
  // follows one which left it on Courier or on a Point has to say what it wants.
  setSel(fulfillmentSel(root), "collect");
  return root;
}
// The pop-up is drawn into the layer, not into the screen's own root — so this returns the
// LAYER, which is where its fields and its Save button live.
function openEdit(st, orderId) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  const row = all(root).find((n) => n.dataset && n.dataset.order === orderId);
  tap(buttonByText(row, "Edit"));
  return layers["popup-layer"];
}
const pickProduct = (root, value = "p1") => {
  const sel = all(root).find((n) => n.tagName === "SELECT" && n.children.some((o) => o.value === value));
  setSel(sel, value);
};
const newest = (st) => st.orders[st.orders.length - 1];

// ── the ＋ New order card ──────────────────────────────────────────────────

test("an order she takes by hand can collect at a Point, and says which (v303)", () => {
  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  setSel(collectSel(root), "pt_farlim");
  tap(buttonByText(root, "Place Order"));

  const o = newest(st);
  assert.equal(o.pointId, "pt_farlim", "the order carries which Point it collects from");
  assert.equal(o.pointName, "Farlim, Air Itam", "and the name it had when she took it, frozen on");
  assert.equal(o.fulfillment, "collect", "a Point is a collection — the Self collect choice is untouched");
});

test("the kitchen is the default, and an order left there carries no Point at all", () => {
  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const o = newest(st);
  assert.equal(has(o, "pointId"), false,
    "absent is how this app spells her own kitchen — an empty id would be a Point with no name");
  assert.equal(has(o, "pointName"), false);
});

test("the picker offers her kitchen first, then her open Points (v303)", () => {
  // The same list, in the same order, as the shop shows a customer — so the two screens
  // cannot offer different places.
  const st = state({ points: [POINT, { ...POINT, id: "pt_prai", name: "Chai Leng Park, Prai" }] });
  const root = openNewCard(st);
  const sel = collectSel(root);
  assert.deepEqual(sel.children.map((o) => [o.value, o.children[0].text]),
    [["", "My kitchen"], ["pt_farlim", "Farlim, Air Itam"], ["pt_prai", "Chai Leng Park, Prai"]]);
});

test("with no Point open the picker is not offered at all (v303)", () => {
  // A picker whose only entry is her own kitchen is a control that does nothing, which this
  // app treats as a bug — so it is absent rather than disabled.
  const st = state({ points: [] });
  const root = openNewCard(st);
  assert.equal(isHidden(fieldByLabel(root, "Collect from")), true);
});

test("a paused Point is not offered, and a courier order is not collected anywhere (v303)", () => {
  const paused = state({ points: [{ ...POINT, paused: true }] });
  assert.equal(isHidden(fieldByLabel(openNewCard(paused), "Collect from")), true,
    "a paused Point is not OFFERED — the shop's own rule, and the same list");

  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  setSel(collectSel(root), "pt_farlim");
  assert.equal(isHidden(fieldByLabel(root, "Collect from")), false, "offered while it is a collection");
  setSel(fulfillmentSel(root), "courier");
  assert.equal(isHidden(fieldByLabel(root, "Collect from")), true,
    "the moment it is a courier order, there is nowhere to collect from");
  tap(buttonByText(root, "Place Order"));
  assert.equal(has(newest(st), "pointId"), false,
    "and the Point does not ride along behind a choice she has moved away from");
});

// ── the Edit card ──────────────────────────────────────────────────────────

test("Edit can move an existing order to a Point, and back to the kitchen (v303)", () => {
  const st = state();
  let pop = openEdit(st, "o1");
  assert.equal(isHidden(fieldByLabel(pop, "Collect from")), false, "the pop-up offers it too");
  setSel(collectSel(pop), "pt_farlim");
  tap(buttonByText(pop, "Save changes"));
  assert.equal(st.orders[0].pointId, "pt_farlim", "the order now collects at Farlim");
  assert.equal(st.orders[0].pointName, "Farlim, Air Itam");

  pop = openEdit(st, "o1");
  setSel(collectSel(pop), "");
  tap(buttonByText(pop, "Save changes"));
  assert.equal(has(st.orders[0], "pointId"), false, "moving it back to her kitchen CLEARS the id");
  assert.equal(has(st.orders[0], "pointName"), false, "and the frozen name with it");
});

test("every row of an order group collects at the same point (v303)", () => {
  // A group is one customer's order. A point living on one row would go with that row if she
  // later edits or re-splits the order — the same trap the courier charge and the parcel each
  // document.
  const st = state();
  // One group: grouped by `groupId`, not by id — two rows without one are two customers.
  st.orders[0].groupId = "g1";
  st.orders.push({ ...st.orders[0], id: "o2", productId: "p1", qty: 1 });
  const pop = openEdit(st, "o1");
  setSel(collectSel(pop), "pt_farlim");
  tap(buttonByText(pop, "Save changes"));
  for (const o of st.orders) {
    assert.equal(o.pointId, "pt_farlim", `row ${o.id} knows where it is collecting`);
    assert.equal(o.pointName, "Farlim, Air Itam");
  }
});

// ── ★ the name is FROZEN ───────────────────────────────────────────────────

test("renaming or deleting the Point never rewrites where an order already went (v303)", async () => {
  const { orderPointName, updatePoint, deletePoint } = await import("../admin/js/points.js");
  const { fulfillmentText } = await import("../admin/js/points.js");

  const st = state();
  const root = openNewCard(st);
  pickProduct(root);
  setSel(collectSel(root), "pt_farlim");
  tap(buttonByText(root, "Place Order"));
  const o = newest(st);

  // She renames the Point — the order keeps the name it was taken under.
  updatePoint(st, "pt_farlim", { name: "Farlim — Aunty Lim's shop", address: "Lebuhraya Thean Teik",
    receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5 });
  assert.equal(orderPointName(st, o), "Farlim, Air Itam", "a rename does not rewrite the order");

  // And she ends the Point altogether — the order still says where it went, which is why
  // deleting one is safe.
  deletePoint(st, "pt_farlim");
  assert.equal(orderPointName(st, o), "Farlim, Air Itam", "deleting the Point leaves the order readable");
  assert.equal(fulfillmentText(st, o), "Collect (local) at Farlim, Air Itam",
    "so the customer is still told where to collect, in the words they were promised");
});

test("a Point she has since renamed is read LIVE on the order she is working on (v303)", async () => {
  // The opposite of the rule above, and both are wanted: what a customer was PROMISED is
  // frozen, and what the screen SHOWS her while she works reads the live name — the same split
  // v299 made for the address.
  const { updatePoint } = await import("../admin/js/points.js");
  const st = state();
  const root = openEdit(st, "o1");
  setSel(collectSel(root), "pt_farlim");
  tap(buttonByText(root, "Save changes"));
  updatePoint(st, "pt_farlim", { name: "Farlim — Aunty Lim's shop", address: "Lebuhraya Thean Teik",
    receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5 });

  const after = openEdit(st, "o1");
  assert.equal(selectedValue(collectSel(after)), "pt_farlim", "the pop-up still opens on the Point");
  const options = collectSel(after).children.map((o) => o.children[0].text);
  assert.ok(options.includes("Farlim — Aunty Lim's shop"), "listed under the name it has NOW");
});
