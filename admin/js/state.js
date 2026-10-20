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
        // ⚠️ WHICH PRODUCT THE HOMEPAGE CARD PRICES (v593) — a product id, or "" for the old rule.
        homeProductId: "",
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
    // ★★ UNITS SHE DELETED ON PURPOSE (v547). ⚠️ The standard units are re-seeded on every load by
    // `ensureCountUnits`/`ensurePlanningUnits`, so without this note a unit she removed came back the
    // next time the app opened — **a delete that undoes itself**. ⚠️⚠️ AND IT MUST TRAVEL (v548): `uoms`
    // itself is synced, so a removal kept on one phone was undone by the other phone re-seeding it. It is
    // registered in `sync.js`'s LISTS as one record per removed name.
    uomsRemoved: [],
    // ★★ THE ONE TIME THIS PHONE COULD NOT READ ITS OWN COPY (v548). ⚠️ `loadState` used to answer a
    // damaged save by **coming up empty and saying nothing** — see the note there. This remembers that it
    // happened so Check my system can say so, and it is device-local on purpose: it is a fact about THIS
    // phone's storage, not about her book.
    unreadableSave: null,
    products: [],
    // The shop's categories, a tree of any depth (see js/productCategories.js).
    // A separate list from settings.categories, which is the EXPENSE chart — one
    // is what a product is, the other is what money was spent on.
    productCategories: [],
    deliveryDates: [],
    // ★★★ WHAT SHE ACTUALLY BAKED, BY DAY (v514) — bread nobody ordered.
    // ⚠️⚠️ **A TOP-LEVEL LIST AND NOT A FIELD INSIDE `settings`, AND THE REASON IS THE ONE THAT WAS LEARNED
    // THE HARD WAY (v444):** `settings` is ONE row whose `data` is **replaced whole** on push, so two
    // phones both holding production records would **overwrite each other's** — and `recordPayload` carries
    // settings keys from a hand-written whitelist, so a new key there travels **nowhere at all** until it is
    // added. ⭐ **A list is one row PER RECORD (`kind, id, data`), so two phones adding different days
    // MERGE instead of clobbering** — which is exactly why `removedOrders` and `rewards` are lists too.
    bakedDays: [],
    orders: [],
    // ★★ ORDERS THAT WERE REMOVED, KEPT SO THEY CAN BE PUT BACK (v444). See `removeOrders` — this is
    // what stops any removal, hers or the engine's, from being permanent.
    removedOrders: [],
    // ★★★ AND A "FORGET THIS CUSTOMER" IS A FACT OF ITS OWN (v592). ⚠️⚠️ It used to live only on the order
    // rows, and the merge is newest-wins — ⚠️ **so one newer edit from the other phone (a Paid press) put the
    // name, number and address straight back on both.** ⭐ One redaction record per order id, merged like any
    // other list and APPLIED on every load and pull, so the same person cannot come back by being edited.
    redactions: [],
    // ★★ COUPONS SHE HAS TAKEN OFF AN ORDER BY HAND (v450). ⚠️ The credit itself is NOT touched — this is
    // a note that says "not on this one", so putting it back needs no repair.
    declinedCoupons: [],
    // ★★ RECEIPTS SHE HAS DECLARED VOID, WITH HER REASON (v448). ⚠️ NOT A DELETE, EVER — see the note on
    // `voidedReceipts` in views/receipt_register.js. The number stays spent; this is the annotation that
    // says why, so a register row stops reading as an unexplained hole.
    voidedReceipts: [],
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
    // Reward hand-outs (v291): one record each time she settles an advocate's
    // reward — {profileId, holder, what, count, at}. A LIST and never a counter,
    // because the two phones sync record-by-record under last-write-wins and a
    // single incremented number on the profile would be overwritten by whichever
    // phone saved last, losing the other's grant.
    rewards: [],
    occasions: [], // delivery-calendar reminder marks: {from, to, label}
    // Self collection Points (v298): places a customer can collect from that are NOT the
    // bakery — {id, name, address, receiver, phone, feeRM, paused}. ONE record per Point,
    // never a setting: she opens them one at a time and expects most to end, so each has to
    // sync on its own and be pausable without touching the others. See js/points.js.
    points: [],
    // The AREAS that group those Points (v410): {id, name, parentId, sort} — a tree of any depth,
    // the same shape as productCategories. Her words: "top level is Penang Island & Prai. Under
    // Penang Island will be Area like Sg Ara, Balik Pulau, Farlim, Georgetown".
    //
    // ⚠️ A SEPARATE LIST, NOT A FIELD ON A POINT, because an area is not a place: it has no
    // address, no receiver, no fee and no pin, and a customer must never be offered "Penang
    // Island" as somewhere to collect. One record each, so an area built on one phone syncs on
    // its own. See js/pointAreas.js.
    pointAreas: [],
    // The VAN ROUTES those Points are served by (v419): {id, name, sort} — a flat list she grows,
    // not a tree. Her words: "now i need few delivery routes, for one day delivery run day".
    //
    // ⚠️ A ROUTE CARRIES NO DAYS. Her words: "we don control by route, we control by point" — the
    // days live on the POINT (`point.days`), so there is exactly one place a day is ever typed.
    // ⚠️ AND MEMBERSHIP IS SEVERAL: "a point might belong to 2 or more routes", so a Point carries
    // `routeIds`, an ARRAY — unlike `areaId`, which is one id. See js/deliveryRoutes.js.
    deliveryRoutes: [],
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
    // ⚠️⚠️ A DAMAGED SAVE USED TO COME UP EMPTY AND SAY NOTHING (v548). It logged to a console she never
    // opens and handed back a fresh book — and **the next save wrote that empty book over the only local
    // copy**, so the damage became permanent without a single word on screen. ⭐ **The unreadable text is
    // now KEPT under a key of its own, and the fact is remembered in `unreadableSave`**, so Check my system
    // can report it. ⭐ This is the module's own rule: **a check that could not read must never pass.**
    const kept = keepUnreadable();
    console.warn("Corrupt stored data, kept and resetting to defaults", err);
    const fresh = seedFreshState();
    if (kept) fresh.unreadableSave = kept;
    return fresh;
  }
  return seedFreshState();
}

// Put the unreadable copy aside, under its own key. ⚠️ It keeps the LONGEST copy it has seen: a damaged
// save is usually a TRUNCATED one, so the longer text holds more of her book. ⚠️ A phone too full to hold
// even this still resets — the copy is a second chance, never the thing that stops the app opening.
function keepUnreadable() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const key = `${LS_KEY}.unreadable`;
    const existing = localStorage.getItem(key);
    if (!existing || String(existing).length < String(raw).length) localStorage.setItem(key, raw);
    return { at: new Date().toISOString(), chars: String(raw).length };
  } catch {
    return null;
  }
}

// ★★★ THE KEPT DAMAGED COPY, AND THE ONE WAY TO CLEAR IT (v574).
//
// ⚠️ Since v548 a phone that cannot read its saved book keeps the damaged text under its own key rather than
// throwing it away — ⭐ **that copy is the only remnant of whatever lived only on that phone.** ⚠️ But nothing
// could ever clear it, so it counted toward the phone's storage for ever.
// ⭐ These two are the honest pair: one says how much it is, one deletes it — and deleting it is HER decision,
// taken in Settings, with a confirmation that says what it is.
export function unreadableCopy() {
  try {
    const raw = localStorage.getItem(`${LS_KEY}.unreadable`);
    return raw ? { chars: String(raw).length, bytes: byteLen(raw) } : null;
  } catch {
    return null;
  }
}

