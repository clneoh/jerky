// points.js — a Self collection Point: a place a customer can collect from that is NOT
// the bakery (4 Oct 2026).
//
// ★ HER TERM, AND THE TRAP IT AVOIDS. It is a "Self collection Point" and NEVER a "pickup
// point". `settings.pickupPlace` already exists (v188) and is the exact OPPOSITE end of the
// trip — the bakery's OWN door, where a courier collects FROM. A customer's end called
// "pickup" too would be two halves of one journey sharing a name. She called this out
// herself: "we should call that Self collection Point, not pickup point which is confusing."
//
// ★ THE KITCHEN IS NOT A POINT. Collecting from the bakery is already `fulfillment:
// "collect"` with no point on the order, and it stays exactly what it is: free, no minimum,
// always offered, needing no record of any kind. THIS MODULE KNOWS NOTHING ABOUT THE
// KITCHEN, and that is the design — the difference between "collect from us" and "collect
// from a Point" falls out of the model rather than needing a special case. Giving the
// kitchen a Point record would be the mistake: it would inherit a fee it must not have, a
// provider who does not exist, and a life it can never end.
//
// ★ SHE OPENS THEM ONE AT A TIME, AND EXPECTS MOST TO END. Her words: "baker will open
// collection point one by one, with a budget to spend, if after a period of time and the
// justification is not there then baker will decide to de-activate that point, and not
// likely will open all point one go." So each Point is INDEPENDENT — nothing here assumes
// the others exist — and Pause is a normal ending, not a failure.
//
// A Point is deliberately a RECORD and not a setting: a list she grows, like the credits
// ledger and the promo codes, so it travels between her phones the same way (see sync.js).
//
// Pure: no DOM, no storage. Runs under Node for tests.

import { newId, round2, waNumber } from "./state.js";
import { phoneDigits } from "./customers.js";
import { fmtPlace, validPlace } from "./courier_place.js";
// The app's ONE window - how a time window is read, packed and said (v304). A LEAF, so this
// module and courier_job.js (which imports THIS one) can both read it without a cycle.
import { fmtWindow, validWindow } from "./time_window.js";

// What a new Point's fee per order starts at. Only a starting point — she sets it per
// Point, and she may multiply it by hand on a big order.
export const DEFAULT_FEE_RM = 0.5;

// The name is capped like her own titles; an address is longer because an address is.
const NAME_MAX = 60;
const ADDRESS_MAX = 200;
const PHONE_MAX = 30;
// ★★ HER OWN DESCRIPTION OF A POINT (v412). Her words: __"make the point description custmable in
// point card"__. ⚠️ A LINE, NOT AN ESSAY: it is read on a phone under the Point's name, and the
// standard sentence it replaces is about eighty characters. Two hundred would wrap to four lines on
// a 320px screen and push the places a customer is choosing between off the fold.
const DESC_MAX = 120;

