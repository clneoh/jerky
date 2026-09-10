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

const BASE = String(CONFIG.supabase.url).replace(/\/+$/, "");
const ANON = CONFIG.supabase.anonKey;

let lang = loadLang();
let devConfig = null; // { name, emails, wa } fetched once from the published storefront
let devLoaded = false;

function byId(id) {
  return document.getElementById(id);
}

function render() {
  applyTo(document, HOME, lang);
  const pills = document.querySelectorAll("#lang-switch .lang-pill");
  pills.forEach((b) => b.classList.toggle("is-on", b.dataset.lang === lang));
  renderDevLine();
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

// A WhatsApp number as it is written under the link, e.g. 601891336389 →
// "+60 18-913 36389". Anything that is not the usual 60 + 10 digits is shown
// plainly as "+<digits>" rather than mis-grouped.
function prettyWa(digits) {
  if (/^60\d{10}$/.test(digits)) {
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
async function loadPublished() {
  if (devLoaded) return;
  devLoaded = true;
  try {
    const res = await fetch(
      `${BASE}/rest/v1/storefront_config?select=data&id=eq.default`,
      { headers: { apikey: ANON } });
    if (!res.ok) return;
    const rows = await res.json().catch(() => null);
    const raw = Array.isArray(rows) && rows[0] ? rows[0].data : null;
    if (!raw) return;
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!cfg || typeof cfg !== "object") return;
    applyContacts(cfg);
    const name = text(cfg.developerName);
    const emails = Array.isArray(cfg.developerEmails)
      ? cfg.developerEmails.map((e) => String(e).trim()).filter(Boolean)
      : [];
    const wa = text(cfg.developerWhatsapp);
    devConfig = { name, emails, wa };
  } catch { /* offline — the page keeps what it shipped with */ }
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
  await loadPublished();
  renderDevLine();
}

if (typeof document !== "undefined") init();
