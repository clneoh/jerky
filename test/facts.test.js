// test/facts.test.js — "Good to know" in her own words (v641).
//
// ⚠️⚠️ TWO THINGS MUST ALWAYS HOLD:
//   1 · **THE PANEL IS NEVER EMPTY.** Blank falls back to the shop's own five lines, so a customer always reads
//       something true — a clearing she made on impulse cannot leave a hole in the page.
//   2 · **HER WORDS WIN.** ⭐ A reader in 中文 gets her English sentence rather than a default sentence she has
//       replaced: her words are the claim, and the default is only what shows when she has said nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { factsLines, factsBoxText, FACTS_MAX_LINES } from "../store/facts.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// ⚠️ COMMENTS OUT BEFORE ANY MATCH. ⭐ BITTEN: commenting the repaint out left this test green, because the
// regex found the call inside the comment that explained it — the house rule, paid for again.
const live = (src) => String(src).split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\/\*.*?\*\//g, ""))
  .join("\n");
const DEFAULTS = ["We bake on the days the calendar offers.", "Orders close the evening before."];

test("★★★ one sentence per line, and blank lines are not bullets (v641)", () => {
  const lines = factsLines({ facts: "  Line one.  \n\n Line two.\r\n" }, "en", DEFAULTS);
  assert.deepEqual(lines, ["Line one.", "Line two."]);
});

test("★★★ blank falls back to the shop's own lines, never to nothing (v641)", () => {
  assert.deepEqual(factsLines({ facts: "   " }, "en", DEFAULTS), DEFAULTS);
  assert.deepEqual(factsLines(null, "en", DEFAULTS), DEFAULTS);
  assert.deepEqual(factsLines({}, "zh", DEFAULTS), DEFAULTS, "★ an empty panel reached a customer");
});

test("★★★ her words win in every language — her English beats the shop's 中文 default (v641)", () => {
  // ⚠️ This is the surprising one, and it is deliberate: an untranslated sentence of HERS is more honest than a
  // translated sentence she has replaced.
  const published = { facts: "We bake Tuesday and Thursday now.", factsZh: "", factsMs: "Kami membakar pada Selasa." };
  assert.deepEqual(factsLines(published, "en", DEFAULTS), ["We bake Tuesday and Thursday now."]);
  assert.deepEqual(factsLines(published, "ms", DEFAULTS), ["Kami membakar pada Selasa."]);
  assert.deepEqual(factsLines(published, "zh", DEFAULTS), ["We bake Tuesday and Thursday now."],
    "★ a Chinese reader was given a default line while her own sentence existed");
  // and a translation she DID write is used, of course
  assert.deepEqual(factsLines({ ...published, factsZh: "我们在周二和周四烘焙。" }, "zh", DEFAULTS), ["我们在周二和周四烘焙。"]);
});

test("★★ a runaway box cannot fill the panel (v641)", () => {
  const many = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join("\n");
  assert.equal(factsLines({ facts: many }, "en", DEFAULTS).length, FACTS_MAX_LINES);
});

test("★★ the box opens holding the shop's lines, so she edits rather than writes (v641)", () => {
  assert.equal(factsBoxText({}, "en", DEFAULTS), DEFAULTS.join("\n"));
  assert.equal(factsBoxText({ facts: "Hers." }, "en", DEFAULTS), "Hers.");
  assert.equal(factsBoxText({ facts: "Hers.", factsZh: "她的。" }, "zh", DEFAULTS), "她的。");
});

test("★★★ the sheet is a container the shop fills, and it is filled on every repaint (v641)", () => {
  const html = read("store/index.html");
  assert.match(html, /<ul class="privacy-sheet-list" id="facts-list"><\/ul>/,
    "★ the bullets are hard-coded again — her wording could never reach the page");
  const app = live(read("store/app.js"));
  assert.match(app, /function paintFacts\(cfg\)/, "the painter is gone");
  assert.match(app, /paintFacts\(cfg\);/, "★ the panel is never repainted — a language switch would leave the bullets in the old language");
  assert.match(app, /const lines = factsLines\(CONFIG, lang, fallback\);/, "★ the panel stopped reading her published words");
});

test("★★★ the backoffice can publish them, and the shop adopts them (v641)", () => {
  const publish = read("admin/js/supabase.js");
  for (const key of ["facts", "factsZh", "factsMs"]) {
    assert.match(publish, new RegExp(`${key}: String\\(sf\\.${key} \\|\\| ""\\)`),
      `★ ${key} is not published — the box in Settings would change nothing a customer sees`);
  }
  const app = read("store/app.js");
  assert.match(app, /"facts", "factsZh", "factsMs"\]/, "★ the shop's own merge drops her lines on arrival");
  const settings = read("admin/js/views/settings.js");
  assert.match(settings, /el\("label", \{\}, "Good to know \(shown on the shop\)"\)/, "the box is not in Settings");
  assert.match(settings, /button\("Translate", translateFacts, "soft"\)/, "the translate press is gone");
});

test("★★★ the shop never hides the number with an ATTRIBUTE (v643)", () => {
  // ⚠️⚠️ MEASURED ON HER OWN SHOP: the number was drawn and invisible. ⭐ **The shop's `el()` writes every key
  // it is given straight onto the element, so `hidden: false` still SET the attribute — and a `hidden` attribute
  // hides the element whatever its value.** ⭐ The shop's own tip bubble has carried this warning for years; this
  // is the test that stops the next one being written.
  const app = live(read("store/app.js"));
  assert.ok(!/\bhidden\s*:/.test(app),
    "★ a `hidden:` key is passed to el() — in this file it writes an ATTRIBUTE, so even `false` hides the thing");
  assert.match(app, /if \(!shown\) link\.hidden = true;/,
    "★ the way out when there is no number to show is gone");
});
