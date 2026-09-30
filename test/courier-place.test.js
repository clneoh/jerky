// test/courier-place.test.js — where a courier trip starts and ends (v188,
// 25 Sep 2026).
//
// The whole of this file turns on one sentence from the courier API: it wants a
// POINT, not an address. Everything that can go wrong here goes wrong the same way
// — a place that is not a place reaches the API, and what comes back is a price for
// a trip she is not taking, said in a code she cannot read. So the tests below are
// almost all about one question: does a half-known place read as NOT KNOWN.
//
// Three of them are worth naming before you read them, because each is a real way a
// doorstep gets lost:
//
//   • a latitude with no longitude — an interrupted paste — must be refused, not
//     rounded to zero, which would put the pin in the Gulf of Guinea;
//   • "5,100" must not parse as a coordinate. It is a price, or a quantity, or a
//     date, and reading it as a point is a wrong doorstep with no complaint;
//   • a pin saved for a customer must survive a profile EDIT. profiles.js carries
//     two field lists for folding duplicate records, and a new field that is on
//     neither is silently dropped the first time two records for one person meet.
//
// Pure: no DOM, no fetch. `save` is called and swallowed (state.js catches the
// missing localStorage under Node), so what these tests read is the STATE the
// functions leave behind rather than a stored copy of it.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  validPlace, pickupPlace, pickupAddress, dropPlaceOf, dropAddress,
  setDropPlace, setPickupPlace, latLngText, fmtPlace, splitLabel, parseCoords, placeProblem,
  customerPlaceOf, doorFromOf, doorIsTheirs, doorMayBeReset, doorSpotOf, doorSwitchOf,
  resetReplacesAChoice,
  houseNotIn, roadNotHouse, doorRoadOf, doorAgainstOf, sameDoor,
} = await import("../admin/js/courier_place.js");
const { canonicaliseCustomers } = await import("../admin/js/profiles.js");

// One order from one customer, with a Penang address and a Malaysian number.
function order(extra = {}) {
  return {
    id: "ordaaa111",
    customerName: "Mei Ling",
    whatsapp: "0169601268",
    address: "12 Jalan Bunga, 10450 Penang",
    deliveryDate: "2026-09-25",
    ...extra,
  };
}

function state(extra = {}) {
  return {
    settings: { currency: "RM", mailingAddress: "8 Lebuh Pantai, 10300 Penang" },
    orders: [order()],
    customers: [],
    ...extra,
  };
}

// ── what counts as a point ────────────────────────────────────────────────

test("a place needs BOTH numbers — a latitude alone is not a point", () => {
  assert.equal(validPlace({ lat: 5.4141 }), null);
  assert.equal(validPlace({ lng: 100.3288 }), null);
  assert.deepEqual(validPlace({ lat: 5.4141, lng: 100.3288 }), { lat: 5.4141, lng: 100.3288, label: "" });
  assert.deepEqual(validPlace({ lat: "5.4141", lng: "100.3288" }), { lat: 5.4141, lng: 100.3288, label: "" });
});

test("numbers that are not numbers are not a point", () => {
  assert.equal(validPlace({ lat: "5.41abc", lng: 100 }), null);
  assert.equal(validPlace({ lat: NaN, lng: 100 }), null);
  assert.equal(validPlace({ lat: null, lng: 100 }), null);
  assert.equal(validPlace(null), null);
  assert.equal(validPlace("5.4,100.3"), null);
});

test("a point off the planet is refused rather than sent to be refused later", () => {
  // Lalamove would take 999999 and answer with something. "The pin is nonsense,
  // put it again" is the only useful sentence, and it has to come from here.
  assert.equal(validPlace({ lat: 91, lng: 100 }), null);
  assert.equal(validPlace({ lat: 5, lng: 181 }), null);
  assert.equal(validPlace({ lat: -91, lng: 100 }), null);
  assert.equal(validPlace({ lat: 90, lng: 180 }).lat, 90); // the corner itself is on the planet
});

// ── the three answers, in order ───────────────────────────────────────────

