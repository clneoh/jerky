// sync.js — shared data across phones (Supabase `bakery` table).
//
// Model: every state record becomes a row `{kind, id, data, _deleted, updated_at}`.
// `data` is the record serialized as a JSON *string* (text column) so a push
// replaces it wholesale instead of PostgREST key-merging a jsonb value.
// `_deleted: true` is a tombstone for records removed on another phone.
// `updated_at` is a client ISO timestamp; newest edit wins per record.
//
// Local-first: each phone keeps its own localStorage working copy (`bakeadmin.v1`)
// plus a small sync journal (`bakeadmin.sync`) that tracks what's pending, a
// change-detection snapshot, and per-record timestamps. The cloud is a mirror.
//
// Conflict rule: last-write-wins per record. Safe for two bakers; documented in
// the README. Every sync is **pull-then-flush** so an offline edit can never
// clobber a newer cloud row — the pull discards the stale pending first.
//
// Pure helpers run under Node for tests; fetch/localStorage are guarded.

import { login as loginSupabase, cachedToken } from "./supabase.js";
import { save } from "./state.js";
import { mergeWeekCheck } from "./weekly.js";

const SYNC_KEY = "bakeadmin.sync";

const LISTS = {
  orders: "orders",
  products: "products",
  ingredients: "ingredients",
  suppliers: "suppliers", // who you buy from — pack prices ride ingredients, so the shops must too
  uoms: "uoms", // units of measure — a unit added on one phone has to exist on the other
  deliveryDates: "deliveryDates",
  purchaseOrders: "purchaseOrders",
  credits: "credits", // bring-a-friend ledger rows
  occasions: "occasions", // delivery-calendar reminder marks
};
const SETTINGS_KEY = "settings:default";

// ── config ────────────────────────────────────────────────────────────────

export function cloudCfg(state) {
  const s = (state.settings && state.settings.supabase) || {};
  const url = String(s.url || "").replace(/\/+$/, "");
  const anonKey = String(s.anonKey || "");
  const email = String(s.email || "");
  const password = String(s.password || "");
  const enabled = !!(state.settings && state.settings.cloud && state.settings.cloud.enabled);
  const ready = !!(url && anonKey);
  return { url, anonKey, email, password, enabled, ready, on: enabled && ready };
}

// Show the sign-in gate: shared data is on, we have a URL to reach, but there
// is no session and no stored credentials to auto-login with.
export function needsGate(state) {
  const c = cloudCfg(state);
  return c.on && !cachedToken() && !(c.email && c.password);
}

export function isSignedIn() {
  return !!cachedToken();
}

// ── records / change detection ────────────────────────────────────────────

// The business payload for a record. Settings sync only the keys every phone
// should share — connection config (`supabase`, `cloud`) stays per-device, and
// so does the app-password `lock`. The weekly checklist `weekCheck` DOES sync
// (so Home's to-do agrees on both phones) and is union-merged on pull (below).
function recordPayload(kind, rec) {
  if (kind === "settings") {
    return {
      defaultCapacity: rec.defaultCapacity,
      deliveryDays: rec.deliveryDays,
      cutoff: rec.cutoff,
      currency: rec.currency,
      weekCheck: rec.weekCheck || { week: "", done: {} },
      referrals: rec.referrals || {}, // bring-a-friend scheme numbers
      // The to-do list once she customises it. Absent until then: a phone that
      // never edited its tasks must not push the preset seed and overwrite the
      // other phone's customised list (last-write-wins below would clobber it).
      ...(Array.isArray(rec.tasks) ? { tasks: rec.tasks } : {}),
    };
  }
  return rec;
}

export function computeRecords(state) {
  const out = [];
  for (const [kind, field] of Object.entries(LISTS)) {
    const list = state[field];
    if (Array.isArray(list)) {
      for (const rec of list) out.push({ kind, id: rec.id, data: recordPayload(kind, rec) });
    }
  }
  out.push({ kind: "settings", id: "default", data: recordPayload("settings", state.settings) });
  return out;
}

