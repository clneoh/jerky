// test/consolidated.test.js — the consolidated invoice (v372). Pure module, no DOM.
//
// Her words: __"i need a month consolidated invoice printing page, selectable individual, daily,
// monthly"__, and asked what one document should cover: __"per day, per week, per month, per customer
// as well"__.
//
// ⚠️⚠️ THE ASSERTION THAT MATTERS MOST IS THE COURIER ONE. Her takings (`orderNet`) deliberately leave
// the courier charge OUT — it is a pass-through to the courier and was never hers. An INVOICE includes
// it, because the customer was billed it. So a consolidated invoice built on the takings figure would
// disagree with the sum of her OWN individual invoices by every courier charge on the page — a document
// that contradicts the paperwork it is meant to summarise.

import { test } from "node:test";
import assert from "node:assert/strict";

const { consolidatedSheet, periodSpan, orderInvoice } =
  await import("../admin/js/consolidated.js");
const { invoiceSheet } = await import("../admin/js/invoice.js");
const { groupOrders, orderCode } = await import("../admin/js/state.js");
const { journalBodyEl, journalSheetEl, journalSheet: sheetOf } = await import("../admin/js/journal.js");

// Every figure a sheet draws, joined — so one assertion can say what ALL of them are.
const walk = (n, out = []) => { for (const c of (n && n.children) || []) { out.push(c); walk(c, out); } return out; };
const stripMoney = (node) => walk(node).filter((n) => String(n.className).includes("info-val"))
  .map((n) => n.textContent).join(" ").trim();

const D = (d) => `2026-10-${String(d).padStart(2, "0")}`; // October 2026

function state() {
  return {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 16 }, { id: "p2", name: "Sourdough", price: 18 }],
    deliveryDates: [],
    orders: [],
    credits: [], expenses: [], deposits: [], ingredients: [], categories: [],
  };
}
let n = 0;
const row = (extra = {}) => {
  n += 1;
  const id = extra.groupId || `ord${n}`;
  return {
    id, groupId: extra.groupId || id, status: "paid", paidReceived: true, paidMethod: "cash",
    productId: "p1", qty: 1, unitPrice: 16, deliveryDate: D(5), customerName: "Aunty Bee",
    whatsapp: "60111111111", ...extra,
  };
};

// ── the period itself ────────────────────────────────────────────────────────

test("★ the week is the SUNDAY one, and the sheet says which basis it counts on", () => {
  // ⚠️ THE APP HAS TWO WEEKS. `weekStartISO` is Sunday and names the window the Home tile shows
  // ("Week of Sun, 4 Oct"); `mondayAnchor` is Mon–Sun and drives the delivery runs. Using the wrong
  // one would make the word "week" mean two different things on two screens.
  const w = periodSpan("week", "2026-10-08"); // Thursday
  assert.equal(w.from, "2026-10-04", "the week did not start on the Sunday");
  assert.equal(w.to, "2026-10-10", "the week is not seven days");
  assert.match(w.label, /Week of/);

  const m = periodSpan("month", "2026-10-08");
  assert.equal(m.from, "2026-10-01");
  assert.equal(m.to, "2026-10-31");
  assert.equal(m.label, "October 2026");

  const d = periodSpan("day", "2026-10-08");
  assert.equal(d.from, w.from.length === 10 ? "2026-10-08" : d.from);
  assert.equal(d.to, "2026-10-08");

  // ⚠️ AND THE PAPER SAYS THE BASIS. The Home tile's own RM figure counts orders as PLACED, this
  // counts them as DELIVERED — both honest, and they will not match. The document states its own.
  const st = state();
  st.orders = [row({ deliveryDate: D(5) })];
  assert.match(consolidatedSheet(st, { kind: "month", anchor: D(8) }).subtitle, /by delivery date/);
});

// ── the document's own reference (v374) ──────────────────────────────────────

test("★★ the reference identifies the DOCUMENT and comes out the same every time", () => {
  // ⚠️⚠️ IT IS DERIVED, NOT COUNTED. Re-printing October's statement must carry the same reference — a
  // counter would turn one statement into two documents for the same money the second time she opened it.
  const st = state();
  st.orders = [row({ groupId: "g1", deliveryDate: D(5) })];
  const a = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const b = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(a.ref, b.ref, "opening the same document twice produced two references");
  assert.equal(a.ref, "CI-MONTH-2026-10");
  // And it is ON the document, in the line every copy carries.
  assert.match(a.subtitle, /^CI-MONTH-2026-10 · /, `the reference is not on the document: ${a.subtitle}`);
});

