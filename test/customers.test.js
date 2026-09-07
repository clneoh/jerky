// test/customers.test.js — customer / marketing list aggregation.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { customerList, deliveryDateOf, orderDateOf, ordersForCustomer } from "../admin/js/customers.js";
import { orderCode } from "../admin/js/state.js";

function state(orders, deliveryDates = [], products = []) {
  return { orders, deliveryDates, products };
}

test("customerList aggregates by WhatsApp number and sums units", () => {
  const st = state([
    { id: "o1", deliveryDateId: "d1", qty: 3, customerName: "Aunty Bee", whatsapp: "6012-111", deliveryDate: "2026-09-07", orderDate: "2026-09-05" },
    { id: "o2", deliveryDateId: "d2", qty: 2, customerName: "Aunty Bee", whatsapp: "6012-111", deliveryDate: "2026-09-09", orderDate: "2026-09-07" },
    { id: "o3", deliveryDateId: "d3", qty: 1, customerName: "Mr Lim", whatsapp: "6013-222", deliveryDate: "2026-09-11", orderDate: "2026-09-10" },
  ]);
  const rows = customerList(st);
  assert.equal(rows.length, 2);
  const bee = rows.find((r) => r.whatsapp === "6012-111");
  assert.equal(bee.orders, 2);
  assert.equal(bee.units, 5);
  assert.equal(bee.last, "2026-09-09");
  assert.equal(bee.lastOrdered, "2026-09-07");
  assert.equal(rows[0].last, "2026-09-11"); // most recent delivery first
});

test("same WhatsApp under a different name is still one customer", () => {
  const st = state([
    { id: "o1", deliveryDateId: "d1", qty: 1, customerName: "Bee", whatsapp: "6012-111", deliveryDate: "2026-09-07" },
    { id: "o2", deliveryDateId: "d2", qty: 2, customerName: "Aunty Bee", whatsapp: "6012-111", deliveryDate: "2026-09-09" },
  ]);
  const rows = customerList(st);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orders, 2);
  assert.equal(rows[0].units, 3);
});

test("orders without a WhatsApp number still appear, keyed by name", () => {
  const st = state([
    { id: "o1", deliveryDateId: "d1", qty: 2, customerName: "Cash walk-in", deliveryDate: "2026-09-07" },
    { id: "o2", deliveryDateId: "d1", qty: 1, customerName: "Cash walk-in", deliveryDate: "2026-09-07" },
  ]);
  const rows = customerList(st);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orders, 2);
  assert.equal(rows[0].whatsapp, "");
});

test("deliveryDateOf resolves a deleted date via the snapshotted deliveryDate", () => {
  const st = state(
    [{ id: "o1", deliveryDateId: "gone", qty: 1, customerName: "X", deliveryDate: "2026-08-31" }],
    [], // the date was deleted; only the snapshot remains
  );
  assert.equal(deliveryDateOf(st, st.orders[0]), "2026-08-31");
});

test("deliveryDateOf falls back to resolving the delivery date by id", () => {
  const st = state(
    [{ id: "o1", deliveryDateId: "d1", qty: 1, customerName: "X" }],
    [{ id: "d1", date: "2026-09-14" }],
  );
  assert.equal(deliveryDateOf(st, st.orders[0]), "2026-09-14");
});

test("orderDateOf uses the snapshot, else the createdAt date", () => {
  assert.equal(orderDateOf({ orderDate: "2026-09-05", createdAt: "2026-09-05T10:00:00.000Z" }), "2026-09-05");
  assert.equal(orderDateOf({ createdAt: "2026-09-05T10:00:00.000Z" }), "2026-09-05");
  assert.equal(orderDateOf({}), "");
});

