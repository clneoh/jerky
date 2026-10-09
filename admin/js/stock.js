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
import { longDate, todayISO } from "./dates.js";

// ── ★★ the stock journal (v385) ───────────────────────────────────────────────
// Her words: __"why only show when there is price movement, qty movement cannot?"__ — and the honest
// answer was that quantity movements were **never recorded at all**. Five things move stock and every
// one of them simply overwrote the number, so the moment she asked where her flour went the app could
// only reply "that is the number".
//
// ⚠️⚠️ IT STARTS EMPTY, AND NOTHING BEFORE IT IS RECOVERABLE. Every movement that has already happened
// is gone — there is no way to rebuild it — so this records from the day it ships and nothing earlier.
// The same honesty as the cost freeze (v380): I will not invent a history that never existed.
//
// ⚠️ THE CAP, AND WHY IT IS THE SAME NUMBER AS THE PRICE LOG. A bake writes one row per DISTINCT
// ingredient in the recipe (five to fifteen rows), so this fills faster than a price log does — 50
// rows is roughly a month on a busy ingredient, enough to answer "where did it go" without growing
// for ever on a phone that has about 5 MB to play with.
export const STOCK_LOG_CAP = 50;

export function stockLogOf(ingredient) {
  return ingredient && Array.isArray(ingredient.stockLog) ? ingredient.stockLog : [];
}

// Append one movement, newest first. ⚠️ `delta` IS SIGNED AND IN BASE UNITS and is never formatted
// here — grams or kilograms is the display's decision, the same rule the rest of the app follows.
// `why` is one word so the reason can be told apart without reading the sentence; `what` is the
// sentence a person reads; `ref` ties a row back to the order or the list that caused it.
export function logStock(ingredient, { at, delta, why, what, ref } = {}) {
  if (!ingredient) return null;
  const n = Number(delta);
  // ⚠️ A movement of nothing is not a movement — the same rule the price log keeps. (A bake whose
  // recipe no longer resolves an ingredient must not write a row saying it moved none of it.)
  if (!Number.isFinite(n) || n === 0) return null;
  if (!Array.isArray(ingredient.stockLog)) ingredient.stockLog = [];
  const entry = {
    at: at || todayISO(),
    delta: round2(n),
    why: String(why || ""),
    what: String(what || ""),
    ref: String(ref || ""),
  };
  ingredient.stockLog.unshift(entry);
  if (ingredient.stockLog.length > STOCK_LOG_CAP) ingredient.stockLog.length = STOCK_LOG_CAP;
  return entry;
}

// ★★ SET the amount on the shelf and RECORD what moved (v385).
//
// ⚠️⚠️ TWO SCREENS WRITE AN ABSOLUTE AMOUNT — a stocktake on the ingredient card, and Day one — and
// they are the SAME RULE: set the figure, then write down what changed. Keeping that rule in two view
// callbacks would mean two chances to get the sign or the comparison wrong, in code no test can reach
// without driving a pop-up. Here it is one function, tested directly.
//
// `label` builds the sentence from the two figures, because only the caller knows what to call the
// movement ("Stocktake — 1.5 kg to 2 kg" vs "Day one — 5 kg"). ⚠️ A correction that sets the same
// number is NOT a movement, and `logStock` refuses it.
export function setStock(ingredient, base, { why, label, at } = {}) {
  if (!ingredient) return null;
  const was = Number(ingredient.onHand) || 0;
  const now = round2(Math.max(0, Number(base) || 0));
  ingredient.onHand = now;
  const delta = round2(now - was);
  logStock(ingredient, { at, delta, why, what: typeof label === "function" ? label(was, now) : "" });
  return { was, now, delta };
}

// What an order is called in a stock row — the product and how many, which is how she thinks of it.
function orderLabel(state, order) {
  const p = byId(state.products || [], order && order.productId);
  return `${p ? p.name : "a product that is gone"} ×${Number(order && order.qty) || 1}`;
}

// The day a shopping list is for, as a person reads it. ⚠️ Split out of `listLabel` so a row can
// name a SHOP and still say which day's list it came off (v389) without the word "list" in the
// middle of the sentence.
function listDay(po) {
  const day = (Array.isArray(po && po.dates) && po.dates.length && po.dates[0] && po.dates[0].date)
    || (po && po.deliveryDate) || "";
  return day ? longDate(day) : "";
}

// What a shopping list is called in a stock row: its own day, the way the PO history names it.
function listLabel(po) {
  const day = listDay(po);
  return day ? `${day} list` : "shopping list";
}

