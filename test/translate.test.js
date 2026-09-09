// test/translate.test.js — auto-translate engine (Engine v66): the variant →
// language/source tables, the provenance rules that decide whether a box is
// machine-filled, hand-typed or deliberately blank, the ≤440-char chunking, the
// MyMemory call shape, and autoTranslateProduct writing/clearing/adopting. Pure
// module with an injected fetcher — no network, ever.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANG_OF, SRC_OF, VARIANT_KEYS, ZH_VARIANTS, MS_VARIANTS, MAX_CHUNK,
  valueOf, srcTextOf, isOverridden, markManual, markAuto,
  translationStatus, planTranslations, translateAllowed, chunkForSend,
  translateTo, autoTranslateProduct,
} from "../admin/js/translate.js";

// A fetcher that answers every call with one translated text.
const okResp = (text) => async () => ({ ok: true, json: async () => ({ responseData: { translatedText: text } }) });
// A fetcher that records each URL it was called with.
const recording = (text) => {
  const urls = [];
  const f = async (url) => { urls.push(url); return { ok: true, json: async () => ({ responseData: { translatedText: text } }) }; };
  f.urls = urls;
  return f;
};

// ── the variant tables ──────────────────────────────────────────────────────

test("every variant maps to its language and its English source field", () => {
  assert.equal(LANG_OF.nameZh, "zh");
  assert.equal(LANG_OF.descZh, "zh");
  assert.equal(LANG_OF.unitZh, "zh");
  assert.equal(LANG_OF.servingZh, "zh");
  assert.equal(LANG_OF.nameMs, "ms");
  assert.equal(LANG_OF.descMs, "ms");
  assert.equal(LANG_OF.unitMs, "ms");
  assert.equal(LANG_OF.servingMs, "ms");

  assert.equal(SRC_OF.nameZh, "name");
  assert.equal(SRC_OF.descMs, "description");
  assert.equal(SRC_OF.unitZh, "unit");
  assert.equal(SRC_OF.servingMs, "servingTip");
});

test("VARIANT_KEYS covers all eight boxes, split evenly across the two languages", () => {
  assert.deepEqual([...VARIANT_KEYS].sort(), [...ZH_VARIANTS, ...MS_VARIANTS].sort());
  assert.equal(ZH_VARIANTS.length, 4);
  assert.equal(MS_VARIANTS.length, 4);
  assert.ok(ZH_VARIANTS.every((k) => LANG_OF[k] === "zh"));
  assert.ok(MS_VARIANTS.every((k) => LANG_OF[k] === "ms"));
});

test("valueOf and srcTextOf read the stored value / the English it comes from", () => {
  const p = { name: " Focaccia ", nameZh: " 佛卡夏 ", description: "Crispy", descZh: "  " };
  assert.equal(valueOf(p, "nameZh"), "佛卡夏");
  assert.equal(valueOf(p, "descZh"), "", "whitespace-only reads as blank");
  assert.equal(srcTextOf(p, "nameZh"), "Focaccia");
  assert.equal(srcTextOf(p, "descZh"), "Crispy");
  assert.equal(valueOf(null, "nameZh"), "");
  assert.equal(srcTextOf(null, "nameZh"), "");
});

// ── provenance: manual / cleared / auto / stale / missing / none ────────────

test("translationStatus tells apart every reason a box reads what it does", () => {
  const p = {
    name: "Focaccia", description: "Crispy airy crumb", unit: "loaf", servingTip: "Warm it",
    nameZh: "佛卡夏", descZh: "旧翻译", unitMs: "roti", servingMs: "",
    // nameZh is machine-made and current; descZh is machine-made from an older
    // English line; unitMs is hand-typed; servingMs is deliberately cleared.
    trSrc: { nameZh: "Focaccia", descZh: "Old English description" },
    trOverride: ["unitMs", "servingMs"],
  };
  assert.equal(translationStatus(p, "nameZh"), "auto");
  assert.equal(translationStatus(p, "descZh"), "stale");
  assert.equal(translationStatus(p, "unitMs"), "manual");
  assert.equal(translationStatus(p, "servingMs"), "cleared");
  assert.equal(translationStatus(p, "descMs"), "missing", "English exists, no Malay yet");
  assert.equal(translationStatus(p, "servingZh"), "missing");
});

