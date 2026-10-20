// test/order-stage-whole-order.test.js — changing an order's status must move the WHOLE order,
// not just the lines that happen to be on the day she is looking at.
//
// Her report: __"why a new order already change to confirm yet appear in new order at the top of
// order page?"__
//
// ⚠️⚠️ THE DAY LIST HANDS `setStage` ONLY THE ROWS ON THAT DAY — `orderList` builds
// `state.orders.filter((o) => o.deliveryDateId === dateId)`. So an order whose lines had drifted
// onto two different bake days had **only half of itself moved**: the lines on the day she was
// looking at changed, and the rest stayed New. **The New-orders inbox scans EVERY day**, so it went
// on showing the order she had just handled — under the same order code, because the rows share
// one `groupId` — and a reload was needed before it agreed with her.
//
// ⭐ REPRODUCED LIVE BEFORE THIS WAS WRITTEN: one order, two lines on two days, confirmed on the
// 12th, and the inbox kept showing that order (now reported as the 14th).
//
// ⭐ THE RULE THIS FILE PINS: an order is ONE thing. Its lines move together wherever they sit.
// ⚠️ And the two cases that must NOT change: a single-line order carries no `groupId` at all, and
// an ordinary multi-line order on one day was already right.
//
// "Now" is frozen at Thu 10 Sep 2026, as in the other Orders harnesses.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this._adopt(c); if (c != null) this.children.push(c); this._takeOptionValue(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; this._adopt(c); this.children.push(c); this._takeOptionValue(c); } },
    replaceChildren(...cs) {
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    _adopt(c) { if (c && c.nodeType === 1) c.parentNode = this; },
    // ⚠️ A REAL <select> TAKES THE VALUE OF ITS SELECTED <option>, and nothing in the shim did
    // that: `select()` marks the chosen option with `selected` and never sets the select's own
    // value, so every status dropdown read `""` and the handler that asks for `this.value` was
    // handed nothing. **A shim that cannot express what the view does hides the fault it is meant
    // to catch** — so the shim is fixed here rather than the test worked around.
    _takeOptionValue(c) {
      if (!c || c.nodeType !== 1) return;
      if (String(this.tagName) !== "SELECT" || String(c.tagName) !== "OPTION") return;
      if (c.selected) this.value = c.value;
    },
    get isConnected() {
      for (let n = this; n; n = n.parentNode) if (n === doc.body) return true;
      return false;
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    // ⚠️⚠️ A REAL DOM SETS THE PROPERTY FOR A BOOLEAN ATTRIBUTE (v605). ⚠️ `el({ hidden: true })` calls
    // `setAttribute("hidden", true)`, and this shim stored it in `attrs` only — ⚠️ **so `body.hidden` read
    // false and a card that was never opened looked open.** ⭐ A shim that cannot express what the view does
    // hides the fault it is meant to catch, so the property is set here.
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "hidden" || k === "disabled" || k === "checked" || k === "selected") this[k] = true;
    },
    removeAttribute(k) {
      delete this.attrs[k];
      if (k === "hidden" || k === "disabled" || k === "checked" || k === "selected") this[k] = false;
    },
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
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.document = doc;
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", clipboard: null }, configurable: true, writable: true,
});
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" });

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 10, 10, 0, 0); } // Thu 10 Sep 2026
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

doc.body.append(doc.getElementById("popup-layer"));

const { renderOrders } = await import("../admin/js/views/orders.js");

const DAY_A = { id: "dA", date: "2026-09-12" };
const DAY_B = { id: "dB", date: "2026-09-14" };
const GID = "ordg_aa11bb22cc33";

function row(over) {
  return {
    id: "ord_111111111111", groupId: GID, deliveryDateId: DAY_A.id, deliveryDate: DAY_A.date,
    orderDate: "2026-09-10", createdAt: "2026-09-10T09:00:00.000Z", productId: "p1", qty: 1,
    customerName: "Lucy", whatsapp: "60124689299", status: "new", fulfillment: "collect",
    ...over,
  };
}

