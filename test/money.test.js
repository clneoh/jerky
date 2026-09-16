// test/money.test.js — what came in, and how (v101). The Orders day header and the
// Money screen both read admin/js/money.js, so these pin the rules they agree on:
// collected money is counted by the day it LANDED, money still to collect by the
// day it is for, and "Paid" in the dropdown is not the money arriving.

import { test } from "node:test";
import assert from "node:assert/strict";

const { dayMoney, moneyBetween, isCollected, methodOf, groupValue, paidOf } =
  await import("../admin/js/money.js");

// Focaccia at RM15; two delivery days. One order is a single row unless a test says
// otherwise — groupOrders() turns rows that share a groupId into one customer order.
function state() {
  return {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }, { id: "d20", date: "2026-09-20" }],
    orders: [],
  };
}
const row = (extra = {}) => ({
  id: "o1", deliveryDateId: "d18", deliveryDate: "2026-09-18",
  productId: "p1", qty: 1, status: "paid", ...extra,
});

test("a day's till splits cash from TNG, and counts what is still to collect", () => {
  const st = state();
  st.orders = [
    row({ id: "a", status: "ready", paidReceived: true, paidMethod: "cash" }),          // RM15 cash
    row({ id: "b", status: "baking", paidReceived: true, paidMethod: "tng", qty: 2 }),   // RM30 TNG
    row({ id: "c", status: "confirmed", paidReceived: false }),                          // RM15 owed
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.cash, 15);
  assert.equal(m.tng, 30);
  assert.equal(m.toCollect, 15);
  assert.equal(m.toCollectCount, 1);
  assert.equal(m.unmarked, 0, "both paid orders say how");
  assert.equal(dayMoney(st, "d20").count, 0, "another day is its own till");
});

test("an order waiting on the money is not collected, however its status reads", () => {
  // Picking Paid in the dropdown only says the order has reached the paying stage;
  // the Paid · Cash / Paid · TNG button is what says the money arrived.
  assert.equal(isCollected({ orders: [row({ status: "paid", paidReceived: false })] }), false);
  assert.equal(isCollected({ orders: [row({ status: "paid", paidReceived: true })] }), true);
  assert.equal(isCollected({ orders: [row({ status: "confirmed" })] }), false,
    "an early order is not collected just because it has no flag");
  assert.equal(isCollected({ orders: [row({ status: "baking" })] }), true,
    "but an older order past Paid with no flag reads as collected, as it always has");
});

test("what one customer order is worth is what it was sold at, not today's menu", () => {
  const st = state();
  // Both lines were sold at a stamped price — the normal case, since adding an order
  // freezes the product's price onto it. The second was sold at a price she typed.
  const group = { orders: [row({ qty: 2, unitPrice: 15 }), row({ id: "o2", qty: 1, unitPrice: 12.5 })] };
  assert.equal(groupValue(st, group), 42.5, "2 × RM15 + 1 × RM12.50");
  st.products[0].price = 22;
  assert.equal(groupValue(st, group), 42.5, "a price changed on the menu does not rewrite the sale");
});

test("collected money is counted by the day it landed", () => {
  const st = state();
  st.orders = [
    row({ id: "a", status: "ready", paidReceived: true, paidMethod: "tng",
      paidAt: "2026-09-16T09:30:00.000Z" }),                       // paid the 16th, for the 18th
    row({ id: "b", status: "confirmed", paidReceived: false }),     // owed, for the 18th
  ];
  assert.equal(paidOf(st, { orders: [st.orders[0]] }), "2026-09-16");

  const paidDay = moneyBetween(st, "2026-09-16", "2026-09-16");
  assert.equal(paidDay.tng, 15, "the money belongs to the day it landed");
  assert.equal(paidDay.toCollect, 0, "and the owed order is not owed FOR that day");

  const deliveryDay = moneyBetween(st, "2026-09-18", "2026-09-18");
  assert.equal(deliveryDay.tng, 0, "the transfer is not counted again on the delivery day");
  assert.equal(deliveryDay.toCollect, 15, "but what is owed for that day is");
  assert.equal(deliveryDay.toCollectCount, 1);
});

test("money paid before the stamp existed falls back to the delivery day", () => {
  const st = state();
  st.orders = [row({ status: "delivered", paidReceived: true, paidMethod: "cash" })];
  assert.equal(paidOf(st, { orders: [st.orders[0]] }), "2026-09-18");
  assert.equal(moneyBetween(st, "2026-09-18", "2026-09-18").cash, 15);
});

