// test/store-map.test.js — the shop's own map (store/pin_map.js, v197, 25 Sep 2026).
//
// WHY THIS FILE EXISTS. store/pin_map.js had no test of its own: it was checked only
// indirectly, by two tests in test/store-pin.test.js that read its SOURCE and compare the
// Leaflet version and the CDN against the bakery's map. That is a real check, but it
// notices nothing about what the map DOES. An overnight fault sweep broke four things in
// this file and in the flow around it and every one of them came back green:
//
//   O01  validPoint's range check removed   — an off-planet pin was flown to
//   O02  the CDN timeout zeroed             — a map that answered a tick late was declared dead
//   O08  askGeo's second answer             — see test/store-pin.test.js (inert; proven there)
//   O14  the offer button's label changed   — see test/delivery-run.test.js
//
// So the map is now DRIVEN, not read. That needs a DOM and a Leaflet, and the whole risk
// in writing them is the one this project has been burned by four times: a forgiving shim
// that answers whatever the code asks and so can never fail. The rule kept here is that
// every part of the shim models the part of the browser that MATTERS to the assertion:
//  - `document.head.append(script)` does NOT call onload; a test says when the CDN answers,
//    and can choose to have it never answer. A shim that loaded the script synchronously
//    would make the timeout (O02) untestable, which is exactly how it went unnoticed.
//  - the Leaflet stub records every setView, every marker and every handler, so an
//    assertion can be about the MAP rather than about the DOM around it.
//  - `window.L` is real and settable, because "Leaflet is already on the page" is a case
//    the code deliberately handles and a shim that always fetched would hide it.
//
// The module is imported FRESH in each test (`?case=n`), because store/pin_map.js caches
// its load promise in a module-level `loading` — and a cached "the CDN is down" from one
// test would silently decide the next one.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the shim ───────────────────────────────────────────────────────────────
//
// A node that keeps its children and its listeners, and models the ONE thing about
// append() that matters here: nothing is loaded by being appended.
function makeEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, _listeners: {}, parentNode: null,
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } return c; },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; }
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    contains: () => false,
    focus() {}, click() {},
  };
  if (String(tag || "").toLowerCase() === "script" && scriptPlan) {
    const plan = scriptPlan;
    // The CDN answering — on a timer, so a test can put the answer either side of the
    // timeout. Never synchronous: a script that appeared the instant it was appended
    // could never be late, and the timeout would be untestable.
    setTimeout(() => {
      if (plan.L) globalThis.window.L = plan.L;
      if (typeof node.onload === "function") node.onload();
    }, plan.delayMs);
  }
  return node;
}

const head = makeEl("head");
// What a test wants the CDN to do: null = never answer at all.
let scriptPlan = null;

