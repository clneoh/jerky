// store/geo.js — the shop's own location rules (v197, 25 Sep 2026).
//
// WHY THE SHOP ASKS AT ALL. Until now a courier order reached you as a
// sentence you had to turn into a point by hand — a lookup, or the map by
// hand — and the lookup is exactly what refused her address on her own phone
// (v196). The customer, though, knows where their own door is better than any
// geocoder does, and if they are standing at it their phone will say the point
// outright. So the shop asks them, twice over: "use my location" for the customer
// who is there, and a map to drag a pin on for the customer who is ordering from
// work for a delivery to home. Her words for that second one: it is easy "if they
// are familiar with grab car".
//
// A SUGGESTION, NEVER A FACT. What is decided here is only what the ORDER carries.
// It prices nothing, and in the admin screen it is offered with the words
// "the customer pinned this", beside the door she already keeps for that customer.
// Only her own press turns it into the customer's saved doorstep
// (admin/js/courier_place.js, setDropPlace). That was her condition in so many
// words: "as security, app side will reconfirm".
//
// Pure — no DOM, no fetch, no Leaflet — so every answer a real phone can give is
// driven under Node, including the one a desktop hands over: no geolocation object
// at all.

// Degrees kept to six decimals, about 11 cm. Leaflet hands back full float
// precision, and posting "100.32880000000001" would be noise on a record a human
// reads — this is finer than any door is wide.
function tidy(n) {
  return Math.round(n * 1e6) / 1e6;
}

