// test/courier-provider.test.js — the seam, and the two halves either side of it
// (v188, 25 Sep 2026).
//
// Her clause, verbatim: "i want to do Lalamove, API to manage courier, make it ready
// for other courier as well." A comment cannot answer that. This file does, in two
// ways:
//
//   • THE SEAM, ASSERTED ON THE WIRE. One test below drives a real quotation through
//     the client provider with `fetch` stubbed, captures the bytes that would have
//     left the phone, and asserts they carry a JOURNEY — two points and an address —
//     and not one of this app's stored fields. No order id, no customer name, no
//     customer phone, no delivery date, no price. That is what makes a second courier
//     a new file rather than an edit to four screens: nothing above the provider has
//     anything courier-shaped to change, and nothing below it is handed anything from
//     her books.
//
//   • BOTH HALVES' PURE PARTS. The provider's own reading of a reply is worth more
//     tests than usual, because a mis-read reply is a WRONG PRICE shown to her as a
//     real one — and a price she has already quoted to a customer is money she has
//     already lost by the time anyone notices.
//
// Node imports the edge function's TypeScript directly (Node 22 strips the types),
// so the server half is tested as the SAME FILE Deno runs rather than a copy of it.
// The only thing stubbed anywhere below is `fetch` — never a function under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// The client half reads the session out of localStorage before it will call anything
// (couriers/api.js refuses with words instead of a thrown error when it cannot), so
// the phone's own storage is stood in for before the imports below. The shape is
// supabase.js's own: { access_token, expires_at }, live while Date.now() is under it.
globalThis.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
globalThis.localStorage.setItem(
  "bakeadmin.supabase",
  JSON.stringify({ access_token: "test-session-token", expires_at: Date.now() + 3600_000 }),
);

const {
  LALAMOVE_KEY, hostFor, plainReason, notSetUpReason, servicesIn, stopsPayload, quotation,
  cities, llmRequest,
} = await import("../supabase/functions/courier/providers/lalamove.ts");
const { validPoint } = await import("../supabase/functions/courier/place.ts");
const { placesFromResults, placesFromPhoton, geocodeAddress } = await import("../supabase/functions/courier/geocode.ts");
const {
  lalamove, QUOTE_VALID_MS, serviceLabel, sortServices, normaliseVehicles,
  normaliseQuote, normaliseQuotes, distanceKmOf, statusLabel,
} = await import("../admin/js/couriers/lalamove.js");
const { activeCourier, courierByKey, couriers, courierLabel } = await import("../admin/js/couriers.js");

const KEY = "pk_test_0123456789abcdef";
const SECRET = "sk_test_0123456789abcdef";
const T = 1758758400000; // 2025-09-25T00:00:00.000Z

// A configuration as configFor() would build one, so the provider functions are
// exercised exactly as the function exercises them.
function cfg(env = "sandbox") {
  return { key: KEY, secret: SECRET, market: "MY", host: hostFor(env) };
}

// A stubbed wire. Returns the capture so a test can read what would have been sent,
// and a restore so no stub outlives the test that installed it.
function stubFetch(reply) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), method: (opts.method || "GET").toUpperCase(), headers: opts.headers || {}, body: opts.body });
    return typeof reply === "function" ? reply(url, opts) : reply;
  };
  return { sent, restore() { globalThis.fetch = real; } };
}