test("an order paid but with no method recorded is its own line", () => {
  const st = state();
  st.orders = [row({ status: "ready", paidReceived: true })];
  const m = moneyBetween(st, "2026-09-18", "2026-09-18");
  assert.equal(m.cash, 0);
  assert.equal(m.tng, 0);
  assert.equal(m.unmarked, 15, "counted, and flagged as unsplit rather than guessed at");
  assert.equal(methodOf({ orders: [st.orders[0]] }), "");
});

test("a multi-item order counts once, at the sum of its lines", () => {
  const st = state();
  st.orders = [
    row({ id: "a", groupId: "g1", qty: 2, status: "ready", paidReceived: true, paidMethod: "cash" }),
    row({ id: "b", groupId: "g1", qty: 1, unitPrice: 8, status: "ready", paidReceived: true, paidMethod: "cash" }),
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.cash, 38, "2 × RM15 + 1 × RM8");
  assert.equal(m.count, 1, "one customer order, not two");
});

// ── v103: money out ──────────────────────────────────────────────────────────
const { expensesBetween } = await import("../admin/js/money.js");

test("what she spent is counted on the day she paid it, split by method", () => {
  const st = state();
  st.expenses = [
    { id: "e1", date: "2026-09-16", amount: 52.5, category: "Ingredients & shopping", method: "cash", poId: "po1" },
    { id: "e2", date: "2026-09-15", amount: 18, category: "Packaging", method: "cash" },
    { id: "e3", date: "2026-09-18", amount: 40, category: "Delivery & fuel", method: "tng" },
    { id: "e4", date: "2026-09-17", amount: 9, category: "Other" },              // no method recorded
  ];
  const today = expensesBetween(st, "2026-09-16", "2026-09-16");
  assert.equal(today.total, 52.5, "only the day asked for");
  assert.equal(today.cash, 52.5);
  assert.equal(today.tng, 0);
  assert.equal(today.rows.length, 1);

  const week = expensesBetween(st, "2026-09-14", "2026-09-20");
  assert.equal(week.total, 119.5);
  assert.equal(week.cash, 70.5);
  assert.equal(week.tng, 40);
  assert.equal(week.unmarked, 9, "one expense with no method, counted and flagged");
  assert.deepEqual(week.rows.map((e) => e.date),
    ["2026-09-18", "2026-09-17", "2026-09-16", "2026-09-15"], "newest first");
});

test("an app with no expenses yet is simply empty, not broken", () => {
  const m = expensesBetween(state(), "2026-09-01", "2026-09-30");
  assert.equal(m.total, 0);
  assert.deepEqual(m.rows, []);
});

// ── the Money screen itself ──────────────────────────────────────────────────
// A small DOM shim, as the other view tests use: createElement with a textContent
// that reads back through children, so the lines can be read as words.
function domShim() {
  const registry = {};
  const createEl = (tag) => {
    const node = {
      tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
      className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
      _listeners: {},
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
    Object.defineProperty(node, "textContent", {
      get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
      set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
    });
    return node;
  };
  globalThis.document = {
    createElement: createEl,
    createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
    getElementById: (id) => (registry[id] ||= createEl("div")),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: createEl("body"),
  };
  return registry;
}
const { todayISO } = await import("../admin/js/dates.js");
const { renderMoney } = await import("../admin/js/views/money.js");
const screen = domShim();
const allOf = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); allOf(c, out); }
  return out;
};