globalThis.document = {
  createElement: makeEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  head,
  body: makeEl("body"),
  querySelector: (sel) => (String(sel).includes("data-leaflet")
    ? head.children.find((c) => c.tagName === "LINK" && c.attrs["data-leaflet"]) || null
    : null),
  querySelectorAll: () => [],
  getElementById: () => null,
};
globalThis.window = {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

// A Leaflet that records what it was asked to do. Not an approximation of Leaflet —
// a record of the calls the map makes, which is what every assertion below reads.
function makeLeaflet() {
  const rec = { maps: [], views: [], tiles: [], markers: [] };
  const L = {
    map(container, opts) {
      const m = {
        container, opts, removed: false, sized: 0, handlers: {},
        setView(center, zoom, ...rest) { m.center = center; m.zoom = zoom; rec.views.push({ center, zoom }); m._rest = rest; return m; },
        addTo() { return m; },
        on(evt, cb) { m.handlers[evt] = cb; return m; },
        remove() { m.removed = true; },
        invalidateSize() { m.sized += 1; },
      };
      rec.maps.push(m);
      return m;
    },
    tileLayer(url, opts) {
      const t = { url, opts, addedTo: null, addTo(map) { t.addedTo = map; map.tile = t; return t; } };
      rec.tiles.push(t);
      return t;
    },
    marker(latlng, opts) {
      const mk = {
        latlng: Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : { ...latlng }, opts, handlers: {},
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

const tick = (ms = 8) => new Promise((r) => setTimeout(r, ms));

// A fake clock fires a timer's CALLBACK, but everything the callback starts — a rejection
// travelling to the .catch that tells the customer — is a promise reaction, which runs on
// the microtask queue. Without this the assertion reads the state before the answer lands.
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await Promise.resolve(); };

// A fresh module per test — see the note at the top about the cached `loading`.
let caseNo = 0;
const freshPinMap = () => import(`../store/pin_map.js?case=${++caseNo}`);

// Where the map opens when nothing is known: Penang, the bakery's own island.
const HOME = { lat: 5.4141, lng: 100.3288, zoom: 13 };

function setup({ leaflet = null, plan = null } = {}) {
  scriptPlan = plan;
  globalThis.window.L = leaflet ? leaflet.L : null;
  head.children = [];
  return { host: makeEl("div"), L: leaflet ? leaflet.L : null, rec: leaflet ? leaflet.rec : null };
}

// ── what the map will accept as a point (O01) ──────────────────────────────
//
// store/geo.js decides what a POINT is for the order, and is tested. This is the
// narrower question the MAP asks before it flies anywhere: are these two numbers fit
// to hand to Leaflet. It is asked again here because `start` and `goTo` arrive from
// callers that are not this file.

test("an off-planet starting point is refused — the map opens at home, not at 91°N (O01)", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  showPinMap(host, { start: { lat: 91, lng: 100 }, onMove: () => {} });
  await tick();

  assert.equal(rec.views.length, 1, "the map opened exactly once");
  assert.deepEqual(rec.views[0].center, [HOME.lat, HOME.lng],
    "a latitude of 91 is not a place: the map opens on the district, not on the impossible pin");
  assert.equal(rec.views[0].zoom, HOME.zoom,
    "and at the district's own zoom, not the pin zoom a real starting point gets");
  assert.equal(rec.markers.length, 0, "and nothing is pinned, because there was no point to pin");
});

test("a real starting point IS flown to and pinned — so the refusal above means something", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  showPinMap(host, { start: { lat: 5.42, lng: 100.33 }, onMove: () => {} });
  await tick();

  assert.deepEqual(rec.views[0].center, [5.42, 100.33], "the customer's own point is where the map opens");
  assert.equal(rec.views[0].zoom, 17, "at the pin zoom, because there is somewhere to look at");
  assert.equal(rec.markers.length, 1, "with the pin already on it");
});

test("goTo ignores an off-planet point and moves for a real one (O01)", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  const handle = showPinMap(host, { onMove: () => {} });
  await tick();
  const opened = rec.views.length;

  handle.goTo({ lat: 5.5, lng: 200 });
  assert.equal(rec.views.length, opened,
    "a longitude of 200 does not exist, so the map is not flown to it");

  handle.goTo({ lat: 5.4166, lng: 100.3311 });
  assert.equal(rec.views.length, opened + 1, "a real point does move it");
  assert.deepEqual(rec.views[rec.views.length - 1].center, [5.4166, 100.3311]);
});

// ── aiming the map before it is up (v202) ──────────────────────────────────
//
// Until v202 a `goTo` that arrived while the CDN was still fetching was a silent no-op,
// and this file's own comment said so. That was true and it was also a defect nobody had
// hit: the shop had no way to aim the map except by opening it. The typed-address lookup
// (store/lookup.js) made it reachable — the box can already be open and still loading when
// the customer taps an address they typed — and a dropped aim there is not a no-op the
// customer never notices: the map finishes loading on the OLD point, `put(at)` fires
// `onMove` for it, and the pin they just chose is silently written over. That is the
// class of fault this project hunts, so the aim is remembered.

test("a point aimed at the map BEFORE it is up is where it opens — the tap is not thrown away", async () => {
  const { L, rec } = makeLeaflet();
  const { host } = setup({ plan: { delayMs: 5, L } });
  const { showPinMap } = await freshPinMap();

  const moved = [];
  const handle = showPinMap(host, { start: { lat: 5.42, lng: 100.33 }, onMove: (p) => moved.push(p) });
  // The customer taps an address the lookup found, while the CDN is still fetching. The
  // point they tapped is 5.4166,100.3311; the point the box opened with was 5.42,100.33.
  handle.goTo({ lat: 5.4166, lng: 100.3311 });

  await tick(40);

  assert.equal(rec.maps.length, 1, "the map was built");
  assert.deepEqual(rec.views[0].center, [5.4166, 100.3311],
    "and it opened on the address they chose, not on the one the box started with");
  assert.equal(rec.views[0].zoom, 17, "at the pin zoom, because there is a door to look at");
  assert.deepEqual(moved, [{ lat: 5.4166, lng: 100.3311 }],
    "the pin is the chosen point, and NOTHING was reported for the old one");
  assert.equal(moved.some((p) => p && p.lat === 5.42), false,
    "the point they replaced must never reach onMove — that would undo their own choice");
});

test("a point aimed at an ALREADY OPEN map flies it there rather than rebuilding it", async () => {
  // The other half of the same moment: the box was opened a while ago and the map is up,
  // so the customer's earlier look around must not be thrown away for a second map.
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  const handle = showPinMap(host, { start: { lat: 5.42, lng: 100.33 }, onMove: () => {} });
  await tick();
  assert.equal(rec.maps.length, 1);

  handle.goTo({ lat: 5.4166, lng: 100.3311 });

  assert.equal(rec.maps.length, 1, "one map, not a second one drawn over it");
  assert.equal(rec.views.length, 2, "and a second setView, which is the flying");
  assert.deepEqual(rec.views[1].center, [5.4166, 100.3311]);
  assert.equal(rec.views[1].zoom, 17);
});

test("a point aimed at a map that has since been stopped is dropped, not flown to", async () => {
  // The box is closed. `stop()` clears the remembered aim as well as the map, so a lookup
  // that answers a moment late cannot fly a map that is no longer on screen.
  const { L, rec } = makeLeaflet();
  const { host } = setup({ plan: { delayMs: 5, L } });
  const { showPinMap } = await freshPinMap();

  const handle = showPinMap(host, { onMove: () => {} });
  handle.goTo({ lat: 5.4166, lng: 100.3311 });
  handle.stop();

  await tick(40);
  assert.equal(rec.maps.length, 0, "the stopped map was never built, aim or no aim");
});

// ── loading Leaflet, and giving up on it (O02) ─────────────────────────────

test("a CDN that answers a moment later still yields a map — the timeout is not zero (O02)", async () => {
  // The whole point of LOAD_MS. A CDN is never instant; a map declared dead on the tick
  // it was asked for is a map no customer could ever see, and it would fail in exactly
  // the way the deadline exists to prevent. Driven by a real timer here so the ordering
  // against the deadline is the browser's own.
  const { L, rec } = makeLeaflet();
  const { host } = setup({ plan: { delayMs: 5, L } });
  const { showPinMap } = await freshPinMap();

  const moved = [];
  showPinMap(host, { onMove: (p) => moved.push(p) });
  await tick(40);

  assert.deepEqual(moved, [], "the map was not given up on — nothing was reported broken");
  assert.equal(rec.maps.length, 1, "the map was drawn");
  assert.equal(host.dataset.failed, undefined, "and the box was not marked as failed");
  assert.equal(head.children.some((c) => c.tagName === "SCRIPT"), true, "the CDN was asked");
});

test("a CDN that never answers is given real time, then declared dead (O02)", async (t) => {
  // The other half: a spinner must not sit in the basket forever. The clock is faked so
  // the deadline can be crossed in a millisecond of real time — and it is the same fake
  // that proves the wait is a real one, because a zero deadline fails at the first tick.
  const { host } = setup({ plan: null });
  const { showPinMap } = await freshPinMap();

  // The clock is faked BEFORE the screen asks: a timer scheduled before the mock is
  // enabled is not tracked by it, so the deadline below would never be reached.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const moved = [];
  const handle = showPinMap(host, { onMove: (p) => moved.push(p) });
  assert.ok(handle, "the caller gets its handle straight away, before the CDN answers");

  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(moved, [], "a second in, a CDN that has not answered is not yet dead");

  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(moved, [null],
    "and once the deadline passes the customer is told, in the one way the caller listens for");
  assert.equal(host.dataset.failed, "1", "the box is marked as failed");
  assert.equal(host.children.length, 0, "and the empty map is taken back out of it");
});

test("a map that answers too late does not draw over the failure it already reported", async (t) => {
  // stop() is the caller's own guarantee, and it has to hold against a slow CDN: the
  // box may be closed and reopened while the first fetch is still in the air.
  const { L, rec } = makeLeaflet();
  const { host } = setup({ plan: { delayMs: 5000, L } });
  const { showPinMap } = await freshPinMap();

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const handle = showPinMap(host, { onMove: () => {} });
  handle.stop();
  t.mock.timers.tick(10000);
  await Promise.resolve();

  assert.equal(rec.maps.length, 0, "a map torn down before the CDN answered is never built");
  assert.equal(host.children.length, 0, "and the box it would have been drawn into stays empty");
});

// ── the map itself ─────────────────────────────────────────────────────────

test("tapping the map puts the pin there — the only way a thumb can aim it (P12)", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  const moved = [];
  showPinMap(host, { onMove: (p) => moved.push(p) });
  await tick();

  const map = rec.maps[0];
  assert.equal(typeof map.handlers.click, "function", "the map is listening for a tap");
  map.handlers.click({ latlng: { lat: 5.4166, lng: 100.3311 } });

  assert.deepEqual(moved, [{ lat: 5.4166, lng: 100.3311 }], "the tap became the point");
  assert.equal(rec.markers.length, 1, "and a pin was dropped for it");

  // A second tap MOVES the one pin rather than stacking a second one on the map.
  map.handlers.click({ latlng: { lat: 5.4177, lng: 100.3322 } });
  assert.equal(rec.markers.length, 1, "one door, one pin");
  assert.deepEqual(moved[1], { lat: 5.4177, lng: 100.3322 });
});

