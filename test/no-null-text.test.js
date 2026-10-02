// test/no-null-text.test.js — no screen may ever draw the word "null".
//
// el() skips null/undefined and false, but replaceChildren() does NOT: it is a
// DOM method, and the real DOM converts each argument with String(), so a null
// becomes a text node reading "null" and the owner sees the word printed on the
// page. Three call sites passed a null for an optional child (19 Sep 2026):
// the Settings screen's sample-data card, the "How the day adds up" sum, and the
// date picker's Today shortcut.
//
// WHY THIS TEST EXISTS SEPARATELY, AND WHY ITS SHIM IS DIFFERENT. Every other
// view test's replaceChildren shim drops null arguments — `if (c != null)` — so
// they all render a screen with the stray "null" already removed, and the defect
// is invisible to them. This shim deliberately does what the browser does:
// non-node arguments become text. The rendering, the shim, and the "null" shim
// regression (flip one call site back to passing null and this file fails).
//
// AND THE THIRD SCREEN (v189, 25 Sep 2026). The courier price panel wrote its two
// optional lines as bare `?: null`, and the drawn panel printed the word "null"
// under the last price row — found by reading the panel on screen at 375 pixels,
// on the first booking this app ever made, which is the worst place for a stray
// word to stand. It was invisible here for the same reason as the others: this
// file simply did not render that screen yet. It does now.
//
// AND THE FOURTH (v195, 25 Sep 2026), which is the same fault at full size. The
// pickup-pin card's body hands showPopup a LIST of seven elements; `replaceChildren`
// is variadic, so the array was stringified and the card printed
// "[object HTMLParagraphElement],[object HTMLDivElement],…" — with no button, no field
// and no map on it, because every one of them had been thrown away. She found it on her
// own phone the first time she tried to pin her bakery's door. It got that far for the
// bluntest reason available: place_map.js had no test of any kind, in this file or any
// other. Both halves are asserted below, at the primitive every card goes through and at
// the screen she was looking at.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, scrollHeight: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this._adopt(c); if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; this._adopt(c); this.children.push(c); } },
    // The real DOM: a node is used as-is, anything else is stringified into a
    // text node — so null arrives on the page as "null".
    replaceChildren(...cs) {
      // And the children it drops are ORPHANED, not merely forgotten — a real DOM
      // detaches them, so their parent is null and `isConnected` below answers no. A node
      // left pointing at the parent it was taken out of would go on answering "yes, still
      // here" for the rest of the run, which is enough to keep the courier panel's own
      // one-second clock alive in a box that was thrown away. test/orders-day-sum.test.js
      // and test/orders-autocollect.test.js carry the same fix for the same reason.
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    // The real DOM keeps a child's parent, and `isConnected` walks it. The courier
    // price panel asks `wrap.isConnected` before it does anything (and re-asks it
    // after every await, because the card can be closed mid-flight), so a shim with
    // no parent links would make the panel's whole path unreachable and every
    // assertion about it would pass over an empty screen. Added here for the same
    // stated reason test/board-view.test.js added it.
    _adopt(c) { if (c && c.nodeType === 1) c.parentNode = this; },
    get isConnected() {
      for (let n = this; n; n = n.parentNode) if (n === doc.body) return true;
      return false;
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
    // The map loader tears its own node out when a third party's script will not load
    // (`mapBox.remove()` in place_map.js), and a shim without this throws inside that
    // catch — turning the very branch the pickup-pin test exists to reach into a crash.
    remove() {
      if (this.parentNode && Array.isArray(this.parentNode.children)) {
        this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
      }
      this.parentNode = null;
    },
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

const layers = {};
// This suite is offline (the fetch stub below rejects), so a third party's script can
// never load — and the pickup-pin card has to survive that. Firing the `error` a real
// <script> fires when it cannot be fetched makes that branch reachable at once, instead
// of after the loader's own nine-second give-up.
const head = createEl("head");
head.append = (...cs) => {
  for (const c of cs) {
    if (c == null) continue;
    head.children.push(c);
    if (String(c.tagName) === "SCRIPT") {
      queueMicrotask(() => (c._listeners.error || []).forEach((f) => f({})));
    }
  }
};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
  head,
};
globalThis.document = doc;
globalThis.window = { open() {}, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// globalThis.navigator is getter-only in Node, so it has to be redefined.
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", clipboard: null }, configurable: true, writable: true,
});
globalThis.fetch = () => Promise.reject(new Error("offline in tests"));
// A map measures its own box once the card has settled, in a rAF — the v201 door block is
// the first thing in this file to build one. The tests below reach it through a recording
// Leaflet stub (`window.L`), and the stub's map is only built inside this callback's run, so
// without it the whole path would be unreachable here.
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0); // Thu 10 Sep 2026
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");
const { renderSettings } = await import("../admin/js/views/settings.js");
const { courierQuoteSection } = await import("../admin/js/views/courier_quote.js");
// The pop-up primitive itself, and the screen that found this fault on a real phone: the
// pickup-pin card, whose body is the one place in the app that hands showPopup a LIST of
// nodes rather than a single one.
const { showPopup } = await import("../admin/js/ui.js");
const { openPlacePicker } = await import("../admin/js/place_map.js");
// The join key tying an order to a person's saved profile — used below to plant a door she
// keeps directly into the scenario, so a card can be read without a lookup first.
const { keyOf } = await import("../admin/js/customers.js");

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
// The ONE card showPopup builds, as the DOM holds it: layer > card > [head, body]. Every
// assertion below reads the card the app really drew rather than a node held in mid-air.
const popupBody = () => layers["popup-layer"].children[0].children[1];

// The literal words that must never reach the page: a null child in the real DOM.
const strays = (node) =>
  all(node).filter((n) => n.nodeType === 3 && /^\s*(null|undefined)\s*$/.test(n.text)).map((n) => n.text);

// The SAME fault one step along (v195): a thing that is neither a node nor a string is
// converted with String(), so an ARRAY handed to the variadic replaceChildren prints as
// "[object HTMLParagraphElement],[object HTMLDivElement],…". A null is the smallest
// version of this; a list of seven elements is the version that reached her phone.
const strayObjects = (root) => all(root)
  .filter((n) => n.nodeType === 3 && /\[object \w+\]/.test(n.text))
  .map((n) => n.text);

// Focaccia sells every day; the Saturday loaf is marked Saturdays only, and the
// day on screen (Thu 10 Sep) is not one of them — so it is the day's OFF-SALE
// product, which is what puts the "Not counted" line in or leaves it out.
function state(products) {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }],
    products: [
      { id: "p1", name: "Chicken Jerky 100g", limit: 12, active: true, recipe: [], unit: "pouch" },
      // Marked Saturdays only, so on this Thursday it is the one NOT counted.
      { id: "p2", name: "Duck Jerky 100g", limit: 8, active: true, recipe: [], unit: "pouch",
        sellRules: [{ days: [6] }] },
    ],
    orders: [{ id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2 }],
    ingredients: [],
    occasions: [],
    customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [1, 3, 5],
      storefront: {}, wishList: [],
    },
  };
}

test("the day's availability pop-up draws no stray null, with a product counted and one off sale", () => {
  const st = state();
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Set day's availability")._listeners.click[0]();

  const pop = layers["popup-layer"];
  assert.deepEqual(strays(pop), [], "no 'null' text node in the pop-up");
  // Both branches must have really rendered — otherwise this test would pass on an
  // empty screen.
  assert.ok(byClass(pop, "cost-sum-title"), "the add-up grid is there");
  assert.match(all(pop).map((n) => n.textContent).join(" "), /Not counted: Duck Jerky 100g/);
});

test("the pop-up with every product counted draws no stray null either", () => {
  const st = state();
  st.products[1].sellRules = []; // now both sell on the Thursday
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Set day's availability")._listeners.click[0]();

  const pop = layers["popup-layer"];
  assert.deepEqual(strays(pop), [], "the optional 'Not counted' line was left out, not printed as null");
  assert.ok(byClass(pop, "cost-total-row"), "the total row is there");
});

test("the Settings screen draws no stray null when the sample-data card is not shown", () => {
  const root = createEl("div");
  renderSettings(root, state());
  assert.deepEqual(strays(root), [], "no 'null' after the Danger zone card");
});

// ── the courier price panel (v189) ────────────────────────────────────────
//
// The screen where the stray word was actually found: read off the drawn panel at
// 375 pixels, under the last price row of the first booking this app ever made. The
// two optional lines it writes — "why no row can be booked" and the note about the
// fee not going into the charge box — were bare `?: null`.

const COURIER_ORDER = {
  id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2, price: 22,
  customerName: "Mei Ling", whatsapp: "60123456789", fulfillment: "courier",
  address: "12 Jalan Bunga, 10450 Penang", orderDate: "2026-09-25",
};

function courierState() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-30" }],
    products: [], orders: [COURIER_ORDER], ingredients: [], occasions: [], customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4],
      supabase: { url: "https://demo.supabase.co" },
      storefront: { name: "Munchies Furkidz", whatsapp: "016 960 1268" },
      pickupPlace: { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" },
    },
  };
}

// The channel, stood in for the way courier-booking.test.js stands in for it: the
// ONE thing stubbed is the network, never a function under test. Two prices come
// back so the panel really draws its rows — an assertion of "no stray null" over a
// panel that never rendered anything would pass without testing anything.
function stubChannel() {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, opts = {}) => {
    const said = JSON.parse(opts.body || "{}");
    asked.push(said.action);
    const body = said.action === "geocode"
      ? { ok: true, place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga" } }
      : said.action === "vehicles"
        ? { ok: true, services: [{ key: "MOTORCYCLE" }, { key: "CAR" }] }
        : {
          ok: true,
          quotes: [{ quotationId: "q-car", serviceType: "CAR", priceBreakdown: { total: 14, currency: "MYR" },
            stops: [{ stopId: "s-bakery", coordinates: { lat: 5.4141, lng: 100.3288 } },
              { stopId: "s-mei", coordinates: { lat: 5.42, lng: 100.33 } }] }],
          failed: [],
        };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { asked, restore() { globalThis.fetch = real; } };
}

test("the courier price panel prints no 'null' under its last price row", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  let wrap = null;
  let stray = null;
  try {
    wrap = courierQuoteSection({ state: courierState(), orders: [COURIER_ORDER] });
    // On the page, because that is where the panel lives and what it asks about
    // itself: nothing is priced until the wrap is connected, so a test that held it
    // in mid-air would assert "no stray null" over a screen that never drew.
    doc.body.append(wrap);
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();

    // The prices arrive a few microtasks later — exactly the state the panel was in
    // on screen when the word was read off it.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.deepEqual(s.asked, ["geocode", "vehicles", "quote"],
      "the panel asked what it should have asked — so the picture below is not of an empty screen");
    assert.match(wrap.textContent, /RM 14\.00/, "the price row really drew");
    assert.match(wrap.textContent, /Book this trip/, "with its booking press on it");
    stray = strays(wrap);
  } finally {
    // Closing the panel is what she does AND what stops its own clock — and it has to
    // happen even when an assertion above throws, or a failed run would sit until the
    // test timeout with the interval still ticking. A test that hangs instead of
    // failing fast is its own small trap.
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    s.restore();
  }
  assert.deepEqual(stray, [], "no 'null' under the last price row");
});

// ── v216: a price the courier will not book SAYS WHY ──────────────────────
// Her report, 27 Sep 2026: "now the greyed out book button". Each row kept its own,
// shorter list of reasons a price could not be booked — dead, no id, fewer than two
// doors — so a price the courier's own reader refused for any OTHER reason, above all a
// reply that did not come back with the courier's handle for a door, drew an inert button
// and said nothing at all. A greyed control with no words is the same fault as a tap that
// does nothing, so the reason is now asked of the file that refuses the booking and
// printed under the price.
//
// The reply below is the shape that does it: it carries coordinates, so the positional
// fallback is refused too, but not the coordinates this app sent — so `stopIds` comes back
// empty and the price is unbookable while being a real, priced answer.
function stubUnbookableChannel() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const said = JSON.parse(opts.body || "{}");
    const body = said.action === "geocode"
      ? { ok: true, place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga" } }
      : said.action === "vehicles"
        ? { ok: true, services: [{ key: "MOTORCYCLE" }] }
        : {
          ok: true,
          quotes: [{ quotationId: "q-moto", serviceType: "MOTORCYCLE",
            priceBreakdown: { total: 14, currency: "MYR" },
            stops: [{ stopId: "", coordinates: { lat: 1.5, lng: 110.3 } },
              { stopId: "", coordinates: { lat: 1.6, lng: 110.4 } }] }],
          failed: [],
        };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { restore() { globalThis.fetch = real; } };
}

test("a price the courier will not book says why, instead of going quietly inert (v216)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubUnbookableChannel();
  let wrap = null;
  try {
    wrap = courierQuoteSection({ state: courierState(), orders: [COURIER_ORDER] });
    doc.body.append(wrap);
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.match(wrap.textContent, /RM 14\.00/, "the price row really drew — this is a real answer");
    const book = buttonByText(wrap, "Book this trip");
    assert.ok(book, "with its booking press still on it");
    assert.equal(book.disabled, true, "the press is inert — this price cannot be booked");
    assert.match(wrap.textContent, /did not come back with the courier's own handle/,
      "and the reason is ON THE SCREEN, rather than left to be guessed at from a greyed button");
    assert.doesNotMatch(wrap.textContent, /This price can be booked/,
      "nothing on the card claims it can be booked");
  } finally {
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    s.restore();
  }
});

// ── v217: the price press cannot end in silence ───────────────────────────
// Her report, 27 Sep 2026: "the get price from lalamove not responding". The press itself
// answers here — what can go wrong is what it does when something INSIDE it throws. Every
// way out of the work it knew about cleared `busy` and re-armed the button; a way out it did
// not know about left both where they were, so the button stayed grey, the status line stayed
// on its last sentence, and every later press was returned at once by `if (busy …) return`
// with NOTHING said. That is a dead control, which this app has a standing rule against.
//
// The throw below is injected into the courier's own `vehicles` — the one honest way to reach
// it, because `callCourier` is built never to throw, so no shape of reply can produce one.
// What is asserted is not just that the card says something, but that the press she makes
// NEXT really runs: that is the half a latched guard used to take away.
test("a throw inside the price press arms the button again, says so, and does not swallow the next press (v217)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const { lalamove } = await import("../admin/js/couriers/lalamove.js");
  const realVehicles = lalamove.vehicles;
  lalamove.vehicles = async () => { throw new Error("the fleet box fell over"); };
  let wrap = null;
  try {
    wrap = courierQuoteSection({ state: courierState(), orders: [COURIER_ORDER] });
    doc.body.append(wrap);
    // Opening the fold is itself a press that asks — see the note in courier_quote.js.
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    const ask = buttonByText(wrap, "Get a price from Lalamove");
    assert.ok(ask, "the price press is on the card, so the picture below is of a real screen");
    assert.equal(ask.disabled, false, "the button takes a press again — a throw must not leave it dead");
    assert.match(wrap.textContent,
      /The price could not be asked for, and nothing has been priced — the fleet box fell over\./,
      "and the throw is SAID on the card, rather than swallowed behind a grey button");

    // THE HALF A LATCHED GUARD USED TO TAKE AWAY: her next press. With the fleet back, it has
    // somewhere to go — and if `busy` had been left set, this press would have returned at
    // once and this assertion would find no price at all.
    lalamove.vehicles = realVehicles;
    ask._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.match(wrap.textContent, /RM 14\.00/, "the next press really runs, and draws its price");
  } finally {
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    lalamove.vehicles = realVehicles;
    s.restore();
  }
});

