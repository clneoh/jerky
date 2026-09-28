// test/store-address.test.js — the shop's typed-address flow, driven through the real
// page (v202, 26 Sep 2026).
//
// WHY THIS FILE IS DRIVEN AND NOT READ. test/store-lookup.test.js proves the RULES — what
// is worth asking, how a reply is read, how a late answer is thrown away — and it is pure.
// What it cannot see is the wiring: that typing in the box reaches the lookup at all, that
// a row the customer taps actually puts the pin on their door, that the map opens on THAT
// door and not on the island, and that Cancel does not throw their choice away. That is
// store/app.js's own code, and the only honest way to test it is to boot the page.
//
// The shim is the one test/store.pool.dom.test.js and test/store.avail.test.js already
// boot store/app.js with, plus a Leaflet — because this feature's whole point is that the
// map comes to the address, and a stub map that recorded nothing could not tell a map that
// flew there from one that opened on Penang. The rule kept here, as everywhere in this
// suite: every part of the shim models the part of the browser that MATTERS to the
// assertion, and in particular `document.head.append(script)` does NOT load anything.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the shim ───────────────────────────────────────────────────────────────

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    // What the browser does: variadic, and every argument that is not already a node is
    // converted with String() — so a null becomes a text node reading "null". Nothing in
    // THIS file depends on that (test/store.test.js holds the receipt's own assertion for
    // it), but a shim that drops nulls is the shape that hid three defects in this repo,
    // so it is not reintroduced here.
    replaceChildren(...cs) { this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) })); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
}

const registry = {};
const head = createEl("head");
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  head,
  body: createEl("body"),
};
globalThis.window = {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

// A Leaflet that records what it was asked to do. Not an approximation of Leaflet — a
// record of the calls the map makes, which is what the assertions below read.
const rec = { maps: [], views: [], tiles: [], markers: [] };
globalThis.window.L = {
  map(container, opts) {
    const m = {
      container, opts, removed: false, handlers: {},
      setView(center, zoom) { m.center = center; m.zoom = zoom; rec.views.push({ center, zoom }); return m; },
      addTo() { return m; }, on(evt, cb) { m.handlers[evt] = cb; return m; },
      remove() { m.removed = true; }, invalidateSize() {},
    };
    rec.maps.push(m);
    return m;
  },
  tileLayer(url, opts) { const t = { url, opts, addTo(map) { return t; } }; rec.tiles.push(t); return t; },
  marker(latlng, opts) {
    const mk = {
      latlng: { lat: latlng[0], lng: latlng[1] }, opts, handlers: {},
      addTo() { return mk; }, on(evt, cb) { mk.handlers[evt] = cb; return mk; },
      getLatLng() { return { ...mk.latlng }; }, setLatLng(ll) { mk.latlng = { lat: ll[0], lng: ll[1] }; },
    };
    rec.markers.push(mk);
    return mk;
  },
};

// What the lookup answers with. Set per test; everything that is not the lookup gets the
// empty array the shop's own data calls already answer with in the other store tests.
let reply = { ok: true, places: [] };
let asks = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/functions/v1/shop-geocode")) {
    asks.push({ url: u, body: opts.body });
    return { ok: true, status: 200, json: async () => reply };
  }
  return { ok: true, status: 200, json: async () => [] };
};

const { STORE } = await import("../store-lang.js");
const { setLang, resetPin } = await import("../store/app.js");

// ── helpers ────────────────────────────────────────────────────────────────

// A mocked clock fires a timer's CALLBACK, but everything the callback starts — the fetch
// promise, the lookup's own settle — is a promise reaction on the microtask queue. Without
// this the assertion reads the state before the answer lands. (test/store-map.test.js.)
const flush = async (rounds = 14) => { for (let i = 0; i < rounds; i++) await Promise.resolve(); };

