// couriers/api.js — the one channel between this app and a courier's server
// (25 Sep 2026).
//
// Every courier needs the same three things done the same way, and none of them is
// a courier's business:
//
//   • the call itself — to the `courier` edge function, with the owner's session in
//     the Authorization header. The KEY AND SECRET are on the server and must never
//     reach a browser: anything shipped to this page is readable by anyone who opens
//     it, and a courier's secret is somebody's wallet. This is the wall the
//     courier-api brief named, and the wish-mail function is the precedent for
//     getting over it.
//
// AND IT DOES NOT KNOW ANY COURIER'S NAME. `provider` is passed in by the caller that
// already has one — a provider file sending its own key — and never defaulted to here.
// A default would be this file quietly choosing a courier, which is the one thing the
// seam exists to prevent: the day a second courier is added, a default left behind
// would send its calls to the first one and nothing would say so.
//   • never throwing. Every caller is a button in a pop-up she pressed while
//     standing in a kitchen. A thrown error there is a dead screen with no words on
//     it; a returned reason is a sentence she can act on. So the contract is
//     { ok: true, ... } or { ok: false, reason: "..." } and there is no third case.
//   • a timeout. A phone on one bar of signal will leave a fetch hanging for
//     minutes with a spinner on it, and the honest answer to that is "it did not
//     answer" rather than a screen that never moves again.
//
// Geocoding lives here too, though it is not a courier's: turning her typed address
// into a point is the same job whichever courier carries the box, and it is asked
// of the server for the same reason — a browser call to a public geocoder carries
// her customer's address out of the app with no way to say who is asking.

import { cachedToken } from "../supabase.js";
// The one answer to "is this a place" — used below on the geocoder's reply, so a
// half-answer cannot become a pin. See courier_place.js.
import { validPlace } from "../courier_place.js";

// The courier function's URL, or "" when this phone has no Shared data set up.
export function courierFunctionUrl(state) {
  const sb = (state && state.settings && state.settings.supabase) || null;
  const url = sb ? String(sb.url || "").replace(/\/+$/, "") : "";
  return url ? `${url}/functions/v1/courier` : "";
}

// The two reasons a call can never be made, said the way she would have to fix them.
function channelProblem(state) {
  if (!courierFunctionUrl(state)) {
    return "Shared data is not set up on this phone, so there is nothing to ask the courier from.";
  }
  if (!cachedToken()) {
    return "Shared data is not signed in. Turn it on and sign in first — your courier's key is kept safe on the server, so the app can only reach it through your account.";
  }
  return "";
}

// One call to the courier function. Never throws.
//
// A non-2xx answer is read for its own words before falling back to a generic line:
// the function answers 401 for a session it would not accept, 500 for a secret it
// does not have, and both of those are setup problems whose exact words are worth
// more to her than "something went wrong".
export async function callCourier(state, { action, provider = "", payload = {}, timeoutMs = 25000 } = {}) {
  const problem = channelProblem(state);
  if (problem) return { ok: false, reason: problem };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(courierFunctionUrl(state), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cachedToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, provider, payload }),
      signal: controller.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const said = body && typeof body === "object" ? (body.reason || body.error) : "";
      return { ok: false, reason: String(said || `The courier service answered with an error (HTTP ${res.status}).`) };
    }
    if (!body || typeof body !== "object") {
      return { ok: false, reason: "The courier service answered with something that could not be read." };
    }
    return body;
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20)) {
      return { ok: false, reason: "The courier service did not answer in time. Check your signal and try again." };
    }
    return {
      ok: false,
      reason: err && err.message ? `Couldn't reach the courier service — ${err.message}` : "Couldn't reach the courier service.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Turn a typed address into a point, on the server. Returns
// { ok: true, place: {lat,lng,label}, places: [{lat,lng,label}, ...] } or
// { ok: false, reason }.
//
// A miss is a normal answer, not an error: a one-line address in a Malaysian
// housing estate may simply not be in OpenStreetMap, and the caller's job then is to
// offer the map rather than to apologise.
//
// AND THE SERVER MAY OFFER SEVERAL MATCHES (v198). It used to send one and this
// function used to keep it; both ends carried a list past each other now. The list is
// the pin card's chooser — see place_map.js — and `place` stays exactly what it always
// was, the first of them, because the quote card and the delivery run want one answer
// and not a choice.
export async function geocodeAddress(state, address, { timeoutMs = 15000 } = {}) {
  const text = String(address || "").trim();
  if (!text) return { ok: false, reason: "There is no address to look up." };
  const out = await callCourier(state, { action: "geocode", payload: { address: text }, timeoutMs });
  if (!out.ok) return out;

  // The words she typed stand in for the geocoder's own label when it did not send
  // one: an address she recognises beats a set of numbers on a screen. Every candidate
  // is named this way, or one row of the list would read as a pair of numbers while the
  // rest read as addresses. Junk is dropped here rather than drawn — a candidate that
  // is not a place must never become a row she can press.
  const named = (p) => {
    const v = validPlace(p);
    return v ? { lat: v.lat, lng: v.lng, label: v.label || text } : null;
  };
  const list = (Array.isArray(out.places) ? out.places : []).map(named).filter(Boolean);

  // THE OLD SERVER'S REPLY, AND THIS IS DELIBERATE. The app reaches her phone the day
  // she pushes it, and the function only changes when she redeploys — so for as long as
  // that gap lasts the reply carries `place` and nothing else. Carrying that one answer
  // in as a list of one draws no chooser (a single candidate is not worth a list), which
  // is today's behaviour exactly, rather than an empty panel and a screen that reads as
  // broken the first time she tries it.
  if (!list.length) {
    const only = named(out.place);
    if (!only) return { ok: false, reason: "That address could not be found — put the pin on the map instead." };
    list.push(only);
  }
  return { ok: true, place: list[0], places: list };
}
