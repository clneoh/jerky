// views/products.js — products + recipe (BOM) editor. New products go in the
// always-visible card at the top; tapping Edit opens the same form in a pop-up
// over the screen, exactly like editing an order.

import { el, button, select, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { byId, productUnitOptions, fmtRM, round2, newId, save } from "../state.js";
import { costOf, recipeLineCosts, validateRecipeNoCycle } from "../bom.js";
import { maybeSyncStorefront } from "../supabase.js";
import { isLive, isDraft, isHidden, newDraftRow } from "../productState.js";
import { translateAllowed, autoTranslateProduct, translateTo, LANG_OF, SRC_OF } from "../translate.js";
import { dateField } from "../datepicker.js";
import { DOW, addMonth, monthLabel, monthWeeks } from "../calendar.js";
import { boxClass, nameDay, occBox, occPapers, tipEl } from "../occgrid.js";
import { todayISO } from "../dates.js";
// The sell-day rules themselves — one shared copy, the same file the shop reads,
// so the day she marks here and the day a customer may order can never drift.
import { availRules, dayOfWeek, monthBounds, normRules, ruleLabel, ruleOpen, rulesOpen, rulesSummary } from "../../../availability.js";

const ALL_VARIANTS = ["nameZh", "descZh", "unitZh", "servingZh", "nameMs", "descMs", "unitMs", "servingMs"];
const LANG_VARIANTS = { zh: ["nameZh", "descZh", "unitZh", "servingZh"], ms: ["nameMs", "descMs", "unitMs", "servingMs"] };
const LANG_LABEL = { zh: "Chinese (中文)", ms: "Bahasa Malaysia" };
const FIELD_LABEL = { name: "Name", description: "Description", unit: "Selling unit", servingTip: "Feeding tip" };

// ── The translation card folds away ─────────────────────────────────────────
// It starts closed, opens on a tap of its own title, and closes again on a tap
// anywhere outside it. One document listener serves every card on the page (the
// New product form and the Edit pop-up can both show one), and a card that has
// been taken off the page is simply dropped from the list on the next tap — so
// nothing has to be unhooked when a pop-up is cancelled without re-rendering.
const openCards = new Set();
let collapseInstalled = false;

function installCollapseOutside() {
  if (collapseInstalled || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  collapseInstalled = true;
  document.addEventListener("pointerdown", (ev) => {
    for (const ctl of [...openCards]) {
      if (ctl.card.isConnected === false) { openCards.delete(ctl); continue; }
      if (!ctl.card.contains(ev.target)) ctl.close();
    }
  });
}

export function renderProducts(root, state) {
  installCollapseOutside();
  renderAll(root, state);
  // Whatever was built above goes away with this screen — forget the cards so a
  // later tap cannot reach into one that is no longer on the page.
  return () => openCards.clear();
}

function renderAll(root, state) {
  const live = state.products.filter(isLive);
  const drafts = state.products.filter(isDraft);
  const hidden = state.products.filter(isHidden);

  const form = newProductCard(state, root);

  if (!state.products.length) {
    root.replaceChildren(form,
      el("h2", { class: "section" }, "Products"),
      emptyState("No products yet",
        "Add a product and its recipe (ingredients per unit). It starts as a draft — Publish it to put it on the shop."));
    return;
  }

  const group = (title, list, hint) => {
    const rows = list.map((p) => productCard(state, p, root));
    return [
      el("h2", { class: "section" }, `${title} (${list.length})`),
      ...(rows.length ? rows : [el("p", { class: "card-sub muted", style: "margin:0 0 6px" }, hint)]),
    ];
  };

  root.replaceChildren(
    form,
    ...group("On the shop", live, "Nothing on the shop yet — publish a draft below to start selling it."),
    ...group("Draft — not on the shop yet", drafts, "New products start here as drafts. Publish one to put it on the shop."),
    ...group("Hidden — taken down", hidden, "Hidden products keep their history and recipe; nothing here is shown to customers."));
}

// ── Availability — the days this product SELLS, marked on a calendar ────────
// The rules live in availability.js (one shared copy, read by the shop too); this
// is only the card that edits them. Four gestures, all of which write a plain
// span so the marks stay editable afterwards:
//
//   • tap a weekday heading  → every one of that weekday in the month shown
//   • tap a day              → just that day (tapping a marked day clears it)
//   • drag across days       → that run (dragging from a marked day clears it)
//   • the From / To pair     → the two ends of the mark last touched
//
// Nothing marked means every delivery day, so a product she never opens here keeps
// selling exactly as it did before this card existed.
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A day key moved by whole days — the only arithmetic the marks need.
function shiftKey(iso, days) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Same span and same weekdays = the same mark said twice; two identical marks
// would double up in the list and the header. Ordering puts the earliest first so
// the summary reads in calendar order.
function tidyRules(list) {
  const out = [];
  for (const r of list) {
    const m = normRules([r])[0];
    if (!m) continue;
    if (!out.some((x) => x.from === m.from && x.to === m.to && x.days.join() === m.days.join())) out.push(m);
  }
  out.sort((a, b) => (a.from || "").localeCompare(b.from || "")
    || (b.to || "").localeCompare(a.to || "") || (a.days.length - b.days.length));
  return out;
}

// Take ONE day out of the marked set. A mark that is exactly that day simply
// goes; any other mark covering it is split into the part before and the part
// after, so the day itself stops selling while the rest of the mark is untouched.
// (Splitting is why a mark is stored as a span rather than as "the month".)
function removeDay(list, iso) {
  const out = [];
  for (const r of list) {
    if (!ruleOpen(r, iso)) { out.push(r); continue; }
    if (!r.from && !r.to) {
      out.push({ days: r.days, from: "", to: shiftKey(iso, -1) });
      out.push({ days: r.days, from: shiftKey(iso, 1), to: "" });
      continue;
    }
    if (r.from && iso > r.from) out.push({ days: r.days, from: r.from, to: shiftKey(iso, -1) });
    if (r.to && iso < r.to) out.push({ days: r.days, from: shiftKey(iso, 1), to: r.to });
  }
  return out;
}

// The Availability card. Hands back the node plus `collect()` — the marks to
// keep, or undefined when there are none (which the shop reads as every day).
function availabilityCard(state, product) {
  const today = todayISO();
  const todayDate = new Date(`${today}T00:00:00`);
  const thisMonth = { year: todayDate.getFullYear(), month: todayDate.getMonth() };
  const lastMonth = addMonth(thisMonth.year, thisMonth.month, 24);
  const before = (a, b) => a.year < b.year || (a.year === b.year && a.month < b.month);
  const deliversOn = (iso) => (state.settings.deliveryDays || []).includes(dayOfWeek(iso));

  let month = { ...thisMonth };
  // The marks as stored, with an older product's validFrom/validTo period read in
  // as one mark — so opening this card shows what the product already does, and
  // the first save writes it back as a mark (collect drops the old pair).
  let rules = tidyRules(availRules(product));
  let sel = rules.length ? 0 : -1; // which mark the From / To pair edits
  const keyOf = (r) => `${r.days.join("-")}|${r.from}|${r.to}`;
  // Re-normalise and re-sort the marks after every change, so the list and the
  // header can never disagree with what the calendar is drawing.
  const tidy = () => { rules = tidyRules(rules); };

  const summary = el("span", { class: "avail-sum" });
  const caret = el("span", { class: "fold-caret" }, "▸");
  const body = el("div", { class: "fold-body avail-body", hidden: true });

  const controller = { card: null, open: false, close: null };
  const shut = () => {
    body.hidden = true;
    caret.textContent = "▸";
    controller.open = false;
    openCards.delete(controller);
  };
  const head = el("button", { class: "fold-head", type: "button" },
    el("span", { class: "avail-head" }, "Availability"),
    el("span", { class: "avail-head-end" }, summary, caret));
  head.addEventListener("click", () => {
    if (controller.open) { shut(); return; }
    controller.open = true;
    controller.close = shut;
    body.hidden = false;
    caret.textContent = "▾";
    openCards.add(controller);
    paint();
  });

  // ── the marks ─────────────────────────────────────────────────────────────

  // "Is this day covered by a MARK" — which is not the same question as the shop's
  // "may this product be ordered today". An untouched product has no marks and still
  // sells every delivery day (the header says so, and the line under it spells it
  // out); the calendar draws marks, so it starts empty. Painting all seven as sold
  // would also make the first tap mean "un-sell this one", which a set of positive
  // marks cannot say.
  const open = (iso) => rulesOpen(rules, iso);

  // How much of one weekday the month shown already sells: all of it, some of it
  // (a drag caught it, or part of it), or none. Drives the heading's own state.
  function dowState(dow, mb) {
    const dates = [];
    for (let d = mb.from; d <= mb.to; d = shiftKey(d, 1)) if (dayOfWeek(d) === dow) dates.push(d);
    const on = dates.filter(open).length;
    return on === dates.length ? "all" : on ? "some" : "none";
  }

  // A heading tap marks every one of that weekday in the month shown, and a
  // second tap takes it back. Bounded by the month on purpose — that is what
  // "it is not default for the next month" means, and why anything longer is one
  // edit of the From / To pair away rather than a hidden default.
  function toggleDow(dow, mb) {
    const at = rules.findIndex((r) => r.days.length === 1 && r.days[0] === dow
      && r.from === mb.from && r.to === mb.to);
    if (at >= 0) { rules.splice(at, 1); sel = -1; tidy(); paint(); return; }
    const rule = { days: [dow], from: mb.from, to: mb.to };
    rules.push(rule);
    const key = keyOf(rule);
    tidy();
    sel = rules.findIndex((r) => keyOf(r) === key);
    paint();
  }

  function addRule(rule) {
    rules.push(rule);
    const key = keyOf(rule);
    tidy();
    sel = rules.findIndex((r) => keyOf(r) === key);
  }

  // A tap on one day: unmarked, it becomes a one-day mark; already sold, that
  // one day comes back out (see removeDay) and the rest of the mark stays.
  function tapDay(iso) {
    if (open(iso)) { rules = removeDay(rules, iso); sel = -1; tidy(); paint(); return; }
    addRule({ days: [], from: iso, to: iso });
    paint();
  }

  // The end of a drag: a run of days all selling, or — when the drag started on a
  // day that already sells — that same run coming back out.
  function dragDone(start, end, clear) {
    const lo = start <= end ? start : end;
    const hi = start <= end ? end : start;
    if (clear) {
      const days = [];
      for (let d = lo; d <= hi && days.length < 800; d = shiftKey(d, 1)) days.push(d);
      let out = rules;
      for (const d of days) out = removeDay(out, d);
      rules = out;
      sel = -1;
    } else {
      addRule({ days: [], from: lo, to: hi });
    }
    tidy();
    paint();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  // Live ring while the finger is down, the same gesture as the Delivery Dates
  // calendar — one shared look, and it makes a mis-judged drag obvious before she
  // lifts her finger.
  function wireDrag(grid, byDate) {
    const ring = (a, b) => {
      const lo = a <= b ? a : b;
      const hi = a <= b ? b : a;
      for (const [d, cell] of byDate) cell.classList.toggle("occ-sel", lo <= d && d <= hi);
    };
    const cellAt = (e) => {
      const hit = document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
      const cell = hit && hit.closest ? hit.closest(".cal-cell.tappable") : null;
      return cell && cell.dataset ? cell.dataset.date || null : null;
    };
    let g = null;
    grid.addEventListener("pointerdown", (e) => {
      // The weekday headings are their own buttons — let their click through.
      if (e.target.closest && e.target.closest(".avail-dow")) return;
      const d = cellAt(e);
      if (!d) return;
      e.preventDefault();
      g = { start: d, moved: false, last: d };
      try { grid.setPointerCapture(e.pointerId); } catch (err) { /* older engine */ }
      ring(d, d);
    });
    grid.addEventListener("pointermove", (e) => {
      if (!g) return;
      const d = cellAt(e);
      if (!d) return;
      if (d !== g.start) g.moved = true;
      g.last = d;
      ring(g.start, d);
    });
    const finish = (e) => {
      if (!g) return;
      const gg = g;
      g = null;
      try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      for (const [, cell] of byDate) cell.classList.remove("occ-sel");
      if (!gg.moved) {
        // A tap names the day before it marks it — marking repaints the grid, and
        // the repainted grid asks for the bubble by the day named here.
        nameDay(state.occasions, gg.start, gg.start < today);
        tapDay(gg.start);
        return;
      }
      dragDone(gg.start, cellAt(e) || gg.last, open(gg.start));
    };
    grid.addEventListener("pointerup", finish);
    grid.addEventListener("pointercancel", () => { g = null; });
  }

  function gridEl() {
    const mb = monthBounds(month.year, month.month);
    const weeks = monthWeeks(month.year, month.month);
    const heads = DOW.map((label, dow) => {
      const st = dowState(dow, mb);
      const cls = "cal-dow avail-dow" + (st === "all" ? " avail-dow-on" : st === "some" ? " avail-dow-part" : "");
      return el("button", { class: cls, type: "button",
        title: `${DOW_LONG[dow]} — mark every one in ${monthLabel(month.year, month.month)}`,
        "aria-pressed": st === "all" ? "true" : "false",
        onclick: () => toggleDow(dow, mb) }, label);
    });
    const cells = [];
    const byDate = new Map();
    for (const d of weeks.flat()) {
      if (!d) { cells.push(el("span", { class: "cal-cell blank" })); continue; }
      const dayNum = String(Number(d.slice(8, 10)));
      const past = d < today;
      let cls = "cal-cell";
      if (open(d)) cls += " avail-on";
      if (!deliversOn(d)) cls += " off";
      if (past) cls += " past";
      if (d === today) cls += " today";
      // Her occasion marks, drawn here too: what a product sells is a calendar
      // question, and "not on Deepavali" is easier to see than to remember.
      cls += boxClass(occBox(state.occasions, d, past));
      // A past day can never be a delivery date again, so it is shown but not
      // offered — a mark made on one would be dropped at the next save anyway.
      if (past) { cells.push(el("span", { class: cls }, dayNum)); continue; }
      // Tapping a marked day names it as well as marking it — a holiday is the one
      // thing that decides a sell day for her, so it has to be readable here too.
      const cell = el("button", { class: `${cls} tappable`, type: "button", dataset: { date: d } },
        dayNum, tipEl(state.occasions, d, past));
      byDate.set(d, cell);
      cells.push(cell);
    }
    const grid = el("div", { class: "cal-grid", style: "touch-action:none" },
      ...heads, ...cells, ...occPapers(state.occasions, weeks, today));
    wireDrag(grid, byDate);
    return grid;
  }

  function markRow(r, i) {
    return el("div", { class: `avail-row${i === sel ? " avail-row-sel" : ""}` },
      el("button", { class: "avail-row-lab", type: "button",
        onclick: () => { sel = i; paint(); } }, ruleLabel(r) || "Every day"),
      button("✕", () => { rules.splice(i, 1); sel = -1; tidy(); paint(); }, "ghost small"));
  }

  // The From / To pair, editing the mark last touched. A blank end is an OPEN end
  // ("from here on" / "up to here"), and clearing both of a weekday mark leaves
  // "every one of these weekdays, always" — which is how a mark crosses months
  // without naming either end.
  function endsEl() {
    if (sel < 0 || sel >= rules.length) {
      return el("p", { class: "card-sub", style: "margin:10px 0 0" },
        "Tap a marked period above — or mark some days — and its start and end appear here.");
    }
    const r = rules[sel];
    // tidy() copies and re-sorts, so the edited mark has to be found again by its
    // own key — `sel` alone could be pointing at a different row afterwards.
    const setEnd = (end, iso) => {
      const want = normRules([{ ...r, [end]: iso }])[0];
      if (!want) return; // an end-only mark with that end cleared says nothing
      rules = tidyRules([...rules.slice(0, sel), want, ...rules.slice(sel + 1)]);
      sel = rules.findIndex((x) => keyOf(x) === keyOf(want));
      paint();
    };
    return el("div", { class: "avail-ends" },
      el("div", { class: "field" }, el("label", {}, "Starts"),
        dateField(r.from, (iso) => setEnd("from", iso),
          { placeholder: "Open — no start", occasions: state.occasions })),
      el("div", { class: "field" }, el("label", {}, "Ends"),
        dateField(r.to, (iso) => setEnd("to", iso),
          { placeholder: "Open — no end", occasions: state.occasions })),
      el("div", { class: "btn-row" },
        button("Clear start", () => setEnd("from", ""), "ghost small"),
        button("Clear end", () => setEnd("to", ""), "ghost small")));
  }

  function paint() {
    summary.textContent = rulesSummary(rules);
    if (body.hidden) return; // folded: the header is all there is to draw
    const mb = monthBounds(month.year, month.month);
    const prev = button("‹", () => { month = addMonth(month.year, month.month, -1); paint(); }, "ghost small cal-nav");
    const next = button("›", () => { month = addMonth(month.year, month.month, 1); paint(); }, "ghost small cal-nav");
    if (!before(thisMonth, month)) prev.disabled = true;
    if (!before(month, lastMonth)) next.disabled = true;
    body.replaceChildren(
      el("p", { class: "card-sub", style: "margin:8px 0 0" },
        rules.length
          ? "Only the days you mark are sold. Nothing carries over to the next month — open a month and mark it if you want to sell then."
          : "Nothing marked yet, so this product sells on every delivery day. Mark the days you want — or leave it alone to sell every day."),
      el("p", { class: "occ-tip" },
        rules.length
          ? "Tap a weekday letter to mark every one of it in this month. Tap a day, or slide across days, to mark just those. Tapping or sliding over a marked day takes it back."
          : "Tap a weekday letter to mark every one of it in this month. Tap a day, or slide across days, to mark just those."),
      el("div", { class: "cal-head" }, prev, el("span", { class: "cal-title" }, monthLabel(month.year, month.month)), next),
      gridEl(),
      el("p", { class: "occ-sublabel" }, "Marked periods"),
      rules.length
        ? el("div", { class: "occ-body" }, ...rules.map(markRow))
        : el("p", { class: "card-sub", style: "margin:4px 0 0" }, "Nothing marked — this product sells every delivery day."),
      endsEl(),
      el("p", { class: "occ-tip" },
        `${mb.from.slice(8)}-${mb.to.slice(8)} ${monthLabel(month.year, month.month)} is one month's worth of marks; stretch a period into the next month with Starts / Ends above.`));
  }

  const card = el("div", { class: "card" }, head, body);
  controller.card = card;
  paint();

  // An ended mark is kept, not dropped: with no marks at all the product would go
  // back to selling every delivery day, which is not what a dated special means.
  return { card, collect: () => { const kept = tidyRules(rules); return kept.length ? kept : undefined; } };
}

// Builds the fields + recipe lines once and hands back the nodes plus `collect()`
// (reads the current values). `product` is null for a new product, or the real
// object when editing — so the add card and the Edit pop-up share one builder.
function buildEditor(state, product) {
  const recipeDraft = (product && product.recipe ? product.recipe : []).map((l) => ({ ...l }));

  const name = el("input", { class: "input", placeholder: "e.g. Chicken Jerky", "data-suggest": "Chicken Jerky", value: product?.name || "" });
  const unitChoices = productUnitOptions(state, product);
  const unit = select(unitChoices.options, unitChoices.value, null, "Pick a unit…");
  const price = el("input", { class: "input", type: "number", inputmode: "decimal", step: "0.01",
    placeholder: "sell price (RM, optional)", value: product?.price ?? "" });
  const limit = el("input", { class: "input", type: "number", inputmode: "numeric", min: "1",
    placeholder: "e.g. 12", "data-suggest": "12", value: product?.limit ?? "",
    title: "Max pouches of this product per batch/posting day. Limits are added together for the day's availability (e.g. 12 chicken + 12 duck = 24). Leave blank for no limit." });

  // Optional per-product date rules — customers can't order this product for a
  // delivery date it isn't open for. Orders close N days before delivery, and /
  // or a fixed from–to window of delivery dates. Both optional and per product:
  // blank means the product sells on any open date.
  const closeDays = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0",
    placeholder: "e.g. 14", "data-suggest": "14", value: product?.closeDays ?? "",
    title: "Customers must pick a delivery date at least this many days away. Blank = any open day. 0 = no early close." });

  // The days this product sells, marked on its own calendar (see
  // availabilityCard above). Folds away like the translated-text card.
  const availability = availabilityCard(state, product);

  // How long the customer may still change or cancel this product's order — the
  // window is stated on the shop card and in a mixed order's strictest window.
  // Purely informational: it never blocks the baker from moving an order by hand.
  const cancelDays = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0",
    placeholder: "e.g. 2", "data-suggest": "2", value: product?.cancelDays ?? "",
    title: "How many days before delivery a customer may still change or cancel this product's order. This only tells the customer — it never blocks you. Blank or 0 = no window shown." });

  // A sentence or two customers read on the shop page to know what this is.
  // Optional — blank shows nothing. Kept on the product and published with the
  // storefront menu, so it is written once here, not on the shop.
  const desc = el("textarea", { class: "input", rows: 2,
    placeholder: "e.g. Chicken jerky — soft, chewy strips, no additives",
    "data-suggest": "Chicken jerky — soft, chewy strips, no additives",
    value: product?.description || "" });

  // A quick how-to-serve line the owner sends with the bring-a-friend follow-up
  // ("how did the {product} go?"). Admin-only — never published to the shop.
  // Optional — blank keeps the follow-up message to the referral ask only.
  const serving = el("textarea", { class: "input", rows: 2,
    placeholder: "e.g. Tear into small pieces, store sealed in a cool, dry place",
    "data-suggest": "Tear into small pieces, store sealed in a cool, dry place",
    value: product?.servingTip || "" });

  // ── Translated 中文 / Bahasa Malaysia text ────────────────────────────────
  // English is written once above; each line here is translated from it and
  // offered as an ordinary grey suggestion — the → at the box's right edge takes
  // the words, the same gesture as every other suggested field (admin/js/
  // suggest.js). Once a line has words the → gives way to a ↻ that re-translates
  // it on demand. Typing your own words makes that line yours, and it is never
  // overwritten again.
  const manualSet = new Set(); // boxes the baker decided by typing
  const regen = new Set();     // boxes machine-filled during THIS edit
  const regenSrc = {};         // variant → the English each regen box was made from

  const isText = (src) => src === "description" || src === "servingTip";
  const boxes = {};
  const wraps = {};
  const regenBtns = {};
  const suggests = {};       // variant → the translation currently on offer, "" for none
  const pending = new Set(); // variants whose translation is still being fetched
  const cache = {};          // `${lang}|${english}` → translation, so one open never retranslates
  for (const variant of ALL_VARIANTS) {
    const src = SRC_OF[variant];
    const node = el(isText(src) ? "textarea" : "input", {
      class: "input",
      // Four rows, not two: a line's greyed hint is "e.g. <the translation>……if
      // blank, it will be filled with English", and a sentence of translation
      // plus that tail needs the height or its end is cut off in a two-row box.
      rows: isText(src) ? 4 : undefined,
      dataset: { variant },
      value: product ? String(product[variant] ?? "") : "",
    });
    node.addEventListener("input", (ev) => {
      if (ev && ev.suggested) {
        // Took the recommendation: machine text, not hers. (The event is marked
        // as a suggestion, so this never counts as typing.)
        regen.add(variant);
        regenSrc[variant] = englishSource(variant);
      } else {
        manualSet.add(variant); // her own words — never overwritten again
      }
      refreshRow(variant);
    });
    boxes[variant] = node;
    wraps[variant] = el("div", { class: "tr-wrap" },
      node,
      regenBtns[variant] = el("button", { class: "tr-regen", type: "button",
        title: "Translate this line again", onclick: () => regenOne(variant) }, "↻"));
  }
  if (product) {
    for (const variant of ALL_VARIANTS) {
      if (Array.isArray(product.trOverride) && product.trOverride.includes(variant)) { manualSet.add(variant); continue; }
      const val = String(product[variant] ?? "").trim();
      if (val && !(product.trSrc && product.trSrc[variant])) manualSet.add(variant); // legacy hand-typed (v64)
    }
  }

  // The live English text a variant would be translated from ("" when blank).
  function englishSource(variant) {
    const src = SRC_OF[variant];
    if (src === "name") return name.value.trim();
    if (src === "description") return desc.value.trim();
    if (src === "servingTip") return serving.value.trim();
    if (src === "unit") { const u = byId(state.uoms, unit.value); return (u ? u.name : unit.value).trim(); }
    return "";
  }

  // The greyed hint on a line with no words of its own: the translation on
  // offer, then what happens if she leaves it alone. Says "filled with English"
  // rather than naming the English, because that is what the customer gets —
  // the English goes in where the translation is missing.
  const hintFor = (t) => `e.g. ${t}……if blank, it will be filled with English`;

  // What the right edge of one line offers. An empty line shows the greyed
  // recommendation with the → the app draws on any suggested field; once it has
  // words, → gives way to ↻ — except on a line the baker typed, which is hers.
  // An empty line with nothing on offer still gets ↻, so it is never a dead end.
  function refreshRow(variant) {
    const node = boxes[variant];
    // Emptiness is the box's own value being "", exactly what the CSS arrow keys
    // off, so the arrow and ↻ can never both show or both hide.
    const empty = node.value === "";
    if (!empty) { suggests[variant] = ""; delete node.dataset.suggest; }
    const show = !pending.has(variant) && !!englishSource(variant)
      && (empty ? !suggests[variant] : !manualSet.has(variant));
    regenBtns[variant].hidden = !show;
    wraps[variant].className = "tr-wrap" + (show ? " has-regen" : "")
      + (isText(SRC_OF[variant]) ? " tr-wrap--text" : "");
  }

  // Work out an empty line's translation and leave it on offer as the greyed
  // suggestion the → takes. Runs when the card is opened. A translation already
  // fetched for this English in this editor is reused rather than asked for
  // again. Offline the line keeps ↻ as its way in and says nothing.
  async function loadSuggestion(variant) {
    const node = boxes[variant];
    suggests[variant] = "";
    delete node.dataset.suggest;
    if (node.value !== "") { refreshRow(variant); return; }
    const src = englishSource(variant);
    if (!src) { node.placeholder = "Needs the English above first"; refreshRow(variant); return; }
    if (!translateAllowed()) { refreshRow(variant); return; }
    const key = `${LANG_OF[variant]}|${src}`;
    if (cache[key] === undefined) {
      pending.add(variant);
      node.placeholder = "Translating…";
      refreshRow(variant);
      const got = await translateTo(fetch, src, LANG_OF[variant]);
      pending.delete(variant);
      if (got) cache[key] = got; // a blip is not remembered — the next open asks again
    }
    const t = cache[key] || "";
    node.placeholder = t ? hintFor(t) : "Couldn't translate — tap ↻ to try again";
    if (t) { suggests[variant] = t; node.dataset.suggest = t; }
    refreshRow(variant);
  }

  // The ↻: translate this one line again, now. The new wording is machine text,
  // so a line the baker had typed over becomes translatable again.
  async function regenOne(variant) {
    const node = boxes[variant];
    const src = englishSource(variant);
    if (!src) { toast("Type the English for it above first, then tap ↻"); return; }
    if (!translateAllowed()) { toast("No connection — translations fill when you're back online"); return; }
    const key = `${LANG_OF[variant]}|${src}`;
    pending.add(variant);
    refreshRow(variant);
    const t = await translateTo(fetch, src, LANG_OF[variant]);
    pending.delete(variant);
    if (!t) { refreshRow(variant); toast("Couldn't translate just now — try again in a moment"); return; }
    cache[key] = t;
    manualSet.delete(variant); // she asked for a translation — the line is machine again
    regen.add(variant);
    regenSrc[variant] = src;
    node.value = t;
    node.placeholder = hintFor(t);
    refreshRow(variant);
    toast("Translated — tap Update to keep it");
  }

  function oneRow(variant) {
    const field = FIELD_LABEL[SRC_OF[variant]];
    const lang = LANG_OF[variant];
    return el("div", { class: "field", style: "margin-bottom:8px", dataset: { variant } },
      el("label", {}, `${field} — ${LANG_LABEL[lang]}`),
      wraps[variant]);
  }

  function langSection(lang) {
    return el("div", { style: "margin-top:10px" },
      el("p", { style: "margin:0 0 2px;font-weight:700;font-size:13px;color:var(--brown-dark)" }, LANG_LABEL[lang]),
      ...LANG_VARIANTS[lang].map(oneRow));
  }

  // Closed until its title is tapped, and shut again the moment the baker taps
  // anywhere outside it — see openCards at the top of this module.
  const transBody = el("div", { class: "trans-body", hidden: true },
    el("p", { class: "card-sub", style: "margin:8px 0 0" },
      "The same text in 中文 and Bahasa Malaysia, worked out for you. Tap the → in a line to take the suggested words, or type your own. A line that already has words shows ↻ instead — tap it for fresh wording. If you leave a line blank, it will be filled with English."),
    langSection("zh"),
    langSection("ms"));
  const caret = el("span", { class: "trans-caret" }, "▸");
  // The card owns whether it is open rather than reading it back off the DOM,
  // and hands the same close() to the outside-tap rule.
  const controller = { card: null, open: false, close: null };
  const shutCard = () => {
    transBody.hidden = true;
    caret.textContent = "▸";
    controller.open = false;
    openCards.delete(controller);
  };
  const transHead = el("button", { class: "trans-head", type: "button" },
    el("span", {}, "Product text for your customers (中文 / Bahasa Malaysia)"),
    caret);
  transHead.addEventListener("click", () => {
    if (controller.open) { shutCard(); return; }
    controller.open = true;
    controller.close = shutCard;
    transBody.hidden = false;
    caret.textContent = "▾";
    openCards.add(controller);
    for (const variant of ALL_VARIANTS) loadSuggestion(variant);
  });
  const translations = el("div", { class: "card" }, transHead, transBody);
  controller.card = translations;

  for (const variant of ALL_VARIANTS) refreshRow(variant);

  const costEl = el("p", { class: "card-sub", style: "margin:0 0 10px" });
  const sumEl = el("div"); // "How it adds up:" breakdown under the lines, empty until a line is filled
  const recipeCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Recipe (per unit)"),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "Type the ingredients… or pick another product to make a bundle (e.g. 3 × Chicken Jerky pouch) — its own recipe is used automatically. Under each line is how its cost is counted (amount × price); the list below adds the lines up and shows each one's share of the total. Each ingredient line can also carry a short private note about itself for this product alone (e.g. which cut or brand of meat) — for your eyes only, never shown to customers."),
    costEl,
    el("div", { id: "recipe-lines" }),
    sumEl,
    el("div", { class: "btn-row" },
      button("＋ Add ingredient", () => {
        recipeDraft.push({ ingredientId: "", qty: "", unit: "" });
        renderRecipeLines();
      }, "soft"),
      button("＋ Add product", () => {
        recipeDraft.push({ productId: "", qty: "", unit: "" });
        renderRecipeLines();
      }, "soft")));

  function renderRecipeLines() {
    const costs = recipeLineCosts(state, { id: product && product.id, recipe: recipeDraft });
    // Round each line to its display cents first so the lines the owner sees
    // always add up exactly to the total shown (a raw-sum rounding could differ
    // from her + list by a cent when a line cost has more than 2 decimals).
    const shown = costs.map(round2);
    costEl.textContent = `Est. ingredient cost / unit: ${fmtRM(shown.reduce((s, v) => s + v, 0), state.settings.currency)}`;
    const box = recipeCard.querySelector("#recipe-lines");
    box.replaceChildren(...recipeDraft.map((line, i) =>
      recipeLine(state, line, i, recipeDraft, renderRecipeLines, product && product.id, costs[i])));
    sumEl.replaceChildren(...addUpBreakdown(state, recipeDraft, shown));
  }

  // What to keep of the translated boxes when the form saves: which are hers
  // (override), which are machine and from what English (src), and which stored
  // values must be dropped because their English went blank or was cleared.
  function trCollect() {
    const vals = {};
    const override = [];
    const src = {};
    const drop = [];
    for (const variant of ALL_VARIANTS) {
      const raw = String(boxes[variant].value ?? "").trim();
      const es = englishSource(variant);
      const manual = manualSet.has(variant);
      if (manual) {
        override.push(variant);
        if (raw) vals[variant] = raw;
        else if (product && Object.prototype.hasOwnProperty.call(product, variant)) drop.push(variant);
        continue;
      }
      if (!raw) continue;
      if (!es) {
        if (product && Object.prototype.hasOwnProperty.call(product, variant)) drop.push(variant);
        continue;
      }
      if (regen.has(variant)) { src[variant] = regenSrc[variant] || es; vals[variant] = raw; continue; }
      vals[variant] = raw; // machine text from an earlier save — kickoff reconciles it against English
    }
    return { vals, override, src, drop };
  }

  // Reads the form; returns { error } or { values, tr } ready to save.
  function collect() {
    const pname = name.value.trim();
    if (!pname) return { error: "Product needs a name" };
    const unitVal = unit.value.trim();
    if (!unitVal) {
      return { error: "Pick the selling unit — customers see it after the price. Add new ones under More → Units first." };
    }
    const chosenUom = byId(state.uoms, unitVal);
    const recipe = [];
    for (const l of recipeDraft) {
      const qty = Number(l.qty) || 0;
      if (!(qty > 0)) continue; // empty rows and 0-qty rows are dropped, like ingredients before
      if (l.productId && !l.ingredientId) {
        recipe.push({ productId: l.productId, qty, unit: (l.unit || "").trim() });
      } else if (l.ingredientId) {
        const rec = { ingredientId: l.ingredientId, qty, unit: (l.unit || "g").trim() };
        const desc = String(l.description || "").trim();
        if (desc) rec.description = desc;
        recipe.push(rec);
      }
    }
    const cycle = validateRecipeNoCycle(state, { id: product && product.id, name: pname, recipe });
    if (cycle) return { error: cycle };
    const limitVal = limit.value === "" ? undefined : Math.max(1, Number(limit.value));
    let closeVal;
    if (closeDays.value !== "") {
      const raw = Number(closeDays.value);
      if (!Number.isFinite(raw)) return { error: "Closes days must be a number" };
      closeVal = Math.floor(raw);
      if (closeVal < 0) return { error: "Closes days must be 0 or more" };
    }
    let cancelVal;
    if (cancelDays.value !== "") {
      const raw = Number(cancelDays.value);
      if (!Number.isFinite(raw)) return { error: "Change/cancel days must be a number" };
      cancelVal = Math.floor(raw);
      if (cancelVal < 0) return { error: "Change/cancel days must be 0 or more" };
    }
    const descVal = desc.value.trim();
    const servingVal = serving.value.trim();
    // The sell days, and the old from–to pair they replace: its period was read in
    // as a mark when the card opened, so dropping the pair loses nothing.
    const sellRules = availability.collect();
    const drop = ["validFrom", "validTo"];
    if (!sellRules) drop.push("sellRules");
    const values = {
      name: pname,
      unit: chosenUom ? chosenUom.name : unitVal,
      uomId: chosenUom ? chosenUom.id : undefined,
      price: price.value === "" ? undefined : Number(price.value),
      limit: limitVal,
      closeDays: closeVal,
      cancelDays: cancelVal,
      description: descVal || undefined,
      servingTip: servingVal || undefined,
      recipe,
    };
    if (sellRules) values.sellRules = sellRules;
    return { values, tr: trCollect(), drop };
  }

  return { name, unit, price, limit, closeDays, cancelDays, desc, serving, translations, availability, recipeCard, renderRecipeLines, collect };
}