test("the Money screen puts what came in beside what went out, and the net", () => {
  const today = todayISO();
  const st = state();
  st.deliveryDates = [{ id: "d18", date: today }];
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: `${today}T09:00:00.000Z`, unitPrice: 15 })];
  st.expenses = [{ id: "e1", date: today, amount: 5, category: "Packaging", method: "cash" }];

  const root = document.createElement("div");
  renderMoney(root, st);

  // Each line read as label + value, so a missing space between the two cannot make
  // a test pass or fail on its own.
  const rows = allOf(allOf(root).find((n) => String(n.className).includes("money-rows")))
    .filter((n) => String(n.className).includes("info-row"))
    .map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`);
  assert.deepEqual(rows, [
    "Cash in=RM 15.00",
    "TNG in=RM 0.00",
    "Cash out=RM 5.00",
    "TNG out=RM 0.00",
    "Net=RM 10.00",
    "Still to collect=RM 0.00",
    "Paid, no method=RM 0.00",
  ], "in, out, and what should be left — with what is still owed kept out of the net");

  const expense = allOf(root).find((n) => String(n.className).includes("info-row")
    && n.textContent.includes("Packaging"));
  assert.ok(expense, "the spending in this stretch is listed by what it was for");
  assert.ok(allOf(root).some((n) => n.textContent === "＋ Add an expense"), "with a way to add another");
});

test("an expense with no method recorded is flagged, not folded into cash", () => {
  const today = todayISO();
  const st = state();
  st.expenses = [{ id: "e1", date: today, amount: 12, category: "Delivery & fuel" }];
  const root = document.createElement("div");
  renderMoney(root, st);
  const rows = allOf(root).filter((n) => String(n.className).includes("info-row"))
    .map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`);
  assert.ok(rows.includes("Cash out=RM 0.00") && rows.includes("TNG out=RM 0.00"),
    "neither purse nor phone claims it");
  assert.ok(rows.includes("Net=RM 0.00"),
    "and the net — what should be in the purse and on the phone — leaves it out too");
  assert.ok(rows.includes("Spent, no method recorded=RM -12.00"),
    "but it is named, on its own line, rather than quietly dropped");
});

test("money taken just after midnight belongs to that day, not the day before", () => {
  // 16:30 UTC on the 16th is half past midnight on the 17th in Malaysia, where she
  // is. The day the money landed is HER day. (This suite runs on her machine, so
  // the local zone is the bakery's — the same assumption the store's own date tests
  // already make.)
  const st = state();
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: "2026-09-16T16:30:00.000Z" })];
  assert.equal(paidOf(st, { orders: [st.orders[0]] }), "2026-09-17");
  assert.equal(moneyBetween(st, "2026-09-17", "2026-09-17").cash, 15,
    "so it is in the right day's takings");
  assert.equal(moneyBetween(st, "2026-09-16", "2026-09-16").cash, 0);
});

// ── v104: money she puts in herself ──────────────────────────────────────────
const { depositsBetween } = await import("../admin/js/money.js");

test("money she put in is a pocket list of its own, counted the same way", () => {
  const st = state();
  st.deposits = [
    { id: "d1", date: "2026-09-16", amount: 100, method: "cash", note: "flour money" },
    { id: "d2", date: "2026-09-14", amount: 40, method: "tng" },
    { id: "d3", date: "2026-09-20", amount: 5, method: "cash" },
  ];
  const week = depositsBetween(st, "2026-09-14", "2026-09-20");
  assert.equal(week.total, 145);
  assert.equal(week.cash, 105);
  assert.equal(week.tng, 40);
  assert.deepEqual(week.rows.map((d) => d.date), ["2026-09-20", "2026-09-16", "2026-09-14"],
    "newest first, like the spending list");
  assert.equal(depositsBetween(st, "2026-09-16", "2026-09-16").total, 100, "ranges apply");
});

