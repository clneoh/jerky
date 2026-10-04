// prices.js — an ingredient's price, and the record of it moving (v285).
//
// Her words: *"ingredient price journaled, ingredient price updated accordingly. So an
// ingredient need a journals."*
//
// Two jobs, and they are the two halves of that sentence.
//
// **Updated accordingly.** When the supplier's price has moved, the number she read off the
// shelf is written back into the ingredient's own supplier prices — so `effectiveUnitCost`
// (bom.js) feeds it to every recipe, every product cost, the Profit screen and the next
// shopping list, with nothing else to wire up. `effectiveUnitCost` is the ONE chokepoint, so
// this is the ONE place a price has to land.
//
// **Journaled.** A price that moves is recorded, because it is the one fact about an
// ingredient that changes what every past month cost. Cost of sales is recomputed from today's
// prices (the app says so on screen — v281), so a price change silently rewrites history;
// this log is what makes that visible and sendable instead of invisible.
//
// Only MOVEMENTS are recorded — her choice, 3 Oct 2026: *"only when the price moves, plus
// today"*. Buying the same thing at the same price again is stock, not news.
//
// Pure: no DOM, no storage, no save. The caller owns the ingredient and decides when to save.

import { round2 } from "./state.js";
import { todayISO } from "./dates.js";

// How many movements an ingredient keeps. A price log that grew forever would ride the
// ingredient record — and so every cloud sync — for the life of the bakery; fifty movements is
// years of a supplier moving his prices, and it is the RECENT ones she would ever look at.
export const PRICE_LOG_CAP = 50;

// A supplier price entry is the SAME entry when it is the same supplier, the same pack size
// and the same pack unit. Matching on the supplier alone would treat "1kg for RM3.10" and
// "5kg for RM14" as one thing and quietly overwrite a pack she still buys.
function sameEntry(entry, move) {
  return !!entry
    && String(entry.supplierId) === String(move.supplierId)
    && String(entry.uomId) === String(move.uomId)
    && Number(entry.qty) === Number(move.qty);
}

function sameSupplier(entry, move) {
  return !!entry && String(entry.supplierId) === String(move.supplierId);
}

// The log, newest first, whatever shape the record happens to be in.
export function priceLogOf(ingredient) {
  const log = ingredient && Array.isArray(ingredient.priceLog) ? ingredient.priceLog : [];
  return log;
}

// Append one movement. Newest first, capped, and only ever called when the price ACTUALLY
// moved — `was === price` is not a movement, it is the same price again.
function appendMove(ingredient, { at, supplierId, supplierName, qty, uomId, uomName, price, was, poId, source }) {
  if (!ingredient) return null;
  if (!Array.isArray(ingredient.priceLog)) ingredient.priceLog = [];
  const entry = {
    at: at || todayISO(),
    supplierId: supplierId || "",
    supplierName: supplierName || "",
    qty: Number(qty) || 0,
    uomId: uomId || "",
    uomName: uomName || "",
    price: round2(price),
    was: was == null ? null : round2(was),
    poId: poId || "",
    source: source || "po",
  };
  ingredient.priceLog.unshift(entry);
  if (ingredient.priceLog.length > PRICE_LOG_CAP) ingredient.priceLog.length = PRICE_LOG_CAP;
  return entry;
}

// Write a price back onto the ingredient and remember that it moved.
//
// Returns what happened, so the screen can say it rather than doing it behind her back:
//   { ok: true,  changed: true,  was, now }   the price moved and was written
//   { ok: true,  changed: false }             she typed the price it already was
//   { ok: false, reason: "packChanged" }      this supplier has a price, but for a DIFFERENT
//                                             pack — the caller must ask before replacing it
//
// THE packChanged CASE IS THE ONE THAT MATTERS. `chosenSupplier` buys whichever pack is
// cheapest per base unit, so leaving a stale second entry behind would silently move her
// costing to a pack she is no longer buying. Silence there is worse than a question.
export function recordPriceMove(ingredient, move, { replace = false } = {}) {
  if (!ingredient) return { ok: false, reason: "noIngredient" };
  const next = Number(move && move.price);
  if (!Number.isFinite(next) || next < 0) return { ok: false, reason: "badPrice" };

  const entries = Array.isArray(ingredient.supplierPrices) ? ingredient.supplierPrices : [];
  ingredient.supplierPrices = entries;

  const exact = entries.find((e) => sameEntry(e, move));
  if (exact) {
    const was = Number(exact.price);
    exact.price = round2(next);
    if (was === round2(next)) return { ok: true, changed: false };
    appendMove(ingredient, { ...move, price: next, was });
    return { ok: true, changed: true, was, now: round2(next) };
  }

  const other = entries.find((e) => sameSupplier(e, move));
  if (other && !replace) return { ok: false, reason: "packChanged" };

  if (other) {
    // She has told us the pack changed: this is the same supply arrangement, re-expressed.
    const was = Number(other.price);
    other.qty = Number(move.qty) || 0;
    other.uomId = move.uomId || "";
    other.price = round2(next);
    if (was === round2(next)) return { ok: true, changed: false };
    appendMove(ingredient, { ...move, price: next, was });
    return { ok: true, changed: true, was, now: round2(next) };
  }

  // A supplier this ingredient has never had a price from. That is a new arrangement, not a
  // correction, and there is no old price to report.
  entries.push({ supplierId: move.supplierId, qty: Number(move.qty) || 0, uomId: move.uomId || "", price: round2(next) });
  appendMove(ingredient, { ...move, price: next, was: null });
  return { ok: true, changed: true, was: null, now: round2(next) };
}

// The same record kept for a price she edited by hand on the ingredient's own screen. There
// the two price lists are already the new ones by the time this is called (`collect()` has
// written them), so this compares the SHAPE OF THE RECORD BEFORE against the one after and
// logs whatever moved — rather than trusting a screen to remember to tell us.
//
// Without this the journal would be a lie: it would be titled as the ingredient's price
// history while only ever holding the moves that came through a shopping list.
export function logPriceMoves(ingredient, before, { source = "edit", at = todayISO() } = {}) {
  if (!ingredient) return [];
  const oldList = Array.isArray(before) ? before : [];
  const newList = Array.isArray(ingredient.supplierPrices) ? ingredient.supplierPrices : [];
  const moved = [];
  for (const next of newList) {
    const prev = oldList.find((e) => sameEntry(e, next));
    const was = prev ? Number(prev.price) : null;
    const now = Number(next && next.price);
    if (!Number.isFinite(now) || now < 0) continue;
    if (was != null && round2(was) === round2(now)) continue;
    moved.push(appendMove(ingredient, {
      at,
      supplierId: next.supplierId,
      supplierName: next.supplierName || "",
      qty: next.qty,
      uomId: next.uomId,
      uomName: next.uomName || "",
      price: now,
      was,
      source,
    }));
  }
  return moved.filter(Boolean);
}