test("★★ a Sunday's DAY invoice never shares a number with that WEEK's", () => {
  // ⚠️ THE COLLISION THAT WOULD HAVE SHIPPED. `weekStartISO` is the Sunday, so a day document for 4 Oct
  // and the week document for the week starting 4 Oct both came out "CI-2026-10-04" — one day in seven,
  // two different documents under one number.
  const st = state();
  const day = consolidatedSheet(st, { kind: "day", anchor: "2026-10-04" });
  const week = consolidatedSheet(st, { kind: "week", anchor: "2026-10-04" });
  assert.notEqual(day.ref, week.ref, `a day and a week share the reference ${day.ref}`);
  assert.equal(day.ref, "CI-DAY-2026-10-04");
  assert.equal(week.ref, "CI-WEEK-2026-10-04");
});

test("★★ a customer-scoped document never shares a number with the whole month's", () => {
  // ⚠️ The other collision: a customer keyed by NAME has no phone number to put in the reference, so it
  // fell back to the month's all-customer one — two documents, one number.
  const st = state();
  st.orders = [row({ groupId: "g1", deliveryDate: D(5) })];
  const whole = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const named = consolidatedSheet(st, { kind: "month", anchor: D(8), customerKey: "60111111111" });
  assert.notEqual(named.ref, whole.ref, `a customer's invoice shares the month's reference ${named.ref}`);
  assert.match(named.ref, /^CI-MONTH-2026-10-/, `the customer is not in the reference: ${named.ref}`);
  // Stable for that person, and different for another.
  const other = consolidatedSheet(st, { kind: "month", anchor: D(8), customerKey: "60222222222" });
  assert.equal(consolidatedSheet(st, { kind: "month", anchor: D(8), customerKey: "60111111111" }).ref, named.ref);
  assert.notEqual(other.ref, named.ref, "two customers share a reference in the same month");
});

test("every scope names itself, so no two kinds of document can collide", () => {
  const st = state();
  const refs = ["all", "day", "week", "month"]
    .map((kind) => consolidatedSheet(st, { kind, anchor: D(5) }).ref);
  assert.deepEqual(refs, ["CI-ALL", "CI-DAY-2026-10-05", "CI-WEEK-2026-10-04", "CI-MONTH-2026-10"]);
  assert.equal(new Set(refs).size, refs.length, "two scopes produced the same reference");
});

// ── the money ────────────────────────────────────────────────────────────────

test("★★ the total EQUALS THE SUM OF THE INDIVIDUAL INVOICES — the courier charge is in both", () => {
  const st = state();
  st.orders = [
    // A courier order whose charge the CUSTOMER pays: billed RM16 + RM8.
    row({ groupId: "g1", deliveryDate: D(5), fulfillment: "courier", courierFee: 8, courierPaidBy: "customer" }),
    // A plain collect order.
    row({ groupId: "g2", deliveryDate: D(6), productId: "p2", unitPrice: 18, customerName: "Mei Ling" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const total = sheet.totals[0].amount;
  assert.equal(total, 42, `the month total is ${total} — the courier charge is missing from it`);

  // ⚠️ And the same orders through the app's OWN invoice renderer must add up to it.
  const each = groupOrders(st.orders)
    .reduce((s, g) => s + invoiceSheet(st, g, { bakery: "x" }).totals[0].amount, 0);
  assert.equal(total, Math.round(each * 100) / 100,
    "★ the consolidated total disagrees with the sum of the individual invoices");
});

test("★ a discounted order reads at what was charged, less the discount", () => {
  const st = state();
  st.orders = [row({ groupId: "g1", deliveryDate: D(5), qty: 2 })];
  // ⚠️ The coupon is matched to the order by the app's OWN code, not a guess at it.
  st.credits = [{ id: "c1", holder: "60111111111", amountRM: 3, role: "friendOff",
    earnedAt: "2026-10-01T00:00:00.000Z", expiresAt: "", usedAt: null,
    orderCode: orderCode(st.orders[0]) }];
  assert.equal(orderInvoice(st, { orders: st.orders }), 29, "RM32 less the RM3 coupon is RM29");
});

test("★ a part-refunded order shows its net; a fully refunded one is OFF the rows and SAID", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5), refundAmountRM: 5, refundedAt: "2026-10-06T00:00:00.000Z" }),
    row({ groupId: "g2", deliveryDate: D(6), customerName: "Mei Ling", productId: "p2",
      unitPrice: 18, refundedAt: "2026-10-07T00:00:00.000Z" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.totals[0].amount, 11, "RM16 less the RM5 given back is RM11");
  assert.equal(sheet.lines.filter((l) => !l.heading && !l.head && !l.cls).length, 1, "the refunded order is still listed");
  assert.match(sheet.note, /1 order was refunded in full/,
    `a fully refunded order left the page in silence: "${sheet.note}"`);
});