// A 200 with a JSON body — the shape the real fetch answers with, and no more.
//
// Both readers are on it because the two halves read the wire differently: the
// function's own provider reads `text()` (it wants the bytes that were signed), and
// the app's channel reads `json()`. A stub with only one of the two answers the other
// with a thrown error, which the caller correctly reports as an unreadable answer —
// so a stub missing a method looks exactly like a broken courier.
function jsonReply(obj, status = 200) {
  const text = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── which Lalamove is being talked to ─────────────────────────────────────

test("sandbox unless production is said out loud, so a typo cannot spend real money", () => {
  // The direction of this default is the whole point. An unset, misspelled or
  // unrecognised LALAMOVE_ENV must land on the sandbox — where getting it wrong
  // costs a test booking — rather than on production, where it costs her wallet.
  assert.equal(hostFor("sandbox"), "https://rest.sandbox.lalamove.com");
  assert.equal(hostFor("production"), "https://rest.lalamove.com");
  assert.equal(hostFor("PRODUCTION"), "https://rest.lalamove.com", "the env var is read in whatever case it was typed");
  assert.equal(hostFor(" Production "), "https://rest.lalamove.com");
  assert.equal(hostFor(""), "https://rest.sandbox.lalamove.com");
  assert.equal(hostFor("prod"), "https://rest.sandbox.lalamove.com", "a near miss is not an upgrade to live");
  assert.equal(hostFor(undefined), "https://rest.sandbox.lalamove.com");
});

// ── Lalamove's codes, in her words ────────────────────────────────────────

test("each documented code becomes a sentence she can act on", () => {
  const say = (code) => plainReason({ errors: [{ code }] }, 400);
  assert.match(say("ERR_REVERSE_GEOCODE_FAILURE"), /^Lalamove could not place one of these addresses — put the pin on the map/);
  assert.match(say("ERR_QUOTATION_EXPIRED"), /five minutes old/);
  assert.match(say("ERR_QUOTATION_NOT_FOUND"), /fresh one/);
  assert.match(say("ERR_INSUFFICIENT_CREDIT"), /wallet/);
  assert.match(say("ERR_INSUFFICIENT_BALANCE"), /wallet/);
  assert.match(say("ERR_OUT_OF_SERVICE_AREA"), /does not cover/);
  assert.match(say("ERR_INVALID_SERVICE_TYPE"), /does not run that vehicle/);
  assert.match(say("ERR_INVALID_PHONE_NUMBER"), /phone number/);
  assert.match(say("ERR_INVALID_STOPS"), /one of the stops/);
  assert.match(say("ERR_CANCELLATION_FORBIDDEN"), /will not let this trip be cancelled/);
});

test("the two codes whose own words would be useless carry the number she needs", () => {
  // These two are the reason this map exists at all. "ERR_TOO_MANY_STOPS" and
  // "ERR_INVALID_SCHEDULE_TIME" are both codes she would otherwise have to look up,
  // and both set real limits she has to plan inside: 16 drops, and a pickup two hours
  // to thirty days out.
  const tooMany = plainReason({ errors: [{ code: "ERR_TOO_MANY_STOPS" }] }, 400);
  assert.match(tooMany, /will not carry this many drops/);
  const when = plainReason({ errors: [{ code: "ERR_INVALID_SCHEDULE_TIME" }] }, 400);
  assert.match(when, /at least two hours/);
  assert.match(when, /thirty days/);
});

test("the code is read from errors[].id too, because the two releases disagree", () => {
  assert.match(plainReason({ errors: [{ id: "ERR_TOO_MANY_STOPS" }] }, 400), /this many drops/);
});

test("the code wins over the API's own message, so the sentence she gets is the useful one", () => {
  const out = plainReason({ message: "Bad Request", errors: [{ code: "ERR_QUOTATION_EXPIRED", message: "quotation not valid" }] }, 400);
  assert.match(out, /five minutes old/);
  assert.equal(out.includes("quotation not valid"), false, "the raw text is dropped when the code is known");
});

test("a refused key is its own sentence, and it names both keys and both environments", () => {
  // The likeliest failure of the whole feature, and the one that looks like nothing
  // on screen: 401 with no useful words. So 401 and 403 speak here whatever the body
  // happens to carry.
  for (const status of [401, 403]) {
    const out = plainReason({ message: "Unauthorized" }, status);
    assert.match(out, /refused the key/);
    assert.match(out, /api key and secret/);
    assert.match(out, /sandbox pair or the live pair/);
  }
  assert.match(plainReason(null, 401), /refused the key/, "even with no body to read");
});

test("a key that was never added is its own sentence, and not the 'no such courier' one (v194)", () => {
  // THE SENTENCE THE APP GOT WRONG UNTIL v194, and it was found by reading the drawn
  // Settings card rather than by reasoning. A secret that was never put on the server and
  // a courier the build does not carry are different problems, and both used to answer
  // with "This build has no courier called lalamove" - a claim about the APP, and false,
  // because the app was fine and one secret was missing. Nothing in this suite asserted
  // what that card says when the key is simply absent, which is the state every new
  // account starts in; the state she was actually in on 25 Sep 2026, having deployed the
  // function before any Lalamove account existed.
  const out = notSetUpReason();
  assert.match(out, /api key and secret have not been added/);
  assert.ok(
    out.includes(courierLabel()),
    `the sentence must name the courier the way the registry names it, got: ${out}`,
  );
  assert.equal(
    /no courier called/.test(out),
    false,
    "and it must never claim the build is missing the courier",
  );
});

test("the dispatcher sends a missing secret and an unknown courier to two different sentences (v194)", async () => {
  // THE GUARD ON THE FIX ITSELF. index.ts is the one file this suite cannot load - it
  // starts with a `jsr:` specifier and calls Deno.serve - so the two branches collapsing
  // back into one would leave every test here green. It reads both branches instead and
  // requires each to own its words, which is also what makes the fix breakable on
  // purpose: put the old single sentence back in either branch and this goes red.
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const here = path.dirname(new URL(import.meta.url).pathname);
  const src = await readFile(
    path.join(here, "..", "supabase", "functions", "courier", "index.ts"),
    "utf8",
  );

  const missing = src.match(/if \(!apiKey \|\| !secret\) \{[\s\S]*?\n  \}/);
  assert.ok(missing, "the missing-secret branch must still exist");
  assert.match(missing[0], /notSetUpReason\(\)/, "a missing key speaks with the provider's own sentence");
  assert.equal(
    /no courier called/.test(missing[0]),
    false,
    "and never with the 'no such courier' one",
  );

  const unknown = src.match(/if \(key !== LALAMOVE_KEY\) \{[\s\S]*?\n  \}/);
  assert.ok(unknown, "the unknown-courier branch must still exist");
  assert.match(unknown[0], /This build has no courier called/, "an unknown courier keeps its own claim");
});

test("a code nobody wrote a sentence for is still readable", () => {
  // The half that keeps an unanticipated failure usable: the API's own words, under a
  // plain first line, so she can at least quote it back.
  const withError = plainReason({ errors: [{ code: "ERR_SOMETHING_NEW", message: "the fleet is asleep" }] }, 400);
  assert.match(withError, /^Lalamove would not do that: the fleet is asleep/);
  const withMessage = plainReason({ message: "the fleet is asleep" }, 400);
  assert.match(withMessage, /^Lalamove would not do that: the fleet is asleep/);
});

test("a failure with nothing in it still says something true", () => {
  assert.equal(plainReason(null, 502), "Lalamove answered with an error (HTTP 502).");
  assert.equal(plainReason("not an object", 502), "Lalamove answered with an error (HTTP 502).");
  assert.equal(plainReason({ errors: [] }, 500), "Lalamove answered with an error (HTTP 500).");
  assert.equal(plainReason({ errors: [{ code: "   " }] }, 500), "Lalamove answered with an error (HTTP 500).", "a blank code is not a code");
});

// ── the fleet, read from Lalamove rather than written down here ───────────

test("every vehicle in every city, each named once", () => {
  const data = { data: [
    { locode: "MYPEN", services: [{ key: "MOTORCYCLE", name: "Motorcycle" }, { key: "CAR", name: "Car" }] },
    { locode: "MYKUL", services: [{ key: "CAR", name: "Car" }, { key: "VAN", name: "Van" }] },
  ] };
  assert.deepEqual(servicesIn(data), [
    { key: "MOTORCYCLE", name: "Motorcycle" },
    { key: "CAR", name: "Car" },
    { key: "VAN", name: "Van" },
  ], "the first spelling of a repeated key is kept, and the order is the API's own");
});

test("a malformed city list yields what it can and invents nothing", () => {
  assert.deepEqual(servicesIn(null), []);
  assert.deepEqual(servicesIn({}), []);
  assert.deepEqual(servicesIn({ data: "nonsense" }), []);
  assert.deepEqual(servicesIn({ data: [{ services: "nonsense" }] }), []);
  assert.deepEqual(servicesIn({ data: [{ services: [{ name: "No key" }] }] }), [], "a vehicle with no key cannot be asked for, so it is not offered");
  // A bare array is accepted too: the two shapes have both been documented.
  assert.deepEqual(servicesIn([{ services: [{ key: "CAR", name: "Car" }] }]), [{ key: "CAR", name: "Car" }]);
});

// ── the trip, in Lalamove's words ─────────────────────────────────────────

test("coordinates go out as STRINGS, which is how v3 documents them", () => {
  // A number where a string is expected is the kind of mismatch that comes back as a
  // stop Lalamove cannot place — a code she cannot act on, for a point that is fine.
  const out = stopsPayload([{ lat: 5.4141, lng: 100.3288, address: "  12 Jalan Bunga  " }]);
  assert.equal(out[0].coordinates.lat, "5.4141");
  assert.equal(out[0].coordinates.lng, "100.3288");
  assert.equal(out[0].address, "12 Jalan Bunga", "trimmed, because it is shown to the driver");
});

test("a stop with no address still carries the point it was given", () => {
  assert.deepEqual(stopsPayload([{ lat: 5.4, lng: 100.3 }]), [{ coordinates: { lat: "5.4", lng: "100.3" }, address: "" }]);
});

test("the quotation body is wrapped in `data`, and carries the service, the language and the stops", async () => {
  // THE WRAPPER IS ASSERTED FIRST, and on its own, because it is the one part of this
  // request that v188 got wrong in a way no test could have seen. Lalamove refuses an
  // unwrapped body as malformed — its own words for ERR_INSUFFICIENT_STOPS say
  // "the request body structure is incorrect. I.e: {data: {...}}" — and with no key in
  // the app, no request was ever really made, so nothing failed and nothing was caught.
  // A test can only assert the shape its author already believed.
  const s = stubFetch(jsonReply({ data: { quotationId: "q1" } }));
  try {
    await quotation(cfg(), { serviceType: "MOTORCYCLE", points: [{ lat: 5.4, lng: 100.3, address: "A" }] });
    const sent = JSON.parse(s.sent[0].body);
    assert.deepEqual(Object.keys(sent), ["data"], "the body IS the envelope and nothing sits beside it");
    const body = sent.data;
    assert.equal(body.serviceType, "MOTORCYCLE");
    assert.equal(body.language, "en_MY");
    assert.equal(body.stops.length, 1);
    assert.equal(body.stops[0].coordinates.lat, "5.4");
  } finally { s.restore(); }
});

test("the quotation's reply is unwrapped once, so everything above reads one shape", async () => {
  // The other half of the same defect: the quotation id sits inside Lalamove's `data`,
  // and a client that read the outer body would find no quotation at all and report
  // "no price" for a price that came back fine.
  const s = stubFetch(jsonReply({ data: { quotationId: "q1", priceBreakdown: { total: "8.50" } } }));
  try {
    const out = await quotation(cfg(), { serviceType: "CAR", points: [{ lat: 5.4, lng: 100.3 }] });
    assert.equal(out.ok, true);
    assert.equal(out.data.quotationId, "q1", "the id is read from inside the envelope");
    assert.equal(out.data.priceBreakdown.total, "8.50");
  } finally { s.restore(); }
});

test("no time means no scheduleAt — an empty string is malformed to this API, not now", async () => {
  // Sending "" would be read as a schedule rather than as an absence, and the
  // quotation would be refused for a trip she is asking about right now.
  const s = stubFetch(jsonReply({ data: {} }));
  const inner = (i) => JSON.parse(s.sent[i].body).data;
  try {
    await quotation(cfg(), { serviceType: "CAR", points: [{ lat: 5.4, lng: 100.3 }] });
    assert.equal("scheduleAt" in inner(0), false);
    await quotation(cfg(), { serviceType: "CAR", points: [{ lat: 5.4, lng: 100.3 }], scheduleAt: "2026-09-25T02:00:00.000Z" });
    assert.equal(inner(1).scheduleAt, "2026-09-25T02:00:00.000Z");
    await quotation(cfg(), { serviceType: "CAR", points: [{ lat: 5.4, lng: 100.3 }], scheduleAt: "   " });
    assert.equal("scheduleAt" in inner(2), false, "whitespace is not a time either");
  } finally { s.restore(); }
});

// ── the signed request, on a stubbed wire ─────────────────────────────────

test("the signature is verifiable by an independent implementation of the same standard", async () => {
  // The strongest assertion available without Lalamove's own server: recompute the
  // header from the captured bytes using node:crypto, and require the two to match.
  // A wrong separator, a lowercase verb or a seconds timestamp all fail right here.
  const s = stubFetch(jsonReply({ data: [] }));
  try {
    await cities(cfg());
    const { url, headers } = s.sent[0];
    const m = String(headers.Authorization).match(/^hmac (.+):(\d+):([0-9a-f]{64})$/);
    assert.ok(m, "the header is hmac KEY:TIMESTAMP:SIGNATURE");
    assert.equal(m[1], KEY);
    assert.match(m[2], /^\d{13}$/, "milliseconds, so thirteen digits");
    const base = `${m[2]}\r\nGET\r\n/v3/cities\r\n\r\n`;
    assert.equal(m[3], createHmac("sha256", SECRET).update(base).digest("hex"));
    assert.equal(url, "https://rest.sandbox.lalamove.com/v3/cities");
  } finally { s.restore(); }
});

test("the market and a fresh nonce travel with every call", async () => {
  const s = stubFetch(jsonReply({ data: [] }));
  try {
    await cities(cfg());
    await cities(cfg());
    assert.equal(s.sent[0].headers.Market, "MY");
    assert.equal(s.sent[1].headers.Market, "MY");
    assert.match(s.sent[0].headers["Request-ID"], UUID);
    assert.notEqual(s.sent[0].headers["Request-ID"], s.sent[1].headers["Request-ID"], "a retried call must not look like a duplicate");
  } finally { s.restore(); }
});

test("the query string is sent in the URL and left out of the signature", async () => {
  // Lalamove verifies the path it received. Signing the market into the path would
  // be a 401 on every call with nothing on screen to explain it.
  const s = stubFetch(jsonReply({ data: [] }));
  try {
    await llmRequest(cfg(), { method: "GET", path: "/v3/orders/abc", query: "market=MY" });
    const { url, headers } = s.sent[0];
    assert.equal(url, "https://rest.sandbox.lalamove.com/v3/orders/abc?market=MY");
    const m = String(headers.Authorization).match(/^hmac (.+):(\d+):([0-9a-f]{64})$/);
    const base = `${m[2]}\r\nGET\r\n/v3/orders/abc\r\n\r\n`;
    assert.equal(m[3], createHmac("sha256", SECRET).update(base).digest("hex"));
  } finally { s.restore(); }
});

test("a GET carries no body, and a POST carries the serialised one", async () => {
  const s = stubFetch(jsonReply({ data: {} }));
  try {
    await llmRequest(cfg(), { method: "GET", path: "/v3/cities" });
    assert.equal(s.sent[0].body, undefined);
    await llmRequest(cfg(), { method: "POST", path: "/v3/quotations", body: { a: 1 } });
    assert.equal(s.sent[1].body, '{"a":1}');
  } finally { s.restore(); }
});

test("the secret is nowhere in what leaves — it is inside the HMAC and nowhere else", async () => {
  // The wall this whole function exists for. If the secret can be read off the wire
  // it can be read by anyone who opens the app's page, and it is somebody's wallet.
  const s = stubFetch(jsonReply({ data: {} }));
  try {
    await llmRequest(cfg(), { method: "POST", path: "/v3/quotations", body: { serviceType: "CAR" } });
    const everything = `${s.sent[0].url} ${JSON.stringify(s.sent[0].headers)} ${s.sent[0].body || ""}`;
    assert.equal(everything.includes(SECRET), false);
    assert.equal(String(s.sent[0].headers.Authorization).includes(SECRET), false, "the hmac header carries a digest, not the secret");
  } finally { s.restore(); }
});

test("a refused call is read into a sentence, and a 200 is not an error", async () => {
  const s = stubFetch(jsonReply({ errors: [{ code: "ERR_TOO_MANY_STOPS" }] }, 400));
  try {
    const out = await quotation(cfg(), { serviceType: "CAR", points: [{ lat: 5.4, lng: 100.3 }] });
    assert.equal(out.ok, false);
    assert.equal(out.status, 400);
    assert.match(out.reason, /will not carry this many drops/);
    assert.equal(out.data.errors[0].code, "ERR_TOO_MANY_STOPS", "the raw reply travels with it, for a log line");
  } finally { s.restore(); }
});

test("an answer that is not JSON is a failure with words, not a throw", async () => {
  // Lalamove's own gateway answering with an HTML error page, which is what a
  // misconfigured host looks like from here.
  const s = stubFetch({ ok: false, status: 502, text: async () => "<html>bad gateway</html>" });
  try {
    const out = await cities(cfg());
    assert.equal(out.ok, false);
    assert.equal(out.data, null);
    assert.equal(out.reason, "Lalamove answered with an error (HTTP 502).");
  } finally { s.restore(); }
});

test("a network that does not answer is said plainly, and never thrown at the pop-up she pressed", async () => {
  const s = stubFetch(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
  try {
    const out = await cities(cfg());
    assert.equal(out.ok, false);
    assert.equal(out.status, 0);
    assert.match(out.reason, /^Could not reach Lalamove — getaddrinfo ENOTFOUND/);
  } finally { s.restore(); }
});

// ── the geocoder's reply, read once, in one place ─────────────────────────

test("Nominatim's lon is read into the app's lng", () => {
  const places = placesFromResults([{ lat: "5.4141", lon: "100.3288", display_name: "12, Jalan Bunga, Penang" }]);
  assert.deepEqual(places, [{ lat: 5.4141, lng: 100.3288, label: "12, Jalan Bunga, Penang" }]);
});

test("a geocode reply with no point in it is a miss, not an equator", () => {
  // The same trap, at the boundary where a miss is a normal answer: a result row whose
  // coordinates came back null must NOT become 0,0 — a real point in the Gulf of
  // Guinea, a hundred degrees from Penang, and a driver sent there.
  assert.deepEqual(placesFromResults([]), []);
  assert.deepEqual(placesFromResults(null), []);
  assert.deepEqual(placesFromResults([{}]), []);
  assert.deepEqual(placesFromResults([{ lat: null, lon: null, display_name: "Nowhere" }]), []);
  assert.deepEqual(placesFromResults([{ lat: "5.4" }]), [], "half a point is not a point");
  assert.deepEqual(placesFromResults([{ lon: "100.3" }]), []);
  assert.deepEqual(placesFromResults([{ lat: "north", lon: "east" }]), []);
});

test("every candidate is kept, in the service's own order (v198)", () => {
  // What this test replaced: "the first result is the one that is kept". That WAS the
  // behaviour, and it was the whole problem — the candidates behind the first were read
  // correctly and then thrown away, so a pin on the wrong street was hers to notice and
  // drag. The order still matters, which is why it is asserted: index 0 is what the quote
  // card and the delivery run act on, so it has to stay the service's own first choice.
  const places = placesFromResults([
    { lat: "5.4", lon: "100.3" },
    { lat: "1", lon: "1", display_name: "Second" },
    { lat: "2", lon: "2", display_name: "Third" },
  ]);
  assert.deepEqual(places, [
    { lat: 5.4, lng: 100.3, label: "" },
    { lat: 1, lng: 1, label: "Second" },
    { lat: 2, lng: 2, label: "Third" },
  ], "a missing label is still an empty string, not the string 'null'");
  // A row that points nowhere no longer ends the read. The row under it may be her door,
  // and stopping at a broken one would throw the right answer away for nothing.
  assert.deepEqual(
    placesFromResults([{ lat: null, lon: null }, { lat: "5.4", lon: "100.3", display_name: "The real one" }]),
    [{ lat: 5.4, lng: 100.3, label: "The real one" }]);
});

test("the list stops at five, however many the service sends (v198)", () => {
  // Five is the promise the app makes her about how long a list she has to read, and it
  // is enforced here rather than trusted to the query string. The cap is applied to the
  // candidates that SURVIVE the readers, so a reply of fifty rows of which two are
  // Malaysian is a list of two.
  const many = Array.from({ length: 9 }, (_, i) => ({ lat: String(5 + i / 100), lon: "100.3", display_name: `Row ${i}` }));
  const kept = placesFromResults(many);
  assert.equal(kept.length, 5);
  assert.equal(kept[4].label, "Row 4", "the first five in order, not five from anywhere in the list");

  const features = Array.from({ length: 9 }, (_, i) => ({
    properties: { countrycode: "MY", name: `Row ${i}` }, geometry: { coordinates: [100.3, 5.4 + i / 100] },
  }));
  assert.equal(placesFromPhoton({ features }).length, 5);

  // Nine replies, one of them Malaysian, is a list of one — the cap never invents rows.
  const mostlyForeign = Array.from({ length: 8 }, () => ({
    properties: { countrycode: "SG", name: "Not ours" }, geometry: { coordinates: [103.8, 1.28] },
  })).concat([{ properties: { countrycode: "MY", name: "Ours" }, geometry: { coordinates: [100.3, 5.4] } }]);
  assert.deepEqual(placesFromPhoton({ features: mostlyForeign }), [{ lat: 5.4, lng: 100.3, label: "Ours" }]);
});

test("the same door offered twice is offered once (v198)", async () => {
  // Photon really does this: one house written with and without its street name is two
  // rows to the service and one door to her, and a list she has to read should not spend
  // two of its five rows on one answer. Only the LABELS are compared, and an empty one is
  // never collapsed — every candidate with nothing to say has the same nothing, which is
  // no evidence at all that they are the same place.
  const s = stubFetch(jsonReply({ features: [
    { properties: { countrycode: "MY", name: "Chulia Street", city: "George Town" }, geometry: { coordinates: [100.3, 5.4] } },
    { properties: { countrycode: "MY", name: "Chulia Street", city: "George Town" }, geometry: { coordinates: [100.31, 5.41] } },
    { properties: { countrycode: "MY", name: "CHULIA STREET", city: "George Town" }, geometry: { coordinates: [100.32, 5.42] } },
    { properties: { countrycode: "MY" }, geometry: { coordinates: [100.4, 5.5] } },
    { properties: { countrycode: "MY" }, geometry: { coordinates: [100.5, 5.6] } },
  ] }));
  try {
    const out = await geocodeAddress("Chulia Street, George Town");
    assert.equal(out.ok, true);
    assert.deepEqual(out.places.map((p) => p.label), ["Chulia Street, George Town", "", ""],
      "case is not a different door, and two blank labels are not one door");
    assert.deepEqual(out.place, out.places[0], "the single answer is the first of the list, always");
  } finally { s.restore(); }
});

// ── the second service, and the order the two are asked in (v196) ─────────
//
// Her bug, on her phone: "The address lookup service did not answer. Put the pin on
// the map instead." — twice, on an ordinary Penang address. That sentence is the
// refusal branch, so the service had answered, and refused. The tests below are what
// a single-service geocoder could not have had: the fallback itself, and the four
// different things that can go wrong now being told apart rather than lumped into one
// sentence she cannot act on.

test("Photon's point is read longitude-first, into the app's lat and lng the right way round (v196)", () => {
  // The real shape of a real reply, trimmed to what is read. Photon is GeoJSON, and
  // GeoJSON writes coordinates LONGITUDE FIRST — the opposite order to every other
  // point in this app. Read in the order written, a Penang street becomes latitude
  // 100.33, which the range check refuses, so the failure would be a pin that quietly
  // never appears rather than a wrong one — bad either way, and silent.
  const reply = {
    features: [{
      properties: { countrycode: "MY", name: "Chulia Street", city: "George Town", postcode: "10200" },
      geometry: { type: "Point", coordinates: [100.3352289, 5.4188221] },
    }],
  };
  assert.deepEqual(placesFromPhoton(reply), [{
    lat: 5.4188221, lng: 100.3352289, label: "Chulia Street, George Town, 10200",
  }]);
});

test("a result from another country is skipped, and the Malaysian one behind it is taken (v196)", () => {
  // Both services are asked for Malaysian answers only, so a same-named street abroad
  // can never be handed back as her customer's door. Skipped rather than refused: the
  // right answer may be the next result in the list.
  const reply = {
    features: [
      { properties: { countrycode: "SG", name: "Chulia Street" }, geometry: { coordinates: [103.8, 1.28] } },
      { properties: { countrycode: "MY", name: "Lebuh Chulia" }, geometry: { coordinates: [100.3352, 5.4188] } },
    ],
  };
  assert.deepEqual(placesFromPhoton(reply), [{ lat: 5.4188, lng: 100.3352, label: "Lebuh Chulia" }]);
  // A country said in lower case is the same country.
  const lower = { features: [{ properties: { countrycode: "my", name: "X" }, geometry: { coordinates: [100.3, 5.4] } }] };
  assert.deepEqual(placesFromPhoton(lower), [{ lat: 5.4, lng: 100.3, label: "X" }]);
  // And the filter is per FEATURE, not a rule about which one comes first: a foreign
  // result in the middle of the list is dropped without taking its neighbours with it.
  const mixed = { features: [
    { properties: { countrycode: "MY", name: "First" }, geometry: { coordinates: [100.3, 5.4] } },
    { properties: { countrycode: "SG", name: "Not ours" }, geometry: { coordinates: [103.8, 1.28] } },
    { properties: { countrycode: "MY", name: "Third" }, geometry: { coordinates: [100.4, 5.5] } },
  ] };
  assert.deepEqual(placesFromPhoton(mixed).map((p) => p.label), ["First", "Third"]);
});

test("a Photon reply that points nowhere is a miss, not an equator (v196)", () => {
  const MY = (coords) => ({ properties: { countrycode: "MY", name: "X" }, geometry: { coordinates: coords } });
  assert.deepEqual(placesFromPhoton(null), []);
  assert.deepEqual(placesFromPhoton({}), []);
  assert.deepEqual(placesFromPhoton({ features: [] }), []);
  assert.deepEqual(placesFromPhoton({ features: [{ properties: { countrycode: "MY" } }] }), [], "a feature with no geometry at all");
  assert.deepEqual(placesFromPhoton({ features: [MY([])] }), []);
  assert.deepEqual(placesFromPhoton({ features: [MY([100.3])] }), [], "half a point is not a point");
  assert.deepEqual(placesFromPhoton({ features: [MY([100.3, null])] }), []);
  assert.deepEqual(placesFromPhoton({ features: [MY(["east", "north"])] }), []);
  assert.deepEqual(placesFromPhoton({ features: [{ properties: {}, geometry: { coordinates: [100.3, 5.4] } }] }), [],
    "no country is not a Malaysian answer");
  assert.deepEqual(placesFromPhoton({ features: [{ properties: { countrycode: "TH" }, geometry: { coordinates: [100.3, 5.4] } }] }), []);
  // A feature that points nowhere no longer ends the read, for the same reason a foreign
  // one does not: the next feature down may be the right door.
  assert.deepEqual(placesFromPhoton({ features: [MY(["north", "east"]), MY([100.3, 5.4])] }),
    [{ lat: 5.4, lng: 100.3, label: "X" }]);
});

test("the pin wears the parts of a Photon answer that are there, and no empty commas (v196)", () => {
  const label = (p) => placesFromPhoton({ features: [{ properties: p, geometry: { coordinates: [100.3, 5.4] } }] })[0].label;
  assert.equal(label({ countrycode: "MY", name: "Only A Name" }), "Only A Name");
  assert.equal(label({ countrycode: "MY", name: "Road", postcode: "10200" }), "Road, 10200", "a missing town leaves no gap");
  assert.equal(label({ countrycode: "MY", district: "Timur Laut", name: "Road" }), "Road, Timur Laut", "district stands in for a missing city");
  assert.equal(label({ countrycode: "MY", locality: "Little India", name: "Road" }), "Road, Little India");
  assert.equal(label({ countrycode: "MY" }), "", "nothing to say is said as nothing");
});

test("no address typed is not a lookup, and no service is asked (v196)", async () => {
  const s = stubFetch(jsonReply({ features: [] }));
  try {
    const out = await geocodeAddress("   ");
    assert.equal(out.ok, false);
    assert.equal(out.reason, "There is no address to look up.");
    assert.equal(s.sent.length, 0, "nothing to look up must not be a request to anyone");
  } finally { s.restore(); }
});

test("the first service that answers with a place wins, and the second is never asked (v196)", async () => {
  const s = stubFetch(jsonReply({
    features: [{ properties: { countrycode: "MY", name: "Chulia Street", city: "George Town" }, geometry: { coordinates: [100.3352289, 5.4188221] } }],
  }));
  try {
    const out = await geocodeAddress("Lebuh Chulia, George Town, Penang");
    assert.equal(out.ok, true);
    assert.deepEqual(out.place, { lat: 5.4188221, lng: 100.3352289, label: "Chulia Street, George Town" });
    assert.equal(s.sent.length, 1, "one ask, because it answered");
    assert.match(s.sent[0].url, /^https:\/\/photon\.komoot\.io\/api\//);
    assert.match(s.sent[0].url, /limit=5/, "several results, so a foreign one can be skipped for a Malaysian one");
    assert.match(s.sent[0].url, /q=Lebuh%20Chulia/, "her words travel percent-encoded");
  } finally { s.restore(); }
});

test("a refusal from the first service is not the end of the lookup — the second one is asked (v196)", async () => {
  // THIS IS HER BUG. Nominatim refused this function twice in a row on 25 Sep 2026,
  // and because it was the only service asked, the whole lookup was refused with it.
  // A refusal is one service's answer, not the end of the question.
  const s = stubFetch((url) => (String(url).includes("photon.komoot.io")
    ? jsonReply({ error: "forbidden" }, 403)
    : jsonReply([{ lat: "5.4188", lon: "100.3352", display_name: "Lebuh Chulia, George Town, Penang" }])));
  try {
    const out = await geocodeAddress("Lebuh Chulia, George Town, Penang");
    assert.equal(out.ok, true, "the second service's answer is the lookup's answer");
    assert.deepEqual(out.place, { lat: 5.4188, lng: 100.3352, label: "Lebuh Chulia, George Town, Penang" });
    assert.equal(s.sent.length, 2, "the refusal did not stop the second ask");
    assert.match(s.sent[1].url, /^https:\/\/nominatim\.openstreetmap\.org\/search/);
    assert.match(s.sent[1].url, /countrycodes=my/, "the second ask is filtered to Malaysia the same way");
    assert.match(String(s.sent[1].headers["User-Agent"]), /^MunchiesFurkidz-Courier\//,
      "Nominatim's policy asks who is calling, and the ask still says so");
  } finally { s.restore(); }
});

test("when both services refuse, she is told the lookup did not answer, and pointed at the pin (v196)", async () => {
  const s = stubFetch(jsonReply({}, 403));
  try {
    const out = await geocodeAddress("Lebuh Chulia, George Town, Penang");
    assert.equal(out.ok, false);
    assert.match(out.reason, /did not answer/);
    assert.match(out.reason, /Put the pin on the map instead/);
    assert.equal(s.sent.length, 2, "both were asked before she was told");
  } finally { s.restore(); }
});

test("when both services answer but neither knows the address, that is a miss and not a fault (v196)", async () => {
  // A house in a new estate is simply not in OpenStreetMap. That is not an error to
  // report, and the words must not blame the service for it.
  const s = stubFetch((url) => (String(url).includes("photon.komoot.io")
    ? jsonReply({ features: [] })
    : jsonReply([])));
  try {
    const out = await geocodeAddress("12, Jalan Baru, Penang");
    assert.equal(out.ok, false);
    assert.match(out.reason, /was not found/);
    assert.doesNotMatch(out.reason, /did not answer|could not be reached/);
  } finally { s.restore(); }
});

test("a lookup nobody answers in time says so, and is not left hanging (v196)", async () => {
  // The stub honours the signal the way a real fetch does — it rejects with an
  // AbortError when the caller's own timer fires. A stub that ignored the signal would
  // leave this test hanging for ever instead of failing, which is the same class of
  // kindness that hid three other faults in this repo.
  const s = stubFetch((url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      reject(err);
    });
  }));
  try {
    const out = await geocodeAddress("Lebuh Chulia, George Town, Penang", { timeoutMs: 10 });
    assert.equal(out.ok, false);
    assert.match(out.reason, /did not answer in time/);
  } finally { s.restore(); }
});

