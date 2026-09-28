// views/courier_quote.js — what the courier would charge, and booking the trip
// (25 Sep 2026).
//
// Two phases of the courier work live in this one section, and they are the two halves
// of the same decision: what this delivery COSTS, and then really booking it.
//
// THE PRICE. A price is what she has to know before she answers a customer, and a price
// is also the only thing a courier's API will tell her for nothing. An accepted price
// writes into the charge box she was going to fill in by hand — and even that goes
// through courier.js's own model, so the amount, the payer and the COD keep running down
// the money path that already works.
//
// THE BOOKING (v189). [Book this trip] spends real money and puts a real vehicle on the
// road, so the press is behind a confirmation that restates the vehicle and the price,
// and it can only be undone through the courier itself while the courier still allows
// it. What comes back is stored ON THE ORDER (`o.courierJob`), which is why booking
// needs no database step: an order row syncs whole, so the trip travels to her other
// phone with nothing to run in Supabase. The customer's share link goes into the slot
// the tracking number already used, because a share link IS this delivery's reference.
//
// WHY THIS IS A SECTION AND NOT A POP-UP OF ITS OWN. The app has ONE pop-up layer, so
// opening a second card replaces the first — the charge box, the note she was part-way
// through and the Save button would all be destroyed by the act of asking for a price,
// and the fee would land in a box nothing could ever save. So all of this opens IN the
// card that holds the charge box, folded away until she asks for it. There is then
// nothing to come back to, because nothing was left.
//
// THE HONESTY THIS FILE EXISTS FOR: a quotation DIES. Lalamove's last five minutes.
// The panel counts that life down in front of her, and when it runs out it says so and
// offers to ask again rather than leaving a dead number sitting there looking like a
// live price. A price under a fee is the one thing here that must never be wrong, and
// the two ways of being wrong are not symmetric — asking again costs one tap, quoting
// a dead price costs her money. Booking inherits that rule and adds one more: the trip
// is booked against the QUOTATION IT WAS PRICED AT, so the vehicle and the hour that
// arrive are the ones the price was given for, even if she has moved the time box since.
//
// THE TWO ENDS OF THE TRIP. A courier is not given an address, it is given a point
// (see courier_place.js), so before anything can be priced both doors have to be
// pinned. Hers was the choice — "Locate it, let me fix it" — so this looks up the
// address the order already carries, keeps the answer against that customer, and
// where the lookup misses puts the map one tap away. Both ends can be pinned from
// right here, because a dead end in a kitchen is not a signpost.
//
// WHAT THIS FILE MUST NOT KNOW: which courier it is talking to. It asks the registry
// for the active one and uses that courier's own words — its `label`, the names it
// puts on its vehicles. No courier's name, service keys or error codes appear below.

import { button, confirmDialog, el, guarded, toast } from "../ui.js";
import { todayISO } from "../dates.js";
import {
  fmtAgo, fmtDistanceKm, fmtQuote, fmtQuoteLeft, fmtStamp, isLink, jobOf, liveJobOf,
  liveJobProblem, orderDay, quoteExpired, scheduleAtUTC, tripCollected, tripOf, tripProblem,
} from "../courier_job.js";
import {
  customerPlaceOf, doorIsTheirs, doorMayBeLookedUpAgain, doorRoadOf, doorSpotOf, doorSwitchOf,
  dropAddress, dropPlaceOf, fmtPlace, houseNotIn, pickupAddress, pickupPlace, roadNotHouse,
  sameDoor, setDropPlace, setPickupPlace,
} from "../courier_place.js";
import { geocodeAddress } from "../couriers/api.js";
import { activeCourier, courierByKey } from "../couriers.js";
import { mountPinMap, openPlacePicker } from "../place_map.js";

