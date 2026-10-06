// test/messages.test.js — the later-stage WhatsApp messages: the payment
// reminder (order waiting on Paid), the pickup reminder (order packed) and the
// shipped message (courier order on its way, with its tracking number).
// Pure modules, no DOM shim needed. All must carry the order code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaymentReminder, buildPickupReminder, buildShippedMessage } from "../admin/js/messages.js";

function state(overrides = {}) {
  return {
    settings: { currency: "RM", storefront: { name: "Munchies Furkidz", whatsapp: "60123456789", tngQr: "https://img/tng.png" } },
    products: [{ id: "p1", name: "Chicken Jerky", price: 15 }, { id: "p2", name: "Duck Jerky", price: 8 }],
    deliveryDates: [{ id: "d1", date: "2026-09-07" }],
    ...overrides,
  };
}

function group(overrides = {}) {
  return { orders: [{
    id: "ord_ab12cd34ef56", groupId: "ordg_112233445566",
    deliveryDateId: "d1", fulfillment: "collect",
    whatsapp: "+60 12-345 6789", customerName: "Ain",
    productId: "p1", qty: 2,
    ...overrides,
  }] };
}

test("payment reminder leads with the order code and re-sends the QR", () => {
  const built = buildPaymentReminder(state(), group(), "https://bake.app/store/?track=445566");
  assert.equal(built.recipient, "60123456789");
  assert.ok(built.message.includes("Order #445566"), "order code in the reminder");
  assert.ok(built.message.includes("Total: RM 30.00"), "total");
  assert.ok(built.message.includes("Delivery: Mon, 7 Sep - Collect (local)"), "date + fulfillment");
  assert.ok(built.message.includes("\nhttps://img/tng.png\n"), "QR image URL on its own line");
  assert.ok(built.message.includes("put your phone number (60123456789) in the payment description"));
  assert.ok(built.message.includes("Already paid? Please ignore this message."));
  assert.ok(built.message.includes("Track your order: https://bake.app/store/?track=445566"));
  const nonAscii = [...built.message].filter((ch) => ch.codePointAt(0) > 0x7f);
  assert.deepEqual(nonAscii, [], "message is plain ASCII");
});

test("without a published QR the reminder has no image URL", () => {
  const s = state({ settings: { currency: "RM", storefront: { name: "Munchies Furkidz", tngQr: "" } } });
  const built = buildPaymentReminder(s, group(), "https://bake.app/store/?track=445566");
  assert.ok(!built.message.includes("https://img/tng.png"));
  assert.ok(!built.message.includes("()"), "no empty parentheses when no number");
});

test("pickup reminder is worded for self collect", () => {
  const built = buildPickupReminder(state(), group(), "https://bake.app/store/?track=445566");
  assert.equal(built.recipient, "60123456789");
  assert.ok(built.message.includes("Order #445566"));
  assert.ok(built.message.includes("ready for collection on Mon, 7 Sep"), "self-collect wording");
  assert.ok(built.message.includes("Track your order: https://bake.app/store/?track=445566"));
});

test("pickup reminder switches wording for a courier order", () => {
  const built = buildPickupReminder(state(), group({ fulfillment: "courier" }), "https://bake.app/store/?track=445566");
  assert.ok(built.message.includes("will be posted to you on Mon, 7 Sep"), "courier wording");
});

test("payment reminder for a posted order carries the flat postage on the to-pay line", () => {
  const s = state({ settings: { currency: "RM", storefront: { name: "Munchies Furkidz", whatsapp: "60123456789", tngQr: "https://img/tng.png", postageRM: 8 } } });
  const built = buildPaymentReminder(s, group({ fulfillment: "courier", address: "12 Jalan Bunga" }), "https://bake.app/store/?track=445566");
  assert.ok(built.message.includes("Postage (nationwide): RM 8.00"));
  assert.ok(built.message.includes("To pay: RM 38.00"), "RM 30 of jerky + RM 8 postage");
});

test("a group with no WhatsApp number returns null", () => {
  assert.equal(buildPaymentReminder(state(), group({ whatsapp: "" }), "https://bake.app/store/?track=445566"), null);
  assert.equal(buildPickupReminder(state(), group({ whatsapp: "" }), "https://bake.app/store/?track=445566"), null);
});

