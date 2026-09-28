// test/shop-geocode.test.js — the shop's address lookup on the server (v202,
// 26 Sep 2026).
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS MOSTLY A COMPARISON. The shop needs the
// same address lookup her app already has, but it cannot call her app's function: that
// one refuses every request that does not carry a real owner session (courier/index.ts),
// and a customer is nobody's signed-in user. Widening that door is not an option — her
// Lalamove key and secret sit behind it. So the lookup is a SECOND FUNCTION, and because
// a Supabase function is deployed as its own bundle it could not import the first one's
// file either: the rules are a deliberate COPY.
//
// A copy nobody compares is how the country filter, the longitude-first read, the
// service order or MAX_PLACES quietly drifts on one side only. So the guard is not a
// comment — it is this file, driving BOTH functions side by side over the same stubbed
// wire and failing the moment they stop finding the same doors. Node imports the
// function's TypeScript directly (see test/courier-provider.test.js, same trick), so what
// is tested here is the file Deno runs rather than a transcription of it.
//
// The only thing stubbed anywhere below is `fetch`. Never a function under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const { geocodeAddress, placesFromResults: courierResults, placesFromPhoton: courierPhoton,
        placesFromGoogle: courierGoogle, googleTrouble: courierTrouble } =
  await import("../supabase/functions/courier/geocode.ts");
const { lookupAddress, placesFromResults: shopResults, placesFromPhoton: shopPhoton, MAX_PLACES,
        placesFromGoogle: shopGoogle, googleTrouble: shopTrouble } =
  await import("../supabase/functions/shop-geocode/geocode.ts");
const { allowHit, sweep, MAX_PER_WINDOW, WINDOW_MS } =
  await import("../supabase/functions/shop-geocode/limit.ts");

// A real Penang address, and Photon's own reply for it: GeoJSON, so the coordinates are
// LONGITUDE FIRST. Getting this the wrong way round puts the customer in the Indian
// Ocean and shows the numbers as a fact, which is why it is asserted rather than assumed.
const PHOTON_HIT = {
  features: [{
    properties: { countrycode: "MY", name: "Jalan Bunga", city: "Penang", postcode: "10450" },
    geometry: { type: "Point", coordinates: [100.3288, 5.4141] },
  }],
};
const PHOTON_PLACE = { lat: 5.4141, lng: 100.3288, label: "Jalan Bunga, Penang, 10450" };

// Nominatim's own reply shape for the same door, which spells longitude `lon` and comes
// with a ready-made label.
const NOMINATIM_HIT = [{ lat: "5.4141", lon: "100.3288", display_name: "12, Jalan Bunga, Penang, 10450" }];
const NOMINATIM_PLACE = { lat: 5.4141, lng: 100.3288, label: "12, Jalan Bunga, Penang, 10450" };

// Google's own reply shape for the same door (v212). It answers HTTP 200 whatever
// happened and puts the verdict in `status`; the coordinates are NAMED, so unlike the
// other two there is no longitude-first trap; and the label is Google's own finished
// `formatted_address`, which carries the house number whenever Google knows it.
const GOOGLE_HIT = {
  status: "OK",
  results: [{
    formatted_address: "23, Jalan Bunga, 10450 George Town, Pulau Pinang, Malaysia",
    geometry: { location: { lat: 5.4141, lng: 100.3288 } },
  }],
};
const GOOGLE_PLACE = {
  lat: 5.4141, lng: 100.3288,
  label: "23, Jalan Bunga, 10450 George Town, Pulau Pinang, Malaysia",
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({ error: "no" }) });

// A stubbed wire that answers by the host it is asked, and records every ask in order.
// Returns the capture so a test can read what went out and in which order.
function stubFetch(byHost) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    const host = new URL(String(url)).host;
    sent.push({ url: String(url), host, headers: opts.headers || {} });
    const answer = byHost[host];
    if (typeof answer === "function") return answer(url, opts);
    if (answer) return answer;
    throw new Error(`the stub was asked about ${host} and has no answer for it`);
  };
  return { sent, restore() { globalThis.fetch = real; } };
}

