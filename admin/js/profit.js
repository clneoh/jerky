// profit.js — the books (16 Sep 2026). She asked for it in so many words: "make it
// like an accounting software". So this is a profit and loss account, not a cash
// summary — and the two are kept apart on purpose, because they answer different
// questions and you need both:
//
//   • Money (views/money.js) is the CASH: what is in the purse and on the phone.
//     A packet of meat is money out on the day it is bought.
//   • Profit (this) is the TRADING: what was sold, what those sales cost to make,
//     and what running the shop cost. The same packet is a cost as the treats made
//     from it are sold — so a big stock-up week looks alarming on Money and calm
//     here, which is the truth of both.
//
// That split is also why nothing is counted twice: ingredient buying is a cash
// movement (and stock on the shelf), while cost of sales comes from the recipes.
//
// Your own money is neither income nor expense. Money you put in is CAPITAL, money
// you take back out is DRAWINGS; both move cash, neither changes profit. That is
// why "My own withdrawal" is its own class here even though it lives in the same
// money-out list as the rest.
import { byId, groupOrders, orderLineName, orderLinePrice, round2 } from "./state.js";
import { costOf } from "./bom.js";
import { categoriesOf, classOfCategory } from "./accounts.js";
import { orderNet, refundedInFull, refundOf } from "./money.js";
import { customerTotal } from "./courier.js";

// The day an order is FOR: the delivery date record while it exists, its own
// snapshot after the date was deleted. Sales are counted by delivery day, the same
// day the day headers, the weekly numbers and the customer's calendar all use.
export function orderDay(state, o) {
  if (o && o.deliveryDate) return String(o.deliveryDate).slice(0, 10);
  const rec = (state.deliveryDates || []).find((d) => d && d.id === (o && o.deliveryDateId));
  return rec ? rec.date : "";
}

const inRange = (iso, from, to) => !!iso && iso >= from && iso <= to;

// What ONE unit of a sold line cost to bake — the frozen cost when the order
// carries one, else the live recipe. ★★ THE FREEZE (v380), and the exact mirror
// of `orderLinePrice` in state.js, so a sale's cost is as fixed as its price.
//
// ⚠️ WHY IT MATTERS: `costOf` bottoms out in `effectiveUnitCost`, which reads
// TODAY's supplier prices. Without this, editing one ingredient price rewrote
// every past month's cost of sales — her words: "when i change the ingredient
// cost, for age orders, will its COS change?" (yes, it did).
export function orderLineCost(state, o) {
  const frozen = o && o.unitCost;
  if (frozen != null && frozen !== "" && Number.isFinite(Number(frozen))) return Number(frozen);
  const p = byId(state.products, o && o.productId);
  return p ? costOf(state, p) : 0;
}

// What one sold line cost to bake, in total. ⚠️ THE ONLY READER of an order's
// cost in the whole app — `costOf` appears in no view — so freezing it here
// freezes the profit statement, its journal's cost column and every future
// report at once.
export function lineCost(state, o) {
  return (Number(o && o.qty) || 0) * orderLineCost(state, o);
}

// The profit and loss account for a stretch of days.
//
//   sales      every order delivered in the stretch, at the price it was sold at
//   cost       what those lines cost to make, from the recipes
//   gross      sales − cost
//   expenses   running costs recorded in the stretch, by category — never stock
//              purchases (those are cash and the shelf) and never drawings
//   net        gross − expenses
//   capital    her own money put in during the stretch
//   drawings   her own money taken out during the stretch
//
// `uncosted` counts the lines whose recipe prices to nothing, so the screen can say
// so instead of quietly reporting a profit that is too high.
export function profitBetween(state, from, to) {
  let sales = 0;
  let cost = 0;
  let lines = 0;
  let uncosted = 0;
  // ⚠️ SALES ARE SUMMED BY **GROUP**, COST BY **LINE** (v370), and the difference is deliberate.
  // Sales was `qty × price` per row — the goods at their face price, with any discount left in
  // and any refund ignored, which is what the Money screen used to do too. `orderNet` is what the
  // customer's money for this order actually was, less what went back — the SAME number the till
  // shows, so the statement and the Money screen cannot disagree about a sale.
  //
  // ★ AND A SALE REFUNDED IN FULL STILL DISAPPEARS WHOLE. `orderNet` is 0 for it and the group is
  // dropped before a single line is counted, which is precisely what the v361 skip did — so no
  // refund made before this version moves a single figure on this statement.
  for (const g of groupOrders(state.orders || [])) {
    const first = (g.orders || [])[0];
    if (!first || !inRange(orderDay(state, first), from, to)) continue;
    // ⚠️ ONLY A REFUND CANCELS A SALE — never a zero. An order whose product carries no price
    // nets to zero too, and it must go on being counted as a line with no price (see
    // `refundedInFull`).
    if (refundedInFull(state, g)) continue;
    sales += orderNet(state, g);
    for (const o of g.orders) {
      // ⚠️ COST IS NOT REFUNDED. The ingredients went into the bread whether or not the bread
      // came back, so a partly refunded order costs what it always cost.
      const lined = lineCost(state, o);
      if (!lined) uncosted++;
      cost += lined;
      lines++;
    }
  }

  const byCategory = new Map();
  let expensesTotal = 0;
  let drawings = 0;
  for (const e of state.expenses || []) {
    if (!e || !inRange(String(e.date || ""), from, to)) continue;
    const amount = Number(e.amount) || 0;
    const cls = classOfCategory(state, e.category);
    if (cls === "drawing") { drawings += amount; continue; }
    if (cls === "stock") continue; // cash and the shelf, not this stretch's trading
    const label = e.category || "Other";
    byCategory.set(label, (byCategory.get(label) || 0) + amount);
    expensesTotal += amount;
  }

  let capital = 0;
  for (const d of state.deposits || []) {
    if (d && inRange(String(d.date || ""), from, to)) capital += Number(d.amount) || 0;
  }

  return {
    sales,
    cost,
    gross: sales - cost,
    lines,
    uncosted,
    // The chart of accounts in order, so the statement always reads the same way
    // even when a category has nothing in it.
    expenses: categoriesOf(state).filter((c) => c.cls === "expense")
      .map((c) => ({ label: c.label, amount: byCategory.get(c.label) || 0 })),
    // Anything whose label is no longer in the chart, so nothing vanishes from the
    // books: an old category still shows, at the end.
    otherExpenses: [...byCategory.entries()]
      .filter(([label]) => !categoriesOf(state).some((c) => c.label === label))
      .map(([label, amount]) => ({ label, amount })),
    expensesTotal,
    net: sales - cost - expensesTotal,
    capital,
    drawings,
  };
}

