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

// The reason on a product card that can't be ordered for the chosen day, the
// line naming the next date it can be had (v90), and the notes a refresh writes
// above the menu, are built in JS rather than tagged in the HTML — so nothing
// else would notice them missing or half-translated.
test("the closed-product reason and the basket notes are keyed in all three languages", () => {
  const holders = {
    closedFrom: ["%1"],
    closedTo: ["%1"],
    closedClose: ["%1"],
    closedCloseAdvice: [],
    // The marked-day reasons. They only became reachable in v90: until a product
    // could be kept on the shop they were written for, then dropped before render.
    closedWeekday: ["%1"],
    closedUnmarked: [],
    unavailable: [],
    nextAvailable: ["%1"],
    nextAvailableLeft: ["%1", "%2"],
    sentenceEnd: [],
    fixSoldOut: ["%1"],
    fixPoolClamp: ["%1", "%2", "%3"],
    fixClamp: ["%1", "%2", "%3"],
    fixClosed: ["%1", "%2"],
    cancelNote: ["%1"],
    cancelNoteOne: [],
    orderCancelNote: ["%1"],
    orderCancelNoteOne: [],
    // The journey's last step and the courier's tracking number (v97). The step is
    // not one word — it covers both endings, Collected / Posted — and the number
    // line is built in JS, so nothing else would catch either going missing.
    trkFinal: [],
    trackingNo: ["%1"],
    // The courier's charge on the card, and the same charge when the courier
    // collects it at the door (v124 / v128). Both are built in JS off the same
    // published row, so nothing else would notice either going missing — and the
    // COD one silently falling back to the plain wording would tell the customer
    // they owe the baker money the courier is about to ask them for.
    courierCharge: ["%1"],
    courierCod: ["%1"],
    // The calendar answering a tap on a day it cannot take an order for (21 Sep
    // 2026): one she does not post, and one she does post whose window has shut.
    // Both are built in JS with the day in words, so a language losing its %1
    // would print the sentence with a hole in it and nothing else would notice —
    // and the two must not collapse into the same string, or the page would tell
    // a customer on her own posting day that she does not post that day.
    calMiss: ["%1"],
    calClose: ["%1"],
    // The code, and what it took off (v272, 2 Oct 2026). Drawn on this shop's own track
    // card as one line of words, like the courier charge beside it: the card still draws
    // no money block (its flat nationwide postage is never published, so a subtotal
    // worked out from the published total would be wrong by that fee — see paintTrack in
    // store/app.js), but the discount itself IS published on the order, so naming it is
    // exact and needs no working out. Each language must keep BOTH placeholders: a
    // translation that dropped %1 would print "Promo: -RM 10.00" without naming which
    // code it was, and one that dropped %2 would name the code and never say what came
    // off the total.
    promoLine: ["%1", "%2"],
    // ★ THE BRING-A-FRIEND DISCOUNT (v323), which carries no code and so needs its own words.
    // ⚠️ **`%1` AND NOT TWO PLACEHOLDERS, AND THAT IS THE WHOLE DIFFERENCE BETWEEN THE TWO
    // LINES**: a code has a NAME the customer typed and can check, and the friend's discount
    // has only an amount. A translation that invented a second placeholder would print an
    // empty slot where a code name goes.
    promoFriend: ["%1"],
  };
  for (const [key, phs] of Object.entries(holders)) {
    for (const l of LANGS) {
      const v = STORE[l][key];
      assert.equal(typeof v, "string", `${l}.${key} is missing`);
      for (const ph of phs) assert.ok(v.includes(ph), `${l}.${key} must keep ${ph}`);
    }
  }
});