test("★ 'still to collect' is read off the SAME orders the rows show", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5) }),
    row({ groupId: "g2", deliveryDate: D(6), customerName: "Mei Ling", paidReceived: false, status: "confirmed" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.totals[0].amount, 32);
  assert.match(sheet.note, /Still to collect from these orders: RM 16\.00/,
    `the owed figure does not match the page: "${sheet.note}"`);
});

// ── the grouping ─────────────────────────────────────────────────────────────

test("★ one row per ORDER, never per item — a discount is a fact about the whole order", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5), id: "a" }),
    row({ groupId: "g1", deliveryDate: D(5), id: "b", productId: "p2", unitPrice: 18 }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const rows = sheet.lines.filter((l) => !l.heading && !l.head && !l.cls);
  assert.equal(rows.length, 1, `two item rows of ONE order became ${rows.length} lines`);
  assert.equal(sheet.totals[0].amount, 34);
});

test("★★ every row ADDS UP to the Total beneath it — the filing list has no subtotals to hide behind", () => {
  // ⚠️ THIS TEST USED TO CHECK THE PER-CUSTOMER SUBTOTALS. v376 replaced the grouping with one flat
  // filing list — her choice, shown both — so the invariant that survives is the one that always
  // mattered: **the rows add up to the figure under them.**
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5) }),
    row({ groupId: "g2", deliveryDate: D(6), customerName: "Mei Ling", whatsapp: "60222222222", productId: "p2", unitPrice: 18 }),
    row({ groupId: "g3", deliveryDate: D(7), productId: "p2", unitPrice: 18 }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const rows = sheet.lines.filter((l) => !l.head && !l.heading);
  const sum = rows.reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, sheet.totals[0].amount,
    "★ the rows do not add up to the total beneath them");
  assert.equal(sheet.lines.some((l) => l.heading), false, "a customer heading survived the flat list");
});

test("★★ the filing page leads with a HEADER row naming its columns, and carries no figure", () => {
  // ⚠️ UNLABELLED COLUMNS ARE NOT A FILING PAGE — she has to be able to see WHICH column is the invoice
  // number. And a header must never carry money: a zero in the amount column would read as a real row.
  const st = state();
  st.orders = [row({ groupId: "g1" }), row({ groupId: "g2", customerName: "Mei Ling", whatsapp: "60222222222" })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const head = sheet.lines.find((l) => l.head);
  assert.ok(head, "the filing list has no header row");
  assert.deepEqual(head.cols, ["Date", "Order", "Invoice", "What", "Customer"]);
  assert.equal(head.amount, undefined, "the header row came with money on it");
  // And every row under it carries the same FOUR columns, so the header names them all.
  for (const l of sheet.lines.filter((x) => !x.head)) {
    assert.equal(l.cols.length, head.cols.length, `a row has ${l.cols.length} columns under a ${head.cols.length}-column header`);
  }
});

test("★ a walk-in with no name and no number is NAMED, not left blank", () => {
  // ⚠️ THE GROUPING IS GONE (v376), so this is about the CUSTOMER COLUMN now: a nameless order must
  // still say something in it rather than leaving a gap where a person belongs.
  const st = state();
  st.orders = [
    row({ groupId: "g1", customerName: "", whatsapp: "" }),
    row({ groupId: "g2", customerName: "", whatsapp: "" }),
    row({ groupId: "g3", customerName: "Aunty Bee", whatsapp: "60111111111" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const rows = sheet.lines.filter((l) => !l.head);
  const blank = rows.filter((l) => !String(l.cols[4] || "").trim());
  assert.deepEqual(blank, [], "a row left the customer column empty where a person belongs");
  assert.equal(rows.filter((l) => l.cols[4] === "No name").length, 2, "the walk-ins are not named");
  assert.equal(rows.some((l) => l.cols[4] === "Aunty Bee"), true, "the named customer is missing");
});

test("one customer can be picked out of the period", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1" }),
    row({ groupId: "g2", customerName: "Mei Ling", whatsapp: "60222222222", productId: "p2", unitPrice: 18 }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8), customerKey: "60222222222" });
  assert.equal(sheet.totals[0].amount, 18, "the customer filter let somebody else's order through");
  assert.equal(sheet.lines.some((l) => l.heading), false,
    "one customer's own list is headed by their name — a heading over the only list says nothing");
});

// ── what is left out, and SAID ───────────────────────────────────────────────

test("★ an order with no delivery date is counted and SAID, never merely dropped", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5) }),
    row({ groupId: "g2", deliveryDate: "", deliveryDateId: "" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.totals[0].amount, 16, "the order with no day was counted anyway");
  assert.match(sheet.note, /1 order has no delivery date/,
    `the document is quietly short: "${sheet.note}"`);
});

