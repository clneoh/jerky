// test/settings-mailing.test.js — the mailing-address card must agree with the
// settings that actually travel (v206, 27 Sep 2026).
//
// The card under More → Settings → Mailing labels (post) told her, for six
// versions after it stopped being true, to "type it on each phone you print
// labels from". Since v200 the mailing address is one of the keys `sync.js`
// carries between her phones, so that sentence was asking her to do work the
// app had already taken over — and the manual had said "type it once, it
// FOLLOWS you" the whole time. Two files disagreed about one fact and nothing
// on the screen could show it.
//
// This is a source-reading test rather than a mounted screen, and deliberately:
// the fault is not in how the card draws, it is in the card and `sync.js`
// disagreeing. So both files are read and held against each other, and it goes
// red in EITHER direction — re-adding the per-phone sentence while the key
// still travels, or taking the key out of the carried list while the card still
// promises it travels. Neither can happen quietly again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsSrc = readFileSync(new URL("../admin/js/views/settings.js", import.meta.url), "utf8");
const syncSrc = readFileSync(new URL("../admin/js/sync.js", import.meta.url), "utf8");

// The list of keys `sync.js` carries, read out of the source the way the app
// reads it: the array literal handed to `GUARDED`. A key in here reaches her
// other phone, so a card may not ask her to type it on each one.
function carriedKeys() {
  const m = syncSrc.match(/const GUARDED = \[([^\]]*)\]/);
  assert.ok(m, "sync.js's GUARDED list was not found — this test reads it by name");
  return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

// Every sentence the mailing card prints, which is the user-visible text of the
// card and nothing else: the JSX-ish string literals inside the "Mailing labels
// (courier)" block, up to the next section's own comment.
function mailingCardText() {
  const start = settingsSrc.indexOf("── Mailing labels (post) ──");
  assert.ok(start > -1, "the mailing-labels section was not found in settings.js");
  // The block runs to the NEXT section heading, not to a named one: this app's
  // Settings screen keeps its own cards (Postage, Website & developer) between the
  // mailing card and Courier, so naming the far end would swallow three cards that
  // have nothing to do with the mailing address.
  const rest = settingsSrc.slice(start);
  const end = rest.indexOf("\n  // ── ", 10);
  const block = end > -1 ? rest.slice(0, end) : rest;
  return block.match(/"([^"\\]{20,})"/g).map((s) => s.slice(1, -1)).join("\n");
}

test("the mailing card and the carried settings agree that the address travels (v206)", () => {
  const travels = carriedKeys().includes("mailingAddress");
  const said = mailingCardText();

  assert.ok(said.length > 0, "no user-visible text was read from the mailing card at all");

  if (travels) {
    assert.doesNotMatch(said, /each phone you print/i,
      "the card asks her to type it on each phone, but sync.js carries mailingAddress to all of them");
    assert.match(said, /travels to your other phones/,
      "the card must say the address travels, because sync.js carries it");
  } else {
    assert.match(said, /each phone you print/i,
      "mailingAddress is no longer carried, so the card must warn her to type it per phone");
  }
});

test("the mailing card never claims to be published with the storefront (v206)", () => {
  // The other half of the same fact, and the one that would be the real
  // problem: this address is HER bakery's, held in settings. Anything on this
  // card saying it is published — or that the customer sees it before the
  // parcel arrives — would be wrong in a way that costs her, not a wording slip.
  const said = mailingCardText();
  assert.doesNotMatch(said, /publish|storefront|public/i,
    "the mailing address is held in her settings and is not published anywhere");
  assert.match(said, /FROM = this address/,
    "and the card still says what the label prints, which is its whole job");
});
