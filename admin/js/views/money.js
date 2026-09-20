// views/money.js — what came in, what went out, and what is still to come
// (16 Sep 2026). She asked for a way to reconcile: customers pay cash or by TNG,
// and the app should tell her what should be in her purse and on her phone. The
// maths lives in js/money.js — the same module the Orders day header reads, so the
// two can never disagree; this screen only draws it.

import { el, button, select, showPopup, toast, confirmDialog } from "../ui.js";
import { byId, fmtRM, newId, round2, save } from "../state.js";
import { depositsBetween, expensesBetween, journalFor, moneyBetween, otherMethods, pocketOwed } from "../money.js";
import { categoriesOf, categoryLabels, drawingLabel, isCash, isTng, methodLabel, methodRank, methodsOf, pocketMethods, purseMethods } from "../accounts.js";
import { entryForm, newEntryChip } from "./accountsEditor.js";
// An ingredient's own unit, resolved exactly as the Ingredients screen resolves it, so a
// stock count typed here lands as the same number of grams the On-hand line shows.
import { currentUomId, cookingFamilyOf } from "./ingredients.js";
import { dateField } from "../datepicker.js";
import { longDate, todayISO, weekdayName } from "../dates.js";
import { clearCourierCharge } from "../courier.js";
import { maybePublishTracking, maybeSync } from "../supabase.js";

// Which stretch is showing. Module scope, like the other screens' own pickers, so a
// rebuild she did not ask for does not throw her back to Today.
let range = "today";

const RANGES = [["today", "Today"], ["week", "This week"], ["month", "This month"]];

function isoOf(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// "14 Sep" — the date without the year, for a range line or an expense row.
function dayMonth(iso) {
  return longDate(iso).slice(0, -5);
}

// The stretch a choice covers, always ending today: a week or a month still running
// is counted up to now, not to a day in the future.
function spanFor(which) {
  const today = todayISO();
  if (which === "today") return { from: today, to: today, label: `${weekdayName(today)}, ${dayMonth(today)}` };
  const d = new Date(`${today}T00:00:00`);
  const from = isoOf(which === "week"
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) // Monday first
    : new Date(d.getFullYear(), d.getMonth(), 1));
  return { from, to: today, label: from === today ? `${weekdayName(today)}, ${dayMonth(today)}` : `${dayMonth(from)} – ${dayMonth(today)}` };
}

// One method's book, as a block: every movement that way in the stretch, in order,
// ending on what it should hold. Built as a block rather than a pop-up so it can be
// shown in two places — as a book of its own, and inside the Books list, where opening a
// second window would wipe the list she is reading (the app has one shared pop-up layer).
function journalBody(state, method, from, to, label) {
  const cur = state.settings.currency || "RM";
  const j = journalFor(state, method, from, to);
  const where = isCash(method) ? "what should be in your purse"
    : isTng(method) ? "what should be on your phone"
      : "kept out of the purse and phone figures, because the money did not move through either";
  // The label takes what room it needs and wraps; the figure never shrinks or
  // collides with it — a journal line that reads "BeeRM 30.00" is no use to anyone.
  const line = (r) => el("div", { class: "info-row journal-line" },
    el("span", { class: "j-what" }, `${dayMonth(r.date)} · ${r.what}`),
    el("span", { class: "info-val" }, `${r.dir === "in" ? "" : "−"}${fmtRM(r.amount, cur)}`));

  return el("div", {},
    j.rows.length
      ? el("div", {}, ...j.rows.map(line))
      : el("p", { class: "card-sub" }, "Nothing moved this way in this stretch."),
    el("div", { class: "info-row pl-total" },
      el("span", {}, "In"), el("span", { class: "info-val" }, fmtRM(j.inTotal, cur))),
    el("div", { class: "info-row pl-total" },
      el("span", {}, "Out"), el("span", { class: "info-val" }, fmtRM(-j.outTotal, cur))),
    el("div", { class: "info-row pl-net" },
      el("span", {}, "Net"), el("span", { class: "info-val" }, fmtRM(j.net, cur))),
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      `${label} is ${where}. Every order paid that way, everything you spent out of it and anything of your own you put in is listed above — the same rows the totals on the Money screen are made of.`));
}

// One method's book on its own, opened by tapping a money row — "how can i see the TnG
// journal and the Cash journal?" (16 Sep 2026) — because those rows are already the
// totals of exactly these movements.
function openJournal(state, method, from, to, label) {
  showPopup(el("div", { class: "popup-title-row" }, `${label} journal`),
    () => el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 10px" }, label),
      journalBody(state, method, from, to, label)));
}

