// store/app.js — customer order page: pick a date, add items, place an order.
// Orders go straight to the backoffice (Supabase incoming_orders) and fall back
// to a WhatsApp message if that fails. The name, menu and WhatsApp number are
// published by the backoffice (Settings → Storefront) and override the static
// config.js fallback at runtime.
import { CONFIG } from "./config.js";
import { poolCaps, poolGroups, clampPool, groupFor, poolPieces, closedReason, cancelDaysFor, strictestCancelDays, nextOrderable } from "./pool.js";
import { monthWeeks, addMonth, occColour, occDays, occStrength, occForDate, occSingleDay } from "./calendar.js";
import { normRules } from "../availability.js";
import { isLang, loadLang, pick, rememberLang, nameFor, descFor, unitFor, policyFor, applyTo } from "../i18n.js";
import { STORE } from "../store-lang.js";

// Day/month short names per site language. English is today's authoring default;
// fmtDay and the "Posting days" info card read by the visitor's language so a
// calendar cell or that row shows in 中文/BM too.
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const DAYS_MS = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
const MONTHS_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];

// Single-letter column headings for the calendar's top row. Kept separate from
// DAYS_* because those are three-letter names ("Mon") and the Chinese ones are
// whole words (周一) that cannot be sliced down to a column heading.
const DOW_EN = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const DOW_MS = ["A", "I", "S", "R", "K", "J", "S"];

// Full month names, for the calendar's title line only (MONTHS_* above are the
// short forms a date reads in). Chinese titles are built from the year instead.
const FULL_MONTHS_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const FULL_MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun",
  "Julai", "Ogos", "September", "Oktober", "November", "Disember"];

// Every lookup reads the saved choice fresh, so a language switch only has to
// repaint — no text is cached in a variable. These helpers stay DOM-free, so
// the Node tests (which default to English) keep asserting today's strings.
function t(key) { return pick(STORE, loadLang(), key); }

// Set from inside render(): repaints the language-dependent parts in place.
// render()'s closures own the cart, the chosen day and the fetched availability,
// so this is a hook rather than a second call to render() — re-rendering from
// outside would throw the customer's basket away, and reloading the page would
// re-fetch the menu, the slots and the storefront settings from Supabase (the
// pause you feel on a phone). Null until render() has run.
let repaintForLang = null;

// Set from inside render(): repaints the label line and the note under it, which
// are built from the cart's total and from the published codes rather than from
// data-i18n words. Called by renderBar, so every basket change repaints them.
// Null until render() has run.
let repaintCode = null;

// Fill %1, %2, … placeholders left-to-right.
function sub(s) {
  const args = Array.prototype.slice.call(arguments, 1);
  let out = String(s);
  for (let i = 0; i < args.length; i++) out = out.split(`%${i + 1}`).join(String(args[i]));
  return out;
}

// "Mon, Wed and Fri" — the visitor's own way of listing things, so a closed
// product's sentence does not read like a translation.
function listJoin(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  const lang = loadLang();
  if (lang === "zh") return `${items.slice(0, -1).join("、")}和${items[items.length - 1]}`;
  const and = lang === "ms" ? "dan" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

// A closedReason() rule as a bare clause, in the visitor's language and with
// the date written by fmtDay — so a Chinese or Malay visitor never reads an
// English weekday. Used on the product card (the advance-notice note) and quoted
// inside the basket notes.
function closedReasonClause(reason) {
  if (!reason) return "";
  if (reason.kind === "close") return sub(t("closedClose"), reason.days);
  if (reason.kind === "days") {
    return sub(t("closedWeekday"), listJoin((reason.days || []).map(dayName)));
  }
  if (reason.kind === "unmarked") return t("closedUnmarked");
  const day = fmtDay(new Date(`${reason.date}T00:00:00`));
  return sub(t(reason.kind === "from" ? "closedFrom" : "closedTo"), day);
}

// The card's own sentence: the clause, the advice when the rule has one, then
// the sentence-ending punctuation that language uses. Only two things reach a
// card: the advance-notice window, and — on a product the baker keeps listed —
// a day that is not one of its sell days ("Only available on Mon."). Every other
// closed product is off the menu altogether (see renderMenu).
function closedReasonText(reason) {
  if (!reason) return "";
  const advice = reason.kind === "close" ? t("closedCloseAdvice") : "";
  return closedReasonClause(reason) + advice + t("sentenceEnd");
}

function dayName(n) {
  const lang = loadLang();
  if (lang === "zh") return DAYS_ZH[n] || "";
  if (lang === "ms") return DAYS_MS[n] || "";
  return DAYS_EN[n] || "";
}

function dowNames() {
  const lang = loadLang();
  if (lang === "zh") return DOW_ZH;
  if (lang === "ms") return DOW_MS;
  return DOW_EN;
}

// The calendar's title for a month — "September 2026", "2026年9月", "September
// 2026". Chinese puts the year first, so it cannot be built by concatenation.
function monthTitle(year, month) {
  const lang = loadLang();
  if (lang === "zh") return `${year}年${month + 1}月`;
  const names = lang === "ms" ? FULL_MONTHS_MS : FULL_MONTHS_EN;
  return `${names[month]} ${year}`;
}

// "16 Sep" — a date without the weekday, for the Sold out note under the grid.
// fmtDay is the full "Wed, 16 Sep" and too long to sit in a line.
function shortDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  const lang = loadLang();
  const m = (lang === "zh" ? MONTHS_ZH : lang === "ms" ? MONTHS_MS : MONTHS_EN)[d.getMonth()];
  return lang === "zh" ? `${m}${d.getDate()}日` : `${d.getDate()} ${m}`;
}

