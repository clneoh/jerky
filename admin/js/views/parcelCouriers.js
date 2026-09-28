// views/parcelCouriers.js — the carriers she posts parcels with.
//
// THE SECOND KIND OF COURIER (v226). Lalamove is the first kind: the app asks it
// for a price and books a vehicle for a journey. This screen is about the other
// kind — J&T, Ninja Van, Line Clear, Pos Laju, SPX — where she books the parcel
// herself and the app's job is to remember which carrier it went with.
//
// So there is no key, no secret, no wallet and no price anywhere on this screen,
// and that is the design rather than an unfinished edge: see js/parcel.js for why
// a parcel carrier is a record and not a provider in js/couriers.js.
//
// Same shape as Ingredients/Units/Suppliers: always-on "New carrier" card, each
// row with Edit, one pop-up shared by both.

import { el, button, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { newId, save } from "../state.js";
import { missingCarriers, USUAL_CARRIERS } from "../parcel.js";

export function renderParcelCouriers(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const list = state.parcelCouriers || [];
  const missing = missingCarriers(state);
  // The usual-carriers card is absent once she has them all, and this is the ONE place
  // in this view that must not hand `replaceChildren` a bare null: it is a DOM method,
  // not `el()` — it has no null filter and converts every argument with String(), so a
  // ternary left at null puts the literal word "null" on the screen under the add card.
  // Caught live at 375px (v226); the shim in test/parcel-couriers.test.js now models it
  // rather than hiding it.
  const rows = list.length
    ? list.map((c) => carrierCard(state, c, root))
    : [emptyState("No carriers yet",
      "Add who you post parcels with (e.g. J&T Express). Then an order can record which carrier took it, and the customer is shown the consignment number.")];
  root.replaceChildren(
    newCarrierCard(state, root),
    ...(missing.length ? [usualCard(state, missing, root)] : []),
    el("h2", { class: "section" }, `Parcel couriers (${list.length})`),
    ...rows);
}

function buildCarrierEditor(state, carrier) {
  const name = el("input", { class: "input", placeholder: "e.g. J&T Express", "data-suggest": "J&T Express", value: carrier?.name || "" });
  const note = el("input", { class: "input", placeholder: "Optional — e.g. counter at Prangin Mall", value: carrier?.note || "" });

  function collect() {
    const n = name.value.trim();
    if (!n) return { error: "Carrier needs a name" };
    if ((state.parcelCouriers || []).some((c) => c !== carrier && c.name.toLowerCase() === n.toLowerCase())) {
      return { error: `A carrier called "${n}" already exists` };
    }
    return { values: { name: n, note: note.value.trim() || undefined } };
  }
  return { name, note, collect };
}

function newCarrierCard(state, root) {
  const editor = buildCarrierEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New carrier"),
    el("div", { class: "field" }, el("label", {}, "Name"), editor.name),
    el("div", { class: "field" }, el("label", {}, "Note"), editor.note,
      el("p", { class: "hint" }, "Optional. Something to tell them apart — a counter you drop at, or a rate you like.")),
    button("Add carrier", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      state.parcelCouriers.push({ id: newId("pc"), ...values });
      toast("Carrier added");
      save(state);
      renderAll(root, state);
    }, "block primary"));
}

// The usual carriers, in one press. Only the ones she does not already have, and
// keyed by a FIXED id (see USUAL_CARRIERS), so pressing this on her other phone
// converges on the same rows instead of adding a second copy of each.
function usualCard(state, missing, root) {
  const names = missing.map((c) => c.name).join(", ");
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 6px" }, "The usual carriers"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Adds any of these you don't have yet. You can rename or delete any of them afterwards."),
    el("p", { class: "card-sub", style: "margin:0 0 10px" }, names),
    button(`Add ${missing.length} carrier${missing.length === 1 ? "" : "s"}`, () => {
      for (const c of missing) state.parcelCouriers.push({ id: c.id, name: c.name });
      toast(`${missing.length} carrier${missing.length === 1 ? "" : "s"} added`);
      save(state);
      renderAll(root, state);
    }, "block"));
}

function openEditCarrierPopup(state, carrier, root) {
  const editor = buildCarrierEditor(state, carrier);
  showPopup(el("div", { class: "popup-title-row" }, "Edit carrier"), (refresh, close) => {
    return el("div", {},
      el("div", { class: "field" }, el("label", {}, "Name"), editor.name),
      el("div", { class: "field" }, el("label", {}, "Note"), editor.note),
      el("p", { class: "hint" },
        "Renaming this does not change an order you have already recorded. Each order keeps the carrier's name as it was when you recorded it."),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update carrier", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(carrier, values);
          toast("Carrier updated");
          save(state);
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function usedByCount(state, carrier) {
  return (state.orders || []).filter((o) =>
    o && o.parcel && o.parcel.carrierId === carrier.id).length;
}

function carrierCard(state, carrier, root) {
  const used = usedByCount(state, carrier);
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, carrier.name),
        el("p", { class: "card-sub" },
          [carrier.note || null,
            used ? `${used} order${used === 1 ? "" : "s"} recorded` : "no orders yet"]
            .filter(Boolean).join(" · "))),
      el("div", { class: "li-right" },
        button("Edit", () => openEditCarrierPopup(state, carrier, root), "ghost small"),
        button("Delete", () => deleteCarrier(state, carrier, root), "ghost small"))));
}

function deleteCarrier(state, carrier, root) {
  const used = usedByCount(state, carrier);
  // Deleting is allowed even when orders are recorded with it, and that is safe
  // rather than careless: the name was frozen onto each order when it was
  // recorded (see js/parcel.js), so those orders keep reading correctly and the
  // customer keeps the carrier they were told about. So the confirmation says
  // what really happens rather than threatening to break history.
  confirmDialog(used
    ? `Delete carrier "${carrier.name}"? ${used} order${used === 1 ? " has" : "s have"} it recorded — those keep the name, and they keep showing it to the customer.`
    : `Delete carrier "${carrier.name}"?`,
  () => {
    state.parcelCouriers = (state.parcelCouriers || []).filter((c) => c.id !== carrier.id);
    toast("Carrier deleted");
    save(state);
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
