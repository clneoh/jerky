// supabase/functions/courier/geocode.ts — turning her typed address into a point
// (25 Sep 2026; a second service added the same day, see below).
//
// WHY THE SERVER ASKS, AND NOT THE PHONE. Two reasons, and the first is the one
// that matters:
//
//   • A browser call to a public geocoder carries her CUSTOMER'S HOME ADDRESS out
//     of the app under the customer's own IP, with no way to say who is asking. The
//     server asks once, with a name and a contact, which is what the service's own
//     usage policy requires and what makes the request answerable if it is ever
//     questioned.
//   • The address is the only thing needed, so there is nothing here for the phone
//     to hold on to.
//
// TWO SERVICES, AND THE ORDER IS NOT ARBITRARY. Nominatim — OpenStreetMap's own
// geocoder — was the only one here until 25 Sep 2026, when it answered this function
// with an HTTP error, twice in a row, for an ordinary Penang address it is perfectly
// able to find. Its policy is the likely reason, and it is a fair one: it asks every
// caller to identify itself, and it turns away callers it cannot account for. THIS
// FUNCTION DOES SEND A NAME — a real one, with a contact route, as the policy asks
// (USER_AGENT below). Whether that name arrives is not something this code can see:
// the request leaves through a shared edge runtime, and the service's answer is the
// only report of what it received. Two identical refusals for an address the service
// demonstrably knows is what settled it: this is not a transient fault to retry, and
// it is not a question for the code to argue over.
//
// So a second service is asked FIRST rather than the first one being asked harder.
// Photon is built from the same OpenStreetMap data, needs no key, and asks nothing of
// the caller beyond the question itself — which is what a shared runtime can actually
// provide. Nominatim is kept as the second ask rather than deleted: it is the
// better-resourced index, and if the barrier that turned it away ever lifts it is
// already in the queue. The first service that answers with a place wins, so in
// normal use only ONE of them ever sees an address.
//
// AND A THIRD SERVICE IS NOW ASKED FIRST (v212). A baker in Penang kept telling us the
// pin would not sit on the house, and she was right, and the reason is the DATA rather
// than the code: OpenStreetMap holds roads, and a scattering of buildings, and for most
// Malaysian terrace houses it holds no house number at all. Photon and Nominatim are both
// built from it, so the best either can answer for "23 Jalan Seang Tek" is the middle of
// Jalan Seang Tek — and they answer it in the same tone they would use for a house. No
// amount of re-ranking or re-reading fixes that; the number is not in the file.
//
// Google's geocoder is a different index and it does hold house-level points here. It is
// asked FIRST when a key is configured, and the free pair are kept behind it as the
// fallback — the same shape as Nominatim behind Photon. Two properties of that are worth
// stating plainly:
//
//   • NOTHING BREAKS BEFORE THE KEY EXISTS. With no key set, `servicesFor()` simply does
//     not put Google in the queue and the lookup behaves exactly as it did at v211. The
//     feature is dormant, never half-on.
//   • A GOOGLE THAT WILL NOT ANSWER FALLS THROUGH, it does not replace the answer. A
//     refused key, a spent quota, a bad request — every one of those means "ask the free
//     pair next", not "tell her nothing". The worst case of Google being unreachable is
//     the v211 behaviour, and that is deliberate.
//
// The key itself lives in this function's own secrets (GOOGLE_GEOCODING_KEY) and never
// leaves the server; the browser is never told it, and no phone ever holds it. See the
// header of ../shop-geocode/index.ts for why the shop's copy carries one too and what
// stands in front of it.

// AND AN ANSWER IS A LIST, NOT A POINT (v198). Both services reply with several
// candidates and this file used to keep only the first, so four good matches died in
// here on every lookup and she had to notice the pin was wrong and drag it. They are
// all carried back now and the app offers them to her — MAX_PLACES below is how many,
// and admin/js/place_map.js is the list she actually reads.
//
// A MISS IS A NORMAL ANSWER. A house in a new Penang estate may simply not be in
// OpenStreetMap, and when it is not, the honest reply is "put the pin on the map
// instead" — which is exactly what she chose. It is never an error she has to
// understand.