test("a lookup whose network cannot be reached says so, and says which problem it was (v196)", async () => {
  const s = stubFetch(async () => { throw new TypeError("fetch failed"); });
  try {
    const out = await geocodeAddress("Lebuh Chulia, George Town, Penang");
    assert.equal(out.ok, false);
    assert.match(out.reason, /could not be reached/);
    assert.doesNotMatch(out.reason, /did not answer in time/, "a dead network is not a slow one");
  } finally { s.restore(); }
});

// ── the client half: which vehicles she is offered ────────────────────────

test("a vehicle is never nameless, because a nameless row cannot be chosen", () => {
  assert.equal(serviceLabel("MOTORCYCLE", "Motorcycle"), "Motorcycle", "Lalamove's own name wins when it sent one");
  assert.equal(serviceLabel("MOTORCYCLE"), "Motorcycle");
  assert.equal(serviceLabel("TRUCK"), "Truck", "a key said in words beats a blank");
  // Two of the keys in Malaysia's own fleet start with a number, and a digit does not
  // open a word for a `\b`-based capitaliser. Without the fix below these two would
  // read "7ft Van" and "4x4" — the vehicle's name spelled wrong on the one row she can
  // use to tell it from the car beside it.
  assert.equal(serviceLabel("7FT_VAN"), "7Ft Van");
  assert.equal(serviceLabel("9FT_VAN"), "9Ft Van");
  assert.equal(serviceLabel("4X4"), "4X4");
  assert.equal(serviceLabel("4X4"), "4X4");
  assert.equal(serviceLabel("", ""), "Vehicle");
  assert.equal(serviceLabel(null), "Vehicle");
  assert.equal(serviceLabel("CAR", "   "), "Car", "whitespace is not a name");
});