// EVERY TEST BELOW DRIVES THE SAME BOOTED PAGE, so the module's own state — the pin, the
// box, the last list, the lookup — carries from one test straight into the next. That is
// not a theoretical worry: a fault sweep found the Cancel test passing off a pin a
// PREVIOUS test had left behind instead of the one it had just tapped, so it kept passing
// with the line that puts the tapped door back REMOVED. Each test therefore starts where a
// new customer starts, by calling the app's own between-customers reset rather than a
// test-only tidy — so this also exercises the code path that runs after every order.
function begin(t) {
  reply = { ok: true, places: [] };
  asks = [];
  rec.maps.length = 0; rec.views.length = 0; rec.tiles.length = 0; rec.markers.length = 0;
  resetPin();
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

const el = (id) => registry[id];
// Fire the listener the page registered, which is what a real tap does.
const fire = (node, type) => { for (const f of (node._listeners[type] || [])) f(); };

// The one action under test: the customer types. `wireLookup` listens on `input`, so this
// is the real path from keystroke to lookup to painted list.
function type(text) {
  const input = el("address-input");
  input.value = text;
  fire(input, "input");
}

const HIT = { lat: 5.4166, lng: 100.3311, label: "12, Jalan Bunga, Penang" };

// ── the flow ───────────────────────────────────────────────────────────────

test("typing an address brings up the doors, and tapping one opens the map ON it", async (t) => {
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };

  type("12 Jalan Bunga, Penang");
  assert.equal(asks.length, 0, "nothing is asked while they are still typing");
  t.mock.timers.tick(700);
  await flush();

  const list = el("addr-list");
  assert.equal(asks.length, 1, "one pause, one ask");
  assert.equal(list.hidden, false, "the list is on screen");
  assert.equal(list.children.length, 2, "one line explaining, one row per door");
  assert.equal(list.children[0].textContent, STORE.en.addrPick);
  assert.equal(list.children[1].textContent, HIT.label, "the row says which door it is");

  // The tap. Everything from here is the feature she asked for.
  fire(list.children[1], "click");
  await flush();

  assert.equal(rec.maps.length, 1, "the map was built — this is the 'bring them there' half");
  assert.deepEqual(rec.views[0].center, [HIT.lat, HIT.lng],
    "and it opened on the address they chose, not on the whole island");
  assert.equal(rec.views[0].zoom, 17, "close enough to see their own door");
  assert.equal(rec.markers.length, 1, "with the pin already on it");
  assert.equal(el("pin-box").hidden, false, "the box it lives in is open");
  assert.equal(el("pin-status").textContent, STORE.en.pinSet);
  assert.equal(el("pin-keep").disabled, false, "and 'Keep this spot' is live");
});

test("tapping a door while the map is already open aims THAT map, and Cancel keeps the door", async (t) => {
  // The customer opened the map first and had a look round. Then they typed an address and
  // tapped a door. Two things must hold: the map they are already looking at is the one
  // that flies (not a second one drawn over it), and Cancel must put back the door they
  // chose rather than the nothing that was there when the map session began — which is
  // exactly the state `begin` puts the page in below.
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };

  fire(el("pin-map"), "click");   // "Pin on the map" — opened by hand, nothing pinned yet
  await flush();
  assert.equal(rec.maps.length, 1, "the map is up, with no pin on it");

  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();

  assert.equal(rec.maps.length, 1, "ONE map — the open one was aimed, not rebuilt");
  assert.equal(rec.views.length, 2, "and a second setView, which is the flying");
  assert.deepEqual(rec.views[1].center, [HIT.lat, HIT.lng]);
  assert.equal(rec.views[1].zoom, 17);

  // Cancel. pinWasAt was moved onto the choice when they tapped, so this puts the pin back
  // to the door — a customer must not be able to undo a decision they did not make.
  fire(el("pin-cancel"), "click");
  await flush();
  assert.equal(el("pin-box").hidden, true, "the box is closed");
  assert.equal(el("pin-status").textContent, STORE.en.pinSet,
    "but the door they picked is still their pin — Cancel restored it, it did not erase it");
  assert.equal(el("pin-keep").disabled, false, "and it can still be kept");
});

test("a lookup that finds nothing says so, and the map is still one tap away", async (t) => {
  begin(t);
  reply = { ok: false, why: "notfound" };

  type("Nowhere At All, Penang");
  t.mock.timers.tick(700);
  await flush();

  const list = el("addr-list");
  assert.equal(list.hidden, false, "the customer is told something rather than left guessing");
  assert.equal(list.children.length, 1, "there is nothing to choose from, so there are no rows");
  assert.equal(list.children[0].textContent, STORE.en.addrNone);
  assert.match(STORE.en.addrNone, /pin on your door/i, "and it points at the map, which still works");
  assert.notEqual(el("pin-map").disabled, true,
    "the map button is untouched by a lookup that found nothing — the sale is never blocked");
});

