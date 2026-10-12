// test/points.test.js — Self collection Points (v298).
//
// Her scope, in her words: "we just need to have a card for points". So this file tests the
// MODEL behind that card and nothing else — no dashboard, no budget, no cost-against-value.
// Three of those were drawn once and withdrawn; a test here would only invite them back.
//
// The three things worth pinning, and each is a way of being confidently wrong:
//
//   1. THE KITCHEN IS NOT LIKE OTHER POINTS — it is free, has no minimum and cannot be
//      paused, whatever is stored on it.
//      ⚠️⚠️ THIS FILE USED TO SAY "THE KITCHEN IS NOT A POINT" and took it further: *"a Point
//      that quietly became the kitchen would inherit a fee she does not owe and a life she
//      cannot end."* **She overruled it at v406** — "I want all self collection thru collection
//      point, not from the kitchen", with a switch to say which one is the kitchen. The
//      sentence she overruled is kept here on purpose, because **the danger it names is real
//      and the answer to it is the test below, not the ban**: `kitchenExempt` reads the kitchen
//      as fee 0, minimum 0 and never paused, so it cannot inherit what she was warned about.
//   2. DELETE MUST NOT REWRITE HISTORY. The Point's name is frozen onto the order, so an
//      order that went to Farlim still says Farlim after the Point is deleted.
//   3. PAUSE IS THE NORMAL ENDING. She opens them one at a time and expects most to end, so
//      pausing one must not disturb a single other Point.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEE_RM, addPoint, blankPoint, deletePoint, fulfillmentText, normalizePoint, collectionWindowText, orderPointName, pointAddressFor, pointById, pointPhoneText, pointPlace, pointPlaceText, pointMinOrder, pointProblem, pointShortfall, pointWindow, pointWindowText, pointsOf, activePoints, publishPoints, setPointPaused, setPointPlace, updatePoint, markKitchen, kitchenPoint, kitchenExempt,
} from "../admin/js/points.js";
import { pointChoices } from "../admin/js/pointAreas.js";

function state(extra = {}) {
  return { orders: [], points: [], ...extra };
}

const FEE = { name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik, 11500 Air Itam",
  receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5 };

// ── the shape ────────────────────────────────────────────────────────────────

test("a new Point starts at the default fee and is offered at once", () => {
  const st = state();
  const p = addPoint(st, FEE, "2026-10-12T00:00:00.000Z");
  assert.ok(p && p.id.startsWith("pt_"), "a Point is given its own id");
  assert.equal(p.name, "Farlim, Air Itam");
  assert.equal(p.feeRM, 0.5);
  assert.equal(p.feeRM, DEFAULT_FEE_RM);
  assert.equal(p.paused, false, "a Point she has just opened is offered — pausing is a decision, not a default");
  assert.equal(p.createdAt, "2026-10-12T00:00:00.000Z");
  assert.equal(st.points.length, 1);
});

test("the receiver's number is stored the way every other number in this app is", () => {
  // Digits with the country code, so it can be dialled, linked and compared without a
  // second spelling of the same number. A driver reads it back through pointPhoneText.
  const p = addPoint(state(), FEE);
  assert.equal(p.phone, "60123456789");
  assert.equal(pointPhoneText(p.phone), "012-345 6789", "and it reads back as a number a driver would dial");
  // Anything not shaped like a number keeps its plain text rather than being emptied.
  assert.equal(normalizePoint({ name: "X", phone: "ask at the counter" }).phone, "ask at the counter");
  assert.equal(normalizePoint({ name: "X", phone: "" }).phone, "");
});

test("a Point needs a name, and nothing else", () => {
  // The floor a parcel carrier has. A Point she has not finished filling in is still hers
  // to save — refusing it would be a website rule standing between her and her own list.
  assert.equal(pointProblem({ name: "" }), "A Point needs a name");
  assert.equal(pointProblem({ name: "   " }), "A Point needs a name");
  assert.equal(pointProblem({ name: "Farlim" }), "");
  assert.equal(pointProblem({ name: "Farlim", receiver: "", phone: "" }), "",
    "no receiver and no phone is allowed — it is only the driver who suffers, and the card says so");
  assert.equal(addPoint(state(), { name: "" }), null, "and a nameless Point is never created");
});

