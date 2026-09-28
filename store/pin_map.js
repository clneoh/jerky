// store/pin_map.js — the shop's map, one pin, dragged onto the customer's door
// (v197, 25 Sep 2026).
//
// WHY THE SHOP HAS ITS OWN MAP INSTEAD OF THE ADMIN'S. Your
// admin/js/place_map.js is a card built on the admin's pop-up layer, which arranges
// the whole screen around one card and replaces whatever was on it. This page has no
// such layer and wants none: what the shop needs is smaller — a map, a pin, and the
// point — so it is its own ~80 lines.
//
// IT USED TO SAY MORE THAN THAT HERE, and the correction is worth keeping. Until v202
// this header gave a second reason: that the shop had "no business asking a geocoder,
// because that would send customers' home addresses out of their own phones to a
// public service". That is no longer true of the shop, by her decision and in her words
// ("Through your own Supabase") — as the customer types their address the page now asks
// her own Supabase function, which asks Photon and then Nominatim with your
// name on the request rather than the customer's phone (store/lookup.js,
// supabase/functions/shop-geocode). Nothing about that reaches this file: the map here
// is still a map, a pin and a point, and it has never known where the point came from.
//
// The cost of that choice is a second copy of the Leaflet version, the CDN, the
// tiles and the attribution — so a test reads both files and fails if the two ever
// disagree. A version bump that only reaches one of them is the failure that would
// otherwise ship silently.
//
// THE TILES ARE ASKED FOR THE WAY OpenStreetMap's usage policy requires: a real
// attribution, no bulk, no scraping, and only the tiles somebody is looking at.
// Nothing about the customer is sent to the tile server — a tile request carries a
// zoom level and a square of the world, and that is all it carries.
//
// NOT pure, so not Node-tested by itself: this file is a map and nothing else. Every
// rule about what a POINT is lives in store/geo.js, which is pure and tested.

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// A CDN that never answers must not leave a spinner in the basket forever. Past
// this the map is declared unavailable and the customer is told to type their
// address instead — which is the box directly above it, and always works.
const LOAD_MS = 9000;
// Where the map opens when nothing is known yet: Penang, which is where you
// is and where every order is going. A starting view is not a place — nothing is
// pinned by it.
const HOME = { lat: 5.4141, lng: 100.3288, zoom: 13 };

let loading = null;

// A point Leaflet can be handed, or null. The shop's own rule about what a point
// IS lives in store/geo.js; this is the narrower question of whether the two
// numbers are fit to pass to the map, and it is asked again here because `start`
// and `goTo` arrive from callers that are not this file.
function validPoint(p) {
  if (!p) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Leaflet, fetched once per page life — and ONLY when a customer presses the map
// button, so somebody pinning from their own doorstep never downloads it. A failure
// clears the promise rather than caching it, so an attempt after the signal comes
// back can still succeed: a cached "the CDN is down" is a claim about now that
// outlives now.
export function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = (why) => { loading = null; reject(new Error(why)); };
    const timer = setTimeout(() => fail("it did not load in time"), LOAD_MS);
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      link.setAttribute("data-leaflet", "1");
      document.head.append(link);
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (window.L && window.L.map) resolve(window.L);
      else fail("it loaded but did not arrive");
    };
    script.onerror = () => { clearTimeout(timer); fail("it could not be fetched"); };
    document.head.append(script);
  });
  return loading;
}

