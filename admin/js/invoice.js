// invoice.js — one order, one invoice (4 Oct 2026).
//
// Her words: "And customer need an invoice". Asked what it should carry she chose
// __"One order, one invoice"__ and __"Yes — name, address, a number"__ — and then, the
// day it shipped, the better answer to the number: __"for the invoice, i think we can
// use the order code as invoice number"__.
//
// There is very little new machinery here, and that is the point. An invoice IS a
// sheet (journal.js), so Print, Share and the PDF into WhatsApp come for free and the
// screen, the paper and the PDF cannot disagree about a row or a total. Every figure is
// read from `customerTotal`, the ONE order-money function the confirmation message, the
// tracking card and the order rows already read — so an invoice can never state a sum
// those three contradict. Every item name and price comes from the FROZEN
// `orderLineName` / `orderLinePrice`, so an invoice for an old order never shows a
// renamed product or today's price.
//
// THE LETTERHEAD IS HER REAL ADDRESS, and it already exists: `settings.mailingAddress`
// is the FROM block she typed once for the mailing labels, synced to both phones.
// There is no address on the storefront and there cannot be — `cleanStorefront`
// whitelists the settings keys and would drop one added there.
//
// ★ THE INVOICE NUMBER IS THE ORDER'S OWN CODE, and it is worth saying why that is
// better than a running number rather than merely simpler:
//
//   · The order code is unique BY CONSTRUCTION — the last six hex of the order's own id
//     (`orderCode`, state.js). Two invoices cannot collide the way a counter shared by
//     two phones could: settings sync as ONE record under last-write-wins, so a running
//     number kept there would be overwritten by whichever phone saved last and would
//     repeat or skip without warning.
//   · NOTHING IS WRITTEN when an invoice is made. The first draft of this file stamped a
//     running number onto the order on first use, and had to explain the one case where
//     two phones could take the same one. With the code there is no number to assign, so
//     there is no write and no caveat — pressing Invoice touches nothing at all.
//   · It is already the identifier every other part of the app uses for this order: the
//     row's own tag, the confirmation, the payment reminder, the tracking card. So an
//     invoice, a message and a row can never quote two different references for one order.
//
// THE TRADE-OFF, SAID RATHER THAN HIDDEN: the code is not sequential. Nothing on an
// invoice says how many you have issued, or which of two invoices came first — and two
// different orders could in principle draw the same six characters, which is the same
// risk the order tag has carried everywhere since the shop was built.
//
// Pure module: no DOM, no storage. Runs under Node for tests.

import { customerTotal } from "./courier.js";
import { orderCode, orderLineName, orderLinePrice, round2 } from "./state.js";
import { longDate } from "./dates.js";

// What one line of the order is called on paper. The quantity comes first because
// that is how a customer reads a receipt back — "4 × Focaccia" — and the name is the
// FROZEN one, so a product renamed since does not rewrite an old invoice.
export function invoiceLineName(state, o) {
  const qty = Number(o && o.qty) || 0;
  return `${qty} × ${orderLineName(state, o)}`;
}

// What one line was worth, at the price it was SOLD at. A line with no price at all
// counts as nothing rather than as a crash — the same reading `basketItems` takes.
export function invoiceLineAmount(state, o) {
  const price = orderLinePrice(state, o);
  return round2((Number(o && o.qty) || 0) * (price == null ? 0 : price));
}

// The number this order's invoice carries, and the only one it can ever carry. Read
// straight off the order, exactly as the order row's own tag reads it and as the
// confirmation message reads it — one identifier for one order, in one place.
export function invoiceNo(group) {
  const first = (group && group.orders && group.orders[0]) || null;
  return first ? orderCode(first) : "";
}

// One order, as an invoice sheet. Everything the paper says, and nothing it does not.
//
// `from` is her mailing address, read from settings by the caller (this module holds
// no settings of its own, so it stays pure and testable).
export function invoiceSheet(state, group, { from = "", bakery = "", printed = "" } = {}) {
  const rows = (group && group.orders) || [];
  const first = rows[0] || {};
  const t = customerTotal(state, group);

  const lines = rows.map((o) => ({
    what: invoiceLineName(state, o),
    amount: invoiceLineAmount(state, o),
  }));
  // The courier charge, when the CUSTOMER bears it. `customerTotal` already nets a
  // cash-on-delivery charge out of `courier`, so this is the same figure the
  // confirmation message states and never a second reading of the fee.
  if (t.courier > 0) lines.push({ what: "Courier", amount: t.courier });
  // The code, taken off. Drawn with `dir: "out"` because that is what prints the
  // minus in front of the figure on all four renderings — the sheet has one way of
  // saying "this much came off", and this is it.
  if (t.promo > 0) lines.push({ what: `Code ${t.promoCode}`, amount: t.promo, dir: "out" });
  // ★ AND THE FRIEND'S FIRST-ORDER DISCOUNT, THE SAME WAY (v330). It comes off the Total,
  // so it belongs above it — she asked me to check "probably other place?", and this was
  // the other place. An invoice whose lines do not add up to its own total is not an
  // invoice; the same rule `receiptRows` states, and the same fault when it is broken.
  if (t.coupon > 0) lines.push({ what: t.couponRole === "reward" ? "Bring-a-friend reward" : "Bring-a-friend discount", amount: t.coupon, dir: "out" });

  return {
    // The order's own code IS the invoice number, so the title and the order's tag
    // every other screen shows are the same characters.
    title: `Invoice #${invoiceNo(group)}`,
    // The day the order was PLACED, not today — a reprint is the same invoice and
    // must carry the same date as the first one.
    subtitle: longDate(first.orderDate || first.createdAt),
    bakery,
    from,
    printed,
    lines,
    totals: [{ label: "Total", amount: t.total }],
    empty: "No items on this order.",
  };
}

// The currency an invoice is written in, so a caller never reaches into settings twice.
export function invoiceCurrency(state) {
  return (state && state.settings && state.settings.currency) || "RM";
}
