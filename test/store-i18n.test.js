// test/store-i18n.test.js — the store shares one full key set across EN / 中文 /
// BM, every tagged string on store/index.html exists in all three, and the
// English dictionary copies the authored copy so an English visit is unchanged.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

const html = readFileSync(new URL("../store/index.html", import.meta.url), "utf8");
const tagKeys = (attr) => {
  const re = new RegExp(`${attr}="([^"]+)"`, "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return [...new Set(out)];
};
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

test("the three languages share exactly the same key set", () => {
  for (const l of LANGS) assert.ok(STORE[l], `dictionary for ${l} exists`);
  const ref = Object.keys(STORE.en).sort();
  for (const l of LANGS.slice(1)) {
    assert.deepEqual(Object.keys(STORE[l]).sort(), ref, `${l} keys match English`);
  }
});

test("every tagged string on the store page exists in all three languages", () => {
  for (const attr of ["data-i18n", "data-i18n-html", "data-i18n-ph"]) {
    const used = tagKeys(attr);
    for (const key of used) {
      for (const l of LANGS) {
        assert.equal(typeof STORE[l][key], "string", `${attr}="${key}" missing from ${l}`);
      }
    }
  }
});

test("English dictionary values match the authored English copy", () => {
  // Only [data-i18n] nodes are single-leaf text (the whatsapp label's * and the
  // track hint's <strong> live under separate nodes / data-i18n-html).
  const re = /<[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)</g;
  let m;
  let checked = 0;
  while ((m = re.exec(html))) {
    const [ , key, raw ] = m;
    const en = STORE.en[key];
    assert.equal(typeof en, "string", `data-i18n="${key}" missing from en`);
    assert.equal(unescape(raw.trim()), en.trim(), `en["${key}"] differs from the authored text`);
    checked += 1;
  }
  assert.ok(checked > 10, "the check actually walked the store page tags");
});

// The reason on a product card that can't be ordered for the chosen day, and
// the notes a refresh writes above the menu, are built in JS rather than tagged
// in the HTML — so nothing else would notice them missing or half-translated.
test("the closed-product reason and the basket notes are keyed in all three languages", () => {
  const holders = {
    closedFrom: ["%1"],
    closedTo: ["%1"],
    closedClose: ["%1"],
    closedCloseAdvice: [],
    sentenceEnd: [],
    fixSoldOut: ["%1"],
    fixPoolClamp: ["%1", "%2", "%3"],
    fixClamp: ["%1", "%2", "%3"],
    fixClosed: ["%1", "%2"],
  };
  for (const [key, phs] of Object.entries(holders)) {
    for (const l of LANGS) {
      const v = STORE[l][key];
      assert.equal(typeof v, "string", `${l}.${key} is missing`);
      for (const ph of phs) assert.ok(v.includes(ph), `${l}.${key} must keep ${ph}`);
    }
  }
});

test("placeholders and the html-track hint are keyed too", () => {
  const ph = tagKeys("data-i18n-ph");
  assert.ok(ph.includes("namePh") && ph.includes("whatsPh"));
  for (const k of tagKeys("data-i18n-html")) {
    for (const l of LANGS) assert.ok(STORE[l][k].includes("<strong>"), `${l}.${k} keeps its <strong>`);
  }
});
