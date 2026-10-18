// test/stock.test.js — ingredient on-hand stock moves: Bought adds a saved
// PO's whole packs, baking (an order marked Baked) subtracts its recipe and an
// undo puts it back, and stock never goes below zero. Pure functions (no DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockOf, applyBought, applyBake, setBakedTotal, bakedOf,
  stockLogOf, logStock, setStock, STOCK_LOG_CAP,
  stockRowUndo, undoStockRow, shopUndoPlan, undoShopBought,
} from "../admin/js/stock.js";
import { orderedOnDay } from "../admin/js/bom.js";
import { computeSlots } from "../admin/js/supabase.js";
import * as stockMod from "../admin/js/stock.js";

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

// ★★★★ NO ORDER AND NO STAGE MOVES THE SHELF ANY MORE (v516).
//
// ⚠️⚠️ Her words, choosing between the schemes: __"only take away ingredient when baked. And the order dont
// take away ingredient, then it can be clean cut"__. ⭐ **Flour leaves the shelf when she BAKES, not when she
// SELLS** — a sale does not use up flour; only the oven does.
//
// ⚠️ Until v515 an order marked Baked took its own recipe off as well, and the day's baking box took only
// the difference — which DOUBLE-COUNTED every order made AFTER the bake.
test("★★★ the day's baked total is the ONLY thing that moves the shelf (v516)", () => {
  // ⚠️ ENOUGH ON THE SHELF FOR THE WHOLE BAKE — 10 × 250 g needs 2,500 g, and a fixture that runs out
  // would have the CLAMP answer for it instead of the arithmetic.
  const ing = flour(5000);
  const st = baseState([ing, butter(5000)], [bread()]);
  const p = st.products[0];

  setBakedTotal(st, p, "2026-10-19", 10);
  assert.equal(ing.onHand, 5000 - 250 * 10,
    "★ the WHOLE ten did not come off — **nothing else takes flour off any more, so the total must be the "
    + "whole of it**");
  assert.equal(st.ingredients[1].onHand, 5000 - 40 * 10, "…and the same for the butter");

  // ⚠️ AND THE ORDER PATH IS GONE, not merely unused: ⭐ **a function left lying about is a function the
  // next person calls.**
  const stock = stockMod;
  assert.equal(typeof stock.consumeOrder, "undefined",
    "★ `consumeOrder` is back — an order would take the same bread off a second time, which is the "
    + "double-count this rule exists to stop");
  assert.equal(typeof stock.addBackOrder, "undefined", "`addBackOrder` is back — un-marking Baked would ADD flour back that was never taken");
  assert.equal(typeof stock.adjustForStatus, "undefined", "★ a stage change can move the shelf again");
});

test("★★★ her own case: bake 10, then sell 4 of them, and the shelf moves ONCE (v516)", () => {
  // ⚠️⚠️ THE SCENARIO SHE PUT, IN HER WORDS: __"say today i bake 10, tomorrow i sell 4. will it be too
  // complex?"__ — ⭐ and it was, under the old scheme: the shelf gave up flour for FOURTEEN. **MEASURED on
  // the real app before this version: 5,000 g → 2,500 g on the bake, then → 1,500 g when the 4-loaf order
  // was marked Baked.**
  const ing = flour(5000);
  const st = baseState([ing], [bread()]);
  const p = st.products[0];

  setBakedTotal(st, p, "2026-10-19", 10);              // today: baked 10
  assert.equal(ing.onHand, 5000 - 250 * 10, "the bake itself did not take ten loaves off");

  st.orders = [{ id: "o1", productId: "p_bread", qty: 4, status: "baking" }];   // tomorrow: 4 of them sold, marked Baked
  const before = ing.onHand;
  setBakedTotal(st, p, "2026-10-19", 10);              // the day's total is unchanged, so nothing should move
  assert.equal(ing.onHand, before,
    "★ the shelf moved again for a SALE — **those four came out of the ten she had already accounted for**");
  assert.equal(ing.onHand, 5000 - 250 * 10, "ten baked, ten loaves of flour — and not fourteen");
});

