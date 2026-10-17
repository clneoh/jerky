// test/sync.test.js — unit tests for the shared-data sync engine.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../admin/js/sync.js";
import { STOCK_PRODUCTION, defaultState } from "../admin/js/state.js";
import * as stateMod from "../admin/js/state.js";

const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;
const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

// ── test helpers ──────────────────────────────────────────────────────────

function baseState() {
  return {
    version: 1,
    settings: {
      defaultCapacity: 12,
      deliveryDays: [1, 3, 5],
      cutoff: "18:00",
      currency: "RM",
      supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" },
      cloud: { enabled: false },
    },
    ingredients: [],
    products: [],
    deliveryDates: [],
    orders: [],
    purchaseOrders: [],
    credits: [],
    occasions: [],
  };
}

function cloudOn(state, url = "https://x.supabase.co", anonKey = "anon") {
  state.settings.cloud.enabled = true;
  state.settings.supabase.url = url;
  state.settings.supabase.anonKey = anonKey;
  return state;
}

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return {
    store,
    restore() {
      if (realLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = realLocalStorage;
    },
  };
}

function installFetch(handler) {
  globalThis.fetch = handler;
  return () => { globalThis.fetch = realFetch; };
}

function seedToken(store, token = "tok_abc") {
  store.set("bakeadmin.supabase", JSON.stringify({
    access_token: token,
    expires_at: Date.now() + 3600000,
  }));
}

function seedJournal(store, { pending = {}, snapshot = {}, meta = {}, lastPullAt = null } = {}) {
  store.set("bakeadmin.sync", JSON.stringify({ version: 1, pending, snapshot, meta, lastPullAt }));
}

// A cloud row as the REST API returns it: `data` is a JSON string.
function cloudRow(kind, id, payload, updated_at, deleted = false) {
  return { kind, id, data: deleted ? null : JSON.stringify(payload), _deleted: deleted, updated_at };
}

// ── computeRecords ────────────────────────────────────────────────────────

test("computeRecords: arrays become rows, settings becomes one default row", () => {
  const st = baseState();
  st.products = [{ id: "p1", name: "Focaccia" }];
  st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
  st.ingredients = [{ id: "i1", name: "Flour" }];
  st.deliveryDates = [{ id: "d1", date: "2026-09-07" }];
  st.purchaseOrders = [{ id: "po1", total: 5 }];
  st.settings.lock = { enabled: true, pinHash: HASH_1234 }; // device-local app password

  const rows = sync.computeRecords(st);
  const kinds = rows.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ["deliveryDates", "ingredients", "orders", "products", "purchaseOrders", "settings"]);

  const settings = rows.find((r) => r.kind === "settings");
  assert.equal(settings.id, "default");
  // Only the business keys + the weekly checklist sync — connection config AND
  // the app password stay per-device.
  assert.deepEqual(settings.data, {
    defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
    weekCheck: { week: "", done: {} },
    referrals: {},
    production: {},   // the Production line's own settings ride with the rest
  });
});