test("shipped message says the order is on its way and carries the tracking number", () => {
  const built = buildShippedMessage(state(),
    group({ fulfillment: "courier", trackingNo: "JT123456789" }),
    "https://bake.app/store/?track=445566");
  assert.equal(built.recipient, "60123456789");
  assert.ok(built.message.includes("is on its way"), "the shipped wording");
  assert.ok(built.message.includes("Order #445566"), "order code in the message");
  assert.ok(built.message.includes("Posting day: Mon, 7 Sep - Post (nationwide)"), "the posting day + how it left");
  assert.ok(built.message.includes("Items: Chicken Jerky x2"), "what was sent");
  assert.ok(built.message.includes("Tracking number: JT123456789"), "the number she typed");
  assert.ok(built.message.includes("Track your order: https://bake.app/store/?track=445566"));
  const nonAscii = [...built.message].filter((ch) => ch.codePointAt(0) > 0x7f);
  assert.deepEqual(nonAscii, [], "message is plain ASCII");
});

test("with no tracking number the line is left out, not printed empty", () => {
  const built = buildShippedMessage(state(), group({ fulfillment: "courier" }), "https://x");
  assert.ok(built.message.includes("is on its way"), "the message still goes without a number");
  assert.ok(!built.message.includes("Tracking number"), "no empty label");
});

test("the shipped message needs a WhatsApp number, like the other two", () => {
  assert.equal(buildShippedMessage(state(), group({ whatsapp: "" }), "https://x"), null);
});

test("a tracking number is sent exactly as typed — spaces and dashes kept", () => {
  const built = buildShippedMessage(state(), group({ trackingNo: "  JT 123-456  " }), "https://x");
  assert.ok(built.message.includes("Tracking number: JT 123-456"),
    "trimmed at the ends, untouched inside — the courier's site is fussy about it");
});

// v189 puts a BOOKED TRIP's share link in this same slot. The pure label-maker has
// tests of its own (courier-job.test.js); what this one holds is the WIRING — that the
// shipped message routes the value through it at all. Without that, a booking would
// send the customer a courier's URL labelled "Tracking number", which is a page they
// are told to read out over the phone.
test("the share link a booked trip came back with says Track your delivery", () => {
  const link = "https://www.lalamove.com/en-my/track/order/LM-PG-771204";
  const built = buildShippedMessage(state(), group({ trackingNo: link }), "https://x");
  assert.ok(built.message.includes(`Track your delivery: ${link}`),
    "a link is labelled a link, not a number");
  assert.ok(!built.message.includes("Tracking number"),
    "and the number label is not also printed — one slot, one label");
});

// ── v304: the four messages, for an order collecting at a Point ─────────────
// The confirmation is tested in confirm.test.js; these are the LATER messages, and the discussion
// said the customer must be told the collection window in "the confirmation and every later
// message" — so all of them are driven here, not one of them.
//
// The window is the PLACE's, typed once on the Point. The order also carries the run's own
// arrival window (v302 stamped it when the van was booked), and the customer is deliberately
// never told that one: it is when the bread gets there, not when they can collect.

const FARLIM = {
  id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik, 11500 Air Itam",
  receiver: "Aunty Lim", phone: "60123456789", feeRM: 0.5, paused: false,
  createdAt: "2026-08-12T00:00:00.000Z", collectWindow: "14:00-18:00",
  place: { lat: 5.4, lng: 100.28, label: "Farlim" },
};
const atPoint = { pointId: "pt_farlim", pointName: "Farlim, Air Itam", deliveryWindow: "10:00-12:00" };

test("the two messages a collecting customer gets name the place and when (v304)", () => {
  // The SHIPPED message is deliberately not here: it is only ever sent for a courier order, so a
  // customer collecting at a Point never receives it. What they do receive is the confirmation
  // (tested in confirm.test.js), the payment reminder and the pickup reminder.
  const st = state({ points: [FARLIM] });
  const g = group(atPoint);
  for (const [name, built] of [
    ["payment reminder", buildPaymentReminder(st, g, "")],
    ["pickup reminder", buildPickupReminder(st, g, "")],
  ]) {
    assert.ok(built.message.includes("Farlim, Air Itam"), `${name}: names the place`);
    assert.ok(!/ready for pickup/.test(built.message), `${name}: and never a bare "pickup" with no place`);
    assert.ok(built.message.includes("collect 2-6 pm"), `${name}: when`);
    assert.ok(!built.message.includes("10-12"), `${name}: and never the van's arrival window`);
  }
});

test("a Point with no hours leaves every later message promising only the day (v304)", () => {
  const st = state({ points: [{ ...FARLIM, collectWindow: "" }] });
  const built = buildPickupReminder(st, group(atPoint), "");
  assert.ok(built.message.includes("Farlim, Air Itam"), "still told where");
  assert.ok(!/collect \d/.test(built.message), "and nothing about a time");
  assert.ok(!built.message.includes("10-12"), "nor the van's window");
});
