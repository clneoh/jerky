// receipts.js — the receipt's own serial number (v360).
//
// PURE, on purpose. It reads what is already stored against an order and says it in
// words. It never draws a number and never counts anything: **the serial lives in the
// database** (`supabase/receipts.sql`), because a run of receipt numbers is a SHARED
// counter and two phones keeping one on themselves would either collide or leave a gap
// — and a gap in a receipt sequence is the thing an auditor asks about.
//
// ★★ v366 adds `registerRows`, which is the same discipline applied to the whole series:
// it READS the register and says what shape it is in. It still draws nothing.
//

import { fmtRM, orderCode } from "./state.js";

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
export function receiptStatus(order, cur = "RM") {
  if (!order) return "";
  // ★ AND HOW MUCH WENT BACK (v370). A refund is a PART of an order now, so a bare "— refunded"
  // would leave her unable to tell RM5 back from the whole receipt.
  if (isRefunded(order)) {
    const n = Number(order.refundAmountRM);
    return Number.isFinite(n) && n > 0
      ? `${receiptLabel(order)} — ${fmtRM(n, cur)} refunded`
      : `${receiptLabel(order)} — refunded`;
  }
  const n = receiptNoOf(order);
  if (n) return receiptLabel(order);
  // ⚠️ NO NUMBER IS NOT AN ERROR, AND NOT A BLANK. There are two honest reasons for it
  // and they read differently, so neither is guessed at.
  //
  // ★★ AND THE PAID LINE BLAMES THE NUMBER, NEVER THE ORDER (v365). It used to read "this
  // order has not reached the bakery's records", which was wrong twice over: the order is
  // right here on the screen, and the case it was written for — a receipt drawn before this
  // feature existed — has nothing to do with the records at all. What has not happened is
  // the DRAWING of a number, and that is what it now says. It is reached only when a claim
  // was just attempted and failed, so the advice it gives is the one that works: try again.
  return order.paidReceived
    ? "No receipt number yet — the number could not be drawn from your receipt register. Open this invoice again once the phone is back online."
    : "No receipt number yet — a receipt number is issued when the money is recorded as received.";
}

// ── ★★ THE REGISTER ITSELF (v366) ────────────────────────────────────────────
//
// WHY THIS EXISTS. Above RM150,000 of gross takings a business must issue SERIALLY
// numbered receipts, and what an auditor asks to see is not one receipt — it is **the run**:
// every number, in order, with nothing missing and nothing used twice. Until v366 the app
// issued the numbers and offered her no way to look at them. She asked for it the day after
// she removed a paid order and watched #000001 stay spent.
//
// ★ THE TWO THINGS ONLY THIS SCREEN CAN SEE, and neither can be worked out from one order:
//
// 1. **A GAP.** `claim_receipt_number` draws with `nextval` before it knows whether the row
//    will land, so the one race it documents can consume a value that is then never used.
//    That is a missing receipt in the run — exactly the thing the whole series exists to
//    prevent — and it is invisible from every other screen. v366 also closes the race (see
//    the advisory lock in `supabase/receipts.sql`); this reports what remains.
//
// 2. **A VOID RECEIPT.** A number whose order is no longer in her data: the receipt was
//    issued, the money moved, and the order has since been removed. It must be VISIBLE and
//    it must never be re-used — which is what she found by removing a paid order.
//
// ⚠️ AND THE VOID TEST IS DELIBERATELY WORDED AS "NOT ON THIS PHONE". The register table is
// the shared truth; her orders are only what this device holds. Calling a number "void" when
// the phone simply has not synced yet would invent a hole that does not exist — so the row
// says what was actually observed.
export function registerRows(raw, orders) {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((r) => r && Number(r.number) > 0)
    .map((r) => ({
      number: Math.floor(Number(r.number)),
      no: String(Math.floor(Number(r.number))).padStart(WIDTH, "0"),
      code: String(r.order_code || "").trim().toUpperCase(),
      issuedAt: String(r.issued_at || ""),
      refundedAt: String(r.refunded_at || ""),
      // ★ HOW MUCH WENT BACK (v370). Read from the REGISTER, not from her orders, so it is known
      // even for a receipt whose order is no longer on this phone — which is the case the register
      // exists for. A row written before v370 has no amount, and 0 reads as "no amount recorded".
      refundedAmount: Number(r.refunded_amount) > 0 ? Number(r.refunded_amount) : 0,
    }))
    .sort((a, b) => a.number - b.number);

  // The codes this phone can actually match. A lookup, not a count.
  const here = new Map();
  for (const o of (Array.isArray(orders) ? orders : [])) {
    const c = orderCode(o);
    if (c && c !== "??????" && !here.has(c)) here.set(c, o);
  }

  const rows = list.map((r) => ({
    ...r,
    order: here.get(r.code) || null,
    orphan: !here.has(r.code),
  }));

  // ★ A GAP IS ANY WHOLE NUMBER THE RUN NEVER USED — including at the head, because the
  // sequence starts at 1 and a first row of #000004 means three receipts are unaccounted
  // for. Both ends are checked; a missing TAIL cannot be detected from a register at all
  // (nothing records a number that was never drawn), which is why the count is reported as
  // a range rather than as a total.
  const gaps = [];
  const first = list.length ? list[0].number : 0;
  for (let n = 1; n < first; n += 1) gaps.push(n);
  for (let i = 1; i < list.length; i += 1) {
    for (let n = list[i - 1].number + 1; n < list[i].number; n += 1) gaps.push(n);
  }

  return {
    rows,
    count: list.length,
    first,
    last: list.length ? list[list.length - 1].number : 0,
    gaps,
    // ⚠️ NAMED FOR WHAT WAS SEEN, NOT FOR WHAT IT MEANS. See the note above.
    notOnThisPhone: rows.filter((r) => r.orphan).length,
    refunded: rows.filter((r) => r.refundedAt).length,
  };
}

// The register's headline, in one sentence, with the two things worth acting on first.
export function registerSummary(reg) {
  if (!reg || !reg.count) return "No receipt has been issued yet.";
  const span = `Receipts #${String(reg.first).padStart(WIDTH, "0")} to #${String(reg.last).padStart(WIDTH, "0")} — ${reg.count} issued.`;
  const bits = [];
  bits.push(reg.gaps.length
    ? `${reg.gaps.length} number${reg.gaps.length === 1 ? " is" : "s are"} MISSING from the run (${reg.gaps.map((n) => `#${String(n).padStart(WIDTH, "0")}`).join(", ")}).`
    : "The run is unbroken — every number from the first is accounted for.");
  if (reg.notOnThisPhone) {
    bits.push(`${reg.notOnThisPhone} ${reg.notOnThisPhone === 1 ? "is for an order" : "are for orders"} no longer on this phone — the receipt stands and the number is never re-used.`);
  }
  if (reg.refunded) {
    bits.push(`${reg.refunded} marked refunded.`);
  }
  return `${span} ${bits.join(" ")}`;
}
