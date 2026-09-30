// store/feedback.js — the one place the shop front sends a customer's own words to
// the developer (v247).
//
// It is its own file for the same reason store/lookup.js is: store/app.js is the page's
// wiring and this is the network, and the two are easier to read apart. The rules are
// small enough to sit here.
//
// THE RECIPIENT IS NOT OURS TO CHOOSE. The function on the other end reads the
// developer's address from the shop's own published settings; this file sends the words
// and nothing else. There is deliberately no `to` in the body and there never should be —
// a public form that could name its own recipient would let anyone mail anyone with this
// shop's verified domain signing the envelope.
//
// A SEND THAT FAILED IS NEVER DRESSED UP AS ONE THAT WORKED. The caller gets an honest
// `ok`, and the page's own fallback — the developer's WhatsApp link, already drawn under
// the "Website by" line — is what the customer is pointed at instead. A thank-you shown
// over a send that never left is the one outcome worth going out of the way to avoid: the
// customer would stop trying, and nobody would ever learn the words were lost.
//
// AND THEIR WORDS ARE AUTOSAVED, because there is no Send button to make the act of
// sending obvious: a customer can write a whole sentence, never press Enter, and tap away
// — or close the page. What they typed is kept on their own device as a DRAFT and put back
// where they left it, so returning to the shop finds their sentence still there. It is
// cleared the moment a send succeeds, and it is only ever a draft: nothing is sent because
// it was saved.
//
// AND LEAVING THE PAGE IS ITSELF A SEND. No button and no obligation to press Enter: the
// words go when the customer closes the shop or taps a link out of it, handed to the
// browser with `keepalive` so the request survives the page that made it. The draft and
// the leave-send are the same promise kept two ways — nothing they typed is lost, and
// nothing they typed goes unread.

import { CONFIG } from "./config.js";
// The SAME number the backoffice shows on More. The shop imports it rather than
// keeping a copy of its own, because two version files in one repository drift apart the
// first time only one of them is remembered — and the whole point of the number is that
// it tells the truth about which build a phone is running.
import { ENGINE_VERSION } from "../admin/js/version.js";

// The path on her Supabase. Called with the same anon key the shop uses for everything
// else — it is public by design, and this function holds no secret that key could reach.
const PATH = "/functions/v1/shop-feedback";

// How long the shop waits for the send before giving up on it. Generous: Resend's own
// round trip sits behind this, and a patience shorter than the work would report a
// failure that was still coming.
const CALL_MS = 15000;

// The message must carry something to say. Two keystrokes is a fat thumb on the Send
// button, not a suggestion, and the box says so rather than mailing it.
const MIN_MESSAGE = 3;

// The draft: what they had typed, kept on their own device. One key, one sentence — the
// shop persists nothing else about a customer, and this is not tracking, it is the page
// remembering for them.
const DRAFT_KEY = "fbDraft";
const DRAFT_MAX = 4000; // the same ceiling the message itself has

// Storage that does not exist, or that throws when touched (a browser in private mode, or
// one with storage switched off), is not an error worth telling anybody about: the box
// simply behaves as it did before there was a draft.
function store() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** What they had typed the last time they were here, or "" if nothing was kept. */
export function loadDraft() {
  try {
    const s = store();
    if (!s) return "";
    const kept = s.getItem(DRAFT_KEY);
    return typeof kept === "string" ? kept.slice(0, DRAFT_MAX) : "";
  } catch {
    return "";
  }
}

/** Keep their words against a later visit; an empty sentence removes the draft entirely. */
export function saveDraft(text) {
  const words = String(text == null ? "" : text).slice(0, DRAFT_MAX);
  try {
    const s = store();
    if (!s) return;
    if (words.trim()) s.setItem(DRAFT_KEY, words);
    else s.removeItem(DRAFT_KEY);
  } catch {
    /* a browser that will not keep it is not a reason to interrupt them */
  }
}

/**
 * Send the customer's words to the developer.
 *
 * `origin` and `page` are the live address the customer was reading, so the developer's
 * inbox can name the project without anybody typing it in twice. `engine` is not a
 * parameter: it is whichever build this file was served from, which is the honest answer
 * to "what was the customer looking at" even when a phone is running yesterday's copy.
 *
 * @returns {{ ok: boolean, key: string }} `key` names the line the page should show —
 *   one of `fbThanks`, `fbEmpty`, `fbFailed`.
 */
export async function sendFeedback({ message, page, origin, lang, honeypot, keepalive }, fetchFn) {
  const send = fetchFn || ((...args) => globalThis.fetch(...args));

  const text = String(message == null ? "" : message).trim();
  if (text.length < MIN_MESSAGE) return { ok: false, key: "fbEmpty" };

  const sb = CONFIG.supabase || {};
  const base = sb.url ? String(sb.url).replace(/\/+$/, "") : "";
  // Nowhere to send it. Not an error anybody can act on, and the same sentence the
  // customer would read if the service were down.
  if (!base || !sb.anonKey) return { ok: false, key: "fbFailed" };

  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), CALL_MS);
  try {
    const res = await send(`${base}${PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sb.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: text.slice(0, 4000),
        page: String(page == null ? "" : page).slice(0, 120),
        origin: String(origin == null ? "" : origin).slice(0, 120),
        // Named, not looked up: the running build's own number.
        engine: String(ENGINE_VERSION).slice(0, 16),
        lang: String(lang == null ? "" : lang).slice(0, 8),
        // The honeypot travels with the message. Empty for a person; filled for a bot,
        // and the function answers a filled one exactly as it answers a real send — so
        // the bot learns nothing from being refused.
        website: String(honeypot == null ? "" : honeypot).slice(0, 100),
      }),
      signal: ctl.signal,
      // A send made as the customer leaves the page has to outlive it: an ordinary
      // fetch is cancelled the moment the document goes away, which is precisely the
      // moment this one is made in. Only the leave-send asks for it.
      keepalive: !!keepalive,
    });
    if (!res.ok) return { ok: false, key: "fbFailed" };
    const data = await res.json().catch(() => null);
    return data && data.ok ? { ok: true, key: "fbThanks" } : { ok: false, key: "fbFailed" };
  } catch {
    // Offline, aborted, or an answer that was not JSON. All the same to the customer.
    return { ok: false, key: "fbFailed" };
  } finally {
    clearTimeout(kill);
  }
}
