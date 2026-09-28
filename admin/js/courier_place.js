// courier_place.js — where a courier trip starts and where it ends (25 Sep 2026).
//
// A courier API does not want an address. It wants a POINT. "5.41405,100.31408" is
// a doorstep; "12 Jalan Bunga, Penang" is a guess about one — and Lalamove says so
// itself: the error it raises when it cannot place an address is
// ERR_REVERSE_GEOCODE_FAILURE and its own text asks for "lat and lng". So the app
// has to hold a point for two things: you (once) and each customer (once
// each).
//
// Hers was the choice, in so many words: "Locate it, let me fix it". The app looks
// the address up; where that fails or lands wrong she puts the pin where it belongs
// and that customer is remembered. Three answers in this order, because the first
// two are cheap and the third is the only one that is never wrong:
//
//   1. the point already saved for this customer  -> use it. No lookup, no screen.
//   2. the address their order already carries    -> look it up once, SAVE what
//                                                    comes back, so it is asked
//                                                    exactly once per customer.
//   3. a tap on a map                             -> the answer she can trust.
//
// A saved point lives on the CUSTOMER's profile row (profiles.js), not in a map of
// its own, and that is the whole reason this needs no new machinery: the profile is
// already keyed by the same number the orders are (keyOf), it is already re-keyed
// when she corrects a number, and — the part that matters — state.customers travels
// to the cloud whole (sync.js returns list records as they are), so a doorstep
// pinned on one phone is on the other phone without a line of sync code.
//
// Pure — no DOM, no fetch — so it runs under Node for tests. Asking a geocoder and
// drawing a map belong to the caller; the rules about what to ask for and what to
// keep live here, so the quote panel and Settings cannot disagree about them.

import { keyOf } from "./customers.js";
import { profileFor } from "./profiles.js";
import { newId, save } from "./state.js";

// A number, or null — and the guard, not the conversion, is the point.
//
// `Number(null)` is 0. So is `Number("")`, `Number([])`, `Number(false)` and
// `Number("   ")`. Every one of them is finite, and that is what makes this the
// most expensive one-line mistake available in this feature: a latitude that came
// through as null becomes a real point on the Equator, a distance that came through
// as null becomes "0 km" printed under a price, and neither is an error anywhere in
// the stack. So a thing that is not already a number and not a non-empty string is
// not a number, whatever it happens to convert to.
//
// It is exported because the same trap is in two other places: fmtDistanceKm in
// courier_job.js, and the server's own copy in supabase/functions/courier/place.ts.
export function strictNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// A stored point, or null. It takes BOTH numbers to be a point: a half-written
// place — a latitude from a half-finished paste, a longitude that came through as a
// word — must read as "not known" rather than reaching the API, where NaN is not a
// 400 she could act on but a quotation for a trip that does not exist.
//
// Out-of-range values are refused for the same reason. Lalamove would take 999,999
// and answer with something; "the pin is nonsense, put it again" is the only useful
// answer, and it has to come from here because the API will happily not complain.
//
// This is the app's ONE answer to "is this a place", and it is deliberately asked
// by sync.js as well — the guarded-key rules will only carry `pickupPlace` when
// this says yes, so the app can never believe a spot is pinned that sync would
// refuse to hand to the other phone.
export function validPlace(p) {
  if (!p || typeof p !== "object") return null;
  const lat = strictNumber(p.lat);
  const lng = strictNumber(p.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, label: String(p.label || "").trim() };
}

// Your own pickup point, or null while it is still unpinned.
export function pickupPlace(state) {
  return validPlace(state && state.settings && state.settings.pickupPlace);
}

// The text to look up when you have no pin yet — your mailing address, which
// is already typed once for the label sheet, so the first pin costs her no typing.
export function pickupAddress(state) {
  const s = (state && state.settings) || {};
  return String(s.mailingAddress || "").trim();
}

// The customer's saved doorstep, or null. Found off the order's own key, so the pin
// follows the person and not the order — a second order from the same number is
// already pinned.
export function dropPlaceOf(state, order) {
  const row = profileFor(state, keyOf(order));
  return validPlace(row && row.place);
}

