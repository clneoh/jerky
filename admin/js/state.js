// state.js — data schema, localStorage load/save, id + format helpers.
// Kept thin and DOM-free (except localStorage) so the data layer can later
// be swapped for a backend without touching views or BOM logic.

import { normRules } from "../../availability.js";
import { todayISO } from "./dates.js";

export const LS_KEY = "bakeadmin.v1";

export function defaultState() {
  return {
    version: 1,
    settings: {
      defaultCapacity: 12,
      deliveryDays: [1, 3, 5], // JS getDay(): 1=Mon, 3=Wed, 5=Fri
      cutoff: "18:00",
      currency: "RM",
      supabase: { // live "slots left" publishing; empty = feature off
        enabled: false,
        url: "",
        anonKey: "",
        email: "",
        password: "",
      },
      cloud: { // shared data across phones; opt-in, off = today's behavior
        enabled: false,
      },
      lock: { enabled: false, pinHash: "" }, // device-local app password (never synced)
      weekCheck: { week: "", done: {} }, // device-local weekly to-do on Home (never synced; fresh each Monday)
      savedOccNames: [], // device-local occasion names she can reuse (never synced)
      storefront: { // what the customer page shows; published to Supabase
        whatsapp: "",
        name: "",
        tagline: "",
        instagram: "",
        facebook: "",
        tngQr: "", // hosted image URL sent in the WhatsApp confirmation / payment reminder
        policy: "",   // cancellation / refund wording shown on the shop (English)
        policyZh: "", // its 中文 box (auto-translated, editable)
        policyMs: "", // its Bahasa Malaysia box (auto-translated, editable)
        postageRM: 8, // flat nationwide-post fee, quoted on posted orders when confirming
        postageSet: false, // true once the owner sets postage here — gates the fee's phone-to-phone sync
        products: [], // [{ name, price, unit }]
      },
      referrals: { // bring-a-friend scheme; synced so both phones agree
        enabled: false,
        friendRM: 3,   // the friend's first-order discount
        referrerRM: 3, // the credit the referrer earns
        validDays: 90, // "" (blank) = never expires
      },
      // The page a printed QR sends a customer to (/taster/). Typed once in
      // English; the 中文 / BM boxes are filled by translation but a box she
      // types over is hers forever (the same rule the product text follows).
      // Shared between phones, and only the parts a customer may read are ever
      // published — see the `codes`/`taster` branch in supabase.js.
      taster: {
        heading: "", headingZh: "", headingMs: "",
        body: "", bodyZh: "", bodyMs: "",
        askPet: true, // ask the customer dog-or-cat, and count the answers
        follow: true, // show the "follow us" line (the handle comes from Storefront → Instagram)
        offerType: "rm", // what a NEW code offers by default: "rm" | "pct" | "nothing"
        offerValue: 5,
        offerMin: 30,   // suggested minimum spend for the offer
        validDays: 30,  // how long a new code's offer runs for; "" = no expiry
      },
      developer: { name: "", emails: [], whatsapp: "" }, // site credit + wish-list recipient; shown only once set
      // The two lists the books are built from (16 Sep 2026). Empty means "the
      // built-in ones" — see js/accounts.js — so a phone that never edits them
      // behaves exactly as before, and both lists are shared between phones.
      categories: [], // what an expense was for: [{ label, cls }]
      payMethods: [], // how money moved: ["Cash", "TNG", "Loan", ...]
    },
    ingredients: [],
    suppliers: [],     // who you buy from (each has a WhatsApp number)
    uoms: seedUoms(),  // units of measure; g/kg/ml/L/pcs convert within a family
    products: [],
    deliveryDates: [],
    orders: [],
    customers: [], // customer profiles (pet name/photo, likes, notes) keyed to orders
    purchaseOrders: [],
    // Money out: what you spent, and how. Written by a shopping run marked Bought
    // (which is why a row may carry a poId) and by the Add an expense form — one
    // list, so the Money screen has a single side to subtract from money in.
    expenses: [],
    // Money you put in yourself — a sudden packet of meat paid from your own purse,
    // a float for change. Kept apart from orders so the Money screen can say how much
    // of the till is your own money, and taken back out later through Add an expense
    // (category "My own withdrawal"), which is the same money-out list.
    deposits: [],
    credits: [], // bring-a-friend ledger: {holder, amountRM, role, expiresAt, ...}
    occasions: [], // delivery-calendar reminder marks: {from, to, label}
    // The shops and pet shops you hand samples to. Kept apart from `codes` so a
    // shop keeps its contact details, commission rate and sample count even if
    // you retire the label that pointed at it.
    partners: [], // {id, name, whatsapp, commissionPct, samplesGiven, notes, active, createdAt}
    // One printed label each: the QR, the tiny code beside it, and what scanning
    // it does. `kind` is "shop" | "promo" | "intro" | "plain"; only the fields a
    // customer may see are ever published (see supabase.js storefrontPayload).
    // `referrerDigits` is a bring-a-friend label's customer, kept private and
    // carried in the printed link as `?via=`, never published — see labelUrl.
    codes: [], // {id, code, label, kind, partnerId?, productId?, referrerDigits?, offer?, headline?, active, createdAt}
  };
}

