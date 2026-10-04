// supabase/functions/parcel/index.ts
//
// The backoffice asks this function what a parcel costs, what is in the EasyParcel wallet,
// and to book one. It is shaped exactly like `courier`, for the same reason and against the
// same rule: the API KEY is the baker's money, so it lives in this function's environment
// and never travels to a browser. Anything shipped to that page is readable by anyone who
// opens the page.
//
// THE CONTRACT, and it is the whole contract — the same three lines `courier` keeps, so the
// app has one way of talking to an outside company and not two:
//
//   • HTTP 200 with { ok: true, ... }              it worked
//   • HTTP 200 with { ok: false, reason: "..." }   it did not, and here is why,
//                                                  in words she can act on
//   • 401 / 405 / 500                              a SETUP problem — no session,
//                                                  wrong method, missing secret
//
// A business failure is never a 5xx. An empty wallet is an ANSWER, not a server fault, and
// it is the one refusal worth reading twice: EasyParcel is prepaid, so a booking with no
// credit fails at the counter with the parcel already packed.
//
// ⚠️ SEPARATE FROM `courier` ON PURPOSE, even though the two are the same shape. Kind 1
// (Lalamove) is a van to a door within Penang; kind 2 is a parcel posted nationwide. They
// have different vendors, different secrets, different wallets and different failure modes,
// and putting both behind one function would mean one deploy for two unrelated vendors.
// See project-courier-api (kind 1) and project-parcel-couriers (kind 2).
//
// ONE-TIME SETUP (her side, ~10 min, in EasyParcel and Supabase — never in chat, and never
// in a file that ships):
//   1. Sign up at www.easyparcel.my, complete the account verification, then register the
//      key for API access (their document's own three steps). The DEMO host works without
//      topping anything up, which is how this can be tried before a sen is spent.
//   2. supabase functions deploy parcel --project-ref hzpyblqygnntixkijeem
//      The --project-ref is not optional in practice: without it the CLI asks "Select a
//      project" and this repo's project list also carries a second, unrelated project, so a
//      stray Enter can aim the deploy at the wrong one.
//   3. supabase secrets set EASYPARCEL_KEY=<key>
//      supabase secrets set EASYPARCEL_ENV=demo        # or "live" when she is ready
//      THE "=" IS REQUIRED — the same trap the courier function documents.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ACTION, EASYPARCEL_KEY, bodyFor, bookRequest, hostFor, notSetUpReason, orderRow, rateRow,
  RATE_EXCLUDE, readBalance, readOrder, readRates, readTracking, reasonIn, stateCode,
  type Box, type Party,
} from "./easyparcel.ts";

// The app calls from jienluv2bake.com.my, a different origin than supabase.co, so the
// browser sends a preflight first and checks every response for these headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// Their host is a PHP page that occasionally sits for a while. A phone on one bar of signal
// would otherwise leave a fetch hanging with a spinner on it.
const TIMEOUT_MS = 30000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

type Config = { key: string; host: string };

function configFor(): Config | null {
  const key = (Deno.env.get("EASYPARCEL_KEY") || "").trim();
  if (!key) return null;
  return { key, host: hostFor(Deno.env.get("EASYPARCEL_ENV") || "demo") };
}

// One call to EasyParcel. NEVER THROWS — it answers { ok:false, reason } instead, because
// every caller is a button she pressed while holding a parcel.
async function ask(cfg: Config, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.host}?ac=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyFor({ api: cfg.key, ...params }),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed === null) {
      // ⚠️ A PHP PAGE THAT FAULTS ANSWERS WITH HTML, NOT JSON. Handing that to JSON.parse
      // would give "Unexpected token <" as her reason, which is true and useless — so the
      // failure is named for what it is.
      console.error("[parcel] non-JSON reply from", action, res.status, text.slice(0, 200));
      return { ok: false, reason: `EasyParcel answered with something that was not readable (HTTP ${res.status}).` };
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20)) {
      return { ok: false, reason: "EasyParcel did not answer in time. Check your signal and try again." };
    }
    console.error("[parcel] fetch failed:", err && (err.message || err));
    return { ok: false, reason: "Couldn't reach EasyParcel." };
  } finally {
    clearTimeout(timer);
  }
}