export function stockOf(state, ingredient) {
  return Math.max(0, Number(ingredient && ingredient.onHand) || 0);
}

// ★★ WHAT A ROW WOULD DO IF IT WERE REMOVED, WITHOUT DOING IT (v390).
//
// Her words: __"certain listed i might want to delete after testing"__. A stock card line IS a
// movement, so **removing the line and reversing the movement are the same act** — delete a test Bought
// and the packs it added come back off the shelf. The two must not be allowed to drift apart, because a
// card whose rows no longer explain the figure is the thing v385 built this record to prevent.
//
// ⚠️ IT IS SPLIT OUT FROM `undoStockRow` SO THE CONFIRM CAN SAY THE NUMBER IN ADVANCE. A one-way change
// to her shelf, described for ever afterwards as "it was 7.5 kg", is not something a phone tap should
// discover.
export function stockRowUndo(ingredient, entry) {
  if (!ingredient || !entry) return null;
  const log = stockLogOf(ingredient);
  if (log.indexOf(entry) < 0) return null;
  const was = Number(ingredient.onHand) || 0;
  // ⚠️ STOCK NEVER GOES BELOW ZERO, so a reversal that would is CLAMPED — and the caller must show the
  // clamped figure, because that is the number her shelf will really hold.
  const now = round2(Math.max(0, was - (Number(entry.delta) || 0)));
  return { was, now, moved: round2(now - was) };
}

// Take that line off the card and put its movement back, in one step.
export function undoStockRow(ingredient, entry) {
  const plan = stockRowUndo(ingredient, entry);
  if (!plan) return null;
  ingredient.onHand = plan.now;
  stockLogOf(ingredient).splice(stockLogOf(ingredient).indexOf(entry), 1);
  return plan;
}

// ── ★★ UNDOING A WHOLE SHOP'S "BOUGHT" (v393) ─────────────────────────────────
//
// Her words: __"that delete is for deleting the whole po, what if i only want to delete one bought
// only"__ — and, asked what it should do with the money, __"call it undo is more appropriate than
// delete"__.
//
// ⚠️⚠️ IT IS CALLED **UNDO**, AND THAT IS NOT A COSMETIC CHOICE. A "delete" removes a record; an
// **undo** puts something back the way it was — and this reverses BOTH halves of what the Bought press
// did: the packs come off the shelf and the money comes off her books. **A name that promises less than
// the act is how a control gets pressed by mistake.**
//
// ⚠️ IT IS TWO STEPS ON PURPOSE, exactly as `stockRowUndo`/`undoStockRow` are: the plan is computed
// WITHOUT doing it, so the confirm can name every figure before she commits. A one-way change to her
// shelf is not something a phone tap should discover afterwards.
export function shopUndoPlan(state, items) {
  const perIngredient = new Map();
  for (const it of items || []) {
    const addBase = Number(it && it.addBase) || 0;
    if (!(addBase > 0)) continue;
    perIngredient.set(it.ingredientId, (perIngredient.get(it.ingredientId) || 0) + addBase);
  }
  const moves = [];
  for (const [ingredientId, base] of perIngredient) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    const was = Number(ing.onHand) || 0;
    // ⚠️ STOCK NEVER GOES BELOW ZERO — a bake may have used these packs since the shop was bought, so a
    // reversal that would is CLAMPED, and the caller shows her the clamped figure in advance.
    const now = round2(Math.max(0, was - base));
    moves.push({ ing, was, now, delta: round2(now - was) });
  }
  return moves;
}

// ★ AND THE REVERSAL IS WRITTEN DOWN, not just done. ⚠️ The stock card must go on explaining the
// figure it sits under: a movement that changed `onHand` and left no row would break the one rule this
// journal exists to keep (v385). So an undo writes its own row — "Un-bought — Mydin (9 Oct)" beside the
// "Bought — Mydin (9 Oct)" it cancels — the same way un-baking writes its own row beside a bake.
// ⚠️ The delta is the MEASURED change, never the shop's figure, because the clamp above may have
// stopped it short — a row claiming more than moved would not add up.
export function undoShopBought(state, moves, { shopLabel = "", day = "", ref = "" } = {}) {
  const label = shopLabel
    ? (day ? `Un-bought — ${shopLabel} (${day})` : `Un-bought — ${shopLabel}`)
    : "Un-bought — shopping list";
  for (const m of moves || []) {
    m.ing.onHand = m.now;
    logStock(m.ing, { delta: m.delta, why: "unbought", what: label, ref });
  }
  return moves || [];
}

