// test/health.test.js — the app's own checks on her data (v446).
//
// HER QUESTION, and she says she always asks it: __"is the system robust enough in many ways. What measure,
// what test, we can do to effectively measure it?"__
//
// ⚠️⚠️ AND THE ANSWER THIS FILE EXISTS FOR: on 11 Oct 2026 her app had **3,335 passing tests while three
// PAID orders were missing.** Those tests check what the CODE does; everything they were pointed at worked.
// **Her loss was a fact about her DATA, and nothing looked at her data.** ⭐ So "the tests pass" is not a
// measure of robustness — and the checks below are the other kind.
//
// ⚠️ THE THREE FAULTS THAT COST HER ARE THE FIXTURES, one test each. A check nobody has seen fire is a
// check nobody knows works — and these three have all fired on her phone for real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { hideSparesBlocked, runHealthChecks, localChecks, registerChecks, copyChecks, backupChecks, recordCountCheck } = await import("../admin/js/health.js");
const sync = await import("../admin/js/sync.js");
// ⭐ The phone's own storage limit, read from the SAME constant the check uses — so the test cannot pass
// against a number the app does not actually hold itself to.
const { PHONE_STORE_LIMIT } = await import("../admin/js/state.js");

// The smallest book that should come out CLEAN — one order, one bake day, paid, numbered, on the shelf
// nothing, and a register row that agrees with it.
function healthy() {
  return {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 16, active: true }],
    deliveryDates: [{ id: "d1", date: "2026-10-12" }],
    orders: [{
      id: "ord_a1b2c3d4e5f6", groupId: "ord_a1b2c3d4e5f6", deliveryDateId: "d1",
      deliveryDate: "2026-10-12", productId: "p1", qty: 3, unitPrice: 16, status: "paid",
      paidReceived: true, paidMethod: "cash", customerName: "Jien", whatsapp: "60123456789",
      receiptNo: 7,
    }],
    removedOrders: [],
  };
}
const REGISTER = [{ number: 7, order_code: "D4E5F6", issued_at: "2026-10-11T08:25:00.000Z" }];
const COPIES = [{ id: "s1", kind: "daily", created_at: new Date().toISOString() }];
const resultOf = (res, id) => res.results.find((r) => r.id === id);

// ⭐⭐ EVERY CHECK BELOW NOW GETS A COPY TO COMPARE AGAINST (v457) — a snapshot of the same book, as it
// stood before the test changed anything. ⚠️ **Without one the new check is SKIPPED**, and a skipped check
// is invisible to this file's own assertion that every check actually RAN. ⭐ The helper exists so the
// snapshot is built from the state each test already has, rather than a fixture that drifts from it.
const COPY_WHEN = "11 Oct · 21:41";
const runChecks = (state, extra = {}) => runHealthChecks(state, {
  ...extra,
  copy: { orders: state.orders, removedOrders: state.removedOrders },
  copyWhen: COPY_WHEN,
  // ⭐⭐ AND THE PHONE-AGAINST-THE-CLOUD PAIR (v466) — a shared data that holds EXACTLY what this phone
  // holds, so a healthy book passes and a fault is a fault. ⚠️ **Without these the two new checks SKIP, and
  // a skipped check is invisible to this file's own "every check actually RAN" assertion.**
  local: sync.localKeys(state),
  // ⚠️ THE CLOUD IS BUILT FROM WHAT THE APP WOULD ACTUALLY SEND — a REAL cloud, not a copy of one of the
  // answers. ⭐ v469's lesson: a fixture built out of the code under test cannot catch a fault in it, so
  // this comes from `localPayloads`, which is what travels.
  cloud: { ok: true, keys: new Set(sync.localKeys(state)), data: sync.localPayloads(state) },
  // ⭐ AND THE ROW COUNT (17 October 2026). ⚠️ **Absent it, that check SKIPS — and a skipped check is not a
  // pass**, which is exactly what this file's "every check actually RAN" assertion is there to catch.
  records: { ok: true, count: sync.localKeys(state).length, atLeast: false },
  payloads: sync.localPayloads(state),
  queued: new Set(),
  waiting: 0,
  // ⭐ AND HOW BIG THE BOOK IS (v531) — the count the last read would have found. ⚠️ **Without it the new
  // check SKIPS, and a skipped check is invisible to this file's own "every check actually RAN" assertion**,
  // which is exactly the trap the comment above records for the two cloud checks. ⭐ Taken from the state
  // rather than typed, so it cannot drift from the fixture.
  count: sync.localKeys(state).length,
  ceiling: sync.PULL_CEILING,
});

test("★★ a healthy book passes every check — and every check actually RAN", () => {
  const res = runChecks(healthy(), { register: REGISTER, copies: COPIES });
  assert.deepEqual(res.results.filter((r) => r.status === "fail").map((r) => `${r.id}: ${r.why}`), [],
    "a healthy book was reported as having a fault");
  assert.deepEqual(res.results.filter((r) => r.status === "skipped").map((r) => r.id), [],
    "a check was skipped on a book and a register that were both readable");
  // ⚠️ THE COUNT IS THE POINT. `[].every(...)` is TRUE — a check list that had quietly emptied itself
  // would pass every assertion above, on a phone with no checks at all. This project has been bitten by
  // that exact shape before (v381's doors).
  // 26 since v657: "No van day is before its posting day" joins the page.
  assert.equal(res.total, 26, `the check list is no longer twenty-six checks (it is ${res.total})`);
  assert.equal(res.passedChecks, 26);
  assert.equal(res.failed, 0);
});

test("★★★ a damaged saved copy FAILS the check, and a good one passes it", () => {
  // ⚠️⚠️ v548: a stored book that could not be read used to come up EMPTY and say nothing. ⭐ **The check
  // must now speak for it — and it must clear itself once the book is readable again**, or a red X would
  // outlive the damage and become the warning she learns to ignore.
  const damaged = healthy();
  damaged.unreadableSave = { at: "2026-10-18T00:07:00.000Z", chars: 4210 };
  const r = resultOf(runChecks(damaged, { register: REGISTER, copies: COPIES }), "readable");
  assert.equal(r.status, "fail",
    "★ this phone could not read its saved copy and the check said nothing — **the reset is silent, which "
    + "is the fault being fixed**");
  assert.match(String(r.detail && r.detail[0]), /4,?210/, "★ the check did not say how much was kept");

  const ok = resultOf(runChecks(healthy(), { register: REGISTER, copies: COPIES }), "readable");
  assert.equal(ok.status, "pass", "★ a book that read cleanly was reported as damaged");
});

