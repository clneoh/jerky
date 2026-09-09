// backups.js — cloud snapshots (Supabase backup_snapshots table).
//
// A real safety net behind the sync mirror: every day the app opens signed-in
// it quietly saves a full **daily** copy of the state; each Monday you open it
// a **weekly** copy; on the 1st a **monthly** copy. Retention keeps the newest
// 7 daily / 4 weekly / 3 monthly and prunes the rest, so the table stays small.
// Manual copies (the "Back up to cloud now" button, and one saved before every
// restore) stay until the owner deletes them.
//
// A copy is the full state an Export file already captures, minus the
// per-device settings (settings.supabase / .cloud / .lock) — the app-login
// email/password and the app password never leave the phone. Downloading one
// wraps it in the same envelope as Export, so it re-imports through the file
// Import too. Restoring writes the copy back over this phone and reloads; the
// normal sync engine then re-pushes the rewound rows to the cloud and the other
// phone (see mergeRestore + restoreSnapshot for how that rewinds).
//
// Pure helpers run under Node for tests; all fetch/localStorage access is
// guarded so importing the module is side-effect free.

import { cachedToken } from "./supabase.js";
import * as sync from "./sync.js";
import { LS_KEY, normalize, orderCode, fmtRM } from "./state.js";
import { fmtPlaced, longDate, toISODate, todayISO } from "./dates.js";
import { fmtStockAmount, belowReserve } from "./purchasing.js";
import { ENGINE_VERSION } from "./version.js";

const TABLE = "backup_snapshots";
const GUARD_KEY = "bakeadmin.backup.guard"; // once-per-local-day attempt marker
const KEEP = { daily: 7, weekly: 4, monthly: 3 }; // newest kept per auto kind

// ── pure helpers ───────────────────────────────────────────────────────────

// Whether cloud backups can run right now: shared data on (the same sign-in the
// sync engine uses) and a live session token on this phone.
export function ready(state) {
  return !!sync.cloudCfg(state).on && !!cachedToken();
}

function auth(state) {
  const c = sync.cloudCfg(state);
  if (!c.on) return null;
  const token = cachedToken();
  if (!token) return null;
  return { base: c.url, anonKey: c.anonKey, token };
}

// The full state, with the per-device + credential settings removed. Everything
// else — orders, products, ingredients, POs, credits, the delivery calendar,
// storefront copy, referral scheme — is kept, same coverage as an Export file.
export function snapshotState(state) {
  const snap = JSON.parse(JSON.stringify(state || {}));
  if (snap.settings && typeof snap.settings === "object") {
    delete snap.settings.supabase;
    delete snap.settings.cloud;
    delete snap.settings.lock;
  }
  return snap;
}

// "72 orders · 31 products · 18 ingredients" — the one-line "what's inside"
// shown in the copy list, stored so the list never has to pull the heavy data.
// Customers only join the line once there are any, so old copies (made before
// profiles existed) still read the same.
export function summaryOf(data) {
  const n = (list) => (Array.isArray(list) ? list.length : 0);
  let s = `${n(data.orders)} orders · ${n(data.products)} products · ${n(data.ingredients)} ingredients`;
  if (n(data.customers) > 0) s += ` · ${n(data.customers)} customers`;
  return s;
}

// Local calendar date of an instant (created_at timestamps are UTC; the cadence
// is "her day", so dates always read in the phone's own timezone).
export function dateKey(iso) {
  return toISODate(new Date(iso));
}

// Monday of the week containing an instant, as a YYYY-MM-DD local date.
export function weekKey(iso) {
  const d = new Date(iso);
  const back = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  return toISODate(mon);
}

// YYYY-MM of the month containing an instant.
export function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Which auto copies are due right now: a daily when none exists for this local
// day; a weekly when it is Monday and none exists for this calendar week; a
// monthly when it is the 1st and none exists for this calendar month.
export function dueKinds(rows, now = new Date()) {
  const list = (rows || []).filter((r) => r && r.kind && r.created_at);
  const out = [];
  if (!list.some((r) => r.kind === "daily" && dateKey(r.created_at) === dateKey(now))) out.push("daily");
  if (now.getDay() === 1
      && !list.some((r) => r.kind === "weekly" && weekKey(r.created_at) === weekKey(now))) out.push("weekly");
  if (now.getDate() === 1
      && !list.some((r) => r.kind === "monthly" && monthKey(r.created_at) === monthKey(now))) out.push("monthly");
  return out;
}

