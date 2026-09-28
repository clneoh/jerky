// courier_job.js — the trip: who collects what, from which door, to whose
// (25 Sep 2026).
//
// One shape for every courier, because every courier API is the same shape: a
// sender, an ordered list of drop-offs, and a time. Lalamove calls them stops; a
// second courier will call them something else, and the point of this module is
// that the words change in one provider file and nowhere else.
//
// WHAT IS HERE AND WHY IT IS HERE. Two facts about a trip are worth being able to
// test without a network, a browser or a key, because both of them are wrong in a
// way nobody notices until the driver is at the wrong door:
//
//   • tripOf      — which doors this trip has, read off the orders and the pinned
//                   places, with "not pinned" left visible rather than papered
//                   over by a fallback.
//   • scheduleAtUTC — your own clock turned into the UTC instant the API
//                   demands. See the trap named on it below; it is the single most
//                   likely line in this feature to be quietly wrong.
//   • isLink      — whether what a courier handed back is a link or a number, which
//                   decides whether the customer is told "Track your delivery" or
//                   given something to read out. See it below for why the scheme is
//                   checked rather than assumed.
//   • jobOf / liveJobOf — the trip an order is ON, read back off the order. A booking
//                   is stored on the order row rather than in a table of its own,
//                   which is what makes booking need no database step at all, and
//                   this is the one place that reading is written down.
//   • the RUN       — one trip carrying several doorsteps, which is the only thing
//                   about a courier that actually saves her money. The load, the
//                   one-trip-against-separate arithmetic, and the delivery WINDOW —
//                   the promise a consolidated trip can honestly make, because one
//                   vehicle arrives when it arrives and not when each customer asked.
//
// Everything returns plain data. Nothing here fetches, signs, draws or saves.

import {
  pickupPlace, doorSpotOf, dropAddress, validPlace, strictNumber,
} from "./courier_place.js";
import { waNumber, orderLineName } from "./state.js";

// Malaysia has no daylight saving — one offset, all year, since 1982 — so the
// your own clock is a FIXED eight hours ahead of UTC. That is why the conversion
// below is arithmetic on your own time and not the phone's:
//
//   The trap. `new Date("2026-09-25T10:00")` is parsed in whatever timezone the
//   PHONE is set to. On her phone in Penang that is +8 and it looks right; on the
//   same phone taken to London it silently means 10:00 London, and the driver is
//   booked for 5 pm at your place. The delivery day is a Malaysia day because the
//   place is in Malaysia, so the offset is written down as a constant here rather
//   than inherited from the device that happens to be asking.
export const MY_UTC_OFFSET_HOURS = 8;

// "2026-09-25" + "10:00" -> "2026-09-25T02:00:00.000Z". Empty string when either
// half is not a real date or time, so a half-filled box can never reach the API as
// a scheduled pickup at midnight on the first of January 1970 — which is what the
// API would happily book.
//
// The date is validated by round-tripping it: Date.UTC(2026, 1, 31) is not an
// error in JavaScript, it is the 3rd of March, and a date box that somehow carries
// a 31st of February must be refused here rather than turned into a booking on a
// day she did not choose.
export function scheduleAtUTC(date, time) {
  const d = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return "";
  const Y = Number(d[1]);
  const M = Number(d[2]);
  const D = Number(d[3]);
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (M < 1 || M > 12 || D < 1 || D > 31) return "";
  if (hh > 23 || mm > 59) return "";
  const probe = new Date(Date.UTC(Y, M - 1, D));
  if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D) {
    return "";
  }
  // A negative hour is not a mistake — Date.UTC rolls it back a day, which is
  // exactly right for a 06:00 pickup, whose UTC instant is the evening before.
  const ms = Date.UTC(Y, M - 1, D, hh - MY_UTC_OFFSET_HOURS, mm);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

// Who the driver collects FROM: you, and the number the driver should ring
// if the gate is shut — your own public number, which is already typed once
// for the shop and the homepage.
export function senderOf(state) {
  const s = (state && state.settings) || {};
  const shop = (s.storefront && typeof s.storefront === "object") ? s.storefront : {};
  return {
    name: String(shop.name || "").trim() || "Munchies Furkidz",
    phone: waNumber(shop.whatsapp),
  };
}

