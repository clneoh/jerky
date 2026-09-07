// views/deliveries.js — manage delivery dates: pick dates on a month calendar
// (multi-select, already-added dates shown), or delete a date. A second mode,
// "Mark an occasion", paints reminder periods (public holidays, school
// holidays, CNY, Hari Raya...) on the same calendar. An occasion never adds or
// removes a delivery date — it is purely something to see while planning.

import { navigate } from "../app.js";
import { deliveryStatus, longDate, todayISO, weekdayName } from "../dates.js";
import { effectiveCapacity, totalUnitsOnDate } from "../bom.js";
import { el, button, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, save } from "../state.js";
import { maybeSync } from "../supabase.js";
import {
  DOW, OCC_COLOURS, addMonth, monthLabel, monthWeeks,
  occColour, occDays, occForDateAll, occRange, occSingleDay, occStrength,
} from "../calendar.js";
import { MALAYSIAN_OCCASIONS, importOccColour } from "../malaysian_occasions.js";

// Local picker state (survives re-renders while this screen is open): which
// month is showing, which future dates the baker has tapped to add, and the
// occasion-marking mode with any start day awaiting a second tap.
let viewMonth = null;
const picked = new Set();
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
  const upcoming = dates.filter((d) => d.date >= today);
  const past = dates.filter((d) => d.date < today);

  const addCard = buildAddCard(state);
  const list = upcoming.map((d) => dateCard(state, d));
  // Spread conditionally: replaceChildren would render a bare null as text.
  const pastSection = past.length ? el("div", {},
    el("h2", { class: "section" }, "Past"),
    ...past.slice(0, 10).map((d) => dateCard(state, d))) : null;

  root.replaceChildren(
    addCard,
    el("h2", { class: "section" }, `Upcoming (${upcoming.length})`),
    ...(list.length ? list : [emptyState("No upcoming dates", "Tap dates on the calendar above to add them.")]),
    ...(pastSection ? [pastSection] : []));
}