export function blankPoint() {
  return {
    id: "",
    name: "",
    address: "",
    receiver: "",   // who hands the bags over when the driver arrives
    phone: "",      // and what number he calls if nobody is there
    feeRM: DEFAULT_FEE_RM,
    paused: false,
    createdAt: "",
    // ★ WHEN THEY CAN COLLECT (v304). The place's own hours - "14:00-18:00" - typed once on the
    // Point, and every order that collects there is promised it.
    //
    // ONE packed string, the same shape a delivery window wears and read by the same helpers,
    // because a second way of spelling a window is a second way of getting one wrong. Empty
    // means she has not said, and an empty window promises nothing rather than promising wide.
    collectWindow: "",
    // ★ THE SMALLEST BASKET THIS POINT WILL TAKE (v306), in ringgit — the SAME unit the promo
    // code's own smallest basket uses, so "a basket of RM30" means one thing in this app.
    // ZERO MEANS NO MINIMUM, which is where every Point starts: she chose it that way ("keep it
    // as simple as possible, say no minimum for self collect order"), and a Point she opens
    // without one keeps behaving exactly as it did.
    minOrderRM: 0,
    // ★ WHERE IT IS, AS A POINT ON THE MAP (v300) — the same shape a customer's doorstep
    // wears, because a courier is given "5.41405,100.31408" and never an address. A Point
    // without one is a name she can read and a van cannot be sent to, so the trip builder
    // counts it as unplaced exactly as it counts an unpinned customer.
    place: null,
    // ★★ IS THIS THE KITCHEN? (v406). Her words: __"I want all self collection thru collection point,
    // not from the kitchen"__ and __"at self collection point, add a switch whether that collection is
    // a kitchen. Allow only one collection point as kitchen for the time being. NO pin is needed if it
    // is kitchen"__.
    //
    // ⚠️⚠️ THIS CHANGES WHAT THE KITCHEN IS. Until now the kitchen was **the ABSENCE of a Point** —
    // `setOrderPoint` says so in its own words: *"the absence of a Point IS the kitchen"*, and an order
    // collecting from her answered with both fields empty. ⭐ **She is right that it is a place like any
    // other**, and the model was the only thing that said otherwise: it has a name, an address and hours,
    // and `pointChoices` had to invent a `"My kitchen"` row to make it pickable.
    //
    // ⚠️⚠️ A MARKED KITCHEN IS EXCLUSIVE, and the setter below is the only thing that marks one — so
    // "only one" is a fact about the code rather than a rule three call sites have to remember.
    // ⚠️ NO PIN IS REQUIRED, for the kitchen or for any other Point: `pointProblem` has only ever asked
    // for a NAME, because a pin is what a VAN is given and a customer collecting walks to an address.
    isKitchen: false,
    // ★★ WHAT CUSTOMERS READ UNDER ITS NAME (v412). Her words: __"make the point description
    // custmable in point card"__.
    //
    // ⚠️⚠️ IT IS PUBLIC BY ITS OWN NATURE — that is what it is for — so it needs no switch beside it
    // the way the address does. **An empty one publishes nothing at all**, and the shop falls back to
    // the standard sentence, so a Point she has not written one for reads exactly as it does today.
    description: "",
    // ★★ THE AREA THIS POINT SITS UNDER (v410). ONE id, not an array — a place is one place.
    // "" means no area, which is not "nothing": it is the group the shop draws FIRST, and where a
    // Point lands when its area is deleted, so it is never hidden. See js/pointAreas.js.
    //
    // ⚠️ THERE IS NO `sort` HERE ON PURPOSE. Her order within a group is a field a Point only
    // gains when she DRAGS it (see `normalizePoint`), because a Point she has never dragged must
    // keep the order it arrived in — nothing may move under her on the day this arrives.
    areaId: "",
    // ★★ MAY THIS POINT'S ADDRESS BE PRINTED ON THE SHOP? (v410). Her words: __"in point card, a
    // switch to on/off address to be shown or not"__.
    //
    // ⚠️⚠️ IT GOVERNS THE PUBLIC SHOP PAGE ONLY, AND THAT IS HER ANSWER, ASKED AND GIVEN. The shop
    // has no login and anyone can read it; a WhatsApp confirmation goes to ONE paying customer who
    // has to be told where to walk. So this switch does NOT touch `pointAddressFor`, and the
    // confirmation keeps its "Where:" line whatever this says — a customer who has paid must never
    // be left with no way to find his bread. ⚠️ A test pins that, because suppressing it is the
    // tempting change and it is the one that strands somebody.
    showAddress: false,
    // ★★ THE VAN ROUTES THIS PLACE IS SERVED BY (v419). Her words: __"so point will carry its
    // route info"__ — and, told a Place could be on more than one, __"a point might belong to 2 or
    // more routes"__.
    //
    // ⚠️ AN ARRAY, unlike `areaId` above, and that is her answer rather than an oversight: an area
    // is a geography and *"a place is one place"*, but a Place can genuinely be visited by more
    // than one van. ⚠️ AND THE ORDER MEANS NOTHING here — unlike a product's `categories`, where the
    // tick order decides which heading it is listed under. Nothing reads position; see
    // js/deliveryRoutes.js. An id naming a route that has since been DELETED is dropped on the way
    // OUT (`routesOfPoint`), never here: a Place must lose nothing because a route went.
    routeIds: [],
    // ★★ THE DAYS THIS PLACE IS SERVED (v419). Her words: __"day of the week choices, day of the
    // week can be any day, up to 7 days, configurable"__.
    //
    // ⚠️⚠️ EMPTY MEANS "EVERY BAKE DAY", AND THAT IS THE WHOLE SAFETY OF THIS FIELD. A Place she has
    // not touched keeps behaving exactly as it does today and PUBLISHES NOTHING, so the shop page is
    // byte-for-byte what it was — the same care `description` (v412) and `showAddress` (v410) take.
    // **All seven ticked collapses to the same thing**, here and on the shop alike: "every day" and
    // "no limit" are one answer, not two. See `servedEveryDay` below.
    //
    // ⚠️ JS `getDay()` NUMBERS (0 = Sunday … 6 = Saturday) — the numbering `settings.deliveryDays`
    // and availability.js already use, so a day is spelled one way in this app.
    //
    // ⚠️⚠️ IT RESTRICTS THIS PLACE ONLY AND NEVER GENERATES A DATE. Her standing rule: only
    // Dates on her calendar come from Bake days and from Home.
    days: [],
  };
}

