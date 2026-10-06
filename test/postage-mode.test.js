// test/postage-mode.test.js — flat postage, or quoted by courier (28 Sep 2026).
//
// Her ask, verbatim: "add a switch whether a flat postage or quote by courier".
//
// The switch turns on ONE fact, and everything else follows from it: a posted order
// either carries the flat fee the app has always quoted, or its delivery is priced per
// order from what the courier actually asks for it. Three things have to hold, and
// these tests are the three:
//
//   • OFF ("flat") is EXACTLY what this app did before the switch existed. Not
//     "similar to" — the same figures, the same words, the same absence of a delivery
//     line on a collect order.
//   • ON ("quote") takes the flat fee away and does not put anything in its place. A
//     posted order with no charge recorded owes the items alone, and is TOLD so rather
//     than left with a total that reads like the whole cost — on both surfaces the
//     customer sees, because they are read side by side.
//   • Recording a charge ends it, with no second mechanism: the note disappears and
//     the ordinary "Courier charge / To pay" pair takes over, because the recorded
//     charge has always replaced the flat fee on that order.
//
// Pure — state.js, courier.js and supabase.js are side-effect free under Node, so
// there is no DOM and no fetch here. The card's own half is pinned in store.test.js.
//
// LOCALIZED: this app says "Post (nationwide)" and quotes "Postage (nationwide)"; the
// fixtures below are this app's own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { flatPostage, postageMode, customerTotal, moneyLines, writeCourierCharge } =
  await import("../admin/js/courier.js");
const { buildConfirmation } = await import("../admin/js/confirm.js");
const { trackingSnapshot } = await import("../admin/js/supabase.js");
const { normalize } = await import("../admin/js/state.js");

const orders = (extra = {}) => ([
  { id: "ordabc123", groupId: "ordgabc123", deliveryDateId: "d18", deliveryDate: "2026-09-18",
    productId: "p1", qty: 2, productName: "Chicken Jerky", unitPrice: 15,
    fulfillment: "courier", status: "ready", ...extra },
]);

function state(sf = {}) {
  return {
    settings: { currency: "RM", storefront: { name: "Munchies Furkidz", postageRM: 8, ...sf } },
    products: [{ id: "p1", name: "Chicken Jerky", price: 15 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }],
    orders: orders(),
    expenses: [],
  };
}
const groupOf = (st) => ({ orders: st.orders });

// ── which way delivery is priced ───────────────────────────────────────────
test("the switch reads flat unless it is exactly the word quote", () => {
  assert.equal(postageMode(state()), "flat", "not set at all — the behaviour before it existed");
  assert.equal(postageMode(state({ postageMode: "flat" })), "flat");
  assert.equal(postageMode(state({ postageMode: "quote" })), "quote");
  // Anything else is a typo or an older save, and neither may silently change what a
  // customer is told they owe.
  for (const junk of ["", "Quote", "courier", null, undefined, 0, 1, {}, []]) {
    assert.equal(postageMode(state({ postageMode: junk })), "flat", `junk: ${JSON.stringify(junk)}`);
  }
});

test("an older save, written before the switch existed, reads as flat", () => {
  const old = normalize({ settings: { storefront: { name: "Munchies Furkidz", postageRM: 6, postageSet: true } } });
  assert.equal(old.settings.storefront.postageMode, "flat");
  assert.equal(old.settings.storefront.postageModeSet, false,
    "and this phone has still to choose — see the sync test below");
  assert.equal(old.settings.storefront.postageRM, 6, "the fee it did know is untouched");
});

test("normalize keeps the switch, and only the real word quote survives the round trip", () => {
  const kept = normalize({ settings: { storefront: { postageMode: "quote", postageModeSet: true } } });
  assert.equal(kept.settings.storefront.postageMode, "quote");
  assert.equal(kept.settings.storefront.postageModeSet, true);
  const junk = normalize({ settings: { storefront: { postageMode: "whatever", postageModeSet: "yes" } } });
  assert.equal(junk.settings.storefront.postageMode, "flat");
  assert.equal(junk.settings.storefront.postageModeSet, false, "only an explicit true counts");
});

// ── the fee itself ────────────────────────────────────────────────────────
test("the flat fee applies to a posted order — and only while the switch is off", () => {
  assert.equal(flatPostage(state(), orders()[0]), 8, "flat: quoted, exactly as before");
  assert.equal(flatPostage(state({ postageMode: "quote" }), orders()[0]), 0,
    "quote: there is no flat fee to stand in for");
  assert.equal(flatPostage(state(), orders({ fulfillment: "collect" })[0]), 0,
    "a collect order never carried it, in either mode");
  assert.equal(flatPostage(state({ postageMode: "quote" }), orders({ fulfillment: "collect" })[0]), 0);
});

