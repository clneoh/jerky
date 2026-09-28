// storefront-fields.js — the fields the backoffice publishes to the customer
// page and the shop independently re-checks. Root module because BOTH sides
// import it: admin/js/supabase.js where the payload is built, and store/app.js
// where it is merged in.
//
// It exists for one reason. The two whitelists build a fresh object per product,
// field by field, so a field the publisher writes but the shop does not copy is
// dropped with no error, no log and no failing test — and the same in reverse.
// Anything whose meaning has to be identical on both sides therefore lives here,
// in the one place both can read it, rather than as two copies that can drift.

// A product thumbnail is a small JPEG the app made with readPhoto()
// (admin/js/photo.js): a data URL of up to ~30 KB, already shrunk for the
// your phone. Nothing here cares about the SHAPE — v223 makes every one a
// square (cropped to fill the shop's 120 px window), but this only checks that
// the bytes ARE a photo the app made, so an older, still-rectangular thumb from
// before the crop is just as acceptable here and is simply trimmed by `cover`
// when the shop draws it.
//
// Checked on both sides because a bad one is expensive either way: it rides in
// the single ~5 MB localStorage key that every cloud snapshot and export carries,
// and it is sent to every customer's phone on each page load. So it must BE a
// JPEG data URL — PNG or SVG would be far larger, and anything else (a bare URL,
// a mangled string, an empty one) is not a photo we made. The length cap is the
// backstop for a genuinely huge one that still looks like a data URL.
export const THUMB_MAX = 40000;

export function isThumb(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length <= THUMB_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s);
}
