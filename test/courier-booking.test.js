// test/courier-booking.test.js — booking a trip, which is the one press in this
// app that puts a real vehicle on the road and commits real money (v189,
// 25 Sep 2026).
//
// Phase 1 could be wrong and cost a wrong number on a screen. This half cannot: a
// booking names real doors and sends a van to them, and the price it books at is
// the price she already quoted to a customer. So the rules below are the ones
// where a mistake is not a wrong number but a wrong journey, and each is pinned
// rather than trusted:
//
//   1. WHICH DOOR IS WHICH. A booking is made of the courier's own handles for
//      the doors (`stopId`), and those handles exist only inside the quotation's
//      reply. Match one to the wrong door and a cake arrives at a stranger's
//      house — and nobody finds out until the customer rings. `stopIdsFor` is
//      where that is decided, and it is tested harder than anything else here.
//   2. WHAT IS SENT. The booking carries the quotation's id and the two ends'
//      names, numbers and handles. NOT the vehicle and NOT the time: those belong
//      to the quotation, and sending them again would be a second, quieter way to
//      choose a vehicle — one that could disagree with the price on her screen
//      while it did so.
//   3. WHEN IT MUST BE REFUSED. Expired price, a price with no doors, a customer
//      with no number. Every one of those is refused in words BEFORE a byte goes
//      out, and refused the same way whether she is looking at a drawn-inert
//      button or pressing a live one.
//   4. THE LAST WALL. `booking.ts` runs on the server, behind the app, and it is
//      the check that fires when something above it is already broken. It went
//      wrong exactly once — a hand-written courier name in its cap sentence, which
//      is the seam leak the v188 guard exists to catch — which is why it lives in
//      its own importable file rather than inside the dispatcher Node cannot load.
//
// Node imports the edge function's TypeScript directly (Node 22 strips the types),
// so the server half is tested as the SAME FILE Deno runs rather than a copy. The
// only thing stubbed anywhere below is `fetch` — never a function under test.

import { test } from "node:test";
import assert from "node:assert/strict";

// The client half reads the session out of localStorage before it will call
// anything, so the phone's own storage is stood in for first. Same shape as
// courier-provider.test.js, and for the same reason.
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

const { orderArgs, partyOf, MAX_DROPS } = await import("../supabase/functions/courier/booking.ts");
const {
  envelope, unwrap, orderPayload, placeOrder, orderDetail, cancelOrder, hostFor,
  driverDetail, orderWithDriver,
} = await import("../supabase/functions/courier/providers/lalamove.ts");
const {
  lalamove, phoneE164, statusLabel, statusDone, normaliseJob, normaliseDetail,
  stopIdsFor, quoteBookable, QUOTE_VALID_MS, phaseOf, driverOf,
} = await import("../admin/js/couriers/lalamove.js");

const KEY = "pk_test_0123456789abcdef";
const SECRET = "sk_test_0123456789abcdef";

function cfg() {
  return { key: KEY, secret: SECRET, market: "MY", host: hostFor("sandbox") };
}

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
  const text = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

const STATE = {
  settings: {
    supabase: { url: "https://example.supabase.co" },
    storefront: { name: "Munchies Furkidz", whatsapp: "016 960 1268" },
  },
};

