// views/poTable.js — the grouped purchase-order table, shared by the live PO
// (interactive: per-supplier "Copy order" / "Message supplier" buttons) and by
// PO History detail (interactive:false, from the saved snapshot). The pure
// maths lives in purchasing.js; this file only turns priced items into a table.
//
// Items WITHOUT a supplier price (still loose estimates) group under a muted
// "No supplier price" header when real suppliers are present, so the buyer can
// see at a glance which lines are firm pack deals and which are estimates.

import { el, button, fmtQty, copyText } from "../ui.js";
import { fmtRM, round2, waNumber } from "../state.js";
import { groupItemsBySupplier, buildSupplierOrderText } from "../purchasing.js";

export function totalOf(items) {
  return round2((items || []).reduce((s, i) => s + (Number(i.estCost) || 0), 0));
}

// items = bom items already enriched by priceItems() (or a saved snapshot which
// carries the same fields). Older saved snapshots lack pack fields — when every
// line is loose the table renders exactly as before, no supplier headers.
export function poTableEl(state, items, { interactive = false, dateTitle = "" } = {}) {
  const list = items || [];
  const groups = groupItemsBySupplier(list);
  const plain = groups.length === 1 && !groups[0].supplier;
  const currency = state.settings?.currency || "RM";

  const tbody = el("tbody");
  if (plain) {
    for (const it of list) tbody.appendChild(rowFor(state, it, currency));
  } else {
    for (const g of groups) {
      tbody.appendChild(groupHeaderRow(g, { interactive, dateTitle, currency }));
      for (const it of g.items) tbody.appendChild(rowFor(state, it, currency));
    }
  }

  const grand = totalOf(list);
  return el("table", { class: "po-table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Ingredient"),
      el("th", { class: "num" }, "Buy"),
      el("th", { class: "num" }, "Est. cost"))),
    tbody,
    el("tfoot", {}, el("tr", {},
      el("td", { colspan: "2", class: "po-total" }, "Total"),
      el("td", { class: "num po-total" }, fmtRM(grand, currency)))));
}

function groupHeaderRow(g, { interactive, dateTitle, currency }) {
  const name = el("span", { class: `po-sup-name${g.supplier ? "" : " muted"}` },
    g.supplier || "No supplier price (estimate)");
  const side = el("span", { class: "po-sup-side" });
  side.appendChild(el("span", { class: "po-sup-sub" }, fmtRM(g.subtotal, currency)));
  if (interactive && g.supplier) {
    const orderText = () => buildSupplierOrderText({
      dateTitle,
      supplier: g.supplier,
      items: g.items,
      subtotal: g.subtotal,
      currency,
    });
    side.appendChild(button("⧉ Copy order", () =>
      copyText(orderText(), "Order text copied — paste in WhatsApp"), "ghost small"));
    if (g.whatsapp) {
      side.appendChild(button("Message supplier", () =>
        window.open(`https://wa.me/${waNumber(g.whatsapp)}?text=${encodeURIComponent(orderText())}`, "_blank"),
        "ghost small"));
    }
  }
  return el("tr", { class: "po-supplier" },
    el("td", { colspan: "3" },
      el("div", { class: "po-suprow" }, name, side)));
}

function rowFor(state, it, currency) {
  const breakdown = (it.lines || []).map((l) =>
    `${l.productName} ×${l.orderQty} = ${l.orderQty * l.perUnitQty}${it.unit}`).join(" · ");

  const first = el("td", {},
    it.ingredientName,
    it.unitsOk === false ? el("div", { class: "warn", style: "margin:4px 0 0" }, "⚠ check units") : null,
    breakdown ? el("div", { class: "po-breakdown" }, breakdown) : null);

  let qtyCell;
  if (it.buyText) {
    qtyCell = el("td", { class: "po-buy" },
      el("span", {}, it.buyText),
      el("div", { class: "po-need" }, `need ${it.needText || fmtQty(it.totalQty, it.unit)}`));
  } else {
    qtyCell = el("td", { class: "num" }, fmtQty(it.totalQty, it.unit));
  }

  return el("tr", {},
    first,
    qtyCell,
    el("td", { class: "num" }, fmtRM(it.estCost, currency)));
}