test("a saved doorstep is used and never looked up again", () => {
  const s = state();
  assert.equal(dropPlaceOf(s, order()), null);
  const saved = setDropPlace(s, order(), { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
  assert.equal(saved.lat, 5.4141);
  assert.deepEqual(dropPlaceOf(s, order()), { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" });
});

test("the pin follows the PERSON, not the order — a second order is already pinned", () => {
  const s = state();
  setDropPlace(s, order(), { lat: 5.4141, lng: 100.3288 });
  const later = order({ id: "ordbbb222", deliveryDate: "2026-10-02" });
  assert.ok(dropPlaceOf(s, later), "the same number pins the same door");
});

test("pinning a customer who has no profile row creates one shaped like the others", () => {
  const s = state();
  assert.equal(s.customers.length, 0);
  setDropPlace(s, order(), { lat: 5.4141, lng: 100.3288 });
  assert.equal(s.customers.length, 1);
  const row = s.customers[0];
  assert.match(row.id, /^cus_/);
  assert.equal(row.key, "60169601268");
  assert.equal(row.name, "Mei Ling");
  assert.ok(row.createdAt, "a profile row with no createdAt would sort oddly against the others");
});

test("an order that keys to nobody is refused quietly — no row nobody can find again", () => {
  const s = state();
  const anonymous = { id: "", customerName: "", whatsapp: "" };
  assert.equal(setDropPlace(s, anonymous, { lat: 5.4, lng: 100.3 }), null);
  assert.equal(s.customers.length, 0);
});

test("a refusal writes nothing at all", () => {
  const s = state();
  // A place that is not a place must not create the profile row either — the row
  // would be empty forever and the customer would look pinned and not be.
  setDropPlace(s, order(), { lat: 5.4141 });
  assert.equal(s.customers.length, 0);
});

test("the bakery's own pin lives in settings and survives a re-pin", () => {
  const s = state();
  assert.equal(pickupPlace(s), null);
  setPickupPlace(s, { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" });
  assert.deepEqual(pickupPlace(s).label, "8 Lebuh Pantai");
  setPickupPlace(s, { lat: 5.42, lng: 100.33, label: "moved" });
  assert.equal(pickupPlace(s).lat, 5.42);
  assert.equal(pickupPlace(s).label, "moved");
});

test("the address to look up is the one she already typed for the label sheet", () => {
  assert.equal(pickupAddress(state()), "8 Lebuh Pantai, 10300 Penang");
  assert.equal(pickupAddress({ settings: {} }), "");
  assert.equal(dropAddress(order()), "12 Jalan Bunga, 10450 Penang");
  assert.equal(dropAddress({}), "");
});

// ── the pin survives the profile machinery ────────────────────────────────

test("a pin survives canonicaliseCustomers folding two records of one person", () => {
  // The list of fields a fold copies is written out by hand in profiles.js, and a
  // field on neither list is dropped the first time two records meet. This is the
  // test that fails if `place` is ever taken off those lists.
  const s = state();
  s.customers = [
    { id: "cus_1", key: "60169601268", name: "Mei Ling", whatsapp: "60169601268",
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      place: { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" } },
    { id: "cus_2", key: "60169601268", name: "Mei Ling", whatsapp: "60169601268",
      createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
  ];
  canonicaliseCustomers(s);
  assert.equal(s.customers.length, 1, "the two records fold into one");
  assert.equal(s.customers[0].place.lat, 5.4141, "the door that was known must not be lost in the fold");
});

test("a pin is folded in whichever record happened to carry it", () => {
  const s = state();
  s.customers = [
    { id: "cus_1", key: "60169601268", name: "Mei Ling", whatsapp: "60169601268",
      createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
    { id: "cus_2", key: "60169601268", name: "Mei Ling", whatsapp: "60169601268",
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      place: { lat: 5.4141, lng: 100.3288 } },
  ];
  canonicaliseCustomers(s);
  assert.equal(s.customers.length, 1);
  assert.equal(s.customers[0].place.lng, 100.3288, "the newer record wins the row, but the only pin must still travel");
});

// ── numbers she pasted ────────────────────────────────────────────────────

test("coordinates come back out of the shapes she would actually copy", () => {
  const want = { lat: 5.4141, lng: 100.3288 };
  assert.deepEqual(parseCoords("5.4141,100.3288"), want);
  assert.deepEqual(parseCoords("5.4141, 100.3288"), want);
  assert.deepEqual(parseCoords("  5.4141 , 100.3288  "), want);
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/X/@5.4141,100.3288,17z"), want);
  assert.deepEqual(parseCoords("https://maps.google.com/?q=5.4141,100.3288"), want);
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/X/data=!3d5.4141!4d100.3288"), want);
  assert.deepEqual(parseCoords("https://www.google.com/maps/dir/?destination=5.4141,100.3288"), want);
  assert.deepEqual(parseCoords("https://maps.apple.com/?ll=5.4141,100.3288"), want);
});

test("negative coordinates survive — half the world is south and west", () => {
  assert.deepEqual(parseCoords("-5.4141,-100.3288"), { lat: -5.4141, lng: -100.3288 });
  assert.deepEqual(parseCoords("@-5.4141,-100.3288,17z"), { lat: -5.4141, lng: -100.3288 });
});

test('"5,100" is not a coordinate — a price or a quantity must never become a doorstep', () => {
  // The one guard that keeps a bare paste honest: a decimal point is required. The
  // Gulf of Guinea is at 5,100 and a pin there is a wrong door with no complaint.
  assert.equal(parseCoords("5,100"), null);
  assert.equal(parseCoords("12, 25"), null);
  assert.equal(parseCoords("2026,09"), null);
});

test("nonsense is refused rather than half-read", () => {
  assert.equal(parseCoords(""), null);
  assert.equal(parseCoords(null), null);
  assert.equal(parseCoords("Penang"), null);
  assert.equal(parseCoords("5.4141"), null);
  assert.equal(parseCoords("91.0,100.3"), null, "off the planet");
  assert.equal(parseCoords("5.4,181.0"), null);
});

test("a URL carrying a bare pair is read as the URL, not as the pair", () => {
  // Order matters: the URL forms are tried first. If the bare form ran first it
  // would still find these, but a URL is the shape with the most ways to be
  // slightly different, so it is read on its own terms.
  const got = parseCoords("https://www.google.com/maps/@5.4141,100.3288,17z");
  assert.deepEqual(got, { lat: 5.4141, lng: 100.3288 });
});

// ── saying it on screen ───────────────────────────────────────────────────

test("a point is said with the words it was pinned with, or the numbers", () => {
  assert.equal(fmtPlace({ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" }), "12 Jalan Bunga");
  assert.equal(fmtPlace({ lat: 5.4141, lng: 100.3288 }), "5.41410, 100.32880");
  assert.equal(fmtPlace(null), "not pinned yet");
  assert.equal(fmtPlace(undefined, "no spot"), "no spot");
});

test("the pair as the API wants it", () => {
  assert.equal(latLngText({ lat: 5.4141, lng: 100.3288 }), "5.4141,100.3288");
  assert.equal(latLngText(null), "");
  assert.equal(latLngText({ lat: 5.4141 }), "");
});

// ── what a trip is still missing ──────────────────────────────────────────

test("nothing missing means no problem is reported", () => {
  const s = state();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  setDropPlace(s, order(), { lat: 5.41, lng: 100.32 });
  assert.equal(placeProblem(s, order()), null);
});

test("an unpinned bakery is named before anything else — the trip has no start", () => {
  const s = state();
  const p = placeProblem(s, order());
  assert.equal(p.need, "pickup");
  assert.match(p.say, /Settings/);
});

test("a bakery with no address to look up asks her to pin rather than to look", () => {
  const s = state({ settings: { currency: "RM", mailingAddress: "" } });
  const p = placeProblem(s, order());
  assert.equal(p.need, "pickup");
  assert.match(p.say, /Pin your pickup spot in Settings/);
});

test("a customer with no doorstep is named second, and told which way to fix it", () => {
  const s = state();
  setPickupPlace(s, { lat: 5.4, lng: 100.3 });
  const withAddress = placeProblem(s, order());
  assert.equal(withAddress.need, "drop");
  assert.match(withAddress.say, /pin on the map/);

  const noAddress = placeProblem(s, order({ address: "" }));
  assert.equal(noAddress.need, "drop");
  assert.match(noAddress.say, /no delivery address/);
});

// ── the customer's own pin, which is a SUGGESTION (v197) ──────────────────
//
// The whole feature turns on one word, so these tests are about that word: what the
// customer dropped on the shop page is read, offered, and — until she presses —
// never the door anything uses. `dropPlaceOf` is what every quote, booking and
// charge asks, and the pin the customer dropped must not appear there on its own.

test("the customer's own pin is read off the order, and is not a doorstep", () => {
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33, label: "their door", at: "2026-09-25T10:00:00Z" } });
  assert.deepEqual(customerPlaceOf(pinned), { lat: 5.42, lng: 100.33, label: "their door" });
  // THE line that makes it a suggestion: the door the app drives to is still unknown
  // until she accepts it.
  assert.equal(dropPlaceOf(s, pinned), null);
});

test("an order nobody pinned has no suggestion at all", () => {
  assert.equal(customerPlaceOf(order()), null);
  assert.equal(customerPlaceOf(order({ customerPlace: null })), null);
  assert.equal(customerPlaceOf(null), null);
});

test("a pin that is not a pin is not a suggestion either", () => {
  // This is the one field on the order that a CUSTOMER wrote, so it arrives as
  // untrusted as anything the shop posts. Half-written, off the planet and
  // non-numeric all read as "they pinned nothing", which is the same answer as a
  // courier customer who just typed their address.
  assert.equal(customerPlaceOf(order({ customerPlace: { lat: 5.42 } })), null);
  assert.equal(customerPlaceOf(order({ customerPlace: { lat: null, lng: 100 } })), null);
  assert.equal(customerPlaceOf(order({ customerPlace: { lat: 999, lng: 100 } })), null);
  assert.equal(customerPlaceOf(order({ customerPlace: "5.42,100.33" })), null);
});

// ── WHICH door is the door (v209) ─────────────────────────────────────────
//
// Her instruction, 27 Sep 2026, after five reports of "the pin still wrong":
// "Their own pin — always." Where the customer dropped a pin, that pin is the point a
// price is asked for and a driver is sent to, and the door she keeps is the fallback.
//
// The one exception is her own hand. She is the only one who knows the door, and a
// correction she made by hand that snapped back on the next repaint would be a control
// moving under her finger — so a door SHE placed wins, and the switch offers their pin.

test("their own pin IS the door when she keeps nothing for them", () => {
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  assert.deepEqual(doorSpotOf(s, pinned), { lat: 5.42, lng: 100.33, label: "" });
  // Nothing to switch TO — there is only one door on this order.
  assert.equal(doorSwitchOf(s, pinned), null);
});

test("their own pin beats a door a LOOKUP found for them — the bug she reported", () => {
  // This is the order she was pointing at: a door kept by an older version from a map
  // lookup, sitting in a different town, while the customer's own pin — dropped at the
  // door — was ignored. A lookup answers the wrong town as easily as the right one.
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(s, pinned, { lat: 3.1, lng: 101.6, label: "the wrong town" }, "lookup");
  assert.deepEqual(doorSpotOf(s, pinned), { lat: 5.42, lng: 100.33, label: "" });

  // And a door saved BEFORE v209 carries no record of how it was made, so it reads as
  // not-her-hand and loses too. That is what repairs the orders already on her phone.
  const old = state();
  const oldPinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(old, oldPinned, { lat: 3.1, lng: 101.6, label: "the wrong town" });
  old.customers[0].place.from = undefined; // as an older version left it
  assert.equal(doorFromOf(old, oldPinned), "");
  assert.deepEqual(doorSpotOf(old, oldPinned), { lat: 5.42, lng: 100.33, label: "" });
});

test("a door SHE placed by hand is not moved by their pin", () => {
  // The carve-out. Without it, a pin she corrected by hand would snap back the moment
  // the card repainted, which is a control moving under her finger.
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(s, pinned, { lat: 5.4, lng: 100.3, label: "the door she checked" }, "hand");
  assert.equal(doorFromOf(s, pinned), "hand");
  assert.deepEqual(doorSpotOf(s, pinned), { lat: 5.4, lng: 100.3, label: "the door she checked" });
  // …and the switch now offers THEIR pin, because that is the door out of use.
  const offer = doorSwitchOf(s, pinned);
  assert.ok(offer, "her door must not hide the customer's own pin");
  assert.equal(offer.which, "customer");
  assert.deepEqual(offer.place, { lat: 5.42, lng: 100.33, label: "" });
  assert.equal(offer.replacing.label, "the door she checked");
});

test("the switch names the OTHER door, whichever of the two is out of use", () => {
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });

  // A lookup's door is in force nowhere, so their pin is the door and the switch
  // offers the kept one.
  setDropPlace(s, pinned, { lat: 5.4, lng: 100.3, label: "found by lookup" }, "lookup");
  let offer = doorSwitchOf(s, pinned);
  assert.equal(offer.which, "kept");
  assert.equal(offer.place.label, "found by lookup");
  assert.deepEqual(offer.replacing, { lat: 5.42, lng: 100.33, label: "" });

  // Press what it offers and the two swap over — the control never offers the door
  // that is already in force.
  setDropPlace(s, pinned, offer.place, "hand");
  assert.deepEqual(doorSpotOf(s, pinned), { lat: 5.4, lng: 100.3, label: "found by lookup" });
  offer = doorSwitchOf(s, pinned);
  assert.equal(offer.which, "customer");
  assert.deepEqual(offer.place, { lat: 5.42, lng: 100.33, label: "" });
});

test("taking up their own pin stays THEIR pin, so a later re-pin still wins", () => {
  // The bulk run and the price button both COPY their pin into the profile so it is not
  // looked up again. That row is still theirs, and must keep losing to them — otherwise
  // a customer who moves house could never correct it.
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(s, pinned, customerPlaceOf(pinned), "customer");
  assert.equal(doorFromOf(s, pinned), "customer");
  const moved = order({ customerPlace: { lat: 5.43, lng: 100.34 } });
  assert.deepEqual(doorSpotOf(s, moved), { lat: 5.43, lng: 100.34, label: "" });
});

test("a pin nudged a few metres is the same door, so the switch does not appear", () => {
  // Leaflet hands back a slightly different number every time a pin is re-dropped in
  // the same spot. Offering the same door again because it moved 8 metres would be a
  // press that does nothing, forever.
  const s = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(s, pinned, { lat: 5.42005, lng: 100.33005 }, "hand");
  assert.equal(doorSwitchOf(s, pinned), null);
  // A different house down the road is not the same door.
  setDropPlace(s, pinned, { lat: 5.4202, lng: 100.33 }, "hand");
  assert.ok(doorSwitchOf(s, pinned));
});

test("which of the two doors is in force is ONE answer, asked once", () => {
  // doorIsTheirs is what doorSpotOf and doorSwitchOf are both built from, and what the card's
  // wording asks — so the point, the press and the words cannot drift apart. A door from a
  // LOOKUP is not theirs, which is what keeps the card calling it "the door you keep for her".
  const s = state();
  const o = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  assert.equal(doorIsTheirs(s, o), true, "their pin, and nothing kept — theirs");
  assert.equal(doorIsTheirs(s, order()), false, "no pin at all — nobody's");
  setDropPlace(s, o, { lat: 3.1, lng: 101.6 }, "lookup");
  assert.equal(doorIsTheirs(s, o), true, "a lookup's door is not her hand, so their pin still wins");
  setDropPlace(s, o, { lat: 3.1, lng: 101.6 }, "hand");
  assert.equal(doorIsTheirs(s, o), false, "but a door she placed herself is hers");
});

test("HOW a door got there survives a round trip", () => {
  const s = state();
  const o = order();
  assert.equal(doorFromOf(s, o), "", "no door at all reads as no record, not as hand");
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288 });
  assert.equal(doorFromOf(s, o), "hand", "a drag or a map pick is her own hand by default");
  assert.ok(s.customers[0].place.at, "and it is stamped when it was kept");
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288 }, "lookup");
  assert.equal(doorFromOf(s, o), "lookup");
});

// ── the two lines a match wears in the chooser (v198) ─────────────────────
//
// The lookup offers several matches now, so each one is a row with a name on its first
// line and a place on its second. The cut is the first comma and nothing cleverer, which
// is exact for Photon — whose labels are composed "name, town, postcode" by the courier
// function — and only passable for Nominatim, whose labels lead with whatever is most
// specific, often a house number. That is left alone on purpose; see splitLabel.

test("a label is cut at its first comma, into what the place is and where it is", () => {
  assert.deepEqual(splitLabel("Chulia Street, George Town, 10200"),
    { title: "Chulia Street", sub: "George Town, 10200" });
  assert.deepEqual(splitLabel("Road, 10200"), { title: "Road", sub: "10200" });
  assert.deepEqual(splitLabel("Chulia Street"), { title: "Chulia Street", sub: "" });
});

test("a Nominatim label reads poorly and is still cut in one piece, never in two halves", () => {
  // The honest shape of the fallback: Nominatim's display_name puts the house number
  // first, so the title of this row is "12". Ugly, and correct — the alternative is to
  // stop storing display_name, which is the label already saved on customers she has
  // pinned, so tidying a fallback would rewrite her own records.
  assert.deepEqual(splitLabel("12, Jalan Bunga, Taman Foo, 10450 George Town, Penang, Malaysia"),
    { title: "12", sub: "Jalan Bunga, Taman Foo, 10450 George Town, Penang, Malaysia" });
});

test("a label with nothing in it is two empty lines, not the word null and not NaN", () => {
  // The chooser draws what this returns, and this app has shipped a printed "null" to
  // her screen before. An absent label must come back as absence.
  assert.deepEqual(splitLabel(""), { title: "", sub: "" });
  assert.deepEqual(splitLabel("   "), { title: "", sub: "" });
  assert.deepEqual(splitLabel(null), { title: "", sub: "" });
  assert.deepEqual(splitLabel(undefined), { title: "", sub: "" });
  assert.deepEqual(splitLabel(0), { title: "0", sub: "" }, "a number is a name she can read, not a blank row");
});

test("stray spaces around the cut are trimmed, so no row starts with a gap", () => {
  assert.deepEqual(splitLabel("  Road ,  Town  "), { title: "Road", sub: "Town" });
  assert.deepEqual(splitLabel("Road,"), { title: "Road", sub: "" }, "a trailing comma leaves no empty second line");
  assert.deepEqual(splitLabel(", Town"), { title: "", sub: "Town" }, "and a leading one leaves the title empty rather than throwing it away");
});

// ── "is this the house, or only the road" (v211) ──────────────────────────
//
// Her report: she types "23 Jalan Seang Tek" and the only thing on offer is "Seang Tek
// Road, George Town, 10400". Seang Tek is a long road, so the pin is not her door, and
// nothing on the screen said so. Nothing in a geocoder's reply says "this is only a road"
// either, so the question is asked the other way round: does the answer contain the number
// she typed. What follows is the whole of that test, including the ways it must stay quiet.

const ROAD = { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town, 10400" };

test("a house number the answer does not contain is the one thing worth saying", () => {
  assert.equal(houseNotIn("23 Jalan Seang Tek", ROAD), "23");
});

test("when the answer DOES contain the number, the house was found and nothing is said", () => {
  assert.equal(houseNotIn("23 Jalan Seang Tek",
    { lat: 5.4141, lng: 100.3288, label: "23, Jalan Seang Tek, George Town, 10400" }), "");
  // The number in the middle of a longer name is still the number.
  assert.equal(houseNotIn("12 Jalan Bunga",
    { lat: 5.41, lng: 100.32, label: "Block 12, Jalan Bunga, 10450 Penang" }), "");
});

test("a number is matched as a WHOLE, so 10400 cannot stand in for 23", () => {
  // The postcode contains "10", "40", "400" and more. A substring test would call this a
  // match and hand her the road as if it were the house.
  assert.equal(houseNotIn("10 Jalan Seang Tek", ROAD), "10");
  assert.equal(houseNotIn("400 Jalan Seang Tek", ROAD), "400");
  assert.equal(houseNotIn("23 Jalan Seang Tek",
    { lat: 5.41, lng: 100.32, label: "Jalan Seang Tek 123, George Town" }), "23",
  "and 123 is a different house, not this one");
});

test("an address with no number in it asks for a road, and a road is what it gets", () => {
  // Not a special case: the same sentence read the other way. She can still look up a
  // street she has no number for, and nothing is claimed about a house she never named.
  assert.equal(houseNotIn("Jalan Seang Tek, George Town", ROAD), "");
  assert.equal(houseNotIn("", ROAD), "");
  assert.equal(houseNotIn(null, ROAD), "");
  // And a typed postcode is not a house number, or "23 Jalan Seang Tek, 10400" would be
  // answered by its own postcode.
  assert.equal(houseNotIn("Jalan Seang Tek, 10400", ROAD), "");
  assert.equal(houseNotIn("23 Jalan Seang Tek, 10400", ROAD), "23");
});

test("a house number with a letter on it is read whole, so 23A is not 23", () => {
  assert.equal(houseNotIn("23A Jalan Bunga", { lat: 5.41, lng: 100.32, label: "23A Jalan Bunga, Penang" }), "");
  assert.equal(houseNotIn("23A Jalan Bunga", { lat: 5.41, lng: 100.32, label: "23 Jalan Bunga, Penang" }), "23a",
    "a different door with the same number is still a miss");
});

test("an answer with no words at all cannot have found the house", () => {
  assert.equal(houseNotIn("23 Jalan Seang Tek", { lat: 5.4141, lng: 100.3288, label: "" }), "23");
  assert.equal(houseNotIn("23 Jalan Seang Tek", { lat: 5.4141, lng: 100.3288 }), "23");
});

test("the sentence is one sentence, and the short form is the same fact", () => {
  assert.equal(roadNotHouse("23"), "The lookup found the road, not number 23 — drag the pin to the door.");
  assert.equal(roadNotHouse("23", { short: true }), "the road, not number 23");
});

test("the number a lookup missed rides with the door, and only a lookup writes one", () => {
  const s = state();
  const o = order();
  assert.equal(doorRoadOf(s, o), "", "no door at all, nothing to say about it");
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "lookup", "12");
  assert.equal(doorRoadOf(s, o), "12");
  // The door is written whole every time, so a drag by her own hand takes the stamp with
  // it: the old point is gone and so is the fact about it.
  setDropPlace(s, o, { lat: 5.42, lng: 100.33, label: o.address });
  assert.equal(doorRoadOf(s, o), "", "her own hand is the correction, and leaves no road behind");
  assert.equal(doorFromOf(s, o), "hand");
});


// ── asking the address up again (v213) ────────────────────────────────────
//
// A door a lookup wrote is not a fact about the world. It is the best answer ONE service had
// on the day it was asked, and for a Malaysian house number that answer is usually just the
// road. v212 added a second, better service — but it is only ever asked when there is NO door
// yet, so every customer pinned before it keeps the old answer for good and the key she has
// now set would look like it had changed nothing at all. This is the way out, and the rule
// below is the whole of who it may be offered to.

test("the second ask is offered where a LOOKUP wrote the door, and where nothing recorded how (v213)", () => {
  const s = state();
  const o = order();
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "lookup", "12");
  assert.equal(doorMayBeReset(s, o), true, "a lookup's answer is a guess, and a guess may be asked again");

  // A door saved before v209 carries no record of how it was made. The only writer that ran
  // by itself was the lookup, so this is the grey area — and offering a press in it is safe
  // precisely because nothing happens without one.
  const old = state();
  const oldOrder = order();
  setDropPlace(old, oldOrder, { lat: 5.4141, lng: 100.3288, label: oldOrder.address });
  old.customers[0].place.from = undefined; // as an older version left it
  assert.equal(doorFromOf(old, oldOrder), "");
  assert.equal(doorMayBeReset(old, oldOrder), true, "no record of how, so it may be asked again");
});

test("the press is offered over a RESET so a reset that landed on the road can be pressed again (v238)", () => {
  // The whole reason "reset" is not spelled "hand": a door she placed by hand is never
  // offered up for replacement, so writing a reset as "hand" would leave a reset that
  // found only the street with no second press and no way out.
  const s = state();
  const o = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "reset", "12", { lat: 5.42, lng: 100.33 });
  assert.equal(doorFromOf(s, o), "reset");
  assert.equal(doorMayBeReset(s, o), true, "a reset is a fresh guess too, and may be asked again");
});

test("the press IS offered over a door she placed by hand (v239 — this is what v238 got wrong)", () => {
  // v213 withheld the press here to protect a correction from a geocoder's guess, and v238
  // kept that. Her second report is why it had to go: a drag is the ONLY thing this card ever
  // offered her, so a drag is what she does — and it writes `from: "hand"`, which the press
  // then refused for good. Every customer whose pin she had ever corrected by hand showed
  // "Move this pin" and nothing else, and v238 looked like it had changed nothing.
  //
  // The protection is not gone, it has moved: the door is still never replaced WITHOUT BEING
  // ASKED. See resetReplacesAChoice below, which is the confirmation's own question.
  const s = state();
  const o = order();
  setDropPlace(s, o, { lat: 5.4, lng: 100.3, label: "the door she checked" }, "hand");
  assert.equal(doorMayBeReset(s, o), true, "there is a door, so there is a door to replace");
});

test("a door may be reset exactly when there is a door — nothing to replace means no press (v239)", () => {
  // The one question this function answers now. It used to answer "do we approve of how this
  // door got here", which is a different question, and answering it hid the press in the state
  // she works in.
  const bare = state();
  const o = order();
  assert.equal(doorSpotOf(bare, o), null, "no pin and no customer pin — there is no door yet");
  assert.equal(doorMayBeReset(bare, o), false,
    "nothing to replace, and the price press looks one up by itself");
});

test("the press ASKS FIRST where it would replace a person's choice, and never where it replaces our own guess (v239)", () => {
  // The confirmation's one question, and the button's label paints itself from the same
  // function — so a press reading "Reset the pin from the address" is always a press that asks.
  const theirs = state();
  const theirsOrder = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(theirs, theirsOrder, { lat: 5.4141, lng: 100.3288, label: theirsOrder.address }, "lookup");
  assert.equal(doorIsTheirs(theirs, theirsOrder), true);
  assert.equal(resetReplacesAChoice(theirs, theirsOrder), true, "a fact from the customer is asked about");

  const hand = state();
  const handOrder = order();
  setDropPlace(hand, handOrder, { lat: 5.4, lng: 100.3, label: "the door she checked" }, "hand");
  assert.equal(resetReplacesAChoice(hand, handOrder), true, "and so is her own correction on the map");

  const looked = state();
  const lookedOrder = order();
  setDropPlace(looked, lookedOrder, { lat: 5.4141, lng: 100.3288, label: lookedOrder.address }, "lookup");
  assert.equal(resetReplacesAChoice(looked, lookedOrder), false,
    "a look-up's answer is our own guess, and a fresher guess is what this press has always been");

  const again = state();
  const againOrder = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(again, againOrder, { lat: 5.4141, lng: 100.3288, label: againOrder.address },
    "reset", "12", { lat: 5.42, lng: 100.33 });
  assert.equal(resetReplacesAChoice(again, againOrder), false,
    "and a reset may be pressed again without being made to justify itself twice");

  const old = state();
  const oldOrder = order();
  setDropPlace(old, oldOrder, { lat: 5.4141, lng: 100.3288, label: oldOrder.address });
  old.customers[0].place.from = undefined; // as an older version left it
  assert.equal(resetReplacesAChoice(old, oldOrder), false,
    "a door saved before v209 is a look-up's answer, which is the only thing that wrote one by itself");
});

test("a copy of their pin is asked about even when the order row no longer carries it (v239)", () => {
  // The one case where "is their pin the door" and "how did this door get here" disagree: the
  // profile keeps a copy written while the order still had a `customerPlace`, and the order has
  // since lost it. `doorIsTheirs` says no — there is nothing to compare against — but the door
  // is still theirs, so the confirmation must not call it the door she placed by hand.
  const s = state();
  const o = order(); // no customerPlace on the row
  setDropPlace(s, o, { lat: 5.42, lng: 100.33, label: o.address }, "customer");
  assert.equal(doorIsTheirs(s, o), false, "nothing on the row to call theirs");
  assert.equal(doorFromOf(s, o), "customer", "and the door still says where it came from");
  assert.equal(doorMayBeReset(s, o), true, "so it is offered");
  assert.equal(resetReplacesAChoice(s, o), true, "and it is asked about, not quietly overwritten");
});

test("the press IS offered over the customer's own pin (v238 — this is what changed)", () => {
  // v209 said no here, and its reason — "they were standing at their door when they dropped
  // it, and no lookup improves on that" — is true of the day they dropped it and says nothing
  // about today. Her report is the case it misses: the customer MOVED, their pin is the stale
  // one now, and the press that would replace it was hidden by that very rule. The card asks
  // before it overwrites their pin, so the press costs a confirmation and never a surprise.
  const t = state();
  const pinned = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(t, pinned, { lat: 3.1, lng: 101.6, label: "the wrong town" }, "lookup");
  assert.equal(doorIsTheirs(t, pinned), true, "their pin is the door in force");
  assert.equal(doorMayBeReset(t, pinned), true, "and it may be replaced, because it may be stale");

  // The pinned customer with NO kept door at all: still theirs, still offered.
  const u = state();
  const bare = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  assert.equal(doorMayBeReset(u, bare), true, "their pin, and it too may have gone stale");
});

// ── resetting a stale pin (v238) ──────────────────────────────────────────
//
// Her words: "when we call a customer in an order his address might already change, we are
// offer move the pin only... why not offer to reset the pin?" The customer's pin is the door
// by default and stays that way, but a reset beats the ONE pin it replaced — so a customer
// who really has moved is not stuck with a doorstep only they could correct.
//
// The trap these tests exist for is silent: writing the reset as "lookup" would leave
// doorIsTheirs true, so doorSpotOf would keep handing back their pin and the press would
// appear to do nothing at all. The first assertion below is what stands between her and that.

test("a reset beats the pin it replaced, and a lookup does not — the difference is the whole feature (v238)", () => {
  const theirs = { lat: 5.42, lng: 100.33 };
  const fresh = { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga, 10450 Penang" };

  // The counterfactual: the SAME press, written as a lookup, changes nothing at all. This is
  // the version that would look like it worked and leave her staring at an unmoved pin.
  const asLookup = state();
  const o1 = order({ customerPlace: { lat: theirs.lat, lng: theirs.lng } });
  setDropPlace(asLookup, o1, fresh, "lookup");
  assert.equal(doorIsTheirs(asLookup, o1), true, "a lookup still loses to their pin");
  assert.equal(doorSpotOf(asLookup, o1).lat, theirs.lat, "so the driver is still sent to the OLD pin");

  // The same press, written as a reset, actually moves the door.
  const asReset = state();
  const o2 = order({ customerPlace: { lat: theirs.lat, lng: theirs.lng } });
  setDropPlace(asReset, o2, fresh, "reset", "", theirs);
  assert.equal(doorIsTheirs(asReset, o2), false, "the reset wins over the pin it replaced");
  assert.equal(doorSpotOf(asReset, o2).lat, fresh.lat, "and the driver is sent to the new one");
  assert.equal(doorSpotOf(asReset, o2).lng, fresh.lng);
});

test("a reset yields to a genuinely NEW pin — her correction must not outlive the staleness (v238)", () => {
  const stale = { lat: 5.42, lng: 100.33 };
  const moved = { lat: 5.455, lng: 100.29 }; // they moved and pinned their new door
  const s = state();
  const o = order({ customerPlace: { lat: stale.lat, lng: stale.lng } });
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "reset", "", stale);
  assert.equal(doorIsTheirs(s, o), false, "while their pin is the one that was replaced, the reset stands");

  // They drop a new pin. The whole system's rule is that their own pin is the door (v209), and
  // a reset is a correction to a stale one — not a standing order that their pin now counts for
  // nothing. Without the `against` stamp this case is silently ignored.
  const after = order({ customerPlace: { lat: moved.lat, lng: moved.lng } });
  assert.equal(doorIsTheirs(s, after), true, "a new pin is a new fact, and it wins again");
  assert.equal(doorSpotOf(s, after).lat, moved.lat, "the driver follows them to the new door");
  assert.equal(doorSpotOf(s, after).lng, moved.lng);
});

test("the pin a reset replaced rides with the door, and only a reset writes one (v238)", () => {
  const s = state();
  const o = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  assert.equal(doorAgainstOf(s, o), null, "no door at all, nothing replaced");

  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "lookup");
  assert.equal(doorAgainstOf(s, o), null, "a plain lookup replaced nothing");

  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "reset", "", { lat: 5.42, lng: 100.33 });
  assert.deepEqual(doorAgainstOf(s, o), { lat: 5.42, lng: 100.33, label: "" }, "the pin it stood against");

  // The door is written whole every time, so a later drag takes the stamp with it: the old
  // point is gone and so is the fact about it. Her own hand answers the whole question.
  setDropPlace(s, o, { lat: 5.43, lng: 100.31, label: o.address });
  assert.equal(doorAgainstOf(s, o), null, "her own hand is the correction, and leaves no against behind");
  assert.equal(doorFromOf(s, o), "hand");

  // An `against` that is not a real point is refused the same way `road` is: a half-written
  // point is not a point, and a zero point would silently match the Equator.
  const t = state();
  const o2 = order({ customerPlace: { lat: 5.42, lng: 100.33 } });
  setDropPlace(t, o2, { lat: 5.41, lng: 100.32, label: o2.address }, "reset", "", { lat: 5.42 });
  assert.equal(doorAgainstOf(t, o2), null, "half a point is not a point");
});