test("★★ a receipt with no order behind it FAILS — the fault that cost her three orders", () => {
  // ⚠️ THIS IS HER 11 OCT: three receipts issued for orders that are not on the phone. Both screens showed
  // the row and neither could say whether the order was gone or merely unread.
  const st = healthy();
  const register = [...REGISTER, { number: 9, order_code: "D06D27", issued_at: "2026-10-11T08:25:00.000Z" }];
  const res = runChecks(st, { register, copies: COPIES });
  const r = resultOf(res, "hasOrder");
  assert.equal(r.status, "fail", "★ a receipt with no order behind it was not reported");
  // ⚠️⚠️ AND IT NAMES THE RECEIPT ITSELF (v472) — her words: __"how phone flag DE1F19, as i cannot find
  // DE1F19 anywhere other then the Check My System run"__. ⭐ **A code alone cannot be looked up, because
  // the order's code has moved since (v441) — so the row carries its RECEIPT NUMBER and DATE too, which no
  // order can change.** The register fixture is receipt #9, written 2026-10-11.
  assert.equal(r.detail.length, 1, "the failing receipt was not named");
  assert.match(r.detail[0], /#D06D27/, "the failing receipt's code is not named");
  assert.match(r.detail[0], /receipt #000009/, "★ the receipt NUMBER is not named, so it cannot be looked up");
  assert.match(r.detail[0], /2026-10-11/, "★ the receipt's DATE is not named, so it cannot be placed");
  // ★★★ AND IT LEADS WITH THE PRESS THAT CLEARS IT (v473). Her own finding: __"DE1F19 is with invoice 0001,
  // that i already deleted"__ — ⭐ **a receipt for money, standing with no order, because she removed the
  // order herself.** ⚠️ **The check could not tell that from a loss and read as a fault for six days.**
  assert.match(r.fix, /Mark as void/,
    "★ the way out does not name the register's own control, so she has to work out the diagnosis herself");
  assert.match(r.fix, /line clears/i, "★ it does not say that marking it void actually clears the line");
  assert.match(r.fix, /WhatsApp/,
    "★ and the route for a real loss was dropped — that leaves a fault with no way out");
  // ⚠️ AND THE WINDOW IS STATED, IN HER WORDS AND AT HER NUMBER (v530): **30 days, because one constant was
  // doing two jobs** — the put-back window she chose at 48 hours, and the trace the "left without a trace"
  // check needs (it opens a copy about a WEEK old, which 48 hours could never satisfy).
  assert.match(r.why, /30 days/,
    "★ the reason does not say why this happens innocently: a removed order is only kept for 48 hours");
  assert.match(r.why, /receipt stands and the money is recorded/i, "the check does not say what it means");
  assert.match(r.fix, /WhatsApp/i, "the check does not say what she can do about it");

  // ⭐ AND AN ORDER ON THE REMOVED LIST IS **NOT** A FAULT — that is the v444 shelf doing its job.
  const shelf = healthy();
  shelf.orders = [];
  // ⚠️ THE ID MUST HASH TO THE RECEIPT'S CODE, or this asserts nothing: `orderCode` is the last six hex
  // characters of the id, and `ord_a1b2d06d27` gives `D06D27`.
  shelf.removedOrders = [{ id: "ord_a1b2d06d27", removedAt: new Date().toISOString(),
    productId: "p1", qty: 2, deliveryDateId: "d1", deliveryDate: "2026-10-12" }];
  // ⚠️ THE REGISTER HERE HOLDS ONLY THAT ONE RECEIPT. The healthy order is deliberately not in this book,
  // so its own receipt would be unaccounted for — and this check would fail for a second, unrelated reason.
  const oneRow = [{ number: 9, order_code: "D06D27", issued_at: "2026-10-11T08:25:00.000Z" }];
  assert.equal(resultOf(runChecks(shelf, { register: oneRow, copies: COPIES }), "hasOrder").status, "pass",
    "★ an order kept on the Removed list was reported as unaccounted for");
});

test("★★ an order that is not carrying its receipt number FAILS — her #F447EE, on her own screen", () => {
  // ⚠️ HER CONSOLIDATED INVOICE printed "none yet" beside an order her receipt register could name in full.
  // The number had been issued and stamped on a ROW the filing page never read.
  const st = healthy();
  delete st.orders[0].receiptNo;
  const res = runChecks(st, { register: REGISTER, copies: COPIES });
  const r = resultOf(res, "carried");
  assert.equal(r.status, "fail", "★ an order missing the number the register holds for it was not reported");
  assert.match(r.detail[0], /receipt #000007, order says none/,
    `the check did not say what is wrong: ${r.detail[0]}`);
  assert.match(r.why, /none yet/, "the check does not say what she would SEE on the page");
});

test("★★ one order's lines disagreeing about the order FAILS", () => {
  // ⚠️ THE SHAPE OF EVERY FAULT ON THIS SCREEN — v432 (status), v441 (the number), v445 (the receipt no).
  const st = healthy();
  st.orders = [
    { ...st.orders[0], id: "ord_a1b2c3d4e5f6" },
    { ...st.orders[0], id: "ord_a1b2c3d4e5f7", qty: 1, status: "new" },  // disagrees about the STATUS
  ];
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "agree");
  assert.equal(r.status, "fail", "★ a group disagreeing about its own status was not reported");
  assert.equal(r.detail.length, 1, "the disagreeing order was not named once");
  assert.match(r.detail[0], /status/, "the check did not say WHICH fact the lines disagree about");

  // ⚠️ AND A PER-LINE FACT MUST NOT TRIP IT — quantity is each line's own business, and a check that
  // flagged it would cry wolf on every ordinary multi-item order.
  const ok = healthy();
  ok.orders = [
    { ...ok.orders[0], id: "ord_a1b2c3d4e5f6", qty: 3 },
    { ...ok.orders[0], id: "ord_a1b2c3d4e5f7", qty: 1, lineNote: "no nuts" },
  ];
  assert.equal(resultOf(runChecks(ok, { register: REGISTER, copies: COPIES }), "agree").status, "pass",
    "★ a perfectly ordinary two-item order was reported as disagreeing with itself");
});

test("★★★ a refund in the REGISTER that the order is not carrying is NAMED (v605)", () => {
  // ⚠️⚠️ THE SAME WIPE THAT TOOK A RECEIPT NUMBER TAKES A REFUND (v605). ⚠️ A record travels whole, so a
  // newer copy of an order that never learned about a refund removes the mark — ⚠️ **and Money and Profit
  // then read that money as still in her hand.** ⭐ The register is the record that survives, exactly as it
  // is for the number beside it.
  const st = healthy();
  const refunded = [{ ...REGISTER[0], refunded_at: "2026-10-12T09:00:00.000Z", refunded_amount: 8 }];
  const r = resultOf(runChecks(st, { register: refunded, copies: COPIES }), "refunded");
  assert.equal(r.status, "fail",
    "★ a refund recorded in the register and missing from its order was not reported");
  assert.deepEqual(r.detail, ["#D4E5F6 · refund #000007"], "★ the check does not name which refund");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");

  // The order carrying the mark passes.
  const marked = healthy();
  marked.orders = marked.orders.map((o) => ({ ...o, refundedAt: "2026-10-12T09:00:00.000Z" }));
  assert.equal(resultOf(runChecks(marked, { register: refunded, copies: COPIES }), "refunded").status,
    "pass", "★ an order that carries its own refund mark was reported as missing it");
});

test("★★⚠️ and a refund she TOOK BACK is never reported — the register is what speaks (v605)", () => {
  // ⚠️ This is why the check reads the REGISTER and not the order: `unrefund_receipt` clears `refunded_at`
  // there, so an undone refund never reaches the loop. A check that read the order would have to guess
  // between "never knew" and "was undone" — and it would get it wrong half the time.
  const st = healthy();          // no refund mark on the order
  assert.equal(resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "refunded").status,
    "pass", "★ a register row with no refund was reported as one");

  // And a refund whose order is not on this phone belongs to the line above it, not to this one.
  const elsewhere = [{ ...REGISTER[0], order_code: "ZZZZZZ", refunded_at: "2026-10-12T09:00:00.000Z" }];
  assert.equal(resultOf(runChecks(st, { register: elsewhere, copies: COPIES }), "refunded").status,
    "pass", "★ a receipt for an order this phone does not hold was blamed on this check");
});

test("★★★ an empty value and a missing one are the SAME answer, not a disagreement (v602)", () => {
  // ⚠️⚠️ MEASURED ON HER BOOK, 19 Oct: order AC8542's `promo` was `""` on one line and `null` on the other.
  // ⭐ **Both mean "no code on this sale"**, and the check compared their spelling, so it reported a
  // disagreement that did not exist — for ever, on an order nothing could fix.
  const st = healthy();
  st.orders = [
    { ...st.orders[0], id: "ord_a1b2c3d4e5f6", promo: "" },
    { ...st.orders[0], id: "ord_a1b2c3d4e5f7", promo: null },
  ];
  assert.equal(resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "agree").status, "pass",
    "★ an empty value and a missing one were reported as disagreeing — **they are one fact**");

  // ⚠️ AND AN ANSWER IS STILL AN ANSWER: `false` is not `""`, and 0 is not missing. A check that flattened
  // those would hide a real disagreement behind a normalisation.
  const paid = healthy();
  paid.orders = [
    { ...paid.orders[0], id: "ord_a1b2c3d4e5f6", paidReceived: false },
    { ...paid.orders[0], id: "ord_a1b2c3d4e5f7", paidReceived: "" },
  ];
  assert.equal(resultOf(runChecks(paid, { register: REGISTER, copies: COPIES }), "agree").status, "fail",
    "★ `false` was flattened into nothing — a line that says NOT PAID must still disagree with one "
    + "that says the money is in");
});

test("★★★ an order on a DELETED bake day is FINE — the app shows it; only an unplaceable one fails (v572)", () => {
  // ⚠️⚠️ The app's own Delete button removes a bake day and keeps its orders on purpose, and the Orders list
  // draws them with "its bake day was removed — tap to put it on one". ⭐ The check used to fail for ever on
  // that ordinary state, with a sentence saying the orders were invisible — **which the app contradicts.**
  const st = healthy();
  st.orders[0].deliveryDateId = "d_gone";     // the day is gone, the order keeps its own date
  assert.equal(resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "day").status, "pass",
    "★ a normal tidy-up was reported as a fault — **a red X she cannot clear by doing something wrong**");

  // ⚠️ And an order with NO day at all — no id and no date — is the one that really is unplaceable.
  const lost = healthy();
  lost.orders[0].deliveryDateId = "d_gone";
  delete lost.orders[0].deliveryDate;
  const r = resultOf(runChecks(lost, { register: REGISTER, copies: COPIES }), "day");
  assert.equal(r.status, "fail", "★ an order nothing can place was not reported");
  assert.match(r.fix, /delivery date/, "the check does not say what she can do about it");
});

test("★★⚠️ A CHECK THAT COULD NOT RUN IS SKIPPED — IT IS NEVER A PASS", () => {
  // ⚠️⚠️ THE RULE THIS MODULE IS BUILT ON, and the register's own oldest rule: an unreadable register must
  // never be drawn as an empty one. **A verdict that counted "I could not look" as "it is fine" is worse
  // than no verdict**, because she would stop looking.
  const res = runHealthChecks(healthy(), { register: null, copies: null, records: { ok: true, count: 3, atLeast: false } });
  assert.equal(resultOf(res, "hasOrder").status, "skipped", "★ an unreadable register was reported as a pass");
  assert.equal(resultOf(res, "carried").status, "skipped", "★ an unreadable register was reported as a pass");
  assert.equal(resultOf(res, "copies").status, "skipped", "★ unreadable copies were reported as a pass");
  // ⭐ AND THE COPY IT COULD NOT OPEN IS SKIPPED TOO (v457). ⚠️ **This is the check whose whole subject is
  // something the app CANNOT see — an order that has left leaves nothing behind — so a pass here without
  // having looked would be the worst of the lot.**
  assert.equal(resultOf(res, "stable").status, "skipped", "★ a copy that could not be opened was reported as a pass");
  // ⚠️⚠️ AND BOTH OF THE PHONE-AGAINST-THE-CLOUD CHECKS SKIP TOO (v466), EACH SAYING WHY. ⭐ **A phone with
  // shared data off must not be told its records are fine and it must not be told they are lost** — it must
  // be told that nobody could look, which is the only honest answer available.
  assert.equal(resultOf(res, "reached").status, "skipped",
    "★ shared data that could not be read was reported as a pass");
  assert.equal(resultOf(res, "cloudOnly").status, "skipped",
    "★ shared data that could not be read was reported as a pass by the reverse check too");
  assert.equal(resultOf(res, "waiting").status, "pass",
    "the waiting count is a local number and does not need the cloud to be readable");
  assert.equal(res.passedChecks, 17, "a skipped check was counted among the passes");
  assert.equal(res.skippedChecks, 9, "the skipped checks were not counted separately");
  assert.equal(resultOf(res, "refunded").status, "skipped",
    "★ an unreadable register was reported as a pass by the refund check");
  assert.match(String(resultOf(res, "reached").why || ""), /shared data/i,
    "the skipped check does not say why it could not look");
  // ⚠️ AND A SKIP SAYS WHY — the same discipline the register screen follows.
  assert.match(resultOf(res, "hasOrder").why, /shared data/i, "a skipped check does not say why it could not run");

  // And an EMPTY copy list is a real fault, not a skip: there is a difference between "none saved" and
  // "could not read", and the two must not be drawn alike.
  assert.equal(copyChecks([])[0].status, "fail", "no saved copies at all was not reported as a fault");
});

