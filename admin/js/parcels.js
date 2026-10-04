// parcels.js — a parcel posted to a customer: kind 2 of two (v226, and the API seam in v307).
//
// ⚠️ KIND 2 IS NOT KIND 1. `couriers.js` is a VAN to a door within Penang, priced per trip
// and booked live. This is a parcel handed to a nationwide carrier, priced per parcel, and
// the customer waits days rather than hours. Two different companies, two different wallets.
//
// ★ THE PRODUCT DECIDES EVERYTHING: DRY AND SEALED ONLY. The general carrier objection to a
// home baker is homemade food without a seal — sealed dry goods step around it. Fresh
// focaccia and anything frozen are NOT parcels. That was settled in v226 and nothing here
// changes it.
//
// This file is PURE: no fetch, no DOM. It turns what she has already told the app — her own
// mailing address, and one order — into the two parties EasyParcel's API wants, and works out
// exactly what it could NOT work out so the screen can ask her for that and nothing more.

// ⚠️ POSTCODE AND STATE ARE NOT FREE TEXT TO THIS API. EasyParcel wants a five-character
// postcode and a three-letter state code (Appendix III: Pulau Pinang is `png`). Her mailing
// address and her orders' addresses are typed, multi-line, human things — so the app READS
// what it can and says so when it cannot, rather than sending an empty string and calling the
// answer "nobody delivers there".

// The five-digit postcode in a line of address, or "".
//
// A Malaysian postcode is exactly five digits and is conventionally followed by the state on
// the same line — "11600 Pulau Pinang". Anchored on word boundaries so a house number or a
// phone number cannot be mistaken for one.
export function postcodeIn(text) {
  const m = String(text || "").match(/(?:^|\D)(\d{5})(?:\D|$)/);
  return m ? m[1] : "";
}

// The state NAMED anywhere in an address block, in the words the address uses, or "".
//
// Longest first, so "Kuala Lumpur" is not read as "Kuala" and "Pulau Pinang" is not read as
// "Pinang" — the two collisions that would put a parcel in the wrong state. This returns the
// NAME and not a code: the mapping to EasyParcel's codes belongs on the server, where their
// own Appendix III is, and a copy of it here would be a second list to keep in step.
const STATE_NAMES = [
  "pulau pinang", "kuala lumpur", "negeri sembilan", "putra jaya", "kota kinabalu",
  "johor", "kedah", "kelantan", "melaka", "malacca", "pahang", "perak", "perlis",
  "penang", "selangor", "terengganu", "sarawak", "sabah", "labuan", "putrajaya",
];

export function stateIn(text) {
  const t = String(text || "").toLowerCase();
  // The block is read LINE BY LINE, and a line that carries the postcode wins: a street
  // called "Jalan Kedah" in Penang must not beat the "11600 Pulau Pinang" under it.
  const lines = t.split(/\n|,/).map((l) => l.trim()).filter(Boolean);
  const withCode = lines.filter((l) => /\b\d{5}\b/.test(l));
  for (const pool of [withCode, lines]) {
    for (const name of STATE_NAMES) {
      if (pool.some((l) => l.includes(name))) return name;
    }
  }
  return "";
}

// A person as the API wants them: five things it will refuse the parcel without, and four it
// will take or leave.
export function partyOf(src = {}) {
  const { name = "", contact = "", addr1 = "", city = "", state = "", code = "", email = "" } = src || {};
  return {
    name: String(name || "").trim(),
    contact: String(contact || "").trim(),
    addr1: String(addr1 || "").trim(),
    city: String(city || "").trim(),
    state: String(state || "").trim(),
    code: String(code || "").trim(),
    email: String(email || "").trim(),
  };
}

// What the API will not accept the parcel without — and it is exactly these fields, in these
// words, so the screen can say which one is missing rather than "the details are not finished".
// ⚠️ THE LABELS CARRY NO ARTICLE, so a caller can put an owner in front of them: "your name,
// phone number and street address" is a sentence, and "their a street address" is not — which
// is exactly what this app said on screen until the harness caught it.
export const PARTY_NEEDS = [
  ["name", "name"],
  ["contact", "phone number"],
  ["addr1", "street address"],
  ["city", "town or city"],
  ["state", "state"],
  ["code", "postcode"],
];

// The fields a party is still missing, as the labels above. Empty means it is complete.
export function missingFrom(party) {
  const p = partyOf(party);
  return PARTY_NEEDS.filter(([key]) => !p[key]).map(([, label]) => label);
}

