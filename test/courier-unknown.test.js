// test/courier-unknown.test.js — a BOOKING whose reply never came (v566).
//
// ⚠️⚠️ WHY THIS FILE EXISTS. Booking a Lalamove trip spends real money and puts a real vehicle on a real
// road, and the edge function has no timeout of its own — so the browser giving up at 25 seconds can leave
// a trip **already booked and already charged**. ⭐ The wrapper used to answer "check your signal and try
// again" for every action, which is the one instruction that books and pays a second time.
//
// ⭐ The rule is the parcel channel's (v561), and it lives in the REAL `callCourier`, against a stubbed
// network and a stubbed token — not in a copy of its logic.

import { test } from "node:test";
import assert from "node:assert/strict";

const { callCourier } = await import("../admin/js/couriers/api.js");

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
  const out = await withPhone(aborts, (state) => callCourier(state, { action: "book", payload: {} }));
  assert.equal(out.ok, false, "precondition");
  assert.equal(out.unknown, true,
    "★ a timed-out BOOKING does not say its outcome is unknown — **the screen leaves Book live, and a "
    + "second press books and pays a second time**");
  assert.match(out.reason, /may charge you twice/);
  assert.doesNotMatch(out.reason, /try again/,
    "★★ the one instruction that must never be given on a lost booking — " + out.reason);
});

test("★★★ the same timeout on a price lookup is not unknown, and does say try again", async () => {
  const out = await withPhone(aborts, (state) => callCourier(state, { action: "quote", payload: {} }));
  assert.equal(out.ok, false);
  assert.equal(out.unknown, undefined, "a price lookup was marked unknown — nothing was booked to check");
  assert.match(out.reason, /try again/);
});

test("★★★ a dropped connection while booking is also unknown", async () => {
  const drop = () => { throw new Error("Failed to fetch"); };
  const out = await withPhone(drop, (state) => callCourier(state, { action: "book", payload: {} }));
  assert.equal(out.unknown, true,
    "★ a dropped connection during booking was treated as a safe failure — the trip may exist");
  assert.match(out.reason, /may charge you twice/);
});

test("★★★ and the channel never names the vendor, so a second courier can sit beside it", async () => {
  // ⚠️ The provider guard in test/courier-provider.test.js fails on any live file but the registry and the
  // provider that spells the courier's name. ⭐ This is the same rule, asserted where the sentence is built.
  const out = await withPhone(aborts, (state) => callCourier(state, { action: "book", payload: {} }));
  assert.doesNotMatch(out.reason, /Lalamove/i,
    "★ the shared channel names one vendor — the courier registry is the only place allowed to");
});