// Day one — where she stands when the books begin (17 Sep 2026: "we need to enter opening
// balance"). An opening balance is four answers, and three of them belong on one screen: the
// cash in the tin, the money on her phone, and what is on the shelf. The fourth — who still
// owes her — needs no box: those orders simply stay unpaid and show under Still to collect,
// so the form says so rather than asking for a figure.
//
// Nothing here is new machinery. The two money boxes write ordinary money-in rows (the same
// rows section 3 of the manual tells her to write by hand), so from that day on the Net is
// what she should really hold; the stock boxes set each ingredient's On hand, which is the
// figure the shopping lists subtract. A box left empty changes nothing — she types only what
// she is holding.
function openDayOne(state, redraw) {
  const cur = state.settings.currency || "RM";
  const list = (state.ingredients || [])
    .filter((i) => i && i.active !== false && i.notPurchased !== true)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const money = (label, hint) => {
    const box = el("input", { class: "input", type: "number", inputmode: "decimal",
      min: "0", step: "0.01", placeholder: "RM", "aria-label": label });
    return { box, field: el("div", { class: "field" }, el("label", {}, label), box,
      hint ? el("p", { class: "hint" }, hint) : null) };
  };
  const cash = money("Cash in your tin");
  const tng = money("Money on your phone (TNG)");
  let date = todayISO();
  const datePick = dateField(date, (iso) => { date = iso; });

  // One row per ingredient: a box in the unit she already thinks in, with the unit offered so
  // "5" cannot quietly become five grams.
  const rows = list.map((ing) => {
    const family = cookingFamilyOf(state.uoms || [], currentUomId(state, ing));
    const units = (state.uoms || []).filter((u) => u.family === family)
      .sort((a, b) => Number(a.toBase) - Number(b.toBase));
    const chosen = units.find((u) => u.id === currentUomId(state, ing)) || units[0] || { id: "", name: ing.unit || "unit" };
    // The unit she settles on lives here, not on the node: reading it back off the <select>
    // happens to work in a browser and does not everywhere else.
    let chosenId = chosen.id;
    const num = el("input", { class: "input", type: "number", inputmode: "decimal", min: "0",
      step: "any", placeholder: "0", "aria-label": `${ing.name} on hand`, style: "flex:0 0 96px" });
    const unitSel = units.length > 1
      ? select(units.map((u) => ({ value: u.id, label: u.name })), chosenId, () => { chosenId = unitSel.value; })
      : el("span", { class: "muted" }, chosen.name);
    return {
      ing, num, unitSel,
      toBase: () => Number(byId(state.uoms || [], chosenId)?.toBase) || 1,
      node: el("div", { class: "info-row", style: "gap:8px" },
        el("span", {}, ing.name),
        el("span", { style: "display:flex;gap:6px;align-items:center" }, num, unitSel)),
    };
  });

  showPopup(el("div", { class: "popup-title-row" }, "Day one"), (refresh, close) => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Where you stand the day your books begin. Fill in what you have and leave the rest blank — anything you leave empty is left exactly as it is."),
    cash.field,
    tng.field,
    el("div", { class: "field" }, el("label", {}, "The day your books begin"), datePick,
      el("p", { class: "hint" }, `The Money screen counts by the stretch on screen, so an opening balance dated outside it will not show in that stretch's Net.`)),
    list.length
      ? el("div", {},
          el("p", { class: "card-sub", style: "margin:10px 0 2px" }, "What is on your shelf"),
          el("p", { class: "hint", style: "margin:0 0 8px" },
            "Your shopping lists subtract this, so your first list buys only what you are short of."),
          ...rows.map((r) => r.node))
      : el("p", { class: "card-sub" }, "No ingredients yet — add them under More → Ingredients and come back."),
    el("p", { class: "card-sub", style: "margin:12px 0 0" },
      "Customers who still owe you need nothing here: leave those orders unpaid and they show under Still to collect. Money you OWE — a loan you took out for equipment — has nowhere to go on purpose: the app keeps a loan as a way of paying, so record what it pays for as it happens."),
    el("div", { class: "popup-actions" },
      button("Cancel", close, "ghost"),
      button("Save day one", () => {
        const cashVal = cash.box.value.trim() === "" ? 0 : Number(cash.box.value);
        const tngVal = tng.box.value.trim() === "" ? 0 : Number(tng.box.value);
        const bad = [];
        if (!Number.isFinite(cashVal) || cashVal < 0) bad.push("the cash in your tin");
        if (!Number.isFinite(tngVal) || tngVal < 0) bad.push("the money on your phone");
        // Type-check every stock box BEFORE writing anything, so a slip half way down does not
        // leave half an opening balance saved.
        const stock = [];
        for (const r of rows) {
          if (r.num.value.trim() === "") continue;
          const v = Number(r.num.value);
          if (!Number.isFinite(v) || v < 0) bad.push(r.ing.name);
          else stock.push({ r, v });
        }
        if (bad.length) return toast(`Check these: ${bad.join(", ")}`);
        if (!cashVal && !tngVal && !stock.length) {
          return toast("Type what you are starting with, or tap Cancel");
        }
        const note = "Opening balance";
        state.deposits = Array.isArray(state.deposits) ? state.deposits : [];
        if (cashVal > 0) state.deposits.push({ id: newId("dep"), date, amount: cashVal, method: "Cash", note });
        if (tngVal > 0) state.deposits.push({ id: newId("dep"), date, amount: tngVal, method: "TNG", note });
        for (const { r, v } of stock) r.ing.onHand = round2(v * r.toBase());
        save(state);
        maybeSync(state);
        const bits = [];
        if (cashVal > 0) bits.push(`${fmtRM(cashVal, cur)} cash`);
        if (tngVal > 0) bits.push(`${fmtRM(tngVal, cur)} TNG`);
        if (stock.length) bits.push(`${stock.length} ingredient${stock.length === 1 ? "" : "s"}`);
        toast(`Day one saved: ${bits.join(", ")}`);
        close();
        redraw();
      }, "primary"))));
}

