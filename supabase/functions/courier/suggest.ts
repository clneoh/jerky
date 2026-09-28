// supabase/functions/courier/suggest.ts — Google's address SUGGESTIONS as she types (v228).
//
// WHY THIS IS NOT geocode.ts. That file answers "where is this address?" from a COMPLETE
// address she has already finished typing, and it exists to put a pin on a map. This one
// answers "what might she be typing?" from a PARTIAL one, and it exists to save her
// thumb. They are different Google products with different endpoints, different billing
// and different failure modes, which is why they are separate files rather than one.
//
// THE KEY GOES IN A HEADER, NOT THE URL, and that is a deliberate difference from
// geocode.ts, which spells its key `&key=…` in the query string. A URL turns up in
// access logs, in error reports and in anything that echoes a failed request back;
// Places API (New) accepts the key as a header, so it is given as one. A test asserts it,
// because a header that quietly drifts back into the URL is invisible on screen.
//
// THE KEY IS THE SAME SECRET GEOCODING USES, on purpose. One Google key now answers two
// capped APIs rather than two keys answering one each — she already has the secret set,
// and a second key would be a second thing to create and set for a separation nothing
// here needs. If they are ever split onto separate keys, this constant is the only line
// that moves. If she renames the key in the console, nothing here changes at all.
//
// NO SESSION TOKENS, AND THAT IS THE DESIGN. Google's session pricing makes the
// autocomplete calls inside a session free ONLY when the session is closed by an Address
// Validation call or a Place Details call above the Essentials tier — both of which cost
// roughly ten times more per call and carry a smaller free allowance than the autocomplete
// they would be discounting. Sessions only pay off above 10,000 autocomplete calls a
// month, which a bakery this size will not reach, so this fires plain Autocomplete
// requests, reads the prediction's own text, and never calls Place Details at all.
//
// THE FLOOR AND THE CEILING ARE BOTH HERE. A query shorter than MIN_QUERY is not a query:
// a Malaysian house number on its own ("12") matches half a town, so asking would be a
// wasted request and a useless list. A query longer than MAX_QUERY is not a longer
// address, it is a caller seeing what happens.
//
// Pure enough to run under Node: `Deno.env` is reached through `globalThis` (see envOf),
// and nothing here touches the DOM, so the whole file is driven by test/courier-suggest.test.js
// with only `fetch` and a hand-rolled `Deno` stubbed.

// Google's Places API (New) autocomplete endpoint. Note it is `places.googleapis.com`,
// a different host from the `maps.googleapis.com` the geocoder uses — the two products
// are genuinely separate, and pointing one at the other's endpoint is a 404, not a
// wrong answer.
const GOOGLE_PLACES = "https://places.googleapis.com/v1/places:autocomplete";

// The secret the key is read from. Read fresh on every query rather than captured at
// module load, for the reason ../courier/index.ts gives about LALAMOVE_ENV: a value fixed
// when the instance first woke would need a redeploy to change, and setting a secret is
// supposed to need none.
const PLACES_KEY_ENV = "GOOGLE_GEOCODING_KEY";

// What Google is asked to send back, and it must be exact — an unasked-for field is an
// error, not an omission. Spaces are not allowed anywhere in this list. Only the two
// fields a row needs: the words to print and the id that says which place they are.
// Deliberately NOT `placeId`-only (a row with nothing to print) and NOT the full
// `structuredFormat`, which is more words than a suggestion row can wear.
const FIELD_MASK = "suggestions.placePrediction.text.text,suggestions.placePrediction.placeId";

// She is in Penang and delivers in Malaysia, so Google is asked for Malaysian answers
// only — a same-named street abroad must not come back as her customer's door. Setting
// this also has a second effect Google documents: query predictions, which are search
// strings rather than addresses, are not returned when a region filter is set. That is
// exactly what is wanted here, so the filter earns its place twice.
const REGION = "my";

// The words Google is asked to answer in. The same `en` the geocoder asks for, so an
// address this fills in reads like the one that lookup produces.
const LANGUAGE = "en";

// A query shorter than this is not worth asking about. Four rather than one or two
// because a Malaysian house number alone ("12") matches half a town; four characters
// starts to carry street information, which is where a suggestion becomes useful rather
// than noise.
export const MIN_QUERY = 4;

