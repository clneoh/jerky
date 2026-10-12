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
import { removeOrders, dropStaleShelfRows, save, STOCK_PRODUCTION } from "./state.js";
import { mergeWeekCheck } from "./weekly.js";
// The one answer to "is this a place" — see placeForSync below for why the courier
// module's own rule is asked rather than a copy of it written here.
import { validPlace } from "./courier_place.js";

const SYNC_KEY = "bakeadmin.sync";

const LISTS = {
  orders: "orders",
  // ⚠️⚠️ NAMED HERE OR IT DOES NOT TRAVEL (v444). A new list is device-local until it is registered in
  // this map — and this one MUST travel: an order removed on one phone has to be puttable-back on the
  // other, which is the whole point of keeping it. ⭐ And it is a SEPARATE record from the order, so the
  // tombstone written for the order does not touch this one.
  removedOrders: "removedOrders",
  // ⚠️ A VOID DECISION IS HERS, and it must reach the other phone — otherwise the same register reads
  // as four unexplained holes on one device and as four voided rows on the other.
  voidedReceipts: "voidedReceipts",
  declinedCoupons: "declinedCoupons",
  products: "products",
  productCategories: "productCategories", // the shop's category tree — a heading built on one phone must exist on the other
  ingredients: "ingredients",
  suppliers: "suppliers", // who you buy from — pack prices ride ingredients, so the shops must too
  parcelCouriers: "parcelCouriers", // the carriers she posts parcels with — a carrier added on one phone has to exist on the other, or the order screen offers a list that is different on every phone
  uoms: "uoms", // units of measure — a unit added on one phone has to exist on the other
  deliveryDates: "deliveryDates",
  purchaseOrders: "purchaseOrders",
  expenses: "expenses", // money out — what one phone spends, the other should see
  deposits: "deposits", // money in from your own pocket — same on every phone
  credits: "credits", // bring-a-friend ledger rows
  rewards: "rewards", // reward hand-outs — a record per grant, so neither phone can overwrite the other's
  points: "points", // Self collection Points — one record each, so opening one on a phone does not disturb the others
  // ⚠️ A NEW LIST IS NOT CARRIED UNTIL IT IS NAMED HERE. A new FIELD on an existing record needs
  // no registration (records travel whole, as JSON), but this is a list of its own — so an area
  // built on one phone reaches the other only because of this line.
  pointAreas: "pointAreas", // the collection AREA tree that groups the Points (v410)
  deliveryRoutes: "deliveryRoutes", // the VAN routes a Point is served by (v419) — a route named on one phone has to exist on the other, or the Points screen offers a different list of vans on every device
  occasions: "occasions", // delivery-calendar reminder marks
  // A promo code made on one phone has to exist on the other, or a card she
  // prints and hands out works on the phone that made it and nowhere else.
  promoCodes: "promoCodes",
  customers: "customers", // customer profiles (pet name/photo, likes, notes)
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

// Why this phone is not part of the shared cloud right now, for the amber
// "Not sharing right now" strip. Returns { on: true } while it shares. When
// not sharing, `kind` is why:
//   'off'       shared data is switched off (connection is configured)
//   'unset'     never connected (no Supabase URL/key saved on this phone)
//   'signedout' shared data is on but the session is gone
// Stored credentials mean the app auto-logs-in on its own — that moment is
// treated as sharing (a login that actually fails lands in the sign-in gate,
// not on a banner). `signedIn` is injectable for tests.
export function sharingState(state, signedIn) {
  const c = cloudCfg(state);
  if (!c.on) return { on: false, kind: c.ready ? "off" : "unset" };
  const signed = signedIn === undefined ? isSignedIn() : signedIn;
  return signed || !!(c.email && c.password)
    ? { on: true }
    : { on: false, kind: "signedout" };
}

// ── records / change detection ────────────────────────────────────────────

// The business payload for a record. Settings sync only the keys every phone
// should share — connection config (`supabase`, `cloud`) stays per-device, and
// so does the app-password `lock`. The weekly checklist `weekCheck` DOES sync
// (so Home's to-do agrees on both phones) and is union-merged on pull (below).
//
// v200 is the sweep that came after this note and found it had been read too
// generously: `categories`, `payMethods`, `mailingAddress`, `personNames` and
// `personCalls` were edited on a phone and never named in this function, so they
// were silently device-local by OMISSION rather than by decision. They are
// carried now. What is still deliberately per-device, and should stay so: the
// three above, plus `savedOccNames` (usable only on a phone she named it on),
// `runDay` (which run she is looking at, not content) and the `migratedVNN`
// markers, which must be per-phone because each phone runs its own migrations.
// `storefront` is absent too, but not by oversight: it reaches the customer page
// through its own publish path, not through this row.
//
// This app adds two guarded keys of its own to the same rule, all carried only
// once this phone has an opinion: `postageRM` (the flat nationwide-post fee,
// guarded by the phone's own `storefront.postageSet` flag — a phone still sitting
// at the default must not overwrite what she set on the other phone) and
// `postageMode` (whether posted orders carry that fee at all or are quoted by
// courier, guarded by its own `storefront.postageModeSet` — a phone that has never
// touched the switch must not push its default "flat" over "quote" chosen on the
// other phone). Its lists ride LISTS below.
// Developer contact helpers for the settings record: whether it has been set at
// all, and the trimmed {name, emails} shape the cloud should carry.
function devOf(rec) {
  return (rec.developer && typeof rec.developer === "object") ? rec.developer : {};
}
function devSet(rec) {
  const d = devOf(rec);
  return Boolean(String(d.name || "").trim())
    || (Array.isArray(d.emails) && d.emails.some((e) => String(e).trim()))
    || Boolean(String(d.whatsapp || "").trim());
}
// The board's acknowledgement ticks — the green coaches on /production — are the
// one guarded key that is an OBJECT rather than a list, so it needs a helper of
// its own to say whether this phone has anything to say about it. It carries the
// ticks only once somebody has ticked one: a phone that has never opened the
// board must not push an empty map over the other phone's ticks. An emptied map
// is a different thing from an absent one, and it is the SPEAK_EMPTY rule below
// that says so — "Clear the board" writes `{}` and it has to travel as `{}`.
function acksSet(rec) {
  const a = (rec.boardAcks && typeof rec.boardAcks === "object") ? rec.boardAcks : {};
  return Object.keys(a).length > 0;
}
// The planner's people (`personNames` / `personCalls`) and the two empty-able
// value keys below need the same question asked of them: has this phone actually
// put anything in it? An ARRAY is excluded even though `typeof` calls it an
// object — `categories` and `payMethods` are compared with Array.isArray, so a
// list accidentally stored in one of these slots must not read as content.
function plainKeys(v) {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
}
function cleanDeveloperForSync(dev) {
  const src = (dev && typeof dev === "object") ? dev : {};
  return {
    name: String(src.name || "").trim(),
    emails: Array.isArray(src.emails)
      ? src.emails.map((e) => String(e || "").trim()).filter(Boolean)
      : [],
    whatsapp: String(src.whatsapp || "").trim(),
  };
}

// The bakery's courier pickup pin, in the shape the cloud carries — or null when
// there is no pin to carry. That single return value answers both questions at once
// ("does this phone have an opinion" and "what goes in the payload"), so there is
// no way for the two to disagree.
//
// The test for a place is the courier module's own validPlace rather than one
// written here, because there must be exactly ONE answer in the app to "is this a
// place". Two answers would drift, and the way they would drift is the expensive
// one: a phone believing a spot is pinned that sync refuses to hand over, so the
// other phone asks her to walk the map again for a door she already marked. It is
// also the stricter of the two — `Number(null)` is 0, so a hand-written check would
// have carried a place whose latitude was null as a real point on the Equator.
function placeForSync(rec) {
  const src = validPlace(rec && rec.pickupPlace);
  if (!src) return null;
  return {
    lat: src.lat,
    lng: src.lng,
    label: src.label,
    // Carried so the two phones agree about WHEN as well as where — the pin's own
    // screen says when it was placed, and a phone that received `lat`/`lng` without
    // `at` would show the pin it did not make as one it had.
    at: String((rec.pickupPlace && rec.pickupPlace.at) || "").trim(),
  };
}

function recordPayload(kind, rec) {
  if (kind === "settings") {
    // The flat nationwide-post fee quotes posted orders on WhatsApp. It syncs
    // between THIS owner's phones (last person who set it wins) so the quote is
    // the same on both — but it is deliberately NOT in the storefront_config
    // publish (see storefrontPayload in supabase.js), so customers never read
    // it. Only a phone that has actually SET it (storefront.postageSet) emits
    // it — a phone still at the default 8 must not overwrite the 6 she set on
    // the other phone (same guard as `tasks` below).
    const sf = rec.storefront || {};
    const hasPostage = sf.postageSet === true && typeof sf.postageRM === "number";
    // Which way delivery is priced rides here too, and under its OWN flag: a phone
    // that has never touched the switch has no opinion about it, and letting its
    // default "flat" travel would silently undo "quote" chosen on the other phone.
    const hasPostageMode = sf.postageModeSet === true
      && (sf.postageMode === "flat" || sf.postageMode === "quote");
    // Asked of both phones in the same place, so "do I have a pin" and "what is the
    // pin" cannot come out differently. Null on a phone that has never pinned one.
    const courierPin = placeForSync(rec);
    return {
      defaultCapacity: rec.defaultCapacity,
      deliveryDays: rec.deliveryDays,
      cutoff: rec.cutoff,
      currency: rec.currency,
      weekCheck: rec.weekCheck || { week: "", done: {} },
      referrals: rec.referrals || {}, // bring-a-friend scheme numbers
      // The flat nationwide-post fee quotes posted orders on WhatsApp. It syncs
      // between THIS owner's phones (last person who set it wins) so the quote is
      // the same on both — but it is deliberately NOT in the storefront_config
      // publish (see storefrontPayload in supabase.js), so customers never read
      // it. Only a phone that has actually SET it (storefront.postageSet) emits
      // it — a phone still at the default 8 must not overwrite the 6 she set on
      // the other phone (same guard as `tasks` below).
      ...(hasPostage ? { postageRM: sf.postageRM } : {}),
      ...(hasPostageMode ? { postageMode: sf.postageMode } : {}),
      production: rec.production || {}, // the line planner's numbers — both phones bake from them
      // How the four customer messages open (2 Oct 2026), carried only once she has
      // chosen the leaning greeting — the same guard as the keys below and for the
      // same reason: every phone holds "plain" from the day it is set up, so carrying
      // the default always would let a phone that never touched the choice push it
      // over the phone that did.
      ...(rec.messageStyle === "greeting" ? { messageStyle: "greeting" } : {}),
      // The scenario she has built, only once she has built one — same guard as
      // the two lists below: a phone that never opened the planner must not push
      // an empty scenario over the one she designed on the other phone.
      ...(Array.isArray((rec.scenario || {}).modules) && rec.scenario.modules.length
        ? { scenario: rec.scenario } : {}),
      // The scenarios she has saved and named, once there are any — same guard
      // again: a phone that never saved one must not push an empty shelf over
      // hers.
      ...(Array.isArray(rec.scenarios) && rec.scenarios.length
        ? { scenarios: rec.scenarios } : {}),
      // The to-do list once she customises it. Absent until then: a phone that
      // never edited its tasks must not push the preset seed and overwrite the
      // other phone's customised list (last-write-wins below would clobber it).
      ...(Array.isArray(rec.tasks) ? { tasks: rec.tasks } : {}),
      // The software wish list, only once she customises it — same guard: a
      // phone that never opened it must not push an empty list over hers.
      ...(Array.isArray(rec.wishList) ? { wishList: rec.wishList } : {}),
      // The board's ticked coaches, only once one has been ticked — the same
      // guard as the four above, and for the same reason: a phone that has never
      // opened the board must not push an empty map over the ticks the other
      // phone is carrying.
      ...(acksSet(rec) ? { boardAcks: rec.boardAcks } : {}),
      // The developer credit / wish-list recipient, only once a name or email
      // is typed — a phone that never set it must not push an empty one over
      // the other phone's (last-write-wins would clobber it).
      ...(devSet(rec) ? { developer: cleanDeveloperForSync(rec.developer) } : {}),
      // Where the courier collects from (25 Sep 2026), only once the bakery's pin
      // is on the map — the same guard as the developer above and for the same
      // reason: a phone that has never pinned it must not push a null over the pin
      // the other phone made. Guarded rather than merely conditional so rule 2
      // hands her pin DOWN to a newly set up phone instead of that phone asking her
      // to walk the map a second time.
      //
      // It is deliberately NOT in SPEAK_EMPTY: there is no Unpin. A pin, once
      // placed, is replaced by re-pinning, never cleared — so it never has an empty
      // to speak, and a future Unpin would have to be given its own rule here
      // rather than quietly going silent and coming back from the cloud.
      ...(courierPin ? { pickupPlace: courierPin } : {}),
      // Her own category chart and her ways to pay (v200), her mailing address,
      // and the planner's people. Each is carried only once she has actually put
      // something in it, for the reason the four lists above are: a phone that has
      // never touched them must not push an empty value over hers. All five are
      // the same class of miss — they were edited on a phone, saved to that
      // phone's localStorage, and simply never named here, so nothing carried
      // them and the other phone kept the built-in chart and an empty address.
      //
      // `personCalls` is stored by `calls[who] = call.checked`, so it keeps true
      // as well as false and any key at all is a real answer she gave. An empty
      // one is what a phone that has never ticked anything holds, and that is
      // exactly the default the app reads anyway — so, unlike `personNames`, it
      // is never spoken as an empty (see SPEAK_EMPTY).
      ...(Array.isArray(rec.categories) && rec.categories.length
        ? { categories: rec.categories } : {}),
      ...(Array.isArray(rec.payMethods) && rec.payMethods.length
        ? { payMethods: rec.payMethods } : {}),
      // ★ WHERE HER OWN MONEY COMES FROM (v394). ⚠️⚠️ A NEW LIST IS DEVICE-LOCAL UNTIL IT IS NAMED
      // HERE. The settings row carries a whitelist of keys, so without this line the sources list she
      // shapes on one phone would simply never reach the other — silently, the same fault v200 found in
      // five keys that had gone per-phone by OMISSION rather than by decision. It needs `GUARDED` and
      // `SPEAK_EMPTY` below as well; all three, or it is half-carried.
      ...(Array.isArray(rec.sources) && rec.sources.length
        ? { sources: rec.sources } : {}),
      ...(String(rec.mailingAddress || "").trim()
        ? { mailingAddress: String(rec.mailingAddress) } : {}),
      ...(plainKeys(rec.personNames) ? { personNames: rec.personNames } : {}),
      ...(plainKeys(rec.personCalls) ? { personCalls: rec.personCalls } : {}),
    };
  }
  return rec;
}

// ── the settings row's key-wise memory ────────────────────────────────────
//
// Every phone shares ONE settings row, its `data` is replaced whole on push, and
// `recordPayload` above leaves a key OUT when this phone has no opinion about it.
// Those three facts together lost her saved days on 24 September 2026: a phone
// that had never pulled stamped its own (empty) settings `now`, so the pull
// skipped her real row, and the push that followed replaced it with a payload
// that had no `scenarios` in it at all. Three rules now stand between a phone and
// her content, and every one turns on the same sentence: **silence means this
// phone has no opinion, and no opinion may never delete.**
//
//   1  A guarded key this phone HELD and has now emptied is SPOKEN, not silent.
//   2  When local wins a merge, the cloud's value for every guarded key this
//      phone is silent about is TAKEN — into the outgoing payload, so the push
//      cannot delete it, and into this phone's own settings, so a phone that has
//      never had her saved days receives them.
//   3  When the cloud is silent about a guarded key this phone holds content
//      for, one publish is queued to put it back.
//
// Rules 2 and 3 both lean on rule 1: they can treat absence as ignorance only
// because a deletion she made is said out loud instead of going quiet.
//
// v182 widens all three to the last key they did not cover — `production`, the
// numbers on More → Production line — by changing what "silence" means for it.
// Every other guarded key is simply missing from a payload whose phone has
// nothing to say; `production` is always present, so a phone is silent about it
// exactly when its plan is still the stock numbers every phone starts with.
// That test is hasOpinion below, and it is asked about the cloud as well as the
// phone, which is what stops a newly set up phone's stock plan from replacing
// hers in either direction.
//
// v188 adds `pickupPlace` — the bakery's courier pickup pin (25 Sep 2026). It is
// guarded in the ORDINARY way, which is the whole of what it needs: it is absent
// from a payload until she pins it, so all three rules already do the right thing
// without a line of new logic. It rides the generic branch of hasOpinion below,
// unlike `production` beside it — which means the acceptance test for it is not a
// new rule but a walk through the three that stand: rule 2 must hand her pin down
// to a phone that has never walked the map, and rule 3 must put it back up when a
// phone that never pinned one happens to have stamped the row newest.
// v200 adds the five keys that had never been named here at all: `categories`,
// `payMethods`, `mailingAddress`, `personNames` and `personCalls`. They are
// guarded in the ORDINARY way — absent from a payload until this phone has
// something to say about them — so all three rules already do the right thing for
// them without a line of new logic, exactly as `pickupPlace` did in v188. The
// acceptance walk for them is therefore not a new rule but the three standing
// ones: rule 2 must hand her chart and her address down to a phone that has never
// had them, rule 3 must put them back up when a phone that never had them
// happened to stamp the row newest, and rule 1 must let her EMPTY the four that
// can be emptied without that reading as ignorance.
const GUARDED = ["scenario", "scenarios", "tasks", "wishList", "boardAcks", "developer", "pickupPlace",
  "categories", "payMethods", "sources", "mailingAddress", "personNames", "personCalls", "messageStyle"];

// `production` — the numbers on More → Production line — is guarded by the same
// three rules but cannot be judged the same way, and it was the one key left
// outside them when v181 landed. Every other guarded key is ABSENT from a
// payload whose phone has no opinion about it; `production` is not, because
// `recordPayload` always carries a whole plan and every phone holds one from the
// day it is set up. Its silence is a CONTENT question: a phone with no opinion
// is a phone whose plan is still exactly the numbers every phone starts with
// (STOCK_PRODUCTION in state.js). So it joins the list here and its own test,
// hasOpinion below, is what rules 2 and 3 ask about it.
const GUARDED_ALL = [...GUARDED, "production"];

// The guarded keys where an empty value is an answer she gave, and so must be
// SPOKEN rather than left out. `tasks` and `wishList` need no listing — they are
// carried whenever they are arrays, so an emptied list already goes out as one.
// `production` needs none either: it has no empty to speak, and a plan she has
// cleared back to the stock numbers reads as no opinion rather than a deletion.
//
// `boardAcks` is here for the sharpest version of the same reason. Its own guard
// above carries it only when it has ticks, so "Clear the board" — which writes
// `{}` — would otherwise go out as though this phone had never opened the board.
// The other phone would read that silence as ignorance, take the clear for
// nothing, and rule 3 would put every cleared tick straight back.
// v200 puts four more here, and each one on the same test as the board: can she
// empty it and expect the other phone to follow? `categories` and `payMethods`
// can — an empty chart is not an absent one to `categoriesOf`/`methodsOf`, which
// both fall back to the built-in list, so an empty one IS the answer "back to the
// built-in names". `personNames` can — clearing a name runs `delete names[who]`,
// so a phone whose last name she cleared holds `{}`. And `mailingAddress` is the
// first plain STRING in this list, which is why speakEmptied below grew a branch
// for one: an address she cleared has to travel as `""` rather than go silent and
// be handed straight back by rule 2. `personCalls` is deliberately NOT here — its
// empty is the default the app already reads, so it has nothing to say.
//
// v273 puts `messageStyle` here on the mailingAddress test, and it is the second
// plain STRING: that key's guard carries it only once the greeting leans over, so
// choosing Plain again would otherwise go out as silence, rule 2 would read that
// as a phone that had never chosen, and the leaning greeting would come straight
// back from the other phone.
const SPEAK_EMPTY = ["scenarios", "boardAcks", "developer",
  "categories", "payMethods", "sources", "mailingAddress", "personNames", "messageStyle"];

function has(obj, k) {
  return Object.prototype.hasOwnProperty.call(obj, k);
}

// Is `plan` still exactly the plan every phone is set up with? Compared key by
// key over both lists, so a plan that is missing a number or carrying one the
// stock plan has not got is NOT stock — it is a plan somebody wrote. Numbers are
// compared as numbers, since a plan that has been through storage or the cloud
// may come back with a "60" where the stock plan has a 60, and that is the same
// plan. `Number(undefined)` is NaN and NaN is never equal to itself, which is
// what makes a missing or extra key count as a difference for free.
//
// A plan with NO keys at all is the one exception, and it is silence rather than
// a written plan: that is `{}`, which is what a payload carries for settings that
// have never held a plan, and what a cloud row written before the line numbers
// existed has no field for. Read as "somebody wrote this", it would refuse to
// take her numbers from the cloud on a phone that has never had any and refuse to
// put them back into an old row — silence misread as an opinion.
function planIsStock(plan) {
  const p = (plan && typeof plan === "object") ? plan : {};
  if (Object.keys(p).length === 0) return true;
  const keys = new Set([...Object.keys(STOCK_PRODUCTION), ...Object.keys(p)]);
  for (const k of keys) {
    if (Number(STOCK_PRODUCTION[k]) !== Number(p[k])) return false;
  }
  return true;
}

// Rules 2 and 3 both turn on the same question — does this side have something
// of its own to say about this key? — and for four of the five guarded keys that
// is simply "is the key here". `production` is the exception above: a plan is
// always here, so what is asked is whether it has left the stock numbers.
//
// It is deliberately asked of BOTH sides and means the same thing on both. On a
// phone her numbers are an opinion, so the cloud's copy never overwrites them and
// the phone puts its own back up when the cloud has none. On the cloud a stock
// plan is what a phone with nothing to say pushed there, so it is handed down to
// a phone that has no numbers of its own and ignored by the phone that does.
// Without that, a newly set up phone replaced her line numbers in both
// directions, which is what v182 exists to close.
function hasOpinion(k, src) {
  if (k === "production") return !planIsStock(src && src.production);
  return has(src, k);
}

// An empty plain object is an ANSWER, not content — it is what a phone writes
// when it has emptied an object-valued guarded key, and rule 1 now speaks it for
// exactly the same reason. So it can be present in a payload and still be nothing
// to take: rule 2 must not copy `{}` into a phone that was silent about the key,
// because that would spell "unset" two ways and leave the other phone unable to
// tell an emptied board from one that was never opened. Arrays are excluded
// deliberately: an empty LIST already goes out on its own guard, and taking it is
// the correct answer for a shelf she emptied on the other phone.
function emptiedObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v).length === 0;
}

