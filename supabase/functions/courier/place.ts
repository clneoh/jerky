// supabase/functions/courier/place.ts — is this a coordinate? (25 Sep 2026).
//
// The server's copy of the rule in admin/js/courier_place.js, and it is a copy for
// the one reason a copy is ever allowed here: the browser half and the server half
// cannot import each other, and the alternative — no check on this side — is worse.
// The two are kept deliberately identical in what they REFUSE, because what they
// refuse is the whole point:
//
//   `Number(null)` is 0. So is `Number("")`, `Number([])` and `Number(false)`.
//   Every one of them is finite, every one of them is in range, and every one of
//   them is a real point on the Equator, a hundred degrees from Penang. A trip
//   booked from there is a driver sent to the Gulf of Guinea, priced and confirmed
//   without a single complaint from any layer of the stack.
//
// So a thing that is not already a number and not a non-empty string is not a
// coordinate, whatever it happens to convert to. Beyond that, the range check is
// the same one: latitude within 90, longitude within 180.

export function strictNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Both numbers, in range, or null. The server's "is this a place".
export function validPoint(p: unknown): { lat: number; lng: number } | null {
  const o = (p && typeof p === "object") ? p as Record<string, unknown> : null;
  if (!o) return null;
  const lat = strictNumber(o.lat);
  const lng = strictNumber(o.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
