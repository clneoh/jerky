// bom.js — BOM explosion, cost calculation, capacity.
// Pure module: no DOM, no localStorage. Runs under Node for tests.
// The core value of the app: sum(order qty × recipe qty) per ingredient.
//
// A recipe line is either an ingredient ({ingredientId}) or another product
// ({productId}) — a product inside a recipe is a component, i.e. a set/pack
// like "Focaccia Family Econ = 4 × Focaccia". Component lines expand
// recursively, so the shopping list and cost always see the leaf ingredients.

import { byId, round2 } from "./state.js";
import { chosenSupplier, cookingUnit } from "./purchasing.js";

const MAX_RECIPE_DEPTH = 6;
const NO_DEMAND = new Map();

// RM cost of ONE cooking unit of an ingredient — the number recipes multiply by
// qty. The owner may type a per-unit "fallback cost" OR only pack prices from
// suppliers (e.g. "500 g box RM 4.00"), so when a usable supplier pack exists
// this works the pack price back to the per-unit rate (the cheapest pack, the
// same rule the PO uses to buy), and only falls back to the typed cost when
// there is no pack to price from. Mirrors purchasing.js' own unit math so a
// recipe's estimate always agrees with what the ingredient costs on the PO.
export function effectiveUnitCost(state, ingredient) {
  if (!ingredient) return 0;
  const cook = cookingUnit(state.uoms || [], ingredient);
  if (cook) {
    const chosen = chosenSupplier(state, ingredient);
    if (chosen) return chosen.perBase * (Number(cook.toBase) || 1);
  }
  return Number(ingredient.costPerUnit) || 0;
}

export function explodeBom(state, deliveryDateId) {
  const warnings = [];
  const orders = state.orders.filter((o) => o.deliveryDateId === deliveryDateId);
  const acc = new Map();
  const memo = new Map(); // per-product per-unit demand, shared across orders
  let totalUnits = 0;

  for (const order of orders) {
    const product = byId(state.products, order.productId);
    if (!product) {
      warnings.push(`Order for a deleted product (${order.qty} pcs) was skipped.`);
      continue;
    }
    if (!Array.isArray(product.recipe)) continue;
    totalUnits += order.qty;
    const cycleWarnings = [];
    const perUnit = demandMap(state, product.id, memo, new Set(), cycleWarnings);
    if (cycleWarnings.length) {
      warnings.push(...cycleWarnings.map((w) => cycleWarningText(state, w)));
    }
    for (const [ingredientId, d] of perUnit) {
      let it = acc.get(ingredientId);
      if (!it) {
        const ing = byId(state.ingredients, ingredientId);
        it = {
          ingredientId,
          ingredientName: ing ? ing.name : "(deleted ingredient)",
          unit: d.unit,
          costPerUnit: ing ? effectiveUnitCost(state, ing) : 0,
          totalQty: 0,
          estCost: 0,
          unitsOk: true,
          lines: [],
        };
        acc.set(ingredientId, it);
      }
      it.totalQty += order.qty * d.qty;
      it.unitsOk = it.unitsOk && d.unit === it.unit;
      it.lines.push({
        productName: product.name,
        orderQty: order.qty,
        perUnitQty: d.qty,
      });
    }
  }

  const items = [...acc.values()].map((it) => {
    it.estCost = round2(it.totalQty * it.costPerUnit);
    return it;
  });
  items.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));

  const productLines = aggregateByProduct(orders, state.products);

  return { items, orders, totalUnits, productLines, warnings };
}

function aggregateByProduct(orders, products) {
  const map = new Map();
  for (const o of orders) {
    const p = byId(products, o.productId);
    if (!p) continue;
    map.set(p.id, { productId: p.id, productName: p.name, qty: (map.get(p.id)?.qty || 0) + o.qty });
  }
  return [...map.values()];
}

