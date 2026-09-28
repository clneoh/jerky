// test/store-lookup.test.js — typing an address and being brought to it (v202,
// 26 Sep 2026).
//
// Her request, verbatim: "When customer start keying in their address, can the map
// bring them their, where thay can easily pin without have to seach thru the map?
// Should work just like Grab app".
//
// This file is the SHOP half: what is worth asking (store/geo.js), how the asking is
// paced and how a late answer is thrown away (store/lookup.js). The map actually
// flying there is test/store-address.test.js, driven through the real page; the server
// that answers is test/shop-geocode.test.js.
//
// Pure — no DOM and no network of its own. `fetch` is passed IN to createLookup rather
// than read off the global, which is what lets every case here be a promise rather
// than a wait, and is the same rule store/geo.js keeps about navigator.geolocation:
// a stub that assumes the thing exists can never reach the case where it does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LOOKUP_MIN, LOOKUP_MAX, MAX_HITS, lookupQuery, readPlaces, lookupWhy,
  broaden, lookupLadder, askAgain, LADDER_MAX, addressFromRow } from "../store/geo.js";
import { createLookup } from "../store/lookup.js";
// The bakery's own half of the same question, imported here for the side-by-side guard at
// the end of this file (v214) — it is pure, and it is the one other place that decides
// whether a geocoder reached the house.
const { houseNotIn } = await import("../admin/js/courier_place.js");
import { CONFIG } from "../store/config.js";
import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stubbed wire, shaped exactly like the real one: a Response has `ok` and `json()`.
// Returns the capture so a test can read what would have gone out, and a restore so no
// stub outlives its test.
function stubFetch(reply) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), method: (opts.method || "GET").toUpperCase(), headers: opts.headers || {}, body: opts.body });
    return typeof reply === "function" ? reply(url, opts) : reply;
  };
  return { sent, restore() { globalThis.fetch = real; } };
}

function jsonReply(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}

// The states a lookup announced, in order. Every one is `{ key, hits }` where `key` is a
// dictionary key or null.
function recorder() {
  const said = [];
  // `q` is kept, not dropped: the page pairs a row with the wording it answers, so the
  // wording is part of what the lookup says and is asserted on below (v204).
  return { said, onState: (s) => said.push({ key: s.key, hits: s.hits, q: s.q }) };
}

// ── what is worth asking (store/geo.js) ────────────────────────────────────

test("nothing is asked until somebody has actually typed an address", () => {
  // "Pen" is a question with no useful answer, and every one of these costs one of the
  // handful of lookups a free service will take from the bakery in an hour.
  assert.equal(lookupQuery(""), null);
  assert.equal(lookupQuery(null), null);
  assert.equal(lookupQuery(undefined), null);
  assert.equal(lookupQuery("   "), null);
  assert.equal(lookupQuery("Jalan "), null);
  assert.equal(lookupQuery("1234567"), null, "seven characters is still part of a word");
  assert.equal(lookupQuery("12345678"), "12345678", "eight is the first worth asking");
  assert.equal(LOOKUP_MIN, 8, "and the boundary above is this file's own constant");
});

test("a pasted address is tidied, and a pasted MESSAGE is cut rather than refused", () => {
  // Whitespace is collapsed: a pasted address arrives with newlines and tabs in it, and
  // a geocoder asked for "12,\n Jalan" is asked a question nobody would type.
  assert.equal(lookupQuery("  12   Jalan  "), "12 Jalan");
  assert.equal(lookupQuery("12,\n Jalan\tBunga"), "12, Jalan Bunga");
  assert.equal(lookupQuery("  88,   Lorong  "), "88, Lorong");

  // The tail of a long paste is a telephone number, so the FRONT is the part worth
  // sending. It is cut and not refused: a box that silently does nothing when you paste
  // into it is the dead control this shop has a standing rule against.
  const long = "A".repeat(LOOKUP_MAX + 60);
  assert.equal(lookupQuery(long).length, LOOKUP_MAX);
  assert.equal(lookupQuery(long), "A".repeat(LOOKUP_MAX));
});

test("a reply is believed only as far as it can be checked", () => {
  // The safest possible read of something that arrived over a network. Everything here
  // has been seen from a real service or is a shape a broken one would send.
  assert.deepEqual(readPlaces(null), []);
  assert.deepEqual(readPlaces("ok"), []);
  assert.deepEqual(readPlaces({}), []);
  assert.deepEqual(readPlaces({ ok: false, why: "notfound" }), [],
    "a reply that says it failed found nothing, whatever else is in it");
  assert.deepEqual(readPlaces({ ok: true }), []);
  assert.deepEqual(readPlaces({ ok: true, places: "nope" }), []);
});

