// views/profit.js — the books, as a statement (16 Sep 2026). She asked for it as
// accounting software, so it reads like one: a month at a time, sales down to what
// was left, with the owner's own money kept out of the trading figures entirely.
// The arithmetic lives in js/profit.js, next to the cash side it must never be
// confused with.

import { el, button, showPopup } from "../ui.js";
import { fmtRM } from "../state.js";
import { monthSpan, profitBetween, expenseRows } from "../profit.js";
import { longDate } from "../dates.js";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// "14 Sep" — a journal line needs the day, not the year.
const dayMonth = (iso) => longDate(String(iso).slice(0, 10)).slice(0, -5);

// A statement line is a total, and a total nobody can open is a figure to be trusted on
// faith. Tap it and the rows it is made of are here — the same rows the Money screen
// wrote, so the two screens can never disagree (17 Sep 2026: "the expenses items in
// Profit & Loss should reveal its journals"). `label` null = the Total expenses line,
// which is every running cost in the month at once.
function openExpenseJournal(state, label, from, to, monthTitle) {
  const cur = state.settings.currency || "RM";
  const rows = expenseRows(state, from, to, label);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const line = (r) => el("div", { class: "info-row journal-line" },
    el("span", { class: "j-what" },
      `${dayMonth(r.date)} · ${r.what}${r.method ? ` · ${r.method}` : ""}`),
    el("span", { class: "info-val" }, fmtRM(-r.amount, cur)));

  showPopup(el("div", { class: "popup-title-row" }, label ? `${label} journal` : "Expenses journal"), () => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `${label || "Every running cost"} · ${monthTitle}`),
    rows.length
      ? el("div", {}, ...rows.map(line))
      : el("p", { class: "card-sub" }, "Nothing recorded here this month."),
    el("div", { class: "info-row pl-total" },
      el("span", {}, "Total"), el("span", { class: "info-val" }, fmtRM(-total, cur))),
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      "These are the rows the line above is made of, each with what it was for and how it was paid. They are recorded on the Money screen (Add an expense), so a correction is made there — and both screens move together, because this is the same list.")));
}

// The month on screen, as { year, month } — module scope, like the other screens'
// own pickers, so a rebuild she did not ask for does not move the month.
let shown = null;

function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function renderProfit(root, state) {
  const cur = state.settings.currency || "RM";
  if (!shown) shown = currentMonth();
  const now = currentMonth();
  const canNext = shown.year < now.year || (shown.year === now.year && shown.month < now.month);

  // `opens` makes a line tappable — a spending line with nothing in it is not, since
  // there would be no rows behind it to show.
  const line = (label, amount, cls = "", opens = null) => el("div",
    { class: `info-row pl-row${cls}${opens ? " tappable" : ""}`, onclick: opens || undefined },
    el("span", {}, label),
    el("span", { class: "info-val" }, fmtRM(amount, cur)));

  const draw = (year, month) => {
    shown = { year, month };
    const { from, to } = monthSpan(shown.year, shown.month);
    const pl = profitBetween(state, from, to);
    const margin = pl.sales > 0 ? Math.round((pl.gross / pl.sales) * 100) : 0;
    const monthTitle = `${MONTHS[shown.month]} ${shown.year}`;

    const move = (delta) => {
      const d = new Date(shown.year, shown.month + delta, 1);
      // Never past this month: there are no numbers after today.
      if (d.getFullYear() > now.year || (d.getFullYear() === now.year && d.getMonth() > now.month)) return;
      draw(d.getFullYear(), d.getMonth());
    };

    root.replaceChildren(
      el("h2", { class: "section" }, "Profit"),
      el("div", { class: "cal-head" },
        button("‹", () => move(-1), "ghost small cal-nav"),
        el("span", { class: "cal-title" }, `${MONTHS[shown.month]} ${shown.year}`),
        (() => { const b = button("›", () => move(1), "ghost small cal-nav"); if (!canNext) b.disabled = true; return b; })()),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "Profit and loss"),
        line("Sales", pl.sales),
        line("Cost of sales", -pl.cost),
        line("Gross profit", pl.gross, " pl-total"),
        el("p", { class: "card-sub", style: "margin:8px 0 2px" },
          pl.expensesTotal ? "Running costs · tap a line to see the spending behind it" : "Running costs"),
        ...pl.expenses.map((e) => line(e.label, -e.amount, "",
          e.amount ? () => openExpenseJournal(state, e.label, from, to, monthTitle) : null)),
        ...pl.otherExpenses.map((e) => line(e.label, -e.amount, "",
          e.amount ? () => openExpenseJournal(state, e.label, from, to, monthTitle) : null)),
        line("Total expenses", -pl.expensesTotal, " pl-total",
          pl.expensesTotal ? () => openExpenseJournal(state, null, from, to, monthTitle) : null),
        line("Net profit", pl.net, " pl-net"),
        el("p", { class: "card-sub", style: "margin:10px 0 0" },
          `${pl.lines} order line${pl.lines === 1 ? "" : "s"} in this month${pl.sales > 0 ? ` · gross margin ${margin}%` : ""}.`)),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "Your own money"),
        el("p", { class: "card-sub", style: "margin:0 0 8px" },
          "What you put in is capital and what you take out is drawings. Neither is income and neither is a cost — they move cash, and the Money screen is where you check that."),
        line("Capital you put in", pl.capital),
        line("Drawings you took out", -pl.drawings),
        line("In the business so far this month", pl.capital - pl.drawings, " pl-total")),
      el("p", { class: "card-sub", style: "margin:0 2px" },
        `Ingredient cost is what the making cost, from your recipes — so a pack bought today counts as the treats made from it are sold, not all at once. Sales are counted by the day you post. ${pl.uncosted ? `${pl.uncosted} line${pl.uncosted === 1 ? "" : "s"} this month had no recipe cost and was counted as nothing — check that product's recipe. ` : ""}Your own unpaid hours are not costed on their own: either pay yourself a Salary (you), with EPF and SOCSO as their own category, or mark Labour as a not-bought ingredient (More → Ingredients) and put the hours into the recipes. Count them one way, never both.`),
    );
  };

  draw(shown.year, shown.month);
}