// Normalize a customer's WhatsApp number to the digits-only international form
// wa.me links require (local leading "0" → "+60"). Mirror of admin/js/state.js,
// kept here so the store has no dependency on the moved backoffice modules.
export function waNumber(n) {
  const digits = String(n || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
}

// Bring the customer to the day they have just been given: the delivery calendar
// above the menu, where the chosen day is written out in words. The same idea as
// the backoffice jumping to an order it was just told about.
function revealCalendar() {
  const cal = document.getElementById("dates");
  if (cal && typeof cal.scrollIntoView === "function") {
    cal.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

// The `via` query string on a referral link (?via=60123456789) is the referrer's
// WhatsApp digits. Read to clean digits (or "" when absent) so the order can be
// stamped with who referred it. The shop never reads order history or discounts —
// the stamp just tells the bakery who to thank/credit.
export function parseVia(search) {
  return waNumber(new URLSearchParams(String(search || "")).get("via"));
}

function currentVia() {
  return (typeof location !== "undefined" && location.search)
    ? parseVia(location.search) : "";
}

// The `c` query string (?c=K3X9) is the code on the printed label the customer
// scanned. Kept as typed (upper-cased) so it matches the code she created; the
// page then looks it up in the published list. An unknown or retired code simply
// matches nothing — the shop still works, it just says nothing about an offer.
export function parseCode(search) {
  const raw = new URLSearchParams(String(search || "")).get("c");
  return String(raw || "").trim().toUpperCase();
}

// The code the printed label's own link carried. Only a page load can set it, so
// it is read fresh rather than cached.
export function urlCode() {
  return (typeof location !== "undefined" && location.search)
    ? parseCode(location.search) : "";
}

// What the customer has put in the box themselves, or "" when it is empty. Read
// as a value of its own rather than as "the code in force": whether the box holds
// anything is what tells the page the customer did this on purpose — including
// when they typed the very code the label's link already carried, which is a
// question and deserves an answer.
export function boxCode() {
  const box = (typeof document !== "undefined" && document.getElementById)
    ? document.getElementById("code-input") : null;
  return box && box.value != null ? String(box.value).trim().toUpperCase() : "";
}

// The code in force on this page: what the customer typed in the box, else the
// label's own code from the link. One reader for the offer line, the note under
// it and the order stamp, so all three can never disagree. A customer who came in
// on a label and types nothing keeps that label; typing another code replaces it,
// and clearing the box and applying puts the label back.
export function currentCode() {
  return boxCode() || urlCode();
}

// The published record for the code in the address bar, or null. Read from the
// storefront config the app already fetched — the shop never invents a code.
function codeInfo(cfg, code) {
  const list = Array.isArray(cfg && cfg.codes) ? cfg.codes : [];
  return list.find((c) => c && String(c.code || "").toUpperCase() === code) || null;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function upcomingDates(cfg) {
  const out = [];
  const now = new Date();
  for (let i = 1; out.length < cfg.upcomingCount && i < 365; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (cfg.deliveryDays.includes(d.getDay())) out.push(d);
  }
  return out;
}

// Whether a delivery day can still be ordered: orders close at `cutoff`
// (e.g. "18:00") the day BEFORE delivery, so Wednesday is orderable only
// until 6pm Tuesday. No cutoff configured → always open.
export function isOpen(cfg, d, now = new Date()) {
  const parts = String((cfg && cfg.cutoff) || "").split(":");
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return true;
  const deadline = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, hh, mm, 0, 0);
  return now.getTime() < deadline.getTime();
}

export function fmtDay(d) {
  const lang = loadLang();
  if (lang === "zh") return `${MONTHS_ZH[d.getMonth()]}${d.getDate()}日 ${DAYS_ZH[d.getDay()]}`;
  if (lang === "ms") return `${DAYS_MS[d.getDay()]}, ${d.getDate()} ${MONTHS_MS[d.getMonth()]}`;
  return `${DAYS_EN[d.getDay()]}, ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
}

export function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Which dates the calendar offers. When the backoffice has published real delivery
// dates (rows dated today or later), those win — including dates that don't
// match the configured weekday pattern (e.g. an extra Thursday the baker added
// in the app). Falls back to the generated weekday list only when nothing is
// published yet.
export function resolveDates(generated, dayRows, today = dateKey(new Date())) {
  if (!Array.isArray(dayRows)) return generated;
  const published = dayRows
    .map((r) => r && r.date)
    .filter((d) => d && d >= today)
    .sort();
  if (!published.length) return generated;
  return published.map((d) => new Date(`${d}T00:00:00`));
}

// One entry per delivery date, given the live day-level availability map
// ({ 'YYYY-MM-DD': slots_left }): the day itself and whether it is already
// fully booked. The calendar draws from this and the product cards carry the
// per-product counts. Language-free on purpose — every label the customer reads
// is built at paint time so it follows the language switch.
export function daySpecs(dates, availMap = {}) {
  return dates.map((d) => {
    const left = availMap[dateKey(d)];
    return { date: d, soldOut: left != null && left <= 0 };
  });
}

export function buildMessage(cfg, order) {
  const lines = order.lines
    .map((l) => `• ${l.name} ×${l.qty} — RM${(l.qty * l.price).toFixed(2)}`)
    .join("\n");
  let msg = `New order · ${cfg.name} 🐾\n`;
  msg += `📅 ${order.date}\n`;
  msg += `${lines}\n`;
  msg += `💰 Total: RM${order.total.toFixed(2)}`;
  if (order.fulfillment) {
    const method = order.fulfillment === "courier" ? "Post (nationwide)" : "Collect (local)";
    msg += `\n📦 ${method}`;
    if (order.fulfillment === "courier" && order.address) msg += `\n📍 ${order.address}`;
  }
  if (order.customer) msg += `\n👤 ${order.customer}`;
  if (order.note) msg += `\n📝 ${order.note}`;
  return msg;
}

// Merge a config published by the backoffice over the local fallback. Arrays
// are replaced wholesale (not key-merged), the Supabase connection is never
// overridden, and malformed values fall back to the local ones. Returns a new
// object; base is left untouched.
export function mergeStorefront(base, remote) {
  if (!remote || typeof remote !== "object") return { ...base };
  const out = { ...base };
  for (const key of ["whatsapp", "name", "tagline", "instagram", "facebook", "cutoff", "policy", "policyZh", "policyMs"]) {
    if (typeof remote[key] === "string" && remote[key].trim()) out[key] = remote[key].trim();
  }
  for (const key of ["capacity", "upcomingCount"]) {
    const n = Number(remote[key]);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  if (Array.isArray(remote.deliveryDays)) {
    const days = remote.deliveryDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (days.length) out.deliveryDays = days;
  }
  // The standard days the bakery markets around, for the bands and boxes on the
  // customer's calendar and the bubble that names one when it is tapped. The app
  // publishes only marks that ARE built-in standard days, but the shop validates
  // every row again on its own terms: anything half-formed or unrecognised is
  // dropped here rather than drawn, so a malformed row can never reach the page.
  //
  // Replaced wholesale, unlike deliveryDays above: the app publishes a complete
  // snapshot, so an empty list is a real instruction — "she has no standard days
  // marked" — and has to clear the marks an already-open page is still showing.
  // An empty list draws nothing at all, so it can never break the shop.
  if (Array.isArray(remote.occasions)) {
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const COLOURS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"];
    out.occasions = remote.occasions
      .filter((o) => o && typeof o === "object"
        && typeof o.label === "string" && o.label.trim()
        && ISO.test(String(o.from || "")) && ISO.test(String(o.to || ""))
        && o.to >= o.from && COLOURS.includes(o.colour))
      .map((o) => ({ label: o.label.trim(), from: o.from, to: o.to, colour: o.colour }))
      .sort((a, b) => a.from.localeCompare(b.from));
  }
  if (Array.isArray(remote.products)) {
    const products = remote.products
      .filter((p) => p && typeof p === "object" && String(p.name || "").trim())
      .map((p) => {
        const out = {
          name: String(p.name).trim(),
          price: Number(p.price) || 0,
          unit: String(p.unit || "").trim() || "piece",
        };
        const desc = p && String(p.description || "").trim();
        if (desc) out.description = desc;
        // Optional shop names in 中文/BM — the English `name` stays the key for
        // availability, the pool and the order; the translated names only dress
        // up what the customer reads on the card.
        for (const k of ["nameZh", "nameMs"]) {
          const v = p && typeof p[k] === "string" && p[k].trim();
          if (v) out[k] = v;
        }
        // Translated description line + selling-unit word, published only when
        // written (blank keeps the English text on the card).
        for (const k of ["descZh", "descMs", "unitZh", "unitMs"]) {
          const v = p && typeof p[k] === "string" && p[k].trim();
          if (v) out[k] = v;
        }
        // A value pack carries component {name, qty}: which product's pool it
        // shares, and how many pieces each pack takes. Kept so the storefront
        // can cap a mixed cart and run the advance-order window.
        const c = p && p.component;
        const baseName = c && String(c.name || "").trim();
        if (baseName && Number(c.qty) > 0) out.component = { name: baseName, qty: Number(c.qty) };
        // Per-product date rules: orders close N days before delivery, and/or a
        // fixed from–to window of delivery dates. Kept so the storefront can
        // gate this product on the date the customer picks.
        const close = Number(p.closeDays);
        if (p.closeDays != null && Number.isInteger(close) && close >= 0) out.closeDays = close;
        for (const k of ["validFrom", "validTo"]) {
          const v = p && p[k];
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
        }
        // The days this product SELLS, marked on its own calendar: spans, each with
        // the weekdays it covers (none = every day of the span, either end may be
        // open). Validated here on the shop's own terms — availability.js drops a
        // malformed span rather than trusting it — because this list is the only
        // thing that decides whether the customer sees the product at all. An empty
        // list is dropped, which reads as "no marks" and so keeps every day open.
        const marked = normRules(p.sellRules).slice(0, 40);
        if (marked.length) out.sellRules = marked;
        // The change/cancel window the baker states for this product. Blank
        // stays absent, so it never counts in a mixed order's strictest window.
        const cancel = Number(p.cancelDays);
        const cancelSet = p.cancelDays != null && !(typeof p.cancelDays === "string" && p.cancelDays.trim() === "");
        if (cancelSet && Number.isInteger(cancel) && cancel >= 0) out.cancelDays = cancel;
        // Keep this product on the menu when it cannot be ordered, instead of
        // dropping it — the few hot items a customer comes back looking for.
        // Absent (the default) leaves this page reading every product as today.
        if (p.alwaysListed === true) out.alwaysListed = true;
        return out;
      });
    if (products.length) out.products = products;
  }
  // The developer credit shown in the store footer (and on the homepage) — set
  // once in the app's Settings and republished. Hidden until both exist.
  if (typeof remote.developerName === "string" && remote.developerName.trim()) out.developerName = remote.developerName.trim();
  if (Array.isArray(remote.developerEmails)) {
    const emails = remote.developerEmails.map((e) => String(e).trim()).filter(Boolean);
    if (emails.length) out.developerEmails = emails;
  }
  if (typeof remote.developerWhatsapp === "string" && remote.developerWhatsapp.trim()) {
    out.developerWhatsapp = remote.developerWhatsapp.trim();
  }
  // The printed QR labels. Published by the app, but every row is re-checked here
  // on the shop's own terms rather than trusted: a malformed row is dropped, and
  // an offer is only kept when it is a real type with a positive amount, so a
  // half-written record can never put a wrong number in front of a customer.
  // Replaced wholesale (like occasions) — the app publishes a complete snapshot,
  // so retiring a code really does take it off a page that is already open.
  if (Array.isArray(remote.codes)) {
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const KINDS = ["shop", "promo", "intro", "plain"];
    out.codes = remote.codes
      .filter((c) => c && typeof c === "object" && String(c.code || "").trim())
      .map((c) => {
        const row = {
          code: String(c.code).trim().toUpperCase(),
          kind: KINDS.includes(String(c.kind || "")) ? String(c.kind) : "plain",
        };
        // The label's own words for the landing page (heading/body + 中文/BM), and
        // the two names the shop's banner states. Each is only carried when it was
        // really written — a blank is what lets /taster/ fall back to its own line.
        const wordy = ["heading", "body", "headingZh", "bodyZh", "headingMs", "bodyMs"];
        for (const k of [...wordy, "partnerName", "productName"]) {
          const v = c && typeof c[k] === "string" && c[k].trim();
          if (v) row[k] = c[k].trim();
        }
        const o = c && c.offer;
        const type = o && String(o.type || "");
        const value = o && Number(o.value);
        if (type && (type === "rm" || type === "pct") && value > 0) {
          row.offer = {
            type,
            value,
            minSpend: Math.max(0, Number(o.minSpend) || 0),
            to: o && ISO.test(String(o.to || "")) ? String(o.to) : "",
            newOnly: !!(o && o.newOnly === true),
            cur: String((o && o.cur) || "").trim() || "RM",
          };
        }
        return row;
      });
  }
  // The landing page's own copy. Strings only, kept when non-empty, so a blank box
  // in the app leaves this page's own fallback wording in place rather than
  // blanking a line a customer is reading.
  if (remote.taster && typeof remote.taster === "object") {
    const t = {};
    for (const k of ["heading", "headingZh", "headingMs", "body", "bodyZh", "bodyMs", "instagram", "shop"]) {
      const v = remote.taster[k];
      if (typeof v === "string" && v.trim()) t[k] = v.trim();
    }
    if (remote.taster.askPet === false) t.askPet = false;
    if (remote.taster.follow === false) t.follow = false;
    out.taster = t;
  }
  return out;
}

// Try to hand the order to the backoffice's incoming_orders table. Returns
// {ok:true} on success; any failure falls back to the WhatsApp message. A
// 10s timeout stops a stalled network from leaving the button stuck on
// "Sending…" forever.
export async function placeOrder(order) {
  const sb = CONFIG.supabase;
  if (!sb || !sb.url || !sb.anonKey) return { ok: false };
  const base = String(sb.url).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base}/rest/v1/incoming_orders`, {
      method: "POST",
      headers: {
        apikey: sb.anonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ data: JSON.stringify(order) }]),
      signal: controller.signal,
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// Show the order confirmation. Accepts a string (plain) or an array of nodes
// (a titled card). Scrolls it into view so the customer sees a response right
// away instead of tapping the button again.
function showConfirm(content, kind = "ok") {
  const box = document.getElementById("confirm-msg");
  if (!box) return;
  box.className = `confirm-msg ${kind}`;
  box.replaceChildren(...(Array.isArray(content) ? content : [document.createTextNode(String(content))]));
  box.hidden = false;
  if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "center", behavior: "smooth" });
}

function waUrl(order, dayLabel) {
  const msg = buildMessage(CONFIG, { ...order, date: dayLabel });
  return `https://wa.me/${waNumber(CONFIG.whatsapp)}?text=${encodeURIComponent(msg)}`;
}

// window.open after an await can be blocked as a popup on some phones — treat a
// null result as "not opened" so the confirmation falls back to a tappable link.
function tryOpenWa(url) {
  try {
    const w = window.open(url, "_blank");
    return !!w;
  } catch {
    return false;
  }
}

// A wa.me link that opens a chat to the developer's WhatsApp number with "Hi!"
// ready to send — same digit-cleaning as the bakery's own number. The owner
// types the number (digits, country code) once in Settings → Website & developer.
function devWaHref(number) {
  const digits = waNumber(number);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent("Hi!")}` : "";
}

// The small "Website by {name}" credit in the store footer. The developer's
// WhatsApp (when the baker set a number) is the primary link and opens a chat
// with a ready "Hi!"; the email address(es) stay as a smaller second line — the
// wish-list email still uses them. Reads the same published storefront data as
// the homepage, so it shows only once the baker has set a developer name in the
// app and republished.
function renderDevFoot(cfg) {
  const holder = document.getElementById("dev-foot");
  if (!holder) return;
  holder.replaceChildren();
  const name = cfg && typeof cfg.developerName === "string" ? cfg.developerName.trim() : "";
  const emails = Array.isArray(cfg && cfg.developerEmails)
    ? cfg.developerEmails.map((e) => String(e).trim()).filter(Boolean)
    : [];
  const wa = cfg && typeof cfg.developerWhatsapp === "string" ? cfg.developerWhatsapp.trim() : "";
  if (!name || (!wa && !emails.length)) {
    holder.hidden = true;
    return;
  }
  holder.hidden = false;
  holder.appendChild(el("div", { class: "dev-note" }, `${t("devBy")} ${name}`));
  if (wa) {
    holder.appendChild(el("a", { class: "dev-wa", href: devWaHref(wa), target: "_blank", rel: "noopener" }, `💬 ${t("devWa")}`));
  }
  if (emails.length) {
    holder.appendChild(el("a", { class: "dev-mail", href: `mailto:${emails.join(",")}` }, `✉ ${emails.join(", ")}`));
  }
}

// The static header parts (name, tagline, delivery days, social links). Kept
// separate so a later-published config can re-render just these.
export function renderStatic(cfg) {
  document.title = `${t("titleWord")} · ${cfg.name}`;
  document.getElementById("name").textContent = cfg.name;
  document.getElementById("tagline").textContent = cfg.tagline;
  document.getElementById("eyebrow").textContent = sub(t("madeToOrder"), cfg.cutoff);

  const days = cfg.deliveryDays.map((n) => dayName(n)).join(", ");
  document.getElementById("delivery-days").textContent = days;
  document.getElementById("cutoff").textContent = sub(t("beforeVal"), cfg.cutoff);

  const social = document.getElementById("social");
  const links = [];
  if (cfg.instagram) links.push(el("a", { href: `https://instagram.com/${cfg.instagram}`, target: "_blank", rel: "noopener" }, "📷 Instagram"));
  if (cfg.facebook) links.push(el("a", { href: `https://facebook.com/${cfg.facebook}`, target: "_blank", rel: "noopener" }, "📘 Facebook"));
  social.replaceChildren(...links);

  // The baker's policies text (cancellation, refunds) — English until she adds a
  // translation in the app, hidden entirely while the box is empty. Written as
  // text, never HTML; the CSS keeps the line breaks she typed.
  const policyBox = document.getElementById("policy-box");
  if (policyBox) {
    const value = policyFor(cfg, loadLang());
    const policyText = document.getElementById("policy-text");
    if (policyText) policyText.textContent = value;
    policyBox.hidden = !value;
  }

  renderDevFoot(cfg);
}