// ⚠️ A DAY IS A JS `getDay()` NUMBER, 0–6, and anything else is DROPPED rather than clamped to a
// day she never chose — the care `validWindow` and `validPlace` take with a window and a pin.
// Deduped and sorted, so one day is spelled one way whichever screen wrote it.
function normalizeDays(v) {
  const seen = [];
  for (const raw of Array.isArray(v) ? v : []) {
    // ⚠️⚠️ `null`, `undefined` AND `""` ARE NOT ZERO, AND THIS TEST HAS TO COME **BEFORE** `Number()`
    // — `Number(null)` and `Number("")` are both 0, so a hole or an empty field in a half-synced array
    // would silently become **SUNDAY**: a day she never chose, on the one field whose empty value
    // means "every day". ⭐ Caught by a test, not by reading. It is the same trap `normalizePoint`
    // documents for `sort` (*"`Number(null)` and `Number('')` are both 0"*), in a place where the
    // wrong answer is a promise to a customer about a day the shop is shut.
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !seen.includes(n)) seen.push(n);
  }
  return seen.sort((a, b) => a - b);
}

// ★★ IS THIS PLACE SERVED ON EVERY DAY? (v419) — **EMPTY AND ALL-SEVEN ARE THE SAME ANSWER**, and
// that is the whole safety of the field: "no days ticked" and "every day ticked" both mean NO
// RESTRICTION, so neither publishes a line and both read "Every day" on the card. She should never
// have to know which of the two the app considers the normal one.
export function servedEveryDay(point) {
  const days = normalizeDays(point && point.days);
  return days.length === 0 || days.length === 7;
}

// The days a Place is served, cleaned — the one reader every screen and the publish go through.
export function pointDays(point) {
  return normalizeDays(point && point.days);
}

// One stored row, cleaned. Anything malformed clamps rather than throwing, so a
// half-synced or hand-edited record can never reach a screen or the shop.
export function normalizePoint(src) {
  const b = blankPoint();
  const s = src && typeof src === "object" ? src : {};
  const txt = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  // ⚠️ An id that is not a string is dropped, the same clamp `areaId` applies on its own line.
  const idList = (v) => {
    const seen = [];
    for (const raw of Array.isArray(v) ? v : []) {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (id && !seen.includes(id)) seen.push(id);
    }
    return seen;
  };
  const fee = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? round2(n) : b.feeRM;
  };
  const out = {
    id: String(s.id || ""),
    name: txt(s.name, NAME_MAX),
    address: txt(s.address, ADDRESS_MAX),
    description: txt(s.description, DESC_MAX),
    receiver: txt(s.receiver, NAME_MAX),
    // Stored the way every other number in this app is stored — the digits — so it can be
    // dialled, linked and compared without a second spelling of the same person. A value
    // that is not number-shaped keeps its plain text rather than being emptied.
    phone: phoneDigits(s.phone) || txt(s.phone, PHONE_MAX),
    feeRM: fee(s.feeRM),
    paused: s.paused === true,
    createdAt: txt(s.createdAt, 40),
    // Half a pair of coordinates is not a place: `validPlace` answers null for anything
    // malformed, so a hand-edited or half-synced row reads as UNPINNED rather than as a
    // point in the sea off Africa.
    place: validPlace(s.place),
    // A window that could not be typed is NOT a window - `validWindow` also refuses one that
    // ends before it starts, so a half-typed promise reads as unset rather than reaching a
    // customer as "collect 5-2 pm".
    collectWindow: validWindow(s.collectWindow) ? String(s.collectWindow) : "",
    // A minimum is money, so it is rounded like every other figure in this app, and anything
    // that is not a positive number is NO minimum rather than a broken one.
    minOrderRM: minMoney(s.minOrderRM),
    // ⚠️ STRICTLY `=== true`, like `paused` above: anything half-synced or hand-edited reads as NOT the
    // kitchen rather than as a second kitchen. ⚠️ And `markKitchen` below is what makes it exclusive, so
    // a stored row that somehow carries two is read as neither being special until she says again.
    isKitchen: s.isKitchen === true,
    // Which area this Point is filed under (v410). An id that is not a string reads as NO area,
    // the same clamp `parentOf` applies on the other side.
    areaId: typeof s.areaId === "string" ? s.areaId : "",
    // ⚠️ STRICTLY `=== true`, like `paused` and `isKitchen`: anything half-synced or hand-edited
    // reads as NOT shown, which is what every Point has always meant — no address has ever been
    // published, so an absent switch must publish exactly what this app published yesterday.
    showAddress: s.showAddress === true,
    // ⚠️ THE ROUTES THIS PLACE IS ON, and THE DAYS IT IS SERVED (v419). Unlike `sort` below, an
    // EMPTY ARRAY IS A REAL ANSWER for both — "on no route", "served every day" — so both belong in
    // the literal above and are never omitted: a screen reads `.length` on them.
    routeIds: idList(s.routeIds),
    days: normalizeDays(s.days),
  };
  // ⚠️⚠️ `sort` IS WRITTEN ONLY WHEN SHE HAS ONE, and it is NOT in the literal above on purpose.
  // ⭐ The rank of an ABSENT sort is "last", so a Point she has never dragged keeps the order it
  // arrived in; `sort: 0` would rank it FIRST and quietly rearrange her list the moment this
  // version opened. ⚠️ The trap is that `Number(null)` and `Number("")` are both 0 — a row with
  // an empty field would look like a deliberate drag to the top. See pointAreas.js `orderedInArea`.
  const sort = Number(s.sort);
  if (Number.isFinite(sort) && s.sort !== null && s.sort !== "") out.sort = sort;
  return out;
}

