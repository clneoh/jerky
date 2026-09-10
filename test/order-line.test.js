// test/order-line.test.js — Engine v70: an order remembers what it was sold as
// and what it was sold for. Renaming or repricing a product must not rewrite
// past orders — not in the list, not in the customer's WhatsApp messages, and
// not on the customer's own tracking page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLineName, orderLinePrice, stampOrderLine } from "../admin/js/state.js";
import { groupOrders } from "../admin/js/state.js";
import { buildConfirmation } from "../admin/js/confirm.js";
import { buildPaymentReminder } from "../admin/js/messages.js";
import { trackingSnapshot } from "../admin/js/supabase.js";
import { customerList } from "../admin/js/customers.js";
import { weekStats } from "../admin/js/weekly.js";

// A product row, then the same row renamed and repriced — the baker's edit.
const FOCACCIA = { id: "p1", name: "Rosemary Focaccia", price: 15, active: true };
const RENAMED = { id: "p1", name: "Sea Salt Focaccia", price: 22, active: true };

// A minimum viable state for the pure consumers.
function makeState(over = {}) {
  return {
    products: [FOCACCIA],
    orders: [],
    deliveryDates: [{ id: "d1", date: "2026-09-19" }],
    customers: [],
    settings: { currency: "RM", storefront: { name: "Munchies Furkidz", tngQr: "" } },
    ...over,
  };
}

// An order as it is now written: a frozen record of the sale.
function soldOrder(over = {}) {
  return {
    id: "o1",
    deliveryDateId: "d1",
    deliveryDate: "2026-09-19",
    orderDate: "2026-09-10",
    productId: "p1",
    qty: 2,
    customerName: "Mei",
    whatsapp: "60123456789",
    status: "new",
    createdAt: "2026-09-10T02:00:00.000Z",
    ...over,
  };
}

test("stampOrderLine freezes the name and price the line was sold at", () => {
  const o = {};
  stampOrderLine(o, FOCACCIA);
  assert.equal(o.productName, "Rosemary Focaccia");
  assert.equal(o.unitPrice, 15);
});

test("stampOrderLine accepts a storefront line (its own name/price) and ignores a missing product", () => {
  const o = {};
  stampOrderLine(o, { name: "Basil Loaf", price: 18 });
  assert.equal(o.productName, "Basil Loaf");
  assert.equal(o.unitPrice, 18);
  const untouched = { productName: "keep me" };
  stampOrderLine(untouched, null);
  assert.deepEqual(untouched, { productName: "keep me" });
});

test("stampOrderLine leaves a blank name or an absent price off rather than writing a guess", () => {
  const o = {};
  stampOrderLine(o, { name: "   ", price: null });
  assert.equal(o.productName, undefined);
  assert.equal(o.unitPrice, undefined);
});

test("orderLineName prefers the frozen name; a legacy order falls back to the live product", () => {
  const state = makeState({ products: [RENAMED] });
  assert.equal(orderLineName(state, soldOrder({ productName: "Rosemary Focaccia" })), "Rosemary Focaccia");
  assert.equal(orderLineName(state, soldOrder()), "Sea Salt Focaccia");
});

test("orderLineName names a product that has since been deleted", () => {
  const state = makeState({ products: [] });
  assert.equal(orderLineName(state, soldOrder({ productName: "Rosemary Focaccia" })), "Rosemary Focaccia");
  assert.equal(orderLineName(state, soldOrder()), "(deleted product)");
});

test("orderLinePrice prefers the frozen price; a legacy order falls back to the live product", () => {
  const state = makeState({ products: [RENAMED] });
  assert.equal(orderLinePrice(state, soldOrder({ unitPrice: 15 })), 15);
  assert.equal(orderLinePrice(state, soldOrder()), 22);
});

test("orderLinePrice returns null (not 0) when nothing is known, so 'free' and 'unknown' differ", () => {
  const state = makeState({ products: [] });
  assert.equal(orderLinePrice(state, soldOrder()), null);
  assert.equal(orderLinePrice(state, soldOrder({ unitPrice: 0 })), 0);
});

test("a price is frozen as a number, so a string price from the shop is quoted correctly", () => {
  const state = makeState({ products: [RENAMED] });
  assert.equal(orderLinePrice(state, soldOrder({ unitPrice: "15" })), 15);
});

test("repricing and renaming a product does not move an existing order", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA); // sold at the old name & price
  state.orders = [o];
  assert.equal(orderLineName(state, o), "Rosemary Focaccia");
  assert.equal(orderLinePrice(state, o), 15);
});

test("the WhatsApp confirmation quotes the price the order was sold at", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA);
  const group = { orders: [o] };
  const { message } = buildConfirmation(state, group, "https://bake.app/store/?track=ABC");
  assert.match(message, /Items: Rosemary Focaccia x2/);
  assert.match(message, /Total: RM 30.00/);
});

test("the payment reminder quotes the sold price too", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA);
  const { message } = buildPaymentReminder(state, { orders: [o] }, "https://x");
  assert.match(message, /Total: RM 30.00/);
});

test("the customer's tracking page shows what they bought, at the price they paid", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA);
  const snap = trackingSnapshot(state, { orders: [o] });
  assert.equal(snap.items, "Rosemary Focaccia ×2");
  assert.equal(snap.total, "RM 30.00");
});

test("lifetime spend uses the sold price, not today's menu", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA);
  state.orders = [o];
  const rows = customerList(state, "recent", "all", "2026-09-10");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalSpend, 30);
});

test("the Home 'this week' sell value uses the sold price", () => {
  const state = makeState({ products: [RENAMED] });
  const o = soldOrder();
  stampOrderLine(o, FOCACCIA);
  state.orders = [o];
  const stats = weekStats(state, { today: "2026-09-10" });
  assert.equal(stats.rm, 30);
  assert.equal(stats.unpriced, false);
});

test("a legacy order with no snapshot still counts — at the live price — and flags unpriced only when nothing is known", () => {
  const live = makeState({ products: [RENAMED] });
  live.orders = [soldOrder()];
  assert.equal(weekStats(live, { today: "2026-09-10" }).rm, 44);

  const gone = makeState({ products: [] });
  gone.orders = [soldOrder()];
  const stats = weekStats(gone, { today: "2026-09-10" });
  assert.equal(stats.rm, 0);
  assert.equal(stats.unpriced, true);
});

test("a multi-item group is named per line — each item keeps its own sold name", () => {
  const state = makeState({
    products: [RENAMED, { id: "p2", name: "Pesto", price: 8, active: true }],
  });
  const a = soldOrder({ groupId: "g1" });
  stampOrderLine(a, FOCACCIA);
  const b = soldOrder({ id: "o2", groupId: "g1", productId: "p2", qty: 1, productName: "Pesto", unitPrice: 8 });
  state.orders = [a, b];
  const snap = trackingSnapshot(state, { orders: groupOrders(state.orders)[0].orders });
  assert.equal(snap.items, "Rosemary Focaccia ×2, Pesto ×1");
  assert.equal(snap.total, "RM 38.00");
});
