// test/store-pool.test.js — the shared availability pool on the customer page.
// Pure module (store/pool.js): how a cart mixing singles and value packs is
// capped against ONE shared base budget, and the per-product delivery-date
// rules that gate individual products on some dates.
//
// closedReason() returns the RULE as data (never a sentence): the customer page
// writes it in the visitor's language, so no English may be baked in here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysKey,
  cancelDaysFor, closeDaysFor, closedReason, strictestCancelDays,
  poolGroups, groupFor, poolCaps, clampPool, poolPieces,
} from "../store/pool.js";

// The storefront products a pool-aware publish would deliver: single Focaccia
// (n = 1, no component) + a 4-piece family pack + a separate unrelated single.
const products = [
  { name: "Focaccia", price: 15, unit: "loaf" },
  { name: "Focaccia Family (4 pcs)", price: 54, unit: "box", component: { name: "Focaccia", qty: 4 } },
  { name: "Brownie", price: 6, unit: "piece" },
];

test("poolGroups groups a pack with its base, single-bases join as n=1", () => {
  const groups = poolGroups(products);
  assert.ok(groups.has("Focaccia"));
  const g = groups.get("Focaccia");
  assert.equal(g.baseName, "Focaccia");
  // sorted n-descending: the pack (n=4) first, then the base (n=1)
  assert.deepEqual(g.members.map((m) => [m.name, m.n]), [
    ["Focaccia Family (4 pcs)", 4],
    ["Focaccia", 1],
  ]);
  // A product with no relation to any pool is absent entirely.
  assert.ok(!groups.has("Brownie"));
  // A component of qty 1 is just the base itself — never a group.
  const alone = poolGroups([{ name: "X", component: { name: "X", qty: 1 } }]);
  assert.equal(alone.size, 0);
});

test("groupFor resolves a base and its pack to the same group", () => {
  const groups = poolGroups(products);
  const single = groupFor(groups, products[0]);
  const pack = groupFor(groups, products[1]);
  assert.equal(single.baseName, "Focaccia");
  assert.equal(pack.baseName, "Focaccia");
  assert.equal(groupFor(groups, products[2]), undefined);
});

test("poolCaps lets each member fill what the others leave, excluding itself", () => {
  const group = poolGroups(products).get("Focaccia");
  const empty = poolCaps(group, 12, new Map());
  // 12 pieces: 3 whole packs fit, or 12 singles.
  assert.equal(empty.get("Focaccia Family (4 pcs)"), 3);
  assert.equal(empty.get("Focaccia"), 12);

  // Cart already holds 2 singles: a whole pack still fits (2 pieces are used
  // by singles, 10 ÷ 4 → 2), and singles may top up to fill the whole pool
  // (a member's cap excludes its own current qty — the + button tops up to it).
  const cart = new Map([["Focaccia", 2]]);
  const caps = poolCaps(group, 12, cart);
  assert.equal(caps.get("Focaccia Family (4 pcs)"), 2);
  assert.equal(caps.get("Focaccia"), 12);

  // Cart already holds 3 packs → all 12 pieces taken → singles capped at 0.
  const full = poolCaps(group, 12, new Map([["Focaccia Family (4 pcs)", 3]]));
  assert.equal(full.get("Focaccia"), 0);
  assert.equal(full.get("Focaccia Family (4 pcs)"), 3);

  // A cart of 2 packs + 1 single = 9 pieces: a 3rd pack (13 pieces) can't fit,
  // so packs stay capped at 2 (their current hold); 4 singles still fit.
  const mixed = poolCaps(group, 12, new Map([
    ["Focaccia Family (4 pcs)", 2],
    ["Focaccia", 1],
  ]));
  assert.equal(mixed.get("Focaccia Family (4 pcs)"), 2);
  assert.equal(mixed.get("Focaccia"), 4);
});

