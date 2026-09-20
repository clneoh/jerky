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
// only - emoji have come back as broken "empty boxes" on some phones. The QR
// is skipped when the baker hasn't set one.

import { byId, fmtRM, orderCode, orderLineName, waNumber } from "./state.js";
import { shortDate } from "./dates.js";
import { customerTotal, courierAddUp } from "./courier.js";

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
  const cur = state.settings.currency;
  // This app's own shape, kept: the items figure is printed as "Total", then the delivery
  // line, then "To pay" - the sum actually being asked for.
  const total = fmtRM(parts.items, cur);

  const del = byId(state.deliveryDates, first.deliveryDateId);
  const date = del ? shortDate(del.date) : String(first.deliveryDate || "");
  const courier = first.fulfillment === "courier";
  const fulfillment = courier ? "Post (nationwide)" : "Collect (local)";
  const address = courier && String(first.address || "").trim()
    ? `\nAddress: ${String(first.address).trim()}` : "";

  const sf = (state.settings && state.settings.storefront) || {};
  const bakery = sf.name || "";
  const qr = String(sf.tngQr || "").trim();

  let msg = `Hi ${first.customerName || ""}! Your order from ${bakery} is confirmed.\n`;
  msg += `Order #${orderCode(first)}\n`;
  msg += `Delivery: ${date} - ${fulfillment}${address}\n`;
  msg += `Items: ${items}\n`;
  // No charge of any kind - a collect order, or one whose postage you absorbed - and
  // these two lines are absent, so that message is word for word what it always was.
  msg += `Total: ${total}\n`;
  const addUp = courierAddUp(state, parts);
  if (addUp.length) msg += `${addUp.join("\n")}\n`;
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
  msg += `Track your order: ${trackUrl}`;
  return { recipient, message: msg };
}
