// test/line-note-underline.test.js — v244: the customer's own words for one item
// ("no nuts") are UNDERLINED wherever an item line is drawn — the order row and
// the printed label sheet — so a note cannot be lost in the grey beside a busy
// line or skimmed past on a sheet.
//
// The underline is a way of DRAWING the line, never a change to it: the text still
// comes from orderLineText, which is the one place the row, the sheet and the
// search spell an item. So the load-bearing assertion in this file is not "there is
// an underline" but "the line still reads exactly as it is spelled" — if the two
// ever disagree, the row the baker reads and the words the search matches differ.
//
// Both surfaces are module-private inside orders.js, so they are driven through
// renderOrders and the pop-up layer, exactly as order-line-note.test.js does.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    // Faithful on purpose: the real `append` and `replaceChildren` have NO null
    // filter and convert every argument with String(), so a bare `?: null` left in a
    // list prints the literal word "null". This feature draws a line out of SEVERAL
    // pieces (a head, sometimes a span), which is exactly where such a slip hides.
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
globalThis.window = { open() {}, addEventListener() {}, removeEventListener() {} };
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

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));

function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
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

const rowOf = (root, id) => all(root).find((n) => n.dataset && n.dataset.order === id);
const lineOf = (row) => all(row).find((n) => String(n.className || "") === "li-sub");
// The row draws SEVERAL sub-lines (the items, the placed line, the customer line),
// so the one carrying the order's own note is found by what it says, not by being
// the first .li-sub on the row.
const subWith = (row, text) => all(row).find((n) =>
  String(n.className || "") === "li-sub" && String(n.textContent).includes(text));
// Every drawn underline under a node. Exact class match, so "line-note" can never
// be satisfied by some longer class that merely starts the same way.
const underlines = (node) => all(node).filter((n) => String(n.className || "") === "line-note");

// ── the order row ──────────────────────────────────────────────────────────

test("the row underlines the customer's own words, and the line still reads exactly as it is spelled", () => {
  const st = state();
  st.orders[0].lineNote = "no nuts";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const line = lineOf(rowOf(root, "o1"));
  const marks = underlines(line);
  assert.equal(marks.length, 1, "exactly one underline on the row");
  assert.equal(marks[0].textContent, " (no nuts)",
    "wrapping the note and its brackets — never the item's own name");
  assert.equal(line.textContent, "Focaccia ×2 (no nuts)",
    "and the line the baker reads is byte-for-byte what orderLineText spells");
});

// ── v245: the order's OWN note, underlined and on every label ──────────────

test("the row underlines the delivery note, and the line it sits on still reads name, number, note", () => {
  // The order's own note was the one piece of the row drawn as plain text beside
  // the underlined item note (v245) — two kinds of customer note, only one of them
  // standing out. It is the same words, so it wears the same underline.
  const st = state();
  st.orders[0].note = "deliver after 3pm";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const sub = subWith(rowOf(root, "o1"), "deliver after 3pm");
  assert.ok(sub, "the customer line is drawn with the order's own note on it");
  const marks = underlines(sub);
  assert.equal(marks.length, 1, "exactly one underline on that line");
  assert.equal(marks[0].textContent, "deliver after 3pm", "wrapping the note itself, not the name");
  assert.equal(sub.textContent, "Aunty Bee · 60123456789 · deliver after 3pm",
    "and the line still reads exactly as it always has, dot-separated");
});

test("a delivery note that is only whitespace draws no underline and no note on the line", () => {
  const st = state();
  st.orders[0].note = "   ";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const row = rowOf(root, "o1");
  const sub = subWith(row, "Aunty Bee");
  assert.equal(underlines(sub).length, 0, "nothing to underline");
  assert.equal(sub.textContent, "Aunty Bee · 60123456789",
    "and no dangling separator where the note would have been");
});

test("the label sheet underlines the delivery note, on the Full label", () => {
  const st = state();
  st.orders[0].note = "collect after 3pm";
  st.orders[0].status = "baking";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  tap(buttonByText(rowOf(root, "o1"), "Print label"));

  const sheet = all(layers["popup-layer"]).find((n) => String(n.className || "").startsWith("label-sheet"));
  const noteRow = all(sheet).find((n) => String(n.className || "") === "ls-note");
  assert.ok(noteRow, "the note line is on a self-collect order's sheet");
  assert.equal(noteRow.textContent, "Note: collect after 3pm", "printed as it always was");
  const marks = underlines(noteRow);
  assert.equal(marks.length, 1, "one underline on the note line");
  assert.equal(marks[0].textContent, "collect after 3pm", "the note's own words, not the Note: label");
});

test("the Compact label carries the note too, underlined, at the same place the Full label puts it (v245)", () => {
  // Compact dropped the note entirely before this — a note about the doorstep
  // vanished the moment the denser label was picked.
  const st = state();
  st.orders[0].note = "gate 2B";
  st.orders[0].status = "baking";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  tap(buttonByText(rowOf(root, "o1"), "Print label"));
  tap(buttonByText(layers["popup-layer"], "Compact"));

  const sheet = all(layers["popup-layer"]).find((n) => String(n.className || "").startsWith("label-sheet"));
  assert.ok(sheet, "the compact sheet is drawn");
  const noteRow = all(sheet).find((n) => String(n.className || "") === "ls-note");
  assert.ok(noteRow, "the note line is on the compact sheet too");
  assert.equal(noteRow.textContent, "Note: gate 2B");
  assert.equal(underlines(noteRow).length, 1, "and it is underlined the same way");
});

