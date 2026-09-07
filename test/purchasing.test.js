// test/purchasing.test.js — unit conversion, supplier-price choice, pack
// rounding, supplier grouping and the WhatsApp order text for the PO.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toBaseQty, chosenSupplier, priceItems, groupItemsBySupplier,
  priceEntryLabels, buildSupplierOrderText,
} from "../admin/js/purchasing.js";

const UOMS = [
  { id: "g", name: "g", family: "weight", toBase: 1 },
  { id: "kg", name: "kg", family: "weight", toBase: 1000 },
  { id: "ml", name: "ml", family: "volume", toBase: 1 },
  { id: "pcs", name: "pcs", family: "count", toBase: 1 },
];

const SUPPLIERS = [
  { id: "s_mydin", name: "Mydin", whatsapp: "6012345678", active: true },
  { id: "s_yen", name: "Yen Grocer", whatsapp: "6012987654", active: true },
];

function ingredient(over = {}) {
  return {
    id: "ing_f", name: "Strong flour", unit: "g", uomId: "g",
    costPerUnit: 0, supplierPrices: [], ...over,
  };
}

function bomItem(over = {}) {
  return {
    ingredientId: "ing_f", ingredientName: "Strong flour", unit: "g",
    costPerUnit: 0, totalQty: 0, estCost: 0, lines: [], ...over,
  };
}

function makeState(ingredients = [ingredient()]) {
  return { settings: { currency: "RM" }, uoms: UOMS, suppliers: SUPPLIERS, ingredients };
}

test("toBaseQty converts within a family (kg → g)", () => {
  assert.equal(toBaseQty(UOMS, "kg", 4), 4000);
  assert.equal(toBaseQty(UOMS, "g", 6800), 6800);
  assert.equal(toBaseQty(UOMS, "pcs", 12), 12);
});

test("chosenSupplier picks the cheaper price per gram and prefers primary on a tie", () => {
  const st = makeState([ingredient({
    supplierPrices: [
      { supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 },  // RM0.00625/g
      { supplierId: "s_yen", qty: 1000, uomId: "g", price: 8 },     // RM0.008/g
    ],
  })]);
  const c = chosenSupplier(st, st.ingredients[0]);
  assert.equal(c.supplierId, "s_mydin");

  const st2 = makeState([ingredient({
    supplierPrices: [
      { supplierId: "s_mydin", qty: 4000, uomId: "g", price: 30 },
      { supplierId: "s_yen", qty: 4000, uomId: "g", price: 24 },
    ],
  })]);
  assert.equal(chosenSupplier(st2, st2.ingredients[0]).supplierId, "s_yen");

  // exact tie → the first (primary) supplier
  const tie = makeState([ingredient({
    supplierPrices: [
      { supplierId: "s_mydin", qty: 1000, uomId: "g", price: 10 },
      { supplierId: "s_yen", qty: 2000, uomId: "g", price: 20 },
    ],
  })]);
  assert.equal(chosenSupplier(tie, tie.ingredients[0]).supplierId, "s_mydin");
});

test("chosenSupplier returns null with no usable price and skips cross-family packs", () => {
  const none = makeState([ingredient({ supplierPrices: [] })]);
  assert.equal(chosenSupplier(none, none.ingredients[0]), null);

  const missingSup = makeState([ingredient({
    supplierPrices: [{ supplierId: "gone", qty: 1000, uomId: "g", price: 5 }],
  })]);
  assert.equal(chosenSupplier(missingSup, missingSup.ingredients[0]), null);

  // flour cooks in grams; a volume pack can't be compared
  const familyMix = makeState([ingredient({
    supplierPrices: [{ supplierId: "s_mydin", qty: 1, uomId: "ml", price: 2 }],
  })]);
  assert.equal(chosenSupplier(familyMix, familyMix.ingredients[0]), null);
});