// The unit list the app starts with. g/kg convert (weight → grams), ml/L convert
// (volume → millilitres); count units are 1:1. `toBase` is how many base units
// one of this unit equals. Everything else in the app keys off `unit` strings
// for recipes (unchanged); these drive purchasing pack conversions.
function seedUoms() {
  return [
    { id: "uom_g", name: "g", family: "weight", toBase: 1 },
    { id: "uom_kg", name: "kg", family: "weight", toBase: 1000 },
    { id: "uom_ml", name: "ml", family: "volume", toBase: 1 },
    { id: "uom_l", name: "L", family: "volume", toBase: 1000 },
    // Time and length measure notes/sizes rather than ingredient amounts; each
    // family keeps one relationship like g/kg (1 hr = 60 min, 1 m = 100 cm).
    ...TIME_LENGTH.map(([name, family, toBase]) => ({ id: `uom_${name}`, name, family, toBase })),
    { id: "uom_pcs", name: "pcs", family: "count", toBase: 1 },
    // Standard pet-treat selling units (count family) — the product dropdown
    // draws from these. Deterministic ids so fresh installs match across devices.
    ...TREAT_COUNT.map((n) => ({ id: `uom_${n}`, name: n, family: "count", toBase: 1 })),
  ];
}

// Legacy unit strings → correct family/factor when backfilling the unit list
// from ingredients that already used these units.
const KNOWN_UNITS = {
  g: ["weight", 1], gram: ["weight", 1], grams: ["weight", 1],
  kg: ["weight", 1000], kilo: ["weight", 1000],
  ml: ["volume", 1], mL: ["volume", 1], millilitre: ["volume", 1],
  l: ["volume", 1000], L: ["volume", 1000], litre: ["volume", 1000],
  min: ["time", 1], minute: ["time", 1], minutes: ["time", 1],
  hr: ["time", 60], hour: ["time", 60], hours: ["time", 60],
  cm: ["length", 1], centimetre: ["length", 1], centimetres: ["length", 1],
  m: ["length", 100], metre: ["length", 100], metres: ["length", 100],
  pc: ["count", 1], pcs: ["count", 1], piece: ["count", 1], pieces: ["count", 1],
};

// Pet-treat selling units the owner pre-approved, added as count-family units.
// Pouches by weight are the main form; the rest cover packs, jars and sets.
const TREAT_COUNT = ["pouch", "pack", "jar", "box", "bag", "set", "piece"];