// A parcel as the app describes it, checked here rather than trusted. Both halves of the
// journey come off the app's own records, but a missing postcode would otherwise reach
// EasyParcel as an empty string and come back as "no rate", which reads as "nobody delivers
// there" instead of "the address is not finished".
function checkedBox(box: unknown): Box | null {
  const b = (box || {}) as Record<string, unknown>;
  const weightKg = Number(b.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  const side = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
  return { weightKg, lengthCm: side(b.lengthCm), widthCm: side(b.widthCm), heightCm: side(b.heightCm) };
}

function checkedParty(party: unknown): Party | null {
  const p = (party || {}) as Record<string, unknown>;
  const state = stateCode(String(p.state || ""));
  const code = String(p.code || "").trim();
  const name = String(p.name || "").trim();
  const contact = String(p.contact || "").trim();
  if (!state || !code || !name || !contact) return null;
  return {
    name, contact, state, code,
    company: String(p.company || ""), mobile: String(p.mobile || ""),
    addr1: String(p.addr1 || "").trim(), addr2: String(p.addr2 || ""),
    addr3: String(p.addr3 || ""), addr4: String(p.addr4 || ""),
    city: String(p.city || "").trim(), email: String(p.email || ""),
  };
}

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
    console.error("[parcel] supabase env not configured");
    return json({ ok: false, reason: "This function is not set up yet." }, 500);
  }

  // A real, current owner session is required. Only her signed-in app can spend her
  // EasyParcel wallet, and an expired or stolen token is refused right here.
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    console.error("[parcel] request had no Authorization header");
    return json({ ok: false, reason: "Not signed in." }, 401);
  }
  const supabase = createClient(supabaseUrl, supabaseAnon);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.error("[parcel] session rejected:", error && (error.message || error));
    return json({ ok: false, reason: "That sign-in has expired. Sign in again and retry." }, 401);
  }

  let payload: Record<string, unknown> | null = null;
  try { payload = await req.json(); } catch { payload = null; }
  const action = String((payload && payload.action) || "").trim();
  const args = ((payload && payload.payload) || {}) as Record<string, unknown>;

  const cfg = configFor();
  if (!cfg) {
    console.error("[parcel] EASYPARCEL_KEY is not set");
    return json({ ok: false, reason: notSetUpReason() }, 500);
  }

  // ── the wallet ─────────────────────────────────────────────────────────────
  // Asked first and on its own, because it is the answer to "can I send anything at all
  // today" — and because a booking that fails on an empty wallet has already cost her the
  // time of packing the box.
  if (action === "balance") {
    const out = await ask(cfg, ACTION.balance, {});
    return json(readBalance(out));
  }

  // ── what it costs ──────────────────────────────────────────────────────────
  // ⚠️ EVERY COURIER THEY CARRY COMES BACK PRICED, IN ONE CALL. That is what makes this
  // worth building rather than comparing two websites by hand: the app asks once and shows
  // her the whole list for THIS parcel, to THIS postcode, at THIS size.
  if (action === "rates") {
    const box = checkedBox(args.box);
    const pick = checkedParty(args.pick);
    const send = checkedParty(args.send);
    if (!box) return json({ ok: false, reason: "A parcel needs a weight before it can be priced." });
    if (!pick) return json({ ok: false, reason: "The sender's details are not finished — a name, a phone, a postcode and a state are all needed." });
    if (!send) return json({ ok: false, reason: "The receiver's details are not finished — a name, a phone, a postcode and a state are all needed. If the address was typed as a state this app does not know, it says so here rather than pretending there is no service." });
    const out = await ask(cfg, ACTION.rates, {
      bulk: [rateRow(pick, send, box, String(args.collectDate || ""))],
      // Their own field-name format for "drop these from the reply", spelled exactly as the
      // document gives them. Without it every courier's whole drop-off network comes back
      // with every price, which is a reply too big to send to a phone and of no use to her.
      exclude_fields: RATE_EXCLUDE,
    });
    return json(readRates(out));
  }

  // ── and booking it ─────────────────────────────────────────────────────────
  // ⚠️ THIS TAKES THE MONEY. It is the V3 endpoint, which creates the order AND pays for it
  // in one call, so there is no half-state where a draft exists that nobody paid for.
  if (action === "book") {
    const courier = String(args.courier || "").trim();
    const box = checkedBox(args.box);
    const pick = checkedParty(args.pick);
    const send = checkedParty(args.send);
    if (!courier) return json({ ok: false, reason: "Choose which courier to book first." });
    if (!box) return json({ ok: false, reason: "A parcel needs a weight before it can be booked." });
    if (!pick || !send) return json({ ok: false, reason: "The sender's and receiver's details both have to be finished before a parcel can be booked." });
    const order = orderRow({
      reference: String(args.reference || ""),
      content: String(args.content || ""),
      valueRM: Number(args.valueRM) || 0,
      weightKg: box.weightKg,
      pick,
      send,
      collectDate: String(args.collectDate || ""),
    });
    const out = await ask(cfg, ACTION.book, bookRequest({ courier, dropoff: !!args.dropoff, orders: [order] }));
    return json(readOrder(out));
  }

  // ── where it is ────────────────────────────────────────────────────────────
  if (action === "track") {
    const awb = String(args.awb || "").trim();
    if (!awb) return json({ ok: false, reason: "There is no consignment number on that order yet." });
    const out = await ask(cfg, ACTION.track, { bulk: [{ awb_no: awb }] });
    return json(readTracking(out));
  }

  // The order's state at EasyParcel, which is how a booking that answered badly is checked
  // WITHOUT booking a second parcel. Same reasoning as the courier's "Check the trip".
  if (action === "orderStatus") {
    const orderNo = String(args.orderNumber || "").trim();
    if (!orderNo) return json({ ok: false, reason: "There is no EasyParcel order number on that order yet." });
    const out = await ask(cfg, ACTION.orderStatus, { bulk: [{ order_no: orderNo }] });
    const why = reasonIn(out, "EasyParcel could not look that order up.");
    if (why) return json({ ok: false, reason: why });
    return json({ ok: true, status: out });
  }

  // ⚠️ THE MODE, SAID OUT LOUD. Demo and live are different hosts and a label booked in demo
  // is not a parcel anybody will collect — so the app can tell her which one she is in rather
  // than finding out when a customer waits for something that was never sent.
  if (action === "hello") {
    return json({ ok: true, provider: EASYPARCEL_KEY, env: cfg.host === hostFor("live") ? "live" : "demo" });
  }

  return json({ ok: false, reason: "That is not something this function knows how to do." }, 400);
});
