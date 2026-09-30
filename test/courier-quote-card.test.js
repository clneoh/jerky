// test/courier-quote-card.test.js — the booked-trip card on the drawn courier screen
// (v234, 29 Sep 2026).
//
// test/courier-job.test.js holds the arithmetic of the free-calling-off window and
// test/courier-booking.test.js holds Lalamove's own 45 minutes. This file holds the
// SCREEN — the first test this screen has ever had, which is its own point: the card is
// where a booked trip meets her, and until now everything it drew was asserted nowhere.
//
// What is pinned here, and why each one is a way of being quietly wrong with money:
//
//   1. THE DEADLINE IS ON THE CARD. The grace period is the one thing about a booking
//      that can still cost her money after it is made. A card that showed the price, the
//      status and the link but not this left the rule in her head.
//   2. IT IS THE TRIP'S OWN COURIER WHO SAYS IT, through the courier that HOLDS the trip
//      — so a second courier with a different grace changes one line in one provider file
//      and this card follows without being opened.
//   3. A WINDOW THAT HAS SHUT IS NOT DRAWN AS AN OPEN ONE. "Free to call off until 9:15"
//      still sitting there at half past is worse than no line at all.
//   4. AN IMMEDIATE BOOKING GETS THE RULE AND NOT A MADE-UP CLOCK — see the provider file
//      for why 20 minutes cannot become a deadline from here.
//   5. A FINISHED OR ALREADY-CALLED-OFF TRIP GETS NO LINE. There is nothing left to call
//      off, and a deadline on a delivered trip is a control offering what cannot happen.
//
// The screen sits behind the sign-in, so it is built for real on a stand-in DOM, and the
// courier function is answered by a stubbed `fetch`. Nothing about the app's own code is
// stubbed: the same modules the phone runs are the ones under test here.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── the stand-in screen ───────────────────────────────────────────────────
//
// The house shim, copied here rather than shared (there is no shared-helpers directory
// in this suite, deliberately — a shim that drifts between files hides which file a
// change broke). Each part earns its place:
//
//   • isConnected is WALKED, not assumed. The card asks its own node whether it is still
//     on the page before writing a slow reply into it, so a stand-in answering `undefined`
//     would send every write down the "it is gone" path and these tests would pass for
//     the wrong reason. Dropping a child with replaceChildren takes its isConnected away
//     with it, which is why the parent link is cut.
//   • A STRING handed to a DOM write becomes a text node, the way the real DOM's String()
//     does — the card hands its lines plain strings, and a stand-in storing them verbatim
//     would answer `textContent` with `undefined` while her phone showed the sentence.
//   • A SELECT reads back the option marked selected, as a browser's does.

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, checked: false, disabled: false, hidden: false, selected: false,
    scrollTop: 0, parentNode: null, _listeners: {}, _val: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) {
      if (c == null) return c;
      const n = toNode(c);
      this.children.push(n);
      if (n.nodeType === 1) n.parentNode = this;
      return n;
    },
    append(...cs) {
      for (const c of cs) if (c != null) {
        const n = toNode(c);
        this.children.push(n);
        if (n.nodeType === 1) n.parentNode = this;
      }
    },
    replaceChildren(...cs) {
      for (const old of this.children) if (old && old.nodeType === 1) old.parentNode = null;
      this.children = [];
      for (const c of cs) if (c != null) {
        const n = toNode(c);
        this.children.push(n);
        if (n.nodeType === 1) n.parentNode = this;
      }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  Object.defineProperty(node, "isConnected", {
    get() {
      let n = this;
      while (n) { if (n.__root) return true; n = n.parentNode; }
      return false;
    },
  });
  Object.defineProperty(node, "value", {
    get() {
      if (this._val !== "") return this._val;
      const opts = all(this).filter((n) => n.tagName === "OPTION");
      const sel = opts.find((o) => o.selected) || opts[0];
      return sel ? sel.value : "";
    },
    set(v) { this._val = String(v); },
  });
  return node;
}

// What the real DOM does with anything that is not already a node.
const toNode = (c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) });

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};