test("a row with no usable point is SKIPPED, so the row below it still gets read", () => {
  // The row below a broken one may be the customer's actual house, so stopping at the
  // first bad row would throw a good door away for nothing.
  const reply = {
    ok: true,
    places: [
      null,
      "the door",
      {},
      { lat: 91, lng: 100, label: "off the planet" },
      // The expensive one-line mistake this project guards everywhere: Number(null) is 0,
      // and 0,0 is a real point in the Gulf of Guinea.
      { lat: null, lng: null, label: "the equator" },
      { lat: 5.4141, lng: 100.3288, label: "  12 Jalan Bunga, Penang  " },
    ],
  };
  assert.deepEqual(readPlaces(reply), [
    { lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga, Penang" },
  ]);
});

test("a point spelled as a string is accepted, and comes back a NUMBER", () => {
  // What travels back is JSON and what the order carries is a number, so this is the
  // same tidy-and-convert validPin already does for every other pin.
  assert.deepEqual(readPlaces({ ok: true, places: [{ lat: "5.4141", lng: "100.3288", label: "x" }] }),
    [{ lat: 5.4141, lng: 100.3288, label: "x" }]);
});

test("the cap on how long a list a customer reads is the SHOP's, not the reply's", () => {
  // The function is asked for five too; this is the shop's own promise about how long a
  // list somebody has to read, kept here so a reply that ignored the cap cannot make the
  // page longer than the design accounts for. The survivors are the FIRST five.
  const places = [];
  for (let i = 0; i < 20; i++) places.push({ lat: 5.4 + i / 100, lng: 100.3, label: `door ${i}` });
  const out = readPlaces({ ok: true, places });
  assert.equal(out.length, MAX_HITS);
  assert.equal(MAX_HITS, 5);
  assert.equal(out[0].label, "door 0");
  assert.equal(out[4].label, "door 4");
});

test("a row with a point and no words is still a door, with an empty label", () => {
  // It is shown as its numbers rather than dropped — the row has to be tappable, and a
  // geocoder that found the point but sent no words still found the point.
  assert.deepEqual(readPlaces({ ok: true, places: [{ lat: 5.4141, lng: 100.3288 }] }),
    [{ lat: 5.4141, lng: 100.3288, label: "" }]);
  assert.deepEqual(readPlaces({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: null }] }),
    [{ lat: 5.4141, lng: 100.3288, label: "" }]);
});

// ── why it found nothing, in words the customer can read ───────────────────

test("every code the function can send becomes a sentence, and a code it cannot also does", () => {
  // The function answers with a CODE and never a sentence, because a sentence chosen on
  // the server is a sentence nobody can translate. The choosing happens here, off the
  // shop's own dictionary — so this is the test that notices a new code arriving with
  // nothing to say it with.
  assert.equal(lookupWhy("empty"), "addrNone");
  assert.equal(lookupWhy("notfound"), "addrNone");
  assert.equal(lookupWhy("refused"), "addrFailed");
  assert.equal(lookupWhy("timeout"), "addrFailed");
  assert.equal(lookupWhy("unreachable"), "addrFailed");
  // Codes that do not exist yet. The customer still gets a sentence, and it is the one
  // that points at the map rather than the one that blames their address.
  assert.equal(lookupWhy("kaboom"), "addrFailed");
  assert.equal(lookupWhy(""), "addrFailed");
  assert.equal(lookupWhy(null), "addrFailed");
  assert.equal(lookupWhy(undefined), "addrFailed");
  assert.equal(lookupWhy({ why: "notfound" }), "addrFailed", "an object is not a code");
});

test("the function's own list of codes is covered — a new one cannot ship without words", () => {
  // Read out of the function rather than restated here, so the two cannot drift: adding a
  // member to `export type Why` in the function and not teaching the shop about it would
  // otherwise be a silent fall-through to a generic sentence.
  const src = readFileSync(new URL("../supabase/functions/shop-geocode/geocode.ts", import.meta.url), "utf8");
  const m = /export type Why = ([^;]+);/.exec(src);
  assert.ok(m, "the function still declares its codes in one place");
  const codes = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(codes.length >= 5, "the union still lists its members");
  for (const code of codes) {
    const key = lookupWhy(code);
    for (const l of LANGS) assert.equal(typeof STORE[l][key], "string", `${l} has no words for "${code}"`);
  }
});

// ── asking again in a more forgiving wording (v203) ────────────────────────
//
// EVERY CASE BELOW WAS MEASURED AGAINST THE LIVE SERVICES BEFORE IT WAS WRITTEN, not
// imagined. Each of the four stripping pairs is a real Malaysian address the exact
// wording returns nothing for and the forgiving wording finds; each count is what the
// services actually answered on 2026-09-26.

