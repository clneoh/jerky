// test/v591-repairs.test.js — the seams a Node test cannot drive, pinned at the source.
//
// ⚠️ EVERY CHECK HERE IS A SOURCE/MARKUP CHECK AND IS NAMED AS ONE. The live-region behaviour itself is
// the browser's; what this file holds is that the markup the app SHIPS carries it. The focus trap, the
// switch naming, the register's void press, the import guard, the offline press and the PIN pause are all
// driven for real in ui.test.js, field-names.test.js, receipt-register-view.test.js, backups.test.js,
// app.test.js and app.test.js respectively.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ a dialog's answers are announced, not only painted (v591)", () => {
  // ⚠️⚠️ MEASURED: `#confirm-msg`, `#track-result`, `#promo-say` and `#menu-note` were plain divs with no
  // live region — ⚠️ **a blind customer pressed Track or Place order, the answer appeared, and nothing was
  // spoken.** ⭐ Each is a status region, so its words are announced when they change.
  const html = read("store/index.html");
  for (const id of ["confirm-msg", "track-result", "promo-say", "menu-note"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `#${id} is gone from the shop`);
    const tagStart = html.lastIndexOf("<", at);
    const tagEnd = html.indexOf(">", at);
    assert.match(html.slice(tagStart, tagEnd), /role="status"/,
      `★ #${id} is not a live region — **its answer is never spoken to a screen reader**`);
  }
});

test("★★★ the review's thank-you is a live region that takes focus (v591)", () => {
  const html = read("index.html");
  const at = html.indexOf('id="review-thanks"');
  assert.ok(at > 0, "the review thanks is gone from the homepage");
  assert.match(html.slice(html.lastIndexOf("<", at), html.indexOf(">", at)), /role="status"/,
    "★ the thanks is a silent div — **a customer does not know their review was sent**");
  // And the view moves focus into it, because the Send button it replaces was the focused element.
  const src = read("reviews.js");
  assert.match(src, /thanks\.setAttribute\("tabindex", "-1"\); thanks\.focus\(/,
    "★ the thanks is shown but focus stays on the hidden form");
});

test("★★ the PIN's anchor is in the page (v591)", () => {
  // ⚠️ The app now builds the lock when this is missing (v589), so a typo no longer opens the door — but
  // the element is the lock screen's own home, and a silent substitute is a fault worth seeing.
  assert.match(read("admin/index.html"), /id="lock-layer"/, "★ admin/index.html has no #lock-layer");
});

test("★★ an unreadable EasyParcel reply is UNKNOWN for a booking (v591)", () => {
  // ⚠️ SOURCE CHECK: `ask` is private to the Deno function and Node cannot press it. ⚠️ A fault page after
  // a booking that may already have been accepted left the Book press live unless the flag is set.
  const src = read("supabase/functions/parcel/index.ts");
  const at = src.indexOf("non-JSON reply from");
  assert.ok(at > 0, "the non-JSON branch moved — this check is watching nothing");
  assert.match(src.slice(at, at + 700), /unknown: true/,
    "★ an unreadable parcel booking reply is reported as an ordinary refusal");
});