// Returns what was removed, or null when there was nothing to remove. ⚠️ It also clears the note on this
// phone's state, because the check that speaks for the copy reads that note — leaving it behind would keep a
// warning about a copy that no longer exists.
export function dropUnreadableCopy(state) {
  const had = unreadableCopy();
  if (!had) return null;
  try {
    localStorage.removeItem(`${LS_KEY}.unreadable`);
  } catch {
    return null;
  }
  if (state && "unreadableSave" in state) {
    // ⚠️⚠️ THE HOLD STAYS (v598). ⚠️ Deleting the damaged copy does not restore the book — the phone is still
    // holding the SEED — ⚠️ **so releasing it here let the next save tombstone her whole shared book, while the
    // dialog promised the cloud was not touched.** ⭐ The note stays (marked "the copy is gone"), and only a
    // complete read releases it.
    state.unreadableSave = { ...(state.unreadableSave || {}), removedAt: new Date().toISOString() };
    save(state);
  }
  return had;
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

// ⚠️⚠️ A SAVE THAT FAILED USED TO LOOK EXACTLY LIKE A SAVE THAT WORKED (v534).
//
// ⭐ **It caught the error, wrote it to the console, and carried on** — and the console is something she will
// never see. ⚠️ **Then `saveHook` still ran, so the change was QUEUED AS THOUGH IT HAD BEEN SAVED** — meaning
// "it saved" and "this phone is full" could both be true, silently, and the other phone would then hold a
// change this phone had lost.
// ⭐⭐ **This is the same disease as the stuck queue, in a different organ: a promise with nothing behind it.**
// ⚠️ **And it is a GROWTH fault** — it only appears as her book grows, which is exactly why it had never been
// seen. ⭐ The hook still runs on a failure, and that is deliberate: **if this phone cannot keep the change,
// the shared data is the only place it survives.**
// ⭐⭐ HOW MUCH ROOM THIS PHONE'S SAVED DATA TAKES, MEASURED RATHER THAN GUESSED (v534).
// ⚠️ IN BYTES, NOT CHARACTERS: her 中文 and BM text is THREE bytes a character in UTF-8, so counting
// characters would under-report the space and the warning would arrive late.
// ⚠️ THE LIMIT IS THE BROWSER'S, NOT OURS — it is about 5 MB per site in Chrome and Safari, and it is the
// same store this whole app writes to on every save. Named once here so the check's sentence and its
// arithmetic cannot disagree.
export const PHONE_STORE_LIMIT = 5 * 1024 * 1024; // ~5 MB, the browser's own limit
export const PHONE_STORE_ALERT = 0.85; // a red X only when it is nearly full, never a year early

// ★★★ WHAT THIS PHONE ACTUALLY STORES, NOT JUST THE BOOK (v569).
//
// ⚠️⚠️ THE GAUGE MEASURED ONE FILE AND THE BROWSER STORES THREE. ⭐ Beside `bakeadmin.v1` sit the sync journal
// (`bakeadmin.sync` — a `canonical` copy of every record plus a second copy of every pending one) and, after a
// damaged open, the kept text (`bakeadmin.v1.unreadable`). ⚠️ **Measured: 655 KB of book was 2.11 MB stored
// before a flush and still about 2.2x after it** — so the 85% warning could never fire before saving began to
// fail. ⭐ A gauge that does not measure what fills up is a gauge that says 13% while the phone is full.
export const PHONE_KEYS = ["bakeadmin.v1", "bakeadmin.sync", "bakeadmin.v1.unreadable"];

function byteLen(text) {
  const s = String(text || "");
  try {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  } catch { /* fall through to a character count */ }
  return s.length;
}

// Returns `{ total, parts: { key: bytes }, fallback? }`, or null when nothing could be measured — ⚠️ null, never 0.
// ⚠️ Without a storage API (a test shim, or a browser that refuses it) the BOOK's own size is measured and
// `fallback: true` says so — ⭐ a number that is too small and says which number it is beats no number at all,
// and the real app always has storage.
export function phoneUsage(state) {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
    const only = storedBytes(state);
    if (only == null) return null;
    return { total: only, parts: { "bakeadmin.v1": only }, fallback: true };
  }
  const parts = {};
  let total = 0;
  try {
    for (const k of PHONE_KEYS) {
      const v = localStorage.getItem(k);
      const n = v == null ? 0 : byteLen(v);
      parts[k] = n;
      total += n;
    }
  } catch {
    return null;
  }
  return { total, parts };
}

export function storedBytes(state) {
  try {
    const s = JSON.stringify(state);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    return s.length; // ⚠️ A fallback that may under-count — better than claiming a number we did not measure.
  } catch {
    return null; // ⚠️ null, never 0: an unmeasured size must be SKIPPED, not reported as "empty".
  }
}

// ⚠️ THE VARIABLE IS `lastSaveFailure`, NOT `saveFailure` — ⭐ **the first version declared a `let` and a
// `function` with the SAME name at module scope, which is a SyntaxError, and it took every test that imports
// this module down with it.** ⚠️ **Same class as the `const` among an element tree's arguments (v526): the
// module fails to load, so the fault looks like hundreds of unrelated failures rather than one line.**
let lastSaveFailure = null;
export function saveFailure() { return lastSaveFailure; }
// ⚠️ Test-only: lets a test prove the failure is REPORTED rather than swallowed.
export function resetSaveFailure() { lastSaveFailure = null; }

