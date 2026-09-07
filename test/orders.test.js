// test/orders.test.js — the order-status gate: moving an order to Confirmed
// needs its WhatsApp number, because that is when the confirmation message with
// the payment QR goes out. Later stages advance the physical order even without
// a number (their message/Paid buttons just stay disabled).
// Covers the journey marks (New → Confirmed → Paid → Preparing → Packed →
// Delivered, where Confirmed/Paid only tick green after their button is
// pressed) and the new-orders inbox, including orphaned orders (their delivery
// date was deleted) that can only be removed, not opened.

import { test } from "node:test";
import assert from "node:assert/strict";

// DOM shim so ui.js's el() can build nodes when newOrdersInbox renders.
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

import { statusNeedsWhatsapp, newOrdersInbox, applyGroupPatch, filterOrderGroups, journeyMarks, matchingGroups } from "../admin/js/views/orders.js";

test("only Confirmed needs a WhatsApp number (it gates sending the confirmation)", () => {
  assert.equal(statusNeedsWhatsapp("confirmed"), true);
  assert.equal(statusNeedsWhatsapp("baking"), false);
  assert.equal(statusNeedsWhatsapp("ready"), false);
});

test("new and delivered moves never need a number", () => {
  assert.equal(statusNeedsWhatsapp("new"), false);
  assert.equal(statusNeedsWhatsapp("delivered"), false);
  assert.equal(statusNeedsWhatsapp(""), false);
  assert.equal(statusNeedsWhatsapp(undefined), false);
});

test("journey marks: New is green on arrival, Confirmed is the live step", () => {
  assert.deepEqual(journeyMarks({ status: "new" }),
    ["done", "now", "todo", "todo", "todo", "todo"]);
});

test("journey marks: Confirmed completes only once the confirmation was sent", () => {
  // Legacy orders saved before the flag existed read as already handled.
  assert.deepEqual(journeyMarks({ status: "confirmed" }),
    ["done", "done", "now", "todo", "todo", "todo"], "absent flag = confirmation sent");
  assert.deepEqual(journeyMarks({ status: "confirmed", confirmedSent: true }),
    ["done", "done", "now", "todo", "todo", "todo"]);
  assert.deepEqual(journeyMarks({ status: "confirmed", confirmedSent: false }),
    ["done", "now", "todo", "todo", "todo", "todo"], "selecting Confirmed but not yet sent");
});

test("journey marks: Paid completes only once payment is received", () => {
  assert.deepEqual(journeyMarks({ status: "paid" }),
    ["done", "done", "done", "now", "todo", "todo"], "absent flag = payment received");
  assert.deepEqual(journeyMarks({ status: "paid", paidReceived: true }),
    ["done", "done", "done", "now", "todo", "todo"]);
  assert.deepEqual(journeyMarks({ status: "paid", paidReceived: false }),
    ["done", "done", "now", "todo", "todo", "todo"], "payment received not yet marked");
});

test("journey marks: later stages green on selection, Delivered ends all green", () => {
  assert.deepEqual(journeyMarks({ status: "baking" }),
    ["done", "done", "done", "done", "now", "todo"]);
  assert.deepEqual(journeyMarks({ status: "ready" }),
    ["done", "done", "done", "done", "done", "now"]);
  assert.deepEqual(journeyMarks({ status: "delivered" }),
    ["done", "done", "done", "done", "done", "done"]);
  assert.deepEqual(journeyMarks({}),
    ["done", "now", "todo", "todo", "todo", "todo"], "a missing status reads as New");
});

const inboxState = {
  products: [{ id: "p1", name: "Focaccia", active: true }],
  deliveryDates: [
    { id: "d1", date: "2026-09-04" },
    { id: "d2", date: "2026-09-07" },
  ],
  orders: [
    // Oldest first (by createdAt) — this one is orphaned: its date was deleted.
    { id: "o3", status: "new", groupId: "g3", deliveryDateId: "del_gone", productId: "p1", qty: 3, customerName: "Orphan", createdAt: "2026-09-01T08:00:00", orderDate: "2026-09-01" },
    { id: "o2", status: "new", groupId: "g2", deliveryDateId: "d2", productId: "p1", qty: 1, customerName: "Maya", createdAt: "2026-09-01T09:00:00", orderDate: "2026-09-01" },
    { id: "o1", status: "new", groupId: "g1", deliveryDateId: "d1", productId: "p1", qty: 2, customerName: "Ain", createdAt: "2026-09-01T10:00:00", orderDate: "2026-09-01" },
  ],
};