test("two Points cannot share a name, and editing one is not a clash with itself", () => {
  const st = state();
  const a = addPoint(st, FEE);
  assert.match(pointProblem({ name: "farlim, air itam" }, pointsOf(st)), /already a Point/);
  assert.equal(addPoint(st, { name: "Farlim, Air Itam" }), null);
  // Renaming a Point to its own name is not a clash.
  assert.equal(pointProblem({ id: a.id, name: "Farlim, Air Itam" }, pointsOf(st)), "");
  assert.ok(updatePoint(st, a.id, { ...FEE, name: "Farlim, Air Itam" }));
});

test("junk clamps rather than throwing, and never reaches a screen", () => {
  assert.deepEqual(normalizePoint(null), blankPoint());
  assert.deepEqual(normalizePoint("nonsense"), blankPoint());
  assert.equal(normalizePoint({ name: "  X  " }).name, "X");
  assert.equal(normalizePoint({ name: "X", feeRM: -3 }).feeRM, DEFAULT_FEE_RM,
    "a negative fee falls back rather than paying a provider backwards");
  assert.equal(normalizePoint({ name: "X", feeRM: "abc" }).feeRM, DEFAULT_FEE_RM);
  assert.equal(normalizePoint({ name: "X", feeRM: 1.005 }).feeRM, 1,
    "money is rounded the way every other figure in this app is");
  assert.equal(normalizePoint({ name: "X", paused: "yes" }).paused, false,
    "only a real true pauses — a stray string does not take a Point off the shop");
  // A row with no name is dropped rather than drawn as a blank card.
  assert.deepEqual(pointsOf({ points: [{ id: "pt_1" }, { id: "pt_2", name: "Real" }] }).map((p) => p.name),
    ["Real"]);
});

// ── 2 · DELETE MUST NOT REWRITE HISTORY ──────────────────────────────────────

test("deleting a Point leaves the orders that used it saying where they went", () => {
  const st = state({ orders: [{ id: "o1", pointId: "pt_x", pointName: "Farlim, Air Itam" }] });
  const p = addPoint(st, FEE);
  st.orders.push({ id: "o2", pointId: p.id, pointName: p.name });

  assert.equal(orderPointName(st, st.orders[1]), "Farlim, Air Itam", "while the Point exists");
  assert.equal(deletePoint(st, p.id), true);
  assert.equal(pointById(st, p.id), null, "the Point is gone");
  assert.equal(orderPointName(st, st.orders[1]), "Farlim, Air Itam",
    "and the order STILL says Farlim — the name was frozen onto it when it was placed");
});

test("an order whose Point is gone never prints a bare id", () => {
  // A frozen name is what an order carries. With neither a frozen name nor a live Point,
  // the honest answer is nothing at all — an order reading "pt_9f2a" tells the person
  // holding the bags nothing.
  const st = state();
  assert.equal(orderPointName(st, { pointId: "pt_gone" }), "");
  assert.equal(orderPointName(st, { pointId: "pt_gone", pointName: "Farlim" }), "Farlim");
  assert.equal(orderPointName(st, null), "");
});

// ── 3 · PAUSE IS THE NORMAL ENDING, AND POINTS ARE INDEPENDENT ───────────────

test("pausing one Point disturbs no other", () => {
  // "baker will open collection point one by one… and not likely will open all point one go."
  const st = state();
  const a = addPoint(st, { ...FEE, name: "Farlim, Air Itam" }, "2026-10-12T00:00:00.000Z");
  const b = addPoint(st, { ...FEE, name: "Chai Leng Park, Prai" }, "2026-10-13T00:00:00.000Z");
  const c = addPoint(st, { ...FEE, name: "Bukit Mertajam" }, "2026-10-14T00:00:00.000Z");

  setPointPaused(st, b.id, true);
  assert.equal(pointById(st, a.id).paused, false, "one Point pausing is one Point pausing");
  assert.equal(pointById(st, c.id).paused, false);
  assert.deepEqual(activePoints(st).map((p) => p.name), ["Farlim, Air Itam", "Bukit Mertajam"],
    "the shop offers the active ones only");

  setPointPaused(st, b.id, false);
  assert.equal(activePoints(st).length, 3, "and Resume brings it back");
});

test("paused Points sink to the bottom of the card", () => {
  // She sees the ones that are working first; a paused Point is still there to be brought
  // back, and a name would otherwise shuffle around as she pauses things.
  const st = state();
  const a = addPoint(st, { ...FEE, name: "First" }, "2026-10-12T00:00:00.000Z");
  addPoint(st, { ...FEE, name: "Second" }, "2026-10-13T00:00:00.000Z");
  addPoint(st, { ...FEE, name: "Third" }, "2026-10-14T00:00:00.000Z");
  assert.deepEqual(pointsOf(st).map((p) => p.name), ["First", "Second", "Third"]);
  setPointPaused(st, a.id, true);
  assert.deepEqual(pointsOf(st).map((p) => p.name), ["Second", "Third", "First"],
    "the paused one is last, and the order she opened them in is otherwise kept");
});

