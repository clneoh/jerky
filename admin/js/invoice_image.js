// admin/js/invoice_image.js — the INVOICE as a 100 × 150 mm bitmap, for the Wi-Fi label printer.
//
// ⭐ WHY: on Windows the manufacturer's driver renders the browser's invoice page onto a 100 × 150 label and it
// prints perfectly. A phone has no driver, so the app must draw that same compact page itself and send it as a
// bitmap. ⚠️ This is the INVOICE (title, date, customer, item lines with amounts, total, receipt/order,
// printed date) — not the A4 PDF, and not the small customer receipt.

import { fmtRM, round2 } from "./state.js";
import { packBitmap, bytesToBase64 } from "./label_image.js";
import { textWidth } from "./pdf.js";

export const INV_W_MM = 100;
export const INV_H_MM = 150;
const MARGIN_MM = 8;
const INNER_MM = INV_W_MM - MARGIN_MM * 2;
const MM_TO_PT = 72 / 25.4;

// Sizes in millimetres. The invoice is denser than a bag label, so the body is smaller.
const SIZE = { brand: 3.6, small: 2.4, title: 4.6, sub: 3.0, body: 2.8, total: 3.4 };

const amountText = (line, cur) => {
  if (line.amount == null) return "";
  const v = round2(Number(line.amount) || 0);
  return `${line.dir === "out" ? "-" : ""}${fmtRM(v, cur)}`;
};

// Lay the invoice out in millimetres. Pure, so the content and the arithmetic can be tested without a canvas.
export function invoiceLayout(sheet, cur = "RM", { printed = "" } = {}) {
  const s = sheet || {};
  const ops = [];
  let y = MARGIN_MM;
  const push = (text, sizeMm, { bold = false, align = "left", gap = 0.8 } = {}) => {
    const sizePt = sizeMm * MM_TO_PT;
    const widthPt = INNER_MM * MM_TO_PT;
    const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && textWidth(next, { size: sizePt, font: bold ? "F2" : "F1" }) > widthPt) {
        lines.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    const lead = sizeMm * 1.35;
    for (const ln of lines) {
      y += lead;
      const x = align === "center" ? INV_W_MM / 2 : align === "right" ? INV_W_MM - MARGIN_MM : MARGIN_MM;
      ops.push({ kind: "text", text: ln, xMm: x, yMm: y, sizeMm, bold, align });
    }
    y += gap;
  };
  const rule = (gap = 1.2) => {
    y += gap;
    ops.push({ kind: "rule", yMm: y, x1: MARGIN_MM, x2: INV_W_MM - MARGIN_MM, widthMm: 0.45 });
    y += 1.0;
  };

  if (s.bakery) push(s.bakery, SIZE.brand, { bold: true, align: "center", gap: 0.2 });
  for (const ln of String(s.from || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 3)) {
    push(ln, SIZE.small, { align: "center", gap: 0.1 });
  }
  if (s.title) push(s.title, SIZE.title, { bold: true, align: "center", gap: 0.15 });
  if (s.subtitle) push(s.subtitle, SIZE.sub, { align: "center", gap: 0.5 });
  if (s.to) push(s.to, SIZE.body, { gap: 0.8 });

  rule(0.2);
  for (const line of s.lines || []) {
    // ⚠️ A LINE WITH AN AMOUNT IS DRAWN AS A PAIR, LEFT AND RIGHT (v628) — the columns the driver's page
    // prints, not a single run-on sentence.
    const amount = amountText(line, cur);
    const sizePt = SIZE.body * MM_TO_PT;
    if (amount) {
      const amountW = textWidth(amount, { size: sizePt, font: "F1" }) / MM_TO_PT;
      const whatW = INNER_MM - amountW - 3;
      const words = String(line.what || "").split(/\s+/).filter(Boolean);
      let curLine = "";
      const wrapped = [];
      for (const w of words) {
        const next = curLine ? `${curLine} ${w}` : w;
        if (curLine && textWidth(next, { size: sizePt, font: "F1" }) / MM_TO_PT > whatW) {
          wrapped.push(curLine); curLine = w;
        } else { curLine = next; }
      }
      if (curLine) wrapped.push(curLine);
      wrapped.forEach((ln, i) => {
        y += SIZE.body * 1.35;
        ops.push({ kind: "text", text: ln, xMm: MARGIN_MM, yMm: y, sizeMm: SIZE.body, align: "left" });
        if (i === wrapped.length - 1) {
          ops.push({ kind: "text", text: amount, xMm: INV_W_MM - MARGIN_MM, yMm: y,
            sizeMm: SIZE.body, align: "right" });
        }
      });
      y += 0.6;
    } else {
      push(line.what, SIZE.body, { gap: 0.5 });
    }
  }
  rule(0.8);
  for (const t of s.totals || []) {
    const amount = amountText(t, cur);
    y += SIZE.total * 1.35;
    ops.push({ kind: "text", text: String(t.label || "Total"), xMm: MARGIN_MM, yMm: y,
      sizeMm: SIZE.total, bold: true, align: "left" });
    ops.push({ kind: "text", text: amount, xMm: INV_W_MM - MARGIN_MM, yMm: y,
      sizeMm: SIZE.total, bold: true, align: "right" });
  }
  y += 1.4;
  if (s.receipt) push(s.receipt, SIZE.small, { gap: 0.2 });
  push(printed || s.printed || "", SIZE.small, { gap: 0.4 });
  if (s.note) push(s.note, SIZE.small, { gap: 0.2 });

  // ⚠️ A PAGE TALLER THAN THE STICKER IS SCALED, NEVER CLIPPED — the same rule the bag label follows.
  const room = INV_H_MM - MARGIN_MM;
  const used = y - MARGIN_MM;
  if (used > room) {
    const k = Math.max(0.4, room / used);
    for (const op of ops) {
      op.sizeMm = Math.max(1, op.sizeMm * k);
      op.yMm = MARGIN_MM + (op.yMm - MARGIN_MM) * k;
    }
  }
  return ops;
}

// Draw the invoice on a canvas at the printer's resolution, and pack it as the job's 1-bit bitmap.
export function invoiceBitmap(sheet, cur = "RM", { dpi = 203, printed = "" } = {}) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  const canvas = document.createElement("canvas");
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const pxPerMm = dpi / 25.4;
  canvas.width = Math.round(INV_W_MM * pxPerMm);
  canvas.height = Math.round(INV_H_MM * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";
  for (const op of invoiceLayout(sheet, cur, { printed })) {
    if (op.kind === "rule") {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, op.widthMm * pxPerMm);
      ctx.beginPath();
      ctx.moveTo(op.x1 * pxPerMm, op.yMm * pxPerMm);
      ctx.lineTo(op.x2 * pxPerMm, op.yMm * pxPerMm);
      ctx.stroke();
      continue;
    }
    const size = Math.max(4, op.sizeMm * pxPerMm);
    ctx.font = `${op.bold ? "bold " : ""}${size.toFixed(1)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = op.align === "right" ? "right" : op.align === "center" ? "center" : "left";
    const room = (op.align === "right" ? op.xMm - MARGIN_MM : INV_W_MM - MARGIN_MM - op.xMm) * pxPerMm;
    ctx.fillText(op.text, op.xMm * pxPerMm, op.yMm * pxPerMm, Math.max(1, room));
    ctx.textAlign = "left";
  }
  const { widthBytes, bytes } = packBitmap(ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height);
  return { widthMm: INV_W_MM, heightMm: INV_H_MM, widthBytes, height: canvas.height, data: bytesToBase64(bytes) };
}
