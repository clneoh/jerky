// test/refund.test.js — giving the money back (v361).
//
// ⚠️⚠️ WHAT THIS FILE IS REALLY FOR. A refund is the one press in the app that moves money
// BACKWARDS, and its whole risk is in the books rather than on the screen: **a sale that has
// been refunded must stop counting**, everywhere, or she reads a profit on money she handed
// back. The rule is one sentence and every assertion below is that sentence in a different
// book:
//
//   **A refund is money OUT on the day it went back, and the sale keeps what it took (v578).**
//
// ⚠️⚠️ THAT SENTENCE USED TO READ "a refunded order is neither takings nor owed". ⭐ Her answer, asked
// which way her books should read: __"Money out in the month it went back"__ — ⚠️ because the old rule made
// **October's Cash show nothing leaving the tin while September's takings silently fell months later.**
//
// ⚠️ AND THE RECEIPT KEEPS ITS NUMBER throughout — tested in test/receipts.test.js. Nothing
// here renumbers anything.

import { test } from "node:test";
import assert from "node:assert/strict";

const { accountsBetween, dayMoney, moneyBetween, isCollected, isRefunded, orderNet,
  refundsBetween } = await import("../admin/js/money.js");
const { profitBetween, refundRows, tradingRows } = await import("../admin/js/profit.js");

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

// ── a refund that ANSWERS AN EDIT (v549) ─────────────────────────────────────

test("★★★ a refund that answers an EDIT is not taken off a second time", () => {
  // ⚠️⚠️ MEASURED: RM30 paid, edited down to 1 × RM15, accept "Refund RM15?" — the takings read **RM0**,
  // although she kept RM15. ⭐ The edit had ALREADY taken the RM15 out (the save dialog says so in those
  // words), so subtracting the refund too counted one event twice. ⭐ The refund is still on the order —
  // the receipt register still says the money went back — it just does not move the takings again.
  const st = state();
  st.orders = [row({ qty: 1, paidReceived: true, paidMethod: "cash",
    refundedAt: REFUND, refundAmountRM: 15, refundFromEdit: true })];
  assert.equal(orderNet(st, { orders: st.orders }), 15,
    "★ the order's takings fell to zero after a refund that answered an edit — **she kept RM15 and her "
    + "books say she kept nothing**");
});

test("★★ and an ORDER'S OWN refund is still taken off — the flag is not a loophole", () => {
  const st = state();
  st.orders = [row({ qty: 1, paidReceived: true, paidMethod: "cash",
    refundedAt: REFUND, refundAmountRM: 15 })];
  assert.equal(orderNet(st, { orders: st.orders }), 0,
    "★ an ordinary refund stopped being taken off — the takings show money she handed back");
});

// ── the money ────────────────────────────────────────────────────────────────

// Her answer, in one line: **a refund is money out in the month it went back.**
const SEP = ["2026-09-01", "2026-09-30"];
const OCT = ["2026-10-01", "2026-10-31"];

// The Cash account's own three figures, from the very functions the Money screen calls.
function cashHolds(st, from, to) {
  const blocks = accountsBetween(st,
    [moneyBetween(st, from, to)],
    [refundsBetween(st, from, to)]);
  return (blocks.find((b) => b.label === "Cash") || { holds: 0 }).holds;
}

test("★★★ a refunded sale KEEPS its takings, and the refund is money OUT on the day it went back", () => {
  // ⚠️⚠️ THE OLD RULE NETTED THE REFUND OFF THE SALE, so October's Cash showed nothing leaving the tin
  // and September's takings fell when she looked back. ⭐ Her answer: money out in the month it went back.
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),                              // RM15, kept
    row({ id: "b", paidReceived: true, paidMethod: "cash", refundedAt: REFUND }),          // RM15, given back
  ];
  assert.equal(dayMoney(st, "d18").cash, 30,
    "★ the sale's own day lost money the customer really handed over");
  assert.equal(refundsBetween(st, "2026-09-19", "2026-09-19").cash, 15,
    "★ the money that went back is not an OUT row on the day it went back");
  assert.equal(cashHolds(st, ...SEP), 15,
    "★ the account does not hold what the money in less the money out leaves");
  assert.equal(isCollected({ orders: [st.orders[1]] }), true, "it is still PAID — she did take it");
});