// One toast node for the whole file. toast() looks its own node up by class and creates
// one only when it finds none, so a `querySelector` that always answered null would leave
// a fresh 2.2-second timer behind on every call, and the suite would sit there after its
// last assertion waiting for a toast nobody is reading.
const toastNode = Object.assign(createEl("div"), { className: "toast" });
const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= Object.assign(createEl("div"), { __root: true })),
  querySelector: (sel) => (String(sel).includes("toast") ? toastNode : null),
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: (() => { const b = createEl("body"); b.__root = true; return b; })(),
  head: createEl("head"),
};
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };

// The phone's own storage, in the shape supabase.js reads it. The channel refuses to call
// anything without a session, which is fine here — every call below is stubbed — but a
// file that skipped this would be exercising the refusal message rather than the card.
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

const wires = [];
afterEach(() => {
  for (const w of wires.splice(0).reverse()) w.restore();
  clearTimeout(toastNode._timer);
});

// THE CARD'S OWN BEAT, and this file has to own it. Every other screen in this suite
// returns a cleanup function the test can hand back; this section returns a NODE, and its
// beat stops itself only when that node comes off the page — which these roots never do,
// because they are marked as being on it. An interval left running keeps the whole Node
// process alive after the last assertion, and a suite that passes and then never finishes
// is its own kind of bug. So every beat the screen asks for is kept, and dropped here.
//
// The CALLBACK is kept alongside the handle, which is what lets a test fire the real beat
// the phone runs rather than a copy of it — the clock advancing is the whole point of the
// deadline line, and an assertion that only read the words at rest would not notice a
// timer that never fires or a line that never changes.
const beats = new Map();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn, ms, ...rest) => {
  const h = realSetInterval(fn, ms, ...rest);
  beats.set(h, fn);
  return h;
};
globalThis.clearInterval = (h) => { beats.delete(h); return realClearInterval(h); };
afterEach(() => {
  for (const h of beats.keys()) realClearInterval(h);
  beats.clear();
});
// One second passing, as the screen itself measures it.
const tickBeats = () => { for (const fn of [...beats.values()]) fn(); };

const { courierQuoteSection } = await import("../admin/js/views/courier_quote.js");
const { keyOf } = await import("../admin/js/customers.js");
// The real holder object the screen asks, so the spy below watches the call the phone
// actually makes rather than a stand-in for it.
const { lalamove } = await import("../admin/js/couriers/lalamove.js");

// ── the stubbed wire ──────────────────────────────────────────────────────
//
// It records every ask and answers the courier function's own contract — a JSON body
// carrying `{ok, ...}`. Nothing here prices anything: what this file reads is the CARD,
// and a booking is never made. The refusal is deliberate, so a test that accidentally
// reached a real quotation would fail loudly rather than pass on a shape it never meant
// to depend on.
const REFUSED = { ok: false, reason: "no price in this test" };

function stubFetch() {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), body: opts.body ? JSON.parse(String(opts.body)) : null });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async json() { return REFUSED; },
      async text() { return JSON.stringify(REFUSED); },
    };
  };
  const stub = { sent, restore() { if (globalThis.fetch === stubFetch) globalThis.fetch = real; } };
  wires.push(stub);
  return stub;
}

// ── the world ─────────────────────────────────────────────────────────────
//
// One courier order, one booked trip on it, both doors already pinned — so the screen has
// nothing to geocode and the stubbed wire stays down to the calls this feature is about.
const PICKUP = { lat: 5.4141, lng: 100.3288, label: "The bakery, Penang" };
const DROP = { lat: 5.42, lng: 100.33, label: "Ain's door" };

// A moment on Penang's own clock, built the way a person would say it. The suite builds
// its moments in LOCAL time on purpose, for the reason courier-job.test.js spells out:
// a stamp is what a person reads on their own phone.
const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi);

// THE WHOLE CLOCK, not just `Date.now`. Both halves matter and they must agree, or the
// card is made to look wrong by the test rather than by itself: the deadline's own line
// reads the current instant from `Date.now`, and `todayISO()` — which the card uses to
// decide whether a moment is "9:15 am" or "2 Oct, 9:15 am" — reads `new Date()`. Mocking
// one and not the other would date every stamp in these assertions, which is exactly what
// happened the first time this file was run.
//
// Only a test whose subject is the clock freezes it, and it is put back afterwards.
function freezeClock(ms) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) { if (a.length) super(...a); else super(ms); }
    static now() { return ms; }
  }
  globalThis.Date = Frozen;
  return () => { globalThis.Date = Real; };
}

