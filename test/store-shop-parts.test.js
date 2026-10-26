// test/store-shop-parts.test.js — the shop's step bar and item row, and the rule that a bake day
// never carries a COUNT.
//
// ⚠️ WHY THE COUNT RULE IS HERE. Her words: __"to show how many left in the calendar is not desireable, and
// confusing, not helpful unless you are only selling one item at a day"__. ⭐ The shop sells several things,
// each with its own daily limit, so a number on the DAY answers a question nobody asked and contradicts the
// per-product counts beside it. **A day says whether it can be ordered; only a product says how many are left.**

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const APP = read("store/app.js");
// ⚠️⚠️ COMMENTS GO BEFORE ANY MATCH (the house rule). ⚠️ **BITTEN: commenting the call out left every test
// green**, because the regex found `paintStepBar(done);` inside the comment that explained it.
const live = (src) => String(src).split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\/\*.*?\*\//g, ""))
  .join("\n");
const HTML = read("store/index.html");
const CSS = read("store/app.css");

test("★★★ the step bar is built from the step headings, never typed a second time (v633_2)", () => {
  assert.match(HTML, /<nav id="stepbar" class="stepbar" aria-hidden="true"><\/nav>/,
    "★ the bar's element is gone — the four steps are a sentence again");
  assert.match(live(APP), /document\.querySelector\(`#step\$\{n\} h2`\)/,
    "★ the bar no longer reads the headings — **its words and the steps' words can now drift apart**");
  assert.match(live(APP), /document\.getElementById\("order-btn"\)/,
    "★ the fourth label is gone: step 4 has no heading of its own, its words come from the Place order press");
  // It is painted from the SAME list the green circles use — one rule, two readers.
  assert.match(live(APP),
    /function paintSteps\(\) \{\n\s*const done = stepsDone\(\);(\n(?!.*\/\/).*){0,12}?\n\s*paintStepBar\(done\);/,
    "★ the bar is not painted from `stepsDone()` — the bar and the circles can disagree");
});

test("★★★ a bake day never carries a COUNT (v633_2)", () => {
  // The day cell is built from its number, a name bubble, and the FULL word. A count in there is the fault
  // she named, and it would have to be added here to exist.
  const start = live(APP).indexOf("const kids = [el(\"span\", { class: \"cal-num\"");
  assert.ok(start > 0, "the day cell's children moved — this guard needs to find them again");
  const cell = live(APP).slice(start, start + 900);
  assert.ok(!/onlyLeft|slots_left|left\b\s*\+/.test(cell.replace(/past/g, "")),
    "★ a number of pans left is drawn inside the day cell — the calendar is answering for a product it does not know about");
  // And the words on a full day are the WORD, never a figure.
  assert.match(cell, /t\("calFull"\)/, "the full day's mark is no longer a word");
});

test("★★★ the item row puts the price and the stepper on the right, the count under the name (v633_2)", () => {
  assert.match(APP, /class: "card-side"/, "★ the price column is gone — price and unit are one line again");
  assert.match(APP, /class: "card-price"/, "★ the price has no element of its own to be emphasised in");
  // The stepper moved INTO the column, beside the price it changes.
  const side = APP.slice(APP.indexOf('class: "card-side"'), APP.indexOf('class: "card-side"') + 400);
  assert.match(side, /class: "stepper"/, "★ the stepper is no longer under the price");
  // And the count is a pill in the words column, not a badge across the card.
  assert.match(CSS, /\.card-words \.prod-stamp \{/, "the count is not styled as a pill under the name");
});

test("★★ the row does not scroll the page sideways on a small phone (v633_2)", () => {
  assert.match(CSS, /@media \(max-width: 360px\)[\s\S]{0,400}\.menu-thumb \{ width: 92px/,
    "★ the row's fixed widths are back at full size on a small screen — **measured: 120 + 134 + gaps ran past 320px**");
  // The stamp must not take part in laying out the week.
  assert.match(CSS, /\.cal-stamp \{\s*\n\s*position: absolute;/,
    "★ the FULL stamp is back in the flow — measured, it widened its week column to 69px and the grid overflowed");
});