test("★★ and it is NOT owed either — moving it to the other column would be a lie too", () => {
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),
    row({ id: "b", paidReceived: true, paidMethod: "cash", refundedAt: REFUND }),
  ];
  const stretch = moneyBetween(st, ...SEP);
  assert.equal(stretch.toCollect, 0, "★ nobody owes her this money — the sale is over");
  assert.equal(stretch.toCollectCount, 0, "and nobody is counted as owing it");
  assert.equal(stretch.cash, 30, "★ September's takings fell for a refund made in September's own month");
  assert.equal(refundsBetween(st, ...SEP).total, 15, "★ the month does not show the money going back");
});

test("a refunded order that was never paid is skipped the same way", () => {
  const st = state();
  st.orders = [
    row({ id: "a", paidReceived: true, paidMethod: "cash" }),
    row({ id: "b", paidReceived: false, refundedAt: REFUND }),
  ];
  const m = dayMoney(st, "d18");
  assert.equal(m.toCollect, 0, "a refunded sale is over, whatever the payment flag says");
  assert.equal(m.cash, 15, "the unpaid, refunded order never took any money");
});

// ── the profit ───────────────────────────────────────────────────────────────

test("★★ a refund is its OWN line in Profit, and the sale keeps its Sales", () => {
  // ⚠️ Not a smaller Sales figure: a month whose only movement is a refund would then read
  // **Sales −RM15**, and a statement line must never look like a fault.
  const st = state();
  st.orders = [
    row({ id: "a", deliveryDate: "2026-09-18" }),
    row({ id: "b", deliveryDate: "2026-09-18", refundedAt: REFUND }),
  ];
  const p = profitBetween(st, ...SEP);
  assert.equal(p.sales, 30, "★ the sale that was refunded disappeared from Sales");
  assert.equal(p.refunds, 15, "★ the money going back is not on the statement");
});

test("and the two journals add up to the two lines", () => {
  // ⚠️ THE FAULT THIS PREVENTS: a statement line that counts something its journal does not list.
  // The app calls that a bug in every book it draws — the rows above the rule must add up to it.
  const st = state();
  st.orders = [
    row({ id: "a", deliveryDate: "2026-09-18" }),
    row({ id: "b", deliveryDate: "2026-09-18", refundedAt: REFUND }),
  ];
  const p = profitBetween(st, ...SEP);
  const sold = tradingRows(st, ...SEP);
  const back = refundRows(st, ...SEP);
  assert.equal(sold.reduce((sum, r) => sum + (Number(r.sales) || 0), 0), p.sales,
    "★ the Sales journal no longer adds up to the Sales line");
  assert.equal(sold.some((r) => /Refunded/.test(r.what)), false,
    "★ a refund is drawn inside the Sales journal — it belongs to its own line");
  assert.equal(back.reduce((sum, r) => sum + r.amount, 0), p.refunds,
    "★ the Refunds journal no longer adds up to the Refunds line");
});

test("★★★ a refund next month leaves this month alone and comes out of the month it went back", () => {
  // ⚠️⚠️ THE CASE SHE CHOSE THIS FOR: paid by Cash on 18 Sep, refunded 10 Oct. ⚠️ Under the old rule
  // September's takings fell in October and October's tin never showed the money leaving.
  const st = state();
  st.orders = [row({ paidReceived: true, paidMethod: "cash",
    refundedAt: "2026-10-10T02:00:00.000Z", refundAmountRM: 15 })];
  assert.equal(dayMoney(st, "d18").cash, 15, "★ the day of the sale lost money it really took");
  assert.equal(profitBetween(st, ...SEP).sales, 15, "★ September's sales fell for an October refund");
  assert.equal(profitBetween(st, ...SEP).refunds, 0, "★ September took a refund given in October");
  assert.equal(profitBetween(st, ...OCT).sales, 0, "★ October gained a sale it never had");
  assert.equal(profitBetween(st, ...OCT).refunds, 15, "★ October's statement does not show the refund");
  assert.equal(refundsBetween(st, ...SEP).total, 0, "★ the refund landed in the wrong month");
  assert.equal(refundsBetween(st, ...OCT).total, 15, "★ the refund is not in the month it went back");
  assert.equal(cashHolds(st, ...OCT), -15,
    "★ October's Cash does not show the money leaving the tin");
});

