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

import { fmtRM, codeFromId, orderCode } from "./state.js";

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

// ★★ THE NUMBER BELONGS TO THE ORDER, NOT TO ONE OF ITS ROWS (v445).
//
// ⚠️⚠️ HER CONSOLIDATED INVOICE SHOWED THE FAULT. Two screens read the same order and disagreed: the
// RECEIPT REGISTER said `#000003` was issued for **Mr Tan Eng Boo · Order #F447EE**, and the INVOICE
// column for that same order read **"none yet"**. ⭐ The register reads the shared cloud by ORDER CODE;
// the invoice reads `receiptNo`, **a fact stamped onto a ROW** — and it was reading the group's FIRST row.
//
// ⭐ THE STAMP IS COPIED TO EVERY ROW OF THE SALE when it is issued, so the number is not lost — **it is
// read from the wrong place.** A group whose rows sit on more than one bake day, or whose first row has
// changed since the money was recorded, hands the invoice a row that never carried it. ⭐ **The same fault
// in a new place as v432 (`familyOfOrder`) and v441 (the order code): a fact about the ORDER, held by a
// ROW.** So it is read the same way — from whichever row of the order knows it.
export function receiptNoOfGroup(orders) {
  const list = Array.isArray(orders) ? orders : (orders ? [orders] : []);
  for (const o of list) {
    const n = receiptNoOf(o);
    if (n) return n;
  }
  return "";
}

// ★★ THE LINE AND THE STATUS, READ FROM THE WHOLE SALE (v577). ⭐ The invoice numbered itself from a
// serial found on ANY row (`receiptNoOfGroup`) while its receipt line and its status were built from the
// FIRST row alone — ⚠️ **so a numbered sale whose first row carried no stamp printed "Invoice #000007"
// above "No receipt number yet"**, and a refund stamped on a later row was never mentioned at all.
export function receiptLineOfGroup(orders, code) {
  const serial = receiptNoOfGroup(orders);
  if (!serial) return "";
  const c = String(code || "").trim();
  return c ? `Receipt #${serial} · Order #${c}` : `Receipt #${serial}`;
}