test("the lookup being unavailable reads DIFFERENTLY from the address not existing", async (t) => {
  // Telling a customer their house does not exist when the bakery's server is simply down
  // is the wrong sentence, and it is the one that would make them stop trying.
  begin(t);
  reply = { ok: false, why: "unreachable" };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();

  const list = el("addr-list");
  assert.equal(list.children[0].textContent, STORE.en.addrFailed);
  assert.notEqual(list.children[0].textContent, STORE.en.addrNone);
});

test("emptying the box takes the list away — a stale list under an empty box is worse than none", async (t) => {
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  assert.equal(el("addr-list").hidden, false);

  type("");
  await flush();
  assert.equal(el("addr-list").hidden, true, "the list goes as the box empties");
  assert.equal(el("addr-list").children.length, 0, "and is emptied, not just hidden");
});

test("switching language says the SAME sentence again in the language just chosen", async (t) => {
  // The list holds a dictionary KEY, not a sentence, and this is why: a customer reading
  // 中文 who switches mid-list must not be left with an English line above their doors.
  begin(t);
  reply = { ok: false, why: "notfound" };
  setLang("en");
  type("Nowhere At All, Penang");
  t.mock.timers.tick(700);
  await flush();
  assert.equal(el("addr-list").children[0].textContent, STORE.en.addrNone);

  setLang("zh");
  await flush();
  assert.equal(el("addr-list").children[0].textContent, STORE.zh.addrNone,
    "the line was re-said in 中文, off the key rather than the sentence");
  setLang("en");
});

test("a door the lookup found but could not name is still a row, shown as its numbers", async (t) => {
  // A geocoder that found the point but sent no words still found the point. Dropping the
  // row would throw away a real door, and a blank row would be a tap that says nothing
  // about where it goes — which is the dead-control complaint this shop has a rule about.
  begin(t);
  reply = { ok: true, places: [{ lat: 5.4141, lng: 100.3288 }] };

  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();

  const list = el("addr-list");
  assert.equal(list.children.length, 2, "a nameless door is still a row to tap");
  assert.equal(list.children[1].textContent, "5.4141, 100.3288",
    "and it says where it is rather than leaving the row blank");

  fire(list.children[1], "click");
  await flush();
  assert.deepEqual(rec.views[0].center, [5.4141, 100.3288], "and it still takes them there");
  assert.equal(el("pin-status").textContent, STORE.en.pinSet);
});

test("choosing a door retires the instruction it obeyed, and a new answer brings it back", async (t) => {
  // "Tap the one that matches your address" is something to DO. The moment a door is taken,
  // the line under the map says the pin is set — and an instruction that outlives its own
  // action is the dead-control family this shop has a rule about. The ROWS stay, though:
  // changing your mind should be a second tap, not retyping the street.
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };

  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  const list = el("addr-list");
  assert.equal(list.children[0].textContent, STORE.en.addrPick, "the instruction is there to be obeyed");

  fire(list.children[1], "click");
  await flush();
  assert.equal(list.hidden, false, "the list is still there to choose from");
  assert.equal(list.children.length, 1, "the instruction is gone, the row it named is not");
  assert.equal(list.children[0].textContent, HIT.label, "and the row still says which door it is");

  // A second tap still lands — nothing about the choice froze the list.
  fire(list.children[0], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "the other door can still be taken");

  // Any fresh answer is a fresh question, so the instruction belongs on screen again.
  type("14 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  assert.equal(el("addr-list").children[0].textContent, STORE.en.addrPick,
    "asking again puts the instruction back — it is retired by a choice, not by the list");
  assert.equal(el("addr-list").children.length, 2);
});

// ── the phone is handed to the next customer (resetPin) ────────────────────

test("a placed order leaves no door and no list behind — the next customer starts clean", async (t) => {
  // The phone is passed across the counter after a sale. resetPin is what the page calls
  // the moment an order is placed, and a stranger's front door left on screen is the
  // small, ordinary harm this prevents.
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "the door is pinned to start with");
  // ONE child, not two: the instruction above the rows was retired by the tap below.
  assert.equal(el("addr-list").children.length, 1, "the row they tapped, with no instruction left over");

  resetPin();
  await flush();

  assert.equal(el("addr-list").hidden, true, "the list goes with the order");
  assert.equal(el("addr-list").children.length, 0, "and is emptied rather than merely hidden");
  assert.equal(el("pin-status").hidden, true, "and no door is still standing");
  assert.equal(el("pin-status").textContent, "");
  assert.equal(el("pin-keep").disabled, true, "so 'Keep this spot' is not live for a stranger");
});

