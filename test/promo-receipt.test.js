// test/promo-receipt.test.js — an order's money as a RECEIPT, on her own screens.
//
// Her ask, 2 Oct 2026: "build the next promo screen, What is the promo screen for? Can the
// showing of promo be more streight forward, clearer, like putting them in an accounting
// format, clearly shown the working, how they add up". The shape she picked is one line per
// fact — words left, figure right, a rule above the Total — which is the same shape the
// Profit statement already uses, and it replaced two run-on sentences ("The customer owes
// RM24.00 — items total RM16.00 + courier charge RM8.00 ...") she had to unpick to read.
//
// The customer's message states the same facts in its own one-line-per-fact way. Both read
// ONE `parts` object, built by customerTotal, so the two can never disagree — that agreement
// is asserted here too, because two presentations of one sum is only safe while they are
// genuinely two presentations and not two sums.
//
// Pure: no DOM, no fetch, no storage. The DOM half (the rows actually reaching the two
// screens) is held in orders-day-sum.test.js, which drives the real pop-ups.

import { test } from "node:test";
import assert from "node:assert/strict";

const { codeMissed, codeNotApplied, customerTotal, moneyLines, promoValue, receiptNote, receiptRows } =
  await import("../admin/js/courier.js");

const orders = (extra = {}) => ([
  { id: "ordabc123", groupId: "ordgabc123", deliveryDateId: "d18", deliveryDate: "2026-09-18",
    fulfillment: "courier", whatsapp: "60123456789",
    productId: "p1", qty: 2, productName: "Focaccia", unitPrice: 15, status: "ready", ...extra },
]);

function state(extra = {}) {
  return {
    settings: { currency: "RM", storefront: { name: "Jien Luv 2 Bake" } },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }],
    orders: [],
    expenses: [],
    promoCodes: [],
    ...extra,
  };
}

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

// An order carrying `code`, priced by customerTotal — so a test asserts on the real parts
// and not on a literal it typed itself.
function priced(code = mkCode(), order = {}) {
  const st = state({ promoCodes: code ? [code] : [] });
  st.orders = orders({ promo: code ? code.code : "", ...order });
  return { st, g: { orders: st.orders }, parts: customerTotal(st, { orders: st.orders }) };
}

const labels = (rows) => rows.map((r) => r.label);
const rowFor = (rows, label) => rows.find((r) => r.label === label);

// ── the shape of the receipt ─────────────────────────────────────────────────

test("a plain order's receipt is the items and the total, and nothing else", () => {
  const { st, parts } = priced(null);
  assert.deepEqual(receiptRows(st, parts),
    [{ label: "Items total", value: "RM 30.00" },
      { label: "Total", value: "RM 30.00", total: true }],
    "two lines that agree — the subtotal is what stops the Total arriving from nowhere");
});

test("a code that worked is a row of its own, reading as the money that came off", () => {
  const { st, parts } = priced(mkCode());
  assert.deepEqual(receiptRows(st, parts),
    [{ label: "Items total", value: "RM 30.00" },
      { label: "Promo FRESH10", value: "-RM 10.00" },
      { label: "Total", value: "RM 20.00", total: true }],
    "the code named, the ringgit signed, and the Total the two lines above it add to");
});

test("a code that gave nothing is still a row, reading nothing", () => {
  // The row is DRAWN rather than left out. A receipt that simply omitted a code the
  // customer typed cannot be told apart from one for an order she never used a code on —
  // and the difference is exactly what she needs to see to decide whether to honour it.
  const { st, parts } = priced(mkCode({ basket: { type: "amount", amount: 100 } }));
  assert.deepEqual(receiptRows(st, parts),
    [{ label: "Items total", value: "RM 30.00" },
      { label: "Promo FRESH10", value: "RM 0.00" },
      { label: "Total", value: "RM 30.00", total: true }],
    "the code is on the receipt reading RM 0.00, not silently dropped");
});

