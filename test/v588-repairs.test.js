// test/v588-repairs.test.js — the second sweep's layout, print and accessibility seams.
//
// ⚠️⚠️ SOURCE CHECKS, NAMED AS SUCH. A PDF's wrapped lines and a stylesheet's print rules cannot be driven from
// Node here, and the shop's markup is static. The behavioural halves of v588 (the homepage price, the neutral
// after-order reset) are driven in home-facts.test.js and store.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ⚠️ The invoice PDF's wrapped address is driven for real in pdf.test.js — the bytes are read back there.

test("★★★ the two app strips never print on a sheet (v588)", () => {
  const css = read("admin/css/print.css");
  assert.match(css, /#share-warn,\s*#update-bar\s*\{\s*display:\s*none\s*!important;\s*\}/,
    "★ the 'Not sharing' strip and the 'New version ready' bar still print on a purchase order or register");
  assert.match(css, /body\.label-print \.label-preview-wrap \.warn\s*\{\s*display:\s*none\s*!important;\s*\}/,
    "★ the preview's own warning still prints on the parcel label");
});

test("★★★ the shop's fulfilment question names its group (v588)", () => {
  const html = read("store/index.html");
  assert.doesNotMatch(html, /<label[^>]*data-i18n="howGet"/,
    "★ a <label> with no for= names nothing — the same fault v583 fixed on the homepage");
  assert.match(html, /id="fulfil-label"[^>]*data-i18n="howGet"/,
    "★ the question has no id for a group to point at");
  assert.match(html, /id="fulfillment"[^>]*aria-labelledby="fulfil-label"/,
    "★ the two cards are not named by their question");
});

test("★★★ a chosen language is said in words, on all three surfaces (v588)", () => {
  for (const [file, why] of [
    ["home.js", "the homepage's site language"],
    ["reviews.js", "the review form's language"],
    ["store/app.js", "the shop's language"],
  ]) {
    const src = read(file);
    assert.match(src, /setAttribute\("aria-pressed", String\(on\)\)/,
      `★ ${why} is still conveyed by background colour alone`);
  }
});
