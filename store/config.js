// ─────────────────────────────────────────────────────────────
//  STOREFRONT SETTINGS — fallback values for the customer page.
//  When live Supabase is configured, the backoffice publishes these from
//  Settings → Storefront, which overrides this file at runtime (no redeploy).
//  This file is only the starting point / offline fallback.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  // Her WhatsApp number: country code first, DIGITS ONLY, no "+", no spaces.
  // Malaysia: 012-345 6789 → "60123456789"
  //
  // ⚠️ THIS MUST BE HER REAL NUMBER, AND IT WAS NOT — AND THE v346 SYNC PUT THE
  // WRONG ONE IN HERE. What follows is the bakery's story and munchies' warning
  // in one, because this project walked into it.
  //
  // v346 (bakery): it held the example number from the notes above —
  // 60123456789, which belongs to somebody else. This file is only the fallback,
  // so the published settings normally cover it; but it is the fallback for the
  // WORST moment, because the shop falls back to it exactly when the published
  // settings cannot be reached, which is also when the order cannot be placed. A
  // customer was being handed a stranger's WhatsApp at the one moment she most
  // needed to reach the baker.
  //
  // ⚠️⚠️ AND THE FIX ITSELF CROSSED OVER. The bakery's answer was its OWN number
  // — and the engine sync carried that line into THIS file, which had exactly the
  // same fault and needed her number instead. **An identity is the one thing a
  // shared engine must never copy** (see CLAUDE.md: never the bakery's CNAME, its
  // Supabase project or its seed data). 60169601268 is the bakery's; this is
  // munchies'.
  whatsapp: "60189136389",

  // The name customers see — her pet-treat business name.
  name: "Munchies Furkidz",

  // One-line tagline shown under the name.
  tagline: "Handmade dehydrated pet treats",

  // Delivery days: 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat 0=Sun
  // Same fixed delivery days as the bakery system — each one is a batch/posting
  // day for her treats.
  deliveryDays: [1, 3, 5],

  // Order cut-off time on the day before delivery, 24h format.
  cutoff: "18:00",

  // How many upcoming delivery dates to show.
  upcomingCount: 3,

  // Day capacity is set in the backoffice: each product's daily limit is added
  // together (e.g. 10 chicken pouches + 10 duck pouches = 20). This value is
  // only a fallback hint for the day-level sold-out check.
  capacity: 12,

  // Live availability via Supabase: the backoffice app posts slots left per day
  // (drives the sold-out date pill) and per product (drives the "Only N left"
  // stamps on each product card). These are this business's OWN project creds
  // (public by design — never the bakery's). Leave both empty ("") to hide
  // availability entirely.
  supabase: {
    url: "https://ircwozniiyywsowamixy.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY3dvem5paXl5d3Nvd2FtaXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Njc2MDQsImV4cCI6MjEwNDM0MzYwNH0.N3T87IOj2nnvKnHXeFM4DN9WR2js2N2R66Dc15edxIg",
  },

  // What's on sale. price is in RM. unit is a short label (100g pouch / pack).
  //
  // ⚠️ THIS LISTS ONLY WHAT THE SHOP REALLY SELLS (v347) — the rule came from the bakery and
  // applies here for the same reason. This file is the OFFLINE FALLBACK: what a customer sees
  // when the published settings cannot be reached, which is also when the order cannot be
  // placed. A fallback offering something nobody can order is worse than a shorter one.
  //
  // ⚠️ KEEP THIS IN STEP WITH WHAT IS PUBLISHED. It is the one thing here that can drift
  // silently, because the published settings cover it while the cloud answers.
  products: [
    { name: "Chicken Jerky", price: 22, unit: "100g pouch" },
    { name: "Duck Jerky", price: 24, unit: "100g pouch" },
  ],

  // Optional social links, shown under the order button. Leave "" to hide.
  instagram: "",
  facebook: "",

  // Policies shown on the shop (cancellation / refunds), under "Track your
  // order". The baker types the English text once in Settings → Storefront and
  // the app translates it; policyZh / policyMs carry the translations. Empty
  // hides the whole section — this is only the offline fallback.
  policy: "",
};