// Every way she pays, one book each — always reachable, however quiet the stretch. The
// rows on the money card are read off what MOVED, so a pocket that did nothing has no row
// there and its book would be unreachable; this is the door that never closes (17 Sep
// 2026: "where can i find pocket journals"). Tapping a line opens that book UNDER the
// line, in place: a second pop-up would wipe the list she is reading.
function openBooks(state, from, to, stretchLabel) {
  const cur = state.settings.currency || "RM";
  // Every way she has on her list, plus any way that moved here but is no longer on it —
  // a method she renamed still has money in the books, so it still gets a door.
  const moved = new Set();
  for (const t of [moneyBetween(state, from, to), depositsBetween(state, from, to), expensesBetween(state, from, to)]) {
    for (const label of (t.byMethod ? t.byMethod.keys() : [])) moved.add(label);
  }
  const labels = [...new Set([...methodsOf(state), ...moved])]
    .filter(Boolean)
    .sort((a, b) => methodRank(state, a) - methodRank(state, b) || a.localeCompare(b));

  let open = labels.find((m) => journalFor(state, m, from, to).rows.length) || null;
  const body = el("div", {});

  const draw = () => {
    // replaceChildren takes the nodes as given — unlike el(), it has no null filter, so a
    // bare null child prints the word "null" on the screen. Keep the filter.
    const lines = labels.flatMap((m) => {
      const j = journalFor(state, m, from, to);
      const isOpen = open === m;
      return [
        el("div", { class: `info-row tappable${isOpen ? " book-open" : ""}`,
          onclick: () => { open = isOpen ? null : m; draw(); } },
          el("span", {}, m),
          el("span", { class: "info-val" }, fmtRM(j.net, cur),
            el("span", { class: "muted", style: "margin-left:6px" }, isOpen ? "close" : "book"))),
        isOpen ? el("div", { class: "book-page" }, journalBody(state, m, from, to, m)) : null,
      ];
    }).filter((n) => n != null);

    body.replaceChildren(
      el("p", { class: "card-sub", style: "margin:0 0 4px" },
        "A book for every way you pay — Cash, TNG, a loan, someone's own pocket, and any method you add later. Tap a line to read it: every order paid that way, what you spent out of it, and anything of your own that went in."),
      el("p", { class: "card-sub", style: "margin:0 0 8px" }, stretchLabel),
      ...lines,
      el("p", { class: "card-sub", style: "margin:8px 0 0" },
        "Every figure here is a figure off the Money screen's own rows, so this list and those totals can never disagree."));
  };
  draw();
  showPopup(el("div", { class: "popup-title-row" }, "Books"), () => body);
}

