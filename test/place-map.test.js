// test/place-map.test.js — the pin card's own map (admin/js/place_map.js, v238, 30 Sep 2026).
//
// WHY THIS FILE EXISTS. `mountPinMap` is the read-only map in the door block, and its own
// header said for two versions that it was "NOT pure, so not Node-tested" — a true statement
// about the file and an invitation to exactly the fault its sibling already had. test/store-map.test.js
// was written for store/pin_map.js for that same reason, after an overnight sweep broke four
// things there and every one came back green. This is the same treatment for this map.
//
// WHAT SHE REPORTED, and what this file is about: "the map are not allow to zoom out and
// dragging the pin to the right pin become extremely time consuming and prompt to error."
// The lock had been drawn around EVERYTHING — no pan, no pinch, no double-tap, no zoom
// control — so a stale pin could only be corrected by dragging a marker by hand across a map
// that refused to zoom out first. v238 draws the line where it belongs: the lock holds back
// what could move the PIN, and nothing else. The zoom is live the whole time.
//
// WHAT THIS SHIM MODELS, AND WHAT IT CANNOT. `mountPinMap`'s entire contract with Leaflet is
// two things: the OPTIONS it builds the map with, and the handler objects it enables and
// disables afterwards. Both are recorded faithfully here — a handler object is made for each
// of Leaflet's four, switched on according to the option, and every later enable/disable is
// kept. It is deliberately NOT a browser, and two things it therefore cannot settle, stated
// here rather than left looking covered:
//
//   1. Whether a real phone delivers the two-finger pinch to Leaflet or swallows it for the
//      page. That is gesture arbitration between the browser and Leaflet's own touchZoom, and
//      no Node shim closes it. What IS pinned below is the half that decides it: the option
//      and the handler state, and `touch-action: pan-y` (see the note in the test on it).
//   2. Whether the zoom control's two buttons visually overlap the marker inside the door
//      card's 200px box. That is layout, and it is a device question.
//
// Everything else here is driven: the pin is moved by firing the marker's own dragend, the
// map is tapped by firing the click handler the map registered, and the assertions read the
// pin and the callback rather than the source.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the shim ───────────────────────────────────────────────────────────────
//
// A node that keeps its children, its listeners, its attributes and its inline style — the
// style because `touch-action` is the one CSS property this file writes and reads back.
function makeEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, _listeners: {}, parentNode: null, isConnected: true,
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
}

