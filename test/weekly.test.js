// test/weekly.test.js — the Home "at a glance" numbers + weekly to-do logic.
// Pure-data module (admin/js/weekly.js) with no DOM dependency; every clocked
// function takes an explicit { today } so no test depends on the real date.
// Weeks run Sunday→Saturday: weekStartISO is the Sunday of today's week.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};

import { addDays } from "../admin/js/dates.js";

const { WEEKLY_TASKS, addTask, comingWeeks, loadRoutine: loadR,
  materializeTasks, mergeWeekCheck: mergeWc, mondayAnchor,
  newOrderCount: countNew, nextBake: next, removeTask, renameTask,
  taskList, toggleRoutine: toggle, weekStartISO: sundayOf, weekStats: stats }
  = await import("../admin/js/weekly.js");

// A fixed mid-week day (2026-09-09 is a Wednesday; its week's Sunday is
// 2026-09-06) so windows and week labels are stable.
const TODAY = "2026-09-09";
const SUNDAY = "2026-09-06";

function baseState(overrides = {}) {
  return {
    settings: { currency: "RM", ...(overrides.settings || {}) },
    products: [
      { id: "p1", name: "Focaccia", price: 15 },
      { id: "p2", name: "Sandwich", price: undefined }, // no price yet
      { id: "p3", name: "Croissant", price: 8 },
    ],
    deliveryDates: [],
    orders: [],
    ...overrides,
  };
}

test("weekStartISO returns the Sunday of the week for any day", () => {
  assert.equal(sundayOf(TODAY), SUNDAY);
  assert.equal(sundayOf(SUNDAY), SUNDAY, "a Sunday maps to itself");
  // Every day from that Sunday to the following Saturday maps back to it.
  for (let k = 0; k < 7; k++) {
    assert.equal(sundayOf(addDays(SUNDAY, k)), SUNDAY, `Sun+${k} stays in the same week`);
  }
  assert.equal(sundayOf(addDays(SUNDAY, 7)), addDays(SUNDAY, 7), "the next Sunday starts a new week");
  assert.equal(sundayOf("2026-09-07"), SUNDAY, "Monday is after the Sunday start");
  assert.equal(sundayOf("2026-09-12"), SUNDAY, "Saturday still belongs to that week");
});

test("newOrderCount counts New groups, one cart counting once", () => {
  const s = baseState();
  assert.equal(countNew(s), 0, "no orders → 0");

  // One storefront cart of two items + one plain single order = 2 groups.
  s.orders = [
    { id: "o1", groupId: "g1", productId: "p1", qty: 1, status: "new", deliveryDateId: "d1" },
    { id: "o2", groupId: "g1", productId: "p3", qty: 2, status: "new", deliveryDateId: "d1" },
    { id: "o3", productId: "p1", qty: 1, status: "new", deliveryDateId: "d1" },
    { id: "o4", productId: "p1", qty: 1, status: "confirmed", deliveryDateId: "d1" },
  ];
  assert.equal(countNew(s), 2, "one 2-item group + one single");
});

test("weekStats: Sunday→today window, group count, RM + unpriced, top sellers", () => {
  const s = baseState({
    orders: [
      // One customer cart (2 items) placed today → counts as ONE order.
      { id: "o1", groupId: "g1", productId: "p1", qty: 2, status: "confirmed", orderDate: TODAY },
      { id: "o2", groupId: "g1", productId: "p2", qty: 3, status: "confirmed", orderDate: TODAY },
      // A single order placed on this week's Sunday — inside the window.
      { id: "o3", productId: "p3", qty: 4, status: "delivered", orderDate: SUNDAY },
      // Placed last Saturday (before the Sunday start) — outside the window.
      { id: "o4", productId: "p1", qty: 9, status: "delivered", orderDate: addDays(SUNDAY, -1) },
      // Placed in the future — not this week yet.
      { id: "o6", productId: "p1", qty: 1, status: "new", orderDate: addDays(TODAY, 1) },
      // Placed recently but recorded with no usable date — skipped.
      { id: "o5", productId: "p1", qty: 1, status: "new" },
    ],
  });

  const w = stats(s, { today: TODAY });
  assert.equal(w.orders, 2, "the two cart rows count as one order, plus the Sunday single");
  assert.equal(w.rm, (2 * 15) + (4 * 8), "priced items sum; unpriced Sandwich adds 0");
  assert.equal(w.unpriced, true, "Sandwich has no price → flagged");
  assert.deepEqual(w.top.map((t) => t.name), ["Croissant", "Sandwich", "Focaccia"],
    "top sellers by qty: Croissant ×4, Sandwich ×3, Focaccia ×2");
});

