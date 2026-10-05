// test/promo-total.test.js — the promo code moves the customer's Total (v272, 2 Oct 2026).
//
// Her report, the day after v271 shipped: "pushed. The whatsapp message still withhout the
// promo discount". She was right, and v270 had said so on purpose — the code rode on the
// order, the amber tag proved it had arrived, and not one of the four customer-facing
// messages did any arithmetic with it. Every discount was hers to take off by hand.
//
// She has overruled that, in one answer: "Take it off the Total". So the code reduces the
// figure the customer is asked for, in all four places that quote it — the confirmation,
// the payment reminder, the "on its way" message and the customer's track page — and in her
// own "customer owes" line, which must never disagree with what the customer was told.
//
// Two rules hold this file together, and both of them are about NOT moving:
//
//   • An order with no code reads EXACTLY as it always has, byte for byte. The guard below
//     compares whole messages, not lines, because the fault this file exists to prevent is
//     a discount leaking a line, a total change or a stray blank into an ordinary order.
//   • A code is never RE-JUDGED here. Whether it has since been paused, ended or used up
//     says nothing about an order already placed and already promised. Ending a code keeps
//     what it already gave — the same rule promo-usage.js counts by.
//
// The money comes off in ONE place, `customerTotal` — the seam the four message builders
// and her own screen all read — so no screen can quote a different figure from another.
// These tests go through those builders rather than through the helper alone, because a
// helper proven correct and a message never wired to it is exactly the fault v271 shipped.
//
// Pure throughout: no DOM, no fetch, no storage.

import { test } from "node:test";
import assert from "node:assert/strict";

const { customerTotal, moneyLines, promoOn, promoValue } = await import("../admin/js/courier.js");
const { buildConfirmation } = await import("../admin/js/confirm.js");
const { buildPaymentReminder, buildShippedMessage } = await import("../admin/js/messages.js");
const { trackingSnapshot } = await import("../admin/js/supabase.js");

// One customer order of two Focaccia at RM15 — sold at a frozen price, the way a real order
// carries what it was sold for. Courier, so a charge CAN be present, and a phone number, so
// the two messages that refuse to build without a recipient do build.
const orders = (extra = {}) => ([
  { id: "ordabc123", groupId: "ordgabc123", deliveryDateId: "d18", deliveryDate: "2026-09-18",
    fulfillment: "courier", whatsapp: "60123456789",
    productId: "p1", qty: 2, productName: "Focaccia", unitPrice: 15, status: "ready", ...extra },
]);

function state(extra = {}) {
  return {
    settings: { currency: "RM", storefront: { name: "Munchies Furkidz" } },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }],
    orders: [],
    expenses: [],
    promoCodes: [],
    ...extra,
  };
}

// Her own code row, every family at its no-opinion default except the offer. Written out in
// full rather than merged shallowly, so a test that changes `gives` cannot silently keep a
// field from the one above it.
const mkCode = (over = {}) => ({
  id: "c1", code: "FRESH10", state: "live", vis: "public", frozen: false,
  who: { type: "all" },
  when: { from: "", to: "" },
  basket: { type: "none", amount: 0 },
  gives: { type: "rm", value: 10, cap: 0 },
  often: { type: "unlimited", n: 0, maxRM: 0 },
  beside: { type: "anything" },
  say: "", sayZh: "", sayMs: "",
  used: 0, given: 0,
  ...over,
});

// A state carrying one code, an order carrying it, and the group — the whole shape a
// discounted order has.
function ordered(code = mkCode(), order = {}) {
  const st = state({ promoCodes: code ? [code] : [] });
  st.orders = orders({ promo: code ? code.code : "", ...order });
  return { st, g: { orders: st.orders } };
}

const confirm = (st, g) => buildConfirmation(st, g, "https://x/track").message;

// ── the discount reaches the customer ────────────────────────────────────────
test("the confirmation names the code and takes it off the Total", () => {
  const { st, g } = ordered();
  const msg = confirm(st, g);
  assert.ok(msg.includes("Promo FRESH10: -RM 10.00"),
    `the line names which code it was, so RM10 and RM5 cannot be confused: ${msg}`);
  assert.ok(msg.includes("To pay: RM 20.00"),
    `the RM30 of goods less the RM10 the code gives: ${msg}`);
  assert.ok(msg.includes("Total: RM 30.00"),
    "and the goods still stand above it, so the sum can be read off the message");
});

