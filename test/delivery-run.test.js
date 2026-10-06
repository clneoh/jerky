// test/delivery-run.test.js — the delivery run, on the drawn screen and on the wire
// (v192, 25 Sep 2026).
//
// test/courier-run.test.js holds the pure arithmetic — the window's packing, the load,
// the split, the one-trip-against-separate saving. This file holds the SCREEN, and the
// things only the screen can get wrong. Five of them, each one a way of being quietly
// wrong with real money behind it:
//
//   1. ONE DOORSTEP PER CUSTOMER, ON THE WIRE. A customer who bought three lines is one
//      stop. This is asserted on the BYTES that would have left the phone — the drops in
//      the request body — because a trip built from order lines sends the same van to the
//      same door three times and the courier bills a stop fee for each one. Reading the
//      trip object back would not catch it; the wire is where it costs money.
//
//   2. THE WINDOW REACHES THE CUSTOMER. A window typed on the run screen has to arrive on
//      the published track card and in the WhatsApp messages, and a window that could not
//      be typed — an end before its start — must reach NEITHER. This is the half of the
//      feature a customer can be disappointed by.
//
//   3. EVERY CUSTOMER GETS THE SAME TRIP, AND NONE OF THEM GETS THE LINK (v218). One
//      booking, one job stamped onto every order the run carries — and stamped on all of
//      them, or the ones left behind have no way to be tracked at all. The courier's own
//      link is ONE link for the whole trip, so on a run of several doorsteps it goes to
//      nobody's customer: opening it would show each of them the other drop off points.
//      Her report. A trip that turned out to carry one doorstep alone still shares its
//      link, because there is nobody else in it.
//
//   4. THE SAVING STAYS WITH HER. A customer who bears the charge pays what their OWN
//      doorstep would have cost sent on its own — the original, un-consolidated price —
//      and never a share of the one-trip fee. Two ways of being wrong sit either side of
//      that: the FULL fee on every order asks three customers for the price of one trip,
//      and an EVEN SPLIT hands them the consolidation discount she is entitled to keep.
//      Only when SHE bears it is the fee apportioned, because then the customer is charged
//      nothing at all and the shares are about her books.
//
//   5. THE ORIGINAL COSTS ARE ASKED FOR, IN THE OPEN. Those per-doorstep prices are one
//      request each, and they are never taken quietly on the way past — the comparison press
//      shows them early, and a booking without that press asks for them and says it is
//      waiting. A trip is never built on a charge nobody quoted.
//
// The screen sits behind the sign-in, so it is built for real on a stand-in DOM, and the
// courier function is answered by a stubbed `fetch`. Nothing about the app's own code is
// stubbed: the same modules the phone runs are the ones under test here.
//
// Assertions avoid the middle dot (` · `) and the multiplication sign that the app's own
// strings carry. Those characters are identical in the source and here, but a test file
// is copied, pasted and retyped, and an assertion that fails over an invisible byte would
// be blamed on the screen rather than on the test. Each one is written as the readable
// words it is really about.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── the stand-in screen ───────────────────────────────────────────────────
//
// The house shim, and each part of it earns its place:
//
//   • isConnected is WALKED, not assumed. The run screen asks its own node whether it is
//     still on the page before writing a slow reply into it, so a stand-in that answered
//     `undefined` would send every write down the "it is gone" path and these tests would
//     pass for the wrong reason. Dropping a child with replaceChildren must therefore take
//     its isConnected away with it, which is why the parent link is cut.
//   • A STRING handed to a DOM write becomes a text node. The real DOM does this with
//     String(), and the run screen hands its load line a list of plain strings — so a
//     stand-in that stored them verbatim would answer `textContent` with `undefined` and
//     the load she reads would read as empty here while being right on her phone.
//   • A SELECT reads back the option that is selected, the way a browser's does. ui.js's
//     select() sets `value` on the OPTIONs and never on the select itself, so a plain
//     property would leave every picker in the app reading "" — and this screen's answer
//     to "How you paid the courier" is read from exactly there.

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
      // A real select with nothing marked selected shows its first option.
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
// a fresh 2.2-second timer behind on every call — and the suite would sit there after its
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
// anything without a session, so a file that skipped this would be testing the refusal
// message rather than the run.
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

// Everything this file installs or opens, so a test that throws part way through still
// puts the global fetch back and still stops the screen's own beat. The run screen clears
// its beat itself once its node is detached — but these roots are marked as on the page,
// so it never will, and an interval left running keeps the whole Node process alive after
// the last assertion. A suite that passes and then never finishes is its own kind of bug.
const wires = [];
const cleanups = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* nothing to stop */ } }
  for (const w of wires.splice(0).reverse()) w.restore();
  clearTimeout(toastNode._timer);
});

const { renderDeliveryRun } = await import("../admin/js/views/delivery_run.js");
const { trackingSnapshot } = await import("../admin/js/supabase.js");
const { buildShippedMessage, buildPaymentReminder } = await import("../admin/js/messages.js");
const { keyOf } = await import("../admin/js/customers.js");
// What the CUSTOMER is told they owe — the number that reaches their track card and their
// messages. Read through the app's own function rather than off the raw key, because the
// point of every money assertion below is what a customer sees, not what is stored.
const { customerCourierFee } = await import("../admin/js/courier.js");

// ── the world ─────────────────────────────────────────────────────────────

// Two customers on one delivery day, one of them with TWO lines on their order. That
// second customer is the whole point: they are one doorstep and two order rows.
//
// Both doorsteps are already pinned, so the run screen has nothing to geocode — which
// keeps the stubbed wire down to the calls this feature is actually about.
//
// Shared data is on for its URL, but NOT signed in as an app account: the publish and
// sync paths answer nothing without a login, so this file reaches no network it did not
// stub. email/password are deliberately absent, which is what holds that door shut.
function world() {
  const st = {
    version: 1,
    settings: {
      currency: "RM",
      courier: { dispatch: "10:00" },
      supabase: { enabled: true, url: "https://proj.supabase.co", anonKey: "anon-key" },
      storefront: { name: "Munchies Furkidz", whatsapp: "60123456789" },
      pickupPlace: { lat: 5.4141, lng: 100.3288, label: "The bakery, Penang" },
    },
    products: [{ id: "p1", name: "Focaccia", price: 15, active: true }],
    deliveryDates: [{ id: "d1", date: "2026-09-26" }],
    customers: [],
    orders: [
      { id: "o1", groupId: "g1", deliveryDateId: "d1", fulfillment: "courier",
        status: "paid", createdAt: "2026-09-20T02:00:00.000Z",
        address: "1 Jalan A", whatsapp: "+60 12-111 1111", customerName: "Ain",
        productId: "p1", productName: "Focaccia", qty: 2 },
      { id: "o2", groupId: "g1", deliveryDateId: "d1", fulfillment: "courier",
        status: "paid", createdAt: "2026-09-20T02:00:00.000Z",
        address: "1 Jalan A", whatsapp: "+60 12-111 1111", customerName: "Ain",
        productId: "p1", productName: "Focaccia", qty: 1 },
      { id: "o3", groupId: "g2", deliveryDateId: "d1", fulfillment: "courier",
        status: "paid", createdAt: "2026-09-20T03:00:00.000Z",
        address: "9 Jalan B", whatsapp: "+60 12-222 2222", customerName: "Bala",
        productId: "p1", productName: "Focaccia", qty: 3 },
    ],
    ingredients: [], occasions: [], expenses: [],
  };
  // Pinned doorsteps, keyed the way the app keys a person — derived from the orders
  // themselves, so this fixture cannot drift away from the key the screen looks up.
  st.customers = [
    { id: "cus_1", key: keyOf(st.orders[0]), name: "Ain", whatsapp: "+60 12-111 1111",
      place: { lat: 5.42, lng: 100.33, label: "Ain's door" } },
    { id: "cus_2", key: keyOf(st.orders[2]), name: "Bala", whatsapp: "+60 12-222 2222",
      place: { lat: 5.43, lng: 100.34, label: "Bala's door" } },
  ];
  return st;
}

// The same day with ONE customer left on it. That is the case where the trip the courier
// books carries nothing but that one doorstep, so its single link has no third party in it
// and may be handed over (v218) — the carve-out that keeps ordinary single-order courier
// work tracked live.
function worldSolo() {
  const st = world();
  st.orders = st.orders.filter((o) => o.groupId === "g1");
  st.customers = st.customers.filter((c) => c.id === "cus_1");
  return st;
}

// A third customer, for the one case the split cannot get right by accident: a fee that
// does not divide evenly. RM22 over two orders is RM11 each, which any wrong arithmetic
// would also produce.
function withThirdCustomer(st) {
  st.orders.push({ id: "o4", groupId: "g3", deliveryDateId: "d1", fulfillment: "courier",
    status: "paid", createdAt: "2026-09-20T04:00:00.000Z",
    address: "5 Jalan C", whatsapp: "+60 12-333 3333", customerName: "Chandra",
    productId: "p1", productName: "Focaccia", qty: 1 });
  st.customers.push({ id: "cus_3", key: keyOf(st.orders[3]), name: "Chandra",
    whatsapp: "+60 12-333 3333", place: { lat: 5.44, lng: 100.35, label: "Chandra's door" } });
  return st;
}

// A customer whose trip is ALREADY BOOKED (v242). A live job on the order's own row is the
// whole of what "booked" means — `liveJobOf` reads that and nothing else — so the fixture
// only has to put one there. It goes on Bala, deliberately NOT on Ain, so one test can tell
// the booked customer from an ordinary one on the same day.
//
// `done` is absent on purpose: a record with no `done` key reads as LIVE, which is the shape
// a card written by an older version of the app would have.
function bookedBala(st, over = {}) {
  st.orders[2].courierJob = {
    jobId: "LLM-SOLO-1", provider: "lalamove", courierName: "Lalamove",
    status: "ON_GOING", amount: 16.25, currency: "MYR",
    bookedAt: "2026-09-26T02:00:00.000Z", ...over,
  };
  return st;
}

// Every row on the list, in the order the screen drew them, each paired with the customer it
// is about. Read off the tick's own label rather than the document order, because the whole
// point of these tests is which customer a press belongs to.
const rowFor = (root, name) => {
  const tick = inputByLabel(root, `Send ${name} on this run`);
  let node = tick;
  while (node && !String(node.className).includes("run-row")) node = node.parentNode;
  return { tick, row: node };
};

// The block the warning and its press live in, reached from the row so a test can ask whether
// it is INSIDE the row's own <label> — which is the difference between ticking the customer and
// calling the trip off.
const bookedBlock = (root, name) => {
  const { row } = rowFor(root, name);
  if (!row) return undefined;
  return all(root).find((n) => String(n.className).includes("run-booked")
    && n.parentNode === row.parentNode);
};

// ── the stubbed wire ──────────────────────────────────────────────────────
//
// It answers the courier function's own contract — a JSON body carrying `{ok, ...}` — and
// records every request, so a test can read the bytes that would have left the phone.
//
// The fleet is Motorcycle then Car, in the app's own order (sortServices), and the two
// prices differ so a test can tell which row it pressed.
const MOTORCYCLE_FEE = 18.5;
const CAR_FEE = 22;

// What each doorstep costs sent on its own — more than a stop on a shared run, which is the
// whole reason consolidation saves, and deliberately neither the run's fee nor its half.
//
// The two houses are priced DIFFERENTLY, and that is load-bearing: a fixture that charged
// both the same would let a fault that wrote the first customer's cost onto every order pass
// every test in this file. A wrong edit that put the trip's own fee on each customer reads
// 22.00 and one that split it reads 11.00; both are visibly not the 13.50 and 16.25 the
// honest answer is.
const ALONE_BY_ADDRESS = { "1 Jalan A": 13.5, "9 Jalan B": 16.25 };
const CAR_ALONE = 13.5;
const BALA_ALONE = 16.25;
const MOTORCYCLE_ALONE = 11.25;
function priceOf(key, { alone = false, address = "", override = null } = {}) {
  if (!alone) return key === "CAR" ? CAR_FEE : MOTORCYCLE_FEE;
  if (override != null) return override;
  if (key !== "CAR") return MOTORCYCLE_ALONE;
  return ALONE_BY_ADDRESS[address] ?? CAR_ALONE;
}