test("the part of an address that says WHICH DOOR is dropped, and the street is not", () => {
  // A unit number, a block, a lot, a floor and a sub-district are all words no map holds:
  // OSM maps STREETS and BUILDINGS, and an unmatched token dilutes the match until the
  // street that IS in the index stops coming back.
  assert.equal(broaden("12-3-4 Blk A, Taman Sri Nibong, 11900 Bayan Lepas, Penang"),
    "Taman Sri Nibong, 11900 Bayan Lepas, Penang", "the bare unit number, then the block, both go");
  assert.equal(broaden("Blk 12-3-4, Pangsapuri Sri Indah, Penang"),
    "Pangsapuri Sri Indah, Penang", "the building the customer means is kept — only the door is dropped");
  assert.equal(broaden("No 5 Lorong Seri Nibong 3, 11900 Bayan Lepas"),
    "Lorong Seri Nibong 3, 11900 Bayan Lepas", "the house number goes and the road stays");
  assert.equal(broaden("Lot 1234, Mukim 12, Jalan Teluk Kumbar, Penang"),
    "Jalan Teluk Kumbar, Penang", "there can be several of them in a row before the street");

  // The house number alone, which is the same shape as the first case and by far the
  // commonest thing a customer types.
  assert.equal(broaden("12 Jalan Bunga, Penang"), "Jalan Bunga, Penang");
});

test("a street name that merely LOOKS like a unit phrase is left exactly as it is", () => {
  // The guard is that a bare leading token is only dropped when it CARRIES A DIGIT, so a
  // name is never eaten. This matters less for correctness than it looks: the forgiving
  // wording is only ever spent on a question the exact wording has already failed, so an
  // over-eager strip costs nothing but a lookup. It is still worth being right.
  assert.equal(broaden("Riam Road"), "Riam Road");
  assert.equal(broaden("Jalan Bukit Bintang"), "Jalan Bukit Bintang");
  assert.equal(broaden("Taman Sri Nibong"), "Taman Sri Nibong");
  // The shorthand, though, IS the point: "Rd" and "Road" are different strings to an
  // index that only holds one of them. Measured: "Riam Road" answers with four doors,
  // "Riam Rd" with none.
  assert.equal(broaden("Riam Rd"), "Riam Road");
  assert.equal(broaden("Jln Riam, Miri"), "Jalan Riam, Miri");
  assert.equal(broaden("Tmn Sri Nibong"), "Taman Sri Nibong");
  // An ambiguous shorthand is deliberately NOT expanded — "St" is as likely to be Saint
  // as Street, and a wrong expansion spends a lookup on a wording nobody wrote.
  assert.equal(broaden("St John Road"), "St John Road");
  // Nothing left to ask about is an empty question, never a question about nothing.
  assert.equal(broaden("Blk A, "), "");
  assert.equal(broaden(""), "");
  assert.equal(broaden(null), "");
});

test("the ladder is the customer's own words first, and at most one wording after it", () => {
  // The order is the whole safety argument: the exact address is always the FIRST ask, so
  // an address that works today is not slowed by a millisecond and cannot come back as a
  // different door.
  assert.deepEqual(lookupLadder("Blk 12-3-4, Pangsapuri Sri Indah, Penang"),
    ["Blk 12-3-4, Pangsapuri Sri Indah, Penang", "Pangsapuri Sri Indah, Penang"]);
  assert.deepEqual(lookupLadder("12 Jalan Bunga, Penang"), ["12 Jalan Bunga, Penang", "Jalan Bunga, Penang"]);

  // ONE ask where there is no second wording to try, which is every address that works.
  assert.deepEqual(lookupLadder("Jalan Bukit Bintang"), ["Jalan Bukit Bintang"],
    "nothing to strip and nothing to spell out — one question, exactly as before v203");
  assert.equal(LADDER_MAX, 2, "and no address is ever asked more than this many times");

  // A wording that is not worth asking is not a rung. Below LOOKUP_MIN nobody has typed
  // an address yet — which is also why "Riam Rd", the one variant that failed when this
  // was being measured, is refused by lookupQuery before the ladder is ever reached.
  assert.deepEqual(lookupLadder("Blk A, x"), ["Blk A, x"], "the forgiving form is too short to ask");
  assert.equal(lookupQuery("Riam Rd"), null, "seven characters never reaches the ladder at all");
  assert.equal(lookupQuery("Riam Road"), "Riam Road", "and the same street spelled out does");
});

test("only a question the services ANSWERED with nothing is worth asking again", () => {
  // A refusal, a timeout and an unreachable service are the same problem for every
  // wording, and asking again would spend the customer's patience on it.
  assert.equal(askAgain({ ok: false, why: "notfound" }), true);
  assert.equal(askAgain({ ok: false, why: "refused" }), false);
  assert.equal(askAgain({ ok: false, why: "timeout" }), false);
  assert.equal(askAgain({ ok: false, why: "unreachable" }), false);
  assert.equal(askAgain({ ok: false, why: "empty" }), false);
  assert.equal(askAgain({ ok: true, places: [] }), false, "a reply that claims success is not a miss");
  assert.equal(askAgain(null), false, "nothing came back at all — there is nothing to reword");
  assert.equal(askAgain("notfound"), false, "a code is not a reply");
});