// The base multiplier for a recipe line whose unit name may or may not exist in
// the Units list — fall back to the ingredient's own cooking unit. A unit found
// by name is only honoured when it shares the ingredient's cooking family: now
// that hr/min/cm/m exist as convertible units, a cross-family line unit (say
// "hr" on a gram ingredient) must never distort stock by a ×60/×100 factor.
function baseOf(state, ingredient, unitName) {
  const list = state.uoms || [];
  const cook = cookingUnit(list, ingredient);
  const byName = unitName
    ? list.find((u) => String(u.name || "").toLowerCase() === String(unitName).toLowerCase()
        && (!cook || u.family === cook.family))
    : null;
  const u = byName || cook;
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
  const label = orderLabel(state, order);
  for (const [ingredientId, base] of amounts) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    const before = Number(ing.onHand) || 0;
    ing.onHand = round2(Math.max(0, before - base));
    // ⚠️ THE ROW RECORDS THE CHANGE IN THE NUMBER, not the recipe's figure. ⚠️⚠️ `Math.max(0, …)`
    // above CLAMPS a subtraction that would have gone below zero — stock never goes negative — so a
    // bake against an empty shelf moves nothing, and claiming it moved the recipe's amount would
    // make the rows stop adding up to the number. **A journal whose rows do not sum to the figure it
    // explains is worse than no journal**, so the delta is measured, never assumed.
    // (A zero change is refused by `logStock` itself — a movement of nothing is not a movement.)
    logStock(ing, {
      delta: round2((Number(ing.onHand) || 0) - before),
      why: "baked",
      what: `Baked — ${label}`,
      ref: (order && order.id) || "",
    });
  }
}

// Un-marking Baked (back to Paid/Confirmed/New) puts the ingredients back.
export function addBackOrder(state, order) {
  const amounts = orderConsumption(state, order);
  if (!amounts) return;
  const label = orderLabel(state, order);
  for (const [ingredientId, base] of amounts) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    ing.onHand = round2((Number(ing.onHand) || 0) + base);
    logStock(ing, {
      delta: base,
      why: "unbaked",
      what: `Un-baked — ${label}`,
      ref: (order && order.id) || "",
    });
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
//
// ★★ A SHOP AT A TIME (v389). Her words: __"it push all ingredient into stock immediately, before i
// enter how much to pay and by what method … it should allow individual supplier bought and after pay
// only push into stock"__.
//
// ⚠️⚠️ `items` IS THE SHOP'S OWN LINES, NOT THE WHOLE LIST. The caller (`views/history.js`) passes one
// supplier group, so a press can no longer claim she bought from every shop on the run. ⚠️ AND IT
// MOVED BEHIND THE PAY BOX: this is now called from the pop-up's Save (and its Skip), never from the
// press that opened it — so closing that box without choosing leaves the shelf exactly as it was.
// **That ordering is the whole fix.**
//
// ⚠️ `shopLabel` NAMES THE SHOP ON THE ROW, and is OPTIONAL ON PURPOSE. When it is absent the row
// reads exactly as it did before (`Bought — 12 Oct 2026 list`), which is what the pre-v389 callers and
// their tests still expect; the loose "no supplier price" group passes "" and gets that older wording
// back, because there is no shop to name.
export function applyBought(state, po, items = null, shopLabel = "") {
  const list = items || (po && po.items) || [];
  const perIngredient = new Map();
  for (const it of list) {
    const addBase = Number(it && it.addBase) || 0;
    if (!(addBase > 0)) continue;
    perIngredient.set(it.ingredientId, (perIngredient.get(it.ingredientId) || 0) + addBase);
  }
  const added = [];
  const day = listDay(po);
  const label = shopLabel
    ? (day ? `Bought — ${shopLabel} (${day})` : `Bought — ${shopLabel}`)
    : `Bought — ${listLabel(po)}`;
  for (const [ingredientId, base] of perIngredient) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    ing.onHand = round2((Number(ing.onHand) || 0) + base);
    // ⚠️ `base` IS `addBase` — WHAT SHE ACTUALLY BOUGHT, which the Bought flow lets her change from
    // what the list asked for. So the row says what came into the kitchen, not what was planned.
    logStock(ing, { delta: base, why: "bought", what: label, ref: (po && po.id) || "" });
    added.push([ing, base]);
  }
  return added;
}