// ★★ WHAT THE KITCHEN MUST NOT INHERIT (v406).
//
// ⚠️⚠️ THIS FILE'S OWN HEADER ARGUED AGAINST WHAT SHE HAS NOW ASKED FOR, and it was right to:
// *"THE KITCHEN IS NOT A POINT… **a Point that quietly became the kitchen would inherit a fee she does
// not owe and a life she cannot end.**"* A Point carries a **fee** (what she pays whoever receives),
// a **minimum order**, and a **Pause**.
//
// ⭐ Her words: __"I want all self collection thru collection point, not from the kitchen"__ and
// __"at self collection point, add a switch whether that collection is a kitchen"__ — **so the kitchen
// becomes a Point for the customer's sake, so it can be picked like any other place.**
// ⚠️ **What the old note protected must not be lost in that**, so the kitchen is read as FREE, with NO
// MINIMUM and NEVER PAUSED, whatever is stored on the row. It is her own front door: there is nobody to
// pay, nothing to reach before you may come, and it cannot be switched off — **it is the one place that
// must always exist**, because it is where the bread is.
export function kitchenExempt(row) {
  if (!row || row.isKitchen !== true) return row;
  return { ...row, feeRM: 0, minOrderRM: 0, paused: false };
}

// A smallest basket, cleaned: a positive amount of money, or 0 for "no minimum". Kept beside
// the promo code's own `minimumOf`, which answers 0 for "no opinion" in the same way.
function minMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

// Where a Point is, or null while it is still unpinned.
export function pointPlace(point) {
  return validPlace(point && point.place);
}

// Put a Point on the map — the SAME act, and the same map, as placing a customer's door, so
// there is nothing new to learn and one shape to keep. Returns the Point, or null when there
// is no such Point or the spot is not a real pair of coordinates.
export function setPointPlace(state, id, spot) {
  const want = String(id || "");
  const row = (state.points || []).find((p) => p && p.id === want);
  if (!row) return null;
  const p = validPlace(spot);
  if (!p) return null;
  row.place = p;
  return row;
}

