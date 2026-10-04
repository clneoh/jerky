// parcels/api.js — the one channel between this app and EasyParcel (4 Oct 2026).
//
// ⚠️ A SECOND CHANNEL, AND IT IS NOT A COPY OF THE FIRST. `couriers/api.js` talks to the
// `courier` function for a van within Penang; this talks to the `parcel` function for a
// parcel posted nationwide. Two vendors, two secrets, two wallets — and one function each,
// because one deploy for two unrelated companies is one deploy that can break both.
//
// What the two DO share is the contract, and that is deliberate: the key and secret live on
// the server and never reach a browser; a call never throws, it returns a reason; and every
// call has a timeout, because a phone on one bar of signal leaves a fetch hanging for
// minutes with a spinner on it.

import { cachedToken } from "../supabase.js";

// The parcel function's URL, or "" when this phone has no Shared data set up.
export function parcelFunctionUrl(state) {
  const sb = (state && state.settings && state.settings.supabase) || null;
  const url = sb ? String(sb.url || "").replace(/\/+$/, "") : "";
  return url ? `${url}/functions/v1/parcel` : "";
}

// The two reasons a call can never be made, said the way she would have to fix them. The
// same two sentences the courier channel uses, because they are the same two problems.
function channelProblem(state) {
  if (!parcelFunctionUrl(state)) {
    return "Shared data is not set up on this phone, so there is nothing to ask EasyParcel from.";
  }
  if (!cachedToken()) {
    return "Shared data is not signed in. Turn it on and sign in first — EasyParcel's key is kept safe on the server, so the app can only reach it through your account.";
  }
  return "";
}

// One call to the parcel function. Never throws.
//
// A non-2xx answer is read for its own words before falling back to a generic line: the
// function answers 401 for a session it would not accept, 500 for a key it does not have,
// and both of those are setup problems whose exact words are worth more to her than
// "something went wrong".
export async function callParcel(state, { action, payload = {}, timeoutMs = 35000 } = {}) {
  const problem = channelProblem(state);
  if (problem) return { ok: false, reason: problem };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parcelFunctionUrl(state), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cachedToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const said = body && typeof body === "object" ? (body.reason || body.error) : "";
      return { ok: false, reason: String(said || `The parcel service answered with an error (HTTP ${res.status}).`) };
    }
    if (!body || typeof body !== "object") {
      return { ok: false, reason: "The parcel service answered with something that could not be read." };
    }
    return body;
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20)) {
      return { ok: false, reason: "The parcel service did not answer in time. Check your signal and try again." };
    }
    return {
      ok: false,
      reason: err && err.message ? `Couldn't reach the parcel service — ${err.message}` : "Couldn't reach the parcel service.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export const parcelBalance = (state) => callParcel(state, { action: "balance", timeoutMs: 20000 });
export const parcelRates = (state, payload) => callParcel(state, { action: "rates", payload });
export const parcelBook = (state, payload) => callParcel(state, { action: "book", payload, timeoutMs: 45000 });
export const parcelTrack = (state, payload) => callParcel(state, { action: "track", payload });
export const parcelOrderStatus = (state, payload) => callParcel(state, { action: "orderStatus", payload });
// Which host the server is pointed at. Demo books a parcel nobody will collect, so this is
// asked rather than assumed.
export const parcelHello = (state) => callParcel(state, { action: "hello", timeoutMs: 15000 });
