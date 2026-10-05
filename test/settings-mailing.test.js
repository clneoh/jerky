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

// Every sentence the address card prints, which is the user-visible text of the
// card and nothing else: the JSX-ish string literals inside the block, up to the
// NEXT section's own banner comment.
//
// ⚠️ **THE CARD WAS RENAMED "Your address" IN v315, AND THE OLD ANCHORS BOTH MOVED.**
// It used to be "Mailing labels (courier)" and to sit immediately above a
// "── Courier ──" block that has since left Settings for its own screen. So the
// slice now ends at the next banner rather than at a named neighbour — a helper
// that names the card after it breaks every time a card moves, and this test's
// subject is the ADDRESS, not what happens to be filed beside it.
// ⚠️ **COMMENTS COME OUT FIRST, AND THAT IS NOT FASTIDIOUSNESS.** The moment this
// card's own banner quoted the old name — `Called "Mailing labels (courier)"` — the
// helper started reading the COMMENT as card text and reported the card as claiming
// something it does not. What this function wants is what the card SAYS TO HER, and
// a comment is not that.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function mailingCardText() {

  // ⚠️ THE SECTION IS FOUND BY ITS BANNER, AND THE BANNER IS A COMMENT — so the
  // split happens on the RAW source (the banner is the delimiter) and only the chosen
  // block is then stripped. Stripping first would take the divider with it.
  //
  // ⚠️ **AND IT ENDS AT THE NEXT DECLARATION, NOT ONLY AT THE NEXT BANNER (v315).**
  // The card's two neighbours in Settings both left for screens of their own, and
  // their banners went with them — so the address section ran on into the cloud card
  // below, and this test read "anon public key" as something the ADDRESS card says.
  // A card ends where the next one begins.
  const at = settingsSrc.indexOf("const mailingCard = ");
  assert.ok(at > -1, "the address card was not found in settings.js — it may have been renamed or moved again");
  const rest = settingsSrc.slice(at);
  const stop = rest.search(/\n  const /); // the next card's declaration, or the end
  const block = stop > -1 ? rest.slice(0, stop) : rest;
  // ⚠️ THE STRING MAY NOT CROSS A LINE. Without the `\n` here the pattern runs from
  // one quote to the next quote ANYWHERE below it, so it read code as card text and
  // reported the card as saying things it does not. Every string this card prints is
  // written on one line.
  return stripComments(block).match(/"([^"\\\n]{20,})"/g).map((s) => s.slice(1, -1)).join("\n");

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

test("the address card names every job it does, not just the label (v315)", () => {
  // ★ WHY IT KEPT ITS PLACE IN SETTINGS. Given the choice, she said "Rename it, keep
  // it in Settings" — but the card had been called "Mailing labels (courier)", and
  // that name was wrong: ONE address feeds the parcel label's FROM, the bakery's own
  // door for the van, **the letterhead on every invoice** (v293), and the from line
  // on the wish-list email. Called a courier thing, an invoice with the wrong heading
  // would have sent her looking under deliveries.
  //
  // So the card must NAME all four. This is the assertion that stops it drifting back
  // into being a label card with an address in it.
  const said = mailingCardText();
  for (const [what, re] of [
    ["the parcel label", /parcel label/i],
    ["the courier's door", /courier collects from/i],
    ["the invoice letterhead", /invoice/i],
    ["the wish-list email", /wish-list email/i],
  ]) {
    assert.match(said, re, `the address card no longer says it is used on ${what}`);
  }
});

test("the address card never claims to be published with the storefront (v206)", () => {
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
