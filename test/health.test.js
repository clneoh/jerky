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

const { runHealthChecks, localChecks, registerChecks, copyChecks, backupChecks } = await import("../admin/js/health.js");
const sync = await import("../admin/js/sync.js");

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
  payloads: sync.localPayloads(state),
  queued: new Set(),
  waiting: 0,
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
  assert.equal(res.total, 15, `the check list is no longer fifteen checks (it is ${res.total})`);
  assert.equal(res.passedChecks, 15);
  assert.equal(res.failed, 0);
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
  assert.match(r.why, /48 hours/,
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

test("★ an order not on any delivery date FAILS — the order that is invisible", () => {
  const st = healthy();
  st.orders[0].deliveryDateId = "d_gone";
  const r = resultOf(runChecks(st, { register: REGISTER, copies: COPIES }), "day");
  assert.equal(r.status, "fail", "★ an order no delivery date can show was not reported");
  // ⚠️ ASSERTIONS ON USER-VISIBLE COPY → jerky's admin says "delivery date".
  assert.match(r.fix, /delivery date/, "the check does not say what she can do about it");
});

test("★★⚠️ A CHECK THAT COULD NOT RUN IS SKIPPED — IT IS NEVER A PASS", () => {
  // ⚠️⚠️ THE RULE THIS MODULE IS BUILT ON, and the register's own oldest rule: an unreadable register must
  // never be drawn as an empty one. **A verdict that counted "I could not look" as "it is fine" is worse
  // than no verdict**, because she would stop looking.
  const res = runHealthChecks(healthy(), { register: null, copies: null });
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
  assert.equal(res.passedChecks, 8, "a skipped check was counted among the passes");
  assert.equal(res.skippedChecks, 7, "the skipped checks were not counted separately");
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
  assert.equal(res.total, 15, "the checks did not all run on an empty book");
  assert.equal(localChecks(bare).length, 7, "the local checks are not seven");
  assert.equal(registerChecks(bare, []).length, 2, "the register checks are not two");
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
  assert.ok(r.fix, "★ a fault with no way out is a dead end");
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

test("★★⚠️ and a record with NO number says so — the shape that cannot travel", () => {
  // ⭐ **An order with no number of its own is exactly what cannot be sent, and it is INVISIBLE in a
  // count.** ⚠️ It is the shape that broke her sync in the first place, so it has to be able to say its
  // own name rather than hiding inside "2 changes".
  const st = healthy();
  const r = resultOf(runHealthChecks(st, { ...emptyExtras(), waiting: 1, queued: new Set(["orders:undefined"]) }), "waiting");
  assert.deepEqual(r.detail, ["an order with no number"],
    "★ a record that has no name said nothing useful about itself");
});