// Everything on the two lists, as a list of its own: tap a line to rename it, change
// what kind it is, or delete it. Opened from the line under the money cards, because
// this is where the spending is — a separate Settings card was the wrong home
// (16 Sep 2026: "dont put the setting separately, it should be at where it suppose to
// be"). The ＋ chips on the forms still add one on the spot.
function openListsManager(state, redraw) {
  // One editor at a time, in place of the line it is editing: no second pop-up, and
  // she can see the rest of the list while she works.
  let editing = null; // { kind, label } | { kind, label: "" } for a new one
  const body = el("div", {});
  const done = () => { editing = null; redraw(); show(); };

  const show = () => {
    const cats = categoriesOf(state); // { label, cls } — the labels alone carry no kind
    const methods = methodsOf(state);
    const row = (label, note, kind) => (
      editing && editing.kind === kind && editing.label === label
        ? entryForm(state, { kind, current: label, onDone: done })
        : el("div", { class: "info-row tappable", onclick: () => { editing = { kind, label }; show(); } },
            el("span", {}, label), el("span", { class: "info-val" },
              el("span", { class: "muted" }, `  ${note}`),
              el("span", { class: "muted", style: "margin-left:6px" }, "edit"))));

    body.replaceChildren(
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "What an expense was for, and how the money moved. Tap a line to rename it, change what kind it is, or delete it."),
      el("h3", { style: "margin:0 0 4px" }, "Categories"),
      ...cats.map((c) => row(c.label, c.cls === "stock" ? "ingredients"
        : c.cls === "drawing" ? "your own money" : "running cost", "category")),
      el("div", { class: "btn-row", style: "margin-top:8px" },
        editing && editing.kind === "category" && !editing.label
          ? entryForm(state, { kind: "category", current: "", onDone: done })
          : newEntryChip("category", () => { editing = { kind: "category", label: "" }; show(); })),
      el("h3", { style: "margin:16px 0 4px" }, "Ways to pay"),
      ...methods.map((m) => row(m, isCash(m) || isTng(m) ? "in your purse or phone" : "not from the purse", "method")),
      el("div", { class: "btn-row", style: "margin-top:8px" },
        editing && editing.kind === "method" && !editing.label
          ? entryForm(state, { kind: "method", current: "", onDone: done })
          : newEntryChip("method", () => { editing = { kind: "method", label: "" }; show(); })));
  };
  show();
  showPopup(el("div", { class: "popup-title-row" }, "Categories & ways to pay"), () => body);
}

// One entry in a money list. A spending row from a shopping run says so by its poId;
// everything else shows the category she picked, and a money-in row shows her note
// ("from my pocket") or the word that stands in for it.
//
// A courier charge is the one row that is not a row of its own: it is the books half of
// something the ORDER owns, so deleting it takes the charge off the order as well, and
// the confirmation says so before she agrees (19 Sep 2026). Deleting the row by itself
// left the order wearing a charge that was no longer in her books, and the next Save in
// the order's courier box put the row straight back.
function pocketRow(state, e, what, listKey, redraw, cur) {
  const how = methodLabel(e.method) || "no method";
  const courier = listKey === "expenses" && e.courierFor ? e.courierFor : "";
  return el("div", { class: "info-row" },
    el("span", {}, `${dayMonth(String(e.date))} · ${what}${e.note ? ` · ${e.note}` : ""}`),
    el("span", { class: "info-val" }, fmtRM(Number(e.amount) || 0, cur),
      el("span", { class: "muted" }, `  ${how}`),
      button("✕", () => confirmDialog(
        `Delete this ${listKey === "deposits" ? "money-in record" : "expense"}? ${fmtRM(Number(e.amount) || 0, cur)} — ${what}, ${how}.`
          + (courier ? ` The courier charge comes off order #${courier} with it.` : ""),
        () => {
          state[listKey] = (state[listKey] || []).filter((x) => x.id !== e.id);
          // A charge you paid lives in two places at once, so it has to leave both at
          // once. The customer's total moves with it, which is why the card is offered
          // the new version here exactly as the order's own box does.
          const cleared = courier ? clearCourierCharge(state, courier) : null;
          save(state);
          maybeSync(state);
          if (cleared) maybePublishTracking(state, cleared);
          toast(courier
            ? `Charge deleted, and taken off order #${courier}`
            : (listKey === "deposits" ? "Money-in record deleted" : "Expense deleted"));
          redraw();
        }, { danger: true, yesLabel: "Delete" }), "ghost small")));
}
const expenseRow = (state, e, redraw, cur) =>
  pocketRow(state, e, e.poId ? "Shopping run (PO)"
    : e.courierFor ? `Courier (order #${e.courierFor})`   // the same words the journal uses
    : (e.category || "Expense"), "expenses", redraw, cur);
