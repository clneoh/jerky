// test/invoice.test.js — one order, one invoice (v293; numbered by the order's own code
// since v294).
//
// Her words: "And customer need an invoice", and to what it should carry: "One order,
// one invoice" and "Yes — name, address, a number". Then, the day it shipped, the better
// answer to the number: "for the invoice, i think we can use the order code as invoice
// number".
//
// What this file is for, in one sentence: THE NUMBER IS THE ORDER'S OWN CODE AND MAKING
// AN INVOICE WRITES NOTHING, WHILE THE MONEY IS READ AND NEVER RE-ADDED. The code is
// unique by construction, so there is no counter to share between two phones and nothing
// to store; the money is `customerTotal` because that is the one function the
// confirmation message, the tracking card and the order row already read — an invoice
// that worked the sum out itself is an invoice that could disagree with all three.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceCurrency, invoiceLineAmount, invoiceLineName, invoiceNo, invoiceSheet,
} from "../admin/js/invoice.js";
import { fromLines, journalSheet } from "../admin/js/journal.js";
import { customerTotal } from "../admin/js/courier.js";
import { orderCode } from "../admin/js/state.js";

function state(extra = {}) {
  return {
    settings: { currency: "RM", storefront: { name: "Jien Luv 2 Bake" },
      mailingAddress: "Jien Luv 2 Bake\n12, Jalan Bunga Raya\n11600 Pulau Pinang\n016 960 1268" },
    products: [{ id: "p1", name: "Focaccia", price: 15 }, { id: "p2", name: "Sandwich", price: 12 }],
    deliveryDates: [{ id: "d18", date: "2026-09-18" }],
    orders: [],
    promoCodes: [],
    ...extra,
  };
}

const group = (rows) => ({ orders: rows });
const line = (over = {}) => ({
  id: "ordabc123", groupId: "abc123", deliveryDateId: "d18", deliveryDate: "2026-09-18",
  fulfillment: "pickup", whatsapp: "60123456789", customerName: "Aunty Bee",
  orderDate: "2026-09-15", productId: "p1", qty: 2, productName: "Focaccia",
  unitPrice: 15, status: "ready", ...over,
});

// A cart that really lives in `state.orders`, because that is where the money and the
// order's own identity are read from.
function cart(rows = [{}], st = state()) {
  st.orders = rows.map((o, i) => line({ id: "o" + (i + 1), ...o }));
  return { st, g: group(st.orders) };
}

const mkCode = (over = {}) => ({
  id: "c1", code: "FRESH10", state: "live", vis: "public", frozen: false,
  who: { type: "all" }, when: { from: "", to: "" }, basket: { type: "none", amount: 0 },
  gives: { type: "rm", value: 10, cap: 0 }, often: { type: "unlimited", n: 0, maxRM: 0 },
  beside: { type: "anything" }, say: "", sayZh: "", sayMs: "", used: 0, given: 0, ...over,
});

// ── the number is the order's own code ───────────────────────────────────────

test("the invoice number IS the order code, and it is the same one every time", () => {
  // Her words: "for the invoice, i think we can use the order code as invoice number".
  // The code is the last six hex of the order's own id, so it is unique by
  // construction — there is no counter for two phones to share and disagree about, and
  // nothing to store. This is also the SAME reference the row's own tag, the
  // confirmation and the tracking card carry, so one order cannot be quoted two ways.
  const { st, g } = cart();
  assert.equal(invoiceNo(g), "ABC123");
  assert.equal(invoiceNo(g), orderCode(st.orders[0]), "read exactly as the order row reads it");
  assert.equal(journalSheet(invoiceSheet(st, g)).title, "Invoice #ABC123");
  // A reprint reads the same number because the number was never stored to be re-given.
  assert.equal(invoiceNo(g), invoiceNo(group(st.orders)), "the same order, the same number");
});

test("two orders are two invoices, and neither is numbered by the other", () => {
  const st = state();
  st.orders = [
    line({ id: "o1", groupId: "aaaaaa" }),
    line({ id: "o2", groupId: "bbbbbb" }),
  ];
  const a = group([st.orders[0]]);
  const b = group([st.orders[1]]);
  assert.equal(invoiceNo(a), "AAAAAA");
  assert.equal(invoiceNo(b), "BBBBBB");
  assert.notEqual(invoiceNo(a), invoiceNo(b), "an invoice number belongs to one order");
});