// The bakery plus one customer, built the way courier_job.js builds one — the shape
// the provider is handed and the only shape it knows.
function readyTrip(extra = {}) {
  return {
    pickup: { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" },
    stops: [{
      order: { id: "ordaaa111" },
      name: "Mei Ling",
      phone: "60169601268",
      address: "12 Jalan Bunga, 10450 Penang",
      place: { lat: 5.42, lng: 100.33, label: "" },
    }],
    scheduleAt: "2026-09-25T02:00:00.000Z",
    ...extra,
  };
}

// A price that came back whole: two doors, each with the courier's own handle, and
// five minutes of life left on it. Quote ids come back from the reply rather than
// from the points, so these handles are the ones the courier gave those coordinates.
function readyQuote(extra = {}) {
  return {
    id: "q-1",
    service: "CAR",
    name: "Car",
    amount: 14,
    currency: "MYR",
    stopIds: ["stop_bakery", "stop_mei"],
    expiresAt: new Date(Date.now() + QUOTE_VALID_MS).toISOString(),
    ...extra,
  };
}

// ── the last wall: what a booking request has to be ───────────────────────

test("a door is only a door when it has the courier's handle, a name and a number", () => {
  assert.deepEqual(partyOf({ stopId: "s1", name: " Mei ", phone: " +60123456789 " }),
    { stopId: "s1", name: "Mei", phone: "+60123456789" });
  // Every one of the three is required, and an empty string is not a value. A stop
  // id is the courier's handle for ONE door; an empty one is a booking at a door
  // nobody chose.
  assert.equal(partyOf({ name: "Mei", phone: "+60" }), null);
  assert.equal(partyOf({ stopId: "s1", phone: "+60" }), null);
  assert.equal(partyOf({ stopId: "s1", name: "Mei" }), null);
  assert.equal(partyOf({ stopId: "  ", name: "Mei", phone: "+60" }), null);
  assert.equal(partyOf(null), null);
  assert.equal(partyOf("a string"), null);
  assert.equal(partyOf(42), null);
});

test("a booking is the price it was quoted at, and every door the price was given for", () => {
  const out = orderArgs({
    quotationId: " q-1 ",
    sender: { stopId: "s1", name: "Bakery", phone: "+60169601268" },
    recipients: [{ stopId: "s2", name: "Mei", phone: "+60123456789" }],
  }, "Lalamove");
  assert.equal(out.error, "");
  assert.equal(out.value.quotationId, "q-1");
  assert.equal(out.value.sender.stopId, "s1");
  assert.equal(out.value.recipients.length, 1);
});

test("a booking with no price is refused, because the alternative is the courier's own price", () => {
  // The whole reason a booking names a quotation. Without one, Lalamove charges
  // whatever it feels like rather than the figure she was shown and has already
  // repeated to a customer.
  const noQuote = orderArgs({
    sender: { stopId: "s1", name: "Bakery", phone: "+60" },
    recipients: [{ stopId: "s2", name: "Mei", phone: "+60" }],
  }, "Lalamove");
  assert.match(noQuote.error, /needs the price it was quoted at/);
  assert.deepEqual(noQuote.value.recipients, [], "a refusal carries nothing that could be sent");

  const blank = orderArgs({ quotationId: "   " }, "Lalamove");
  assert.match(blank.error, /needs the price it was quoted at/);
});

test("a booking with no sender, or no doorstep, or a half-written doorstep, is refused", () => {
  const recipient = { stopId: "s2", name: "Mei", phone: "+60" };
  assert.match(orderArgs({ quotationId: "q", recipients: [recipient] }, "Lalamove").error,
    /no sender with a stop id/);
  assert.match(orderArgs({ quotationId: "q", sender: recipient }, "Lalamove").error,
    /nowhere to deliver to/);
  assert.match(orderArgs({ quotationId: "q", sender: recipient, recipients: [] }, "Lalamove").error,
    /nowhere to deliver to/);
  assert.match(orderArgs({ quotationId: "q", sender: recipient, recipients: "nonsense" }, "Lalamove").error,
    /nowhere to deliver to/);
  // One bad doorstep among good ones takes the whole booking down: half a trip is a
  // van that turns up somewhere with nothing to hand over.
  const mixed = orderArgs({
    quotationId: "q",
    sender: recipient,
    recipients: [{ stopId: "s3", name: "Aunty Bee", phone: "+60" }, { stopId: "s4", name: "No number" }],
  }, "Lalamove");
  assert.match(mixed.error, /doorstep on this booking is missing/);
});

test("the ceiling on one trip is the courier's own, and the sentence names the courier", () => {
  const party = (n) => ({ stopId: `s${n}`, name: `P${n}`, phone: "+60" });
  const many = (n) => Array.from({ length: n }, (_, i) => party(i));
  const args = { quotationId: "q", sender: party("0") };

  assert.equal(orderArgs({ ...args, recipients: many(MAX_DROPS) }, "Lalamove").error, "",
    "fifteen drops is the most the API documents, and the most is allowed");
  const over = orderArgs({ ...args, recipients: many(MAX_DROPS + 1) }, "Lalamove");
  assert.match(over.error, /^Lalamove carries one pickup and 15 drops at most on one trip/);
  assert.match(over.error, /this one has 16/);

  // THE NAME IS A PARAMETER, and this is the assertion that says why. A hand-written
  // "Lalamove" here is the exact fault this file was extracted for: it would be a
  // sentence a second courier's author had to hunt down and edit, in the one place
  // they would never think to look. A courier with a different ceiling passes both
  // its own name and its own number.
  const other = orderArgs({ ...args, recipients: many(3) }, "Zeppelin", 2);
  assert.match(other.error, /^Zeppelin carries one pickup and 2 drops at most/);
  assert.match(other.error, /this one has 3/);

  // And with no name at all it still says something true rather than starting a
  // sentence with a blank.
  assert.match(orderArgs({ ...args, recipients: many(MAX_DROPS + 1) }, "").error,
    /^This courier carries one pickup/);
});

test("the ceiling is checked last, so the sentence is about the load and not about drop 17", () => {
  const party = (n) => ({ stopId: `s${n}`, name: `P${n}`, phone: "+60" });
  const recipients = Array.from({ length: MAX_DROPS + 1 }, (_, i) => party(i));
  recipients[MAX_DROPS] = { name: "no stop id" }; // the last one is also half-written
  assert.match(orderArgs({ quotationId: "q", sender: party("0"), recipients }, "Lalamove").error,
    /carries one pickup and 15 drops at most/);
});

test("a booking request that is not an object is refused rather than thrown at the caller", () => {
  for (const junk of [null, undefined, "nonsense", 42]) {
    const out = orderArgs(junk, "Lalamove");
    assert.match(out.error, /needs the price it was quoted at/);
  }
});

// ── the server's half: the envelope, and the three calls ──────────────────

test("Lalamove wraps everything in `data`, and the wrapper is not a style choice", () => {
  // Its own error for a missing wrapper says so: "the request body structure is
  // incorrect. I.e: {data: {...}}". v188 shipped unwrapped on both halves and no test
  // could have caught it — there was no key, so no request was ever really made, and
  // a test can only assert a shape its author already believed.
  assert.deepEqual(envelope({ a: 1 }), { data: { a: 1 } });
  assert.deepEqual(Object.keys(envelope({})), ["data"]);
});

test("a reply is unwrapped once, and one that is not wrapped is passed through rather than lost", () => {
  assert.deepEqual(unwrap({ data: { quotationId: "q" } }), { quotationId: "q" });
  assert.deepEqual(unwrap({ data: [1, 2] }), [1, 2]);
  // An answer this file does not recognise is handed on as itself. Turning it into
  // `undefined` would read downstream as "the courier said nothing", which is a
  // different and more misleading thing than "this is not the reply we expected".
  assert.deepEqual(unwrap({ orderId: "o1" }), { orderId: "o1" });
  assert.equal(unwrap(null), null);
  assert.equal(unwrap("nonsense"), "nonsense");
  assert.deepEqual(unwrap({ data: null }), null, "an explicit null inside the envelope is the answer");
});

test("the order body names the price and the doors, and deliberately not the vehicle or the time", () => {
  const body = orderPayload({
    quotationId: " q-1 ",
    sender: { stopId: "s1", name: " Bakery ", phone: " +60169601268 " },
    recipients: [{ stopId: "s2", name: "Mei", phone: "+60123456789" }],
  });
  assert.deepEqual(Object.keys(body), ["data"], "the body IS the envelope and nothing sits beside it");
  assert.deepEqual(Object.keys(body.data).sort(), ["quotationId", "recipients", "sender"]);
  assert.equal(body.data.quotationId, "q-1");
  assert.deepEqual(body.data.sender, { stopId: "s1", name: "Bakery", phone: "+60169601268" });
  assert.deepEqual(body.data.recipients, [{ stopId: "s2", name: "Mei", phone: "+60123456789" }]);
  // The three that must never be here. The quotation already holds the vehicle, the
  // time and the stops; repeating them would be a second way to choose a vehicle.
  const sent = JSON.stringify(body);
  for (const k of ["serviceType", "scheduleAt", "stops", "language"]) {
    assert.equal(sent.includes(`"${k}"`), false, `${k} belongs to the quotation and must not be sent again`);
  }
});

test("the order body survives a missing party rather than throwing on the way out", () => {
  const body = orderPayload({ quotationId: "q", sender: null, recipients: null });
  assert.deepEqual(body.data.sender, { stopId: "", name: "", phone: "" });
  assert.deepEqual(body.data.recipients, []);
});

test("booking posts the wrapped order to /v3/orders", async () => {
  const s = stubFetch(jsonReply({ data: { orderId: "o1", shareLink: "https://x.y/z" } }));
  try {
    const out = await placeOrder(cfg(), {
      quotationId: "q-1",
      sender: { stopId: "s1", name: "Bakery", phone: "+60" },
      recipients: [{ stopId: "s2", name: "Mei", phone: "+60" }],
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.data, { orderId: "o1", shareLink: "https://x.y/z" },
      "the reply is unwrapped, so everything above reads one shape");
    assert.equal(s.sent[0].method, "POST");
    assert.match(s.sent[0].url, /\/v3\/orders$/);
    assert.ok(s.sent[0].headers.Authorization, "every call is signed");
    assert.deepEqual(Object.keys(JSON.parse(s.sent[0].body)), ["data"]);
  } finally { s.restore(); }
});

test("a refused booking comes back as a sentence, and never as a thrown error", async () => {
  // A refusal is ORDINARY here. The price died, the wallet is empty, the number is
  // wrong — all of those are answers, and she has to be able to read them.
  const s = stubFetch(jsonReply({ errors: [{ id: "ERR_QUOTATION_EXPIRED" }] }, 400));
  try {
    const out = await placeOrder(cfg(), {
      quotationId: "q-1",
      sender: { stopId: "s1", name: "Bakery", phone: "+60" },
      recipients: [{ stopId: "s2", name: "Mei", phone: "+60" }],
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /more than five minutes old/);
    assert.equal(out.status, 400);
  } finally { s.restore(); }
});

test("the missing-wrapper error is said to be the app's fault, because there is nothing she could do about it", async () => {
  // ERR_INSUFFICIENT_STOPS is what Lalamove answers with when the `data` wrapper is
  // gone, and its own words for it are "Number of stops are less than 2 OR the request
  // body structure is incorrect". Blaming her order for that would send her looking
  // for a mistake she did not make.
  const s = stubFetch(jsonReply({ errors: [{ code: "ERR_INSUFFICIENT_STOPS" }] }, 400));
  try {
    const out = await placeOrder(cfg(), {
      quotationId: "q", sender: { stopId: "s1", name: "B", phone: "+60" },
      recipients: [{ stopId: "s2", name: "M", phone: "+60" }],
    });
    assert.match(out.reason, /fault in the app rather than in your order/);
    assert.match(out.reason, /nothing was booked/);
  } finally { s.restore(); }
});

test("checking a trip is a GET, and it carries no body at all", async () => {
  const s = stubFetch(jsonReply({ data: { orderId: "o1", status: "ON_GOING" } }));
  try {
    const out = await orderDetail(cfg(), "o1");
    assert.equal(out.ok, true);
    assert.equal(s.sent[0].method, "GET");
    assert.match(s.sent[0].url, /\/v3\/orders\/o1$/);
    // NO body — not an empty string. An empty string with a JSON content-type is a
    // third thing that a strict server may or may not read as "no body", and the
    // signature is identical either way because the signer is handed the raw text.
    assert.equal(s.sent[0].body, undefined);
  } finally { s.restore(); }
});

test("a trip number that needs escaping is escaped, so it cannot become a different URL", async () => {
  const s = stubFetch(jsonReply({ data: {} }));
  try {
    await orderDetail(cfg(), "o1/../../v3/orders/other");
    assert.match(s.sent[0].url, /%2F/);
    assert.equal(s.sent[0].url.includes("/v3/orders/other"), false);
  } finally { s.restore(); }
});

test("cancelling is a DELETE with no body, which is what Lalamove documents", async () => {
  // Not the `PUT .../cancel` with a reason some third-party libraries use: it is not
  // in Lalamove's own reference, and a call invented from a library rather than from
  // the reference is a call nobody has ever seen work.
  const s = stubFetch(new Response(null, { status: 204 }));
  try {
    const out = await cancelOrder(cfg(), "o1");
    assert.equal(out.ok, true, "a 204 with no body is a success, not an unreadable answer");
    assert.equal(s.sent[0].method, "DELETE");
    assert.equal(s.sent[0].body, undefined);
    assert.equal(/cancel/.test(s.sent[0].url), false, "the path is the order's own, with nothing appended");
  } finally { s.restore(); }
});

test("a cancellation the courier refuses is ordinary, and says so in words", async () => {
  const s = stubFetch(jsonReply({ errors: [{ code: "ERR_CANCELLATION_FORBIDDEN" }] }, 409));
  try {
    const out = await cancelOrder(cfg(), "o1");
    assert.equal(out.ok, false);
    assert.match(out.reason, /will not let this trip be cancelled/);
  } finally { s.restore(); }
});

// ── the client's half: which door is which ────────────────────────────────

// What came back from a quotation for a bakery at 5.4141/100.3288 and one customer at
// 5.42/100.33, in the order the doors were sent.
const REPLY_STOPS = [
  { stopId: "stop_bakery", coordinates: { lat: "5.4141", lng: "100.3288" } },
  { stopId: "stop_mei", coordinates: { lat: "5.42", lng: "100.33" } },
];
const POINTS = [{ lat: 5.4141, lng: 100.3288 }, { lat: 5.42, lng: 100.33 }];

test("each door gets the handle the courier gave that door's own coordinates", () => {
  assert.deepEqual(stopIdsFor({ stops: REPLY_STOPS }, POINTS), ["stop_bakery", "stop_mei"]);
});

test("the handles are matched by WHERE THE DOOR IS, so a reply in another order is still read right", () => {
  // This is the assertion the whole function exists for. Position is a reading of the
  // contract; coordinates are a fact. A reply that came back in a different order
  // would, under a positional read, hand the bakery's handle to the customer's door —
  // and a van would collect a cake from a stranger's house.
  const swapped = { stops: [REPLY_STOPS[1], REPLY_STOPS[0]] };
  assert.deepEqual(stopIdsFor(swapped, POINTS), ["stop_bakery", "stop_mei"]);
});

test("a door whose point has no handle comes back EMPTY rather than borrowing one", () => {
  // An unmatched door must never be filled in from a neighbour: a wrongly matched id
  // is a van at the wrong house, and the caller refuses to book on an empty one.
  const partial = { stops: [REPLY_STOPS[0]] };
  assert.deepEqual(stopIdsFor(partial, POINTS), ["stop_bakery", ""]);
  // And a moved door matches nothing, because the point no longer agrees with any.
  const moved = { stops: [REPLY_STOPS[0], { stopId: "stop_mei", coordinates: { lat: "5.99", lng: "100.99" } }] };
  assert.deepEqual(stopIdsFor(moved, POINTS), ["stop_bakery", ""]);
});

test("one handle is used once, so two doors at the same spot cannot claim the same id", () => {
  // Two customers in the same building is a real thing in a Malaysian estate, and a
  // second match to the same stop would book one door twice and drop a doorstep.
  const same = [
    { stopId: "stop_a", coordinates: { lat: "5.42", lng: "100.33" } },
    { stopId: "stop_b", coordinates: { lat: "5.42", lng: "100.33" } },
  ];
  const out = stopIdsFor({ stops: same }, [{ lat: 5.42, lng: 100.33 }, { lat: 5.42, lng: 100.33 }]);
  assert.deepEqual(out, ["stop_a", "stop_b"]);
});

test("a reply with no coordinates at all falls back to position, and only then", () => {
  // The documented order is the sender, then the drops as given, so this is a reading
  // of the contract rather than a guess at it. It fires ONLY when the reply carried no
  // geometry anywhere — never to paper over a coordinate that simply did not match.
  const noGeo = { stops: [{ stopId: "s1" }, { stopId: "s2" }] };
  assert.deepEqual(stopIdsFor(noGeo, POINTS), ["s1", "s2"]);
  // A different number of stops than were sent is not a positional reply, so it is
  // left empty rather than guessed at from a shorter list — and here that leaves
  // NOTHING, because the one door that did come back has no coordinate to match on.
  assert.deepEqual(stopIdsFor({ stops: [{ stopId: "s1" }] }, POINTS), ["", ""]);
  // And one coordinate present is enough to say this reply HAS geometry, so the
  // remaining unmatched door stays empty.
  const halfGeo = { stops: [{ stopId: "s1" }, { stopId: "s2", coordinates: { lat: "5.42", lng: "100.33" } }] };
  assert.deepEqual(stopIdsFor(halfGeo, POINTS), ["", "s2"]);
});

test("the older `location` spelling is read too, because the reference is not clear which a sandbox sends", () => {
  const old = { stops: [
    { stopId: "s1", location: { lat: "5.4141", lng: "100.3288" } },
    { stopId: "s2", location: { lat: "5.42", lng: "100.33" } },
  ] };
  assert.deepEqual(stopIdsFor(old, POINTS), ["s1", "s2"]);
});

test("geometry that is not a place on earth is not a match", () => {
  const wild = { stops: [
    { stopId: "s1", coordinates: { lat: "95", lng: "100.3288" } },
    { stopId: "s2", coordinates: { lat: "nonsense", lng: "100.33" } },
  ] };
  assert.deepEqual(stopIdsFor(wild, POINTS), ["", ""]);
  // And a point handed in that is not on earth refuses the whole reading, because
  // nothing about it can be trusted.
  assert.deepEqual(stopIdsFor({ stops: REPLY_STOPS }, [{ lat: null, lng: 100 }, { lat: 5.42, lng: 100.33 }]), ["", ""]);
  assert.deepEqual(stopIdsFor({ stops: REPLY_STOPS }, []), []);
});

test("a price can only be booked when EVERY door came back with a handle", () => {
  assert.equal(quoteBookable(readyQuote()), true);
  assert.equal(quoteBookable({ stopIds: ["a", "b"] }), true);
  assert.equal(quoteBookable({ stopIds: ["a", ""] }), false);
  assert.equal(quoteBookable({ stopIds: ["a", "   "] }), false);
  assert.equal(quoteBookable({ stopIds: ["a"] }), false, "one stop is not a trip — there is nowhere to go");
  assert.equal(quoteBookable({ stopIds: [] }), false);
  assert.equal(quoteBookable({}), false);
  assert.equal(quoteBookable(null), false);
});

// ── the client's half: the trip as a record ───────────────────────────────

test("a booking reply becomes the record the order keeps, price and doors and all", () => {
  const job = normaliseJob(
    { orderId: "o1", shareLink: "https://x.y/z", status: "ASSIGNING_DRIVER" },
    { quote: readyQuote(), trip: readyTrip(), now: Date.parse("2026-09-25T02:00:00.000Z") },
  );
  assert.equal(job.jobId, "o1");
  assert.equal(job.provider, "lalamove", "which courier holds this trip is stored WITH it, not looked up later");
  assert.equal(job.quoteId, "q-1");
  assert.equal(job.service, "CAR");
  assert.equal(job.name, "Car");
  assert.equal(job.amount, 14);
  assert.equal(job.currency, "MYR");
  assert.equal(job.link, "https://x.y/z");
  assert.equal(job.status, "ASSIGNING_DRIVER");
  assert.equal(job.done, false);
  assert.equal(job.statusAt, "2026-09-25T02:00:00.000Z");
  assert.equal(job.bookedAt, "2026-09-25T02:00:00.000Z");
  assert.equal(job.scheduleAt, "2026-09-25T02:00:00.000Z");
});

test("the record says whether the trip has stopped moving, translated from the courier's own word", () => {
  // The ONE neutral word the app's pure half knows. Without it, every screen that asks
  // "is a trip still running on this order" would have to carry Lalamove's status table
  // — which is the coupling the seam exists to prevent, in the one place where being
  // wrong means a second van at the same door.
  const at = { quote: readyQuote(), trip: readyTrip(), now: 0 };
  assert.equal(normaliseJob({ orderId: "o1", status: "COMPLETED" }, at).done, true);
  assert.equal(normaliseJob({ orderId: "o1", status: "CANCELED" }, at).done, true);
  assert.equal(normaliseJob({ orderId: "o1", status: "PICKED_UP" }, at).done, false);
  // A reply with no status at all is not a finished trip: the same safe direction as
  // liveJobOf's missing flag, for the same reason.
  assert.equal(normaliseJob({ orderId: "o1" }, at).done, false);
  // And the translation is the provider's, not this file's — the word goes out with the
  // record as well, because that is what she reads.
  assert.equal(normaliseJob({ orderId: "o1", status: "PICKED_UP" }, at).status, "PICKED_UP");
});

test("a booking with no trip number is refused rather than stored as half a fact", () => {
  // The app cannot check, chase or cancel a trip it cannot name, so half a record is
  // worse than none: it would read as a trip that exists and does nothing.
  assert.equal(normaliseJob({ shareLink: "https://x.y/z" }, { quote: readyQuote() }), null);
  assert.equal(normaliseJob({ orderId: "   " }, { quote: readyQuote() }), null);
  assert.equal(normaliseJob(null, { quote: readyQuote() }), null);
  assert.equal(normaliseJob("nonsense", { quote: readyQuote() }), null);
});

test("the booked price is the reply's own when it carries one, and the quoted price when it does not", () => {
  // One reading either way, so a booked trip's figure can never disagree with the
  // figure she was shown and quoted to a customer.
  const priced = normaliseJob({ orderId: "o1", priceBreakdown: { total: "14.50", currency: "MYR" } }, { quote: readyQuote() });
  assert.equal(priced.amount, 14.5);
  assert.equal(priced.currency, "MYR");

  const silent = normaliseJob({ orderId: "o1" }, { quote: readyQuote() });
  assert.equal(silent.amount, 14, "the price it was booked at");

  // And with no price anywhere, the amount is null rather than a zero she never saw.
  assert.equal(normaliseJob({ orderId: "o1" }, {}).amount, null);
  assert.equal(normaliseJob({ orderId: "o1", priceBreakdown: { total: null } }, {}).amount, null,
    "a null total is not a price of zero here either");
});

test("the schedule is the trip's own time, carried onto the record", () => {
  assert.equal(normaliseJob({ orderId: "o1" }, { trip: readyTrip() }).scheduleAt, "2026-09-25T02:00:00.000Z");
  assert.equal(normaliseJob({ orderId: "o1" }, { trip: readyTrip({ scheduleAt: "" }) }).scheduleAt, "");
  // The reply's own when the trip has none — a booking made from a saved day may carry
  // it back either way, and both are the same instant.
  assert.equal(normaliseJob({ orderId: "o1", scheduleAt: "2026-09-25T03:00:00.000Z" }, {}).scheduleAt, "2026-09-25T03:00:00.000Z");
});

test("Lalamove's own word for where a trip is, in hers — and an unknown word is shown as sent", () => {
  assert.equal(statusLabel("ASSIGNING_DRIVER"), "Finding a driver");
  assert.equal(statusLabel("PICKED_UP"), "Collected");
  assert.equal(statusLabel("COMPLETED"), "Delivered");
  assert.equal(statusLabel("CANCELED"), "Cancelled");
  assert.equal(statusLabel("assigning_driver"), "Finding a driver", "the API's own case is not depended on");
  // The day it adds one, a word she does not know is still more use than a blank line —
  // and a blank line reads as "nothing has happened", which is the one thing that might
  // not be true.
  assert.equal(statusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(statusLabel(""), "");
  assert.equal(statusLabel(null), "");
});

test("a trip has stopped moving, or it has not — and the list is exhaustive on purpose", () => {
  for (const over of ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]) {
    assert.equal(statusDone(over), true, `${over} is over`);
  }
  for (const live of ["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP", "SOMETHING_NEW", "", null]) {
    // Anything not on the list reads as LIVE, which is the safe direction: a trip
    // wrongly thought finished is a second van at the same door, and that costs money
    // she did not agree to. Cancelling is allowed only while a driver is being found or
    // within five minutes of one being matched, so an unknown word reading as live
    // offers a [Cancel trip] the courier may refuse — which is an ordinary answer,
    // where a second van is not.
    assert.equal(statusDone(live), false, `${live} is not known to be over`);
  }
});

test("a check reads where the trip has got to, and never blanks a link already on the order", () => {
  const detail = normaliseDetail({ status: "PICKED_UP", shareLink: "https://x.y/z" }, Date.parse("2026-09-25T02:00:00.000Z"));
  assert.deepEqual(detail, {
    status: "PICKED_UP", statusAt: "2026-09-25T02:00:00.000Z", link: "https://x.y/z",
    phase: "collected", driver: null, done: false,
  });
  // An empty link from a check means "this reply carried none", NOT "there is none" —
  // the caller merges only a non-empty one, and this is the shape it merges from.
  assert.equal(normaliseDetail({ status: "ON_GOING" }, 0).link, "");
  assert.equal(normaliseDetail({ status: "COMPLETED" }, 0).done, true);
  // A reply that does not say where the trip is has not answered the question, and
  // pretending it said "nothing has happened" is the misleading half of that.
  assert.equal(normaliseDetail({ shareLink: "https://x.y/z" }, 0), null);
  assert.equal(normaliseDetail(null, 0), null);
});

// ── the phase, and the driver (v190) ──────────────────────────────────────
//
// The customer's page carries its own words for where a delivery has got to, in all
// three languages, and it must never be taught a courier's vocabulary — that is the
// whole point of a seam. So a courier's own status string is turned into one of a
// handful of NEUTRAL phases HERE, in its own file, and the storefront reads only those.
// A second courier's file therefore cannot make the customer's page wrong.
test("a courier's own status becomes one neutral phase, and an unknown one says nothing rather than guessing", () => {
  assert.equal(phaseOf("ASSIGNING_DRIVER"), "finding");
  assert.equal(phaseOf("ON_GOING"), "on_the_way");
  assert.equal(phaseOf("PICKED_UP"), "collected");
  assert.equal(phaseOf("COMPLETED"), "delivered");
  assert.equal(phaseOf("CANCELED"), "stopped");
  assert.equal(phaseOf("REJECTED"), "nodriver");
  assert.equal(phaseOf("EXPIRED"), "nodriver");
  assert.equal(phaseOf("assigning_driver"), "finding", "the API's own case is not depended on");
  // An unknown word publishes NOTHING, and that is the opposite of what her own screen
  // does with it. Her screen shows the raw word, because a word she does not know is
  // still more use than a blank line and she can go and look it up. The customer cannot:
  // an unfamiliar word on their card is a line they can do nothing with, so the honest
  // answer is to leave the line off — and the caller keeps whatever phase it already had.
  assert.equal(phaseOf("SOMETHING_NEW"), "");
  assert.equal(phaseOf(""), "");
  assert.equal(phaseOf(null), "");
});

test("the driver is read field by field, and an empty one is no driver at all", () => {
  assert.deepEqual(
    driverOf({ driver: { name: "Ah Meng", plateNumber: "PMM 1234", phone: "0123456789" } }),
    { name: "Ah Meng", plate: "PMM 1234", phone: "0123456789" });
  // The older spelling of the plate, and a missing name — either alone is still worth a
  // line on the customer's card, so neither field is required.
  assert.deepEqual(driverOf({ driver: { plate: "PMM 1234" } }), { name: "", plate: "PMM 1234", phone: "" });
  assert.deepEqual(driverOf({ driver: { name: "  Ah Meng  " } }), { name: "Ah Meng", plate: "", phone: "" });
  // Nothing at all is null rather than an object of empty strings: the storefront and the
  // app's own card both decide whether to draw a driver line on there being one, so an
  // object of empties would put a blank line on the customer's card.
  assert.equal(driverOf({}), null);
  assert.equal(driverOf(null), null);
  assert.equal(driverOf({ driver: {} }), null);
  assert.equal(driverOf({ driver: "Ah Meng" }), null, "a string where a record belongs is not a driver");
});

test("a booking's own reply carries a phase too, so the record says where the trip is from the start", () => {
  const job = normaliseJob({ orderId: "o1", status: "ASSIGNING_DRIVER" }, { quote: readyQuote() });
  assert.equal(job.phase, "finding");
  assert.equal(job.driver, null);
  assert.equal(normaliseJob({ orderId: "o1", status: "PICKED_UP" }, { quote: readyQuote() }).phase, "collected");
});

test("the driver is a SECOND call, and its refusal never fails the check", async () => {
  // A trip with a driver matched: the order reply carries only a `driverId`, so the name,
  // the plate and the number come from the driver's own endpoint.
  const asked = [];
  const s1 = stubFetch((url) => {
    asked.push(String(url));
    if (String(url).includes("/v3/drivers/")) {
      return jsonReply({ data: { driverId: "d1", name: "Ah Meng", plateNumber: "PMM 1234", phone: "0123456789" } });
    }
    return jsonReply({ data: { orderId: "o1", status: "ON_GOING", driverId: "d1" } });
  });
  try {
    const out = await orderDetail(cfg(), "o1");
    assert.equal(out.ok, true);
    const withDriver = await orderWithDriver(cfg(), out.data);
    assert.deepEqual(withDriver.driver, { driverId: "d1", name: "Ah Meng", plateNumber: "PMM 1234", phone: "0123456789" });
    assert.equal(asked.filter((u) => u.includes("/v3/drivers/")).length, 1, "one driver call, and only one");
  } finally { s1.restore(); }

  // No driver matched yet: no second call is made at all, because there is no id to ask
  // about. This is the ordinary state of a trip in its first hour.
  const none = [];
  const s2 = stubFetch((url) => {
    none.push(String(url));
    return jsonReply({ data: { orderId: "o1", status: "ASSIGNING_DRIVER", driverId: "" } });
  });
  try {
    const out = await orderDetail(cfg(), "o1");
    const same = await orderWithDriver(cfg(), out.data);
    assert.deepEqual(same, out.data, "the order comes back exactly as it was");
    assert.equal(none.filter((u) => u.includes("/v3/drivers/")).length, 0, "nothing was asked of the driver endpoint");
  } finally { s2.restore(); }

  // AND THE ONE THAT MATTERS. The driver's endpoint answers nothing until an hour before
  // the pickup, so on a check made earlier in the day it refuses EVERY time. That refusal
  // says nothing about the trip, which is perfectly healthy — so it must not reach her as
  // an error, and the order must come back whole.
  const s3 = stubFetch((url) => {
    if (String(url).includes("/v3/drivers/")) {
      return jsonReply({ message: "driver not found", errors: [{ code: "ERR_DRIVER_NOT_FOUND" }] }, 404);
    }
    return jsonReply({ data: { orderId: "o1", status: "ON_GOING", driverId: "d1" } });
  });
  try {
    const out = await orderDetail(cfg(), "o1");
    const still = await orderWithDriver(cfg(), out.data);
    assert.equal(still.orderId, "o1");
    assert.equal(still.status, "ON_GOING", "the trip's own reading is untouched by a driver that cannot be read");
    assert.equal("driver" in still, false, "and no driver key is invented for it");
  } finally { s3.restore(); }

  // An id that is not there is refused locally, before anything is asked of the network —
  // a request with an empty id in the path would be a 404 dressed up as a real answer.
  const s4 = stubFetch(() => jsonReply({ data: {} }));
  try {
    const refused = await driverDetail(cfg(), "   ");
    assert.equal(refused.ok, false);
    assert.equal(s4.sent.length, 0, "nothing was sent");
  } finally { s4.restore(); }
});

// ── the client's half: the presses, through the real channel ──────────────

test("the phone number a courier dials carries its plus, and one that already has it is untouched", () => {
  // The app stores every number without a plus on purpose — `waNumber()` produces the
  // digits-only form wa.me links need — and Lalamove's own pattern refuses a number
  // without one. The plus is added here, where a courier's rules live, rather than
  // changing what the app stores for the sake of one API.
  assert.equal(phoneE164("016 960 1268"), "+0169601268");
  assert.equal(phoneE164("+60 12-345 6789"), "+60123456789");
  assert.equal(phoneE164("60123456789"), "+60123456789");
  assert.equal(phoneE164("+60123456789"), "+60123456789", "idempotent, rather than becoming ++60…");
  assert.equal(phoneE164(""), "");
  assert.equal(phoneE164("   "), "");
  assert.equal(phoneE164(null), "");
  assert.equal(phoneE164("no digits here"), "");
});

test("booking sends only the price and the doors, and the doors carry their own handles", async () => {
  // THE SEAM, ASSERTED ON THE WIRE for the booking half. A booking is the call that
  // spends money, so what it carries matters more than what a quotation carries — and
  // what it must never carry is anything from her books.
  const s = stubFetch(jsonReply({ ok: true, order: { orderId: "o1", shareLink: "https://x.y/z", status: "ASSIGNING_DRIVER" } }));
  try {
    const out = await lalamove.book(STATE, readyTrip(), readyQuote());
    assert.equal(out.ok, true);
    assert.equal(out.job.jobId, "o1");

    const sent = JSON.parse(s.sent[0].body);
    assert.deepEqual(Object.keys(sent).sort(), ["action", "payload", "provider"]);
    assert.equal(sent.action, "book");
    assert.equal(sent.provider, "lalamove");
    assert.deepEqual(Object.keys(sent.payload).sort(), ["quotationId", "recipients", "sender"]);
    assert.equal(sent.payload.quotationId, "q-1");
    // The bakery first, then each door — matched back to what was priced, never taken
    // in order on trust. See stopIdsFor.
    assert.deepEqual(sent.payload.sender, { stopId: "stop_bakery", name: "Munchies Furkidz", phone: "+60169601268" });
    assert.deepEqual(sent.payload.recipients, [{ stopId: "stop_mei", name: "Mei Ling", phone: "+60169601268" }]);
    // The vehicle and the time are NOT here. They belong to the quotation, and sending
    // them again would be a second, quieter way to choose a vehicle — one that could
    // disagree with the price she is looking at while it did so.
    for (const k of ["serviceType", "scheduleAt", "stops", "amount"]) {
      assert.equal(s.sent[0].body.includes(`"${k}"`), false, `${k} must not be sent with a booking`);
    }
  } finally { s.restore(); }
});

test("a customer with no name still has one for the driver, and it is not invented as theirs", async () => {
  const s = stubFetch(jsonReply({ ok: true, order: { orderId: "o1", status: "ASSIGNING_DRIVER" } }));
  try {
    const trip = readyTrip();
    trip.stops[0].name = "";
    await lalamove.book(STATE, trip, readyQuote());
    // "Customer" is what it is, and the number beside it is what the driver actually
    // rings — inventing a name for somebody would be putting a stranger's word in the
    // driver's mouth.
    assert.equal(JSON.parse(s.sent[0].body).payload.recipients[0].name, "Customer");
    // A bakery that has never typed its own name is named by the SAME rule that names
    // it everywhere else in the app — senderOf()'s own fallback — and not by a second
    // default written into the booking. A second one could only ever disagree with it.
    const bare = { settings: { supabase: STATE.settings.supabase, storefront: { whatsapp: "0169601268" } } };
    const s2 = stubFetch(jsonReply({ ok: true, order: { orderId: "o2", status: "ASSIGNING_DRIVER" } }));
    try {
      await lalamove.book(bare, readyTrip(), readyQuote());
      assert.equal(JSON.parse(s2.sent[0].body).payload.sender.name, "Munchies Furkidz");
    } finally { s2.restore(); }
  } finally { s.restore(); }
});

test("the booking press refuses, in words and before any call, for every reason that has no trip in it", async () => {
  // The whole refusal list, driven through the press itself rather than through the
  // helper, so what is asserted is what she actually reads. Every one of these must
  // come back BEFORE a byte leaves the phone: a booking that is refused by the courier
  // has already cost a round trip, and one that is refused silently costs a van.
  const noQuote = stubFetch(jsonReply({ ok: true }));
  try {
    const noDrop = readyTrip();
    noDrop.stops[0].place = null;
    const out = await lalamove.book(STATE, noDrop, readyQuote());
    assert.equal(out.ok, false);
    assert.match(out.reason, /doorstep is not pinned yet/);

    const noId = await lalamove.book(STATE, readyTrip(), readyQuote({ id: "" }));
    assert.match(noId.reason, /no price to book/);

    const expired = await lalamove.book(STATE, readyTrip(),
      readyQuote({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    assert.match(expired.reason, /expired, so it cannot be booked/);
    assert.match(expired.reason, /only good for five minutes/);

    // A price with a door the courier never named. This one must say the APP is reading
    // the reply wrongly, because it is: a workaround here would hide a real fault.
    const unnamed = await lalamove.book(STATE, readyTrip(), readyQuote({ stopIds: ["stop_bakery", ""] }));
    assert.match(unnamed.reason, /did not come back with the courier's own handle/);
    assert.match(unnamed.reason, /worth fixing rather than working around/);

    assert.equal(noQuote.sent.length, 0, "not one of those reasons made a call");
  } finally { noQuote.restore(); }
});

test("a doorstep with no number is refused in words, and says how many when there are several", async () => {
  const s = stubFetch(jsonReply({ ok: true, order: { orderId: "o1", status: "ASSIGNING_DRIVER" } }));
  try {
    const trip = readyTrip();
    trip.stops[0].phone = "";
    const one = await lalamove.book(STATE, trip, readyQuote());
    assert.equal(one.ok, false);
    assert.match(one.reason, /This customer has no WhatsApp number/);

    // Two drops, both without numbers: the sentence counts them, because "this
    // customer" about two orders would send her looking at the wrong one.
    const two = readyTrip();
    two.stops = [
      { ...two.stops[0], phone: "" },
      { order: { id: "ordbbb222" }, name: "Aunty Bee", phone: "", address: "9 Jalan Bunga", place: { lat: 5.43, lng: 100.34, label: "" } },
    ];
    const many = await lalamove.book(STATE, two, readyQuote({ stopIds: ["stop_bakery", "stop_a", "stop_b"] }));
    assert.match(many.reason, /^2 of these customers have no WhatsApp number/);

    // And a bakery with no number of its own: the driver has to be able to ring the
    // door being collected from, so this is refused rather than booked.
    const bare = { settings: { supabase: STATE.settings.supabase, storefront: {} } };
    const shop = await lalamove.book(bare, readyTrip(), readyQuote());
    assert.match(shop.reason, /You have no WhatsApp number in Settings/);

    assert.equal(s.sent.length, 0, "none of these reached the courier either");
  } finally { s.restore(); }
});

test("a booking that the courier took but could not name is the one refusal that must never be quiet", async () => {
  // Money may already be committed. Telling her "that did not work" would be a lie she
  // might act on by booking a second van to the same door.
  const s = stubFetch(jsonReply({ ok: true, order: { shareLink: "https://x.y/z" } }));
  try {
    const out = await lalamove.book(STATE, readyTrip(), readyQuote());
    assert.equal(out.ok, false);
    assert.match(out.reason, /took the booking but did not send back a trip number/);
    assert.match(out.reason, /nothing has been recorded here/);
    assert.match(out.reason, /before booking again/);
  } finally { s.restore(); }
});

test("checking a trip asks the courier that HOLD it, by the trip's own number", async () => {
  const s = stubFetch(jsonReply({ ok: true, order: { status: "ON_GOING", shareLink: "https://x.y/z" } }));
  try {
    const out = await lalamove.job(STATE, "o1");
    assert.equal(out.ok, true);
    assert.equal(out.detail.status, "ON_GOING");
    assert.equal(out.detail.link, "https://x.y/z");
    const sent = JSON.parse(s.sent[0].body);
    assert.equal(sent.action, "job");
    assert.deepEqual(Object.keys(sent.payload), ["orderId"]);
    assert.equal(sent.payload.orderId, "o1");
  } finally { s.restore(); }
});

test("a check with no trip number, or an answer that does not say where the trip is, is said in words", async () => {
  const s = stubFetch(jsonReply({ ok: true, order: { shareLink: "https://x.y/z" } }));
  try {
    const empty = await lalamove.job(STATE, "");
    assert.equal(empty.ok, false);
    assert.match(empty.reason, /no booked trip to check/);

    const silent = await lalamove.job(STATE, "o1");
    assert.equal(silent.ok, false);
    assert.match(silent.reason, /without saying where this trip has got to/);
  } finally { s.restore(); }
});

test("calling a trip off is an ordinary answer either way, and reaches the trip by its own number", async () => {
  // The courier decides whether it still can. Both outcomes arrive through the same
  // contract as everything else — { ok, reason } — so a refusal reads as a sentence
  // rather than as a broken screen.
  const yes = stubFetch(jsonReply({ ok: true }));
  try {
    const out = await lalamove.cancel(STATE, "o1");
    assert.equal(out.ok, true);
    const sent = JSON.parse(yes.sent[0].body);
    assert.equal(sent.action, "cancel");
    assert.equal(sent.payload.orderId, "o1");
  } finally { yes.restore(); }

  const no = stubFetch(jsonReply({ ok: false, reason: "Lalamove will not let this trip be cancelled any more." }, 200));
  try {
    const out = await lalamove.cancel(STATE, "o1");
    assert.equal(out.ok, false);
    assert.match(out.reason, /will not let this trip be cancelled/);
  } finally { no.restore(); }

  const none = stubFetch(jsonReply({ ok: true }));
  try {
    const out = await lalamove.cancel(STATE, "");
    assert.equal(out.ok, false);
    assert.match(out.reason, /no booked trip to cancel/);
    assert.equal(none.sent.length, 0);
  } finally { none.restore(); }
});

test("the fleet the booking half knows about is the same one the price half lists", () => {
  // book/job/cancel are three of the five things the interface asks a courier for, so
  // all five are present on the one object the registry hands out. A courier missing
  // one of them would be a second courier that half-works.
  for (const verb of ["vehicles", "quote", "book", "job", "cancel"]) {
    assert.equal(typeof lalamove[verb], "function", `${verb}() is part of what a courier is`);
  }
});