test("★★ a receipt she has declared void is NOT a fault — a decision is not a hole (v448)", () => {
  // ⚠️⚠️ WITHOUT THIS THE CHECK COULD NEVER GO GREEN on those rows, **and a warning that can never be
  // satisfied is one she learns to ignore** — which would cost her the whole page.
  const st = healthy();
  const register = [...REGISTER, { number: 9, order_code: "D06D27", issued_at: "2026-10-11T08:25:00.000Z" }];
  assert.equal(resultOf(runChecks(st, { register, copies: COPIES }), "hasOrder").status, "fail",
    "the fixture did not start with an unaccounted receipt");

  st.voidedReceipts = [{ no: 9, code: "D06D27", at: "2026-10-12T09:00:00.000Z", reason: "trial order" }];
  assert.equal(resultOf(runChecks(st, { register, copies: COPIES }), "hasOrder").status, "pass",
    "★ a receipt she has explained was still reported as a fault the page can never clear");
});

test("★ a stale copy is a fault, because the day it matters is the day it is missing", () => {
  const old = [{ id: "s1", kind: "daily", created_at: "2026-10-01T00:00:00.000Z" }];
  const now = new Date("2026-10-11T12:00:00.000Z");
  assert.equal(copyChecks(old, now)[0].status, "fail", "a ten-day-old copy was reported as fine");
  const fresh = [{ id: "s2", kind: "daily", created_at: "2026-10-11T08:00:00.000Z" }];
  assert.equal(copyChecks(fresh, now)[0].status, "pass", "a copy from this morning was reported as stale");
});

test("★★ no check's words carry markdown — her screen prints it literally (v447)", () => {
  // ⚠️⚠️ SHE SAW IT BEFORE I DID. The first run on her phone printed, in the middle of a sentence:
  // **"**The receipt stands and the money is recorded — but the order behind it is not here.**"** — asterisks
  // and all. `el()` draws a string AS-IS, so markdown in a user-facing sentence is not emphasis, it is
  // punctuation she has to read past. ⭐ **Guard is on the OUTPUT, not on the source**: exercises every
  // failing check and reads what each one actually says, so a check written next year is covered too.
  const st = {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 16, active: true }],
    deliveryDates: [{ id: "d1", date: "2026-10-12" }],
    orders: [
      { id: "ord_a1b2c3d4e5f6", deliveryDateId: "d_gone", productId: "p1", qty: 1, status: "paid",
        paidReceived: true, customerName: "A", receiptNo: 0 },
      { id: "ord_a1b2c3d4e5f6", deliveryDateId: "d_gone", productId: "p1", qty: 1 },   // a duplicate id
    ],
    removedOrders: [{ id: "ord_a1b2c3d4e5f6" }, { id: "ord_bbbbbbbbbbbb", removedAt: new Date().toISOString() }],
  };
  // ⚠️ AND THE COPY CARRIES ONE ORDER MORE THAN THE PHONE HAS, so the copy check FAILS here as well and
  // **its own words are read by this guard** — a check written next year is exactly what this covers.
  const res = runHealthChecks(st, {
    register: [{ number: 1, order_code: "FFFFFF" }], copies: [], copyWhen: COPY_WHEN,
    records: { ok: true, count: 3, atLeast: false },
    copy: { orders: [...st.orders, { id: "ord_cccccccccccc" }], removedOrders: st.removedOrders },
  });
  assert.ok(res.failedChecks >= 5, `the fixture did not fail enough checks to read their words (${res.failedChecks})`);
  assert.equal(resultOf(res, "stable").status, "fail",
    "★ the copy check did not fail here, so the one check whose sentence is longest was never read for markdown");
  const words = res.results.flatMap((r) => [r.title, r.why, r.fix, ...(r.detail || [])]).filter(Boolean);
  const withMarkup = words.filter((w) => /\*\*|__/.test(w));
  assert.deepEqual(withMarkup, [],
    `★ a check's own words carry markdown, which her screen prints as punctuation: ${withMarkup.join(" | ")}`);
  // ⚠️ AND THE FIX MUST ALWAYS BE THERE when a check fails — a fault with no way out is a dead end.
  for (const r of res.results.filter((x) => x.status === "fail")) {
    assert.ok(r.why, `${r.id} failed without saying what it means`);
    assert.ok(r.fix, `${r.id} failed without saying what she can do about it`);
  }
});

test("⚠️ a phone with no orders at all is checked without throwing", () => {
  const bare = { settings: { currency: "RM" }, products: [], deliveryDates: [], orders: [], removedOrders: [] };
  const res = runChecks(bare, { register: [], copies: COPIES });
  assert.equal(res.failed, 0, "an empty book reported a fault");
  assert.equal(res.total, 26, "the checks did not all run on an empty book");
  assert.equal(localChecks(bare).length, 14, "the local checks are not fourteen");
  assert.equal(registerChecks(bare, []).length, 3, "the register checks are not three");
  assert.equal(backupChecks(bare, { orders: [] }).length, 1, "the copy check is not one");
});

// ── v457: the only check that can see an order LEAVE ────────────────────────

test("★★★ an order that leaves the phone is caught — the fault that cost her three orders", () => {
  // ⚠️⚠️ WHY THIS CHECK HAS TO EXIST, AND WHY NOTHING BEFORE IT COULD DO THE JOB. Every other check compares
  // **one part of her live data against another part of her live data** — and when an order leaves, both
  // sides leave together, so they all stay green. ⭐ **A saved copy is the only thing in the app that
  // remembers what was there before.** On 11 Oct 2026 that check did not exist, and her three paid orders
  // sat missing while 3,335 tests passed.
  const week = healthy();
  const copy = { orders: week.orders, removedOrders: [] };   // the copy taken a week ago
  const now = healthy();
  now.orders = [];                                           // …and the order is gone from this phone

  const r = resultOf(runHealthChecks(now, { register: REGISTER, copies: COPIES, copy, copyWhen: COPY_WHEN }), "stable");

  assert.equal(r.status, "fail", "★ an order vanished from the live list and nothing reported it");
  // ⚠️ AND IT NAMES THE ORDER, by the number she would search for — a count she cannot look up is a number
  // she cannot act on. This is the same code the receipt register prints.
  assert.deepEqual(r.detail, ["#D4E5F6"], "★ the check does not name the order that went missing");
  assert.match(r.why, /Removed list/, "★ it does not say the app has no record of taking the order off");
  assert.match(r.why, /copy saved on/, "★ it does not say which copy it looked at");
  // ⚠️⚠️ AND IT NAMES ALL THREE INNOCENT CASES (v550). ⭐ It named two, and her own screen showed a third:
  // **an order removed on her OTHER phone while this phone had never received it** — this phone has nothing
  // to record, so a deliberate removal on the other phone reads here as a loss.
  assert.match(r.why, /THREE innocent cases/,
    "★ the reason does not say how many innocent explanations there are, so she cannot tell whether hers is one");
  assert.match(r.why, /OTHER phone/,
    "★ the reason does not name an order removed on her other phone — **the one case a second phone makes, "
    + "and this phone cannot record it at all**");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
});

test("★★★ an order whose receipt she declared VOID is not a loss — the v448 rule, applied here too (v527)", () => {
  // ⚠️⚠️ HER OWN SCREEN FOUND THIS. The check named `#4B00A9` as an order that left "by no route it knows"
  // — ⭐ **and the app did have a record of its fate: she marked its receipt (#000015) void.** ⭐⭐ **The
  // receipt check has had this carve-out since v448 in almost the same words — a recorded decision is not an
  // unexplained hole — and this check, standing next to it, was not asking for it at all.**
  // ⚠️ Both innocent cases are the same shape: the copy looks back about a WEEK, and the Removed list
  // remembers 48 HOURS, so a deliberate removal in between has nothing left to explain it.
  const week = healthy();
  const copy = { orders: week.orders, removedOrders: [] };
  const now = healthy();
  now.orders = [];          // the order is gone from this phone
  now.removedOrders = [];   // and the shelf row has long been pruned
  now.voidedReceipts = [{ id: "void_7", no: 7, code: "D4E5F6", at: "2026-10-12T00:00:00.000Z" }];

  const r = resultOf(runHealthChecks(now, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN, copy,
  }), "stable");
  assert.equal(r.status, "pass",
    "★ an order whose receipt she marked VOID was still named as a loss — **voiding it IS her record of that "
    + "order's fate, and a check that ignores the record she made is one she learns to ignore**");
});