// HOW that saved door got there (v209): "hand" when SHE put it there — a drag on the
// card, or a pick in the map's own picker — "customer" when she took up the pin they
// dropped, "lookup" when the app found it from the typed address on its way to a price.
//
// It exists for one question only: whether the door she keeps may be overridden by the
// pin the customer dropped. A door from a LOOKUP must be, because a lookup answers the
// wrong town as easily as the right one and that is the bug she has now reported five
// times. A door from HER OWN HAND must not be, because a pin she corrected by hand that
// snapped back on the next repaint is a control moving under her finger.
//
// A door saved before v209 carries no `from` at all, so it reads as neither — and loses
// to the customer's pin, which is exactly the fix. `setDropPlace` stamps every door it
// writes from now on.
export function doorFromOf(state, order) {
  const row = profileFor(state, keyOf(order));
  const place = row && row.place;
  return String((place && place.from) || "");
}

// The house number a lookup could NOT find for this door, or "" (v211). Set only where a
// lookup wrote the door, and only when the geocoder's own answer did not contain the number
// she typed — see houseNotIn below for how that is decided.
//
// It exists so the one fact survives the lookup. The door is NAMED with the address on the
// order, house number and all (v207), because that is the address she and the customer both
// use; a point that is only the road would otherwise wear that name back at her on the card
// and on the run, saying "23 Jalan Seang Tek" over a pin on Seang Tek Road. Storing the
// number is what lets those lines keep saying the address AND say the pin is not the door.
//
// It is cleared with the door, because `setDropPlace` writes the whole record: a drag by her
// own hand leaves no `road` behind, which is right — her hand is the correction.
export function doorRoadOf(state, order) {
  const row = profileFor(state, keyOf(order));
  const place = row && row.place;
  return String((place && place.road) || "");
}

// WHICH of the two doors on this order is the one in force: the customer's own pin, or a
// door of hers. The single question everything else here derives from, so the point the
// price is asked for, the point a driver is sent to, and the words on the card can never
// disagree about which door they are talking about.
//
// True when the customer dropped a pin AND the door she keeps is not her own hand.
export function doorIsTheirs(state, order) {
  if (!customerPlaceOf(order)) return false;
  return doorFromOf(state, order) !== "hand";
}

// Whether the app may OFFER to look this order's address up again (v213).
//
// A door a lookup wrote is not a fact about the world. It is the best answer ONE service had
// on the day it was asked, and for a Malaysian house number that answer is often just the
// road — which is the whole of [[v212]]. v212 added a second, better service, but it is only
// ever asked when there is no door yet: `setDropPlace` writes the door once and every later
// price reads it back, so a customer pinned before v212 keeps the old answer for good, and
// the key she has now set would appear to have changed nothing. This is the way out of that.
//
// YES where the door was written by a LOOKUP, and where it was written before the app
// recorded how a door got there at all. That second case is honest rather than tidy: `from`
// arrived at v209, and before it the only writer that ran by itself was the lookup, so a door
// with no `from` is a lookup's answer or a drag she made before the app kept a note of one.
// Offering the press is safe in that grey area precisely because nothing happens without it.
//
// NO where their own pin is the point in force — they were standing at their door, and no
// lookup improves on that (v209) — and NO where a door she placed by hand is in force, which
// is a correction rather than a guess, and not something to be offered up for replacement.
export function doorMayBeLookedUpAgain(state, order) {
  if (doorIsTheirs(state, order)) return false;
  const from = doorFromOf(state, order);
  return from === "lookup" || from === "";
}

