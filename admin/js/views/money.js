// views/money.js — what came in, and how (16 Sep 2026). She asked for a way to
// reconcile: some customers pay cash, some by TNG, and the two are checked against
// different things — a purse and a phone. The maths lives in js/money.js, the same
// module the Orders day header reads, so the two can never disagree; this screen
// only draws it.

import { el, button } from "../ui.js";
import { fmtRM } from "../state.js";
import { moneyBetween } from "../money.js";
import { longDate, todayISO, weekdayName } from "../dates.js";

// Which stretch is showing. Module scope, like the other screens' own pickers, so a
// rebuild she did not ask for does not throw her back to Today.
let range = "today";

const RANGES = [["today", "Today"], ["week", "This week"], ["month", "This month"]];

function isoOf(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// "14 Sep" — the date without the year, for the range line.
function dayMonth(iso) {
  return longDate(iso).slice(0, -5);
}

// The stretch a choice covers, always ending today: a week or a month that is still
// running is counted up to now, not to a day in the future.
function spanFor(which) {
  const today = todayISO();
  if (which === "today") return { from: today, to: today, label: `${weekdayName(today)}, ${dayMonth(today)}` };
  const d = new Date(`${today}T00:00:00`);
  const from = isoOf(which === "week"
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) // Monday first
    : new Date(d.getFullYear(), d.getMonth(), 1));
  return { from, to: today, label: from === today ? `${weekdayName(today)}, ${dayMonth(today)}` : `${dayMonth(from)} – ${dayMonth(today)}` };
}

export function renderMoney(root, state) {
  const cur = state.settings.currency || "RM";
  const row = (label, value, extra) => el("div", { class: "info-row" },
    el("span", {}, label),
    el("span", { class: "info-val" }, fmtRM(value, cur),
      extra ? el("span", { class: "muted" }, `  ${extra}`) : null));

  const draw = (which) => {
    range = which;
    const { from, to, label } = spanFor(range);
    const m = moneyBetween(state, from, to);
    root.replaceChildren(
      el("h2", { class: "section" }, "Money"),
      el("div", { class: "cal-modes" },
        ...RANGES.map(([id, text]) => button(text, () => draw(id),
          `ghost small${range === id ? " cal-mode-on" : ""}`))),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, label),
        m.count ? null : el("p", { class: "card-sub", style: "margin:0 0 8px" },
          "No orders in this stretch."),
        row("Cash collected", m.cash),
        row("TNG collected", m.tng),
        row("Paid, no method", m.unmarked),
        row("Still to collect", m.toCollect,
          m.toCollectCount ? `(${m.toCollectCount} order${m.toCollectCount === 1 ? "" : "s"})` : "")),
      el("p", { class: "card-sub", style: "margin:0 2px" },
        "Money collected is counted by the day it landed: an order paid by transfer today counts today, even if it delivers on Friday. Still to collect counts the orders whose delivery day falls in this stretch, so it is what you are about to hand over. An order paid before you started recording cash or TNG shows under Paid, no method."),
    );
  };

  draw(range);
}