function world(job) {
  const st = {
    version: 1,
    settings: {
      currency: "RM",
      courier: { dispatch: "10:00" },
      supabase: { enabled: true, url: "https://proj.supabase.co", anonKey: "anon-key" },
      storefront: { name: "Jienluv2bake", whatsapp: "60123456789" },
      pickupPlace: PICKUP,
    },
    products: [{ id: "p1", name: "Focaccia", price: 15, active: true }],
    deliveryDates: [{ id: "d1", date: "2026-10-02" }],
    customers: [],
    orders: [
      { id: "o1", groupId: "g1", deliveryDateId: "d1", fulfillment: "courier",
        status: "paid", createdAt: "2026-09-28T02:00:00.000Z",
        address: "1 Jalan A", whatsapp: "+60 12-111 1111", customerName: "Ain",
        productId: "p1", qty: 2, courierJob: job },
    ],
    ingredients: [], occasions: [], expenses: [],
  };
  // The doorstep, keyed the way the app keys a person — derived from the order itself, so
  // this fixture cannot drift away from the key the screen looks it up by.
  st.customers = [
    { id: "cus_1", key: keyOf(st.orders[0]), name: "Ain", whatsapp: "+60 12-111 1111", place: DROP },
  ];
  return st;
}

// A booked trip as the order row actually keeps it. Written by hand rather than made by
// `normaliseJob`, because what this file is about is the CARD reading a record that is
// already on the order — not the booking that would have written it.
function bookedJob(extra = {}) {
  const booked = at(2026, 9, 1, 9, 0).toISOString();
  return {
    jobId: "JOB1", provider: "lalamove", name: "Motorcycle", amount: 18.5, currency: "MYR",
    link: "https://x/1", status: "ASSIGNING_DRIVER", statusAt: booked, bookedAt: booked,
    phase: "assigned",
    ...extra,
  };
}

// The screen, built for real and opened. The root is marked as on the page: the real one
// sits inside a pop-up layer, and every press on this screen refuses to act against a node
// that has been taken off it — a root with no marker would answer "not connected" and
// nothing would ever be painted.
function openCard(st) {
  const root = Object.assign(createEl("div"), { __root: true });
  const section = courierQuoteSection({ state: st, orders: st.orders });
  root.append(section);
  // The screen is built on the FIRST open — which is the press her thumb makes. Nothing
  // below is drawn before this click, so a test that skipped it would be asserting against
  // an empty fold and passing for the wrong reason.
  press(root, "Get a delivery price");
  return root;
}

// Find the one node wearing a class, or null. The card is a small tree and every line on
// it has a class of its own, which is what makes this readable rather than fragile.
const byClass = (root, want) => all(root).find((n) => n.className === want) || null;

// Press a button by the words on it — the same handle a thumb has.
function press(root, label) {
  const btn = all(root).find((n) => n.tagName === "BUTTON" && n.textContent === label);
  assert.ok(btn, `no button on this screen reads "${label}"`);
  for (const f of btn._listeners.click || []) f({});
  return btn;
}

// ── the card ──────────────────────────────────────────────────────────────

test("a booked trip carries the moment it stops being free to call off, in the courier's own words", () => {
  stubFetch();
  // Pinned to a morning where the window is still OPEN: a 10:00 pickup shuts at 9:15, and
  // the card is read at 8:30.
  const held = at(2026, 9, 2, 8, 30).getTime();
  const unpin = freezeClock(held);
  try {
    const st = world(bookedJob({ scheduleAt: at(2026, 9, 2, 10, 0).toISOString() }));
    const root = openCard(st);

    const line = byClass(root, "job-free");
    assert.ok(line, "the booked-trip card must carry the free-calling-off line");
    assert.equal(
      line.textContent,
      "Free to call off until 9:15 am — Lalamove may charge a fee after that.",
    );
    // And the courier NAMES ITSELF in it, from the one place its name is written — the
    // card asks the trip's own holder rather than knowing a courier's policy.
    assert.match(line.textContent, /Lalamove/);
  } finally { unpin(); }
});