test("a question the services answered with nothing is asked once more, in a forgiving wording", async () => {
  const wire = stubFetch((url, opts) => {
    const q = JSON.parse(opts.body).address;
    if (q === "Blk 12-3-4, Pangsapuri Sri Indah, Penang") return jsonReply({ ok: false, why: "notfound" });
    return jsonReply({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "Pangsapuri Sri Indah" }] });
  });
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("Blk 12-3-4, Pangsapuri Sri Indah, Penang");
    await sleep(40);

    assert.deepEqual(wire.sent.map((s) => JSON.parse(s.body).address),
      ["Blk 12-3-4, Pangsapuri Sri Indah, Penang", "Pangsapuri Sri Indah, Penang"],
      "the customer's own words first, and only then the forgiving form of them");
    assert.equal(rec.said[rec.said.length - 1].key, "addrPick");
    assert.equal(rec.said[rec.said.length - 1].hits[0].label, "Pangsapuri Sri Indah");
    assert.equal(rec.said.filter((s) => s.key === "addrLooking").length, 1,
      "the second ask does not send the screen back to its waiting message");
  } finally { wire.restore(); }
});

test("both wordings finding nothing is ONE sentence and two asks, not two failures", async () => {
  const wire = stubFetch(jsonReply({ ok: false, why: "notfound" }));
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1 }).typed("Blk 12-3-4, Pangsapuri Sri Indah, Penang");
    await sleep(40);

    assert.equal(wire.sent.length, 2, "the forgiving wording was tried");
    assert.equal(rec.said[rec.said.length - 1].key, "addrNone",
      "and the customer reads the sentence about their address, once");
    assert.deepEqual(rec.said.map((s) => s.key), ["addrLooking", "addrNone"]);
  } finally { wire.restore(); }
});

test("a lookup in TROUBLE is not asked a second way — no wording fixes a dead service", async () => {
  // The distinction the customer can act on, kept at the ladder: a service that refused,
  // timed out or could not be reached ends the walk on the first rung. Asking the same
  // two services again under other words is the same silence, twice.
  for (const why of ["refused", "timeout", "unreachable"]) {
    const wire = stubFetch(jsonReply({ ok: false, why }));
    try {
      const rec = recorder();
      createLookup({ onState: rec.onState, waitMs: 1 }).typed("Blk 12-3-4, Pangsapuri Sri Indah, Penang");
      await sleep(40);
      assert.equal(wire.sent.length, 1, `"${why}" was asked exactly once`);
      assert.equal(rec.said[rec.said.length - 1].key, "addrFailed");
    } finally { wire.restore(); }
  }
});

test("a second wording is not begun when the budget has already run out", async () => {
  // A rung started with no time left would be cut off mid-question by CALL_MS and report
  // a failure that was still coming — worse than the honest answer the first rung gave.
  const wire = stubFetch(() => new Promise((r) => {
    setTimeout(() => r(jsonReply({ ok: false, why: "notfound" })), 20);
  }));
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1, callMs: 30, retryMs: 40 })
      .typed("Blk 12-3-4, Pangsapuri Sri Indah, Penang");
    await sleep(80);
    assert.equal(wire.sent.length, 1, "there was no time left to hear a second answer");
    assert.equal(rec.said[rec.said.length - 1].key, "addrNone",
      "and the customer reads what the first rung actually said");
  } finally { wire.restore(); }
});