// Ids to delete so only the newest 7 daily / 4 weekly / 3 monthly survive.
// Manual copies are never pruned. Callers pass the rows seen BEFORE posting a
// new copy — the fresh copy is the newest, so pruning that list is exact.
export function pruneIds(rows) {
  const kill = [];
  for (const kind of Object.keys(KEEP)) {
    const mine = (rows || [])
      .filter((r) => r && r.kind === kind && r.created_at && r.id != null)
      .sort((a, b) => {
        if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
        return String(b.id).localeCompare(String(a.id)); // newest id first on a tie
      });
    for (const row of mine.slice(KEEP[kind])) kill.push(row.id);
  }
  return kill;
}

// The real file name the owner asked for: date + kind, brand-first.
export function backupFileName(dateStr, kind) {
  return `furkidz-backup-${dateStr}-${kind}.json`;
}

// Wrap a copy's data in the same envelope the manual Export writes, so a
// downloaded backup re-imports through the existing file Import untouched.
export function exportEnvelope(row) {
  let data;
  try { data = JSON.parse(row.data); } catch { data = null; }
  if (!data || typeof data !== "object") data = {};
  return {
    app: "furkidz",
    formatVersion: 1,
    exportedAt: row.created_at || new Date().toISOString(),
    engine: row.engine || "",
    data,
  };
}

// "8 Sep · 21:41" — local, from a UTC created_at.
export function localWhen(iso = new Date().toISOString()) {
  return fmtPlaced(iso);
}

