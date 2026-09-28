// supabase/functions/courier/providers/lalamove.ts — the signing half of Lalamove
// (25 Sep 2026).
//
// The client half (admin/js/couriers/lalamove.js) shapes a trip in the app's own
// words; this half turns it into Lalamove's words, signs it with the secret, and
// turns Lalamove's answer back. Nothing above this file knows that the api key and
// the secret exist, which is the point: they are read from the function's
// environment and never leave the server.
//
// ── BEFORE THE FIRST REAL CALL, CONFIRM THESE TWO AGAINST THE SANDBOX ──────
//
// The booking flow is documented publicly, but two details are not stated
// unambiguously in the developer pages, and each is a one-line change once the
// sandbox answers. They are named here rather than discovered one at a time:
//
//   1. STOP GEOMETRY. v3 is documented with `stops[].coordinates: { lat, lng }`,
//      with the numbers as STRINGS. If the sandbox answers ERR_INVALID_STOPS or
//      ignores the point, the older spelling is `location`.
//   2. WHETHER `distance` COMES BACK AS A VALUE WITH A UNIT (the client reads both
//      shapes, so this one is cosmetic).
//
// Two more used to be on this list and are settled. THE ENVELOPE is real and is not
// a style choice — see `envelope()` below, which v188 shipped without and v189 put
// right. And THE PHONE FORMAT is E.164 with a leading `+`, which booking now sends;
// the app's own numbers are stored without one, so the plus is added at the door.

import { signRequest } from "../sign.mjs";

export const LALAMOVE_KEY = "lalamove";

// Its name for anything a person reads. The dispatcher used to write "Lalamove" into
// a refusal sentence by hand, which is the same fault the Settings card carried on the
// app's side of the seam: a message naming the courier that does not come from the
// courier. A second provider adding its own file should never have to find and edit
// the dispatcher's sentences.
export const LALAMOVE_LABEL = "Lalamove";

// Sandbox and production are separate hosts with separate, environment-prefixed
// keys (pk_test_ / sk_test_ against pk_prod_ / sk_prod_). Which one is in use is a
// SECRET, not a build — so the same app can be pointed at the sandbox for a trial
// run and at production for a real one without a release.
const HOSTS: Record<string, string> = {
  sandbox: "https://rest.sandbox.lalamove.com",
  production: "https://rest.lalamove.com",
};

export function hostFor(env: unknown): string {
  return HOSTS[String(env || "").trim().toLowerCase()] || HOSTS.sandbox;
}

export type LlmConfig = { key: string; secret: string; market: string; host: string };

// ── the envelope, which is not a style choice ──────────────────────────────
//
// Lalamove wraps EVERYTHING in a top-level `data`: the body it is given and the
// body it answers with. It says so itself, in the error it returns when the wrapper
// is missing — ERR_INSUFFICIENT_STOPS reads "Number of stops are less than 2 OR the
// request body structure is incorrect. I.e: {data: {...}}". An unwrapped body is not
// quietly accepted, it is refused as malformed.
//
// v188 shipped with the quotation unwrapped on BOTH halves and nothing could have
// caught it: the app had no key, so no price was ever really asked for, and a test
// can only assert the shape its author already believed. It was found in v189 by
// reading Lalamove's reference against the call as built. So both halves are fixed
// here, once, rather than read around elsewhere: the request is wrapped by
// `envelope()` and every reply is unwrapped by `unwrap()` below, which means
// everything above this file reads ONE shape and the client's normalisers stay as
// they were written.
export function envelope(body: unknown): Record<string, unknown> {
  return { data: body };
}

// The inside of Lalamove's envelope. A reply that carries no `data` key is passed
// through untouched rather than turned into `undefined`: an answer that is not
// wrapped is a shape this file does not recognise, and handing the reader `undefined`
// for it would read downstream as "the courier said nothing" instead of "this is not
// the reply that was expected".
export function unwrap(data: unknown): unknown {
  const body = (data && typeof data === "object") ? data as Record<string, unknown> : null;
  return body && "data" in body ? body.data : data;
}