// A Point's position as she reads it, or a plain admission that it has none. Says the two
// numbers as well as the label, because a label alone cannot be checked and a wrong pin is
// only ever noticed by looking at the numbers.
export function pointPlaceText(point) {
  const p = pointPlace(point);
  return p ? `${fmtPlace(p)}  ·  ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : "";
}

// ★ WHEN THEY CAN COLLECT HERE (v304): the window she typed once on the Point, as the stored
// value, or "" when she has not said — which promises nothing rather than promising wide.
export function pointWindow(point) {
  const w = String((point && point.collectWindow) || "");
  return validWindow(w) ? w : "";
}

// The same window as she would say it — "2-6 pm" — for the Point's own card.
export function pointWindowText(point) {
  const w = pointWindow(point);
  return w ? fmtWindow(w) : "";
}

// ★ WHAT A COLLECTING CUSTOMER IS PROMISED, and the ONE place that answers it (v304).
//
// ", collect 2-6 pm" when the Point has hours, and "" when it does not. **The van's own arrival
// window is deliberately NOT used as a fallback**: that is when the bread REACHES the Point,
// which is her business, and a customer told it would turn up as the van does. A place either
// has collection hours or it promises only the day.
// ★ THE SMALLEST BASKET THIS POINT WILL TAKE (v306), or 0 for "no minimum". The amount is
// measured against what the CUSTOMER's basket comes to before the order is posted, and it is
// published to the shop so the shop can say so rather than quietly taking an order she did not
// want. It is NOT a rule this app works out — she types it, per Point, and most Points have none.
// ⚠️ And the KITCHEN has no minimum, whatever is stored on the row: "a basket of at least RM30 before you
// may come to my front door" is not a thing she would ever mean. Read through `kitchenExempt`, so the one
// place that decides this is the one place that says what the kitchen is.
export function pointMinOrder(point) {
  const p = kitchenExempt(point);
  return minMoney(p && p.minOrderRM);
}

// Is this basket big enough for this Point? Returns the shortfall in ringgit, 0 when the basket
// already reaches it or when the Point asks for no minimum at all.
//
// ONE ANSWER, asked by the shop's own row so the sentence it prints and the refusal it makes
// cannot disagree — the same shape `shortfallOf` gives a promo code's smallest basket.
export function pointShortfall(point, basketRM) {
  const need = pointMinOrder(point) - (Number(basketRM) || 0);
  return need > 0 ? round2(need) : 0;
}

export function collectionWindowText(state, order) {
  const text = pointWindowText(pointById(state, order && order.pointId));
  return text ? `, collect ${text}` : "";
}

// Every Point she has, cleaned and in the order the card draws them: ACTIVE FIRST, then
// paused ones sunk to the bottom. Within each, oldest first, so a new Point appears where
// she would expect to look for it.
export function pointsOf(state) {
  const list = (state && state.points) || [];
  const rows = (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === "object")
    .map(normalizePoint)
    .filter((p) => p.name);
  rows.sort((a, b) => {
    if (a.paused !== b.paused) return a.paused ? 1 : -1;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  return rows;
}

// The Points the SHOP may offer — the active ones. A paused Point is off the list, and
// that is the whole of what pausing buys her.
// ⚠️⚠️ A PAUSED KITCHEN IS STILL ACTIVE (v406), and that is not a nicety — **it is the one place that
// must always exist, because it is where the bread is.** Pausing a Point means "stop offering this one
// for now", and applied to her own kitchen that would leave a customer with nowhere to collect at all.
// ⚠️ Read through `kitchenExempt`, so "never paused" is a fact about the kitchen rather than a rule each
// reader has to remember.
// ★★ HER ORDER, EVERYWHERE A LIST OF POINTS IS DRAWN (v418). ⚠️⚠️ **IT LIVES HERE RATHER THAN IN
// pointAreas.js BECAUSE THIS IS WHERE IT IS NEEDED AND NOTHING HERE MAY IMPORT THAT FILE** — the
// areas module imports `activePoints` from this one, so a `sort` rule living over there could not be
// read back without a cycle. ⭐ **A rule one module cannot reach is a rule the other will copy.**
//
// ⚠️ A Point she has never dragged has NO `sort` at all and keeps the order it arrived in — how this
// list was drawn before it could be dragged, so **nothing moves under her on the day it arrives.**
// ⭐ The rank of an absent sort is MAX_SAFE_INTEGER rather than 0, because `Number(null)` and
// `Number("")` are BOTH 0 — an empty field would otherwise rank first and jump above one she had
// deliberately dragged to the top. Ties keep their arrival order, because Array.sort is stable.
export function orderedInArea(points) {
  const list = Array.isArray(points) ? points.slice() : [];
  const rank = (p) => (p && Number.isFinite(Number(p.sort)) && p.sort !== null && p.sort !== ""
    ? Number(p.sort) : Number.MAX_SAFE_INTEGER);
  if (!list.some((p) => rank(p) !== Number.MAX_SAFE_INTEGER)) return list;
  return list.sort((a, b) => rank(a) - rank(b));
}

export function activePoints(state) {
  // ⚠️⚠️ AND THIS IS THE LIST EVERY DROP-DOWN OF PLACES READS — the Collect-from picker on an order
  // card above all. ⭐ **A drag she has made with the grip has to be the order she sees in the
  // pickers too**, or the handle is a decoration: her words were __"after i reposition with the
  // handle, the drop drop list have to organise is my preference"__.
  return orderedInArea(pointsOf(state).map(kitchenExempt).filter((p) => !p.paused));
}

export function pointById(state, id) {
  const want = String(id || "");
  if (!want) return null;
  return pointsOf(state).find((p) => p.id === want) || null;
}

// Why a draft cannot be saved, or "" when it is fine. A Point needs a NAME and nothing
// else — the same floor a parcel carrier has. The receiver and their phone are what a
// driver actually needs, so they are asked for loudly, but a Point she has not finished
// filling in is still hers to save: refusing it would be a website rule standing between
// her and her own list.
export function pointProblem(draft, taken = []) {
  const d = draft || {};
  const name = String(d.name || "").trim();
  if (!name) return "A Point needs a name";
  const clash = (taken || []).find((p) => p
    && p.id !== String(d.id || "")
    && String(p.name || "").trim().toLowerCase() === name.toLowerCase());
  if (clash) return `There is already a Point called “${name}”`;
  return "";
}

// A new Point. Returns the created row, or null for a draft that cannot be saved.
export function addPoint(state, draft, now = new Date().toISOString()) {
  if (pointProblem(draft, pointsOf(state))) return null;
  const row = normalizePoint({ ...draft, id: newId("pt"), createdAt: now });
  (state.points ||= []).push(row);
  // ⚠️ IF SHE OPENED THIS ONE AS THE KITCHEN, THE ONE THAT WAS THE KITCHEN STOPS BEING IT — in the same
  // call, so there is no moment where two are. `markKitchen` is the only thing that sets the flag.
  if (row.isKitchen) markKitchen(state, row.id);
  return row;
}

// Edit a Point in place. The ID and the day it was opened never move — an edit is a
// correction, not a new Point.
export function updatePoint(state, id, draft) {
  const want = String(id || "");
  if (!want) return null;
  const rows = (state.points || []);
  const at = rows.findIndex((p) => p && p.id === want);
  if (at < 0) return null;
  const problem = pointProblem({ ...draft, id: want }, pointsOf(state));
  if (problem) return null;
  // ⚠️ THE PIN IS NOT A FIELD OF THE FORM, and an edit must not touch it. Carried across
  // deliberately: the draft the editor hands over has no `place` on it, so without this an
  // edit would silently UNPIN the Point — she corrects a spelling and the van loses its door.
  // The same trap the profile's field lists teach, in a smaller place.
  const kept = normalizePoint(rows[at]);
  // ⚠️⚠️ AND NEITHER ARE HER AREA, HER ORDER, THE ADDRESS SWITCH OR HER OWN DESCRIPTION (v410, v412).
  // Exactly the same trap, and it is silent in a nastier way: the editor DOES carry all of them, so
  // the screen is fine — but every test and every other caller that hands over a draft of just the
  // form's own fields (`{ ...FEE }`) would have its `areaId` reset to "", its `sort` thrown away, its
  // address switch turned OFF and **her own words about the place deleted**, none of which she asked
  // for. Carried when the draft does not mention the key, so a caller that means to set one still can.
  const has = (k) => Object.prototype.hasOwnProperty.call(draft || {}, k);
  const next = normalizePoint({
    ...draft, id: want, createdAt: kept.createdAt, place: kept.place,
    areaId: has("areaId") ? draft.areaId : kept.areaId,
    showAddress: has("showAddress") ? draft.showAddress : kept.showAddress,
    sort: has("sort") ? draft.sort : kept.sort,
    description: has("description") ? draft.description : kept.description,
    // ⚠️⚠️ AND NEITHER ARE HER ROUTES OR THE DAYS THIS PLACE IS SERVED (v419) — the same trap, and it
    // lands the same way: the editor carries both, so the screen is fine, but any other caller
    // handing over `{ ...FEE }` would put the Place on NO route and open it EVERY day of the week.
    routeIds: has("routeIds") ? draft.routeIds : kept.routeIds,
    days: has("days") ? draft.days : kept.days,
  });
  rows[at] = next;
  // ⚠️ SAME RULE AS `addPoint`: marking this one as the kitchen un-marks whichever held it, and
  // ⚠️ SWITCHING IT OFF HERE CLEARS THIS ONE AND LEAVES NO KITCHEN MARKED AT ALL — which is a real state
  // she may want (no Point is the kitchen, so `pointChoices` falls back to "My kitchen"), not an error.
  if (next.isKitchen) markKitchen(state, next.id);
  else if (kept.isKitchen) markKitchen(state, null);
  return next;
}

// Pause a Point, or bring it back. Reversible by design: her expectation is that most
// Points she opens will end this way, and a decision she can undo is a decision she can
// make early.
export function setPointPaused(state, id, paused) {
  const want = String(id || "");
  const row = (state.points || []).find((p) => p && p.id === want);
  if (!row) return null;
  row.paused = paused === true;
  return row;
}

// Take a Point off the list for good.
//
// ⚠️ THIS DOES NOT REWRITE WHERE A PAST ORDER WENT, and it must not. An order carries the
// Point's NAME frozen onto it (see orderPointName), so an order that went to Farlim still
// says Farlim after the Point is deleted — exactly as an order keeps the name and price a
// product was sold at, and stays readable after a promo code is deleted (see
// promo-usage.js, which skips a deleted code rather than resurrecting it).
export function deletePoint(state, id) {
  const want = String(id || "");
  if (!want) return false;
  const before = (state.points || []).length;
  state.points = (state.points || []).filter((p) => !p || p.id !== want);
  return state.points.length < before;
}

// ── What the SHOP is allowed to know (v299) ─────────────────────────────────
//
// ⚠️ THE SHOP IS PUBLIC. It gets the id and the NAME — enough for a customer to choose where
// to collect — and NOTHING ELSE. **The receiver's name, their phone and the fee are hers.**
// Publishing them would put a private person's mobile number on a page anyone can read, and
// the fee is what she pays out, not a price. This is the same rule the promo code's `holder`
// follows (v289): the name of whoever a thing belongs to is never published.
//
// The ADDRESS is not published either, though a customer does need it — because the message
// that tells them where to go is built from HER OWN copy of the Point, not from the shop's.
// The shop only has to say which Places there are; the telling is hers.
//
// ACTIVE Points only, and always sent even when empty: the published payload replaces the
// whole row, so an absent key would leave the shop offering yesterday's Points. Same reason
// the occasions, the categories and the promo codes are sent the same way.
export function publishPoints(state, points) {
  // ⚠️ `min` IS PUBLISHED AND THE RECEIVER'S NAME, PHONE AND FEE ARE NOT (v306). The rule this
  // list has followed since v299 is that nothing PRIVATE leaves her app — a public page has no
  // login, so the person who receives there must never be named on it. A smallest basket is the
  // opposite of private: it is exactly what the customer has to know before they choose, and
  // without it the shop could only take an order the Point does not want. It is sent as a plain
  // number, 0 for "no minimum", so the shop never has to read a missing key as a rule.
  //
  // ★★ AND `isKitchen` IS PUBLISHED NOW TOO (v407), which is a narrower thing than it looks.
  // ⚠️⚠️ IT IS NOT A FACT ABOUT HER, IT IS A FACT ABOUT THE PAGE. Since v406 the kitchen IS a Point
  // she marks, but the shop had no way to know which one — so it went on printing its OWN
  // "Our kitchen" row above the list, and **the moment she marked a kitchen a customer saw her
  // kitchen twice**: once invented, once under the name she gave it, as two different choices that
  // looked like two different places. ⭐ A boolean saying "this is the bakery's own kitchen" is
  // exactly as public as the name it sits beside, and it is the smallest thing that lets the shop
  // stop inventing a row — see store/app.js, where the invented row is now the FALLBACK for the
  // day she has not marked one, which is the job it was always meant to do.
  //
  // ★★ AND THE ADDRESS NOW RIDES WITH IT — BUT ONLY WHEN SHE SAYS SO (v410). Her words: __"in point
  // card, a switch to on/off address to be shown or not"__.
  // ⚠️⚠️ THE STREET ADDRESS IS THE MOST PRIVATE THING ON THIS RECORD, and it has never once left
  // her app. It leaves now, for the Points she ticks and no others, and ⚠️ **only `address` is
  // published — never the receiver's name or their phone**, which is what would put a private
  // person's mobile number on a page anyone can read.
  // ⚠️ WRITTEN ONLY WHEN THE SWITCH IS ON **and** there is something to say: a ticked Point with
  // no address typed publishes byte-for-byte what it published yesterday, so the switch alone can
  // never change a page.
  //
  // ⚠️ THE SECOND ARGUMENT IS THE ORDER, AND IT IS THE SHOP'S (v410). The customer page walks the
  // published list in order and puts an area heading in front of the first Point under it, so the
  // order and the headings have to be ONE decision — taken in pointAreas.js `shopPointOrder`, and
  // handed in here. Left out, the list is `activePoints` as it has always been.
  return (Array.isArray(points) ? points : activePoints(state)).map((p) => {
    const row = { id: p.id, name: p.name, minOrderRM: pointMinOrder(p), isKitchen: p.isKitchen === true };
    const street = String((p && p.address) || "").trim();
    if (p && p.showAddress === true && street) row.address = street;
    // ★★ AND HER OWN DESCRIPTION (v412), on exactly the same spelling: **written only when she has
    // actually written one**, so a Point she has not filled in publishes byte-for-byte the row it
    // published yesterday and the shop falls back to its standard sentence.
    const words = String((p && p.description) || "").trim().slice(0, DESC_MAX);
    if (words) row.description = words;
    // ★★ AND THE DAYS THIS PLACE IS SERVED (v419), on exactly the same spelling as the address and
    // the description: **written only when she has actually restricted them**. A Place served every
    // day — whether she ticked none or all seven — publishes byte-for-byte the row it published
    // yesterday, which is what keeps a page nobody asked about exactly as it was. ⚠️ Routes are
    // NEVER published: a customer has no business knowing her vans.
    if (!servedEveryDay(p)) row.days = pointDays(p);
    return row;
  });
}

// The name to PRINT for an order that went to a Point: the name frozen on the order when
// it was placed, falling back to the live Point while it still exists. Never a bare id —
// an order that says "pt_9f2a" tells the person holding the bags nothing at all.
export function orderPointName(state, order) {
  const frozen = String((order && order.pointName) || "").trim();
  if (frozen) return frozen;
  const live = pointById(state, order && order.pointId);
  return live ? live.name : "";
}

// The choices on a "Collect from" picker: the KITCHEN first — which is not a Point and carries
// the EMPTY id — then her open Points, in her order. The customer's own shop offers the same
// list in the same order (see store/app.js), so the two screens cannot offer different places.
//
// The kitchen's own words are the caller's, because the shop says "Our kitchen" to a customer
// and this side says it to her.
// ★★ MARK ONE POINT AS THE KITCHEN, AND ONLY EVER ONE (v406).
//
// ⚠️⚠️ THE EXCLUSIVITY LIVES HERE AND NOWHERE ELSE. Her words: __"Allow only one collection point as
// kitchen for the time being"__ — and the way to be sure of that is **not** to check a flag in three
// call sites, it is to have one function that is the only thing able to set it. Marking one clears the
// rest in the same breath, so "only one" cannot be forgotten by whoever writes the next screen.
// ⚠️ Passing `null` clears the mark, which is how she un-marks a kitchen without deleting the place.
export function markKitchen(state, id) {
  const want = String(id || "");
  let hit = null;
  for (const p of state.points || []) {
    if (!p) continue;
    p.isKitchen = !!want && p.id === want;
    if (p.isKitchen) hit = p;
  }
  return hit;
}

// The Point she has marked as the kitchen, or null if she has not marked one.
export function kitchenPoint(state) {
  return (state.points || []).find((p) => p && p.isKitchen === true) || null;
}

// ⚠️ `pointChoices` MOVED TO pointAreas.js (v418) — **it is a GROUPED list and the grouping
// lives there**, so its order can follow hers. A copy here could not reach the areas module
// without a cycle. See the note on `activePoints` above for the flat answer.

// ★ WHERE AN ORDER COLLECTS FROM, and the one place that rule is written (v303).
//
// The Point's NAME is FROZEN onto the order the moment the order is given one, so a Point she
// later renames or deletes leaves that order still saying where it went — the same rule that
// keeps a sold price and an old product's name on an order, and the same one v299 wrote for the
// customer's own choice. `orderPointName` reads the frozen name first.
//
// ⚠️ CHOOSING THE KITCHEN CLEARS BOTH FIELDS rather than storing an empty id. An order carrying
// `pointId: ""` would be an order pointing at a Point that exists and has no name, and every
// reader would have to know to treat that as nothing. The absence of a Point IS the kitchen.
export function setOrderPoint(state, order, pointId) {
  if (!order) return "";
  const point = pointById(state, pointId);
  if (point) {
    order.pointId = point.id;
    order.pointName = point.name;
    return point.name;
  }
  delete order.pointId;
  delete order.pointName;
  return "";
}

// How an order reaches the customer, in ONE wording (v299). The confirmation and every later
// message are built by two different builders, and a customer reading "Self collect" in one and
// "Self collect at Farlim, Air Itam" in the next would be right to wonder which is true — so the
// sentence is written once, here, and both read it.
//
// A collection from the KITCHEN says just "Self collect", because that is what it has always
// said and what an order with no point means. Only a Point is named.
export function fulfillmentText(state, order) {
  if (order && order.fulfillment === "courier") return "Post (nationwide)";
  const name = orderPointName(state, order);
  return name ? `Collect (local) at ${name}` : "Collect (local)";
}

// Where to go, for a collection at a Point: the LIVE Point's address, or "" when it has none or
// the Point is gone.
//
// The NAME travels frozen on the order, but an address is OPERATIONAL — it is read off her live
// record each time a message is written, so moving a Point to a new shop tells the next customer
// the new place, and a Point she has deleted simply has none to give. That is the honest split:
// what was promised is frozen, where it is today is not.
export function pointAddressFor(state, order) {
  // A COURIER order has no collection address even if a point id somehow rides on it — a
  // courier's destination is the customer's own door, and the caller should not have to
  // remember that for this function to be right.
  if (!order || order.fulfillment === "courier" || !order.pointId) return "";
  const live = pointById(state, order.pointId);
  return live ? live.address : "";
}

// A number as a driver would dial it. The app stores digits with the country code (see
// phoneDigits), so this is only for reading back — and only ever for reading, never for
// keying or comparing.
//
// A Malaysian mobile is 10 digits locally (012-345 6789) or 11 (011-1234 5678), so the
// grouping follows the length rather than cutting at a fixed place. Anything that is
// neither is left as the digits it is, which is still dialable.
export function pointPhoneText(phone) {
  const d = waNumber(phone);
  if (!d) return "";
  const local = d.startsWith("60") ? `0${d.slice(2)}` : d;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`;
  if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)} ${local.slice(7)}`;
  return local;
}