test("a cart's rows all carry one invoice number, whichever row you open", () => {
  // A cart is several rows sharing a groupId, and `invoiceNo` reads the first — so the
  // number is the CART's and not the row's. Two rows of one order quoted a different
  // number would be the same fault as two rows quoting a different total.
  const { st, g } = cart([{ groupId: "abc123" }, { groupId: "abc123", productId: "p2" }]);
  assert.equal(st.orders.length, 2);
  assert.equal(invoiceNo(g), "ABC123");
  assert.equal(orderCode(st.orders[1]), "ABC123");
});

test("MAKING AN INVOICE WRITES NOTHING ONTO THE ORDER", () => {
  // THE WHOLE REASON THE CODE IS BETTER THAN A RUNNING NUMBER. v293 stamped a number
  // onto the order on first use, and had to carry the caveat that two phones issuing in
  // the same instant could take the same one. With the order's own code there is no
  // number to assign, so pressing Invoice touches no record at all.
  const { st, g } = cart();
  const before = JSON.stringify(st.orders);
  invoiceSheet(st, g, { bakery: "Jien Luv 2 Bake" });
  invoiceSheet(st, g);
  assert.equal(JSON.stringify(st.orders), before, "not one field on the order moved");
  assert.equal(st.orders[0].invoiceNo, undefined, "and nothing was written onto it");
});

test("an order with no rows has no invoice number", () => {
  assert.equal(invoiceNo(group([])), "");
  assert.equal(invoiceNo(null), "");
  assert.equal(journalSheet(invoiceSheet(state(), group([]))).title, "Invoice #");
});

// ── what the paper carries ───────────────────────────────────────────────────

test("an invoice is one order: the items at the price they were SOLD at, then the total", () => {
  const { st, g } = cart();
  const s = journalSheet(invoiceSheet(st, g, { bakery: "Jien Luv 2 Bake" }));
  assert.equal(s.title, "Invoice #ABC123");
  assert.equal(s.subtitle, "15 Sep 2026", "the day the order was placed, which a reprint keeps");
  assert.deepEqual(s.lines.map((l) => [l.what, l.amount]), [["2 × Focaccia", 30]]);
  assert.deepEqual(s.totals, [{ label: "Total", amount: 30, cls: "pl-total" }]);
});

test("the invoice's Total IS the customer's total, to the cent", () => {
  // The one guarantee that makes this an invoice rather than a second opinion. The
  // confirmation message, the tracking card and the order row all read `customerTotal`;
  // an invoice that added the lines up itself could disagree with all three.
  const st = state({ promoCodes: [mkCode()] });
  const { g } = cart([{
    promo: "FRESH10", fulfillment: "courier", courierFee: 8, courierPaidBy: "customer",
  }], st);
  const parts = customerTotal(st, g);
  const s = journalSheet(invoiceSheet(st, g));
  assert.equal(s.totals[0].amount, parts.total, "the invoice totals what the customer owes");
  assert.equal(s.totals[0].amount, Math.max(0, parts.items + parts.courier - parts.promo));
});

test("a courier charge the customer bears is a line; a charge she bears is not", () => {
  const st = state();
  const { g: charged } = cart([{ fulfillment: "courier", courierFee: 8, courierPaidBy: "customer" }], st);
  const a = journalSheet(invoiceSheet(st, charged));
  assert.deepEqual(a.lines.map((l) => l.what), ["2 × Focaccia", "Courier"]);
  assert.equal(a.lines[1].amount, 8);

  // She bears it herself, or the order is a collection: no row, because the customer
  // was never asked for it. A charge on the invoice the customer does not owe is the
  // same fault as a discount stated in one place and not another.
  const own = group([line({ id: "o2", groupId: "def456", fulfillment: "courier",
    courierFee: 8, courierPaidBy: "me" })]);
  assert.deepEqual(journalSheet(invoiceSheet(st, own)).lines.map((l) => l.what), ["2 × Focaccia"]);
});

test("the code comes off as its own row, named, with the minus in front", () => {
  const st = state({ promoCodes: [mkCode()] });
  const { g } = cart([{ promo: "FRESH10" }], st);
  const s = journalSheet(invoiceSheet(st, g));
  const code = s.lines.find((l) => l.what.startsWith("Code "));
  assert.ok(code, "the code is a line of its own, never folded into the items");
  assert.equal(code.what, "Code FRESH10", "and it is named, so the customer can check it");
  assert.equal(code.amount, 10);
  assert.equal(code.dir, "out", "dir 'out' is what prints the minus on every rendering");
  assert.equal(s.totals[0].amount, 20);
});