// ── what the customer owes ────────────────────────────────────────────────
test("quote mode: a posted order with no charge owes the items alone, and says so", () => {
  const st = state({ postageMode: "quote" });
  const parts = customerTotal(st, groupOf(st));
  assert.deepEqual(parts, { items: 30, courier: 0, cod: 0, postage: 0, quoted: true,
    promo: 0, promoCode: "", notApplied: "", promoMinimum: 0, coupon: 0, couponId: "", couponCode: "", couponRole: "", total: 30 },
    "no delivery figure is invented, and the total is not silently the whole cost");
  assert.deepEqual(moneyLines(st, parts), [
    "Total: RM 30.00",
    "Postage: quoted separately - we'll message you the exact amount",
  ], "the note and NO 'To pay': there is nothing extra to pay yet");
});

test("flat mode says none of that — the line it has always printed is untouched", () => {
  const st = state();
  const parts = customerTotal(st, groupOf(st));
  assert.equal(parts.quoted, false);
  assert.deepEqual(moneyLines(st, parts), [
    "Total: RM 30.00",
    "Postage (nationwide): RM 8.00",
    "To pay: RM 38.00",
  ]);
});

test("recording a charge ends the quote, with no second switch to remember", () => {
  const st = state({ postageMode: "quote" });
  writeCourierCharge(st, st.orders, groupOf(st), { fee: 12, who: "customer", method: "Cash" });
  const parts = customerTotal(st, groupOf(st));
  assert.equal(parts.quoted, false, "the delivery cost is settled now");
  assert.deepEqual(moneyLines(st, parts), [
    "Total: RM 30.00",
    "Courier charge: RM 12.00",
    "To pay: RM 42.00",
  ], "the ordinary charge pair takes over — the same rule as in flat mode");
});

test("quote mode leaves three orders saying nothing, because nothing is owed", () => {
  const cases = {
    "a collect order": orders({ fulfillment: "collect" })[0],
    "a charge she absorbed": orders({ courierFee: 12, courierPaidBy: "me" })[0],
    "a COD charge": orders({ courierFee: 12, courierPaidBy: "customer", courierCod: true })[0],
  };
  for (const [name, first] of Object.entries(cases)) {
    const st = state({ postageMode: "quote" });
    st.orders = [first];
    const parts = customerTotal(st, groupOf(st));
    assert.equal(parts.quoted, false, `${name} must not be told postage is coming`);
  }
});

// ── the customer's own surfaces ───────────────────────────────────────────
test("the confirmation carries the note, because it is the message that asks for money", () => {
  const st = state({ postageMode: "quote", whatsapp: "60123456789" });
  const built = buildConfirmation(st, groupOf(st));
  assert.ok(built && built.message.includes("Postage: quoted separately - we'll message you the exact amount"),
    "a figure to pay with no word about the postage would read as the final cost");
  assert.ok(!built.message.includes("To pay:"),
    "and no 'To pay' line, because there is nothing extra to pay yet");
  assert.ok(!built.message.includes("Postage (nationwide)"), "and never both wordings");
});

test("the card is told the delivery cost is unsettled, and is not told the flat fee", () => {
  const quote = state({ postageMode: "quote" });
  const row = trackingSnapshot(quote, groupOf(quote));
  assert.equal(row.postage_quoted, true);
  assert.equal(row.courier_fee, null, "no charge has been recorded, so there is no charge to name");
  assert.equal(row.total, "RM 30.00", "the total is the items alone — quoted_ is what explains it");

  const flat = state();
  assert.equal(trackingSnapshot(flat, groupOf(flat)).postage_quoted, null,
    "in flat mode nothing changes: the fee is inside the total and never named");

  const settled = state({ postageMode: "quote" });
  writeCourierCharge(settled, settled.orders, groupOf(settled), { fee: 12, who: "customer", method: "Cash" });
  assert.equal(trackingSnapshot(settled, groupOf(settled)).postage_quoted, null,
    "the moment the charge is recorded the note is gone — the fee column speaks instead");
});

test("the card's note and the WhatsApp note are one sentence, not two", () => {
  // The two are read side by side by the same customer, so a wording that drifted
  // would be two answers to one question. This reads the language file the way the
  // card does, because the pair cannot be compared any other way: the message is
  // built in the backoffice and the note is drawn on the page.
  const lang = readFileSync(new URL("../store-lang.js", import.meta.url), "utf8");
  const m = lang.match(/postageQuoted: "([^"]+)"/);
  assert.ok(m, "the card's postageQuoted key was not found");
  const st = state({ postageMode: "quote" });
  const note = moneyLines(st, customerTotal(st, groupOf(st)))[1];
  assert.equal(note, m[1], "the message line and the card's key must be the same words");
});

test("the card's three languages all carry it, and none of them is a leftover copy", () => {
  const lang = readFileSync(new URL("../store-lang.js", import.meta.url), "utf8");
  const hits = lang.match(/^\s*postageQuoted: "(.+)",$/gm) || [];
  assert.equal(hits.length, 3, "English, Chinese and Bahasa Malaysia");
  assert.equal(new Set(hits).size, 3, "three different sentences — one language is not another's text");
});