// The errors worth their own sentence, because the API's own words for them are
// codes. Anything not on this list is passed through in the API's own wording
// underneath a plain first line, so an unanticipated failure is still readable.
const PLAIN_ERRORS: Record<string, string> = {
  ERR_REVERSE_GEOCODE_FAILURE: "Lalamove could not place one of these addresses — put the pin on the map instead of typing it.",
  ERR_INVALID_SERVICE_TYPE: "Lalamove does not run that vehicle in this market.",
  ERR_QUOTATION_EXPIRED: "That price is more than five minutes old — ask for a fresh one.",
  ERR_QUOTATION_NOT_FOUND: "That price is no longer on Lalamove's side — ask for a fresh one.",
  ERR_INSUFFICIENT_CREDIT: "There is not enough money in the Lalamove wallet for this trip.",
  ERR_INSUFFICIENT_BALANCE: "There is not enough money in the Lalamove wallet for this trip.",
  ERR_OUT_OF_SERVICE_AREA: "Lalamove does not cover one of these addresses.",
  ERR_INVALID_PHONE_NUMBER: "Lalamove would not accept a phone number on this trip — check the customer's number.",
  ERR_CANCELLATION_FORBIDDEN: "Lalamove will not let this trip be cancelled any more.",
  ERR_INVALID_STOPS: "Lalamove would not accept one of the stops on this trip.",
  ERR_TOO_MANY_STOPS: "Lalamove will not carry this many drops on one trip.",
  ERR_INVALID_SCHEDULE_TIME: "Lalamove would not accept that pickup time — it must be at least two hours from now, and no more than thirty days ahead.",
  ERR_INVALID_QUOTATION_ID: "That price is no longer on Lalamove's side — ask for a fresh one. A price is only good for five minutes, and booking uses the price it was quoted at.",
  // This one arriving means the app built the request wrongly, not that her trip is
  // wrong — it is the error Lalamove returns when the `data` wrapper is missing. Said
  // plainly rather than blamed on her order, because there is nothing she could do
  // about it and the next person reading it needs to know where to look.
  ERR_INSUFFICIENT_STOPS: "Lalamove would not accept the shape of this trip. That is a fault in the app rather than in your order — nothing was booked.",
};

// The API answers a failure as { message, errors: [{ id, code, message }] } with a
// non-2xx status. Both the code and the id are read, because the two have carried
// the code in different releases.
export function plainReason(data: unknown, status: number): string {
  const body = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const errors = Array.isArray(body.errors) ? body.errors as Array<Record<string, unknown>> : [];
  for (const e of errors) {
    const code = String((e && (e.code || e.id)) || "").trim();
    if (code && PLAIN_ERRORS[code]) return PLAIN_ERRORS[code];
  }
  const first = errors.length ? String(errors[0].message || "").trim() : "";
  const message = String(body.message || "").trim();
  const detail = first || message;
  if (status === 401 || status === 403) {
    return "Lalamove refused the key — check the api key and secret in the function's secrets, and whether they are the sandbox pair or the live pair.";
  }
  return detail
    ? `Lalamove would not do that: ${detail}`
    : `Lalamove answered with an error (HTTP ${status}).`;
}

// The other sentence this courier can be refused by, and the one that was WRONG until
// v194. Until then, a key that had never been put on the server and a courier the build
// does not carry were answered with the same words - "this build has no courier called
// lalamove" - because both made configFor() return nothing. That sentence is a claim
// about the app, and it was false: the app was fine and one secret was missing. Measured
// live: she read it on the Settings card, having just deployed the function, and the
// honest cause was that no key existed yet because no Lalamove account existed yet.
//
// The dispatcher cannot write this line itself, because a sentence naming the courier
// has to come from the courier (see the note above courierName in index.ts), so it is
// built here beside plainReason() - both are "what went wrong, in her words".
export function notSetUpReason(): string {
  return `${LALAMOVE_LABEL}'s api key and secret have not been added to the server yet.`;
}

