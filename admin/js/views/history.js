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
import { byId, fmtRM, newId, round2, save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { poTableEl, totalOf } from "./poTable.js";
import { amendItem, fmtStockAmount, groupItemsBySupplier, newBuyLine, trimNum } from "../purchasing.js";
import { applyBought, shopUndoPlan, undoShopBought } from "../stock.js";
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

// ── ★★ buying a saved list, ONE SHOP AT A TIME (v389) ────────────────────────
//
// Her words: __"the po when bought pressed, it push all ingredient into stock immediately, before i
// enter how much to pay and by what method, it should not like that, it is a lump sum total, it should
// allow individual supplier bought and after pay only push into stock"__.
//
// ⚠️⚠️ SO THE TWO THINGS THAT WERE WRONG ARE BOTH FIXED BY MOVING WHERE `applyBought` IS CALLED FROM.
// It used to run on the press and the pay box opened afterwards, so the shelf moved before she had said
// anything. It now runs INSIDE the box's Save (and its Skip), scoped to ONE SHOP — so **closing the box
// without choosing changes nothing at all**, and a press can no longer claim she shopped every shop.
//
// ⚠️ A SHOP IS KEYED BY THE SAME STRING THE TABLE GROUPS BY (`group.supplier`, empty for the loose
// "no supplier price" group). **A saved list is a frozen snapshot**, so its supplier strings never
// change — the key is stable, and `purchasing.js` needs no change to expose one.
const shopKeyOf = (group) => (group && group.supplier) || "";

// A shop that was already bought on an OLD snapshot. ⚠️ Before v389 the whole list was one boolean,
// so an old `po.bought` means EVERY shop on it was bought — rendering it as un-bought would offer her
// a press that adds the same packs to her shelf a second time.
function isLegacyBought(po) {
  return !!(po && po.bought) && !(po && po.boughtShops);
}

function shopRecord(po, key) {
  if (isLegacyBought(po)) return { at: po.boughtAt || "", skipped: false, legacy: true };
  const map = po && po.boughtShops;
  return (map && typeof map === "object" && map[key]) || null;
}

// Every shop on a saved list, in the order the table draws them.
function shopGroups(po) {
  return groupItemsBySupplier((po && po.items) || []);
}

// ⚠️ A SHOP WITH NOTHING TO BUY IS NOT A SHOP TO SETTLE. A line whose whole pack the shelf already
// covers carries `addBase` 0, so a press for it would put nothing on the shelf and still mark the shop
// bought. Those shops are left out of the count as well — otherwise one of them would sit "still to
// buy" for ever and the list could never read as finished.
const shopHasBuy = (g) => (g.items || []).some((it) => Number(it && it.addBase) > 0);
const buyableGroups = (po) => shopGroups(po).filter(shopHasBuy);

// What has landed across the list, and what is still to buy.
function listProgress(po) {
  const groups = buyableGroups(po);
  const landed = groups.filter((g) => shopRecord(po, shopKeyOf(g)));
  const bought = landed.filter((g) => {
    const r = shopRecord(po, shopKeyOf(g));
    return r && !r.skipped;
  });
  return {
    total: groups.length,
    landed: landed.length,
    bought: bought.length,
    skipped: landed.length - bought.length,
    done: groups.length > 0 && landed.length === groups.length,
    remaining: groups.filter((g) => !shopRecord(po, shopKeyOf(g))).map((g) => g.supplier || "no supplier price"),
  };
}

// ⚠️⚠️ `po.bought` NOW MEANS "EVERY SHOP HAS LANDED", not "she pressed the one button". Kept rather
// than replaced so anything still reading it keeps a true answer; it is set true only when nothing is
// left to buy, skipped shops included.
function settleBought(po) {
  const p = listProgress(po);
  if (p.done) {
    po.bought = true;
    if (!po.boughtAt) po.boughtAt = new Date().toISOString();
  } else {
    po.bought = false;
    delete po.boughtAt;
  }
}

function shopLanding(po, key, { skipped = false } = {}) {
  if (!po.boughtShops || typeof po.boughtShops !== "object") po.boughtShops = {};
  po.boughtShops[key] = skipped
    ? { at: new Date().toISOString(), skipped: true }
    : { at: new Date().toISOString() };
  settleBought(po);
}

// ── the controls that sit on each shop's heading ──────────────────────────────
//
// ⚠️ A SHOP THAT HAS LANDED SHOWS A STATE, NOT A PRESS. A heading that kept its buttons after being
// bought could not tell her which shops were left — the one thing this screen is for once a run is
// half done.
function shopControls(state, po, group, root) {
  // Nothing to add at this shop — no press, and nothing to say about it (see `shopHasBuy`).
  if (!shopHasBuy(group)) return [];
  const key = shopKeyOf(group);
  const rec = shopRecord(po, key);
  if (rec) {
    const label = el("span", { class: `po-shop-done${rec.skipped ? " skipped" : ""}` },
      rec.skipped
        ? `Not buying${rec.at ? ` ${fmtTime(rec.at)}` : ""}`
        : `Bought ✓${rec.at ? ` ${fmtTime(rec.at)}` : ""}`);
    // ★★ A BOUGHT SHOP CAN BE TAKEN BACK (v393). Her words: __"that delete is for deleting the whole
    // po, what if i only want to delete one bought only"__ — and, on what to call it, __"call it undo is
    // more appropriate than delete"__.
    //
    // ⚠️ **UNDO, NOT DELETE, AND THAT IS THE WHOLE POINT OF THE WORD.** It puts back both halves of what
    // the press did — the packs come off the shelf and the money comes off her books — and a name that
    // promises less than the act is how a control gets pressed by mistake.
    //
    // ⚠️⚠️ NOT ON A LEGACY-BOUGHT SHOP. A list bought before v389 carries the whole thing as one flag
    // and may have no money row at all, so there is nothing here that can be put back with confidence —
    // and this app does not invent a reversal it cannot account for (the v385 rule for the journal).
    // ⚠️ AND NOT ON A SKIPPED SHOP: "Not buying" moved nothing, and she chose it as the press that asks
    // first and then stays put.
    if (!rec.skipped && !rec.legacy) {
      return [label, button("Undo", () => openShopUndo(state, po, group, root), "ghost small")];
    }
    return [label];
  }
  return [
    button("Bought ✓", () => openPayBox(state, po, group, root), "primary small"),
    // ⚠️⚠️ THIS ONE ASKS FIRST, AND IT IS THE ONLY PRESS HERE THAT DOES. "Bought ✓" opens a box that
    // must be answered, so a mis-tap on it changes nothing at all — but this one takes effect on the
    // tap and there is no way back from it, exactly like Delete. On a phone, one stray finger must not
    // settle a shop for good. (Found by LOOKING at the finished screen, not by a test.)
    button("Not buying", () => confirmDialog(
      `Mark ${key || "this shop"} as not buying? Its packs stay off your stock and no money is recorded. The list can then be finished without it — and this cannot be undone.`,
      () => {
        // ⚠️ NO STOCK AND NO MONEY — she is saying she did not buy here. It exists so the list can
        // FINISH: without it a shop she has decided against would sit un-bought for ever.
        shopLanding(po, key, { skipped: true });
        save(state);
        maybeSync(state);
        toast(`${key || "That shop"} marked as not buying`);
        renderDetail(root, state, po);
      },
      { danger: true, yesLabel: "Not buying" }), "ghost small"),
  ];
}

// The money rows the Bought press wrote for ONE shop. ⚠️ Matched on the pair it was WRITTEN with —
// the list's `poId` and the shop's own name in `note` — which is exactly how `openPayBox` writes them.
// ⚠️ That pair is also what makes this safe on an OLD row written before v393, so a shop she bought
// last week can still be undone today.
function shopMoneyRows(state, po, shop) {
  return (state.expenses || [])
    .filter((e) => e && e.poId === po.id && String(e.note || "") === shop);
}

// ★★ UNDO ONE SHOP'S "BOUGHT" (v393).
//
// ⚠️⚠️ IT PUTS BACK BOTH HALVES, AND THE CONFIRM NAMES EVERY FIGURE FIRST. The packs come off the
// shelf and the money comes off her books, in one press — and she is told what her stock will hold and
// what will leave her books BEFORE she agrees, because a one-way change is not something a tap should
// discover afterwards. Stock never goes below zero, so a reversal that would is clamped — and the
// clamped figure is the one the confirm shows.
function openShopUndo(state, po, group, root) {
  const key = shopKeyOf(group);
  const shop = group.supplier || "";
  const cur = state.settings.currency;
  const moves = shopUndoPlan(state, group.items);
  const rows = shopMoneyRows(state, po, shop);
  const money = round2(rows.reduce((n, e) => n + (Number(e.amount) || 0), 0));

  const stockText = moves.map((m) =>
    `${m.ing.name} ${fmtStockAmount(state, m.ing, m.was)} to ${fmtStockAmount(state, m.ing, m.now)}`);

  confirmDialog(
    `Undo ${shop || "this shop"}? The packs it added come back off your stock and the money comes off your books.`
    + (stockText.length ? ` Your stock: ${stockText.join(", ")}.` : "")
    + (money > 0 ? ` ${fmtRM(money, cur)} comes off your books.` : "")
    + " This cannot be undone.",
    () => {
      const day = poDateStrs(po)[0] ? longDate(poDateStrs(po)[0]) : "";
      // ⚠️ THE STOCK REVERSAL IS WRITTEN DOWN as well as done — the card must go on explaining the
      // figure it sits under (v385). The money row is REMOVED rather than reversed, because the books
      // are a list of what happened, not a journal of changes.
      undoShopBought(state, moves, { shopLabel: shop, day, ref: po.id });
      if (rows.length) state.expenses = (state.expenses || []).filter((e) => !rows.includes(e));
      if (po.boughtShops && typeof po.boughtShops === "object") delete po.boughtShops[key];
      settleBought(po);
      save(state);
      maybeSync(state);
      toast(`${shop || "That shop"} undone${money > 0 ? ` — ${fmtRM(money, cur)} off your books` : ""}`);
      renderDetail(root, state, po);
    },
    { danger: true, yesLabel: "Undo" });
}

// "What did you pay?" — for ONE shop, and the shelf moves only when she answers it.
function openPayBox(state, po, group, root) {
  const key = shopKeyOf(group);
  const shop = group.supplier || "";
  const currency = state.settings.currency;
  const groups = shopGroups(po);
  const estimate = Number(group.subtotal) || 0;
  const summary = po.summary || {};
  const runEstimate = Number(
    summary.buyTotal != null ? summary.buyTotal
      : summary.totalEstCost != null ? summary.totalEstCost
        : po.buyTotal != null ? po.buyTotal : po.totalEstCost,
  ) || 0;
  // ⚠️⚠️ THE RUN'S OWN ESTIMATE ANSWERS ONLY FOR A ONE-SHOP LIST. On a multi-shop run it is the whole
  // run's cost, and offering it here would pre-fill Mydin with what Mydin AND Yen Grocer came to.
  // ⚠️ ONE FIGURE FEEDS BOTH THE BOX AND THE SENTENCE that explains it — a box pre-filled with 76.5
  // next to a sentence that names no total is the same fault the pre-fill was fixed for in v285.
  const shown = estimate > 0 ? estimate : (groups.length === 1 ? runEstimate : 0);
  const amount = el("input", { class: "input", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "What you paid",
    value: shown ? String(shown) : "" });
  let method = methodsOf(state)[0] || "Cash";

  // ⚠️ THE ONE PLACE ANYTHING MOVES. `paid` is the amount, or null for "Skip the money".
  const land = (paid) => {
    const added = applyBought(state, po, group.items, shop);
    shopLanding(po, key);
    if (paid != null) {
      if (!Array.isArray(state.expenses)) state.expenses = [];
      state.expenses.push({
        id: newId("exp"),
        date: todayISO(),
        amount: paid,
        category: "Ingredients & shopping",
        method,
        poId: po.id,
        // ⚠️ THE SHOP GOES IN THE NOTE so a run's rows can be told apart in her books — the Money
        // screen and the per-method journal both already print a row's note beside its name.
        note: shop,
      });
    }
    save(state);
    maybeSync(state);
    const names = added
      .map(([ing, base]) => `${ing.name} +${fmtStockAmount(state, ing, base)}`)
      .join(", ");
    toast(names ? `Added to stock: ${names}` : "Nothing new went into your stock");
    renderDetail(root, state, po);
  };

  showPopup(el("div", { class: "popup-title-row" }, "What did you pay?"), (refresh, close) => el("div", {},
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `${shop ? `What did ${shop} cost` : "What did this shop cost"}${shown ? ` — the list came to ${fmtRM(shown, currency)}` : ""}? The packs go into your stock when you answer.`),
    el("div", { class: "field" }, amount),
    el("div", { class: "field" }, el("label", {}, "Paid by"),
      methodPills(state, method, (m) => { method = m; }, refresh)),
    el("div", { class: "popup-actions" },
      // ⚠️ KEPT ON PURPOSE (guide, never a gate): her shelf may need to be right even when she does not
      // want the bookkeeping. But it is now HER CHOICE — it used to happen before she looked.
      button("Skip the money", () => { close(); land(null); }, "ghost"),
      button("Save", () => {
        const value = Number(amount.value);
        if (!amount.value.trim() || !Number.isFinite(value) || value < 0) {
          return toast("Type what you paid, or press Skip the money");
        }
        close();
        land(value);
      }, "primary"))));
}

