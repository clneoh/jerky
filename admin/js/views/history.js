// views/history.js — saved PO snapshots + detail + amend + re-print + delete.
// Deliberately imports no app.js (it boots the app): navigation sets
// location.hash directly, which keeps this view DOM-testable under Node (po.js
// uses the same trick).
//
// A SNAPSHOT IS NO LONGER UNTOUCHABLE (v285). It used to be — "later order changes don't
// affect this PO" is still exactly true, an amended list does not re-read the orders — but
// she shops against reality, not against the plan, and the shop is where the price has moved
// and where she decides to take more. So the LIST may be corrected until she taps Bought.
// What may never change: `generatedAt` (coveringPO sorts on it) and `dates[].fp` (the
// "orders changed" rounds read it). Both are deliberately left alone by the amend below.

import { longDate, todayISO, weekdayName } from "../dates.js";
import { el, button, emptyState, showPopup, toast, confirmDialog } from "../ui.js";
import { byId, fmtRM, newId, save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { poTableEl, totalOf } from "./poTable.js";
import { amendItem, fmtStockAmount, newBuyLine, trimNum } from "../purchasing.js";
import { applyBought } from "../stock.js";
import { methodsOf } from "../accounts.js";
import { recordPriceMove } from "../prices.js";
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
    po.amendedAt
      ? el("p", { class: "po-snapshot-note" },
          `Corrected ${fmtTime(po.amendedAt)} — this is what you actually took and paid.`)
      : null,
    po.bought
      ? el("p", { class: "po-snapshot-note", style: "color:var(--green, #2e7d32)" },
          `Bought ${fmtTime(po.boughtAt)} — these packs were added to your stock.`)
      : (canBuy
          ? el("p", { class: "po-snapshot-note" },
              `After you're back from the shops, tap "Bought" above to add these to your stock.`)
          : null),
    po.warnings?.length ? el("div", { class: "warn", style: "margin-top:10px" }, po.warnings.join(" ")) : null);

  // Correcting the list is offered only until the packs are on the shelf (her decision,
  // 3 Oct 2026). After Bought, `applyBought` has already added these amounts to stock and the
  // money may already be recorded, so an edit would have to unpick both — and she chose the
  // simple, safe rule instead: once you have tapped Bought, the list is what happened.
  const canAmend = !po.bought;

  root.replaceChildren(
    el("div", { class: "btn-row" },
      button("← Back", () => navigate("#/history"), "ghost"),
      canBuy ? button("Bought ✓ — add to stock", () => markBought(state, po, root), "primary") : null,
      canAmend ? button("Amend", () => amendPO(state, po, root), "soft") : null,
      button("Print", () => window.print(), "soft"),
      // Regenerate stays available after Bought, and that is deliberate rather than an
      // oversight: it builds a list from the need as it stands NOW, and Bought has already put
      // the packs on the shelf — so the regenerated list reads "already have" and carries no
      // Bought button of its own. It buys only what is genuinely new since. An existing test
      // asserts this button survives, and the arithmetic agrees with it.
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
  // THE PRE-FILL WAS READ FROM THE WRONG PLACE, and had been since the box was built. A saved
  // snapshot carries its estimate as `summary.buyTotal` / `summary.totalEstCost`
  // (views/po.js generate() and saveExtraOnly()), and this read a TOP-LEVEL `po.buyTotal` that
  // no snapshot has ever had — so on every real shopping list the box opened blank and the
  // sentence dropped its "the list came to RM…" half. The tests missed it because they set
  // `po.buyTotal` by hand rather than saving a list. Fixed in v285, where amending is what
  // makes the pre-fill worth anything. The top-level read is kept last so an older snapshot
  // built before the summary existed still answers.
  const summary = po.summary || {};
  const estimate = Number(
    summary.buyTotal != null ? summary.buyTotal
      : summary.totalEstCost != null ? summary.totalEstCost
        : po.buyTotal != null ? po.buyTotal : po.totalEstCost,
  ) || 0;
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

// ── v285: correcting the list at the shop ────────────────────────────────────
//
// Her story: *"based on the po we go shopping, same supplier price change and we decide to buy
// more, i would like to change the price and the qty, i need the PO to be amendable."*
//
// The pop-up works on a COPY. Nothing reaches the saved list until she presses Save, so a card
// she closes has changed nothing — the same rule her Edit cards already keep. All the maths
// (the pack count, the price, the derived base amount and the line total) is `amendItem()`, so
// the row she reads and the total she saves are worked out by one function.
//
// `_pricedAt` rides the working copy and is never saved: it is the price the line came in with,
// so Save can write back ONLY the lines she actually repriced. Without it, opening Amend and
// touching nothing would stamp a stale list price over a price she had since corrected by hand.
function amendPO(state, po, root) {
  const cur = state.settings?.currency || "RM";
  let items = (po.items || []).map((it) => ({ ...it, _pricedAt: Number(it.packPrice) || 0 }));

  showPopup(el("div", { class: "popup-title-row" }, "Amend this shopping list"), (refresh, close) => {
    const totalLine = el("div", { class: "amend-total" });
    const paint = () => { totalLine.textContent = `List total now: ${fmtRM(totalOf(items), cur)}`; };
    const rows = items.map((it, i) => amendRow(state, items, i, paint, refresh, cur));
    const actions = el("div", { class: "popup-actions" },
      button("Cancel", close, "ghost"),
      button("Save the corrected list", () => saveAmendment(state, po, items, root, close), "primary"));
    paint();
    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Change how many you took and what each one cost. The total follows as you type. "
        + "A price you change here is written back onto the ingredient, so your recipes and your "
        + "next list use the price you actually paid."),
      el("div", { class: "amend-rows" }, ...rows),
      addLineRow(state, items, refresh),
      totalLine,
      actions);
  });
}