test("multi-item storefront orders (shared groupId) count as ONE order", () => {
  const st = state([
    { id: "o1", groupId: "g1", qty: 2, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
    { id: "o2", groupId: "g1", qty: 3, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
  ]);
  const [r] = customerList(st);
  assert.equal(r.orders, 1);
  assert.equal(r.units, 5);
});

test("rows carry an approx total spend and a favourite product (top total qty)", () => {
  const products = [
    { id: "p1", name: "Sourdough", price: 12 },
    { id: "p2", name: "Cookies", price: 8 },
  ];
  const st = state([
    { id: "o1", groupId: "g1", qty: 2, productId: "p1", customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
    { id: "o2", groupId: "g1", qty: 3, productId: "p2", customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
    { id: "o3", groupId: "g2", qty: 2, productId: "p1", customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-08" },
  ], [], products);
  const [r] = customerList(st);
  assert.equal(r.orders, 2);
  assert.equal(r.totalSpend, 12 * 4 + 8 * 3); // 72
  assert.equal(r.fav, "Sourdough"); // 4 units vs Cookies' 3
});

test("deleted products don't break spend or the favourite", () => {
  const st = state([
    { id: "o1", groupId: "g1", qty: 2, productId: "pGONE", customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
    { id: "o2", groupId: "g1", qty: 3, productId: "p2", customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-01" },
  ], [], [{ id: "p2", name: "Cookies", price: 8 }]);
  const [r] = customerList(st);
  assert.equal(r.totalSpend, 24);
  assert.equal(r.fav, "Cookies");
});

test("who-filters: all, phone, recent30, gone30 (relative to a 30-day cutoff)", () => {
  const st = state([
    { id: "o1", qty: 1, customerName: "Old Nia", whatsapp: "6012-111", orderDate: "2026-08-01" },
    { id: "o2", qty: 1, customerName: "Recent Bo", whatsapp: "6013-222", orderDate: "2026-09-05" },
    { id: "o3", qty: 1, customerName: "Walk-in", whatsapp: "", orderDate: "2026-09-05" },
  ]);
  assert.equal(customerList(st).length, 3); // all
  assert.deepEqual(customerList(st, "recent", "phone").map((r) => r.name).sort(), ["Old Nia", "Recent Bo"]);
  assert.deepEqual(customerList(st, "recent", "recent30", "2026-09-10").map((r) => r.name).sort(), ["Recent Bo", "Walk-in"]);
  assert.deepEqual(customerList(st, "recent", "gone30", "2026-09-10").map((r) => r.name), ["Old Nia"]);
  assert.equal(customerList(st, "recent", "recent30", "").length, 3); // no date given → like "all"
});

test("ordersForCustomer returns one block per storefront order, newest-placed first", () => {
  const st = state([
    { id: "ord1", groupId: "gA", productId: "p1", qty: 2, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-08-20", deliveryDate: "2026-08-22" },
    { id: "ord2", groupId: "gA", productId: "p2", qty: 3, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-08-20", deliveryDate: "2026-08-22" },
    { id: "ord3", groupId: "gB", productId: "p1", qty: 1, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-09-02", deliveryDate: "2026-09-04" },
    { id: "ord4", productId: "p2", qty: 4, customerName: "Bee", whatsapp: "6012-111", orderDate: "2026-08-25", deliveryDate: "2026-08-27" },
  ]);
  const row = customerList(st)[0];
  assert.equal(row.orders, 3); // two storefront groups + one single manual order
  const blocks = ordersForCustomer(st, row);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.orderDate), ["2026-09-02", "2026-08-25", "2026-08-20"]);
  assert.equal(blocks[2].lines.length, 2); // gA keeps both its items together
  assert.equal(blocks[2].code, orderCode({ groupId: "gA" }));
});

test("customerList supports sorting by name, orders, units, phone", () => {
  const st = state([
    { id: "o1", qty: 3, customerName: "Ali", whatsapp: "6012-000", deliveryDate: "2026-09-09", orderDate: "2026-09-08" },
    { id: "o2", qty: 2, customerName: "Ali", whatsapp: "6012-000", deliveryDate: "2026-09-09", orderDate: "2026-09-08" },
    { id: "o3", qty: 2, customerName: "Bee", whatsapp: "6013-000", deliveryDate: "2026-09-08", orderDate: "2026-09-06" },
    { id: "o4", qty: 1, customerName: "Zoe", whatsapp: "", deliveryDate: "2026-09-07", orderDate: "2026-09-07" },
  ]);
  assert.equal(customerList(st, "name").map((r) => r.name).join(","), "Ali,Bee,Zoe");
  assert.equal(customerList(st, "orders")[0].name, "Ali"); // 2 orders
  assert.equal(customerList(st, "units")[0].name, "Ali");  // 5 units
  assert.equal(customerList(st, "phone")[2].name, "Zoe");  // no phone last
  assert.equal(customerList(st, "recent")[0].name, "Ali"); // ordered most recently (09-08)
});