test("computeRecords: credits rows ride the sync, settings payload carries the referral scheme", () => {
  const st = baseState();
  st.settings.referrals = { enabled: true, friendRM: 5, referrerRM: 3, validDays: 60 };
  st.credits = [
    { id: "crd1", holder: "60123456789", holderName: "Aisyah", amountRM: 3, role: "reward",
      earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-11-30", usedAt: null, orderCode: "ABCDEF", note: "" },
  ];

  const rows = sync.computeRecords(st);
  const credits = rows.filter((r) => r.kind === "credits");
  assert.equal(credits.length, 1);
  assert.equal(credits[0].id, "crd1");
  assert.deepEqual(credits[0].data, {
    id: "crd1", holder: "60123456789", holderName: "Aisyah", amountRM: 3, role: "reward",
    earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-11-30", usedAt: null, orderCode: "ABCDEF", note: "",
  });

  const settings = rows.find((r) => r.kind === "settings");
  assert.deepEqual(settings.data.referrals, { enabled: true, friendRM: 5, referrerRM: 3, validDays: 60 });
});

test("mergeRows: credit rows merge and a tombstone deletes them", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    seedJournal(store);
    const add = sync.mergeRows(st, [cloudRow("credits", "crd1",
      { id: "crd1", holder: "60123456789", holderName: "Aisyah", amountRM: 3, role: "reward",
        earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "", usedAt: null, orderCode: "ABCDEF", note: "" },
      "2026-09-01T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.credits.length, 1);
    assert.equal(st.credits[0].holder, "60123456789");

    // Cloud tombstone (data:null, _deleted:true) removes the local credit.
    const del = sync.mergeRows(st, [cloudRow("credits", "crd1", null, "2026-09-02T00:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.credits.length, 0);
  } finally { restore(); }
});

test("computeRecords: occasion rows ride the sync", () => {
  const st = baseState();
  st.occasions = [
    { id: "occ1", from: "2026-09-14", to: "2026-09-22", label: "School holiday" },
    { id: "occ2", from: "2026-09-28", to: "2026-09-28", label: "CNY" },
  ];

  const rows = sync.computeRecords(st);
  const occ = rows.filter((r) => r.kind === "occasions");
  assert.equal(occ.length, 2);
  assert.equal(occ[0].id, "occ1");
  assert.deepEqual(occ[0].data, { id: "occ1", from: "2026-09-14", to: "2026-09-22", label: "School holiday" });
  assert.deepEqual(occ[1].data, { id: "occ2", from: "2026-09-28", to: "2026-09-28", label: "CNY" });
});

test("computeRecords: supplier rows ride the sync", () => {
  const st = baseState();
  st.suppliers = [
    { id: "sup1", name: "Mydin", whatsapp: "0123456789" },
    { id: "sup2", name: "Yen Grocer", whatsapp: "0198765432" },
  ];

  const rows = sync.computeRecords(st);
  const sups = rows.filter((r) => r.kind === "suppliers");
  assert.equal(sups.length, 2);
  assert.deepEqual(sups[0].data, { id: "sup1", name: "Mydin", whatsapp: "0123456789" });
  assert.deepEqual(sups[1].data, { id: "sup2", name: "Yen Grocer", whatsapp: "0198765432" });
});

// The carriers a parcel goes with (v226). A list left out of LISTS is silently
// device-local, which is exactly the bug this asserts against: a carrier added on
// her phone has to exist on the other, or the order screen offers a different
// picker on every phone she owns.
test("computeRecords: parcel courier rows ride the sync", () => {
  const st = baseState();
  st.parcelCouriers = [
    { id: "pc_jt", name: "J&T Express" },
    { id: "pc_ninja", name: "Ninja Van", note: "counter at Prangin Mall" },
  ];

  const rows = sync.computeRecords(st);
  const carriers = rows.filter((r) => r.kind === "parcelCouriers");
  assert.equal(carriers.length, 2, "both carriers reach the cloud");
  assert.deepEqual(carriers[0].data, { id: "pc_jt", name: "J&T Express" },
    "the row goes whole — no field whitelist to fall out of date");
  assert.deepEqual(carriers[1].data, { id: "pc_ninja", name: "Ninja Van", note: "counter at Prangin Mall" });
});

// The vans a Place is served by (v419). ⚠️ THE SAME TRAP THE CARRIER ROWS ABOVE GUARD AGAINST: a
// list left out of `LISTS` is silently device-local — and the fault is nastier here than for a
// carrier, because a Place carries a route's ID and not its name, so a route that never synced
// leaves the other phone holding an id that resolves to nothing.
test("computeRecords: delivery route rows ride the sync", () => {
  const st = baseState();
  st.deliveryRoutes = [
    { id: "rt_a", name: "Route A", sort: 0 },
    { id: "rt_b", name: "Route B", sort: 1 },
  ];

  const rows = sync.computeRecords(st);
  const routes = rows.filter((r) => r.kind === "deliveryRoutes");
  assert.equal(routes.length, 2, "both routes reach the cloud");
  assert.deepEqual(routes[0].data, { id: "rt_a", name: "Route A", sort: 0 },
    "the row goes whole — no field whitelist to fall out of date");
  assert.deepEqual(routes[1].data, { id: "rt_b", name: "Route B", sort: 1 });
});

test("mergeRows: a carrier added on one phone arrives on the phone that lacked it", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.parcelCouriers = []; // this phone has no carriers yet
    seedJournal(store);

    const add = sync.mergeRows(st, [cloudRow("parcelCouriers", "pc_jt",
      { id: "pc_jt", name: "J&T Express" }, "2026-09-28T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.deepEqual(st.parcelCouriers, [{ id: "pc_jt", name: "J&T Express" }]);

    // Her own rename wins over the stale copy the other phone still holds.
    assert.equal(sync.mergeRows(st, [cloudRow("parcelCouriers", "pc_jt",
      { id: "pc_jt", name: "J&T old" }, "2026-09-27T00:00:00.000Z")]).changed, false);
    assert.equal(st.parcelCouriers[0].name, "J&T Express");

    // And a carrier deleted on the other phone goes from this one too. Orders that
    // already recorded it keep the frozen name, so nothing a customer was told moves.
    const del = sync.mergeRows(st, [cloudRow("parcelCouriers", "pc_jt", null, "2026-09-29T00:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.parcelCouriers.length, 0);
  } finally { restore(); }
});

test("mergeRows: a shop added on one phone appears on the phone that had none", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.suppliers = []; // this phone has no suppliers at all — the reported bug
    seedJournal(store);

    const add = sync.mergeRows(st, [cloudRow("suppliers", "sup1",
      { id: "sup1", name: "Mydin", whatsapp: "0123456789" }, "2026-09-05T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.suppliers.length, 1);
    assert.equal(st.suppliers[0].name, "Mydin");

    // An older/stale copy of the same shop can't overwrite the newer one.
    const stale = sync.mergeRows(st, [cloudRow("suppliers", "sup1",
      { id: "sup1", name: "Mydin old", whatsapp: "" }, "2026-09-01T00:00:00.000Z")]);
    assert.equal(stale.changed, false);
    assert.equal(st.suppliers[0].name, "Mydin");

    // A cloud tombstone removes the shop when it's deleted on the other phone.
    const del = sync.mergeRows(st, [cloudRow("suppliers", "sup1", null, "2026-09-06T00:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.suppliers.length, 0);
  } finally { restore(); }
});

test("mergeRows: a supplier newly saved on this phone is queued to be pushed", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.suppliers = [{ id: "sup1", name: "Mydin", whatsapp: "0123456789" }];
    seedJournal(store);
    const r = sync.markDirty(st, "2026-09-06T00:00:00.000Z");
    assert.equal(r.pending["suppliers:sup1"]._deleted, false);
    assert.equal(r.pending["suppliers:sup1"].data.name, "Mydin");
  } finally { restore(); }
});

test("computeRecords: unit rows ride the sync", () => {
  const st = baseState();
  st.uoms = [
    { id: "uom_cup", name: "cup", family: "count", toBase: 1 },
    { id: "uom_kg", name: "kg", family: "weight", toBase: 1000 },
  ];

  const rows = sync.computeRecords(st);
  const units = rows.filter((r) => r.kind === "uoms");
  assert.equal(units.length, 2);
  assert.deepEqual(units[0].data, { id: "uom_cup", name: "cup", family: "count", toBase: 1 });
});

test("mergeRows: a unit added on one phone arrives on the phone that lacks it", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.uoms = [];
    seedJournal(store);

    const add = sync.mergeRows(st, [cloudRow("uoms", "uom_cup",
      { id: "uom_cup", name: "cup", family: "count", toBase: 1 }, "2026-09-06T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.uoms.length, 1);
    assert.equal(st.uoms[0].name, "cup");
    assert.equal(st.uoms[0].toBase, 1);

    // And once that phone has a unit of its own, it is queued to push back.
    seedJournal(store);
    const r = sync.markDirty(st, "2026-09-06T00:01:00.000Z");
    assert.equal(r.pending["uoms:uom_cup"].data.name, "cup", "local unit is sent to the other phone");
  } finally { restore(); }
});

test("mergeRows: occasion rows merge and a tombstone deletes them", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    seedJournal(store);
    const add = sync.mergeRows(st, [cloudRow("occasions", "occ1",
      { id: "occ1", from: "2026-09-14", to: "2026-09-22", label: "School holiday" },
      "2026-09-01T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.occasions.length, 1);
    assert.equal(st.occasions[0].label, "School holiday");

    // Cloud tombstone removes the local occasion mark.
    const del = sync.mergeRows(st, [cloudRow("occasions", "occ1", null, "2026-09-02T00:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.occasions.length, 0);
  } finally { restore(); }
});

// ── markDirty ─────────────────────────────────────────────────────────────

test("markDirty: fresh journal stamps every record as pending", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.products = [{ id: "p1", name: "Focaccia" }];
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];

    const r1 = sync.markDirty(st, "2026-01-01T00:00:00.000Z");
    assert.equal(r1.changed, true);
    assert.deepEqual(Object.keys(r1.pending).sort(), ["orders:o1", "products:p1", "settings:default"]);
    assert.equal(r1.pending["orders:o1"]._deleted, false);
    assert.equal(r1.pending["orders:o1"].data.qty, 2);
    assert.equal(r1.pending["orders:o1"].updated_at, "2026-01-01T00:00:00.000Z");

    // unchanged re-run adds nothing
    const r2 = sync.markDirty(st, "2026-01-01T00:00:05.000Z");
    assert.equal(r2.changed, false);
    assert.equal(JSON.stringify(r2.pending), JSON.stringify(r1.pending));
  } finally { restore(); }
});

test("markDirty: an edited record re-stamps only itself", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    st.orders[0].qty = 5;
    const r = sync.markDirty(st, "2026-01-02T00:00:00.000Z");
    assert.equal(r.changed, true);
    assert.equal(r.pending["orders:o1"].updated_at, "2026-01-02T00:00:00.000Z");
    assert.equal(r.pending["orders:o1"].data.qty, 5);
    assert.equal(r.pending["settings:default"].updated_at, "2026-01-01T00:00:00.000Z");
  } finally { restore(); }
});

test("markDirty: a removed record produces a tombstone", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.products = [{ id: "p1", name: "Focaccia" }];
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    st.products = [];
    const r = sync.markDirty(st, "2026-01-03T00:00:00.000Z");
    assert.equal(r.changed, true);
    assert.deepEqual(r.pending["products:p1"], {
      kind: "products", id: "p1", updated_at: "2026-01-03T00:00:00.000Z", data: null, _deleted: true,
    });
    // snapshot no longer tracks it, so the next run doesn't re-tombstone
    const r2 = sync.markDirty(st, "2026-01-04T00:00:00.000Z");
    assert.equal(r2.changed, false);
  } finally { restore(); }
});

test("markDirty: changing only the app-password lock never dirties the settings row", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    const first = sync.markDirty(st, "2026-01-01T00:00:00.000Z"); // fresh journal stamps everything
    assert.equal(first.changed, true);

    st.settings.lock = { enabled: true, pinHash: HASH_1234 };
    const r = sync.markDirty(st, "2026-01-02T00:00:00.000Z");
    assert.equal(r.changed, false, "the lock is device-local — nothing new to push");
    assert.equal(r.pending["settings:default"].updated_at, "2026-01-01T00:00:00.000Z", "settings row not re-stamped by a lock edit");
  } finally { restore(); }
});

// ── mergeRows ─────────────────────────────────────────────────────────────

test("mergeRows: newer cloud row replaces local; older is ignored", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.orders = [{ id: "o1", productId: "p1", qty: 2, customerName: "local" }];
    seedJournal(store, { meta: { "orders:o1": "2026-01-01T00:00:00.000Z" } });

    // newer cloud row wins
    const r1 = sync.mergeRows(st, [cloudRow("orders", "o1", { id: "o1", productId: "p1", qty: 9 }, "2026-02-01T00:00:00.000Z")]);
    assert.equal(r1.changed, true);
    assert.equal(st.orders[0].qty, 9);

    // older cloud row loses
    const r2 = sync.mergeRows(st, [cloudRow("orders", "o1", { id: "o1", qty: 1 }, "2026-01-01T12:00:00.000Z")]);
    assert.equal(r2.changed, false);
    assert.equal(st.orders[0].qty, 9);
  } finally { restore(); }
});

test("mergeRows: pending local edit newer than cloud keeps the local edit", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.orders = [{ id: "o1", productId: "p1", qty: 7 }];
    seedJournal(store, {
      pending: { "orders:o1": { kind: "orders", id: "o1", updated_at: "2026-03-01T00:00:00.000Z", data: st.orders[0], _deleted: false } },
      meta: { "orders:o1": "2026-02-01T00:00:00.000Z" },
    });

    const r = sync.mergeRows(st, [cloudRow("orders", "o1", { id: "o1", qty: 1 }, "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, false);
    assert.equal(st.orders[0].qty, 7, "local record untouched");
    const b = JSON.parse(store.get("bakeadmin.sync"));
    assert.ok(b.pending["orders:o1"], "pending edit survives to be flushed");
  } finally { restore(); }
});

test("mergeRows: pending local edit older than cloud loses to the cloud row", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.orders = [{ id: "o1", productId: "p1", qty: 7 }];
    seedJournal(store, {
      pending: { "orders:o1": { kind: "orders", id: "o1", updated_at: "2026-01-01T00:00:00.000Z", data: st.orders[0], _deleted: false } },
      meta: { "orders:o1": "2026-01-01T00:00:00.000Z" },
    });

    const r = sync.mergeRows(st, [cloudRow("orders", "o1", { id: "o1", qty: 1 }, "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.orders[0].qty, 1, "cloud's newer edit replaces the stale pending");
    const b = JSON.parse(store.get("bakeadmin.sync"));
    assert.equal(b.pending["orders:o1"], undefined, "stale pending discarded, not pushed");
  } finally { restore(); }
});

test("mergeRows: a tombstone removes a local record, unless a newer pending edit resurrects it", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.products = [{ id: "p1", name: "Focaccia" }];
    seedJournal(store, { meta: { "products:p1": "2026-01-01T00:00:00.000Z" } });

    // tombstone newer than local → record removed
    const r1 = sync.mergeRows(st, [cloudRow("products", "p1", null, "2026-02-01T00:00:00.000Z", true)]);
    assert.equal(r1.changed, true);
    assert.equal(st.products.length, 0);

    // tombstone ignored when a pending local edit is newer
    st.products = [{ id: "p2", name: "Sandwich" }];
    seedJournal(store, {
      pending: { "products:p2": { kind: "products", id: "p2", updated_at: "2026-03-01T00:00:00.000Z", data: st.products[0], _deleted: false } },
      meta: { "products:p2": "2026-02-01T00:00:00.000Z" },
    });
    const r2 = sync.mergeRows(st, [cloudRow("products", "p2", null, "2026-02-01T00:00:00.000Z", true)]);
    assert.equal(r2.changed, false);
    assert.equal(st.products.length, 1, "kept alive by the newer pending edit");
    const b = JSON.parse(store.get("bakeadmin.sync"));
    assert.ok(b.pending["products:p2"], "pending edit still queued to resurrect");
  } finally { restore(); }
});

test("mergeRows: a cloud record that isn't local is added", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    seedJournal(store);
    const r = sync.mergeRows(st, [cloudRow("orders", "o_new", { id: "o_new", productId: "p1", qty: 3 }, "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.orders.length, 1);
    assert.equal(st.orders[0].qty, 3);
  } finally { restore(); }
});

test("mergeRows: settings sync business keys but preserve local supabase/cloud config", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.supabase = { enabled: true, url: "https://local.supabase.co", anonKey: "local-anon", email: "me@x", password: "pw" };
    st.settings.cloud = { enabled: true };
    st.settings.lock = { enabled: true, pinHash: HASH_1234 };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 24, deliveryDays: [1, 2, 3], cutoff: "20:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.settings.defaultCapacity, 24);
    assert.deepEqual(st.settings.deliveryDays, [1, 2, 3]);
    assert.equal(st.settings.cutoff, "20:00");
    // per-device config untouched
    assert.deepEqual(st.settings.supabase, { enabled: true, url: "https://local.supabase.co", anonKey: "local-anon", email: "me@x", password: "pw" });
    assert.deepEqual(st.settings.cloud, { enabled: true });
    assert.deepEqual(st.settings.lock, { enabled: true, pinHash: HASH_1234 }, "app password never clobbered by a cloud merge");
  } finally { restore(); }
});

test("mergeRows: settings weekCheck ticks union across devices; never clobbered wholesale", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.lock = { enabled: true, pinHash: HASH_1234 };
    st.settings.weekCheck = { week: "2026-09-06", done: { orders: true, social: true } };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    // Another phone ticked tasks in the SAME week — the ticks must union, and
    // the app password must survive the merge untouched.
    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        weekCheck: { week: "2026-09-06", done: { orders: true, stock: true, menu: true } },
      },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.deepEqual(st.settings.weekCheck, {
      week: "2026-09-06",
      done: { orders: true, social: true, stock: true, menu: true },
    }, "same-week ticks union (nothing lost)");
    assert.deepEqual(st.settings.lock, { enabled: true, pinHash: HASH_1234 }, "lock not clobbered");

    // A cloud checklist from a LATER week replaces the stale local one whole.
    st.settings.weekCheck = { week: "2026-09-06", done: { orders: true } };
    seedJournal(store, { meta: { "settings:default": "2026-02-01T00:00:00.000Z" } });
    const r2 = sync.mergeRows(st, [cloudRow("settings", "default",
      {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        weekCheck: { week: "2026-09-13", done: { dates: true } },
      },
      "2026-02-02T00:00:00.000Z")]);
    assert.equal(r2.changed, true);
    assert.deepEqual(st.settings.weekCheck, { week: "2026-09-13", done: { dates: true } },
      "a later week replaces a stale one instead of merging into it");
  } finally { restore(); }
});

// ── postage (nationwide posting): private phone-to-phone sync ─────────────

test("recordPayload: the postage fee syncs only once the owner has set it (postageSet)", () => {
  const st = baseState();
  st.settings.storefront = { whatsapp: "60123", name: "Munchies", postageRM: 8, postageSet: false };

  let rows = sync.computeRecords(st);
  let settings = rows.find((r) => r.kind === "settings");
  assert.equal("postageRM" in settings.data, false,
    "a phone still at the default must not emit 8 and clobber the value set on another phone");

  st.settings.storefront.postageRM = 6;
  st.settings.storefront.postageSet = true;
  rows = sync.computeRecords(st);
  settings = rows.find((r) => r.kind === "settings");
  assert.equal(settings.data.postageRM, 6, "once set, the fee rides the private settings row");
});

test("mergeRows: cloud postage folds into storefront.postageRM and keeps local storefront fields", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.storefront = { whatsapp: "60123123", name: "Munchies Furkidz", tagline: "T", postageRM: 8, postageSet: false };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM", postageRM: 6 },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.settings.storefront.postageRM, 6, "cloud fee adopted");
    assert.equal(st.settings.storefront.postageSet, true, "phone now knows a real value and will carry it");
    assert.equal(st.settings.storefront.name, "Munchies Furkidz", "local storefront branding untouched by the merge");
    assert.equal(st.settings.storefront.whatsapp, "60123123", "local storefront whatsapp untouched");
    assert.equal("postageRM" in st.settings, false, "no stray top-level settings.postageRM");
    const b = JSON.parse(store.get("bakeadmin.sync"));
    assert.ok(!b.pending["settings:default"], "adopting the fee does not queue a push");
  } finally { restore(); }
});

test("mergeRows: a phone still at the default cannot overwrite the other phone's set postage", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.storefront = { whatsapp: "1", name: "Munchies", postageRM: 6, postageSet: true };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    // The OTHER phone never set postage, so its newer row carries no postageRM.
    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.settings.storefront.postageRM, 6, "local set value survives a postage-less cloud row");
    assert.equal(st.settings.storefront.postageSet, true, "flag still true");
  } finally { restore(); }
});

test("mergeRows: postage is last-set-wins between phones", () => {
  const { store, restore } = installStorage();
  try {
    // The owner sets RM6 on phone A and it syncs up.
    const a = baseState();
    a.settings.storefront = { postageRM: 6, postageSet: true };
    const aRow = cloudRow("settings", "default",
      sync.computeRecords(a).find((r) => r.kind === "settings").data, "2026-02-01T00:00:00.000Z");

    // Phone B (still at the default 8) pulls A's row and adopts 6.
    const b = baseState();
    b.settings.storefront = { postageRM: 8, postageSet: false };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(b, [aRow]);
    assert.equal(b.settings.storefront.postageRM, 6, "B quotes the RM6 set on A");

    // The owner then edits postage to RM8 on B; B's newer local edit wins and syncs up.
    b.settings.storefront.postageRM = 8;
    b.settings.storefront.postageSet = true;
    const bRow = cloudRow("settings", "default",
      sync.computeRecords(b).find((r) => r.kind === "settings").data, "2026-02-02T00:00:00.000Z");

    const a2 = baseState();
    a2.settings.storefront = { postageRM: 6, postageSet: true };
    seedJournal(store, { meta: { "settings:default": "2026-02-01T00:00:00.000Z" } });
    sync.mergeRows(a2, [bRow]);
    assert.equal(a2.settings.storefront.postageRM, 8, "A now quotes the newer RM8 set on B");
  } finally { restore(); }
});