function deleteDate(state, date) {
  const count = state.orders.filter((o) => o.deliveryDateId === date.id).length;
  const msg = count
    ? `${date.date} has ${count} order(s) on it. Delete the date? The orders are kept in your delivery history.`
    : `Delete delivery date ${date.date}?`;
  confirmDialog(msg, () => {
    state.deliveryDates = state.deliveryDates.filter((d) => d.id !== date.id);
    for (const o of state.orders) {
      if (o.deliveryDateId === date.id) o.deliveryDate = o.deliveryDate || date.date;
    }
    save(state);
    maybeSync(state);
    toast("Delivery date deleted — orders kept in history");
    renderAll(view(), state);
  }, { danger: true, yesLabel: "Delete" });
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

// Occasion marks stack as same-tall sheets, back to front. The lowest layer is
// drawn here: a MULTI-day occasion (a school-holiday week) becomes translucent
// bands — one rounded band per week row it crosses. Longer marks come first so
// the CSS paints them behind shorter ones. A SINGLE-day occasion is not drawn
// here: its own day cell draws a solid box on top of these bands (see
// .cal-cell.sol), and a chosen delivery date draws the small green pill above
// everything (see .cal-cell.added). Bands only cover today and the future;
// past days keep their muted look.
function occOverlays(state, weeks, today) {
  const papers = [];
  const marks = (state.occasions || [])
    .filter((occ) => occ && occ.from && occ.to && occDays(occ) >= 2)
    .sort((a, b) => occDays(b) - occDays(a)); // long first → painted behind
  for (const occ of marks) {
    weeks.forEach((row, r) => {
      let first = -1, last = -1;
      row.forEach((d, c) => {
        if (d && d >= today && occ.from <= d && d <= occ.to) {
          if (first === -1) first = c;
          last = c;
        }
      });
      if (first === -1) return;
      // Grid row 1 is the day-of-week header, so week r sits on grid row r + 2.
      // Papers are absolutely placed against that area (see .occ-paper), which
      // lets them overlay the row without disturbing the day cells' layout.
      papers.push(el("div", {
        class: `occ-paper occ-${occColour(occ)} occ-${occStrength(occ)}`,
        style: `--gr:${r + 2};--gc1:${first + 1};--gc2:${last + 2};`,
      }));
    });
  }
  return papers;
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
      "Tap one or more dates, then Add — already-added dates are ticked.");

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

function buildAddGrid(state, weeks) {
  const today = todayISO();
  const addedSet = new Set(state.deliveryDates.map((d) => d.date));
  const cells = weeks.flat().map((d) => dayCell(state, d, today, addedSet));
  return el("div", { class: "cal-grid" },
    ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
    ...cells,
    ...occOverlays(state, weeks, today));
}

// The single-day occasion covering `date` (if any). A 1-day mark is the solid
// second sheet under a chosen delivery date — drawn as a box in this day's own
// cell. Longer marks are the translucent lowest sheet (the .occ-paper bands),
// so they are not returned here. Past days never sit above a mark.
function singleDayMark(state, date, past) {
  if (past) return null;
  return occSingleDay(state.occasions, date);
}

// The contents of a day that carries a sheet: the small green delivery pill
// (the highest sheet — date number and tick sit on it), and/or a number sitting
// on a solid single-day box. Plain days stay a bare number.
function cellInner(layerOn, added, dayNum) {
  if (!layerOn) return [dayNum];
  const kids = [];
  if (added) kids.push(el("i", { class: "d" }));
  kids.push(el("span", { class: "num" }, dayNum));
  return kids;
}

function dayCell(state, date, today, addedSet) {
  if (!date) return el("span", { class: "cal-cell blank" });
  const dayNum = String(Number(date.slice(8, 10)));
  const added = addedSet.has(date);
  const past = date < today;
  const selected = picked.has(date);
  const isToday = date === today;
  const sol = singleDayMark(state, date, past);
  let cls = "cal-cell";
  if (added) cls += " added";
  else if (past) cls += " past";
  if (sol) cls += ` sol occ-${occColour(sol)}`;
  if (isToday) cls += " today";
  const inner = cellInner(added || sol, added, dayNum);
  if (added || past) {
    return el("span", { class: cls }, ...inner);
  }
  return el("button", {
    class: `${cls} tappable${selected ? " sel" : ""}`,
    onclick: () => {
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
      button("＋ Add Malaysia's occasions",
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
      save(state);
      maybeSync(state);
      toast("Removed from the calendar");
      resetOcc();
      renderAll(view(), state);
    }, { danger: true, yesLabel: "Remove" });
}

// The "Add Malaysia's occasions" button's checkbox list — every future,
// not-yet-added entry grouped under the five category headings below. Rows are
// ticked by default; the count on the Add button follows the ticks live.
const OCC_IMPORT_GROUPS = [
  ["festive", "Festive days"],
  ["national", "National days"],
  ["state", "State & territory days"],
  ["family", "Love & family days"],
  ["school", "School holidays"],
];

function occImportDateText(from, to) {
  return from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`;
}

function occImportPicker(state) {
  const today = todayISO();
  const already = new Set((state.occasions || []).map((o) => `${o.label}|${o.from}`));
  const entries = MALAYSIAN_OCCASIONS.filter((e) =>
    e.to >= today && !already.has(`${e.label}|${e.from}`));
  if (!entries.length) {
    showPopup("Add Malaysia's occasions", (refresh, close) => el("div", {},
      el("p", { class: "card-sub" },
        "Every Malaysian date in the list is already on your calendar — nothing new to add."),
      el("div", { class: "popup-actions", style: "margin-top:12px;display:flex;gap:8px;justify-content:flex-end" },
        button("Close", close, "primary"))));
    return;
  }

  showPopup("Add Malaysia's occasions", (refresh, close) => {
    const on = entries.map(() => true);

    const groups = el("div", { class: "mycal-groups" });
    for (const [cat, title] of OCC_IMPORT_GROUPS) {
      const rows = [];
      entries.forEach((e, i) => {
        if (e.cat !== cat) return;
        const dot = el("span", { class: `mycal-dot occ-${importOccColour(e)}` });
        const box = el("input", { type: "checkbox", checked: true });
        box.addEventListener("change", () => { on[i] = box.checked; recount(); });
        rows.push(el("div", { class: "mycal-row" }, box, dot,
          el("span", { class: "mycal-label" }, e.label),
          el("span", { class: "mycal-date" }, occImportDateText(e.from, e.to))));
      });
      if (rows.length) groups.append(el("p", { class: "mycal-sub" }, title), ...rows);
    }

    let addBtn = null;
    const recount = () => {
      const n = on.filter(Boolean).length;
      addBtn.textContent = `Add (${n})`;
      addBtn.disabled = n === 0;
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
      groups,
      el("div", { class: "popup-actions" }, button("Cancel", close, "ghost"), addBtn));
  });
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
    save(state);
    maybeSync(state);
  }
  toast(fresh.length
    ? `Added ${fresh.length} Malaysian occasion${fresh.length === 1 ? "" : "s"}`
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
  save(state);
  maybeSync(state);
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
        save(state);
        maybeSync(state);
        toast(`Updated "${name}"`);
        close();
        renderAll(view(), state);
      } else {
        addOccasion(state, from, to, name, ui.colour, close); // remembers the name
      }
    };

    const nameInput = el("input", {
      class: "input", placeholder: "Type a name — e.g. \"Malaysia Day\"",
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
    // pill on top; a single-day holiday its solid box beneath it.
    const sol = singleDayMark(state, d, past);
    let base = `cal-cell${past ? " past" : " occ-cell"}`;
    if (added) base += " added";
    if (sol) base += ` sol occ-${occColour(sol)}`;
    if (isToday && !past) base += " today";
    if (past) {
      cells.push(el("span", { class: base }, dayNum));
    } else {
      const inner = cellInner(added || sol, added, dayNum);
      const cell = el("button", { class: base, dataset: { date: d } }, ...inner);
      byDate.set(d, cell);
      cells.push(cell);
    }
  }

  const grid = el("div", { class: "cal-grid", style: "touch-action:none" },
    ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
    ...cells,
    ...occOverlays(state, weeks, today));
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
    // First plain tap: hold it as the range's start day.
    occAnchor = g.start;
    paint(g.start, g.start);
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