test("filterOrderGroups matches the group's displayed status, not any single item", () => {
  // A storefront order shows ONE status (its first item's) and that status
  // applies to the whole group. Matching "any item" would make a mixed-status
  // leftover group appear under every filter — e.g. a Delivered order still
  // showing when "New" is selected.
  const mixed = { orders: [{ id: "a", status: "delivered" }, { id: "b", status: "new" }] };
  const all = [mixed, { orders: [{ id: "c", status: "new" }] }, { orders: [{ id: "d", status: "delivered" }] }];

  assert.equal(filterOrderGroups(all, "").length, 3, "no filter shows everything");
  assert.deepEqual(filterOrderGroups(all, "new").map((g) => g.orders[0].id), ["c"], "only the group displayed as New");
  assert.deepEqual(filterOrderGroups(all, "delivered").map((g) => g.orders[0].id), ["a", "d"], "both groups displayed as Delivered");
});

test("applyGroupPatch edits the whole multi-item order (details + per-item qty)", () => {
  const orders = [
    { id: "a", qty: 2, customerName: "Old", whatsapp: "", fulfillment: "collect", address: "", note: "", orderDate: "2026-09-01" },
    { id: "b", qty: 1, customerName: "Old", whatsapp: "", fulfillment: "collect", address: "", note: "", orderDate: "2026-09-01" },
  ];
  const patch = {
    customerName: "Ain",
    whatsapp: "60123456789",
    fulfillment: "courier",
    address: "12 Jalan Bunga",
    note: "No onions",
    orderDate: "2026-09-02",
  };
  applyGroupPatch(orders, patch, (id) => (id === "a" ? 4 : 3));
  assert.deepEqual(orders[0], { id: "a", qty: 4, ...patch });
  assert.deepEqual(orders[1], { id: "b", qty: 3, ...patch });
});

test("newOrdersInbox returns null when there are no new orders", () => {
  const inbox = newOrdersInbox({ orders: [], deliveryDates: [], products: [] }, () => {});
  assert.equal(inbox, null);
});

test("newOrdersInbox lists every new order with a ✕ remove button, orphans included", () => {
  const inbox = newOrdersInbox(inboxState, () => {});
  assert.ok(inbox, "inbox renders when new orders exist");

  const rows = inbox.children[2].children; // .inbox-list
  assert.equal(rows.length, 3, "one row per new order group");

  // Orphaned order: no date to open, so it's a plain row — but still removable.
  const orphanRow = rows[0];
  assert.equal(orphanRow.children[0].tagName, "SPAN", "orphan row is not a link");
  assert.equal(orphanRow.children[0].attrs.href, undefined, "orphan row has no href");
  assert.equal(orphanRow.children[0].children[1].children.length, 1, "no arrow on an orphan row");

  // Normal order: navigates to its delivery date.
  const normalRow = rows[2]; // o1 → d1
  assert.equal(normalRow.children[0].tagName, "A");
  assert.equal(normalRow.children[0].attrs.href, "#/orders?date=d1");
  assert.equal(typeof normalRow.children[0]._listeners.click[0], "function");

  // Every row — normal or orphan — carries a working ✕.
  for (const row of rows) {
    const del = row.children[row.children.length - 1];
    assert.equal(del.className, "inbox-del");
    assert.equal(del.attrs["aria-label"], "Remove order");
    assert.equal(del.children[0].text, "✕");
    assert.equal(typeof del._listeners.click[0], "function");

    // And its own order-code tag (#…) inside the title line, so every inbox
    // order can be matched back to its WhatsApp message.
    const title = row.children[0].children[0].children[0]; // inbox-main → .li-main → .li-title
    const code = (title.children || []).find((c) => String(c.className || "").includes("ord-code"));
    assert.ok(code, "title line carries the order code tag");
    assert.ok(String(code.children[0].text || "").startsWith("#"), "tag reads like #A3F9C2");
  }
});

test("newOrdersInbox tags an order that arrived through a referral link", () => {
  const referredState = {
    products: [{ id: "p1", name: "Focaccia", active: true }],
    deliveryDates: [{ id: "d1", date: "2026-09-04" }],
    orders: [
      // Ordered from a ?via= link, so the shop stamped referredBy with digits.
      { id: "o1", status: "new", groupId: "g1", deliveryDateId: "d1", productId: "p1", qty: 1,
        customerName: "Nadia", referredBy: "60139876543", createdAt: "2026-09-01T08:00:00", orderDate: "2026-09-01" },
      // No link — no tag.
      { id: "o2", status: "new", groupId: "g2", deliveryDateId: "d1", productId: "p1", qty: 1,
        customerName: "Maya", createdAt: "2026-09-01T09:00:00", orderDate: "2026-09-01" },
      // A non-digit referredBy is a data artefact, not a real link stamp.
      { id: "o3", status: "new", groupId: "g3", deliveryDateId: "d1", productId: "p1", qty: 1,
        customerName: "Ain", referredBy: "gift-from-me", createdAt: "2026-09-01T10:00:00", orderDate: "2026-09-01" },
    ],
  };
  const inbox = newOrdersInbox(referredState, () => {});
  const rows = inbox.children[2].children; // .inbox-list
  assert.equal(rows.length, 3);

  const tagOf = (row) => {
    const title = row.children[0].children[0].children[0]; // inbox-main → .li-main → .li-title
    return (title.children || []).find((c) => String(c.className || "").includes("ref-tag"));
  };

  const referred = tagOf(rows[0]);
  assert.ok(referred, "referred order shows the 🎁 referred tag");
  assert.match(String(referred.children[0].text || ""), /referred/);

  assert.equal(tagOf(rows[1]), undefined, "plain order gets no referral tag");
  assert.equal(tagOf(rows[2]), undefined, "non-digit referredBy is not treated as a link stamp");
});

