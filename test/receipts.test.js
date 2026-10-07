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

const { receiptNoOf, receiptLabel, receiptLine, isRefunded, receiptStatus } =
  await import("../admin/js/receipts.js");
const { claimReceipt } = await import("../admin/js/supabase.js");
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
  // Paid but unclaimed: the claim has not reached the bakery's records. This is the state a
  // phone with no signal leaves behind, and she has to be able to tell it from the other one.
  const paid = receiptStatus({ paidReceived: true });
  assert.match(paid, /has not reached the bakery's records/);
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