// One signed call. `query` is sent in the URL but deliberately NOT signed — the
// signature covers the path alone, which is what Lalamove verifies.
export async function llmRequest(
  cfg: LlmConfig,
  { method, path, body = null, query = "" }: { method: string; path: string; body?: unknown; query?: string },
): Promise<{ ok: boolean; status: number; data: unknown; reason: string }> {
  const raw = body == null ? "" : JSON.stringify(body);
  const { authorization } = await signRequest({
    key: cfg.key,
    secret: cfg.secret,
    method,
    path,
    body: raw,
  });
  const url = `${cfg.host}${path}${query ? `?${query}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        // The market is a header, not part of the path: MY. Without it Lalamove does
        // not know which country's fleet to price.
        Market: cfg.market,
        // A nonce per request, so a retried call is not mistaken for a duplicate.
        "Request-ID": crypto.randomUUID(),
        "Content-Type": "application/json",
      },
      // A bodyless call sends NO body — not an empty string. GET and DELETE both
      // take none, and an empty string with a JSON content-type is a third thing
      // that a strict server may or may not read as "no body". The signature over
      // an empty body is the same either way, because sign.mjs is given `raw`.
      body: body == null ? undefined : raw,
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, reason: `Could not reach Lalamove — ${(err as Error)?.message || "the request failed"}` };
  }
  let data: unknown = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    return { ok: false, status: res.status, data, reason: plainReason(data, res.status) };
  }
  return { ok: true, status: res.status, data, reason: "" };
}

// Every vehicle key Lalamove will quote in this market, read from its own city list
// so the app never carries a hard-coded fleet that goes stale. The response is
// { data: [ { locode, services: [ { key, name } ] } ] }.
export function servicesIn(data: unknown): Array<{ key: string; name: string }> {
  const body = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const cities = Array.isArray(body.data)
    ? body.data as Array<Record<string, unknown>>
    : (Array.isArray(data) ? data as Array<Record<string, unknown>> : []);
  const seen = new Map<string, { key: string; name: string }>();
  for (const city of cities) {
    const services = Array.isArray(city && city.services) ? city.services as Array<Record<string, unknown>> : [];
    for (const s of services) {
      const key = String((s && s.key) || "").trim();
      if (!key || seen.has(key)) continue;
      seen.set(key, { key, name: String((s && s.name) || "").trim() });
    }
  }
  return [...seen.values()];
}

export async function cities(cfg: LlmConfig) {
  return await llmRequest(cfg, { method: "GET", path: "/v3/cities" });
}

type Stop = { lat: number; lng: number; address?: string };

// Turn the app's points into Lalamove's stops. Coordinates are sent as strings —
// that is how v3 documents them, and a number where a string is expected is the
// kind of mismatch that comes back as a stop Lalamove cannot place.
export function stopsPayload(points: Stop[]): Array<Record<string, unknown>> {
  return points.map((p) => ({
    coordinates: { lat: String(p.lat), lng: String(p.lng) },
    address: String((p && p.address) || "").trim(),
  }));
}

export async function quotation(
  cfg: LlmConfig,
  { serviceType, points, scheduleAt = "" }: { serviceType: string; points: Stop[]; scheduleAt?: string },
) {
  const inner: Record<string, unknown> = {
    serviceType,
    language: "en_MY",
    stops: stopsPayload(points),
  };
  // Omitted entirely when there is no time: an empty string is not "now" to this
  // API, it is a malformed schedule.
  const when = String(scheduleAt || "").trim();
  if (when) inner.scheduleAt = when;
  const out = await llmRequest(cfg, { method: "POST", path: "/v3/quotations", body: envelope(inner) });
  return out.ok ? { ...out, data: unwrap(out.data) } : out;
}

// ── booking, reading and cancelling a real trip ────────────────────────────
//
// One person with one door: the sender is the bakery, a recipient is a customer.
// `stopId` is the courier's own handle for a doorstep and it comes from the
// QUOTATION's reply, not from here — that is what makes a booking the price that
// was quoted rather than a new price for the same words. See the client half
// (admin/js/couriers/lalamove.js) for how each id is matched back to a door.
type Party = { stopId: string; name: string; phone: string };

function partyPayload(p: Party): Record<string, unknown> {
  return {
    stopId: String((p && p.stopId) || "").trim(),
    name: String((p && p.name) || "").trim(),
    phone: String((p && p.phone) || "").trim(),
  };
}