// Stable serialization for change detection: key order must not matter, so a
// record re-written with the same values isn't re-pushed. Arrays keep order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── journal (bakeadmin.sync) ──────────────────────────────────────────────

function emptyBlob() {
  return { version: 1, pending: {}, snapshot: {}, meta: {}, lastPullAt: null };
}

function readSync() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) {
      const b = JSON.parse(raw);
      if (b && typeof b === "object") {
        return {
          version: 1,
          pending: b.pending && typeof b.pending === "object" ? b.pending : {},
          snapshot: b.snapshot && typeof b.snapshot === "object" ? b.snapshot : {},
          meta: b.meta && typeof b.meta === "object" ? b.meta : {},
          lastPullAt: typeof b.lastPullAt === "string" ? b.lastPullAt : null,
        };
      }
    }
  } catch (err) { /* no storage / corrupt journal — start fresh */ }
  return emptyBlob();
}

function writeSync(b) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(b));
  } catch (err) { /* storage full — pending stays in memory only */ }
}

// ── markDirty: queue what changed since the last baseline ────────────────

export function markDirty(state, nowIso = new Date().toISOString()) {
  const b = readSync();
  let changed = false;
  const present = new Set();

  for (const rec of computeRecords(state)) {
    const key = `${rec.kind}:${rec.id}`;
    present.add(key);
    const serial = canonical(rec.data);
    if (b.snapshot[key] !== serial) {
      b.pending[key] = { kind: rec.kind, id: rec.id, updated_at: nowIso, data: rec.data, _deleted: false };
      b.meta[key] = nowIso;
      b.snapshot[key] = serial;
      changed = true;
    }
  }

  // Records we'd seen locally that are gone now → tombstones. Settings is
  // always present, so it's naturally excluded.
  for (const key of Object.keys(b.snapshot)) {
    if (present.has(key)) continue;
    const sep = key.indexOf(":");
    const kind = key.slice(0, sep);
    const id = key.slice(sep + 1);
    b.pending[key] = { kind, id, updated_at: nowIso, data: null, _deleted: true };
    b.meta[key] = nowIso;
    delete b.snapshot[key];
    changed = true;
  }

  writeSync(b);
  return { state, pending: b.pending, changed };
}

// ── mergeCloudRows: apply cloud rows newest-wins ──────────────────────────

function mergeCloudRows(state, rows, b) {
  let changed = false;

  for (const row of rows || []) {
    if (!row || typeof row.kind !== "string" || typeof row.id !== "string") continue;
    if (typeof row.updated_at !== "string") continue;
    const key = `${row.kind}:${row.id}`;
    const cloudAt = row.updated_at;
    const localAt = b.meta[key] || "";
    const pending = b.pending[key];
    const localNewerOrSame = !!(pending && !pending._deleted && pending.updated_at >= cloudAt);

    if (row.kind === "settings") {
      if (row._deleted) continue;
      let payload;
      try { payload = JSON.parse(row.data); } catch { continue; }
      if (!payload || typeof payload !== "object") continue;
      if (localNewerOrSame || cloudAt <= localAt) continue; // local wins
      // The checklist must not be overwritten wholesale: another phone's ticks
      // union with this phone's so a same-week tick is never lost. Everything
      // else merges as before, keeping per-device config local.
      const { weekCheck: cloudWc, ...rest } = payload;
      const merged = {
        ...rest,
        supabase: (state.settings && state.settings.supabase) || {},
        cloud: (state.settings && state.settings.cloud) || { enabled: false },
        weekCheck: mergeWeekCheck(
          (state.settings && state.settings.weekCheck) || {},
          cloudWc || {}),
      };
      state.settings = { ...state.settings, ...merged };
      b.meta[key] = cloudAt;
      b.snapshot[key] = canonical(recordPayload("settings", state.settings));
      delete b.pending[key];
      changed = true;
      continue;
    }

    const field = LISTS[row.kind];
    if (!field || !Array.isArray(state[field])) continue;
    const list = state[field];
    const idx = list.findIndex((x) => x.id === row.id);

    if (row._deleted) {
      // A pending local edit newer than this delete keeps the record alive —
      // it stays pending and resurrects the row on the next flush.
      if (localNewerOrSame) continue;
      if (idx >= 0) { list.splice(idx, 1); changed = true; }
      delete b.pending[key];
      delete b.meta[key];
      delete b.snapshot[key];
      continue;
    }

    let payload;
    try { payload = row.data == null ? null : JSON.parse(row.data); } catch { continue; }
    if (payload == null) continue;

    // Local wins (or the row is stale) whether or not the record still exists:
    // a newer local timestamp also means the record was deleted locally, so a
    // stale cloud row must not resurrect it.
    if (localNewerOrSame || cloudAt <= localAt) continue;

    if (idx >= 0) {
      list[idx] = payload;
    } else {
      list.push(payload);
    }
    changed = true;
    b.meta[key] = cloudAt;
    b.snapshot[key] = canonical(payload);
    delete b.pending[key];
  }

  return { changed };
}

