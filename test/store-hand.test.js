// test/store-hand.test.js — the chalk hand the shop sets her own sentence in.
//
// v274 puts a handwriting face on the bakery's own words in the shelf strip. The
// file is shipped inside the shop (store/fonts/), not fetched from a font
// service, so there are three ways it can quietly break with nothing visible in
// a unit test:
//
//   1. The CSS points at a file that is not in the repo. The page then shows the
//      system lettering and looks exactly like a build where nobody did anything
//      — there is no error anywhere. This is the classic broken-font bug.
//   2. The font was RE-SUBSET without its kerning. Shantell Sans is a handwriting
//      face and its kerning is part of the look: with `kern` dropped, the same
//      sentence measures 591px instead of 581px and thousands of pixels move.
//      v274 hit exactly this — an explicit `--layout-features=` list holding only
//      GSUB tags silently emptied GPOS — and it was caught only by rendering the
//      two files side by side. Nothing about the shipped bytes says "kerning".
//   3. A future edit to `.promo-words` silently swaps the hand for a generic
//      `cursive` fallback, which on a phone can resolve to a face nobody chose.
//
// So these tests read the REAL stylesheet, the REAL markup and the REAL font
// bytes. The kerning check decodes the WOFF2 by hand (node has brotli, so no
// dependency is needed) because there is no other way to ask the file whether it
// still knows how to pair its letters.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import zlib from "node:zlib";

const url = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");
const FONT = "store/fonts/ShantellSans-Regular-latin.woff2";

const css = read("store/app.css");
const html = read("store/index.html");

// ---------------------------------------------------------------- the wiring

test("the shop ships the very file its stylesheet asks for", () => {
  // The @font-face block, and the url it names, read out of the real CSS.
  const face = css.match(/@font-face\s*\{[^}]*\}/);
  assert.ok(face, "app.css declares no @font-face at all");
  assert.match(face[0], /font-family:\s*"Shantell Sans"/,
    "the face is not named 'Shantell Sans'");
  const src = face[0].match(/url\(["']?([^"')]+)["']?\)/);
  assert.ok(src, "the @font-face has no src url");
  // The url is written relative to app.css, which sits in store/.
  const path = `store/${src[1]}`;
  assert.equal(path, FONT, `the stylesheet asks for ${src[1]}, not the shipped file`);
  assert.ok(existsSync(url(path)),
    `${path} is missing — the shop would silently draw the system font`);
  assert.match(face[0], /font-display:\s*swap/,
    "without `swap` a slow font leaves the line blank instead of showing the system face first");
});

test("the hand is fetched once, before the stylesheet asks for it", () => {
  const pre = html.indexOf('rel="preload"');
  const sheet = html.indexOf('rel="stylesheet"');
  assert.ok(pre !== -1, "index.html does not preload the font");
  assert.ok(pre < sheet, "the preload must come before the stylesheet or it is too late");
  assert.match(html.slice(pre, sheet), /as="font"/);
  // A font is always a CORS request, even same-origin: without `crossorigin` the
  // browser fetches it twice and the preload is wasted.
  assert.match(html.slice(pre, sheet), /crossorigin/,
    "the font preload is missing `crossorigin`, so it will be fetched twice");
  assert.match(html.slice(pre, sheet), /fonts\/ShantellSans-Regular-latin\.woff2/);
});

test("her sentence wears the hand at 16px, and never a bare `cursive`", () => {
  const hand = css.match(/--hand:\s*([^;]+);/);
  assert.ok(hand, "app.css has no --hand stack");
  assert.match(hand[1], /"Shantell Sans"/);
  // The stack must END in the system sans, not `cursive`: a Chinese sentence has
  // no glyphs in this Latin face and must fall through to the font the shop
  // already used, not to a phone's idea of "handwriting".
  assert.match(hand[1], /sans-serif\s*$/, `--hand must end in sans-serif: ${hand[1]}`);
  assert.doesNotMatch(hand[1], /cursive/);

  const words = css.match(/\.promo-today\s+\.promo-words\s*\{[^}]*\}/);
  assert.ok(words, ".promo-words has no rule inside .promo-today");
  assert.match(words[0], /font-family:\s*var\(--hand\)/, "her sentence is not set in the hand");
  assert.match(words[0], /font-size:\s*16px/, "her sentence must be 16px, not the strip's 13px");
});

