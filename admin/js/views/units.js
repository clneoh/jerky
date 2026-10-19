// views/units.js — units of measure (UOM) list. Members convert within their
// family (weight g/kg, volume ml/L, count 1:1) so purchasing packs can be
// expressed naturally. Same shape as Ingredients: always-on "New unit" card,
// Edit opens a pop-up.

import { el, button, emptyState, select, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, productUsesUnit, save } from "../state.js";

const FAMILIES = [
  { value: "weight", label: "Weight (g, kg…)" },
  { value: "volume", label: "Volume (ml, L…)" },
  { value: "time", label: "Time (min, hr…)" },
  { value: "length", label: "Length (cm, m…)" },
  { value: "count", label: "Count (pcs…)" },
];
const BASE_NAME = { weight: "g", volume: "ml", time: "min", length: "cm", count: "items" };

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
  const name = el("input", { class: "input", placeholder: "e.g. kg", "data-suggest": "kg", value: uom?.name || "" });
  const familySel = select(FAMILIES, uom?.family || "weight", null);
  const factorLabel = el("label", {}, factorCaption(familySel.value));
  const factor = el("input", {
    class: "input", type: "number", inputmode: "decimal", min: "0.0001", step: "any",
    value: uom?.toBase ?? 1,
  });
  // ⚠️⚠️ A COUNT UNIT IS PIECES, AND THE BOX SHOWING A FACTOR IT IGNORED WAS A LIE (v583). ⚠️ Typing 12
  // for "dozen" and pressing Add saved **1** — the number stayed on screen and was never used. ⭐ The box
  // is not drawn for a count unit at all, so there is nothing to type into that cannot be kept.
  const syncFactor = () => {
    const count = familySel.value === "count";
    factorLabel.textContent = factorCaption(familySel.value);
    factor.hidden = count;
    if (count) factor.value = "1";
  };
  familySel.addEventListener("change", syncFactor);
  syncFactor();

  function collect() {
    const n = name.value.trim();
    if (!n) return { error: "Unit needs a name (e.g. kg)" };
    const family = familySel.value;
    const f = unitFactor(family, factor.value, n);
    if (f.error) return { error: f.error };
    if (state.uoms.some((u) => u !== uom && u.name.toLowerCase() === n.toLowerCase())) {
      return { error: `A unit called "${n}" already exists` };
    }
    return { values: { name: n, family, toBase: f.toBase } };
  }
  return { name, familySel, factorLabel, factor, collect };
}

// ⚠️⚠️ A CLEARED FACTOR USED TO BECOME 0.0001, SILENTLY (v583) — ⚠️ **a unit that then rescaled every
// stock figure and recipe cost using it, by a factor of ten thousand.** ⭐ A factor is asked for, refused
// when it is missing or zero, and a count unit is 1:1 by definition.
export function unitFactor(family, raw, name = "") {
  if (family === "count") return { toBase: 1 };
  const n = Number(raw);
  if (!String(raw ?? "").trim() || !Number.isFinite(n) || n <= 0) {
    return { error: `Type how many base ${BASE_NAME[family] || "units"} are in one ${name || "unit"} — a unit cannot be zero` };
  }
  return { toBase: n };
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
    // ★★ AND THE DELETE IS REMEMBERED (v547). ⚠️ The eleven selling units and the four time/length
    // pairs are re-seeded on every load, so without this the unit came back the next time the app
    // opened — **a Delete that undid itself**, which reads exactly like a button that does nothing.
    // ⚠️ A RECORD, NOT A STRING, because this list TRAVELS (v548): the other phone must learn that the
    // unit was deleted, or it re-seeds the unit and pushes it straight back.
    const gone = Array.isArray(state.uomsRemoved) ? state.uomsRemoved : (state.uomsRemoved = []);
    const name = String(uom.name || "").trim().toLowerCase();
    // ⚠️⚠️ A RENAMED SEEDED UNIT IS STILL THAT SEEDED UNIT (v598). ⚠️ Only the CURRENT name was recorded, so
    // "dozen" renamed to "doz" and then deleted came back on the next load as "dozen" — ⚠️ **the seed matched its
    // own id and its own name, while the tombstone named something else.** ⭐ Both names are recorded.
    const names = [name];
    const seed = /^uom_(.+)$/.exec(String(uom.id || ""));
    if (seed) names.push(String(seed[1] || "").toLowerCase());
    for (const n of names) {
      if (!n) continue;
      if (gone.some((r) => String((r && r.id) || r).toLowerCase() === n)) continue;
      gone.push({ id: n, at: new Date().toISOString() });
    }
    toast("Unit deleted");
    save(state);
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