// Fold the translated boxes + their provenance onto a saved product row.
// `tr` is what collect() returned: the override list is the FULL set of boxes
// the baker owns (so an old machine entry she now types over stops being auto),
// `src`/`drop` are the ones to record or forget.
function applyTrMeta(p, tr) {
  if (!tr) return;
  for (const k of tr.drop) delete p[k];
  const src = { ...(p.trSrc || {}) };
  for (const k of tr.override) delete src[k];
  for (const k of tr.drop) delete src[k];
  for (const [k, v] of Object.entries(tr.src)) src[k] = v;
  if (tr.override.length) p.trOverride = tr.override;
  else delete p.trOverride;
  const keys = Object.keys(src);
  if (keys.length) p.trSrc = src;
  else delete p.trSrc;
  for (const [k, v] of Object.entries(tr.vals)) {
    if (v === undefined) delete p[k];
    else p[k] = v;
  }
}

// After a save/publish, quietly finish the job online: fill any box that still
// needs a translation (or drop one whose English went away), then persist and
// push the finished text to the shop if the product is live. Never touches a box
// the baker typed. Offline or offline-midway → leave as is; the next save or
// Publish simply tries again.
async function kickoffAutoTranslate(state, product) {
  if (!translateAllowed() || !product) return;
  try {
    const changed = await autoTranslateProduct(product, (url) => fetch(url));
    if (!changed.length) return;
    save(state);
    if (isLive(product)) maybeSyncStorefront(state);
  } catch {
    /* transient blip — the next save or Publish retries */
  }
}