// Human label stored on a copy, e.g. "Daily · 8 Sep 2026" or "Manual · 8 Sep · 21:41".
export function labelFor(kind, iso = new Date().toISOString()) {
  if (kind === "manual") return `Manual · ${localWhen(iso)}`;
  const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${cap} · ${longDate(toISODate(new Date(iso)))}`;
}

// The state a restore writes over the phone: the copy's data, normalized, but
// keeping THIS phone's connection config, shared-data switch and app password —
// the phone stays signed in and its lock stays its own (mirrors the sync
// engine's per-device settings merge). Restored lists replace the current ones,
// which is what makes a restore a step back in time.
export function mergeRestore(current, snapState) {
  const restored = normalize(snapState);
  const live = (current && current.settings) || {};
  const keep = (key) => JSON.parse(JSON.stringify(live[key] || {}));
  restored.settings.supabase = keep("supabase");
  restored.settings.cloud = keep("cloud");
  restored.settings.lock = keep("lock");
  return restored;
}

// ── read-only "View" digest ────────────────────────────────────────────────
// Turns one copy's data into a pure, human-readable display digest for the
// in-app View: what was sold (grouped by delivery date, with statuses and the
// same order codes she sees today), the product price list, and ingredient
// stock with any "low" flags. Pure — never writes localStorage, never marks
// anything dirty; looking at a copy changes nothing.
const VIEW_STATUS = {
  new: "New", confirmed: "Confirmed", paid: "Paid",
  baking: "Preparing", ready: "Packed", delivered: "Delivered",
};

export function snapshotViewData(data) {
  const s = normalize((data && typeof data === "object") ? data : {});
  const list = (k) => (Array.isArray(s[k]) ? s[k] : []);
  const currency = (s.settings && s.settings.currency) || "RM";
  const stockState = { uoms: list("uoms") };

  const products = list("products");
  const productRows = products.map((p) => ({
    name: String(p.name || "").trim() || "(no name)",
    priceText: p.price == null || p.price === "" ? "" : fmtRM(p.price, currency),
    unit: String(p.unit || ""),
    // A draft is never "hidden" (it was never on the shop) — it reads as a
    // draft in the View, distinct from a product she took down.
    draft: p.draft === true,
    hidden: p.draft !== true && p.active === false,
  }));

  const ingredientRows = list("ingredients").map((ing) => {
    const onHand = Math.max(0, Number(ing.onHand) || 0);
    const keep = Math.max(0, Number(ing.safetyBase) || 0);
    return {
      name: String(ing.name || "").trim() || "(no name)",
      onHandText: fmtStockAmount(stockState, ing, onHand),
      keep: keep > 0 ? keep : 0,
      keepText: keep > 0 ? fmtStockAmount(stockState, ing, keep) : "",
      low: belowReserve(keep, onHand),
      hidden: ing.active === false,
    };
  });

  const pById = new Map(products.filter((p) => p.id).map((p) => [p.id, p]));
  const orderOf = (o) => {
    const p = o.productId ? pById.get(o.productId) : null;
    const status = String(o.status || "new");
    return {
      code: orderCode(o),
      product: p ? String(p.name || "(no name)") : "(product no longer listed)",
      qty: Math.max(1, Number(o.qty) || 1),
      customer: String(o.customerName || "").trim() || "(no name)",
      statusLabel: VIEW_STATUS[status] || status,
      courier: o.fulfillment === "courier",
      placed: fmtPlaced(o.createdAt, ""),
    };
  };

  // Group orders by delivery date, oldest date first; orders whose delivery-day
  // row is missing (very old data) get a date-less group so they don't vanish.
  const deliveryDates = list("deliveryDates")
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const byDay = new Map();
  for (const d of deliveryDates) if (d.id) byDay.set(d.id, []);
  const orphans = [];
  for (const o of list("orders")) {
    if (o.deliveryDateId != null && byDay.has(o.deliveryDateId)) byDay.get(o.deliveryDateId).push(o);
    else orphans.push(o);
  }
  const dayRows = [];
  for (const d of deliveryDates) {
    const os = byDay.get(d.id) || [];
    if (os.length) dayRows.push({ date: d.date, orders: os.map(orderOf) });
  }
  if (orphans.length) dayRows.push({ date: "", orders: orphans.map(orderOf) });

  const credits = list("credits");
  let creditRM = 0;
  for (const c of credits) creditRM += Number(c.amountRM) || 0;

  return {
    counts: {
      orders: list("orders").length,
      products: products.length,
      ingredients: list("ingredients").length,
      deliveryDates: deliveryDates.length,
      suppliers: list("suppliers").length,
      uoms: list("uoms").length,
      purchaseOrders: list("purchaseOrders").length,
      credits: credits.length,
      occasions: list("occasions").length,
      customers: list("customers").length,
    },
    creditRM,
    productRows,
    ingredientRows,
    dayRows,
  };
}

// ── network helpers (all { ok, … } shaped, gated on ready + token) ─────────

function netErr(err) {
  return err && err.message ? err.message : "Couldn't reach Supabase";
}

function notReadyReason() {
  return "Shared data is off or you're not signed in";
}

async function getRows(state, select, limit) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason(), rows: [] };
  const limitParam = limit ? `&limit=${limit}` : "";
  try {
    const res = await fetch(`${a.base}/rest/v1/${TABLE}?select=${select}&order=created_at.desc${limitParam}`, {
      headers: { apikey: a.anonKey, Authorization: `Bearer ${a.token}` },
    });
    if (!res.ok) return { ok: false, reason: `Backups failed to load (HTTP ${res.status})`, rows: [] };
    const rows = await res.json().catch(() => []);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, reason: netErr(err), rows: [] };
  }
}

// Light columns only — enough for the cadence decision and the prune pass.
export async function listMeta(state) {
  return getRows(state, "id,kind,created_at", 500);
}

// The Settings card list — adds the human label/summary, still no heavy data.
export async function listBackups(state) {
  return getRows(state, "id,kind,label,engine,created_at,summary", 8);
}

// The one full copy (with data) — fetched on tap for Download or Restore only.
export async function getBackup(state, id) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason(), row: null };
  try {
    const res = await fetch(
      `${a.base}/rest/v1/${TABLE}?select=data,kind,label,engine,summary,created_at&id=eq.${encodeURIComponent(String(id))}&limit=1`,
      { headers: { apikey: a.anonKey, Authorization: `Bearer ${a.token}` } });
    if (!res.ok) return { ok: false, reason: `Backup failed to load (HTTP ${res.status})`, row: null };
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) && rows[0];
    return row ? { ok: true, row } : { ok: false, reason: "That copy is gone", row: null };
  } catch (err) {
    return { ok: false, reason: netErr(err), row: null };
  }
}

async function postSnapshot(state, kind, label, snap) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason() };
  try {
    const res = await fetch(`${a.base}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: a.anonKey,
        Authorization: `Bearer ${a.token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{
        kind,
        label,
        engine: ENGINE_VERSION,
        summary: summaryOf(snap),
        data: JSON.stringify(snap),
      }]),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `Backup failed (HTTP ${res.status})${text ? " — " + text.slice(0, 120) : ""}` };
    }
    return { ok: true, at: new Date().toISOString() };
  } catch (err) {
    return { ok: false, reason: netErr(err) };
  }
}

export async function deleteSnapshots(state, ids) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason() };
  const clean = (ids || []).filter((id) => id != null);
  if (!clean.length) return { ok: true };
  try {
    const res = await fetch(
      `${a.base}/rest/v1/${TABLE}?id=in.(${clean.map((id) => encodeURIComponent(String(id))).join(",")})`,
      { method: "DELETE", headers: { apikey: a.anonKey, Authorization: `Bearer ${a.token}` } });
    if (!res.ok) return { ok: false, reason: `Couldn't delete (HTTP ${res.status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: netErr(err) };
  }
}