// The price section for a trip, as a node to drop into a card.
//
// `orders` is an array because a trip has stops — today it is handed one, and the same
// section prices a run of several drops when the consolidation screen arrives.
//
// `onUseFee(quote)` is what an accepted price does. The note/tracking card passes its
// own charge box's `set`, so a quoted fee and a typed one are the same kind of answer
// and there is no second charge editor for the two to disagree through. It does NOTHING
// for a booking: a booked trip is not a charge — the courier's fee is still hers to
// decide and still goes in the charge box by hand, on purpose, because booking a trip
// and agreeing to pay for it are two decisions and the second one has a payer to choose.
//
// `onCommit(order)` is called after this section has written to an order — a booked
// trip, a refreshed status, a cancellation — and it is the HOST's job, because the host
// is what owns persistence for the card it built: it refreshes its own stale copy of the
// tracking number (both call sites capture that value when the card opens, so a booking
// the card did not hear about would be overwritten by the next Save), saves, syncs and
// publishes the customer's card. A booking is therefore saved the moment it happens and
// is NOT discardable by closing the card without pressing Save.
//
// `doorSlot` is the node the door block is drawn into, and the HOST hands it in because the
// host owns the card's layout: the door belongs at the TOP of the box, above the note, and
// everything else this section draws belongs under the charge. One section, two places on
// the card, and the card says which is which. No slot, no block — the section is otherwise
// exactly what it was.
//
// `onCollected(order)` is called on the ONE check that first reads the trip as collected,
// BEFORE `onCommit` runs — so the status the host moves and the trip it stamps leave in
// the same save and the same publish. This section does not move the status itself: what
// an order's status means is the order's own business, and this file's job is to tell the
// host the fact and let it decide. It is a TRANSITION and not a state (see `commit`).
export function courierQuoteSection({
  state, orders, onUseFee = null, onCommit = null, onCollected = null, doorSlot = null,
}) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  const first = list[0] || null;
  const cur = state.settings.currency;
  const courier = first ? activeCourier() : null;
  if (!first) return el("span", {});
  if (!courier) {
    return el("p", { class: "card-sub", style: "margin:0" },
      "This build has no courier set up, so there is no one to ask for a price.");
  }

  // The section is built on the FIRST open and then kept, because building it is what
  // asks the courier for eight quotations. Nothing here is rebuilt while she works, so
  // the note box above it and the amount she has typed below it both keep what they
  // hold — the same reason the charge block repaints only itself.
  let built = false;
  let open = false;
  let busy = false;
  let timer = null;
  let quotes = [];
  let failed = [];
  // What the prices on screen were asked for, in words. Moving the time box does not
  // silently re-ask: a re-ask is eight requests, so it stays her tap, and this is what
  // tells her the numbers under her thumb belong to a time she has left behind.
  let pricedFor = "";
  // The TRIP those prices were asked for, kept whole rather than rebuilt at booking
  // time. Two reasons, and both of them are money: a booking is made of the quotation's
  // own stop ids, which are matched back to the doors by POSITION in the list that was
  // priced — so booking a list that has changed since would name a door with the handle
  // of a different one. And the quotation already carries the vehicle and the hour, so
  // booking it books the price she is looking at even if the time box has moved.
  let pricedTrip = null;
  // Each price's own clock, so a second passing rewrites one line of one row instead
  // of rebuilding the list. One of those rows holds the button this section exists
  // for, and a tap lost to a repaint is a tap she has to make twice. The booked trip's
  // status line keeps a clock of its own in `jobClocks`, because "read just now" that
  // was still saying "just now" a quarter of an hour later would be the one line on
  // that card quietly going stale — and because one list would mean a repaint of either
  // half throwing the other half's clock away.
  let clocks = [];
  let jobClocks = [];
  // A booking or a cancellation in flight. One at a time, because both spend money and
  // a second press while the first is unanswered is a second vehicle.
  let jobBusy = false;

  const bodyWrap = el("div", { style: "margin-top:10px" });
  bodyWrap.hidden = true;
  const toggleBtn = button("Get a delivery price", () => {
    open = !open;
    if (open && !built) {
      built = true;
      build();
    }
    paintFold();
  }, "ghost small");
  const wrap = el("div", {}, el("div", { class: "btn-row" }, toggleBtn), bodyWrap);

  function paintFold() {
    toggleBtn.textContent = open ? "Hide the delivery price" : "Get a delivery price";
    bodyWrap.hidden = !open;
    if (open) startClock();
    if (!open) stopClock();
  }

  function stopClock() {
    clearInterval(timer);
    timer = null;
  }

  // A second passing rewrites the short lines that changed and nothing else. The
  // interval also clears ITSELF once the card is gone: closing the pop-up empties the
  // layer, so the node this is written into stops being on the page — and an interval
  // left running against a detached node would keep eight quotes' worth of clocks
  // alive for the rest of the session.
  function startClock() {
    stopClock();
    const ticks = [...clocks, ...jobClocks];
    if (!ticks.length) return;
    timer = setInterval(() => {
      if (!wrap.isConnected) { stopClock(); return; }
      for (const c of ticks) c(Date.now());
    }, 1000);
  }

  // ── the door this order is delivered to (v201, 26 Sep 2026) ────────────
  //
  // Her report, in so many words: "there is no customer enter address in the form, so
  // there is no way we can check what customer pin is right, when in that window." She
  // means the Note / tracking box, and she is right — the box's own help text ends by
  // saying the address is "under Edit". The reason that now costs her: a courier is given
  // a POINT, not an address, and this box is where the trip is priced and booked. A wrong
  // door caught anywhere else is caught too late.
  //
  // HER TWO ANSWERS ARE THE DESIGN (26 Sep 2026). "Look, and a Move button": the map is
  // read-only until she presses [Move this pin], and then the SAME map takes a drag and
  // saves the moment she lets go — no second card and nothing typed beside it thrown away,
  // which is what the old doorstep button cost her. "Always, courier orders": it is drawn
  // with the box, not behind the price fold.
  //
  // IT IS NOT A GATE, and that is the standing rule for anything about a door. An order
  // whose door is unpinned, or pinned somewhere she has not looked at, prices and books
  // exactly as it always did. This is a way to LOOK and a way to FIX, and nothing here can
  // stop her taking a delivery.
  let doorBox = null;
  let doorWords = null;
  let doorMapBox = null;
  let doorBtn = null;
  // The door block's second press (v213) — drawn only where the door is one a lookup wrote.
  let lookBtn = null;
  let doorHandle = null;
  // Read-only until she says otherwise — see mountPinMap. It is reset to locked every time
  // the block is rebuilt, so a card she opens is never already in "move" mode.
  let doorLocked = true;
  // Assigned by build(), because only build() knows about the prices. Before the fold has
  // ever been opened there are no prices and nothing to say.
  let afterDoorMove = () => {};
  // Assigned by build() for the same reason, and one more: only build() owns the status line,
  // which is where the answer to a re-lookup is said. The no-op default is what lets the door
  // block be DRAWN before the card that contains it has been built.
  let relookUp = () => {};

  const isCourierOrder = String((first && first.fulfillment) || "") === "courier";

  // A price on screen belongs to the door it was asked for. Moving the pin cannot leave
  // those numbers where they are — and it does not silently re-ask either: a re-ask is
  // eight requests and this file's rule is that it stays her tap. So they go, and the line
  // where prices appear says why.
  // `note` is what the caller knows about the move that the sentence below cannot (v213, the
  // re-lookup): the prices go for the same reason, and only the words explaining WHY differ.
  // Left out, the sentence is exactly the one a drag has always produced.
  function invalidatePrices(note = "") {
    quotes = [];
    failed = [];
    pricedFor = "";
    pricedTrip = null;
    afterDoorMove(note);
  }

  // THE DOOR — the one point a price is asked for, the drag moves, and the driver is sent
  // to. The rule lives in courier_place.js's `doorSpotOf`, so this card, the delivery run
  // and the booking that reaches the courier cannot disagree about which point it is.
  //
  // v197's old promise — that their pin reached nobody until she took it up — is RETIRED
  // at v209 on her own instruction ("Their own pin — always"), because the door she keeps
  // could be a lookup's answer in the wrong town. The one-press switch further down the
  // card is what takes its place, and a door she placed by her own hand still wins.
  function doorSpot() {
    return doorSpotOf(state, first);
  }

  // Whether the point in force is the customer's own pin rather than a door of hers. The card
  // has to say which it is, and it cannot ask "is there a kept door?" — since v209 one can
  // exist while the customer's pin is the point in force, and a card keyed off the row would
  // call their pin "the door you keep for her". That is why this asks courier_place.js.
  function theirsIsTheDoor() {
    return doorIsTheirs(state, first);
  }

  // The picker, for the one case a drag cannot answer: there is no point at all to drag,
  // and the address has to be looked up. That card is a pop-up of its own, so it REPLACES
  // this one — a known and stated cost, and the only place in this section that destroys
  // the card. It is worth paying once per customer: after it, the pin exists and every
  // other change is a drag on a card that stays.
  function putDoorstep() {
    openPlacePicker({
      state,
      title: `${String(first.customerName || "The customer").trim()}'s doorstep`,
      // THE PICKER OPENS ON THE DOOR IN FORCE, AND THE WORDS NAME THAT SAME DOOR (v210).
      // This is the picker of last resort — reached when there is no point to drag, or the
      // tiles never came — so the point it stands on and the sentence above it have to be
      // the point this card is already calling the door. Both used to key off whether SHE
      // keeps a door rather than off which door is in force: it opened on the door she
      // keeps, and it promised a lookup, on an order whose door is the customer's own pin —
      // the wrong point under the wrong sentence, and reachable through either route in.
      // `doorIsTheirs` is the same question the card's own line asks (see paintDoor), so the
      // two cannot disagree.
      hint: doorIsTheirs(state, first)
        ? "This is the customer's own pin, dropped on the shop page when they ordered. Drag it if it is not the door, and it is kept against them when you keep it."
        : "Look the address up, then drag the pin to the exact door. It is remembered for this customer.",
      address: dropAddress(first),
      start: doorSpotOf(state, first),
      onPick: (spot) => {
        setDropPlace(state, first, spot);
        // There is nothing left on this card to repaint — the picker replaced it. What
        // matters is that the pin is PERSISTED: a door saved on this phone and not synced
        // is a door the other phone prices the trip at, by hand.
        if (onCommit) onCommit(first);
      },
    });
  }

  // Draws the whole block, and is safe to call any number of times: every line follows the
  // state, and the map is only ever BUILT once.
  function paintDoor() {
    if (!doorBox || !isCourierOrder) return;

    if (!doorWords) {
      doorWords = el("p", { class: "card-sub", style: "margin:6px 0 0" });
      doorMapBox = el("div", { class: "place-map door-map", hidden: true });
      doorBtn = button("Move this pin", () => {
        const spot = doorSpot();
        // Nothing to drag, or no map to drag it on (the tiles never came): the picker is
        // the only way left and it is a working one — it reads coordinates as well as
        // addresses, so a phone that cannot hold a map is not a phone that cannot pin.
        if (!spot || !doorHandle) { putDoorstep(); return; }
        // Unlock, drag, then press again to put the card back the way she found it. A map
        // left taking drags is a map that can be nudged while she reaches past it.
        doorLocked = !doorLocked;
        doorHandle.setDraggable(!doorLocked);
        paintDoor();
      }, "ghost small");
      // ASK THE ADDRESS UP AGAIN (v213). A door a lookup wrote is the best answer one service
      // had on the day it was asked, not a fact about the world — and for a Malaysian house
      // number that answer is usually just the road. v212 added a second, better service, but
      // it is only ever asked when there is NO door yet, so every customer pinned before it
      // keeps the old answer for good. This is the way out, and it is a press rather than
      // something the card does by itself: a pin that moved under her without being asked to
      // is the bug v209 was written to end.
      lookBtn = button("Look this address up again", () => relookUp(), "ghost small");
      // ONE node, never an array: replaceChildren is variadic, and an array handed to it
      // prints as "[object HTMLParagraphElement],…" with nothing left to press — the fault
      // this card shipped at v195.
      doorBox.replaceChildren(
        el("div", { class: "field", style: "margin:0" },
          el("label", {}, "The door the driver is sent to"),
          doorWords,
          doorMapBox,
          el("div", { class: "btn-row", style: "margin-top:10px" }, doorBtn, lookBtn)));
    }

    const spot = doorSpot();
    // WHICH DOOR IS IN FORCE, and it is not the same question as whether a door is kept
    // (v209): where the customer dropped their own pin, THEIR pin is the door even though a
    // door of hers still exists on the profile. The wording below has to follow the point,
    // not the row — otherwise the card would call the customer's pin "the door you keep".
    //
    // THREE STATES, and a door she keeps is only one of them. A door that came from a lookup
    // is neither her hand nor the customer's pin, and it is still "the door you keep for her" —
    // which is why this asks whose pin the point is, rather than asking about her hand.
    const theirs = theirsIsTheDoor();
    const addr = dropAddress(first);
    const who = String(first.customerName || "the customer").trim() || "the customer";
    // AND THE DOOR SHE KEEPS HAS TO ADMIT WHEN IT IS ONLY THE ROAD (v211). Its line names the
    // door with the address on the order — house number and all — and a lookup that could only
    // find "Seang Tek Road, George Town" over a typed "23 Jalan Seang Tek" would otherwise wear
    // "23 Jalan Seang Tek" back at her on this card, over a pin on the street. The number the
    // lookup missed is stored on the door (see doorRoadOf), so the line can keep saying the
    // address AND say the pin is not the door — on every repaint, not just the one that
    // followed the lookup. Only her door can carry the stamp: it is a lookup that writes one.
    const road = doorRoadOf(state, first);
    const roadTail = road ? ` ${roadNotHouse(road)}` : "";

    // What she reads. Three states and each one says which it is, because the difference
    // between "the door I keep for them" and "the pin they dropped themselves" is the whole
    // of what a doorstep is — and the second must never read as the first.
    //
    // AND THE DOOR SHE KEEPS IS SAID WITH THE ADDRESS ON THE ORDER (v207), which is the one
    // wording change there. Her report, three times over: "the pin still wrong". Measured on
    // this card, the line used to read "12 Jalan Bunga, 10450 Penang — the door you keep for
    // Mei Ling: Taman Sri Nibong, George Town" — the address she and the customer both use,
    // and then a SECOND name for the same door, disagreeing with it. That second name is not
    // a name at all: it is the row the geocoder answered with when the door was first looked
    // up, and a row is a FRAGMENT — a street and a town, no house number (the same fact v205
    // settled for the customer's own pin, and see courier_place.js splitLabel for why the
    // fragment has no door in it). A door she keeps is the point for an address, so the
    // address is what it is called; where the order has none, the stored words are the only
    // name there is and they stand. The customer's own pin keeps its own words when they
    // differ, because THOSE words are the customer's own address (v205) — a fact from them,
    // not a note of this app's.
    //
    // THE THIRD STATE CHANGED AT v209 and the sentence with it. It used to end "Not yet the
    // door the driver is sent to", which was true while their pin was only ever a suggestion.
    // It is the door now, so the line says so, and it says WHY — because a door she keeps can
    // still exist and she will want to know why the dot is not on it.
    doorWords.textContent = !spot
      ? (addr
        ? `${addr} — no point pinned yet, so the driver is sent to that address.`
        : "This order has no delivery address yet, and no point pinned. The picker below can pin a point on its own.")
      : theirs
        ? `${addr ? `${addr} — ` : ""}${who}'s own pin from the shop page${
          spot.label && spot.label !== addr ? `: ${fmtPlace(spot)}` : ""
        }. This is the door the driver is sent to.`
        : `${addr || fmtPlace(spot)} — the door you keep for ${who}.${roadTail}`;


    if (doorBtn) {
      doorBtn.textContent = !spot
        ? "Put this doorstep on the map"
        : doorLocked ? "Move this pin" : "Done moving";
    }

    // ASK UP AGAIN, WHERE ASKING CAN STILL HELP (v213) — the rule itself is in
    // courier_place.js. Not over the customer's own pin, which is a fact from them, and not
    // over a pin she placed by her own hand, which is a correction and not a guess. No door
    // at all means nothing to re-ask for: the price press looks one up by itself.
    if (lookBtn) {
      lookBtn.hidden = !(spot && addr && doorMayBeLookedUpAgain(state, first));
    }

    if (!spot) {
      // A map with no pin on it is a picture of nothing, and it would spend 200 pixels of
      // this card saying so. No point, no map.
      if (doorHandle) { doorHandle.destroy(); doorHandle = null; }
      doorMapBox.hidden = true;
      return;
    }

    doorMapBox.hidden = false;
    // Idempotent. The map is built ONCE, and every later paint moves the pin on the map
    // that is already there: rebuilding it would re-fetch every tile to say the same thing,
    // and a repaint arriving mid-drag would take the pin out from under her finger.
    if (doorHandle) { doorHandle.setPlace(spot); return; }

    doorHandle = mountPinMap(doorMapBox, {
      place: spot,
      onMove: (moved) => {
        // A drag gives a point and no words, and a point with no label reads as two bare
        // numbers everywhere this door is said out loud — the ends line, the track card.
        // So the words are read from the door AT THE MOMENT OF THE DRAG rather than taken
        // once when the map was built: the pin the panel looked up on its way to a price
        // overwrites what this door is called, and a label captured at mount would quietly
        // put the old name back on the next drag.
        //
        // A DRAG CHANGES THE POINT AND NEVER THE WORDS, which is why this reads the door SHE
        // KEEPS and not the point in force. Dragging is how she corrects a doorstep, and the
        // record it writes is her own hand — named the way every door of hers is named, from
        // the address on the order (v207). Reading the point in force here would rename the
        // door the moment their own pin became it, so one drag would silently swap
        // "12 Jalan Bunga, 10450 Penang" for the words on the customer's pin. Measured on
        // this card at v209, against the v207 test below.
        const words = (dropPlaceOf(state, first) || {}).label || dropAddress(first);
        // No `from` argument: a drag is her own hand, which is the default — and it is what
        // makes this correction stick rather than losing to the customer's pin again.
        setDropPlace(state, first, { lat: moved.lat, lng: moved.lng, label: words });
        // The host owns persistence for the card it built, exactly as it does for a booking.
        if (onCommit) onCommit(first);
        paintDoor();
        invalidatePrices();
      },
      onFail: (why) => {
        // No map — and the door is still checkable. The coordinates above are the same fact
        // a map would have drawn, and the picker's number field is one tap away.
        doorHandle = null;
        doorMapBox.hidden = true;
        doorWords.textContent += ` (The map is not available right now — ${why}. The point above is still the door.)`;
      },
    });
  }

  // Drawn on the card the moment the box opens, for a courier order, whether or not she
  // ever asks for a price. This runs while the host is still assembling the card it belongs
  // to, which is why nothing here may need a measured box: the map is built inside the
  // loader's callback, and by then the card is on the page.
  doorBox = doorSlot || null;
  paintDoor();

  // ── built once, on the first open ──────────────────────────────────────
  function build() {
    const endsLine = el("p", { class: "card-sub", style: "margin:0 0 10px" });
    const endsRow = el("div", { class: "btn-row" });

    const pickupBtn = button("Pin your door", () => {
      openPlacePicker({
        state,
        title: "Your pickup pin",
        hint: "This is the door the driver collects from. Pin it once — it is kept with your settings and travels to your other phone.",
        address: pickupAddress(state),
        start: (state.settings && state.settings.pickupPlace) || null,
        onPick: (spot) => {
          setPickupPlace(state, spot);
          paintEnds();
          ask();
        },
      });
    }, "ghost small");

    // The two doors on this order, when they disagree: one line and one press, sitting
    // directly under the doorstep sentence it would change, tinted so it cannot be mistaken
    // for another fact about this order.
    //
    // ONE CONTROL, TWO DIRECTIONS (v209). Until v209 only one direction could ever arise,
    // because the door she keeps always won and the pin the customer dropped could only be
    // the alternative — so this offered "Use the customer's pin" and nothing else. Now the
    // customer's pin is normally the door in force, so the same control has to be able to
    // offer the door SHE keeps instead. `which` says which door is being offered.
    //
    // It disappears when the two agree (to within SAME_DOOR_DEG), which is what makes
    // pressing it the thing that ends it, with no "dismissed" flag for anything to store.
    //
    // THE WORDS ARE DIFFERENT FROM v197's, and deliberately: "the doorstep you keep for them
    // is untouched until you take this one" described a world where their pin was only a
    // suggestion. It is the door now, so the line says what is happening instead — and when
    // their pin is the one in force, the customer's own pin is what the card is using, so
    // the press on offer is the one that puts HER door back.
    const offerBox = el("div", { class: "pin-offer", hidden: true });

    function paintOffer() {
      const offer = doorSwitchOf(state, first);
      if (!offer) {
        offerBox.hidden = true;
        offerBox.replaceChildren();
        return;
      }
      const who = String(first.customerName || "the customer").trim() || "the customer";
      // `which: "customer"` means her own door is the one in force and the pin they dropped is
      // the alternative — so the words below split on this one flag, and nothing else.
      const theirs = offer.which === "customer";
      offerBox.hidden = false;
      offerBox.replaceChildren(
        el("p", { class: "card-sub" },
          theirs
            ? `${who} pinned a different spot this time. Taking it replaces the doorstep you keep for them.`
            : `${who}'s own pin is in use. The doorstep you keep for them is a different spot.`),
        el("div", { class: "btn-row" },
          button(theirs
            ? "Use the customer's pin instead"
            : "Use the door I keep instead", () => {
            // The identical path the map's own picker takes, so a pin taken up here
            // and a pin placed by hand land as the same record — but tagged by WHAT THE
            // POINT IS, not by who pressed: a door taken up from their pin stays theirs
            // (so a customer who re-pins later still wins), and her own door is recorded
            // as her own hand (so it sticks).
            //
            // And the road caveat travels with the door it is about (v211): the door she
            // keeps here is the SAME POINT that was looked up, so if the lookup could only
            // find the road, taking it back over their pin does not make it a house — a
            // warning dropped by the one press that asserts the door would be a warning that
            // disappears exactly where it is still needed.
            setDropPlace(state, first, offer.place, theirs ? "customer" : "hand",
              theirs ? "" : doorRoadOf(state, first));
            paintEnds();
            ask();
          }, "ghost small")),
      );
    }

    function paintEnds() {
      const up = pickupPlace(state);
      const drop = doorSpot();
      const who = String(first.customerName || "the customer").trim() || "the customer";
      endsLine.textContent = [
        up ? `From ${fmtPlace(up)}` : "Your pickup spot is not pinned",
        drop ? `to ${fmtPlace(drop)}` : `to ${who} — doorstep not pinned`,
        drop || dropAddress(first) ? "" : "(this order has no address yet)",
      ].filter(Boolean).join(" ");
      // The door block at the top of the card is the customer end's one control now (v201).
      // It stays on screen once a pin exists and that is the point: a pin that landed on
      // the wrong estate is worse than no pin, and she is the only one who knows which it
      // is — so it reads [Move this pin] rather than going away and leaving her no way back
      // to the map. This row keeps your own end, which is a setup act rather than a
      // per-trip one and belongs with the prices.
      endsRow.replaceChildren(...[up ? null : pickupBtn].filter(Boolean));
      paintOffer();
      // The map follows the pin. This is the hook that matters most: on an order that has
      // never been pinned, `ask()` looks the address up and keeps the answer against the
      // customer, so the door block that was showing "no point pinned yet" is holding a
      // point a moment later. Repainted from here, because every route that changes a door
      // already ends at paintEnds.
      paintDoor();
    }

    // ── the trip this order is on ────────────────────────────────────────
    //
    // Drawn above everything else, because a live trip is the state of this order and
    // not a footnote to a price. Two faces, decided by what is on the orders:
    //
    //   • no trip running — nothing here, and the prices below carry [Book this trip]
    //   • a trip running   — the vehicle, the price, when it was booked, where it has
    //                        got to and the customer's link, with [Check the trip] and
    //                        [Cancel trip]; the price rows stay askable but their book
    //                        buttons go inert WITH the reason on screen, because a
    //                        second booking is a second van at the same door
    //
    // A finished trip stays on the card rather than disappearing. It is the record of
    // what was delivered and what it cost, and the only thing tying a charge on her
    // books to a real journey — a card that quietly emptied itself would leave her
    // wondering whether she had imagined booking it.
    const jobBox = el("div", {});

    function paintJob() {
      jobClocks = [];
      const jobs = list.map(jobOf).filter(Boolean);
      if (!jobs.length) { jobBox.replaceChildren(); return; }
      const job = jobs[0];
      const done = !liveJobOf(first);
      const holder = courierByKey(job.provider) || courier;
      const today = todayISO();

      const what = el("div", { class: "job-what" },
        el("span", { class: "job-name" }, `${String(job.name || "").trim() || "Trip"} · ${fmtQuote(job.amount, job.currency, cur)}`),
        el("span", { class: "job-sub" }, [
          job.bookedAt ? `Booked ${fmtStamp(job.bookedAt, today)}` : "",
        ].filter(Boolean).join(" · ")));

      // WHERE IT HAS GOT TO. The moment is when this was READ off the courier, and it
      // says so, because the courier's own reply carries no timestamp for a status — a
      // screen that showed a status without saying when it was read would be presenting
      // a snapshot as if it were live. When she called the trip off from here the app
      // knows that first-hand and says that instead, rather than inventing the word the
      // courier would have used.
      const statusLine = el("p", { class: "job-status" });
      const paintStatus = (now) => {
        const said = job.cancelledAt
          ? `Called off from here ${fmtStamp(job.cancelledAt, today)}`
          : [holder.statusLabel ? holder.statusLabel(job.status) : job.status,
             job.statusAt ? `read ${fmtAgo(job.statusAt, now)}` : ""].filter(Boolean).join(" — ");
        statusLine.textContent = said ? `Status: ${said}` : "";
      };
      paintStatus(Date.now());
      // A live status ages while she reads it, and "read just now" sitting there after
      // ten minutes would be the one line on this card that is quietly wrong. Reusing
      // the same one-second tick as the prices, so there is one timer in this section.
      if (!job.cancelledAt && job.statusAt) jobClocks.push((now) => paintStatus(now));

      // The driver, when a check has found one (v190). Not known at booking time and
      // never invented: this courier hands the name, the plate and a number over only
      // shortly before the pickup, so the line is drawn when there is something to put on
      // it and is simply absent before that. Built as one node and handed to `el`, so an
      // absent line is absent rather than the word "null" printed on her card.
      const drv = job.driver || null;
      const who = drv ? [String(drv.name || "").trim(), String(drv.plate || "").trim()].filter(Boolean).join(" · ") : "";
      const dial = drv ? String(drv.phone || "").replace(/[^\d+]/g, "") : "";
      const driverLine = (who || dial)
        ? el("p", { class: "job-driver" },
            who ? `Driver: ${who}` : "",
            dial ? el("a", { href: `tel:${dial}` }, `${who ? " · " : ""}Call the driver`) : null)
        : null;

      const linkLine = el("p", { class: "job-link" });
      if (isLink(job.link)) {
        linkLine.append("The customer's link: ", el("a", { href: job.link, target: "_blank", rel: "noopener" }, job.link));
      } else if (job.link) {
        linkLine.textContent = `The courier's reference: ${job.link}`;
      } else {
        linkLine.textContent = "The courier sent back no link for this trip, so there is nothing on the customer's card but this record.";
      }

      const checkBtn = button("Check the trip", () => check(), "ghost small");
      const cancelBtn = done ? null : button("Cancel trip", () => cancel(job), "danger small");
      const row = el("div", { class: "job-row" },
        what,
        el("div", { class: "job-actions" }, checkBtn, cancelBtn));

      jobBox.replaceChildren(
        el("div", { class: "job-card" },
          el("p", { class: "job-head" }, done
            ? `A ${holder.label} trip on this order`
            : `${holder.label} is on this order`),
          row,
          statusLine,
          driverLine,
          linkLine),
      );
      if (jobBusy) { checkBtn.disabled = true; if (cancelBtn) cancelBtn.disabled = true; }
    }

    // Everything this section ever needs to ask of the courier's own reading of a
    // trip, asked of the courier that HOLDS the trip rather than of whichever is
    // selected today: a trip booked with one courier has to be checked and cancelled
    // through that one.
    function holderOf(job) {
      return courierByKey(job && job.provider) || courier;
    }

    // Write a trip onto the orders this section was handed, and hand them to the host
    // to save. The link goes into the tracking slot ONLY when the courier really sent
    // one — an empty link must never blank a tracking number she typed by hand, which
    // would be this screen deleting a customer's reference on the strength of an
    // absence in somebody else's reply.
    //
    // The courier's own NAME is stamped on the record here and travels with the trip.
    // The customer's card has to say who is bringing the parcel, and it must not be
    // taught a provider key — `lalamove` is a word this app keeps inside one file, and a
    // card that switched on it would have to be edited for a second courier. So the key
    // is turned into the courier's own label ONCE, at the moment the trip is written,
    // and what the customer reads is a word plain enough to need no lookup.
    //
    // `justCollected` is true on the ONE commit where a check has first SEEN the trip
    // collected. It is a transition and not the state, and the difference matters: the
    // host moves an order's status, and a state would move it again on every later
    // check — including the check she makes right after undoing the move, which would
    // put it straight back. An Undo that a look undoes has not undone anything.
    function commit(job, justCollected = false) {
      const named = job
        ? { ...job, courierName: (holderOf(job) || {}).label || job.courierName || "" }
        : job;
      for (const o of list) {
        o.courierJob = named;
        if (named && named.link) o.trackingNo = named.link;
      }
      // Whatever the host has to say about the order moving comes back here, so the check
      // can fold it into the ONE toast it already raises rather than stacking a second
      // message on top of it.
      const said = justCollected && onCollected ? (onCollected(first) || "") : "";
      if (onCommit) onCommit(first);
      return said;
    }

    // ── booking ──────────────────────────────────────────────────────────
    function book(q) {
      if (jobBusy || !wrap.isConnected) return;
      const trip = pricedTrip;
      if (!trip) { toast("Ask for a price first — a trip is booked at the price it was quoted at."); return; }
      const money = fmtQuote(q.amount, q.currency, cur);
      // Restating the vehicle and the price is the whole point of this box: the two
      // facts she is about to commit money to, and the one thing a booking changes
      // that she would not expect — the tracking box. Then the honest warning about
      // undoing it, because that window is short and it is the courier's to close.
      confirmDialog(
        `Book the ${String(q.name || "vehicle").trim() || "vehicle"} with ${courier.label} for ${money}? ` +
        `A driver will be sent to you. ` +
        `The customer's tracking box will be replaced with this trip's share link, so the card and the shipped message send them there instead. ` +
        `This books a real trip and spends real money, and ${courier.label} only lets it be called off while a driver is still being found.`,
        async () => {
          if (jobBusy || !wrap.isConnected) return;
          // No button of its own: the yes-press belongs to the dialog. Wrapped all the same,
          // because `jobBusy` is what a throw used to leave set — and a set `jobBusy` is a
          // Book button that answers nothing for the life of the card. The sentence is
          // deliberately not "nothing was booked": this is the one press here that spends
          // money, and a throw on the way back cannot tell her which side of it we are on.
          await guarded({
            hold: (v) => { jobBusy = v; },
            work: () => bookNow(q, trip),
            said: (s) => { statusLine.textContent = s; paintQuotes(); paintJob(); },
            trouble: `The booking could not be finished — check the trip in ${courier.label} before pressing again, in case it went through`,
          });
        },
        { danger: true, yesLabel: "Book this trip" },
      );
    }

    async function bookNow(q, trip) {
      jobBusy = true;
      statusLine.textContent = `Booking the ${String(q.name || "trip").trim() || "trip"} with ${courier.label}…`;
      paintQuotes();
      paintJob();
      const holder = courierByKey(courier.key) || courier;
      const out = await holder.book(state, trip, q);
      if (!wrap.isConnected) return;
      jobBusy = false;
      if (!out.ok) {
        statusLine.textContent = out.reason;
        paintQuotes();
        paintJob();
        return;
      }
      commit(out.job);
      statusLine.textContent = "";
      paintQuotes();
      paintJob();
      toast(out.job.link
        ? `Trip booked with ${holder.label} — the customer's tracking box now holds the share link`
        : `Trip booked with ${holder.label} — the courier sent back no share link`);
    }

    // ── checking a booked trip ───────────────────────────────────────────
    async function check() {
      if (jobBusy || !wrap.isConnected) return;
      const job = jobOf(first);
      if (!job) return;
      // Wrapped on `jobBusy` like the two presses above (v217). Its failures are said in a
      // toast rather than the status line, so that is where a throw goes too.
      await guarded({
        hold: (v) => { jobBusy = v; },
        work: () => checkNow(job),
        said: (s) => { toast(s); paintJob(); },
        trouble: `The trip could not be checked with ${holderOf(job).label}`,
      });
    }

    async function checkNow(job) {
      const holder = holderOf(job);
      jobBusy = true;
      paintJob();
      const out = await holder.job(state, job.jobId);
      if (!wrap.isConnected) return;
      jobBusy = false;
      if (!out.ok) {
        toast(out.reason);
        paintJob();
        return;
      }
      // Merged rather than replaced: the courier's answer names the status and the
      // link, and everything else on the record — what was booked, when, and what it
      // was quoted at — is the order's own memory of the trip, not the courier's. A
      // check that overwrote the record with the reply would forget the price it was
      // booked at the first time she looked at it.
      const wasCollected = tripCollected(job);
      const next = { ...job, status: out.detail.status, statusAt: out.detail.statusAt, done: out.detail.done };
      if (out.detail.link) next.link = out.detail.link;
      // The phase and the driver are carried the same way, and for the same reason the
      // link is: empty means the courier TOLD US NOTHING this time, not that there is
      // nobody driving. A check made before a driver is matched answers with neither, so
      // treating an empty answer as an erasure would take the driver's name and number
      // off the customer's card at the exact moment they became useful.
      if (out.detail.phase) next.phase = out.detail.phase;
      if (out.detail.driver) next.driver = out.detail.driver;
      if (out.detail.done) delete next.cancelledAt;
      const said = commit(next, !wasCollected && tripCollected(next));
      paintJob();
      const read = holder.statusLabel ? holder.statusLabel(out.detail.status) : out.detail.status;
      // One toast carrying both facts, because they are one event: what the courier says,
      // and what this app did about it. Two messages would let her read the first and miss
      // the second, and the second is the one that changed an order.
      toast(said ? `Trip status: ${read}. ${said}` : `Trip status: ${read}`);
    }

    // ── calling a trip off ───────────────────────────────────────────────
    function cancel(job) {
      if (jobBusy || !wrap.isConnected) return;
      const holder = holderOf(job);
      confirmDialog(
        `Call off this ${holder.label} trip? The driver stops being sent, and the customer's tracking box keeps the link but nothing will update it. ` +
        `This cannot be undone from here — you would have to book again, at a fresh price.`,
        async () => {
          if (jobBusy || !wrap.isConnected) return;
          // Wrapped like every other press on this guard (v217), and with the same careful
          // sentence as booking: a cancellation that throws on the way back cannot say which
          // side of it we are on, so it says to look rather than to press again.
          await guarded({
            hold: (v) => { jobBusy = v; },
            work: () => cancelNow(holder, job),
            said: (s) => { toast(s); paintJob(); },
            trouble: `The trip may not have been called off — check it in ${holder.label} before pressing again`,
          });
        },
        { danger: true, yesLabel: "Call it off" },
      );
    }

    async function cancelNow(holder, job) {
      jobBusy = true;
      paintJob();
      const out = await holder.cancel(state, job.jobId);
      if (!wrap.isConnected) return;
      jobBusy = false;
      if (!out.ok) {
        // An ordinary answer rather than a fault: the courier decides how long a
        // trip may still be called off, and it says so in its own words.
        toast(out.reason);
        paintJob();
        return;
      }
      // The app records that SHE called it off, with the moment, rather than a
      // status word the courier never gave: a DELETE answers with nothing at all,
      // so a card claiming "Cancelled" in the courier's own voice would be this
      // screen putting words in its mouth.
      commit({ ...job, done: true, cancelledAt: new Date().toISOString() });
      paintJob();
      toast("Trip called off");
    }

    // ── when the driver collects ─────────────────────────────────────────
    const dayInput = el("input", { class: "input", type: "date", value: orderDay(state, first),
      "aria-label": "The day the driver collects" });
    const timeInput = el("input", {
      class: "input", type: "time",
      value: String(((state.settings || {}).courier || {}).dispatch || "").trim(),
      "aria-label": "The time the driver collects",
    });
    const whenNote = el("p", { class: "card-sub", style: "margin:6px 0 0" });

    function whenLabel() {
      const d = String(dayInput.value || "").trim();
      const t = String(timeInput.value || "").trim();
      if (!d) return "as soon as possible";
      return t ? `${d} at ${t}` : d;
    }
    // The time box is inert without a day, and it is DRAWN inert with the reason
    // beside it: a time with no day is a schedule the API cannot be given at all, so
    // leaving it live would be a control that does nothing.
    function paintWhen() {
      const d = String(dayInput.value || "").trim();
      timeInput.disabled = !d;
      whenNote.textContent = d
        ? "The time the driver collects. It opens on the app's own dispatch time; changing it here changes this price only — when a trip can really be booked, this becomes a setting of its own."
        : "This order has no delivery day on it, so this prices collection as soon as possible. Choose a day to schedule it.";
      if (pricedFor && pricedFor !== whenLabel()) {
        whenNote.textContent += ` The prices below were asked for ${pricedFor}.`;
      }
    }

    // ── the prices ───────────────────────────────────────────────────────
    const quoteBox = el("div", { class: "quote-box" });
    const statusLine = el("p", { class: "card-sub", style: "margin:10px 0 0" });
    const askBtn = button(`Get a price from ${courier.label}`, () => ask(), "primary");
    const askRow = el("div", { class: "btn-row", style: "margin-top:12px" }, askBtn);

    function useFee(q) {
      if (!onUseFee || quoteExpired(q)) return;
      // The charge box is asked whether it TOOK the amount before this says it did. A
      // courier replying with a total of zero is answered with a price of RM 0.00 on
      // the row above, and a zero is not a charge — so the box refuses it, and a toast
      // claiming otherwise would be the screen telling her a number had landed when
      // the very box it landed in was empty.
      if (onUseFee(q) === false) {
        toast(`${courier.label} priced this trip at ${fmtQuote(q.amount, q.currency, cur)} — that is not a charge, so nothing was put in the box. Ask again, or type the amount.`);
        return;
      }
      // The fee is in the box and this section is about to fold away, so this is the one
      // moment she can be told what still has to happen for it to SAVE. Her question on
      // 27 Sep 2026 was "should i book?" — booking is not what saves a charge, and the
      // payer question is the thing that does.
      toast(`Fee ${fmtQuote(q.amount, q.currency, cur)} put in the charge box — now choose who paid the courier and press Save. Booking a trip is separate: the charge saves without one.`);
      // Folded away so the amount it just wrote is what she is looking at, with the
      // payer question under it — which is the next thing she has to answer.
      open = false;
      paintFold();
    }

    // One price, as a row: the vehicle, what it costs, how far it is, and how long the
    // number is good for. Everything the row cannot hold is nowhere, because a phone
    // has no hover — so nothing that matters is left out.
    //
    // Two presses per row and they are deliberately different kinds of thing: [Use this
    // fee] fills the charge box and costs nothing, and [Book this trip] spends real
    // money on a real vehicle. They go through `.quote-row`'s own wrap, so a phone that
    // cannot hold both on one line puts the second on a line of its own rather than off
    // the card.
    function quoteRow(q, whyRows) {
      const dist = fmtDistanceKm(q.distanceKm);
      const durable = q.expiryFrom !== "policy";
      const sub = el("span", { class: "quote-sub" });
      const useBtn = onUseFee ? button("Use this fee", () => useFee(q), "primary small") : null;
      // A live trip blocks a booking HERE as well as refusing it inside the courier, so
      // the two can never disagree. Drawn inert with the reason on screen rather than
      // hidden: a price row with no way to book it and no word about why is a screen
      // with a hole in it, and the reason is the useful part — she has to call the
      // running trip off first.
      const bookBlocked = liveJobProblem(list);
      const bookBtn = button("Book this trip", () => book(q), "soft small");
      const row = el("div", { class: "quote-row" },
        el("div", { class: "quote-what" },
          el("span", { class: "quote-name" }, String(q.name || "").trim() || "Vehicle"),
          sub),
        el("span", { class: "quote-price" }, fmtQuote(q.amount, q.currency, cur)),
        useBtn, bookBtn);

      clocks.push((now) => {
        const left = fmtQuoteLeft(q, now);
        const dead = left === "expired";
        // WHY this price cannot be booked, asked of the COURIER rather than worked out
        // here (v216). This row used to keep its own, shorter list — dead, no id, a stop
        // list under two — so a price the adapter would refuse for any OTHER reason, a
        // reply that came back without the courier's own handle for a door above all, was
        // drawn as an inert button with nothing said about it. Her report: "now the
        // greyed out book button". One question, one answer, in the file that refuses the
        // booking — which is what `bookProblem`'s own comment asks for.
        const why = typeof courier.bookProblem === "function" && pricedTrip
          ? courier.bookProblem(state, pricedTrip, q) : "";
        // The row already says "expired — ask again" and the button already reads
        // "Expired", so the adapter's own expiry sentence would only say it a third time.
        whyRows.set(q, dead ? "" : why);
        sub.replaceChildren(...[
          dist,
          dist ? " · " : "",
          dead ? "expired — ask again" : durable ? `valid for ${left}` : `about ${left} left`,
        ].filter((x) => x !== ""));
        if (useBtn) {
          useBtn.disabled = dead;
          if (dead) useBtn.textContent = "Expired";
        } else if (dead) {
          row.classList.add("quote-dead");
        }
        // `why` covers everything `unbookable` used to, and more — except the dead clock,
        // which is this row's own reading of the time and not a property of the quote.
        bookBtn.disabled = dead || !!why || !!bookBlocked || jobBusy;
        if (dead) bookBtn.textContent = "Expired";
      });
      return row;
    }

    function paintQuotes() {
      clocks = [];
      // One sentence per DISTINCT reason, said once under the prices rather than twice
      // under each row. Every row here is priced for the same trip and the same doors, so
      // a reason that applies to one nearly always applies to all of them — and eight
      // copies of one paragraph is not eight times the information, it is one sentence
      // made unreadable. Each row writes its own reason into this map and then republishes
      // the whole of it, so the last row to tick this second leaves the node complete.
      const whyRows = new Map();
      const whyNode = el("p", { class: "card-sub", style: "margin:8px 0 0" });
      whyNode.hidden = true;
      const publishWhy = () => {
        const said = [...new Set([...whyRows.values()].filter(Boolean))];
        whyNode.textContent = said.join(" ");
        whyNode.hidden = said.length === 0;
      };
      const rows = quotes.map((q) => quoteRow(q, whyRows));
      // Pushed as a CLOCK and not merely called here, so the ticker republishes it too:
      // the adapter's reason is read from the quote's own expiry, and a price that runs
      // out while the card is open has to be able to say so. Clocks run in the order they
      // were pushed, so this one runs after every row has written its entry.
      clocks.push(publishWhy);
      const missed = failed.map((f) => el("p", { class: "card-sub", style: "margin:6px 0 0" },
        `${String(f.name || f.service || "A vehicle").trim()}: ${f.reason}`));
      // Why no row can be booked, when that is the case.
      const blocked = quotes.length ? liveJobProblem(list) : "";
      // `.filter(Boolean)` and NOT a bare `?: null`. replaceChildren is a DOM method, so
      // it converts each argument with String() — a null handed to it becomes a TEXT node
      // reading "null", printed on her screen. el() skips nulls; this does not. v189 wrote
      // the two optional lines below as bare `?: null`, and the drawn panel printed the
      // word under the last price row. It was found by reading the drawn panel, because
      // the ordinary view shim drops null arguments and cannot see it; no-null-text.js's
      // shim does not drop them on purpose, and now renders this panel too.
      quoteBox.replaceChildren(...[
        ...rows,
        ...missed,
        whyNode,
        blocked ? el("p", { class: "card-sub", style: "margin:8px 0 0" }, blocked) : null,
        quotes.length ? el("p", { class: "card-sub", style: "margin:8px 0 0" },
          "Booking a trip does not put its fee in the charge box — the courier's charge, who pays it and whether it is collected at the door are still yours to set above, and it is the Save button that writes them.") : null,
      ].filter(Boolean));
      for (const c of clocks) c(Date.now());
    }

    // ── asking ───────────────────────────────────────────────────────────
    //
    // WRAPPED, BECAUSE THE GUARD IS THE BUG (v217). Every exit from `askBody` below clears
    // `busy` and re-arms the button on its own, which is right — but an exit it did not know
    // about (anything that threw) left both where they were: a greyed button, a status line
    // still saying "this takes a few seconds", and every later press returned at once by
    // `if (busy …) return` with nothing said at all. That is a dead control, and it is the
    // fault she reported as "the get price from lalamove not responding". `guarded` releases
    // the guard and the button whatever happened, and SAYS the throw. `build()` ends by
    // calling this, so it is also the press that runs when the fold opens.
    async function ask() {
      if (busy || !wrap.isConnected) return;
      await guarded({
        btn: askBtn,
        hold: (v) => { busy = v; },
        work: askBody,
        said: (s) => { statusLine.textContent = s; },
        trouble: "The price could not be asked for, and nothing has been priced",
      });
    }

    async function askBody() {
      busy = true;
      askBtn.disabled = true;
      stopClock();
      quotes = [];
      failed = [];
      pricedFor = "";
      pricedTrip = null;
      paintQuotes();
      paintEnds();
      paintJob();

      // 1. YOUR DOOR.
      if (!pickupPlace(state)) {
        busy = false;
        askBtn.disabled = false;
        statusLine.textContent = pickupAddress(state)
          ? "Your pickup spot is not pinned yet — pin it here or in Settings, and every price from now on is for the right door."
          : "Pin your pickup spot first — a courier needs a door to collect from.";
        return;
      }

      // 2. THE CUSTOMER'S DOOR, looked up ONCE and then kept against the person, so a
      //    second order from the same number costs no lookup at all.
      //
      //    AND WHEN THE CUSTOMER LEFT A PIN OF THEIR OWN, THAT PIN IS THE DOOR — no
      //    lookup is asked for and none is spent (v208). This is the bug she reported
      //    four times as "the pin still wrong" and then, pointed at, as "the dot is in
      //    the wrong place": the card opens with the dot ON the customer's own pin
      //    (`doorSpot` falls back to it), and this block used to look the typed address
      //    up and keep the geocoder's answer instead — moving the dot to the STREET,
      //    because that is all a geocoder can answer for a Malaysian house number. The
      //    price is for the door on screen, so the point is theirs. Their own pin beats
      //    any geocoder here for the reason store/geo.js gives at the top of its own
      //    header: they were at their door when they dropped it.
      if (!dropPlaceOf(state, first)) {
        const words = dropAddress(first);
        const theirs = customerPlaceOf(first);
        if (theirs) {
          // The POINT is theirs and the WORDS are the address on the order (v207) —
          // the same split as the branch below, with a better point to make it from.
          // Tagged "customer" (v209): this row is a COPY of their pin, so it must keep
          // losing to their pin — if they drop a new one, the new one is the door.
          setDropPlace(state, first, { lat: theirs.lat, lng: theirs.lng, label: words || theirs.label }, "customer");
          paintEnds();
        } else {
          if (!words) {
            busy = false;
            askBtn.disabled = false;
            statusLine.textContent = "This order has no delivery address to look up. Put the pin on the map, or add the address under Edit.";
            return;
          }
          statusLine.textContent = `Looking up ${words}…`;
          const found = await geocodeAddress(state, words);
          if (!wrap.isConnected) return;
          if (!found.ok) {
            busy = false;
            askBtn.disabled = false;
            statusLine.textContent = `${found.reason} Nothing has been priced.`;
            return;
          }
          // THE DOOR IS KEPT NAMED WITH THE ADDRESS IT WAS LOOKED UP FOR (v207), and
          // this is the line that matters most because it fires BY ITSELF — she presses
          // "Get a delivery price" and the door is found, kept and named without her
          // choosing anything. It used to keep `found.place` whole, which meant the name
          // it kept was whatever the geocoder called the place: a row, a fragment, no
          // house number. So the POINT is the geocoder's and the WORDS are hers, which
          // is exactly the split store/geo.js's placeForOrder makes on the shop side.
          setDropPlace(state, first, { lat: found.place.lat, lng: found.place.lng, label: words }, "lookup", houseNotIn(words, found.place));
          paintEnds();
        }
      }

      // 3. THE FLEET, from the courier's own list rather than one written down here, so
      //    a vehicle it adds or retires appears without a release.
      statusLine.textContent = `Asking ${courier.label} for a price on every vehicle — this takes a few seconds.`;
      const fleet = await courier.vehicles(state);
      if (!wrap.isConnected) return;
      if (!fleet.ok) {
        busy = false;
        askBtn.disabled = false;
        statusLine.textContent = fleet.reason;
        return;
      }
      const trip = tripOf(state, list, {
        scheduleAt: scheduleAtUTC(dayInput.value, String(timeInput.value || "").trim()),
      });
      const problem = tripProblem(trip);
      if (problem) {
        busy = false;
        askBtn.disabled = false;
        statusLine.textContent = problem;
        return;
      }

      const out = await courier.quote(state, trip, {
        services: fleet.vehicles.map((v) => v.key),
        scheduleAt: trip.scheduleAt,
      });
      if (!wrap.isConnected) return;
      busy = false;
      askBtn.disabled = false;
      if (!out.ok) {
        statusLine.textContent = out.reason;
        return;
      }
      quotes = out.quotes || [];
      failed = out.failed || [];
      pricedFor = whenLabel();
      // Kept with the prices, because a booking is made of it: see `pricedTrip`.
      pricedTrip = trip;
      paintQuotes();
      paintWhen();
      statusLine.textContent = quotes.length
        ? `${quotes.length} price${quotes.length === 1 ? "" : "s"} from ${courier.label}, just now, for collection ${pricedFor}. Each one dies on its own clock.`
        : "No vehicle could be priced for this trip.";
      startClock();
    }

    // What a moved pin does to this half of the card. Assigned here because only build()
    // knows about the prices — and it is deliberately NOT "ask again": the numbers on screen
    // were quoted for the door she has just left, so they go, and this is the sentence that
    // sends her back to the one button that produces new ones. The section's own rule, from
    // the top of this file: a re-ask is eight requests and it stays her tap.
    afterDoorMove = (note = "") => {
      paintEnds();
      paintQuotes();
      paintWhen();
      // ONE promise, said once. `note` is the re-lookup's own news about WHAT moved (v213) and
      // never a second telling of what happens to the prices — two sentences that must agree
      // about the same consequence are two sentences that can come apart. Left out, the
      // sentence is byte for byte the one a drag has always produced.
      const prices = "The prices that were here were quoted for the old one.";
      statusLine.textContent = note
        ? `${note} Ask again for a price for this spot. ${prices}`
        : `The door moved — ask again for a price for this spot. ${prices}`;
    };

    // ── asking the same address up again (v213) ──────────────────────────
    //
    // Reached from the door block's own second press, and drawn only where a LOOKUP wrote the
    // door (see courier_place.js doorMayBeLookedUpAgain). It exists because a lookup's answer
    // is never re-asked: `ask()` looks an address up only when there is no door yet, and every
    // later price reads the saved one back — so a customer pinned under the free map services
    // keeps that road-level point for as long as the app knows them, and the Google key she has
    // now set would look like it had changed nothing at all.
    //
    // THREE ANSWERS, AND EACH ONE IS SAID. It moved; it did not move; it could not be asked.
    // A button whose only outcome is silence is the dead control this app has a standing rule
    // against, and here silence would be worse than usual — she would have no way to tell a
    // lookup that found the same road from a press that never ran.
    relookUp = async () => {
      const words = dropAddress(first);
      const before = doorSpot();
      if (busy || !words || !before) return;
      // Wrapped for the same reason `ask` is (v217), and on the same guard: a lookup that
      // threw used to leave `busy` set and this button disabled for the life of the card.
      await guarded({
        btn: lookBtn,
        hold: (v) => { busy = v; },
        work: () => relookUpBody(words, before),
        said: (s) => { statusLine.textContent = s; },
        trouble: "The address could not be looked up again, and the door has been left as it was",
      });
    };

    async function relookUpBody(words, before) {
      busy = true;
      if (lookBtn) lookBtn.disabled = true;
      stopClock();
      statusLine.textContent = `Looking ${words} up again…`;
      const found = await geocodeAddress(state, words);
      if (!wrap.isConnected) return;
      busy = false;
      if (lookBtn) lookBtn.disabled = false;
      if (!found.ok) {
        statusLine.textContent = `${found.reason} The door has been left as it was.`;
        return;
      }
      // The house number this answer could not find, by the same test the automatic lookup
      // uses — so a re-lookup that still only reaches the road keeps wearing the caveat (v211)
      // instead of clearing it by having been asked twice.
      const road = houseNotIn(words, found.place);
      const moved = !sameDoor(before, found.place);
      // Written with the address on the order as its name, never the geocoder's row (v207):
      // the same split the lookup makes on its way to a price, so the two cannot disagree.
      setDropPlace(state, first, { lat: found.place.lat, lng: found.place.lng, label: words }, "lookup", road);
      if (onCommit) onCommit(first);
      paintDoor();
      if (!moved) {
        statusLine.textContent = road
          ? `Looking ${words} up again found the same spot, and still only ${roadNotHouse(road, { short: true })}. The pin on the card is where this address is being answered with.`
          : `Looking ${words} up again found the same spot — the pin on the card is what this address is answered with.`;
        return;
      }
      invalidatePrices(road
        ? `The door moved, and it is still only ${roadNotHouse(road, { short: true })}.`
        : "The door moved — the lookup answers this address with a different point now.");
    }

    dayInput.addEventListener("input", paintWhen);
    timeInput.addEventListener("input", paintWhen);

    paintEnds();
    paintWhen();
    paintQuotes();
    paintJob();

    bodyWrap.replaceChildren(
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        `Prices for this delivery come from ${courier.label}'s own account. Taking a price fills the charge box, where you still choose who paid the courier — booking the trip is a separate press, and it is the Save button that writes the charge.`),
      jobBox,
      endsLine,
      offerBox,
      endsRow,
      el("div", { class: "field", style: "margin-top:12px" },
        el("label", {}, "The day the driver collects"), dayInput),
      el("div", { class: "field" }, el("label", {}, "The time the driver collects"), timeInput),
      whenNote,
      askRow,
      statusLine,
      quoteBox,
      el("p", { class: "card-sub", style: "margin:14px 0 0" },
        `Booking books the trip this price was quoted at, so the vehicle and the hour that arrive are the ones priced here — moving the time box after a price does not move a booking. The customer's tracking box takes the trip's share link, which is what the card and the shipped message send them to, and the customer's card also carries the trip's own progress, the driver's name, the plate and a button to ring them. ${courier.label} hands the driver over only shortly before the pickup, so a check made before then comes back with the trip and no driver at all — there is no driver line until there is one to have.`));

    ask();
  }

  return wrap;
}