// THE POINT THAT IS THE DOOR — the one a price is asked for and a driver is sent to.
//
// WHERE THE CUSTOMER DROPPED THEIR OWN PIN, THAT PIN IS THE DOOR. Her instruction, in her
// words (27 Sep 2026): "Their own pin — always." They were standing at their door when
// they dropped it; the door she keeps for them may have been found by a lookup, and a
// lookup can land in another town. So their pin beats anything this app worked out.
//
// The one thing it does not beat is her own hand (see doorFromOf above) — she is the only
// one who knows the door, and a correction she made must stick.
//
// `dropPlaceOf` keeps its old meaning — the door SHE KEEPS — because the card still says
// which door it is out loud. This is the function every consumer that needs the point
// asks instead.
export function doorSpotOf(state, order) {
  const theirs = customerPlaceOf(order);
  const kept = dropPlaceOf(state, order);
  return doorIsTheirs(state, order) ? theirs : (kept || theirs);
}

// The delivery address the order already carries, as typed (the store's one-line
// address box, or whatever she wrote under Edit).
export function dropAddress(order) {
  return String((order && order.address) || "").trim();
}

// The doorstep the CUSTOMER dropped on the shop page, or null (v197).
//
// IT WAS A SUGGESTION AND NOTHING MORE until v209, and it is not any more. Her
// instruction (27 Sep 2026), after five reports of "the pin still wrong": "Their own pin
// — always." Where they left one, it is now the door the price is asked for and the door
// a driver is sent to (see doorSpotOf below) — they were at their door when they dropped
// it, and the door kept for them may only ever have been a lookup's answer. The v197
// promise that nothing reached a driver from this without her press is therefore
// RETIRED, deliberately, on her word; the one-press switch in the card is what replaces
// it, and a door she placed by her own hand still beats this.
export function customerPlaceOf(order) {
  return validPlace(order && order.customerPlace);
}

// Two pins this close together are the same door: 0.0001 degrees is about 11
// metres, which is finer than anyone re-pinning a doorstep can aim, and coarse
// enough that a pin nudged a few metres on the map does not read as a new place.
const SAME_DOOR_DEG = 0.0001;

// THE one answer to "are these two points the same door", so the switch's own question and
// the re-lookup's "did the door actually move" (v213) cannot come apart. A missing point is
// not the same door as anything — including another missing point — because every caller
// here is asking about a door that is on screen.
export function sameDoor(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < SAME_DOOR_DEG
    && Math.abs(a.lng - b.lng) < SAME_DOOR_DEG;
}

// The OTHER door on this order — the one that is not in force — so the card can offer one
// press to switch to it. Null when there is nothing to switch to: no second door, or the
// two agree to within SAME_DOOR_DEG (about 11 metres), in which case they are one door and
// a switch between them would be a control that does nothing.
//
// SYMMETRIC SINCE v209, and that is the whole of what changed. It used to be
// `customerPinOffer`, which only ever offered THEIR pin as a correction to the door she
// keeps — because that was the only direction that could arise while the kept door always
// won. Now their pin can be the door in force and the door she keeps can be the
// alternative, so the same control has to point both ways.
//
// `which` names the door being offered ("customer" or "kept") and `replacing` the one in
// force, because the caller has to say both out loud.
export function doorSwitchOf(state, order) {
  const theirs = customerPlaceOf(order);
  const kept = dropPlaceOf(state, order);
  if (!theirs || !kept) return null;
  if (sameDoor(kept, theirs)) return null;
  // Which one is in force is decided by doorIsTheirs, not by a second guess here: the two
  // must never be able to disagree about what the card is showing.
  return doorIsTheirs(state, order)
    ? { place: kept, which: "kept", replacing: theirs }
    : { place: theirs, which: "customer", replacing: kept };
}