function state(over = {}) {
  return {
    settings: { cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4], supabase: { url: "" } },
    products: [{ id: "p1", name: "Focaccia", price: 16, active: true, unit: "pc", recipe: [] }],
    deliveryDates: [DAY_A, DAY_B],
    orders: [],
    ingredients: [], occasions: [], customers: [], expenses: [], deposits: [],
    ...over,
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};

// Walk in exactly as she does: the Orders screen on that day, then the row's own status dropdown.
function confirmOnDay(st, dateId, to = "confirmed") {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: dateId }));
  const sel = all(root).find((n) => n.tagName === "SELECT" && n.value === "new");
  assert.ok(sel, "the day drew no row with a New status dropdown, so this proves nothing");
  sel.value = to;
  sel._listeners.change[0]();
  return root;
}

const statusesIn = (st) => (st.orders || []).map((o) => `${o.deliveryDateId}:${o.status}`);

test("★★ confirming an order moves EVERY line of it, even a line on another bake day", () => {
  // ⚠️⚠️ THE FAULT SHE REPORTED. The day list only holds the lines on THAT day, so the other
  // day's line was left at New — and the inbox, which scans every day, kept showing the order
  // she had just confirmed.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`, `${DAY_B.id}:confirmed`],
    "★ a line on another bake day was left behind — that is the order still showing in the New-orders list");
});

test("★★ and the New-orders list clears — the thing she was actually looking at", () => {
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date })] });
  const root = confirmOnDay(st, DAY_A.id);

  // The inbox is drawn on the screen itself; the press repaints it.
  assert.equal(all(root).filter((n) => String(n.className).includes("inbox-item")).length, 0,
    "★ the order is still listed under New orders after being confirmed");
});

test("★ an ordinary order on one day is unchanged — every line still moves together", () => {
  // The case that always worked, pinned so the fix cannot break it.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa" }), row({ id: "ord_bbbbbbbbbbbb", qty: 2 })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`, `${DAY_A.id}:confirmed`],
    "a normal two-line order did not move as one");
});

test("★ a single-line order — which carries NO group — is not disturbed", () => {
  // ⚠️ The import gives a one-line storefront order `groupId: null`, so it is only ever its own
  // row. A fix that assumed a group existed would have to invent one here.
  const st = state({ orders: [row({ id: "ord_cccccccccccc", groupId: undefined, qty: 2 })] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st), [`${DAY_A.id}:confirmed`], "a lone order did not move");
});

test("★ the status she did NOT touch, on the day she was not looking at, is left alone", () => {
  // ⚠️ The other half of "move the whole order": it must move the ORDER, not sweep up an
  // unrelated order that happens to sit on the same day. Two orders, one touched.
  const other = "ordg_999999999999";
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa" }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date }),
    row({ id: "ord_dddddddddddd", groupId: other, deliveryDateId: DAY_A.id }),
  ] });
  confirmOnDay(st, DAY_A.id);

  assert.deepEqual(statusesIn(st),
    [`${DAY_A.id}:confirmed`, `${DAY_B.id}:confirmed`, `${DAY_A.id}:new`],
    "★ the fix moved an order that was never touched");
});

// ── v587: the MONEY facts travel with the order too ──────────────────────────

const { isCollected } = await import("../admin/js/money.js");

function press(root, text) {
  const b = all(root).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === text);
  assert.ok(b, `no press reading "${text}" — this test proves nothing`);
  b._listeners.click.forEach((f) => f());
  return b;
}

test("★★★ paying from ONE day's row pays the WHOLE order (v587)", () => {
  // ⚠️⚠️ MEASURED: `markPaid` wrote only to `group.orders`, the day's slice — ⚠️ **so an order whose lines
  // sat on two bake days still read as OWED after it was paid from the second day's row**, because every book
  // reads the order through its first row.
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: false }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date, status: "paid",
      paidReceived: false }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_B.id }));
  press(root, "Pay");
  const layer = doc.getElementById("popup-layer");
  const cash = all(layer).find((n) => n._listeners && n._listeners.click
    && String(n.textContent).trim().startsWith("Cash"));
  assert.ok(cash, "the pay picker did not draw her accounts");
  cash._listeners.click.forEach((f) => f());

  assert.deepEqual(st.orders.map((o) => o.paidReceived), [true, true],
    "★ only the day she was looking at was marked paid — **the order still reads owed in every book**");
  assert.equal(isCollected({ orders: st.orders }), true, "and the order itself still reads unpaid");
});