test("the customer's total, in its parts, is the one figure the four messages share", () => {
  const { st, g } = ordered();
  assert.deepEqual(customerTotal(st, g),
    { items: 30, courier: 0, cod: 0, postage: 0, quoted: false,
      promo: 10, promoCode: "FRESH10", notApplied: "", promoMinimum: 0, coupon: 0, couponId: "", couponCode: "", total: 20 },

    "one helper, so the message and the customer's own card cannot quote different figures");
});

test("the payment reminder carries the reduced total, and the on-its-way message carries it when a charge was recorded", () => {
  const { st, g } = ordered();
  const reminder = buildPaymentReminder(st, g, "https://x/track");
  assert.ok(reminder, "the payment reminder builds at all");
  assert.ok(reminder.message.includes("Promo FRESH10: -RM 10.00"), `it names the code: ${reminder.message}`);
  assert.ok(reminder.message.includes("To pay: RM 20.00"), "and asks for the reduced total");

  // This shop's on-its-way message deliberately does NOT restate the goods or the flat
  // postage — by the time it goes out the customer has been told both and has very
  // likely paid them, so repeating the sum risks reading as still-owed. It DOES carry
  // the same lines the confirmation carried whenever a charge was recorded on the
  // order, so on those the code and the figure it moved ride with it.
  const withCharge = ordered(mkCode(), { courierFee: 8, courierPaidBy: "customer" });
  const shipped = buildShippedMessage(withCharge.st, withCharge.g, "https://x/track");
  assert.ok(shipped, "the on-its-way message builds at all");
  assert.ok(shipped.message.includes("Promo FRESH10: -RM 10.00"), `it names the code: ${shipped.message}`);
  assert.ok(shipped.message.includes("To pay: RM 28.00"), "and the figure the code left behind");

  const plain = buildShippedMessage(st, g, "https://x/track");
  assert.equal(plain.message.includes("Promo"), false,
    "and an order with no charge recorded still says nothing about money, as it always has");
});

test("the customer's track page is published with the code and the amount it took off", () => {
  const { st, g } = ordered();
  const row = trackingSnapshot(st, g);
  assert.equal(row.promo_code, "FRESH10", "the name, so the card can say which code");
  assert.equal(row.promo_rm, 10, "the ringgit, so the card need not price the order itself");
  assert.equal(row.total, "RM 20.00", "and the figure it publishes is already the reduced one");
});

test("an order that carried no code publishes no code and no amount", () => {
  const st = state({ promoCodes: [mkCode()] });
  st.orders = orders();
  const row = trackingSnapshot(st, { orders: st.orders });
  assert.equal(row.promo_code, null, "null rather than an empty string, so the card leaves the line out");
  assert.equal(row.promo_rm, null);
  assert.equal(row.total, "RM 30.00", "and the total is the goods alone, as it has always been");
});

// ── the guard: an ordinary order does not move ───────────────────────────────
test("an order with no code reads exactly as it did before, beside a code list or without one", () => {
  // The whole message, compared — not a line. A code list sitting in her app must not put a
  // whisker of difference into an order that never used one, and the message it produces must
  // be the one this build has always produced.
  const withList = state({ promoCodes: [mkCode()] });
  withList.orders = orders();
  const without = state();
  without.orders = orders();
  assert.equal(confirm(withList, { orders: withList.orders }), confirm(without, { orders: without.orders }),
    "the same words, the same blank lines, the same total");
  assert.equal(confirm(withList, { orders: withList.orders }).includes("Promo"), false,
    "and no promo line at all — the fault is a label printed with nothing behind it");
});

test("a code worth nothing leaves the message untouched rather than printing an empty discount", () => {
  // A code whose own terms come to nothing on this order — here a ringgit value clamped to
  // zero by a hand-edited row. A line reading "Promo X: -RM 0.00" would be an offer the
  // customer was told about and never given, so the whole line stands down and the message
  // is byte-identical to one that carried no code.
  const zero = ordered(mkCode({ gives: { type: "rm", value: 0, cap: 0 } }));
  const none = state();
  none.orders = orders();
  assert.equal(confirm(zero.st, zero.g), confirm(none, { orders: none.orders }),
    "nothing came off, so nothing is said");
});

