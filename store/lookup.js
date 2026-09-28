// store/lookup.js — asking your own server where a typed address is (v202).
//
// The only new file in the shop with a `fetch` in it, and it is its own file for that
// reason: store/app.js is the page's wiring and this is the network, and the two are
// easier to read apart. The RULES are not here — what is worth asking and how to read
// the answer are in store/geo.js, which is pure and has no network in it at all.
//
// WHERE THE QUESTION GOES, AND WHY THERE. To her own Supabase function
// (supabase/functions/shop-geocode), which asks Photon and then Nominatim with the
// your name on the request. A phone asking a public geocoder directly would carry
// the customer's home address out under the customer's own address on the network, with
// nothing saying who was asking — which is exactly what that function's own geocode.ts
// refuses to do. That was her decision, in her words: "Through your own Supabase."
//
// THREE THINGS ARE WORTH MORE THAN THE REQUEST ITSELF:
//
//   • NOTHING IS ASKED WHILE SOMEBODY IS STILL TYPING. A lookup goes out only after a
//     pause with no keystrokes. Nominatim's usage policy is against autocomplete, and a
//     keystroke stream is what that means; a pause, a whole address and one ask is not.
//     It is also cheaper for her, and it is what makes the list settle instead of
//     flickering under somebody's thumb.
//   • THE SAME QUESTION IS NEVER ASKED TWICE. Somebody deleting a letter and typing it
//     again has asked the same thing again, and the answer is already here.
//   • AN ANSWER THAT ARRIVED TOO LATE IS THROWN AWAY. The customer may have typed past
//     it, or emptied the box, or placed the order — and a stale list appearing under a
//     box that has since been cleared is worse than no list at all. So every ask carries
//     the number of the generation it belongs to, and only the newest one is allowed to
//     speak.
//   • A QUESTION THE MAP SERVICES ANSWERED WITH NOTHING IS ASKED ONCE MORE, in the most
//     forgiving wording store/geo.js can build from it (v203). "No 5", "Blk A" and "Lot
//     1234" are words no map holds, and "Rd" is a different string to an index that says
//     "Road" — all measured, all reproducible. The address exactly as typed is ALWAYS
//     the first ask, so nothing that works today is slowed or answered differently; the
//     forgiving wording is only ever spent on a question the exact one has already
//     failed, which is also what makes over-eager stripping cost nothing.

import { CONFIG } from "./config.js";
import { lookupQuery, readPlaces, lookupWhy, lookupLadder, askAgain } from "./geo.js";

// How long the customer has to stop typing before anything is sent. Long enough that a
// word is finished, short enough that the list feels like it is keeping up.
const WAIT_MS = 700;

// How long the shop waits for the WHOLE lookup — every rung of the ladder together —
// before giving up on it. The function allows itself two asks of five seconds each, so
// this is that plus room for the round trip; a patience shorter than the work would
// report a failure that was still coming. The ladder shares this one budget rather than
// taking it afresh, so a second wording can never make the customer wait twice as long.
const CALL_MS = 12000;

// How much of that budget must be left before another rung is worth starting. A rung
// begun with less than this would be cut off mid-question and report a failure that was
// still coming — which is worse than the honest answer the last rung already gave.
const RETRY_MS = 3500;

// The path on her Supabase. The function is called with the same anon key the shop uses
// for everything else — it is public by design, and this function holds no secret that
// could be reached with it.
const PATH = "/functions/v1/shop-geocode";

