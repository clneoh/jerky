// test/store-pin.test.js — the customer's own door pin, on the shop page (v197,
// 25 Sep 2026).
//
// This is the customer-facing half of the feature, and it is pure: the rules about
// what a pin IS and what an order CARRIES live in store/geo.js with no DOM, no
// fetch and no Leaflet, so every answer a real phone can give can be driven under
// Node. The bakery's half — offering the pin and accepting it — is in
// test/courier-place.test.js, and the trap that would drop it on arrival (the
// import line) is in test/supabase.test.js.
//
// The test that matters most is the FIRST one. An order with no pin has to post
// byte for byte the payload the shop has always posted: this shop has one customer
// flow and a live site, and a new field appearing on orders nobody pinned would be
// the quietest way to break it.
//
// The other one worth naming is the LAST: `navigator.geolocation` is passed IN
// rather than read off `navigator` inside, and that is deliberate. A browser with
// no geolocation object at all is a real case (any desktop over plain HTTP), and a
// stub that assumes it exists is the forgiving shim this project has been bitten by
// four times — so the absent case is a test of its own rather than an assumption.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askGeo, fixVerdict, placeForOrder, validPin, POOR_FIX_M } from "../store/geo.js";

const PENANG = { lat: 5.4141, lng: 100.3288 };

// ── what an order carries ─────────────────────────────────────────────────

test("a pin travels only with a courier order that has one", () => {
  assert.deepEqual(placeForOrder(PENANG, "courier"), { lat: 5.4141, lng: 100.3288 });
});

test("self collect carries no pin — there is no door to drive to", () => {
  // A pin kept on screen while the customer switches back to collecting must not
  // ride on the order: it would be a doorstep for a delivery nobody asked for.
  assert.equal(placeForOrder(PENANG, "collect"), null);
  assert.equal(placeForOrder(PENANG, undefined), null);
  assert.equal(placeForOrder(PENANG, "Courier"), null); // the value the app sets, exactly
});

test("an order with no pin carries NOTHING — null, so no field is written", () => {
  // null is the caller's cue to leave the key off entirely. A `place: null` on the
  // order would be a key the bakery's import has to remember to skip, and a screen
  // that prints it.
  assert.equal(placeForOrder(null, "courier"), null);
  assert.equal(placeForOrder(undefined, "courier"), null);
  assert.equal(placeForOrder({}, "courier"), null);
});

test("a half-written or impossible pin is refused rather than posted", () => {
  assert.equal(placeForOrder({ lat: 5.4141 }, "courier"), null);
  assert.equal(placeForOrder({ lat: "5.41abc", lng: 100 }, "courier"), null);
  assert.equal(placeForOrder({ lat: null, lng: 100 }, "courier"), null);
  assert.equal(placeForOrder({ lat: 91, lng: 100 }, "courier"), null);
  assert.equal(placeForOrder({ lat: 5, lng: 181 }, "courier"), null);
  assert.equal(placeForOrder("5.4141,100.3288", "courier"), null);
});

test("a pin is tidied to six decimals, about 11 cm", () => {
  // Leaflet hands back full float precision. "100.32880000000001" on a record a
  // human reads is noise, and this is finer than any door is wide.
  assert.deepEqual(validPin({ lat: 5.414100000000001, lng: 100.32880000000001 }),
    { lat: 5.4141, lng: 100.3288 });
  // A numeric string is accepted and comes back a NUMBER — the order is JSON.
  assert.deepEqual(validPin({ lat: "5.4141", lng: "100.3288" }), { lat: 5.4141, lng: 100.3288 });
});

// ── whose words ride with the point (v205) ────────────────────────────────
//
// Her report: "when the pin arrive at backoffice, it did not tally". v204 answered it by
// letting the tapped suggestion row's NAME ride out with the pin — and she corrected that
// the same day: "the customer know their address well, when i tap the address the address
// is not a complete one, if it is plaste into the address line, it will contaminate the
// customer keyin address". A row is a fragment — a street and a town, no house number. The
// customer's typed address is the whole of it, and it is the only name for that spot that
// belongs on the order.
//
// So a pin carries no words of its own, and `placeForOrder` is the ONE place words are
// added: the address box, tidied and capped like any other string that reaches a screen.

