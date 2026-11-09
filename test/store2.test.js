// test/store2.test.js — /store2/ is a second DOOR onto the one shop, never a
// second copy of it.
//
// ⭐ WHY THIS FILE EXISTS. `store2/` is deliberately almost empty: an
// `index.html` with the same ids, a one-line `app.js` that imports the real
// shop, and a skin. ⚠️ **The dangerous shape is not CSS, it is DRIFT** — a
// missing id (the engine leaves a box empty), a language key the skin assumes,
// or a stray `import` that quietly forks the basket. So each of those is
// pinned by a test rather than by a comment someone may not read.
//
// ⚠️ AND THE SKIN IS SCOPED BY RULE, NOT BY HABIT: every selector must start
// `body.store2`, because `theme.css` is loaded on a page that also loads
// `store/app.css` — and a single unscoped rule here would repaint /store/ the
// moment a visitor opened the second door. The test walks the real stylesheet
// (comments and `@keyframes` removed) so a rule added at the bottom is caught
// the same as one added at the top.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../store2/index.html");
const baseHtml = read("../store/index.html");
const css = read("../store2/theme.css");
const app = read("../store2/app.js");

const idsOf = (h) => [...new Set([...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
const keysOf = (h) =>
  [...new Set([...h.matchAll(/\bdata-i18n(?:-aria|-html|-ph)?="([^"]+)"/g)].map((m) => m[1]))];

// → [{ sel, inKeyframes }] for every rule in a stylesheet. Block comments are
// removed first (a `{` inside a comment would otherwise start a phantom rule),
// then braces are walked so `@media` contents are read as rules too.
function rules(source) {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const stack = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      const sel = buf.trim();
      buf = "";
      const parent = stack[stack.length - 1];
      const kf = parent ? parent.kf || /^@keyframes\b/.test(parent.sel) : false;
      out.push({ sel, inKeyframes: kf });
      stack.push({ sel, kf: kf || /^@keyframes\b/.test(sel) });
    } else if (ch === "}") {
      stack.pop();
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

test("/store2/ is the same page as /store/ — every id the engine looks up exists", () => {
  // ⚠️ The engine binds by id. A missing one is not a blank box, it is a
  // TypeError on the first line that touches it — and the whole page stops.
  const base = idsOf(baseHtml);
  const second = idsOf(html);
  assert.deepEqual([...second].sort(), [...base].sort(),
    "store2/index.html must carry exactly the ids store/index.html carries");
  assert.ok(base.length > 50, "sanity: the base page still has its ids");
});

test("every language key on the second door exists in EN, 中文 and BM", () => {
  // ⚠️ Same rule as store-i18n: a tagged node with no dictionary entry silently
  // falls back to the authored English, so a translation gap would never show
  // up as an error — only as a customer reading English in BM.
  const keys = keysOf(html);
  assert.ok(keys.length > 40, "sanity: the page still carries its language tags");
  for (const key of keys) {
    for (const l of LANGS) {
      assert.ok(STORE[l] && Object.hasOwn(STORE[l], key),
        `${l} has no "store" key for data-i18n ${key} used on /store2/`);
    }
  }
});

test("the second door loads the one engine and adds no behaviour of its own", () => {
  // ⭐ THE WHOLE DESIGN IN ONE ASSERTION. If this file ever grew a second
  // import, a listener or a `fetch`, the two shops could disagree about a
  // basket or an order — the one thing a "second look" may never do.
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const imports = [...code.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());
  assert.deepEqual(imports, ['import "../store/app.js";'],
    "store2/app.js must import the real shop, and nothing else");
  assert.doesNotMatch(code, /\b(window|document|fetch|localStorage|sessionStorage)\b/,
    "store2/app.js must not touch the page itself — behaviour belongs to store/app.js");
});

test("theme.css is loaded AFTER the base sheet, and only there", () => {
  const baseAt = html.indexOf('href="../store/app.css"');
  const themeAt = html.indexOf('href="theme.css"');
  assert.ok(baseAt > 0, "the base sheet is linked");
  assert.ok(themeAt > baseAt, "theme.css must come after store/app.css, or it cannot override anything");
  assert.equal((html.match(/href="theme\.css"/g) || []).length, 1, "theme.css is linked once");
  assert.doesNotMatch(baseHtml, /theme\.css/, "/store/ must not load the second door's skin");
});

test("the page wears the store2 class the skin is scoped to", () => {
  assert.match(html, /<body[^>]*class="[^"]*\bstore2\b/, '<body> needs class="store2"');
  assert.doesNotMatch(baseHtml, /<body[^>]*class="[^"]*\bstore2\b/, "/store/ must not wear store2");
});

test("EVERY selector in theme.css is scoped to body.store2", () => {
  // ⚠️ A rule without the prefix would restyle /store/ too, because both pages
  // share store/app.css and the same origin. `@keyframes` names are global by
  // design (they are only referenced from scoped rules), so they are exempt.
  const bad = [];
  for (const { sel, inKeyframes } of rules(css)) {
    if (inKeyframes) continue;
    if (!sel || sel.startsWith("@")) continue;
    for (const part of sel.split(",")) {
      const s = part.trim();
      if (!s) continue;
      if (!s.startsWith("body.store2")) bad.push(s);
    }
  }
  assert.deepEqual(bad, [], "these selectors would leak onto /store/: " + bad.join(" | "));
  assert.ok(rules(css).length > 100, "sanity: the walker still sees the sheet's rules");
});

test("theme.css points at nothing it does not own", () => {
  // ⚠️ No remote fonts or images (the shop must work offline-first and never
  // make a third-party request), and no path that assumes it lives somewhere
  // other than /store2/.
  const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
  for (const u of urls) {
    assert.ok(/^(\.\.\/store\/|\.\.\/images\/|data:)/.test(u),
      `theme.css may only reference ../store/, ../images/ or data: — found ${u}`);
    assert.doesNotMatch(u, /^https?:/i, `theme.css must not fetch a remote asset: ${u}`);
  }
});