test("recordPayload: the switch rides the private row only once she has chosen (postageModeSet)", () => {
  const st = baseState();
  st.settings.storefront = { name: "Munchies", postageRM: 8, postageSet: true, postageMode: "quote", postageModeSet: false };

  // The fee was set long ago, and that says nothing about the way she wants delivery
  // priced today — so this phone has no opinion about the switch yet and must not push
  // its own "quote" up, nor its own "flat" if she had gone the other way.
  let settings = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(settings.data.postageRM, 8, "the fee it did set still travels");
  assert.equal("postageMode" in settings.data, false,
    "but the way of pricing it does not, until she has touched the switch on this phone");

  st.settings.storefront.postageModeSet = true;
  settings = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(settings.data.postageMode, "quote", "once chosen, it rides the private settings row");
});

test("mergeRows: the cloud row's switch is adopted and marked known", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.storefront = { name: "Munchies Furkidz", postageRM: 8, postageSet: true };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM", postageMode: "quote" },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.settings.storefront.postageMode, "quote", "her choice on the other phone is adopted");
    assert.equal(st.settings.storefront.postageModeSet, true, "and this phone now carries it in its own pushes");
    assert.equal(st.settings.storefront.name, "Munchies Furkidz", "local branding untouched");
    assert.equal("postageMode" in st.settings, false, "no stray top-level settings.postageMode");
  } finally { restore(); }
});

test("mergeRows: a cloud row with no switch leaves this phone's choice alone", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.storefront = { postageMode: "quote", postageModeSet: true };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    // The other phone has never touched the switch, so its newer row says nothing about
    // it — silence is ignorance here, not "go back to flat".
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(st.settings.storefront.postageMode, "quote", "her choice survives a switch-less cloud row");
    assert.equal(st.settings.storefront.postageModeSet, true, "and the flag is still true");
  } finally { restore(); }
});

test("mergeRows: the switch is last-set-wins between phones", () => {
  const { store, restore } = installStorage();
  try {
    const a = baseState();
    a.settings.storefront = { postageMode: "quote", postageModeSet: true };
    const aRow = cloudRow("settings", "default",
      sync.computeRecords(a).find((r) => r.kind === "settings").data, "2026-02-01T00:00:00.000Z");

    const b = baseState();
    b.settings.storefront = { postageMode: "flat", postageModeSet: false };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(b, [aRow]);
    assert.equal(b.settings.storefront.postageMode, "quote", "B adopts the mode set on A");
  } finally { restore(); }
});

test("mergeRows: unchanged merge reports changed:false", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    seedJournal(store, { meta: { "orders:o1": "2026-02-01T00:00:00.000Z" } });
    const r = sync.mergeRows(st, [cloudRow("orders", "o1", { id: "o1", qty: 3 }, "2026-01-01T00:00:00.000Z")]);
    assert.equal(r.changed, false);
  } finally { restore(); }
});

// ── needsGate ─────────────────────────────────────────────────────────────

test("needsGate: off when cloud disabled, on when enabled without a session", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    assert.equal(sync.needsGate(st), false, "cloud off → no gate");

    cloudOn(st);
    assert.equal(sync.needsGate(st), true, "cloud on, no token, no creds → gate");

    seedToken(store);
    assert.equal(sync.needsGate(st), false, "valid session → no gate");

    store.delete("bakeadmin.supabase");
    st.settings.supabase.email = "a@b.c";
    st.settings.supabase.password = "pw";
    assert.equal(sync.needsGate(st), false, "stored creds → auto-login, no gate");
  } finally { restore(); }
});

// ── flush ─────────────────────────────────────────────────────────────────

test("flush: pushes pending rows with auth headers and clears them on success", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    let captured = null;
    const restoreFetch = installFetch(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, text: async () => "" };
    });

    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, true);
      assert.equal(r.pushed, 2); // order + settings

      assert.ok(captured.url.includes("/rest/v1/bakery?on_conflict=kind,id"));
      assert.equal(captured.opts.headers.apikey, "anon");
      assert.equal(captured.opts.headers.Authorization, "Bearer tok_abc");
      assert.equal(captured.opts.headers.Prefer, "resolution=merge-duplicates,return=minimal");

      const body = JSON.parse(captured.opts.body);
      const orderRow = body.find((row) => row.id === "o1");
      assert.equal(orderRow.kind, "orders");
      assert.equal(orderRow._deleted, false);
      assert.equal(orderRow.updated_at, "2026-01-01T00:00:00.000Z");
      assert.deepEqual(JSON.parse(orderRow.data), { id: "o1", productId: "p1", qty: 2 });

      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.deepEqual(b.pending, {}, "successful push clears pending");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("flush: a tombstone pushes a string data, not JSON null (bakery.data is NOT NULL)", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    seedToken(store);

    // Queue a record, then delete it — markDirty turns the removal into a tombstone.
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");
    st.orders = [];
    sync.markDirty(st, "2026-01-02T00:00:00.000Z");

    let captured = null;
    const restoreFetch = installFetch(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, text: async () => "" };
    });

    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, true);
      const body = JSON.parse(captured.opts.body);
      const tombstone = body.find((row) => row.id === "o1");
      assert.equal(tombstone._deleted, true);
      assert.equal(tombstone.data, "null", "tombstone carries the string 'null', not JSON null");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("flush: keeps pending when the push fails, and no-ops when empty", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    let restoreFetch = installFetch(async () => ({ ok: false, status: 500, text: async () => "boom" }));
    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, false);
      assert.ok(r.reason.includes("500"));
      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.ok(b.pending["orders:o1"], "pending kept for retry");
    } finally { restoreFetch(); }

    // clear pending, then a flush with nothing queued is a fast success
    seedJournal(store);
    restoreFetch = installFetch(async () => { throw new Error("should not be called"); });
    try {
      const r = await sync.flush(st);
      assert.deepEqual(r, { ok: true, pushed: 0 });
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ── pull ──────────────────────────────────────────────────────────────────

test("pull: merges cloud rows, persists lastPullAt, reports changed", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    seedToken(store);

    const restoreFetch = installFetch(async (url) => {
      assert.ok(url.includes("/rest/v1/bakery"));
      assert.ok(url.includes("select=kind,id,data,updated_at,_deleted"));
      return { ok: true, json: async () => [cloudRow("orders", "o_new", { id: "o_new", qty: 4 }, "2026-02-01T00:00:00.000Z")] };
    });
    try {
      const r = await sync.pull(st);
      assert.equal(r.ok, true);
      assert.equal(r.changed, true);
      assert.equal(st.orders.length, 1);
      assert.equal(st.orders[0].qty, 4);
      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.ok(b.lastPullAt, "lastPullAt recorded");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("pull: offline, unconfigured, or unauthenticated never throws", async () => {
  const { store, restore } = installStorage();
  try {
    // cloud off
    assert.deepEqual(await sync.pull(baseState()), { ok: false, changed: false, reason: "Shared data is off" });

    // cloud on, no token
    const st = cloudOn(baseState());
    assert.deepEqual(await sync.pull(st), { ok: false, changed: false, reason: "Not signed in" });

    // network failure
    seedToken(store);
    const restoreFetch = installFetch(async () => { throw new Error("no signal"); });
    try {
      const r = await sync.pull(st);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "Offline — will retry");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ── signIn (one-time migration) ───────────────────────────────────────────

test("signIn: logs in, pulls the empty cloud, and uploads local data", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];

    const calls = [];
    const restoreFetch = installFetch(async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes("/auth/v1/token")) {
        return { ok: true, json: async () => ({ access_token: "tok_mig", expires_in: 3600 }) };
      }
      if (url.includes("/rest/v1/bakery?on_conflict")) {
        return { ok: true, text: async () => "" }; // the push
      }
      return { ok: true, json: async () => [] }; // the pull — empty cloud on first sign-in
    });
    try {
      await sync.signIn(st, "https://x.supabase.co", "anon", "sister@x.com", "pw");

      assert.equal(st.settings.supabase.url, "https://x.supabase.co");
      assert.equal(st.settings.supabase.anonKey, "anon");
      assert.equal(st.settings.supabase.email, "sister@x.com");

      const push = calls.find((c) => c.url.includes("/rest/v1/bakery?on_conflict=kind,id"));
      assert.ok(push, "a push happened after the pull");
      const body = JSON.parse(push.opts.body);
      assert.ok(body.some((r) => r.id === "o1"), "existing local order uploaded in the migration");

      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.equal(Object.keys(b.pending).length, 0, "migration push cleared pending");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ── refresh (pull-then-flush) ─────────────────────────────────────────────

test("refresh: skips the flush when the pull fails (stale-write protection)", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 2 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    let pushCount = 0;
    const restoreFetch = installFetch(async (url, opts) => {
      if (opts && opts.method === "POST") { pushCount++; return { ok: true, text: async () => "" }; }
      throw new Error("no signal"); // the pull fails
    });
    try {
      const r = await sync.refresh(st);
      assert.equal(r.ok, false);
      assert.equal(pushCount, 0, "no push without a successful pull");
      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.ok(b.pending["orders:o1"], "pending preserved for the next successful pull");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("refresh: uploads records that exist locally but were never synced (suppliers added before their kind joined)", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.suppliers = [{ id: "sup_mydin", name: "Mydin", active: true }];
    seedToken(store);
    // A phone that is already signed in, with a journal from before suppliers
    // were part of the sync. The cloud is quiet and unchanged, so nothing in the
    // normal flow (no edits, no pull change) would ever queue them for upload.
    seedJournal(store, { lastPullAt: "2026-01-01T00:00:00.000Z" });

    const pushes = [];
    const restoreFetch = installFetch(async (url, opts) => {
      if (opts && opts.method === "POST") {
        pushes.push(JSON.parse(opts.body));
        return { ok: true, text: async () => "" };
      }
      return { ok: true, json: async () => [] }; // the pull — cloud has no supplier rows yet
    });
    try {
      const r = await sync.refresh(st);
      assert.equal(r.ok, true);
      assert.ok(pushes.length >= 1, "a push happens on Sync now even with no edit made");
      const body = pushes.flat();
      const sup = body.find((x) => x.kind === "suppliers" && x.id === "sup_mydin");
      assert.ok(sup, "the pre-existing supplier is queued and uploaded");
      assert.equal(sup._deleted, false);
      assert.equal(JSON.parse(sup.data).name, "Mydin");
      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.ok(!b.pending["suppliers:sup_mydin"], "the uploaded supplier is no longer pending");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ── pageActive (hidden-tab gate) ──────────────────────────────────────────

test("pageActive(): refreshes only while the page is on screen", () => {
  const realDoc = globalThis.document;
  try {
    globalThis.document = { hidden: false };
    assert.equal(sync.pageActive(), true, "visible page refreshes");
    globalThis.document = { hidden: true };
    assert.equal(sync.pageActive(), false, "hidden page is skipped");
    // Test shims / old browsers without document.hidden are treated as active,
    // so an unknown state can never silently stop the sync loop.
    delete globalThis.document;
    assert.equal(sync.pageActive(), true, "no document.hidden → treated as active");
  } finally {
    if (realDoc === undefined) delete globalThis.document;
    else globalThis.document = realDoc;
  }
});

// ── the editable to-do list (settings.tasks) ─────────────────────────────

test("computeRecords: settings payload omits tasks until customised, then carries them", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal("tasks" in bare.data, false,
    "a phone that never edited its to-do pushes no tasks field");

  st.settings.tasks = [{ id: "orders", label: "Reply to new orders" }, { id: "tskA", label: "Clean the oven" }];
  const withTasks = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withTasks.data.tasks,
    [{ id: "orders", label: "Reply to new orders" }, { id: "tskA", label: "Clean the oven" }],
    "the customised list rides the settings row so both phones agree");
});

test("mergeRows: a newer cloud to-do list replaces the local one wholesale", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.tasks = [{ id: "orders", label: "local old wording" }, { id: "tskL", label: "Local-only task" }];
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        tasks: [{ id: "orders", label: "Reply to new orders & WhatsApp" }, { id: "tskC", label: "Call the supplier" }],
        weekCheck: { week: "", done: {} },
      },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.deepEqual(st.settings.tasks,
      [{ id: "orders", label: "Reply to new orders & WhatsApp" }, { id: "tskC", label: "Call the supplier" }],
      "the newer list wins whole, exactly like the rest of settings");
  } finally { restore(); }
});

test("mergeRows: a cloud row without tasks never deletes the local customised list", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.tasks = [{ id: "tskA", label: "Clean the oven" }];
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    // Another phone (older build, or one that never customised) pushes a payload
    // with no `tasks` key — the local list must survive that merge.
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.tasks, [{ id: "tskA", label: "Clean the oven" }],
      "an absent cloud field is not a delete");
  } finally { restore(); }
});

// ── the developer contact (settings.developer) ────────────────────────────
// Same lazy guard as tasks/wishList: nothing is pushed until a name or email is
// typed, so a phone that never set one can't clobber the other phone's.

test("computeRecords: settings payload omits the developer until typed, then carries it", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal("developer" in bare.data, false,
    "a phone that never set a developer pushes no developer field");

  st.settings.developer = { name: "  Dev Studio  ", emails: ["dev@example.com", "", "two@example.com"], whatsapp: " 012-345 6789 " };
  const withDev = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withDev.data.developer,
    { name: "Dev Studio", emails: ["dev@example.com", "two@example.com"], whatsapp: "012-345 6789" },
    "the trimmed developer (with its WhatsApp number) rides the settings row so every phone agrees");

  // A WhatsApp-only developer (no emails) is still pushed, so the About row and
  // footers can offer the chat even before an email is typed.
  st.settings.developer = { name: "Dev Studio", whatsapp: "0123456789" };
  const waOnly = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(waOnly.data.developer,
    { name: "Dev Studio", emails: [], whatsapp: "0123456789" },
    "a phone that set only a WhatsApp number still publishes it");
});