function stubCourier({ failAloneAfter = Infinity, standalone, badStops = false, cancel } = {}) {
  const real = globalThis.fetch;
  const sent = [];
  // How many single-doorstep requests have been answered, so a test can make the courier
  // refuse the Nth of them. It is the one case that has to stop a booking dead: a charge
  // the courier never quoted is a figure the screen invented.
  let alone = 0;
  const stubFetch = async (url, opts = {}) => {
    const body = JSON.parse(String(opts.body || "{}"));
    // When each request arrived, to the millisecond, so the spacing the courier's rate limit
    // requires can be read off a clock rather than assumed.
    //
    // A MONOTONIC reading, deliberately not Date.now(). The gap under test is produced by
    // setTimeout, which the wall clock does not drive — so reading it off Date meant a frozen
    // Date reported every gap as 0ms and failed a throttle that was working perfectly. (That
    // is exactly what the overnight sweep saw.) performance.now() cannot be frozen, cannot
    // jump backwards, and is the right instrument for a duration.
    sent.push({ ...body, at: performance.now() });
    const p = body.payload || {};
    const drops = body.action === "quote" && Array.isArray(p.drops) ? p.drops.length : 2;
    const reply = body.action === "quote" && drops < 2 && ++alone > failAloneAfter
      ? { ok: false, reason: "Lalamove could not price that doorstep on its own." }
      : answerFor(body, { standalone, badStops, cancel });
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  globalThis.fetch = stubFetch;
  // Putting the real one back only if this stub is the one still in place. Two stubs in
  // one test, and a restore that fired blindly, would hand the second one the first one's
  // predecessor and quietly un-stub the wire the test is still reading.
  const stub = { sent, restore() { if (globalThis.fetch === stubFetch) globalThis.fetch = real; } };
  wires.push(stub);
  return stub;
}

function answerFor(body, opts = {}) {
  const p = body.payload || {};
  if (body.action === "vehicles") {
    return { ok: true, services: [{ key: "MOTORCYCLE" }, { key: "CAR" }] };
  }
  // The address lookup, for the one case a run still needs it: a doorstep nobody has
  // answered. The label is a FRAGMENT on purpose — "Jalan A, George Town" is what a
  // geocoder really calls a Malaysian street, and it is deliberately NOT the address on
  // the order, so a test can tell a door named with the order's address from one named
  // with the geocoder's row (v207).
  if (body.action === "geocode") {
    const found = {
      "1 Jalan A": { lat: 5.45, lng: 100.35, label: "Jalan A, George Town" },
      "9 Jalan B": { lat: 5.46, lng: 100.36, label: "Jalan B, Butterworth" },
    }[String(p.address || "")];
    if (!found) return { ok: false, reason: "That address could not be found — put the pin on the map instead." };
    return { ok: true, place: found, places: [found] };
  }
  if (body.action === "quote") {
    // One price per vehicle asked for, and one price for the journey it was asked about:
    // the bakery plus one point per drop. A request for ONE doorstep carries two points, so
    // it is the doorstep on its own; a run of two or more carries three or more.
    const drops = Array.isArray(p.drops) ? p.drops.length : 1;
    const points = 1 + drops;
    const alone = drops < 2;
    const address = drops === 1 && p.drops[0] ? String(p.drops[0].address || "") : "";
    return {
      ok: true,
      quotes: (p.services || []).map((key) => ({
        quotationId: `Q-${key}-${points}`,
        serviceType: key,
        priceBreakdown: { total: priceOf(key, { alone, address, override: opts.standalone }), currency: "MYR" },
        distance: { value: 12.5, unit: "km" },
        // No geometry at all, which is the documented reply: the reader then takes the
        // stop handles in order, and a test can assert on the count without inventing
        // coordinates it does not care about.
        //
        // `badStops` is the one other shape, and it is a REAL reply: coordinates are sent,
        // so the positional fallback is refused too, but they are not the ones this app
        // sent — so no stop handle can be tied to a door and the price cannot be booked.
        stops: Array.from({ length: points }, (_, i) => (opts.badStops
          ? { stopId: "", coordinates: { lat: 1 + i, lng: 110 + i } }
          : { stopId: `${key}-${points}-s${i}` })),
      })),
      failed: [],
    };
  }
  // Calling a trip off (v242). A DELETE-shaped action answers with nothing at all in the real
  // world, which is exactly why the app's own record of it is written locally. The refusal is
  // the other half of the contract and is an ordinary answer, not a fault (see `cancel:false`).
  if (body.action === "cancel") {
    if (opts.cancel === false) {
      return { ok: false, reason: "The driver has already been matched, so this trip can no longer be called off." };
    }
    return { ok: true, cancelled: true };
  }
  if (body.action === "book") {
    return { ok: true, order: {
      orderId: "LLM-RUN-1",
      quotationId: p.quotationId,
      status: "ASSIGNING_DRIVER",
      shareLink: "https://lalamove.com/t/run-abc",
      priceBreakdown: { total: CAR_FEE, currency: "MYR" },
    } };
  }
  return { ok: false, reason: `no stub for ${body.action}` };
}

// ── driving the screen ────────────────────────────────────────────────────

const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const inputByLabel = (root, label) =>
  all(root).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === label);

function press(node) { for (const f of node._listeners.click || []) f({ preventDefault() {} }); }
function type(node, value) { node.value = value; for (const f of node._listeners.input || []) f({}); }
function change(node, value) { node.value = value; for (const f of node._listeners.change || []) f({}); }

// The async chains down the wire are real promises, so a press is followed by a flush of
// the microtask and timer queues rather than an assumption about how many hops deep the
// work goes.
async function settle(rounds = 14) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

// The screen, rendered for the one day there is. The root is marked as on the page: the
// real one is inside #view, and every press on this screen refuses to act against a node
// that has been taken off it, so a root with no marker would answer "not connected" and
// nothing would ever be priced.
// ⚠️ `day` DEFAULTS TO `d1`, the fixture's single bake-day record, and may be given as an ID **or a DATE**
// (v343): a run's day is the day the VAN comes now, so a test whose van day is not the bake day opens the
// run on that date. The screen accepts both spellings through the `?date=` parameter.
function openRun(st, day = "d1") {
  const root = Object.assign(createEl("div"), { __root: true });
  const cleanup = renderDeliveryRun(root, st, new URLSearchParams({ date: day }));
  if (typeof cleanup === "function") cleanups.push(cleanup);
  return { root, cleanup };
}

// One price row, found by the vehicle's own name — the name the courier's own file gave
// it, which is what the screen prints and what she reads when she chooses.
function priceRow(root, name) {
  const cell = all(root).find((n) => String(n.className).includes("quote-name") && n.textContent === name);
  let node = cell;
  while (node && !String(node.className).includes("quote-row")) node = node.parentNode;
  return node && String(node.className).includes("quote-row") ? node : undefined;
}

// The charge questions, answered the way she answers them: by picking the words she sees.
// Order matters — the method picker only exists once the payer has said she bore it.
function answerCharge(root, { payer = "", method = "" } = {}) {
  for (const want of [payer, method].filter(Boolean)) {
    const sel = all(root).find((n) => n.tagName === "SELECT"
      && all(n).some((o) => o.tagName === "OPTION" && o.textContent === want));
    assert.ok(sel, `there is a picker offering "${want}"`);
    const opt = all(sel).find((o) => o.tagName === "OPTION" && o.textContent === want);
    change(sel, opt.value);
  }
}

// How many doorsteps the day holds, which is how many separate requests a customer-borne
// charge costs — one per stop. The two halves of Ain's order are ONE doorstep.
const doorstepCount = (st) => new Set(st.orders.map((o) => o.groupId || o.id)).size;

// The run's own per-doorstep requests are spaced by a REAL gap, because the courier takes
// only two requests a second — and settle() flushes timers with a zero-delay setTimeout,
// which does not advance a 600ms wait. So a test that books a customer-borne run has to let
// that time genuinely pass, or the confirmation it is waiting for has not been drawn yet.
const letTheCourierAnswer = (st) =>
  new Promise((r) => setTimeout(r, doorstepCount(st) * 650 + 150));

// The whole trip, as she makes it: price the run, answer the charge questions, press Book
// on ONE vehicle's row, and say yes to the app's own red confirmation.
async function book(st, { window: win = "", payer = "", method = "", vehicle = "Car" } = {}) {
  const wire = stubCourier();
  const { root } = openRun(st);
  if (win) {
    type(inputByLabel(root, "The delivery window opens"), win.split("-")[0]);
    type(inputByLabel(root, "The delivery window closes"), win.split("-")[1]);
  }
  press(buttonByText(root, "Price this run"));
  await settle();
  assert.ok(priceRow(root, vehicle), `the ${vehicle} came back priced`);
  answerCharge(root, { payer, method });
  press(buttonByText(priceRow(root, vehicle), "Book this run"));
  // A customer-borne charge has to be asked for one doorstep at a time before the question
  // is put at all, so the confirmation is not on screen yet.
  if (payer === "The customer paid it") await letTheCourierAnswer(st);
  await settle();
  const confirm = layers["confirm-layer"];
  const yes = buttonByText(confirm, "Book this run");
  assert.ok(yes, "the app asked before spending money");
  // The question is EMPTIED by the app as soon as it is answered, and so is the toast after
  // its 2.2 seconds, so what was on screen has to be read off while it is still there. A
  // test that went looking afterwards would find an empty layer and assert nothing.
  st.confirmText = confirm.textContent;
  press(yes);
  await settle();
  st.toastText = toastNode.textContent;
  return { root, wire, confirm };
}

// ── v216: the run's charge question is HERS, and a run it will not book says why ──

test("the run's charge question opens on Not recorded, whatever an order's own card now does (v216)", async () => {
  // Her ask, 27 Sep 2026, was for the ORDER's charge box to open on "The customer paid
  // it" — and that is where it is applied. The run deliberately does not follow (v192):
  // here the payer is read BEFORE the amounts and decides which amounts they are, so
  // "customer" sends it asking what each doorstep costs on its own and writing a charge
  // onto EVERY customer's bill. The run's question has to stay a choice she makes rather
  // than one she inherits, and this is what that looks like on screen — the line under
  // the price asks her to choose, instead of having chosen for her.
  const st = world();
  stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();

  const row = priceRow(root, "Car");
  assert.ok(row, "the vehicle came back priced");
  assert.match(row.textContent,
    /Choose who paid the courier below, and this line will say what each customer's charge box will hold\./,
    "the run asks her who bore it rather than answering it for her");
  assert.doesNotMatch(row.textContent, /Each customer is charged what their own doorstep costs/,
    "and it has not quietly decided the customer is bearing it");
});

test("a run the courier will not book says why, instead of going quietly inert (v216)", async () => {
  // Her report, 27 Sep 2026: "now the greyed out book button". The row kept its own,
  // shorter list of reasons, so a run the courier's own reader refused for any other
  // reason — a reply that did not come back with the courier's handle for a doorstep
  // above all — drew an inert press and said nothing about it.
  const st = world();
  stubCourier({ badStops: true });
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();

  const row = priceRow(root, "Car");
  assert.ok(row, "the vehicle came back priced — this is a real answer, not a failure");
  const book = buttonByText(row, "Book this run");
  assert.ok(book, "with its booking press still on it");
  assert.equal(book.disabled, true, "the press is inert — this run cannot be booked");
  assert.match(root.textContent, /did not come back with the courier's own handle/,
    "and the reason is ON THE SCREEN, rather than left to be guessed at from a greyed button");
});

