// test/v593-repairs.test.js — seams a Node test cannot drive, pinned at the source.
//
// ⚠️ THE CHECKS HERE ARE SOURCE/MARKUP CHECKS AND ARE NAMED AS ONE. The price rule, the glyph names and the
// chosen product's payload are driven elsewhere (home-facts, points-publish, ui).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ the current tab is said in words, not only coloured (v593)", () => {
  // ⚠️ SOURCE CHECK: the tab bar is drawn by app.js against the real document. ⚠️ A screen reader heard the five
  // tab names with nothing saying which screen she was on.
  const src = read("admin/js/app.js");
  assert.match(src, /setAttribute\("aria-current", "page"\)/,
    "★ the current tab has no aria-current — **the only sign of the current screen is a colour**");
});

test("★★★ a labelled group is a GROUP, not a plain div (v593)", () => {
  // ⚠️ `aria-label` on a role-less div names nothing — the order journey and status flow were announced as
  // nothing at all.
  const orders = read("admin/js/views/orders.js");
  assert.match(orders, /class: "status-flow", role: "group"/, "the status flow has no role");
  assert.match(orders, /class: "oj", role: "group"/, "the order journey has no role");
  assert.match(read("store/app.js"), /class: "tj", role: "group"/, "the shop's journey has no role");
});

test("★★★ which review is showing is said in words (v593)", () => {
  assert.match(read("admin/js/views/reviews.js"), /setAttribute\("aria-pressed", j === cur \? "true" : "false"\)/,
    "★ the review dots are colour-only — a screen reader cannot tell which review is showing");
});
