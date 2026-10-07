// supabase.js — publish live availability ("slots left" per delivery day)
// to a Supabase table that the storefront reads. The backoffice stays the
// source of truth; Supabase only holds the published snapshot.
//
// Pure helpers (computeSlots) run under Node for tests; all fetch/localStorage
// access is guarded so importing the module is side-effect free.

import { generateUpcomingDates, shortDate, todayISO } from "./dates.js";
import { normRules } from "../../availability.js";
import { publishOccasions } from "./occasion_catalog.js";
import { flattenTree, primaryCategoryId, productsInCategory } from "./productCategories.js";
import { isThumb, lineNoteOf } from "../../storefront-fields.js";
import { bookedUnitsOnDate, effectiveCapacity, effectiveLimit, isPoolablePack, poolRemaining } from "./bom.js";
import { byId, fmtRM, newId, orderCode, orderLineName, round2, save, stampOrderLine } from "./state.js";
import { phoneDigits } from "./customers.js";
import { customerTotal } from "./courier.js";
// The promo-code engine. Only two things are asked of it here: what the shop may
// advertise and judge (publishCodes), and how a code a customer typed is spelled
// by the time it reaches an order (normCode).
import { normCode, publishCodes } from "./promo.js";
import { pointById, publishPoints } from "./points.js";
import { usageByCode } from "./promo-usage.js";
// The trip on the order, read through the one helper that decides what a half-written
// record means. NOT the courier registry: this module is imported by the channel that
// talks to a courier (couriers/api.js reads its session token), so reaching for the
// registry here would close a loop between the two. Everything published about a trip
// is therefore already ON the record — its courier's name, its phase and its driver are
// written there when the trip is booked or checked, and this only carries them across.
import { jobOf, promisedWindowSuffix, courierDeliveryText } from "./courier_job.js";
// The parcel record (v226) — the second KIND of courier. See js/parcel.js.
import { parcelOf, parcelHanded } from "./parcel.js";
// The shop's own payload is untrusted input, so the one rule about what a place
// IS is asked rather than a second copy of it written here — the same reason
// sync.js asks it. See customerPlaceOf in courier_place.js for what the answer is
// allowed to do afterwards (nothing, until she presses).
import { validPlace } from "./courier_place.js";

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
  return nextDeliveryDates(state, horizon).map(({ date }) => {
    const capacity = effectiveCapacity(state, date);
    // ⚠️ The SAME function the Orders chip and the Delivery Dates card read — see
    // bookedUnitsOnDate in bom.js. This used to be its own sum, and the two disagreed.
    const booked = bookedUnitsOnDate(state, date);
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
      // ⚠️ ONE call for the whole date — `poolRemaining` counts every record carrying that
      // day itself (see idsForDateOf in bom.js). Looping the ids and adding them up
      // DOUBLE-counted the moment two records shared a date, and it was the pool path
      // that still disagreed with the shop after the day's own count was fixed.
      const anyId = ids.find(Boolean);
      const pr = anyId ? poolRemaining(state, anyId, base.id) : null;
      const booked = pr ? pr.booked : 0;
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

  // Best-effort cleanup: drop published rows that no longer describe anything she sells, so the
  // storefront only ever shows her real upcoming dates and her real products. Failures are
  // swallowed — this is housekeeping, not the sync itself.
  //
  // ⚠️⚠️ TWO KINDS OF ORPHAN, AND ONLY THE FIRST WAS EVER CLEANED. Her own table, 7 Oct 2026:
  // ten product rows for the 9th still dated **16 September**, under names she no longer sells,
  // and "Chicken Jerky (Taster)" frozen at **9 left** while the day itself read 120 of 120 —
  // one taken, the other not, on the same day. The cause: a row is only ever deleted when its
  // **date** is gone, so a row whose **product** is gone is immortal. A product that carried a
  // daily limit, took orders (so its row went down), and then had the limit taken off gets **no
  // row from `computeProductSlots` at all** — so nothing ever rewrites it, and the storefront
  // keeps stamping "Only N left" — or "Sold out" once it reaches 0 — from a count that stopped
  // moving the day the limit went. The app, meanwhile, treats that product as unlimited.
  // **That is a shop and an app permanently telling a customer two different things.**
  if (rows.length) {
    const active = rows.map((r) => `"${r.date}"`).join(",");
    const clean = (filter) =>
      fetch(`${c.url}/rest/v1/product_availability?${filter}`, {
        method: "DELETE",
        headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    await fetch(`${c.url}/rest/v1/availability?date=not.in.(${active})`, {
      method: "DELETE",
      headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` },
    }).catch(() => {});
    await clean(`date=not.in.(${active})`);
    // …and, for the dates she IS publishing, any product name she no longer publishes.
    // ⚠️ GUARDED ON A NON-EMPTY LIST: `not.in.()` with nothing to keep matches everything and
    // would wipe the table. A shop with no limited product publishes no rows, and then there is
    // nothing to keep — but also nothing to delete a name FOR, so skipping is right.
    const names = productRows.map((r) => `"${r.product}"`).join(",");
    if (names) await clean(`date=in.(${active})&product=not.in.(${names})`);
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
      // The days this product SELLS, marked on its own calendar: spans, each
      // carrying the weekdays it covers (none = every day of the span, either end
      // may be open). Kept to a sane length and re-checked on the shop's own
      // terms, because this list alone decides whether a customer sees the
      // product at all. No marks publishes no key, which the shop reads as
      // "sell every delivery day".
      const marked = normRules(p.sellRules).slice(0, 40);
      if (marked.length) out.sellRules = marked;
      // How long the customer may still change or cancel this product's order —
      // shown on the card and in a mixed order's strictest window. Published
      // only when set; blank means the product states no window.
      const cancel = Number(p.cancelDays);
      const cancelSet = p.cancelDays != null && !(typeof p.cancelDays === "string" && p.cancelDays.trim() === "");
      if (cancelSet && Number.isInteger(cancel) && cancel >= 0) out.cancelDays = cancel;
      // Keep this product on the shop when it cannot be ordered, instead of
      // dropping it from the menu — the few hot items a customer comes back
      // looking for. Published only while switched on, so an absent key leaves
      // the storefront reading every product exactly as it does today.
      if (p.alwaysListed === true) out.alwaysListed = true;
      // Does this product invite a note? (v236.) The shop draws a small "Add a
      // note" link on the card and carries whatever the customer types on the
      // ordered LINE. Published only while switched on, so an absent key leaves
      // the storefront reading every product exactly as it does today — and a
      // shop-side recheck of its own lives in store/app.js's merge, as with
      // every other field that crosses this boundary.
      if (p.askNote === true) out.askNote = true;
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
      // The product's thumbnail. Published only when it IS one (see
      // storefront-fields.js), so a value a phone mangled — or a huge pasted one
      // — is dropped here rather than sent to every customer's phone and carried
      // in every backup.
      if (isThumb(p.thumb)) out.thumb = String(p.thumb).trim();
      // Where this product sits among the ones no heading carries ("More items")
      // — the only place a product's own `sort` is read. Published only when she
      // has dragged one, so an untouched product keeps the order it was stored
      // in and nothing moves on the shop on the day this arrives.
      const sort = Number(p.sort);
      const sortSet = p.sort != null && !(typeof p.sort === "string" && p.sort.trim() === "");
      if (sortSet && Number.isFinite(sort)) out.sort = sort;
      return out;
    });
  // The shop's category headings, in her order, each naming the products shown
  // under it. Depth-first — parents before their children — so the shop draws
  // the whole tree by walking this list once, `depth` being the indent.
  //
  // Per-product NAMES, not ids: the customer page keys everything it holds about
  // a product by name (availability, the shared pool, the order itself), so
  // publishing names here needs no id lookup to place a card, and a product
  // renamed after it was filed cannot go missing from its own heading.
  const catList = Array.isArray(state.productCategories) ? state.productCategories : [];
  const categories = flattenTree(catList)
    .filter(({ cat }) => String(cat.name || "").trim())
    .map(({ cat, depth }) => {
      const row = {
        name: String(cat.name).trim(),
        depth,
        // Only what this category actually shows: the products whose FIRST tick
        // is this category, and which are actually on the shop. A product filed
        // under two headings is named under the first one only, so it is never
        // drawn twice.
        products: productsInCategory(state, cat.id)
          .filter((p) => p && p.draft !== true && p.active !== false && String(p.name || "").trim())
          .filter((p) => primaryCategoryId(catList, p) === cat.id)
          .map((p) => String(p.name).trim()),
      };
      for (const k of ["nameZh", "nameMs"]) {
        const v = cat && cat[k];
        if (typeof v === "string" && v.trim()) row[k] = v.trim();
      }
      return row;
    });
  const dev = (state.settings && state.settings.developer) || {};
  const devName = String(dev.name || "").trim();
  const devEmails = Array.isArray(dev.emails)
    ? dev.emails.map((e) => String(e || "").trim()).filter(Boolean)
    : [];
  const devWa = String(dev.whatsapp || "").trim();
  // What every code has done so far, recounted from her own orders at the moment
  // of publishing — never read off the record, which only ever holds what the
  // last recount wrote. The shop judges "has this been fully claimed" with these
  // two numbers, so a code that has given away everything it was allowed stops
  // being advertised and stops being accepted the next time she publishes.
  const usage = usageByCode(state);
  const out = {
    whatsapp: String(sf.whatsapp || ""),
    name: String(sf.name || ""),
    tagline: String(sf.tagline || ""),
    instagram: String(sf.instagram || ""),
    facebook: String(sf.facebook || ""),
    tngQr: String(sf.tngQr || ""),
    policy: String(sf.policy || ""),
    policyZh: String(sf.policyZh || ""),
    policyMs: String(sf.policyMs || ""),
    deliveryDays: (state.settings && state.settings.deliveryDays) || [],
    cutoff: (state.settings && state.settings.cutoff) || "",
    capacity: (state.settings && state.settings.defaultCapacity) || 0,
    products,
    // The standard days she has loaded onto her own calendar, for the tinted days
    // and their tap-to-name bubble on the customer's delivery calendar. Always
    // sent, even as an empty list, so deleting her last mark really does take the
    // tints off the shop. publishOccasions drops everything she typed herself.
    occasions: publishOccasions(state.occasions, todayISO()),
    // Always sent, even empty, like the occasions above: an emptied tree is an
    // answer ("she deleted her last category"), and it has to take the headings
    // off a page that is already open.
    categories,
    // The promo codes the shop may judge — and, for the public ones, advertise.
    // Always sent, even empty, for the same reason as the two lists above: the
    // payload replaces the whole row, so an absent key would leave the shop
    // running yesterday's codes. A personal code is published too, because the
    // shop can only accept one that a customer types, and the customer's own
    // personal code is the only way its owner can use it; "personal" means never
    // advertised, never secret. See publishCodes in js/promo.js.
    promoCodes: publishCodes(state, (c) => usage.get(c.code) || { used: 0, given: 0 }),
    // The Self collection Points the shop may OFFER (v299) — id and name only, and active
    // ones only. The receiver, their phone, the fee and even the address stay here: the
    // shop is public, and the message that tells a customer where to go is built from her
    // own copy. Always sent, even empty, for the same reason the lists above are.
    points: publishPoints(state),
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
    // the More → Settings & this app ✉ rows and the footers match what customers see.
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
  // The customer's total, from the one helper the messages use too, so the card and the
  // messages can never quote different figures. This is what makes the card agree with
  // the WhatsApp that asked them for money: it is the items plus the delivery charge,
  // which is the flat postage on an order with none recorded. A charge YOU pay is your
  // own cost and is not published here at all — it is not theirs to see (20 Sep 2026).
  // The full add-up lives in their WhatsApp message, which is where they are asked.
  //
  // A COD charge is published as its own column rather than folded in, because this
  // total is what the card tells them the order comes to — and the courier is about to
  // ask them for the charge at the door (19 Sep 2026).
  const {
    courier: courierFee, cod: courierCod, quoted, total: totalNum,
    promo: promoRm, promoCode, coupon: couponRm,
  } = customerTotal(state, group);
  // ★★ THE CARD'S DISCOUNT COLUMN CARRIES BOTH KINDS (v323), AND THAT IS DELIBERATE.
  // A customer who ordered through a friend's link has the RM3 taken off their total — and
  // until this, the card showed the LOWER TOTAL WITH NOTHING SAYING WHY, which is the one
  // thing this app never lets a figure do.
  //
  // ⚠️ **IT REUSES `promo_rm` RATHER THAN ADDING A COLUMN, AND THE NOTE ABOVE IS THE REASON:
  // a column that does not exist yet kills publishing for EVERY order, silently.** `promo_rm`
  // already means "the discount on this order", and it can only ever hold ONE discount,
  // because **a code and the friend's coupon can never both apply** (see `customerTotal`).
  // So `promo_rm = promoRm + couponRm` is not two things in one field — it is the one
  // discount, whichever it happens to be.
  //
  // ⚠️ **AND AN EMPTY `promo_code` BESIDE A DISCOUNT MEANS "bring-a-friend", WITH NO FLAG
  // NEEDED.** A code always has a name — the app refuses to let one be labelled without it —
  // so `off > 0 && !code` can only be the friend's discount. The shop has its own words for
  // that, in all three languages, and picks them on exactly that test.
  const total = fmtRM(totalNum, state.settings.currency);
  // The booked trip, as the order itself remembers it. Every one of these is null on an
  // order with no trip, and the customer's card leaves its line out rather than printing
  // an empty label — the same rule the tracking number and the charge already follow.
  //
  // `courier_phase` is one of a handful of NEUTRAL words, never the courier's own status:
  // the customer's page carries its own words for those phases in all three languages, so
  // it stays ignorant of which company is carrying the box and of that company's
  // vocabulary. `courier_name` names the carrier holding a parcel, and is published only
  // for one — see the field itself below for why a trip's own name is left out.
  //
  // NOTE: all five need supabase/courier_job.sql run once, before this build is deployed
  // (see that file). A missing column kills publishing for EVERY order silently, because
  // pushTracking swallows its errors — the same trap courier_fee.sql documents.
  //
  // GATED on the order being a courier order (v268): switching an order to Self collect
  // deliberately KEEPS the three charge keys and the trip, because she may switch back —
  // so the reader, not the writer, is what keeps this card honest. An order she now
  // collects herself must not publish a driver, a plate, a phone number or a waybill to
  // its customer. Same rule as the row's own `fulfill-tag` (see views/orders.js).
  const trip = courier ? jobOf(first) : null;
  const driver = (trip && trip.driver) || null;
  // A parcel she posts herself (v226). It carries no driver and no live link, so its
  // half of the card is only ever the carrier's name and "collected" — which is the
  // exact neutral word for the carrier having the box, and the only progress fact she
  // can supply. Both are suppressed on anything that is not a courier order, and the
  // trip WINS when there is one: a real vehicle the customer is being shown must never
  // be contradicted by an older record (see views/orders.js for the same rule).
  const parcel = (first.fulfillment === "courier" && !trip) ? parcelOf(first) : null;

  // ★★ A TRIP THAT IS STILL LOOKING FOR A DRIVER TELLS THE CUSTOMER NOTHING (v338).
  //
  // Her words: *"the lalamove link should not be there because the driver might not be confirming, it
  // only create more confusion if they were to click the link. Lalamove link and Delivery: Finding a
  // driver, should not be send at this stage."*
  //
  // A booking lands in the courier's own "assigning a driver" status at once, which is the phase this
  // app calls `finding` — so the card said "Delivery: Finding a driver" and offered a live link the
  // moment she booked, before any driver had taken the job, and a link that leads somewhere the
  // customer cannot use. **Nothing is thrown away:** the order keeps its phase and its link, her own
  // screens read them exactly as before, and only the sending stops. A PARCEL is untouched — it has no
  // trip, and a carrier's own number is precisely what a customer needs.
  const searching = !!(trip && String(trip.phase || "").trim() === "finding");

  // The day and the window, in one clause. A courier order is promised the VAN's own day and window
  // (v338); everything else keeps exactly the promise it had. Built here rather than inline so the
  // comma cannot end up doubled or missing — the customer's card prints this string verbatim.
  const courierWhen = courier ? courierDeliveryText(first) : "";
  const whenText = courier
    ? (courierWhen ? `, ${courierWhen}` : "")
    : promisedWindowSuffix(state, first);
  return {
    code: orderCode(first),
    status: first.status || "new",
    // The courier's tracking number, as you typed it on the order. Null when there
    // is none (a collect order, or one not posted yet) — the customer's card
    // leaves the line out entirely rather than printing an empty label.
    //
    // ⚠️ Withheld while the trip is still LOOKING FOR A DRIVER (v338): on a booked trip this field
    // carries the courier's own share link, and a customer handed a live link before a driver has
    // taken the job can only be confused by it. You keep it on your screen; they do not get it yet.
    tracking_no: (courier && !searching && String(first.trackingNo || "").trim()) || null,
    // The courier's charge, when the customer bears it. Null when they don't — you
    // pay it, or there is no charge — and the card leaves the line out rather than
    // printing an empty label. NOTE: this column needs supabase/courier_fee.sql run
    // once, before this build is deployed (see that file).
    //
    // Deliberately NOT set for the flat postage: that fee is never published, so a
    // posted order's card carries the total it makes up without naming the fee.
    //
    // The WHOLE charge, whatever way it is settled: the card names it either way, and
    // only the wording of the line changes with the flag below.
    courier_fee: (courierFee + courierCod) || null,
    // True when the courier collects the charge at the door rather than it being paid
    // with the order — so the card says so instead of leaving them to wonder why the
    // total is less than the charge. Null otherwise, and the line reads as before.
    // NOTE: this column needs supabase/courier_cod.sql run once, before this build is
    // deployed (see that file). A missing column kills publishing for EVERY order
    // silently, because publishTracking swallows its errors.
    courier_cod: courierCod > 0 ? true : null,
    // The delivery cost is not settled yet: a posted order, in quote-by-courier mode,
    // with no charge recorded on it. True tells the card to say so instead of leaving
    // them with a total that looks like the whole cost, and it disappears the moment
    // she records what the courier charged (when courier_fee above takes over). Null
    // on every other order, so the card draws exactly what it always drew.
    // NOTE: this column needs supabase/postage_mode.sql run once, before this build is
    // deployed (see that file) — a missing column kills publishing for EVERY order.
    postage_quoted: quoted === true ? true : null,
    // The promo code on the order and the ringgit it took off, so the customer's card
    // can show the same line their WhatsApp message shows. Null on an order that
    // carried no code, and the card then leaves the line out rather than printing an
    // empty label — the rule tracking_no and the charge columns already follow.
    //
    // The AMOUNT is published rather than left for the card to work out: the code list
    // it would need is published too, but a code she has since deleted is not on it,
    // and a card that could not price an order it is showing would be worse than no
    // card at all. NOTE: both columns need supabase/promo_track.sql run once, before
    // this build is deployed (see that file) — and a missing column kills publishing
    // for EVERY order silently, because pushTracking swallows its errors.
    promo_code: promoCode || null,
    // The ONE discount on this order — a code, or the friend's first-order coupon, never
    // both. See the note where this number is worked out.
    promo_rm: (promoRm + couponRm) > 0 ? round2(promoRm + couponRm) : null,
    // Who is carrying it, where it has got to, and who is driving — each null when the
    // order has no trip or the trip has not told us that yet.
    //
    // `courier_name` is the carrier HOLDING A PARCEL, and is published ONLY for a parcel
    // (v226). A booked trip already reaches the customer through the driver line, and its
    // own name is deliberately not published here: the shop's rule is to name a carrier
    // exactly when nobody else is named, so a trip that has told us nothing yet — a
    // booking whose status this build has no phase for — would otherwise gain a carrier
    // line it never had. Which carrier belongs on a card is knowledge this side holds, so
    // the trip/none guarantee is enforced here rather than guessed at from the columns.
    courier_name: (parcel && String(parcel.carrierName || "").trim()) || null,
    // "collected" only once she has recorded the hand-over: a parcel sitting on the
    // counter is not with the carrier yet, and a phase published before the fact would
    // tell the customer something that has not happened. No hand-over, no phase — the
    // card then leaves its line off, exactly as it does for a trip that has said nothing.
    // ⚠️ And the phase itself is withheld while the trip is still finding a driver (v338) — "Delivery:
    // Finding a driver" is a status about a job nobody has taken, and it reads to a customer as though
    // something were already happening. From the moment a driver is on the way, it publishes as before.
    courier_phase: (!searching && trip && String(trip.phase || "").trim())
      || (parcel && parcelHanded(first) ? "collected" : null) || null,
    courier_driver: (driver && String(driver.name || "").trim()) || null,
    courier_plate: (driver && String(driver.plate || "").trim()) || null,
    courier_phone: (driver && String(driver.phone || "").trim()) || null,
    // The day, and — on a consolidated run — the window the van will come in. The window
    // rides INSIDE this string rather than in a column of its own (v191): this column is
    // already published, already read by the storefront's `select` and already printed on
    // the customer's card, so a window that lives in it needs no migration, no storefront
    // change and cannot be the thing that breaks publishing for every other order.
    //
    // promisedWindowSuffix is the PUBLISHING gate, not a formatter: it answers "" for a
    // window that could not be typed (an end before its start), so a half-typed promise in
    // a box she is still looking at can never reach a customer — and for an order being
    // collected at a Point (v304) it names the POINT's own collection hours rather than the
    // van's arrival window, which is when the bread gets there and is not the customer's.
    //
    // ⚠️ **A COURIER ORDER CARRIES THE VAN'S OWN DAY HERE (v338), and that is what fixes the last
    // of this week's bug.** Until now this string glued the van's window to the BAKE day — so a card
    // for an order baked Wednesday and delivered Thursday morning read "Wed, 7 Oct … 9-11 am", which
    // is a time on a day the van never comes. `courierDeliveryText` words the van's day and window
    // together, or the window alone when no day has been typed — **byte-for-byte what this line
    // produced before, so every order that carries no courier day is untouched.**
    delivery: `${date ? shortDate(date) : ""} · ${fulfillment}${address}${whenText}`,
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

// The card's own content, without the timestamp of when it happened to be
// written: two rows equal here are the same card, so there is nothing to publish.
function cardContent(row) {
  const { updated_at: _at, ...content } = row;
  return JSON.stringify(content);
}

// What THIS device last published, by order code. In memory only, and that is the
// safe way to be wrong: a fresh page load has published nothing, so the first save
// after a reload always writes, and the most it can cost is one redundant write.
const published = new Map();

async function pushTracking(c, row, content) {
  let token = cachedToken();
  if (!token) {
    try { token = await login(c.url, c.anonKey, c.email, c.password); }
    catch { return; }
  }
  try {
    const res = await fetch(`${c.url}/rest/v1/order_tracking?on_conflict=code`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    });
    // Remembered only for a write the server took. A publish that failed — a column
    // missing because a SQL script has not been run, a phone with no signal — must be
    // tried again by the next save rather than counted as done (19 Sep 2026).
    if (res && res.ok) published.set(row.code, content);
  } catch { /* best-effort */ }
}

// Push one order's tracking row to Supabase so the customer can look it up on
// the storefront track card. Fires on status changes and whenever a stage flag
// flips (Send confirmation / Paid), so the customer's journey map matches the
// app's; best-effort and silent — a publish failure must never block the baker.
export async function publishTracking(state, group) {
  const c = cfg(state);
  if (!ready(c) || !group || !group.orders || !group.orders.length) return;
  const row = trackingSnapshot(state, group);
  await pushTracking(c, row, cardContent(row));
}

// Publish only when the card's own content actually moved. Every door that can change
// what the customer sees calls THIS, so none of them has to know the card's field list
// — a list kept by hand is what let an edit that changed the items, the price or the
// address walk straight past it, leaving the customer reading the order it used to be
// (19 Sep 2026). One published row per code, and the whole row is compared, so a field
// added to the card later is covered without any door being told about it.
export async function maybePublishTracking(state, group) {
  const c = cfg(state);
  if (!ready(c) || !group || !group.orders || !group.orders.length) return;
  const row = trackingSnapshot(state, group);
  const content = cardContent(row);
  if (published.get(row.code) === content) return;
  await pushTracking(c, row, content);
}

// Test seam: the map above is per-process, so a suite that publishes the same card
// twice from identical fixtures can start from a clean sheet.
export function forgetPublishedCards() {
  published.clear();
}

// ── the receipt number (v360) ───────────────────────────────────────────────
//
// ⚠️ THE NUMBER COMES FROM THE DATABASE AND FROM NOWHERE ELSE. `supabase/receipts.sql`
// holds the counter and an IDEMPOTENT function: an order that already has a number gets
// that number back and consumes nothing. So calling this twice — a second press of Paid,
// the other phone, opening the receipt again — is safe by construction, and cannot leave
// the gap in the sequence that a local counter would.
//
// ⚠️ AND IT NEVER BLOCKS HER. A claim that cannot be made (no signal, the SQL not yet
// run) simply returns false and leaves the order unnumbered. The Paid press has already
// been saved by then, and the next claim — opening the receipt — tries again. That is
// also what makes the deploy safe: the app works before the SQL is run and after it.
//
// Returns true when the order now genuinely holds a number.
export async function claimReceipt(state, order) {
  if (!order) return false;
  // ⚠️⚠️ A RECEIPT IS FOR MONEY RECEIVED, AND THIS IS WHERE THAT IS ENFORCED. An order that
  // has not been paid must never draw a number: that would put a serial on a receipt the
  // books do not have, and every number after it would be one ahead of a sale that never
  // happened. **The guard lives HERE and not only on the screen that calls it** — v358's
  // lesson, and the case it covers is a second phone or a future caller, which no
  // screen-level check can reach.
  if (!order.paidReceived) return false;
  // Already numbered: nothing to ask the server for. This is the ordinary path on every
  // press after the first, and it is why a reprint costs no network at all.
  if (Number(order.receiptNo) > 0) return true;
  const c = cfg(state);
  if (!ready(c)) return false;
  const code = String(orderCode(order) || "").trim();
  if (!code) return false;
  let token = cachedToken();
  if (!token) {
    try { token = await login(c.url, c.anonKey, c.email, c.password); }
    catch { return false; }
  }
  try {
    const res = await fetch(`${c.url}/rest/v1/rpc/claim_receipt_number`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_order_code: code }),
    });
    if (!res || !res.ok) return false;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const n = Number(row && row.number);
    if (!Number.isFinite(n) || n <= 0) return false;
    order.receiptNo = n;
    // ⚠️ A REFUND IS CARRIED BACK TOO, and it only ever ADDS a mark. The server decides
    // whether this order has been refunded; a phone that has never seen the refund learns
    // about it here rather than by assuming the order is clean.
    if (row.refunded_at) order.refundedAt = String(row.refunded_at);
    return true;
  } catch { return false; }
}

// One call to one receipt function, and the same two answers for both: it worked, or it did
// not. ⚠️ KEEPING THE TWO IN ONE PLACE IS NOT TIDINESS. A refund and the undoing of it must
// send the same body and read the same reply; two copies of that are two chances to drift,
// and the thing that would drift is her books.
async function receiptRpc(state, order, fn) {
  if (!order) return false;
  const c = cfg(state);
  if (!ready(c)) return false;
  const code = String(orderCode(order) || "").trim();
  if (!code) return false;
  let token = cachedToken();
  if (!token) {
    try { token = await login(c.url, c.anonKey, c.email, c.password); }
    catch { return false; }
  }
  try {
    const res = await fetch(`${c.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: c.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_order_code: code }),
    });
    return !!(res && res.ok);
  } catch { return false; }
}

// Mark one order's receipt refunded. ⚠️ IT MARKS, IT NEVER DELETES — the number stays
// spent for ever, or the sequence shows a gap where money really moved.
export async function refundReceipt(state, order) {
  if (!(await receiptRpc(state, order, "refund_receipt"))) return false;
  order.refundedAt = new Date().toISOString();
  return true;
}

// Take the mark back off — for a refund made on the wrong order. ⚠️ IT CLEARS A MARK AND
// NOTHING ELSE: the number stays, because a receipt that vanished would leave the gap the
// whole table exists to prevent.
export async function unrefundReceipt(state, order) {
  if (!(await receiptRpc(state, order, "unrefund_receipt"))) return false;
  delete order.refundedAt;
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Order intake — customer orders placed on the storefront land in the
// backoffice order list automatically. The storefront inserts a row; this
// polls for new rows, converts each into orders, and deletes the row so it
// isn't imported twice.
// ────────────────────────────────────────────────────────────────────────────

// Whether an incoming order can be imported: it needs a date, and AT LEAST ONE line must match an
// active backoffice product. Rows that fail this are left alone (status stays "new") so the owner
// can add the product and the order retries.
//
// ★★★ `.some`, NOT `.every` (v363), AND THIS ONE COST A CUSTOMER AN ORDER. ⚠️⚠️ `importable`
// decides whether a row is CLAIMED at all, and `pullIncoming` **leaves an unimportable row at
// `status = 'new'` — retrying for ever, and telling nobody.** So `.every` meant that **ONE line
// the shop had sold which this app no longer knows** — a product she paused, renamed or deleted
// while a customer's page was still open — **threw away the WHOLE order, including the lines she
// does still sell.** The shop's own counts had already moved, so the two sides disagreed with a
// customer's order in between.
//
// ⚠️ FOUND FROM THE MUNCHIES SESSION'S BRIDGE NOTE, 2026-10-08 — the same fault in code both apps
// share. **On their side it produced a real, invisible, unserved order that sat unclaimed for a
// day.**
//
// ★ SO: an order with AT LEAST ONE line she still sells is imported, and the lines that did not
// match are written onto it by `importIncoming` rather than vanishing. **An order in which she
// sells NOTHING still waits** — that is the honest refusal, because there is nothing to make it
// out of, and it is exactly the case the retry loop exists for.
export function importable(state, data) {
  if (!data || !data.date || !Array.isArray(data.lines) || !data.lines.length) return false;
  return data.lines.some((line) => line && line.name
    && state.products.some((p) => p.active !== false
      && String(p.name).trim().toLowerCase() === String(line.name).trim().toLowerCase()));
}

// The sentence written onto an order whose shop lines this app could not match. ⚠️ IT CARRIES THE
// PRICE AND THE QUANTITY, and neither is decoration: **the app adds up from the LINE ROWS it
// holds, and a dropped line has no row** — so an order imported this way is SHORT by exactly
// these lines, and a note that named only the item would leave her looking at a total the
// customer never paid. Say what the shop charged, so the money can be added by hand.
export function unmatchedLinesNote(lines, cur = "RM") {
  const said = lines.map((l) => {
    const price = Number(l.price);
    const each = Number.isFinite(price) && price > 0 ? ` at ${fmtRM(price, cur)} each` : " (no price was sent)";
    return `${l.name} ×${l.qty}${each}`;
  });
  return `${lines.length === 1 ? "1 item" : `${lines.length} items`} the shop sold ${lines.length === 1 ? "is" : "are"} not in Products, so ${lines.length === 1 ? "it is" : "they are"} NOT on this order and NOT in its total: ${said.join(", ")}. Add ${lines.length === 1 ? "it" : "them"} under Products, then add ${lines.length === 1 ? "its" : "their"} money by hand.`;
}

// ★★ WHAT THE INTAKE COULD NOT READ (v364).
//
// ⚠️⚠️ THE FAULT BEING FIXED HERE IS THE SILENCE, NOT THE SKIP. `pullIncoming` leaves an
// unimportable row at `status='new'` ON PURPOSE — it retries rather than being claimed and lost —
// but that also meant **nothing anywhere said a customer's order was waiting.** v363 removed the
// cause it could; this removes the blindness, whatever the cause.
//
// 🗒️ IT IS NOT KEPT ON `state`, AND THAT IS DELIBERATE. A new top-level field would have to be
// added to every publish/merge list or be dropped in silence (v199), and it would sync to the cloud
// a fact that is only true of THIS phone's last poll. The queue is re-read every 30 seconds, so
// memory is the honest place for it.
let stuckIncoming = [];

export function stuckOrders() {
  return stuckIncoming;
}

// For a test seam, the way `forgetPublishedCards` is.
export function forgetStuckOrders() {
  stuckIncoming = [];
}

// Why a row could not be read, in words she can act on. ⚠️ NEVER a code and never a shrug — the one
// thing this whole feature exists to stop is something happening and not being said.
export function whyUnimportable(state, data) {
  if (!data || !data.date) return "it arrived with no bake day on it";
  if (!Array.isArray(data.lines) || !data.lines.length) return "it arrived with nothing on it";
  const unknown = data.lines
    .filter((l) => l && l.name
      && !state.products.some((p) => p.active !== false
        && String(p.name).trim().toLowerCase() === String(l.name).trim().toLowerCase()))
    .map((l) => String(l.name).trim());
  if (!unknown.length) return "it could not be read";
  return `it is for ${unknown.join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not in your Products`;
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
    // ★ AND EVERY ROW THAT COULD NOT BE READ IS KEPT, IN WORDS (v364) — see `stuckOrders`.
    const stuck = [];
    for (const row of rows) {
      if (!row || !row.id) continue;
      let data;
      try { data = JSON.parse(row.data); } catch {
        stuck.push({ id: row.id, reason: "it arrived in a form this app could not read" });
        continue;
      }
      // Unimportable rows (unknown product, missing date) stay status=new so
      // they keep retrying instead of being claimed and lost.
      if (!importable(state, data)) {
        stuck.push({ id: row.id, reason: whyUnimportable(state, data) });
        continue;
      }
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
    // ⚠️ THE LIST IS REPLACED ONLY ON A READ THAT SUCCEEDED. Every early return above — no cloud
    // configured, no token, the queue unreachable — leaves it EXACTLY as it was, because on those
    // paths the queue's state is UNKNOWN. Clearing it would be a claim that nothing is waiting,
    // made on a request that never came back. (The same rule the promo label's open count follows.)
    stuckIncoming = stuck;
    return { ok: true, imported, stuck };
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
  // WHERE a collection order is collected from (v299).
  //
  // ⚠️ THE NAME COMES FROM HER OWN RECORD, NEVER FROM THE PAYLOAD. The shop is a public page
  // with no login, so a name it sent could be anything at all — this is the same rule the
  // promo code follows, where the shop's code name is checked against her own list before it
  // is believed. An id she does not have (a Point deleted while the page was open, or
  // something hand-posted) falls back to the kitchen, which is what an empty id has always
  // meant, so nothing needs migrating.
  //
  // A point she has since PAUSED is still honoured: pausing decides what is OFFERED, never
  // what an order already promised — the customer was told where to go. Exactly the rule that
  // keeps an ended promo code coming off the order it was placed on.
  //
  // The name is then FROZEN onto the order, so deleting the Point later cannot rewrite where
  // this order went.
  const chosenPoint = data.fulfillment === "courier" ? null : pointById(state, data.pointId);
  const groupId = data.lines.length > 1 ? newId("ordg") : null;
  // ⚠️ NOT `dropped`. `const dropped = validPlace(data.place)` already lives lower in THIS SAME
  // BLOCK, and a second `const dropped` up here is a TDZ ReferenceError — which `pullIncoming`'s
  // bare `catch {}` would SWALLOW, so the crash would surface only as `{ok:false}` and read as a
  // refusal. (That trap came with the munchies session's version of this fix; it is real here.)
  const droppedLines = [];
  for (const line of data.lines) {
    if (!line || !line.name) continue;
    const qty = Math.max(1, Number(line.qty) || 1);
    const product = state.products.find(
      (p) => p.active !== false
        && String(p.name).trim().toLowerCase() === String(line.name).trim().toLowerCase());
    if (!product) {
      // ★★ NOT DROPPED IN SILENCE (v363). The shop sold this line; she may have paused, renamed
      // or deleted the product while the customer's page was still open. It cannot become an
      // order ROW — there is no product to make one out of — **but it must not vanish, because
      // this order's total is built from its rows and these lines are now missing from it.**
      droppedLines.push({ name: String(line.name).trim(), qty, price: line.price });
      continue;
    }
    const order = {
      id: newId("ord"),
      deliveryDateId: del.id,
      deliveryDate: dateStr,
      orderDate: todayISO(),
      productId: product.id,
      qty,
      customerName: String(data.customer || "").trim(),
      // The shop normalises this before sending, but a device running a stale
      // cached copy of the shop's script would not — store the canonical digits
      // either way, so a "+" can never split a customer in two.
      whatsapp: phoneDigits(data.whatsapp) || String(data.whatsapp || "").trim(),
      referredBy: String(data.referredBy || "").trim(), // the ?via= link stamp
      // The promo code the customer typed in the shop (?promo=), or the one the
      // standing today line named and they typed anyway. Spelled the one way the
      // engine recognises it, because this is the string her own app will later
      // count against the code — a stray lowercase here would make a code look
      // unused forever. Absent on every order placed without one, like referredBy.
      promo: normCode(data.promo),
      fulfillment: data.fulfillment === "courier" ? "courier" : "collect",
      address: String(data.address || "").trim(),
      pointId: chosenPoint ? chosenPoint.id : "",
      pointName: chosenPoint ? chosenPoint.name : "",
      note: String(data.note || "").trim(),
      status: "new",
      source: "storefront",
      groupId,
      createdAt: now,
    };
    // The note the customer attached to THIS item (v236), when the product
    // invites one — the shop's “Add a note” link. Named here or it is dropped in
    // silence: this object is built field by field, so a field nobody names never
    // reaches the app at all, exactly as the pin below records. Copied out of an
    // untrusted payload one field at a time, trimmed to the shared cap, and
    // written only when it has words — so an order nobody noted carries no key.
    const lineNote = lineNoteOf(line.note);
    if (lineNote) order.lineNote = lineNote;
    // The pin the CUSTOMER dropped on the shop page (v197), if they dropped one.
    // Named here or it is dropped in silence: this object is built field by field,
    // so a field nobody names never reaches the app at all (the planner's moduleOf
    // lesson, same shape). It is copied out of an untrusted payload one field at a
    // time, and only when it is a real point — a half-written or out-of-range one
    // leaves NO key at all, rather than a null that a screen would print.
    const dropped = validPlace(data.place);
    if (dropped) {
      order.customerPlace = {
        lat: dropped.lat,
        lng: dropped.lng,
        // Whatever the customer's own map called the spot, capped: their browser
        // wrote it and it lands on her screen.
        label: dropped.label.slice(0, 120),
        at: now,
      };
    }
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
  // ★ AND WHAT DID NOT MATCH IS SAID OUT LOUD (v363) — written onto the FIRST order this cart
  // created, so the warning sits on the order she will actually open rather than on a row nobody
  // looks at. ⚠️ IT CARRIES THE PRICE, because the app totals from the rows it holds: without the
  // figure she would be looking at a total the customer never paid, with nothing to correct it
  // against. Kept on its own line so the customer's own note is still readable beside it.
  if (created.length && droppedLines.length) {
    const first = state.orders.find((o) => o.id === created[0]);
    if (first) {
      const said = unmatchedLinesNote(droppedLines, (state.settings && state.settings.currency) || "RM");
      first.note = [first.note, said].filter(Boolean).join("\n");
    }
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
// HOW MANY TIMES EACH LABEL'S LINK WAS OPENED (v288). The shop counts an open; this reads the
// counts back. A label is a piece of paper or a pasted link, and this is the ONLY number that
// says whether one is being picked up at all — the order counts on the Promo screen say what a
// code SOLD, which is a different question and can be zero for a reason that has nothing to do
// with the offer.
//
// Returns `{ ok: true, byCode }`, where byCode maps a code to `{ total, days }` — `days` being
// a Map of 'YYYY-MM-DD' to that day's count — or `{ ok: false }` when Supabase is not configured
// or not reachable. Callers then show NOTHING rather than a zero, the same bargain
// pendingReviewCount above strikes: a zero on this screen is a positive claim ("nobody opened
// your label") and it must not be made on the strength of a request that never got an answer.
//
// The days come from the `promo_visit_days` view, which counts per code per DAY in Malaysian
// time. Reading the raw rows instead would mean pulling every open ever recorded just to add
// them up — fine at three opens, seconds of JSON at three thousand — and the total is the sum
// of the days, so one small read answers both halves of what she asked for.
export async function fetchPromoVisits(state, codes) {
  const c = cfg(state);
  if (!ready(c)) return { ok: false, reason: "Supabase not configured" };
  const wanted = [...(codes || [])]
    .map((x) => normCode((x && x.code) || x || ""))
    .filter(Boolean);
  if (!wanted.length) return { ok: true, byCode: new Map() };
  try {
    const res = await fetch(
      `${c.url}/rest/v1/promo_visit_days?select=code,day,n&code=in.(${wanted.join(",")})`,
      { headers: await reviewAuth(c) });
    if (!res.ok) return { ok: false, reason: `Supabase said ${res.status}` };
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, reason: "Supabase sent something unreadable" };
    const byCode = new Map();
    for (const r of rows) {
      const code = normCode(r && r.code);
      if (!code) continue;
      const entry = byCode.get(code) || { total: 0, days: new Map() };
      const n = Number(r.n) || 0;
      entry.total += n;
      if (r.day) entry.days.set(String(r.day), n);
      byCode.set(code, entry);
    }
    return { ok: true, byCode };
  } catch {
    return { ok: false, reason: "Couldn't reach Supabase" };
  }
}

