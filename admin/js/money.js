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
import { groupOrders, orderCode, orderLinePrice } from "./state.js";
import { isCash, isOther, isTng, methodLabel, methodRank } from "./accounts.js";

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
export function isCollected(group) {
  const first = firstOf(group);
  const at = STAGES.indexOf(String(first.status || "new"));
  return at >= PAID_STAGE && first.paidReceived !== false;
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
    const value = groupValue(state, g);
    if (!isCollected(g)) { out.toCollect += value; out.toCollectCount++; continue; }
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
    const day = paidOf(state, g);
    if (!isWithin(day, from, to)) continue;
    rows.push({
      date: day,
      what: `Order #${orderCode(first)} — ${first.customerName || "no name"}`,
      amount: groupValue(state, g),
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
      what: d.repay
        ? `Paid back to this pocket${d.note ? ` — ${d.note}` : ""}`
        : `Your own money in${d.note ? ` — ${d.note}` : ""}`,
      amount: Number(d.amount) || 0,
      dir: "in",
    });
  }
  for (const e of state.expenses || []) {
    if (!e || methodLabel(e.method) !== want || !isWithin(String(e.date || "").slice(0, 10), from, to)) continue;
    rows.push({
      date: String(e.date).slice(0, 10),
      what: `${e.poId ? "Shopping run (PO)" : (e.category || "Expense")}${e.note ? ` — ${e.note}` : ""}`,
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
export function pocketOwed(state, method, from, to) {
  const want = methodLabel(method);
  if (!want) return 0;
  const sum = (list) => (list || []).reduce((s, r) => {
    if (!r || methodLabel(r.method) !== want) return s;
    const day = String(r.date || "").slice(0, 10);
    return isWithin(day, from, to) ? s + (Number(r.amount) || 0) : s;
  }, 0);
  return sum(state.expenses) - sum(state.deposits);
}

// A stretch of days, for the Money screen.
export function moneyBetween(state, fromISO, toISO) {
  const groups = groupOrders(state.orders || []).filter((g) => (isCollected(g)
    ? isWithin(paidOf(state, g), fromISO, toISO)
    : isWithin(deliveryOf(state, g), fromISO, toISO)));
  return tally(state, groups);
}