test("mergeRows: a cloud settings row without the developer never deletes the local one", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.developer = { name: "Dev Studio", emails: ["dev@example.com"] };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.developer,
      { name: "Dev Studio", emails: ["dev@example.com"] },
      "an absent cloud developer field is not a delete");
  } finally { restore(); }
});

test("mergeRows: a newer cloud developer replaces the local one wholesale", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.developer = { name: "Old", emails: ["old@example.com"] };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        developer: { name: "New Studio", emails: ["new@example.com", "also@example.com"], whatsapp: "016 900 1234" } },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.deepEqual(st.settings.developer,
      { name: "New Studio", emails: ["new@example.com", "also@example.com"], whatsapp: "016 900 1234" },
      "the newer developer (WhatsApp included) wins whole, like the rest of settings");
  } finally { restore(); }
});

// ── sharingState (the amber "Not sharing right now" strip) ────────────────

test("sharingState: sharing when the cloud is on and the session is live", () => {
  const st = cloudOn(baseState()); // url + anonKey + cloud.enabled
  assert.deepEqual(sync.sharingState(st, true), { on: true });
});

test("sharingState: treated as sharing while stored credentials would auto-login", () => {
  const st = cloudOn(baseState());
  st.settings.supabase.email = "baker@example.com";
  st.settings.supabase.password = "pw";
  // No live session yet (inject signedIn=false), but creds are saved, so the
  // app logs in on its own next open — not a warning state.
  assert.deepEqual(sync.sharingState(st, false), { on: true });
});

test("sharingState: 'off' when the switch is off but the connection is configured", () => {
  const st = cloudOn(baseState());
  st.settings.cloud.enabled = false;
  assert.deepEqual(sync.sharingState(st, true), { on: false, kind: "off" });
});

test("sharingState: 'unset' on a phone that was never connected", () => {
  const st = baseState(); // no url/anonKey
  st.settings.cloud.enabled = true;
  assert.deepEqual(sync.sharingState(st, true), { on: false, kind: "unset" });
});

test("sharingState: 'signedout' when the cloud is on but there is no session and no stored password", () => {
  const st = cloudOn(baseState());
  assert.deepEqual(sync.sharingState(st, false), { on: false, kind: "signedout" });
});

// ── the synced customers collection (profiles) ────────────────────────────

test("computeRecords: customer-profile rows ride the sync like every other list", () => {
  const st = baseState();
  st.customers = [
    { id: "cus_a", key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco", likes: "banana" },
    { id: "cus_b", key: "6013-222", name: "Mr Lim", whatsapp: "6013-222", dogName: "Milo" },
  ];

  const rows = sync.computeRecords(st);
  const cus = rows.filter((r) => r.kind === "customers");
  assert.equal(cus.length, 2);
  assert.equal(cus[0].id, "cus_a");
  assert.deepEqual(cus[0].data, st.customers[0], "a profile is carried wholesale, photo included");
  assert.deepEqual(cus[1].data, st.customers[1]);
});

test("mergeRows: a profile added on one phone appears on the other, and a tombstone removes it", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.customers = []; // the current build always has the (empty) collection
    seedJournal(store);
    const add = sync.mergeRows(st, [cloudRow("customers", "cus_a",
      { id: "cus_a", key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco" },
      "2026-09-08T10:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.customers.length, 1);
    assert.equal(st.customers[0].dogName, "Coco");

    const del = sync.mergeRows(st, [cloudRow("customers", "cus_a", null, "2026-09-08T11:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.customers.length, 0, "a removed profile disappears like any other record");
  } finally { restore(); }
});

test("mergeRows: a newer local profile edit wins over a stale cloud profile", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.customers = [{ id: "cus_a", key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", likes: "edited on this phone" }];
    seedJournal(store, {
      pending: { "customers:cus_a": { kind: "customers", id: "cus_a", updated_at: "2026-09-08T10:30:00.000Z", data: st.customers[0], _deleted: false } },
      meta: { "customers:cus_a": "2026-09-08T10:30:00.000Z" },
    });
    const r = sync.mergeRows(st, [cloudRow("customers", "cus_a",
      { id: "cus_a", key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", likes: "older cloud" },
      "2026-09-08T10:00:00.000Z")]);
    assert.equal(r.changed, false);
    assert.equal(st.customers[0].likes, "edited on this phone", "the pending local edit stays");
  } finally { restore(); }
});

// ── the software wish list (settings.wishList) ────────────────────────────

test("computeRecords: settings payload omits wishList until customised, then carries it", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal("wishList" in bare.data, false,
    "a phone that never opened the wish list pushes no wishList field");

  st.settings.wishList = [{ id: "wsh_a", label: "Remind me when stock is low", done: true }];
  const withWishes = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withWishes.data.wishList, st.settings.wishList,
    "the customised list rides the settings row so both phones agree");
});

test("mergeRows: a newer cloud wish list replaces the local one wholesale", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.wishList = [{ id: "wsh_l", label: "local old idea", done: true }];
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    const r = sync.mergeRows(st, [cloudRow("settings", "default",
      {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        wishList: [{ id: "wsh_c", label: "Call the supplier from the app", done: false }],
        weekCheck: { week: "", done: {} },
      },
      "2026-02-01T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.deepEqual(st.settings.wishList, [{ id: "wsh_c", label: "Call the supplier from the app", done: false }],
      "the newer list wins whole, exactly like the rest of settings");
  } finally { restore(); }
});

test("mergeRows: a cloud settings row without wishList never deletes the local wish list", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.wishList = [{ id: "wsh_a", label: "Clean the oven timer", done: false }];
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });

    // Another phone (older build, or one that never customised) pushes a payload
    // with no `wishList` key — the local list must survive that merge.
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.wishList, [{ id: "wsh_a", label: "Clean the oven timer", done: false }],
      "an absent cloud field is not a delete");
  } finally { restore(); }
});

test("a product's auto-translated text + provenance survives a sync round trip", () => {
  const { store, restore } = installStorage();
  try {
    const a = baseState();
    a.products = [{
      id: "prd1", name: "Focaccia", description: "Crispy airy crumb", unit: "loaf", active: true,
      nameZh: "佛卡夏", nameMs: "Roti Focaccia", descZh: "香脆空心", descMs: "Rangup berangin",
      servingZh: "以 150°C 加热", servingMs: "Panaskan",
      trOverride: ["nameMs", "descMs"],                                   // boxes she typed by hand
      trSrc: { nameZh: "Focaccia", descZh: "Crispy airy crumb" },         // machine lines' English source
    }];

    // Phone A saves → computes the row that would be pushed.
    const rows = sync.computeRecords(a);
    const prodRow = rows.find((r) => r.kind === "products" && r.id === "prd1");
    assert.deepEqual(prodRow.data, a.products[0],
      "the whole product row rides the sync, translated lines included");

    // Phone B (nothing yet) pulls it: every field arrives intact, including the
    // nested trOverride array and trSrc map.
    const b = baseState();
    seedJournal(store);
    const r = sync.mergeRows(b, [cloudRow("products", "prd1", prodRow.data, "2026-09-09T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    const got = b.products[0];
    assert.equal(got.descZh, "香脆空心");
    assert.equal(got.servingMs, "Panaskan");
    assert.deepEqual(got.trOverride, ["nameMs", "descMs"], "hand-typed provenance survives");
    assert.deepEqual(got.trSrc, { nameZh: "Focaccia", descZh: "Crispy airy crumb" },
      "machine-translation provenance survives");
  } finally { restore(); }
});

// ── the settings row's key-wise memory (the 24 Sep saved-days loss) ───────
//
// Every phone shares ONE settings row and a push REPLACES its `data` whole, so a
// phone's SILENCE about a key used to be indistinguishable from a deletion. On
// 24 September 2026 a phone that had never synced came up with no saved days and
// then pushed its own settings over hers, deleting `scenarios` and `scenario`
// from the cloud. These tests pin the three rules that stand in the way:
//   1  a guarded key this phone HELD and has now emptied is SPOKEN, not silent;
//   2  local wins, but the cloud's value for every guarded key this phone is
//      silent about is taken — into the push, and into this phone's settings;
//   3  a guarded key the cloud is silent about, that this phone holds content
//      for, is put back by one queued publish.

const SHELF = [
  { id: "s1", name: "No fridge, 1 person", target: 24 },
  { id: "s2", name: "One baker day", target: 24 },
];
const OTHER_SHELF = [{ id: "s9", name: "My sister proposal 21/9/2026", target: 12 }];

function pushedSettings(bodies) {
  const row = bodies.flat().find((r) => r.kind === "settings");
  return row ? JSON.parse(row.data) : null;
}

function queuedSettings(store) {
  return JSON.parse(store.get("bakeadmin.sync")).pending["settings:default"];
}

// A phone's journal as it stands after it has recorded its own settings row but
// has nothing queued: the snapshot is real, the pending is empty.
function seedQuiet(store, st, at) {
  sync.markDirty(st, at);
  const snap = JSON.parse(store.get("bakeadmin.sync")).snapshot;
  seedJournal(store, { snapshot: snap, meta: { "settings:default": at } });
}

test("refresh: a phone that never had her saved days receives them, and its push carries them back", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    seedToken(store);
    const bodies = [];
    const restoreFetch = installFetch(async (url, opts) => {
      if (url.includes("on_conflict")) {
        bodies.push(JSON.parse(opts.body));
        return { ok: true, text: async () => "" };
      }
      return {
        ok: true,
        json: async () => [cloudRow("settings", "default", { cutoff: "18:00", scenarios: SHELF },
          "2026-09-20T00:00:00.000Z")],
      };
    });
    try {
      const r = await sync.refresh(st);
      assert.equal(r.ok, true);
      assert.deepEqual(st.settings.scenarios.map((s) => s.name),
        ["No fridge, 1 person", "One baker day"],
        "the phone that never had her saved days received them");
      const pushed = pushedSettings(bodies);
      assert.ok(pushed, "the phone pushed its settings row");
      assert.deepEqual((pushed.scenarios || []).map((s) => s.name),
        ["No fridge, 1 person", "One baker day"],
        "the push carried her saved days back, so it cannot delete them");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("refresh: a phone that never built a day receives the one she built", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    seedToken(store);
    const DAY = { modules: [{ id: "mixer", kind: "mixer", minutes: 20 }], dayStart: 240 };
    const restoreFetch = installFetch(async (url) => {
      if (url.includes("on_conflict")) return { ok: true, text: async () => "" };
      return { ok: true, json: async () => [cloudRow("settings", "default", { scenario: DAY },
        "2026-09-20T00:00:00.000Z")] };
    });
    try {
      await sync.refresh(st);
      assert.deepEqual(st.settings.scenario, DAY, "the built day came down to the phone that never built one");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("markDirty: emptying her shelf is said out loud, not left silent", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.scenarios = SHELF;
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.scenarios = []; // she deletes them on this phone
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the deletion is queued");
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "scenarios"), true,
      "the empty shelf is SPOKEN, so the other phone cannot read it as ignorance");
    assert.deepEqual(p.data.scenarios, []);
  } finally { restore(); }
});

test("markDirty: clearing the developer line is said out loud too", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.developer = { name: "Jien", emails: ["me@x.com"], whatsapp: "+60169601268" };
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.developer = { name: "", emails: [], whatsapp: "" };
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the clearing is queued");
    assert.deepEqual(p.data.developer, { name: "", emails: [], whatsapp: "" },
      "the cleared developer line is spoken as an empty one, never omitted");
  } finally { restore(); }
});

test("markDirty: a phone that never had a shelf stays silent instead of inventing an empty one", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    sync.markDirty(st, "2026-09-24T00:00:00.000Z"); // this phone's own settings, no shelf ever
    st.settings.cutoff = "19:00"; // a real edit, so there is a payload to read
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p);
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "scenarios"), false,
      "a phone that never had a shelf says nothing about one, so no other phone is made to delete");
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "developer"), false,
      "nor does it announce a developer line it never had");
  } finally { restore(); }
});

