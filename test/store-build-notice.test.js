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

import { BUILD_TRIED_KEY, VERSION_URL, assetsToRefresh, buildIn, newerBuild } from "../store/build.js";
import { ENGINE_VERSION } from "../admin/js/version.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
// ⚠️ THE BUILD THE SHOP'S OWN FILE CARRIES — read out of its source, because `store/app.js`
// calls `render()` at the top level and **no test can import it at all** (v492).
const SHOP_BUILD = (() => {
  const m = /export const SHOP_BUILD = "(\d+)"/.exec(read("../store/app.js"));
  return m ? m[1] : null;
})();
const app = read("../store/app.js");
const html = read("../store/index.html");
const css = read("../store/app.css");

test("★★★ the shop's own build is written into the shop's own file, and kept in step (v496)", () => {
  // ⚠️⚠️ HER REPORT: __"now v495, but store at v494, why no update warning at store?"__ ⭐ **The notice
  // used to read BOTH numbers out of `admin/js/version.js`** — this page's build by importing it, and the
  // site's by fetching it. ⚠️ **Two readings of one file cannot disagree about which build the CODE is**,
  // so a browser that revalidated that little file made a shop running month-old `store/app.js` report
  // itself as current. **The one fault the notice exists to catch was the one it could not see.**
  assert.ok(SHOP_BUILD, "the shop's own file no longer carries a SHOP_BUILD at all — the notice has "
    + "nothing honest to compare the site against");
  // ⭐ AND IT MUST MATCH THE MASTER. This is a SECOND place for one fact, accepted only because a
  // forgotten bump is a red suite rather than a shop that lies about which build it is.
  assert.equal(SHOP_BUILD, String(ENGINE_VERSION),
    `⚠️⚠️ the shop's file says it is build ${SHOP_BUILD} and \`admin/js/version.js\` says ${ENGINE_VERSION} `
    + "— bump SHOP_BUILD in store/app.js with the engine, or the shop will report the wrong build and the "
    + "update notice will compare the wrong number");
  // ⚠️ AND THE PAGE MUST MEASURE ITSELF WITH THAT LITERAL, NEVER WITH AN IMPORTED DEFAULT.
  assert.match(app, /newerBuild\(text, SHOP_BUILD\)/,
    "★ the probe is not comparing against the build THIS FILE is — a page whose version import is fresh "
    + "will call itself current while running old code");
  // ⚠️ `running` HAS NO DEFAULT ANY MORE, and that is the guard: a default is a number a caller can lean
  // on by accident, and the default WAS the fault.
  const fn = read("../store/build.js");
  assert.doesNotMatch(fn, /newerBuild\(servedText,\s*running\s*=/,
    "★ `newerBuild` has a default build again — the caller must say which build it is");
  assert.doesNotMatch(fn, /import \{ ENGINE_VERSION \}/,
    "★ `store/build.js` imports the version file again, which is the file it probes");
});

test("★★★ a page running OLD code says so — the exact case she reported (v496)", () => {
  // ⭐ The whole point, written as the case that failed on her phone: the site is serving 496 and this page
  // was loaded as 495. ⚠️ Before v496 this comparison could not be made at all, because the "495" would
  // have come out of the same file the site's number did.
  assert.equal(newerBuild(`export const ENGINE_VERSION = "496";`, "495"), true,
    "★ a page one build behind is being told it is current — this is the report, unfixed");
  // ⚠️ AND THE OTHER DIRECTION, so this is not a greater-than: an older site is still a different build.
  assert.equal(newerBuild(`export const ENGINE_VERSION = "494";`, "495"), true);
  assert.equal(newerBuild(`export const ENGINE_VERSION = "495";`, "495"), false,
    "★ a current page is being told it is stale — the shop would cry wolf on every visit");
});



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
  assert.equal(newerBuild(onDisk, SHOP_BUILD), false,
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
    assert.equal(newerBuild(served, SHOP_BUILD), false, `${what} must read as "cannot tell", not as a warning`);
  }
});

