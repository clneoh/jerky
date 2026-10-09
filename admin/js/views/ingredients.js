// views/ingredients.js — ingredient master. Each ingredient cooks in one unit
// (picked from the Units list) and can carry pack prices from any number of
// suppliers (each a pack size + price), so the PO knows exactly what to buy and
// from the cheapest shop. New ingredients go in the always-visible card at the
// top; tapping Edit opens the same form in a pop-up, like products and orders.

import { el, button, select, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { byId, fmtRM, newId, round2, save } from "../state.js";
import { fmtStockAmount, priceEntryLabels, belowReserve, chosenSupplier, trimNum } from "../purchasing.js";
import { logPriceMoves, priceLogOf } from "../prices.js";
import { setStock, stockLogOf, stockRowUndo, undoStockRow } from "../stock.js";
import { dayMonth, longDate } from "../dates.js";
import { bakeryName, journalBodyEl, journalButtons, journalSheet } from "../journal.js";

export function renderIngredients(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const items = state.ingredients.filter((x) => x.active !== false);
  const hidden = state.ingredients.filter((x) => x.active === false);

  const form = newIngredientCard(state, root);

  const low = items.filter((ing) => belowReserve(Number(ing.safetyBase) || 0, Number(ing.onHand) || 0));
  const banner = low.length ? el("div", { class: "low-stock-banner" },
    el("p", { class: "low-stock-title" }, "Low stock — below your keep level"),
    ...low.map((ing) => el("p", { class: "low-stock-line" },
      `${ing.name} — have ${fmtStockAmount(state, ing, Math.max(0, Number(ing.onHand) || 0))}, keep ${fmtStockAmount(state, ing, Number(ing.safetyBase) || 0)}`))) : null;

  const cards = items.map((ing) => ingredientCard(state, ing, root));
  const hiddenSection = hidden.length ? el("div", {},
    el("h2", { class: "section" }, "Hidden ingredients"),
    ...hidden.map((ing) => ingredientCard(state, ing, root))) : [];

  root.replaceChildren(
    form,
    ...(banner ? [banner] : []),
    el("h2", { class: "section" }, `Ingredients (${items.length})`),
    ...(cards.length ? cards : [emptyState("No ingredients yet",
      "Add every ingredient, its cooking unit, and its supplier prices so the PO can price real packs.")]),
    ...(Array.isArray(hiddenSection) ? [] : [hiddenSection]));
}

// The cooking unit an ingredient already uses (its uomId, else by unit name).
// Exported for the Money screen's Day one form, which takes a stock count in bulk and
// must resolve an ingredient's unit the same way this screen does (17 Sep 2026).
export function currentUomId(state, ing) {
  const list = state.uoms || [];
  if (ing && ing.uomId) return ing.uomId;
  if (ing && ing.unit) {
    const byName = list.find((u) => String(u.name || "").toLowerCase() === String(ing.unit).toLowerCase());
    if (byName) return byName.id;
  }
  return (list.find((u) => u.family === "weight") || list[0] || { id: "" }).id;
}

function cookingFamilyOf(list, uomId) {
  return byId(list, uomId)?.family || "count";
}
export { cookingFamilyOf };

// Shared fields + collect(). `ingredient` is null for a new ingredient, or the
// real object when editing — so the add card and the Edit pop-up share it. The
// two supplier rows live in a draft, so changing the cooking unit re-renders
// them (pack units must stay in the same family) without losing typed values.
function buildIngredientEditor(state, ingredient) {
  const list = state.uoms || [];
  const name = el("input", { class: "input", placeholder: "e.g. Strong flour", "data-suggest": "Strong flour", value: ingredient?.name || "" });
  const costHint = el("p", { class: "hint" });
  const unitSel = select((state.uoms || []).map((u) => ({ value: u.id, label: u.name })),
    currentUomId(state, ingredient), () => { syncDrafts(); renderPriceRows(); });
  const cost = el("input", { class: "input", type: "number", inputmode: "decimal", step: "0.001",
    placeholder: "cost per unit (RM)", value: ingredient?.costPerUnit ?? "" });
  const note = el("input", { class: "input",
    placeholder: "e.g. brand or grade, or where you buy it (optional)",
    value: ingredient?.purchaseNote || "" });
  // Labour, electricity, your own time: real costs inside a recipe that she never
  // buys. The switch keeps them off every shopping list while their cost still
  // prices the products they go into (16 Sep 2026 — her words: "certain ingredient we
  // dont purchase ... like labour and electricity").
  const box = el("input", { type: "checkbox", checked: ingredient?.notPurchased === true,
    onchange: () => { notPurchased = box.checked; } });
  let notPurchased = ingredient?.notPurchased === true;
  const notBought = el("div", { class: "avail-listed" },
    el("label", { class: "switch" }, box, el("span", { class: "switch-track" }, el("span", { class: "switch-knob" }))),
    el("span", { class: "avail-listed-text" },
      "Not something I buy — it only ever costs. It still counts in a recipe's cost, but it never appears on a shopping list or a purchase order."));

  // Draft of the supplier price rows — as many as the ingredient already has,
  // or a blank one when it has none. Stored here (not on the ingredient) so an
  // edit can be cancelled cleanly; values survive a unit-change re-render.
  const existing = ingredient && Array.isArray(ingredient.supplierPrices) ? ingredient.supplierPrices : [];
  const drafts = (existing.length ? existing : [{}]).map((e) => ({
    supplierId: e.supplierId || "", qty: e.qty ?? "", uomId: e.uomId || "", price: e.price ?? "",
  }));
  const rows = [];
  const priceBox = el("div", { class: "price-rows" });

  function costHintText() {
    const u = byId(list, unitSel.value);
    return `RM per 1 ${u ? u.name : "unit"}. The app uses it to estimate cost when the ingredient has no supplier price below.`;
  }

  function suppliersOptions(includeId) {
    let opts = (state.suppliers || []).filter((s) => s.active !== false)
      .map((s) => ({ value: s.id, label: s.name }));
    if (includeId && !opts.some((o) => o.value === includeId)) {
      const sup = byId(state.suppliers || [], includeId);
      if (sup) opts = [...opts, { value: sup.id, label: `${sup.name} (hidden)` }];
    }
    return opts;
  }

  function makeRow(draft) {
    const family = cookingFamilyOf(list, unitSel.value);
    const cookingUnit = byId(list, unitSel.value);
    const packDefault = () => {
      if (draft.uomId && byId(list, draft.uomId)?.family === family) return draft.uomId;
      if (cookingUnit?.family === family) return cookingUnit.id;
      return (familyOptions(family)[0] || {}).value || "";
    };
    const supplierSel = select(suppliersOptions(draft.supplierId), draft.supplierId, null, "No supplier…");
    const qty = el("input", { class: "input", type: "number", inputmode: "decimal", step: "any",
      placeholder: "Pack size", value: draft.qty });
    const packSel = select(familyOptions(family), packDefault(), null);
    const price = el("input", { class: "input", type: "number", inputmode: "decimal", step: "0.01",
      placeholder: "RM", value: draft.price });
    const supplierName = () =>
      (suppliersOptions(supplierSel.value).find((o) => o.value === supplierSel.value) || {}).label || "this supplier";

    return {
      supplierSel, qty, packSel, price,
      syncDraft() {
        draft.supplierId = supplierSel.value;
        draft.qty = qty.value;
        draft.uomId = packSel.value || draft.uomId;
        draft.price = price.value;
      },
      read() {
        const filled = supplierSel.value || qty.value.trim() !== "" || price.value.trim() !== "";
        if (!filled) return null;
        const s = supplierSel.value;
        if (!s) return { error: "A price row has a pack or price but no supplier chosen — pick the shop or clear the row" };
        const q = Number(qty.value);
        if (!(q > 0)) {
          return { error: `${supplierName()}: add the pack size — how many ${cookingUnit?.name || "units"} come in one pack` };
        }
        const p = Number(price.value);
        if (price.value.trim() === "" || Number.isNaN(p) || p < 0) {
          return { error: `${supplierName()}: add the pack price in RM` };
        }
        if (!packSel.value) return { error: `${supplierName()}: pick the pack unit` };
        return { entry: { supplierId: s, qty: q, uomId: packSel.value, price: p } };
      },
    };
  }

  function familyOptions(family) {
    return list.filter((u) => u.family === family).map((u) => ({ value: u.id, label: u.name }));
  }

  function syncDrafts() {
    for (const r of rows) r.syncDraft();
  }

  function renderPriceRows() {
    const hasSuppliers = (state.suppliers || []).some((s) => s.active !== false);
    rows.length = 0;
    const rowEls = drafts.map((draft, i) => {
      const r = makeRow(draft);
      rows.push(r);
      const del = button("✕", () => { syncDrafts(); drafts.splice(i, 1); renderPriceRows(); }, "ghost small");
      del.classList.add("price-del");
      del.setAttribute("aria-label", "Remove this supplier price");
      return el("div", { class: "price-row" },
        el("div", { class: "price-grid" }, r.supplierSel, r.qty, r.packSel, r.price, del));
    });
    const hint = hasSuppliers ? null
      : el("p", { class: "warn", style: "margin:0 0 8px" },
          "No suppliers yet — add them under More → Suppliers first, then come back to price this ingredient.");
    priceBox.replaceChildren(
      el("p", { class: "price-row-label" },
        "Supplier prices (optional) — the PO buys from the cheapest. Add as many shops as you like."),
      ...(hint ? [hint] : []),
      ...rowEls,
      el("div", { style: "margin-top:8px" },
        button("＋ Add another supplier price", () => { syncDrafts(); drafts.push({ supplierId: "", qty: "", uomId: "", price: "" }); renderPriceRows(); }, "ghost small")));
  }

  function collect() {
    const n = name.value.trim();
    if (!n) return { error: "Ingredient needs a name" };
    const uomId = unitSel.value;
    const uom = byId(list, uomId);
    const supplierPrices = [];
    for (const r of rows) {
      const res = r.read();
      if (!res) continue;
      if (res.error) return { error: res.error };
      supplierPrices.push(res.entry);
    }
    return {
      values: {
        name: n,
        unit: uom ? uom.name : "g",
        uomId: uomId || undefined,
        costPerUnit: Number(cost.value) || 0,
        purchaseNote: note.value.trim() || undefined,
        supplierPrices: supplierPrices.length ? supplierPrices : undefined,
        // Only ever written when on; the edit path deletes the key when it is off, so
        // an unticked switch leaves an ingredient exactly as it was.
        notPurchased: notPurchased ? true : undefined,
      },
      drop: notPurchased ? [] : ["notPurchased"],
    };
  }

  costHint.textContent = costHintText();
  renderPriceRows();
  return { name, unitSel, cost, note, notBought, costHint, priceBox, collect };
}

function editorFields(editor) {
  return el("div", {},
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Name"), editor.name),
      el("div", {}, el("label", {}, "Cooking unit"), editor.unitSel)),
    // The switch sits above the cost, because it changes what the cost is FOR: a
    // price per unit of something she buys, or a cost of something she never will.
    editor.notBought,
    el("div", { class: "field" },
      el("label", {}, "Fallback cost"),
      editor.cost,
      editor.costHint),
    el("div", { class: "field" },
      el("label", {}, "Note (optional)"),
      editor.note,
      el("p", { class: "hint" }, "For you only — e.g. the brand or grade, or a buying reminder. Shows on this ingredient's card, never on products or the shop.")),
    editor.priceBox);
}

