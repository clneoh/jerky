// test/backups.test.js — cloud backup cadence, snapshot/restore and network.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as backups from "../admin/js/backups.js";
import { normalize, LS_KEY } from "../admin/js/state.js";
import { todayISO } from "../admin/js/dates.js";
import { parseImport } from "../admin/js/validate.js";
import { ENGINE_VERSION } from "../admin/js/version.js";

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

test("★★★ a copy posted AFTER the list was read counts against the keep (v583)", () => {
  // ⚠️⚠️ MEASURED: the rows are read BEFORE the new copy is written, so keeping 7 of them left **8** on the
  // server — ⚠️ **one more than the card says it keeps.** ⭐ The copy about to be posted takes a slot.
  const rows = [];
  let n = 0;
  const add = (kind, day) => rows.push({ id: ++n, kind, created_at: new Date(2026, 0, day).toISOString() });
  for (let i = 1; i <= 10; i++) add("daily", i);
  for (let i = 0; i < 6; i++) add("weekly", 1 + i);
  const kill = backups.pruneIds(rows, { daily: 1, weekly: 1 });
  // 10 dailies: 6 kept + 1 about to be written = 7. 6 weeklies: 3 + 1 = 4.
  assert.deepEqual(kill.slice().sort((a, b) => a - b), [1, 2, 3, 4, 11, 12, 13]);
});

// ── naming / download envelope / restore merge ────────────────────────────

test("backupFileName is date + kind with the brand prefix", () => {
  assert.equal(backups.backupFileName("2026-09-08", "daily"), "furkidz-backup-2026-09-08-daily.json");
  assert.equal(backups.backupFileName("2026-09-08", "manual"), "furkidz-backup-2026-09-08-manual.json");
});

test("★★★ an import refuses what it cannot read, and a NEWER format above all (v591)", () => {
  // ⚠️⚠️ THE FORMAT GUARD COULD BE CHANGED TO `> 999` AND EVERY TEST STAYED GREEN. ⚠️ **A backup written by a
  // future version would then be imported over her book.** ⭐ Each refusal, driven through the real parser.
  assert.throws(() => parseImport("{oops"), /valid JSON/, "⚠️ invalid JSON was accepted");
  assert.throws(() => parseImport(JSON.stringify({ app: "something-else", formatVersion: 1, data: {} })),
    /Not a Munchies Furkidz backup/, "⚠️ another app's file was accepted");
  assert.throws(() => parseImport(JSON.stringify({ app: "furkidz", formatVersion: 2, data: {} })),
    /newer version/, "★ a NEWER format was imported over her book");
  assert.throws(() => parseImport(JSON.stringify({ app: "furkidz", formatVersion: 1 })),
    /no data inside/, "⚠️ a file with no data was accepted");
  // And the file this app writes today still reads.
  assert.ok(parseImport(JSON.stringify({ app: "furkidz", formatVersion: 1, data: {} })));
});

test("exportEnvelope wraps a copy so a downloaded file re-imports via parseImport", () => {
  const data = backups.snapshotState(cloudState());
  const row = { kind: "daily", created_at: "2026-09-08T12:00:00.000Z", engine: "65", data: JSON.stringify(data) };
  const env = backups.exportEnvelope(row);
  assert.equal(env.app, "furkidz");
  assert.equal(env.formatVersion, 1);
  assert.equal(env.exportedAt, row.created_at);
  assert.equal(env.engine, "65");
  const imported = parseImport(JSON.stringify(env));
  assert.deepEqual(imported, normalize(data));
  assert.equal(imported.settings.supabase.email, ""); // creds never in the cloud copy
});

