// test/parcel-unknown.test.js — a BOOKING whose reply never came (v561).
//
// ⚠️⚠️ WHY THIS FILE EXISTS. Booking a parcel with EasyParcel both CREATES the parcel and TAKES THE MONEY,
// in one call. So a timeout is not "nothing happened" — it is "this app does not know". ⭐ The old code told
// her "check your signal and try again", which is the one instruction that can charge her twice. ⭐ So the
// answer carries `unknown`, and the screen takes the Book press away.
//
// ⚠️ The wrapper is the only thing in this app that knows whether a call was a book, so the rule lives here
// and is asserted on the REAL `callParcel`, against a stubbed network and a stubbed token — not on a copy of
// its logic.

import { test } from "node:test";
import assert from "node:assert/strict";

const { callParcel, parcelRates, parcelBook } = await import("../admin/js/parcels/api.js");

const TOKEN_KEY = "bakeadmin.supabase";

function withPhone(fetchFn, run) {
  const realFetch = globalThis.fetch;
  const realStore = globalThis.localStorage;
  const store = new Map([[TOKEN_KEY, JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600e3 })]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  globalThis.fetch = fetchFn;
  const state = { settings: { supabase: { url: "https://example.supabase.co" } } };
  try { return run(state); } finally {
    globalThis.fetch = realFetch;
    if (realStore === undefined) delete globalThis.localStorage; else globalThis.localStorage = realStore;
  }
}

const aborts = () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };

test("★★★ a booking that timed out says it CANNOT TELL, and never says try again", async () => {
  // ⚠️⚠️ MEASURED BEFORE THE FIX: the timeout answer for a book was the same "Check your signal and try
  // again" as a price lookup — a sentence that invites a second booking and a second charge.
  const out = await withPhone(aborts, (state) => parcelBook(state, { rateId: "r1" }));
  assert.equal(out.ok, false, "precondition: the call did not report a problem");
  assert.equal(out.unknown, true,
    "★ a timed-out BOOKING does not say its outcome is unknown — **the screen cannot tell her to stop, and "
    + "a second Book may be charged twice**");
  assert.match(out.reason, /may charge you twice/,
    "★ the words do not warn about the second charge: " + out.reason);
  assert.doesNotMatch(out.reason, /try again/,
    "★★ the one instruction that must never be given on a lost booking — " + out.reason);
});

test("★★★ the same timeout on a PRICE lookup is not unknown, and does say try again", async () => {
  // ⭐ The rule is about the MONEY, not about timeouts: pricing charges nothing, so it keeps the old sentence.
  const out = await withPhone(aborts, (state) => parcelRates(state, { parcel: {} }));
  assert.equal(out.ok, false, "precondition");
  assert.equal(out.unknown, undefined,
    "★ a price lookup was marked unknown — **she is sent to check EasyParcel for a parcel nobody booked**");
  assert.match(out.reason, /try again/);
});

test("★★★ a dropped connection while booking is also unknown", async () => {
  // ⚠️ An abort is not the only way the reply is lost — a phone losing signal mid-call throws a plain error.
  const drop = () => { throw new Error("Failed to fetch"); };
  const out = await withPhone(drop, (state) => parcelBook(state, { rateId: "r1" }));
  assert.equal(out.unknown, true,
    "★ a dropped connection during booking was treated as a safe failure — **the parcel may already be "
    + "booked and charged**");
  assert.match(out.reason, /may charge you twice/);
});

test("★★★ the SERVER's own unknown verdict passes straight through to the phone", async () => {
  // ⭐ The function answers 200 with `{ ok:false, unknown:true }` when ITS call to EasyParcel timed out, and
  // the wrapper returns the body unchanged — so this is what the screen reads. ⚠️ Asserted so a future
  // `return { ok:false, reason }` rewrite here cannot quietly drop the flag.
  const said = { ok: false, unknown: true, reason: "EasyParcel did not answer in time …" };
  const ok = () => ({ ok: true, json: async () => said });
  const out = await withPhone(ok, (state) => callParcel(state, { action: "book" }));
  assert.equal(out.unknown, true, "★ the server's unknown verdict was lost on the way to the screen");
});