// The money recorded THROUGH this list — every expense the Bought press wrote, each tagged `poId`.
// ⚠️ Since v389 a run writes ONE ROW PER SHOP, so this is a sum and not a single figure.
function paidOnList(state, po) {
  return round2((state.expenses || [])
    .filter((e) => e && e.poId === po.id)
    .reduce((n, e) => n + (Number(e.amount) || 0), 0));
}

// What the card says about where the run stands — and it must never claim more than happened.
function boughtNote(po) {
  const p = listProgress(po);
  if (!p.total) return null;
  if (p.landed === 0) {
    return el("p", { class: "po-snapshot-note" },
      "Tap Bought on each shop as you pay for it. Nothing goes into your stock until you do.");
  }
  if (p.done) {
    const body = p.total === 1
      ? (p.skipped ? "Not buying from this shop — nothing went into your stock."
                   : "Bought — these packs are on your stock.")
      : `Bought ${p.bought} of ${p.total} shops${p.skipped ? `, ${p.skipped} not buying` : ""}. The packs you bought are on your stock.`;
    return el("p", { class: "po-snapshot-note", style: "color:var(--green)" }, body);
  }
  return el("p", { class: "po-snapshot-note" },
    `Bought ${p.bought} of ${p.total} shops — still to buy: ${p.remaining.join(", ")}.`);
}

