// stock.js — how "on hand" stock moves. Three moments only: buying adds a saved
// PO's whole packs, baking (an order marked Baked) subtracts its recipe, and
// setting On hand on the ingredient card writes the real amount. Pure (no DOM)
// so it runs under Node for tests; the two callers (orders.js, history.js) call
// save() once afterwards.
//
// Stock is stored on each ingredient as a base-unit count (grams / millilitres /
// items) and never goes below 0. Re-adding after an undo recomputes from the
// recipe, which keeps it symmetric for a fixed recipe.

import { byId, round2, bakeId } from "./state.js";
import { expandProduct } from "./bom.js";
import { cookingUnit, baseFactorOf } from "./purchasing.js";
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
export function logStock(ingredient, { at, delta, why, what, ref, productId, keepZero = false } = {}) {
  if (!ingredient) return null;
  const n = Number(delta);
  // ⚠️ A movement of nothing is not a movement — the same rule the price log keeps. (A bake whose
  // recipe no longer resolves an ingredient must not write a row saying it moved none of it.)
  // ★★★ BUT AN ACT SHE PERFORMED IS STILL AN ACT (v542). ⚠️⚠️ Her instruction, looking at two
  // "0 g to 10 kg" rows on one phone: __"the 2nd one should label from 10kg to 10kgs"__ and __"and also +0kgs
  // for the 2nd"__. ⭐ **A stocktake that changes nothing must still say so, honestly** — because a count she
  // took is a fact about that day, and the only thing worse than showing it is showing a false one.
  // ⚠️ `keepZero` IS OPT-IN AND ONLY `setStock` PASSES IT: the rule above still holds for a BAKE, where a
  // zero is an ingredient its recipe no longer resolves — that must never write a row.
  if (!Number.isFinite(n) || (n === 0 && !keepZero)) return null;
  if (!Array.isArray(ingredient.stockLog)) ingredient.stockLog = [];
  const entry = {
    at: at || todayISO(),
    // ★★★ AND WHEN IT WAS WRITTEN, TO THE SECOND (v543). ⚠️⚠️ **`at` HAS ALWAYS BEEN A DATE AND NOTHING MORE**,
    // so two stocktakes on one day were indistinguishable — ⭐ **her own two "0 g to 10 kg" rows could not be
    // told apart, and NEITHER SHE NOR I COULD SAY WHICH CAME FIRST OR HOW FAR APART THEY WERE.** That is the
    // whole of why that could not be explained.
    // ⚠️ A SEPARATE FIELD, NOT A LONGER `at`: `dayMonth(e.at)` builds the When column from a DATE string, and
    // handing it a timestamp would break the column it is drawn in. ⚠️ **Old rows have no `ts` — they simply
    // show no time, which is true of them.**
    ts: new Date().toISOString(),
    delta: round2(n),
    why: String(why || ""),
    what: String(what || ""),
    ref: String(ref || ""),
    // ★★ WHICH PRODUCT'S BAKE WROTE THIS (v548). ⚠️ A row written by a bake had only a DAY on it, so a
    // correction could not tell one product's take from another's — see the bound in `applyBake`. ⭐ Absent
    // on every row that is not a bake, and on the ones already stored, so nothing existing changes shape.
    ...(productId ? { productId: String(productId) } : {}),
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
  // ⚠️ `keepZero: true` — **this is an absolute correction, so setting the amount it already was is a real
  // answer she gave, and the row says "10 kg to 10 kg" with a change of 0.** ⭐ The bake path below never passes
  // it, so a recipe that resolves nothing still writes no row.
  logStock(ingredient, { at, delta, why, what: typeof label === "function" ? label(was, now) : "", keepZero: true });
  return { was, now, delta };
}

// What an order is called in a stock row — the product and how many, which is how she thinks of it.
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

// ★★★ WHAT A CARD'S ROWS DO NOT EXPLAIN (v563).
//
// ⚠️⚠️ HER OWN CHECK ASKED THIS AND THE APP HAD NO ANSWER. "Check my system" found eight cards whose
// rows do not add up to the amount at the top, and the only advice on screen was about two phones
// doing one stocktake — ⭐ **which is TRUE of one of them (strong flour, rows +14 kg under a 10 kg
// shelf) and FALSE of the other seven, whose rows add up to LESS than the shelf** because the amount
// was on the shelf **before this card kept any rows at all**. ⚠️ And **no press in the app could clear
// any of them**: a stocktake sets the same amount and writes a zero row, which changes the sum not at all.
//
// ⭐ The gap is what one line would have to say for the card to explain its own figure:
//   · positive — the history is SHORT of the shelf (an opening amount was never written down);
//   · negative — the history OVER-COUNTS it (two phones writing one absolute stocktake).
export function cardGap(ingredient) {
  const log = stockLogOf(ingredient);
  const sum = round2(log.reduce((acc, e) => acc + (Number(e && e.delta) || 0), 0));
  return round2((Number(ingredient && ingredient.onHand) || 0) - sum);
}

// Write that one line. ⚠️ **THE SHELF DOES NOT MOVE** — `onHand` is not touched, because the amount at
// the top is the figure her shelves agree with; it is the HISTORY that is incomplete. ⭐ The sentence
// says which of the two it is, so the row is honest about what it is: an opening balance she never
// wrote down, or a correction of a history that counted a movement twice.
export function closeCardGap(ingredient) {
  // ⚠️⚠️ A CARD AT ITS CAP HAS ALREADY LOST ROWS, SO ITS "GAP" IS TRUNCATION, NOT AN OPENING BALANCE
  // (v583). ⚠️ Writing an "opening balance" line there would name a cause nobody found — and drop one more
  // real row to make room for it. ⭐ It writes nothing; the card itself now says its history is short.
  if (stockLogOf(ingredient).length >= STOCK_LOG_CAP) return 0;
  const gap = cardGap(ingredient);
  if (!gap) return 0;
  logStock(ingredient, {
    delta: gap,
    why: "opening",
    keepZero: true,
    what: gap > 0
      ? "Opening balance — the amount this card already held before it kept a history"
      : "History correction — a movement counted twice; the shelf is unchanged",
  });
  return gap;
}

// Every card that does not add up, in one pass — what the "Check my system" press calls.
// ⚠️ A CARD AT ITS CAP IS SKIPPED, NOT "FIXED": its oldest rows are already gone, so writing another
// row would drop one more and the sum would still be meaningless. The check skips the same cards for
// the same reason, and both say so.
export function reconcileCards(state) {
  const done = [];
  const skipped = [];
  for (const ing of (Array.isArray(state && state.ingredients) ? state.ingredients : [])) {
    if (!ing) continue;
    // ⚠️ A CARD WITH NO HISTORY IS NOT ONE THE CHECK JUDGED (v568) — `health.js` skips it for the same reason:
    // there is no history to add up, so writing an "opening" line to it would report a fault nobody found and
    // push a card at 49 rows to the cap, where the check flips to SKIPPED.
    if (!stockLogOf(ing).length) continue;
    // ⚠️⚠️ AND NOT THE ONE THAT WOULD LAND ON THE CAP (v573): a card at 49 rows goes to 50, where the check
    // can no longer judge it — ⭐ **the press said "1 card put back in step" and the line turned SKIPPED.**
    if (stockLogOf(ing).length >= STOCK_LOG_CAP - 1) { skipped.push(String(ing.name || "an ingredient")); continue; }
    const gap = closeCardGap(ing);
    if (gap) done.push({ name: String(ing.name || "an ingredient"), gap });
  }
  return { done, skipped };
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
  // ★★★ AND A ROW THE SHELF CANNOT GIVE BACK IS REFUSED, NOT CLAMPED (v546).
  //
  // ⚠️⚠️ **THE FAULT: the reversal was clamped at zero and the row was taken off the card anyway** — so its
  // WHOLE movement left the journal while only PART of it left the shelf, and **the rows that remained no longer
  // added up to the shelf they exist to explain.** ⭐ My first attempt kept the row and rewrote its delta, and
  // **my own measurement showed it did not do what it claimed** — so it was reverted, and this is the answer
  // instead.
  // ⭐ **REMOVING A ROW MEANS UNDOING THAT MOVEMENT. If the shelf cannot give it all back, the movement cannot be
  // undone** — so this says so and changes nothing. ⚠️ **The alternative was to rewrite the row into something it
  // never said**, which is the class of fault this whole week has been about.
  // ⭐ **The refusal names the way through** (her rule): a stocktake sets the real amount, which is the honest
  // tool when the shelf and the journal disagree.
  // ⚠️⚠️ A REPAIR LINE IS NOT A MOVEMENT, SO IT CANNOT BE UNDONE AS ONE (v568). ⭐ `closeCardGap` writes the
  // line that makes a card add up and **does not touch the shelf** — ⚠️ **so removing it the ordinary way
  // would move the shelf by an amount that was never there**: measured, strong flour 10 kg → 14 kg, and sea
  // salt refused outright. ⭐ The row is REFUSED with the reason; the way to change the card is the check.
  if (String(entry.why || "") === "opening") return { was, now: was, moved: 0, blocked: 0, repair: true };
  // ⚠️⚠️ AND A BAKE'S GIVE-BACK IS NOT A MOVEMENT OF ITS OWN (v572). ⭐ A correction row (a POSITIVE `produced`
  // row) is half of one arithmetic: the day's `applied` and the shelf. ⚠️ Removing it puts stock back out and
  // leaves `applied` untouched, ⚠️ **so the next correction gives back a figure the shelf never lost** — measured
  // as 9,000 where 10,000 belonged. ⭐ The way to change a day's bake is the baked box, not the ✕.
  if (String(entry.why || "") === "produced" && Number(entry.delta) > 0) {
    return { was, now: was, moved: 0, blocked: 0, correction: true };
  }
  // ⚠️⚠️ AND AN "UN-BOUGHT" ROW IS HALF OF A REVERSED PURCHASE (v592). ⚠️ The ✕ undid the stock half but left
  // the purchase order marked as still to buy — ⚠️ **so the next Buy added the packs again and wrote a second
  // expense: measured 0 → 8 kg → undo → ✕ → Buy = 16 kg.** ⭐ Undo the purchase (Purchase order history), which
  // reverses both halves.
  if (String(entry.why || "") === "unbought") {
    return { was, now: was, moved: 0, blocked: 0, unbought: true };
  }
  // ⚠️⚠️ AND A "BOUGHT" ROW BELONGS TO ITS PURCHASE (v595). ⚠️ Removing it took the stock off but left the
  // purchase marked Bought and its expense on the books — ⚠️ **a later Undo of that purchase then reversed the
  // same packs twice, writing off stock she already had (measured 5 kg → 0).** ⭐ Undo the purchase instead.
  if (String(entry.why || "") === "bought") {
    return { was, now: was, moved: 0, blocked: 0, bought: true };
  }
  const raw = round2(was - (Number(entry.delta) || 0));
  if (raw < 0) return { was, now: was, moved: 0, blocked: round2(-raw) };
  return { was, now: raw, moved: round2(raw - was), blocked: 0 };
}

// Take that line off the card and put its movement back, in one step.
export function undoStockRow(ingredient, entry, state = null) {
  const plan = stockRowUndo(ingredient, entry);
  if (!plan) return null;
  // ⚠️ A REFUSAL CHANGES NOTHING AT ALL — the row stays on the card and the shelf does not move (v546).
  if (plan.blocked || plan.repair || plan.correction || plan.unbought || plan.bought) return plan;
  ingredient.onHand = plan.now;
  stockLogOf(ingredient).splice(stockLogOf(ingredient).indexOf(entry), 1);
  // ⚠️⚠️ AND THE BAKE ROW FORGETS IT TOO (v570). ⭐ Taking a `produced` row off the card puts the shelf back —
  // so if the bake row kept saying "this day took 1,000 g", a later correction would give that 1,000 g back
  // AGAIN. ⭐ Two records of one movement, and this is where they are kept in step.
  const day = String(entry.ref || "");
  const pid = String(entry.productId || "");
  // ⚠️⚠️ AND THE SIGN MATTERS (v572). ⭐ Removing a TAKE (delta negative) gives stock back, so the memory goes
  // DOWN; removing a CORRECTION (delta positive) takes it away again, so the memory goes UP. ⚠️ Measured with
  // the absolute value: ✕ on a correction lowered the memory a second time, and the next correction gave back
  // stock that had already been accounted for.
  const signed = Number(entry.delta) || 0;
  if (state && entry.why === "produced" && day && pid && signed !== 0 && Array.isArray(state.bakedDays)) {
    const row = state.bakedDays.find((r) => r && r.id === bakeId(day, pid));
    const item = row && row.items && row.items[pid];
    if (item && item.took && typeof item.took[ingredient.id] === "number") {
      item.took[ingredient.id] = round2(Math.max(0, item.took[ingredient.id] + signed));
      // ⚠️⚠️ AND WHEN THAT WAS THE LAST THING THE BAKE TOOK, THE BAKE ROW IS EMPTY (v592). ⚠️ `applied` and
      // `total` were left saying "10 baked" while NO ingredient had come off — ⚠️ **re-saving 10 was a no-op
      // and clearing to 0 left the shelf high; the screen kept claiming a bake the shelf knew nothing about.**
      // ⭐ A row with nothing taken is a row of nothing, so it goes the same way `setBakedTotal` removes one.
      const anyLeft = Object.values(item.took).some((v) => Number(v) > 0);
      if (!anyLeft) {
        item.applied = 0;
        item.total = 0;
        delete row.items[pid];
        if (!Object.keys(row.items).length) {
          const i = state.bakedDays.findIndex((r) => r === row);
          if (i >= 0) state.bakedDays.splice(i, 1);
        }
      }
    }
  }
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
// ⚠️ THE BODY MOVED TO `purchasing.js` AS `baseFactorOf` (v545) — **the shopping list needed the same rule and
// could not import this module without a cycle.** ⭐ **One rule, three callers; this is a name, not a second
// copy** — which is the whole point.
const baseOf = baseFactorOf;

// ★★★ THE ONE READING OF A RECIPE (v514). Recipe ingredient amounts for a NUMBER of one product, in base
// units per ingredient. null when the product is gone (nothing to take off stock).
//
// ⚠️ BOTH KINDS OF BREAD COME THROUGH HERE: an order she marks **Baked**, and bread she **baked that
// nobody ordered** (v514). ⭐ **A second explosion of the same recipe is how two callers come to disagree
// about what a focaccia costs the shelf** — which is the fault this app has recorded on the run (v494,
// v507, v511) and on the green (v510), and it does not need a fourth telling.
export function productConsumption(state, product, qty) {
  if (!product) return null;
  const res = expandProduct(state, product, Number(qty) || 0);
  const total = new Map();
  for (const line of res.lines || []) {
    const ingredient = byId(state.ingredients || [], line.ingredientId);
    const base = (Number(line.qty) || 0) * baseOf(state, ingredient, line.unit);
    total.set(line.ingredientId, (total.get(line.ingredientId) || 0) + base);
  }
  return total;
}

// Recipe ingredient amounts for one order, in base units per ingredient. ⚠️ `|| 1` is the ORDER rule
// (an order with no quantity is one), kept here rather than moved into `productConsumption`, where it
// would silently mean "a bake of nothing counts as one".
function orderConsumption(state, order) {
  const product = byId(state.products || [], order && order.productId);
  return productConsumption(state, product, Number(order.qty) || 1);
}

// ★★★ BREAD SHE BAKED THAT NOBODY ORDERED (v514). Her words: __"when Jien Bake focaccia, she usually bake
// more, not according to order, sometimes for self consumption, i need system to allow us to enter bake
// qty, system dont have to track the extra bake, but just need to deduct ingredient."__
//
// ⚠️⚠️ `delta` IS THE DIFFERENCE, IN PANS, AND IT MAY BE NEGATIVE — and that is the whole design. ⭐ **The
// number she types is the TOTAL she baked** (her own choice, 16 Oct 2026), so the app never takes the
// total off the shelf: the orders take their own share off when they reach Baked, and this takes the
// REST. ⭐ **Typing 10, then changing it to 8, has to put 2 back** — which a button that only adds could
// never do, and which is why this is one function with a sign rather than a "bake" and an "unbake".
//
// ⚠️ A DELTA OF ZERO IS REFUSED, because `logStock` refuses a movement of nothing — a row saying a
// shelf moved by 0 is a row that makes the journal harder to read, not easier.
// ⚠️⚠️ `took` IS WHAT THIS DAY'S BAKE ACTUALLY TOOK OFF EACH INGREDIENT (v570). ⭐ The correction's bound
// used to be the day's `produced` ROWS — and the journal keeps only the newest 50 per ingredient, ⚠️ **so on a
// busy flour those rows fall off inside two months, and a correction then gave nothing back, wrote no row, and
// still recorded itself as applied.** ⭐ The figure is kept on the BAKE ROW now, which is not capped, and the
// journal remains the fallback for rows written before this.
// What a day's bake took off ONE ingredient: the row's own figure when it has one, otherwise the day's
// journal rows — and the answer is written ONTO the row so the next call cannot disagree with it.
function journalTake(ing, day, pid) {
  return round2(stockLogOf(ing)
    .filter((e) => e && e.why === "produced" && String(e.ref || "") === day && Number(e.delta) < 0
      && (!e.productId || String(e.productId) === pid))
    .reduce((s, e) => s - (Number(e.delta) || 0), 0));
}

function rememberTook(took, ing, ingredientId, day, pid) {
  if (!took) return null;
  if (typeof took[ingredientId] === "number") return round2(took[ingredientId]);
  const fromJournal = journalTake(ing, day, pid);
  took[ingredientId] = fromJournal;
  return fromJournal;
}

export function applyBake(state, product, dayIso, delta, took = null, appliedBefore = 0) {
  const n = Number(delta) || 0;
  if (!n) return;
  const amounts = productConsumption(state, product, Math.abs(n));
  if (!amounts) return;
  // ⚠️⚠️ A CORRECTION IS MEASURED AGAINST WHAT THE BAKE **TOOK**, NOT AGAINST TODAY'S RECIPE (v576).
  // ⭐ The recipe can change between baking and correcting. ⚠️ **Measured:** 800 g on the shelf, bake 5 pans ×
  // 100 g (took 500, shelf 300); the recipe is then changed to 20 g/pan and the bake cleared → the shelf rose
  // to **400, not 800**; with the flour line removed from the recipe it did not move at all. ⭐ So a correction
  // gives back the SHARE of what was taken — `|delta| / pans applied` — and an ingredient the recipe no longer
  // names is still visited from the memory.
  const targets = new Map(amounts);
  if (n < 0 && took) {
    for (const id of Object.keys(took)) {
      if (!targets.has(id) && byId(state.ingredients || [], id)) targets.set(id, 0);
    }
  }
  const pans = Math.abs(n);
  const name = String((product && product.name) || "baked goods");
  const what = n > 0 ? `Baked extra — ${pans} × ${name}` : `Extra bake corrected — ${pans} × ${name}`;
  for (const [ingredientId, base] of targets) {
    const ing = byId(state.ingredients || [], ingredientId);
    if (!ing) continue;
    const before = Number(ing.onHand) || 0;
    // ★★★ AND A CORRECTION MAY NEVER PUT BACK MORE THAN THE BAKE ACTUALLY TOOK (v545).
    //
    // ⚠️⚠️ **MEASURED, ON THE REAL FUNCTIONS: 1,000 g on the shelf, bake 10 (it needs 2,500 g) — the shelf
    // stops at 0, correctly — then correct that bake back to 0, and the shelf becomes 2,500 g. ⭐ SHE STARTED
    // WITH 1,000 g: the correction INVENTED 1,500 g OF FLOUR.**
    // ⚠️ **The deduction is clamped at zero and the add-back was not** — so the journal read −1,000 then
    // +2,500 for a bake that netted nothing, and the shelf drifted permanently away from reality.
    // ⭐ **The bound is the day's OWN journal**: the most that may come back is what this day's bake actually
    // took off this ingredient. ⚠️ **If those rows were deleted, nothing comes back** — the delta is 0, no row
    // is written, and the shelf does not move, which is exactly right.
    // ⭐ **AND IT MAKES THE JOURNAL SUM TO THE SHELF BY CONSTRUCTION**, because every row is the change that
    // really happened.
    // ⚠️ WHICH PRODUCT THIS ROW BELONGS TO (v548) — read by the bound below and written on the row.
    const pid = String((product && product.id) || "");
    let give = base;
    if (n < 0) {
      const day = String(dayIso || "");
      // ⚠️⚠️ AND IT MUST BE THIS PRODUCT'S TAKE, NOT THE WHOLE DAY'S (v548). ⚠️ **MEASURED: the shelf was
      // 1,000 g, product A's bake took all of it, product B's bake took nothing — and correcting B back to
      // zero put 1,000 g back.** ⭐ v545 wrote this bound when a baking day was ONE record; v546 made it one
      // record PER PRODUCT and **this filter was not re-read** — the same shape as the van that went to her
      // own kitchen: when a thing stops being per-day and becomes per-product, every per-day filter must
      // be re-read. ⚠️ Rows stored before v548 carry no product id and are still counted, or an old
      // correction would suddenly refuse to give anything back.
      // ⚠️⚠️ THE BAKE ROW'S OWN FIGURE, SEEDED FROM THE JOURNAL THE FIRST TIME IT IS TOUCHED (v572).
      // ⭐ A record written before v570 has no `took`; reading the journal ONLY for this call left the row
      // without it, so the next add wrote a number that permanently shadowed the journal — ⚠️ **measured:
      // 10 pans → correct to 6 → back to 10 → clear, and 1,500 g stayed off the shelf with no bake row left
      // to explain it.** ⭐ The journal's figure is COPIED ONTO THE ROW here, and every later call reads it.
      const remembered = rememberTook(took, ing, ingredientId, day, pid);
      // ⚠️ A caller with no memory at all (a direct `applyBake`, or a row this build has never touched) still
      // gets the journal's answer — the rule before v570, kept for those two callers (v572).
      const available = remembered != null ? Math.max(0, remembered) : (!took ? journalTake(ing, day, pid) : 0);
      // ⭐ The share of the day's take this correction undoes. With the recipe unchanged it is exactly what
      // the recipe says; with a changed recipe it is the only honest answer, because the shelf moved by the
      // OLD recipe. ⚠️ With nothing recorded as applied, fall back to the old recipe-bounded figure.
      const share = Number(appliedBefore) > 0 ? (Number(n) < 0 ? Math.abs(Number(n)) : 0) / Number(appliedBefore) : 1;
      give = appliedBefore > 0
        ? Math.min(round2(available * Math.min(1, share)), round2(available))
        : Math.min(base, round2(available));
      if (!(give > 0)) continue; // nothing was taken that day — nothing to give back, and no row
      if (remembered != null && took) took[ingredientId] = round2(Math.max(0, remembered - give));
    }
    // ⚠️ `Math.max(0, …)` mirrors `consumeOrder`: stock never goes below zero, so a bake against an empty
    // shelf moves nothing — and the row records the movement that HAPPENED, never the recipe's figure,
    // or the journal stops summing to the number it explains.
    ing.onHand = round2(Math.max(0, before + (n > 0 ? -base : give)));
    // ⭐ AND WHAT THIS BAKE TOOK IS KEPT ON THE BAKE ROW (v570) — the figure a later correction is bounded by.
    if (n > 0 && took) {
      // ⚠️ Seed the OLD take before adding to it, or an add on a pre-v570 row shadows the journal (v572).
      rememberTook(took, ing, ingredientId, String(dayIso || ""), pid);
      took[ingredientId] = round2((Number(took[ingredientId]) || 0) + Math.max(0, before - ing.onHand));
    }
    logStock(ing, {
      delta: round2((Number(ing.onHand) || 0) - before),
      why: "produced",
      // ⚠️⚠️ AND WHEN THE GIVE-BACK IS CAPPED, THE ROW SAYS SO (v560). ⭐ Her own card showed
      // **"Extra bake corrected — 10 × Focaccia"** against **+2 kg**: the label named the size of the
      // correction while the change was only what that day's bake had actually taken off. ⭐ **A row whose
      // two numbers describe different things is the fault this app keeps meeting** — so the capped row
      // stops quoting the pans and says what came back.
      what: (n < 0 && give < base)
        ? `Extra bake correction — ${name}, only what this day's bake took`
        : what,
      ref: String(dayIso || ""),
      productId: pid,
    });
  }
}

// ── what she actually baked, by day (v514) ───────────────────────────────────────────────────────────
//
// ⚠️⚠️ IT IS A **TOP-LEVEL LIST**, `state.bakedDays`, AND THE BAKER IS THE ONE WHO PROVED IT HAD TO BE:
// __"and my phone and my mac not sync"__.
//
// ⭐ **My first version put it inside `state.settings`, on the strength of a comment at the top of
// `sync.js` saying a new FIELD there needs no registration. That comment is about the `LISTS` map — and
// the settings payload is a HAND-WRITTEN WHITELIST (`recordPayload`), so the key left her phone and went
// NOWHERE.** ⚠️ **A comment is not the producer: read the code that builds the payload.**
//
// ⚠️ AND A LIST IS RIGHT FOR A SECOND REASON, which is the one v444 already paid for: **`settings` is ONE
// row whose `data` is replaced whole on push, so two phones both holding records would overwrite each
// other.** ⭐ **A list is one row PER RECORD (`kind, id, data`), so two phones adding different days MERGE.**
//
// ⚠️ And it deliberately does NOT live on a `deliveryDates` row: **that is what the storefront publishes**,
// so recording production there would put a day she never opened on sale in her own shop.
//
// Shape: `bakedDays = [{ id: "bake_2026-10-16", date: "2026-10-16", items: { [productId]: { total, applied } } }]`.
// ⭐ The id is DERIVED FROM THE DAY, so two phones recording the same day upsert ONE row rather than
// inventing a second — which is the same reason the order number is a key.
//   `total`   — how many she typed, for showing back to her.
//   `applied` — **the extra pans actually taken off the shelf so far.** ⭐ Storing what we DID, rather than
//               recomputing it from the orders each time, is what makes a correction exact: the shelf
//               follows the difference from a number we know we moved.
export function bakedDayOf(state, dayIso, productId) {
  const day = String(dayIso || "");
  const pid = String(productId || "");
  if (!day || !pid) return null;
  return (state.bakedDays || []).find((r) => r && r.id === bakeId(day, pid)) || null;
}

export function bakedOf(state, dayIso, productId) {
  const row = bakedDayOf(state, dayIso, productId);
  return (row && row.items && row.items[String(productId || "")]) || null;
}

// ⭐ SET THE TOTAL, AND TAKE OFF ONLY THE DIFFERENCE.
//
// ⚠️⚠️ **THE NUMBER SHE TYPES IS THE TOTAL SHE BAKED, NOT THE EXTRA** (her choice, 16 Oct 2026). So the
// orders keep taking their own share off when they reach *Baked*, and this takes **the rest**. ⭐ **Typing
// 10 with 6 ordered must move 4** — and typing 8 afterwards must put 2 back.
//
// ⚠️ `ordered` IS EVERY ORDER ON THAT DAY, WHATEVER STAGE IT IS AT — **not only the ones already marked
// Baked.** ⭐ Counting only the baked ones would take the same bread off twice: once here, and again when
// she marks them. ⚠️ And it is passed in rather than read here, because the caller already reads it from
// `orderedOnDay` — the one reading the shopping list uses.
export function setBakedTotal(state, product, dayIso, total) {
  const day = String(dayIso || "");
  const pid = String((product && product.id) || "");
  if (!day || !pid) return { wanted: 0, delta: 0 };
  const list = state.bakedDays || (state.bakedDays = []);
  // ⚠️ THE KEY IS THE DAY **AND THE PRODUCT** (v546) — see `bakeId`. ⭐ **Two phones recording different bread
  // on one day make two rows, not two versions of one.**
  let row = list.find((r) => r && r.id === bakeId(day, pid));
  if (!row) {
    row = { id: bakeId(day, pid), date: day, items: {} };
    list.push(row);
  }
  const items = row.items || (row.items = {});
  const entry = items[pid] || (items[pid] = { total: 0, applied: 0 });

  // ⭐⭐ THE WHOLE TOTAL COMES OFF, because nothing else does (v516). ⚠️ The subtraction that used to be
  // here — `total − ordered` — existed only while orders took their own share off, and **it is the line
  // that double-counted every order made after the bake.**
  const wanted = Math.max(0, Number(total) || 0);
  const delta = wanted - (Number(entry.applied) || 0);
  // ⭐ The bake row carries what each ingredient's bake actually took, so a correction does not depend on a
  // journal that keeps only its newest rows (v570).
  if (!entry.took || typeof entry.took !== "object") entry.took = {};
  // ⚠️ `entry.applied` BEFORE the change is what the correction is measured against (v576).
  applyBake(state, product, day, delta, entry.took, Number(entry.applied) || 0);   // ⭐ a delta of 0 is refused inside
  entry.total = Number(total) || 0;
  entry.applied = wanted;

  // ⚠️ AND A DAY SHE HAS CLEARED BACK TO NOTHING LEAVES NO RECORD BEHIND. ⭐ Zero total means zero applied
  // (see above), so an entry of `{total:0, applied:0}` is a record of nothing — and a list row is a row on
  // her other phone, so it would sit there for ever.
  if (!entry.total && !entry.applied) {
    delete items[pid];
    if (!Object.keys(items).length) {
      const i = list.findIndex((r) => r === row);
      if (i >= 0) list.splice(i, 1);
    }
  }
  return { wanted, delta };
}

// ★★★★ AND AN ORDER NO LONGER MOVES THE SHELF AT ALL (v516). ⚠️⚠️ Her words, choosing between the schemes:
// __"only take away ingredient when baked. And the order dont take away ingredient, then it can be clean
// cut"__ — ⭐ **and it is the right rule: FLOUR LEAVES THE SHELF WHEN SHE BAKES, NOT WHEN SHE SELLS.** A sale
// does not use up flour; only the oven does.
//
// ⚠️ WHAT WAS HERE, AND WHAT IT COST — MEASURED WITH HER OWN NUMBERS: `consumeOrder` took an order's recipe
// off the moment it was marked **Baked**, and `addBackOrder` put it back when the stage was undone. ⭐ **So
// two different things moved the shelf, and they double-counted the moment an order was made AFTER the
// bake:** bake 10 (10 loaves off), then a customer takes 4 of those 10 and the order is marked Baked →
// **4 MORE came off, for 14 loaves of flour out of a 10-loaf bake.**
//
// ⭐⭐ **ONE EVENT, ONE DOOR: `applyBake` above, fed by the day's own total.** ⚠️ **Nothing was given back:**
// the rows those old Baked marks wrote are in her journal and her shelf stands exactly where it stood — this
// changes what happens NEXT, never what happened before. ⚠️ **And the "Baked" stage still moves the order**
// along its journey; only the stock movement is gone.

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