test("consumption never drives stock below zero (it reads 0 until the next Bought)", () => {
  const ing = flour(300);
  const st = baseState([ing], [bread()]);
  applyBake(st, st.products[0], "2026-10-19", 2);
  assert.equal(ing.onHand, 0);
});

test("recipe lines typed in kg convert to base grams when baking", () => {
  const ing = flour(1000);
  const st = baseState([ing], [{ id: "p", name: "X", active: true,
    recipe: [{ ingredientId: "ing_f", qty: 0.5, unit: "kg" }] }]);
  applyBake(st, st.products[0], "2026-10-19", 2);
  assert.equal(ing.onHand, 0, "0.5 kg × 2 = 1000 g comes off");
});

test("a time/length line unit never leaks into ingredient stock (family guard)", () => {
  // hr (60) and m (100) now exist as convertible units. A recipe line that
  // happens to say "hr" on a gram ingredient must fall back to grams — baking
  // subtracts 2 g, never 2 × 60 = 120 g.
  const ing = flour(1000);
  const st = baseState([ing], [{ id: "p", name: "X", active: true,
    recipe: [{ ingredientId: "ing_f", qty: 2, unit: "hr" }] }]);
  st.uoms.push({ id: "hr", name: "hr", family: "time", toBase: 60 });
  applyBake(st, st.products[0], "2026-10-19", 1);
  assert.equal(ing.onHand, 998, "2 hr on a gram ingredient reads as 2 g");
});

test("a bake of a product that is gone takes nothing off stock", () => {
  const ing = flour(100);
  const st = baseState([ing], []);
  applyBake(st, null, "2026-10-19", 5);
  assert.equal(ing.onHand, 100);
});

// ── ★★ the stock journal (v385) ───────────────────────────────────────────────
// Her words: __"why only show when there is price movement, qty movement cannot?"__ — and the honest
// answer was that quantity movements were never RECORDED at all. Every one of them just overwrote the
// number, so "why is my flour at 2 kg?" had no answer. Rows now name what moved AND why.

test("★★ a bake writes a row naming the PRODUCT and the day, with what actually came off", () => {
  const ing = flour(1000);
  const st = baseState([ing], [bread()]);
  applyBake(st, st.products[0], "2026-10-19", 2);   // 250 g × 2
  const log = stockLogOf(ing);
  assert.equal(log.length, 1, "the bake wrote no stock row");
  assert.equal(log[0].delta, -500, "the row does not carry what came off, signed");
  assert.equal(log[0].why, "produced");
  assert.match(log[0].what, /Baked extra — 2 × Sourdough/,
    "the row does not say WHAT was baked — a bare number does not answer 'where did my flour go'");
  assert.equal(log[0].ref, "2026-10-19", "the row cannot be tied back to the day it belongs to");
});

test("★ correcting a bake upward and back down writes rows that cancel out", () => {
  const ing = flour(1000);
  const st = baseState([ing], [bread()]);
  applyBake(st, st.products[0], "2026-10-19", 2);
  applyBake(st, st.products[0], "2026-10-19", -2);
  const log = stockLogOf(ing);
  assert.equal(log.length, 2);
  assert.equal(log[0].delta, 500, "the newest row is not the correction going back up");
  assert.match(log[0].what, /Extra bake corrected/);
  // ⚠️ THE ROWS MUST EXPLAIN THE NUMBER. This is the whole point of a journal: add up what it lists
  // and you get the figure on the shelf.
  assert.equal(log.reduce((n, e) => n + e.delta, 0), 0, "the rows do not add up to the change in stock");
  assert.equal(ing.onHand, 1000);
});

test("★★⚠️ a bake against an EMPTY shelf records what actually moved, not the recipe's figure", () => {
  // ⚠️⚠️ THE INVARIANT, AND THE REASON THIS IS MEASURED RATHER THAN ASSUMED. Stock never goes below
  // zero, so a bake against an empty shelf moves NOTHING — and a row claiming it moved the recipe's
  // 250 g would make the journal stop adding up to the figure it is meant to explain. **Rows that do
  // not sum to the number are worse than no journal.**
  const ing = flour(100);
  const st = baseState([ing], [bread()]);
  applyBake(st, st.products[0], "2026-10-19", 2);   // the recipe wants 500 g; only 100 g is there
  assert.equal(ing.onHand, 0, "stock went below zero");
  const log = stockLogOf(ing);
  const claimed = log.reduce((n, e) => n + e.delta, 0);
  assert.equal(claimed, -100, `the rows claim ${claimed} g left the shelf; 100 g did`);
});

