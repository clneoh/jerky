// test/settings-backups.test.js — the copies list must actually be DRAWN (v642).
//
// ⚠️⚠️ THE FAULT THIS EXISTS FOR, AND ITS AGE. **v574 deleted `kids.push(...rows.map(rowEl))` while lifting the
// kept-copy block out of `fillBackups`**, and for sixty versions the card said *"Daily copy saved today"* and
// listed nothing. ⭐ Restore, Download, Put back missing orders and Delete are reachable ONLY from those rows,
// so the whole backup ladder was invisible while every test stayed green — `rowEl` simply became dead code.
// ⭐ Her report: __"normally i use to see each backup copies, collapsed, but now no"__.
//
// It is a source test because the screen needs a mounted DOM and a stubbed cloud; what is pinned here is the
// thing that was removed — the rows being rendered at all, and every control still being on them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../admin/js/views/settings.js", import.meta.url), "utf8");
// comments out before any match — a commented-out push would otherwise satisfy this
const live = (text) => String(text).split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\/\*.*?\*\//g, ""))
  .join("\n");

test("★★★ the copies are rendered into the card (v642)", () => {
  const code = live(src);
  // ⚠️ THE ROWS NOW ARRIVE INSIDE A FOLD (v645), so the check follows them one step further — what it forbids is
  // unchanged: a card that says a copy was saved and draws none.
  assert.match(code, /if \(rows\.length\) kids\.push\(copiesFold\(rows\)\);/, "★ the rows are gone again");
  assert.match(code, /\.\.\.rows\.map\(rowEl\)/, "★ the fold body draws none of them");
  // and they are pushed BEFORE the card is shown, or they would be drawn into nothing
  const pushAt = code.indexOf("kids.push(copiesFold(rows))");
  const showAt = code.indexOf("show(...kids, ...keptCopyKids())");
  assert.ok(pushAt > 0 && showAt > pushAt, "★ the rows are built after the card is drawn — they never appear");
});

test("★★★ every control a copy needs is still on its row (v642)", () => {
  const row = live(src).slice(live(src).indexOf("function rowEl(row)"));
  const body = row.slice(0, row.indexOf("function viewOne"));
  for (const label of ["View", "Restore", "Put back missing orders", "Download", "Delete"]) {
    assert.ok(body.includes(`"${label}"`), `★ a copy lost its ${label} control`);
  }
});

test("★★ rowEl is used, not dead code (v642)", () => {
  const code = live(src);
  const defs = (code.match(/function rowEl\(/g) || []).length;
  const uses = (code.match(/rows\.map\(rowEl\)/g) || []).length;
  assert.equal(defs, 1, "rowEl is defined more than once");
  assert.equal(uses, 1, "★ rowEl is defined and never called — that is exactly how the list vanished before");
});

test("★★★ the WHOLE LIST is one fold, shut until she clicks (v645)", () => {
  // Her words: __"what i meant is collapse every copies, it only pop up upon clicking"__ — ⭐ **the list itself is
  // the thing that stays shut**, not one fold per copy: the card reads as status and one press opens the copies.
  const code = live(src);
  assert.match(code, /const body = el\("div", \{ class: "fold-body", hidden: !copiesOpen \}, \.\.\.rows\.map\(rowEl\)\);/,
    "★ the copies are drawn outside a fold — the card is a screen of copies again");
  assert.match(code, /class: "fold-head copies-head"/, "the list lost its press");
  assert.match(code, /"aria-expanded": copiesOpen \? "true" : "false"/, "★ the head does not say whether it is open");
  assert.match(code, /let copiesOpen = false;/, "★ the list opens by itself on every repaint");
  // The five controls live on each row INSIDE the fold (one level of folding, not two).
  const fold = code.slice(code.indexOf("function copiesFold(rows)"));
  assert.ok(fold.indexOf("rows.map(rowEl)") < fold.indexOf("function viewOne"), "the rows are no longer in the fold body");
  const row = code.slice(code.indexOf("function rowEl(row)"), code.indexOf("function copiesFold(rows)"));
  for (const label of ["View", "Restore", "Put back missing orders", "Download", "Delete"]) {
    assert.ok(row.includes(`"${label}"`), `★ a copy lost its ${label} control`);
  }
});
