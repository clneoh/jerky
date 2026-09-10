// supabase.js — publish live availability ("slots left" per delivery day)
// to a Supabase table that the storefront reads. The backoffice stays the
// source of truth; Supabase only holds the published snapshot.
//
// Pure helpers (computeSlots) run under Node for tests; all fetch/localStorage
// access is guarded so importing the module is side-effect free.

import { generateUpcomingDates, shortDate, todayISO } from "./dates.js";
import { effectiveCapacity, effectiveLimit, isPoolablePack, poolRemaining, totalUnitsOnDate } from "./bom.js";
import { byId, fmtRM, newId, orderCode, orderLineName, orderLinePrice, save, stampOrderLine } from "./state.js";

const TOKEN_KEY = "bakeadmin.supabase";

function cfg(state) {
  const s = (state.settings && state.settings.supabase) || {};
  return {
    enabled: !!s.enabled,
    url: String(s.url || "").replace(/\/+$/, ""),
    anonKey: String(s.anonKey || ""),
    email: String(s.email || ""),
    password: String(s.password || ""),
  };
}

function ready(c) {
  return c.enabled && c.url && c.anonKey && c.email && c.password;
}

// The baker's actual upcoming delivery dates (today onward), capped at
// `horizon`. Falls back to the configured weekday pattern only when no real
// delivery date exists yet, so the storefront isn't empty before any dates are
// set up. This is what makes a newly added date reach the storefront: it's a
// real deliveryDate, not a guess from the weekday rule.
//
// Duplicate dates (two deliveryDates entries for the same day — e.g. both
// phones added the same date before they synced) are merged into one row with
// both ids, so the published rows never carry a duplicate `date` key (which
// makes Supabase reject the upsert with HTTP 500) and bookings on both ids
// count toward the day's slots.
function nextDeliveryDates(state, horizon) {
  const seen = new Map(); // date -> [ids]
  for (const d of state.deliveryDates) {
    if (!d || d.date < todayISO()) continue;
    if (seen.has(d.date)) seen.get(d.date).push(d.id);
    else seen.set(d.date, [d.id]);
  }
  const real = [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, horizon)
    .map(([date, ids]) => ({ date, ids }));
  if (real.length) return real;
  return generateUpcomingDates(state.settings, horizon).map((date) => ({ date, ids: [null] }));
}

// Next `horizon` upcoming delivery dates with the slots that remain after
// what's already booked. Clamped at 0 so a full day is simply "Sold out" on
// the storefront.
export function computeSlots(state, horizon = 10) {
  return nextDeliveryDates(state, horizon).map(({ date, ids }) => {
    const capacity = effectiveCapacity(state, date);
    const booked = ids.reduce((s, id) => s + (id ? totalUnitsOnDate(state, id) : 0), 0);
    return { date, slots_left: Math.max(0, capacity - booked), capacity };
  });
}

// Per-product slots: one row per (date, product) for every active product that
// has a daily limit. Products without a limit are unlimited and get no row, so
// the storefront shows no stamp for them. Used for the "Only N left" stamps on
// the product cards.
//
// A product whose recipe is exactly one product line with no limit of its own
// is a value pack sharing its base's pool, so it gets no independent count.
// Instead a DERIVED row is published for it: same date/product key, but
// slots_left = floor(base left / pack size) and pool_base + pool_qty columns
// that let the database tell derived rows apart (they recompute from the pool,
// never self-decrement). The base's own row stays in whole pieces.
export function computeProductSlots(state, horizon = 10) {
  const packs = state.products
    .filter((p) => p.active !== false && isPoolablePack(state, p));
  const bases = state.products
    .filter((p) => p.active !== false && Number(p.limit) > 0);
  const packsByBase = new Map();
  for (const p of packs) {
    const { baseId, baseQty } = isPoolablePack(state, p);
    if (!packsByBase.has(baseId)) packsByBase.set(baseId, []);
    packsByBase.get(baseId).push({ name: p.name, baseQty });
  }
  return nextDeliveryDates(state, horizon).flatMap(({ date, ids }) => {
    const rows = [];
    for (const base of bases) {
      // poolRemaining counts singles AND any set/single of a set that consumes
      // base pieces (recursively), so the base row is the pool's real state.
      // The capacity is the base's limit with that date's +/− delta applied
      // ("this day's bakes"), so a date the owner raised or paused publishes
      // the adjusted count and any value pack derives from it below.
      const capacity = effectiveLimit(state, date, base.id) ?? 0;
      let booked = 0;
      for (const id of ids) {
        if (!id) continue;
        const pr = poolRemaining(state, id, base.id);
        if (pr) booked += pr.booked;
      }
      const baseLeft = Math.max(0, capacity - booked);
      rows.push({ date, product: base.name, slots_left: baseLeft, capacity });
      for (const pack of packsByBase.get(base.id) || []) {
        rows.push({
          date,
          product: pack.name,
          slots_left: Math.floor(baseLeft / pack.baseQty),
          capacity: Math.floor(capacity / pack.baseQty),
          pool_base: base.name,
          pool_qty: pack.baseQty,
        });
      }
    }
    return rows;
  });
}