test("dragging the pin reports the door it was dragged to", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  const moved = [];
  showPinMap(host, { start: { lat: 5.42, lng: 100.33 }, onMove: (p) => moved.push(p) });
  await tick();

  const marker = rec.markers[0];
  assert.equal(marker.opts.draggable, true, "the pin is a pin you can drag");
  marker.setLatLng([5.4211, 100.3311]);
  marker.handlers.dragend();

  assert.deepEqual(moved[moved.length - 1], { lat: 5.4211, lng: 100.3311 },
    "the drop point is reported, read back off the pin itself");
});

test("stop() takes the map down AND empties the box (P11)", async () => {
  const { host, rec } = setup({ leaflet: makeLeaflet() });
  const { showPinMap } = await freshPinMap();

  const handle = showPinMap(host, { onMove: () => {} });
  await tick();
  assert.equal(host.children.length, 1, "the canvas the map was drawn into");

  handle.stop();

  assert.equal(rec.maps[0].removed, true, "Leaflet's own teardown was called");
  assert.equal(host.children.length, 0,
    "and the box is emptied — a closed box that keeps a dead canvas is the second map nobody asked for");
});

test("Leaflet already on the page is reused, and no CDN is fetched (P13)", async () => {
  // The second press on "Pin on the map" must not fetch Leaflet again, and neither must a
  // press on a page where it is already loaded.
  const made = makeLeaflet();
  const { host, rec } = setup({ leaflet: made });
  const { showPinMap } = await freshPinMap();

  showPinMap(host, { onMove: () => {} });
  await tick();

  assert.equal(rec.maps.length, 1, "the map was drawn from the Leaflet already here");
  assert.equal(head.children.some((c) => c.tagName === "SCRIPT"), false,
    "and nothing was fetched for it — no script tag, so no second copy of Leaflet");
  assert.equal(head.children.some((c) => c.tagName === "LINK"), false, "and no second stylesheet");
});

test("a CDN that loads but arrives empty is a failure, not a blank map (O02)", async () => {
  // The script fired onload and `window.L` still is not there — a truncated response, or
  // a page that has since navigated. Treated as dead, because a canvas with no map in it
  // is a spinner by another name.
  const { host } = setup({ plan: { delayMs: 5, L: null } });
  const { showPinMap } = await freshPinMap();

  const moved = [];
  showPinMap(host, { onMove: (p) => moved.push(p) });
  await tick(40);

  assert.deepEqual(moved, [null], "the customer is told the map is not available");
  assert.equal(host.dataset.failed, "1");
  assert.equal(host.children.length, 0, "and the empty canvas is taken back out");
});
