// home.js — the homepage's site language switch (EN / 中文 / BM), its footer
// contact rows (WhatsApp / Instagram / Facebook, read from the published
// storefront settings) and the small "developer" credit line. Runs alongside
// reviews.js.
//
// Applying a language rewrites the tagged static text from home-lang.js in
// place; the visitor's choice is remembered on their device. Reviews.js listens
// for the same change so its own dynamic bits (form buttons, carousel labels)
// follow along.

import { applyTo, loadLang, rememberLang, pick } from "./i18n.js";
import { HOME } from "./home-lang.js";
import { CONFIG } from "./store/config.js";
import { bakeDaysText, publishedPrice, withCutoff } from "./home-facts.js";

const BASE = String(CONFIG.supabase.url).replace(/\/+$/, "");
const ANON = CONFIG.supabase.anonKey;

let lang = loadLang();
// What the homepage PRINTS that is hers to set, once the published settings arrive (v581). ⚠️ Both were
// typed into index.html while the shop read them from settings — changing one moved the shop and left the
// homepage saying the old thing.
let siteFacts = { cutoff: "", days: null };
let devConfig = null; // { name, emails, wa } fetched once from the published storefront
let devLoaded = false;
let retryTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function render() {
  applyTo(document, HOME, lang);
  renderSiteFacts();
  const pills = document.querySelectorAll("#lang-switch .lang-pill");
  // ⚠️⚠️ AND THE CHOSEN LANGUAGE IS SAID IN WORDS, NOT ONLY BY ITS BACKGROUND (v588). ⭐ The shop's own
  // point cards and day buttons got `aria-pressed` at v583; the language pills did not.
  pills.forEach((b) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle("is-on", on);
    if (b.setAttribute) b.setAttribute("aria-pressed", String(on));
  });
  renderDevLine();
}

// ⭐ THE TWO FACTS FROM HER SETTINGS, written into the translated lines AFTER they are applied — so every
// language switch keeps them (v581). ⚠️ The line's own shape stays the translator's: only the time TOKEN and
// the day words are replaced.
function renderSiteFacts() {
  if (siteFacts.cutoff) {
    for (const el of document.querySelectorAll('[data-i18n-html="n1Line"]')) {
      el.innerHTML = withCutoff(el.innerHTML, siteFacts.cutoff);
    }
  }
  const days = bakeDaysText(siteFacts.days, lang);
  if (days != null) {
    for (const el of document.querySelectorAll('[data-i18n="s1d"]')) el.textContent = days;
  }
}

function choose(next) {
  if (next === lang) return;
  lang = next;
  rememberLang(next);
  render();
  window.dispatchEvent(new CustomEvent("i18nchange", { detail: { lang } }));
}

function initSwitch() {
  const pills = document.querySelectorAll("#lang-switch .lang-pill");
  pills.forEach((b) => b.addEventListener("click", () => choose(b.dataset.lang)));
}

// Normalize a WhatsApp number to the digits wa.me needs (local "0" → "60"),
// the same rule the app uses for the bakery's own number.
function waDigits(n) {
  const digits = String(n || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
}

// A WhatsApp number as it is written under the link, e.g. 60189136389 →
// "+60 18-913 6389" (Malaysian grouping: the 2-digit mobile prefix, then 3, then
// the rest). A 12-digit number groups the same way. Anything else — a
// landline, a foreign number — is shown plainly as "+<digits>", never
// mis-grouped.
function prettyWa(digits) {
  if (/^60\d{9,10}$/.test(digits)) {
    return `+60 ${digits.slice(2, 4)}-${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

function text(v) {
  return typeof v === "string" ? v.trim() : "";
}

// The footer's own contact rows read the same published settings the order page
// reads, so the number and handles there agree with the app: change them in
// Settings → Storefront, publish, and this page follows. Anything left blank in
// the app leaves the value typed into the page alone (blank never wipes it).
function applyContacts(cfg) {
  const wa = waDigits(cfg.whatsapp);
  if (wa) {
    const link = byId("f-wa");
    if (link) link.href = `https://wa.me/${wa}`;
    const num = byId("f-wa-num");
    if (num) num.textContent = prettyWa(wa);
  }
  const ig = text(cfg.instagram);
  if (ig) {
    const link = byId("f-ig");
    if (link) {
      link.href = `https://www.instagram.com/${ig}/`;
      link.textContent = `Instagram — @${ig}`;
    }
  }
  const fb = text(cfg.facebook);
  if (fb) {
    const link = byId("f-fb");
    if (link) {
      link.href = `https://www.facebook.com/${fb}/`;
      link.textContent = `Facebook — ${fb}`;
    }
  }
}

// One read of the published storefront row feeds both the footer contacts above
// and the developer credit below, so the homepage agrees with the store.
// The developer credit uses the same published storefront data as the store,
// so the baker sets the name (+ email(s) and/or a WhatsApp number) once in the
// app and the homepage footer shows them after the next "publish". Until then
// the line stays hidden.
// ⚠️⚠️ ONE PLACE ARMS THE RETRY (v599). ⚠️ v598's timer sat in `catch`, so a 503 or a non-JSON answer —
// the two failures that do NOT throw — returned early and latched for the whole visit.
function armDevRetry() {
  if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; loadPublished(); }, 30000);
}