test("priceItems rounds a priced ingredient up to whole packs with pack-based cost", () => {
  const st = makeState([ingredient({
    supplierPrices: [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 }],
  })]);
  const priced = priceItems(st, [bomItem({ ingredientId: "ing_f", totalQty: 6800, unit: "g" })]);
  const it = priced[0];
  assert.equal(it.packs, 2);
  assert.equal(it.buyText, "2 × 4000g");
  assert.equal(it.needText, "6800g");
  assert.equal(it.estCost, 50);
  assert.equal(it.supplier, "Mydin");
  assert.equal(it.supplierWhatsapp, "6012345678");
});

test("a kg pack converts from a gram need without any user arithmetic", () => {
  const st = makeState([ingredient({
    supplierPrices: [{ supplierId: "s_mydin", qty: 4, uomId: "kg", price: 25 }],
  })]);
  const it = priceItems(st, [bomItem({ ingredientId: "ing_f", totalQty: 6800, unit: "g" })])[0];
  assert.equal(it.buyText, "2 × 4kg");
  assert.equal(it.estCost, 50);
});

test("an ingredient without a supplier price stays loose at its unit cost", () => {
  const st = makeState([ingredient({ costPerUnit: 0.006, supplierPrices: [] })]);
  const it = priceItems(st, [bomItem({ ingredientId: "ing_f", totalQty: 6800, unit: "g", costPerUnit: 0.006 })])[0];
  assert.equal(it.supplier, undefined);
  assert.equal(it.buyText, null);
  assert.equal(it.estCost, 40.8);
  assert.equal(it.needText, "6800g");
});

test("groupItemsBySupplier orders suppliers alphabetically with no-supplier last", () => {
  const items = priceItems(makeState([
    ingredient({ id: "a", supplierPrices: [{ supplierId: "s_yen", qty: 1000, uomId: "g", price: 5 }] }),
    ingredient({ id: "b", supplierPrices: [] }),
    ingredient({ id: "c", supplierPrices: [{ supplierId: "s_mydin", qty: 1000, uomId: "g", price: 6 }] }),
  ]), [
    bomItem({ ingredientId: "a", totalQty: 2000 }),
    bomItem({ ingredientId: "b", totalQty: 500 }),
    bomItem({ ingredientId: "c", totalQty: 1000 }),
  ]);
  const groups = groupItemsBySupplier(items);
  assert.deepEqual(groups.map((g) => g.supplier), ["Mydin", "Yen Grocer", ""]);
  assert.equal(groups[0].whatsapp, "6012345678"); // Mydin
  assert.equal(groups[0].subtotal, 6);            // flour c: 1 × RM6
  assert.equal(groups[1].subtotal, 10);           // a: 2 × RM5
  assert.equal(groups[2].subtotal, 0);            // loose b: no unit cost
});

test("buildSupplierOrderText reads like a WhatsApp order", () => {
  const st = makeState([ingredient({
    supplierPrices: [{ supplierId: "s_mydin", qty: 4000, uomId: "g", price: 25 }],
  })]);
  const items = priceItems(st, [bomItem({ ingredientId: "ing_f", totalQty: 6800 })]);
  const text = buildSupplierOrderText({
    dateTitle: "Fri, 4 Sep", supplier: "Mydin", items, subtotal: 50, currency: "RM",
  });
  assert.ok(text.includes("Fri, 4 Sep — Mydin"));
  assert.ok(text.includes("1. Strong flour: 2 × 4000g (need 6800g)"));
  assert.ok(text.endsWith("Est. RM 50.00"));
});

test("priceEntryLabels describes each supplier price for the ingredient card", () => {
  const st = makeState([ingredient({
    supplierPrices: [
      { supplierId: "s_mydin", qty: 4, uomId: "kg", price: 25 },
      { supplierId: "s_yen", qty: 1000, uomId: "g", price: 6.5 },
    ],
  })]);
  const labels = priceEntryLabels(st, st.ingredients[0]);
  assert.deepEqual(labels, ["Mydin RM 25.00/4kg", "Yen Grocer RM 6.50/1000g"]);
});
