// purchasing.js — how the PO buys: convert units, pick the cheapest supplier
// price, round up to whole packs, group the list by supplier and build the
// copy-to-WhatsApp order text. Pure (no DOM) so it runs under Node for tests.
//
// Unit model: every unit belongs to a family (weight / volume / count) and
// carries `toBase` — how many base units (grams / millilitres / items) one of
// it equals. Conversions only happen within a family.

import { byId, round2 } from "./state.js";

export function toBaseQty(uoms, uomId, qty) {
  const u = byId(uoms || [], uomId);
  return (Number(qty) || 0) * (u ? Number(u.toBase) || 1 : 1);
}

export function uomById(uoms, uomId) {
  return byId(uoms || [], uomId);
}

// The unit an ingredient cooks in: its uomId when set, else a matching unit by
// name (legacy data). Returns a unit object or null.
export function cookingUnit(uoms, ingredient) {
  const list = uoms || [];
  let u = ingredient && ingredient.uomId ? byId(list, ingredient.uomId) : null;
  if (!u && ingredient && ingredient.unit) {
    u = list.find((x) => String(x.name || "").toLowerCase() === String(ingredient.unit).toLowerCase()) || null;
  }
  return u;
}

// Number without trailing zeros ("4", "0.5", "1.3333") for compact labels.
export function trimNum(n) {
  const s = (Number(n) || 0).toFixed(4);
  return String(s).replace(/\.?0+$/, "");
}

export function fmtQtyText(qty, unit) {
  return `${trimNum(qty)}${unit}`;
}

// Friendly "on the shelf" amount for a stock count stored in base units:
// weight in kg above 1000 g (else g), volume in L above 1000 ml (else ml),
// count in the ingredient's own cooking unit.
export function fmtStockAmount(state, ingredient, base) {
  const cook = cookingUnit(state.uoms || [], ingredient);
  const n = Number(base) || 0;
  if (cook && cook.family === "weight") {
    return Math.abs(n) >= 1000 ? `${trimNum(n / 1000)} kg` : `${trimNum(n)} g`;
  }
  if (cook && cook.family === "volume") {
    return Math.abs(n) >= 1000 ? `${trimNum(n / 1000)} L` : `${trimNum(n)} ml`;
  }
  return `${trimNum(n)} ${cook && cook.name ? cook.name : "pcs"}`;
}

// The cheapest valid supplier price for an ingredient, compared per base unit
// (grams / ml / items). Ties keep the first entry (the primary supplier).
// Returns null when the ingredient has no usable supplier price.
export function chosenSupplier(state, ingredient) {
  const uoms = state.uoms || [];
  const cook = cookingUnit(uoms, ingredient);
  const entries = ingredient && Array.isArray(ingredient.supplierPrices) ? ingredient.supplierPrices : [];
  let best = null;
  for (const e of entries) {
    if (!e || !e.supplierId || e.price == null || e.price === "") continue;
    const supplier = byId(state.suppliers || [], e.supplierId);
    const packQty = Number(e.qty);
    const price = Number(e.price);
    const packUom = byId(uoms, e.uomId);
    if (!supplier || supplier.active === false) continue;
    if (!(packQty > 0) || Number.isNaN(price) || price < 0 || !packUom) continue;
    if (cook && packUom.family !== cook.family) continue; // can't convert families
    const packBase = toBaseQty(uoms, e.uomId, packQty);
    if (!(packBase > 0)) continue;
    const perBase = price / packBase;
    if (!best || perBase < best.perBase) {
      best = {
        supplierId: supplier.id,
        name: supplier.name,
        whatsapp: String(supplier.whatsapp || "").trim(),
        qty: packQty,
        uomId: e.uomId,
        uomName: packUom.name,
        price,
        perBase,
      };
    }
  }
  return best;
}

// Enrich BOM items so they know how the PO actually buys each one: stock on
// hand first covers the need, then the chosen supplier's whole packs fill the
// rest (cost = packs × price) or, with no supplier price, today's loose
// estimate (the still-open amount × fallback unit cost). Each item records the
// base-unit amounts (need/on-hand/open/add) so a saved snapshot can later add
// exactly what was bought, and rows can show "have X". Used for BOTH the live
// PO and the Generate & Save snapshot, so the two never drift.
// The 10% dead-band: an ingredient is only treated as "below its keep level"
// once on hand has dropped MORE than 10% under it (scaled integers dodge float
// wobble at the boundary). Trivial 1-9% dips read as fine everywhere.
export function belowReserve(safety, onHand) {
  const s = Number(safety) || 0;
  return s > 0 && (Number(onHand) || 0) * 10 < s * 9;
}

