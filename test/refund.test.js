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
