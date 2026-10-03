// store/app.js — customer order page: pick a date, add items, place an order.
// Orders go straight to the backoffice (Supabase incoming_orders) and fall back
// to a WhatsApp message if that fails. The name, menu and WhatsApp number are
// published by the backoffice (Settings → Storefront) and override the static
// config.js fallback at runtime.
import { CONFIG } from "./config.js";
import { poolCaps, poolGroups, clampPool, groupFor, poolPieces, closedReason, cancelDaysFor, strictestCancelDays, nextOrderable } from "./pool.js";
import { rollingWeeks, weekIndex, windowBounds, WINDOW_WEEKS, occColour, occDays, occStrength, occForDate, occSingleDay } from "./calendar.js";
import { normRules } from "../availability.js";
import { isThumb, lineNoteOf, LINE_NOTE_MAX } from "../storefront-fields.js";
import { isLang, loadLang, pick, rememberLang, nameFor, descFor, unitFor, policyFor, applyTo } from "../i18n.js";
import { STORE } from "../store-lang.js";
import { addressFromRow, askGeo, fixVerdict, lookupQuery, placeForOrder, validPin } from "./geo.js";
import { showPinMap } from "./pin_map.js";
import { createLookup } from "./lookup.js";
import { sendFeedback, loadDraft, saveDraft } from "./feedback.js";
// The shop shows the same engine number the backoffice shows on More, so the owner can
// read her phone and know which build the shop is running — and the address fed back with
// a customer's words names it too. One number, one file, no second copy to forget.
import { ENGINE_VERSION } from "../admin/js/version.js";
// The promo-code engine, shared with the backoffice so a code the shop accepts is
// exactly a code her app recognises. It is a leaf module (imports nothing), which
// is why the shop can take it without pulling the backoffice's storage in.
import { codeNameOk, evaluate, findCode, minimumOf, normCode, normalizeCode, offerOf, shortfallOf, stoppedBy, worthOf } from "../admin/js/promo.js";

// Day/month short names per site language. English is today's authoring default;
// fmtDay and the "Posting days" info card read by the visitor's language so a
// calendar cell or that row shows in 中文/BM too.
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const DAYS_MS = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
const MONTHS_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
// Full month names, for the one sentence that has to read as prose rather than as
// a calendar cell: "That code ended on 30 September." A shorthand "30 Sep" reads
// as a data label, and this line is the one place a date has to sound like a
// sentence the bakery is saying. Chinese needs no second table — 9月30日 is
// already the full form.
const MONTHS_EN_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS_LONG = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];

// Single-letter column headings for the calendar's top row. Kept separate from
// DAYS_* because those are three-letter names ("Mon") and the Chinese ones are
// whole words (周一) that cannot be sliced down to a column heading.
const DOW_EN = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const DOW_MS = ["A", "I", "S", "R", "K", "J", "S"];

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

// Set from inside render() too: redraws the promo line. Needed because the
// published codes arrive ASYNCHRONOUSLY, after the page has already drawn — the
// storefront row is fetched once at boot, and a customer looking at the top of
// the page would otherwise never see the offer. Null until render() has run.
let repaintPromo = null;

// Fill %1, %2, … placeholders left-to-right.
function sub(s) {
  const args = Array.prototype.slice.call(arguments, 1);
  let out = String(s);
  for (let i = 0; i < args.length; i++) out = out.split(`%${i + 1}`).join(String(args[i]));
  return out;
}