// ── v217: the run's price press cannot end in silence ─────────────────────
// The same fault as the order card's, on the same guard — `busy`, held across the run's own
// lookup of every doorstep and then the courier's ask. A throw anywhere in there used to
// leave the flag set and the button grey, and every later press was returned at once with
// nothing said. The throw is injected into the courier's `vehicles`, which is the only honest
// way to reach it: `callCourier` is built never to throw, so no shape of reply produces one.
test("a throw inside the run's price press arms the button again, says so, and does not swallow the next press (v217)", async () => {
  const st = world();
  stubCourier();
  const { lalamove } = await import("../admin/js/couriers/lalamove.js");
  const realVehicles = lalamove.vehicles;
  lalamove.vehicles = async () => { throw new Error("the fleet box fell over"); };
  try {
    const { root } = openRun(st);
    press(buttonByText(root, "Price this run"));
    await settle();

    const ask = buttonByText(root, "Price this run");
    assert.ok(ask, "the press is on the screen, so the picture below is of a real one");
    assert.equal(ask.disabled, false, "the button takes a press again — a throw must not leave it dead");
    assert.match(root.textContent,
      /The price could not be asked for, and nothing has been priced — the fleet box fell over\./,
      "and the throw is SAID, rather than swallowed behind a grey button");

    // THE HALF A LATCHED GUARD TOOK AWAY: her next press. With the fleet back it has somewhere
    // to go — and had `busy` been left set, this press would have returned at once and there
    // would be no row to find.
    lalamove.vehicles = realVehicles;
    press(buttonByText(root, "Price this run"));
    await settle();
    assert.ok(priceRow(root, "Car"), "the next press really runs, and comes back priced");
  } finally {
    lalamove.vehicles = realVehicles;
  }
});

// ── 1. one doorstep per customer, on the wire ─────────────────────────────

test("a run prices ONE drop per customer, however many lines their order holds", async () => {
  // The fault this pins: the trip is built from the ORDER rows. Ain has two lines, so a
  // trip built from lines carries three drops and the courier bills three stop fees for
  // two houses. Read on the wire rather than off the trip object, because the wire is
  // where the money is.
  const st = world();
  // ★ THE DAY SHE TYPED ON THE ORDERS (v338). The driver's collection day comes off the ORDER now,
  // never off the bake day — so an order with no day on it prices "as soon as possible" and sends no
  // schedule at all. Seeding it here is what makes the assertion below mean what its own words say:
  // *"the collection day and time she set, turned into the UTC instant the API wants."*
  for (const o of st.orders) o.courierDay = "2026-09-26";
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();

  const asks = wire.sent.filter((b) => b.action === "quote");
  assert.equal(asks.length, 1, "one price request for the whole run");
  assert.equal(asks[0].payload.drops.length, 2, "two customers, two drops — not three order lines");
  assert.deepEqual(asks[0].payload.drops.map((d) => d.address), ["1 Jalan A", "9 Jalan B"]);
  assert.deepEqual(asks[0].payload.services, ["MOTORCYCLE", "CAR"],
    "the fleet is asked of the courier, not written down in the screen");
  assert.equal(asks[0].payload.scheduleAt, "2026-09-26T02:00:00.000Z",
    "the collection day and time she set, turned into the UTC instant the API wants");
});

test("★ a Point prices ONE drop for the whole Point, not one per customer", async () => {
  // ⚠️ THE TEST THAT PROVES THE MONEY. Two customers collecting at Farlim are ONE place a van
  // goes — and the courier bills a fee per drop, so a trip built one-drop-per-customer charges
  // her TWICE for one stop. Read on the WIRE, because the wire is where the money is; reading
  // the trip object back would not catch it.
  const st = worldWithPoint(["g1", "g2"]);
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();

  const asks = wire.sent.filter((b) => b.action === "quote");
  assert.equal(asks.length, 1, "one price request for the whole run");
  assert.equal(asks[0].payload.drops.length, 1,
    "ONE drop for the Point, however many customers collect there");
  assert.deepEqual(asks[0].payload.drops.map((d) => d.address),
    ["Lebuhraya Thean Teik, 11500 Air Itam"],
    "and it is the POINT's own door, never a customer's house");
});

test("a Point and a doorstep price two drops, in the order they are ticked", async () => {
  // The mixed run she wants: one Point carrying a customer, and another customer whose own
  // door the van goes to. Two drops — and neither customer counted twice.
  const st = worldWithPoint(["g1"]);
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  const asks = wire.sent.filter((b) => b.action === "quote");
  assert.equal(asks[0].payload.drops.length, 2, "the Point and the doorstep");
  assert.deepEqual(asks[0].payload.drops.map((d) => d.address).sort(),
    ["9 Jalan B", "Lebuhraya Thean Teik, 11500 Air Itam"].sort(),
    "the Point's own door and the other customer's");
});

test("the load beside the price counts doorsteps and items, not rows", async () => {
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  const read = all(root).find((n) => String(n.className).includes("run-load"));
  assert.ok(read.textContent.startsWith("2 stops"), `two doors — read "${read.textContent}"`);
  assert.ok(read.textContent.includes("6 items"), "six focaccia, however the lines are split");
  assert.ok(read.textContent.includes("Focaccia"), "named the way the rest of the app names an item");
});

test("one customer of three does not need three ticks", async () => {
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  assert.equal(ticks.length, 2, "one tick per customer, never per order line");
  assert.ok(ticks.every((t) => t.checked), "and the whole day is on to begin with");
});

// ── v301: a Self collection Point is ONE STOP ──────────────────────────────

// A day where customers collect from a Point instead of having their own door. Built on
// `world()` so everything else about it — the pinned doors, the prices, the wire — is the
// fixture every other test already trusts.
function worldWithPoint(groupsAtPoint) {
  const st = world();
  st.points = [{
    id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik, 11500 Air Itam",
    receiver: "Aunty Lim", phone: "60123456789", feeRM: 0.5, paused: false,
    createdAt: "2026-10-12T00:00:00.000Z",
    place: { lat: 5.4, lng: 100.28, label: "Farlim, Air Itam" },
  }];
  for (const o of st.orders) {
    if (!groupsAtPoint.includes(o.groupId)) continue;
    // ⚠️ A REAL POINT ORDER IS `fulfillment: "collect"`, NOT `"courier"`. Choosing a Self
    // collection Point in the shop never moves the Self collect / Courier choice — only
    // `pointId` and the frozen name ride along on the order.
    //
    // THIS FIXTURE USED TO LEAVE THEM AS COURIER, which is a pairing the shop has never
    // produced, and that is why it hid a real fault for a whole version: the run screen's own
    // day filter asked `fulfillment === "courier"`, so every real Point order was dropped
    // before the row logic ever saw one and the screen said "Nothing to run yet" over a
    // customer waiting to collect at Farlim. A fixture that cannot happen is not a test.
    o.fulfillment = "collect";
    o.pointId = "pt_farlim";
  }
  return st;
}

test("two customers collecting at one Point are ONE stop, not two", async () => {
  // The whole reason Points exist: four bags at Farlim are one journey a van makes, and a
  // trip built one-per-customer would send the same van back to the same shop and be billed
  // a stop fee for each one. Read off the LOAD LINE, because that is what the price is asked
  // for and what a booking carries.
  const st = worldWithPoint(["g1", "g2"]);
  stubCourier();
  const { root } = openRun(st);

  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  assert.equal(ticks.length, 1, "ONE tick for the Point, however many customers collect there");
  assert.ok(ticks[0].checked, "and it is on with the rest of the day");

  const read = all(root).find((n) => String(n.className).includes("run-load"));
  assert.ok(read.textContent.startsWith("1 stop"), `one stop at one Point — read "${read.textContent}"`);
  assert.ok(read.textContent.includes("6 items"), "while every line of bread is still counted");
});

test("the Point's row says what it is, and how much it is carrying", async () => {
  const st = worldWithPoint(["g1", "g2"]);
  stubCourier();
  const { root } = openRun(st);

  const row = all(root).find((n) => String(n.className).includes("run-row-point"));
  assert.ok(row, "the Point gets a row of its own, marked as one");
  assert.ok(row.textContent.includes("Farlim, Air Itam"), "named as the Point");
  assert.ok(row.textContent.includes("2 orders collecting here"),
    `and says how many orders it is carrying — read "${row.textContent}"`);
  // A Point is a PLACE, so the customer's own name must not be on it — the bread is going to
  // Farlim and the customer is meeting it there.
  assert.equal(row.textContent.includes("Ain"), false, "no customer's name on a Point's row");
});

test("a Point and a doorstep are two stops, and neither is counted twice", async () => {
  // The mixed run she actually wants: a Point carrying one customer, and another customer
  // whose own door the van goes to. Two stops — and if the Point's customer were counted
  // twice the load would read three.
  const st = worldWithPoint(["g1"]);   // only Ain collects at the Point
  stubCourier();
  const { root } = openRun(st);

  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  assert.equal(ticks.length, 2, "the Point row and the doorstep row");
  const read = all(root).find((n) => String(n.className).includes("run-load"));
  assert.ok(read.textContent.startsWith("2 stops"), `two stops — read "${read.textContent}"`);
  assert.ok(read.textContent.includes("6 items"), "and still six focaccia");
  assert.equal(all(root).filter((n) => String(n.className).includes("run-row-point")).length, 1);
});

test("a Point with nobody collecting there is not on the run at all", async () => {
  const st = worldWithPoint([]);   // the Point exists, but no order went to it
  stubCourier();
  const { root } = openRun(st);
  assert.equal(all(root).filter((n) => String(n.className).includes("run-row-point")).length, 0);
  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  assert.equal(ticks.length, 2, "the day is exactly the two customers it always was");
});

test("one row's own tick moves the count and the bulk press with it", async () => {
  // The fault this pins: the head line and the bulk press describe the SAME set the ticks do,
  // so a single row's tick has to move them too. It did not — the row's handler repainted the
  // load, the prices and the pay box, and only the bulk press rebuilt the list the head lives
  // in, so unticking one customer left the head reading "2 of 2" over a list of one. Two
  // controls that look alike answering differently is the shape of bug this app treats as a
  // broken promise rather than a cosmetic one.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);

  const head = () => all(root).find((n) => String(n.className).includes("run-head-title")).textContent;
  const bulk = () => (buttonByText(root, "Tick them all") || buttonByText(root, "Untick them all")).textContent;

  assert.equal(head(), "Who is on the run — 2 of 2", `the whole day is on — read "${head()}"`);
  assert.equal(bulk(), "Untick them all", "and the bulk press offers to take them off");

  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  ticks[1].checked = false;
  change(ticks[1], "");

  assert.equal(head(), "Who is on the run — 1 of 2", `one off, and the count says so — read "${head()}"`);
  assert.equal(bulk(), "Tick them all", "and the bulk press now offers to put them back");
});

// ── 2. booking the run ────────────────────────────────────────────────────

test("one booking puts the same trip on every order the run carries — and its link on none of them (v218)", async () => {
  const st = world();
  const { wire } = await book(st, { payer: "The customer paid it" });
  for (const o of st.orders) {
    assert.ok(o.courierJob, `${o.id} is on the trip`);
    assert.equal(o.courierJob.jobId, "LLM-RUN-1");
    assert.equal(o.courierJob.courierName, "Lalamove", "from the provider's own label");
    // The one link covers the WHOLE trip, so handing it to any of them shows them the
    // others' doorsteps. Her report. The customer keeps the app's own card.
    assert.equal(o.trackingNo, undefined,
      "the courier's whole-trip link is not put on a customer's order by a run");
  }
  const books = wire.sent.filter((b) => b.action === "book");
  assert.equal(books.length, 1, "ONE trip, not one per customer");
  assert.equal(books[0].payload.recipients.length, 2, "and it names both doorsteps");
  assert.equal(books[0].payload.sender.stopId, "CAR-3-s0", "the bakery, by the handle it was priced at");
  assert.deepEqual(books[0].payload.recipients.map((r) => r.stopId), ["CAR-3-s1", "CAR-3-s2"]);
  assert.equal(books[0].payload.quotationId, "Q-CAR-3", "booked at the quotation she chose");
});