test("once the window has shut the card says so, rather than still offering a free call-off", () => {
  stubFetch();
  const unpin = freezeClock(at(2026, 9, 2, 9, 30).getTime());
  try {
    const st = world(bookedJob({ scheduleAt: at(2026, 9, 2, 10, 0).toISOString() }));
    const line = byClass(openCard(st), "job-free");
    assert.ok(line);
    assert.equal(
      line.textContent,
      "Lalamove's free calling-off window shut at 9:15 am, so a fee may apply from here.",
    );
    // The instruction to her has changed with it: this is a warning, not an offer.
    assert.equal(/Free to call off/.test(line.textContent), false);
  } finally { unpin(); }
});

test("a trip booked for as soon as possible gets the rule, with no clock invented onto the card", () => {
  stubFetch();
  const st = world(bookedJob());          // no scheduleAt — booked for collection now
  const line = byClass(openCard(st), "job-free");
  assert.ok(line);
  assert.match(line.textContent, /as soon as possible/);
  assert.match(line.textContent, /Lalamove/);
  // No digit on the line, for the reason the provider file gives: the clock starts at a
  // match this app never sees. A "free until 9:04" here would be a promise it cannot keep.
  assert.equal(/\d/.test(line.textContent), false, "the rule is said, no time is made up");
});

test("a finished trip and one already called off carry no line at all", () => {
  stubFetch();
  const pick = at(2026, 9, 2, 10, 0).toISOString();

  // Finished: `done` is what the app writes when the journey is over.
  const finished = openCard(world(bookedJob({ scheduleAt: pick, done: true, phase: "delivered" })));
  assert.equal(byClass(finished, "job-free"), null, "nothing left to call off on a delivered trip");
  // The rest of the card is still drawn — the record of the journey is the point of it.
  assert.ok(byClass(finished, "job-status"), "the finished trip is still on the card");

  // Called off: the app knows she did it and when, and a deadline here would be a control
  // offering something that has already happened.
  const off = openCard(world(bookedJob({ scheduleAt: pick, cancelledAt: at(2026, 9, 1, 9, 5).toISOString() })));
  assert.equal(byClass(off, "job-free"), null);
  assert.match(byClass(off, "job-status").textContent, /Called off from here/);
});

test("the deadline sits under the status and above the driver, where the money on the card belongs", () => {
  stubFetch();
  const job = bookedJob({
    scheduleAt: at(2026, 9, 2, 10, 0).toISOString(),
    driver: { name: "Ravi", plate: "PEN 1234", phone: "+60 12-999 9999" },
  });
  const root = openCard(world(job));
  const card = byClass(root, "job-card");
  const order = card.children.map((n) => n.className);
  assert.deepEqual(order, ["job-head", "job-row", "job-status", "job-free", "job-gap", "job-driver", "job-link"]);
});

// ── what the trip cost, against what she charged (v235) ───────────────────

test("a booked trip whose cost and charge disagree carries the difference, in the direction it fell", () => {
  stubFetch();
  const st = world(bookedJob({ amount: 31 }));
  // RM 25.50 charged against a RM 31.00 trip — the case her own question was about: the
  // price she picked is no longer the price it cost.
  st.orders[0].courierFee = 25.5;
  st.orders[0].courierPaidBy = "customer";
  const line = byClass(openCard(st), "job-gap");
  assert.ok(line, "the card must carry the difference between the trip and the charge");
  assert.equal(line.textContent,
    "The customer is charged RM 25.50 and the trip cost RM 31.00 — RM 5.50 short, so that much came out of your own pocket.");
});

test("the other direction is drawn too, because that is the half she asked to see", () => {
  stubFetch();
  const st = world(bookedJob({ amount: 20 }));
  st.orders[0].courierFee = 25.5;
  st.orders[0].courierPaidBy = "customer";
  const line = byClass(openCard(st), "job-gap");
  assert.ok(line, "a trip that cost LESS than she charged is a finding, not an absence");
  assert.equal(line.textContent,
    "The customer is charged RM 25.50 and the trip cost RM 20.00 — RM 5.50 under, and that difference stayed with you.");
});

test("a trip carrying no charge says the whole cost is hers, rather than drawing no line", () => {
  stubFetch();
  // Her own "i can even opt not to collect delivery" — the free-delivery case. Silence here
  // would hide the one number she decided to give away.
  const line = byClass(openCard(world(bookedJob({ amount: 31 }))), "job-gap");
  assert.ok(line, "not collecting the delivery is a decision the card should reflect back");
  assert.equal(line.textContent,
    "No courier charge is on the order, so the whole RM 31.00 of this trip is your own cost.");
});

