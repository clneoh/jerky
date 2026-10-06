// test/courier-job.test.js — the trip: when, who, and which doors (v188,
// 25 Sep 2026).
//
// Two things in this file can be wrong in a way nobody notices until the driver is
// somewhere else, and both are pinned here rather than trusted:
//
//   1. THE TIME. Lalamove wants `scheduleAt` as an ISO instant in UTC. The bakery
//      works on a Penang clock. The gap between them is eight hours, and the
//      obvious way to close it — `new Date("2026-09-25T10:00")` — closes it with
//      the PHONE's timezone instead of the bakery's. On her phone in Penang that
//      looks right; the same phone flown to London books a 5 pm pickup while
//      showing her 10:00. One test below sets TZ elsewhere on purpose, so that a
//      conversion which reached for the device clock would fail it.
//
//   2. WHICH DOORS. A trip with an unpinned stop must keep that stop VISIBLE as
//      unpinned rather than quietly filling in a fallback. A fallback point is a
//      price for a journey that is not the one she is taking, and it is the kind of
//      wrong answer that looks like a right one on screen.
//
// Pure — no DOM, no fetch. `setDropPlace`/`setPickupPlace` are the real functions,
// called rather than stubbed, because what these tests are checking is the state
// they leave behind (and `save` swallows the missing localStorage under Node).

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  MY_UTC_OFFSET_HOURS, scheduleAtUTC, senderOf, stopOf, tripOf, tripReady,
  stopsUnplaced, tripProblem, fmtDistanceKm,
  orderDay, fmtQuote, fmtQuoteLeft, quoteExpired,
  isLink, trackingLine, jobOf, liveJobOf, liveJobProblem, fmtStamp, fmtAgo,
  freeCancelOf, freeCancelLine, needsVan, stopKeyOf, promisedWindowSuffix, windowSuffix,
  courierDeliveryText, courierDayOf, pickupTimeOf,
} = await import("../admin/js/courier_job.js");
const { setPickupPlace, setDropPlace } = await import("../admin/js/courier_place.js");

function emptyState(extra = {}) {
  return {
    settings: {
      currency: "RM",
      mailingAddress: "8 Lebuh Pantai, 10300 Penang",
      storefront: {},
    },
    orders: [],
    customers: [],
    ...extra,
  };
}

// One order from one customer, with a Penang address and a Malaysian number.
function makeOrder(extra = {}) {
  return {
    id: "ordaaa111",
    customerName: "Mei Ling",
    whatsapp: "0169601268",
    address: "12 Jalan Bunga, 10450 Penang",
    deliveryDate: "2026-09-25",
    ...extra,
  };
}

// ── the bakery's clock, turned into the API's ─────────────────────────────

test("the bakery's 10 am is 02:00 UTC — eight hours, not the device's offset", () => {
  assert.equal(MY_UTC_OFFSET_HOURS, 8, "Malaysia has had one offset since 1982; it must not be read off the phone");
  assert.equal(scheduleAtUTC("2026-09-25", "10:00"), "2026-09-25T02:00:00.000Z");
});