test("★ buying writes a row naming the list, for what she ACTUALLY bought", () => {
  const ing = flour(0);
  const st = baseState([ing], [bread()]);
  applyBought(st, {
    id: "po_9", deliveryDate: "2026-10-12",
    items: [{ ingredientId: "ing_f", addBase: 5000, qty: 5, unit: "kg" }],
  });
  const log = stockLogOf(ing);
  assert.equal(log.length, 1, "buying wrote no stock row");
  assert.equal(log[0].delta, 5000);
  assert.equal(log[0].why, "bought");
  assert.match(log[0].what, /Bought — 12 Oct 2026 list/, "the row does not name the list it came from");
  assert.equal(log[0].ref, "po_9");
});

// ★★ AND WHEN THE BUYING WAS ONE SHOP, THE ROW NAMES THE SHOP (v389).
//
// ⚠️⚠️ THIS IS THE ROW SHE WILL ACTUALLY READ when she asks where a pack came from. A run is several
// shops on one day, so three rows all reading "Bought — 12 Oct 2026 list" would answer nothing at all.
// The day is kept in brackets so the row still says which LIST it came off.
test("★★ buying one shop writes a row naming that shop, and still says which day's list", () => {
  const ing = flour(0);
  const st = baseState([ing], [bread()]);
  const items = [{ ingredientId: "ing_f", addBase: 5000 }];
  applyBought(st, { id: "po_9", deliveryDate: "2026-10-12", items }, items, "Mydin");
  assert.match(stockLogOf(ing)[0].what, /Bought — Mydin \(12 Oct 2026\)/,
    "the row does not name the SHOP — a run's shops would read identically on the stock card");
});

// ⚠️ AND A NAMELESS SHOP KEEPS THE OLDER WORDING rather than leaving a gap in the sentence. The loose
// "no supplier price" group goes through exactly this path, and it must not read "Bought —  (12 Oct)".
test("⚠️ a nameless shop keeps the older wording rather than a gap in the sentence", () => {
  const ing = flour(0);
  const st = baseState([ing], [bread()]);
  const items = [{ ingredientId: "ing_f", addBase: 5000 }];
  applyBought(st, { id: "po_9", deliveryDate: "2026-10-12", items }, items, "");
  assert.match(stockLogOf(ing)[0].what, /Bought — 12 Oct 2026 list/);
});

test("⚠️ a movement of NOTHING is not written — a row saying zero moved is noise", () => {
  const ing = flour(0);
  assert.equal(logStock(ing, { delta: 0, why: "baked", what: "Baked — nothing" }), null);
  assert.equal(stockLogOf(ing).length, 0);
  assert.equal(logStock(ing, { delta: NaN, why: "baked", what: "x" }), null);
  // …and a bake with nothing on the shelf therefore writes nothing at all.
  const st = baseState([ing], [bread()]);
  applyBake(st, st.products[0], "2026-10-19", 1);
  assert.equal(stockLogOf(ing).length, 0, "the journal recorded a movement that did not happen");
});

// ── ★★ taking a mistaken line back off the card (v390) ───────────────────────
// Her words: __"certain listed i might want to delete after testing"__.