test("her own money counts into the till, and the screen says how much was hers", () => {
  const today = todayISO();
  const st = state();
  st.deliveryDates = [{ id: "d18", date: today }];
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: `${today}T09:00:00.000Z`, unitPrice: 15 })];
  st.deposits = [{ id: "d1", date: today, amount: 100, method: "cash", note: "flour money" }];
  st.expenses = [{ id: "e1", date: today, amount: 30, category: "My own withdrawal", method: "cash" }];

  const root = document.createElement("div");
  renderMoney(root, st);
  const rows = allOf(allOf(root).find((n) => String(n.className).includes("money-rows")))
    .filter((n) => String(n.className).includes("info-row"))
    .map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`);
  assert.ok(rows.includes("Cash in=RM 115.00"), "RM15 of orders + RM100 of her own in the purse");
  assert.ok(rows.includes("Cash out=RM 30.00"), "and the withdrawal leaves the same way as any spending");
  assert.ok(rows.includes("Net=RM 85.00"), "the net still adds up");

  assert.ok(allOf(root).some((n) => /of the money in, RM 100\.00 was your own/.test(String(n.textContent || ""))),
    "the screen says how much of the till is hers");
  assert.ok(allOf(root).some((n) => String(n.textContent || "").includes("From my pocket")
    && String(n.textContent || "").includes("flour money")),
    "and lists it, so she can see where it came from");
});

test("taking her money back out is offered as an expense category", () => {
  const today = todayISO();
  const st = state();
  st.expenses = [];
  const root = document.createElement("div");
  renderMoney(root, st);
  const add = allOf(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes("Add an expense"));
  (add._listeners.click || []).forEach((f) => f());
  const pop = screen["popup-layer"];
  const cats = allOf(pop).filter((n) => n.tagName === "BUTTON").map((b) => b.textContent.trim());
  assert.ok(cats.includes("My own withdrawal"),
    "so the way back out needs no new machinery: same form, same money-out list");
  assert.ok(cats.includes("Packaging"), "and everything else is still there");
});

// ── v106: the two lists are hers to shape ────────────────────────────────────
const { categoriesOf, methodsOf, classOfCategory, methodLabel, isCash, isTng, isOther } =
  await import("../admin/js/accounts.js");

test("the lists fall back to the built-in ones until she changes them", () => {
  const bare = { settings: {} };
  assert.deepEqual(methodsOf(bare), ["Cash", "TNG", "Loan"],
    "the third choice she asked for: a loan, and room for a bank overdraft later");
  assert.ok(categoriesOf(bare).some((c) => c.label === "Salary (you)"));
  assert.equal(classOfCategory(bare, "Ingredients & shopping"), "stock");

  const hers = { settings: { payMethods: ["Cash", "TNG", "Bank OD"], categories: [{ label: "Baking class", cls: "expense" }] } };
  assert.deepEqual(methodsOf(hers), ["Cash", "TNG", "Bank OD"]);
  assert.deepEqual(categoriesOf(hers).map((c) => c.label), ["Baking class"], "her list replaces the built-in one");
  assert.equal(classOfCategory(hers, "Baking class"), "expense");
  // A deleted category's rows are still understood: the safe reading is a cost.
  assert.equal(classOfCategory(hers, "Rent"), "expense");
});

test("a method is read however it was written, and a loan is not the purse", () => {
  assert.equal(methodLabel("tng"), "TNG", "rows written before the list existed");
  assert.equal(methodLabel("cash"), "Cash");
  assert.equal(methodLabel("Bank OD"), "Bank OD", "her own words come back as typed");
  assert.equal(methodLabel(""), "");
  assert.ok(isCash("cash") && isCash("Cash"));
  assert.ok(isTng("tng") && isTng("TNG"));
  assert.ok(isOther("Loan") && isOther("Bank OD"), "money that never went near the purse");
  assert.equal(isOther("Cash"), false);
  assert.equal(isOther(""), false, "an unrecorded method is its own case, not 'other'");
});

test("what a loan paid for is kept out of the purse", () => {
  const today = todayISO();
  const st = state();
  st.deliveryDates = [{ id: "d18", date: today }];
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: `${today}T09:00:00.000Z`, unitPrice: 15 })];
  st.expenses = [
    { id: "e1", date: today, amount: 250, category: "Ingredients & shopping", method: "Loan" },
    { id: "e2", date: today, amount: 18, category: "Packaging", method: "Cash" },
  ];
  const root = document.createElement("div");
  renderMoney(root, st);
  const rows = allOf(allOf(root).find((n) => String(n.className).includes("money-rows")))
    .filter((n) => String(n.className).includes("info-row"))
    .map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`);
  assert.ok(rows.includes("Cash out=RM 18.00"), "only the cash one leaves the purse");
  assert.ok(rows.includes("Net=RM -3.00"), "15 in, 18 out — the flour run never touched it");
  assert.ok(rows.includes("Paid by Loan=RM -250.00"),
    "and the loan-funded run is named on its own line instead — by the method's own name, "
    + "because it now has its own book to open (17 Sep 2026)");
});

// ── v109: a book per method ──────────────────────────────────────────────────
const { journalFor } = await import("../admin/js/money.js");

