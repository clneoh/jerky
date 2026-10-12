// views/profit.js — the books, as a statement (16 Sep 2026). She asked for it as
// accounting software, so it reads like one: a month at a time, sales down to what
// was left, with the owner's own money kept out of the trading figures entirely.
// The arithmetic lives in js/profit.js, next to the cash side it must never be
// confused with.

import { el, button, showPopup } from "../ui.js";
import { fmtRM } from "../state.js";
import { profitBetween, expenseRows, tradingRows } from "../profit.js";
import { addDays, longDate, todayISO } from "../dates.js";
import { periodSpan } from "../consolidated.js";
import { journalSheet, journalButtons, bakeryName } from "../journal.js";

// ⚠️ THE LOCAL `MONTHS` LIST WENT WITH THE MONTH STEPPER (v403) — `periodSpan` now names every window,
// including a month, so a second copy of the month names here would be a second thing to keep in step.

// "14 Sep" — a journal line needs the day, not the year.
const dayMonth = (iso) => longDate(String(iso).slice(0, 10)).slice(0, -5);

// The two things the figures cannot say for themselves, written once and read by BOTH the
// card and the printed statement — so a page that leaves the app cannot explain itself in
// different words than the screen it came from (3 Oct 2026).

// Cost of sales is a RECIPE cost, read from the recipe and the ingredient prices she has
// recorded — NOT money she actually spent. That is what makes gross profit a guide to
// pricing rather than a bank balance, which is the reading she needs if she compares this
// screen against Money and finds they disagree.
//
// ★★ AND SINCE v380 IT IS FROZEN ONTO THE ORDER (her words: "yes, freeze the cost onto the
// order"). The note used to say editing a recipe or a price "moves past months too" — true
// when this was written, and FALSE from v380 on, because each line carries the cost it was
// taken at and the books read that. ⚠️ A figure that goes on claiming it can still move is
// a figure nobody can trust, so the claim is replaced rather than left standing.
//
// ⚠️ THE ONE THING THAT STILL MOVES, AND IT IS SAID: an order taken BEFORE v380 was pinned
// at the cost it was already showing on the day that version arrived — so a closed month is
// steady from then on, but the figure it settled at is that day's recipe cost, not what the
// flour cost when the order was actually baked. The app never recorded one; saying otherwise
// would be inventing a number.
const COST_OF_SALES_NOTE = "Cost of sales is built from the recipe and the ingredient prices you have recorded. It is frozen onto each order when you take it, so changing a recipe or a price from now on does not rewrite a sale already made. Orders taken before this was introduced were pinned at the cost they were already showing. It is still not what you actually spent, and gross profit is a guide to your pricing rather than your bank balance — the Money screen is where the cash is.";

// The cash half of the same story: a pack bought today is not costed all at once. It closes
// with the one choice she has to make about her own hours, and carries the month's own count
// of lines nothing could price — that count moves month to month, which is why this is a
// function of the statement rather than a fixed string.
const cashFooter = (pl) => "A pack bought today is not costed all at once — it is cash on the Money screen and stock on the shelf, and becomes cost of sales as the treats made from it are sold. Sales are counted by the day you post. "
  + (pl.uncosted ? `${pl.uncosted} line${pl.uncosted === 1 ? "" : "s"} this month had no recipe cost and was counted as nothing — check that product's recipe. ` : "")
  + "Your own unpaid hours are not costed on their own: either pay yourself a Salary (you), with EPF and SOCSO as their own category, or mark Labour as a not-bought ingredient (More → Ingredients) and put the hours into the recipes. Count them one way, never both.";