// Past this it is not a longer address, it is a caller seeing what happens — and it
// becomes a JSON body on the way out. A real address is far under this and never notices.
export const MAX_QUERY = 160;

// How many rows are carried back. It is asked of Google in the field mask and enforced
// again here, because it is a promise the app makes about how long a list she has to
// read, not a property of Google's reply.
export const MAX_SUGGESTIONS = 5;

// A suggestion row never needs four seconds. This is deliberately far shorter than the
// geocoder's 15s: a lookup she pressed a button for is worth waiting on, a list that is
// meant to appear while she is still typing is not — by the time this fires she has moved
// on, and a late list appearing under her thumb is worse than no list.
export const PLACES_TIMEOUT_MS = 4000;

// A fence, not an account of anybody's use. Only the signed-in owner can reach this
// function at all (../courier/index.ts refuses everything else with a 401), so this is
// not protecting against strangers — it is protecting against HER OWN APP running away:
// a loop, a stuck key, a suggester that lost its pause. A person typing an address fires
// a handful of asks a minute; a loop fires hundreds a second. The gap between those two
// is enormous, so the cap sits in it and costs a real address nothing.
export const MAX_PER_WINDOW = 60;
export const WINDOW_MS = 60000;

// Past this many remembered callers the spent ones are dropped. Without it a caller that
// rotated its identity would grow this map for as long as the instance lives, which is
// the slow leak that only shows up after somebody has been unkind for a while.
const MAX_KEYS = 5000;

// `Deno.env` exists in the edge runtime and NOT under Node, where the tests import this
// file directly. Reaching for it through `globalThis` rather than by name means the file
// still runs under Node (finding no key, which is exactly right there) instead of dying
// on a ReferenceError the moment a test calls it. The tests set `globalThis.Deno` to hand
// it a key, which is the only way a key can get in here without one existing.
function envOf(name: string): string {
  const d = (globalThis as Record<string, unknown>).Deno as
    { env?: { get?: (n: string) => string | undefined } } | undefined;
  const got = d && d.env && typeof d.env.get === "function" ? d.env.get(name) : undefined;
  return String(got == null ? "" : got).trim();
}

// One row of the suggestion list: the words to print, and which place they are. The id is
// carried even though nothing in this version uses it — it is the thing a later version
// would hand to Place Details, and reading it costs nothing because the field mask already
// asked for it.
export type Suggestion = { text: string; placeId: string };

// Read Google's reply into the rows it offers, in the order it offered them. Exported so
// the parsing is Node-tested without a network: a reply read wrongly here is a blank row
// under her thumb.
//
// A row with nothing to print is DROPPED rather than drawn. That is not tidiness: the
// list is built with `replaceChildren`, which turns every argument into a string, so a
// row carrying an empty text would put a tappable, wordless line on screen — the exact
// class of fault that has shipped twice in this app. `queryPrediction` rows are dropped
// for the same reason: they carry a search string, not an address, and setting REGION
// means Google should not be sending them anyway. If one arrives, it is not something to
// hand a delivery address to.
export function suggestionsFrom(data: unknown): Suggestion[] {
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const list = obj && Array.isArray(obj.suggestions) ? obj.suggestions : [];
  const out: Suggestion[] = [];
  for (const raw of list) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const p = s && s.placePrediction;
    if (!p || typeof p !== "object") continue;
    const pred = p as Record<string, unknown>;
    // `text` is an object carrying `{ text, matches }` on the (New) endpoint, and the
    // mask above asks for `.text.text`. A plain string is accepted too rather than
    // rejected: it is what the older shape sends, and reading it costs one branch.
    const rawText = pred.text;
    const text = (rawText && typeof rawText === "object"
      ? String((rawText as Record<string, unknown>).text || "")
      : String(rawText || "")).trim();
    if (!text) continue;
    out.push({ text, placeId: String(pred.placeId || "").trim() });
  }
  return out;
}

// Did Google refuse the request rather than answer it? Places (New) puts a machine-
// readable `error` object on the body, so this is asked BEFORE the reader — a refusal has
// no suggestions to read, and reading it first would find an empty list that looks like
// a miss. Logged rather than silent, because this is the line that says from the
// function's own log whether the key is wrong, the API is not enabled for it, or the
// allowance is spent — three different fixes that all look identical on her phone.
export function placesTrouble(data: unknown): boolean {
  return !!(data && typeof data === "object" && (data as Record<string, unknown>).error);
}