test("★★ and a void record that names the RECEIPT NUMBER explains it too, when the code has moved", () => {
  // ⚠️ THE OTHER HALF OF THE MATCHING (v470's lesson, applied here): a void record made before v441 holds the
  // code the order wore THEN, which is not the code it wears now. ⭐ **The receipt number is the fact the two
  // always share**, so an order is explained by either.
  const week = healthy();
  const copy = { orders: week.orders, removedOrders: [] };
  const now = healthy();
  now.orders = [];
  now.removedOrders = [];
  // ⚠️ No code at all — only the number, which is all an old record reliably carries.
  now.voidedReceipts = [{ id: "void_7", no: 7, at: "2026-10-12T00:00:00.000Z" }];

  assert.equal(resultOf(runHealthChecks(now, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN, copy,
  }), "stable").status, "pass",
  "★ a void record naming only the receipt NUMBER did not explain the order — **a record made before v441 "
  + "holds the code the order wore then, so reading the number is what stops that becoming a false loss**");
});

test("★★★ …and the carve-out CANNOT hide a real loss — a void record for another receipt excuses nothing", () => {
  // ⚠️⚠️ THE ASSERTION THAT KEEPS THE FIX HONEST. ⭐ **A carve-out that explained every missing order would
  // turn this check green for ever, which is exactly the failure it exists to catch** (v446: 3,335 tests
  // green while three paid orders were missing).
  const week = healthy();
  const copy = { orders: week.orders, removedOrders: [] };
  const now = healthy();
  now.orders = [];
  now.removedOrders = [];
  now.voidedReceipts = [{ id: "void_9", no: 9, code: "AAAAAA", at: "2026-10-12T00:00:00.000Z" }];

  const r = resultOf(runHealthChecks(now, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN, copy,
  }), "stable");
  assert.equal(r.status, "fail", "★ a voided receipt for a DIFFERENT order excused a real loss");
  assert.deepEqual(r.detail, ["#D4E5F6"], "★ the order that really went is not named");
});

test("★★ the same order is NOT a fault when it was removed on purpose — either list explains it", () => {
  // ⚠️⚠️ WITHOUT THIS THE CHECK COULD NEVER GO GREEN ON AN ORDER SHE DELETED HERSELF, **and a warning that
  // can never be satisfied is one she learns to ignore** — the rule this file already records for voided
  // receipts. ⭐ And there are TWO places the explanation can live, because the Removed list only keeps 48
  // hours: her live shelf, and **the copy's own shelf, which is what explained it at the time it was taken.**
  const week = healthy();
  const copyOrders = week.orders;

  // (a) it is on the Removed list NOW
  const onShelfNow = healthy();
  onShelfNow.orders = [];
  onShelfNow.removedOrders = [{ id: "ord_a1b2c3d4e5f6", removedAt: new Date().toISOString() }];
  assert.equal(resultOf(runHealthChecks(onShelfNow, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN,
    copy: { orders: copyOrders, removedOrders: [] },
  }), "stable").status, "pass", "★ an order she removed by hand was reported as a loss");

  // (b) the shelf row has since been pruned, and only the COPY remembers it was taken off
  const prunedSince = healthy();
  prunedSince.orders = [];
  prunedSince.removedOrders = [];
  assert.equal(resultOf(runHealthChecks(prunedSince, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN,
    copy: { orders: copyOrders, removedOrders: [{ id: "ord_a1b2c3d4e5f6", removedAt: "2026-10-05T00:00:00.000Z" }] },
  }), "stable").status, "pass", "★ a removal the copy still remembers was reported as a loss");

  // ⚠️ AND THE OTHER WAY AN ORDER IS RECOGNISED IS CHECKED TOO (v441): the code it wears today, and the
  // one it wore before it was grouped. A copy from before it gained an item must not read as a loss.
  const beforeGrouping = healthy();
  const oldOrder = { ...week.orders[0], groupId: undefined };
  beforeGrouping.orders = [{ ...oldOrder, id: "ord_a1b2c3d4e5f6", groupId: "group_zzz" }];
  assert.equal(resultOf(runHealthChecks(beforeGrouping, {
    register: REGISTER, copies: COPIES, copyWhen: COPY_WHEN,
    copy: { orders: [oldOrder], removedOrders: [] },
  }), "stable").status, "pass", "★ an order that gained an item was reported as a loss");
});

// ── v466: the check that compares this phone against the shared data ─────────
test("★★★ a BAKE DAY on this phone that the shared data does not hold is FOUND", () => {
  // ⚠️⚠️ HER WORDS, AND THIS IS THE CASE EXACTLY: __"i add a bake date 10/10, other user dont see it"__.
  // ⭐ **Every check before this one compared this phone with ITSELF.** Nothing had ever asked whether what
  // is on the phone is actually in the shared data — which is the whole of her report.
  const st = healthy();
  const local = sync.localKeys(st);
  // …and the shared data holds everything EXCEPT the bake day.
  const cloud = { ok: true, keys: new Set(local.filter((k) => !k.startsWith("deliveryDates:"))) };

  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), local, cloud, waiting: 0 }), "reached");
  assert.equal(r.status, "fail", "★ a delivery date that never reached the shared data was reported as fine");
  assert.deepEqual(r.detail, ["delivery date 2026-10-12"],
    "★ it does not NAME the record, so she cannot look it up");
  assert.match(r.why, /other phone/i, "the check does not say what the consequence is");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
});

test("★★ and an order that never reached the shared data is named by its number", () => {
  const st = healthy();
  const local = sync.localKeys(st);
  const cloud = { ok: true, keys: new Set(local.filter((k) => !k.startsWith("orders:"))) };
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), local, cloud, waiting: 0 }), "reached");
  assert.equal(r.status, "fail", "★ an order that never left this phone was reported as fine");
  // ⚠️ THE ORDER NUMBER IS WHAT SHE WENT TO THE RECEIPT REGISTER TO FIND — the same key everything else in
  // this app is matched on (v441).
  assert.deepEqual(r.detail, ["#D4E5F6"], "★ the order is not named the way she can look it up");
});

test("★★⚠️ and what is still WAITING TO SEND is counted — the number nothing could show before", () => {
  // ⚠️⭐ IT IS THE NUMBER THAT DECIDED WHETHER THE CHECK ABOVE IS A FAULT OR A PHOTOGRAPH OF A PHONE
  // MID-SEND, and until v466 no screen could show it at all.
  const st = healthy();
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 3 }), "waiting");
  assert.equal(r.status, "fail", "★ three changes waiting to be sent was reported as nothing to say");
  assert.deepEqual(r.detail, ["3 changes"], "the count is not what she is shown");
  assert.match(r.why, /no other phone can see/i, "the check does not say what waiting means");
  assert.equal(resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 0 }), "waiting").status, "pass",
    "a phone with nothing waiting was reported as having something to send");
});

// The register, the copies and the copy are not what these three tests are about — but leaving them out
// would SKIP the checks that are, and a skipped check is invisible to "every check actually RAN".
function emptyExtras() {
  return { register: Array.isArray(REGISTER) ? REGISTER : [], copies: COPIES, copyWhen: COPY_WHEN,
    copy: { orders: [], removedOrders: [] }, local: [], cloud: { ok: true, keys: new Set(), data: new Map() },
    payloads: new Map(), queued: new Set() };
}

// ── v468: the SAME question the other way round ──────────────────────────────
test("★★★ a record in the SHARED DATA that is on no device is found — and is NOT called lost", () => {
  // ⚠️⚠️ Her instruction: __"build the reverse check"__ — asked while two orders sat in her 6 October copy
  // and on **neither** device, ⚠️ **and I could not tell her whether they were still in the shared data.**
  // ⭐ **That is the difference between a record that is LOST and one that is merely not yet pulled.**
  const st = healthy();
  const local = sync.localKeys(st);
  // …the shared data holds everything this phone has, PLUS an order this phone has never seen.
  const cloud = { ok: true, keys: new Set([...local, "orders:ord_420eeff00d00"]) };

  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), local, cloud, waiting: 0 }), "cloudOnly");
  assert.equal(r.status, "fail", "★ a record held in the shared data was not reported at all");
  assert.deepEqual(r.detail, ["#F00D00"],
    "★ it does not name the record — an order has to be named the way she can look it up");
  // ⭐⭐ AND THE SENTENCE THAT IS THE WHOLE POINT OF THIS CHECK.
  assert.match(r.why, /NOT lost/i,
    "★ the check does not say the one thing that matters: it is not lost, it is not yet here");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
});

test("★★ and an order she removed ON PURPOSE is NOT reported — the shelf is the explanation", () => {
  // ⚠️⚠️ WITHOUT THIS CARVE-OUT THE CHECK FIRES ON EVERY DELIBERATE REMOVAL: **an order she took off is gone
  // from the live list while its row stays in the shared data until the tombstone lands.** ⭐ A warning that
  // fires on something she meant to do is one she learns to ignore — this file's own oldest rule.
  const st = healthy();
  st.orders = [];
  st.removedOrders = [{ id: "ord_aaaabbbbcccc", removedAt: "2026-10-11T00:00:00.000Z" }];
  const local = sync.localKeys(st);   // holds removedOrders:… and NOT orders:…
  const cloud = { ok: true, keys: new Set([...local, "orders:ord_aaaabbbbcccc"]) };

  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), local, cloud, waiting: 0 }), "cloudOnly");
  assert.equal(r.status, "pass",
    "★ an order she removed on purpose was reported as sitting in the shared data — the shelf explains it");
});