test("poolCaps: no live base row means the pool is unlimited today", () => {
  const group = poolGroups(products).get("Focaccia");
  const caps = poolCaps(group, undefined, new Map([["Focaccia", 5]]));
  assert.equal(caps.get("Focaccia Family (4 pcs)"), undefined);
  assert.equal(caps.get("Focaccia"), undefined);
});

test("clampPool enforces one budget across a mixed cart, whole packs first", () => {
  const group = poolGroups(products).get("Focaccia");
  // 3 packs + 3 singles = 15 pieces on a 12-piece pool. Whole packs are kept
  // first (largest n first): 3 packs already take all 12 pieces, so every
  // single leaves the cart.
  const cart = new Map([
    ["Focaccia Family (4 pcs)", 3],
    ["Focaccia", 3],
  ]);
  const clamped = clampPool(cart, group, 12);
  assert.equal(clamped.get("Focaccia Family (4 pcs)"), 3);
  assert.equal(clamped.get("Focaccia"), 0);
  // Σ qty·n across the pool never exceeds the remaining base pieces.
  const pieces = [...clamped].reduce(
    (s, [name, q]) => s + q * (name === "Focaccia" ? 1 : 4), 0);
  assert.equal(pieces, 12);
});

test("clampPool floor edge: 2 pieces left → 2 singles fit, a pack reads out", () => {
  const group = poolGroups(products).get("Focaccia");
  const clamped = clampPool(new Map([
    ["Focaccia Family (4 pcs)", 1],
    ["Focaccia", 2],
  ]), group, 2);
  assert.equal(clamped.get("Focaccia Family (4 pcs)"), 0);
  assert.equal(clamped.get("Focaccia"), 2);
});

test("clampPool returns empty when there is no live budget", () => {
  const group = poolGroups(products).get("Focaccia");
  const clamped = clampPool(new Map([["Focaccia", 9]]), group, undefined);
  assert.equal(clamped.size, 0);
});

test("poolPieces aggregates only what the cart's packs consume of each base", () => {
  const cart = new Map([
    ["Focaccia", 3],                       // singles — already a top-level line
    ["Focaccia Family (4 pcs)", 2],        // 2 × 4 = 8 base pieces
    ["Focaccia Family (2 pcs)", 1],        // 1 × 2 = 2 base pieces (a second pack)
    ["Brownie", 5],                        // unrelated — no component
  ]);
  const twoPack = [
    ...products,
    { name: "Focaccia Family (2 pcs)", price: 28, unit: "box", component: { name: "Focaccia", qty: 2 } },
  ];
  assert.deepEqual(poolPieces(twoPack, cart), [
    { name: "Focaccia", qty: 10 },
  ]);
  // No packs in the cart → no pool payload at all (not even the base singles).
  assert.deepEqual(poolPieces(twoPack, new Map([["Focaccia", 3]])), []);
  // A cart holding a pack that isn't in the storefront products lists nothing —
  // the products list is the source of truth for what is actually a pack.
  const singlesOnly = [{ name: "Focaccia", price: 15, unit: "loaf" }];
  assert.deepEqual(poolPieces(singlesOnly, new Map([["Focaccia Family (4 pcs)", 1]])), []);
});

test("a blank value pack is open any day, like any other blank product", () => {
  const today = "2026-09-04";
  const pack = { name: "Focaccia Family (4 pcs)", component: { name: "Focaccia", qty: 4 } };
  const single = { name: "Focaccia", price: 15, unit: "loaf" };
  // No hidden 14-day default for packs — the close is per product. A pack left
  // blank sells on any open date, exactly like a blank single.
  assert.equal(closeDaysFor(pack), 0);
  assert.equal(closeDaysFor(single), 0);
  assert.equal(closedReason(pack, "2026-09-07", today), null, "near dates stay open for a blank pack");
  assert.equal(closedReason(single, "2026-09-07", today), null);
  assert.equal(closedReason(pack, "2026-09-18", today), null);
  assert.equal(closedReason(pack, "2026-10-02", today), null);
  // Unknown dates never lock a product.
  assert.equal(closedReason(pack, "", today), null);
  assert.equal(closedReason(pack, "2026-09-20", ""), null);
});

