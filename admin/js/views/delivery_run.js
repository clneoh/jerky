// views/delivery_run.js — the delivery run: one trip, several doorsteps (v191,
// 25 Sep 2026).
//
// THE MONEY. A courier charges one base fare plus a fee for each extra stop, so eight
// cakes to eight houses on one motorcycle is one fare plus seven stop fees against eight
// separate fares. That is the whole reason this screen exists, and it is why the saving
// is worked out here and SHOWN — a claim in a sentence is not a number she can check.
//
// Six things this screen is careful about, each of them a way of being confidently wrong
// that would cost her money, a customer's patience, or both:
//
//   • ONE STOP PER CUSTOMER. The trip is built from one row per GROUP, never from the
//     order lines. A customer who bought three things is one doorstep, and a trip built
//     from lines sends the same van to the same door three times and is charged three
//     stop fees for it.
//
//   • THE PRICE MUST BELONG TO THE LIST ON SCREEN. Ticking or unticking a customer after
//     a price was asked leaves that price describing a journey she is no longer taking, so
//     the Book press goes inert and says so rather than booking the list it remembers.
//
//   • IT DOES NOT SAY WHAT FITS. No price reply carries a capacity figure — a vehicle is
//     priced, not measured — so the load is counted and shown beside the vehicle, and the
//     judgement is hers. Her choice, in her words: "show me the load and let me judge".
//
//   • IT DOES NOT CHOOSE THE STOP ORDER. The courier's own documents disagree about
//     whether route optimisation is available, so the order stays hers to arrange and
//     nothing here may claim to have found her an optimum.
//
//   • THE COMPARISON IS ASKED FOR, AND IT IS ALSO WHAT EACH CUSTOMER PAYS. Pricing the run
//     on every vehicle is one set of requests; pricing the same stops separately is another
//     request per stop, and the courier allows two requests a second. Those separate prices
//     ARE the original costs the customers are charged, so they are never taken quietly: the
//     press that shows the saving asks for them early, and if she has not pressed it they are
//     asked when she books, with the waiting said on screen.
//
//   • THE SAVING STAYS WITH HER. A customer who bears the charge is charged what their own
//     doorstep would have cost sent on its own — the ORIGINAL, un-consolidated price — and
//     never a share of the one-trip fee. Her rule, in her words: "the benefit of consolidated
//     charges, should go to merchant, not the customer. And if the courier charges were
//     reveal to them, it will shown as the original cost." So the difference between what the
//     customers pay and what the trip costs is hers. The fee is apportioned across the orders
//     only when SHE bears it — see splitEven and runChargeAmounts — because then the customer
//     is charged nothing at all and the number is about her books, not about them.
//
// WHY IT IS A PAGE AND NOT A CARD. It holds a day's customers, a vehicle per row, a
// window and a set of charge questions. The app has one pop-up layer, so a card is one
// screen at a time; this needs to be read all at once, against the numbers it changes.
//
// WHAT THIS FILE MUST NOT KNOW: which courier it is talking to. It asks the registry for
// the active one and uses that courier's own words. No courier's name, service keys or
// error codes appear below.

import { button, confirmDialog, el, emptyState, guarded, saidOf, select, toast } from "../ui.js";
import { shortDate } from "../dates.js";
import { byId, groupOrders, save } from "../state.js";
import { maybePublishTracking, maybeSync } from "../supabase.js";
import { runChargeAmounts, splitEven, writeCourierCharge } from "../courier.js";
import { activeCourier, courierByKey } from "../couriers.js";
import { geocodeAddress } from "../couriers/api.js";
import {
  customerPlaceOf, doorIsTheirs, doorRoadOf, doorSpotOf, doorSwitchOf, dropAddress, dropPlaceOf,
  fmtPlace, houseNotIn, pickupPlace, roadNotHouse, setDropPlace,
} from "../courier_place.js";
import { openPlacePicker } from "../place_map.js";
import { pointById, pointPlace, pointWindowText } from "../points.js";
import { openPointPinPicker } from "./points.js";
import { courierPayQuestions } from "./orders.js";
// The price section, for the unfolded order (v342). This screen prices the whole RUN its own way; this
// is for asking what ONE already-booked order would cost. No cycle: courier_quote.js does not read this file.
import { courierQuoteSection } from "./courier_quote.js";
// A parcel recorded on the order (v226) is never swept into a van run — see runDays.
import { parcelOf } from "../parcel.js";
import {
  courierDayOf, pickupTimeOf, runDayOf,
  fmtDistanceKm, fmtQuote, fmtQuoteLeft, liveJobOf, liveJobProblem, loadOf,
  needsVan, quoteExpired, runLimitProblem, savingOf, scheduleAtUTC, stampTrip, stopKeyOf,
  tripCalledOff, tripOf, tripProblem,
} from "../courier_job.js";
import { fmtWindow, windowAt, windowProblem } from "../time_window.js";

