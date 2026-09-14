// i18n.test.js — the trilingual site (Engine v64):
//  • every tagged homepage string exists in all three languages,
//  • the English dictionary copies the authored English text exactly,
//  • the carousel step wraps around, and nameFor falls back to English,
//  • the three languages expose the same full key set.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { HOME } from "../home-lang.js";
import { LANGS, nameFor, descFor, unitFor, servingFor, policyFor } from "../i18n.js";
import { carouselStep } from "../reviews.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tagKeys = (attr) => {
  const re = new RegExp(`${attr}="([^"]+)"`, "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return [...new Set(out)];
};
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

test("the three languages share exactly the same key set", () => {
  for (const l of LANGS) assert.ok(HOME[l], `dictionary for ${l} exists`);
  const ref = Object.keys(HOME.en).sort();
  for (const l of LANGS.slice(1)) {
    assert.deepEqual(Object.keys(HOME[l]).sort(), ref, `${l} keys match English`);
  }
});

test("every data-i18n tag on the homepage exists in all three languages", () => {
  for (const attr of ["data-i18n", "data-i18n-html", "data-i18n-ph", "data-i18n-aria"]) {
    const used = tagKeys(attr);
    for (const key of used) {
      for (const l of LANGS) {
        assert.equal(typeof HOME[l][key], "string", `${attr}="${key}" missing from ${l}`);
      }
    }
  }
});

test("English dictionary values match the authored English text", () => {
  const re = /<[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)</g;
  let m;
  let checked = 0;
  while ((m = re.exec(html))) {
    const [ , key, raw ] = m;
    const en = HOME.en[key];
    assert.equal(typeof en, "string", `data-i18n="${key}" missing from en`);
    const authored = raw.trim();
    assert.equal(unescape(authored), en.trim(), `en["${key}"] differs from authored text`);
    checked += 1;
  }
  assert.ok(checked > 30, "the check actually walked the homepage tags");
});

test("carouselStep wraps both directions and no-ops under two slides", () => {
  assert.equal(carouselStep(0, 0, 1), 0);
  assert.equal(carouselStep(1, 0, 1), 0);
  assert.equal(carouselStep(5, 4, 1), 0); // wraps last → first
  assert.equal(carouselStep(5, 0, -1), 4); // wraps first → last
  assert.equal(carouselStep(5, 2, 0), 2);
  assert.equal(carouselStep(5, 2, 3), 0);
  assert.equal(carouselStep(3, 1, -4), 0);
});

test("nameFor shows the translated name when typed, else the English name", () => {
  const p = { name: "Focaccia", nameZh: "佛卡夏", nameMs: "" };
  assert.equal(nameFor(p, "en"), "Focaccia");
  assert.equal(nameFor(p, "zh"), "佛卡夏");
  assert.equal(nameFor(p, "ms"), "Focaccia"); // blank Malay → English fallback
  assert.equal(nameFor({ name: "  " }, "zh"), "");
  assert.equal(nameFor(null, "en"), "");
  const q = { name: "Croissant", nameZh: "牛角包", nameMs: "Croissant" };
  assert.equal(nameFor(q, "ms"), "Croissant");
});

// ── descFor / unitFor / servingFor (Engine v66 auto-translated fields) ──────

test("descFor / servingFor / unitFor pick the language's line, English until one exists", () => {
  const p = {
    name: "Focaccia", description: "Crispy airy crumb", unit: "loaf", servingTip: "Warm 10 min",
    descZh: "香脆空心", descMs: "Rangup berangin",
    unitZh: "条", unitMs: "loaf",
    servingZh: "加热 10 分钟", servingMs: "Panaskan 10 minit",
  };
  for (const lang of ["en", "zh", "ms"]) {
    assert.equal(descFor(p, lang), lang === "zh" ? "香脆空心" : lang === "ms" ? "Rangup berangin" : "Crispy airy crumb");
    assert.equal(servingFor(p, lang), lang === "zh" ? "加热 10 分钟" : lang === "ms" ? "Panaskan 10 minit" : "Warm 10 min");
    assert.equal(unitFor(p, lang), lang === "zh" ? "条" : "loaf");
  }
});

test("a missing translation keeps the English text (or 'piece'), never a blank or a crash", () => {
  const englishOnly = { name: "Focaccia", description: "Crispy", unit: "loaf", servingTip: "Warm it" };
  for (const lang of ["zh", "ms"]) {
    assert.equal(descFor(englishOnly, lang), "Crispy");
    assert.equal(servingFor(englishOnly, lang), "Warm it");
    assert.equal(unitFor(englishOnly, lang), "loaf");
  }
  assert.equal(descFor(englishOnly, "en"), "Crispy");
  assert.equal(unitFor({}, "zh"), "piece", "no unit at all falls back to 'piece', as the price line expects");
  assert.equal(unitFor({ unit: "  " }, "zh"), "piece");
  assert.equal(descFor(null, "zh"), "");
  assert.equal(servingFor(undefined, "ms"), "");
  const blankZh = { name: "Focaccia", description: "Crispy", descZh: "   " };
  assert.equal(descFor(blankZh, "zh"), "Crispy", "whitespace-only translation reads as absent");
});

// ── policyFor (Engine v73 Policies box) ─────────────────────────────────────

test("policyFor picks the language's wording, English until a translation is written", () => {
  const cfg = { policy: "  Not refundable — may be moved.  ", policyZh: "款项不退还。", policyMs: "   " };
  assert.equal(policyFor(cfg, "en"), "Not refundable — may be moved.", "the English text is trimmed");
  assert.equal(policyFor(cfg, "zh"), "款项不退还。");
  assert.equal(policyFor(cfg, "ms"), "Not refundable — may be moved.", "a blank BM box falls back to English");
  assert.equal(policyFor({ policy: "" }, "en"), "", "a blank box shows nothing at all");
  assert.equal(policyFor(null, "zh"), "");
  assert.equal(policyFor(undefined, "en"), "");
});
