// test/v587-repairs.test.js — the seams a Node test cannot drive, pinned at the source.
//
// ⚠️⚠️ EVERY CHECK HERE IS A SOURCE CHECK, AND IS NAMED AS ONE. The edge functions run on Deno, and the two
// screens it names are built inside pop-ups driven by their own harnesses. What this file can hold is the
// WIRING — the flag that has to be passed, stamped or read — and each assertion names the change it catches.
// The behavioural halves of v587 (paying/refunding a two-day order, the sync merge, the paged list, the pack's
// pieces) are driven elsewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ an UNKNOWN booking is passed from the vendor through the function to the app (v587)", () => {
  // ⚠️⚠️ MEASURED: the v585 timeouts turned a hung vendor into an ordinary refusal — ⚠️ **the Book press stayed
  // live under a trip that might already be booked, and a second press could charge twice.**
  const provider = read("supabase/functions/courier/providers/lalamove.ts");
  // ⚠️ v595 widened this: ANY failed send is unknown for a booking (a reset after the POST left says nothing
  // about whether the trip was created). ⭐ The flag, not the words, is what locks the Book press.
  assert.match(provider, /unknown: true,\n\s+reason: timedOut/,
    "★ a failed Lalamove send does not carry `unknown` — the words alone lock no button");
  const fn = read("supabase/functions/courier/index.ts");
  assert.match(fn, /\.\.\.\(out\.unknown \? \{ unknown: true \} : \{\}\)/,
    "★ the courier function drops the vendor's `unknown` before answering the app");

  const run = read("admin/js/views/delivery_run.js");
  // ⚠️ v599: the run also WRITES the fact onto its orders, so a reopened screen stays locked.
  assert.match(run, /if \(out\.unknown\) \{/,
    "★ the Delivery run reads the flag and does not keep the fact");
  assert.match(run, /o\.courierUnknownAt = at;/,
    "★ the run's unknown is memory only — **reopening the screen resurrects every Book press**");
  assert.match(run, /busy \|\| bookUnknown/,
    "★ the run's Book press is still offered under an unknown trip — **a second booking may be charged twice**");

  const card = read("admin/js/views/courier_quote.js");
  assert.match(card, /Boolean\(first && first\.courierUnknownAt\)/,
    "★ the order card's unknown flag is memory only — a repaint brings every Book press back");
  assert.match(card, /first\.courierUnknownAt = new Date\(\)\.toISOString\(\)/,
    "★ an unknown booking is never stamped onto the order");
});

test("★★★ a lost parcel reply is UNKNOWN, and the status check cannot report success (v587)", () => {
  const parcel = read("supabase/functions/parcel/index.ts");
  assert.match(parcel, /return \{ ok: false, unknown: true, reason: "Couldn't reach EasyParcel\." \};/,
    "★ a connection that drops after the request left is reported as a plain refusal");
  assert.match(parcel, /if \(out\.unknown\) \{\n      return json\(\{ ok: false, unknown: true,/,
    "★ the order-status check falls through to ok:true when EasyParcel did not answer");
});

test("★★★ the wish-list mail cannot hang (v587)", () => {
  const src = read("supabase/functions/wish-mail/index.ts");
  assert.match(src, /signal: AbortSignal\.timeout\(10_000\)/,
    "★ the Resend send has no timeout — a hung vendor holds the invocation after the caller has given up");
});

test("★★★ the repay press reports the cards it cannot fix (v587)", () => {
  const src = read("admin/js/views/health.js");
  assert.match(src, /else if \(out\.skipped\.length\)/,
    "★ a card the repair skips is still met with 'Every card already adds up'");
  assert.match(src, /at the \$\{STOCK_LOG_CAP\}-row limit/,
    "★ the press does not say WHY a red card could not be put in step");
});

test("★★★ the review thanks are decided before the photo is cleared (v587)", () => {
  const src = read("reviews.js");
  const decide = src.indexOf('const thanksState = photo ? "sent"');
  const clear = src.indexOf("clearPicked();", decide);
  assert.ok(decide > 0 && clear > decide,
    "★ the thanks are worked out AFTER clearPicked() — **'the picture did not upload' can never be said**");
});