test("markDirty: a saved-days field that has gone missing is not announced as an empty shelf", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.scenarios = SHELF;
    sync.markDirty(st, "2026-09-24T00:00:00.000Z"); // the shelf is recorded
    delete st.settings.scenarios; // a hand-edited import, not a deletion she made
    st.settings.cutoff = "19:00";
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p);
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "scenarios"), false,
      "a field that went missing is silence, not a deletion — so the cloud's copy comes back to this phone");
  } finally { restore(); }
});

test("mergeRows: a pending local edit does not delete a cloud shelf it never saw", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00";
    seedJournal(store, {
      pending: {
        "settings:default": {
          kind: "settings", id: "default", updated_at: "2026-09-24T12:00:00.000Z",
          data: { cutoff: "19:00" }, _deleted: false,
        },
      },
    });
    const r = sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", scenarios: SHELF }, "2026-09-24T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    const p = queuedSettings(store);
    assert.equal(p.data.cutoff, "19:00", "her own edit still goes out");
    assert.deepEqual((p.data.scenarios || []).map((s) => s.id), ["s1", "s2"],
      "the push carries the shelf this phone has no opinion about");
    assert.deepEqual(st.settings.scenarios.map((s) => s.id), ["s1", "s2"],
      "and the phone that never had them takes them");
  } finally { restore(); }
});

test("mergeRows: a phone with its own saved days keeps them and does not take the cloud's", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.scenarios = OTHER_SHELF;
    sync.markDirty(st, "2026-09-24T12:00:00.000Z"); // her own days, on their way up
    const r = sync.mergeRows(st,
      [cloudRow("settings", "default", { scenarios: SHELF }, "2026-09-24T00:00:00.000Z")]);
    assert.equal(r.changed, false, "nothing came down over her own days");
    assert.deepEqual(st.settings.scenarios.map((s) => s.id), ["s9"], "her own days stand");
    assert.deepEqual(queuedSettings(store).data.scenarios.map((s) => s.id), ["s9"],
      "and the push carries hers, not the cloud's");
  } finally { restore(); }
});

test("mergeRows: a phone that still has her saved days puts them back into a cloud row that lost them", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.scenarios = SHELF;
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    const r = sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00" }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    const p = queuedSettings(store);
    assert.ok(p, "one publish is queued, with no press of hers needed");
    assert.deepEqual(p.data.scenarios.map((s) => s.id), ["s1", "s2"],
      "the publish carries the saved days the cloud row lost");
    assert.deepEqual(st.settings.scenarios.map((s) => s.id), ["s1", "s2"],
      "and the shelf is still on this phone");
  } finally { restore(); }
});

test("mergeRows: a shelf she deliberately emptied is NOT put back by the other phone", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.scenarios = SHELF;
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { scenarios: [] }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(queuedSettings(store), undefined,
      "an empty shelf the other phone SPOKE is an answer, so nothing is put back over it");
    assert.deepEqual(st.settings.scenarios, [],
      "and this phone takes her deletion");
  } finally { restore(); }
});

// ── the line numbers on More → Production line (v182) ─────────────────────
//
// `production` is guarded by the same three rules as the keys above and could not be
// judged the same way: every payload carries a whole plan, so a phone's silence about
// it is not an absent key but a plan that is still exactly the numbers every phone is
// set up with. These tests pin the content test that stands in for absence, in both
// directions, because the fault was symmetric — a newly set up phone's stock plan
// replaced her line numbers whether it was pushing or pulling.

const TYPED_PLAN = { ...STOCK_PRODUCTION, ovenMin: 18, prooferMin: 55 };

test("mergeRows: a phone that has never touched the line takes the cloud's numbers, and its push carries them", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.production = { ...STOCK_PRODUCTION }; // set up, never typed into
    st.settings.cutoff = "19:00"; // a real edit, so this phone is the one pushing
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    const r = sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", production: TYPED_PLAN }, "2026-09-24T00:00:00.000Z")]);
    assert.equal(r.changed, true);
    assert.equal(st.settings.production.ovenMin, 18,
      "the line numbers she typed on the other phone did not reach a phone that had never touched them");
    assert.equal(queuedSettings(store).data.production.ovenMin, 18,
      "the push about to go out carries the stock numbers, so it would put them over hers");
  } finally { restore(); }
});

test("mergeRows: a phone with its own line numbers keeps them when the cloud is holding the stock ones", () => {
  // The fault v181 measured from this end: a brand-new phone's stock plan is pushed to
  // the cloud as it is set up, and the cloud row is then the newest. Without the
  // content test the cloud-wins merge would hand those stock numbers to the phone she
  // had typed on, which is the loss this version closes.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.production = { ...TYPED_PLAN };
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    const r = sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", production: { ...STOCK_PRODUCTION } }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(r.changed, true, "the row was still read");
    assert.equal(st.settings.production.ovenMin, 18,
      "a stock plan the cloud was only carrying replaced the numbers she had typed");
    assert.equal(st.settings.production.prooferMin, 55, "and it took a second number with it");
    const p = queuedSettings(store);
    assert.ok(p, "one publish is queued, so the cloud row is put back to hers with no press");
    assert.equal(p.data.production.ovenMin, 18, "the queued publish carries the stock plan back up");
  } finally { restore(); }
});

test("mergeRows: a phone whose line numbers are still the stock ones queues no publish", () => {
  // The other half, and what stops the two phones from pushing at each other forever:
  // a phone with no numbers of its own has nothing to put back, so a stock cloud row
  // and a stock phone make no publish between them.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.production = { ...STOCK_PRODUCTION };
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", production: { ...STOCK_PRODUCTION } }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(queuedSettings(store), undefined,
      "a phone that has never typed a number was made to publish a plan it has no opinion about");
  } finally { restore(); }
});

test("mergeRows: a cloud row with no plan at all, and a phone that has one, is put back", () => {
  // A row written before the line numbers existed carries no `production` key at all.
  // That is the cloud being silent about them in the plainest way, so the same rule
  // covers it as covers a stock plan.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.production = { ...TYPED_PLAN };
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { cutoff: "18:00" }, "2026-09-20T00:00:00.000Z")]);
    const p = queuedSettings(store);
    assert.ok(p, "a cloud row with no plan left the phone's own numbers unpublished");
    assert.equal(p.data.production.ovenMin, 18);
    assert.equal(st.settings.production.ovenMin, 18, "and her own numbers are still on the phone");
  } finally { restore(); }
});

test("mergeRows: the line numbers she typed come down to a phone that has none", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.production = { ...STOCK_PRODUCTION };
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", production: { ...TYPED_PLAN } }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(st.settings.production.ovenMin, 18,
      "the cloud's own line numbers did not reach a phone that had never typed any");
    assert.equal(queuedSettings(store), undefined,
      "a cloud row that has numbers of its own was treated as one that needs repairing");
  } finally { restore(); }
});

test("mergeRows: a plan missing one of the stock numbers counts as hers, not as silence", () => {
  // The content test is the whole plan, key by key, so a plan that differs in any way —
  // a number typed, a field dropped by a hand-edited file — is a plan somebody wrote and
  // is protected. A comparison on `planRev` alone would have read this one as stock.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    const partial = { ...STOCK_PRODUCTION };
    delete partial.ovenMin;
    st.settings.production = partial;
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", production: { ...STOCK_PRODUCTION } }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(Object.prototype.hasOwnProperty.call(st.settings.production, "ovenMin"), false,
      "a plan with a number missing was read as the stock plan and overwritten");
    assert.ok(queuedSettings(store), "and no repair was queued for it either");
  } finally { restore(); }
});

test("mergeRows: a cloud row with nothing missing queues no publish", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { cutoff: "18:00" }, "2026-09-20T00:00:00.000Z")]);
    assert.equal(Object.keys(JSON.parse(store.get("bakeadmin.sync")).pending).length, 0,
      "a phone that holds nothing guarded is not made to publish");
  } finally { restore(); }
});

// ── the board's ticked coaches (v184) ─────────────────────────────────────
//
// `boardAcks` is the fifth guarded key and the first that is an OBJECT rather than
// a list. It rides the same three rules, and its empty is `{}` rather than `[]` —
// which is the whole reason `speakEmptied` was widened this release: with the old
// `Array.isArray` branch an object-valued key could not be spoken at all, so
// "Clear the board" went out as silence, the other phone read that silence as
// ignorance, and rule 3 put every cleared tick straight back.

const TICKS = { "Wei|Dimple and top|0|0|1": 1 };

test("markDirty: clearing the board is said out loud, so the other phone takes the clear", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.boardAcks = TICKS;
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.boardAcks = {}; // Clear the board
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the clear is queued");
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "boardAcks"), true,
      "the empty board is spoken, so the other phone cannot read the clear as ignorance");
    assert.deepEqual(p.data.boardAcks, {});
  } finally { restore(); }
});

test("markDirty: a phone that never ticked a coach stays silent instead of inventing an empty board", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    sync.markDirty(st, "2026-09-24T00:00:00.000Z"); // this phone's own settings, board never opened
    st.settings.cutoff = "19:00"; // a real edit, so there is a payload to read
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p);
    assert.equal(Object.prototype.hasOwnProperty.call(p.data, "boardAcks"), false,
      "a phone that never ticked says nothing about the board, so no other phone is made to drop its ticks");
  } finally { restore(); }
});

test("markDirty: a phone that holds ticks sends them, so the board agrees on both phones", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.boardAcks = TICKS;
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p);
    assert.deepEqual(p.data.boardAcks, TICKS,
      "the ticks were left out of the payload, so the other phone never sees them");
  } finally { restore(); }
});

test("mergeRows: a phone that has never ticked receives the coaches ticked on the other phone", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00"; // a real edit, so this phone is the one pushing
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", boardAcks: TICKS }, "2026-09-24T00:00:00.000Z")]);
    assert.deepEqual(st.settings.boardAcks, TICKS,
      "the ticks did not reach the phone that had never ticked one");
    assert.deepEqual(queuedSettings(store).data.boardAcks, TICKS,
      "the push about to go out left them behind, so it would delete them");
  } finally { restore(); }
});

test("mergeRows: a phone still holding the ticks puts them back into a cloud row that lost them", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.boardAcks = TICKS;
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { cutoff: "18:00" }, "2026-09-20T00:00:00.000Z")]);
    const p = queuedSettings(store);
    assert.ok(p, "one publish is queued, with no press of hers needed");
    assert.deepEqual(p.data.boardAcks, TICKS,
      "the publish did not carry the ticks the cloud row had lost");
    assert.deepEqual(st.settings.boardAcks, TICKS, "and the ticks are still on this phone");
  } finally { restore(); }
});

test("mergeRows: a board the other phone cleared takes this phone's ticks away", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.boardAcks = TICKS;
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", boardAcks: {} }, "2026-09-20T00:00:00.000Z")]);
    assert.deepEqual(st.settings.boardAcks, {},
      "the clear she pressed on the other phone was not taken here");
    assert.equal(queuedSettings(store), undefined,
      "and the ticks were queued straight back over the clear");
  } finally { restore(); }
});

test("mergeRows: the other phone's clear is not written onto a phone that never had a board", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00"; // a real edit, so this phone is the one pushing
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    sync.mergeRows(st,
      [cloudRow("settings", "default", { cutoff: "18:00", boardAcks: {} }, "2026-09-24T00:00:00.000Z")]);
    assert.equal(Object.prototype.hasOwnProperty.call(st.settings, "boardAcks"), false,
      "an empty board is an answer, not content — so a phone that was silent about one was given it anyway");
    assert.equal(Object.prototype.hasOwnProperty.call(queuedSettings(store).data, "boardAcks"), false,
      "nor did the phone start speaking an empty board it never had");
  } finally { restore(); }
});