test("a second wording cut off by the clock does not turn a miss into a broken lookup", async () => {
  // The first rung said, honestly, "the map services answered and they hold no such
  // door". A second rung that is cut off before it answers says nothing at all about the
  // address, and must not overwrite that with "the lookup is down" — which would be a
  // lie about a service that had answered only moments before.
  let n = 0;
  const wire = stubFetch((url, opts) => {
    n += 1;
    if (n === 1) return jsonReply({ ok: false, why: "notfound" });
    return new Promise((_r, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1, callMs: 400, retryMs: 10 })
      .typed("Blk 12-3-4, Pangsapuri Sri Indah, Penang");
    await sleep(500);
    assert.equal(wire.sent.length, 2, "the forgiving wording was tried and never answered");
    assert.equal(rec.said[rec.said.length - 1].key, "addrNone",
      "and the customer still reads what the first rung actually said");
  } finally { wire.restore(); }
});

test("the words the customer reads exist in all three languages", () => {
  // These four are built in JS rather than tagged on store/index.html, so nothing in
  // test/store-i18n.test.js would notice one going missing or half-translated.
  for (const key of ["addrLooking", "addrPick", "addrNone", "addrFailed"]) {
    for (const l of LANGS) assert.equal(typeof STORE[l][key], "string", `${l}.${key} is missing`);
  }
  // The two failures must not be the same sentence: one is about their address, the other
  // about the service. Collapsing them would tell a customer their house does not exist
  // when the bakery's server is simply down.
  for (const l of LANGS) {
    assert.notEqual(STORE[l].addrNone, STORE[l].addrFailed, `${l}: the two failures read alike`);
    assert.notEqual(STORE[l].addrNone, STORE[l].addrPick, `${l}: a miss reads like a list to choose from`);
  }
});

// ── the asking: paced, remembered, and never overtaken (store/lookup.js) ───

test("nothing leaves the phone while somebody is still typing", async () => {
  const wire = stubFetch(jsonReply({ ok: true, places: [] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 40 });
    lk.typed("12 Jala");
    await sleep(80);
    assert.deepEqual(wire.sent, [], "part-way through a word, nothing was asked");
    assert.deepEqual(rec.said, [{ key: null, hits: [], q: null }], "and the list said nothing at all");
  } finally { wire.restore(); }
});

test("the ask carries the address and the bakery's own key — nothing else", async () => {
  const wire = stubFetch(jsonReply({ ok: true, places: [] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);

    assert.equal(wire.sent.length, 1);
    const one = wire.sent[0];
    assert.equal(one.method, "POST");
    assert.match(one.url, /\/functions\/v1\/shop-geocode$/);
    assert.equal(one.url.startsWith(String(CONFIG.supabase.url).replace(/\/+$/, "")), true,
      "it goes to the bakery's own Supabase, which is the whole of her decision");
    assert.equal(one.headers.Authorization, `Bearer ${CONFIG.supabase.anonKey}`,
      "the anon key is sent as a bearer token, which is what the edge gateway checks");
    assert.deepEqual(JSON.parse(one.body), { address: "12 Jalan Bunga, Penang" },
      "a JOURNEY — the address — and not one of this shop's stored fields");
  } finally { wire.restore(); }
});

test("every header the shop sends is one the function's CORS policy allows", async (t) => {
  // THIS TEST EXISTS BECAUSE ITS ABSENCE SHIPPED A BROKEN FEATURE, and the story is the
  // whole reason it is written this way. v202 first sent `apikey` alongside Authorization,
  // following the shop's OTHER Supabase calls — the REST ones, where `apikey` is required.
  // An Edge Function is not a REST call: it answers a CORS preflight listing the request
  // headers it will accept, and shop-geocode's list is "Authorization, Content-Type". An
  // unlisted header makes the PREFLIGHT fail, and the browser reports that as a bare
  // "TypeError: Failed to fetch" — indistinguishable, to the customer, from the service
  // being down. Deployed and correct, the function still answered "the address lookup
  // isn't available right now" to every customer.
  //
  // The test that stood here asserted `one.headers.apikey === anonKey`. It did not miss
  // the bug; it PINNED it, and would have gone red on the fix. Asserting that a header is
  // present says nothing about whether the server will accept it.
  //
  // So this reads the policy out of the function's own source rather than restating it,
  // and holds the two together: the shop may send anything the function lists. Add a
  // header on one side without the other and this goes red, which is the only thing that
  // could have caught it before she did.
  const src = readFileSync(
    new URL("../supabase/functions/shop-geocode/index.ts", import.meta.url), "utf8");
  const m = src.match(/["']Access-Control-Allow-Headers["']\s*:\s*["']([^"']+)["']/);
  assert.ok(m, "the function declares its allowed headers, or this guard cannot work");
  const allowed = m[1].split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  assert.ok(allowed.includes("authorization"),
    "the bearer token must be allowed, since it is how the gateway is satisfied");

  const wire = stubFetch(jsonReply({ ok: true, places: [] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);

    assert.equal(wire.sent.length, 1);
    const sent = Object.keys(wire.sent[0].headers).map((h) => h.toLowerCase());
    assert.deepEqual(
      sent.filter((h) => !allowed.includes(h)), [],
      `the shop sends only headers the function will accept — it sent ${JSON.stringify(sent)} `
      + `against a policy of ${JSON.stringify(allowed)}. An unlisted header fails the CORS `
      + "preflight and the customer is told the lookup is down.");
  } finally { wire.restore(); }
});

test("the list is drawn while the lookup is out, so the wait is not a dead control", async () => {
  let release;
  const wire = stubFetch(() => new Promise((r) => {
    release = () => r(jsonReply({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga, Penang" }] }));
  }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);

    assert.deepEqual(rec.said.map((s) => s.key), ["addrLooking"],
      "something is said the moment the ask leaves, rather than leaving the box blank");
    release();
    await sleep(20);
    assert.equal(rec.said[rec.said.length - 1].key, "addrPick", "and then the answer replaces it");
    assert.equal(rec.said[rec.said.length - 1].hits.length, 1);
  } finally { wire.restore(); }
});

test("the same question is never asked twice — the answer is already here", async () => {
  const wire = stubFetch(jsonReply({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" }] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(wire.sent.length, 1);

    // Re-typing the same thing — which is what adding and removing a trailing space
    // amounts to, and what re-focusing the box and touching a key does — is answered
    // from the answer already here rather than spending another lookup.
    lk.typed("  12 Jalan Bunga, Penang  ");
    await sleep(30);
    assert.equal(wire.sent.length, 1, "the same address cost exactly one lookup");
    assert.equal(rec.said[rec.said.length - 1].key, "addrPick");
    assert.equal(rec.said[rec.said.length - 1].hits.length, 1);

    // A genuinely different address IS a new question, so the memo above is not simply
    // "ask once and never again".
    lk.typed("88 Lorong Baru, Penang");
    await sleep(30);
    assert.equal(wire.sent.length, 2);
  } finally { wire.restore(); }
});

// ── which question a row answers (v204) ───────────────────────────────────
//
// The list is deliberately left up while the customer keeps typing — store/app.js's own
// note calls the alternative a list that flickers under somebody's thumb — so for the
// length of this lookup's pause a row drawn for the old wording is still tappable. The
// page can only refuse a tap on one if every answer says WHICH question it came from, so
// the wording rides out with the key and the rows. These are the two ways it could be
// missing: never sent, or dropped on the replay.

test("every answer says which wording it answers", async () => {
  const wire = stubFetch(jsonReply({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" }] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);
    const last = rec.said[rec.said.length - 1];
    assert.equal(last.key, "addrPick");
    assert.equal(last.q, "12 Jalan Bunga, Penang",
      "the wording the customer put in the box, tidied — the page compares the box against it");
  } finally { wire.restore(); }
});

test("a replay carries the wording too — a replayed row with no claim could be taken stale", async () => {
  // Found by reading the memo rather than by watching the screen, and it is the one branch
  // of this file that answers without asking. A wording put back into the box while its
  // answer is still the memo — one letter deleted and retyped, a trailing space added and
  // removed — is shown again from the answer already here. That replay has to carry the
  // wording with the rows: a row the page is handed with no `q` reads as "this came from
  // nowhere in particular, take it", which is the one thing the page must never be told
  // while a list from an older wording may still be on screen (store/app.js, takeHit).
  const wire = stubFetch(jsonReply({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" }] }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].q, "12 Jalan Bunga, Penang");

    lk.typed("12 Jalan Bunga, Penang ");   // the same question, and the memo answers it
    await sleep(30);
    const last = rec.said[rec.said.length - 1];
    assert.equal(wire.sent.length, 1, "which cost no second lookup");
    assert.equal(last.key, "addrPick");
    assert.equal(last.q, "12 Jalan Bunga, Penang",
      "and it still says which wording the rows it just put back are for");
  } finally { wire.restore(); }
});

test("an answer that arrived too late is thrown away rather than shown", async () => {
  // The customer has typed past it. A stale list appearing under a box they have since
  // cleared is worse than no list at all, so every ask carries its generation and only
  // the newest one may speak.
  //
  // THE FIRST ASK HAS TO ACTUALLY COME BACK. It is tempting to write this with a first ask
  // that never settles, and that version proves nothing: a promise that never resolves
  // reaches the generation check neither. It looked like coverage until a fault sweep
  // removed the check and the test stayed green.
  let late = null;
  const wire = stubFetch(() => {
    if (!late) {
      return new Promise((r) => {
        late = () => r(jsonReply({ ok: true, places: [{ lat: 5.4, lng: 100.3, label: "first answer" }] }));
      });
    }
    return jsonReply({ ok: true, places: [{ lat: 5.5, lng: 100.4, label: "second answer" }] });
  });
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(20);
    assert.equal(rec.said[rec.said.length - 1].key, "addrLooking");

    lk.typed("88 Lorong Baru, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].key, "addrPick");
    assert.equal(rec.said[rec.said.length - 1].hits[0].label, "second answer",
      "the newest question is the one that got to speak");

    // Now the abandoned ask finally answers, about an address the customer left behind.
    late();
    await sleep(40);
    assert.equal(rec.said[rec.said.length - 1].hits[0].label, "second answer",
      "the answer to the question they abandoned never gets to speak");
  } finally { wire.restore(); }
});

test("a lookup that never answers is given up on, and the customer is told", async () => {
  // A press that hangs forever is a press that reads as broken. CALL_MS is what bounds
  // it, and it is exercised here through the abort signal the fetch is actually handed.
  const wire = stubFetch((url, opts) => new Promise((_r, reject) => {
    opts.signal.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  }));
  try {
    const rec = recorder();
    const lk = createLookup({ onState: rec.onState, waitMs: 1, callMs: 30 });
    lk.typed("12 Jalan Bunga, Penang");
    await sleep(90);
    assert.equal(rec.said[rec.said.length - 1].key, "addrFailed");
  } finally { wire.restore(); }
});

test("a service that is down and an address that does not exist are DIFFERENT sentences", async () => {
  // A function that has not been deployed yet answers 404, and that is a failure rather
  // than a miss: the customer is told the lookup is unavailable, not that their house
  // does not exist.
  const notFound = stubFetch(jsonReply({ ok: false, why: "notfound" }));
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1 }).typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].key, "addrNone");
  } finally { notFound.restore(); }

  const missing = stubFetch({ ok: false, status: 404, json: async () => ({ message: "not found" }) });
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1 }).typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].key, "addrFailed",
      "a 404 is the function not existing, not the house not existing");
  } finally { missing.restore(); }

  // THE SAME RULE WHERE THE BODY WOULD OTHERWISE BE BELIEVED. A reply that arrived with
  // a failing status is a failing reply whatever it carries, so the address is not read
  // out of it. Stated as its own case because the body below is shaped exactly like a
  // successful answer: believing it would hand a customer a list of doors produced by a
  // service that had just refused the request.
  const lying = stubFetch({
    ok: false, status: 502,
    json: async () => ({ ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "12 Jalan Bunga" }] }),
  });
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1 }).typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].key, "addrFailed",
      "a reply with a failing status is not read, however much it looks like a good one");
    assert.deepEqual(rec.said[rec.said.length - 1].hits, [],
      "and nothing reached the list from it");
  } finally { lying.restore(); }

  const broken = stubFetch(() => { throw new Error("offline"); });
  try {
    const rec = recorder();
    createLookup({ onState: rec.onState, waitMs: 1 }).typed("12 Jalan Bunga, Penang");
    await sleep(30);
    assert.equal(rec.said[rec.said.length - 1].key, "addrFailed");
  } finally { broken.restore(); }
});