test("★★⚠️ removing a card line puts its movement back — the row and the shelf move together", () => {
  // ⚠️⚠️ A LINE ON THIS CARD IS A MOVEMENT, so removing the line and reversing the movement are ONE
  // act. Reversing only the list would leave her shelf holding packs she had just deleted the record
  // of; reversing only the shelf would leave a card whose rows no longer explain the figure above them.
  const ing = flour(7500);
  logStock(ing, { at: "2026-10-08", delta: 8000, why: "bought", what: "Bought — Mydin" });
  logStock(ing, { at: "2026-10-09", delta: -500, why: "baked", what: "Baked — Sourdough ×2" });
  const bake = stockLogOf(ing)[0]; // newest first, so this is the bake

  const plan = stockRowUndo(ing, bake);
  assert.equal(plan.was, 7500, "the plan does not say where the shelf was");
  assert.equal(plan.now, 8000, "undoing a bake that took 500 g must put the 500 g back");

  undoStockRow(ing, bake);
  assert.equal(ing.onHand, 8000, "the shelf did not move with the row");
  assert.equal(stockLogOf(ing).length, 1, "the row was not taken off the card");
  assert.equal(stockLogOf(ing)[0].why, "bought", "the wrong row came off");
});

// ★★★ v546 — SHE CHANGED THIS RULE, AND THE OLD ONE LEFT THE JOURNAL NOT ADDING UP.
//
// ⚠️ The old rule CLAMPED the reversal at zero and then took the row off the card anyway — ⭐ **so its whole
// movement left the journal while only part of it left the shelf, and the rows that remained no longer added up
// to the shelf they exist to explain.**
// ⚠️ **My first attempt kept the row and rewrote its delta — and my own measurement showed it did not do what
// its comment claimed** (shelf 0, journal 5,000), so it was reverted.
// ⭐ **REMOVING A ROW MEANS UNDOING THAT MOVEMENT. If the shelf cannot give it all back, it cannot be undone** —
// so it is REFUSED, nothing changes, and the way through is a stocktake.
test("★★★ a removal the shelf cannot give back is REFUSED, and nothing moves", () => {
  const ing = flour(7500);
  logStock(ing, { at: "2026-10-08", delta: 8000, why: "bought", what: "Bought — Mydin" });
  const plan = stockRowUndo(ing, stockLogOf(ing)[0]);
  assert.equal(plan.now, 7500, "★ the plan offered a figure her shelf can never hold — and worse, it offered to "
    + "take a movement back that the shelf cannot cover");
  assert.equal(plan.blocked, 500, "★ the refusal does not say HOW MUCH the shelf is short, so the message "
    + "cannot name the way through");
  assert.equal(plan.moved, 0, "a refused removal reports movement");

  // ⭐ AND THE ROW STAYS, AND THE SHELF STAYS — a refusal must change nothing at all.
  const before = stockLogOf(ing).length;
  undoStockRow(ing, stockLogOf(ing)[0]);
  assert.equal(ing.onHand, 7500, "★ a refused removal moved her shelf");
  assert.equal(stockLogOf(ing).length, before, "★ a refused removal took the row off the card anyway — **that "
    + "is the fault: the journal then stops adding up to the shelf it explains**");
});

test("⚠️ a row that is not on the card cannot be removed through it", () => {
  const ing = flour(1000);
  assert.equal(stockRowUndo(ing, { at: "2026-01-01", delta: 5, why: "bought", what: "x" }), null,
    "a stale row object was allowed to move her stock");
  assert.equal(undoStockRow(ing, null), null);
  assert.equal(ing.onHand, 1000, "and her shelf is untouched");
});

// ── ★★ undoing one shop's Bought (v393) ──────────────────────────────────────
// Her words: __"that delete is for deleting the whole po, what if i only want to delete one bought
// only"__ — and, on what to call it, __"call it undo is more appropriate than delete"__.

test("★★ undoing a shop's Bought takes ITS packs back off, and writes the reversal down", () => {
  const f = flour(8000);
  const b = butter(500);
  const st = baseState([f, b], []);
  const items = [
    { ingredientId: "ing_f", addBase: 8000 },
    { ingredientId: "ing_b", addBase: 500 },
  ];

  const plan = shopUndoPlan(st, items);
  assert.equal(plan.length, 2, "the plan does not cover every line the shop added");
  assert.deepEqual(plan.map((m) => m.now), [0, 0], "the plan does not say where each shelf lands");

  undoShopBought(st, plan, { shopLabel: "Mydin", day: "9 Oct 2026", ref: "po1" });
  assert.equal(f.onHand, 0, "the flour did not come back off the shelf");
  assert.equal(b.onHand, 0, "the butter did not come back off the shelf");

  // ⚠️⚠️ THE CARD MUST STILL EXPLAIN THE FIGURE. A reversal that moved the shelf and left no row would
  // break the one rule this journal exists to keep (v385) — which is why un-baking writes a row too.
  assert.equal(stockLogOf(f).length, 1, "the reversal was not written down");
  assert.equal(stockLogOf(f)[0].delta, -8000, "the row does not carry what came back off, signed");
  assert.equal(stockLogOf(f)[0].why, "unbought");
  assert.match(stockLogOf(f)[0].what, /Un-bought — Mydin \(9 Oct 2026\)/,
    "the row does not name the shop the packs went back to");
});

