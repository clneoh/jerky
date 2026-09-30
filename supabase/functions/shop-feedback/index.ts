// supabase/functions/shop-feedback/index.ts
//
// Carries a customer's own words from the shop front to the developer email(s)
// the owner set in Settings → Website & developer.
//
// WHY THIS IS NOT `wish-mail`. That function is the owner's own software wish
// list and it refuses every caller without her owner session — correctly, since
// it sends wherever it is told. A customer browsing the shop has no session and
// never will, so the two cannot share a function.
//
// NOTHING ABOUT THE RECIPIENT COMES FROM THE CALLER. A public, unauthenticated
// endpoint that mails to an address the request supplies is an open relay: any
// IP on the internet could use it to mail any address, with this shop's
// verified domain signing the envelope. So the address list is read HERE, from
// the same published `storefront_config` row the shop page itself reads for its
// "Website by" line, and the caller may only ever supply the text. That single
// rule is this file's whole security design.
//
// The guards, and what each one is for:
//   • the honeypot — a `website` field no person sees and no person fills. A
//     filled one is a bot: the send is skipped, and the caller is told it worked,
//     because telling a bot it was refused is how it learns to stop filling it.
//   • length caps — a bounded email, and a bounded Resend bill.
//   • plain text — the body is sent as text, so nothing a customer types can
//     become markup in the developer's inbox.
//
// One-time setup: NOTHING. It reuses the RESEND_API_KEY and the verified sending
// domain `wish-mail` already runs on. Deploy with:
//   supabase functions deploy shop-feedback

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const MAX_MESSAGE = 4000;
const MAX_PAGE = 120;
const MAX_ORIGIN = 120;
const MAX_ENGINE = 16;
const MAX_RECIPIENTS = 5;

// Every mail this function sends says WHICH SHOP, WHICH BUILD and WHEN, in the same
// words the owner's own wish-list mail uses, so a developer reading two of them side by
// side is not reading two different formats. The date and the time are the OWNER'S OWN
// CLOCK (Penang, UTC+8), not the server's UTC and not the customer's device: it is the
// owner who reads this, and "16:52" should mean the same thing on every page she opens.
function stamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const at = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    console.error("[shop-feedback] supabase env not configured");
    return json({ error: "Supabase env is not configured" }, 500);
  }
  if (!resendKey) {
    console.error("[shop-feedback] RESEND_API_KEY secret is not visible to the function");
    return json({ error: "RESEND_API_KEY is not set — deploy with the secret first" }, 500);
  }

  let payload;
  try { payload = await req.json(); } catch { payload = null; }

  // The honeypot, read first. It is answered with the same shape a real send
  // gets, so a bot cannot tell a refusal from a success — which is the only way
  // a trap keeps working.
  if (String((payload && payload.website) || "").trim()) {
    console.log("[shop-feedback] honeypot filled — nothing sent");
    return json({ ok: true });
  }

  const message = String((payload && payload.message) || "").trim().slice(0, MAX_MESSAGE);
  const page = String((payload && payload.page) || "").trim().slice(0, MAX_PAGE);
  const origin = String((payload && payload.origin) || "").trim().slice(0, MAX_ORIGIN);
  const lang = String((payload && payload.lang) || "").trim().slice(0, 8);
  // Only ever digits and dots: the engine number goes into the SUBJECT, and a header is no
  // place for anything a caller chose the shape of. A build number that is not a build
  // number is dropped rather than printed.
  const engine = String((payload && payload.engine) || "").replace(/[^0-9.]/g, "").slice(0, MAX_ENGINE);
  if (message.length < 3) {
    console.error("[shop-feedback] empty message");
    return json({ error: "the message is empty" }, 400);
  }

  const recipients = await developerEmails(supabaseUrl, supabaseAnon);
  if (!recipients.length) {
    // No address is published, so there is nowhere for the words to go. Said
    // plainly rather than swallowed: the shop tells the customer to use the
    // WhatsApp link it already shows instead.
    console.error("[shop-feedback] no developer email is published");
    return json({ error: "no developer email is set" }, 503);
  }

  const sent = stamp();
  const datePart = sent.slice(0, 10);
  // Which project and which page, as one readable address. Either half may be missing —
  // an older cached page sends neither — and half an address is still better than none.
  const project = `${origin}${page}` || "the shop";
  const subject = oneLine(
    engine ? `Shop feedback · Engine v${engine} · ${datePart}` : `Shop feedback · ${datePart}`,
  );
  // The heading block comes FIRST and the customer's words last, in the same order the
  // owner's own wish-list mail uses: she reads two mails from the same system and they are
  // not two different formats. The blank line is what separates the block from the words —
  // a rule between them would only be a third format.
  const text = [
    `New feedback for the shop page${engine ? ` (Engine v${engine})` : ""}.`,
    `Project: ${project}`,
    `Sent: ${sent}`,
    ...(lang ? [`Written in ${languageName(lang)}.`] : []),
    "",
    message,
  ].join("\n");

  const from = Deno.env.get("RESEND_FROM") || "Munchies Furkidz wishes <wishlist@send.munchies.com.my>";
  console.log("[shop-feedback] sending via Resend from", from, "to", recipients.length, "recipient(s)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: recipients, subject, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[shop-feedback] Resend rejected the send (HTTP ${res.status}):`, detail.slice(0, 300));
    return json({ error: `Resend failed (HTTP ${res.status})` }, 502);
  }
  console.log("[shop-feedback] Resend accepted the send");
  return json({ ok: true });
});

// The developer's addresses, read server-side from the published config row.
// The shop page reads the same row for its "Website by" line, so the two can
// never disagree about who the developer is. The anon key is the same public one
// the shop already ships — this function holds no secret that key could reach.
async function developerEmails(supabaseUrl, supabaseAnon) {
  const base = String(supabaseUrl).replace(/\/+$/, "");
  const url = `${base}/rest/v1/storefront_config?select=data&id=eq.default&limit=1`;
  try {
    const res = await fetch(url, { headers: { apikey: supabaseAnon, Accept: "application/json" } });
    if (!res.ok) {
      console.error(`[shop-feedback] config read failed (HTTP ${res.status})`);
      return [];
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return [];
    // The published blob is a JSON string; a row that already holds an object is
    // read as it stands rather than thrown away.
    let data = row.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return []; }
    }
    const list = data && Array.isArray(data.developerEmails) ? data.developerEmails : [];
    return list
      .map((e) => String(e).trim())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      .slice(0, MAX_RECIPIENTS);
  } catch (err) {
    console.error("[shop-feedback] config read threw:", err && err.message);
    return [];
  }
}

// The shop asks in three languages, so which one the customer wrote in is worth
// knowing — but the mail is read by a person, so it says "English", never "en".
const LANG_NAMES = { en: "English", ms: "Malay", zh: "Chinese" };

function languageName(lang) {
  return LANG_NAMES[String(lang).toLowerCase()] || String(lang);
}

// A subject is one line. A customer's words never reach it — the page name does,
// and a newline in a header is a header-injection hole, so it is closed here
// rather than trusted not to happen.
function oneLine(s) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, 120);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