// Ingredient demand for ONE unit of `productId`: Map<ingredientId,{qty,unit}>,
// recursing through component lines. Memoised per product id. A cycle or depth
// overrun stops that branch with a warning instead of throwing. When an
// ingredient is reached through several lines, its qty sums; the unit of the
// first contributor is kept (a mismatch still surfaces in explodeBom's
// unitsOk check whenever it differs across products).
function demandMap(state, productId, memo, stack, warnings) {
  const cached = memo.get(productId);
  if (cached) return cached;
  const product = byId(state.products, productId);
  if (!product) return NO_DEMAND;
  if (stack.has(productId)) {
    warnings.push({ code: "recipe-cycle", path: [...stack, productId] });
    return NO_DEMAND;
  }
  if (stack.size >= MAX_RECIPE_DEPTH) {
    warnings.push({ code: "recipe-depth", productId });
    return NO_DEMAND;
  }
  stack.add(productId);
  const acc = new Map();
  for (const line of product.recipe || []) {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    if (line.ingredientId && !line.productId) {
      pushDemand(acc, line.ingredientId, qty, line.unit);
    } else if (line.productId) {
      const child = demandMap(state, line.productId, memo, stack, warnings);
      for (const [ingId, d] of child) pushDemand(acc, ingId, d.qty * qty, d.unit);
    }
  }
  stack.delete(productId);
  memo.set(productId, acc);
  return acc;
}

function pushDemand(acc, ingredientId, qty, unit) {
  const prev = acc.get(ingredientId);
  if (prev) prev.qty += qty;
  else acc.set(ingredientId, { qty, unit });
}

function cycleWarningText(state, w) {
  if (w.code === "recipe-cycle") {
    const names = w.path.map((id) => (byId(state.products, id) || {}).name || id);
    return `Recipe loop: ${names.join(" → ")}. Check the set — the loop was skipped.`;
  }
  if (w.code === "recipe-depth") {
    const p = byId(state.products, w.productId);
    return `"${p ? p.name : w.productId}" nests deeper than ${MAX_RECIPE_DEPTH} levels — check for a loop.`;
  }
  return "";
}

// Ingredient lines for ONE unit of `product` (default scale 1), expanded fully
// through components. `warnings` (optional array) collects cycle/depth notes.
export function expandProduct(state, product, scale = 1, warnings = []) {
  const map = demandMap(state, product && product.id, new Map(), new Set(), warnings);
  return {
    lines: [...map.entries()].map(([ingredientId, d]) => ({
      ingredientId,
      qty: round2(d.qty * scale),
      unit: d.unit,
    })),
    warnings,
  };
}

// Cost of one unit of `product`: leaf ingredient qty × its effective cost per
// unit (supplier pack price worked back, else the typed fallback), with any
// component costs (qty × component cost) compounding in. The product's own
// recipe lines are read off `product` (so a not-yet-saved draft works); its
// components resolve by id into state. Cycle-safe, no warnings needed.
export function costOf(state, product) {
  if (!product) return 0;
  return round2(costLines(state, product.recipe || [], new Map(), new Set()));
}

function costLines(state, lines, memo, stack) {
  let total = 0;
  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    if (line.ingredientId && !line.productId) {
      total += qty * effectiveUnitCost(state, byId(state.ingredients, line.ingredientId));
    } else if (line.productId) {
      total += qty * costProduct(state, line.productId, memo, stack);
    }
  }
  return total;
}

function costProduct(state, productId, memo, stack) {
  const cached = memo.get(productId);
  if (cached != null) return cached;
  const product = byId(state.products, productId);
  if (!product || stack.has(productId)) return 0;
  stack.add(productId);
  const total = costLines(state, product.recipe || [], memo, stack);
  stack.delete(productId);
  memo.set(productId, total);
  return total;
}

// Cost of each line of ONE unit of `product`, so the recipe editor can show
// what every ingredient contributes. Mirrors costOf exactly (product lines
// compound their component's cost, cycle-safe), so the lines always add up to
// the product's total. Returns an array parallel to product.recipe — blank or
// qty<=0 lines, unknown ingredients and costless products count as 0.
export function recipeLineCosts(state, product) {
  const memo = new Map();
  const stack = new Set();
  return ((product && product.recipe) || []).map((line) => {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) return 0;
    if (line.ingredientId && !line.productId) {
      return qty * effectiveUnitCost(state, byId(state.ingredients, line.ingredientId));
    }
    if (line.productId) return qty * costProduct(state, line.productId, memo, stack);
    return 0;
  });
}