test("★★★ the refund card opens with the figure the edit dialog named (v589)", async () => {
  // ⚠️⚠️ MISPLACED TWICE: v577 wrote the prefill inside a field's handler, v587 moved it into the quantity
  // box's KEYSTROKE handler — ⚠️ **it still never ran when the card opened, so the box read 0 and the next
  // press said "Type how much to give back".** ⚠️ The test that "covered" it only grepped the source, so
  // both versions were green. ⭐ This opens the real card and reads the real box.
  const { refundOrder } = await import("../admin/js/views/orders.js");
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true,
    paidMethod: "Cash", qty: 2, price: 15 })] });
  const group = { orders: st.orders };
  refundOrder(st, group, st.orders[0], { root: createEl("div"), dateId: DAY_A.id,
    fromEdit: true, amount: 15, paidWas: 30 });

  const layer = doc.getElementById("popup-layer");
  const box = all(layer).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "0.01");
  assert.ok(box, "the refund card drew no amount box, so this proves nothing");
  assert.equal(box.value, "15",
    "★ the card opened without the figure the dialog named — **she must retype the number she was just told**");
});

test("★★★ an edit that refunds freezes the amount that was PAID, not the edited amount (v595)", async () => {
  // ⚠️⚠️ MEASURED: `paidWasRM` was read inside the refund card's callback, which fires AFTER `applyEdits()` —
  // ⚠️ **so it froze RM15, the EDITED amount, and a past month was rewritten** — the exact fault v589 claimed
  // to end. ⭐ This walks the real flow: Edit → Save → Save it → Refund.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true,
    paidMethod: "Cash", qty: 2 })] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  assert.ok(qty, "the Edit card drew no quantity box");
  qty.value = "1";
  qty._listeners.input[0].call(qty);            // edit DOWN: 2 → 1
  press(popup, "Save changes");

  const layer = doc.getElementById("confirm-layer");
  const saveIt = all(layer).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Save it");
  assert.ok(saveIt, "the money-in question did not appear");
  saveIt._listeners.click.forEach((f) => f());

  const refundIt = all(layer).find((n) => n.tagName === "BUTTON" && /^Refund RM/.test(String(n.textContent).trim()));
  assert.ok(refundIt, "the refund question did not appear after the edit");
  refundIt._listeners.click.forEach((f) => f());

  const card = doc.getElementById("popup-layer");
  const go = all(card).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Refund");
  assert.ok(go, "the refund card drew no Refund press");
  for (const f of go._listeners.click) await f();

  assert.equal(st.orders[0].refundAmountRM, 16, "the refund itself was not recorded");
  assert.equal(st.orders[0].paidWasRM, 32,
    "★ the frozen sale is the EDITED amount — **a past month is rewritten and the refund is counted twice**");
});

test("★★★ an edit on a split order freezes the WHOLE sale (v598)", async () => {
  // ⚠️⚠️ MEASURED: `paidWasRM` froze the DAY'S slice — ⚠️ **RM48 paid on two bake days read RM32, and RM16
  // vanished from Money, Profit and the customer's lifetime spend.**
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true, paidMethod: "Cash", qty: 2 }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date, status: "paid",
      paidReceived: true, paidMethod: "Cash", qty: 1 }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  qty.value = "1";
  qty._listeners.input[0].call(qty);              // day A: 2 → 1
  press(popup, "Save changes");
  const layer = doc.getElementById("confirm-layer");
  const saveIt = all(layer).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Save it");
  assert.ok(saveIt, "the money-in question did not appear");
  saveIt._listeners.click.forEach((f) => f());
  const refundIt = all(layer).find((n) => n.tagName === "BUTTON" && /^Refund RM/.test(String(n.textContent).trim()));
  assert.ok(refundIt, "the refund question did not appear");
  refundIt._listeners.click.forEach((f) => f());
  const card = doc.getElementById("popup-layer");
  const go = all(card).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Refund");
  for (const f of go._listeners.click) await f();

  assert.equal(st.orders[0].paidWasRM, 48,
    "★ the frozen sale is one day's slice — **the other day's takings vanished from every book**");
  assert.equal(st.orders[1].paidWasRM, 48, "and it is stamped on every row of the sale");
  assert.equal(st.orders[0].refundAmountRM, 16, "the refund is the difference the dialog named");
});