test("an order's pin is named with the customer's own address, never the point's own name", () => {
  // The point arrives from a suggestion row, which names that spot "Taman Sri Nibong,
  // George Town" — a fragment, not an address. The order must carry their words instead.
  const row = { lat: 5.3325, lng: 100.302, label: "Taman Sri Nibong, George Town" };
  const out = placeForOrder(row, "courier", "Taman Sri Nibong, Penang");
  assert.deepEqual(out, { lat: 5.3325, lng: 100.302, label: "Taman Sri Nibong, Penang" },
    "one address, one point — and the row's name is nowhere on the order");
  assert.equal(out.label, "Taman Sri Nibong, Penang");
});

test("a pin is a point, and nothing on it can name itself", () => {
  assert.deepEqual(validPin({ lat: 5.4141, lng: 100.3288 }), { lat: 5.4141, lng: 100.3288 });
  const out = validPin({ lat: 5.4141, lng: 100.3288, label: "Taman Sri Nibong, George Town" });
  assert.deepEqual(out, { lat: 5.4141, lng: 100.3288 },
    "a label handed to a pin is dropped — there is no way for a point to name itself");
  assert.equal("label" in out, false, "the key is absent, not empty");
  assert.equal("label" in validPin({ lat: 5.4141, lng: 100.3288, label: "   " }), false);
});

test("a pin with no address to name it goes as the bare point it is", () => {
  // A customer who pinned without writing anything has nothing to name the spot with, and
  // a pin given a name nobody wrote would be worse than an unnamed one. This must stay
  // byte for byte the `{lat, lng}` the shop has always posted.
  assert.deepEqual(placeForOrder(PENANG, "courier"), { lat: 5.4141, lng: 100.3288 });
  assert.deepEqual(placeForOrder(PENANG, "courier", "   "), { lat: 5.4141, lng: 100.3288 });
  assert.deepEqual(placeForOrder(PENANG, "courier", null), { lat: 5.4141, lng: 100.3288 });
  assert.equal("label" in placeForOrder(PENANG, "courier", ""), false, "the key is absent, not empty");
});

test("the address that names a pin is tidied, and cut rather than allowed to run away", () => {
  // The words are the customer's own box, printed on her screen, so they come down to one
  // line with no runs of space, and they stop somewhere: a screen has a width and a row has
  // one line. The bakery caps the same field at the same width when it reads one back.
  assert.equal(placeForOrder({ lat: 5, lng: 100 }, "courier", "  12,  Jalan\n Bunga ,  Penang  ").label,
    "12, Jalan Bunga , Penang");
  assert.equal(placeForOrder({ lat: 5, lng: 100 }, "courier", "x".repeat(400)).label.length, 120);
  // And the guard against the string "null" or "undefined" reaching her screen, which this
  // suite has shipped before: anything that is not words names nothing.
  assert.equal("label" in placeForOrder({ lat: 5, lng: 100 }, "courier", null), false);
  assert.equal("label" in placeForOrder({ lat: 5, lng: 100 }, "courier", undefined), false);
});

// ── the accuracy rule ─────────────────────────────────────────────────────

test("a good fix says nothing at all", () => {
  assert.equal(fixVerdict(8), null);
  assert.equal(fixVerdict(POOR_FIX_M), null); // the threshold itself is still a door
  assert.equal(fixVerdict(0), null);
});

test("a vague fix is kept and SAID — never a refusal", () => {
  // Her rule: the shop never blocks a sale. A fix good to 500 m is worth keeping,
  // because she confirms every pin anyway, and the customer is the one who can still
  // fix it — so it is kept and the number is put in front of them.
  assert.deepEqual(fixVerdict(500), { accuracyM: 500 });
  assert.deepEqual(fixVerdict(151), { accuracyM: 151 });
  assert.deepEqual(fixVerdict(1234.6), { accuracyM: 1235 });
});