const depositRow = (state, e, redraw, cur) =>
  pocketRow(state, e, e.repay ? "Paid back by the till" : "From my pocket", "deposits", redraw, cur);

// One row of pills built from a list of names, ending in a ＋ chip that adds a new
// one there and then (16 Sep 2026 — she asked why she could not find how to add a
// category, and the answer was that it was only in Settings).
//
// `current` is marked, `onPick` is told what she taps, and the chip's `onAdded` puts
// the new name straight into the caller's own state and reopens the form's body —
// which rebuilds these pills with the new one already picked.
function pillRow(names, current, onPick, { addKind, state, onAdded } = {}) {
  // `pill-row`, not `cal-modes`: the list is as long as she makes it, so the pills wrap.
  const wrap = el("div", { class: "pill-row" });
  const mark = (label) => {
    for (const b of wrap.children) {
      if (b.tagName === "BUTTON") b.classList.toggle("cal-mode-on", b.textContent === label);
    }
  };
  for (const name of names) {
    wrap.append(button(name, () => { onPick(name); mark(name); },
      `ghost small${name === current ? " cal-mode-on" : ""}`));
  }
  if (addKind) wrap.append(newEntryChip(addKind, () => { if (onAdded) onAdded(null); }));
  return wrap;
}

// The Paid-by row of a money form: one pill per method on HER list — Cash, TNG, Loan,
// and whatever she adds. The list itself lives in js/accounts.js.
export function methodPills(state, current, onPick, refresh) {
  return pillRow(methodsOf(state), current, onPick, {
    addKind: "method", state,
    onAdded: (label) => { onPick(label); refresh(); },
  });
}

// The Add an expense form: everything the PO never sees — packaging, gas, a market
// top-up, a new tray. Its own small pop-up, opened from the screen it lands on.
function openExpenseForm(state, redraw) {
  const amount = el("input", { class: "input", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "Amount" });
  // Her own chart and her own list, read as the form opens; both are rebuilt when a
  // ＋ chip adds something, while what she has already typed stays put (the inputs
  // are made once, outside the body, and the body re-appends them).
  let category = categoryLabels(state).includes("Packaging") ? "Packaging" : (categoryLabels(state)[0] || "Other");
  let method = methodsOf(state)[0] || "Cash";
  let adding = null; // "category" | "method" while the inline ＋ form is open
  const note = el("input", { class: "input", placeholder: "e.g. Mydin run, 2 boxes", value: "" });
  let date = todayISO();
  const datePick = dateField(date, (iso) => { date = iso; });

  showPopup(el("div", { class: "popup-title-row" }, "Add an expense"), (refresh, close) => el("div", {},
    el("div", { class: "field" }, el("label", {}, "What did you spend?"), amount),
    el("div", { class: "field" }, el("label", {}, "What for"),
      adding === "category" ? null : pillRow(categoryLabels(state), category, (c) => { category = c; },
        { addKind: "category", state, onAdded: () => { adding = "category"; refresh(); } }),
      adding === "category"
        ? entryForm(state, { kind: "category", onDone: (label) => {
            if (label) category = label; // pick what she just made, and carry on
            adding = null;
            refresh();
          } })
        : null),
    el("div", { class: "field" }, el("label", {}, "Paid by"),
      adding === "method" ? null : methodPills(state, method, (m) => { method = m; },
        () => { adding = "method"; refresh(); }),
      adding === "method"
        ? entryForm(state, { kind: "method", onDone: (label) => {
            if (label) method = label;
            adding = null;
            refresh();
          } })
        : null),
    el("div", { class: "field" }, el("label", {}, "The day you paid it"), datePick),
    el("div", { class: "field" }, el("label", {}, "A note (optional)"), note),
    el("div", { class: "popup-actions" },
      button("Cancel", close, "ghost"),
      button("Save", () => {
        const value = Number(amount.value);
        if (!amount.value.trim() || !Number.isFinite(value) || value < 0) {
          return toast("Type how much you spent");
        }
        state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
        state.expenses.push({ id: newId("exp"), date, amount: value, category,
          method, note: note.value.trim() });
        save(state);
        maybeSync(state);
        toast(`Money out: ${fmtRM(value, state.settings.currency)}`);
        close();
        redraw();
      }, "primary"))));
}

