// test/sync.test.js — unit tests for the shared-data sync engine.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../admin/js/sync.js";

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
