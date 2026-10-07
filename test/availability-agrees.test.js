// test/availability-agrees.test.js — the shop and the app say the SAME number.
//
// Her report, 7 Oct 2026, verbatim: __"the 9th at store show qty and the app shown qty are
// different"__ — and she was right. A day's booked count was worked out **three times**:
//
//   · `computeSlots` (what the shop publishes as "N left"),
//   · `capacityStatus` (the Orders calendar's chip), and
//   · `deliveries.js`'s date card,
//
// and two of the three were wrong in the same direction, so the shop showed a day fuller than
// the app did:
//
//   1. `capacityStatus` read `explodeBom().totalUnits`, which was written for COSTING — **it
//      skips an order whose product is gone, or whose product carries no `recipe` array** — so
//      a day with a real order on it drew as `0/12`.
//   2. Both by-id sums counted ONE delivery-date record, while the shop sums every record
//      carrying that date — so two records sharing a day disagreed with the cell she tapped.
//
// The capacity half was always one computation (`effectiveCapacity`); this file is the other
// half. Each shape below is one that used to disagree. **An order is work she has to do that
// day: it counts, whoever it is for.**

import { test } from "node:test";
import assert from "node:assert/strict";

import { bookedUnitsOnDate, effectiveCapacity, capacityStatus } from "../admin/js/bom.js";
import { computeSlots } from "../admin/js/supabase.js";

const DATE = "2026-10-09"; // "the 9th" of her report

function state({ products, deliveryDates, orders, defaultCapacity = 12 }) {
  return {
    version: 1,
    settings: { defaultCapacity, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
    products,
    ingredients: [],
    deliveryDates,
    orders,
    purchaseOrders: [],
  };
}

const oneDate = () => [{ id: "del_9", date: DATE }];
const jerky = (over = {}) => ({ id: "prd_1", name: "Chicken Jerky", active: true, limit: 12, recipe: [], ...over });

// The two numbers she compa: what the shop would publish, and what the app's chip says.
function bothNumbers(st) {
  const shop = computeSlots(st, 30).find((r) => r.date === DATE);
  const chip = capacityStatus(st, "del_9");
  return { shopLeft: shop ? shop.slots_left : null, chipBooked: chip.total, chipLeft: chip.remaining, capacity: chip.capacity };
}

function agrees(label, st, { booked, capacity }) {
  const n = bothNumbers(st);
  assert.equal(n.capacity, capacity, `${label}: the day's capacity`);
  assert.equal(n.chipBooked, booked, `${label}: the app's chip counts this many booked`);
  assert.equal(n.shopLeft, capacity - booked, `${label}: the shop publishes ${capacity - booked} left`);
  assert.equal(n.chipLeft, capacity - booked, `${label}: and the chip agrees`);
  // And the one function both read agrees with them.
  assert.equal(bookedUnitsOnDate(st, DATE), booked, `${label}: bookedUnitsOnDate is the one answer`);
}

test("★ a plain order: the shop and the chip already agreed, and still do", () => {
  agrees("plain", state({
    products: [jerky()], deliveryDates: oneDate(),
    orders: [{ id: "o1", deliveryDateId: "del_9", productId: "prd_1", qty: 3 }],
  }), { booked: 3, capacity: 12 });
});

test("★ an order for a product whose RECIPE WAS NEVER FILLED IN still counts", () => {
  // The costing path skips a product with no `recipe` array, and the chip was reading it. A
  // day with a real order on it drew as 0/12 while the shop correctly showed it booked.
  agrees("no recipe", state({
    products: [jerky({ recipe: undefined })], deliveryDates: oneDate(),
    orders: [{ id: "o1", deliveryDateId: "del_9", productId: "prd_1", qty: 3 }],
  }), { booked: 3, capacity: 12 });
});

test("★ an order for a DELETED product still counts — she still has to make it", () => {
  agrees("deleted product", state({
    products: [jerky()], deliveryDates: oneDate(),
    orders: [{ id: "o1", deliveryDateId: "del_9", productId: "prd_gone", qty: 5 }],
  }), { booked: 5, capacity: 12 });
});

test("★ two delivery-date records sharing one day are ONE day's load", () => {
  agrees("duplicate ids", state({
    products: [jerky()],
    deliveryDates: [{ id: "del_9", date: DATE }, { id: "del_9b", date: DATE }],
    orders: [
      { id: "o1", deliveryDateId: "del_9", productId: "prd_1", qty: 3 },
      { id: "o2", deliveryDateId: "del_9b", productId: "prd_1", qty: 4 },
    ],
  }), { booked: 7, capacity: 12 });
});

test("the ONE sanctioned difference: the shop never publishes a negative", () => {
  // Over-booked (she took more than the day's capacity by hand): the chip goes negative and
  // says so, because that is information she needs. The shop clamps at 0 — a customer cannot
  // be shown minus two places left.
  const st = state({
    products: [jerky({ limit: 4 })], deliveryDates: oneDate(),
    orders: [{ id: "o1", deliveryDateId: "del_9", productId: "prd_1", qty: 6 }],
  });
  const n = bothNumbers(st);
  assert.equal(n.chipBooked, 6, "the chip counts what is really booked");
  assert.equal(n.chipLeft, -2, "and says the day is over");
  assert.equal(n.shopLeft, 0, "the shop publishes nothing left, never a negative");
});

test("a day with nothing on it is untouched: the default capacity, all of it free", () => {
  agrees("empty", state({
    products: [jerky()], deliveryDates: oneDate(), orders: [],
  }), { booked: 0, capacity: 12 });
});

test("with no limited product on sale, the day falls back to the default capacity", () => {
  agrees("fallback", state({
    products: [{ id: "prd_1", name: "Chicken Jerky", active: true, recipe: [] }],
    deliveryDates: oneDate(),
    orders: [{ id: "o1", deliveryDateId: "del_9", productId: "prd_1", qty: 2 }],
  }), { booked: 2, capacity: 12 });
});
