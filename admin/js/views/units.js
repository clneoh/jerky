// views/units.js — units of measure (UOM) list. Members convert within their
// family (weight g/kg, volume ml/L, count 1:1) so purchasing packs can be
// expressed naturally. Same shape as Ingredients: always-on "New unit" card,
// Edit opens a pop-up.

import { el, button, emptyState, select, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, productUsesUnit, save } from "../state.js";

const FAMILIES = [
  { value: "weight", label: "Weight (g, kg…)" },
  { value: "volume", label: "Volume (ml, L…)" },
  { value: "count", label: "Count (pcs…)" },
];
const BASE_NAME = { weight: "g", volume: "ml", count: "items" };

export function renderUnits(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const list = state.uoms || [];
  root.replaceChildren(
    newUnitCard(state, root),
    el("h2", { class: "section" }, `Units (${list.length})`),
    ...(list.length ? list.map((u) => unitCard(state, u, root))
      : [emptyState("No units yet", "Units make the shopping list speak in kg, L and pcs.")]));
}

function buildUnitEditor(state, uom) {
  const name = el("input", { class: "input", placeholder: "e.g. kg", value: uom?.name || "" });
  const familySel = select(FAMILIES, uom?.family || "weight", null);
  const factorLabel = el("label", {}, factorCaption(familySel.value));
  const factor = el("input", {
    class: "input", type: "number", inputmode: "decimal", min: "0.0001", step: "any",
    value: uom?.toBase ?? 1,
  });
  familySel.addEventListener("change", () => {
    factorLabel.textContent = factorCaption(familySel.value);
    if (familySel.value === "count") factor.value = "1";
  });

  function collect() {
    const n = name.value.trim();
    if (!n) return { error: "Unit needs a name (e.g. kg)" };
    const family = familySel.value;
    const toBase = family === "count" ? 1 : Math.max(Number(factor.value) || 0, 0.0001);
    if (state.uoms.some((u) => u !== uom && u.name.toLowerCase() === n.toLowerCase())) {
      return { error: `A unit called "${n}" already exists` };
    }
    return { values: { name: n, family, toBase } };
  }
  return { name, familySel, factorLabel, factor, collect };
}

function factorCaption(family) {
  return family === "count" ? "1:1 (pieces)" : `How many base ${BASE_NAME[family]} in one unit?`;
}

function newUnitCard(state, root) {
  const editor = buildUnitEditor(state, null);
  const card = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New unit"),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Name"), editor.name),
      el("div", {}, editor.familySel)),
    el("div", { class: "field" },
      editor.factorLabel,
      editor.factor,
      el("p", { class: "hint" }, "e.g. kg: 1,000 (grams). Only units of the same type compare — weight vs volume never mixes.")),
    button("Add unit", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      state.uoms.push({ id: newId("uom"), ...values });
      toast("Unit added");
      save(state);
      renderAll(root, state);
    }, "block primary"));
  return card;
}

function openEditUnitPopup(state, uom, root) {
  const editor = buildUnitEditor(state, uom);
  showPopup(el("div", { class: "popup-title-row" }, "Edit unit"), (refresh, close) => {
    return el("div", {},
      el("div", { class: "form-grid" },
        el("div", {}, el("label", {}, "Name"), editor.name),
        el("div", {}, editor.familySel)),
      el("div", { class: "field" }, editor.factorLabel, editor.factor),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update unit", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(uom, values);
          toast("Unit updated");
          save(state);
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function unitDisplay(uom) {
  if (uom.family === "count") return `1 ${uom.name} = 1 item`;
  return `1 ${uom.name} = ${Number(uom.toBase).toLocaleString()} ${BASE_NAME[uom.family]}`;
}

function unitCard(state, uom, root) {
  const used = uomUsed(state, uom);
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, uom.name),
        el("p", { class: "card-sub" },
          `${uom.family} · ${unitDisplay(uom)}${used ? ` · used by ${used}` : ""}`)),
      el("div", { class: "li-right" },
        button("Edit", () => openEditUnitPopup(state, uom, root), "ghost small"),
        button("Delete", () => deleteUnit(state, uom, root), "ghost small"))));
}

function uomUsed(state, uom) {
  const onIng = state.ingredients.filter((i) => i.uomId === uom.id).length;
  const onPrice = state.ingredients.filter((i) =>
    (i.supplierPrices || []).some((e) => e.uomId === uom.id)).length;
  const onProd = state.products.filter((p) => productUsesUnit(p, uom)).length;
  const bits = [];
  if (onIng) bits.push(`${onIng} ingredient${onIng === 1 ? "" : "s"}`);
  else if (onPrice) bits.push("supplier prices");
  if (onProd) bits.push(`${onProd} product${onProd === 1 ? "" : "s"}`);
  return bits.join(" and ");
}

function deleteUnit(state, uom, root) {
  const used = uomUsed(state, uom);
  if (used) {
    return toast(`Can't delete "${uom.name}" — it's still in use (${used}). Edit it instead if the size is wrong.`);
  }
  confirmDialog(`Delete unit "${uom.name}"?`, () => {
    state.uoms = state.uoms.filter((u) => u.id !== uom.id);
    toast("Unit deleted");
    save(state);
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