// ── v200: the five settings that were device-local by OMISSION ─────────────
//
// `categories`, `payMethods`, `mailingAddress`, `personNames` and `personCalls`
// were all editable on a phone, all saved to its localStorage, and none of them
// named in recordPayload — so nothing ever carried them and the other phone kept
// the built-in chart, an empty address and nobody on the chart. Each is guarded
// the lazy way the four lists above are; the difference between them is only what
// an EMPTY one means.

const HER_CHART = [
  { label: "Packaging", cls: "expense" },
  { label: "Market stall", cls: "expense" },
];
const CLOUD_CHART = [
  { label: "Utilities", cls: "expense" },
  { label: "Delivery run", cls: "expense" },
];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

test("computeRecords: settings payload omits her chart and her ways to pay until she changes them", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(hasOwn(bare.data, "categories"), false,
    "a phone still on the built-in chart pushes no chart of its own");
  assert.equal(hasOwn(bare.data, "payMethods"), false,
    "nor a list of ways to pay it never chose");

  st.settings.categories = HER_CHART;
  st.settings.payMethods = ["Cash", "TNG", "DuitNow"];
  const withThem = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withThem.data.categories, HER_CHART,
    "her own chart rides the settings row, so the other phone stops showing the built-in names");
  assert.deepEqual(withThem.data.payMethods, ["Cash", "TNG", "DuitNow"],
    "and so do the ways she actually gets paid");

  // ⚠️⚠️ AND THE THIRD LIST, WHICH IS THE EASIEST OF THE THREE TO FORGET (v394). A list she shapes on
  // one phone is **device-local until it is NAMED in `recordPayload`** — and the failure is SILENT:
  // nothing errors, the other phone simply never receives it. That is exactly how five keys were lost
  // in v200. Named here, and in `GUARDED` and `SPEAK_EMPTY` beside it, so all three carry together.
  assert.equal(hasOwn(bare.data, "sources"), false,
    "a phone that never chose a source pushes no list of its own");
  st.settings.sources = ["My own pocket", "Maybank savings"];
  const withSources = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withSources.data.sources, ["My own pocket", "Maybank savings"],
    "⚠️⚠️ the sources list she shaped never reaches her other phone");
});

test("mergeRows: a cloud row without a chart never deletes the local one", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.categories = HER_CHART;
    st.settings.payMethods = ["Cash", "DuitNow"];
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
      "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.categories, HER_CHART, "an absent cloud chart is not a delete");
    assert.deepEqual(st.settings.payMethods, ["Cash", "DuitNow"], "nor is an absent methods list");
  } finally { restore(); }
});

test("mergeRows: a newer cloud chart replaces the local one wholesale", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.categories = HER_CHART;
    seedQuiet(store, st, "2026-01-01T00:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { categories: CLOUD_CHART },
      "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.categories, CLOUD_CHART,
      "the newer chart wins whole, exactly like the rest of settings");
  } finally { restore(); }
});

test("mergeRows: a phone that has never changed its chart receives hers, and carries it back", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00"; // a real edit, so this phone is the one pushing
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { cutoff: "18:00", categories: HER_CHART },
      "2026-09-24T00:00:00.000Z")]);
    assert.deepEqual(st.settings.categories, HER_CHART,
      "the chart did not reach the phone that was still showing the built-in names");
    assert.deepEqual(queuedSettings(store).data.categories, HER_CHART,
      "the push about to go out left the chart behind, so it would delete it");
  } finally { restore(); }
});

test("markDirty: putting her chart back to the built-in names is said out loud", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.categories = HER_CHART;
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.categories = []; // back to the built-in chart
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the emptying is queued");
    assert.equal(hasOwn(p.data, "categories"), true,
      "an empty chart is SPOKEN, or the other phone reads it as ignorance and rule 2 hands hers back");
    assert.deepEqual(p.data.categories, []);
  } finally { restore(); }
});

// ── the mailing address (settings.mailingAddress) ─────────────────────────
// The FROM block on a mailing label, and the words the courier lookup falls back
// on when there is no pickup pin. A plain string, so it is the first key in
// SPEAK_EMPTY that is not an object — which is why speakEmptied grew a branch.

test("computeRecords: the mailing address is omitted until she types one, then it is carried", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(hasOwn(bare.data, "mailingAddress"), false,
    "a phone with no address pushes no address field");

  st.settings.mailingAddress = "  Munchies Furkidz, 12 Jalan Bunga Raya, 11600 Penang  ";
  const withAddr = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(withAddr.data.mailingAddress, "  Munchies Furkidz, 12 Jalan Bunga Raya, 11600 Penang  ",
    "her address rides the settings row so the labels print the same FROM on both phones");
});

test("mergeRows: a cloud row without an address never blanks the local one", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.mailingAddress = "12 Jalan Bunga Raya, 11600 Penang";
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, cutoff: "18:00" }, "2026-02-01T00:00:00.000Z")]);
    assert.equal(st.settings.mailingAddress, "12 Jalan Bunga Raya, 11600 Penang",
      "an absent cloud address is not a delete — the blank FROM would print a reminder instead");
  } finally { restore(); }
});

test("markDirty: clearing the mailing address is said out loud as an empty one", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.mailingAddress = "12 Jalan Bunga Raya, 11600 Penang";
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.mailingAddress = "";
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the clearing is queued");
    assert.equal(hasOwn(p.data, "mailingAddress"), true,
      "a cleared address has to travel as an empty string, never as silence");
    assert.equal(p.data.mailingAddress, "");
  } finally { restore(); }
});

test("mergeRows: a phone that has never typed an address receives hers", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00";
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default",
      { cutoff: "18:00", mailingAddress: "12 Jalan Bunga Raya, 11600 Penang" },
      "2026-09-24T00:00:00.000Z")]);
    assert.equal(st.settings.mailingAddress, "12 Jalan Bunga Raya, 11600 Penang",
      "the address did not reach the phone that never typed one");
  } finally { restore(); }
});

test("mergeRows: an address the cloud row has lost is put back by one publish", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.mailingAddress = "12 Jalan Bunga Raya, 11600 Penang";
    seedQuiet(store, st, "2026-09-01T00:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default", { cutoff: "18:00" }, "2026-09-20T00:00:00.000Z")]);
    const p = queuedSettings(store);
    assert.ok(p, "one publish is queued, with no press of hers needed");
    assert.equal(p.data.mailingAddress, "12 Jalan Bunga Raya, 11600 Penang",
      "the publish did not carry the address the cloud row had lost");
  } finally { restore(); }
});

// ── the planner's people (settings.personNames / settings.personCalls) ─────
// Kept by person NUMBER and shared by every scenario, so the names she types on
// one phone are the names the chart reads as people on the other.

test("computeRecords: the planner's people are omitted until there is something to say", () => {
  const st = baseState();
  const bare = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.equal(hasOwn(bare.data, "personNames"), false, "a phone with nobody named pushes no names");
  assert.equal(hasOwn(bare.data, "personCalls"), false, "nor a call list it has never ticked");

  st.settings.personNames = { 1: "Jien", 2: "Wei" };
  st.settings.personCalls = { 2: false };
  const withPeople = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(withPeople.data.personNames, { 1: "Jien", 2: "Wei" },
    "the names she typed ride the settings row, so the rows read as people on both phones");
  assert.deepEqual(withPeople.data.personCalls, { 2: false },
    "and so does who the day calls");
});

test("computeRecords: personCalls carries a person ticked back ON, not only one ticked off", () => {
  const st = baseState();
  // `calls[who] = call.checked` keeps true as well as false, so an object holding
  // only `true` is still a real answer and must not be mistaken for an empty.
  st.settings.personCalls = { 1: true, 2: false };
  const p = sync.computeRecords(st).find((r) => r.kind === "settings");
  assert.deepEqual(p.data.personCalls, { 1: true, 2: false },
    "a tick that was put back on is an answer too, and rides the row with the rest");
});

test("mergeRows: a cloud row with no people never deletes the local names", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.settings.personNames = { 1: "Jien", 2: "Wei" };
    st.settings.personCalls = { 2: false };
    seedJournal(store, { meta: { "settings:default": "2026-01-01T00:00:00.000Z" } });
    sync.mergeRows(st, [cloudRow("settings", "default",
      { defaultCapacity: 9, cutoff: "18:00" }, "2026-02-01T00:00:00.000Z")]);
    assert.deepEqual(st.settings.personNames, { 1: "Jien", 2: "Wei" },
      "an absent cloud name list is not a delete");
    assert.deepEqual(st.settings.personCalls, { 2: false }, "nor is an absent call list");
  } finally { restore(); }
});

test("mergeRows: a phone that has never named anybody receives her names", () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.settings.cutoff = "19:00";
    sync.markDirty(st, "2026-09-24T12:00:00.000Z");
    sync.mergeRows(st, [cloudRow("settings", "default",
      { cutoff: "18:00", personNames: { 1: "Jien", 2: "Wei" } }, "2026-09-24T00:00:00.000Z")]);
    assert.deepEqual(st.settings.personNames, { 1: "Jien", 2: "Wei" },
      "the names did not reach the phone whose chart was still showing bare numbers");
  } finally { restore(); }
});

test("markDirty: clearing her last worker name is said out loud", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.personNames = { 1: "Jien" };
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    st.settings.personNames = {}; // `delete names[who]` cleared the last one
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p, "the clearing is queued");
    assert.equal(hasOwn(p.data, "personNames"), true,
      "the emptied map is SPOKEN, so the other phone cannot read it as ignorance");
    assert.deepEqual(p.data.personNames, {});
  } finally { restore(); }
});

test("markDirty: a phone that has never ticked a call stays silent instead of inventing one", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    sync.markDirty(st, "2026-09-24T00:00:00.000Z"); // this phone's own settings, nobody ticked
    st.settings.cutoff = "19:00"; // a real edit, so there is a payload to read
    sync.markDirty(st, "2026-09-24T01:00:00.000Z");
    const p = queuedSettings(store);
    assert.ok(p);
    assert.equal(hasOwn(p.data, "personCalls"), false,
      "an empty call list is the default every phone already reads, so it says nothing about one");
    assert.equal(hasOwn(p.data, "personNames"), false, "nor does it announce names it never had");
  } finally { restore(); }
});

test("markDirty: a phone holding ticks still sends them, so who is called agrees on both phones", () => {
  const { store, restore } = installStorage();
  try {
    seedJournal(store);
    const st = baseState();
    st.settings.personCalls = { 3: false };
    sync.markDirty(st, "2026-09-24T00:00:00.000Z");
    assert.deepEqual(queuedSettings(store).data.personCalls, { 3: false },
      "a phone that has ticked somebody sends the tick");
  } finally { restore(); }
});

test("computeRecords: category rows ride the sync, order and parent included", () => {
  const st = baseState();
  st.productCategories = [
    { id: "cat_food", name: "Food", parentId: "", sort: 0 },
    { id: "cat_dog", name: "For Dog", nameZh: "狗粮", parentId: "", sort: 1 },
    { id: "cat_treats", name: "Treats", parentId: "cat_dog", sort: 0 },
  ];

  const rows = sync.computeRecords(st);
  const cats = rows.filter((r) => r.kind === "productCategories");
  assert.equal(cats.length, 3);
  assert.deepEqual(cats[0].data, { id: "cat_food", name: "Food", parentId: "", sort: 0 });
  assert.deepEqual(cats[1].data, { id: "cat_dog", name: "For Dog", nameZh: "狗粮", parentId: "", sort: 1 });
  // The order is a stored number and the nesting is a stored id, because a
  // record's PLACE IN THE ARRAY does not travel — the cloud carries whole rows
  // keyed by id. A category that arrives without its sort would land wherever.
  assert.deepEqual(cats[2].data, { id: "cat_treats", name: "Treats", parentId: "cat_dog", sort: 0 });
});

test("mergeRows: a category built on one phone appears on the phone that had none", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.productCategories = []; // this phone has not built the tree yet
    seedJournal(store);

    const add = sync.mergeRows(st, [cloudRow("productCategories", "cat_food",
      { id: "cat_food", name: "Food", parentId: "", sort: 0 }, "2026-09-28T00:00:00.000Z")]);
    assert.equal(add.changed, true);
    assert.equal(st.productCategories.length, 1);
    assert.equal(st.productCategories[0].name, "Food");

    const del = sync.mergeRows(st, [cloudRow("productCategories", "cat_food", null, "2026-09-28T01:00:00.000Z", true)]);
    assert.equal(del.changed, true);
    assert.equal(st.productCategories.length, 0, "and a heading deleted on the other phone goes here too");
  } finally { restore(); }
});

