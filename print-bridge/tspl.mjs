// print-bridge/tspl.mjs — one label job as TSPL, the language a Gprinter GP-1326D speaks.
//
// ⚠️ THE PRINTER IS 203 DPI AND 104 mm WIDE; the job's bitmap is already drawn at 203 dpi by the app, at the
// label's own 100 × 150 mm. ⭐ Nothing here scales anything: `BITMAP` receives the bytes as they were drawn.
//
// Pure and exported, so it can be tested without a printer.

export function tsplForBitmap(job, { gapMm = 2, copies = 1, invert = false } = {}) {
  if (!job || typeof job !== "object") throw new Error("a print job is required");
  const widthMm = Number(job.widthMm) > 0 ? Number(job.widthMm) : 100;
  const heightMm = Number(job.heightMm) > 0 ? Number(job.heightMm) : 150;
  const widthBytes = Math.floor(Number(job.widthBytes));
  const height = Math.floor(Number(job.height));
  if (!(widthBytes > 0) || !(height > 0)) throw new Error("the job has no bitmap size");
  let data = Buffer.from(String(job.data || ""), "base64");
  if (!data.length) throw new Error("the job has no bitmap data");
  // ⚠️⚠️ THIS PRINTER DRAWS A SET BIT AS PAPER (v618). ⚠️ Measured on her GP-1326D: the label came out with a
  // dark background and white letters — ⚠️ **the bitmap's polarity is the opposite of the TSPL most references
  // describe.** ⭐ So the bridge flips every bit just before printing; the phone's job keeps one meaning
  // (1 = ink) and the printer's quirk stays on the machine that knows the printer.
  if (invert) data = Buffer.from(data.map((b) => b ^ 0xff));

  const head = Buffer.from(
    `SIZE ${widthMm} mm,${heightMm} mm\r\n`
    + `GAP ${gapMm} mm,0 mm\r\n`
    + "DIRECTION 1\r\n"
    + "CLS\r\n"
    + `BITMAP 0,0,${widthBytes},${height},0,`,
    "ascii",
  );
  const tail = Buffer.from(`\r\nPRINT ${Math.max(1, copies)}\r\n`, "ascii");
  return Buffer.concat([head, data, tail]);
}