export function cachedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t.access_token && t.expires_at && Date.now() < t.expires_at) return t.access_token;
  } catch (err) { /* no storage / corrupt token — fall through to login */ }
  return null;
}

// Clear the stored session. Used by the shared-data "Sign out" flow.
export function signOut() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (err) { /* no storage — nothing to clear */ }
}

function cacheToken(token, expiresInSec = 3600) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: token,
      // refresh a minute early to avoid a stale token racing the request
      expires_at: Date.now() + (expiresInSec - 60) * 1000,
    }));
  } catch (err) { /* storage full/unavailable — token just won't be cached */ }
}

export async function login(url, anonKey, email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.msg || data.error || `Login failed (HTTP ${res.status})`);
  }
  cacheToken(data.access_token, data.expires_in);
  return data.access_token;
}

// Publish the current slots. Returns {ok:true, pushed, at} or {ok:false, reason}.
export async function syncAvailability(state) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured" };

  let token = cachedToken();
  if (!token) {
    try {
      token = await login(c.url, c.anonKey, c.email, c.password);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  const upsert = (table, rows, onConflict) =>
    fetch(`${c.url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });

  // Publish EVERY real delivery date the baker has added (today onward) — no
  // fixed window, so a date she adds for weeks ahead is live on the shop at
  // once. Only when she has no real dates yet does it fall back to a short
  // generated peek from the weekday rule (nextDeliveryDates' own fallback),
  // so a brand-new phone can't balloon the tables.
  const realDates = (state.deliveryDates || []).filter((d) => d && d.date >= todayISO()).length;
  const horizon = realDates > 0 ? realDates : 10;

  const rows = computeSlots(state, horizon);
  const res = await upsert("availability", rows, "date");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `Sync failed (HTTP ${res.status})${text ? " — " + text.slice(0, 120) : ""}` };
  }

  // Per-product rows drive the "Only N left" stamps. They come in two shapes —
  // plain rows (a product with its own daily limit) and value-pack rows, which
  // add pool_base/pool_qty so the database can derive them from their base's
  // pool. PostgREST requires every object in one upsert to carry the SAME keys
  // (a mixed batch is rejected with HTTP 400 "All object keys must match"), so
  // the two shapes are pushed as separate batches. The pack batch additionally
  // needs the pool columns — if those aren't in the table yet
  // (supabase/shared_pool_slots.sql hasn't run), that batch alone fails while
  // the plain singles still go through.
  const productRows = computeProductSlots(state, horizon);
  const plainRows = productRows.filter((r) => !("pool_base" in r));
  const packRows = productRows.filter((r) => "pool_base" in r);
  let pushedProducts = 0;
  const pushProductBatch = async (rows) => {
    if (!rows.length) return null;
    const res = await upsert("product_availability", rows, "date,product");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `Product sync failed (HTTP ${res.status})${text ? " — " + text.slice(0, 160) : ""}` };
    }
    pushedProducts += rows.length;
    return null;
  };
  for (const batch of [plainRows, packRows]) {
    const batchErr = await pushProductBatch(batch);
    if (batchErr) return batchErr;
  }

  // Best-effort cleanup: drop published rows for dates that are no longer in
  // the plan (deleted delivery dates) or have passed, so the storefront only
  // ever shows the baker's real upcoming dates. Failures are swallowed — this
  // is housekeeping, not the sync itself.
  if (rows.length) {
    const active = rows.map((r) => `"${r.date}"`).join(",");
    const clean = (table) =>
      fetch(`${c.url}/rest/v1/${table}?date=not.in.(${active})`, {
        method: "DELETE",
        headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    await clean("availability");
    await clean("product_availability");
  }
  return { ok: true, pushed: rows.length, pushedProducts, at: new Date().toISOString() };
}

// Debounced auto-publish, called after order/capacity changes so a burst of
// order entry batches into a single update. Errors are swallowed silently on
// the auto path; the Settings "Sync now" button surfaces them.
let timer = null;
export function maybeSync(state) {
  if (!ready(cfg(state))) return; // never schedule timers when Supabase is off
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { syncAvailability(state); }, 2000);
}

// ────────────────────────────────────────────────────────────────────────────
// Storefront config publish — the customer page's name/menu/WhatsApp/etc.
// The backoffice edits these in Settings → Storefront; this pushes the whole
// config to a row the storefront reads, so edits go live without a redeploy.
// ────────────────────────────────────────────────────────────────────────────

function storefrontPayload(state) {
  const sf = (state.settings && state.settings.storefront) || {};
  // The storefront menu is the backoffice's product list (active only) — one
  // list, so adding/editing/hiding a product in the app updates the customer
  // page after a publish. No separate menu to drift or clobber.
  const products = (Array.isArray(state.products) ? state.products : [])
    .filter((p) => p && p.draft !== true && p.active !== false && String(p.name || "").trim())
    .map((p) => {
      const out = {
        name: String(p.name).trim(),
        price: Number(p.price) || 0,
        unit: String(p.unit || "").trim() || "piece",
      };
      // A short blurb customers read under the name/price ("what is this").
      // Published only when written, so products without one stay key-free.
      const desc = String(p.description || "").trim();
      if (desc) out.description = desc;
      // A clean value pack (one product line, no own limit) shares its base's
      // pool — tell the storefront so it can cap a mixed cart against one
      // budget and enforce the advance-order window. component.name = the base
      // product's name (its availability row is in pieces), qty = pieces per pack.
      const pool = isPoolablePack(state, p);
      if (pool) {
        const base = byId(state.products, pool.baseId);
        if (base) out.component = { name: base.name, qty: pool.baseQty };
      }
      // Per-product date rules: orders close N days before delivery, and/or a
      // fixed from–to window of delivery dates. Only published when set — the
      // storefront fills its own default for packs that don't set a number.
      const close = Number(p.closeDays);
      if (p.closeDays != null && Number.isInteger(close) && close >= 0) out.closeDays = close;
      for (const k of ["validFrom", "validTo"]) {
        const v = p && p[k];
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
      }
      // Optional translated names for 中文 / BM shoppers. Published only when
      // written — blank falls back to the English name on the shop (nameFor).
      for (const k of ["nameZh", "nameMs"]) {
        const v = p && p[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      // The translated description line and selling-unit word a shopper reads
      // on the card (descFor / unitFor on the shop). Auto-translated with the
      // product's English text; blank keeps English. The serving-tip
      // translations never leave the app (they only dress up the baker's
      // follow-up message).
      for (const k of ["descZh", "descMs", "unitZh", "unitMs"]) {
        const v = p && p[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      return out;
    });
  const dev = (state.settings && state.settings.developer) || {};
  const devName = String(dev.name || "").trim();
  const devEmails = Array.isArray(dev.emails)
    ? dev.emails.map((e) => String(e || "").trim()).filter(Boolean)
    : [];
  const devWa = String(dev.whatsapp || "").trim();
  const out = {
    whatsapp: String(sf.whatsapp || ""),
    name: String(sf.name || ""),
    tagline: String(sf.tagline || ""),
    instagram: String(sf.instagram || ""),
    facebook: String(sf.facebook || ""),
    tngQr: String(sf.tngQr || ""),
    deliveryDays: (state.settings && state.settings.deliveryDays) || [],
    cutoff: (state.settings && state.settings.cutoff) || "",
    capacity: (state.settings && state.settings.defaultCapacity) || 0,
    products,
  };
  // The "Website by …" credit for the homepage/store footers — name, the email
  // link(s) and the optional WhatsApp number. Published only when set; the
  // storefront's mergeStorefront drops the keys otherwise.
  if (devName) out.developerName = devName;
  if (devEmails.length) out.developerEmails = devEmails;
  if (devWa) out.developerWhatsapp = devWa;
  return out;
}

export async function syncStorefront(state) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured" };

  let token = cachedToken();
  if (!token) {
    try {
      token = await login(c.url, c.anonKey, c.email, c.password);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  const res = await fetch(`${c.url}/rest/v1/storefront_config?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: c.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ id: "default", data: JSON.stringify(storefrontPayload(state)) }]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `Storefront sync failed (HTTP ${res.status})${text ? " — " + text.slice(0, 120) : ""}` };
  }
  return { ok: true, at: new Date().toISOString() };
}

