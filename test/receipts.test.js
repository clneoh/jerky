// test/receipts.test.js — the receipt's own serial number (v360).
//
// ⚠️ WHY THIS FILE IS SHORT AND EVERY ASSERTION IS POINTED. The COUNTER is not here — it
// lives in the database (`supabase/receipts.sql`), because a run of receipt numbers is a
// shared counter and two phones keeping one on themselves would either collide or leave a
// gap. What is tested here is everything this app decides: **what it prints**, **when it may
// claim at all**, and **that a second press consumes nothing.**
//
// The rule this exists for: above RM150,000 of gross takings in twelve months, receipts must
// be serially numbered (Income Tax Act 1967, s.82(1)(b)).

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the smallest storage the token reader needs ──────────────────────────────
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
// ⚠️ A LIVE SESSION IS SEEDED, so the claiming code never tries to log in — a test that let
// it would be measuring the auth flow instead of the number.
globalThis.localStorage.setItem("bakeadmin.supabase",
  JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600000 }));

const { receiptNoOf, receiptLabel, receiptLine, isRefunded, receiptStatus,
  copyKnowsCode, lastSeenIn, registerRows, registerSummary, voidedIndex } = await import("../admin/js/receipts.js");
const { claimReceipt, pullReceiptRegister } = await import("../admin/js/supabase.js");
const { journalSheet } = await import("../admin/js/journal.js");
const { orderCode } = await import("../admin/js/state.js");

const stateWith = () => ({
  settings: {
    currency: "RM",
    supabase: { enabled: true, url: "https://proj.supabase.co", anonKey: "anon",
      email: "a@b.c", password: "p" },
  },
  orders: [],
});
const paidUnnumbered = () => ({ id: "ord_1", groupId: "ordg_1", paidReceived: true });

// ── what the paper says ──────────────────────────────────────────────────────

test("a serial is padded so a register reads as a column, and never invented", () => {
  assert.equal(receiptNoOf({ receiptNo: 123 }), "000123");
  assert.equal(receiptNoOf({ receiptNo: 1 }), "000001");
  // ⚠️ THE ONE THAT MATTERS: an order with no number answers "" and NOT "#000000", because a
  // zero would be this app inventing a receipt the books do not have.
  assert.equal(receiptNoOf({}), "");
  assert.equal(receiptNoOf({ receiptNo: 0 }), "");
  assert.equal(receiptNoOf({ receiptNo: null }), "");
  assert.equal(receiptNoOf({ receiptNo: "nonsense" }), "");
  assert.equal(receiptNoOf(null), "");
});

test("the receipt line carries BOTH numbers, because each does a different job", () => {
  // The serial proves the sequence has no gaps; the order code is what finds the order again.
  assert.equal(receiptLine({ receiptNo: 123 }, "A3F9C2"), "Receipt #000123 · Order #A3F9C2");
  assert.equal(receiptLine({ receiptNo: 123 }, ""), "Receipt #000123");
  assert.equal(receiptLine({}, "A3F9C2"), "", "no number yet means no line, not half a line");
  assert.equal(receiptLabel({ receiptNo: 123 }), "Receipt #000123");
});

test("no number is not a blank — it says WHY, and the two reasons read differently", () => {
  // Paid but unclaimed: the number could not be DRAWN from her own register. This is the state
  // a phone with no signal leaves behind, and she has to be able to tell it from the other one.
  // ⚠️ JERKY SAYS 'YOUR RECEIPT REGISTER', NOT 'THE BAKERY'S RECORDS' — the bakery's word
  // cannot be jerky's (this app is not a bakery, and the panel is her own book).
  const paid = receiptStatus({ paidReceived: true });
  assert.match(paid, /the number could not be drawn from your receipt register/);
  // ⚠️ AND IT MUST NOT BLAME THE ORDER (v365). It used to read "this order has not reached
  // the register", which is false in the ordinary case — the order is right there on
  // the screen — and doubly false for an order paid before the feature existed. The thing
  // that has not happened is the drawing of the NUMBER.
  assert.equal(/order has not reached/.test(paid), false,
    `the paid line blames the order rather than the number: "${paid}"`);
  // Not paid at all: a receipt number is for money received, so there is nothing to be late.
  const unpaid = receiptStatus({ paidReceived: false });
  assert.match(unpaid, /issued when the money is recorded/);
  // And when there IS a number, the status is simply the number.
  assert.equal(receiptStatus({ paidReceived: true, receiptNo: 7 }), "Receipt #000007");
});

