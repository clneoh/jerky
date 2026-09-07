// views/po.js — the headline: pick a delivery date → auto ingredient PO.
// Lines with a supplier pack price show whole packs to buy ("2 × 4kg"); lines
// without stay loose estimates. Items group under their (cheapest) supplier
// with a per-supplier subtotal, a Copy-order WhatsApp text and a Message button.

import { navigate } from "../app.js";
import { longDate, todayISO, weekdayName } from "../dates.js";
import { explodeBom, capacityStatus } from "../bom.js";
import { el, button, select, emptyState, toast } from "../ui.js";
import { byId, save, newId } from "../state.js";
import { priceItems } from "../purchasing.js";
import { poTableEl, totalOf } from "./poTable.js";

export function renderPO(root, state, params) {
  const dates = [...state.deliveryDates].sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) {
    root.replaceChildren(emptyState("No delivery dates",
      "Add delivery dates and orders first — then the PO writes itself."));
    return;
  }
  const requested = params.get("date");
  const activeId = (requested && dates.some((d) => d.id === requested))
    ? requested
    : (dates.find((d) => d.date >= todayISO())?.id || dates[dates.length - 1].id);

  const date = byId(dates, activeId);
  const sel = select(dates.map((d) => ({
    value: d.id,
    label: `${weekdayName(d.date)} ${d.date}`,
  })), date.id, () => navigate(`#/po?date=${sel.value}`));

  const preview = poPreview(state, date, true);

  root.replaceChildren(
    el("div", { class: "field" }, el("label", {}, "Delivery date"), sel),
    preview);
}

function poPreview(state, date, interactive) {
  const bom = explodeBom(state, date.id);
  const cap = capacityStatus(state, date.id);
  const dateTitle = `${weekdayName(date.date)}, ${longDate(date.date)}`;

  if (!bom.orders.length) {
    return el("div", { class: "card po-card" },
      emptyState("No orders for this date",
        "Nothing to buy — the PO is generated from orders."));
  }

  const items = priceItems(state, bom.items);
  const total = totalOf(items);

  const table = poTableEl(state, items, { interactive, dateTitle });

  const actions = interactive ? el("div", { class: "btn-row" },
    button("💾 Generate & Save", () => generate(state, date, bom, items, total), "primary"),
    button("Print", () => window.print(), "soft")) : null;

  return el("div", { class: "card po-card" },
    el("h2", { style: "margin:0 0 2px" }, `${dateTitle} — Ingredients to buy`),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      `${cap.total} units planned (capacity ${cap.capacity}) · ${bom.productLines.map((p) => `${p.productName} ×${p.qty}`).join(", ")}`),
    cap.exceeded ? el("div", { class: "danger-banner" }, "Over capacity — check the order list.") : null,
    bom.warnings.length ? el("div", { class: "warn" }, bom.warnings.join(" ")) : null,
    table,
    actions,
    interactive ? el("p", { class: "po-snapshot-note" },
      "Generating saves an immutable snapshot to PO History. Changing orders later won't change it.") : null);
}

function generate(state, date, bom, items, total) {
  if (!bom.orders.length) return toast("No orders — nothing to generate");
  const po = {
    id: newId("po"),
    deliveryDateId: date.id,
    deliveryDate: date.date,
    generatedAt: new Date().toISOString(),
    items,
    summary: {
      totalUnits: bom.totalUnits,
      capacity: state.deliveryDates.find((d) => d.id === date.id)?.capacity ?? state.settings.defaultCapacity,
      totalEstCost: total,
      buyTotal: total, // whole-pack cost of the firm supplier lines + loose estimates
      productLines: bom.productLines,
    },
    orderIds: bom.orders.map((o) => o.id),
    warnings: bom.warnings,
  };
  state.purchaseOrders.unshift(po);
  save(state);
  toast("PO saved to history");
  navigate(`#/history?po=${po.id}`);
}