// `onState` is called with `{ key, hits }` on every change, where `key` is a DICTIONARY
// KEY (store-lang.js) or null for "say nothing at all". It is a key rather than a
// sentence because a sentence chosen here could not be translated if the customer
// switched language while the list was on screen.
//
// `fetchFn` is an argument so the whole thing is driven under Node; it defaults to the
// page's own fetch, read at the moment of the call rather than captured here. The three
// timings are arguments for the same reason — a test that cannot make a budget run out
// cannot test what happens when it does.
export function createLookup({ fetchFn = null, waitMs = WAIT_MS, callMs = CALL_MS, retryMs = RETRY_MS, onState = () => {} } = {}) {
  const send = fetchFn || ((...args) => globalThis.fetch(...args));

  // The generation counter. It is bumped by anything that discards what is in the air,
  // and an ask is only allowed to answer if its own generation is still the current one.
  let gen = 0;
  let timer = null;      // the pending pause
  let live = null;       // the abort controller of the ask in the air, or null
  let answered = null;   // { q, key, hits } — the last question and what came back

  // `q` rides along because the page has to know which QUESTION a row belongs to. A row
  // stays on screen for a moment after the customer has typed past it — the list is
  // deliberately not cleared on every keystroke, so it settles instead of flickering —
  // and a pin taken from a row answered for an older wording is a pin for the address
  // they no longer have (store/app.js, dropStalePin).
  const say = (key, hits, q = null) => onState({ key, hits: hits || [], q });

  function cancel() {
    gen += 1;
    if (timer) { clearTimeout(timer); timer = null; }
    if (live) { live.abort(); live = null; }
  }

  // Forget everything and go quiet: the box was emptied, or the order was placed and a
  // stranger is about to use the phone (store/app.js, resetPin).
  function clear() {
    cancel();
    answered = null;
    say(null);
  }

  // The customer typed something. This is called on every keystroke and must be cheap:
  // it cancels whatever was pending and decides whether anything is worth scheduling.
  function typed(text) {
    const q = lookupQuery(text);
    cancel();
    if (!q) {
      // Still part-way through a word. The list goes away and nothing is said — which
      // is the one silence that is not a dead control, because they are mid-keystroke.
      answered = null;
      say(null);
      return;
    }
    // Asked and answered already: show it again without spending another lookup. `q`
    // goes back out with it — the page pairs a row with the wording it answers, and a
    // replay that dropped the wording would leave the page unable to tell a row that
    // belongs to the box now from one left over from an address since edited away.
    if (answered && answered.q === q) {
      say(answered.key, answered.hits, answered.q);
      return;
    }
    const mine = gen;
    timer = setTimeout(() => { timer = null; run(q, mine); }, waitMs);
  }

  function settle(q, key, hits) {
    answered = { q, key, hits };
    say(key, hits, q);
  }

  // ONE QUESTION, ONE ANSWER. `reply` is the function's own object, or null when nothing
  // readable came back, and it is handed back rather than interpreted: only its shape can
  // say whether a second, differently-worded question is worth asking (geo.js, askAgain).
  async function ask(base, q, ms) {
    const ctl = new AbortController();
    live = ctl;
    const kill = setTimeout(() => ctl.abort(), ms);
    try {
      // NO `apikey` HEADER HERE, and this is load-bearing rather than tidiness. An
      // Edge Function's CORS policy lists the request headers it will accept, and
      // shop-geocode's lists "Authorization, Content-Type" — the same two the admin's
      // own two callers send (admin/js/couriers/api.js, devmail.js). Adding a header the
      // list omits makes the browser's PREFLIGHT fail, which arrives as a bare
      // "TypeError: Failed to fetch" and reads to the customer as the lookup being down.
      // The anon key is carried in Authorization, which is a valid JWT and satisfies the
      // gateway on its own, so `apikey` bought nothing and cost the whole feature.
      // test/store-lookup.test.js holds this against the function's own header list.
      const res = await send(`${base}${PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CONFIG.supabase.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: q }),
        signal: ctl.signal,
      });
      // A function that has not been deployed yet answers 404, and that is a failure
      // rather than a miss — the customer is told the lookup is unavailable, not that
      // their house does not exist.
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      const hits = readPlaces(data);
      const key = hits.length ? "addrPick"
        : (data && data.ok === false ? lookupWhy(data.why) : "addrFailed");
      return { key, hits, reply: data };
    } catch {
      // Offline, aborted, or an answer that was not JSON. All the same to the customer.
      return { key: "addrFailed", hits: [], reply: null };
    } finally {
      clearTimeout(kill);
    }
  }

  async function run(q, mine) {
    // Everything between here and the settle below is allowed to be overtaken.
    if (mine !== gen) return;

    const sb = CONFIG.supabase || {};
    const base = sb.url ? String(sb.url).replace(/\/+$/, "") : "";
    // Nowhere to ask, or no way to ask. Not an error anybody can act on, and the same
    // sentence the customer would read if the service were down.
    if (!base || !sb.anonKey) { settle(q, "addrFailed", []); return; }

    say("addrLooking");

    // THE LADDER, walked. The first rung is the address exactly as typed; the second is
    // the same address in its most forgiving form, and it is only reached when the first
    // came back with the one code that means "the map services answered and they hold no
    // such door". A refusal, a timeout or an unreachable service ends the walk on the
    // first rung, because different words would buy the same silence.
    const ladder = lookupLadder(q);
    const deadline = Date.now() + callMs;
    let key = "addrFailed";
    let hits = [];

    for (let i = 0; i < ladder.length; i++) {
      if (mine !== gen) return;
      const left = deadline - Date.now();
      // The FIRST rung gets the whole patience — it is the customer's own address and it
      // deserves its fair chance. A later rung runs only if enough of that patience is
      // left to hear its answer.
      if (i > 0 && left < retryMs) break;

      const got = await ask(base, ladder[i], Math.max(left, 1));
      if (mine !== gen) return;   // overtaken while this was in the air — say nothing
      live = null;

      if (got.hits.length) { key = got.key; hits = got.hits; break; }
      // The honest answer to the customer's OWN words, kept if a later rung comes back
      // with nothing useful: a second rung cut off by the budget must not turn "your
      // address is not in the map" into "the lookup is down".
      if (i === 0) key = got.key;
      if (!askAgain(got.reply)) break;
    }

    if (mine !== gen) return;
    settle(q, key, hits);
  }

  return { typed, clear };
}