test("a run booked through the screen says the customers were not given the link, before it spends her money (v218)", async () => {
  // The promise about privacy has to be on screen BEFORE the money moves, not in a toast
  // afterwards — and the toast must not then claim the customers got one link.
  const st = world();
  await book(st, { payer: "The customer paid it" });
  assert.match(st.confirmText,
    /The courier's own tracking link is deliberately NOT put on the customers' orders/,
    "the card says so before she presses yes");
  assert.match(st.confirmText, /it would show each of them the other doorsteps/,
    "and says why, in the words of the problem she reported");
  assert.doesNotMatch(st.confirmText, /gets the same share link/,
    "the old promise is gone");
  assert.match(st.toastText, /one trip\. The courier's link was kept off their orders/,
    "and the toast after it agrees");
  assert.doesNotMatch(st.toastText, /share one trip and one link/);
});

test("a run that turned out to carry ONE doorstep does give that customer the link (v218)", async () => {
  // The carve-out she chose: the trip is the bakery to their door and nothing else, so
  // there is no third party in the link and live tracking is worth having.
  const st = worldSolo();
  await book(st, { payer: "The customer paid it" });
  assert.equal(st.orders[0].trackingNo, "https://lalamove.com/t/run-abc",
    "the only customer on the trip gets the link");
  assert.match(st.confirmText, /The customer's tracking box takes this trip's share link/);
});

test("the PRICED screen itself stops promising every customer the link (v218)", async () => {
  // The confirmation and the toast were not the only places this promise was written. The
  // priced screen's own footer under the rows said the trip had "one share link that goes on
  // every customer's own track card and message" — true until v218, and the exact opposite of
  // what v218 does. Nothing asserted it, so it survived the first pass of this version and was
  // found only by pricing a real run in the browser. A screen that says one thing while the
  // booking does another is worse than either; this is the test that keeps the two in step.
  const two = world();
  const wireTwo = stubCourier();
  const { root: rootTwo } = openRun(two);
  press(buttonByText(rootTwo, "Price this run"));
  await settle();
  const footerTwo = all(rootTwo).map((n) => n.textContent).join("\n");
  assert.doesNotMatch(footerTwo, /goes on every customer's own track card/,
    "the stale promise is gone from the screen she prices on");
  assert.match(footerTwo, /ONE share link is deliberately kept OFF the customers' own track cards/,
    "and is replaced by what actually happens on a run of several doorsteps");
  wireTwo.restore();

  // And the carve-out holds on the screen too, not only in the booking: a run that turns out
  // to carry one doorstep still tells her the link goes on that customer's card.
  const one = worldSolo();
  const wireOne = stubCourier();
  const { root: rootOne } = openRun(one);
  press(buttonByText(rootOne, "Price this run"));
  await settle();
  const footerOne = all(rootOne).map((n) => n.textContent).join("\n");
  assert.match(footerOne, /the trip's own share link, which goes on that customer's track card/);
  assert.doesNotMatch(footerOne, /deliberately kept OFF/,
    "a single-doorstep run is not warned about a leak it cannot have");
  wireOne.restore();
});

test("a trip is stamped on every LINE of a group, not only its first", async () => {
  // Ain's order is two rows. A booking written on the first row alone would come apart the
  // moment that order is edited and its rows are re-split, and the customer would be left
  // with an order that had never heard of the trip carrying it.
  const st = world();
  await book(st, { payer: "The customer paid it" });
  assert.equal(st.orders[1].courierJob.jobId, "LLM-RUN-1", "the second line of Ain's order too");
});

