// place_map.js — putting the pin where the door actually is (25 Sep 2026).
//
// A courier is not given an address, it is given a point. That is Lalamove's own
// position, and it raises ERR_REVERSE_GEOCODE_FAILURE when it cannot make an address
// into one. So the app has to hold a point for you (once) and for each
// customer (once each), and hers was the choice in so many words: "Locate it, let me
// fix it." This file is the "let me fix it" half.
//
// THE APP'S FIRST OUTSIDE DEPENDENCY, named rather than slipped in: the map is
// Leaflet 1.9.4 and the tiles are OpenStreetMap. Neither is bundled; the script is
// fetched the first time a screen needs a map and never on boot. And the screen works
// without it — if the script cannot be fetched (a phone on one bar, a CDN having a bad
// day) the same card offers the coordinates instead. A picker that dead-ends because a
// third party is unreachable would be worse than no map at all.
//
// The tiles are asked for the way OpenStreetMap's usage policy requires: a real
// attribution, no bulk, no scraping, and only the tiles somebody is actually looking
// at. Nothing about a customer is sent to the tile server — a tile request carries a
// zoom level and a square of the world, and that is all it carries.
//
// NOT pure, so the RULES in it are not Node-tested: this file is a map and nothing else, and
// every rule it obeys about what a place IS lives in courier_place.js, which is pure and
// tested. What IS driven is the contract it has with Leaflet — the options the card's map is
// built with, and which gestures the lock holds back — in test/place-map.test.js. That file
// also states, in its own header, the two things no Node shim can settle: how a real phone
// arbitrates a pinch between the browser and Leaflet, and whether the zoom control's buttons
// overlap the marker in the door card's 200px box.

import { el, button, keepStill, showPopup, toast } from "./ui.js";
import { validPlace, parseCoords, splitLabel, houseNotIn, roadNotHouse } from "./courier_place.js";
import { geocodeAddress } from "./couriers/api.js";

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// A CDN that never answers must not leave a spinner on a phone forever. Past this the
// map is declared unavailable and the numbers are offered instead — a working screen,
// not an apology.
const LOAD_MS = 9000;
// Where the map opens when nothing is known yet: Penang, which is where you are.
// A starting view is not a place — nothing is pinned by it.
const HOME = { lat: 5.4141, lng: 100.3288, zoom: 13 };

let loading = null;

// Every pin map this file has built and not yet destroyed. A card that is rebuilt drops the box
// it held without a word to this file — a changed Fulfillment, a day tapped in the order card's
// own calendar, a pop-up refreshed, a sync pull — and the resize listener below is the only
// thing that would ever notice. On a phone that notice arrives when the keyboard opens or
// closes, which is not soon enough: until it does, every orphan keeps its tile layer, its
// `window` listener, and answers resize calls for the rest of the session. So each mount sweeps
// the set, and the sweep is asked the same question the listener asks — `isConnected === false`,
// so a container that cannot answer never reads as gone.
const livePins = new Set();
function reapPins() {
  for (const p of [...livePins]) if (p.box.isConnected === false) p.destroy();
}

// Leaflet, fetched once per page life. A failure clears the promise rather than
// caching it, so an attempt after the signal comes back can still succeed — a cached
// "the CDN is down" is a claim about now that outlives now.
export function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = (why) => { loading = null; reject(new Error(why)); };
    const timer = setTimeout(() => fail("it did not load in time"), LOAD_MS);
    if (!document.querySelector("link[data-leaflet]")) {
      document.head.append(el("link", { rel: "stylesheet", href: LEAFLET_CSS, "data-leaflet": "1" }));
    }
    document.head.append(el("script", {
      src: LEAFLET_JS,
      async: true,
      onload: () => {
        clearTimeout(timer);
        if (window.L && window.L.map) resolve(window.L);
        else fail("it loaded but was not usable");
      },
      onerror: () => { clearTimeout(timer); fail("it could not be fetched"); },
    }));
  });
  return loading;
}

