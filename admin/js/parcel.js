// js/parcel.js — a parcel: a box she posts herself, with a carrier she chose.
//
// THE SECOND KIND OF COURIER, and why it is not in js/couriers.js. That registry
// is the seam for a courier the app ASKS: it prices a vehicle for a journey,
// books it, names a driver and chases it, and a provider has to answer vehicles,
// quote and book to be one at all. A parcel carrier answers none of those here —
// she books the parcel on the carrier's own site or at a counter, and this app's
// whole job is to REMEMBER it: which carrier, which consignment, and whether it
// has gone. Putting one in that registry would mean writing the three answers it
// cannot give, and this app's own rule is that a control which does nothing must
// explain itself or look inert (see js/couriers.js). So a parcel is a RECORD on
// the order rather than a provider, and it lives here.
//
// Nothing here touches the DOM. What it is for is that no screen has to decide
// for itself what a half-written parcel means.

// The parcel stored ON THE ORDER (`o.parcel`), read the way a booked trip is
// (`o.courierJob` in js/courier_job.js) and for the same reason: an order row
// syncs whole, so a parcel recorded on one phone is on the other phone the next
// time it syncs, with no column, no migration and nothing to run in Supabase.
//
// `carrierName` is FROZEN into the record at the moment she records it, exactly
// as a booked trip freezes its courier's own name. Renaming or deleting a
// carrier afterwards is therefore a change to the LIST and never a rewrite of
// what a customer was already told or of what her books already say.
//
// A record with no carrier reads as NO record, the same discipline jobOf
// follows: a parcel the app cannot name a carrier for is not a parcel.
export function parcelOf(order) {
  const p = (order && order.parcel) || null;
  if (!p || typeof p !== "object") return null;
  return String(p.carrierName || "").trim() ? p : null;
}

// NOTE there is deliberately no consignment field here. The consignment number
// lives in the order's own tracking slot (`o.trackingNo`), which already holds
// either a number to read out or a link to open and words itself from the value
// (see trackingLine in js/courier_job.js). A parcel's number is the "read out"
// kind, so it needs no slot of its own — and keeping ONE slot is what stops the
// customer's card, the shipped message and the pop-up's tracking box from ever
// disagreeing about what the customer is being told.

// The carrier's name this order is with, from the order itself rather than from
// the carrier list — so an order keeps reading correctly after the list has
// renamed or dropped that row. "" when there is no parcel.
export function carrierOf(order) {
  const p = parcelOf(order);
  return p ? String(p.carrierName).trim() : "";
}

// Whether it has gone: she has handed the box over (or posted it), which is the
// one fact about a parcel this app can know on its own.
export function parcelHanded(order) {
  const p = parcelOf(order);
  return !!(p && String(p.handedAt || "").trim());
}

// Record the carrier on one order, freezing the name she chose. Re-recording the
// SAME carrier keeps the handed-over moment; switching to a different one clears
// it, because a box handed to J&T has not been handed to Ninja Van.
export function setParcel(order, carrier) {
  if (!order) return null;
  const carrierId = String((carrier && carrier.carrierId) || "").trim();
  const carrierName = String((carrier && carrier.carrierName) || "").trim();
  if (!carrierId || !carrierName) return null;
  const had = parcelOf(order);
  const same = had && had.carrierId === carrierId;
  order.parcel = {
    carrierId,
    carrierName,
    handedAt: same ? String(had.handedAt || "") : "",
  };
  return order.parcel;
}

// Note that the box has gone. Only ever on a recorded parcel: a handed-over
// moment with no carrier attached would be a fact about nothing.
export function markHanded(order, at) {
  const p = parcelOf(order);
  if (!p) return null;
  p.handedAt = String(at || new Date().toISOString());
  return p;
}

// Take the parcel off the order entirely. The consignment number in the tracking
// slot is deliberately LEFT ALONE: it is the order's own field with its own box
// on the order screen, and this press is about the carrier, not about erasing
// something she typed.
export function clearParcel(order) {
  if (order) delete order.parcel;
}

// The lines on this order that are NOT marked as able to travel as a parcel, by
// name and deduplicated. This is what the order screen says out loud, and it is
// deliberately ALL it does.
//
// A rule that HID the carrier pick or disabled the handed-over press for a fresh
// packet would be this app blocking a sale you take by hand, which is the one
// thing you have told us never to do. So a line that cannot travel by parcel is
// NAMED, and the controls stay exactly where they are.
export function notParcelable(state, group) {
  const out = [];
  for (const o of (group && group.orders) || []) {
    const p = (state.products || []).find((x) => x.id === o.productId);
    if (p && p.parcel === true) continue;
    const name = String((o && o.productName) || (p && p.name) || "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// The carriers she is most likely to want, as one press on the screen. The ids
// are DETERMINISTIC so that pressing it on two phones converges on the same rows
// instead of growing two copies of the same carrier — which is the whole reason
// the seed is a list of ids rather than a bare list of names.
export const USUAL_CARRIERS = [
  { id: "pc_jt", name: "J&T Express" },
  { id: "pc_ninja", name: "Ninja Van" },
  { id: "pc_lineclear", name: "Line Clear" },
  { id: "pc_poslaju", name: "Pos Laju" },
  { id: "pc_spx", name: "SPX Express" },
];

// Only the ones she does not already have. By id, so a carrier she has renamed
// is not duplicated back under its original name.
export function missingCarriers(state) {
  const have = new Set((state.parcelCouriers || []).map((c) => String(c.id)));
  return USUAL_CARRIERS.filter((c) => !have.has(c.id));
}