test("a customer bears their OWN doorstep's cost, and the saving stays with her", async () => {
  // Her rule, in her words: "the benefit of consolidated charges, should go to merchant,
  // not the customer. And if the courier charges were reveal to them, it will shown as the
  // original cost."
  //
  // So the RM22 one-trip fee is NEVER divided between the customers. Each of them is charged
  // the 13.50 their own doorstep costs sent on its own — the original, un-consolidated
  // price. Two faults are pinned here and they are the two ways to get this wrong, both of
  // which read differently from the honest answer: the WHOLE fee on every order (22.00, the
  // courier paid once and billed twice) and an EVEN SHARE of it (11.00, the consolidation
  // discount quietly handed to the customers).
  const st = world();
  await book(st, { payer: "The customer paid it" });
  assert.equal(st.orders[0].courierFee, CAR_ALONE, "Ain's own doorstep's cost, not half of RM22");
  assert.equal(st.orders[1].courierFee, CAR_ALONE, "the second line of the SAME order is the same order");
  assert.equal(st.orders[2].courierFee, BALA_ALONE,
    "and Bala's own, which is a DIFFERENT number — each order carries its own doorstep's cost");
  assert.equal(st.orders[0].courierPaidBy, "customer");
  assert.equal(st.orders[2].courierPaidBy, "customer");
  assert.deepEqual(st.expenses, [],
    "a charge the customer bears never becomes a cost on her own books");
  // And it is what the customer is TOLD, through the app's own reader of the charge — the
  // figure their track card and their messages quote.
  const asked = [st.orders[0], st.orders[2]].map((o) => customerCourierFee(o));
  assert.deepEqual(asked, [CAR_ALONE, BALA_ALONE]);
  // The two of them between them are asked for more than the trip costs her. That gap IS
  // the saving, and the test says whose it is by asserting it exists at all.
  const sum = Math.round(asked.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.equal(sum, 29.75, "13.50 and 16.25, added up");
  assert.ok(sum > CAR_FEE, `going together saved her — the two are asked for ${sum} against a ${CAR_FEE} trip`);
});

test("a charge SHE bears is the run's fee apportioned, and the customer is asked for none of it", async () => {
  const st = world();
  await book(st, { payer: "I paid it", method: "Cash" });
  // Two groups on the run, so two shares of the fee, and each one is its own row — the
  // row is what reconciles against that customer's order.
  assert.equal(st.expenses.length, 2);
  assert.deepEqual(st.expenses.map((e) => e.amount), [11, 11]);
  for (const e of st.expenses) {
    assert.equal(e.category, "Delivery & fuel");
    assert.equal(e.method, "Cash");
  }
  assert.equal(st.orders[0].courierPaidBy, "me");
  // The other half of her rule: a cost SHE bore is her own cost, and not one sen of it
  // reaches a customer's total. The apportionment is about her books and nowhere else.
  assert.deepEqual([st.orders[0], st.orders[2]].map((o) => customerCourierFee(o)), [0, 0],
    "a charge she paid is never a charge they are told about");
});

test("the odd cents are on the last order, so her own shares add up to the fee exactly", async () => {
  // The fee is apportioned only when SHE bears it — a customer-borne charge is each
  // customer's own original cost and is never divided at all. RM22 over two orders divides
  // evenly, so the case worth pinning is one that does not: THREE customers, worked in cents
  // (see splitEven), with the sum landing on the fee she was charged.
  const st = withThirdCustomer(world());
  await book(st, { payer: "I paid it", method: "Cash" });

  const shares = st.orders.map((o) => o.courierFee);
  assert.equal(shares.length, 4, "three customers, one of them with two lines");
  assert.deepEqual(shares, [7.33, 7.33, 7.33, 7.34], "RM22 over three orders, and the odd cent is last");
  assert.deepEqual(st.expenses.map((e) => e.amount), [7.33, 7.33, 7.34], "and her books get the same parts");
  // What she was charged is the sum of the RUN's charges, which is one per CUSTOMER. The
  // charge is written onto every line of a group (a customer's own card reads their first
  // line), so adding all four rows would count Ain's order twice — and the whole point of
  // this test is that the parts add up to the whole, so it is added up the way the app
  // spends it.
  const perCustomer = [st.orders[0], st.orders[2], st.orders[3]].map((o) => o.courierFee);
  assert.deepEqual(perCustomer, [7.33, 7.33, 7.34]);
  assert.equal(Math.round(perCustomer.reduce((a, b) => a + b, 0) * 100) / 100, 22,
    "and the parts are the whole by construction, not by rounding luck");
});

// ── 2b. the customers' own costs, asked for in the open ───────────────────

test("their own costs are asked for one doorstep at a time, and the booking waits for every one", async () => {
  // A customer-borne charge is one request per doorstep, and the courier allows two requests
  // a second — so the booking press pays for them, and the question she has to answer is not
  // put on screen until every one of them is here. Asking for a vehicle she is not booking
  // would be spending requests on a row she is not pressing.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  answerCharge(root, { payer: "The customer paid it" });
  const before = wire.sent.filter((b) => b.action === "quote").length;

  press(buttonByText(priceRow(root, "Car"), "Book this run"));
  await settle();
  assert.equal(buttonByText(layers["confirm-layer"], "Book this run"), undefined,
    "nothing is put to her while a doorstep is still unpriced");

  await letTheCourierAnswer(st);
  await settle();

  const asks = wire.sent.filter((b) => b.action === "quote").slice(before);
  assert.equal(asks.length, doorstepCount(st), "one request per doorstep, and not one fewer");
  for (const body of asks) {
    assert.equal(body.payload.drops.length, 1, "each one is a single doorstep sent on its own");
    assert.deepEqual(body.payload.services, ["CAR"],
      "and only the vehicle she is booking, not the whole fleet again");
  }
  // And they are SPACED. The courier takes two requests a second, so a loop that fired them
  // all at once would look exactly like this one on a two-stop day and be rate-limited into
  // failures on the day she has a run of ten. Read off the clock, not off the code.
  for (let i = 1; i < asks.length; i++) {
    const gap = asks[i].at - asks[i - 1].at;
    assert.ok(gap >= 550, `request ${i + 1} waited its turn — ${gap}ms apart`);
  }
});

test("a comparison she has already asked for is reused for the charges, not paid for twice", async () => {
  // The comparison and the customers' charges are the SAME requests — the separate prices ARE
  // the original costs. So a run she has already compared must not be priced a second time
  // when she books it: that is her money spent on waiting for an answer she already has.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  answerCharge(root, { payer: "The customer paid it" });
  press(buttonByText(priceRow(root, "Car"), "Compare with sending them separately"));
  await letTheCourierAnswer(st);
  await settle();
  const before = wire.sent.filter((b) => b.action === "quote").length;

  press(buttonByText(priceRow(root, "Car"), "Book this run"));
  await settle();

  const yes = buttonByText(layers["confirm-layer"], "Book this run");
  assert.ok(yes, "the question comes straight away, because the numbers are already here");
  assert.equal(wire.sent.filter((b) => b.action === "quote").length, before,
    "and not one more request was made for them");
  press(yes);
  await settle();
  assert.equal(st.orders[0].courierFee, CAR_ALONE,
    "and the charge is still their own doorstep's cost, not the comparison's total");
});

test("a doorstep that cannot be priced on its own books nothing and charges nobody", async () => {
  // The one outcome that must never happen: a trip booked on a charge the courier never
  // quoted. Half a list of prices is not a smaller truth, it is a guess — so the booking
  // stops, in words, before anything is spent and before any customer is given a figure.
  const st = world();
  const wire = stubCourier({ failAloneAfter: 1 });
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  answerCharge(root, { payer: "The customer paid it" });
  press(buttonByText(priceRow(root, "Car"), "Book this run"));
  await letTheCourierAnswer(st);
  await settle();

  assert.equal(wire.sent.filter((b) => b.action === "book").length, 0, "the courier was never asked to book");
  assert.equal(buttonByText(layers["confirm-layer"], "Book this run"), undefined,
    "and she is never asked to confirm a trip nobody priced");
  for (const o of st.orders) {
    assert.equal(o.courierJob, undefined, `${o.id} is on no trip`);
    assert.equal("courierFee" in o, false, `${o.id} was given no charge`);
  }
  assert.deepEqual(st.expenses, [], "and nothing was invented on her books");
  const said = all(root).map((n) => n.textContent).join(" ");
  assert.ok(/could not price that doorstep on its own/.test(said),
    `and the screen says why, in words — read "${said.slice(0, 400)}"`);
  assert.ok(/Nothing was booked/.test(said), "and that nothing happened");
});

test("the question puts each customer's own cost against the trip's fee, and says whose the difference is", async () => {
  // "if the courier charges were reveal to them, it will shown as the original cost" — and
  // the screen has to be honest with HER about what that means: the customers between them
  // are asked for MORE than the trip costs her, and that gap is hers. It is stated as the
  // arithmetic it is, so the saving is a number she reads rather than a claim she trusts.
  const st = world();
  await upToTheQuestion(st);
  const said = all(layers["confirm-layer"]).map((n) => n.textContent).join(" ");
  assert.ok(said.includes("RM 13.50"), `Ain's own doorstep's cost is named — read "${said.slice(0, 400)}"`);
  assert.ok(said.includes("RM 16.25"), "and Bala's, which is its own number and not a copy of hers");
  assert.ok(/RM 29\.75 in all/.test(said), "and so is the total the two of them come to");
  assert.ok(/RM 7\.75 more than the RM 22\.00 the trip costs you/.test(said),
    "read against the trip's own fee, so the saving is a number, not a promise");
  assert.ok(/that difference stays with you/.test(said), "and it says whose it is, in her own terms");
});

test("a run that saves her nothing says so, rather than polishing the same numbers into a saving", async () => {
  // A small run on a big vehicle really can cost more than the same doorsteps sent one at a
  // time — the base fare plus a stop fee is not always beaten by the sum of separate base
  // fares, and the two doorsteps here are close together and few. Her rule does not bend to
  // the arithmetic: the customers are still charged their own originals, so the shortfall is
  // hers. What must not happen is a screen that adds up the same two numbers and calls it a
  // saving, because a saving she cannot see is a saving she will plan around and not get.
  const st = world();
  stubCourier({ standalone: 6 });
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  answerCharge(root, { payer: "The customer paid it" });
  press(buttonByText(priceRow(root, "Car"), "Book this run"));
  await letTheCourierAnswer(st);
  await settle();
  const said = all(layers["confirm-layer"]).map((n) => n.textContent).join(" ");
  assert.ok(/RM 12\.00 in all/.test(said), `the two originals, added up — read "${said.slice(0, 400)}"`);
  assert.ok(/RM 10\.00 SHORT of the RM 22\.00/.test(said), "and the shortfall stated as a shortfall");
  assert.ok(/loses you money/.test(said), "in her own terms, not softened into a smaller number");
});

// The same six presses as book(), stopping at the question rather than answering it — the
// confirmation's own words are what the test above is reading.
async function upToTheQuestion(st) {
  stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  answerCharge(root, { payer: "The customer paid it" });
  press(buttonByText(priceRow(root, "Car"), "Book this run"));
  await letTheCourierAnswer(st);
  await settle();
  assert.ok(buttonByText(layers["confirm-layer"], "Book this run"), "the app asked before spending money");
  return root;
}

test("a run booked with the charge questions unanswered records no charge at all", async () => {
  // She is allowed to book a trip before she has decided who pays for it — the vehicle is
  // on the road either way, and the run screen does not make the money a condition of the
  // booking. What must not happen is an order left carrying a charge of NOTHING. The three
  // keys are a set (see writeCourierCharge): a `courierFee: 0` sitting on an order reads as
  // "a charge was recorded here" to anything that asks whether the key is present, and the
  // app's own way back — Money's delete, which takes the row and the order together — has
  // nothing to find. Absent, not zero.
  const st = world();
  await book(st, {});
  for (const o of st.orders) {
    assert.equal("courierFee" in o, false, `${o.id} carries no charge key at all`);
    assert.equal("courierPaidBy" in o, false, "and none saying who paid it");
    assert.equal("courierCod" in o, false, "and none asking the courier to collect");
  }
  assert.deepEqual(st.expenses, [], "and nothing was invented on her books");
  assert.equal(st.orders[0].courierJob.jobId, "LLM-RUN-1",
    "the trip is booked all the same — the money is not a condition of the vehicle");
});

// ── 3. the window, and where it has to arrive ─────────────────────────────

test("a window typed on the run reaches every customer's card and messages", async () => {
  // The window is typed where the run is booked and has to arrive on the customer's own
  // two surfaces — the track card and the WhatsApp — because a promise that exists only in
  // the bakery's screen is a promise nobody was told.
  const st = world();
  await book(st, { window: "14:00-17:00", payer: "The customer paid it" });
  for (const o of st.orders) {
    assert.equal(o.deliveryWindow, "14:00-17:00", `${o.id} carries the promise`);
  }

  const snap = trackingSnapshot(st, { orders: st.orders.slice(0, 2) });
  assert.ok(snap.delivery.includes("Sat, 26 Sep"), `the day — read "${snap.delivery}"`);
  assert.ok(snap.delivery.includes("Post (nationwide)"), "carried by post");
  assert.ok(snap.delivery.includes("1 Jalan A"), "to the right doorstep");
  // ★ THIS CASE IS ALSO THE v338 REGRESSION GUARD, and deliberately so: these orders carry no
  // `courierDay`, which is every order already in her records. The card must therefore read exactly
  // as it did before this version — the window, and no day it was never told.
  assert.ok(snap.delivery.endsWith(", 2-5 pm"),
    "with the window inside it — no new column, no storefront change");

  const shipped = buildShippedMessage(st, { orders: st.orders.slice(2) }, "https://bake.app/track");
  // ⚠️ THE WINDOW IS STILL PROMISED — but on a line of its OWN (v337). It is the VAN's window and
  // the day above it is the BAKE day, so gluing the two together named a time on the wrong day.
  assert.ok(shipped.message.includes("Posting day: Sat, 26 Sep - Post (nationwide)"), "the bake day, named as one");
  assert.ok(shipped.message.includes("2-5 pm"), "and the window is still promised, not just the day");
  const reminder = buildPaymentReminder(st, { orders: st.orders.slice(0, 2) }, "https://bake.app/track");
  assert.ok(reminder.message.includes("Posting day: Sat, 26 Sep - Post (nationwide)"), "the reminder names the bake day too");
  assert.ok(reminder.message.includes("2-5 pm"), "and so does the payment reminder carry the window");
});

test("no window typed leaves every customer with the promise they already had", async () => {
  const st = world();
  await book(st, { payer: "The customer paid it" });
  for (const o of st.orders) assert.equal(o.deliveryWindow, undefined, "nothing was invented");
  const snap = trackingSnapshot(st, { orders: st.orders.slice(0, 2) });
  assert.ok(snap.delivery.includes("Sat, 26 Sep"), "the day");
  assert.ok(snap.delivery.includes("1 Jalan A"), "and the doorstep");
  assert.equal(snap.delivery.includes("pm"), false, "and no hour on it, exactly as before");
});

test("a window whose end is before its start is refused in words, never booked", async () => {
  // The one thing that must never happen: a customer told to expect the van before it left
  // the bakery. The box she is still typing in may read anything at all.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  type(inputByLabel(root, "The delivery window opens"), "17:00");
  type(inputByLabel(root, "The delivery window closes"), "14:00");
  press(buttonByText(root, "Price this run"));
  await settle();
  assert.equal(wire.sent.filter((b) => b.action === "quote").length, 0,
    "a promise that cannot be made is not even priced, let alone booked");
  for (const o of st.orders) assert.equal(o.deliveryWindow, undefined);
  assert.equal(st.orders[0].courierJob, undefined, "and nothing was booked");
  assert.ok(all(root).some((n) => /ends before it starts/.test(n.textContent)),
    "and the screen says why in words");
});

test("an untypeable window publishes exactly the promise of no window at all", async () => {
  // The second line of defence, and the one that matters if the first is ever bypassed: the
  // PUBLISHING gate. windowSuffix is asked by the card and by every message, so a window
  // that could not be typed contributes nothing to what a customer is told — even when it is
  // sitting on the order.
  //
  // Asserted against the NO-WINDOW promise rather than against the words in the box, and
  // that distinction is the whole test. An end-before-start window formats perfectly well —
  // "17:00-14:00" comes out as "5-2 pm", a promise to expect the van at five and again at
  // two — so looking for the digits she typed would pass while the customer was told
  // nonsense. What has to be true is that the untypeable one says exactly what saying
  // nothing says.
  const bare = world();
  const bad = world();
  for (const o of bad.orders) o.deliveryWindow = "17:00-14:00";

  const clean = trackingSnapshot(bare, { orders: bare.orders.slice(0, 2) }).delivery;
  const dirty = trackingSnapshot(bad, { orders: bad.orders.slice(0, 2) }).delivery;
  assert.equal(dirty, clean, `the card is unchanged — read "${dirty}"`);
  assert.equal(clean.includes("pm"), false, "and what it publishes carries no hour at all");

  const said = buildShippedMessage(bad, { orders: bad.orders.slice(2) }, "https://bake.app/track");
  const quiet = buildShippedMessage(bare, { orders: bare.orders.slice(2) }, "https://bake.app/track");
  assert.equal(said.message, quiet.message, "and no half-promise reaches the message either");
});

test("⚠️ the window rides with the VAN's day, never with the bake day (v338)", () => {
  // HER CUSTOMER'S OWN CASE, on the last surface still getting it wrong. Baked Saturday 26 Sep; the
  // van comes the NEXT MORNING. Until this version the customer's card read "Sat, 26 Sep … 2-5 pm" —
  // a window on a day the van does not come — while the message promised a window with no day at all.
  //
  // Written straight onto the orders rather than booked through the run screen: the card and the
  // messages are built from what an order CARRIES, so this is the same input a booking produces, at a
  // fraction of the cost — this file sits right on the suite's per-file budget.
  const st = world();
  for (const o of st.orders) { o.deliveryWindow = "14:00-17:00"; o.courierDay = "2026-09-27"; }

  const snap = trackingSnapshot(st, { orders: st.orders.slice(0, 2) });
  assert.ok(snap.delivery.includes("Sat, 26 Sep"), `the bake day is still on the card — read "${snap.delivery}"`);
  assert.ok(snap.delivery.includes("Sun, 27 Sep"), "and the VAN's own day is there now too");
  assert.ok(snap.delivery.endsWith(", Sun, 27 Sep, 2-5 pm"),
    `the window sits with the day the van comes — read "${snap.delivery}"`);

  const shipped = buildShippedMessage(st, { orders: st.orders.slice(2) }, "https://bake.app/track");
  assert.ok(shipped.message.includes("Posting day: Sat, 26 Sep - Post (nationwide)"), "the bake day, named as one");
  assert.ok(shipped.message.includes("Sun, 27 Sep, 2-5 pm"), "and the van's day said with its window");

  // ⚠️ THE ASSERTION THIS VERSION EXISTS FOR. The two days must never be joined into one moment —
  // which is exactly the sentence her customer read and then queried.
  assert.equal(/Sat, 26 Sep[^\n]*2-5 pm/.test(shipped.message), false,
    `the window is never on the bake day's line — read "${shipped.message}"`);
});

test("a van day with no window names the day and invents no hour (v338)", () => {
  const st = world();
  for (const o of st.orders) o.courierDay = "2026-09-27";
  const snap = trackingSnapshot(st, { orders: st.orders.slice(0, 2) });
  assert.ok(snap.delivery.endsWith(", Sun, 27 Sep"), `the day alone — read "${snap.delivery}"`);
  assert.equal(snap.delivery.includes("pm"), false, "and no hour invented for it");

  const shipped = buildShippedMessage(st, { orders: st.orders.slice(2) }, "https://bake.app/track");
  assert.ok(shipped.message.includes("Sun, 27 Sep"), "the day reaches the message too");
});

// ── 4. a price belongs to the list it was asked for ───────────────────────

test("unticking a customer after a price makes the Book press inert, and says why", async () => {
  // The fault this pins: booking the trip the screen REMEMBERS rather than the one on
  // screen. Its own sentence has to be readable, because a greyed press with nothing said
  // is a screen with a hole in it.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  assert.equal(buttonByText(priceRow(root, "Car"), "Book this run").disabled, false,
    "bookable while the list is the one that was priced");

  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  ticks[1].checked = false;
  change(ticks[1], "");

  assert.equal(buttonByText(priceRow(root, "Car"), "Book this run").disabled, true,
    "the list moved, so the price did");
  assert.ok(all(root).some((n) => /no longer taking/.test(n.textContent)),
    "and the reason is on the screen in words");
});

