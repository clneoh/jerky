// test/customer-history-door.test.js — the order number in a customer's HISTORY opens that order.
//
// Her words: __"make the customer history one a door too"__.
//
// ⚠️⚠️ WHY THIS FILE IS THE WHOLE JOB, AND THE CODE CHANGE IS THE SMALL HALF. At v381 the order
// number was made a door on the Receipt register and on the filing page, and **this site was left
// plain ON PURPOSE** — a customer's history is drawn inside a pop-up, this screen had no test
// harness, and a press that cannot be driven to its outcome is a press nobody knows works. So the
// harness comes first and the door second. That is the whole reason this file exists at all.
//
// ⚠️⚠️ AND THIS IS THE ONE DOOR THAT LIVES INSIDE A POP-UP. The other three are on screens of their
// own, where navigating away is clean. Here the Orders screen renders UNDERNEATH while the
// customer's card stays on top of it — so a press that navigated without closing would look like it
// had done nothing at all. `closeThenGo` below is the behaviour, and it is asserted.
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
    // A real DOM detaches what it drops — ui.js's pop-up keeps `scrollTop` across a repaint, and a
    // shim that left dropped children attached would let a stale card answer a later query.
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

// ⚠️ The door navigates through `location.hash` (the idiom history.js documents), so the address has
// to exist for the press to be provable at all.
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

// The pop-up layer has to be ON the page before anything opens one, or a card would sit in mid-air
// and every assertion below would pass over a screen that never drew.
document.body.append(document.getElementById("popup-layer"));

const { renderCustomers } = await import("../admin/js/views/customers.js");
const { orderCode } = await import("../admin/js/state.js");

// ⚠️ HEX IDS ON PURPOSE: `orderCode` strips every character that is not one, so an "o1" would make
// the code the single character "1" and every assertion here would pass while proving nothing.
function state(over = {}) {
  return {
    settings: { currency: "RM", supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" } },
    products: [{ id: "p1", name: "Rosemary Focaccia", price: 18, active: true }],
    deliveryDates: [{ id: "d3", date: "2026-10-07" }],
    orders: [
      { id: "beef01", groupId: "beef01", deliveryDateId: "d3", deliveryDate: "2026-10-07",
        orderDate: "2026-10-05", productId: "p1", qty: 2, customerName: "Siti",
        whatsapp: "60123456789", status: "paid" },
      { id: "cafe02", groupId: "cafe02", deliveryDateId: "d3", deliveryDate: "2026-09-20",
        orderDate: "2026-09-18", productId: "p1", qty: 1, customerName: "Aunty Bee",
        whatsapp: "60999888777", status: "delivered" },
    ],
    customers: [], credits: [], expenses: [], deposits: [], ingredients: [], occasions: [],
    ...over,
  };
}

const pop = () => layers["popup-layer"];
const isOpen = () => !!pop() && pop().hidden === false;
const closeLayer = () => { const l = pop(); if (l) { l.hidden = true; l.replaceChildren(); } };

// Walk to the door exactly as she does: the Customers screen for real, the customer's own row, then
// the code inside the history the card draws. The row's press is a PROPERTY (`row.onclick`), not a
// listener, which is how that screen has always wired it.
function openHistoryFor(root, st, who) {
  renderCustomers(root, st, new URLSearchParams(""));
  const rows = walk(root).filter((n) => String(n.className).includes("list-item"));
  const row = rows.find((n) => walk(n).some((c) => c.nodeType === 3 && c.text.includes(who)));
  assert.ok(row, `no row for ${who} — the list did not draw them`);
  assert.equal(typeof row.onclick, "function", "the customer's row has no press to open their history");
  row.onclick();
  return pop();
}

const doorsIn = (node) => walk(node).filter((n) => n.tagName === "A" && String(n.className).includes("ord-open"));

test("★★ the order number in a customer's history opens that order", () => {
  closeLayer();
  const st = state();
  const root = createEl("div");
  const card = openHistoryFor(root, st, "Siti");
  assert.equal(isOpen(), true, "the customer's card did not open, so this proves nothing");

  const door = doorsIn(card).find((a) => String(a.textContent).includes("BEEF01"));
  assert.ok(door, "the order number in the history is not a door");
  assert.equal(door.attrs.href, `#/orders?order=${orderCode(st.orders[0])}`,
    "the door does not carry that order's address");
});

test("★★⚠️ AND IT CLOSES THE CARD IT IS SITTING IN BEFORE IT GOES", () => {
  // ⚠️⚠️ THE FAULT THIS TEST EXISTS FOR. This is the only one of the four doors that lives inside a
  // pop-up — the others are on screens of their own. A door that navigated without closing would
  // leave the customer's card sitting OVER the Orders screen, so the press would read as having
  // done nothing at all.
  closeLayer();
  const st = state();
  const root = createEl("div");
  const card = openHistoryFor(root, st, "Siti");
  const door = doorsIn(card).find((a) => String(a.textContent).includes("BEEF01"));
  assert.ok(door, "the order number in the history is not a door");

  globalThis.location.hash = "#/customers";
  door._listeners.click[0]({ preventDefault() {} });

  assert.equal(isOpen(), false, "★ the card is still up, so it would cover the order it opened");
  assert.equal(globalThis.location.hash, `#/orders?order=${orderCode(st.orders[0])}`,
    "the press did not go to the order");
});

test("★ each door carries its OWN order — a history of two orders is two different doors", () => {
  closeLayer();
  const st = state();
  // Both orders belong to one person, so their history has two rows and the doors must differ.
  st.orders = st.orders.map((o) => ({ ...o, customerName: "Siti", whatsapp: "60123456789" }));
  const root = createEl("div");
  const card = openHistoryFor(root, st, "Siti");

  const doors = doorsIn(card);
  assert.equal(doors.length, 2, `the history drew ${doors.length} doors for two orders`);
  assert.deepEqual(doors.map((a) => a.attrs.href).sort(),
    st.orders.map((o) => `#/orders?order=${orderCode(o)}`).sort(),
    "a history row links somewhere other than the order it names");
});

test("⚠️ a customer with no orders gets no door and keeps its own honest empty", () => {
  // The other half of the same rule: a door belongs to an ORDER, so a customer who has none has
  // nothing to open — and the two different empties it can show must still not be disturbed.
  //
  // ⚠️ WHAT THIS PROVES, SAID HONESTLY: that the empty state is drawn and nothing else is. It does
  // NOT prove a guard in `historyBlock` suppresses a door, because with no orders there are no
  // history rows to draw one on — the list is empty before the question arises. (A bite proved
  // that too, which is why `historyBlock` no longer HAS such a guard: it was unreachable.)
  closeLayer();
  const st = state({ orders: [], customers: [
    { id: "cus_1", key: "60111111111", name: "Hand Added", whatsapp: "60111111111" }] });
  const root = createEl("div");
  const card = openHistoryFor(root, st, "Hand Added");

  assert.equal(isOpen(), true, "a hand-added customer's card did not open");
  assert.equal(doorsIn(card).length, 0, "a door was drawn for a customer with no orders");
  assert.match(card.textContent, /They have not ordered yet/,
    "the empty state that says they were added by hand is gone");
});
