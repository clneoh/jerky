// test/receipt-slip.test.js — the small receipt on the label printer, and its money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptSlipRows } from "../admin/js/receipt_slip.js";

const state = (over = {}) => ({
  settings: { currency: "RM", storefront: { name: "Jien Luv 2 Bake" } },
  products: [
    { id: "p1", name: "Focaccia", price: 16, active: true },
    { id: "p2", name: "Sandwich", price: 12, active: true },
  ],
  deliveryDates: [{ id: "d1", date: "2026-10-21" }],
  orders: [{
    id: "ord_aaaaaaaaaaaa", groupId: "group_ord_aaaaaaaaaaaa", productId: "p1", qty: 2, unitPrice: 16,
    deliveryDateId: "d1", deliveryDate: "2026-10-21", customerName: "Aisyah",
    status: "paid", paidReceived: true, paidMethod: "Cash", receiptNo: 7,
  }],
  ...over,
});
const textOf = (rows, cls) => rows.filter((r) => r[0] === cls).map((r) => r[1]).join(" | ");
const walk = (rows) => rows.map((r) => r[1]).join(" ");

test("★★★ the slip names the bakery, the order and the customer (v623)", () => {
  const rows = receiptSlipRows(state(), { orders: state().orders });
  const all = walk(rows);
  assert.match(all, /Jien Luv 2 Bake/, "★ the bakery's name is missing");
  assert.match(all, /RECEIPT/);
  assert.match(all, /#AAAAAA/, "★ the order code is missing");
  assert.match(all, /Aisyah/);
  assert.match(all, /21 Oct 2026/, "the bake day is not on the slip");
});

test("★★★ the items and the total come from the same money reader as the invoice (v623)", () => {
  const st = state();
  const rows = receiptSlipRows(st, { orders: st.orders });
  const all = walk(rows);
  assert.match(all, /Focaccia x2\s+RM/, "★ the item line does not carry its quantity and amount");
  assert.match(textOf(rows, "customer"), /TOTAL\s+RM 32\.00/, "★ the total is not the order's own total");
  assert.match(all, /Paid - Cash/);
  assert.match(all, /Receipt #000007/, "★ the receipt number is missing");
});

test("★★★ a two-day sale is ONE slip, with every line (v623)", () => {
  const st = state();
  st.orders.push({
    id: "ord_bbbbbbbbbbbb", groupId: "group_ord_aaaaaaaaaaaa", productId: "p2", qty: 1, unitPrice: 12,
    deliveryDateId: "d1", deliveryDate: "2026-10-21", customerName: "Aisyah",
    status: "paid", paidReceived: true, paidMethod: "Cash", receiptNo: 7,
  });
  const rows = receiptSlipRows(st, { orders: [st.orders[0]] });
  const all = walk(rows);
  assert.match(all, /Focaccia x2/);
  assert.match(all, /Sandwich x1/, "★ the other day's line is missing from the slip");
  assert.match(textOf(rows, "customer"), /TOTAL\s+RM 44\.00/, "★ the slip totals one day instead of the sale");
});

test("★★ the invoice popup offers the slip, on the same printer (v623)", () => {
  const src = readFileSync(new URL("../admin/js/views/orders.js", import.meta.url), "utf8");
  assert.match(src, /Receipt over Wi-Fi/, "★ the invoice has no receipt press");
  assert.match(src, /labelBitmap\(rows, 203\)/, "★ the receipt is not drawn for the printer");
});