// Testable wrapper: merge cloud rows into state and persist the journal.
export function mergeRows(state, rows) {
  const b = readSync();
  const { changed } = mergeCloudRows(state, rows, b);
  writeSync(b);
  return { state, changed };
}

// ── pull ──────────────────────────────────────────────────────────────────

export async function pull(state) {
  const c = cloudCfg(state);
  if (!c.on) return { ok: false, changed: false, reason: "Shared data is off" };
  const token = cachedToken();
  if (!token) return { ok: false, changed: false, reason: "Not signed in" };

  let res;
  try {
    res = await fetch(`${c.url}/rest/v1/bakery?select=kind,id,data,updated_at,_deleted&limit=1000`, {
      headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, changed: false, reason: "Offline — will retry" };
  }
  if (!res.ok) return { ok: false, changed: false, reason: `Pull failed (HTTP ${res.status})` };

  let rows;
  try { rows = await res.json(); } catch { return { ok: false, changed: false, reason: "Bad response" }; }

  const b = readSync();
  const first = !b.lastPullAt;
  const { changed } = mergeCloudRows(state, rows, b);
  b.lastPullAt = new Date().toISOString();
  writeSync(b);

  // On the first pull (or when rows changed), save so the save-hook queues any
  // records that only exist on this phone — that's the one-time migration that
  // uploads existing local data on first sign-in.
  if (changed || first) save(state);
  return { ok: true, changed: changed || first };
}

// ── flush ─────────────────────────────────────────────────────────────────

export async function flush(state) {
  const c = cloudCfg(state);
  if (!c.on) return { ok: false, pushed: 0, reason: "Shared data is off" };

  const b = readSync();
  const pending = Object.values(b.pending);
  if (!pending.length) return { ok: true, pushed: 0 };

  const token = cachedToken();
  if (!token) return { ok: false, pushed: 0, reason: "Not signed in" };

  // `data` is `text not null` in the bakery table, so a tombstone can't carry
  // JSON null. Send the string "null" instead — tombstones are matched on
  // `_deleted` during the merge and never have their data parsed.
  const body = pending.map((p) => ({
    kind: p.kind,
    id: p.id,
    data: p._deleted ? "null" : JSON.stringify(p.data) ?? "null",
    _deleted: p._deleted,
    updated_at: p.updated_at,
  }));

  let res;
  try {
    res = await fetch(`${c.url}/rest/v1/bakery?on_conflict=kind,id`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, pushed: 0, reason: "Offline — will retry" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, pushed: 0, reason: `Push failed (HTTP ${res.status})${text ? " — " + text.slice(0, 120) : ""}` };
  }

  // Clear only the rows that are still byte-identical to what we sent; an edit
  // queued mid-flight has a newer timestamp and stays pending.
  const b2 = readSync();
  for (const p of pending) {
    const key = `${p.kind}:${p.id}`;
    const cur = b2.pending[key];
    if (cur && cur.updated_at === p.updated_at) delete b2.pending[key];
  }
  writeSync(b2);
  return { ok: true, pushed: pending.length };
}

// ── refresh: pull-then-flush ──────────────────────────────────────────────

let refreshing = false;
export async function refresh(state) {
  if (refreshing) return { ok: false, changed: false, reason: "Sync already running" };
  refreshing = true;
  try {
    // Queue anything that exists locally but was never uploaded — e.g. suppliers
    // or units typed before their kind joined the sync list, or edits made while
    // the connection was down. markDirty otherwise only runs on an explicit
    // save, so a plain "Sync now" / boot refresh would push nothing for those.
    markDirty(state);
    const pullRes = await pull(state);
    // Only push after a successful pull: a failed pull means we might be
    // offline or have a stale local view — pushing would risk clobbering.
    const flushRes = pullRes.ok ? await flush(state) : { ok: true, pushed: 0 };
    return {
      ok: pullRes.ok && flushRes.ok,
      changed: pullRes.changed,
      reason: pullRes.reason || flushRes.reason,
    };
  } finally {
    refreshing = false;
  }
}

// ── sign-in / sign-out ────────────────────────────────────────────────────

export async function login(state) {
  const c = cloudCfg(state);
  await loginSupabase(c.url, c.anonKey, c.email, c.password);
}

// Full sign-in from the gate: remember the connection config, authenticate,
// then pull-then-flush (which uploads this phone's data on first sign-in).
export async function signIn(state, url, anonKey, email, password) {
  const base = String(url || "").replace(/\/+$/, "");
  const key = String(anonKey || "").trim();
  // Remember everything (creds included) so this phone auto-logins on next
  // open, like Live availability already does. Sign out clears the password.
  state.settings.supabase = {
    ...(state.settings.supabase || {}),
    url: base,
    anonKey: key,
    email: String(email || "").trim(),
    password: String(password || ""),
  };
  await loginSupabase(base, key, email, password);
  // Queue everything local so the pull-then-flush below uploads it — the
  // one-time migration that brings an existing phone's data into the cloud.
  markDirty(state);
  await refresh(state);
  save(state);
  return true;
}

// ── auto-sync loop ────────────────────────────────────────────────────────

// Debounced refresh so a burst of order entry batches into one sync, ~1.5s
// after the last save. Wired from app.js's save hook.
let refreshTimer = null;
export function scheduleRefresh(state) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refresh(state); }, 1500);
}

// True while the page is on screen and worth refreshing. A hidden tab (switched
// away, or the phone locked) is skipped so a backgrounded app does no network
// work; the browser would throttle it anyway, but the explicit gate means the
// app is guaranteed to do nothing until it is actually being used again.
export function pageActive() {
  return !(typeof document !== "undefined"
    && typeof document.hidden === "boolean" && document.hidden);
}

// Periodic + event-driven refresh. `onChanged` fires when a pull changed data
// (app.js re-renders, guarded against clobbering a focused input). The poll
// runs only while the page is active; the focus / visibilitychange / online
// hooks fire the moment the baker comes back, so fresh data is never delayed a
// full 30s behind by the gate.
let started = false;
export function startSync(state, onChanged) {
  if (started) return;
  started = true;
  const every = () => {
    if (!pageActive()) return;
    refresh(state).then((r) => { if (onChanged && r && r.changed) onChanged(); }).catch(() => {});
  };
  every();
  setInterval(every, 30000);
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("online", every);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) every(); });
    window.addEventListener("focus", every);
  }
}