// ── v469: the reverse check against a REAL cloud, not a copy of the phone's own answer ──────────────
test("★★★ the reverse check PASSES against what the app actually sends — settings included", () => {
  // ⚠️⚠️ HOW THE FALSE POSITIVE HID, AND IT IS THE POINT OF THIS TEST: **the other fixtures built the fake
  // cloud FROM `sync.localKeys` — so whatever that function forgot, the cloud forgot with it, and the two
  // agreed.** ⭐ A fixture built out of the code under test cannot catch a fault in that code.
  // ⚠️ **`localKeys` read `LISTS`, and the settings record is NOT in `LISTS` — `computeRecords` sends it
  // separately, by hand.** ⭐ So every device got "settings is in your shared data and not on this phone",
  // for ever. **Found on her Mac, one version after it was written, by RUNNING it.**
  const st = healthy();
  // ⭐ THE CLOUD IS BUILT FROM WHAT THE APP WOULD ACTUALLY SEND — the real source, not a copy of the answer.
  const sent = sync.computeRecords(st).map((r) => `${r.kind}:${r.id}`);
  assert.ok(sent.includes("settings:default"),
    "the fixture is wrong: the app no longer sends a settings record, so this test proves nothing");

  const cloud = { ok: true, keys: new Set(sent) };
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), local: sync.localKeys(st), cloud, waiting: 0 }), "cloudOnly");
  assert.equal(r.status, "pass",
    `★ the reverse check fired on records the app itself puts in the shared data (${(r.detail || []).join(", ")})`
    + " — a warning that can never be satisfied is one she learns to ignore");
});

test("★ and `localKeys` counts the settings record — the one record every phone has", () => {
  assert.ok(sync.localKeys(healthy()).includes("settings:default"),
    "★ `localKeys` left out the settings record, which every phone has and the app always sends");
});

// ── v470: a receipt is matched by its NUMBER, not only by the code it names ──
test("★★★ a receipt whose CODE matches nothing is still accounted for by an order carrying its NUMBER", () => {
  // ⚠️⚠️ HER INSTRUCTION: __"fix the number matching"__ — asked about `#DE1F19`, a receipt naming a code
  // **no order on the phone wears**, while her Mac's identical check passes. ⭐ **The code is the wrong
  // thing to match on:** v441 made the number stop moving, and **v445 then found the code can still be
  // stale — and the answer was to read the RECEIPT NUMBER from the whole order**, because **that is the
  // fact a receipt and an order always share.**
  const st = healthy();
  // The order is there and carries receipt number 7 — but the register names a code it does not wear.
  const register = [{ number: 7, order_code: "DE1F19", issued_at: "2026-10-11T08:25:00.000Z" }];
  const r = resultOf(runChecks(st, { register }), "hasOrder");
  assert.equal(r.status, "pass",
    "★ a receipt was reported as having no order behind it although an order on this phone carries its number");
});

test("★★⚠️ and a receipt NO order carries is STILL reported — the fix must not hide a real loss", () => {
  // ⚠️⚠️ THE HALF THAT MATTERS MOST. ⭐ If this fix could silence a genuinely missing order, it would be
  // worse than the fault it repairs — **so the reverse is asserted, in the same breath.**
  const st = healthy();
  const register = [
    { number: 7, order_code: "D4E5F6", issued_at: "2026-10-11T08:25:00.000Z" },
    { number: 12, order_code: "DE1F19", issued_at: "2026-10-11T08:25:00.000Z" },
  ];
  const r = resultOf(runChecks(st, { register }), "hasOrder");
  assert.equal(r.status, "fail",
    "★ a receipt whose number is on NO order was silenced by the new matching — that hides a real loss");
  assert.equal(r.detail.length, 1, "★ it does not name the receipt that is genuinely missing");
  assert.match(r.detail[0], /#DE1F19/, "★ the missing receipt's code is not named");
  assert.match(r.detail[0], /receipt #000012/,
    "★ the receipt NUMBER is not named — the one thing she can actually look up");
});

test("★ and a SPLIT order's number is read from the whole order, not from one row", () => {
  // ⚠️ v445's reason, kept: which row of a split order is first is not fixed, so one row may not know the
  // number. A receipt matched off a single row would go quiet for exactly those orders.
  const st = healthy();
  const first = st.orders[0];
  st.orders = [
    { ...first, id: "ord_a1b2c3d4e5f6", groupId: "group_g", receiptNo: 0 },   // this row does not know it
    { ...first, id: "ord_b1b2c3d4e5f6", groupId: "group_g", receiptNo: 7, deliveryDateId: "d1" },
  ];
  const register = [{ number: 7, order_code: "ZZZZZZ", issued_at: "2026-10-11T08:25:00.000Z" }];
  assert.equal(resultOf(runChecks(st, { register }), "hasOrder").status, "pass",
    "★ the receipt number was looked for on one row instead of the whole order");
});

// ── v471: the content comparison ─────────────────────────────────────────────
test("★★★ two copies of the SAME order holding different facts are FOUND — her #DE1F19 case", () => {
  // ⚠️⚠️ ASKED FOR AFTER THIS EXACT SCREEN: her **Mac passed** that receipt and her **phone failed it, on the
  // same version, with both reporting everything synced.** ⭐⭐ **The two checks above compare which records
  // EXIST; neither looks INSIDE them** — so a record present on both and different inside is invisible to
  // both. ⭐ **The Mac's copy carried the receipt number; the phone's did not.**
  const st = healthy();
  const payloads = sync.localPayloads(st);
  const cloudData = new Map(payloads);
  const orderKey = [...payloads.keys()].find((k) => k.startsWith("orders:"));
  assert.ok(orderKey, "the fixture has no order, so nothing below proves anything");
  // The shared data holds the same record — with a fact this phone's copy does NOT have.
  // ⚠️ The fixture's order already carries `receiptNo: 7`, so the cloud must differ in something else or
  // this test would be comparing a record with itself and proving nothing.
  cloudData.set(orderKey, JSON.stringify({ ...JSON.parse(payloads.get(orderKey)), receiptNo: 99 }));

  const cloud = { ok: true, keys: new Set(payloads.keys()), data: cloudData };
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), cloud, payloads, queued: new Set() }), "content");
  assert.equal(r.status, "fail", "★ two copies of one record that disagree were reported as fine");
  assert.deepEqual(r.detail, ["#D4E5F6"], "★ it does not name the record that disagrees");
  assert.match(r.why, /different facts/i, "the check does not say what is wrong");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
});

test("★★⚠️ and a change she has QUEUED is not reported — it is SUPPOSED to differ", () => {
  // ⚠️⚠️ WITHOUT THIS THE CHECK FIRES ON EVERY EDIT THE MOMENT SHE MAKES IT: a record waiting to be sent is
  // meant to differ from the shared data until it arrives. ⭐ The same shape as the shelf carve-out, and the
  // same reason — a warning that fires on something normal is one she learns to ignore.
  const st = healthy();
  const payloads = sync.localPayloads(st);
  const cloudData = new Map(payloads);
  const orderKey = [...payloads.keys()].find((k) => k.startsWith("orders:"));
  cloudData.set(orderKey, JSON.stringify({ ...JSON.parse(payloads.get(orderKey)), customerName: "Older" }));

  const cloud = { ok: true, keys: new Set(payloads.keys()), data: cloudData };
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), cloud, payloads, queued: new Set([orderKey]) }), "content");
  assert.equal(r.status, "pass",
    "★ a change she had queued but not sent was reported as a disagreement between the two phones");
});

test("★★ and `settings` is never compared — it carries what is true of ONE device", () => {
  // ⚠️ It is the one kind that holds per-device things, **which is why the app strips them before sending it
  // at all** — **comparing it would report every phone's settings as wrong, on every phone, for ever.**
  const st = healthy();
  const payloads = sync.localPayloads(st);
  const cloudData = new Map(payloads);
  const setKey = [...payloads.keys()].find((k) => k.startsWith("settings:"));
  assert.ok(setKey, "the fixture has no settings record, so this proves nothing");
  cloudData.set(setKey, "{}");   // a different phone's settings

  const cloud = { ok: true, keys: new Set(payloads.keys()), data: cloudData };
  assert.equal(resultOf(runHealthChecks(st, { ...emptyExtras(), cloud, payloads, queued: new Set() }), "content").status,
    "pass", "★ the settings record was compared, so every phone's settings would be reported as wrong");
});

test("★ and two sides that agree are reported plainly", () => {
  const st = healthy();
  const payloads = sync.localPayloads(st);
  const cloud = { ok: true, keys: new Set(payloads.keys()), data: new Map(payloads) };
  assert.equal(resultOf(runHealthChecks(st, { ...emptyExtras(), cloud, payloads, queued: new Set() }), "content").status,
    "pass", "two sides holding exactly the same facts were reported as disagreeing");
});

// ── v476: the waiting line names what is stuck, instead of counting it ───────
test("★★★ a stuck change is NAMED, not counted — the un-keyable one says so outright", () => {
  // ⚠️⚠️ HER REPORT: __"did the 2 changes clear after syncing v475, no"__ — ⭐ **and the page could say
  // "2 changes" and nothing else, so neither she nor I could see WHAT was stuck.**
  // ⭐ **A count she cannot look up is a number she cannot act on** — the rule every other check here
  // follows, and the one this check was breaking.
  const st = healthy();
  const orderKey = [...sync.localPayloads(st).keys()].find((k) => k.startsWith("orders:"));
  const queued = new Set([orderKey, "removedOrders:ord_aaaabbbbcccc"]);
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 2, queued }), "waiting");
  assert.equal(r.status, "fail");
  assert.equal(r.detail.length, 2, "★ the stuck changes are still just a count");
  assert.match(r.detail.join(" | "), /#D4E5F6/, "★ the stuck ORDER is not named");
  assert.match(r.detail.join(" | "), /removed order/i, "★ the stuck shelf row is not named");
  assert.doesNotMatch(r.detail.join(" | "), /^\d+ changes?$/,
    "★ it fell back to a bare count, which is the thing this fixes");
});