// "Put money in" — the other side of a pocket list (16 Sep 2026). A packet of meat
// paid from your own purse before any orders came in, or a float of change for the
// day: it goes in here, and comes back out later as an ordinary expense with the
// "My own withdrawal" category.
function openMoneyInForm(state, redraw) {
  const amount = el("input", { class: "input", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "How much you put in" });
  const note = el("input", { class: "input", placeholder: "e.g. from my pocket for the meat",
    value: "", oninput: function () { /* read at save */ } });
  let method = methodsOf(state)[0] || "Cash";
  let adding = false;
  let date = todayISO();
  const datePick = dateField(date, (iso) => { date = iso; });

  showPopup(el("div", { class: "popup-title-row" }, "Put money in"), (refresh, close) => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Money of your own that went into the business — it counts into the money in for the day, and you can take it back out later with Add an expense → My own withdrawal."),
    el("div", { class: "field" }, el("label", {}, "How much?"), amount),
    el("div", { class: "field" }, el("label", {}, "Paid in as"),
      adding ? null : methodPills(state, method, (m) => { method = m; }, () => { adding = true; refresh(); }),
      adding ? entryForm(state, { kind: "method", onDone: (label) => {
        if (label) method = label;
        adding = false;
        refresh();
      } }) : null),
    el("div", { class: "field" }, el("label", {}, "The day you put it in"), datePick),
    el("div", { class: "field" }, el("label", {}, "What it was for (optional)"), note),
    el("div", { class: "popup-actions" },
      button("Cancel", close, "ghost"),
      button("Save", () => {
        const value = Number(amount.value);
        if (!amount.value.trim() || !Number.isFinite(value) || value < 0) {
          return toast("Type how much you put in");
        }
        state.deposits = Array.isArray(state.deposits) ? state.deposits : [];
        state.deposits.push({ id: newId("dep"), date, amount: value, method, note: note.value.trim() });
        save(state);
        maybeSync(state);
        toast(`Money in: ${fmtRM(value, state.settings.currency)} of your own`);
        close();
        redraw();
      }, "primary"))));
}

// Pay a personal pocket back out of the till (17 Sep 2026). When a pocket of hers —
// Kean's, Suan's, or one she adds — pays for something, that money left the pocket and
// never went near the till, so its line on the Money screen reads what the pocket is
// owed. Paying it back is two movements, and doing them by hand is the sort of thing a
// busy morning gets wrong. So this form writes both at once:
//   • an expense out of the purse or the phone, under her own drawings category — a
//     drawing, so it never counts as a cost and the profit statement does not move;
//   • a money-in row for that pocket, marked `repay`, which clears the pocket's line.
// Two rows rather than a new kind of record is deliberate: every screen she already
// reads — both lists, the journals, the statement, the backups — understands them as
// they are, so a payback is exactly the two entries she would have made herself.
function openPayBackForm(state, from, to, redraw, label) {
  const cur = state.settings.currency || "RM";
  const pockets = pocketMethods(state);
  const purse = purseMethods(state);
  if (!pockets.length || !purse.length) return;

  const owed = () => pocketOwed(state, pocket, from, to);
  // Open on the pocket that is actually owed something — that is the one she came here
  // to pay. Failing that, the first pocket she has.
  let pocket = pockets.find((m) => pocketOwed(state, m, from, to) > 0) || pockets[0];
  let outOf = purse.find(isCash) || purse[0]; // the cash register by default
  let date = todayISO();

  const amount = el("input", { class: "input", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "How much you are paying back",
    value: owed() > 0 ? String(owed()) : "" });
  const note = el("input", { class: "input", placeholder: "e.g. the packaging you paid for",
    value: "" });
  const datePick = dateField(date, (iso) => { date = iso; });
  const body = el("div", {});

  // The pocket's own pills: picking one pre-fills what it is owed, unless she has already
  // typed a figure — hers wins.
  const pick = (m) => {
    pocket = m;
    amount.value = owed() > 0 ? String(owed()) : "";
    paint();
  };

  const paint = () => {
    const due = owed();
    body.replaceChildren(
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "A pocket of yours paid for something, so the money left you rather than the till — its line on the Money screen says what it is owed. This takes the money out of the till and clears that line in one go. It is your own money going back to you: never a cost, so your profit does not move."),
      el("div", { class: "field" }, el("label", {}, "Which pocket?"),
        el("div", { class: "pill-row" },
          ...pockets.map((m) => button(m, () => pick(m),
            `ghost small${m === pocket ? " cal-mode-on" : ""}`)),
          newEntryChip("method", () => { adding = true; paint(); })),
        adding
          ? entryForm(state, { kind: "method", onDone: (newLabel) => {
              if (newLabel) pocket = newLabel;
              adding = false;
              paint();
            } })
          : null),
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        due > 0
          ? `${pocket} is owed ${fmtRM(due, cur)} for ${label}.`
          : `${pocket} is not owed anything${label ? ` for ${label}` : ""} right now — you can still record a payment if you need to.`),
      el("div", { class: "field" }, el("label", {}, "How much are you paying back?"), amount),
      el("div", { class: "field" }, el("label", {}, "Paid out of"),
        el("div", { class: "pill-row" },
          ...purse.map((m) => button(m, () => { outOf = m; paint(); },
            `ghost small${m === outOf ? " cal-mode-on" : ""}`)))),
      el("div", { class: "field" }, el("label", {}, "The day you paid it back"), datePick),
      el("div", { class: "field" }, el("label", {}, "What it was for (optional)"), note),
      el("div", { class: "popup-actions" },
        button("Cancel", () => closePopup(), "ghost"),
        button("Pay back", () => {
          const value = Number(amount.value);
          if (!amount.value.trim() || !Number.isFinite(value) || value <= 0) {
            return toast("Type how much you are paying back");
          }
          const typed = note.value.trim();
          state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
          state.deposits = Array.isArray(state.deposits) ? state.deposits : [];
          state.expenses.push({ id: newId("exp"), date, amount: value,
            category: drawingLabel(state), method: outOf,
            note: typed || `Paid back to ${pocket}` });
          state.deposits.push({ id: newId("dep"), date, amount: value, method: pocket,
            note: typed, repay: true });
          save(state);
          maybeSync(state);
          toast(`Paid ${fmtRM(value, cur)} back to ${pocket} out of ${outOf}`);
          closePopup();
          redraw();
        }, "primary")));
  };

  let adding = false;
  let closePopup = () => {};
  paint();
  showPopup(el("div", { class: "popup-title-row" }, "Pay back a pocket"),
    (refresh, close) => { closePopup = close; return body; });
}