// The always-visible "New ingredient" card at the top (the add form stays put
// even while an Edit pop-up is open).
function newIngredientCard(state, root) {
  const editor = buildIngredientEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New ingredient"),
    editorFields(editor),
    button("Add ingredient", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      state.ingredients.push({ id: newId("ing"), ...values, active: true });
      toast("Ingredient added");
      save(state);
      renderAll(root, state);
    }, "block primary"));
}

// Tap "Edit" on an ingredient: the same form opens over the screen, saves in
// place, then closes. Mirrors Products and Orders.
function openEditIngredientPopup(state, ing, root) {
  const editor = buildIngredientEditor(state, ing);
  showPopup(el("div", { class: "popup-title-row" }, "Edit ingredient"), (refresh, close) => {
    return el("div", {},
      editorFields(editor),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update ingredient", () => {
          const { error, values, drop } = editor.collect();
          if (error) return toast(error);
          // A price corrected HERE is a price that moved, and the journal has to be told (v285).
          // A log that only ever held the moves made from a shopping list would be titled as
          // this ingredient's price history while quietly missing the rest of it.
          const before = Array.isArray(ing.supplierPrices)
            ? ing.supplierPrices.map((e) => ({ ...e }))
            : [];
          Object.assign(ing, values);
          for (const k of drop || []) delete ing[k];
          const moved = logPriceMoves(ing, before);
          toast(moved.length ? `Ingredient updated — ${moved.length} price change recorded` : "Ingredient updated");
          save(state);
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function ingredientCard(state, ing, root) {
  const usedBy = state.products
    .filter((p) => (p.recipe || []).some((l) => l.ingredientId === ing.id))
    .map((p) => p.name);

  const priceLabels = priceEntryLabels(state, ing);
  const perDisplay = ing.unit
    ? `${fmtRM(ing.costPerUnit, state.settings.currency)} / ${ing.unit}`
    : fmtRM(ing.costPerUnit, state.settings.currency);
  const mainSub = priceLabels.length
    ? priceLabels.join(" · ")
    : `${perDisplay} fallback`;

  const onHand = Math.max(0, Number(ing.onHand) || 0);
  const keep = Math.max(0, Number(ing.safetyBase) || 0);
  const below = belowReserve(keep, onHand);

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, ing.name),
        el("p", { class: "card-sub" }, mainSub),
        // A not-bought ingredient has nothing on a shelf, so it wears the fact instead
        // of a stock line reading zero.
        ing.notPurchased === true
          ? el("p", { class: "card-sub" }, "Not bought — a cost in your recipes, never on a shopping list")
          : el("div", {
            class: "stockline" + (onHand > 0 ? " has-stock" : " empty") + (below ? " low" : ""),
            role: "button",
            onclick: () => openAmountPopup(state, ing, root, "stock"),
          },
          el("span", { class: "stockline-label" }, "On hand"),
          el("span", { class: "stockline-qty" },
            `${onHand > 0 ? fmtStockAmount(state, ing, onHand) : "0"}${below ? " · low" : ""}`),
          el("span", { class: "stockline-edit" }, "Adjust")),
        ing.notPurchased === true ? null : el("div", {
          class: "keepline",
          role: "button",
          onclick: () => openAmountPopup(state, ing, root, "keep"),
        },
          el("span", { class: "stockline-label" }, "Keep at least"),
          el("span", { class: "stockline-qty" }, keep > 0 ? fmtStockAmount(state, ing, keep) : "—"),
          el("span", { class: "stockline-edit" }, keep > 0 ? "Edit" : "Set")),
        ing.purchaseNote ? el("p", { class: "card-sub" }, ing.purchaseNote) : null,
        usedBy.length ? el("p", { class: "po-breakdown" }, `Used in: ${usedBy.join(", ")}`) : null),
      el("div", { class: "li-right" },
        button("Edit", () => openEditIngredientPopup(state, ing, root), "ghost small"),
        // ★★ IT IS CALLED **STOCK CARD**, AND IT IS ALWAYS THERE (v386). Her words, after a hunt:
        // __"i want stock card"__ — and she had already said __"cannot find it"__ twice before that.
        //
        // ⚠️⚠️ WHAT WAS WRONG WAS THE WORD AND THE HIDING, NOT THE FEATURE. The record she was asking
        // for was built at v385 and sat behind a press labelled **"Journal"** — a word that does not
        // appear anywhere in her kitchen — and it was **hidden entirely** until something moved, so
        // most of her ingredients offered nothing at all to press. **A card she cannot find is a card
        // that does not exist.**
        //
        // ⚠️ So it is on EVERY ingredient now, and it says what will fill it when it is empty. That is
        // the opposite of the v285 rule it replaces — which hid the press because "an empty page would
        // read as a fault" — and the difference is that the page is no longer empty of WORDS: it names
        // the card and says what will appear on it.
        button("Stock card", () => openStockCard(state, ing), "ghost small"),
        button(usedBy.length ? "Hide" : "Delete", () => deleteIngredient(state, ing, usedBy.length > 0, root), "ghost small"))));
}