export function priceItems(state, bomItems, { reserve = true } = {}) {
  return (bomItems || []).map((item) => {
    const ingredient = byId(state.ingredients || [], item.ingredientId);
    const out = { ...item, buyText: null };
    const cook = cookingUnit(state.uoms || [], ingredient);
    const cookBase = cook ? Number(cook.toBase) || 1 : 1;
    const needBase = cookBase * (Number(item.totalQty) || 0);
    const onHand = Math.max(0, Number(ingredient && ingredient.onHand) || 0);
    // The keep-at-least reserve rides the buy gap ONLY once stock has truly
    // dropped (>10% under the level) AND this is a full list — extra-only delta
    // lists (reserve:false) skip it so a "changed orders" follow-up never
    // re-buys the reserve the main list already covered.
    const keep = reserve ? Math.max(0, Number(ingredient && ingredient.safetyBase) || 0) : 0;
    const safety = belowReserve(keep, onHand) ? keep : 0;
    const openBase = Math.max(0, (needBase + safety) - onHand);
    out.onHand = onHand;
    out.needBase = needBase;
    out.safetyBase = keep;
    out.openBase = openBase;
    out.haveBase = Math.min(needBase + safety, onHand);
    out.openQty = openBase / cookBase;
    // A need is only shown when bakes actually need some — a reserve-only row
    // (below-keep ingredient with no bake need this time) must not read "need 0".
    if (needBase > 0) out.needText = fmtQtyText(item.totalQty, item.unit);
    if (onHand > 0) out.haveText = `have ${fmtStockAmount(state, ingredient, onHand)}`;
    if (safety > 0 && openBase > 0) out.reserveText = `keep ${fmtStockAmount(state, ingredient, safety)} on hand`;
    const c = ingredient ? chosenSupplier(state, ingredient) : null;
    if (!c) {
      out.addBase = Math.max(0, openBase);
      out.estCost = round2((openBase / cookBase) * (Number(item.costPerUnit) || 0));
      if (openBase <= 0) out.covered = true;
      return out;
    }
    const packBase = toBaseQty(state.uoms, c.uomId, c.qty);
    if (openBase <= 0) {
      out.covered = true;
      out.packs = 0;
      out.addBase = 0;
      out.estCost = 0;
      return out;
    }
    const packs = Math.max(1, Math.ceil(openBase / packBase));
    out.supplierId = c.supplierId;
    out.supplier = c.name;
    out.supplierWhatsapp = c.whatsapp;
    out.packs = packs;
    out.packDisplay = `${trimNum(c.qty)}${c.uomName}`;
    out.buyText = `${packs} × ${out.packDisplay}`;
    out.addBase = packs * packBase;
    out.estCost = round2(packs * c.price);
    return out;
  });
}

// Order the priced items into supplier sections (alphabetical, "no supplier"
// last), each with a subtotal. Deterministic on the items alone, so a saved PO
// snapshot groups identically no matter when it is opened.
export function groupItemsBySupplier(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = it.supplier || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const groups = [...map.entries()].map(([supplier, list]) => ({
    supplier,
    whatsapp: (list.find((i) => i.supplierWhatsapp) || {}).supplierWhatsapp || "",
    items: list,
    subtotal: round2(list.reduce((s, i) => s + (Number(i.estCost) || 0), 0)),
  }));
  groups.sort((a, b) => {
    if (!a.supplier) return 1;
    if (!b.supplier) return -1;
    return a.supplier.localeCompare(b.supplier);
  });
  return groups;
}

// Human line for one ingredient on its card, e.g. "Mydin RM25/4kg". Empty
// entries (missing supplier/price) are skipped.
export function priceEntryLabels(state, ingredient) {
  const uoms = state.uoms || [];
  const entries = ingredient && Array.isArray(ingredient.supplierPrices) ? ingredient.supplierPrices : [];
  const labels = [];
  for (const e of entries) {
    if (!e || !e.supplierId || e.price == null || e.price === "") continue;
    const supplier = byId(state.suppliers || [], e.supplierId);
    const packUom = byId(uoms, e.uomId);
    if (!supplier || supplier.active === false || !packUom) continue;
    labels.push(`${supplier.name} ${state.settings?.currency || "RM"} ${round2(Number(e.price)).toFixed(2)}/${trimNum(e.qty)}${packUom.name}`);
  }
  return labels;
}

// A WhatsApp-pasteable order text for one supplier group (plain ASCII).
export function buildSupplierOrderText({ dateTitle = "", supplier = "", items = [], subtotal = 0, currency = "RM" } = {}) {
  const lines = [];
  lines.push(`${dateTitle}${supplier ? ` — ${supplier}` : ""}`);
  // "already have" lines are nothing to buy — leave them out of the order text.
  const buyLines = (items || []).filter((it) => !it.covered);
  buyLines.forEach((it, i) => {
    const detail = [];
    if (it.needText) detail.push(`need ${it.needText}`);
    if (it.reserveText) detail.push(it.reserveText);
    const amount = it.buyText
      ? `${it.buyText}${detail.length ? ` (${detail.join(", ")})` : ""}`
      : detail.join(", ") || `${fmtQtyText(it.totalQty, it.unit)}`;
    lines.push(`${i + 1}. ${it.ingredientName}: ${amount}`);
  });
  if ((Number(subtotal) || 0) > 0 && buyLines.length) lines.push(`Est. ${currency} ${round2(subtotal).toFixed(2)}`);
  return lines.join("\n");
}