// Remember a doorstep against the person this order belongs to. Creates the profile
// row if this customer has none yet, shaped exactly as profiles.js's own
// upsertProfile shapes one (the "cus" id prefix, the key, the contact the orders
// already carry) so a pin written from here and a profile saved from the customer
// card are the same kind of record.
//
// Refused, quietly, when the order has nothing to key a person by — the same
// invariant profiles.js keeps: a row nobody can find again is worse than no row.
//
// `from` records HOW the door got here (see doorFromOf above) and is not decoration: it is
// the whole of whether the customer's own pin may override this door. It defaults to
// "hand" because that is what every existing caller means — a drag on the card, a pick in
// the map's picker — and a caller that means something else must say so out loud.
//
// `road` is the house number a lookup could not find (v211, see doorRoadOf above). Only the
// callers that just ran a lookup pass it, and only when `houseNotIn` says the answer missed
// the number — so a hand-placed door leaves no trace of a road, which is the point.
export function setDropPlace(state, order, place, from = "hand", road = "") {
  const p = validPlace(place);
  const key = keyOf(order);
  if (!p || !key) return null;
  const list = Array.isArray(state.customers) ? state.customers : (state.customers = []);
  let row = list.find((x) => x && x.key === key) || null;
  if (!row) {
    row = {
      id: newId("cus"),
      key,
      name: String((order && order.customerName) || "").trim(),
      whatsapp: String((order && order.whatsapp) || "").trim(),
      createdAt: new Date().toISOString(),
    };
    list.push(row);
  }
  row.place = {
    lat: p.lat,
    lng: p.lng,
    label: p.label,
    from: String(from || "hand"),
    at: new Date().toISOString(),
  };
  // Written only when a lookup missed the number, so no other door carries the key at all —
  // a record with no `road` and a record with `road: ""` would read the same here, which is
  // one way for two states to mean one thing, and this app has been bitten by that before.
  if (road) row.place.road = String(road);
  save(state);
  return row.place;
}

// Pin your place. Written once and rarely moved, so it needs no history.
export function setPickupPlace(state, place) {
  const p = validPlace(place);
  if (!p) return null;
  state.settings.pickupPlace = {
    lat: p.lat,
    lng: p.lng,
    label: p.label,
    at: new Date().toISOString(),
  };
  save(state);
  return state.settings.pickupPlace;
}

// "5.4141,100.3288" — the pair as the API wants it, or "" when there is no point.
export function latLngText(place) {
  const p = validPlace(place);
  return p ? `${p.lat},${p.lng}` : "";
}