export function save(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    // ⭐ A clean save CLEARS the flag, so a stale failure never outlives the phone being made room on.
    lastSaveFailure = null;
  } catch (err) {
    // ⚠️ `QuotaExceededError` is the one that matters — the phone is full — but any failure is recorded,
    // because "it did not save" is the only fact that matters here.
    lastSaveFailure = {
      at: new Date().toISOString(),
      name: String((err && err.name) || "Error"),
      reason: String((err && err.message) || "the phone could not store your data"),
    };
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
// ★★★ ONE BAKING DAY IS ONE RECORD PER PRODUCT (v546), AND A LIST THAT ALREADY HOLDS BOTH SHAPES IS
// COLLAPSED HERE (v547).
//
// ⚠️⚠️ THE FAULT v546 LEFT BEHIND: the cloud still holds the OLD one-row-for-the-day records, because
// nothing ever deleted them. A pull puts one back into the list, and the next load splits it into ids
// that are ALREADY there — so the day ends up recorded twice, and stays that way. ⭐ The split therefore
// asks what is already in the list: **a row that is already per product always wins over one derived
// from the old shape**, because the proper row is the one she has been using and its `applied` is what
// the shelf agrees with.
export function splitBakedDays(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const pidsOf = (row) => (row && row.items && typeof row.items === "object" ? Object.keys(row.items) : []);
  const isPerProduct = (row) =>
    !!(row && row.date && pidsOf(row).length === 1 && row.id === bakeId(row.date, pidsOf(row)[0]));

  const out = [];
  const seen = new Set();
  for (const row of list) {
    if (!isPerProduct(row) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  for (const row of list) {
    if (!row || !row.date || isPerProduct(row)) continue;
    const items = row.items && typeof row.items === "object" ? row.items : {};
    for (const pid of Object.keys(items)) {
      const id = bakeId(row.date, pid);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...row, id, items: { [pid]: items[pid] } });
    }
  }
  return out;
}

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
      // ⚠️⚠️ A BLANK ENTRY IN THE BAKE-DAY PATTERN IS DROPPED (v548), and an out-of-range one too. ⭐
      // `Number(null)` is 0 and 0 is SUNDAY, so an imported `[1, null, 3]` made the app say "Mon, Sun and
      // Wed" about a Sunday she never chose. ⚠️ An emptied pattern falls back to the default rather than
      // leaving the app with no bake days at all — **a blank is not an answer to "which days do you bake".**
      deliveryDays: (() => {
        const raw = Array.isArray((s.settings || {}).deliveryDays)
          ? s.settings.deliveryDays : d.settings.deliveryDays;
        const set = [...new Set(raw
          .filter((x) => x !== null && x !== undefined && x !== "" && typeof x !== "boolean")
          .map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b);
        return set.length ? set : d.settings.deliveryDays;
      })(),
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
    // ⚠️⚠️ AN EMPTY LIST IS AN ANSWER *WHEN THE REMOVALS EXPLAIN IT* (v592). ⚠️ `s.uoms.length ? … : seedUoms()`
    // re-seeded every unit whenever the list was empty — ⚠️ **so deleting them all lasted until the next load,
    // and the tombstones were cancelled.** ⚠️ But a damaged or pre-units save with an empty list and NO
    // removals still needs its units. ⭐ `uomsRemoved` is what tells those two empty lists apart.
    uoms: (() => {
      const list = Array.isArray(s.uoms) ? s.uoms : null;
      const gone = normalizeRemovedUnits(s.uomsRemoved);
      if (list && (list.length || gone.length)) return list;
      return seedUoms();
    })(),
    uomsRemoved: normalizeRemovedUnits(s.uomsRemoved),
    unreadableSave: (s.unreadableSave && typeof s.unreadableSave === "object") ? s.unreadableSave : null,
    products: Array.isArray(s.products) ? s.products : [],
    // The shop's category tree. Guarded like every other list: a phone that has
    // never built one behaves exactly as before, and the cloud merge can land a
    // tree on it without the shape being assumed.
    productCategories: Array.isArray(s.productCategories) ? s.productCategories : [],
    deliveryDates: Array.isArray(s.deliveryDates) ? s.deliveryDates : [],
    // ★★★ ONE RECORD PER DAY **PER PRODUCT**, AND THE OLD SHAPE IS SPLIT ON LOAD (v546).
    //
    // ⚠️⚠️ **THE FAULT: the id was `bake_<day>`, ONE ROW FOR ALL PRODUCTS.** ⭐ **Two phones recording different
    // bread on the same day were two versions of ONE record** — and the sync keeps the newest whole record, so
    // **one phone's totals were discarded** and the next correction re-took a bake that had already come off
    // the shelf.
    // ⭐ **A record per product is a separate row each (`bake_<day>_<product>`), so two phones recording
    // DIFFERENT bread MERGE instead of overwriting** — the same reason `removedOrders` and `rewards` are lists.
    // ⚠️ **AND AN OLD ROW IS SPLIT HERE, KEEPING EVERY `total` AND `applied` EXACTLY**, so **no stock moves** —
    // a shape change only. ⭐ A row already in the new shape is left untouched, so this is safe to run on every
    // load and on a phone that has already been updated.
    bakedDays: splitBakedDays(s.bakedDays),
    orders: Array.isArray(s.orders)
      ? s.orders.map((o) => (o && typeof o === "object" ? { ...o, status: o.status || "new" } : o))
      : [],
    // Guarded like every other list she owns: a phone that has never removed an order, and a state
    // written before v444, both behave exactly as before.
    // ⚠️⚠️ AND A ROW FOR AN ORDER THAT IS BACK IN THE LIVE LIST IS DROPPED HERE (v474) — the invariant
    // `dropStaleShelfRows` exists for, applied on every load. ⭐ It reads `s.orders`, the same source the
    // `orders` key above uses, so the two can never disagree about what is live.
    // ⚠️ AND THE SHELF'S OWN NOTE SURVIVES A LOAD (v572) — it was written on removal and never read back, so
    // the screen's sentence vanished on the next open and the running total restarted.
    removedTrim: s.removedTrim && typeof s.removedTrim === "object"
      ? { at: String(s.removedTrim.at || ""), n: Number(s.removedTrim.n) || 0, total: Number(s.removedTrim.total) || 0 }
      : null,
    removedOrders: (Array.isArray(s.removedOrders) ? s.removedOrders : [])
      .filter((r) => !(r && r.id && Array.isArray(s.orders) && s.orders.some((o) => o && o.id === r.id)))
      // ★★★ AND THE DUPLICATE ROWS SHE ALREADY HAS ARE COLLAPSED ON LOAD (v528). ⚠️⚠️ **Without this the fix
      // above would fix NOTHING for her: the rows are already sitting in her data on both phones** — the same
      // reason the v518 void repair had to exist for the button fix to be worth anything. ⭐ The shelf is
      // newest-first, so keeping the FIRST row for each id keeps the most recent removal — and `removedAt`
      // is what the window is counted from.
      .filter((r, i, all) => !(r && r.id) || all.findIndex((x) => x && x.id === r.id) === i),
    // ★★★ AND A VOID RECORD ALREADY ON A PHONE IS GIVEN ITS ID HERE (v518). ⚠️⚠️ Without this, a receipt she
    // has ALREADY marked void stays stranded for ever: the record is in her data, but it can never travel,
    // so her other phone keeps reporting a receipt with no order behind it **and keeps telling her to press
    // the button she has already pressed.** ⭐ The same id the button now writes, so a repair and a fresh void
    // of one receipt cannot become two rows.
    voidedReceipts: Array.isArray(s.voidedReceipts)
      ? s.voidedReceipts.map((v) => (v && !v.id && Number.isFinite(Number(v && v.no))
        ? { ...v, id: voidIdOf(v.no) } : v))
      : [],
    redactions: Array.isArray(s.redactions) ? s.redactions : [],
    // ⚠️⚠️ A RECORD NEEDS AN ID TO TRAVEL (v595). ⚠️ This list held raw id STRINGS, and the sync keys records
    // by `id` — ⚠️ **so a coupon declined on one phone never reached the other, and the two showed different
    // Totals.** ⭐ One object per declined code, migrated from the old strings on load.
    declinedCoupons: (Array.isArray(s.declinedCoupons) ? s.declinedCoupons : [])
      .map((x) => (x && typeof x === "object" ? x : { id: String(x || "") }))
      .filter((x) => String(x.id || "").trim()),
    customers: Array.isArray(s.customers) ? s.customers : [],
    purchaseOrders: Array.isArray(s.purchaseOrders) ? s.purchaseOrders : [],
    expenses: Array.isArray(s.expenses) ? s.expenses : [],
    deposits: Array.isArray(s.deposits) ? s.deposits : [],
    customers: Array.isArray(s.customers) ? s.customers : [],
    credits: Array.isArray(s.credits) ? s.credits : [],
    rewards: Array.isArray(s.rewards) ? s.rewards : [],
    occasions: Array.isArray(s.occasions) ? s.occasions : [],
    points: Array.isArray(s.points) ? s.points : [],
    pointAreas: Array.isArray(s.pointAreas) ? s.pointAreas : [],
    deliveryRoutes: Array.isArray(s.deliveryRoutes) ? s.deliveryRoutes : [],
    // Guarded like every other list she owns. The rows themselves are cleaned by
    // js/promo.js on every read, so a half-synced or hand-edited record can never
    // reach a screen or the shop un-clamped.
    promoCodes: Array.isArray(s.promoCodes) ? s.promoCodes : [],
  };
  const consolidated = consolidateDeliveryDates(out.deliveryDates, out.orders, out.removedOrders);
  out.deliveryDates = consolidated.deliveryDates;
  out.orders = consolidated.orders;
  out.removedOrders = consolidated.removedOrders;
  const split = splitSharedDateIds(out.deliveryDates, out.orders, out.removedOrders);
  out.deliveryDates = split.deliveryDates;
  out.orders = split.orders;
  out.removedOrders = split.removedOrders;
  // ⚠️ AND A HALF-WRITTEN PAYMENT IS SETTLED ON LOAD, the same way a stale shelf row is (v600).
  equaliseOrderLines(out);
  ensureCountUnits(out);
  ensurePlanningUnits(out);
  backfillUnitRefs(out);
  linkProductUnits(out);
  upgradeProductionPlan(out.settings.production, ((s.settings || {}).production) || {});
  // ⚠️⚠️ TWO RECORDS WITH ONE ID ARE ONE RECORD THAT TRAVELS AND TWO THAT COUNT (v582). ⭐ Every list is
  // checked to be an ARRAY and nothing checked that its ids were unique — ⚠️ **so a duplicated row counted
  // twice on this phone while the sync, which keys by id, sent only the last one.** ⭐ Deduped here, on
  // load, keeping the LAST occurrence: ⚠️ **the one the sync would have published is the one kept**, so
  // what she counts and what reaches her other phone are the same record.
  for (const k of ID_LISTS) out[k] = dedupeById(out[k]);
  // ⚠️⚠️ AND A HALF-WRITTEN ORDER IS MADE WHOLE BEFORE ANY READER SEES IT (v600). ⚠️ One line said
  // `paidReceived: true` while its sibling said `null`, and another carried `promo` while its sibling carried
  // none — ⚠️ **the Pay press is only offered while the FIRST line is unpaid and nothing re-applies a promo, so
  // neither could be cleared by hand.** ⭐ The repair runs at every seam a book enters by: load, merge and pull.
  equaliseOrderLines(out);
  // ⚠️ AND A REDACTION IS APPLIED AFTER EVERY LOAD (v592) — see `applyRedactions`.
  applyRedactions(out);
  return out;
}