test("★★ ALL means ALL — no window for an order to fall outside of", () => {
  // Her words: __"pls add a selection ALL, on top of A DAy, A week, a month"__.
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5) }),
    row({ groupId: "g2", deliveryDate: "2026-09-30", customerName: "Mei Ling", whatsapp: "60222222222" }),
    row({ groupId: "g3", deliveryDate: "2025-01-02", customerName: "Old order", whatsapp: "60333333333" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "all", anchor: D(8) });
  assert.equal(sheet.span.label, "Everything");
  assert.equal(sheet.totals[0].amount, 48,
    `"All" left something out — it holds ${sheet.totals[0].amount}, not RM48`);
  assert.equal(sheet.lines.filter((l) => !l.heading && !l.head && !l.cls).length, 3);
});

test("a period still excludes what is outside it — ALL does not weaken the other scopes", () => {
  // ⚠️ The range is SKIPPED for "all", never widened for everybody — otherwise the month would stop
  // being a month and every scope would quietly become "everything".
  const st = state();
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(5) }),
    row({ groupId: "g2", deliveryDate: "2026-09-30", customerName: "Mei Ling", whatsapp: "60222222222" }),
  ];
  assert.equal(consolidatedSheet(st, { kind: "month", anchor: D(8) }).totals[0].amount, 16);
  assert.equal(consolidatedSheet(st, { kind: "week", anchor: D(8) }).totals[0].amount, 16);
  assert.equal(consolidatedSheet(st, { kind: "all", anchor: D(8) }).totals[0].amount, 32);
});

test("with nothing sold at all, ALL says so without offering another period", () => {
  const st = state();
  const sheet = consolidatedSheet(st, { kind: "all", anchor: D(8) });
  assert.match(sheet.empty, /Nothing has been sold yet/);
  assert.equal(/another period/.test(sheet.empty), false,
    '"another period" is nonsense on the scope that is not a period');
});

test("an order outside the period is simply not in it, and is not complained about", () => {
  const st = state();
  st.orders = [row({ groupId: "g1", deliveryDate: D(5) }), row({ groupId: "g2", deliveryDate: "2026-09-30" })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.totals[0].amount, 16);
  assert.equal(/no delivery date/.test(sheet.note), false, "an order in September was reported as undated");
});

test("a period with nothing in it says so rather than drawing an empty page", () => {
  const st = state();
  st.orders = [row({ groupId: "g1", deliveryDate: "2026-09-30" })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.lines.length, 0);
  assert.deepEqual(sheet.totals, []);
  assert.match(sheet.empty, /Nothing was sold in this period/);
});