// Time and length pairs, pre-loaded like g/kg and ml/L so a note or recipe can
// speak in minutes/hours or cm/m. Name is also the id suffix (uom_min, uom_hr…).
const TIME_LENGTH = [
  ["min", "time", 1],
  ["hr", "time", 60],
  ["cm", "length", 1],
  ["m", "length", 100],
];

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && s.version === 1) return normalize(s);
    if (s) return migrate(s);
  } catch (err) {
    console.warn("Corrupt stored data, resetting to defaults", err);
  }
  return seedFreshState();
}

// First run on a device (no saved state at all) ships preconnected so a fresh
// phone works after ONE sign-in: shared data + live availability on, and the
// 8899 PIN on. This template lives ONLY here — normalize() keeps neutral
// defaults above so a partial stored state can never inherit any of it (it
// must never, say, lock a phone with a PIN the owner did not set). Only the
// PUBLIC connection (Supabase url + anon key) and the device-local PIN are
// baked in code. The storefront details customers see (name, WhatsApp, tagline,
// socials, TNG QR) are deliberately NOT baked: the app adopts the latest
// published values from Supabase when it boots, so a fresh phone always shows
// whatever the most recent backoffice user published — never a stale copy. The
// app-login PASSWORD is also never shipped in code; the owner types email +
// password once per phone at the sign-in gate.
// The PUBLIC Supabase connection for this pet-treat business — its own project
// (never the bakery's). URL + anon key ship in code by design — they are public
// (any visitor to the order page already holds them). The app-login
// email/password never ship in code (see below).
export const BUILTIN_SUPABASE = {
  url: "https://ircwozniiyywsowamixy.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY3dvem5paXl5d3Nvd2FtaXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Njc2MDQsImV4cCI6MjEwNDM0MzYwNH0.N3T87IOj2nnvKnHXeFM4DN9WR2js2N2R66Dc15edxIg",
};

function seedFreshState() {
  const s = defaultState();
  s.settings.cloud.enabled = true;
  s.settings.supabase.enabled = true;
  s.settings.supabase.url = BUILTIN_SUPABASE.url;
  s.settings.supabase.anonKey = BUILTIN_SUPABASE.anonKey;
  s.settings.supabase.email = ""; // owner's app-login email (paste in when known)
  s.settings.lock.enabled = true;
  s.settings.lock.pinHash = "9800a8677d99e5f6968d7357e44006388b09d3b6a8676d0f930fbaa63d02330d"; // default PIN 8899
  return normalize(s);
}

// A phone whose stored state predates the preconnected build keeps blank
// connection fields forever (seeding runs only on an empty device), so its
// cloud boxes look dead and nothing loads. On every boot, refill the PUBLIC
// url + anon key from the built-in project when they're missing — a phone can
// never be left unable to reach the cloud. Deliberately never fills the
// app-login email/password and never flips a switch on: signing in stays the
// owner's one step.
export function ensureSupabase(state) {
  const sb = (state.settings || {}).supabase;
  if (!sb) return false;
  let changed = false;
  if (!String(sb.url || "").trim()) { sb.url = BUILTIN_SUPABASE.url; changed = true; }
  if (!String(sb.anonKey || "").trim()) { sb.anonKey = BUILTIN_SUPABASE.anonKey; changed = true; }
  return changed;
}

export function save(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save", err);
  }
  saveHook?.(state);
}

// The sync engine (js/sync.js) registers a save hook so every mutation funnels
// through the same point. Kept as a function field so state.js stays a leaf
// module — app.js wires the hook, avoiding an import cycle.
let saveHook = null;
export function setSaveHook(fn) {
  saveHook = fn;
}

// Red dot on the Orders tab = orders still waiting to be handled (status New).
// Storefront orders that arrived as one cart of several items share a groupId,
// so a single customer order counts once. Calls from app.js on every render and
// from orders.js after a status change. No-op when the badge isn't in the DOM.
export function updateOrderBadge(state) {
  if (typeof document === "undefined") return;
  const badge = document.getElementById("orders-badge");
  if (!badge) return;
  const seen = new Set();
  let n = 0;
  for (const o of state.orders || []) {
    if ((o.status || "new") !== "new") continue;
    if (o.groupId && seen.has(o.groupId)) continue;
    if (o.groupId) seen.add(o.groupId);
    n++;
  }
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = n === 0;
}