test("an edit corrects a Point and never makes a new one", () => {
  const st = state();
  const p = addPoint(st, FEE, "2026-10-12T00:00:00.000Z");
  const next = updatePoint(st, p.id, { ...FEE, name: "Farlim — Aunty Lim's shop", feeRM: 1 });
  assert.equal(st.points.length, 1, "an edit is a correction, not a second Point");
  assert.equal(next.id, p.id, "and the id never moves");
  assert.equal(next.createdAt, "2026-10-12T00:00:00.000Z",
    "nor the day she opened it — that is a fact about the Point, not a field of the form");
  assert.equal(next.feeRM, 1, "the fee is hers to raise");
  assert.equal(updatePoint(st, "pt_nope", FEE), null, "editing a Point that is not there does nothing");
});

test("deleting a Point that is not there removes nothing", () => {
  const st = state();
  addPoint(st, FEE);
  assert.equal(deletePoint(st, "pt_nope"), false);
  assert.equal(deletePoint(st, ""), false);
  assert.equal(st.points.length, 1);
});

// ── where a Point IS (v300) ─────────────────────────────────────────────────

test("a Point can be put on the map, and says so", () => {
  // A courier is given coordinates, never an address — "5.41405,100.31408" is a door and
  // "Farlim, Air Itam" is a guess about one. So a Point without a pin is a name she can read
  // and a place a van cannot be sent to, and the card has to say which of the two it is.
  const st = state();
  const p = addPoint(st, FEE);
  assert.equal(pointPlace(p), null, "a new Point starts unpinned");
  assert.equal(pointPlaceText(p), "");

  setPointPlace(st, p.id, { lat: 5.41405, lng: 100.31408, label: "Farlim, Air Itam" });
  assert.deepEqual(pointPlace(pointById(st, p.id)),
    { lat: 5.41405, lng: 100.31408, label: "Farlim, Air Itam" });
  assert.match(pointPlaceText(pointById(st, p.id)), /^Farlim, Air Itam\s+·\s+5\.41405, 100\.31408$/,
    "the line says the label AND the numbers, because a label alone cannot be checked");
});

