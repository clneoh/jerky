// customers.js — build the customer / marketing list from order history.
// Pure module: no DOM, runs under Node for tests.
// Rows carry: who they are (name + whatsapp), how much they've bought
// (orders/units/approx total spend), their favourite product, and when they
// last ordered/delivered — enough for a history pop-up and a marketing list.

import { byId, orderCode, round2 } from "./state.js";

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

function keyOf(o) {
  return norm(o.whatsapp) || norm(o.customerName) || o.id;
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
    const key = keyOf(o);
    let row = map.get(key);
    if (!row) {
      row = {
        _key: key,
        name: (o.customerName || "").trim() || "(no name)",
        whatsapp: (o.whatsapp || "").trim(),
        seenOrders: new Set(), // distinct storefront orders (groupId || id)
        units: 0,
        spend: 0,            // approx: Σ price × qty at the prices of today's menu
        productQty: new Map(), // productId → total qty, for the favourite
        last: "",            // most recent delivery date
        lastOrdered: "",     // most recent order date
      };
      map.set(key, row);
    }
    row.seenOrders.add(o.groupId || o.id);
    row.units += Number(o.qty) || 0;
    const product = byId(products, o.productId);
    if (product) {
      if (product.price != null) {
        row.spend += (Number(o.qty) || 0) * Number(product.price);
      }
      row.productQty.set(product.name, (row.productQty.get(product.name) || 0) + (Number(o.qty) || 0));
    }
    const d = deliveryDateOf(state, o);
    const od = orderDateOf(o);
    if (d && (!row.last || d > row.last)) row.last = d;
    if (od && (!row.lastOrdered || od > row.lastOrdered)) row.lastOrdered = od;
  }

  let rows = [...map.values()];
  for (const r of rows) {
    r.orders = r.seenOrders.size;
    r.totalSpend = round2(r.spend);
    r.fav = bestOf(r.productQty); // product name with the most units, else null
    delete r.seenOrders;
    delete r.spend;
    delete r.productQty;
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
// Each block: { code, orderDate, deliveryDate, status, fulfillment, lines }.
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
        status: String(o.status || "new"),
        fulfillment: o.fulfillment === "courier" ? "courier" : "collect",
        lines: [],
      };
      blocks.set(gkey, b);
    }
    b.lines.push(o);
  }
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