// Move a product between Draft / On the shop / Hidden. Live → hidden takes it
// off the menu (history kept); hidden/draft → live puts it back. Publishing
// re-runs auto-translate so a draft built offline reads correctly the moment
// it can go up.
function setProductState(state, p, target, root) {
  const wasDraft = isDraft(p);
  if (target === "live") {
    p.active = true;
    delete p.draft;
    save(state);
    maybeSyncStorefront(state);
    toast(wasDraft ? `"${p.name}" is on the shop now` : `"${p.name}" back on the menu`);
    renderAll(root, state);
    if (wasDraft) kickoffAutoTranslate(state, p);
  } else {
    p.active = false;
    delete p.draft;
    save(state);
    maybeSyncStorefront(state);
    toast(`"${p.name}" hidden — history kept`);
    renderAll(root, state);
  }
}

// The common field layout under whichever shell (card or pop-up) hosts it.
function editorFields(state, editor) {
  return el("div", {},
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Name"), editor.name),
      el("div", {}, el("label", {}, "Unit"), editor.unit)),
    el("div", { class: "field" }, el("label", {}, "Description (customers read it on your shop)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "A sentence or two about what this is — e.g. chicken jerky, soft, chewy strips. Blank shows nothing."),
      editor.desc),
    el("div", { class: "field" }, el("label", {}, "Feeding tip (sent in your follow-up message)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "A short way-to-feed line — e.g. “Tear into small pieces.” Blank keeps the follow-up simple."),
      editor.serving),
    editor.translations,
    el("div", { class: "field" }, el("label", {}, "Sell price"), editor.price),
    el("div", { class: "field" }, el("label", {}, "Daily limit (optional)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "Max pouches per batch/posting day. Limits add up for availability — 12 chicken + 12 duck = 24 left."),
      editor.limit),
    editor.availability.card,
    el("div", { class: "field" }, el("label", {}, "Orders close (days before delivery)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "Customers must pick a delivery date at least this many days away. Blank or 0 = any open day. This is only the notice you need — the product still shows on the shop, with a note saying so."),
      editor.closeDays),
    el("div", { class: "field" }, el("label", {}, "Changes or cancellations (days before delivery)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "How long a customer may still change or cancel this product's order — shown on the shop with the product. This only tells the customer; it never blocks you, you always move orders by hand. Blank or 0 = nothing shown."),
      editor.cancelDays),
    editor.recipeCard);
}

// The always-visible "New product" card at the top (the add form stays put even
// while an Edit pop-up is open, like "+ New order" does under the order pop-up).
function newProductCard(state, root) {
  const editor = buildEditor(state, null);
  const card = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New product"),
    editorFields(state, editor),
    button("Add product", () => {
      const { error, values, tr } = editor.collect();
      if (error) return toast(error);
      // New products start as a draft — fully built but not on the shop (and not
      // orderable) until the owner publishes it. active:false keeps it out of
      // every "for sale" list automatically; draft:true marks its state.
      const row = { id: newId("prd"), ...values, ...newDraftRow() };
      applyTrMeta(row, tr);
      state.products.push(row);
      toast("Saved as a draft — Publish it when it's ready to sell");
      save(state);
      renderAll(root, state);
      kickoffAutoTranslate(state, row); // fill the 中文/BM boxes online, if any
    }, "block primary"));

  editor.renderRecipeLines();
  return card;
}

// Tap "Edit" on a product: the same form opens over the screen, saves in place,
// then closes. Mirrors how Orders edits a row.
function openEditProductPopup(state, product, root) {
  const editor = buildEditor(state, product);
  showPopup(el("div", { class: "popup-title-row" }, "Edit product"), (refresh, close) => {
    const body = el("div", {},
      editorFields(state, editor),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update product", () => {
          const { error, values, tr, drop } = editor.collect();
          if (error) return toast(error);
          const wasLive = isLive(product);
          Object.assign(product, values);
          for (const k of drop || []) delete product[k];
          applyTrMeta(product, tr);
          toast("Product updated");
          save(state);
          if (wasLive) maybeSyncStorefront(state); // live text changed → shop gets it
          close();
          renderAll(root, state);
          kickoffAutoTranslate(state, product); // fill / refresh translations online
        }, "primary")));
    editor.renderRecipeLines();
    return body;
  }, { wide: true });
}