let sfTimer = null;
export function maybeSyncStorefront(state) {
  if (!ready(cfg(state))) return; // never schedule timers when Supabase is off
  if (sfTimer) clearTimeout(sfTimer);
  sfTimer = setTimeout(() => { syncStorefront(state); }, 2000);
}

// Adopt the storefront details the most recent backoffice user published
// (Settings → Storefront) into this phone's own state. The storefront_config
// row is the source of truth — the same one the customer page reads — so every
// phone shows the same latest name/WhatsApp/tagline/socials/QR as customers
// see, never a stale copy baked in code. Public read (anon key only, no login);
// a missing row, no name, or being offline keeps this phone's local values.
// Mirrors what the Settings editor does when opened, but runs at boot so a
// fresh phone is up to date before its first Settings visit.
export async function refreshStorefront(state) {
  const c = cfg(state);
  if (!c.url || !c.anonKey) return false;
  const base = String(c.url).replace(/\/+$/, "");
  try {
    const res = await fetch(
      `${base}/rest/v1/storefront_config?select=data&id=eq.default&limit=1`,
      { headers: { apikey: c.anonKey } });
    if (!res.ok) return false;
    const rows = await res.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row || typeof row.data !== "string") return false;
    const remote = JSON.parse(row.data);
    if (!remote || typeof remote !== "object" || !remote.name) return false;
    const sf = state.settings.storefront;
    if (typeof remote.name === "string") sf.name = remote.name;
    if (typeof remote.whatsapp === "string") sf.whatsapp = remote.whatsapp;
    if (typeof remote.tagline === "string") sf.tagline = remote.tagline;
    if (typeof remote.instagram === "string") sf.instagram = remote.instagram;
    if (typeof remote.facebook === "string") sf.facebook = remote.facebook;
    if (typeof remote.tngQr === "string") sf.tngQr = remote.tngQr;
    // The developer credit follows the same rule: the published values win, so
    // the More → About ✉ row and the footers match what customers see.
    let dev = state.settings.developer;
    if (!dev || typeof dev !== "object") dev = state.settings.developer = { name: "", emails: [], whatsapp: "" };
    if (typeof remote.developerName === "string" && remote.developerName.trim()) {
      dev.name = remote.developerName.trim();
    }
    if (Array.isArray(remote.developerEmails)) {
      const remoteEmails = remote.developerEmails.map((e) => String(e).trim()).filter(Boolean);
      if (remoteEmails.length) dev.emails = remoteEmails;
    }
    if (typeof remote.developerWhatsapp === "string" && remote.developerWhatsapp.trim()) {
      dev.whatsapp = remote.developerWhatsapp.trim();
    }
    save(state);
    return true;
  } catch {
    return false; // offline or unreachable — keep the local copy
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Order tracking — the customer-facing snapshot of one order. When the baker
// changes an order's status, the backoffice publishes a row here; the
// storefront's "Track your order" card reads it back by order code. The
// customer never sees the backoffice's private order rows — only this copy.
// ────────────────────────────────────────────────────────────────────────────

// One published tracking row for a storefront order group. The code is the
// group's shared order code, so a multi-item customer order tracks as one.
// Pure snapshot of the baker's order state — no side effects, safe under Node.
export function trackingSnapshot(state, group) {
  const orders = (group && group.orders) || [];
  const first = orders[0] || {};
  const del = first.deliveryDateId ? byId(state.deliveryDates, first.deliveryDateId) : null;
  const date = del ? del.date : String(first.deliveryDate || "");
  const courier = first.fulfillment === "courier";
  const fulfillment = courier ? "Post (nationwide)" : "Collect (local)";
  const address = courier && String(first.address || "").trim()
    ? ` · ${String(first.address).trim()}` : "";
  // The customer's tracking page shows what they were sold, at the price they
  // were sold it — never today's menu.
  const items = orders.map((o) => {
    const name = orderLineName(state, o);
    return `${name === "(deleted product)" ? "item" : name} ×${o.qty}`;
  }).join(", ");
  const total = fmtRM(orders.reduce((s, o) => {
    const price = orderLinePrice(state, o);
    return s + (Number(o.qty) || 0) * (price == null ? 0 : price);
  }, 0), state.settings.currency);
  return {
    code: orderCode(first),
    status: first.status || "new",
    delivery: `${date ? shortDate(date) : ""} · ${fulfillment}${address}`,
    items,
    total,
    customer: String(first.customerName || ""),
    updated_at: new Date().toISOString(),
    // The customer's journey map ticks Confirmed/Paid green only when the
    // baker actually pressed Send confirmation / Paid, not when the status was
    // just picked in the dropdown. Publish the flags so the storefront shows
    // the same map as the app. Absent flags (legacy orders saved before these
    // existed) publish as true — those stages really were handled.
    confirmed_sent: first.confirmedSent !== false,
    paid_received: first.paidReceived !== false,
  };
}

// Push one order's tracking row to Supabase so the customer can look it up on
// the storefront track card. Fires on status changes and whenever a stage flag
// flips (Send confirmation / Paid), so the customer's journey map matches the
// app's; best-effort and silent — a publish failure must never block the baker.
export async function publishTracking(state, group) {
  const c = cfg(state);
  if (!ready(c) || !group || !group.orders || !group.orders.length) return;
  let token = cachedToken();
  if (!token) {
    try { token = await login(c.url, c.anonKey, c.email, c.password); }
    catch { return; }
  }
  const row = trackingSnapshot(state, group);
  try {
    await fetch(`${c.url}/rest/v1/order_tracking?on_conflict=code`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    });
  } catch { /* best-effort */ }
}