// One separate-trip price is one request, and the courier allows two requests a second.
// Firing eight of them together would be refused as a burst — which would read to her as
// "that vehicle cannot be priced" when the truth is that we asked too fast. A gap is
// cheaper than a wrong answer. The same 600ms the function itself leaves between the
// quotations inside one call.
const SEPARATE_GAP_MS = 600;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Money read back off a sum of quotations, so a tenth of a sen from floating point cannot
// turn "exactly what the trip costs you" into "one sen short of it".
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function renderDeliveryRun(root, state, params) {
  const courier = activeCourier();
  if (!courier) {
    root.replaceChildren(emptyState("No courier is set up",
      "This build has nobody to carry a parcel, so there is no run to book."));
    return;
  }

  const days = runDays(state);
  if (!days.length) {
    root.replaceChildren(
      el("div", { class: "card" },
        el("h2", {}, "Delivery run"),
        emptyState("Nothing to run yet",
          "A run carries several orders on one trip. It needs an order going out by courier, or one being collected at a Self collection Point, on a delivery date. A collection from your own kitchen is handed over by you, so it never needs a van.")));
    return;
  }

  // The day asked for by whoever sent her here — the button on a delivery day card names
  // the day it was pressed on — falling back to the day she most likely wants.
  const asked = String((params && params.get && params.get("date")) || "").trim();
  // ⚠️ A DAY HERE IS A DATE (v343), and whoever sent her here may name it either way: the Delivery dates
  // screen hands over a delivery-date ID, and an older bookmark may carry one too. Both are accepted and
  // resolved to the day the run is on — one lookup, and neither route can silently open the wrong day.
  const askedRec = byId(state.deliveryDates, asked);
  const askedDay = askedRec ? String(askedRec.date || "").trim() : asked;
  const wantDay = days.some((d) => d.id === askedDay) ? askedDay : String((state.settings && state.settings.runDay) || "");
  let dayId = days.some((d) => d.id === wantDay) ? wantDay : defaultDay(days);

  // Ticked customers, by group key, and what the price on screen was actually asked for.
  // Both belong to the day on screen: a price for yesterday's stops is a price for a
  // journey she is not taking, so changing the day throws it away rather than leaving it
  // under her thumb with a new list beside it.
  let ticked = new Set();
  let priced = null;    // { trip, quotes, failed, codes, stops }
  let compare = {};     // vehicle key -> { state, amounts, reason, done, total }
  let busy = false;
  const clocks = [];
  // ★★ WHOSE ORDER IS UNFOLDED (v342). Her ask: *"clicking a button inside the red ribbon, drop down its
  // full detail, as what is shown in edit order, get a delivery price."* It holds the STOP's row key, so
  // the detail reopens on the row she opened and nowhere else — and it lives HERE, beside the ticked set
  // and the price, because a repaint of this screen only redraws the list: state kept in the DOM would be
  // gone the moment another customer is ticked. `refreshDay` clears it with the other two, because a
  // different day is a different list.
  let unfolded = null;

  // ── the controls, built once ───────────────────────────────────────────
  //
  // Built once and never rebuilt, so a window she has half typed, a collection time she
  // has moved and an answer she has given among the charge questions all survive a price,
  // a booking or a repaint. Only the two boxes below them — the customer list and the
  // prices — are ever redrawn.

  // The day's own label counts STOPS, not people and not order lines — the same count the
  // list below draws and the same one the Delivery dates screen's "Run (N)" badge shows, so
  // the day she picks is described with the number she is about to see. It read "2 courier
  // orders" over a day carrying nothing but collections at a Point (v302).
  const stopCount = (groups) => new Set(groups.map((g) => stopKeyOf(state, g))).size;
  const daySel = select(
    days.map((d) => ({
      value: d.id,
      label: `${shortDate(d.date)} — ${stopCount(d.groups)} stop${stopCount(d.groups) === 1 ? "" : "s"}`,
    })),
    dayId,
    () => { dayId = daySel.value; refreshDay(); },
  );

  const pickupDay = el("input", { class: "input", type: "date", "aria-label": "The day the driver collects" });
  const pickupTime = el("input", { class: "input", type: "time", value: dispatchTime(state),
    "aria-label": "The time the driver collects" });

  const winFrom = el("input", { class: "input", type: "time", "aria-label": "The delivery window opens" });
  const winTo = el("input", { class: "input", type: "time", "aria-label": "The delivery window closes" });
  const winSaid = el("p", { class: "card-sub", style: "margin:6px 0 0" });

  const listBox = el("div", {});
  const loadLine = el("p", { class: "run-load" });
  const priceBox = el("div", {});
  const statusLine = el("p", { class: "card-sub", style: "margin:10px 0 0" });
  const askBtn = button(`Price this run with ${courier.label}`, () => ask(), "primary");

  // The charge questions, asked of the first ticked customer so the form opens on what
  // that order already says. The AMOUNT is not asked here: on a run it is worked out, not
  // typed — each customer's own doorstep cost when they bear it, the run's fee apportioned
  // when she does (runChargeAmounts). This is the same block the order card and the full
  // Edit form use, so a charge means the same thing wherever it is written — and its own
  // comment forbids a second copy in the app. It is answered ONCE for the whole run, which
  // is why changing it has to redraw the prices: the line under each vehicle says what each
  // customer's box will hold, and that depends on this answer.
  let pay = null;
  const payBox = el("div", {});

  // ── what the day holds ────────────────────────────────────────────────

  function dayRowNow() {
    return days.find((d) => d.id === dayId) || days[0];
  }

  // ★ A ROW ON THIS SCREEN IS ONE STOP (v301), and that is the correction this version makes.
  //
  // A customer who ordered three things is one doorstep — that was v191's correction. Now a
  // SELF COLLECTION POINT carrying four customers' orders is ALSO one stop, which is the whole
  // reason Points exist: four bags at Farlim is one place a van goes, not four.
  //
  // Every group that went to the same Point is gathered into one row here, BEFORE anything is
  // ticked, priced or counted, so everything downstream asks the ROWS and cannot disagree with
  // what the trip is actually made of. A group with no Point keeps a row to itself, so a run
  // with no Points on it behaves exactly as it always has.
  function rowsNow() {
    const day = dayRowNow();
    if (!day) return [];
    const byStop = new Map();
    const rows = [];
    for (const g of day.groups) {
      // The key comes from `stopKeyOf` and nowhere else. A ticked set, the price's own
      // identity and the "put this customer on the run" path all name a row by this key, so
      // a second way of spelling it is a row that is on the trip and not on the screen.
      const key = stopKeyOf(state, g);
      let row = byStop.get(key);
      if (!row) {
        row = { key, pointId: key.startsWith("point:") ? key.slice(6) : "", groups: [] };
        byStop.set(key, row);
        rows.push(row);
      }
      row.groups.push(g);
    }
    return rows;
  }

  // The rows she has ticked. The key is the row's, so a Point is ticked as ONE thing.
  function tickedRows() {
    return rowsNow().filter((r) => ticked.has(r.key));
  }

  // The groups behind those rows, for anything that counts people or bread — the load, the
  // per-customer pay, and the message. Flattened rather than changed, so those all keep
  // working exactly as they did.
  function tickedGroups() {
    return tickedRows().flatMap((r) => r.groups);
  }

  // EVERY ORDER on the ticked rows — not one per row — because this is what the DOUBLE-BOOKING
  // guard is asked about (`liveJobProblem`), and a Point is booked if ANY customer in it is
  // already on a van. One order per row would walk straight past a Point whose second customer
  // has a trip running, and put that Point on a second van: the v242 fault, at a place.
  //
  // ⚠️ THE TRIP IS NOT BUILT FROM THIS. It is built one representative per ROW, in `askBody` —
  // the two lists are deliberately different lengths, and confusing them is the fault.
  function tickedOrders() {
    return tickedGroups().flatMap((g) => g.orders).filter(Boolean);
  }

  // A CUSTOMER WHO ALREADY HAS A TRIP RUNNING (v242). They stay on the list — she asked to be
  // able to see which customer it is — but they are never ticked FOR her: the common case is
  // that the whole day goes out in one van, and a booked customer swept in with the rest is a
  // second vehicle at a door a driver is already on the way to.
  //
  // The tick itself stays LIVE. Her instruction, twice over: guide, never a gate. If she ticks a
  // booked customer anyway the app honours it and refuses at the Book press instead, with the
  // reason on screen — which is why the row has to SAY it is booked rather than go inert.
  // A row is "already on a trip" when ANY customer in it is — a Point whose orders include a
  // customer already riding a van is a place a driver is on the way to, and sweeping the rest
  // of that Point onto a second van would be the v242 fault at a place instead of a door.
  const rowIsBooked = (r) => r.groups.some((g) => liveJobOf(g.orders[0]));

  function bookedRows() {
    return rowsNow().filter(rowIsBooked);
  }

  function tickableRows() {
    return rowsNow().filter((r) => !rowIsBooked(r));
  }

  // Asked of the TICKABLE rows only, so the bulk press still flips its label over a booked
  // row even though that row is not its to tick.
  function allTicked() {
    const rs = tickableRows();
    return rs.length > 0 && rs.every((r) => ticked.has(r.key));
  }

  // The identity of the SET that was priced, so a price can be tied to the exact list it
  // was asked for rather than to a count that two different lists can share. The row keys,
  // because a row is what was ticked.
  function codesNow() {
    return tickedRows().map((r) => r.key).sort().join("|");
  }

  function stale() {
    return !!priced && priced.codes !== codesNow();
  }

  function schedule() {
    return scheduleAtUTC(pickupDay.value, String(pickupTime.value || "").trim());
  }

  function windowNow() {
    return windowAt(winFrom.value, winTo.value);
  }

  // ── the ticked list ───────────────────────────────────────────────────

  // The day's customers all on, on the day's first look: the common case is that the whole
  // day goes out in one van, and making her tick eight boxes to say so would be this screen
  // asking her to repeat what she already decided.
  // ★★ THE VAN'S DAY OFF THE ORDER, NEVER THE BAKE DAY (v338).
  //
  // ⚠️⚠️ THIS READ `day.date` — the BAKE day — and that is exactly the fault her customer's confusion
  // came from: baked Wednesday, van Thursday morning, and the box handed her Wednesday to book against.
  // Her own rule forbids working it out for her: *"bake plan is just a plan… it is good not to tie our
  // own hand down."* So it is read from what she already keyed in on the orders on this run, and is
  // EMPTY when none of them carries one — never a day the app chose. (The TIME box beside it keeps its
  // default from Settings, which is a default she set herself.)
  function dayTheVanComes(day) {
    for (const g of (day ? day.groups : [])) {
      for (const o of g.orders) {
        const d = courierDayOf(o);
        if (d) return d;
      }
    }
    return "";
  }

  // ★★ AND THE TIME IT COLLECTS, from the same place (v341). Her distinction, in her words: *"Pickup
  // time is something user should specify"* — so the time she typed on the order WINS, and her own
  // Settings dispatch time is the fallback. That fallback is a default she set herself, and her own
  // note says the pickup box "opens on a hand-typed default and it should stay a hand-typed box"; what
  // neither the box nor this function ever does is work a time out from the bake plan.
  function timeTheVanCollects(day) {
    for (const g of (day ? day.groups : [])) {
      for (const o of g.orders) {
        const t = pickupTimeOf(o);
        if (t) return t;
      }
    }
    return dispatchTime(state);
  }

  function pickTicked() {
    const day = dayRowNow();
    // Every tickable customer on, and a booked one left OFF (v242) — tickableGroups, above.
    ticked = new Set(tickableRows().map((r) => r.key));
    pickupDay.value = dayTheVanComes(day);
    pickupTime.value = timeTheVanCollects(day);
  }

  // A price describes one list and one journey. Anything that changes either throws the
  // price away rather than leaving a stale number standing beside a new question.
  function priceAgain() {
    priced = null;
    compare = {};
  }

  function refreshDay() {
    // A different day is a different list, so the unfolded order folds away with the ticked set and the
    // price (v342) — a detail left open on a row that is no longer on screen is worse than none.
    unfolded = null;
    pickTicked();
    priceAgain();
    paintList();
    paintLoad();
    // The payer is answered before the prices, because the line under each vehicle says
    // what each customer's box will hold and that depends on the payer (chargeLine).
    paintPay();
    paintPrices();
    paintWindow();
  }

  // The head line and the bulk press are built ONCE and kept, because they describe the very
  // same set the ticks do. Ticking one row used to leave the head reading "2 of 2" over a list
  // with one customer on it: the row's own handler repainted the load, the prices and the pay
  // box, and only the bulk press rebuilt the list the head lives in — two controls that look
  // alike behaving differently. Updating the two nodes in place is what lets a single tick
  // correct them WITHOUT rebuilding the rows, which would throw away the row under her finger.
  const headTitle = el("span", { class: "run-head-title" });
  const headBtn = button("Tick them all", () => {
    ticked = allTicked() ? new Set() : new Set(tickableRows().map((r) => r.key));
    compare = {};
    paintList();
    paintLoad();
    paintPay();
    paintPrices();
  }, "ghost small");

  function paintHead() {
    const day = dayRowNow();
    if (!day) return;
    const booked = bookedRows().length;
    // The count keeps its old shape and only gains a note, so a day with nothing booked reads
    // exactly as it always did. The booked ones are named because the denominator counts them:
    // a list whose head said "2 of 3" over three visible rows would be the app losing a customer.
    headTitle.textContent = `Who is on the run — ${ticked.size} of ${rowsNow().length}`
      + (booked ? ` · ${booked} already booked` : "");
    headBtn.textContent = allTicked() ? "Untick them all" : "Tick them all";
    // A press that would change nothing is inert rather than silently doing nothing: on a day
    // where every order is booked there is nothing for it to tick, and a live-looking button
    // that answers no tap is the shape of fault she has reported before.
    headBtn.disabled = !allTicked() && ticked.size === tickableRows().length;
  }

  function paintList() {
    const day = dayRowNow();
    if (!day) { listBox.replaceChildren(); return; }
    // flatMap, NOT map: each row hands back `[row, ...tail]` — the row itself plus any blocks
    // that belong under it — and a plain map would leave those as nested arrays, which the DOM
    // then converts with String() into the words "[object HTMLElement]".
    const rows = rowsNow().flatMap((r) => {
      // ★ A POINT ROW IS A PLACE, NOT A PERSON (v301). Its door is the Point's own pin, the
      // name on the row is the Point's, and the customer's own name and delivery address have
      // nothing to do with it — the bread is going to Farlim, and the customer is meeting it
      // there. The row also has to say HOW MANY orders it is carrying, because that count is
      // the whole reason it is one row instead of four.
      const isPoint = !!r.pointId;
      const point = isPoint ? pointById(state, r.pointId) : null;
      const first = r.groups[0].orders[0];
      const key = r.key;
      // THE DOOR — the point this run is priced at and a driver is sent to. v209: where the
      // customer dropped a pin of their own, that pin is the door, even if a door of hers
      // still exists for them; only a door she placed with her own hand outranks it. A Point
      // has no customer pin to weigh: its own pin IS the door.
      const place = isPoint ? pointPlace(point) : doorSpotOf(state, first);
      const tick = el("input", { type: "checkbox", class: "run-tick",
        "aria-label": isPoint
          ? `Send the orders collecting at ${rowName(state, r)} on this run`
          : `Send ${nameOf(first)} on this run` });
      tick.checked = ticked.has(key);
      tick.addEventListener("change", () => {
        if (tick.checked) ticked.add(key); else ticked.delete(key);
        // The prices stay on screen — re-asking is a request per vehicle and she has not
        // asked for that — but they are marked as belonging to a list she has moved, and
        // the Book presses go inert below.
        compare = {};
        paintHead();
        paintLoad();
        paintPay();
        paintPrices();
      });
      const what = r.groups.flatMap((g) => g.orders)
        .map((o) => `${String(o.productName || "item").trim()} ×${Number(o.qty) || 0}`).join("  ·  ");
      // AND A DOOR THAT IS ONLY THE ROAD SAYS SO ON ITS OWN ROW TOO (v211), in the SHORT form:
      // the row already leads with the address on the order, house number and all, so the tag
      // is all it needs — and this is the screen where a run of several doorsteps is read at
      // once, which is exactly where a street wearing a house's name would be missed. Only her
      // own door can carry the stamp (a lookup is what writes one), so where the customer's own
      // pin is the door there is nothing to warn about and nothing is said.
      const road = (!isPoint && !doorIsTheirs(state, first)) ? doorRoadOf(state, first) : "";
      const where = place
        ? fmtPlace(place) + (road ? ` — ${roadNotHouse(road, { short: true })}` : "")
        : (isPoint
          ? (String((point && point.address) || "").trim()
            ? `${String(point.address).trim()} — Point not pinned`
            : "this Point is not pinned yet")
          : dropAddress(first)
            ? `${dropAddress(first)} — doorstep not pinned`
            : "no delivery address on this order yet");
      // HOW MANY ORDERS THIS STOP IS CARRYING. On a Point row it leads, because "4 orders" is
      // what makes it one stop; on a customer's row it has always been the bread itself.
      const carried = isPoint
        ? `${r.groups.length} order${r.groups.length === 1 ? "" : "s"} collecting here`
        : "";
      // ★ WHEN THEY CAN COLLECT, on the row (v305). Her ask, and it is the one number this screen
      // was missing: the hours she set on the Point (v304) decide when the bread has to be THERE
      // and handed over, so a trip booked for the wrong part of the day is visible here rather
      // than a day later. Silent when she has not set any — the card already says so, and a row
      // that repeats "no hours" on every run is noise on the screen she reads while working.
      const hours = isPoint ? pointWindowText(point) : "";
      const row = el("div", { class: `run-row${isPoint ? " run-row-point" : ""}` },
        el("label", { class: "run-who" },
          tick,
          el("span", { class: "run-words" },
            el("span", { class: "run-name" }, isPoint ? rowName(state, r) : nameOf(first)),
            el("span", { class: "run-sub" }, [carried, where, hours ? `collect ${hours}` : "", what].filter(Boolean).join(" · ")))),
        // A Point is pinned on its own card, where the pin belongs to the PLACE — not from
        // here, where the press would look like it pinned this run's version of it.
        isPoint
          ? (place ? null : button("Pin the Point", () => openPointPinPicker(state, point, () => { paintList(); paintLoad(); }), "ghost small"))
          : (place ? null : button("Put it on the map", () => pinDoorstep(first), "ghost small")));
      // ALREADY ON A TRIP (v242). Her report: a customer whose courier booking is already made
      // must never be swept onto a second van. The block sits OUTSIDE the row's <label> for the
      // same reason the door offer below does — a press in there would tick the customer rather
      // than call the trip off. The tick itself stays LIVE (her instruction, twice over: guide,
      // never a gate) and the words carry the warning instead, with the one press that turns
      // this row back into an ordinary one.
      const bookedGroup = r.groups.find((g) => liveJobOf(g.orders[0]));
      const job = bookedGroup ? liveJobOf(bookedGroup.orders[0]) : null;
      const holder = job ? (courierByKey(job.provider) || courier) : null;
      const offBtn = job
        ? button("Call off the trip and add to this run", () => callOffTrip(bookedGroup, job, holder), "ghost small")
        : null;
      // Greyed while a courier call of any kind is in flight, so the press cannot be taken twice.
      if (offBtn) offBtn.disabled = Boolean(busy);
      // ★★ AND A WAY TO LOOK AT THE ORDER ITSELF (v342). Her ask: on the Delivery run, the row whose
      // courier trip is ALREADY ACTIVE should offer a button — inside this very block — that drops its
      // full detail down, as the Edit card shows it, with a delivery price.
      //
      // ⚠️ Her words name the courier company, and this file may not: `test/delivery-run.test.js` scans
      // it for the brand (case-insensitively, comments included) because this screen must keep asking
      // the registry what to call whoever is on the road. Paraphrase, never quote, in this file.
      //
      // ⚠️ THE WORDING IS DELIBERATELY UNLIKE the call-off button's: this file's tests press that one by
      // its exact text, and two buttons whose words run together are the fault the app's own affordance
      // rule names.
      const open = unfolded === r.key;
      const seeBtn = job
        ? button(open ? "Hide the trip" : "See the trip", () => {
          unfolded = open ? null : r.key;
          paintList();
        }, "ghost small")
        : null;
      const booked = job
        ? el("div", { class: "pin-offer run-booked" },
            el("p", { class: "card-sub" }, bookedSaid(job, holder)),
            el("div", { class: "btn-row" }, offBtn, seeBtn))
        : null;
      // The order itself, folded out under this row (v342) — a SIBLING of the row and never inside its
      // <label>, for the same reason the block above is: everything in that label is a tick, so a press
      // in there would tick the customer instead of doing what it says. Built fresh on every repaint
      // from `unfolded`, so it is exactly as open, or as shut, as she left it.
      const detail = job && open ? unfoldedTrip(state, bookedGroup) : null;
      // The two doors on this order, when they disagree, offered under its own row — one
      // line and one press. It is a block of its own rather than a line inside the row
      // because everything in that row sits inside one <label>: a press in there would tick
      // the customer instead of pinning their door. Offered every time the two differ, which
      // is what makes taking one the thing that ends it.
      //
      // ONE CONTROL, TWO DIRECTIONS (v209): with the customer's own pin normally the door in
      // force, the press on offer can as easily be the door SHE keeps. `which` says which.
      // A POINT HAS NO CUSTOMER PIN TO WEIGH — the question this block asks is "whose door is
      // in force, the one you keep or the one they dropped", and at a Point neither exists.
      const offer = isPoint ? null : doorSwitchOf(state, first);
      // `which: "customer"` means HER door is the one in force and the pin they dropped is the
      // alternative, so the words and the press both split on this one flag and nothing else.
      const theirs = Boolean(offer && offer.which === "customer");
      const tail = [];
      if (booked) tail.push(booked);
      if (detail) tail.push(detail);
      if (offer) tail.push(el("div", { class: "pin-offer" },
            el("p", { class: "card-sub" },
              theirs
                ? `${nameOf(first)} pinned a different spot this time. Taking it replaces the doorstep you keep for them.`
                : `${nameOf(first)}'s own pin is in use. The doorstep you keep for them is a different spot.`),
            el("div", { class: "btn-row" },
              button(theirs
                ? "Use the customer's pin instead"
                : "Use the door I keep instead",
                // The road caveat travels with the door it is about (v211): putting her kept
                // door back over a customer's pin does not make that point a house, and a
                // warning dropped by the very press that asserts the door would be missing
                // exactly where it is still needed. The other direction offers THEIR pin,
                // which no lookup wrote, so there is nothing to carry.
                () => keepPin(first, offer.place, theirs, theirs ? "" : doorRoadOf(state, first)),
                "ghost small"))));
      return [row, ...tail];
    });

    listBox.replaceChildren(
      el("div", { class: "run-head" }, headTitle, headBtn),
      ...rows.filter(Boolean),
    );
    paintHead();
  }

  // WHY THIS ROW IS NOT TICKED, in words (v242). The courier is named, and so is its own word
  // for where the trip has got to — resolved through the REGISTRY rather than by name, because
  // this file is not allowed to know whose trip it is (see the header). The consequence is the
  // sentence `liveJobProblem` already puts on the Book press, word for word, so the app says ONE
  // thing about double-booking wherever she happens to meet it.
  //
  // Built as a list and joined, so a trip whose status has not been read back yet stops at the
  // courier's name rather than printing a dangling dash or the word null.
  function bookedSaid(job, holder) {
    const said = String(holder && holder.statusLabel ? holder.statusLabel(job.status) : "").trim();
    const held = [holder ? holder.label : "", said].filter(Boolean).join(" — ");
    return `Already booked with ${held}. Ticking it and booking the run would send a second vehicle to the same door.`;
  }

  // ── calling a booked trip off, so that customer can join the run instead ──
  //
  // HER WORDS, AND BOTH HALVES OF THEM: a booked customer is not greyed out, and the row offers
  // to call the original booking off so it can be consolidated with the others. The press does
  // both, behind one confirm, because consolidating is the purpose she named — and the
  // cancellation is the irreversible half, so it is asked about in the open and never taken on
  // the way past. Nothing about this is a gate: the tick above stays live, and this is the press
  // that turns the row back into an ordinary one.
  function callOffTrip(g, job, holder) {
    if (busy || !root.isConnected) return;
    const first = g.orders[0];
    const h = holder || courierByKey(job.provider) || courier;
    confirmDialog(
      `Call off this ${h.label} trip and put ${nameOf(first)} on this run instead? ` +
      `The driver stops being sent, and the customer's tracking box keeps the link but nothing will update it. ` +
      `This cannot be undone from here — you would have to book again, at a fresh price.`,
      async () => {
        if (busy || !root.isConnected) return;
        // Wrapped on the same guard as every other press that spends money (v217): `busy` is what
        // a throw used to leave set, and a cancellation that throws on the way back cannot say
        // which side of it we are on — so the trouble sentence says to look, not to press again.
        await guarded({
          hold: (v) => { busy = v; },
          work: () => callOffNow(g, job, h),
          said: (s) => { statusLine.textContent = s; paintList(); paintPrices(); },
          trouble: `The trip may not have been called off — check it in ${h.label} before pressing again`,
        });
      },
      { danger: true, yesLabel: "Call it off and add to the run" },
    );
  }

  async function callOffNow(g, job, holder) {
    busy = true;
    paintList();
    const out = await holder.cancel(state, job.jobId);
    if (!root.isConnected) return;
    busy = false;
    if (!out.ok) {
      // An ordinary answer rather than a fault: the courier decides how long a trip may still be
      // called off, and it says so in its own words. Nothing is written and nothing is ticked.
      toast(out.reason);
      paintList();
      return;
    }
    // The called-off record goes on every LINE of the group, exactly as a booking does, so a
    // customer's order edited and re-split later does not keep a trip that is no longer running.
    // Then the customer joins the run, which is the whole point of the press.
    stampTrip(g.orders, tripCalledOff(job), holder.label);
    // The same key a row is built with, so a customer collecting at a Point really does join
    // the run rather than being ticked under a name no row answers to.
    ticked.add(stopKeyOf(state, g));
    // The standing price describes a list that has just changed, so it is thrown away rather
    // than left standing beside a run it no longer prices.
    priceAgain();
    save(state);
    maybeSync(state);
    paintList();
    paintLoad();
    paintPay();
    paintPrices();
    toast(`${nameOf(g.orders[0])} is off the ${holder.label} trip and on this run — ask for a price when you are ready.`);
  }

  // Keep a doorstep against a customer. THE one path, whether the pin was dragged on
  // the map, taken from what the customer pinned themselves, or put back over their pin —
  // so a pin she accepted and a pin she placed by hand are the same record, saved and
  // synced the same way.
  //
  // `fromCustomer` tags WHICH of those it was, and it is not decoration (v209): it decides
  // whether the customer's own pin may override this door later. A door taken up from their
  // pin stays theirs, so a customer who re-pins still wins; her own door is recorded as her
  // own hand, so it sticks. `pinDoorstep` omits it, which is the "hand" default.
  //
  // `road` is the house number a lookup could not find (v211, see courier_place.js doorRoadOf).
  // It is passed ONLY by the press that puts her kept door back over a customer's pin — the
  // same point that was looked up, so the caveat still holds — and NOT by `pinDoorstep`, whose
  // point is a new one she has just chosen and which therefore carries no old stamp at all.
  function keepPin(order, place, fromCustomer = false, road = "") {
    setDropPlace(state, order, place, fromCustomer ? "customer" : "hand", road);
    save(state);
    maybeSync(state);
    paintList();
  }

  function pinDoorstep(order) {
    openPlacePicker({
      state,
      title: `${nameOf(order)}'s doorstep`,
      // ONE SENTENCE, BECAUSE THERE IS ONLY ONE CASE (v210). This window is reached from one
      // button — "Put it on the map" — and that button is drawn only when the order has NO
      // door at all (`place ? null : …` on the row above, where `place` is doorSpotOf). So the
      // customer's-own-pin wording that used to hang off this hint could never be reached:
      // a customer who pinned has a door, and a door means no button.
      hint: "Look the address up, then drag the pin to the exact door. It is remembered for this customer, so a second order from them costs no lookup at all.",
      address: dropAddress(order),
      start: doorSpotOf(state, order),
      onPick: (spot) => keepPin(order, spot),
    });
  }

  // ── the load, which is shown and never judged ─────────────────────────

  function paintLoad() {
    // ONE SYNTHETIC GROUP PER ROW, carrying every order of every customer in it. `loadOf`
    // counts its stops as the number of things handed to it, so this is what makes "stops"
    // mean STOPS: four orders at one Point are one stop, not four — while the bread is still
    // counted line by line, because the synthetic group holds all of them.
    const rows = tickedRows().map((r) => ({ orders: r.groups.flatMap((g) => g.orders) }));
    const load = loadOf(state, rows);
    if (!rows.length) {
      loadLine.replaceChildren("Nothing is ticked, so there is no load to count.");
      return;
    }
    // A count and the things counted, in the app's own house style (name then qty), so the
    // words beside a price are the order lines she would recognise.
    loadLine.replaceChildren(...[
      `${load.stops} stop${load.stops === 1 ? "" : "s"}`,
      " · ",
      `${load.items} item${load.items === 1 ? "" : "s"}`,
      load.summary ? " · " : "",
      load.summary,
      // The trip's documented ceiling is SAID and never enforced: the courier has the last
      // word, and a screen that blocks a booking the courier would have taken is the app
      // inventing a rule. Her standing instruction, and the reason this is here at all.
      runLimitProblem(load.stops) ? el("span", { class: "run-warn" }, ` ${runLimitProblem(load.stops)}`) : null,
    ].filter((x) => x !== "" && x !== null && x !== undefined));
  }

  // ── the window ────────────────────────────────────────────────────────

  function paintWindow() {
    const problem = windowProblem(winFrom.value, winTo.value);
    if (problem) { winSaid.textContent = problem; return; }
    const w = windowNow();
    winSaid.textContent = w
      ? `Customers will be told ${fmtWindow(w)}. It lands on their track card and in their message the moment you book.`
      : "Leave both boxes empty and every customer keeps the promise they already have — the day, with no hour on it.";
  }

  // ── the money ─────────────────────────────────────────────────────────

  // What each order's charge box will hold if she books THIS vehicle, in the payer's own
  // terms. A customer's figure is their own doorstep's cost, which is a request per stop and
  // is therefore asked when she books rather than on the way past — so before the booking
  // this line states the RULE, and the confirmation shows the numbers.
  //
  // The payer decides which of the two it is, so this is redrawn when she changes that
  // answer (see paintPay). Leaving it saying "split evenly" while she had chosen the
  // customer, or quoting a split that is nobody's cost, would be this screen telling her
  // one thing and doing another.
  function chargeLine(q) {
    const groups = tickedGroups();
    if (!groups.length) return "";
    const n = groups.length;
    const cur = state.settings.currency;
    const who = pay ? pay.payer() : "";
    if (who === "customer") {
      return `Each customer is charged what their own doorstep costs on its own, never a share of the one-trip fee — so the saving from going together stays with you. Those ${n === 1 ? "cost comes" : `${n} costs come`} from ${courier.label} when you book, and the confirmation shows ${n === 1 ? "it" : "each of them"} before anything is asked for.`;
    }
    if (who === "me") {
      const shares = splitEven(q.amount, n).map((s) => fmtQuote(s, q.currency, cur));
      return `You are bearing it, so the run's own fee is your cost and the customer is charged none of it: ${fmtQuote(q.amount, q.currency, cur)} over ${n} order${n === 1 ? "" : "s"} — ${shares.join(" · ")}.`;
    }
    return "Choose who paid the courier below, and this line will say what each customer's charge box will hold.";
  }

  // What the confirmation says each order's charge box will hold — the numbers, where the
  // line above states the rule. The customer's figure is their own doorstep's cost, so the
  // total it comes to is read against the trip's own fee: when going together has saved her
  // nothing — a small run on a big vehicle, which really happens — that shows here as the
  // shortfall it is rather than as a saving this screen talked her into.
  function chargeSentence(amounts, q, cur, answers) {
    if (!amounts.length || !answers || !answers.who) {
      return " No charge will be written, because no payer was chosen below.";
    }
    const each = amounts.map((a) => fmtQuote(a, q.currency, cur));
    if (answers.who === "customer") {
      const total = round2(amounts.reduce((a, b) => a + b, 0));
      const diff = round2(total - q.amount);
      const against = diff > 0
        ? `${fmtQuote(total, q.currency, cur)} in all, which is ${fmtQuote(diff, q.currency, cur)} more than the ${fmtQuote(q.amount, q.currency, cur)} the trip costs you — that difference stays with you`
        : diff < 0
          ? `${fmtQuote(total, q.currency, cur)} in all, which is ${fmtQuote(-diff, q.currency, cur)} SHORT of the ${fmtQuote(q.amount, q.currency, cur)} the trip costs you, so this run loses you money`
          : `${fmtQuote(total, q.currency, cur)} in all, which is exactly what the trip costs you`;
      return ` Each customer is charged what their own doorstep costs on its own, never a share of the trip: ${each.join(" · ")} — ${against}.`;
    }
    return ` The run's fee goes on your books as one cost of ${fmtQuote(q.amount, q.currency, cur)}, over ${amounts.length} order${amounts.length === 1 ? "" : "s"} — ${each.join(" · ")} — and the customer is charged none of it.`;
  }

  // ── asking for a price ────────────────────────────────────────────────

  async function ask() {
    if (busy || !root.isConnected) return;
    // ★ ROWS, not customers (v301). A row is one STOP, and the trip is built from stops.
    const rows = tickedRows();
    if (!rows.length) { toast("Tick at least one customer — a run has to carry somebody."); return; }
    const problem = windowProblem(winFrom.value, winTo.value);
    if (problem) { statusLine.textContent = problem; return; }

    // WRAPPED, BECAUSE THE GUARD IS THE BUG (v217). `askBody` clears `busy` and re-arms the
    // button on every way out it knows about — and an exit it did not know about (a throw)
    // left both where they were, so the button stayed grey and every later press was returned
    // at once by `if (busy …) return` with nothing said. `guarded` releases the guard and the
    // button whatever happened, and SAYS the throw. See its note in ui.js.
    await guarded({
      btn: askBtn,
      hold: (v) => { busy = v; },
      work: () => askBody(rows),
      said: (s) => { statusLine.textContent = s; },
      trouble: "The price could not be asked for, and nothing has been priced",
    });
  }

  async function askBody(rows) {
    busy = true;
    askBtn.disabled = true;
    priceAgain();
    paintPrices();

    // 1. YOUR DOOR.
    if (!pickupPlace(state)) {
      busy = false;
      askBtn.disabled = false;
      statusLine.textContent = "Your own pickup spot is not pinned yet — pin it in Settings, and every price from now on is for the right door.";
      return;
    }

    // 2. EVERY CUSTOMER'S DOOR, looked up once and then kept against the person, so a
    //    second run down the same street costs no lookup for anybody on it.
    //
    //    AND A CUSTOMER WHO LEFT A PIN OF THEIR OWN IS NOT LOOKED UP AT ALL (v208) —
    //    their point IS the door, exactly as on the single-order card. Same reason, and
    //    it is the same bug: a lookup moves the dot off their door and onto the street.
    // A POINT HAS NO ADDRESS TO LOOK UP FROM HERE — it is pinned on the Points screen, where
    // the pin belongs to the place. Sweeping it in would look up the Point's address and
    // write the answer as a CUSTOMER's door, which is the v209 fault in a new coat.
    const unplaced = rows.filter((r) => !r.pointId).flatMap((r) => r.groups)
      .filter((g) => !dropPlaceOf(state, g.orders[0]));
    for (let i = 0; i < unplaced.length; i++) {
      const first = unplaced[i].orders[0];
      const words = dropAddress(first);
      const theirs = customerPlaceOf(first);
      // The POINT is theirs where they gave one, and the WORDS are the address on the
      // order (v207) — the door she keeps is named with the address, and never with the
      // geocoder's row, which is a fragment with no house number in it.
      if (theirs) {
        setDropPlace(
          state, first,
          { lat: theirs.lat, lng: theirs.lng, label: words || theirs.label },
          "customer",
        );
        paintList();
        continue;
      }
      if (!words) {
        busy = false;
        askBtn.disabled = false;
        statusLine.textContent = `${nameOf(first)}'s order has no delivery address to look up. Put the pin on the map, or add the address under Edit.`;
        paintList();
        return;
      }
      statusLine.textContent = `Looking up ${words}… (${i + 1} of ${unplaced.length})`;
      const found = await geocodeAddress(state, words);
      if (!root.isConnected) return;
      if (!found.ok) {
        busy = false;
        askBtn.disabled = false;
        statusLine.textContent = `${nameOf(first)}: ${found.reason} Nothing has been priced.`;
        return;
      }
      setDropPlace(state, first, { lat: found.place.lat, lng: found.place.lng, label: words }, "lookup", houseNotIn(words, found.place));
      paintList();
    }

    // 3. THE FLEET, from the courier's own list rather than one written down here. No
    //    vehicle is named in this file, which is what lets a second courier be a new file.
    statusLine.textContent = `Asking ${courier.label} for a price on this run — one request per vehicle, so this takes a few seconds.`;
    const fleet = await courier.vehicles(state);
    if (!root.isConnected) return;
    if (!fleet.ok) {
      busy = false;
      askBtn.disabled = false;
      statusLine.textContent = fleet.reason;
      return;
    }

    // ONE ORDER PER ROW, which is what makes the trip have one stop per POINT: `tripOf`
    // builds a stop from each order it is handed, and a Point's stop is the Point.
    const trip = tripOf(state, rows.map((r) => r.groups[0].orders[0]), { scheduleAt: schedule() });
    const missing = tripProblem(trip);
    if (missing) {
      busy = false;
      askBtn.disabled = false;
      statusLine.textContent = missing;
      return;
    }

    const out = await courier.quote(state, trip, {
      services: fleet.vehicles.map((v) => v.key),
      scheduleAt: trip.scheduleAt,
    });
    if (!root.isConnected) return;
    busy = false;
    askBtn.disabled = false;
    if (!out.ok) {
      statusLine.textContent = out.reason;
      return;
    }
    priced = {
      trip,
      quotes: out.quotes || [],
      failed: out.failed || [],
      codes: codesNow(),
      stops: tickedRows().length,
    };
    paintPay();
    paintPrices();
    statusLine.textContent = priced.quotes.length
      ? `${priced.quotes.length} price${priced.quotes.length === 1 ? "" : "s"} from ${courier.label} for this run as one trip. Each one dies on its own clock.`
      : "No vehicle could be priced for this run.";
  }

  // ── the vehicles ──────────────────────────────────────────────────────

  function paintPrices() {
    clocks.length = 0;
    const quotes = (priced && priced.quotes) || [];
    // One sentence per DISTINCT reason, said once under the rows: every row is priced for
    // the same trip and the same doorsteps, so a reason that applies to one nearly always
    // applies to all of them. Each row writes its own entry and the clock below republishes
    // the whole map, so the last one to run leaves the line complete. See quoteRow.
    const whyRows = new Map();
    const whyNode = el("p", { class: "card-sub", style: "margin:8px 0 0" });
    whyNode.hidden = true;
    const publishWhy = () => {
      const said = [...new Set([...whyRows.values()].filter(Boolean))];
      whyNode.textContent = said.join(" ");
      whyNode.hidden = said.length === 0;
    };
    const rows = quotes.map((q) => quoteRow(q, whyRows));
    // Pushed for the beat AND published here. The rows have all written their entries by the
    // time this line runs — they are built above — so the sentence comes out complete. It
    // has to be drawn NOW and not on the next beat: the reason a press is inert belongs on
    // screen at the same moment as the inert press, and a whole second of a greyed button
    // with nothing beside it is exactly the report this version is answering.
    clocks.push(publishWhy);
    publishWhy();
    const missed = ((priced && priced.failed) || []).map((f) =>
      el("p", { class: "card-sub", style: "margin:6px 0 0" },
        `${String(f.name || f.service || "A vehicle").trim()} could not be priced: ${f.reason}`));
    const blocked = quotes.length ? liveJobProblem(tickedOrders()) : "";
    const moved = quotes.length && stale()
      ? "The list of customers has changed since this price was asked, so it describes a run you are no longer taking. Price the run again for the list above."
      : "";
    // `.filter(Boolean)` and never a bare `?: null`: replaceChildren is a DOM method, so it
    // converts each argument with String(), and a null handed to it becomes a text node
    // reading "null" printed on her screen. v189 learned that the hard way, on this exact
    // panel's predecessor.
    priceBox.replaceChildren(...[
      ...rows,
      ...missed,
      whyNode,
      moved ? el("p", { class: "run-warn", style: "margin:10px 0 0" }, moved) : null,
      blocked ? el("p", { class: "card-sub", style: "margin:8px 0 0" }, blocked) : null,
      runLimitProblem(tickedRows().length)
        ? el("p", { class: "card-sub", style: "margin:8px 0 0" }, runLimitProblem(tickedRows().length))
        : null,
      quotes.length ? el("p", { class: "card-sub", style: "margin:12px 0 0" },
        `Booking books the whole run as ONE ${courier.label} trip: one vehicle, ${tickedRows().length} stop${tickedRows().length === 1 ? "" : "s"}, ` +
        (tickedRows().length === 1
          ? "and the trip's own share link, which goes on that customer's track card and message. "
          : `and the trip's ONE share link is deliberately kept OFF the customers' own track cards and messages — it opens the whole journey, so it would show each of them the other doorsteps (v218). A single-customer run keeps its link, because there is nobody else in it. `) +
        "Booking writes each order's charge into its box — their own doorstep's cost when the customer bears it, your apportioned part of the run's fee when you do — with the payer, the method and the COD answer you set below, and saves it there and then. A real vehicle is on a real road the moment the press returns, so there is nothing to discard by walking away.") : null,
    ].filter(Boolean));
  }

  function quoteRow(q, whyRows) {
    const cur = state.settings.currency;
    const dist = fmtDistanceKm(q.distanceKm);
    const sub = el("span", { class: "quote-sub" });
    const bookBtn = button("Book this run", () => bookRun(q), "soft small");
    const cmpBox = el("div", { class: "run-compare" });
    const cmpBtn = button("Compare with sending them separately", () => compareTrips(q.service), "ghost small");
    // The written-down words of the promise for THIS vehicle, so the number and what each
    // customer will be asked for are read together rather than on two screens.
    const splitLine = el("p", { class: "card-sub", style: "margin:6px 0 0" });
    splitLine.textContent = chargeLine(q);

    const paintCmp = () => {
      const c = compare[q.service];
      if (!c) { cmpBox.replaceChildren(); return; }
      if (c.state === "busy") {
        cmpBox.replaceChildren(el("p", { class: "card-sub" },
          `Asking the courier for a price on each doorstep on its own — ${Number(c.done) || 0} of ${Number(c.total) || 0}, one request at a time…`));
        return;
      }
      if (c.state === "failed") { cmpBox.replaceChildren(el("p", { class: "card-sub" }, c.reason)); return; }
      const s = savingOf(q.amount, c.amounts);
      if (!s) { cmpBox.replaceChildren(); return; }
      // The saving is a number on the screen and not a claim in a sentence. When the run
      // costs MORE — a small run on a big vehicle, which really happens — that is said as
      // plainly as a saving is, because rounding a real loss up to "you saved RM0.00" is
      // this screen talking her into it.
      const line = s.saving > 0
        ? `this one trip saves ${fmtQuote(s.saving, q.currency, cur)} against sending them one at a time`
        : s.saving < 0
          ? `this one trip costs ${fmtQuote(-s.saving, q.currency, cur)} MORE than sending them one at a time`
          : "this one trip costs exactly what sending them one at a time costs";
      cmpBox.replaceChildren(
        el("p", { class: "card-sub" },
          `One trip ${fmtQuote(s.one, q.currency, cur)} · one at a time ${fmtQuote(s.sum, q.currency, cur)} — ${line}.`),
        el("p", { class: "card-sub", style: "margin:4px 0 0" },
          "Each of those was asked now, for the same collection time, so they are this journey split up rather than a guess at it."),
      );
    };

    const row = el("div", { class: "quote-row run-price" },
      el("div", { class: "quote-what" },
        el("span", { class: "quote-name" }, String(q.name || "").trim() || "Vehicle"),
        sub),
      el("span", { class: "quote-price" }, fmtQuote(q.amount, q.currency, cur)),
      el("div", { class: "run-actions" }, bookBtn, cmpBtn),
      cmpBox,
      splitLine);

    const clock = (now) => {
      const left = fmtQuoteLeft(q, now);
      const dead = left === "expired";
      // The short line under the vehicle's name: how far, and how long this price lives.
      sub.textContent = [dist, dead ? "expired — ask again" : `valid for ${left}`].filter(Boolean).join(" · ");
      // WHY this run cannot be booked, asked of the COURIER rather than worked out here
      // (v216). This row kept its own, shorter list — dead, no id, a stop list under two —
      // and the comment that used to stand here claimed each of those "reads as a plain
      // word rather than as a greyed button with nothing said about why", which was not
      // true of the button: it was greyed and it said nothing. A run the adapter would
      // refuse for a reason this list did not know, a reply that came back without the
      // courier's own handle for a doorstep above all, drew an inert press and no words.
      const whyBook = typeof courier.bookProblem === "function" && priced
        ? courier.bookProblem(state, priced.trip, q) : "";
      // The row already says "expired — ask again" and the button already reads "Expired",
      // so the adapter's expiry sentence would only say it a third time. See paintPrices.
      whyRows.set(q, dead ? "" : whyBook);
      const why = liveJobProblem(tickedOrders()) || (stale() ? "moved" : "");
      bookBtn.disabled = dead || !!whyBook || !!why || busy;
      bookBtn.textContent = dead ? "Expired" : "Book this run";
      cmpBtn.disabled = dead || !!whyBook || !!why || busy;
    };
    clock(Date.now());
    paintCmp();
    clocks.push(clock);
    return row;
  }

  // One vehicle, priced on every doorstep on its own — the other half of the comparison, AND
  // the origin of what each customer is charged when they bear it (v192).
  //
  // N requests, spaced, never fired together: the courier allows two a second and a burst is
  // refused, which would read to her as "that vehicle cannot be priced" when the truth is
  // that we asked too fast. Asked only because she pressed — the comparison press, or the
  // Book press, which needs the very same numbers and reuses them when they are already here.
  //
  // Every doorstep or nothing: a sum missing one trip is smaller than the truth, so a saving
  // worked out from it — or a customer's charge — would be this screen making a number up.
  async function priceSeparately(service, onProgress) {
    // ROWS again, and for the same reason: what is priced separately is what the van is
    // sent to, and a Point is one of those.
    const rows = tickedRows();
    const scheduleAt = priced.trip.scheduleAt;
    const amounts = [];
    let reason = "";
    if (onProgress) onProgress(0, rows.length);
    for (let i = 0; i < rows.length; i++) {
      if (i) await wait(SEPARATE_GAP_MS);
      if (!root.isConnected) return { ok: false, reason: "" };
      // ONE ROW PER GROUP again — the same correction as the run's own trip, and the same
      // pinned doors it was priced from.
      const one = tripOf(state, [rows[i].groups[0].orders[0]], { scheduleAt });
      const out = await courier.quote(state, one, { services: [service], scheduleAt });
      if (!root.isConnected) return { ok: false, reason: "" };
      if (!out.ok) { reason = out.reason; break; }
      const hit = (out.quotes || []).find((x) => x.service === service);
      if (!hit) {
        reason = (out.failed || []).map((f) => f.reason).filter(Boolean)[0]
          || "One of these doorsteps could not be priced on its own.";
        break;
      }
      amounts.push(hit.amount);
      if (onProgress) onProgress(amounts.length, rows.length);
    }
    if (reason || amounts.length !== rows.length) {
      return { ok: false, reason: reason || "One of these doorsteps could not be priced on its own." };
    }
    return { ok: true, amounts };
  }

  async function compareTrips(service) {
    if (busy || stale() || !priced || !root.isConnected) return;
    // The comparison holds no press guard — but it does hold a row of its own, and a throw
    // used to leave that row saying "busy" with a count that never moved again: the same
    // dead-control fault as the presses above, said in a different place (v217). So the row
    // is resolved on the way out whatever happened.
    try {
      compare[service] = { state: "busy", done: 0, total: tickedRows().length };
      paintPrices();
      await compareTripsNow(service);
    } catch (err) {
      compare[service] = { state: "failed", reason: `The comparison could not be finished — ${saidOf(err)} Nothing is shown rather than shown short.` };
      paintPrices();
    }
  }

  async function compareTripsNow(service) {
    const out = await priceSeparately(service, (done, total) => {
      compare[service] = { state: "busy", done, total };
      paintPrices();
    });
    if (!root.isConnected) return;
    // Not a comparison at all unless EVERY doorstep was priced: a sum missing one trip is
    // smaller than the truth, and a saving worked out from it would be this screen
    // overstating its own case.
    compare[service] = out.ok
      ? { state: "done", amounts: out.amounts }
      : { state: "failed", reason: `${out.reason} The comparison needs every doorstep priced, so it is not shown at all rather than shown short.` };
    paintPrices();
  }

  // The customers' own costs, for the charges. This is the same request the comparison makes
  // and the same answer, so one she has already asked for is REUSED rather than asked again
  // and paid for twice — and that is why the two sharing a function matters, not just tidier.
  async function customerCosts(service) {
    const groups = tickedGroups();
    const c = compare[service];
    if (c && c.state === "done" && (c.amounts || []).length === groups.length) {
      return { ok: true, amounts: c.amounts };
    }
    return priceSeparately(service, (done, total) => {
      statusLine.textContent = `Asking ${courier.label} what each doorstep costs on its own — ${done} of ${total}, one request at a time.`;
    });
  }

  // ── booking the run ───────────────────────────────────────────────────

  async function bookRun(q) {
    if (busy || !root.isConnected || !priced || stale()) return;
    const blocked = liveJobProblem(tickedOrders());
    if (blocked) { toast(blocked); return; }

    // WHO BEARS IT is read before the amounts, because it decides WHICH amounts they are:
    // the customers' own doorstep costs when they bear it, the run's fee apportioned when
    // she does. Asked of the box on its own (payer) rather than through read(), which wants
    // an amount this screen has not worked out yet.
    const who = pay ? pay.payer() : "";

    // Their own costs are one request per doorstep, so the booking press is what pays for
    // them and the waiting is said on screen. Nothing is booked, and nobody is given a
    // charge, until every one of them is here.
    let originals = [];
    if (who === "customer") {
      busy = true;
      askBtn.disabled = true;
      paintPrices();
      const costs = await customerCosts(q.service);
      busy = false;
      askBtn.disabled = false;
      if (!root.isConnected) return;
      paintPrices();
      if (stale()) {
        statusLine.textContent = "The list of customers changed while the courier was being asked, so nothing was booked. Price the run again for the list above.";
        return;
      }
      if (!costs.ok) {
        statusLine.textContent = `${costs.reason} Nothing was booked, and no customer was given a charge.`;
        return;
      }
      originals = costs.amounts;
      statusLine.textContent = "";
    }

    const groups = tickedGroups();
    const load = loadOf(state, groups);
    const cur = state.settings.currency;
    const amounts = runChargeAmounts(who, q.amount, originals, groups.length);
    const answers = pay && amounts.length ? pay.read(amounts[0]) : null;
    const w = windowNow();
    const when = w ? ` Customers will be told ${fmtWindow(w)}.` : "";
    const charge = chargeSentence(amounts, q, cur, answers);
    // What the customers are told about their tracking, said BEFORE the money is spent —
    // because on a run it is a promise about privacy, not about convenience (v218).
    const tracking = groups.length > 1
      ? `The courier's own tracking link is deliberately NOT put on the customers' orders: it is one link for the whole trip, so it would show each of them the other doorsteps. They keep your own tracking card instead — how far the delivery has got, the driver's name and plate, and a button to ring him.`
      : `The customer's tracking box takes this trip's share link, which is what their card and message send them to.`;
    confirmDialog(
      `Book the ${String(q.name || "vehicle").trim() || "vehicle"} with ${courier.label} for ${fmtQuote(q.amount, q.currency, cur)}? ` +
      `It carries ONE trip with ${load.stops} doorstep${load.stops === 1 ? "" : "s"} and ${load.items} item${load.items === 1 ? "" : "s"}.${when} ` +
      `${tracking}${charge} ` +
      `This books a real trip and spends real money, and ${courier.label} only lets it be called off while a driver is still being found.`,
      async () => {
        if (busy || !root.isConnected) return;
        // No button of its own — the yes-press belongs to the dialog — but wrapped on the same
        // guard (v217): `busy` is what a throw used to leave set, and this is the press that
        // puts a charge on every customer's order. The sentence does not claim nothing was
        // booked, because a throw on the way back cannot tell her which side of it we are on.
        await guarded({
          hold: (v) => { busy = v; },
          work: () => bookRunNow(q, groups, amounts, w),
          said: (s) => { statusLine.textContent = s; paintPrices(); },
          trouble: `The booking could not be finished — check the run in ${courier.label} before pressing again, in case it went through`,
        });
      },
      { danger: true, yesLabel: "Book this run" },
    );
  }

  async function bookRunNow(q, groups, amounts, w) {
    busy = true;
    paintPrices();
    const holder = courierByKey(courier.key) || courier;
    const out = await holder.book(state, priced.trip, q);
    if (!root.isConnected) return;
    if (!out.ok) {
      busy = false;
      statusLine.textContent = out.reason;
      paintPrices();
      return;
    }
    // EVERYTHING IS WRITTEN AND SAVED NOW, not on a Save press, because a real vehicle
    // is on a real road the moment this returns and it must not be discardable by
    // walking away from the screen.
    //
    // The window goes on every LINE of every group, not only the first: the card and
    // the messages read the group's first line today, but a customer's order can be
    // edited and re-split, and a promise living on one row would go with that row.
    // ★ The day the van comes, as she set it on this screen (v338) — written onto the orders for the
    // same reason the window is: the customer's card and the five messages read the ORDER, so a day
    // chosen here and nowhere else would be gone the moment she left the screen. Only when she has
    // one, so a trip booked without a day leaves every order exactly as it was.
    const bookedDay = String(pickupDay.value || "").trim();
    const bookedTime = String(pickupTime.value || "").trim();
    for (const g of groups) {
      if (w) for (const o of g.orders) o.deliveryWindow = w;
      if (bookedDay) for (const o of g.orders) o.courierDay = bookedDay;
      // …and the time the van collects (v341), for the same reason: it is HER answer, and an order
      // that was told it once should still carry it the next time she opens it.
      if (bookedTime) for (const o of g.orders) o.pickupTime = bookedTime;
      // `alone` only on a run that turned out to carry one doorstep: the courier's link is
      // ONE link for the whole trip, so on any bigger run it is not the customers' to have.
      stampTrip(g.orders, out.job, holder.label, { alone: groups.length === 1 });
    }
    // The charge, per order, through the one writer every door uses. Each order's amount
    // is the one runChargeAmounts chose: the customer's OWN doorstep cost when they bear
    // it, so the saving from going together stays with her, or their apportioned part of
    // the run's fee when she bears it — which sums to exactly what she was charged.
    if (pay) groups.forEach((g, i) => writeCourierCharge(state, g.orders, g, pay.read(amounts[i])));
    busy = false;
    save(state);
    maybeSync(state);
    // Each customer's own card, one at a time, because publishing is per order. The
    // card now carries the window inside its delivery line and the share in its total.
    for (const g of groups) maybePublishTracking(state, g);
    statusLine.textContent = "";
    refreshDay();
    toast(out.job && out.job.link
      ? groups.length > 1
        ? `Run booked with ${holder.label} — ${groups.length} customers now share one trip. The courier's link was kept off their orders, so it cannot show them each other's doors.`
        : `Run booked with ${holder.label} — the customer's card now carries the trip's share link.`
      : `Run booked with ${holder.label} — the courier sent back no share link, so nothing was put on the customers' cards but the trip itself.`);
  }

  // ── the charge questions ──────────────────────────────────────────────

  function paintPay() {
    const first = tickedOrders()[0];
    if (!first) {
      pay = null;
      payBox.replaceChildren(el("p", { class: "card-sub", style: "margin:0" },
        "Tick a customer and the charge questions appear here."));
      return;
    }
    pay = courierPayQuestions(state, first, () => paintPrices());
    payBox.replaceChildren(pay.el);
  }

  // ── the page ──────────────────────────────────────────────────────────

  root.replaceChildren(
    el("div", { class: "card" },
      el("h2", {}, "Delivery run"),
      el("p", { class: "card-sub" },
        `One vehicle, ${courier.label}'s own fare, several stops. A multi-stop trip is charged as one base fare plus a fee for each extra stop, so the run below is priced as one trip — and can be compared against the same stops sent one at a time, which is the money this screen is for. A stop is a customer's door, or a Self collection Point carrying several customers' orders.`),
      el("div", { class: "field", style: "margin-top:12px" },
        // ⚠️ NOT "the delivery date" (v343). This is the day the VAN GOES — the baker's own day when she has
        // typed one on an order, and that order's delivery date when she has not — and it is the one control
        // that decides which day's work she is looking at. Calling it the delivery date is what had a van
        // booked for the morning after the bake sitting under the wrong date.
        el("label", {}, "The day the van runs"), daySel),
      listBox,
      loadLine,
      el("div", { class: "field", style: "margin-top:12px" },
        el("label", {}, "The day the driver collects"), pickupDay),
      el("div", { class: "field" },
        el("label", {}, "The time the driver collects"), pickupTime),
      el("div", { class: "field" },
        el("label", {}, "The delivery window opens"), winFrom),
      el("div", { class: "field" },
        el("label", {}, "The delivery window closes"), winTo),
      winSaid,
      el("div", { class: "btn-row", style: "margin-top:12px" }, askBtn),
      statusLine,
      priceBox,
      el("h3", { style: "margin:18px 0 0" }, "Who pays the courier"),
      el("p", { class: "card-sub" },
        "Asked once for the whole run. If the customer bears it, each of their charge boxes holds what their own doorstep would have cost sent on its own — never a share of the one-trip fee, so the saving from going together stays with you. If you bear it, the run's fee is your own cost on your books and the customer is charged none of it."),
      payBox,
    ),
  );

  winFrom.addEventListener("input", paintWindow);
  winTo.addEventListener("input", paintWindow);
  // Moving the collection day or time is a different journey, so a price taken for the old
  // one is thrown away rather than left standing beside it.
  pickupDay.addEventListener("change", () => { if (priced) { priceAgain(); paintPrices(); } });
  pickupTime.addEventListener("change", () => { if (priced) { priceAgain(); paintPrices(); } });

  refreshDay();

  // A beat rewrites the short lines that changed — the life of a quotation, and whether the
  // Book press is still live — and nothing else. The buttons on these rows are what this
  // screen exists for, and a tap lost to a repaint is a tap she has to make twice. The tick
  // clears itself once the page is gone: an interval left running against a detached node
  // would keep a run's worth of clocks alive for the rest of the session.
  const beat = setInterval(() => {
    if (!root.isConnected) { clearInterval(beat); return; }
    const now = Date.now();
    for (const c of clocks) c(now);
  }, 1000);

  return () => clearInterval(beat);
}