// ⭐⭐ THE DAYS SHE ACTUALLY BAKES (v608). A SALE-ONLY day (v606) is a container for a hand sale on a
// private date — ⚠️ **it must never be listed as a bake day, offered for production or counted in a
// purchase order.** ⭐ One filter, so every bake-day surface asks the same question.
export function bakeDays(state) {
  return (Array.isArray(state && state.deliveryDates) ? state.deliveryDates : [])
    .filter((d) => d && !d.recordOnly);
}

// ⭐⭐ MAKE EVERY LINE OF ONE ORDER AGREE, WITHOUT EVER COPYING UP (v600).
// ⚠️ Every money reader goes through the FIRST row (`isCollected`, `promoOn`, `money.js`), so a sibling that
// disagrees is a half-written copy, not a second opinion. Two rules, and the direction matters:
//   1. MONEY FOLLOWS THE FIRST ROW. When it says the money is in, every line gets the same state, account and
//      day. A first row that does NOT say paid is left alone — and nothing is ever written UP onto it, because
//      that row is what prices the sale.
//   2. A STAMP IS FILLED, NEVER OVERWRITTEN. `promo` and `receiptNo` exist once per order; a line with its own
//      value keeps it, so a genuine disagreement still shows on Check my system.
// Returns how many rows it changed, so a caller knows whether the repair is worth saving.
export function equaliseOrderLines(state) {
  const orders = Array.isArray(state && state.orders) ? state.orders : [];
  const groups = new Map();
  for (const o of orders) {
    if (!o || !o.id) continue;
    const key = String(o.groupId || o.id);
    const rows = groups.get(key);
    if (rows) rows.push(o); else groups.set(key, [o]);
  }
  let changed = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const first = rows[0];
    const others = rows.slice(1);
    if (first.paidReceived === true) {
      for (const o of others) {
        let touched = false;
        if (o.paidReceived !== true) { o.paidReceived = true; touched = true; }
        if (first.paidMethod != null && o.paidMethod !== first.paidMethod) { o.paidMethod = first.paidMethod; touched = true; }
        if (first.paidAt && o.paidAt !== first.paidAt) { o.paidAt = first.paidAt; touched = true; }
        if (touched) changed++;
      }
    }
    for (const field of ["promo", "receiptNo"]) {
      const source = rows.find((r) => r[field] !== undefined && r[field] !== null && r[field] !== "");
      if (!source) continue;
      for (const o of others) {
        const mine = o[field];
        if (mine === undefined || mine === null || mine === "") { o[field] = source[field]; changed++; }
      }
    }
  }
  return changed;
}

// The fields "Forget this customer" clears. One list, so the button and the re-application cannot drift.
export const REDACTED_FIELDS = ["customerName", "whatsapp", "address", "customerPlace",
  "note", "lineNote", "refundNote"];

// Apply every synced redaction to the orders it names. ⭐ Returns how many rows it cleared.
// ⚠️ A NEWER order row is still redacted: the redaction is a separate decision that outweighs an edit —
// which is the whole point (v592). A redaction older than the row's OWN redaction loses to it.
// ⚠️ THE PHONES OF EVERYONE SHE HAS FORGOTTEN (v598) — so a profile that merges back, or a storefront order
// that arrives after the forget, cannot identify them again. ⭐ Read from the redaction records themselves.
export function redactedPhones(state) {
  const out = new Set();
  for (const r of Array.isArray(state && state.redactions) ? state.redactions : []) {
    const who = String((r && r.who) || "").trim();
    if (who) out.add(who);
  }
  return out;
}

export function applyRedactions(state) {
  const best = new Map();
  for (const r of Array.isArray(state && state.redactions) ? state.redactions : []) {
    if (!r || !r.id) continue;
    const prev = best.get(r.id);
    if (!prev || String(r.at || "") >= String(prev.at || "")) best.set(r.id, r);
  }
  if (!best.size) return 0;
  // ⚠️ AND THEIR PROFILE IS GONE FOR GOOD (v598) — a newer profile edit from the other phone used to merge it
  // back as a live customer with the full name and number.
  const phones = redactedPhones(state);
  // ⚠️⚠️ AND A PERSON WITH NO PHONE IS MATCHED BY THEIR PROFILE'S KEY (v599). ⚠️ `redactedPhones` is built
  // from `who`, which is empty for a customer who only ever gave a name — ⚠️ **so a newer profile row from an
  // offline phone merged the name back in as a live customer.** ⭐ The key was recorded with the redaction.
  const profileKeys = new Set();
  for (const r of Array.isArray(state && state.redactions) ? state.redactions : []) {
    const k = String((r && r.profileKey) || "").trim();
    if (k) profileKeys.add(k);
  }
  if ((phones.size || profileKeys.size) && Array.isArray(state.customers)) {
    state.customers = state.customers.filter((c) => c
      && !phones.has(String(c.whatsapp || "").trim())
      && !profileKeys.has(String(c.key || "")));
  }
  let cleared = 0;
  // ⚠️⚠️ AND THE REMOVED SHELF (v595). ⚠️ It was not redacted: ⚠️ **a forgotten customer's cancelled order kept
  // their name in the Removed list, and "Put it back" restored the whole person.** ⭐ Both lists are hers.
  const rows = [...((state && state.orders) || []), ...((state && state.removedOrders) || [])];
  for (const o of rows) {
    const r = o && best.get(o.id);
    if (!r) continue;
    if (o.redactedAt && String(o.redactedAt) >= String(r.at || "")) continue;
    o.redactedAt = String(r.at || o.redactedAt || "");
    if (r.key) o.redactedKey = String(r.key);
    for (const k of REDACTED_FIELDS) delete o[k];
    cleared += 1;
  }
  return cleared;
}

// The lists whose rows are keyed by an `id`, and therefore the ones a duplicate can split.
// ⚠️ `removedOrders` is NOT here: it already has its own dedupe, and it keeps the FIRST row because the
// shelf is newest-first — a different answer that belongs to that list alone.
const ID_LISTS = ["ingredients", "suppliers", "parcelCouriers", "products", "productCategories",
  "deliveryDates", "bakedDays", "orders", "purchaseOrders", "expenses", "deposits", "credits",
  "rewards", "occasions", "points", "pointAreas", "deliveryRoutes", "promoCodes", "uoms", "redactions"];