test("an answer still in the air cannot land on the NEXT customer's empty box", async (t) => {
  // The other half of the same moment, and the one that is easy to miss: a lookup asked
  // for by the last customer can still be in the air when the order is placed. It must not
  // arrive a second later and put their house back on the screen.
  begin(t);
  let release;
  reply = new Promise((r) => { release = () => r({ ok: true, places: [{ ...HIT }] }); });

  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  resetPin();
  await flush();

  release();          // the lookup finally answers, to a box that has moved on
  await flush();

  assert.equal(el("addr-list").hidden, true, "the last customer's door never reappeared");
  assert.equal(el("addr-list").children.length, 0);
  assert.equal(el("pin-status").hidden, true);
});

// ── the pin and the address must be the same place (v204, 27 Sep 2026) ─────
//
// Her report, in her own words: "when the pin arrive at backoffice, it did not tally",
// and her clarification of it: the address on the order is one place and the pin sits
// somewhere else, both shown, contradicting each other. It was reached by typing an
// address, tapping a suggestion, and then editing the address — the pin stayed where the
// old words had put it, and the order went out carrying the new address beside it.
//
// A suggestion row is an ANSWER to the words that were in the box when it was drawn. The
// three tests below are the three ways that can go wrong, and the fourth is the order
// itself: what actually leaves the phone.

test("editing the address takes back the pin a suggestion gave, and says why (v204)", async (t) => {
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "the door is pinned to start with");

  type("14 Jalan Bunga, Penang");
  await flush();

  assert.equal(el("pin-status").textContent, STORE.en.pinAddrChanged,
    "the pin goes, and the customer is told rather than left holding a door that contradicts the box");
  assert.equal(el("pin-status").hidden, false, "and the line is on screen to be read");
  assert.equal(el("pin-keep").disabled, true, "there is nothing left to keep");
  // The list they were reading stays put until its replacement arrives: clearing it on
  // the keystroke is the flicker store/lookup.js exists to avoid, and it is not what
  // makes the pin wrong — the pin is already gone by the time they look. The instruction
  // above the row is already retired (they had chosen a door), so the row is alone.
  assert.equal(el("addr-list").hidden, false, "the rows their thumb was on do not vanish under it");
  assert.equal(el("addr-list").children.length, 1, "still the row they tapped");
  assert.equal(el("addr-list").children[0].textContent, HIT.label, "and it is the same row");
});

test("a pin the customer placed on the map is theirs, and an edit does not take it (v204)", async (t) => {
  // The other side of the same rule, and the reason the pin records WHERE IT CAME FROM
  // instead of an edit simply clearing the pin: a customer who tapped their own door on
  // the map, or stood at it pressing "Use my location", has answered the question by hand.
  // Nothing they type afterwards makes that answer wrong.
  begin(t);
  fire(el("pin-map"), "click");
  await flush();
  assert.equal(rec.maps.length, 1, "the map is open");
  rec.maps[0].handlers.click({ latlng: { lat: 5.5, lng: 100.4 } });   // a thumb on the map
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "a tap on the map is a pin");

  type("12 Jalan Bunga, Penang");
  await flush();

  assert.equal(el("pin-status").textContent, STORE.en.pinSet,
    "editing the address does not throw away a door they marked themselves");
  assert.equal(el("pin-keep").disabled, false, "and it can still be kept");
});

test("a suggestion the customer has already typed past cannot be taken (v204)", async (t) => {
  // The window the list is deliberately left open for. Rows drawn for the old wording are
  // still on screen for the length of the lookup's own pause, and a tap in that moment is
  // a tap on an answer to a question the box no longer asks. It is refused OUT LOUD — a
  // tap that does nothing is the dead-control fault this shop has a standing rule about.
  begin(t);
  reply = { ok: true, places: [{ lat: 5.41, lng: 100.33, label: "Old Street, Penang" }] };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  const list = el("addr-list");
  assert.equal(list.children.length, 2, "rows for the address they typed");

  type("14 Jalan Bunga, Penang");
  await flush();
  assert.equal(list.children.length, 2, "the rows for the old wording are still up while the new ask is out");
  fire(list.children[1], "click");
  await flush();

  assert.equal(el("pin-status").textContent, STORE.en.addrStale, "the tap is refused, and said");
  assert.equal(el("pin-keep").disabled, true, "no pin was set by it");
  assert.equal(list.hidden, true, "and the rows it came from are taken away with it");

  // And the recovery is ordinary: the answer to the new wording arrives and its rows work.
  t.mock.timers.tick(700);
  await flush();
  assert.equal(el("addr-list").children.length, 2, "the fresh list for the new address is up");
  fire(el("addr-list").children[1], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet,
    "and a row for the words the box really holds still lands");
});

