// test/promo-usage.test.js — what a promo code has actually done.
// Run with: node --test test/
//
// These tests guard one decision: the tally is RECOUNTED from her own orders
// every time, never kept. Every test here is therefore written so that it would
// go red if the number were produced any other way — a stored increment, a count
// of rows, or a shop-written figure all fail, and that is the point.

import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCode, normalizeCode, publishCodes, stoppedBy } from "../admin/js/promo.js";
import { usageOf, usageByCode } from "../admin/js/promo-usage.js";

const TODAY = "2026-10-02";

// A code as the app would store one: every family present, only the ones a test
// cares about overridden. Same helper as test/promo.test.js, deliberately.
function code(over = {}) {
  return {
    ...blankCode(),
    id: "promo_1",
    code: "FRESH10",
    gives: { type: "rm", value: 10, cap: 0 },
    ...over,
  };
}

// One product at a known price, so "what a code gave away" has an arithmetic
// answer a reader can check by eye.
const PRODUCTS = [{ id: "p1", name: "Focaccia", price: 18, active: true }];

// An order row. `unitPrice` is what the shop SOLD it at, frozen onto the row —
// which is what the tally must use, not today's price on the product.
function order(over = {}) {
  return { id: "ord_1", productId: "p1", qty: 1, status: "new", fulfillment: "collect", ...over };
}

function state(orders, codes = [code()]) {
  return { products: PRODUCTS, orders, promoCodes: codes };
}

// ── The count ─────────────────────────────────────────────────────────────

test("a code's orders are counted, and an order without the code is not the code's", () => {
  const st = state([
    order({ id: "a", promo: "FRESH10" }),
    order({ id: "b", promo: " fresh10 " }),
    order({ id: "c" }),                       // no code at all
    order({ id: "d", promo: "OTHER" }),       // a different code
  ]);
  const u = usageOf(st, code());
  assert.equal(u.used, 2, "two orders carry it, however it was typed");
  assert.equal(u.given, 20, "and RM10 came off each of them");
});

test("one CART is one order, however many items it holds", () => {
  // The shop posts a basket as one cart; the app splits it into a row per item,
  // all sharing a groupId and all stamped with the same code. Counting rows
  // would let a three-item basket eat three of her "first 5 orders" — the
  // customer used the code ONCE, and the code gave away RM10 ONCE.
  const st = state([
    order({ id: "l1", groupId: "g1", promo: "FRESH10", qty: 2 }),
    order({ id: "l2", groupId: "g1", promo: "FRESH10", qty: 1 }),
    order({ id: "l3", groupId: "g1", promo: "FRESH10", qty: 3 }),
  ]);
  const u = usageOf(st, code());
  assert.equal(u.used, 1, "three rows, one cart, one use");
  assert.equal(u.given, 10, "and RM10 off the cart, not RM10 off each line");
});

test("what a code gave away is counted at the price each line was SOLD at", () => {
  // The product's price today is 18. The order was sold at 20, and the frozen
  // unit price on the row is what she actually charged — the same figure her
  // takings use. A tally that read the product's current price would rewrite
  // history every time she raised a price.
  const pct = code({ gives: { type: "pct", value: 10, cap: 0 } });
  const st = state([order({ id: "a", promo: "FRESH10", qty: 2, unitPrice: 20 })], [pct]);
  assert.equal(usageOf(st, pct).given, 4, "10% of two at RM20 is RM2 an item, RM4 together");
  const st2 = state([order({ id: "a", promo: "FRESH10", qty: 2 })], [pct]);
  assert.equal(usageOf(st2, pct).given, 3.6, "with no frozen price the product's own price is the fallback");
});

test("a code is counted by what IT gives, not by a copy of the record handed in", () => {
  // One code, one definition of what it gives. If a caller could hand in its own
  // version of the terms, two screens asking about the same code could get two
  // different tallies — which is the whole family of fault v268 was about. The
  // terms come from the code as the app has it; only the code's NAME comes from
  // whatever was passed in.
  const pct = code({ gives: { type: "pct", value: 10, cap: 0 } });
  const st = state([order({ id: "a", promo: "FRESH10", qty: 2, unitPrice: 20 })], [pct]);
  assert.equal(usageOf(st, code()).given, 4, "asked about FRESH10, it answers with FRESH10's own terms");
});

// ── The guarantee ─────────────────────────────────────────────────────────