// A referral-link visitor (?via=…) sees one amount-free line near the top of the
// page. Deliberately amount-free: the bakery's scheme numbers are private and
// changeable, and she quotes the real figure in her WhatsApp confirmations.
function renderReferralBanner() {
  const box = document.getElementById("referral-banner");
  if (!box) return;
  box.hidden = !currentVia();
}

// The offer a label still actually carries today, or null. The app publishes an
// offer only while it was live when she last published it, and a code's start date
// is deliberately never published — so the one thing this page can check for
// itself is that the end date has not gone by while the settings sat there. The
// landing page applies the same rule (taster/app.js offerWords); both the offer
// line and the note below it read this, so the two can never disagree.
export function liveCodeOffer(info, today = dateKey(new Date())) {
  const off = info && info.offer;
  if (!off) return null;
  if (off.to && today > off.to) return null;
  return off;
}

// A visited label (?c=…) sees what that label offered, in words. It is stated,
// never applied: the shop does not touch the total. The amount is hers to give
// when she confirms on WhatsApp and can see the whole order — the same rule the
// referral line above follows, so the customer is never told one thing by the
// label and another by the sum. A retired code, or one whose offer has run out,
// shows nothing at all: the link still opens, the shop just says nothing extra.
function renderCodeBanner(cfg) {
  const box = document.getElementById("code-banner");
  if (!box) return;
  const code = currentCode();
  const info = code ? codeInfo(cfg, code) : null;
  const offer = liveCodeOffer(info);
  const parts = [];
  if (offer) {
    const cur = offer.cur || "RM";
    const amount = offer.type === "pct"
      ? `${offer.value}%`
      : `${cur}${offer.value}`;
    parts.push(t("codeOff").replace("%1", amount));
    if (offer.minSpend > 0) parts.push(t("codeMin").replace("%1", `${cur}${offer.minSpend}`));
    if (offer.newOnly) parts.push(t("codeNew"));
    if (offer.to) parts.push(t("codeUntil").replace("%1", shortDay(offer.to)));
  } else if (info && info.partnerName) {
    // A shop's label with no offer still says where the treat came from.
    parts.push(t("codeFrom").replace("%1", info.partnerName));
  }
  // Blank it as well as hide it: a hidden node that still holds the last code's
  // offer is one line-change away from showing a customer a sentence about a
  // label they never scanned.
  if (!parts.length) { box.textContent = ""; box.hidden = true; return; }
  box.textContent = `🎁 ${parts.join(" · ")}`;
  box.hidden = false;
}

// What happens to the offer the label promises, said under it. Two things are
// stated and one is worked out, and none of them touches the total: the money
// comes off by hand at the WhatsApp confirmation, so the customer is never told
// one thing by the label and another by the sum. The one subtraction the page
// does make is the shortfall, and it is measured off the bar's own total (never a
// fresh sum) so this line can never disagree with the number on screen.
//
// A code the page cannot use is answered when the customer typed it — they acted
// and the page owed them an answer — and left silent when it came off a scanned
// link, where the label is already in someone's hand and the link still opens.
function renderCodeNote(cfg, total) {
  const box = document.getElementById("code-note");
  if (!box) return;
  const code = currentCode();
  // Whether the box holds anything, not whether it differs from the link: typing
  // the label's own code in is still the customer asking, and still deserves the
  // answer a scanned label does not need.
  const typed = boxCode() !== "";
  const say = (text) => {
    const show = Boolean(text) && typed;
    box.textContent = show ? text : "";
    box.hidden = !show;
  };
  if (!code) { box.textContent = ""; box.hidden = true; return; }
  const info = codeInfo(cfg, code);
  if (!info) { say(t("codeUnknown")); return; }
  const offer = liveCodeOffer(info);
  // A label with no live offer: nothing to promise. A shop's label already spoke
  // through the banner, so only the typed path needs an answer here.
  if (!offer) { say(info.partnerName ? "" : t("codeNotePlain")); return; }
  const cur = offer.cur || "RM";
  const min = Number(offer.minSpend) || 0;
  if (min > 0 && total < min) {
    box.textContent = sub(t("codeNoteAdd"), `${cur}${(min - total).toFixed(2)}`);
    box.hidden = false;
    return;
  }
  box.textContent = t("codeNoteLater");
  box.hidden = false;
}

