// test/pdf.test.js — the hand-written PDF writer (v283).
//
// There is no PDF library in this project and there never will be — no build step, no package
// manager. So the bytes are assembled by hand, and everything here is about the two places that
// goes wrong silently rather than loudly:
//
//   1. THE CROSS-REFERENCE TABLE. A PDF reader finds each object by a byte offset recorded at
//      the end of the file. An offset that is wrong by one byte does not throw — it opens as a
//      damaged file, or opens with a blank page, on a phone she cannot debug. So the offsets are
//      not asserted against a constant; they are FOLLOWED, the way a reader follows them.
//   2. THE ENCODING. Base-14 Helvetica draws through WinAnsi, which has no true minus sign. The
//      money journal writes outgoing money as "−RM 30.00", so the one character that must be
//      translated is the one a reader would see a "?" instead of.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePdf, textWidth, wrapText, sanitize, A4 } from "../admin/js/pdf.js";
import { journalSheet, journalPdf, journalPdfName } from "../admin/js/journal.js";

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

// Follow the file the way a reader does: read `startxref`, land on the table, walk each entry's
// byte offset, and confirm the object that is supposed to be there is there.
function readXref(bytes) {
  const text = latin1(bytes);
  const startAt = Number(/startxref\s+(\d+)\s+%%EOF/.exec(text)[1]);
  const body = text.slice(startAt);
  assert.ok(body.startsWith("xref\n"), "startxref points at the table, not near it");
  const header = /^xref\n0 (\d+)\n/.exec(body);
  const count = Number(header[1]);
  const tableAt = startAt + header[0].length;
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    // Every entry is exactly 20 bytes, which is what makes a hand-written table possible.
    entries.push(text.slice(tableAt + i * 20, tableAt + (i + 1) * 20));
  }
  return { startAt, count, entries, text };
}

const SAMPLE = [{ ops: [{ op: "text", x: 56.7, y: 700, text: "Hello", size: 10 }] }];

// ── the file a reader is handed ─────────────────────────────────────────────

test("the file begins and ends the way a PDF must", () => {
  const bytes = makePdf(SAMPLE);
  assert.ok(bytes instanceof Uint8Array, "bytes, not a string — it is a file, not a page");
  const text = latin1(bytes);
  assert.ok(text.startsWith("%PDF-"), "a reader decides from the first five bytes");
  assert.ok(text.endsWith("%%EOF\n"));
  // A comment line of four bytes above 127, straight after the header: what stops a transfer
  // program deciding a PDF is text and rewriting its line endings while it is in transit.
  assert.equal(text.slice(9, 10), "%");
  assert.equal(text.slice(10, 14), "\xe2\xe3\xcf\xd3");
});

test("every byte offset in the cross-reference table points at its own object", () => {
  // The one fault that would reach her as "the file is damaged" on a phone with no way to see
  // why. Each entry is read and the object is looked for where the table says it is.
  const bytes = makePdf([...SAMPLE, ...SAMPLE]);
  const { count, entries, text } = readXref(bytes);
  assert.equal(entries[0], "0000000000 65535 f \n", "free entry, always the first");
  assert.equal(count, entries.length);
  for (let i = 1; i < count; i += 1) {
    const offset = Number(entries[i].slice(0, 10));
    assert.match(entries[i], /^\d{10} \d{5} n \n$/, `entry ${i} is a well-formed 20-byte line`);
    assert.equal(text.slice(offset, offset + `${i} 0 obj`.length), `${i} 0 obj`,
      `object ${i} is exactly where the table says it is`);
  }
});

test("each page says how long its own content is, and the number is the truth", () => {
  // `/Length` is what the reader trusts to know where a stream stops. A hand-counted length
  // that drifts is a page that renders as garbage after the first line.
  const bytes = makePdf([
    { ops: [{ op: "text", x: 10, y: 10, text: "one (with) a \\ and a )", size: 12 }] },
    { ops: [{ op: "rule", x1: 0, y1: 5, x2: 100, y2: 5, width: 0.5 }] },
  ]);
  const text = latin1(bytes);
  const streams = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
  assert.equal(streams.length, 2, "one content stream per page");
  for (const [, len, body] of streams) {
    assert.equal(Number(len), body.length, "the declared length is the stream's own length");
  }
});

test("the three characters PDF reserves are escaped, and the text still reads", () => {
  const bytes = makePdf([{ ops: [{ op: "text", x: 0, y: 0, text: "a (b) c \\ d", size: 10 }] }]);
  const text = latin1(bytes);
  assert.ok(text.includes("(a \\(b\\) c \\\\ d) Tj"), "a raw bracket would end the string early");
  assert.equal(/NaN|undefined/.test(text), false);
});

