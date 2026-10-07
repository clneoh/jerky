// receipts.js — the receipt's own serial number (v360).
//
// PURE, on purpose. It reads what is already stored against an order and says it in
// words. It never draws a number and never counts anything: **the serial lives in the
// database** (`supabase/receipts.sql`), because a run of receipt numbers is a SHARED
// counter and two phones keeping one on themselves would either collide or leave a gap
// — and a gap in a receipt sequence is the thing an auditor asks about.
//
// ★★ AND THE NUMBER BELONGS TO THE ORDER, NOT TO THE PRESS. It is claimed once, when the
// money is recorded, and every later read — printing the receipt, opening it on the other
// phone, pressing the button a second time — returns the same number and consumes
// nothing. That is what makes an accidental press harmless.
//
// WHY IT EXISTS AT ALL: above RM150,000 of gross takings in twelve months, receipts must
// be serially numbered (Income Tax Act 1967, s.82(1)(b)). An order's own code is unique
// but deliberately NOT sequential, so it can never be the series.

// How many digits a serial is written with. Six holds a million receipts and, more to
// the point, makes every number the same width — so a register reads as a column and
// `#000123` can never be mistaken for a shorter run in a different series.
const WIDTH = 6;

// The serial as it is written: padded, and never a made-up zero. An order with no number
// yet returns "" — the one honest answer, because printing `#000000` would be inventing
// a receipt that the books do not have.
export function receiptNoOf(order) {
  const n = Number(order && order.receiptNo);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.floor(n)).padStart(WIDTH, "0");
}

// "Receipt #000123" — the paper's own heading. Empty when the order has no number.
export function receiptLabel(order) {
  const n = receiptNoOf(order);
  return n ? `Receipt #${n}` : "";
}

// The line the paper carries, and the reason there are two numbers on it: the SERIAL
// proves the sequence is unbroken, and the ORDER CODE is what finds the order again.
// One without the other leaves the receipt either unprovable or unsearchable.
export function receiptLine(order, code) {
  const n = receiptNoOf(order);
  const c = String(code || "").trim();
  if (!n) return "";
  return c ? `Receipt #${n} · Order #${c}` : `Receipt #${n}`;
}

// A refund NEVER takes the number away. The receipt keeps it and is marked, because the
// money did move — a receipt that vanished would leave exactly the gap the sequence
// exists to prevent. ⚠️ ONE FIELD, `refundedAt`, and it lives on the ORDER: the money going
// back is a fact about the sale, and the receipt's mark is the same fact recorded in the
// register. Two fields would be two things to keep in step.
export function isRefunded(order) {
  return !!(order && order.refundedAt);
}

// What the paper says about the number, in every state it can be in — including the two
// that are not a number, which must say WHY rather than print nothing.
export function receiptStatus(order) {
  if (!order) return "";
  if (isRefunded(order)) return `${receiptLabel(order)} — refunded`;
  const n = receiptNoOf(order);
  if (n) return receiptLabel(order);
  // ⚠️ NO NUMBER IS NOT AN ERROR, AND NOT A BLANK. There are two honest reasons for it
  // and they read differently, so neither is guessed at.
  return order.paidReceived
    ? "No receipt number yet — this order has not reached the bakery's records. Open this again once the phone is back online."
    : "No receipt number yet — a receipt number is issued when the money is recorded as received.";
}