const SERVERS = {
  "photon.komoot.io": ok(PHOTON_HIT),
  "nominatim.openstreetmap.org": ok(NOMINATIM_HIT),
};

// Both functions, one after the other, over the same stub. Kept in one place so every
// test below compares like with like rather than each re-deriving the pair.
async function both(byHost, opts = {}) {
  const wire = stubFetch(byHost || SERVERS);
  try {
    const courier = await geocodeAddress("12 Jalan Bunga, Penang", opts);
    const courierSent = wire.sent.length;
    const shop = await lookupAddress("12 Jalan Bunga, Penang", opts);
    return { courier, shop, sent: wire.sent, courierSent };
  } finally { wire.restore(); }
}

// Hand the two functions a Google key the way the edge runtime does, and take it away
// again: `envOf` reaches for `globalThis.Deno`, which does not exist under Node. This is
// the ONLY way a key gets in here, and it is never a real one.
async function withKey(key, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "Deno");
  const prev = globalThis.Deno;
  if (key == null) delete globalThis.Deno;
  else globalThis.Deno = {
    env: { get: (n) => (n === "GOOGLE_GEOCODING_KEY" ? key : undefined) },
  };
  try { return await fn(); } finally {
    if (had) globalThis.Deno = prev; else delete globalThis.Deno;
  }
}

// The same wire, with an answer for Google's host as well. `SERVERS` deliberately has
// none, and the stub THROWS for a host it has no answer for — which is what makes the
// no-key test below a real guard rather than a formality.
const WITH_GOOGLE = { "maps.googleapis.com": ok(GOOGLE_HIT), ...SERVERS };

// ── the two lookups find the same doors ────────────────────────────────────

test("the shop's lookup and the bakery's find the same door, off the same first ask", async () => {
  const { courier, shop, sent, courierSent } = await both();

  assert.deepEqual(shop, { ok: true, places: [PHOTON_PLACE] });
  assert.deepEqual(courier.places, shop.places, "the two carried back the same places");
  assert.deepEqual(courier.place, PHOTON_PLACE, "and the bakery's single answer is the first of them");
  assert.equal(courier.ok, true);

  assert.equal(courierSent, 1, "the bakery asked exactly one service");
  assert.equal(sent.length, 2, "and so did the shop, over its own call");
  assert.deepEqual(sent.map((s) => s.host), ["photon.komoot.io", "photon.komoot.io"],
    "both asked PHOTON first — Nominatim is the second ask, not the first");
});

test("Photon is read LONGITUDE FIRST, so a Penang door does not land in the Indian Ocean", async () => {
  // The single most expensive mis-read in this feature: [lng, lat] taken as written puts
  // a Malaysian customer at 100°N, which Leaflet will happily draw.
  const { shop } = await both();
  assert.equal(shop.places[0].lat, 5.4141, "the latitude is the SECOND coordinate Photon sent");
  assert.equal(shop.places[0].lng, 100.3288, "and the longitude is the first");
});

test("a Photon that refuses falls through to Nominatim, on BOTH sides", async () => {
  const byHost = { "photon.komoot.io": bad(500), "nominatim.openstreetmap.org": ok(NOMINATIM_HIT) };
  const { courier, shop, sent } = await both(byHost);

  assert.deepEqual(shop, { ok: true, places: [NOMINATIM_PLACE] });
  assert.deepEqual(courier.places, shop.places);
  assert.deepEqual(sent.map((s) => s.host).slice(0, 2),
    ["photon.komoot.io", "nominatim.openstreetmap.org"],
    "photon was tried first and nominatim second, in that order");
  // The second ask is a real one: it carries the country filter and the same cap, so a
  // same-named street in another country can never be handed back as a customer's door.
  const q = sent[1].url;
  assert.match(q, /countrycodes=my/);
  assert.match(q, new RegExp(`limit=${MAX_PLACES}`));
});

