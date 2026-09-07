// views/po.js — the headline: tick the bake days to shop for → one combined
// ingredient PO. Days with orders are remembered as already shopped when a
// regular snapshot covers them (PO History), so they drop out of the default
// list. If orders change after a day was saved it flips to "orders changed"
// and STAYS out of the list — tapping the day reveals what's new. Each change
// starts that day's NEXT round ("2nd list", "3rd list", …): extra orders keep
// adding onto that one open list until the baker SAVES it (round 1's main list
// is likewise marked done the moment it's saved) or IGNORES it ("✓ saved"
// until the next new order). Saving or ignoring advances the round baseline
// (poAck on the day's date record), so the following round reveals only what
// changed since the last one. Tick a day → its orders add into the SAME list,
// packs round on the combined total, and a running grand total shows below.

import { longDate, todayISO, weekdayName, shortDate } from "../dates.js";
import { explodeBomDates, ordersFingerprint, effectiveCapacity, dayChangeInfo, restockOnlyItems } from "../bom.js";
import { el, button, emptyState, toast } from "../ui.js";
import { save, newId } from "../state.js";
import { priceItems, fmtQtyText } from "../purchasing.js";
import { poTableEl, totalOf } from "./poTable.js";

export function renderPO(root, state, params) {
  const dates = [...(state.deliveryDates || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) {
    root.replaceChildren(emptyState("No delivery dates",
      "Add delivery dates and orders first — then the PO writes itself."));
    return;
  }
  const initialMetas = dates.map((rec) => metaOf(state, rec));

  // Explicit ?dates=/legacy ?date= win over the default selection so PO History
  // can reopen past or already-saved days.
  const explicit = explicitSelection(params, dates);
  const ticked = new Set(explicit ?? initialMetas.filter((m) => defaultTicked(m)).map((m) => m.rec.id));
  const open = new Set(); // "orders changed" days whose reveal panel is shown

  const render = () => {
    const metas = dates.map((rec) => metaOf(state, rec));
    const chosen = dates.filter((d) => ticked.has(d.id));
    const bom = chosen.length ? explodeBomDates(state, chosen) : null;
    const needsReview = metas.some((m) => m.changed);
    root.replaceChildren(
      pickerCard(state, metas, ticked, toggle, open, toggleOpen, onIgnore, onCover),
      previewCard(state, chosen, bom, needsReview));
  };
  // Ticking or unticking a day switches to the explicit ?dates= URL (empty when
  // everything is unticked — a bare #/po would silently re-default), then the
  // preview and its running total redraw in place.
  const toggle = (id, checked) => {
    if (checked) ticked.add(id); else ticked.delete(id);
    const ids = dates.filter((d) => ticked.has(d.id)).map((d) => d.id).join(",");
    location.hash = `#/po?dates=${ids}`;
    render();
  };
  const toggleOpen = (id) => {
    if (open.has(id)) open.delete(id); else open.add(id);
    render();
  };
  const onIgnore = (rec) => {
    acknowledgeDay(state, rec);
    open.delete(rec.id);
    render();
  };
  const onCover = (rec) => {
    const info = dayChangeInfo(state, rec.date, dateSavedFp(state, rec.date) || "");
    saveExtraOnly(state, rec, info);
  };

  render();
}

// One bake day's standing, read only from live state + saved PO snapshots.
// Coverage is derived, never stored; the only extra persistence is `poAck` on
// the day's own deliveryDate record — the fingerprint the baker said "leave
// it, I've got this" for — so an ignored change survives reloads and syncs.
function metaOf(state, rec) {
  const past = rec.date < todayISO();
  const orders = (state.orders || []).filter((o) => o.deliveryDateId === rec.id);
  const units = orders.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const covered = coveringPO(state, rec.date);
  const fp = covered ? ordersFingerprint(state, rec.date) : "";
  const accurate = covered ? poAccurate(state, covered, rec.date, fp) : false;
  const acked = covered && dateAcked(state, rec.date, fp);
  const handled = covered && (accurate || acked);
  const changed = covered && !accurate && !acked;
  return { rec, past, hasOrders: orders.length > 0, units, covered, accurate, acked, handled, changed };
}

// The newest saved snapshot that covers a date string. New snapshots record
// dates:[{date, fp}]; legacy single-date ones recorded po.deliveryDate.
// Extra-only lists (po.topup) are print/merge aids, never day coverage, so
// they're skipped here — deleting a regular list still un-saves its days.
function coveringPO(state, dateStr) {
  let best = null;
  for (const po of state.purchaseOrders || []) {
    if (po && po.topup) continue;
    const covers = (Array.isArray(po.dates) && po.dates.some((d) => d.date === dateStr))
      || po.deliveryDate === dateStr;
    if (!covers) continue;
    if (!best || String(po.generatedAt || "").localeCompare(String(best.generatedAt || "")) > 0) best = po;
  }
  return best;
}

// Does the saved list still match today's orders for this date? New snapshots
// compare per-date fingerprints; legacy snapshots (no dates field) fall back to
// matching order id sets — which misses qty edits, a documented acceptable gap.
function poAccurate(state, po, dateStr, fp = ordersFingerprint(state, dateStr)) {
  if (Array.isArray(po.dates)) {
    const e = po.dates.find((d) => d.date === dateStr);
    return !!e && e.fp === fp;
  }
  const dateIds = new Set((state.deliveryDates || []).filter((d) => d.date === dateStr).map((d) => d.id));
  const cur = (state.orders || []).filter((o) => dateIds.has(o.deliveryDateId)).map((o) => o.id).sort().join(",");
  const saved = (po.orderIds || []).slice().sort().join(",");
  return cur === saved;
}

// Default ticks: future days with orders and NO saved list yet. Once a regular
// snapshot covers a day it's considered shopped, so it never re-joins the
// default list — even when new orders arrive ("orders changed"), because those
// days surface through the tap-to-review reveal instead of silently re-buying
// the whole day. The user can always tick anything with orders by hand.
function defaultTicked(m) {
  return m.hasOrders && !m.covered && !m.past;
}

// Orders currently on one delivery-date record.
function ordersOnRec(state, recId) {
  return (state.orders || []).filter((o) => o.deliveryDateId === recId);
}

// The fingerprint a day's list was saved with: the newest REGULAR covering
// snapshot's per-date dates[].fp, or — for legacy snapshots that only recorded
// order ids — the same digest rebuilt from po.orderIds. null when nothing covers.
function dateSavedFp(state, dateStr) {
  // An "ignore" or an extra-only save advances the day's baseline past the
  // regular snapshot (poAck lives on the owner date record). Prefer it, so a
  // later new order reveals only what changed since the LAST round — round 2,
  // round 3, … — instead of re-showing ingredients an earlier round already
  // handled.
  const owner = (state.deliveryDates || []).find((d) => d && d.date === dateStr);
  if (owner && owner.poAck) return owner.poAck;
  const po = coveringPO(state, dateStr);
  if (!po) return null;
  if (Array.isArray(po.dates) && po.dates.length) {
    const e = po.dates.find((d) => d.date === dateStr);
    if (e) return e.fp;
  }
  if (po.deliveryDate === dateStr) {
    const ids = new Set(po.orderIds || []);
    return (state.orders || [])
      .filter((o) => o && ids.has(o.id))
      .map((o) => `${o.productId}:${Number(o.qty) || 0}`)
      .sort()
      .join("|");
  }
  return null;
}

// Has the owner told the app this exact order state is fine (Ignored), so the
// day reads "✓ saved" again until the fingerprint changes?
function dateAcked(state, dateStr, fp) {
  const owner = (state.deliveryDates || []).find((d) => d && d.date === dateStr);
  return !!owner && owner.poAck === fp;
}

// Write the ack onto the day's OWNER deliveryDate record (same pattern dayAdj
// uses — see saveDayAdjustments in bom.js), so it syncs to both phones as part
// of the date record. Returns the record.
function ackOwner(state, rec) {
  const owner = (state.deliveryDates || []).find((d) => d && d.date === rec.date) || rec;
  owner.poAck = ordersFingerprint(state, rec.date);
  return owner;
}

// "Ignore" — mark this order change as fine without saving any new snapshot.
// The day reads saved again until another new order changes the fingerprint.
function acknowledgeDay(state, rec) {
  ackOwner(state, rec);
  save(state);
  toast("Ignored — kept as saved until another order lands");
}

// "Save extra-only list" — cover the added orders with a small separate PO of
// just their extra ingredient need (whole packs). It's a print/merge list, NOT
// day coverage (no dates[], po.topup flagged), so it never makes the day read
// "saved" by itself — the ack does that, just like Ignore.
function saveExtraOnly(state, rec, info) {
  const items = priceItems(state, info.items, { reserve: false });
  const total = totalOf(items);
  if (!items.length) return toast("No extra ingredients to buy");
  ackOwner(state, rec);
  const po = {
    id: newId("po"),
    deliveryDateId: rec.id,
    deliveryDate: rec.date,
    generatedAt: new Date().toISOString(),
    items,
    dates: [],
    summary: {
      totalUnits: info.totalUnits,
      totalEstCost: total,
      buyTotal: total,
      productLines: info.added.map((a) => ({ productId: a.productId, productName: a.productName, qty: a.qty })),
    },
    orderIds: ordersOnRec(state, rec.id).map((o) => o.id),
    topup: true,
    warnings: [],
  };
  state.purchaseOrders.unshift(po);
  save(state);
  toast("Extra-only list saved");
  location.hash = `#/history?po=${po.id}`;
}

function explicitSelection(params, dates) {
  const multi = params.get("dates");
  if (multi !== null) {
    return multi.split(",").map((s) => s.trim()).filter(Boolean)
      .filter((id) => dates.some((d) => d.id === id));
  }
  const legacy = params.get("date");
  if (legacy && dates.some((d) => d.id === legacy)) return [legacy];
  return null;
}

function pickerCard(state, metas, ticked, toggle, open, toggleOpen, onIgnore, onCover) {
  const rows = [];
  for (const m of metas) {
    const { rec, past, units, hasOrders } = m;
    const review = m.changed;
    const box = el("input", { type: "checkbox", checked: ticked.has(rec.id), disabled: !hasOrders });
    box.addEventListener("change", () => toggle(rec.id, box.checked));
    // Tapping the row reveals what changed; a tap on the checkbox itself must
    // only tick the day, so it never bubbles to the row.
    if (review) box.addEventListener("click", (e) => e && e.stopPropagation && e.stopPropagation());

    const sub = [];
    if (!hasOrders) sub.push("No orders on this day");
    else sub.push(`${units} unit${units === 1 ? "" : "s"} planned`);
    if (review) sub.push("tap to see what changed");
    else if (m.covered && m.acked) sub.push("new order ignored — I'll flag again if another lands");
    if (past) sub.push("past");
    const tag = rightTag(m);

    const row = el("div", { class: `po-day-row${ticked.has(rec.id) ? " on" : ""}${past ? " past" : ""}${review ? " po-review" : ""}` },
      box,
      el("div", { class: "po-day-main" },
        el("span", { class: "po-day-title" }, `${weekdayName(rec.date)}, ${longDate(rec.date)}`),
        el("span", { class: "po-day-sub" }, sub.join(" · "))),
      tag ? [tag] : []);
    if (review) row.addEventListener("click", () => toggleOpen(rec.id));
    rows.push(row);
    if (review && open.has(rec.id)) rows.push(detailPanel(state, rec, onIgnore, onCover));
  }

  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 2px" }, "Shop for which days?"),
    el("p", { class: "card-sub", style: "margin:0 0 4px" },
      "Tick the posting days to shop for — their ingredient needs add up into ONE list. Days you've already saved stay unticked; a day marked \"orders changed\" has a new order since you shopped — tap it to review. Extra orders keep adding onto that day's one open list until you save it."),
    rows.length ? el("div", { class: "po-day-list" }, ...rows) : null);
}