// ────────────────────────────────────────────────────────────────────────────
// Order intake — customer orders placed on the storefront land in the
// backoffice order list automatically. The storefront inserts a row; this
// polls for new rows, converts each into orders, and deletes the row so it
// isn't imported twice.
// ────────────────────────────────────────────────────────────────────────────

// Whether an incoming order can be imported: it needs a date and every line
// must match an active backoffice product. Rows that fail this are left alone
// (status stays "new") so the owner can add the product and the order retries.
export function importable(state, data) {
  if (!data || !data.date || !Array.isArray(data.lines) || !data.lines.length) return false;
  return data.lines.every((line) => line && line.name
    && state.products.some((p) => p.active !== false
      && String(p.name).trim().toLowerCase() === String(line.name).trim().toLowerCase()));
}

export async function pullIncoming(state) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, imported: [] };

  let token = cachedToken();
  if (!token) {
    try {
      token = await login(c.url, c.anonKey, c.email, c.password);
    } catch {
      return { ok: false, imported: [] };
    }
  }

  try {
    const auth = { apikey: c.anonKey, Authorization: `Bearer ${token}` };
    const res = await fetch(
      `${c.url}/rest/v1/incoming_orders?select=id,data&status=eq.new&limit=50`,
      { headers: auth });
    if (!res.ok) return { ok: false, imported: [] };
    const rows = await res.json().catch(() => []);
    const imported = [];
    for (const row of rows) {
      if (!row || !row.id) continue;
      let data;
      try { data = JSON.parse(row.data); } catch { continue; }
      // Unimportable rows (unknown product, missing date) stay status=new so
      // they keep retrying instead of being claimed and lost.
      if (!importable(state, data)) continue;
      // Claim first: the PATCH filters status=eq.new, so only one phone can
      // flip it to imported. A row another phone already claimed matches 0
      // rows and is skipped — the fix for orders appearing as "new" twice.
      const claim = await fetch(
        `${c.url}/rest/v1/incoming_orders?id=eq.${row.id}&status=eq.new`,
        {
          method: "PATCH",
          headers: { ...auth, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ status: "imported" }),
        }).catch(() => null);
      if (!claim || !claim.ok) continue;
      const claimed = await claim.json().catch(() => []);
      if (!Array.isArray(claimed) || !claimed.length) continue;
      const created = importIncoming(state, row);
      if (!created) continue;
      imported.push(row.id);
      // The claim already prevents a second import; delete is just cleanup.
      await fetch(`${c.url}/rest/v1/incoming_orders?id=eq.${row.id}`, {
        method: "DELETE",
        headers: auth,
      }).catch(() => {});
    }
    if (imported.length) save(state);
    return { ok: true, imported };
  } catch {
    return { ok: false, imported: [] };
  }
}