test("makePdf refuses a document with no page rather than writing a broken one", () => {
  assert.throws(() => makePdf([]), /at least one page/);
  assert.throws(() => makePdf(null), /at least one page/);
});

// ── the encoding: what a journal actually carries ───────────────────────────

test("the true minus the money journal writes is translated, not turned into a question mark", () => {
  // `money()` writes "−RM 8.00" with U+2212. WinAnsi has no such glyph, so a writer that just
  // passed the code point through would put a "?" on every outgoing line of her paper.
  assert.equal(sanitize("−RM 8.00"), "-RM 8.00");
  assert.equal(sanitize("More → Profit"), "More -> Profit");
  assert.equal(sanitize("a b"), "a b", "an unbreakable space is still a space on paper");

  const bytes = latin1(makePdf([{ ops: [{ op: "text", x: 0, y: 0, text: "−RM 8.00", size: 10 }] }]));
  assert.ok(bytes.includes("(-RM 8.00) Tj"), "the hyphen is what reaches the file");
  assert.equal(bytes.includes("?"), false, "and nothing was dropped for want of a glyph");
});

test("the separator she reads in a row survives to the file as itself", () => {
  // "1 Oct · boxes · Cash" — the middle dot is in WinAnsi as one byte, and it is the character
  // that makes a journal row readable at a glance.
  const bytes = makePdf([{ ops: [{ op: "text", x: 0, y: 0, text: "1 Oct · boxes · Cash", size: 10 }] }]);
  assert.ok(latin1(bytes).includes("(1 Oct \xb7 boxes \xb7 Cash) Tj"));
});

test("a journal never asks for a character the encoding cannot hold", () => {
  // The whole sheet, not one string: a title, a subtotal, a note and the provenance footer.
  const s = journalSheet({
    title: "Cash journal",
    subtitle: "This month · 1 Oct 2026 to 3 Oct 2026",
    bakery: "Jien Luv 2 Bake",
    where: "More → Profit",
    printed: "3 Oct 2026",
    lines: [{ what: "1 Oct · boxes and bags · Cash", amount: 30 }],
    totals: [{ label: "In", amount: 30 }],
    note: "A note with an em dash — and an ellipsis…",
  });
  const text = latin1(journalPdf(s));
  // Only the "?" that is genuinely a question mark would be legitimate, and a journal has none.
  const inStrings = [...text.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]);
  assert.ok(inStrings.length >= 6, "the whole sheet reached the file");
  for (const str of inStrings) {
    assert.equal(str.includes("?"), false, `nothing was dropped from "${str}"`);
  }
});

// ── measuring, which is what the money column rests on ──────────────────────

test("a character's width is the one every PDF reader already uses", () => {
  // Read from the Adobe metrics for base-14 Helvetica at 1000 units to the em.
  assert.equal(textWidth(" ", { size: 1000 }), 278);
  assert.equal(textWidth("i", { size: 1000 }), 222);
  assert.equal(textWidth("W", { size: 1000 }), 944);
  assert.equal(textWidth("W", { font: "F2", size: 1000 }), 944);
  assert.equal(textWidth("m", { font: "F2", size: 1000 }), 889);
  assert.equal(textWidth("", { size: 10 }), 0);
  assert.equal(textWidth("RM 30.00", { size: 10 }), textWidth("RM 30.00", { size: 10 }));
});

test("money is the same width in both faces, so one column serves rows and totals", () => {
  // This is why the sheet measures the money column once. If bold were wider, a total would
  // overhang the rows above it and the column would stop reading as a column.
  for (const m of ["RM 30.00", "−RM 1,234.50", "-RM 8.00"]) {
    assert.equal(textWidth(m, { font: "F1", size: 10 }), textWidth(m, { font: "F2", size: 10 }), m);
  }
});

test("no wrapped line is ever wider than the column it was wrapped into", () => {
  const col = 200;
  const cases = [
    "a short sentence",
    "a rather longer sentence that will certainly have to be broken somewhere near the end",
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
    "X".repeat(400),
    "supercalifragilisticexpialidociousandthensomemoreletterstomakeitreallylongindeed",
    "",
  ];
  for (const c of cases) {
    for (const line of wrapText(c, col, { size: 10 })) {
      assert.ok(textWidth(line, { size: 10 }) <= col, `"${line}" fits in ${col}pt`);
    }
  }
});

