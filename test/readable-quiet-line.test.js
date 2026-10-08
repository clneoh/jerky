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

// ── ★★ v369: THE SAME FLOOR, FOR THE ACCENT COLOURS ─────────────────────────
//
// v313 fixed `--muted` and nothing else. A measured sweep of all 26 screens in a real browser
// (the guard above never looked at these) found the app's own accent-on-tint pairs still under
// the 4.50 floor it had adopted:
//
//   --amber on --amber-bg    3.78   ← the worst, on Ingredients' empty-state line
//   white  on --amber        4.23   Promo's "point of no return" badge
//   --green on --green-bg    4.29   the engine pill, a valid promo chip, a "Cool" chip
//   --red  on --red-bg       4.31   the Production "mixer" chip, a Scenario note
//
// ⚠️ AND THE WORST GROUND WAS NOT THE TINT OF ITS OWN COLOUR. Every one of them failed hardest
// on `--gray-bg` (4.10 / 4.21 / 3.52) — the v313 lesson exactly: **tune for the worst background
// the colour lands on, never the one that flatters it.**
//
// ⚠️ AND EACH TOKEN HAS TWO ROLES, so BOTH are asserted: as TEXT on a tint, and as a FILL with
// white on it. Darkening fixes both, which is why one value can carry both jobs.

const ACCENTS = [
  ["--green", "--green-bg", "a settled/success chip, the engine pill, a 'Cool' chip"],
  ["--red", "--red-bg", "an owed/problem chip, the Production 'mixer' chip"],
  ["--amber", "--amber-bg", "a waiting/attention chip, a PO day tag"],
];

test("★ every accent colour clears the floor BOTH ways round", () => {
  for (const [path, who] of FILES) {
    const t = tokens(read(path));
    const bad = [];
    for (const [name, tint, where] of ACCENTS) {
      if (!t[name]) continue; // the shop carries none of these
      for (const [bg, bgWhere] of BACKDROPS) {
        if (!t[bg]) continue;
        const r = contrast(t[name], t[bg]);
        if (r < FLOOR) bad.push(`${name} as text on ${bg} (${bgWhere}) is ${r.toFixed(2)}:1`);
      }
      // ⚠️ THE OTHER ROLE. Several of these are drawn as a FILL with white text on them
      // (`.r-btn:hover`, a timeline block, a gate step). A colour tuned for text alone can
      // still leave white unreadable on top of it.
      const onWhite = contrast("#ffffff", t[name]);
      if (onWhite < FLOOR) bad.push(`${name} as a FILL under white text is ${onWhite.toFixed(2)}:1`);
      void tint; void where;
    }
    assert.deepEqual(bad, [], `${who}: an accent colour is under ${FLOOR}:1 where it is read`);
  }
});