test("asking twice gives the same answer — the number is recounted, never kept", () => {
  // This is the decision's whole guarantee. An implementation that incremented
  // a stored tally would answer differently the second time here, and would
  // double-count for real the moment an order was re-imported or a screen
  // repainted.
  const st = state([
    order({ id: "a", promo: "FRESH10" }),
    order({ id: "b", promo: "FRESH10" }),
  ]);
  const first = usageOf(st, code());
  const second = usageOf(st, code());
  assert.deepEqual(second, first, "the same question answers the same thing");
  assert.deepEqual(usageOf(st, code()), { used: 2, given: 20 }, "and neither call wrote anything down");
  // Nothing was created on the state by asking — no tally, no cache key.
  assert.deepEqual(Object.keys(st).sort(), ["orders", "products", "promoCodes"]);
});

test("re-importing the same order cannot double-count it", () => {
  // The same order, imported twice by two phones (two ids, same customer, same
  // day, same code). Recounting cannot help with a genuine duplicate — that is
  // an import problem, not a counting one — but it must never count ONE row
  // twice, which is what a stored tally does on a re-publish.
  const one = [order({ id: "a", promo: "FRESH10" })];
  const st = state(one);
  usageOf(st, code());                       // a repaint, a re-publish
  usageOf(st, code());                       // and another
  assert.equal(usageOf(st, code()).used, 1, "three recitations of one order is still one order");
});

test("a code carries no tally of its own after the count", () => {
  const c = code();
  usageOf(state([order({ promo: "FRESH10" })]), c);
  assert.equal(c.used, 0, "the record is not the tally — it is only ever what the last publish wrote");
  assert.equal(c.given, 0);
});

// ── What the count means to the shop ──────────────────────────────────────

test("a code that has given away its ringgit stops, even with orders left on its count", () => {
  // The whole of v271 in one test: a ceiling in RINGGIT, reached before the
  // count is. Five orders were allowed; only two have been used; RM50 was the
  // limit and RM50 has gone. Dropping the ringgit half of the judgement leaves
  // this code looking wide open.
  const capped = code({ often: { type: "quota", n: 5, maxRM: 50 } });
  const st = state([
    order({ id: "a", promo: "FRESH10" }),
    order({ id: "b", promo: "FRESH10" }),
    order({ id: "c", promo: "FRESH10" }),
    order({ id: "d", promo: "FRESH10" }),
    order({ id: "e", promo: "FRESH10" }),
  ], [capped]);
  const u = usageOf(st, capped);
  assert.equal(u.used, 5);
  assert.equal(u.given, 50, "five RM10 orders");

  const at = normalizeCode({ ...capped, ...u, often: { type: "quota", n: 9, maxRM: 50 } });
  const stopped = stoppedBy(at, TODAY);
  assert.equal(stopped && stopped.fail, "claimed", "RM50 given away is the end of it, with four orders unspent");
  assert.equal(stopped.bound, "money", "and she is told it was the money that ran out");

  // Under either ceiling it is still live — the boundary is `>=`, and one sen
  // less must not stop it.
  const under = normalizeCode({ ...capped, used: 4, given: 49.99, often: { type: "quota", n: 5, maxRM: 50 } });
  assert.equal(stoppedBy(under, TODAY), null, "one sen short is not the end");
});

test("whichever limit runs out first is the one she is told about", () => {
  const c = code({ often: { type: "quota", n: 3, maxRM: 500 } });
  const byCount = stoppedBy(normalizeCode({ ...c, used: 3, given: 30 }), TODAY);
  assert.equal(byCount.bound, "count", "three of three orders, money to spare");
  const byMoney = stoppedBy(normalizeCode({ ...c, used: 1, given: 500 }), TODAY);
  assert.equal(byMoney.bound, "money", "one order, but the whole RM500 gone");
  const both = stoppedBy(normalizeCode({ ...c, used: 3, given: 500 }), TODAY);
  assert.equal(both.bound, "both", "and when both are reached she is told both, not one of them");
});

test("a delivery code counts the charge it waived, not nothing", () => {
  // A free-delivery code gives away no goods at all, so a tally built only from
  // prices would count it as worth zero and it could never reach a ringgit
  // ceiling. What it gave away is the delivery the customer did not pay.
  const free = code({ gives: { type: "delivery", value: 0, cap: 0 } });
  const st = state([
    order({ id: "a", promo: "FRESH10", fulfillment: "courier", courierFee: 8, courierPaidBy: "customer" }),
    order({ id: "b", promo: "FRESH10", fulfillment: "courier", courierFee: 8, courierPaidBy: "customer" }),
  ], [free]);
  const u = usageOf(st, free);
  assert.equal(u.used, 2);
  assert.equal(u.given, 16, "two RM8 deliveries she did not charge for");

  // A charge SHE bears is not something the code gave the customer — they were
  // never going to pay it — so it counts as nothing.
  const mine = state([order({ promo: "FRESH10", fulfillment: "courier", courierFee: 8, courierPaidBy: "me" })], [free]);
  assert.equal(usageOf(mine, free).given, 0);
  // And an order with no delivery at all has no fee to waive.
  const collect = state([order({ promo: "FRESH10" })], [free]);
  assert.equal(usageOf(collect, free).given, 0);
});