// Turn one incoming_orders row into backoffice orders. Lines whose name doesn't
// match a backoffice product are skipped (the owner adds them by hand). Creates
// the delivery date if it isn't in the plan yet. Returns the created order ids,
// or null when nothing matched.
function importIncoming(state, row) {
  let data;
  try { data = JSON.parse(row.data); } catch { return null; }
  if (!data || !data.date || !Array.isArray(data.lines)) return null;

  const dateStr = String(data.date);
  let del = state.deliveryDates.find((d) => d.date === dateStr);
  if (!del) {
    del = { id: newId("del"), date: dateStr, notes: "" };
    state.deliveryDates.push(del);
  }

  const created = [];
  const now = new Date().toISOString();
  // One storefront cart can contain several items. They share a groupId so the
  // backoffice shows them as a single order (status / badge / inbox count it
  // once) while each item stays its own row for availability math.
  const groupId = data.lines.length > 1 ? newId("ordg") : null;
  for (const line of data.lines) {
    if (!line || !line.name) continue;
    const qty = Math.max(1, Number(line.qty) || 1);
    const product = state.products.find(
      (p) => p.active !== false
        && String(p.name).trim().toLowerCase() === String(line.name).trim().toLowerCase());
    if (!product) continue;
    const order = {
      id: newId("ord"),
      deliveryDateId: del.id,
      deliveryDate: dateStr,
      orderDate: todayISO(),
      productId: product.id,
      qty,
      customerName: String(data.customer || "").trim(),
      whatsapp: String(data.whatsapp || "").trim(),
      referredBy: String(data.referredBy || "").trim(), // the ?via= link stamp
      fulfillment: data.fulfillment === "courier" ? "courier" : "collect",
      address: String(data.address || "").trim(),
      note: String(data.note || "").trim(),
      status: "new",
      source: "storefront",
      groupId,
      createdAt: now,
    };
    // Freeze what the shop sold it as, at the price the shop charged. The
    // storefront sends its own name/price with the line; fall back to the
    // product only when the line didn't carry one.
    stampOrderLine(order, {
      name: product.name,
      price: line.price != null && line.price !== "" ? line.price : product.price,
    });
    state.orders.push(order);
    created.push(order.id);
  }
  return created.length ? created : null;
}