// ★★ THE BOOKED TRIP, UNFOLDED UNDER ITS ROW (v342, corrected v343).
//
// ⚠️⚠️ **HER CORRECTION, paraphrased because this file may not name the courier company:** she asked for
// the courier's own record of the trip — *"the courier booked details like the one we see after pressing
// GET A DELIVERY PRICE"* — showing that the courier **is on this order**, with [Check the trip], the
// trip's status, when it was booked and the customer's link.
//
// **v342 drew a summary of the ORDER instead** — who it is for, the items, the money. That is not what
// she unfolds a booked row to read, and it was the wrong thing twice over: it was a SECOND rendering of
// an order's figures, and it buried the one card she wanted.
//
// **What she wants is already built, by the code that owns it.** `courierQuoteSection` draws the trip's
// own card (`jobBox`) — the vehicle and its price, when it was booked, where it has got to, the
// customer's share link, [Check the trip] and [Cancel trip] — so this unfolds THAT, and there is no
// second copy of anything to keep in step. The price rows are a press away inside it.
//
// ⚠️ **`canBook` IS LEFT AT ITS DEFAULT, and v342's `false` is exactly what hid her card:** the whole
// trip block sits under `canBook ? jobBox : null`. This screen has nothing to fear from booking — a live
// trip makes the section refuse a second one by itself (`liveJobProblem`, v242) — and nothing is asked of
// the courier until she presses, so a repaint never spends a quote.
function unfoldedTrip(state, group) {
  const first = (group && group.orders && group.orders[0]) || null;
  if (!first) return null;
  // The registry's own name for whoever is carrying it, never a name typed here.
  const holder = activeCourier();
  return el("div", { class: "pin-offer run-detail" },
    el("p", { class: "card-sub" },
      `${(holder && holder.label) || "The courier"} is booked on this order.`),
    courierQuoteSection({
      state, orders: [first], onUseFee: null,
      // Nothing here books, so this only ever answers a door the quote itself wrote — saved the moment
      // it is written rather than on a Save press this screen does not have.
      onCommit: (o) => { if (o) { save(state); maybeSync(state); } },
    }));
}

