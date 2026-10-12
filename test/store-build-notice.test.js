// test/store-build-notice.test.js — can a CUSTOMER's phone tell that the shop it is looking at is
// not the shop we are serving?
//
// Her words: __"just build the shop warning"__ (v492).
//
// ⚠️⚠️ WHY THE SHOP NEEDED THIS AND THE APP ALREADY HAD IT: GitHub Pages serves `store/` with
// `cache-control: max-age=600` and no build number in any URL, so a price change, a closed day or a
// new field can be pushed and NOT arrive. The backoffice has had a strip saying so since v255; the
// shop never did — **and it matters more here, because the person reading it is a customer who has
// no way of knowing, and an order placed against old code is a real order placed wrongly.**
//
// ⭐ THE WHOLE VALUE RESTS ON ONE THING, and this file exists to pin it: **a page that cried "out of
// date" on a bad connection would be worse than one that never spoke.** So the comparison answers
// FALSE whenever it cannot tell, and every "cannot tell" that could plausibly happen on a phone is
// written out below as its own case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BUILD_TRIED_KEY, VERSION_URL, buildIn, newerBuild } from "../store/build.js";
import { ENGINE_VERSION } from "../admin/js/version.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = read("../store/app.js");
const html = read("../store/index.html");
const css = read("../store/app.css");

test("★★ the pattern still matches the version file the site actually ships", () => {
  // ⚠️⚠️ THE ONE SILENT DEATH OF THIS FEATURE. The pattern is matched against a HAND-WRITTEN file.
  // Reformat `admin/js/version.js` — a line break, a different quote, a `const` with no spaces — and
  // the notice simply stops speaking for ever. **Nothing looks broken, no test about the notice
  // fails, and the customer goes on ordering off a stale page.**
  const onDisk = read("../admin/js/version.js");
  assert.match(onDisk, /ENGINE_VERSION/, "the version file no longer contains ENGINE_VERSION at all");
  // ⚠️⚠️ THE READ IS ASKED FOR BY NAME, NOT THROUGH `newerBuild`, AND THAT IS THE WHOLE POINT.
  // `newerBuild` answers `false` both when the two builds AGREE and when it could not read the file
  // — so an assertion on `newerBuild` alone **passes with the pattern broken**, which is exactly
  // what the first version of this test did. ⭐ MEASURED: biting the pattern to single quotes left
  // this test green. The number has to be read back and named.
  assert.equal(buildIn(onDisk), String(ENGINE_VERSION),
    "the pattern no longer reads the build number out of the file the site actually ships — "
    + "⚠️ the notice would go silent for ever, and nothing would look broken");
  assert.equal(newerBuild(onDisk), false,
    "the shipped version file is being read as a DIFFERENT build — the shop would show a "
    + "stale-page warning on a page that is current");
  // And it is the file the shop is pointed at, not just any file: the probe's address has to be the
  // page's own build number, or the two numbers being compared are not the same kind of thing.
  assert.equal(VERSION_URL, "../admin/js/version.js");
  assert.match(app, /fetch\(VERSION_URL, \{ cache: "no-store" \}\)/,
    "the probe no longer uses VERSION_URL, or no longer refuses the cache — "
    + "⚠️ a probe answered from a cache is the very thing it is checking for");
});

test("★★ it answers FALSE whenever it cannot tell — every way that happens on a phone", () => {
  // ⚠️⚠️ THIS IS THE SAFETY OF THE WHOLE FEATURE, so each case is separate and named. A customer
  // reading "close this page and open it again" over a bakery's prices, when nothing is wrong, is a
  // customer who has been told the shop is broken. **The doubt is spent on silence.**
  const cases = [
    ["an empty answer — offline, or a response with no body", ""],
    ["no answer at all (a failed fetch handing over nothing)", null],
    ["undefined", undefined],
    ["a figure the file cannot be reached — a router's login page", "<html><body>Sign in</body></html>"],
    ["the file, but the name is not on it", "export const OTHER = \"1\";"],
    ["the name, but the value is not quoted — a build script's edit", "ENGINE_VERSION = 492"],
    ["a value that is not a number at all", "ENGINE_VERSION = \"v492\""],
    ["the name glued to another word, as in a comment about it", "// ENGINE_VERSION_OLD = \"1\""],
  ];
  for (const [what, served] of cases) {
    assert.equal(newerBuild(served), false, `${what} must read as "cannot tell", not as a warning`);
  }
});

