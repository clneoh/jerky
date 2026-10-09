// money.js — what came in, and how it came in (16 Sep 2026). Pure and shared: the
// Orders day header and the Money screen are one computation, so the line she reads
// on a day and the screen she reconciles against can never disagree.
//
// Two things are counted, and they are counted by different days on purpose:
//   • money COLLECTED is counted by the day it landed (paidAt). That is what a
//     reconciliation is about: an order delivered on the 18th but paid by transfer
//     on the 16th belongs to the 16th. Money paid before that stamp existed falls
//     back to its delivery date, which is the day it was handed over.
//   • money STILL TO COLLECT is counted by DELIVERY date — it is money owed for the
//     orders she is about to hand over, whatever the calendar says today.
// The one exception to "money in = the items" is the line below: money still to COLLECT
// is counted at what the customer will actually hand over, the customer's delivery charge
// included. That charge IS money you will be handed, so leaving it out made the row
// promise less than the customer's own message asks for. A COD charge is different and
// stays out: the courier takes that money at the door, so it is never yours to collect at
// all. Meanwhile the money that HAS come in stays at the items — a charge the customer
// bears and you pass straight to the courier is not your takings — which is why
// customerTotal() rather than groupValue() is read here and nowhere else in this file.
//
// What "still to collect" counts was settled on 19 Sep 2026: the customer's total, the
// charge included — "it should reflex rm72", where RM64 was the bread and RM8 the
// courier (v129). A charge the customer bears and pays with the order IS money she
// will be handed, so leaving it out made the row promise less than the customer's own
// message asks for. A COD charge is different and stays out: the courier takes that
// money at the door, so it is never hers to collect at all. Meanwhile the money that
// HAS come in stays at the items — that pass-through charge is not her takings — which
// is why customerTotal() rather than groupValue() is read here and nowhere else.
import { fmtRM, groupOrders, orderCode, orderLinePrice, round2 } from "./state.js";
import { classOfCategory, isCash, isOther, isTng, methodLabel, methodRank } from "./accounts.js";
import { customerTotal } from "./courier.js";

// The stages in order, so "is this past Paid?" can be asked here without importing
// the Orders screen (which imports this one). The list has not changed since the app
// had a journey map.
const STAGES = ["new", "confirmed", "paid", "baking", "ready", "delivered"];
const PAID_STAGE = STAGES.indexOf("paid");

const firstOf = (g) => ((g && g.orders) || [])[0] || {};
const isWithin = (iso, from, to) => !!iso && iso >= from && iso <= to;

// What one customer order is worth: every row of its group, at the price it was sold
// at — so a price she changed on the order is the price counted here.
export function groupValue(state, group) {
  return (group.orders || []).reduce((sum, o) =>
    sum + (Number(o.qty) || 0) * (orderLinePrice(state, o) || 0), 0);
}

// Has the money actually been collected? Picking Paid in the dropdown only says the
// order has reached the paying stage: it stays uncollected until the Paid · Cash /
// Paid · TNG button is pressed (paidReceived). An order from before those flags
// existed has none, which reads as collected — the same rule the journey map has
// always used, so an old order does not suddenly look unpaid.
//
// `true` is the money itself, so it stands on its own (v268). The stage is only how a
// MISSING answer is read, never a veto over a stated one: a payment she recorded before
// the order reached the paying stage — the box on the order takes a method at any stage
// — is money she has, and every screen that counts money has to agree about it. Before
// this the record sat in the order while the day's till, the row's tag and the
// customer's card all went on saying it was owed.
export function isCollected(group) {
  const first = firstOf(group);
  if (first.paidReceived === true) return true;
  const at = STAGES.indexOf(String(first.status || "new"));
  return at >= PAID_STAGE && first.paidReceived !== false;
}

// ★★ A REFUNDED SALE IS NEITHER TAKINGS NOR OWED (v361). The money came in and went back
// out, so it is not money she has — and it is not money anybody owes either, because the
// order is over. **Every totaller SKIPS it rather than filing it on one side or the other:**
// as takings it would say she kept money she handed back, and as owed it would say a
// customer still has to pay for a sale that has been undone. Both are lies, and a total
// nobody can trust is worse than no total.
//
// ⚠️ READ OFF THE ORDER, and stamped on EVERY row of the sale the same way `courierDay` and
// `pickupTime` are — so a row read on its own still knows. It takes a group or a bare row,
// because the Money screen walks groups and Profit walks rows.
export function isRefunded(x) {
  if (!x) return false;
  const first = Array.isArray(x.orders) ? (x.orders[0] || null) : x;
  // ★ EITHER FACT WILL DO (v370). The mark and the amount are written together by the refund press,
  // but a reader that needed BOTH would quietly ignore an order carrying only one — and the amount
  // arrives on its own from the register on a phone that has never seen the refund itself.
  return !!(first && (first.refundedAt || Number(first.refundAmountRM) > 0));
}

