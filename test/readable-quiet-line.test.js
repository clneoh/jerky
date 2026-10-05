// test/readable-quiet-line.test.js — the quiet line is readable (v313).
//
// ★ THE ONE PLACE IN THE APP WHERE A LINE IS MEANT TO BE *READ* AND WAS NOT.
// `--muted` draws every small second line: the one under a menu row, under an
// order row, the hint under a box, a collection Point's address in the shop. It
// was #9a8471 — **3.50:1 on a card, against the 4.50:1 the standard asks of
// text** — on a phone, in a kitchen, in Penang daylight, which is exactly where
// she reads it. The app had already admitted as much once, in
// `h3.courier-kind .kind-what`, which dodged this token for that very reason.
//
// ⚠️ **AND THE COLOUR IS SET BY THE WORST BACKGROUND, NOT THE NICEST.** The first
// candidate (#806a57) is a comfortable 5.02:1 on a plain card — and only 4.24:1
// on `--gray-bg`, where a used promo chip and a courier-paid tag actually live.
// That is the fault this test exists to catch, and it is why the colour is
// #7b6552 rather than the value a card alone would have chosen.
//
// ⚠️ **A HAND-LISTED SET OF BACKGROUNDS, DELIBERATELY.** They are the surfaces a
// quiet line is drawn on, named one by one with where each is used. A tint added
// later is not picked up automatically — this is the note to add it here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Every `--name: #rrggbb;` in the file's FIRST `:root` block.
function tokens(css) {
  const open = css.indexOf(":root {");
  assert.notEqual(open, -1, "the stylesheet declares a :root block");
  const body = css.slice(open + 7, css.indexOf("}", open));
  const out = {};
  for (const m of body.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const chan = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Where a quiet line actually sits, and the rule that draws it there.
const BACKDROPS = [
  ["--surface", "every card, and the shop's own cards"],
  ["--bg", "the page behind the cards"],
  ["--gray-bg", "a used or expired promo chip, a courier-paid tag, a quiet day tag"],
  ["--strip", "the soft band behind a 'How it adds up' line"],
  ["--brown-soft", "a warm tinted block"],
  ["--green-bg", "a settled/success chip"],
  ["--amber-bg", "a waiting/attention chip"],
  ["--red-bg", "an owed/problem chip"],
];

const FILES = [["admin/css/app.css", "the backoffice"], ["store/app.css", "the shop"]];

const FLOOR = 4.5; // WCAG 2.2 AA for text below 18.66px bold / 24px

test("the quiet line clears the text floor on every background it lands on", () => {
  for (const [path, who] of FILES) {
    const t = tokens(read(path));
    assert.ok(t["--muted"], `${path} declares --muted`);
    const bad = [];
    for (const [name, where] of BACKDROPS) {
      if (!t[name]) continue; // a file need not carry every tint
      const r = contrast(t["--muted"], t[name]);
      if (r < FLOOR) bad.push(`${name} (${where}) is ${r.toFixed(2)}:1`);
    }
    assert.deepEqual(bad, [],
      `${who}: the small grey line is under ${FLOOR}:1 where it is read`);
  }
});

test("and the two files agree, because one word must not mean two things", () => {
  // They define their own tokens, so moving one does not move the other. A shop
  // whose quiet line is a different grey from the backoffice's is the same fault
  // as two rows that look alike and behave differently.
  const admin = tokens(read("admin/css/app.css"))["--muted"];
  const shop = tokens(read("store/app.css"))["--muted"];
  assert.equal(shop, admin, "the shop's quiet line has drifted from the backoffice's");
});

test("the old value is kept ONLY for the join that needs an edge, not text", () => {
  // `h3.courier-kind` draws a 2px rule INSIDE a card. An edge answers to 3:1, and
  // darkening it to the new text colour would turn a join into another box — so
  // it keeps the old value under its own name, and only there.
  const css = read("admin/css/app.css");
  const t = tokens(css);
  assert.equal(t["--join"], "#9a8471", "the join keeps the old, lighter value");
  assert.ok(contrast(t["--join"], t["--surface"]) >= 3,
    "the join still clears the 3:1 an edge needs");

  const rule = css.slice(css.indexOf("h3.courier-kind {"));
  const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
  assert.match(body, /border-top:\s*2px solid var\(--join\)/,
    "the courier-kind rule draws the join, not the text colour");
});