// ── reading the day ─────────────────────────────────────────────────────

// Every saved delivery day that has at least one order needing a van on it, soonest first.
//
// A day with a single order is included on purpose: sending one order by courier is an
// ordinary thing to do, it is priced as an ordinary one-stop trip, and hiding the day would
// leave her no way to book it from here.
//
// ⚠️ `needsVan`, NOT `fulfillment === "courier"` (v302). That test is what made this screen
// say "Nothing to run yet" while a customer's order sat waiting to be collected at Farlim:
// choosing a Self collection Point in the shop leaves `fulfillment` as `"collect"`, so every
// Point order was filtered out HERE, before the row logic below could ever see one. The rule
// lives in courier_job.js because the Delivery dates screen's own "Run (N)" button asks it
// too, and two readings of one rule is exactly how they came apart.
function runDays(state) {
  const byDay = new Map();
  for (const g of groupOrders(state.orders || [])) {
    const first = g.orders[0];
    if (!needsVan(state, first)) continue;
    // A parcel she posts herself (v226) does NOT go on a van run. It goes to the
    // carrier's counter or pickup, so a run that swept it in would be pricing a
    // vehicle for a box that is already on its way — and the customer, who is being
    // told a carrier has it, would then be told a driver is coming. The record lives
    // on the order rather than the day, so the filter belongs here.
    if (parcelOf(first)) continue;
    const day = runDayOf(state, first);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }
  // ⚠️ `id` AND `date` ARE BOTH THE ISO DATE (v343). A van day that is not a delivery date has no delivery-date
  // record to carry an id, and `dayRowNow` matches on `d.id === dayId`, so the day's own date is what the
  // whole screen keys on now. The old entry's `id` was the RECORD's; nothing here needs a record any more.
  return [...byDay.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({ id: date, date, groups: byDay.get(date) }));
}

