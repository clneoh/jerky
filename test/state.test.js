// test/state.test.js — normalize() guarantees for the storefront settings and
// the order status field, plus the unread-orders badge counter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, defaultState, updateOrderBadge, groupOrders, orderCode, waNumber, ensureSupabase, productUnitOptions, productUsesUnit, BUILTIN_SUPABASE } from "../admin/js/state.js";
import { lockEnabled } from "../admin/js/pin.js";

const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

test("normalize fills the default storefront when missing", () => {
  const out = normalize({ version: 1, settings: {} });
  assert.deepEqual(out.settings.storefront, defaultState().settings.storefront);
});

test("normalize completes a partial storefront and keeps only well-formed products", () => {
  const out = normalize({
    version: 1,
    settings: {
      storefront: {
        whatsapp: "60123456789",
        products: [
          { name: "Focaccia", price: "15", unit: "loaf", description: "Rosemary & sea salt" },
          { name: "  ", price: 9 }, // blank name → dropped
          null,
        ],
      },
    },
  });
  const sf = out.settings.storefront;
  assert.equal(sf.whatsapp, "60123456789");
  assert.equal(sf.name, "");
  assert.equal(sf.tagline, "");
  assert.equal(sf.instagram, "");
  assert.equal(sf.products.length, 1);
  assert.deepEqual(sf.products[0],
    { name: "Focaccia", price: 15, unit: "loaf", description: "Rosemary & sea salt" });
});

test("normalize defaults order status to new and preserves an explicit one", () => {
  const out = normalize({
    version: 1,
    orders: [
      { id: "a" },
      { id: "b", status: "delivered" },
    ],
  });
  assert.equal(out.orders[0].status, "new");
  assert.equal(out.orders[1].status, "delivered");
});

function badgeShim() {
  const badge = { textContent: "", hidden: true };
  globalThis.document = { getElementById: (id) => (id === "orders-badge" ? badge : null) };
  return badge;
}

test("updateOrderBadge counts orders still New and hides at zero", () => {
  const badge = badgeShim();
  try {
    updateOrderBadge({ orders: [{ status: "new" }, { status: "new" }, { status: "delivered" }, {}] });
    assert.equal(badge.textContent, "3", "unset status counts as new");
    assert.equal(badge.hidden, false);
    updateOrderBadge({ orders: [{ status: "confirmed" }, { status: "delivered" }] });
    assert.equal(badge.textContent, "0");
    assert.equal(badge.hidden, true, "no new orders hides the badge");
    updateOrderBadge({ orders: [] });
    assert.equal(badge.hidden, true);
  } finally {
    delete globalThis.document;
  }
});

test("updateOrderBadge caps the count at 99+", () => {
  const badge = badgeShim();
  try {
    const orders = Array.from({ length: 150 }, () => ({ status: "new" }));
    updateOrderBadge({ orders });
    assert.equal(badge.textContent, "99+");
  } finally {
    delete globalThis.document;
  }
});

test("updateOrderBadge counts a multi-item storefront order once", () => {
  const badge = badgeShim();
  try {
    updateOrderBadge({ orders: [
      { status: "new", groupId: "g1" },
      { status: "new", groupId: "g1" },
      { status: "new" },
    ] });
    assert.equal(badge.textContent, "2", "grouped items count as one, plus the standalone");
    assert.equal(badge.hidden, false);
  } finally {
    delete globalThis.document;
  }
});

test("normalize consolidates duplicate delivery dates and re-points orders", () => {
  const out = normalize({
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-09-04", notes: "" },
      { id: "del_b", date: "2026-09-04", notes: "" },
      { id: "del_c", date: "2026-09-07", notes: "" },
    ],
    orders: [
      { id: "o1", deliveryDateId: "del_a", productId: "p", qty: 1 },
      { id: "o2", deliveryDateId: "del_b", productId: "p", qty: 2 },
      { id: "o3", deliveryDateId: "del_c", productId: "p", qty: 4 },
    ],
  });
  assert.equal(out.deliveryDates.length, 2, "duplicate dates merged");
  assert.equal(out.deliveryDates[0].id, "del_a", "first entry survives");
  assert.ok(out.orders.every((o) => o.deliveryDateId !== "del_b"), "no order points at the removed date");
  const moved = out.orders.find((o) => o.id === "o2");
  assert.equal(moved.deliveryDateId, "del_a");
  assert.deepEqual(out.orders.map((o) => o.qty), [1, 2, 4], "no orders lost");
});