import { validPoint } from "./place.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";
// Google's geocoding endpoint, asked server-to-server with the key in the query. It is
// separate from the Maps JavaScript API on purpose: this returns a POINT for an address,
// which is the whole of what the pin needs, and it is the one Google product whose free
// allowance (10,000 calls a month) a bakery this size will not reach.
const GOOGLE = "https://maps.googleapis.com/maps/api/geocode/json";

// The name of the secret the key is read from. Read fresh on every lookup rather than
// captured at module load, for the reason ../courier/index.ts gives about LALAMOVE_ENV:
// a value fixed when the instance first woke would need a redeploy to change, and
// setting a secret is supposed to need none.
const GOOGLE_KEY_ENV = "GOOGLE_GEOCODING_KEY";

// `Deno.env` exists in the edge runtime and NOT under Node, where the tests import this
// file directly. Reaching for it through `globalThis` rather than by name means the file
// still runs under Node (finding no key, which is exactly right there) instead of dying
// on a ReferenceError the moment a test calls the lookup. The tests set `globalThis.Deno`
// to hand it a key, which is the only way a key can get in here without one existing.
function envOf(name: string): string {
  const d = (globalThis as Record<string, unknown>).Deno as
    { env?: { get?: (n: string) => string | undefined } } | undefined;
  const got = d && d.env && typeof d.env.get === "function" ? d.env.get(name) : undefined;
  return String(got == null ? "" : got).trim();
}

// Nominatim's policy asks for a real identifier with a contact route. This is that,
// and it also means a misbehaving caller is traceable rather than blocked outright.
const USER_AGENT = "MunchiesFurkidz-Courier/1.0 (+https://munchies.com.my)";

// The address is hers to deliver to, and she is in Penang. Both services are asked
// for Malaysian answers only, so a same-named street in another country cannot be
// handed back as her customer's door — Nominatim filters by `countrycodes=my` in the
// query, and Photon's replies are filtered on the way in (see below).
const COUNTRY = "MY";

// How many candidates are carried back for her to choose between. It is asked of the
// services in their URLs and enforced again here, because it is a promise the app makes
// about how long a list she has to read, not a property of any one service's reply.
const MAX_PLACES = 5;

// One candidate door. The same three fields a saved door has, so a candidate can be
// handed to the app's own validPlace and then to setDropPlace with nothing in between
// knowing it came from a geocoder.
type Place = { lat: number; lng: number; label: string };

