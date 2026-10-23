// test/label-pdf.test.js — the shared label is a real 100 × 150 mm PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelCanPdf, labelLines, labelPdf, labelPdfName } from "../admin/js/label_pdf.js";

const asText = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

const MAIL = [
  ["mail-sec", "FROM"], ["mail-line", "Jien Luv 2 Bake"],
  ["mail-line", "12 Jalan Bunga Raya, 11500 Ayer Itam"],
  ["mail-sec", "TO"], ["mail-name", "Aisyah Rahman"],
  ["mail-line", "60123456789"], ["mail-line", "8 Jalan Melati, Penang"],
  ["mail-sec", "ORDER"], ["mail-line", "#AAAAAA · Deliver Wed 21 Oct"],
  ["mail-line", "Focaccia ×2"], ["mail-line", "Sandwich ×1"],
  ["mail-line", "Please leave at the guard house."],
];

test("★★★ the shared label is one 100 × 150 mm PDF page with the sheet's own words (v611)", () => {
  // ⭐ Her Wi-Fi label printer cannot be seen by Android's print services; its own app can open a file.
  // ⚠️ **The page must be the sticker's own size**, or the app scales it unpredictably.
  const text = asText(labelPdf(MAIL));
  assert.ok(text.startsWith("%PDF-1.4"), "not a PDF");
  assert.match(text, /\/MediaBox \[0 0 283\.46 425\.2\]/,
    "★ the page is not 100 × 150 mm — the printer app will rescale it");
  assert.match(text, /\(Aisyah Rahman\)/, "★ the customer's name is not on the PDF");
  assert.match(text, /\(#AAAAAA · Deliver Wed 21 Oct\)/, "★ the order block is missing");
  assert.match(text, /\(Focaccia ×2\)/, "★ an item is missing");
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 1, "★ the label spilled onto a second page");
});

test("★★★ a label too long for the sticker is scaled, never clipped (v611)", () => {
  const rows = [...MAIL];
  for (let i = 0; i < 30; i++) rows.push(["mail-line", `Extra item number ${i + 1}`]);
  const text = asText(labelPdf(rows));
  assert.match(text, /\(Extra item number 30\)/,
    "★ the last line was clipped off the sticker instead of the whole label shrinking");
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 1, "★ the long label became two pages");
});

test("★★ the file is named after the order, and CJK is refused rather than misspelled (v611)", () => {
  assert.equal(labelPdfName("#AB12CD"), "Label #AB12CD.pdf");
  assert.equal(labelCanPdf([["mail-line", "Aisyah"]]), true);
  assert.equal(labelCanPdf([["mail-line", "陈小美"]]), false,
    "★ a Chinese name would print as ????? in this PDF");
});

test("★★★ one layout serves both files: centred for a bag, left-aligned for a parcel (v612)", () => {
  const lines = labelLines(MAIL);
  assert.ok(lines.length > 5, "the layout produced no lines");
  const to = lines.find((l) => l.text === "Aisyah Rahman");
  assert.ok(to, "★ the customer line is missing");
  assert.equal(Math.round(to.xMm), 10, "★ a mailing block is not left-aligned");
  const bag = labelLines([["brand", "Jien Luv 2 Bake"], ["customer", "Lucy"]]);
  const name = bag.find((l) => l.text === "Lucy");
  assert.ok(name.xMm > 10, "★ a bag label is not centred");
});

test("★★★ a label too tall for the sticker is scaled in the shared layout too (v612)", () => {
  const rows = [...MAIL];
  for (let i = 0; i < 120; i++) rows.push(["mail-line", `Extra item ${i + 1}`]);
  const lines = labelLines(rows);
  assert.ok(lines.some((l) => l.text === "Extra item 120"),
    "★ the last line is missing — the image or PDF would clip it");
  const lowest = Math.max(...lines.map((l) => l.yMm));
  assert.ok(lowest <= 150 - 10,
    `★ a line sits ${lowest.toFixed(1)} mm down a 150 mm sticker — it would be cut off`);
  const head = lines.find((l) => l.text === "FROM");
  assert.ok(head.sizeMm < 2.8, "★ nothing shrank, so the label cannot fit one sticker");
});

// ── v626: the customer's words are underlined on the drawn label too ────────

test("★★★ the note the packer must see is carried as a mark, not lost in a comment (v626)", () => {
  const rows = [["user", "Wrong class on purpose"]];
  void rows;
  const lines = labelLines([["item", "Focaccia x2 - no nuts", ["no nuts"]]]);
  const line = lines.find((l) => String(l.text).includes("no nuts"));
  assert.ok(line, "the item line is missing");
  assert.deepEqual(line.marks, ["no nuts"], "★ the drawn label dropped the cusomer's underlined words");
});

test("★★★ the PDF draws the underline as a rule (v626)", () => {
  const text = asText(labelPdf([["item", "Focaccia x2 - no nuts", ["no nuts"]]]));
  // A rule op renders as "... m ... l S" — the text op alone renders "Tj".
  assert.match(text, /\bm\s.*\bl\s+S/, "★ the PDF label has no underline for the note");
  assert.match(text, /\(Focaccia x2 - no nuts\)/, "the words themselves must still be there");
});