test("a refund is marked, and the number stays", () => {
  const o = { paidReceived: true, receiptNo: 7, refundedAt: "2026-10-07T00:00:00.000Z" };
  assert.equal(isRefunded(o), true);
  assert.equal(receiptStatus(o), "Receipt #000007 — refunded");
  // ⚠️ THE NUMBER IS STILL THERE. Deleting it would leave the gap the sequence exists to prevent.
  assert.equal(receiptNoOf(o), "000007", "a refund never takes the number away");
});

test("the sheet carries the serial and the note, and every other journal passes neither", () => {
  const s = journalSheet({ title: "Invoice #A3F9C2", receipt: "Receipt #000123 · Order #A3F9C2" });
  assert.equal(s.receipt, "Receipt #000123 · Order #A3F9C2");
  assert.equal(s.receiptNote, "", "nothing to explain when there IS a number");
  const n = journalSheet({ title: "Invoice #A3F9C2", receiptNote: "No receipt number yet — reason." });
  assert.equal(n.receipt, "");
  assert.match(n.receiptNote, /No receipt number yet/);
  // A journal that knows nothing about receipts draws neither line.
  const plain = journalSheet({ title: "Money" });
  assert.equal(plain.receipt, "");
  assert.equal(plain.receiptNote, "");
});

// ── when the number may be claimed at all ────────────────────────────────────

test("★ an order that has not been PAID is never given a number, and the server is not asked", async () => {
  const st = stateWith();
  const order = { id: "ord_1", groupId: "ordg_1", paidReceived: false };
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => [] }; };

  assert.equal(await claimReceipt(st, order), false, "no number for money that has not arrived");
  assert.equal(calls, 0, "★ AND IT IS NOT EVEN ASKED — a receipt is for money received");
  assert.equal(order.receiptNo, undefined);
});

test("★ an order that already has its number asks for nothing — a reprint consumes nothing", async () => {
  const st = stateWith();
  const order = { ...paidUnnumbered(), receiptNo: 123 };
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => [] }; };

  assert.equal(await claimReceipt(st, order), true, "it already has one");
  assert.equal(calls, 0, "★ no network at all — so printing it ten times cannot burn ten numbers");
  assert.equal(order.receiptNo, 123, "and the number it has is the number it keeps");
});

test("a paid order claims its number, and NAMES THE ORDER rather than the press", async () => {
  const st = stateWith();
  const order = paidUnnumbered();
  let seen = null;
  globalThis.fetch = async (url, opts) => {
    seen = { url: String(url), body: JSON.parse(opts.body) };
    return { ok: true, json: async () => [{ number: 123, refunded_at: null }] };
  };

  assert.equal(await claimReceipt(st, order), true);
  assert.match(seen.url, /\/rest\/v1\/rpc\/claim_receipt_number$/, "it asks the claiming function");
  assert.equal(seen.body.p_order_code, orderCode(order),
    "★ the ORDER is named — which is what makes a second press return the same number");
  assert.equal(order.receiptNo, 123, "and the number the server handed back is the one stored");
});

test("a refund comes back as a MARK, and only ever adds one", async () => {
  const st = stateWith();
  const order = paidUnnumbered();
  globalThis.fetch = async () => ({ ok: true,
    json: async () => [{ number: 9, refunded_at: "2026-10-07T00:00:00.000Z" }] });

  await claimReceipt(st, order);
  assert.equal(order.receiptNo, 9);
  assert.equal(order.refundedAt, "2026-10-07T00:00:00.000Z",
    "a phone that has never seen the refund learns about it here");
});

test("a claim that CANNOT be made leaves the order unnumbered rather than half-done", async () => {
  const st = stateWith();
  const order = paidUnnumbered();
  globalThis.fetch = async () => { throw new Error("no signal"); };

  assert.equal(await claimReceipt(st, order), false);
  // ⚠️ NOTHING IS GUESSED. There is no local fallback counter anywhere in this feature — a
  // made-up number is worse than a missing one, because a missing one can be claimed later
  // and a made-up one can never be un-made.
  assert.equal(order.receiptNo, undefined, "no local counter, and no invented number");
});

test("with the cloud switched off entirely, nothing is claimed and nothing is invented", async () => {
  const st = stateWith();
  st.settings.supabase.enabled = false;
  const order = paidUnnumbered();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => [] }; };

  assert.equal(await claimReceipt(st, order), false);
  assert.equal(calls, 0, "an app running without shared data has no receipts register to draw from");
  assert.equal(order.receiptNo, undefined);
});

