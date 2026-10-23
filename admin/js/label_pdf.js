// admin/js/label_pdf.js — the label's own layout, and the same label as a PDF file.
//
// ⭐ WHY A FILE AT ALL. Her label printer is Wi-Fi and speaks its own app's protocol; Android's print
// services (Default Print Service / Mopria) cannot see it, so Chrome cannot print to it. ⚠️ **A web page
// never sees a printer** — but it CAN hand a file to the app that does. ⭐ The label is built at the
// sticker's own size and shared; the printer's own app opens it and prints.
//
// ⚠️⚠️ AND THE LAYOUT IS SHARED WITH THE IMAGE (v612). Many printer apps register for **images**, not PDFs,
// so Android never shows them for a PDF. ⭐ One layout, two files: `labelLines` is in millimetres, and the PDF
// and the PNG both render the very same lines — so the two cannot disagree.

import { canDrawAll, makePdf, textWidth, wrapText } from "./pdf.js";

export const LABEL_W_MM = 100;
export const LABEL_H_MM = 150;
export const LABEL_MARGIN_MM = 10;

const MM_TO_PT = 72 / 25.4;
export const LABEL_W = LABEL_W_MM * MM_TO_PT;   // 283.46 pt
export const LABEL_H = LABEL_H_MM * MM_TO_PT;   // 425.20 pt
const INNER_PT = (LABEL_W_MM - LABEL_MARGIN_MM * 2) * MM_TO_PT;

// Class → [size in pt, font]. The classes are the ones `packingLabelData` returns.
const STYLE = {
  brand: [11, "F2"], meta: [8, "F1"], date: [8, "F1"], code: [15, "F2"], customer: [11, "F2"],
  item: [9, "F1"], items: [9, "F1"], note: [8, "F1"], address: [8, "F1"],
  "mail-sec": [8, "F2"], "mail-name": [10, "F2"], "mail-line": [9, "F1"],
};
const [BASE_SIZE, BASE_FONT] = [9, "F1"];

const textOf = (row) => String((row && row[1]) || "");
const classOf = (row) => String((row && row[0]) || "");

// Lay the rows out in MILLIMETRES, from the top. `measure` lays out without the bottom break so the full
// height is known; the caller uses that to shrink a label too tall for the sticker.
function layoutMm(rows, scale = 1, measure = false) {
  const lines = [];
  let y = LABEL_MARGIN_MM;
  const room = LABEL_H_MM - LABEL_MARGIN_MM;
  for (const row of rows || []) {
    const cls = classOf(row);
    const text = textOf(row);
    if (!text.trim()) continue;
    const [wantPt, font] = STYLE[cls] || [BASE_SIZE, BASE_FONT];
    // ⚠️ THE FLOOR MUST NOT DEFEAT THE FIT: at 5 pt a very long label could never shrink enough and its
    // last lines were cut. ⭐ A tiny label is better than a missing line.
    const sizePt = Math.max(1, wantPt * scale);
    const sizeMm = sizePt / MM_TO_PT;
    const lead = sizeMm * 1.32;
    const wrapped = wrapText(text, INNER_PT * scale, { font, size: sizePt });
    // ⚠️ THE CUSTOMER'S OWN WORDS ARE UNDERLINED ON THE SHEET (v244) — and the drawn label must carry the same
    // marks, or the phone's label loses the only thing that tells a packer which item the note belongs to.
    const marks = row[2] == null ? [] : [].concat(row[2]).map(String).filter(Boolean);
    for (const line of wrapped) {
      y += lead;
      if (!measure && y > room) break;
      const widthMm = textWidth(line, { font, size: sizePt }) / MM_TO_PT;
      const inner = LABEL_W_MM - LABEL_MARGIN_MM * 2;
      // Mailing blocks are left-aligned like an address; the bag labels are centred.
      const x = cls.startsWith("mail-")
        ? LABEL_MARGIN_MM
        : LABEL_MARGIN_MM + Math.max(0, (inner - widthMm) / 2);
      lines.push({ text: line, xMm: x, yMm: y, sizeMm, font, bold: font === "F2", marks });
    }
    y += 0.7 * scale; // a small gap between blocks
    if (!measure && y > room) break;
  }
  return { lines, used: y - LABEL_MARGIN_MM };
}

// The label's lines in millimetres: x from the left, y as a baseline from the top, size in mm.
// ⚠️ A label taller than the sticker is scaled down until it fits — never clipped.
export function labelLines(rows) {
  // ⚠️⚠️ SCALE UNTIL THE MEASURED LAYOUT ACTUALLY FITS (v612). ⚠️ A single linear estimate under-shot — the
  // wrap widths change with the size — so the last line could still be cut. ⭐ Every pass measures the FULL
  // layout with no bottom break, and the scale drops until it fits inside 2 mm of margin. **Nothing is ever
  // clipped; an absurdly long label simply gets smaller.**
  const room = LABEL_H_MM - LABEL_MARGIN_MM * 2 - 2;
  let scale = 1;
  let plan = layoutMm(rows, scale, true);
  let guard = 0;
  while (plan.used > room && guard < 40) {
    scale = Math.max(0.2, scale * 0.9);
    plan = layoutMm(rows, scale, true);
    guard += 1;
  }
  return plan.lines;
}

// The label as PDF bytes, at exactly 100 × 150 mm.
export function labelPdf(rows) {
  const ops = [];
  for (const l of labelLines(rows)) {
    const x = l.xMm * MM_TO_PT;
    const y = (LABEL_H_MM - l.yMm) * MM_TO_PT;
    ops.push({ op: "text", x, y, size: l.sizeMm * MM_TO_PT, font: l.font, text: l.text });
    // ⚠️ AND THE UNDERLINE UNDER THE CUSTOMER'S WORDS, in the same face and size, so the paper copy carries the
    // same mark as the screen (v626).
    for (const mark of l.marks || []) {
      const at = String(l.text).indexOf(mark);
      if (at < 0) continue;
      const before = textWidth(String(l.text).slice(0, at), { font: l.font, size: l.sizeMm * MM_TO_PT });
      const width = textWidth(mark, { font: l.font, size: l.sizeMm * MM_TO_PT });
      ops.push({ op: "rule", x1: x + before, y1: y - 1.2, x2: x + before + width, y2: y - 1.2, width: 0.6 });
    }
  }
  return makePdf([{ w: LABEL_W, h: LABEL_H, ops }]);
}

// The file's name when it arrives in the printer app, so she can tell two labels apart.
export function labelPdfName(code, ext = "pdf") {
  const safe = String(code || "label").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `Label ${safe || "label"}.${ext}`;
}

// Whether the app's files can draw every character in these rows (the PDF has one Latin face; the image uses
// the phone's own fonts, so this is the PDF's limit and the conservative answer for both).
export function labelCanPdf(rows) {
  return canDrawAll((rows || []).map(textOf).join("\n"));
}