test("★★★ a refund is ADDED to, and an edit-up after one moves the frozen sale (v598)", async () => {
  const { refundOrder } = await import("../admin/js/views/orders.js");
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true,
    paidMethod: "Cash", qty: 2 })] });
  const giveBack = async (value) => {
    refundOrder(st, { orders: st.orders }, st.orders[0], { root: createEl("div"), dateId: DAY_A.id });
    const card = doc.getElementById("popup-layer");
    const box = all(card).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.step === "0.01");
    box.value = String(value);
    const go = all(card).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Refund");
    for (const f of go._listeners.click) await f();
  };
  await giveBack(10);
  await giveBack(5);
  assert.equal(st.orders[0].refundAmountRM, 15,
    "★ a second refund overwrote the first — **money given back disappeared from her books**");
});

test("★★★ the day's purse line counts money BY THE DAY IT LANDED (v597)", () => {
  // ⚠️⚠️ MEASURED: the header grouped by DELIVERY day while the Money screen credits a sale to the day it was
  // PAID — ⚠️ **an order delivered on the 18th but paid on the 16th read RM15 here and RM0 on Money.**
  const paidEarly = new Date("2026-09-10T09:00:00").toISOString();
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "delivered", paidReceived: true, paidMethod: "Cash",
      paidAt: paidEarly }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  const line = all(root).find((n) => String(n.className).includes("money-line"));
  const said = line ? String(line.textContent) : "";
  assert.equal(/Cash RM/.test(said), false,
    "★ money paid on the 10th is counted again on the 12th's purse line — **the two screens disagree**");

  // Paid ON the delivery day, it shows exactly as before.
  st.orders[0].paidAt = new Date("2026-09-12T09:00:00").toISOString();
  const root2 = createEl("div");
  renderOrders(root2, st, new URLSearchParams({ date: DAY_A.id }));
  const line2 = all(root2).find((n) => String(n.className).includes("money-line"));
  assert.match(String(line2 && line2.textContent), /Cash RM 16\.00/,
    "money that landed that day left the line");
});

test("★★★ the day's purse line is NET of the refunds that came back that day (v590)", () => {
  // ⚠️⚠️ MEASURED: two RM15 sales and one RM15 refunded the same day read "Cash RM30" on the line she
  // checks her purse against, while her tin held RM15. ⭐ Each refund is taken off the account it came back
  // from, and the total is named.
  const refundedAt = new Date("2026-09-12T09:00:00").toISOString();
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "delivered", paidReceived: true, paidMethod: "Cash" }),
    row({ id: "ord_bbbbbbbbbbbb", groupId: "ordg_refunded0000", status: "delivered",
      paidReceived: true, paidMethod: "Cash", refundedAt, refundAmountRM: 16 }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  const line = all(root).find((n) => String(n.className).includes("money-line"));
  assert.ok(line, "the day drew no purse line, so this proves nothing");
  const said = String(line.textContent);
  assert.match(said, /Cash RM 16\.00/,
    "★ the header still counts the refunded sale as money in her purse — **she checks this line against her tin**");
  assert.match(said, /RM 16\.00 refunded/, "and it must say what left");
});

