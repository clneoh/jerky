// messages.js — the WhatsApp messages the baker sends from later stages of the
// journey: the payment reminder (while an order is waiting on Paid), the pickup
// reminder (when an order is packed) and the posted message (when a post order
// goes out, carrying its tracking number). Pure (no DOM, no fetch) so they run
// under Node for tests. Like the confirmation, every message leads with the
// order code so the customer can always match it back to their order, and stays
// plain ASCII - emoji have come back as broken boxes on some phones.

import { byId, orderCode, orderLineName, waNumber } from "./state.js";
import { shortDate } from "./dates.js";
import { customerTotal, moneyLines } from "./courier.js";
import { trackingLine, windowSuffix } from "./courier_job.js";

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
  // The customer's total, in its parts, from the one place that decides what sending
  // costs them: a courier charge recorded on this order, or the flat nationwide postage
  // when there is none (a recorded charge replaces it - they never both apply). Shared
  // with the confirmation and the track card, so the three cannot quote different
  // figures. A COD charge is deliberately NOT in this total: the courier takes it at
  // the door, so it is named on its own line and never inside the sum.
  const parts = customerTotal(state, group);

  const del = byId(state.deliveryDates, first.deliveryDateId);
  // The day, and the window the van will come in when the order is on a consolidated run
  // (v191). Every message below quotes THIS one string, so the window appears in the
  // payment reminder, the shipped message and the pickup message at once and none of them
  // can word the promise differently from the others. windowSuffix is the publishing gate
  // and answers "" for a window that could not be typed, so a half-filled promise cannot
  // be sent to a customer.
  const date = `${del ? shortDate(del.date) : String(first.deliveryDate || "")}${windowSuffix(first)}`;
  const courier = first.fulfillment === "courier";
  const fulfillment = courier ? "Post (nationwide)" : "Collect (local)";
  const sf = (state.settings && state.settings.storefront) || {};
  const bakery = sf.name || "";
  const qr = String(sf.tngQr || "").trim();
  // The courier's tracking number she typed on the order. Kept as typed (a
  // pasted number may carry spaces or dashes) — it goes to the customer verbatim.
  const trackingNo = String(first.trackingNo || "").trim();
  // The money block — the delivery line and the sum the customer is asked for — built by
  // the one helper the confirmation uses too, so no two messages can word it
  // differently. Shared with the correction card and the payment reminder, so they
  // cannot quote different figures. A COD charge is deliberately outside the sum: the
  // courier takes it at the door, so it is named on its own line and never inside "To pay".
  const money = moneyLines(state, parts);
  // Did YOU record a charge on this order, rather than the flat postage applying by
  // itself? Only the posted message needs to know: it is read at the door, so a COD
  // charge must be named there, while the flat postage is money the customer was already
  // told about and has very likely paid — restating it risks reading as still-owed.
  const charged = parts.courier > 0 || parts.cod > 0;
  const chargeLines = charged ? money.slice(1) : [];
  return { first, recipient, items, date, courier, fulfillment, bakery, qr, trackUrl, trackingNo, money, charged, chargeLines };
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
  // Shown as its parts as well as the sum: the customer is being asked for money, and a
  // figure that is RM8 more than the items they chose has to say so — and show them the
  // RM8 (19 Sep 2026). A COD charge is named here too, but outside the total below.
  msg += `${b.money.join("\n")}\n`;
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
  // One slot, two kinds of thing. A number she typed reads "Tracking number"; the
  // share link a booked trip came back with reads "Track your delivery", because it
  // is a page the customer opens rather than digits they read out (v189).
  const track = trackingLine(b.trackingNo);
  if (track) msg += `${track}\n`;
  // A charge YOU recorded is named here — the same lines the customer's track card
  // shows them, and the one place a COD parcel says the courier will ask for money at
  // the door. The block is self-contained ("Courier charge: RM8" then "To pay: RM30"),
  // so it needs no total line of its own: this message has never carried one, because
  // the customer was told the figure in the confirmation and the reminder.
  //
  // The flat postage is NOT restated here: unlike a charge you typed, it applies to every
  // posted order by itself, the customer was told it when they were asked to pay, and by
  // this stage they have very likely paid it — repeating it risks reading as still-owed.
  if (b.chargeLines.length) msg += `${b.chargeLines.join("\n")}\n`;
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