test("⚠️ a reversal that would take stock below zero is CLAMPED, and the row says what really moved", () => {
  // ⚠️ A bake may have used these packs since the shop was bought. Stock never goes below zero, so the
  // reversal stops there — ⚠️⚠️ and the row records the MEASURED change, never the shop's figure, or the
  // journal would go on claiming a movement that never happened.
  const ing = flour(1000);
  const st = baseState([ing], []);
  const plan = shopUndoPlan(st, [{ ingredientId: "ing_f", addBase: 8000 }]);
  assert.equal(plan[0].now, 0, "the plan offered a figure her shelf can never hold");
  undoShopBought(st, plan, { shopLabel: "Mydin", ref: "po1" });
  assert.equal(ing.onHand, 0);
  assert.equal(stockLogOf(ing)[0].delta, -1000, "⚠️ the row claims more came off than did");
});

test("⚠️ a shop whose lines the shelf already covered plans no movement at all", () => {
  const ing = flour(500);
  const st = baseState([ing], []);
  assert.deepEqual(shopUndoPlan(st, [{ ingredientId: "ing_f", addBase: 0 }]), [],
    "an undo of nothing was planned as a movement");
});

test("★ the log is capped, newest first, and the OLDEST rows fall off", () => {
  const ing = flour(0);
  for (let i = 0; i < STOCK_LOG_CAP + 10; i++) {
    logStock(ing, { at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, delta: 1, why: "bought",
      what: `Bought — list ${i}`, ref: `po_${i}` });
  }
  const log = stockLogOf(ing);
  assert.equal(log.length, STOCK_LOG_CAP, "the cap did not hold");
  assert.match(log[0].what, new RegExp(`list ${STOCK_LOG_CAP + 9}$`), "the newest row is not first");
  assert.doesNotMatch(log[log.length - 1].what, /list 0$/,
    "the oldest rows were kept and the newest dropped");
});

// ── ★ the two ABSOLUTE writes — a stocktake and Day one (v385) ────────────────
// ⚠️ Both screens set the amount outright rather than adding or subtracting, and that is why they
// share one function: "set the figure, then write down what changed" is ONE rule, and a rule living
// in two view callbacks would be a rule no test could reach without driving a pop-up.

test("★ a stocktake sets the amount and records the change", () => {
  const ing = flour(1500);
  const r = setStock(ing, 2000, { why: "stocktake", label: (was, now) => `Stocktake — ${was} to ${now}` });
  assert.equal(ing.onHand, 2000, "the figure on the shelf was not set");
  assert.deepEqual([r.was, r.now, r.delta], [1500, 2000, 500]);
  const log = stockLogOf(ing);
  assert.equal(log.length, 1);
  assert.equal(log[0].delta, 500, "the row does not carry what actually changed");
  assert.equal(log[0].why, "stocktake");
  assert.equal(log[0].what, "Stocktake — 1500 to 2000", "the caller's own words did not reach the row");
});

test("★ a stocktake DOWN is recorded as a negative move", () => {
  const ing = flour(2000);
  setStock(ing, 1500, { why: "stocktake", label: () => "Stocktake — down" });
  assert.equal(stockLogOf(ing)[0].delta, -500, "a correction downwards recorded as an increase");
});

