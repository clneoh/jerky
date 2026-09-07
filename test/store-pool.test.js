// test/store-pool.test.js — the shared availability pool on the customer page.
// Pure module (store/pool.js): how a cart mixing singles and value packs is
// capped against ONE shared base budget, and the per-product delivery-date
// rules that gate individual products on some dates.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysKey, humanKey,
  closeDaysFor, closedReason,
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
  assert.equal(closedReason(pack, "2026-09-07", today), "", "near dates stay open for a blank pack");
  assert.equal(closedReason(single, "2026-09-07", today), "");
  assert.equal(closedReason(pack, "2026-09-18", today), "");
  assert.equal(closedReason(pack, "2026-10-02", today), "");
  // Unknown dates never lock a product.
  assert.equal(closedReason(pack, "", today), "");
  assert.equal(closedReason(pack, "2026-09-20", ""), "");
});

test("a product's own close days gate near dates, and explicit 0 opens any day", () => {
  const today = "2026-09-04";
  const pack3 = { name: "P3", component: { name: "Focaccia", qty: 4 }, closeDays: 3 };
  const pack0 = { name: "P0", component: { name: "Focaccia", qty: 4 }, closeDays: 0 };
  assert.equal(closeDaysFor(pack3), 3);
  assert.equal(closeDaysFor(pack0), 0);
  // X = 3: 7 Sep is the first allowed date (today + 3).
  assert.match(closedReason(pack3, "2026-09-06", today), /Orders close 3 days before delivery/);
  assert.equal(closedReason(pack3, "2026-09-07", today), "");
  // Explicit 0 means no early close — even today's date stays open.
  assert.equal(closedReason(pack0, "2026-09-04", today), "");
});

test("a from–to delivery window gates dates outside it", () => {
  const today = "2026-09-04";
  const seasonal = { name: "CNY set", closeDays: 0, validFrom: "2026-12-01", validTo: "2026-12-24" };
  const before = closedReason(seasonal, "2026-11-30", today);
  assert.match(before, /Only available for delivery from/);
  assert.ok(before.includes(humanKey("2026-12-01")), "note names the window's start date");
  assert.equal(closedReason(seasonal, "2026-12-01", today), "");
  assert.equal(closedReason(seasonal, "2026-12-24", today), "");
  assert.match(closedReason(seasonal, "2026-12-25", today), /Only available for delivery up to/);
});

test("close and window combine: inside the window but too near still closes", () => {
  const today = "2026-12-01";
  const both = { name: "B", closeDays: 7, validFrom: "2026-12-01", validTo: "2026-12-24" };
  // Outside the window wins first.
  assert.match(closedReason(both, "2026-12-25", today), /up to/);
  assert.match(closedReason(both, "2026-11-20", today), /from/);
  // Inside the window, the 7-day close still applies (3 Dec is only 2 days out).
  assert.match(closedReason(both, "2026-12-03", today), /Orders close 7 days before delivery/);
  // 8 Dec (7 days out) and beyond are open.
  assert.equal(closedReason(both, "2026-12-08", today), "");
});

test("addDaysKey shifts whole days and survives month/year boundaries", () => {
  assert.equal(addDaysKey("2026-09-04", 14), "2026-09-18");
  assert.equal(addDaysKey("2026-09-30", 2), "2026-10-02");
  assert.equal(addDaysKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysKey("", 3), "");
  assert.equal(addDaysKey("garbage", 3), "");
});
