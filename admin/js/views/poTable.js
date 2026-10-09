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
export function poTableEl(state, items, { interactive = false, dateTitle = "", shopActions = null } = {}) {
  const list = items || [];
  const groups = groupItemsBySupplier(list);
  const plain = groups.length === 1 && !groups[0].supplier;
  const currency = state.settings?.currency || "RM";

  // ★★ ONE SECTION PER SHOP, EACH ITS OWN `<tbody>` (v387). Her words: __"now the PO, lump together
  // all supplier in one po is not practical"__, then, asked which problem she meant, __"i want a
  // separate list per shop"__.
  //
  // ⚠️⚠️ IT WAS ONE `<tbody>` HOLDING EVERY SHOP, AND THAT IS EXACTLY WHY A SINGLE SHEET COULD NOT BE
  // SEPARATED: there was nothing in the markup to hide. The grouping was already right on screen —
  // each shop had its heading, its subtotal and its Copy / Message buttons — **but the one exit still
  // shared was the printer**, so she could not take Mydin's page to Mydin. One `<tbody>` per shop is
  // what turns "print just this shop" into a single CSS rule instead of a SECOND rendering of the
  // table, which is the thing that would drift from the screen.
  const bodies = [];
  if (plain && !shopActions) {
    // ⚠️ ONE GROUP WITH NO SUPPLIER — a list of loose estimates. There is no shop to separate, so it
    // stays a single section and offers no per-shop press (see `groupHeaderRow`).
    //
    // ⚠️ BUT ONLY WHEN THERE IS NOTHING TO PUT ON IT (v389). With no header row there is NOWHERE to
    // put a per-shop control, and this is the one case where the whole list IS one shop — so when the
    // caller supplies `shopActions` the header comes back and it falls through to the loop below.
    // **One shape, no special case: every list has at least one shop section carrying its controls.**
    const only = el("tbody");
    for (const it of list) only.appendChild(rowFor(state, it, currency));
    bodies.push(only);
  } else {
    for (const g of groups) {
      const body = el("tbody");
      body.appendChild(groupHeaderRow(g, { interactive, dateTitle, currency, shopActions }));
      for (const it of g.items) body.appendChild(rowFor(state, it, currency));
      bodies.push(body);
    }
  }

  const grand = totalOf(list);
  return el("table", { class: "po-table" },
    el("thead", {}, el("tr", {},
      el("th", {}, "Ingredient"),
      el("th", { class: "num" }, "Buy"),
      el("th", { class: "num" }, "Est. cost"))),
    ...bodies,
    el("tfoot", {}, el("tr", {},
      el("td", { colspan: "2", class: "po-total" }, "Total"),
      el("td", { class: "num po-total" }, fmtRM(grand, currency)))));
}

// ★★ PRINT ONE SHOP'S LIST ON ITS OWN (v387).
//
// ⚠️⚠️ THIS FOLLOWS `printActiveLabel` (`views/orders.js`) AND `journal-print` (`journal.js`) — the two
// places this app already prints ONE thing — rather than inventing a mechanism. A body class is added
// for the instant of printing and `print.css` scopes on it.
//
// ⚠️⚠️ THE TRAP, AND IT IS NAMED BY THE CODE THAT ALREADY AVOIDS IT: **a class left behind would blank
// her ordinary PO print** — later, elsewhere, silently. So it comes off on `afterprint` AND on a
// fallback timer, because browsers fire one or the other, not both.
//
// ⚠️ AND THE ROW MARKER IS INERT WITHOUT THE BODY CLASS, so the worst a leaked marker can do is
// nothing at all. Both are removed together, in one function, so they cannot drift apart.
function printOneShop(row) {
  const body = row && typeof row.closest === "function" ? row.closest("tbody") : null;
  // ⚠️ NO SECTION, NO PRINT. Falling back to printing the whole card would be the opposite of what the
  // press says it does.
  if (!body || typeof document === "undefined" || !document.body) return;
  document.body.classList.add("po-shop-print");
  body.classList.add("print-shop");
  const done = () => {
    document.body.classList.remove("po-shop-print");
    body.classList.remove("print-shop");
    if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("afterprint", done);
    clearTimeout(timer);
  };
  const timer = setTimeout(done, 2000);
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("afterprint", done);
  if (typeof window !== "undefined" && typeof window.print === "function") window.print();
}