test("the licence travels beside the shipped font", () => {
  assert.ok(existsSync(url("store/fonts/OFL.txt")),
    "store/fonts/OFL.txt is missing — the OFL requires the licence to ship with the font");
  const licence = read("store/fonts/OFL.txt");
  assert.match(licence, /SIL OPEN FONT LICENSE/i);
  assert.match(licence, /Shantell Sans Project Authors/);
});

// ------------------------------------------------------------- the font bytes

// Decode enough of the WOFF2 to read the GPOS feature list by hand. WOFF2 is a
// header, a table directory of UIntBase128 lengths, and one brotli stream holding
// every table back to back — so GPOS is found by summing the stream lengths of
// the tables before it. No dependency: node ships brotli.
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function base128(buf, at) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[at++];
    v = v * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return [v, at];
  }
  throw new Error("malformed UIntBase128 in the WOFF2 table directory");
}

function gposFeatures(file) {
  const buf = readFileSync(url(file));
  assert.equal(buf.toString("latin1", 0, 4), "wOF2", `${file} is not a WOFF2 file`);
  const numTables = buf.readUInt16BE(12);
  let at = 48;
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at++];
    let tag;
    if ((flags & 0x3f) === 0x3f) { tag = buf.toString("latin1", at, at + 4); at += 4; }
    else tag = KNOWN_TAGS[flags & 0x3f];
    const version = (flags >> 6) & 0x03;
    let [length, next] = base128(buf, at); at = next;
    // glyf/loca are transformed unless the transform version is 3, and then the
    // length in the stream is the transformed one.
    if ((tag === "glyf" || tag === "loca") && version !== 3) {
      [length, at] = base128(buf, at);
    }
    tables.push({ tag, length });
  }
  const compressed = buf.readUInt32BE(20);
  const raw = zlib.brotliDecompressSync(buf.subarray(at, at + compressed));
  let off = 0, found = null;
  for (const t of tables) {
    if (t.tag === "GPOS") { found = { off, length: t.length }; break; }
    off += t.length;
  }
  assert.ok(found, `${file} has no GPOS table — every kerning pair is gone`);
  const g = raw.subarray(found.off, found.off + found.length);
  const featureList = g.readUInt16BE(6);
  const count = g.readUInt16BE(featureList);
  const tags = [];
  for (let i = 0; i < count; i++) {
    tags.push(g.toString("latin1", featureList + 2 + i * 6, featureList + 6 + i * 6));
  }
  return tags;
}

test("the shipped font still knows how to pair its letters", () => {
  // The whole reason this test exists. Shantell Sans kerns; a subset that drops
  // `kern` draws the same words 10px wider and shifts thousands of pixels, and
  // not one byte of the stylesheet or markup would say so.
  const tags = gposFeatures(FONT);
  assert.ok(tags.includes("kern"),
    `the shipped font carries no kerning (GPOS features: ${tags.join(", ") || "none"}) — ` +
    "re-subset it with --layout-features=* and re-measure before shipping");
});

test("the shipped font is a trimmed Latin face, not the whole family", () => {
  // It must stay small enough to preload on a phone. The full static face is
  // 397,656 bytes; the Latin subset with kerning intact is ~45KB. A ceiling near
  // that catches an accidental re-ship of the untrimmed file.
  const bytes = readFileSync(url(FONT)).length;
  assert.ok(bytes > 20_000, `the font looks truncated at ${bytes} bytes`);
  assert.ok(bytes < 120_000,
    `the font is ${bytes} bytes — that is the untrimmed face, not the Latin subset`);
});