test("a phone that does not report accuracy says nothing about it", () => {
  assert.equal(fixVerdict(null), null);
  assert.equal(fixVerdict(undefined), null);
  assert.equal(fixVerdict(NaN), null);
});

// ── asking the phone ──────────────────────────────────────────────────────

test("a position comes back as a tidy point, with its accuracy", () => {
  const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 5.41410001, longitude: 100.3288, accuracy: 12.5 } }) };
  return askGeo(geo).then((out) => {
    assert.deepEqual(out, { ok: true, lat: 5.4141, lng: 100.3288, accuracyM: 12.5 });
  });
});

test("a phone that reports no accuracy still gives a point", () => {
  const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 5.4141, longitude: 100.3288 } }) };
  return askGeo(geo).then((out) => {
    assert.deepEqual(out, { ok: true, lat: 5.4141, lng: 100.3288, accuracyM: null });
  });
});

test("a position with no numbers is UNAVAILABLE, never a pin at 0,0", () => {
  // 0,0 is the Gulf of Guinea and it is a perfectly valid point, which is exactly why
  // a missing latitude must not become one. Same refusal validPin makes, from the
  // other end.
  const geo = { getCurrentPosition: (ok) => ok({ coords: {} }) };
  return askGeo(geo).then((out) => {
    assert.deepEqual(out, { ok: false, why: "unavailable" });
  });
});

test("every way a refusal arrives is named, and none of them is read from the message", () => {
  // The code is the only thing a phone hands over. The message is a sentence in the
  // browser's own language that this app must never show — so it is never read, and
  // a made-up message with a real code still comes out right.
  const denied = { getCurrentPosition: (_ok, err) => err({ code: 1, message: "User denied the request" }) };
  const timeout = { getCurrentPosition: (_ok, err) => err({ code: 3, message: "Timeout expired" }) };
  const gone = { getCurrentPosition: (_ok, err) => err({ code: 2, message: "Position unavailable" }) };
  return Promise.all([askGeo(denied), askGeo(timeout), askGeo(gone)]).then(([a, b, c]) => {
    assert.deepEqual(a, { ok: false, why: "denied" });
    assert.deepEqual(b, { ok: false, why: "timeout" });
    assert.deepEqual(c, { ok: false, why: "unavailable" });
  });
});

test("a browser with no geolocation object at all says so — it does not sit there", () => {
  // The case a stub that assumes navigator.geolocation exists can never reach.
  return Promise.all([askGeo(null), askGeo(undefined), askGeo({}), askGeo("geo")]).then((outs) => {
    for (const out of outs) assert.deepEqual(out, { ok: false, why: "unsupported" });
  });
});

test("a geolocation that throws is an answer too, not a broken screen", () => {
  const geo = { getCurrentPosition: () => { throw new Error("not allowed in this frame"); } };
  return askGeo(geo).then((out) => {
    assert.deepEqual(out, { ok: false, why: "unavailable" });
  });
});

test("only the first answer counts, and the asking has a clock on it", () => {
  // A phone can report twice (a cached fix, then a real one). The second must not
  // change the answer the customer already saw, and the browser must be told to wait
  // only so long — a press that hangs is a press that reads as broken.
  let asked = null;
  const geo = {
    getCurrentPosition: (ok, err, opts) => {
      asked = opts;
      ok({ coords: { latitude: 5.4141, longitude: 100.3288, accuracy: 10 } });
      err({ code: 1 }); // arrives second, and must be ignored
    },
  };
  return askGeo(geo, { timeoutMs: 4000 }).then((out) => {
    assert.equal(out.ok, true);
    assert.equal(out.accuracyM, 10);
    assert.equal(asked.enableHighAccuracy, true);
    assert.equal(asked.timeout, 4000);
    assert.equal(asked.maximumAge, 0); // a stale fix is not where the customer is now
  });
});

