// views/deliveries.js — manage delivery dates: pick dates on a month calendar
// (multi-select, already-added dates shown), or delete a date. A second mode,
// "Mark an occasion", paints reminder periods (public holidays, school
// holidays, CNY, Hari Raya...) on the same calendar. An occasion never adds or
// removes a delivery date — it is purely something to see while planning.

import { navigate } from "../app.js";
import { deliveryStatus, longDate, todayISO, weekdayName } from "../dates.js";
import { effectiveCapacity, totalUnitsOnDate } from "../bom.js";
import { el, button, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, save } from "../state.js";
import { maybeSync, maybeSyncStorefront } from "../supabase.js";
import {
  DOW, OCC_COLOURS, addMonth, monthLabel, monthWeeks,
  occColour, occForDateAll, occRange,
} from "../calendar.js";
import { boxClass, nameDay, occBox, occPapers, tipEl } from "../occgrid.js";
import { OCCASION_CATALOG, importOccColour } from "../occasion_catalog.js";

// Local picker state (survives re-renders while this screen is open): which
// month is showing, which future dates the baker has tapped to add, and the
// occasion-marking mode with any start day awaiting a second tap.
let viewMonth = null;
const picked = new Set();
let pastOpen = false; // the past-dates group starts folded
let occMode = false;
let occAnchor = null; // first day of a two-tap mark, waiting for the last day
let occColourChosen = "red"; // mark colour she picked last (one of OCC_COLOURS)

function view() { return document.getElementById("view"); }

function resetOcc() { occAnchor = null; }

function renderAll(root, state) {
  const today = todayISO();
  if (!viewMonth) {
    const now = new Date();
    viewMonth = { year: now.getFullYear(), month: now.getMonth() };
  }

  const dates = [...state.deliveryDates].sort((a, b) => a.date.localeCompare(b.date));
  const past = dates.filter((d) => d.date < today);

  // No list of the dates still to come: the calendar above IS the list — every
  // delivery date wears its green pill there, a tap adds one, a tap on a ticked day
  // takes it back. The past dates are the one thing the calendar cannot manage (a
  // day gone is never tappable), so they stay, folded away and holding every one of
  // them: the group used to show the last 10 with the rest unreachable.
  const pastSection = past.length ? el("div", {},
    el("button", { class: "fold-head past-head", type: "button",
      onclick: () => { pastOpen = !pastOpen; renderAll(root, state); } },
      el("span", {}, `Past dates (${past.length})`),
      el("span", { class: "fold-caret" }, pastOpen ? "▾" : "▸")),
    el("div", { class: "fold-body", hidden: !pastOpen },
      ...past.map((d) => dateCard(state, d)))) : null;

  root.replaceChildren(
    buildAddCard(state),
    ...(pastSection ? [pastSection] : []));
}

// `ask` is for the calendar's own untick: taking back a date she just added is
// the reverse of the tap that added it, so it happens on the spot — but a date
// that already has orders on it is a different matter and still asks (as the
// Del button always has).
function deleteDate(state, date, ask = true) {
  const count = state.orders.filter((o) => o.deliveryDateId === date.id).length;
  if (!ask) return removeDate(state, date, count);
  const msg = count
    ? `${date.date} has ${count} order(s) on it. Delete the date? The orders are kept in your delivery history.`
    : `Delete delivery date ${date.date}?`;
  confirmDialog(msg, () => removeDate(state, date, count), { danger: true, yesLabel: "Delete" });
}

function removeDate(state, date, count) {
  state.deliveryDates = state.deliveryDates.filter((d) => d.id !== date.id);
  for (const o of state.orders) {
    if (o.deliveryDateId === date.id) o.deliveryDate = o.deliveryDate || date.date;
  }
  save(state);
  maybeSync(state);
  toast(count ? "Delivery date deleted — orders kept in history" : "Delivery date removed");
  renderAll(view(), state);
}