test("★★ the brand terracotta is a FILL and an EDGE — never text (her decision, 2026-10-08)", () => {
  // ⚠️⚠️ WHITE ON `--brown` MEASURES 4.48:1 — just under the floor — AND SHE RULED THAT THE
  // BRAND COLOUR STAYS. So the fix is not to move `--brown`; it is to stop using it for TEXT.
  // The app already agreed with itself about this: about twenty-five text uses had long since
  // taken `--brown-dark`, and a handful had not. This is that rule, made enforceable.
  //
  // ⚠️ DO NOT "FIX" `--brown` ITSELF. `--brown-dark` is a brand token too — this changes which
  // of the two a line of text uses, never the brand.
  for (const [path, who] of FILES) {
    const css = read(path);
    const textUses = [...css.matchAll(/(^|[^-])\bcolor\s*:\s*var\(--brown\)/gm)];
    assert.deepEqual(textUses.map((m) => m[0].trim()), [],
      `${who}: text is drawn in the brand fill colour — it must use --brown-dark (4.48:1 vs 5.92:1)`);
  }
  // And it really is still there for the jobs it IS for, so nobody "cleans it up" instead.
  const admin = read("admin/css/app.css");
  assert.match(admin, /background:\s*var\(--brown\)/, "--brown is still the brand FILL");
  // ⚠️ THE VALUE ITSELF, PINNED. She said the brand colour stays; this is that sentence as an
  // assertion, so a later session cannot "improve" it into passing the text floor.
  assert.match(admin, /--brown:\s*#c4552f;/, "the brand terracotta is unchanged");
});

// ── ★★ v369: WHAT v313 COULD NOT SEE — THE SHOP HARDCODES ITS OWN GREYS ─────
//
// v313 moved the `--muted` token in both files and asserted the two agreed. **But the shop had
// also written four greys of its own as literals**, and no token test can see a literal. Three
// of them were genuinely hard to read on a phone:
//
//   #a2968b  2.40:1  the customer's own TRACKING step labels, at 9.5px
//   #9b8b7b  2.74:1  the line naming the Act, closing the PRIVACY NOTICE
//   #8a7a68  3.45:1  the small line under "Place order" — the privacy panel's own trigger
//
// ⚠️ ALL THREE ARE THINGS SHE RULED MUST BE READABLE, and the notice is the one she was most
// particular about. They now draw the same token as every other quiet line, so a shop whose
// small print is a different grey from the backoffice's is no longer possible by accident.

test("★ the shop's small print draws the token, not a grey of its own", () => {
  const RULES = [
    ["store/app.css", ".privacy-sheet-fine", "the line naming the Act"],
    ["store/app.css", ".order-notice", "the line under Place order (the privacy trigger)"],
    ["store/app.css", ".tj-label", "the customer's tracking step labels"],
    ["admin/css/app.css", ".oj-label", "the same labels, in the backoffice"],
  ];
  for (const [path, sel, where] of RULES) {
    const css = read(path);
    // ⚠️ ANCHORED AT A LINE START, and it has to be: `.tj-label {` is a SUBSTRING of
    // `.tj-step.skipped .tj-label {`, so a plain indexOf found the override rule instead of the
    // base one and the first run of this test failed on correct CSS.
    const at = css.indexOf(`\n${sel} {`);
    assert.notEqual(at, -1, `${sel} is in ${path}`);
    const body = css.slice(at, css.indexOf("}", at));
    assert.match(body, /color:\s*var\(--muted\)/,
      `${where} (${sel}) draws its own grey instead of --muted, so it drifts from every other quiet line and no token test can see it`);
  }
});

test("★★ no stylesheet reads a palette token that only its SIBLING declares", () => {
  // ⚠️⚠️ FOUND BY THE v369 SYNC, AND THE TEST BESIDE THIS ONE COULD NOT SEE IT.
  //
  // The v369 contrast pass rewrote two rules in the SHOP to `var(--amber)` — and the shop's own
  // palette has never had an `--amber`. **With no fallback the declaration is simply INVALID**,
  // so the tracked order's current step and its skipped-step cross took whatever colour they
  // inherited. Nothing failed anywhere: CSS reports no mistake, and the guard below only ever
  // looked for ONE token by name (`--terra`), so a second one walked straight past it.
  //
  // ⚠️ THE RULE IS DELIBERATELY NARROW. Both sheets set custom properties AT RUNTIME too
  // (`--depth`, `--gr`, `--tick-w` …) and those are declared in neither file, which is right and
  // must not fail. What cannot be right is a token ONE OF THE TWO PALETTES DECLARES being read
  // by the other without declaring it — these two files are the same design in two documents, so
  // a shared word read across the gap is the drift this whole file exists to stop.
  const declared = Object.fromEntries(FILES.map(([p]) => [p, new Set(Object.keys(tokens(read(p))))]));
  const used = Object.fromEntries(FILES.map(([p]) => [
    p, new Set([...read(p).matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1])),
  ]));
  const bad = [];
  for (const [path, who] of FILES) {
    const [other] = FILES.find(([p]) => p !== path);
    for (const tok of [...used[path]].sort()) {
      if (declared[other].has(tok) && !declared[path].has(tok)) {
        bad.push(`${who} reads ${tok}, which only ${other} declares`);
      }
    }
  }
  assert.deepEqual(bad, [], `a shared palette token is read across the gap: ${bad.join("; ")}`);
});

test("★ no stylesheet here reads a token that only ANOTHER document declares", () => {
  // `.privacy-wa` read `var(--terra, #c4552f)` — and `--terra` is declared only in
  // `admin/promo-card.html`, a separate page. So the shop's own WhatsApp number inside the
  // privacy panel silently fell back to the brand FILL colour (4.41:1) instead of the text one,
  // and the fallback made it READ as if it had been considered. It had not.
  //
  // ⚠️ A FALLBACK IS NOT A DEFENCE. A guard that only looks for an undefined token will pass
  // this line; the fault is that it was never defined HERE.
  for (const path of ["admin/css/app.css", "store/app.css"]) {
    const css = read(path);
    assert.deepEqual([...css.matchAll(/var\(--terra\b/g)].map((m) => m[0]), [],
      `${path} reads --terra, which this document does not declare`);
  }
  const shop = read("store/app.css");
  const at = shop.indexOf(".privacy-wa {");
  assert.notEqual(at, -1, ".privacy-wa is in the shop");
  assert.match(shop.slice(at, shop.indexOf("}", at)), /color:\s*var\(--brown-dark\)/,
    "the shop's privacy WhatsApp number is not drawing the brand TEXT colour");
});
