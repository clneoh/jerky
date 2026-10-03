// state.js — data schema, localStorage load/save, id + format helpers.
// Kept thin and DOM-free (except localStorage) so the data layer can later
// be swapped for a backend without touching views or BOM logic.

import { normRules } from "../../availability.js";

export const LS_KEY = "bakeadmin.v1";

// The numbers every phone starts with on More → Production line, in one place
// so that two screens can ask the same question of them: the screen that seeds
// the plan on a phone that has never had one, and the sync code, which has to
// tell a plan she has typed into from a plan that is still exactly this.
//
// That question is the whole reason this constant exists. A phone set up today
// carries a full plan of these numbers before she has touched anything, so
// "this phone has nothing to say about the line" cannot be read from the plan
// being missing — the only signature of a phone with no opinion is a plan that
// still matches this list, number for number. See planIsStock in js/sync.js.
//
// A plan that no longer matches is a plan she has typed into. Nothing here is
// a gate: the production line is a planner, and no number on it blocks a sale.
export const STOCK_PRODUCTION = {
  people: 1,
  hours: 5,
  target: 60,
  pans: 12,
  prooferPans: 12, // what her proofer holds; the chiller is a what-if, not a station
  mixerPans: 6,    // one tub fills one oven load, which is her actual cycle
  ovenPans: 6,
  ovenMin: 15,     // one turn of the oven — bake and swap together
  ovenShelves: 2,
  scaleMin6: 15,   // oiling the pans and weighing the dough out, one job one name
  topMin6: 6,      // her minute a pan
  swapMin6: 2,     // out and in, both halves
  // The bake day she corrected on 22 Sep 2026, the chain the backwards plan
  // walks: mix in the tub, the rests and folds, into pans, the proofer twice
  // with the dimple between, the oven, then the cooling.
  mixMin: 20,
  foldRests: 4,
  foldRestMin: 30,
  foldMin: 1,
  proofMin1: 45,
  proofMin2: 30,
  coolWaitMin: 30,
  // The clock the backwards plan is built from, and the two bands she asked
  // for: the rhythm she would like, and how many minutes early are still fine
  // to shuffle work into.
  readyAtMin: 480,
  rhythmMin: 15,
  tolMin: 5,
  // The one step still untimed: 0 means she has not measured it, and the screen
  // names it rather than pretending it is free.
  coolMin6: 0,
  // Which cutting of the plan these numbers belong to. A phone holding the
  // earlier one is carried across once, on load — see upgradeProductionPlan
  // below.
  planRev: 145,
};

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
      weekCheck: { week: "", done: {} }, // weekly to-do on Home: synced, union-merged so a tick on either phone survives, and keyed by week so it starts fresh each Monday
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
        // "flat" charges the fee above on every posted order that carries no recorded
        // courier charge. "quote" charges nothing up front: the delivery is priced per
        // order, from what the courier actually asks for it (the Note / tracking box).
        // Her ask, 28 Sep 2026: "add a switch whether a flat postage or quote by courier".
        postageMode: "flat",
        postageModeSet: false, // true once she has chosen — gates THIS choice's sync, exactly like postageSet
        products: [], // [{ name, price, unit }]
      },
      referrals: { // bring-a-friend scheme; synced so both phones agree
        enabled: false,
        friendRM: 3,   // the friend's first-order discount
        referrerRM: 3, // the credit the referrer earns
        validDays: 90, // "" (blank) = never expires
      },
      // How the four WhatsApp messages to a customer open (2 Oct 2026). WhatsApp
      // carries no fonts — the letters come from whichever phone is reading — so the
      // only lever is its own marks, and italics on the opening line is the whole of
      // this choice. "plain" is word for word what every message sent before this
      // existed; "greeting" leans the first line over and changes nothing else. One
      // value for all four messages so they cannot open differently from each other.
      messageStyle: "plain",
      // The production line planner (19 Sep 2026): the numbers her line is
      // measured from, typed by her on More → Production line. Seeded with the
      // ones she measured on /form/ so the screen says something true on the
      // first open. Nothing else in the app reads this — it is a planner, not a
      // gate. See js/production.js for the model, and STOCK_PRODUCTION above for
      // why these numbers are named in one place rather than written here.
      production: { ...STOCK_PRODUCTION },
      // The scenario planner (21 Sep 2026): a line built out of modules on a
      // clock, so she can design a production flow rather than only read one.
      // Left empty here and seeded by the screen itself (views/scenario.js), so
      // that a phone which never opens it never pushes a preset over the one she
      // has built on the other phone. See js/scenario.js for the model.
      scenario: {},
      // The scenarios she has saved and named (21 Sep 2026): [{ id, name,
      // modules, ... }]. `scenario` above is the one she is working on; this is
      // the shelf of them, so two designs — the line without a fridge and the
      // line with one — can sit side by side. Empty means she has saved none.
      scenarios: [],
      developer: { name: "", emails: [], whatsapp: "" }, // site credit + wish-list recipient; shown only once set
      // Where the courier collects from (25 Sep 2026): the bakery's own point on
      // the map, pinned once on more → Couriers. It is a SETTING rather than part of
      // the storefront because the storefront is what customers read and this is a
      // routing fact — but both carry the same address, and the screen says so.
      // null means "not pinned yet", which every courier screen states in words
      // rather than sending a blank point to an API.
      pickupPlace: null,
      // How the courier is asked for (25 Sep 2026). `dispatch` is the time of day a
      // delivery is normally called for — the quote screen prefills it and she can
      // change it per quote, which is why it is a convenience rather than a fact.
      // Device-local, like lock and weekCheck above, and deliberately NOT synced:
      // it is the one setting here whose whole job is to prefill a box on the phone
      // in her hand, and a key that only ever holds a prefilled default is not worth
      // a branch in sync.js's guarded-key rules. There is no `provider` key yet on
      // purpose either: there is one courier, and a setting with one choice is a
      // control that does nothing (see js/couriers.js).
      courier: { dispatch: "10:00" },
      // The two lists the books are built from (16 Sep 2026). Empty means "the
      // built-in ones" — see js/accounts.js — so a phone that never edits them
      // behaves exactly as before, and both lists are shared between phones.
      categories: [], // what an expense was for: [{ label, cls }]
      payMethods: [], // how money moved: ["Cash", "TNG", "Loan", ...]
    },
    ingredients: [],
    suppliers: [],     // who you buy from (each has a WhatsApp number)
    // The carriers she posts parcels with — J&T, Ninja Van, Line Clear and the
    // like. A list of her own rather than a courier in js/couriers.js, because
    // these are not couriers the app asks for a price: she books the parcel
    // herself and the app records it. See js/parcel.js for why, and for what a
    // parcel is not. Empty means she has not added any yet; the screen offers the
    // usual ones in one press.
    parcelCouriers: [],
    uoms: seedUoms(),  // units of measure; g/kg/ml/L/pcs convert within a family
    products: [],
    // The shop's categories, a tree of any depth (see js/productCategories.js).
    // A separate list from settings.categories, which is the EXPENSE chart — one
    // is what a product is, the other is what money was spent on.
    productCategories: [],
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
    // Promo codes she hands out — one row per code, carrying the six rule
    // families and the offer (see js/promo.js for the engine and the shape). A
    // list she grows, like the credits ledger above, not a setting.
    promoCodes: [],
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

