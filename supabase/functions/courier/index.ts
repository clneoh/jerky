// supabase/functions/courier/index.ts
//
// The backoffice asks this function for a courier price, a courier's vehicle list,
// or a point for an address. It is shaped like wish-mail, for the same reason: the
// api KEY and SECRET are the baker's money, so they live in this function's
// environment and never travel to a browser. Anything shipped to that page is
// readable by anyone who opens the page.
//
// THE CONTRACT, and it is the whole contract:
//
//   • HTTP 200 with { ok: true, ... }              it worked
//   • HTTP 200 with { ok: false, reason: "..." }   it did not, and here is why,
//                                                  in words she can act on
//   • 401 / 405 / 500                              a SETUP problem — no session,
//                                                  wrong method, missing secret
//
// A business failure is never a 5xx. A price Lalamove would not give is an answer,
// not a server fault, and the app reads the reason either way.
//
// ONE-TIME SETUP (her side, ~10 min, in the Lalamove Partner Portal and Supabase —
// never in chat, and never in a file that ships):
//   1. Partner Portal (https://partnerportal.lalamove.com) → sign up for a Developer
//      Key. The Sandbox/Production switch is in the TOP RIGHT CORNER of the page and
//      must say Sandbox, or no test pair is shown at all. The key and secret are on the
//      Developers tab and start pk_test_ / sk_test_. Sandbox needs no approval and no
//      wallet top-up; live keys do require topping up the Lalamove wallet.
//   2. supabase functions deploy courier --project-ref ircwozniiyywsowamixy
//      The --project-ref is not optional in practice: without it the CLI asks "Select a
//      project" and this repo's project list also carries a second, unrelated project,
//      so a stray Enter can aim the deploy at the wrong one.
//   3. supabase secrets set LALAMOVE_KEY=<key>
//      supabase secrets set LALAMOVE_SECRET=<secret>
//      supabase secrets set LALAMOVE_ENV=sandbox      # or "production" when live
//      THE "=" IS REQUIRED. `secrets set LALAMOVE_KEY <key>` is refused with "Invalid
//      secret pair: LALAMOVE_KEY. Must be NAME=VALUE." — which is what this comment
//      said until v194, and it cost a round trip to work out.
//   4. supabase secrets set GOOGLE_GEOCODING_KEY=<key>   # OPTIONAL (v212)
//      Without it the address lookup answers with the ROAD rather than the house, which
//      is all the two free geocoders can truthfully say — both are built from
//      OpenStreetMap, which holds Malaysian roads rather than house numbers. With it,
//      Google's index is asked first and the free pair stay behind it as the fallback.
//      The key is configured with a QUOTA CAP on Google's own side, so a spent allowance
//      means the lookup falls back to the road rather than a charge. Read fresh per call,
//      so setting it takes effect on the next lookup with no redeploy. This step is the
//      only one here that is not required for the rest of the function to work.
//
// To try it before her account exists, nothing here has to change: the app's own
// screens work against the same contract with no key at all (they say so in words),
// and the signing is unit-tested in the Node suite against the exact header Lalamove
// documents.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { LALAMOVE_KEY, LALAMOVE_LABEL, hostFor, servicesIn, quotation, cities, placeOrder, orderDetail, orderWithDriver, cancelOrder, notSetUpReason, type LlmConfig } from "./providers/lalamove.ts";
import { geocodeAddress } from "./geocode.ts";
import { validPoint } from "./place.ts";
import { orderArgs } from "./booking.ts";