// Marking or clearing a holiday changes what the CUSTOMER's calendar draws, so
// the storefront snapshot goes with it — the same two things a product edit
// does. Only maybeSync() here would send the shared-data sync and leave the shop
// wearing an old set of marks until a product or a setting happened to be saved:
// on 14 Sep 2026 Malaysia Day sat on her calendar and the shop had never been
// told about it.
export function saveMarks(state) {
  save(state);
  maybeSync(state);
  maybeSyncStorefront(state);
}

function addSelected(state) {
  const picks = [...picked].sort();
  if (!picks.length) return toast("Pick a date on the calendar first");
  let added = 0;
  for (const date of picks) {
    if (state.deliveryDates.some((d) => d.date === date)) continue;
    state.deliveryDates.push({ id: newId("del"), date, notes: "" });
    added++;
  }
  picked.clear();
  save(state);
  maybeSync(state);
  toast(added ? `Added ${added} delivery date${added === 1 ? "" : "s"}`
    : "Those dates were already added");
  renderAll(view(), state);
}

function buildAddCard(state) {
  const today = todayISO();
  const todayKey = new Date(`${today}T00:00:00`);
  const thisMonth = { year: todayKey.getFullYear(), month: todayKey.getMonth() };
  const canPrev = viewMonth.year > thisMonth.year
    || (viewMonth.year === thisMonth.year && viewMonth.month > thisMonth.month);
  const limit = addMonth(thisMonth.year, thisMonth.month, 12);
  const canNext = viewMonth.year < limit.year
    || (viewMonth.year === limit.year && viewMonth.month < limit.month);

  const nav = (delta) => {
    viewMonth = addMonth(viewMonth.year, viewMonth.month, delta);
    renderAll(view(), state);
  };

  const head = el("div", { class: "cal-head" },
    button("‹", () => nav(-1), "ghost small cal-nav"),
    el("span", { class: "cal-title" }, monthLabel(viewMonth.year, viewMonth.month)),
    button("›", () => nav(1), "ghost small cal-nav"));
  if (!canPrev) head.children[0].disabled = true;
  if (!canNext) head.children[2].disabled = true;

  const setMode = (toOcc) => {
    if (toOcc === occMode) return;
    occMode = toOcc;
    resetOcc();
    renderAll(view(), state);
  };
  const modes = el("div", { class: "cal-modes" },
    button("Add dates", () => setMode(false), `ghost small${occMode ? "" : " cal-mode-on"}`),
    button("Mark an occasion", () => setMode(true), `ghost small${occMode ? " cal-mode-on" : ""}`));

  const weeks = monthWeeks(viewMonth.year, viewMonth.month);
  const heading = occMode
    ? el("h3", { style: "margin:0 0 6px" }, "Mark an occasion")
    : el("h3", { style: "margin:0 0 6px" }, "Add a delivery date");
  const sub = occMode
    ? el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "A reminder on the calendar — it never adds or changes delivery dates.")
    : el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "Tap one or more dates, then Add. Tap an added date again to take it off.");

  return el("div", { class: "card" },
    modes,
    heading,
    sub,
    head,
    occMode ? buildOccGrid(state, weeks) : buildAddGrid(state, weeks),
    occMode ? occBody(state) : el("div", { class: "btn-row", style: "margin-top:10px" },
      button(`Add selected${picked.size ? ` (${picked.size})` : ""}`, () => addSelected(state), "primary")));
}

// ── add-dates grid (mode 1) ───────────────────────────────────────────────
// Occasion marks stack as same-tall sheets, back to front. occPapers() draws the
// lowest layer — the translucent bands of every MULTI-day mark, under the day
// cells; a SINGLE-day mark is the wash box its own cell draws on top (see
// .cal-cell.sol), and a chosen delivery date the small green pill above
// everything (see .cal-cell.added). The same two shapes come from the same
// module on every calendar in the app.

function buildAddGrid(state, weeks) {
  const today = todayISO();
  const addedMap = new Map(state.deliveryDates.map((d) => [d.date, d]));
  const cells = weeks.flat().map((d) => dayCell(state, d, today, addedMap));
  return el("div", { class: "cal-grid" },
    ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
    ...cells,
    ...occPapers(state.occasions, weeks, today));
}