// ── Edges that must not crash or lie ──────────────────────────────────────

test("an order too small for the code gives away nothing, and cannot eat the ringgit ceiling", () => {
  // Her report of 2 Oct 2026: a "RM10 off on RM100" code riding on a small order still
  // took its RM10 off. The tally had the same hole as the Total did — it counted the
  // bare offer instead of the award — so the two are fixed together (see awardOf).
  //
  // The order still COUNTS as a use: the code did ride on it, and that is what "used"
  // means to her. What it must not do is spend ringgit that never left her purse, or it
  // would exhaust a ceiling that orders which WERE entitled to the discount still need.
  const min = code({ basket: { type: "amount", amount: 100 } }); // the goods here are RM18
  const st = state([
    order({ id: "a", promo: "FRESH10" }),
    order({ id: "b", promo: "FRESH10" }),
  ], [min]);
  const u = usageOf(st, min);
  assert.equal(u.used, 2, "the code did ride on both orders");
  assert.equal(u.given, 0, "and gave away not one ringgit");
  assert.equal(
    stoppedBy(normalizeCode({ ...min, ...u, often: { type: "quota", n: 9, maxRM: 50 } }), TODAY),
    null, "so a code with RM50 to give still has the whole RM50 to give");
});

test("a code she has deleted stops being counted, without touching the orders that carry it", () => {
  const st = state([order({ id: "a", promo: "GONE01" })], [code()]);
  assert.deepEqual(usageOf(st, { code: "GONE01" }), { used: 0, given: 0 },
    "there is no code left to count against");
  assert.equal(st.orders[0].promo, "GONE01", "and the order still says what it was sold with");
});

test("a code that is not hers, has no name, or has no state at all answers an honest nothing", () => {
  assert.deepEqual(usageOf(state([order({ promo: "FRESH10" })]), code({ code: "" })), { used: 0, given: 0 });
  assert.deepEqual(usageOf(state([order({ promo: "FRESH10" })]), null), { used: 0, given: 0 });
  assert.deepEqual(usageOf(null, code()), { used: 0, given: 0 }, "no state is no orders, not a throw");
  assert.deepEqual(usageOf({}, code()), { used: 0, given: 0 });
  assert.deepEqual(usageOf({ orders: null, promoCodes: [code()] }, code()), { used: 0, given: 0 });
});

test("an order with no price at all counts as nothing rather than as a crash", () => {
  const st = { products: [], orders: [order({ id: "a", promo: "FRESH10", qty: 3 })], promoCodes: [code()] };
  const u = usageOf(st, code());
  assert.equal(u.used, 1, "it is still an order that used the code");
  assert.equal(u.given, 10, "and a flat RM10 code gives RM10 whatever the basket was worth");
});

// ── The publish seam ──────────────────────────────────────────────────────

test("the list the shop is given carries the RECOUNTED numbers, not the record's own", () => {
  // The record's stored counts are stale by construction — they are only ever
  // what the LAST publish wrote. If those were published, the shop would judge
  // "fully claimed" against yesterday's figure and keep offering a code she has
  // already given away in full.
  const capped = code({ often: { type: "quota", n: 2, maxRM: 20 }, used: 0, given: 0 });
  const st = state([
    order({ id: "a", promo: "FRESH10" }),
    order({ id: "b", promo: "FRESH10" }),
  ], [capped]);

  const stale = publishCodes(st)[0];
  assert.equal(stale.used, 0, "without a counter the record's own answer stands, as before");

  const usage = usageByCode(st);
  const [fresh] = publishCodes(st, (c) => usage.get(c.code) || { used: 0, given: 0 });
  assert.equal(fresh.used, 2);
  assert.equal(fresh.given, 20);
  assert.equal(fresh.often.maxRM, 20, "and the ceiling rides with it, or the shop cannot judge either");

  // What the shop then makes of the published row: fully claimed.
  const shopSide = [normalizeCode(fresh)];
  assert.equal(stoppedBy(shopSide[0], TODAY).fail, "claimed",
    "the shop can only refuse what it was told, so the numbers have to be right on the way out");
});

test("a code still inside its limits is published with its live numbers", () => {
  const capped = code({ often: { type: "quota", n: 5, maxRM: 50 } });
  const st = state([order({ id: "a", promo: "FRESH10" })], [capped]);
  const usage = usageByCode(st);
  const [out] = publishCodes(st, (c) => usage.get(c.code) || { used: 0, given: 0 });
  assert.equal(out.used, 1);
  assert.equal(out.given, 10);
  assert.equal(stoppedBy(normalizeCode(out), TODAY), null, "one of five, RM10 of RM50 — still running");
});