test("the fleet is ordered the way she thinks about it, smallest first", () => {
  const list = [{ key: "VAN" }, { key: "MOTORCYCLE" }, { key: "CAR" }];
  assert.deepEqual(sortServices(list).map((v) => v.key), ["MOTORCYCLE", "CAR", "VAN"]);
  assert.deepEqual(list.map((v) => v.key), ["VAN", "MOTORCYCLE", "CAR"], "the list handed in is not reordered under the caller");
});

test("a vehicle we did not anticipate is shown rather than hidden", () => {
  // A market with a fleet this app never heard of must still be usable: the known
  // ones sort first, everything else follows alphabetically.
  const out = sortServices([{ key: "ZEPPELIN" }, { key: "CAR" }, { key: "AIRBOAT" }]).map((v) => v.key);
  assert.deepEqual(out, ["CAR", "AIRBOAT", "ZEPPELIN"]);
});

test("the vehicle list is deduped, and an entry with no key is dropped rather than shown blank", () => {
  const out = normaliseVehicles([
    { key: "MOTORCYCLE", name: "Motorcycle" },
    { key: "MOTORCYCLE", name: "Motorcycle (again)" },
    { name: "No key" },
    { key: "CAR" },
    null,
  ]);
  assert.deepEqual(out, [{ key: "MOTORCYCLE", name: "Motorcycle" }, { key: "CAR", name: "Car" }]);
  assert.deepEqual(normaliseVehicles(null), []);
  assert.deepEqual(normaliseVehicles("nonsense"), []);
});

