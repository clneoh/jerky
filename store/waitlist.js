// store/waitlist.js — "tell me when this day frees up" (P5, the customer plan's last level).
//
// ⭐ THE HONEST SHAPE: ⚠️ the shop may ADD a request and must not be able to READ the list back — every row is
// somebody else's phone number (see supabase/waitlist.sql). ⭐ So everything here is write-only and pure: what
// a valid request looks like, and how often one device may ask.

export const WAITLIST_MAX_NAME = 60;
export const WAITLIST_DAYS = 120; // a request older than this is not worth keeping

const tidy = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * The row to send, or null when it is not a real request.
 * ⚠️ A number is required — the whole point is to reach them — and it is stored in the same digits-only form
 * every other part of the app uses (`waNumber`), so it opens a chat later without re-formatting.
 */
export function waitRow({ day = "", name = "", whatsapp = "" } = {}, toDigits) {
  const when = tidy(day, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) return null;
  const digits = typeof toDigits === "function" ? String(toDigits(whatsapp) || "") : String(whatsapp || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return { day: when, name: tidy(name, WAITLIST_MAX_NAME), whatsapp: digits };
}

// One ask per day per device: the phone that asked once should not fill her list by pressing again.
const KEY = "bakeadmin.shop.asked";
export function askedDays(storage) {
  try {
    const raw = storage && storage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))) : [];
  } catch { return []; }
}

export function hasAsked(storage, day) {
  return askedDays(storage).includes(String(day));
}

export function rememberAsked(storage, day) {
  const list = askedDays(storage);
  const next = [...new Set([...list, String(day)])].slice(-WAITLIST_DAYS);
  try { if (storage) storage.setItem(KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}
