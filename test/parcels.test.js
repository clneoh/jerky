// test/parcels.test.js — what the app knows about a parcel before it asks anybody (v307).
//
// ⚠️ THE HARD PART IS NOT THE CALL, IT IS THE ADDRESS. EasyParcel wants a five-character
// postcode and a three-letter state code; she and her customers type multi-line human
// addresses. So this reads what it can out of what she has ALREADY told the app — her mailing
// block, one order — and says exactly what it could not read, because a field this file
// guessed at and got wrong sends a parcel to the wrong state.
//
// Pure — no DOM, no fetch.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  balanceNote, cityIn, missingFrom, parcelContent, postcodeIn, partyOf, rateLines,
  receiverFrom, senderFrom, stateIn,
} = await import("../admin/js/parcels.js");

// ── reading an address ───────────────────────────────────────────────────────

test("the postcode is the five digits in the address, and nothing else is (v307)", () => {
  assert.equal(postcodeIn("12, Jalan Bunga Raya, 11600 Pulau Pinang"), "11600");
  assert.equal(postcodeIn("11600 Pulau Pinang"), "11600");
  assert.equal(postcodeIn("81100"), "81100");
  // A house number, a phone number and a longer run are all NOT postcodes.
  assert.equal(postcodeIn("12, Jalan Bunga"), "");
  assert.equal(postcodeIn("016 960 1268"), "");
  assert.equal(postcodeIn("12345678"), "");
  assert.equal(postcodeIn(""), "");
  assert.equal(postcodeIn(null), "");
});

test("the state is the one NAMED, longest name first (v307)", () => {
  // ⚠️ THE TWO COLLISIONS THAT WOULD PUT A PARCEL IN THE WRONG STATE: "Kuala Lumpur" contains
  // "Kuala", and "Pulau Pinang" contains "Pinang" — and "Pulau Pinang" is a different state
  // from nothing at all, so a shorter name winning would answer with a state nobody has.
  assert.equal(stateIn("11600 Pulau Pinang"), "pulau pinang");
  assert.equal(stateIn("50000 Kuala Lumpur"), "kuala lumpur");
  assert.equal(stateIn("40150 Shah Alam, Selangor"), "selangor");
  assert.equal(stateIn("81100 Johor"), "johor");
  assert.equal(stateIn(""), "");
});

test("a street named after a state does not beat the postcode line under it (v307)", () => {
  // ⚠️ "Jalan Kedah" is an ordinary street name in Penang. The line carrying the postcode is
  // the one that names the state, so it is read first — a parcel sent to Kedah because of a
  // street name is a parcel that arrives a week late.
  assert.equal(stateIn("12, Jalan Kedah\n11600 Pulau Pinang"), "pulau pinang");
  assert.equal(stateIn("9 Jalan Selangor, 81100 Johor"), "johor");
});

test("the town is read off the postcode line, and is empty when there is none (v307)", () => {
  assert.equal(cityIn("12, Jalan Bunga Raya\n11600 Pulau Pinang"), "Pulau Pinang");
  // A line that is ONLY the number yields nothing — a town is not derivable from a postcode by
  // this app, and an invented one would be a wrong address on a label.
  assert.equal(cityIn("11600"), "");
  assert.equal(cityIn("no postcode here"), "");
});

// ── her own end ──────────────────────────────────────────────────────────────

const SETTINGS = {
  mailingAddress: "Jienluv2bake\n12, Jalan Bunga Raya\n11600 Pulau Pinang\n016 960 1268",
  storefront: { name: "Jienluv2bake", whatsapp: "60123456789" },
};

test("her own details are read off the mailing block she already types (v307)", () => {
  // ⚠️ THIS IS READING A FORMAT SHE WAS ASKED FOR, NOT GUESSING AT ONE. The Settings box's own
  // placeholder is "Jienluv2bake / 12, Jalan Bunga Raya / 11600 Pulau Pinang / 016 960 1268",
  // so the shape is hers by instruction.
  const s = senderFrom(SETTINGS);
  assert.equal(s.name, "Jienluv2bake");
  assert.equal(s.addr1, "12, Jalan Bunga Raya");
  assert.equal(s.code, "11600");
  assert.equal(s.state, "pulau pinang");
  assert.equal(s.city, "Pulau Pinang");
  assert.equal(s.contact, "016 960 1268", "the phone is the last line, and it is a phone");
  assert.deepEqual(missingFrom(s), [], "so a parcel she posts needs nothing typed");
});

test("a mailing block with no phone falls back to the shop's own number (v307)", () => {
  // A courier should ring the number the shop already answers on rather than be handed nothing.
  const s = senderFrom({ ...SETTINGS, mailingAddress: "Jienluv2bake\n12, Jalan Bunga Raya\n11600 Pulau Pinang" });
  assert.equal(s.contact, "60123456789");
});

