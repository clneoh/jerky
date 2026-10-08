// views/consolidated.js — one invoice over a period (v372).
//
// Her words: __"i need a month consolidated invoice printing page, selectable individual, daily,
// monthly"__ — and asked what one document should cover: __"per day, per week, per month, per
// customer as well"__.
//
// ⚠️ IT DRAWS A SHEET AND PRINTS IT, and that is the whole of it: `journalBodyEl` for the screen and
// `journalButtons` for Print and Share. **No second way onto paper.** A page that built its own
// printout would be a second rendering of the same figures, which is how a screen and its printout
// start disagreeing.

import { el, button, select } from "../ui.js";
import { journalBodyEl, journalButtons } from "../journal.js";
import { pullReceiptRegister } from "../supabase.js";
import { consolidatedSheet } from "../consolidated.js";
import { customerList } from "../customers.js";
import { addDays, todayISO } from "../dates.js";
import { orderHref } from "../state.js";

// ⚠️ `location.hash` DIRECTLY, the same choice history.js documents: it keeps this view
// testable under Node, where no router is running.
const navigate = (hash) => { location.hash = hash; };

// ⚠️ KEPT BETWEEN VISITS, like Profit's month. Stepping away and coming back should not silently
// re-scope the document she was just reading.
let kind = "month";
let anchor = "";
let customerKey = "";
// ⚠️ The receipt register, once read. `null` MEANS "NOT READ" and the builder treats it as such —
// an empty array would claim there are no void numbers, which is a different statement entirely.
let register = null;
// ★ HOW THE PAGE IS SORTED (v379). ⚠️⚠️ **INVOICE ORDER IS THE DEFAULT AND THE POINT OF THE PAGE** —
// this is a filing document, read against the serial. Sorting is something she CHOOSES, and a
// second press on the same heading turns it round.
let sort = { by: "invoice", dir: "asc" };

const SCOPES = [["all", "All"], ["day", "A day"], ["week", "A week"], ["month", "A month"]];

const PILL = (on) => (on ? "soft small" : "ghost small");

export function renderConsolidated(root, state, params) {
  const cur = (state.settings && state.settings.currency) || "RM";
  if (!anchor) anchor = todayISO();

  // ★★ THIS ONE PAGE IS WIDER ON A DESKTOP (v377). Her words: __"that page can be optimise for desktop
  // brouwser"__. ⚠️ **The whole backoffice is capped at 540px — a phone column, on every screen, at every
  // size** (`.view`, app.css) — which is right for the screens she taps through but wrong for a FILING
  // page she reads and prints at a desk. **The cap is lifted for this view only**, and lifted by a class
  // it removes again when she leaves: widening `.view` itself would move every other screen in the app.
  const view = document.getElementById("view");
  if (view && view.classList) view.classList.add("view-wide");
  void params;

  const paint = () => {
    const sheet = consolidatedSheet(state, { kind, anchor, customerKey, register, sort });
    const span = sheet.span;
    const people = customerList(state);
    // Nothing after today to invoice, so the forward step is refused at the current period — the same
    // rule Profit's month follows, for the same reason: there are no numbers after today.
    const canNext = span.to < todayISO();

    root.replaceChildren(
      el("h2", { class: "section" }, "Consolidated invoice"),
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "What to cover"),
        el("div", { class: "btn-row" },
          ...SCOPES.map(([k, label]) => button(label, () => { kind = k; paint(); }, PILL(kind === k)))),
        // ⚠️ NO ARROWS ON "ALL", BECAUSE THERE IS NOTHING TO STEP. A press that cannot do anything
        // reads as a broken screen (the app's own rule), so the row keeps its label — which still
        // says what is being looked at — and simply has no arrows on it.
        el("div", { class: "cal-head" },
          kind === "all" ? null : button("‹", () => { step(-1); paint(); }, "ghost small cal-nav"),
          el("span", { class: "cal-title" }, span.label),
          kind === "all" ? null
            : (() => { const b = button("›", () => { step(1); paint(); }, "ghost small cal-nav"); if (!canNext) b.disabled = true; return b; })()),
        el("div", { class: "field" }, el("label", {}, "Whose orders?"),
          select(
            [{ value: "", label: "All customers" },
              ...people.map((p) => ({ value: p._key, label: p.whatsapp ? `${p.name} · ${p.whatsapp}` : p.name }))],
            customerKey,
            function () { customerKey = this.value || ""; paint(); }))),

      el("div", { class: "card" },
        el("p", { class: "card-title" }, sheet.title),
        el("p", { class: "card-sub", style: "margin:0 0 8px" }, sheet.subtitle),
        wireOpen(wireSort(journalBodyEl(sheet, cur), paint)),
        // ⚠️ The buttons come from the SHARED pair, so Print and Share (and the PDF inside Share)
        // are the same ones every other book in the app wears — and a change to how a page reaches
        // paper reaches this one too, without anyone remembering to come back here.
        el("div", { class: "btn-row", style: "margin-top:12px" }, ...journalButtons(sheet, cur))));
  };

  // ★ DRAWN FROM HER OWN ORDERS FIRST, THEN THE REGISTER LANDS (v378). The document is local and must
  // never make her wait for the network to see her own sales; the void numbers are the only part that
  // needs reading, so they arrive a moment later and the page is redrawn.
  register = null;
  let dead = false;
  paint();
  pullReceiptRegister(state).then((r) => {
    if (dead) return;
    register = r.ok ? r.rows : null;
    paint();
  }).catch(() => { if (!dead) { register = null; paint(); } });

  // ⚠️ AND THE WIDTH IS GIVEN BACK when she leaves. The router calls this before drawing the next
  // screen, so no other page inherits the wider cap — a page that widened the app and did not put it
  // back would quietly change every screen after it.
  return () => { dead = true; if (view && view.classList) view.classList.remove("view-wide"); };
}

