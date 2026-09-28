// couriers/lalamove.js — Lalamove, and the only file in the app that says so
// (25 Sep 2026).
//
// THE SEAM. Everything above this file talks about a courier: a trip, a price, a
// vehicle, a booking. Everything Lalamove-specific — its service keys, the shape of
// its quotation, its five-minute validity, its error codes — stops here. A second
// courier is a sibling of this file plus one line in couriers.js; nothing that calls
// a courier has to be opened to add one.
//
// This half shapes the request and reads the reply. It does NOT sign anything: the
// HMAC signature, the api key and the secret live in the `courier` edge function and
// never travel to a browser. See couriers/api.js for why that wall is not negotiable.
//
// The normalisers below are pure and take `now`, so every one of them is tested
// under Node without a network — which matters here more than usual, because a
// mis-read reply is a WRONG PRICE shown to her as a real one, and a wrong price she
// quotes to a customer is money she has already lost by the time anyone notices.

import { callCourier } from "./api.js";
import { quoteExpired, senderOf, tripReady, tripProblem } from "../courier_job.js";
import { strictNumber } from "../courier_place.js";

export const LALAMOVE_KEY = "lalamove";

// Its name, written down ONCE in the whole app. Every sentence below that has to name
// the courier reads it from here, so the day a second courier arrives there is one
// line to copy rather than a hunt through strings — which is the same rule the server
// half keeps with LALAMOVE_LABEL.
export const LALAMOVE_LABEL = "Lalamove";

// A number as Lalamove wants it. E.164, and the leading plus is PART of the number
// to this API rather than decoration — its own documented pattern is
// `^\+[1-9]\d{1,14}$`, so "60123456789" is refused where "+60123456789" is accepted.
//
// The app stores every number without one, deliberately: `waNumber()` (state.js)
// produces the digits-only form wa.me links need, and it is the one number-shape rule
// this app has. Rather than change what the app stores for the sake of one courier's
// API, the plus is added here — where a courier's own rules live, which is the whole
// point of this file. It is idempotent, so a number that already carries a plus is
// untouched rather than becoming "++60…".
export function phoneE164(v) {
  const digits = String(v || "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

// How long a quotation is worth. Lalamove's own policy, quoted from its docs, and
// used ONLY when the reply does not carry an expiry of its own — a quotation that
// says when it dies is believed; one that does not is given this, and the screen
// says "about five minutes" rather than pretending to know the second.
export const QUOTE_VALID_MS = 5 * 60 * 1000;

// The order she thinks in: the smallest thing that can carry a box first, then up.
// Any service Lalamove adds that is not on this list still appears — it sorts after
// these, alphabetically — so a market we did not anticipate is shown rather than
// hidden.
const SERVICE_ORDER = ["MOTORCYCLE", "CAR", "VAN", "7FT_VAN", "9FT_VAN", "4X4", "TRUCK", "LORRY"];

// A vehicle's name for the screen: Lalamove's own if it sent one, else its key said
// in words ("MOTORCYCLE" -> "Motorcycle"). Never blank — a nameless row in a list of
// prices cannot be chosen.
//
// A word also opens after a DIGIT, which `\b` alone does not do: two of the keys in
// this market's own fleet start with a number, and without it "7FT_VAN" reads as
// "7ft Van" and "4X4" as "4x4" — the vehicle's name spelled wrong on the only row she
// can use to tell it from the car.
export function serviceLabel(key, name = "") {
  const said = String(name || "").trim();
  if (said) return said;
  const k = String(key || "").trim();
  if (!k) return "Vehicle";
  return k.toLowerCase().replace(/[_-]+/g, " ").replace(/(^|[\s_-]+|\d)([a-z])/g, (m, lead, c) => lead + c.toUpperCase());
}

// Order the vehicles the way she thinks about them. Pure, and pinned by a test,
// because a list that silently reorders itself between two opens reads as a bug.
export function sortServices(list) {
  const rank = (k) => {
    const at = SERVICE_ORDER.indexOf(String(k || "").toUpperCase());
    return at < 0 ? SERVICE_ORDER.length : at;
  };
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const d = rank(a.key) - rank(b.key);
    return d !== 0 ? d : String(a.key).localeCompare(String(b.key));
  });
}

