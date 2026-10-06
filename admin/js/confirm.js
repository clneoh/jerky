// confirm.js — the WhatsApp confirmation sent when the baker confirms an order.
// Pure (no DOM, no fetch) so it runs under Node for tests. Builds the message
// text and the wa.me recipient; the caller opens WhatsApp.
//
// The message leads with the order facts and shows the TNG payment QR (a
// hosted image URL that WhatsApp renders in the chat - it MUST be the first
// link in the message, or WhatsApp shows it as plain text). It then tells the
// customer to reply in THIS SAME CHAT with the receipt. Deliberately no
// tap-through "send receipt" deep link: opening one inside the chat makes
// WhatsApp jump away and the original message look truncated. Plain ASCII text
// only - emoji have come back as broken "empty boxes" on some phones. (The single
// asterisks around the Total are ASCII and deliberate: WhatsApp renders the pair as
// bold, and an unmatched one can only ever show as a literal asterisk.) The QR
// is skipped when the baker hasn't set one.

import { byId, orderCode, orderLineName, waNumber } from "./state.js";
import { shortDate } from "./dates.js";
import { customerTotal, moneyLines } from "./courier.js";
import { fulfillmentText, pointAddressFor } from "./points.js";
import { dayLine, vanLine } from "./courier_job.js";
// The one place the opening line is worded, so the confirmation cannot lean over
// while the three later messages do not (2 Oct 2026).
import { greeting } from "./messages.js";

// Returns { recipient, message }, or null when the group has no orders.
// `trackUrl` is the storefront track link (with ?track=CODE) for the message.
export function buildConfirmation(state, group, trackUrl) {
  const orders = (group && group.orders) || [];
  const first = orders[0];
  if (!first) return null;

  const recipient = waNumber(first.whatsapp);
  // The confirmation quotes what the customer is actually being charged: the
  // name and price each line was sold at, not today's menu.
  const items = orders.map((o) => {
    const name = orderLineName(state, o);
    return `${name === "(deleted product)" ? "item" : name} x${o.qty}`;
  }).join(", ");
  // The customer's total, in its parts, from the one place that decides what sending
  // costs them: a courier charge recorded on this order, or the flat nationwide postage
  // when there is none (they never both apply - a recorded charge replaces it). This is
  // the message that first asks them for money, so a delivery charge missing from here
  // is the figure they would pay against, and every later message would contradict it.
  //
  // A COD charge is deliberately NOT in this total: the courier collects it at the door,
  // so asking for it here as well would take the same RM8 twice.
  const parts = customerTotal(state, group);


  const del = byId(state.deliveryDates, first.deliveryDateId);
  // The day, and the promise that comes with it (v304): a collection at a Point carries the
  // place's own collection hours. A courier order has no window yet at this stage - the van is
  // booked later - so this changes nothing for one and the customer is told when to come.
  // ⚠️ `dayLine` DECIDES THE LABEL AND WHAT MAY GO ON THE LINE (v337) — a courier order is a
  // BAKE day and its window belongs to the van, so the two never share a line. See the helper
  // for the customer who asked whether his delivery was Wednesday or Thursday.
  const day = dayLine(state, first);
  const date = `${del ? shortDate(del.date) : String(first.deliveryDate || "")}`
    + day.window;
  const courier = first.fulfillment === "courier";
  // ONE wording for how the order reaches them (v299) — the confirmation and every later
  // message read the same helper, so a customer cannot be told two different things.
  const fulfillment = fulfillmentText(state, first);
  // The address means two different things and both are said: a COURIER order carries the
  // customer's own delivery address, while a collection at a Point needs the address of the
  // PLACE — which lives on her Point, not on the order.
  const deliveryAddr = courier ? String(first.address || "").trim() : "";
  const collectAddr = courier ? "" : pointAddressFor(state, first);
  const address = deliveryAddr ? `\nAddress: ${deliveryAddr}`
    : collectAddr ? `\nWhere: ${collectAddr}` : "";


  const sf = (state.settings && state.settings.storefront) || {};
  const bakery = sf.name || "";
  const qr = String(sf.tngQr || "").trim();

  let msg = `${greeting(state, `Hi ${first.customerName || ""}! Your order from ${bakery} is confirmed.`)}\n`;
  msg += `Order #${orderCode(first)}\n`;
  msg += `${day.label}: ${date} - ${fulfillment}${address}\n`;
  msg += `Items: ${items}\n`;
  // The sum and its parts: a recorded courier charge is named so the customer can add it
  // up themselves rather than take it on trust — "the message need to show the add up for
  // rm72" (19 Sep 2026). With no charge the flat postage is named instead (and is
  // deliberately never published to the shop's own page, so the card cannot repeat it).
  msg += `${moneyLines(state, parts).join("\n")}\n`;
  msg += `\nPay by TNG using the QR below:\n`;
  // A bare image URL on its own line is what makes WhatsApp render the QR as a
  // single scannable picture, and it must stay the FIRST link in the message
  // (WhatsApp pictures only the first link). No label line - a label would add
  // a second, unwanted tap target.
  if (qr) msg += `\n${qr}\n`;
  // Matching the payment to the order needs the customer's phone number as the
  // TNG payment description, plus the receipt screenshot sent back in THIS
  // chat. No tap-through link: staying in the chat keeps the order details in
  // front of the customer, so nothing ever jumps away or looks truncated.
  msg += `\nWhen you pay, put your phone number${recipient ? ` (${recipient})` : ""} in the payment description.\n`;
  msg += `Then send your TNG receipt screenshot here as a photo - thank you!\n`;
  msg += vanLine(day, first);
  msg += `Track your order: ${trackUrl}`;
  return { recipient, message: msg };
}