export function receiptStatusOfGroup(orders, cur = "RM") {
  const list = Array.isArray(orders) ? orders : (orders ? [orders] : []);
  // ⭐ The row that KNOWS something, in the order the paper needs it: a refund, then a number, then any.
  const row = list.find((o) => o && o.refundedAt)
    || list.find((o) => o && receiptNoOf(o))
    || list[0] || null;
  if (!row) return "";
  return receiptStatus(row, cur, receiptNoOfGroup(list));
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
export function receiptStatus(order, cur = "RM", serial = receiptNoOf(order)) {
  if (!order) return "";
  // ⚠️⚠️ THE NUMBER IS PASSED IN WHEN THE CALLER KNOWS IT FROM ANY ROW OF THE SALE (v577) — the same
  // rule `receiptNoOfGroup` already follows, and for the same measured reason: a group handed over as a
  // slice may start at a row that never carried the stamp.
  const label = serial ? `Receipt #${serial}` : "";
  // ★ AND HOW MUCH WENT BACK (v370). A refund is a PART of an order now, so a bare "— refunded"
  // would leave her unable to tell RM5 back from the whole receipt.
  if (isRefunded(order)) {
    const n = Number(order.refundAmountRM);
    const back = Number.isFinite(n) && n > 0 ? `${fmtRM(n, cur)} refunded` : "refunded";
    return label ? `${label} — ${back}` : (Number.isFinite(n) && n > 0 ? `${fmtRM(n, cur)} refunded` : "Refunded");
  }
  if (serial) return label;
  // ⚠️ NO NUMBER IS NOT AN ERROR, AND NOT A BLANK. There are two honest reasons for it
  // and they read differently, so neither is guessed at.
  //
  // ★★ AND THE PAID LINE BLAMES THE NUMBER, NEVER THE ORDER (v365). It used to read "this
  // order has not reached the bakery's records", which was wrong twice over: the order is
  // right here on the screen, and the case it was written for — a receipt drawn before this
  // feature existed — has nothing to do with the records at all. What has not happened is
  // the DRAWING of a number, and that is what it now says. It is reached only when a claim
  // was just attempted and failed, so the advice it gives is the one that works: try again.
  // ⚠️⚠️ THIS LINE IS PRINTED ON THE CUSTOMER'S INVOICE (v598). ⚠️ It used to instruct the READER to reopen
  // the app on a phone they are not holding — ⚠️ **an instruction to her, printed for a customer.** ⭐ The
  // document says the fact; the retrying belongs to the screen that can do it.
  return order.paidReceived
    ? "No receipt number yet — the number could not be drawn from your receipt register."    : "No receipt number yet — a receipt number is issued when the money is recorded as received.";
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
// ★★ A RECEIPT SHE HAS DECLARED VOID (v448).
//
// ⚠️⚠️ HER QUESTION: __"can you have me to clear the invoice, or rearrange it, ok for me in this software
// trial stage"__ — and the answer is **mark, never delete.** ⭐ A register you can edit is not a register;
// that is the one guarantee this screen makes, and it exists because of the day she removed a paid order
// and watched `#000001` stay spent. **A number is never given back and never re-used.**
//
// ⭐ SO WHAT SHE CAN HAVE IS THE HONEST FORM OF "CLEAR": a row marked VOID, with HER reason on it. The run
// stays whole, an auditor reads exactly what happened, and the row stops looking like an unexplained hole.
// ⚠️ AND IT IS A DECISION, SO IT IS REVERSIBLE — an annotation she can take back, not a fact she cannot.
//
// ⚠️ KEYED ON THE NUMBER, NOT THE CODE. Numbers are unique by construction (the table's own constraint);
// a six-hex code collides about once in 16M, which is why the register matches on both and this does not.
export function voidedIndex(voided) {
  const map = new Map();
  for (const v of (Array.isArray(voided) ? voided : [])) {
    const n = Math.floor(Number(v && v.no));
    if (Number.isFinite(n) && n > 0) map.set(n, v);
  }
  return map;
}

export function registerRows(raw, orders, voided) {
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
  //
  // ⚠️⚠️ AND IT MATCHES THE CODE THE RECEIPT WAS WRITTEN WITH, NOT ONLY THE CODE THE ORDER WEARS
  // TODAY (v441). Until v441 an order's code was re-derived every time it was read, so adding a
  // second item to a one-item order MOVED it — and the receipt already in this register kept the old
  // one. Every such row has read "not in this phone's orders" ever since, **about an order that is
  // still here**, which is the worst thing this screen can say. ⭐ The id-only code is therefore
  // accepted as an alias.
  //
  // ⚠️ TWO PASSES, AND THE ORDER MATTERS. Every CURRENT code is claimed first, so an alias can never
  // displace a code some other order genuinely wears today — it only fills a gap nothing else claims.
  // A 6-hex code collides about once in 16M (see `orderCode`), so the ordering is what keeps a
  // historical alias from ever outranking a live one.
  const here = new Map();
  const list2 = Array.isArray(orders) ? orders : [];
  for (const o of list2) {
    const c = orderCode(o);
    if (c && c !== "??????" && !here.has(c)) here.set(c, o);
  }
  for (const o of list2) {
    const legacy = codeFromId(o);
    if (legacy && legacy !== "??????" && !here.has(legacy)) here.set(legacy, o);
  }

  const voidedBy = voidedIndex(voided);
  const rows = list.map((r) => ({
    ...r,
    order: here.get(r.code) || null,
    orphan: !here.has(r.code),
    // ★ The row as it now reads: an order, a void decision, or genuinely unexplained.
    voided: voidedBy.get(r.number) || null,
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
    // ★ AND A VOIDED ROW IS NO LONGER COUNTED (v448). A receipt she has explained is not a receipt that
    // is unaccounted for — counting it again would leave her register reciting the same four numbers for
    // ever, and **a warning that can never be satisfied is one she learns to ignore.**
    notOnThisPhone: rows.filter((r) => r.orphan && !r.voided).length,
    voided: rows.filter((r) => !!r.voided).length,
    refunded: rows.filter((r) => r.refundedAt).length,
  };
}

// ★★ DOES A SAVED COPY CONTAIN THIS ORDER? (v443)
//
// ⚠️ THE QUESTION THE REGISTER COULD NOT ANSWER. A void row said *"not in this phone's orders"* — which is
// true of an order she removed on purpose, an order swept away by a fault, and an order this phone simply
// never had, **and it cannot tell those apart.** On 11 Oct 2026 three such rows sat there under three paid
// receipts and nobody could say which of the three it was. ⭐ This is the half that fixes it: the same two
// numbers the register already matches on — the one an order wears today, and the one it wore before it was
// grouped (v441) — looked for inside one of her own saved copies.
export function copyKnowsCode(orders, code) {
  const want = String(code || "").trim().toUpperCase();
  if (!want || want === "??????") return false;
  return (Array.isArray(orders) ? orders : []).some(
    (o) => o && (orderCode(o) === want || codeFromId(o) === want));
}

// ★★ AND IT ANSWERS WITH A WINDOW, NOT A MOMENT (v443) — HER OWN INSTRUCTION.
//
// __"you should say that something entered abt 8am, is deleted later in the afternoon, by me or by the
// system error itself"__
//
// ⚠️⚠️ SHE IS RIGHT, AND ONE TIME COULD NOT SAY IT. "Last seen at 08:20" proves the order existed at 08:20
// and says nothing about when it left — and a single time invites her to read it as the moment it vanished,
// which the app cannot know. ⭐ **Two copies BRACKET it instead:** the newest copy that still HAS the order,
// and the copy immediately newer than it, which does not. **It was there at the first and gone by the
// second, so it left between the two** — which is a fact, and a much tighter one than "after 08:20".
//
// ⚠️ AND IT NEVER NAMES THE CAUSE. Removed by her, or removed by the app itself — **the data cannot tell
// those apart, and a sentence that guessed would be the same fault as reading "this fits" as "this is it".**
// Both are said, and neither is chosen. ⭐ It gets carried into her records: overstating here is worse than
// saying less.
//
// `copies` MUST BE NEWEST FIRST — the caller orders them. Returns { hit, goneBy }: the newest copy that
// knows the code, and the copy one step newer that does NOT (null when the newest copy itself still has it).
export function lastSeenIn(copies, code) {
  const list = Array.isArray(copies) ? copies : [];
  const i = list.findIndex((c) => c && copyKnowsCode(c.orders, code));
  if (i < 0) return { hit: null, goneBy: null };
  return { hit: list[i], goneBy: i > 0 ? list[i - 1] : null };
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