test("★★★ the refund ticker cannot tick more than the customer paid (v590)", async () => {
  // ⚠️⚠️ MEASURED: the ticker summed FACE prices while the cap was the discounted bill — ⚠️ **"Ticked so far
  // RM15.00" beside "up to RM12.00", and then her own press was refused.**
  const { refundOrder } = await import("../admin/js/views/orders.js");
  const code = { id: "c3", code: "SAVE3", state: "live", vis: "public", frozen: false,
    who: { type: "all" }, when: { from: "", to: "" }, basket: { type: "none", amount: 0 },
    gives: { type: "rm", value: 3, cap: 0 }, often: { type: "unlimited", n: 0, maxRM: 0 },
    beside: { type: "anything" }, say: "", sayZh: "", sayMs: "", used: 0, given: 0 };
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "delivered", paidReceived: true,
    paidMethod: "Cash", qty: 1, promo: "SAVE3" })] });
  st.promoCodes = [code];
  refundOrder(st, { orders: st.orders }, st.orders[0], { root: createEl("div"), dateId: DAY_A.id });

  const popup = doc.getElementById("popup-layer");
  const tick = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "checkbox");
  assert.ok(tick, "the refund card drew no line to tick");
  tick.checked = true;
  tick._listeners.change.forEach((f) => f());
  const sum = all(popup).find((n) => String(n.className).includes("refund-sum"));
  const ticked = sum.children[sum.children.length - 1].textContent;
  assert.equal(ticked, "RM 13.00",
    "★ the ticker priced the line at its FACE value — **it can tick more than the customer paid**");
});

test("★★★ 'Not yet' on a two-bake-day order un-pays the WHOLE order (v589)", () => {
  // ⚠️⚠️ MEASURED: `markUnpaid` looped `group.orders` — the day she edited — while every book reads the
  // order through its FIRST row. ⚠️ **From day B her answer was silently ignored (it still read PAID); from
  // day A it dropped the whole sale.** ⭐ The same `familyOfOrder` the Pay press uses.
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true, paidMethod: "Cash", qty: 2 }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date, status: "paid",
      paidReceived: true, paidMethod: "Cash", qty: 2 }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_B.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  assert.ok(qty, "the Edit card drew no quantity box, so this proves nothing");
  qty.value = "3";
  qty._listeners.input[0].call(qty);              // edit UP, so the dialog asks about the extra
  press(popup, "Save changes");

  const notYet = all(doc.getElementById("confirm-layer"))
    .find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Not yet");
  assert.ok(notYet, "the 'extra paid?' question did not appear, so the answer was never given");
  notYet._listeners.click.forEach((f) => f());

  assert.deepEqual(st.orders.map((o) => o.paidReceived), [false, false],
    "★ only the edited day was un-paid — **the order still reads PAID in every book**");
});

test("★★★ a customer-borne courier charge does not fake an 'extra paid?' question (v589)", () => {
  // ⚠️⚠️ MEASURED: `paidWas` was `orderNet` (goods only — the courier charge is never her takings) and it was
  // compared with a draft total that INCLUDED the charge. ⚠️ **Editing the note on a paid order with an RM8
  // customer charge asked whether the extra RM8 had been paid; answering "Not yet" un-paid the order.**
  const st = state({ orders: [
    row({ id: "ord_cccccccccccc", status: "paid", paidReceived: true, paidMethod: "Cash", qty: 2,
      fulfillment: "courier", address: "12 Jalan Bunga, 10450 Penang", courierFee: 8, courierPaidBy: "customer" }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const notes = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "text"
    && /note/i.test(String(n.attrs.placeholder || "")));
  if (notes) { notes.value = "ring the bell"; if (notes._listeners.input) notes._listeners.input[0].call(notes); }
  press(popup, "Save changes");

  const asked = all(doc.getElementById("confirm-layer"))
    .some((n) => String(n.textContent).includes("Has the extra"));
  assert.equal(asked, false,
    "★ a courier charge that never entered her accounts was counted as money she had received");
  assert.equal(st.orders[0].paidReceived, true, "and the order is still paid");
});

test("★★★ a refund from ONE day's row refunds the WHOLE order (v587)", () => {
  // ⚠️⚠️ MEASURED: the refund was stamped on the slice only, while `refundOf` reads the first row — ⚠️ **so
  // the refund never left any account and Profit kept the sale, although the register was marked.**
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true, paidMethod: "Cash" }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date, status: "paid",
      paidReceived: true, paidMethod: "Cash" }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_B.id }));
  press(root, "Refund");
  const layer = doc.getElementById("popup-layer");
  const box = all(layer).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "0.01");
  assert.ok(box, "the refund card has no amount box");
  box.value = "5";
  press(layer, "Refund");

  assert.deepEqual(st.orders.map((o) => o.refundAmountRM), [5, 5],
    "★ only the day's slice carries the refund — **the books keep the sale and no account loses the money**");
  assert.equal(st.orders.every((o) => o.refundedAt), true, "and the order is only half refunded");
});

