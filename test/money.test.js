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