test("weekStats: all priced, no flag; qty ties break alphabetically; top capped at 3", () => {
  const s = baseState();
  s.products[1].price = 6;
  s.orders = [
    { id: "o1", productId: "p3", qty: 2, orderDate: TODAY },
    { id: "o2", productId: "p3", qty: 2, orderDate: TODAY },
    { id: "o3", productId: "p1", qty: 1, orderDate: TODAY },
    { id: "o4", productId: "p2", qty: 1, orderDate: TODAY },
  ];

  const w = stats(s, { today: TODAY });
  assert.equal(w.rm, (4 * 8) + 15 + 6, "everything priced sums");
  assert.equal(w.unpriced, false, "no unpriced product involved");
  assert.deepEqual(w.top.map((t) => t.name), ["Croissant", "Focaccia", "Sandwich"],
    "Croissant ×4 top; Focaccia ×1 before Sandwich ×1 alphabetically");
});

test("weekStats counts the week's start even when today is Sunday", () => {
  const s = baseState();
  const sunday = SUNDAY;
  s.orders = [
    { id: "o1", productId: "p3", qty: 2, orderDate: sunday },
  ];
  const w = stats(s, { today: sunday });
  assert.equal(w.orders, 1, "the single Sunday order is in 'this week'");
  assert.equal(w.rm, 16);
});

test("nextBake picks the earliest upcoming date still needing a bake", () => {
  const s = baseState({
    deliveryDates: [
      { id: "dA", date: "2026-09-10" }, // nearer, has work → the pick
      { id: "dB", date: "2026-09-12" }, // fully Baked/Delivered
      { id: "dC", date: "2026-09-15" }, // has work but later
    ],
    orders: [
      { id: "x1", deliveryDateId: "dA", productId: "p1", qty: 1, status: "new" },
      { id: "x2", deliveryDateId: "dB", productId: "p1", qty: 1, status: "baking" },
      { id: "x3", deliveryDateId: "dB", productId: "p3", qty: 1, status: "delivered" },
      { id: "x4", deliveryDateId: "dC", productId: "p1", qty: 2, status: "new" },
      { id: "x5", deliveryDateId: "dC", productId: "p3", qty: 1, status: "paid" },
    ],
  });
  const b = next(s, { today: TODAY });
  assert.equal(b.dateId, "dA", "dA is earliest AND has work");
  assert.equal(b.hasWork, true);
  assert.equal(b.totalItems, 1);
  assert.deepEqual(b.lines, [{ name: "Focaccia", qty: 1 }]);
});

test("nextBake skips dates fully handled; falls back to earliest upcoming when empty", () => {
  const s = baseState({
    deliveryDates: [
      { id: "dA", date: "2026-09-10" }, // only Baked/Delivered orders
      { id: "dB", date: "2026-09-12" }, // empty
    ],
    orders: [
      { id: "x1", deliveryDateId: "dA", productId: "p1", qty: 3, status: "baking" },
      { id: "x2", deliveryDateId: "dA", productId: "p3", qty: 2, status: "delivered" },
    ],
  });
  const b = next(s, { today: TODAY });
  assert.equal(b.dateId, "dA", "falls back to the soonest upcoming date");
  assert.equal(b.hasWork, false, "nothing to bake on it");
  assert.equal(b.totalItems, 0);
  assert.deepEqual(b.lines, []);
});