test("normalize keeps a day's availability adjustments on its delivery date", () => {
  const out = normalize({
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-09-04", notes: "", dayAdj: { prd_1: 5, prd_2: -3 } },
      { id: "del_c", date: "2026-09-07", notes: "" },
    ],
    orders: [],
  });
  const del = out.deliveryDates.find((d) => d.id === "del_a");
  assert.deepEqual(del.dayAdj, { prd_1: 5, prd_2: -3 }, "dayAdj survives load");
});

test("consolidating duplicate dates keeps the first record's day adjustments", () => {
  const out = normalize({
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-09-04", notes: "", dayAdj: { prd_1: 3 } },
      { id: "del_b", date: "2026-09-04", notes: "", dayAdj: { prd_1: 99 } },
    ],
    orders: [{ id: "o1", deliveryDateId: "del_b", productId: "p", qty: 1 }],
  });
  assert.equal(out.deliveryDates.length, 1, "the pair merges into one record");
  assert.deepEqual(out.deliveryDates[0].dayAdj, { prd_1: 3 },
    "the surviving (first) record's dayAdj wins, matching dayDelta's owner rule");
});

test("groupOrders merges shared groupIds and keeps standalone orders separate", () => {
  const g = groupOrders([
    { id: "a", groupId: "g1" },
    { id: "b" },
    { id: "c", groupId: "g1" },
    { id: "d", groupId: "g2" },
  ]);
  assert.equal(g.length, 3);
  assert.deepEqual(g[0].orders.map((o) => o.id), ["a", "c"], "g1 merged in place of its first member");
  assert.deepEqual(g[1].orders.map((o) => o.id), ["b"]);
  assert.deepEqual(g[2].orders.map((o) => o.id), ["d"]);
  assert.deepEqual(groupOrders([]), []);
  assert.deepEqual(groupOrders(null), []);
});

test("orderCode is the last 6 hex of the id, uppercased", () => {
  assert.equal(orderCode({ id: "ord_ab12cd34ef56" }), "34EF56");
  assert.equal(orderCode({ id: "ord_123456" }), "123456", "short ids still work");
  assert.equal(orderCode({}), "??????", "no id yet → placeholder");
  assert.equal(orderCode(null), "??????");
});

test("orderCode prefers the groupId so a multi-item order shares one code", () => {
  const a = { id: "ord_aaaaaaaaaaaa", groupId: "ordg_112233445566" };
  const b = { id: "ord_bbbbbbbbbbbb", groupId: "ordg_112233445566" };
  assert.equal(orderCode(a), orderCode(b));
  assert.equal(orderCode(a), "445566");
});

test("normalize keeps the TNG QR field on the storefront", () => {
  const out = normalize({ version: 1, settings: { storefront: { tngQr: "https://img/tng.png" } } });
  assert.equal(out.settings.storefront.tngQr, "https://img/tng.png");
});

test("normalize fills the default app-password lock when missing", () => {
  const out = normalize({ version: 1, settings: {} });
  assert.deepEqual(out.settings.lock, defaultState().settings.lock);
  assert.deepEqual(out.settings.lock, { enabled: false, pinHash: "" });
});

test("normalize keeps a stored app-password lock unchanged", () => {
  const lock = { enabled: true, pinHash: HASH_1234 };
  const out = normalize({ version: 1, settings: { lock } });
  assert.deepEqual(out.settings.lock, lock);
});

test("a partial stored lock fills its defaults (never accidentally active)", () => {
  const out = normalize({ version: 1, settings: { lock: { enabled: true } } });
  assert.deepEqual(out.settings.lock, { enabled: true, pinHash: "" });
  assert.equal(lockEnabled(out.settings), false, "no stored PIN → lock not active");
});

test("ensureSupabase fills blank connection boxes from the built-in project (public fields only)", () => {
  const s = { settings: { supabase: { url: "", anonKey: "", email: "", password: "" } } };
  assert.equal(ensureSupabase(s), true);
  assert.equal(s.settings.supabase.url, BUILTIN_SUPABASE.url, "fills this business's own project url");
  assert.equal(s.settings.supabase.anonKey, BUILTIN_SUPABASE.anonKey, "fills this business's own anon key");
  assert.equal(s.settings.supabase.email, "", "never fills the app-login email");
  assert.equal(s.settings.supabase.password, "", "never fills the app-login password");
});

test("ensureSupabase leaves an already-configured phone untouched", () => {
  const sb = { url: "https://mine.supabase.co", anonKey: "my-key", email: "a@b.c", password: "pw" };
  const s = { settings: { supabase: sb } };
  assert.equal(ensureSupabase(s), false);
  assert.equal(s.settings.supabase.url, "https://mine.supabase.co");
  assert.equal(s.settings.supabase.anonKey, "my-key");
  assert.equal(s.settings.supabase.email, "a@b.c");
});