// A plain object used as a map (person number → name / → to-call flag). Anything
// else — a list, a string, a number — becomes an empty map rather than being
// carried through: the planner writes into these with `names[who] = typed`, and
// a module is strict mode, so assigning a property on a primitive throws and
// would take the whole people card down with it.
function plainMap(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
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
      // A hand-edited import must not put an unknown style in: the message builders
      // read exactly one value, and a third one would silently send "plain" while
      // the settings screen showed a choice she never made (2 Oct 2026).
      messageStyle: ((s.settings || {}).messageStyle === "greeting") ? "greeting" : "plain",
      production: { ...d.settings.production, ...(((s.settings || {}).production) || {}) },
      scenario: { ...d.settings.scenario, ...(((s.settings || {}).scenario) || {}) },
      // Saved scenarios, guarded as a list: a hand-edited import that put an
      // object here would otherwise break the shelf on the scenario screen.
      scenarios: Array.isArray((s.settings || {}).scenarios) ? s.settings.scenarios : [],
      categories: Array.isArray(((s.settings || {}).categories)) ? s.settings.categories : [],
      payMethods: Array.isArray(((s.settings || {}).payMethods)) ? s.settings.payMethods : [],
      developer: cleanDeveloper(((s.settings || {}).developer)),
      // v200: the bakery's own address on the mailing labels, and the planner's
      // two people maps. All three ride the settings row now, so they arrive
      // through a cloud merge as readily as through an import and need the same
      // guarantee those paths already give `categories` above.
      mailingAddress: typeof (s.settings || {}).mailingAddress === "string"
        ? s.settings.mailingAddress : "",
      personNames: plainMap(((s.settings || {}).personNames)),
      personCalls: plainMap(((s.settings || {}).personCalls)),
    },
    ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
    suppliers: Array.isArray(s.suppliers) ? s.suppliers : [],
    // Guarded like every other list she owns. A phone that has never added a
    // carrier behaves exactly as before, and the cloud merge can land the list on
    // it without the shape being assumed.
    parcelCouriers: Array.isArray(s.parcelCouriers) ? s.parcelCouriers : [],
    uoms: (Array.isArray(s.uoms) && s.uoms.length) ? s.uoms : seedUoms(),
    products: Array.isArray(s.products) ? s.products : [],
    // The shop's category tree. Guarded like every other list: a phone that has
    // never built one behaves exactly as before, and the cloud merge can land a
    // tree on it without the shape being assumed.
    productCategories: Array.isArray(s.productCategories) ? s.productCategories : [],
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
    // Guarded like every other list she owns. The rows themselves are cleaned by
    // js/promo.js on every read, so a half-synced or hand-edited record can never
    // reach a screen or the shop un-clamped.
    promoCodes: Array.isArray(s.promoCodes) ? s.promoCodes : [],
  };
  const consolidated = consolidateDeliveryDates(out.deliveryDates, out.orders);
  out.deliveryDates = consolidated.deliveryDates;
  out.orders = consolidated.orders;
  ensureCountUnits(out);
  ensurePlanningUnits(out);
  backfillUnitRefs(out);
  linkProductUnits(out);
  upgradeProductionPlan(out.settings.production, ((s.settings || {}).production) || {});
  return out;
}

