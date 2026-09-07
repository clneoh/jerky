// test/messages.test.js — the later-stage WhatsApp messages: the payment
// reminder (order waiting on Paid) and the pickup reminder (order packed).
// Pure modules, no DOM shim needed. Both must carry the order code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaymentReminder, buildPickupReminder } from "../admin/js/messages.js";

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
