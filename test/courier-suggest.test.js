// test/courier-suggest.test.js — v228: the address box asks Google as she types.
//
// supabase/functions/courier/suggest.ts is the half of the suggester that lives on the
// server: it builds the Places API (New) autocomplete request and reads the reply into
// rows. No Edge Function's index.ts can be loaded by this suite (it starts with a `jsr:`
// import and calls Deno.serve — see edge-function-imports.test.js), so the whole of the
// network-facing work lives in a plain module and is driven here with a stubbed wire,
// exactly as shop-geocode.test.js drives the geocoder.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  suggestAddresses, suggestionsFrom, placesTrouble,
  allowSuggestion, sweepHits,
  MIN_QUERY, MAX_QUERY, MAX_SUGGESTIONS, MAX_PER_WINDOW, WINDOW_MS, PLACES_TIMEOUT_MS,
} = await import("../supabase/functions/courier/suggest.ts");

const PLACES_HOST = "places.googleapis.com";

// A prediction as Google actually shapes it on the (New) endpoint: the words live one
// level down, under `text.text`, with the match ranges beside them.
const pred = (text, placeId) => ({ placePrediction: { text: { text, matches: [] }, placeId } });

const REPLY = {
  suggestions: [
    pred("12, Jalan Bunga, Taman Sejahtera, 11200 George Town, Pulau Pinang, Malaysia", "ChIJaaa"),
    pred("12, Jalan Bungee, 10450 George Town, Pulau Pinang, Malaysia", "ChIJbbb"),
  ],
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status, body = { error: { code: status, message: "no" } }) =>
  ({ ok: false, status, json: async () => body });

// A stubbed wire that records every ask — url, headers AND body — so a test can read
// back exactly what would have gone to Google.
function stubFetch(byHost) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    const host = new URL(String(url)).host;
    sent.push({
      url: String(url),
      host,
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(String(opts.body)) : null,
    });
    const answer = byHost[host];
    if (typeof answer === "function") return answer(url, opts);
    if (answer) return answer;
    throw new Error(`the stub was asked about ${host} and has no answer for it`);
  };
  return { sent, restore() { globalThis.fetch = real; } };
}

// Hand the module a key the way the edge runtime does, and take it away again: `envOf`
// reaches for `globalThis.Deno`, which does not exist under Node. This is the ONLY way a
// key gets in here, and it is never a real one.
async function withKey(key, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "Deno");
  const prev = globalThis.Deno;
  if (key == null) delete globalThis.Deno;
  else globalThis.Deno = { env: { get: (n) => (n === "GOOGLE_GEOCODING_KEY" ? key : undefined) } };
  try { return await fn(); } finally {
    if (had) globalThis.Deno = prev; else delete globalThis.Deno;
  }
}

const KEY = "AIzaTESTONLYnotarealkey0000000000000000";
const askWith = (byHost, query, timeoutMs) =>
  withKey(KEY, async () => {
    const wire = stubFetch(byHost);
    try { return { out: await suggestAddresses(query, timeoutMs), sent: wire.sent }; }
    finally { wire.restore(); }
  });

// ── where the key goes ─────────────────────────────────────────────────────

test("the key travels in a header and never in the URL", async () => {
  const { out, sent } = await askWith({ [PLACES_HOST]: ok(REPLY) }, "12 Jalan Bunga");

  assert.equal(out.ok, true);
  assert.equal(sent.length, 1, "one ask, and only one");
  assert.equal(sent[0].headers["X-Goog-Api-Key"], KEY, "the key rides the header");

  // The whole reason the header exists. geocode.ts spells its key into the query string;
  // this endpoint accepts a header, and a URL turns up in access logs and error reports.
  assert.equal(sent[0].url.includes(KEY), false, "the key is not in the URL");
  assert.equal(sent[0].url.includes("key="), false, "and not under a query parameter either");
});

test("the request asks for Malaysia, in English, and for exactly the two fields a row needs", async () => {
  const { sent } = await askWith({ [PLACES_HOST]: ok(REPLY) }, "12 Jalan Bunga");

  assert.equal(sent[0].body.input, "12 Jalan Bunga");
  assert.deepEqual(sent[0].body.includedRegionCodes, ["my"],
    "a same-named street abroad must not come back as her customer's door");
  assert.equal(sent[0].body.languageCode, "en");

  const mask = sent[0].headers["X-Goog-FieldMask"];
  assert.equal(mask, "suggestions.placePrediction.text.text,suggestions.placePrediction.placeId");
  // Google rejects a field mask containing a space rather than trimming it, so a mask
  // that reads prettily here would be a 400 in production.
  assert.equal(/\s/.test(mask), false, "no spaces anywhere in the mask");
});