// The contents of a day that carries a sheet: the small green delivery pill
// (the highest sheet — date number and tick sit on it), and/or a number sitting
// on a see-through single-day box. Plain days stay a bare number.
function cellInner(layerOn, added, dayNum) {
  if (!layerOn) return [dayNum];
  const kids = [];
  if (added) kids.push(el("i", { class: "d" }));
  kids.push(el("span", { class: "num" }, dayNum));
  return kids;
}

function dayCell(state, date, today, addedMap) {
  if (!date) return el("span", { class: "cal-cell blank" });
  const dayNum = String(Number(date.slice(8, 10)));
  const addedTo = addedMap.get(date);
  const added = !!addedTo;
  const past = date < today;
  const selected = picked.has(date);
  const isToday = date === today;
  const sol = occBox(state.occasions, date, past);
  let cls = "cal-cell";
  if (added) cls += " added";
  else if (past) cls += " past";
  cls += boxClass(sol);
  if (isToday) cls += " today";
  const inner = cellInner(added || sol, added, dayNum);
  const tip = tipEl(state.occasions, date, past);
  if (tip) inner.push(tip);
  // A day already one of her delivery dates: tapping it takes it back off, the same
  // gesture that put it on — the calendar is the one place she both adds and removes
  // them, so the Upcoming list below no longer has to exist. A day that also carries
  // an occasion mark still names itself on the way out: this tap names the day AND
  // does its usual job, exactly as a tap does on the Orders calendar. A date already
  // gone keeps its green pill but is not tappable — past dates are managed in the
  // Past dates group, where nothing on the calendar can be changed by accident.
  if (added && !past) {
    const onIt = state.orders.some((o) => o.deliveryDateId === addedTo.id);
    return el("button", { class: `${cls} tappable`,
      onclick: () => { nameDay(state.occasions, date, past); deleteDate(state, addedTo, onIt); } }, ...inner);
  }
  if (added || past) {
    return el("span", { class: cls }, ...inner);
  }
  return el("button", {
    class: `${cls} tappable${selected ? " sel" : ""}`,
    onclick: () => {
      nameDay(state.occasions, date, past);
      if (selected) picked.delete(date);
      else picked.add(date);
      renderAll(view(), state);
    },
  }, ...inner);
}

// ── occasion mode (mode 2) ────────────────────────────────────────────────

// Below the grid: a one-line tip, then the "Marked periods" list.
function occBody(state) {
  const occs = [...(state.occasions || [])].sort((a, b) => a.from.localeCompare(b.from));
  return el("div", { class: "occ-body" },
    el("p", { class: "occ-tip" },
      "Slide from the first day to the last — or tap the first, then the last."
      + " Tap the same day twice to mark just one day."),
    el("div", { class: "occ-importrow" },
      button("＋ Load standard occasions",
        () => occImportPicker(state), "soft small")),
    el("p", { class: "occ-sublabel" }, "Marked periods"),
    occs.length
      ? occs.map((o) => occRow(state, o))
      : el("p", { class: "card-sub", style: "margin:6px 0 0" },
        "Nothing marked yet — pick a range above and name it."));
}

function occRow(state, occ) {
  return el("div", { class: "occ-row" },
    el("span", { class: `occ-tag occ-${occColour(occ)}` }, occ.label),
    el("span", { class: "occ-row-dates" }, `${longDate(occ.from)} – ${longDate(occ.to)}`),
    button("Edit", () => occLabelPicker(state, occ.from, occ.to, occ), "ghost small"),
    button("✕", () => deleteOccasion(state, occ), "ghost small"));
}

function deleteOccasion(state, occ) {
  confirmDialog(
    `Remove the "${occ.label}" mark (${longDate(occ.from)} – ${longDate(occ.to)})?`
    + " Your delivery dates are untouched.",
    () => {
      state.occasions = state.occasions.filter((o) => o.id !== occ.id);
      saveMarks(state);
      toast("Removed from the calendar");
      resetOcc();
      renderAll(view(), state);
    }, { danger: true, yesLabel: "Remove" });
}

