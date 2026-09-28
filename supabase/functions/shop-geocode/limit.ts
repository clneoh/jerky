// supabase/functions/shop-geocode/limit.ts — how often one caller may ask (v202).
//
// WHY THIS ENDPOINT NEEDS ONE AND THE COURIER'S DOES NOT. The courier function refuses
// every request that does not carry a real owner session, so the only caller that can
// reach it is the baker herself. This one is reachable by anyone who opens the shop
// page and reads its source, and behind it are two free public geocoders with usage
// policies of their own. Without a cap, her Supabase project is a free address-lookup
// service for whoever finds the URL, and the bill for that arrives as Photon or
// Nominatim turning HER away — which would take the bakery's own lookups down with it.
//
// THE CAP IS DELIBERATELY LOOSE, and the reason is worth stating: Malaysian mobile
// carriers put a great many customers behind one address, so a tight per-address cap
// would refuse ordinary people going about their evening. A person typing one address
// fires a handful of lookups at most; a script fires hundreds a second. The gap
// between those two is enormous, so the cap sits in it and costs a real customer
// nothing.
//
// IT FAILS SOFT, TOO. A refused lookup is not a refused order: the shop says the
// lookup is unavailable and the customer pins their door on the map by hand, which is
// exactly what the shop did before this version existed.
//
// Pure on purpose — no Deno, no request, no clock of its own — so `nowMs` is passed in
// and the whole thing is driven under Node in test/shop-geocode.test.js.

export type HitRecord = { count: number; resetAt: number };
export type Hits = Map<string, HitRecord>;

// What one address may ask for inside one window. See the note above about carriers.
export const MAX_PER_WINDOW = 30;
export const WINDOW_MS = 60000;

// Past this many remembered addresses the spent ones are dropped. Without it a caller
// that rotates its address would grow this map for as long as the instance lives,
// which is the slow leak that only shows up after somebody has been unkind for a
// while.
const MAX_KEYS = 5000;

// Forget every window that has already closed. Called when the map has grown past
// MAX_KEYS rather than on a timer, so there is nothing here that has to be started,
// stopped or remembered.
export function sweep(hits: Hits, nowMs: number): void {
  for (const [key, rec] of hits) if (nowMs >= rec.resetAt) hits.delete(key);
}

// May this caller ask now? Counts the ask when it says yes, so the caller does not
// have to remember to. An absent or unreadable address is counted under one shared
// name rather than waved through: an unknown caller is not a licence to be unlimited.
export function allowHit(
  hits: Hits,
  ip: string,
  nowMs: number,
  { max = MAX_PER_WINDOW, windowMs = WINDOW_MS } = {},
): boolean {
  if (hits.size > MAX_KEYS) sweep(hits, nowMs);

  const key = String(ip || "").trim() || "unknown";
  const rec = hits.get(key);
  // A window that has closed is not a record of anything: it starts again, which is
  // also what lets a customer who tripped the cap come back a minute later.
  if (!rec || nowMs >= rec.resetAt) {
    hits.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  if (rec.count >= max) return false;
  rec.count += 1;
  return true;
}