// ── The ingredient's STOCK CARD (v285 as a price journal, v385 stock added, v386 named) ───
//
// Only the MOVEMENTS are listed — her choice: *"only when the price moves, plus today"*.
// Buying the same thing at the same price again is stock, not news, so it is not here.
//
// Built on the same `journalSheet()` every other book in this app uses, so the screen, the
// paper, the shared text and the PDF (v283) are four readings of ONE description and cannot
// disagree about a row or a figure. Print and Share come with it for free.
function priceNowText(state, ing) {
  const cur = state.settings.currency || "RM";
  const c = chosenSupplier(state, ing);
  if (c) return `${fmtRM(c.price, cur)} per ${trimNum(c.qty)}${c.uomName} pack · ${c.name}`;
  const per = Number(ing.costPerUnit) || 0;
  return per > 0
    ? `${fmtRM(per, cur)} per ${ing.unit || "unit"} — your fallback cost`
    : "no price on file yet";
}

export function stockCardSheet(state, ing, refresh = null) {
  const cur = state.settings.currency || "RM";
  // Oldest first, so the page reads as a history rather than a feed. The log itself is newest
  // first, which is right for a record and wrong for a book.
  const log = priceLogOf(ing).slice().reverse();
  const priceLines = log.map((e) => ({
    what: `${longDate(e.at)} · ${e.supplierName || "no supplier"} · ${trimNum(e.qty)}${e.uomName} pack · was ${e.was == null ? "not on file" : fmtRM(e.was, cur)}`,
    amount: e.price,
  }));

  // ★★ AND THE STOCK SECTION (v385). Her words: __"why only show when there is price movement, qty
  // movement cannot?"__ — and the honest answer was that quantity movements were never recorded at
  // all. They are now, and they belong on the same page: "why is my flour at 2 kg" is the other half
  // of the same question as "what did the flour cost".
  //
  // ⚠️⚠️ THE QUANTITY IS NOT MONEY, AND THE MONEY COLUMN MUST NOT PRETEND IT IS. `amount` is
  // formatted by `money()` in the screen, the paper, the shared text and the PDF alike, so 500 grams
  // in it would print as "RM 500.00". Its money cell is therefore left EMPTY, which draws as an em
  // dash: the app's existing way of saying "there is no figure here", and true of a stock row.
  // **Dashes are honest; grams dressed as ringgit are not.**
  //
  // ⚠️⚠️ AND THE ROW IS ONE SENTENCE, NOT A COLUMN ROW — FOUND BY LOOKING, not by a test. The first
  // version put the date, the amount and the reason in `cols`, which the journal draws as aligned
  // columns. **On a phone that was unreadable**: `.journal-cols` widths are fixed for the FILING
  // page's five columns (a date column 3.5em wide, an order column 4.6em), so a four-column stock row
  // came out as "1 Oct..." and "Stockta..." — the words she needs, cut off. **A test asserting the
  // cell's TEXT cannot see a column that truncates it.** One wrapping sentence is what actually reads
  // on a phone, and it is exactly what the paper and the PDF will print, because they read `what`.
  // The amount goes LAST so the shape matches the price rows above it: date · what happened · figure.
  const stockLines = stockLogOf(ing).slice().reverse().map((e) => ({
    // ★★ COLUMNS, AND A FIGURE THAT IS NOT MONEY (v390). Her words: __"a stock card should be as clear
    // as a table with row and column"__. The three cells are When / What happened / Change, and the
    // change goes in its own cell through `val` — ⚠️ NOT through `amount`, which `money()` would print
    // as ringgit, so 500 grams would read "RM 500.00". **Dashes are honest; grams dressed as ringgit
    // are not** (v385), and a separate cell is how the number leaves the sentence without becoming a
    // price.
    cols: [dayMonth(e.at), e.what],
    val: stockDeltaText(state, ing, e.delta),
    // ⚠️ `what` IS STILL BUILT. The paper, the shared text and the PDF read it, and the columns are an
    // ARRANGEMENT of the same facts rather than a different set of them — the rule `journalSheet` sets
    // for `cols`, kept here.
    what: `${longDate(e.at)} · ${e.what} · ${stockDeltaText(state, ing, e.delta)}`,
    amount: null,
    // ★ AND THE LINE CAN BE TAKEN OFF THE CARD (v390). ⚠️⚠️ THIS RETURNS A BUTTON; IT DOES NOT DO THE
    // DELETING. The renderer calls `action()` once per row while DRAWING the card, so a function that
    // performed the removal would open a confirm for every line the moment the card was opened —
    // found by looking at the rendered screen, where the button was missing and nothing had asked.
    // ⚠️ `refresh` rebuilds the whole card, because the amount at the top moves with the row.
    action: typeof refresh === "function"
      ? () => button("✕", () => stockRowDelete(state, ing, e, refresh), "ghost small")
      : null,
  }));

  // ⚠️ A TABLE NEEDS ITS HEADINGS, or the columns are three unexplained stacks of text. ⚠️ AND THE
  // HEADER ROW CARRIES NO FIGURE OF ITS OWN BEYOND NAMING THE LAST COLUMN, so `val` is a NAME here.
  const STOCK_HEAD = { head: true, cols: ["When", "What happened"], val: "Change",
    what: "When · What happened · Change" };

  // ⚠️ A SECTION APPEARS ONLY WHEN IT HAS ROWS. A heading over nothing reads as a fault, and with
  // headings always present the sheet's own "nothing recorded yet" line could never show again.
  // ★★ AND **STOCK LEADS** (v386). Her words: __"i want stock card"__. This is a stock card first —
  // the amount on the shelf and where it went — and the price story is the second half of the same
  // page. Reading the price section first would bury the thing she opened it for.
  const lines = [
    ...(stockLines.length ? [{ heading: true, what: "Stock" }, STOCK_HEAD, ...stockLines] : []),
    ...(priceLines.length ? [{ heading: true, what: "Price" }, ...priceLines] : []),
  ];

  return journalSheet({
    title: `${ing.name} — stock card`,
    subtitle: `On hand: ${fmtStockAmount(state, ing, Number(ing.onHand) || 0)} · Price now: ${priceNowText(state, ing)}`,
    lines,
    totals: [],
    // ⚠️ A CARD THAT IS EMPTY STILL HAS TO SAY WHAT IT IS FOR — see the note on the press above. This
    // is the one line that replaces the hiding rule: it names the card and says what will fill it.
    empty: "Nothing on this card yet. It fills up as this ingredient moves: baking takes the recipe off your shelf, un-baking puts it back, Bought adds what you bought, and a stocktake or Day one sets the real amount. A price change goes on it too. So the first time you bake with this, or buy it, or count it, a line appears here.",
    // ⚠️ ONE EXPLANATION, NOT TWO. The `empty` line and this note say overlapping things, so on an
    // empty card both together read as a wall she has to wade through — found by looking at it. The
    // note is for a card that HAS rows, where it explains the columns; an empty card is explained by
    // its own sentence.
    note: lines.length
      ? "Stock: every time the amount on your shelf moved, and what moved it — baking takes the recipe off, un-baking puts it back, Bought adds what you bought, and a stocktake or Day one sets the real amount. Price: every time this ingredient's cost moved — what it moved to, and what it was before. Buying the same thing again at the same price is not a change, so it is not listed. The amount on the shelf and the price your recipes use are the two figures at the top."
      : "",
    where: "Ingredients",
    bakery: bakeryName(state),
  });
}