// The app calls from munchies.com.my, a different origin than supabase.co, so
// the browser sends a preflight first and checks every response for these headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// Lalamove allows 2 requests a second. One quotation is one request, so pricing six
// vehicles is six requests, and firing them together would be refused as a burst —
// which would read to her as "the van is not available" when the truth is that we
// asked too fast. A gap is cheaper than a wrong answer.
const GAP_MS = 600;
const MAX_SERVICES = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    console.error("[courier] supabase env not configured");
    return json({ ok: false, reason: "This function is not set up yet." }, 500);
  }

  // A real, current owner session is required. Only her signed-in app can spend her
  // Lalamove wallet, and an expired or stolen token is refused right here.
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    console.error("[courier] request had no Authorization header");
    return json({ ok: false, reason: "Not signed in." }, 401);
  }
  const supabase = createClient(supabaseUrl, supabaseAnon);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.error("[courier] session rejected:", error && (error.message || error));
    return json({ ok: false, reason: "That sign-in has expired. Sign in again and retry." }, 401);
  }

  let payload: Record<string, unknown> | null = null;
  try { payload = await req.json(); } catch { payload = null; }
  const action = String((payload && payload.action) || "").trim();
  const provider = String((payload && payload.provider) || LALAMOVE_KEY).trim().toLowerCase();
  const args = ((payload && payload.payload) || {}) as Record<string, unknown>;

  // Geocoding is asked of this function but belongs to no courier — the point for an
  // address is the same point whichever company carries the box — so it is answered
  // before the provider is looked up.
  if (action === "geocode") {
    const out = await geocodeAddress(String(args.address || ""));
    return json(out);
  }

  const found = configFor(provider);
  if (!found.ok) return json({ ok: false, reason: found.reason });
  const cfg = found.cfg;

  if (action === "account") {
    // What the Settings card shows: which environment is live and which country's
    // fleet is being priced. Neither is a secret — the key and secret are not read
    // into this reply and cannot be, because they never leave configFor().
    return json({ ok: true, provider, env: envName(), market: cfg.market });
  }

  if (action === "vehicles") {
    const out = await cities(cfg);
    if (!out.ok) return json({ ok: false, reason: out.reason });
    const services = servicesIn(out.data);
    if (!services.length) {
      return json({ ok: false, reason: `${courierName(provider)} did not name any vehicles for this market — the account may not be set up yet.` });
    }
    return json({ ok: true, services });
  }

  if (action === "quote") {
    const points = pointsOf(args);
    if (points.error) return json({ ok: false, reason: points.error });
    const services: string[] = [];
    const asked = Array.isArray(args.services) ? args.services : [];
    for (const s of asked) {
      const key = String(s || "").trim().toUpperCase();
      if (key && !services.includes(key)) services.push(key);
      if (services.length >= MAX_SERVICES) break;
    }
    if (!services.length) {
      return json({ ok: false, reason: "No vehicles were asked about." });
    }
    const scheduleAt = String(args.scheduleAt || "").trim();

    // One quotation per vehicle, spaced. A vehicle refused on its own goes into
    // `failed` and the others still come back — the motorcycle may be priced while
    // the van is not running at this hour, and she must still be able to use the one
    // that works.
    const quotes: unknown[] = [];
    const failed: Array<{ service: string; reason: string }> = [];
    for (let i = 0; i < services.length; i++) {
      if (i > 0) await sleep(GAP_MS);
      const out = await quotation(cfg, { serviceType: services[i], points: points.list, scheduleAt });
      if (out.ok) {
        const one = out.data as Record<string, unknown>;
        quotes.push({ serviceType: services[i], ...(one && typeof one === "object" ? one : {}) });
      } else {
        failed.push({ service: services[i], reason: out.reason });
        console.error(`[courier] quotation refused for ${services[i]}:`, out.reason);
      }
    }
    // Both are returned raw and unread: the app normalises them, so the reading of a
    // reply stays in the Node-tested half rather than being done twice, differently.
    return json({ ok: true, quotes, failed });
  }

  // ── booking a trip, checking it, and calling it off ──────────────────────
  //
  // The replies are returned raw and unread, exactly as the quotations above are:
  // Lalamove's own words are read by the app's provider file, which is the half the
  // Node suite can test. This function's job is the key, the signature and the wall.
  if (action === "book") {
    const req = orderArgs(args, courierName(provider));
    if (req.error) return json({ ok: false, reason: req.error });
    const out = await placeOrder(cfg, req.value);
    if (!out.ok) {
      console.error("[courier] booking refused:", out.reason);
      return json({ ok: false, reason: out.reason });
    }
    return json({ ok: true, order: out.data });
  }

  if (action === "job") {
    const id = String(args.orderId || "").trim();
    if (!id) return json({ ok: false, reason: "There is no booked trip to check." });
    const out = await orderDetail(cfg, id);
    if (!out.ok) return json({ ok: false, reason: out.reason });
    // The driver rides along when there is one to read (v190): the customer's card shows
    // who is bringing the parcel, and this is the only moment the app can find out. It is
    // a SECOND call, and a refusal from it is expected rather than a fault — the driver's
    // endpoint says nothing until an hour before the pickup — so the driver is attached
    // as an extra and its absence leaves the check itself untouched.
    return json({ ok: true, order: await orderWithDriver(cfg, out.data) });
  }

  if (action === "cancel") {
    const id = String(args.orderId || "").trim();
    if (!id) return json({ ok: false, reason: "There is no booked trip to cancel." });
    const out = await cancelOrder(cfg, id);
    if (!out.ok) {
      // A refusal here is ORDINARY, not a fault: Lalamove only allows a cancellation
      // while a driver is still being found, or within five minutes of one being
      // matched. Logged rather than treated as a failure of the function.
      console.error("[courier] cancellation refused:", out.reason);
      return json({ ok: false, reason: out.reason });
    }
    return json({ ok: true });
  }

  return json({ ok: false, reason: `This function does not know the action "${action}".` });
});