// ── v217, the money one: a booking that throws must not take the Book press with it ──
// `jobBusy` is the guard on the press that spends real money, and it was released on the same
// happy paths only. A throw on the way back left it set, so the Book button answered nothing
// for the life of the card. The sentence deliberately does NOT claim nothing was booked: a
// throw between the request and the reply cannot tell her which side of it she is on, so it
// tells her to look. What is asserted here is that the press survives and the card says so.
test("a throw inside the booking press arms Book again, and does not claim nothing was booked (v217)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const { lalamove } = await import("../admin/js/couriers/lalamove.js");
  const realBook = lalamove.book;
  lalamove.book = async () => { throw new Error("the line went dead"); };
  let wrap = null;
  try {
    wrap = courierQuoteSection({ state: courierState(), orders: [COURIER_ORDER] });
    doc.body.append(wrap);
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.match(wrap.textContent, /Book this trip/, "a real, bookable price is on the card");

    // Say yes to the app's own red confirmation, and watch the booking throw behind it.
    buttonByText(wrap, "Book this trip")._listeners.click[0]();
    const confirm = layers["confirm-layer"];
    const yes = buttonByText(confirm, "Book this trip");
    assert.ok(yes, "the app asked before spending money");
    yes._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.match(wrap.textContent,
      /The booking could not be finished — check the trip in Lalamove before pressing again, in case it went through — the line went dead\./,
      "the throw is SAID, and it does not pretend to know whether the trip was booked");
    assert.doesNotMatch(wrap.textContent, /Nothing has been booked|no charge was written/,
      "and it never claims the money did not move, because it cannot know that");

    // The guard came back with it: the dialog is put up again on the next press rather than
    // the press being swallowed by a set `jobBusy`.
    buttonByText(wrap, "Book this trip")._listeners.click[0]();
    assert.ok(buttonByText(layers["confirm-layer"], "Book this trip"),
      "the next press really runs — a latched guard would have returned at once");
  } finally {
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    lalamove.book = realBook;
    s.restore();
  }
});

// ── the two doors on an order card (v197, reversed at v209) ───────────────
//
// The switch is drawn by `paintEnds()`, which every change to the doorstep repaints, and
// this is one of the two screens it appears on. Read off the drawn card rather than off the
// function, for the same reason as the panel above: what is checked is what she sees.
//
// The rule that replaces a "dismissed" flag is still here — the control is drawn only while
// the pin the customer dropped differs from the door kept for them, so PRESSING it is the
// thing that changes it, and nothing has to be stored about a refusal.
//
// SINCE v209 THE DOOR IS THEIRS WHERE THEY LEFT ONE. A customer's pin on an order beats the
// door she keeps, unless that door is her own hand — so the case below is a door kept with no
// record of her hand (as every door saved before v209 reads), and the card opens with the
// customer's own pin in use and the kept door on offer. Pressing it puts HER door back and
// FLIPS the control rather than ending it, because the two still disagree.

test("a kept door with no record of her hand loses to the customer's pin, with no stray 'null' (v209)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const st = courierState();
  // A door she ALREADY keeps for this customer, at a different point from the pin below —
  // and with no `from` on it, which is how a door saved before v209 reads.
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga, 10450 Penang" },
  }];
  const order = {
    ...COURIER_ORDER,
    customerPlace: { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house", at: "2026-09-25T10:00:00.000Z" },
  };
  let wrap = null;
  let offered = null;
  try {
    wrap = courierQuoteSection({ state: st, orders: [order] });
    doc.body.append(wrap);
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    offered = byClass(wrap, "pin-offer");
    assert.ok(offered, "the switch block is drawn on the order card");
    assert.equal(offered.hidden, false, "and it is shown");
    // Their pin is the door in use — the card says so, and the kept door is what is offered.
    assert.match(offered.textContent, /Mei Ling's own pin is in use/);
    assert.match(offered.textContent, /The doorstep you keep for them is a different spot/);
    assert.match(wrap.textContent, /Sri Bunga guard house/,
      "and the doorstep line itself names the pin the customer dropped");
    assert.equal((st.customers[0] || {}).place.lat, 5.42,
      "the door she keeps is untouched until she presses");
    const press = buttonByText(offered, "Use the door I keep instead");
    assert.ok(press, "with one press to put her own door back");
    assert.deepEqual(strays(wrap), [], "and nothing on the card prints 'null'");

    press._listeners.click[0]();
    const kept = (st.customers || [])[0] || {};
    assert.equal((kept.place || {}).lat, 5.42, "her own door is the one in use now");
    assert.equal((kept.place || {}).from, "hand",
      "recorded as her own hand, so it stays put and their pin cannot move it");
    assert.equal(offered.hidden, false, "the control is still there — the two doors still disagree");
    assert.match(offered.textContent, /Mei Ling pinned a different spot this time/);
    assert.ok(buttonByText(offered, "Use the customer's pin instead"),
      "and it now points the other way, at the pin they dropped");
    assert.deepEqual(strays(wrap), [], "still no 'null' on the card once it is pressed");
  } finally {
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    s.restore();
  }
});

// THE SAME SWITCH, AFTER A RESET (v238). Her pin is the door, she replaced a stale pin of
// theirs from the address, and the switch now offers THEIR pin back — one press that undoes
// it. Two things are checked that a reset could otherwise get wrong: the sentence must say a
// reset happened rather than that the customer moved (they did not, and the card must not
// invent a fact about a person), and the press is reversible in one step rather than one-way.
test("after a reset the offer points back at their pin, and says a reset rather than a move (v238)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  // The row a reset leaves behind: her point, stamped "reset", carrying the pin it replaced.
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: {
      lat: 5.4172, lng: 100.3311, label: "12 Jalan Bunga, 10450 Penang",
      from: "reset", at: "2026-09-28T10:00:00.000Z",
      against: { lat: 5.4299, lng: 100.3399 },
    },
  }];
  const order = {
    ...COURIER_ORDER,
    customerPlace: { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house", at: "2026-09-25T10:00:00.000Z" },
  };
  const doorSlot = createEl("div");
  let wrap = null;
  try {
    wrap = courierQuoteSection({ state: st, orders: [order], doorSlot });
    doc.body.append(doorSlot);
    doc.body.append(wrap);
    buttonByText(wrap, "Get a delivery price")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    // The reset stands: it beats the pin it replaced, so HER door is the one in force — and it
    // still may be asked up again, which is the whole reason a reset is not recorded as "hand".
    assert.match(doorSlot.textContent, /the door you keep for Mei Ling/,
      "the door on screen is the one the reset put there, not the pin they dropped");
    assert.equal(lookBtnOn({ doorSlot }).hidden, false,
      "and a reset stays re-askable — recorded as her hand it would strand her on a road answer");
    assert.equal(lookBtnOn({ doorSlot }).textContent, "Look this address up again",
      "under the plain label, because there is no customer pin being replaced here");

    const offered = byClass(wrap, "pin-offer");
    assert.ok(offered && !offered.hidden, "the two doors disagree, so the switch is on offer");
    assert.match(offered.textContent, /You reset this door from the address on the order/,
      "and it says a reset happened, which is what happened");
    assert.doesNotMatch(offered.textContent, /pinned a different spot this time/,
      "never that the customer moved — they did not, and the card may not invent that about a person");
    const press = buttonByText(offered, "Use the customer's pin instead");
    assert.ok(press, "with one press back to the pin they dropped");

    press._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    const kept = st.customers[0].place;
    assert.equal(kept.lat, 5.4299, "their own point is the door again, in both numbers");
    assert.equal(kept.lng, 100.3399, "not just the one");
    assert.equal(kept.from, "customer", "recorded as a copy of their pin, so a new one of theirs still wins");
    assert.equal(kept.against, undefined, "and the reset's stamp is gone with the door it was about");
    assert.equal(offered.hidden, true, "the two doors agree again, so there is nothing left to switch");
    assert.equal(lookBtnOn({ doorSlot }).textContent, "Reset the pin from the address",
      "and the press is back under the reset label, because their pin is the one it would replace");
    assert.deepEqual(strays(wrap), [], "and nothing on the card prints 'null'");
  } finally {
    const hide = wrap && buttonByText(wrap, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    if (wrap) wrap.parentNode = null;
    doorSlot.parentNode = null;
    s.restore();
    delete globalThis.window.L;
  }
});

// ── the pin window of last resort opens on the door in force (v210) ───────
//
// FOUND AT v209 while answering her own question — "if the customer didn't pin
// correctly, are you able to help them pin correctly?" — and not by a test, because
// this path had none. Two things were keyed off whether SHE keeps a door rather than
// off which door is in force: the picker opened on HER kept door, and its sentence
// promised a lookup. On an order whose door is the customer's own pin that is the wrong
// point under the wrong sentence — and this picker is reached precisely when the map
// cannot be dragged on, so it is the only screen left for this customer.
//
// Asserted on the drawn card, and at BOTH ends: the sentence above the map, and the
// point the window is really standing on — read by pressing the window's own Keep and
// looking at the door that got written, not by reading a variable.

test("the pin window opens on the door in force and names that door — the customer's pin (v210)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const st = courierState();
  // A door she already keeps, in a different place — with no `from`, as a pre-v209 door reads.
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga, 10450 Penang" },
  }];
  const order = {
    ...COURIER_ORDER,
    customerPlace: { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house", at: "2026-09-25T10:00:00.000Z" },
  };
  // No map, so the press takes the picker route — exactly the route a phone reaches when
  // its tiles never arrive. The door block lives in the host's own slot (v201), so it has
  // to be mounted the way orders.js mounts it or there is no press to make.
  globalThis.window.L = null;
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);

    const open = buttonByText(mounted.doorSlot, "Move this pin");
    assert.ok(open, "the card offers the pin window");
    open._listeners.click[0]();
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    assert.match(body.textContent, /This is the customer's own pin/,
      "the window says the point it is standing on is the pin the customer dropped");
    assert.doesNotMatch(body.textContent, /Look the address up/,
      "and it does not promise a lookup the customer has already answered");

    // The point itself, read off the door the window writes. Standing on the customer's
    // pin, Keep writes THAT point; standing on the door she keeps, it would write 5.42.
    const keep = buttonByText(body, "Use this spot");
    assert.ok(keep, "the window's own Keep is on the card");
    assert.equal(keep.disabled, false, "and it is live, because the window stands on a point");
    keep._listeners.click[0]();

    const kept = (st.customers || [])[0] || {};
    assert.equal((kept.place || {}).lat, 5.4299,
      "keeping it writes the customer's own pin, not the door she keeps");
    assert.equal((kept.place || {}).lng, 100.3399, "and its own longitude");
    assert.equal((kept.place || {}).from, "hand",
      "a pick in this window is her own hand, so it sticks against their pin from now on");
    assert.deepEqual(strays(body), [], "and nothing on the window prints 'null'");
    assert.deepEqual(strayObjects(body), [], "nor an element stringified into a line");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("with no pin of the customer's, the pin window looks the address up and says so (v210)", async () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
  const s = stubChannel();
  const st = courierState();
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga, 10450 Penang" },
  }];
  globalThis.window.L = null;
  let mounted = null;
  try {
    mounted = mountDoor(st, COURIER_ORDER);
    await settle(4);

    const open = buttonByText(mounted.doorSlot, "Move this pin");
    assert.ok(open, "the card offers the pin window");
    open._listeners.click[0]();
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    assert.match(body.textContent, /Look the address up/,
      "with no pin of theirs the window still offers the lookup, as it always has");
    assert.doesNotMatch(body.textContent, /This is the customer's own pin/,
      "and does not claim a pin nobody dropped");

    const keep = buttonByText(body, "Use this spot");
    keep._listeners.click[0]();
    const kept = (st.customers || [])[0] || {};
    assert.equal((kept.place || {}).lat, 5.42,
      "keeping it writes the door she keeps — the one the window was standing on");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

// ── the dot does not move when she asks for a price (v208) ────────────────
//
// Her report four times over — "the pin still wrong" — and when she was asked to point at
// it: "the dot is in the wrong place", on her app, on the order. Measured, this is what the
// card did. It opened with the dot ON the customer's own pin (the test above reads 5.4299)
// and then MOVED it the moment a price was asked for: `ask()` looked the typed address up
// and kept the geocoder's answer, throwing the customer's own point away. A geocoder
// answers a Malaysian address with the STREET, not the house — so the dot landed mid-road.
//
// The card was already showing the customer's pin as the door, because `doorSpot` falls
// back to it. So the press was this app answering "where is this order" twice, with two
// different answers — the contradiction `store/geo.js` names in its own header. The
// customer's pin is the point, the address on the order is the words (v207), and the
// lookup is spent only when the customer left no pin at all.

test("the dot stays on the customer's own pin when a price is asked for, and no lookup is spent (v208)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  let mounted = null;
  let stray = null;
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);
    assert.equal(leaf.rec.markers[0].latlng.lat, 5.4299, "the card opens with the dot on the customer's own pin");

    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();

    assert.ok(!s.asked.includes("geocode"),
      "no lookup was spent — the customer's own pin already answers where this door is");
    assert.equal((st.customers[0] || {}).place.lat, 5.4299, "the door kept is the customer's pin, not a geocoder's guess");
    assert.equal((st.customers[0] || {}).place.lng, 100.3399, "both numbers, so it is the same point and not a neighbour");
    assert.equal((st.customers[0] || {}).place.label, "12 Jalan Bunga, 10450 Penang",
      "named with the address on the order (v207), not with the geocoder's row");
    assert.equal((st.customers[0] || {}).place.from, "customer",
      "and it is recorded as THEIRS (v209) — it is a copy of their pin, so a customer who re-pins still wins");
    assert.equal(leaf.rec.markers[0].latlng.lat, 5.4299, "and the dot never moved — the price is for the door on screen");
    assert.match(mounted.wrap.textContent, /RM 14\.00/, "a price still arrived, so this is not a card that did nothing");
    stray = strays(mounted.wrap);
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
    s.restore();
  }
  assert.deepEqual(stray, [], "no 'null' on the card");
});

// ── the pop-up primitive, and the pickup-pin card (v195) ───────────────────
//
// The fault at the level it was at: `body.replaceChildren(makeBody(...))` handed a
// non-node to a variadic DOM method. Every card in the app goes through this one line,
// so it is asserted here as well as on the screen that found it.

test("a card body handed back as a LIST is drawn, not printed (v195)", () => {
  showPopup("A card", () => [createEl("p"), createEl("div"), createEl("p")]);

  const body = popupBody();
  assert.equal(body.children.length, 3, "three elements drawn, not one stringified array");
  assert.deepEqual(body.children.map((c) => c.tagName), ["P", "DIV", "P"], "the elements themselves");
  assert.deepEqual(strayObjects(body), [], "and nothing printed as '[object …]'");
});