test("moving the collection day throws the price away rather than leaving it standing", async () => {
  // A price is for one journey. The same stops on another day are a different trip, and a
  // number left standing beside a moved box is a price she could book by mistake.
  const st = world();
  const wire = stubCourier();
  const { root } = openRun(st);
  press(buttonByText(root, "Price this run"));
  await settle();
  assert.ok(priceRow(root, "Car"), "priced");
  change(inputByLabel(root, "The day the driver collects"), "2026-09-27");
  assert.equal(priceRow(root, "Car"), undefined, "the price is gone, not left standing");
});

// ── 5. the run cannot grow a second set of charge questions ───────────────

test("the run asks the charge questions through the one shared block", async () => {
  // The run is the THIRD door that writes a courier charge. Its own comment forbids a
  // second copy of the questions, and three hands writing one charge on one order is three
  // chances for the order and her books to disagree. So this reads the source: the block is
  // imported, and the run does not restate its answers.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../admin/js/views/delivery_run.js", import.meta.url), "utf8");
  assert.match(src, /import \{[^}]*courierPayQuestions[^}]*\} from "\.\/orders\.js"/,
    "the questions come from the block the order card and the Edit form use");
  assert.match(src, /writeCourierCharge/, "and the charge is written by the one writer every door uses");
  for (const own of ["courierPaidBy", "courierCod", "courierFee"]) {
    assert.equal(src.includes(own), false, `the run must not restate the charge fields by hand (${own})`);
  }
});

test("the run names no courier of its own", async () => {
  // Her second clause, kept true at the third screen that wears it: a second courier is a
  // new file, and this screen must keep asking the registry what to call it.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../admin/js/views/delivery_run.js", import.meta.url), "utf8");
  assert.equal(/lalamove/i.test(src), false, "no courier's name in the run screen");
  assert.equal(/MOTORCYCLE|7FT_VAN/.test(src), false, "and none of its service keys either");
  assert.match(src, /activeCourier\(\)/, "it asks the registry which courier it is talking to");
});

// ── the two doors under a run row (v197, reversed at v209) ────────────────
//
// The second of the two places her answer puts the switch ("Both places"), and the one
// where the placement is load-bearing: everything in a run row sits inside one <label>,
// so a press drawn inside that row would tick the customer instead of pinning their door.
// Hence a block of its own beside the row — and the walk up the parent chain below is
// what really asserts it, because that trap would not show up in a shim that does not
// model a label's behaviour.

test("a kept door with no record of her hand loses to the pin the customer dropped (v209)", () => {
  const st = world();
  stubCourier();
  // Ain's kept door came from the fixture with no `from` on it, exactly as a door saved
  // before v209 reads — and the pin she dropped on the shop page is a different spot. Her
  // own pin is the door on this run, and the line under her row says where that is.
  st.orders[0].customerPlace = { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house", at: "2026-09-25T10:00:00.000Z" };
  const { root } = openRun(st);

  const runRow = all(root).find((n) => String(n.className).includes("run-row"));
  assert.match(runRow.textContent, /Sri Bunga guard house/,
    "the row says the door the driver is sent to is the pin the customer dropped, not the kept one");

  const offers = all(root).filter((n) => String(n.className).includes("pin-offer"));
  assert.equal(offers.length, 1, "one offer, under the one customer whose two doors disagree");
  assert.match(offers[0].textContent, /Ain's own pin is in use/);
  assert.match(offers[0].textContent, /The doorstep you keep for them is a different spot/);
  for (let n = offers[0].parentNode; n; n = n.parentNode) {
    assert.notEqual(n.tagName, "LABEL",
      "the offer is not inside the row's label — a press in there would tick the customer");
  }

  const take = buttonByText(offers[0], "Use the door I keep instead");
  assert.ok(take, "with one press to put her own door back in use");
  press(take);

  const row = st.customers.find((c) => c.key === keyOf(st.orders[0]));
  assert.equal(row.place.lat, 5.42, "the kept door is now the door again");
  assert.equal(row.place.from, "hand", "and it is recorded as HER OWN hand, so it stays put");
  const flipped = all(root).filter((n) => String(n.className).includes("pin-offer"));
  assert.equal(flipped.length, 1, "the one control stays — it now offers the other door");
  assert.match(flipped[0].textContent, /Ain pinned a different spot this time/);
  assert.ok(buttonByText(flipped[0], "Use the customer's pin instead"),
    "and it points the other way, at the pin they dropped");
});

// ── where each door on a run comes from (v208) ────────────────────────────
//
// The run screen's own copy of the bug her app was reported for four times over: it looked
// up EVERY unpinned doorstep and kept the geocoder's answer, even for a customer who had
// dropped a pin of their own — which moves the door off their own point and onto the
// street, because that is all a geocoder can answer for a Malaysian house number. One test
// covers both halves on one run: the customer with a pin is not looked up, and the customer
// without one is.

test("a customer's own pin is the run's door for them, and only the other doors are looked up (v208)", async () => {
  const st = world();
  const wire = stubCourier();
  // Nothing kept for either customer yet, so every door has to be found — and Ain has
  // dropped a pin of her own, which is her door. That leaves one lookup, and it is Bala's.
  st.customers = [];
  st.orders[0].customerPlace = { lat: 5.4299, lng: 100.3399, label: "1 Jalan A", at: "2026-09-25T10:00:00.000Z" };
  const { root } = openRun(st);

  press(buttonByText(root, "Price this run"));
  await settle();

  const looked = wire.sent.filter((r) => r.action === "geocode");
  assert.equal(looked.length, 1,
    "one lookup for the one doorstep nobody has answered — the customer's own pin is never looked up");
  assert.equal(looked[0].payload.address, "9 Jalan B", "and it is the unpinned customer's address that is asked");

  const ain = st.customers.find((c) => c.key === keyOf(st.orders[0]));
  assert.equal(ain.place.lat, 5.4299, "Ain's door is the pin she dropped herself, not a geocoder's guess");
  assert.equal(ain.place.lng, 100.3399, "both numbers of it, so it is her point and not a neighbour");
  assert.equal(ain.place.label, "1 Jalan A", "named with the address on the order (v207)");
  assert.equal(ain.place.from, "customer",
    "and the row the run kept is recorded as THEIRS (v209) — a copy of their pin, not a door of hers");

  const bala = st.customers.find((c) => c.key === keyOf(st.orders[2]));
  assert.equal(bala.place.lat, 5.46, "Bala's door is the point the lookup found, because they left no pin");
  assert.equal(bala.place.lng, 100.36, "both numbers of it");
  assert.equal(bala.place.label, "9 Jalan B",
    "and it is named with the address on the order, NOT with the geocoder's row (v207)");
});

// ── a doorstep that is only the road says so on its own row (v211) ────────
//
// The run is where several doorsteps are read at once, and it is the screen where a street
// wearing a house's name would be missed: every row leads with the address on the order, so
// a lookup that answered "9 Jalan B" with "Jalan B, Butterworth" wrote a point on the road
// under words that name house nine. One run covers all three answers — the lookup that
// missed the number says so on that customer's row, the customer whose OWN pin is the door
// says nothing (no lookup wrote their point), and the other door says nothing either.

test("a doorstep the lookup found only as far as the road says so on its own row (v211)", async () => {
  const st = world();
  const wire = stubCourier();
  // Ain keeps no door and dropped a pin of her own, so hers is the one door NOT looked up;
  // Bala has no door at all, so the lookup answers for her and answers with a street.
  st.customers = [];
  st.orders[0].customerPlace = { lat: 5.4299, lng: 100.3399, label: "1 Jalan A", at: "2026-09-25T10:00:00.000Z" };
  const { root } = openRun(st);

  press(buttonByText(root, "Price this run"));
  await settle();

  const looked = wire.sent.filter((r) => r.action === "geocode");
  assert.equal(looked.length, 1, "only the door nobody answered for is looked up");
  const bala = st.customers.find((c) => c.key === keyOf(st.orders[2]));
  assert.equal(bala.place.road, "9",
    "the number the lookup could not find is stored with the door it wrote");
  assert.equal(bala.place.label, "9 Jalan B", "and the door is still named with the address on the order");

  const rows = all(root).filter((n) => String(n.className).includes("run-row"));
  const rowOf = (name) => rows.find((r) => r.textContent.includes(name));
  assert.match(rowOf("Bala").textContent, /9 Jalan B — the road, not number 9/,
    "her row says the pin is the street, in the same breath as the address it wears");
  assert.match(rowOf("Ain").textContent, /1 Jalan A/,
    "Ain's row still names her door with the address on the order");
  assert.doesNotMatch(rowOf("Ain").textContent, /the road, not number/,
    "and says nothing about a road — her door is the pin she dropped herself, and no lookup wrote it");
  assert.equal(wire.sent.some((r) => r.action === "geocode" && r.payload.address === "1 Jalan A"), false,
    "which is the same fact from the wire's side: their own pin is never looked up");
});

test("a courier customer who pinned nothing gets no offer at all (v197)", () => {
  // Her second answer: "Send as it is today" — an order with no pin is the order this shop
  // has always taken, and nothing about it changes.
  const st = world();
  stubCourier();
  const { root } = openRun(st);
  assert.equal(all(root).filter((n) => String(n.className).includes("pin-offer")).length, 0,
    "no pin, no offer, no new line on the run");
});

test("a customer who pinned with no door kept for them yet has no offer to make (v209)", () => {
  // The other half, and the one an overnight sweep found unguarded: with nothing kept for
  // this customer there is only ONE door on the order, so there is nothing to switch
  // between — and a press that switches between a door and itself would be a control that
  // does nothing. Their pin is simply the door, said on the row's own line.
  const st = world();
  stubCourier();
  st.customers = st.customers.filter((c) => c.name !== "Bala"); // nothing kept for them yet
  st.orders[2].customerPlace = { lat: 5.4399, lng: 100.3499, label: "Bala's front gate", at: "2026-09-25T10:00:00.000Z" };
  const { root } = openRun(st);

  assert.equal(all(root).filter((n) => String(n.className).includes("pin-offer")).length, 0,
    "one door on the order, so the switch is not drawn at all");

  const rows = all(root).filter((n) => String(n.className).includes("run-row"));
  assert.ok(rows.some((r) => /Bala's front gate/.test(r.textContent)),
    "and their own pin is named on the row as the door the driver is sent to");
});

test("a door SHE placed by hand is not moved by their pin, and the offer points at theirs (v209)", () => {
  // The carve-out, on the run screen. Bala's kept door is recorded as her own hand — a drag,
  // or a pick on the map — so it stays the door even though they pinned somewhere else.
  // The test above reaches the `which: "kept"` direction only.
  //
  // The press is asserted by its EXACT words on purpose. "Use the customer's pin instead"
  // and "Use the pin" are different offers — the second does not say whose door it is, and
  // on a screen where she is deciding which of two doors to keep, whose it is IS the offer.
  const st = world();
  stubCourier();
  st.customers.find((c) => c.name === "Bala").place.from = "hand";
  st.orders[2].customerPlace = { lat: 5.4399, lng: 100.3499, label: "Bala's front gate", at: "2026-09-25T10:00:00.000Z" };
  const { root } = openRun(st);

  const rows = all(root).filter((n) => String(n.className).includes("run-row"));
  assert.ok(rows.some((r) => /Bala's door/.test(r.textContent)),
    "the door she placed herself is still the door on the run");

  const offers = all(root).filter((n) => String(n.className).includes("pin-offer"));
  assert.equal(offers.length, 1, "one offer, under the one customer whose two doors disagree");
  assert.match(offers[0].textContent, /Bala pinned a different spot this time/);
  assert.doesNotMatch(offers[0].textContent, /their door on the shop page/,
    "a door of hers is being replaced, so the words must say so");

  const btn = buttonByText(offers[0], "Use the customer's pin instead");
  assert.ok(btn, "with one press to take theirs — and it says whose pin it is");
  press(btn);
  const row = st.customers.find((c) => c.key === keyOf(st.orders[2]));
  assert.equal(row.place.lat, 5.4399, "the pin they dropped is now the door");
  assert.equal(row.place.from, "customer", "recorded as theirs, so a later re-pin still wins");
});


// ── v226: a parcel she posted herself never goes on a van run ────────────────
// The second KIND of courier. A parcel goes to a carrier's counter or pickup, so a
// run that swept it in would price a vehicle for a box already on its way — and the
// customer, who is being told a carrier has it, would then be told a driver is coming.

test("an order recorded as a parcel is not on the run at all", () => {
  const st = world();
  stubCourier();
  // Ain's doorstep is a parcel now; Bala's is still an ordinary courier delivery.
  for (const o of st.orders.filter((o) => o.groupId === "g1")) {
    o.parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" };
  }
  const { root } = openRun(st);

  const rows = all(root).filter((n) => String(n.className).includes("run-row"));
  assert.equal(rows.length, 1, "only the doorstep that really goes on a van");
  assert.match(rows[0].textContent, /Bala/);
  assert.doesNotMatch(root.textContent, /Ain/, "the parcel's customer is not offered as a drop");
});

test("a day whose only courier orders are parcels has nothing to run", () => {
  const st = world();
  stubCourier();
  for (const o of st.orders) {
    o.parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" };
  }
  const { root } = openRun(st);
  assert.match(root.textContent, /Nothing to run yet/,
    "an empty run says so rather than offering a vehicle for boxes already gone");
});

test("clearing the parcel puts the doorstep back on the run", () => {
  // The rule is read off the order, not remembered anywhere, so undoing the record
  // undoes the exclusion — which is what makes the press reversible.
  const st = world();
  stubCourier();
  for (const o of st.orders.filter((o) => o.groupId === "g1")) {
    o.parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" };
  }
  for (const o of st.orders) delete o.parcel;
  const { root } = openRun(st);

  const rows = all(root).filter((n) => String(n.className).includes("run-row"));
  assert.equal(rows.length, 2, "both doorsteps are back");
});

// ── v242: a customer whose trip is already booked is never quietly put on a second van ──
//
// Her report, 30 Sep 2026: "if a customer order courier book, delivery run should not tick
// that order and need an info indicating it is book so that a delivery will not be double
// book". Her two answers settled the shape: NOT a gate (default unticked, plus a warning),
// and NOT greyed out (offer to call the original booking off so it can be consolidated).
//
// Every test below therefore has a counterfactual twin, because "it does not tick" alone
// would also be true of a greyed row or a hidden one — the point is that the row stays
// fully usable and only the DEFAULT changed. See also test/courier-run.test.js for the
// pure `tripCalledOff` record these presses write.

test("a booked customer opens off the run, while their neighbour stays on it (v242)", async () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const ain = rowFor(root, "Ain");
  const bala = rowFor(root, "Bala");
  assert.ok(ain.tick && bala.tick, "both customers are on the list — a booked one is not hidden");
  assert.equal(ain.tick.checked, true, "the ordinary customer opens ticked, exactly as before");
  assert.equal(bala.tick.checked, false, "and the booked one does not");

  const head = all(root).find((n) => String(n.className).includes("run-head-title")).textContent;
  assert.equal(head, "Who is on the run — 1 of 2 · 1 already booked",
    `the head counts the booked one rather than losing them — read "${head}"`);
});

test("a day with nothing booked reads exactly as it always did (v242)", async () => {
  // The note is an APPENDAGE, not a replacement, so the line she has been reading for
  // months is byte-identical until there is something to say.
  const st = world();
  stubCourier();
  const { root } = openRun(st);
  const head = all(root).find((n) => String(n.className).includes("run-head-title")).textContent;
  assert.equal(head, "Who is on the run — 2 of 2");
});

test("the booked row says WHICH courier and where the trip has got to, in its own words (v242)", async () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const block = bookedBlock(root, "Bala");
  assert.ok(block, "the warning is on the page, under the customer it is about");
  assert.match(block.textContent, /Already booked with Lalamove — The driver is on the way\./,
    "the courier and its own word for the trip's state");
  assert.match(block.textContent, /would send a second vehicle to the same door/,
    "and the consequence — the very sentence the Book press refuses with, so the app says one "
    + "thing about double-booking wherever she meets it");

  // AND IT IS OUTSIDE THE ROW'S OWN <label>. Everything inside that label ticks the customer,
  // so a press in here would put them ON the run instead of taking the trip off it.
  const { row } = rowFor(root, "Bala");
  let node = block;
  while (node && node !== row) node = node.parentNode;
  assert.notEqual(node, row, "the block is a sibling of the row, never inside its label");
});

test("a trip whose status has not been read back names the courier and stops there (v242)", async () => {
  // The joined line is what keeps a job with no status from printing a dangling dash or the
  // word null on her screen — the class of fault the suite already guards elsewhere.
  const st = bookedBala(world(), { status: "" });
  stubCourier();
  const { root } = openRun(st);

  const block = bookedBlock(root, "Bala");
  assert.ok(block, "the warning is still there — a trip is booked whether or not we know how far");
  assert.match(block.textContent, /Already booked with Lalamove\. Ticking it/);
  assert.doesNotMatch(block.textContent, /—\s*\./, "no dangling dash where the courier's word would be");
  assert.doesNotMatch(block.textContent, /null/, "and nothing reading null");
});

// ── ★★ v342: the booked row opens the order ──────────────────────────────
//
// Her ask: the row whose courier trip is ALREADY ACTIVE should offer a button in its ribbon that unfolds
// **the trip's own record** — the courier, its state, when it was booked, the link — with a price. ⚠️ The
// panel must be a SIBLING of the row, never inside its `<label>`: everything in that label is a tick, so a
// press in there would put the customer ON the run instead of opening their trip.
//
// ⚠️⚠️ **v342 UNFOLDED A SUMMARY OF THE ORDER INSTEAD, and she corrected it:** *"for the v342, you miss
// underrstood me, what i want is the courier booked details like the one we see after pressing GET A
// DELIVERY PRICE."* So the panel is now that card, drawn by `courierQuoteSection` — the code that owns it.

const detailOf = (root) => all(root).find((n) => String(n.className).includes("run-detail"));

test("the booked row offers its trip, and the detail sits outside the row's label (v342)", () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const see = buttonByText(bookedBlock(root, "Bala"), "See the trip");
  assert.ok(see, "the ribbon offers a way to look at the trip");
  assert.equal(detailOf(root), undefined, "and it stays shut until she asks for it");

  press(see);
  const detail = detailOf(root);
  assert.ok(detail, "pressing it unfolds the trip");
  const { row } = rowFor(root, "Bala");
  let node = detail;
  while (node && node !== row) node = node.parentNode;
  assert.notEqual(node, row, "the detail is a sibling of the row, never inside its label");
  assert.ok(buttonByText(bookedBlock(root, "Bala"), "Hide the trip"), "and the press now shuts it again");
});

test("★ the unfolded panel is the courier's own record of the trip (v342, corrected v343)", () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);
  press(buttonByText(bookedBlock(root, "Bala"), "See the trip"));

  const said = detailOf(root).textContent;
  // ⚠️ NAMED WITHOUT NAMING THE COMPANY — the registry supplies it, which is the rule this screen keeps.
  assert.match(said, /is booked on this order\./,
    `the panel says the courier is on this order — read "${said.slice(0, 200)}"`);
  // The section whose body carries the trip's own card: the vehicle and its price, when it was booked,
  // where it has got to, the customer's share link, [Check the trip] and [Cancel trip].
  assert.ok(buttonByText(detailOf(root), "Get a delivery price"),
    "and the card it lives in — the courier, its state, the booking time and the link");
  // ⚠️ AND IT IS NOT THE ORDER SUMMARY v342 DREW — her correction, pinned so it cannot come back.
  assert.equal(/What it comes to/.test(said), false,
    "the panel is the courier's record, not a second rendering of the order's money");
});

