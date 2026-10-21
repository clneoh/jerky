// admin/js/label_image.js — the same label as a PNG, because most label-printer apps register for images.
//
// ⚠️⚠️ ANDROID'S SHARE SHEET ONLY OFFERS APPS THAT ACCEPT THE FILE'S TYPE. A printer app that handles
// `image/*` and not `application/pdf` never appears when a PDF is shared — ⭐ so the image is offered first
// and the PDF is the fallback. The lines come from `labelLines`, the SAME layout the PDF draws.

import { LABEL_H_MM, LABEL_W_MM, labelLines } from "./label_pdf.js";

const DPI = 300;                 // a label printer's own resolution is 203–300 dpi; 300 prints crisply
// PX_PER_MM is derived from the DPI passed to `labelCanvas`, so the same layout can be drawn at a phone's
// 300 dpi or the printer's 203 dpi.

// Draw the label onto a canvas. Returns the canvas, or null when there is no canvas at all (the test shims,
// or a browser that refuses one) — the caller then falls back to the PDF.
export function labelCanvas(rows, dpi = 300) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  let canvas;
  try { canvas = document.createElement("canvas"); } catch { return null; }
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const pxPerMm = dpi / 25.4;
  canvas.width = Math.round(LABEL_W_MM * pxPerMm);
  canvas.height = Math.round(LABEL_H_MM * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const maxWidthMm = LABEL_W_MM - 10; // the layout's own inner width; the rest is the margin
  for (const line of labelLines(rows)) {
    const size = Math.max(4, line.sizeMm * pxPerMm);
    ctx.font = `${line.bold ? "bold " : ""}${size.toFixed(1)}px system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
    const x = line.xMm * pxPerMm;
    const room = Math.max(1, maxWidthMm * pxPerMm - (x - 10 * pxPerMm));
    // ⚠️ `maxWidth` compresses a line that the canvas font makes slightly wider than the PDF's Helvetica
    // measurement — so a long address can never run off the sticker's edge.
    ctx.fillText(line.text, x, line.yMm * pxPerMm, room);
  }
  return canvas;
}

// The label as a PNG Blob, or null where there is no canvas.
export function labelImageBlob(rows) {
  const canvas = labelCanvas(rows);
  if (!canvas) return Promise.resolve(null);
  // ⚠️⚠️ SOME BROWSERS HAVE NO `toBlob` (OR IT DOES NOTHING) — v615. ⚠️ Without this fallback the image
  // silently disappeared and the share fell back to the PDF, ⚠️ **which is why the printer app still never
  // appeared in her sheet.** ⭐ `toDataURL` is present everywhere; the bytes are the same PNG.
  if (typeof canvas.toBlob === "function") {
    const viaBlob = new Promise((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob || null), "image/png"); } catch { resolve(null); }
    });
    // A canvas that answers `null` is tried the other way below.
    return viaBlob.then((blob) => blob || blobFromDataUrl(canvas));
  }
  return Promise.resolve(blobFromDataUrl(canvas));
}

function blobFromDataUrl(canvas) {
  try {
    if (typeof canvas.toDataURL !== "function" || typeof atob !== "function" || typeof Blob !== "function") {
      return null;
    }
    const data = String(canvas.toDataURL("image/png") || "");
    const comma = data.indexOf(",");
    if (comma < 0) return null;
    const bin = atob(data.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  } catch { return null; }
}

// ⭐⭐ THE LABEL AS A 1-BIT BITMAP FOR THE PRINTER (v617). TSPL takes a monochrome bitmap; this is the same
// drawing, at the printer's own 203 dpi, with every dark pixel turned into a 1. Pure, so it can be tested
// without a canvas.
export function packBitmap(rgba, width, height) {
  const widthBytes = Math.ceil(width / 8);
  const bytes = new Uint8Array(widthBytes * height);
  const px = Array.isArray(rgba) || rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array
    ? rgba : (rgba && rgba.data) || [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (i + 2 >= px.length) continue;
      const alpha = px.length > i + 3 ? px[i + 3] : 255;
      // ⚠️ A transparent pixel is PAPER, not ink — the canvas is filled white, but a caller's frame may not be.
      const lum = alpha < 128 ? 255 : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < 128) bytes[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7); // 1 = black in TSPL
    }
  }
  return { widthBytes, height, bytes };
}

export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  try { return btoa(bin); } catch { return ""; }
}

// The job the phone sends through the queue: everything the bridge needs to print one label.
export function labelBitmap(rows, dpi = 203) {
  const canvas = labelCanvas(rows, dpi);
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.getImageData !== "function") return null;
  const { width, height } = canvas;
  let img;
  try { img = ctx.getImageData(0, 0, width, height); } catch { return null; }
  const { widthBytes, bytes } = packBitmap(img && img.data, width, height);
  return {
    widthMm: LABEL_W_MM,
    heightMm: LABEL_H_MM,
    widthBytes,
    height,
    data: bytesToBase64(bytes),
  };
}

// The label as a File the phone can hand to another app, or null.
export async function labelImageFile(rows, name = "Label.png") {
  if (typeof File !== "function") return null;
  const blob = await labelImageBlob(rows);
  if (!blob) return null;
  try { return new File([blob], name, { type: "image/png" }); } catch { return null; }
}