test("a card body handed back as ONE node is still drawn exactly as before (v195)", () => {
  // The other side of the same line, so this cannot have been fixed by making the 37
  // cards that return a single node worse than they were.
  showPopup("A card", () => createEl("div"));

  const body = popupBody();
  assert.equal(body.children.length, 1, "one node, one child");
  assert.equal(body.children[0].tagName, "DIV", "and it is the node the body built");
  assert.deepEqual(strayObjects(body), [], "with nothing printed as '[object …]'");
});

test("the pickup-pin card draws its controls even when no map can load (v195)", async () => {
  // The screen her pin was going on, and it had no test of any kind before this — which
  // is the whole reason a card with nothing on it reached her phone. The map cannot load
  // in an offline suite, and that is the branch worth asserting: a picker that dead-ends
  // because a third party is unreachable would be worse than no map at all. Every control
  // below lives in the body, so all three are lost to the array, not just the map.
  const close = openPlacePicker({
    state: courierState(),
    title: "The bakery's pickup pin",
    address: "12 Jalan Bunga, 10450 Penang",
    onPick: () => {},
  });
  // The loader's own failure lands on a microtask — see the head shim above.
  await new Promise((r) => setTimeout(r, 0));

  const body = popupBody();
  assert.ok(buttonByText(body, "Look it up"), "the address lookup is on the card");
  assert.ok(buttonByText(body, "Use these numbers"), "and the coordinates fallback");
  assert.ok(buttonByText(body, "Use this spot"), "and the press that keeps the pin");
  assert.match(body.textContent, /The map is not available right now/,
    "the map's failure is said in words rather than left as a blank card");
  // WHAT THE LINE ABOVE HAS ALWAYS POINTED AT (v266). "Type the coordinates below instead"
  // was written over a box that was open whether or not the map had failed, so the sentence
  // was true by accident. It is now true by construction, and this is the assertion that says
  // so: the sentence and the box it names appear together, on the one branch either is for.
  assert.equal(byClass(body, "coords-block").hidden, false,
    "and the numbers it names are OPEN, rather than promised and absent");
  assert.equal(buttonByText(body, "Have a Google Maps link?").hidden, true,
    "with its door shut, because the box behind it is already out");
  assert.deepEqual(strayObjects(body), [], "no element printed as '[object …]'");
  close();
});

// ── the numbers box, out of the way until it is the answer (v266) ─────────
//
// The other side of the same block: on the ordinary day, when the map loads. It stood open
// under every map in the app's fastest window, and her words on it were "when i see the
// button, i might self have to ask, i dont know what will happen or what will happen if i
// din press that button, these create confusion." So it waits behind one press that says
// what it is, and comes out when the map is what failed. The block's own class is the
// handle: the shim walks hidden children like any other, so absence must be asserted as the
// hidden flag and never as absence from the tree.

const coordsBlockOf = (body) => byClass(body, "coords-block");

// The ordinary day, said in the shortest way the loader understands: a `window.L` already
// present makes `loadLeaflet()` resolve rather than reach for a third party's script, so
// the failure branch this suite is otherwise built around is not the one under test.
async function openPickerWithAMap() {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const close = openPlacePicker({
    state: courierState(),
    title: "The bakery's pickup pin",
    address: "12 Jalan Bunga, 10450 Penang",
    onPick: () => {},
  });
  await settle();
  return { leaf, close };
}

test("with a map on screen, the numbers box waits behind its own door (v266)", async () => {
  const { leaf, close } = await openPickerWithAMap();
  let stray = null;
  try {
    assert.equal(leaf.rec.maps.length, 1,
      "the map loaded, so this is the day the block is not for — without this the test below could pass on a card that failed");

    const body = popupBody();
    assert.equal(coordsBlockOf(body).hidden, true, "so its four lines of fallback are not on the card");
    assert.ok(buttonByText(body, "Have a Google Maps link?"), "and the way to them is");
    assert.ok(!body.textContent.includes("The map is not available right now"),
      "with nothing on the card claiming the map failed");
    stray = strays(body);
  } finally {
    close();
    delete globalThis.window.L;
  }
  assert.deepEqual(stray, [], "no 'null' on the card");
});

test("one press brings the numbers box out, so a link a customer sent still has somewhere to go (v266)", async () => {
  // WHY THE DOOR IS KEPT AT ALL. Hiding the block outright on a working map would take away
  // the only place in the app to put the Google Maps link a customer sends — the most
  // accurate point anybody ever gives her. The press costs one tap on the day she has one,
  // and nothing at all on the day she does not.
  const { close } = await openPickerWithAMap();
  let stray = null;
  try {
    const body = popupBody();
    const door = buttonByText(body, "Have a Google Maps link?");
    door._listeners.click[0]();

    assert.equal(coordsBlockOf(body).hidden, false, "the numbers box is out");
    assert.equal(door.hidden, true, "and the door that opened it is gone, so there is one of them and not two");
    assert.ok(buttonByText(body, "Use these numbers"), "with the press the block exists for");
    assert.ok(buttonByText(body, "Use this spot"), "and the Keep below it, untouched");
    stray = strays(body);
  } finally {
    close();
    delete globalThis.window.L;
  }
  assert.deepEqual(stray, [], "no 'null' on the card");
});

// ── the matches the lookup used to throw away (v198) ──────────────────────
//
// The geocoder sends several candidates and this card used to be handed one of them —
// the first — so a pin on the wrong street was hers to notice and drag. The rows below
// are the other candidates, offered. Two things are load-bearing and both are asserted
// on the DRAWN page rather than on the code: that a row press moves the pin to THAT
// candidate and not to the first, and that the rows are real elements rather than the
// stringified array v195 shipped on this same card.

// The lookup's own reply, and the shape of it is the point: `place` is the first of
// `places`, because the quote card and the delivery run still take one answer and have
// no list to choose from.
const THREE_MATCHES = {
  ok: true,
  place: { lat: 5.4, lng: 100.3, label: "Jalan Bunga, George Town, 10450" },
  places: [
    { lat: 5.4, lng: 100.3, label: "Jalan Bunga, George Town, 10450" },
    { lat: 5.41, lng: 100.31, label: "Jalan Bunga, Butterworth, 12000" },
    { lat: 5.42, lng: 100.32, label: "Jalan Bunga Raya, Bayan Lepas, 11900" },
  ],
};

function stubGeocode(reply) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, opts = {}) => {
    asked.push(JSON.parse(opts.body || "{}").action);
    const body = reply;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { asked, restore() { globalThis.fetch = real; } };
}

const signIn = () => {
  globalThis.localStorage.getItem = (k) => (k === "bakeadmin.supabase"
    ? JSON.stringify({ access_token: "t", expires_at: Date.now() + 3600_000 }) : null);
};

// The rows off the drawn card. Re-read after every press, because the panel repaints
// itself and the nodes it was showing are then orphans — asserting against the first
// read would be asserting against a tree nobody is looking at.
const matchRows = (body) => all(body).filter((n) => String(n.className).includes("sugg-row"));
const rowLine = (row, i) => {
  const main = row.children[0];
  const line = main && main.children[i];
  return line ? line.textContent : "";
};

// ── the window says which point it is standing on, map or no map (v210) ───
//
// Found while measuring the v210 fix in a real browser at 375px, on the window a phone
// with no map is left looking at. Opened ON a door already in force, it stood on that
// point — its Keep was live and wrote the right door — while the line above the button
// still read "No spot chosen yet.", which was only ever corrected when the window's OWN
// map arrived. That is a right point under wrong words, on the one phone this window
// exists for; the two halves of the card have to agree from the first paint.
test("a window opened on a door already in force says so before any map arrives (v210)", async () => {
  signIn();
  let withStart = null;
  let withoutStart = null;
  let stray = null;
  try {
    // No map: the file's default condition, where the head shim fails every script.
    withStart = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep", address: "12 Jalan Bunga, 10450 Penang",
      start: { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house" },
      onPick: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    const body = popupBody();
    assert.match(body.textContent, /Pinned at 5\.42990, 100\.33990/,
      "the window stands on the door in force and says which point that is");
    assert.doesNotMatch(body.textContent, /No spot chosen yet/,
      "and does not tell her nothing is chosen while the Keep beside it is live");
    assert.equal(buttonByText(body, "Use this spot").disabled, false,
      "the Keep is live, because the window is standing on a point");
    stray = strayObjects(body);
    withStart();
    withStart = null;

    // And the other half, unchanged: with nothing to stand on there is no spot and the
    // line says so, which is what makes the first assertion above a real measurement
    // rather than a line that is simply always printed.
    withoutStart = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep", address: "12 Jalan Bunga, 10450 Penang",
      onPick: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    const empty = popupBody();
    assert.match(empty.textContent, /No spot chosen yet/, "with no start the line still says nothing is chosen");
    assert.equal(buttonByText(empty, "Use this spot").disabled, true, "and the Keep is inert, as it must look");
  } finally {
    if (withStart) withStart();
    if (withoutStart) withoutStart();
  }
  assert.deepEqual(stray, [], "and no element is printed as '[object …]'");
});

test("the lookup's other matches are offered, and pressing one moves the pin to THAT one (v198)", async () => {
  signIn();
  const s = stubGeocode(THREE_MATCHES);
  let close = null;
  let stray = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: "12 Jalan Bunga", onPick: () => {} });
    // The map loader's failure lands on a microtask — see the head shim above. This card
    // is the offline one on purpose: the chooser must work with no map at all.
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.deepEqual(s.asked, ["geocode"], "one press is one lookup");
    assert.equal(matchRows(body).length, 3, "three matches, three rows");
    assert.deepEqual(matchRows(body).map((r) => rowLine(r, 0)), ["✓ Jalan Bunga", "Jalan Bunga", "Jalan Bunga Raya"],
      "each row leads with what the place is — and the pin is on the first match, so the first row is the ticked one");
    assert.deepEqual(matchRows(body).map((r) => rowLine(r, 1)),
      ["George Town, 10450", "Butterworth, 12000", "Bayan Lepas, 11900"],
      "with where it is on the second line, cut from the geocoder's own label");
    assert.match(body.textContent, /and 2 more below/,
      "the line under the button says the list is there, so it cannot be missed");

    // THE ASSERTION THIS TEST EXISTS FOR. The third row, so an app that quietly kept the
    // first match — which is what this card did before v198 — cannot pass by accident.
    matchRows(body)[2]._listeners.click[0]();
    assert.match(body.textContent, /Pinned at 5\.42000, 100\.32000/, "the pin is on the third match");
    assert.doesNotMatch(body.textContent, /Pinned at 5\.40000, 100\.30000/, "and NOT still on the first one");
    assert.match(body.textContent, /Found: Jalan Bunga Raya, Bayan Lepas, 11900/, "the line agrees with the pin");

    // THE LIST PUTS ITSELF AWAY ON A PICK (v256), because it now FLOATS over the map (see
    // .sugg-drop) rather than shoving the card down: a list that stayed up would leave the
    // map covered, and the map is the one thing she needs next — to check the pin landed on
    // the right door. So the tick is no longer re-derived by a repaint; the row she picked
    // left with the list, and the LINE is what still names the answer.
    assert.equal(matchRows(body).length, 0, "picking a row puts the list away, uncovering the map");
    assert.match(body.textContent, /Found: Jalan Bunga Raya, Bayan Lepas, 11900/,
      "the line still names the place the pin is on");
    assert.doesNotMatch(body.textContent, /and 2 more below/,
      "and stops promising rows below, because none are on the screen");

    // TRYING ANOTHER IS STILL ONE PRESS — and it is the one thing v256 asked for in exchange:
    // a second press re-asks, which leaves the pin on the new lookup's own best match.
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.deepEqual(s.asked, ["geocode", "geocode"], "a second press is a second lookup");
    assert.equal(matchRows(body).length, 3, "the list comes back");
    assert.deepEqual(matchRows(body).map((r) => rowLine(r, 0)), ["✓ Jalan Bunga", "Jalan Bunga", "Jalan Bunga Raya"],
      "and the tick is where the pin actually is — re-derived from the pin, not remembered from a tap");
    stray = strayObjects(body);
  } finally {
    if (close) close();
    s.restore();
  }
  assert.deepEqual(stray, [], "no element printed as '[object …]' — the fault v195 shipped on this very card");
});

test("the picker's list hangs off the button's own row, so it drops from her thumb (v256)", async () => {
  signIn();
  const s = stubGeocode(THREE_MATCHES);
  let close = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: "12 Jalan Bunga", onPick: () => {} });
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    const rows = matchRows(body);
    assert.equal(rows.length, 3, "the list is up, so this is measuring the thing it claims to");
    const panel = rows[0].parentNode;
    const find = buttonByText(body, "Look it up");
    const row = find.parentNode;

    // THE STRUCTURE IS THE FIX. `.sugg-drop` is `position: absolute; top: 100%`, so it only
    // floats under her thumb if the row it hangs from is the row that holds the button —
    // as a sibling, it is in the flow again and takes the 223 pixels that shove the map.
    assert.ok(String(row.className).includes("btn-row"), "the lookup button sits in its own row");
    assert.equal(panel.parentNode, row,
      "the list is not inside the button's row, so it is back in the flow, taking space off the card and moving everything under it");
    assert.ok(String(row.className).includes("sugg-host"),
      "the button's row lost .sugg-host, so the floating list has no box to hang from");
    assert.ok(String(panel.className).includes("sugg-drop"),
      "the list lost .sugg-drop, which is the only thing keeping it out of the flow");
  } finally {
    if (close) close();
    s.restore();
  }
});

// ── "this is the road, not the house" (v211) ──────────────────────────────
//
// Her report: she types "23 Jalan Seang Tek" and the only thing on offer is "Seang Tek
// Road, George Town, 10400" — and Seang Tek is a long road. The pin landed on her street
// and nothing on the screen said so: the line read as a fact about her house, over a point
// that was not her door. Her words for the fix: "make it say this is the road not the house".
//
// Asserted at the one place she reads a lookup's answer, and at both ends — the sentence
// says so when the number is missing, and stays quiet when it is not, which is what makes
// the first assertion a measurement rather than a line that is always printed.