test("a posted order's receipt carries the flat postage as a row of its own", () => {
  // This shop's own fee (the bakery has none). Without the row the receipt reads
  // "Items total RM30" and then "Total RM38" with nothing between — a sum that does not
  // add up on her own screen. The fee is read from her storefront settings, and only
  // once a phone has actually set it (the postageSet gate), which is why the other
  // fixtures here carry no postage row at all.
  const st = state({ settings: { currency: "RM", storefront: { name: "Munchies Furkidz", postageRM: 8, postageSet: true } } });
  st.orders = orders();
  const parts = customerTotal(st, { orders: st.orders });
  assert.equal(parts.postage, 8, "the flat fee applies to a posted order");
  assert.deepEqual(receiptRows(st, parts),
    [{ label: "Items total", value: "RM 30.00" },
      { label: "Postage (nationwide)", value: "RM 8.00" },
      { label: "Total", value: "RM 38.00", total: true }],
    "and it is the line that carries the RM8 between the goods and the total");
  // A recorded courier charge replaces the flat fee rather than sitting beside it.
  st.orders = orders({ courierFee: 8, courierPaidBy: "customer" });
  const charged = customerTotal(st, { orders: st.orders });
  assert.equal(charged.postage, 0, "a charge you recorded takes the flat fee off");
  assert.equal(labels(receiptRows(st, charged)).includes("Postage (nationwide)"), false,
    "so the two never draw a row each and ask for the RM8 twice");
});

test("exactly one row is the total, and it is the last one", () => {
  const { st, parts } = priced(mkCode(), { courierFee: 8, courierPaidBy: "customer" });
  const rows = receiptRows(st, parts);
  assert.equal(rows.filter((r) => r.total).length, 1, "one rule, one line under it");
  assert.equal(rows[rows.length - 1].total, true, "and it is the row the rule sits above");
});

test("a COD charge is a row with its own rider, and stays out of the total", () => {
  // COD is money they owe but not money SHE collects, so the receipt names it where it
  // sits rather than folding it in — or she asks for the RM8 the courier is already asking
  // for at the door.
  const { st, parts } = priced(null, { courierFee: 8, courierPaidBy: "customer", courierCod: true });
  const rows = receiptRows(st, parts);
  assert.equal(rowFor(rows, "Courier charge")?.note, "COD, pay the courier when your order reaches you",
    "the row says where the money goes");
  assert.equal(rowFor(rows, "Total").value, "RM 30.00", "and the total asks for the bread alone");
});

// ── the note under the receipt ───────────────────────────────────────────────

test("a receipt with nothing to explain draws no note at all", () => {
  // The guard. A working code, and no code, both draw nothing extra — the note is only for
  // the one case it was written for, and it must not leak onto every other receipt.
  assert.equal(receiptNote(state(), priced(null).parts), "", "no code, no note");
  assert.equal(receiptNote(state(), priced(mkCode()).parts), "", "a code that worked, no note");
});

test("the note says which basket the code wanted, which it got, and that the rule is a guide", () => {
  // "sometime when situation allow, baker will handle promo flexibly, say order is 80 and
  // customer ask for 10 discount, baker discretion sometimes will allow too, but if
  // customer only order 16 and ask for 10 discount then baker will turn down the offer ...
  // it is a guide, not the gate" (2 Oct 2026). So the note states the code's own rule and
  // then hands the decision back to her: this line is on HER screens, and it must never
  // read as the app having decided for her.
  const { st, parts } = priced(mkCode({ basket: { type: "amount", amount: 100 } }));
  const note = receiptNote(st, parts);
  assert.match(note, /FRESH10 needs a basket of RM 100\.00/,
    `the rule, in the code's own terms: ${note}`);
  assert.match(note, /this one was RM 30\.00/, "and what this order actually came to");
  assert.match(note, /guide, not a gate/, "the rule is named as a guide");
  assert.match(note, /you can still take something off by hand/, "and the decision is handed back to her");
});

// ── which codes count as missed ──────────────────────────────────────────────