test("ensureSupabase fills only the blank box and keeps the owner's login", () => {
  const s = { settings: { supabase: { url: "https://mine.supabase.co", anonKey: "", email: "a@b.c", password: "pw" } } };
  assert.equal(ensureSupabase(s), true);
  assert.equal(s.settings.supabase.url, "https://mine.supabase.co", "present value is not overwritten");
  assert.equal(s.settings.supabase.anonKey, BUILTIN_SUPABASE.anonKey, "blank key fills from the built-in project");
  assert.equal(s.settings.supabase.email, "a@b.c");
});

test("waNumber strips +/spaces/dashes and adds the +60 country code to locals", () => {
  assert.equal(waNumber("+60 12-345 6789"), "60123456789");
  assert.equal(waNumber("60123456789"), "60123456789");
  assert.equal(waNumber("012-345 6789"), "60123456789");
  assert.equal(waNumber("0123456789"), "60123456789");
  assert.equal(waNumber("+65 8123 4567"), "6581234567", "foreign +65 is kept");
  assert.equal(waNumber(""), "");
  assert.equal(waNumber(null), "");
});

// ---- preloaded pet-treat pouch selling units + product unit dropdown helpers ----

const OLD_UOMS = [
  { id: "uom_g", name: "g", family: "weight", toBase: 1 },
  { id: "uom_kg", name: "kg", family: "weight", toBase: 1000 },
  { id: "uom_ml", name: "ml", family: "volume", toBase: 1 },
  { id: "uom_l", name: "L", family: "volume", toBase: 1000 },
  { id: "uom_pcs", name: "pcs", family: "count", toBase: 1 },
];
const PETTREAT = ["pouch", "pack", "jar", "box", "bag", "set", "piece"];

test("a fresh state seeds the standard pet-treat selling units", () => {
  const names = defaultState().uoms.map((u) => u.name);
  for (const n of PETTREAT) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(defaultState().uoms.length, OLD_UOMS.length + PETTREAT.length);
});

test("normalize adds the pet-treat units to an existing install's unit list", () => {
  const out = normalize({ version: 1, uoms: OLD_UOMS.map((u) => ({ ...u })) });
  const names = out.uoms.map((u) => u.name);
  for (const n of PETTREAT) assert.ok(names.includes(n), `missing ${n}`);
  const pouch = out.uoms.find((u) => u.name === "pouch");
  assert.equal(pouch.family, "count");
  assert.equal(pouch.toBase, 1);
  assert.equal(pouch.id, "uom_pouch", "deterministic id");
});

test("preload is idempotent and never overwrites a same-name unit", () => {
  const mine = { id: "uom_mybox", name: "box", family: "weight", toBase: 250 };
  const first = normalize({ version: 1, uoms: [{ ...OLD_UOMS[0] }, mine] });
  const second = normalize(first);
  const boxes = second.uoms.filter((u) => u.name === "box");
  assert.equal(boxes.length, 1, "the user's own unit is not duplicated");
  assert.equal(boxes[0].id, "uom_mybox", "the user's own unit is untouched");
  assert.equal(boxes[0].family, "weight");
  assert.equal(second.uoms.length, first.uoms.length, "second normalize adds nothing");
});

test("normalize keeps a stored product uomId and links legacy products by name", () => {
  const products = [
    { id: "p1", name: "Sourdough", unit: "loaf", uomId: "uom_loaf", price: 12 },
    { id: "p2", name: "Sandwich", unit: "piece" },
    { id: "p3", name: "Wreath", unit: "whole" },
  ];
  const out = normalize({ version: 1, products });
  assert.equal(out.products[0].uomId, "uom_loaf", "stored uomId survives");
  assert.equal(out.products[1].uomId, "uom_piece", "legacy piece links to the preloaded unit");
  assert.equal(out.products[2].uomId, undefined, "unmatched unit is left alone");
});

function countState() {
  return { uoms: defaultState().uoms };
}

test("productUnitOptions offers every unit, count first, and picks the stored uomId", () => {
  const st = countState();
  const { options, value } = productUnitOptions(st, { id: "p", name: "S", unit: "pouch", uomId: "uom_pouch" });
  assert.equal(value, "uom_pouch");
  assert.equal(options.length, st.uoms.length, "every unit of measure is offered, weight/volume included");
  const countIdx = options.findIndex((o) => o.value === "uom_pouch");
  const weightIdx = options.findIndex((o) => o.value === "uom_g");
  assert.ok(countIdx >= 0 && weightIdx >= 0 && countIdx < weightIdx,
    "count units come before weight/volume units");
  assert.equal(options[weightIdx].label, "g (weight)", "non-count units carry their type");
  assert.equal(options[countIdx].label, "pouch", "count units show a plain name");
});

