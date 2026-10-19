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
// ★ THE INVOICE NUMBER IS THE REGISTER'S SERIAL once the money is recorded, and the
// order's own code until then (v577 — ⚠️ the consolidated page numbered by the serial
// while this document numbered by the code, so ONE SALE CARRIED TWO INVOICE NUMBERS).
// The code is still what an unnumbered order is called, and why that avoids a counter
// shared between two phones is worth saying:
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
import { orderDateOf } from "./customers.js";
import { fmtRM } from "./state.js";
import { receiptNoOfGroup } from "./receipts.js";
import { orderCode, orderLineName, orderLinePrice, round2 } from "./state.js";
import { longDate } from "./dates.js";
import { refundDayOf } from "./money.js";

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
// ★★★ ONE SALE, ONE INVOICE NUMBER (v577). ⚠️⚠️ The consolidated filing page calls the RECEIPT SERIAL the
// invoice number (her own ask in v376: "a column for order no. and a column for invoice no"), while this
// document numbered itself by the ORDER CODE — ⭐ **so one sale carried two invoice numbers on two papers.**
// ⭐ The serial is the legal number and it wins when the register has one; an order with none yet is numbered
// by its code, which is what the receipt line already says beneath the title.
export function invoiceNo(group) {
  const first = (group && group.orders && group.orders[0]) || null;
  if (!first) return "";
  const serial = receiptNoOfGroup((group && group.orders) || []);
  return serial ? String(serial) : orderCode(first);
}

// One order, as an invoice sheet. Everything the paper says, and nothing it does not.
//
// `from` is her mailing address, read from settings by the caller (this module holds
// no settings of its own, so it stays pure and testable).
export function invoiceSheet(state, group, { from = "", bakery = "", printed = "", receipt = "", receiptStatus = "" } = {}) {
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
  // ⚠️⚠️ AND A CASH-ON-DELIVERY CHARGE, WHICH THE INVOICE NEVER MENTIONED (v572). ⭐ `customerTotal` nets a COD
  // charge OUT of `courier`, so the line above does not exist for it — while the message and the on-screen
  // receipt both say "Courier charge RM 8.00 — COD". ⚠️ **The paper said Total RM16 and the customer handed the
  // driver RM24.** ⭐ It is a note, not a line: it is not part of what this invoice's Total adds up to, and a
  // line would make the sheet's own arithmetic wrong.
  const cur = (state.settings && state.settings.currency) || "RM";
  const codNote = (Number(t.cod) || 0) > 0
    ? `Courier charge ${fmtRM(t.cod, cur)} is paid to the driver on delivery (cash on delivery).`
    : "";

  // ⚠️⚠️ A REFUNDED SALE'S INVOICE NEVER SAID SO (v577). ⭐ The caller always passes a serial, so
  // `receiptNote` — the only place the refund wording could appear — was blank, and the paper read exactly
  // like an unrefunded one. ⭐ **The Total stays the sale's own Total**: the invoice states what was sold and
  // owed; money going back is a LATER event and belongs in a sentence with its own date, never subtracted
  // from a total the lines above it do not add up to. Scanned across every row of the group, because the
  // stamp is written to all of them and a slice may start anywhere (the v445 lesson).
  const refunded = rows.find((o) => o && o.refundedAt) || null;
  const moved = refunded ? round2(Number(refunded.refundAmountRM) || 0) : 0;
  // ⚠️⚠️ HER DAY, NOT UTC (v587). ⚠️ Slicing the timestamp printed the previous date for a refund given after
  // midnight in Penang — ⚠️ **the invoice said 3 Oct while Profit and the Cash journal said 4 Oct.** ⭐ The one
  // helper the books use reads it in her clock.
  const refundDay = refunded ? refundDayOf({ orders: [refunded] }, state) : "";
  const when = refunded && /^\d{4}-\d{2}-\d{2}$/.test(refundDay) ? ` on ${longDate(refundDay)}` : "";
  const refundNote = refunded
    ? (moved > 0
      ? `${refunded.refundedFull ? "Refunded in full" : "Refunded"}: ${fmtRM(moved, cur)} returned${when}.`
      : `The money on this order was refunded${when}.`)
    : "";
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
    // ★ THE REGISTER'S SERIAL when the sale has one, the order's own code until then (v577) — the same
    // number the consolidated filing page's Invoice column shows, so one sale cannot be quoted two ways.
    title: `Invoice #${invoiceNo(group)}`,
    // ★ THE RECEIPT'S OWN SERIAL, BESIDE THE ORDER'S CODE (v360). **Both are needed and
    // neither replaces the other:** the serial is what proves the receipt sequence has no
    // gaps, and the order code is what finds the order again. Empty on an order with no
    // number yet — and then `receiptNote` says WHY rather than leaving a blank where a
    // number belongs, which is the fault this app treats as a bug everywhere else.
    receipt,
    receiptNote: receipt ? "" : receiptStatus,
    // ⚠️⚠️ THE PLACED DAY, READ THE ONE WAY THE APP READS IT (v572). ⭐ This passed the RAW value to
    // `longDate`, and an order with no `orderDate` fell through to a full ISO timestamp — ⭐ **which prints
    // "NaN undefined NaN"** (measured). `orderDateOf` takes the date it has, in her clock, and answers "" when
    // there is none, so the line is either a real day or absent.
    // ⚠️⚠️ AND AN ORDER WITH NO DATE PRINTS NO DATE (v592). ⚠️ `longDate("")` is **"NaN undefined NaN"**
    // (measured) — the comment above claimed `orderDateOf` answered "", and it does, but the CALL was still
    // made: ⚠️ **an imported or hand-edited row with no order date printed that under the title**, while the
    // screen showed nothing. ⭐ The line is either a real day or absent.
    subtitle: orderDateOf(first) ? longDate(orderDateOf(first)) : "",
    // ⚠️⚠️ AND WHO IT IS FOR, ON PAPER (v572). ⭐ The screen said "Aunty Bee · placed …" and the sheet said
    // nothing, so a printed invoice could only be matched to an order by its code. The address rides with it
    // for a courier order, because that is the document that goes in the parcel.
    to: [String(first.customerName || "").trim(),
      first.fulfillment === "courier" ? String(first.address || "").trim() : ""]
      .filter(Boolean).join(" · "),
    bakery,
    from,
    printed,
    note: [codNote, refundNote].filter(Boolean).join("\n\n"),
    lines,
    // ⚠️⚠️ THE TOTAL IS WHAT THE LINES ABOVE IT ADD UP TO (v551). ⭐ MEASURED: two lines at RM0.005 each
    // printed as "RM 0.01" and "RM 0.01" — a reader's sum of **RM0.02** — under **Total RM0.01**, because
    // each line was rounded for printing while the Total was worked out on the unrounded figures.
    // ⭐ An invoice whose lines do not add up to its own Total is not an invoice (this file's own rule
    // above the coupon line). ⚠️ It only shows with a sub-cent price — and a price she typed is a price
    // the document has to honour.
    totals: [{ label: "Total",
      amount: round2(lines.reduce((s, l) => s + (l.dir === "out" ? -l.amount : l.amount), 0)) }],
    empty: "No items on this order.",
  };
}

// The currency an invoice is written in, so a caller never reaches into settings twice.
export function invoiceCurrency(state) {
  return (state && state.settings && state.settings.currency) || "RM";
}
