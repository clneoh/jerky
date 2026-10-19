// test/v595-repairs.test.js — seams a Node test cannot drive, pinned at the source.
//
// ⚠️ EVERY CHECK HERE IS A SOURCE CHECK AND IS NAMED AS ONE. The behaviour behind each is driven elsewhere:
// the damaged book in sync.test.js, the edit-refund stamp in order-stage-whole-order.test.js, the shelf
// redaction in profiles.test.js, the homepage product and the unit rename in state.test.js, the float-noise
// pack in purchasing.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ the shop's change-method question keeps focus on the SAFE answer (v595)", () => {
  // ⚠️ SOURCE CHECK: the store shims have no focus. ⚠️ A late `go.focus()` overrode the safe focus — Enter
  // straight after the question cleared the customer's address and place.
  const src = read("store/app.js");
  assert.equal(/if \(go\.focus\) go\.focus\(\)/.test(src), false,
    "★ the destructive Change press takes focus again — **Enter confirms the loss by accident**");
  assert.match(src, /keep\.focus\(\{ preventScroll: true \}\)/,
    "the safe answer no longer takes focus at all");
});

test("★★★ a failed tracking look-up is not reported as 'no such order' (v595)", () => {
  // ⚠️ SOURCE CHECK: the fetch path is inside the shop closure. ⚠️ A 404/500/429 read as "we couldn't find
  // that order with that phone number" — the customer was blamed for the service being down.
  const src = read("store/app.js");
  assert.match(src, /if \(!res\.ok\) \{\s*\n\s*lastTrack = \{ kind: "unavailable"/,
    "★ a failed tracking request is still shown as an order that does not exist");
});

test("★★★ the shop re-reads 'today' on every repaint (v595)", () => {
  const src = read("store/app.js");
  assert.match(src, /let todayKey = dateKey\(new Date\(\)\);/, "todayKey is fixed at load again");
  assert.match(src, /const rerender = \(\) => \{\s*\n\s*todayKey = dateKey\(new Date\(\)\);/,
    "★ a page redrawn at midnight keeps counting close-days from yesterday");
});

test("★★★ no courier or parcel reply can be mistaken for a refusal on a booking (v595)", () => {
  const courier = read("supabase/functions/courier/index.ts");
  assert.match(courier, /if \(out\.data == null\) \{[\s\S]{0,200}unknown: true/,
    "★ a 2xx with no trip back is answered as success or a plain refusal");
  const lala = read("supabase/functions/courier/providers/lalamove.ts");
  const at = lala.indexOf("const timedOut =");
  assert.ok(at > 0, "the Lalamove catch moved — this check is watching nothing");
  assert.match(lala.slice(at, at + 900), /unknown: true,/,
    "★ a failed send other than a timeout is a plain refusal");
  const parcel = read("supabase/functions/parcel/index.ts");
  assert.match(parcel, /if \(res\.status >= 500\) \{[\s\S]{0,250}unknown: true/,
    "★ a gateway 5xx is read as a business answer");
  const api = read("admin/js/parcels/api.js");
  assert.match(api, /res\.status >= 500 \? \{ unknown: true \}/,
    "★ a platform 5xx from the parcel function leaves the Book press live");
});
