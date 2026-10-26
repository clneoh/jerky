// test/measure.test.js — "the shop this week": the numbers the customer plan rests on.
//
// ⚠️ THE THREE READINGS THAT MAKE A COUNT LIE, each bitten:
//   1 · a two-row shop order is ONE sale, not two;
//   2 · an order is dated by `orderDateOf` — her calendar day, never a UTC one;
//   3 · "first time" is about the customer's WHOLE history, not about the window.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isoOf, windowEnding, windowNumbers, shopWeek } from "../admin/js/measure.js";

const d = (iso) => new Date(`${iso}T00:00:00`);

// A book shaped the way the app stores it. `days` are her bake days; seats are capacity.
function book({ orders = [], days = [], defaultCapacity = 12 } = {}) {
  return {
    orders,
    deliveryDates: days,
    removedOrders: [],
    settings: { defaultCapacity },
  };
}
const order = (o) => ({
  id: o.id || `ord_${Math.random().toString(16).slice(2)}`,
  groupId: o.groupId,
  qty: o.qty == null ? 1 : o.qty,
  orderDate: o.orderDate,
  deliveryDateId: o.deliveryDateId || "",
  deliveryDate: o.deliveryDate || "",
  customerName: o.customerName || "",
  whatsapp: o.whatsapp || "",
  ...o,
});

test("★★★ a local day, never a UTC one", () => {
  assert.equal(isoOf(d("2026-10-03")), "2026-10-03");
  assert.equal(isoOf(new Date(2026, 9, 3, 23, 30)), "2026-10-03", "★ 11:30pm local is already tomorrow in UTC");
  assert.equal(windowEnding("2026-10-24").from, "2026-10-18", "a 7-day window includes today and the six before");
});

test("★★★ a two-row shop order is ONE sale (v637)", () => {
  const st = book({
    orders: [
      order({ groupId: "g1", orderDate: "2026-10-20", customerName: "Mei", whatsapp: "60123456789", qty: 2 }),
      order({ groupId: "g1", orderDate: "2026-10-20", customerName: "Mei", whatsapp: "60123456789", qty: 1 }),
    ],
  });
  const n = windowNumbers(st, { endIso: "2026-10-24" });
  assert.equal(n.orders, 1, "★ one order with two lines was counted as two orders");
  assert.equal(n.firstTime, 1);
});

test("★★★ first-time is about the customer's whole history (v637)", () => {
  const st = book({
    orders: [
      order({ orderDate: "2026-09-01", customerName: "Aunty Bee", whatsapp: "60111111111" }),
      order({ orderDate: "2026-10-20", customerName: "Aunty Bee", whatsapp: "60111111111" }),
      order({ orderDate: "2026-10-21", customerName: "New Person", whatsapp: "60222222222" }),
      // the same person under a different spelling of the SAME number is still one customer
      order({ orderDate: "2026-10-22", customerName: "Bee", whatsapp: "+60 11-111 1111" }),
    ],
  });
  const n = windowNumbers(st, { endIso: "2026-10-24" });
  assert.equal(n.orders, 3, "★ the window's own orders");
  assert.equal(n.firstTime, 1, "★ a returning customer was counted as new (the number must join the spellings)");
  assert.equal(n.returning, 2);
});

test("★★★ the fill is the BAKE DAYS', not the week's ordering (v637)", () => {
  const st = book({
    days: [
      { id: "d1", date: "2026-10-20", capacity: 10 },
      { id: "d2", date: "2026-10-22", capacity: 10 },
    ],
    orders: [
      order({ orderDate: "2026-10-19", deliveryDateId: "d1", qty: 6 }),
      order({ orderDate: "2026-10-24", deliveryDateId: "d2", qty: 4 }),   // ordered late, still for that day
      order({ orderDate: "2026-10-21", deliveryDateId: "d1", qty: 2 }),
    ],
  });
  const n = windowNumbers(st, { endIso: "2026-10-24" });
  assert.equal(n.sold, 12);
  assert.equal(n.capacity, 20);
  assert.equal(n.fill, 60, "★ the fill followed when things were ordered instead of the days they filled");
});

test("★★ orders with no date, and a week with no capacity, say so rather than guess (v637)", () => {
  const st = book({ orders: [order({ qty: 2 })] });
  const n = windowNumbers(st, { endIso: "2026-10-24" });
  assert.equal(n.orders, 0, "an order with no placed date was counted in a week it may not belong to");
  assert.equal(n.fill, null, "★ a percentage was invented for a week with no bake day");
});

test("★★★ the week is read as a PAIR — two windows, one behind the other (v637)", () => {
  const st = book({
    orders: [
      order({ orderDate: "2026-10-24", customerName: "A", whatsapp: "601" }),
      order({ orderDate: "2026-10-24", customerName: "B", whatsapp: "602" }),
      order({ orderDate: "2026-10-15", customerName: "C", whatsapp: "603" }),
    ],
  });
  const { now, prev } = shopWeek(st, { endIso: "2026-10-24" });
  assert.equal(now.orders, 2);
  assert.equal(prev.orders, 1, "★ the week before is not a separate window — the pair cannot be read");
});