function groupHeaderRow(g, { interactive, dateTitle, currency, shopActions = null }) {
  const name = el("span", { class: `po-sup-name${g.supplier ? "" : " muted"}` },
    g.supplier || "No supplier price (estimate)");
  const side = el("span", { class: "po-sup-side" });
  side.appendChild(el("span", { class: "po-sup-sub" }, fmtRM(g.subtotal, currency)));
  // ⚠️ THE ROW IS BUILT FIRST, because the Print press below finds its own section through it
  // (`closest("tbody")`). That is why there is no plumbing: the press does not need to be handed the
  // table, and there is no second copy of the rows anywhere.
  const row = el("tr", { class: "po-supplier" },
    el("td", { colspan: "3" },
      el("div", { class: "po-suprow" }, name, side)));
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
    // ★★ AND THIS SHOP'S LIST CAN LEAVE ON PAPER ON ITS OWN (v387). ⚠️ The press is on the SHOP's own
    // heading, beside that shop's Copy and Message, because it is the third way this shop's list
    // leaves — the app already had two of the three.
    side.appendChild(button("🖨 Print this shop", () => printOneShop(row), "ghost small"));
  }
  // ★★ THE PER-SHOP CONTROLS ON A SAVED LIST (v389). Her words: __"it should allow individual supplier
  // bought and after pay only push into stock"__.
  //
  // ⚠️⚠️ NOT GATED ON `interactive`, and that is the whole point of a separate option rather than a
  // fourth press in the block above. **PO History renders this table with `interactive:false`** — it is
  // a record, not a working list, and a test pins that it offers no per-shop Print — yet History is
  // exactly the screen where a saved list gets bought. So the caller supplies its own controls, and
  // they are called for the loose "no supplier price" group (`g.supplier` empty) as well: that group is
  // a real shopping need and it carries `addBase` like any other.
  if (typeof shopActions === "function") {
    for (const node of shopActions(g) || []) if (node) side.appendChild(node);
  }
  return row;
}

function rowFor(state, it, currency) {
  const breakdown = (it.lines || []).map((l) =>
    `${l.dateLabel ? l.dateLabel + ": " : ""}${l.productName} ×${l.orderQty} = ${l.orderQty * l.perUnitQty}${it.unit}`).join(" · ");

  const first = el("td", {},
    it.ingredientName,
    it.unitsOk === false ? el("div", { class: "warn", style: "margin:4px 0 0" }, "⚠ check units") : null,
    it.haveText ? el("div", { class: "po-have" }, it.haveText) : null,
    it.reserveText ? el("div", { class: "po-reserve" }, it.reserveText) : null,
    breakdown ? el("div", { class: "po-breakdown" }, breakdown) : null);

  const needLine = it.needText
    ? el("div", { class: "po-need" }, `need ${it.needText}`)
    : (Number(it.totalQty) || 0) > 0 ? el("div", { class: "po-need" }, `need ${fmtQty(it.totalQty, it.unit)}`) : null;

  let qtyCell;
  if (it.covered) {
    qtyCell = el("td", { class: "po-buy" },
      el("span", { class: "muted" }, "already have"),
      needLine);
  } else if (it.buyText) {
    qtyCell = el("td", { class: "po-buy" },
      el("span", {}, it.buyText),
      needLine);
  } else {
    qtyCell = el("td", { class: "num" }, fmtQty(it.openQty != null ? it.openQty : it.totalQty, it.unit));
  }

  return el("tr", { class: it.covered ? "po-covered" : undefined },
    first,
    qtyCell,
    el("td", { class: "num" }, fmtRM(it.estCost, currency)));
}
