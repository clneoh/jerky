// test/invoice-image.test.js — the invoice drawn for the 100 × 150 label printer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { invoiceLayout, INV_H_MM, INV_W_MM } from "../admin/js/invoice_image.js";

const sheet = () => ({
  bakery: "Jien Luv 2 Bake",
  from: "41, Lengkok Kenari, SG Ara\n11900 Bayan Lepas, Penang",
  title: "Invoice #000020",
  subtitle: "16 Oct 2026",
  to: "LS Pure Lotus",
  receipt: "Receipt #000020 · Order #8180D9",
  lines: [
    { what: "24 × Focaccia 9\"x12\" ~ 850g", amount: 384 },
    { what: "Code SAVE5", amount: 5, dir: "out" },
  ],
  totals: [{ label: "Total", amount: 379 }],
  note: "Postage RM 8.00 is paid to the driver on delivery (cash on delivery).",
});
const texts = (ops) => ops.filter((o) => o.kind === "text").map((o) => o.text).join(" | ");

test("★★★ the drawn invoice carries its title, date, customer, columns and printed day (v628)", () => {
  const ops = invoiceLayout(sheet(), "RM", { printed: "printed 23 Oct 2026" });
  const all = texts(ops);
  assert.match(all, /Jien Luv 2 Bake/);
  assert.match(all, /Invoice #000020/);
  assert.match(all, /16 Oct 2026/, "★ the placed day is missing");
  assert.match(all, /LS Pure Lotus/);
  assert.match(all, /24 × Focaccia/);
  assert.match(all, /RM 384\.00/, "★ the item amount is missing");
  assert.match(all, /-RM 5\.00/, "★ a discount is not marked as money off");
  assert.match(all, /Total/);
  assert.match(all, /RM 379\.00/);
  assert.match(all, /Receipt #000020 · Order #8180D9/);
  assert.match(all, /printed 23 Oct 2026/);
  assert.match(all, /cash on delivery/);
});

test("★★★ nothing is drawn off the 100 × 150 sticker (v628)", () => {
  const ops = invoiceLayout(sheet());
  assert.ok(ops.length > 5);
  for (const op of ops) {
    assert.ok(op.yMm >= 0 && op.yMm <= INV_H_MM, `a line sits at ${op.yMm} mm`);
    if (op.kind === "rule") {
      assert.ok(op.x1 >= 0 && op.x2 <= INV_W_MM, `a rule runs from ${op.x1} to ${op.x2} mm`);
    } else {
      assert.ok(op.xMm >= 0 && op.xMm <= INV_W_MM, `a line sits at ${op.xMm} mm`);
    }
  }
});

test("★★ the invoice card offers it on the same printer (v628)", () => {
  const src = readFileSync(new URL("../admin/js/views/orders.js", import.meta.url), "utf8");
  assert.match(src, /Invoice over Wi-Fi/, "★ the invoice has no Wi-Fi press");
  assert.match(src, /invoiceBitmap\(sheet/, "★ the invoice is not drawn for the printer");
});
