// test/backups.test.js — cloud backup cadence, snapshot/restore and network.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as backups from "../admin/js/backups.js";
import { normalize, LS_KEY } from "../admin/js/state.js";
import { todayISO } from "../admin/js/dates.js";
import { parseImport } from "../admin/js/validate.js";

const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;

// ── test helpers ──────────────────────────────────────────────────────────

// A local-time ISO instant (created_at timestamps are UTC; every date rule
// below must hold regardless of the machine's timezone).
function isoOf(date, hh = 12, mm = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0).toISOString();
}

// The next date matching a predicate from a 2026 anchor (bounded).
function findDate(pred) {
  const d = new Date(2026, 0, 1);
  for (let i = 0; i < 1200; i++) {
    if (pred(d)) return d;
    d.setDate(d.getDate() + 1);
  }
  throw new Error("no matching date found");
}

function cloudState() {
  return {
    version: 1,
    settings: {
      defaultCapacity: 12,
      deliveryDays: [1, 3, 5],
      cutoff: "18:00",
      currency: "RM",
      supabase: { enabled: true, url: "https://x.supabase.co", anonKey: "anon",
        email: "baker@example.com", password: "pw" },
      cloud: { enabled: true },
      lock: { enabled: true, pinHash: "hash" },
      storefront: { name: "Munchies Furkidz", whatsapp: "60123456789", products: [] },
    },
    ingredients: [{ id: "i1", name: "Chicken Breast", unit: "g" }],
    suppliers: [],
    uoms: [],
    products: [{ id: "p1", name: "Chicken Jerky", price: 24, unit: "pouch" }],
    deliveryDates: [],
    orders: [{ id: "o1", productId: "p1", qty: 2, deliveryDateId: "d1", status: "new" }],
    purchaseOrders: [],
    credits: [],
    occasions: [],
  };
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

function jsonRes(body, status = 200) {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function seedToken(store, token = "tok_abc") {
  store.set("bakeadmin.supabase", JSON.stringify({
    access_token: token,
    expires_at: Date.now() + 3600000,
  }));
}

// ── snapshot / summary ────────────────────────────────────────────────────

test("snapshotState strips exactly supabase/cloud/lock and leaves the source intact", () => {
  const state = cloudState();
  const snap = backups.snapshotState(state);
  assert.equal(snap.settings.supabase, undefined);
  assert.equal(snap.settings.cloud, undefined);
  assert.equal(snap.settings.lock, undefined);
  assert.equal(snap.settings.storefront.name, "Munchies Furkidz");
  assert.deepEqual(snap.products, state.products);
  assert.deepEqual(snap.orders, state.orders);
  // The source is untouched — the copy is a deep clone, the creds stay local.
  assert.equal(state.settings.supabase.email, "baker@example.com");
  assert.equal(state.settings.supabase.password, "pw");
  assert.equal(state.settings.lock.pinHash, "hash");
});

test("summaryOf counts orders, products and ingredients", () => {
  const data = { orders: [1, 2], products: [1, 2, 3], ingredients: [1, 2, 3, 4] };
  assert.equal(backups.summaryOf(data), "2 orders · 3 products · 4 ingredients");
});

// ── date keys / cadence ───────────────────────────────────────────────────

test("dateKey/weekKey/monthKey read instants in local time", () => {
  const d = new Date(2026, 8, 7, 9, 30, 0); // 7 Sep 2026, local
  assert.equal(backups.dateKey(d.toISOString()), "2026-09-07");
  assert.equal(backups.monthKey(d.toISOString()), "2026-09");
  // weekKey is the Monday on or before that day — structurally a Monday, no
  // later than d, within six days of it.
  const wk = new Date(backups.weekKey(d.toISOString()) + "T00:00:00");
  assert.equal(wk.getDay(), 1);
  assert.ok(wk <= new Date(2026, 8, 7));
  assert.ok(new Date(2026, 8, 7).getTime() - wk.getTime() < 7 * 86400000);
  // A Saturday shares its week with the Monday that started it (7 Sep 2026) but
  // not with the Monday that follows it (14 Sep 2026).
  const sat = new Date(2026, 8, 12); // Saturday
  assert.equal(backups.weekKey(sat.toISOString()), "2026-09-07");
  assert.equal(backups.weekKey(new Date(2026, 8, 14).toISOString()), "2026-09-14");
});

test("dueKinds: a Monday that is the 1st with no copies is due for all three", () => {
  const d = findDate((x) => x.getDay() === 1 && x.getDate() === 1);
  assert.deepEqual(backups.dueKinds([], d), ["daily", "weekly", "monthly"]);
});

test("dueKinds: a plain Monday is due daily + weekly only", () => {
  const d = findDate((x) => x.getDay() === 1 && x.getDate() !== 1);
  assert.deepEqual(backups.dueKinds([], d), ["daily", "weekly"]);
});

test("dueKinds: the 1st on a non-Monday is due daily + monthly only", () => {
  const d = findDate((x) => x.getDate() === 1 && x.getDay() !== 1);
  assert.deepEqual(backups.dueKinds([], d), ["daily", "monthly"]);
});

test("dueKinds: a plain weekday is due daily only", () => {
  const d = findDate((x) => x.getDay() !== 1 && x.getDate() !== 1);
  assert.deepEqual(backups.dueKinds([], d), ["daily"]);
});

test("dueKinds: a same-day / same-week / same-month copy suppresses that kind", () => {
  const d = findDate((x) => x.getDay() === 1 && x.getDate() === 1);
  const rows = [
    { kind: "daily", created_at: isoOf(d) },
    { kind: "weekly", created_at: isoOf(d) },
    { kind: "monthly", created_at: isoOf(d) },
  ];
  assert.deepEqual(backups.dueKinds(rows, d), []);
  // A daily from yesterday does not satisfy today's daily copy.
  const yesterday = new Date(d);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.deepEqual(
    backups.dueKinds([{ kind: "daily", created_at: isoOf(yesterday, 22, 0) }], d),
    ["daily", "weekly", "monthly"]);
});

test("pruneIds keeps newest 7 daily / 4 weekly / 3 monthly, never manual", () => {
  const rows = [];
  let n = 0;
  const add = (kind, date) => rows.push({ id: ++n, kind, created_at: date.toISOString() });
  for (let i = 1; i <= 10; i++) add("daily", new Date(2026, 0, i)); // 10 dailies
  for (let i = 0; i < 5; i++) add("weekly", new Date(2026, 0, 5 + i * 7)); // 5 weeklies
  for (let i = 0; i < 4; i++) add("monthly", new Date(2026, i, 1)); // 4 monthlies
  for (let i = 0; i < 3; i++) add("manual", new Date(2026, i, 15)); // 3 manual

  const kill = backups.pruneIds(rows);
  const expected = new Set([1, 2, 3, 11, 16]); // oldest 3 daily (1–3), oldest weekly (11), oldest monthly (16)
  assert.equal(kill.length, expected.size);
  for (const id of kill) {
    assert.ok(expected.has(id), `unexpected prune id ${id}`);
    expected.delete(id);
  }
  assert.equal(expected.size, 0);
});

// ── naming / download envelope / restore merge ────────────────────────────

test("backupFileName is date + kind with the brand prefix", () => {
  assert.equal(backups.backupFileName("2026-09-08", "daily"), "furkidz-backup-2026-09-08-daily.json");
  assert.equal(backups.backupFileName("2026-09-08", "manual"), "furkidz-backup-2026-09-08-manual.json");
});

test("exportEnvelope wraps a copy so a downloaded file re-imports via parseImport", () => {
  const data = backups.snapshotState(cloudState());
  const row = { kind: "daily", created_at: "2026-09-08T12:00:00.000Z", engine: "63", data: JSON.stringify(data) };
  const env = backups.exportEnvelope(row);
  assert.equal(env.app, "furkidz");
  assert.equal(env.formatVersion, 1);
  assert.equal(env.exportedAt, row.created_at);
  assert.equal(env.engine, "63");
  const imported = parseImport(JSON.stringify(env));
  assert.deepEqual(imported, normalize(data));
  assert.equal(imported.settings.supabase.email, ""); // creds never in the cloud copy
});

test("mergeRestore takes the copy's data but keeps this phone's sign-in, cloud switch and lock", () => {
  const snap = backups.snapshotState(cloudState()); // no device settings inside
  const live = cloudState();
  live.settings.supabase = { enabled: true, url: "https://y.supabase.co", anonKey: "anon2",
    email: "a@b.com", password: "keep-me" };
  live.settings.cloud = { enabled: true };
  live.settings.lock = { enabled: true, pinHash: "keep-hash" };
  live.products = [{ id: "p-live", name: "Something newer", unit: "pouch" }]; // will be replaced
  live.orders = [];

  const merged = backups.mergeRestore(live, snap);
  assert.deepEqual(merged.settings.supabase, live.settings.supabase);
  assert.deepEqual(merged.settings.cloud, live.settings.cloud);
  assert.deepEqual(merged.settings.lock, live.settings.lock);
  assert.deepEqual(merged.products, snap.products);
  assert.deepEqual(merged.orders, snap.orders);
  assert.equal(merged.settings.storefront.name, "Munchies Furkidz");
  assert.equal(merged.version, 1);
});

// ── network: backupNow / maybeAutoBackup / prune / delete ────────────────

test("backupNow posts one manual copy without the per-device settings", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  let seen = null;
  const restoreFetch = installFetch(async (url, opts) => {
    assert.equal(url, "https://x.supabase.co/rest/v1/backup_snapshots");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.apikey, "anon");
    assert.ok(String(opts.headers.Authorization).startsWith("Bearer tok_abc"));
    assert.equal(opts.headers.Prefer, "return=minimal");
    seen = JSON.parse(opts.body)[0];
    return jsonRes({});
  });
  try {
    const r = await backups.backupNow(cloudState());
    assert.equal(r.ok, true);
    assert.equal(seen.kind, "manual");
    assert.ok(seen.label.startsWith("Manual · "));
    assert.equal(seen.engine, "63");
    assert.equal(seen.summary, "1 orders · 1 products · 1 ingredients");
    const data = JSON.parse(seen.data);
    assert.equal(data.settings.supabase, undefined);
    assert.equal(data.settings.cloud, undefined);
    assert.equal(data.settings.lock, undefined);
    assert.equal(data.products[0].name, "Chicken Jerky");
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("maybeAutoBackup skips when the same-day guard is already set", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  ls.store.set("bakeadmin.backup.guard", todayISO());
  let called = false;
  const restoreFetch = installFetch(async () => { called = true; return jsonRes({}); });
  try {
    const r = await backups.maybeAutoBackup(cloudState());
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(called, false); // no network at all
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("maybeAutoBackup records the attempt day even when offline, silently", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const restoreFetch = installFetch(async () => { throw new Error("offline"); });
  try {
    const r = await backups.maybeAutoBackup(cloudState());
    assert.equal(r.ok, true); // failures are silent
    assert.equal(r.skipped, "offline");
    assert.equal(ls.store.get("bakeadmin.backup.guard"), todayISO()); // no retry loop today
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("maybeAutoBackup posts each due kind and sets the day guard", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const metaRows = []; // nothing saved yet — every due kind fires
  const calls = [];
  const restoreFetch = installFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    calls.push({ url, method });
    if (method === "GET" && url.includes("/rest/v1/backup_snapshots")) return jsonRes(metaRows);
    if (method === "POST" && url.includes("/rest/v1/backup_snapshots")) return jsonRes({});
    if (method === "DELETE") return jsonRes({});
    throw new Error(`unexpected request ${method} ${url}`);
  });
  try {
    const state = cloudState();
    const r = await backups.maybeAutoBackup(state);
    assert.equal(r.ok, true);
    assert.equal(ls.store.get("bakeadmin.backup.guard"), todayISO());
    const expected = backups.dueKinds(metaRows, new Date());
    assert.ok(expected.includes("daily")); // a daily copy is always due with none saved
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/rest/v1/backup_snapshots"));
    assert.equal(posts.length, expected.length);
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("maybeAutoBackup prunes the oldest daily once 8 dailies exist", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const state = cloudState();
  // 8 dailies from the past 8 days (none today, so one more is due); the
  // oldest carries the smallest id.
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (8 - i));
    rows.push({ id: 100 + i, kind: "daily", created_at: isoOf(d, 9) });
  }
  let deletes = [];
  const restoreFetch = installFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "GET" && url.includes("/rest/v1/backup_snapshots")) return jsonRes(rows);
    if (method === "POST" && url.includes("/rest/v1/backup_snapshots")) return jsonRes({});
    if (method === "DELETE") { deletes.push(url); return jsonRes({}); }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  try {
    const r = await backups.maybeAutoBackup(state);
    assert.equal(r.ok, true);
    assert.equal(deletes.length, 1);
    assert.ok(deletes[0].includes("id=in.(100)"), `expected oldest daily 100 pruned, got ${deletes[0]}`);
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("deleteSnapshots sends id=in.(...) and skips an empty list", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  let delUrl = null;
  const restoreFetch = installFetch(async (url, opts) => {
    delUrl = url;
    assert.equal(opts.method, "DELETE");
    return jsonRes({});
  });
  try {
    const r = await backups.deleteSnapshots(cloudState(), [11, 22]);
    assert.equal(r.ok, true);
    assert.ok(delUrl.includes("/rest/v1/backup_snapshots?id=in.(11,22)"));
    await backups.deleteSnapshots(cloudState(), []); // no-op, no fetch
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("getBackup fetches the one full copy by id", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const row = { id: 7, kind: "daily", label: "Daily · 8 Sep 2026", engine: "63",
    summary: "2 orders · 1 products · 1 ingredients", created_at: "2026-09-08T12:00:00.000Z",
    data: JSON.stringify(backups.snapshotState(cloudState())) };
  const restoreFetch = installFetch(async (url) => {
    assert.ok(url.includes("/rest/v1/backup_snapshots?select=data,kind,label,engine,summary,created_at&id=eq.7"));
    return jsonRes([row]);
  });
  try {
    const r = await backups.getBackup(cloudState(), 7);
    assert.equal(r.ok, true);
    assert.equal(r.row.id, 7);
    assert.equal(typeof r.row.data, "string");
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("restoreSnapshot saves a 'Before restore' copy then writes the merged state", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const state = cloudState();
  const snap = backups.snapshotState(state);
  const row = { id: 5, data: JSON.stringify(snap) };
  let safetyPost = null;
  const restoreFetch = installFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "GET" && url.includes("/rest/v1/bakery?")) return jsonRes([]); // sync pull
    if (method === "POST" && url.includes("/rest/v1/bakery?")) return jsonRes({}); // sync flush
    if (method === "POST" && url.endsWith("/rest/v1/backup_snapshots")) {
      safetyPost = JSON.parse(opts.body)[0];
      return jsonRes({});
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  try {
    const r = await backups.restoreSnapshot(state, row);
    assert.equal(r.ok, true);
    assert.equal(safetyPost.kind, "manual");
    assert.ok(safetyPost.label.startsWith("Before restore · "));
    const safetyData = JSON.parse(safetyPost.data);
    assert.equal(safetyData.settings.supabase, undefined); // safety copy is stripped too
    // The phone's localStorage now holds the merged restored state.
    const written = JSON.parse(ls.store.get(LS_KEY));
    assert.deepEqual(written, backups.mergeRestore(state, snap));
    assert.equal(written.settings.supabase.password, "pw"); // this phone stays signed in
  } finally {
    restoreFetch();
    ls.restore();
  }
});

test("restoreSnapshot refuses to restore when the freshen pull fails (offline)", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const row = { id: 5, data: "{}" };
  const restoreFetch = installFetch(async () => { throw new Error("offline"); });
  try {
    const r = await backups.restoreSnapshot(cloudState(), row);
    assert.equal(r.ok, false);
    assert.equal(ls.store.has(LS_KEY), false); // nothing written
  } finally {
    restoreFetch();
    ls.restore();
  }
});

// ── read-only View digest ─────────────────────────────────────────────────

test("snapshotViewData digests one copy into a human display", () => {
  const data = {
    settings: { currency: "RM", storefront: { name: "Munchies Furkidz" } },
    uoms: [], // normalize seeds the defaults, so g/pouch/etc. exist
    ingredients: [
      { id: "i1", name: "Chicken breast", unit: "g", onHand: 300, safetyBase: 500, active: true },
      { id: "i2", name: "Sweet potato", unit: "g", onHand: 1200, safetyBase: 200, active: true },
      { id: "i3", name: "Old spices", unit: "g", active: false }, // hidden + never stocked
    ],
    products: [
      { id: "p1", name: "Chicken Jerky", unit: "pouch", price: 24, active: true },
      { id: "p2", name: "Chicken Jerky Bundle", unit: "pack", price: "", active: true }, // no price set
      { id: "p3", name: "Retired recipe", unit: "piece", price: 6, active: false }, // hidden
    ],
    deliveryDates: [
      { id: "d1", date: "2026-09-08" },
      { id: "d2", date: "2026-09-10" },
    ],
    orders: [
      { id: "abcdefabcdef", productId: "p1", qty: 3, deliveryDateId: "d1",
        customerName: "Aunty Bee", status: "ready", createdAt: "2026-09-08T01:00:00.000Z" },
      { id: "0123456789ab", productId: "p-gone", qty: 2, deliveryDateId: "d1",
        customerName: "", status: "new", createdAt: "2026-09-08T02:00:00.000Z" },
      { id: "fedcba098765", productId: "p3", qty: 1, deliveryDateId: "d1",
        customerName: "Mr Lim", status: "delivered", fulfillment: "courier", createdAt: "2026-09-08T03:00:00.000Z" },
      { id: "111111222222", productId: "p1", qty: 1, deliveryDateId: "d-missing",
        customerName: "", status: "baking" }, // its delivery date is gone — must not vanish
    ],
    suppliers: [{ id: "s1", name: "Pasar Malam" }],
    credits: [{ id: "c1", amountRM: 3 }, { id: "c2", amountRM: 2.5 }],
    purchaseOrders: [{ id: "po1", total: 5 }],
    occasions: [],
  };
  const v = backups.snapshotViewData(data);

  // Counts + the credit total.
  assert.equal(v.counts.orders, 4);
  assert.equal(v.counts.products, 3);
  assert.equal(v.counts.ingredients, 3);
  assert.equal(v.counts.deliveryDates, 2);
  assert.equal(v.counts.credits, 2);
  assert.equal(v.creditRM, 5.5);

  // Product rows: live prices, "no price set", hidden flagged separately.
  const jerky = v.productRows.find((p) => p.name === "Chicken Jerky");
  assert.equal(jerky.priceText, "RM 24.00");
  assert.equal(jerky.hidden, false);
  const bundle = v.productRows.find((p) => p.name === "Chicken Jerky Bundle");
  assert.equal(bundle.priceText, "");
  const retired = v.productRows.find((p) => p.name === "Retired recipe");
  assert.equal(retired.hidden, true);

  // Ingredient rows: stock formatted + the "low" flag + hidden.
  const chicken = v.ingredientRows.find((i) => i.name === "Chicken breast");
  assert.equal(chicken.onHandText, "300 g");
  assert.equal(chicken.keepText, "500 g");
  assert.equal(chicken.low, true); // 300 is >10% under its keep-at-least of 500
  assert.equal(chicken.hidden, false);
  const potato = v.ingredientRows.find((i) => i.name === "Sweet potato");
  assert.equal(potato.onHandText, "1.2 kg");
  assert.equal(potato.low, false);
  const spice = v.ingredientRows.find((i) => i.name === "Old spices");
  assert.equal(spice.hidden, true);
  assert.equal(spice.onHandText, "0 g");

  // Orders grouped by delivery date (oldest date first), date-less group last.
  assert.equal(v.dayRows.length, 2);
  const d1 = v.dayRows[0];
  assert.equal(d1.date, "2026-09-08");
  assert.equal(d1.orders.length, 3);
  const [bee, gone, lim] = d1.orders;
  assert.equal(bee.code, "ABCDEF"); // orderCode from the id
  assert.equal(bee.product, "Chicken Jerky");
  assert.equal(bee.qty, 3);
  assert.equal(bee.statusLabel, "Packed"); // status "ready" reads "Packed"
  assert.equal(bee.courier, false);
  assert.equal(bee.customer, "Aunty Bee");
  assert.ok(bee.placed);
  assert.equal(gone.product, "(product no longer listed)");
  assert.equal(gone.customer, "(no name)");
  assert.equal(gone.statusLabel, "New");
  assert.equal(lim.courier, true);
  assert.equal(lim.statusLabel, "Delivered");
  const orphan = v.dayRows[1];
  assert.equal(orphan.date, "");
  assert.equal(orphan.orders[0].statusLabel, "Preparing"); // status "baking" reads "Preparing"
});

test("snapshotViewData survives sparse or empty data", () => {
  const v = backups.snapshotViewData({ orders: [], products: [], ingredients: [] });
  assert.equal(v.counts.orders, 0);
  assert.equal(v.counts.products, 0);
  assert.equal(v.counts.ingredients, 0);
  assert.equal(v.dayRows.length, 0);
  assert.deepEqual(v.productRows, []);
  assert.deepEqual(v.ingredientRows, []);
});