// ── reading the reply ──────────────────────────────────────────────────────

test("a prediction comes back as the words to print and the place it is", async () => {
  const { out } = await askWith({ [PLACES_HOST]: ok(REPLY) }, "12 Jalan Bunga");

  assert.deepEqual(out.places, [
    { text: "12, Jalan Bunga, Taman Sejahtera, 11200 George Town, Pulau Pinang, Malaysia", placeId: "ChIJaaa" },
    { text: "12, Jalan Bungee, 10450 George Town, Pulau Pinang, Malaysia", placeId: "ChIJbbb" },
  ]);
});

test("a prediction with no words to print is dropped, never carried as a blank row", () => {
  // The list is drawn with replaceChildren, which turns every argument into a string —
  // so a row with an empty text is a TAPPABLE, WORDLESS line on screen. That is the
  // exact fault this app has shipped twice, which is why the drop is asserted rather
  // than assumed from the shape of Google's reply.
  const rows = suggestionsFrom({
    suggestions: [
      { placePrediction: { text: { text: "" }, placeId: "ChIJempty" } },
      { placePrediction: { placeId: "ChIJnotext" } },
      { placePrediction: { text: {}, placeId: "ChIJblank" } },
      { placePrediction: { text: { text: "   " }, placeId: "ChIJspaces" } },
      pred("12, Jalan Bunga, 11200 George Town, Malaysia", "ChIJgood"),
    ],
  });
  assert.deepEqual(rows, [{ text: "12, Jalan Bunga, 11200 George Town, Malaysia", placeId: "ChIJgood" }]);
});

test("a query prediction is dropped — it is a search string, not an address", () => {
  const rows = suggestionsFrom({
    suggestions: [
      { queryPrediction: { text: { text: "focaccia near me" } } },
      pred("12, Jalan Bunga, 11200 George Town, Malaysia", "ChIJgood"),
    ],
  });
  assert.deepEqual(rows.map((r) => r.text), ["12, Jalan Bunga, 11200 George Town, Malaysia"]);
});

test("the list is capped, so a long reply cannot become a long screen", () => {
  const many = Array.from({ length: 9 }, (_, i) => pred(`12, Jalan Bunga ${i}, Malaysia`, `ChIJ${i}`));
  assert.equal(suggestionsFrom({ suggestions: many }).length, MAX_SUGGESTIONS);
  assert.equal(MAX_SUGGESTIONS, 5);
});

test("a reply that is not the shape expected yields no rows rather than a throw", () => {
  for (const junk of [null, undefined, 42, "nope", [], {}, { suggestions: null }, { suggestions: [1, 2] },
    { suggestions: [{ placePrediction: "not an object" }] }]) {
    assert.deepEqual(suggestionsFrom(junk), [], `expected no rows from ${JSON.stringify(junk)}`);
  }
});

test("placesTrouble reads Google's own refusal, and only that", () => {
  assert.equal(placesTrouble({ error: { code: 403, message: "API not enabled" } }), true);
  assert.equal(placesTrouble({ suggestions: [] }), false, "an empty list is a miss, not a refusal");
  assert.equal(placesTrouble(null), false);
});

// ── nothing here throws, and nothing costs an allowance it should not ──────

test("a query with nothing to ask about is not sent at all", async () => {
  const { out, sent } = await askWith({ [PLACES_HOST]: ok(REPLY) }, "12");
  assert.deepEqual(out, { ok: true, places: [] });
  assert.equal(sent.length, 0, "a short query costs no request and no allowance");
  assert.equal(MIN_QUERY, 4);

  // Three characters and a space: the trim happens before the floor is measured, so the
  // space cannot buy a query its way over it.
  const three = await askWith({ [PLACES_HOST]: ok(REPLY) }, " 12 ");
  assert.equal(three.sent.length, 0);
});

test("a query with no key is a reason, not a throw, and asks nobody", async () => {
  const wire = stubFetch({ [PLACES_HOST]: ok(REPLY) });
  try {
    const out = await withKey(null, () => suggestAddresses("12 Jalan Bunga"));
    assert.equal(out.ok, false);
    assert.match(out.reason, /not set up/);
    assert.equal(wire.sent.length, 0, "and Google is not called at all");
  } finally { wire.restore(); }
});

