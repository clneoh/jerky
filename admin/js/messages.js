// messages.js — the WhatsApp messages the baker sends from later stages of the
// journey: the payment reminder (while an order is waiting on Paid), the pickup
// reminder (when an order is packed) and the posted message (when a post order
// goes out, carrying its tracking number). Pure (no DOM, no fetch) so they run
// under Node for tests. Like the confirmation, every message leads with the
// order code so the customer can always match it back to their order, and stays
// plain ASCII - emoji have come back as broken boxes on some phones.

import { byId, fmtRM, orderCode, orderLineName, orderLinePrice, waNumber } from "./state.js";
import { shortDate } from "./dates.js";

function basics(state, group, trackUrl) {
  const orders = (group && group.orders) || [];
  const first = orders[0];
  if (!first) return null;
  const recipient = waNumber(first.whatsapp);
  // Same rule as the confirmation: quote the sale, not today's prices.
  const items = orders.map((o) => {
    const name = orderLineName(state, o);
    return `${name === "(deleted product)" ? "item" : name} x${o.qty}`;
  }).join(", ");
  const subtotal = orders.reduce((s, o) => {
    const price = orderLinePrice(state, o);
    return s + (Number(o.qty) || 0) * (price == null ? 0 : price);
  }, 0);
  const total = fmtRM(subtotal, state.settings.currency);
  const del = byId(state.deliveryDates, first.deliveryDateId);
  const date = del ? shortDate(del.date) : String(first.deliveryDate || "");
  const courier = first.fulfillment === "courier";
  const fulfillment = courier ? "Post (nationwide)" : "Collect (local)";
  const sf = (state.settings && state.settings.storefront) || {};
  const bakery = sf.name || "";
  const qr = String(sf.tngQr || "").trim();
  // Posted orders carry the flat nationwide postage fee on top of the items.
  const postage = courier ? Math.max(0, Number(sf.postageRM) || 0) : 0;
  const postageRM = postage > 0 ? fmtRM(postage, state.settings.currency) : "";
  const toPay = fmtRM(subtotal + postage, state.settings.currency);
  // The courier's tracking number she typed on the order. Kept as typed (a
  // pasted number may carry spaces or dashes) — it goes to the customer verbatim.
  const trackingNo = String(first.trackingNo || "").trim();
  return { first, recipient, items, total, date, courier, fulfillment, postageRM, toPay, bakery, qr, trackUrl, trackingNo };
}

export function buildPaymentReminder(state, group, trackUrl) {
  const b = basics(state, group, trackUrl);
  if (!b || !b.recipient) return null;
  // Mirrors the confirmation's layout (greeting, then the order code on its own
  // line) so every WhatsApp message leads with the same scannable #CODE.
  let msg = `Hi ${b.first.customerName || ""}! A friendly reminder from ${b.bakery} about your order.\n`;
  msg += `Order #${orderCode(b.first)}\n`;
  msg += `Delivery: ${b.date} - ${b.fulfillment}\n`;
  msg += `Items: ${b.items}\n`;
  msg += `Total: ${b.total}\n`;
  if (b.postageRM) {
    msg += `Postage (nationwide): ${b.postageRM}\n`;
    msg += `To pay: ${b.toPay}\n`;
  }
  if (b.qr) {
    msg += `\nPay by TNG using the QR below:\n\n${b.qr}\n`;
    msg += `\nWhen you pay, put your phone number (${b.recipient}) in the payment description.\n`;
  } else {
    msg += `\nWhen you've paid by TNG, send the receipt screenshot here so we can confirm your order.\n`;
  }
  msg += `Already paid? Please ignore this message.\n`;
  msg += `Track your order: ${b.trackUrl}`;
  return { recipient: b.recipient, message: msg };
}

// "It's on its way" — sent when a post order goes out, carrying the tracking number
// she typed. Post orders only: a collect order is not posted, and its "ready" moment
// is the pickup reminder below. Without a number the line is left out rather than
// printed empty — the message still tells the customer their order has gone.
export function buildShippedMessage(state, group, trackUrl) {
  const b = basics(state, group, trackUrl);
  if (!b || !b.recipient) return null;
  let msg = `Hi ${b.first.customerName || ""}! Your order from ${b.bakery} is on its way.\n`;
  msg += `Order #${orderCode(b.first)}\n`;
  msg += `Delivery: ${b.date} - ${b.fulfillment}\n`;
  msg += `Items: ${b.items}\n`;
  if (b.trackingNo) msg += `Tracking number: ${b.trackingNo}\n`;
  msg += `\nTrack your order: ${b.trackUrl}`;
  return { recipient: b.recipient, message: msg };
}

export function buildPickupReminder(state, group, trackUrl) {
  const b = basics(state, group, trackUrl);
  if (!b || !b.recipient) return null;
  let msg = `Hi ${b.first.customerName || ""}! Good news from ${b.bakery} - your order is ready.\n`;
  msg += `Order #${orderCode(b.first)}\n`;
  msg += b.courier
    ? `Packed and will be posted to you on ${b.date}.\n`
    : `Packed and ready for collection on ${b.date}.\n`;
  msg += `\nTrack your order: ${b.trackUrl}`;
  return { recipient: b.recipient, message: msg };
}
