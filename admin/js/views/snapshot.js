// views/snapshot.js — the read-only "View" on a backup copy.
//
// Opens one copy's data as a look-through window: what was sold (grouped by
// delivery date), the product price list, and ingredient stock — exactly as
// that copy held them. It is deliberately read-only: the copy is fetched,
// digested, and rendered into a wide pop-up, and nothing is ever written back
// (no localStorage, no markDirty, no reload). Looking at old data can never
// move today.

import { el, button, showPopup, toast } from "../ui.js";
import { shortDate } from "../dates.js";
import * as backups from "../backups.js";

// Top of every section so a scroll is never mistaken for "today" — the chip
// makes the read-only promise visible on every screenful.
const RO = { style: "font-size:12px;line-height:1.45;color:var(--amber);" +
  "background:var(--amber-bg);border-radius:9px;padding:7px 10px;margin:0 0 10px" };

export function openSnapshotView(state, row) {
  backups.getBackup(state, row && row.id).then((g) => {
    if (!g || !g.ok) {
      toast(String((g && g.reason) || "Couldn't load that copy"));
      return;
    }
    let data;
    try { data = JSON.parse(g.row.data); } catch { toast("That copy couldn't be read"); return; }
    let digest;
    try { digest = backups.snapshotViewData(data); } catch { toast("That copy couldn't be read"); return; }
    const title = String(g.row.label || row.label || g.row.kind || "Backup copy");
    const engine = g.row.engine ? ` · Engine ${g.row.engine}` : "";
    const saved = g.row.created_at ? ` · saved ${backups.localWhen(g.row.created_at)}` : "";
    showPopup(title, (refresh, close) => body(digest, `${title}${saved}${engine}`, close), { wide: true });
  });
}

function body(digest, caption, close) {
  const { dayRows, productRows, ingredientRows, counts, creditRM } = digest;

  const kids = [];
  kids.push(el("p", { class: "card-sub", style: "margin:0 0 10px" }, caption));
  kids.push(el("p", RO,
    "Read-only look — this only shows what was in this copy. Today's data is not changed."));
  kids.push(el("p", { class: "card-sub", style: "margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px" },
    `${counts.orders} orders · ${counts.products} products · ${counts.ingredients} ingredients`));

  // ── orders by delivery date ─────────────────────────────────────────────
  if (dayRows.length) {
    kids.push(section("Orders in this copy"));
    for (const day of dayRows) {
      const head = day.date ? `${shortDate(day.date)} · ${day.orders.length} order${day.orders.length === 1 ? "" : "s"}`
        : `Not on a delivery date · ${day.orders.length} order${day.orders.length === 1 ? "" : "s"}`;
      kids.push(el("p", { style: "margin:10px 0 2px;font-weight:700;font-size:13.5px;color:var(--ink)" }, head));
      for (const o of day.orders) kids.push(orderRow(o));
    }
  } else {
    kids.push(el("p", { class: "muted", style: "margin:8px 0 0" }, "No orders yet in this copy."));
  }

  // ── products ────────────────────────────────────────────────────────────
  const live = productRows.filter((p) => !p.hidden && !p.draft);
  const drafts = productRows.filter((p) => p.draft);
  const hidden = productRows.filter((p) => p.hidden);
  if (live.length) {
    kids.push(section("Products"));
    for (const p of live) kids.push(nameRow(p.name, priceLine(p)));
  } else if (!productRows.length) {
    kids.push(section("Products"));
    kids.push(el("p", { class: "muted", style: "margin:8px 0 0" }, "No products yet in this copy."));
  }
  if (drafts.length) {
    kids.push(el("p", { style: "margin:12px 0 2px;font-weight:700;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px" },
      `Draft products (${drafts.length})`));
    for (const p of drafts) kids.push(nameRow(p.name, priceLine(p)));
  }
  if (hidden.length) {
    kids.push(el("p", { style: "margin:12px 0 2px;font-weight:700;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px" },
      `Hidden products (${hidden.length})`));
    for (const p of hidden) kids.push(nameRow(p.name, priceLine(p)));
  }

  // ── ingredient stock ────────────────────────────────────────────────────
  const onShelf = ingredientRows.filter((i) => !i.hidden);
  const hiddenIngs = ingredientRows.filter((i) => i.hidden);
  if (onShelf.length) {
    kids.push(section("Ingredient stock"));
    for (const ing of onShelf) kids.push(nameRow(ing.name, stockLine(ing)));
  }
  if (hiddenIngs.length) {
    kids.push(el("p", { style: "margin:12px 0 2px;font-weight:700;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px" },
      `Hidden ingredients (${hiddenIngs.length})`));
    for (const ing of hiddenIngs) kids.push(nameRow(ing.name, stockLine(ing)));
  }

  // ── the rest, in one line ───────────────────────────────────────────────
  const rest = [];
  if (counts.deliveryDates) rest.push(`${counts.deliveryDates} delivery date${counts.deliveryDates === 1 ? "" : "s"}`);
  if (counts.suppliers) rest.push(`${counts.suppliers} supplier${counts.suppliers === 1 ? "" : "s"}`);
  if (counts.uoms) rest.push(`${counts.uoms} units`);
  if (counts.purchaseOrders) rest.push(`${counts.purchaseOrders} saved order${counts.purchaseOrders === 1 ? "" : "s"}`);
  if (counts.credits) rest.push(`${counts.credits} credit${counts.credits === 1 ? "" : "s"} (RM ${(Math.round(creditRM * 100) / 100).toFixed(2)})`);
  if (counts.occasions) rest.push(`${counts.occasions} occasion${counts.occasions === 1 ? "" : "s"}`);
  if (rest.length) {
    kids.push(el("p", { class: "muted", style: "margin:12px 0 0;font-size:12.5px;line-height:1.5" },
      `Also in this copy: ${rest.join(" · ")}.`));
  }

  kids.push(el("div", { class: "popup-actions", style: "margin-top:14px" },
    button("Close", close, "primary")));
  return el("div", {}, ...kids);
}

function section(text) {
  return el("p", { style: "margin:14px 0 2px;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--brown-dark)" },
    text);
}

function orderRow(o) {
  const main = `${o.customer} · ${o.product} × ${o.qty}${o.courier ? " (post)" : ""}`;
  const sub = [`#${o.code}`, o.statusLabel];
  if (o.placed) sub.push(`placed ${o.placed}`);
  return nameRow(main, sub.join(" · "));
}

function priceLine(p) {
  const unit = p.unit ? ` / ${p.unit}` : "";
  return p.priceText ? `${p.priceText}${unit}` : `No price set${unit}`;
}

function stockLine(ing) {
  const parts = [`Have ${ing.onHandText}`];
  if (ing.keepText) parts.push(`Keep at least ${ing.keepText}`);
  const low = ing.low
    ? el("span", { style: "color:var(--red);font-weight:700" }, " · low")
    : null;
  const text = el("span", {}, parts.join(" · "));
  return low ? el("span", {}, text, low) : text;
}

function nameRow(mainText, subNode) {
  return el("div", { style: "padding:7px 0;border-bottom:1px solid var(--line)" },
    el("p", { style: "margin:0;font-size:14px;line-height:1.35;color:var(--ink)" }, mainText),
    el("p", { class: "card-sub", style: "margin:1px 0 0" }, subNode));
}