test("a language switch does not loosen the claim on the rows (v204)", async (t) => {
  // The list is repainted on a language switch from the key it was drawn with, and the row's
  // claim on a wording has to be repainted with it. Dropping it there would leave the one
  // screen where a row can be tapped while it is out of date more permissive than any other,
  // and it would be invisible in English — the customer reads a sentence either way.
  begin(t);
  reply = { ok: true, places: [{ ...HIT }] };
  type("12 Jalan Bunga, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();

  setLang("zh");
  await flush();
  type("14 Jalan Bunga, Penang");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.zh.pinAddrChanged, "the pin goes, in 中文");

  fire(el("addr-list").children[0], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.zh.addrStale,
    "and the row left on screen is still refused, in 中文");
  assert.equal(el("pin-keep").disabled, true, "nothing was set by it");
  setLang("en");
});

test("the pin and the address the order carries agree — or the pin does not travel (v204)", async (t) => {
  // What actually leaves the phone, which is the whole of her report. Read off the POSTed
  // payload, not off the screen: the two halves of the same question, at the one moment
  // they are written down together.
  begin(t);
  reply = { ok: true, places: [{ lat: 5.3325, lng: 100.3020, label: "Taman Sri Nibong, George Town" }] };
  const realFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/functions/v1/shop-geocode")) {
      asks.push({ url: u, body: opts.body });
      return { ok: true, status: 200, json: async () => reply };
    }
    if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    // The shop's own menu, driven the way test/store.test.js drives it.
    registry["menu"].children[0]
      .children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0]();
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";

    type("Taman Sri Nibong, Penang");
    t.mock.timers.tick(700);
    await flush();
    fire(el("addr-list").children[1], "click");
    await flush();
    assert.equal(el("pin-status").textContent, STORE.en.pinSet, "a door is pinned from the list");

    // The customer edits the address to somewhere else entirely. This is the edit that
    // produced her report.
    type("Bayan Lepas, Penang");
    await flush();

    await registry["order-btn"].onclick();
    assert.ok(posted, "the order reached the backoffice");
    assert.equal(posted.address, "Bayan Lepas, Penang", "carrying the address the customer typed last");
    assert.equal(posted.place, undefined,
      "and NO pin — a pin found for Taman Sri Nibong, five kilometres away, has no business on it");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a pin taken from the list travels named with the customer's own words, not the row's (v205)", async (t) => {
  // The positive control for the test above, and the other half of her report. The pin the
  // bakery was receiving while the list was open was bare numbers, so her screen could print
  // "5.33250, 100.30204" beside an address that said something else. v204 gave the pin words,
  // but the WRONG words — the row's name for the place, which is a fragment of an address —
  // and that is the half she corrected: "the customer know their address well, when i tap the
  // address the address is not a complete one, if it is plaste into the address line, it will
  // contaminate the customer keyin address". So the row's name is used for NOTHING but the row.
  //
  // SINCE v214 THIS IS THE NARROW CASE, and the reason has become checkable rather than a rule
  // of thumb: the address typed here carries NO house number for the row to have found, so the
  // row is still refused entry to the box (addressFromRow, store/geo.js). Where the row DID find
  // the number, the box is written — v214's own tests, at the end of this file.
  begin(t);
  reply = { ok: true, places: [{ lat: 5.3325, lng: 100.3020, label: "Taman Sri Nibong, George Town" }] };
  const realFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/functions/v1/shop-geocode")) return { ok: true, status: 200, json: async () => reply };
    if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    registry["menu"].children[0]
      .children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0]();
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";

    type("Taman Sri Nibong, Penang");
    t.mock.timers.tick(700);
    await flush();
    fire(el("addr-list").children[1], "click");
    await flush();

    assert.equal(el("address-input").value, "Taman Sri Nibong, Penang",
      "the tap moved the pin and did NOT write the row's fragment into their address box — no house "
      + "number was typed for the row to have found, so v214 leaves their words exactly as they are");

    await registry["order-btn"].onclick();
    assert.ok(posted, "the order reached the backoffice");
    assert.equal(posted.address, "Taman Sri Nibong, Penang");
    assert.deepEqual(posted.place, { lat: 5.3325, lng: 100.302, label: "Taman Sri Nibong, Penang" },
      "the point travels named with THEIR words — one address, one point, nothing else named");
    assert.equal(posted.place.label, posted.address,
      "the address and the pin's name are one string, so her screen cannot show two places disagree");
    assert.doesNotMatch(String(posted.place.label), /George Town/,
      "the geocoder's name for that spot is a fragment and is not allowed on the order at all");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── a row that found the house writes the box (v214, 27 Sep 2026) ───────────
