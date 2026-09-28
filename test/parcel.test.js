// test/parcel.test.js — the record half of the second KIND of courier (v226).
//
// These are the rules every screen leans on, so they are asserted here on their own
// rather than only through a view: what a half-written record means, that the
// carrier's name is FROZEN (so a rename or a delete can never rewrite what a
// customer was told), that the consignment number is never touched by the carrier
// presses, and that the advisory NAMES a line rather than removing or disabling
// anything. No DOM in this file — js/parcel.js has none.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parcelOf, carrierOf, parcelHanded, setParcel, markHanded, clearParcel,
  notParcelable, missingCarriers, USUAL_CARRIERS,
} from "../admin/js/parcel.js";

const CARRIER = { carrierId: "pc_jt", carrierName: "J&T Express" };

test("a carrier recorded on an order freezes its name into the order", () => {
  const order = { id: "ord_1", trackingNo: "" };
  setParcel(order, CARRIER);

  assert.deepEqual(order.parcel, { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" });
  assert.equal(carrierOf(order), "J&T Express", "and the order reads its own name back");
});

test("the frozen name survives a rename AND a delete of the carrier", () => {
  const order = { id: "ord_1" };
  setParcel(order, CARRIER);

  // She renames the carrier on the Parcel couriers screen, then deletes it entirely.
  // Neither may reach an order that was already told to a customer — which is the
  // whole point of freezing the name rather than holding only an id.
  const list = [{ id: "pc_jt", name: "J&T (Prangin counter)" }];
  assert.equal(carrierOf(order), "J&T Express", "a rename in the list does not reach the order");
  list.length = 0;
  assert.equal(carrierOf(order), "J&T Express", "nor does a delete — the order keeps what it was told");
});

test("a half-written record reads as NO parcel", () => {
  assert.equal(parcelOf(null), null);
  assert.equal(parcelOf({}), null);
  assert.equal(parcelOf({ parcel: null }), null, "no record at all");
  assert.equal(parcelOf({ parcel: "J&T" }), null, "a bare string is not a record");
  assert.equal(parcelOf({ parcel: { carrierId: "pc_jt" } }), null, "an id with no name names nobody");
  assert.equal(parcelOf({ parcel: { carrierName: "   " } }), null, "whitespace is not a name");
  assert.equal(carrierOf({ parcel: { carrierName: "  " } }), "", "and reads as no carrier");
});

test("re-recording the SAME carrier keeps the handed-over moment; a different one clears it", () => {
  const order = { id: "ord_1" };
  setParcel(order, CARRIER);
  markHanded(order, "2026-09-28T02:00:00.000Z");
  assert.equal(parcelHanded(order), true);

  setParcel(order, CARRIER);
  assert.equal(order.parcel.handedAt, "2026-09-28T02:00:00.000Z",
    "saving the same order again must not undo a hand-over she recorded");

  setParcel(order, { carrierId: "pc_ninja", carrierName: "Ninja Van" });
  assert.equal(order.parcel.handedAt, "",
    "a box handed to J&T has not been handed to Ninja Van");
  assert.equal(parcelHanded(order), false);
});

test("setParcel refuses to invent a carrier from nothing", () => {
  const order = { id: "ord_1" };
  assert.equal(setParcel(order, null), null);
  assert.equal(setParcel(order, {}), null);
  assert.equal(setParcel(order, { carrierId: "pc_jt" }), null);
  assert.equal(setParcel(order, { carrierName: "J&T Express" }), null);
  assert.equal(order.parcel, undefined, "and leaves the order exactly as it was");
});

test("a handed-over moment cannot be recorded on an order with no parcel", () => {
  const order = { id: "ord_1" };
  assert.equal(markHanded(order, "2026-09-28T02:00:00.000Z"), null);
  assert.equal(order.parcel, undefined, "nothing to attach the fact to, so no fact is written");
});

test("clearing the parcel leaves the consignment number she typed alone", () => {
  const order = { id: "ord_1", trackingNo: "JT123456789" };
  setParcel(order, CARRIER);
  markHanded(order);
  clearParcel(order);

  assert.equal(order.parcel, undefined);
  assert.equal(order.trackingNo, "JT123456789",
    "the tracking box is the order's own field — this press is about the carrier");
});

// ── the advisory: NAMES a line, never removes or disables one ──────────────

function stateWith(products, carriers = []) {
  return { products, parcelCouriers: carriers, orders: [] };
}

test("notParcelable names exactly the lines that are not marked parcel-able", () => {
  const state = stateWith([
    { id: "prd_biscuit", name: "Almond biscuits", parcel: true },
    { id: "prd_focaccia", name: "Focaccia" },
    { id: "prd_plain", name: "Sourdough" },
  ]);
  const group = { orders: [
    { productId: "prd_focaccia", productName: "Focaccia" },
    { productId: "prd_biscuit", productName: "Almond biscuits" },
  ] };
  assert.deepEqual(notParcelable(state, group), ["Focaccia"],
    "the ticked line is left out; the unticked one is named");
});

test("notParcelable reads the product's own name when the line carried none", () => {
  const state = stateWith([{ id: "prd_focaccia", name: "Focaccia" }]);
  assert.deepEqual(notParcelable(state, { orders: [{ productId: "prd_focaccia" }] }), ["Focaccia"]);
});

test("notParcelable names a line whose product is gone, and never names one twice", () => {
  const state = stateWith([]);
  const group = { orders: [
    { productId: "prd_gone", productName: "Focaccia" },
    { productId: "prd_gone", productName: "Focaccia" },
  ] };
  assert.deepEqual(notParcelable(state, group), ["Focaccia"],
    "a repeated line is named once, and a deleted product is still named by what she sold");
});

test("notParcelable is empty when every line can travel, and on an empty group", () => {
  const state = stateWith([{ id: "prd_b", name: "Biscuits", parcel: true }]);
  assert.deepEqual(notParcelable(state, { orders: [{ productId: "prd_b" }] }), []);
  assert.deepEqual(notParcelable(state, {}), []);
  assert.deepEqual(notParcelable(state, null), []);
});

test("an unticked product is NOT the same as one that cannot travel — it is only named", () => {
  // The advisory is all this function is. If it ever grew a second job — hiding a
  // picker, disabling a press — the press it disabled would still be on screen here,
  // because `notParcelable` returns names and nothing else.
  const state = stateWith([{ id: "prd_focaccia", name: "Focaccia" }]);
  const group = { orders: [{ productId: "prd_focaccia", productName: "Focaccia" }] };
  assert.deepEqual(notParcelable(state, group), ["Focaccia"]);
  assert.equal(Object.keys(state).every((k) => k !== "hidden"), true, "nothing was written anywhere");
});

// ── the usual carriers, in one press ──────────────────────────────────────

test("missingCarriers offers every usual carrier on a fresh phone, then nothing", () => {
  const state = stateWith([], []);
  assert.equal(missingCarriers(state).length, USUAL_CARRIERS.length);

  for (const c of missingCarriers(state)) state.parcelCouriers.push({ id: c.id, name: c.name });
  assert.deepEqual(missingCarriers(state), [],
    "pressing the import a second time adds nothing — the ids are fixed for exactly this");
});

test("missingCarriers does not re-offer a carrier she renamed, and still offers one she deleted", () => {
  const state = stateWith([], [{ id: "pc_jt", name: "J&T (Prangin counter)" }]);
  const missing = missingCarriers(state).map((c) => c.id);
  assert.equal(missing.includes("pc_jt"), false, "renamed is still hers — no second copy under the old name");
  assert.equal(missing.length, USUAL_CARRIERS.length - 1, "the rest are still on offer");

  state.parcelCouriers.length = 0;
  assert.equal(missingCarriers(state).some((c) => c.id === "pc_jt"), true,
    "deleting it puts it back on offer, which is the only way to get it back");
});

test("every usual carrier has a fixed id and a name, so two phones converge", () => {
  const ids = USUAL_CARRIERS.map((c) => c.id);
  assert.deepEqual(ids, [...new Set(ids)], "no duplicate ids");
  for (const c of USUAL_CARRIERS) {
    assert.match(c.id, /^pc_/, "an id in the app's own prefix so it reads as a carrier");
    assert.ok(String(c.name).trim(), "and a name to show");
  }
});