// Group orders by their storefront groupId (one customer order with several
// items arrives as several rows so availability math stays correct, but the
// list/inbox show them as one order). Orders without a groupId each form their
// own group. Preserves input order; returns [{ orders: [...] }, ...].
export function groupOrders(orders) {
  const groups = [];
  const byGroup = new Map();
  for (const o of orders || []) {
    if (o.groupId && byGroup.has(o.groupId)) {
      byGroup.get(o.groupId).orders.push(o);
    } else if (o.groupId) {
      const g = { orders: [o] };
      byGroup.set(o.groupId, g);
      groups.push(g);
    } else {
      groups.push({ orders: [o] });
    }
  }
  return groups;
}

// Defensive normalization for hand-edited or older imports: guarantees the
// shape the rest of the app relies on, dropping unknown fields.
function normalize(s) {
  const d = defaultState();
  const out = {
    version: 1,
    settings: {
      ...d.settings,
      ...(s.settings || {}),
      supabase: { ...d.settings.supabase, ...((s.settings || {}).supabase || {}) },
      cloud: { ...d.settings.cloud, ...((s.settings || {}).cloud || {}) },
      lock: { ...d.settings.lock, ...(((s.settings || {}).lock) || {}) },
      storefront: cleanStorefront((s.settings || {}).storefront),
      referrals: { ...d.settings.referrals, ...(((s.settings || {}).referrals) || {}) },
      taster: { ...d.settings.taster, ...(((s.settings || {}).taster) || {}) },
      categories: Array.isArray(((s.settings || {}).categories)) ? s.settings.categories : [],
      payMethods: Array.isArray(((s.settings || {}).payMethods)) ? s.settings.payMethods : [],
      developer: cleanDeveloper(((s.settings || {}).developer)),
    },
    ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
    suppliers: Array.isArray(s.suppliers) ? s.suppliers : [],
    uoms: (Array.isArray(s.uoms) && s.uoms.length) ? s.uoms : seedUoms(),
    products: Array.isArray(s.products) ? s.products : [],
    deliveryDates: Array.isArray(s.deliveryDates) ? s.deliveryDates : [],
    orders: Array.isArray(s.orders)
      ? s.orders.map((o) => (o && typeof o === "object" ? { ...o, status: o.status || "new" } : o))
      : [],
    purchaseOrders: Array.isArray(s.purchaseOrders) ? s.purchaseOrders : [],
    expenses: Array.isArray(s.expenses) ? s.expenses : [],
    deposits: Array.isArray(s.deposits) ? s.deposits : [],
    customers: Array.isArray(s.customers) ? s.customers : [],
    credits: Array.isArray(s.credits) ? s.credits : [],
    occasions: Array.isArray(s.occasions) ? s.occasions : [],
    partners: Array.isArray(s.partners) ? s.partners : [],
    codes: Array.isArray(s.codes) ? s.codes : [],
  };
  const consolidated = consolidateDeliveryDates(out.deliveryDates, out.orders);
  out.deliveryDates = consolidated.deliveryDates;
  out.orders = consolidated.orders;
  ensureCountUnits(out);
  ensurePlanningUnits(out);
  backfillUnitRefs(out);
  linkProductUnits(out);
  return out;
}

