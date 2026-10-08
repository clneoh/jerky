// test/refund.test.js — giving the money back (v361).
//
// ⚠️⚠️ WHAT THIS FILE IS REALLY FOR. A refund is the one press in the app that moves money
// BACKWARDS, and its whole risk is in the books rather than on the screen: **a sale that has
// been refunded must stop counting**, everywhere, or she reads a profit on money she handed
// back. The rule is one sentence and every assertion below is that sentence in a different
// book:
//
//   **A refunded order is neither takings nor owed.**
//
// ⚠️ AND THE RECEIPT KEEPS ITS NUMBER throughout — tested in test/receipts.test.js. Nothing
// here renumbers anything.

import { test } from "node:test";
import assert from "node:assert/strict";

const { dayMoney, moneyBetween, isCollected, isRefunded } = await import("../admin/js/money.js");
const { profitBetween, tradingRows } = await import("../admin/js/profit.js");

function state() {
  return {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }],
    orders: [],
    expenses: [], deposits: [], ingredients: [], categories: [],
  };
}
const row = (extra = {}) => ({
  id: "o1", deliveryDateId: "d18", deliveryDate: "2026-09-18",
  productId: "p1", qty: 1, status: "paid", ...extra,
});
const REFUND = "2026-09-19T02:00:00.000Z";

// ── the flag itself ──────────────────────────────────────────────────────────

test("isRefunded reads a group or a bare row, because two books walk different shapes", () => {
  // The Money screen walks GROUPS; Profit walks ROWS. The refund is stamped on every row of
  // the sale, so one reader has to answer for both or one of the two books goes blind.
  assert.equal(isRefunded({ orders: [{ refundedAt: REFUND }] }), true, "a group");
  assert.equal(isRefunded({ refundedAt: REFUND }), true, "a row");
  assert.equal(isRefunded({ orders: [{ refundedAt: REFUND }] }) && isRefunded({ refundedAt: REFUND }), true);
  assert.equal(isRefunded({ orders: [{}] }), false);
  assert.equal(isRefunded({}), false);
  assert.equal(isRefunded(null), false);
});

// ── the money ────────────────────────────────────────────────────────────────

test("★★ a refunded order is NOT takings", () => {
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),                              // RM15, kept
    row({ id: "b", paidReceived: true, paidMethod: "cash", refundedAt: REFUND }),          // RM15, given back
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.cash, 15, "★ the money she handed back is not in the till");
  assert.equal(isCollected({ orders: [st.orders[1]] }), true, "it is still PAID — she did take it");
  // ⚠️ AND THAT IS THE POINT: it is not "unpaid". It was paid and then given back, so the
  // answer is not to move it to the other column. It belongs in neither.
});

test("★★ and it is NOT owed either — moving it to the other column would be a lie too", () => {
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),
    row({ id: "b", paidReceived: true, paidMethod: "cash", refundedAt: REFUND }),
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.toCollect, 0, "★ nobody owes her this money — the sale is over");
  assert.equal(m.toCollectCount, 0, "and nobody is counted as owing it");
  const stretch = moneyBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(stretch.cash, 15, "★ and it is absent from the month as well as the day");
  assert.equal(stretch.toCollect, 0);
});

test("a refunded order that was never paid is skipped the same way", () => {
  // A refund can only follow a payment, but an order whose payment flag was already recorded
  // and is then refunded must not fall into "owed" through the stage rule either.
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),
    row({ id: "b", paidReceived: false, refundedAt: REFUND }),
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.toCollect, 0, "a refunded sale is over, whatever the payment flag says");
  assert.equal(m.cash, 15);
});

// ── the profit ───────────────────────────────────────────────────────────────

test("★ a refunded sale is not a SALE in Profit — or she reads a profit on money given back", () => {
  const st = state();
  st.orders = [
    row({ id: "a", deliveryDate: "2026-09-18" }),
    row({ id: "b", deliveryDate: "2026-09-18", refundedAt: REFUND }),
  ];
  const p = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(p.sales, 15, "★ one sale stood, and only one is counted");
});

test("and the journal behind the line skips it too, so the rows still add up to the total", () => {
  // ⚠️ THE FAULT THIS PREVENTS: a trading line that counts two sales and a journal that lists
  // one. The app calls that a bug in every book it draws — the rows above the rule must add
  // up to the figure under it.
  //
  // ⚠️⚠️ AND THIS TEST HAD TO BE REWRITTEN, BECAUSE ITS FIRST VERSION PROVED NOTHING. It
  // filtered `state.orders` by hand and compared that to the line — **re-implementing the rule
  // instead of calling the function that holds it** — so removing the guard from
  // `tradingRows` did not disturb it at all. The bite caught that, not a reading. It calls the
  // real function now.
  const st = state();
  st.orders = [
    row({ id: "a", deliveryDate: "2026-09-18" }),
    row({ id: "b", deliveryDate: "2026-09-18", refundedAt: REFUND }),
  ];
  const p = profitBetween(st, "2026-09-01", "2026-09-30");
  const rows = tradingRows(st, "2026-09-01", "2026-09-30");
  assert.equal(rows.length, 1, "★ the journal behind the line lists one sale");
  const added = rows.reduce((sum, r) => sum + (Number(r.sales) || 0), 0);
  assert.equal(added, p.sales, "★ AND THE ROWS ADD UP TO THE LINE UNDER THEM");
});