test("it says so when the site is serving a different build, in either direction", () => {
  const here = String(ENGINE_VERSION);
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${here}";`), false, "the same build is not news");
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${Number(here) + 1}";`), true,
    "a newer build on the site must raise it");
  // ⚠️ AND THE OTHER DIRECTION, which is what an inequality buys: a phone holding a stale COPY of
  // the version file would make this page look AHEAD of the site. That is just as wrong as being
  // behind, and it deserves the same sentence — a "greater than" comparison would sit there and
  // say nothing at all.
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${Number(here) - 1}";`), true,
    "an OLDER build on the site is still a different build — this is not a greater-than");
});

test("★ the notice is in the page, above everything, and starts hidden", () => {
  // ⚠️ It is static markup rather than something app.js builds, because the first paint of an order
  // is the moment that matters and a bar that appears one script later is a bar a customer has
  // already scrolled past.
  const bar = html.match(/<div class="build-notice" id="build-notice"[^>]*>/);
  assert.ok(bar, "the shop page has no build notice at all");
  assert.match(bar[0], /\bhidden\b/, "⚠️⚠️ it must START hidden — a notice that is up from the "
    + "first paint of every order is the fault wearing the fix's clothes");
  assert.ok(html.indexOf('id="build-notice"') < html.indexOf('class="hero"'),
    "it must sit ABOVE the header — it is about the whole page, not about the shop's front");
  // The three pieces the paint turns between, each addressed by name.
  for (const id of ["build-say", "build-stuck", "build-reload"]) {
    assert.ok(html.includes(`id="${id}"`), `the notice has no #${id}`);
  }
  // ⚠️ AND EVERY ONE OF THEM IS A TRANSLATED STRING. A sentence about the page, left in English
  // inside an otherwise Chinese shop, reads as a machine's line rather than the bakery's.
  for (const key of ["buildStale", "buildStuck", "buildReload"]) {
    assert.ok(html.includes(`data-i18n="${key}"`), `${key} is not keyed in the markup`);
  }
});

test("★★ the reload press belongs to the SECOND state, and the first has one too", () => {
  // Her page's own rule, stated all over the shop: **a dead button is worse than no button.** The
  // press is offered while it can still help, and once it has been tried and shown not to work the
  // page stops offering it and says what actually does.
  assert.match(app, /if \(say\) say\.hidden = tried;/, "the first sentence is no longer turned off after a try");
  assert.match(app, /if \(stuck\) stuck\.hidden = !tried;/, "the second sentence is no longer turned ON after a try");
  assert.match(app, /if \(btn\) btn\.hidden = tried;/, "⚠️ the press is still offered after it has failed");
});