test("clearing the box forgets everything, and the next customer starts clean", () => {
  // A phone can be handed across a counter. resetPin() calls this when an order is
  // placed, so the next customer must not be shown the last one's house.
  const rec = recorder();
  const lk = createLookup({ onState: rec.onState, waitMs: 1 });
  lk.clear();
  assert.deepEqual(rec.said, [{ key: null, hits: [], q: null }],
    "the list goes away and nothing is said — and with no rows there is no wording for the "
    + "page to mistake for a question the box is still asking (v204)");
});

// ── a row that found the house may write the box (v214, 27 Sep 2026) ───────
//
// Her instruction, verbatim: "the address is very accurate, it can go into the delivery
// address instead of customer type full". v205 refused this outright, and it was right to:
// the free services answered a Malaysian address with the ROAD and threw the house number
// away, so writing a row into the box replaced the customer's one complete address with a
// worse one — her own words for it were "it will contaminate the customer keyin address".
//
// v212 changed what a row can be. When Google answers, the row is its own complete
// `formatted_address`. What separates a row worth writing from the one she complained about
// is the HOUSE NUMBER, and checking for it is the whole of `addressFromRow`.
//
// THE SIDE-BY-SIDE GUARD IS THE POINT OF THE LAST TEST HERE. The bakery asks the same
// question at the other end of the same order — `houseNotIn` decides whether to warn her
// that a saved door only reached the road — and the two must not be able to disagree about
// whether the geocoder found the house. test/shop-geocode.test.js holds the two copies of
// the server's geocoder together for the same reason.

