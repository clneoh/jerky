// test/ingredient-price.test.js — the price write-back and the price log (v285).
//
// Her words: *"ingredient price journaled, ingredient price updated accordingly. So an
// ingredient need a journals."* The two halves are tested here together, because the fault
// that matters is the one where they disagree: a journal entry with no price written back is a
// screen telling her something the app does not believe.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { recordPriceMove, logPriceMoves, priceLogOf, PRICE_LOG_CAP } from "../admin/js/prices.js";

function ing(over = {}) {
  return {
    id: "ing_f",
    name: "Strong flour",
    supplierPrices: [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 }],
    ...over,
  };
}

const move = (over = {}) => ({
  supplierId: "s_mydin", supplierName: "Mydin", qty: 4000, uomId: "g", uomName: "g",
  price: 27.5, poId: "po_1", source: "po", ...over,
});

test("a moved price is written onto the ingredient and recorded as a movement", () => {
  const i = ing();
  const out = recordPriceMove(i, move());
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(out.was, 25);
  assert.equal(out.now, 27.5);
  assert.equal(i.supplierPrices[0].price, 27.5, "the ingredient itself now costs the new price");
  assert.equal(priceLogOf(i).length, 1, "and the movement is on the record");
  const entry = priceLogOf(i)[0];
  assert.equal(entry.was, 25);
  assert.equal(entry.price, 27.5);
  assert.equal(entry.supplierName, "Mydin");
  assert.equal(entry.poId, "po_1", "so the journal can say which shopping trip moved it");
});

test("the same price again is not a movement, so nothing is logged", () => {
  const i = ing();
  const out = recordPriceMove(i, move({ price: 25 }));
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
  assert.equal(priceLogOf(i).length, 0, "buying it again at the same price is stock, not news");
});

test("a price for a DIFFERENT pack of the same supplier is refused, not silently added", () => {
  // chosenSupplier buys whichever pack is cheapest per base unit. Adding a second entry here
  // would quietly move her costing to a pack she is no longer buying, so this returns a
  // question instead of an answer.
  const i = ing();
  const out = recordPriceMove(i, move({ qty: 10000 }));
  assert.equal(out.ok, false);
  assert.equal(out.reason, "packChanged");
  assert.equal(i.supplierPrices.length, 1, "nothing was added");
  assert.equal(i.supplierPrices[0].price, 25, "and nothing was overwritten");
  assert.equal(priceLogOf(i).length, 0, "and nothing was logged as though it had happened");
});

test("once she has said the pack changed, that entry is rewritten in place", () => {
  const i = ing();
  const out = recordPriceMove(i, move({ qty: 10000, price: 60 }), { replace: true });
  assert.equal(out.ok, true);
  assert.equal(i.supplierPrices.length, 1, "still ONE entry for this supplier, not two");
  assert.equal(i.supplierPrices[0].qty, 10000);
  assert.equal(i.supplierPrices[0].price, 60);
  assert.equal(priceLogOf(i)[0].was, 25, "the movement still records what it was before");
});

test("a supplier this ingredient has never bought from is a new arrangement, not a correction", () => {
  const i = ing();
  const out = recordPriceMove(i, move({ supplierId: "s_yen", supplierName: "Yen Grocer", price: 22 }));
  assert.equal(out.ok, true);
  assert.equal(out.was, null, "there is no old price to report");
  assert.equal(i.supplierPrices.length, 2, "the new supplier joins the list");
  const entry = priceLogOf(i)[0];
  assert.equal(entry.was, null);
  assert.equal(entry.supplierName, "Yen Grocer");
});

test("a nonsense price is refused rather than written", () => {
  const i = ing();
  for (const bad of [Number.NaN, -1, "abc"]) {
    const out = recordPriceMove(i, move({ price: bad }));
    assert.equal(out.ok, false, `${bad} must not be written`);
  }
  assert.equal(i.supplierPrices[0].price, 25, "the ingredient is untouched");
  assert.equal(priceLogOf(i).length, 0);
});

test("a price corrected by hand on the ingredient screen is logged too", () => {
  // Without this the journal would be titled as this ingredient's price history while only
  // ever holding the moves that came through a shopping list.
  const before = [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 }];
  const i = ing({ supplierPrices: [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 31 }] });
  const moved = logPriceMoves(i, before);
  assert.equal(moved.length, 1);
  assert.equal(priceLogOf(i)[0].was, 25);
  assert.equal(priceLogOf(i)[0].price, 31);
  assert.equal(priceLogOf(i)[0].source, "edit", "and it says where the change came from");
});

test("★★★ a changed PACK SIZE still records the old price (v583)", () => {
  // ⚠️⚠️ MEASURED: the old row was matched by supplier AND qty, so "3 kg for RM27.50" edited to "5 kg for
  // RM30" matched nothing — ⚠️ **and the journal said the price was "not on file", losing the figure it
  // exists to record.**
  const before = [{ supplierId: "s_mydin", qty: 3000, uomId: "g", price: 27.5 }];
  const i = ing({ supplierPrices: [{ supplierId: "s_mydin", qty: 5000, uomId: "g", price: 30 }] });
  logPriceMoves(i, before);
  assert.equal(priceLogOf(i)[0].was, 27.5,
    "★ the old price was lost because the pack size moved with it");
  // ⚠️ And with TWO packs from one supplier a changed one is not guessed at.
  const two = [{ supplierId: "s_mydin", qty: 3000, uomId: "g", price: 27.5 },
    { supplierId: "s_mydin", qty: 1000, uomId: "g", price: 10 }];
  const j = ing({ supplierPrices: [{ supplierId: "s_mydin", qty: 5000, uomId: "g", price: 30 },
    { supplierId: "s_mydin", qty: 1000, uomId: "g", price: 10 }] });
  logPriceMoves(j, two);
  assert.equal(priceLogOf(j)[0].was, null, "★ a guessed old price was written for an ambiguous pack");
});

test("a hand-edit that changed nothing is not logged", () => {
  const before = [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 }];
  const i = ing();
  const moved = logPriceMoves(i, before);
  assert.equal(moved.length, 0);
  assert.equal(priceLogOf(i).length, 0, "opening Edit and pressing Update is not a price move");
});

test("the log is capped, because it rides the ingredient into every cloud sync", () => {
  // ⚠️⚠️ THE CAP IS A LITERAL, NOT A READ-BACK (v584). ⚠️ This test compared the log with `PRICE_LOG_CAP`
  // itself, ⚠️ **so changing the constant from 50 to 5 shrank her price history and the suite stayed green.**
  assert.equal(PRICE_LOG_CAP, 50, `★ the price log keeps ${PRICE_LOG_CAP} rows, not the 50 it has kept`);
  const i = ing();
  for (let n = 0; n < PRICE_LOG_CAP + 20; n += 1) {
    recordPriceMove(i, move({ price: 20 + n }));
  }
  assert.equal(priceLogOf(i).length, PRICE_LOG_CAP);
  assert.equal(priceLogOf(i)[0].price, 20 + PRICE_LOG_CAP + 19, "the newest is kept");
});

test("an ingredient that has never moved a price has an empty log, not a missing one", () => {
  assert.deepEqual(priceLogOf(ing()), []);
  assert.deepEqual(priceLogOf(null), []);
});