// ── ★★ A REFUND CAN BE A PART OF AN ORDER (v370) ────────────────────────────
//
// Her words: __"refund should not be a full without choice to how much to refund, what to refund"__.
// Until v370 a refund was a boolean: the whole order, or nothing. It is now an AMOUNT, stamped on the
// order beside the mark, plus the items that came back as the record of why.
//
// ⚠️⚠️ AND THAT FORCED A SECOND, DEEPER FIX. Her takings were counted at the goods' FACE price, with
// the discount still in them — so a RM16 order with a RM3 coupon counted as RM16 in the till though
// the customer handed over RM13. While a refund skipped the whole order those two errors cancelled.
// **The moment a refund can be a part, they stop cancelling**, and a FULL refund of a discounted order
// would leave a phantom RM3 behind — worse than the thing it replaced.
//
// Asked which she wanted, she chose **"count what the customer actually paid"**, knowing her past
// Money figures for discounted orders would come down by the discount. That is what `orderTakings` is.

// What the customer's money for THIS order actually was, before anything went back: the goods, less
// the discounts she gave. The courier charge stays OUT — it is a pass-through to the courier and was
// never her takings (see the note at the top of this file).
export function orderTakings(state, group) {
  const t = customerTotal(state, group);
  return round2(Math.max(0, t.items - t.promo - t.coupon));
}

// The money given back on one order.
//
// ⚠️⚠️ A MISSING AMOUNT IS **THE FULL BILL**, NOT ZERO. Every order refunded before v370 carries
// `refundedAt` and no amount, and reading that as "nothing went back" would put every one of those
// sales straight back into her takings — the loudest possible way to be wrong about her books. The
// full bill is exactly what the old boolean meant, so those orders behave identically.
export function refundOf(state, group) {
  const first = firstOf(group);
  // ⚠️ THE AMOUNT IS ASKED FIRST, AND THE MARK IS THE FALLBACK — never the gate. Gating on the mark
  // would make an amount with no mark do nothing at all, which is a silent way to lose the whole
  // refund; and the amount is the more specific of the two facts.
  const stored = Number(first.refundAmountRM);
  if (Number.isFinite(stored) && stored > 0) return round2(stored);
  if (first.refundedAt) return round2(customerTotal(state, group).total);
  return 0;
}

// What one order leaves in her hands: the customer's money for the goods, less what went back.
// ⚠️ FLOORED AT NOTHING. A refund may legitimately be larger than the goods — the postage went back
// too — and a negative "takings" would read as money she owes herself.
export function orderNet(state, group) {
  return round2(Math.max(0, orderTakings(state, group) - refundOf(state, group)));
}

// ★★ WHETHER A REFUND HAS UNDONE THE ORDER ENTIRELY (v370) — and this is the ONLY thing that makes
// a book skip an order.
//
// ⚠️⚠️ IT IS NOT "net is zero", AND THE DIFFERENCE COST A REGRESSION WHILE THIS WAS BEING BUILT.
// An order whose product carries **no price** also nets to zero — and the app goes out of its way to
// keep `null` (nothing can price this) apart from `0` (this is free), so the journal can say "no
// price recorded" rather than print a confident RM 0.00. Skipping on "net is zero" made those orders
// vanish from the trading journal entirely. **A refund is what cancels an order; a price that is
// missing never did and never will.**
export function refundedInFull(state, group) {
  // ⚠️ THE MARK IS THE TEST, and the arithmetic only asks whether anything SURVIVED it. Gating on
  // "some money went back" instead would have missed an order whose bill is RM0 — one whose product
  // carries no price — and quietly let a refunded sale back into the books as a line.
  return isRefunded(group) && orderNet(state, group) <= 0;
}