// A lazy registry rather than `() => null`: this file opens no dialog, but a shim that
// answers "no such element" for a name the app does use is the forgiving kind that hides a
// fault, and nothing is gained by making this one different from the app's own tests.
const layers = {};
globalThis.document = {
  createElement: makeEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  head: makeEl("head"),
  body: makeEl("body"),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: (id) => (layers[id] ||= makeEl("div")),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// A Leaflet that records what it was asked for. Not an approximation of Leaflet: a record of
// the two things this file can say to it — the options, and each handler's on/off state.
function makeHandler(name) {
  return {
    name, enabled: false, flips: [],
    enable() { this.enabled = true; this.flips.push("enable"); },
    disable() { this.enabled = false; this.flips.push("disable"); },
  };
}

function makeLeaflet() {
  const rec = { maps: [], markers: [], views: [] };
  const L = {
    map(container, opts) {
      const m = {
        container, opts, removed: false, sized: 0, handlers: {},
        setView(center, zoom) { m.center = center; m.zoom = zoom; rec.views.push({ center, zoom }); return m; },
        getZoom() { return m.zoom; },
        getContainer() { return container; },
        on(evt, cb) { (m.handlers[evt] ||= []).push(cb); return m; },
        off(evt, cb) {
          const l = m.handlers[evt] || [];
          const i = l.indexOf(cb);
          if (i >= 0) l.splice(i, 1);
          return m;
        },
        remove() { m.removed = true; },
        invalidateSize() { m.sized += 1; },
      };
      // Leaflet builds a handler object per zoom/pan option and switches it on according to
      // that option. Modelling that here is what lets an assertion be about the MAP rather
      // than about a literal in the source.
      for (const k of ["dragging", "touchZoom", "doubleClickZoom", "boxZoom"]) {
        m[k] = makeHandler(k);
        if (opts[k]) m[k].enabled = true;
      }
      rec.maps.push(m);
      return m;
    },
    tileLayer(url, opts) {
      return { url, opts, addTo(map) { map.tile = this; return this; } };
    },
    marker(latlng, opts) {
      const mk = {
        latlng: Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : { ...latlng },
        opts, handlers: {},
        dragging: makeHandler("marker.dragging"),
        addTo(map) { mk.addedTo = map; map.marker = mk; return mk; },
        on(evt, cb) { (mk.handlers[evt] ||= []).push(cb); return mk; },
        getLatLng() { return { lat: mk.latlng.lat, lng: mk.latlng.lng }; },
        setLatLng(ll) { mk.latlng = { lat: ll[0], lng: ll[1] }; },
      };
      mk.dragging.enabled = !!opts.draggable;
      rec.markers.push(mk);
      return mk;
    },
  };
  return { L, rec };
}

const tick = (ms = 8) => new Promise((r) => setTimeout(r, ms));

const DOOR = { lat: 5.4299, lng: 100.3399 };

// The module is imported once: it caches nothing across mounts (see loadLeaflet), and every
// test below hands it a fresh `window.L` before it is used.
const { mountPinMap } = await import("../admin/js/place_map.js");

async function mount({ place = DOOR } = {}) {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;
  const box = makeEl("div");
  const moves = [];
  const handle = mountPinMap(box, { place, onMove: (p) => moves.push(p) });
  await tick();
  return { box, moves, handle, rec: leaf.rec, map: leaf.rec.maps[0], marker: leaf.rec.markers[0] };
}

// ── the zoom is not part of the lock (v238) ────────────────────────────────

test("the pin card's map carries the zoom control, so she can zoom out without unlocking anything (v238)", async () => {
  const { map } = await mount();
  assert.ok(map, "the map was built");
  assert.equal(map.opts.zoomControl, true,
    "the plus and minus are drawn on a card that is only being looked at — this is the half of her report a button answers, whatever any browser does with a pinch");
});

test("pinch, double-tap and the desktop box zoom are live before she unlocks anything (v238)", async () => {
  const { map } = await mount();
  assert.equal(map.touchZoom.enabled, true, "pinch zooms the map while the card is locked");
  assert.equal(map.doubleClickZoom.enabled, true, "and a double-tap does");
  assert.equal(map.boxZoom.enabled, true, "and so does the desktop box zoom");
  assert.deepEqual(map.touchZoom.flips, [],
    "and nothing switched it off on the way in, so this is how the map OPENS rather than how it ends up");
});

test("the lock still holds what could move the pin, and lets both go together when she unlocks", async () => {
  const { map, marker, handle } = await mount();
  assert.equal(map.dragging.enabled, false,
    "panning is held back: a pan under a pin she is reading would let a reach-past nudge the view");
  assert.equal(marker.opts.draggable, false, "and the pin itself cannot be dragged");
  assert.equal(marker.dragging.enabled, false, "with its own drag handler off to match");
  assert.equal(map.handlers.click, undefined,
    "and no tap places a point, because the map has registered no click handler at all");

  handle.setDraggable(true);
  assert.equal(map.dragging.enabled, true, "unlocked, the map pans");
  assert.equal(marker.dragging.enabled, true, "and the pin drags");
  assert.equal((map.handlers.click || []).length, 1, "and a tap is now a way to place a point");
});

test("re-locking takes the pan away and leaves the zoom alone (v238)", async () => {
  const { map, handle } = await mount();
  handle.setDraggable(true);
  handle.setDraggable(false);

  assert.equal(map.dragging.enabled, false, "the pan goes back behind the lock");
  assert.equal(map.touchZoom.enabled, true,
    "and the pinch does NOT — a lock that also took the zoom away is the fault this version is about");
  assert.equal(map.doubleClickZoom.enabled, true, "the same for the double-tap");
  assert.equal(map.boxZoom.enabled, true, "and the box zoom");
});

// ── the pin does not move under a finger that was only looking ─────────────

test("a tap on a locked map places nothing, and places a point once she unlocks it", async () => {
  const { map, moves, handle, marker } = await mount();
  const start = { lat: marker.latlng.lat, lng: marker.latlng.lng };

  // Locked there is no handler to fire — asserted above — so the way to make this a real
  // check rather than a tautology is to unlock, tap, and read where the pin went.
  handle.setDraggable(true);
  (map.handlers.click || [])[0]({ latlng: { lat: 5.4172, lng: 100.3311 } });
  assert.deepEqual(moves, [{ lat: 5.4172, lng: 100.3311 }], "an unlocked tap reports the point it landed on");
  assert.notDeepEqual({ lat: marker.latlng.lat, lng: marker.latlng.lng }, start,
    "and the pin really moved to it");

  handle.setDraggable(false);
  assert.equal(map.handlers.click.length, 0,
    "re-locked, the tap handler is off the map, so the same tap can no longer place anything");
});

test("dragging the pin does nothing while the card is only being looked at (v238)", async () => {
  const { marker, moves, handle } = await mount();
  const drag = { target: { getLatLng: () => ({ lat: 5.5, lng: 100.4 }) } };
  const before = { lat: marker.latlng.lat, lng: marker.latlng.lng };

  marker.handlers.dragend[0](drag);
  assert.deepEqual(moves, [], "a locked pin reports no move, however far it was 'dragged'");
  assert.deepEqual({ lat: marker.latlng.lat, lng: marker.latlng.lng }, before, "and it is still where it was");

  handle.setDraggable(true);
  marker.handlers.dragend[0](drag);
  assert.deepEqual(moves, [{ lat: 5.5, lng: 100.4 }], "unlocked, the same drag reports the new point");
  assert.deepEqual({ lat: marker.latlng.lat, lng: marker.latlng.lng }, { lat: 5.5, lng: 100.4 },
    "and the pin is on it");
});

// ── the box's own touch-action ─────────────────────────────────────────────

test("a locked map lets the card scroll past it, and takes the whole finger once unlocked", async () => {
  const { box, handle } = await mount();
  assert.equal(box.style.touchAction, "pan-y",
    "locked, the browser may scroll this box vertically and nothing else — the card's own scroll, which a picture of a door has no business blocking");
  handle.setDraggable(true);
  assert.equal(box.style.touchAction, "none",
    "unlocked, the map owns the finger, exactly like the picker's map");

  // AND WHY "pan-y" AND NOT "pan-y pinch-zoom", which is the value that looks like the
  // obvious companion change and is not one. `pan-y` declines the pinch on the browser's
  // behalf, so the touch events keep arriving and Leaflet's own touchZoom answers them.
  // Naming `pinch-zoom` would hand that same gesture to the BROWSER, which zooms the whole
  // page out from under the card and never lets the map see it. One value zooms the map, the
  // other zooms the app, and only one of them is what she asked for.
  assert.doesNotMatch(box.style.touchAction, /pinch-zoom/,
    "so the pinch stays Leaflet's, which is the only way the zoom above can ever be reached by a finger");
});

test("destroy takes the map off the page and forgets the pin, so a closed card leaves nothing running", async () => {
  const { handle, map } = await mount();
  handle.destroy();
  assert.equal(map.removed, true, "the map removed itself");
  handle.setPlace({ lat: 5.5, lng: 100.5 });
  assert.equal(map.removed, true, "and a repaint arriving after the card closed does not bring it back");
});

// ── a rebuilt card does not leave the map it replaced running (v254) ───────
//
// WHAT SHE REPORTED, and what this section is about: "the add order is becoming unstable,
// sometimes not sure what happen." The card rebuilds itself often — a changed Fulfillment, a
// day tapped in its own calendar, a sync pull — and every rebuild made a FRESH door slot and
// dropped the old one. Nothing told this file. The destroyed-on-resize listener above was the
// only thing that would ever notice, so until the keyboard next opened or closed, each orphan
// kept its tiles AND its `window` listener, and answered resize calls for the rest of the
// session. One phone, one form she types in all day.
//
// The sweep is deferred by a microtask, and THIS test is what that deferral is for. The order
// below is the point: the app builds the new block as an ARGUMENT to `replaceChildren`, so the
// new map is mounted while the old box is STILL on the page, and the old box is detached only
// afterwards. A synchronous sweep at mount time therefore reaps nothing — the orphan it is
// looking for is still connected when it asks. So the test mounts the replacement FIRST and
// disconnects the old box second, which is the real sequence, and `tick()` stands in for the
// caller finishing its swap. (Written the other way round — disconnect, then mount — the test
// passes with either version of the sweep and proves nothing about the deferral.)

test("a rebuilt card does not leave the map it replaced running (v254)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;

  const first = makeEl("div");
  mountPinMap(first, { place: DOOR });
  await tick();
  const map1 = leaf.rec.maps[0];
  assert.ok(map1 && !map1.removed, "the first card's map is up");

  // The replacement is built while the block it replaces is still on the page — at this instant
  // the old box answers `isConnected` true, exactly as it does inside the app's own swap.
  const second = makeEl("div");
  mountPinMap(second, { place: DOOR });
  assert.equal(first.isConnected, true,
    "the old box is still connected while the new block is built, which is what makes the sweep's timing matter");
  first.isConnected = false; // …and only now does replaceChildren detach it
  await tick();

  assert.equal(map1.removed, true,
    "the map the rebuilt card left behind is destroyed, rather than kept alive answering resize calls for the rest of the session");
  assert.ok(leaf.rec.maps[1] && !leaf.rec.maps[1].removed,
    "and the map that replaced it is untouched — the sweep must not eat the new card's own map");
});

test("a map still on the page survives every later mount (v254)", async () => {
  const leaf = makeLeaflet();
  globalThis.window.L = leaf.L;

  const kept = makeEl("div");
  mountPinMap(kept, { place: DOOR });
  await tick();

  mountPinMap(makeEl("div"), { place: DOOR });
  mountPinMap(makeEl("div"), { place: DOOR });
  await tick();

  assert.equal(leaf.rec.maps[0].removed, false,
    "a box that is still on the page is not an orphan, however many cards are built after it");
});
