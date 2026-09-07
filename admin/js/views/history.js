// views/history.js — saved PO snapshots (immutable) + detail + re-print + delete.
// Deliberately imports no app.js (it boots the app): navigation sets
// location.hash directly, which keeps this view DOM-testable under Node (po.js
// uses the same trick).

import { longDate, weekdayName } from "../dates.js";
import { el, button, emptyState, toast, confirmDialog } from "../ui.js";
import { byId, fmtRM, save } from "../state.js";
import { poTableEl } from "./poTable.js";

// Navigate by hash so app.js isn't needed at import time.
const navigate = (hash) => { location.hash = hash; };

// The dates a snapshot covers: its own dates[] (multi-day) or, for legacy
// single-day snapshots, the old deliveryDate field. Sorted oldest first so the
// headline and Regenerate always read the same way.
function poDateStrs(po) {
  const ds = Array.isArray(po.dates) && po.dates.length
    ? po.dates.map((d) => d.date)
    : (po.deliveryDate ? [po.deliveryDate] : []);
  return ds.slice().sort();
}

// Headline with a muted "+N more days" tail when the snapshot spans several.
function poHeadline(po) {
  const dates = poDateStrs(po);
  const base = dates.length
    ? `${weekdayName(dates[0])}, ${longDate(dates[0])}`
    : "Purchase order";
  if (dates.length <= 1) return base;
  return el("span", {},
    base,
    el("span", { class: "muted", style: "font-weight:400;font-size:12px" },
      `  +${dates.length - 1} more day${dates.length === 2 ? "" : "s"}`));
}

function regenerateTarget(po) {
  const dates = poDateStrs(po);
  if (dates.length > 1) {
    const idMap = new Map((po.dates || []).map((d) => [d.date, d.id]));
    return `#/po?dates=${dates.map((d) => idMap.get(d) || "").filter(Boolean).join(",")}`;
  }
  return `#/po?date=${po.deliveryDateId}`;
}

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
  const cards = list.map((po) => {
    const products = po.summary?.productLines?.map((p) => `${p.productName} ×${p.qty}`).join(", ") || "";
    const when = `Generated ${fmtTime(po.generatedAt)}`;
    return el("div", {
      class: "card tappable",
      onclick: () => navigate(`#/history?po=${po.id}`),
    },
      el("div", { class: "card-row" },
        el("div", {},
          el("p", { class: "card-title" }, poHeadline(po)),
          el("p", { class: "card-sub" },
            po.topup ? `Extra-only list · ${products || `+${po.summary?.totalUnits ?? "?"} new order units`}`
              : `${when}${products ? " · " + products : ""}`)),
        el("div", { class: "li-right" },
          el("span", { class: "qty-chip" }, `${po.summary?.totalUnits ?? "?"} units`),
          el("span", { class: "qty-chip", style: "background:var(--brown-soft)" },
            fmtRM(po.summary?.totalEstCost ?? 0, state.settings.currency)))));
  });
  root.replaceChildren(
    el("h2", { class: "section" }, `Purchase orders (${list.length})`),
    ...cards);
}

function renderDetail(root, state, po) {
  const dates = poDateStrs(po);
  const multi = dates.length > 1;
  const table = poTableEl(state, po.items || [], {});

  const card = el("div", { class: "card po-card" },
    el("h2", { style: "margin:0 0 2px" },
      el("span", {}, poHeadline(po)),
      po.topup ? " — Extra ingredients to buy" : " — Ingredients to buy"),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      po.topup
        ? `Extra-only list — covers the ${po.summary?.totalUnits ?? "?"} new order unit${po.summary?.totalUnits === 1 ? "" : "s"} added after you shopped this day`
        : multi
          ? `${po.summary?.totalUnits ?? "?"} units planned across ${dates.length} posting days`
          : `${po.summary?.totalUnits ?? "?"} units planned (capacity ${po.summary?.capacity ?? "?"})`),
    table,
    el("p", { class: "po-snapshot-note" },
      `Snapshot from ${fmtTime(po.generatedAt)} — later order changes don't affect this PO.`),
    po.warnings?.length ? el("div", { class: "warn", style: "margin-top:10px" }, po.warnings.join(" ")) : null);

  root.replaceChildren(
    el("div", { class: "btn-row" },
      button("← Back", () => navigate("#/history"), "ghost"),
      button("Print", () => window.print(), "soft"),
      button("Regenerate", () => navigate(regenerateTarget(po)), "primary"),
      button("Delete", () => confirmDialog(
        `Delete this saved shopping list? It covers ${dates.length} day${dates.length === 1 ? "" : "s"} and can't be brought back. The covered day${dates.length === 1 ? "" : "s"} will count as not-yet-shopped again and return to the PO tick list.`,
        () => {
          state.purchaseOrders = (state.purchaseOrders || []).filter((p) => p.id !== po.id);
          toast("PO deleted");
          save(state);
          navigate("#/history");
        },
        { danger: true, yesLabel: "Delete" }), "danger small")),
    card);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