const GOOGLE_ROW = "23, Jalan Seang Tek, George Town, 10400 George Town, Pulau Pinang, Malaysia";

test("a row that found the house number may replace their typing (v214)", () => {
  assert.equal(addressFromRow({ label: GOOGLE_ROW }, "23 Jalan Seang Tek, Penang"), GOOGLE_ROW,
    "the number they typed is in the row, so the row is their address — and a fuller one");
  assert.equal(addressFromRow({ label: GOOGLE_ROW }, "23, Jalan Seang Tek, George Town 10400"), GOOGLE_ROW,
    "with or without the postcode they typed, the house number settles it");
});

test("a row that only reached the road is not allowed near their words (v214)", () => {
  // The v205 complaint, exactly: the free services' answer for a Malaysian address.
  assert.equal(addressFromRow({ label: "Jalan Seang Tek, George Town, Penang" },
    "23 Jalan Seang Tek, Penang"), "",
    "no 23 anywhere in the row — it found the street, so it does not get to name the door");
  assert.equal(addressFromRow({ label: "Jalan Bunga, Penang" }, "12 Jalan Bunga, Penang"), "",
    "and the same for the street the pin was on");
});

test("an address typed with no house number at all is never written over (v214)", () => {
  // Nothing to confirm the row against, so the row is never provably better and the
  // customer's own words are left exactly as they are. This is the "a road-only answer
  // leaves their words alone" answer, arriving from the other end.
  assert.equal(addressFromRow({ label: "Taman Sri Nibong, George Town, Penang" },
    "Taman Sri Nibong, Penang"), "");
  // A postcode is not a house number — it says which district, not which door — so a box
  // holding only one is in the same position.
  assert.equal(addressFromRow({ label: "10450 Penang" }, "10450 Penang"), "", "a postcode alone is not a door");
});