test("★★★ and each stuck change is named as the RECORD, not as its kind (v528)", () => {
  // ⚠️⚠️ HER REPORT: __"yes, look into the stuck records"__ — and __"more and more removed order shown on
  // phone"__. ⭐ **The page named them "a removed order" and "uoms": a KIND, not a record** — so neither she
  // nor I could find the thing that was stuck. ⭐ **A name she cannot look up is a name she cannot act on**,
  // which is the fault v476 fixed one step up and this finishes.
  const st = healthy();
  st.removedOrders = [{ id: "ord_a1b2c3d4e5f6", removedAt: "2026-10-11T10:47:00.000Z", customerName: "Peggy" }];
  st.uoms = [{ id: "uom_g", name: "g", family: "weight", toBase: 1 }];
  const queued = new Set(["removedOrders:ord_a1b2c3d4e5f6", "uoms:uom_g"]);
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 2, queued }), "waiting");
  assert.deepEqual(r.detail, ["a removed order #D4E5F6", "a unit g"],
    "★ a stuck change is not named as the record itself — **an order by the number she searches, and a unit "
    + "by the name she typed**");
});

test("★★★ and the page says WHY they did not go, and WHICH record was refused (v528)", () => {
  // ⚠️⚠️ **THE APP COULD COUNT THE STUCK CHANGES AND NAME THEM, AND COULD NOT SAY WHY** — it returned the
  // reason to whichever button pressed it and then forgot it. ⭐ **"No error" and "the number never moves"
  // were both true on the same phone, and nothing could join them.**
  const st = healthy();
  st.removedOrders = [{ id: "ord_a1b2c3d4e5f6", removedAt: "2026-10-11T10:47:00.000Z" }];
  const queued = new Set(["removedOrders:ord_a1b2c3d4e5f6"]);
  const lastFail = { at: "2026-10-17T02:00:00.000Z", reason: 'Push failed (HTTP 400) — {"code":"PGRST102"}', phase: "hand-over", key: "removedOrders:ord_a1b2c3d4e5f6" };
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 1, queued, lastFail }), "waiting");
  assert.match(r.why, /refused/i, "the page does not say the hand-over was refused");
  assert.match(r.why, /PGRST102/, "★ the server's own words are not shown — **she can hand me that line and nothing else has to be guessed**");
  assert.match(r.why, /a removed order #D4E5F6/,
    "★ the reason does not NAME the record that was refused — **the reason alone still leaves eight changes to hunt through**");
  // ⚠️ AND A PHONE THAT HAS NEVER FAILED SAYS NOTHING ABOUT FAILING — a reason that outlives its fault sends
  // her looking for something that has gone.
  const clean = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 1, queued }), "waiting");
  assert.doesNotMatch(clean.why, /refused/i, "a phone with no recorded failure claims one");
});

// ── v534: a save that fails must be recorded, and the room must be measured ──
test("★★★ a save that fails is RECORDED, not swallowed into a console she never sees", async () => {
  // ⚠️⚠️ THE FAULT: `save()` caught a full-phone error, wrote it to the console and CARRIED ON — and the
  // console is something she will never see. ⚠️ **Then it still queued the change, so "it saved" and "the
  // phone is full" were BOTH TRUE, silently.** ⭐ Same disease as the stuck queue, and a GROWTH fault that
  // only appears once the book is big.
  const st = await import("../admin/js/state.js");
  const real = globalThis.localStorage;
  let full = true;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {
      if (!full) return;
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      throw e;
    },
    removeItem() {},
  };
  try {
    st.resetSaveFailure();
    // ⚠️ AND IT MUST NOT THROW AT THE CALLER: every screen calls `save()` and none of them is ready for that.
    st.save(st.defaultState());
    const f = st.saveFailure();
    assert.ok(f, "★ a save that failed left NO record — **the change is gone and nothing on any screen says so**");
    assert.equal(f.name, "QuotaExceededError", "the record does not say what went wrong");
    assert.ok(f.at, "the record does not say when");

    // ⭐ AND A SAVE THAT WORKS CLEARS IT — a stale warning sends her looking for something that has gone.
    full = false;
    st.save(st.defaultState());
    assert.equal(st.saveFailure(), null, "★ a failure outlived a save that worked");
  } finally {
    if (real === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = real;
    st.resetSaveFailure();
  }
});

test("★★★ and the page reports it, in her words", () => {
  const r = resultOf(runHealthChecks(healthy(), {
    ...emptyExtras(),
    saveFail: { at: "2026-10-17T02:00:00.000Z", name: "QuotaExceededError", reason: "The quota has been exceeded." },
  }), "saved");
  assert.equal(r.status, "fail", "★ a phone that could not store her change reported that everything was fine");
  assert.match(r.why, /could not store/i, "the page does not say what happened");
  // ⭐ AND IT SAYS THE THING THAT IS TRUE AND REASSURING: the change still reached the shared data.
  assert.match(r.why, /shared data/i,
    "★ it does not say the change still reached the shared data — **that is the difference between a scare and a loss**");
  assert.ok(r.fix, "a fault with no way out is a dead end");
  // ⚠️ AND A PHONE WITH NO FAILURE SAYS NOTHING ABOUT ONE.
  assert.equal(resultOf(runHealthChecks(healthy(), { ...emptyExtras(), saveFail: null }), "saved").status, "pass",
    "a phone with no recorded failure claims one");
});

test("★★★ two ingredients sharing a NAME are named — the fault that made her doubt the screen (v544)", async () => {
  // ⚠️⚠️ HER CASE: __"last time there is 2 yeast, but i think i deleted it long time ago"__ — and then
  // __"it is not reliable"__. ⭐ **Two records called "Instant yeast", one at 70 g and one at 1.142 kg.**
  // ⚠️ **The stock card and the list row both read `onHand`, so an app can only show two figures for one name if
  // there are two ingredients** — ⭐ **and nothing stops a second one being made.** This is the same guard the
  // app already keeps for ORDERS, in a list that never had it.
  const st = healthy();
  st.uoms = [{ id: "g", name: "g", family: "weight", toBase: 1 },
    { id: "kg", name: "kg", family: "weight", toBase: 1000 }];
  st.ingredients = [
    { id: "i1", name: "Instant yeast", active: true, unit: "g", uomId: "g", onHand: 70 },
    { id: "i2", name: "instant yeast ", active: true, unit: "g", uomId: "g", onHand: 1142 },   // ⚠️ case and spacing must not hide it
    { id: "i3", name: "Strong flour", active: true },
  ];
  const r = resultOf(runHealthChecks(st, emptyExtras()), "dupeIngredient");
  assert.equal(r.status, "fail", "★ two ingredients with one name were reported as fine");
  // ★★★ AND IT SAYS WHICH CARD IS WHICH (v564). ⚠️ Her report: __"on hand show 0, but open up the stock
  // card says on hand 6kgs"__ — ⭐ **"×2" is true and useless; the amounts and the recipe use are what let
  // her decide which one to keep.**
  assert.equal(r.detail.length, 1);
  assert.match(r.detail[0], /Instant yeast ×2/, "★ it does not name the ingredient");
  assert.match(r.detail[0], /70 g/, "★ it does not say what one card holds");
  assert.match(r.detail[0], /1\.142 kg/, "★ it does not say what the other holds");
  assert.match(r.detail[0], /no recipe uses this one/,
    "★ it does not say which card a recipe points at, so she cannot tell which to keep");
  assert.match(r.fix, /hide|delete/i, "a fault with no way out is a dead end");

  // ⭐ AND WHEN HER OWN RECIPES SETTLE IT, THERE IS A PRESS. One recipe points at i1, so i2 is the spare.
  const withRecipe = JSON.parse(JSON.stringify(st));
  withRecipe.products = [{ id: "p1", name: "Focaccia", active: true, recipe: [{ ingredientId: "i1", qty: 5, unit: "g" }] }];
  const r2 = resultOf(runHealthChecks(withRecipe, emptyExtras()), "dupeIngredient");
  assert.equal(r2.repair, "dupeIngredient",
    "★ the pair is decided by her recipes and the check offers no press to put the spare away");
  assert.match(r2.detail[0], /used in 1 recipe/);
  // ⚠️ And hiding the spare leaves the used one alone.
  const { duplicateIngredientPlan } = await import("../admin/js/state.js");
  const plan = duplicateIngredientPlan(withRecipe);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].hide.id, "i2", "★ the press picked the card her recipe DOES use");
  assert.equal(plan[0].keep.id, "i1");
  // ⚠️⚠️ AND IT MAY NOT TAKE 1.142 kg OFF THE LISTS WITHOUT A WORD (v580). ⚠️ The measured case: the card
  // a recipe uses holds 70 g, the spare holds 1.142 kg — ⭐ **and the press hid the 1.142 kg card, naming no
  // amount.** ⭐ It now refuses, names the stock, and says the two stocktakes that settle it.
  assert.match(hideSparesBlocked(withRecipe, plan), /instant yeast \(the spare\) holds 1\.142 kg/i,
    "★ the card holding the stock is hidden and nothing says how much stock that takes off the lists");
  assert.match(hideSparesBlocked(withRecipe, plan), /Count Instant yeast, the card your recipes use/i,
    "★ it names no way to settle the stock");
  const empty = JSON.parse(JSON.stringify(withRecipe));
  empty.ingredients[1].onHand = 0;
  assert.equal(hideSparesBlocked(empty, duplicateIngredientPlan(empty)), "",
    "★ a spare holding nothing is refused too — the press that should work on a clean pair stopped working");

  // ⚠️⚠️ AND A HIDDEN CARD IS NOT A LIVE DUPLICATE (v564). ⭐ Hiding the spare is the resolution this
  // check recommends, so counting hidden records left the line red after its own press had run.
  const hid = healthy();
  hid.ingredients = [
    { id: "i1", name: "Strong flour", active: true, onHand: 100 },
    { id: "i2", name: "Strong flour", active: false, onHand: 0 },
  ];
  assert.equal(resultOf(runHealthChecks(hid, emptyExtras()), "dupeIngredient").status, "pass",
    "★ the spare was hidden and the check still calls a duplicate — **its own press cannot clear it**");

  // ⭐ AND A NORMAL KITCHEN DOES NOT GET FLAGGED.
  const clean = healthy();
  clean.ingredients = [{ id: "i1", name: "Instant yeast", active: true }, { id: "i2", name: "Flour", active: true }];
  assert.equal(resultOf(runHealthChecks(clean, emptyExtras()), "dupeIngredient").status, "pass");
});