// ── v599: the edit/refund arithmetic after a freeze ───────────────────────

const money = await import("../admin/js/money.js");

test("★★★ the refund card accepts the figure the edit itself named (v599)", async () => {
  // ⚠️⚠️ MEASURED: the cap was the POST-EDIT bill less prior refunds, while the promised refund was
  // paid − post-edit worth — ⚠️ **RM48 paid (3 × RM16), edited down to RM16: the dialog said "Refund RM32",
  // the box opened on 32, and the press was refused ("up to RM16.00"), leaving the books at RM16 against
  // RM48 of cash.** ⭐ The cap is the money she still holds.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true,
    paidMethod: "Cash", qty: 3 })] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  qty.value = "1";
  qty._listeners.input[0].call(qty);              // 3 → 1: RM48 becomes RM16
  press(popup, "Save changes");

  const layer = doc.getElementById("confirm-layer");
  const saveIt = all(layer).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Save it");
  assert.ok(saveIt, "the money-in question did not appear");
  saveIt._listeners.click.forEach((f) => f());
  const refundIt = all(layer).find((n) => n.tagName === "BUTTON" && /^Refund RM/.test(String(n.textContent).trim()));
  assert.ok(refundIt, "the refund question did not appear");
  refundIt._listeners.click.forEach((f) => f());

  const card = doc.getElementById("popup-layer");
  const box = all(card).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "0.01");
  assert.equal(box.value, "32", "the card did not open on the figure the dialog promised");
  const go = all(card).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Refund");
  for (const f of go._listeners.click) await f();

  assert.equal(st.orders[0].refundAmountRM, 32,
    "★ her own press was refused — **the books keep RM16 of a RM48 sale and the refund never happened**");
  assert.equal(money.orderNet(st, { orders: st.orders }), 16, "RM48 in, RM32 back, RM16 kept");
});

test("★★★ an edit back up ADDS the extra to the frozen sale (v599)", async () => {
  // ⚠️⚠️ MEASURED: the refreeze SUBSTITUTED the new worth for the old, while the refund stayed accumulated —
  // ⚠️ **RM32 paid → edit to RM16 + RM16 refund → edit back to RM32 + "Yes, paid too" read net RM16 against
  // RM32 in her hand.** ⭐ Money received only ever goes up when the customer pays the extra.
  const st = state({ orders: [row({ id: "ord_aaaaaaaaaaaa", status: "paid", paidReceived: true,
    paidMethod: "Cash", qty: 2 })] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));

  // First: edit down and refund the difference.
  press(root, "Edit");
  let popup = doc.getElementById("popup-layer");
  let qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  qty.value = "1";
  qty._listeners.input[0].call(qty);
  press(popup, "Save changes");
  let layer = doc.getElementById("confirm-layer");
  all(layer).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Save it")
    ._listeners.click.forEach((f) => f());
  all(layer).find((n) => n.tagName === "BUTTON" && /^Refund RM/.test(String(n.textContent).trim()))
    ._listeners.click.forEach((f) => f());
  const firstCard = doc.getElementById("popup-layer");
  const go = all(firstCard).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Refund");
  for (const f of go._listeners.click) await f();
  assert.equal(st.orders[0].paidWasRM, 32, "precondition: the sale froze at what was paid");
  assert.equal(st.orders[0].refundAmountRM, 16, "precondition: RM16 went back");

  // Second: edit back up — the customer pays the extra.
  press(root, "Edit");
  popup = doc.getElementById("popup-layer");
  qty = all(popup).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.type === "number"
    && n.attrs.step === "1");
  qty.value = "2";
  qty._listeners.input[0].call(qty);
  press(popup, "Save changes");
  layer = doc.getElementById("confirm-layer");
  const paidToo = all(layer).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === "Yes, paid too");
  assert.ok(paidToo, "paying for the extra did not ask — or asked the wrong question");
  paidToo._listeners.click.forEach((f) => f());

  assert.equal(st.orders[0].paidWasRM, 48,
    "★ the extra RM16 was not added to the money received — **RM32 in her hand reads RM16**");
  assert.equal(money.orderNet(st, { orders: st.orders }), 32,
    "★ net money kept is not what she holds");
});