// Under a FILLED recipe row: how that line's cost is counted, e.g. an
// ingredient line "100 g × RM 0.01 = RM 1.00" or a set line "2 × RM 1.00 =
// RM 2.00" (qty × the set's per-unit cost). A filled row whose
// ingredient/product has no cost typed yet reads "no cost set" honestly.
// Blank and 0-qty rows show nothing.
function captionForLine(state, line, cost) {
  if (!(line.ingredientId || line.productId)) return null;
  const qty = Number(line.qty) || 0;
  if (!(qty > 0)) return null;
  const cur = state.settings.currency;
  let text = "no cost set";
  if (cost > 0) {
    // The rate shown is the line's own cost ÷ qty — the amount actually applied
    // (an ingredient priced per pack, e.g. "500 g box RM 4.00", reads back as
    // its worked-out per-unit price), so "amount × price = this line's RM" is
    // always exact and the working can't drift from the number above it.
    const rate = cost / qty;
    const ing = byId(state.ingredients, line.ingredientId);
    if (line.productId && !line.ingredientId) {
      text = `${trimNum(qty)} × RM ${fmtCpu(rate)} = ${fmtRM(cost, cur)}`;
    } else {
      const unit = String(line.unit || "").trim() || (ing && ing.unit) || "";
      text = `${trimNum(qty)}${unit ? ` ${unit}` : ""} × RM ${fmtCpu(rate)} = ${fmtRM(cost, cur)}`;
    }
  }
  return el("span", { class: "line-cost" }, text);
}

