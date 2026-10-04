// pdf.js — the smallest PDF writer that can hold a journal (3 Oct 2026).
//
// Why this exists: her share sheet opened but WhatsApp was not in it. A phone offers WhatsApp
// for a FILE and not always for a bare block of text, so a journal that leaves the app as a
// real document is the one that reaches the app she actually sends things with.
//
// Hand-written and dependency-free, like `qr.js`, because this app has no build step and no
// package manager. Nothing here knows what a journal is — it draws text and rules on a page
// and assembles the bytes. `journal.js` decides what goes on the page.
//
// TWO DECISIONS THAT KEEP IT SMALL:
//   1. The base-14 fonts (Helvetica, Helvetica-Bold) are guaranteed to be in every PDF reader,
//      so nothing is embedded — the file is a few kilobytes and there is no font to ship.
//   2. Everything is drawn in WinAnsi, which is one byte per character, so a byte offset in the
//      file is just a character offset in the string we build. The cross-reference table is
//      therefore arithmetic rather than bookkeeping.

// A4 in points (210 × 297 mm at 72 dpi). The unit every PDF measures in.
export const A4 = { w: 595.28, h: 841.89 };

// The printable range of Helvetica and Helvetica-Bold, in 1000ths of the font size, for the
// 95 characters from space (32) to tilde (126). Read from the Adobe metrics that every PDF
// reader uses, and checked against a real reader's own text measurement rather than trusted.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// The handful of characters above ASCII that a journal actually contains — the separator she
// reads in "1 Oct · boxes · Cash". Bullet, en dash and em dash have the same widths in both
// faces, so one table serves them.
const ABOVE_ASCII = { 0xb7: 278, 0x96: 556, 0x97: 1000 };

const FONTS = { F1: HELVETICA, F2: HELVETICA_BOLD };

// Windows-1252, the encoding a PDF reads as WinAnsi. Only the range 0x80–0x9F differs from
// Latin-1, and it is exactly the range the punctuation she types lives in.
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Characters WinAnsi simply does not have, said another way BEFORE anything is measured, so
// the width of a line and the bytes of that line can never disagree. The minus sign is the one
// that matters: a money journal writes money leaving as "−RM 30.00", and a true minus is not in
// WinAnsi — printing a question mark instead would put a fault on her paper at every outgoing
// row. A hyphen is what a reader of a printed account expects anyway.
export function sanitize(text) {
  return String(text == null ? "" : text)
    .replace(/−/g, "-")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/ /g, " ")
    .replace(/\t/g, "  ");
}

// A character as the single byte WinAnsi stores it in, or 0x3F ("?") for anything the encoding
// cannot hold. Nothing reaches this that `sanitize` has not already been over, so "?" is a
// last resort that a test asserts is never reached by a real journal.
function byteOf(ch) {
  const code = ch.codePointAt(0);
  if (code < 128) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  if (CP1252[code] != null) return CP1252[code];
  return 0x3f;
}

const widthOfByte = (byte, font) => {
  if (byte >= 32 && byte <= 126) return font[byte - 32];
  if (ABOVE_ASCII[byte] != null) return ABOVE_ASCII[byte];
  return 556;
};

// How wide a piece of text will be, in points, at a given size. The one measurement every
// right-aligned figure and every wrapped sentence depends on.
export function textWidth(text, { font = "F1", size = 10 } = {}) {
  const table = FONTS[font] || HELVETICA;
  let units = 0;
  for (const ch of sanitize(text)) units += widthOfByte(byteOf(ch), table);
  return (units * size) / 1000;
}

// Break a sentence into lines that fit a column. Words are kept whole; a single word too long
// for the column is broken on the character rather than allowed to run off the page, because a
// note may name a long ingredient and a line that leaves the paper is worse than a hyphen.
export function wrapText(text, maxWidth, { font = "F1", size = 10 } = {}) {
  const clean = sanitize(text);
  const lines = [];
  for (const para of clean.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (let word of words) {
      while (textWidth(word, { font, size }) > maxWidth) {
        let cut = word.length;
        while (cut > 1 && textWidth(word.slice(0, cut), { font, size }) > maxWidth) cut -= 1;
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, { font, size }) > maxWidth && line) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// A literal string in PDF syntax. A backslash, an open bracket and a close bracket are the
// three characters the format reserves, and a journal's own note may contain any of them.
function lit(text) {
  let out = "";
  for (const ch of sanitize(text)) {
    const byte = byteOf(ch);
    if (byte === 0x5c) out += "\\\\";
    else if (byte === 0x28) out += "\\(";
    else if (byte === 0x29) out += "\\)";
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
}

const n = (x) => (Math.round(x * 100) / 100).toString();
const rgb = (c) => c.map((v) => n(Math.min(1, Math.max(0, v)))).join(" ");

// One page's draw commands, as PDF operators. A page is a list of plain ops so that nothing
// above this file has to know the format.
function contentOf(page) {
  const out = [];
  for (const op of page.ops || []) {
    const [r, g, b] = op.color || [0, 0, 0];
    if (op.op === "rule") {
      out.push(`${rgb([r, g, b])} RG`, `${n(op.width == null ? 0.5 : op.width)} w`,
        `${n(op.x1)} ${n(op.y1)} m ${n(op.x2)} ${n(op.y2)} l S`);
    } else {
      // PDF's origin is bottom-left, so a baseline is already y-up and needs no conversion.
      out.push("BT", `/${op.font || "F1"} ${n(op.size || 10)} Tf`,
        `${rgb([r, g, b])} rg`,
        `1 0 0 1 ${n(op.x)} ${n(op.y)} Tm`, `${lit(op.text)} Tj`, "ET");
    }
  }
  return out.join("\n");
}

// Assemble pages into a PDF file, as bytes.
//
// The document is written in the order a reader reads it — catalog, page tree, then each page
// with its content, then the two fonts — and the cross-reference table at the end records where
// each object began. Because everything is one byte per character, "where it began" is the
// running length of what has been written so far.
export function makePdf(pages) {
  const list = (pages || []).filter(Boolean);
  if (!list.length) throw new Error("makePdf needs at least one page");

  const count = list.length;
  const firstPageObj = 3;
  const firstContentObj = firstPageObj + count;
  const helvObj = firstContentObj + count;
  const boldObj = helvObj + 1;

  const parts = [];
  let length = 0;
  const offsets = [0];              // 1-based object numbers; [0] is unused
  const push = (s) => { parts.push(s); length += s.length; };
  const object = (num, body) => { offsets[num] = length; push(`${num} 0 obj\n${body}\nendobj\n`); };

  push("%PDF-1.4\n");
  // A comment of high bytes marks the file as binary, which is what stops a transfer program
  // from deciding it is text and rewriting its line endings.
  push("%\xe2\xe3\xcf\xd3\n");

  const kids = list.map((_, i) => `${firstPageObj + i} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);

  list.forEach((page, i) => {
    const w = page.w || A4.w;
    const h = page.h || A4.h;
    const body = contentOf(page);
    object(firstPageObj + i,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] `
      + `/Resources << /Font << /F1 ${helvObj} 0 R /F2 ${boldObj} 0 R >> >> `
      + `/Contents ${firstContentObj + i} 0 R >>`);
    object(firstContentObj + i, `<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });

  object(helvObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  object(boldObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const total = boldObj + 1;
  const xrefAt = length;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  // Written as one pass: every character above is a single byte, which is the invariant the
  // offsets depend on.
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) bytes[at + i] = part.charCodeAt(i) & 0xff;
    at += part.length;
  }
  return bytes;
}