// The signed amount of one stock movement, with its unit — "+500 g", "−2.5 kg". ⚠️ MINUS IS THE
// TYPOGRAPHIC ONE (U+2212), the same glyph the money journals use, so a printed column lines up.
function stockDeltaText(state, ing, delta) {
  const n = Number(delta) || 0;
  return `${n < 0 ? "−" : "+"}${fmtStockAmount(state, ing, Math.abs(n))}`;
}

// ★★ TAKE ONE LINE OFF THE CARD (v390). Her words: __"certain listed i might want to delete after
// testing"__.
//
// ⚠️⚠️ A LINE ON THIS CARD IS A MOVEMENT, SO THE TWO GO TOGETHER — the row leaves the card AND its
// amount comes back off the shelf. Reversing only the list would leave her shelf holding packs she had
// just deleted the record of, and reversing only the shelf would leave a card whose rows no longer
// explain the figure it sits under. **They are one act, and this is the one place that does it.**
//
// ⚠️ AND THE CONFIRM SAYS THE NUMBER FIRST. `stockRowUndo` works out what the shelf would hold
// WITHOUT doing it, so she is told the figure before she commits — a one-way change to her stock is
// not something a phone tap should discover afterwards. ⚠️ Stock never goes below zero, so a reversal
// that would is clamped, and this is exactly why the clamp is named in advance rather than met later.
function stockRowDelete(state, ing, entry, refresh) {
  const plan = stockRowUndo(ing, entry);
  if (!plan) return;
  confirmDialog(
    `Remove this line from the card? Your ${ing.name} is ${fmtStockAmount(state, ing, plan.was)} now, and taking this movement back leaves ${fmtStockAmount(state, ing, plan.now)}. This cannot be undone.`,
    () => {
      undoStockRow(ing, entry);
      save(state);
      toast(`${ing.name} is now ${fmtStockAmount(state, ing, Number(ing.onHand) || 0)}`);
      refresh();
    },
    { danger: true, yesLabel: "Remove" });
}

