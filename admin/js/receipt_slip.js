// admin/js/receipt_slip.js — the small customer receipt for the 100 × 150 mm label printer.
//
// ⭐ WHY IT IS NOT THE INVOICE. ⚠️ An invoice is an A4 page of many lines; the GP-1326D is 104 mm wide, so
// sending the invoice to it clips the columns or shrinks the text to a smear. ⭐ This is a designed sticker:
// who, what, how much, how it was paid — the piece a customer takes away at a collection.
//
// ⚠️ The money comes from `customerTotal`, the SAME reader the confirmation, the invoice and the tracking card
// use — so the slip cannot disagree with the paper she already sent.

import { customerTotal } from "./courier.js";
import { methodLabel } from "./accounts.js";
import { orderDay } from "./profit.js";
import { receiptNoOfGroup } from "./receipts.js";
import { longDate } from "./dates.js";
import { fmtRM, orderCode, orderLineName, orderLinePrice, round2 } from "./state.js";

// The whole sale, not the day's slice — the same family rule the invoice uses.
function familyOf(state, rows) {
  const first = rows[0] || null;
  const gid = first && first.groupId;
  if (!gid) return rows;
  const rest = (state.orders || []).filter((o) => o && o.groupId === gid && !rows.includes(o));
  return rest.length ? rows.concat(rest) : rows;
}

// Rows in the label printer's own vocabulary: `brand`/`code`/`customer` are centred and bold,
// `mail-line` is the left-aligned body. ⭐ A class the label layout does not know would silently take the
// default size, so this list uses only classes `label_pdf.js` defines.
export function receiptSlipRows(state, group) {
  const rows = (group && group.orders) || [];
  const first = rows[0];
  if (!first) return [];
  const family = familyOf(state, rows);
  const t = customerTotal(state, { orders: family });
  const bakery = String((state.settings && state.settings.storefront
    && state.settings.storefront.name) || "Jienluv2bake").trim();
  const day = orderDay(state, first);
  const out = [
    ["brand", bakery],
    ["meta", "RECEIPT"],
    ["code", `#${orderCode(first)}`],
  ];
  if (day) out.push(["date", longDate(day)]);
  const name = String(first.customerName || "").trim();
  if (name) out.push(["customer", name]);

  for (const o of family) {
    const qty = Number(o.qty) || 0;
    const price = orderLinePrice(state, o);
    const amount = price == null ? "" : fmtRM(round2(price * qty));
    out.push(["mail-line", `${orderLineName(state, o)} x${qty}${amount ? `   ${amount}` : ""}`]);
  }
  if (t.promo > 0) {
    out.push(["mail-line", `${String(t.promoCode || "Code").trim()} discount   -${fmtRM(t.promo)}`]);
  }
  if (t.coupon > 0) out.push(["mail-line", `Discount   -${fmtRM(t.coupon)}`]);
  if (t.courier > 0) out.push(["mail-line", `Delivery   ${fmtRM(t.courier)}`]);

  out.push(["customer", `TOTAL   ${fmtRM(t.total)}`]);
  out.push(["mail-line", first.paidReceived
    ? `Paid - ${methodLabel(first.paidMethod) || "received"}`
    : "Not yet paid"]);
  const no = receiptNoOfGroup(family);
  out.push(["mail-line", no ? `Receipt #${no}` : "No receipt number"]);
  out.push(["mail-line", "Thank you"]);
  return out;
}