// The vehicle list, read from Lalamove's own cities rather than written down here —
// so a service it adds or retires in Malaysia shows up without a release.
export function normaliseVehicles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Map();
  for (const s of list) {
    const key = String((s && s.key) || "").trim();
    if (!key || seen.has(key)) continue;
    seen.set(key, { key, name: serviceLabel(key, s && s.name) });
  }
  return sortServices([...seen.values()]);
}

// A number out of a reply, or null. Strict rather than plain `Number()`, because
// this is the ONE place a wrong reading becomes a wrong PRICE on screen: a field
// Lalamove sent as null would convert to 0, and a 0 in a price breakdown is not an
// absence, it is a measurement — a VAT line of RM0.00, a distance of 0 km under a
// fee. courier_place.js's strictNumber is the app's one answer to "is this a
// number", and this feature has already paid for its absence twice.
function numOrNull(v) {
  return strictNumber(v);
}

// Lalamove reports distance as a value with a unit, and short trips are the common
// case. Metres become kilometres; anything else is taken at face value, because
// inventing a conversion for a unit we were not told about would be a guess printed
// as a measurement.
export function distanceKmOf(d) {
  if (d == null) return null;
  if (typeof d === "object") {
    const v = numOrNull(d.value);
    if (v === null) return null;
    const unit = String(d.unit || "km").trim().toLowerCase();
    if (unit === "m" || unit === "meter" || unit === "meters" || unit === "metre" || unit === "metres") {
      return v / 1000;
    }
    if (unit === "mi" || unit === "mile" || unit === "miles") return v * 1.609344;
    return v;
  }
  return numOrNull(d);
}

// The total out of a reply that carries a price: a QUOTATION's, or a BOOKING's,
// which are the same shape. One reading, so a booked trip's price can never come out
// different from the price it was booked at.
//
// The first of the three places a total can be, read through the same strict guard as
// everything else: `Number(null)` is 0, so a reply whose total came back as null
// would otherwise be quoted to her as RM0.00 — a real price, shown as a real price,
// for a trip Lalamove never priced.
function totalOf(raw) {
  const bd = (raw && raw.priceBreakdown && typeof raw.priceBreakdown === "object") ? raw.priceBreakdown : {};
  return numOrNull(bd.total != null ? bd.total : (raw && (raw.total != null ? raw.total : raw.amount)));
}

// Where each of OUR points came back in the reply, as the courier's own handle for
// that door.
//
// WHY THIS EXISTS AND WHY IT IS MATCHED RATHER THAN ASSUMED. Booking names the doors
// THE PRICE WAS GIVEN FOR, and Lalamove's handle for a door — a `stopId` — exists
// only inside that quotation's reply. It is not derivable and it is not the order's,
// so each one has to be found again in the answer.
//
// Found BY COORDINATE, which is what makes it a fact rather than a hope: the reply
// echoes the point it was given, so the door that went out at these numbers is the
// door that comes back at them. Position is used ONLY for a reply that carries no
// coordinates at all, and only when it returned exactly as many stops as were sent —
// the documented order is the sender, then the drops in the order given, so that is a
// reading of the contract rather than a guess at it.
//
// Anything still unmatched is left EMPTY and the caller refuses to book. A wrongly
// matched id is a van at the wrong house, and nobody finds out until the customer
// rings — the exact failure this module exists to make impossible.
//
// The tolerance is about 11 metres at the equator: far tighter than the gap between
// two doorsteps, far looser than the float noise a round trip through a decimal
// string can introduce.
const SAME_SPOT = 0.0001;