// The per-item note's link and its empty box (v236). Both are built in JS rather
// than tagged in the HTML — the link is a <button> and the box a bare <input> —
// so nothing else on this page would notice either going missing. A language that
// never got the placeholder would open a box with no hint in it, which reads as a
// broken field rather than an optional one.
test("the per-item note's link and its hint are translated in all three languages", () => {
  for (const l of LANGS) {
    for (const key of ["addNoteLink", "lineNotePh"]) {
      assert.ok(typeof STORE[l][key] === "string" && STORE[l][key].trim(),
        `${l}.${key} is present`);
    }
  }
  assert.notEqual(STORE.zh.addNoteLink, STORE.en.addNoteLink, "Chinese is translated, not left in English");
  assert.notEqual(STORE.ms.addNoteLink, STORE.en.addNoteLink, "Bahasa Malaysia is translated, not left in English");
});

// The suggestion box under the "Website by" credit (v247). Every word of it is
// built in JS — the box, its button and the reply all come from renderFeedback —
// so nothing tagged in the HTML would ever notice a language missing them. A
// language that never got the placeholder would open an empty box with no hint,
// which reads as a broken field rather than an invitation.
test("the suggestion box is translated in all three languages", () => {
  for (const l of LANGS) {
    for (const key of ["fbPh", "fbHint", "fbSending", "fbThanks", "fbFailed", "fbEmpty"]) {
      assert.ok(typeof STORE[l][key] === "string" && STORE[l][key].trim(), `${l}.${key} is present`);
    }
  }
  assert.notEqual(STORE.zh.fbPh, STORE.en.fbPh, "Chinese is translated, not left in English");
  assert.notEqual(STORE.ms.fbPh, STORE.en.fbPh, "Bahasa Malaysia is translated, not left in English");
});

// The privacy notice, now one line under Place order plus the panel behind it (v350).
// The PDPA asks for the notice in BAHASA MALAYSIA as well as English, and a customer
// who reads the notice in the language they ordered in is the whole point of it — a
// language left in English would sit inside an otherwise translated bar and read as
// boilerplate nobody wrote for them.
//
// ⚠️ privacyLead IS GONE, and its absence is the point of v350: the notice used to
// OPEN with the Act. The Commissioner's own template opens in plain language and so
// do the large platforms, so the Act moved to the CLOSING line (privacyDate). If a
// later change brings the opener back, this list will not notice — the test that
// would is the markup one above, because the sentence would have to be authored into
// store/index.html as well.
test("the privacy notice is written in all three languages", () => {
  const keys = ["privacyLine", "privacyLink", "privacyHead", "privacyWhat", "privacyWho", "privacyKeep", "privacyContact", "privacyDate"];
  for (const l of LANGS) {
    for (const key of keys) {
      assert.ok(typeof STORE[l][key] === "string" && STORE[l][key].trim(), `${l}.${key} is present`);
    }
  }
  for (const l of LANGS.slice(1)) {
    for (const key of keys) {
      assert.notEqual(STORE[l][key], STORE.en[key], `${l}.${key} is translated, not left in English`);
    }
  }
});

// ⚠️ AND THE NOTICE CARRIES NO NUMBER. The sentence ends where the number begins, and
// store/app.js fills that from the SAME setting the order button builds its link from —
// so changing the number in Settings → Storefront moves both together, and a number
// typed into a translated string could never be left behind. A number in here would
// look correct today and be wrong the first time she changes it.
test("the privacy notice leaves the contact number to the app", () => {
  for (const l of LANGS) {
    assert.equal(/\d{6,}/.test(STORE[l].privacyContact), false,
      `${l}.privacyContact carries no number — store/app.js fills it from the settings`);
  }
});

test("the promo line is translated, not left in English", () => {
  // The line is only ever read by a customer, and only on an order that carried a code,
  // so a language left in English would sit inside an otherwise translated card and read
  // as a machine's line rather than the bakery's.
  for (const l of LANGS.slice(1)) {
    for (const key of ["promoLine", "promoFriend"]) {
      assert.ok(STORE[l][key].trim(), `${l}.${key} is present`);
      assert.notEqual(STORE[l][key], STORE.en[key], `${l}.${key} is translated, not left in English`);
    }
  }
});

