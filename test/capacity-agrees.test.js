// test/capacity-agrees.test.js — a day's booked count must not disagree with itself.
//
// ★★ FROM THE MUNCHIES BRIDGE NOTE, 2026-10-07. Her report on that side: __"the 9th at shore
// show qty and the app shown qty are different."__ The cause was **shared code**: a day's booked
// total was computed in more than one place, and one of them read `explodeBom()` — **the COSTING
// path, which SKIPS an order whose product is gone, or whose product carries no `recipe` array.**
//
// ⚠️⚠️ ALL THREE SHAPES BELOW ARE REAL SALES THAT MUST STILL BE COUNTED. A count that quietly
// disagrees with the shop, and goes red nowhere, is worse than no count at all.

import { test } from "node:test";
import assert from "node:assert/strict";

// ⚠️ JERKY'S READER IS `bookedUnitsOnDate(state, DATE)`, NOT `totalUnitsOnDate(state, ID)`. This
// project deleted the by-id counter in the same fix: it counted ONE delivery-date record, while the
// shop sums every record carrying the day — so two records sharing a date disagreed with the cell
// she had tapped. See test/availability-agrees.test.js for that half.
const { capacityStatus, bookedUnitsOnDate, explodeBom } = await import("../admin/js/bom.js");

function state() {
  return {
    settings: { currency: "RM", defaultCapacity: 12 },
    deliveryDates: [{ id: "d18", date: "2026-09-18", capacity: 12 }],
    products: [
      { id: "p1", name: "Focaccia", price: 15, active: true,
        recipe: [{ ingredientId: "i1", qty: 1, unit: "g" }] },
      { id: "p2", name: "No recipe yet", price: 8, active: true }, // ← no recipe array
    ],
    ingredients: [{ id: "i1", name: "Flour", unit: "g", packSize: 1000, packPrice: 5, onHand: 0 }],
    orders: [],
  };
}
const row = (id, productId, qty) =>
  ({ id, deliveryDateId: "d18", deliveryDate: "2026-09-18", productId, qty, status: "new" });

test("★ a day counts EVERY order on it — a deleted product and a recipe-less one included", () => {
  const st = state();
  st.orders = [
    row("a", "p1", 2),    // costable, counted by both paths
    row("b", "p2", 3),    // ⚠️ NO RECIPE — explodeBom skipped this one SILENTLY
    row("c", "gone", 4),  // ⚠️ DELETED PRODUCT — explodeBom warned and skipped it
  ];
  const cs = capacityStatus(st, "d18");
  assert.equal(cs.total, 9, "★ every booked piece is counted: 2 + 3 + 4");
  assert.equal(cs.total, bookedUnitsOnDate(st, "2026-09-18"), "and the day's two readers agree");
  assert.equal(cs.remaining, 3, "12 − 9");
  assert.equal(cs.exceeded, false);
});

test("★★ the day the chip would have called EMPTY while sales sat on it", () => {
  // ⚠️ THE WORST SHAPE, and the one nothing goes red on: every order on the day is uncostable,
  // so the costing path returns 0 and the chip draws an untouched day — while the shop and the
  // slot counts, which read the orders, go on saying it is booked.
  const st = state();
  st.orders = [row("a", "p2", 5), row("b", "gone", 4)];
  const cs = capacityStatus(st, "d18");
  assert.equal(cs.total, 9, "★ NOT zero — the day is not empty");
  assert.equal(cs.remaining, 3);
  assert.equal(cs.ratio > 0, true, "and the day is not drawn as untouched");
});

test("a day over its capacity still says so, and says by how much", () => {
  // The half that would be lost by counting the WRONG way round: an over-booked day must still
  // be flagged, so the guard is not satisfied by simply never warning.
  const st = state();
  st.orders = [row("a", "p1", 13)];
  const cs = capacityStatus(st, "d18");
  assert.equal(cs.total, 13);
  assert.equal(cs.exceeded, true, "13 booked against a capacity of 12");
  assert.equal(cs.remaining, -1);
});

test("★ and the costing path says out loud when it cannot cost a line", () => {
  // ⚠️ THE OTHER HALF OF THE NOTE. Skipping a recipe-less product is RIGHT for costing — there is
  // nothing to explode — but it said NOTHING, so the order vanished from the ingredient totals
  // with no line anywhere. The deleted-product branch beside it has always warned; now this does.
  const st = state();
  st.orders = [row("a", "p2", 3)];
  const bom = explodeBom(st, "d18");
  assert.equal(bom.warnings.length, 1, "one line, and it is about the missing recipe");
  assert.match(bom.warnings[0], /No recipe yet/);
  assert.match(bom.warnings[0], /not costed/);
});