test("the unfolded trip survives a repaint (v342)", () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);
  press(buttonByText(bookedBlock(root, "Bala"), "See the trip"));
  assert.ok(detailOf(root), "open");

  // Ticking another customer redraws the whole list — which is exactly what would fold this away if its
  // open state lived in the DOM. It lives beside the ticked set instead, so it is still open after.
  press(rowFor(root, "Ain").tick);
  assert.ok(detailOf(root), "and still open after the list was redrawn");
});

// ── ★★ v343: a run is on the day the VAN comes ───────────────────────────
//
// Her correction, in her words: *"the delivery run should not be on bake day only, for the case of 7th
// bake day order deliver 8th, his order should be appear only on date 8th. SO after his order, other order
// not specifing specific delivery will be on bake day 6th."*
//
// The fixture's only saved bake day is Sat 26 Sep — so Sun 27 Sep is NOT a bake day at all, which is what
// makes these two cases the whole rule: the van's day carries the order, the bake day does not, and a day
// that is no bake day still gets a run.

test("⚠️ an order whose van comes the next day is on THAT day's run, and only there (v343)", () => {
  const st = world();
  st.orders[2].courierDay = "2026-09-27"; // Bala: baked Sat 26 Sep, van Sun 27 Sep
  stubCourier();

  const onTheVanDay = openRun(st, "2026-09-27");
  assert.ok(rowFor(onTheVanDay.root, "Bala").row, "the van's day carries him");
  assert.match(String(onTheVanDay.root.textContent), /Sun, 27 Sep/, "and the day is named as the van's");

  const onTheBakeDay = openRun(st, "2026-09-26");
  assert.equal(rowFor(onTheBakeDay.root, "Bala").row, undefined,
    "and he is NOT on his bake day's run — which is the whole of the correction");
  assert.ok(rowFor(onTheBakeDay.root, "Ain").row,
    "while an order with no van day typed stays where it was, on its bake day");
});

test("a van day that is no bake day still gets a run of its own (v343)", () => {
  const st = world();
  for (const o of st.orders) o.courierDay = "2026-09-27";
  stubCourier();
  const { root } = openRun(st, "2026-09-27");
  assert.match(String(root.textContent), /Sun, 27 Sep/, "the day is offered by name");
  assert.ok(rowFor(root, "Bala").row, "and its run holds the orders whose van comes that day");
});

test("⚠️ the run's unfolded panel never passes the price-only flag (v343)", async () => {
  // ⚠️ **A SOURCE GUARD, and it earns its place.** `canBook: false` is right for the ＋ New order card,
  // which has no order yet — but on THIS screen it silently takes the trip's own card with it (that card
  // sits under `canBook ? jobBox : null`), which is the one thing she unfolds a booked row to read. Her
  // words: *"what i want is the courier booked details like the one we see after pressing GET A DELIVERY
  // PRICE — it shows the courier is on this order, with Check the trip, the status, booked 3:25pm and the
  // link."* A render test cannot catch its return cheaply — pressing the section fires real quote requests
  // with the wire's own waits, and this file is at its per-file time budget — so the call site is pinned
  // here instead, the same way the courier-provider guard pins a name across the engine.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../admin/js/views/delivery_run.js", import.meta.url), "utf8");
  // ⚠️ LINE COMMENTS OUT FIRST, deliberately: the notes at that call site NAME the flag in prose — that is
  // how the next reader learns why it must not be there — and a guard that tripped on its own explanation
  // would be a guard against explaining anything.
  const code = src.replace(/^[^\n]*\/\/[^\n]*$/gm, "");
  assert.equal(/canBook:\s*false/.test(code), false,
    "the section must stay book-able here, or the trip's own card is never drawn");
});