function coordOf(stop) {
  // `coordinates` is v3; `location` is the older spelling. Both are read for the same
  // reason the stop geometry is flagged at the head of the server provider: which one
  // a sandbox answers with is not stated unambiguously in the reference.
  const c = (stop && (stop.coordinates || stop.location)) || null;
  const lat = strictNumber(c && c.lat);
  const lng = strictNumber(c && c.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function stopIdsFor(raw, points) {
  const ours = (Array.isArray(points) ? points : []).map((p) => {
    const lat = strictNumber(p && p.lat);
    const lng = strictNumber(p && p.lng);
    return (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) ? null : { lat, lng };
  });
  const ids = ours.map(() => "");
  if (!ours.length || ours.some((p) => p === null)) return ids;

  const rawStops = Array.isArray(raw && raw.stops) ? raw.stops : [];
  const theirs = rawStops.map((s) => ({ id: String((s && s.stopId) || "").trim(), at: coordOf(s) }));
  // Did the reply carry geometry AT ALL — as a field, whether or not this reader could
  // make sense of it? That is a different question from "did every coordinate fail to
  // read", and the difference is the whole safety of the fallback below. A reply that
  // sent coordinates this file could not parse is a reply whose shape is not the one
  // expected, and reading its order by position on trust would be the quiet fallback
  // this module's header refuses. Only a reply that sent no geometry anywhere is one
  // whose order is the documented one and nothing else.
  const carriedGeometry = rawStops.some((s) => s && typeof s === "object" && (s.coordinates || s.location));

  const used = new Set();
  ours.forEach((p, i) => {
    const at = theirs.findIndex((t, j) => !used.has(j) && t.at
      && Math.abs(t.at.lat - p.lat) <= SAME_SPOT && Math.abs(t.at.lng - p.lng) <= SAME_SPOT);
    if (at >= 0) { used.add(at); ids[i] = theirs[at].id; }
  });

  // The positional fallback, and only for a reply that gave no coordinates at all.
  if (ids.some((id) => !id) && theirs.length === ours.length && !carriedGeometry) {
    theirs.forEach((t, j) => { ids[j] = t.id; });
  }
  return ids;
}

// Can this price be booked? Every door it priced has to have come back with a handle,
// and a trip is a pickup plus at least one drop.
export function quoteBookable(quote) {
  const ids = (quote && Array.isArray(quote.stopIds)) ? quote.stopIds : [];
  if (ids.length < 2) return false;
  return ids.every((id) => String(id || "").trim() !== "");
}

// One quotation, read into the app's own words. Returns null when there is no price
// in it at all — a reply with no total is not a price of zero, and showing RM0.00
// would be worse than showing nothing.
//
// `points` is what was SENT, in the app's order (the pickup first, then the drops),
// and it is used for one thing only: finding each door's own handle again. See
// stopIdsFor.
export function normaliseQuote(raw, now = Date.now(), service = "", points = []) {
  if (!raw || typeof raw !== "object") return null;
  const bd = (raw.priceBreakdown && typeof raw.priceBreakdown === "object") ? raw.priceBreakdown : {};
  const total = totalOf(raw);
  if (total === null) return null;

  // The reply's own expiry if it has one, else the documented five minutes from
  // this moment — with which of the two it was kept, so the screen never states a
  // precision it does not have.
  const said = String(raw.expiresAt || "").trim();
  const saidMs = said ? Date.parse(said) : NaN;
  const fromApi = Number.isFinite(saidMs) && saidMs > 0;
  const expiresAt = fromApi ? new Date(saidMs).toISOString() : new Date(now + QUOTE_VALID_MS).toISOString();

  return {
    id: String(raw.quotationId || raw.id || ""),
    service: String(raw.serviceType || service || ""),
    amount: Math.round(total * 100) / 100,
    currency: String(bd.currency || raw.currency || "MYR"),
    breakdown: { base: numOrNull(bd.base), vat: numOrNull(bd.vat) },
    distanceKm: distanceKmOf(raw.distance),
    expiresAt,
    expiryFrom: fromApi ? "api" : "policy",
    // The doors this price was given for, in the same order as `points` — the
    // booking half's whole input. See stopIdsFor for why they are matched and not
    // simply taken in order.
    stopIds: stopIdsFor(raw, points),
  };
}

// The whole quotation reply: the prices that came back, and the vehicles that did
// not, named. A vehicle refused on its own is NOT a failed screen — the motorcycle
// may be priced while the van is not available at this hour, and she must still be
// able to see and use the one that works.
export function normaliseQuotes(out, now = Date.now(), points = []) {
  const quotes = [];
  for (const q of (Array.isArray(out && out.quotes) ? out.quotes : [])) {
    const service = String((q && q.serviceType) || (q && q.service) || "").trim();
    const one = normaliseQuote(q, now, service, points);
    if (one) quotes.push(one);
  }
  const failed = (Array.isArray(out && out.failed) ? out.failed : [])
    .map((f) => ({ service: String((f && f.service) || ""), reason: String((f && f.reason) || "").trim() }))
    .filter((f) => f.service || f.reason);
  return { quotes, failed };
}

// ── a booked trip, and what has become of it ───────────────────────────────
//
// Lalamove's own word for where a trip is, in hers. An unrecognised status is shown
// AS SENT rather than swallowed: the day it adds one, a word she does not know is
// still more use to her than a blank line, and a blank line reads as "nothing has
// happened" which is the one thing that might not be true.
const STATUS_WORDS = {
  ASSIGNING_DRIVER: "Finding a driver",
  ON_GOING: "The driver is on the way",
  PICKED_UP: "Collected",
  COMPLETED: "Delivered",
  CANCELED: "Cancelled",
  REJECTED: "No driver took it",
  EXPIRED: "Expired — no driver took it in time",
};

// A trip that has stopped moving. Cancelling is allowed only while a driver is being
// found, or within five minutes of one being matched, so a finished trip's [Cancel
// trip] is drawn inert rather than offered and then refused.
const STATUS_DONE = ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"];

export function statusLabel(key) {
  const said = String(key || "").trim();
  if (!said) return "";
  return STATUS_WORDS[said.toUpperCase()] || said;
}

export function statusDone(key) {
  return STATUS_DONE.includes(String(key || "").trim().toUpperCase());
}

// The same journey, in the ONE vocabulary the customer's page is allowed to know.
//
// `STATUS_WORDS` above are HER words and they travel no further than her own screen.
// What is published to the customer's card is one of a handful of NEUTRAL phases, and
// the customer's own six words for them live in the storefront's language file — so the
// storefront never carries a table of this courier's statuses, and a second courier
// cannot make the customer's page wrong by using words nobody has heard of.
//
// A status this build does not know publishes NOTHING (`""`) rather than a guess, and
// the check that reads it keeps the phase already on the order. That is the opposite of
// the rule on her own screen, where an unknown status is shown AS SENT because a word
// she does not know is more use to her than a blank; a customer cannot act on either,
// so the honest thing there is to keep the last thing that was true.
const TRIP_PHASES = {
  ASSIGNING_DRIVER: "finding",
  ON_GOING: "on_the_way",
  PICKED_UP: "collected",
  COMPLETED: "delivered",
  CANCELED: "stopped",
  REJECTED: "nodriver",
  EXPIRED: "nodriver",
};

export function phaseOf(key) {
  const said = String(key || "").trim().toUpperCase();
  return TRIP_PHASES[said] || "";
}

// The driver the courier has put on this trip, or null. Read defensively and field by
// field: this build was written without a network to re-read the courier's own reference
// against, and every field here is optional — a driver matched but not yet named gives a
// plate and no name, and a plate is still worth showing at the door. Anything absent is
// left out rather than filled with a placeholder, and NO name at all means no driver
// line: a card that said "Driver: —" would be claiming there is one to wait for.
export function driverOf(raw) {
  const d = (raw && typeof raw.driver === "object" && raw.driver) || null;
  if (!d) return null;
  const name = String(d.name || "").trim();
  const plate = String(d.plateNumber || d.plate || "").trim();
  // The number is normalised the way the courier's own dialling needs it, but it is NOT
  // required: a driver with no number still gets a line, with no button to ring it.
  const phone = String(d.phone || "").trim();
  if (!name && !plate && !phone) return null;
  return { name, plate, phone };
}

// One booked trip, read into the record the order keeps. Returns null when the reply
// carries no trip number at all — a booking the app cannot name is a booking it
// cannot check, chase or cancel, so it is refused rather than stored as half a fact.
//
// `statusAt` is the moment this status was READ, not a moment Lalamove reported: its
// order detail carries no timestamp for the status, so a screen that showed a status
// without saying when it was read would be presenting a snapshot as live.
export function normaliseJob(raw, { quote = null, trip = null, now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const jobId = String(raw.orderId || raw.id || "").trim();
  if (!jobId) return null;
  const bd = (raw.priceBreakdown && typeof raw.priceBreakdown === "object") ? raw.priceBreakdown : {};
  const total = totalOf(raw);
  const when = new Date(now).toISOString();
  const status = String(raw.status || "").trim();
  return {
    // Whether this trip has stopped moving, in the ONE neutral word the app's pure
    // half knows about. The courier's own status strings are translated here and
    // nowhere else, which is what lets courier_job.js ask "is a trip still running on
    // this order" without carrying a table of Lalamove's words.
    done: statusDone(status),
    // Which courier holds this trip, stored with it rather than looked up from
    // Settings: a job booked with one courier has to be checked and cancelled
    // through THAT courier, even if another is selected today.
    provider: LALAMOVE_KEY,
    jobId,
    quoteId: String(raw.quotationId || (quote && quote.id) || "").trim(),
    service: String((quote && quote.service) || raw.serviceType || "").trim(),
    name: String((quote && quote.name) || "").trim(),
    // The booking reply's own price when it carries one, else the quoted price. Both
    // are read by the same helper as a quotation, so a booked trip's figure cannot
    // disagree with the figure it was booked at.
    amount: total != null ? Math.round(total * 100) / 100
      : (quote && typeof quote.amount === "number" ? quote.amount : null),
    currency: String(bd.currency || raw.currency || (quote && quote.currency) || "MYR"),
    link: String(raw.shareLink || "").trim(),
    status,
    // The neutral phase the customer's card is allowed to know, and the driver, when the
    // courier's reply carried one. Both are stored on the record rather than looked up at
    // publish time: the card must be publishable from what the order already knows, or a
    // later edit would publish the trip WITHOUT them and the customer's page would forget
    // a driver it had already been shown.
    phase: phaseOf(status),
    driver: driverOf(raw),
    statusAt: when,
    bookedAt: when,
    scheduleAt: String((trip && trip.scheduleAt) || raw.scheduleAt || "").trim(),
  };
}

// One trip's current state, read fresh. The link is taken only when the reply carries
// one, so a check can never blank a share link that is already on the order.
export function normaliseDetail(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "").trim();
  if (!status) return null;
  return {
    status,
    statusAt: new Date(now).toISOString(),
    link: String(raw.shareLink || "").trim(),
    // Both may be empty, and empty means "learned nothing this time" rather than "none":
    // the check that reads this keeps whatever the order already had. A status this build
    // does not know has no phase, and a trip with no driver matched yet has no driver —
    // and neither may overwrite something a previous check did learn.
    phase: phaseOf(status),
    driver: driverOf(raw),
    done: statusDone(status),
  };
}

// A point, as the API wants it. `address` travels beside the numbers because
// Lalamove shows it to the driver and asks for it when its own reverse-geocode
// fails — the coordinates are what it routes by, the words are what the driver
// reads at the gate.
function pointPayload(place, address) {
  return {
    lat: Number(place.lat),
    lng: Number(place.lng),
    address: String(address || "").trim(),
  };
}

function tripPayload(trip) {
  return {
    pickup: pointPayload(trip.pickup, (trip.pickup && trip.pickup.label) || ""),
    drops: trip.stops.map((s) => pointPayload(s.place, s.address || (s.place && s.place.label) || "")),
  };
}

// LALAMOVE, as a courier. The whole of what the app asks a courier to do: name its
// fleet, price a trip, book it, say where it has got to, and call it off.
export const lalamove = {
  key: LALAMOVE_KEY,
  label: LALAMOVE_LABEL,

  // Its own word for where a trip has got to, in hers — carried ON the courier rather
  // than exported beside it, because that is how a screen reaches it: the job card
  // holds a job, the job names the courier that holds it, and it asks THAT courier to
  // say the word. The function above and this member are the same thing; the member
  // was missing until it was read off the drawn card, which printed "ASSIGNING_DRIVER"
  // where the app has a translation table with a test on it. `holder.statusLabel ?
  // holder.statusLabel(...) : job.status` fails OPEN — an absent member quietly shows
  // the courier's own enum instead of saying anything is wrong — so nothing but a test
  // on the interface can catch it. See the guard in courier-provider.test.js.
  statusLabel,

  // Which vehicles Lalamove will quote in Malaysia. Asked of Lalamove, cached for
  // the life of the module — the fleet does not change between two taps, and this
  // call is not worth making on every open of the panel.
  async vehicles(state) {
    if (lalamove._vehicles) return { ok: true, vehicles: lalamove._vehicles };
    const out = await callCourier(state, { action: "vehicles", provider: LALAMOVE_KEY });
    if (!out.ok) return out;
    const vehicles = normaliseVehicles(out.services);
    if (!vehicles.length) {
      return { ok: false, reason: "Lalamove did not name any vehicles for Malaysia — the account may not be set up yet." };
    }
    lalamove._vehicles = vehicles;
    return { ok: true, vehicles };
  },

  // Price the trip for every vehicle asked for. One vehicle refused comes back in
  // `failed` rather than taking the whole answer with it.
  //
  // The trip is checked against its OWN definition (courier_job.js) rather than by
  // a test written out here, for the same reason sync.js asks the place module: one
  // answer to "is this trip ready", so a provider can never send a point the app
  // would call unpinned.
  async quote(state, trip, { services = [], scheduleAt = "" } = {}) {
    if (!tripReady(trip)) {
      return { ok: false, reason: tripProblem(trip) };
    }
    const { pickup, drops } = tripPayload(trip);
    const out = await callCourier(state, {
      action: "quote",
      provider: LALAMOVE_KEY,
      payload: { pickup, drops, services, scheduleAt: String(scheduleAt || "") },
    });
    if (!out.ok) return out;
    // The points are handed to the reader in the app's own order, so each price can
    // carry its doors' handles — the thing a booking is made of.
    const { quotes, failed } = normaliseQuotes(out, Date.now(), [pickup, ...drops]);
    // Every price wears the vehicle's own NAME, so a screen listing prices can label
    // a row without knowing which courier it came from. The alternative — the view
    // importing this file's label-maker — is exactly the coupling the seam exists to
    // prevent, and a row reading "7FT_VAN" instead of "7ft Van" is the reason the
    // label-maker has tests of its own.
    const named = (key) => {
      const k = String(key || "").trim();
      const hit = (lalamove._vehicles || []).find((v) => v.key === k);
      if (hit) return hit.name;
      const made = normaliseVehicles([{ key: k }]);
      return made.length ? made[0].name : "";
    };
    return {
      ok: true,
      quotes: quotes.map((q) => ({ ...q, name: named(q.service) })),
      // A vehicle that could not be priced is named too. It is the row she most needs
      // to read: "no van at this hour" is a reason to book a car, and it is unreadable
      // as "7FT_VAN".
      failed: failed.map((f) => ({ ...f, name: named(f.service) })),
    };
  },

  // Forget the cached fleet. Called when the account changes in Settings, so a
  // phone that was set up against a sandbox does not keep quoting a sandbox fleet.
  forget() {
    lalamove._vehicles = null;
  },

  // Book the trip this price was given for. Returns { ok: true, job } with the record
  // the order keeps, or { ok: false, reason } in words.
  //
  // What is sent is ONLY the quotation's own id and the two ends' names and numbers.
  // The vehicle and the time are deliberately NOT sent again: they belong to the
  // quotation, and repeating them would be a second, quieter way to choose a vehicle
  // — one that could disagree with the price she is looking at while it did so.
  async book(state, trip, quote) {
    const problem = bookProblem(state, trip, quote);
    if (problem) return { ok: false, reason: problem };
    const shop = senderOf(state);
    const out = await callCourier(state, {
      action: "book",
      provider: LALAMOVE_KEY,
      payload: {
        quotationId: String(quote.id).trim(),
        // You by name and number, and every door by its own handle — matched
        // back to what was priced, never taken in order on trust. See stopIdsFor.
        //
        // The name is sent as senderOf() gives it and is NOT defaulted again here: that
        // function's whole job is to answer the question "who is collecting", and it
        // already answers with your own name or its own fallback. A second
        // fallback written here could only be a different one, and it would be
        // unreachable — a `|| "…"` that can never fire is a line that reads like a rule
        // while doing nothing.
        sender: {
          stopId: quote.stopIds[0],
          name: String(shop.name || "").trim(),
          phone: phoneE164(shop.phone),
        },
        recipients: trip.stops.map((s, i) => ({
          stopId: quote.stopIds[i + 1],
          // A customer with no name on the order still needs one for the driver. It
          // is not invented as their name: "Customer" is what it is, and the number
          // beside it is what the driver actually rings.
          name: String(s.name || "").trim() || "Customer",
          phone: phoneE164(s.phone),
        })),
      },
    });
    if (!out.ok) return out;
    const job = normaliseJob(out.order, { quote, trip });
    if (!job) {
      // The one outcome that must never be silent: money may already be committed. So
      // it says so plainly and points at the courier's own screen, rather than telling
      // her a booking was recorded when nothing was.
      return {
        ok: false,
        reason: `${LALAMOVE_LABEL} took the booking but did not send back a trip number, so nothing has been recorded here. Check the trip in ${LALAMOVE_LABEL}'s own app before booking again.`,
      };
    }
    return { ok: true, job };
  },

  // What has become of a booked trip, read fresh. Called with the job's OWN `jobId`
  // and never with a quote — the question is where the van is, not what it costs.
  async job(state, jobId) {
    const id = String(jobId || "").trim();
    if (!id) return { ok: false, reason: "There is no booked trip to check." };
    const out = await callCourier(state, { action: "job", provider: LALAMOVE_KEY, payload: { orderId: id } });
    if (!out.ok) return out;
    const detail = normaliseDetail(out.order);
    if (!detail) {
      return { ok: false, reason: "The courier answered without saying where this trip has got to. Try again in a moment." };
    }
    return { ok: true, detail };
  },

  // Why this price cannot be booked, in words, or "" when it can. `bookProblem` below is
  // the ONE answer to that question, and this method is how a screen that DRAWS the book
  // button asks it. That matters because the two were not one answer: the screens each
  // kept their own, thinner list, so a price with a real problem — a reply that came back
  // without the courier's handle for a door, say — drew an inert button and said nothing
  // at all. A greyed control with no words is the same fault as a tap that does nothing:
  // see the comment on `bookProblem` itself, which asks for exactly this.
  bookProblem(state, trip, quote) {
    return bookProblem(state, trip, quote);
  },

  // Call the trip off. The courier is the one who decides whether it still can, so a
  // refusal here is an ordinary answer rather than a fault — it arrives as a sentence
  // through the same contract as everything else.
  async cancel(state, jobId) {
    const id = String(jobId || "").trim();
    if (!id) return { ok: false, reason: "There is no booked trip to cancel." };
    return await callCourier(state, { action: "cancel", provider: LALAMOVE_KEY, payload: { orderId: id } });
  },
};

// Why this price cannot be booked, in words, or "" when it can. Kept as its own
// function so the answer is the SAME one whether it is asked before the press (to
// draw the button inert) or inside it (to refuse) — a button that looks live and then
// says no is the app contradicting itself.
function bookProblem(state, trip, quote) {
  if (!tripReady(trip)) return tripProblem(trip);
  if (!quote || !String(quote.id || "").trim()) {
    return "There is no price to book — ask for one, then book that.";
  }
  if (quoteExpired(quote)) {
    return "That price has expired, so it cannot be booked. A price is only good for five minutes — ask for a fresh one and book it straight away.";
  }
  if (!quoteBookable(quote)) {
    return "That price did not come back with the courier's own handle for each door, so it cannot be booked. Ask for a fresh price — and if this keeps happening, the app is reading the courier's reply wrongly, which is worth fixing rather than working around.";
  }
  const shop = senderOf(state);
  if (!phoneE164(shop.phone)) {
    return "You have no WhatsApp number in Settings, and the courier needs one to ring at the door.";
  }
  const noNumber = trip.stops.filter((s) => !phoneE164(s.phone));
  if (noNumber.length === 1) {
    return "This customer has no WhatsApp number on the order, and the courier needs one for the doorstep.";
  }
  if (noNumber.length > 1) {
    return `${noNumber.length} of these customers have no WhatsApp number on their orders, and the courier needs one for every doorstep.`;
  }
  return "";
}