test("★ an order nothing can price is MARKED on its own line, not printed as a confident nothing", () => {
  // ⚠️ THIS TEST MOVED AND MOVED BACK. When the item column went (v376) the "no price" mark had nowhere
  // to live and moved into the note; when her own data showed her the page could not say WHAT an order
  // WAS — __"why no description?"__ — the column came back (v377) and **the mark went back with it**,
  // onto the line it belongs to, the way every other screen in the app does it.
  const st = state();
  st.products[0].price = "";
  st.orders = [row({ groupId: "g1", unitPrice: "" })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const line = sheet.lines.find((l) => !l.head);
  assert.match(line.cols[3], /no price/, `an unpriced loaf reads as a lie: "${line.cols[3]}"`);
  assert.match(line.what, /no price/, "and the line text — what the PDF and the message read — lost it too");
  assert.equal(sheet.totals[0].amount, 0, "the unpriced order was counted as money anyway");
});

// ── ★★ v376: THE FILING LIST ─────────────────────────────────────────────────
//
// Her words: __"can we have a column for order no. and a column for invoice no, sort it to inv will allow
// us to printout for filing purpose"__ — and shown two layouts, she picked the flat list over keeping the
// per-customer grouping.
//
// ⚠️⚠️ THE "INVOICE NUMBER" IS THE **RECEIPT SERIAL** THE APP ALREADY ISSUES (`#000001`…), not a new
// series. It is a real, unbroken, never-re-used sequence — which is what a filing folder is read against —
// and it needs no counter, no SQL and no rules guessed at. The order code sits beside it because that is
// what finds the order again.

test("★★ the filing list runs in INVOICE-NUMBER order, with the unnumbered at the END", () => {
  const st = state();
  // ⚠️⚠️ THE DATES RUN **OPPOSITE** TO THE SERIALS, DELIBERATELY. The first version of this test had them
  // ascending together, so sorting by date and sorting by invoice number gave the SAME list — and the bite
  // (sort by date again) did not disturb it at all. **A test whose data cannot tell the two answers apart
  // proves nothing about either.** And the unnumbered order carries the EARLIEST date, so a date sort would
  // put it first rather than last, which is the other half of what is being pinned.
  st.orders = [
    row({ groupId: "g1", deliveryDate: D(9), receiptNo: 1, customerName: "A" }),
    row({ groupId: "g9", deliveryDate: D(1), customerName: "Z" }),          // not paid yet — no serial
    row({ groupId: "g3", deliveryDate: D(7), receiptNo: 3, customerName: "C" }),
    row({ groupId: "g2", deliveryDate: D(8), receiptNo: 2, customerName: "B" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const rows = sheet.lines.filter((l) => !l.head);
  assert.deepEqual(rows.map((r) => r.cols[2]),
    ["#000001", "#000002", "#000003", "none yet"],
    "★ the filing list is not in invoice order, or an unnumbered order is sitting inside the run");
  // ⚠️ AND THE ENTRY GATE IS ON THE LINE, NOT SORTED BY ACCIDENT — the header is first.
  assert.ok(sheet.lines[0].head, "the header row is not at the top of the filing list");
});

test("★★ the two numbers are the ORDER's own code and its own receipt serial", () => {
  const st = state();
  st.orders = [row({ groupId: "g1", receiptNo: 7 })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  const r = sheet.lines.find((l) => !l.head);
  assert.equal(r.cols[1], `#${orderCode(st.orders[0])}`, "the Order column is not the order's own code");
  assert.equal(r.cols[2], "#000007", "the Invoice column is not the order's own receipt serial");
  // ⚠️ AND THE SAME FACTS ARE IN `what`, so the shared text and the PDF — which read `what` — say
  // everything the screen's columns say. One set of values, two arrangements.
  for (const cell of r.cols) assert.ok(r.what.includes(cell), `"${cell}" is missing from the line text`);
});

test("★ an unnumbered order still counts toward the Total, and is called out as owed", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g1", receiptNo: 1, paidReceived: true }),
    row({ groupId: "g2", customerName: "Mei Ling", whatsapp: "60222222222", paidReceived: false, status: "confirmed" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.equal(sheet.totals[0].amount, 32, "the unnumbered order was left out of the money");
  assert.match(sheet.note, /Still to collect from these orders: RM 16\.00/);
});

test("★★ a PAID order with no invoice number is SAID to be paid — the misreading her own data showed", () => {
  // ⚠️⚠️ HER OWN SCREEN SHOWED THIS: four rows reading "none yet" with only one of them still to
  // collect. **"none yet" says there is no NUMBER; it does not say the money is missing** — and three of
  // those four were paid, just never numbered, because they came before the receipts step existed.
  // A column that reads as "unpaid" while meaning "un-numbered" is the fault this app calls a bug.
  const st = state();
  st.orders = [
    row({ groupId: "g1", receiptNo: 1, paidReceived: true }),                  // numbered
    row({ groupId: "g2", customerName: "Mei Ling", whatsapp: "60222222222",
      paidReceived: true }),                                                   // PAID, un-numbered
    row({ groupId: "g3", customerName: "Uncle Tan", whatsapp: "60333333333",
      paidReceived: false, status: "confirmed" }),                             // not paid
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8) });
  assert.match(sheet.note, /1 of these has no invoice number yet but is already PAID/,
    `the page lets a paid order read as unpaid: "${sheet.note}"`);
  assert.match(sheet.note, /Still to collect from these orders: RM 16\.00/,
    "only the genuinely unpaid one should be owed");
});

// ── ★★ v378: THE NUMBERS THAT BELONG TO NO ORDER ─────────────────────────────
//
// Her question, reading her own printout: __"why inv 0001 dont show? it should showing the reason"__.
// The page listed 0002, 0003 … with no word about 0001, which reads as a document with a hole in it —
// and a gap in a receipt run is exactly what an auditor asks about.
//
// ⚠️⚠️ THE REASON IT WAS MISSING: this page is built from her ORDERS, and 0001's order was removed, so
// there was never a row to draw it from. **The numbers do not live on her orders; they live in the
// receipt register** — which is why the page now reads it.

const reg = (number, code, issued = "2026-10-06T04:00:00.000Z") =>
  ({ number, order_code: code, issued_at: issued, refunded_at: null });

test("★★ a number whose order is GONE gets its own line, in its own place in the run", () => {
  const st = state();
  st.orders = [
    row({ groupId: "g052a1b", deliveryDate: D(5), receiptNo: 2, customerName: "Aunty Bee" }),
    row({ groupId: "gF4470C", deliveryDate: D(7), receiptNo: 3, customerName: "Mei Ling" }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8),
    register: [reg(1, "AAAA01"), reg(2, "052A1B"), reg(3, "F4470C")] });

  const rows = sheet.lines.filter((l) => !l.head);
  assert.equal(rows.length, 3, `a void number is still missing from the page: ${rows.length} rows`);
  // ⚠️ AND IT SORTS INTO THE RUN BY ITS NUMBER — first, because 0001 is first.
  assert.deepEqual(rows.map((r) => r.cols[2]), ["#000001", "#000002", "#000003"]);
  assert.match(rows[0].cols[3], /order removed/, `the void line does not say why: "${rows[0].cols[3]}"`);
  // ⚠️⚠️ AND IT CARRIES NO AMOUNT AT ALL. The money for it never existed, and "RM 0.00" beside it would
  // put a figure in a filed document that nobody ever paid.
  assert.equal(rows[0].amount, null, "a void number was given a figure");
  // ⚠️ THE INVARIANT, NOT A NUMBER I WORKED OUT BY HAND — my first two attempts at this both got the
  // arithmetic wrong, which is a good sign it should not be in the test at all. **The Total is the sum of
  // the SALES on the page, and the void number adds nothing to it.**
  const sales = rows.filter((r) => !/journal-void/.test(r.cls || ""));
  const sum = sales.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  assert.equal(sheet.totals[0].amount, Math.round(sum * 100) / 100,
    `the void number was added into the total (sales sum ${sum}, total ${sheet.totals[0].amount})`);
  assert.match(sheet.note, /1 number on this page belongs to an order that has since been removed/);
});

test("★ a number whose order still exists is NOT called void — even outside this period", () => {
  // ⚠️ "REMOVED" IS JUDGED AGAINST **EVERY** ORDER SHE HAS. An order that merely falls outside the
  // window she is looking at is elsewhere, not gone — and calling it removed would put a false statement
  // on a filed page.
  // ⚠️⚠️ THE ORDER IS DELIVERED IN SEPTEMBER BUT ITS NUMBER WAS ISSUED IN OCTOBER — which is the ordinary
  // case, and it is the ONLY data that can tell the two answers apart. The first version of this test had
  // the old order's receipt issued in AUGUST too, so the period filter hid it either way and the bite
  // (judge against this period's orders instead of all of them) did not disturb it at all.
  // **A test whose data cannot separate the right answer from the wrong one proves nothing about either.**
  const st = state();
  // ⚠️⚠️ THE CODES COME FROM `orderCode` ITSELF, NEVER BY HAND. An order code is the last six HEX
  // characters of the group id, so "gOLDMAN" is really **"DA"** — and a hand-written "OLDMAN" in the
  // register matches nothing, which made this test fail for a reason that had nothing to do with what it
  // is testing. **The app's own function is the only honest source of the app's own identifiers.**
  const oct = row({ groupId: "g052a1b", deliveryDate: D(5), receiptNo: 2 });
  const sept = row({ groupId: "gOLDMAN", deliveryDate: "2026-09-30", receiptNo: 1 });
  st.orders = [oct, sept];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8),
    register: [reg(1, orderCode(sept), "2026-10-02T04:00:00.000Z"), reg(2, orderCode(oct))] });
  const rows = sheet.lines.filter((l) => !l.head);
  assert.equal(rows.length, 1, "an order from another month was drawn on this page");
  assert.equal(rows.some((r) => /journal-void/.test(r.cls || "")), false,
    "an order that still exists was called removed");
  assert.equal(/removed/.test(sheet.note), false, "the note invented a removed order");
});

