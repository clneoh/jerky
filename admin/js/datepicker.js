// datepicker.js — the free date field: the app control that records a day on
// which anything at all may happen (a manual order's order date), as opposed to
// the delivery-day calendar on the Orders screen, which offers only the days the
// bakery actually delivers.
//
// It expands in place, right under the button that names the date — never in a
// pop-up. showPopup() owns one shared #popup-layer and replaces its contents, so
// a calendar opened in a pop-up would wipe out the Edit-order pop-up it was
// opened from. Expanding under the control also reads better on a phone.
//
// Built on the pure grid helpers in calendar.js and painted with the same
// .cal-* rules the More → Delivery Dates screen already uses, so a day looks the
// same wherever the baker meets it.

import { el, button } from "./ui.js";
import { DOW, addMonth, monthLabel, monthWeeks } from "./calendar.js";
import { boxClass, nameDay, occBox, occPapers, tipEl } from "./occgrid.js";
import { longDate, todayISO } from "./dates.js";

// How many months the free date field's arrows reach either way from today.
// Wide enough to record an order she took last week or plan one well ahead,
// narrow enough that the arrows always stop somewhere sensible.
const SPAN = 12;

function monthOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function before(a, b) {
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}

// The month grid. Every day of every month is tappable — this is a free date
// field, so any day at all may be the answer — and the baker's own occasion
// marks are painted on it, the same two shapes every other calendar draws, so a
// date she is recording or a period she is setting is seen against her holidays.
function gridEl(shown, { selected, today, onPick, occasions }) {
  const weeks = monthWeeks(shown.year, shown.month);
  const cells = weeks.flat().map((iso) => {
    if (!iso) return el("span", { class: "cal-cell blank" });
    const dayNum = String(Number(iso.slice(8, 10)));
    const past = iso < today;
    let cls = "cal-cell";
    if (iso === selected) cls += " sel";
    else if (past) cls += " past";
    if (iso === today) cls += " today";
    cls += boxClass(occBox(occasions, iso, past));
    // A day she taps also NAMES itself when it carries a mark — the price of a
    // date field is that the grid folds on the pick, so the name is the field's
    // own bubble (see valSpan) rather than one drawn above the day. `past` is
    // passed as false: a date field records days that have already been, and a
    // holiday an order was taken on is just as worth reading back.
    return el("button", { class: `${cls} tappable`,
      onclick: () => { nameDay(occasions, iso, false); onPick(iso); } }, dayNum);
  });
  return el("div", { class: "cal-grid" },
    ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
    ...cells,
    ...occPapers(occasions, weeks, today));
}

// `value` is an ISO date (or "" when nothing is chosen yet), `lo`/`hi` are the
// months the arrows may reach, and `todayShortcut` adds the one-tap way back to
// today, since hunting for today through a month grid is tiresome otherwise.
function build({ value, format, today, lo, hi, onPick, placeholder, todayShortcut, occasions }) {
  let open = false;
  let current = value || "";
  let shown = monthOf(current || today);

  const shownText = () => (current ? format(current) : placeholder);
  // The date, plus the name of the day it records when that day carries a mark —
  // a holiday she has just chosen as an order's date, or as the end of a product's
  // sell period, says so right on the field. The bubble hangs off the DATE and not
  // off the grid, because picking a day folds the grid: a bubble inside it would
  // never be read. Nothing special makes it disappear — any other tap clears the
  // named day, and this field is rebuilt from that same key on its every repaint.
  const valSpan = () => el("span", { class: "datepick-val" }, shownText(),
    tipEl(occasions, current, false));
  const btn = el("button", {
    class: "btn soft block datepick-btn",
    onclick: () => { open = !open; paint(); },
  }, valSpan(),
    el("span", { class: "datepick-ico", "aria-hidden": "true" }, "📅"));
  const panel = el("div", { class: "datepick-panel" });
  const wrap = el("div", { class: "datepick" }, btn, panel);

  function choose(iso) {
    current = iso;
    shown = monthOf(iso);
    open = false;
    // Repaint before handing over: the caller's own re-render usually replaces
    // this widget, and where it does not (the order-date fields keep their draft
    // and repaint nothing) the label and the folded panel are right anyway.
    paint();
    onPick(iso);
  }

  function paint() {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.replaceChildren(
      valSpan(),
      el("span", { class: "datepick-ico", "aria-hidden": "true" }, "📅"));
    if (!open) {
      panel.replaceChildren();
      return;
    }
    // The arrows stop at the months that actually hold a day, so the baker can
    // never page into an empty month and wonder where the dates went.
    if (before(shown, lo)) shown = { ...lo };
    else if (before(hi, shown)) shown = { ...hi };
    const nav = (delta) => { shown = addMonth(shown.year, shown.month, delta); paint(); };
    const prev = button("‹", () => nav(-1), "ghost small cal-nav");
    const next = button("›", () => nav(1), "ghost small cal-nav");
    if (!before(lo, shown)) prev.disabled = true;
    if (!before(shown, hi)) next.disabled = true;
    panel.replaceChildren(
      el("div", { class: "cal-head" },
        prev,
        el("span", { class: "cal-title" }, monthLabel(shown.year, shown.month)),
        next),
      gridEl(shown, { selected: current, today, onPick: choose, occasions }),
      todayShortcut
        ? el("div", { class: "datepick-foot" }, button("Today", () => choose(today), "ghost small"))
        : null);
  }

  paint();
  return wrap;
}

// A free date field — any day of any month in range is the answer, with a Today
// shortcut, since hunting for today through a month grid is tiresome otherwise.
// `occasions` is the baker's occasion marks (state.occasions), drawn on the grid
// so a date is chosen against her holidays; a caller with no state to hand simply
// leaves it out and gets a plain calendar.
export function dateField(value, onPick, { placeholder = "Choose a date…", occasions = [] } = {}) {
  const today = todayISO();
  const t = monthOf(today);
  return build({
    value,
    format: longDate,
    today,
    lo: addMonth(t.year, t.month, -SPAN),
    hi: addMonth(t.year, t.month, SPAN),
    onPick,
    placeholder,
    todayShortcut: true,
    occasions,
  });
}
