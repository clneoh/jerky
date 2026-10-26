// test/store-facts.test.js — the shop's "Good to know" sheet: the reassurance layer of the
// customer-levels plan, at the one moment a customer starts to wonder how the shop works.
//
// ⚠️⚠️ AND THE RULE THAT KEEPS IT HONEST: **every sentence here is a fact of hers.** Allergens, keeping and
// freezing are NOT in it, because she has not given those words and a shop must never invent a food fact.
// That absence is pinned, so the day someone adds a plausible-sounding line, this file says no.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const HTML = read("store/index.html");
const APP = read("store/app.js");
const CSS = read("store/app.css");

// comments out before any match — a commented-out line has fooled this repo before
const live = (src) => String(src).split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\/\*.*?\*\//g, ""))
  .join("\n");

const KEYS = ["factsLink", "factsHead", "factBake", "factCutoff", "factGet", "factPay", "factChange", "factAsk"];

test("★★★ the sheet exists, starts shut, and is opened by its own link (v636_2)", () => {
  assert.match(HTML, /id="facts-open"[^>]*aria-expanded="false"[^>]*aria-controls="facts-sheet"/,
    "★ the link that opens it is gone, or it claims a panel it does not control");
  assert.match(HTML, /<div class="facts-sheet" id="facts-sheet" hidden>/,
    "★ the panel must START hidden — a shop that arrives with a wall of small print is the fault wearing the fix's clothes");
  assert.match(live(APP), /sheet\("facts-open", "facts-sheet", null\);/,
    "★ nothing opens it — a press that does nothing is a bug");
});

test("★★★ one behaviour for both panels, and a language press is not 'away' (v636_2)", () => {
  assert.match(live(APP), /const sheet = \(openId, sheetId, zoneId\) => \{/,
    "★ the sheet behaviour was copied instead of shared — two copies of one rule drift");
  assert.match(live(APP), /sheet\("privacy-open", "privacy-sheet", "privacy-zone"\);/,
    "the privacy notice lost its wiring");
  // ⚠️ THE USE, NOT THE DECLARATION. ⭐ BITTEN: removing only the `&& !changingLanguage` from the condition left
  // the `const changingLanguage = …` line behind, and a test that looked for the *name* stayed green while the
  // fault was back. A guard has to assert the thing that runs.
  assert.match(live(APP), /!changingLanguage\) setOpen\(false\);/,
    "★ measured: switching language SHUT the panel — a customer reading in the wrong language had to open it again");
});

test("★★★ the shop-wide sheet carries NO food fact — they belong to the products (v639)", () => {
  // ⚠️⚠️ HER WORDS: __"this should not be as general but on the product specific"__ — a ham sandwich and a plain
  // focaccia do not share an allergen line. ⭐ So the general panel says how to ORDER; the food facts live on the
  // product card, written by her, and the shop draws nothing where she has written nothing.
  const page = HTML.replace(/<!--[\s\S]*?-->/g, "");
  const sheet = page.slice(page.indexOf('id="facts-sheet"'), page.indexOf('id="facts-sheet"') + 2600);
  const FOOD_CLAIMS = /allergen|freez|frozen|refrigerat|reheat|shelf life|keeps?\s+(?:for|well)|best (?:on|before)|use by|good for \d+|lasts?\s+\d+\s+days?|halal|microwav|room temperature|wheat|gluten|slice it|wrap (?:it|each)/i;
  const m = FOOD_CLAIMS.exec(sheet);
  assert.ok(!m, `★ the general panel claims "${m && m[0]}" — food facts belong to the product, not to the shop`);
  // and nothing on it is left marked as a draft
  assert.ok(!/data-draft/.test(sheet), "★ a draft marker is left in the panel with nothing to mark");
  // ⚠️ THE BULLETS ARE DRAWN NOW (v641), not written into the page — so the defaults are checked where they
  // live: the shop's own painter falls back to these five keys, and the panel is empty-proof.
  const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  for (const key of ["factBake", "factCutoff", "factGet", "factPay", "factChange"]) {
    assert.ok(app.includes(`"${key}"`), `the painter no longer falls back to "${key}"`);
  }
  // ⚠️ ENGLISH NOW FALLS BACK TO THE SAME LIST THE EDITOR SHOWS (v642), so the box and the page cannot
  // disagree; 中文 and BM keep their own translations from the dictionary.
  assert.match(app, /lang === "en"\s*\n\s*\? DEFAULT_FACTS/,
    "★ the English fallback stopped coming from the shared list — the box and the page can drift apart");
  assert.match(app, /\["factBake", "factCutoff", "factGet", "factPay", "factChange"\]\.map\(\(k\) => t\(k\)\)/,
    "★ the translated fallback list changed — an empty panel is one cleared box away");
});

test("★★★ the product card draws her food facts only where she wrote them (v639)", () => {
  const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  assert.match(app, /p\.allergens \? el\("p", \{ class: "prod-fact" \}/,
    "★ the product's allergen line is not drawn at all");
  assert.match(app, /p\.keeping \? el\("p", \{ class: "prod-fact" \}/,
    "★ the product's keeping line is not drawn at all");
  // ⚠️ and the shop must never write one itself: the line is her text, not a sentence of ours with a hole in it.
  assert.ok(!/allergens[^\n]{0,40}default|keeping[^\n]{0,40}default/i.test(live(app)),
    "★ the shop has a fallback food fact — the app is guessing about food again");
});

test("★★★ and every sentence exists in three languages, not copied (v636_2)", () => {
  for (const key of KEYS) {
    const vals = LANGS.map((l) => STORE[l] && STORE[l][key]);
    assert.ok(vals.every((v) => typeof v === "string" && v.trim().length > 0), `★ ${key} is missing in one language`);
    assert.notEqual(vals[1], vals[0], `★ ${key} 中文 is the English line`);
    assert.notEqual(vals[2], vals[0], `★ ${key} Bahasa Malaysia is the English line`);
  }
});

test("★★ the panel opens in the FLOW, not against the order bar (v636_2)", () => {
  // ⚠️ Measured: given the privacy panel's own class, this one opened with zero height and nothing on screen —
  // it was being positioned against the order bar, which it has nothing to do with.
  assert.match(CSS, /\.facts-sheet \{[\s\S]{0,220}?margin: -6px 0 14px;/,
    "★ the facts panel is bar-anchored again — measured, it then opens with no height at all");
  assert.ok(!/class="privacy-sheet" id="facts-sheet"/.test(HTML),
    "★ the panel went back to the order bar's class");
});