// Give every ingredient a uomId that matches its `unit` string, creating the
// unit in the list if it isn't there yet (so nothing breaks, and purchasing can
// convert). Idempotent by unit name. Old data with, say, flour in "g" gets a
// proper weight unit; odd units fall back to a 1:1 count unit.
function backfillUnitRefs(state) {
  const known = new Map(Object.entries(KNOWN_UNITS));
  const byName = new Map();
  for (const u of state.uoms || []) byName.set(String(u.name || "").toLowerCase(), u);
  for (const ing of state.ingredients || []) {
    if (!ing || typeof ing !== "object" || ing.uomId) continue; // already linked
    const unitName = String(ing.unit || "").trim();
    if (!unitName) continue;
    let u = byName.get(unitName.toLowerCase());
    if (!u) {
      u = makeUnit(unitName, known.get(unitName.toLowerCase()) || ["count", 1]);
      state.uoms.push(u);
      byName.set(u.name.toLowerCase(), u);
    }
    ing.uomId = u.id;
  }
}

function makeUnit(name, [family, toBase]) {
  // Math.random fallback so backfilling never depends on crypto availability.
  let rand = "";
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  } else {
    rand = Math.random().toString(36).slice(2, 8);
  }
  return { id: `uom_${rand}`, name, family, toBase: Number(toBase) || 1 };
}

// Make sure the standard pet-treat selling units exist. uoms are stored per
// device (not cloud-synced) and an existing install keeps its own list
// wholesale, so this normalize-time step is the only path that reaches an older
// phone. Never touches a unit that already exists under the same name,
// whatever its family.
export function ensureCountUnits(state) {
  const have = new Map();
  for (const u of state.uoms || []) have.set(String(u.name || "").toLowerCase(), u);
  for (const n of TREAT_COUNT) {
    if (have.has(n)) continue;
    const u = { id: `uom_${n}`, name: n, family: "count", toBase: 1 };
    state.uoms.push(u);
    have.set(n, u);
  }
}

// Same upgrade idea as ensureCountUnits but for the time/length pairs: an
// existing install that predates them keeps its own unit list wholesale, so
// this normalize-time step is what adds min/hr/cm/m to an older phone. Never
// touches a unit that already exists under the same name, whatever its family.
export function ensurePlanningUnits(state) {
  const have = new Map();
  for (const u of state.uoms || []) have.set(String(u.name || "").toLowerCase(), u);
  for (const [name, family, toBase] of TIME_LENGTH) {
    if (have.has(name)) continue;
    const u = { id: `uom_${name}`, name, family, toBase };
    state.uoms.push(u);
    have.set(name, u);
  }
}

// Give legacy products a uomId matching their stored unit name when a matching
// count unit exists (e.g. a product saved as "pouch" before uomId existed). This
// never creates units and never touches a product that already has a uomId.
export function linkProductUnits(state) {
  const byName = new Map();
  for (const u of state.uoms || []) {
    if (u.family === "count") byName.set(String(u.name || "").toLowerCase(), u);
  }
  for (const p of state.products || []) {
    if (!p || typeof p !== "object" || p.uomId) continue;
    const name = String(p.unit || "").trim().toLowerCase();
    const u = name ? byName.get(name) : null;
    if (u) p.uomId = u.id;
  }
}

// True when a product's selling unit is this uom: by its stored uomId, or (for
// legacy products saved before uomId existed) by its unit name.
export function productUsesUnit(p, uom) {
  if (!p || !uom) return false;
  if (p.uomId === uom.id) return true;
  return !p.uomId
    && String(p.unit || "").trim().toLowerCase() === String(uom.name || "").trim().toLowerCase();
}