function openStockCard(state, ing) {
  const cur = state.settings.currency || "RM";
  // ⚠️ THE SHEET IS BUILT INSIDE `makeBody`, NOT BEFORE IT. Removing a line moves the amount at the
  // top of the card as well as the list under it, so a sheet built once and merely re-shown would draw
  // the old figure — and `refresh` is what re-runs this.
  showPopup(el("div", { class: "popup-title-row" }, `${ing.name} — stock card`),
    (refresh) => {
      const sheet = stockCardSheet(state, ing, refresh);
      // ⚠️ `stock-journal` IS THE COLUMN SHAPE'S OWN SCOPE, and it is on the CALLER's wrapper rather
      // than baked into the renderer: the journal's column widths are measured for the filing page's
      // five columns, and this card's three need different ones. A scope named here moves this card
      // and nothing else.
      return el("div", { class: "stock-journal" },
        // THE TWO FIGURES NOW, ON SCREEN AND NOT ONLY ON PAPER. `journalBodyEl` deliberately does not
        // draw a sheet's subtitle — every other journal leans on the section wording above its
        // card — but her answer was "only when the price moves, PLUS TODAY", and "today" is the
        // half a movement list cannot carry by itself. ⚠️ Both figures, because a stock section
        // without the amount on the shelf would leave the reader doing the sum.
        el("p", { class: "card-sub", style: "margin:0 0 10px" },
          `On hand: ${fmtStockAmount(state, ing, Number(ing.onHand) || 0)} · Price now: ${priceNowText(state, ing)}`),
        journalBodyEl(sheet, cur),
        el("div", { class: "popup-actions" }, ...journalButtons(sheet, cur)));
    },
    // Her words: __"can optimise for desktop as well"__ — a table is the one thing that gets better
    // with width, so this card asks for a wider column on a big screen. See app.css.
    { className: "stock-card" });
}