test("mergeRows: a category newly saved on this phone is queued to be pushed", () => {
  const { store, restore } = installStorage();
  try {
    const st = baseState();
    st.productCategories = [{ id: "cat_food", name: "Food", parentId: "", sort: 0 }];
    seedJournal(store);
    const r = sync.markDirty(st, "2026-09-28T00:00:00.000Z");
    assert.equal(r.pending["productCategories:cat_food"]._deleted, false);
    assert.equal(r.pending["productCategories:cat_food"].data.name, "Food");
  } finally { restore(); }
});

// ── v467: one un-keyable record must not poison the whole batch ──────────────
test("★★★ flush: every row it sends has the SAME KEYS — the fault that stopped every device syncing", async () => {
  // ⚠️⚠️ THE FAULT, EXACTLY AS THE SERVER REPORTED IT ON HER OWN SCREEN:
  //   `Sync failed: Push failed (HTTP 400) — {"code":"PGRST102","message":"All object keys must match"}`
  // ⭐ **`JSON.stringify` DROPS a key whose value is `undefined`** — so ONE record with no id went out as
  // `{kind, data, _deleted, updated_at}`: **four keys where every other object in the same array had FIVE.**
  // ⚠️ **PostgREST refuses the WHOLE BATCH for that one object** — and because the journal had already
  // recorded every one of them as handed over, **nothing was ever offered again.**
  // ⭐ MEASURED ON HER SCREEN: **21 changes stuck, 11 records not in the shared data, and every other
  // device blind to all of it.** ⭐ And an order with no id is not an invented fixture — **her book really
  // contains them** (v440's lesson, which is why the shelf had to use `.filter(Boolean)`).
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ productId: "p1", qty: 2 }, { id: "o2", productId: "p1", qty: 1 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    let captured = null;
    const restoreFetch = installFetch(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, text: async () => "" };
    });
    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, true, "the push itself failed, so nothing below proves anything");

      const body = JSON.parse(captured.opts.body);
      assert.ok(body.length, "nothing was sent at all, so nothing below proves anything");

      // ⭐⭐ THE RULE THE SERVER ENFORCES, ASSERTED HERE. ⚠️ It is checked on the PARSED body precisely
      // because a key `JSON.stringify` dropped is simply ABSENT once parsed — which is the whole fault.
      const first = JSON.stringify(Object.keys(body[0]));
      for (const row of body) {
        assert.equal(JSON.stringify(Object.keys(row)), first,
          `★ a row was sent with different keys (${JSON.stringify(Object.keys(row))} against ${first}) — `
          + "PostgREST refuses the WHOLE BATCH for one of them, and that is what stopped every device syncing");
      }
      assert.equal(body.some((row) => typeof row.id !== "string" || !row.id), false,
        "★ a record that cannot be keyed was sent anyway — it can never land, and it poisons the rest");
      // ⚠️ AND THE GOOD RECORD BESIDE IT STILL GOES: one bad record must not cost her the other twenty.
      assert.ok(body.some((row) => row.id === "o2"),
        "★ the good order was dropped from the batch along with the bad one");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ── v528: a refused batch must never hold her good records hostage ───────────
//
// ⚠️⚠️ HER REPORT: __"more and more removed order shown on phone"__ — ⭐ **the queue only GREW.** Every
// removal she made queued a change, the server refused the batch, and because a refusal sends nothing,
// **every change queued beside the bad one was frozen with it — for ever, however many times she pressed
// Sync now.** ⭐ **Measured: 3, then 8, and climbing (seven removed orders and a unit).**
test("★★★ flush: a batch the server refuses is re-offered ONE RECORD AT A TIME, so the good ones go up", async () => {
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [
      { id: "o1", productId: "p1", qty: 1 },
      { id: "o2", productId: "p1", qty: 2 },
      { id: "o3", productId: "p1", qty: 3 },
    ];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    const batches = [];
    const restoreFetch = installFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      batches.push(body.map((r) => r.id));
      // ⚠️ EXACTLY AS POSTGREST BEHAVES: one object it will not take refuses the WHOLE batch, and the
      // others in it are never written. That is the mechanism, not a stand-in for it.
      if (body.some((r) => r.id === "o2")) return { ok: false, status: 400, text: async () => '{"code":"PGRST102"}' };
      return { ok: true, text: async () => "" };
    });
    try {
      const r = await sync.flush(st);
      assert.ok(batches[0].length > 1, "precondition: the first attempt is not a batch");
      // ⭐⭐ THE WHOLE OF IT: after a refusal, each record is offered on its own.
      assert.ok(batches.length > 1, "★ a refused batch was NOT re-offered record by record — **so one "
        + "record the server will not take freezes every change queued beside it, for ever**");
      assert.equal(r.refusedKey, "orders:o2", "★ the refused record is not named, so it cannot be shown");

      const b = JSON.parse(store.get("bakeadmin.sync"));
      assert.equal(!!b.pending["orders:o1"], false, "★ a good record was left frozen by the refused one");
      assert.equal(!!b.pending["orders:o3"], false, "★ a good record was left frozen by the refused one");
      assert.ok(b.pending["orders:o2"], "★ the refused record was cleared anyway — **that is the lie that "
        + "made 'there is no error' and 'the number never moves' both true, on the same phone**");
      // ⭐ AND IT IS NOT REPORTED AS A CLEAN SYNC: seven of her eight changes going up is a different
      // sentence from "synced", and the one that was refused has to be said out loud.
      assert.equal(r.ok, false, "a refused record was reported as a clean hand-over");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("★★★ flush: every row keeps the SAME FIVE KEYS even if a queued record lost one", async () => {
  // ⚠️⚠️ **THE v467 FAULT AS A CLASS, NOT AS A FIELD.** v467 found that one object with a different key set
  // makes PostgREST refuse the whole batch, and it fixed the one field that had produced it — an `id` that
  // was `undefined`. ⭐ **But the filter above that fix only checks `kind` and `id`**, so a queued record
  // whose `_deleted` or `updated_at` is missing (a hand-edited or corrupted journal, a shape from another
  // version) is STILL sent, still loses a key, and still freezes everything beside it.
  // ⭐ **Measured before this was written:** that record serialises to `data,id,kind,updated_at` — four keys
  // where every good one has five — and it passes the sendable filter.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 1 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");
    // ⚠️ Put a shape in the queue that the app itself would never write, the way a corrupted journal would.
    const b = JSON.parse(store.get("bakeadmin.sync"));
    b.pending["uoms:uom_g"] = { kind: "uoms", id: "uom_g", data: { id: "uom_g", name: "g" } };
    store.set("bakeadmin.sync", JSON.stringify(b));

    let captured = null;
    const restoreFetch = installFetch(async (url, opts) => {
      captured = { url, opts };
      return { ok: true, text: async () => "" };
    });
    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, true, "the push itself failed, so nothing below proves anything");
      const body = JSON.parse(captured.opts.body);
      const first = JSON.stringify(Object.keys(body[0]));
      for (const row of body) {
        assert.equal(JSON.stringify(Object.keys(row)), first,
          `★ a row went out with ${JSON.stringify(Object.keys(row))} against ${first} — **PostgREST refuses `
          + "the WHOLE batch for one of them, and that is the fault that stopped every device syncing**");
      }
      // ⭐ AND IT IS REPAIRED, NOT DROPPED — the difference from v467. This record is sendable, so throwing
      // it away would lose her change; the queue timestamp is the honest fallback for a missing one.
      assert.ok(body.some((row) => row.id === "uom_g"),
        "★ the odd-shaped record was dropped instead of repaired — **that throws her change away to save a "
        + "batch it did not have to poison**");
      assert.equal(JSON.parse(store.get("bakeadmin.sync")).pending["uoms:uom_g"], undefined,
        "★ the repaired record was sent but never taken off the queue");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

test("★★ the reason a hand-over did not complete is KEPT, and cleared by the next clean one (v528)", async () => {
  // ⚠️⚠️ **THE APP COULD COUNT THE STUCK CHANGES AND NAME THEM, AND COULD NOT SAY WHY.** `refresh` handed
  // the reason to whichever button pressed it and then forgot it, so the card said "Sync failed: …" for as
  // long as it took her to read, and no other screen ever knew. ⭐ And a stale reason is worse than none.
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ id: "o1", productId: "p1", qty: 1 }];
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    const bad = installFetch(async (url, opts) => {
      if (opts && opts.method === "POST") return { ok: false, status: 400, text: async () => '{"code":"PGRST102"}' };
      return { ok: true, json: async () => [], text: async () => "" };
    });
    try {
      const r = await sync.refresh(st);
      assert.equal(r.ok, false, "precondition: the hand-over did not fail, so nothing below proves anything");
      const f = sync.lastFailure();
      assert.ok(f, "★ the reason was thrown away — **so nothing on any screen can say why the queue will not empty**");
      assert.match(String(f.reason), /PGRST102|400/, "the reason does not carry what the server said");
      assert.equal(f.phase, "hand-over", "★ a refused WRITE and a failed READ are not distinguished");
      assert.equal(f.key, "orders:o1", "★ which record was refused is not kept, so it cannot be named");
    } finally { bad(); }

    const good = installFetch(async (url, opts) => (
      opts && opts.method === "POST" ? { ok: true, text: async () => "" } : { ok: true, json: async () => [], text: async () => "" }
    ));
    try {
      await sync.refresh(st);
      assert.equal(sync.lastFailure(), null,
        "★ a reason survived a clean hand-over — **a stale reason sends her looking for a fault that has gone**");
    } finally { good(); }
  } finally { restore(); }
});

// ── v475: a queue holding ONLY an un-sendable record ─────────────────────────
test("★★★ flush: a queue holding only a record that can never be sent is swept, and still reports ok", async () => {
  // ⚠️⚠️ HER REPORT, IN TWO LINES: __"after sync now, the phone still say 1 changes waiting to be send"__
  // — and, asked what the shared-data card said, __"there is no error under sync"__.
  // ⭐⭐ **NO ERROR AND A COUNT THAT NEVER MOVES. That is this condition exactly.**
  // ⚠️⚠️ THE v467 SWEEP SAT *AFTER* THE POST — so it only ever ran when there was something to post. **When
  // the ONLY thing queued was the record that cannot be keyed, `sendable` came out empty, `flush` returned
  // "ok", and the queue was never swept.** The record sat there for ever, on her phone, while the app told
  // her everything was fine. ⭐ **"It says ok" and "it is done" are two different sentences.**
  const { store, restore } = installStorage();
  try {
    const st = cloudOn(baseState());
    st.orders = [{ productId: "p1", qty: 2 }];   // ⚠️ NO ID — a shape her book really contains (v440)
    seedToken(store);
    sync.markDirty(st, "2026-01-01T00:00:00.000Z");

    // ⭐⭐ AND THE FRONT DOOR NOW REPAIRS IT (v519) — ⚠️ **this is the class fix, and it is why the state below
    // can no longer be reached the ordinary way.** An id-less record is given a stable id derived from its
    // own content BEFORE it is ever queued.
    assert.equal(typeof st.orders[0].id, "string", "markDirty queued a record with no id");
    assert.ok(st.orders[0].id, "markDirty gave it an empty id");

    // ⚠️ SO THE UN-KEYABLE RECORD IS PUT INTO THE QUEUE **DIRECTLY** — ⭐ **the sweep is still the LAST LINE
    // of defence**: a queue written by an older build, or by anything that does not come through `markDirty`,
    // must still empty itself and still report ok. ⚠️ Without this the fixture would leave nothing queued and
    // this test would pass for the wrong reason.
    const b = JSON.parse(store.get("bakeadmin.sync"));
    b.pending = { "orders:undefined": { kind: "orders", id: undefined,
      updated_at: "2026-01-01T00:00:00.000Z", data: { productId: "p1", qty: 2 }, _deleted: false } };
    store.set("bakeadmin.sync", JSON.stringify(b));
    assert.equal(sync.pendingCount(), 1, "the fixture did not leave exactly one queued record");

    let posted = null;
    const restoreFetch = installFetch(async (url, opts) => {
      if (opts && opts.method === "POST") posted = JSON.parse(opts.body);
      return { ok: true, text: async () => "" };
    });
    try {
      const r = await sync.flush(st);
      assert.equal(r.ok, true, "flush did not report ok, so her no-error half is not being reproduced");
      assert.equal(sync.pendingCount(), 0,
        "★ the record that can never be sent was left in the queue — the count she watched that never moved");
      assert.ok(!posted || posted.every((row) => typeof row.id === "string" && row.id),
        "★ a record that cannot be keyed was posted anyway, which poisons the whole batch");
    } finally { restoreFetch(); }
  } finally { restore(); }
});