// The production plan was measured again on 22 Sep 2026, around the bake day she
// corrected. Three of its fields changed meaning — the wash became the oiling
// and weighing-out, the chiller's trays became her proofer's pans, and the
// mixer's bowl became the tub one oven load comes from — so an older phone's
// numbers cannot simply be kept. They are not dropped in silence either: every
// one of them is named in the changelog of the release that moved it. This
// normalize-time step is the only path that reaches a phone which already holds
// its own copy (the same reason ensureCountUnits exists), and it runs once,
// keyed on planRev.
const PLAN_REV = 145;

export function upgradeProductionPlan(plan, saved) {
  if (!plan || typeof plan !== "object") return false;
  // The marker is read off her own saved copy rather than the merged plan: by
  // the time this runs the new defaults are already sitting in every unset key,
  // so reading planRev off the merged plan would read 145 out of the defaults
  // and skip the migration on the one phone that needs it.
  const was = (saved && typeof saved === "object") ? saved : {};
  if (Number(was.planRev) >= PLAN_REV) return false;
  const had = (k) => Number(was[k]) || 0;

  // Five fields changed what they are asked, and are re-seeded from the bake day
  // she corrected. A number cannot be carried across a change of question — hers
  // would make her phone contradict the chain she gave, and two of these are
  // numbers she had typed (the mix read 6, the wash 20), so they are named one by
  // one in the changelog with the value each replaces. That is what makes this an
  // announced correction rather than a silent edit, and any of them can be typed
  // back in a tap if her stopwatch disagrees.
  //
  //   mixMin    20  "mix the dough in the tub" is the whole mix now, not loading
  //                 it — her own 20 minutes, against the 6 she had.
  //   mixerPans  6  "pans one tub of dough makes". Her cycle is one tub, one oven
  //                 load, six pans. The 28 answered "what does the mixer's bowl
  //                 hold", and kept it would spread one 20-minute mix over four
  //                 tubs of pans and break the chain outright.
  //   scaleMin6 15  the oiling and the weighing-out were one job under two names,
  //                 and the step is the 15 she gave for them together. Her 46
  //                 minutes a batch is the proof: it counts them once.
  //   topMin6    6  her minute a pan. The 8 was measured with the topping in it,
  //                 which this step no longer includes.
  //   swapMin6   2  taking six out and putting six in, both halves. The 4 was one
  //                 half of it.
  plan.mixMin = 20;
  plan.mixerPans = 6;
  plan.scaleMin6 = 15;
  plan.topMin6 = 6;
  plan.swapMin6 = 2;

  // The wash has no successor — its job is inside the 15 above.
  delete plan.washMin6;

  // The trays belonged to the what-if chiller. Her proofer holds the pans now,
  // and the count carries over where she had one: it was always the same
  // cabinet, only ever named after the half of the day she is not running.
  if (!(Number(was.prooferPans) > 0) && had("trays") > 0) plan.prooferPans = had("trays");
  delete plan.trays;

  plan.planRev = PLAN_REV;
  return true;
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
    // Anything that is not the explicit "quote" reads as "flat", which is the behaviour
    // every save written before this switch existed already has.
    postageMode: src.postageMode === "quote" ? "quote" : "flat",
    postageModeSet: src.postageModeSet === true,
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