export function renderMoney(root, state) {
  const cur = state.settings.currency || "RM";
  // `opens` turns a figure into a door: tapping it shows that method's book for the
  // stretch, which is the list the figure was added up from.
  const row = (label, value, extra, cls = "", opens = null) => el("div", {
    class: `info-row${cls}${opens ? " tappable" : ""}`,
    onclick: opens || null,
  },
    el("span", {}, label),
    el("span", { class: "info-val" }, fmtRM(value, cur),
      extra ? el("span", { class: "muted" }, `  ${extra}`) : null));

  const draw = (which) => {
    if (which) range = which;
    const { from, to, label } = spanFor(range);
    const m = moneyBetween(state, from, to);
    const out = expensesBetween(state, from, to);
    const mine = depositsBetween(state, from, to);
    // The net is what should be in her hand and on her phone RIGHT NOW, so three
    // things stay out of it: money still to collect (owed, not held), anything paid
    // by a method that never touched the purse (a loan, the bank overdraft), and —
    // for the same reason — money in that arrived that way. Her own pocket money
    // counts IN: it really is in the purse, and these rows are what she checks it
    // against. A line below says how much of it was hers, and the entries are listed.
    const net = m.cash + m.tng + mine.cash + mine.tng - out.cash - out.tng;
    // Every way of paying that is not cash or TNG gets its own line here, each opening
    // its own book — the loan, the bank overdraft, anyone's own pocket, and whatever she
    // adds later. Her ask in so many words: "each CASH, TNG, LOAN, Personal Pocket Kean,
    // Personal Pocket Suan, and others that might be added in future need a journal."
    // Read off the rows, so a method she has renamed still has a line to open.
    const others = otherMethods(state, [m, mine], [out]);

    root.replaceChildren(
      el("h2", { class: "section" }, "Money"),
      el("div", { class: "cal-modes" },
        ...RANGES.map(([id, text]) => button(text, () => draw(id),
          `ghost small${range === id ? " cal-mode-on" : ""}`))),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, label),
        el("div", { class: "money-rows" },
          row("Cash in", m.cash + mine.cash, null, "", () => openJournal(state, "Cash", from, to, "Cash")),
          row("TNG in", m.tng + mine.tng, null, "", () => openJournal(state, "TNG", from, to, "TNG")),
          row("Cash out", out.cash, null, "", () => openJournal(state, "Cash", from, to, "Cash")),
          row("TNG out", out.tng, null, "", () => openJournal(state, "TNG", from, to, "TNG")),
          row("Net", net, "", " net-row"),
          row("Still to collect", m.toCollect,
            m.toCollectCount ? `(${m.toCollectCount} order${m.toCollectCount === 1 ? "" : "s"})` : "", " recv-row"),
          ...others.map((o, i) => row(`Paid by ${o.label}`, o.net, null, i === 0 ? " recv-row" : "",
            () => openJournal(state, o.label, from, to, o.label))),
          row("Paid, no method", m.unmarked + mine.unmarked),
          out.unmarked ? row("Spent, no method recorded", -out.unmarked) : null,
          mine.cash + mine.tng
            ? el("p", { class: "card-sub", style: "margin:8px 0 0" },
                `· of the money in, ${fmtRM(mine.cash + mine.tng, cur)} was your own`)
            : null,
          others.length
            ? el("p", { class: "card-sub", style: "margin:6px 0 0" },
                "· these are the ways of paying that are not cash or TNG — a loan, the bank overdraft, someone's own pocket, or one you add later. Each paid for things (or money you put in) without coming out of your purse, so none of them is in the net above. Tap one to open its book.")
            : null)),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, `Money in · ${label}`),
        mine.rows.length
          ? null
          : el("p", { class: "card-sub", style: "margin:0 0 8px" }, "Nothing of your own put in this stretch."),
        ...mine.rows.map((e) => depositRow(state, e, () => draw(), cur)),
        el("div", { class: "btn-row", style: "margin-top:10px" },
          button("＋ Put money in", () => openMoneyInForm(state, () => draw()), "soft"),
          // Only when there is a pocket to pay and a till to pay it out of.
          pocketMethods(state).length && purseMethods(state).length
            ? button("＋ Pay back a pocket", () => openPayBackForm(state, from, to, () => draw(), label), "soft")
            : null)),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, `Expenses · ${label}`),
        out.rows.length
          ? null
          : el("p", { class: "card-sub", style: "margin:0 0 8px" }, "Nothing spent in this stretch yet."),
        ...out.rows.map((e) => expenseRow(state, e, () => draw(), cur)),
        el("div", { class: "btn-row", style: "margin-top:10px" },
          button("＋ Add an expense", () => openExpenseForm(state, () => draw()), "soft"))),
      el("div", { class: "card" },
        el("div", { class: "card-row" },
          el("div", {},
            el("p", { class: "card-title" }, "Categories & ways to pay"),
            el("p", { class: "card-sub" },
              `${categoryLabels(state).length} categories · ${methodsOf(state).join(", ")}`)),
          button("Edit", () => openListsManager(state, () => draw()), "ghost small")),
        // Its own door, always open: the money card's pocket rows only appear when that
        // pocket moved something in the stretch on screen, so a quiet pocket's book would
        // otherwise be unreachable (17 Sep 2026).
        el("div", { class: "card-row", style: "margin-top:12px" },
          el("div", {},
            el("p", { class: "card-title" }, "Books"),
            el("p", { class: "card-sub" },
              `Every way you pay · ${methodsOf(state).length} books, each opening into its own rows`)),
          button("Open", () => openBooks(state, from, to, label), "ghost small")),
        el("div", { class: "card-row", style: "margin-top:12px" },
          el("div", {},
            el("p", { class: "card-title" }, "Day one"),
            el("p", { class: "card-sub" },
              "Where you stand when your books begin — the tin, the phone, the shelf")),
          button("Set", () => openDayOne(state, () => draw()), "ghost small"))),
      el("p", { class: "card-sub", style: "margin:0 2px" },
        "Tap Cash, TNG or a loan row to see that method's journal - every movement that way in this stretch, in order, ending on what it should hold. Money in is counted by the day it landed - an order paid by transfer today counts today, even if it delivers on Friday. Money out is counted on the day you paid it: a shopping run records itself when you tap Bought on it, and everything else goes in by hand. Net is what should be in your purse and on your phone for this stretch; what is still to collect is counted by delivery day, because that is when you hand it over. The two lists this screen reads - what you spend ON, and HOW you paid - are edited right above, or added on the spot with the ＋ chip on either form."),
    );
  };

  draw();
}