test("a lookup that could only find the road says so, and one that found the house does not (v211)", async () => {
  signIn();
  const reply = (label) => ({ ok: true, place: { lat: 5.4141, lng: 100.3288, label } });
  let close = null;
  let s = null;
  try {
    // The road only. She typed a house and the answer does not contain it.
    s = stubGeocode(reply("Seang Tek Road, George Town, 10400"));
    close = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep",
      address: "23 Jalan Seang Tek", onPick: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    let body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.match(body.textContent, /Found: Seang Tek Road, George Town, 10400/,
      "the answer is still named, exactly as before — nothing here is a gate");
    assert.match(body.textContent, /The lookup found the road, not number 23 — drag the pin to the door\./,
      "and the line says the pin is the street and not her door, which is the whole of the fix");
    close(); close = null;
    s.restore(); s = null;

    // The same lookup where the answer DOES contain the number. This is the half that keeps
    // the sentence worth reading: a warning on every lookup is not a warning.
    s = stubGeocode(reply("23, Jalan Seang Tek, George Town, 10400"));
    close = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep",
      address: "23 Jalan Seang Tek", onPick: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.match(body.textContent, /Found: 23, Jalan Seang Tek, George Town, 10400/, "the house was found");
    assert.doesNotMatch(body.textContent, /not number/, "so nothing is claimed about a missing house");
    close(); close = null;
    s.restore(); s = null;

    // And an address with no house number in it asks for a road. A road is what it gets, and
    // there is nothing to warn about — she can still look a street up.
    s = stubGeocode(reply("Seang Tek Road, George Town, 10400"));
    close = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep",
      address: "Jalan Seang Tek, George Town", onPick: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.match(body.textContent, /Found: Seang Tek Road/, "the street is found");
    assert.doesNotMatch(body.textContent, /not number/, "and no house number was asked for, so none is missed");
  } finally {
    if (close) close();
    if (s) s.restore();
  }
});

test("a lookup with one match draws no list, and still lands that match (v198)", async () => {
  // The old server's reply, and the shape of the app on the day it is pushed but the
  // courier function has not been redeployed — `place` and nothing else. A single
  // candidate is not a choice: the line above it already names it, and a one-row list
  // would be a control with nothing to choose between.
  signIn();
  const s = stubGeocode({ ok: true, place: { lat: 5.4, lng: 100.3, label: "12 Jalan Bunga" } });
  let close = null;
  let stray = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: "12 Jalan Bunga", onPick: () => {} });
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.equal(matchRows(body).length, 0, "one match is not a list");
    assert.match(body.textContent, /Found: 12 Jalan Bunga/, "and it is still named");
    assert.match(body.textContent, /Pinned at 5\.40000, 100\.30000/, "and still lands on the map, exactly as before");
    stray = strayObjects(body);
  } finally {
    if (close) close();
    s.restore();
  }
  assert.deepEqual(stray, []);
});

test("a second lookup that finds nothing takes the first one's matches off the card with it (v198)", async () => {
  // The failure path is the one that proves the panel is emptied BEFORE the ask rather
  // than after it. A lookup that succeeds repaints the list anyway, so it would hide a
  // missing clear; a lookup that MISSES paints nothing at all, and returns early. Without
  // the clear, "That address was not found" would be drawn with three cheerful matches
  // sitting under it — the card contradicting itself, which is worse than either sentence
  // alone. One press too many to remember to guard is why the clear is at the top.
  signIn();
  let call = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    call++;
    const body = call === 1
      ? THREE_MATCHES
      : { ok: false, reason: "That address was not found. Put the pin on the map instead." };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  let close = null;
  let stray = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: "12 Jalan Bunga", onPick: () => {} });
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    const find = () => buttonByText(body, "Look it up")._listeners.click[0]();
    find();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.equal(matchRows(body).length, 3, "three the first time");

    find();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
    assert.match(body.textContent, /was not found/, "the miss is said");
    assert.equal(matchRows(body).length, 0, "and the first lookup's matches went with it");
    assert.doesNotMatch(body.textContent, /and 2 more below/, "the old count went too, rather than counting rows that are gone");
    stray = strayObjects(body);
  } finally {
    if (close) close();
    globalThis.fetch = real;
  }
  assert.deepEqual(stray, []);
});

// ── a tap on the picker's map moves nothing (v264, 1 Oct 2026) ─────────────
//
// Her words: "click on the map should not move the pin, only dragging the pin will." The
// picker was the one card where a tap was live from the moment the map arrived — no unlock,
// nothing to press first — and it did TWO things at once: it put the pin wherever the finger
// landed and pulled the view onto it. Two answers to one accidental contact with a 200px
// strip inside a card she scrolls, on a card whose own line already promises the drag
// ("Look the address up, then drag the pin to the exact door").
//
// Driven through the recorded Leaflet rather than read off the source, and on the DRAWN
// card's own words — `Pinned at …` is what tells the truth about where the window thinks it
// is standing, and it is the line she reads.
//
// Long enough for the loader's microtask, the map's own build and the rAF that measures the
// box — the same wait the door block below uses, spelled out here rather than reaching for
// the later `settle` so that this section reads on its own.
const mapSettle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 1));
};

test("a tap on the picker's map does not move a pin that is already there (v264)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let close = null;
  let stray = null;
  try {
    close = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep", address: "12 Jalan Bunga, 10450 Penang",
      start: { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house" },
      onPick: () => {},
    });
    await mapSettle();
    const map = leaf.rec.maps[0];
    const marker = leaf.rec.markers[0];
    const body = popupBody();
    assert.ok(map && marker, "the card is standing on the door it was opened on");
    assert.match(body.textContent, /Pinned at 5\.42990, 100\.33990/, "and says which point that is");

    map.handlers.click({ latlng: { lat: 5.4172, lng: 100.3311 } });
    assert.deepEqual({ lat: marker.latlng.lat, lng: marker.latlng.lng }, { lat: 5.4299, lng: 100.3399 },
      "a tap leaves the pin exactly where it was");
    assert.match(body.textContent, /Pinned at 5\.42990, 100\.33990/,
      "and the card still says so, rather than naming a point the pin is not on");
    assert.doesNotMatch(body.textContent, /5\.41720/,
      "the tap's own numbers reach nothing — not the line, not the pin");

    // The other half: the drag is what moves it, and it is the ONLY thing that does.
    marker.handlers.dragend({ target: { getLatLng: () => ({ lat: 5.4172, lng: 100.3311 }) } });
    assert.match(body.textContent, /Pinned at 5\.41720, 100\.33110/,
      "dragging the pin is the way, and it still moves the pin and the line together");
    stray = strayObjects(body);
  } finally {
    if (close) close();
    delete globalThis.window.L;
  }
  assert.deepEqual(stray, []);
});

test("a tap on the picker's map still places the FIRST pin, when the map has none (v264)", async () => {
  // Not an exception to her rule, and worth its own test because it is the case the picker
  // is mostly opened in: an order with no point at all, so no marker, so nothing to drag.
  // A tap there cannot MOVE a pin — there is none — it places the first one.
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let close = null;
  try {
    close = openPlacePicker({
      state: courierState(), title: "Mei Ling's doorstep", address: "12 Jalan Bunga, 10450 Penang",
      onPick: () => {},
    });
    await mapSettle();
    const map = leaf.rec.maps[0];
    const body = popupBody();
    assert.equal(leaf.rec.markers.length, 0, "the card opens with nothing pinned");
    assert.match(body.textContent, /No spot chosen yet/, "and says so");

    map.handlers.click({ latlng: { lat: 5.4172, lng: 100.3311 } });
    assert.match(body.textContent, /Pinned at 5\.41720, 100\.33110/, "the tap places the first point");
    assert.equal(leaf.rec.markers.length, 1, "and draws the pin that goes with it");
    assert.equal(buttonByText(body, "Use this spot").disabled, false, "so the press that keeps it is live");

    map.handlers.click({ latlng: { lat: 5.6, lng: 100.5 } });
    assert.match(body.textContent, /Pinned at 5\.41720, 100\.33110/,
      "and the very next tap moves nothing, because now there is a pin for the rule to protect");
  } finally {
    if (close) close();
    delete globalThis.window.L;
  }
});

// ── the door the driver is sent to (v201, 26 Sep 2026) ────────────────────
//
// Her report: "there is no customer enter address in the form, so there is no way we can
// check what customer pin is right, when in that window." The box she means is the Note /
// tracking one, and the reason a wrong pin costs her there is that a courier is given a
// POINT, not an address — and that box is where the trip is priced and booked.
//
// The block is asserted rather than merely read, for the reason this whole file exists: the
// last card on this section written without a test reached her phone with nothing on it at
// all (v195). And it is asserted THROUGH A RECORDING LEAFLET, because the two things that
// matter most about it — that the map is read-only until she presses the button, and that a
// moved pin is a WRITE — are invisible from the outside otherwise.

// A handler object, the way Leaflet really models these: `dragging`, `touchZoom`,
// `doubleClickZoom` and `boxZoom` are things that get switched on and off, not options.
const toggle = (name, on = false) => ({
  name, on: !!on, enable() { this.on = true; }, disable() { this.on = false; },
});

// Records what the map was ASKED FOR. Not an approximation of Leaflet — every assertion
// below reads one of these recordings, so a call the block stops making is a test that goes
// red rather than a test that keeps passing over a map that is no longer locked.
function makeLeaflet() {
  const rec = { maps: [], views: [], tiles: [], markers: [] };
  const L = {
    map(container, opts) {
      const m = {
        container, opts, removed: false, sized: 0, handlers: {}, zoom: 16,
        // Built on or off according to the OPTION, as Leaflet builds them — and every later
        // enable/disable is the app's. Since v238 that distinction is load-bearing: the zoom
        // handlers are switched on at build and never flipped again, so a stub that started
        // every handler at `false` would show a map with no zoom at all and call it correct.
        dragging: toggle("map drag", !!opts.dragging), touchZoom: toggle("pinch", !!opts.touchZoom),
        doubleClickZoom: toggle("double tap", !!opts.doubleClickZoom), boxZoom: toggle("box", !!opts.boxZoom),
        setView(center, zoom) { m.center = center; m.zoom = zoom; rec.views.push({ center, zoom }); return m; },
        on(evt, cb) { m.handlers[evt] = cb; return m; },
        // Faithful about the difference that matters here: off() with no arguments lets go
        // of every handler, off("click", fn) lets go of that one. A stub that ignored the
        // arguments would leave a tap handler recorded on a map that had been locked again.
        off(evt, cb) {
          if (evt === undefined) m.handlers = {};
          else if (cb ? m.handlers[evt] === cb : true) delete m.handlers[evt];
          return m;
        },
        remove() { m.removed = true; },
        invalidateSize() { m.sized += 1; },
        getZoom() { return m.zoom; },
        getContainer() { return container; },
      };
      rec.maps.push(m);
      return m;
    },
    tileLayer(url, opts) {
      const t = { url, opts, addTo(map) { map.tile = t; return t; } };
      rec.tiles.push(t);
      return t;
    },
    marker(latlng, opts) {
      const mk = {
        // `draggable` is the creation option; `dragging` is the handler that gets switched
        // on and off afterwards. Both are real Leaflet's own names, and getting them the
        // wrong way round here is the sort of stub fault that hides a screen doing nothing.
        latlng: { lat: latlng[0], lng: latlng[1] }, opts, handlers: {},
        dragging: toggle("marker drag", !!opts.draggable),
        addTo(map) { mk.addedTo = map; map.marker = mk; return mk; },
        on(evt, cb) { mk.handlers[evt] = cb; return mk; },
        getLatLng() { return { lat: mk.latlng.lat, lng: mk.latlng.lng }; },
        setLatLng(ll) { mk.latlng = { lat: ll[0], lng: ll[1] }; },
      };
      rec.markers.push(mk);
      return mk;
    },
  };
  return { L, rec };
}

// Long enough for the loader's microtask, the map's own build and the rAF that measures the
// box — in that order, which is the order the real phone does them in.
const settle = async (rounds = 24) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 1));
};

// A door already known for the customer, as the pin they dropped on the shop page. This is
// the SUGGESTION path, which is the state a first order from somebody is really in — and it
// is the one v197 promised never reaches a driver unaccepted.
const DOOR = { lat: 5.4299, lng: 100.3399, label: "Sri Bunga guard house", at: "2026-09-25T10:00:00.000Z" };
const withDoor = () => ({ ...COURIER_ORDER, customerPlace: DOOR });

// The section, with a host-supplied slot OUTSIDE its own node — exactly as both call sites in
// orders.js build it, and deliberately so: whether the block lands in the slot or gets built
// inside the section's own folded node is the first thing the first test below checks.
function mountDoor(state, order) {
  const doorSlot = createEl("div");
  const wrap = courierQuoteSection({ state, orders: [order], doorSlot });
  doc.body.append(doorSlot);
  doc.body.append(wrap);
  return { doorSlot, wrap };
}

function closeDoor({ wrap, doorSlot } = {}) {
  const hide = wrap && buttonByText(wrap, "Hide the delivery price");
  if (hide) hide._listeners.click[0]();
  if (wrap) wrap.parentNode = null;
  if (doorSlot) doorSlot.parentNode = null;
}