test("it says so when the site is serving a different build, in either direction", () => {
  const here = String(ENGINE_VERSION);
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${here}";`, here), false, "the same build is not news");
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${Number(here) + 1}";`, here), true,
    "a newer build on the site must raise it");
  // ⚠️ AND THE OTHER DIRECTION, which is what an inequality buys: a phone holding a stale COPY of
  // the version file would make this page look AHEAD of the site. That is just as wrong as being
  // behind, and it deserves the same sentence — a "greater than" comparison would sit there and
  // say nothing at all.
  assert.equal(newerBuild(`export const ENGINE_VERSION = "${Number(here) - 1}";`, here), true,
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
  // ⚠️ MEASURED BY THE TAG, not by a class name (v634): the header now wears `hero hero-photo`, and a check
  // written against the exact string `class="hero"` reported the notice as missing the moment the hero
  // gained a second class. ⭐ A structural rule is asserted on the structure.
  assert.ok(html.indexOf('id="build-notice"') > -1 && html.indexOf('id="build-notice"') < html.indexOf("<header"),
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

test("★★★ THE PRESS RE-ASKS FOR THE FILES, OR IT CHANGES NOTHING (v656)", () => {
  // ⚠️⚠️ HER REPORT, 2026-10-27: __"it fail to refresh again on browser"__ — and the build was already
  // pushed. **A bare `location.reload()` re-asks for the PAGE and takes `app.css` and every module
  // from the browser's own ten-minute copy**, so the page returns new with the old stylesheet and a
  // second press cannot help. ⭐ `cache: "reload"` is the whole fix: **a plain `fetch` there would be
  // served from the very cache that is the problem**, which is the fault this test exists to stop
  // anyone reintroducing.
  const bind = app.indexOf('buildBtn.addEventListener("click"');
  assert.ok(bind > 0, "nothing presses the reload button");
  const press = app.slice(bind, bind + 900);
  assert.match(press, /freshenAssets\(\)/, "the press no longer re-asks for the page's own files");
  // ⚠️ AND THE RELOAD IS REACHED ONLY THROUGH THE RE-ASK — held in `go` and fired from the race, so
  // no path can reload first and read the old copies anyway.
  assert.match(press,
    /const go = \(\) => \{[\s\S]*?location\.reload\(\);[\s\S]*?\};\s*Promise\.race\(\[freshenAssets\(\),[^\]]*\]\)\.then\(go, go\);/,
    "⚠️ the reload is no longer reached through the re-ask");
  // ⚠️ THE `cache: "reload"` IS THE FIX ITSELF — and it lives in `freshenAssets`, which is why the
  // assertion follows the name rather than the press.
  const def = app.indexOf("async function freshenAssets()");
  assert.ok(def > 0, "the re-ask is gone");
  assert.match(app.slice(def, def + 600), /cache: "reload"/,
    "⚠️ a plain fetch is answered from the cache that is the fault");
  // ⚠️ AND IT CANNOT HANG: a slow connection must not leave a customer pressing a dead button.
  assert.match(press, /Promise\.race\(/, "the re-ask is no longer raced with a beat");
});

test("★★ the list of files to re-ask for is the PAGE'S OWN — never a hand-kept list", () => {
  // ⚠️ A module graph cannot be known from `build.js`, and a written-out list of filenames goes stale
  // on the first file anyone adds — silently, because a missing name simply is not refreshed. The
  // browser already knows exactly what this page loaded.
  assert.match(app, /getEntriesByType\("resource"\)/, "the page no longer asks itself what it loaded");
  const origin = "https://munchies.com.my";
  const kept = assetsToRefresh([
    { name: `${origin}/store/app.css` },
    { name: `${origin}/store/app.js` },
    { name: `${origin}/admin/js/promo.js` },
    { name: `${origin}/store/app.css` },                       // the same file twice
    { name: `${origin}/store/fonts/ShantellSans-Regular-latin.woff2` },
    { name: `${origin}/images/chicken-jerky.jpg` },            // a photograph: a build never names one
    { name: "https://ircwozniiyywsowamixy.supabase.co/rest/v1/x" }, // not ours
    { name: "https://api.bigdatacloud.net/data/x" },               // not ours
    { name: "blob:https://munchies.com.my/9c1e" },                 // not a file
    { name: "data:text/css,body{}" },                              // not a file
    {},                                                            // a stub with no name
  ], origin);
  assert.deepEqual(kept, [
    `${origin}/store/app.css`,
    `${origin}/store/app.js`,
    `${origin}/admin/js/promo.js`,
    `${origin}/store/fonts/ShantellSans-Regular-latin.woff2`,
  ], "⚠️ another site must never be re-asked, and one file must be asked once");
  // ⚠️ And it answers an empty list rather than throwing when the browser offers nothing at all.
  assert.deepEqual(assetsToRefresh(undefined, origin), []);
  assert.deepEqual(assetsToRefresh([], origin), []);
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

test("★★★ the notice is the BACKOFFICE'S STRIP, at the size she asked for (v501)", () => {
  // ⚠️⚠️ HER WORDS: __"now see the warning, it is rather small. it should be a strip like what is having in
  // the backoffice"__ — ⭐ **"like the backoffice" means the PATTERN, not a near-miss.** And then the two
  // reports that followed, which are the whole of this test:
  //
  //   __"appp had the message pin together with the bottom menu, so it appaer regardless of the scroll, but
  //   not store"__  — it has to be SEEN, whatever the customer is reading.
  //   __"why the step 3, self collection choice not clear?"__ — ⭐ **MEASURED: with the strip pinned at the
  //   bottom, "Self collect" sat 23px behind it and "Courier delivery" 87px.**
  //   __"i want it to be consistant with the app"__ — ⭐ **which settles it, because the app's strip is pinned
  //   above its tab bar WITH ROOM RESERVED FOR IT.**
  //
  // ⭐⭐ **THE RESERVED ROOM IS THE FIX, NOT THE EDGE IT HANGS FROM.** A pinned bar covers the bottom of the
  // screen at all times — **but with the page's foot grown by the strip's own measured height, there is
  // always somewhere to scroll a control into.** ⚠️ **Without that room the cover is for good**, which is
  // exactly what she reported.
  // ⚠️ NO TEST CAN SEE A SCREEN, so the strip is pinned as its RULE AND ITS NUMBERS.
  const notice = css.slice(css.indexOf(".build-notice {"), css.indexOf(".build-notice[hidden]"));
  const btn = css.slice(css.indexOf(".build-btn {"), css.indexOf(".build-btn:hover"));

  // ⭐ THE ADMIN'S OWN AMBER PAIR, VERBATIM — the two files define their own tokens, so this copy is what keeps
  // the two screens agreeing about one colour.
  assert.match(notice, /background:\s*var\(--amber-bg\)/,
    "★ the strip has left the backoffice's amber background");
  assert.match(css, /--amber:\s*#975a13;/, "the shop no longer carries the admin's --amber");
  assert.match(css, /--amber-bg:\s*#fdf1dc;/, "the shop no longer carries the admin's --amber-bg");

  // ⚠️ BODY SIZE, NOT A CAPTION — this is a sentence on a strip meant to be read.
  const size = /font-size:\s*(\d+)px/.exec(notice);
  assert.ok(size && Number(size[1]) >= 16,
    "★ the strip's words are smaller than body size again — a caption is how this got missed twice");

  // ⚠️⚠️ AND A REAL PRESS: 44px, FILLED — not the inline link inside a sentence she reported as too small.
  // ⭐ It still must not read as an ALARM: nothing went wrong and the customer did nothing wrong, so no red.
  const tall = /min-height:\s*(\d+)px/.exec(btn);
  assert.ok(tall && Number(tall[1]) >= 44,
    "★ the press is below 44px — the floor for anything a thumb hits, and she has reported this smallness twice");
  assert.match(btn, /background:\s*var\(--brown-dark\)/, "★ the press is not filled — it is the ACTION here");
  assert.match(btn, /color:\s*var\(--surface\)/,
    "★ `--surface` on `--brown-dark` is 5.92:1 — the pair every press in this shop uses");
  assert.doesNotMatch(notice + btn, /var\(--red\)/,
    "★ the strip has gone red — nothing has failed and the customer did nothing wrong");

  // ⚠️⚠️ PINNED ABOVE THE ORDER BAR, WHERE THE APP PUTS ITS OWN — and that is her instruction.
  assert.match(notice, /position:\s*fixed/,
    "★ the strip is not pinned — it scrolls away with the page, which is the first thing she reported");
  assert.match(notice, /bottom:\s*var\(--bar-h/,
    "★ the strip is not pinned ABOVE the order bar — it would sit on top of the button the customer presses");
  assert.match(notice, /z-index:\s*31/, "★ the strip must sit just above the order bar's 30");

  // ⚠️⚠️ AND THE ROOM RESERVED FOR IT IS WHAT MAKES THAT LIVABLE. The page's foot grows by the strip's own
  // MEASURED height, so a control can always be scrolled clear of it.
  assert.match(app, /export function measureUpdateStrip\(\)/, "★ there is no measuring function at all");
  assert.match(app, /setProperty\("--strip-h"/, "★ nothing measures the strip, so the page cannot reserve room");
  const pad = css.slice(css.indexOf("  padding: 14px 14px calc(var(--bar-h"),
    css.indexOf(";", css.indexOf("  padding: 14px 14px calc(var(--bar-h")));
  assert.match(pad, /var\(--strip-h/,
    "★ the page's foot does not reserve the strip's height — **the pinned strip would cover whatever is at "
    + "the bottom of the page FOR GOOD, because there is no room to scroll it clear**, which is precisely "
    + "what she reported about the Self collect choice");
  // ⚠️ AND IT IS RE-MEASURED WHEN THE SENTENCE'S LENGTH CHANGES: on a resize, and after a language switch
  // (中文 and Malay are different lengths, and the length is what decides one row or two).
  assert.match(app, /window\.addEventListener\("resize", measureUpdateStrip\)/,
    "★ the strip is not re-measured on a resize — a wrapped sentence would outgrow the reserved room");
  assert.match(app, /setLang\(b\.dataset\.lang\);\s*\n\s*measureUpdateStrip\(\);/,
    "★ the strip is not re-measured after a language switch");
  assert.match(app, /document\.documentElement\.style\.setProperty\("--bar-h"/,
    "★ nothing measures the order bar — the page's own foot padding is built on that number");
});