// The method as it should be read: the list's own label, whichever spelling the row
// was written with ("Cash" and "cash" are the same thing to the books), or "" for a
// row nobody said how they paid. Returning only the old lower-case pair here is what
// left every order paid since v106 looking unaccounted for.
export function methodOf(group) {
  return methodLabel(firstOf(group).paidMethod);
}

// The day a customer order is for: the delivery date record while it exists, its own
// snapshot after the date was deleted.
export function deliveryOf(state, group) {
  const first = firstOf(group);
  if (first.deliveryDate) return String(first.deliveryDate);
  const rec = (state.deliveryDates || []).find((d) => d && d.id === first.deliveryDateId);
  return rec ? rec.date : "";
}

// The day the money landed, in HER day. paidAt is a full instant, so slicing the
// UTC string counts a payment taken at half past midnight as the day before — it is
// the local calendar day she reconciles against, so that is what is read off it.
export function paidOf(state, group) {
  const at = String(firstOf(group).paidAt || "");
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    }
  }
  return deliveryOf(state, group);
}

// What a set of CUSTOMER orders came in by, bucketed the same way the pocket rows
// are. The comparison goes through accounts.js rather than against the old lower-case
// "cash"/"tng": a row written since the ways-to-pay list exists holds the label, so
// testing for "tng" sent every TNG order into "Paid, no method" — the TNG column read
// zero while the money was in the till (found 16 Sep 2026, from her asking for the
// journals).
function tally(state, groups) {
  const out = { cash: 0, tng: 0, other: 0, unmarked: 0, toCollect: 0, toCollectCount: 0, count: 0, byMethod: new Map() };
  for (const g of groups) {
    out.count++;
    // Owed money is counted at what the customer will hand over — the items plus the
    // courier charge when they pay it with the order. customerTotal() is the one
    // helper the messages and the track card already quote, so the figure this row
    // promises is the figure the customer was told to pay (19 Sep 2026). A COD charge
    // is not in it: that money goes to the courier at the door, never to you.
    //
    // ★ AND A REFUNDED SALE IS NEVER OWED (v361), whatever its stage. That guard is kept
    // EXPLICIT rather than left to fall out of the arithmetic: an order carrying a refund but
    // never marked paid is a real shape, and without this line the refund would land in the
    // owed column and read as a customer who still has to pay for a sale that was undone.
    if (!isCollected(g)) {
      if (!isRefunded(g)) { out.toCollect += customerTotal(state, g).total; out.toCollectCount++; }
      continue;
    }
    // ★★ TAKINGS, LESS ANYTHING HANDED BACK (v370). Not `groupValue` any more: that counted the
    // goods at their FACE price, so a discounted order read as money she never received. A fully
    // refunded order now nets to 0 and is dropped below — **the same answer v361's skip gave**,
    // which is what keeps every refund made before this version behaving exactly as it did.
    const value = orderNet(state, g);
    if (value <= 0) continue;
    const method = methodOf(g);
    // The same money, filed one way for the columns and one way per method: it is the
    // method totals that give a loan, the bank overdraft or a personal pocket a row of
    // its own, and a book of its own behind it (17 Sep 2026).
    if (method) out.byMethod.set(method, (out.byMethod.get(method) || 0) + value);
    if (isCash(method)) out.cash += value;
    else if (isTng(method)) out.tng += value;
    else if (isOther(method)) out.other += value;
    else out.unmarked += value;
  }
  return out;
}

// One delivery day, as its own little till.
export function dayMoney(state, deliveryDateId) {
  const groups = groupOrders(state.orders || [])
    .filter((g) => firstOf(g).deliveryDateId === deliveryDateId);
  return tally(state, groups);
}