test("words are kept whole, and only a monster is cut", () => {
  const lines = wrapText("flour eggs and butter", 200, { size: 10 });
  assert.deepEqual(lines, ["flour eggs and butter"], "a line that fits is left alone");
  assert.deepEqual(wrapText("flour\neggs", 200, { size: 10 }), ["flour", "eggs"],
    "a newline in the note is a break, not a space");
  assert.deepEqual(wrapText("flour\n\neggs", 200, { size: 10 }), ["flour", "", "eggs"]);

  const monster = "Y".repeat(300);
  const cut = wrapText(monster, 100, { size: 10 });
  assert.ok(cut.length > 1, "an unbreakable word longer than the page is broken, not allowed to run off");
  assert.equal(cut.join(""), monster, "and not one character is lost in the breaking");
});

// ── the journal as a file ───────────────────────────────────────────────────

const SHEET = {
  title: "Cash journal",
  subtitle: "This month · 1 Oct 2026 to 3 Oct 2026",
  bakery: "Jien Luv 2 Bake",
  where: "More → Profit",
  printed: "3 Oct 2026",
  lines: [
    { what: "1 Oct · boxes and bags · Cash", amount: 30 },
    { what: "2 Oct · courier charge · Cash", amount: 12, dir: "out" },
  ],
  totals: [{ label: "In", amount: 30 }],
};

test("the sheet reaches the file with every row, its figures and its letterhead", () => {
  const text = latin1(journalPdf(SHEET));
  for (const wanted of ["Jien Luv 2 Bake", "Cash journal", "This month", "boxes and bags"]) {
    assert.ok(text.includes(wanted), `the document carries "${wanted}"`);
  }
  assert.ok(text.includes("(RM 30.00)"), "the figures are on it");
  assert.ok(text.includes("(-RM 12.00)"), "with the direction the sheet gave them");
});

test("the figure on the paper is the figure in the file, from the sheet's own numbers", () => {
  // The same promise the text message already keeps: the file is a rendering of the sheet, so a
  // figure written down twice would be free to round differently. The amounts are numbers here.
  const s = journalSheet({ title: "x", lines: [{ what: "a", amount: "148.5" }], totals: [] });
  assert.equal(typeof s.lines[0].amount, "number");
  assert.ok(latin1(journalPdf(s)).includes("(RM 148.50)"));
});

test("a long journal becomes more than one page, and the head comes with it", () => {
  const long = journalSheet({
    title: "Expenses journal", bakery: "Jien Luv 2 Bake",
    lines: Array.from({ length: 80 }, (_, i) => ({ what: `row ${i}`, amount: i + 1, dir: "out" })),
    totals: [{ label: "Total", amount: 3240 }],
  });
  const bytes = journalPdf(long);
  const text = latin1(bytes);
  assert.ok(text.includes("/Type /Pages /Kids [3 0 R 4 0 R] /Count 2"),
    "eighty rows do not fit one page, and the tree says so");
  // The head a second page wears, escaped in the file the way the format requires.
  assert.ok(text.includes("(Expenses journal \\(continued\\)) Tj"),
    "a second page has to say what it is a continuation of, or it reads as a loose sheet");
  // Every row is on it, on one page or the other.
  for (const i of [0, 39, 79]) assert.ok(text.includes(`(row ${i}) Tj`), `row ${i} made it`);
});

test("an empty journal is still a document she can send", () => {
  const s = journalSheet({ title: "Sales journal", lines: [], totals: [],
    empty: "Nothing was sold in September 2026." });
  const text = latin1(journalPdf(s));
  assert.ok(text.startsWith("%PDF-"));
  assert.ok(text.includes("Nothing was sold in September 2026."));
  assert.equal(/NaN|undefined|Infinity/.test(text), false, "an empty book has no figure to print");
});

test("the document is named after the journal, so she can find it again", () => {
  assert.equal(journalPdfName(SHEET), "Cash journal.pdf");
  assert.equal(journalPdfName({ title: "Profit and loss" }), "Profit and loss.pdf");
  assert.equal(journalPdfName({ title: 'a/b\\c:d*e?f"g<h>i|j' }), "a b c d e f g h i j.pdf",
    "nothing a file system would refuse is left in the name");
  assert.equal(journalPdfName({ title: "   " }), "Journal.pdf", "an unnamed journal still has a name");
  assert.equal(journalPdfName({}), "Journal.pdf");
});

test("the sheet is drawn inside the page, in A4", () => {
  const pages = journalPdf(SHEET);
  const text = latin1(pages);
  assert.ok(text.includes(`/MediaBox [0 0 ${A4.w} ${A4.h}]`), "A4, which is what the printed sheet uses");
  const ops = [...text.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(ops.length > 0);
  for (const [x, y] of ops) {
    assert.ok(x >= 0 && x <= A4.w, `x ${x} is on the page`);
    assert.ok(y >= 0 && y <= A4.h, `y ${y} is on the page`);
  }
});
