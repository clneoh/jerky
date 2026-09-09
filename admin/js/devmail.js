// devmail.js — getting the owner's ideas to the developer.
//
// Two paths, one message (built by the same pure `buildWishMail`, so the email
// and the manual mailto row always say the same thing):
//
//   1. Automatic (best-effort, quiet): when a new wish is added on More, POST
//      the message to the `wish-mail` Supabase edge function, which emails it
//      to every developer address. Needs Shared data on + signed in. Until the
//      function is deployed this silently no-ops; the manual row still works.
//   2. Manual: More shows a "✉ Email the list" row that opens the same message
//      in the owner's own mail app (a mailto to all developer addresses). Works
//      with zero setup.
//
// Pure helpers (developerName/developerEmails/buildWishMail) run under Node for
// tests; fetch/localStorage live behind sendWishMail, which is best-effort.

import { ENGINE_VERSION } from "./version.js";
import { cachedToken } from "./supabase.js";
import { waNumber } from "./state.js";
import { wishList } from "./wishlist.js";

// The customer site's live address, so a dev email always names the project.
export const PROJECT_URL = "https://munchies.com.my";

// What the WhatsApp developer link opens with — the owner asked for a simple
// "just send me a hi!" style greeting; the sender then types the rest.
export const DEV_WA_TEXT = "Hi!";

export function developerName(state) {
  const dev = state.settings && state.settings.developer;
  return (dev && typeof dev === "object") ? String(dev.name || "").trim() : "";
}

export function developerEmails(state) {
  const dev = state.settings && state.settings.developer;
  if (!dev || typeof dev !== "object") return [];
  return Array.isArray(dev.emails)
    ? dev.emails.map((e) => String(e || "").trim()).filter(Boolean)
    : [];
}

// The optional WhatsApp Business number for the developer (digits, country
// code), typed in Settings → Website & developer. Blank when not set.
export function developerWhatsapp(state) {
  const dev = state.settings && state.settings.developer;
  return (dev && typeof dev === "object") ? String(dev.whatsapp || "").trim() : "";
}

// A wa.me link that opens a chat to `number` with `text` already typed, or
// null when the number is blank/empty after cleaning. Reuses the same
// digit-cleaning as the bakery's own number (waNumber: local "0" → 60).
export function waChatHref(number, text = DEV_WA_TEXT) {
  const digits = waNumber(number);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// The developer's ready-to-tap WhatsApp link, or null when no number is set.
export function devWaHref(state) {
  return waChatHref(developerWhatsapp(state));
}

// `now` is injectable so tests get a fixed timestamp.
export function buildWishMail(state, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const timePart = `${p(now.getHours())}:${p(now.getMinutes())}`;
  // Newest wish first — the one that just prompted the email sits on top.
  const lines = wishList(state).slice().reverse()
    .map((w) => `[${w.done ? "✓" : " "}] ${String(w.label || "").trim()}`)
    .filter(Boolean);
  const subject = `Wish list · Engine v${ENGINE_VERSION} · ${datePart}`;
  const body = [
    `New wishes for the Munchies Furkidz app (Engine v${ENGINE_VERSION}).`,
    `Project: ${PROJECT_URL}`,
    `Sent: ${datePart} ${timePart}`,
    "",
    "Full wish list:",
    ...(lines.length ? lines : ["(empty)"]),
    "",
    "— sent from the app's Software wish list",
  ].join("\n");
  return { subject, body };
}

// Send the built message to every developer email via the wish-mail edge
// function. Never throws, never blocks the owner — success is quiet, failure is
// reported to the caller (More shows one unobtrusive toast) so the manual mailto
// row remains the always-works fallback.
export async function sendWishMail(state) {
  const sb = state.settings && state.settings.supabase;
  const url = sb ? String(sb.url || "").replace(/\/+$/, "") : "";
  const to = developerEmails(state);
  if (!url || !to.length) return { ok: false, reason: "No developer email set yet" };
  const token = cachedToken();
  if (!token) return { ok: false, reason: "Shared data isn't signed in — use the ✉ Email the list row instead" };
  const { subject, body } = buildWishMail(state);
  try {
    const res = await fetch(`${url}/functions/v1/wish-mail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subject, body, to }),
    });
    if (!res.ok) return { ok: false, reason: `wish-mail failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err && err.message) ? err.message : "Couldn't reach the email service" };
  }
}