// ── what the code is worth ───────────────────────────────────────────────────
test("a percentage of the goods, capped at the ceiling she set", () => {
  const uncapped = ordered(mkCode({ gives: { type: "pct", value: 20, cap: 0 } }));
  assert.equal(customerTotal(uncapped.st, uncapped.g).promo, 6, "20% of the RM30 of goods");

  const capped = ordered(mkCode({ gives: { type: "pct", value: 20, cap: 5 } }));
  assert.equal(customerTotal(capped.st, capped.g).promo, 5,
    "and the RM5 ceiling wins when the percentage would have gone past it");
  assert.ok(confirm(capped.st, capped.g).includes("To pay: RM 25.00"), "so the total reads RM25, not RM24");
});

test("a percentage comes off the goods, never off the courier's charge", () => {
  // The charge is a pass-through: it arrives and leaves her purse in the same breath, and
  // discounting it would make the customer's discount come out of the courier's bill. So the
  // percentage is worked on the RM30 of goods and the RM8 rides beside it untouched.
  const { st, g } = ordered(mkCode({ gives: { type: "pct", value: 20, cap: 0 } }),
    { courierFee: 8, courierPaidBy: "customer" });
  const parts = customerTotal(st, g);
  assert.equal(parts.items, 30);
  assert.equal(parts.courier, 8);
  assert.equal(parts.promo, 6, "20% of RM30 — not 20% of RM38");
  assert.equal(parts.total, 32, "goods plus the charge, less the discount on the goods");
});

test("a free-delivery code waives the charge, and the waived charge is named", () => {
  const { st, g } = ordered(mkCode({ code: "FREEPOST", gives: { type: "delivery", value: 0, cap: 0 } }),
    { courierFee: 8, courierPaidBy: "customer" });
  const msg = confirm(st, g);
  assert.ok(msg.includes("Courier charge: RM 8.00"), `the charge is still named: ${msg}`);
  assert.ok(msg.includes("Promo FREEPOST: -RM 8.00"), "and named again as the thing the code took off");
  assert.ok(msg.includes("To pay: RM 30.00"), "so the RM8 charge and the RM8 waiver cancel, and the goods stand");
});

test("a free-delivery code on a self-collect order is worth nothing and says nothing", () => {
  // There is no delivery fee to waive, so there is no discount: the code is not refused, it
  // simply has nothing to give. An order she is collecting herself must not gain a discount
  // line out of a charge nobody was ever going to be asked for.
  const { st, g } = ordered(mkCode({ code: "FREEPOST", gives: { type: "delivery", value: 0, cap: 0 } }),
    { fulfillment: "collect", courierFee: 8, courierPaidBy: "customer" });
  assert.deepEqual(customerTotal(st, g),
    { items: 30, courier: 0, cod: 0, postage: 0, quoted: false,
      promo: 0, promoCode: "", notApplied: "", promoMinimum: 0, coupon: 0, couponId: "", couponCode: "", total: 30 });

  assert.equal(confirm(st, g).includes("Promo"), false, "and the message is the plain one");
});

test("a discount larger than the order leaves her asking for nothing, never for a negative", () => {
  const { st, g } = ordered(mkCode({ gives: { type: "rm", value: 500, cap: 0 } }));
  assert.equal(customerTotal(st, g).total, 0, "a total she cannot collect stops at zero");
  assert.ok(confirm(st, g).includes("To pay: RM 0.00"), "and the message asks for nothing rather than minus RM470");
});

test("a code is taken off one order, not off every line in the basket", () => {
  // A cart of two lines is ONE customer order and ONE use of the code — the same rule
  // promo-usage.js counts by. A per-line discount would give RM20 here for a code that
  // promises RM10.
  const st = state({ promoCodes: [mkCode()] });
  st.orders = [
    ...orders({ promo: "FRESH10" }),
    { id: "ordabc124", groupId: "ordgabc123", deliveryDateId: "d18", fulfillment: "courier",
      productId: "p1", qty: 1, productName: "Focaccia", unitPrice: 20, status: "ready", promo: "FRESH10" },
  ];
  assert.equal(customerTotal(st, { orders: st.orders }).promo, 10, "RM10 once, on the order");
  assert.equal(customerTotal(st, { orders: st.orders }).total, 40, "RM50 of goods less the RM10");
});

// ── the code as the order remembers it ───────────────────────────────────────
test("the code on the order is matched however it was typed", () => {
  const st = state({ promoCodes: [mkCode()] });
  st.orders = orders({ promo: "  fresh10 " });
  assert.equal(customerTotal(st, { orders: st.orders }).promo, 10,
    "spacing and case are the customer's, not ours — the shop upper-cases what it stamps,"
    + " but a hand-typed or re-imported order must not lose its discount over a space");
});

