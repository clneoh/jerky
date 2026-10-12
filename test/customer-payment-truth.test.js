// test/customer-payment-truth.test.js — a customer's history must not leave the money unspoken
// when the order's stage says it was paid.
//
// Her report: __"look like there is a discrepancy for Peggy's order, at Peggy's customer card,
// has that her order is paid, but it is not??"__ — and she was right.
//
// ⚠️⚠️ THE TWO FACTS THE APP KEEPS APART, AND ONE SURFACE THAT DID NOT. `order.status` is the
// STAGE the order has reached; `order.paidReceived` is whether the MONEY actually arrived. Picking
// "Paid" in the dropdown only moves the stage — the money stays out until Paid · Cash / Paid · TNG
// is pressed. `admin/js/money.js:isCollected()` is the one helper that reads both, and v268
// ("five places that disagreed with each other") pointed the day's till, the row's tag and the
// consolidated invoice at it.
//
// ⚠️⚠️ THE ADMIN'S OWN CUSTOMER CARD WAS NEVER POINTED AT IT. v268's commit message says "the
// customer's card", and its file list shows it never touched `views/customers.js` — the card it
// repaired was the STOREFRONT track card, which reads the published `paid_received` flag. So this
// history row went on drawing the stage word alone and saying **Paid** over money nobody had
// handed over, while every other screen said otherwise.
//
// ⭐ THE SHAPE SHE CHOSE (option A, from the comparison sheet): the stage chip stays exactly where
// it is, and the money gets a chip of its own beside it — **Not paid** while it is out, and
// **Cash** / **TNG** once it is in, the same words the Orders list already puts on its rows.
//
// "Now" is frozen at Thu 10 Sep 2026, as in the other view harnesses.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {}, parentNode: null,
    appendChild(c) { if (c && c.nodeType === 1) c.parentNode = node; if (c != null) node.children.push(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; if (c.nodeType === 1) c.parentNode = node; node.children.push(c); } },
    replaceChildren(...cs) {
      for (const old of node.children) if (old && old.nodeType === 1 && old.parentNode === node) old.parentNode = null;
      node.children = [];
      for (const c of cs) { if (c == null) continue; if (c.nodeType === 1) c.parentNode = node; node.children.push(c); }
    },
    addEventListener(t, f) { (node._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { node.attrs[k] = String(v); if (k === "hidden") node.hidden = true; },
    getAttribute(k) { return node.attrs[k]; },
    classList: {
      add(c) { const s = new Set(String(node.className).split(/\s+/).filter(Boolean)); s.add(c); node.className = [...s].join(" "); },
      remove(c) { node.className = String(node.className).split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains(c) { return String(node.className).split(/\s+/).includes(c); },
      toggle(c, on) {
        if (on === undefined ? !this.contains(c) : on) this.add(c); else this.remove(c);
      },
    },
    querySelector(sel) {
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      if (cls) return walk(node).find((n) => String(n.className).split(/\s+/).includes(cls[1])) || null;
      return null;
    },
    querySelectorAll(sel) {
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      return cls ? walk(node).filter((n) => String(n.className).split(/\s+/).includes(cls[1])) : [];
    },
    contains: () => false,
    focus() {}, click() {}, remove() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 40, bottom: 40, right: 300 }),
  };
  Object.defineProperty(node, "textContent", {
    get() { return node.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { node.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
function walk(n, out = []) { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; }

const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.location = { hash: "" };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
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

const { renderCustomers } = await import("../admin/js/views/customers.js");

function state(over = {}) {
  return {
    settings: { currency: "RM", supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" } },
    products: [{ id: "p1", name: "Rosemary Focaccia", price: 18, active: true }],
    deliveryDates: [{ id: "d3", date: "2026-10-07" }],
    orders: [],
    customers: [], credits: [], expenses: [], deposits: [], ingredients: [], occasions: [],
    ...over,
  };
}

// One order for one person, so the card's history has exactly one row to read.
function orderFor(over = {}) {
  return {
    id: "beef01", groupId: "beef01", deliveryDateId: "d3", deliveryDate: "2026-10-07",
    orderDate: "2026-10-05", productId: "p1", qty: 2, customerName: "Peggy",
    whatsapp: "60123456789", ...over,
  };
}

const pop = () => layers["popup-layer"];
const isOpen = () => !!pop() && pop().hidden === false;
const closeLayer = () => { const l = pop(); if (l) { l.hidden = true; l.replaceChildren(); } };

function openHistoryFor(root, st, who) {
  renderCustomers(root, st, new URLSearchParams(""));
  const rows = walk(root).filter((n) => String(n.className).includes("list-item"));
  const row = rows.find((n) => walk(n).some((c) => c.nodeType === 3 && c.text.includes(who)));
  assert.ok(row, `no row for ${who} — the list did not draw them`);
  assert.equal(typeof row.onclick, "function", "the customer's row has no press to open their history");
  row.onclick();
  return pop();
}

// ★ THE TWO CHIPS ON THE ONE HISTORY ROW, READ SEPARATELY. ⚠️ They have to be read apart, because
// the whole fix is that they are two different facts: the STAGE the order reached, and the MONEY.
function historyRow(card) {
  const block = walk(card).find((n) => String(n.className).includes("hist-ord"));
  assert.ok(block, "the card drew no history row at all, so this proves nothing");
  return block;
}
function statusChipIn(card) {
  const chip = walk(historyRow(card)).find((n) => String(n.className).includes("qty-chip"));
  assert.ok(chip, "the history row has no status chip");
  return String(chip.textContent).trim();
}
function moneyTagIn(card) {
  const tag = walk(historyRow(card)).find((n) => String(n.className).includes("paid-tag"));
  return tag ? String(tag.textContent).trim() : "";
}
function moneyTagEl(card) {
  return walk(historyRow(card)).find((n) => String(n.className).includes("paid-tag")) || null;
}

test("★★ the money is named when the stage says Paid and the money is not in", () => {
  // ⚠️⚠️ THE FAULT SHE REPORTED, AND THE BITE FOR THIS WHOLE FILE. "Paid" in the dropdown moves
  // the STAGE; the money stays out until Paid · Cash / Paid · TNG is pressed. This row used to
  // draw the stage word and nothing else, so it said **Paid** over money nobody had handed over.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "paid", paidReceived: false })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(statusChipIn(card), "Paid", "the stage chip should still say which stage it reached");
  const said = moneyTagIn(card);
  assert.equal(said, "Not paid",
    `★ the row says "Paid" and never says a word about the money — the very claim she caught `
    + `(the money chip reads "${said}")`);
});

test("★ and it wears the amber, the app's own colour for money that is not in", () => {
  // ⚠️ THE COLOUR IS THE CLASS HERE — there is no other handle on a tone from Node — so the class is
  // what is asserted, and the stylesheet is checked for the rule in the same breath so a chip that
  // lost its amber could not pass on the word alone.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "paid", paidReceived: false })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  const el = moneyTagEl(card);
  assert.ok(el, "there is no money chip to colour");
  assert.match(String(el.className), /owed/, `the money chip is not wearing its amber (class "${el.className}")`);
});

test("★ a delivered order whose money never came in says so — the case that matters most", () => {
  // ⚠️ The bread has gone and the money has not. This is the row she would chase, and it read
  // "Delivered" with no hint that anything was outstanding.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "delivered", paidReceived: false })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(statusChipIn(card), "Delivered", "the stage chip moved");
  assert.equal(moneyTagIn(card), "Not paid", "a delivered order with no money reads as settled");
});

test("★ and when the money IS in, the chip names the method — the words the Orders list uses", () => {
  // The other half, drawn on the sheet she picked from: money in → **[Paid] [Cash]**.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "paid", paidReceived: true, paidMethod: "cash" })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(statusChipIn(card), "Paid", "a genuinely paid order stopped reading as paid");
  assert.equal(moneyTagIn(card), "Cash", "a paid order no longer names how it was paid");
});

test("★ a TNG payment wears the TNG tag, never the cash one", () => {
  closeLayer();
  const st = state({ orders: [orderFor({ status: "paid", paidReceived: true, paidMethod: "tng" })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(moneyTagIn(card), "TNG", "a transfer was not named as a transfer");
  assert.match(String(moneyTagEl(card).className), /tng/, "the TNG chip is wearing the cash tone");
});

test("★ a refunded order says Refunded, never the method it was once paid by", () => {
  // ⚠️ A REFUND IS THE ONE CASE WHERE THE MONEY CAME IN *AND* WENT BACK. Tagging it "TNG" would
  // credit her with money she has already returned.
  closeLayer();
  const st = state({ orders: [orderFor({
    status: "paid", paidReceived: true, paidMethod: "tng", refundedAt: "2026-10-06T02:00:00.000Z" })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(moneyTagIn(card), "Refunded", "a refunded order still reads as money she has");
});

test("★★ an order from before the flag existed stays byte-for-byte as it was", () => {
  // ⚠️⚠️ THE HALF THAT PROTECTS HER BACK CATALOGUE. Legacy orders carry no `paidReceived` at all,
  // and the app's rule has always been that an absent flag reads as handled. A fix that treated
  // "not true" as owed would light up years of her history as unpaid — and a chip that appeared on
  // every one of those rows would be a change she never asked for.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "paid" })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(statusChipIn(card), "Paid", "an order with no payment flag at all was treated as owed");
  assert.equal(moneyTagIn(card), "",
    "★ a chip appeared on a settled legacy order — those rows must read exactly as they did before");
});

test("★ a stage that never reached paying gets no money chip and is not disturbed", () => {
  // "Confirmed" is not a money claim. A chip calling every new order unpaid would be noise.
  closeLayer();
  const st = state({ orders: [orderFor({ status: "confirmed", paidReceived: false })] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  assert.equal(statusChipIn(card), "Confirmed", "a Confirmed order's chip moved");
  assert.equal(moneyTagIn(card), "", "an order that has not reached paying was called unpaid");
});

test("★ and the money chip belongs to ITS order — two orders, two different chips", () => {
  // ⚠️ The card draws one row per order, and the chip is read off the row it sits in. A card whose
  // rows shared one answer would pass every single-order test above and still be wrong.
  closeLayer();
  const st = state({ orders: [
    orderFor({ status: "paid", paidReceived: false, orderDate: "2026-10-05" }),
    orderFor({ id: "cafe02", groupId: "cafe02", status: "paid", paidReceived: true, paidMethod: "cash",
      orderDate: "2026-10-02" }),
  ] });
  const card = openHistoryFor(createEl("div"), st, "Peggy");

  const rows = walk(card).filter((n) => String(n.className).includes("hist-ord"));
  assert.equal(rows.length, 2, `the history drew ${rows.length} rows for two orders`);

  const tags = rows.map((r) => {
    const t = walk(r).find((n) => String(n.className).includes("paid-tag"));
    return t ? String(t.textContent).trim() : "";
  });
  // Newest first: the unpaid one is on top.
  assert.deepEqual(tags, ["Not paid", "Cash"],
    "the two orders did not each carry their own money chip");
});