function amendRow(state, items, i, paint, refresh, cur) {
  const it = items[i];

  // A line the list left off because the shelf already covers it. It carries NO pack fields —
  // priceItems() returns before it ever asks a supplier — so it has nothing to edit. It is
  // still drawn, because a list that silently dropped a line would look as though that
  // ingredient had been forgotten; and it offers one press so the case is not a dead end: if
  // she decides to stock up anyway, it becomes an ordinary line at the supplier's own price.
  if (it.covered === true) {
    const row = el("div", { class: "amend-row amend-covered" },
      el("div", { class: "amend-name" },
        el("div", {}, it.ingredientName),
        el("div", { class: "amend-sub muted" }, "already on your shelf — nothing to buy")));
    const ing = byId(state.ingredients || [], it.ingredientId);
    if (ing) {
      row.appendChild(button("＋ buy some", () => {
        const line = newBuyLine(state, ing);
        items[i] = { ...line, _pricedAt: Number(line.packPrice) || 0 };
        refresh();
      }, "ghost small"));
    }
    return row;
  }

  const loose = it.loose === true;
  const countLabel = loose ? `amount in ${it.unit || "units"}` : "packs";
  const priceLabel = loose
    ? `RM per ${it.unit || "unit"}`
    : `RM per ${trimNum(it.packQty)}${it.packUomName || ""} pack`;

  const count = el("input", { class: "input amend-num", type: "number", inputmode: "decimal",
    min: "0", step: loose ? "any" : "1", "aria-label": `${it.ingredientName} — ${countLabel}`,
    value: String(Number(it.packs) || 0) });
  const price = el("input", { class: "input amend-num", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", "aria-label": `${it.ingredientName} — ${priceLabel}`,
    value: String(Number(it.packPrice) || 0) });
  const lineTotal = el("span", { class: "amend-calc" }, fmtRM(Number(it.estCost) || 0, cur));

  // Typing repaints NOTHING but the two figures below it — the row is not rebuilt and the
  // caret stays in the box she is typing in. Only adding or dropping a line rebuilds the list.
  const apply = () => {
    items[i] = amendItem(state, items[i], { packs: count.value, packPrice: price.value });
    lineTotal.textContent = fmtRM(items[i].estCost, cur);
    paint();
  };
  count.addEventListener("input", apply);
  price.addEventListener("input", apply);

  // "Remove", not a bare ✕. The card's own header already wears a ✕ that closes it, and two
  // identical crosses doing two different things on one card is the fault her own rule names:
  // a control has to say what it does. This one says it.
  const drop = button("Remove", () => { items.splice(i, 1); refresh(); }, "ghost small amend-drop");
  drop.setAttribute("aria-label", `Take ${it.ingredientName} off this list`);

  return el("div", { class: "amend-row" },
    el("div", { class: "amend-name" },
      el("div", {}, it.ingredientName),
      el("div", { class: loose ? "amend-sub muted" : "amend-sub" },
        loose ? "no supplier price — your fallback cost" : (it.supplier || ""))),
    el("div", { class: "amend-fields" },
      el("label", { class: "amend-field" }, el("span", {}, countLabel), count),
      el("label", { class: "amend-field" }, el("span", {}, priceLabel), price),
      el("div", { class: "amend-line" }, lineTotal)),
    drop);
}

