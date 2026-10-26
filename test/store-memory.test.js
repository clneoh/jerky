// test/store-memory.test.js — P2 of the customer plan: this phone remembers what it ordered.
//
// ⚠️⚠️ TWO RULES SHAPE ALL OF IT:
//   1 · **NO ACCOUNTS AND NO PASSWORDS** — her rule. The memory is on the customer's own phone, holds only the
//       basket, and is forgotten in one press.
//   2 · **IT MUST NEVER ADD SOMETHING THE SHOP WOULD REFUSE.** The plan is computed against the SAME answer the
//       menu cards draw, and anything refused is NAMED rather than dropped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LAST_KEY, saveLastBasket, readLastBasket, forgetLastBasket, planReorder } from "../store/last_order.js";

const store = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
};

test("★★★ a basket is remembered, read back and forgotten (v638)", () => {
  const s = store();
  saveLastBasket(s, [{ name: "Focaccia", qty: 2 }, { name: "Sandwich", qty: 1 }], "2026-10-20");
  const back = readLastBasket(s);
  assert.deepEqual(back.items, [{ name: "Focaccia", qty: 2 }, { name: "Sandwich", qty: 1 }]);
  assert.equal(back.at, "2026-10-20");
  forgetLastBasket(s);
  assert.equal(readLastBasket(s), null, "★ the customer cannot get rid of it — it is not their memory");
});

test("★★★ a corrupt or half-written memory answers null, never a basket of guesses (v638)", () => {
  assert.equal(readLastBasket(store({ [LAST_KEY]: "{not json" })), null);
  assert.equal(readLastBasket(store({ [LAST_KEY]: JSON.stringify({ items: [] }) })), null);
  assert.equal(readLastBasket(store({ [LAST_KEY]: JSON.stringify({ items: [{ qty: 2 }] }) })), null,
    "★ an item with no name was carried through as a phantom product");
  assert.equal(readLastBasket(null), null);
});

test("★★ a private window or a full phone must not break the shop (v638)", () => {
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  assert.doesNotThrow(() => saveLastBasket(throwing, [{ name: "Focaccia", qty: 1 }], "2026-10-20"));
  assert.equal(readLastBasket(throwing), null);
  assert.doesNotThrow(() => forgetLastBasket(throwing));
});

test("★★★ the reorder offers only what TODAY allows, and names what it cannot (v638)", () => {
  const saved = { at: "2026-10-20", items: [
    { name: "Focaccia", qty: 2 },
    { name: "Sandwich", qty: 5 },
    { name: "Croissant", qty: 1 },
    { name: "Gone", qty: 1 },
  ] };
  const offer = (name) => ({
    Focaccia: { shown: true, soldOut: false, left: 3 },
    Sandwich: { shown: true, soldOut: false, left: 2 },   // only 2 left of the 5 they had
    Croissant: { shown: true, soldOut: true, left: 0 },   // sold out today
    Gone: { shown: false, soldOut: false },               // no longer on the menu
  }[name] || null);
  const plan = planReorder(saved, offer);
  assert.deepEqual(plan.add, [{ name: "Focaccia", qty: 2 }, { name: "Sandwich", qty: 2 }],
    "★ the saved quantity ignored the day's cap");
  assert.deepEqual(plan.skipped, [{ name: "Croissant", why: "full" }, { name: "Gone", why: "gone" }],
    "★ something the shop refuses was dropped in silence, or added anyway");
});

test("★★★ the shop saves it on the one path where an order landed, and the day comes first (v638)", () => {
  const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  // the save sits beside the other "the order really landed" bookkeeping
  // ⚠️ ANCHORED ON THE BRANCH, NOT ON ONE NEIGHBOUR (v640): `forgetVia()` and the basket save are both clean-ups
  // of the same moment, and requiring them within 400 characters of `rememberShopOrder` made a comment's length
  // a test. ⭐ The rule is the ORDER of them: after the order landed, before the basket is emptied.
  const rememberAt = app.indexOf("rememberShopOrder(promoApplied)");
  const saveAt = app.indexOf("saveLastBasket(shopStorage()");
  const clearAt = app.indexOf("cart.clear()", rememberAt);
  assert.ok(rememberAt > -1 && saveAt > rememberAt && clearAt > saveAt,
    "★ the basket is not saved on the branch where an order lands, before it is emptied — a fallback to WhatsApp would remember an order that never arrived");
  // the card is drawn at boot and after the reset
  assert.match(app, /renderMenu\(\);\s*\n\s*renderAgain\(\);/,
    "the last-order card is never repainted with the menu");
  // and pressing it without a day refuses, as every other basket door does
  assert.match(app, /if \(!dayPicked\) \{ sayStepFirst\("needDayTitle", "needDayBody", "step1"\); return; \}/,
    "★ the reorder adds a basket for a day the customer has not chosen — the door beside the gate");
  assert.match(app, /planReorder\(lastBasket, offerByName\)/,
    "★ the reorder answers from a rule of its own instead of the menu's own answer");
});