// The transactions behind one line of the statement (17 Sep 2026: "the expenses items
// in Profit & Loss should reveal its journals"). A line on a statement is a total; this
// is what it is made of — the rows the Money screen wrote, in date order, each with how
// it was paid. `label` null means every running cost at once, which is what the Total
// line is made of.
//
// The same two classes are skipped here as in profitBetween, so the rows always add up
// to the line above them: a stock purchase is cash and the shelf (never this stretch's
// trading) and money she took out for herself is drawings.
export function expenseRows(state, from, to, label = null) {
  const rows = [];
  for (const e of state.expenses || []) {
    if (!e || !inRange(String(e.date || ""), from, to)) continue;
    const cls = classOfCategory(state, e.category);
    if (cls === "drawing" || cls === "stock") continue;
    const category = e.category || "Other";
    if (label && category !== label) continue;
    rows.push({
      id: e.id,
      date: String(e.date || "").slice(0, 10),
      // What it was for: her own note when she wrote one, else the category itself.
      what: (e.note && String(e.note).trim()) || category,
      category,
      method: e.method || "",
      amount: Number(e.amount) || 0,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

// The orders behind a trading line (2 Oct 2026: "at the profit section, can the sales and
// cost of sales be clickable to reveal its journal"). Sales and Cost of sales are the same
// order lines read from two sides — what the customer paid, and what the recipe says those
// treats cost to make — so ONE function feeds both journals and the two can never disagree
// about which orders the month held.
//
// A sale counts on the day it is DELIVERED, the same day profitBetween counts it, so the
// rows always add up to the line above them, exactly as expenseRows does.
export function tradingRows(state, from, to) {
  const rows = [];
  // ★★ THE ROWS STILL HAVE TO ADD UP TO THE LINE ABOVE THEM, and from v370 the line is
  // `orderNet` — the goods less the discount less anything refunded. A row per order line at its
  // face price would therefore sum to MORE than the line. So the two things that make the
  // difference are drawn as rows of their own: **a discount and a refund are visible in the
  // journal rather than folded invisibly into the total**, which is the better answer for a book
  // she is meant to be able to check.
  for (const g of groupOrders(state.orders || [])) {
    const first = (g.orders || [])[0];
    if (!first || !inRange(orderDay(state, first), from, to)) continue;
    // A sale refunded in full is dropped whole — no line rows and no adjustment rows — so the
    // journal keeps saying exactly what it said before this version about a past refund.
    // ⚠️ And ONLY a refund drops it: a line nothing can price nets to zero and still belongs here,
    // marked "no price recorded".
    if (refundedInFull(state, g)) continue;
    const customer = String(first.customerName || "").trim();
    for (const o of g.orders) {
      const qty = Number(o.qty) || 0;
      const price = orderLinePrice(state, o);
      const cost = lineCost(state, o);
      rows.push({
        id: o.id,
        date: orderDay(state, o),
        // What was sold and how many, named as the order froze it — so a product she has
        // since renamed or deleted still reads as the loaf that was actually sold.
        what: `${orderLineName(state, o)}${qty ? ` × ${qty}` : ""}`,
        customer,
        qty,
        // null when nothing can price the line, so the journal can say "no price" rather
        // than print a confident RM 0.00. The same distinction orderLinePrice exists to keep.
        price,
        sales: qty * (price == null ? 0 : price),
        cost,
        // A line whose recipe prices to nothing is counted as nothing, which is what makes a
        // profit read too high. The journal marks it, so a 0.00 row is never mistaken for a
        // row that failed to load.
        uncosted: !cost,
      });
    }
    const t = customerTotal(state, g);
    const back = refundOf(state, g);
    // ⚠️ `price: 0`, NOT null — `openTradingJournal` reads a null price as "no price recorded"
    // and would print that beside a discount, which has no price by nature rather than by
    // omission. `qty: 0` keeps them out of anything that counts pieces.
    const adjust = (id, what, amount) => rows.push({
      id: `${first.id}-${id}`,
      date: orderDay(state, first),
      what,
      customer,
      qty: 0,
      price: 0,
      sales: -round2(amount),
      cost: 0,
      uncosted: false,
    });
    if (t.promo > 0) adjust("promo", `Code ${t.promoCode || ""}`.trim(), t.promo);
    if (t.coupon > 0) adjust("coupon", "Bring-a-friend discount", t.coupon);
    if (back > 0) adjust("refund", "Refunded to the customer", back);
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

// The first and last day of a month, as the statement works in months.
export function monthSpan(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  const mm = String(month + 1).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}