// Anything she can still put on the list. An ingredient ALREADY on it is deliberately left
// out: `applyBought` sums by ingredient id, so a duplicate would not double the stock — but it
// would show her the same shopping twice and price it twice, and a list that reads as two of
// something is a list she cannot trust.
function addLineRow(state, items, refresh) {
  const onList = new Set(items.map((it) => String(it.ingredientId)));
  const options = (state.ingredients || []).filter((ing) => ing && ing.active !== false
    && ing.notPurchased !== true && !onList.has(String(ing.id)));
  if (!options.length) {
    return el("p", { class: "card-sub", style: "margin:12px 0 0" },
      "Everything you can buy is already on this list.");
  }
  const pick = el("select", { class: "input amend-pick", "aria-label": "Add an ingredient to this list" },
    el("option", { value: "" }, "Add something else…"),
    ...options.map((ing) => el("option", { value: ing.id }, ing.name)));
  return el("div", { class: "amend-add" }, pick,
    button("＋ Add", () => {
      const ing = byId(state.ingredients || [], pick.value);
      if (!ing) return toast("Pick an ingredient first");
      const line = newBuyLine(state, ing);
      items.push({ ...line, _pricedAt: Number(line.packPrice) || 0 });
      refresh();
    }, "soft small"));
}

// Save. Two things are written, and only ever these two.
//
// 1. THE LIST — the corrected items and both summary totals, from one `totalOf()`, exactly as
//    `generate()` computes them. `generatedAt` is left alone (coveringPO sorts snapshots on it)
//    and `dates[].fp` is never touched (the "orders changed" rounds read it).
// 2. THE INGREDIENT — for each line she actually repriced, through `recordPriceMove()`, which
//    also records the movement in the ingredient's price log.
//
// A loose line writes nothing back: its price is per cooking unit and the ingredient's supplier
// prices are per pack, and converting between the two behind her back is how a costing goes
// quietly wrong.
function saveAmendment(state, po, items, root, close) {
  const cur = state.settings?.currency || "RM";
  const clean = items.map(({ _pricedAt, ...rest }) => rest);
  const moved = [];
  const skipped = [];

  for (const it of items) {
    if (it.loose === true || !it.supplierId) continue;
    if (Number(it.packPrice) === Number(it._pricedAt)) continue;
    const ing = byId(state.ingredients || [], it.ingredientId);
    if (!ing) continue;
    const out = recordPriceMove(ing, {
      supplierId: it.supplierId,
      supplierName: it.supplier || "",
      qty: it.packQty,
      uomId: it.packUomId,
      uomName: it.packUomName || "",
      price: it.packPrice,
      poId: po.id,
      source: "po",
    });
    if (out.ok && out.changed) {
      moved.push(`${ing.name}: ${fmtRM(out.was == null ? 0 : out.was, cur)} → ${fmtRM(out.now, cur)}`);
    } else if (!out.ok && out.reason === "packChanged") {
      skipped.push(ing.name);
    }
  }

  po.items = clean;
  const total = totalOf(clean);
  po.summary = { ...(po.summary || {}), totalEstCost: total, buyTotal: total };
  po.amendedAt = new Date().toISOString();
  save(state);
  maybeSync(state);
  close();
  renderDetail(root, state, po);

  if (skipped.length) {
    toast(`List corrected. ${skipped.join(", ")} kept the old price — the supplier's price on file is for a different pack.`);
  } else if (moved.length) {
    toast(`List corrected to ${fmtRM(total, cur)}. Ingredient updated — ${moved.join("; ")}`);
  } else {
    toast(`List corrected to ${fmtRM(total, cur)}.`);
  }
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