test("★★★ a recipe pointing at a HIDDEN ingredient is named — it is used and never topped up (v544)", () => {
  // ⚠️⚠️ HER OWN CASE. She believed she had deleted a second "Instant yeast"; ⭐ **the app HIDES an ingredient a
  // recipe uses rather than deleting it**, and **a hidden ingredient keeps its stock figure** — so two numbers
  // lived on, one belonging to nothing she could see.
  // ⚠️ **THE RISK BEHIND IT:** a bake still TAKES a hidden ingredient off the shelf, but the shopping list tops
  // up only ACTIVE ones — ⭐ **so if a recipe points at the hidden one, it is used on every bake and never
  // appears on a list again. It would run out and nothing would say so.**
  const withRecipe = (ingredientId) => {
    const st = healthy();
    st.ingredients = [
      { id: "i_live", name: "Instant yeast", active: true },
      { id: "i_hid", name: "Instant yeast", active: false },
    ];
    st.products[0].recipe = [{ ingredientId, qty: 11, unit: "g" }];
    return st;
  };

  const bad = resultOf(runHealthChecks(withRecipe("i_hid"), emptyExtras()), "hiddenUsed");
  assert.equal(bad.status, "fail", "★ a recipe pointing at a hidden ingredient was reported as fine");
  assert.deepEqual(bad.detail, ["Focaccia → Instant yeast"],
    "★ it does not name the product and the ingredient, so she cannot go and fix it");
  assert.match(bad.fix, /recipe/, "a fault with no way out is a dead end");

  // ⭐ AND THE SAME RECIPE ON THE LIVE ONE IS FINE — the check must not cry wolf on an ordinary kitchen.
  assert.equal(resultOf(runHealthChecks(withRecipe("i_live"), emptyExtras()), "hiddenUsed").status, "pass",
    "★ a recipe pointing at a LIVE ingredient was flagged");
});

test("★★★ and how much room the data takes is MEASURED — and only a red X when it is nearly full", () => {
  // ⭐ Her question: __"any risky system handling that we should eliminate before the database builds up"__.
  // ⚠️ A red X a year early is the warning she learns to ignore, so it PASSES with the number showing until
  // the phone is nearly full.
  const room = (state) => localChecks(state).find((x) => x.id === "room");
  const small = room(healthy());
  assert.equal(small.status, "pass", "an ordinary small book was reported as a storage problem");
  assert.match(String(small.detail), /MB of about/, "★ the pass does not show the number, so the growth is invisible");

  // ⚠️ A book that really is nearly full — measured, not simulated: one long note is enough to cross the line.
  const big = healthy();
  big.orders = [{ ...big.orders[0], note: "x".repeat(Math.ceil(PHONE_STORE_LIMIT * 0.9)) }];
  const full = room(big);
  assert.equal(full.status, "fail",
    "★ a book past the phone's limit reported that there was room — **that is the silent stop, found too late**");
  assert.ok(full.fix, "a fault with no way out is a dead end");
});

test("★★⚠️ and a record with NO number says so — the shape that cannot travel", () => {
  // ⭐ **An order with no number of its own is exactly what cannot be sent, and it is INVISIBLE in a
  // count.** ⚠️ It is the shape that broke her sync in the first place, so it has to be able to say its
  // own name rather than hiding inside "2 changes".
  const st = healthy();
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 1, queued: new Set(["orders:undefined"]) }), "waiting");
  assert.deepEqual(r.detail, ["an order with no number"],
    "★ a record that has no name said nothing useful about itself");
});


// ── how many records the shared data holds (17 October 2026) ───────────────
test("★★★ the record count says how close the shared data is to the pull's hard cap", () => {
  // ⚠️ THE PULL IS ONE CAPPED REQUEST with no paging, so this number is the only warning she can get
  // before records stop reaching a phone.
  // ⭐ THE COUNT IS INFORMATION NOW, NOT A SENTENCE ABOUT A CAP — the pull pages, so a book of any size
  // reaches a phone. ⚠️ **It fails only at the reader's own hard stop, and that number is IMPORTED, so the
  // sentence and the loop cannot disagree.**
  const [under] = recordCountCheck({ ok: true, count: 412, atLeast: false });
  assert.equal(under.status, "pass", "★ an ordinary book was not reported as healthy");
  assert.match(under.title, /412/, "★ the number she asked for is not in the sentence");
  assert.match(under.title, /every phone/i, "it does not say that all of them arrive");

  const [over] = recordCountCheck({ ok: true, count: 100000, atLeast: false });
  assert.equal(over.status, "fail", "★ a book past the reader's hard stop passed — records would stop arriving in silence");
  assert.match(over.title, /100000/, "the number is not in the sentence");
  assert.match(over.fix, /changed|pages|paging/i, "the way out does not name the next repair");

  const [huge] = recordCountCheck({ ok: true, count: 100000, atLeast: true });
  assert.equal(huge.status, "fail");
  assert.match(huge.title, /at least 100000/, "★ a count it could not finish was reported as an exact number");

  const [off] = recordCountCheck({ ok: false, reason: "Offline — counting needs your shared data." });
  assert.equal(off.status, "skipped", "★ an unreadable count must be SKIPPED, never a pass");
});


test("★★★ two orders on one order number are NAMED — the code that two customers would share", () => {
  // ⚠️⚠️ The code is six hex characters of the order's own id — about 3% by 1,000 orders — and the shared
  // data keys the tracking card AND the receipt register by it. ⭐ Two orders on one code would share one
  // tracking card and one receipt number, so this must be a sentence on her screen, not a silent merge.
  const st = healthy();
  const base = st.orders[0];
  st.orders = [
    { ...base, id: "ord_123456aaaaaa1a2b3c", groupId: "" },
    { ...base, id: "ord_987654bbbbbb1a2b3c", groupId: "" },
  ];
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "dupCode");
  assert.equal(r.status, "fail",
    "★ two orders wearing one number were not reported — **their tracking card and receipt number are the same**");
  assert.deepEqual(r.detail, ["#1A2B3C"], "★ the check does not name the number to look up");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
});

test("★★★ a stock card whose rows do not add up to the shelf is NAMED — her own strong flour", () => {
  // ⚠️⚠️ HER CARD, VERBATIM: eight rows summing to +14 kg under an "On hand" of 10 kg, with two identical
  // "0 g to 10 kg" stocktakes and two identical "Baked extra — 2 ×" rows. ⭐ **The amount at the top is
  // right; the history over-counts** — the fingerprint of one action recorded on two phones.
  const st = healthy();
  // ⚠️ The units decide how the figures are WORDED — without them the check would print raw base amounts,
  // and this test would be asserting a format the app never shows her.
  st.uoms = [{ id: "g", name: "g", family: "weight", toBase: 1 },
    { id: "kg", name: "kg", family: "weight", toBase: 1000 }];
  st.ingredients = [{ id: "i1", name: "Strong flour", unit: "kg", uomId: "kg", onHand: 10000,
    stockLog: [
      { delta: -6000 }, { delta: 10000 }, { delta: 10000 }, { delta: -5000 },
      { delta: 5000 }, { delta: -1000 }, { delta: -1000 }, { delta: 2000 },
    ] }];
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "stockAddsUp");
  assert.equal(r.status, "fail",
    "★ her card's rows add to 14 kg under a shelf of 10 kg and the check said nothing");
  assert.match(String(r.detail[0]), /Strong flour/, "★ the check does not name the ingredient");
  assert.match(String(r.detail[0]), /14 kg/, "★ it does not say what the rows add to");
  assert.match(String(r.detail[0]), /10 kg/, "★ it does not say what the shelf holds");
  // ⭐ AND THE WAY OUT MUST NOT BE THE ✕ — removing a duplicated row would take 10 kg off a shelf that
  // never gained it.
  assert.match(r.fix, /DO NOT remove|Do NOT remove/, "the check does not warn against the ✕");
  // ★★★ AND THERE IS A PRESS THAT CLEARS IT (v563). ⚠️ Before it, this check could never go green on her
  // own book: a stocktake sets the same amount and changes the sum by nothing.
  assert.equal(r.repair, "stockCards",
    "★ the check names a fault with no press to fix it — **a check she can only read is one she cannot clear**");
});

test("★★★ the press actually CLEARS it — and tells the truth about which of the two it was", async () => {
  // ⚠️⚠️ HER EIGHT CARDS WERE TWO DIFFERENT STORIES. One over-counted (strong flour); seven counted LESS
  // than the shelf, because the amount was on it before the card kept a history. The old sentence told
  // all eight the over-count story.
  const { reconcileCards } = await import("../admin/js/stock.js");
  const st = healthy();
  st.uoms = [{ id: "g", name: "g", family: "weight", toBase: 1 },
    { id: "kg", name: "kg", family: "weight", toBase: 1000 }];
  st.ingredients = [
    { id: "i1", name: "Strong flour", unit: "kg", uomId: "kg", onHand: 10000,
      stockLog: [{ delta: 10000 }, { delta: 10000 }, { delta: -6000 }] },
    { id: "i2", name: "Sea salt", unit: "g", uomId: "g", onHand: 100,
      stockLog: [{ delta: -460 }] },
  ];
  const before = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "stockAddsUp");
  assert.equal(before.status, "fail", "precondition");

  const out = reconcileCards(st);
  assert.equal(out.done.length, 2);

  const after = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "stockAddsUp");
  assert.equal(after.status, "pass",
    "★★ the press ran and the check STILL fails — **she would press it and see the same red line**");
  // ⭐ AND HER SHELVES DID NOT MOVE.
  assert.deepEqual(st.ingredients.map((i) => i.onHand), [10000, 100],
    "★★ the repair moved a shelf — it may only write the missing line");
  // ⭐ Both stories are said, because both happened.
  assert.match(before.why, /MORE than the shelf/);
  assert.match(before.why, /LESS than the shelf/);
});