// Revealed under an "orders changed" day: what actually changed and the extra
// ingredient need, with Ignore (stay saved until the next new order) and a
// Save-extra-only-list action for anything big.
function detailPanel(state, rec, onIgnore, onCover) {
  const info = dayChangeInfo(state, rec.date, dateSavedFp(state, rec.date) || "");
  const head = (t) => el("p", { class: "po-detail-head" }, t);
  const line = (cls, text) => el("p", { class: `po-detail-line${cls ? " " + cls : ""}` }, text);

  const parts = [];
  if (info.added.length) {
    parts.push(head("New since your last saved list:"));
    for (const a of info.added) parts.push(line("", `+${a.qty} ${a.productName}`));
  }
  if (info.removed.length) {
    parts.push(head("Removed (nothing new to buy):"));
    for (const r of info.removed) parts.push(line("muted", `${r.qty} fewer ${r.productName}`));
  }
  if (info.items.length) {
    parts.push(head("Extra ingredients it adds:"));
    for (const it of info.items) parts.push(line("ing", `${it.ingredientName} ${fmtQtyText(it.totalQty, it.unit)}`));
  }
  if (!parts.length) parts.push(line("muted", "No ingredient change to show."));

  const actions = [];
  if (info.added.length) actions.push(button("Save extra-only list", () => onCover(rec), "primary small"));
  actions.push(button("Ignore — keep it saved", () => onIgnore(rec), "ghost small"));

  return el("div", { class: "po-day-detail" },
    el("p", { class: "po-detail-title" }, `What changed on ${shortDate(rec.date)}?`),
    ...parts,
    el("div", { class: "btn-row", style: "margin-top:8px" }, ...actions));
}