test("an over-long query is cut, not refused — a real address never notices", async () => {
  const { sent } = await askWith({ [PLACES_HOST]: ok(REPLY) }, "A".repeat(MAX_QUERY + 200));
  assert.equal(sent[0].body.input.length, MAX_QUERY);
});

test("Google refusing is a reason, not a throw", async () => {
  const { out } = await askWith({ [PLACES_HOST]: ok({ error: { code: 403, message: "API not enabled" } }) },
    "12 Jalan Bunga");
  assert.equal(out.ok, false);
  assert.equal(typeof out.reason, "string");
  assert.ok(out.reason.length > 0);
});

test("an HTTP failure is a reason, not a throw", async () => {
  for (const status of [400, 403, 429, 500]) {
    const { out } = await askWith({ [PLACES_HOST]: bad(status) }, "12 Jalan Bunga");
    assert.equal(out.ok, false, `HTTP ${status} must be a reason`);
    assert.equal(typeof out.reason, "string");
  }
});

test("an answer that is not JSON is handled, not thrown on", async () => {
  const notJson = { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
  const { out } = await askWith({ [PLACES_HOST]: notJson }, "12 Jalan Bunga");
  assert.deepEqual(out, { ok: true, places: [] }, "unreadable is a miss, not a crash");
});

test("a wire that cannot be reached is a reason, not a throw", async () => {
  const { out } = await askWith({
    [PLACES_HOST]: () => { throw new Error("network down"); },
  }, "12 Jalan Bunga");
  assert.equal(out.ok, false);
  assert.match(out.reason, /could not be reached/);
});

test("a wire that never answers gives up on the module's own short clock", async () => {
  const hang = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      reject(e);
    });
  });
  const { out } = await askWith({ [PLACES_HOST]: hang }, "12 Jalan Bunga", 40);
  assert.equal(out.ok, false);
  assert.match(out.reason, /too long/);
  // Far shorter than the geocoder's 15s on purpose: a list meant to appear while she is
  // still typing is worthless if it arrives after she has moved on.
  assert.ok(PLACES_TIMEOUT_MS <= 5000, "a typeahead does not wait 15 seconds");
});

// ── the fence that stands in for the daily cap she chose not to have ───────

test("the limiter counts a person's asks and refuses a loop's", () => {
  const hits = new Map();
  const t = 1_000_000;
  // A person typing an address fires a handful; the gap between that and a runaway is
  // enormous, which is what lets the cap sit far above real use.
  for (let i = 0; i < MAX_PER_WINDOW; i++) {
    assert.equal(allowSuggestion(hits, "owner-1", t), true, `ask ${i + 1} of a window is allowed`);
  }
  assert.equal(allowSuggestion(hits, "owner-1", t), false, "the ask past the cap is refused");
  assert.equal(allowSuggestion(hits, "owner-1", t), false, "and stays refused");
});

test("the window reopens on its own, so a tripped cap is a pause and not a lock", () => {
  const hits = new Map();
  const t = 1_000_000;
  for (let i = 0; i < MAX_PER_WINDOW; i++) allowSuggestion(hits, "owner-1", t);
  assert.equal(allowSuggestion(hits, "owner-1", t), false);
  assert.equal(allowSuggestion(hits, "owner-1", t + WINDOW_MS), true, "the next window is a fresh count");
});

test("one caller's burst does not spend another's allowance", () => {
  const hits = new Map();
  const t = 1_000_000;
  for (let i = 0; i < MAX_PER_WINDOW; i++) allowSuggestion(hits, "owner-1", t);
  assert.equal(allowSuggestion(hits, "owner-1", t), false);
  assert.equal(allowSuggestion(hits, "owner-2", t), true, "a second phone is not punished for the first");
});

test("an unreadable identity is counted under one shared name, never waved through", () => {
  const hits = new Map();
  const t = 1_000_000;
  for (const who of ["", "   ", null, undefined]) {
    for (let i = 0; i < MAX_PER_WINDOW; i++) allowSuggestion(hits, who, t);
  }
  // All four count as the same caller, so the cap is reached rather than bypassed four
  // times over. An unknown caller is not a licence to be unlimited.
  assert.equal(allowSuggestion(hits, "", t), false);
  assert.equal(hits.size, 1, "one shared name, not four");
});

test("sweepHits forgets only the windows that have closed", () => {
  const hits = new Map();
  allowSuggestion(hits, "old", 1_000_000);
  allowSuggestion(hits, "live", 2_000_000);
  sweepHits(hits, 1_500_000);
  assert.equal(hits.has("old"), false);
  assert.equal(hits.has("live"), true, "a window still running is not forgotten");
});
