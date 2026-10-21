// test/label-fit.test.js — a long label must stay on ONE 100 × 150 mm sticker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// The helper is pure and exported from the view that prints; the view's DOM needs a shim, so the function is
// taken from the source and evaluated alone rather than importing the whole screen.
function scaleFor() {
  const src = read("admin/js/views/orders.js");
  const at = src.indexOf("export function labelScaleFor");
  assert.ok(at > 0, "labelScaleFor moved");
  const end = src.indexOf("\n}\n", at) + 3;
  const fn = src.slice(at, end).replace("export ", "");
  const box = { exports: {} };
  vm.runInNewContext(`${fn}\nthis.out = labelScaleFor;`, box);
  return box.out;
}

test("★★★ a label taller than the sticker is scaled to fit, and a short one is left alone (v610)", () => {
  const scale = scaleFor();
  assert.equal(scale(400), 1, "a short label was shrunk");
  assert.equal(scale(566), 1, "a label that just fits was shrunk");
  const s = scale(979);
  assert.ok(s > 0.57 && s < 0.59, `a 25-line label should shrink to about 0.58, got ${s}`);
  assert.equal(Number((979 * s).toFixed(1)), 566.9, "the scaled height does not reach the 150 mm sheet");
  assert.equal(scale(0), 1, "no measurement must never scale a label into nothing");
  assert.equal(scale(NaN), 1, "an unreadable measurement must never scale a label");
  assert.equal(scale(-5), 1, "a negative measurement must never scale a label");
});

test("★★ the print measures the real 100 mm width before deciding (v610)", () => {
  const src = read("admin/js/views/orders.js");
  assert.match(src, /width: "100mm", maxWidth: "100mm", transform: "none"/,
    "★ the fit is measured at the popup's width, not the label's");
  assert.match(src, /sheet\.style\.transform = `scale\(\$\{scale\}\)`/,
    "★ the measured scale is never applied to the sheet");
});
