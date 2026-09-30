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
    // The "have a code?" box and the line under the offer it produces. All four
    // of these are built in JS — the note carries the basket's own figure and the
    // box's two HTML labels sit on nodes the authored-copy walk cannot pair up —
    // so nothing else would notice one going missing or losing its %1.
    codeNoteLater: [],
    codeNoteAdd: ["%1"],
    codeUnknown: [],
    codeNotePlain: [],
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
