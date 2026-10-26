// test/store-full-day.test.js — the shop: what a tapped full bake day answers.
//
// ⚠️ THE FAULT THIS EXISTS FOR. A day with no pans left was a struck-through number and a DEAD TAP: not a
// button, no words, and nothing telling a customer when they could have bread. Three states — open, full,
// not a bake day — were drawn so alike that only the colour separated them.
//
// The answer is driven on `store/full_day.js`, which is the rule the page actually calls (a source check
// below pins that). The wiring is checked by reading the page, because the page cannot be imported without
// a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isoOf, nextOpenAfter, fullDayAnswer } from "../store/full_day.js";
import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const d = (iso) => new Date(`${iso}T00:00:00`);

// October 2026 in the shape `daySpecs()` hands over: two full days and three open ones.
const SPECS = [
  { date: d("2026-10-26"), soldOut: false },
  { date: d("2026-10-28"), soldOut: true },
  { date: d("2026-10-30"), soldOut: true },
  { date: d("2026-11-02"), soldOut: false },
  { date: d("2026-11-04"), soldOut: false },
];

test("★★★ a day's key is the LOCAL calendar day, never a UTC one (v631_2)", () => {
  // ⚠️ A UTC key moves the day for every customer in Malaysia after 8am — the shop has paid for this class
  // of fault before, so the format is pinned rather than assumed.
  assert.equal(isoOf(d("2026-10-03")), "2026-10-03");
  const late = new Date(2026, 9, 3, 23, 30);      // 11:30pm local, already the 4th in UTC
  assert.equal(isoOf(late), "2026-10-03", "★ the key followed UTC and named tomorrow");
});

test("★★★ a full day offers the NEXT open day, never itself (v631_2)", () => {
  // 30 Oct is ALSO full, so the answer skips it — a full day is never its own way out.
  assert.equal(isoOf(nextOpenAfter(SPECS, "2026-10-28").date), "2026-11-02",
    "★ another full day was offered as the way out");
  // Strictly later: asking about a day with something open before it still looks forward.
  assert.equal(isoOf(nextOpenAfter(SPECS, "2026-10-25").date), "2026-10-26");
  // Nothing left at all — the page then says so rather than naming a day that is also full.
  assert.equal(nextOpenAfter(SPECS, "2026-11-04"), null, "a day past the last open one still named something");
  assert.equal(nextOpenAfter([], "2026-10-28"), null);
  assert.equal(nextOpenAfter(null, "2026-10-28"), null);
});

test("★★★ the answer says whether the day is STILL full (v631_2)", () => {
  const full = fullDayAnswer(SPECS, "2026-10-30");
  assert.equal(full.full, true);
  assert.ok(full.next, "★ a full day was answered with no way onwards");
  // ⚠️ A refresh can free the day: the note must go rather than stay on screen saying something untrue.
  const freed = SPECS.map((s) => (isoOf(s.date) === "2026-10-30" ? { ...s, soldOut: false } : s));
  assert.equal(fullDayAnswer(freed, "2026-10-30").full, false,
    "★ the page would keep saying 'full' about a day that has room again");
  assert.equal(fullDayAnswer(SPECS, "2026-01-01").full, false, "a day not on offer at all was called full");
});

test("★★★ the shop draws the stamp, makes a full day a press, and uses this rule (v631_2)", () => {
  const src = read("store/app.js");
  assert.match(src, /"cal-stamp", "aria-hidden": "true" \}, t\("calFull"\)/,
    "★ a full day has no word on it — three states look alike again");
  // ⚠️ MUNCHIES ADDS `askable || closed` — its own answer to a tap on a day it cannot act on (21 Sep),
  // so the condition is the bakery's plus those two.
  assert.match(src, /if \(open \|\| named \|\| askable \|\| closed \|\| \(full && !past\)\)/,
    "★ a full day is a dead tap again: not a button, so nothing can answer");
  assert.match(src, /const answer = fullDayAnswer\(specs, fullIso\)/,
    "★ the page answers from a rule of its own instead of the tested one");
  assert.match(src, /fullIso \? fullNote\(specs, weeks\) : soldOutLine/,
    "the tapped day's answer is never drawn");
  // And the press inside the answer chooses the day, marking it as their own choice.
  assert.match(src, /selected = dateKey\(next\.date\);\s*\n\s*dayPicked = true;/,
    "★ the way out does not choose the day it names");
});

test("★★ the new words exist in all three languages and are not placeholder copies (v631_2)", () => {
  const keys = ["calFull", "fullDaySay", "fullDayNext", "fullDayChoose", "fullDayNone"];
  for (const key of keys) {
    const values = LANGS.map((l) => STORE[l] && STORE[l][key]);
    assert.ok(values.every((v) => typeof v === "string" && v.length > 0),
      `★ ${key} is missing in one language — the shop would print English at a 中文 reader`);
    // ⚠️ TWO LANGUAGES MUST NOT BE THE SAME STRING: a copied English line passes a key-set check.
    if (key !== "calFull") {
      assert.notEqual(values[1], values[0], `★ ${key} 中文 is the English line`);
      assert.notEqual(values[2], values[0], `★ ${key} Bahasa Malaysia is the English line`);
    }
    // ⚠️ A sentence about a DAY carries the day as %1; `fullDayNone` is the sentence for "there is no day",
    // so it carries none — the list here is the ones that must.
    if (["fullDaySay", "fullDayNext", "fullDayChoose"].includes(key)) {
      assert.ok(values.every((v) => v.includes("%1")), `★ ${key} lost its placeholder in one language`);
    }
  }
});