// What the caller gets back: rows to show, or a reason there are none. A MISS (Google
// answered, and knew nothing) and a REFUSAL (Google would not answer) are both
// `ok: true` with an empty list, because to the person typing they are the same thing —
// no suggestions this time — and the app's job is then to say nothing and let her type.
// `ok: false` is reserved for "this was never set up", which is a different sentence.
export type SuggestOutcome = { ok: true; places: Suggestion[] } | { ok: false; reason: string };

// Ask Google what she might be typing. Never throws: every caller is a keystroke on a
// phone in a kitchen, and a thrown error there is a dead screen with no words on it.
export async function suggestAddresses(
  query: string,
  timeoutMs: number = PLACES_TIMEOUT_MS,
): Promise<SuggestOutcome> {
  const q = String(query || "").trim().slice(0, MAX_QUERY);
  // Nothing worth asking. Answered here rather than sent, so a two-letter query costs no
  // request and no allowance — the point the floor exists for.
  if (q.length < MIN_QUERY) return { ok: true, places: [] };

  const key = envOf(PLACES_KEY_ENV);
  // Is is not an error, it is an assist that is switched off — which is why it is a
  // reason on a 200 rather than the 500 the function's contract reserves for a missing
  // secret. A 500 here would reach her as a broken screen; this reaches her as a box that
  // simply does not suggest, which is exactly what it did before this version existed.
  if (!key) return { ok: false, reason: "Address suggestions are not set up on the server yet." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GOOGLE_PLACES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ input: q, includedRegionCodes: [REGION], languageCode: LANGUAGE }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Read for Google's own words before falling back, because "API not enabled on this
      // key" and "quota spent" arrive here as different bodies with the same status.
      const body = await res.json().catch(() => null);
      const said = body && typeof body === "object"
        ? String(((body as Record<string, unknown>).error as Record<string, unknown> | undefined)?.message || "")
        : "";
      console.error(`[courier] places answered HTTP ${res.status}${said ? ` — ${said}` : ""}`);
      return { ok: false, reason: "The address suggester did not answer just now." };
    }
    const data = await res.json().catch(() => null);
    if (placesTrouble(data)) {
      console.error("[courier] places refused the request — check the key, its API restriction and its quota");
      return { ok: false, reason: "The address suggester did not answer just now." };
    }
    return { ok: true, places: suggestionsFrom(data) };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    console.error(`[courier] places ${aborted ? "timed out" : "failed"}:`, (err as Error)?.message || err);
    return { ok: false, reason: aborted ? "The address suggester took too long." : "The address suggester could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

// Forget every window that has already closed. Called when the map has grown past
// MAX_KEYS rather than on a timer, so there is nothing here that has to be started,
// stopped or remembered.
export function sweepHits(hits: Map<string, HitRecord>, nowMs: number): void {
  for (const [key, rec] of hits) if (nowMs >= rec.resetAt) hits.delete(key);
}

export type HitRecord = { count: number; resetAt: number };

// May this caller ask now? Counts the ask when it says yes, so the caller does not have
// to remember to. An absent or unreadable identity is counted under one shared name
// rather than waved through: an unknown caller is not a licence to be unlimited.
//
// Pure on purpose — no Deno, no request, no clock of its own — so `nowMs` is passed in
// and the whole thing is driven under Node.
export function allowSuggestion(
  hits: Map<string, HitRecord>,
  who: string,
  nowMs: number,
  { max = MAX_PER_WINDOW, windowMs = WINDOW_MS }: { max?: number; windowMs?: number } = {},
): boolean {
  if (hits.size > MAX_KEYS) sweepHits(hits, nowMs);

  const key = String(who || "").trim() || "unknown";
  const rec = hits.get(key);
  // A window that has closed is not a record of anything: it starts again, which is also
  // what lets her carry on a minute after tripping the cap.
  if (!rec || nowMs >= rec.resetAt) {
    hits.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  if (rec.count >= max) return false;
  rec.count += 1;
  return true;
}