// A small "How it adds up:" table under the recipe lines, one row per FILLED
// line (+ its RM), ending in the total — so the owner can read the sum top to
// bottom and watch it land on the header number. Rows with no cost yet say so.
// Returns [] when nothing is filled, so no empty table shows.
function addUpBreakdown(state, draft, shown) {
  const cur = state.settings.currency;
  const rows = [];
  for (let i = 0; i < draft.length; i++) {
    const line = draft[i];
    const q = Number(line.qty) || 0;
    if (!(q > 0)) continue;
    let name = null;
    if (line.productId && !line.ingredientId) {
      const p = byId(state.products, line.productId);
      name = p ? p.name : "(deleted)";
    } else if (line.ingredientId) {
      const g = byId(state.ingredients, line.ingredientId);
      name = g ? g.name : "(deleted ingredient)";
    }
    if (name == null) continue; // row not filled yet
    rows.push({ name, val: shown[i], zero: shown[i] === 0 });
  }
  if (!rows.length) return [];

  const grid = el("div", { class: "cost-grid" });
  const total = rows.reduce((s, r) => s + r.val, 0);
  // Each line also shows its own share of the total, so the owner can see which
  // ingredient drives the cost. Meaningless when nothing has a cost yet (total 0).
  // Every line sits on its own soft strip (rounded, with the name and its % on
  // the same band) so a % far to the right still clearly belongs to its line.
  const showPct = total > 0;
  rows.forEach((r, k) => {
    const pct = showPct ? `${Math.round((r.val / total) * 100)}%` : "";
    grid.append(el("div", { class: "cost-row" },
      el("div", { class: "cost-op" }, k === 0 ? "·" : "+"),
      el("div", { class: "cost-val" }, fmtRM(r.val, cur)),
      el("div", { class: "cost-name" }, r.name + (r.zero ? "  (no cost set)" : "")),
      ...(showPct ? [el("div", { class: "cost-pct" }, pct)] : [])));
  });
  grid.append(el("div", { class: "cost-row cost-total-row" },
    el("div", { class: "cost-op" }, "="),
    el("div", { class: "cost-val cost-total-val" }, fmtRM(total, cur)),
    ...(showPct ? [el("div", { class: "cost-pct" }, "100%")] : [])));
  return [el("div", { class: "cost-sum" },
    el("p", { class: "cost-sum-title" }, "How it adds up:"),
    grid)];
}

