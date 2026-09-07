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

// Enrich BOM items so they know how the PO actually buys each one: the chosen
// supplier's whole packs (cost = packs × price) or, with no supplier price,
// today's loose estimate (qty × fallback unit cost). Used for BOTH the live PO
// and the Generate & Save snapshot, so the two never drift.
export function priceItems(state, bomItems) {
  return (bomItems || []).map((item) => {
    const ingredient = byId(state.ingredients || [], item.ingredientId);
    const out = { ...item, buyText: null, needText: fmtQtyText(item.totalQty, item.unit) };
    const c = ingredient ? chosenSupplier(state, ingredient) : null;
    if (!c) {
      out.estCost = round2((Number(item.totalQty) || 0) * (Number(item.costPerUnit) || 0));
      return out;
    }
    const cook = cookingUnit(state.uoms || [], ingredient);
    const needBase = toBaseQty(state.uoms, cook ? cook.uomId : "", Number(item.totalQty) || 0);
    const packBase = toBaseQty(state.uoms, c.uomId, c.qty);
    const packs = Math.max(1, Math.ceil(needBase / packBase));
    out.supplierId = c.supplierId;
    out.supplier = c.name;
    out.supplierWhatsapp = c.whatsapp;
    out.packs = packs;
    out.packDisplay = `${trimNum(c.qty)}${c.uomName}`;
    out.buyText = `${packs} × ${out.packDisplay}`;
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
  (items || []).forEach((it, i) => {
    const amount = it.buyText
      ? `${it.buyText}${it.needText ? ` (need ${it.needText})` : ""}`
      : it.needText || `${fmtQtyText(it.totalQty, it.unit)}`;
    lines.push(`${i + 1}. ${it.ingredientName}: ${amount}`);
  });
  if ((Number(subtotal) || 0) > 0) lines.push(`Est. ${currency} ${round2(subtotal).toFixed(2)}`);
  return lines.join("\n");
}