test("a charge that matches the trip draws nothing, so the card is not given a line about nothing", () => {
  stubFetch();
  const st = world(bookedJob({ amount: 18.5, driver: { name: "Ravi", plate: "PEN 1234" } }));
  st.orders[0].courierFee = 18.5;
  st.orders[0].courierPaidBy = "customer";
  const root = openCard(st);
  assert.equal(byClass(root, "job-gap"), null,
    "agreement is the ordinary case and must not add a permanent grey line to every card");
  // And the card is otherwise INTACT — the line's absence is an absence, not a break in the
  // chain of nodes handed to `el`, which would print an empty row where the money belongs.
  assert.deepEqual(byClass(root, "job-card").children.map((n) => n.className),
    ["job-head", "job-row", "job-status", "job-free", "job-driver", "job-link"]);
});

test("a delivered trip still carries the difference, because the cost does not stop existing when the trip ends", () => {
  stubFetch();
  // Unlike the calling-off deadline, which is about something she can still DO and so dies
  // with the trip, this line is a reading of money already spent. It is the whole point of
  // the card outliving the trip — "real costing make aware" is a lesson learned AFTERWARDS.
  const st = world(bookedJob({ amount: 31, done: true, status: "COMPLETED" }));
  st.orders[0].courierFee = 25.5;
  st.orders[0].courierPaidBy = "customer";
  const root = openCard(st);
  const card = byClass(root, "job-card");
  assert.match(card.children[0].textContent, /A Lalamove trip on this order/,
    "the trip is read as finished, so this is the after-the-fact case");
  assert.equal(byClass(root, "job-free"), null, "and the deadline is gone, as v234 requires");
  assert.ok(byClass(root, "job-gap"), "but the money still speaks");
});

test("the window shuts on the card while she is looking at it, with no repaint to lose her place", () => {
  stubFetch();
  // No `statusAt` on this trip, so the deadline is the ONLY thing on the card with a clock
  // — which is what lets the two assertions below be about this line alone.
  const job = bookedJob({ scheduleAt: at(2026, 9, 2, 10, 0).toISOString() });
  delete job.statusAt;
  const unpin = freezeClock(at(2026, 9, 2, 8, 30).getTime());
  try {
    const root = openCard(world(job));
    const line = byClass(root, "job-free");
    assert.equal(line.textContent, "Free to call off until 9:15 am — Lalamove may charge a fee after that.");

    // Now let an hour pass the way the screen measures it: the frozen instant moves on
    // and the card's own beat fires. The words change; nothing else on the card is rebuilt.
    const seen = line.textContent;
    unpin();
    freezeClock(at(2026, 9, 2, 9, 30).getTime());
    tickBeats();
    assert.equal(line.textContent, "Lalamove's free calling-off window shut at 9:15 am, so a fee may apply from here.");
    assert.notEqual(line.textContent, seen);
    // The SAME NODE, rewritten in place. A line that came back as a fresh node would be a
    // repaint of the card, and a repaint is what this app's whole clock design avoids.
    assert.equal(byClass(root, "job-free"), line);
  } finally { unpin(); }
});

test("the deadline is watched only while its window is still ahead of her", () => {
  stubFetch();
  const pick = at(2026, 9, 2, 10, 0).toISOString();
  // No `statusAt`, so the status line is not itself a clock, and the deadline is the only
  // candidate for this screen to watch.
  const bare = (extra) => { const j = bookedJob(extra); delete j.statusAt; return j; };

  // What the card DOES on its beat, rather than how many timers it happens to hold: the
  // screen keeps one beat for the prices below the card whatever this line does (a
  // quotation has to be able to say "expired" while it sits there), so counting timers
  // would be a test of the price list. Counting how often the deadline is READ is a test
  // of the deadline. The holder's own method is spied on and put back.
  const readings = (job, ms) => {
    for (const h of beats.keys()) realClearInterval(h);
    beats.clear();
    const real = lalamove.freeCancelLine;
    let calls = 0;
    lalamove.freeCancelLine = (j, o) => { calls += 1; return real(j, o); };
    const unpin = freezeClock(ms);
    try {
      openCard(world(job));
      const drawn = calls;
      tickBeats();                       // one second passing on the card
      // The DELTA is the claim, not the totals: opening the fold paints the card more
      // than once (the price ask re-draws it before it reaches the wire), and pinning that
      // count here would be a test of the price list that broke every time it changed.
      return calls - drawn;
    } finally { unpin(); lalamove.freeCancelLine = real; }
  };

  const morning = at(2026, 9, 2, 8, 30).getTime();     // open: the window shuts at 9:15
  const later = at(2026, 9, 2, 9, 30).getTime();       // already shut

  assert.equal(readings(bare({ scheduleAt: pick }), morning), 1, "an open window is re-read every second, until it shuts");
  assert.equal(readings(bare({ scheduleAt: pick }), later), 0, "a shut window is not re-read — the sentence cannot change");
  // And a rule with no moment in it has nothing to watch either.
  assert.equal(readings(bare({}), morning), 0, "a rule with no moment in it is not watched");
});