test("★ a void number is held to the PERIOD it was issued in", () => {
  const st = state();
  st.orders = [row({ groupId: "g052a1b", deliveryDate: D(5), receiptNo: 9 })];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8),
    register: [reg(1, "GONE01", "2026-09-30T04:00:00.000Z"), reg(9, "052A1B", D(5) + "T04:00:00.000Z")] });
  const rows = sheet.lines.filter((l) => !l.head);
  assert.equal(rows.some((r) => /journal-void/.test(r.cls || "")), false,
    "a September void was drawn on October's page");
  // And "Everything" does hold it.
  const all = consolidatedSheet(st, { kind: "all", anchor: D(8),
    register: [reg(1, "GONE01", "2026-09-30T04:00:00.000Z"), reg(9, "052A1B", D(5) + "T04:00:00.000Z")] });
  assert.equal(all.lines.filter((l) => !l.head).some((r) => /journal-void/.test(r.cls || "")), true,
    "All left the void out");
});

test("★★ a register that could NOT be read is SAID, not drawn as a register with nothing in it", () => {
  // ⚠️ THE RULE THE RECEIPT REGISTER SCREEN ALREADY FOLLOWS (v366): a filing page that is quietly short is
  // worse than one that admits it could not check. `null` means NOT READ — an empty array would claim
  // there are no void numbers, which is a different statement entirely.
  const st = state();
  st.orders = [row({ groupId: "g052a1b", deliveryDate: D(5), receiptNo: 2 })];
  const notRead = consolidatedSheet(st, { kind: "month", anchor: D(8), register: null });
  assert.match(notRead.note, /receipt register could not be read/,
    `an unread register left the page silently short: "${notRead.note}"`);
  // And with the register READ but holding nothing extra, nothing is claimed.
  const readEmpty = consolidatedSheet(st, { kind: "month", anchor: D(8), register: [reg(2, "052A1B")] });
  assert.equal(/could not be read/.test(readEmpty.note), false, "a register that WAS read was called unread");
  assert.equal(/removed/.test(readEmpty.note), false, "a clean run invented a removed order");
});

