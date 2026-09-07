// test/label.test.js — packing-label content model. packingLabelData returns a
// flat {style, rows} model ([kind, text] pairs) that the label popup renders and
// that is exactly what prints, so asserting on rows = asserting on the printed
// sheet. Rows keep the order they print in and omit blanks.

import { test } from "node:test";
import assert from "node:assert/strict";

// DOM shim (ui.js's el() etc. touch document only when called). Same header as
// orders.test.js so this file can later render label sheets too.
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
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };

import { packingLabelData } from "../admin/js/views/orders.js";
import { orderCode } from "../admin/js/state.js";
import { shortDate } from "../admin/js/dates.js";

const D1 = "2026-09-04";
const brand = "Munchies Furkidz";
const dateLine = shortDate(D1);

const products = [
  { id: "p1", name: "Focaccia" },
  { id: "p2", name: "Sourdough Loaf" },
];

function makeState(overrides = {}) {
  return {
    settings: { storefront: { name: brand } },
    deliveryDates: [{ id: "d1", date: D1 }],
    products,
    ...overrides,
  };
}

function group(...orders) {
  return { orders };
}

const singleOrder = (extra = {}) => ({
  id: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
  customerName: "Ain", fulfillment: "collect", ...extra,
});

test("full label: brand, date+method, code, customer and one item per line", () => {
  const data = packingLabelData(makeState(), group(singleOrder()), "full");
  assert.deepEqual(data, {
    style: "full",
    rows: [
      ["brand", brand],
      ["meta", `${dateLine} · Collect (local)`],
      ["code", "#3BA44E"],
      ["customer", "Ain"],
      ["item", "Focaccia ×2"],
    ],
  });
});

test("multi-item storefront group: one shared code, every item on its own line", () => {
  const orders = [
    { id: "o_11111111", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00" },
    { id: "o_22222222", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p2", qty: 3,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00" },
  ];
  const data = packingLabelData(makeState(), group(...orders), "full");
  const code = `#${orderCode(orders[0])}`;
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["meta", `${dateLine} · Collect (local)`],
    ["code", code],
    ["customer", "Maya"],
    ["item", "Focaccia ×2"],
    ["item", "Sourdough Loaf ×3"],
  ]);
});

test("courier orders print the address, collect orders never do", () => {
  const courier = packingLabelData(
    makeState(), group(singleOrder({ fulfillment: "courier", address: "12 Jalan Bunga" })), "full");
  assert.deepEqual(courier.rows.slice(-1), [["address", "Post to: 12 Jalan Bunga"]]);

  const collect = packingLabelData(
    makeState(), group(singleOrder({ fulfillment: "collect", address: "12 Jalan Bunga" })), "full");
  assert.ok(!collect.rows.some(([k]) => k === "address"), "a collect order hides its (stale) address");
});

test("the note prints in full only when the order has one", () => {
  const withNote = packingLabelData(
    makeState(), group(singleOrder({ note: "no onions" })), "full");
  assert.ok(withNote.rows.some(([k, t]) => k === "note" && t === "Note: no onions"));

  const clean = packingLabelData(makeState(), group(singleOrder()), "full");
  assert.ok(!clean.rows.some(([k]) => k === "note"));
});

test("compact: items on one line, note dropped, courier address kept", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ fulfillment: "courier", address: "12 Jalan Bunga", note: "no onions" })), "compact");
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["code", "#3BA44E"],
    ["customer", "Ain"],
    ["items", "Focaccia ×2"],
    ["address", "12 Jalan Bunga"],
  ]);
});

test("name-only: just brand, code and customer — no items, note or address", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ fulfillment: "courier", address: "12 Jalan Bunga", note: "no onions" })), "name");
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["code", "#3BA44E"],
    ["customer", "Ain"],
  ]);
});

test("a nameless order still prints its date so the sheet is never blank", () => {
  const data = packingLabelData(makeState(), group(singleOrder({ customerName: "" })), "name");
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["code", "#3BA44E"],
    ["date", dateLine],
  ]);
});

test("a product that was deleted prints as (deleted product)", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ productId: "gone" })), "full");
  assert.ok(data.rows.some(([k, t]) => k === "item" && t === "(deleted product) ×2"));
});

test("brand falls back to the business name when none was published", () => {
  const state = makeState({ settings: { storefront: { name: "" } } });
  const data = packingLabelData(state, group(singleOrder()), "full");
  assert.equal(data.rows[0][1], brand);
});

test("mailing: FROM from the settings box, TO the customer, ORDER the parcel", () => {
  const state = makeState({
    settings: {
      storefront: { name: brand },
      mailingAddress: "Munchies Furkidz\n12, Jalan Bunga Raya\n11600 Pulau Pinang\n016 960 1268",
    },
  });
  const data = packingLabelData(state, group(singleOrder({
    fulfillment: "courier", whatsapp: "60123456789",
    address: "88 Jalan Merdeka\n10400 George Town",
    note: "ring before delivery",
  })), "mailing");
  assert.deepEqual(data, {
    style: "mailing",
    rows: [
      ["mail-sec", "FROM"],
      ["mail-line", "Munchies Furkidz"],
      ["mail-line", "12, Jalan Bunga Raya"],
      ["mail-line", "11600 Pulau Pinang"],
      ["mail-line", "016 960 1268"],
      ["mail-sec", "TO"],
      ["mail-name", "Ain"],
      ["mail-line", "60123456789"],
      ["mail-line", "88 Jalan Merdeka"],
      ["mail-line", "10400 George Town"],
      ["mail-sec", "ORDER"],
      ["mail-line", `#3BA44E · Post ${dateLine}`],
      ["mail-line", "Focaccia ×2"],
      ["mail-line", "Note: ring before delivery"],
    ],
  });
});

test("mailing without a business address prints a reminder instead of a blank FROM", () => {
  const data = packingLabelData(makeState(), group(singleOrder({
    fulfillment: "courier", whatsapp: "60123456789", address: "88 Jalan Merdeka",
  })), "mailing");
  assert.equal(data.style, "mailing");
  assert.equal(data.rows[0][1], "FROM");
  assert.ok(data.rows.some(([k, t]) => k === "mail-line" && t.includes("Settings")));
});

test("an unknown style behaves like full", () => {
  const data = packingLabelData(makeState(), group(singleOrder()), "garbage");
  assert.equal(data.style, "full");
  assert.ok(data.rows.some(([k]) => k === "item"));
});