// The order body. Note what is NOT in it: no serviceType, no scheduleAt, no stops
// and no language. Those belong to the quotation and are deliberately not repeated —
// the booking names the quotation, and the quotation already holds the vehicle and
// the time. Sending them again would be a second, quieter way to choose a vehicle.
export function orderPayload(
  { quotationId, sender, recipients }: { quotationId: string; sender: Party; recipients: Party[] },
): Record<string, unknown> {
  return envelope({
    quotationId: String(quotationId || "").trim(),
    sender: partyPayload(sender),
    recipients: (Array.isArray(recipients) ? recipients : []).map(partyPayload),
  });
}

export async function placeOrder(
  cfg: LlmConfig,
  args: { quotationId: string; sender: Party; recipients: Party[] },
) {
  const out = await llmRequest(cfg, { method: "POST", path: "/v3/orders", body: orderPayload(args) });
  return out.ok ? { ...out, data: unwrap(out.data) } : out;
}

// One trip's current state, read fresh. This is the ONLY way her own screen learns
// anything after booking: Lalamove cannot write to her phone, so her order row
// catches up when she asks it to (see the webhook half in the plan — that one is for
// the customer's page, which does not need her session).
//
// This call does not fetch the driver, and cannot: the trip carries only a `driverId`,
// which is an empty string until a driver is matched. The driver's own record is a second
// call — see `orderWithDriver` below, which is what a caller should use — and it is
// deliberately kept OUT of this function so that reading a trip stays one request. A
// booking press has no driver to show, and a screen that showed one would be inventing it.
export async function orderDetail(cfg: LlmConfig, orderId: string) {
  const out = await llmRequest(cfg, { method: "GET", path: `/v3/orders/${encodeURIComponent(String(orderId || "").trim())}` });
  return out.ok ? { ...out, data: unwrap(out.data) } : out;
}

// The driver on a trip. `GET .../orders/{id}` carries only a `driverId` — the name, the
// plate and the number the customer would ring are a record of their own, behind their
// own endpoint. So a check is two calls when a driver has been matched, and one when one
// has not.
export async function driverDetail(cfg: LlmConfig, driverId: string) {
  const id = String(driverId || "").trim();
  if (!id) return { ok: false, status: 0, data: null, reason: "No driver is on this trip yet." };
  const out = await llmRequest(cfg, { method: "GET", path: `/v3/drivers/${encodeURIComponent(id)}` });
  return out.ok ? { ...out, data: unwrap(out.data) } : out;
}

// The trip, with its driver attached when there is one to fetch.
//
// THE FAILURE THAT MATTERS: the driver's endpoint answers NOTHING until an hour before
// the pickup, so on a check made earlier in the day it refuses every time. That refusal
// says nothing about the trip, which is perfectly healthy, and it must therefore never
// reach her as an error: the refusal is folded in as an absence, the order comes back
// exactly as it was, and her screen goes on showing the status it does have. Failing the
// whole check because a name is not available yet would break a working feature over a
// detail she has not asked for.
export async function orderWithDriver(cfg: LlmConfig, order: unknown) {
  const o = (order && typeof order === "object") ? order as Record<string, unknown> : null;
  if (!o) return order;
  const driverId = String(o.driverId || "").trim();
  if (!driverId) return order;
  const got = await driverDetail(cfg, driverId);
  if (!got.ok) {
    console.error("[courier] the driver is not readable yet:", got.reason);
    return order;
  }
  return { ...o, driver: got.data };
}

// Cancel a trip. DELETE with no body, which is what Lalamove documents — NOT the
// `PUT .../cancel` with a reason that some third-party libraries use, and that its
// own reference does not contain.
//
// A refusal is expected and ordinary rather than exceptional: this is allowed only
// while a driver is still being found, or within five minutes of one being matched.
// After that the 409 arrives with ERR_CANCELLATION_FORBIDDEN, which PLAIN_ERRORS
// already turns into a sentence she can act on.
export async function cancelOrder(cfg: LlmConfig, orderId: string) {
  return await llmRequest(cfg, { method: "DELETE", path: `/v3/orders/${encodeURIComponent(String(orderId || "").trim())}` });
}