test("a half-filled mailing block reports WHAT is missing, not that it is broken (v307)", () => {
  // ⚠️ THE SCREEN ASKS FOR EXACTLY THESE. "The details are not finished" is a sentence a
  // baker cannot act on; "a postcode" is one she can.
  const s = senderFrom({ mailingAddress: "Jienluv2bake\n12, Jalan Bunga Raya", storefront: { whatsapp: "60123456789" } });
  assert.equal(s.name, "Jienluv2bake");
  assert.equal(s.code, "");
  // ⚠️ THE TOWN GOES WITH THE POSTCODE HERE, and that is correct rather than a shortfall: the
  // town is read off the line the postcode sits on, so a block with no postcode line has no
  // town to read either. All three are asked for, which is exactly what the screen then does.
  assert.deepEqual(missingFrom(s), ["town or city", "state", "postcode"]);
});

test("no mailing block at all is not a crash, it is four missing things (v307)", () => {
  const s = senderFrom({});
  assert.deepEqual(missingFrom(s), ["name", "phone number", "street address", "town or city", "state", "postcode"]);
});

// ── the customer's end ───────────────────────────────────────────────────────

test("the receiver's details come off the order, and its missing list is the point (v307)", () => {
  const full = receiverFrom({
    customerName: "Ain", whatsapp: "60111111111",
    address: "9, Jalan Besar\n81100 Kulai, Johor",
  });
  assert.equal(full.name, "Ain");
  assert.equal(full.contact, "60111111111");
  assert.equal(full.addr1, "9, Jalan Besar");
  assert.equal(full.code, "81100");
  assert.equal(full.state, "johor");
  assert.deepEqual(missingFrom(full), []);

  // A one-line address with no postcode — which is what an order taken over the phone often
  // has — is reported as missing its state and postcode rather than sent as empty strings.
  const thin = receiverFrom({ customerName: "Bala", whatsapp: "60122222222", address: "9 Jalan B" });
  assert.deepEqual(missingFrom(thin), ["town or city", "state", "postcode"]);
});

test("the receiver's name and number are the order's, never blanked (v307)", () => {
  const r = receiverFrom({ customerName: "  Ain  ", whatsapp: "60111111111" });
  assert.equal(r.name, "Ain", "trimmed");
  assert.equal(receiverFrom(null).name, "");
});

// ── the parcel's own record ──────────────────────────────────────────────────

test("what is in the box is named, and a nameless order still says something (v307)", () => {
  assert.equal(parcelContent({ productName: "Focaccia" }), "Focaccia");
  assert.equal(parcelContent({}), "Pet treats");
  assert.equal(parcelContent({ productName: "x".repeat(60) }).length, 35, "their field is 35 characters");
});

// ── saying what it costs ─────────────────────────────────────────────────────

test("the rates are shown cheapest first, and the cheapest is a FLAG not a choice (v307)", () => {
  const lines = rateLines([
    { courierName: "Ninja Van", priceRM: 9.4, delivery: "2-3 days", pickup: true },
    { courierName: "J&T", priceRM: 6.2, delivery: "3-5 days", dropoff: true },
    { courierName: "SPX", priceRM: 7.1, delivery: "3-4 days", pickup: true },
  ]);
  assert.deepEqual(lines.map((l) => l.courierName), ["J&T", "SPX", "Ninja Van"]);
  assert.equal(lines[0].cheapest, true);
  assert.equal(lines[1].cheapest, false, "only one row is the cheapest");
  assert.equal(lines[0].dropoff, true);
  assert.equal(lines[1].pickup, true);
});

test("a courier with no price is not a row she can press (v307)", () => {
  assert.deepEqual(rateLines([{ courierName: "Ghost", priceRM: 0 }]), []);
  assert.deepEqual(rateLines(null), []);
});

test("too little credit is said BEFORE she books, and it blocks nothing (v307)", () => {
  // ⚠️ EASYPARCEL IS PREPAID. A booking with too little credit fails with the parcel already
  // packed, and it fails as a SUCCESS whose own words are "Insufficient Credit" — so this is
  // the warning that saves her the whole trip.
  const short = balanceNote(3.5, 6.2);
  assert.match(short, /balance is RM3\.50/);
  assert.match(short, /costs RM6\.20/);
  assert.match(short, /top it up/);
  assert.match(balanceNote(20, 6.2), /balance: RM20\.00/);
  // With no price known yet, the balance is still worth showing and nothing is claimed.
  assert.equal(balanceNote(20, 0), "EasyParcel balance: RM20.00");
  assert.equal(balanceNote("rubbish", 5), "", "an unreadable balance says nothing at all");
});

test("a party is five things the API insists on, and the rest is optional (v307)", () => {
  const p = partyOf({ name: " A ", contact: " 1 ", addr1: " b ", city: " c ", state: " png ", code: " 11600 " });
  assert.deepEqual(p, { name: "A", contact: "1", addr1: "b", city: "c", state: "png", code: "11600", email: "" });
  assert.deepEqual(missingFrom(null), ["name", "phone number", "street address", "town or city", "state", "postcode"]);
});