test("translationStatus: a legacy hand-typed value reads manual; a blank English field reads none", () => {
  const legacy = { name: "Croissant", nameZh: "牛角包" }; // v64 name, no trSrc
  assert.equal(translationStatus(legacy, "nameZh"), "manual");
  const empty = { name: "" }; // no English to translate
  assert.equal(translationStatus(empty, "nameZh"), "none");
  const removed = { nameZh: "佛卡夏", trSrc: { nameZh: "Focaccia" } }; // English deleted since
  assert.equal(translationStatus(removed, "nameZh"), "cleared", "machine text left over from a removed English line");
});

test("isOverridden / markManual / markAuto keep the provenance bookkeeping straight", () => {
  const p = {};
  markAuto(p, "descZh", "Crispy");
  assert.equal(isOverridden(p, "descZh"), false, "machine text is not overridden");
  assert.equal(p.trSrc.descZh, "Crispy");

  markManual(p, "descZh"); // the baker types over it
  assert.equal(isOverridden(p, "descZh"), true);
  assert.ok(!p.trSrc || !("descZh" in p.trSrc), "typing forgets what machine English it came from");

  markAuto(p, "descZh", "Crispy"); // and a later ↻ refills it
  assert.equal(isOverridden(p, "descZh"), false);
  assert.equal(p.trSrc.descZh, "Crispy");
  assert.ok(!("trOverride" in p) || p.trOverride.length === 0, "an empty override list is tidied away");
});

// ── the translation plan ────────────────────────────────────────────────────

test("planTranslations: an overridden box is never listed, blank or filled", () => {
  const p = { name: "Focaccia", nameZh: "手写的", trOverride: ["nameZh"] };
  assert.deepEqual(planTranslations(p).filter((s) => s.variant === "nameZh"), [],
    "her words are never auto-touched");
});

test("planTranslations: fresh English with no translation → translate each box, in the boxes' own order", () => {
  const p = { name: "Focaccia", description: "Crispy", unit: "loaf", servingTip: "Warm 10 min" };
  const actions = planTranslations(p);
  assert.deepEqual(actions, [
    { variant: "nameZh", action: "translate" }, { variant: "descZh", action: "translate" },
    { variant: "unitZh", action: "translate" }, { variant: "servingZh", action: "translate" },
    { variant: "nameMs", action: "translate" }, { variant: "descMs", action: "translate" },
    { variant: "unitMs", action: "translate" }, { variant: "servingMs", action: "translate" },
  ]);
});

test("planTranslations: v64 hand-typed names are adopted as hers, never overwritten", () => {
  const p = { name: "Focaccia", nameZh: "佛卡夏", nameMs: "Focaccia" }; // legacy values, no trSrc
  const actions = planTranslations(p);
  assert.deepEqual(actions, [
    { variant: "nameZh", action: "adopt" },
    { variant: "nameMs", action: "adopt" },
  ]);
});

test("planTranslations: machine text matching its English is left alone; changed English re-translates", () => {
  const p = {
    name: "Focaccia",
    nameZh: "佛卡夏", nameMs: "旧名",                 // no description/unit/tip involved
    trSrc: { nameZh: "Focaccia", nameMs: "Old English name" }, // nameMs is stale
  };
  assert.deepEqual(planTranslations(p), [{ variant: "nameMs", action: "translate" }]);
});

test("planTranslations: English removed → the stale machine value is cleared", () => {
  const p = { nameZh: "佛卡夏", trSrc: { nameZh: "Focaccia" } };
  assert.deepEqual(planTranslations(p), [{ variant: "nameZh", action: "clear" }]);
});

// ── chunking ────────────────────────────────────────────────────────────────

test("chunkForSend splits long text on word boundaries into ≤440-char pieces", () => {
  assert.deepEqual(chunkForSend(""), []);
  assert.deepEqual(chunkForSend("  short line  "), ["short line"]);
  const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const chunks = chunkForSend(text);
  assert.ok(chunks.length > 1, "a 200-word line splits");
  assert.ok(chunks.every((c) => c.length <= MAX_CHUNK), "every piece fits the API cap");
  assert.equal(chunks.map((c) => c.split(" ").length).reduce((s, n) => s + n, 0), 200,
    "no word is ever cut in half");
});

// ── translateTo: the MyMemory call shape ───────────────────────────────────

