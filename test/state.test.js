// test/state.test.js — normalize() guarantees for the storefront settings and
// the order status field, plus the unread-orders badge counter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, defaultState, updateOrderBadge, groupOrders, orderCode, waNumber, ensureSupabase, productUnitOptions, productUsesUnit, BUILTIN_SUPABASE } from "../admin/js/state.js";
import { lockEnabled } from "../admin/js/pin.js";
import { planOf } from "../admin/js/production.js";
import { planBackwards } from "../admin/js/bakeday.js";

const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg} (got ${a})`);

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

test("two days sharing ONE id are split apart, and each order follows its own day", () => {
  // ★ v326. Her report, 5 Oct 2026: "the order calander not able to select
  // 7/10/26 … clicking that date, the date turn red, but the SET day's avaibility
  // not changing to 7/10/26." The red mark follows the id the CELL was drawn from;
  // the panel under it is drawn from `byId`, which answers with the FIRST record
  // holding that id. When two days share one id those are two different days, and
  // the second can never be opened — nor deleted, because deleteDate deletes by id.
  //
  // ⚠️ THE ORDER'S OWN `deliveryDate` IS WHAT TELLS THE TWO DAYS APART. The id is
  // the same for both, so it cannot.
  const book = {
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-10-05", notes: "" },
      { id: "del_a", date: "2026-10-07", notes: "" },
    ],
    orders: [
      { id: "o1", deliveryDateId: "del_a", deliveryDate: "2026-10-05", productId: "p", qty: 2 },
      { id: "o2", deliveryDateId: "del_a", deliveryDate: "2026-10-07", productId: "p", qty: 3 },
    ],
  };
  const out = normalize(book);
  assert.equal(out.deliveryDates.length, 2, "both days survive — nothing is deleted");
  assert.equal(out.deliveryDates[0].id, "del_a", "the first record keeps the id byId already answers with");
  const second = out.deliveryDates[1];
  assert.equal(second.date, "2026-10-07", "the second day is still 7 Oct");
  assert.notEqual(second.id, "del_a", "and it has an id of its own");
  assert.equal(out.deliveryDates.filter((d) => d.id === "del_a").length, 1,
    "so no two days share an id any more");
  // ⚠️ AND IT IS DERIVED, NOT ROLLED FRESH — both phones must choose the same id,
  // or the next pull brings the pair back. Same input, same answer, every time.
  const again = normalize(book);
  assert.equal(again.deliveryDates[1].id, second.id, "a second load picks the same id");
  assert.equal(normalize({ version: 1, deliveryDates: out.deliveryDates, orders: out.orders })
    .deliveryDates[1].id, second.id, "and re-loading an already-repaired book changes nothing");
  assert.equal(out.orders.find((o) => o.id === "o1").deliveryDateId, "del_a", "5 Oct's order stays on 5 Oct");
  assert.equal(out.orders.find((o) => o.id === "o2").deliveryDateId, second.id, "7 Oct's order follows its own day");
  assert.deepEqual(out.orders.map((o) => o.qty), [2, 3], "no order lost");
});

test("an order with no date snapshot stays on the id, which is where it reads today", () => {
  // The snapshot is the only thing that can say which of the two days an order
  // belongs to. Without one, moving it would be a guess — and a guess here moves
  // somebody's order. It stays where `byId` already resolves it.
  const out = normalize({
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-10-05", notes: "" },
      { id: "del_a", date: "2026-10-07", notes: "" },
    ],
    orders: [{ id: "o1", deliveryDateId: "del_a", productId: "p", qty: 1 }],
  });
  assert.equal(out.orders[0].deliveryDateId, "del_a", "left alone, where it already read");
});

test("loading a healthy book of days changes nothing at all", () => {
  // The repair must be invisible when there is nothing wrong — the same rule
  // consolidateDeliveryDates follows. Two days, two ids, no edits.
  const before = {
    version: 1,
    deliveryDates: [
      { id: "del_a", date: "2026-10-05", notes: "" },
      { id: "del_b", date: "2026-10-07", notes: "" },
    ],
    orders: [{ id: "o1", deliveryDateId: "del_b", deliveryDate: "2026-10-07", productId: "p", qty: 1 }],
  };
  const out = normalize(before);
  assert.deepEqual(out.deliveryDates, before.deliveryDates, "the days are the same objects, untouched");
  assert.deepEqual(out.orders, [{ ...before.orders[0], status: "new" }], "and so is the order");
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
const PLANNING = ["min", "hr", "cm", "m"];

test("a fresh state seeds the standard pet-treat selling units", () => {
  const names = defaultState().uoms.map((u) => u.name);
  for (const n of PETTREAT) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of PLANNING) assert.ok(names.includes(n), `missing time/length unit ${n}`);
  assert.equal(defaultState().uoms.length, OLD_UOMS.length + PETTREAT.length + PLANNING.length);
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

test("normalize adds the time/length units to an existing install, idempotently", () => {
  const want = { min: ["time", 1], hr: ["time", 60], cm: ["length", 1], m: ["length", 100] };
  const out = normalize({ version: 1, uoms: OLD_UOMS.map((u) => ({ ...u })) });
  const byName = new Map(out.uoms.map((u) => [u.name.toLowerCase(), u]));
  for (const [n, [family, toBase]] of Object.entries(want)) {
    const u = byName.get(n);
    assert.ok(u, `missing time/length unit ${n}`);
    assert.equal(u.family, family, `${n} belongs to the ${family} family`);
    assert.equal(u.toBase, toBase, `${n} keeps its relationship`);
    assert.equal(u.id, `uom_${n}`, "deterministic id");
  }
  const again = normalize(out);
  assert.equal(again.uoms.length, out.uoms.length, "second normalize adds nothing");
});

test("preloaded time/length units never overwrite a user's same-name unit", () => {
  const mine = { id: "uom_myhr", name: "hr", family: "count", toBase: 1 };
  const out = normalize({ version: 1, uoms: [mine] });
  const hrs = out.uoms.filter((u) => u.name.toLowerCase() === "hr");
  assert.equal(hrs.length, 1, "the user's own unit is not duplicated");
  assert.equal(hrs[0].id, "uom_myhr", "the user's own unit is untouched");
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

test("normalize keeps saved customer profiles and backfills a missing/non-array list to empty", () => {
  const prof = [{ id: "cus_abc", key: "60123456789", name: "Aunty Bee", whatsapp: "60123456789",
    dogName: "Coco", likes: "banana", createdAt: "2026-09-08T00:00:00.000Z" }];
  assert.deepEqual(normalize({ version: 1, customers: prof }).customers, prof);
  assert.deepEqual(normalize({ version: 1 }).customers, [], "missing customers becomes [], not undefined");
  assert.deepEqual(normalize({ version: 1, customers: "junk" }).customers, [], "non-array is discarded");
  assert.ok(Array.isArray(defaultState().customers), "a fresh state starts with an empty customers list");
});

// v145 re-cut the production plan around the bake day she corrected on 22 Sep
// 2026, and five fields changed what they are asked. The plan is stored per
// phone and an older phone keeps its own copy wholesale, so this normalize-time
// migration is the only thing standing between her and an app that opens showing
// a chain contradicting the one she gave. The block below is her own saved plan,
// copied off her phone exactly — the mix reading 6 minutes and the wash 20 are
// hers, typed before any of this existed.
const HER_PLAN_V144 = {
  people: 2, hours: 5, target: 24, pans: 12, trays: 12, mixerPans: 28,
  ovenPans: 6, ovenMin: 15, ovenShelves: 2, washMin6: 20, topMin6: 8,
  swapMin6: 4, mixMin: 6, scaleMin6: 0, coolMin6: 12,
};
const herPlan = (extra = {}) =>
  normalize({ version: 1, settings: { production: { ...HER_PLAN_V144, ...extra } } }).settings.production;

test("the plan her phone already held is carried onto the corrected bake day", () => {
  const p = herPlan();

  assert.equal(p.mixMin, 20, "the mix is the whole mix now, not the 6 minutes she had put against loading it");
  assert.equal(p.mixerPans, 6, "one tub makes one oven load, so the mixer's 28-pan bowl is retired");
  assert.equal(p.scaleMin6, 15, "the oiling and the weighing-out are one job at the 15 she gave for them");
  assert.equal(p.topMin6, 6, "her minute a pan, without the topping the 8 included");
  assert.equal(p.swapMin6, 2, "out and in are both halves and the turn counts both");
  assert.equal(p.prooferPans, 12, "the trays were the chiller's count, and they are the proofer's pans now");
  assert.ok(!("trays" in p) && !("washMin6" in p), "the two retired keys do not linger on the phone");
  assert.equal(p.planRev, 145, "and it is marked as done, so it never runs a second time");
});

test("the migration touches nothing that did not change what it is asked", () => {
  const p = herPlan();
  assert.equal(p.people, 2, "her two pairs of hands");
  assert.equal(p.hours, 5);
  assert.equal(p.target, 24, "the day she is planning");
  assert.equal(p.pans, 12);
  assert.equal(p.ovenPans, 6);
  assert.equal(p.ovenMin, 15, "one turn of the oven, which is what it always meant");
  assert.equal(p.ovenShelves, 2);
  assert.equal(p.coolMin6, 12, "her twelve minutes of cutting and packing survive untouched — she measured them");
  assert.equal(p.foldRests, 4, "and every new field arrives at the default the release set it to");
  assert.equal(p.readyAtMin, 480);
  assert.equal(p.tolMin, 5);
});

test("and the chain it draws for her is the chain she gave", () => {
  // The release's whole claim, checked on her real saved numbers rather than on
  // the defaults: 254 minutes from the mix to the pans coming out, 239 of them
  // before they go in, and 46 minutes of her hands on the day itself.
  const r = planBackwards(planOf(herPlan()));
  near(r.spanMin, 254, "her own total");
  near(r.readyAtMin - r.mixStartMin, 239, "and her own figure for reaching the oven");
  near(r.steps.filter((s) => !s.beyond).reduce((n, s) => n + s.hands, 0), 46,
    "her 46 minutes a batch, now that the oiling and the weighing-out are counted once");
  near(r.steps.find((s) => s.key === "cool").hands, 12,
    "with her own 12 minutes of cutting sitting past the end of the day, exactly as she timed it");

  // She plans with two pairs of hands, so 23 minutes a batch against the
  // proofer's 40.5: the proofer is the wall on her own screen, which is the
  // finding she reached herself. Alone, the 46 leaves her hands the wall — the
  // two answers differ only by the `people` field she set, not by the model.
  assert.equal(r.rhythm.binds, "proofer", "on her two pairs of hands, the cabinet is the wall");
  assert.equal(planBackwards(planOf(herPlan({ people: 1 }))).rhythm.binds, "hands",
    "and on one pair of hands it is her own hands, out of the same fields");
});

test("a phone already on the new plan is left alone, and a number she types back sticks", () => {
  const once = herPlan();
  const twice = normalize({ version: 1, settings: { production: once } }).settings.production;
  assert.deepEqual(twice, once, "running it again changes nothing");

  // The point of marking it done: after it has run, a value she retypes is hers
  // and is never overwritten again. She can put the mixer's 28 back in one tap.
  const retyped = herPlan({ planRev: 145, mixerPans: 28, mixMin: 6 });
  assert.equal(retyped.mixerPans, 28);
  assert.equal(retyped.mixMin, 6);
});

test("a fresh install is seeded, not migrated, and a state with no plan gets the whole one", () => {
  assert.deepEqual(normalize({ version: 1, settings: {} }).settings.production,
    defaultState().settings.production,
    "nothing to correct, so the defaults stand unchanged");
});

test("a proofer count she had already typed wins over the retired trays", () => {
  assert.equal(herPlan({ trays: 18, prooferPans: 0 }).prooferPans, 18,
    "trays she had counted carry over to the cabinet that holds them");
  assert.equal(herPlan({ trays: 18, prooferPans: 24 }).prooferPans, 24,
    "but a proofer count she has set herself is never overwritten by the old one");
});

// ── v200: the settings that ride the cloud now have a shape at load ─────────
//
// `categories`, `payMethods` and `mailingAddress` are the fields she edits on the
// Money screen; `personNames`/`personCalls` are the planner's people. All five now
// travel in the settings row, so a value that arrived from the other phone — or
// from a half-written row — has to be the same SHAPE the readers expect before
// anything draws with it.

test("normalize gives the chart and the ways to pay an array, never a stray object", () => {
  const out = normalize({ version: 1, settings: { categories: { a: 1 }, payMethods: "Cash" } });
  assert.deepEqual(out.settings.categories, [],
    "a chart that is not a list is dropped, so `categoriesOf` falls back to the built-in names");
  assert.deepEqual(out.settings.payMethods, [],
    "and so is a methods list that is not one");
});

test("normalize gives the mailing address a string, and a cleared one stays cleared", () => {
  assert.equal(normalize({ version: 1, settings: {} }).settings.mailingAddress, "",
    "a phone that has never typed an address holds an empty one, not undefined");
  assert.equal(normalize({ version: 1, settings: { mailingAddress: "  12 Jalan Bunga Raya  " } })
    .settings.mailingAddress, "  12 Jalan Bunga Raya  ",
    "what she typed is kept exactly, spaces and all");
  assert.equal(normalize({ version: 1, settings: { mailingAddress: 42 } }).settings.mailingAddress, "",
    "a number where an address belongs becomes an empty one rather than printing as 42");
});

test("normalize gives the planner's people a plain object, never something that would crash a write", () => {
  const out = normalize({ version: 1, settings: { personNames: "Jien", personCalls: [true] } });
  assert.deepEqual(out.settings.personNames, {},
    "a names map that is not an object is dropped — `names[who] = typed` on a string throws");
  assert.deepEqual(out.settings.personCalls, {},
    "and so is a call list that is not one; an array is not a map of people");
});

test("normalize keeps the planner's people exactly as they arrived", () => {
  const out = normalize({ version: 1, settings: { personNames: { 1: "Jien", 2: "" }, personCalls: { 2: false, 3: true } } });
  assert.deepEqual(out.settings.personNames, { 1: "Jien", 2: "" },
    "the names she typed survive a reload, including a name she has emptied but not deleted");
  assert.deepEqual(out.settings.personCalls, { 2: false, 3: true },
    "and a tick that is OFF is kept as an answer, not thrown away as falsy");
});