test("a method's journal lists every movement that way, and ends on what it should hold", () => {
  const st = state();
  st.deliveryDates = [{ id: "d18", date: "2026-09-18" }];
  st.orders = [
    row({ id: "a", status: "ready", paidReceived: true, paidMethod: "cash", qty: 2,
      paidAt: "2026-09-16T09:00:00.000Z", unitPrice: 15 }),                    // RM30 in
    row({ id: "b", status: "ready", paidReceived: true, paidMethod: "TNG",
      paidAt: "2026-09-16T10:00:00.000Z" }),                                   // another book
    row({ id: "c", status: "confirmed", paidReceived: false, paidMethod: "cash" }), // not collected yet
  ];
  st.expenses = [{ id: "e1", date: "2026-09-16", amount: 18, category: "Packaging", method: "cash" }];
  st.deposits = [{ id: "d1", date: "2026-09-15", amount: 100, method: "cash", note: "float" }];

  const j = journalFor(st, "cash", "2026-09-15", "2026-09-16");
  assert.equal(j.inTotal, 130, "RM30 of orders + RM100 of her own");
  assert.equal(j.outTotal, 18);
  assert.equal(j.net, 112, "what the purse should hold for this stretch");
  assert.deepEqual(j.rows.map((r) => r.date), ["2026-09-15", "2026-09-16", "2026-09-16"], "in date order");
  assert.match(j.rows[0].what, /Your own money in — float/);
  assert.match(j.rows[1].what, /^Order #[0-9A-F]+ — /, "a customer's payment, with the code to match it back");
  assert.match(j.rows[2].what, /^Packaging/, "and what it was spent on");
});

test("the TNG book is its own, and a loan never appears in either", () => {
  const st = state();
  st.deliveryDates = [{ id: "d18", date: "2026-09-18" }];
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "tng",
    paidAt: "2026-09-16T09:00:00.000Z" })];
  st.expenses = [
    { id: "e1", date: "2026-09-16", amount: 250, category: "Ingredients & shopping", method: "Loan" },
    { id: "e2", date: "2026-09-16", amount: 12, category: "Packaging", method: "TNG" },
  ];
  const tng = journalFor(st, "TNG", "2026-09-01", "2026-09-30");
  assert.equal(tng.inTotal, 15);
  assert.equal(tng.outTotal, 12, "the transfer book has only the transfer");
  assert.equal(tng.rows.length, 2);

  const cash = journalFor(st, "cash", "2026-09-01", "2026-09-30");
  assert.equal(cash.rows.length, 0, "nothing happened in cash");
  const loan = journalFor(st, "Loan", "2026-09-01", "2026-09-30");
  assert.equal(loan.outTotal, 250, "and the loan has its own book, of its own spending");
});

test("the Money screen's figures are doors: tapping one opens its book", () => {
  const today = todayISO();
  const st = state();
  st.deliveryDates = [{ id: "d18", date: today }];
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: `${today}T09:00:00.000Z`, unitPrice: 15 })];
  st.expenses = [{ id: "e1", date: today, amount: 18, category: "Packaging", method: "cash", note: "2 boxes" }];

  const root = document.createElement("div");
  renderMoney(root, st);
  const cashRow = allOf(root).filter((n) => String(n.className).includes("info-row"))
    .find((r) => String(r.children?.[0]?.textContent || "") === "Cash out");
  assert.ok(String(cashRow.className).includes("tappable"), "the figure says it can be opened");
  cashRow._listeners.click.forEach((f) => f());

  const pop = screen["popup-layer"];
  const text = allOf(pop).map((n) => String(n.textContent || "")).join(" ");
  assert.match(text, /Cash journal/, "the book opens");
  assert.match(text, /Packaging — 2 boxes/, "listing every movement, with its note");
  assert.match(text, /Net/, "and ending on what the purse should hold");
});

test("an order marked Paid · TNG counts as TNG, not as unknown (the v106 slip)", () => {
  // The paid buttons write the LIST's label ("TNG"), while orders from before the
  // list existed hold "tng". Comparing against one spelling sent every TNG order
  // into "Paid, no method" — the TNG column read zero with the money in the till.
  for (const method of ["TNG", "tng"]) {
    const st = state();
    st.deliveryDates = [{ id: "d18", date: "2026-09-16" }];
    st.orders = [row({ status: "ready", paidReceived: true, paidMethod: method,
      paidAt: "2026-09-16T09:00:00.000Z" })];
    const m = moneyBetween(st, "2026-09-16", "2026-09-16");
    assert.equal(m.tng, 15, `paid by "${method}" lands in the TNG column`);
    assert.equal(m.unmarked, 0, "and nothing is left unexplained");
  }
});

// ── v111: a book for EVERY way of paying ─────────────────────────────────────
// "each CASH, TNG, LOAN, Personal Pocket Kean, Personal Pocket Suan, and others that
// might be added in future need a journal" (17 Sep 2026). The rows are read off the
// data, not off her list, so a method she adds tomorrow needs no code change — and one
// she has since renamed or taken away still has a line, because its money is still here.
const { otherMethods } = await import("../admin/js/money.js");