// ── the client half: reading a price she is about to quote ────────────────

test("the total is read from the price breakdown, and the currency with it", () => {
  const q = normaliseQuote({
    quotationId: "q-1", serviceType: "MOTORCYCLE",
    priceBreakdown: { total: "18.50", currency: "MYR", base: "15.00", vat: "0.90" },
  }, T);
  assert.equal(q.id, "q-1");
  assert.equal(q.service, "MOTORCYCLE");
  assert.equal(q.amount, 18.5);
  assert.equal(q.currency, "MYR");
  assert.deepEqual(q.breakdown, { base: 15, vat: 0.9 });
});

test("a price is rounded to the sen, because it is money on a screen", () => {
  assert.equal(normaliseQuote({ priceBreakdown: { total: "18.505" } }, T).amount, 18.51);
  assert.equal(normaliseQuote({ priceBreakdown: { total: "18.504" } }, T).amount, 18.5);
});

test("a reply with no price in it is null, not a price of zero", () => {
  // The rule this test exists for. RM0.00 is a real price shown as a real price, and
  // she would quote it. Nothing is the honest answer, and the panel says so.
  assert.equal(normaliseQuote({ quotationId: "q-1" }, T), null);
  assert.equal(normaliseQuote({}, T), null);
  assert.equal(normaliseQuote(null, T), null);
  assert.equal(normaliseQuote("nonsense", T), null);
  assert.equal(normaliseQuote({ priceBreakdown: { total: null } }, T), null);
  assert.equal(normaliseQuote({ priceBreakdown: { total: "free" } }, T), null);
});