// One manual copy ("Back up to cloud now"), kept until the owner deletes it.
export async function backupNow(state) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason() };
  const snap = snapshotState(state);
  const r = await postSnapshot(state, "manual", labelFor("manual"), snap);
  return r.ok ? { ok: true, at: r.at } : r;
}

// The automatic cadence: at most one attempt per local day, silent on failure.
// The guard records the ATTEMPT (not a success) so an offline day isn't retried
// in a loop; the next open on a new day tries again.
let busy = false;
export async function maybeAutoBackup(state) {
  if (busy) return { ok: false, reason: "Already running" };
  if (!auth(state)) return { ok: false, reason: notReadyReason() };
  const today = todayISO();
  try {
    if (localStorage.getItem(GUARD_KEY) === today) return { ok: true, skipped: true };
  } catch { /* no storage — still attempt once */ }
  busy = true;
  try {
    try { localStorage.setItem(GUARD_KEY, today); } catch { /* storage full — ignore */ }
    const meta = await listMeta(state);
    if (!meta.ok) return { ok: true, skipped: "offline" }; // silent — next day retries
    const due = dueKinds(meta.rows, new Date());
    const snap = snapshotState(state);
    for (const kind of due) {
      const r = await postSnapshot(state, kind, labelFor(kind), snap);
      if (!r.ok) return { ok: false, reason: r.reason };
    }
    // Prune after a successful capture; manual copies are never pruned.
    const kill = pruneIds(meta.rows);
    if (kill.length) await deleteSnapshots(state, kill);
    return { ok: true, made: due };
  } finally {
    busy = false;
  }
}

// Rewind this phone (and, via the sync engine, the shared cloud) to a copy.
// Not reversible by itself, so a "Before restore" manual copy is always saved
// first; if that can't be saved the restore aborts.
export async function restoreSnapshot(state, row) {
  const a = auth(state);
  if (!a) return { ok: false, reason: notReadyReason() };

  // A copy without its data (e.g. from the light list) is fetched in full first.
  if (!row || typeof row.data !== "string") {
    const id = row && row.id;
    if (id == null) return { ok: false, reason: "That copy can't be read" };
    const g = await getBackup(state, id);
    if (!g.ok) return g;
    row = g.row;
  }

  let snap;
  try { snap = JSON.parse(row.data); } catch { return { ok: false, reason: "That copy couldn't be read" }; }
  if (!snap || typeof snap !== "object") return { ok: false, reason: "That copy couldn't be read" };

  // Bring the phone's view and the sync baseline up to the cloud first. After
  // the reload, markDirty diffs the restored state against this baseline, so
  // records that only exist in the cloud (added after the copy) are seen as
  // removed and tombstoned instead of coming back on the next pull — that is
  // what makes a restore a real rewind on any phone, fresh or stale.
  const freshen = await sync.refresh(state);
  if (!freshen.ok) return { ok: false, reason: "You need to be online to restore a backup" };

  // Safety copy of the current (freshest) state, so a restore is never one-way.
  const current = snapshotState(state);
  const safe = await postSnapshot(state, "manual", `Before restore · ${localWhen()}`, current);
  if (!safe.ok) return { ok: false, reason: `Couldn't save a "before" copy first: ${safe.reason}` };

  const restored = mergeRestore(state, snap);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(restored));
  } catch (err) {
    return { ok: false, reason: `Couldn't write to this phone: ${netErr(err)}` };
  }
  return { ok: true, at: safe.at };
}
