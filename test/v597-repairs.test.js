// test/v597-repairs.test.js — the tail's source seams.
//
// ⚠️ SOURCE CHECKS, NAMED AS SUCH. The landing-day header is driven in order-stage-whole-order.test.js and
// the 下午 word in home-facts.test.js; the rest sit inside shells this suite cannot press.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ a quantity stepper is named in words, in every builder (v597)", () => {
  const ui = read("admin/js/ui.js");
  assert.match(ui, /"−": "One less"/, "the minus glyph has no name");
  const orders = read("admin/js/views/orders.js");
  assert.equal((orders.match(/"aria-label": "One less"/g) || []).length, 2,
    "a quantity stepper in the order cards is still read as a character");
  assert.equal((orders.match(/"aria-label": "One more"/g) || []).length, 2);
  const scenario = read("admin/js/views/scenario.js");
  assert.match(scenario, /class: "tl-step", "aria-label": "A wider view/,
    "the planner's scale stepper has no name");
  const shop = read("store/app.js");
  assert.match(shop, /class: "step-btn", "aria-label": t\("qtyLess"\)/,
    "the shop's minus stepper has no name");
});

test("★★★ the backoffice calendars name their days (v597)", () => {
  assert.match(read("admin/js/datepicker.js"), /"aria-label": longDate\(iso\)/,
    "a date field's day is still named by its number");
  assert.match(read("admin/js/views/orders.js"), /"aria-label": longDate\(iso\) \+ \(full/,
    "the delivery calendar's day is still named by its number");
});

test("★★★ only the review on screen is read, in both carousels (v597)", () => {
  const home = read("reviews.js");
  assert.match(home, /setAttribute\("aria-hidden", j === i \? "false" : "true"\)/,
    "every homepage review is still read at once");
  assert.match(read("admin/js/views/reviews.js"), /setAttribute\("aria-hidden", j === cur \? "false" : "true"\)/,
    "every admin review is still read at once");
});

test("★★ an unnamed reviewer is anonymous in the visitor's language (v597)", () => {
  assert.match(read("reviews.js"), /tHome\("rvAnon"\)/, "the word is hardcoded English");
  for (const file of ["home-lang.js"]) {
    const src = read(file);
    assert.equal((src.match(/rvAnon:/g) || []).length, 3, "rvAnon is not in all three languages");
  }
});

test("★★ a printed page carries no app routes (v597)", () => {
  const src = read("admin/js/consolidated.js");
  assert.equal(/More → Money → Receipt register/.test(src), false,
    "the printed filing note tells an auditor to open a screen");
  assert.equal(/Open this page again/.test(src), false, "the printed note tells the reader to open the page");
});

test("★★ the PDF's second page carries the document reference (v597)", () => {
  const src = read("admin/js/journal.js");
  const at = src.indexOf("(continued)");
  assert.ok(at > 0, "the continuation head moved");
  assert.match(src.slice(at, at + 900), /if \(s\.subtitle\) drawWrapped/,
    "★ page 2 has the title but not the period/customer line");
});

test("★★ a refund ticker never ticks a sen over the cap (v597)", () => {
  assert.match(read("admin/js/views/orders.js"), /const tickedTotal = \(\) => Math\.min\(cap, round2\(/,
    "rounding each share can push the total past the cap and refuse her own press");
});