// The "Load standard occasions" button's checkbox list — every future, not-yet-added
// entry grouped under the eight category headings below. Rows are ticked by
// default; the count on the Add button follows the ticks live.
const OCC_IMPORT_GROUPS = [
  ["festive", "Festive days"],
  ["national", "National days"],
  ["state", "State & territory days"],
  ["family", "Love & family days"],
  ["school", "School holidays"],
  ["pet", "Fun & pet days"],
  ["bake", "Baking & sweet days"],
  ["kind", "People & kindness days"],
];

function occImportDateText(from, to) {
  return from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`;
}

function occImportPicker(state) {
  const today = todayISO();
  const already = new Set((state.occasions || []).map((o) => `${o.label}|${o.from}`));
  const entries = OCCASION_CATALOG.filter((e) =>
    e.to >= today && !already.has(`${e.label}|${e.from}`));
  if (!entries.length) {
    showPopup("Load standard occasions", (refresh, close) => el("div", {},
      el("p", { class: "card-sub" },
        "Every date in the list is already on your calendar — nothing new to add."),
      el("div", { class: "popup-actions", style: "margin-top:12px;display:flex;gap:8px;justify-content:flex-end" },
        button("Close", close, "primary"))));
    return;
  }

  showPopup("Load standard occasions", (refresh, close) => {
    const on = entries.map(() => true);
    const groupData = []; // { master, boxes: [{ el, i }] } per visible heading

    const groups = el("div", { class: "mycal-groups" });
    for (const [cat, title] of OCC_IMPORT_GROUPS) {
      const rows = [];
      const boxes = [];
      entries.forEach((e, i) => {
        if (e.cat !== cat) return;
        const dot = el("span", { class: `mycal-dot occ-${importOccColour(e)}` });
        const box = el("input", { type: "checkbox", checked: true });
        box.addEventListener("change", () => { on[i] = box.checked; recount(); syncMasters(); });
        boxes.push({ el: box, i });
        rows.push(el("div", { class: "mycal-row" }, box, dot,
          el("span", { class: "mycal-label" }, e.label),
          el("span", { class: "mycal-date" }, occImportDateText(e.from, e.to))));
      });
      if (!rows.length) continue;
      // The box beside a heading is a whole-group switch: it ticks/unticks every
      // row under it, and turns itself into a dash when only some are ticked.
      const master = el("input", { type: "checkbox", checked: true });
      master.addEventListener("change", () => {
        for (const { el: b, i } of boxes) { b.checked = master.checked; on[i] = master.checked; }
        recount();
        syncMasters();
      });
      groupData.push({ master, boxes });
      groups.append(
        el("div", { class: "mycal-ghead" }, master, el("p", { class: "mycal-sub" }, title)),
        ...rows);
    }

    let addBtn = null;
    const recount = () => {
      const n = on.filter(Boolean).length;
      addBtn.textContent = `Add (${n})`;
      addBtn.disabled = n === 0;
    };
    const syncMasters = () => {
      for (const g of groupData) {
        let anyOn = false, allOn = true;
        for (const { i } of g.boxes) { if (on[i]) anyOn = true; else allOn = false; }
        g.master.checked = anyOn && allOn;
        g.master.indeterminate = anyOn && !allOn;
      }
    };
    const tickAll = (v) => {
      for (const g of groupData) {
        for (const { el: b, i } of g.boxes) { b.checked = v; on[i] = v; }
      }
      recount();
      syncMasters();
    };

    const doAdd = () => {
      occImportAdd(state, entries.filter((_, i) => on[i]), close);
    };

    addBtn = button("Add", doAdd, "primary");
    recount();
    return el("div", {},
      el("p", { class: "mycal-legend" },
        el("span", { class: "mycal-dot occ-red" }), " public holiday",
        " · ", el("span", { class: "mycal-dot occ-orange" }), " other celebration",
        " · untick any you don't want. \"(est.)\" dates are estimates until officially confirmed — you can Edit or delete any mark afterwards."),
      el("div", { class: "mycal-allrow" },
        button("Untick all", () => tickAll(false), "ghost small"),
        button("Tick all", () => tickAll(true), "ghost small"),
        el("span", { class: "mycal-allnote" }, "· tick the box by a heading to grab that whole group")),
      groups,
      myOwnDay(state, close),
      el("div", { class: "popup-actions" }, button("Cancel", close, "ghost"), addBtn));
  });
}

// "My own day" — a one-off mark (any name, any date) straight from the Load
// standard occasions popup, so a birthday or a promo day lands in two taps
// without drawing on the calendar. Adds a single-day mark in orange (Edit it
// later to re-colour, like any mark) and remembers the name for the one-tap
// chips. Its button is spelled out as "Add my own day" so it cannot be confused
// with the popup's own Add, which is the one that files the ticked days.
function myOwnDay(state, close) {
  const ui = { name: "", date: todayISO() };
  const finish = () => {
    const name = String(ui.name).trim();
    if (!name) return toast("Type a name first");
    if (!ui.date) return toast("Pick a date first");
    addOccasion(state, ui.date, ui.date, name, "orange", close);
  };
  const nameInp = el("input", {
    class: "input", placeholder: "e.g. Pet-treat promo day", "data-suggest": "Pet-treat promo day", maxlength: "40",
  });
  nameInp.addEventListener("input", () => { ui.name = nameInp.value; });
  nameInp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(); });
  const dateInp = el("input", { class: "input", type: "date", min: todayISO(), value: ui.date });
  dateInp.addEventListener("input", () => { ui.date = dateInp.value; });
  return el("div", { class: "mycal-own" },
    el("p", { class: "mycal-sub" }, "My own day"),
    el("p", { class: "occ-edit-note", style: "margin:0 0 2px" },
      "Any name, any date — a birthday or a one-off promo."),
    el("div", { class: "mycal-own-row" }, nameInp, dateInp,
      button("Add my own day", finish, "soft")));
}

function occImportAdd(state, picks, close) {
  const already = new Set((state.occasions || []).map((o) => `${o.label}|${o.from}`));
  const fresh = picks.filter((e) => !already.has(`${e.label}|${e.from}`));
  if (fresh.length) {
    for (const e of fresh) {
      state.occasions.push({
        id: newId("occ"), from: e.from, to: e.to,
        label: e.label, colour: importOccColour(e),
      });
    }
    saveMarks(state);
  }
  toast(fresh.length
    ? `Added ${fresh.length} occasion${fresh.length === 1 ? "" : "s"}`
    : "Those are already on your calendar");
  close();
  resetOcc();
  renderAll(view(), state);
}

// Names the baker has typed before, most recent first — a quick-tap reuse list
// stored on THIS phone only (settings.savedOccNames is never synced).
function occSavedNames(state) {
  const arr = state.settings && Array.isArray(state.settings.savedOccNames)
    ? state.settings.savedOccNames
    : [];
  return arr.slice();
}

function rememberOccName(state, name) {
  name = String(name).trim();
  if (!name) return;
  const list = occSavedNames(state).filter((n) => n.toLowerCase() !== name.toLowerCase());
  list.unshift(name);
  state.settings.savedOccNames = list.slice(0, 12); // keep the last dozen
}

function addOccasion(state, from, to, label, colour, close) {
  const clean = String(label).trim();
  state.occasions.push({
    id: newId("occ"), from, to, label: clean,
    colour: OCC_COLOURS.includes(colour) ? colour : "grey",
  });
  rememberOccName(state, clean);
  saveMarks(state);
  toast(`Marked "${clean}" on the calendar`);
  close();
  resetOcc();
  renderAll(view(), state);
}

function rangeText(from, to) {
  return `${weekdayName(from)} ${longDate(from)} – ${weekdayName(to)} ${longDate(to)}`;
}

// The popup that names + colours a fresh mark — or edits an existing mark's
// name + colour (occ given; its dates stay read-only). The body is rebuilt on
// refresh() so a forgotten saved name drops out, but `ui` keeps the colour and
// name the baker is mid-way through, so nothing resets on a refresh.
function occLabelPicker(state, from, to, occ = null) {
  const editing = !!occ;
  const ui = {
    colour: editing ? occColour(occ) : occColourChosen,
    name: editing ? String(occ.label || "") : "",
  };
  showPopup(editing ? "Edit this mark" : "Mark this period", (refresh, close) => {
    const cancel = () => {
      resetOcc();
      close();
      renderAll(view(), state);
    };
    const finish = () => {
      const name = String(ui.name).trim();
      if (!name) return toast("Type a name first");
      if (editing) {
        occ.label = name;
        occ.colour = ui.colour;
        rememberOccName(state, name);
        saveMarks(state);
        toast(`Updated "${name}"`);
        close();
        renderAll(view(), state);
      } else {
        addOccasion(state, from, to, name, ui.colour, close); // remembers the name
      }
    };

    const nameInput = el("input", {
      class: "input", placeholder: "Type a name — e.g. \"Malaysia Day\"",
      "data-suggest": "Malaysia Day",
      maxlength: "40", value: ui.name,
    });
    nameInput.addEventListener("input", () => { ui.name = nameInput.value; });
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(); });

    const colourName = el("span", { class: "occ-swatch-name" }, ui.colour);
    const swatches = el("div", { class: "occ-swatches" });
    const pick = (key) => {
      ui.colour = key;
      occColourChosen = key;
      colourName.textContent = key;
      for (const s of swatches.children) {
        s.classList.toggle("on", s.dataset.colour === key);
      }
    };
    for (const key of OCC_COLOURS) {
      swatches.append(el("button", {
        class: `occ-swatch occ-${key}${ui.colour === key ? " on" : ""}`,
        dataset: { colour: key },
        "aria-label": key,
        title: key.charAt(0).toUpperCase() + key.slice(1),
        onclick: () => pick(key),
      }));
    }

    // Names she has typed before — tap one to reuse it (its ✕ forgets it).
    const saved = occSavedNames(state);
    const chips = el("div", { class: "occ-chips" });
    for (const n of saved) {
      const forget = el("button", {
        class: "occ-chip-x", "aria-label": `Forget "${n}"`,
        onclick: (e) => {
          e.stopPropagation();
          state.settings.savedOccNames = occSavedNames(state).filter((x) => x !== n);
          save(state);
          refresh(); // the chip list rebuilds without it
        },
      }, "✕");
      const chip = el("div", {
        class: "occ-chip",
        onclick: () => { ui.name = n; nameInput.value = n; nameInput.focus(); },
      }, n, forget);
      chips.append(chip);
    }

    const body = el("div", {},
      el("p", { class: "cal-range" }, rangeText(from, to)),
      editing ? el("p", { class: "occ-edit-note" },
        "Only the name and colour can change here. To cover different days, remove this mark and mark the new range.")
        : null,
      el("p", { class: "occ-sublabel", style: "margin-top:8px" }, "Pick a colour"),
      swatches,
      colourName,
      el("p", { class: "occ-sublabel", style: "margin-top:12px" }, "Name it"),
      chips,
      nameInput,
      el("div", { class: "popup-actions", style: "margin-top:12px;display:flex;gap:8px" },
        button("Cancel", cancel, "ghost"),
        button(editing ? "Save" : "Add", finish, "primary")));
    return body;
  });
}

// The occasion-mode month grid: future days are a drag surface; existing
// occasion periods are tinted. Handles pointer drags AND two-tap ranges.
function buildOccGrid(state, weeks) {
  const today = todayISO();
  const addedSet = new Set(state.deliveryDates.map((d) => d.date));
  const cells = [];
  const byDate = new Map(); // ISO date -> its cell button, for live drag paint
  for (const d of weeks.flat()) {
    if (!d) { cells.push(el("span", { class: "cal-cell blank" })); continue; }
    const dayNum = String(Number(d.slice(8, 10)));
    const past = d < today;
    const isToday = d === today;
    const added = !past && addedSet.has(d);
    // Same stacking as the add-date grid: a delivery date is the small green
    // pill on top; a single-day holiday its wash box beneath it.
    const sol = occBox(state.occasions, d, past);
    let base = `cal-cell${past ? " past" : " occ-cell"}`;
    if (added) base += " added";
    base += boxClass(sol);
    if (isToday && !past) base += " today";
    if (past) {
      cells.push(el("span", { class: base }, dayNum));
    } else {
      const inner = cellInner(added || sol, added, dayNum);
      const tip = tipEl(state.occasions, d, past);
      if (tip) inner.push(tip);
      const cell = el("button", { class: base, dataset: { date: d } }, ...inner);
      byDate.set(d, cell);
      cells.push(cell);
    }
  }

  const grid = el("div", { class: "cal-grid", style: "touch-action:none" },
    ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
    ...cells,
    ...occPapers(state.occasions, weeks, today));
  attachOccDrag(grid, byDate, state);
  return grid;
}

function attachOccDrag(grid, byDate, state) {
  // Live-paint the chosen band as a ring on the cells it covers.
  const paint = (from, to) => {
    const [lo, hi] = occRange(from, to) || [null, null];
    for (const [d, cell] of byDate) {
      cell.classList.toggle("occ-sel", !!lo && lo <= d && d <= hi);
    }
  };
  const hoverDate = (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const cell = hit && hit.closest ? hit.closest(".occ-cell") : null;
    return cell && cell.dataset.date ? cell.dataset.date : null;
  };

  let gesture = null; // { start, moved, last } while the finger is down
  grid.addEventListener("pointerdown", (e) => {
    const d = hoverDate(e);
    if (!d) return;
    e.preventDefault();
    gesture = { start: d, moved: false, last: d };
    try { grid.setPointerCapture(e.pointerId); } catch (err) { /* older engine */ }
    paint(d, d);
  });
  grid.addEventListener("pointermove", (e) => {
    if (!gesture) return;
    const d = hoverDate(e);
    if (!d) return;
    if (d !== gesture.start) gesture.moved = true;
    gesture.last = d;
    paint(gesture.start, d);
  });
  const finish = (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    if (g.moved) {
      // A real drag: name the swept range straight away.
      occAnchor = null;
      const end = hoverDate(e) || g.last;
      paint(g.start, end);
      occLabelPicker(state, g.start, end);
      return;
    }
    if (occAnchor) {
      // Second tap completes the range (or re-taps the start for one day).
      const [lo, hi] = occRange(occAnchor, g.start);
      occAnchor = null;
      paint(lo, hi);
      occLabelPicker(state, lo, hi);
      return;
    }
    // First plain tap: hold it as the range's start day. It also names the day
    // when the day carries a mark — this grid paints its own cells and does not
    // rebuild itself, so the bubbles are shown from the cells it already holds
    // rather than by a repaint that would drop the ring just painted.
    occAnchor = g.start;
    paint(g.start, g.start);
    nameDay(state.occasions, g.start, false, byDate);
  };
  grid.addEventListener("pointerup", finish);
  grid.addEventListener("pointercancel", () => { gesture = null; });
}

export function renderDeliveries(root, state) {
  renderAll(root, state);
}

function dateCard(state, date) {
  const ordered = totalUnitsOnDate(state, date.id);
  const left = Math.max(0, effectiveCapacity(state, date.date) - ordered);
  const st = deliveryStatus(date.date, state.settings);
  const closed = st.closed && !st.past;
  const occs = occForDateAll(state.occasions, date.date);

  const col = el("div",
    { onclick: () => navigate(`#/orders?date=${date.id}`), style: "cursor:pointer;min-width:0" },
    el("p", { class: "card-title" }, `${weekdayName(date.date)}, ${longDate(date.date)}`),
    el("p", { class: "card-sub" },
      `${ordered} ordered · ${left} left${closed ? " · orders closed" : ""}`));
  // A delivery day can sit inside several overlapping marks — show each as a
  // small coloured tag, shortest (strongest) first.
  for (const occ of occs) {
    col.append(el("span", { class: `occ-tag occ-${occColour(occ)}`, style: "margin-top:6px" }, occ.label));
  }

  return el("div", { class: `card${closed ? " closed" : ""}` },
    el("div", { class: "card-row" },
      col,
      el("div", { class: "li-right" },
        button("Del", () => deleteDate(state, date), "ghost small"))));
}