// The selling-unit choices for the product editor. Every unit of measure in the
// list is offered — whole-item units (count family: pouch, pack, jar) come
// first with a plain name, then weight/volume units labelled with their type
// (g (weight)) so nothing the owner adds ever disappears from the box. Returns
// { options, value } for ui.select(). A product whose stored unit matches no
// UOM at all keeps its value through one extra "(not in Units…)" option so it
// is never silently rewritten; new selling units are added under More → Units.
export function productUnitOptions(state, product) {
  const units = state.uoms || [];
  const labelFor = (u) => u.family === "count" ? u.name : `${u.name} (${u.family})`;
  const ordered = units
    .filter((u) => u.family === "count")
    .concat(units.filter((u) => u.family !== "count"));
  const options = ordered.map((u) => ({ value: u.id, label: labelFor(u) }));
  let value = "";
  if (product && product.uomId && options.some((o) => o.value === product.uomId)) {
    value = product.uomId;
  }
  if (!value && product && String(product.unit || "").trim()) {
    const pname = String(product.unit).trim().toLowerCase();
    const byName = ordered.find((u) => String(u.name || "").trim().toLowerCase() === pname);
    if (byName) value = byName.id;
  }
  if (!value && product && String(product.unit || "").trim()) {
    const raw = String(product.unit).trim();
    options.push({ value: raw, label: `${raw} (not in Units — add under More → Units)` });
    value = raw;
  }
  return { options, value };
}

// Two deliveryDates for the same day (e.g. both phones added the same date
// before they synced, then the merge kept both) show up as two tabs and split
// orders between them. Keep the first entry per date and re-point every order
// to it. Nothing is deleted from the business data — orders are preserved.
function consolidateDeliveryDates(deliveryDates, orders) {
  const byDate = new Map();
  const removed = new Map(); // removedId -> survivingId
  const out = [];
  for (const d of deliveryDates) {
    if (!d || typeof d.date !== "string" || !d.date) continue;
    const survivor = byDate.get(d.date);
    if (survivor) {
      if (d.id) removed.set(d.id, survivor.id);
    } else {
      byDate.set(d.date, d);
      out.push(d);
    }
  }
  if (!removed.size) return { deliveryDates, orders };
  const reId = (o) =>
    (o && o.deliveryDateId && removed.has(o.deliveryDateId))
      ? { ...o, deliveryDateId: removed.get(o.deliveryDateId) }
      : o;
  return { deliveryDates: out, orders: orders.map(reId) };
}

// Move a whole customer order to another delivery day. `group` is a group from
// groupOrders() ({ orders: [...] }) or a single order row; `dest` is a
// deliveryDates row ({ id, date }). Every row moves together — deliveryDateId
// AND the deliveryDate snapshot — so per-day availability math and the order's
// own history can never disagree, and a group whose rows had drifted onto
// different days is unified by the move. Returns the rows that were moved.
export function moveOrderGroup(group, dest) {
  if (!group || !dest || !dest.id) return [];
  const rows = Array.isArray(group.orders) ? group.orders : [group];
  const moved = [];
  for (const o of rows) {
    if (!o || typeof o !== "object") continue;
    o.deliveryDateId = dest.id;
    o.deliveryDate = dest.date;
    moved.push(o);
  }
  return moved;
}