// Number display for recipe working: whole amounts plain ("100"), fractions
// trimmed (no trailing zeros, so 0.5 stays "0.5", 2.50 reads "2.5").
function trimNum(n) {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10000) / 10000);
}

// A per-unit cost in RM: plain 2 decimals when it's exact ("0.01", "12.00"),
// more only when the typed price needs them ("0.005").
function fmtCpu(n) {
  const v = Number(n) || 0;
  const r = round2(v);
  return v === r ? r.toFixed(2) : String(Math.round(v * 10000) / 10000);
}

function recipeLine(state, line, i, draft, refresh, selfId, cost) {
  // A line is a component (another product, i.e. a set) when it carries a
  // productId field (even before one is chosen). Ingredient and product rows
  // are different drop-downs.
  const isProductRow = Object.prototype.hasOwnProperty.call(line, "productId") && !line.ingredientId;
  if (isProductRow) {
    return productRecipeLine(state, line, i, draft, refresh, selfId, cost);
  }

  const ing = byId(state.ingredients, line.ingredientId);
  const mismatch = ing && line.unit && ing.unit && line.unit !== ing.unit;

  let ingOpts = state.ingredients.filter((x) => x.active !== false)
    .map((x) => ({ value: x.id, label: x.name }));
  if (line.ingredientId && !ingOpts.some((o) => o.value === line.ingredientId)) {
    const hidden = byId(state.ingredients, line.ingredientId);
    if (hidden) ingOpts = [...ingOpts, { value: hidden.id, label: `${hidden.name} (hidden)` }];
  }
  const ingSel = select(ingOpts, line.ingredientId,
    () => {
      line.ingredientId = ingSel.value;
      const chosen = byId(state.ingredients, line.ingredientId);
      if (chosen && !line.unit) line.unit = chosen.unit;
      refresh();
    }, "Ingredient…");

  const qty = el("input", { class: "input", type: "number", inputmode: "decimal", step: "any",
    value: line.qty, style: "min-height:38px",
    onchange: () => { line.qty = Number(qty.value); refresh(); } });
  const unitInp = el("input", { class: "input", placeholder: "unit", value: line.unit,
    style: "min-height:38px", onchange: () => { line.unit = unitInp.value.trim(); refresh(); } });
  // A private per-product note under the ingredient line — "which cut / brand is
  // this?" Written separately for each product, so the same ingredient can read
  // differently here and there. Never published (the storefront drops recipes)
  // and never on a label.
  const note = el("input", { class: "input line-note",
    placeholder: "Describe this ingredient in this product (for your eyes only) — optional",
    value: line.description || "",
    onchange: () => { line.description = note.value.trim() || undefined; refresh(); } });

  return el("div", { class: "ing-row" },
    ingSel,
    qty,
    el("span", { class: "unit" }, unitInp),
    button("✕", () => { draft.splice(i, 1); refresh(); }, "ghost small"),
    mismatch ? el("div", { class: "warn", style: "grid-column:1/-1;margin:0" },
      `Unit "${line.unit}" differs from ${ing.name}'s unit (${ing.unit}) — check this line.`) : null,
    captionForLine(state, line, cost),
    line.ingredientId ? note : null);
}