test("every non-cash method that moved gets its own line, in her list's order", () => {
  const st = state();
  st.settings.payMethods = ["Cash", "TNG", "Loan", "Personal Pocket Kean", "Personal Pocket Suan"];
  st.deposits = [{ id: "d1", date: "2026-09-16", amount: 100, method: "Personal Pocket Kean" }];
  st.expenses = [
    { id: "e1", date: "2026-09-16", amount: 250, category: "Ingredients & shopping", method: "Loan" },
    { id: "e2", date: "2026-09-16", amount: 40, category: "Packaging", method: "Personal Pocket Suan" },
    { id: "e3", date: "2026-09-16", amount: 18, category: "Packaging", method: "Cash" },
  ];
  const others = otherMethods(st,
    [moneyBetween(st, "2026-09-01", "2026-09-30"), depositsBetween(st, "2026-09-01", "2026-09-30")],
    [expensesBetween(st, "2026-09-01", "2026-09-30")]);

  assert.deepEqual(others.map((o) => o.label), ["Loan", "Personal Pocket Kean", "Personal Pocket Suan"],
    "one line each, in the order of her own list — and cash is not one of them");
  assert.equal(others[0].net, -250, "a loan only ever paid out here");
  assert.equal(others[1].net, 100, "her pocket money put in reads positive");
  assert.equal(others[2].net, -40);
});

test("a method added tomorrow needs no code: the line comes from the rows", () => {
  const st = state();
  st.expenses = [{ id: "e1", date: "2026-09-16", amount: 30, category: "Packaging", method: "Bank OD" }];
  const others = otherMethods(st, [], [expensesBetween(st, "2026-09-01", "2026-09-30")]);
  assert.deepEqual(others.map((o) => o.label), ["Bank OD"], "a label nothing knows about still gets a book");
});

test("a method she renamed keeps its line, so its money is never invisible", () => {
  // The rename rewrote the list; these rows were written before it, and only the rows
  // can say the money is there.
  const st = state();
  st.settings.payMethods = ["Cash", "TNG", "Bank OD"];
  st.expenses = [{ id: "e1", date: "2026-09-16", amount: 250, category: "Ingredients & shopping", method: "Loan" }];
  const others = otherMethods(st, [], [expensesBetween(st, "2026-09-01", "2026-09-30")]);
  assert.deepEqual(others.map((o) => o.label), ["Loan"],
    "an old label sorts after the current list and still shows, rather than vanishing from the books");
});

test("each of those lines opens its own book, listing that method and nothing else", () => {
  const today = todayISO();
  const st = state();
  st.settings.payMethods = ["Cash", "TNG", "Loan", "Personal Pocket Kean"];
  st.deliveryDates = [{ id: "d18", date: today }];
  st.expenses = [
    { id: "e1", date: today, amount: 250, category: "Ingredients & shopping", method: "Loan", note: "flour run" },
    { id: "e2", date: today, amount: 40, category: "Packaging", method: "Personal Pocket Kean", note: "boxes" },
  ];
  const root = document.createElement("div");
  renderMoney(root, st);

  const line = (label) => allOf(root).filter((n) => String(n.className).includes("info-row"))
    .find((r) => String(r.children?.[0]?.textContent || "") === label);
  assert.ok(line("Paid by Loan"), "the loan is named as itself, not lumped into 'other'");
  assert.ok(line("Paid by Personal Pocket Kean"), "and so is her own pocket");
  assert.ok(String(line("Paid by Personal Pocket Kean").className).includes("tappable"));

  line("Paid by Personal Pocket Kean")._listeners.click.forEach((f) => f());
  const text = allOf(screen["popup-layer"]).map((n) => String(n.textContent || "")).join(" ");
  assert.match(text, /Personal Pocket Kean journal/, "its own book opens");
  assert.match(text, /Packaging — boxes/, "with what it paid for");
  assert.match(text, /-?RM 40\.00/, "and ending on what moved that way");
  assert.ok(!text.includes("flour run"), "and nothing from another way of paying");
});

// ── v112: paying a personal pocket back ──────────────────────────────────────
// "can my own withdrawal payback to the cash register like Personal pocket Kean or
// Suan?" (17 Sep 2026). A pocket that paid for something is owed by the till; paying it
// back is two movements — money out of the till, and the pocket's line cleared — so the
// form writes both, and this pins that both land right and nothing counts twice.
const { pocketOwed } = await import("../admin/js/money.js");
const { expensesBetween: spentIn, depositsBetween: putIn } = await import("../admin/js/money.js");