// Orders for the finder tests. The order ids end in fixed hex so the derived
// code is predictable: "o_9f3ba44e" → #3BA44E, "o_ce7c9b21" → #7C9B21.
const searchState = () => ({
  products: [
    { id: "p1", name: "Focaccia" },
    { id: "p2", name: "Sourdough Loaf" },
  ],
  deliveryDates: [
    { id: "d1", date: "2026-09-04" },
    { id: "d2", date: "2026-09-07" },
  ],
  orders: [
    { id: "o_9f3ba44e", status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-04",
      productId: "p1", qty: 2, customerName: "Ain", whatsapp: "012-345 6789",
      note: "extra crunchy", fulfillment: "collect", createdAt: "2026-09-02T10:00:00" },
    { id: "o_ce7c9b21", status: "delivered", deliveryDateId: "d2", deliveryDate: "2026-09-07",
      productId: "p2", qty: 1, customerName: "Maya", whatsapp: "60165557777",
      note: "no onions", fulfillment: "courier", createdAt: "2026-09-03T09:00:00" },
  ],
});
const foundIds = (state, q) => matchingGroups(state, q).map((g) => g.orders[0].id);

test("matchingGroups finds orders by customer name, case-insensitively", () => {
  const st = searchState();
  assert.deepEqual(foundIds(st, "ain"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "AIN"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "maya"), ["o_ce7c9b21"]);
});

test("matchingGroups finds an order by its #code, with or without the hash and in any case", () => {
  const st = searchState();
  assert.deepEqual(foundIds(st, "3BA44E"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "#3BA44E"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "3ba44e"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "#7c9b21"), ["o_ce7c9b21"]);
});

test("matchingGroups finds an order by WhatsApp number, messy as typed", () => {
  const st = searchState();
  assert.deepEqual(foundIds(st, "012-345"), ["o_9f3ba44e"], "local format with dash");
  assert.deepEqual(foundIds(st, "0123456789"), ["o_9f3ba44e"], "local digits, no dash");
  assert.deepEqual(foundIds(st, "60123456789"), ["o_9f3ba44e"], "international digits");
  assert.deepEqual(foundIds(st, "016 555 7777"), ["o_ce7c9b21"], "country-code digits split");
});

test("matchingGroups finds by item, note, delivery method and delivery day", () => {
  const st = searchState();
  assert.deepEqual(foundIds(st, "focaccia"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "Sourdough"), ["o_ce7c9b21"]);
  assert.deepEqual(foundIds(st, "extra crunchy"), ["o_9f3ba44e"], "matches the note");
  assert.deepEqual(foundIds(st, "no onions"), ["o_ce7c9b21"]);
  assert.deepEqual(foundIds(st, "nationwide"), ["o_ce7c9b21"], "delivery method");
  assert.deepEqual(foundIds(st, "2026-09-07"), ["o_ce7c9b21"], "ISO delivery date");
});

test("matchingGroups ANDs the words — every word must match the same order", () => {
  const st = searchState();
  assert.deepEqual(foundIds(st, "ain focaccia"), ["o_9f3ba44e"]);
  assert.deepEqual(foundIds(st, "maya no onions"), ["o_ce7c9b21"]);
  assert.deepEqual(foundIds(st, "ain maya"), [], "no single order has both names");
});

test("matchingGroups sorts matches recency-first", () => {
  const st = searchState();
  st.orders.push({ id: "o_aabbcc01", status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-04",
    productId: "p1", qty: 1, customerName: "Ain", whatsapp: "", createdAt: "2026-09-04T08:00:00" });
  assert.deepEqual(foundIds(st, "ain"), ["o_aabbcc01", "o_9f3ba44e"]);
});

test("matchingGroups finds an orphaned order (its date was deleted) by name", () => {
  const st = searchState();
  st.orders.push({ id: "o_cafe0abc", status: "new", deliveryDateId: "del_gone",
    deliveryDate: "2026-08-30", productId: "p2", qty: 1, customerName: "Ghost",
    whatsapp: "", createdAt: "2026-09-01T08:00:00" });
  assert.deepEqual(foundIds(st, "ghost"), ["o_cafe0abc"]);
});

test("matchingGroups returns nothing for a blank query", () => {
  assert.deepEqual(matchingGroups(searchState(), ""), []);
  assert.deepEqual(matchingGroups(searchState(), "   "), []);
  assert.deepEqual(matchingGroups(searchState(), undefined), []);
});
