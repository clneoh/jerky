// state.js — data schema, localStorage load/save, id + format helpers.
// Kept thin and DOM-free (except localStorage) so the data layer can later
// be swapped for a backend without touching views or BOM logic.

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
        tngQr: "", // hosted image URL shown on the customer's track page for TNG payment
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
      developer: { name: "", emails: [], whatsapp: "" }, // site credit + wish-list recipient; shown only once set
    },
    ingredients: [],
    suppliers: [],     // who you buy from (each has a WhatsApp number)
    uoms: seedUoms(),  // units of measure; g/kg/ml/L/pcs convert within a family
    products: [],
    deliveryDates: [],
    orders: [],
    customers: [], // customer profiles (pet name/photo, likes, notes) keyed to orders
    purchaseOrders: [],
    credits: [], // bring-a-friend ledger: {holder, amountRM, role, expiresAt, ...}
    occasions: [], // delivery-calendar reminder marks: {from, to, label}
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
    customers: Array.isArray(s.customers) ? s.customers : [],
    credits: Array.isArray(s.credits) ? s.credits : [],
    occasions: Array.isArray(s.occasions) ? s.occasions : [],
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