// Draw the map into `host`, with one pin the customer can put on their door. The
// caller owns the words and the buttons; this owns the map.
//
// `onMove` is called with `{ lat, lng }` every time the pin lands somewhere new —
// and with `null`, exactly once, when the map could not be shown at all, which is
// the caller's cue to say so and point at the address box. Two different answers, so
// null is not a point that failed to parse: nothing else in this file calls it that
// way.
//
// Returns a handle: `{ stop(), goTo(point) }` — `stop()` tears the map down, so
// closing the box and reopening it does not leave a second map bound to a removed
// container; `goTo(point)` moves the pin and the view onto a point (the customer
// pressing "Use my location", or tapping an address the lookup found, with the map
// already open). A point that arrives BEFORE the map is up is remembered rather than
// dropped, and the map opens on it — see `aimed`, below. Only `stop()` discards one.
export function showPinMap(host, { start = null, onMove = () => {} } = {}) {
  if (!host) return null;
  host.replaceChildren();
  const canvas = document.createElement("div");
  canvas.className = "pin-canvas";
  host.append(canvas);

  let map = null;
  let marker = null;
  let stopped = false;
  let goTo = null;   // set once the map is up; null until then, and after stop()
  const at = validPoint(start);
  // A POINT ASKED FOR WHILE THE CDN WAS STILL FETCHING. Until v202 `goTo` before load
  // was a silent no-op, and its comment said so — which was true and was also a defect
  // nobody had hit yet. The shop then grew a way to aim the map from a list (v202), and
  // that made it reachable: the box can already be open and still loading when the
  // customer taps an address, and a dropped `goTo` there means the map finishes loading
  // on the OLD point, calls `put(at)` for it, and `onMove` writes that old point back
  // over the one they just chose. A tap that silently moves the pin away from where they
  // put it is exactly the class of fault this project hunts, so the aim is kept.
  let aimed = null;

  loadLeaflet().then((L) => {
    if (stopped) return;
    const aim = validPoint(aimed) || at;
    const view = aim || HOME;
    map = L.map(canvas, { zoomControl: true, attributionControl: true }).setView([view.lat, view.lng], aim ? 17 : HOME.zoom);
    L.tileLayer(TILES, { attribution: ATTRIB, maxZoom: 19 }).addTo(map);
    const put = (latlng) => {
      if (!latlng) return;
      if (!marker) {
        marker = L.marker([latlng.lat, latlng.lng], { draggable: true }).addTo(map);
        marker.on("dragend", () => { const p = marker.getLatLng(); onMove({ lat: p.lat, lng: p.lng }); });
      } else {
        marker.setLatLng([latlng.lat, latlng.lng]);
      }
      onMove({ lat: latlng.lat, lng: latlng.lng });
    };
    goTo = (point) => {
      const p = point && validPoint(point);
      if (!p || stopped) return;
      map.setView([p.lat, p.lng], 17);
      put(p);
    };
    // Tapping the map is how a thumb puts a pin on a doorstep. Dragging a 24-pixel
    // marker with one finger is fiddly on a phone, and it would be the only way if
    // this were missing — a map that can only be aimed at by a precise drag is the
    // "dead control" complaint waiting to happen.
    map.on("click", (e) => put(e.latlng));
    // `aim`, not `at`: if the customer aimed the map at an address while it was still
    // loading, that aim is the point to stand on, and `onMove` must hear about it so the
    // caller's stored pin is the one they chose rather than the one they replaced.
    if (aim) put(aim);
    // A map built into a box that has only just been revealed measures as an empty
    // 0-pixel rectangle and draws blank tiles with the pin off-screen. Leaflet has
    // to be told the container's real size once the browser has laid it out, and
    // again after the box has finished growing.
    const settle = () => { if (map && !stopped) map.invalidateSize(); };
    requestAnimationFrame(settle);
    setTimeout(settle, 320);
  }).catch(() => {
    host.replaceChildren();
    host.dataset.failed = "1";
    onMove(null);
  });

  return {
    stop() {
      stopped = true;
      goTo = null;
      aimed = null;
      if (map) { map.remove(); map = null; marker = null; }
      host.replaceChildren();
    },
    // The map may not have loaded yet when this is called (the CDN is still fetching).
    // Then the point is REMEMBERED and the map opens on it when it arrives — the
    // customer tapped an address and must not watch the pin land somewhere else.
    //
    // NO `stopped` CHECK HERE, and this is deliberate rather than an oversight: `stop()`
    // clears `goTo` and `aimed` together, and the one place that reads `aimed` (the load,
    // above) checks `stopped` before it touches anything. So a point arriving after the
    // box closed is written to a closure nothing will consult again, and a guard here
    // would be a line no test could make fail. The behaviour that IS observable — a
    // stopped box never flies — is tested, and it is enforced at the load.
    goTo(point) {
      if (goTo) { goTo(point); return; }
      const p = validPoint(point);
      if (p) aimed = p;
    },
  };
}