test("the offset is Malaysia's even when the phone thinks it is somewhere else", () => {
  // The trap, made testable. process.env.TZ is read by Node's own Date parsing, so
  // a conversion that built a local date string and let Date parse it would answer
  // differently here. This is the assertion that fails if the implementation ever
  // reaches for the device clock, and it is why the constant exists at all.
  const before = process.env.TZ;
  try {
    process.env.TZ = "Europe/London";
    assert.equal(scheduleAtUTC("2026-09-25", "10:00"), "2026-09-25T02:00:00.000Z");
    process.env.TZ = "America/New_York";
    assert.equal(scheduleAtUTC("2026-09-25", "10:00"), "2026-09-25T02:00:00.000Z");
    process.env.TZ = "Asia/Kolkata";
    assert.equal(scheduleAtUTC("2026-09-25", "10:00"), "2026-09-25T02:00:00.000Z", "and not a half-hour offset either");
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test("an early pickup lands on the day before, in UTC — and that is correct", () => {
  // A 06:00 collection in Penang is 22:00 the previous evening in UTC. The day
  // rolling back is not a bug; it is the same instant said the other way.
  assert.equal(scheduleAtUTC("2026-09-25", "06:00"), "2026-09-24T22:00:00.000Z");
  assert.equal(scheduleAtUTC("2026-09-25", "07:59"), "2026-09-24T23:59:00.000Z");
  assert.equal(scheduleAtUTC("2026-09-25", "08:00"), "2026-09-25T00:00:00.000Z");
  assert.equal(scheduleAtUTC("2026-09-25", "00:00"), "2026-09-24T16:00:00.000Z");
});

test("the last minute of the day survives", () => {
  assert.equal(scheduleAtUTC("2026-09-25", "23:59"), "2026-09-25T15:59:00.000Z");
});

test("a single-digit hour is read as itself, not as a minute", () => {
  assert.equal(scheduleAtUTC("2026-09-25", "9:30"), "2026-09-25T01:30:00.000Z");
  assert.equal(scheduleAtUTC("2026-09-25", "09:30"), "2026-09-25T01:30:00.000Z");
});

test("the 31st of February is refused, not rolled into March", () => {
  // Date.UTC(2026, 1, 31) is not an error in JavaScript, it is the 3rd of March. A
  // booking on a day she did not choose is worse than no booking at all.
  assert.equal(scheduleAtUTC("2026-02-31", "10:00"), "");
  assert.equal(scheduleAtUTC("2026-02-29", "10:00"), "", "2026 is not a leap year");
  assert.equal(scheduleAtUTC("2024-02-29", "10:00"), "2024-02-29T02:00:00.000Z", "but 2024 is");
  assert.equal(scheduleAtUTC("2026-04-31", "10:00"), "");
  assert.equal(scheduleAtUTC("2026-13-01", "10:00"), "");
});

test("a half-filled or nonsense box never becomes a booking at the epoch", () => {
  // The API would happily take "1970-01-01T00:00:00Z" and book it. Everything that
  // is not a real date and a real time is an empty string, which the panel reads as
  // "as soon as possible" and says out loud rather than guessing.
  assert.equal(scheduleAtUTC("", "10:00"), "");
  assert.equal(scheduleAtUTC("2026-09-25", ""), "");
  assert.equal(scheduleAtUTC(null, null), "");
  assert.equal(scheduleAtUTC("25/09/2026", "10:00"), "");
  assert.equal(scheduleAtUTC("2026-9-25", "10:00"), "");
  assert.equal(scheduleAtUTC("2026-09-25", "24:00"), "");
  assert.equal(scheduleAtUTC("2026-09-25", "10:60"), "");
  assert.equal(scheduleAtUTC("2026-09-25", "10"), "");
  assert.equal(scheduleAtUTC("2026-09-25", "ten"), "");
});

// ── who collects ──────────────────────────────────────────────────────────

test("the driver rings the number already on the shop, in the form a phone dials", () => {
  const s = emptyState();
  s.settings.storefront = { name: "Munchies Furkidz", whatsapp: "016 960 1268" };
  assert.deepEqual(senderOf(s), { name: "Munchies Furkidz", phone: "60169601268" });
});

test("a bakery with no name set still has a name for the driver", () => {
  assert.equal(senderOf(emptyState()).name, "Munchies Furkidz");
  assert.equal(senderOf({}).name, "Munchies Furkidz");
});

// ── which doors ───────────────────────────────────────────────────────────

test("a stop carries the person, the number, the words and the point", () => {
  const s = emptyState();
  const o = makeOrder();
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
  const stop = stopOf(s, o);
  assert.equal(stop.name, "Mei Ling");
  assert.equal(stop.phone, "60169601268");
  assert.equal(stop.address, "12 Jalan Bunga, 10450 Penang");
  assert.deepEqual(stop.place, { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
  assert.equal(stop.order, o, "the order itself travels, so the panel can name it back to her");
});

// ── v301: a collection at a Self collection Point ─────────────────────────

const FARLIM = {
  id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik, 11500 Air Itam",
  receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5, paused: false,
  createdAt: "2026-10-12T00:00:00.000Z",
  place: { lat: 5.4, lng: 100.28, label: "Farlim, Air Itam" },
};

test("★ a collection at a Point sends the driver to the POINT, not the customer's house", () => {
  // ⚠️ THE LINE THAT DECIDES WHERE A VAN ACTUALLY GOES. A customer who chose to collect at
  // Farlim is NOT AT FARLIM — sending a driver to their house with four other people's bread
  // would be the most expensive possible way to be wrong on this screen. The order carries
  // which Point it went to, so the stop is the Point: its pin, its name, and the person who
  // receives there, none of which is the customer.
  const s = emptyState({ points: [FARLIM] });
  const o = makeOrder({ pointId: "pt_farlim" });
  // The customer has a door of their own, pinned and real — and it must be IGNORED.
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });

  const stop = stopOf(s, o);
  assert.deepEqual(stop.place, { lat: 5.4, lng: 100.28, label: "Farlim, Air Itam" },
    "the van goes to the Point, never to the customer's own pinned door");
  assert.equal(stop.name, "Farlim, Air Itam", "and the driver is told to look for the Point");
  assert.equal(stop.phone, "60123456789", "ringing whoever receives there, not the customer");
  assert.equal(stop.address, "Lebuhraya Thean Teik, 11500 Air Itam");
  assert.equal(stop.pointId, "pt_farlim");
  assert.equal(stop.order, o, "the order still travels, so the panel can name it back to her");
});

test("a PAUSED Point still sends the van where the order was promised", () => {
  // Pausing decides what is OFFERED, never what an order already promised — the customer was
  // already told to go to Farlim, and their bread still has to get there. Same rule that keeps
  // an ended promo code coming off the order it was placed on.
  const s = emptyState({ points: [{ ...FARLIM, paused: true }] });
  const stop = stopOf(s, makeOrder({ pointId: "pt_farlim" }));
  assert.deepEqual(stop.place, { lat: 5.4, lng: 100.28, label: "Farlim, Air Itam" });
});

test("a Point with no pin leaves its stop unpinned rather than guessing", () => {
  // The same rule an unpinned doorstep keeps, for the same reason: a fallback point is a price
  // for a journey that is not the one she is taking, and it looks like a right answer on
  // screen. `tripProblem` is what says so.
  const s = emptyState({ points: [{ ...FARLIM, place: null }] });
  const stop = stopOf(s, makeOrder({ pointId: "pt_farlim" }));
  assert.equal(stop.place, null);
  assert.equal(stop.name, "Farlim, Air Itam", "the words are still there to look it up from");
  assert.equal(stop.address, "Lebuhraya Thean Teik, 11500 Air Itam");
});

test("a Point she has DELETED does not move an order that already went there", () => {
  // The order keeps the Point's NAME frozen (v299), but a deleted Point has no pin to give —
  // so the stop falls back to the customer's own door, which is the honest answer rather than a
  // van sent to coordinates nobody has any more.
  const s = emptyState();
  const o = makeOrder({ pointId: "pt_gone", pointName: "Farlim, Air Itam" });
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
  assert.deepEqual(stopOf(s, o).place, { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
});

test("an unpinned stop keeps place: null rather than a guessed point", () => {
  const s = emptyState();
  const stop = stopOf(s, makeOrder());
  assert.equal(stop.place, null);
  assert.equal(stop.address, "12 Jalan Bunga, 10450 Penang", "the words she typed are still there to look up");
});

test("the door a driver is booked to is the customer's own pin, not the door she keeps (v209)", () => {
  // THE LINE THAT DECIDES WHERE A DRIVER ACTUALLY GOES. Her report, five times over: "the pin
  // still wrong". Measured on her own app, the dot was the door she KEEPS — filled in by an
  // older version from a map lookup, sitting in a different town — while the pin the customer
  // dropped at their own door was ignored. A lookup answers the wrong town as easily as the
  // right one, so on the order this test builds the booked stop is the customer's point.
  const s = emptyState();
  const o = makeOrder({ customerPlace: { lat: 5.4299, lng: 100.3399, label: "the front gate" } });
  setDropPlace(s, o, { lat: 3.1, lng: 101.6, label: "the wrong town" }, "lookup");
  assert.deepEqual(stopOf(s, o).place, { lat: 5.4299, lng: 100.3399, label: "the front gate" });

  // And the door SHE placed by her own hand is the one exception — a correction she made must
  // not be undone by a pin that disagrees with it.
  const own = emptyState();
  const o2 = makeOrder({ customerPlace: { lat: 5.4299, lng: 100.3399 } });
  setDropPlace(own, o2, { lat: 5.42, lng: 100.33, label: "the door she checked" }, "hand");
  assert.deepEqual(stopOf(own, o2).place, { lat: 5.42, lng: 100.33, label: "the door she checked" });
});

test("a trip is the bakery plus every stop, and nothing invented", () => {
  const s = emptyState();
  setPickupPlace(s, { lat: 5.4141, lng: 100.3288 });
  const a = makeOrder({ id: "ordaaa111", whatsapp: "0169601268" });
  const b = makeOrder({ id: "ordbbb222", whatsapp: "0171234567", customerName: "Hafiz" });
  const trip = tripOf(s, [a, b], { scheduleAt: "2026-09-25T02:00:00.000Z" });
  assert.deepEqual(trip.pickup, { lat: 5.4141, lng: 100.3288, label: "" });
  assert.equal(trip.stops.length, 2);
  assert.equal(trip.scheduleAt, "2026-09-25T02:00:00.000Z");
});

test("a trip with no pickup keeps pickup: null", () => {
  const s = emptyState();
  const trip = tripOf(s, [makeOrder()]);
  assert.equal(trip.pickup, null);
  assert.equal(tripReady(trip), false);
});

test("one order is a trip of one stop — the same shape as a run of eight", () => {
  const s = emptyState();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  assert.equal(tripOf(s, makeOrder()).stops.length, 1, "a single order is not a special case");
});

test("tripReady needs both ends of every leg, and says nothing about the clock", () => {
  const s = emptyState();
  const o = makeOrder();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  assert.equal(tripReady(tripOf(s, o)), false, "the doorstep is still unpinned");
  setDropPlace(s, o, { lat: 5.41, lng: 100.32 });
  // No schedule is a legitimate trip: "as soon as possible" is a quote she can ask
  // for, and the panel says which one it asked for.
  assert.equal(tripReady(tripOf(s, o)), true);
});

test("tripReady refuses an empty trip rather than pricing a journey with nowhere to go", () => {
  const s = emptyState();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  assert.equal(tripReady(tripOf(s, [])), false);
  assert.equal(tripReady(null), false);
});

test("stopsUnplaced counts what is left to place", () => {
  const s = emptyState();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  const a = makeOrder({ id: "ordaaa111", whatsapp: "0169601268" });
  const b = makeOrder({ id: "ordbbb222", whatsapp: "0171234567", customerName: "Hafiz" });
  setDropPlace(s, a, { lat: 5.41, lng: 100.32 });
  const trip = tripOf(s, [a, b]);
  assert.equal(stopsUnplaced(trip), 1);
  assert.equal(stopsUnplaced(null), 0);
});

// ── what the panel says when something is missing ─────────────────────────

test("the pickup is named before the doorstep — the trip has no start without it", () => {
  assert.match(tripProblem(tripOf(emptyState(), [makeOrder()])), /Settings/);
});

test("one missing doorstep is said one way, several another, and the count is real", () => {
  const s = emptyState();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  const orders = ["0169601268", "0171234567", "0187654321"]
    .map((w, i) => makeOrder({ id: `ord000000${i}`, whatsapp: w }));
  setDropPlace(s, orders[0], { lat: 5.41, lng: 100.32 });
  assert.match(tripProblem(tripOf(s, orders)), /^2 of these doorsteps/);
  setDropPlace(s, orders[1], { lat: 5.42, lng: 100.33 });
  assert.match(tripProblem(tripOf(s, orders)), /^This customer's doorstep/);
  setDropPlace(s, orders[2], { lat: 5.43, lng: 100.34 });
  assert.equal(tripProblem(tripOf(s, orders)), "");
});

// ── distance, said plainly ────────────────────────────────────────────────

test("a short trip is metres and a long one is kilometres", () => {
  assert.equal(fmtDistanceKm(0.4), "400 m");
  assert.equal(fmtDistanceKm(0.999), "999 m");
  assert.equal(fmtDistanceKm(1), "1.0 km");
  assert.equal(fmtDistanceKm(12.34), "12.3 km");
  assert.equal(fmtDistanceKm(0), "0 km");
});

test("a distance that is not a distance says nothing rather than NaN", () => {
  assert.equal(fmtDistanceKm(null), "");
  assert.equal(fmtDistanceKm(undefined), "");
  assert.equal(fmtDistanceKm("far"), "");
  assert.equal(fmtDistanceKm(NaN), "");
  assert.equal(fmtDistanceKm(-1), "", "a negative distance is a bad reply, not a short trip");
});

// ── which day this order goes out ────────────────────────────────────────

test("the delivery day is the row's own day, and the saved date stands in once that day is gone", () => {
  const s = emptyState({ deliveryDates: [{ id: "dd1", date: "2026-09-25" }, { id: "dd2", date: "2026-10-02" }] });
  // The day the row points at is the day she promised, so it wins over the date the
  // order was saved with — she can move an order to another day.
  assert.equal(orderDay(s, makeOrder({ deliveryDateId: "dd2", deliveryDate: "2026-09-25" })), "2026-10-02");
  // A day that has since been deleted leaves the order where it was saved rather than
  // leaving it undated: a trip with no day is priced as "as soon as possible", and that
  // is a different price from the one she promised.
  assert.equal(orderDay(s, makeOrder({ deliveryDateId: "dd-removed", deliveryDate: "2026-09-25" })), "2026-09-25");
  assert.equal(orderDay(s, makeOrder({ deliveryDateId: "", deliveryDate: "2026-09-25" })), "2026-09-25");
  // Nothing known at all stays nothing: "" is what the panel reads as "no day on this
  // order", which it says out loud rather than guessing one.
  assert.equal(orderDay(s, makeOrder({ deliveryDateId: "", deliveryDate: "" })), "");
  assert.equal(orderDay(s, null), "");
});

// ── a price, and how long it lives ───────────────────────────────────────

test("a price in the bakery's own money reads like every other price, and another currency says which one it is", () => {
  assert.equal(fmtQuote(18.5, "MYR", "RM"), "RM 18.50");
  assert.equal(fmtQuote(18.5, "", "RM"), "RM 18.50", "a quote that named no currency is read as the bakery's own");
  assert.equal(fmtQuote(18.5, "RM", "RM"), "RM 18.50");
  assert.equal(fmtQuote(240000, "IDR", "RM"), "IDR 240000.00", "a price in another currency must never be shown with RM in front of it");
  assert.equal(fmtQuote(18.5, "MYR", "S$"), "MYR 18.50");
  assert.equal(fmtQuote(null, "MYR", "RM"), "");
  assert.equal(fmtQuote("", "MYR", "RM"), "");
  assert.equal(fmtQuote("free", "MYR", "RM"), "");
});

test("a quotation's clock counts down, and a dead one reads as dead", () => {
  const t0 = Date.parse("2026-09-25T02:00:00.000Z");
  const at = (secs) => ({ expiresAt: new Date(t0 + secs * 1000).toISOString() });
  assert.equal(fmtQuoteLeft(at(300), t0), "5:00");
  assert.equal(fmtQuoteLeft(at(61), t0), "1:01");
  assert.equal(fmtQuoteLeft(at(9), t0), "0:09");
  assert.equal(quoteExpired(at(9), t0), false);
  assert.equal(fmtQuoteLeft(at(0), t0), "expired");
  assert.equal(fmtQuoteLeft(at(-1), t0), "expired");
  assert.equal(quoteExpired(at(-1), t0), true);
  // A reply with no readable expiry is NOT evidence that a price is still good. The
  // two mistakes do not cost the same: asking again costs one tap, quoting a dead
  // price costs her money.
  for (const bad of [{}, { expiresAt: "" }, { expiresAt: "soon" }, null, undefined]) {
    assert.equal(fmtQuoteLeft(bad, t0), "expired");
    assert.equal(quoteExpired(bad, t0), true);
  }
});

// ── the trip an order is on (v189, 25 Sep 2026) ───────────────────────────
//
// A booking is stored ON THE ORDER (`o.courierJob`), and that is what makes booking
// need no database step: an order row syncs whole, so the trip reaches her other phone
// with nothing to run in Supabase. What that costs is that the app must be able to
// tell a real stored trip from a stray object, and to tell a trip still RUNNING from
// one that is over — because a second booking on a live trip is a second van at the
// same door, which is real money.

function orderWith(job) {
  return { id: "o1", customerName: "Mei", whatsapp: "60123456789", courierJob: job };
}
const JOB = {
  provider: "lalamove", jobId: "ord_1", quoteId: "q1", service: "CAR", name: "Car",
  amount: 14, currency: "MYR", link: "https://share.lalamove.com/abc", status: "ASSIGNING_DRIVER",
  statusAt: "2026-09-25T02:00:00.000Z", bookedAt: "2026-09-25T02:00:00.000Z", scheduleAt: "",
};

test("a job with no trip number is not a trip — it is nothing", () => {
  // A booking the app cannot NAME is one it cannot check, chase or cancel, and a
  // half-written record would otherwise read as a trip that exists and does nothing.
  assert.equal(jobOf(orderWith(null)), null);
  assert.equal(jobOf(orderWith({})), null);
  assert.equal(jobOf(orderWith({ jobId: "   " })), null);
  assert.equal(jobOf(orderWith("a string, from a sync that went odd")), null);
  assert.equal(jobOf({}), null);
  assert.equal(jobOf(null), null);
  assert.equal(jobOf(orderWith(null)), null);
});

test("a stored trip comes back whole, and one with a number is a trip", () => {
  assert.equal(jobOf(orderWith(JOB)), JOB);
});

test("a trip still running blocks a second booking, and a finished one does not", () => {
  // The money rule. ASSIGNING_DRIVER is live; COMPLETED is over. The finished trip is
  // KEPT on the order rather than deleted — it is the record of what was delivered and
  // what it cost, and the only thing tying a charge on her books to a real journey.
  const over = { ...JOB, done: true };
  assert.equal(liveJobOf(orderWith(JOB)), JOB);
  assert.equal(liveJobOf(orderWith(over)), null);
  assert.equal(jobOf(orderWith(over)) && jobOf(orderWith(over)).jobId, "ord_1", "finished is not the same as gone");
  assert.equal(liveJobOf(orderWith(null)), null);
});

test("a record written before the done flag existed reads as LIVE, not as finished", () => {
  // This is the safe direction and it is chosen on purpose. A trip wrongly thought
  // finished is a second van at the same door; a trip wrongly thought running is one
  // she has to cancel by hand. Only one of those costs money she did not agree to.
  const { done, ...noFlag } = JOB;
  assert.equal(liveJobOf(orderWith(noFlag)), noFlag);
});

test("the reason a booking is blocked is said once for one order and counted for several", () => {
  assert.equal(liveJobProblem([{ courierJob: null }]), "");
  assert.match(liveJobProblem([orderWith(JOB)]), /already on a trip/);
  assert.match(liveJobProblem([orderWith(JOB)]), /second vehicle/);
  const two = liveJobProblem([orderWith(JOB), orderWith({ ...JOB, jobId: "ord_2" }), { courierJob: null }]);
  assert.match(two, /^2 of these orders/);
  // A finished trip on one order and a live one on another counts only the live one.
  assert.match(liveJobProblem([orderWith({ ...JOB, done: true }), orderWith(JOB)]), /^This order/);
});

test("only http and https are links — a page is not a delivery", () => {
  assert.equal(isLink("https://share.lalamove.com/abc"), true);
  assert.equal(isLink("http://x.y/z"), true);
  assert.equal(isLink("  HTTPS://SHARE.LALAMOVE.COM/ABC  "), true);
  // The two that would be read as a link by a check that only looked for a colon, and
  // both of them are rendered as a tappable href on a customer's own page.
  assert.equal(isLink("javascript:alert(1)"), false);
  assert.equal(isLink("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isLink("LLM12345"), false);
  assert.equal(isLink("LLM-123 45"), false);
  assert.equal(isLink("https://"), false, "a scheme with nothing after it is not an address");
  assert.equal(isLink("see https://x.y"), false, "a link inside a sentence is not a link");
  assert.equal(isLink(""), false);
  assert.equal(isLink(null), false);
});

test("the tracking slot words a link and a number differently, and a typed number is untouched", () => {
  assert.equal(trackingLine("https://share.lalamove.com/abc"), "Track your delivery: https://share.lalamove.com/abc");
  // Character for character what this printed before there was a link to print.
  assert.equal(trackingLine("LLM12345"), "Tracking number: LLM12345");
  assert.equal(trackingLine("LLM-123 45"), "Tracking number: LLM-123 45");
  assert.equal(trackingLine(""), "");
  assert.equal(trackingLine(null), "");
  // The label is the caller's to choose, which is how a courier's own word for it can
  // be used without this module learning any courier's vocabulary.
  assert.equal(trackingLine("LLM1", "Consignment"), "Consignment: LLM1");
  assert.equal(trackingLine("https://x.y/z", "Consignment"), "Track your delivery: https://x.y/z");
});

test("a moment reads as a clock today and as a dated clock once it is not today", () => {
  // These moments are BUILT IN LOCAL TIME on purpose, and it is the same choice the
  // function makes: a stamp is what a person reads on their own phone ("Called off
  // from here 2:14 pm"), so it is the phone's own clock, exactly as the dashboard and
  // the settings cards already show theirs. The instant that travels TO the courier is
  // the one that must never touch the device clock, and that conversion is pinned
  // above, under its own name. Built this way the test says the same thing on any
  // machine the suite is ever run from.
  const at = (h, m) => new Date(2026, 8, 25, h, m).toISOString();
  assert.equal(fmtStamp(at(14, 14), "2026-09-25"), "2:14 pm");
  assert.equal(fmtStamp(at(14, 14), "2026-09-26"), "25 Sep, 2:14 pm");
  assert.equal(fmtStamp(at(14, 14), ""), "25 Sep, 2:14 pm", "with no day given it is always dated");
  assert.equal(fmtStamp(at(9, 5), "2026-09-25"), "9:05 am", "a single-digit hour and a minute under ten both keep their shape");
  // Midnight and noon are the two a 12-hour clock gets wrong if it is written
  // carelessly — 0 o'clock and 12 o'clock are not times anybody says.
  assert.equal(fmtStamp(at(0, 0), "2026-09-25"), "12:00 am");
  assert.equal(fmtStamp(at(12, 0), "2026-09-25"), "12:00 pm");
  assert.equal(fmtStamp("", "2026-09-25"), "");
  assert.equal(fmtStamp("not a moment", "2026-09-25"), "");
});

test("how long ago is said the way a person says it, and a future moment is not negative", () => {
  const t0 = Date.parse("2026-09-25T02:00:00.000Z");
  const ago = (secs) => fmtAgo(new Date(t0 - secs * 1000).toISOString(), t0);
  assert.equal(ago(0), "just now");
  assert.equal(ago(59), "just now");
  assert.equal(ago(60), "1 min ago");
  assert.equal(ago(59 * 60), "59 min ago");
  assert.equal(ago(60 * 60), "1 hr ago");
  assert.equal(ago(25 * 60 * 60), "yesterday");
  assert.equal(ago(3 * 24 * 60 * 60), "3 days ago");
  // A phone whose clock was wrong when the trip was booked must not produce a screen
  // arguing with itself — "read in -3 minutes" is not a thing that can be read.
  assert.equal(fmtAgo(new Date(t0 + 5000).toISOString(), t0), "just now");
  assert.equal(fmtAgo("", t0), "");
  assert.equal(fmtAgo("whenever", t0), "");
});

// ── when calling it off stops being free (v234) ────────────────────────────
//
// The one thing about a booked trip that can still cost her money after it is booked.
// A courier gives a grace period and charges after it, and the grace runs in TWO
// DIRECTIONS — back from a scheduled pickup, forward from a driver taking an immediate
// job — which is why this is arithmetic rather than a subtraction written at the screen.

test("the free calling-off window shuts BEFORE a scheduled pickup, by the courier's own grace", () => {
  const pick = new Date(2026, 9, 2, 10, 0).toISOString();
  const job = { jobId: "J1", scheduleAt: pick };
  const fc = freeCancelOf(job, { scheduledMs: 45 * 60 * 1000 });
  assert.equal(fc.kind, "scheduled");
  assert.equal(Date.parse(fc.until), Date.parse(pick) - 45 * 60 * 1000);
  // And it is the pickup MINUS the grace. The direction matters: a deadline read
  // forward would tell her she is free at the very moment she is being charged.
  assert.notEqual(Date.parse(fc.until), Date.parse(pick));
  assert.ok(Date.parse(fc.until) < Date.parse(pick));
});

test("a trip booked for as soon as possible has no clock to count back from, and says so", () => {
  const fc = freeCancelOf({ jobId: "J1" }, { scheduledMs: 45 * 60 * 1000 });
  assert.equal(fc.kind, "immediate");
  assert.equal(fc.until, "", "the match moment is the courier's; there is no honest time to give");
  assert.equal(freeCancelOf({ jobId: "J1", scheduleAt: "   " }, {}).kind, "immediate");
});

test("a deadline is never invented from an absence — no grace, no unreadable record, no line", () => {
  const pick = new Date(2026, 9, 2, 10, 0).toISOString();
  // No grace supplied. The pickup time is NOT the deadline, and defaulting to it would
  // promise 45 free minutes that do not exist — the difference between a free call-off
  // and a fee.
  assert.deepEqual(freeCancelOf({ jobId: "J1", scheduleAt: pick }, {}), { kind: "", until: "" });
  assert.deepEqual(freeCancelOf({ jobId: "J1", scheduleAt: pick }, { scheduledMs: 0 }), { kind: "", until: "" });
  // A pickup time that cannot be READ is not the same as no pickup time at all — the
  // first is a torn record, the second is an immediate booking, and they are not
  // allowed to wear the same answer.
  assert.equal(freeCancelOf({ jobId: "J1", scheduleAt: "next Tuesday" }, { scheduledMs: 1 }).kind, "");
  assert.deepEqual(freeCancelOf(null, { scheduledMs: 1 }), { kind: "", until: "" });
});

test("the deadline is read out with the moment it shuts, and past it the line says so", () => {
  // Moments are BUILT IN LOCAL TIME, the same choice fmtStamp makes and the same one
  // the test above it explains: this is what a person reads on their own phone.
  const pick = new Date(2026, 9, 2, 10, 0).toISOString();   // 2 Oct, 10:00 am; shuts 9:15 am
  const job = { jobId: "J1", scheduleAt: pick };
  const grace = { label: "Lalamove", scheduledMs: 45 * 60 * 1000 };
  const at = (h, m) => Date.parse(new Date(2026, 9, 2, h, m).toISOString());

  assert.equal(
    freeCancelLine(job, { ...grace, now: at(8, 30), today: "2026-10-02" }),
    "Free to call off until 9:15 am — Lalamove may charge a fee after that.",
  );
  assert.equal(
    freeCancelLine(job, { ...grace, now: at(9, 30), today: "2026-10-02" }),
    "Lalamove's free calling-off window shut at 9:15 am, so a fee may apply from here.",
  );
  // On any other day the moment is dated, or "9:15 am" would read as this morning.
  assert.equal(
    freeCancelLine(job, { ...grace, now: at(8, 30), today: "2026-10-03" }),
    "Free to call off until 2 Oct, 9:15 am — Lalamove may charge a fee after that.",
  );
  // The instant itself is read as SHUT. "Up to 45 minutes before" is the courier's own
  // wording, and at exactly 45 minutes she is on the line rather than inside it — the
  // conservative reading, because the fee is the half she cannot undo.
  const edge = freeCancelOf(job, grace).until;
  assert.match(freeCancelLine(job, { ...grace, now: Date.parse(edge), today: "2026-10-02" }), /window shut/);
});

test("an immediate trip is given the rule and not a made-up clock", () => {
  const said = freeCancelLine({ jobId: "J1" }, {
    label: "Lalamove", scheduledMs: 45 * 60 * 1000, now: Date.now(), today: "2026-10-02",
  });
  assert.match(said, /no pickup time to count back from/);
  assert.match(said, /Lalamove/);
  // No digit anywhere: the 20 minutes runs from a match this app never sees, so a time
  // on this line would be a promise it cannot keep.
  assert.equal(/\d/.test(said), false, "the rule is said, no clock is invented");
});

test("nothing readable means no line at all, rather than an empty sentence on the card", () => {
  assert.equal(freeCancelLine({ jobId: "J1", scheduleAt: "whenever" }, { label: "Lalamove", scheduledMs: 1 }), "");
  assert.equal(freeCancelLine(null, { label: "Lalamove", scheduledMs: 1 }), "");
});

// ── v302: WHO IS ON THE VAN ─────────────────────────────────────────────────
//
// Her report, and it was mine: "the point added still not able to appear on store" was the
// shop half, and this is the other half found while fixing it. A customer who chose to
// collect at Farlim never reached the run AT ALL. Choosing a Point in the shop leaves the
// order's `fulfillment` as "collect", and the run screen asked `fulfillment === "courier"` —
// so every real Point order was dropped before it could become a stop, and the screen said
// "Nothing to run yet" over a customer waiting for their bread.
//
// These two functions are the rule, and they live here so the run screen and the Delivery
// dates screen's "Run (N)" badge cannot read it two ways again.

const POINT = {
  id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik",
  receiver: "Aunty Lim", phone: "60123456789", feeRM: 0.5, paused: false,
  createdAt: "2026-10-12T00:00:00.000Z", place: { lat: 5.4, lng: 100.28, label: "Farlim" },
};
const withPoints = (points, extra = {}) => emptyState({ points, ...extra });

test("an order being COLLECTED at a Point still needs a van — the bread has to get there", () => {
  const st = withPoints([POINT]);
  assert.equal(needsVan(st, { id: "o1", fulfillment: "collect", pointId: "pt_farlim" }), true);
});

test("an order collected from the KITCHEN needs no van at all", () => {
  // The other half, and the half a careless fix breaks: she hands these over herself, and
  // sweeping them onto a run would price a vehicle for bread that never leaves the counter.
  assert.equal(needsVan(emptyState(), { id: "o1", fulfillment: "collect" }), false);
  assert.equal(needsVan(emptyState(), { id: "o1", fulfillment: "collect", pointId: "" }), false);
  // And a pointId naming a Point she does not have is the kitchen too — the same fallback the
  // shop applies, and the same one stopOf makes rather than sending a driver nowhere.
  assert.equal(needsVan(emptyState(), { id: "o1", fulfillment: "collect", pointId: "pt_gone" }), false);
});

test("a PAUSED Point still sends the van, and a DELETED one does not", () => {
  // Pausing decides what is OFFERED, never what an order already promised — the customer was
  // already told to go to Farlim and their bread still has to get there. A deleted Point has
  // no pin to give, so that order is the kitchen's again.
  const paused = withPoints([{ ...POINT, paused: true }]);
  assert.equal(needsVan(paused, { id: "o1", fulfillment: "collect", pointId: "pt_farlim" }), true);
  assert.equal(needsVan(withPoints([]), { id: "o1", fulfillment: "collect", pointId: "pt_farlim" }), false);
});

test("a courier order needs a van whether or not it names a Point", () => {
  const st = withPoints([POINT]);
  assert.equal(needsVan(st, { id: "o1", fulfillment: "courier" }), true);
  assert.equal(needsVan(st, { id: "o1", fulfillment: "courier", pointId: "pt_farlim" }), true);
  assert.equal(needsVan(st, null), false);
});

test("every customer at one Point shares ONE stop key, so the count cannot drift", () => {
  // The key is what the run's rows, its ticked set and the "Run (N)" badge all name a stop by.
  // Two customers at Farlim are one stop; two customers at their own doors are two.
  const st = withPoints([POINT]);
  const ain = { id: "o1", groupId: "g1", fulfillment: "collect", pointId: "pt_farlim" };
  const bala = { id: "o2", groupId: "g2", fulfillment: "collect", pointId: "pt_farlim" };
  const chandra = { id: "o3", groupId: "g3", fulfillment: "courier" };
  assert.equal(stopKeyOf(st, { orders: [ain] }), "point:pt_farlim");
  assert.equal(stopKeyOf(st, { orders: [bala] }), "point:pt_farlim");
  assert.equal(stopKeyOf(st, { orders: [ain] }), stopKeyOf(st, { orders: [bala] }),
    "one Point, one stop, however many customers collect there");
  assert.notEqual(stopKeyOf(st, { orders: [chandra] }), "point:pt_farlim",
    "a doorstep is its own stop");
  assert.notEqual(stopKeyOf(st, { orders: [chandra] }), stopKeyOf(st, { orders: [ain] }));
});

test("a stop key is safe on an empty or malformed group", () => {
  assert.equal(stopKeyOf(emptyState(), null), "group:");
  assert.equal(stopKeyOf(emptyState(), { orders: [] }), "group:");
});

// ── v304: WHOSE WINDOW A CUSTOMER IS TOLD ──────────────────────────────────
// Her choice: the collection window belongs to the PLACE. So an order collecting at a Point is
// promised the Point's own hours — and NOTHING when she has not set any. The van's arrival window
// is deliberately never used as a fallback: that is when the bread REACHES the Point, which is
// her business, and a customer told it would turn up as the van does.
//
// The confirmation, the four messages and the customer's track card all read this one function,
// so they cannot word the same promise three ways.

const POINT_WITH_HOURS = {
  id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik",
  receiver: "Aunty Lim", phone: "60123456789", feeRM: 0.5, paused: false,
  createdAt: "2026-08-12T00:00:00.000Z", collectWindow: "14:00-18:00",
  place: { lat: 5.4, lng: 100.28, label: "Farlim" },
};
const pointState = (points) => emptyState({ points });

test("an order collecting at a Point is told the Point's own hours (v304)", () => {
  const st = pointState([POINT_WITH_HOURS]);
  assert.equal(promisedWindowSuffix(st, { fulfillment: "collect", pointId: "pt_farlim" }),
    ", collect 2-6 pm");
});

test("⚠️ and NEVER the van's window, which is when the bread gets there (v304)", () => {
  // The order carries a deliveryWindow because the run that took the bread to the Point stamped
  // one (v302). The customer must not be told it: it is the van's arrival, not their hours, and
  // quoting both would be two different times in one message.
  const st = pointState([POINT_WITH_HOURS]);
  const onARun = { fulfillment: "collect", pointId: "pt_farlim", deliveryWindow: "10:00-12:00" };
  assert.equal(promisedWindowSuffix(st, onARun), ", collect 2-6 pm",
    "the Point's hours win, and the van's window is not mentioned at all");
});

test("a Point with no hours promises the day and nothing else (v304)", () => {
  const st = pointState([{ ...POINT_WITH_HOURS, collectWindow: "" }]);
  const onARun = { fulfillment: "collect", pointId: "pt_farlim", deliveryWindow: "10:00-12:00" };
  assert.equal(promisedWindowSuffix(st, onARun), "",
    "nothing rather than the van's window — an unset window is not a licence to promise the van's");
});

test("every other order is promised the trip's window, exactly as it always was (v304)", () => {
  const st = pointState([POINT_WITH_HOURS]);
  assert.equal(promisedWindowSuffix(st, { fulfillment: "courier", deliveryWindow: "14:00-17:00" }),
    ", 2-5 pm");
  assert.equal(promisedWindowSuffix(st, { fulfillment: "courier" }), "",
    "a courier order with no window booked promises no time");
  // A collection from the KITCHEN has no Point, so it is on the ordinary path too.
  assert.equal(promisedWindowSuffix(st, { fulfillment: "collect" }), "");
  // And a Point she has since deleted leaves the order with no hours rather than an error.
  assert.equal(promisedWindowSuffix(st, { fulfillment: "collect", pointId: "pt_gone" }), "");
  assert.equal(promisedWindowSuffix(st, null), "");
});

// ── ★★ THE VAN'S OWN DAY (v338) ──────────────────────────────────────────────
//
// Until this version an order had nowhere to record the day the VAN comes, so every promise to a
// customer glued the van's window onto the BAKE day. Her customer's own case: *"our bake day is
// Wednesday 7th Oct, customer want a lalamove delivery of Thursday morning 9am… the customer was
// confused, then asking whether the delivery date is wed or thurday."* `courierDay` is the order's own
// answer, typed by hand on the order card — never worked out.

test("the van's day and its window are said together (v338)", () => {
  const order = { fulfillment: "courier", courierDay: "2026-10-08", deliveryWindow: "09:00-11:00" };
  assert.equal(courierDeliveryText(order), "Thu, 8 Oct, 9-11 am",
    "the day the van comes, then the window it comes in — one promise, one line");
});

test("a day with no window still names the day (v338)", () => {
  assert.equal(courierDeliveryText({ fulfillment: "courier", courierDay: "2026-10-08" }), "Thu, 8 Oct",
    "more than the app could say before this version, when it knew only the window");
});

test("⚠️ no day leaves the text byte-for-byte what it always was (v338)", () => {
  // The window alone, exactly as v191 wrote it. This is why every order already in her records reads
  // unchanged, and why the existing card and message tests still pass untouched.
  assert.equal(courierDeliveryText({ fulfillment: "courier", deliveryWindow: "14:00-17:00" }), "2-5 pm");
  assert.equal(courierDeliveryText({ fulfillment: "courier" }), "");
  assert.equal(courierDeliveryText(null), "");
});

test("⚠️ a window that could not be typed is never published, day or no day (v338)", () => {
  // windowSuffix is the PUBLISHING gate and answers "" for an end before its start. The day must not
  // smuggle a broken promise out beside it.
  assert.equal(
    courierDeliveryText({ fulfillment: "courier", courierDay: "2026-10-08", deliveryWindow: "17:00-09:00" }),
    "Thu, 8 Oct");
});

test("⚠️ a POINT's hours are not the van's day, even on an order carrying one (v338)", () => {
  // The new day is when the VAN comes, and a Point order has no van reaching the customer at all.
  // `promisedWindowSuffix` owns that answer, and it still wins.
  const st = pointState([POINT_WITH_HOURS]);
  const onARun = { fulfillment: "collect", pointId: "pt_farlim", courierDay: "2026-10-08" };
  assert.equal(promisedWindowSuffix(st, onARun), ", collect 2-6 pm");
});

test("courierDayOf reads a saved order AND a card's own draft (v338)", () => {
  // A saved order carries it flat; the ＋ New order card holds it in `courierWhen` until it is saved.
  // ONE reader for both shapes, because the price section is handed one or the other depending on the
  // card it stands in — three call sites deciding for themselves is how two boxes come to disagree.
  assert.equal(courierDayOf({ courierDay: "2026-10-08" }), "2026-10-08");
  assert.equal(courierDayOf({ courierWhen: { day: "2026-10-08" } }), "2026-10-08");
  assert.equal(courierDayOf({}), "");
  assert.equal(courierDayOf(null), "");
  assert.equal(courierDayOf({ courierDay: "   " }), "", "whitespace is not a day");
});

test("⚠️ NOTHING is ever worked out from the bake day (v338)", () => {
  // THE TRAP THIS VERSION EXISTS TO CLOSE. An order with a bake day and no courier day must NOT be
  // handed one — her rule: *"bake plan is just a plan… it is good not to tie our own hand down."*
  const bakeOnly = { fulfillment: "courier", deliveryDateId: "d1", deliveryDate: "2026-10-07" };
  assert.equal(courierDayOf(bakeOnly), "", "the bake day is not the van's day");
  assert.equal(courierDeliveryText(bakeOnly), "", "and it may not be published as one");
});

// ── ★★ THE PICKUP TIME, AND WHAT IT IS NOT (v341) ────────────────────────────
//
// Her correction: *"for courier lalamove, there is no delivery window open and delivery window closes
// promise… Pickup time is something user should specify."* A pickup time is when the van is at HER
// door. A delivery window is what a CUSTOMER is promised. **The two are different facts and must never
// become one field** — that is the whole of this version.

test("pickupTimeOf reads a saved order AND a card's own draft (v341)", () => {
  assert.equal(pickupTimeOf({ pickupTime: "09:00" }), "09:00");
  assert.equal(pickupTimeOf({ courierWhen: { pickup: "08:30" } }), "08:30");
  assert.equal(pickupTimeOf({ pickupTime: "   " }), "", "whitespace is not a time");
  assert.equal(pickupTimeOf({}), "");
  assert.equal(pickupTimeOf(null), "");
});

test("⚠️ A PICKUP TIME IS NEVER PUBLISHED AS THE CUSTOMER'S PROMISE (v341)", () => {
  // The whole point of her correction. A van collecting from her kitchen at nine is at the CUSTOMER's
  // door later than nine, so nine is not theirs to be told. Everything a customer reads passes through
  // promisedWindowSuffix (which reads the window, never this), so this value must not reach any of it.
  const st = emptyState();
  const withPickup = { fulfillment: "courier", pickupTime: "09:00", courierDay: "2026-10-08" };

  assert.equal(promisedWindowSuffix(st, withPickup), "",
    "no window was promised, so nothing is — a pickup time is not a stand-in for one");
  assert.equal(windowSuffix(withPickup), "", "and the window suffix itself never sees it");
  assert.equal(courierDeliveryText(withPickup), "Thu, 8 Oct",
    "the day is named, and no time is glued to it");
});

test("a pickup time does not disturb the window when there IS one (v341)", () => {
  // A run with several stops still promises its window, and a pickup time riding on the same order
  // must leave that promise exactly as it was.
  const st = emptyState();
  const both = {
    fulfillment: "courier", pickupTime: "09:00", courierDay: "2026-10-08", deliveryWindow: "14:00-17:00",
  };
  assert.equal(promisedWindowSuffix(st, both), ", 2-5 pm", "the customer's window is unchanged");
  assert.equal(courierDeliveryText(both), "Thu, 8 Oct, 2-5 pm", "and it rides with the van's day");
});