// ── ★★ v379: PRESS A COLUMN TITLE AND THE PAGE SORTS BY IT ───────────────────
//
// Her words: __"can you allow me to sort the column by its title"__.
//
// ⚠️⚠️ **INVOICE ORDER IS THE DEFAULT AND THE POINT OF THE PAGE** — it is a filing document, read against
// the serial — so sorting is something she CHOOSES, never something the page does on its own.

// Four orders chosen so that EVERY column gives a DIFFERENT order from the others. ⚠️ With data where two
// columns happen to agree, a test cannot tell the sort from the default — which is the mistake that made
// two earlier tests of mine prove nothing.
const sortable = () => {
  const st = state();
  // ⚠️⚠️ A SEPARATE PHONE NUMBER FOR EACH — the base `row()` gives every order the SAME one, so `keyOf`
  // made all four ONE customer and the customer column read identically on every line. **The sort then
  // could not be told from the default, and this test failed for a reason that had nothing to do with
  // sorting.** (The third time this session that test DATA, not logic, was the fault.)
  const mk = (gid, date, name, phone, receipt) => row({
    groupId: gid, deliveryDate: date, customerName: name, whatsapp: phone, receiptNo: receipt,
  });
  st.orders = [
    mk("gC1", D(20), "Zoe", "60111111111", 3),
    mk("gA1", D(5), "Bob", "60222222222", 1),
    mk("gD1", D(9), "Ann", "60333333333", 4),
    mk("gB1", D(7), "Yusof", "60444444444", 2),
  ];
  return st;
};
const codes = (sheet) => sheet.lines.filter((l) => !l.head).map((r) => r.cols[1]);
const customers = (sheet) => sheet.lines.filter((l) => !l.head).map((r) => r.cols[4]);

