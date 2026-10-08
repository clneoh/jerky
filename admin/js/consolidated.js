// consolidated.js — ONE document over a period (v372). Pure: no DOM, no storage.
//
// Her words: __"i need a month consolidated invoice printing page, selectable individual, daily,
// monthly"__ — and asked what one document should cover: __"per day, per week, per month, per
// customer as well"__.
//
// ★ AND IT IS AN **INVOICE**, WHICH IS NOT THE SAME NUMBER AS HER TAKINGS. `orderNet` — what the Money
// screen and Profit count — deliberately LEAVES OUT the courier charge, because that money is passed
// to the courier and was never hers. An invoice includes it, because the customer was billed it. So a
// document built on the takings figure would disagree with the sum of her OWN individual invoices by
// every courier charge on the page. **⟹ The money here is `customerTotal().total`, less anything given
// back** — the invoice's own figure, which is what `invoiceSheet` totals too.
//
// ⚠️ AND IT IS READ FROM `groupOrders`, NEVER FROM ROWS. A discount and a refund are facts about the
// WHOLE order, stamped on every one of its rows so a row read alone knows them — so anything that sums
// rows counts them once per item. That is the v370 trap, and it is why every loop below walks groups.

import { groupOrders, orderCode, orderLineName, orderLinePrice, round2, waNumber } from "./state.js";
import { addDays, longDate } from "./dates.js";
import { customerTotal } from "./courier.js";
import { isCollected, isRefunded, refundOf } from "./money.js";
import { orderDay, monthSpan } from "./profit.js";
import { weekStartISO } from "./weekly.js";
import { customerList, keyOf } from "./customers.js";
import { receiptNoOf } from "./receipts.js";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ⚠️ EVERY PERIOD IS COUNTED BY THE BAKE DAY — the day the order is FOR. That is what an invoice is
// about (what she supplied), and it is the same basis Profit's month uses, so the two agree.
//
// ⚠️⚠️ THE WEEK IS THE SUNDAY ONE, AND THAT MATTERS. The app has TWO weeks: `weekStartISO` (Sunday —
// the window the Home tile names, "Week of Sun, 4 Oct") and `mondayAnchor` (Mon–Sun, which drives the
// delivery runs). Using the wrong one would make "week" mean two things on two screens.
export function periodSpan(kind, anchor) {
  const day = String(anchor || "").slice(0, 10);
  // ★ ALL OF IT (v373). Her words: __"pls add a selection ALL, on top of A DAy, A week, a month"__.
  // ⚠️ An empty `from`/`to` is not "a period from nothing to nothing" — `consolidatedSheet` reads
  // `kind === "all"` and skips the range test entirely. Giving it a SENTINEL range instead would
  // have been a second rule about what a date is, and the day the sentinel was wrong the document
  // would have gone quietly short.
  if (kind === "all") return { from: "", to: "", label: "Everything" };
  if (kind === "week") {
    const from = weekStartISO(day);
    const to = addDays(from, 6);
    return { from, to, label: `Week of ${longDate(from)} – ${longDate(to)}` };
  }
  if (kind === "month") {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(5, 7)) - 1;
    const { from, to } = monthSpan(y, m);
    return { from, to, label: `${MONTHS[m]} ${y}` };
  }
  return { from: day, to: day, label: longDate(day) };
}

// ★★ THE DOCUMENT'S OWN REFERENCE (v374). Until this, the consolidated invoice carried NO number at all —
// every other thing she hands out has one (an order has a code, a receipt has a serial).
//
// ⚠️⚠️ IT IS DERIVED FROM THE SCOPE, NOT COUNTED, AND THAT IS THE WHOLE DESIGN. **Re-printing October's
// statement must carry the same reference.** A counter would make one statement into two different
// documents for the same money the second time she opened it — which is precisely what a numbered series
// exists to prevent.
//
// ⚠️ AND THE SCOPE IS NAMED IN IT, because two real collisions were found before it shipped:
//   • `weekStartISO` is the SUNDAY, so a DAY invoice for that Sunday and the WEEK invoice for that week
//     both came out "CI-2026-10-04" — the same number for two different documents, one day in seven.
//   • a customer keyed by NAME (no number) fell back to the month's all-customer reference.
// Naming the scope fixes the first; the second is fixed by every customer-scoped document carrying a
// suffix, so it can never equal a whole-scope one.
export function invoiceRef(kind, span, customerKey = "") {
  const scope = { all: "ALL", day: "DAY", week: "WEEK", month: "MONTH" }[kind] || "ALL";
  const period = kind === "all" ? "" : kind === "month" ? String(span.from).slice(0, 7) : String(span.from);
  const who = customerKey ? `-${refSuffix(customerKey)}` : "";
  return ["CI", scope, period].filter(Boolean).join("-") + who;
}