// The cut-off time the way a person says it out loud: "18:00" → "6pm" in
// English, "晚上6点" in 中文, "6 petang" in BM. The app stores it 24-hour
// (Settings → the cut-off box is an <input type="time">), which is right for
// arithmetic and wrong for a customer reading the page — the owner asked for the
// plain words on 21 Sep 2026. `lang` is a parameter so the words can be tested
// without a phone; anything that is not a 24-hour time is handed back untouched
// rather than guessed at.
export function clockWords(cutoff, lang = loadLang()) {
  const raw = String(cutoff == null ? "" : cutoff).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return raw;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return raw;
  const h12 = h % 12 || 12;
  if (lang === "zh") {
    const part = h < 5 ? "凌晨" : h < 12 ? "上午" : h === 12 ? "中午" : h < 18 ? "下午" : "晚上";
    return `${part}${h12}点${mm ? `${m[2]}分` : ""}`;
  }
  if (lang === "ms") {
    const part = h < 12 ? "pagi" : h < 14 ? "tengah hari" : h < 19 ? "petang" : "malam";
    return `${h12}${mm ? `.${m[2]}` : ""} ${part}`;
  }
  return `${h12}${mm ? `:${m[2]}` : ""}${h < 12 ? "am" : "pm"}`;
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

// The delivery window's title — the span of dates it covers, not a month name,
// because the window follows today rather than the month. "20 Sep – 10 Oct", and
// "20 – 26 Sep" when both ends share a month. Chinese puts the month before the
// day and repeats it only when the months differ, so it cannot be built by
// concatenation any more than a month name can.
export function windowTitle(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${fromIso} – ${toIso}`;
  const lang = loadLang();
  const names = (lang === "zh" ? MONTHS_ZH : lang === "ms" ? MONTHS_MS : MONTHS_EN);
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (lang === "zh") {
    return same
      ? `${names[a.getMonth()]}${a.getDate()}日 – ${b.getDate()}日`
      : `${names[a.getMonth()]}${a.getDate()}日 – ${names[b.getMonth()]}${b.getDate()}日`;
  }
  return same
    ? `${a.getDate()} – ${b.getDate()} ${names[a.getMonth()]}`
    : `${a.getDate()} ${names[a.getMonth()]} – ${b.getDate()} ${names[b.getMonth()]}`;
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

// The `promo` query string on a printed card's link (?promo=FRESH10) is the code
// the customer was handed. Read the one way the engine spells a code. A card
// carries no number and no date, so the code is all it has to carry.
export function parsePromo(search) {
  return tidyCode(new URLSearchParams(String(search || "")).get("promo"));
}

function currentPromo() {
  return (typeof location !== "undefined" && location.search)
    ? parsePromo(location.search) : "";
}

// What the customer typed, cleaned the way the engine spells a code. Forgiving on
// purpose: "fresh 10", "Fresh-10" and "FRESH10" are the same code to the shop,
// because a customer reading a card off a phone should not lose a discount to a
// space. The rules themselves stay strict — being relaxed about typing is the
// shop's job, not the engine's.
function tidyCode(t) {
  return String(t || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// The offer in words, built from the engine's PARTS rather than a sentence it
// handed back — the engine answers in data (see js/promo.js), and every word the
// customer reads is a translated string from store-lang.js.
function offerWords(w) {
  if (w.kind === "delivery") return t("promoFreeDelivery");
  if (w.kind === "pct") {
    const pct = sub(t("promoOffPercent"), w.value);
    return w.cap > 0 ? sub(t("promoOffPercentCap"), pct, `RM${w.cap.toFixed(2)}`) : pct;
  }
  return sub(t("promoOffAmount"), `RM${w.value.toFixed(2)}`);
}

// Everything the offer carries that a customer has to know before they type it:
// what comes off, the smallest basket it works on, and when it runs out. The
// standing line and the accepted box both read from here, so a code with a
// minimum or an end date never reads as though it had neither.
//
// The minimum is wrapped on FIRST, so the end date lands on the outside: "RM10
// off on RM30 and above, until 31 October" rather than "…until 31 October on
// RM30 and above", which reads as though the dates were the condition.
export function clauseWords(code) {
  let w = offerWords(offerOf(code));
  const min = minimumOf(code);
  if (min > 0) w = sub(t("promoOnMin"), w, `RM${min.toFixed(2)}`);
  const to = code && code.when && code.when.to;
  if (to) {
    const day = dayWords(to);
    if (day) w = sub(t("promoUntil"), w, day);
  }
  return w;
}

// The bakery's OWN sentence about a code, in the reader's language, or "" when
// she has not written one. Blank 中文/BM falls back to the English she wrote,
// the same way the storefront policy text does — a line in English is more use
// to a Chinese-reading customer than no line at all.
export function ownWords(code, lang = loadLang()) {
  if (!code) return "";
  const en = String(code.say || "").trim();
  if (lang === "zh") return String(code.sayZh || "").trim() || en;
  if (lang === "ms") return String(code.sayMs || "").trim() || en;
  return en;
}

// Which words each of the engine's reasons gets. One table, so a reason added to
// the engine can never arrive on the page unworded — a language test walks every
// value here and insists it exists in all three dictionaries, with its
// placeholder. Everything not named falls to promoNo, the plain line that is
// always true: a code that cannot be used, messaged about, sorted out by hand.
const REFUSAL_KEY = {
  unknown: "promoUnknown",
  paused: "promoPaused",
  ended: "promoEnded",
  notYet: "promoNotYet",
  claimed: "promoClaimed",
  clash: "promoClash",
  small: "promoSmall",
};

// What the shop makes of the engine's answer. Pure data — no words, no document —
// so the Node tests can press every reason through it without a browser.
//
// Three outcomes:
//   "ok"   — the code is on the order and stated plainly.
//   "soft" — the code is on the order AND stated with its caveat. Two reasons can
//            only ever be a guess on a page with no login: "one per customer" and
//            "first orders only", read from what this phone remembers, and wrong
//            on a new phone or a cleared browser. Her standing rule is that a
//            website rule must never block or hide a sale she takes by hand, so
//            the shop says what it knows and leaves the real check to her — the
//            same division of labour the bring-a-friend credit already uses.
//   "no"   — nothing is stamped on the order, and the customer is told why.
//
// A "small" basket is the only reason with a way forward, so the engine asks it
// last — see evaluate(); this table must never be read as the order of the
// checks.
export function shopVerdict(r) {
  if (r && r.ok) return { kind: "ok", key: "promoAccepted" };
  const fail = (r && r.fail) || "unknown";
  if (fail === "used") return { kind: "soft", key: "promoAcceptedUsed", fail };
  if (fail === "firstOnly") return { kind: "soft", key: "promoAcceptedFirst", fail };
  // "Ended" and "hasn't started yet" are the two reasons whose whole point is
  // naming the day, and a date is the only thing that stops them reading as a
  // glitch. With no date to name there is nothing to say beyond the plain line.
  const dated = fail === "ended" || fail === "notYet";
  const on = r && typeof r.on === "string" ? r.on : "";
  if (dated && !/^\d{4}-\d{2}-\d{2}$/.test(on)) return { kind: "no", key: "promoNo", fail };
  return { kind: "no", key: REFUSAL_KEY[fail] || "promoNo", fail, on, short: r && r.short };
}

// The shop's answer for a code it STATES but never gates on — "one per customer" and
// "first orders only", the two it can only ever guess at. The code goes on the order
// exactly as if it had passed, because the real check is hers, in the app.
//
// One thing overrides the caveat: the basket. A code the customer qualified for on
// every other count but whose smallest basket this basket never reached is ON the
// order and gives NOTHING for it — the app deducts nothing (see awardOf in
// js/promo.js). So the shop must not promise money it will not hand over. It says the
// one line the customer can act on instead — "Add RM84 more to use it" — and the order
// still goes through with the code still riding on it, unchanged.
//
// Pure — no words, no document — so the Node tests press it directly, the same reason
// shopVerdict above is exported.
export function softVerdict(key, typed, total, codes = []) {
  const c = findCode(codes, typed);
  const short = c ? shortfallOf(c, total) : 0;
  if (c && short > 0) {
    return { kind: "soft", key: "promoSmall", fail: "small", code: c.code, short, offer: null, caveat: true };
  }
  return {
    kind: "soft",
    key,
    // findCode is asked for the engine's own spelling of the name: a card typed as
    // "fresh 10" is stamped "FRESH10".
    code: c ? c.code : normCode(typed),
    offer: c ? worthOf(c, total, 0) : null,
    caveat: true,
  };
}

// What THIS phone remembers about its own ordering. Not a login, and never
// presented as one: it is a guess, kept because a customer who has just used a
// code should not be told it is going spare. It only ever changes what the shop
// SAYS — it never stops an order being placed. Absent or unreadable reads as a
// brand-new phone, which is the safe direction: the shop states the caveat and
// takes the order either way.
const MEMO_KEY = "munchies.shop.v1";

export function shopMemo(store) {
  const ls = store || (typeof localStorage !== "undefined" ? localStorage : null);
  const none = { orders: 0, codes: [] };
  if (!ls) return none;
  try {
    const raw = JSON.parse(ls.getItem(MEMO_KEY) || "{}") || {};
    const codes = Array.isArray(raw.codes) ? raw.codes.map(normCode).filter(Boolean) : [];
    const orders = Number.isInteger(raw.orders) && raw.orders > 0 ? raw.orders : 0;
    return { orders, codes };
  } catch { return none; }
}

// One more order on this phone, and the code it carried if it carried one.
// Called only after the bakery's app has ACCEPTED the order: an order that fell
// back to WhatsApp was never recorded anywhere, and claiming it here would tell
// the next customer a code had been used when nothing says it was.
export function rememberShopOrder(code, store) {
  const ls = store || (typeof localStorage !== "undefined" ? localStorage : null);
  const memo = shopMemo(ls);
  const next = { orders: memo.orders + 1, codes: memo.codes.slice() };
  const c = normCode(code);
  if (c && !next.codes.includes(c)) next.codes.push(c);
  try { if (ls) ls.setItem(MEMO_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
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

// Whether she posts on this day at all, the cutoff aside: one of her configured
// posting weekdays, or a date the backoffice published (an extra Thursday she
// added by hand). The calendar needs this to tell the two days it cannot take an
// order for apart — one she never posts, and one she does post whose order
// window has shut — because they are answered with different sentences.
export function postsOn(cfg, dayRows, d) {
  if (cfg.deliveryDays.includes(d.getDay())) return true;
  const key = dateKey(d);
  return (Array.isArray(dayRows) ? dayRows : []).some((r) => r && r.date === key);
}

// What the page can say about a day it cannot take an order for, given whether
// the day is one it is offering (`spec`, a real posting day):
//   "miss"   — she does not post that day at all.
//   "closed" — she does post it, but its order window has shut. The cutoff is the
//              evening before, so a Wednesday is gone from 6pm on Tuesday.
//   null     — she posts it and the window is open, so this grid is simply not
//              offering it (the list is generated from tomorrow, so today is
//              never on it) and NEITHER sentence would be true of it.
// Keeping "closed" apart from "miss" is the whole point: calling a day she posts
// "not a posting day" would contradict the posting-days line on the card right
// above the grid, every evening, on her own posting day.
export function dayAsk(cfg, dayRows, d, spec, now = new Date()) {
  if (spec) return null;
  if (!postsOn(cfg, dayRows, d)) return "miss";
  return isOpen(cfg, d, now) ? null : "closed";
}

export function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// A single date as words — "30 September" — for a sentence that has to name one:
// "That code ended on 30 September." Takes the engine's own ISO spelling (the
// same YYYY-MM-DD key everything else uses), and answers "" for anything that is
// not a date, so a caller can tell "no date" from "the first of January". A
// refusal built around a date is never printed with a hole where the date goes.
export function dayWords(iso, lang = loadLang()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (lang === "zh") return `${MONTHS_ZH[d.getMonth()]}${d.getDate()}日`;
  if (lang === "ms") return `${d.getDate()} ${MONTHS_MS_LONG[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS_EN_LONG[d.getMonth()]}`;
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
  // The promo code the customer used, when they used one. Guarded, so an order
  // without a code produces byte-for-byte the message this page has always
  // produced — the bakery's own test asserts that message word for word.
  if (order.promo) msg += `\n🎟 ${order.promo}`;
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
        // Does this item invite a note? (v236.) Re-checked here on the shop's own
        // terms like everything else on this boundary: only a literal true is
        // adopted, so "yes", 1 and a missing key all read as "do not ask" and the
        // card is drawn exactly as it is today.
        if (p.askNote === true) out.askNote = true;
        // The thumbnail the baker set on the product. Checked against the
        // same rule the publisher used (storefront-fields.js), so anything that
        // is not a small JPEG data URL is dropped rather than drawn.
        if (isThumb(p.thumb)) out.thumb = String(p.thumb).trim();
        // Where this product sits among the ones no heading carries ("More
        // items"), re-checked on the shop's own terms like everything else here
        // — anything that is not a number is dropped rather than trusted, so a
        // mangled value leaves the tail in the order it was stored.
        const sort = Number(p.sort);
        const sortSet = p.sort != null && !(typeof p.sort === "string" && p.sort.trim() === "");
        if (sortSet && Number.isFinite(sort)) out.sort = sort;
        return out;
      });
    if (products.length) out.products = products;
  }
  // The category headings, in the baker's order, each naming the products shown
  // under it — depth-first, `depth` being the indent. Re-validated here on the
  // shop's own terms: a half-formed row is dropped rather than drawn, so a
  // malformed one can never reach the page.
  //
  // Replaced WHOLESALE, like the occasions above: the app publishes a complete
  // snapshot, so an empty list is a real instruction ("she deleted her last
  // category") and has to clear the headings an already-open page still shows.
  // An empty list draws nothing, so it can never break the shop.
  if (Array.isArray(remote.categories)) {
    out.categories = remote.categories
      .filter((c) => c && typeof c === "object" && String(c.name || "").trim())
      .slice(0, 200)
      .map((c) => {
        const depth = Number(c.depth);
        const row = {
          name: String(c.name).trim(),
          depth: Number.isInteger(depth) && depth >= 0 ? Math.min(depth, 31) : 0,
          products: (Array.isArray(c.products) ? c.products : [])
            .map((n) => String(n || "").trim()).filter(Boolean).slice(0, 500),
        };
        for (const k of ["nameZh", "nameMs"]) {
          const v = c[k];
          if (typeof v === "string" && v.trim()) row[k] = v.trim();
        }
        return row;
      });
  }
  // The promo codes the baker has published, judged by the SAME engine the code
  // box uses (admin/js/promo.js) — so a code the page accepts is exactly a code
  // that engine recognises, never two nearly-identical rules that can disagree.
  //
  // Replaced WHOLESALE, like the occasions and categories above: the app
  // publishes a complete snapshot every time, so an empty list is a real
  // instruction ("she deleted her last code") and has to clear the codes a code
  // box on an already-open page would otherwise keep accepting. A row that is
  // not a well-formed code is DROPPED rather than drawn, so a malformed one can
  // never reach the page and never be offered to a customer.
  if (Array.isArray(remote.promoCodes)) {
    out.promoCodes = remote.promoCodes
      .filter((c) => c && typeof c === "object" && codeNameOk(c.code))
      .slice(0, 200)
      .map(normalizeCode);
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
//
// NOTHING ABSENT IS PASSED ON. The array form is built by callers out of optional
// lines — the cancellation note is left out entirely when no product on the order has
// one — and `replaceChildren` is variadic: a `null` in that array is not a child that
// is skipped, it is a DOMString, so the DOM writes the word "null" onto the customer's
// receipt. That is the same defect class as the pickup-pin card at v195 (a single ARRAY
// argument, String()ed for the same reason) and the same one test/no-null-text.test.js
// exists for; filtering here rather than at each call site is what stops the next
// optional line from being the one that ships it.
function showConfirm(content, kind = "ok") {
  const box = document.getElementById("confirm-msg");
  if (!box) return;
  box.className = `confirm-msg ${kind}`;
  const parts = Array.isArray(content) ? content : [document.createTextNode(String(content))];
  box.replaceChildren(...parts.filter((c) => c != null));
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
  // Which build this is, in the smallest type on the page. It sits in the developer's own
  // corner with the credit above it, so it is there when the owner looks for it and out of
  // the way of everything a customer came for. It goes with the credit rather than instead
  // of it: a shop with no developer set has no credit to hang it under.
  holder.appendChild(el("div", { class: "dev-engine" }, `Engine v${ENGINE_VERSION}`));
}

// The suggestion box's own state, held OUTSIDE the DOM for the same reason the
// cart is: renderStatic() runs again on every language switch, and a textarea
// rebuilt from nothing would take a half-written sentence with it — and would
// un-say a thank-you the customer is still reading.
const fbState = { text: "", sent: false, note: "", busy: false, leaveSent: "" };

// The honeypot's live node. A leave-send has to read it off the screen, because a bot
// filling it fires nothing this page listens to — and the box is rebuilt on every repaint,
// so a listener holding the old node would be reading a field that is no longer shown.
let fbTrap = null;
let leaveWired = false;

// LEAVING THE PAGE IS ALSO A SEND. There is no Send button and no obligation to press
// Enter: a customer can write a sentence, close the shop, and the words still go — which is
// the whole point of a box that asks "comment, and I will make it better" without asking
// them to press anything. Nothing goes out while they are still here, so a half-finished
// sentence is never mailed while they are mid-thought.
//
// It is handed over ONCE. A page can be left more than once — the back/forward cache fires
// `pagehide` again when it is restored — and a second copy of one sentence in the
// developer's inbox is not a gift. `leaveSent` remembers what has already gone; typing
// clears it, because a sentence they have edited is a new one.
// Where the customer actually was, read off the live address rather than typed in here. A
// developer reading a feedback email should be able to tell which shop it came from without
// opening anything — and the page path is the half that names which page of that shop the
// words were written on.
function pageContext() {
  const loc = (typeof location !== "undefined" && location) || {};
  return {
    origin: String(loc.host || "").slice(0, 120),
    page: String(loc.pathname || "/store/").slice(0, 120),
  };
}

function sendOnLeave() {
  const words = String(fbState.text || "").trim();
  if (words.length < 3 || fbState.busy || fbState.sent) return;
  if (fbState.leaveSent === words) return;
  // Nowhere to go. A request the browser cannot deliver would take their words with it when
  // the page closes, and nobody would be left to hear that it failed — so the draft stays,
  // and the sentence goes the next time they leave with a connection.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  fbState.leaveSent = words;
  // The draft goes at the hand-off, not at an answer: the page is leaving and will not be
  // here to hear one, so waiting for a reply would leave their words on the device to be
  // sent a second time on the next visit. They come back only if we are still alive to
  // hear that the send failed — a failure nobody saw must not be a sentence lost.
  saveDraft("");
  sendFeedback({
    message: words, ...pageContext(), lang: loadLang(),
    honeypot: fbTrap ? fbTrap.value : "", keepalive: true,
  }).then((out) => {
    // Told plainly and only if we are still here to tell them: the reply takes the box's
    // place exactly as it does when Enter was pressed, so a customer who comes back finds
    // the answer rather than the sentence they already sent.
    if (out.ok) {
      fbState.sent = true;
      fbState.text = "";
      renderFeedback(CONFIG);
      return;
    }
    fbState.text = words;
    saveDraft(words);
  });
}

// The box under the "Website by" credit, where a customer tells the developer
// what they would change. It rides the SAME published `developerEmails` the
// credit above it does: that address is where the words go, so with none set
// there is nowhere to send them, and the box goes with the credit rather than
// standing there collecting sentences nobody will ever read.
function renderFeedback(cfg) {
  const holder = document.getElementById("fb-foot");
  if (!holder) return;
  holder.replaceChildren();
  const emails = Array.isArray(cfg && cfg.developerEmails)
    ? cfg.developerEmails.map((e) => String(e).trim()).filter(Boolean)
    : [];
  if (!emails.length) {
    holder.hidden = true;
    return;
  }
  holder.hidden = false;

  // Wired once, and on the window rather than on the box: the box is rebuilt on every
  // repaint, and a listener attached to it would be thrown away with it.
  if (!leaveWired && typeof window !== "undefined" && window.addEventListener) {
    leaveWired = true;
    window.addEventListener("pagehide", sendOnLeave);
  }

  // Already sent. The reply, and only the reply — nobody who has just been told
  // their idea was received needs the box offered again underneath it.
  if (fbState.sent) {
    holder.appendChild(el("p", { class: "fb-say fb-done", role: "status" }, t("fbThanks")));
    return;
  }

  // ONE LINE, as she asked, and it opens only when the words no longer fit — a box
  // standing three rows tall on every visit to the shop is weight nobody asked for.
  const box = el("textarea", {
    class: "fb-input", rows: "1", maxlength: "4000",
    placeholder: t("fbPh"), "aria-label": t("fbPh"),
  });
  // What the question itself needs, measured in a throwaway copy of the box so the real
  // one never has to hold it in order to find out. A textarea's scrollHeight does not
  // count its placeholder, so an empty box stays one line tall however wide the question
  // is — and on a narrow enough phone the question's second line would fall below the box
  // and be cut off mid-sentence. Where there is no layout to measure (the test shim)
  // this is 0, which is exactly the behaviour that came before it.
  const promptHeight = () => {
    if (typeof box.cloneNode !== "function" || !document.body) return 0;
    // A box that is not on the page yet has no width, and a box with no width reports
    // every character on a line of its own. Nothing to measure means nothing to add.
    if (!Number(box.offsetWidth)) return 0;
    const probe = box.cloneNode(false);
    probe.removeAttribute("placeholder");
    probe.setAttribute("aria-hidden", "true");
    probe.value = t("fbPh");
    probe.style.position = "absolute";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.width = `${box.offsetWidth || 0}px`;
    probe.style.height = "auto";
    document.body.appendChild(probe);
    const h = Number(probe.scrollHeight) || 0;
    if (probe.remove) probe.remove();
    return h;
  };
  const grow = () => {
    if (!box.style) return;
    box.style.height = "auto";
    let h = Number(box.scrollHeight) || 0;
    if (!box.value) h = Math.max(h, promptHeight());
    if (h > 0) box.style.height = `${h + 2}px`; // +2 for the border, which scrollHeight leaves out
  };
  // Put their words back where they left them — the restore half of the autosave. A
  // customer can write a sentence, never press Enter (the box has no button to make
  // sending obvious) and tap away; coming back finds it still here. Read only when this
  // session has nothing of its own to draw, so a repaint never overwrites live typing.
  if (!fbState.text) fbState.text = loadDraft();
  box.value = fbState.text;
  grow();

  // The honeypot. A person never sees it and never fills it; a bot filling every
  // input does, and the function answers a filled one exactly as it answers a
  // real send, so a bot learns nothing from being refused.
  const trap = el("input", {
    class: "fb-trap", type: "text", name: "website",
    tabindex: "-1", autocomplete: "off", "aria-hidden": "true",
  });
  fbTrap = trap;

  // ONE LINE UNDER THE BOX, which says whichever of the three things is true and
  // nothing else: the last failure, that the words are on their way, or — once there
  // are words and no button to press — the one instruction there is. At rest, with
  // nothing typed, it says nothing at all.
  const say = el("p", { class: "fb-say", role: "status" });
  const paint = () => {
    box.disabled = !!fbState.busy;
    if (fbState.note) {
      say.hidden = false;
      say.className = "fb-say fb-bad";
      say.textContent = t(fbState.note);
      return;
    }
    // Nothing to act on yet is silence; anything else gets the one line it is due.
    const wrote = box.value.trim().length >= 3;
    say.className = "fb-say";
    say.hidden = !(fbState.busy || wrote);
    say.textContent = fbState.busy ? t("fbSending") : wrote ? t("fbHint") : "";
  };

  const send = async () => {
    if (fbState.busy) return; // one press, one message; the box is off while it flies
    const words = box.value.trim();
    if (words.length < 3) {
      fbState.note = "fbEmpty";
      paint();
      return;
    }
    fbState.busy = true;
    fbState.note = "";
    paint();
    const out = await sendFeedback({ message: words, ...pageContext(), lang: loadLang(), honeypot: trap.value });
    fbState.busy = false;
    if (out.ok) {
      fbState.sent = true;
      fbState.note = "";
      fbState.text = "";
      saveDraft(""); // it arrived, so there is nothing left to keep
      renderFeedback(CONFIG);
      return;
    }
    // The send did NOT land, and the customer is told so rather than thanked:
    // a thank-you over a message that never left would stop them trying again,
    // and nobody would ever learn the words were lost. The developer's WhatsApp
    // link is already drawn just above this box.
    fbState.note = out.key;
    paint();
  };

  box.addEventListener("input", () => {
    fbState.text = box.value;
    // Typing is them saying "I am answering after all" — so a failure line about the
    // last send stops being true the moment they start the next one.
    if (fbState.note) fbState.note = "";
    // A sentence they have changed is a sentence that has not gone yet.
    fbState.leaveSent = "";
    saveDraft(fbState.text);
    grow();
    paint();
  });
  // Tapping away keeps it too. This is the second half of "never press Enter": the words
  // are safe whether they leave the box to look at the page or leave the page entirely.
  box.addEventListener("blur", () => saveDraft(box.value));
  // Enter sends. There is no button to press, so nothing else can: a one-line box in
  // a footer has exactly one key that means "done", and on a phone that is the return
  // key. Shift+Enter is not a second line — she asked for one line.
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    return send(); // returned so a test can await the send this key started
  });

  paint();
  // The box and the trap. The answer line, when there is one, goes under them.
  holder.appendChild(el("div", { class: "fb-row" }, box, trap));
  holder.appendChild(say);
  // Sized last, and only once the box is actually on the page: an element that has not
  // been laid out has no width to measure the question against.
  grow();
}

// The static header parts (name, tagline, delivery days, social links). Kept
// separate so a later-published config can re-render just these.
export function renderStatic(cfg) {
  document.title = `${t("titleWord")} · ${cfg.name}`;
  document.getElementById("name").textContent = cfg.name;
  document.getElementById("tagline").textContent = cfg.tagline;
  document.getElementById("eyebrow").textContent = sub(t("madeToOrder"), clockWords(cfg.cutoff));

  const days = cfg.deliveryDays.map((n) => dayName(n)).join(", ");
  document.getElementById("delivery-days").textContent = days;
  document.getElementById("cutoff").textContent = sub(t("beforeVal"), clockWords(cfg.cutoff));

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
  renderFeedback(cfg);
}

// A referral-link visitor (?via=…) sees one amount-free line near the top of the
// page. Deliberately amount-free: the bakery's scheme numbers are private and
// changeable, and she quotes the real figure in her WhatsApp confirmations.
function renderReferralBanner() {
  const box = document.getElementById("referral-banner");
  if (!box) return;
  box.hidden = !currentVia();
}

export function render() {
  renderStatic(CONFIG);
  const dateWrap = document.getElementById("dates");
  const menu = document.getElementById("menu");
  const cart = new Map();
  // What the customer typed as a note on each item (v236), and which items' note
  // boxes they have opened. Both are keyed by product NAME, exactly like the cart
  // itself, and both live HERE rather than in the card's DOM — because a card is
  // rebuilt on every stepper tap (redraw() below), and anything held in the card
  // would be wiped out mid-sentence by a press of "+".
  //
  // A note is read ONLY for a name that is in the cart, so one left behind by a
  // line that was stepped to zero — or removed by reconcileCart because it sold
  // out — is inert: it is never sent, and it is still there if they add the item
  // back. That is why nothing here bothers to sweep up after a removal.
  const lineNotes = new Map();
  const noteOpen = new Set();
  let selected = null;
  let avail = null;      // { 'YYYY-MM-DD': slots_left } — day-level, for the calendar
  let prodAvail = null;  // { 'YYYY-MM-DD': { product: slots_left } } — for the item stamps
  let dayRows = null;    // published delivery-date rows — the real dates win
  let dates = upcomingDates(CONFIG);
  // A product's date rules (closes X days before delivery / a from–to window)
  // compare each delivery date to today, so its reference is fixed at load.
  const todayKey = dateKey(new Date());

  // ── Promo code ────────────────────────────────────────────────────────────
  // The standing offer line above the menu, and the code box beside the referral
  // banner. ONE judgement stands behind both — admin/js/promo.js — and the shop
  // never takes money off the total: an accepted code is STATED, carried on the
  // order, and the bakery subtracts it by hand in WhatsApp, exactly as she does
  // for the bring-a-friend credit. So nothing here can refuse a sale: an order
  // goes through with or without a code, and a code this page does not recognise
  // is simply not stamped on it.
  //
  // Declared up here rather than beside the wiring below because renderBar() can
  // run on the very first paint (reconcileCart fixes a cart the moment the
  // availability data lands) and renderBar ends by repainting these lines.
  let promoApplied = "";   // the accepted code, or "" — only this is stamped
  let promoRefusal = null; // {key, on, short} of the last refusal, cleared on a good code

  const promoInput = document.getElementById("promo-input");
  const promoSay = document.getElementById("promo-say");
  const promoToday = document.getElementById("promo-today");
  const promoOffer = document.getElementById("promo-offer");
  const promoWords = document.getElementById("promo-words");
  const promoClear = document.getElementById("promo-clear");

  // What the basket comes to right now. The same sum renderBar shows in the bar,
  // asked separately because the promo lines need it whether or not the bar is
  // being redrawn, and a percentage's money has to be worked out against it.
  function cartTotal() {
    let total = 0;
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (p) total += q * p.price;
    }
    return total;
  }

  function publishedCodes() {
    return Array.isArray(CONFIG.promoCodes) ? CONFIG.promoCodes : [];
  }

  // The code the shop is willing to ADVERTISE today: public, switched on, inside
  // its dates, and not already given away. Asked through the engine's own
  // stoppedBy, so the standing line and the code box can never disagree about
  // what "still running" means. A personal code is never shown here — being
  // unadvertised is the whole of what "personal" buys (see publishCodes).
  function standingCode() {
    const today = dateKey(new Date());
    return publishedCodes().find((c) => c.vis === "public" && !stoppedBy(c, today)) || null;
  }

  function say(key, className, ...args) {
    if (!promoSay) return;
    promoSay.textContent = sub(t(key), ...args);
    promoSay.className = `card-sub promo-say ${className}`;
    promoSay.hidden = false;
  }

  // The words for a refusal, built here because this is where the date and the
  // shortfall can be spelled in the customer's own language.
  function refusalArgs(v) {
    if (v.fail === "ended" || v.fail === "notYet") return [dayWords(v.on)];
    if (v.fail === "small") return [`RM${(Number(v.short) || 0).toFixed(2)}`];
    return [];
  }

  // Everything the engine needs to judge a code for THIS customer: the day, the
  // basket, and the three things only this phone can answer — what it remembers
  // about its own orders, and whether a referral credit is riding on the order
  // (the bring-a-friend welcome discount and a "not beside the credit" code are
  // the same money, so a code that says it cannot sit beside it must see it).
  //
  // The delivery fee is the one input the shop genuinely does not have: she
  // quotes carriage by hand, so a free-delivery code is worth its words and
  // nothing is subtracted here. 0 is the honest answer, not a placeholder.
  function judgeCtx(total) {
    const memo = shopMemo();
    return {
      today: dateKey(new Date()),
      total,
      deliveryFee: 0,
      usedCodes: memo.codes,
      isNew: memo.orders === 0,
      creditApplied: !!currentVia(),
    };
  }

  // One verdict, so the box and every repaint can never disagree: hand the engine
  // a typed code and the whole context, and say what the shop makes of it.
  function judge(typed, total) {
    const codes = publishedCodes();
    const r = evaluate(codes, typed, judgeCtx(total));
    const v = shopVerdict(r);
    if (v.kind === "ok") {
      return { kind: "ok", key: v.key, code: r.code.code, offer: r.offer, delivery: r.delivery };
    }
    if (v.kind === "soft") return softVerdict(v.key, typed, total, codes);
    return { kind: "no", key: v.key, fail: v.fail, on: v.on, short: v.short };
  }

  // Redraw both lines. Called on every cart change (renderBar) because the basket
  // is part of the judgement: a percentage's money moves with the total, and so
  // does whether a minimum is met. Nothing here touches what the customer has
  // typed into the box — only the line under it.
  function paintPromo(total) {
    // An accepted code is re-judged every time, for the same reason. If it stops
    // qualifying — she ended it while the page was open, or the basket fell below
    // its minimum — it stops being applied, because the shop must never state a
    // discount it can no longer honour. The order still goes through either way.
    //
    // A code the customer has already used on this phone, or one that is for first
    // orders only, comes back "soft" here for the same reason it did when it was
    // typed: it is on the order, with its caveat.
    let got = null;
    if (promoApplied) {
      const j = judge(promoApplied, total);
      if (j.kind === "no") { promoApplied = ""; promoRefusal = j; }
      else got = j;
    }

    if (promoToday) {
      // The standing line stands down for a code the customer ACTUALLY GOT — one
      // code per order, and the accepted line under the box is what says so.
      //
      // It stands down only then. A code the page REFUSED is not on the order, so
      // nothing is being swapped and there is no second code to avoid offering —
      // and taking the day's offer off the screen because the customer mistyped
      // would hide a real sale behind their own typo. The refusal stays, and the
      // standing line stays there to tell them the code they were looking for.
      const c = promoApplied ? null : standingCode();
      promoToday.hidden = !c;
      if (promoOffer) promoOffer.textContent = c ? sub(t("promoToday"), clauseWords(c), c.code) : "";
      // Her own sentence, underneath the app's line and never instead of it: the
      // app's line is what names the code, and a customer who cannot type the
      // code cannot use it. A code she has written nothing for shows one line,
      // exactly as it did before she could write anything.
      if (promoWords) {
        const own = c ? ownWords(c) : "";
        promoWords.hidden = !own;
        promoWords.textContent = own;
      }
    }
    if (promoSay) promoSay.hidden = true;
    // A code the shop is stating-but-not-gating can still be one the basket is too
    // small for. It is on the order either way, but it will give nothing for it, so
    // the customer gets the line they can act on — "Add RM84 more to use it" — and
    // not an offer that will never be honoured.
    if (got && got.short) say(got.key, "bad", ...refusalArgs(got));
    else if (got && got.offer) say(got.key, "good", offerWords(got.offer), got.code);
    else if (promoRefusal) say(promoRefusal.key, "bad", ...refusalArgs(promoRefusal));
    if (promoClear) promoClear.hidden = !promoApplied;
  }

  function applyTyped() {
    if (!promoInput) return;
    const typed = tidyCode(promoInput.value);
    const total = cartTotal();
    if (!typed) {
      promoApplied = ""; promoRefusal = null;
    } else {
      const j = judge(typed, total);
      if (j.kind === "no") {
        promoApplied = "";
        promoRefusal = j;
      } else {
        promoApplied = j.code;
        promoRefusal = null;
        promoInput.value = j.code; // shown back spelled as the engine knows it
      }
    }
    paintPromo(total);
  }

  const renderMenu = () => {
    const byProduct = prodAvail && selected ? prodAvail[selected] || {} : {};
    const groups = poolGroups(CONFIG.products);
    const lang = loadLang();

    // A product's own date rules decide whether it is on TODAY's menu at all.
    // Not sold on the chosen delivery day → it is simply not there: the customer
    // does not see a thing they cannot have. Two exceptions keep the card and
    // say so instead: the baker's advance notice (that product IS sold on the
    // day, it only has to be ordered earlier), and a product she has switched to
    // stay listed — the few hot items a customer comes back looking for, whose
    // absence would otherwise read as "they stopped making it". A product with
    // no marks at all (value packs included) sells on any open date.
    //
    // Asked in one place and read in two, because the grouping below needs to
    // know what is on today's menu BEFORE it can decide which headings are worth
    // drawing — and it must never come out differently from the cards themselves.
    const menuGate = (p) => {
      const closed = closedReason(p, selected, todayKey);
      const kept = !!(closed && closed.kind !== "close" && p.alwaysListed === true);
      return { closed, kept, shown: !(closed && closed.kind !== "close" && !kept) };
    };

    // One product's card, or null when it is off today's menu. A function rather
    // than a loop body because a product filed under two categories is drawn
    // TWICE — and a DOM node can only live in one place, so each placement needs
    // a card of its own, with its own stepper.
    const cardFor = (p) => {
      const { closed, kept, shown } = menuGate(p);
      if (!shown) return null;
      const group = groupFor(groups, p);
      const baseLeft = group && byProduct[group.baseName] != null
        ? Number(byProduct[group.baseName]) : undefined;
      const caps = group && Number.isFinite(baseLeft) ? poolCaps(group, baseLeft, cart) : null;
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
      // A repaint rebuilds this card, so a note box the customer is typing in
      // would be replaced and lose the caret. The WORDS are never at risk (they
      // live in `lineNotes`, keyed by product name, and the box is rebuilt FROM
      // them), but a box that quietly dropped the caret out from under a typing
      // thumb would read as broken — so the caret is put back where it was.
      const redraw = () => {
        const active = document.activeElement;
        const typing = active && active.dataset && active.dataset.lineNote != null
          ? { name: active.dataset.lineNote, at: active.selectionStart } : null;
        renderMenu();
        renderBar();
        if (!typing) return;
        const again = Array.from(menu.querySelectorAll("input.line-note"))
          .find((n) => n.dataset.lineNote === typing.name);
        if (!again) return;
        again.focus();
        if (typing.at != null && again.setSelectionRange) {
          try { again.setSelectionRange(typing.at, typing.at); }
          catch { /* a box with no text range, or a test shim */ }
        }
      };
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
      // ── This item's own note (v236) ────────────────────────────────────────
      // Offered only where the product invites one (the baker's switch, published
      // as `askNote`), and only once the item is actually in the basket — a note
      // on something nobody is ordering would have no line to belong to. It opens
      // on a press rather than standing open on every card, so the menu keeps the
      // shape it has always had.
      //
      // Once opened it stays open, and the words stay in `lineNotes` even if the
      // item is stepped back to zero and added again — a stray "−" must not cost
      // the customer what they typed. Nothing here gates anything: an empty box
      // and no box at all place exactly the same order.
      const lineNoteArea = p.askNote === true && !soldOut && !reason && qty > 0
        ? el("div", { class: "line-note-row" },
            noteOpen.has(p.name)
              ? el("input", { class: "input line-note", type: "text",
                  maxlength: String(LINE_NOTE_MAX),
                  placeholder: t("lineNotePh"),
                  value: lineNotes.get(p.name) || "",
                  dataset: { lineNote: p.name },
                  oninput: function () { lineNotes.set(p.name, this.value); } })
              : el("button", { class: "line-note-add", type: "button",
                  onclick: () => { noteOpen.add(p.name); redraw(); } }, t("addNoteLink")))
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
      return el("div", {
        class: `card menu-item${soldOut ? " soldout" : ""}`,
        dataset: { product: p.name },
      },
        // The photo is the card's own LEFT COLUMN: one standard 120 x 120 window,
        // the same window her app's products list and the editor use (.menu-thumb
        // in app.css). A FIXED size, not a strip that stretches to the card's own
        // height — so the same picture is the same size wherever she meets it.
        // Everything else stacks in `.card-body` beside it, and a product with no
        // photo is simply a card whose body is its only child, so the two shapes
        // cannot drift apart.
        p.thumb
          ? el("img", { class: "menu-thumb", src: p.thumb, alt: "", loading: "lazy", decoding: "async" })
          : null,
        el("div", { class: "card-body" },
          // `.card-head` is space-between, so the words and the stamp each keep
          // their end. `min-width: 0` on the words is what lets a long product
          // name wrap instead of shoving the stamp off the card.
          el("div", { class: "card-head" },
            el("div", { class: "card-words" },
              el("p", { class: "card-title" }, nameFor(p, lang)),
              el("p", { class: "card-sub" }, `RM${p.price.toFixed(2)} / ${unitFor(p, lang)}`),
              desc ? el("p", { class: "prod-desc" }, desc) : null),
            stamp),
          el("div", { class: "stepper" }, dec, qtyLabel, inc),
          lineNoteArea,
          note,
          nextNote,
          cancelNote));
    };

    // What is actually on today's menu, in the shop's own product order. Asked
    // with the same gate the cards use, so the two can never disagree.
    const live = CONFIG.products.filter((p) => menuGate(p).shown);
    // Every product marked off today leaves nothing at all — say so rather than
    // showing a blank space where the menu should be.
    if (!live.length) {
      menu.replaceChildren(el("p", { class: "card-sub" }, t("noMenuToday")));
      return;
    }
    // A shop with no categories is drawn exactly as it always was: one plain
    // list, no headings. Only once she has built a heading does the grouping
    // below come into play, so a shop that never uses them cannot be changed by
    // this feature.
    const catRows = Array.isArray(CONFIG.categories) ? CONFIG.categories : [];
    if (!catRows.length) {
      menu.replaceChildren(...live.map(cardFor));
      return;
    }
    // Draw the tree: the headings in her order, each over the cards it names, and
    // anything she has not filed last under one plain heading. A card filed under
    // two headings is drawn under BOTH — that is what filing it twice is for — so
    // only the headings themselves must not repeat. The product is looked up by
    // name, which is the key the rest of this page already agrees on.
    const byName = new Map(live.map((p) => [p.name, p]));
    const rows = catRows.map((c) => ({
      c,
      prods: (c.products || []).map((n) => byName.get(n)).filter(Boolean),
    }));
    // A heading with nothing to show is dropped rather than drawn as an empty
    // shelf — but a heading whose own products have all sold out today is KEPT
    // when something nested under it survives, or a whole branch would vanish
    // with a parent that had a quiet day.
    const draws = rows.map((row, i) => {
      if (row.prods.length) return true;
      for (let j = i + 1; j < rows.length && rows[j].c.depth > row.c.depth; j++) {
        if (rows[j].prods.length) return true;
      }
      return false;
    });
    // The words on a nested heading are the whole path down to it ("For Dog ›
    // Treats"), so a heading deep in a long scroll still says where it sits. The
    // stack is the ancestors, kept in step with depth because the list is
    // depth-first.
    const stack = [];
    const placed = new Set();
    const children = [];
    rows.forEach((row, i) => {
      stack[row.c.depth] = row.c;
      if (!draws[i]) return;
      const label = stack.slice(0, row.c.depth + 1).filter(Boolean)
        .map((c) => nameFor(c, lang)).join(" › ");
      children.push(el("h3", {
        class: `menu-cat${row.c.depth ? " menu-cat-sub" : ""}`,
        ...(row.c.depth ? { style: `--depth:${row.c.depth}` } : {}),
      }, label));
      for (const p of row.prods) {
        children.push(cardFor(p));
        placed.add(p.name);
      }
    });
    // The tail is the one list a product orders ITSELF in: each carries its own
    // `sort`, because unlike a heading — which is a record that can hold the
    // order of everything under it — an unfiled product has nothing to hang its
    // place on. The sort is stable, so products she has never dragged (no
    // `sort` at all) keep the order they arrived in rather than shuffling.
    const unfiled = live
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !placed.has(p.name))
      .sort((a, b) => {
        const ra = Number.isFinite(Number(a.p.sort)) ? Number(a.p.sort) : Number.MAX_SAFE_INTEGER;
        const rb = Number.isFinite(Number(b.p.sort)) ? Number(b.p.sort) : Number.MAX_SAFE_INTEGER;
        return ra - rb || a.i - b.i;
      })
      .map(({ p }) => cardFor(p));
    if (unfiled.length) {
      children.push(el("h3", { class: "menu-cat menu-cat-tail" }, t("moreItems")));
      children.push(...unfiled);
    }
    menu.replaceChildren(...children);
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
  // The customer picks their day from a five-week window instead of a month grid,
  // so the days her bakery actually delivers stand out at a glance and the chosen
  // one is read in words underneath. The window follows today — the week just
  // gone is the first row and this week is the second — so the past can never
  // take over the screen the way it does at the end of a month, and no cell in it
  // is ever invisible padding. Only the standard days the baker has marked are
  // drawn — the shop is never told about her own private marks.

  // How many whole weeks forward the window has been paged. Kept across repaints
  // (a 30-second refresh must not fling the customer back to today) and clamped
  // to the windows that hold a delivery day whenever the data changes.
  let calOffset = null;

  // Which way the window last moved, so the grid it lands on can arrive the way the
  // dates did: later, the rows travel up; earlier, down. Set by the arrows and
  // cleared by the very next paint, so a live refresh never animates.
  let calSlide = 0;

  // The marked day whose name is showing, as a YYYY-MM-DD key, or null. A tap sets
  // it; any tap elsewhere clears it. It is read while the grid is rebuilt, so the
  // bubble survives the rerender the tap itself triggers.
  let tipIso = null;
  let tipInstalled = false;

  // The day the customer asked about that the grid could not give them, as a
  // YYYY-MM-DD key, or null; and whether that day is one she posts whose order
  // window has shut, which is answered with its own sentence. Same lifetime as
  // the bubble next to it: a tap sets them, and tapping any day of the grid
  // clears them. A tap on either kind of day used to do nothing whatsoever
  // (21 Sep 2026), which reads as a broken page rather than as an answer — so
  // the grid now says so instead (see missNote).
  let missIso = null;
  let missClosed = false;

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

    // The window the customer sees. Home is today's own window; it only slides
    // forward when nothing on sale is inside it, and `last` is the furthest window
    // that still holds a date she has published — so nothing on sale is ever out
    // of reach. See windowBounds.
    const { home, last } = windowBounds(
      todayK, dateKey(open[0].date), dateKey(specs[specs.length - 1].date));
    if (calOffset == null || calOffset < home || calOffset > last) calOffset = home;
    const canPrev = calOffset > home;
    const canNext = calOffset < last;

    const nav = (delta) => {
      calOffset += delta;
      calSlide = delta;
      rerender();
    };
    // The arrows only exist when there is somewhere to go: at home on today's
    // window there is nothing earlier to see, and nothing later until the baker
    // publishes a date beyond it. An arrow with nothing to do is not drawn at all
    // rather than drawn greyed out — a dead control reads as a bug. Its slot is kept
    // either way, so the title is centred on the card rather than drifting sideways
    // when an arrow comes or goes; an empty span is not a control.
    const arrow = (label, delta, shown) => {
      if (!shown) return el("span", { class: "cal-slot" });
      return el("button", { class: "cal-nav", "aria-label": label, onclick: () => nav(delta) },
        delta < 0 ? "‹" : "›");
    };
    const weeks = rollingWeeks(todayK, { offset: calOffset });
    // The window's own two ends — every cell is a real date, so the title is
    // simply the first and last of them.
    const head = el("div", { class: "cal-head" },
      arrow(t("calPrev"), -1, canPrev),
      el("span", { class: "cal-title" }, windowTitle(weeks[0][0], weeks[weeks.length - 1][6])),
      arrow(t("calNext"), 1, canNext));
    const all = marks();
    const cells = weeks.flat().map((iso) => {
      const spec = byKey.get(iso);
      const isSel = iso === selected;
      const past = iso < todayK;
      const full = !!spec && spec.soldOut;
      const open = !!spec && !full && !past;
      // A day still to come that this grid cannot take an order for is answered
      // rather than swallowed (see missNote and dayAsk) — in one of the two ways
      // it comes, because the two are different facts: a day she does not post,
      // and a day she does post whose order window has shut. A day already gone
      // is asked nothing at all, and a posting day with no room left is not asked
      // either — it is already named in the Sold out line.
      const ask = past ? null : dayAsk(CONFIG, dayRows, new Date(`${iso}T00:00:00`), spec);
      const askable = ask === "miss";
      const closed = ask === "closed";
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
      // tapped to read its name; a day the grid cannot take an order for is tapped
      // to be told why — and the one day can be more than one of those.
      if (open || named || askable || closed) {
        return el("button", {
          class: cls + (open || askable || closed ? " tappable" : "") + (named ? " tippable" : ""),
          onclick: () => {
            if (named) tipIso = iso;
            if (open) selected = iso;
            // Choosing a real day takes the answer away with it; asking about
            // another day it cannot take replaces it. The one tap can never be
            // both, because a day she posts is not askable.
            missIso = askable || closed ? iso : null;
            missClosed = closed;
            // Rebuild the grid + menu together so the chosen day and the quantities
            // the customer chose are re-checked against this day's availability.
            rerender();
          },
        }, ...kids);
      }
      return el("span", { class: cls }, ...kids);
    });

    // Which way this grid is arriving, read and cleared in the same breath so only
    // the paint the arrow caused can carry it — a live refresh leaves it unset and
    // so moves nothing. See calSlide.
    const slide = calSlide ? { slide: calSlide > 0 ? "up" : "down" } : null;
    calSlide = 0;

    dateWrap.replaceChildren(
      el("div", { class: "cal" },
        head,
        el("div", { class: "cal-grid", dataset: slide },
          ...dowNames().map((d) => el("span", { class: "cal-dow" }, d)),
          ...cells,
          // The bands go in last and sit behind the cells (see .occ-paper).
          ...occBands(weeks, todayK)),
        // The day they picked, in words — the one line under the grid.
        el("p", { class: "cal-chosen" },
          sub(t("calChosen"), fmtDay(new Date(`${selected}T00:00:00`)))),
        // Any day in this window with no room left, named rather than guessed at.
        soldOutLine(specs, new Set(weeks.flat())),
        // The answer to a tap the grid could not act on, last because it is the
        // reply to whatever the customer just did.
        missNote(specs)));
  };

  // "Sun, 20 Sep is not a posting day — please pick a green day." for a day she
  // does not post, and "Orders for Wed, 23 Sep have closed — please pick a green
  // day." for one she does post whose window has shut. A tap on either used to do
  // nothing at all; this is what answers it. It is a line under the grid, not a
  // bubble over the day: a bubble is a word or two wide (that is how a marked day
  // names itself) and this is a whole sentence, which at the edge of a phone would
  // run off the screen. Empty unless the customer just asked about such a day —
  // and empty again if that day has since become one she is offering, so a refresh
  // can never leave the line telling a lie.
  function missNote(specs) {
    if (!missIso) return null;
    if (specs.some((s) => dateKey(s.date) === missIso)) return null;
    return el("p", { class: "cal-miss" },
      sub(t(missClosed ? "calClose" : "calMiss"), fmtDay(new Date(`${missIso}T00:00:00`))));
  }

  // "Sold out: 18 Sep, 25 Sep" — the days on screen that are already full. Empty
  // when the window has none, so the line takes no space.
  function soldOutLine(specs, shown) {
    const names = specs
      .filter((s) => s.soldOut && shown.has(dateKey(s.date)))
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
            // The codes arrive with this row, long after the page first drew, so
            // the standing line and any code already in the box are redrawn here
            // rather than waiting for the customer to touch something.
            if (repaintPromo) repaintPromo();
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
    // config (which is what carries the codes) arrives. The promo lines ride on
    // this repaint, because the basket is part of their judgement: a percentage's
    // money moves with the total, and so does whether a code's minimum is met.
    paintPromo(total);
    return total;
  }

  const orderBtn = document.getElementById("order-btn");
  orderBtn.onclick = async () => {
    if (orderBtn.disabled) return; // one tap only — no double orders
    const lines = [];
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      const line = { name: n, qty: q, price: p.price };
      // The customer's own words for this item (v236), when they wrote any. The
      // key is written only when there IS something to send, so an order with no
      // notes posts byte-for-byte the payload this page has always posted — the
      // same "absent means nothing" spelling the pin and the referral stamp use.
      const noteText = lineNoteOf(lineNotes.get(n));
      if (noteText) line.note = noteText;
      lines.push(line);
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
        el("p", { class: "confirm-body" }, sub(t("confirmClosedBody"), clockWords(CONFIG.cutoff))),
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
    // The door pin the customer dropped, when they dropped one and this order is
    // being delivered. `placeForOrder` answers null for anything else — a
    // self-collect order, or a courier order with no pin — and a null answer writes
    // NOTHING, so an order without a pin posts byte for byte the payload the shop
    // has always posted. The pin carries the customer's OWN address as its words and
    // never the suggestion list's name for the place it matched (v205, and see
    // placeForOrder for why); the bakery treats what arrives as untrusted input and
    // keeps the point and those words, capped; the door it actually drives to is the
    // one she accepts.
    const place = placeForOrder(doorPin, order.fulfillment, order.address);
    if (place) order.place = place;
    // A referral link's ?via= stamp: which customer's personal link this order
    // came through. You decide (new vs repeat) and apply the discount.
    const via = currentVia();
    if (via) order.referredBy = via;
    // The promo code the customer had ACCEPTED, when they had one. Only an
    // accepted code is ever written — a code the page refused is not recorded,
    // and never stopped the order. Written only when there is one, the same
    // "absent means nothing" spelling as the referral stamp above, so an order
    // placed without a code posts the payload this page has always posted.
    if (promoApplied) order.promo = promoApplied;
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
      //
      // What this phone now remembers about its own ordering. Written here, on
      // the one path where the order really landed — an order that fell back to
      // WhatsApp reached no record at all, and counting it would tell the next
      // customer a code had been used when nothing says it had.
      rememberShopOrder(promoApplied);
      cart.clear();
      // …and with it every note typed against it, or the next customer's first
      // look at the menu would open with the last person's words sitting in the
      // boxes. Nothing else on this page is carried over; neither is this.
      lineNotes.clear();
      noteOpen.clear();
      const noteBox = document.getElementById("menu-note");
      if (noteBox) { noteBox.hidden = true; noteBox.replaceChildren(); }
      document.getElementById("name-input").value = "";
      document.getElementById("whatsapp-input").value = "";
      document.getElementById("address-input").value = "";
      document.getElementById("note-input").value = "";
      // The promo code went ON the order, so it comes off the page — the next customer
      // must not find the last one's discount sitting in the box, already applied
      // and about to be stamped on an order it was never meant for.
      promoApplied = ""; promoRefusal = null;
      if (promoInput) promoInput.value = "";
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
      resetPin(); // the next customer does not inherit this one's front door
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

  // The promo box's own wiring. Bound here rather than beside the state above so
  // the listeners are attached once, after the page has drawn.
  if (promoInput) {
    promoInput.addEventListener("input", () => { promoRefusal = null; paintPromo(cartTotal()); });
    promoInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyTyped(); }
    });
  }
  const promoBtn = document.getElementById("promo-apply");
  if (promoBtn) promoBtn.addEventListener("click", applyTyped);
  if (promoClear) promoClear.addEventListener("click", () => {
    promoApplied = ""; promoRefusal = null;
    if (promoInput) promoInput.value = "";
    paintPromo(cartTotal());
  });
  repaintPromo = () => paintPromo(cartTotal());

  renderBar();

  // A card's own link (?promo=FRESH10) arrives with the code already in it, so
  // the customer never has to retype what they were handed. Read once, at boot.
  if (promoInput && currentPromo()) {
    promoInput.value = currentPromo();
    applyTyped();
  }

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
    // The pin's own line, said again in the language just chosen — including a
    // refusal or a vague-fix warning, which is exactly the sentence a customer who
    // cannot read the first language most needs to read.
    const note = pinNote;
    paintPin(note && note.key, note && note.m);
    // And the address list, which is showing a sentence — "Couldn't find that
    // address", "Tap the one that matches" — in the language the customer just left.
    const hits = hitNote;
    paintHits(hits && { key: hits.key, hits: hits.hits, q: hits.q });
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

// The one line for whatever is in the tracking slot: a courier's page, or a
// number to read out. Kept beside paintTrack because it exists only for that
// card, and it is a function rather than two inline branches so the label and the
// value cannot drift apart — the failure that matters is a NUMBER rendered as a
// link, which sends a customer to nothing. Only http and https are links, so a
// `javascript:` or `data:` value is words, not a destination.
function trackingEl(value) {
  const said = String(value || "").trim();
  const isLink = /^https?:\/\/[^\s]+$/i.test(said);
  if (!isLink) return el("p", { class: "track-no" }, sub(t("trackingNo"), said));
  return el("p", { class: "track-no" },
    `${t("trackDelivery")} `,
    el("a", { href: said, target: "_blank", rel: "noopener noreferrer" }, said));
}

// The phases the backoffice publishes about a booked trip, and this page's own words
// for them. The backoffice sends a NEUTRAL phase — finding, on_the_way, collected — and
// never the courier's own status string, so this page needs no table of any company's
// vocabulary and a second courier cannot make it wrong. A phase that is not in this list
// draws nothing at all: a customer cannot act on an unfamiliar word, so the honest thing
// is to leave the line off rather than print something nobody can read.
const TRIP_WORDS = {
  finding: "tripFinding",
  on_the_way: "tripOnTheWay",
  collected: "tripCollected",
  delivered: "tripDelivered",
  stopped: "tripStopped",
  nodriver: "tripNoDriver",
};

// The lines about the booked trip itself: where the courier says it has got to, who is
// bringing it, and a way to reach them. Returns an array so the card's own filter can
// drop whichever of them this order does not have.
//
// The driver's number is published by the baker's own app because she asked for it to
// be: on a courier order the person at the door is a stranger the customer has to meet,
// and one who cannot find the gate has no other way to be reached. It is turned into a
// `tel:` link only when it contains digits at all — a number that cannot be dialled is
// left as words rather than made into a button that rings nothing, the same rule the
// tracking slot follows.
// The bakery's v199 money block for this card is deliberately NOT used here (28 Sep
// 2026). It works out the items subtotal as the published total less the courier's
// charge — true on the bakery, where a charge is the only thing that can sit between
// the two. This shop also adds a flat nationwide postage onto every posted order, and
// that fee is deliberately never published (see trackingSnapshot in admin/js/supabase.js),
// so the card would subtract nothing and print an "Items total" RM8 too high — a figure
// the customer's own WhatsApp message contradicts. The card therefore keeps the single
// line it has always drawn, "what they ordered — the total", which cannot be wrong
// because it names no subtotal at all. The bakery's readMoney/moneyText/moneyEls are
// removed rather than left unreachable: a helper that would compute a wrong figure is a
// trap for whoever wires it up next.

function tripEls(row) {
  const out = [];
  const phase = String((row && row.courier_phase) || "").trim();
  const word = TRIP_WORDS[phase];
  if (word) out.push(el("p", { class: "track-note track-trip" }, sub(t("tripStatus"), t(word))));

  const name = String((row && row.courier_driver) || "").trim();
  const plate = String((row && row.courier_plate) || "").trim();
  const phone = String((row && row.courier_phone) || "").trim();
  if (name || plate) {
    const who = name && plate ? `${name} · ${plate}` : (name || plate);
    out.push(el("p", { class: "track-note track-driver" },
      sub(t(name ? "driverLine" : "vehicleLine"), who)));
  }
  const dial = phone.replace(/[^\d+]/g, "");
  if (dial) {
    out.push(el("p", { class: "track-note" },
      el("a", { href: `tel:${dial}` }, t("callDriver"))));
  }
  // Who is carrying it, when this is a PARCEL rather than a booked trip (v226). The
  // backoffice publishes the carrier's name in the same column a trip publishes its
  // own name into; a parcel has no driver, so the line is drawn only when nothing
  // about a driver has come through at all — which leaves every existing courier-trip
  // card byte-identical, and a trip that has told us nothing yet still draws nothing.
  const carrier = String((row && row.courier_name) || "").trim();
  if (carrier && !name && !plate && !dial) {
    out.push(el("p", { class: "track-note track-carrier" }, sub(t("carrierLine"), carrier)));
  }
  return out;
}

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
    // The courier's charge, named above the total — so the figure the customer owes
    // explains itself instead of looking wrong. Absent when the charge was yours to
    // bear, or there was none. Never the flat postage: that fee is yours, and the
    // total below already includes it without naming it.
    //
    // A COD charge is named the same way but said to be collected at the door, and it
    // is deliberately NOT inside the total below: the courier is about to ask for it,
    // and a total that included it too would read as being charged twice (19 Sep 2026).
    row.courier_fee
      ? el("p", { class: "track-note track-fee" }, sub(
          t(row.courier_cod ? "courierCod" : "courierCharge"),
          `RM${Number(row.courier_fee).toFixed(2)}`))
      // The delivery cost is not settled yet — the shop quotes each posted order by
      // courier and this one has no charge on it. Said in words, because the total
      // below is the items alone and would otherwise read as the whole of what they
      // owe. It goes away by itself the moment a charge is recorded on the order,
      // when the line above takes over (28 Sep 2026).
      : row.postage_quoted
        ? el("p", { class: "track-note track-fee" }, t("postageQuoted"))
        : null,
    // The promo code they used, named under the charge and above the total — the same
    // line their WhatsApp message carries, so a total that has already come down by the
    // discount explains itself instead of looking wrong (v272). BOTH the code and the
    // amount are published on the order, so this line is drawn from the order's own
    // figures and never worked out here — a code she has since deleted still names
    // itself on the order it was actually used on. Absent on every order with no code.
    row.promo_rm > 0 && row.promo_code
      ? el("p", { class: "track-note track-promo" }, sub(
          t("promoLine"), row.promo_code,
          `RM${Number(row.promo_rm).toFixed(2)}`))
      : null,
    el("p", {}, `${row.items} — ${row.total}`),
  ]);
  const kids = [
    codeLine,
    journey,
    details,
    // The delivery's own progress and the person bringing it (v190), directly under
    // the details and above the tracking slot: a customer who has just read what they
    // ordered and what it cost is next asking when it comes and who is at the door.
    // Empty for every order with no courier trip on it, so nothing changes shape on
    // an order that posted itself.
    ...tripEls(row),
    // What the baker put in the tracking slot, when the order was posted. It is ONE
    // slot and it holds one of TWO kinds of thing, and they must not be worded the
    // same (v189): a number she typed is something the customer reads out to a
    // courier, and a link a booked trip handed back is a page they open. A link
    // rendered as plain text is a dead end on a phone — it cannot be tapped, and a
    // customer staring at a URL has nothing to do with it.
    //
    // The check is written out here rather than imported, because this page imports
    // nothing from the backoffice's own modules; the same rule lives in
    // admin/js/courier_job.js's isLink, which is what the shipped WhatsApp message
    // reads, so the card and the message word a link identically.
    row.tracking_no ? trackingEl(row.tracking_no) : null,
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
    //
    // PostgREST returns ONLY the columns named in `select`, and paintTrack draws
    // the courier's number, the courier's charge and whether that charge is COD —
    // so tracking_no, customer, courier_fee and courier_cod all have to be asked for
    // here or the customer's half of v97/v98 and of the courier charge is dead: the
    // row carries the column, the card just never receives it (19 Sep 2026).
    //
    // The five courier_* trip columns are on the same footing (v190): a column the
    // backoffice publishes and this list does not name is a line the customer's card
    // can never draw, and it fails silently — the row would arrive complete and the
    // card would simply be missing a section, with nothing anywhere saying why.
    //
    // postage_quoted follows the same rule (28 Sep 2026): without it in this list the
    // card cannot tell an order whose delivery cost is still to be quoted from one
    // with nothing left to pay, and would quietly say neither.
    const res = await fetch(
      `${base}/rest/v1/order_tracking?select=status,confirmed_sent,paid_received,delivery,items,total,tracking_no,courier_fee,courier_cod,postage_quoted,promo_code,promo_rm,customer,updated_at,courier_name,courier_phase,courier_driver,courier_plate,courier_phone&code=eq.${clean}&limit=1`,
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

// ── The customer's own door pin (v197) ─────────────────────────────────────
// A SUGGESTION the customer can hand over, and nothing more: it rides on the order
// so the baker can accept it with one press in her own app. Nothing here prices a
// trip or books a driver — a trip is only ever quoted or booked from a door she has
// accepted (her condition, in her words: "as security, app side will reconfirm").
//
// Three ways to say where the door is, because the customers are different people.
// One is standing at the door they want the bread delivered to and can just say so;
// the second is at work ordering for home, and for them the pin is the thing they
// already know how to drag from a ride-hailing app; the third — added at v202 because
// her own words asked for it — types the address and lets the map come to it, "just
// like Grab app". The third does not replace either of the other two: it opens the
// same map on the address it found, and the customer still finishes by hand.
let doorPin = null;   // { lat, lng[, label] } — the customer's own pin, or null for none
let pinWasAt = null;  // what it was when the map opened, so Cancel can put it back
// WHERE THE PIN CAME FROM, when it came from the list rather than from the customer.
// A row in that list is an answer to the words already in the box, so a pin taken from
// one belongs to that wording and to no other. Hold the wording here and the moment the
// customer types a different address the pin is no longer an answer to what they are
// saying — see dropListPin, and the order-time consequence it exists to prevent. Null
// means the customer put the pin there themselves (a drag on the map, or Use my
// location), which is their own mark about a door they were standing at and is NOT tied
// to the words in the box.
let pinOrigin = null; // { q } — the wording this pin answers, or null
let pinWasOrigin = null; // the same, for the pin Cancel puts back
let pinMap = null;    // the live map while its box is open, or null
let pinNote = null;   // { key, m } — the last thing the status line said, kept so a
                      // language switch can say it again in the language just chosen
let lookup = null;    // the typed-address lookup (store/lookup.js), built once by
                      // wireLookup()
let hitNote = null;   // { key, hits } — what the address list is saying at this
                      // moment, kept for the same reason pinNote is
let hitTaken = false; // the customer has already chosen a door from the list. The
                      // instruction above the rows is then about something they have
                      // done, and it is retired while the rows stay, so a second tap
                      // can still change their mind without retyping the address.

// The status line, and the one button whose meaning depends on it. `key` names a
// dictionary entry for something that needs saying (a vague fix, a refusal); with
// no key, the line reports the pin itself, or goes quiet when there is none — which
// is where a first-time visitor starts, and where the address box stands alone.
function paintPin(key = null, m = null) {
  pinNote = key ? { key, m } : null;
  const status = document.getElementById("pin-status");
  if (status) {
    const say = key ? (m == null ? t(key) : sub(t(key), m)) : (doorPin ? t("pinSet") : "");
    status.textContent = say;
    status.hidden = !say;
  }
  const keep = document.getElementById("pin-keep");
  if (keep) keep.disabled = !doorPin;
}

// Whether two points are the same spot, by their numbers. The map hands back full float
// precision and the pin has been tidied to six decimals (store/geo.js, validPin), so
// this compares the numbers rather than trusting the two to be the same object — the
// question being asked is "did the customer move it", not "is this the same box".
function sameSpot(a, b) {
  return !!a && !!b && a.lat === b.lat && a.lng === b.lng;
}

// Close the map box. `keep` is the customer's answer to the two buttons: Keep this
// spot leaves the pin where they put it, Cancel (and a map that could not be drawn)
// puts back whatever there was before the box opened.
function closePinBox(keep) {
  if (pinMap) { pinMap.stop(); pinMap = null; }
  const box = document.getElementById("pin-box");
  if (box) box.hidden = true;
  if (!keep) { doorPin = pinWasAt; pinOrigin = pinWasOrigin; }
  const note = pinNote;
  paintPin(note && note.key, note && note.m);
}

function openPinBox() {
  const box = document.getElementById("pin-box");
  const hold = document.getElementById("pin-hold");
  if (!box || !hold) return;
  pinWasAt = doorPin;
  pinWasOrigin = pinOrigin;
  box.hidden = false;
  const loadingNote = document.getElementById("pin-loading");
  const tapNote = document.getElementById("pin-tap");
  if (loadingNote) loadingNote.hidden = false;
  if (tapNote) tapNote.hidden = true;
  if (pinMap) { pinMap.stop(); pinMap = null; }
  pinMap = showPinMap(hold, {
    start: doorPin,
    onMove: (spot) => {
      if (!pinMap) return; // the box has been closed since this was wired
      if (loadingNote) loadingNote.hidden = true;
      if (tapNote) tapNote.hidden = false;
      if (!spot) {
        // The map could not be shown at all. Say so plainly and point at the typed
        // address directly above, which is filled in already and works regardless.
        closePinBox(false);
        paintPin("pinMapFailed");
        return;
      }
      // The map is handed the pin as its start and calls back with that very point
      // while it draws, so a callback that has not MOVED is the map agreeing with the
      // customer rather than the customer placing anything. It is not a new pin, and the
      // pin is left EXACTLY as it was — the same object, and still the same claim. Fall
      // through here and the line below would drop `pinOrigin`, quietly turning a pin
      // taken from a suggestion row into one the customer placed by hand the instant its
      // own map opened — which would then survive the very address edit that row's pin
      // is supposed to go with (dropListPin below). Anything else is their own hand, a
      // drag or a tap, and from that moment the pin is a place they chose themselves: no
      // origin.
      if (sameSpot(spot, doorPin)) { paintPin(); return; }
      pinOrigin = null;
      doorPin = { lat: spot.lat, lng: spot.lng };
      paintPin();
    },
  });
}

// "Use my location" — the customer standing at their own door. Every way this can
// end has its own sentence, because "nothing happened" is the one answer a customer
// cannot act on. The vague-fix case is NOT a refusal: it keeps the pin (she confirms
// every pin anyway) and says how far off it might be, so the customer can fix it.
async function useMyLocation() {
  const btn = document.getElementById("pin-here");
  if (btn) btn.disabled = true;
  paintPin("pinLocating");
  const geo = (typeof navigator !== "undefined" && navigator.geolocation) || null;
  const out = await askGeo(geo);
  if (btn) btn.disabled = false;
  if (!out.ok) {
    paintPin(out.why === "denied" ? "pinDenied"
      : out.why === "timeout" ? "pinTimeout"
        : out.why === "unsupported" ? "pinNoGeo"
          : "pinUnavailable");
    return;
  }
  doorPin = { lat: out.lat, lng: out.lng };
  // A fix from the phone is a door the customer is standing at, not an answer to
  // anything typed, so it is theirs and no edit to the address box can call it into
  // question (dropListPin only ever acts on a pin a suggestion row put there).
  pinOrigin = null;
  const vague = fixVerdict(out.accuracyM);
  paintPin(vague ? "pinVague" : null, vague ? vague.accuracyM : null);
  if (pinMap) pinMap.goTo(doorPin); // the map is open — bring it to where they are
}

function wirePin() {
  const here = document.getElementById("pin-here");
  const mapBtn = document.getElementById("pin-map");
  const keep = document.getElementById("pin-keep");
  const cancel = document.getElementById("pin-cancel");
  if (here) here.addEventListener("click", useMyLocation);
  if (mapBtn) mapBtn.addEventListener("click", openPinBox);
  if (keep) keep.addEventListener("click", () => closePinBox(true));
  if (cancel) cancel.addEventListener("click", () => closePinBox(false));
  paintPin();
}

// ── The typed address (v202) ───────────────────────────────────────────────
//
// The list of doors the lookup found, under the address box. store/lookup.js owns the
// asking and the waiting; this owns only what the customer sees, and it is deliberately
// the whole of what they see — one box that is either hidden or holds one line of
// explanation, and a row per door.
//
// `key` is a dictionary key or null for "say nothing". It is stored before the paint so
// a language switch can say the same thing again in the language just chosen, exactly
// as pinNote does for the status line above it.
//
// THE INSTRUCTION IS DRAWN ONLY WHILE NOTHING HAS BEEN CHOSEN. "Tap the one that matches
// your address" is something to do; the moment a door has been taken the line below the
// map confirms the pin is set, and the two sentences next to each other contradict — an
// instruction that outlives its own action, which is the dead-control family this shop
// has a standing rule against. The ROWS stay, so changing your mind is a second tap
// rather than retyping the street. `hitTaken` is the whole of that state, and it is
// cleared on every fresh answer below, because a new answer is a new question.
function paintHits(state) {
  hitNote = state && state.key
    ? { key: state.key, hits: state.hits || [], q: state.q || null }
    : null;
  const box = document.getElementById("addr-list");
  if (!box) return;
  box.replaceChildren();
  if (!hitNote) { box.hidden = true; return; }

  if (!hitTaken) {
    const note = document.createElement("p");
    note.className = "card-sub addr-note";
    note.textContent = t(hitNote.key);
    box.append(note);
  }

  for (const hit of hitNote.hits) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "addr-hit";
    // A geocoder that answered with a point and no words still found the door, so the
    // numbers are shown rather than an empty row — the row has to be tappable and has
    // to say something about which door it is.
    row.textContent = hit.label || `${hit.lat}, ${hit.lng}`;
    row.addEventListener("click", () => takeHit(hit));
    box.append(row);
  }
  box.hidden = false;
}

// The customer picked one of the doors. This is the "Grab" moment: the pin goes there
// and the map comes to it.
//
// THE PIN COMES FIRST, THEN THE MAP, and the order matters. If the map is not open,
// opening it is what aims it — showPinMap is handed this point as its start, so it
// opens on the right street at the right zoom rather than on the island. If the map is
// already open, goTo flies it there without rebuilding it, so nothing the customer has
// already looked at is thrown away.
//
// pinWasAt is moved onto the choice as well, which is the one line here that is not
// obvious: Cancel puts the pin back to whatever it was when the map session began, and
// after this the session began at the address they just chose. Without it, picking an
// address and then pressing Cancel would throw the address away and restore the pin
// they had before they started typing — a customer undoing a decision they did not make.
function takeHit(hit) {
  const input = document.getElementById("address-input");
  const now = lookupQuery(input ? input.value : "");
  // A row is an ANSWER to the words that were in the box when it was drawn, and the list
  // is deliberately left up while the customer keeps typing — a list that blinks away on
  // every keystroke is harder to use than one that settles. That leaves a moment, the
  // length of the lookup's own pause, in which a row drawn for the old wording is still
  // on screen. Taking it there would set a pin for an address the customer has already
  // edited away from, which is the disagreement this version exists to remove, so the
  // tap is refused — out loud, because a tap that does nothing is its own fault — and the
  // rows it came from go with it. The lookup is already re-asking; its answer is next.
  if (hitNote && hitNote.q && hitNote.q !== now) {
    hitNote = null;
    paintHits(null);
    paintPin("addrStale");
    return;
  }
  const p = validPin(hit);
  if (!p) return;
  doorPin = p;
  pinWasAt = p;
  // THE BOX IS FILLED IN FROM THE ROW (v214), and this is the one line of the feature. A
  // row that found the house they typed carries a COMPLETE address — Google's own, richer
  // than they bothered to type — so it goes into the box in place of their partial one,
  // which is what she asked for: "it can go into the delivery address instead of customer
  // type full". A row that only reached the road, or the wrong town, or said nothing, is
  // refused by addressFromRow and changes nothing (store/geo.js holds the whole test).
  //
  // Written as a VALUE and never as typing: no `input` event is fired, so the pin cannot
  // be taken away by the very write that put the address there — dropListPin only ever
  // runs from a keystroke.
  //
  // `q` is what the box holds AFTER the write, and it has to be: the pin answers the
  // wording now under it, and a second tap on the same row is judged against that same
  // wording. Claim the old wording here and the row the customer is looking at would be
  // refused as stale one line below the tap that drew it.
  const found = addressFromRow(hit, now);
  const words = lookupQuery(found) ? found : "";
  if (words && input) input.value = words;
  const q = words || now;
  // The wording this pin answers. Nothing the customer does to the map or the address
  // box after this keeps the pin tied to it: a drag on the map drops the claim (above),
  // and an edit to the words drops the pin (dropListPin).
  pinOrigin = { q };
  pinWasOrigin = pinOrigin;
  if (pinMap) pinMap.goTo(p);
  else openPinBox();
  paintPin();
  // The rows are redrawn without the instruction they have just obeyed, and with their own
  // claim on the box corrected to the words the box now holds. Nothing is asked again and
  // the choice is not forgotten — `answered` in store/lookup.js still holds this question,
  // so the list comes straight back if they edit the address.
  hitTaken = true;
  paintHits(hitNote ? { key: hitNote.key, hits: hitNote.hits, q } : null);
}

// The customer's words have changed, so a pin that was an answer to the OLD words has to
// go with them.
//
// WHAT THIS IS FOR, in her own words: "when the pin arrive at backoffice, it did not
// tally". A pin taken from a suggestion row is a point for the address that row was
// found for, and the address on the order is whatever is in the box when they press
// send — two answers to one question, written at two different moments, with nothing
// tying them together. Edit the box from Taman Sri Nibong to Bayan Lepas and, until
// this existed, the order went out carrying Bayan Lepas as the address and a pin five
// kilometres away at Taman Sri Nibong, with the bakery given no way to see it.
//
// ONLY A ROW'S PIN IS AFFECTED. A pin the customer dragged on the map, or took from
// "Use my location", is a door they chose with their own hand and is not an answer to
// the typed words — it survives every edit, which is the whole reason the pin records
// where it came from rather than this being a blanket "clear the pin on every keystroke".
//
// THE ROWS STAY, and that is deliberate rather than unfinished. They are the list the
// customer was reading a moment ago and the lookup is about to replace them anyway;
// taking them out from under the thumb as well would be two corrections for one mistake,
// and a list that blinks away on every keystroke is the flicker store/lookup.js is built
// to avoid. A row tapped while they are out of date is refused AT THE TAP instead
// (takeHit), which is the one moment the row can be judged against the box.
//
// `q` is the wording the box now holds, already put through lookupQuery — so a box that
// has been emptied counts as a change, which is right: a pin for an address that is no
// longer written down is exactly the disagreement being removed. Returns whether it acted.
function dropListPin(q) {
  if (!doorPin || !pinOrigin || pinOrigin.q === q) return false;
  doorPin = null;
  pinOrigin = null;
  pinWasAt = null;
  pinWasOrigin = null;
  // A map left open would be showing a pin that no longer goes with the address
  // directly above it — the very contradiction, on one screen. `true` because the pin
  // is already gone: there is nothing for it to put back.
  if (pinMap) closePinBox(true);
  // Said out loud rather than done behind the customer's back: they had a pin, they
  // edited the address, and it is gone. The sentence points at the two things that put
  // it back, which are the suggestion list above and the map button below.
  paintPin("pinAddrChanged");
  return true;
}

function wireLookup() {
  const input = document.getElementById("address-input");
  if (!input) return;
  // A fresh answer is a fresh question, so the instruction belongs on screen again —
  // including the answer that says nothing was found. Wrapped rather than passed
  // straight in, so `hitTaken` cannot survive a new list.
  lookup = createLookup({ onState: (state) => { hitTaken = false; paintHits(state); } });
  input.addEventListener("input", () => {
    // One keystroke, two consequences: a pin that only answered the words as they were
    // goes, and the new words are put to the lookup. In that order, so the sentence about
    // the pin is on screen before anything the lookup has to say about the address.
    dropListPin(lookupQuery(input.value));
    lookup.typed(input.value);
  });
  paintHits(null);
}

// Forget the pin between customers: a phone can be handed across a counter, and the
// next order must not inherit a stranger's front door. Exported for the same reason
// setLang is (below): the Node suite has to be able to put the page back to the state a
// NEW customer arrives in, and module state otherwise leaks from one test to the next —
// a leak that once let a fault in this very function go unnoticed.
export function resetPin() {
  doorPin = null;
  pinWasAt = null;
  pinOrigin = null;
  pinWasOrigin = null;
  closePinBox(true);
  paintPin();
  // An address the customer typed, and the list it produced, belong to the order that
  // has just been placed. The next customer must not be shown the last one's house,
  // and an answer still in the air must not land on a box that has been emptied.
  if (lookup) lookup.clear();
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

render();
renderReferralBanner();
wireFulfillment();
wirePin();
wireLookup();
wireTrack();

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