function pocketState() {
  const st = state();
  st.settings.payMethods = ["Cash", "TNG", "Loan", "Personal Pocket Kean"];
  st.settings.categories = [{ label: "Packaging", cls: "expense" }, { label: "My own withdrawal", cls: "drawing" }];
  st.expenses = [{ id: "e1", date: "2026-09-16", amount: 40, category: "Packaging",
    method: "Personal Pocket Kean", note: "boxes" }];
  return st;
}

test("what a pocket is owed is what it paid out, less what of its own went in", () => {
  const st = pocketState();
  assert.equal(pocketOwed(st, "Personal Pocket Kean", "2026-09-01", "2026-09-30"), 40);
  assert.equal(pocketOwed(st, "Personal Pocket Kean", "2026-09-17", "2026-09-30"), 0,
    "a day it did nothing is not owed anything");
  st.deposits = [{ id: "d1", date: "2026-09-16", amount: 15, method: "Personal Pocket Kean" }];
  assert.equal(pocketOwed(st, "Personal Pocket Kean", "2026-09-01", "2026-09-30"), 25,
    "money of its own that went in is not money the till owes it");
  assert.equal(pocketOwed(st, "Cash", "2026-09-01", "2026-09-30"), 0, "and cash is not a pocket");
});

test("Pay back a pocket takes the money out of the till AND clears the pocket, in one go", (t) => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // Saving raises a toast; a real timer would hold the test run open for 2.2s.
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 1; };
  t.after(() => { globalThis.setTimeout = realTimeout; });
  const today = todayISO();
  const st = pocketState();
  st.deliveryDates = [{ id: "d18", date: today }];
  st.expenses[0].date = today;

  const root = document.createElement("div");
  renderMoney(root, st);

  // The button is offered, and only because there is both a pocket and a till.
  const open = allOf(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes("Pay back a pocket"));
  assert.ok(open, "the Money screen offers it beside Put money in");
  open._listeners.click.forEach((f) => f());

  const form = screen["popup-layer"];
  const inForm = (label) => allOf(form).find((n) => n.attrs && n.attrs["aria-label"] === label);
  const amount = inForm("How much you are paying back");
  assert.equal(amount.value, "40", "opened on the pocket that is owed, pre-filled with what it is owed");
  assert.ok(allOf(form).some((n) => n.textContent.includes("is owed RM 40.00")),
    "and it says so, in her own figures");

  amount.value = "25"; // she pays part of it back
  const press = (text) => allOf(form).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === text);
  press("Pay back")._listeners.click.forEach((f) => f());

  // Two rows, no third: out of the till, and into the pocket's line.
  const added = st.expenses.filter((e) => e.id !== "e1");
  assert.equal(added.length, 1, "one expense, not two");
  assert.equal(added[0].amount, 25);
  assert.equal(added[0].category, "My own withdrawal", "her own money going back to her");
  assert.equal(added[0].method, "Cash", "and it came out of the till");
  assert.equal(st.deposits.length, 1);
  assert.equal(st.deposits[0].method, "Personal Pocket Kean", "the pocket is told it was paid");
  assert.equal(st.deposits[0].repay, true, "marked as a payback, not money she put in");
  assert.equal(pocketOwed(st, "Personal Pocket Kean", today, today), 15, "so it is owed 15 now, not 40");

  // And the money-in card names it for what it is, not as money she put in.
  const rows = allOf(root)
    .filter((n) => String(n.className).includes("info-row"))
    .map((r) => r.textContent.replace(/\s+/g, " ").trim());
  assert.ok(rows.some((r) => r.includes("Paid back by the till")),
    "the pocket's own list says it was paid back");
  assert.ok(!rows.some((r) => r.includes("From my pocket")), "and does not call it money she put in");
});

test("the payback lowers the till and the pocket line, and leaves profit alone", () => {
  const st = pocketState();
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash", unitPrice: 15 })];
  st.deliveryDates = [{ id: "d18", date: "2026-09-16" }];
  st.orders[0].paidAt = "2026-09-16T09:00:00.000Z";
  // What she would have by hand: the two entries this form writes.
  st.expenses.push({ id: "e2", date: "2026-09-16", amount: 40, category: "My own withdrawal", method: "Cash" });
  st.deposits = [{ id: "d2", date: "2026-09-16", amount: 40, method: "Personal Pocket Kean", repay: true }];

  const m = moneyBetween(st, "2026-09-16", "2026-09-16");
  const out = spentIn(st, "2026-09-16", "2026-09-16");
  const mine = putIn(st, "2026-09-16", "2026-09-16");
  assert.equal(m.cash, 15);
  assert.equal(out.cash, 40, "the till really did give up the RM 40");
  assert.equal(m.cash + mine.cash + mine.tng - out.cash - out.tng, -25, "so the purse is 25 down");
  assert.equal(mine.cash, 0, "and none of it counts as money she put in");

  const others = otherMethods(st, [m, mine], [out]);
  assert.deepEqual(others.map((o) => `${o.label}=${o.net}`), ["Personal Pocket Kean=0"],
    "the pocket's line is settled — the till owes it nothing now");
  assert.equal(m.other + mine.other - out.other, 0, "and it was never in the till's own figures");
});