// The map screen.
//
//   state    the app's state — the lookup goes through the signed-in channel
//   address  the words she already has for this door: what is looked up, and what
//            the pin is NAMED when she keeps it (see below)
//   start    a point already saved for this door, if there is one
//   onPick   called with { lat, lng, label } — exactly what setPickupPlace and
//            setDropPlace take, so no caller has to reshape it
//
// WHAT THE KEPT PIN IS CALLED (v207). The address she has, not the geocoder's row. A row is
// a FRAGMENT — "Taman Sri Nibong, George Town", a street and a town and no house number — and
// it is a good enough answer to "roughly where is this" and a hopeless answer to "which door".
// Kept as the pin's name it read as a SECOND, contradicting name beside the address on her
// courier card, which is the "pin still wrong" she has now reported three times. So the row's
// wording now lives on the line under the button and in the rows themselves — where she is
// choosing between doors and a fragment is exactly what she wants — and what reaches
// setDropPlace/setPickupPlace is the address. Only when she has no address at all do the
// geocoder's own words stand, because then they are the only name there is. Same split, same
// reason, as store/geo.js's placeForOrder on the shop side.
//
// Returns close(), like every other pop-up in the app.
export function openPlacePicker({ state, title = "Put the pin on the map", hint = "", address = "", start = null, onPick }) {
  let chosen = validPlace(start);
  let map = null;
  let marker = null;
  let live = true;
  // Which build of the card is on screen. The map arrives from the network, so its
  // callback runs after whatever is happening now; a repaint would otherwise leave it
  // writing into a node that is no longer on the page. Same reason the chart is drawn
  // twice at v167 — a detached node cannot be measured or trusted.
  let gen = 0;
  // Assigned inside the card below, and held out here because closing the pop-up has
  // to take the listener off with the map — a handler left on the window pointing at a
  // removed card is the kind of leak nobody sees until the fifth pin.
  let onResize = () => {};

  const closePopup = showPopup(title, () => {
    const mine = ++gen;
    const mineStill = () => live && mine === gen;

    // A repaint replaces the body, so the previous map is torn down with it. Leaflet
    // holds window listeners and a tile layer of its own; leaving one running behind a
    // card that has moved on is a leak that also answers resize calls forever.
    if (map) { map.off(); map.remove(); map = null; marker = null; }
    window.removeEventListener("resize", onResize);

    const say = (text, style = "margin:8px 0 0") => el("p", { class: "card-sub", style }, text);

    // ── one place that moves the pin, so every route into it agrees ──────
    // The marker, the centre and the line under the map move together or not at all.
    // Three things that could be moved separately would eventually read as three
    // different answers to "where is this".
    // The words for the point she is standing on, in one place, because the card says
    // them in two — when it opens already standing on a door, and every time the point
    // moves after that. Two hand-written copies of this sentence would eventually
    // disagree about the same point.
    const pinnedAt = (p) => `Pinned at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    function put(place, zoom) {
      const p = validPlace(place);
      if (!p) return;
      chosen = p;
      useBtn.disabled = false;
      coordsLine.textContent = pinnedAt(p);
      // The pin has moved, so which row is ticked has changed — by whatever route moved
      // it, whether that was a row, the tap that places the first point, a drag or pasted
      // numbers. Repainted from here rather than at each call site so that no route can
      // forget, and only when the list is actually on screen.
      if (!suggPanel.hidden) paintSuggestions();
      if (!map || !mineStill()) return;
      if (marker) marker.setLatLng([p.lat, p.lng]);
      else marker = window.L.marker([p.lat, p.lng], { draggable: true }).addTo(map).on("dragend", onDrag);
      map.setView([p.lat, p.lng], zoom || map.getZoom());
    }

    function onDrag(e) {
      const at = e.target.getLatLng();
      put({ lat: at.lat, lng: at.lng });
      useBtn.disabled = false;
      coordsLine.textContent += "  (moved by hand)";
    }

    onResize = () => { if (map && mineStill()) map.invalidateSize(); };

    // ── the words she has, and the lookup ────────────────────────────────
    // Multi-line, like the order form's address box: this holds the door's whole
    // address, and a one-line field made her scroll sideways to check it.
    const addrInput = el("textarea", { class: "input", rows: 3, value: address,
      placeholder: "12 Jalan Bunga, 10450 Penang" });
    const findStatus = say("");
    findStatus.hidden = true;

    // ── what the geocoder answered, and what the door is called ───────────
    // TWO NAMES, DELIBERATELY DIFFERENT (v207). `saidPlace` is how the lookup's own answer is
    // reported on the line and in the rows — the fragment, which is exactly right there. The
    // door's own name is `doorName`, and it is the address she has, read from the box AT THE
    // MOMENT SHE KEEPS IT rather than when the card opened (she may type it into the box while
    // this card is up). Only when the box is empty does the geocoder's wording stand in — a
    // door with no address to name it still needs some words — and only then.
    const saidPlace = (p) => p.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    const doorName = () => String(addrInput.value || "").trim() || foundWords;

    // The road-only sentence as a TAIL for a line that already says something, and "" when
    // there is nothing to say — so a line that answers a lookup appends it unconditionally
    // and cannot forget it. The leading full stop is here rather than at the two call sites
    // because both of them end without punctuation (v211).
    const roadWords = (house) => (house ? `. ${roadNotHouse(house)}` : "");

    // ── the other matches, when the lookup found more than one ───────────
    // The lookup used to keep whichever candidate the service happened to put first,
    // and she had to notice the pin was wrong and drag it to the right street. The
    // other candidates were arriving all along — the courier function read four of them
    // on every lookup and threw them away — so they are offered now.
    //
    // THIS IS NOT A GATE AND NOT AN EXTRA STEP. The first match still lands on the map
    // by itself, exactly as it always did, and this list is only how she says "not that
    // one". Her words for it: the best match lands, the list is there to change it.
    //
    // Styled by the app's own .sugg-panel / .sugg-row — the same rows the customer
    // suggester draws in views/orders.js — but FLOATING here (.sugg-drop) where that one
    // sits in the flow. v255 kept it in the flow, and in the flow it takes 223 pixels the
    // moment a lookup finds four candidates: everything under it is shoved down the card,
    // and the only way to hold any of it still is to scroll the pop-up body by that same
    // 223 — which throws the address field and the button under her thumb off the top.
    // "press look up this address again make it exit the page we are working in."
    //
    // The reason the customer suggester cannot float is real — that body scrolls, and a
    // floating panel is clipped at its edge — and it does not apply here: the panel is at
    // most four rows (260px, bounded below) inside a body that is 730px of visible column,
    // so it is never near an edge, and it scrolls itself when it is.
    const suggPanel = el("div", { class: "sugg-panel sugg-drop", hidden: true });
    let found = [];
    // What the geocoder last called a place — the WORDS ON THE LINE AND THE ROWS, and never
    // the name of the door (v207, see the header). Kept out here so the fallback below can
    // reach it: a door with no address to name it wears these.
    let foundWords = "";

    // Which row the pin is on, worked out from the pin rather than remembered when a row
    // was tapped. A stored index would go on claiming a row after she dragged the pin off
    // it, or pasted coordinates, or tapped the map — the list would tick a street the pin
    // is not on, which is the same class of lie as a shade that outlives its hours. Asked
    // this way it cannot drift: the tick is a fact about `chosen`, not a note about a tap.
    function rowOnPin() {
      if (!chosen) return -1;
      return found.findIndex((f) => Math.abs(f.lat - chosen.lat) < 1e-9 && Math.abs(f.lng - chosen.lng) < 1e-9);
    }

    function hideSuggestions() { suggPanel.hidden = true; suggPanel.replaceChildren(); }

    // Repaints the panel and nothing else. Deliberately NOT the pop-up's refresh(): that
    // rebuilds the whole body, and the body's own builder tears Leaflet down and builds
    // it again — so tapping a row would throw the map away and re-fetch its tiles to say
    // something the list can say by itself.
    function paintSuggestions() {
      // ONE candidate is not a choice, and the line under the button above already names
      // it. This is also what keeps the app behaving exactly as it does today for as long
      // as the courier function has not been redeployed: an older server replies with a
      // single place, and a single place draws this.
      if (found.length < 2) { hideSuggestions(); return; }
      const onPin = rowOnPin();
      const rows = found.map((p, i) => {
        const { title, sub } = splitLabel(p.label || "");
        // The mark is a CHARACTER, not a tint. A row shown only by a slightly different
        // shade says nothing to a screen reader and can be nothing at all on a phone in
        // daylight, which is where this app is used.
        const mark = i === onPin ? "✓ " : "";
        return el("button", {
          class: "list-item sugg-row", type: "button", onclick: () => chooseMatch(i),
        },
          el("div", { class: "li-main" },
            el("div", { class: "li-title" }, el("span", {}, `${mark}${title || "This spot"}`)),
            sub ? el("div", { class: "li-sub" }, sub) : null));
      });
      // SPREAD, NEVER THE ARRAY. replaceChildren is variadic: handed one array it finds
      // neither a node nor a string, converts it with String(), and draws
      // "[object HTMLButtonElement],[object HTMLButtonElement]" with nothing left to
      // press. That exact fault shipped on this card at v195, and this is the second
      // place on the same card that could repeat it.
      suggPanel.replaceChildren(...rows);
      suggPanel.hidden = false;
    }

    function chooseMatch(i) {
      const p = found[i];
      if (!p) return;
      // The row she tapped MOVES THE PIN and does not rename the door (v207). It is an
      // answer to "which street is it", and the door's name is the address — a tap that
      // rewrote that name into the row's fragment is the report this version answers.
      foundWords = p.label || "";
      // A row she picks is looked at the same way as the first answer (v211): "3 more below"
      // is exactly where a road-only candidate hides, so the row that moves the pin onto a
      // street says so too.
      //
      // THE LINE AND THE PIN MOVE TOGETHER, AND NOTHING ELSE DOES (v256). The rows float, so
      // this tap adds no height anywhere — what is left to correct is the line, which can
      // grow by a line and sits above the map. The anchor is the BUTTON, not the map: the
      // button is what her thumb is on, and it is the anchor the map's view could not
      // defend — holding the map still (v255) meant scrolling the card by the list's own
      // height, which is what carried the button and the field off the top of it.
      keepStill(findBtn, () => {
        // PICKED IS ANSWERED (v256). The list floats over the map now, so leaving it up
        // would leave the map covered — and the map is exactly what she wants next, to
        // check the pin landed on the right door. "and 3 more below" stops being true here
        // too, so the line goes back to naming the answer alone.
        hideSuggestions();
        findStatus.textContent = `Found: ${saidPlace(p)}` + roadWords(houseNotIn(addrInput.value, p));
        // put() is the one route that moves the pin, so the marker, the centre, the
        // coordinates line and the enabled "Use this spot" all move together by
        // construction. It repaints this list only while it is up, which it no longer is.
        put(p, 17);
      });
    }

    // ── her press, and the one that must not move the card ─────────────────
    //
    // "when i say look this address up, why the interface jump out of the page?"
    //
    // v255 answered that by holding the MAP still, and the answer was worse than the fault.
    // With the list in the flow, the only way to hold the map is to scroll the pop-up body by
    // the list's own height — 269 pixels measured at 375×812 against four candidates — and
    // that scroll carries the address field and the BUTTON UNDER HER THUMB clean off the top
    // of the card. Her words for it: "press look up this address again make it exit the page
    // we are working in."
    //
    // So the list floats (`.sugg-drop`) and takes no space at all, and the anchor is the
    // button she is holding — the one thing on this card that must never move. What the
    // correction still has to do is small and always BELOW the button: the line under it,
    // which can grow by a line. Measured on the same phone: 0 for the button, 0 for the
    // field, 0 for the map, 0 for the pop-up's scroll, against 269 for three of the four.
    const findBtn = button("Look it up", async () => {
      const text = addrInput.value.trim();
      if (!text) { hideSuggestions(); findStatus.hidden = false; findStatus.textContent = "Type the address first, or put the pin on the map by hand."; return; }
      // Cleared before the ask rather than after it: the previous lookup's rows must
      // never be left sitting under a new lookup's answer. The pin itself stays where it
      // is until a new match arrives, so nothing jumps while she waits.
      keepStill(findBtn, () => {
        hideSuggestions();
        found = [];
        findBtn.disabled = true;
        findStatus.hidden = false;
        findStatus.textContent = "Looking this address up…";
      });
      const out = await geocodeAddress(state, text);
      if (!mineStill()) return;
      findBtn.disabled = false;
      if (!out.ok) {
        // A miss is a normal answer, not an error to apologise for: the map is one tap
        // away and the numbers are one field away, so this reads as an instruction.
        keepStill(findBtn, () => { findStatus.textContent = out.reason; });
        return;
      }
      found = out.places || [out.place];
      // The geocoder's answer, reported on the line and in the rows. NOT put on the door:
      // `doorName` reads the address box when she keeps the spot (v207). The fallback is the
      // text she typed rather than "", because a geocoder that answers with a bare point has
      // no words of its own to lend — and a door left unnamed prints as two bare numbers.
      foundWords = out.place.label || text;
      // The line and the tick have to agree, so when there is a list the line says so —
      // otherwise four rows appear under a sentence that mentions one, and the only way
      // to find out they exist is to notice them.
      //
      // AND THE LINE HAS TO SAY WHEN THE ANSWER IS ONLY A ROAD (v211). The best match still
      // lands by itself and the list is still only how she says "not that one" — nothing here
      // is a gate. What is new is that the one case she cannot see for herself now says so:
      // where she typed a house number and the geocoder's answer does not contain it, the pin
      // is on her street and not on her door, and the sentence her own words asked for is
      // added to the line she is already reading.
      //
      // ONE WRAP FOR ALL THREE, because they are one answer: the line, the pin, and the list
      // of other matches. Correcting between them would move the card three times. Only the
      // LINE changes the card's height now that the list floats — the other two are inside it.
      keepStill(findBtn, () => {
        findStatus.textContent = (found.length > 1
          ? `Found: ${saidPlace(out.place)} — and ${found.length - 1} more below`
          : `Found: ${saidPlace(out.place)}`)
          + roadWords(houseNotIn(text, out.place));
        put(out.place, 17);
        paintSuggestions();
      });
    });

    // ── the spot she settles on ──────────────────────────────────────────
    const coordsLine = say("No spot chosen yet.");
    const useBtn = button("Use this spot", () => {
      const p = validPlace(chosen);
      if (!p) return;
      onPick({ lat: p.lat, lng: p.lng, label: doorName() });
      toast("Pin saved");
      closePopup();
    }, "primary");
    // A control that does nothing must look inert — the app's own rule about
    // affordances. With no spot chosen there is nothing to use, and the button is off.
    useBtn.disabled = !chosen;
    // AND THE LINE BESIDE IT HAS TO AGREE WITH IT (v210). Where this window opens already
    // standing on a door — the door in force this card is asking about — the Keep is live
    // from the first moment, so the line must not sit there saying "No spot chosen yet."
    // until a map happens to load and say otherwise. That gap was reachable precisely on
    // the phone this window exists for: the one whose map never came. The map's own arrival
    // writes this same sentence through `put()`; this only fills the gap before it does.
    if (chosen) coordsLine.textContent = pinnedAt(chosen);

    // ── the fallback, and it is the way out rather than a hidden extra ───
    // Numbers she copied from anywhere: a Google Maps link, a message from the
    // customer, a place she knows by heart. courier_place.js reads all four shapes.
    //
    // OUT OF THE WAY UNTIL IT IS THE ANSWER (v266). This block used to stand open on every
    // pin she dropped — four lines of fallback under a map that was working, on the one
    // window in the app whose whole job is to be read fast at a door. Her words on it:
    // "when i see the button, i might self have to ask, i dont know what will happen or
    // what will happen if i din press that button, these create confusion." So it now comes
    // out when the MAP is what failed, which is what its own line always claimed it was
    // for, and otherwise waits behind one press that says what it is for.
    //
    // THE DOOR IS KEPT RATHER THAN THE BLOCK HIDDEN OUTRIGHT, and that is the whole point
    // of the version: a Google Maps link is the most accurate point a customer ever sends,
    // and hiding the block on a day the map works would leave nowhere to put one. Best of
    // both: nothing on screen it does not have to explain, and no way through lost.
    const numInput = el("input", { class: "input", type: "text",
      placeholder: "5.4141, 100.3288  or a Google Maps link" });
    const numStatus = say("");
    numStatus.hidden = true;
    const numBtn = button("Use these numbers", () => {
      const p = parseCoords(numInput.value);
      numStatus.hidden = false;
      if (!p) {
        numStatus.textContent = "That does not look like a pair of coordinates or a map link.";
        return;
      }
      numStatus.textContent = "Pinned from your numbers — check it on the map if one is showing.";
      put(p, 17);
    }, "ghost");
    const coordsBox = el("div", { class: "field coords-block", style: "margin:14px 0 0" },
      el("label", {}, "Coordinates, if you have them"),
      numInput,
      // WHAT THE PRESS DOES, AND WHAT IT DOES NOT DO YET. The button fills the box's
      // answer in and moves the pin; the Keep is the press below it, and saying so is
      // the difference between a button she can predict and one she has to try.
      el("div", { class: "btn-row", style: "margin-top:10px" }, numBtn),
      numStatus,
      el("p", { class: "card-sub", style: "margin:6px 0 0" },
        "Press this and the pin moves to those numbers; a Google Maps link works too. "
        + "Nothing is kept until you press Use this spot below."));
    // Hidden through the PROPERTY, not through `el(… {hidden: true})`. Both do the same thing
    // in a browser, but the attribute is the one thing the test shim models loosely, and a
    // block whose hidden state could be read two ways is a block whose test proves nothing.
    coordsBox.hidden = true;
    const numDoor = button("Have a Google Maps link?", () => revealNumbers(), "ghost small");
    // Shown ONCE and never hidden again while this card is up. A late tile that lands
    // while she is typing in the box must not take the box out from under her — the
    // app's own rule, and the reason this is not simply `coordsBox.hidden = !ok`.
    function revealNumbers() {
      coordsBox.hidden = false;
      numDoor.hidden = true;
      numInput.focus();
    }

    // ── the map itself, which may not arrive ────────────────────────────
    const mapBox = el("div", { class: "place-map" });
    const mapNote = say("");
    mapNote.hidden = true;

    loadLeaflet().then((L) => {
      if (!mineStill()) return;
      map = L.map(mapBox, { scrollWheelZoom: false, zoomControl: true }).setView([HOME.lat, HOME.lng], HOME.zoom);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(map);
      // A TAP CANNOT MOVE A PIN (v264). Her words: "click on the map should not move the pin,
      // only dragging the pin will." Until now every touch on this box put the pin wherever the
      // finger landed AND pulled the view onto it — two answers to one accidental contact with
      // a 200px strip inside a card she scrolls, on a card whose own line already promises the
      // drag ("Look the address up, then drag the pin to the exact door"). It was a second,
      // unadvertised way to move the pin, and it is gone.
      //
      // WHAT IS LEFT IS THE ONE CASE IT IS THE ONLY ANSWER TO: a map with nothing on it yet.
      // That is how this card often opens — no point on the order, so no marker, so nothing to
      // drag — and a tap there does not MOVE a pin, because there is none: it places the first
      // one. Every other route to a point on this map (the lookup, its rows, the coordinate
      // box, a drag) leaves a marker behind, and from that moment a tap does nothing at all.
      map.on("click", (e) => { if (!marker) put({ lat: e.latlng.lat, lng: e.latlng.lng }); });
      map.on("dragend", () => { if (mineStill()) map.invalidateSize(); });
      if (chosen) put(chosen, 16);
      // The box is measured once the card has been laid out. A map built inside a
      // pop-up that has not settled measures zero and draws a corner of one tile,
      // which is the difference between a working map and a broken one.
      requestAnimationFrame(() => { if (mineStill() && map) map.invalidateSize(); });
      window.addEventListener("resize", onResize);
    }).catch((err) => {
      if (!mineStill()) return;
      mapBox.remove();
      mapNote.hidden = false;
      mapNote.textContent = `The map is not available right now (${(err && err.message) || "it could not be loaded"}). `
        + "Type the coordinates below instead — a Google Maps link works too.";
      // THE ONE BRANCH THE BLOCK IS FOR. The sentence above has always pointed at these
      // numbers; until v266 there was a box open under it whether or not the map had
      // failed, so the sentence was right by accident. Now it is right by construction.
      revealNumbers();
    });

    return [
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        hint || "Look the address up, then drag the pin to the exact door. What you keep here is remembered for this customer."),
      el("div", { class: "field", style: "margin-bottom:0" },
        el("label", {}, "The address you have"),
        addrInput,
        // The panel rides INSIDE the row that holds the button (.sugg-host is the row's
        // position:relative), so `top:100%` drops it straight under the thumb she pressed
        // and `left/right:0` makes it the width of the field rather than of the button.
        el("div", { class: "btn-row sugg-host", style: "margin-top:10px" }, findBtn, suggPanel),
        findStatus),
      mapBox,
      mapNote,
      numDoor,
      coordsBox,
      coordsLine,
      el("div", { class: "btn-row" }, useBtn),
    ];
  }, { wide: true });

  return () => {
    live = false;
    gen++;
    if (map) { map.off(); map.remove(); map = null; marker = null; }
    window.removeEventListener("resize", onResize);
    closePopup();
  };
}

// A map that only LOOKS, until she unlocks it (v201, 26 Sep 2026).
//
// The same Leaflet, the same tiles and the same box as openPlacePicker above, and
// deliberately NOT built on top of it. That card is a pop-up — a showPopup, so opening it
// REPLACES whatever card asked for it — and it carries an address lookup, a suggestion
// list and a coordinate fallback around the map. A section that wants to show a pin on a
// card it is already inside wants none of that and cannot afford the replacement. What it
// wants is the one thing the picker has that is not a form.
//
//   mountPinMap(box, { place, onMove, onFail })
//
//     box     the container, already carrying .place-map so it has a height of its own
//     place   the point to draw, or null for none
//     onMove  called with { lat, lng } when a drag or a tap settles a new spot — only
//             ever while unlocked
//     onFail  called with the reason when Leaflet cannot be had. The box is LEFT IN PLACE
//             and left empty: the words she should read around it are the caller's, and a
//             node the caller built is not this file's to remove.
//
// Returns { setPlace(p), setDraggable(on), destroy() }. Every method is safe after
// destroy() and safe while the map has not arrived — the caller repaints a screen that may
// have moved on while the tiles were still coming.
//
// READ-ONLY UNTIL SHE SAYS OTHERWISE is the whole reason this exists as well as the
// picker. Her answer, in so many words: "Look, and a Move button." So it opens with no map
// drag and no tap-to-place, and setDraggable(true) turns those on — the same map and the
// same pin, with no second card opened and nothing typed beside it thrown away, which is
// exactly what the pin button cost her.
//
// ZOOM IS NOT PART OF THAT LOCK, AND THAT IS HER OWN REVISION (v238, 30 Sep 2026). It used
// to be: no zoom of any kind until she pressed Move, on the reasoning that a map she is
// CHECKING should sit still. What that produced, in her words, was "the map are not allow to
// zoom out and dragging the pin to the right pin become extremely time consuming and prompt
// to error" — she had a stale pin and one way to fix it, a 24-pixel marker dragged by thumb
// across a map that refused to zoom out first. Zoom is how anyone finds the right rooftop;
// withholding it made LOOKING impossible to separate from CORRECTING. So the zoom control is
// drawn and the gestures are live the whole time the card is up, and the lock now covers only
// what could move the PIN: the map's own pan (a pan under a still pin would let a reach-past
// nudge the view she was reading) and the marker's drag.
//
// AND SINCE v264 THE TAP PLACES NOTHING HERE WHETHER IT IS LOCKED OR NOT — see `onTap`. The
// lock still decides whether the drag is live; the tap stopped being a way to move a pin,
// on her own instruction, which is why the two maps in this file now answer a touch the same
// way. This card never draws a map with no pin on it (see paintDoorNow in views/courier_quote.js),
// so the tap that the picker still keeps for an empty map has nothing to do here.
export function mountPinMap(box, { place = null, onMove = () => {}, onFail = () => {} } = {}) {
  let map = null;
  let marker = null;
  let live = true;
  // Whether the map takes a touch of its own. Held out here rather than read off Leaflet,
  // because it has to be known before the map exists: the options it is built with are
  // what it opens as.
  let sharp = false;
  let at = validPlace(place);
  // The point the pin is currently sitting on. `setPlace` compares against it so that a redraw
  // of the card does not drag the view back to a place it is already showing. Two things go
  // wrong without it, and both are the same fault wearing different clothes: a pan she made
  // with her own thumb is thrown away by the next repaint, and a pin she has just dropped
  // jumps back to the middle of the box from under her finger. Only a door the map has never
  // shown — the one the address lookup resolves — is worth moving the view for.
  let shown = null;
  // Registered the moment the map is ASKED for, not when its tiles arrive: a card can be
  // rebuilt while Leaflet is still loading, and that orphan is just as real as a visible one.
  const entry = { box, destroy };
  livePins.add(entry);
  // Deferred by one microtask, and that is the whole trick. The card's own rebuild calls
  // `courierBox.replaceChildren(...buildCourierBlock())`, so the block being replaced is still
  // on the page at this instant and a sweep now would reap nothing at all. One microtask later
  // the caller has finished its swap, and "is this box still on the page" has an honest answer.
  Promise.resolve().then(reapPins);
  // The card this box sits in can be closed while the tiles are still loading, and nothing
  // tells this file when that happens — the app's one pop-up layer empties itself with no
  // word to what it held. So the listener checks that its own box is still on the page
  // before it does anything, exactly as the price panel checks `wrap.isConnected`, and lets
  // go of the map the first time it is not. A map left running behind a card nobody is
  // looking at is a leak that also answers resize calls for the rest of the session.
  const onResize = () => {
    if (!live) return;
    if (box.isConnected === false) { destroy(); return; }
    if (map) map.invalidateSize();
  };

  // The marker, placed or moved — the one call that puts the pin at a point, so a drag, a
  // tap and the caller's own setPlace cannot end up disagreeing about where it is. It is also
  // where `shown` is kept, for the same reason: one place that knows where the pin is.
  function drop(p) {
    if (!map || !live) return;
    shown = { lat: p.lat, lng: p.lng };
    if (marker) marker.setLatLng([p.lat, p.lng]);
    else marker = window.L.marker([p.lat, p.lng], { draggable: sharp }).addTo(map).on("dragend", onDrag);
  }

  function onDrag(e) {
    if (!sharp) return;
    const spot = e.target.getLatLng();
    at = { lat: spot.lat, lng: spot.lng };
    drop(at);
    onMove({ lat: at.lat, lng: at.lng });
  }

  // A TAP ON THIS MAP MOVES NOTHING (v264). "Click on the map should not move the pin, only
  // dragging the pin will." It used to place a point once she had pressed Move this pin, and
  // the drag it stood in for is now the only way — one rule for both maps in this file, which
  // is why it is written here rather than left to the two places the handler is bound.
  //
  // THE ONE CASE IT STILL ANSWERS: a map built with no pin at all. This card never does that
  // (the door block hides the map when there is no point) but the contract on `mountPinMap`
  // allows it — and there a tap does not move a pin, because there is none. It places the
  // first one, and nothing else could, because there is nothing to drag. The same rule, and
  // the same words, as the picker's own tap above.
  function onTap(e) {
    if (!sharp || marker) return;
    at = { lat: e.latlng.lat, lng: e.latlng.lng };
    drop(at);
    onMove({ lat: at.lat, lng: at.lng });
  }

  // A LOCKED MAP IS A PICTURE, and a picture must not take a finger hostage. Leaflet sets
  // `touch-action: none` on its own container, which on a phone makes a finger on the box
  // do NOTHING — it neither moves the map nor scrolls the card the box sits in, so a 200px
  // strip of the card goes dead and the Save button under it can feel unreachable. While it
  // is locked the box lets the card's own vertical scroll through; that is the only gesture
  // it gives up, and it has no drag of its own to protect. Unlocked, it behaves exactly
  // like the picker's map. (See the note in app.css — this is the case that note names.)
  //
  // `pan-y` AND NOT `pan-y pinch-zoom` (v238), which is the value that looks like it would
  // help here and does the opposite. `pan-y` tells the browser it may scroll this box
  // vertically and NOTHING ELSE — so a two-finger pinch is a gesture the browser has
  // declined, the touch events keep arriving, and Leaflet's own touchZoom is the thing that
  // answers them. Adding `pinch-zoom` would hand that same pinch to the BROWSER, which zooms
  // the whole page out from under the card; the map would then never see it. One value lets
  // the map zoom, the other lets the page zoom, and only one of them is what she asked for.
  function paintTouch() {
    const c = map && map.getContainer && map.getContainer();
    if (c && c.style) c.style.touchAction = sharp ? "none" : "pan-y";
  }

  // Leaflet has no option for this after the fact — a handler object has to be switched on
  // and off itself.
  //
  // ONLY THE DRAG IS STILL FLIPPED (v238). The zoom handlers used to be flipped with it and
  // are now left alone: they are built on, and the lock has nothing to say about them. See
  // the note on mountPinMap for why that is the point of the version.
  function flip(handler) {
    if (handler) handler[sharp ? "enable" : "disable"]();
  }

  function setDraggable(on) {
    sharp = !!on;
    if (!map || !live) return;
    flip(map.dragging);
    flip(marker && marker.dragging);
    if (sharp) map.on("click", onTap);
    else map.off("click", onTap);
    paintTouch();
  }

  function destroy() {
    live = false;
    sharp = false;
    if (map) { map.off(); map.remove(); map = null; }
    marker = null;
    shown = null;
    livePins.delete(entry);
    // Guarded: a test shim's `window` need not carry this, and a teardown that throws would
    // take the whole screen down with it.
    if (window.removeEventListener) window.removeEventListener("resize", onResize);
  }

  loadLeaflet().then((L) => {
    // The script arrives late, and by then the card may be closed, or the box may never
    // have reached the page at all. A map built into a box that is not there measures zero
    // and draws a corner of one tile — the fault app.css warns about — and nothing tells
    // this file when a pop-up layer empties itself, so the check is here. Asked as
    // `=== false` on purpose: a container that cannot answer must not read as "gone".
    if (!live || box.isConnected === false) { destroy(); return; }
    map = L.map(box, {
      // A wheel over a 200px box inside a card she is scrolling would zoom the map instead
      // of scrolling past it, which is the wrong thing for a finger that was only passing
      // through. The one gesture that is NOT wanted here, and it stays off.
      scrollWheelZoom: false,
      // ZOOM IS ALWAYS ON (v238). The plus and minus are the reliable half of her ask — a
      // button zooms whatever any browser decides to do with a pinch, and "the map are not
      // allow to zoom out" is answered by a control she can press rather than a gesture she
      // has to win. The gestures are on with it: pinch, double-tap and the desktop box zoom
      // are how anyone finds a rooftop, and they cost the card nothing, because none of them
      // can move the PIN. The lock is on the drags and the tap, below.
      zoomControl: true,
      // ON WHILE LOCKED, and this is the version (see the note on mountPinMap): what the lock
      // holds back is a pan under a pin she is reading, not a look at the ground around it.
      dragging: sharp, touchZoom: true, doubleClickZoom: true, boxZoom: true,
    }).setView(at ? [at.lat, at.lng] : [HOME.lat, HOME.lng], at ? 16 : HOME.zoom);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(map);
    map.on("dragend", onResize);
    if (sharp) map.on("click", onTap);
    if (at) drop(at);
    // The box is measured once the card has settled. A map built while the card is still
    // being laid out measures zero and never recovers, because it has no reason to measure
    // again — the same rAF the picker uses, for the same reason.
    requestAnimationFrame(() => { if (live && map) map.invalidateSize(); });
    window.addEventListener("resize", onResize);
    paintTouch();
  }).catch((err) => {
    if (!live) return;
    live = false;
    // The caller is told and the box is left where it is. The door is still checkable
    // without a map: the coordinates are the same fact a map would have drawn, and the
    // picker's own number field is one tap away.
    onFail(String((err && err.message) || "it could not be loaded"));
  });

  return {
    setPlace(p) {
      const q = validPlace(p);
      if (!q) return;
      at = q;
      if (!map || !live) return;
      // Asked BEFORE the drop, because the drop is what moves the pin and answers this.
      const fresh = !(shown && shown.lat === q.lat && shown.lng === q.lng);
      drop(q);
      if (fresh) map.setView([q.lat, q.lng], (map.getZoom && map.getZoom()) || 16);
    },
    setDraggable,
    destroy,
  };
}