test("★★ the try is remembered across the reload THAT IS THE WHOLE PROBLEM", () => {
  // ⚠️⚠️ Memory cannot hold it: pressing Reload reloads the page, and a page reload wipes memory —
  // which is precisely the flag that has to survive. `sessionStorage` is the only one of the three
  // that is both durable across a reload and gone by tomorrow (a `localStorage` flag would still be
  // set on the next visit and would hide a genuine notice).
  assert.match(app, /sessionStorage\.getItem\(BUILD_TRIED_KEY\)/);
  assert.match(app, /sessionStorage\.setItem\(BUILD_TRIED_KEY,/);
  assert.doesNotMatch(app, /localStorage\.setItem\(BUILD_TRIED_KEY\)/,
    "localStorage would carry the flag into tomorrow and hide a real notice");
  // ⚠️ The flag names THIS site, so a phone with both shops open cannot read the other's.
  // ⚠️⚠️ MUNCHIES' OWN NAMESPACE, NOT THE BAKERY'S — the bakery's shop runs on the same phones.
  assert.match(BUILD_TRIED_KEY, /^munchies\./,
    "the flag must be namespaced to this site — the bakery's shop runs on the same phones");
  // And the press REMEMBERS BEFORE IT RELOADS, or the reload lands back on the same button.
  const bind = app.indexOf('buildBtn.addEventListener("click"');
  assert.ok(bind > 0, "nothing presses the reload button");
  assert.ok(app.slice(bind, bind + 260).indexOf("rememberBuildTried()") > 0,
    "⚠️ it reloads before it remembers — the customer lands back on the same button, which then "
    + "does nothing a second time");
});

test("★ the notice is bound ONCE, outside the repaint", () => {
  // ⚠️⚠️ THE FAULT THIS PAGE HAS SHIPPED TWICE (v350, v351): a listener bound inside `renderStatic`
  // is bound again on every render and on every language switch, and an EVEN number of bindings
  // cancel out — so the control looks dead on a fresh page and works after one language switch.
  // The markup for this notice is static HTML that is never replaced, so one binding lasts the life
  // of the page — and it has to be exactly one.
  const hits = app.split('buildBtn.addEventListener("click"').length - 1;
  assert.equal(hits, 1, `the reload press is bound ${hits} times — it must be bound exactly once`);
});

test("★ it asks on arrival, on the same beat as the order data, and never holds the page up", () => {
  // A customer who has just opened the shop is the one most likely to be holding a ten-minute-old
  // page, so the check rides the refresh that is already there rather than a timer of its own.
  assert.match(app, /setInterval\(poll, 30000\);[\s\S]{0,900}?\n\s*checkBuild\(\);/,
    "the arrival check is gone from the polling block");
  const pollAt = app.indexOf("const poll = async () => {");
  assert.ok(pollAt > 0, "the polling function has been renamed");
  const pollBody = app.slice(pollAt, app.indexOf("};", pollAt));
  assert.match(pollBody, /checkBuild\(\)/,
    "the 30-second beat no longer re-checks the build — a customer sitting on the shop would "
    + "never be told, however long they sat there");
  // ⚠️ AND IT IS NOT AWAITED on the way in: an order must never be held up by a question about
  // which build the phone is on.
  assert.doesNotMatch(app, /await checkBuild\(\)/, "the check is being waited on");
  // ⚠️ Once the notice is up there is nothing more to learn, and this runs every 30 seconds.
  assert.match(app, /if \(box && !box\.hidden\) return;/, "it re-asks every 30s for an answer it has");
});

test("★★ `display: flex` cannot beat `[hidden]` — the rule that stops the bar showing always", () => {
  // ⚠️⚠️ THIS IS ONE LINE AND IT IS THE DIFFERENCE BETWEEN THE FEATURE AND A PERMANENT BANNER.
  // The bar is `display: flex`, and the browser's own `[hidden] { display: none }` is a UA rule —
  // **a class selector outranks it.** Without these rules the notice would be on screen from the
  // first paint of EVERY order, which is the fault wearing the fix's clothes.
  assert.match(css, /\.build-notice\s*\{[^}]*display:\s*flex/,
    "the bar is no longer flex, so this test's premise has moved");
  assert.match(css, /\.build-notice\[hidden\]\s*\{\s*display:\s*none;?\s*\}/,
    "⚠️⚠️ `.build-notice[hidden]` has no rule — `display: flex` outranks the browser's `[hidden]`, "
    + "so the notice would be on screen on every order, always");
  assert.match(css, /\.build-say\[hidden\]\s*\{\s*display:\s*none;?\s*\}/, "the two sentences need it too");
  assert.match(css, /\.build-btn\[hidden\]\s*\{\s*display:\s*none;?\s*\}/, "and so does the press");
});

test("the notice is a sentence with a press in it, not an alarm", () => {
  // ⚠️ Nothing has gone wrong and the customer did nothing wrong, so it must not read as a failure.
  // The shop's own worst background is `--surface`, and `--brown-dark` on it is 5.92:1 — over the
  // 4.5 every word of this page is held to, and the same pair the shop's inline links already use.
  const rule = css.slice(css.indexOf(".build-notice {"));
  const btn = rule.slice(rule.indexOf(".build-btn {"), rule.indexOf(".build-btn:hover"));
  assert.match(btn, /color:\s*var\(--brown-dark\)/,
    "the press has left the shop's own inline-link colour");
  assert.doesNotMatch(btn, /var\(--red\)/,
    "a red press over a bakery's prices reads as a failure — nothing has failed");
  assert.doesNotMatch(rule.slice(0, rule.indexOf(".build-btn {")), /var\(--red\)/,
    "the bar itself must not be the shop's warning red");
});