// One door to knock on: the person, the number, the words she would say, and the
// pinned point — which may be null, and is left null rather than guessed.
//
// THE POINT IS `doorSpotOf`, NOT THE DOOR SHE KEEPS (v209) — this is the line that decides
// where a driver is actually sent. Where the customer dropped a pin of their own, that pin
// is the door, and it is this assignment that carries it all the way to the courier. A door
// she placed with her own hand still wins; see courier_place.js's own header on doorSpotOf.
export function stopOf(state, order) {
  const place = validPlace(doorSpotOf(state, order));
  return {
    order: order || null,
    name: String((order && order.customerName) || "").trim(),
    phone: waNumber(order && order.whatsapp),
    address: dropAddress(order),
    place,
  };
}

// The whole trip. `orders` is an array because a trip has stops — today the quote
// panel sends one, and one trip with several stops is the same journey the
// consolidation screen books later, so this is the shape rather than a guess at it.
//
// Nothing is filled in where something is missing: a stop with no pinned point
// keeps `place: null`, and a trip with no pickup keeps `pickup: null`. The caller
// asks placeProblem() what is missing and says so; a fallback point invented here
// would be a price for a trip that is not the one she is taking.
export function tripOf(state, orders, { scheduleAt = "" } = {}) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  return {
    pickup: validPlace(pickupPlace(state)),
    stops: list.map((o) => stopOf(state, o)),
    scheduleAt: String(scheduleAt || ""),
  };
}

// Ready to be priced: every end of it is a real point. The schedule is NOT part of
// this — a quote for "as soon as possible" is a legitimate quote, and the panel
// says which one it is asking for.
export function tripReady(trip) {
  if (!trip || !validPlace(trip.pickup)) return false;
  if (!Array.isArray(trip.stops) || !trip.stops.length) return false;
  return trip.stops.every((s) => validPlace(s.place));
}

// How many stops have no pinned doorstep yet — what the panel counts when it tells
// her how many are still to place.
export function stopsUnplaced(trip) {
  if (!trip || !Array.isArray(trip.stops)) return 0;
  return trip.stops.filter((s) => !validPlace(s.place)).length;
}

// What is still missing from this trip, in words, or "" when nothing is.
//
// This asks the same question as courier_place.js's placeProblem does, and asks it
// of a TRIP rather than of a state and an order — because a trip has already been
// built by the time a provider or a panel holds one, and rebuilding it just to find
// out what is wrong with it would be a second way to answer the same question. Both
// end in the same sentences, because both are about the same two ends of the same
// journey.
export function tripProblem(trip) {
  if (!validPlace(trip && trip.pickup)) {
    return "Your pickup spot is not pinned yet — pin it in Settings and every price from now on is for the right door.";
  }
  const missing = stopsUnplaced(trip);
  if (missing === 0) return "";
  if (missing === 1) {
    return "This customer's doorstep is not pinned yet — look it up, or put the pin on the map.";
  }
  return `${missing} of these doorsteps are not pinned yet — pin them all and the price is for the whole run.`;
}

// The day this order goes out, read the way the order ROW reads it: the delivery day
// the order points at while that day still exists, else the date it was saved with.
//
// It is a function here rather than three lines in the quote panel because a
// schedule is a day plus a time, and a price for the wrong day is a price she quotes
// to a customer and then has to take back. One reading, in the tested half.
export function orderDay(state, order) {
  const id = String((order && order.deliveryDateId) || "").trim();
  const row = id ? (((state && state.deliveryDates) || []).find((d) => d && d.id === id) || null) : null;
  return String((row && row.date) || (order && order.deliveryDate) || "").trim();
}

// A quoted price in your own money. The quote names its own currency; while
// it is your, the price reads exactly as every other price in the app does.
// When it is NOT — a courier quoting in a currency your own money does not use —
// the code is printed in place of the symbol, because "RM 300.00" over a quote that
// was really in rupiah is a price out by a factor of three thousand, and a number on
// a screen is believed.
export function fmtQuote(amount, currency, appCurrency = "RM") {
  const n = strictNumber(amount);
  if (n === null) return "";
  const said = String(currency || "").trim().toUpperCase();
  const own = String(appCurrency || "RM").trim() || "RM";
  // RM and MYR are the same money — the app stores the symbol, a courier quotes the
  // code — so both are folded to the code before they are compared. They are NOT
  // folded to whatever you use: your own money being S$ being quoted
  // MYR must see "MYR" in front of the number, because that is a different currency
  // and this line is the only thing on screen that would say so.
  const code = (x) => (x === "RM" ? "MYR" : x);
  const same = !said || code(said) === code(own);
  return `${same ? own : said} ${(Math.round(n * 100) / 100).toFixed(2)}`;
}