export function render() {
  renderStatic(CONFIG);
  const dateWrap = document.getElementById("dates");
  const menu = document.getElementById("menu");
  const cart = new Map();
  let selected = null;
  let avail = null;      // { 'YYYY-MM-DD': slots_left } — day-level, for the calendar
  let prodAvail = null;  // { 'YYYY-MM-DD': { product: slots_left } } — for the item stamps
  let dayRows = null;    // published delivery-date rows — the real dates win
  let dates = upcomingDates(CONFIG);
  // A product's date rules (closes X days before delivery / a from–to window)
  // compare each delivery date to today, so its reference is fixed at load.
  const todayKey = dateKey(new Date());

  const renderMenu = () => {
    const byProduct = prodAvail && selected ? prodAvail[selected] || {} : {};
    const groups = poolGroups(CONFIG.products);
    const cards = [];
    for (const p of CONFIG.products) {
      const lang = loadLang();
      const group = groupFor(groups, p);
      const baseLeft = group && byProduct[group.baseName] != null
        ? Number(byProduct[group.baseName]) : undefined;
      const caps = group && Number.isFinite(baseLeft) ? poolCaps(group, baseLeft, cart) : null;
      // A product's own date rules decide whether it is on TODAY's menu at all.
      // Not sold on the chosen delivery day → it is simply not there: the customer
      // does not see a thing they cannot have. Two exceptions keep the card and
      // say so instead: the baker's advance notice (that product IS sold on the
      // day, it only has to be ordered earlier), and a product she has switched to
      // stay listed — the few hot items a customer comes back looking for, whose
      // absence would otherwise read as "they stopped making it". A product with
      // no marks at all (value packs included) sells on any open date.
      const closed = closedReason(p, selected, todayKey);
      const kept = closed && closed.kind !== "close" && p.alwaysListed === true;
      if (closed && closed.kind !== "close" && !kept) continue;
      const reason = closedReasonText(closed);
      // A day this product is not sold on at all, as opposed to a sold-out day
      // (a sell day with nothing left). The two wear different stamps, and a kept
      // product computes as zero left, so this has to be decided first.
      const unavailable = kept;

      // `left` drives the stamp + stepper cap. A live pool member is capped by
      // the shared pool (its pieces compete with every other pack/single in the
      // cart); a gated product on a too-near/out-of-window date reads as sold
      // out regardless. Anything else keeps its own published row.
      const ownLeft = byProduct[p.name] != null ? Number(byProduct[p.name]) : undefined;
      const left = reason ? 0 : (caps ? caps.get(p.name) : ownLeft);
      const qty = cart.get(p.name) || 0;
      const soldOut = left != null && left <= 0;
      const qtyLabel = el("span", { class: "stepper-val" }, String(qty));
      // A stepper move repaints the whole menu: a pool card needs it (every
      // sibling's cap/stamp depends on this quantity) and so does every
      // Next-available line, which is a control only while the basket is empty.
      // The bar refreshes either way (count/total/button).
      const redraw = () => { renderMenu(); renderBar(); };
      const dec = el("button", { class: "step-btn", onclick: () => {
        const q = Math.max(0, (cart.get(p.name) || 0) - 1);
        if (q === 0) cart.delete(p.name); else cart.set(p.name, q);
        qtyLabel.textContent = String(q);
        redraw();
      } }, "−");
      const cap = left != null && left > 0 ? left : 99;
      const inc = el("button", { class: "step-btn", onclick: () => {
        const q = Math.min(cap, (cart.get(p.name) || 0) + 1);
        cart.set(p.name, q);
        qtyLabel.textContent = String(q);
        redraw();
      } }, "+");
      if (soldOut) { dec.disabled = true; inc.disabled = true; }
      const stamp = left != null
        ? el("span", { class: (unavailable || soldOut) ? "prod-stamp soldout" : "prod-stamp" },
            unavailable ? t("unavailable") : soldOut ? t("soldOut") : sub(t("onlyLeft"), left))
        : null;
      const note = reason ? el("p", { class: "prod-note" }, reason) : null;
      // A product the baker keeps listed names the next date a customer can
      // actually have it, and how many are left that day when a daily limit
      // publishes a count. No date in the published window → no line, rather
      // than a guess.
      const next = (unavailable || soldOut) && p.alwaysListed === true
        ? nextOrderable({
            product: p,
            dates: dates.map(dateKey),
            after: selected,
            prodAvail,
            groups,
            today: todayKey,
          })
        : null;
      // The line is a control while the basket is empty (v99): tapping it orders
      // for the day it names, instead of making the customer hunt for that date in
      // the calendar. It reads the same either way; the arrow and the pulse say it
      // can be tapped.
      //
      // With something already in the basket it is a plain label instead. Taking a
      // day then would move the WHOLE order to a new date and drop whatever does
      // not fit there — a rearrangement the customer never asked for, from a tap on
      // a product line. To order for another day they pick it on the calendar, where
      // moving the order is what they mean. (Cart changes repaint this menu, so the
      // label and the control are always the right one for the basket in hand.)
      const nextNote = next
        ? el("button", {
            class: `prod-note prod-next${cart.size ? " off" : ""}`,
            type: "button",
            onclick: () => {
              if (cart.size) {
                return menuNotice(sub(t("nextBlockedBasket"),
                  fmtDay(new Date(`${selected}T00:00:00`))));
              }
              selected = next.key;   // the day they were just offered
              rerender();            // the card in front of them becomes orderable
              revealCalendar();      // and the calendar above names the chosen day
            },
          },
            next.left != null
              ? sub(t("nextAvailableLeft"), fmtDay(new Date(`${next.key}T00:00:00`)), next.left)
              : sub(t("nextAvailable"), fmtDay(new Date(`${next.key}T00:00:00`))))
        : null;
      // The baker's change/cancel window for this product, when one is stated
      // (blank, and the "no advance limit" 0, hide it). Purely informational:
      // it tells the customer when to ask, and never blocks anything.
      const cancelDays = cancelDaysFor(p);
      const cancelNote = cancelDays != null && cancelDays >= 1
        ? el("p", { class: "prod-note prod-cancel" },
            sub(t(cancelDays === 1 ? "cancelNoteOne" : "cancelNote"), cancelDays))
        : null;
      // The card reads in the visitor's language: translated name/description/
      // unit when the product has them, else the English text.
      const desc = p && descFor(p, lang);
      cards.push(el("div", { class: `card menu-item${soldOut ? " soldout" : ""}` },
        el("div", { class: "card-head" },
          el("div", {},
            el("p", { class: "card-title" }, nameFor(p, lang)),
            el("p", { class: "card-sub" }, `RM${p.price.toFixed(2)} / ${unitFor(p, lang)}`),
            desc ? el("p", { class: "prod-desc" }, desc) : null),
          stamp),
        el("div", { class: "stepper" }, dec, qtyLabel, inc),
        note,
        nextNote,
        cancelNote));
    }
    // Every product marked off today leaves nothing at all — say so rather than
    // showing a blank space where the menu should be.
    menu.replaceChildren(...(cards.length ? cards : [el("p", { class: "card-sub" },
      t("noMenuToday"))]));
  };

  // Live slots left for `name` on the day currently shown. undefined (no live
  // counts published for this day/product) means "unknown" — never treated as
  // sold out, so an un-limited item is left alone.
  const availNow = (name) => {
    if (!prodAvail || !selected) return undefined;
    const m = prodAvail[selected];
    return m ? m[name] : undefined;
  };

  // A refresh can make a quantity the customer already chose invalid — an item
  // sells out, only a few are left of the number they asked for, or a value
  // pack no longer fits the shared pool next to the rest of their cart. Bring
  // the cart back in line with reality before the menu repaints, and return
  // what changed so the caller can tell the customer. Empty → nothing to fix.
  // One line above the menu for something the customer has to be told that is not
  // a cart fix — reconcileCart() owns those and clears them on its next pass.
  function menuNotice(text) {
    const box = document.getElementById("menu-note");
    if (!box) return;
    box.replaceChildren(el("p", {}, text));
    box.hidden = false;
  }

  function reconcileCart() {
    const notes = [];
    if (!selected) {
      const box = document.getElementById("menu-note");
      if (box) { box.hidden = true; box.replaceChildren(); }
      return notes;
    }
    const byProduct = prodAvail && prodAvail[selected] ? prodAvail[selected] : {};
    const groups = poolGroups(CONFIG.products);
    const handled = new Set();

    // Shared pools first: clamp the whole pool together — a pack and loose
    // singles draw on the same remaining pieces, so one cap keeps Σ ≤ base.
    for (const g of groups.values()) {
      if (byProduct[g.baseName] == null) continue; // no live budget this day
      const baseLeft = Number(byProduct[g.baseName]);
      if (!Number.isFinite(baseLeft)) continue;
      if (!g.members.some((m) => (cart.get(m.name) || 0) > 0)) continue;
      const clamped = clampPool(cart, g, baseLeft);
      for (const m of g.members) {
        const from = cart.get(m.name) || 0;
        const to = clamped.get(m.name) || 0;
        handled.add(m.name);
        if (from === to) continue;
        if (to === 0) {
          cart.delete(m.name);
          notes.push(sub(t("fixSoldOut"), m.name));
        } else {
          cart.set(m.name, to);
          notes.push(sub(t("fixPoolClamp"), m.name, to, from));
        }
      }
    }

    // A product whose own date rules close on this date (orders close N days
    // before delivery, or it's outside its from–to window) can't be ordered —
    // it leaves the cart. The card shows the same reason.
    for (const p of CONFIG.products) {
      const reason = closedReason(p, selected, todayKey);
      if (!reason || !cart.has(p.name)) continue;
      cart.delete(p.name);
      handled.add(p.name);
      notes.push(sub(t("fixClosed"), p.name, closedReasonClause(reason)));
    }

    // Everything else keeps the old per-product clamp against its own row.
    for (const [name, q] of [...cart]) {
      if (handled.has(name)) continue;
      const left = availNow(name);
      if (left == null) continue;
      if (left <= 0) {
        cart.delete(name);
        notes.push(sub(t("fixSoldOut"), name));
      } else if (q > left) {
        cart.set(name, left);
        notes.push(sub(t("fixClamp"), name, left, q));
      }
    }

    const box = document.getElementById("menu-note");
    if (box) {
      box.replaceChildren(...notes.map((t) => el("p", {}, t)));
      box.hidden = notes.length === 0;
    }
    if (notes.length) renderBar();
    return notes;
  }

  // ── the delivery-day calendar ──────────────────────────────────────────────
  // The customer picks their day from a month grid instead of a row of chips, so
  // the days her bakery actually delivers stand out in the month at a glance and
  // the chosen one is read in words underneath. Only the standard days the baker
  // has marked are drawn — the shop is never told about her own private marks.

  // The month on screen. Kept across repaints (a 30-second refresh must not fling
  // the customer back to this month) and clamped to the months that hold a
  // delivery day whenever the data changes.
  let calMonth = null;

  // The marked day whose name is showing, as a YYYY-MM-DD key, or null. A tap sets
  // it; any tap elsewhere clears it. It is read while the grid is rebuilt, so the
  // bubble survives the rerender the tap itself triggers.
  let tipIso = null;
  let tipInstalled = false;

  // The marks the bakery let the shop see. Nothing decides privacy here — the
  // published list is already only the standard days, never a mark she typed
  // herself — so this is a shape guard and nothing more.
  const marks = () => (Array.isArray(CONFIG.occasions) ? CONFIG.occasions : [])
    .filter((o) => o && o.label && o.from && o.to);

  // A mark running over several days is drawn the way the baker's own calendar
  // draws it: one translucent rounded band across the days it covers in each
  // week row, in her own colour, deeper the shorter the run. The bands are
  // absolutely-placed grid children (see .occ-paper), so they span a row without
  // disturbing the day cells, and they sit behind the numbers. A single-day mark
  // is not a band — its own day draws a same-depth wash as a box (see
  // .cal-cell.sol). Neither ever covers a past day, exactly as the office leaves
  // them alone.
  const occBands = (weeks, today) => {
    const out = [];
    const long = marks().filter((o) => occDays(o) >= 2)
      .sort((a, b) => occDays(b) - occDays(a)); // longest first → painted behind
    for (const occ of long) {
      weeks.forEach((row, r) => {
        let first = -1;
        let last = -1;
        row.forEach((iso, c) => {
          if (iso && iso >= today && occ.from <= iso && iso <= occ.to) {
            if (first === -1) first = c;
            last = c;
          }
        });
        if (first === -1) return;
        // Grid row 1 is the day-of-week heading, so week r sits on grid row r + 2.
        out.push(el("div", {
          class: `occ-paper occ-${occColour(occ)} occ-${occStrength(occ)}`,
          style: `--gr:${r + 2};--gc1:${first + 1};--gc2:${last + 2};`,
        }));
      });
    }
    return out;
  };

  // The marked days are never listed, so the name is read only on request: a tap
  // anywhere outside a bubble puts it away. One listener serves the whole page, and
  // it clears the key as well as hiding the live nodes — a later refresh rebuilds
  // the grid from the key and would otherwise bring the bubble straight back.
  if (!tipInstalled && typeof document !== "undefined"
      && typeof document.addEventListener === "function") {
    tipInstalled = true;
    document.addEventListener("pointerdown", () => {
      tipIso = null;
      for (const n of document.querySelectorAll(".cal-tip")) n.hidden = true;
    });
  }

  const buildCalendar = () => {
    const specs = daySpecs(dates, avail || {});
    const open = specs.filter((s) => !s.soldOut);
    // `selected` is a YYYY-MM-DD key so it survives a rerender that rebuilds the
    // Date objects (availability/config can arrive after the customer taps). The
    // first open day is chosen for them, as it always has been — ordering can
    // never be blocked by forgetting to tap, and the line below says which day
    // that is instead of leaving it to a highlight alone.
    if (selected && !specs.some((s) => dateKey(s.date) === selected && !s.soldOut)) selected = null;
    if (!selected) selected = open.length ? dateKey(open[0].date) : null;

    if (!specs.length) {
      dateWrap.replaceChildren(el("p", { class: "muted" }, t("noDates")));
      return;
    }
    if (!open.length) {
      dateWrap.replaceChildren(el("p", { class: "muted" }, t("noOpenDates")));
      return;
    }

    const byKey = new Map(specs.map((s) => [dateKey(s.date), s]));
    const todayK = dateKey(new Date());

    // The arrows page between the months that actually hold a delivery day, so a
    // customer can never wander into an empty month.
    const monthOf = (d) => ({ year: d.getFullYear(), month: d.getMonth() });
    const lo = monthOf(specs[0].date);
    const hi = monthOf(specs[specs.length - 1].date);
    const before = (a, b) => a.year < b.year || (a.year === b.year && a.month < b.month);
    if (!calMonth || before(calMonth, lo) || before(hi, calMonth)) calMonth = { ...lo };
    const canPrev = before(lo, calMonth);
    const canNext = before(calMonth, hi);

    const nav = (delta) => {
      calMonth = addMonth(calMonth.year, calMonth.month, delta);
      rerender();
    };
    // A disabled:false would still set the attribute (and grey the arrow out), so
    // the flag is only added when the arrow really is unavailable.
    const arrow = (label, delta, enabled) => {
      const attrs = { class: "cal-nav", "aria-label": label, onclick: () => nav(delta) };
      if (!enabled) attrs.disabled = "true";
      return el("button", attrs, delta < 0 ? "‹" : "›");
    };
    const head = el("div", { class: "cal-head" },
      arrow(t("calPrev"), -1, canPrev),
      el("span", { class: "cal-title" }, monthTitle(calMonth.year, calMonth.month)),
      arrow(t("calNext"), 1, canNext));

    const weeks = monthWeeks(calMonth.year, calMonth.month);
    const all = marks();
    const cells = weeks.flat().map((iso) => {
      if (!iso) return el("span", { class: "cal-cell blank" });
      const spec = byKey.get(iso);
      const isSel = iso === selected;
      const past = iso < todayK;
      const full = !!spec && spec.soldOut;
      const open = !!spec && !full && !past;
      // The mark this day is NAMED by — the shortest one covering it, the app's own
      // "the more specific mark wins" rule, so a day inside a long break is still
      // named by a short holiday sitting on it.
      const named = past ? null : occForDate(all, iso);
      // A single-day mark draws the box; a longer one is a band behind it. Both
      // carry their strength class, so the box is exactly as deep as a band of
      // the same length — one mark, one look, whichever day it lands on.
      const sol = past ? null : occSingleDay(all, iso);
      let cls = "cal-cell";
      if (spec && !full) cls += " avail";
      if (full) cls += " full";
      if (isSel) cls += " sel";
      if (iso === todayK) cls += " today";
      if (past) cls += " past";
      if (sol) cls += ` sol occ-${occColour(sol)} occ-${occStrength(sol)}`;
      const kids = [el("span", { class: "cal-num" }, String(Number(iso.slice(8, 10))))];
      // The name waits in its own bubble and is never listed in advance. `hidden`
      // is set on the node itself, not through el(): the shop's el() skips only
      // null, so `hidden: false` would still set the attribute and hide it.
      if (named) {
        const tip = el("span", { class: "cal-tip" }, named.label);
        tip.hidden = iso !== tipIso;
        kids.push(tip);
      }
      // A day she delivers with room left is tapped to choose it; a marked day is
      // tapped to read its name — and the one day can be both.
      if (open || named) {
        return el("button", {
          class: cls + (open ? " tappable" : "") + (named ? " tippable" : ""),
          onclick: () => {
            if (named) tipIso = iso;
            if (open) selected = iso;
            // Rebuild the grid + menu together so the chosen day and the quantities
            // the customer chose are re-checked against this day's availability.
            rerender();
          },
        }, ...kids);
      }
      return el("span", { class: cls }, ...kids);
    });

    dateWrap.replaceChildren(
      el("div", { class: "cal" },
        head,
        el("div", { class: "cal-grid" },
          ...dowNames().map((d) => el("span", { class: "cal-dow" }, d)),
          ...cells,
          // The bands go in last and sit behind the cells (see .occ-paper).
          ...occBands(weeks, todayK)),
        // The day they picked, in words — the one line under the grid.
        el("p", { class: "cal-chosen" },
          sub(t("calChosen"), fmtDay(new Date(`${selected}T00:00:00`)))),
        // Any day in this month with no room left, named rather than guessed at.
        soldOutLine(specs, calMonth)));
  };

  // "Sold out: 18 Sep, 25 Sep" — the days in the shown month that are already
  // full. Empty when the month has none, so the line takes no space.
  function soldOutLine(specs, month) {
    const names = specs
      .filter((s) => s.soldOut
        && s.date.getFullYear() === month.year && s.date.getMonth() === month.month)
      .map((s) => shortDay(dateKey(s.date)));
    if (!names.length) return null;
    return el("p", { class: "cal-note" }, `${t("soldOut")}: ${names.join(", ")}`);
  }

  // Recompute the dates + rebuild the calendar and menu. Called on first paint
  // and again when the availability data or the published storefront config
  // arrives — arrival order doesn't matter because both funnel through here.
  const rerender = () => {
    dates = resolveDates(upcomingDates(CONFIG), dayRows, dateKey(new Date()))
      .filter((d) => isOpen(CONFIG, d));
    // Fix the cart first so the calendar/menu repaint with honest quantities: an
    // item the customer chose may have sold out (or dropped to fewer than they
    // asked for) since the last refresh or since they picked this day.
    reconcileCart();
    buildCalendar();
    renderMenu();
  };

  rerender();

  const sb = CONFIG.supabase;
  if (sb && sb.url && sb.anonKey) {
    const base = String(sb.url).replace(/\/+$/, "");
    const headers = { apikey: sb.anonKey };
    let lastSig = "";

    // Fetch the live day/product availability and the published storefront
    // config, then repaint only when something actually changed (or a delivery
    // day crossed its cut-off while the page was open). A repaint rebuilds the
    // delivery calendar and the product cards only — the customer's typed details
    // (name, WhatsApp, address, note) and the items they chose are not part of
    // those, so a refresh never touches them.
    const refresh = async () => {
      let day = null, prod = null, cfgText = "";
      try {
        const [dayRes, prodRes, cfgRes] = await Promise.all([
          fetch(`${base}/rest/v1/availability?select=date,slots_left&order=date.asc`, { headers }),
          fetch(`${base}/rest/v1/product_availability?select=date,product,slots_left&order=date.asc`, { headers }),
          fetch(`${base}/rest/v1/storefront_config?select=data&id=eq.default&limit=1`, { headers }),
        ]);
        day = dayRes.ok ? await dayRes.json() : null;
        prod = prodRes.ok ? await prodRes.json() : null;
        const rows = cfgRes.ok ? await cfgRes.json() : [];
        const row = Array.isArray(rows) && rows[0];
        cfgText = row && typeof row.data === "string" ? row.data : "";
      } catch {
        return; // offline or mid-network — keep showing what we have
      }
      const sig = JSON.stringify([day, prod, cfgText]);
      const changed = sig !== lastSig;
      if (changed) {
        lastSig = sig;
        if (Array.isArray(day)) {
          dayRows = day;
          avail = Object.fromEntries(
            day.filter((r) => r && r.date != null && r.slots_left != null)
              .map((r) => [r.date, Number(r.slots_left)]));
        }
        if (Array.isArray(prod)) {
          prodAvail = {};
          for (const r of prod) {
            if (!r || r.date == null || r.product == null || r.slots_left == null) continue;
            (prodAvail[r.date] ||= {})[r.product] = Number(r.slots_left);
          }
        }
        if (cfgText) {
          try {
            Object.assign(CONFIG, mergeStorefront(CONFIG, JSON.parse(cfgText)));
            renderStatic(CONFIG);
            // The codes live only here — config.js ships none — so this is the
            // moment a label's offer line and note can first be drawn. Without
            // this the page showed nothing until something else repainted it.
            if (repaintCode) repaintCode();
          } catch { /* corrupt config → keep the local one */ }
        }
      }
      // A day can cross its cut-off with no data change — drop closed days from
      // the row even when the payload is otherwise identical.
      const next = resolveDates(upcomingDates(CONFIG), dayRows, dateKey(new Date()))
        .filter((d) => isOpen(CONFIG, d));
      const daysChanged = next.length !== dates.length
        || next.some((d, i) => dateKey(d) !== dateKey(dates[i]));
      if (changed || daysChanged) rerender();
      // The card was aimed at before this data arrived, and the page is taller
      // now — aim once more with the layout final. Only for a page opened by the
      // track link, and only this first pass: the 30s poll must never pull a
      // customer back to the card.
      if (trackAimPending && trackLit) { trackAimPending = false; aimAtTrack(); }
    };
    refresh();

    // Keep the page honest while it's open: poll every 30s but only while the
    // tab is actually on screen (a backgrounded tab is skipped), and refresh
    // the moment the customer returns to it — visibility change, window focus
    // or the phone coming back online.
    const hasVisibility = typeof document !== "undefined" && typeof document.visibilityState === "string";
    const doc = typeof document !== "undefined" ? document : null;
    const win = typeof window !== "undefined" ? window : null;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      if (doc && doc.visibilityState && doc.visibilityState !== "visible") return;
      busy = true;
      try { await refresh(); } finally { busy = false; }
    };
    if (hasVisibility) {
      const listen = (t, type, fn) => { if (t && typeof t.addEventListener === "function") t.addEventListener(type, fn); };
      listen(doc, "visibilitychange", () => { if (doc.visibilityState === "visible") poll(); });
      listen(win, "focus", poll);
      listen(win, "online", poll);
      setInterval(poll, 30000);
    }
  }

  // A function declaration (hoisted) because reconcileCart runs from the first
  // repaint, before this line is reached textually.
  // The basket's full-price total — the one number the bar, the order and the
  // promo note all read. Shared so the note can never quote a different figure
  // from the one the customer is looking at (a basket can hold an item the menu
  // no longer lists, and this loop is what decides whether it counts).
  function basketTotal() {
    let total = 0;
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      total += q * p.price;
    }
    return total;
  }

  function renderBar() {
    let count = 0;
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      count += q;
    }
    const total = basketTotal();
    document.getElementById("bar-count").textContent = count === 1 ? t("oneItem") : sub(t("items"), count);
    document.getElementById("bar-total").textContent = `RM${total.toFixed(2)}`;
    document.getElementById("order-btn").textContent = t("placeOrder");
    document.getElementById("order-btn").disabled = count === 0;
    // Every basket change lands here — the stepper, a cart fix, a language
    // switch, an order placed, the boot paint, and the moment the published
    // config (which is what carries the codes) arrives. So this is the one hook
    // the label line and the note under it need.
    if (repaintCode) repaintCode();
    return total;
  }

  const orderBtn = document.getElementById("order-btn");
  orderBtn.onclick = async () => {
    if (orderBtn.disabled) return; // one tap only — no double orders
    const lines = [];
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      lines.push({ name: n, qty: q, price: p.price });
    }
    if (!lines.length || !selected) return;
    // The baker confirms every order (and sends the payment QR) over WhatsApp,
    // so the customer's number is required to place the order at all.
    const waInput = document.getElementById("whatsapp-input");
    const whatsapp = waNumber(waInput && waInput.value);
    if (!whatsapp) {
      if (waInput && waInput.focus) waInput.focus();
      showConfirm([
        el("p", { class: "confirm-title" }, t("confirmAddWaTitle")),
        el("p", { class: "confirm-body" }, t("confirmAddWaBody")),
      ], "warn");
      return;
    }
    // Posting is the default way to receive an order, so a full postal address
    // is required unless the customer chose to collect locally.
    const fulEl = document.getElementById("fulfillment");
    const fulfillment = (fulEl && fulEl._value) || "courier";
    const address = (document.getElementById("address-input").value || "").trim();
    if (fulfillment === "courier" && !address) {
      const addrInput = document.getElementById("address-input");
      if (addrInput && addrInput.focus) addrInput.focus();
      showConfirm([
        el("p", { class: "confirm-title" }, t("confirmAddrTitle")),
        el("p", { class: "confirm-body" }, t("confirmAddrBody")),
      ], "warn");
      return;
    }
    // Cutoff guard: a customer may have the page open across the deadline, so
    // re-check the selected day at the moment they tap Place order.
    if (!isOpen(CONFIG, new Date(`${selected}T00:00:00`))) {
      showConfirm([
        el("p", { class: "confirm-title" }, t("confirmClosedTitle")),
        el("p", { class: "confirm-body" }, sub(t("confirmClosedBody"), CONFIG.cutoff)),
      ], "warn");
      return;
    }
    // Last check at the moment of placing: a refresh between taps can sell an
    // item out, or a value pack can no longer fit the shared pool next to the
    // rest of the cart — a depleted item must never be ordered. Fix the cart
    // and ask the customer to confirm before we send anything. When nothing
    // changed, the cart matches `lines`, so it stays safe to send.
    const fixes = reconcileCart();
    if (fixes.length) {
      showConfirm([
        el("p", { class: "confirm-title" }, t("confirmChangedTitle")),
        el("p", { class: "confirm-body" }, t("confirmChangedBody")),
        ...fixes.map((note) => el("p", { class: "confirm-body" }, `• ${note}`)),
        el("p", { class: "confirm-sub" }, t("confirmChangedSub")),
      ], "warn");
      return;
    }
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const order = {
      customer: document.getElementById("name-input").value.trim(),
      whatsapp,
      date: selected,
      lines,
      total,
      fulfillment,
      address,
      note: document.getElementById("note-input").value.trim(),
      createdAt: new Date().toISOString(),
    };
    // A referral link's ?via= stamp: which customer's personal link this order
    // came through. You decide (new vs repeat) and apply the discount.
    const via = currentVia();
    if (via) order.referredBy = via;
    // The label the customer came in on — off its link, or typed in the box —
    // stamped on the order so the "Shops & codes" screen can count what that one
    // label brought in, and so the order row can show you which offer was
    // promised when you come to confirm it. Kept only when the code really is one
    // the app published: a made-up code must not land in the books as a label that
    // never existed. The stamp records which label, not which discount — a code
    // whose offer has since ended still stamps.
    //
    // Only the code and its kind travel. The shop behind it is read back from the
    // code record, so a shop renamed later is named right everywhere, and the
    // order never carries a second, disagreeing copy of it.
    const used = currentCode();
    const usedInfo = used ? codeInfo(CONFIG, used) : null;
    if (usedInfo) {
      order.promoCode = usedInfo.code;
      order.codeKind = usedInfo.kind;
    }
    // A value pack draws its base out of the shared pool in whole pieces, but
    // the pack itself is already one top-level `lines` entry — so the base
    // pieces it consumes travel here, separate from `lines`. The database
    // lowers the base row by this sum (never adding to the day's count, and a
    // base sold directly is already in `lines`, so it is never listed twice).
    const pool = poolPieces(CONFIG.products, cart);
    if (pool.length) order.pool = pool;
    // `selected` is a YYYY-MM-DD key; fmtDay wants a Date.
    const dayLabel = fmtDay(new Date(`${selected}T00:00:00`));
    // The receipt the customer sees uses each product's shop name in their
    // language (the order the baker reads keeps the canonical English names).
    const items = lines.map((l) => {
      const p = CONFIG.products.find((x) => x.name === l.name);
      return `${p ? nameFor(p, loadLang()) : l.name} ×${l.qty}`;
    }).join(" + ");

    // Immediate feedback + block the button while sending, so a slow network
    // can't make a customer tap repeatedly and send duplicates.
    orderBtn.disabled = true;
    orderBtn.textContent = t("sending");
    showConfirm(t("sendingToBakery"));

    const r = await placeOrder(order);
    if (r.ok) {
      // The order is safely in the bakery's app — done. No WhatsApp popup, and
      // the customer is told it's received but not yet accepted: it lands as a
      // New order and only becomes Confirmed when the baker confirms it (which
      // is also when the customer gets the WhatsApp confirmation).
      cart.clear();
      const noteBox = document.getElementById("menu-note");
      if (noteBox) { noteBox.hidden = true; noteBox.replaceChildren(); }
      document.getElementById("name-input").value = "";
      document.getElementById("whatsapp-input").value = "";
      document.getElementById("address-input").value = "";
      document.getElementById("note-input").value = "";
      // Clear the typed code too, so the next customer does not inherit it. A
      // scanned label's code is in the link, not this box, so it survives.
      const codeBox = document.getElementById("code-input");
      if (codeBox) codeBox.value = "";
      // Reset to Post (nationwide) — the default — for the next customer.
      const fulfillEl = document.getElementById("fulfillment");
      if (fulfillEl) {
        fulfillEl._value = "courier";
        for (const b of (fulfillEl.querySelectorAll ? fulfillEl.querySelectorAll(".seg-btn") : [])) {
          b.classList.toggle("active", b.dataset.fulfillment === "courier");
        }
      }
      const addrField = document.getElementById("address-field");
      if (addrField) addrField.hidden = false;
      renderBar();
      // order-btn label was reset by renderBar — the cart is now empty.
      // The strictest change/cancel window across what was just ordered — the
      // receipt is the moment the customer most needs the no-refund rule, so the
      // window travels with it. Nothing is snapshotted: this is read now, and
      // the track card deliberately says nothing about it later.
      const winDays = strictestCancelDays(
        lines.map((l) => CONFIG.products.find((x) => x.name === l.name)).filter(Boolean));
      const cancelLine = winDays != null && winDays >= 1
        ? el("p", { class: "confirm-body" },
            sub(t(winDays === 1 ? "orderCancelNoteOne" : "orderCancelNote"), winDays))
        : null;
      showConfirm([
        el("p", { class: "confirm-title" }, t("orderRecvTitle")),
        el("p", { class: "confirm-body" },
          order.customer ? sub(t("orderRecvThanksBody"), order.customer, CONFIG.name) : sub(t("orderRecvBody"), CONFIG.name)),
        el("p", { class: "confirm-body" }, sub(t("orderRecvLine"), dayLabel, items, total.toFixed(2))),
        cancelLine,
        el("p", { class: "confirm-sub" }, t("orderRecvSub")),
      ], "ok");
    } else {
      // The order could not reach the bakery's app — hand it over on WhatsApp
      // instead so it isn't lost (this is the only time WhatsApp opens, and the
      // baker sees the customer's own number on the message). Best-effort: the
      // cart stays intact if it can't open.
      const url = CONFIG.whatsapp ? waUrl(order, dayLabel) : null;
      const opened = url ? tryOpenWa(url) : false;
      orderBtn.disabled = false;
      orderBtn.textContent = t("placeOrder");
      showConfirm([
        el("p", { class: "confirm-title" }, t("failTitle")),
        el("p", { class: "confirm-body" }, t("failBody")),
        url
          ? (opened
              ? el("p", { class: "confirm-sub" }, t("failOpened"))
              : el("a", { class: "confirm-link", href: url, target: "_blank", rel: "noopener" }, t("failLink")))
          : el("p", { class: "confirm-sub" }, t("failRetry")),
      ], "warn");
    }
  };

  // Assigned before the boot paint below, which is the first call that shows the
  // customer a total — and therefore the first that can show them the note. The
  // earlier renderBar() calls (from reconcileCart and rerender) run while this is
  // still null and skip harmlessly; they run again here.
  repaintCode = () => {
    renderCodeBanner(CONFIG);
    renderCodeNote(CONFIG, basketTotal());
  };
  renderBar();

  // What a language switch repaints, in place. Nothing here re-reads the
  // network: the tagged static HTML and the title (applyTo), the header + info
  // cards + footer credit (renderStatic), the delivery calendar and the menu cards
  // with their translated product names/descriptions/units (rerender), the
  // order bar, and the track card if the customer is looking one up. The cart
  // and the chosen day are the same objects they were — switching language
  // must never empty the customer's basket.
  repaintForLang = (l) => {
    applyTo(document, STORE, l);
    renderStatic(CONFIG);
    // The offer line and the note under it are built from words rather than from
    // data-i18n, so applyTo cannot reach them — the renderBar below repaints both.
    rerender();
    renderBar();
    paintTrack();
  };
}

