// supabase/functions/shop-geocode/geocode.ts — the same lookup the bakery's app
// makes, for a page that is open to the public (v202, 26 Sep 2026).
//
// WHY THIS IS A COPY OF ../courier/geocode.ts RATHER THAN AN IMPORT OF IT. A Supabase
// Edge Function is deployed as its own bundle, so one function cannot reach into
// another's directory at deploy time; the alternative — a `_shared/` module both
// import — would mean editing the courier function that is right now deployed and
// working with nothing owed on it, to serve a page nobody has ordered from yet. So
// the rules are duplicated deliberately, and `test/shop-geocode.test.js` drives BOTH
// files side by side with the same stubbed network and fails the moment they stop
// finding the same doors. A copy nobody compares is how the country filter, the
// longitude-first read or the service order would quietly diverge.
//
// WHAT DIFFERS, AND WHY IT HAS TO. The courier's version returns prose — "That address
// was not found. Put the pin on the map instead." — because the only reader is the
// baker's own app, in English. The reader here is a customer who may be reading the
// page in 中文 or Bahasa Malaysia, so this file answers with a CODE ("notfound") and
// the shop chooses the sentence in the customer's own language (store-lang.js). A
// sentence chosen on the server is a sentence nobody can translate.
//
// Everything else is the courier's own reasoning, and it is worth reading there in
// full (../courier/geocode.ts). In short: Photon is asked FIRST because Nominatim's
// usage policy turns away callers it cannot identify, and it did exactly that twice
// for an ordinary Penang address; Nominatim is kept as the second ask because it is
// the better-resourced index and the barrier may lift. Both are asked for Malaysian
// answers only, so a same-named street in another country is never handed back as a
// customer's door. A miss is a normal answer, not an error anybody has to understand.
//
// GOOGLE GOES FIRST WHEN A KEY IS SET (v212), for the reason the courier's header gives
// at length: OpenStreetMap holds roads rather than Malaysian house numbers, so the shop
// could only ever answer a customer with the middle of their street. The free pair stay
// behind Google as the fallback, which is what keeps a missing or refused key from
// becoming a shop that cannot look anything up at all.

import { validPoint } from "./place.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";
// Google's geocoding endpoint, asked server-to-server with the key in the query. It is
// separate from the Maps JavaScript API on purpose: this returns a POINT for an address,
// which is the whole of what a customer's pin needs, and it is the one Google product
// whose free allowance (10,000 calls a month) a shop this size will not reach.
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

// Who is asking, in the form the services' usage policies require: a real name and a
// contact route, so a misbehaving caller is traceable rather than turned away. It
// names the SHOP rather than the courier function because they are two different
// callers, and a service that decides to slow one of them down should not take the
// bakery's own address lookups with it.
const USER_AGENT = "MunchiesFurkidz-Shop/1.0 (+https://munchies.com.my)";

const COUNTRY = "MY";

// How many candidates travel back to the phone. Also asked of the services in their
// own URLs and enforced again in the readers, because it is a promise about how long a
// list a customer has to read rather than a property of any one service's reply.
export const MAX_PLACES = 5;

// One candidate door. The same three fields a saved door has, so the shop can hand it
// to its own validPin with nothing in between knowing it came from a geocoder.
export type Place = { lat: number; lng: number; label: string };

// Why a lookup produced nothing. These are CODES, not sentences — see the header.
export type Why = "empty" | "notfound" | "refused" | "timeout" | "unreachable";

export type Lookup =
  | { ok: true; places: Place[] }
  | { ok: false; why: Why };

// Read Nominatim's reply into every place it offers, in the order it offered them.
// Kept exported for the same reason the courier's is: a reply read wrongly here is a
// pin in the wrong state put in front of a customer as a fact.
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
    // A row with no usable point is skipped rather than ending the read: the next row
    // down the list may be the right house, and stopping at a broken one would throw
    // it away for nothing.
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

// Read Photon's reply into every place it offers, in the order it offered them. This
// one needs the tests more than the other: Photon answers with GeoJSON, whose
// coordinates are LONGITUDE FIRST — the opposite order to every other point in this
// app. A reader that took them as written would put the customer in the Indian Ocean
// and show the numbers as a fact, so the swap happens here, once, where a test can see
// it.
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
// place presented to a customer as a fact.
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

// One ask, and what came back. Three outcomes are told apart because they become
// different words on the customer's screen: a service that answered but did not know
// the address is a MISS and nothing to complain about; a service that answered with an
// error, or did not answer at all, is a refusal worth its own sentence.
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
      console.error(`[shop-geocode] ${service.name} answered HTTP ${res.status}`);
      return { status: res.status };
    }
    const data = await res.json().catch(() => null);
    // Asked BEFORE the reader, because a body that says the request was refused has no
    // places to read and reading it first would only find an empty list that looks like a
    // miss. Logged rather than silent: this is the line that says, from the function's own
    // log, that the key is wrong or the quota is spent rather than the address not being
    // found.
    if (service.trouble && service.trouble(data)) {
      console.error(`[shop-geocode] ${service.name} refused the request — check the key and its quota`);
      return { refusal: true };
    }
    const places = service.read(data);
    // Which service did the work, and how much of it there was, said out loud. It is
    // the only way to tell from the log whether the first ask or the second one is
    // earning its place.
    if (places.length) {
      console.log(`[shop-geocode] ${service.name} found ${places.length} candidate${places.length === 1 ? "" : "s"}`);
    }
    return { replied: true, places };
  } catch (err) {
    console.error(`[shop-geocode] ${service.name} failed:`, (err as Error)?.message || err);
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
  // Asked for as many as Photon is: one press, one ask either way, so this costs
  // nothing and means the second service still offers a choice rather than a single
  // take-it-or-leave-it point. This is not the autocomplete Nominatim's policy turns
  // away — the shop sends nothing at all until typing has stopped, and what it sends
  // is a whole address.
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
// in their queries — a same-named street abroad must not come back as a customer's door.
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

// The same door offered twice, collapsed to once. A list a customer has to read should
// not spend two of its five rows on one answer, and it happens for a real reason: a
// house written with and without its street name is two rows to the service and one
// door to them. The label is the ONLY thing compared, and an empty one is never
// collapsed — every unlabelled candidate has the same words, which says nothing about
// whether they are the same place.
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

// The whole lookup. `timeoutMs` is per ask and deliberately half of what the shop's own
// patience is, so two asks cannot together outrun the caller waiting on them: a phone
// that gave up on a lookup still working would read a message describing the wrong
// problem entirely.
//
// WITH A THIRD SERVICE THE PATIENCE IS SPLIT RATHER THAN REPEATED (v212). Five
// seconds each is right for two asks and would be fifteen for three — the caller's
// whole budget spent on hangs, which is the failure this number exists to prevent. A
// caller that names its own timeout still gets exactly that, which is how the tests
// drive a hang to its end in twenty milliseconds.
export async function lookupAddress(
  address: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<Lookup> {
  const q = String(address || "").trim();
  if (!q) return { ok: false, why: "empty" };

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
    if (places.length) return { ok: true, places };
    if (out.replied) missed = true;
    else if (out.status != null || out.refusal) refused = true;
    else if (out.aborted) timedOut = true;
    else unreachable = true;
  }

  // Not logged as an error: not finding a house is the expected outcome often enough
  // that treating it as a fault would bury the real ones.
  if (missed) return { ok: false, why: "notfound" };
  if (refused) return { ok: false, why: "refused" };
  if (timedOut) return { ok: false, why: "timeout" };
  if (unreachable) return { ok: false, why: "unreachable" };
  return { ok: false, why: "refused" };
}
