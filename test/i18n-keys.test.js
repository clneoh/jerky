// test/i18n-keys.test.js — every word the pages ask for actually exists, in all three languages (v566).
//
// ⚠️⚠️ WHY THIS EXISTS, AND IT CAUGHT ONE THE DAY IT WAS WRITTEN. v565 gave the reviews section a new
// offline line — `tHome("rvUnavailable")` — and **the key was never added to the dictionary.** ⭐ A missing
// key does not crash: it draws the key itself, or nothing, in the one state (offline) a customer is most
// likely to be confused by. ⚠️ **A page can be fully translated and still have a hole in it**, which is
// this project's oldest lesson in its own words: *a check keyed to one word checks one word.*
//
// ⭐ So this reads the KEYS THE PAGES ACTUALLY ASK FOR — the HTML attributes and every `t(...)`/`tHome(...)`
// call — and fails if any of them is missing from any language.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { HOME } = await import("../home-lang.js");
const { STORE } = await import("../store-lang.js");

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ★★★ THE THREE LANGUAGES ARE WRITTEN HERE, NOT READ OFF THE DATA (v584). ⚠️⚠️ This guard took its list from
// `Object.keys(HOME)` — ⚠️ **so deleting 中文 from the dictionary deleted the language from the check too, and
// every test stayed green.** ⭐ A guard whose list comes from what it guards is the fault it was built for.
const LANGS = ["en", "zh", "ms"];

// Every spelling this app uses to name a string: `data-i18n`, `-html`, `-ph`, `-aria`, and the two call
// styles. ⚠️ A new spelling added to i18n.js must be added here too — the guard cannot see what it is
// not taught, which is why this list is written out rather than guessed at.
const ATTR = /data-i18n(?:-html|-ph|-aria)?=["']([A-Za-z0-9_]+)["']/g;
function keysUsed(files, callPattern) {
  const out = new Set();
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(ATTR)) out.add(m[1]);
    for (const m of s.matchAll(callPattern)) out.add(m[1]);
  }
  return out;
}

const HOME_FILES = ["index.html", "home.js", "reviews.js"];
const STORE_FILES = ["store/index.html", "store/app.js", "store/lookup.js", "store/feedback.js", "store/calendar.js"];

test("★★★ every key the homepage asks for exists in EN, 中文 and BM", () => {
  const used = keysUsed(HOME_FILES, /\btHome\(\s*["']([A-Za-z0-9_]+)["']/g);
  assert.ok(used.size > 40, `only ${used.size} keys found — the reader is not seeing the page`);
  for (const lang of LANGS) {
    const missing = [...used].filter((k) => !(k in HOME[lang]));
    assert.deepEqual(missing, [],
      `★ the homepage asks for ${missing.length} string(s) ${lang} does not have — **the page draws the `
      + "key itself instead of a word**");
  }
});

test("★★★ every key the shop asks for exists in EN, 中文 and BM", () => {
  const used = keysUsed(STORE_FILES, /\bt\(\s*["']([A-Za-z0-9_]+)["']/g);
  assert.ok(used.size > 60, `only ${used.size} keys found — the reader is not seeing the shop`);
  for (const lang of LANGS) {
    const missing = [...used].filter((k) => !(k in STORE[lang]));
    assert.deepEqual(missing, [],
      `★ the shop asks for ${missing.length} string(s) ${lang} does not have`);
  }
});

test("★★★ and the three dictionaries carry the same keys", () => {
  // ⚠️ A key in one language only is the other half of the same hole: the page is translated in English
  // and silently English-only everywhere else.
  for (const [name, dict] of [["home", HOME], ["shop", STORE]]) {
    // ⚠️ AND THE DICTIONARY MUST CARRY ALL THREE — a missing language is the same hole, one level up.
    assert.deepEqual(Object.keys(dict).sort(), [...LANGS].sort(),
      `★ ${name} is not carrying all three languages (${Object.keys(dict).join(", ")})`);
    const en = new Set(Object.keys(dict.en || {}));
    for (const lang of LANGS) {
      const missing = [...en].filter((k) => !(k in dict[lang]));
      assert.deepEqual(missing, [], `★ ${name}: ${lang} is missing ${missing.length} key(s) English has`);
    }
  }
});

test("★★★ the tracking failure names BOTH keys the lookup needs (v569)", () => {
  // ⚠️⚠️ Since v558 an order is found by its number AND the phone it was placed with — but the failure
  // sentence still told the customer to check only "the 6 characters after the #", the one thing already
  // right. ⭐ Someone with the right code and a mistyped number was sent round in circles.
  for (const lang of LANGS) {
    const said = String(STORE[lang].trackNotFound || "").toLowerCase();
    assert.ok(said.includes("phone") || said.includes("telefon") || said.includes("电话"),
      `★ ${lang}'s tracking failure does not mention the phone number — **the customer is told to re-check the code only**`);
  }
});