// ── Track your order ───────────────────────────────────────────────────────
// Look up one order on the public tracking table and show its place on the
// journey (New → Confirmed → Paid → Preparing → Packed → Delivered) with the
// order details only. Payment instructions and the receipt flow live in the
// WhatsApp confirmation, not here. Friendly fallbacks keep the card usable when
// the code is wrong or tracking is unreachable.
// Status ids in order, each with the dictionary key for its label — the labels
// read in the visitor's language, the ids stay stable for matching.
const JOURNEY = [
  ["new", "trkNew"],
  ["confirmed", "trkConfirmed"],
  ["paid", "trkPaid"],        // TNG payment received, right after Confirmed
  ["baking", "trkBaking"],
  ["ready", "trkReady"],
  // One label covering both endings ("Collected / Posted"), the same one the
  // backoffice shows, so the two maps read alike.
  ["delivered", "trkFinal"],
];
// Where the money stage sits in that list — used to tell "past Paid" from "on Paid".
const PAID_AT = JOURNEY.findIndex(([id]) => id === "paid");

// A progress line for the track card, like an online-shop parcel tracker: each
// step is a circle joined to the next by a line. Reached steps are green with a
// tick, the live step is a larger amber dot that pulses, later steps stay grey.
// The map is the same one the backoffice shows: New is green the moment the
// order arrives, Confirmed turns green only once the baker pressed "Send
// confirmation" (row.confirmed_sent), Paid only once they pressed "Paid"
// (row.paid_received), and Preparing/Packed/Delivered green when the status
// moves past them. A NULL flag (a row published before these were stored) reads
// as done — that stage really was handled. Unknown statuses return null and the
// caller just shows details.
function journeyEl(row) {
  const key = String((row && row.status) || "").toLowerCase().trim() || "new";
  const idx = JOURNEY.findIndex(([id]) => id === key);
  if (idx < 0) return null;
  const at = idx;
  const confirmedDone = row.confirmed_sent !== false;
  const paidDone = row.paid_received !== false;
  // A regular who pays when you collect never passes through Paid: the step stays in its
  // place and wears an X instead of a tick, never green, so the customer's line reads in the
  // same places as yours and the one step still to settle is plain to see (17 Sep 2026).
  // Once you record the money, the X becomes the green tick.
  const paidSkipped = !paidDone && at > PAID_AT;
  const done = JOURNEY.map((_, i) => {
    if (i < at) return true;                     // already moved past
    if (i > at) return false;
    if (i === 0) return true;                    // New: done on arrival
    if (i === 1) return confirmedDone;           // Confirmed: after Send confirmation
    if (i === PAID_AT) return paidDone;          // Paid: after the Paid button
    return true;                                 // Preparing/Packed/Delivered: on selection
  });
  const root = el("div", { class: "tj", "aria-label": "Order status journey" });
  let live = false; // the first step still to do is the one that flashes
  JOURNEY.forEach(([id, labelKey], i) => {
    const skipped = i === PAID_AT && paidSkipped;
    const state = skipped ? "skipped" : done[i] ? "done" : (!live ? "now" : "todo");
    if (!skipped && !done[i]) live = true;
    const mark =
      state === "done" ? el("span", { class: "tj-check" }, "✓")
      : state === "skipped" ? el("span", { class: "tj-cross" }, "✕")
      : state === "now" ? el("span", { class: "tj-dot" }) : null;
    root.append(el("div", { class: `tj-step ${state}` }, [
      el("div", { class: "tj-track" }, [el("div", { class: "tj-node" }, mark)]),
      el("div", { class: "tj-label" }, t(labelKey)),
    ]));
  });
  return root;
}