test("an order with a discount and NO code reads as bring-a-friend, and never as 'Promo :'", () => {
  // ★ v323, adapted for THIS shop's card (jerky keeps its own single money line, so the
  // bakery's `moneyEls` shape is not here). The card picks its words on
  // `promo_rm > 0 && promo_code`, and that test only works because **a code always has a
  // name** — the app refuses to label one without it. If that ever stopped being true, a
  // code would start printing the friend's label.
  const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  assert.match(app, /row\.promo_rm > 0 && row\.promo_code/,
    "the card no longer draws a discount line at all");
  assert.match(app, /t\("promoFriend"\)/, "and no longer has the friend's words to draw it with");
  assert.match(app, /: row\.promo_rm > 0[\s\S]{0,200}t\("promoFriend"\)/,
    "the choice must be made ON the code being present, not on some other flag");
});

test("the COD charge is worded differently from the plain one in every language", () => {
  for (const l of LANGS) {
    assert.notEqual(STORE[l].courierCod, STORE[l].courierCharge,
      `${l}: the same string for both means the card cannot say who is being paid`);
    // COD alone reads as paying for the GOODS at the door; here the goods are already
    // paid and only the charge is collected, so each language has to say so.
    assert.ok(STORE[l].courierCod.length > STORE[l].courierCharge.length,
      `${l}: the COD line carries the instruction on top of naming the charge`);
  }
});

// A day she does not post and a day she does post whose window has shut are two
// different facts, and the second one sits on a day the card above the grid names
// as a posting day. One string for both would have the page contradict itself.
test("a closed posting day is not described as a day she does not post", () => {
  for (const l of LANGS) {
    assert.notEqual(STORE[l].calClose, STORE[l].calMiss, `${l}: one sentence for two facts`);
  }
  // English is the only language this can be read off, and it is the one the
  // contradiction would be spotted in first.
  assert.ok(!STORE.en.calClose.includes("not a posting day"), "the day is still denied");
});

test("placeholders and the html-track hint are keyed too", () => {
  const ph = tagKeys("data-i18n-ph");
  assert.ok(ph.includes("namePh") && ph.includes("whatsPh"));
  for (const k of tagKeys("data-i18n-html")) {
    for (const l of LANGS) assert.ok(STORE[l][k].includes("<strong>"), `${l}.${k} keeps its <strong>`);
  }
});

test("the shop has a way back to the homepage, and it points at a page that exists", () => {
  const m = html.match(/<a\b[^>]*id="home-link"[^>]*>/);
  assert.ok(m, "the shop page carries a home link");
  const tag = m[0];
  assert.match(tag, /href="\/"/, "it points at the site root — the homepage");

  // The root is the homepage only because a page is served there; a link to a
  // path with nothing behind it is a 404 wearing a nav item's clothes.
  const root = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(root, /<html\b/, "index.html is served at the root the link points to");

  // And it is a shop-page string like any other: keyed, and actually translated.
  assert.match(tag, /data-i18n="homeLink"/, "the label is a translated string");
  for (const l of LANGS) assert.ok(STORE[l].homeLink.trim(), `${l}.homeLink is present`);
  assert.notEqual(STORE.zh.homeLink, STORE.en.homeLink, "Chinese is translated, not left in English");
  assert.notEqual(STORE.ms.homeLink, STORE.en.homeLink, "Bahasa Malaysia is translated, not left in English");
});