// A product is a poolable value pack when its recipe is exactly one product
// line, it has no daily limit of its own, and it points at an active product
// that has its own limit (the shared pool's base). Returns {baseId, baseQty}
// or null. Mixed hampers and self-limited products get null (no shared pool).
export function isPoolablePack(state, product) {
  if (!product) return null;
  if (Number(product.limit) > 0) return null;
  const lines = (product.recipe || []).filter((l) => (Number(l.qty) || 0) > 0);
  if (lines.length !== 1) return null;
  const only = lines[0];
  if (!only.productId || only.ingredientId) return null;
  const base = byId(state.products, only.productId);
  if (!base || base.active === false || !(Number(base.limit) > 0)) return null;
  return { baseId: base.id, baseQty: Number(only.qty) };
}

// Pieces of a pool base still free for a delivery date = base.limit minus every
// order's qty × how many base pieces that product consumes (a pack of 4 takes
// 4). Returns {limit, booked, remaining}, or null when the base has no limit.
export function poolRemaining(state, deliveryDateId, baseId) {
  const base = byId(state.products, baseId);
  if (!base || !(Number(base.limit) > 0)) return null; // unlimited → no shared pool
  const rec = byId(state.deliveryDates, deliveryDateId);
  const limit = effectiveLimit(state, rec && rec.date, baseId) ?? 0;
  const memo = new Map();
  let booked = 0;
  for (const o of state.orders) {
    if (o.deliveryDateId !== deliveryDateId) continue;
    const qty = Number(o.qty) || 0;
    if (qty <= 0) continue;
    booked += qty * baseUnitsOf(state, baseId, o.productId, memo, new Set());
  }
  return { limit, booked, remaining: limit - booked };
}

// How many pieces of `baseId` one unit of `productId` consumes: 1 for the base
// itself, else the sum over its component lines of qty × the component's own
// base units. Cycle-safe (a loop counts nothing); memoised per product.
function baseUnitsOf(state, baseId, productId, memo, stack) {
  if (productId === baseId) return 1;
  const cached = memo.get(productId);
  if (cached != null) return cached;
  if (stack.has(productId)) return 0;
  stack.add(productId);
  const product = byId(state.products, productId);
  let sum = 0;
  if (product) {
    for (const line of product.recipe || []) {
      const qty = Number(line.qty) || 0;
      if (qty <= 0 || !line.productId) continue;
      sum += qty * baseUnitsOf(state, baseId, line.productId, memo, stack);
    }
  }
  stack.delete(productId);
  memo.set(productId, sum);
  return sum;
}

// Save-time guard: walk this product's component lines through the product
// graph and return an error string if the chain ever reaches the product being
// saved (its own recipe containing itself, directly or via other sets).
// A brand-new product has no id yet and can't be referenced, so always null.
export function validateRecipeNoCycle(state, product) {
  const selfId = product && product.id;
  if (!selfId) return null;
  const seen = new Set([selfId]);
  const queue = [];
  for (const l of product.recipe || []) if (l.productId) queue.push(l.productId);
  while (queue.length) {
    const pid = queue.pop();
    if (pid === selfId) {
      return `"${product.name}" can't contain itself, even through other sets — please break the loop.`;
    }
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = byId(state.products, pid);
    if (p) for (const l of p.recipe || []) if (l.productId) queue.push(l.productId);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-delivery-date adjustments ("this day's bakes"): the owner can raise or
// lower a product's usual daily limit for ONE delivery date from the Orders
// screen. The signed delta rides the deliveryDate record as dayAdj
// { [productId]: int }. The record passes through normalize by reference and
// syncs whole-record to the other phone, so a day set on one phone shows on
// both. Value packs (a set of n × one product) share their base's pool and are
// never adjusted themselves — the base's number flows to them at publish.
// ────────────────────────────────────────────────────────────────────────────

// The delta's owner is the FIRST deliveryDate record for a date string — the
// same record consolidateDeliveryDates keeps when same-day duplicates merge,
// so a delta typed on a duplicate tab still survives the next merge.
function ownerDateRecord(state, dateStr) {
  if (!dateStr) return null;
  return (state.deliveryDates || []).find((d) => d && d.date === dateStr) || null;
}

// Signed per-product delta for a date: the owner record's integer value, else 0.
export function dayDelta(state, dateStr, productId) {
  const rec = ownerDateRecord(state, dateStr);
  const v = rec && rec.dayAdj ? rec.dayAdj[productId] : undefined;
  return Number.isInteger(Number(v)) ? Number(v) : 0;
}

// A product's effective daily limit on a date: its usual limit plus the delta,
// clamped at 0 (0 = paused / "Sold out" that day). Returns null for a missing
// product or one with no usual limit — those are unlimited and publish no row.
export function effectiveLimit(state, dateStr, productId) {
  const product = byId(state.products, productId);
  const limit = Number(product && product.limit);
  if (!product || !(limit > 0)) return null;
  return Math.max(0, limit + dayDelta(state, dateStr, productId));
}

// A day's order capacity. Product daily limits sum first, each with that
// date's delta applied; with none limited it falls back to the default
// capacity, matching today's all-unlimited day. If she pauses every product to
// 0 the capacity is 0 — the whole day reads "Sold out" to customers.
export function effectiveCapacity(state, dateStr) {
  const active = (state.products || [])
    .filter((p) => p.active !== false && Number(p.limit) > 0);
  if (!active.length) return state.settings.defaultCapacity ?? 12;
  return active.reduce((sum, p) => sum + (effectiveLimit(state, dateStr, p.id) ?? 0), 0);
}

// Model for the "Set day's availability" pop-up: every active product with a
// usual limit (menu order), plus the names of poolable value packs that follow
// a listed base — those aren't adjusted directly.
export function dayRuleRows(state, dateStr) {
  const rows = (state.products || [])
    .filter((p) => p.active !== false && Number(p.limit) > 0)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      unit: p.unit || "",
      usual: Number(p.limit),
      delta: dayDelta(state, dateStr, p.id),
    }));
  const ids = new Set(rows.map((r) => r.productId));
  const packs = (state.products || [])
    .filter((p) => p.active !== false && isPoolablePack(state, p))
    .filter((p) => ids.has(isPoolablePack(state, p).baseId))
    .map((p) => p.name);
  return { rows, packs };
}

