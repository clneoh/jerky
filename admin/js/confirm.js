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

import { byId, fmtRM, orderCode, waNumber } from "./state.js";
import { shortDate } from "./dates.js";

// Returns { recipient, message }, or null when the group has no orders.
// `trackUrl` is the storefront track link (with ?track=CODE) for the message.
export function buildConfirmation(state, group, trackUrl) {
  const orders = (group && group.orders) || [];
  const first = orders[0];
  if (!first) return null;

  const recipient = waNumber(first.whatsapp);
  const items = orders.map((o) => {
    const p = byId(state.products, o.productId);
    return `${p ? p.name : "item"} x${o.qty}`;
  }).join(", ");
  const subtotal = orders.reduce((s, o) => {
    const p = byId(state.products, o.productId);
    return s + (Number(o.qty) || 0) * (p ? Number(p.price) || 0 : 0);
  }, 0);
  const total = fmtRM(subtotal, state.settings.currency);

  const del = byId(state.deliveryDates, first.deliveryDateId);
  const date = del ? shortDate(del.date) : String(first.deliveryDate || "");
  const courier = first.fulfillment === "courier";
  const fulfillment = courier ? "Post (nationwide)" : "Collect (local)";
  const address = courier && String(first.address || "").trim()
    ? `\nAddress: ${String(first.address).trim()}` : "";

  const sf = (state.settings && state.settings.storefront) || {};
  const bakery = sf.name || "";
  const qr = String(sf.tngQr || "").trim();
  // Posted orders carry the flat nationwide postage fee on top of the items.
  const postage = courier ? Math.max(0, Number(sf.postageRM) || 0) : 0;
  const postageRM = postage > 0 ? fmtRM(postage, state.settings.currency) : "";
  const toPay = fmtRM(subtotal + postage, state.settings.currency);

  let msg = `Hi ${first.customerName || ""}! Your order from ${bakery} is confirmed.\n`;
  msg += `Order #${orderCode(first)}\n`;
  msg += `Delivery: ${date} - ${fulfillment}${address}\n`;
  msg += `Items: ${items}\n`;
  msg += `Total: ${total}\n`;
  if (postageRM) {
    msg += `Postage (nationwide): ${postageRM}\n`;
    msg += `To pay: ${toPay}\n`;
  }
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