// ★★★ v542 — SHE CHANGED THIS RULE, AND SHE IS RIGHT.
//
// ⚠️ The old rule was "a correction that changes nothing is not a movement", and it was sound. ⚠️⚠️ **But she
// was looking at two identical "0 g to 10 kg" rows on ONE phone and said what the second should have been:**
// __"the 2nd one should label from 10kg to 10kgs"__ — and __"and also +0kgs for the 2nd"__.
// ⭐⭐ **A count she took is a fact about that day, and the only thing worse than showing it is showing a FALSE
// one.** ⚠️ **So a stocktake that changes nothing now writes the truth — "10 kg to 10 kg", a change of 0** — and
// the press says so out loud instead of leaving a row to be found later.
//
// ⚠️ THE OLD RULE STILL HOLDS WHERE IT WAS AIMED: a **bake** whose recipe resolves no ingredient must write NO
// row at all — a zero there means "this recipe does not touch this ingredient", not "she counted it". That is
// the assertion under this one.
test("★★ a stocktake that sets the SAME number now says so — 10 kg to 10 kg, +0", () => {
  const ing = flour(1500);
  const r = setStock(ing, 1500, { why: "stocktake", label: (was, now) => `Stocktake — ${was} to ${now}` });
  assert.equal(ing.onHand, 1500, "the shelf was moved by a correction that sets the same amount");
  assert.equal(r.delta, 0, "a correction that changed nothing reports a change");
  const log = stockLogOf(ing);
  assert.equal(log.length, 1,
    "★ a stocktake that changed nothing wrote NO row — **she asked for exactly this row, and without it the "
    + "count she took is invisible**");
  assert.equal(log[0].delta, 0, "★ the row claims a movement the shelf did not make — **a false row is worse "
    + "than no row**");
  assert.equal(log[0].what, "Stocktake — 1500 to 1500", "the row does not name both figures");
});

test("★★★ a stock row records WHEN it was written, so two on one day can be told apart (v543)", () => {
  // ⚠️⚠️ **`at` HAS ALWAYS BEEN A DATE AND NOTHING MORE**, so her two "0 g to 10 kg" rows on 17 Oct were
  // indistinguishable — ⭐ **neither of us could say which came first, or whether they were a second or an hour
  // apart, and that is the whole of why it could not be explained.**
  const ing = flour(0);
  logStock(ing, { delta: 10, why: "stocktake", what: "Stocktake — 0 g to 10 kg" });
  logStock(ing, { delta: 10, why: "stocktake", what: "Stocktake — 0 g to 10 kg" });
  const log = stockLogOf(ing);
  assert.equal(log.length, 2, "precondition: two rows were not written");
  assert.match(String(log[0].ts), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "★ the row carries NO TIME — **two movements on one day cannot be told apart, which is exactly the state "
    + "her own journal was in**");
  // ⚠️ AND `at` MUST STAY A PLAIN DATE: the When column is built with `dayMonth(e.at)`, which is `longDate`
  // with the year sliced off. ⭐ **A timestamp there would break the column it is drawn in** — the reason the
  // time went into its own field rather than into `at`.
  assert.match(String(log[0].at), /^\d{4}-\d{2}-\d{2}$/,
    "★ `at` is no longer a plain date — **the When column builds from it and would stop rendering**");
});

test("⚠️ but a BAKE that resolves no ingredient still writes NOTHING", () => {
  // ⚠️ THE RULE ABOVE IS OPT-IN, AND THIS IS WHY: a zero from a recipe means "this bake does not touch this
  // ingredient", which is not something she did — it is something the app could not find.
  const ing = flour(1500);
  assert.equal(logStock(ing, { delta: 0, why: "produced", what: "Baked extra — 0 × Focaccia" }), null,
    "★ a bake wrote a row saying it moved none of an ingredient — **a movement of nothing is not a movement, "
    + "and a row saying otherwise would fill her journal with noise no one performed**");
  assert.equal(stockLogOf(ing).length, 0);
});

test("⚠️ an impossible amount is floored at nothing, and the row says what really moved", () => {
  // ⚠️ Stock never goes below zero, so the row must report the change in the NUMBER — not the figure
  // she typed. A negative typed by accident must not make the journal claim stock left the shelf that
  // never did, or the rows stop adding up to the figure they explain.
  const ing = flour(1500);
  setStock(ing, -400, { why: "stocktake", label: () => "Stocktake — to nothing" });
  assert.equal(ing.onHand, 0);
  assert.equal(stockLogOf(ing)[0].delta, -1500, "the row claims a movement the shelf did not make");
});