function rightTag(m) {
  const tag = (cls, text) => el("span", { class: `po-day-tag ${cls}` }, text);
  if (!m.hasOrders) return tag("no-orders", "no orders");
  if (m.handled) return tag("saved", "✓ saved");
  if (m.changed) return tag("changed", "orders changed");
  if (m.past) return tag("past", "past");
  return null;
}

// The one date title both the screen heading and the copy-to-supplier order
// text share. A single day reads exactly as it always did.
function headline(recs) {
  const first = recs[0];
  if (recs.length === 1) return `${weekdayName(first.date)}, ${longDate(first.date)}`;
  return recs.map((r) => shortDate(r.date)).join(" · ");
}

function previewCard(state, chosen, bom, needsReview) {
  if (!chosen.length || !bom || !bom.orders.length) return emptyPreview(state, chosen, needsReview);

  // Any active ingredient below its keep-at-least level rides along as a
  // top-up even when today's orders don't use it ("add any low one"). The sweep
  // feeds BOTH the live table and the saved snapshot (generate reuses `items`),
  // so the whole-pack top-up is already in the snapshot's addBase when she
  // later taps Bought.
  const restock = restockOnlyItems(state, bom.items.map((i) => i.ingredientId));
  const items = priceItems(state, [...bom.items, ...restock].sort((a, b) =>
    String(a.ingredientName).localeCompare(String(b.ingredientName))));
  const total = totalOf(items);
  const multi = bom.multi === true;
  const cap = multi ? 0 : effectiveCapacity(state, chosen[0].date);
  const products = bom.productLines.map((p) => `${p.productName} ×${p.qty}`).join(", ");

  const sub = multi
    ? `${bom.totalUnits} units planned across ${chosen.length} posting days · ${products}`
    : `${bom.totalUnits} units planned (capacity ${cap}) · ${products}`;

  const chips = multi
    ? el("div", { class: "po-day-chips" },
      ...chosen.map((r) => el("span", { class: "qty-chip" }, shortDate(r.date))))
    : null;

  const overCap = !multi && bom.totalUnits > cap;

  const table = poTableEl(state, items, { interactive: true, dateTitle: headline(chosen) });

  return el("div", { class: "card po-card" },
    el("h2", { style: "margin:0 0 2px" }, `${headline(chosen)} — Ingredients to buy`),
    el("p", { class: "card-sub", style: "margin:0 0 8px" }, sub),
    chips,
    overCap ? el("div", { class: "danger-banner" }, "Over capacity — check the order list.") : null,
    bom.warnings.length ? el("div", { class: "warn" }, bom.warnings.join(" ")) : null,
    table,
    el("div", { class: "btn-row" },
      button("💾 Generate & Save", () => generate(state, chosen, bom, items, total), "primary"),
      button("Print", () => window.print(), "soft")),
    el("p", { class: "po-snapshot-note" },
      multi
        ? "Generating saves ONE snapshot of these days to PO History — each becomes \"✓ saved\" and drops out of the default list."
        : "Generating saves an immutable snapshot to PO History. Changing orders later won't change it."));
}