test("EVERY number they typed has to be in the row, not just one (v214)", () => {
  // A Malaysian address often carries two numbers — a lot number and a mukim, a unit number
  // and a street — and the row has to have found BOTH. Accepting one is the v205 harm one
  // digit at a time: the box would be rewritten with an address that has silently dropped
  // the other number the customer typed.
  const typed = "Lot 1234, Mukim 12, Jalan Teluk Kumbar, Penang";
  assert.equal(addressFromRow({ label: "Lot 1234, Mukim 12, Jalan Teluk Kumbar, Penang" }, typed),
    "Lot 1234, Mukim 12, Jalan Teluk Kumbar, Penang",
    "the row has the lot number AND the mukim — it may write");
  assert.equal(addressFromRow({ label: "Mukim 12, Jalan Teluk Kumbar, George Town, Penang" }, typed), "",
    "the row has the mukim and lost the lot number, so it writes nothing — matching on the one "
    + "number it happens to hold would throw the other away");
  assert.equal(addressFromRow({ label: "12-3-4 Blk A, Taman Sri Nibong, George Town" },
    "12-3-4 Blk A, Taman Sri Nibong, Penang"), "12-3-4 Blk A, Taman Sri Nibong, George Town",
    "and a unit number is a second thing they typed, so a row holding all of it may write");
  assert.equal(addressFromRow({ label: "Taman Sri Nibong, George Town, Penang" },
    "12-3-4 Blk A, Taman Sri Nibong, Penang"), "",
    "a row that found the taman and none of the numbers is refused");
});

test("a row with no words, or no row at all, writes nothing (v214)", () => {
  assert.equal(addressFromRow({ lat: 5.4, lng: 100.3 }, "12 Jalan Bunga, Penang"), "",
    "a point with no words still moves the pin — it just has nothing to write");
  assert.equal(addressFromRow(null, "12 Jalan Bunga, Penang"), "");
  assert.equal(addressFromRow({ label: "12, Jalan Bunga, Penang" }, ""), "",
    "and an empty box has nothing for a row to answer");
});

test("the shop's rule and the bakery's agree about the house number (v214)", () => {
  // The two ends of one order, side by side. `houseNotIn` returns the number the bakery
  // LOST (or "" for a door it reached); this file's rule returns the words the shop may
  // WRITE (or "" for nothing). For an address carrying a SINGLE number they are exact
  // opposites, and a change to either that broke that has to be seen here.
  //
  // SINGLE-NUMBER BY CONSTRUCTION, and that is not laziness. Where an address carries two
  // numbers the two halves ask deliberately different questions — the bakery asks "did we
  // lose the door at all?" (one number is enough to say no) while the shop asks "did we get
  // everything the customer wrote?" (all of them are needed) — so the pair is NOT opposite
  // there, and a row added carelessly to this table would assert something neither end
  // promises. The two-number case is covered by the test above.
  const cases = [
    ["23 Jalan Seang Tek, Penang", "23, Jalan Seang Tek, George Town, 10400 Penang, Malaysia"],
    ["23 Jalan Seang Tek, Penang", "Jalan Seang Tek, George Town, Penang"],
    ["12 Jalan Bunga, 10450 Penang", "12, Jalan Bunga, 10450 Penang, Malaysia"],
    ["12 Jalan Bunga, 10450 Penang", "Jalan Bunga, 10450 Penang, Malaysia"],
    ["7 Lorong Seri Nibong, Penang", "Taman Sri Nibong, George Town, Penang"],
  ];
  for (const [typed, label] of cases) {
    const bakeryLost = houseNotIn(typed, { label }) !== "";
    const shopWrites = addressFromRow({ label }, typed) !== "";
    assert.equal(shopWrites, !bakeryLost,
      `"${typed}" against "${label}": the bakery says it ${bakeryLost ? "lost the door" : "reached it"} `
      + `and the shop ${shopWrites ? "writes" : "refuses"} — the two halves of one order cannot disagree`);
  }
});
