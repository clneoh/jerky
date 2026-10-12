// customers.js — build the customer / marketing list from order history.
// Pure module: no DOM, runs under Node for tests.
// Rows carry: who they are (name + whatsapp), how much they've bought
// (orders/units/approx total spend), their favourite product, and when they
// last ordered/delivered — enough for a history pop-up and a marketing list.

import { byId, groupOrders, orderCode, orderLinePrice, round2, waNumber } from "./state.js";
import { groupValue, moneyTagOf, orderNet } from "./money.js";
// ⚠️ THE VAN'S OWN DAY (v429) — the same reader every other surface uses, never a second reading
// of "which day does the van go". See courier_job.js.
import { courierDayOf } from "./courier_job.js";

// The delivery date for an order. New orders snapshot their delivery date, so
// history survives a delivery date being deleted; older orders fall back to
// resolving the date via deliveryDateId.
export function deliveryDateOf(state, o) {
  if (o.deliveryDate) return o.deliveryDate;
  const del = state.deliveryDates.find((d) => d.id === o.deliveryDateId);
  return del ? del.date : "";
}

// The date the order was placed/recorded. New orders snapshot orderDate;
// older orders fall back to the createdAt timestamp's date.
export function orderDateOf(o) {
  if (o.orderDate) return o.orderDate;
  if (o.createdAt) return String(o.createdAt).slice(0, 10);
  return "";
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

// The canonical digits of a phone number, or "" when the value is not shaped
// like one. Shared with profiles.js so every writer stores the same form, and so
// no caller can reduce an email or a note to a stray digit. The shape test is the
// one the finder already uses (profiles.js) for the same reason.
export function phoneDigits(v) {
  const s = String(v || "").trim();
  if (!/^[\d\s\-().+]+$/.test(s) || !/\d/.test(s)) return "";
  return waNumber(s);
}

// A number is identified by its digits, so "+60 12-345 6789", "60123456789" and
// "012-345 6789" are one person — the same reduction waNumber already does for
// every wa.me link. Anything not shaped like a number keeps its plain trimmed
// text, exactly as it always has.
function waKey(v) {
  return phoneDigits(v) || norm(v);
}

// The join key tying an order to a person and to a saved profile: WhatsApp
// number when present, else name, else the single order id. Exported so
// profiles.js keys a profile with the very same rule — a profile stored under a
// slightly different spelling still joins its orders.
export function keyOf(o) {
  return waKey(o.whatsapp) || norm(o.customerName) || o.id;
}

// Aggregates orders into one row per customer. A customer is keyed by WhatsApp
// number when present (same number = same person, even under a different name),
// else by name, else by the single order id. A storefront order that arrives as
// several item rows sharing a groupId counts as ONE order here (matching how the
// Orders screen shows them), while units/spend still sum across its items.
// sort ∈ recent | name | orders | units | phone.
// filter ∈ all | phone | recent30 | gone30 — the two date filters need `today`
// (an ISO date) to compare against, and behave like "all" without it.
export function customerList(state, sort = "recent", filter = "all", today = "") {
  const products = state.products || [];
  const map = new Map();
  for (const o of state.orders) {
    // ★★ A REDACTED ORDER KEEPS ITS OWN HISTORY TOGETHER (v374). Once a customer's name and number are
    // cleared, `keyOf` falls back to the ORDER ID — so without this their sales would explode into one
    // "no name" customer per ITEM, and a per-customer statement could never be produced for them again,
    // which is the opposite of the promise that the sales record is kept. `redactedKey` is random and
    // non-reversible and is shared by every order of that person, so their history stays ONE row.
    const key = o.redactedKey || keyOf(o);
    let row = map.get(key);
    if (!row) {
      row = {
        _key: key,
        // ⚠️ "Details removed" IS NOT "(no name)". One means a person whose details were deleted at
        // their own request and whose sales are kept; the other means somebody never gave a name. A row
        // that read "(no name)" would look like an unfinished order rather than an answered request.
        name: o.redactedKey ? "Details removed" : (o.customerName || "").trim() || "(no name)",
        whatsapp: (o.whatsapp || "").trim(),
        seenOrders: new Set(), // distinct storefront orders (groupId || id)
        units: 0,
        spend: 0,            // Σ what each order was sold for (price frozen per order)
        productQty: new Map(), // productId → total qty, for the favourite
        last: "",            // most recent delivery date
        lastOrdered: "",     // most recent order date
        lastAddress: "",     // the delivery address on the most recent order that has one
        addrOn: "",          // (temp) that order's date, so the most recent one wins
      };
      map.set(key, row);
    }
    row.seenOrders.add(o.groupId || o.id);
    row.units += Number(o.qty) || 0;
    const price = orderLinePrice(state, o);
    if (price != null) row.spend += (Number(o.qty) || 0) * price;
    // The favourite stays on today's product name — it answers "what to bake
    // for them", so a rename should carry through rather than split the count.
    const product = byId(products, o.productId);
    if (product) {
      row.productQty.set(product.name, (row.productQty.get(product.name) || 0) + (Number(o.qty) || 0));
    }
    // ★★ "LAST DELIVERY" MEANS THE DAY IT WAS DELIVERED, NOT THE DAY IT WAS BAKED (v429). ⚠️ This
    // fed three surfaces at once — the row's own line ("delivered Wed 7 Oct"), the CSV column
    // HEADED "Last delivery", and the recency sort — and all three were naming the bake day while
    // the van went the next morning. ⚠️ BY DESIGN it still falls back to the bake day, because a
    // collection IS delivered on its bake day and the van's day is empty until she types it.
    const d = courierDayOf(o) || deliveryDateOf(state, o);
    const od = orderDateOf(o);
    if (d && (!row.last || d > row.last)) row.last = d;
    if (od && (!row.lastOrdered || od > row.lastOrdered)) row.lastOrdered = od;
    // Where they were last delivered — the address the New-order card offers back
    // when she picks their name. Only an order that actually carries one counts, so
    // a run of self-collect orders never blanks an address she did use. Ties, and
    // orders with no order date at all, keep the later row in `state.orders`.
    const addr = String(o.address || "").trim();
    if (addr && (!row.addrOn || od >= row.addrOn)) { row.addrOn = od; row.lastAddress = addr; }
  }

  // ★ WHAT THEY ACTUALLY SPENT, NOT WHAT THE BREAD WAS PRICED AT (v370). The loop above
  // accumulated every line at its FACE price, row by row — which counts a discount the customer
  // never paid, and counts a refunded order as though the money stayed. The correction is applied
  // **once per ORDER**, because a refund is one amount stamped on every row of it: doing this per
  // row would subtract the same refund once per item.
  for (const g of groupOrders(state.orders || [])) {
    const first = (g.orders || [])[0];
    if (!first) continue;
    // ⚠️ THE SAME KEYING AS THE LOOP ABOVE, or a redacted person's spend correction would miss its row
    // entirely and their lifetime spend would silently read at FACE value — the discount and the refund
    // quietly back in the figure.
    const row = map.get(first.redactedKey || keyOf(first));
    if (row) row.spend += orderNet(state, g) - groupValue(state, g);
  }

  let rows = [...map.values()];
  for (const r of rows) {
    r.orders = r.seenOrders.size;
    r.totalSpend = round2(r.spend);
    r.fav = bestOf(r.productQty); // product name with the most units, else null
    delete r.seenOrders;
    delete r.spend;
    delete r.productQty;
    delete r.addrOn;
  }

  // ── PEOPLE SHE ADDED HERSELF (v290) ────────────────────────────────────────
  //
  // The book is built from ORDERS, so someone who has never ordered has no row anywhere — and a
  // partner she recruited to hand labels out is exactly that person. They get a row of their own,
  // all zeros and marked `manual`, so every screen that reads the book sees them: the count at the
  // top, the CSV, the bulk-message picker, the duplicate-join picker, and — the one that matters
  // most — the order form's own name suggestions.
  //
  // KEEPING THEM IN A SEPARATE LIST WOULD HAVE BEEN THE OBVIOUS WAY TO DRAW THIS, AND THE WRONG
  // ONE. The day that partner finally orders, the form would have offered her nothing, so she
  // would have retyped the name and number by hand; the order would then key by DIGITS while the
  // hand-added record stayed keyed by NAME. One person, two records, for good. They are drawn
  // under their own heading instead — the grouping is the view's, not the data's.
  //
  // MATCHED BY A RE-DERIVED keyOf, never by the profile's own `key`. A stored key can lag: a
  // name-keyed profile whose order later gained a number keeps the old key (see canonicaliseCustomers
  // in profiles.js), and matching on `p.key` alone would draw that person twice — once as a
  // customer and once as hand-added.
  const known = new Set(rows.map((r) => r._key));
  for (const p of (Array.isArray(state.customers) ? state.customers : [])) {
    if (!p) continue;
    const key = keyOf({ whatsapp: p.whatsapp, customerName: p.name }) || p.key;
    if (!key || known.has(key)) continue;
    // Two profiles reducing to one key draw ONE row, exactly as two orders for one person do.
    known.add(key);
    rows.push({
      _key: key,
      name: String(p.name || "").trim() || "(no name)",
      whatsapp: String(p.whatsapp || "").trim(),
      orders: 0,
      units: 0,
      totalSpend: 0,
      fav: null,
      last: "",
      lastOrdered: "",
      lastAddress: "",
      manual: true,
    });
  }

  const cutoff = today ? daysAgoISO(today, 30) : "";
  if (filter === "phone") {
    rows = rows.filter((r) => r.whatsapp);
  } else if (filter === "recent30" && cutoff) {
    rows = rows.filter((r) => r.lastOrdered >= cutoff);
  } else if (filter === "gone30" && cutoff) {
    rows = rows.filter((r) => r.whatsapp && !(r.lastOrdered >= cutoff));
  }

  const byRecent = (a, b) => (b.lastOrdered || "").localeCompare(a.lastOrdered || "") || (b.last || "").localeCompare(a.last || "");
  switch (sort) {
    case "name":
      rows.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "orders":
      rows.sort((a, b) => b.orders - a.orders || byRecent(a, b));
      break;
    case "units":
      rows.sort((a, b) => b.units - a.units || byRecent(a, b));
      break;
    case "phone":
      rows.sort((a, b) => (b.whatsapp ? 1 : 0) - (a.whatsapp ? 1 : 0) || byRecent(a, b));
      break;
    default: // recent
      rows.sort(byRecent);
  }
  return rows;
}

function bestOf(qtyByProduct) {
  let best = null;
  let bestQty = 0;
  for (const [name, qty] of qtyByProduct) {
    if (qty > bestQty) {
      best = name;
      bestQty = qty;
    }
  }
  return best;
}

// A customer's history as ONE block per storefront order, newest-placed first,
// for the history pop-up. Multi-item orders keep their lines together under a
// shared code (groupId || id), exactly as the Orders screen shows them.
// Each block: { code, orderDate, deliveryDate, courierDay, status, moneyTag, fulfillment, lines }.
export function ordersForCustomer(state, row) {
  const key = row && row._key;
  if (!key) return [];
  const lines = (state.orders || []).filter((o) => keyOf(o) === key);
  const blocks = new Map();
  for (const o of lines) {
    const gkey = o.groupId || o.id;
    let b = blocks.get(gkey);
    if (!b) {
      b = {
        code: orderCode(o),
        orderDate: orderDateOf(o),
        deliveryDate: deliveryDateOf(state, o),
        // ★★ AND THE VAN'S OWN DAY, WHICH CAN BE A DIFFERENT DAY (v429). ⚠️ ADDED rather than
        // swapped: `deliveryDate` is what the history is SORTED by and it stays the bake day, so the
        // list is still arranged by the day's work. This is what the words "deliver" read.
        courierDay: courierDayOf(o),
        status: String(o.status || "new"),
        fulfillment: o.fulfillment === "courier" ? "courier" : "collect",
        lines: [],
      };
      blocks.set(gkey, b);
    }
    b.lines.push(o);
  }
  // ★★ AND WHAT THE MONEY ON IT IS (v430). Her report: __"at Peggy's customer card, has that her
  // order is paid, but it is not??"__ — ⚠️ the chip was drawn from `status` alone, so it said
  // **Paid** over an order whose money had never come in. The word is computed HERE, where the
  // whole group is in hand, because the answer needs the money flags and the refund mark rather
  // than the single row the view is holding — and so that nothing downstream re-derives it.
  for (const b of blocks.values()) b.moneyTag = moneyTagOf({ orders: b.lines });
  const out = [...blocks.values()];
  out.sort((a, b) =>
    (b.orderDate || "").localeCompare(a.orderDate || "") ||
    (b.deliveryDate || "").localeCompare(a.deliveryDate || ""));
  return out;
}

function daysAgoISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
