// views/history.js — saved PO snapshots (immutable) + detail + re-print + delete.
// Deliberately imports no app.js (it boots the app): navigation sets
// location.hash directly, which keeps this view DOM-testable under Node (po.js
// uses the same trick).

import { longDate, todayISO, weekdayName } from "../dates.js";
import { el, button, emptyState, showPopup, toast, confirmDialog } from "../ui.js";
import { byId, fmtRM, newId, save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { poTableEl } from "./poTable.js";
import { fmtStockAmount } from "../purchasing.js";
import { applyBought } from "../stock.js";
import { methodsOf } from "../accounts.js";
// The Paid-by pills, one list for the whole app (js/accounts.js) — a shopping run can
// go on the loan or the bank overdraft, which is what the third choice is for. The
// same row of pills the money forms use, with the same ＋ chip, so a way she needs
// only once can still be recorded.
import { methodPills } from "./money.js";

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
  const canBuy = !po.bought && (po.items || []).some((it) => Number(it && it.addBase) > 0);

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
    po.bought
      ? el("p", { class: "po-snapshot-note", style: "color:var(--green, #2e7d32)" },
          `Bought ${fmtTime(po.boughtAt)} — these packs were added to your stock.`)
      : (canBuy
          ? el("p", { class: "po-snapshot-note" },
              `After you're back from the shops, tap "Bought" above to add these to your stock.`)
          : null),
    po.warnings?.length ? el("div", { class: "warn", style: "margin-top:10px" }, po.warnings.join(" ")) : null);

  root.replaceChildren(
    el("div", { class: "btn-row" },
      button("← Back", () => navigate("#/history"), "ghost"),
      canBuy ? button("Bought ✓ — add to stock", () => markBought(state, po, root), "primary") : null,
      button("Print", () => window.print(), "soft"),
      button("Regenerate", () => navigate(regenerateTarget(po)), canBuy ? "soft" : "primary"),
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

function markBought(state, po, root) {
  const added = applyBought(state, po);
  po.bought = true;
  po.boughtAt = new Date().toISOString();
  save(state);
  const names = added
    .map(([ing, base]) => `${ing.name} +${fmtStockAmount(state, ing, base)}`)
    .join(", ");
  toast(`Added to stock: ${names}`);
  renderDetail(root, state, po);
  askWhatYouPaid(state, po);
}

// "What did you pay?" — asked the moment the packs go on the shelf, because that is
// when the receipt is still in her hand (16 Sep 2026). The stock side is already
// done by the time this opens. It is pre-filled with the purchase order's own
// whole-pack estimate, so accepting the guess is one tap; what she types becomes
// money out on the Money screen. "Skip the money" leaves the stock added and nothing
// recorded — exactly how the app behaved before this existed.
function askWhatYouPaid(state, po) {
  const estimate = Number(po.buyTotal != null ? po.buyTotal : po.totalEstCost) || 0;
  const amount = el("input", { class: "input", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "What you paid",
    value: estimate ? String(estimate) : "" });
  let method = methodsOf(state)[0] || "Cash";

  showPopup(el("div", { class: "popup-title-row" }, "What did you pay?"), (refresh, close) => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `The packs are on your stock. What did this shop cost${estimate ? ` — the list came to ${fmtRM(estimate, state.settings.currency)}` : ""}?`),
    el("div", { class: "field" }, amount),
    el("div", { class: "field" }, el("label", {}, "Paid by"),
      methodPills(state, method, (m) => { method = m; }, refresh)),
    el("div", { class: "popup-actions" },
      button("Skip the money", close, "ghost"),
      button("Save", () => {
        const value = Number(amount.value);
        if (!amount.value.trim() || !Number.isFinite(value) || value < 0) {
          return toast("Type what you paid, or press Skip the money");
        }
        // A phone whose saved state predates the expense list has none yet.
        if (!Array.isArray(state.expenses)) state.expenses = [];
        state.expenses.push({
          id: newId("exp"),
          date: todayISO(),
          amount: value,
          category: "Ingredients & shopping",
          method,
          poId: po.id,
          note: "",
        });
        save(state);
        maybeSync(state);
        toast(`Money out: ${fmtRM(value, state.settings.currency)}`);
        close();
      }, "primary"))));
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