// ★★★ THE BREAD SHE BAKED THAT NOBODY ORDERED (v514). ⚠️⚠️ **THIS IS THE TEST FOR A FAULT SHE FOUND, NOT
// ONE I IMAGINED:** __"and my phone and my mac not sync"__ — and she was right. ⭐ **A list left out of
// `LISTS` is silently device-local**, and ⚠️ **the first version of this feature was worse than that: it
// kept the record inside `settings`, whose payload is a HAND-WRITTEN WHITELIST — so the key left the phone
// and went nowhere at all, while a comment at the top of sync.js said a new field there "needs no
// registration".** ⭐ **That comment is about `LISTS`. A comment is not the producer: read `recordPayload`.**
test("computeRecords: production rows ride the sync, and are NOT buried in settings (v514)", () => {
  const st = baseState();
  st.bakedDays = [
    { id: "bake_2026-10-20", date: "2026-10-20", items: { p_foc: { total: 4, applied: 4 } } },
  ];

  const rows = sync.computeRecords(st);
  const production = rows.filter((r) => r.kind === "bakedDays");
  assert.equal(production.length, 1,
    "★ a day she recorded as baked never reaches her other phone — **she would key a total into one device "
    + "and the shelf on the other would not move**");
  assert.deepEqual(production[0].data,
    { id: "bake_2026-10-20", date: "2026-10-20", items: { p_foc: { total: 4, applied: 4 } } },
    "the row goes whole — no field whitelist to fall out of date");
  // ⚠️ AND NOT INSIDE SETTINGS: ⭐ **settings is ONE row replaced whole on push**, so two phones both
  // holding production records would overwrite each other's — the fault v444 already paid for once.
  const settingsRow = rows.find((r) => r.kind === "settings");
  assert.equal("baked" in settingsRow.data, false,
    "production is back inside the settings payload — one row, replaced whole, so her phone and her Mac "
    + "would overwrite each other's days");

  // ⚠️⚠️ AND THE OTHER HALF, WHICH IS EASY TO MISS AND SILENT WHEN MISSED: the PULL restores a row only
  // when `LISTS[row.kind]` names a field **and `Array.isArray(state[field])`**. ⭐ **A missing default means
  // the row arrives from the cloud and is skipped without a word** — so the list must exist on a fresh
  // install too, not only on a phone that has just recorded something.
  assert.ok(Array.isArray(defaultState().bakedDays),
    "★ a fresh install has no `bakedDays` array — **the cloud's rows would arrive and be dropped in "
    + "silence**, which looks exactly like sync working");
});

// ★★★★ A RECORD WITH NO ID CAN NEVER REACH HER OTHER PHONE (v518).
//
// ⚠️⚠️ THIS IS THE FAULT BEHIND __"different device not sync"__, AND IT TOOK TWO SCREENS TO SEE WHOLE:
//   · the System check tells her to **Mark as void** a receipt that has no order behind it, and it says the
//     line will clear;
//   · she did it on the Mac, and the record was written **with no `id`**;
//   · ⭐ **a record that cannot be keyed cannot travel** — `flush` excludes it and the sweep drops it;
//   · ⭐ **so the PHONE never learns the receipt was voided and keeps showing the same error, for ever**,
//     telling her to press a button she has already pressed.
// ⚠️ The app already knew this shape — the waiting check even names *"an order with no number"* — ⭐ **but it
// knew it for `orders`, and this one was in `voidedReceipts`.**
test("★★★ a record with no id cannot be sent — and a void record now always has one (v518)", () => {
  const st = baseState();

  // ⭐ THE INVARIANT: a record with a real id is put in the payload like any other.
  st.voidedReceipts = [{ id: "void_15", no: 15, code: "4B00A9", at: "2026-10-12T10:00:00.000Z", reason: "removed myself" }];
  const rows = sync.computeRecords(st).filter((r) => r.kind === "voidedReceipts");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "void_15",
    "★ the void record has no usable id — **it can never be keyed, so it is dropped from the queue and her "
    + "other phone never hears about it**");

  // ⭐⭐ AND THE RECORD THE BUTTON ACTUALLY MAKES IS THE ONE THAT HAS TO CARRY IT — ⚠️ **tested through the
  // function that builds it, not by reading the source**, because a source assertion would go on passing
  // after the button stopped using it.
  const made = stateMod.newVoidRecord(15, "4B00A9", "removed myself");
  assert.equal(made.id, "void_15",
    "★ the record the Mark-as-void button makes has no usable id — **it can never be keyed, so the queue "
    + "drops it and her other phone never hears about the receipt**");
  assert.equal(made.no, 15, "and it must still carry the receipt number the check reads");
  assert.equal(made.reason, "removed myself", "and her own reason");
});

// ⭐ AND A RECORD ALREADY STRANDED ON A PHONE IS GIVEN ONE, so it can finally travel (v518).
test("★★★ a void record already on a phone is repaired on load, by the same id the button writes (v518)", () => {
  const { loadState } = stateMod;
  installStorage();
  // ⚠️ The shape an older build wrote — no id at all.
  localStorage.setItem("bakeadmin.v1", JSON.stringify({
    version: 1, settings: { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" },
    orders: [], voidedReceipts: [{ no: 15, code: "4B00A9", at: "2026-10-12T10:00:00.000Z", reason: "removed myself" }],
  }));
  const st = loadState();
  assert.equal(st.voidedReceipts[0].id, "void_15",
    "★ a receipt she has ALREADY marked void is still stranded — **her other phone will keep reporting a "
    + "receipt with no order behind it and keep telling her to press the button she has already pressed**");
  assert.equal(st.voidedReceipts[0].no, 15, "…and the repair must not lose what the record said");
  assert.equal(st.voidedReceipts[0].reason, "removed myself", "…nor her own reason for it");
});

// ★★★★ THE SWEEP OVER EVERY LIST (v519).
//
// ⚠️⚠️ WHY THIS EXISTS AND WHY IT IS A SWEEP: **the same fault has now bitten TWICE** — an ORDER with no
// number, and a receipt marked VOID with no id — ⭐ **and both times the app knew the shape but checked ONE
// list.** ⭐⭐ **A check keyed to one word checks one word, and a fix keyed to one list fixes one list.**
// ⚠️ So this walks the app's OWN synced vocabulary (`computeRecords`, the same function the sync uses) and
// proves that **a record with no id is repaired in EVERY list**, including lists that do not exist yet.
test("★★★★ EVERY synced list repairs a record with no id — the class, not one list (v519)", () => {
  const st = defaultState();
  // ⚠️ READ FROM THE SYNC'S OWN LIST, never a copy typed here — see `syncedKinds`.
  const kinds = sync.syncedKinds();
  assert.ok(kinds.length > 15,
    `expected the app's whole synced vocabulary, got ${kinds.length} — **a list that is not in this sweep is `
    + "a list this test is not watching**");

  // ⚠️ ONE UN-KEYABLE RECORD IN EVERY LIST — not one list chosen by hand.
  const broken = kinds.filter((k) => Array.isArray(st[k]) && st[k].push({ something: "with no id at all" }));
  assert.ok(broken.length > 10, `expected the app's lists to be reachable by name, got ${broken.length}`);

  const fixed = sync.repairRecordIds(st);
  assert.equal(fixed.length, broken.length,
    `★ ${broken.length - fixed.length} list(s) still hold a record that cannot travel — **it would be dropped `
    + "from the send queue and her other phone would never hear about it**");

  for (const kind of broken) {
    const rec = st[kind][st[kind].length - 1];
    assert.equal(typeof rec.id === "string" && rec.id.length > 0, true,
      `★ a record in \`${kind}\` has no usable id after the repair`);
  }

  // ⭐⭐ AND THE ID IS THE SAME ON BOTH PHONES, or the same record becomes two rows — the id is derived from
  // the record's own content, with its keys sorted, so two devices holding it agree.
  const a = defaultState(); a.orders.push({ qty: 2, note: "same" });
  const b = defaultState(); b.orders.push({ note: "same", qty: 2 });   // ⚠️ keys in a different ORDER
  sync.repairRecordIds(a);
  sync.repairRecordIds(b);
  assert.equal(a.orders[a.orders.length - 1].id, b.orders[b.orders.length - 1].id,
    "★ the same record repaired on two phones came out with TWO different ids — **that is two rows in her "
    + "shared data for one record, which is worse than the fault it repairs**");

  // ⚠️ AND A RECORD THAT ALREADY HAS AN ID IS NEVER TOUCHED — a repair that renames good records would
  // orphan every one of them.
  const c = defaultState(); c.orders.push({ id: "keep_me", qty: 1 });
  sync.repairRecordIds(c);
  assert.equal(c.orders[c.orders.length - 1].id, "keep_me", "the repair renamed a record that already had an id");
});

// ── ★★★ HOW MANY ROWS THE SHARED DATA HOLDS (17 October 2026) ──────────────
// ⚠️ THE PULL IS ONE CAPPED REQUEST with no paging: past `PULL_LIMIT` rows a phone sees only the first
// slice, and a record she expects everywhere can be outside it. This count is the warning, so it must
// count EVERY row — a tombstone is a row in the same table and takes the same place in that slice.
test("★★ cloudRowCount counts every row, and says 'at least' rather than guessing past its scan", async () => {
  const { store, restore } = installStorage();
  try {
    seedToken(store);
    const st = cloudOn(baseState());
    let asked = null;
    const restoreFetch = installFetch(async (url) => {
      asked = url;
      return { ok: true, json: async () => Array.from({ length: 7 }, () => ({ kind: "orders" })) };
    });
    try {
      const r = await sync.cloudRowCount(st);
      assert.deepEqual(r, { ok: true, count: 7, atLeast: false });
      assert.ok(asked.includes("select=kind"), `the count asked for more than it needs: ${asked}`);
      assert.ok(asked.includes("order=kind"), "★ the count read an UNORDERED slice — offset paging can skip rows without one");
      assert.ok(asked.includes(`limit=${sync.PULL_PAGE}`), asked);
      assert.ok(asked.includes("offset=0"), asked);
    } finally { restoreFetch(); }

    // ⭐ AND WHEN THE READ NEVER COMES SHORT it hits its own hard stop and SAYS SO rather than pretending —
    // the one place a record can still fail to arrive, so the count must not round it off silently.
    let pages = 0;
    const restoreFetch2 = installFetch(async () => {
      pages += 1;
      return { ok: true, json: async () => Array.from({ length: sync.PULL_PAGE }, () => ({ kind: "orders" })) };
    });
    try {
      const r2 = await sync.cloudRowCount(st);
      assert.equal(r2.ok, true);
      assert.equal(r2.count, sync.PULL_CEILING, `the scan read ${r2.count}`);
      assert.equal(r2.atLeast, true, "★ a scan that hit its hard stop reported an exact number");
      assert.equal(pages, sync.PULL_MAX_PAGES, "the loop did not stop where it says it stops");
    } finally { restoreFetch2(); }
  } finally { restore(); }
});

// ── ★★★ THE PULL READS EVERY PAGE (17 October 2026) ────────────────────────
// ⚠️⚠️ THIS IS THE TEST THE ORIGINAL FAULT WOULD HAVE FAILED. The pull was ONE request with
// `limit=1000` — a CAP — so past a thousand rows a phone never saw the rest, and nothing said so.
// ⭐ **A book bigger than one page must arrive WHOLE.** If this ever goes red, the app is silently blind
// again to everything past the first page.
test("★★★ the pull reads EVERY page — a book larger than one page arrives whole", async () => {
  const { store, restore } = installStorage();
  try {
    seedToken(store);
    const st = cloudOn(baseState());
    st.products = [];
    const TOTAL = 2500;
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      kind: "products",
      id: `p${String(i).padStart(5, "0")}`,
      data: JSON.stringify({ id: `p${String(i).padStart(5, "0")}`, name: `P${i}`, price: 1 }),
      updated_at: "2026-01-01T00:00:00.000Z",
      _deleted: false,
    }));
    const offsets = [];
    const restoreFetch = installFetch(async (url) => {
      const m = /offset=(\d+)/.exec(url);
      const off = m ? Number(m[1]) : 0;
      offsets.push(off);
      return { ok: true, json: async () => all.slice(off, off + sync.PULL_PAGE) };
    });
    try {
      const r = await sync.pull(st);
      assert.equal(r.ok, true, `the pull failed: ${r.reason}`);
      assert.equal(st.products.length, TOTAL,
        `★ only ${st.products.length} of ${TOTAL} records arrived — the pull stopped at a page`);
      assert.deepEqual(offsets, [0, sync.PULL_PAGE, sync.PULL_PAGE * 2],
        "★ the pull did not walk the pages in order");
    } finally { restoreFetch(); }
  } finally { restore(); }
});