function renderDetail(root, state, po) {
  const dates = poDateStrs(po);
  const multi = dates.length > 1;
  const prog = listProgress(po);
  const paid = paidOnList(state, po);
  // A saved list is a RECORD (v387 pins that it offers no per-shop Print), so the table is not
  // `interactive` — the Bought controls are supplied separately and sit on each shop's heading.
  const table = poTableEl(state, po.items || [], {
    shopActions: (g) => shopControls(state, po, g, root),
  });

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
    boughtNote(po),
    po.warnings?.length ? el("div", { class: "warn", style: "margin-top:10px" }, po.warnings.join(" ")) : null);

  // Correcting the list is offered only until something has LANDED — bought OR marked not buying
  // (her decision, 3 Oct 2026, widened at v389). Once a shop's packs are on the shelf the money may
  // already be recorded, so an edit would have to unpick both; and an edit rewrites the whole
  // `po.items`, which would move the ground under a shop already settled.
  const canAmend = prog.landed === 0;

  root.replaceChildren(
    el("div", { class: "btn-row" },
      button("← Back", () => navigate("#/history"), "ghost"),
      canAmend ? button("Amend", () => amendPO(state, po, root), "soft") : null,
      button("Print", () => window.print(), "soft"),
      // Regenerate stays available after a shop is bought, and that is deliberate rather than an
      // oversight: it builds a list from the need as it stands NOW, and the bought packs are already
      // on the shelf — so the regenerated list reads "already have" and buys only what is genuinely
      // new since. An existing test asserts this button survives, and the arithmetic agrees with it.
      button("Regenerate", () => navigate(regenerateTarget(po)), "soft"),
      button("Delete", () => confirmDialog(
        // ★★ AND IT NAMES THE MONEY THAT STAYS (v391). Her words: __"when we delete a po, money paid
        // dont reverse out?"__ — a fair question, and the answer was that nothing said so. Deleting a
        // list has never touched the money recorded through it (each Bought row carries the list's
        // `poId`, and nothing prunes it), and it has never touched the packs either.
        //
        // ⚠️⚠️ THE MONEY STAYS ON PURPOSE, and she chose it: money that left her purse is a fact about
        // her business, exactly as the packs on her shelf are. **Tidying a document must not rewrite her
        // books** — and the row is hers to remove on the Money screen, which has its own ✕. ⚠️ What was
        // wrong was only that the box said NOTHING, so the money appeared to vanish while the list went.
        // A consequence she has to discover afterwards is the fault; naming it first is the fix.
        //
        // ⚠️ NAMED ONLY WHEN THERE IS SOME. A list nobody has bought from prints the sentence it always
        // did — a warning about RM 0.00 on every ordinary delete would be noise she learns to skip.
        `Delete this saved shopping list? It covers ${dates.length} day${dates.length === 1 ? "" : "s"} and can't be brought back. The covered day${dates.length === 1 ? "" : "s"} will count as not-yet-shopped again and return to the PO tick list.`
        + (paid > 0
            ? ` The ${fmtRM(paid, state.settings.currency)} you recorded on it stays on your books, and its packs stay on your stock — remove the money on the Money screen if you want it gone.`
            : ""),
        () => {
          state.purchaseOrders = (state.purchaseOrders || []).filter((p) => p.id !== po.id);
          toast("PO deleted");
          save(state);
          navigate("#/history");
        },
        { danger: true, yesLabel: "Delete" }), "danger small")),
    card);
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