// Rule 1. `prev` is the canonical shape this phone last recorded for the row:
// when it held `scenarios` and today's payload has nothing to say about them,
// they were DELETED here — and a deletion the other phone cannot tell apart from
// ignorance is a deletion that comes back. So the empty answer is written into
// the payload in full. On a phone that never held them, nothing is written.
function speakEmptied(rec, prev, state) {
  if (!prev) return;
  const s = (state && state.settings) || {};
  for (const k of SPEAK_EMPTY) {
    if (!prev.includes(`"${k}":`)) continue; // this phone never held one
    if (has(rec.data, k)) continue; // already speaking
    if (k === "developer") {
      if (devSet(s)) continue; // not empty — it is in the payload already
      rec.data.developer = cleanDeveloperForSync(s.developer);
    } else if (typeof s[k] === "string") {
      // A plain string key's empty — `""` — is an answer too: v200's
      // `mailingAddress`. Widened for the same reason this was widened in v184
      // for `boardAcks`: a value that is not an object could not be spoken at
      // all, so an address she cleared went out as silence, rule 2 read that
      // silence as ignorance, and the old address came straight back.
      rec.data[k] = s[k];
    } else if (s[k] != null && typeof s[k] === "object") {
      // The empty value itself, and an answer she gave. Widened from
      // `Array.isArray` in v184 for `boardAcks`, whose empty is `{}` rather than
      // `[]`: an object-valued key could not be spoken at all, so clearing the
      // board went out as silence. `null`/`undefined` are still skipped, which is
      // what keeps a phone that never held one quiet.
      rec.data[k] = s[k];
    }
  }
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

// ★★★ WHAT THIS PHONE IS STILL HOLDING, AND WHAT THE SHARED DATA ACTUALLY HAS (v466).
//
// HER REPORT: __"i add a bake date 10/10, other user dont see it"__ — and, of the sync thread generally,
// __"why my other user dont see some order that is on my device?"__.
//
// ⚠️⚠️ AND HERE IS THE GAP THE TWO OF THOSE EXPOSE, MEASURED IN THE CODE RATHER THAN GUESSED AT: **the
// journal records a change as HANDED OVER at the moment it is QUEUED — not when it actually leaves.** The
// queue is what retries, and it is careful. ⭐ **But if the queue is ever lost while that note survives — a
// reinstall, a cleared key, a phone out of storage — then this app believes the record is already shared,
// `markDirty` finds nothing to send, and NOTHING ON ANY SCREEN WOULD EVER SAY SO.** ⚠️ **I have NOT proved
// that is what happened to her; it is one mechanism that fits, and the two functions below are what will
// tell her which.**
//
// ⭐ `pendingCount` is the number of changes THIS phone is still holding — **the number nobody could see
// before** — and `cloudKeys` is a plain READ of what the shared data holds, so the check can compare it with
// this phone. ⚠️ **Neither of them writes anything, anywhere.**

// How many changes are waiting to be sent. ⚠️ Read from the journal, so it counts what would be lost.
export function pendingCount() {
  return Object.keys(readSync().pending || {}).length;
}

// Every record key THIS phone holds, as `kind:id`. ⚠️ **READ FROM `LISTS` ITSELF** — the same map the sync
// uses to decide what travels — **so a list added later is compared by the check whether or not anybody
// remembers it exists.** ⭐ A second hand-written list here is the v394 fault in a new dress.
export function localKeys(state) {
  const keys = [];
  for (const [kind, field] of Object.entries(LISTS)) {
    const list = state && state[field];
    if (!Array.isArray(list)) continue;
    for (const rec of list) if (rec && rec.id) keys.push(`${kind}:${rec.id}`);
  }
  // ⚠️⚠️ AND THE SETTINGS RECORD, WHICH IS NOT IN `LISTS` (v469). ⭐ **`computeRecords` sends it
  // SEPARATELY, by hand, and this function reads `LISTS` — so it was the one record every phone HAS and
  // this list did not mention.** ⚠️ **The reverse check then reported `settings` as "in your shared data
  // and not on this phone", on every device, for ever** — ⭐ **exactly the warning that can never be
  // satisfied which the check's own comment warns against.** ⭐ Found on her Mac, one version after it was
  // written, **by running it** — which is the whole argument for building the check rather than reasoning
  // about the data.
  keys.push("settings:default");
  return keys;
}

// The set of record keys the shared data holds, as `kind:id` — or `{ ok: false, reason }` when it could not
// be read. ⚠️ **A record marked deleted is NOT "held"**, because nothing can read it.
export async function cloudKeys(state) {
  const c = cloudCfg(state);
  if (!c.on) return { ok: false, reason: "Shared data is switched off on this phone." };
  const token = cachedToken();
  if (!token) return { ok: false, reason: "This phone is not signed in to your shared data." };
  try {
    // ⚠️ AND `data` COMES WITH IT NOW (v471) — **the same single read answers "which records are there" and
    // "what is IN them".** ⭐ One fetch, not two: this page already reads a register and your copies, and a
    // third round trip for a comparison nobody could see would be a poor trade.
    const res = await fetch(`${c.url}/rest/v1/bakery?select=kind,id,data,_deleted&limit=5000`, {
      headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, reason: `Your shared data could not be read (HTTP ${res.status}).` };
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, reason: "Your shared data could not be read." };
    const keys = new Set();
    const data = new Map();
    for (const r of rows) {
      if (!r || !r.kind) continue;
      if (r._deleted) continue;
      keys.add(`${r.kind}:${r.id}`);
      data.set(`${r.kind}:${r.id}`, typeof r.data === "string" ? r.data : JSON.stringify(r.data));
    }
    return { ok: true, keys, data };
  } catch {
    return { ok: false, reason: "Your shared data could not be read — check this phone is online." };
  }
}

// What THIS phone holds, as key → the exact text the app would send for it. ⭐ **Built from `recordPayload`
// and `canonical-ish` serialisation, so the two sides are compared on the SAME spelling** — ⚠️ a comparison
// that stringifies two things differently would report every record as different.
export function localPayloads(state) {
  const out = new Map();
  for (const rec of computeRecords(state)) {
    if (!rec || typeof rec.kind !== "string" || !rec.kind || typeof rec.id !== "string" || !rec.id) continue;
    out.set(`${rec.kind}:${rec.id}`, JSON.stringify(rec.data) ?? "null");
  }
  return out;
}

// The changes this phone has queued and not yet sent. ⚠️ **A record waiting to be sent is SUPPOSED to differ
// from the shared data — so it must never be reported as a difference, or the check would fire on every
// edit she has just made.**
export function pendingKeys() {
  return new Set(Object.keys(readSync().pending || {}));
}

// ── markDirty: queue what changed since the last baseline ────────────────

export function markDirty(state, nowIso = new Date().toISOString()) {
  const b = readSync();
  let changed = false;
  const present = new Set();

  for (const rec of computeRecords(state)) {
    const key = `${rec.kind}:${rec.id}`;
    present.add(key);
    // Rule 1: a guarded key this phone held and has now emptied is an answer she
    // gave, so it is spoken rather than left out. See the note above.
    if (rec.kind === "settings") speakEmptied(rec, b.snapshot[key] || "", state);
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

function mergeCloudRows(state, rows, b, nowIso = new Date().toISOString()) {
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

      if (localNewerOrSame || cloudAt <= localAt) {
        // Rule 2: local wins, so this phone's own answers stand — but the push
        // that follows REPLACES the row wholesale, and a key this phone has no
        // opinion about must not be deleted by a payload that simply omits it.
        // Every guarded key this phone is SILENT about is therefore taken from the
        // cloud: into the outgoing payload, so the push cannot delete it, and into
        // this phone's own settings, so a phone that has never had her saved days
        // receives them on this very pull. `production` rides the same loop with
        // the content test above in place of the absent key: the cloud's plan is
        // taken only when the cloud has numbers of its own and this phone is
        // still on the stock ones. `snapshot` is deliberately left alone,
        // so what this phone stores afterwards is its own state and not a
        // re-queue that would put the keys back out again.
        const phoneOwn = (pending && pending.data && typeof pending.data === "object")
          ? pending.data
          : recordPayload("settings", state.settings);
        let next = null;
        for (const k of GUARDED_ALL) {
          if (hasOpinion(k, phoneOwn) || !hasOpinion(k, payload)) continue;
          if (emptiedObject(payload[k])) continue; // an emptied board is an answer, not content
          next = next || { ...state.settings };
          next[k] = payload[k];
          if (pending && pending.data && typeof pending.data === "object") pending.data[k] = payload[k];
        }
        if (next) {
          state.settings = next;
          changed = true;
        }
        continue; // local wins
      }

      // The checklist must not be overwritten wholesale: another phone's ticks
      // union with this phone's so a same-week tick is never lost. Everything
      // else merges as before, keeping per-device config local.
      // The postage fee rides THIS private row (never the public storefront
      // publish) so both phones quote the same fee, last-set-wins. The WhatsApp
      // builders read it from settings.storefront.postageRM, so fold it back in
      // there — and mark this phone as now knowing a real value (postageSet) so
      // it carries the fee in its own future pushes instead of dropping it.
      const { weekCheck: cloudWc, postageRM: cloudPostage, postageMode: cloudMode, ...rest } = payload;
      const merged = {
        ...rest,
        supabase: (state.settings && state.settings.supabase) || {},
        cloud: (state.settings && state.settings.cloud) || { enabled: false },
        weekCheck: mergeWeekCheck(
          (state.settings && state.settings.weekCheck) || {},
          cloudWc || {}),
      };
      // `production` is the one guarded key a payload always carries, so at this
      // point it is about to overwrite whatever this phone holds. It is dropped
      // here when the cloud has no plan of its own — stock numbers pushed up by a
      // phone that had nothing to say — so the numbers she typed survive a cloud
      // row that a freshly set up phone happened to stamp newest.
      if (!hasOpinion("production", payload)) delete merged.production;
      state.settings = { ...state.settings, ...merged };
      if (typeof cloudPostage === "number") {
        state.settings.storefront = {
          ...(state.settings.storefront || {}),
          postageRM: cloudPostage,
          postageSet: true,
        };
      }
      // …and the way it is priced, folded back in the same way and marked known so
      // this phone carries her choice in its own future pushes. A cloud row with no
      // postageMode says nothing about the switch, so this phone keeps its own.
      if (cloudMode === "flat" || cloudMode === "quote") {
        state.settings.storefront = {
          ...(state.settings.storefront || {}),
          postageMode: cloudMode,
          postageModeSet: true,
        };
      }
      const own = recordPayload("settings", state.settings);
      b.meta[key] = cloudAt;
      b.snapshot[key] = canonical(own);
      delete b.pending[key];
      changed = true;

      // Rule 3: the cloud row says nothing about a guarded key this phone holds
      // content for, so the cloud is SHORT and this phone is the one that can put
      // it back — one publish, no press of hers needed. It fires on its own the
      // first time an older phone with her saved days meets a cloud row that lost
      // them. A key she deleted is spoken by rule 1, so a key that is merely
      // absent is a key this phone never saw, and putting it back cannot undo her.
      // The same sentence covers `production`, where "the cloud says nothing"
      // means the cloud is still holding the stock numbers: a line she has typed
      // into is put back up, and a plan she left at the stock numbers is not,
      // because that phone has nothing of its own to say either.
      if (GUARDED_ALL.some((k) => !hasOpinion(k, payload) && hasOpinion(k, own))) {
        b.pending[key] = { kind: "settings", id: row.id, updated_at: nowIso, data: own, _deleted: false };
        b.meta[key] = nowIso;
      }
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
      // ⚠️⚠️ AN ORDER DELETED ON THE OTHER PHONE GOES ON THIS PHONE'S SHELF (v444). **This is the path
      // that made her loss permanent** — a tombstone is a removal nobody here made, it takes the whole
      // order away in one line, and until v444 there was nothing left on either phone or in any copy to
      // point at. ⭐ Everything else about the merge is unchanged: the record still leaves the live list
      // and the tombstone is still recorded. **It just does not leave without a trace any more.**
      if (row.kind === "orders" && idx >= 0) {
        removeOrders(state, [String(list[idx] && list[idx].id)], "came back as a removal through your shared data");
        changed = true;
      } else if (idx >= 0) {
        list.splice(idx, 1);
        changed = true;
      }
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
  // ★★★ AND A MERGED-IN SHELF ROW FOR AN ORDER THAT IS BACK IS DROPPED HERE (v474).
  // ⚠️⚠️ **THIS IS THE PATH THAT MADE HER THREE STRAY ROWS: a phone put an order back, the removal of its
  // shelf row was queued while sending was broken, and the row came down again on the next pull.** ⭐ So the
  // invariant is applied **wherever the data lands, not only on load** — `normalize` carries it on a load
  // and this carries it on a merge.
  // ⚠️ **AND IF ANYTHING WAS DROPPED, THE STATE IS SAVED — which queues the removal so it goes UP**, or the
  // shared data would hand the same stale row back on every pull, for ever.
  const dropped = dropStaleShelfRows(state);
  if (dropped) save(state);
  writeSync(b);
  return { state, changed: changed || dropped > 0 };
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
  // ⚠️⚠️ AND ONE RECORD WITH NO `id` MUST NEVER ENTER THIS BATCH (v467) — **THIS IS THE FAULT THAT
  // STOPPED HER OTHER PHONES SEEING ANYTHING, AND THE SERVER NAMED IT:**
  //   `Sync failed: Push failed (HTTP 400) — {"code":"PGRST102","message":"All object keys must match"}`
  // ⭐⭐ **`JSON.stringify` DROPS A KEY WHOSE VALUE IS `undefined`.** So a record with no id — which
  // `computeRecords` can produce, because an order in her book can have none — goes out as
  // `{kind, data, _deleted, updated_at}`: **FOUR keys, where every other object in the same array has
  // FIVE.** PostgREST refuses the WHOLE BATCH for that one object, ⚠️ **and because the journal had
  // already recorded all of them as handed over, nothing was ever offered again.** ⭐ **Measured on her
  // own screen: 21 changes stuck, 11 records not in the shared data, and every device blind to all of it.**
  // ⭐ PROVEN in one line before this was written: `JSON.stringify({kind:"orders", id:undefined, …})` is
  // `{"kind":"orders", …}` — the `id` is simply not there.
  // ⚠️ **A record that cannot be keyed cannot travel — so it is LEFT OUT and left for the check to name,
  // NEVER sent in a shape that poisons the twenty good records sitting beside it.**
  const sendable = pending.filter((p) => p && typeof p.kind === "string" && p.kind && typeof p.id === "string" && p.id);
  // ⚠️⚠️ AND THE ONES THAT CAN NEVER BE SENT ARE SWEPT **HERE — BEFORE THE EARLY RETURN** (v475).
  //
  // ⭐⭐ **THIS IS A BUG I WROTE, AND HER PHONE FOUND IT:** __"after sync now, the phone still say 1 changes
  // waiting to be send"__ — and, asked what the shared-data card said, __"there is no error under sync"__.
  // ⚠️⚠️ **NO ERROR, AND A COUNT THAT NEVER MOVES — which is this line exactly.** The v467 sweep that
  // clears un-sendable records sat **after** the POST, so it only ever ran when there was something to post.
  // **When the ONLY thing queued is the record that cannot be keyed, `sendable` is empty, this returned
  // "ok", and the queue was never swept** — the record sat there for ever and the app reported success.
  // ⭐ **The lesson is the one this whole day has been about: "it says ok" and "it is done" are two
  // different sentences.**
  if (sendable.length !== pending.length) {
    const b0 = readSync();
    for (const key of Object.keys(b0.pending)) {
      const rec = b0.pending[key];
      if (!rec || typeof rec.kind !== "string" || !rec.kind || typeof rec.id !== "string" || !rec.id) delete b0.pending[key];
    }
    writeSync(b0);
  }
  if (!sendable.length) return { ok: true, pushed: 0 };
  const body = sendable.map((p) => ({
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
  // ⚠️⚠️ AND ONLY WHAT WAS ACTUALLY SENT COMES OFF THE QUEUE (v467). ⭐ Iterating the WHOLE queue here
  // would clear the un-sendable records too — **marking them "handed over" when they never left, which is
  // the very lie that caused this.** ⚠️ **A record that cannot be keyed can never travel, so holding it on
  // the queue for ever would give her a warning she cannot act on** — this file's own rule is that a
  // warning which can never be satisfied is one she learns to ignore. ⭐ **It is dropped from the SENDING
  // queue, and it is NOT hidden: the check on the health page lists it, because it is a record on this
  // phone that is not in the shared data — which is exactly what that check is for.**
  const b2 = readSync();
  for (const p of sendable) {
    const key = `${p.kind}:${p.id}`;
    const cur = b2.pending[key];
    if (cur && cur.updated_at === p.updated_at) delete b2.pending[key];
  }
  writeSync(b2);
  return { ok: true, pushed: sendable.length };
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