// One step back or forward, in whatever unit is showing.
function step(delta) {
  // ⚠️ A GUARD, NOT A HABIT. The arrows are not drawn on "All", so this is unreachable from the
  // screen — but without it an unknown kind would silently take the MONTH branch and move a date
  // nobody asked to move. A fall-through that guesses is how a later change goes wrong quietly.
  if (kind === "all") return;
  if (kind === "day") { anchor = addDays(anchor, delta); return; }
  if (kind === "week") { anchor = addDays(anchor, delta * 7); return; }
  const d = new Date(`${anchor}T00:00:00`);
  d.setMonth(d.getMonth() + delta, 1);
  anchor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ★★ PRESS A COLUMN TITLE AND THE PAGE SORTS BY IT (v379). Her words: __"can you allow me to sort the
// column by its title"__.
//
// ⚠️⚠️ IT WIRES **THE SHEET'S OWN HEADER ROW** rather than drawing a second one on the screen. A pressable
// header of its own would be a second rendering of the same headings — and the day the two drifted, the
// screen would promise a sort the paper did not have. One header, one place it is written.
//
// ⚠️ AND IT DOES NOTHING AT ALL IF THE ROW IS NOT THERE — the paper and the shared message read the same
// sheet, and a header that is only sometimes present must not be a crash.
const SORT_COLUMNS = ["date", "order", "invoice", "what", "customer"];
// Which of those five cells holds the order number — read off the same list the sort is built
// from, so a column inserted later cannot leave the press on the wrong one.
const ORDER_COL = SORT_COLUMNS.indexOf("order");

// ★★ AND THE ORDER NUMBER IS A DOOR ON THIS PAGE TOO (v381). Her words: __"can make the order
// number clickable to bring us to the order so i can admen it, or look at it detail"__.
//
// ⚠️⚠️ THIS IS A SCREEN-ONLY PASS, exactly like `wireSort` beside it, and that is the whole
// design. `journalBodyEl` builds ONE document that the screen, the paper and the shared file all
// read — so a link written into `sheetLineEl` would put a live link in the middle of a printed
// filing sheet, which is nonsense on paper and a second rendering of the document besides. The
// sheet is built untouched; this walks it afterwards and only the screen gets a door.
//
// ⚠️ IT REPLACES THE CELL'S CONTENTS RATHER THAN ITSELF, so the grid's own column widths — which
// took three tries to get right at v376 — are not disturbed by adding a press.
//
// ⚠️⚠️ **EVERY FACT IS READ OFF THE ROW IT IS DECORATING**, and there is no pairing of one list
// against another anywhere in here. The first draft paired `sheet.lines` with the rows by
// position, and it silently wired NOTHING: the filing lines never carried a `code` field (they
// carry `cols`), so the guard dropped every row. Reading the code out of the cell the link will
// sit in means the two can never disagree — **the press opens exactly the number printed under
// it** — and it is why this takes no `sheet` at all.
function wireOpen(body) {
  if (!body || typeof body.querySelectorAll !== "function") return body;
  for (const row of [...body.querySelectorAll(".journal-cols")]) {
    const cls = String((row && row.className) || "");
    // The header row names the columns; it is not an order.
    if (cls.includes("journal-cols-head")) continue;
    // ⚠️ A VOID ROW HAS NO ORDER TO OPEN — its order was removed, which is the whole reason it
    // is on the page. It keeps its number and stays plain text. (`cls` is the row's own class,
    // put there by the builder for the void line, so nothing has to be passed in to know.)
    if (cls.includes("journal-void")) continue;
    const cell = row.querySelector ? row.querySelector(`.j-col-${ORDER_COL}`) : null;
    if (!cell || typeof cell.replaceChildren !== "function") continue;
    const printed = String(cell.textContent || "").trim();
    // ⚠️ THE CELL MUST HOLD A CODE, and if it does not this row is left alone rather than guessed at.
    // ⚠️⚠️ AND IT IS A GUARD AGAINST THE COLUMNS SHIFTING, NOT A PATH ANY CURRENT DATA REACHES —
    // said plainly because a bite proved it: every filing row today carries a code (a row with no
    // id gets orderCode's "??????", which is still a code), so no test can exercise this line. It
    // earns its place by making the press depend on what the cell SAYS rather than on the column's
    // position: move a column and the worst that happens is a number stops being pressable, never
    // that a customer's name becomes a link to somebody's order.
    if (!/^#[0-9A-Za-z]+$/.test(printed)) continue;
    const href = orderHref(printed.slice(1));
    cell.replaceChildren(el("a", { class: "ord-open", href,
      onclick: (ev) => { ev.preventDefault(); navigate(href); } }, printed));
  }
  return body;
}

function wireSort(body, paint) {
  const head = body && body.querySelector ? body.querySelector(".journal-cols-head") : null;
  if (!head) return body;
  // ⚠️⚠️ `children` IS THE RIGHT COLLECTION — in a real DOM it holds ELEMENTS ONLY, which is the five
  // heading cells. **But this loop must not ASSUME that.** The press-everything test's stand-in keeps
  // text nodes in `children` the way a browser keeps them in `childNodes`, and its press threw
  // `cell.addEventListener is not a function` — a fault in MY loop, not in the page. **A heading cell
  // that cannot take a listener is simply not wired; it must never bring the screen down.**
  [...(head.children || [])].forEach((cell, i) => {
    const by = SORT_COLUMNS[i];
    if (!by || !cell || typeof cell.addEventListener !== "function") return;
    // ⚠️ THE MARKER SAYS WHICH COLUMN IS SORTING AND WHICH WAY — without it she cannot tell a page that
    // has been sorted from one that has not, and the heading is the only place that can say.
    if (sort.by === by) {
      cell.textContent = `${String(cell.textContent).replace(/ [▲▼]$/, "")} ${sort.dir === "asc" ? "▲" : "▼"}`;
    }
    cell.className = `${cell.className} sortable`;
    // ⚠️ A SECOND PRESS ON THE SAME HEADING TURNS IT ROUND; a press on a different one starts ascending.
    cell.addEventListener("click", () => {
      sort = sort.by === by
        ? { by, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { by, dir: "asc" };
      paint();
    });
  });
  return body;
}
