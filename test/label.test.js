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

import { packingLabelData, splitOrderLine, lineNoteSuffix, sheetItemsRow } from "../admin/js/views/orders.js";
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

test("an item's own note prints beside that item, never as the order's note (v236)", () => {
  const orders = [
    { id: "o_11111111", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00",
      lineNote: "no nuts" },
    { id: "o_22222222", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p2", qty: 3,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00" },
  ];
  const data = packingLabelData(makeState(), group(...orders), "full");
  const items = data.rows.filter(([k]) => k === "item").map(([, t]) => t);
  assert.deepEqual(items, ["Focaccia ×2 (no nuts)", "Sourdough Loaf ×3"],
    "the note rides the one item it belongs to and leaves the other exactly as it was");
  assert.ok(!data.rows.some(([k]) => k === "note"),
    "and it never turns into the order's own note row, which is a different thing");
});

test("compact: items on one line, the delivery note kept, courier address kept", () => {
  // The delivery note prints on Compact too (v245). It was the one field this
  // style dropped, on a self-collect order as much as a courier one, so a note
  // about the doorstep disappeared the moment the denser label was picked.
  const data = packingLabelData(makeState(), group(
    singleOrder({ fulfillment: "courier", address: "12 Jalan Bunga", note: "no onions" })), "compact");
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["code", "#3BA44E"],
    ["customer", "Ain"],
    ["items", "Focaccia ×2"],
    ["note", "Note: no onions", "no onions"],
    ["address", "12 Jalan Bunga"],
  ]);
});

test("compact without a note keeps the rows it always had — no empty note line (v245)", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ fulfillment: "courier", address: "12 Jalan Bunga" })), "compact");
  assert.deepEqual(data.rows, [
    ["brand", brand],
    ["code", "#3BA44E"],
    ["customer", "Ain"],
    ["items", "Focaccia ×2"],
    ["address", "12 Jalan Bunga"],
  ]);
});

test("a self-collect compact label carries the note too — the note is not a courier thing (v245)", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ fulfillment: "collect", note: "collect after 3pm" })), "compact");
  assert.deepEqual(data.rows.find(([k]) => k === "note"),
    ["note", "Note: collect after 3pm", "collect after 3pm"],
    "the note's own words are the marked run, so the sheet underlines them");
});