// ─────────────────────────────────────────────────────────────
// Customer reviews moderation — More → Reviews.
// Reviews posted from the homepage (supabase/reviews.sql) start unpublished and
// only show there once the owner Publishes one here. Same anon-insert /
// authenticated-moderation RLS model as incoming_orders.
// ─────────────────────────────────────────────────────────────
async function reviewAuth(c) {
  let token = cachedToken();
  if (!token) token = await login(c.url, c.anonKey, c.email, c.password);
  return { apikey: c.anonKey, Authorization: `Bearer ${token}` };
}

function reviewErr(err, fallback) {
  return err && err.message ? err.message : fallback;
}

// Every review, newest first (published and waiting). The view splits them.
export async function fetchReviews(state) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured", reviews: [] };
  try {
    const res = await fetch(
      `${c.url}/rest/v1/reviews?select=id,name,stars,message,lang,photo,published,created_at&order=created_at.desc`,
      { headers: await reviewAuth(c) });
    if (!res.ok) return { ok: false, reason: `Reviews failed to load (HTTP ${res.status})`, reviews: [] };
    const rows = await res.json().catch(() => []);
    return { ok: true, reviews: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, reason: reviewErr(err, "Couldn't reach Supabase"), reviews: [] };
  }
}

export async function setReviewPublished(state, id, published) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured" };
  try {
    const res = await fetch(`${c.url}/rest/v1/reviews?id=eq.${encodeURIComponent(String(id))}`, {
      method: "PATCH",
      headers: { ...(await reviewAuth(c)), "Content-Type": "application/json" },
      body: JSON.stringify({ published: !!published }),
    });
    if (!res.ok) return { ok: false, reason: `Update failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reviewErr(err, "Couldn't reach Supabase") };
  }
}

export async function deleteReview(state, id) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured" };
  try {
    const res = await fetch(`${c.url}/rest/v1/reviews?id=eq.${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      headers: await reviewAuth(c),
    });
    if (!res.ok) return { ok: false, reason: `Delete failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reviewErr(err, "Couldn't reach Supabase") };
  }
}

// How many homepage reviews are waiting to be published (published = false).
// Reviews live only in Supabase (never local state), so every screen that wants
// to hint "N waiting" asks the cloud. Returns a count, or null when Supabase
// isn't configured / reachable — callers then show nothing rather than 0.
export async function pendingReviewCount(state) {
  const c = cfg(state);
  if (!ready(c)) return null;
  try {
    const res = await fetch(
      `${c.url}/rest/v1/reviews?select=id&published=eq.false`,
      { headers: await reviewAuth(c) });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? rows.length : null;
  } catch {
    return null;
  }
}