// Read Nominatim's reply into every place it offers, in the order it offered them.
// Exported so the parsing is Node-tested without a network: a reply read wrongly here
// is a pin in the wrong state shown to her as a fact.
export function placesFromResults(data: unknown): Place[] {
  const list = Array.isArray(data) ? data : [];
  const out: Place[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    // Nominatim spells longitude `lon`; the app spells it `lng`. Both are read, and
    // whichever is there goes through the same rule as everywhere else — see place.ts
    // for why `Number(r.lat)` on its own is not good enough.
    const spot = validPoint({ lat: r.lat, lng: r.lon != null ? r.lon : r.lng });
    // A row with no usable point is skipped rather than ending the read, which is what
    // Photon's reader has always done: the next row down the list may be the right
    // house, and stopping at a broken one would throw it away for nothing.
    if (!spot) continue;
    out.push({ lat: spot.lat, lng: spot.lng, label: String(r.display_name || "").trim() });
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

// The words a Photon result wears on the pin. It sends no ready-made label the way
// Nominatim does, so one is composed from the parts it does send — street, then town,
// then postcode — and every part is optional.
//
// THE HOUSE NUMBER IS KEPT (v212). This used to read `p.name` alone, and for a building
// result Photon sends the number in `housenumber` and the road in `street`, leaving
// `name` to the road's own name — so a result that HAD found number 23 was labelled
// "Jalan Seang Tek, George Town, 10400", which is the road's name for a point that may
// well be the house. The door then read as a road it was not, and v211's own warning
// fired on an answer that had in fact found the house. A number and a street, when both
// are there, are the address; `name` is the fallback for everything else (a POI, a
// village, a road with no number), which is what it was always doing.
function photonLabel(p: Record<string, unknown>): string {
  const part = (v: unknown) => String(v == null ? "" : v).trim();
  const house = part(p.housenumber);
  const street = part(p.street);
  const first = [house, street].filter(Boolean).join(" ") || part(p.name);
  return [first, p.city || p.district || p.locality, p.postcode]
    .map(part)
    .filter(Boolean)
    .join(", ");
}

// Read Photon's reply into every place it offers, in the order it offered them.
// Exported for the same reason as the reader above, and it needs the tests more:
// Photon answers with GeoJSON, whose coordinates are LONGITUDE FIRST — the opposite
// order to every other point in this app. A reader that took them in the order they
// are written would put her customer in the Indian Ocean and show the numbers as a
// fact, so the swap happens here, once, where a test can see it.
export function placesFromPhoton(data: unknown): Place[] {
  const features = (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).features))
    ? (data as Record<string, unknown>).features as unknown[]
    : [];
  const out: Place[] = [];
  for (const raw of features) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const p = (f.properties && typeof f.properties === "object")
      ? f.properties as Record<string, unknown>
      : {};
    // Malaysia only, which is what the other service's query asks for too. A feature
    // from anywhere else is skipped rather than refused, because the next result in
    // the list may be the right one.
    if (String(p.countrycode || "").toUpperCase() !== COUNTRY) continue;
    const geom = (f.geometry && typeof f.geometry === "object") ? f.geometry as Record<string, unknown> : {};
    const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
    const spot = validPoint({ lat: coords[1], lng: coords[0] });
    if (!spot) continue;
    out.push({ lat: spot.lat, lng: spot.lng, label: photonLabel(p) });
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

// Read Google's reply into every place it offers, in the order it offered them. Exported
// for the same reason as the two above: a reply read wrongly here is a pin in the wrong
// place presented to her as a fact.
//
// TWO THINGS THIS READER DOES NOT HAVE TO WORRY ABOUT, and they are worth saying because
// every other reader in this feature does. Google names its coordinates (`lat` and `lng`,
// spelled out) so there is no longitude-first trap to spring; and it hands back a finished
// `formatted_address`, so no label has to be composed here. That label is the one Google
// itself would print — "23, Jalan Seang Tek, 10400 George Town, Pulau Pinang, Malaysia" —
// which contains the house number whenever Google knows it, and that is the point of
// asking Google at all.
export function placesFromGoogle(data: unknown): Place[] {
  const body = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const list = Array.isArray(body.results) ? body.results : [];
  const out: Place[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const geom = (r.geometry && typeof r.geometry === "object") ? r.geometry as Record<string, unknown> : {};
    const loc = (geom.location && typeof geom.location === "object") ? geom.location as Record<string, unknown> : {};
    const spot = validPoint({ lat: loc.lat, lng: loc.lng });
    if (!spot) continue;
    out.push({ lat: spot.lat, lng: spot.lng, label: String(r.formatted_address || "").trim() });
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

// Whether a Google reply is the service failing rather than the address being unknown.
// Google answers HTTP 200 either way and puts the verdict in the body, so a refusal would
// otherwise read as an ordinary miss — "that address was not found" for an address the
// service never actually looked for, which is a lie told in the one sentence whose whole
// job is to be honest about not knowing.
//
// OK and ZERO_RESULTS are the two healthy answers: the first found something, the second
// is the normal miss. Everything else — a rejected key (REQUEST_DENIED), a spent quota
// (OVER_QUERY_LIMIT, OVER_DAILY_LIMIT), a malformed ask (INVALID_REQUEST), a Google-side
// fault (UNKNOWN_ERROR) — is the service not doing its job, and every one of them makes
// the lookup fall through to the free pair rather than stop.
export function googleTrouble(data: unknown): boolean {
  const status = ((data && typeof data === "object")
    ? String((data as Record<string, unknown>).status || "")
    : "").trim().toUpperCase();
  return status !== "" && status !== "OK" && status !== "ZERO_RESULTS";
}

// One ask, and what came back. Three outcomes are told apart because the words she
// ends up reading are chosen from them: a service that answered but did not know the
// address is a MISS, and nothing to complain about; a service that answered with an
// error, or did not answer at all, is a refusal, and worth a distinct sentence.
type AskOutcome = {
  replied?: boolean;
  status?: number;
  aborted?: boolean;
  // The service answered, and the answer was that it could not do the job — a rejected
  // key, a spent quota. Told apart from a MISS because they are different facts about the
  // world: one says the house is not in the index, the other says nobody looked.
  refusal?: boolean;
  places?: Place[];
};

// A service in the queue. `trouble` is optional and only Google needs it: the free pair
// report their own failures through the HTTP status, while Google answers 200 and puts
// the verdict in the body.
type Service = {
  name: string;
  url: (q: string) => string;
  headers: Record<string, string>;
  read: (data: unknown) => Place[];
  trouble?: (data: unknown) => boolean;
};

async function ask(
  service: Service,
  q: string,
  timeoutMs: number,
): Promise<AskOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(service.url(q), { headers: service.headers, signal: controller.signal });
    if (!res.ok) {
      console.error(`[courier] ${service.name} answered HTTP ${res.status}`);
      return { status: res.status };
    }
    const data = await res.json().catch(() => null);
    // Asked BEFORE the reader, because a body that says the request was refused has no
    // places to read and reading it first would only find an empty list that looks like a
    // miss. Logged rather than silent: this is the line that tells her, from the function's
    // own log, that the key is wrong or the quota is spent rather than the address not
    // being found.
    if (service.trouble && service.trouble(data)) {
      console.error(`[courier] ${service.name} refused the request — check the key and its quota`);
      return { refusal: true };
    }
    const places = service.read(data);
    // Which service did the work, and how much of it there was, said out loud. One
    // line per lookup, and it is the only way to tell from the log whether the first
    // ask or the second one is the one earning its place — and whether either of them
    // is handing back a list too short to be worth choosing from.
    if (places.length) {
      console.log(`[courier] ${service.name} found ${places.length} candidate${places.length === 1 ? "" : "s"}`);
    }
    return { replied: true, places };
  } catch (err) {
    console.error(`[courier] ${service.name} failed:`, (err as Error)?.message || err);
    return { aborted: (err as Error)?.name === "AbortError" };
  } finally {
    clearTimeout(timer);
  }
}

const PHOTON_SERVICE: Service = {
  name: "photon",
  url: (q: string) => `${PHOTON}?q=${encodeURIComponent(q)}&limit=${MAX_PLACES}&lang=en`,
  headers: { "Accept-Language": "en" },
  read: placesFromPhoton,
};

const NOMINATIM_SERVICE: Service = {
  name: "nominatim",
  // Asked for as many as Photon is. The request count is identical either way — one
  // press, one ask — so this costs nothing and means the second service, which only
  // runs when the first one is down, still offers her a choice rather than a single
  // take-it-or-leave-it point. This is not the autocomplete Nominatim's policy turns
  // away: nothing is sent until she presses the button, and it carries a full address.
  url: (q: string) => `${NOMINATIM}?format=jsonv2&limit=${MAX_PLACES}&countrycodes=my&addressdetails=0&q=${encodeURIComponent(q)}`,
  headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  read: placesFromResults,
};

// The queue, in the order it is asked. Built per lookup rather than fixed at module load
// so that setting the secret takes effect on the next press with no redeploy — the same
// reason LALAMOVE_ENV is read fresh in ../courier/index.ts.
//
// GOOGLE GOES FIRST WHEN THERE IS A KEY, and the free pair keep their order behind it.
// That is a statement about the DATA, not about the companies: it is the only one of the
// three that holds Malaysian house numbers, so asking it second would mean paying for the
// good answer and then not using it. With no key set the queue is exactly what it was
// before this version, which is what makes the change safe to ship ahead of the account.
// `components=country:MY` is this service's spelling of the filter the other two are given
// in their queries — a same-named street abroad must not come back as her customer's door.
function servicesFor(): Service[] {
  const key = envOf(GOOGLE_KEY_ENV);
  const queue: Service[] = [];
  if (key) {
    queue.push({
      name: "google",
      url: (q: string) => `${GOOGLE}?address=${encodeURIComponent(q)}&components=country:MY&language=en&key=${encodeURIComponent(key)}`,
      headers: {},
      read: placesFromGoogle,
      trouble: googleTrouble,
    });
  }
  queue.push(PHOTON_SERVICE, NOMINATIM_SERVICE);
  return queue;
}

// The same door offered twice, collapsed to once. A list she has to read should not
// spend two of its five rows on one answer, and it happens for a real reason: a house
// written with and without its street name is two rows to the service and one door to
// her. The label is the ONLY thing compared, and an empty one is never collapsed —
// every candidate with no label has the same words, which says nothing about whether
// they are the same place. Two genuinely different doors wearing identical words are a
// problem no comparison can solve, and the map is one tap away.
//
// This can only SHORTEN a list, never lengthen one: MAX_PLACES is enforced by the two
// readers as they collect, so a cap here would be a guard that can never fire.
function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const p of places) {
    const key = String(p.label || "").trim().toLowerCase();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(p);
  }
  return out;
}