// The rows of one of the pocket lists in a stretch, newest first. Every entry
// carries its own day, so these need no fallback rule: money is recorded on the day
// it moved, by definition.
function rowsBetween(list, from, to) {
  return (list || [])
    .filter((e) => e && e.date && isWithin(String(e.date), from, to))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// What a set of pocket rows adds up to, split by how it was paid. Three buckets,
// not two: cash and TNG are what moves through her purse and her phone, "other" is
// money that paid for something without going near either — a loan, the bank
// overdraft — and unmarked is a row nobody said how they paid (older than the list).
function tallyRows(rows) {
  const out = { rows, cash: 0, tng: 0, other: 0, unmarked: 0, total: 0, byMethod: new Map() };
  for (const e of rows) {
    const amount = Number(e.amount) || 0;
    out.total += amount;
    const label = methodLabel(e.method);
    if (label) out.byMethod.set(label, (out.byMethod.get(label) || 0) + amount);
    if (isCash(label)) out.cash += amount;
    else if (isTng(label)) out.tng += amount;
    else if (isOther(label)) out.other += amount;
    else out.unmarked += amount;
  }
  return out;
}

// Every way of paying that is neither cash nor TNG and that actually moved something in
// this stretch — the loan, the bank overdraft, someone's own pocket — in the order of
// her own list, each with what moved by it (17 Sep 2026: "each CASH, TNG, LOAN, Personal
// Pocket Kean, Personal Pocket Suan, and others that might be added in future need a
// journal"). Read off the ROWS rather than off her list, so a method she has since
// renamed or taken off the list still gets a line: its money is still in the books, and
// a figure she cannot open is a figure she has to take on faith.
//
// `inTallies` add (orders collected that way, money of her own she put in that way),
// `outTallies` subtract (spending paid that way) — the same net the Money screen shows.
export function otherMethods(state, inTallies = [], outTallies = []) {
  const labels = new Set();
  for (const t of [...inTallies, ...outTallies]) {
    for (const label of (t && t.byMethod ? t.byMethod.keys() : [])) if (isOther(label)) labels.add(label);
  }
  const sum = (list, label) =>
    list.reduce((s, t) => s + ((t && t.byMethod && t.byMethod.get(label)) || 0), 0);
  return [...labels]
    .sort((a, b) => methodRank(state, a) - methodRank(state, b) || a.localeCompare(b))
    .map((label) => ({ label, net: sum(inTallies, label) - sum(outTallies, label) }));
}

// What she spent in a stretch, and how she paid for it — one half of the Money
// screen (16 Sep 2026).
export function expensesBetween(state, from, to) {
  return tallyRows(rowsBetween(state.expenses, from, to));
}

// Money you put IN yourself in a stretch — the meat paid from your purse, a float for
// change (16 Sep 2026). Counted beside the order takings so the cash and TNG rows are
// what your purse and your phone should really hold; the Money screen says how much of
// them is your own. Taking it back out is an ordinary expense, category "My own
// withdrawal", so it leaves through the same door as everything else.
export function depositsBetween(state, from, to) {
  return tallyRows(rowsBetween(state.deposits, from, to));
}

// One method's journal for a stretch — the cash book, the TNG book (16 Sep 2026).
// Everything that moved that way, in and out, in date order, ending on what the
// method should hold: what the customer paid by it, what she spent out of it, and
// what she put in herself. Built from the same rows the Money screen totals, so the
// journal can never disagree with the figures it was opened from.
export function journalFor(state, method, from, to) {
  const want = methodLabel(method);
  const rows = [];
  for (const g of groupOrders(state.orders || [])) {
    const first = firstOf(g);
    if (!isCollected(g) || methodLabel(first.paidMethod) !== want) continue;
    // ★ THE ROW CARRIES THE NET, AND NAMES THE REFUND (v370). One row, not two: the refund went
    // back the way it came, so an "in" of the balance and an "out" of the refund would say the
    // same thing twice — and this book's whole job is to agree with the column above it.
    const back = refundOf(state, g);
    const value = orderNet(state, g);
    // A FULLY REFUNDED order moved through the pocket and left it. A RM0.00 "in" row is noise in a
    // reconciliation — ⚠️ but only a refund earns that skip: an order nothing can price keeps its
    // row, exactly as it always has (see `refundedInFull`).
    if (refundedInFull(state, g)) continue;
    const day = paidOf(state, g);
    if (!isWithin(day, from, to)) continue;
    rows.push({
      date: day,
      what: `Order #${orderCode(first)} — ${first.customerName || "no name"}`
        + (back > 0 ? ` (refunded ${fmtRM(back, (state.settings && state.settings.currency) || "RM")})` : ""),
      amount: value,
      dir: "in",
    });
  }
  for (const d of state.deposits || []) {
    if (!d || methodLabel(d.method) !== want || !isWithin(String(d.date || "").slice(0, 10), from, to)) continue;
    rows.push({
      date: String(d.date).slice(0, 10),
      // A payback and money you put in are different things, though both arrive with the
      // pocket: "Put money in" is you funding the business, a payback is the till settling
      // up with you (17 Sep 2026).
      // ★ AND THE POT IS NAMED (v394). ⚠️ A row written before v394 carries no `source` and reads
      what: d.repay
        ? `Paid back to this pocket${d.source ? ` — from ${d.source}` : ""}${d.note ? ` — ${d.note}` : ""}`
        : d.transfer
          ? `Transferred from ${d.source || "another pot"}${d.note ? ` — ${d.note}` : ""}`
          : `Your own money in${d.source ? ` — from ${d.source}` : ""}${d.note ? ` — ${d.note}` : ""}`,
      amount: Number(d.amount) || 0,
      dir: "in",
    });
  }
  for (const e of state.expenses || []) {
    if (!e || methodLabel(e.method) !== want || !isWithin(String(e.date || "").slice(0, 10), from, to)) continue;
    rows.push({
      date: String(e.date).slice(0, 10),
      // A row written by an action elsewhere names what wrote it, so a figure you cannot
      // place is openable under its own name: a shopping run, or the courier charge you
      // paid on one order (19 Sep 2026).
      what: `${e.poId ? "Shopping run (PO)"
        : e.courierFor ? `Courier (order #${e.courierFor})`
        : (e.category || "Expense")}${e.note ? ` — ${e.note}` : ""}`,
      amount: Number(e.amount) || 0,
      dir: "out",
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  let inTotal = 0;
  let outTotal = 0;
  for (const r of rows) {
    if (r.dir === "in") inTotal += r.amount;
    else outTotal += r.amount;
  }
  return { rows, inTotal, outTotal, net: inTotal - outTotal };
}

// What one pocket is owed in a stretch (17 Sep 2026): what it paid out for the business,
// less what of its own money went in. Positive means it is out of pocket and the till
// owes it. Read from the same two lists the Money screen totals, so the figure you are
// offered as a payback is the figure your own line shows.
// ★★ WHAT SHE HAS PUT INTO THE BAKERY, AND WHAT SHE HAS TAKEN BACK (v396).
//
// Her words: __"SO investment is an account, a source of money, we are able to generate investment
// account.?"__ — and, asked whether it should show money taken back out as well, __"yes, with taken back
// out too"__.
//
// ⚠️⚠️ IT IS ALL-TIME, NOT A STRETCH, AND THAT IS THE POINT OF IT. Every other figure on the Money
// screen answers "what moved this week"; this one answers "where do I stand with the bakery" — and a
// BALANCE only means anything counted from the beginning. A stretch-scoped version would say she was
// RM 200 in on a week she had taken RM 900 out.
//
// ⚠️⚠️ AND TWO KINDS OF ROW MUST NOT BE COUNTED, or the balance is a lie. Both are rows this app writes
// itself, under the DRAWINGS category — which is what keeps them off the profit statement, and which is
// exactly why they would otherwise be read as her money leaving:
//   • a TRANSFER (v395) never left the business. Counting one would say she had taken out money she
//     merely moved from TNG to Cash.
//   • a PAYBACK's deposit (marked `repay`) is the till settling with a pocket that paid for something.
//     That is not her putting money in afresh — it is money the business already owed.
// ★★ AND IT IS KEPT PER OWNER (v398). Her question: __"investment can be from few owner, how to
// differentiate"__ — jienluv2bake is a trade mark of a company with more than one owner, so "what have
// I put in" is the wrong question; **"what has EACH of us put in, and taken back"** is the right one.
//
// ⭐ THE SOURCES LIST ALREADY ANSWERS IT. A source does not have to be a place — she names them, so
// they can be **Kean**, **Suan**, **Impressive Direction**. What was missing was that the account kept
// one total, and that a withdrawal said nothing about whose money it was.
//
// ⚠️ SO EVERY ROW IS BUCKETED BY SOURCE, and a row with none is kept in its own bucket rather than
// dropped — **money that went out has to be visible somewhere**, and an unnamed owner is a fact about
// her books, not a rounding error.
export function investmentOf(state) {
  const buckets = new Map(); // "" is the bucket for money with no owner named on it
  const bump = (source, side, amount) => {
    const key = String(source == null ? "" : source);
    if (!buckets.has(key)) buckets.set(key, { source: key, putIn: 0, takenBack: 0 });
    buckets.get(key)[side] += amount;
  };

  for (const d of state.deposits || []) {
    if (!d || d.repay || d.transfer) continue;
    const amount = Number(d.amount) || 0;
    if (!amount) continue;
    bump(d.source, "putIn", amount);
  }
  for (const e of state.expenses || []) {
    if (!e || e.transfer) continue;
    const amount = Number(e.amount) || 0;
    if (!amount) continue;
    // ★★ SOMETHING SHE BOUGHT WITH HER OWN MONEY (v397). Her words: __"When i enter an expenses, like
    // buying equipment, should i allow to credit investment account?"__ — and, asked how the app should
    // tell the two apart, she chose to say so ON THE EXPENSE ITSELF. A row she marked that way is money
    // that went into the business and stayed there: it is money SHE PUT IN, and it is not owed back.
    if (e.invested) { bump(e.source, "putIn", amount); continue; }
    // ⚠️ BY CATEGORY CLASS, not by the word — she can rename her withdrawal category to anything she
    // likes, and the class is what says it is her own money rather than a cost of trading.
    if (classOfCategory(state, e.category) !== "drawing") continue;
    bump(e.source, "takenBack", amount);
  }

  const bySource = [...buckets.values()]
    .map((b) => ({ ...b, putIn: round2(b.putIn), takenBack: round2(b.takenBack),
      stillIn: round2(b.putIn - b.takenBack) }))
    .sort((a, b) => (a.source || "￿").localeCompare(b.source || "￿"));

  const total = (k) => round2(bySource.reduce((n, b) => n + b[k], 0));
  return {
    putIn: total("putIn"),
    takenBack: total("takenBack"),
    stillIn: round2(total("putIn") - total("takenBack")),
    bySource,
    // ⚠️ AND THE ROWS, for the book — in date order, each carrying whose money it was.
    rows: buildInvestmentRows(state),
  };
}

function buildInvestmentRows(state) {
  const rows = [];
  for (const d of state.deposits || []) {
    if (!d || d.repay || d.transfer) continue;
    const amount = Number(d.amount) || 0;
    if (!amount) continue;
    rows.push({ date: String(d.date || "").slice(0, 10), what: "Put in", amount, dir: "in",
      source: String(d.source == null ? "" : d.source) });
  }
  for (const e of state.expenses || []) {
    if (!e || e.transfer) continue;
    const amount = Number(e.amount) || 0;
    if (!amount) continue;
    if (e.invested) {
      rows.push({ date: String(e.date || "").slice(0, 10), what: "Paid for something yourself",
        amount, dir: "in", source: String(e.source == null ? "" : e.source) });
      continue;
    }
    if (classOfCategory(state, e.category) !== "drawing") continue;
    rows.push({ date: String(e.date || "").slice(0, 10), what: "Took out", amount, dir: "out",
      source: String(e.source == null ? "" : e.source) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function pocketOwed(state, method, from, to) {
  const want = methodLabel(method);
  if (!want) return 0;
  const sum = (list) => (list || []).reduce((s, r) => {
    if (!r || methodLabel(r.method) !== want) return s;
    // ⚠️⚠️ A ROW SHE MARKED AS HER INVESTMENT IS NOT A DEBT (v397). It still carries that pocket's
    // name — that is how she paid — but the money is not owed back to her, so the pocket must not go
    // on claiming the bakery owes it. **Without this the same ringgit would be counted twice: once as
    // "the bakery owes me" here, and once as "put in" on her investment account.**
    if (r.invested) return s;
    const day = String(r.date || "").slice(0, 10);
    return isWithin(day, from, to) ? s + (Number(r.amount) || 0) : s;
  }, 0);
  return sum(state.expenses) - sum(state.deposits);
}

// A stretch of days, for the Money screen.
export function moneyBetween(state, fromISO, toISO) {
  // ⚠️ NO REFUND FILTER HERE, AND THAT IS DELIBERATE (v361). `tally` is the one place the
  // refund is skipped, and a second copy of the rule here would be a second thing to keep in
  // step — the bite proved this one changed no figure at all, which is what dead weight looks
  // like. The day filter below still runs: a group is placed in a stretch before its money is
  // counted, and a refunded one then falls out in `tally` with the rest.
  const groups = groupOrders(state.orders || []).filter((g) => (isCollected(g)
    ? isWithin(paidOf(state, g), fromISO, toISO)
    : isWithin(deliveryOf(state, g), fromISO, toISO)));
  return tally(state, groups);
}