test("codeMissed answers for a live code the basket never reached, and stays quiet otherwise", () => {
  const st = state({ promoCodes: [mkCode({ basket: { type: "amount", amount: 100 } })] });
  assert.deepEqual(codeMissed(st, "FRESH10", 30), { code: "FRESH10", short: 70, minimum: 100 },
    "RM70 short of a RM100 basket — the shortfall AND the basket, so a screen can say either");
  assert.equal(codeMissed(st, "FRESH10", 100), null, "the basket reached: not missed");
  assert.equal(codeMissed(st, "FRESH10", 250), null, "and past it: still not missed");
});

test("a code she has since deleted is not a missed code, and does not crash", () => {
  // There is no offer left to point at, so the honest reading of that order is simply that
  // it carried no discount — the same rule promoValue keeps for a deleted code's money.
  const st = state({ promoCodes: [] });
  assert.equal(codeMissed(st, "GONE10", 30), null, "an unknown code is not a code that was missed");
  assert.equal(codeMissed(st, "", 30), null, "and no code at all is not one either");
});

test("codeNotApplied reads the basket off the order, and agrees with codeMissed", () => {
  const { st, g } = priced(mkCode({ basket: { type: "amount", amount: 100 } }));
  assert.deepEqual(codeNotApplied(st, g.orders), { code: "FRESH10", short: 70, minimum: 100 },
    "the same answer as the handed-in form, read from the order it is on");
  assert.equal(codeNotApplied(st, orders()), null,
    "an order with no code on it carries nothing to explain");
});

// ── one sum, two presentations ───────────────────────────────────────────────

test("the receipt's Total and the message's Total are the same figure, on every kind of order", () => {
  // The whole reason one `parts` is built: a receipt on her screen and a message to the
  // customer that quoted different figures would be the same class of fault as a charge
  // named in one and not the other. Asserted across every shape the code can take.
  const shapes = [
    priced(null),
    priced(mkCode()),
    priced(mkCode({ basket: { type: "amount", amount: 100 } })),
    priced(mkCode({ gives: { type: "delivery", value: 0, cap: 0 } }), { courierFee: 8, courierPaidBy: "customer" }),
  ];
  for (const { st, parts } of shapes) {
    const receiptTotal = rowFor(receiptRows(st, parts), "Total").value;
    // This shop's message states the sum the customer is asked for on its "To pay" line
    // when anything moved it, and on the goods' own "Total" line when nothing did. Either
    // way it is one figure, and it is the one the receipt's own Total row carries.
    const lines = moneyLines(st, parts);
    const asked = lines.find((l) => l.startsWith("To pay: "));
    const goods = lines.find((l) => l.startsWith("Total: "));
    const messageTotal = (asked || goods).replace(/^(?:To pay|Total): /, "");
    assert.equal(messageTotal, receiptTotal,
      "the receipt and the message quote one figure, or the two cannot be read side by side");
  }
});

test("the not-applied line names the basket the code wanted, in the message's own money", () => {
  // The customer's half of the note: short, factual, and free of the "this is a guide"
  // sentence, which is her business and not theirs.
  const { st, parts } = priced(mkCode({ basket: { type: "amount", amount: 100 } }));
  assert.ok(moneyLines(st, parts).includes("Code FRESH10 not applied: basket below RM 100.00"),
    `one quiet line, between the workings and the total: ${moneyLines(st, parts).join(" / ")}`);
});

test("nothing about a missed code reaches the money itself", () => {
  // The line explains; it does not deduct. A code that was never earned must leave the
  // total exactly where the bakery's own arithmetic puts it — this is v275's whole fix,
  // and it must survive the new line being drawn over it.
  const { st, parts } = priced(mkCode({ basket: { type: "amount", amount: 100 } }));
  assert.equal(parts.total, 30, "RM30 of goods and nothing off");
  assert.equal(parts.promo, 0, "the discount is still nothing");
  assert.equal(promoValue(st, "FRESH10", 30, 0).money, 0, "and the Edit form's own preview agrees");
});