export async function geocodeAddress(
  address: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; place?: Place; places?: Place[]; reason?: string }> {
  const q = String(address || "").trim();
  if (!q) return { ok: false, reason: "There is no address to look up." };

  // The per-ask timeout is deliberately half of what it was when there was one
  // service. The app gives this call fifteen seconds in total, and two asks that
  // could each run to twelve would overrun it — the phone would give up on a lookup
  // that was still working, and the message she read would describe the wrong
  // problem entirely.
  //
  // WITH A THIRD SERVICE THE PATIENCE IS SPLIT RATHER THAN REPEATED (v212). Five
  // seconds each is right for two asks and would be fifteen for three — the caller's
  // whole budget spent on hangs, which is the failure this number exists to prevent.
  // A caller that names its own timeout still gets exactly that, which is how the tests
  // drive a hang to its end in twenty milliseconds.
  const queue = servicesFor();
  const perAsk = timeoutMs == null
    ? (queue.length > 2 ? Math.floor(12000 / queue.length) : 5000)
    : timeoutMs;

  let missed = false;
  let refused = false;
  let timedOut = false;
  let unreachable = false;

  for (const service of queue) {
    const out = await ask(service, q, perAsk);
    const places = dedupe(out.places || []);
    // `place` is kept beside the list because two of the three callers want one answer
    // and not a choice: the quote card is asking what a trip costs, and the delivery
    // run is placing every unplaced customer in a loop that cannot ask a question per
    // address. It is always the first of the list, so the two can never disagree.
    if (places.length) return { ok: true, place: places[0], places };
    if (out.replied) missed = true;
    else if (out.status != null || out.refusal) refused = true;
    else if (out.aborted) timedOut = true;
    else unreachable = true;
  }

  // Not logged as an error: not finding a house is the expected outcome often enough
  // that treating it as a fault would bury the real ones.
  if (missed) return { ok: false, reason: "That address was not found. Put the pin on the map instead." };
  if (refused) return { ok: false, reason: "The address lookup service did not answer. Put the pin on the map instead." };
  if (timedOut) return { ok: false, reason: "The address lookup service did not answer in time. Put the pin on the map instead." };
  if (unreachable) return { ok: false, reason: "The address lookup service could not be reached. Put the pin on the map instead." };
  return { ok: false, reason: "The address lookup service did not answer. Put the pin on the map instead." };
}