// A statement line is a total, and a total nobody can open is a figure to be trusted on
// faith. Tap it and the rows it is made of are here — the same rows the Money screen
// wrote, so the two screens can never disagree (17 Sep 2026: "the expenses items in
// Profit & Loss should reveal its journals"). `label` null = the Total expenses line,
// which is every running cost in the month at once.
function openExpenseJournal(state, label, from, to, monthTitle) {
  const cur = state.settings.currency || "RM";
  const rows = expenseRows(state, from, to, label);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  // One category's journal has its name in the title, so a row only needs the day, her note
  // and how it was paid. The Total journal mixes categories, so there the category travels
  // with the row — otherwise "1 Sep · boxes" is a line with nothing to attach it to.
  const whatOf = (r) => (label || r.what === r.category ? r.what : `${r.category} — ${r.what}`);
  const line = (r) => el("div", { class: "info-row journal-line" },
    el("span", { class: "j-what" },
      `${dayMonth(r.date)} · ${whatOf(r)}${r.method ? ` · ${r.method}` : ""}`),
    el("span", { class: "info-val" }, fmtRM(-r.amount, cur)));

  // The journal as a description, so the paper and the shared text are made from the same
  // rows the screen is showing rather than from a second reading of the books.
  const sheet = journalSheet({
    title: label ? `${label} journal` : "Expenses journal",
    subtitle: `${label || "Every running cost"} · ${monthTitle}`,
    lines: rows.map((r) => ({
      what: `${dayMonth(r.date)} · ${whatOf(r)}${r.method ? ` · ${r.method}` : ""}`,
      amount: -r.amount,
    })),
    totals: [{ label: "Total", amount: -total }],
    empty: `Nothing recorded under ${label || "your running costs"} in ${monthTitle}.`,
    note: rows.length
      ? "These are the rows the line above is made of, each with what it was for and how it was paid. They are recorded on the Money screen (Add an expense), so a correction is made there — and both screens move together, because this is the same list."
      : "It will fill up on its own as you record spending under this category on the Money screen (Add an expense).",
    where: "More → Profit",
    bakery: bakeryName(state),
  });

  showPopup(el("div", { class: "popup-title-row" }, label ? `${label} journal` : "Expenses journal"), () => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `${label || "Every running cost"} · ${monthTitle}`),
    rows.length
      ? el("div", {}, ...rows.map(line))
      // An empty line opens and says so, in her own words and with the month named, rather
      // than the line being dead and looking broken.
      : el("p", { class: "card-sub" },
          `Nothing recorded under ${label || "your running costs"} in ${monthTitle}.`),
    el("div", { class: "info-row pl-total" },
      el("span", {}, "Total"), el("span", { class: "info-val" }, fmtRM(-total, cur))),
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      rows.length
        ? "These are the rows the line above is made of, each with what it was for and how it was paid. They are recorded on the Money screen (Add an expense), so a correction is made there — and both screens move together, because this is the same list."
        : "It will fill up on its own as you record spending under this category on the Money screen (Add an expense)."),
    el("div", { class: "popup-actions" }, ...journalButtons(sheet, cur))));
}

// Sales and Cost of sales are the same order lines read from two sides, so one journal
// serves both — what the customer paid, and what those treats cost to make (2 Oct 2026:
// "at the profit section, can the sales and cost of sales be clickable to reveal its
// journal"). `which` is "sales" or "cost".
function openTradingJournal(state, which, from, to, monthTitle) {
  const cur = state.settings.currency || "RM";
  const sales = which === "sales";
  const name = sales ? "Sales" : "Cost of sales";
  const rows = tradingRows(state, from, to);
  const of = (r) => (sales ? r.sales : -r.cost);
  const total = rows.reduce((s, r) => s + of(r), 0);
  // The one thing a figure cannot say on its own: a line nothing could price, and a line
  // whose recipe prices to nothing — the latter counted as nothing, which is what makes a
  // profit read too high.
  const rider = (r) => (sales ? (r.price == null ? "no price recorded" : "")
    : (r.uncosted ? "no recipe cost" : ""));
  const uncosted = rows.filter((r) => r.uncosted).length;
  const line = (r) => el("div", { class: "info-row journal-line" },
    el("span", { class: "j-what" },
      [`${dayMonth(r.date)} · ${r.what}`, r.customer, rider(r)].filter(Boolean).join(" · ")),
    el("span", { class: "info-val" }, fmtRM(of(r), cur)));

  // The same description the expenses journal carries, so every journal in the app reaches
  // paper and the share sheet the same way.
  const sheet = journalSheet({
    title: `${name} journal`,
    subtitle: `${name} · ${monthTitle}`,
    lines: rows.map((r) => ({
      what: [`${dayMonth(r.date)} · ${r.what}`, r.customer, rider(r)].filter(Boolean).join(" · "),
      amount: of(r),
    })),
    totals: [{ label: "Total", amount: total }],
    empty: sales ? `Nothing was sold in ${monthTitle}.` : `Nothing was baked for sale in ${monthTitle}.`,
    note: sales
      ? "These are the order lines the figure above is made of, each with the customer's own name. A sale counts on the day it is DELIVERED, not the day it was ordered — the same day the day headers and the customer's calendar use. They are recorded in Orders, so a correction is made there; both screens move together, because this is the same list."
      : `These are what those very lines cost to bake, taken from your recipes — not the packs you bought, which are cash on the Money screen and stock on the shelf.${uncosted ? ` ${uncosted} line${uncosted === 1 ? "" : "s"} this month had no recipe cost and was counted as nothing, so check that product's recipe.` : ""}`,
    where: "More → Profit",
    bakery: bakeryName(state),
  });

  showPopup(el("div", { class: "popup-title-row" }, `${name} journal`), () => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" }, `${name} · ${monthTitle}`),
    rows.length
      ? el("div", {}, ...rows.map(line))
      // An empty month opens and says so, rather than the line being dead and reading as
      // a broken screen — the same rule every spending line follows.
      : el("p", { class: "card-sub" }, sales
          ? `Nothing was sold in ${monthTitle}.`
          : `Nothing was made for sale in ${monthTitle}.`),
    el("div", { class: "info-row pl-total" },
      el("span", {}, "Total"), el("span", { class: "info-val" }, fmtRM(total, cur))),
    el("p", { class: "card-sub", style: "margin:10px 0 0" }, sales
      ? "These are the order lines the figure above is made of, each with the customer's own name. A sale counts on the day it is DELIVERED, not the day it was ordered — the same day the day headers and the customer's calendar use. They are recorded in Orders, so a correction is made there; both screens move together, because this is the same list."
      : `These are what those very lines cost to make, taken from your recipes — not the packs you bought, which are cash on the Money screen and stock on the shelf.${uncosted ? ` ${uncosted} line${uncosted === 1 ? "" : "s"} this month had no recipe cost and was counted as nothing, so check that product's recipe.` : ""}`),
    el("div", { class: "popup-actions" }, ...journalButtons(sheet, cur))));
}