// What the track card last showed, so a language switch can redraw it in the
// new language without another round trip to Supabase. kind is one of
// "enter" | "unavailable" | "looking" | "notfound" | "row"; only "row" carries
// `row`. Null until the customer looks something up.
let lastTrack = null;

// Draw the track card from `lastTrack`. Every string comes from t(), so calling
// this again after a language change repaints the card — including the journey
// step labels — with no network.
function paintTrack() {
  const box = document.getElementById("track-result");
  if (!box || !lastTrack) return;
  box.hidden = false;
  const { kind, code, row } = lastTrack;
  if (kind !== "row") {
    const text = kind === "enter" ? t("trackEnter")
      : kind === "looking" ? t("trackLooking")
      : kind === "notfound" ? sub(t("trackNotFound"), code)
      : t("trackUnavailable");
    box.replaceChildren(el("p", { class: "track-note" }, text));
    return;
  }
  // The card reads like a parcel tracker: order code, the journey progress
  // line (reached stages green, current highlighted), then the delivery and
  // item details underneath.
  const codeLine = el("p", { class: "track-code" }, sub(t("orderCode"), code));
  const journey = journeyEl(row);
  const details = el("div", { class: "track-details" }, [
    el("p", {}, row.delivery),
    el("p", {}, `${row.items} — ${row.total}`),
  ]);
  const kids = [
    codeLine,
    journey,
    details,
    // The courier's tracking number, when the order was posted and the baker typed
    // one. Its own line, in the number face, so it is easy to read back to a
    // courier or paste into their site.
    row.tracking_no ? el("p", { class: "track-no" }, sub(t("trackingNo"), row.tracking_no)) : null,
    row.customer ? el("p", { class: "track-note" }, sub(t("forCustomer"), row.customer)) : null,
  ];
  box.replaceChildren(...kids.filter(Boolean));
}

