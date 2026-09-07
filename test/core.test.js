// test/core.test.js — unit tests for the pure modules.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert";
import { explodeBom, capacityStatus, productRemaining } from "../admin/js/bom.js";
import {
  cutoffTimestamp,
  deliveryStatus,
  fmtPlaced,
  generateUpcomingDates,
  shortDate,
  todayISO,
} from "../admin/js/dates.js";

function fixtureState() {
  return {
    settings: { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
    ingredients: [
      { id: "ing_f", name: "Strong flour", unit: "g", costPerUnit: 0.006 },
      { id: "ing_y", name: "Instant yeast", unit: "g", costPerUnit: 0.05 },
      { id: "ing_s", name: "Fine salt", unit: "g", costPerUnit: 0.004 },
    ],
    products: [
      { id: "prd_f", name: "Focaccia", recipe: [
        { ingredientId: "ing_f", qty: 500, unit: "g" },
        { ingredientId: "ing_y", qty: 5, unit: "g" },
        { ingredientId: "ing_s", qty: 10, unit: "g" },
      ] },
      { id: "prd_s", name: "Sandwich", recipe: [
        { ingredientId: "ing_f", qty: 250, unit: "g" },
        { ingredientId: "ing_y", qty: 3, unit: "g" },
        { ingredientId: "ing_s", qty: 4, unit: "g" },
      ] },
    ],
    deliveryDates: [{ id: "del_a", date: "2026-09-07", notes: "" }],
    orders: [
      { id: "ord_1", deliveryDateId: "del_a", productId: "prd_f", qty: 3 },
      { id: "ord_2", deliveryDateId: "del_a", productId: "prd_s", qty: 2 },
    ],
    purchaseOrders: [],
  };
}

test("BOM explosion sums across products", () => {
  const bom = explodeBom(fixtureState(), "del_a");
  assert.equal(bom.totalUnits, 5);

  const flour = bom.items.find((i) => i.ingredientId === "ing_f");
  assert.equal(flour.totalQty, 3 * 500 + 2 * 250); // 2000
  assert.equal(flour.estCost, 12.0);

  const yeast = bom.items.find((i) => i.ingredientId === "ing_y");
  assert.equal(yeast.totalQty, 21);
  assert.equal(yeast.estCost, 1.05);

  const salt = bom.items.find((i) => i.ingredientId === "ing_s");
  assert.equal(salt.totalQty, 38);
  assert.equal(salt.estCost, 0.15); // 0.152 rounded to 2dp
});

test("BOM explosion item order is alphabetical", () => {
  const bom = explodeBom(fixtureState(), "del_a");
  const names = bom.items.map((i) => i.ingredientName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("capacity status reflects total vs capacity", () => {
  const st = fixtureState();
  const cap = capacityStatus(st, "del_a");
  assert.equal(cap.total, 5);
  assert.equal(cap.capacity, 12);
  assert.equal(cap.remaining, 7);
  assert.equal(cap.exceeded, false);
});

test("productRemaining reports per-product slots, exclusions, and no-limit products", () => {
  const st = fixtureState();
  st.products[0].limit = 12; // Focaccia
  st.products[1].limit = 12; // Sandwich

  const rF = productRemaining(st, "del_a", "prd_f");
  assert.deepEqual(rF, { limit: 12, booked: 3, remaining: 9 }); // 12 - 3 focaccia ordered
  assert.equal(productRemaining(st, "del_a", "prd_s").remaining, 10); // 12 - 2

  // excluding the order being edited frees its quantity back up
  assert.equal(productRemaining(st, "del_a", "prd_f", "ord_1").remaining, 12);

  // no limit → null (unlimited product); missing product → null
  st.products[1].limit = undefined;
  assert.equal(productRemaining(st, "del_a", "prd_s"), null);
  assert.equal(productRemaining(st, "del_a", "prd_gone"), null);
});

test("missing/deleted product order is skipped with a warning", () => {
  const st = fixtureState();
  st.orders.push({ id: "ord_x", deliveryDateId: "del_a", productId: "prd_gone", qty: 2 });
  const bom = explodeBom(st, "del_a");
  assert.equal(bom.totalUnits, 5); // orphan skipped
  assert.ok(bom.warnings.length === 1);
});

test("cut-off is 6pm the day before", () => {
  const ts = cutoffTimestamp("2026-09-07", { cutoff: "18:00" });
  assert.equal(ts.getDate(), 6);
  assert.equal(ts.getHours(), 18);
});

test("deliveryStatus: future date is open with countdown", () => {
  const now = new Date("2026-09-01T12:00:00");
  const st = deliveryStatus("2026-09-07", { cutoff: "18:00" }, now);
  assert.equal(st.closed, false);
  assert.ok(st.countdown.length > 0);
});

test("deliveryStatus: a date before the cutoff is closed", () => {
  const now = new Date("2026-09-07T19:00:00");
  const st = deliveryStatus("2026-09-07", { cutoff: "18:00" }, now);
  assert.equal(st.closed, true);
});

test("generateUpcomingDates only produces configured weekdays from tomorrow", () => {
  const dates = generateUpcomingDates({ deliveryDays: [1, 3, 5] }, 6, []);
  assert.equal(dates.length, 6);
  for (const d of dates) {
    assert.ok([1, 3, 5].includes(new Date(`${d}T00:00:00`).getDay()));
    assert.ok(d > todayISO());
  }
});

test("generateUpcomingDates skips existing dates", () => {
  const fresh = generateUpcomingDates({ deliveryDays: [1] }, 3, []);
  assert.equal(fresh.length, 3);
  const deduped = generateUpcomingDates({ deliveryDays: [1] }, 3, fresh.slice(0, 1));
  assert.ok(deduped.length >= 2);
  assert.ok(!deduped.includes(fresh[0]));
});

test("shortDate matches the storefront pill format", () => {
  assert.equal(shortDate("2026-09-09"), "Wed, 9 Sep");
  assert.equal(shortDate("2026-10-30"), "Fri, 30 Oct");
});

test("fmtPlaced formats the placed time and falls back to the date", () => {
  assert.equal(fmtPlaced("2026-09-01T14:32:00", "2026-09-01"), "1 Sep · 14:32");
  assert.equal(fmtPlaced("2026-09-01T09:05:00", ""), "1 Sep · 09:05");
  assert.equal(fmtPlaced("", "2026-09-01"), "2026-09-01", "missing timestamp → the order date");
  assert.equal(fmtPlaced("not-a-date", "2026-09-01"), "2026-09-01", "malformed timestamp → the order date");
  assert.equal(fmtPlaced("", ""), "");
});