// ── ★★ v370: A REFUND THAT IS NOT ALL OF IT ──────────────────────────────────
//
// Her words: __"refund should not be a full without choice to how much to refund, what to refund"__.
// A refund is now an AMOUNT (`refundAmountRM`) beside the mark, so it can be a part.

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
  assert.equal(profitBetween(held, ...SEP).sales, 12,
    "and Profit is reporting revenue the customer never paid");
});

test("★★ a refunded order with NO amount still means the WHOLE order", () => {
  // ⚠️ THE BACKWARD-COMPATIBILITY TEST, AND THE MOST IMPORTANT ONE HERE. Every order refunded before
  // v370 carries `refundedAt` and nothing else. Reading a missing amount as "nothing went back" would
  // leave a phantom sale in her books.
  const st = couponed({ refundedAt: REFUND });
  assert.equal(dayMoney(st, "d18").cash, 12,
    "★ the sale lost the money it took on its own day");
  assert.equal(refundsBetween(st, ...SEP).total, 12,
    "★ an old refunded order gave nothing back in the books");
  assert.equal(profitBetween(st, ...SEP).refunds, 12, "and Profit never took the refund off");
});

test("★ a PARTIAL refund takes exactly what she gave back", () => {
  const st = couponed({ refundAmountRM: 5 });
  assert.equal(dayMoney(st, "d18").cash, 12, "★ the till lost money the customer really paid");
  assert.equal(refundsBetween(st, ...SEP).total, 5, "★ RM5 back is not RM5 out");
  assert.equal(cashHolds(st, ...SEP), 7, "★ RM12 in, RM5 back — the account is wrong");
});

test("★ a FULL refund of a DISCOUNTED order leaves nothing held — the case that was wrong", () => {
  // ⚠️ Giving back everything the customer paid (RM12) must leave RM0 — not the RM3 the coupon was
  // worth, which she never received.
  const st = couponed({ refundAmountRM: 12 });
  assert.equal(cashHolds(st, ...SEP), 0, "★ a phantom discount is left in the account");
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
  // knows it — so anything that sums rows would take the same refund off once per item.
  const st = state();
  st.orders = [
    row({ id: "a", groupId: "c2fda5", paidReceived: true, paidMethod: "cash", refundAmountRM: 5 }),
    row({ id: "b", groupId: "c2fda5", paidReceived: true, paidMethod: "cash", refundAmountRM: 5 }),
  ];
  assert.equal(dayMoney(st, "d18").cash, 30, "★ the two rows are one order and one sale");
  const back = refundsBetween(st, ...SEP);
  assert.equal(back.total, 5, `★ one RM5 refund was paid out twice — RM${back.total}`);
  assert.equal(back.rows.length, 1, "and it is one refund row, not one per item");
  assert.equal(cashHolds(st, ...SEP), 25, "★ RM30 in, ONE RM5 back is RM25");
});

test("★ the books still add up when there is a discount AND a refund", () => {
  // A discount and a refund are each visible as their own thing rather than folded away — the discount
  // inside Sales, the refund on its own line.
  const st = couponed({ refundAmountRM: 5 });
  const p = profitBetween(st, ...SEP);
  const sold = tradingRows(st, ...SEP);
  assert.equal(sold.reduce((sum, r) => sum + (Number(r.sales) || 0), 0), p.sales,
    "★ the Sales journal no longer adds up to the Sales line");
  assert.equal(sold.some((r) => /Bring-a-friend/.test(r.what)), true, "the discount is not in the journal");
  assert.equal(sold.some((r) => /Refunded/.test(r.what)), false, "the refund is drawn as a sale again");
  assert.equal(refundRows(st, ...SEP).reduce((sum, r) => sum + r.amount, 0), p.refunds,
    "★ the Refunds journal no longer adds up to the Refunds line");
});

test("★ a line nothing can price is still a LINE, refund or no refund", () => {
  // ⚠️ Regressions caught while building this: skipping a group whose net is zero also skipped an
  // order whose product simply has no price. The app keeps `null` apart from `0` on purpose.
  const st = state();
  st.products[0].price = "";
  st.orders = [row({ id: "a", refundedAt: REFUND })];
  const p = profitBetween(st, ...SEP);
  assert.equal(p.sales, 0);
  assert.equal(p.refunds, 0, "a refund of a bill that was never priced is not money that moved");
  const rows = tradingRows(st, ...SEP);
  assert.equal(rows.length, 1, "an order nothing can price is dropped from the journal");
  assert.equal(rows[0].price, null, "and it is not marked as sold for nothing");
});