function productRecipeLine(state, line, i, draft, refresh, selfId, cost) {
  // Drop-down of every other product (hidden ones stay selectable so old sets
  // keep working). The product being edited is excluded — a set can't hold
  // itself, and validateRecipeNoCycle is the backstop.
  let prodOpts = state.products
    .filter((p) => p.id !== selfId && p.draft !== true && p.active !== false)
    .map((p) => ({ value: p.id, label: p.name }));
  if (line.productId && !prodOpts.some((o) => o.value === line.productId)) {
    const hidden = byId(state.products, line.productId);
    if (hidden) prodOpts = [...prodOpts, { value: hidden.id, label: `${hidden.name} (hidden)` }];
  }
  const prodSel = select(prodOpts, line.productId,
    () => {
      line.productId = prodSel.value;
      const chosen = byId(state.products, line.productId);
      line.unit = chosen ? (chosen.unit || "") : "";
      refresh();
    }, "Product…");

  const qty = el("input", { class: "input", type: "number", inputmode: "numeric", step: "any", min: "1",
    value: line.qty, style: "min-height:38px",
    onchange: () => { line.qty = Number(qty.value); refresh(); } });
  // The unit comes from the chosen product and is read-only — a set counts
  // whole copies of the component, and its recipe defines the rest.
  const unitInp = el("input", { class: "input", placeholder: "unit", value: line.unit,
    style: "min-height:38px", readonly: true, title: "Selling unit of the chosen product" });

  return el("div", { class: "ing-row" },
    prodSel,
    qty,
    el("span", { class: "unit" }, unitInp),
    button("✕", () => { draft.splice(i, 1); refresh(); }, "ghost small"),
    captionForLine(state, line, cost));
}