// A short, stable, non-secret tag for one person — the same key always gives the same six characters, so
// the reference is reproducible without putting a phone number on the document.
function refSuffix(key) {
  let h = 0;
  const s = String(key || "");
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(-6).padStart(6, "0");
}

// The line under an order: what was in it, named as the order FROZE it, so a product she has since
// renamed or deleted still reads as what was actually sold.
function itemsLine(state, group) {
  return (group.orders || []).map((o) => {
    const qty = Number(o.qty) || 0;
    const name = orderLineName(state, o);
    // ⚠️ NOT "× 0" AND NOT A SILENT ZERO. A line nothing can price says so, the way Profit's own
    // journal does — a confident RM 0.00 beside a loaf is a figure that lies quietly.
    const priced = orderLinePrice(state, o) != null;
    return `${name}${qty > 1 ? ` ×${qty}` : ""}${priced ? "" : " (no price)"}`;
  }).join(", ");
}

// What one order is on this document: the invoice's own figure, less what went back.
export function orderInvoice(state, group) {
  return round2(Math.max(0, customerTotal(state, group).total - refundOf(state, group)));
}

// The whole document, as the object `journalSheet` wants.
//
// `kind` is "day" | "week" | "month"; `anchor` is any ISO date inside the period you want; and
// `customerKey` is a `keyOf` value to keep to ONE customer, or "" for everybody.
export function consolidatedSheet(state, { kind = "month", anchor = "", customerKey = "", register = null, sort = null } = {}) {
  const cur = (state.settings && state.settings.currency) || "RM";
  const span = periodSpan(kind, anchor);
  const byKey = new Map(customerList(state).map((r) => [r._key, r]));

  const mine = [];
  for (const g of groupOrders(state.orders || [])) {
    const first = (g.orders || [])[0];
    if (!first) continue;
    if (customerKey && keyOf(first) !== customerKey) continue;
    mine.push(g);
  }

  let noDay = 0;
  let refundedOut = 0;
  const keep = [];
  for (const g of mine) {
    const first = (g.orders || [])[0];
    // ⚠️ AN ORDER WITH NO BAKE DAY IS COUNTED AND SAID, never merely dropped. It resolves to "" and
    // would otherwise leave the page in silence — a document that is quietly short is worse than one
    // that says what it left out.
    const day = orderDay(state, first);
    if (!day) { noDay += 1; continue; }
    // ⚠️ "Everything" has no window to fall outside of — the range is skipped rather than widened,
    // so an order can never be left out of the one scope that means ALL of it.
    if (kind !== "all" && (day < span.from || day > span.to)) continue;
    // A sale refunded IN FULL is off the invoice entirely; it is counted below and said in the note.
    //
    // ⚠️⚠️ AND **ONLY A REFUND** EARNS THAT SKIP — never a zero. An order whose product carries no
    // price is worth nothing to add up, but it is still an order she supplied, and it must stay on the
    // page MARKED "no price" rather than vanishing from it. This is the same trap that cost a
    // regression in v370 (`refundedInFull`, money.js), and it was caught here by a test that asked
    // for the marking rather than for the total.
    if (orderInvoice(state, g) <= 0 && isRefunded(g)) { refundedOut += 1; continue; }
    keep.push(g);
  }

  // Bucketed by the person on the order. ⚠️ A WALK-IN WITH NO NAME AND NO NUMBER KEYS TO ITS OWN
  // ORDER ID (`keyOf`), so grouping by that key alone would give every nameless order a heading of
  // its own — a page of one-line "customers". They share ONE bucket instead.
  // ★★ ONE FLAT LIST, IN INVOICE-NUMBER ORDER (v376). Her words: __"can we have a column for order no.
  // and a column for invoice no, sort it to inv will allow us to printout for filing purpose"__ — and
  // asked how the page should be laid out for filing she chose the flat list over keeping the
  // per-customer grouping.
  //
  // ⚠️ SO THE GROUPING AND ITS SUBTOTALS ARE GONE, and that is what she picked when shown both. The
  // per-customer statement is still one press away — the WHOSE ORDERS box narrows the page to one person
  // and the Total at the foot becomes theirs — so nothing was lost that the filter cannot do.
  //
  // ⚠️⚠️ THE INVOICE NUMBER IS THE **RECEIPT SERIAL** the app already issues when money is recorded
  // (`#000001`…), NOT a new series. It is a real, unbroken, never-re-used sequence, which is exactly what
  // a filing folder is read against — and it needs no counter of its own, no SQL, and no rules guessed at.
  // The ORDER code stays beside it because it is what finds the order again.
  //
  // ⚠️ AN ORDER NOT YET RECORDED AS PAID HAS NO SERIAL — a receipt is for money received — so the page
  // keeps it, says "no invoice yet" in the column, and **sorts it to the END** where it cannot be mistaken
  // for part of the numbered run.
  const filing = keep.map((g) => {
    const first = (g.orders || [])[0];
    const row = byKey.get(keyOf(first));
    const name = row && row.name && row.name !== "(no name)" ? row.name : "";
    // ⚠️ THE SAME LABEL RULE THE CUSTOMER BOOK USES, including the one the grouping needed: a walk-in
    // with no name and no number has no person to name, and says so once rather than being blank.
    const customer = name || waNumber(first.whatsapp) || "No name";
    return {
      date: orderDay(state, first),
      code: orderCode(first),
      // ⚠️ "none yet" AND NOT A LONGER SENTENCE. The Invoice column is sized for a SERIAL, because that
      // is what it holds every other day of the week; a long phrase in the one row that has none would
      // either widen the column for every row or be cut off mid-word.
      invoice: receiptNoOf(first) ? `#${receiptNoOf(first)}` : "",
      customer,
      // ★ WHAT WAS ORDERED, BACK ON THE PAGE (v377). Her words, looking at her own data: __"why no
      // description?"__ — and she is right. A filing list that cannot tell her what an order WAS is a list
      // of numbers; the item names are how she recognises the order she is about to file against.
      //
      // ⚠️ AND IT IS THE ONE PLACE AN UNPRICED LINE CAN SAY SO. With this column absent the page could only
      // warn in the note; with it back, the mark travels with the line it belongs to, as it does on every
      // other screen. `itemsLine` is the same helper it always was.
      items: itemsLine(state, g),
      amount: orderInvoice(state, g),
      // ⚠️ OWED IS STILL "NOT COLLECTED", NOT "HAS NO INVOICE NUMBER". They are usually the same, but a
      // PAID order can be unnumbered — the receipts step not yet run, or the phone offline — and reading
      // that as owed would invent money a customer does not owe.
      owed: !isCollected(g),
      // ★ WHETHER IT IS UNNUMBERED **AND ALREADY PAID** — the two are different facts and the page has to
      // be able to tell them apart. Her own screen showed it: four rows reading "none yet" with only one
      // of them still to collect. **"none yet" says there is no NUMBER; it does not say the money is
      // missing**, and a column that reads as the second while meaning the first is the fault this app
      // calls a bug everywhere else.
      unnumberedPaid: !receiptNoOf(first) && isCollected(g),
    };
  });
  // ★★ AND THE NUMBERS THAT BELONG TO NO ORDER SHE STILL HAS (v378). Her question, reading the printout:
  // __"why inv 0001 dont show? it should showing the reason"__ — and she is right. The page listed
  // 0002, 0003 … with no word about 0001, which reads as a document with a hole in it; **a gap in a receipt
  // run is exactly what an auditor asks about.**
  //
  // ⚠️⚠️ THE REASON IT WAS MISSING: this page is built from her ORDERS, and 0001's order was removed — so
  // there was never a row to draw it from. **The numbers do not live on her orders; they live in the
  // receipt register**, which is why this now reads it.
  //
  // ⚠️ "REMOVED" IS JUDGED AGAINST **EVERY** ORDER SHE HAS, not against this period's — a number whose
  // order exists but simply falls outside the window she is looking at is NOT void, it is elsewhere.
  //
  // ⚠️ AND A VOID LINE CARRIES NO AMOUNT AT ALL — not zero. The money for it never existed, and printing
  // "RM 0.00" beside it would put a figure in a filed document that nobody ever paid.
  const have = new Set((state.orders || []).map((o) => orderCode(o)));
  const through = (iso) => localDay(iso);
  if (Array.isArray(register)) {
    for (const r of register) {
      const code = String((r && r.order_code) || "").trim().toUpperCase();
      const no = receiptNoOf({ receiptNo: r && r.number });
      if (!code || !no || have.has(code)) continue;
      const day = through(r.issued_at);
      if (kind !== "all" && (day < span.from || day > span.to)) continue;
      filing.push({
        date: day, code, invoice: `#${no}`, customer: "—", items: "order removed",
        amount: null, owed: false, unnumberedPaid: false, void: true,
      });
    }
  }

  // ★★ AND THE PAGE CAN BE SORTED BY ANY OF ITS COLUMNS (v379). Her words: __"can you allow me to sort
  // the column by its title"__ — press a column heading and the page sorts by it; press it again and it
  // turns round.
  //
  // ⚠️⚠️ **INVOICE ORDER STAYS THE DEFAULT, AND THAT IS THE POINT OF THE PAGE.** This is a filing
  // document: the run is read against the serial, and a page that opened in some other order would have
  // to be re-sorted before it could be filed. Sorting is something she CHOOSES.
  //
  // ⚠️ AND A TIE FALLS BACK TO INVOICE ORDER, so two rows sharing a customer or a date still read in
  // filing order underneath whatever she picked — and never shuffle between two draws.
  const { by = "invoice", dir = "asc" } = sort || {};
  const filingOrder = (a, z) => {
    if (a.invoice && z.invoice) return a.invoice.localeCompare(z.invoice);
    if (a.invoice !== z.invoice) return a.invoice ? -1 : 1;
    return String(a.date).localeCompare(String(z.date));
  };
  // ⚠️ `sortKey`, NOT `keyOf` — that name is already the CUSTOMER key imported from customers.js, and
  // shadowing it here broke every caller above that uses it (a TDZ error at the top of this function).
  const sortKey = {
    // A HIGH CHARACTER, so an order with NO number sorts last under its own name too — the same place
    // the default puts it.
    invoice: (r) => r.invoice || "￿",
    date: (r) => String(r.date || ""),
    order: (r) => String(r.code || ""),
    what: (r) => String(r.items || ""),
    customer: (r) => String(r.customer || ""),
  }[by];
  filing.sort((a, z) => {
    if (!sortKey) return filingOrder(a, z);
    const c = sortKey(a).localeCompare(sortKey(z));
    return (dir === "desc" ? -c : c) || filingOrder(a, z);
  });

  const lines = [];
  let total = 0;
  let owed = 0;
  let unnumberedPaid = 0;
  if (filing.length) {
    lines.push({ head: true, cols: ["Date", "Order", "Invoice", "What", "Customer"], what: "Date · Order · Invoice · What · Customer" });
  }
  for (const r of filing) {
    total = round2(total + r.amount);
    if (r.owed) owed = round2(owed + r.amount);
    if (r.unnumberedPaid) unnumberedPaid += 1;
    lines.push({
      // ⚠️ `cols` IS THE LAYOUT AND `what` IS THE SAME FACTS IN A LINE — so the shared text and the PDF,
      // which read `what`, say everything the screen's columns say. One set of values, two arrangements.
      cls: r.void ? "journal-void" : "",
      cols: [shortDay(r.date), `#${r.code}`, r.invoice || "none yet", r.items, r.customer],
      what: [shortDay(r.date), `#${r.code}`, r.invoice || "none yet", r.items, r.customer].join(" · "),
      amount: r.amount,
    });
  }

  const said = [];
  if (!keep.length) {
    said.push(customerKey
      ? `This customer has nothing${kind === "all" ? " yet" : " in this period"}.`
      : kind === "all" ? "Nothing has been sold yet." : "Nothing was sold in this period.");
  } else {
    said.push(`Every order is listed on the day it is FOR — the bake day. In invoice-number order.`);
    if (owed > 0) said.push(`Still to collect from these orders: ${cur} ${owed.toFixed(2)}.`);
    else said.push("Every order in this period has been paid.");
    // ★★ "none yet" IS ABOUT THE NUMBER, NOT ABOUT THE MONEY — and the page has to say so, or a paid
    // order with no serial reads as an unpaid one. **Her own screen showed four "none yet" rows with only
    // one of them still to collect**, which is exactly how that misreading starts.
    const voids = filing.filter((r) => r.void).length;
    if (voids) {
      said.push(`${voids} number${voids === 1 ? " on this page belongs" : "s on this page belong"} to an order that has since been removed — the number was issued when the money was recorded and is never given back, so it stays spent. More → Money → Receipt register shows every number ever issued.`);
    }
    // ⚠️ AND WHEN THE REGISTER COULD NOT BE READ, THE PAGE SAYS SO. It cannot know whether a number
    // is missing without asking, and a filing page that is quietly short is worse than one that
    // admits it could not check — the same rule the Receipt register screen follows (v366).
    if (register === null) {
      said.push("The receipt register could not be read, so any number belonging to an order that has been removed is NOT shown here. Open this page again with the internet on.");
    }
    if (unnumberedPaid) {
      said.push(`${unnumberedPaid} of these ${unnumberedPaid === 1 ? "has" : "have"} no invoice number yet but ${unnumberedPaid === 1 ? "is" : "are"} already PAID — they came before the numbering started. Open each order's Invoice and it takes the next number.`);
    }
  }
  if (refundedOut) {
    said.push(`${refundedOut} order${refundedOut === 1 ? " was" : "s were"} refunded in full and ${refundedOut === 1 ? "is" : "are"} not listed above.`);
  }
  if (noDay) {
    // ⚠️ WORDED FOR EVERY SCOPE, "Everything" INCLUDED. "cannot belong to any period" read oddly on
    // the one scope that is not a period at all.
    said.push(`${noDay} order${noDay === 1 ? " has" : "s have"} no bake day on ${noDay === 1 ? "it" : "them"} and ${noDay === 1 ? "is" : "are"} not listed — give ${noDay === 1 ? "it" : "them"} a day and ${noDay === 1 ? "it" : "they"} will appear here.`);
  }

  // The document's own number, worked out once so the field and the subtitle cannot disagree.
  const ref = invoiceRef(kind, span, customerKey);

  return {
    // The window itself, so the screen's stepper and its heading are the SAME answer as the
    // document's own subtitle rather than a second call that could be given different inputs.
    span,
    // ⚠️ THE REFERENCE LEADS THE SUBTITLE, which is the one line drawn on the screen, on the paper, in
    // the shared text AND in the PDF — so the document number is on every copy of it or on none.
    ref,
    title: "Consolidated invoice",
    subtitle: [
      ref,
      kind === "all" ? "" : span.label,
      customerKey ? byKey.get(customerKey)?.name || "One customer" : "all customers",
      "by bake day",
    ].filter(Boolean).join(" · "),
    lines,
    totals: keep.length
      ? [{ label: `Total — ${span.label}`, amount: total }]
      : [],
    // ⚠️ "Pick another period" is nonsense on the scope that is not a period — and this is the one
    // sentence a screen with nothing on it has to say for itself.
    empty: customerKey
      ? `This customer has nothing${kind === "all" ? " yet" : " in this period"}.`
      : kind === "all"
        ? "Nothing has been sold yet."
        : "Nothing was sold in this period. Pick another period.",
    note: said.join(" "),
  };
}

// ⚠️ THE DAY ON **HER** CLOCK, not the one the server wrote. `issued_at` is a UTC instant, so slicing
// its first ten characters would put a number issued at 2am in Penang onto the PREVIOUS day — and
// for a period boundary that is the difference between the number being in this month's filing or
// not. `paidOf` in money.js makes the same conversion for the same reason.
const localDay = (iso) => {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// "2 Oct" — a document wants the day, not the year, because the period names it.
const shortDay = (iso) => longDate(String(iso || "").slice(0, 10)).replace(/,? \d{4}$/, "");