test("a total that came back as null is not converted into zero", () => {
  // `Number(null)` is 0. So is `Number("")`. Both would have printed as RM0.00 under a
  // real trip — the one reading of a reply that becomes money she has already lost.
  assert.equal(normaliseQuote({ amount: null }, T), null);
  assert.equal(normaliseQuote({ priceBreakdown: { total: "" } }, T), null);
  assert.equal(normaliseQuote({ priceBreakdown: { total: [] } }, T), null);
});

test("a total of zero, if Lalamove ever sent one, is a price and is shown", () => {
  // The other half of the rule: 0 is a number. Refusing it would be inventing an
  // absence where the API stated something.
  assert.equal(normaliseQuote({ priceBreakdown: { total: 0 } }, T).amount, 0);
});

test("the price falls back to the reply's own top level when there is no breakdown", () => {
  assert.equal(normaliseQuote({ total: "20.00" }, T).amount, 20);
  assert.equal(normaliseQuote({ amount: "21.00" }, T).amount, 21);
  assert.equal(normaliseQuote({ total: "  22.00  " }, T).amount, 22);
});

test("a quotation that says when it dies is believed; one that does not gets the documented five minutes", () => {
  // Both halves matter, and they are said differently on screen. A quotation with its
  // own expiry states a fact; one without states a policy, and the panel says "about
  // five minutes" rather than pretending to know the second.
  const said = normaliseQuote({ priceBreakdown: { total: "18" }, expiresAt: "2025-09-25T00:04:00.000Z" }, T);
  assert.equal(said.expiresAt, "2025-09-25T00:04:00.000Z");
  assert.equal(said.expiryFrom, "api");

  const assumed = normaliseQuote({ priceBreakdown: { total: "18" } }, T);
  assert.equal(assumed.expiresAt, new Date(T + QUOTE_VALID_MS).toISOString());
  assert.equal(assumed.expiryFrom, "policy");
  assert.equal(QUOTE_VALID_MS, 300000, "Lalamove's own five minutes, written down once");
});

test("an expiry that is not a time is treated as no expiry at all", () => {
  for (const junk of ["soon", "", "   ", 0, null, {}]) {
    const q = normaliseQuote({ priceBreakdown: { total: "18" }, expiresAt: junk }, T);
    assert.equal(q.expiryFrom, "policy", `${JSON.stringify(junk)} is not an instant`);
    assert.equal(q.expiresAt, new Date(T + QUOTE_VALID_MS).toISOString());
  }
});

test("distance is read however it arrives, and never invented", () => {
  assert.equal(distanceKmOf({ value: 7.2, unit: "km" }), 7.2);
  assert.equal(distanceKmOf({ value: "7200", unit: "m" }), 7.2, "metres become kilometres");
  assert.equal(distanceKmOf({ value: 1, unit: "mi" }), 1.609344);
  assert.equal(distanceKmOf({ value: 7.2 }), 7.2, "no unit means the unit Lalamove reports by default");
  assert.equal(distanceKmOf({ value: 3, unit: "furlong" }), 3, "an unknown unit is taken at face value rather than guessed at");
  assert.equal(distanceKmOf(7.2), 7.2);
  assert.equal(distanceKmOf("7.2"), 7.2);
  // And the absences, which is where the trap lives.
  assert.equal(distanceKmOf(null), null);
  assert.equal(distanceKmOf(undefined), null);
  assert.equal(distanceKmOf({}), null);
  assert.equal(distanceKmOf({ unit: "km" }), null);
  assert.equal(distanceKmOf({ value: null, unit: "km" }), null, "a null distance is not 0 km");
  assert.equal(distanceKmOf({ value: "", unit: "m" }), null);
  assert.equal(distanceKmOf({ value: "far" }), null);
  assert.equal(distanceKmOf("far"), null);
});

test("one vehicle refused does not take the whole answer down with it", () => {
  // The motorcycle may be priced while the van is not running at this hour, and she
  // must still be able to see and use the one that works.
  const out = normaliseQuotes({
    quotes: [
      { serviceType: "MOTORCYCLE", priceBreakdown: { total: "18.50" } },
      { serviceType: "CAR" },
    ],
    failed: [
      { service: "VAN", reason: "Lalamove does not run that vehicle in this market." },
      { reason: "  " },
    ],
  }, T);
  assert.equal(out.quotes.length, 1, "the unpriced one is not a quote of zero");
  assert.equal(out.quotes[0].service, "MOTORCYCLE");
  assert.deepEqual(out.failed, [{ service: "VAN", reason: "Lalamove does not run that vehicle in this market." }]);
});

test("an answer with nothing in it is two empty lists, never a crash", () => {
  assert.deepEqual(normaliseQuotes(null, T), { quotes: [], failed: [] });
  assert.deepEqual(normaliseQuotes({}, T), { quotes: [], failed: [] });
  assert.deepEqual(normaliseQuotes({ quotes: "nonsense", failed: null }, T), { quotes: [], failed: [] });
});

