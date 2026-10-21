// test/label-image.test.js — the label as an IMAGE, which is the file type most printer apps accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labelImageBlob, labelImageFile } from "../admin/js/label_image.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★ with no canvas, the image is honestly absent — never a broken file (v612)", async () => {
  const rows = [["customer", "Lucy"], ["item", "Focaccia ×2"]];
  assert.equal(await labelImageBlob(rows), null, "a canvas was invented where there is none");
  assert.equal(await labelImageFile(rows, "Label.png"), null, "a File was made with no image in it");
});

test("★★★ Share offers the IMAGE before the PDF, because Android filters by file type (v612)", () => {
  const orders = read("admin/js/views/orders.js");
  const imageAt = orders.indexOf("labelImageFile(rows");
  const pdfAt = orders.indexOf("new File([labelPdf(rows)]");
  assert.ok(imageAt > 0 && pdfAt > 0, "one of the two files is gone");
  assert.ok(imageAt < pdfAt, "★ the PDF is offered first — a printer app that only takes images never appears");
  assert.match(read("admin/js/label_image.js"), /"image\/png"/, "the image is not a PNG");
  assert.match(read("admin/js/label_image.js"), /300/, "the image is not at a print resolution");
});

test("★★★ the share attempts the image itself, not a canShare verdict (v615)", () => {
  const orders = read("admin/js/views/orders.js");
  // ⚠️ A phone can answer no for a type it would in fact share; the old gate then skipped the image and
  // offered the PDF — which is why the printer app still never appeared.
  // ⚠️ Match the CALL, not the comment that explains why the call is gone.
  assert.equal(/nav\.canShare\s*\(/.test(orders), false, "★ the share is gated on canShare again");
  assert.match(orders, /button\("Save a copy"/, "★ there is no file-saving route for an app that never joins the sheet");
  assert.match(read("admin/js/label_image.js"), /toDataURL/, "★ a canvas with no toBlob yields no image at all");
});