// Which environment is configured. Read fresh each call so flipping LALAMOVE_ENV in
// Supabase is enough — no redeploy, and no release, to go from the sandbox to live.
function envName(): string {
  const said = String(Deno.env.get("LALAMOVE_ENV") || "").trim().toLowerCase();
  return said === "production" ? "production" : "sandbox";
}

// The provider's configuration, or the reason there is none. The key and secret are
// read here and go nowhere else: they are not returned, not logged, and not put in an
// error message.
//
// TWO PROBLEMS COME THROUGH THIS DOOR AND THEY MUST NOT SHARE A SENTENCE (v194).
// "This build does not carry that courier" is a claim about the app; "the key was never
// added" is one secret's worth of setup. Until v194 both collapsed into the first one,
// which sent her hunting the build for a fault that was never there. So the reason is
// returned rather than swallowed, and each branch owns its own words.
function configFor(key: string): { ok: true; cfg: LlmConfig } | { ok: false; reason: string } {
  if (key !== LALAMOVE_KEY) {
    return { ok: false, reason: `This build has no courier called "${key}".` };
  }
  const apiKey = String(Deno.env.get("LALAMOVE_KEY") || "").trim();
  const secret = String(Deno.env.get("LALAMOVE_SECRET") || "").trim();
  if (!apiKey || !secret) {
    console.error("[courier] the api key and secret are not set on this function");
    return { ok: false, reason: notSetUpReason() };
  }
  return {
    ok: true,
    cfg: {
      key: apiKey,
      secret,
      market: (String(Deno.env.get("LALAMOVE_MARKET") || "").trim() || "MY").toUpperCase(),
      host: hostFor(envName()),
    },
  };
}

// The courier's name for anything a person reads, taken from the provider's own
// label. This is the server half of the rule the app's registry keeps, and it exists
// for the same reason: a sentence naming the courier that does not come from the
// courier is a line that has to be found and edited the day a second one arrives.
// The dispatcher still owns the ENV VAR names below, because those are her own setup
// in Supabase and are configured once; what it does not do any more is decide what the
// courier is called.
function courierName(provider: string): string {
  return provider === LALAMOVE_KEY ? LALAMOVE_LABEL : (provider || "the courier");
}

type Point = { lat: number; lng: number; address: string };

// The pickup and the drops, checked once here rather than trusted. A missing or
// non-numeric point is refused in words rather than sent as NaN, because Lalamove's
// own answer to a bad point is a code she cannot read — and because `Number(null)`
// is 0, a point whose latitude was null would reach Lalamove as a real place on the
// Equator. See place.ts.
function pointsOf(args: Record<string, unknown>): { error: string; list: Point[] } {
  const one = (p: unknown): Point | null => {
    const spot = validPoint(p);
    if (!spot) return null;
    return { lat: spot.lat, lng: spot.lng, address: String((p as Record<string, unknown>).address || "").trim() };
  };
  const pickup = one(args.pickup);
  if (!pickup) return { error: "The pickup spot is not pinned yet.", list: [] };
  const drops = (Array.isArray(args.drops) ? args.drops : []).map(one);
  if (!drops.length) return { error: "There is nowhere to deliver to.", list: [] };
  const placed = drops.filter((d): d is Point => d !== null);
  if (placed.length !== drops.length) return { error: "A delivery address is not pinned yet.", list: [] };
  return { error: "", list: [pickup, ...placed] };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