test("the two callers identify themselves SEPARATELY, so throttling one cannot take the other down", async () => {
  // Only Nominatim's policy asks to be told who is calling, so it is the only ask that
  // carries a name — one per caller. Sharing a name would mean sharing the throttle that
  // name earns, and a service slowing one of them down would take the other with it.
  const byHost = { "photon.komoot.io": bad(500), "nominatim.openstreetmap.org": ok([]) };
  const { sent } = await both(byHost);
  const named = sent.filter((s) => s.headers["User-Agent"]);
  assert.equal(named.length, 2, "each caller's Nominatim ask carries a name, and only those do");
  assert.equal(named[0].headers["User-Agent"], "MunchiesFurkidz-Courier/1.0 (+https://munchies.com.my)");
  assert.equal(named[1].headers["User-Agent"], "MunchiesFurkidz-Shop/1.0 (+https://munchies.com.my)");
  assert.notEqual(named[0].headers["User-Agent"], named[1].headers["User-Agent"]);
  for (const one of named) {
    assert.match(one.headers["User-Agent"], /^MunchiesFurkidz-\S+\/1\.0 \(\+https:\/\/munchies\.com\.my\)$/,
      "the usage policy asks for a real name with a contact route");
  }
});

// ── nothing found, said in each reader's own language ──────────────────────

test("a miss is one thing to the customer and another to her — a code here, a sentence there", async () => {
  const byHost = { "photon.komoot.io": ok({ features: [] }), "nominatim.openstreetmap.org": ok([]) };
  const { courier, shop } = await both(byHost);

  assert.deepEqual(shop, { ok: false, why: "notfound" },
    "the shop gets a CODE, because the customer may be reading in 中文 or BM");
  assert.equal(courier.ok, false);
  assert.match(courier.reason, /was not found/);
  assert.match(courier.reason, /put the pin on the map/i,
    "and her own app gets the sentence it has always read");
});

test("a service that will not answer is a DIFFERENT code from a house that is not there", async () => {
  // The distinction has to survive all the way to the customer's phone: telling somebody
  // their house does not exist when the lookup is simply down is the wrong sentence.
  const refused = await both({ "photon.komoot.io": bad(503), "nominatim.openstreetmap.org": bad(503) });
  assert.deepEqual(refused.shop, { ok: false, why: "refused" });
  assert.match(refused.courier.reason, /did not answer/);

  const gone = await both({
    "photon.komoot.io": () => { throw new Error("ENOTFOUND"); },
    "nominatim.openstreetmap.org": () => { throw new Error("ENOTFOUND"); },
  });
  assert.deepEqual(gone.shop, { ok: false, why: "unreachable" });
  assert.match(gone.courier.reason, /could not be reached/);
});