// A number, or null — and the GUARD, not the conversion, is the point.
//
// `Number(null)` is 0. So are `Number("")`, `Number([])`, `Number(false)` and
// `Number("   ")`, and every one of them is finite — which is what makes this the
// most expensive one-line mistake available in this feature. A latitude that arrived
// as null becomes a real point on the Equator, a real drive, and nothing anywhere in
// the stack complains. So a thing that is not already a number, and not a non-empty
// string, is not a number whatever it converts to.
//
// You hold the same guard (`strictNumber` in admin/js/courier_place.js) and
// the two MUST agree: this is the app's one answer to "is this a point", asked once
// at each end of the same order.
function strict(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// How much of the customer's address is kept when it names a pin. It lands on your
// screen, and you cap the same field at the same width when it reads one back off
// an order (admin/js/supabase.js) — a number rather than "as long as it happens to be", so
// the two ends cannot disagree about what fits.
const LABEL_MAX = 120;

// The words an address is worth, or "". Never null and never a non-string, because this
// is read straight onto a screen.
function labelOf(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

// A point, or null. The shop's own copy of the rule you apply to the same
// numbers on arrival (validPlace in admin/js/courier_place.js): both numbers, both
// finite, both on the planet. It is checked here so nothing obviously wrong is ever
// posted, and again there because a posted payload is untrusted input.
//
// A PIN IS ONLY EVER A POINT — it carries no words at all (v205). For two versions the
// shop's copy of this held a `label`, because a tapped suggestion row's name rode out on
// the pin; that is the half she corrected. A row is a FRAGMENT of an address — a street
// and a town, no house number — and the moment it is treated as an address it contaminates
// the one the customer typed. So no pin can name itself: the only words an order ever
// carries come from the address box, and they are added in exactly ONE place, the
// `placeForOrder` below. Two answers to "where" cannot be born different if there is only
// one place that can write the second one.
export function validPin(p) {
  if (!p || typeof p !== "object") return null;
  const lat = strict(p.lat);
  const lng = strict(p.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: tidy(lat), lng: tidy(lng) };
}

// What the order carries. A pin travels ONLY with a courier order that has one:
// a self-collect order has no door to drive to, and an order with no pin must post
// byte for byte the payload the shop has always posted. Returns null to mean "send
// nothing", which is the caller's cue to leave the field out entirely rather than
// write a null into the order.
//
// WHOSE WORDS RIDE WITH THE PIN (v205). Not the geocoder's, and that is her decision
// after seeing the first attempt: "the customer know their address well, when i tap the
// address the address is not a complete one, if it is plaste into the address line, it
// will contaminate the customer keyin address". A suggestion row is a FRAGMENT — a street
// and a town, no house number — and it is only ever good enough to move a pin near the
// right road. The customer's own typed address is the complete one, and it is the only
// name for that place that belongs on the order. So the pin carries THEIR words.
//
// What this buys is the whole of her original report: "when the pin arrive at backoffice,
// it did not tally". The order's address and the pin's name are now one string, so her
// screen cannot show two place names and have them disagree — and v204's fix, which
// stopped the pin surviving an edit to the words, still stands underneath it.
//
// `address` is the box as typed. No address means no words: a customer who pinned without
// writing anything has nothing to name the spot with, and the pin goes as the bare point
// it is rather than being given a name nobody wrote.
export function placeForOrder(pin, fulfillment, address = "") {
  if (fulfillment !== "courier") return null;
  const p = validPin(pin);
  if (!p) return null;
  const words = labelOf(address);
  if (!words) return { lat: p.lat, lng: p.lng };
  return { lat: p.lat, lng: p.lng, label: words };
}

// WHETHER A ROW IS ALLOWED TO WRITE ITSELF INTO THE ADDRESS BOX (v214).
//
// v205 forbade this outright, and the reason was measured rather than argued: "the customer
// know their address well, when i tap the address the address is not a complete one, if it
// is plaste into the address line, it will contaminate the customer keyin address". What she
// was describing was the FREE services' answer, and she was right about it — they hold
// Malaysian ROADS, so a row for a Malaysian address came back as a street and a town with the
// house number missing. Writing that into the box would have replaced the one complete
// address on the page with a worse one.
//
// v212 changed what a row can be. When Google answers (which it does whenever the key is
// set), the row is its own `formatted_address` — a COMPLETE Malaysian address, often with
// details the customer left out. So the rule she asked for in v214 becomes reachable: "the
// address is very accurate, it can go into the delivery address instead of customer type
// full".
//
// THE TEST IS THE HOUSE NUMBER, AND NOTHING ELSE. This is a deliberate mirror of the
// your own `houseNotIn` (admin/js/courier_place.js): take the digit-bearing tokens the
// customer typed — every one, minus the 5-digit postcode, which says which district rather
// than which door — and require the row's words to CONTAIN ALL OF THEM. A row that has every
// number they typed found the house they meant, so its answer is richer than their typing and
// may replace it. A row missing one of them found the road, the wrong town, or nothing —
// which is the v205 complaint exactly — and is not allowed near their words.
//
// Two consequences that follow and are wanted, rather than tolerated:
//   • An address typed with NO number at all ("Taman Sri Nibong, Penang") can never be
//     written over. There is no house number to confirm, so the row's words are never
//     provably better, and the customer's own are left alone. This is the same answer as
//     "a road-only answer leaves their words alone", arriving from the other end.
//   • A row that found nothing to say (no label) writes nothing, whatever was typed.
//
// It writes NOTHING ITSELF — it decides, and store/app.js does the writing. Both halves are
// separate on purpose: this is the rule, and the rule is pure, so every address a real
// customer can type is driven under Node.
export function addressFromRow(hit, typed) {
  const words = labelOf(hit && hit.label);
  if (!words) return "";
  const asked = String(typed == null ? "" : typed).match(/\d+[a-z]?/gi) || [];
  const want = asked.map((s) => s.toLowerCase()).filter((s) => !/^\d{5}$/.test(s));
  if (!want.length) return "";
  const said = words.toLowerCase().split(/[^a-z0-9]+/);
  return want.every((n) => said.includes(n)) ? words : "";
}

// Past this the fix is not a door. Phones report their own accuracy in metres, and
// a fix good to 500 m is a street or two — worth keeping, and worth saying out loud,
// because the customer is the one who can still fix it. It is NOT a refusal: she
// confirms every pin anyway, and a gate here would cost an order for no gain.
export const POOR_FIX_M = 150;

// Too vague to be a door, in words the customer can act on, or null when the fix is
// good enough to say nothing about.
export function fixVerdict(accuracyM) {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return null;
  if (accuracyM <= POOR_FIX_M) return null;
  return { accuracyM: Math.round(accuracyM) };
}

// Why a geolocation call failed, in the three answers a browser gives. The code is
// the only thing a phone hands over — the message is a sentence we must not show,
// so it is never read.
function whyOf(err) {
  const code = err && err.code;
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

// Ask the browser where the customer is. The geolocation object is an ARGUMENT
// rather than read off `navigator` inside, for one reason: a browser that has none
// is a real case (any desktop over a plain-HTTP page hands over `undefined`), and a
// test that cannot reach that case is the forgiving shim this project has been
// bitten by four times. It resolves, and never rejects, so every caller has one
// shape to handle.
//
// A position whose numbers are missing or off the planet is "unavailable" rather
// than a pin at 0,0 — the same refusal validPin makes, arriving from the other end.
export function askGeo(geo, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!geo || typeof geo.getCurrentPosition !== "function") {
      resolve({ ok: false, why: "unsupported" });
      return;
    }
    let settled = false;
    const finish = (v) => {
      if (!settled) { settled = true; resolve(v); }
    };
    const onOk = (pos) => {
      const pin = validPin({ lat: pos && pos.coords && pos.coords.latitude, lng: pos && pos.coords && pos.coords.longitude });
      if (!pin) { finish({ ok: false, why: "unavailable" }); return; }
      const acc = pos && pos.coords ? Number(pos.coords.accuracy) : NaN;
      finish({ ok: true, lat: pin.lat, lng: pin.lng, accuracyM: Number.isFinite(acc) ? acc : null });
    };
    try {
      geo.getCurrentPosition(onOk, (err) => finish({ ok: false, why: whyOf(err) }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
    } catch {
      finish({ ok: false, why: "unavailable" });
    }
  });
}

// ── Looking the typed address up (v202) ────────────────────────────────────
//
// The third way the shop can learn where a door is, after "use my location" and the
// map by hand, and the one her own words asked for: type the address and let the map
// come to it, "just like Grab app". What she was describing is the half that was
// missing — the map could always be aimed (store/pin_map.js, goTo), there was simply
// nothing that knew where to aim it.
//
// The lookup itself is made by her own Supabase function (supabase/functions/
// shop-geocode), NOT from this phone to a public geocoder: that is the whole of her
// decision, and the reasoning is written out in that function's own geocode.ts. What
// this file decides is only what is worth ASKING and how to read what comes BACK.
// Both are pure, so both are driven under Node.

// Below this nobody has typed an address yet, they are still part-way through a word.
// "Pen" is a question with no useful answer, and asking it costs one of the handful of
// lookups a free service will take from her in an hour.
export const LOOKUP_MIN = 8;

// A Malaysian address is a street, an area and a postcode. Past this it is not a longer
// address, it is a whole WhatsApp message pasted into the box — and the tail of one of
// those is a telephone number, so the front is the part worth sending. It is CUT rather
// than refused on purpose: a box that silently does nothing when you paste into it is
// the dead control this shop has a standing rule against, and a lookup of the first
// part of a long address is a great deal better than no answer at all.
export const LOOKUP_MAX = 160;

// At most this many rows. The function is asked for five too; this is the shop's own
// promise about how long a list a customer has to read, kept here so a reply that
// ignored the cap cannot make the page longer than the design accounts for.
export const MAX_HITS = 5;

// The text worth asking about, or null. Whitespace is collapsed first, because a
// pasted address arrives with newlines and tabs in it and a geocoder asked for
// "12,\n Jalan" is asked a question nobody would type.
export function lookupQuery(text) {
  const q = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (q.length < LOOKUP_MIN) return null;
  return q.slice(0, LOOKUP_MAX);
}

// The candidates out of the function's reply — the safest possible read of something
// that arrived over a network.
//
// Every point goes through this file's own `validPin`, so a reply is held to exactly
// the rule the order itself is held to: two real numbers, on the planet, tidied to six
// decimals. A row that fails is SKIPPED rather than ending the read, because the row
// below it may be the customer's actual house. `ok` must be true: a reply that says it
// failed is read as having found nothing, whatever else is in it.
export function readPlaces(reply) {
  if (!reply || typeof reply !== "object" || reply.ok !== true) return [];
  const rows = Array.isArray(reply.places) ? reply.places : [];
  const out = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const pin = validPin({ lat: raw.lat, lng: raw.lng });
    if (!pin) continue;
    out.push({ lat: pin.lat, lng: pin.lng, label: String(raw.label == null ? "" : raw.label).trim() });
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

// Why a lookup produced nothing, in the words the customer reads. The function answers
// with a CODE and never a sentence — a sentence chosen on the server is a sentence no
// customer can read in their own language — so the choosing happens here, off the
// shop's own dictionary (store-lang.js).
//
// The five codes collapse to two things a customer can act on, and that is deliberate.
// The difference between a service that answered and one that did not is a difference
// this project can see in its logs and a customer cannot do anything with; what they
// need is to be told that the map is one tap away and still works.
const WHY_KEYS = {
  empty: "addrNone",
  notfound: "addrNone",
  refused: "addrFailed",
  timeout: "addrFailed",
  unreachable: "addrFailed",
};

export function lookupWhy(why) {
  return WHY_KEYS[String(why == null ? "" : why)] || "addrFailed";
}

// ── Asking a second time, more forgivingly (v203) ──────────────────────────
//
// WHY THIS EXISTS, and it was found by measuring rather than by reasoning. A geocoder
// matches the WORDS somebody typed against the words in its index, and a Malaysian
// address carries two kinds of word that index does not hold:
//
//   • THE PART THAT SAYS WHICH DOOR. "No 5", "Blk A", "Lot 1234", "Tkt 3", "Mukim 12" —
//     unit numbers, block letters, lot numbers, floors, sub-districts. OSM maps STREETS
//     and BUILDINGS; none of these are either, and an unmatched token does not merely
//     fail to help, it dilutes the match until the street that IS in the index stops
//     coming back. Four controlled pairs, every one 100% reproducible:
//       "Taman Sri Nibong, 11900 Bayan Lepas, Penang"           → 1     with "12-3-4 Blk A, " in front → 0
//       "Pangsapuri Sri Indah, Penang"                          → 5     with "Blk 12-3-4, "     in front → 0
//       "Lorong Seri Nibong 3, 11900 Bayan Lepas"               → 4     with "No 5 "            in front → 0
//       "Jalan Teluk Kumbar, Penang"                            → 2     with "Lot 1234, Mukim 12, "     → 0
//   • THE SHORTHAND. "Rd" for Road, "Jln" for Jalan, "Tmn" for Taman. The same street
//     spelled the short way is a different string to an index that holds the long way:
//     "Riam Road" answers with four doors and "Riam Rd" with none.
//
// So a question the services ANSWERED with nothing is asked once more, in the most
// forgiving form this file can build. It is a SECOND ask and never a first: the address
// exactly as typed always goes first, so an address that works today is not slowed by a
// millisecond and cannot come back as a different door. That ordering is also what makes
// over-eager stripping safe — a broadened wording is only ever spent on a question the
// exact wording has already failed.
//
// It lives HERE rather than in the function for two reasons. The function's geocode.ts is
// a deliberate copy of your own, and test/shop-geocode.test.js holds the two
// byte-for-byte the same; teaching only the shop's copy a ladder would make that guard
// describe a difference that is no longer the whole truth. And a wording the phone can
// choose is a wording the phone can fix — no redeploy.

// At most this many questions for one typed address. Two: what they typed, and the most
// forgiving form of it. Every rung is a round trip and a unit of the per-IP cap.
export const LADDER_MAX = 2;

// The words that say WHICH DOOR and belong to no map: the word, and the number or letter
// that follows it. `\b` keeps "No" out of "Northeast" and "Lot" out of "Lorong".
const UNIT_LEAD = /^(?:no|lot|blk|block|unit|apt|tkt|tingkat|floor|level|mukim)\b\.?[ \t]*([A-Za-z0-9][A-Za-z0-9\-\/]*)?[ \t,]*/i;

// A number standing on its own where a unit word would be: "12-3-4 Blk A, Taman …". It
// is only stripped when it CONTAINS A DIGIT, so a street name is never eaten — "Riam
// Road" and "Jalan Bunga" are left exactly as they are.
const BARE_LEAD = /^([A-Za-z0-9][A-Za-z0-9\-\/]*)[ \t,]+/;

// One leading unit phrase removed, or NULL when there is nothing of that kind to remove.
// Null and the empty string are different answers and the loop below depends on it: ""
// means the phrase was the WHOLE address, null means there was no phrase to remove. A
// falsy test on the result would confuse the two and hand back an address it had already
// half-eaten.
function stripLeadUnit(s) {
  const t = s.replace(/^[\s,]+/, "");
  const word = UNIT_LEAD.exec(t);
  if (word && word[0].trim()) return t.slice(word[0].length);
  const bare = BARE_LEAD.exec(t);
  if (bare && /\d/.test(bare[1])) return t.slice(bare[0].length);
  return null;
}

// The shorthand Malaysian addresses are written in, and the word each stands for. Kept
// short and unambiguous on purpose: "St" is left alone because it is as likely to be
// Saint as Street, and a wrong expansion costs a lookup for nothing.
const SHORT_WORDS = [
  [/\bjln\b\.?/gi, "Jalan"],
  [/\blor\b\.?/gi, "Lorong"],
  [/\brd\b\.?/gi, "Road"],
  [/\btmn\b\.?/gi, "Taman"],
  [/\bblk\b\.?/gi, "Block"],
  [/\bkg\b\.?/gi, "Kampung"],
  [/\bsg\b\.?/gi, "Sungai"],
  [/\bapt\b\.?/gi, "Apartment"],
  [/\btkt\b\.?/gi, "Tingkat"],
];

// The most forgiving form of an address: every leading unit phrase removed (there can be
// several — "Lot 1234, Mukim 12, Jalan Teluk Kumbar" carries two before the street), and
// then the shorthand spelled out. Empty when nothing is left to ask about.
export function broaden(text) {
  let s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = stripLeadUnit(s);
    if (next === null) break;
    s = next.replace(/^[\s,]+/, "").trim();
    if (!s) return "";
  }
  for (const [re, full] of SHORT_WORDS) s = s.replace(re, full);
  return s.replace(/\s+/g, " ").trim();
}

// The questions worth asking for one typed address, in the order to ask them: exactly
// what they typed, then — only if that is a different, still-askable question — the
// forgiving form. One entry means one ask, which is what every address that works today
// gets and what a miss with nothing left to try gets.
export function lookupLadder(text) {
  const first = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  const wide = broaden(first);
  if (!wide || wide === first || wide.length < LOOKUP_MIN) return [first];
  return [first, wide].slice(0, LADDER_MAX);
}

// Whether a reply is worth asking a second, differently-worded question. Only ONE of the
// function's codes means "the map services answered, and they hold no such door":
// notfound. Every other code says the lookup itself is in trouble — a service that
// refused, timed out or could not be reached — and the same two services asked again
// under other words would give exactly the same silence.
export function askAgain(reply) {
  return !!(reply && typeof reply === "object" && reply.ok === false && reply.why === "notfound");
}