// ── THE SEAM ──────────────────────────────────────────────────────────────
//
// Her clause: "make it ready for other courier as well". These three tests are the
// answer. What a provider is handed is a JOURNEY, and what it can reach is a function
// that speaks in journeys. Nothing above the provider has anything courier-shaped in
// it, and nothing below it can see her books.

// A ready trip, built the way courier_job.js builds one, with everything a real order
// carries attached — so the assertion below is about what is STRIPPED, not about what
// was never there. `order` is the whole order record, deliberately.
//
// The stripping is done by a WHITELIST — the provider names the three fields it sends
// rather than removing the fields it must not — and that is worth stating, because the
// two fail differently. A field added to a stop's shape tomorrow cannot leak, because
// nothing reads it; but the day the mapping is "helpfully" turned into a spread, every
// field on the record goes with it. Both of those were put back as faults: the spread
// is caught by the test below, and the added field is caught by nothing because there
// is nothing there to catch.
function readyTrip() {
  const order = {
    id: "ordaaa111",
    customerName: "Mei Ling",
    whatsapp: "0169601268",
    address: "12 Jalan Bunga, 10450 Penang",
    deliveryDate: "2026-09-25",
    courierFee: 18.5,
    notes: "Leave with the guard",
  };
  return {
    pickup: { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" },
    stops: [{ order, name: "Mei Ling", phone: "60169601268", address: "12 Jalan Bunga, 10450 Penang", place: { lat: 5.42, lng: 100.33, label: "" } }],
    scheduleAt: "2026-09-25T02:00:00.000Z",
  };
}

const STATE = { settings: { supabase: { url: "https://example.supabase.co" } } };

test("a courier is handed a journey and nothing else — no order, no customer, no price", async () => {
  // The whole reason a second courier is a new file. If a provider ever needed to know
  // WHO it was carrying or WHAT they are paying, "add another courier" would mean
  // reopening this app's order screens, its state and its sync.
  const s = stubFetch(jsonReply({ ok: true, quotes: [], failed: [] }));
  try {
    await lalamove.quote(STATE, readyTrip(), { services: ["MOTORCYCLE"] });
    const sent = s.sent[0].body;
    const parsed = JSON.parse(sent);
    assert.deepEqual(Object.keys(parsed).sort(), ["action", "payload", "provider"]);
    assert.deepEqual(Object.keys(parsed.payload).sort(), ["drops", "pickup", "scheduleAt", "services"]);
    assert.deepEqual(Object.keys(parsed.payload.pickup).sort(), ["address", "lat", "lng"]);
    assert.deepEqual(Object.keys(parsed.payload.drops[0]).sort(), ["address", "lat", "lng"]);

    // And the property behind the key lists, stated as the thing that must never
    // travel: a name, a phone number, an order id, a date from her books, a price.
    for (const secret of ["Mei Ling", "0169601268", "60169601268", "ordaaa111", "2026-09-25", "18.5", "Leave with the guard"]) {
      assert.equal(sent.includes(secret), false, `"${secret}" must not reach a courier`);
    }
  } finally { s.restore(); }
});

test("the address travels because the driver has to read it, and it is the only thing that does", async () => {
  const s = stubFetch(jsonReply({ ok: true, quotes: [], failed: [] }));
  try {
    await lalamove.quote(STATE, readyTrip(), { services: ["CAR"] });
    const p = JSON.parse(s.sent[0].body).payload;
    assert.equal(p.pickup.address, "8 Lebuh Pantai", "the door the driver collects from");
    assert.equal(p.drops[0].address, "12 Jalan Bunga, 10450 Penang", "the door the driver knocks on");
    assert.deepEqual(p.drops[0].lat, 5.42);
  } finally { s.restore(); }
});

test("a trip that is not ready is refused before a single byte is sent", async () => {
  // Not a courtesy: an unpinned doorstep sent as a fallback point is a price for a
  // journey she is not taking, confirmed without complaint. The check comes from
  // courier_job.js's own tripReady, so a provider can never send a point the app would
  // call unpinned.
  const s = stubFetch(jsonReply({ ok: true, quotes: [], failed: [] }));
  try {
    const noDrop = readyTrip();
    noDrop.stops[0].place = null;
    const out = await lalamove.quote(STATE, noDrop, { services: ["CAR"] });
    assert.equal(out.ok, false);
    assert.match(out.reason, /doorstep is not pinned yet/);

    const noPickup = readyTrip();
    noPickup.pickup = null;
    const out2 = await lalamove.quote(STATE, noPickup, { services: ["CAR"] });
    assert.equal(out2.ok, false);
    assert.match(out2.reason, /Settings/);

    assert.equal(s.sent.length, 0, "nothing at all went out — not a request, not a price, not a point");
  } finally { s.restore(); }
});

test("the courier a quote is asked of is the registry's, and the registry is one file big", () => {
  // "Ready for other courier" also has to mean the app knows there is a courier at
  // all: a key, a name, and a lookup. A second courier adds itself to this list and
  // nothing else changes.
  assert.equal(activeCourier().key, LALAMOVE_KEY);
  assert.equal(courierLabel(), "Lalamove");
  assert.equal(couriers().length, 1);
  assert.equal(courierByKey("lalamove").label, "Lalamove");
  assert.equal(courierByKey("nope"), null);
  assert.equal(courierByKey("LALAMOVE"), null, "the key is exact, not a guess");
  assert.equal(typeof lalamove.quote, "function");
  assert.equal(typeof lalamove.vehicles, "function");
  assert.equal(typeof lalamove.forget, "function");
});

test("every courier answers the whole interface a screen asks it for", () => {
  // THE LIST BELOW IS THE SCREENS' LIST, NOT THE PROVIDER'S. It exists because one of
  // these members was missing and nothing said so. The job card holds a job, the job
  // names the courier that holds it, and the card asks THAT courier to say the status
  // in words — `holder.statusLabel ? holder.statusLabel(job.status) : job.status`. That
  // expression fails OPEN: with the member absent it prints the courier's own enum
  // instead of complaining, so the drawn card read "Status: ASSIGNING_DRIVER — read
  // just now" while the translation table ("Finding a driver") sat beside it with
  // tests of its own on it. Found by reading the drawn card at 375 pixels (v189), not
  // by reasoning — the same way the stray word on the same card was found. A test on
  // the pure function cannot see this, because the pure function was never wrong; the
  // WIRE to it was missing.
  const asked = { label: "string", statusLabel: "function", vehicles: "function",
    quote: "function", book: "function", job: "function", cancel: "function" };
  for (const c of couriers()) {
    for (const [member, kind] of Object.entries(asked)) {
      assert.equal(typeof c[member], kind,
        `the courier "${c.key}" does not answer ${member} — a screen reaches for it`);
    }
  }

  // And it answers in HER words, reached the way the card reaches them: through the
  // courier that holds the trip, not through the module.
  const holder = courierByKey(LALAMOVE_KEY);
  assert.equal(holder.statusLabel("ASSIGNING_DRIVER"), "Finding a driver");
  assert.equal(holder.statusLabel("PICKED_UP"), "Collected");
  assert.equal(holder.statusLabel("assigning_driver"), "Finding a driver",
    "the API's own casing is not depended on");
  assert.equal(holder.statusLabel("A_WORD_IT_DOES_NOT_KNOW"), "A_WORD_IT_DOES_NOT_KNOW",
    "a status it has not seen is shown AS SENT rather than swallowed");
  assert.equal(holder.statusLabel(null), "", "and nothing in is nothing out");
});

test("no engine file names the courier except the registry and the provider itself", async () => {
  // THE HALF OF "READY FOR ANOTHER COURIER" THAT WAS CLAIMED AND NOT MEASURED.
  // The test above proves a second courier can be ADDED. This one proves the first one
  // is not baked into the screens - because a provider seam that screens still name by
  // hand is a seam with a hole in it, and the hole is invisible until the day it costs
  // something. It was a real hole when this test was written: the Settings card named
  // the courier in its own heading, its own hint and its own environment line, and the
  // shared channel defaulted `provider` to the courier's key. Both are fixed, and this
  // is what stops either coming back.
  //
  // The name is ASKED OF THE REGISTRY rather than typed here. A guard that printed the
  // courier's name itself would have to be edited on the day a second courier arrives,
  // which is exactly the day it needs to still be right.
  const { readFile, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const here = path.dirname(new URL(import.meta.url).pathname);
  const appRoot = path.join(here, "..", "admin", "js");
  // BOTH HALVES OF THE SEAM, because the defect lived in both and was found in one.
  // The app's screens route every word about the courier through its registry; the
  // server's dispatcher does the same through the provider's own label. Walking only
  // the app would have left the dispatcher's hand-written sentence - the identical
  // fault - outside the guard that exists to stop it.
  const serverRoot = path.join(here, "..", "supabase", "functions", "courier");

  const name = courierLabel();
  assert.ok(name.length > 2, "the registry must name the courier it holds, or this guard proves nothing");

  // Each root names the two files that are ALLOWED to say it, and those two only:
  // the registry/dispatcher that imports the provider, and the provider itself. The
  // dispatcher keeps its allowance for the ENV VAR names, which are her own Supabase
  // setup rather than a claim about what the courier is called - and its sentences
  // now come from the provider's label, which is why line 117 is not written by hand
  // any more.
  const ROOTS = [
    { dir: appRoot, exts: [".js"], allowed: new Set(["couriers.js", path.join("couriers", "lalamove.js")]) },
    { dir: serverRoot, exts: [".ts", ".mjs"], allowed: new Set(["index.ts", path.join("providers", "lalamove.ts")]) },
  ];

  const walk = async (dir, exts) => {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(full, exts));
      else if (exts.some((e) => entry.name.endsWith(e))) found.push(full);
    }
    return found;
  };

  const offenders = [];
  for (const { dir, exts, allowed } of ROOTS) {
    for (const file of await walk(dir, exts)) {
      const rel = path.relative(dir, file);
      if (allowed.has(rel)) continue;
      const src = await readFile(file, "utf8");
      // PROSE IS ALLOWED AND CODE IS NOT. The seam is explained in the header of half
      // these files, and a rule that forbade writing it down would push the reason for
      // the seam out of the very files that keep it. So line comments and block
      // comments come off before the search - which can only make this guard find
      // LESS, never more, so a comment can never be the reason a real leak goes unseen.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
      if (code.toLowerCase().includes(name.toLowerCase())) offenders.push(path.join(path.basename(dir), rel));
    }
  }

  assert.deepEqual(offenders, [],
    `only the registry and its provider may name the courier in live code; these name ${name}`);

  // THE DISPATCHER IS ALLOWED, SO THE WALK ABOVE CANNOT SEE ITS OWN SENTENCES - and
  // that gap was the actual fault. The server dispatcher wrote the courier's name into
  // a refusal she reads, which is the same defect as the Settings card and would have
  // slipped through the walk untouched, because the dispatcher has to be on the
  // allowed list for its ENV VAR names to pass. So the dispatcher gets a rule of its
  // own, and it is exact rather than fuzzy: a string literal in index.ts may contain
  // the courier's name ONLY when that literal IS one of her own Supabase env-var names
  // or the path of the provider's own file. Anything else - a heading, a hint, a
  // refusal - must come from the provider.
  const dispatcher = await readFile(path.join(serverRoot, "index.ts"), "utf8");
  const live = dispatcher
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  const literals = [...live.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const named = literals.filter((v) => v.toLowerCase().includes(name.toLowerCase()));
  const permitted = /^LALAMOVE_[A-Z]+$/;                                   // her Supabase secrets
  const providerModule = new RegExp(`^[./]*providers/${name.toLowerCase()}\\.ts$`); // the provider's own file
  const stray = named.filter((v) => !permitted.test(v) && !providerModule.test(v));
  assert.deepEqual(stray, [],
    `the dispatcher may name the courier only in her env-var names and the provider's own path; these do not qualify: ${JSON.stringify(stray)}`);
});

test("the vehicle list is asked of the courier, not written into the screen", async () => {
  const s = stubFetch(jsonReply({ ok: true, services: [{ key: "VAN", name: "Van" }, { key: "MOTORCYCLE", name: "Motorcycle" }] }));
  try {
    lalamove.forget();
    const out = await lalamove.vehicles(STATE);
    assert.equal(out.ok, true);
    assert.deepEqual(out.vehicles.map((v) => v.key), ["MOTORCYCLE", "VAN"], "read from the courier's own answer, and ordered for her");
    assert.equal(JSON.parse(s.sent[0].body).action, "vehicles");
  } finally { s.restore(); }
});

test("a market with no fleet is said in words rather than shown as an empty list", async () => {
  const s = stubFetch(jsonReply({ ok: true, services: [] }));
  try {
    lalamove.forget();
    const out = await lalamove.vehicles(STATE);
    assert.equal(out.ok, false);
    assert.match(out.reason, /did not name any vehicles/);
  } finally { s.restore(); }
});

test("a phone with no Shared data is told why, in words, before any call is made", async () => {
  // The wall, from the other side: without a signed-in session the app cannot reach
  // the key, and that has to read as a fixable setup problem rather than as a courier
  // that refused.
  const s = stubFetch(jsonReply({ ok: true }));
  try {
    const out = await lalamove.quote({ settings: {} }, readyTrip(), { services: ["CAR"] });
    assert.equal(out.ok, false);
    assert.match(out.reason, /Shared data is not set up/);
    assert.equal(s.sent.length, 0);
  } finally { s.restore(); }
});

test("every price wears the vehicle's own name, and a refused vehicle wears one too", async () => {
  // A screen that lists prices has to be able to LABEL a row without knowing which
  // courier it came from — otherwise the row reads "7FT_VAN" or, worse, the view has to
  // import this file's label-maker and the seam this whole file is about is gone.
  const s = stubFetch((url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === "vehicles") {
      return jsonReply({ ok: true, services: [{ key: "7FT_VAN", name: "7ft Van" }] });
    }
    return jsonReply({ ok: true,
      quotes: [{ serviceType: "7FT_VAN", priceBreakdown: { total: "44.00", currency: "MYR" } }],
      failed: [{ service: "MOTORCYCLE", reason: "not available at this hour" }] });
  });
  try {
    lalamove.forget();
    await lalamove.vehicles(STATE);
    const out = await lalamove.quote(STATE, readyTrip(), { services: ["7FT_VAN", "MOTORCYCLE"] });
    assert.equal(out.ok, true);
    assert.equal(out.quotes[0].name, "7ft Van", "the fleet's own name, not its key");
    assert.equal(out.failed[0].name, "Motorcycle", "a vehicle the fleet list did not mention is named by the same label-maker that names the fleet");
    assert.equal(out.failed[0].service, "MOTORCYCLE", "the key is still on the row, so anything that needs to ask again still can");
    assert.match(out.failed[0].reason, /not available/);

    // And with no fleet cached at all — a phone that was set up against a sandbox and
    // then pointed at production — a price is STILL named, because a nameless row in a
    // list of prices cannot be chosen.
    lalamove.forget();
    const again = await lalamove.quote(STATE, readyTrip(), { services: ["7FT_VAN"] });
    assert.equal(again.quotes[0].name, "7Ft Van");
  } finally { lalamove.forget(); s.restore(); }
});