// ★★ THE SAME CHOOSER THE MONEY SCREEN AND THE INVOICE HAVE (v403). Her words, after Money:
// __"same thing for Profit"__ — and the reasoning is the same one: a month-at-a-time stepper can pick
// WHICH month but never a DAY or a WEEK, and a week's profit is a question she can ask.
//
// ⭐ `periodSpan` is the invoice's own builder — one function, three screens — so a week means the same
// seven days on all three. ⚠️ It brings the **Sunday** week with it, which is what Home and the invoice
// already use.
//
// ⚠️⚠️ AND THE RULE MONEY KEEPS APPLIES HERE EVEN MORE CLEARLY: **a period that includes today stops at
// today.** A sale counts on the day it is DELIVERED, so a delivery in the future has no sale yet — a
// statement for the rest of this month would claim figures for days that have not happened. A finished
// period is shown whole, because every day of it really did.
let pRange = "month";
let pAnchor = ""; // the day/week/month being looked at; "" follows today

const MODES = [["day", "A day"], ["week", "A week"], ["month", "A month"], ["all", "All"]];

function isoOf(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function pSpan() {
  const today = todayISO();
  if (pRange === "all") return periodSpan("all", today);
  const span = periodSpan(pRange, pAnchor || today);
  const to = span.to > today ? today : span.to;
  if (!span.from || span.from > today) return { from: today, to: today, label: longDate(today) };
  return { from: span.from, to, label: span.label };
}

const canGoForward = () => {
  const today = todayISO();
  if (pRange === "all") return false;
  const span = periodSpan(pRange, pAnchor || today);
  return !!span.from && span.to < today;
};

function stepSpan(dir) {
  const today = todayISO();
  const from = pAnchor || today;
  if (pRange === "day") { pAnchor = addDays(from, dir); return; }
  if (pRange === "week") { pAnchor = addDays(from, dir * 7); return; }
  if (pRange === "month") {
    const d = new Date(`${from}T00:00:00`);
    pAnchor = isoOf(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
}

export function renderProfit(root, state) {
  const cur = state.settings.currency || "RM";

  // `opens` makes a line tappable. EVERY line with rows behind it has it — the spending
  // lines, and since 2 Oct 2026 Sales and Cost of sales too — including one reading 0.00:
  // a line that looks identical to the line above but does nothing when tapped reads as a
  // broken screen, and a 0.00 figure is still a figure worth being able to look into
  // (17 Sep 2026: "in profit the expenses is not clickable, is that a bug?"). An empty
  // line opens and says so.
  const line = (label, amount, cls = "", opens = null) => el("div",
    { class: `info-row pl-row${cls}${opens ? " tappable" : ""}`, onclick: opens || undefined },
    el("span", {}, label),
    el("span", { class: "info-val" }, fmtRM(amount, cur)));

  const draw = (which) => {
    // ⚠️ PICKING A NEW KIND OF WINDOW STARTS AT TODAY AGAIN — stepping back to last November and then
    // tapping "A day" should show today, not the 1st of that November.
    if (which) { pRange = which; pAnchor = ""; }
    // ⚠️ READ FRESH ON EVERY DRAW, never computed once per visit: the arrows were once computed before
    // `draw` ran, so after stepping back the "›" stayed disabled and she could not come forward again —
    // one-way traffic (17 Sep 2026: "the profit month can move earlier but cannot move later").
    const { from, to, label } = pSpan();
    const pl = profitBetween(state, from, to);
    const margin = pl.sales > 0 ? Math.round((pl.gross / pl.sales) * 100) : 0;
    // ⚠️ THE STATEMENT'S OWN SENTENCES SAY THE WINDOW OUT LOUD ("Nothing was sold in …"), so they take
    // the span's label rather than a month name — a day or a week has no month to name.
    const monthTitle = label;

    // The whole statement as one sheet, so the card can leave the screen the way a journal
    // does. "Running costs" is a HEADING rather than a line: the screen leans on the section
    // wording above it, and a page has nothing to lean on — a reader of gross profit has to be
    // told where trading stops and the running costs start (3 Oct 2026).
    const statementSheet = journalSheet({
      title: "Profit and loss",
      subtitle: monthTitle,
      lines: [
        { what: "Sales", amount: pl.sales },
        { what: "Cost of sales", amount: -pl.cost },
        { what: "Gross profit", amount: pl.gross, cls: "pl-total" },
        { what: "Running costs", heading: true },
        ...pl.expenses.map((e) => ({ what: e.label, amount: -e.amount })),
        ...pl.otherExpenses.map((e) => ({ what: e.label, amount: -e.amount })),
        { what: "Total expenses", amount: -pl.expensesTotal, cls: "pl-total" },
        { what: "Net profit", amount: pl.net, cls: "pl-net" },
      ],
      totals: [],
      note: `${COST_OF_SALES_NOTE}\n\n${cashFooter(pl)}`,
      where: "More → Profit",
      bakery: bakeryName(state),
    });

    root.replaceChildren(
      el("h2", { class: "section" }, "Profit"),
      // ★★ WHAT KIND OF WINDOW, AND THEN WHICH ONE (v403) — the same two-part chooser as Money and the
      // invoice, so all three screens ask the same question the same way.
      el("div", { class: "cal-modes" },
        ...MODES.map(([id, text]) => button(text, () => draw(id),
          `ghost small${pRange === id ? " cal-mode-on" : ""}`))),
      // ⚠️ NO ARROWS ON "All" — nothing to step to, and a dead arrow reads as a fault.
      el("div", { class: "range-stepper" },
        pRange === "all" ? null : button("‹", () => { stepSpan(-1); draw(); }, "ghost small range-nav"),
        el("span", { class: "range-label" }, label),
        pRange === "all" || !canGoForward() ? null : button("›", () => { stepSpan(1); draw(); }, "ghost small range-nav")),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "Profit and loss"),
        el("p", { class: "card-sub", style: "margin:0 0 2px" },
          pl.lines ? "Trading · tap a line to see the orders behind it" : "Trading"),
        line("Sales", pl.sales, "",
          () => openTradingJournal(state, "sales", from, to, monthTitle)),
        line("Cost of sales", -pl.cost, "",
          () => openTradingJournal(state, "cost", from, to, monthTitle)),
        line("Gross profit", pl.gross, " pl-total"),
        // The cost-of-sales note goes here, between Gross profit and Running costs, because
        // gross profit must stay adjacent to the figures it qualifies. The bottom footer says
        // the cash half; this says the other half, so neither repeats the other.
        el("p", { class: "card-sub", style: "margin:8px 0 0" }, COST_OF_SALES_NOTE),
        el("p", { class: "card-sub", style: "margin:8px 0 2px" },
          pl.expensesTotal ? "Running costs · tap a line to see the spending behind it" : "Running costs"),
        ...pl.expenses.map((e) => line(e.label, -e.amount, "",
          () => openExpenseJournal(state, e.label, from, to, monthTitle))),
        ...pl.otherExpenses.map((e) => line(e.label, -e.amount, "",
          () => openExpenseJournal(state, e.label, from, to, monthTitle))),
        line("Total expenses", -pl.expensesTotal, " pl-total",
          () => openExpenseJournal(state, null, from, to, monthTitle)),
        line("Net profit", pl.net, " pl-net"),
        el("p", { class: "card-sub", style: "margin:10px 0 0" },
          `${pl.lines} order line${pl.lines === 1 ? "" : "s"} in this month${pl.sales > 0 ? ` · gross margin ${margin}%` : ""}.`),
        // The whole statement leaves the screen from here — the same pair every journal
        // wears, on the card rather than inside a pop-up, because the statement is the one
        // book she is most likely to want to hand to someone (3 Oct 2026).
        el("div", { class: "btn-row" }, ...journalButtons(statementSheet, cur))),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "Your own money"),
        el("p", { class: "card-sub", style: "margin:0 0 8px" },
          "What you put in is capital and what you take out is drawings. Neither is income and neither is a cost — they move cash, and the Money screen is where you check that."),
        line("Capital you put in", pl.capital),
        line("Drawings you took out", -pl.drawings),
        line("In the business so far this month", pl.capital - pl.drawings, " pl-total")),
      el("p", { class: "card-sub", style: "margin:0 2px" }, cashFooter(pl)),
    );
  };

  draw();
}