test("the bring-a-friend discount comes off as its own line, above the Total it moves", () => {
  // ★ v330, and it is the "probably other place?" half of her report. Her receipt and the
  // invoice are the two screens that list an order's money as a sum; v322 taught the
  // customer's MESSAGE about the coupon and left both of these out, so both read
  // "Items RM 30.00" straight down to "Total RM 27.00" with nothing between them.
  const st = state({ credits: [{ id: "cr1", role: "friendOff", orderCode: "ABC123",
    holder: "60123456789", amountRM: 3, status: "valid" }] });
  const { g } = cart([{}], st);
  const s = journalSheet(invoiceSheet(st, g));
  const coupon = s.lines.find((l) => l.what === "Bring-a-friend discount");
  assert.ok(coupon, "the discount is a line of its own, never folded into the items");
  assert.equal(coupon.amount, 3, "with the ringgit that actually came off");
  assert.equal(coupon.dir, "out", "and the minus every other reduction on this sheet wears");
  assert.equal(s.totals[0].amount, 27, "the lines above the Total add up to it");
});

test("an invoice for an old order shows the price it was SOLD at, not today's", () => {
  // The frozen line is the whole reason a rename or a price rise cannot rewrite history.
  const st = state();
  st.products[0].price = 99; // she has put the price up since
  const { g } = cart([{ productName: "Focaccia (old name)", unitPrice: 15 }], st);
  const s = journalSheet(invoiceSheet(st, g));
  assert.deepEqual(s.lines.map((l) => [l.what, l.amount]), [["2 × Focaccia (old name)", 30]]);
  assert.equal(s.totals[0].amount, 30);
});

test("an order placed with no price set reads as nothing rather than as a crash", () => {
  const st = state({ products: [] });
  const { g } = cart([{ productId: "gone", productName: "", unitPrice: "" }], st);
  assert.equal(invoiceLineAmount(st, g.orders[0]), 0);
  assert.equal(invoiceLineName(st, g.orders[0]), "2 × (deleted product)");
  assert.equal(journalSheet(invoiceSheet(st, g)).totals[0].amount, 0);
});

test("the invoice carries her letterhead, and the currency she bills in", () => {
  const st = state();
  const { g } = cart([{}], st);
  const s = journalSheet(invoiceSheet(st, g, {
    bakery: "Jien Luv 2 Bake", from: st.settings.mailingAddress,
  }));
  assert.equal(s.bakery, "Jien Luv 2 Bake");
  assert.equal(s.from, st.settings.mailingAddress);
  assert.equal(invoiceCurrency(st), "RM");
  assert.equal(invoiceCurrency({}), "RM", "and a state with no settings still bills in ringgit");
});

// ── the letterhead, and the name said once ───────────────────────────────────

test("her address block never says the bakery's name twice", () => {
  // The mailing-label card tells her to make the bakery's name the FIRST line of that
  // block, so a head drawn straight from it would repeat the name — and the sheet would
  // read as though the bakery were at two addresses.
  assert.deepEqual(
    fromLines("Jien Luv 2 Bake\n12, Jalan Bunga Raya\n11600 Pulau Pinang", "Jien Luv 2 Bake"),
    ["12, Jalan Bunga Raya", "11600 Pulau Pinang"]);
  // Case and stray spaces are not a difference.
  assert.deepEqual(fromLines("jien luv 2 bake \n12, Jalan Bunga Raya", "Jien Luv 2 Bake"),
    ["12, Jalan Bunga Raya"]);
  // A block that does NOT open with the name keeps every line — an address with no name
  // in it is still an address, and dropping a line she typed would be the worse fault.
  assert.deepEqual(fromLines("12, Jalan Bunga Raya\n11600 Pulau Pinang", "Jien Luv 2 Bake"),
    ["12, Jalan Bunga Raya", "11600 Pulau Pinang"]);
  // A one-line block that IS the name leaves nothing to draw, which is right: the name
  // is already above it in its own larger line.
  assert.deepEqual(fromLines("Jien Luv 2 Bake", "Jien Luv 2 Bake"), []);
  assert.deepEqual(fromLines("", "Jien Luv 2 Bake"), []);
  assert.deepEqual(fromLines("  \n \n", "Jien Luv 2 Bake"), [], "blank lines are not lines");
});

test("every other journal is unchanged by the letterhead", () => {
  // `from` is optional and every existing journal passes nothing, so the shared sheet
  // must draw exactly what it drew before.
  const s = journalSheet({ title: "Sales", bakery: "Jien Luv 2 Bake", lines: [{ what: "Focaccia", amount: 30 }] });
  assert.equal(s.from, "");
  assert.deepEqual(fromLines(s.from, s.bakery), []);
});