test("the reset stays reversible: the switch still offers their pin back (v238)", () => {
  const theirs = { lat: 5.42, lng: 100.33 };
  const s = state();
  const o = order({ customerPlace: { lat: theirs.lat, lng: theirs.lng } });
  setDropPlace(s, o, { lat: 5.4141, lng: 100.3288, label: o.address }, "reset", "", theirs);
  const offer = doorSwitchOf(s, o);
  assert.ok(offer, "the two doors differ, so there is something to switch to");
  assert.equal(offer.which, "customer", "and it is THEIR pin being offered back");
  assert.equal(offer.place.lat, theirs.lat);
  assert.equal(offer.place.lng, theirs.lng);

  // Pressing it restores their exact point and hands the door back to them.
  setDropPlace(s, o, offer.place, offer.which, "");
  assert.equal(doorFromOf(s, o), "customer");
  assert.equal(doorIsTheirs(s, o), true, "their pin is the door again");
  assert.equal(doorAgainstOf(s, o), null, "and the stamp went with the door it belonged to");
});

test("two points are the same door by ONE rule, so the switch and the second ask cannot disagree (v213)", () => {
  const a = { lat: 5.42, lng: 100.33 };
  assert.equal(sameDoor(a, { lat: 5.42, lng: 100.33 }), true, "the identical point");
  // 0.0001 degrees is about 11 metres — finer than anyone re-pinning a doorstep can aim.
  assert.equal(sameDoor(a, { lat: 5.42005, lng: 100.33005 }), true, "inside the tolerance");
  assert.equal(sameDoor(a, { lat: 5.4202, lng: 100.33 }), false, "outside it: a different door");
  assert.equal(sameDoor(a, { lat: 5.42, lng: 100.3302 }), false, "on the other axis too");
  // A point that is not there is not the same door as anything — including another missing one.
  // Every caller here is asking about a door that is on screen, and "both are missing" is not
  // an answer to "has this door moved".
  assert.equal(sameDoor(null, null), false);
  assert.equal(sameDoor(a, null), false);
  assert.equal(sameDoor(null, a), false);
});