test("★★★ a cloud that could not be read in full is SKIPPED, never judged (v569)", () => {
  // ⚠️⚠️ THE FAULT THIS PREVENTS: the comparison read was ONE request capped at 1,000 rows, so past that the
  // page would name every record beyond an arbitrary thousand as "on this phone and NOT in your shared
  // data" — permanently. ⭐ A partial read now says it could not look, on all three cloud checks.
  const st = healthy();
  const partial = { ok: true, keys: new Set(["orders:x"]), data: new Map([["orders:x", "{}"]]), complete: false };
  for (const id of ["reached", "cloudOnly", "content"]) {
    const r = resultOf(runHealthChecks(st, { ...emptyExtras(), cloud: partial }), id);
    assert.equal(r.status, "skipped",
      `★ "${id}" judged a cloud read that did not finish — **a partial cloud looks exactly like a missing record**`);
  }
});

test("★★ and a card with too many movements to add up is SKIPPED, never passed", async () => {
  const st = healthy();
  const { STOCK_LOG_CAP } = await import("../admin/js/stock.js");
  st.ingredients = [{ id: "i1", name: "Flour", unit: "g", uomId: "g", onHand: 0,
    stockLog: Array.from({ length: STOCK_LOG_CAP }, () => ({ delta: 1 })) }];
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "stockAddsUp");
  assert.equal(r.status, "skipped",
    "★ a stock card whose oldest rows are gone was reported as ADDING UP — **nobody could have looked**");
});

test("★★★ a change still in the queue is not reported as missing from the cloud (v573)", () => {
  // ⚠️ A record edited a moment ago is queued, not lost — and a record DELETED a moment ago is still in the
  // cloud until its tombstone lands. ⭐ Both used to raise a second red X beside `waiting`, which already
  // reports the queue once.
  const st = healthy();
  const cloud = { ok: true, keys: new Set(["orders:ord_old"]), data: new Map(), complete: true };
  const local = ["orders:ord_old", "orders:ord_new"];
  const queued = new Set(["orders:ord_new"]);
  assert.equal(resultOf(runHealthChecks(st, { ...emptyExtras(), cloud, local, queued }), "reached").status,
    "pass", "★ a queued change was reported as not having reached the shared data");
  const gone = { ...cloud, keys: new Set(["orders:ord_old", "orders:ord_zapped"]), data: new Map([["orders:ord_zapped", "{}"]]) };
  assert.equal(resultOf(runHealthChecks(st, { ...emptyExtras(), cloud: gone, local: ["orders:ord_old"], queued: new Set(["orders:ord_zapped"]) }), "cloudOnly").status,
    "pass", "★ a deletion still in the queue was reported as a record in the cloud that is not on this phone");
});

// ── v600: an empty value and a missing one are one fact ──────────────────

test("★★★ the line-agreement check stops calling a missing value and an empty one different (v600)", () => {
  // ⚠️⚠️ MEASURED: `promo: ""` on one line and no `promo` on the other both mean NO CODE, but
  // `JSON.stringify` reported a disagreement for ever — ⚠️ **a check she could never clear, which teaches her
  // to ignore the line.** ⭐ `false` and `0` must stay distinct: a line saying NOT PAID still disagrees.
  const mk = (a, b) => ({
    settings: { currency: "RM" }, products: [], deliveryDates: [], removedOrders: [],
    orders: [
      { id: "a", groupId: "g", qty: 1, unitPrice: 1, ...a },
      { id: "b", groupId: "g", qty: 1, unitPrice: 1, ...b },
    ],
  });
  const agree = (st) => localChecks(st).find((c) => c.id === "agree");
  assert.equal(agree(mk({ promo: "" }, {})).status, "pass",
    "★ an empty code and a missing code are still reported as a disagreement");
  assert.equal(agree(mk({ promo: null }, {})).status, "pass", "null and missing are one fact too");
  assert.equal(agree(mk({ promo: "SAVE5" }, {})).status, "fail",
    "★ a real difference was hidden — the check no longer reports anything");
  assert.equal(agree(mk({ paidReceived: false }, {})).status, "fail",
    "★ false was treated as empty — a line saying NOT PAID no longer disagrees");
});

// ── v604: a refund in the register that the order is not carrying ────────

test("★★★ a refund in the REGISTER that the order is not carrying is NAMED (v604)", () => {
  // ⚠️⚠️ THE SAME WIPE THAT TOOK A RECEIPT NUMBER TAKES A REFUND. ⚠️ A record travels whole, so a newer copy
  // of an order that never learned about a refund removes the mark — ⚠️ **and Money and Profit then read that
  // money as still in her hand.** ⭐ The register is the record that survives, exactly as it is for the
  // number beside it.
  const st = healthy();
  const refunded = [{ ...REGISTER[0], refunded_at: "2026-10-12T09:00:00.000Z", refunded_amount: 8 }];
  const r = resultOf(runChecks(st, { register: refunded, copies: COPIES }), "refunded");
  assert.ok(r, "★ there is no refund check at all");
  assert.equal(r.status, "fail",
    "★ a refund recorded in the register and missing from its order was not reported");
  assert.deepEqual(r.detail, ["#D4E5F6 · refund #000007"], "★ the check does not name which refund");
  assert.ok(r.fix, "★ a fault with no way out is a dead end");

  const marked = healthy();
  marked.orders = marked.orders.map((o) => ({ ...o, refundedAt: "2026-10-12T09:00:00.000Z" }));
  assert.equal(resultOf(runChecks(marked, { register: refunded, copies: COPIES }), "refunded").status,
    "pass", "★ an order that carries its own refund mark was reported as missing it");
});

test("★★⚠️ and a refund she TOOK BACK is never reported — the register is what speaks (v604)", () => {
  // ⚠️ This is why the check reads the REGISTER and not the order: `unrefund_receipt` clears `refunded_at`
  // there, so an undone refund never reaches the loop. A check that read the order would have to guess
  // between "never knew" and "was undone".
  const st = healthy();
  assert.equal(resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "refunded").status,
    "pass", "★ a register row with no refund was reported as one");
  const elsewhere = [{ ...REGISTER[0], order_code: "ZZZZZZ", refunded_at: "2026-10-12T09:00:00.000Z" }];
  assert.equal(resultOf(runChecks(st, { register: elsewhere, copies: COPIES }), "refunded").status,
    "pass", "★ a receipt for an order this phone does not hold was blamed on this check");
});

test("★★★ the missing receipt stamps come with a one-press repair, naming the orders (v613)", () => {
  // ⚠️ Fourteen orders is not fourteen presses. ⭐ The check carries the ids of the rows to repair; the press
  // uses the Invoice card's own claim, which returns the register's number — never a new one.
  const st = healthy();
  delete st.orders[0].receiptNo;
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "carried");
  assert.equal(r.status, "fail", "precondition: the missing number was not reported");
  assert.equal(r.repair, "receiptStamps", "★ no one-press repair was offered");
  assert.deepEqual(r.repairIds, ["ord_a1b2c3d4e5f6"], "★ the repair does not name the order to fix");
});

test("★★★ the repair press claims the SAME number through the Invoice path (v613)", () => {
  const src = readFileSync(new URL("../admin/js/views/health.js", import.meta.url), "utf8");
  assert.match(src, /repairReceiptStamps\(r\.repairIds\)/, "★ the button does not start the repair");
  assert.match(src, /await claimReceipt\(state, row, \{ force: true \}\)/,
    "★ the repair does not force the register's number over a disagreeing one");
  assert.match(src, /the same number, never a new one/i, "★ the confirmation does not say it cannot issue a number");
});

test("★★★ orders with no bake day come with a one-press removal, naming them (v625)", () => {
  // ⚠️ Her words: "now remove them" — after opening each one, they are old test rows. ⭐ The check carries
  // their ids; the press names every code, and the removal goes to the Removed list (30 days), not into nothing.
  const st = healthy();
  delete st.orders[0].deliveryDateId;
  delete st.orders[0].deliveryDate;
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "day");
  assert.equal(r.status, "fail", "precondition: an orphan was not reported");
  assert.equal(r.repair, "orphanOrders", "★ no one-press removal was offered");
  assert.deepEqual(r.repairIds, ["ord_a1b2c3d4e5f6"], "★ the removal does not name the order");

  const ok = resultOf(runChecks(healthy(), { register: REGISTER, copies: COPIES }), "day");
  assert.equal(ok.status, "pass", "a placed order was reported as lost");
});

test("★★★ the orphan removal asks first and uses the shelf's own removal (v625)", () => {
  const src = readFileSync(new URL("../admin/js/views/health.js", import.meta.url), "utf8");
  assert.match(src, /removeOrphans\(r\.repairIds\)/, "★ the button does not start the removal");
  assert.match(src, /removeOrders\(state, todo, "removed from Check my system"\)/,
    "★ the removal does not use the shelf");
  assert.match(src, /codes\.join\("  "\)/, "★ the confirmation does not name the orders");
});