// Set how much of an ingredient is on the shelf ("On hand"), or the level she
// wants to keep on it ("Keep at least", the reorder reserve). Both store a
// base-unit count; the popup lets her type in whatever unit of the family she's
// thinking in (g or kg, ml or L, pcs).
function openAmountPopup(state, ing, root, kind) {
  const isStock = kind === "stock";
  const units = (state.uoms || [])
    .filter((u) => u.family === cookingFamilyOf(state.uoms, currentUomId(state, ing)))
    .slice()
    .sort((a, b) => Number(a.toBase) - Number(b.toBase));
  const fallback = units[0] || { id: "", toBase: 1, name: "unit" };
  const toBase = (uid) => Number(byId(state.uoms || [], uid)?.toBase) || 1;
  const clean = (x) => String(parseFloat(Number(x).toFixed(4)));

  const cur = Math.max(0, Number(isStock ? ing.onHand : ing.safetyBase) || 0);
  const reversed = [...units].reverse();
  const within = reversed.find((u) => cur >= Number(u.toBase));
  let uid;
  if (within) uid = within.id;
  else if (isStock) uid = fallback.id;      // stock: smallest unit, today's behaviour
  else uid = (reversed[0] || fallback).id;  // keep: biggest unit, so "5" reads as 5 kg

  const num = el("input", { class: "input", type: "number", inputmode: "decimal", min: "0", step: "any",
    value: clean(cur / (toBase(uid) || 1)) });
  const unitSel = select(units.map((u) => ({ value: u.id, label: u.name })), uid, () => {
    const old = Number(num.value);
    const oldBase = toBase(uid) || 1;
    uid = unitSel.value;
    if (!Number.isNaN(old)) num.value = clean((old * oldBase) / (toBase(uid) || 1));
  });

  const clearLevel = (close) => {
    delete ing.safetyBase;
    toast(`${ing.name}: no minimum — the list won't top it up`);
    save(state);
    close();
    renderAll(root, state);
  };

  showPopup(el("div", { class: "popup-title-row" },
    `${isStock ? "On hand" : "Keep at least"} — ${ing.name}`), (refresh, close) => {
    const actions = [button("Cancel", close, "ghost")];
    if (!isStock) actions.push(button("No minimum", () => clearLevel(close), "ghost"));
    actions.push(button(isStock ? "Save stock" : "Save level", () => {
      const v = Number(num.value);
      if (num.value.trim() === "" || Number.isNaN(v) || v < 0) {
        return toast(isStock
          ? "Type how much you have, or tap Cancel"
          : "Type the level you want to keep, or tap No minimum");
      }
      const base = round2(v * (toBase(unitSel.value) || 1));
      if (isStock) {
        // ★★ A STOCKTAKE IS A MOVEMENT TOO (v385), so it goes in the journal. ⚠️ The row names BOTH
        // figures — "1.5 kg to 2 kg" — because a stocktake is a correction, and the only useful thing
        // about it later is what she changed it FROM. ⚠️ The setting-and-logging rule itself lives in
        // `setStock` (stock.js), where it is tested, rather than in this callback.
        setStock(ing, base, {
          why: "stocktake",
          label: (was, now) => `Stocktake — ${fmtStockAmount(state, ing, was)} to ${fmtStockAmount(state, ing, now)}`,
        });
        toast(`${ing.name}: on hand ${fmtStockAmount(state, ing, base)}`);
      } else if (base <= 0) {
        clearLevel(close);
        return;
      } else {
        ing.safetyBase = base;
        toast(`${ing.name}: keep at least ${fmtStockAmount(state, ing, base)}`);
      }
      save(state);
      close();
      renderAll(root, state);
    }, "primary"));
    return el("div", {},
      el("div", { class: "field" },
        el("label", {},
          isStock ? "How much do you have right now?" : "How much do you always want to keep on the shelf?"),
        el("div", { style: "display:flex;gap:8px;align-items:center" }, num, unitSel),
        el("p", { class: "hint" }, isStock
          ? "The shopping list buys whole packs only for what this doesn't cover. Marking an order Preparing takes its ingredients off automatically."
          : "Your order list tops this ingredient back up to this level (in whole packs) whenever it has dropped more than 10% below it, so you're never caught short after a busy posting day. Tap No minimum to leave it alone.")),
      el("div", { class: "popup-actions" }, ...actions));
  });
}

function deleteIngredient(state, ing, referenced, root) {
  const msg = referenced
    ? `"${ing.name}" is used in a recipe, so it can't be deleted. Hide it instead — the PO will still list it.`
    : `Delete "${ing.name}"?`;
  confirmDialog(msg, () => {
    if (referenced) {
      ing.active = false;
      toast("Ingredient hidden");
    } else {
      state.ingredients = state.ingredients.filter((x) => x.id !== ing.id);
      toast("Ingredient deleted");
    }
    save(state);
    renderAll(root, state);
  }, referenced ? { yesLabel: "Hide it" } : { danger: true, yesLabel: "Delete" });
}