test("the door block is drawn into the host's slot when the box opens, and not inside the price fold (v201)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let mounted = null;
  try {
    mounted = mountDoor(courierState(), withDoor());
    await settle(4);

    assert.match(mounted.doorSlot.textContent, /The door the driver is sent to/,
      "the block is on the card before anything is pressed — her answer was 'Always, courier orders'");
    assert.match(mounted.doorSlot.textContent, /12 Jalan Bunga, 10450 Penang/,
      "and it names the address the order already carries");
    assert.match(mounted.doorSlot.textContent, /Sri Bunga guard house/,
      "and the pin, in the customer's own words for it");
    assert.match(mounted.doorSlot.textContent, /from the shop page/,
      "said as the customer's own suggestion, because v197 keeps their pin out of a driver's hands");
    assert.equal(leaf.rec.maps.length, 1, "the map itself was built, once");
    assert.equal(leaf.rec.markers[0].latlng.lat, 5.4299, "with its pin on the customer's door");

    // The card's TOP is the host's slot; the section's own node is the folded price panel.
    // A block built inside the fold would be invisible until she asked for a price — which
    // is precisely the state her report was about.
    assert.doesNotMatch(mounted.wrap.textContent, /The door the driver is sent to/,
      "and the block is NOT inside the section's own node, which is the fold she has to open");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

test("a card that is rebuilt does not leave the map it replaced running (v254)", async () => {
  // WHAT SHE REPORTED: "the add order is becoming unstable, sometimes not sure what happen."
  // The card rebuilds itself constantly — a changed Fulfillment, a day tapped in its own
  // calendar, a sync pull — and every rebuild threw the old block away without telling
  // admin/js/place_map.js. The old map therefore kept its tiles and its `window` resize
  // listener until the keyboard next opened or closed, and answered resize calls until then.
  //
  // This is the ordering the sweep has to survive, and the reason it is deferred rather than
  // run at mount: `mountDoor` builds the section BEFORE the slot reaches the page, exactly as
  // `courierBox.replaceChildren(...buildCourierBlock())` builds before it swaps. A sweep that
  // ran synchronously would see a disconnected box and eat the new card's own map.
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let first = null;
  let second = null;
  try {
    first = mountDoor(courierState(), withDoor());
    await settle(4);
    assert.equal(leaf.rec.maps.length, 1, "the first card's map is up");
    assert.equal(leaf.rec.maps[0].removed, false, "and running");

    closeDoor(first); // the block is thrown away; nothing says so out loud
    second = mountDoor(courierState(), withDoor());
    await settle(4);

    assert.equal(leaf.rec.maps[0].removed, true,
      "the map the discarded block left behind is destroyed, rather than kept alive answering resize calls for the rest of the session");
    assert.equal(leaf.rec.maps[1].removed, false,
      "and the map the new block built is untouched — the sweep must not eat it for arriving before its slot");
  } finally {
    closeDoor(first);
    closeDoor(second);
    delete globalThis.window.L;
  }
});

// ── the card holding still under her thumb (v254) ──────────────────────────
//
// WHAT SHE REPORTED, and this section is about the other half of it: "once i click reset pin
// the screen jump." The ＋ New order card is INLINE in `#view`, so the page scrolls on
// `document.scrollingElement` — and nothing on this path compensated for the door block
// changing height under her finger. Measured at 375x812 in a browser: her own press rewraps
// the answer line from three lines to two and the row she is holding moves up 15 pixels, with
// the scroll left at 0. Asking for a price on a card with no pin yet is worse — the 200px map
// appears BETWEEN the words and the buttons, and the button she is still holding drops 210
// pixels, taking the price fold down with it.
//
// A STAND-IN SCREEN WITH LAYOUT, because that is the one thing this file's shim does not have
// and the rule under test is entirely about layout. It is a deliberately tiny engine — a node
// starts where its previous sibling ended, and the page's own scroll moves everything up — but
// every number in it is a real one, and the two things that change under her change it here
// for the same reason they change there: the words line rewraps, and a 200px map appears.
//
// The scroll is part of the model on purpose. A correction that did not stick, or one applied
// twice, would show up as the row landing somewhere OTHER than where it started — which is how
// the assertion below catches an overshoot as well as a miss.

const LINE_H = 15, CHARS_PER_LINE = 34, MAP_H = 200, ROW_H = 34;
const CARD_TOP = 300; // the topbar, the day header and the calendar — everything above the card

// How tall a node is, as a browser would say. Only the shapes this block actually builds are
// modelled; anything else is the sum of its children, which is the honest default for a stack.
function boxHeight(n) {
  if (n.hidden) return 0;
  const cls = String(n.className || "");
  if (cls.includes("place-map")) return MAP_H;
  if (n.tagName === "P") {
    return Math.max(1, Math.ceil(String(n.textContent).length / CHARS_PER_LINE)) * LINE_H;
  }
  if (n.tagName === "BUTTON") return ROW_H;
  if (n.tagName === "LABEL") return LINE_H;
  return (n.children || []).reduce((sum, c) => sum + (c.nodeType === 1 ? boxHeight(c) : 0), 0);
}

// Where a node sits, measured against the page and then moved by the scroll it is on — the
// part that makes a correction observable rather than merely applied.
function boxTop(n, scroller) {
  let top = CARD_TOP;
  for (let cur = n; cur; cur = cur.parentNode) {
    for (const sib of (cur.parentNode ? cur.parentNode.children : [])) {
      if (sib === cur) break;
      if (sib.nodeType === 1) top += boxHeight(sib);
    }
  }
  return top - (scroller.scrollTop || 0);
}

// Give every node the app builds a box, for the length of one test. `document.createElement`
// is the single door ui.js's `el()` and `button()` both go through, so patching it here is
// what makes this a measurement of the real section rather than of a fixture.
function withLayout(scroller) {
  const real = doc.createElement;
  doc.createElement = (tag) => {
    const n = real(tag);
    n.getBoundingClientRect = () => {
      const top = boxTop(n, scroller);
      return { top, bottom: top + boxHeight(n) };
    };
    return n;
  };
  return () => { doc.createElement = real; };
}

// The row of the door block's own presses — the anchor the card is held by. Found by class
// rather than held as a variable, so the test reads the node the card really drew.
const doorRow = (doorSlot) => all(doorSlot)
  .find((n) => String(n.className).includes("btn-row"));

// THE ONE MEASUREMENT. The row's VIEWPORT top is what her thumb is on; its DOCUMENT top is
// what the card's own content did. If the document top did not change, the block never grew,
// the question is vacuous, and the test says so rather than passing on a still card.
function reading(doorSlot, scroller) {
  const row = doorRow(doorSlot);
  return {
    row,
    view: row.getBoundingClientRect().top,
    doc: row.getBoundingClientRect().top + (scroller.scrollTop || 0),
  };
}

// The lookup that finds the HOUSE, in the words on the order — so the door keeps the address
// as its name and gains no "only the road" tail. That is the answer the press is for, and it
// is the one measured in the browser: the line stops being three sentences about a pin the
// customer dropped and becomes one sentence about the door she keeps, and it is two lines
// where it was three.
const FOUND_THE_HOUSE = {
  ok: true,
  place: { lat: 5.4172, lng: 100.3311, label: "12 Jalan Bunga, 10450 Penang" },
};

test("resetting a pin does not move the row she is holding (v254)", async () => {
  signIn();
  const s = stubGeocodeAsks([FOUND_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  st.orders = [withDoor()];
  let mounted = null;
  const scroller = doc.scrollingElement;
  scroller.scrollTop = 0;
  const putBack = withLayout(scroller);
  try {
    // Her exact state: the customer dropped their own pin from the shop page, so the press
    // reads "Reset the pin from the address" and asks before it replaces anything.
    mounted = mountDoor(st, withDoor());
    await settle(4);
    layers["confirm-layer"].replaceChildren();

    const before = reading(mounted.doorSlot, scroller);
    assert.ok(before.row, "the door block has its own row of presses to hold onto");

    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    buttonByText(layers["confirm-layer"], "Reset the pin")._listeners.click[0]();
    await settle(6);

    const after = reading(mounted.doorSlot, scroller);
    // THE PRECONDITION. Without it this test would pass on a card that never changed at all —
    // and the reset really does change it: the line stops being the customer's pin and becomes
    // the door she keeps, which is a different length and wraps differently.
    assert.notEqual(after.doc, before.doc,
      "the reset really did rewrite the door's own words, so there was something to hold still for");
    assert.equal(after.view, before.view,
      "and the row she is holding is on the exact pixel it was, rather than jumping out from under her thumb");
  } finally {
    putBack();
    scroller.scrollTop = 0;
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a price press that makes a map appear does not move the row she is holding (v254)", async () => {
  signIn();
  const s = stubGeocodeAsks([AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  // No pin anywhere yet — the state the ＋ New order card is in when she has just typed an
  // address. Nothing 200 pixels tall sits between the words and the buttons, and pressing for
  // a price is what puts one there.
  const st = courierState();
  let mounted = null;
  const scroller = doc.scrollingElement;
  scroller.scrollTop = 0;
  const putBack = withLayout(scroller);
  try {
    mounted = mountDoor(st, { ...COURIER_ORDER });
    await settle(4);
    const before = reading(mounted.doorSlot, scroller);
    assert.ok(before.row, "the door block has its own row of presses to hold onto");

    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle(8);

    const after = reading(mounted.doorSlot, scroller);
    assert.notEqual(after.doc, before.doc,
      "the lookup answered, so a map really was put in above the buttons she is holding");
    assert.equal(after.view, before.view,
      "and those buttons are still under her thumb, with the prices opening below them rather than 200 pixels further down");
  } finally {
    putBack();
    scroller.scrollTop = 0;
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("the same rule holds the card still inside a pop-up, by scrolling the body it lives in (v254)", async () => {
  signIn();
  const s = stubGeocodeAsks([FOUND_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  st.orders = [withDoor()];
  let mounted = null;
  const scroller = doc.scrollingElement;
  scroller.scrollTop = 0;
  // The Edit card and the tracking card are the same section in the one pop-up layer, which
  // scrolls on `.popup-body` rather than on the page. Correcting the page instead would move
  // the whole app behind the card — the exact fault this helper exists to prevent, from the
  // other direction. So the layout model is given the POP-UP's scroller here, not the page's:
  // a rect that ignored the scroll it was corrected by would report a move that never happened.
  const layer = doc.getElementById("popup-layer");
  const body = createEl("div");
  body.className = "popup-body";
  const putBack = withLayout(body);
  try {
    const doorSlot = createEl("div");
    const wrap = courierQuoteSection({ state: st, orders: [withDoor()], doorSlot });
    body.append(doorSlot);
    body.append(wrap);
    layer.append(body);
    // On the page, the way the real one is: the pop-up layer is a child of `body`, and the
    // card's own work refuses to run against a node that is not — a press here has to really
    // repaint, or this test would prove nothing about what happens when it does.
    doc.body.append(layer);
    mounted = { doorSlot, wrap, body };
    await settle(4);

    const before = reading(doorSlot, body);
    assert.ok(before.row, "the door block has its own row of presses to hold onto");

    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    buttonByText(layers["confirm-layer"], "Reset the pin")._listeners.click[0]();
    await settle(6);

    const after = reading(doorSlot, body);
    assert.notEqual(after.doc, before.doc, "the reset rewrote the door's words here too");
    assert.equal(after.view, before.view, "and the row is held still");
    assert.ok(body.scrollTop !== 0,
      "by scrolling the pop-up's own body — the thing this card actually scrolls inside");
    assert.equal(scroller.scrollTop, 0,
      "and NOT the page behind it, which would have moved the whole app out from under the card");
  } finally {
    putBack();
    scroller.scrollTop = 0;
    closeDoor(mounted);
    doc.getElementById("popup-layer").replaceChildren();
    s.restore();
    delete globalThis.window.L;
  }
});

test("a pin dragged on the map is written against the customer, and the prices quoted for the old door are cleared (v201)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  let mounted = null;
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    assert.match(mounted.wrap.textContent, /RM 14\.00/, "a price is on the panel to begin with");

    const map = leaf.rec.maps[0];
    const mk = leaf.rec.markers[0];
    assert.ok(map && mk, "the map and its pin are up");

    // LOCKED FIRST, and this is the load-bearing half of "Look, and a Move button": the
    // marker's drag handler is wired at build time, so the guard inside it is the only thing
    // standing between a stray touch and a customer's kept door moving under her.
    const before = { ...st.customers[0].place };
    mk.latlng = { lat: 5.6, lng: 100.5 };
    mk.handlers.dragend({ target: mk });
    assert.equal(st.customers[0].place.lat, before.lat, "a drag on the locked map moves nothing");
    assert.equal(map.handlers.click, undefined, "and a tap on the locked map places nothing");
    assert.doesNotMatch(mounted.wrap.textContent, /The door moved/, "and nothing is said about a move that did not happen");

    buttonByText(mounted.doorSlot, "Move this pin")._listeners.click[0]();
    assert.ok(buttonByText(mounted.doorSlot, "Done moving"), "the press now says how to put the card back");

    mk.latlng = { lat: 5.6, lng: 100.5 };
    mk.handlers.dragend({ target: mk });
    assert.equal(st.customers[0].place.lat, 5.6, "now the drop is written against the customer");
    assert.equal(st.customers[0].place.lng, 100.5, "both numbers of it");
    // The WORDS are the order's address, not the geocoder's row (v207): the panel kept this
    // door on its way to a price, and since v207 it is named with the address it was looked
    // up for. The point is that a drag keeps WHATEVER words the door had — a bare lat/lng
    // would print as two numbers on the ends line and the run row.
    assert.equal(st.customers[0].place.label, "12 Jalan Bunga, 10450 Penang",
      "and the door keeps the words it had — a bare lat/lng would print as two numbers on the ends line and the track card");
    assert.match(mounted.doorSlot.textContent, /12 Jalan Bunga/, "the caption follows the write");

    assert.doesNotMatch(mounted.wrap.textContent, /RM 14\.00/,
      "the price quoted for the OLD door is gone — leaving it would price the wrong address");
    assert.match(mounted.wrap.textContent, /ask again for a price for this spot/,
      "with a line that says so, rather than silently spending eight requests on a re-ask");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("the door the panel looks up on its way to a price moves the map's pin (v201)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  let mounted = null;
  try {
    // NO customer pin on this order, which since v208 is the ONLY case where the address is
    // looked up at all — an order WITH a pin keeps that pin as its door and spends no lookup
    // (see the v208 test above). This is the screen the lookup still has to draw: a card with
    // no point on it at all.
    mounted = mountDoor(st, { ...COURIER_ORDER });
    await settle(4);
    assert.equal(leaf.rec.maps.length, 0,
      "a courier order with nothing pinned draws no map — a map with no pin is a picture of nothing");

    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();

    assert.equal(st.customers[0].place.lat, 5.42,
      "asking for a price looks the address up and KEEPS the point against the customer");
    const mk = leaf.rec.markers[0];
    assert.ok(mk, "so the map the lookup's answer earns is built");
    assert.equal(mk.latlng.lat, 5.42, "with the pin on the point that was found");
    assert.equal(mk.latlng.lng, 100.33, "both numbers of it");
    assert.equal(leaf.rec.maps.length, 1, "one map, built once");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

// ── the card says it too, and goes on saying it (v211) ────────────────────
//
// The picker is where she READS a lookup; the card is where the door it wrote is said back
// to her afterwards. This is the screen the lie was on: the door is named with the address
// on the order — house number and all, v207 — so a point found only as far as the road wore
// "23 Jalan Seang Tek" back at her on this card. Asserted on the drawn card, and TWICE over:
// once straight after the lookup, and once on a card opened later from the stored door,
// because a caveat that only survives until the next repaint is not a fact about the door.

test("a door the lookup found only as far as the road says so on the card, and keeps saying it (v211)", async () => {
  signIn();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const said = JSON.parse(opts.body || "{}");
    const body = said.action === "geocode"
      // The answer she gets for "23 Jalan Seang Tek": the street, and no house.
      ? { ok: true, place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town, 10400" } }
      : said.action === "vehicles"
        ? { ok: true, services: [{ key: "MOTORCYCLE" }] }
        : { ok: true, quotes: [], failed: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const st = courierState();
  const order = { ...COURIER_ORDER, address: "23 Jalan Seang Tek" };
  st.orders = [order];
  let mounted = null;
  let later = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();

    // THE WRITE. The number the lookup missed is stored on the door, and on the door only:
    // the point is the geocoder's and the words are still her address.
    assert.equal((st.customers[0] || {}).place.road, "23",
      "the number the lookup could not find is recorded with the door");
    assert.equal(st.customers[0].place.label, "23 Jalan Seang Tek",
      "and the door is still NAMED with the address on the order, as v207 settled");

    // THE READ, on the card she is looking at.
    assert.match(mounted.doorSlot.textContent, /23 Jalan Seang Tek — the door you keep for Mei Ling\./,
      "the line still names the door with the address she and the customer both use");
    assert.match(mounted.doorSlot.textContent, /The lookup found the road, not number 23 — drag the pin to the door\./,
      "and says the pin is the street, on the same line, so the two cannot be read apart");
    closeDoor(mounted); mounted = null;

    // AND IT IS NOT A ONE-SHOT. A card opened later, from the stored door, says the same
    // thing — which is the whole reason the number is stored rather than only printed once.
    later = mountDoor(st, order);
    await settle(4);
    assert.match(later.doorSlot.textContent, /The lookup found the road, not number 23/,
      "a card opened from the saved door says it again, without asking anything");
  } finally {
    if (mounted) closeDoor(mounted);
    if (later) closeDoor(later);
    globalThis.fetch = real;
  }
});

test("a collect order gets no door block, and a courier order with no point gets no map (v201)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let collected = null;
  let pinless = null;
  try {
    // A collect order is not delivered anywhere, so there is no door to check. The slot is
    // handed over all the same — the host does not know which kind it is holding.
    collected = mountDoor(courierState(), { ...COURIER_ORDER, fulfillment: "collect" });
    await settle(4);
    assert.equal(collected.doorSlot.children.length, 0, "a collect order gets no door block at all");
    assert.equal(leaf.rec.maps.length, 0, "and no map is built for it");

    // A courier order with an address and nothing pinned: the words are the door, and a map
    // with no pin on it is a picture of nothing spending 200 pixels of the card.
    pinless = mountDoor(courierState(), { ...COURIER_ORDER });
    await settle(4);
    assert.match(pinless.doorSlot.textContent, /no point pinned yet/,
      "the address is shown, and said to be the door the driver is sent to");
    assert.ok(buttonByText(pinless.doorSlot, "Put this doorstep on the map"),
      "with the one press that CAN answer it — the address still has to be looked up");
    assert.equal(leaf.rec.maps.length, 0, "and still no map");
    assert.equal(byClass(pinless.doorSlot, "door-map").hidden, true,
      "the empty box is taken out of the way rather than left as a 200px hole");
  } finally {
    closeDoor(collected);
    closeDoor(pinless);
    delete globalThis.window.L;
  }
});

test("a pin named with the customer's own address is not printed twice on her card (v205)", async () => {
  // Since v205 the shop's pin carries the customer's OWN typed address as its words —
  // "One address, one point. Nothing else named." So on her screen the two are one string,
  // and the card saying it once as the address and once as the pin's name would be the
  // "it did not tally" report read backwards. The address is printed, and the pin adds
  // nothing that is already above it.
  globalThis.window.L = null;
  const ADDR = "12 Jalan Bunga, 10450 Penang";
  const lying = { ...COURIER_ORDER, address: ADDR, customerPlace: { lat: 5.4299, lng: 100.3399, label: ADDR, at: "2026-09-27T10:00:00.000Z" } };
  let mounted = null;
  try {
    mounted = mountDoor(courierState(), lying);
    await settle(4);
    const said = mounted.doorSlot.textContent;
    assert.equal(said.split(ADDR).length - 1, 1,
      "the address is on her card exactly once — it is the name of the pin, not two facts");
    assert.match(said, /Mei Ling's own pin from the shop page/,
      "and the pin is still said to be theirs");
    assert.match(said, /This is the door the driver is sent to/,
      "and since v209 it says so — their own pin IS the door, not a suggestion waiting to be taken");
    assert.doesNotMatch(said, new RegExp(`${ADDR}[^]*?${ADDR}`),
      "never the address above the pin and the same words as the pin's own name");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

test("a pin named with words that are NOT the address still says which spot it is (v205)", async () => {
  // The other half, and it must not be lost to the fix above: an older order's pin (or one
  // from a phone that has not reloaded) can still carry a name of its own, and a card that
  // dropped it would leave her unable to tell where the point was meant to be at all.
  globalThis.window.L = null;
  let mounted = null;
  try {
    mounted = mountDoor(courierState(), withDoor());
    await settle(4);
    const said = mounted.doorSlot.textContent;
    assert.match(said, /12 Jalan Bunga, 10450 Penang — Mei Ling's own pin from the shop page: Sri Bunga guard house/,
      "the address, then the pin, then what the pin calls itself — three facts, none repeated");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

// ── the door's NAME vs the geocoder's ROW (v207) ──────────────────────────
//
// Her report, three times over: "pin still wrong". Measured on the card, the one door read
// "12 Jalan Bunga, 10450 Penang — the door you keep for Mei Ling: Taman Sri Nibong, George
// Town" — the address she and the customer both use, and then a SECOND name for the same
// door, disagreeing with it. That second name is not a name: it is the row the geocoder
// answered with, and a row is a fragment — a street and a town, no house number. So the
// POINT is the geocoder's and the WORDS are the address on the order. Three tests, one per
// place that named a door with the row: the price panel's own lookup, the picker's press,
// and the sentence the card draws.

test("the door the panel looks up on its way to a price is named with the ADDRESS, not the geocoder's row (v207)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  let mounted = null;
  try {
    // No customer pin, so the lookup runs and its answer is what has to be named right. An
    // order WITH one keeps the customer's pin and spends no lookup at all (v208).
    mounted = mountDoor(st, { ...COURIER_ORDER });
    await settle(4);
    assert.match(mounted.doorSlot.textContent, /no point pinned yet/,
      "to begin with there is no point, and the address is said to be the door");

    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();

    // The geocoder's stub answers "12 Jalan Bunga" — a fragment, and NOT the order's address
    // ("12 Jalan Bunga, 10450 Penang"). Its POINT is kept; its WORDS are not.
    assert.equal(st.customers[0].place.lat, 5.42, "the point on the door is the geocoder's");
    assert.equal(st.customers[0].place.label, "12 Jalan Bunga, 10450 Penang",
      "and the words kept for it are the address on the order");
    assert.notEqual(st.customers[0].place.label, "12 Jalan Bunga",
      "specifically NOT the geocoder's row, which is the fragment this version stops keeping");
    assert.equal(st.customers[0].place.from, "lookup",
      "and it is recorded as the app's own lookup (v209) — so a pin the customer drops later beats it");

    const said = mounted.doorSlot.textContent;
    assert.match(said, /12 Jalan Bunga, 10450 Penang — the door you keep for Mei Ling\./,
      "her card says the door she keeps with one name for it: the address, and who it is for");
    assert.equal(said.split("12 Jalan Bunga, 10450 Penang").length - 1, 1,
      "named exactly ONCE — a second, disagreeing name is the report she made three times");
    assert.equal(said.split("12 Jalan Bunga").length - 1, 1,
      "and the geocoder's row is nowhere on the card as a name of its own — the fragment is only ever part of the address");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a lookup's answer moves the pin but does NOT rename the door — the address she typed is kept (v207)", async () => {
  signIn();
  const ADDRESS = "12 Jalan Bunga, 10450 Penang";
  const s = stubGeocode({ ok: true, place: { lat: 5.4, lng: 100.3, label: "Taman Sri Nibong, George Town" } });
  let close = null;
  let picked = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: ADDRESS, onPick: (p) => { picked = p; } });
    await new Promise((r) => setTimeout(r, 0));

    const body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    assert.match(body.textContent, /Found: Taman Sri Nibong, George Town/,
      "the geocoder's own answer is still reported on the line — she has to be able to check it");
    buttonByText(body, "Use this spot")._listeners.click[0]();

    assert.ok(picked, "the spot is handed over");
    assert.equal(picked.lat, 5.4, "on the geocoder's point");
    assert.equal(picked.lng, 100.3, "both numbers of it");
    assert.equal(picked.label, ADDRESS,
      "but NAMED with the address she typed, never the geocoder's fragment");
  } finally {
    if (close) close();
    s.restore();
  }
});

test("a picker whose address box is emptied still names the door with the geocoder's answer (v207)", async () => {
  signIn();
  const s = stubGeocode({ ok: true, place: { lat: 5.4, lng: 100.3, label: "Taman Sri Nibong, George Town" } });
  let close = null;
  let picked = null;
  try {
    close = openPlacePicker({ state: courierState(), title: "Put the pin on the map", address: "12 Jalan Bunga", onPick: (p) => { picked = p; } });
    await new Promise((r) => setTimeout(r, 0));
    const body = popupBody();
    buttonByText(body, "Look it up")._listeners.click[0]();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));

    // She empties the box after the lookup — the address was not the one she wants this door
    // called by, or she is pinning for somebody who gave coordinates only. The door still has
    // to be named something, and the geocoder's last answer is the only name left standing;
    // a door called "" prints as two bare numbers everywhere it is said out loud.
    const addrInput = all(body).find((n) => String(n.className).includes("input"));
    addrInput.value = "";
    buttonByText(body, "Use this spot")._listeners.click[0]();

    assert.ok(picked, "the spot is handed over");
    assert.equal(picked.label, "Taman Sri Nibong, George Town",
      "with no address in the box, the geocoder's answer is the fallback name for the door");
  } finally {
    if (close) close();
    s.restore();
  }
});

test("a door with no address to name it still wears the words it has (v207)", async () => {
  globalThis.window.L = null;
  // The fallback half of the rule, and it must not be lost to the fix above. The lookup names
  // a door only with an address it was looked up for, so where the order carries NO address
  // the stored words are the only name the door has and they stand. Reached by planting the
  // kept door straight into the scenario, which is the state a drag on an addressless order
  // leaves — courier_quote.js's onMove keeps `dropPlaceOf().label || dropAddress`.
  const st = courierState();
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.42, lng: 100.33, label: "Taman Sri Nibong, George Town" },
  }];
  let mounted = null;
  try {
    mounted = mountDoor(st, { ...COURIER_ORDER, address: "" });
    await settle(4);
    assert.match(mounted.doorSlot.textContent, /Taman Sri Nibong, George Town — the door you keep for Mei Ling\./,
      "with no address to name it, the words the door already has are what she reads");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

test("a phone that cannot load the map still shows the door, and says why the map is missing (v201)", async () => {
  // This file's default condition: the fetch stub rejects and the head shim fires every
  // script's `error` on a microtask, so Leaflet can never arrive. That is a one-bar phone,
  // and the block still has to be a way to check a door.
  globalThis.window.L = null;
  const st = courierState();
  let mounted = null;
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);

    assert.match(mounted.doorSlot.textContent, /The door the driver is sent to/,
      "the block is still there");
    assert.match(mounted.doorSlot.textContent, /Sri Bunga guard house/,
      "and still names the door — the words are the same fact the map would have drawn");
    assert.match(mounted.doorSlot.textContent, /The map is not available right now/,
      "with the missing map said out loud, rather than a blank space she cannot explain");
    assert.equal(byClass(mounted.doorSlot, "door-map").hidden, true, "and the empty box out of the way");
    assert.ok(buttonByText(mounted.doorSlot, "Move this pin"),
      "the press is still offered — the picker reads coordinates as well as addresses");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

test("the map is read-only until she presses Move this pin (v201)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  let mounted = null;
  const st = courierState();
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);
    const map = leaf.rec.maps[0];
    const mk = leaf.rec.markers[0];
    const box = byClass(mounted.doorSlot, "door-map");

    assert.equal(map.opts.dragging, false, "the map itself does not drag");
    assert.equal(map.opts.scrollWheelZoom, false, "a wheel passing over it scrolls the card, not the map");
    // THE ZOOM IS NOT PART OF THE LOCK SINCE v238, and these four flip the other way. Her
    // report: "the map are not allow to zoom out and dragging the pin to the right pin become
    // extremely time consuming and prompt to error" — the lock had been drawn around the whole
    // map, so a stale pin could only be corrected by dragging a marker across a map that
    // refused to zoom out first. The lock now covers only what could move the pin.
    assert.equal(map.opts.touchZoom, true, "pinch zooms the map while the card is only being looked at");
    assert.equal(map.opts.doubleClickZoom, true, "and so does a double-tap");
    assert.equal(map.opts.boxZoom, true, "and the desktop box zoom");
    assert.equal(map.opts.zoomControl, true, "and the plus and minus are drawn, which is the half of her ask a button answers");
    assert.equal(mk.opts.draggable, false, "the pin does not drag either");
    assert.equal(map.handlers.click, undefined, "and a tap on the map places nothing");
    // Measured once the card settled. A map built while the card is still being laid out
    // measures zero, draws a corner of one tile and never recovers — see the note on
    // `.place-map` in app.css. This is the rAF that prevents it.
    assert.equal(map.sized, 1, "and the box was measured once the card settled, not left at zero");
    // The dead zone. Leaflet sets `touch-action: none` on its own container, so a locked map
    // inside a scrolling card would make 200px of that card swallow her finger and leave the
    // Save button under it feeling unreachable.
    assert.equal(box.style.touchAction, "pan-y", "a locked map lets the card's own scroll through it");

    buttonByText(mounted.doorSlot, "Move this pin")._listeners.click[0]();
    assert.equal(map.dragging.on, true, "pressing it turns the map's drag on");
    assert.equal(map.touchZoom.on, true, "and the pinch was already on, because the lock never covered it");
    assert.equal(mk.dragging.on, true, "and the pin's own drag");
    // THE TAP IS NOT PART OF WHAT UNLOCKING BUYS HER (v264). "Click on the map should not move
    // the pin, only dragging the pin will." This card's map always carries a pin, so the
    // handler answers nothing — driven here rather than merely read, because a handler that is
    // registered and does nothing is exactly what a test with no press would call correct.
    const pinBefore = { lat: mk.latlng.lat, lng: mk.latlng.lng };
    const wordsBefore = mounted.doorSlot.textContent;
    map.handlers.click({ latlng: { lat: 5.4172, lng: 100.3311 } });
    assert.deepEqual({ lat: mk.latlng.lat, lng: mk.latlng.lng }, pinBefore,
      "an unlocked tap leaves the pin exactly where it was");
    assert.equal(mounted.doorSlot.textContent, wordsBefore,
      "and writes nothing — the door the driver is sent to is the same one it named before the tap");
    assert.equal(box.style.touchAction, "none", "the unlocked map takes the gesture for itself, like the picker's");

    buttonByText(mounted.doorSlot, "Done moving")._listeners.click[0]();
    assert.equal(map.dragging.on, false, "pressing it again locks the map");
    assert.equal(mk.dragging.on, false, "and the pin");
    assert.equal(map.touchZoom.on, true, "but NOT the zoom — a lock that took the pinch away with it is the fault v238 fixed");
    assert.equal(map.doubleClickZoom.on, true, "the double-tap stays live with it");
    assert.equal(map.handlers.click, undefined, "and takes the tap off the map with it, as it has since v201");
    assert.equal(box.style.touchAction, "pan-y", "giving the card its scroll back");
  } finally {
    closeDoor(mounted);
    delete globalThis.window.L;
  }
});

test("a redraw of the card leaves the map where she left it (v201)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  let mounted = null;
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);
    const mk = leaf.rec.markers[0];
    assert.equal(leaf.rec.views.length, 1, "the map is aimed at the door once, when it is built");

    // Every one of these is a repaint of an OPEN card, and `paintDoor` hands the current
    // point back to a map that is already showing it. The fault this catches is subtle
    // enough to have shipped: `setPlace` re-centred unconditionally, so a repaint threw away
    // a pan she had made with her own thumb, and a pin she had just dropped jumped back to
    // the middle of the box from under her finger. Both were found on a real render, not
    // here — which is the reason this test now exists to hold the fix.
    buttonByText(mounted.doorSlot, "Move this pin")._listeners.click[0]();
    assert.equal(leaf.rec.views.length, 1, "unlocking the pin does not re-aim the map at its own pin");

    buttonByText(mounted.doorSlot, "Done moving")._listeners.click[0]();
    assert.equal(leaf.rec.views.length, 1, "nor does locking it again");

    mk.latlng = { lat: 5.6, lng: 100.5 };
    mk.handlers.dragend({ target: mk });
    assert.equal(leaf.rec.views.length, 1,
      "and the drop she just made does not slide the map out from under her hand");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

// The other half of the same rule, and it is not the same half: a door the map has never
// shown IS worth moving the view for, or she would be left looking at the old door while the
// app had moved on to a new one. It used to be reached through the address lookup, which no
// longer runs on an order with a pin (v208), so it is reached the way she reaches it now:
// the customer's pin, taken up from the offer.

test("a door the map has never shown is worth moving the view for (v201)", async () => {
  signIn();
  const s = stubChannel();
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  // A door she already keeps for this customer with no record of her hand (so their pin wins,
  // v209), and a pin they dropped somewhere else — so the switch appears and pressing it moves
  // the door to a point the map has never drawn.
  st.customers = [{
    id: "c1", key: keyOf(COURIER_ORDER), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga, 10450 Penang" },
  }];
  let mounted = null;
  try {
    mounted = mountDoor(st, withDoor());
    await settle(4);
    assert.equal(leaf.rec.views.length, 1, "the map is aimed at the door once, when it is built");
    assert.equal(leaf.rec.markers[0].latlng.lat, 5.4299,
      "on the customer's own pin, which is the door in force");

    // Opening the price fold is where the switch is drawn, and it moves no door: their pin
    // already answers where this door is, so `ask()` spends no lookup and the map stays put.
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    assert.equal(leaf.rec.views.length, 1, "asking for a price does not re-aim the map at the door it already shows");

    buttonByText(mounted.wrap, "Use the door I keep instead")._listeners.click[0]();
    await settle();

    assert.equal(leaf.rec.views.length, 2, "the door the press moves to is worth moving the view for");
    assert.deepEqual(leaf.rec.views[1].center, [5.42, 100.33], "and it is aimed at the new point");
    assert.equal(leaf.rec.markers[0].latlng.lat, 5.42, "with the pin on it");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

// ── asking the address up again (v213) ────────────────────────────────────
//
// A door a lookup wrote is the best answer ONE service had on the day it was asked, and it is
// not a fact about the world. For a Malaysian house number that answer is usually just the
// road. v212 put a second, better service in front of the free ones — but a lookup only runs
// where there is NO door yet: `ask()` writes the door once and every later price reads it back.
// So every customer pinned before v212 keeps the road-level point for good, and the Google key
// she has now set would look like it had changed nothing at all. The press below is the way
// out of that.
//
// AND IT IS A PRESS, never something the card does by itself. A pin that moved under her
// without being asked to is the fault v209 was written to end, and this version must not
// reintroduce it one version later. The tests below hold both halves: where the press appears,
// and what each of its three answers does to the door and to the prices.

// The channel, with the geocoder ANSWERING DIFFERENTLY ON EACH ASK. This counter is the whole
// point of the stub: a second ask is only worth a test if its answer can differ from the
// first, and the defect this version exists for is that the second ask never happened at all.
// A stub handing back one fixed answer could not tell a working re-lookup from a press that
// did nothing.
function stubGeocodeAsks(answers) {
  const real = globalThis.fetch;
  let geocodes = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const said = JSON.parse(opts.body || "{}");
    let body;
    if (said.action === "geocode") {
      body = answers[Math.min(geocodes, answers.length - 1)];
      geocodes += 1;
    } else if (said.action === "vehicles") {
      body = { ok: true, services: [{ key: "CAR" }] };
    } else {
      body = {
        ok: true,
        quotes: [{ quotationId: "q-car", serviceType: "CAR", priceBreakdown: { total: 14, currency: "MYR" },
          stops: [{ stopId: "s-bakery", coordinates: { lat: 5.4141, lng: 100.3288 } },
            { stopId: "s-mei", coordinates: { lat: 5.42, lng: 100.33 } }] }],
        failed: [],
      };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { geocodes: () => geocodes, restore() { globalThis.fetch = real; } };
}

// Her own address, and the three answers a lookup can give for it. ON_THE_ROAD is the answer
// the free services give today — the street and no house — which is what she has been reading
// as "a mix of services". AT_THE_HOUSE is what the better service gives, and the point of the
// whole press. STILL_THE_ROAD moved, yet still missed the number, which is the case that must
// keep the v211 caveat rather than clear it by having been asked twice.
const ON_THE_ROAD = { ok: true, place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town, 10400" } };
const AT_THE_HOUSE = { ok: true, place: { lat: 5.4172, lng: 100.3311, label: "23, Jalan Seang Tek, 10400 George Town" } };
const STILL_THE_ROAD = { ok: true, place: { lat: 5.4180, lng: 100.3300, label: "Seang Tek Road, George Town" } };
const NO_ANSWER = { ok: false, reason: "The address service could not be reached." };

// The order every test below asks for a price on. The address is the one whose house number the
// free services cannot find, so a lookup of it really does come back with the road.
const SEAK_ORDER = () => ({ ...COURIER_ORDER, address: "23 Jalan Seang Tek" });
// The ONE press on the door block that replaces the door in force. It wears one of two labels
// — "Look this address up again" over a door of ours, "Reset the pin from the address" over the
// customer's own pin (v238) — so the tests below find it by either, rather than by whichever one
// they happen to expect. A test that looked for only one label would read the other as "no press
// on the card", which is exactly the confusion this feature is about.
const lookBtnOn = (mounted) => buttonByText(mounted.doorSlot, "Look this address up again")
  || buttonByText(mounted.doorSlot, "Reset the pin from the address");

test("the second ask appears where a lookup wrote the door, and nowhere before one exists (v213)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let bare = null;
  let looked = null;
  try {
    // NO DOOR YET. There is nothing to ask again, so the press is not on the card — and it is
    // hidden rather than never built, which is why this asserts the flag and not the absence.
    bare = mountDoor(st, order);
    await settle(4);
    assert.ok(lookBtnOn(bare), "the door block carries the press, so the card is not simply missing it");
    assert.equal(lookBtnOn(bare).hidden, true,
      "with no door at all there is nothing to re-ask for — the price press looks one up by itself");

    // THE PRICE PRESS IS WHAT WRITES A DOOR, and it writes one from a lookup.
    buttonByText(bare.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    assert.equal(s.geocodes(), 1, "the price press made the one lookup");
    assert.equal(st.customers[0].place.from, "lookup", "and the door it wrote is a lookup's, not hers");
    assert.equal(lookBtnOn(bare).hidden, false,
      "so the card now offers to ask that same address up again");
    closeDoor(bare); bare = null;

    // AND IT IS OFFERED FOR A DOOR SAVED BEFORE THE APP RECORDED HOW IT WAS MADE. `from` only
    // arrived at v209, so every door older than that carries nothing — and the only writer that
    // ever ran by itself was the lookup, which is what these are treated as. Without this the
    // press would be missing on exactly the phones it was built for.
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town" },
    }];
    looked = mountDoor(st, order);
    await settle(4);
    assert.equal(lookBtnOn(looked).hidden, false,
      "a door stored before the app kept a note of how it was made is a guess too, and can be re-asked");
  } finally {
    if (bare) closeDoor(bare);
    closeDoor(looked);
    s.restore();
    delete globalThis.window.L;
  }
});

test("the press IS offered over her own hand and over the customer's own pin (v213, changed v238, changed again v239)", async () => {
  signIn();
  const s = stubGeocodeAsks([AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let hand = null;
  let theirs = null;
  try {
    // HER OWN HAND. v213 withheld the press here to keep a correction from being handed back to
    // the service she had just corrected, and v238 kept that half. Her SECOND report is why it
    // had to go: a drag is the only thing this card ever offered her, so a drag is what she does
    // — and it writes `from: "hand"`, which the press then refused for good. Every customer she
    // had ever corrected by hand showed "Move this pin" and nothing else.
    //
    // The protection did not go, it MOVED: this door is still never replaced without being asked
    // (the test below drives that confirmation). Nothing is replaced by merely painting the card.
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4, lng: 100.3, label: "the door she checked", from: "hand", at: "2026-09-25T10:00:00.000Z" },
    }];
    hand = mountDoor(st, order);
    await settle(4);
    assert.equal(lookBtnOn(hand).hidden, false,
      "a door she placed herself can still go stale — she needs both tools, not only the drag");
    assert.equal(lookBtnOn(hand).textContent, "Reset the pin from the address",
      "said as a reset, because a look-up may only DOWNGRADE a door she had right");
    assert.equal(st.customers[0].place.lat, 5.4, "and merely painting the card has moved nothing");

    // THE CUSTOMER'S OWN PIN, WHICH IS THE DOOR IN FORCE (v209) — AND WHICH SINCE v238 IS
    // OFFERED ANYWAY. v209 hid the press here on the reasoning that they were standing at their
    // door when they dropped it, which is true of the day they dropped it and says nothing about
    // today. Her report is the case that misses: the customer MOVED, so their pin is the stale
    // one now, and the press that would replace it was the press hidden by that very rule.
    //
    // It comes back with the label that says what it will do, and — because this replaces a fact
    // that came FROM them — the press asks before it changes anything (the test below drives it).
    closeDoor(hand); hand = null;
    st.customers = [];
    theirs = mountDoor(st, withDoor());
    await settle(4);
    assert.ok(lookBtnOn(theirs), "the press is on the card, so its absence below would be a real one");
    assert.equal(lookBtnOn(theirs).hidden, false,
      "their pin may have gone stale, so the press that replaces it is offered");
    assert.equal(lookBtnOn(theirs).textContent, "Reset the pin from the address",
      "and the label says which of the two things it is about to do");
  } finally {
    if (hand) closeDoor(hand);
    closeDoor(theirs);
    s.restore();
    delete globalThis.window.L;
  }
});

test("over the customer's own pin the press ASKS first, and nothing moves until she says yes (v238)", async () => {
  signIn();
  const s = stubGeocodeAsks([AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const st = courierState();
  st.orders = [withDoor()];
  let mounted = null;
  try {
    // The card starts standing on the pin they dropped from the shop page — the pin that was
    // right when they dropped it and may be stale now.
    mounted = mountDoor(st, withDoor());
    await settle(4);
    // An earlier test in this file can leave its own card in the one confirm layer, so this is
    // emptied first: what the assertions below read has to be this press's own asking.
    layers["confirm-layer"].replaceChildren();
    assert.match(mounted.doorSlot.textContent, /own pin from the shop page/,
      "the card is standing on their pin");

    // THE PRICE FOLD IS OPENED FIRST — and this used to say WHY, in words that made the fault
    // sound like a design: "the press is only wired up when the fold is built, so a press on the
    // door block of a folded card is a press on nothing." That was true, and it was the bug she
    // reported as "pressing that botton dont work" (v240). It is opened here now only so that the
    // sections below — the confirm, and the answer written into the price section's own line —
    // are the ones this test was written for. The folded card has its own test beside it.
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 0,
      "and opening it asked no look-up, because their pin is the door (v208)");
    assert.equal(st.customers[0].place.from, "customer",
      "it kept their pin as a copy tagged theirs, which is the door the card is standing on");

    // THE CANCEL PATH FIRST, because "asks first" is only true if saying no really stops it.
    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    assert.ok(buttonByText(layers["confirm-layer"], "Reset the pin"),
      "the app asked before replacing a pin that came from the customer");
    buttonByText(layers["confirm-layer"], "Cancel")._listeners.click[0]();
    await settle(2);
    assert.equal(s.geocodes(), 0, "and Cancel really stopped it: no look-up ran at all");
    assert.equal(st.customers.length, 1, "so no second door was written either");
    assert.equal(st.customers[0].place.from, "customer", "the row is still the copy of their pin");
    assert.equal(st.customers[0].place.lat, DOOR.lat, "on their own point, unmoved");
    assert.match(mounted.doorSlot.textContent, /own pin from the shop page/,
      "and the card is still standing on their pin");

    // SAY YES, and the door really is replaced — written as a RESET carrying the pin it replaced,
    // so it beats that pin now and yields to a genuinely new one the moment they drop one.
    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    buttonByText(layers["confirm-layer"], "Reset the pin")._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 1, "the press ran once the app was told to go ahead");
    const place = st.customers[0].place;
    assert.equal(place.from, "reset", "and the door is stamped a reset, never a plain look-up");
    assert.equal(place.lat, 5.4172, "standing where the new answer put it");
    assert.equal(place.lng, 100.3311, "in both numbers, not just the one");
    assert.deepEqual(place.against, { lat: DOOR.lat, lng: DOOR.lng },
      "with the pin it replaced recorded, so their pin wins again the moment they drop a new one");
    assert.doesNotMatch(mounted.doorSlot.textContent, /own pin from the shop page/,
      "and the card now says the door is the one she keeps, not theirs");
    assert.equal(lookBtnOn(mounted).textContent, "Look this address up again",
      "the press goes back to the other label, because there is no customer pin left to replace");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("over a door she placed by hand the press ASKS first too, and says which door it is replacing (v239)", async () => {
  signIn();
  const s = stubGeocodeAsks([AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  // The door in force is the one she placed on the map herself. This is the state her own
  // workflow leaves behind — a drag is the only thing the card ever offered her — and it is
  // the state v238 still refused the press in, which is why she reported it twice.
  st.customers = [{
    id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
    place: { lat: 5.4, lng: 100.3, label: "the door she checked", from: "hand", at: "2026-09-25T10:00:00.000Z" },
  }];
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    layers["confirm-layer"].replaceChildren();
    assert.match(mounted.doorSlot.textContent, /the door you keep for Mei Ling/,
      "the card is standing on the door she keeps");
    // HER ACTUAL COMPLAINT, asserted first: the press is ON THE CARD. v238 hid it here, so all
    // she ever saw was "Move this pin" and nothing else — for a door she had corrected by hand.
    assert.equal(lookBtnOn(mounted).hidden, false,
      "the reset is offered over a door of her own hand, which is the state she reported twice");

    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 0, "opening the fold asked no look-up — a door is already in force");

    // CANCEL REALLY STOPS IT, which is the whole of what "asks first" has to mean.
    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    const card = layers["confirm-layer"];
    assert.match(card.textContent, /the door you placed on the map by hand/,
      "and it names the door it is about to replace, so she is not guessing what it means");
    assert.doesNotMatch(card.textContent, /own pin from the shop page/,
      "never their pin — this door is hers, and the card may not invent a fact about a person");
    assert.match(card.textContent, /only find the road/,
      "it says the answer may be NO BETTER, which is the real risk of replacing a door she had right");
    buttonByText(card, "Cancel")._listeners.click[0]();
    await settle(2);
    assert.equal(s.geocodes(), 0, "Cancel stopped it: no look-up ran at all");
    assert.equal(st.customers[0].place.from, "hand", "and her door is still a door of her hand");
    assert.equal(st.customers[0].place.lat, 5.4, "on her own point, unmoved");

    // SAY YES, and it is replaced — a reset, so it stays pressable again afterwards.
    lookBtnOn(mounted)._listeners.click[0]();
    await settle(2);
    buttonByText(layers["confirm-layer"], "Reset the pin")._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 1, "the press ran once she said go ahead");
    const place = st.customers[0].place;
    assert.equal(place.from, "reset", "stamped a reset, so the press can be used again on what it found");
    assert.equal(place.lat, 5.4172, "standing where the fresh answer put it");
    assert.equal(place.lng, 100.3311, "in both numbers, not just the one");
    assert.equal(place.against, undefined,
      "and with no `against`, because this order carries no customer pin for it to have replaced");
    assert.equal(lookBtnOn(mounted).textContent, "Look this address up again",
      "the label goes back to the plain one — a reset is a guess, and a guess is not asked about");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("the press works on a card whose price fold was NEVER opened (v240)", async () => {
  signIn();
  const s = stubGeocodeAsks([AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  let hand = null;
  try {
    // HER WORDS: "pushed / now i see the button but pressing that botton dont work."
    //
    // The press was assigned inside build(), and build() runs only on the first press of "Get a
    // delivery price" — so until that fold had been opened once, this button was on the card
    // with its listener wired to a no-op default, and every tap on it did NOTHING AT ALL. v238
    // hid the button over a door of her own hand and v239 made it visible there, which is what
    // put a dead control in front of her.
    //
    // NOTHING IN THIS TEST OPENS THE FOLD, and that is the whole of it. Every other test in this
    // file opens it first — necessarily, because the answer to the press used to be written into
    // the price section's own line — and that is exactly what hid this fault for two versions.

    // ── over a door of the app's own look-up, where nothing stands between the tap and the pin
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town", from: "lookup" },
    }];
    mounted = mountDoor(st, order);
    await settle(4);
    // The fold is CLOSED, asserted rather than assumed: if a later change ever opens it on mount
    // this test must fail loudly instead of quietly going back to testing the other path.
    assert.equal(buttonByText(mounted.wrap, "Get a delivery price").textContent, "Get a delivery price",
      "the price fold has never been opened on this card");
    assert.equal(lookBtnOn(mounted).textContent, "Look this address up again",
      "and the press is the plain one, so nothing is about to ask her anything first");

    lookBtnOn(mounted)._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 1,
      "THE PRESS ASKED — a button that answers a tap with silence is the dead control this version exists to end");
    assert.equal(st.customers[0].place.lat, 5.4172, "and the door moved to the point the fresh answer gave");
    assert.equal(st.customers[0].place.from, "reset",
      "written as a reset, exactly as it is when the fold happens to be open");
    // AND IT SAID SO. Moving the pin is not the whole answer on its own: a lookup that lands on
    // the same point moves nothing at all, and without a line to read she could not tell that
    // from a press that never ran. Nothing here may need the price section to say it.
    assert.match(mounted.doorSlot.textContent, /The door moved — the lookup answers this address with a different point now\./,
      "the door block itself says what the press did, with no price section to say it in");
    assert.doesNotMatch(mounted.doorSlot.textContent, /Looking 23 Jalan Seang Tek up again…$/,
      "and it does not leave the card sitting on 'Looking … up again…' after the lookup has answered");
    closeDoor(mounted); mounted = null;

    // ── and the ask-first path, which is the other thing this same press does
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4, lng: 100.3, label: "the door she checked", from: "hand", at: "2026-09-25T10:00:00.000Z" },
    }];
    hand = mountDoor(st, order);
    await settle(4);
    layers["confirm-layer"].replaceChildren();
    assert.equal(buttonByText(hand.wrap, "Get a delivery price").textContent, "Get a delivery price",
      "this card's price fold is closed too");
    assert.equal(lookBtnOn(hand).textContent, "Reset the pin from the address",
      "and the press is the one that asks about a door a person chose");
    lookBtnOn(hand)._listeners.click[0]();
    await settle(2);
    assert.match(layers["confirm-layer"].textContent, /the door you placed on the map by hand/,
      "the confirmation comes up on a card whose fold was never opened — before v240 this press could not reach it either");
    buttonByText(layers["confirm-layer"], "Reset the pin")._listeners.click[0]();
    await settle(4);
    assert.equal(s.geocodes(), 2, "and saying yes really ran the look-up — the press's second ask on the day");
    assert.equal(st.customers[0].place.from, "reset",
      "saying yes really did replace her own door, with no price section anywhere on the card");
    assert.equal(st.customers[0].place.lat, 5.4172, "at the point the fresh answer gave");
    assert.equal(st.customers[0].place.against, undefined,
      "and with no `against`, because this order carries no customer pin for it to have replaced");
  } finally {
    if (mounted) closeDoor(mounted);
    if (hand) closeDoor(hand);
    s.restore();
    delete globalThis.window.L;
  }
});

test("the press still ANSWERS after the price fold has been opened and shut again (v241)", async () => {
  signIn();
  // THE ANSWER IS THE SAME POINT THE DOOR ALREADY HAS, on purpose. That is what makes this fault
  // invisible rather than merely quiet: with the pin unmoved there is nothing to see on the map
  // either, so a press whose answer goes nowhere looks exactly like a press that never ran. The
  // sentence IS the whole of the evidence, which is why it must not be written into a node that
  // is off screen.
  const s = stubGeocodeAsks([ON_THE_ROAD]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town", from: "lookup" },
    }];
    mounted = mountDoor(st, order);
    await settle(4);

    // THE FOLD IS OPENED AND THEN SHUT AGAIN, which is the ordinary state of an order she has
    // already priced. v240 gave the press a home of its own — but build() still handed every
    // later answer to the PRICE SECTION's line for good, and that line lives inside the fold.
    // So on a card whose fold had ever been opened, the press answered into a hidden node while
    // the door block's own line, the one outside the fold, was cleared and never written to
    // again. Same dead control as v240, reached from the other side.
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle(6);
    buttonByText(mounted.wrap, "Hide the delivery price")._listeners.click[0]();
    await settle(2);
    assert.equal(buttonByText(mounted.wrap, "Get a delivery price").textContent, "Get a delivery price",
      "the price section is off screen again, and its line with it");
    assert.equal(s.geocodes(), 0,
      "and opening it cost no lookup: this order already keeps a door, so `ask` reads it back");

    const before = { ...st.customers[0].place };
    lookBtnOn(mounted)._listeners.click[0]();
    await settle(4);

    assert.equal(s.geocodes(), 1, "the press really ran the lookup");
    assert.equal(st.customers[0].place.lat, before.lat, "and this address answers with the point it already had");
    // AND ON THE DOOR BLOCK ITSELF, not merely somewhere in the card. `wrap.textContent` would
    // pass on this while the sentence sat in the price section's line, which is INSIDE the fold
    // and invisible — textContent does not know about `hidden`, and an assertion that cannot
    // tell a line she can read from one she cannot is the forgiving-shim fault this file exists
    // to avoid. The door block is the node outside the fold, so the answer is proved here.
    assert.match(mounted.doorSlot.textContent, /found the same spot/,
      "SO THE CARD SAYS SO — with the price section off screen the answer belongs on the door block's own line, the only line actually on the card");
    // ANCHORED, because the answer itself begins with those words ("Looking … up again found
    // the same spot") — an unanchored check here would fail on the very sentence that proves the
    // press worked, which is the sort of assertion that gets "fixed" by deleting the feature.
    assert.doesNotMatch(mounted.doorSlot.textContent, /Looking 23 Jalan Seang Tek up again…$/,
      "and the door's line does not stay on 'Looking … up again…' after the lookup has answered");
  } finally {
    if (mounted) closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a DRAG also says what it did on a card whose price fold has been shut again (v241)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    st.customers = [{
      id: "c1", key: keyOf(order), name: "Mei Ling", whatsapp: "60123456789",
      place: { lat: 5.4141, lng: 100.3288, label: "Seang Tek Road, George Town", from: "lookup" },
    }];
    mounted = mountDoor(st, order);
    await settle(4);

    // THE OTHER WRITER OF THE SAME SENTENCE. A drag ends at `invalidatePrices`, whose sentence
    // about the prices went straight into the price section's line — the line inside the fold.
    // So the press was not the only thing answering into a hidden node; a pin she had just
    // dragged did too, and this test holds that half of the fix as well as the press's.
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle(6);
    buttonByText(mounted.wrap, "Hide the delivery price")._listeners.click[0]();
    await settle(2);

    buttonByText(mounted.doorSlot, "Move this pin")._listeners.click[0]();
    const mk = leaf.rec.markers[0];
    mk.latlng = { lat: 5.42, lng: 100.33 };
    mk.handlers.dragend({ target: mk });
    await settle(4);

    assert.equal(st.customers[0].place.lat, 5.42, "the drag moved the door, as a drag always does");
    assert.match(mounted.doorSlot.textContent, /The door moved — ask again for a price for this spot\./,
      "and the card says so ON THE DOOR BLOCK, the line that is on screen while the price section is shut");
  } finally {
    if (mounted) closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a re-ask that answers with a different point moves the door and takes the old prices with it (v213)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD, AT_THE_HOUSE]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    assert.match(mounted.wrap.textContent, /RM 14\.00/, "there is a price on the card to lose");
    assert.equal(st.customers[0].place.lat, 5.4141, "and the door stands on the road the lookup found");

    lookBtnOn(mounted)._listeners.click[0]();
    await settle();

    assert.equal(s.geocodes(), 2, "the press really asked the address up a second time");
    assert.equal(st.customers[0].place.lat, 5.4172, "and the door moved to the point the new answer gave");
    assert.equal(st.customers[0].place.lng, 100.3311, "in both numbers, not just the one");
    assert.equal(st.customers[0].place.from, "reset",
      "written as a RESET, not a lookup (v238) — this press REPLACES a door that is already on the order, and where that door is the customer's own pin a lookup stamp would lose to it and move nothing");
    assert.equal(st.customers[0].place.label, "23 Jalan Seang Tek",
      "and still NAMED with the address on the order, never the geocoder's row (v207)");
    assert.equal(st.customers[0].place.road, undefined,
      "the house number was found this time, so the road caveat is gone rather than left behind");

    assert.match(mounted.wrap.textContent, /The door moved — the lookup answers this address with a different point now\./,
      "the card says what happened, in its own words");
    assert.doesNotMatch(mounted.wrap.textContent, /RM 14\.00/,
      "and the price quoted for the old door does not stay on screen as if it were this one's");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a re-ask that answers with the same point moves nothing, keeps the prices, and says so (v213)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD, ON_THE_ROAD]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    assert.match(mounted.wrap.textContent, /RM 14\.00/, "a price is on the card");

    lookBtnOn(mounted)._listeners.click[0]();
    await settle();

    assert.equal(s.geocodes(), 2, "the press asked, so this is not a press that did nothing");
    assert.equal(st.customers[0].place.lat, 5.4141, "the door did not move");
    assert.match(mounted.wrap.textContent, /found the same spot/,
      "and the card says it found the same spot rather than staying silent on a press that ran");
    assert.match(mounted.wrap.textContent, /the road, not number 23/,
      "with the caveat still on it — asking twice does not make a road answer into a door");
    assert.match(mounted.wrap.textContent, /RM 14\.00/,
      "and the prices stand, because the spot they were quoted for has not changed");
    assert.doesNotMatch(mounted.wrap.textContent, /The door moved/,
      "nothing moved, and the card does not claim it did");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a re-ask that cannot be made leaves the door alone and says what happened (v213)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD, NO_ANSWER]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();
    const keptAt = st.customers[0].place.lat;

    lookBtnOn(mounted)._listeners.click[0]();
    await settle();

    assert.equal(st.customers[0].place.lat, keptAt, "a lookup that did not answer does not move the door");
    assert.match(mounted.wrap.textContent, /The address service could not be reached\./,
      "the reason the service gave reaches her, in its own words");
    assert.match(mounted.wrap.textContent, /The door has been left as it was\./,
      "and she is told that the pin she can see is still the one in force");
    assert.match(mounted.wrap.textContent, /RM 14\.00/, "the price stands, because nothing moved");
    assert.equal(lookBtnOn(mounted).disabled, false,
      "and the press is live again, so a second try is possible rather than a button left dead behind a failure");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

test("a re-ask that moves but still only reaches the road keeps the caveat (v213)", async () => {
  signIn();
  const s = stubGeocodeAsks([ON_THE_ROAD, STILL_THE_ROAD]);
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const order = SEAK_ORDER();
  const st = courierState();
  st.orders = [order];
  let mounted = null;
  try {
    mounted = mountDoor(st, order);
    await settle(4);
    buttonByText(mounted.wrap, "Get a delivery price")._listeners.click[0]();
    await settle();

    lookBtnOn(mounted)._listeners.click[0]();
    await settle();

    assert.equal(st.customers[0].place.lat, 5.418, "the door moved to the new point");
    assert.equal(st.customers[0].place.road, "23",
      "and the number that is STILL missing is stored with it, so the caveat survives the repaint");
    assert.match(mounted.doorSlot.textContent, /The lookup found the road, not number 23 — drag the pin to the door\./,
      "the card says the pin is the street, on the door's own line");
    assert.match(mounted.wrap.textContent, /The door moved, and it is still only the road, not number 23\./,
      "and the status line reports both facts at once, so a better point is not mistaken for the door");
    assert.doesNotMatch(mounted.wrap.textContent, /RM 14\.00/,
      "with the price for the old point taken away, because the door did move");
  } finally {
    closeDoor(mounted);
    s.restore();
    delete globalThis.window.L;
  }
});

// ── the ＋ New order card's courier half (v237, 30 Sep 2026) ────────────────
//
// The card gained four things in v237 — the delivery address, the courier charge, the
// tracking number and the parcel — and the biggest of them, the price section, is in
// this very file already for the very fault this suite exists to catch (see the v189
// note at the top of the test above). What is NEW is that the block is now reachable
// from the card rather than only from the Edit pop-up, so a stray `?: null` on it
// prints onto the screen she takes orders on.
//
// The shim in this file is the unforgiving one on purpose: it stringifies a non-node
// argument exactly as the browser does. The card's own test file drops nulls in its
// replaceChildren, so it cannot see this; this file can.

test("the card's courier half prints no stray 'null', with nothing filled in at all (v237)", () => {
  const root = createEl("div");
  doc.body.append(root);
  // No couriers on her list and no address typed: every optional line on the block is
  // taking its absent branch at once, which is where a bare `?: null` shows up.
  renderOrders(root, state(), new URLSearchParams({ date: "d10" }));
  buttonByText(root, "＋ New order")._listeners.click[0]();
  // Fold the courier half out, which is what builds the charge box, the parcel list and
  // the price section on the card.
  const sel = all(root).find((n) => n.tagName === "SELECT"
    && (n.children || []).some((o) => o.value === "courier"));
  sel.value = "courier";
  (sel._listeners.change || []).forEach((f) => f.call(sel));

  // The sentinel was "Courier tracking number" until v265, when that box stopped being
  // drawn on a courier order that names no parcel carrier — which is exactly this state.
  // The address line is the block's first and is drawn whenever Fulfillment says courier,
  // so it is the one line that can still prove the half unfolded.
  assert.match(root.textContent, /Delivery address \(if courier\)/,
    "the courier half really did unfold, so this is not passing over a screen with nothing on it");
  assert.deepEqual(strays(root), [], "no 'null' anywhere on the card");
  assert.deepEqual(strayObjects(root), [], "nor an element stringified into a line");
});