// A signed whole-item delta from the pop-up input. Blank means no change.
export function parseDayDelta(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") return { delta: 0 };
  if (!/^[+-]?\d+$/.test(s)) return { error: "Enter a whole number of items" };
  return { delta: Number(s) };
}

// Write adjustments to the OWNER deliveryDate record for that date (the
// survivor of any duplicate-date merge), pruning zeros and non-integers.
// Returns the record, or null if the delivery date is gone.
export function saveDayAdjustments(state, deliveryDateId, adjustments) {
  const rec = byId(state.deliveryDates, deliveryDateId);
  if (!rec) return null;
  const owner = ownerDateRecord(state, rec.date) || rec;
  const clean = {};
  for (const [productId, delta] of Object.entries(adjustments || {})) {
    const n = Number(delta);
    if (Number.isInteger(n) && n !== 0) clean[productId] = n;
  }
  if (Object.keys(clean).length) owner.dayAdj = clean;
  else delete owner.dayAdj;
  return owner;
}

export function capacityStatus(state, deliveryDateId) {
  const { totalUnits } = explodeBom(state, deliveryDateId);
  const rec = byId(state.deliveryDates, deliveryDateId);
  const cap = effectiveCapacity(state, rec && rec.date);
  const remaining = cap - totalUnits;
  return {
    capacity: cap,
    total: totalUnits,
    remaining,
    exceeded: totalUnits > cap,
    ratio: cap > 0 ? totalUnits / cap : 0,
  };
}

// Total planned units across ALL delivery dates (for the dashboard strip).
export function totalUnitsOnDate(state, deliveryDateId) {
  return state.orders
    .filter((o) => o.deliveryDateId === deliveryDateId)
    .reduce((s, o) => s + o.qty, 0);
}

// Units of a single product already booked for a date, and how many of its
// daily limit remain. Returns null when the product has no daily limit
// (unlimited), so callers can hide the count. excludeOrderId lets the order
// being edited opt out of its own quantity.
export function productRemaining(state, deliveryDateId, productId, excludeOrderId = null) {
  const product = byId(state.products, productId);
  if (!product || !(Number(product.limit) > 0)) return null; // unlimited → no count shown
  const rec = byId(state.deliveryDates, deliveryDateId);
  const limit = effectiveLimit(state, rec && rec.date, productId) ?? 0;
  const booked = state.orders
    .filter((o) => o.deliveryDateId === deliveryDateId && o.productId === productId && o.id !== excludeOrderId)
    .reduce((s, o) => s + o.qty, 0);
  return { limit, booked, remaining: limit - booked };
}