test("★★ every column can be sorted by, and each gives a DIFFERENT order", () => {
  const st = sortable();
  const at = (by, dir = "asc") => consolidatedSheet(st, { kind: "month", anchor: D(8), sort: { by, dir } });

  // ⚠️ AND THE DEFAULT IS STILL THE INVOICE RUN — the filing order.
  assert.deepEqual(codes(at("invoice")), ["#A1", "#B1", "#C1", "#D1"],
    "the page no longer opens in invoice order, which is what it is FOR");
  assert.deepEqual(codes(at("date")), ["#A1", "#B1", "#D1", "#C1"], "sorting by date did nothing");
  assert.deepEqual(codes(at("order")), ["#A1", "#B1", "#C1", "#D1"]);
  assert.deepEqual(customers(at("customer")), ["Ann", "Bob", "Yusof", "Zoe"], "sorting by customer did nothing");
});

test("★★ pressing the same title again turns it round", () => {
  const st = sortable();
  const up = consolidatedSheet(st, { kind: "month", anchor: D(8), sort: { by: "customer", dir: "asc" } });
  const down = consolidatedSheet(st, { kind: "month", anchor: D(8), sort: { by: "customer", dir: "desc" } });
  assert.deepEqual(customers(up), ["Ann", "Bob", "Yusof", "Zoe"]);
  assert.deepEqual(customers(down), ["Zoe", "Yusof", "Bob", "Ann"], "a second press did not turn it round");
  // And the money follows the rows rather than staying behind.
  const sum = (sheet) => sheet.lines.filter((l) => !l.head).reduce((t, r) => t + (Number(r.amount) || 0), 0);
  assert.equal(sum(up), sum(down), "the total changed when the order changed");
});

test("★ two rows that tie under a column still read in invoice order underneath", () => {
  // ⚠️ WITHOUT A TIE-BREAK they would shuffle between two draws, and a page that reorders itself when
  // nothing changed reads as a bug.
  const st = state();
  st.orders = [
    row({ groupId: "gC1", deliveryDate: D(6), customerName: "Ann", receiptNo: 3 }),
    row({ groupId: "gA1", deliveryDate: D(6), customerName: "Ann", receiptNo: 1 }),
    row({ groupId: "gB1", deliveryDate: D(6), customerName: "Ann", receiptNo: 2 }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8), sort: { by: "date", dir: "asc" } });
  assert.deepEqual(codes(sheet), ["#A1", "#B1", "#C1"],
    "three rows sharing a date did not fall back to the invoice run");
});

test("★ an un-numbered order stays LAST when sorting by the invoice column", () => {
  const st = state();
  st.orders = [
    row({ groupId: "gB1", deliveryDate: D(6), receiptNo: 2 }),
    row({ groupId: "gA1", deliveryDate: D(4), customerName: "No Number Here" }),
    row({ groupId: "gC1", deliveryDate: D(7), receiptNo: 3 }),
  ];
  const sheet = consolidatedSheet(st, { kind: "month", anchor: D(8), sort: { by: "invoice", dir: "asc" } });
  assert.deepEqual(sheet.lines.filter((l) => !l.head).map((r) => r.cols[2]),
    ["#000002", "#000003", "none yet"], "an un-numbered order was sorted into the numbered run");
});
