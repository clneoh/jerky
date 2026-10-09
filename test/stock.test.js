// test/stock.test.js — ingredient on-hand stock moves: Bought adds a saved
// PO's whole packs, baking (an order marked Baked) subtracts its recipe and an
// undo puts it back, and stock never goes below zero. Pure functions (no DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockOf, consumeOrder, addBackOrder, adjustForStatus, applyBought,
  stockLogOf, logStock, setStock, STOCK_LOG_CAP,
  stockRowUndo, undoStockRow, shopUndoPlan, undoShopBought,
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

test("a time/length line unit never leaks into ingredient stock (family guard)", () => {
  // hr (60) and m (100) now exist as convertible units. A recipe line that
  // happens to say "hr" on a gram ingredient must fall back to grams — baking
  // subtracts 2 g, never 2 × 60 = 120 g.
  const ing = flour(1000);
  const st = baseState([ing], [{ id: "p", name: "X", active: true,
    recipe: [{ ingredientId: "ing_f", qty: 2, unit: "hr" }] }]);
  st.uoms.push({ id: "hr", name: "hr", family: "time", toBase: 60 });
  consumeOrder(st, { id: "o", productId: "p", qty: 1 });
  assert.equal(ing.onHand, 998, "2 hr on a gram ingredient reads as 2 g");
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

// ── ★★ the stock journal (v385) ───────────────────────────────────────────────
// Her words: __"why only show when there is price movement, qty movement cannot?"__ — and the honest
// answer was that quantity movements were never RECORDED at all. Every one of them just overwrote the
// number, so "why is my flour at 2 kg?" had no answer. Rows now name what moved AND why.

test("★★ baking writes a row naming the order, with the amount that actually came off", () => {
  const ing = flour(1000);
  const st = baseState([ing], [bread()]);
  consumeOrder(st, order(2)); // 250 g × 2
  const log = stockLogOf(ing);
  assert.equal(log.length, 1, "baking wrote no stock row");
  assert.equal(log[0].delta, -500, "the row does not carry what came off, signed");
  assert.equal(log[0].why, "baked");
  assert.match(log[0].what, /Baked — Sourdough ×2/,
    "the row does not say WHAT was baked — a bare number does not answer 'where did my flour go'");
  assert.equal(log[0].ref, "o", "the row cannot be tied back to the order that caused it");
});

test("★ un-baking writes its own row, and the pair cancels out", () => {
  const ing = flour(1000);
  const st = baseState([ing], [bread()]);
  consumeOrder(st, order(2));
  addBackOrder(st, order(2));
  const log = stockLogOf(ing);
  assert.equal(log.length, 2);
  assert.equal(log[0].why, "unbaked", "the newest row is not the undo");
  assert.equal(log[0].delta, 500);
  assert.match(log[0].what, /Un-baked — Sourdough ×2/);
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
  consumeOrder(st, order(2)); // the recipe wants 500 g; only 100 g is there
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
  consumeOrder(st, order(1));
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

test("⚠️ a removal that would take stock below zero is CLAMPED, and the plan says so in advance", () => {
  // ⚠️ Stock never goes below zero, so taking back a +8 kg buy against a 7.5 kg shelf cannot leave
  // −0.5 kg. ⚠️⚠️ THE PLAN MUST REPORT THE CLAMPED FIGURE, because the confirm shows it to her BEFORE
  // she commits — a one-way change to her stock is not something a tap should discover afterwards.
  const ing = flour(7500);
  logStock(ing, { at: "2026-10-08", delta: 8000, why: "bought", what: "Bought — Mydin" });
  const plan = stockRowUndo(ing, stockLogOf(ing)[0]);
  assert.equal(plan.now, 0, "the plan offered a figure her shelf can never hold");
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

test("⚠️ a stocktake that sets the SAME number writes NOTHING", () => {
  // ⚠️ A correction that changes nothing is not a movement — the same rule the price log keeps. Without
  // this a card she opens and saves would fill its own journal with rows saying nothing happened.
  const ing = flour(1500);
  setStock(ing, 1500, { why: "stocktake", label: () => "Stocktake — no change" });
  assert.equal(stockLogOf(ing).length, 0, "a no-op correction wrote a row");
  assert.equal(ing.onHand, 1500);
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