// How long this price has left, or "expired". A quotation that carried no readable
// expiry reads as expired rather than as live: a price with no clock on it is not
// evidence that a price is still good, and the cost of the two mistakes is not
// symmetric — asking again costs one tap, quoting a dead price costs her money.
export function fmtQuoteLeft(quote, now = Date.now()) {
  const at = Date.parse(String((quote && quote.expiresAt) || ""));
  if (!Number.isFinite(at)) return "expired";
  const left = at - now;
  if (left <= 0) return "expired";
  const s = Math.floor(left / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Whether that price is past its life. The same reading as fmtQuoteLeft, kept as a
// question of its own so a caller never has to compare a printed string to decide
// what to disable.
export function quoteExpired(quote, now = Date.now()) {
  return fmtQuoteLeft(quote, now) === "expired";
}

// A distance the way Lalamove reports it, said plainly on screen. It arrives in
// metres or kilometres depending on the trip, and short trips are the common case,
// so under a kilometre is metres and the rest is one decimal of a kilometre.
export function fmtDistanceKm(km) {
  // strictNumber, not Number: `Number(null)` is 0, so a reply with no distance in it
  // would print "0 km" beside a real price — a measurement invented out of an
  // absence, which is exactly what a distance under a fee must never be.
  const n = strictNumber(km);
  if (n === null || n < 0) return "";
  if (n === 0) return "0 km";
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1)} km`;
}

// ── what the courier hands back about a booked delivery ────────────────────
//
// A courier gives one of two things in return for a booking, and the app prints
// whichever it is in ONE slot on the order (`o.trackingNo`, which already reaches
// the customer's card and the shipped WhatsApp). The two are not the same kind of
// thing and must not be worded the same: a NUMBER is something a person reads out
// over the phone, a LINK is something a phone opens. Lalamove returns a share link
// and no AWB, which is why this question exists at all.

// Is this value a link? Only http and https.
//
// The scheme is checked rather than the presence of a colon, because `javascript:`
// and `data:` are also "a colon with something after it", and this value came from
// a courier's reply and is rendered as a tappable href for a customer. A `data:`
// href is a page, not a delivery. So the two schemes that mean "a web address" are
// named, and everything else is treated as words to read — which is the safe way
// round, since a link mis-read as a number is only less convenient, and a number
// mis-read as a link is a customer sent to nothing.
export function isLink(v) {
  return /^https?:\/\/[^\s]+$/i.test(String(v || "").trim());
}

// One line for a customer's message, or "" when there is nothing to say. The label
// follows the value; the value is never touched.
//
// Kept here, beside isLink, because the two answer the same question and a label
// that disagrees with its own value is how a customer ends up told to "Track your
// delivery" over a number, or handed a bare number labelled as a link. A typed
// number still reads exactly as it always has — "Tracking number: LLM12345" is
// character for character what this printed before there was a link to print.
export function trackingLine(value, numberLabel = "Tracking number") {
  const said = String(value || "").trim();
  if (!said) return "";
  return isLink(said) ? `Track your delivery: ${said}` : `${numberLabel}: ${said}`;
}

// ── the trip an order is on ────────────────────────────────────────────────
//
// A booked trip is kept ON THE ORDER ROW (`o.courierJob`), and that is the whole
// reason booking needs no database step: an order row syncs whole, so a trip booked
// on her phone is on her other phone the next time it syncs, with no column, no
// migration and nothing to run in Supabase. What it costs is that the app itself
// must be able to tell a real stored trip from a stray object — hence these two,
// rather than a dozen screens each reading `o.courierJob` and each deciding for
// themselves what a half-written one means.

// The trip stored on this order, or null. A job with no `jobId` is null rather than
// a job: a booking the app cannot name is one it cannot check, chase or cancel, so a
// half-written record is read as no record instead of as a trip.
export function jobOf(order) {
  const j = (order && order.courierJob) || null;
  if (!j || typeof j !== "object") return null;
  return String(j.jobId || "").trim() ? j : null;
}

// The trip STILL RUNNING on this order, or null — which is the question that matters
// before booking a second one. A finished trip is deliberately KEPT on the order: it
// is the record of what was delivered and what it cost, and deleting it would throw
// away the only thing tying a charge on her books to a real journey. So "is there a
// trip" and "is there a trip running" are two different questions, and this is the
// second one.
//
// A record written before this field existed has no `done` key, and that reads as
// LIVE rather than as finished: the cost of the two mistakes is not symmetric, since
// a trip wrongly thought finished is a second van at the same door, and a trip
// wrongly thought running is one she has to cancel by hand.
export function liveJobOf(order) {
  const j = jobOf(order);
  if (!j) return null;
  return j.done ? null : j;
}

// Whether this trip is in the courier's hands — the one fact about a trip that moves
// the ORDER itself, and the reason this is a named function rather than an equality
// written at the call site (v190).
//
// `collected` is the courier saying the parcel is on the vehicle. `delivered` says it
// has arrived, which cannot have happened without a collection before it — so a check
// made late, in the evening after the run, still moves the order rather than skipping
// the collection it was never asked about. The two stopped phases say the opposite
// about the parcel and never move anything.
//
// It reads the NEUTRAL phase and never the courier's own status word, which is what
// lets this file stay free of any courier's vocabulary.
export function tripCollected(job) {
  const j = job && typeof job === "object" ? job : null;
  if (!j) return false;
  return j.phase === "collected" || j.phase === "delivered";
}

// Why a new trip cannot be booked on these orders, in words, or "" when it can. Asked
// of the ORDERS rather than of the courier, because a running trip is a fact about the
// order and not about whoever happens to be holding it today.
export function liveJobProblem(orders) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  const live = list.map(liveJobOf).filter(Boolean);
  if (!live.length) return "";
  if (live.length === 1) {
    return "This order is already on a trip. Check it below, or cancel it first — booking again would send a second vehicle to the same door.";
  }
  return `${live.length} of these orders are already on a trip. Check them below, or cancel them first — booking again would send a second vehicle to the same door.`;
}

// ── the run: one trip, several doorsteps ───────────────────────────────────
//
// A run is a trip with more than one stop, and the whole reason it exists is money:
// the courier charges one base fare plus a fee for each extra stop, so eight cakes to
// eight houses on one motorcycle is one fare plus seven stop fees against eight
// separate fares. Her belief about consolidation was right, and this is the half of it
// that decides what she promises, so it is pure and Node-tested.
//
// Two things it deliberately does NOT do, both of them named in the courier's own
// documents rather than invented here:
//
//   • It does not choose the stop order. Lalamove's API accepts `isRouteOptimized` and
//     splits `totalBeforeOptimization` from `total`, and Lalamove Malaysia's own
//     business page says route optimisation "is yet to be available". Two documents
//     that disagree are not a feature, so the order stays HERS and nothing here may
//     ever claim to have found her an optimum.
//   • It does not say what fits. There is no capacity figure in any price reply — a
//     vehicle is priced, not measured — so the load is counted and shown beside the
//     vehicle she picked and the judgement is hers (25 Sep 2026).

// A time box, read once. The app's own pickup box already speaks "14:00", so a window
// does too, and the reading is shared by everything below rather than written four
// times — which is how "2:00" ends up meaning pm in one place and am in another.
const pad2 = (n) => String(n).padStart(2, "0");

function clockOf(time) {
  const t = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t) return null;
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (hh > 23 || mm > 59) return null;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return {
    am: hh < 12,
    mins: hh * 60 + mm,
    // Two spellings of the same time, and both are needed: `said` is what she reads
    // ("2-5 pm", with the ":00" dropped so it stays short) and `packed` is what is
    // STORED ("14:00"), zero-padded so the stored value is unambiguous and sorts.
    said: `${h12}${mm ? `:${pad2(mm)}` : ""}`,
    packed: `${pad2(hh)}:${pad2(mm)}`,
  };
}

// The two boxes packed into the one value the order carries: "14:00" + "17:00" ->
// "14:00-17:00". Empty when either half is not a time the app can read.
//
// ONE packed string rather than two keys or a `{from, to}` object, because a window
// with a start and no end is not half a promise, it is a promise with a hole in it —
// and a single value cannot half-exist. It is also what makes the window travel to her
// other phone for free: an order row syncs whole, and a string needs no explaining.
export function windowAt(from, to) {
  const a = clockOf(from);
  const b = clockOf(to);
  if (!a || !b) return "";
  return `${a.packed}-${b.packed}`;
}

// That value taken apart again, for the two boxes on the run screen when she comes back
// to a day she already set a window on. Null rather than a half-filled pair when it is
// not a window, so a box can never be seeded with a time that was never set.
export function windowParts(w) {
  const m = String(w || "").trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!m) return null;
  const a = clockOf(m[1]);
  const b = clockOf(m[2]);
  if (!a || !b) return null;
  return { from: a.packed, to: b.packed };
}

// Is this a window at all? Both ends readable, and the end after the start. An EMPTY
// window is not valid — it is the day's promise, which is what the shop already makes,
// and the caller says which of the two it is holding.
export function validWindow(w) {
  const parts = windowParts(w);
  if (!parts) return false;
  const a = clockOf(parts.from);
  const b = clockOf(parts.to);
  return !!a && !!b && b.mins > a.mins;
}

// What is wrong with the two boxes, in words, or "" when nothing is — including when
// both are empty, because "no window" is a legitimate answer and not a mistake. This is
// the form's question, so it asks about the two boxes rather than about the packed
// value they have not been packed into yet.
export function windowProblem(from, to) {
  const said = String(from || "").trim();
  const till = String(to || "").trim();
  if (!said && !till) return "";
  const a = clockOf(said);
  const b = clockOf(till);
  if (!a || !b) {
    return "A delivery window needs both ends — the earliest the van could arrive, and the latest.";
  }
  if (b.mins <= a.mins) {
    return "That window ends before it starts, so a customer would be told to expect the van before it left your place.";
  }
  return "";
}

// The window as she would say it: "2-5 pm". The repeated meridiem is dropped when both
// ends share it and kept when they do not ("11 am-2 pm"), because "11-2 pm" reads as
// eleven at night and a delivery promise is not a place to be terse.
export function fmtWindow(w) {
  const parts = windowParts(w);
  if (!parts) return "";
  const a = clockOf(parts.from);
  const b = clockOf(parts.to);
  if (!a || !b) return "";
  const end = b.am ? "am" : "pm";
  return a.am === b.am ? `${a.said}-${b.said} ${end}` : `${a.said} ${a.am ? "am" : "pm"}-${b.said} ${end}`;
}

// ", 2-5 pm" — what a window adds to the end of a day's own words, or "" when there is
// no window to add. The comma is IN the string so no caller has to remember it, because
// the same suffix goes into a published card, three WhatsApp messages and the order's
// own line, and four hands formatting one promise is four chances to disagree.
//
// This is the PUBLISHING path, so it asks validWindow and not merely "can it be read".
// A window she is halfway through typing is allowed to read "5-2 pm" in the box she is
// looking at; it is not allowed to reach a customer as ", 5-2 pm" telling them to expect
// the van before it left. Found by this file's own test at v191.
export function windowSuffix(order) {
  const w = order && order.deliveryWindow;
  if (!validWindow(w)) return "";
  return `, ${fmtWindow(w)}`;
}

// What the run actually carries: how many doorsteps, how many items, and which items.
//
// The count is per GROUP and not per order row, because a customer who ordered three
// things in one order is ONE stop — handing the courier one stop per line would send
// the same van to the same door three times and charge three stop fees for it.
// `stops` is therefore the number of customers on the run.
//
// The items are counted over every line of every group, and named with the app's own
// product naming so the load line reads in the same words as the order card above it.
export function loadOf(state, groups) {
  const list = (Array.isArray(groups) ? groups : [groups]).filter(Boolean);
  const tally = new Map();
  let items = 0;
  for (const g of list) {
    for (const o of ((g && g.orders) || [])) {
      const qty = strictNumber(o && o.qty);
      const n = qty === null ? 0 : qty;
      items += n;
      // The gone-product name is folded to "item", the same reading the customer's own
      // card makes of it (supabase.js), so a deleted product does not grow a third way
      // of being named.
      const raw = String(orderLineName(state, o) || "").trim();
      const name = raw === "(deleted product)" ? "item" : raw;
      if (name) tally.set(name, (tally.get(name) || 0) + n);
    }
  }
  const all = [...tally.entries()].map(([name, qty]) => `${name} ×${qty}`);
  const shown = all.slice(0, 4);
  const rest = all.length - shown.length;
  return {
    stops: list.length,
    items,
    summary: rest > 0 ? `${shown.join("  ·  ")}  ·  and ${rest} more` : shown.join("  ·  "),
  };
}

// The one trip against the same stops priced one at a time — the saving, as a number
// she can see rather than a claim anybody makes.
//
// Null when either side is incomplete: a saving worked out from a missing price is a
// number invented from an absence, and this number is the whole argument for
// consolidating. A NEGATIVE saving is returned as it stands rather than floored at
// zero, because a run that costs more than separate trips is a thing that can really
// happen (a small run on a big vehicle) and the screen must be able to say so.
export function savingOf(one, separate) {
  const single = strictNumber(one);
  const list = Array.isArray(separate) ? separate : [];
  if (single === null || !list.length) return null;
  const parts = list.map(strictNumber);
  if (parts.some((p) => p === null)) return null;
  const cents = (n) => Math.round(n * 100);
  const sum = parts.reduce((a, b) => a + cents(b), 0);
  return { one: single, sum: sum / 100, saving: (sum - cents(single)) / 100 };
}

// Lalamove's own documents disagree about the largest trip: the API documents 2 to 16
// stops, the consumer app advertises 20. The lower number is the one that could refuse
// her, so it is the one said out loud — as a WARNING rather than a refusal, because the
// courier has the last word and a screen that blocks a booking the courier would have
// taken is the app inventing a rule. Her standing instruction: guide, never a gate.
export function runLimitProblem(stops) {
  const n = strictNumber(stops);
  if (n === null || n <= 16) return "";
  return `This run has ${n} stops and the courier's documents put a trip at 16. It may be refused — nothing here will stop you trying, and the courier has the last word.`;
}