test("half a pair of coordinates is not a place", () => {
  // Anything malformed reads as UNPINNED rather than as a point in the sea off Africa. The
  // app answers null rather than throwing, so a hand-edited or half-synced row can never
  // send a driver somewhere absurd.
  const st = state();
  const p = addPoint(st, FEE);
  for (const junk of [{ lat: 5.41 }, { lng: 100.31 }, { lat: "x", lng: "y" },
    { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, null, "nonsense"]) {
    assert.equal(setPointPlace(st, p.id, junk), null, `${JSON.stringify(junk)} is not a place`);
    assert.equal(pointPlace(pointById(st, p.id)), null);
  }
  assert.equal(normalizePoint({ name: "X", place: { lat: 5.41 } }).place, null,
    "and a stored half-place is dropped on the way in, not drawn");
  assert.equal(setPointPlace(st, "pt_nope", { lat: 5, lng: 100 }), null,
    "pinning a Point that is not there does nothing");
});

test("⚠️ editing a Point NEVER unpins it", () => {
  // THE PIN IS NOT A FIELD OF THE FORM. The editor hands over a draft with no `place` on it,
  // so a correction that did not carry the pin across would silently un-pin the Point — she
  // fixes a spelling and the van loses its door. The same forgotten-field trap the profile's
  // four lists teach, in a smaller place.
  const st = state();
  const p = addPoint(st, FEE);
  setPointPlace(st, p.id, { lat: 5.41405, lng: 100.31408, label: "Farlim" });
  const next = updatePoint(st, p.id, { ...FEE, name: "Farlim — Aunty Lim's shop", feeRM: 1 });
  assert.equal(next.name, "Farlim — Aunty Lim's shop", "the correction landed");
  assert.deepEqual(pointPlace(next), { lat: 5.41405, lng: 100.31408, label: "Farlim" },
    "and the pin is exactly where it was");
});

test("the pin stays in her app", () => {
  // The shop is a public page, and a set of coordinates is where a person's shop is. It gets
  // the name and nothing else — a customer chooses a Point by NAME, and the driver is the
  // only one who needs the door.
  const st = state();
  const p = addPoint(st, FEE);
  setPointPlace(st, p.id, { lat: 5.41405, lng: 100.31408, label: "Farlim" });
  assert.deepEqual(Object.keys(publishPoints(st)[0]).sort(),
    ["id", "isKitchen", "minOrderRM", "name"]);
  assert.equal(JSON.stringify(publishPoints(st)).includes("100.31408"), false);
});

// ── what the SHOP is allowed to know (v299) ─────────────────────────────────

test("the shop is told a Point's name and its smallest basket, and NOTHING else", () => {
  // ⚠️ THE SHOP IS A PUBLIC PAGE. The receiver's name, their phone and the fee are hers;
  // publishing any of them would put a private person's mobile number on a page anyone can
  // read, and the fee is what she pays out rather than a price. Same rule as the promo
  // code's holder (v289).
  //
  // The SMALLEST BASKET is the one thing that did get added (v306), and it is the opposite of
  // private: it is exactly what a customer has to know before choosing, and without it the shop
  // could only take an order the Point does not want. The key list is asserted WHOLE, so a
  // fourth key cannot be added by accident.
  //
  // ★★ AND `isKitchen` IS THAT FOURTH KEY (v407), added deliberately rather than by drift — which
  // is the whole reason this list is asserted whole. ⚠️ It is not a fact about her, it is a fact
  // about the PAGE: until it was published the shop had no way to know which Point was her
  // kitchen, so it went on printing its own invented "Our kitchen" row above the list and **a
  // customer saw her kitchen twice** — once invented, once under the name she gave it. It is
  // exactly as public as the name it sits beside, and it is the smallest thing that stops the
  // shop inventing a row. See store/app.js.
  const st = state();
  addPoint(st, { ...FEE, minOrderRM: 30 });
  const [published] = publishPoints(st);
  assert.deepEqual(Object.keys(published).sort(), ["id", "isKitchen", "minOrderRM", "name"]);
  assert.equal(published.minOrderRM, 30, "the smallest basket, as a plain number");
  assert.equal(published.isKitchen, false, "an ordinary Point is not the kitchen");
  const blob = JSON.stringify(published);
  assert.equal(blob.includes("Aunty Lim"), false, "the receiver is never published");
  assert.equal(blob.includes("60123456789"), false, "nor their phone");
  assert.equal(blob.includes("Lebuhraya"), false, "nor the address — the message that tells a customer where to go is built from HER copy");
  assert.equal(blob.includes("0.5"), false, "nor the fee, which is what she pays out");
});

test("exactly one Point is published as the kitchen, and it is the one she marked", () => {
  // ★★ THE SHOP DEPENDS ON "EXACTLY ONE" (v407): it drops its invented kitchen row the moment it
  // sees a marked one, so **two marks would leave a customer with two kitchens and no fallback**,
  // and the house rule her own words set is __"Allow only one collection point as kitchen"__.
  const st = state();
  const a = addPoint(st, { ...FEE, name: "Farlim, Air Itam" }, "2026-10-12T00:00:00.000Z");
  const b = addPoint(st, { ...FEE, name: "Chai Leng Park, Prai" }, "2026-10-13T00:00:00.000Z");
  assert.equal(publishPoints(st).filter((p) => p.isKitchen).length, 0,
    "no kitchen marked means none published — the shop keeps its own invented row");

  markKitchen(st, b.id);
  const marked = publishPoints(st).filter((p) => p.isKitchen);
  assert.equal(marked.length, 1, "one kitchen, never two");
  assert.equal(marked[0].name, "Chai Leng Park, Prai", "and it is the one she marked");
  assert.equal(publishPoints(st).find((p) => p.name === "Farlim, Air Itam").isKitchen, false,
    "the other Point is not swept up with it");

  markKitchen(st, a.id);
  assert.deepEqual(publishPoints(st).filter((p) => p.isKitchen).map((p) => p.name),
    ["Farlim, Air Itam"], "marking a new one moves the kitchen rather than adding a second");

  markKitchen(st, null);
  assert.equal(publishPoints(st).filter((p) => p.isKitchen).length, 0,
    "and un-marking leaves the shop with its fallback row, which is why the row stays");

  // ⚠️ A KITCHEN SHE PAUSED IS STILL PUBLISHED — the one place that must always exist.
  markKitchen(st, a.id);
  setPointPaused(st, a.id, true);
  assert.equal(publishPoints(st).find((p) => p.id === a.id).isKitchen, true,
    "the kitchen is offered even paused, because it is where the bread is");
});

test("the shop is offered only the Points she has open", () => {
  const st = state();
  const a = addPoint(st, { ...FEE, name: "Farlim, Air Itam" }, "2026-10-12T00:00:00.000Z");
  addPoint(st, { ...FEE, name: "Chai Leng Park, Prai" }, "2026-10-13T00:00:00.000Z");
  assert.deepEqual(publishPoints(st).map((p) => p.name), ["Farlim, Air Itam", "Chai Leng Park, Prai"]);
  // Pausing is the whole of what takes a Point off the shop's list.
  setPointPaused(st, a.id, true);
  assert.deepEqual(publishPoints(st).map((p) => p.name), ["Chai Leng Park, Prai"],
    "a paused Point stops being offered the moment she pauses it");
  // And with none open the shop is sent an empty list rather than nothing at all — the
  // published payload replaces the whole row, so an absent key would leave yesterday's
  // Points on a page that is already open.
  setPointPaused(st, a.id, false);
  st.points = [];
  assert.deepEqual(publishPoints(st), []);
});

// ── how the customer is told (v299) ─────────────────────────────────────────

test("the four messages and the confirmation say the same thing about where to go", () => {
  // One wording, read by two builders. A customer told "Self collect" in the confirmation and
  // "Self collect at Farlim" in the reminder would be right to wonder which is true.
  const st = state();
  const p = addPoint(st, FEE);

  assert.equal(fulfillmentText(st, { fulfillment: "courier" }), "Post (nationwide)");
  // The KITCHEN keeps the words it has always had — an order with no point is what every order
  // placed before this version is, so nothing it says may change.
  assert.equal(fulfillmentText(st, { fulfillment: "collect" }), "Collect (local)");
  assert.equal(fulfillmentText(st, { fulfillment: "collect", pointId: "" }), "Collect (local)");

  assert.equal(fulfillmentText(st, { fulfillment: "collect", pointId: p.id, pointName: p.name }),
    "Collect (local) at Farlim, Air Itam");
  // The FROZEN name is what an order is told by, so deleting the Point does not rename where
  // it went — the same rule the frozen product name and price follow.
  deletePoint(st, p.id);
  assert.equal(fulfillmentText(st, { fulfillment: "collect", pointId: p.id, pointName: p.name }),
    "Collect (local) at Farlim, Air Itam", "a deleted Point still names where that order went");
});

test("the address a message gives is read LIVE, and only a Point has one", () => {
  // The name is frozen; the address is operational. Moving a Point to a new shop tells the
  // NEXT customer the new place — and a Point she has deleted has no address to give, which
  // is the honest answer rather than the last one it had.
  const st = state();
  const p = addPoint(st, FEE);
  const order = { fulfillment: "collect", pointId: p.id, pointName: p.name };
  assert.equal(pointAddressFor(st, order), "Lebuhraya Thean Teik, 11500 Air Itam");

  updatePoint(st, p.id, { ...FEE, address: "Somewhere else, 11500 Air Itam" });
  assert.equal(pointAddressFor(st, order), "Somewhere else, 11500 Air Itam",
    "a moved Point tells the next customer the new place");

  assert.equal(pointAddressFor(st, { fulfillment: "collect", pointId: "", pointName: "" }), "",
    "the kitchen has no address line — collecting there is what the shop already says");
  assert.equal(pointAddressFor(st, { fulfillment: "courier", pointId: p.id }), "",
    "and a courier order is given no Point address at all");
  deletePoint(st, p.id);
  assert.equal(pointAddressFor(st, order), "",
    "a deleted Point has none to give, and nothing is invented in its place");
});

// ── v304: WHEN THEY CAN COLLECT ─────────────────────────────────────────────
// Her choice, from the three offered: the window belongs to the PLACE, typed once on the Point,
// and every order collecting there is promised it. Not the van's arrival window — that is when
// the bread REACHES the Point, and a customer told it would turn up as the van does.
//
// It is stored as the app's ONE packed window string and read by the same helpers a delivery
// window is (time_window.js), because a second way of spelling a window is a second way of
// getting one wrong: "2:00" meaning pm on one screen and am on another.

test("a Point carries a collection window, and it is the app's one window shape (v304)", () => {
  const p = addPoint(state(), { ...FEE, collectWindow: "14:00-18:00" });
  assert.equal(p.collectWindow, "14:00-18:00", "stored as the packed value, exactly as a trip's is");
  assert.equal(pointWindow(p), "14:00-18:00");
  assert.equal(pointWindowText(p), "2-6 pm", "and said the way she would say it");
});

test("a Point with no window says so by carrying nothing (v304)", () => {
  // Empty promises NOTHING rather than promising wide — an unset window must never read as
  // "open all day", because the customer is then told the day and only the day.
  const p = addPoint(state(), FEE);
  assert.equal(p.collectWindow, "");
  assert.equal(pointWindow(p), "");
  assert.equal(pointWindowText(p), "");
  assert.equal(normalizePoint({ name: "X" }).collectWindow, "");
});

test("a window that could not be typed is NOT a window (v304)", () => {
  // The same gate a delivery window passes: a half-filled pair, junk, or an end before its
  // start are all refused, so a promise she is halfway through cannot reach a customer.
  assert.equal(normalizePoint({ name: "X", collectWindow: "14:00-" }).collectWindow, "");
  assert.equal(normalizePoint({ name: "X", collectWindow: "rubbish" }).collectWindow, "");
  assert.equal(normalizePoint({ name: "X", collectWindow: "18:00-14:00" }).collectWindow, "",
    "an end before its start would tell a customer to come before the bread was there");
  assert.equal(normalizePoint({ name: "X", collectWindow: "14:00-18:00" }).collectWindow, "14:00-18:00");
});

test("what a collecting customer is promised, in the one place that says it (v304)", () => {
  const st = state({ points: [normalizePoint({ ...FEE, id: "pt_f", collectWindow: "14:00-18:00" })] });
  assert.equal(collectionWindowText(st, { pointId: "pt_f" }), ", collect 2-6 pm");
  // No window set: nothing at all is promised about the time.
  st.points = [normalizePoint({ ...FEE, id: "pt_f" })];
  assert.equal(collectionWindowText(st, { pointId: "pt_f" }), "");
  // The KITCHEN, and a Point she has since deleted, are both "no window" rather than an error.
  assert.equal(collectionWindowText(st, { pointId: "" }), "");
  assert.equal(collectionWindowText(st, { pointId: "pt_gone" }), "");
  assert.equal(collectionWindowText(st, null), "");
});

test("an edited Point keeps the window she typed, and can be given one it never had (v304)", async () => {
  const st = state();
  const p = addPoint(st, { ...FEE, collectWindow: "14:00-18:00" });
  // A plain edit with no window in the draft CLEARS it — which is what an emptied pair of boxes
  // means, and the one case that would otherwise quietly keep hours she has taken away.
  updatePoint(st, p.id, { ...FEE });
  assert.equal(pointById(st, p.id).collectWindow, "", "emptying the boxes takes the window off");
  updatePoint(st, p.id, { ...FEE, collectWindow: "15:00-19:00" });
  assert.equal(pointWindowText(pointById(st, p.id)), "3-7 pm", "and it can be set again");
});

// ── v306: THE SMALLEST BASKET A POINT WILL TAKE ─────────────────────────────
// Her words: "now the per-point minimum order, this should be switchable". Unit chosen by her
// from two offered: RINGGIT — the same unit the promo code's own smallest basket uses, so
// "a basket of RM30" means one thing in this app.
//
// ⚠️ IT DEFAULTS TO NONE, and that is her own earlier decision ("keep it as simple as possible,
// say no minimum for self collect order"). A minimum of 0 IS no minimum: nothing in the record
// distinguishes a Point she has never set one on from one she has just switched off.

test("a Point carries a smallest basket, in ringgit, and 0 means none (v306)", () => {
  const p = addPoint(state(), { ...FEE, minOrderRM: 30 });
  assert.equal(p.minOrderRM, 30);
  assert.equal(pointMinOrder(p), 30);
  assert.equal(addPoint(state(), FEE).minOrderRM, 0, "a Point she opens has no minimum");
  assert.equal(pointMinOrder(null), 0);
});

test("a minimum that is not money is NO minimum, never a broken one (v306)", () => {
  // The same floor the fee has: junk, a negative and a blank all mean "no minimum" rather than
  // reaching a customer as a rule nobody set.
  for (const junk of ["rubbish", -5, "", null, undefined, NaN]) {
    assert.equal(normalizePoint({ name: "X", minOrderRM: junk }).minOrderRM, 0, `for ${junk}`);
  }
  // A tidy case rather than a half-cent tie: what matters is that it goes through the app's own
  // rounding (round2) and not through some second arithmetic of its own.
  assert.equal(normalizePoint({ name: "X", minOrderRM: "12.499" }).minOrderRM, 12.5,
    "and real money is rounded the way every other figure in this app is");
});

test("the shortfall is what the shop says and what it refuses on — ONE answer (v306)", () => {
  const p = normalizePoint({ ...FEE, id: "pt_f", minOrderRM: 30 });
  assert.equal(pointShortfall(p, 0), 30);
  assert.equal(pointShortfall(p, 18), 12, "RM18 against RM30 is RM12 short");
  assert.equal(pointShortfall(p, 30), 0, "reaching it exactly is reaching it");
  assert.equal(pointShortfall(p, 45), 0, "and over it is not a negative shortfall");
  // A Point with no minimum is never short, whatever the basket.
  assert.equal(pointShortfall(normalizePoint(FEE), 0), 0);
  assert.equal(pointShortfall(null, 0), 0);
  assert.equal(pointShortfall(p, "rubbish"), 30, "a basket the shop cannot read is an empty basket");
  // ⚠️ AND A BASKET A HAIR UNDER THE LINE IS NOT SHORT. Ten items at RM2.999999999 is RM30 as far
  // as any customer and any till is concerned, and a Point parked on a floating-point remainder
  // would say "yours is RM30.00 so far" under a line saying it needs RM30 — the screen calling
  // her own rule a lie. round2 is what makes the two agree.
  assert.equal(pointShortfall(p, 29.999999999), 0, "the line is the line, to the sen");
  assert.equal(pointShortfall(p, 29.99), 0.01, "but a real sen short is a sen short");
});

test("switching the minimum off is a minimum of zero, not a remembered number (v306)", async () => {
  const st = state();
  const p = addPoint(st, { ...FEE, minOrderRM: 30 });
  updatePoint(st, p.id, { ...FEE, minOrderRM: 0 });
  assert.equal(pointMinOrder(pointById(st, p.id)), 0, "the switch off IS no minimum");
  updatePoint(st, p.id, { ...FEE, minOrderRM: 45 });
  assert.equal(pointMinOrder(pointById(st, p.id)), 45, "and it can be set again");
});

// ── ★★ THE KITCHEN AS A POINT (v406) ──────────────────────────────────────────
// Her words: __"I want all self collection thru collection point, not from the kitchen"__ and __"at
// self collection point, add a switch whether that collection is a kitchen. Allow only one collection
// point as kitchen for the time being. NO pin is needed if it is kitchen"__ — and then, correcting me,
// __"a point need a pin"__.
//
// ⚠️⚠️ THIS FILE'S OWN HEADER ARGUED THE OTHER WAY, AND IT WAS RIGHT TO: *"THE KITCHEN IS NOT A POINT…
// a Point that quietly became the kitchen would inherit a fee she does not owe and a life she cannot
// end."* **She has overruled it, and the concern it raised is handled rather than dropped** — the
// `kitchenExempt` tests below are what keeps it true.

const SPOT = { lat: 5.4141, lng: 100.3290, label: "Farlim" };

test("★★ marking a kitchen is EXCLUSIVE — one call, and only one Point can hold it", () => {
  // ⚠️⚠️ THE EXCLUSIVITY IS `markKitchen`'S JOB AND NOBODY ELSE'S. Her words: __"Allow only one
  // collection point as kitchen for the time being"__ — and a rule kept by three call sites is a rule
  // that is wrong in two of them. **Marking one clears the rest in the same breath.**
  const st = state();
  const a = addPoint(st, { ...FEE, name: "A", place: SPOT });
  const b = addPoint(st, { ...FEE, name: "B", place: SPOT });
  markKitchen(st, a.id);
  assert.equal(kitchenPoint(st).id, a.id, "the kitchen was not marked");
  markKitchen(st, b.id);
  assert.equal(kitchenPoint(st).id, b.id, "the second mark did not take");
  assert.equal(pointsOf(st).filter((p) => p.isKitchen).length, 1,
    "⚠️⚠️ TWO Points are the kitchen at once");
  // ⚠️ And passing null clears it, which is how she un-marks one without deleting the place.
  markKitchen(st, null);
  assert.equal(kitchenPoint(st), null, "the mark could not be taken off");
});

test("★★⚠️ HER OWN PICKER OFFERS EVERY PLACE SHE HAS MADE — a pin is not asked for (v420)", () => {
  // ⚠️⚠️ THIS TEST USED TO READ THE OPPOSITE WAY, and what it asserted was true of the wrong list.
  // v406 put a PIN gate inside `pointChoices` believing it was the list a CUSTOMER picks from. ⭐ It
  // is not — it is called from ONE file, `views/orders.js`, and from nowhere else, while the shop
  // builds its own list from the published Points (`shopPointOrder`).
  // **So the gate hid her own Places from HER OWN screens while the customer's page went on offering
  // every one of them.** Her report: __"the point i setup is not available for selection in +order,
  // edit order and other"__.
  // ⚠️ And it broke her standing rule with it: nothing may block or hide a sale she takes by hand —
  // she could not even record an order collecting at a Place she had just made.
  const st = state();
  addPoint(st, { ...FEE, name: "Unpinned" });
  addPoint(st, { ...FEE, name: "Pinned", place: SPOT });
  const offered = pointChoices(st).map((c) => c.name);
  assert.ok(offered.includes("Pinned"), "a pinned Place is offered");
  assert.ok(offered.includes("Unpinned"),
    "⚠️⚠️ and so is one with no pin — a pin is what a VAN is given, and a customer walking to a Place "
    + "is told its ADDRESS, which is a different field this Place can have without one");
});

test("⚠️ and the pin is still enforced where it actually belongs: a Place with no pin cannot be sent a van", () => {
  // ⭐ THE RULE WAS NOT DROPPED, IT WAS PUT BACK WHERE IT LIVES. A Point with no pin is a name a van
  // cannot be sent to — the delivery run says exactly that and offers to fix it, __"this Point is not
  // pinned yet"__ / **Pin the Point** (see views/delivery_run.js).
  // ⚠️ And `pointPlace` still refuses a HALF-typed one, so a Place can never be a point in the sea.
  const st = state();
  const loose = addPoint(st, { ...FEE, name: "Unpinned" });
  const pinned = addPoint(st, { ...FEE, name: "Pinned", place: SPOT });
  assert.equal(pointPlace(loose), null, "no pin reads as no pin");
  assert.ok(pointPlace(pinned), "and a real one reads back");
  assert.equal(pointPlace({ place: { lat: 91, lng: 100 } }), null,
    "⚠️ and one number with no other is NOT a place");
});

test("★★⚠️ a MARKED kitchen stops the invented \"My kitchen\" row — every collection is a Point", () => {
  // ⚠️⚠️ THIS IS THE "not from the kitchen" HALF. Until v406 the kitchen was **the ABSENCE of a Point**,
  // so this had to invent a row for it. ⭐ The fallback is kept for the day she has not marked one — and
  // that is what keeps every order taken before today, which carries no point id, meaning the kitchen.
  const st = state();
  const k = addPoint(st, { ...FEE, name: "Farlim shop", feeRM: 0 });
  markKitchen(st, k.id);
  assert.deepEqual(pointChoices(st).map((c) => c.name), ["Farlim shop"],
    "⚠️ the invented kitchen row is still there beside the marked one — two kitchens on the page");
  // ⚠️ And with NOTHING marked, the fallback is still offered, so a customer can always collect.
  markKitchen(st, null);
  assert.ok(pointChoices(st).some((c) => !c.id), "⚠️ with no kitchen marked there is nowhere to collect");
});

test("★★⚠️ the KITCHEN inherits no fee, no minimum, and cannot be paused", () => {
  // ⚠️⚠️ THE OLD HEADER'S CONCERN, ANSWERED IN CODE. *"A Point that quietly became the kitchen would
  // inherit a fee she does not owe and a life she cannot end."* It cannot, because the kitchen is read
  // through `kitchenExempt` — wherever it is read.
  const st = state();
  const k = addPoint(st, { ...FEE, name: "My kitchen", feeRM: 0.5, place: SPOT });
  markKitchen(st, k.id);
  k.minOrderRM = 30;          // as if she had set one before marking it
  k.paused = true;            // and paused it
  const read = kitchenExempt(k);
  assert.equal(read.feeRM, 0, "⚠️ the kitchen carries a fee she does not owe");
  assert.equal(pointMinOrder(k), 0, "⚠️ the kitchen demands a minimum basket at her own door");
  assert.equal(read.paused, false, "the kitchen reads as paused");
  assert.ok(activePoints(st).some((p) => p.isKitchen),
    "⚠️⚠️ a PAUSED kitchen dropped off the list — that leaves a customer nowhere to collect, and the "
    + "kitchen is the one place that must always exist because it is where the bread is");
  // ⚠️ And an ordinary Point keeps all three of its own — the exemption is the kitchen's alone.
  const plain = { ...blankPoint(), name: "Shop", feeRM: 0.5, minOrderRM: 30, paused: true };
  assert.equal(kitchenExempt(plain).feeRM, 0.5, "an ordinary Point lost its fee");
  assert.equal(kitchenExempt(plain).paused, true, "an ordinary Point could no longer be paused");
});