export async function trackOrder(code) {
  if (!document.getElementById("track-result")) return;
  const clean = String(code || "").trim().replace(/^#/, "").toUpperCase();
  if (!clean) {
    lastTrack = { kind: "enter", code: "" };
    return paintTrack();
  }
  const sb = CONFIG.supabase;
  if (!sb || !sb.url || !sb.anonKey) {
    lastTrack = { kind: "unavailable", code: clean };
    return paintTrack();
  }
  lastTrack = { kind: "looking", code: clean };
  paintTrack();
  const base = String(sb.url).replace(/\/+$/, "");
  try {
    // cache: no-store so a repeated lookup (e.g. re-checking the same order
    // after the baker updates it) always gets the current status, never a
    // cached one from the phone's HTTP cache.
    const res = await fetch(
      // tracking_no must be named here: PostgREST returns only the columns
      // listed, so without it the row never carries the number and the line
      // below can never draw.
      `${base}/rest/v1/order_tracking?select=status,confirmed_sent,paid_received,delivery,items,total,tracking_no,updated_at&code=eq.${clean}&limit=1`,
      { headers: { apikey: sb.anonKey }, cache: "no-store" });
    const rows = res.ok ? await res.json() : null;
    const row = Array.isArray(rows) && rows[0];
    lastTrack = row ? { kind: "row", code: clean, row } : { kind: "notfound", code: clean };
    paintTrack();
  } catch {
    lastTrack = { kind: "unavailable", code: clean };
    paintTrack();
  }
}

// Wire the Self collect / Courier picker. The choice is stored on the wrapper
// node so the order handler reads it back; courier reveals the address field.
function wireFulfillment() {
  const wrap = document.getElementById("fulfillment");
  if (!wrap) return;
  const buttons = (wrap.querySelectorAll && wrap.querySelectorAll(".seg-btn")) || [];
  const apply = (value) => {
    wrap._value = value;
    for (const b of buttons) b.classList.toggle("active", b.dataset.fulfillment === value);
    const addr = document.getElementById("address-field");
    if (addr) addr.hidden = value !== "courier";
  };
  for (const b of buttons) b.addEventListener("click", () => apply(b.dataset.fulfillment));
  apply("courier"); // reflect the static HTML's default active button
}

// What ends the track card's glow: the customer getting to it. The same rule the
// backoffice uses when it jumps to an order (admin/js/views/orders.js), so the two
// sides of one WhatsApp message behave alike.
const TRACK_SETTLE_ON = ["pointerenter", "pointermove", "pointerdown", "mouseenter", "touchstart"];
let trackLit = false;         // the deep link's glow is on
let trackAimPending = false;  // …and the page has still to finish growing beneath it

// Put the track card at the top of the screen. Called once when the page opens on
// the link, and once more when the shop's own data has landed — the published
// config and the day's counts arrive a moment later and make the page taller, so
// the first scroll aims at where the document ends at that instant and stops
// short (measured at 375px: it landed 113px up the page from the card).
function aimAtTrack() {
  const section = document.getElementById("track-section");
  if (section && typeof section.scrollIntoView === "function") {
    section.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

// The confirmation message carries the link /store/?track=CODE, and until v93 that
// page simply opened at the top with the card somewhere below the fold: the customer
// had to hunt for the very thing they had just tapped. Now the card is scrolled to
// and lit. The glow is ended by the pointer ARRIVING, not by the clock — a fixed
// moment can pass while the eye is still travelling down the page.
function revealTrack() {
  const section = document.getElementById("track-section");
  if (!section) return;
  trackLit = true;
  trackAimPending = true;
  section.classList.add("hit");
  const settle = () => {
    trackLit = false;
    trackAimPending = false;
    section.classList.remove("hit");
    for (const type of TRACK_SETTLE_ON) section.removeEventListener(type, settle);
  };
  for (const type of TRACK_SETTLE_ON) section.addEventListener(type, settle);
  aimAtTrack();
}

function wireTrack() {
  const input = document.getElementById("track-input");
  const btn = document.getElementById("track-btn");
  if (!input || !btn) return;
  const go = () => trackOrder(input.value);
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  // The confirmation link opens this page as /store/?track=CODE — prefill and
  // look the order up right away so the customer sees their status instantly.
  if (typeof location !== "undefined" && location.search) {
    const code = new URLSearchParams(location.search).get("track");
    if (code) {
      input.value = code.replace(/^#/, "").toUpperCase();
      trackOrder(code);
      revealTrack(); // the link she tapped IS the card she should land on
    }
  }
}

// The "have a code?" box. A label's link carries its code already, so the box is
// for the customer who was told the code aloud or copied it off a card — it is
// shown either way, because a customer who did scan a label may still want to see
// what they are holding. Typing a code replaces the link's code.
//
// Applying is a button press or Enter, exactly like the track box above: no
// keystroke handler (a half-typed code matches nothing and would flicker an
// error) and no blur handler (tapping a product mid-type must not tell a customer
// their code is wrong).
function wireCodeBox() {
  const input = document.getElementById("code-input");
  const btn = document.getElementById("code-btn");
  if (!input || !btn) return;
  const go = () => { if (repaintCode) repaintCode(); };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

render();
renderReferralBanner();
renderCodeBanner(CONFIG);
wireFulfillment();
wireTrack();
wireCodeBox();

// ── Site language (EN / 中文 / BM) ────────────────────────────────────────

// Move the pill highlight to `l`. Set by the boot block below (it owns the pill
// nodes); null in Node tests that never booted a real language bar.
let paintPillsHook = null;

// Switch the site language in place: remember the choice, repaint every
// language-dependent part and move the pill highlight. Returns true when the
// language actually changed, so a repeat tap on the pill that is already on
// does nothing. Exported so the Node suite can drive a switch without a click.
export function setLang(next) {
  if (!isLang(next) || next === loadLang()) return false;
  rememberLang(next);
  if (repaintForLang) repaintForLang(next);
  if (paintPillsHook) paintPillsHook(next);
  return true;
}

// Switching repaints the page in place (see setLang) instead of reloading it:
// a reload would re-fetch the menu, the slots-left numbers and the storefront
// settings from Supabase, which is the pause a customer feels on a phone. Only
// a real browser reaches this block (Node tests have no documentElement).
if (typeof document !== "undefined" && document.documentElement) {
  const pills = Array.from(document.querySelectorAll("#lang-switch .lang-pill"));
  paintPillsHook = (l) => pills.forEach((b) => b.classList.toggle("is-on", b.dataset.lang === l));
  applyTo(document, STORE, loadLang());
  paintPillsHook(loadLang());
  pills.forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
}