// Storefront settings published to the customer page. Fills every field so a
// partially-written stored value can't crash the Settings product editor, and
// keeps only well-formed menu items.
function cleanStorefront(sf) {
  const d = defaultState().settings.storefront;
  const src = (sf && typeof sf === "object") ? sf : {};
  const products = Array.isArray(src.products)
    ? src.products
        .filter((p) => p && typeof p === "object" && String(p.name || "").trim())
        .map((p) => {
          const out = {
            name: String(p.name).trim(),
            price: Number(p.price) || 0,
            unit: String(p.unit || "").trim() || "piece",
          };
          const desc = p && String(p.description || "").trim();
          if (desc) out.description = desc;
          // A value pack's component marker (its pool base + pieces per pack)
          // survives cleanup so a stored draft doesn't lose the pool link.
          const c = p && p.component;
          const baseName = c && String(c.name || "").trim();
          if (baseName && Number(c.qty) > 0) out.component = { name: baseName, qty: Number(c.qty) };
          // Per-product date rules (orders close N days before / a from–to
          // window) survive too, so a stored draft keeps its rules.
          const close = Number(p.closeDays);
          if (p.closeDays != null && Number.isInteger(close) && close >= 0) out.closeDays = close;
          for (const k of ["validFrom", "validTo"]) {
            const v = p && p[k];
            if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
          }
          // The days the product sells (marked on its own calendar) survive a
          // stored draft exactly as the publish whitelist keeps them.
          const marked = normRules(p.sellRules).slice(0, 40);
          if (marked.length) out.sellRules = marked;
          // The change/cancel window the baker states for this product — shown
          // to the customer, never enforced. Blank stays absent (no window).
          const cancel = Number(p.cancelDays);
          const cancelSet = p.cancelDays != null && !(typeof p.cancelDays === "string" && p.cancelDays.trim() === "");
          if (cancelSet && Number.isInteger(cancel) && cancel >= 0) out.cancelDays = cancel;
          return out;
        })
    : [];
  return {
    whatsapp: String(src.whatsapp ?? d.whatsapp),
    name: String(src.name ?? d.name),
    tagline: String(src.tagline ?? d.tagline),
    instagram: String(src.instagram ?? d.instagram),
    facebook: String(src.facebook ?? d.facebook),
    tngQr: String(src.tngQr ?? d.tngQr),
    policy: String(src.policy ?? d.policy),
    policyZh: String(src.policyZh ?? d.policyZh),
    policyMs: String(src.policyMs ?? d.policyMs),
    postageRM: Number(src.postageRM ?? d.postageRM),
    postageSet: src.postageSet === true,
    products,
  };
}

// Developer contact: the site credit line + who the wish-list email reaches.
// Kept to {name, emails[]} so the storefront payload, the mailto links and the
// sync engine all read one shape; a malformed stored value can't crash them.
function cleanDeveloper(dev) {
  const src = (dev && typeof dev === "object") ? dev : {};
  const name = String(src.name || "").trim();
  const emails = Array.isArray(src.emails)
    ? src.emails.map((e) => String(e || "").trim()).filter(Boolean)
    : [];
  const whatsapp = String(src.whatsapp || "").trim();
  return { name, emails, whatsapp };
}

// Placeholder for future version migrations. v1 is the only format today.
function migrate(s) {
  return normalize(s);
}

// Has this number ever bought before? A customer is NEW when no other order in
// the book carries the same WhatsApp number — the owner's own rule ("by whatsapp
// number that never buy before will be consider as new customer"). The order's
// own rows are skipped so a multi-item cart (several rows, one groupId) is not
// mistaken for a previous order of its own. A blank number can never be new:
// there is nothing to key on, so an offer marked "new customers only" stays off.
export function isNewCustomer(state, group) {
  const orders = (group && group.orders) || (Array.isArray(group) ? group : []);
  const first = orders[0];
  if (!first) return false;
  const me = waNumber(first.whatsapp);
  if (!me) return false;
  const ownIds = new Set(orders.map((o) => o.id));
  for (const o of state.orders || []) {
    if (ownIds.has(o.id)) continue;
    if (first.groupId && o.groupId === first.groupId) continue;
    if (waNumber(o.whatsapp) === me) return false;
  }
  return true;
}

// A code's offer, but only while it should actually be shown: the code has to be
// live, carry a real offer, and sit inside its own from/to window (either end
// blank means "always"). Returns null for anything that should not appear, so
// every reader — the landing page, the shop banner, the admin — asks one question
// and gets one answer. `today` is a "YYYY-MM-DD" string; string comparison is
// exact for that format.
export function liveOffer(code, today = todayISO()) {
  if (!code || typeof code !== "object") return null;
  if (code.active === false) return null;
  const off = code.offer;
  if (!off || typeof off !== "object") return null;
  const type = String(off.type || "");
  const value = Number(off.value);
  if (type !== "rm" && type !== "pct") return null;
  if (!(value > 0)) return null;
  const from = String(off.from || "");
  const to = String(off.to || "");
  if (from && today < from) return null;
  if (to && today > to) return null;
  return {
    type,
    value,
    minSpend: Number(off.minSpend) || 0,
    from,
    to,
    newOnly: off.newOnly === true,
  };
}