// ── ★★ v366: the run itself ─────────────────────────────────────────────────
//
// What an auditor asks to see is not one receipt — it is THE RUN: every number, in order,
// nothing missing, nothing used twice. These are the two things only the register can see.

const raw = (n, code, extra = {}) => ({
  number: n, order_code: code, issued_at: `2026-10-0${(n % 9) + 1}T0${n % 9}:15:00.000Z`,
  refunded_at: null, ...extra,
});

test("★ the register is a COLUMN: sorted by number, padded, and never re-ordered", () => {
  const reg = registerRows([raw(3, "BBBBBB"), raw(1, "AAAAAA"), raw(2, "CCCCCC")], []);
  assert.deepEqual(reg.rows.map((r) => r.no), ["000001", "000002", "000003"],
    "the run is not in number order — which is the only order a register can be read in");
  assert.deepEqual(reg.rows.map((r) => r.code), ["AAAAAA", "CCCCCC", "BBBBBB"]);
  assert.equal(reg.first, 1);
  assert.equal(reg.last, 3);
  assert.equal(reg.count, 3);
});

test("★★ a MISSING number is found — in the middle AND at the head", () => {
  // The middle gap: #000002 was drawn and never issued.
  const mid = registerRows([raw(1, "AAAAAA"), raw(3, "BBBBBB")], []);
  assert.deepEqual(mid.gaps, [2], `a hole in the run was not reported: ${JSON.stringify(mid.gaps)}`);
  assert.match(registerSummary(mid), /MISSING/);
  assert.match(registerSummary(mid), /#000002/, "the summary does not name the missing number");

  // ⚠️ AND THE HEAD IS A GAP TOO. The sequence starts at 1, so a first row of #000004 means
  // three receipts are unaccounted for — and a check that only walked between rows would
  // call that run perfectly clean.
  const head = registerRows([raw(4, "AAAAAA")], []);
  assert.deepEqual(head.gaps, [1, 2, 3],
    `missing numbers before the first row were not reported: ${JSON.stringify(head.gaps)}`);
});

test("a clean run says so, in words, rather than staying silent", () => {
  const reg = registerRows([raw(1, "AAAAAA"), raw(2, "BBBBBB"), raw(3, "CCCCCC")], []);
  assert.deepEqual(reg.gaps, []);
  assert.match(registerSummary(reg), /unbroken/,
    "a run with no holes says nothing at all, so a reader cannot tell clean from unchecked");
  assert.match(registerSummary(reg), /#000001 to #000003/);
  assert.equal(registerSummary(registerRows([], [])), "No receipt has been issued yet.");
});

test("★ a receipt whose order is gone is MARKED, and its number is untouched", () => {
  // ⚠️ THIS IS THE CASE SHE FOUND BY DOING IT: a paid order removed, its number still spent.
  // The register must show it rather than quietly omitting a row it cannot name.
  const st = stateWith();
  const here = { id: "o_c2fda5", groupId: "o_c2fda5", customerName: "Uncle Tan" };
  const reg = registerRows([raw(1, "C2FDA5"), raw(2, "999999")], [here]);

  assert.equal(reg.rows[0].orphan, false);
  assert.equal(reg.rows[0].order, here, "an order that IS here is not joined to its receipt");
  assert.equal(reg.rows[1].orphan, true, "a receipt with no order behind it is not marked");
  assert.equal(reg.notOnThisPhone, 1);
  assert.equal(reg.rows[1].number, 2, "the number of a void receipt was altered");
  assert.match(registerSummary(reg), /no longer on this phone/);
});

test("★★ a receipt written before the order was GROUPED still finds it (v441)", () => {
  // ⚠️⚠️ THE FAULT THIS ANSWERS, AND IT WAS LIVE ON HER PHONE. A one-item order has no groupId, so
  // its code was drawn from its own id. **Giving it a second item invented a group name, and the
  // code was redrawn from that** — so a receipt already written kept the old code and the register
  // read "not in this phone's orders" for ever, **about an order that was still there.** Verified on
  // a real screen: one item `#1`, a second item added, `#55568B`. Her words: __"it is a unique
  // identify of an order … like giving a key to a customer."__
  // ⭐ v441 stops the code moving; this is the other half — the rows already written under the old
  // code find their order again.
  const moved = { id: "ord_c2fda5", groupId: "ordg_111111", customerName: "LK Lucy" };
  const reg = registerRows([raw(1, "C2FDA5")], [moved]);
  assert.equal(reg.rows[0].orphan, false,
    "★ a receipt holding the code the order wore before it was grouped is still reported as void");
  assert.equal(reg.rows[0].order, moved, "the old code did not reach the order it belongs to");
  assert.equal(reg.notOnThisPhone, 0);
  assert.doesNotMatch(registerSummary(reg), /no longer on this phone/);

  // ⚠️⚠️ AND AN OLD CODE NEVER OUTRANKS A CODE AN ORDER WEARS TODAY. The six characters are random,
  // so an alias can collide with another order's LIVE code — and a historical row stealing a live
  // one would be the same fault pointing the other way. Every current code is claimed first, and a
  // second pass that could overwrite would need the alias pass to run last to show it: ⚠️ **so the
  // order of the two orders below is the test.** `other` is listed FIRST, which puts `moved`'s alias
  // last of all — the one position from which overwriting would steal a live code.
  const other = { id: "ord_00c2fda5", customerName: "Peggy" };  // its live code IS C2FDA5
  const reg2 = registerRows([raw(1, "C2FDA5")], [other, moved]);
  assert.equal(reg2.rows[0].order, other,
    "★ an order's own live code was taken by another order's historical alias");
  assert.equal(reg2.rows[0].orphan, false);
});

test("★★ 'when was it last here' looks for BOTH numbers and stops at the newest copy (v443)", () => {
  // ⚠️⚠️ THE QUESTION THE REGISTER COULD ONLY POSE. "Not in this phone's orders" is true of an order she
  // removed on purpose, an order a fault swept away, and an order this phone never had — three different
  // problems in one sentence. On 11 Oct 2026 three paid receipts sat like that and nobody could say which.
  // ⭐ The press looks through her own saved copies and answers when the order was still there.
  const moved = { id: "ord_c2fda5", groupId: "ordg_111111" };  // wears #111111, wore #C2FDA5
  const plain = { id: "ord_aaaaaa" };

  // ⚠️ BOTH NUMBERS ARE LOOKED FOR — the one it wears today, and the one it wore before it was grouped.
  assert.equal(copyKnowsCode([moved], "111111"), true, "the number the order wears TODAY was not looked for");
  assert.equal(copyKnowsCode([moved], "C2FDA5"), true, "the number it wore BEFORE it was grouped was not looked for");
  assert.equal(copyKnowsCode([moved], "ABCDEF"), false, "a copy was credited with an order it never held");
  assert.equal(copyKnowsCode([moved], "??????"), false, "the placeholder was treated as a real number");
  assert.equal(copyKnowsCode([], "C2FDA5"), false);

  const older = { label: "Weekly", createdAt: "2026-10-09T07:00:00.000Z", orders: [moved] };
  const newest = { label: "Daily", createdAt: "2026-10-11T08:20:00.000Z", orders: [plain] };

  // ⚠️⚠️ AND THE ANSWER IS A *WINDOW*, NOT A MOMENT — her own instruction: __"you should say that something
  // entered abt 8am, is deleted later in the afternoon, by me or by the system error itself"__. One time
  // would read as the moment it vanished, which the app cannot know. **Two copies bracket it.**
  const w = lastSeenIn([newest, older], "C2FDA5");
  assert.equal(w.hit, older, "★ the search did not reach the copy that still holds the order");
  assert.equal(w.goneBy, newest,
    "★ the window is open-ended — the copy that shows it was ALREADY gone was not found");
  // ⭐ AND WHEN THE NEWEST COPY ITSELF STILL HAS IT, THERE IS NO UPPER EDGE — it left after that copy.
  const only = lastSeenIn([{ ...newest, orders: [moved] }, older], "C2FDA5");
  assert.equal(only.hit.createdAt, newest.createdAt, "★ the answer was taken from an older copy than needed");
  assert.equal(only.goneBy, null, "★ an upper edge was invented out of a copy that still holds the order");
  // ⚠️ AND AN ORDER IN NO COPY AT ALL SAYS SO rather than being handed a copy at random.
  assert.deepEqual(lastSeenIn([newest, older], "ABCDEF"), { hit: null, goneBy: null });
  assert.deepEqual(lastSeenIn([], "ABCDEF"), { hit: null, goneBy: null });
});

test("★★ a receipt she has declared VOID is marked, not deleted — and stops counting (v448)", () => {
  // ⚠️⚠️ HER WORDS: __"can you have me to clear the invoice, or rearrange it, ok for me in this software
  // trial stage"__ ⭐ **AND THE ANSWER IS MARK, NEVER DELETE.** The number stays spent and the row stays on
  // the page — a register you can edit is not a register, and this one exists because she once removed a
  // paid order and watched `#000001` stay spent.
  const st = stateWith();
  const raw2 = [raw(1, "C2FDA5"), raw(9, "D06D27")];
  const before = registerRows(raw2, []);
  assert.equal(before.notOnThisPhone, 2, "the fixture did not start with two unaccounted receipts");
  assert.equal(before.rows.length, 2);

  const voided = [{ no: 9, code: "D06D27", at: "2026-10-12T09:00:00.000Z", reason: "trial order" }];
  const after = registerRows(raw2, [], voided);
  // ⚠️ THE ROW IS STILL THERE. A count that dropped because the row vanished would be the delete this
  // whole screen exists to refuse.
  assert.equal(after.rows.length, 2, "★ a voided receipt was removed from the run");
  assert.equal(after.rows[1].no, "000009", "the run was re-ordered by the void mark");
  assert.equal(after.rows[1].orphan, true, "the row stopped saying it has no order behind it");
  // ⭐ AND IT IS NO LONGER COUNTED AS UNACCOUNTED FOR — the decision is recorded, so it is not a mystery.
  assert.equal(after.notOnThisPhone, 1, "★ a receipt she has explained was still counted as unexplained");
  assert.equal(after.voided, 1, "the void decision was not counted");
  assert.match(after.rows[1].voided.reason, /trial/, "her reason was not carried onto the row");
  assert.equal(registerSummary(after).includes("no longer on this phone"), true,
    "the headline does not mention the remaining one at all");
  // ⚠️ AND IT IS KEYED ON THE NUMBER, so a void mark cannot land on a different receipt by a code clash.
  assert.equal(voidedIndex(voided).get(9).reason, "trial order");
  assert.equal(voidedIndex(voided).get(1), undefined);
  assert.equal(voidedIndex(null).size, 0, "a missing void list threw rather than reading as none");
});

test("a refunded receipt keeps its row, its number, and wears its mark", () => {
  const reg = registerRows([raw(1, "AAAAAA"), raw(2, "BBBBBB", { refunded_at: "2026-10-08T00:00:00.000Z" })], []);
  assert.equal(reg.count, 2, "a refunded receipt was dropped from the run");
  assert.equal(reg.refunded, 1);
  assert.equal(reg.rows[1].no, "000002");
  assert.match(registerSummary(reg), /1 marked refunded/);
});

test("junk in the register is dropped, not drawn as a receipt", () => {
  const reg = registerRows([raw(1, "AAAAAA"), null, { number: 0 }, { number: -4 }, raw(2, "BBBBBB")], []);
  assert.deepEqual(reg.rows.map((r) => r.no), ["000001", "000002"],
    "a row with no usable number was drawn as a receipt the books do not have");
  assert.deepEqual(reg.gaps, [], "junk was mistaken for a missing number");
});

// ── reading it from the cloud ────────────────────────────────────────────────

test("★ an unreadable register is NEVER reported as an empty one", async () => {
  // ⚠️ THE ONE MISTAKE THAT WOULD MATTER HERE. An empty register and an unreachable one look
  // identical on screen and mean opposite things — "no receipts exist" versus "I could not
  // ask". Every failure path must say `ok: false` so the screen can say which.
  const st = stateWith();
  const answers = [
    async () => { throw new Error("no signal"); },
    async () => ({ ok: false, json: async () => [] }),
    async () => ({ ok: true, json: async () => ({ not: "an array" }) }),
  ];
  for (const f of answers) {
    globalThis.fetch = f;
    const r = await pullReceiptRegister(st);
    assert.equal(r.ok, false, "an unreadable register was reported as a successful read");
    assert.deepEqual(r.rows, []);
  }
  // And with the cloud off there is no request at all.
  st.settings.supabase.enabled = false;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => [] }; };
  assert.equal((await pullReceiptRegister(st)).ok, false);
  assert.equal(calls, 0, "the register was asked for with the cloud switched off");
});

test("the register is read from the receipts table, oldest number first", async () => {
  const st = stateWith();
  let seen = null;
  globalThis.fetch = async (url) => {
    seen = String(url);
    return { ok: true, json: async () => [raw(1, "AAAAAA")] };
  };
  const r = await pullReceiptRegister(st);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.match(seen, /\/rest\/v1\/receipt_numbers\?/, "the register was not read from the receipts table");
  assert.match(seen, /order=number\.asc/, "the run was asked for in an order a register cannot be read in");
});
