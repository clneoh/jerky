// occgrid.js — draws the baker's occasion marks on a month grid.
//
// A mark is just data (state.occasions; the pure helpers that read it live in
// calendar.js). This is the one place that turns it into the two shapes the
// stylesheet knows, so a holiday reads the same on EVERY calendar that shows a
// month: More → Delivery Dates, the Orders screen (and the Edit-order pop-up's
// delivery-day picker), a product's Availability card, and every free date
// field. Before this module only the first of those drew marks at all.
//
// It also NAMES a marked day, on her request: a tap says what the day is in a
// small bubble above it, exactly as the customer's shop page does. That too is
// deliberately kept here rather than on each screen — see `namedIso` below.
//
// Deliberately calendar-agnostic: occPapers() returns absolutely-placed grid
// children to spread into whatever `.cal-grid` is being built, and boxClass()
// returns the classes a day cell adds for its own single-day mark. What a day
// MEANS is left to the screen — a sold day, a delivery day, a chosen one.

import { el } from "./ui.js";
import { occColour, occDays, occForDate, occSingleDay, occStrength } from "./calendar.js";

// The multi-day sheet: one rounded band per week row the mark crosses, drawn
// UNDER the day cells (see .occ-paper) so day numbers and any green pill stay on
// top. Longer marks are returned first so the CSS paints them behind the shorter
// ones. Bands start at today — a past day keeps its muted look rather than being
// repainted by history.
export function occPapers(occasions, weeks, today) {
  const papers = [];
  const marks = (occasions || [])
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

// The single-day sheet: a mark one day long draws a see-through box of the same
// depth in its own day cell (see .cal-cell.sol). Longer marks are the bands
// above, and a past day never sits above a mark.
export function occBox(occasions, iso, past) {
  if (past) return null;
  return occSingleDay(occasions, iso);
}

// The classes a day cell adds for that box — one call, so every calendar hands
// it the same colour and the same depth a band of that length would get.
export function boxClass(sol) {
  return sol ? ` sol occ-${occColour(sol)} occ-${occStrength(sol)}` : "";
}

// ── naming a marked day ──────────────────────────────────────────────────────

// The day she last asked about, kept here and NOT on the screen that was tapped.
// On most of the app's calendars the tap that names a day is also the tap that
// rebuilds the calendar it was named on — opening an order, marking a sell day,
// choosing a date from a field — and a screen's own variable would be thrown away
// with the old grid. The rebuilt grid asks this module back and draws the same
// bubble again.
let namedIso = null;
let installed = false;

// Which mark NAMES a day: the shortest one covering it, the rule the marks are
// painted by too, so the name and the colour always belong to the same mark. A
// day already gone is never named — no mark is drawn on it either.
export function dayName(occasions, iso, past) {
  return past || !iso ? null : occForDate(occasions, iso);
}

// The bubble for a day, ready to append to its cell: built hidden, and shown only
// on the day last tapped. null when the day carries no mark.
export function tipEl(occasions, iso, past) {
  install();
  const mark = dayName(occasions, iso, past);
  if (!mark) return null;
  const tip = el("span", { class: "cal-tip" }, mark.label);
  tip.hidden = iso !== namedIso;
  return tip;
}

// A day was tapped. Remembers it when it carries a mark, so the calendar rebuilt
// by that very tap draws the bubble again, and forgets whatever was named before.
// `cells`, when the caller has one, is a Map of ISO date -> cell for a grid that
// does NOT rebuild itself on a tap (Delivery Dates' mark grid and the Availability
// card paint their own cells): the bubbles already built into those cells are
// shown and hidden in place instead.
export function nameDay(occasions, iso, past, cells) {
  namedIso = dayName(occasions, iso, past) ? iso : null;
  if (cells) reveal(cells, namedIso);
}

// A tap anywhere else puts every bubble away. On the DOCUMENT, and installed on
// first use, so no screen can replace the listener along with its grid.
function install() {
  if (installed || typeof document === "undefined" || !document.addEventListener) return;
  installed = true;
  document.addEventListener("pointerdown", () => {
    namedIso = null;
    // Clearing the key is not enough: the live bubbles are hidden too, or the
    // next repaint would rebuild them from a key that is already stale.
    if (document.querySelectorAll) {
      for (const node of document.querySelectorAll(".cal-tip")) node.hidden = true;
    }
  });
}

function reveal(cells, iso) {
  for (const [date, cell] of cells) {
    for (const kid of cell.children || []) {
      if (kid.className === "cal-tip") kid.hidden = date !== iso;
    }
  }
}