test("rewindTo takes the copy's data but keeps this phone's sign-in, cloud switch and lock", () => {
  const snap = backups.snapshotState(cloudState()); // no device settings inside
  const live = cloudState();
  live.settings.supabase = { enabled: true, url: "https://y.supabase.co", anonKey: "anon2",
    email: "a@b.com", password: "keep-me" };
  live.settings.cloud = { enabled: true };
  live.settings.lock = { enabled: true, pinHash: "keep-hash" };
  live.products = [{ id: "p-live", name: "Something newer", unit: "pouch" }]; // will be replaced
  live.orders = [];

  const merged = backups.rewindTo(live, snap); // ⚠️ RENAMED at v532: it never merged, and the name said it did
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
    assert.equal(seen.engine, ENGINE_VERSION);
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

test("★★★ maybeAutoBackup prunes down to SEVEN dailies INCLUDING the one it writes (v583)", async () => {
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
    // ⚠️⚠️ EIGHT ON THE SERVER, ONE ABOUT TO BE WRITTEN, SEVEN KEPT: ⚠️ the old rule kept seven of the EIGHT
    // already there and then added another — **8 on a card that says 7.** ⭐ Two go.
    assert.equal(deletes.length, 1);
    assert.ok(deletes[0].includes("id=in.(101,100)") && deletes[0].includes("100"),
      `expected dailies 100 and 101 pruned, got ${deletes[0]}`);
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
  const row = { id: 7, kind: "daily", label: "Daily · 8 Sep 2026", engine: "65",
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

// ── v532: put back ONLY what is missing, and remove NOTHING ─────────────────
//
// ⚠️⚠️ THE TEST TRAP, AND IT COST MUNCHIES A ROUND: **the first put-back test PASSED WITH A REWIND PUT IN ITS
// PLACE**, because it only counted orders. ⭐⭐ **A bite that does not fail is telling you the test is weak.**
// So this one carries **an order that was added AFTER the copy was taken** and asserts it SURVIVES — that is
// the one property that separates an add from a rewind.

/** The stubs `putBackOrders` needs: the copy, the sync pull and flush, and the "before" copy's POST. */
function putBackFetch(row, { onSafety = () => {} } = {}) {
  return installFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "GET" && url.includes("/rest/v1/backup_snapshots?")) return jsonRes([row]);
    if (method === "GET" && url.includes("/rest/v1/bakery?")) return jsonRes([]);      // paged sync pull
    if (method === "POST" && url.includes("/rest/v1/bakery?")) return jsonRes({});      // sync flush
    if (method === "POST" && url.endsWith("/rest/v1/backup_snapshots")) {
      onSafety(JSON.parse(opts.body)[0]);
      return jsonRes({});
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
}

test("★★★ putBackOrders ADDS the missing order and REMOVES NOTHING — an order added after the copy survives", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  try {
    const state = cloudState();
    const snap = backups.snapshotState(state);                        // the copy, as it stood that day
    // ⚠️ IN THE COPY, NOT ON THE PHONE NOW — the one it is meant to put back.
    snap.orders.push({ id: "ord_missing1", productId: "p1", qty: 2, deliveryDateId: "d1", status: "paid" });
    // ⚠️⚠️ AND ON THE PHONE, ADDED AFTER THE COPY — **a rewind would destroy this; a put-back must not.**
    state.orders.push({ id: "ord_addedAft", productId: "p1", qty: 1, deliveryDateId: "d1", status: "new" });

    let safety = null;
    const restoreFetch = putBackFetch({ id: 9, data: JSON.stringify(snap) }, { onSafety: (r) => { safety = r; } });
    try {
      const r = await backups.putBackOrders(state, { id: 9 });
      assert.equal(r.ok, true, String(r.reason || "the put-back failed, so nothing below proves anything"));
      assert.equal(r.count, 1, "★ the missing order was not put back, or more than one was added");

      const ids = state.orders.map((o) => o.id);
      assert.ok(ids.includes("ord_missing1"), "★ the order the copy holds and this phone did not is still missing");
      assert.ok(ids.includes("ord_addedAft"),
        "★ an order added AFTER the copy was REMOVED — **that is a REWIND, not a put-back**, and it is the "
        + "exact fault this test exists to catch: the first version of this test passed with a rewind in its place");
      // ⭐ AND WHAT WENT TO THE PHONE IS THE SAME THING.
      const written = JSON.parse(ls.store.get(LS_KEY));
      assert.deepEqual(written.orders.map((o) => o.id).sort(), ["o1", "ord_addedAft", "ord_missing1"].sort(),
        "★ the phone's saved orders are not exactly what it had, plus the one that was missing");
      // ⚠️ AND IT IS NEVER ONE-WAY: a "before" copy is written first, for the same reason a rewind takes one.
      assert.ok(safety, "★ no \"Before put-back\" copy was saved, so the press cannot be undone");
      assert.match(String(safety.label), /Before put-back/);
    } finally { restoreFetch(); }
  } finally { ls.restore(); }
});

test("★★ putBackOrders NEVER resurrects a cancellation — an order on the Removed list is left alone", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  try {
    const state = cloudState();
    const snap = backups.snapshotState(state);
    // ⚠️ THE COPY HOLDS IT, AND SHE CANCELLED IT — it is on this phone's Removed list.
    // ⚠️ THE FIXTURE'S OWN ORDER STAYS LIVE — ⭐ **emptying the list instead would make a DIFFERENT order
    // missing, and the test would "fail" for a reason that has nothing to do with cancellation** (it did,
    // first time round: the count came back 1 for `o1`, not for the cancelled one).
    const cancelled = { id: "ord_cancel1", productId: "p1", qty: 3, deliveryDateId: "d1", status: "new" };
    snap.orders.push(cancelled);
    state.removedOrders = [{ ...cancelled, removedAt: new Date().toISOString() }];

    const restoreFetch = putBackFetch({ id: 9, data: JSON.stringify(snap) });
    try {
      const r = await backups.putBackOrders(state, { id: 9 });
      assert.equal(r.ok, true);
      assert.equal(r.count, 0, "★ a cancelled order was put back — **the press must not undo a decision she made**");
      assert.equal(state.orders.some((o) => o.id === "ord_cancel1"), false,
        "★ the cancelled order is on the live list again");
    } finally { restoreFetch(); }
  } finally { ls.restore(); }
});

test("★★ and a dry run COUNTS without changing anything at all", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  try {
    const state = cloudState();
    const snap = backups.snapshotState(state);
    snap.orders.push({ id: "ord_missing1", productId: "p1", qty: 2, deliveryDateId: "d1", status: "paid" });
    const before = JSON.stringify(state);
    const restoreFetch = putBackFetch({ id: 9, data: JSON.stringify(snap) });
    try {
      const r = await backups.putBackOrders(state, { id: 9 }, { dryRun: true });
      assert.equal(r.ok, true);
      assert.equal(r.count, 1, "the dry run did not count the missing order");
      assert.deepEqual(r.codes.length, 1);
      // ⚠️ **A DRY RUN THAT CHANGED SOMETHING WOULD BE THE WORST OF BOTH** — it is what the confirmation uses.
      assert.equal(JSON.stringify(state), before, "★ a dry run changed the phone");
    } finally { restoreFetch(); }
  } finally { ls.restore(); }
});

// ── v539: when the whole state is replaced, the read cursor must be forgotten ─
test("★★★ a restore FORGETS the read cursor — the data has just jumped backwards", async () => {
  // ⚠️⚠️ THE RISK, AND IT ARRIVED WITH v533'S CURSOR: after a rewind, `lastSeq` still points at where this
  // phone was BEFORE it. ⚠️ **The next read then asks for `seq > lastSeq`, and every record in the shared data
  // older than that is never read again** — ⭐ **so a restore that failed to push could never be recovered by
  // reading**, which is the v444 shape coming back through a new door.
  const ls = installStorage();
  seedToken(ls.store);
  try {
    const state = cloudState();
    const snap = backups.snapshotState(state);
    const row = { id: 5, data: JSON.stringify(snap) };
    // A phone that has already read the whole book, so it holds a cursor.
    ls.store.set("bakeadmin.sync", JSON.stringify({ version: 1, pending: {}, snapshot: {}, meta: {},
      lastPullAt: "2026-01-01T00:00:00.000Z", lastSeq: 500, lastCount: 791 }));

    const restoreFetch = installFetch(async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (method === "GET" && url.includes("/rest/v1/bakery?")) return jsonRes([]);
      if (method === "POST" && url.includes("/rest/v1/bakery?")) return jsonRes({});
      if (method === "POST" && url.endsWith("/rest/v1/backup_snapshots")) return jsonRes({});
      throw new Error(`unexpected request ${method} ${url}`);
    });
    try {
      const r = await backups.restoreSnapshot(state, row);
      assert.equal(r.ok, true, String(r.reason || "the restore failed, so nothing below proves anything"));
      const b = JSON.parse(ls.store.get("bakeadmin.sync"));
      assert.equal(b.lastSeq, null,
        "★ the cursor SURVIVED a rewind — **the next read asks for what changed after a number that now "
        + "belongs to a book this phone no longer has, and the older records are never read again**");
      assert.equal(b.lastCount, null, "the record count still describes the book from before the rewind");
    } finally { restoreFetch(); }
  } finally { ls.restore(); }
});

test("★★★ and an Import can save the same 'before' copy Restore has always saved", async () => {
  // ⚠️ **Restore took a safety copy; Import did not** — so importing the wrong file was the one action in the
  // app with no way back. ⭐ It is the same three lines, so the two cannot drift apart.
  const ls = installStorage();
  seedToken(ls.store);
  try {
    const state = cloudState();
    let posted = null;
    const restoreFetch = installFetch(async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (method === "POST" && url.endsWith("/rest/v1/backup_snapshots")) {
        posted = JSON.parse(opts.body)[0];
        return jsonRes({});
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });
    try {
      const r = await backups.saveSafetyCopy(state, "Before import · 17 Oct · 18:02");
      assert.equal(r.ok, true, String(r.reason || "the safety copy was not saved"));
      assert.ok(posted, "★ nothing was posted — **so the import would still have no way back**");
      assert.equal(posted.kind, "manual");
      assert.equal(posted.label, "Before import · 17 Oct · 18:02", "the copy is not labelled with what it is");
      // ⚠️ AND IT IS STRIPPED OF THE PHONE'S OWN SECRETS, exactly like Restore's.
      assert.equal(JSON.parse(posted.data).settings.supabase, undefined,
        "★ the safety copy carries this phone's sign-in");
    } finally { restoreFetch(); }
  } finally { ls.restore(); }
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
    assert.deepEqual(written, backups.rewindTo(state, snap));
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

// ── ★★★ THE ADDITIVE REPAIR (17 October 2026) ──────────────────────────────
// ⚠️ THE FAULT THIS EXISTS FOR: the check opened a week-old copy, found orders this phone could not
// account for, and told her to "put that copy back" — **a full rewind of a week, offered as though it
// were a way to look something up.** These pin the two halves: WHICH orders are unexplained (one rule,
// shared with the check) and that putting them back ADDS ONLY THOSE.

const coded = (id, qty = 1) => ({ id, productId: "p1", qty, deliveryDateId: "d1", status: "new" });

test("★★★ unaccountedOrders: the four things that explain an order, and the silence that does not", () => {
  const live = cloudState();
  live.orders = [];
  live.removedOrders = [];
  live.voidedReceipts = [];
  const snapWith = (orders, extra = {}) => ({ ...backups.snapshotState(live), orders, ...extra });
  const gone = coded("o_aa11bb");

  assert.deepEqual(backups.unaccountedOrders(live, snapWith([gone])).map((x) => x.code), ["AA11BB"],
    "★ an order in the copy and nowhere else was not named — the very thing the check exists to see");

  assert.deepEqual(backups.unaccountedOrders({ ...live, orders: [gone] }, snapWith([gone])), [],
    "it is on this phone now");

  assert.deepEqual(
    backups.unaccountedOrders({ ...live, removedOrders: [{ ...gone, removedAt: new Date().toISOString() }] }, snapWith([gone])), [],
    "it is on the Removed list now");

  assert.deepEqual(backups.unaccountedOrders(live, snapWith([gone], { removedOrders: [{ ...gone }] })), [],
    "the copy's own Removed list remembers it");

  assert.deepEqual(
    backups.unaccountedOrders({ ...live, voidedReceipts: [{ id: "void_1", code: "AA11BB", no: 3 }] }, snapWith([gone])), [],
    "a receipt she marked void explains it, by code");

  assert.deepEqual(
    backups.unaccountedOrders({ ...live, voidedReceipts: [{ id: "void_1", code: "ZZ9999", no: 3 }] },
      snapWith([{ ...gone, receiptNo: 3 }])), [],
    "…and by receipt number, for a void record written before the order's code moved");
});

test("★★★ unaccountedOrders counts ORDERS and carries every row of a grouped one", () => {
  const live = cloudState();
  live.orders = []; live.removedOrders = []; live.voidedReceipts = [];
  const a = coded("o_111111"); a.groupId = "g_111111";
  const b = coded("o_222222", 3); b.groupId = "g_111111";   // the same order, a second line
  const c = coded("o_333333");
  const snap = { ...backups.snapshotState(live), orders: [a, b, c], removedOrders: [] };
  const found = backups.unaccountedOrders(live, snap);
  assert.equal(found.length, 2, `★ two orders were reported as ${found.length}`);
  assert.deepEqual(found.map((x) => x.code), ["111111", "333333"], "and they are sorted by code");
  const grouped = found.find((x) => x.code === "111111");
  assert.equal(grouped.orders.length, 2,
    "★ only one row of a two-line order was carried — putting it back would put back half an order");
});

test("★★★ putBackOrders ADDS only the unexplained orders — nothing is removed or rewritten", async () => {
  const ls = installStorage();
  seedToken(ls.store);
  const state = cloudState();
  state.removedOrders = [];
  state.voidedReceipts = [];
  const mine = { ...state.orders[0] };            // already on this phone
  // ⚠️⚠️ AND ONE ADDED AFTER THE COPY — **the assertion that tells an ADD from a REWIND.** A rewind
  // replaces the list with the copy's, so this order would vanish; an additive put-back leaves it alone.
  const newer = coded("o_dd44ee", 4);
  state.orders.push(newer);
  const gone = coded("o_aa11bb");
  const snap = { ...backups.snapshotState(state), orders: [mine, gone], removedOrders: [] };
  const row = { id: 7, data: JSON.stringify(snap) };
  let safetyPost = null;
  const restoreFetch = installFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "GET" && url.includes("/rest/v1/bakery?")) return jsonRes([]);          // sync pull
    if (method === "GET" && url.includes("/rest/v1/backup_snapshots?")) return jsonRes([row]);
    if (method === "POST" && url.includes("/rest/v1/bakery?")) return jsonRes({});          // sync flush
    if (method === "POST" && url.endsWith("/rest/v1/backup_snapshots")) {
      safetyPost = JSON.parse(opts.body)[0];
      return jsonRes({});
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
  try {
    // ⚠️ A DRY RUN MUST CHANGE NOTHING AT ALL — not the live list, not a copy, not the phone.
    const dry = await backups.putBackOrders(state, row, { dryRun: true });
    assert.equal(dry.ok, true);
    assert.equal(dry.count, 1, `★ the dry run counted ${dry.count}`);
    assert.equal(safetyPost, null, "★ a dry run wrote a copy — it must change nothing");
    assert.equal(state.orders.length, 2, "★ a dry run changed the live list");

    const r = await backups.putBackOrders(state, row);
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(state.orders.length, 3, "★ the missing order was not added to the live list");
    assert.ok(safetyPost && String(safetyPost.label).startsWith("Before put-back · "),
      "★ no 'Before put-back' copy was saved, so the press cannot be undone");
    const written = JSON.parse(ls.store.get(LS_KEY));
    assert.equal(written.orders.length, 3, "the added order was not written to this phone");
    assert.ok(written.orders.some((o) => o.id === newer.id),
      "★★ THE ORDER ADDED AFTER THE COPY WAS REMOVED — that is a rewind, not a put-back");
    assert.equal(written.orders.filter((o) => o.id === mine.id).length, 1,
      "★ the order already on the list was duplicated");
    // nothing else in the phone's state was touched
    assert.deepEqual(written.products, state.products);
    assert.deepEqual(written.removedOrders, state.removedOrders);
  } finally { restoreFetch(); ls.restore(); }
});


test("★★★ a sync finishing is not called offline (v587)", () => {
  // ⚠️⚠️ MEASURED: the 30-second beat can be mid-pull when she presses Restore, and `refresh` answers
  // **"Sync already running"** — ⚠️ **which the restore reported as "You need to be online", the one
  // instruction that cannot help on a phone that is plainly online.**
  assert.match(backups.freshenRefusal({ ok: false, reason: "Sync already running" }, "restore a backup"),
    /A sync is finishing .* press restore a backup again/i);
  assert.match(backups.freshenRefusal({ ok: false, reason: "Shared data is off" }, "restore a backup"),
    /You need to be online to restore a backup/);
});

test("★★★ the backup list is not cut off at sixty (v587)", async () => {
  // ⚠️⚠️ MEASURED: manual copies are never pruned, so past sixty the OLDEST one existed in the cloud with no
  // Restore, Download or Delete anywhere in the app. ⭐ The list pages until the cloud has no more.
  const ls = installStorage();
  seedToken(ls.store);
  const seen = [];
  const restoreFetch = installFetch(async (url) => {
    seen.push(String(url));
    const offset = Number((String(url).match(/[?&]offset=(\d+)/) || [])[1] || 0);
    const n = offset === 0 ? 100 : 5;
    return { ok: true, json: async () => Array.from({ length: n }, (_, i) => ({
      id: `b${offset + i}`, kind: "manual", label: `copy ${offset + i}`,
      created_at: new Date(Date.now() - (offset + i) * 1000).toISOString(), summary: {},
    })) };
  });
  try {
    const r = await backups.listBackups(cloudState());
    assert.equal(r.rows.length, 105, `★ the list stopped at ${r.rows.length} of 105 copies`);
    assert.equal(seen.length, 2, "it asked twice — once for each page");
  } finally { restoreFetch(); ls.restore(); }
});