// One row per id, the LAST one winning. ⭐ An ordinary list is returned as it was — the same array, not a
// copy — so a load with nothing to fix touches nothing. A row with no id (an imported occasion, say) is
// left exactly as it is, because it cannot be the other half of a duplicate.
function dedupeById(list) {
  if (!Array.isArray(list)) return list;
  let keyed = 0;
  const seen = new Set();
  for (const r of list) {
    if (r && typeof r === "object" && r.id != null) { keyed++; seen.add(String(r.id)); }
  }
  if (keyed === 0 || seen.size === keyed) return list;
  const out = [];
  const kept = new Set();
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (!r || typeof r !== "object" || r.id == null) { out.unshift(r); continue; }
    const k = String(r.id);
    if (kept.has(k)) continue;
    kept.add(k);
    out.unshift(r);
  }
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

// Make sure the standard pet-treat selling units exist. ⚠️ `uoms` IS cloud-synced (this comment said "per
// device" for a long time, and that was stale — it is what let a deleted unit be pushed back), and an
// existing install keeps its own list wholesale, so
// this normalize-time step is the only path that reaches an older phone. Never
// touches a unit that already exists under the same name, whatever its family.
// ★★ A REMOVED UNIT IS A RECORD, AND IT TRAVELS (v548).
//
// ⚠️⚠️ v547 remembered a deletion on the ONE phone that made it — and **`uoms` IS cloud-synced** (the note
// in this file said "per device", and that note is stale). So the other phone pulled the deleted unit away,
// **re-seeded it on its next load and pushed it straight back**: ⭐ **the delete came undone on both
// phones.** ⭐ This is a LIST now, registered in `sync.js` like every other list she owns, so a removal
// reaches the other phone as its own record instead of living only here.
// ⚠️ Stored as `{ id, at }` where `id` is the lowercased NAME — a unit has no other stable key.
export function normalizeRemovedUnits(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const name = String(r && typeof r === "object" ? (r.id || r.name || "") : r).trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: name, ...(r && typeof r === "object" && r.at ? { at: r.at } : {}) });
  }
  return out;
}

// The names the seed must not put back.
export function removedUnitNames(state) {
  return new Set(normalizeRemovedUnits(state && state.uomsRemoved).map((r) => r.id));
}