// The code a customer scanned, looked up case-insensitively (a printed label may
// be typed by hand as "k3x9"). Returns the record or null — callers decide what a
// retired or missing code means for their page.
export function findCode(state, code) {
  const want = String(code || "").trim().toUpperCase();
  if (!want) return null;
  return (state.codes || []).find(
    (c) => c && String(c.code || "").trim().toUpperCase() === want
  ) || null;
}

// What is printed in small type beside the QR so labels can be told apart by eye.
// Falls back to the code itself; never blank for a code that has one.
export function codeLabel(code) {
  const label = String((code && code.label) || "").trim();
  if (label) return label;
  return String((code && code.code) || "").trim();
}

// Short, shareable code a customer can quote to track an order: the last 6 hex
// of the order id (or its groupId, so a multi-item order shares one code),
// uppercased. ids are 12 random hex chars from newId, so a collision needs 1
// in ~16M — fine for a home bakery. Display code adds "#" (e.g. "#A3F9C2").
export function orderCode(order) {
  const hex = String((order && (order.groupId || order.id)) || "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(-6)
    .toUpperCase();
  return hex || "??????";
}

export { normalize };

// Normalize a customer's WhatsApp number to the digits-only international form
// wa.me links require. Strips "+", spaces and dashes; a local leading "0" gets
// the Malaysian country code ("012-345 6789" → "60123456789", "+60 12-345 6789"
// → "60123456789"). Blank input → "" (the caller decides what that means).
export function waNumber(n) {
  const digits = String(n || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
}

export function newId(prefix) {
  let rand;
  if (crypto.randomUUID) {
    rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  } else {
    rand = Math.random().toString(36).slice(2, 14);
  }
  return `${prefix}_${rand}`;
}

export function byId(list, id) {
  return list.find((x) => x.id === id);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function fmtRM(n, currency = "RM") {
  return `${currency} ${round2(n).toFixed(2)}`;
}

// ── An order is a record of a sale ─────────────────────────────────────────
// Every order row keeps what it was sold as and what it was sold for
// (`productName` / `unitPrice`), frozen at the moment the order is taken. That
// is what stops renaming or repricing a product from rewriting last month's
// orders — including the amount a customer sees on their own tracking page —
// and it means a product deleted later still shows what it was that someone
// bought. Orders saved before v70 carry no snapshot; the live product is the
// best guess available for those.

// The product name to print for an order line: the frozen one, else the live
// product's, else the placeholder for a product that is truly gone.
export function orderLineName(state, o) {
  const frozen = String((o && o.productName) || "").trim();
  if (frozen) return frozen;
  const p = byId((state && state.products) || [], o && o.productId);
  return String((p && p.name) || "").trim() || "(deleted product)";
}

// The unit price the line was sold at — the frozen one, else the live product's.
// null when there is nothing to price it from (no snapshot and no price set),
// so the caller can tell "free" from "we don't know".
export function orderLinePrice(state, o) {
  const frozen = o && o.unitPrice;
  if (frozen != null && frozen !== "" && Number.isFinite(Number(frozen))) return Number(frozen);
  const p = byId((state && state.products) || [], o && o.productId);
  return p && p.price != null && p.price !== "" ? Number(p.price) : null;
}

// Freeze the sold name and price onto an order row from a product — or from a
// storefront order line, which carries the same two fields ({ name, price }).
// Never invents a value: a product with no price set leaves the line unpriced
// so it keeps following the live product.
export function stampOrderLine(o, product) {
  if (!o || !product) return o;
  const name = String(product.name || "").trim();
  if (name) o.productName = name;
  const price = product.price;
  if (price != null && price !== "" && Number.isFinite(Number(price))) o.unitPrice = Number(price);
  return o;
}