test("a code she has since deleted does not invent one, and does not crash", () => {
  const st = state();
  st.orders = orders({ promo: "FRESH10" });
  assert.deepEqual(customerTotal(st, { orders: st.orders }),
    { items: 30, courier: 0, cod: 0, postage: 0, quoted: false,
      promo: 0, promoCode: "", notApplied: "", promoMinimum: 0, coupon: 0, couponId: "", couponCode: "", total: 30 },

    "nothing to price it from, so nothing comes off — the same answer as no code at all");
});

test("a code that has since ended still discounts the order it was actually placed on", () => {
  // The rule the whole feature turns on: history is not rewritten. An order was promised a
  // discount on the day it was taken; ending the code the next morning is a decision about
  // future orders and must never reach back and re-price one already sent.
  const { st, g } = ordered(mkCode({ state: "ended", when: { from: "", to: "2026-09-01" } }));
  assert.equal(customerTotal(st, g).promo, 10, "ended code, live discount");
  assert.equal(customerTotal(st, g).total, 20);
});

test("a code that has been fully claimed still discounts the orders that claimed it", () => {
  // The same rule for the ceiling: a code at its last permitted use does not un-spend the
  // uses it has already had. Re-judging here would take the discount back off the very order
  // that used the quota up — the last customer would pay full price and be told the code ran
  // out after they had used it.
  const used = mkCode({ often: { type: "quota", n: 3, maxRM: 0 }, used: 3, given: 30 });
  const { st, g } = ordered(used);
  assert.equal(customerTotal(st, g).promo, 10);
  assert.equal(customerTotal(st, g).total, 20);
});

// ── the shape of the answer ──────────────────────────────────────────────────
test("promoValue answers the same way for an order as for a figure handed in", () => {
  // promoOn is a thin reader over promoValue, and the Edit form goes through promoValue
  // because the basket is not saved yet. A drift between the two would make the form's
  // preview total disagree with the message sent a moment later.
  const { st, g } = ordered();
  assert.deepEqual(promoOn(st, g.orders), promoValue(st, "FRESH10", 30, 0));
  assert.deepEqual(promoValue(st, "", 30, 0), { code: "", money: 0 }, "no code, no discount");
  assert.deepEqual(promoValue(st, "NOPE", 30, 0), { code: "", money: 0 }, "an unknown code, no discount");
});

test("the money lines put the promo between the workings and the total", () => {
  // The order of the lines IS the sum being readable: items, then anything added, then
  // anything taken off, then the total — the figure the customer is asked for, arriving
  // from the lines above it.
  const { st, g } = ordered(mkCode(), { courierFee: 8, courierPaidBy: "customer" });
  assert.deepEqual(moneyLines(st, customerTotal(st, g)), [
    "Total: RM 30.00",
    "Courier charge: RM 8.00",
    "Promo FRESH10: -RM 10.00",
    "To pay: RM 28.00",
  ]);
});

// ── the code's smallest basket ───────────────────────────────────────────────
//
// Her report, 2 Oct 2026, the day after v272 shipped its arithmetic: "the arithmatic is
// not rigght, the fresh10 promo code discount 10 for order of 100, but my order only 16,
// it deduct 10 and customer have to pay 6 only. if thats the case bakery will broke."
//
// She was right, and the hole was exactly here. The shop's code box has always refused a
// basket that is under the code's smallest basket — evaluate() asks it. But the DEDUCTION
// never asked it: it went straight to what the offer was worth on the goods, which is a
// question about the offer and not about the sale. So a code riding on an order whose
// basket was never big enough still took its full value off the Total, and the bakery paid
// for a discount nobody had earned.
//
// The rule these tests hold: whether the basket was ever big enough is a fact about THIS
// ORDER, which never changes, and unlike the code's dates it is judged on every read.
const minCode = (amount, over = {}) =>
  mkCode({ basket: { type: "amount", amount }, ...over });

test("a code whose smallest basket the order never reached gives NOTHING", () => {
  const { st, g } = ordered(minCode(100));
  assert.deepEqual(customerTotal(st, g),
    { items: 30, courier: 0, cod: 0, postage: 0, quoted: false, promo: 0, promoCode: "",
      notApplied: "FRESH10", promoMinimum: 100, coupon: 0, couponId: "", couponCode: "", total: 30 },

    "RM10 off was asked for on RM30 of goods, and RM30 is not RM100 — so nothing comes off,"
    + " and the code is carried as the one that was missed rather than as a discount");
});

