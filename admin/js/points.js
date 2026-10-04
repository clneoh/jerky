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
  };
}

// One stored row, cleaned. Anything malformed clamps rather than throwing, so a
// half-synced or hand-edited record can never reach a screen or the shop.
export function normalizePoint(src) {
  const b = blankPoint();
  const s = src && typeof src === "object" ? src : {};
  const txt = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const fee = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? round2(n) : b.feeRM;
  };
  return {
    id: String(s.id || ""),
    name: txt(s.name, NAME_MAX),
    address: txt(s.address, ADDRESS_MAX),
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
  };
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
export function pointMinOrder(point) {
  return minMoney(point && point.minOrderRM);
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
export function activePoints(state) {
  return pointsOf(state).filter((p) => !p.paused);
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
  const next = normalizePoint({ ...draft, id: want, createdAt: kept.createdAt, place: kept.place });
  rows[at] = next;
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
export function publishPoints(state) {
  // ⚠️ `min` IS PUBLISHED AND THE RECEIVER'S NAME, PHONE AND FEE ARE NOT (v306). The rule this
  // list has followed since v299 is that nothing PRIVATE leaves her app — a public page has no
  // login, so the person who receives there must never be named on it. A smallest basket is the
  // opposite of private: it is exactly what the customer has to know before they choose, and
  // without it the shop could only take an order the Point does not want. It is sent as a plain
  // number, 0 for "no minimum", so the shop never has to read a missing key as a rule.
  return activePoints(state).map((p) => ({ id: p.id, name: p.name, minOrderRM: pointMinOrder(p) }));
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
export function pointChoices(state, kitchenLabel = "My kitchen") {
  return [{ id: "", name: kitchenLabel }]
    .concat(activePoints(state).map((p) => ({ id: p.id, name: p.name })));
}

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
