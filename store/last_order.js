// store/last_order.js — what this phone ordered last time, so a regular does not retype or re-pick.
//
// ⭐ FROM THE CUSTOMER PLAN (marketing/customer-levels-plan.md, P2): "the regular — same as last time, and
// reassurance". ⚠️ **NO ACCOUNTS AND NO PASSWORDS** — her rule. The memory lives on the customer's own phone,
// holds only what they ordered, and can be forgotten in one press.
//
// ⚠️⚠️ AND IT MUST NEVER ADD SOMETHING THE SHOP WOULD REFUSE. The plan is computed against the SAME offer the
// menu cards read (`offerOf` in app.js): a product that has left the menu, or a day with no pans left, is
// SKIPPED AND NAMED rather than quietly dropped or quietly added.

export const LAST_KEY = "bakeadmin.shop.lastBasket";
export const MAX_ITEMS = 12;

const tidyItems = (items) => (Array.isArray(items) ? items : [])
  .map((i) => ({
    name: String((i && i.name) || "").trim(),
    qty: Math.max(1, Math.floor(Number(i && i.qty) || 1)),
  }))
  .filter((i) => i.name)
  .slice(0, MAX_ITEMS);

/**
 * Remember a basket. ⚠️ Best effort: a full phone or a private window must not stop an order from landing.
 * @returns {{at: string, items: Array<{name: string, qty: number}>}|null}
 */
export function saveLastBasket(storage, items, at = "") {
  const clean = tidyItems(items);
  if (!clean.length) return null;
  const rec = { at: String(at || ""), items: clean };
  try { if (storage) storage.setItem(LAST_KEY, JSON.stringify(rec)); } catch { /* best effort */ }
  return rec;
}

/** Read it back. ⚠️ A corrupt or half-written value answers null — never a basket of guesses. */
export function readLastBasket(storage) {
  try {
    const raw = storage && storage.getItem(LAST_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    const items = tidyItems(rec && rec.items);
    return items.length ? { at: String((rec && rec.at) || ""), items } : null;
  } catch { return null; }
}

export function forgetLastBasket(storage) {
  try { if (storage) storage.removeItem(LAST_KEY); } catch { /* nothing to forget */ }
}

/**
 * What of a saved basket can be added today.
 * @param {{items: Array<{name:string, qty:number}>}|null} saved
 * @param {(name: string) => ({shown:boolean, soldOut:boolean, unavailable?:boolean, reason?:string, left?:number}|null)} offerFor
 *        the shop's own answer for a product TODAY — the same one its cards draw
 * @returns {{add: Array<{name:string, qty:number}>, skipped: Array<{name:string, why:"gone"|"full"}>}}
 */
export function planReorder(saved, offerFor) {
  const add = [];
  const skipped = [];
  for (const item of (saved && saved.items) || []) {
    let facts = null;
    try { facts = typeof offerFor === "function" ? offerFor(item.name) : null; } catch { facts = null; }
    if (!facts || !facts.shown) { skipped.push({ name: item.name, why: "gone" }); continue; }
    if (facts.soldOut || facts.unavailable || facts.reason) { skipped.push({ name: item.name, why: "full" }); continue; }
    const cap = facts.left != null && facts.left > 0 ? facts.left : 99;
    const qty = Math.min(item.qty, cap);
    if (qty < 1) { skipped.push({ name: item.name, why: "full" }); continue; }
    add.push({ name: item.name, qty });
  }
  return { add, skipped };
}