export function ensureCountUnits(state) {
  const have = new Map();
  // ⚠️⚠️ AND BY ID (v595). ⚠️ The seed was keyed by NAME only, so renaming "dozen" to "doz" left the id
  // `uom_dozen` present and the name absent — ⚠️ **the next load seeded "dozen" back beside it, and the
  // dedupe kept the seed, so the rename was undone.** ⭐ An id that exists is this unit, whatever it is called.
  const ids = new Set((state.uoms || []).map((u) => String(u.id || "")));
  for (const u of state.uoms || []) have.set(String(u.name || "").toLowerCase(), u);
  // ⚠️ A UNIT SHE DELETED STAYS DELETED (v547). Without this the seed put it straight back on the
  // next load, so "Delete" was a press that undid itself. ⭐ And a unit she later adds with the same
  // name is respected, because `have` is asked first — this list only suppresses the RE-SEED.
  const gone = removedUnitNames(state);
  for (const n of TREAT_COUNT) {
    if (have.has(n) || gone.has(n) || ids.has(`uom_${n}`)) continue;
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
  const ids = new Set((state.uoms || []).map((u) => String(u.id || "")));
  for (const u of state.uoms || []) have.set(String(u.name || "").toLowerCase(), u);
  // ⚠️ The same rule as `ensureCountUnits` (v547): a unit she deleted is not put back.
  const gone = removedUnitNames(state);
  for (const [name, family, toBase] of TIME_LENGTH) {
    if (have.has(name) || gone.has(name) || ids.has(`uom_${name}`)) continue;
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
function consolidateDeliveryDates(deliveryDates, orders, removedOrders) {
  const byDate = new Map();
  const removed = new Map(); // removedId -> survivingId
  const out = [];
  for (const d of deliveryDates) {
    if (!d || typeof d.date !== "string" || !d.date) continue;
    const survivor = byDate.get(d.date);
    if (survivor) {
      // ⚠️⚠️ A REAL BAKE DAY UPGRADES A SALE-ONLY ROW (v606). ⚠️ Consolidation keeps the FIRST record per
      // date — ⚠️ **so a sale-only row created first would swallow a real bake day added later, and the
      // shop would never offer a day she meant to open.** ⭐ Any real row on that date clears the flag.
      if (survivor.recordOnly && !d.recordOnly) delete survivor.recordOnly;
      if (d.id) removed.set(d.id, survivor.id);
    } else {
      byDate.set(d.date, d);
      out.push(d);
    }
  }
  if (!removed.size) return { deliveryDates, orders, removedOrders };
  const reId = (o) =>
    (o && o.deliveryDateId && removed.has(o.deliveryDateId))
      ? { ...o, deliveryDateId: removed.get(o.deliveryDateId) }
      : o;
  // ⚠️⚠️ THE REMOVED SHELF IS RE-POINTED TOO (v592). ⚠️ It was not, so an order put back from the shelf kept
  // a day id that no longer existed — ⚠️ **it vanished from its day and that day could be sold over capacity.**
  return { deliveryDates: out, orders: orders.map(reId), removedOrders: (removedOrders || []).map(reId) };
}

// ★ THE ONE SHAPE THE MERGE ABOVE CANNOT SEE (v326). Two records for the SAME
// day look like a duplicate and are merged; two records that share an ID but sit
// on DIFFERENT days look like two ordinary days, and every lookup in this app is
// by id — `byId` answers with the FIRST record holding it, so the second day
// becomes a day that cannot be opened. Her report, 5 Oct 2026: "the order
// calander not able to select 7/10/26 … clicking that date, the date turn red,
// but the SET day's avaibility not changing to 7/10/26" — the red mark followed
// the tap (it is drawn from the day's own id) and the panel under it did not (it
// is drawn from `byId`, which found the other record). It also makes `deleteDate`
// remove BOTH days, because that deletes by id.
//
// The FIRST record to claim an id keeps it, and any later one on a different day
// is moved off it. That is exactly the record `byId` already answers with, so
// nothing that resolves today resolves differently afterwards. Its orders follow
// it — matched on the id AND the order's own `deliveryDate` snapshot, which is
// what tells the two days apart. An order with no snapshot stays where it is:
// on the id, which is where it reads today.
//
// ⚠️ THE NEW ID IS DERIVED FROM THE OLD ONE AND THE DATE, NEVER ROLLED FRESH,
// and that is the whole reason two phones can share this fix. Both of them load
// the same pair and must move the SAME record to the SAME id; two random ids
// would leave one phone's copy riding the old id, the next pull would bring both
// days back onto it, and the fault would return wearing a different hat. It is
// also what makes the step idempotent and safe to un-do a push: the shape it
// produces cannot be produced twice, because after it no id is shared.
//
// Nothing is deleted. Every day, every order and every price survives.
function splitSharedDateIds(deliveryDates, orders, removedOrders) {
  const held = new Map(); // id -> the date of the record that keeps it
  const moved = []; // { oldId, date, id } for each record that had to move
  const out = (deliveryDates || []).map((d) => {
    if (!d || !d.id) return d;
    if (!held.has(d.id)) { held.set(d.id, d.date); return d; }
    // The same day twice is not this fault; consolidateDeliveryDates above is
    // what answers it, and it has already run by the time this is called.
    if (held.get(d.id) === d.date) return d;
    // `~` is outside the alphabet newId rolls from, so this cannot meet one.
    const id = `${d.id}~${d.date}`;
    moved.push({ oldId: d.id, date: d.date, id });
    return { ...d, id };
  });
  if (!moved.length) return { deliveryDates, orders, removedOrders };
  const reId = (o) => {
    const hit = moved.find((m) => o && o.deliveryDateId === m.oldId && o.deliveryDate === m.date);
    return hit ? { ...o, deliveryDateId: hit.id } : o;
  };
  // ⚠️⚠️ AND THE SHELF (v592) — the same predicate: the row's own deliveryDate names which of the two days
  // it belonged to.
  return { deliveryDates: out, orders: (orders || []).map(reId), removedOrders: (removedOrders || []).map(reId) };
}

// ★★ ROWS AN IMPORT CREATED AND COULD NOT SAVE (v598). ⚠️ They were never her orders — the write failed, so
// they exist only in memory — and they must go without landing on the Removed shelf (which exists for orders
// SHE removed). ⭐ A named door, so `order-removal-guard` still means what it says: every OTHER removal goes
// through `removeOrders`.
export function discardImportedRows(state, ids) {
  const want = new Set((ids || []).map(String));
  if (!want.size || !Array.isArray(state.orders)) return 0;
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => !o || !want.has(String(o.id)));
  return before - state.orders.length;
}

// ★★ THE ONE DOOR OUT, AND IT DOES NOT DESTROY (v444).
//
// WHY THIS EXISTS, IN HER WORDS: __"What my concern is it dont happen again"__ — asked after three PAID
// orders left her data on 11 Oct 2026 and were in **none** of her eleven saved copies.
//
// ⚠️⚠️ THE THING THAT MADE IT PERMANENT WAS NOT THE REMOVAL — IT WAS WHAT HAPPENED NEXT. `sync.js`
// tombstones **every record that was in the last snapshot and is gone now**, whatever removed it: a press,
// a fault, a hand-edit. The tombstone goes to the shared cloud, the other phone deletes its copy, and **every
// backup taken afterwards is a copy of data the order is already missing from.** ⭐ So the loss propagated
// in one direction and there was no way back on any device.
//
// ⭐ THE GUARD IS NOT "STOP THE REMOVAL" — I still cannot prove what removed them, and a promise I cannot
// back is worse than none. **It is that a removed order is KEPT.** It moves into `state.removedOrders`:
// - a SEPARATE record, so the tombstone written for the order does not touch it — it survives on both
//   phones and inside every copy, which is exactly what the orders did not;
// - listable and restorable, so **whatever** removes an order — her, me, a fault, or the cloud — it can be
//   put back.
//
// ⚠️ EVERY REMOVAL MUST COME THROUGH HERE. `test/order-removal-guard.test.js` fails the moment anything
// else drops rows from `state.orders`, so a future screen cannot quietly go round it.
// ★★ HER NUMBER, AND SHE HAS NOW CHANGED IT — 30 DAYS, ASKED AND ANSWERED ON 2026-10-17 (v530).
//
// ⚠️ THE HISTORY MATTERS, BECAUSE THE FIRST NUMBER WAS MINE: v452 recorded __"the deleted order just need to
// keep for 48hrs"__ — **her words, chosen over my guess of thirty days.** ⭐ And 48 was the right number for
// the question she was answering: HOW LONG A REMOVED ORDER STAYS PUTTABLE-BACK.
//
// ⚠️⚠️ BUT ONE CONSTANT WAS DOING TWO JOBS. The "no order has left this phone without a trace" check opens a
// saved copy about a WEEK old, and **a 48-hour shelf cannot explain a removal inside a week-old copy** — so
// the check named her own cancellations as losses, for the whole band between two days and a week. ⭐
// **Munchies found the same thing and raised it at her direct request; she was asked again here, and chose
// 30 days.** ⚠️ **The tension is NAMED rather than hidden: the put-back window she chose and the trace the
// check needs were never the same question, and one number is still doing both.** Raising it satisfies the
// check and gives her a month to put an order back; ⭐ **if she ever wants the two separated, this is the line
// to split.**
//
// ⚠️ KEEP IT IN HOURS: it is read against her own words, and `removedKeepWords()` is the ONE place that turns
// it into the words a screen prints — **so no screen repeats the number and no screen can drift from it.**
export const REMOVED_KEEP_HOURS = 720; // 30 days
const REMOVED_MAX = 200;

// ⭐ THE WORDS FOR THE WINDOW, IN ONE PLACE (v530). ⚠️⚠️ **Every screen that says how long the shelf keeps an
// order now asks this function** — the shelf's own sentence, the receipt check and the trace check. ⚠️ A
// hard-coded "48 hours" in three files is three chances to disagree with the constant, and this project has
// already paid for that once (a stale comment saying "thirty days" was quoted back to her as evidence).
export function removedKeepWords() {
  return REMOVED_KEEP_HOURS % 24 === 0 ? `${REMOVED_KEEP_HOURS / 24} days` : `${REMOVED_KEEP_HOURS} hours`;
}

export function removeOrders(state, ids, reason = "") {
  const want = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
  if (!want.size) return [];
  const gone = [];
  const keep = [];
  for (const o of (state.orders || [])) {
    if (o && want.has(o.id)) gone.push(o);
    else keep.push(o);
  }
  if (!gone.length) return [];
  state.orders = keep;
  if (!Array.isArray(state.removedOrders)) state.removedOrders = [];
  const at = new Date().toISOString();
  for (const o of gone) {
    const kept = { ...o, removedAt: at };
    if (reason) kept.removedWhy = reason;
    // ★★★ ONE ORDER, ONE SHELF ROW — ALWAYS (v528). ⚠️⚠️ HER REPORT: __"there is so many duplicate order
    // number in the Removed Orders"__. ⭐ **The shelf used to simply unshift a new row, so an order that came
    // back and was taken off again left a SECOND row with the same number** — and the shared data hands an
    // order back whenever its removal has not landed, so that is a loop, not an accident.
    // ⭐ **The old row is replaced rather than kept beside the new one: the shelf holds what is NOT in the
    // list, and that is one row's worth of fact.**
    if (o.id) state.removedOrders = state.removedOrders.filter((r) => !(r && r.id === o.id));
    state.removedOrders.unshift(kept);
  }
  pruneRemovedOrders(state);
  return gone;
}

// ⚠️ A SHELF THAT ONLY GROWS IS A LEAK — this keeps it to a window. ⚠️⚠️ AND THE WINDOW IS NAMED BY THE
// CONSTANT AND NOTHING ELSE: **this comment used to say "Thirty days is long enough" while the constant said
// 48, and that disagreement was QUOTED BACK TO HER AS EVIDENCE** — ⭐ **a comment that repeats a number is a
// second copy of somebody's decision, and second copies drift.** ⚠️ 48 hours is HER number, from v452 —
// __"the deleted order just need to keep for 48hrs"__ — chosen over a developer guess of thirty days.
// ⭐ `REMOVED_MAX` is a separate guard: far more rows than a bakery removes inside that window.
function pruneRemovedOrders(state) {
  const list = Array.isArray(state.removedOrders) ? state.removedOrders : [];
  const cut = new Date(Date.now() - REMOVED_KEEP_HOURS * 3600000).toISOString();
  // ⚠️ The 30-day window is HER rule and is stated on the screen. The SIZE guard is the app's own, and until
  // v570 it cut the oldest rows off in silence — ⭐ so an order she could still have put back simply vanished.
  // ⭐ It still bounds the shelf, and it now SAYS it did.
  const withinTime = list.filter((r) => r && String(r.removedAt || "") >= cut);
  state.removedOrders = withinTime.slice(0, REMOVED_MAX);
  const dropped = withinTime.length - state.removedOrders.length;
  if (dropped > 0) {
    // ⭐ EVERY REMOVAL PAST THE 200th CLEARS ONE MORE, so the number that matters is how many have been cleared
    // IN ALL — `n` is this event, `total` is what the screen says.
    const before = Number(state.removedTrim && state.removedTrim.total) || 0;
    state.removedTrim = { at: new Date().toISOString(), n: dropped, total: before + dropped };
  }
}

// ★★★ AND A SHELF ROW FOR AN ORDER THAT IS BACK IS STALE BY DEFINITION (v474).
//
// HER REPORT, with the check's own line: __"Nothing is on the orders list and the Removed list at once —
// 3"__, naming `#9F47F5 · #D06D27 · #5C55CF` ⭐ **the three she put back after the 11 October loss.**
// ⚠️⚠️ **THEIR SHELF ROWS SURVIVED THE RESTORE, BECAUSE SENDING WAS BROKEN AT THE TIME** — the removal of
// the shelf row was queued and never left, so it came back down on the next pull. **The same damage as
// every other line that week.**
// ⭐ **AND IT IS NOT A THING SHE SHOULD HAVE TO CLEAR BY HAND: an order that is in the live list AND on the
// shelf cannot be both.** The shelf's whole purpose is to hold what is NOT in the live list — so the row is
// **stale, and dropping it cannot lose anything, because the order itself is right there.**
// ⚠️ **SAFE BY CONSTRUCTION**: `removeOrders` takes the order OUT of the live list first and only then puts
// it on the shelf, so the tidy can never race a removal. **A row for a genuinely removed order is kept.**
export function dropStaleShelfRows(state) {
  const live = new Set((Array.isArray(state.orders) ? state.orders : [])
    .filter(Boolean).map((o) => o && o.id).filter(Boolean));
  const shelf = Array.isArray(state.removedOrders) ? state.removedOrders : [];
  const kept = shelf.filter((r) => !(r && r.id && live.has(r.id)));
  state.removedOrders = kept;
  return shelf.length - kept.length;
}

// Put one back exactly as it was — the same id, its group, its day, its price. ⚠️ The `removedAt` mark is
// taken off, because it is a record of the loss and not a fact about the order.
export function restoreRemovedOrder(state, id) {
  const list = Array.isArray(state.removedOrders) ? state.removedOrders : [];
  const i = list.findIndex((r) => r && r.id === id);
  if (i < 0) return null;
  const back = { ...list[i] };
  delete back.removedAt;
  delete back.removedWhy;
  list.splice(i, 1);
  if (!Array.isArray(state.orders)) state.orders = [];
  state.orders.push(back);
  return back;
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
    // ⚠️⚠️ THE HOMEPAGE PRODUCT SHE PICKED (v595). ⚠️ It was written by Settings but NOT in this whitelist —
    // ⚠️ **every app open, Import and Restore silently discarded it**, and the next publish put the homepage
    // back on the first product.
    homeProductId: String(src.homeProductId || "").trim(),
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
// ★★ AND IT MUST NEVER MOVE (v441) — a code that has been issued is the order's for life.
//
// Her words, and she is describing a KEY rather than a label: __"the randon order number is a plus
// point in our system, it is a unique identify of an order. Even the merchant dont control. Giving
// this to a customer is like giving a key to a customer, we know and customer know. delivery man
// will not know, a stranger trying to take advantage, will not be able to do so."__
//
// ⚠️⚠️ UNTIL v441 THE KEY SILENTLY CHANGED. This derivation reads `groupId || id`, and a one-item
// order has NO groupId — so its code came from its own id, and **the moment that order gained a
// second item a group name was invented for it and the visible code was re-derived from THAT.**
// Same order, same customer, same money, a different code. Verified on a real screen before it was
// fixed: one item `#1`, a second item added, **`#55568B`.**
//
// ⭐ WHAT THAT COST, and every one of these was live:
//   - a RECEIPT already written held the old code, so the register reported "not in this phone's
//     orders" about an order that was still there — and it would have gone on saying so forever;
//   - the CONFIRMATION sent to the customer quoted the old code, so searching the code she gave them
//     found nothing at all;
//   - ⭐ **and that is exactly how an order comes to look like it vanished when it never did.**
//
// ⭐ THE FIX IS NOT A FIELD ON THE ORDER. A frozen `code` copied onto every row would have rewritten
// her whole book the first time it loaded, and this app's first rule is that nothing of hers is
// rewritten by a change she asks for. **The code is held still by BUILDING THE GROUP NAME OUT OF THE
// ORDER'S OWN ROW instead** — see `applyPopupEdits`, which is the only place an existing order ever
// gained a group name. Those six characters are then the same before and after, and not one stored
// order was touched to achieve it.
export function orderCode(order) {
  const hex = String((order && (order.groupId || order.id)) || "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(-6)
    .toUpperCase();
  return hex || "??????";
}

// ★★★ NO TWO ORDERS MAY WEAR THE SAME NUMBER (v554).
//
// ⚠️⚠️ THE CODE IS THE LAST SIX HEX CHARACTERS of the order's own id — about **3% by 1,000 orders** — and
// the shared data keys BOTH the tracking card and the receipt register by it. ⭐ **Two orders landing on
// one code would share one tracking card and one receipt number: two customers reading each other's
// bread.** ⚠️ It cannot simply be lengthened, because that would MOVE every code already given out —
// **v441 was exactly that fault, and it cost a live receipt and a confirmation that pointed nowhere.**
// ⭐ So this FINDS the collision instead of preventing it, and the app can say so on her screen.
// Answers one `{ code, ids }` per code worn twice, in the order the codes first appear.
export function duplicateOrderCodes(orders) {
  const byCode = new Map();
  for (const g of groupOrders(Array.isArray(orders) ? orders : [])) {
    const first = (g.orders || [])[0];
    if (!first) continue;
    const code = orderCode(first);
    if (!code || code === "??????") continue;
    const row = byCode.get(code) || { code, ids: [] };
    row.ids.push(String(first.groupId || first.id || ""));
    byCode.set(code, row);
  }
  return [...byCode.values()].filter((r) => r.ids.length > 1);
}

// ★★ ONE NAME, ONE RECORD — CASE AND SPACING ARE NOT A DISTINCTION (v564).
//
// ⚠️⚠️ HER OWN REPORT: __"for strong flour, on hand show 0, but open up the stock card says on hand
// 6kgs"__ and __"the yeast might have the same problem too"__. ⭐ **Two ingredients with one name is the
// only way two screens can show two figures for one name** — the card and the sheet both read `onHand`.
// ⚠️ And nothing stopped a second one being made. `exceptId` is the record being RENAMED, which must not
// count as a clash with itself.
// ⚠️ ONE SPELLING OF "THE SAME NAME" (v568). The check and the Add warning must agree: case, surrounding
// spaces AND runs of spaces inside it are collapsed, so "Strong  flour" is the same card as "Strong flour".
export function ingredientNameKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function sameNameIngredient(state, name, exceptId = "") {
  const key = ingredientNameKey;
  const wanted = key(name);
  if (!wanted) return null;
  return (Array.isArray(state && state.ingredients) ? state.ingredients : [])
    .find((i) => i && String(i.id) !== String(exceptId) && key(i.name) === wanted) || null;
}

// ★★ WHICH OF A DUPLICATED PAIR CAN BE PUT AWAY, DECIDED BY HER OWN RECIPES (v564).
//
// ⚠️ **"Strong flour ×2" tells her there is a problem and not which card to keep.** ⭐ The fact that
// settles it is already in her book: **a recipe points at exactly one of the two**, and the other is a
// card nothing uses. ⚠️ It is only offered when the answer is UNAMBIGUOUS — a pair where exactly one is
// used, and a pair and nothing else. ⚠️ **HIDING, NEVER DELETING**: her base rule is that anything a
// transaction has used cannot be deleted, and hiding keeps the stock card it explains.
export function duplicateIngredientPlan(state) {
  const key = ingredientNameKey;
  const byName = new Map();
  for (const i of (Array.isArray(state && state.ingredients) ? state.ingredients : [])) {
    if (!i || !key(i.name)) continue;
    // ⚠️⚠️ A HIDDEN CARD IS NOT PART OF A LIVE PAIR (v568) — the check skips hidden records too. ⭐ Without
    // this, "Salt" (an active card no recipe uses, and a HIDDEN one that a recipe does use) made the press
    // hide the ACTIVE card and leave the name with no visible card at all.
    if (i.active === false) continue;
    byName.set(key(i.name), (byName.get(key(i.name)) || []).concat(i));
  }
  const uses = (id) => (Array.isArray(state && state.products) ? state.products : [])
    .filter((p) => p && (Array.isArray(p.recipe) ? p.recipe : []).some((l) => l && String(l.ingredientId || "") === String(id)))
    .length;
  const plan = [];
  for (const group of byName.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    const ua = uses(a.id);
    const ub = uses(b.id);
    if (ua > 0 && ub === 0) plan.push({ keep: a, hide: b });
    else if (ub > 0 && ua === 0) plan.push({ keep: b, hide: a });
  }
  return plan;
}

// ★ THE CODE AN ORDER CARRIED BEFORE IT WAS EVER GROUPED (v441) — the id-only derivation, kept for
// ONE job: a receipt written before this fix holds THAT code, and the register must still be able to
// find the order it belongs to. ⚠️ It is a look-up alias and nothing else — `orderCode` is what every
// screen and every new receipt shows.
// HOW MANY ORDERS ARE ON A BAKE DAY — counted the way she uses the word (v583). ⚠️ A customer with a
// two-item cart is ONE order; the day's delete question used to count its two ROWS and say "2 order(s)".
export function ordersOnDate(state, dateId) {
  const rows = (Array.isArray(state && state.orders) ? state.orders : [])
    .filter((o) => o && o.deliveryDateId === dateId);
  return groupOrders(rows).length;
}

export function codeFromId(order) {
  const hex = String((order && order.id) || "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(-6)
    .toUpperCase();
  return hex || "??????";
}

// ★★ THE ADDRESS THAT OPENS ONE ORDER (v381). Her words: __"can make the order number
// clickable to bring us to the order so i can admen it, or look at it detail"__.
//
// ⚠️ ONE DEFINITION, IN ONE PLACE, because the whole feature rests on the link and the
// screen that honours it agreeing. Written here rather than in each view so a mistyped
// parameter name cannot make a press land on the Orders screen and quietly do nothing —
// which is exactly the control the register refused to draw in v366.
//
// ⚠️ It is a real `#` address, not just a handler: it can be long-pressed, copied, or
// pasted back in, and it survives a reload — a deep link, not a trick.
export function orderHref(code) {
  return `#/orders?order=${encodeURIComponent(String(code || "").trim().toUpperCase())}`;
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

// ★★★ A RECEIPT SHE MARKS VOID NEEDS AN ID, OR IT CAN NEVER REACH HER OTHER PHONE (v518).
//
// ⚠️⚠️ It was written **with no `id` at all**, and this is the whole of __"different device not sync"__:
// the System check tells her to Mark as void a receipt with no order behind it; she did it on the Mac; ⚠️
// **a record that cannot be keyed cannot travel**, so the sync dropped it; ⭐ **and her phone kept showing
// the same error for ever, telling her to press the button she had already pressed.**
//
// ⭐ THE ID IS DERIVED FROM THE RECEIPT NUMBER, so two phones voiding one receipt make ONE row rather than
// two — the same rule as the bake day (`bake_<iso>`) and the order number. ⚠️ And it lives HERE, in the data
// model, because **the button that creates the record and the repair that fixes an older one must not be
// able to disagree about it.**
export const voidIdOf = (no) => `void_${Math.floor(Number(no))}`;

// ⭐ THE ONE PLACE A BAKING DAY RECORD IS KEYED (v546) — a day AND a product, so two phones recording
// different bread on one day make two rows instead of two versions of one. ⚠️ It lives in `state.js` because the
// load repair needs it and `stock.js` already imports from here — the other direction would be a cycle.
export const bakeId = (day, pid) => `bake_${String(day || "")}_${String(pid || "")}`;

export function newVoidRecord(no, code, reason = "", at = "") {
  return {
    id: voidIdOf(no),
    no,
    code,
    at: at || new Date().toISOString(),
    reason: String(reason || "").trim(),
  };
}

export function byId(list, id) {
  return list.find((x) => x.id === id);
}

// ★★★ WHETHER AN ORDER HAS REACHED ITS LAST STAGE — "Collected / Shipped" (v511).
//
// ⚠️⚠️ HER REPORT: __"order that already mark shipped still appear in delivery run"__. ⭐ **The run asked
// "has the COURIER taken it?" and never "has SHE marked it gone?"** — and those are two ways the same
// thing becomes true. v507 closed the first (a trip the courier has collected or delivered) and left the
// second open, so **an order she marked Collected / Shipped with her own hand still came back onto the
// van list.**
//
// ⭐ IT LIVES HERE, IN THE DATA MODEL, because the STAGE VOCABULARY has to have one home: the labels and
// the order of the stages are the Orders screen's (`STATUSES` in views/orders.js), and money.js already
// writes the same list out a second time for its own "past Paid?" question, with a comment saying why.
// ⚠️ **A THIRD copy written at the run screen is exactly how the three would come to disagree** — which
// is the fault `needsVan` carries a comment about, twice over.
//
// ⚠️ AND IT IS THE LAST STAGE, NOT "the courier said something": the stage covers BOTH endings on purpose
// (v97 named it per order; she asked for the pair itself, 15 Sep 2026), so one id answers for a parcel
// and a collection alike.
export function orderDone(order) {
  return String((order && order.status) || "new") === "delivered";
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
//
// ★ AND WHAT IT COST TO BAKE (`unitCost`, v380) IS FROZEN THE SAME WAY. Her
// words: "when i change the ingredient cost, for age orders, will its COS
// change?" — and it did, because the books worked every line's cost out afresh
// from today's ingredient prices, so editing one price quietly rewrote every
// past month's profit. The cost now rides on the order beside the price, and
// the books read that instead of re-deriving it.

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

// Freeze the sold name, price and cost onto an order row from a product — or
// from a storefront order line, which carries the same two fields ({ name,
// price }). Never invents a value: a product with no price set leaves the line
// unpriced so it keeps following the live product.
//
// `unitCost` is the recipe cost of ONE unit, worked out by the caller (which is
// the only place `state` and `costOf` are both in hand — bom.js imports THIS
// file, so this file cannot import bom.js back). Omit it and the line's cost is
// left exactly as it was.
export function stampOrderLine(o, product, unitCost) {
  if (!o || !product) return o;
  const name = String(product.name || "").trim();
  if (name) o.productName = name;
  const price = product.price;
  // ⚠️⚠️ ROUNDED TO THE CENT WHERE IT IS FROZEN (v577). ⭐ MEASURED: two lines sold at RM0.005 printed as
  // "RM 0.01" each under a Total of RM0.01 — the invoice added its printed lines and demanded RM0.02, while
  // the confirmation and the tracking card rounded the sum and said RM0.01. ⚠️ **One sale, two totals, both on
  // paper.** A price is money; the half-cent existed because a 3-decimal number was accepted and then shown
  // rounded. ⭐ Fixed at the ORIGIN, so every surface reads the same number — and no stored order is rewritten.
  if (price != null && price !== "" && Number.isFinite(Number(price))) o.unitPrice = round2(Number(price));
  // ⚠️⚠️ A ZERO IS DELIBERATELY NOT STAMPED, and so is anything unreadable. A
  // product whose recipe prices to nothing YET would otherwise have 0 locked
  // onto every order it ever had — and stay 0 for ever once she builds the
  // recipe, which is a wrong number that can never move again. Un-stamped, the
  // line keeps following the live recipe, which is exactly what it does today,
  // so nothing regresses. (Number(null) is 0 and Number("") is 0, so `> 0` is
  // also what rejects an empty or missing argument.)
  const cost = Number(unitCost);
  if (Number.isFinite(cost) && cost > 0) o.unitCost = cost;
  return o;
}