test("a product's own close days gate near dates, and explicit 0 opens any day", () => {
  const today = "2026-09-04";
  const pack3 = { name: "P3", component: { name: "Focaccia", qty: 4 }, closeDays: 3 };
  const pack0 = { name: "P0", component: { name: "Focaccia", qty: 4 }, closeDays: 0 };
  assert.equal(closeDaysFor(pack3), 3);
  assert.equal(closeDaysFor(pack0), 0);
  // X = 3: 7 Sep is the first allowed date (today + 3).
  assert.deepEqual(closedReason(pack3, "2026-09-06", today), { kind: "close", days: 3 });
  assert.equal(closedReason(pack3, "2026-09-07", today), null);
  // Explicit 0 means no early close — even today's date stays open.
  assert.equal(closedReason(pack0, "2026-09-04", today), null);
});

test("a from–to delivery window gates dates outside it", () => {
  const today = "2026-09-04";
  const seasonal = { name: "CNY set", closeDays: 0, validFrom: "2026-12-01", validTo: "2026-12-24" };
  assert.deepEqual(closedReason(seasonal, "2026-11-30", today), { kind: "from", date: "2026-12-01" },
    "before the window names the day it opens");
  assert.equal(closedReason(seasonal, "2026-12-01", today), null);
  assert.equal(closedReason(seasonal, "2026-12-24", today), null);
  assert.deepEqual(closedReason(seasonal, "2026-12-25", today), { kind: "to", date: "2026-12-24" },
    "after the window names the last day it is open");
});

test("close and window combine: inside the window but too near still closes", () => {
  const today = "2026-12-01";
  const both = { name: "B", closeDays: 7, validFrom: "2026-12-01", validTo: "2026-12-24" };
  // Outside the window wins first.
  assert.deepEqual(closedReason(both, "2026-12-25", today), { kind: "to", date: "2026-12-24" });
  assert.deepEqual(closedReason(both, "2026-11-20", today), { kind: "from", date: "2026-12-01" });
  // Inside the window, the 7-day close still applies (3 Dec is only 2 days out).
  assert.deepEqual(closedReason(both, "2026-12-03", today), { kind: "close", days: 7 });
  // 8 Dec (7 days out) and beyond are open.
  assert.equal(closedReason(both, "2026-12-08", today), null);
});

// ── sellRules — the days the baker marked as sell days ──────────────────────
// 2026-12-01 is a Tuesday; 5 Dec is a Saturday, 6 Dec a Sunday, 7 Dec a Monday.

test("no marks at all leaves the product open on every date", () => {
  const today = "2026-09-04";
  const plain = { name: "Focaccia" };
  for (const d of ["2026-09-27", "2026-12-01", "2027-06-15"]) {
    assert.equal(closedReason(plain, d, today), null, `${d} stays open with nothing marked`);
  }
  assert.equal(closedReason({ name: "X", sellRules: [] }, "2026-09-27", today), null,
    "an empty mark list reads as nothing marked");
});

test("a weekend mark sells Sat and Sun only, and says which weekdays it does sell", () => {
  const today = "2026-09-04";
  const weekend = { name: "Weekend loaf", sellRules: [{ days: [6, 0] }] };
  assert.equal(closedReason(weekend, "2026-12-05", today), null, "Saturday sells");
  assert.equal(closedReason(weekend, "2026-12-06", today), null, "Sunday sells");
  assert.deepEqual(closedReason(weekend, "2026-12-07", today), { kind: "days", days: [0, 6] },
    "a Monday inside no mark names the weekdays that do sell");
  assert.deepEqual(closedReason(weekend, "2026-12-01", today), { kind: "days", days: [0, 6] },
    "before any span, the weekday list still applies — the mark never ends");
});

