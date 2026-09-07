// views/suppliers.js — who you buy ingredients from. Each supplier keeps a
// WhatsApp number so a PO group can open a chat with them or copy their order.
// Same shape as Ingredients/Units: always-on "New supplier" card, Edit pop-up.

import { el, button, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, save, waNumber } from "../state.js";

export function renderSuppliers(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const list = state.suppliers || [];
  root.replaceChildren(
    newSupplierCard(state, root),
    el("h2", { class: "section" }, `Suppliers (${list.length})`),
    ...(list.length ? list.map((s) => supplierCard(state, s, root))
      : [emptyState("No suppliers yet",
        "Add who you buy from (e.g. Mydin). Then Ingredients can carry each supplier's price.")]));
}

function buildSupplierEditor(state, sup) {
  const name = el("input", { class: "input", placeholder: "e.g. Mydin", value: sup?.name || "" });
  const whatsapp = el("input", { class: "input", inputmode: "tel",
    placeholder: "WhatsApp, e.g. 012-345 6789", value: sup?.whatsapp || "" });

  function collect() {
    const n = name.value.trim();
    if (!n) return { error: "Supplier needs a name" };
    const w = whatsapp.value.trim();
    if (w && waNumber(w).length < 6) return { error: "That WhatsApp number doesn't look right" };
    if (state.suppliers.some((s) => s !== sup && s.name.toLowerCase() === n.toLowerCase())) {
      return { error: `A supplier called "${n}" already exists` };
    }
    return { values: { name: n, whatsapp: w || undefined } };
  }
  return { name, whatsapp, collect };
}

function newSupplierCard(state, root) {
  const editor = buildSupplierEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New supplier"),
    el("div", { class: "field" }, el("label", {}, "Name"), editor.name),
    el("div", { class: "field" }, el("label", {}, "WhatsApp"), editor.whatsapp,
      el("p", { class: "hint" }, "Optional, but with it the PO can open a chat to send this supplier its order.")),
    button("Add supplier", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      state.suppliers.push({ id: newId("sup"), ...values });
      toast("Supplier added");
      save(state);
      renderAll(root, state);
    }, "block primary"));
}

function openEditSupplierPopup(state, sup, root) {
  const editor = buildSupplierEditor(state, sup);
  showPopup(el("div", { class: "popup-title-row" }, "Edit supplier"), (refresh, close) => {
    return el("div", {},
      el("div", { class: "field" }, el("label", {}, "Name"), editor.name),
      el("div", { class: "field" }, el("label", {}, "WhatsApp"), editor.whatsapp),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update supplier", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(sup, values);
          toast("Supplier updated");
          save(state);
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function usedByCount(state, sup) {
  return state.ingredients.filter((i) =>
    (i.supplierPrices || []).some((e) => e.supplierId === sup.id)).length;
}

function supplierCard(state, sup, root) {
  const used = usedByCount(state, sup);
  const openChat = () => {
    const digits = waNumber(sup.whatsapp);
    if (!digits) return toast("No WhatsApp number saved for this supplier");
    window.open(`https://wa.me/${digits}`, "_blank");
  };
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, sup.name),
        el("p", { class: "card-sub" },
          [sup.whatsapp ? `📱 ${sup.whatsapp}` : null,
            used ? `prices ${used} ingredient${used === 1 ? "" : "s"}` : "no prices yet"]
            .filter(Boolean).join(" · "))),
      el("div", { class: "li-right" },
        sup.whatsapp ? button("Message", openChat, "ghost small") : null,
        button("Edit", () => openEditSupplierPopup(state, sup, root), "ghost small"),
        button("Delete", () => deleteSupplier(state, sup, root), "ghost small"))));
}

function deleteSupplier(state, sup, root) {
  const used = usedByCount(state, sup);
  if (used) {
    return toast(`Can't delete "${sup.name}" — ${used} ingredient${used === 1 ? "" : "s"} price from it. Remove those prices first.`);
  }
  confirmDialog(`Delete supplier "${sup.name}"?`, () => {
    state.suppliers = state.suppliers.filter((s) => s.id !== sup.id);
    toast("Supplier deleted");
    save(state);
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