test("nextBake ignores past dates, orphan orders, and returns null with no dates", () => {
  const s = baseState({
    deliveryDates: [{ id: "dF", date: "2026-09-20" }],
    orders: [
      { id: "x1", deliveryDateId: "dPast", productId: "p1", qty: 9, status: "new" }, // orphan
    ],
  });
  // No delivery date >= today at all → null.
  assert.equal(next(baseState(), { today: TODAY }), null, "no dates → null");
  // Orphan order only → the real date shows empty, orphan never counted.
  const b = next(s, { today: TODAY });
  assert.equal(b.dateId, "dF");
  assert.equal(b.hasWork, false);
  assert.deepEqual(b.lines, [], "orphan's qty is not baked");

  // A past date with new orders must not be chosen.
  s.deliveryDates.push({ id: "dPastD", date: addDays(TODAY, -1) });
  s.orders.push({ id: "x2", deliveryDateId: "dPastD", productId: "p1", qty: 4, status: "new" });
  const b2 = next(s, { today: TODAY });
  assert.equal(b2.dateId, "dF", "past date ignored even though it has a new order");
});

test("routine ticks persist under the current week and reset on a new one", () => {
  const s = baseState();
  assert.equal(loadR(s, { today: TODAY }).done.orders, undefined, "fresh list");

  toggle(s, "orders", { today: TODAY });
  toggle(s, "social", { today: TODAY });
  const rt = loadR(s, { today: TODAY });
  assert.equal(rt.week, SUNDAY, "stored under the current Sunday");
  assert.deepEqual(Object.keys(rt.done).sort(), ["orders", "social"]);
  assert.equal(WEEKLY_TASKS.some((t) => t.id === "orders" && t.label.includes("Reply")), true,
    "routine list carries readable tasks");

  // Un-tick removes only that task.
  toggle(s, "orders", { today: TODAY });
  assert.deepEqual(loadR(s, { today: TODAY }).done, { social: true }, "orders un-ticked, social kept");

  // A stored week from before → the list reads fresh until the next tick.
  const s2 = baseState();
  s2.settings.weekCheck = { week: addDays(SUNDAY, -7), done: { orders: true, stock: true } };
  assert.deepEqual(loadR(s2, { today: TODAY }).done, {}, "old week's ticks don't show");
  toggle(s2, "orders", { today: TODAY }); // first tick of the new week
  assert.deepEqual(loadR(s2, { today: TODAY }).done, { orders: true }, "stale ticks cleared on write");
});

test("mergeWeekCheck unions the same week and lets the later week win otherwise", () => {
  assert.deepEqual(mergeWc(), { week: "", done: {} }, "nothing → fresh list");
  assert.deepEqual(mergeWc({ week: "", done: {} }, { week: "", done: {} }), { week: "", done: {} });

  // Same week: phone and Mac ticks both survive.
  const a = { week: SUNDAY, done: { orders: true, social: true } };
  const b = { week: SUNDAY, done: { orders: true, stock: true, menu: true } };
  assert.deepEqual(mergeWc(a, b), { week: SUNDAY, done: { orders: true, social: true, stock: true, menu: true } });

  // Different weeks: the later (lexically larger ISO) week wins alone.
  const older = { week: addDays(SUNDAY, -7), done: { orders: true, dates: true } };
  assert.deepEqual(mergeWc(a, older), a, "current week beats a stale one");
  assert.deepEqual(mergeWc(older, a), a, "order of the arguments doesn't matter");

  // An empty side never wipes a real week.
  assert.deepEqual(mergeWc(a, {}), a);
  assert.deepEqual(mergeWc({}, a), a);

  // Malformed input falls back to a fresh list.
  assert.deepEqual(mergeWc({ week: SUNDAY, done: "nope" }, { done: [1] }), { week: SUNDAY, done: {} });
});