test("★ Day one records the STARTING amount, so the journal does not begin mid-story", () => {
  const ing = flour(0);
  setStock(ing, 5000, { why: "dayone", label: (was, now) => `Day one — ${now} g` });
  const log = stockLogOf(ing);
  assert.equal(log.length, 1);
  assert.equal(log[0].why, "dayone");
  assert.equal(log[0].delta, 5000);
  assert.equal(log[0].what, "Day one — 5000 g");
});

// ── v514: the bread she baked that nobody ordered ────────────────────────────
//
// Her words: __"when Jien Bake focaccia, she usually bake more, not according to order, sometimes for self
// consumption, i need system to allow us to enter bake qty, system dont have to track the extra bake, but
// just need to deduct ingredient."__
//
// ⚠️⚠️ AND THE NUMBER SHE TYPES IS THE **TOTAL** SHE BAKED, NOT THE EXTRA — her own choice, put to her as
// three ways of asking (16 Oct 2026). ⭐ **Which makes this the one thing that can be got wrong in the
// expensive direction:** the orders take their own share off when they reach *Baked*, so the day's total
// must never come off here as well.
// ⚠️⚠️ TWO TESTS WERE HERE, AND THE RULE THEY PINNED IS GONE (v516). They asserted `total − ordered` —
// **"only the difference comes off"** — which was right only while an order marked Baked took its own share
// off as well. ⭐ **That is the rule that double-counted every order made AFTER the bake**, and it was
// replaced by the whole-total rule tested above ("her own case: bake 10, then sell 4"). ⚠️ **Deleted rather
// than left standing, because a test that pins a rule the code no longer follows is worse than none**: it
// would fail for a reason that is now the correct behaviour.

test("★★★ recording production NEVER makes the day a bake day (v514)", () => {
  // ⚠️⚠️ THE ONE THAT MATTERS. `nextDeliveryDates` publishes **every `deliveryDates` row dated today or
  // later, with NO weekday filter**, and the shop takes those rows as its calendar. ⭐ **So if recording
  // production wrote a row, a day she baked on but never opened would go ON SALE in her own shop** — which
  // is the opposite of what she asked for.
  const st = baseState([flour(1000)], [bread()]);
  st.settings = { defaultCapacity: 12 };
  st.orders = [];
  st.deliveryDates = [{ id: "del", date: "2026-10-19", notes: "" }];

  const before = JSON.stringify(st.deliveryDates);
  setBakedTotal(st, st.products[0], "2026-10-20", 3, 0);   // a day with no row at all

  assert.equal(JSON.stringify(st.deliveryDates), before,
    "★ recording production added or changed a delivery date — **the shop would offer a day she never "
    + "opened for orders**");
  const published = computeSlots(st, 20).map((r) => r.date);
  assert.equal(published.includes("2026-10-20"), false,
    "★ the day she recorded production on is being PUBLISHED to the storefront");
  assert.equal(published.includes("2026-10-19"), true,
    "…and the bake day she really opened is not being published, so this test is watching the wrong end");
});

test("★★ applyBake is one function with a sign, and a movement of nothing writes no row (v514)", () => {
  const ing = flour(1000);
  const st = baseState([ing], [bread()]);
  const p = st.products[0];

  applyBake(st, p, "2026-10-16", 2);
  assert.equal(ing.onHand, 500, "two extra loaves come off");
  const rows = stockLogOf(ing).length;
  applyBake(st, p, "2026-10-16", 0);
  assert.equal(ing.onHand, 500, "a delta of zero must move nothing");
  assert.equal(stockLogOf(ing).length, rows,
    "a delta of zero wrote a journal row saying the shelf moved by nothing");
  applyBake(st, p, "2026-10-16", -2);
  assert.equal(ing.onHand, 1000, "…and the same function with the sign the other way puts it back");
});