// The privacy notice moved to the order bar (v350): one line under Place order, and the
// four facts in a panel behind it. Three things can break it silently, and all three are
// invisible to any test that stops at "the string is translated".
//
//   1. THE PRESS AND THE PANEL MUST NAME EACH OTHER. The button carries aria-controls and
//      store/app.js looks the panel up by id. Rename the panel and forget the button and
//      the press becomes a DEAD CONTROL — it looks pressable, does nothing, and a PDF of
//      the copy would still read perfectly.
//   2. THE LINE MUST NOT SHRINK. It is the only place the notice is given now, and the
//      Commissioner's guide warns against a font "so small that it results in the data
//      subject not reading the PDP Notice". 12.5px is the floor — the size the v348 block
//      used — not a starting point to tune down later.
//   3. THE SPACER MUST CLEAR THE TALLEST LANGUAGE. The bar is fixed over the page, so a
//      spacer shorter than the closed bar hides the last row of the shop behind it. The
//      bar is tallest in Bahasa Malaysia, which is why 136px is the number and 118px
//      (English) is not.
test("the privacy line opens the panel it names, and is not set too small to read", () => {
  const btn = html.match(/<button\b[^>]*id="privacy-open"[^>]*>/);
  assert.ok(btn, "the order bar carries the press that opens the notice");
  const controls = btn[0].match(/aria-controls="([^"]+)"/);
  assert.ok(controls, "the press says which panel it opens");
  const sheet = html.match(new RegExp(`<div\\b[^>]*id="${controls[1]}"[^>]*>`));
  assert.ok(sheet, `the panel the press names (${controls[1]}) exists on the page`);
  assert.match(btn[0], /aria-expanded="false"/, "it starts closed, and says so out loud");
  assert.match(sheet[0], /\bhidden\b/, "the panel starts hidden");

  // The four facts and the Act are authored into the page, not only into the dictionary —
  // the panel is the notice, so a key missing here is a fact the customer never reads.
  for (const key of ["privacyWhat", "privacyWho", "privacyKeep", "privacyContact", "privacyDate"]) {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `${key} is authored into the page`);
  }

  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  const size = css.match(/\.order-notice\s*\{[^}]*font-size:\s*([\d.]+)px/);
  assert.ok(size, ".order-notice sets its own size");
  assert.ok(Number(size[1]) >= 12.5,
    `the line is at least 12.5px (it is ${size[1]}px) — it is the only place the notice is given`);

  const spacer = css.match(/\.bar-spacer\s*\{\s*height:\s*([\d.]+)px/);
  assert.ok(spacer, ".bar-spacer sets its own height");
  assert.ok(Number(spacer[1]) >= 118,
    `the spacer clears the TALLEST language on the NARROWEST screen (measured 118px: Bahasa Malaysia at 320px, where the line wraps to two — it is ${spacer[1]}px)`);
});

// ⚠️ renderStatic() RUNS AGAIN ON EVERY RENDER AND ON EVERY LANGUAGE SWITCH — its own
// comment says so (store/app.js ~L944, "renderStatic() runs again on every language
// switch"). A listener bound inside it is therefore bound AGAIN each time it runs, and that
// is harmless for a handler that SETS a state — but fatal for one that TOGGLES it: two
// bindings cancel out and the control reads as DEAD.
//
// That is exactly what shipped in v350 and v351. Pressing the words under Place order did
// NOTHING on a freshly loaded shop, and opened the notice after one language switch. It got
// past every check because one press was driven, not two, and because the parity at that
// moment happened to be odd. Driving the press twice in a row is what exposes it.
//
// So this is an invariant, and it is broad on purpose: renderStatic must bind NO event
// listener at all. Anything the shop needs bound belongs at module scope, where the language
// pills are bound, because the bar's markup is static HTML that is never replaced.
test("renderStatic binds no event listeners, because it runs more than once", () => {
  const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  const at = src.indexOf("export function renderStatic(");
  assert.ok(at > -1, "renderStatic exists in store/app.js");
  const rest = src.slice(at + 1);
  const nextExport = rest.search(/\nexport (function|const|let) /);
  const body = nextExport > -1 ? rest.slice(0, nextExport) : rest;
  const binds = body.match(/addEventListener\(/g) || [];
  assert.equal(binds.length, 0,
    `renderStatic() binds ${binds.length} listener(s). It runs again on every render and every language switch, so a binding there is a binding REPEATED — and a TOGGLE bound twice cancels itself out, so the control looks dead on a fresh page and works after a language switch. Bind once at module scope instead.`);
});