test("WEEKLY_TASKS has six unique, sensible routine ids", () => {
  const ids = WEEKLY_TASKS.map((t) => t.id);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, "unique ids");
  for (const t of WEEKLY_TASKS) assert.ok(t.label.trim().length > 3);
});

// ── Coming-4-weeks forecast (Monday-anchored windows) ─────────────────────

test("mondayAnchor is the first Monday on or after today", () => {
  assert.equal(mondayAnchor("2026-09-05"), "2026-09-07", "a Saturday rolls to the next Monday");
  assert.equal(mondayAnchor("2026-09-06"), "2026-09-07", "a Sunday rolls to the next Monday");
  assert.equal(mondayAnchor("2026-09-09"), "2026-09-14", "mid-week rolls to the next Monday");
  assert.equal(mondayAnchor("2026-09-14"), "2026-09-14", "a Monday maps to itself");
  assert.equal(mondayAnchor("2026-12-31"), "2027-01-04", "crosses a year boundary");
});

// Delivery cadence Mon/Wed/Fri. TODAY is Wed 2026-09-09, so Week 1 runs Mon
// 2026-09-14 – Sun 2026-09-20 and any earlier upcoming date folds into Week 1.
function forecastState() {
  return baseState({
    settings: { currency: "RM", defaultCapacity: 12 },
    products: [
      { id: "p1", name: "Focaccia", price: 15, recipe: [] },
      { id: "p2", name: "Sandwich", recipe: [] }, // no price yet
      { id: "p3", name: "Croissant", price: 8, recipe: [] },
    ],
    deliveryDates: [
      { id: "g", date: "2026-09-11" },  // before Week 1's Monday → folds in
      { id: "d1", date: "2026-09-14" }, // Week 1 Mon
      { id: "d2", date: "2026-09-16" }, // Week 1 Wed
      { id: "d3", date: "2026-09-18" }, // Week 1 Fri (no orders)
      { id: "d4", date: "2026-09-21" }, // Week 2 Mon
      { id: "d5", date: "2026-09-30" }, // Week 3 Wed
      { id: "d6", date: "2026-10-06" }, // Week 4 Tue
      { id: "dLater", date: "2026-10-19" }, // beyond the window
    ],
    orders: [
      { id: "o1", deliveryDateId: "d1", productId: "p1", qty: 2, status: "new" },
      { id: "o2", deliveryDateId: "d1", productId: "p2", qty: 1, status: "new" },
      { id: "o3", deliveryDateId: "d2", productId: "p3", qty: 4, status: "confirmed" },
      { id: "o4", deliveryDateId: "d4", productId: "p1", qty: 3, status: "new" },
    ],
  });
}

test("comingWeeks returns four Mon–Sun rows with the dates each week holds", () => {
  const w = comingWeeks(forecastState(), { today: TODAY });
  assert.equal(w.rows.length, 4);
  assert.deepEqual(
    w.rows.map((r) => [r.start, r.end]),
    [["2026-09-14", "2026-09-20"], ["2026-09-21", "2026-09-27"],
     ["2026-09-28", "2026-10-04"], ["2026-10-05", "2026-10-11"]],
    "windows are four Mon–Sun weeks from the coming Monday");

  const ids = (r) => r.dates.map((d) => d.id);
  assert.deepEqual(ids(w.rows[0]), ["g", "d1", "d2", "d3"],
    "the pre-Monday date folds into Week 1 alongside its Mon/Wed/Fri dates");
  assert.deepEqual(ids(w.rows[1]), ["d4"]);
  assert.deepEqual(ids(w.rows[2]), ["d5"], "30 Sep sits in Week 3 across the month edge");
  assert.deepEqual(ids(w.rows[3]), ["d6"]);
  assert.deepEqual(w.later.map((d) => d.id), ["dLater"], "past the window comes back under later");
});