// Write a trip onto the orders it carries, so every customer on a run is on the same
// journey: the same job record, and the courier's own link only where that link has
// nothing of anybody else's in it.
//
// Extracted from the quote panel's own commit (v191) because a run stamps MANY groups
// where a single booking stamps one, and the rule hiding in the second line is worth
// having in exactly one place: the link is written ONLY when the courier really sent
// one. An empty link must never blank a tracking number she typed by hand — that would
// be this app deleting a customer's reference on the strength of an absence in somebody
// else's reply.
//
// A TRIP'S LINK IS NOT ITS CUSTOMERS' TO SHARE (v218). The courier hands back ONE link
// for the whole trip — its documents call it a thing "for sharing delivery information
// with a 3rd party personnel", and there is no per-stop equivalent — so on a run that
// carries several doorsteps that one link shows each customer the other doorsteps. Her
// report: "the courier link ... when the customer track it, they become aware of the
// other drop off point". So the link reaches a customer ONLY where the trip carries
// nothing but that customer's own doorstep, which is what `alone` says. It defaults to
// FALSE so a caller that forgets shares nothing, rather than a caller that forgets
// sharing everybody. The trip itself — the job record, and with it the progress, the
// driver and the plate the customer's card publishes — goes on every order either way.
export function stampTrip(orders, job, label = "", { alone = false } = {}) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  const named = job
    ? { ...job, courierName: String(label || "").trim() || job.courierName || "" }
    : job;
  for (const o of list) {
    o.courierJob = named;
    if (named && named.link && alone) o.trackingNo = named.link;
  }
  return named;
}

// ── when something happened, said plainly ─────────────────────────────────

// A moment, in your own reading: "2:14 pm", or "25 Sep, 2:14 pm" once it is
// not today. Used for when a trip was booked and when its status was last read, both
// of which are ISO instants written by the app itself rather than by the courier —
// so this is a clock, not a parse of somebody else's format.
//
// `today` is passed rather than read from the device so the caller can hold one day
// for a whole screen: two lines on one card disagreeing about whether it is today
// would be the app's own arithmetic being visibly wrong.
export function fmtStamp(iso, today = "") {
  const at = Date.parse(String(iso || ""));
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  const hh = d.getHours();
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const clock = `${h12}:${String(d.getMinutes()).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (today && day === String(today).trim()) return clock;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock}`;
}

// How long ago a moment was, in the words a person would use. Anything under a
// minute is "just now" rather than "0 minutes ago", and a moment in the future — a
// phone whose clock was wrong when the trip was booked — reads as "just now" rather
// than as a negative age, because a screen that says "in -3 minutes" is a screen
// arguing with itself.
export function fmtAgo(iso, now = Date.now()) {
  const at = Date.parse(String(iso || ""));
  if (!Number.isFinite(at)) return "";
  const s = Math.floor((now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