test("and the message names the code it could not apply, in one line", () => {
  // v275 kept this message byte-for-byte identical to a plain order's, on the reading that
  // a code that was never earned should leave no trace. Her answer, 2 Oct 2026, overturned
  // that: silence where a code was typed reads as a code that was FORGOTTEN, so the
  // confirmation now states the one thing the customer can act on. Still not
  // "Promo FRESH10: -RM 0.00" (a discount of nothing is not a discount) and still not a bare
  // code name — and the Total itself does not move by a ringgit.
  const missed = ordered(minCode(100));
  const plain = state();
  plain.orders = orders();
  const withCode = confirm(missed.st, missed.g);
  const withoutCode = confirm(plain, { orders: plain.orders });
  const line = "Code FRESH10 not applied: basket below RM 100.00";
  assert.ok(withCode.includes(line), `the code is named, and so is the basket it wanted: ${withCode}`);
  assert.ok(!withoutCode.includes("Code FRESH10"),
    "and an order that carried no code still says nothing about one");
  assert.equal(withCode.replace(`${line}\n`, ""), withoutCode,
    "that line is the ONLY difference — every other line, and the total, is the plain message");
});

test("a basket exactly ON the smallest basket gets the whole discount", () => {
  // "RM30 and above" means RM30. The boundary is the one an off-by-one would break,
  // and it is the difference between honouring the offer she advertised and quietly
  // withholding it from the customers who did exactly what the shop told them to.
  const { st, g } = ordered(minCode(30));
  assert.equal(customerTotal(st, g).promo, 10, "RM30 of goods reaches a RM30 smallest basket");
  assert.equal(customerTotal(st, g).total, 20);
});

test("one ringgit short is short", () => {
  const { st, g } = ordered(minCode(31));
  assert.equal(customerTotal(st, g).promo, 0, "RM30 of goods does not reach RM31");
  assert.equal(customerTotal(st, g).total, 30);
});

test("promoValue carries the same rule, so the Edit form cannot disagree", () => {
  // The Edit window quotes a figure for a basket that is not saved yet, so it goes
  // through promoValue and not through customerTotal. Both must answer together or
  // the form's preview total and the message sent a moment later will differ.
  const { st } = ordered(minCode(100));
  assert.deepEqual(promoValue(st, "FRESH10", 30, 0), { code: "", money: 0 },
    "a hand-typed basket below the smallest basket gives nothing");
  assert.deepEqual(promoValue(st, "FRESH10", 100, 0), { code: "FRESH10", money: 10 },
    "and the same code on a big enough basket gives what it promises");
});

test("a delivery code below its smallest basket waives nothing", () => {
  // The same rule, through the other kind of offer: a free-delivery code that asks for
  // RM100 waives no charge on an RM30 basket. Otherwise the rule would hold for ringgit
  // offers and leak for the one kind whose value arrives as a courier's fee.
  const { st, g } = ordered(
    minCode(100, { code: "FREEPOST", gives: { type: "delivery", value: 0, cap: 0 } }),
    { courierFee: 8, courierPaidBy: "customer" });
  assert.deepEqual(customerTotal(st, g),
    { items: 30, courier: 8, cod: 0, postage: 0, quoted: false, promo: 0, promoCode: "",
      notApplied: "FREEPOST", promoMinimum: 100, coupon: 0, couponId: "", couponCode: "", total: 38 },

    "the charge stands, and the code waives none of it");
});

test("the smallest basket is judged while the code's dates are not", () => {
  // The two are different kinds of fact and must not be confused. A code ENDED
  // yesterday still discounts the order it was placed on — history is not rewritten.
  // The same code ending yesterday still gives nothing on a basket that never reached
  // its minimum — because that was never a discount in the first place.
  const { st, g } = ordered(minCode(100, { state: "ended", when: { from: "", to: "2026-09-01" } }));
  assert.equal(customerTotal(st, g).promo, 0,
    "ending a code cannot turn a sale that never qualified into one that did");

  const reached = ordered(minCode(30, { state: "ended", when: { from: "", to: "2026-09-01" } }));
  assert.equal(customerTotal(reached.st, reached.g).promo, 10,
    "and an ended code still keeps what it gave on a basket that did reach it");
});