test("comingWeeks totals: booked/free come from capacity, money flags unpriced", () => {
  const w = comingWeeks(forecastState(), { today: TODAY });
  const week1 = w.rows[0];
  // d1: 2+1 booked of 12, d2: 4 of 12, d3 and g: 0 of 12.
  assert.equal(week1.booked, 7, "pieces booked on Week-1 dates");
  assert.equal(week1.capacity, 48, "four dates × capacity 12");
  assert.equal(week1.free, (12 - 3) + (12 - 4) + 12 + 12, "free slots only on the open remainder");
  assert.equal(week1.rm, (2 * 15) + (4 * 8), "priced items sum; the unpriced Sandwich adds 0");
  assert.equal(week1.unpriced, true, "an ordered product has no price → flagged");

  assert.equal(w.rows[1].booked, 3);
  assert.equal(w.rows[1].rm, 3 * 15, "week-2 money");
  assert.equal(w.rows[1].unpriced, false);
  assert.equal(w.rows[2].booked, 0, "an empty week is 0/0 with no flag");
  assert.equal(w.rows[2].rm, 0);
  assert.equal(w.rows[3].booked, 0);
});

test("comingWeeks: weeks count can be shrunk; no dates → empty rows and later", () => {
  const two = comingWeeks(forecastState(), { today: TODAY, weeks: 2 });
  assert.equal(two.rows.length, 2, "only two windows when asked");
  assert.deepEqual(two.later.map((d) => d.id),
    ["d5", "d6", "dLater"], "dates past the two-week window all become later");

  const empty = comingWeeks(baseState(), { today: TODAY });
  assert.ok(empty.rows.every((r) => r.dates.length === 0), "no dates → empty weeks");
  assert.equal(empty.rows[0].booked, 0);
  assert.equal(empty.rows[0].free, 0);
  assert.deepEqual(empty.later, []);
});

// ── the editable to-do (task definitions) ─────────────────────────────────

test("task helpers: presets until the first edit, then a stored authoritative list", () => {
  const s = baseState();
  assert.equal(taskList(s), WEEKLY_TASKS, "unchanged list is the preset seed");
  assert.ok(!Array.isArray(s.settings.tasks), "nothing stored until an edit");

  // Renaming a preset materialises the list first, keeping all six rows.
  assert.equal(renameTask(s, "orders", "  Answer new orders fast  "), true);
  assert.equal(s.settings.tasks.length, 6, "presets kept");
  assert.equal(s.settings.tasks.find((t) => t.id === "orders").label, "Answer new orders fast");
  assert.equal(WEEKLY_TASKS.find((t) => t.id === "orders").label.includes("Reply"), true,
    "the preset constant itself is untouched");
});

test("task helpers: add appends a custom task, blank labels are rejected", () => {
  const s = baseState();
  assert.equal(addTask(s, "   Clean the oven  "), true);
  const added = s.settings.tasks.find((t) => t.label === "Clean the oven");
  assert.ok(added, "custom task stored");
  assert.ok(added.id.startsWith("tsk"), "fresh id, never clashing with preset ids");
  assert.equal(s.settings.tasks.length, 7, "six presets + one custom");

  const before = s.settings.tasks.length;
  assert.equal(addTask(s, "   "), false, "blank add does nothing");
  assert.equal(renameTask(s, added.id, "  "), false, "blank rename does nothing");
  assert.equal(s.settings.tasks.length, before);
  assert.equal(s.settings.tasks.find((t) => t.id === added.id).label, "Clean the oven", "label unchanged");
});

test("task helpers: remove deletes one row; deleting all stays empty (no preset revival)", () => {
  const s = baseState();
  materializeTasks(s);
  const id = s.settings.tasks[2].id;
  assert.equal(removeTask(s, id), true);
  assert.equal(s.settings.tasks.length, 5);
  assert.equal(removeTask(s, "nope"), false, "unknown id is a no-op");

  const s2 = baseState();
  for (const t of WEEKLY_TASKS) removeTask(s2, t.id);
  assert.deepEqual(s2.settings.tasks, [], "empty list is authoritative");
  assert.deepEqual(taskList(s2), [], "taskList honours the stored empty list");
});