test("a marked span sells every day in it, and the days outside say why", () => {
  const today = "2026-12-01";
  const xmas = { name: "Xmas set", sellRules: [{ days: [], from: "2026-12-10", to: "2026-12-16" }] };
  assert.equal(closedReason(xmas, "2026-12-10", today), null, "the first day is in");
  assert.equal(closedReason(xmas, "2026-12-13", today), null, "a Sunday inside the span sells too");
  assert.equal(closedReason(xmas, "2026-12-16", today), null, "the last day is in");
  assert.deepEqual(closedReason(xmas, "2026-12-09", today), { kind: "from", date: "2026-12-10" },
    "the day before names when it opens");
  assert.deepEqual(closedReason(xmas, "2026-12-17", today), { kind: "to", date: "2026-12-16" },
    "the day after names when it closed");
});

test("two marks OR together, and a day in the gap between them is unmarked", () => {
  const today = "2026-11-01";
  const two = { name: "Two runs", sellRules: [
    { days: [], from: "2026-12-01", to: "2026-12-05" },
    { days: [], from: "2026-12-20", to: "2026-12-24" },
  ] };
  assert.equal(closedReason(two, "2026-12-01", today), null, "the first run sells");
  assert.equal(closedReason(two, "2026-12-22", today), null, "the second run sells");
  assert.deepEqual(closedReason(two, "2026-12-12", today), { kind: "unmarked" },
    "the gap between the two runs is not sold");
});

test("a weekday inside a span sells on that weekday only, and is open-ended either way", () => {
  const today = "2026-11-01";
  const weekendsInDec = { name: "Dec weekends", sellRules: [{ days: [6, 0], from: "2026-12-01", to: "2026-12-31" }] };
  assert.equal(closedReason(weekendsInDec, "2026-12-05", today), null, "a Saturday in December sells");
  assert.equal(closedReason(weekendsInDec, "2026-12-26", today), null, "a Saturday later that month sells");
  assert.deepEqual(closedReason(weekendsInDec, "2026-12-07", today), { kind: "days", days: [0, 6] },
    "a Monday inside December is closed, and the weekdays that sell are named");
  assert.deepEqual(closedReason(weekendsInDec, "2027-01-04", today), { kind: "to", date: "2026-12-31" },
    "past the span, the mark has ended");

  // Open ends: "from here on" and "up to here".
  const fromHere = { name: "F", sellRules: [{ days: [6], from: "2026-12-05" }] };
  assert.equal(closedReason(fromHere, "2027-06-05", today), null, "an open end never closes");
  assert.deepEqual(closedReason(fromHere, "2026-12-04", today), { kind: "from", date: "2026-12-05" });
  const upToHere = { name: "U", sellRules: [{ days: [6], to: "2026-12-05" }] };
  assert.deepEqual(closedReason(upToHere, "2026-12-12", today), { kind: "to", date: "2026-12-05" });
});

test("a marked-off day beats the advance-notice rule — the truer answer comes first", () => {
  const today = "2026-12-01";
  // A cake that needs 14 days' notice, sold on Saturdays only. 2026-12-05 is a
  // Saturday but only 4 days out: it is a sell day, so the notice note is right.
  // 2026-12-07 is a Monday and too near: "not sold that day" is the truer answer.
  const cake = { name: "Cake", closeDays: 14, sellRules: [{ days: [6], from: "2026-12-01", to: "2026-12-31" }] };
  assert.deepEqual(closedReason(cake, "2026-12-05", today), { kind: "close", days: 14 },
    "a marked sell day that is too near reports the notice, not the weekday");
  assert.deepEqual(closedReason(cake, "2026-12-07", today), { kind: "days", days: [6] },
    "a day it is not sold reports that, even though it is also too near");
});