// ── her own end ──────────────────────────────────────────────────────────────
//
// Read off the MAILING ADDRESS she already types for the labels, because that block is
// already in the shape a FROM needs: bakery name, street, "11600 Pulau Pinang", phone. The
// Settings hint tells her to write it exactly that way, so this is reading a format she was
// asked for — not guessing at one.
//
// Whatever it cannot read comes back missing, and the screen asks her for that alone. A field
// it guessed at and got wrong would put her parcel's return address somewhere else.
export function senderFrom(settings) {
  const s = settings || {};
  const lines = String(s.mailingAddress || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const sf = s.storefront || {};
  // The first line is the bakery's name — the same convention `fromLines` reads for a
  // letterhead. The last line is very often the phone number.
  const name = lines.length ? lines[0] : String(sf.name || "").trim();
  const body = lines.slice(1).join("\n");
  const street = lines.length > 1 ? lines[1] : "";
  // Her number: the mailing block's own last line when it looks like one, else the shop's
  // WhatsApp — which is the number a courier should ring anyway.
  const lastLine = lines.length > 1 ? lines[lines.length - 1] : "";
  const phone = lastLine.replace(/\D/g, "").length >= 7 ? lastLine : String(sf.whatsapp || "").trim();
  return partyOf({
    name,
    contact: phone,
    addr1: street,
    // A Malaysian address's town is usually the line the postcode sits on, after the number
    // and before the state — and when there is no such line this is "" and she is asked.
    city: cityIn(body),
    state: stateIn(body),
    code: postcodeIn(body),
  });
}

// The town on the line that carries the postcode: "11600 Pulau Pinang" -> "Pulau Pinang".
// Empty when the line is only the number, which is honest — a town is not derivable from a
// postcode by this app, and EasyParcel's own field would take the state name here happily.
export function cityIn(text) {
  for (const line of String(text || "").split(/\n|,/)) {
    const m = line.match(/\b(\d{5})\b(.*)$/);
    if (!m) continue;
    const after = m[2].replace(/[^A-Za-z\s'-]/g, " ").trim();
    if (after) return after;
  }
  return "";
}

// ── the customer's end ───────────────────────────────────────────────────────
//
// From the order she is looking at. `address` is what the customer typed (or what the shop's
// own address box filled in, which is usually a full Google address WITH its postcode), and
// the name and number are on the order already.
export function receiverFrom(order) {
  const o = order || {};
  const address = String(o.address || "").trim();
  return partyOf({
    name: String(o.customerName || "").trim(),
    contact: String(o.whatsapp || "").trim(),
    addr1: address.split("\n").map((l) => l.trim()).filter(Boolean)[0] || "",
    city: cityIn(address),
    state: stateIn(address),
    code: postcodeIn(address),
  });
}

// ── the parcel itself ────────────────────────────────────────────────────────

// What is in the box, in her words, for the two places the API asks for it. Never parsed out
// of a product name: `content` is a description a customs officer or a courier reads.
export function parcelContent(order, state) {
  const name = String((order && order.productName) || "").trim();
  return (name || "Pet treats").slice(0, 35);
}

// ── saying what it costs ─────────────────────────────────────────────────────

// The rates as she reads them, cheapest first. `cheapest` is a FLAG and not a decision: which
// courier to use is hers, and the reason to show several is that the cheapest is not always
// the one a customer wants.
export function rateLines(rates) {
  const list = (Array.isArray(rates) ? rates : [])
    .filter((r) => r && Number(r.priceRM) > 0)
    .sort((a, b) => Number(a.priceRM) - Number(b.priceRM));
  return list.map((r, i) => ({
    courierName: String(r.courierName || "").trim(),
    serviceName: String(r.serviceName || "").trim(),
    priceRM: Number(r.priceRM),
    delivery: String(r.delivery || "").trim(),
    cheapest: i === 0,
    dropoff: !!r.dropoff,
    pickup: !!r.pickup,
  }));
}

// ⚠️ WHAT IS IN THE WALLET, SAID AS A WARNING RATHER THAN AS A NUMBER (v307). EasyParcel is
// PREPAID, so a booking with too little credit fails with the parcel already packed — and the
// failure arrives as a SUCCESS whose own words are "Insufficient Credit". Warning her BEFORE
// she presses Book is the whole reason this is read at all.
//
// It never blocks anything: she may be about to top up, and a screen that refused to show a
// price because the wallet was empty would be a website rule standing between her and a sale.
export function balanceNote(balanceRM, neededRM) {
  const have = Number(balanceRM);
  if (!Number.isFinite(have)) return "";
  const need = Number(neededRM);
  if (Number.isFinite(need) && need > 0 && have < need) {
    return `Your EasyParcel balance is RM${have.toFixed(2)} and this parcel costs RM${need.toFixed(2)} — top it up before booking, or the booking will fail with the parcel already packed.`;
  }
  return `EasyParcel balance: RM${have.toFixed(2)}`;
}
