// supabase/functions/wish-mail/index.ts
//
// Delivers the backoffice's "Software wish list" to the developer email(s) the
// owner set in Settings → Website & developer. The app POSTs the message built
// by admin/js/devmail.js (subject + body + the developer's `to` list) with the
// owner's Supabase session in the Authorization header.
//
// This function only relays: it validates that a real owner session made the
// call, then sends the note to each recipient through Resend. Until it is
// deployed (or RESEND_API_KEY is set) the app silently falls back to the manual
// "✉ Email the full wish list" mailto row, so nothing ever blocks the owner.
//
// One-time setup (developer side, ~10 min, no code):
//   1. Create a free Resend account (resend.com) and verify a sending domain —
//      a DNS TXT record for munchies.com.my (subdomain `send.` keeps the
//      main domain's mail untouched).
//   2. supabase functions secrets set RESEND_API_KEY <key>
//   3. Optionally RESEND_FROM "Name <wishlist@send.munchies.com.my>"
//      (defaults to wishlist@send.munchies.com.my — the Resend-verified domain).
//   4. supabase functions deploy wish-mail

import { createClient } from "jsr:@supabase/supabase-js@2";

// The app calls this function from munchies.com.my, a different origin than
// supabase.co, so the browser first sends a CORS preflight (OPTIONS) and then
// checks every response for these headers. Without them the browser blocks the
// request entirely (ERR_FAILED) before it reaches the function.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !supabaseAnon) {
    console.error("[wish-mail] supabase env not configured");
    return json({ error: "Supabase env is not configured" }, 500);
  }
  if (!token) {
    console.error("[wish-mail] request had no Authorization header");
    return json({ error: "Missing Authorization header" }, 401);
  }
  if (!resendKey) {
    console.error("[wish-mail] RESEND_API_KEY secret is not visible to the function");
    return json({ error: "RESEND_API_KEY is not set — deploy with the secret first" }, 500);
  }

  // A real, current owner session is required (the app sends its cached login
  // token). An invalid or expired token is refused here.
  const supabase = createClient(supabaseUrl, supabaseAnon);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.error("[wish-mail] session rejected:", error && (error.message || error));
    return json({ error: "Invalid or expired session" }, 401);
  }

  let payload;
  try { payload = await req.json(); } catch { payload = null; }
  const subject = String((payload && payload.subject) || "").trim().slice(0, 120);
  const body = String((payload && payload.body) || "").trim().slice(0, 20000);
  const to = Array.isArray(payload && payload.to)
    ? payload.to.map((e) => String(e).trim())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    : [];
  if (!subject || !body || !to.length) {
    console.error("[wish-mail] bad payload:", { hasSubject: !!subject, hasBody: !!body, toCount: to.length });
    return json({ error: "subject, body and at least one recipient are required" }, 400);
  }
  const recipients = to.slice(0, 5); // cap: never mail more than a dev list

  const from = Deno.env.get("RESEND_FROM") || "Munchies Furkidz wishes <wishlist@send.munchies.com.my>";
  console.log("[wish-mail] sending via Resend from", from, "to", recipients.length, "recipient(s)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: recipients, subject, text: body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[wish-mail] Resend rejected the send (HTTP ${res.status}):`, detail.slice(0, 300));
    return json({ error: `Resend failed (HTTP ${res.status})`, detail: detail.slice(0, 300) }, 502);
  }
  console.log("[wish-mail] Resend accepted the send");
  return json({ ok: true, sentTo: recipients.length });
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