test("the Compact label underlines each item's own note, on the one joined line (v245)", () => {
  // Her report: the item's own words were underlined on the Full and Mailing
  // labels and not on Compact. Compact joins every item onto ONE row, so the row
  // had carried the joined text alone and the sheet had no run to wrap — the note
  // printed as ordinary words. One underline per noted item, on the item it
  // belongs to, is the whole fix; the line itself is spelled exactly as before.
  const st = state();
  st.products.push({ id: "p2", name: "Sourdough", price: 12, limit: 50, active: true, recipe: [], unit: "pc" });
  st.orders = [
    { id: "o1", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 2, customerName: "Aunty Bee",
      status: "baking", lineNote: "no nuts" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p2", qty: 1, customerName: "Aunty Bee",
      status: "baking", lineNote: "well baked" },
  ];
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  tap(buttonByText(rowOf(root, "o1"), "Print label"));
  tap(buttonByText(layers["popup-layer"], "Compact"));

  const sheet = all(layers["popup-layer"]).find((n) => String(n.className || "").startsWith("label-sheet"));
  const itemsRow = all(sheet).find((n) => String(n.className || "") === "ls-items");
  assert.ok(itemsRow, "the joined items line is on the compact sheet");
  assert.equal(itemsRow.textContent, "Focaccia ×2 (no nuts) · Sourdough ×1 (well baked)",
    "the line still reads exactly as the items are spelled — joining changed nothing");
  assert.deepEqual(underlines(itemsRow).map((m) => m.textContent), [" (no nuts)", " (well baked)"],
    "one underline per noted item");
  // Text content alone cannot say WHERE an underline sits, so the row's own
  // children are walked: each span must follow the item it belongs to, not both
  // land at the end and not swap places.
  assert.deepEqual(
    itemsRow.children.map((c) => (c.nodeType === 3 ? c.text : `[${c.textContent}]`)),
    ["Focaccia ×2", "[ (no nuts)]", " · Sourdough ×1", "[ (well baked)]"],
    "each underline sits on its own item, where the item's words actually fall");
});

test("two items that happen to share a note each get their own underline (v245)", () => {
  // The trap in one joined line: the same words twice. A sheet that hunts each run
  // from the START of the line would find the first " (no nuts)" twice, underline
  // item one twice and leave item two plain — so the runs are placed from the
  // right, and this is the case that proves it.
  const st = state();
  st.products.push({ id: "p2", name: "Sourdough", price: 12, limit: 50, active: true, recipe: [], unit: "pc" });
  st.orders = [
    { id: "o1", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 2, customerName: "Aunty Bee",
      status: "baking", lineNote: "no nuts" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p2", qty: 1, customerName: "Aunty Bee",
      status: "baking", lineNote: "no nuts" },
  ];
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  tap(buttonByText(rowOf(root, "o1"), "Print label"));
  tap(buttonByText(layers["popup-layer"], "Compact"));

  const sheet = all(layers["popup-layer"]).find((n) => String(n.className || "").startsWith("label-sheet"));
  const itemsRow = all(sheet).find((n) => String(n.className || "") === "ls-items");
  assert.ok(itemsRow, "the joined items line is on the compact sheet");
  assert.equal(itemsRow.textContent, "Focaccia ×2 (no nuts) · Sourdough ×1 (no nuts)");
  assert.deepEqual(
    itemsRow.children.map((c) => (c.nodeType === 3 ? c.text : `[${c.textContent}]`)),
    ["Focaccia ×2", "[ (no nuts)]", " · Sourdough ×1", "[ (no nuts)]"],
    "both items are marked, each on its own copy of the words");
});

test("a row whose items carry no note draws no underline at all", () => {
  const st = state();
  st.orders = [
    { id: "o1", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 1, customerName: "Aunty Bee" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-10",
      orderDate: "2026-09-01", productId: "p1", qty: 3, customerName: "Aunty Bee" },
  ];
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const line = lineOf(rowOf(root, "o1"));
  assert.ok(line && line.textContent.includes("·"), "the two-item line is drawn");
  assert.equal(underlines(line).length, 0, "and there is nothing on it to underline");
});

// ── the printed label sheet ────────────────────────────────────────────────

test("the label sheet underlines the note beside its item, exactly as the row does", () => {
  const st = state();
  st.orders[0].lineNote = "no nuts";
  // Print label is offered at Baked — the moment she has the sheet in hand to kit
  // the order, which is the whole reason the note has to be legible on it.
  st.orders[0].status = "baking";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  tap(buttonByText(rowOf(root, "o1"), "Print label"));

  const pop = layers["popup-layer"];
  const sheet = all(pop).find((n) => String(n.className || "").startsWith("label-sheet"));
  assert.ok(sheet, "the label sheet is drawn in the print pop-up");

  const itemRow = all(sheet).find((n) => String(n.className || "") === "ls-item");
  assert.ok(itemRow, "the item's own line is on the sheet");
  assert.equal(itemRow.textContent, "Focaccia ×2 (no nuts)",
    "the printed line reads exactly as the row does");
  const marks = underlines(itemRow);
  assert.equal(marks.length, 1, "one underline on the sheet, wrapping the note");
  assert.equal(marks[0].textContent, " (no nuts)", "and not the item name");
});