test("the bulk press leaves a booked customer alone, and still flips its own label (v242)", async () => {
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const bulk = () => (buttonByText(root, "Tick them all") || buttonByText(root, "Untick them all"));
  // The whole tickable day is already on, so the press offers to take it off — the label is
  // asked of the TICKABLE set, and a booked row must not be able to hold it hostage.
  assert.equal(bulk().textContent, "Untick them all");

  press(bulk());
  assert.equal(rowFor(root, "Bala").tick.checked, false, "ticks them all does not mean THEM all");
  assert.equal(rowFor(root, "Ain").tick.checked, false, "and the ordinary customer really did come off");

  assert.equal(bulk().textContent, "Tick them all", "the label still flips");
  press(bulk());
  assert.equal(rowFor(root, "Ain").tick.checked, true, "putting them back puts the ordinary one back");
  assert.equal(rowFor(root, "Bala").tick.checked, false, "and still leaves the booked one off");
});

test("it is a warning, not a gate: ticking a booked customer by hand is honoured, and the PRICE says why (v242)", async () => {
  // The counterfactual the whole design rests on. Her words: "it should not be gate". So the
  // tick is live, the tick is honoured, and the refusal is the app's existing one — arriving on
  // the price panel with the Book press already inert, rather than as a shock at the press.
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const bala = rowFor(root, "Bala");
  bala.tick.checked = true;
  change(bala.tick, "");
  assert.equal(rowFor(root, "Bala").tick.checked, true,
    "the press is honoured — nothing puts her tick back");

  press(buttonByText(root, "Price this run"));
  await settle();

  const row = priceRow(root, "Car");
  assert.ok(row, "the run is still priced — a booked customer is not refused at the price either");
  assert.match(root.textContent, /This order is already on a trip\. Check it below, or cancel it first/,
    "and the reason is ON THE SCREEN before she presses anything");
  const book = buttonByText(row, "Book this run");
  assert.ok(book, "with the booking press still drawn");
  assert.equal(book.disabled, true, "and inert — the money never moves");
  assert.equal(st.orders[2].courierJob.jobId, "LLM-SOLO-1", "the trip she already had is untouched");
});

test("calling a booked trip off asks first, and Cancel writes nothing at all (v242)", async () => {
  const st = bookedBala(world());
  const wire = stubCourier();
  const { root } = openRun(st);

  assert.match(root.textContent, /Call off the trip and add to this run/,
    "the way out is offered on the row itself");
  press(buttonByText(root, "Call off the trip and add to this run"));
  await settle();

  const confirm = layers["confirm-layer"];
  assert.match(confirm.textContent, /Call off this Lalamove trip and put Bala on this run instead\?/,
    "the app asks before cancelling a real driver, and names whose trip it is");
  assert.match(confirm.textContent, /cannot be undone from here/,
    "saying plainly which half is irreversible");

  press(buttonByText(confirm, "Cancel"));
  await settle();

  assert.equal(wire.sent.filter((b) => b.action === "cancel").length, 0,
    "no cancellation left the phone");
  assert.equal(st.orders[2].courierJob.done, undefined, "and the trip is still running");
  assert.ok(bookedBlock(root, "Bala"), "the warning is still on the row");
  assert.equal(rowFor(root, "Bala").tick.checked, false, "and nobody was quietly ticked");
});

test("Call it off cancels the trip, records it, drops the warning, and puts the customer on the run (v242)", async () => {
  // Her second answer, both halves of it: "offer to cancel the original booking to consolidate
  // with other order". The cancel and the consolidation are one press because that is one
  // intention — but only the cancel is irreversible, which is why it is the half that is asked.
  const st = bookedBala(world());
  const wire = stubCourier();
  toastNode.textContent = "";
  const { root } = openRun(st);

  press(buttonByText(root, "Call off the trip and add to this run"));
  await settle();
  press(buttonByText(layers["confirm-layer"], "Call it off and add to the run"));
  await settle();

  const sent = wire.sent.filter((b) => b.action === "cancel");
  assert.equal(sent.length, 1, "exactly one cancellation");
  assert.equal(sent[0].provider, "lalamove", "asked of the courier that HOLDS the trip");
  assert.equal(sent[0].payload.orderId, "LLM-SOLO-1", "and about the trip she already had");

  const job = st.orders[2].courierJob;
  assert.equal(job.done, true, "the order's own row now records the trip as finished");
  assert.ok(job.cancelledAt, "stamped with when, so the card can say how long ago");
  assert.equal(job.jobId, "LLM-SOLO-1", "without losing which trip it was");
  assert.equal(job.status, "ON_GOING", "and without inventing a status word the courier never sent");

  assert.equal(bookedBlock(root, "Bala"), undefined, "the warning is gone — the row is ordinary again");
  assert.equal(rowFor(root, "Bala").tick.checked, true,
    "and the customer is ON this run, which is the whole point of calling the trip off");
  assert.match(root.textContent, /2 of 2/, "the head counts them both");
  assert.match(toastNode.textContent, /Bala is off the Lalamove trip and on this run/,
    "and it says so, in her words, so a press that spends money is never silent");
});

test("a courier that refuses to call the trip off is answered in its own words, and nothing is written (v242)", async () => {
  // A refusal is an ORDINARY answer, not a fault: the courier is the one who decides whether a
  // trip can still be called off. So it is said and the app writes nothing — no finished record,
  // no tick, no half-state to reconcile later.
  const st = bookedBala(world());
  const wire = stubCourier({ cancel: false });
  toastNode.textContent = "";
  const { root } = openRun(st);

  press(buttonByText(root, "Call off the trip and add to this run"));
  await settle();
  press(buttonByText(layers["confirm-layer"], "Call it off and add to the run"));
  await settle();

  assert.equal(wire.sent.filter((b) => b.action === "cancel").length, 1, "it was asked");
  assert.equal(st.orders[2].courierJob.done, undefined, "and the trip is still the one it was");
  assert.ok(bookedBlock(root, "Bala"), "the warning stands, because the trip really does");
  assert.equal(rowFor(root, "Bala").tick.checked, false, "and nobody was ticked");
  assert.match(toastNode.textContent, /can no longer be called off/,
    "the courier's own sentence reaches her rather than a grey button");
});

test("a trip that has already finished is no barrier — that customer can be sent again (v242)", async () => {
  // The redo path, and the reason the predicate is `liveJobOf` rather than "has a courierJob":
  // a delivered or cancelled trip is a fact about the past, and a customer whose delivery failed
  // has to be put on a run again.
  const st = bookedBala(world(), { done: true, status: "COMPLETED" });
  stubCourier();
  const { root } = openRun(st);

  assert.equal(rowFor(root, "Bala").tick.checked, true, "they open on the run like anyone else");
  assert.equal(bookedBlock(root, "Bala"), undefined, "with no warning to read past");
  const head = all(root).find((n) => String(n.className).includes("run-head-title")).textContent;
  assert.equal(head, "Who is on the run — 2 of 2", "and the head has no note to make");
});

test("the booked customer is still priced and loaded with the rest of the day (v242)", async () => {
  // The one thing that has NOT changed: a booked customer left off the run is off the LOAD as
  // well, so the van's own numbers describe the run she is actually taking. A screen that said
  // "2 stops" while carrying one would be the app describing a trip nobody is driving.
  const st = bookedBala(world());
  stubCourier();
  const { root } = openRun(st);

  const read = all(root).find((n) => String(n.className).includes("run-load"));
  assert.ok(read.textContent.startsWith("1 stop"), `one door on this run — read "${read.textContent}"`);
  assert.ok(read.textContent.includes("3 items"), "and the focaccia that go to that one door");
  assert.doesNotMatch(read.textContent, /6 items/, "the booked customer's order is not on the van");
});

// ── v302: A REAL POINT ORDER REACHES THE RUN ────────────────────────────────
//
// The tests above all ride `worldWithPoint`, and until v302 that fixture left the Point's
// orders as `fulfillment: "courier"` — which the SHOP HAS NEVER PRODUCED. Choosing a Point
// leaves the order "collect" and only adds pointId. So the run screen's day filter, which
// asked `fulfillment === "courier"`, dropped every real Point order before the rows were
// built, and the whole of v301's row work was unreachable. The fixture is now honest, and
// these three tests say what the screen has to do about it.

test("an order COLLECTING at a Point is on the run, not 'nothing to run yet' (v302)", () => {
  // The exact report, in miniature: a customer chose to collect at Farlim, nobody is having
  // anything delivered, and the screen must still offer the trip — the bread has to get there.
  const st = worldWithPoint(["g1", "g2"]);
  assert.equal(st.orders.every((o) => o.fulfillment === "collect"), true,
    "the fixture is modelling what the shop really writes");
  stubCourier();
  const { root } = openRun(st);
  assert.equal(/Nothing to run yet/.test(String(root.textContent)), false,
    "a day of collections at a Point is still a day with something to run");
  const ticks = all(root).filter((n) => n.tagName === "INPUT" && String(n.className).includes("run-tick"));
  assert.equal(ticks.length, 1, "one stop for the Point");
});

test("a collection from the KITCHEN is still not on the run (v302)", () => {
  // The half a careless fix breaks. She hands kitchen collections over herself, so sweeping
  // them onto a van would price a vehicle for bread that never leaves the counter.
  const st = worldWithPoint(["g1", "g2"]);
  for (const o of st.orders) { delete o.pointId; }   // collect, but at the kitchen
  stubCourier();
  const { root } = openRun(st);
  assert.match(String(root.textContent), /Nothing to run yet/,
    "a collection at the kitchen is not a trip");
});

test("the day's own label counts STOPS, not the orders behind them (v302)", () => {
  // It read "2 courier orders" over a day carrying nothing but collections at one Point.
  // A label describing the day she is about to open has to describe it with the number she
  // is about to see.
  const st = worldWithPoint(["g1", "g2"]);
  stubCourier();
  const { root } = openRun(st);
  const t = String(root.textContent).replace(/\s+/g, " ");
  assert.match(t, /1 stop\b/, `the day is one stop — read "${t.slice(0, 200)}"`);
  assert.equal(/courier order/.test(t), false, "and never calls a collection a courier order");
});

// ── v305: WHEN THEY CAN COLLECT, on the row ─────────────────────────────────
// Her ask, and it is the one number this screen was missing. The hours she sets on the Point
// (v304) decide when the bread has to BE THERE and handed over, so a trip booked for the wrong
// part of the day is visible here rather than a day later — on the screen where she is about to
// spend money on a van.

test("a Point's row says when they can collect (v305)", () => {
  const st = worldWithPoint(["g1", "g2"]);
  st.points[0].collectWindow = "14:00-18:00";
  stubCourier();
  const { root } = openRun(st);

  const row = all(root).find((n) => String(n.className).includes("run-row-point"));
  assert.ok(/collect 2-6 pm/.test(row.textContent),
    `the hours are on the row — read "${row.textContent}"`);
  // AFTER the address and BEFORE the bread: where, then when, then what.
  const said = String(row.textContent).replace(/\s+/g, " ");
  assert.ok(said.indexOf("Lebuhraya Thean Teik") < said.indexOf("collect 2-6 pm"));
  assert.ok(said.indexOf("collect 2-6 pm") < said.indexOf("Focaccia"),
    "when sits between where and what");
});

test("a Point with no hours set says nothing about the time (v305)", () => {
  // The card already says she has not set any; repeating it on every run row would be noise on
  // the screen she reads while working.
  const st = worldWithPoint(["g1", "g2"]);
  assert.equal(String(st.points[0].collectWindow || ""), "", "the fixture has none");
  stubCourier();
  const { root } = openRun(st);
  const row = all(root).find((n) => String(n.className).includes("run-row-point"));
  assert.ok(!/collect \d/.test(row.textContent), `no time claimed — read "${row.textContent}"`);
});

test("a customer's own doorstep never claims collection hours (v305)", () => {
  // Only a Point is a place with hours. A doorstep's row is unchanged, and the Point's hours
  // must not leak onto it because the screen has learned about windows.
  const st = worldWithPoint(["g1"]);
  st.points[0].collectWindow = "14:00-18:00";
  stubCourier();
  const { root } = openRun(st);
  const rows = all(root).filter((n) => String(n.className).includes("run-row")
    && !String(n.className).includes("run-row-point"));
  assert.equal(rows.length, 1, "Bala's own door is the other row");
  assert.ok(!/collect \d/.test(rows[0].textContent),
    `his doorstep has no hours — read "${rows[0].textContent}"`);
});
