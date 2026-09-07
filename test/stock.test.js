// test/stock.test.js — ingredient on-hand stock moves: Bought adds a saved
// PO's whole packs, baking (an order marked Baked) subtracts its recipe and an
// undo puts it back, and stock never goes below zero. Pure functions (no DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockOf, consumeOrder, addBackOrder, adjustForStatus, applyBought,
} from "../admin/js/stock.js";

const JOURNEY = ["new", "confirmed", "paid", "baking", "ready", "delivered"];

function baseState(ingredients = [], products = []) {
  return {
    uoms: [
      { id: "g", name: "g", family: "weight", toBase: 1 },
      { id: "kg", name: "kg", family: "weight", toBase: 1000 },
    ],
    ingredients,
    products,
  };
}

const flour = (onHand) => ({ id: "ing_f", name: "Strong flour", unit: "g", uomId: "g", onHand });
const butter = (onHand) => ({ id: "ing_b", name: "Butter", unit: "g", uomId: "g", onHand });
const bread = () => ({ id: "p_bread", name: "Sourdough", active: true, recipe: [
  { ingredientId: "ing_f", qty: 250, unit: "g" },
  { ingredientId: "ing_b", qty: 40, unit: "g" },
] });
const order = (qty = 1, status = "paid") =>
  ({ id: "o", deliveryDateId: "del", productId: "p_bread", qty, status });

test("stockOf is the on-hand count, never below zero", () => {
  const st = baseState([flour(500)]);
  assert.equal(stockOf(st, st.ingredients[0]), 500);
  st.ingredients[0].onHand = -4;
  assert.equal(stockOf(st, st.ingredients[0]), 0);
  assert.equal(stockOf(st, undefined), 0);
});

test("consumeOrder takes the recipe's amounts off stock; addBackOrder restores it", () => {
  const ing = flour(1000);
  const st = baseState([ing, butter(1000)], [bread()]);
  consumeOrder(st, order(2));                       // 2 sourdoughs
  assert.equal(ing.onHand, 500, "250 g × 2 off");
  assert.equal(st.ingredients[1].onHand, 920, "40 g × 2 off the butter");

  addBackOrder(st, order(2));
  assert.equal(ing.onHand, 1000, "undoing Baked restores the flour");
  assert.equal(st.ingredients[1].onHand, 1000);
});

test("consumption never drives stock below zero (it reads 0 until the next Bought)", () => {
  const ing = flour(300);
  const st = baseState([ing], [bread()]);
  consumeOrder(st, order(2));
  assert.equal(ing.onHand, 0);
});

test("recipe lines typed in kg convert to base grams when baking", () => {
  const ing = flour(1000);
  const st = baseState([ing], [{ id: "p", name: "X", active: true,
    recipe: [{ ingredientId: "ing_f", qty: 0.5, unit: "kg" }] }]);
  consumeOrder(st, { id: "o", productId: "p", qty: 2 });
  assert.equal(ing.onHand, 0, "0.5 kg × 2 = 1000 g comes off");
});

test("a deleted product's order takes nothing off stock", () => {
  const ing = flour(100);
  const st = baseState([ing], []);
  consumeOrder(st, { id: "o", productId: "gone", qty: 5 });
  assert.equal(ing.onHand, 100);
});

test("adjustForStatus: marking Baked consumes; Packed/Delivered leave stock unchanged", () => {
  const st = baseState([flour(1000)], [bread()]);
  const o = order(2, "paid");

  adjustForStatus(st, [o], "baking", JOURNEY);     // she marks Baked
  assert.equal(st.ingredients[0].onHand, 500);

  o.status = "baking";
  adjustForStatus(st, [o], "ready", JOURNEY);       // Packed later
  assert.equal(st.ingredients[0].onHand, 500);

  o.status = "ready";
  adjustForStatus(st, [o], "delivered", JOURNEY);
  assert.equal(st.ingredients[0].onHand, 500, "packing/delivering keeps the ingredients used");
});

test("adjustForStatus: undoing Baked back to an earlier stage restores the ingredients", () => {
  const st = baseState([flour(500)], [bread()]);    // 500 g left after the bake
  const o = order(2, "baking");
  adjustForStatus(st, [o], "paid", JOURNEY);
  assert.equal(st.ingredients[0].onHand, 1000, "stepping back before Baked restores the flour");
});

test("Bought adds each item's whole-pack amount once and reports what moved", () => {
  const f = flour(2000);
  const b = butter(0);
  const st = baseState([f, b], []);
  const po = { id: "po1", items: [
    { ingredientId: "ing_f", addBase: 8000 },
    { ingredientId: "ing_f", addBase: 4000 },
    { ingredientId: "ing_b", addBase: 500 },
    { ingredientId: "ing_b", addBase: 0 },
    { ingredientId: "gone", addBase: 100 },
  ] };

  const added = applyBought(st, po);
  assert.equal(f.onHand, 14000, "same ingredient sums across items");
  assert.equal(b.onHand, 500);
  assert.equal(added.length, 2, "only ingredients that moved are reported");
});