test("the payback reads as a payback in both books, not as money she put in", () => {
  const st = pocketState();
  st.deposits = [{ id: "d2", date: "2026-09-16", amount: 40, method: "Personal Pocket Kean", repay: true }];
  const pocket = journalFor(st, "Personal Pocket Kean", "2026-09-01", "2026-09-30");
  assert.match(pocket.rows.find((r) => r.date === "2026-09-16" && r.dir === "in").what,
    /Paid back to this pocket/, "the pocket's book says what happened");
  const cash = journalFor(st, "Cash", "2026-09-01", "2026-09-30");
  assert.equal(cash.outTotal, 0, "and the till's book has nothing from this pocket");
});

// ── v113: a book for every way of paying, however quiet ──────────────────────
// "where can i find pocket journals" (17 Sep 2026). The money card's pocket rows are read
// off what MOVED, so a pocket that did nothing in the stretch has no row there and no way
// into its book. The Books door is always there.
test("the Books door opens every method she has, even one that did nothing", () => {
  const today = todayISO();
  const st = state();
  st.settings.payMethods = ["Cash", "TNG", "Loan", "Personal Pocket Kean"];
  st.deliveryDates = [{ id: "d18", date: today }];
  // Kean's pocket moved nothing at all in this stretch.
  st.orders = [row({ status: "ready", paidReceived: true, paidMethod: "cash",
    paidAt: `${today}T09:00:00.000Z`, unitPrice: 15 })];

  const root = document.createElement("div");
  renderMoney(root, st);
  const open = allOf(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "Open");
  assert.ok(open, "the Money screen has a Books door");
  open._listeners.click.forEach((f) => f());

  const form = screen["popup-layer"];
  const lines = allOf(form).filter((n) => String(n.className).includes("info-row"));
  const named = lines.map((r) => r.children[0].textContent);
  for (const m of ["Cash", "TNG", "Loan", "Personal Pocket Kean"]) {
    assert.ok(named.includes(m), `${m} has a line, whether or not it moved this stretch`);
  }
  assert.match(lines.find((r) => r.children[0].textContent === "Cash").children[1].textContent, /RM 15\.00/,
    "with what moved by it in the stretch");
  assert.ok(!allOf(form).some((n) => n.nodeType === 3 && n.text === "null"),
    "no stray 'null' on the screen: replaceChildren prints one where el() would skip it");

  // It opens a quiet pocket's book IN PLACE — a pop-up from a pop-up would wipe the list.
  const kean = lines.find((r) => r.children[0].textContent === "Personal Pocket Kean");
  kean._listeners.click.forEach((f) => f());
  const after = allOf(screen["popup-layer"]);
  assert.ok(after.some((n) => n.textContent.includes("Nothing moved this way in this stretch")),
    "her quiet pocket's book opens and says so plainly");
  assert.ok(after.filter((n) => String(n.className).includes("info-row"))
    .some((r) => r.children[0].textContent === "Cash"),
    "and the rest of the list is still there behind it");
});

test("a method she took off the list still has a book, because its money is still in", () => {
  const today = todayISO();
  const st = state();
  st.settings.payMethods = ["Cash", "TNG"]; // no pockets on the list at all now
  st.expenses = [{ id: "e1", date: today, amount: 250, category: "Ingredients & shopping",
    method: "Personal Pocket Kean", note: "flour run" }];

  const root = document.createElement("div");
  renderMoney(root, st);
  allOf(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "Open")
    ._listeners.click.forEach((f) => f());
  const form = screen["popup-layer"];
  const kean = allOf(form).filter((n) => String(n.className).includes("info-row"))
    .find((r) => r.children[0].textContent === "Personal Pocket Kean");
  assert.ok(kean, "the old label still gets a line — it would otherwise be money she cannot see");
  assert.match(kean.children[1].textContent, /RM -250\.00/);
});
