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

// A note a customer attaches to ONE ordered item (v236) — “no nuts”, “write
// Happy Birthday”. Short on purpose: it rides the order row, and every order row
// is repeated in each phone's localStorage copy, in every cloud snapshot, in
// every export and in every backup, and it is read off a packing slip where a
// paragraph is not a note.
//
// The cap lives here because BOTH sides have to use the same number, which is
// this module's whole reason for existing: the shop stops the typist at it, and
// the app trims whatever arrives to it — because what arrives was typed into a
// browser the baker does not control, and a shop page running yesterday's cached
// script would not have stopped anyone at all.
export const LINE_NOTE_MAX = 120;

// The note as it should be STORED, or "" when there is nothing worth storing.
//
// Only a STRING is a note. A number, a list or an object arriving from a page the
// baker does not control is not words a customer wrote, and String()-ing it would
// print a figure on a packing slip where nothing was ever asked for — the same
// reason `isThumb` above checks the type before it checks the shape.
//
// Absent — not an empty string — is how this app spells “no note” everywhere, so
// a caller writes the key only when this answers with words. That is what keeps
// an order nobody attached a note to byte-for-byte the order it always was, and
// keeps the sync journal from seeing a change that is not one.
export function lineNoteOf(value) {
  if (typeof value !== "string") return "";
  const s = value.trim();
  return s.length > LINE_NOTE_MAX ? s.slice(0, LINE_NOTE_MAX).trim() : s;
}