test("productUnitOptions lists a unit added under the Units screen (owner's report)", () => {
  const st = countState();
  // The Units screen defaults new units to Weight; such a unit must not vanish
  // from the product Unit box.
  st.uoms.push({ id: "uom_tray", name: "tray", family: "weight", toBase: 1 });
  const { options, value } = productUnitOptions(st, null);
  assert.equal(value, "");
  const tray = options.find((o) => o.value === "uom_tray");
  assert.ok(tray, "a weight-type unit the owner added shows in the product Unit box");
  assert.equal(tray.label, "tray (weight)");
  // And it stays the selected choice when reopening an edit of a product using it.
  const reopen = productUnitOptions(st, { id: "p", unit: "tray", uomId: "uom_tray" });
  assert.equal(reopen.value, "uom_tray");
});

test("productUnitOptions name-matches a legacy unit and round-trips an unknown one", () => {
  const st = countState();
  assert.equal(productUnitOptions(st, { id: "p1", unit: "piece" }).value, "uom_piece");
  // A legacy product in a non-count unit now links to its real uom too.
  assert.equal(productUnitOptions(st, { id: "p1g", unit: "g" }).value, "uom_g");
  const unknown = productUnitOptions(st, { id: "p2", unit: "whole" });
  assert.equal(unknown.value, "whole");
  assert.equal(unknown.options[unknown.options.length - 1].value, "whole");
  assert.match(unknown.options[unknown.options.length - 1].label, /not in Units/);
  const blank = productUnitOptions(st, null);
  assert.equal(blank.value, "");
  assert.equal(blank.options.length, st.uoms.length);
});

test("productUsesUnit matches by uomId or legacy unit name", () => {
  const loaf = { id: "uom_loaf", name: "loaf", family: "count", toBase: 1 };
  assert.equal(productUsesUnit({ unit: "loaf", uomId: "uom_loaf" }, loaf), true);
  assert.equal(productUsesUnit({ unit: "loaf" }, loaf), true, "legacy name match");
  assert.equal(productUsesUnit({ unit: "Loaf" }, loaf), true, "case-insensitive");
  assert.equal(productUsesUnit({ unit: "whole", uomId: "uom_other" }, loaf), false);
  assert.equal(productUsesUnit({ unit: "whole" }, loaf), false);
  assert.equal(productUsesUnit(null, loaf), false);
});

test("normalize keeps product-line recipe rows (a set made of another product)", () => {
  const out = normalize({ version: 1, products: [
    { id: "prd_f", name: "Focaccia", unit: "loaf", recipe: [
      { ingredientId: "ing_f", qty: 500, unit: "g" },
    ] },
    { id: "prd_s", name: "Family (4 pcs)", unit: "set", recipe: [
      { productId: "prd_f", qty: 4, unit: "loaf" },
    ] },
  ] });
  const set = out.products.find((p) => p.id === "prd_s");
  assert.deepEqual(set.recipe[0], { productId: "prd_f", qty: 4, unit: "loaf" });
  assert.equal(set.recipe[0].ingredientId, undefined, "product line has no ingredient id");
});

test("normalize backfills the referral scheme and keeps the credits ledger", () => {
  const out = normalize({
    version: 1,
    settings: { referrals: { enabled: true, friendRM: 5 } }, // partial — older phone
    credits: [{ id: "crd1", holder: "60123456789", holderName: "Aisyah", amountRM: 3, role: "reward" }],
  });
  // The partial scheme keeps its set fields and fills the rest from defaults.
  assert.equal(out.settings.referrals.enabled, true);
  assert.equal(out.settings.referrals.friendRM, 5);
  assert.equal(out.settings.referrals.referrerRM, 3, "missing key filled from the default scheme");
  assert.equal(out.settings.referrals.validDays, 90);
  assert.deepEqual(out.credits, [{ id: "crd1", holder: "60123456789", holderName: "Aisyah", amountRM: 3, role: "reward" }]);
});

test("normalize gives a state with no referral settings the full defaults", () => {
  const out = normalize({ version: 1, settings: {} });
  assert.deepEqual(out.settings.referrals, defaultState().settings.referrals);
  assert.deepEqual(out.credits, [], "missing ledger becomes empty, not undefined");
});

test("normalize keeps a set occasions list and backfills a missing one to empty", () => {
  const occ = [{ id: "occ1", from: "2026-09-21", to: "2026-09-29", label: "School holiday" }];
  assert.deepEqual(normalize({ version: 1, occasions: occ }).occasions, occ);
  assert.deepEqual(normalize({ version: 1 }).occasions, [], "missing occasions becomes [], not undefined");
  assert.deepEqual(normalize({ version: 1, occasions: "junk" }).occasions, [], "non-array is discarded");
});
