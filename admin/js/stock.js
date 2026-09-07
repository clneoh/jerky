// stock.js — how "on hand" stock moves. Three moments only: buying adds a saved
// PO's whole packs, baking (an order marked Baked) subtracts its recipe, and
// setting On hand on the ingredient card writes the real amount. Pure (no DOM)
// so it runs under Node for tests; the two callers (orders.js, history.js) call
// save() once afterwards.
//
// Stock is stored on each ingredient as a base-unit count (grams / millilitres /
// items) and never goes below 0. Re-adding after an undo recomputes from the
// recipe, which keeps it symmetric for a fixed recipe.

import { byId, round2 } from "./state.js";
import { expandProduct } from "./bom.js";
import { cookingUnit } from "./purchasing.js";

export function stockOf(state, ingredient) {
  return Math.max(0, Number(ingredient && ingredient.onHand) || 0);
}

// The base multiplier for a recipe line whose unit name may or may not exist in
// the Units list — fall back to the ingredient's own cooking unit.
function baseOf(state, ingredient, unitName) {
  const list = state.uoms || [];
  const byName = unitName
    ? list.find((u) => String(u.name || "").toLowerCase() === String(unitName).toLowerCase())
    : null;
  const u = byName || cookingUnit(list, ingredient);
  return Number(u && u.toBase) || 1;
}

// Recipe ingredient amounts for one order of one product, in base units per
// ingredient. null when the product is gone (nothing to take off stock).
function orderConsumption(state, order) {
  const product = byId(state.products || [], order && order.productId);
  if (!product) return null;
  const res = expandProduct(state, product, Number(order.qty) || 1);
  const total = new Map();
  for (const line of res.lines || []) {
    const ingredient = byId(state.ingredients || [], line.ingredientId);
    const base = (Number(line.qty) || 0) * baseOf(state, ingredient, line.unit);
    total.set(line.ingredientId, (total.get(line.ingredientId) || 0) + base);
  }
  return total;
}

// An order marked Baked used its ingredients — take them off the shelf.
export function consumeOrder(state, order) {
  const amounts = orderConsumption(state, order);
  if (!amounts) return;
  for (const [ingredientId, base] of amounts) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    ing.onHand = round2(Math.max(0, (Number(ing.onHand) || 0) - base));
  }
}

// Un-marking Baked (back to Paid/Confirmed/New) puts the ingredients back.
export function addBackOrder(state, order) {
  const amounts = orderConsumption(state, order);
  if (!amounts) return;
  for (const [ingredientId, base] of amounts) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    ing.onHand = round2((Number(ing.onHand) || 0) + base);
  }
}

// The status-change stock rule for a set of orders all moving to nextStatus,
// given the status ids in forward journey order. Stepping INTO Baked consumes
// the orders' ingredients; stepping back from Baked to an earlier stage (an
// undo) restores them; forward moves change nothing. Call BEFORE assigning the
// new statuses, since each order's current status is the "from" state.
export function adjustForStatus(state, orders, nextStatus, statusOrder = []) {
  const bakingIdx = statusOrder.indexOf("baking");
  const nextIdx = statusOrder.indexOf(nextStatus);
  for (const o of orders || []) {
    const prev = o.status || "new";
    if (nextStatus === "baking" && prev !== "baking") consumeOrder(state, o);
    else if (prev === "baking" && nextIdx >= 0 && nextIdx < bakingIdx) addBackOrder(state, o);
  }
}

// "Bought" on a saved PO adds its actually-bought amounts to stock. Returns the
// [[ingredient, base], …] that moved, for the success toast.
export function applyBought(state, po) {
  const perIngredient = new Map();
  for (const it of (po && po.items) || []) {
    const addBase = Number(it && it.addBase) || 0;
    if (!(addBase > 0)) continue;
    perIngredient.set(it.ingredientId, (perIngredient.get(it.ingredientId) || 0) + addBase);
  }
  const added = [];
  for (const [ingredientId, base] of perIngredient) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    ing.onHand = round2((Number(ing.onHand) || 0) + base);
    added.push([ing, base]);
  }
  return added;
}
