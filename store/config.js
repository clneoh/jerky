// ─────────────────────────────────────────────────────────────
//  STOREFRONT SETTINGS — fallback values for the customer page.
//  When live Supabase is configured, the backoffice publishes these from
//  Settings → Storefront, which overrides this file at runtime (no redeploy).
//  This file is only the starting point / offline fallback.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  // Her WhatsApp number: country code first, DIGITS ONLY, no "+", no spaces.
  // Malaysia: 012-345 6789 → "60123456789"
  whatsapp: "60123456789",

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
  // stamps on each product card). url/anonKey are "FILLME" until this business's
  // OWN Supabase project exists (never reuse the bakery's project). Leave both
  // empty ("") to hide availability entirely.
  supabase: {
    url: "FILLME",
    anonKey: "FILLME",
  },

  // What's on sale. price is in RM. unit is a short label (100g pouch / pack).
  // These are placeholder entries — the owner edits the real menu from the
  // backoffice, which publishes over this at runtime.
  products: [
    { name: "Chicken Jerky", price: 22, unit: "100g pouch" },
    { name: "Duck Jerky", price: 24, unit: "100g pouch" },
  ],

  // Optional social links, shown under the order button. Leave "" to hide.
  instagram: "",
  facebook: "",

  // TNG QR payment code — a hosted image URL, shown on the "Track your order"
  // card so customers can pay after ordering. The backoffice publishes this
  // from Settings → Storefront; this is only the offline fallback.
  tngQr: "",
};