function emptyPreview(state, chosen, needsReview) {
  if (!chosen.length) {
    const anyOrders = (state.orders || []).length > 0;
    if (anyOrders && needsReview) {
      return el("div", { class: "card po-card" },
        emptyState("A day has a new order since you shopped",
          "It stays out of your list until you tell the app how to handle it. Tap the day above marked \"orders changed\" to see the new order — then ignore it, or save an extra-only list. Until you do, any further new orders just add onto that same list."));
    }
    return el("div", { class: "card po-card" },
      emptyState(anyOrders ? "Those days are already shopped ✓" : "No orders yet",
        anyOrders
          ? "Every day with orders already has a saved, unchanged list. Tick any day above to rebuild it."
          : "The PO is built from orders — add some orders to a posting day first, then come back."));
  }
  return el("div", { class: "card po-card" },
    emptyState("Nothing to buy",
      "None of the ticked days have orders yet, so there is nothing to add up."));
}

function generate(state, recs, bom, items, total) {
  if (!bom.orders.length) return toast("No orders — nothing to generate");
  const po = {
    id: newId("po"),
    deliveryDateId: recs[0].id, // backward-compatible single-day pointer
    deliveryDate: recs[0].date,
    generatedAt: new Date().toISOString(),
    items,
    dates: recs.map((r) => ({ id: r.id, date: r.date, fp: ordersFingerprint(state, r.date) })),
    summary: {
      totalUnits: bom.totalUnits,
      capacity: recs.reduce((s, r) => s + effectiveCapacity(state, r.date), 0),
      totalEstCost: total,
      buyTotal: total, // whole-pack cost of the firm supplier lines + loose estimates
      productLines: bom.productLines,
    },
    orderIds: bom.orders.map((o) => o.id),
    warnings: bom.warnings,
  };
  // A fresh full list supersedes any earlier "ignore" for these days — the new
  // snapshot is now the shopped-through baseline, so a stale poAck would make
  // the NEXT change read as a round against the wrong round.
  for (const r of recs) {
    const owner = (state.deliveryDates || []).find((d) => d && d.date === r.date);
    if (owner && owner.poAck) delete owner.poAck;
  }
  state.purchaseOrders.unshift(po);
  save(state);
  toast("PO saved to history");
  location.hash = `#/history?po=${po.id}`;
}