// How a point is said on screen. A pinned spot carries the words she pinned it with
// (the geocoder's own label, or the address she typed beside a hand-placed pin);
// without one, the numbers themselves, at five decimals — about a metre, which is
// as close as anyone needs to say out loud.
export function fmtPlace(place, fallback = "not pinned yet") {
  const p = validPlace(place);
  if (!p) return fallback;
  return p.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

// A geocoder's label cut into the two lines a row of the chooser wears: what the place
// IS on the first line, and where it is on the second.
//
// The cut is at the FIRST comma, and that is the whole rule. It is exact for Photon,
// which composes its labels here (see photonLabel in the courier function) as
// name, town, postcode — so "Chulia Street" and then "George Town, 10200". It is only
// passable for Nominatim, whose display_name puts whatever is most specific first,
// which for a street address is often the house number: "12" and then "Jalan Bunga,
// Taman Foo, 10450 George Town, Penang, Malaysia". That reads poorly and it is left
// that way on purpose. Nominatim only answers when Photon is down, and the fix would be
// to stop storing its display_name — which is the label already saved on customers she
// has pinned, so the cure would rewrite her own records to tidy a fallback.
//
// A label with no comma is ALL title and no sub, and a row with no sub is a row with one
// line. That is not a failure case: it is a village, a landmark, a condominium block —
// and inventing a second line for it would be inventing words the geocoder never said.
export function splitLabel(label) {
  const text = String(label == null ? "" : label).trim();
  const at = text.indexOf(",");
  if (at < 0) return { title: text, sub: "" };
  return { title: text.slice(0, at).trim(), sub: text.slice(at + 1).trim() };
}

// THE HOUSE NUMBER THE LOOKUP COULD NOT FIND, or "" (v211).
//
// Her report, and it is the whole reason this exists: she types "23 Jalan Seang Tek" and the
// only thing on offer is "Seang Tek Road, George Town, 10400" — a road, not a house, and
// Seang Tek is a long road. The pin lands on the street and nothing says so.
//
// NOTHING IN A GEOCODER'S REPLY SAYS "THIS IS ONLY A ROAD". There is no field for it — the
// two services here (see supabase/functions/courier/geocode.ts) answer with a point and a
// label, and Photon's label is composed by us out of street, town and postcode, which is a
// road's own shape. So the question is asked the other way round: does the answer CONTAIN
// the number she typed? A Malaysian address leads with its house number, so if the number is
// in the answer the house was found, and if it is not, the answer is her street wearing her
// street's name — and the pin is not her door.
//
// The comparison is on WHOLE TOKENS, because a five-digit postcode contains plenty of
// two-digit numbers and "23" must not be satisfied by "10400" or by "123". Five-digit numbers
// are dropped from what she is taken to have asked for, because a Malaysian postcode is five
// digits and a five-digit house number is not a thing — which is what keeps "23 Jalan Seang
// Tek, 10400" from being answered by the postcode alone.
//
// An address with no number in it asks for a road, and a road is what comes back, so it warns
// about nothing. That is not a special case bolted on: it is the same sentence read the other
// way, and it is why she can still look up a street she has no number for.
export function houseNotIn(address, place) {
  const asked = String(address == null ? "" : address).match(/\d+[a-z]?/gi) || [];
  const want = asked.map((s) => s.toLowerCase()).filter((s) => !/^\d{5}$/.test(s));
  if (!want.length) return "";
  const said = String((place && place.label) || "").toLowerCase().split(/[^a-z0-9]+/);
  if (want.some((n) => said.includes(n))) return "";
  return want[0];
}

// The one fact, said the one way, wherever a road-only pin is reported — the picker's answer
// line, the quote card's door line, and the run's row. Short is for the run row, where the
// address is already on the line and the sentence sits inside a row a phone has to fit.
export function roadNotHouse(house, { short = false } = {}) {
  return short
    ? `the road, not number ${house}`
    : `The lookup found the road, not number ${house} — drag the pin to the door.`;
}

// Numbers she pasted, from anywhere she copied them. Four shapes, in the order that
// matters — the two Google Maps URL forms are tried before the bare pair, because a
// URL can contain a bare pair and the other way round is a wrong answer rather than
// a missed one:
//
//   https://www.google.com/maps/place/.../@5.4141,100.3288,17z    -> @lat,lng
//   https://maps.google.com/?q=5.4141,100.3288                    -> q=lat,lng
//   https://www.google.com/maps/...!3d5.4141!4d100.3288           -> !3d..!4d..
//   5.4141, 100.3288                                              -> a plain paste
//
// The bare form requires a decimal point somewhere, which is the one guard that
// keeps a pasted "5,100" — a price, a quantity, a date — from being read as a point
// in the South China Sea.
//
// Returns { lat, lng } with no label: the caller knows what this point is FOR and
// has better words for it than the numbers do.
export function parseCoords(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const tryPair = (a, b) => {
    const lat = strictNumber(a);
    const lng = strictNumber(b);
    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  };
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&#](?:q|ll|query|destination|center|daddr)=${num},${num}`, "i"),
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const hit = tryPair(m[1], m[2]);
      if (hit) return hit;
    }
  }
  const bare = s.match(new RegExp(`^${num}\\s*,\\s*${num}$`));
  if (bare && /\d\.\d/.test(s)) {
    return tryPair(bare[1], bare[2]);
  }
  return null;
}

// What this trip is still missing, in words she can act on, or null when both ends
// are known. One place, so the quote panel and Settings say it the same way.
export function placeProblem(state, order) {
  if (!pickupPlace(state)) {
    return {
      need: "pickup",
      say: pickupAddress(state)
        ? "Your pickup spot is not pinned yet — pin it in Settings and every price from now on is for the right door."
        : "Pin your pickup spot in Settings first — a courier needs a door to collect from.",
    };
  }
  if (!doorSpotOf(state, order)) {
    return {
      need: "drop",
      say: dropAddress(order)
        ? "This customer's doorstep is not pinned yet — look it up, or put the pin on the map."
        : "This order has no delivery address to look up. Add one under Edit, or put the pin on the map.",
    };
  }
  return null;
}