//
// Her instruction, verbatim: "the address is very accurate, it can go into the delivery
// address instead of customer type full". The rule that decides when a row may write lives
// in store/geo.js (addressFromRow) and is driven pure in test/store-lookup.test.js, side by
// side with the bakery's own house-number test. What only THIS file can see is the wiring:
// that the box really is filled, that the pin's claim on the wording moves with it, that the
// order carries the fuller address with the pin named by the same string, and that a row
// which only reached the road changes nothing but the dot.

const ROW = "23, Jalan Seang Tek, George Town, 10400 George Town, Pulau Pinang, Malaysia";
const ROW_AT = { lat: 5.4121, lng: 100.3355, label: ROW };

test("tapping a door that found the house fills the box, and the pin answers the words it wrote (v214)", async (t) => {
  begin(t);
  reply = { ok: true, places: [{ ...ROW_AT }] };

  type("23 Jalan Seang Tek, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();

  assert.equal(el("address-input").value, ROW,
    "the row's complete address went into the box in place of the part they typed");
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "and the pin is set, as always");

  // THE SECOND TAP, and this is the one line of the feature that is easy to get wrong. The row
  // stays on screen — an instruction is retired by a choice, not by the list — and it is still
  // an answer to a question the box asks, because the box now asks the row's own wording. Judge
  // it against the words they TYPED and it is refused as stale the instant the box is written,
  // which is a dead control sitting under their thumb.
  const list = el("addr-list");
  assert.equal(list.children.length, 1, "the row they tapped, with its instruction retired");
  fire(list.children[0], "click");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinSet,
    "tapping that same row again LANDS rather than being refused as out of date");

  // And the claim it now holds is the wording it wrote, so the ordinary edit still takes the
  // pin away — the v204 rule is not loosened by the box having been filled in for them.
  type("14 Jalan Seang Tek, Penang");
  await flush();
  assert.equal(el("pin-status").textContent, STORE.en.pinAddrChanged,
    "editing the address they were given still takes the pin, and says so");
});

test("a row that only reached the road moves the pin and leaves their words alone (v214)", async (t) => {
  begin(t);
  reply = { ok: true, places: [{ lat: 5.4141, lng: 100.3288, label: "Jalan Seang Tek, George Town, Penang" }] };

  type("23 Jalan Seang Tek, Penang");
  t.mock.timers.tick(700);
  await flush();
  fire(el("addr-list").children[1], "click");
  await flush();

  assert.equal(el("address-input").value, "23 Jalan Seang Tek, Penang",
    "their own words are untouched — the row never found the 23 they typed, so it has no business "
    + "rewriting an address it could not match");
  assert.equal(el("pin-status").textContent, STORE.en.pinSet, "but the pin still moves");
  assert.deepEqual(rec.views[0].center, [5.4141, 100.3288], "and the map still comes to them");
  assert.equal(rec.views[0].zoom, 17, "as close as before — a road answer is still the best the lookup has");
});

test("the order carries the address the row wrote, with the pin named by that same string (v214)", async (t) => {
  // What actually leaves the phone, which is the part she sees on her own screen. v205's promise
  // is that the address and the pin's name are ONE string; v214 changes which string, not the
  // promise — the order now carries a complete address rather than the customer's abbreviation.
  begin(t);
  reply = { ok: true, places: [{ ...ROW_AT }] };
  const realFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/functions/v1/shop-geocode")) return { ok: true, status: 200, json: async () => reply };
    if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    registry["menu"].children[0]
      .children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0]();
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";

    type("23 Jalan Seang Tek, Penang");
    t.mock.timers.tick(700);
    await flush();
    fire(el("addr-list").children[1], "click");
    await flush();

    await registry["order-btn"].onclick();
    assert.ok(posted, "the order reached the backoffice");
    assert.equal(posted.address, ROW, "carrying the complete address the row found");
    assert.deepEqual(posted.place, { lat: ROW_AT.lat, lng: ROW_AT.lng, label: ROW },
      "and the pin travels named by that same string — one address, one point, nothing else named");
  } finally {
    globalThis.fetch = realFetch;
  }
});