// The day she most likely wants: the next one that has not gone out yet, else the last day
// there is. Opening on a day already delivered would make the screen look wrong before she
// had done anything at all.
function defaultDay(days) {
  const at = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const ahead = days.find((d) => d.date >= iso);
  return ((ahead || days[days.length - 1] || days[0] || {}).id) || "";
}

// A group's identity for ticking — `stopKeyOf`, in courier_job.js, because the Delivery dates
// screen's "Run (N)" button counts the same stops and must land on the same number. It groups
// on the key `groupOrders` itself groups on, not a second reading of it derived from the order
// code, so two rows can never be ticked as one customer or one customer counted twice.

// WHAT A STOP ROW IS CALLED. A customer's row has always been their name; a Point's row is
// the Point — and it is read from the LIVE Point rather than off the order, because a Point
// she has since renamed should read as it is called now, on the screen she is working on.
function rowName(st, r) {
  const point = r && r.pointId ? pointById(st, r.pointId) : null;
  return point ? point.name : nameOf(r.groups[0].orders[0]);
}

function nameOf(order) {
  return String((order && order.customerName) || "").trim() || "The customer";
}

// The app's own dispatch time, so the collection box opens on the hour she already uses
// rather than on an empty box or on midnight.
function dispatchTime(state) {
  return String((((state || {}).settings || {}).courier || {}).dispatch || "").trim();
}