test("★★★ the edit pop-up shows the WHOLE sale, so every line it changes is on screen (v601)", () => {
  // ⚠️⚠️ THE FAULT: the pop-up's Save writes the address, the note, the day and the tracking number onto
  // EVERY row of the sale — while the pop-up itself listed only the rows on the day it was opened from.
  // ⭐ **So the other day's lines were rewritten without ever being on screen**, which is exactly the
  // "one order's lines disagree" state Check my system reports.
  const st = state({ orders: [
    row({ id: "ord_aaaaaaaaaaaa", qty: 2 }),
    row({ id: "ord_bbbbbbbbbbbb", deliveryDateId: DAY_B.id, deliveryDate: DAY_B.date, qty: 1 }),
  ] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  press(root, "Edit");
  const popup = doc.getElementById("popup-layer");
  const qtys = all(popup).filter((n) => n.tagName === "INPUT" && n.attrs
    && n.attrs.type === "number" && n.attrs.step === "1");
  assert.equal(qtys.length, 2,
    "★ the pop-up showed only this day's line — **the other day's line is written by Save without ever "
    + "being on screen**");

  // ⚠️ AND THE SECOND LINE IS EDITABLE — the half that matters. A list that shows it but cannot change it
  // would be a display fix with the fault intact.
  qtys[1].value = "3";
  qtys[1]._listeners.input[0].call(qtys[1]);
  press(popup, "Save changes");
  assert.equal(st.orders.find((o) => o.id === "ord_bbbbbbbbbbbb").qty, 3,
    "★ the other day's line could not be changed — it was not really on the draft");
});

test("★★★ the bake-day card has ONE sale door, and it is the New order card (v607)", () => {
  // ⚠️ v605 added a "Sell one now" button that only opened the card already below it. ⚠️ **A third control
  // saying what the card says** — she asked whether it was still needed, and the answer was no. ⭐ The
  // capability must remain: the sale card is on the day, and a day with NO card keeps its own "sell now"
  // (v606, driven in orders-cal.test.js).
  const st = state({ orders: [] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  const sell = all(root).find((n) => n.tagName === "BUTTON"
    && String((n.children[0] && n.children[0].text) || "") === "Sell one now");
  assert.equal(sell, undefined,
    "★ the v605 shortcut is back — a second control for the same sale");
  const head = all(root).find((n) => n.tagName === "BUTTON"
    && String(n.className || "").split(/\s+/).includes("fold-head")
    && String(n.textContent).includes("New order"));
  assert.ok(head, "★ the one sale door left is gone — a bake day can no longer take a sale");
});

test("★★★ a private sale's day is not announced as a sale day or a bake day (v608)", () => {
  // ⚠️ Her words: __"i dont want to announce a special bake day or sale day."__ ⭐ The day is only the
  // container for the order; the card says the date and nothing about what kind of day it is.
  const st = state({ orders: [], deliveryDates: [{ id: DAY_A.id, date: DAY_A.date, recordOnly: true }] });
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: DAY_A.id }));
  const words = all(root).map((n) => String(n.textContent || "")).join(" ");
  assert.equal(/Sale day|not offered on the shop/i.test(words), false,
    "★ the private day announced itself on screen");
  assert.equal(/not a bake day/i.test(words), false, "★ the private day was described as a bake day");
});