async function loadPublished() {
  if (devLoaded) return;
  // ⚠️⚠️ ONE FAILED REQUEST MUST NOT FREEZE THE SALE FACTS FOR THE WHOLE VISIT (v596). ⚠️ This latched
  // BEFORE the fetch, so a single failure (airplane mode, a 503) left the typed RM16 / Mon-Wed-Fri / 6:00PM on
  // the page while the shop polled and recovered — ⚠️ **the homepage could quote RM16 and the shop RM22 on the
  // same phone.** ⭐ The latch is set only once the read succeeded.
  try {
    const res = await fetch(
      `${BASE}/rest/v1/storefront_config?select=data&id=eq.default`,
      { headers: { apikey: ANON } });
    if (!res.ok) { armDevRetry(); return; }
    const rows = await res.json().catch(() => null);
    // ⚠️ A READ THAT DID NOT COME BACK AS ROWS IS A FAILURE, NOT AN EMPTY ANSWER — `null` here means the
    // JSON itself was unreadable, which must not latch either.
    if (!Array.isArray(rows)) { armDevRetry(); return; }
    const raw = rows[0] ? rows[0].data : null;
    if (!raw) return; // an empty table is a real answer: nothing is published
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!cfg || typeof cfg !== "object") { armDevRetry(); return; }
    applyContacts(cfg);
    const name = text(cfg.developerName);
    const emails = Array.isArray(cfg.developerEmails)
      ? cfg.developerEmails.map((e) => String(e).trim()).filter(Boolean)
      : [];
    const wa = text(cfg.developerWhatsapp);
    devConfig = { name, emails, wa };
    // ★★ AND THE CUT-OFF AND THE POSTING DAYS (v581). ⚠️ A malformed cut-off is ignored rather than printed;
    // an EMPTY day list is an answer — she has none open — and `bakeDaysText` says so with a dash.
    const cut = typeof cfg.cutoff === "string" ? cfg.cutoff.trim() : "";
    if (/^\d{1,2}:\d{2}$/.test(cut)) siteFacts.cutoff = cut;
    if (Array.isArray(cfg.deliveryDays)) siteFacts.days = cfg.deliveryDays;
    renderSiteFacts();
    devLoaded = true;   // ⭐ only now: a failed visit retries on the next call
  } catch {
    // ⚠️⚠️ AND IT ACTUALLY TRIES AGAIN (v598/v599). ⚠️ v596 stopped latching the failure, but nothing called
    // this function again — ⚠️ **so a homepage opened in a tunnel kept the typed 6:00PM for the whole visit
    // while the shop polled and recovered.** ⭐ One retry on a timer, and one the moment the phone is back online.
    armDevRetry();
  }
}

function mailHref(emails) {
  return `mailto:${emails.join(",")}`;
}

function devWaHref(number) {
  const digits = waDigits(number);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent("Hi!")}` : "";
}

// The footer credit: "Website by {name}", with a WhatsApp link (primary, opens
// a chat with a ready "Hi!") when a number is set, and the email address(es) as
// a smaller second line underneath. Needs a name and at least one of the two.
function renderDevLine() {
  const holder = byId("dev-line");
  if (!holder) return;
  holder.replaceChildren();
  if (!devConfig || !devConfig.name || (!devConfig.wa && !devConfig.emails.length)) return;
  const cream = "#f7efe2"; // the light text colour on jerky’s brown footer
  const credit = document.createElement("div");
  credit.style.color = cream;
  credit.textContent = `${pick(HOME, lang, "devBy")} ${devConfig.name}`;
  holder.appendChild(credit);
  const linkStyle = (extra = "") => `display:inline-block;margin:2px 8px 0;color:${cream};${extra}`;
  if (devConfig.wa) {
    const wa = document.createElement("a");
    wa.href = devWaHref(devConfig.wa);
    wa.style.cssText = linkStyle();
    wa.textContent = `💬 ${pick(HOME, lang, "devWa")}`;
    holder.appendChild(wa);
  }
  if (devConfig.emails.length) {
    const mail = document.createElement("a");
    mail.href = mailHref(devConfig.emails);
    mail.style.cssText = linkStyle("font-size:12px;opacity:0.85");
    mail.textContent = `✉ ${devConfig.emails.join(", ")}`;
    holder.appendChild(mail);
  }
}

async function init() {
  initSwitch();
  render();
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    // ⚠️ The phone coming back online is the moment to try (v598).
    window.addEventListener("online", () => loadPublished());
  }
  await loadPublished();
  renderDevLine();
}

if (typeof document !== "undefined") init();
