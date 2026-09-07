// views/ingredients.js — ingredient master. Each ingredient cooks in one unit
// (picked from the Units list) and can carry pack prices from any number of
// suppliers (each a pack size + price), so the PO knows exactly what to buy and
// from the cheapest shop. New ingredients go in the always-visible card at the
// top; tapping Edit opens the same form in a pop-up, like products and orders.

import { el, button, select, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { byId, fmtRM, newId, save } from "../state.js";
import { priceEntryLabels } from "../purchasing.js";

export function renderIngredients(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const items = state.ingredients.filter((x) => x.active !== false);
  const hidden = state.ingredients.filter((x) => x.active === false);

  const form = newIngredientCard(state, root);

  const cards = items.map((ing) => ingredientCard(state, ing, root));
  const hiddenSection = hidden.length ? el("div", {},
    el("h2", { class: "section" }, "Hidden ingredients"),
    ...hidden.map((ing) => ingredientCard(state, ing, root))) : [];

  root.replaceChildren(
    form,
    el("h2", { class: "section" }, `Ingredients (${items.length})`),
    ...(cards.length ? cards : [emptyState("No ingredients yet",
      "Add every ingredient, its cooking unit, and its supplier prices so the PO can price real packs.")]),
    ...(Array.isArray(hiddenSection) ? [] : [hiddenSection]));
}

// The cooking unit an ingredient already uses (its uomId, else by unit name).
function currentUomId(state, ing) {
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

// Shared fields + collect(). `ingredient` is null for a new ingredient, or the
// real object when editing — so the add card and the Edit pop-up share it. The
// two supplier rows live in a draft, so changing the cooking unit re-renders
// them (pack units must stay in the same family) without losing typed values.
function buildIngredientEditor(state, ingredient) {
  const list = state.uoms || [];
  const name = el("input", { class: "input", placeholder: "e.g. Strong flour", value: ingredient?.name || "" });
  const costHint = el("p", { class: "hint" });
  const unitSel = select((state.uoms || []).map((u) => ({ value: u.id, label: u.name })),
    currentUomId(state, ingredient), () => { syncDrafts(); renderPriceRows(); });
  const cost = el("input", { class: "input", type: "number", inputmode: "decimal", step: "0.001",
    placeholder: "cost per unit (RM)", value: ingredient?.costPerUnit ?? "" });
  const note = el("input", { class: "input", placeholder: "e.g. pickup at Mydin (optional)",
    value: ingredient?.purchaseNote || "" });

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
      hint,
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
      },
    };
  }

  costHint.textContent = costHintText();
  renderPriceRows();
  return { name, unitSel, cost, note, costHint, priceBox, collect };
}

function editorFields(editor) {
  return el("div", {},
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Name"), editor.name),
      el("div", {}, el("label", {}, "Cooking unit"), editor.unitSel)),
    el("div", { class: "field" },
      el("label", {}, "Fallback cost"),
      editor.cost,
      editor.costHint),
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
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(ing, values);
          toast("Ingredient updated");
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

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, ing.name),
        el("p", { class: "card-sub" },
          [mainSub, ing.purchaseNote].filter(Boolean).join(" · ")),
        usedBy.length ? el("p", { class: "po-breakdown" }, `Used in: ${usedBy.join(", ")}`) : null),
      el("div", { class: "li-right" },
        button("Edit", () => openEditIngredientPopup(state, ing, root), "ghost small"),
        button(usedBy.length ? "Hide" : "Delete", () => deleteIngredient(state, ing, usedBy.length > 0, root), "ghost small"))));
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
