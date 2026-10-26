// admin/js/measure.js — "the shop this week": the numbers that answer whether the shop is working.
//
// ⭐ FROM THE CUSTOMER PLAN (marketing/customer-levels-plan.md, P0): **one number per level, read weekly, judged
// in four-week blocks**, computed from her own book with nothing leaving the machine — no third-party
// analytics, no pixels, no personal data anywhere.
//
// ⚠️⚠️ EVERY DECISION HERE IS A READING OF HER OWN DATA, and three of them are the ones that make a count lie:
//   1 · **A SALE IS A GROUP, NOT A ROW.** A shop order that arrives as two item rows is one order; counting
//       rows made a two-line order read as two customers.
//   2 · **THE DAY AN ORDER IS DATED IS `orderDateOf`** — the placed day in HER clock, the same reader the
//       Orders screen and the weekly count already use. ⚠️ A UTC day shifts the count after 8am.
//   3 · **A CUSTOMER IS `keyOf`** — number first, name second, the same join the Customers screen uses.
//
// ⚠️ AND ONE THAT IS A CHOICE, NOT A FACT: **the fill is by BAKE DAY, not by when it was ordered.** "How full
// were the days" asks how much of her capacity was taken for those days, whenever the customer decided.

import { orderDateOf, keyOf } from "./customers.js";
import { groupOrders } from "./state.js";

const pad = (n) => String(n).padStart(2, "0");

// A local calendar day. ⚠️ Never `toISOString()`: that is UTC, and in Penang it moves the day after 8am.
export const isoOf = (d) => (d && typeof d.getFullYear === "function"
  ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");

const addDays = (iso, n) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return isoOf(dt);
};

// One window of `days` days ending on `endIso`, inclusive.
export function windowEnding(endIso, days = 7) {
  const span = Math.max(1, Math.floor(days));
  return { from: addDays(endIso, -(span - 1)), to: endIso };
}

const inWindow = (iso, w) => !!iso && iso >= w.from && iso <= w.to;

/**
 * The numbers for one window.
 * @param {object} state her book
 * @param {{endIso?: string, days?: number}} opts the window
 * @returns {{orders:number, firstTime:number, returning:number, fill:number|null, sold:number, capacity:number}}
 */
export function windowNumbers(state, { endIso = "", days = 7 } = {}) {
  const w = windowEnding(endIso || isoOf(new Date()), days);
  const groups = groupOrders((state && state.orders) || []);

  // Every group's own facts, read once: the day it was placed, who it is for, and the bake day it is for.
  const rows = groups.map((g) => {
    const first = g.orders[0] || {};
    return {
      placed: orderDateOf(first),
      who: keyOf(first),
      dayId: String(first.deliveryDateId || ""),
      dayIso: String(first.deliveryDate || ""),
      qty: g.orders.reduce((n, o) => n + (Number(o.qty) || 0), 0),
    };
  });

  const placed = rows.filter((r) => inWindow(r.placed, w));

  // ⚠️ FIRST-TIME IS ABOUT THE CUSTOMER'S WHOLE HISTORY, not about this window: someone whose first ever
  // order fell inside it is new; everyone else here is returning. A group with no date cannot be placed at
  // all, so it is left out of both — guessing would invent a customer.
  const earliest = new Map();
  for (const r of rows) {
    if (!r.placed || !r.who) continue;
    const seen = earliest.get(r.who);
    if (!seen || r.placed < seen) earliest.set(r.who, r.placed);
  }
  let firstTime = 0;
  for (const r of placed) {
    if (r.who && earliest.get(r.who) === r.placed) firstTime += 1;
  }

  // ⚠️ THE FILL IS THE DAYS' OWN: capacity for the bake days inside the window, against what was sold for
  // those days. A day with no capacity stated falls back to her default, exactly as the shop does.
  const def = Number(state && state.settings && state.settings.defaultCapacity);
  let sold = 0;
  let capacity = 0;
  for (const day of (state && state.deliveryDates) || []) {
    if (!day || !inWindow(day.date, w)) continue;
    const cap = Number(day.capacity);
    capacity += Number.isFinite(cap) && cap > 0 ? cap : (Number.isFinite(def) && def > 0 ? def : 0);
    sold += rows.filter((r) => (r.dayId && r.dayId === day.id) || (!r.dayId && r.dayIso === day.date))
      .reduce((n, r) => n + r.qty, 0);
  }

  return {
    orders: placed.length,
    firstTime,
    returning: placed.length - firstTime,
    fill: capacity > 0 ? Math.round((100 * sold) / capacity) : null,
    sold,
    capacity,
  };
}

/**
 * This week against the week before — read as a PAIR, because at her volumes one week is weather.
 * @returns {{now: object, prev: object}}
 */
export function shopWeek(state, { endIso = "", days = 7 } = {}) {
  const end = endIso || isoOf(new Date());
  const prevEnd = addDays(end, -days);
  return { now: windowNumbers(state, { endIso: end, days }), prev: windowNumbers(state, { endIso: prevEnd, days }) };
}

/**
 * The last `weeks` seven-day windows, averaged — ⭐ because ONE week at her volumes is weather, not a signal.
 * @returns {{ordersPerWeek: number, fill: number|null, weeks: number}}
 */
export function fourWeek(state, { endIso = "", weeks = 4 } = {}) {
  const end = endIso || isoOf(new Date());
  const n = Math.max(1, Math.floor(weeks));
  let orders = 0;
  let sold = 0;
  let capacity = 0;
  for (let i = 0; i < n; i += 1) {
    const w = windowNumbers(state, { endIso: addDays(end, -7 * i), days: 7 });
    orders += w.orders;
    sold += w.sold;
    capacity += w.capacity;
  }
  return {
    ordersPerWeek: Math.round((orders / n) * 10) / 10,
    fill: capacity > 0 ? Math.round((100 * sold) / capacity) : null,
    weeks: n,
  };
}