test("a legacy from–to window and a mark stating the same span never count twice", () => {
  const today = "2026-11-01";
  const both = { name: "B", validFrom: "2026-12-01", validTo: "2026-12-24",
    sellRules: [{ days: [], from: "2026-12-01", to: "2026-12-24" }] };
  // A save writes both out for one release; the same period must not double up.
  assert.equal(closedReason(both, "2026-12-10", today), null);
  assert.deepEqual(closedReason(both, "2026-11-30", today), { kind: "from", date: "2026-12-01" });
  assert.deepEqual(closedReason(both, "2026-12-25", today), { kind: "to", date: "2026-12-24" });
});

test("junk marks are dropped rather than locking a product", () => {
  const today = "2026-09-04";
  const messy = { name: "M", sellRules: [
    null, "nonsense", { days: [6] },             // valid: every Saturday, always
    { days: [9, -1, "x"] },                      // weekday junk with no ends → says nothing
    { from: "not-a-date", to: "2026-11-30" },    // bad start → an open-start "until 30 Nov"
  ] };
  assert.equal(closedReason(messy, "2026-12-05", today), null, "the Saturday mark holds");
  assert.equal(closedReason(messy, "2026-11-30", today), null, "the surviving end-only mark holds");
  assert.deepEqual(closedReason(messy, "2026-12-07", today), { kind: "days", days: [6] },
    "the junk entries added nothing — only the Saturday mark remains on a Monday");
  assert.equal(closedReason(messy, "2026-11-25", today), null,
    "a Wednesday inside the end-only mark sells too — that mark covers every day");
});

test("cancelDaysFor: blank is not stated, 0 is a stated zero, junk is not stated", () => {
  assert.equal(cancelDaysFor({ name: "A" }), null);          // no box at all
  assert.equal(cancelDaysFor({ cancelDays: "" }), null);     // blank
  assert.equal(cancelDaysFor({ cancelDays: null }), null);
  assert.equal(cancelDaysFor({ cancelDays: undefined }), null);
  assert.equal(cancelDaysFor({ cancelDays: 0 }), 0);         // a stated zero, not blank
  assert.equal(cancelDaysFor({ cancelDays: 2 }), 2);
  assert.equal(cancelDaysFor({ cancelDays: "3" }), 3);       // a numeric string round-trips
  assert.equal(cancelDaysFor({ cancelDays: -1 }), null);     // negative is junk
  assert.equal(cancelDaysFor({ cancelDays: 1.5 }), null);    // not a whole day
  assert.equal(cancelDaysFor({ cancelDays: "soon" }), null);
  assert.equal(cancelDaysFor(null), null);
});

test("strictestCancelDays: the largest stated window wins, and blank never drags one down", () => {
  assert.equal(strictestCancelDays([
    { cancelDays: 2 }, { cancelDays: 5 }, { cancelDays: 0 },
  ]), 5);
  // A blank product neither wins nor cancels a stated one.
  assert.equal(strictestCancelDays([
    { cancelDays: 2 }, { name: "blank" }, { cancelDays: 0 },
  ]), 2);
  // Nothing stated anywhere → null (no note shown at all).
  assert.equal(strictestCancelDays([{ name: "a" }, { name: "b" }]), null);
  assert.equal(strictestCancelDays([{ cancelDays: "" }, { cancelDays: null }]), null);
  assert.equal(strictestCancelDays([]), null);
  assert.equal(strictestCancelDays(null), null);
  // An explicit 0 counts as stated (it is a real value), so a lone 0 reads 0 — the
  // shop decides not to draw a note for anything below 1.
  assert.equal(strictestCancelDays([{ cancelDays: 0 }, { name: "blank" }]), 0);
});

test("addDaysKey shifts whole days and survives month/year boundaries", () => {
  assert.equal(addDaysKey("2026-09-04", 14), "2026-09-18");
  assert.equal(addDaysKey("2026-09-30", 2), "2026-10-02");
  assert.equal(addDaysKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysKey("", 3), "");
  assert.equal(addDaysKey("garbage", 3), "");
});