function productCard(state, p, root) {
  const cost = costOf(state, p);
  const usedBy = state.orders.some((o) => o.productId === p.id);
  const usedInSets = state.products
    .filter((q) => q !== p && (q.recipe || []).some((l) => l.productId === p.id))
    .map((q) => q.name);
  const protect = usedBy || usedInSets.length > 0;
  const desc = String(p.description || "").trim();

  const subParts = [p.unit, p.limit ? `${p.limit}/day` : null,
    p.price != null ? `${fmtRM(p.price, state.settings.currency)} sell` : null,
    `${fmtRM(cost, state.settings.currency)} / unit`].filter(Boolean);
  const lines = (p.recipe || []).map((l) => {
    if (l.productId && !l.ingredientId) {
      const comp = byId(state.products, l.productId);
      return `${l.qty} × ${comp ? comp.name : "(deleted)"}`;
    }
    const ing = byId(state.ingredients, l.ingredientId);
    return `${l.qty}${l.unit} ${ing ? ing.name : "(deleted)"}`;
  });

  const actions = [button("Edit", () => openEditProductPopup(state, p, root), "ghost small")];
  if (isDraft(p)) {
    actions.push(button("Publish", () => setProductState(state, p, "live", root), "soft small"));
    actions.push(button("Delete", () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  } else if (isHidden(p)) {
    actions.push(button("Unhide", () => setProductState(state, p, "live", root), "ghost small"));
    if (!protect) actions.push(button("Delete", () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  } else {
    // Live: Hide when it has history/use (keeps PO + sets working), Delete when clean.
    actions.push(button(protect ? "Hide" : "Delete",
      () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  }

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, p.name),
        el("p", { class: "card-sub" }, subParts.join(" · ")),
        desc ? el("p", { class: "product-desc" }, desc) : null,
        usedInSets.length
          ? el("p", { class: "po-breakdown" }, `Used in: ${usedInSets.map((n) => `"${n}"`).join(", ")}`)
          : null),
      el("div", { class: "li-right" }, ...actions)),
    lines.length ? el("p", { class: "po-breakdown" }, lines.join("  ·  ")) : null);
}

function deleteProduct(state, p, usedBy, usedInSets, root) {
  const protect = usedBy || usedInSets.length > 0;
  const msg = usedBy
    ? `"${p.name}" has orders on it, so it can't be deleted. Hide it instead — history is kept and the PO still lists it.`
    : usedInSets.length
      ? `"${p.name}" is used to make ${usedInSets.map((n) => `"${n}"`).join(" and ")}. Hide it instead — the sets and PO will still use it.`
      : `Delete "${p.name}"? Its recipe will be removed.`;
  confirmDialog(msg, () => {
    if (protect) {
      p.active = false;
      delete p.draft;
      toast("Product hidden");
    } else {
      state.products = state.products.filter((x) => x.id !== p.id);
      toast("Product deleted");
    }
    save(state);
    maybeSyncStorefront(state); // keep the storefront menu in sync
    renderAll(root, state);
  }, protect ? { yesLabel: "Hide it" } : { danger: true, yesLabel: "Delete" });
}
