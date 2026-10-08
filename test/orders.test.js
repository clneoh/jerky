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

test("journey marks: a regular who pays at the counter has no Paid step at all", () => {
  // "Some close customer prefer to pay either by TnG or Cash when they puck up" (17 Sep 2026).
  // Going Confirmed -> Preparing without the money recorded must never leave a tick on Paid.
  assert.deepEqual(journeyMarks({ status: "baking", paidReceived: false }),
    ["done", "done", "skipped", "done", "now", "todo"], "the step keeps its place, X not tick");
  assert.deepEqual(journeyMarks({ status: "ready", paidReceived: false }),
    ["done", "done", "skipped", "done", "done", "now"]);
  assert.deepEqual(journeyMarks({ status: "delivered", paidReceived: false }),
    ["done", "done", "skipped", "done", "done", "done"]);
  // Paid in cash at the counter, then recorded: the money is real, so the step is back.
  assert.deepEqual(journeyMarks({ status: "delivered", paidReceived: true }),
    ["done", "done", "done", "done", "done", "done"]);
  // And an order waiting ON the money stage keeps the step, because that is the work.
  assert.deepEqual(journeyMarks({ status: "paid", paidReceived: false }),
    ["done", "done", "now", "todo", "todo", "todo"]);
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
  // ⚠️ A REAL state always has these (loadState/normalize builds them), and the
  // view has always assumed it: the New-order card's own total reads
  // state.settings.currency. The Edit pop-up now reads it too, for the cost box's
  // placeholder (v380), so the shim carries them rather than the app going
  // defensive about a field that is never actually missing.
  settings: { currency: "RM" },
  ingredients: [],
  uoms: [],
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

  // Orphaned order: it CAN be opened now (v332) — its own Edit card, where a day is chosen.
  // ⚠️ It was a bare `<span>` with only a ✕, which left deleting it as the one thing she
  // could do with it. Every row is a control; alike rows behave alike.
  const orphanRow = rows[0];
  assert.equal(orphanRow.children[0].tagName, "A", "orphan row is a control, not a bare span");
  assert.equal(orphanRow.children[0].children[1].children.length, 2,
    "and it wears the arrow, because it now leads somewhere");

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

// A row stub shaped like the date view's order row: a live classList, a
// scrollIntoView and listeners, all recording what the reveal did to it.
function fakeRow() {
  const cls = [];
  const listeners = {};
  return {
    cls,
    listeners,
    scrolled: null,
    classList: { add: (c) => cls.push(c), remove: (c) => cls.push(`-${c}`) },
    scrollIntoView(opts) { this.scrolled = opts; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    // The baker reaching the row — whichever of the settle events fires first.
    settle(type = "pointerenter") { for (const fn of (listeners[type] || []).slice()) fn({ type }); },
  };
}

// A stand-in for the view element, answering the two lookups the reveal makes.
function fakeRoot(byOrder = {}, byGroup = {}) {
  return {
    querySelector(sel) {
      let m = /^\[data-order="(.+)"\]$/.exec(sel);
      if (m) return byOrder[m[1]] || null;
      m = /^\[data-group="(.+)"\]$/.exec(sel);
      return (m && byGroup[m[1]]) || null;
    },
  };
}

// Tap an inbox row (its click handler), which runs the whole reveal.
function tapRow(rowEl) {
  rowEl._listeners.click[0]({ preventDefault() {} });
}

test("a tap in the New-orders inbox opens the date, then flashes and centres the order's row", () => {
  const row = fakeRow();
  const root = fakeRoot({ o2: row });
  let opened = null;
  const inbox = newOrdersInbox(inboxState, (id) => { opened = id; }, root);
  const rows = inbox.children[2].children; // .inbox-list
  assert.equal(opened, null, "nothing opens before the tap");

  tapRow(rows[1].children[0]); // o2 → d2

  assert.equal(opened, "d2", "the tap opens that order's delivery date");
  assert.deepEqual(row.cls, ["hit"], "the row starts flashing and stays lit until the baker arrives");
  assert.equal(row.scrolled.block, "center", "the row is brought to the middle of the screen");
  assert.equal(row.scrolled.behavior, "smooth");

  // Reaching the row is what ends the glow — not a clock.
  row.settle();
  assert.deepEqual(row.cls, ["hit", "-hit"], "the flash clears when the pointer lands on the row");
  assert.equal(row.listeners.pointerenter.length, 0, "the settle listeners take themselves off");
  assert.equal(row.listeners.pointermove.length, 0, "every settle event is removed, not just the one that fired");
});

test("the glow survives a long hunt, and any of the settle events ends it", () => {
  // The reported problem: a fixed flash expires while the eye is still
  // travelling, and the baker is left hunting for a row that is no longer lit.
  const row = fakeRow();
  const root = fakeRoot({ o2: row });
  tapRow(newOrdersInbox(inboxState, () => {}, root).children[2].children[1].children[0]);

  assert.deepEqual(row.cls, ["hit"], "still lit an hour later — nothing on a timer takes it off");
  row.settle("pointerdown"); // the tap that opens the order
  assert.deepEqual(row.cls, ["hit", "-hit"], "the tap on the row ends the glow too");
});

test("the reveal finds the row through the group id when it is tagged with a different item", () => {
  // The date view draws ONE row per customer order, tagged with whichever item
  // it lists first — which a group left with mixed statuses may not be the item
  // the inbox holds. The row carries its group id too, and that is the fallback.
  const row = fakeRow();
  const root = fakeRoot({}, { g2: row });
  let opened = null;
  const inbox = newOrdersInbox(inboxState, (id) => { opened = id; }, root);
  const rows = inbox.children[2].children; // .inbox-list

  tapRow(rows[1].children[0]); // o2 → d2, but only [data-group="g2"] answers

  assert.equal(opened, "d2");
  assert.deepEqual(row.cls, ["hit"], "the row was found through its group id");
  assert.equal(row.scrolled.block, "center");
});

test("★ an orphaned inbox row CAN be tapped, and says so", () => {
  // ★★ v332, and this test used to pin the opposite: "an orphaned inbox row offers no tap".
  // That was the dead end. An order whose delivery day was deleted was drawn as a plain
  // `<span>` with only a ✕ beside it — **so the one thing she could do with it was delete
  // it**, and if she did not want to delete it she could do nothing at all. Her report:
  // __"there is many orphant orders around, can you clear it for me"__.
  //
  // ⚠️ THE BEHAVIOUR CHANGED ON PURPOSE, so the assertion changed with it rather than
  // being deleted: **the row now opens the order's own Edit card**, which is where a day
  // is chosen. Nothing about the ✕ moved — it is still on every row.
  const inbox = newOrdersInbox(inboxState, () => {}, fakeRoot());
  const rows = inbox.children[2].children; // .inbox-list
  const orphan = rows[0].children[0];
  assert.ok(orphan._listeners.click, "an orphan row can be tapped");
  assert.doesNotThrow(() => tapRow(orphan), "and tapping it does not throw");

  // ⚠️ AND IT SAYS WHAT IT IS. A row with the day simply missing read as an ordinary order
  // that had lost a field, with no hint that it could be fixed.
  const sub = rows[0].children[0].children[0].children[1].children[0].text;
  assert.ok(String(sub).includes("delivery day was removed"),
    `the row says why it has no day: ${sub}`);
  assert.ok(String(sub).includes("tap to put it on one"), "and what tapping does");

  // A row that the date view did not render (e.g. filtered away) must not throw.
  assert.doesNotThrow(() => tapRow(rows[1].children[0]));
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

test("★ a code is found AS A CODE — never as a loose pair of digits out of it", () => {
  // ★★ Her report, 5 Oct 2026: __"C2FDA5 why when i type this 17 order found?"__
  //
  // ⚠️⚠️ THE FALLBACK MEANT FOR A PHONE NUMBER TYPED WITH DASHES WAS FIRING ON AN ORDER
  // CODE. `C2FDA5` has two digits in it, so `tok.replace(/[^0-9]/g, "")` gave "25" — and
  // the query then matched **every order whose WhatsApp number contains "25"**, which in a
  // Malaysian mobile book is most of them. Seventeen, on her book.
  //
  // The fallback exists for "012-345 6789": a number typed WITH separators, which cannot
  // match the stored number character for character. **A query with a letter in it is not a
  // number, and a code is matched by the text path above** — `#C2FDA5` is in the haystack,
  // so the code never needed the digits path at all.
  const st = {
    ...searchState(),
    // ⚠️ The ORIGINAL two ride along: the phone-number half of this test needs the order
    // whose number was stored as "012-345 6789", and replacing the list wholesale would
    // have silently removed the thing that half is checking.
    orders: [
      ...searchState().orders,
      { id: "o_c2fda5", status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-04",
        productId: "p1", qty: 1, customerName: "Ain", whatsapp: "60111111111",
        fulfillment: "collect", createdAt: "2026-09-04T10:00:00" },
      // Numbers that really do contain "25" — the seventeen, in miniature.
      { id: "o_aaaa1111", status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-04",
        productId: "p1", qty: 1, customerName: "Bee", whatsapp: "6012255555",
        fulfillment: "collect", createdAt: "2026-09-01T10:00:00" },
      { id: "o_bbbb2222", status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-04",
        productId: "p1", qty: 1, customerName: "Cee", whatsapp: "6012255666",
        fulfillment: "collect", createdAt: "2026-09-01T11:00:00" },
    ],
  };
  assert.deepEqual(foundIds(st, "C2FDA5"), ["o_c2fda5"],
    "the code finds the order it names, and only it");
  assert.deepEqual(foundIds(st, "c2fda5"), ["o_c2fda5"], "in any case");
  assert.deepEqual(foundIds(st, "#C2FDA5"), ["o_c2fda5"], "and with the hash");
  // ⚠️ AND THE FALLBACK STILL DOES ITS OWN JOB — a number typed with separators, and the
  // bare digits of one, both still find their order. The fix must not take that away.
  assert.deepEqual(foundIds(st, "012-345"), ["o_9f3ba44e"], "a number with separators still finds it");
  assert.deepEqual(foundIds(st, "12255555"), ["o_aaaa1111"], "and its bare digits do too");
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
