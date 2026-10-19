// supabase/functions/shop-feedback/limit.ts — how often one caller may send a note (v565).
//
// ⚠️⚠️ WHY THIS ENDPOINT NEEDS ONE. It is reachable by anyone who opens the shop's source, it is
// unauthenticated by design, and **every accepted note sends up to five emails through Resend on her
// account.** ⚠️ A script could burn her monthly quota — which is the same mailbox her wish-list mail and
// her own replies go through — and fill the developer's inbox with thousands of messages in a minute.
// The honeypot field only stops the naive bots; it stops nothing that reads the page.
//
// ⭐ THE CAP IS DELIBERATELY LOOSE, for the reason the geocode limiter gives: Malaysian mobile carriers
// put many customers behind one address, and a real visitor writes at most one note a visit. Five in ten
// minutes costs an ordinary person nothing and a script everything.
//
// ⚠️ IT IS PER-INSTANCE, so scaled instances each keep their own count — the same honest limit the
// geocode limiter documents. It raises the cost of abuse; it is not a wall.
//
// Pure on purpose — no Deno, no request, no clock of its own — so `nowMs` is passed in and the whole
// thing is driven under Node in test/shop-feedback-limit.test.js.

export type Hit = { n: number; resetAt: number };
export type Hits = Map<string, Hit>;

export const MAX_PER_WINDOW = 5;
export const WINDOW_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;

// Forget closed windows once the map has grown, rather than on a timer: nothing here has to be started,
// stopped or remembered.
export function sweep(hits: Hits, nowMs: number): void {
  if (hits.size <= MAX_KEYS) return;
  for (const [k, v] of hits) if (v.resetAt <= nowMs) hits.delete(k);
  if (hits.size > MAX_KEYS) {
    let n = 0;
    for (const k of hits.keys()) { hits.delete(k); if (++n >= MAX_KEYS / 2) break; }
  }
}

// Count one ask. Returns true when this caller is OVER the cap and the note must not be sent.
export function overLimit(hits: Hits, key: string, nowMs: number): boolean {
  sweep(hits, nowMs);
  const cur = hits.get(key);
  if (!cur || cur.resetAt <= nowMs) {
    hits.set(key, { n: 1, resetAt: nowMs + WINDOW_MS });
    return false;
  }
  cur.n += 1;
  return cur.n > MAX_PER_WINDOW;
}

// ★★★ THE LAST ADDRESS IN `x-forwarded-for`, NOT THE FIRST (v585). ⚠️⚠️ A standard proxy APPENDS the address
// it saw, so the FIRST entry is whatever the caller wrote — ⚠️ **a script rotating a made-up first entry got
// unlimited notes (and unlimited emails on her Resend bill).** ⭐ The LAST entry is the one the nearest proxy
// observed, which a caller cannot choose. ⚠️ A single-value header is unchanged: first and last are the same.
// ⚠️ When there is none the caller shares one bucket — that can only make the cap STRICTER, never looser.
export function callerKey(headers: { get(name: string): string | null }): string {
  const fwd = String(headers.get("x-forwarded-for") || "");
  const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  return last || "unknown";
}