// ── the ＋ New order card asks for prices but never books (v237) ─────────────
//
// The card is editing a DRAFT that has no order id yet, so it takes prices and nothing
// else: booking writes a real trip onto an order (`courierJob`, `trackingNo`), and there
// is no order here to write it onto. `canBook: false` is that mode, and what it has to
// suppress is precise — the [Book this trip] press above all, because a stray press there
// would put a real vehicle on the road against a draft nobody has saved.
//
// Driven by standing in for the courier's own two methods rather than for `fetch`: what
// this test is about is what the SCREEN draws for a price-only host, and the wire this
// file already stubs refuses everything by design.
const settle = () => new Promise((r) => setTimeout(r, 0));

const buttonNamed = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent === text) || null;

test("a price-only host gets [Use this fee] and no way to book, and says where the fee goes", async () => {
  stubFetch();
  const st = world(null);
  const oneQuote = {
    id: "q1", name: "Motorcycle", amount: 18.5, currency: "MYR", distanceKm: 2.4,
    expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), expiryFrom: "policy",
  };
  const realVehicles = lalamove.vehicles;
  const realQuote = lalamove.quote;
  lalamove.vehicles = async () => ({ ok: true, vehicles: [{ key: "MOTORCYCLE" }] });
  lalamove.quote = async () => ({ ok: true, quotes: [oneQuote], failed: [] });
  let used = null;
  try {
    const root = Object.assign(createEl("div"), { __root: true });
    root.append(courierQuoteSection({
      state: st, orders: st.orders, canBook: false, onUseFee: (q) => { used = q; return true; },
    }));
    press(root, "Get a delivery price");
    await settle();
    await settle();

    // The price half is untouched: a real row, with the press that fills the charge box.
    const use = buttonNamed(root, "Use this fee");
    assert.ok(use, "a price-only host still prices, and still offers the fee");
    press(root, "Use this fee");
    assert.equal(used && used.amount, 18.5, "and the press hands the amount over");

    assert.equal(buttonNamed(root, "Book this trip"), null,
      "no booking press on a draft — booking spends real money on a real vehicle");

    const text = root.textContent;
    assert.ok(!text.includes("Booking books the trip this price was quoted at"),
      "and none of the booking prose describes a press that is not here");
    assert.match(text, /then press Add order/,
      "the fee's destination is the card's own Add order, not a Save this card does not have");
  } finally {
    lalamove.vehicles = realVehicles;
    lalamove.quote = realQuote;
  }
});

test("a booking host still gets [Book this trip] — the two modes are told apart", async () => {
  stubFetch();
  const st = world(null);
  const realVehicles = lalamove.vehicles;
  const realQuote = lalamove.quote;
  lalamove.vehicles = async () => ({ ok: true, vehicles: [{ key: "MOTORCYCLE" }] });
  lalamove.quote = async () => ({ ok: true, quotes: [{
    id: "q1", name: "Motorcycle", amount: 18.5, currency: "MYR", distanceKm: 2.4,
    expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), expiryFrom: "policy",
  }], failed: [] });
  try {
    const root = Object.assign(createEl("div"), { __root: true });
    root.append(courierQuoteSection({ state: st, orders: st.orders }));
    press(root, "Get a delivery price");
    await settle();
    await settle();
    assert.ok(buttonNamed(root, "Book this trip"), "the courier screen keeps its booking press");
    assert.ok(!root.textContent.includes("then press Add order"),
      "and it is told what Save is, not what this app has no Add order button for");
  } finally {
    lalamove.vehicles = realVehicles;
    lalamove.quote = realQuote;
  }
});
