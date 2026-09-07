// views/history.js — saved PO snapshots (immutable) + detail + re-print.

import { navigate } from "../app.js";
import { longDate, weekdayName } from "../dates.js";
import { el, button, emptyState } from "../ui.js";
import { byId, fmtRM } from "../state.js";
import { poTableEl } from "./poTable.js";

export function renderHistory(root, state, params) {
  const poId = params.get("po");
  if (poId) {
    const po = byId(state.purchaseOrders, poId);
    if (po) return renderDetail(root, state, po);
  }
  renderList(root, state);
}

function renderList(root, state) {
  const list = [...state.purchaseOrders].sort((a, b) =>
    (b.generatedAt || "").localeCompare(a.generatedAt || ""));
  if (!list.length) {
    root.replaceChildren(emptyState("No purchase orders yet",
      "Go to the PO tab, pick a delivery date, and generate one."));
    return;
  }
  const cards = list.map((po) => el("div", {
    class: "card tappable",
    onclick: () => navigate(`#/history?po=${po.id}`),
  },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" },
          `${weekdayName(po.deliveryDate)}, ${longDate(po.deliveryDate)}`),
        el("p", { class: "card-sub" },
          `Generated ${fmtTime(po.generatedAt)} · ${po.summary?.productLines?.map((p) => `${p.productName} ×${p.qty}`).join(", ") || ""}`)),
      el("div", { class: "li-right" },
        el("span", { class: "qty-chip" }, `${po.summary?.totalUnits ?? "?"} units`),
        el("span", { class: "qty-chip", style: "background:var(--brown-soft)" },
          fmtRM(po.summary?.totalEstCost ?? 0, state.settings.currency))))));
  root.replaceChildren(
    el("h2", { class: "section" }, `Purchase orders (${list.length})`),
    ...cards);
}

function renderDetail(root, state, po) {
  const dateTitle = `${weekdayName(po.deliveryDate)}, ${longDate(po.deliveryDate)}`;
  const table = poTableEl(state, po.items || [], {});

  const card = el("div", { class: "card po-card" },
    el("h2", { style: "margin:0 0 2px" }, `${dateTitle} — Ingredients to buy`),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      `${po.summary?.totalUnits ?? "?"} units planned (capacity ${po.summary?.capacity ?? "?"})`),
    table,
    el("p", { class: "po-snapshot-note" },
      `Snapshot from ${fmtTime(po.generatedAt)} — later order changes don't affect this PO.`),
    po.warnings?.length ? el("div", { class: "warn", style: "margin-top:10px" }, po.warnings.join(" ")) : null);

  root.replaceChildren(
    el("div", { class: "btn-row" },
      button("← Back", () => navigate("#/history"), "ghost"),
      button("Print", () => window.print(), "soft"),
      button("Regenerate", () => navigate(`#/po?date=${po.deliveryDateId}`), "primary")),
    card);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