test("a whitespace note prints no note row at all, in every style (v245)", () => {
  for (const style of ["full", "compact", "mailing"]) {
    const data = packingLabelData(makeState(), group(singleOrder({ note: "   " })), style);
    assert.ok(!data.rows.some(([, t]) => String(t).startsWith("Note:")),
      `${style}: whitespace is not a note, so no empty "Note:" line prints`);
  }
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
      ["mail-line", "Note: ring before delivery", "ring before delivery"],
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

// ── v244: the item's own words, underlined on the row and on the sheet ──────

test("splitOrderLine cuts the line at the customer's note and leaves a clean line whole", () => {
  const state = makeState();
  assert.deepEqual(
    splitOrderLine(state, { productId: "p1", qty: 2, lineNote: "no nuts" }),
    { head: "Focaccia ×2", suffix: " (no nuts)" },
    "the head is everything up to the bracket, the suffix is the bracket itself");
  assert.deepEqual(
    splitOrderLine(state, { productId: "p1", qty: 2 }),
    { head: "Focaccia ×2", suffix: "" },
    "no note means no suffix, and the head is the whole line");
  assert.equal(lineNoteSuffix("  no nuts  "), " (no nuts)", "trimmed, and bracketed with a leading space");
  assert.equal(lineNoteSuffix("   "), "", "whitespace alone is not a note — same rule as the box");
});

test("a noted item row carries the marked run, so a sheet can underline it (v244)", () => {
  const state = makeState();
  const withNote = packingLabelData(state, group(
    singleOrder({ productId: "p1", qty: 2, lineNote: "no nuts" })), "full");
  assert.deepEqual(
    withNote.rows.find(([k]) => k === "item"),
    ["item", "Focaccia ×2 (no nuts)", " (no nuts)"],
    "the printed line is unchanged and the run to underline is its own element");

  const clean = packingLabelData(state, group(singleOrder({ productId: "p1", qty: 2 })), "full");
  assert.deepEqual(
    clean.rows.find(([k]) => k === "item"),
    ["item", "Focaccia ×2"],
    "a clean row stays the two-element pair it always was — no empty third slot");

  const mail = packingLabelData(state, group(
    singleOrder({ productId: "p1", qty: 2, lineNote: "no nuts" })), "mailing");
  assert.deepEqual(
    mail.rows.find(([k, , mark]) => k === "mail-line" && mark),
    ["mail-line", "Focaccia ×2 (no nuts)", " (no nuts)"],
    "the mailing sheet's item line carries the same marked run");
});

// ── v245: the order's OWN note — underlined, and on every label ─────────────

test("a compact label marks an item's own note, so the sheet can underline it there too (v245)", () => {
  // Her report: the item's own words were underlined on the Full and Mailing
  // labels and not on Compact. The line had always PRINTED the note — Compact
  // joined the items as plain strings, so there was nothing for the sheet to wrap.
  // The run now travels in the row's third slot, exactly as on the other styles.
  const data = packingLabelData(makeState(), group(
    singleOrder({ productId: "p1", qty: 2, lineNote: "no nuts" })), "compact");
  assert.deepEqual(data.rows.find(([k]) => k === "items"),
    ["items", "Focaccia ×2 (no nuts)", [" (no nuts)"]],
    "the joined line is unchanged and the run to underline rides beside it");
});

test("a compact label marks every noted item, in the order the items print (v245)", () => {
  const orders = [
    { id: "o_11111111", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00",
      lineNote: "no nuts" },
    { id: "o_22222222", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p2", qty: 3,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00",
      lineNote: "well baked" },
  ];
  const data = packingLabelData(makeState(), group(...orders), "compact");
  assert.deepEqual(data.rows.find(([k]) => k === "items"),
    ["items", "Focaccia ×2 (no nuts) · Sourdough Loaf ×3 (well baked)",
      [" (no nuts)", " (well baked)"]],
    "one run per noted item — first item's words first, so the sheet cannot swap them");
});

test("a compact label with one undocumented item marks only the noted one (v245)", () => {
  const orders = [
    { id: "o_11111111", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00" },
    { id: "o_22222222", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p2", qty: 3,
      customerName: "Maya", fulfillment: "collect", createdAt: "2026-09-01T09:00:00",
      lineNote: "well baked" },
  ];
  const data = packingLabelData(makeState(), group(...orders), "compact");
  assert.deepEqual(data.rows.find(([k]) => k === "items"),
    ["items", "Focaccia ×2 · Sourdough Loaf ×3 (well baked)", [" (well baked)"]],
    "the clean item contributes no run, and the noted one still marks the noted item");
});

test("a compact label with no notes at all stays the plain pair it always was (v245)", () => {
  const data = packingLabelData(makeState(), group(
    singleOrder({ productId: "p1", qty: 2 })), "compact");
  assert.deepEqual(data.rows.find(([k]) => k === "items"), ["items", "Focaccia ×2"],
    "no empty third slot — the no-note case must stay byte-identical");
});

test("sheetItemsRow says nothing for no orders, so no label gains an empty items line (v245)", () => {
  assert.equal(sheetItemsRow(makeState(), []), null);
});

test("every marked run is a run of the row's own text — a tail when there is one, in order when there are several", () => {
  // The sheet finds each run INSIDE the text it was given, so a run it cannot find
  // is a run it silently drops, and one it can find twice is a run in the wrong
  // place. A row holding ONE item carries its run as a string and it is the row's
  // TAIL (v244). A Compact row joins every item, so it carries a LIST instead, in
  // printing order, and the text must hold a separate copy of each (v245).
  const orders = [
    { id: "o_11111111", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p1", qty: 2,
      customerName: "Maya", fulfillment: "courier", address: "12 Jalan Bunga",
      createdAt: "2026-09-01T09:00:00", lineNote: "no nuts" },
    { id: "o_22222222", groupId: "o_9f3ba44e", deliveryDateId: "d1", productId: "p2", qty: 3,
      customerName: "Maya", fulfillment: "courier", address: "12 Jalan Bunga",
      createdAt: "2026-09-01T09:00:00", lineNote: "well baked" },
  ];
  for (const style of ["full", "compact", "mailing"]) {
    const data = packingLabelData(makeState(), group(...orders), style);
    for (const [cls, text, mark] of data.rows) {
      const runs = (mark == null ? [] : [].concat(mark)).filter(Boolean);
      if (!runs.length) continue;
      const str = String(text);
      if (typeof mark === "string") {
        assert.ok(str.endsWith(mark), `${style}/${cls}: "${mark}" is the tail of "${str}"`);
      } else {
        assert.ok(runs.length > 1,
          `${style}/${cls}: a row with one run stays a plain string, never a list of one`);
      }
      for (const run of runs) {
        assert.ok(run.length < str.length,
          `${style}/${cls}: "${run}" leaves the line something to print`);
        assert.ok(str.split(run).length - 1 >= runs.filter((r) => r === run).length,
          `${style}/${cls}: "${str}" holds a separate "${run}" for every run the row marked`);
      }
    }
    // The order's OWN note is a different thing. Neither of these orders has one,
    // so a "Note:" line here would mean an item's own words had escaped their item.
    assert.ok(!data.rows.some(([, t]) => String(t).startsWith("Note:")),
      `${style}: an item's own note never becomes the order's Note: line`);
  }
});

test("sheetNoteRow returns null for nothing to say, so no row is pushed", async () => {
  const { sheetNoteRow } = await import("../admin/js/views/orders.js");
  assert.equal(sheetNoteRow(""), null);
  assert.equal(sheetNoteRow("   "), null);
  assert.equal(sheetNoteRow(null), null);
  assert.deepEqual(sheetNoteRow("  ring the bell  "), ["note", "Note: ring the bell", "ring the bell"]);
  assert.deepEqual(sheetNoteRow("ring the bell", "mail-line"),
    ["mail-line", "Note: ring the bell", "ring the bell"]);
});