// ── ★★ v370: A REFUND THAT IS NOT ALL OF IT ──────────────────────────────────
//
// Her words: __"refund should not be a full without choice to how much to refund, what to refund"__.
// A refund is now an AMOUNT (`refundAmountRM`) beside the mark, so it can be a part.
//
// ⚠️⚠️ AND THAT FORCED A SECOND FIX, WHICH IS WHAT THE FIRST TWO TESTS BELOW ARE ABOUT. Her takings
// were counted at the goods' FACE price with the discount left in — so a RM15 order with a RM3 coupon
// read as RM15 in the till though the customer handed over RM12. While a refund skipped the whole
// order those two errors cancelled; **the moment a refund can be a part, they stop cancelling**, and a
// full refund of a discounted order would leave a phantom RM3 behind. Asked which she wanted she
// chose **"count what the customer actually paid"**.

// An order carrying a bring-a-friend coupon: face RM15, RM3 off, so the customer paid RM12.
const couponed = (extra = {}) => {
  const st = state();
  st.orders = [row({ id: "a", groupId: "c2fda5", paidReceived: true, paidMethod: "cash", ...extra })];
  st.credits = [{
    id: "c1", holder: "60111111111", amountRM: 3, role: "friendOff",
    earnedAt: "2026-09-18T00:00:00.000Z", expiresAt: "", usedAt: null, orderCode: "C2FDA5",
  }];
  return st;
};

test("★★ a discounted order counts what the customer actually PAID", () => {
  const held = couponed();
  assert.equal(dayMoney(held, "d18").cash, 12,
    "★ the till is counting the bread's face price, not the money the customer handed over");
  assert.equal(profitBetween(held, "2026-09-01", "2026-09-30").sales, 12,
    "and Profit is reporting revenue the customer never paid");
});

test("★★ a refunded order with NO amount still means the WHOLE order", () => {
  // ⚠️ THE BACKWARD-COMPATIBILITY TEST, AND THE MOST IMPORTANT ONE HERE. Every order refunded before
  // v370 carries `refundedAt` and nothing else. Reading a missing amount as "nothing went back" would
  // put every one of those sales straight back into her takings — the loudest possible way to be
  // wrong about her books.
  const st = couponed({ refundedAt: REFUND });
  assert.equal(dayMoney(st, "d18").cash, 0,
    "★ an old refunded order came back into the till because it carries no amount");
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").sales, 0,
    "and it came back as a sale in Profit");
});

test("★ a PARTIAL refund takes off exactly what she gave back", () => {
  const st = couponed({ refundAmountRM: 5 });
  assert.equal(dayMoney(st, "d18").cash, 7, "★ RM12 came in, RM5 went back — the till is wrong");
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").sales, 7);
});

test("★ a FULL refund of a DISCOUNTED order reaches nothing — the case that was wrong", () => {
  // ⚠️ THIS IS THE ARITHMETIC THAT MADE THE WHOLE CHANGE NECESSARY. Giving back everything the
  // customer paid (RM12) must leave RM0 — not the RM3 the coupon was worth, which she never received.
  const st = couponed({ refundAmountRM: 12 });
  assert.equal(dayMoney(st, "d18").cash, 0, "★ a phantom discount is left in the till");
  assert.equal(isRefunded({ orders: st.orders }), true, "the order is still marked refunded");
});

test("★ counts do not move — the order still happened", () => {
  const held = couponed();
  const back = couponed({ refundAmountRM: 5 });
  const gone = couponed({ refundAmountRM: 12 });
  assert.equal(dayMoney(held, "d18").count, 1);
  assert.equal(dayMoney(back, "d18").count, 1, "a partly refunded order stopped being counted");
  assert.equal(dayMoney(gone, "d18").count, 1, "a fully refunded order stopped being counted");
  assert.equal(dayMoney(back, "d18").toCollectCount, 0, "a refunded order is owed nothing");
});

test("⚠️ a partial refund is ONE amount, not one amount per row", () => {
  // ⚠️ THE TRAP. The amount is a fact about the ORDER, stamped on every row so a row read alone
  // knows it — so anything that sums rows would subtract the same refund once per item.
  const st = state();
  st.orders = [
    row({ id: "a", groupId: "c2fda5", paidReceived: true, paidMethod: "cash", refundAmountRM: 5 }),
    row({ id: "b", groupId: "c2fda5", paidReceived: true, paidMethod: "cash", refundAmountRM: 5 }),
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.cash, 25, `★ RM30 of bread less ONE RM5 refund is RM25, not ${m.cash}`);
  assert.equal(m.count, 1, "and the two rows are still one order");
});

test("★ the trading journal still adds up when there is a discount AND a refund", () => {
  // ⚠️ The rows must sum to the line above them — the one thing this app calls a bug in every book
  // it draws. A discount and a refund are now visible as rows of their own rather than folded away.
  const st = couponed({ refundAmountRM: 5 });
  const p = profitBetween(st, "2026-09-01", "2026-09-30");
  const rows = tradingRows(st, "2026-09-01", "2026-09-30");
  const added = rows.reduce((sum, r) => sum + (Number(r.sales) || 0), 0);
  assert.equal(Math.round(added * 100) / 100, p.sales, "★ the journal no longer adds up to the line");
  assert.equal(rows.some((r) => /Bring-a-friend/.test(r.what)), true, "the discount is not in the journal");
  assert.equal(rows.some((r) => /Refunded/.test(r.what)), true, "the refund is not in the journal");
});

test("★ a line nothing can price is still a LINE, refund or no refund", () => {
  // ⚠️ Regressions caught while building this: skipping a group whose net is zero also skipped an
  // order whose product simply has no price. The app keeps `null` apart from `0` on purpose, and only
  // a REFUND may cancel a sale.
  const st = state();
  st.products[0].price = "";
  st.orders = [row({ id: "a", refundedAt: REFUND })];
  const p = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(p.sales, 0);
  assert.equal(tradingRows(st, "2026-09-01", "2026-09-30").length, 0,
    "a fully refunded order is dropped from the journal, whatever its price");
});