test("translateTo asks MyMemory with the right URL and reads responseData.translatedText", async () => {
  const f = recording(" 佛卡夏 ");
  const out = await translateTo(f, "Focaccia", "zh");
  assert.equal(out, "佛卡夏");
  assert.equal(f.urls.length, 1);
  assert.equal(f.urls[0], "https://api.mymemory.translated.net/get?q=Focaccia&langpair=en|zh-CN");

  const g = recording("roti");
  await translateTo(g, "loaf", "ms");
  assert.equal(g.urls[0], "https://api.mymemory.translated.net/get?q=loaf&langpair=en|ms");
});

test("translateTo encodes the query and decodes HTML entities in the reply", async () => {
  const f = recording("A & B");
  const out = await translateTo(f, "A & B is a flavour of bread", "zh");
  assert.equal(out, "A & B", "HTML entities are decoded back to their characters");
  assert.match(f.urls[0], /q=A%20%26%20B/);
});

test("translateTo quietly returns '' on blanks, an unknown language, or a failure", async () => {
  assert.equal(await translateTo(okResp("x"), "  ", "zh"), "", "blank text → nothing");
  assert.equal(await translateTo(okResp("x"), "Focaccia", "fr"), "", "unknown language → nothing");
  assert.equal(await translateTo(async () => ({ ok: false }), "Focaccia", "zh"), "", "HTTP failure → nothing");
  assert.equal(await translateTo(async () => ({ ok: true, json: async () => ({}) }), "Focaccia", "zh"), "",
    "missing responseData → nothing");
  await assert.rejects(translateTo(async () => { throw new Error("offline"); }, "Focaccia", "zh"),
    "a network throw propagates — kickoffAutoTranslate's own try/catch absorbs it");
});

// ── autoTranslateProduct ────────────────────────────────────────────────────

test("autoTranslateProduct fills a fresh product from English and records trSrc", async () => {
  const p = { name: "Focaccia", unit: "loaf", description: "Crispy airy crumb" };
  const f = okResp("译");
  const changed = await autoTranslateProduct(p, f);
  assert.deepEqual([...changed].sort(), ["descMs", "descZh", "nameMs", "nameZh", "unitMs", "unitZh"].sort(),
    "servingTip is blank so only the six written boxes translate");
  assert.equal(p.nameZh, "译");
  assert.equal(p.descZh, "译");
  assert.equal(p.unitZh, "译");
  assert.ok(!("servingZh" in p));
  assert.equal(p.trSrc.nameZh, "Focaccia");
  assert.equal(p.trSrc.unitMs, "loaf");
  assert.ok(!("trOverride" in p), "machine-filled boxes are not overridden");
});

test("autoTranslateProduct adopts v64 hand-typed names without changing anything", async () => {
  const p = { name: "Focaccia", nameZh: "佛卡夏", nameMs: "Focaccia" };
  const changed = await autoTranslateProduct(p, okResp("译"));
  assert.deepEqual(changed, []);
  assert.equal(p.nameZh, "佛卡夏", "her value is untouched");
  assert.deepEqual(p.trOverride, ["nameZh", "nameMs"], "both are now recorded as hers");
});

test("autoTranslateProduct clears a stale machine box whose English was removed", async () => {
  const p = { nameZh: "旧译", trSrc: { nameZh: "Focaccia" } };
  const changed = await autoTranslateProduct(p, okResp("译"));
  assert.deepEqual(changed, ["nameZh"]);
  assert.ok(!("nameZh" in p), "the stale translation is dropped");
  assert.ok(!p.trSrc || !("nameZh" in p.trSrc));
});

test("autoTranslateProduct leaves a box alone when the API returns nothing (retry next time)", async () => {
  const p = { name: "Focaccia", description: "New crisp English", descZh: "旧机器翻译",
    trSrc: { descZh: "Old English" } }; // its English changed, so it would retranslate…
  const changed = await autoTranslateProduct(p, okResp(""));
  assert.deepEqual(changed, [], "but a failed call changes nothing");
  assert.equal(p.descZh, "旧机器翻译", "the previous value survives until the retry");
});

// ── the online gate ─────────────────────────────────────────────────────────

test("translateAllowed is false under node --test, so auto-translate is a no-op in tests", () => {
  assert.equal(translateAllowed(), false);
});