test("a service that never answers is given up on, and the two sides name it the same way", async () => {
  // A lookup left hanging would hold the customer's screen until the phone gives up on
  // it, and the sentence they read would describe the wrong problem.
  const hang = (_url, opts) => new Promise((_r, reject) => {
    opts.signal.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
  const { courier, shop } = await both({
    "photon.komoot.io": hang,
    "nominatim.openstreetmap.org": hang,
  }, { timeoutMs: 20 });

  assert.deepEqual(shop, { ok: false, why: "timeout" });
  assert.match(courier.reason, /did not answer in time/);
});

test("an empty address is refused before anything is asked — no request, no spend", async () => {
  const wire = stubFetch(SERVERS);
  try {
    assert.deepEqual(await lookupAddress(""), { ok: false, why: "empty" });
    assert.deepEqual(await lookupAddress("   "), { ok: false, why: "empty" });
    assert.deepEqual(await lookupAddress(null), { ok: false, why: "empty" });
    assert.equal(wire.sent.length, 0, "nothing left the building");
  } finally { wire.restore(); }
});

// ── the third service, asked first only when there is a key (v212) ─────────

test("with a key set, BOTH sides ask Google FIRST, and it is the only ask when it answers", async () => {
  // The reason for the third service is the DATA: OpenStreetMap holds Malaysian roads
  // rather than house numbers, and the free pair are both built from it. So the service
  // that does hold the house is asked first — asking it second would mean paying for the
  // good answer and then not using it.
  await withKey("test-key", async () => {
    const { courier, shop, sent, courierSent } = await both(WITH_GOOGLE);

    assert.deepEqual(shop, { ok: true, places: [GOOGLE_PLACE] });
    assert.deepEqual(courier.places, shop.places, "the two carried back the same places");
    assert.deepEqual(courier.place, GOOGLE_PLACE, "and the bakery's single answer is the first of them");

    assert.equal(courierSent, 1, "the bakery asked exactly one service");
    assert.deepEqual(sent.map((s) => s.host), ["maps.googleapis.com", "maps.googleapis.com"],
      "both asked GOOGLE first, and neither went on to the free pair");

    // The ask carries the same country filter the other two are given in their own
    // queries — a same-named street abroad must not come back as a customer's door —
    // and the key, which is exactly why this runs on the server and not in the browser.
    const q = sent[0].url;
    assert.match(q, /components=country:MY/);
    assert.match(q, /language=en/);
    assert.match(q, /key=test-key/);
    assert.match(q, /address=12%20Jalan%20Bunga/);
  });
});

test("with a key set, the free pair are still there BEHIND Google — a refusal falls through", async () => {
  // The whole safety of shipping this ahead of her account: a Google that will not do
  // the job must mean "ask the free pair next", never "tell the customer nothing".
  await withKey("test-key", async () => {
    for (const status of ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "INVALID_REQUEST", "UNKNOWN_ERROR"]) {
      const byHost = { "maps.googleapis.com": ok({ status, error_message: "no" }), ...SERVERS };
      const { courier, shop, sent } = await both(byHost);

      assert.deepEqual(shop, { ok: true, places: [PHOTON_PLACE] }, `${status} still left a door`);
      assert.deepEqual(courier.places, shop.places);
      assert.deepEqual(sent.slice(0, 2).map((s) => s.host),
        ["maps.googleapis.com", "photon.komoot.io"],
        `${status}: google was asked and refused, then photon answered`);
    }
  });
});

test("a refused Google is NEVER reported as a house that is not there", async () => {
  // The failure this guards is a specific and nasty one. Google answers HTTP 200 with an
  // empty `results` when it refuses, so a reader that ran before the verdict was checked
  // would see an empty list and call it a MISS — telling somebody their house does not
  // exist when in fact nobody looked. That is a lie in the one sentence whose whole job
  // is to be honest about not knowing.
  await withKey("test-key", async () => {
    const refused = {
      "maps.googleapis.com": ok({ status: "REQUEST_DENIED", error_message: "bad key" }),
      "photon.komoot.io": bad(503),
      "nominatim.openstreetmap.org": bad(503),
    };
    const a = await both(refused);
    assert.deepEqual(a.shop, { ok: false, why: "refused" }, "the lookup was not done, and it says so");
    assert.match(a.courier.reason, /did not answer/);
    assert.doesNotMatch(a.courier.reason, /was not found/);

    // And the verdict keeps its OWN code when nothing else answers either. The free pair
    // are made unreachable rather than merely unhappy here on purpose: "refused" and
    // "unreachable" are different sentences to a customer, and only a run in which no
    // service says anything else can tell whether the refusal's own word survived.
    const gone = {
      "maps.googleapis.com": ok({ status: "REQUEST_DENIED", error_message: "bad key" }),
      "photon.komoot.io": () => { throw new Error("ENOTFOUND"); },
      "nominatim.openstreetmap.org": () => { throw new Error("ENOTFOUND"); },
    };
    const b = await both(gone);
    assert.deepEqual(b.shop, { ok: false, why: "refused" }, "a refusal is not an unreachable network");
    assert.match(b.courier.reason, /did not answer/);
    assert.doesNotMatch(b.courier.reason, /could not be reached/);
  });
});

test("a Google ZERO_RESULTS is an ordinary miss, not a refusal", async () => {
  // The other half of the same verdict: ZERO_RESULTS is Google saying it looked and the
  // house is not in its index, which is the normal, unremarkable answer. The free pair are
  // unreachable so that Google's verdict is the ONLY thing deciding the answer — with them
  // also missing, a mis-read ZERO_RESULTS would be masked by their genuine miss.
  await withKey("test-key", async () => {
    const byHost = {
      "maps.googleapis.com": ok({ status: "ZERO_RESULTS", results: [] }),
      "photon.komoot.io": () => { throw new Error("ENOTFOUND"); },
      "nominatim.openstreetmap.org": () => { throw new Error("ENOTFOUND"); },
    };
    const { courier, shop } = await both(byHost);
    assert.deepEqual(shop, { ok: false, why: "notfound" }, "Google looked and did not find it");
    assert.match(courier.reason, /was not found/);
  });
});

test("with NO key, Google is never asked and Photon is still first — the old behaviour, untouched", async () => {
  // This is what makes the change safe to ship before she has an account: with no secret
  // set, the queue is exactly what it was at v211. The stub throws for a host it has no
  // answer for, so if Google were asked at all this test would fail loudly rather than
  // quietly pass.
  await withKey(null, async () => {
    const { courier, shop, sent } = await both(SERVERS);
    assert.deepEqual(shop, { ok: true, places: [PHOTON_PLACE] });
    assert.deepEqual(courier.places, shop.places);
    assert.deepEqual(sent.map((s) => s.host), ["photon.komoot.io", "photon.komoot.io"]);
  });
});

test("with a key set, a caller's own timeout is still honoured EXACTLY — the patience is split, not repeated", async () => {
  // Three asks at five seconds each would be the caller's whole budget spent on hangs.
  // The default is derived from how many services are in the queue, but a caller that
  // names its own timeout still gets exactly that — which is what this drives.
  await withKey("test-key", async () => {
    const hang = (_url, opts) => new Promise((_r, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
    const started = Date.now();
    const { courier, shop, sent } = await both({
      "maps.googleapis.com": hang, "photon.komoot.io": hang, "nominatim.openstreetmap.org": hang,
    }, { timeoutMs: 20 });
    const elapsed = Date.now() - started;

    assert.deepEqual(shop, { ok: false, why: "timeout" });
    assert.match(courier.reason, /did not answer in time/);
    assert.equal(sent.length, 6, "all three were tried, on both sides, and each was given up on");
    // Six hangs at the caller's twenty milliseconds is a tenth of a second of work. The
    // bound is deliberately loose — it is here to catch a patience that was REPEATED
    // rather than split (six asks at seconds each), not to measure anything.
    assert.ok(elapsed < 2000, `six hangs at 20ms each took ${elapsed}ms — the budget was not honoured`);
  });
});

test("Google's reply is read the same on both sides, and its label already carries the house number", () => {
  assert.deepEqual(shopGoogle(GOOGLE_HIT), [GOOGLE_PLACE]);
  assert.deepEqual(shopGoogle(GOOGLE_HIT), courierGoogle(GOOGLE_HIT));

  // The point is NAMED — `lat` and `lng`, spelled out — so unlike Photon there is no
  // longitude-first trap to spring here. Asserted anyway, because a reader that swapped
  // them would still look plausible.
  assert.equal(shopGoogle(GOOGLE_HIT)[0].lat, 5.4141);
  assert.equal(shopGoogle(GOOGLE_HIT)[0].lng, 100.3288);

  // Junk in, nothing out — the same 0,0 trap every reader in this feature guards.
  assert.deepEqual(shopGoogle(null), []);
  assert.deepEqual(shopGoogle({ results: "nope" }), []);
  assert.deepEqual(shopGoogle({ results: [null, {}, { geometry: { location: { lat: null, lng: null } } }] }), []);

  const many = {
    results: Array.from({ length: 9 }, (_, i) => ({
      formatted_address: `door ${i}`,
      geometry: { location: { lat: 5.4, lng: 100.3 + i / 100 } },
    })),
  };
  assert.equal(shopGoogle(many).length, MAX_PLACES);
  assert.deepEqual(shopGoogle(many), courierGoogle(many));
});

test("Google says HTTP 200 whatever happened, so the verdict in the BODY is what is read", () => {
  assert.equal(shopTrouble({ status: "OK" }), false, "found something: healthy");
  assert.equal(shopTrouble({ status: "ZERO_RESULTS" }), false, "looked and did not find: also healthy");
  for (const s of ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "INVALID_REQUEST", "UNKNOWN_ERROR"]) {
    assert.equal(shopTrouble({ status: s }), true, `${s} is the service failing, not the house missing`);
    assert.equal(courierTrouble({ status: s }), shopTrouble({ status: s }), "read the same on both sides");
  }
  assert.equal(shopTrouble({ status: " ok " }), false, "case and whitespace are the same verdict");
  // A body with no status at all says nothing about failure, and calling it one would
  // turn every reply this reader does not recognise into a refusal.
  assert.equal(shopTrouble({ results: [] }), false);
  assert.equal(shopTrouble(null), false);
  assert.equal(courierTrouble(null), shopTrouble(null));
});

test("a Photon result that HAS the house number is labelled with it, not with the road", () => {
  // The second defect found while chasing her report, and it matters on its own: Photon
  // sends the number in `housenumber` and the road in `street`, leaving `name` to the
  // road's own name. Labelling from `name` alone made a result that HAD found number 23
  // read as the road — and fired v211's own "this is the road, not the house" warning on
  // an answer that had found the house.
  const building = {
    features: [{
      properties: { countrycode: "MY", housenumber: "23", street: "Jalan Bunga", city: "George Town", postcode: "10450" },
      geometry: { coordinates: [100.3288, 5.4141] },
    }],
  };
  assert.deepEqual(shopPhoton(building), [{ lat: 5.4141, lng: 100.3288, label: "23 Jalan Bunga, George Town, 10450" }]);
  assert.deepEqual(shopPhoton(building), courierPhoton(building));

  // No number and no street: unchanged from every earlier version.
  const named = {
    features: [{ properties: { countrycode: "MY", name: "Jalan Bunga", city: "Penang", postcode: "10450" },
                 geometry: { coordinates: [100.3288, 5.4141] } }],
  };
  assert.equal(shopPhoton(named)[0].label, "Jalan Bunga, Penang, 10450");

  // A street with no number reads as the street, which is the truth about that point.
  const streetOnly = {
    features: [{ properties: { countrycode: "MY", street: "Jalan Bunga" },
                 geometry: { coordinates: [100.3288, 5.4141] } }],
  };
  assert.equal(shopPhoton(streetOnly)[0].label, "Jalan Bunga");
});

// ── the cap, the country filter, the dedupe — read the same on both sides ──

test("both readers stop at the same number of candidates", () => {
  const many = [];
  for (let i = 0; i < 9; i++) many.push({ lat: "5.4", lon: `${100.3 + i / 100}`, display_name: `door ${i}` });
  assert.equal(courierResults(many).length, MAX_PLACES);
  assert.deepEqual(shopResults(many), courierResults(many));

  const features = [];
  for (let i = 0; i < 9; i++) {
    features.push({
      properties: { countrycode: "MY", name: `door ${i}` },
      geometry: { coordinates: [100.3 + i / 100, 5.4] },
    });
  }
  assert.equal(shopPhoton({ features }).length, MAX_PLACES);
  assert.deepEqual(shopPhoton({ features }), courierPhoton({ features }));
});

test("a same-named street in another country is never handed back as a door", () => {
  // Asked of the services in their own queries too, and enforced again on the way in.
  const other = {
    features: [
      { properties: { countrycode: "SG", name: "Jalan Bunga" }, geometry: { coordinates: [103.8, 1.35] } },
      { properties: { countrycode: "my", name: "Jalan Bunga" }, geometry: { coordinates: [100.3288, 5.4141] } },
    ],
  };
  assert.deepEqual(shopPhoton(other), [{ lat: 5.4141, lng: 100.3288, label: "Jalan Bunga" }],
    "the Singapore one is skipped and the Malaysian one is kept");
  assert.deepEqual(shopPhoton(other), courierPhoton(other), "the lowercase reply is read the same by both");
});

test("a reply read wrongly is caught on both sides — junk in, nothing out", () => {
  const junk = [null, "x", {}, { lat: 91, lon: 100 }, { lat: null, lon: null }];
  assert.deepEqual(shopResults(junk), []);
  assert.deepEqual(shopResults(junk), courierResults(junk));
  // Number(null) is 0, and 0,0 is a real point in the Gulf of Guinea — the expensive
  // one-line mistake this project guards in every reader it has.
  assert.deepEqual(shopResults([{ lat: null, lon: null, display_name: "the equator" }]), []);

  assert.deepEqual(shopPhoton(null), []);
  assert.deepEqual(shopPhoton({ features: "nope" }), []);
  assert.deepEqual(shopPhoton({ features: junk }), []);
});

test("the same door offered twice is collapsed to one row on both sides", async () => {
  const twice = {
    features: [
      { properties: { countrycode: "MY", name: "Jalan Bunga", city: "Penang", postcode: "10450" },
        geometry: { coordinates: [100.3288, 5.4141] } },
      { properties: { countrycode: "MY", name: "Jalan Bunga", city: "Penang", postcode: "10450" },
        geometry: { coordinates: [100.3289, 5.4142] } },
    ],
  };
  const { courier, shop } = await both({ "photon.komoot.io": ok(twice) });
  assert.equal(shop.places.length, 1, "one door, one row — a list is not spent twice on one answer");
  assert.deepEqual(courier.places, shop.places);
});

test("two unlabelled candidates are NOT collapsed — the same words say nothing about the place", async () => {
  const blank = {
    features: [
      { properties: { countrycode: "MY" }, geometry: { coordinates: [100.3288, 5.4141] } },
      { properties: { countrycode: "MY" }, geometry: { coordinates: [100.34, 5.42] } },
    ],
  };
  const { shop } = await both({ "photon.komoot.io": ok(blank) });
  assert.equal(shop.places.length, 2, "an empty label is never treated as a duplicate key");
});

// ── the copy itself, and the fence in front of it ─────────────────────────

test("the shop's point reader is the bakery's, byte for byte", () => {
  // There is no reason for the two to differ, and the cost of one drifting is a pin in
  // the wrong state shown to a customer as a fact. A byte comparison is the whole guard.
  const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex");
  assert.equal(sha("../supabase/functions/shop-geocode/place.ts"), sha("../supabase/functions/courier/place.ts"));
});

test("the cap lets a person through, refuses a script, and lets the person back in", () => {
  // Malaysian mobile carriers put a great many customers behind one address, so the cap
  // has to sit far above a person and far below a script. A person typing one address
  // fires a handful of lookups; the window is a minute.
  const hits = new Map();
  const T = 1_700_000_000_000;
  for (let i = 0; i < MAX_PER_WINDOW; i++) {
    assert.equal(allowHit(hits, "203.0.113.7", T), true, `ask ${i + 1} of the window went through`);
  }
  assert.equal(allowHit(hits, "203.0.113.7", T), false, "one past the cap is refused");
  assert.equal(MAX_PER_WINDOW >= 20, true, "and the cap is loose enough for a shared carrier address");

  // The window closes: a customer who tripped the cap by typing is back a minute later.
  assert.equal(allowHit(hits, "203.0.113.7", T + WINDOW_MS), true);
});

test("one caller's cap is not another's, and an unreadable caller is not a licence to be unlimited", () => {
  const hits = new Map();
  const T = 1_700_000_000_000;
  for (let i = 0; i < MAX_PER_WINDOW; i++) allowHit(hits, "203.0.113.7", T);
  assert.equal(allowHit(hits, "203.0.113.7", T), false, "the noisy neighbour is at their cap");
  assert.equal(allowHit(hits, "198.51.100.4", T), true, "and the next customer is unaffected");

  // A caller whose address could not be read must not be waved through — that would make
  // "send no x-forwarded-for" the way round the cap.
  const blank = new Map();
  for (let i = 0; i < MAX_PER_WINDOW; i++) assert.equal(allowHit(blank, "", T), true);
  assert.equal(allowHit(blank, "", T), false);
  assert.equal(allowHit(blank, null, T), false, "null lands on the same shared name");
});

test("a window that has closed is not a record of anything", () => {
  const hits = new Map();
  const T = 1_700_000_000_000;
  allowHit(hits, "a", T, { max: 1, windowMs: 1000 });
  assert.equal(hits.size, 1);
  sweep(hits, T + 500);
  assert.equal(hits.size, 1, "a window still open is left alone");
  sweep(hits, T + 1000);
  assert.equal(hits.size, 0, "a window past its reset is dropped rather than kept forever");
});