test("the first answer is the only one that settles it — resolve is called exactly once (O08)", async () => {
  // WHAT THIS TEST IS, AND WHAT IT IS NOT. A phone can report twice (a cached fix, then a
  // real one), and `finish` in store/geo.js guards that with `if (!settled)`. An overnight
  // sweep removed the guard and nothing went red — correctly, because a Promise ALREADY
  // ignores a second resolve: the answer is byte for byte the same either way, which was
  // checked directly before writing this. So no assertion about what the customer or the
  // baker SEES can ever notice the guard, and a test that claimed to would be a fake.
  //
  // What the guard actually buys is that the code states the rule and settles exactly once,
  // which is what stops a later edit that moves work AFTER the resolve — a second paint, a
  // message sent twice — from doing it twice. That is the invariant pinned here, by counting
  // the resolve calls on the promise askGeo itself returns.
  const Real = globalThis.Promise;
  const counts = [];
  globalThis.Promise = class extends Real {
    // The species is pinned to the real Promise deliberately: awaiting a patched promise
    // builds a DERIVED promise through the species constructor, and counting that one would
    // count one extra resolve for every single await.
    static get [Symbol.species]() { return Real; }
    constructor(exec) {
      const rec = { n: 0 };
      super((res, rej) => exec((v) => { rec.n += 1; res(v); }, rej));
      counts.push(rec);
    }
  };
  let p;
  try {
    p = askGeo({
      getCurrentPosition: (ok, err) => {
        ok({ coords: { latitude: 5.4141, longitude: 100.3288, accuracy: 9 } });
        err({ code: 1 }); // arrives second, and must not settle it a second time
      },
    });
  } finally {
    globalThis.Promise = Real;
  }
  const answer = await p;
  assert.deepEqual(answer, { ok: true, lat: 5.4141, lng: 100.3288, accuracyM: 9 },
    "the first answer is the one that travelled");
  assert.equal(counts.length, 1, "askGeo built exactly one promise");
  assert.equal(counts[0].n, 1, "and settled it exactly once, not twice");
});

// ── the shop has its own map, and the two copies must agree ───────────────
//
// The shop deliberately does NOT import admin/js/place_map.js: that file is a pop-up
// card built on the admin's own pop-up layer and geocoder, and the shop has neither —
// nor any business asking a geocoder about a customer's home. The price of that choice
// is a second copy of the Leaflet version, the CDN, the tiles and the attribution, and
// a version bump that reaches only one of the two would ship silently: the admin's map
// upgraded, the shop's not, or the other way round. So the two files are read and
// compared, and the comparison is the test.

test("the shop's map and the bakery's map agree on Leaflet, the CDN, the tiles and the credit", () => {
  const shop = readFileSync(new URL("../store/pin_map.js", import.meta.url), "utf8");
  const bakery = readFileSync(new URL("../admin/js/place_map.js", import.meta.url), "utf8");
  const declared = (src, name) => {
    const m = new RegExp(`^const ${name} = (.*);$`, "m").exec(src);
    assert.ok(m, `${name} is not declared at the top level of one of the two maps`);
    return m[1].trim();
  };
  for (const name of ["LEAFLET_VERSION", "LEAFLET_CSS", "LEAFLET_JS", "TILES", "ATTRIB"]) {
    assert.equal(declared(shop, name), declared(bakery, name), `${name} differs between the two maps`);
  }
  // …and the version is a version, so a "bump" that is a typo cannot reach either map.
  assert.match(declared(shop, "LEAFLET_VERSION"), /^"\d+\.\d+\.\d+"$/, "a version that is not a version");
});

test("the shop loads no map at all until somebody asks for one", () => {
  // A customer standing at their own door never presses the map button, and must not
  // pay for Leaflet: the shop's page ships no script tag for it and no <link> either.
  // The map is fetched on the press, and only then.
  const page = readFileSync(new URL("../store/index.html", import.meta.url), "utf8");
  assert.equal(/leaflet/i.test(page), false, "the shop's page must not fetch the map up front");
  const boot = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  assert.equal(/leaflet@|leaflet\.js/i.test(boot), false, "the shop's boot must not carry a Leaflet URL");
});
