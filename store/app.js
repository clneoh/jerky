// store/app.js — customer order page: pick a date, add items, place an order.
// Orders go straight to the backoffice (Supabase incoming_orders) and fall back
// to a WhatsApp message if that fails. The name, menu and WhatsApp number are
// published by the backoffice (Settings → Storefront) and override the static
// config.js fallback at runtime.
import { CONFIG } from "./config.js";
import { poolCaps, poolGroups, clampPool, groupFor, poolPieces, closedReason, cancelDaysFor, strictestCancelDays, nextOrderable } from "./pool.js";
import { rollingWeeks, weekIndex, windowBounds, WINDOW_WEEKS, occColour, occDays, occStrength, occForDate, occSingleDay } from "./calendar.js";
import { normRules } from "../availability.js";
import { cutoffText } from "../home-facts.js";
import { isThumb, lineNoteOf, LINE_NOTE_MAX } from "../storefront-fields.js";
import { isLang, loadLang, pick, rememberLang, nameFor, descFor, unitFor, policyFor, applyTo } from "../i18n.js";
import { STORE } from "../store-lang.js";
import { addressFromRow, lookupQuery, placeForOrder, validPin } from "./geo.js";
import { showPinMap } from "./pin_map.js";
import { createLookup } from "./lookup.js";
import { sendFeedback, loadDraft, saveDraft } from "./feedback.js";
// The shop shows the same engine number the backoffice shows on More, so the owner can
// read her phone and know which build the shop is running — and the address fed back with
// a customer's words names it too. One number, one file, no second copy to forget.
import { ENGINE_VERSION } from "../admin/js/version.js";
// ★★ the "Good to know" bullets, from her settings when she has written them (v641)
import { factsLines, DEFAULT_FACTS } from "./facts.js";
// ★★ "tell me when this day frees" (v648)
import { waitRow, hasAsked, rememberAsked } from "./waitlist.js";
// ★★ what this phone ordered last time (v638)
import { saveLastBasket, readLastBasket, forgetLastBasket, planReorder } from "./last_order.js";
// ★★ the answer a tapped full day gives (v631_2)
import { fullDayAnswer } from "./full_day.js";

// ★★★ WHICH BUILD THIS FILE IS — A LITERAL, NOT AN IMPORT, AND THAT IS THE WHOLE OF v496.
//
// ⚠️⚠️ HER REPORT: __"now v495, but store at v494, why no update warning at store?"__ ⭐ **And she is
// right, and the reason is that the notice was asking a question it could not be wrong about.**
//
// ⭐ THE OLD DESIGN compared the build this page is against the build the site is serving — and it read
// BOTH from `admin/js/version.js`: this page's number came from importing that file, and the probe
// fetched that same file. ⚠️ **TWO READINGS OF ONE FILE CANNOT DISAGREE ABOUT WHICH BUILD THE CODE IS.**
// ⭐ A browser that revalidates that little file — which it will, it is fetched with `no-store` — hands
// back the SITE's number, so **a shop running month-old `store/app.js` cheerfully reports itself as
// current and says nothing.** ⚠️ The one fault the notice exists to catch was the one it could not see,
// and it could not see it because the number describing the page was being cached apart from the page.
//
// ⭐⭐ SO THE NUMBER IS WRITTEN INTO THIS FILE. If the browser serves an old copy of `store/app.js`, the
// old number comes with it — **the code and its build are one artefact and cannot be separated by any
// cache.** ⚠️ And it must be kept in step with `admin/js/version.js` by hand, which is a second place for
// one fact: ⭐ **that is accepted here ONLY because a test fails the moment they disagree** (see
// `store-build-notice.test.js`), so a forgotten bump is a red suite rather than a shop that lies.
export const SHOP_BUILD = "655";
// "Is this page the newest one?" — the comparison and the probe's address, kept on their own so a
// test can pin them (this file calls `render()` at the top level and cannot be imported at all).
import { BUILD_TRIED_KEY, VERSION_URL, newerBuild } from "./build.js";
// The promo-code engine, shared with the backoffice so a code the shop accepts is
// exactly a code her app recognises. It is a leaf module (imports nothing), which
// is why the shop can take it without pulling the backoffice's storage in.
import { pointMinOrder, pointShortfall } from "../admin/js/points.js";
import { codeNameOk, evaluate, findCode, minimumOf, normCode, normalizeCode, offerOf, shortfallOf, stoppedBy, worthOf } from "../admin/js/promo.js";

// Day/month short names per site language. English is today's authoring default;
// fmtDay and the "Posting days" info card read by the visitor's language so a
// calendar cell or that row shows in 中文/BM too.
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// ★★ THE SAME DAYS, SPELLED OUT — FOR A DATE, NOT FOR A LIST (v434). Her words: __"Your bake day:
// Mon, 12 Oct — change to 'your choosen bake day: Monday. 12 Oct'"__. ⚠️⚠️ **THE TWO ARE NOT THE SAME
// JOB, WHICH IS WHY THERE ARE NOW TWO ARRAYS AND NOT ONE.** `fmtDay` names **one date in a sentence**
// ("Monday, 12 Oct"), where the day is the whole point and 'Mon' reads as a shorthand. `dayName`
// builds **a standing list of the days she bakes** ("Bake days: Mon, Wed, Fri" — the card she picked
// off a sheet the same day), where 'Monday, Wednesday, Friday' is a mouthful on a phone and the
// abbreviation is exactly right. **One array would have silently undone that card.**
// ⚠️ THE OTHER TWO LANGUAGES NEED NOTHING: 周一 and Isnin are already the full forms.
const DAYS_EN_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
// ★★ AND THE STEP CIRCLES, the same seam and for the same reason (v415). `paintSteps` lives inside
// render(), where everything that changes a step funnels — the day tapped, the menu rebuilt, the 30s
// refresh — and **a fulfilment choice is the one thing that changes a step from OUTSIDE it.** The
// picker is wired at module scope, so it cannot reach the function; this is the handle it uses.
let paintStepsForFulfillment = null;
// ★★ AND THE SAME SEAM FOR "SOMEONE IS LOOKING AT THIS PAGE AGAIN" (v497). ⚠️ **A timer in a hidden tab is
// frozen**, so the ordinary case — a customer puts the phone down after ordering and the next one picks it
// up — is the case a timer cannot cover. ⭐ The listeners for that live at the foot of this file, outside
// `render()`, where the order's own clock does not reach; this is the handle they use.
let shopLookedAgain = null;

/* ── Counting a label being opened (v288) ──────────────────────────────────────
   A label's QR — and the link she copies into WhatsApp — land here carrying `?promo=CODE`.
   This records that open, so she can tell "nobody picked the label up" from "forty did and two
   of them bought". Those are different problems and they need different answers: print more
   labels, or change the offer.

   IT COUNTS ONLY A CODE THIS SHOP ALREADY ACCEPTS. That is a PRODUCT rule, not a security
   control: this page ships the public key, so anyone determined can post to the table whatever
   we do here. What it buys is that a typo in a url, a stranger's guess and a crawler inventing
   addresses never reach her numbers.

   AND IT NEVER TOUCHES THE SHOP. Fire and forget, ten seconds at the most, every failure
   swallowed — a visit that cannot be recorded must not slow a customer down or change a single
   word on the page.                                                                     */

// Whether this page load should count an open, as a pure answer: the code to count, or "" for
// no. Exported because it is the whole of the judgement and worth holding to without booting
// the shop — an absent ?promo=, an unknown code and a missing config all have to answer "".
export function labelOpenToCount(search, codes, cfg) {
  const url = String((cfg && cfg.url) || "").trim();
  const key = String((cfg && cfg.anonKey) || "").trim();
  if (!url || !key) return "";
  const code = parsePromo(search);
  if (!code) return "";
  return (codes || []).some((x) => normCode(x && x.code) === code) ? code : "";
}

// ONE LATCH PER PAGE LOAD, and the latch is the whole point. `refresh()` runs again every 30
// seconds while the shop is open, so without it a single customer leaving the tab open would
// mint a visit every half minute and a label that sold nothing would read as a triumph. A
// RELOAD is a new page load and counts again — that is her choice, and exactly why the number
// is a pulse for alive-versus-cold rather than a headcount.
//
// A factory rather than a module-level boolean so the rule can be held to in a test.
export function labelOpenCounter(doPost) {
  let counted = false;
  return (search, codes, cfg) => {
    if (counted) return "";
    const code = labelOpenToCount(search, codes, cfg);
    if (!code) return "";
    // Latched only HERE, past every guard: the codes arrive asynchronously, so a refresh that
    // runs before them must be free to count on the one that does have them.
    counted = true;
    doPost(code, cfg);
    return code;
  };
}

// The POST itself. Exported so its url, its headers and its payload can be read in a test.
export function postLabelOpen(code, cfg) {
  const base = String(cfg.url).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  return fetch(`${base}/rest/v1/promo_visits`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json",
      // INSERT-only RLS: asking for the row back would be a read, and reading is not granted.
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{ code }]),
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}

// Module scope, NOT inside render(): render() can run more than once, and a latch that reset
// with it would count the same open twice. Nothing about the customer is kept — one boolean
// for the life of the tab.
const countLabelOpen = labelOpenCounter(postLabelOpen);

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

// ★★★ A NUMBER NOBODY CAN ANSWER IS NOT A NUMBER (v565).
//
// ⚠️⚠️ THE FAULT: the box accepted ANY digit string, so a customer could order with **"1"** as their
// WhatsApp number. ⭐ The order then goes out with a number the bakery cannot confirm on, the payment QR
// never reaches them, **and the tracking card — which since v558 needs the phone it was ordered with —
// can never be opened by the customer at all.** ⚠️ One digit is not an opinion about how to spell a
// number; it is a typo, and the shop should say so at the box rather than take the order.
//
// ⭐ The bounds are E.164's own: at least 9 digits (a Malaysian mobile normalises to 11) and at most 15.
// ⚠️ This is the same KIND of check the name and the delivery address already get — it answers at the
// box, in the customer's language, and the Place order button is never disabled.
export function waPlausible(n) {
  const digits = waNumber(n);
  return digits.length >= 9 && digits.length <= 15;
}

// The same number, written the way a person reads it: +60 16-960 1268 (v348).
// Used by the shop's privacy notice, which has to print contact details rather
// than only build a link. The Malaysian mobile grouping — country code, then the
// two-digit prefix, then the subscriber number in two groups — which is how the
// homepage writes it too. Anything that is not an 11-digit Malaysian number is
// shown as a plain +digits rather than grouped wrongly.
export function phoneText(n) {
  // Normalised through waNumber first, so a number typed with a local leading 0
  // is read the same way the link would build it.
  const d = waNumber(n);
  if (!d) return "";
  if (d.length === 11 && d.startsWith("60")) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)}-${d.slice(4, 7)} ${d.slice(7)}`;
  }
  return `+${d}`;
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
  const n = waNumber(new URLSearchParams(String(search || "")).get("via"));
  // ★★★ A TRUNCATED LINK IS NOT A REFERRAL (v565). ⚠️ `/store/?via=123` used to show **"You were
  // referred — you have a welcome discount on your first order"** and stamp `referredBy: "123"` on the
  // order. ⭐ A promise of a discount the customer was never given is the one thing the shop must not
  // say by accident, so an implausible number is treated as no referral at all.
  return waPlausible(n) ? n : "";
}

// ★★ THE FRIEND'S NUMBER COMES OFF THE ADDRESS ONCE THE ORDER IS PLACED (v325).
//
// Her question: __"for new customer clicking link from his friend, after he place an order have
// you remove his page linking his friend phone number?"__ **No — and it should.** The link is
// `/store/?via=60123456789`: the FRIEND'S OWN NUMBER, sitting in the new customer's address bar,
// their history, and anything they copy out of the address to send on. The stamp has done its work
// the moment the order carries it onto the order record, so from then on it is only a phone number
// being carried around.
//
// ⚠️⚠️ **IT IS REMOVED WHEN THE ORDER IS PLACED, NOT WHEN THE PAGE OPENS, AND THE DIFFERENCE
// MATTERS.** A customer may arrive by the link and browse for ten minutes before ordering — and
// taking the stamp off on arrival would lose the referral entirely. The one safe moment is the one
// `placeOrder` already marks: **the path where the order really landed.** An order that fell back
// to WhatsApp reached no record at all, so the stamp is LEFT ALONE there — they may try again, and
// the message they send carries it.
//
// ⚠️ **ONLY `via` IS REMOVED.** `track` may be in the address at the same time (a customer who
// arrived by a link and is also looking at an old order), and each key removes only itself.
export function forgetVia(hist = (typeof history !== "undefined" ? history : null)) {
  if (!hist || typeof hist.replaceState !== "function") return false;
  if (typeof location === "undefined" || !location.search) return false;
  const rest = new URLSearchParams(location.search);
  if (!rest.get("via")) return false;
  rest.delete("via");
  const q = rest.toString();
  try {
    hist.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + (location.hash || ""));
  } catch { return false; }
  return true;
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

// ── The standing offers, and how they turn (v292) ───────────────────────────
//
// EVERY code the shop is willing to advertise today — public, switched on,
// inside its dates, and not already given away — in the order she published
// them. Asked through the engine's own `stoppedBy`, so the standing line and the
// code box can never disagree about what "still running" means.
//
// This was a `.find()` until v292: the FIRST live public code was shown and every
// other one was dropped without a word. A bakery advertising three offers was
// advertising one.
export function standingToday(codes, today) {
  const list = Array.isArray(codes) ? codes : [];
  return list.filter((c) => c && c.vis === "public" && !stoppedBy(c, today));
}

// Which code the turn shows next. The only rule is the clamp: a position that is
// no longer in the list — because she paused a code while the page was open —
// starts again from the first rather than wrapping into a hole and drawing
// nothing. One offer needs no special case: `(0 + 1) % 1` is 0 on its own.
export function standingNext(total, at) {
  const n = Number(total) || 0;
  const i = Number(at) || 0;
  if (i < 0 || i >= n) return 0;
  return (i + 1) % n;
}

// Whether the strip turns AT ALL. One offer is not a carousel with one slide, it
// is a statement — so no timer is armed for it, where the homepage's own carousel
// arms one and ticks every six seconds to no effect. Zero offers is not a strip.
export function turnsAtAll(count) {
  return Number(count) > 1;
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

export function upcomingDates(cfg, now = new Date()) {
  const out = [];
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

// ★★★ IS TODAY'S BAKE STILL CATCHABLE? (v549)
//
// ⚠️⚠️ THE FAULT: the heading asked `isOpen(cfg, today)` — "is it still before the deadline for a bake
// TODAY?" — and that deadline is **yesterday at 18:00**, so the answer was false on every day of the year.
// ⭐ The page said **"Today's bake has closed"** on a Sunday the bakery never bakes, and **"You're in
// time" could never appear at all.**
// ⭐ Two truths, and the heading follows them:
//   • a day she does not bake has no bake to have closed → he is in time for the next one;
//   • a day she does bake is open only until its own cut-off (the day before).
export function todayStillOpen(cfg, now = new Date(), bakesTodayOverride) {
  // ⚠️⚠️ HER REAL DATES OUTRANK THE WEEKDAY PATTERN HERE TOO (v596). ⚠️ An extra Thursday she added had the
  // calendar offering it while this said "today's bake has closed" — and removing a date said it on a day she
  // was not baking. ⭐ The caller that knows the published rows passes the answer in.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekdayBakes = Array.isArray(cfg && cfg.deliveryDays) && cfg.deliveryDays.includes(start.getDay());
  const bakesToday = bakesTodayOverride !== undefined
    // ⚠️⚠️ WHEN SHE HAS PUBLISHED DAYS, THOSE ARE THE ANSWER (v599). ⚠️ v598 OR-ed the weekday pattern in,
    // so a date she had DELETED still read "You're in time" because it was a Wednesday — ⚠️ **the page
    // offered a bake she had taken off.** ⭐ The pattern is the fallback only when there are no rows at all
    // (the caller passes `undefined` then), which is the case the fallback is for.
    ? !!bakesTodayOverride
    : weekdayBakes;
  return !bakesToday || isOpen(cfg, start, now);
}

// ⭐ THE CLOCK FORMATTER MOVED TO `home-facts.js` (v581) and is re-exported here, so the homepage and the
// shop read ONE copy. ⚠️ Two copies would have been two ways to say one time — the fault this screen has
// already been taught twice.
export { cutoffText };

// ★★ THE NEXT DAY SHE CAN ACTUALLY HAVE BREAD (v405). ⚠️ `upcomingDates` already starts at TOMORROW and
// lists only delivery days, and `isOpen` already knows the cut-off — so this is the two of them, in
// order, and nothing new is decided here. ⭐ It is the ANSWER to the question the page used to leave the
// customer to work out for himself.
export function nextOpenDay(cfg, now = new Date()) {
  // ⚠️⚠️ `now` GOES IN HERE TOO. `upcomingDates` built its own list from the REAL today, so this function
  // took a time, **used it for the cut-off and ignored it for the days** — and a caller that passed a
  // different time got an answer made of two different moments. In the app the two agree (both are now),
  // which is why nothing showed; a test that passes a fixed day is the case that exposes it, and one did.
  return upcomingDates(cfg, now).find((d) => isOpen(cfg, d, now)) || null;
}

// The day before `d`, which is the day the order has to be in by.
function dayBefore(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
}

// ★★ THE TWO SENTENCES THE PAGE NEVER SAID (v405). ⚠️⚠️ THIS IS THE WHOLE FIX. A customer wanted bread
// TODAY, the page let him pick a day that looked fine, and nothing anywhere told him today was
// impossible — he found out when the baker checked with him.
//
// ⚠️ TWO STATES, THE SAME WORDS, ONE DIFFERENT FIRST LINE. A customer must never have to work out which
// one he is looking at; the heading tells him, and the green edge says it before he reads.
//   • nothing open for today  → "Today's bake has closed" / the next day he can have it / the deadline
//   • still time to order     → "You're in time"        / the same two lines
function paintDayAnswer(cfg, cutoffSay, nextDay, todayBakes) {
  const box = document.getElementById("day-answer");
  if (!box) return;

  // ⚠️⚠️ THE BOX FOLLOWS HER REAL DAYS, NOT THE WEEKDAY PATTERN (v590). ⚠️ It was drawn once, from
  // `nextOpenDay` (the weekday rule), and never repainted — ⚠️ **so a day that had closed, sold out or been
  // removed stayed named, with a deadline already in the past.** ⭐ `rerender` passes the same real list the
  // calendar is drawn from; `undefined` keeps the older behaviour for the first static paint.
  const next = nextDay !== undefined ? nextDay : nextOpenDay(cfg);
  const lede = document.getElementById("steps-lede");
  if (lede) {
    lede.hidden = false;
    lede.textContent = t("stepsLede");
  }
  if (!next) { box.hidden = true; return; } // no day open at all — say nothing rather than guess

  const by = dayBefore(next);
  // ⚠️ "TODAY'S BAKE HAS CLOSED" IS ONLY TRUE WHEN TODAY IS NOT ONE OF HER DAYS, and it is the case he
  // hit — but a page that says it on a Tuesday when the bakery bakes Tuesday would be wrong. So the
  // heading follows the fact, not the clock.
  // ⚠️⚠️ AND "TODAY'S BAKE" ONLY EXISTS ON A DAY SHE BAKES (v549). ⭐ `isOpen(cfg, today)` asks "is it
  // still before the deadline for a bake TODAY?" — and that deadline is **yesterday at 18:00**, so it was
  // false on every day of the year: the heading read "Today's bake has closed" on a Sunday the bakery
  // never bakes, and **"You're in time" could never appear at all.** ⭐ A day she does not bake has no
  // bake to have closed; and a day she does bake is open until its own cut-off.
  const todayOpen = todayStillOpen(cfg, new Date(), todayBakes);
  box.hidden = false;
  box.classList.toggle("ok", todayOpen);
  document.getElementById("answer-kicker").textContent = t(todayOpen ? "ansInTime" : "ansClosed");
  document.getElementById("answer-big").textContent = sub(t("ansNext"), fmtDay(next));
  document.getElementById("answer-sub").textContent = sub(t("ansBy"), fmtDay(by), cutoffSay);
}

export function fmtDay(d) {
  const lang = loadLang();
  if (lang === "zh") return `${MONTHS_ZH[d.getMonth()]}${d.getDate()}日 ${DAYS_ZH[d.getDay()]}`;
  if (lang === "ms") return `${DAYS_MS[d.getDay()]}, ${d.getDate()} ${MONTHS_MS[d.getMonth()]}`;
  // ⚠️ THE FULL DAY NAME (v434) — this names ONE DATE in a sentence, which is a different job from
  // the short list of days she bakes. See DAYS_EN_FULL for why the two are kept apart.
  return `${DAYS_EN_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
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
  // ⚠️ NO DATE ROWS IS NOT "NO BAKE DAYS" (v581). ⚠️ This table is written by a PUBLISH, and a publish
  // that failed (or has not run since the phone changed) leaves it empty while her bake days are still
  // hers — ⭐ **emptying the calendar on that would be a rule that blocks a sale.** ⭐ Deleting her bake
  // days is said in the SETTINGS list instead (`deliveryDays: []`), and `mergeStorefront` now adopts that
  // empty list, so `generated` is already empty in exactly the case that matters.
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

// ⭐ The first day a customer can actually have bread on, from the REAL list the calendar draws
// (v590). `dates` has already been through the cut-off (`isOpen`); this only drops a day the live
// availability says is full. ⚠️ The answer box used to ask the weekday RULE instead and never asked again.
export function firstOpenSpec(dates, availMap = {}) {
  return (dates || []).find((d) => {
    const left = availMap && availMap[dateKey(d)];
    return !(left != null && left <= 0);
  }) || null;
}

export function buildMessage(cfg, order) {
  // ⚠️⚠️ AN ITEM'S OWN NOTE GOES WITH THE ITEM (v592). ⚠️ The offline fallback dropped it: a customer who
  // wrote "no nuts" on a line sent a message with no such words, while the cloud order kept them.
  const lines = order.lines
    .map((l) => {
      const base = `• ${l.name} ×${l.qty} — RM${(l.qty * l.price).toFixed(2)}`;
      const note = String(l.note || "").trim();
      return note ? `${base}\n   📝 ${note}` : base;
    })
    .join("\n");
  let msg = `New order · ${cfg.name} 🐾\n`;
  msg += `📅 ${order.date}\n`;
  msg += `${lines}\n`;
  msg += `💰 Total: RM${order.total.toFixed(2)}`;
  if (order.fulfillment) {
    const method = order.fulfillment === "courier" ? "Post (nationwide)" : "Collect (local)";
    msg += `\n📦 ${method}`;
    if (order.fulfillment === "courier" && order.address) msg += `\n📍 ${order.address}`;
    // ⚠️⚠️ A COLLECTION ORDER THAT NAMES NO POINT IS AMBIGUOUS (v581). ⚠️ The order has carried
    // `pointName` since the Points shipped, ⭐ but the message did not print it — ⚠️ **so a customer collect
    // from a shop other than the kitchen produced "Self collect" and nothing to say WHICH place**, and the
    // offline fallback (the path that sends this same message when the cloud cannot be read) lost it too.
    if (order.fulfillment !== "courier" && String(order.pointName || "").trim()) {
      msg += `\n📍 ${String(order.pointName).trim()}`;
    }
    // ⚠️⚠️ AND THE DOOR PIN THE CUSTOMER DROPPED (v592). ⚠️ A courier order pinned to a condo door sent a
    // message with NO destination at all when the shop could not reach the cloud — the one path that must
    // carry the whole order. ⭐ The point and a link to it, on its own line.
    const lat = Number(order.place && order.place.lat);
    const lng = Number(order.place && order.place.lng);
    if (order.fulfillment === "courier" && Number.isFinite(lat) && Number.isFinite(lng)) {
      msg += `\n📌 ${lat.toFixed(6)}, ${lng.toFixed(6)} — https://maps.google.com/?q=${lat},${lng}`;
    }
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
  for (const key of ["whatsapp", "name", "tagline", "instagram", "facebook", "cutoff", "policy", "policyZh", "policyMs",
    "facts", "factsZh", "factsMs"]) {
    if (typeof remote[key] === "string" && remote[key].trim()) out[key] = remote[key].trim();
  }
  for (const key of ["capacity", "upcomingCount"]) {
    const n = Number(remote[key]);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  if (Array.isArray(remote.deliveryDays)) {
    const days = remote.deliveryDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    // ⚠️⚠️ AN EMPTY LIST IS AN ANSWER (v581). ⚠️ She publishes this list EVERY time, so "no bake days" reaches
    // the shop as `[]` — ⚠️ **and it used to be ignored, so deleting her last bake day left the local
    // fallback (Mon/Wed/Fri) on sale.** ⭐ Adopted when it is genuinely empty, or when anything survived the
    // check above — ⚠️ a list of rubbish is not an instruction, and still falls back as it always did.
    if (days.length || remote.deliveryDays.length === 0) out.deliveryDays = days;
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
  // The Self collection Points she has open (v299). Replaced WHOLESALE, like the occasions and
  // the promo codes: the app publishes a complete snapshot, so an empty list is a real
  // instruction — "she has no Points open" — and has to take a Point off a page that is already
  // showing it.
  //
  // ⚠️ THE ID, THE NAME AND THE SMALLEST BASKET arrive, and nothing else. The receiver, their
  // phone, the fee and the address never leave her app — the shop is public, and the message
  // that tells a customer where to go is built from HER copy. So the shop validates what it gets
  // down to exactly these fields, which is also what makes a malformed row unable to reach the
  // page.
  //
  // The smallest basket is the opposite of private (v306): it is what the customer has to know
  // BEFORE choosing, and without it this page could only take an order the Point does not want.
  // A missing or unreadable `min` is 0 — NO minimum — because a rule the shop invented would
  // refuse an order nobody asked it to refuse.
  if (Array.isArray(remote.points)) {
    out.points = remote.points
      .filter((p) => p && typeof p === "object"
        && String(p.id || "").trim() && String(p.name || "").trim())
      .map((p) => {
        const min = Number(p.minOrderRM);
        const row = { id: String(p.id).trim(), name: String(p.name).trim(),
          minOrderRM: Number.isFinite(min) && min > 0 ? min : 0 };
        // ★★ IS THIS THE BAKERY'S OWN KITCHEN? (v407). ⚠️⚠️ WITHOUT THIS LINE THE FLAG DIES HERE,
        // one step after `publishPoints` sends it — the shop would go on inventing its own
        // "Our kitchen" row and a customer would see her kitchen twice, which is the whole fault
        // this pair of edits repairs. **A field a sender publishes and a receiver does not keep is
        // a field that was never sent**, and this list is rebuilt from a whitelist, so every new
        // key needs naming in BOTH places.
        // ⚠️ WRITTEN ONLY WHEN TRUE, the house's "absent means nothing" spelling (see the referral
        // stamp and the promo code above): an ordinary Point's payload stays byte-for-byte what it
        // has always been, and `p.isKitchen === true` reads an absent key as "not the kitchen" —
        // which is exactly right, and is also what an older published payload means.
        if (p.isKitchen === true) row.isKitchen = true;
        // ★★ AND THE ADDRESS, BUT ONLY WHEN SHE SWITCHED IT ON (v410). ⚠️⚠️ THE FIRST TIME A STREET
        // ADDRESS HAS EVER BEEN PUBLISHED FROM THIS APP, so the guard is written the same way
        // `isKitchen` is: **only when it is really there**, so a Point she has not ticked publishes
        // byte-for-byte what it published yesterday and the switch alone cannot change a page.
        // ⚠️ A non-string, or whitespace, is NO address rather than a broken one.
        if (p.showAddress === true) {
          const street = String(p.address == null ? "" : p.address).trim().slice(0, 200);
          if (street) row.address = street;
        }
        // ★★ AND HER OWN WORDS ABOUT THE PLACE (v412). ⚠️ It is public by its own nature — that is
        // what it is for — so there is no switch beside it, unlike the address. ⚠️ **AND IT IS
        // WRITTEN ONLY WHEN THERE IS ONE**, the same spelling as the two above: a Point she has not
        // written a description for publishes byte-for-byte what it published yesterday.
        const words = String(p.description == null ? "" : p.description).trim().slice(0, 120);
        if (words) row.description = words;
        // ★★ AND THE DAYS THIS PLACE IS SERVED (v419). ⚠️⚠️ WITHOUT THIS THE DAYS DIE HERE, one step
        // after `publishPoints` sends them: **a field a sender publishes and a receiver does not keep
        // is a field that was never sent**, and this list is rebuilt from a whitelist, so every new
        // key needs naming in BOTH places.
        // ⚠️ RE-VALIDATED ON THE SHOP'S OWN TERMS, not trusted: a weekday is a whole number 0–6 and
        // nothing else, deduped and sorted, so a hand-edited or half-synced payload cannot make this
        // page say a day that does not exist. ⚠️ AND ONLY A REAL RESTRICTION IS KEPT — an empty list,
        // or all seven days, publishes byte-for-byte the row it published yesterday.
        if (Array.isArray(p.days)) {
          const days = [];
          for (const raw of p.days) {
            // ⚠️⚠️ `null`, `undefined` AND `""` ARE NOT ZERO, and this test comes BEFORE `Number()`
            // for that reason — `Number(null)` is 0, so a hole in a half-synced array would become
            // **SUNDAY**: a promise to a customer about a day she never chose. The same trap
            // `normalizeDays` documents on the admin side, and it was in BOTH copies.
            if (raw === null || raw === undefined || raw === "") continue;
            const n = Number(raw);
            if (Number.isInteger(n) && n >= 0 && n <= 6 && !days.includes(n)) days.push(n);
          }
          days.sort((a, b) => a - b);
          if (days.length && days.length < 7) row.days = days;
        }
        return row;
      });
  }
  // The AREAS those Points are grouped under (v410), read exactly like the product categories
  // above: replaced wholesale, re-validated on the shop's own terms, and shaped so the page can
  // draw a heading without knowing anything about her tree.
  //
  // ⚠️ IDS, NOT NAMES. The page marks which Points sit under a heading by id, so a Point renamed
  // after it was filed cannot go missing from its own heading. (The product categories publish the
  // other way round — names — only because that page keys everything else by name; a Point already
  // has an id on the wire, so the id is the honest thing to use.)
  if (Array.isArray(remote.pointAreas)) {
    out.pointAreas = remote.pointAreas
      .filter((a) => a && typeof a === "object" && String(a.name || "").trim())
      .slice(0, 200)
      .map((a) => {
        const depth = Number(a.depth);
        return {
          name: String(a.name).trim(),
          depth: Number.isInteger(depth) && depth >= 0 ? Math.min(depth, 31) : 0,
          points: (Array.isArray(a.points) ? a.points : [])
            .map((n) => String(n || "").trim()).filter(Boolean).slice(0, 500),
        };
      });
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
        // ★★ THIS PRODUCT'S OWN FOOD FACTS (v639) — hers, and re-checked here like everything else that
        // crosses this boundary: a string, trimmed, and only when written. ⚠️ An absent key leaves the card
        // drawn exactly as it is today, with no line and no guess.
        for (const k of ["allergens", "keeping"]) {
          const v = p && typeof p[k] === "string" && p[k].trim();
          if (v) out[k] = String(p[k]).trim().slice(0, 200);
        }
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
    // ⚠️⚠️ AND AN EMPTY MENU IS AN ANSWER TOO (v581): deleting her last product used to leave the fallback
    // (RM16 Focaccia) on sale — ⭐ **the shop showing more than she has published.** ⭐ Adopted when it is
    // genuinely empty or when anything survived the checks above; rubbish still falls back.
    if (products.length || remote.products.length === 0) out.products = products;
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
  // ⚠️⚠️ `SHOP_BUILD`, NOT `ENGINE_VERSION` (v496). This line is what the baker reads to answer "which
  // build is my shop running?" — so it has to be **the build the file she is reading actually is**, not the
  // number that happens to be in a little file beside it. ⭐ Measured: with the import it said **v495 on a
  // page running v494**, which is precisely the sentence the update notice exists to make impossible.
  // ⚠️ `SHOP_BUILD` must stay a plain number — the build notice compares DIGITS against `admin/js/version.js`,
  // and a suffix there would make the notice blind. ⭐ The `_2` that named the second gateway went with it
  // (v634): there is one shop again.
  holder.appendChild(el("div", { class: "dev-engine" }, `Engine v${SHOP_BUILD}`));
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
    // ⚠️⚠️ ENTER IS ALSO HOW A CHINESE KEYBOARD ACCEPTS A CHARACTER (v555). ⭐ With a pinyin or IME
    // keyboard, typing 我想 means typing "wo xiang" and pressing Enter to take the candidate — and this
    // handler sent the ROMANISED HALF-WORD and thanked them for it, while the sentence they were writing
    // was gone. ⭐ The shop offers 中文, so this was the box's least usable language.
    // ⚠️ `isComposing` is the browser's own answer, and `keyCode === 229` is the older one several Android
    // keyboards still send. Neither is a send.
    if (e.isComposing || e.keyCode === 229) return;
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
// ★★ "GOOD TO KNOW" IS HER OWN WORDING NOW (v641). ⚠️ One line per bullet, drawn from what the backoffice
// published; blank falls back to the shop's own five sentences, so this panel can never be empty. ⭐ The
// WhatsApp line stays LAST and is structural — it carries whatever number she publishes, and it is not a
// sentence she has to remember to include.
function paintFacts(cfg) {
  const list = document.getElementById("facts-list");
  if (!list || typeof list.replaceChildren !== "function") return;
  // ⚠️ ENGLISH FALLS BACK TO THE ONE LIST THE EDITOR ALSO SHOWS (v642); 中文 and BM to their own translations,
  // which is what makes the box and the page agree in every language she has not written for.
  const lang = loadLang();
  const fallback = lang === "en"
    ? DEFAULT_FACTS
    : ["factBake", "factCutoff", "factGet", "factPay", "factChange"].map((k) => t(k));
  const lines = factsLines(CONFIG, lang, fallback);
  const shown = phoneText(cfg && cfg.whatsapp);
  list.replaceChildren(
    ...lines.map((line) => el("li", {}, line)),
    el("li", {},
      el("span", {}, `${t("factAsk")} `),
      // ⚠️⚠️ `hidden` IS SET AS A PROPERTY, NEVER PASSED TO `el()` (v643). ⭐ MEASURED on her own shop: the
      // number was there and invisible — **`el()` writes every key it is given straight onto the element, so
      // `hidden: false` still SET the attribute, and a `hidden` attribute hides the element whatever its
      // value.** ⭐ This file's own tip bubble carries the same warning; it is the trap that catches whoever
      // writes a boolean-looking attribute in an object.
      (() => {
        const link = el("a", {
          class: "privacy-wa",
          href: shown ? `https://wa.me/${waNumber(cfg.whatsapp)}` : "",
        }, shown);
        if (!shown) link.hidden = true;
        return link;
      })()));
}


export function renderStatic(cfg) {
  document.title = `${t("titleWord")} · ${cfg.name}`;
  document.getElementById("name").textContent = cfg.name;
  document.getElementById("tagline").textContent = cfg.tagline;
  // ★★ IT IS OFFICIAL (v406). Her words: __"Make the trial an official one now"__ — so the `?trial=1`
  // flag is GONE rather than left on. ⚠️ **A flag that is permanently true is not a flag, it is a branch
  // nobody will ever test the other half of** — and it would have gone on saying "this is provisional"
  // about a page that is not.
  // ⚠️ BOTH PLACES THE CUT-OFF APPEARS take the same readable form, so the strip at the top and the
  // "Order by" row can never say it two ways.
  const cutoffSay = clockWords(cfg.cutoff);
  document.getElementById("eyebrow").textContent = sub(t("madeToOrder"), cutoffSay);

  const days = cfg.deliveryDays.map((n) => dayName(n)).join(", ");
  document.getElementById("delivery-days").textContent = days;
  document.getElementById("cutoff").textContent = sub(t("beforeVal"), cutoffSay);
  paintDayAnswer(cfg, cutoffSay);

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

  // The contact number on the privacy notice (v348). The sentence around it is
  // translated with the rest of the page; the NUMBER is not translated, and it is
  // read from the same setting the order button builds its link from — so changing
  // it in Settings -> Storefront changes it here as well, and the notice can never
  // print a number that has been left behind. Hidden if there is no number at all,
  // which is better than a link to nowhere.
  // ⚠️ BOTH SHEETS NAME THE SAME NUMBER (v636_2) — one reading, two links, so the two can never disagree.
  const shownWa = phoneText(cfg && cfg.whatsapp);
  for (const id of ["privacy-wa"]) {
    const link = document.getElementById(id);
    if (!link) continue;
    link.textContent = shownWa;
    link.href = shownWa ? `https://wa.me/${waNumber(cfg.whatsapp)}` : "";
    link.hidden = !shownWa;
  }
  // ★★ and the Good to know bullets are redrawn with every static repaint — a language switch must swap every
  // one of them, including any she wrote herself (v641).
  paintFacts(cfg);

  // ⚠️ THE NOTICE'S PRESS IS NOT WIRED HERE — see the foot of this file. renderStatic()
  // runs AGAIN on every render and on every language switch, and a TOGGLE bound in here is
  // bound once more each time: one press then flipped the panel an even number of times and
  // the control looked dead. It is bound once, at module scope, with the language pills.

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

// ⚠️⚠️ THE REFUSAL LINE IS HELD BY REFERENCE, AND THIS IS THE WHOLE OF v460. Her report: __"why on step 2,
// i try to press + the warning come out, but if i press -, the warning disappear and never come back
// again??"__
// ⭐⭐ **SHE WAS RIGHT, AND IT WAS WORSE THAN "DISAPPEARS".** v459 moved that line to sit directly above the
// product card — **which put it INSIDE the menu** — and the menu is rebuilt from scratch by `renderMenu()`
// on every quantity change. ⭐ **So pressing − deleted the line from the page, and from then on
// `document.getElementById("step-note")` answered `null` for the rest of the visit: `sayStepFirst` bailed
// on its first line, and no press could ever bring it back.** ⚠️ **Measured on the real shop before
// touching anything: after + the line was in the document; after − `getElementById` returned NOTHING; after
// + again, still nothing.**
// ⭐ The node is therefore captured ONCE and kept for the life of the page, so a rebuild can never destroy
// it — it is moved, never lost.
let stepNoteEl = null;
// ⚠️ AND WHERE IT IS SPEAKING IS NO LONGER THE PRODUCT CARD (v493). v460 kept the card's NAME here and
// re-hung the line above that card after every menu rebuild; **the line lives under a step heading now,
// which no rebuild touches, so the product name — and the re-hanging itself — are gone.**

  // ⚠️⚠️ IF THEY DISAGREE THE FLASH IS CUT OFF MID-BLINK — and it could only ever have been wrong in
  // that direction, because the timer is the thing that fires while `animation: none` fires nothing.
  // ⭐ So the arithmetic is read from the page rather than repeated here, and a test pins that this
  // function still asks. ⚠️ The 200 is a margin so the last blink finishes rather than being clipped.
  const flashMs = () => {
    try {
      if (typeof getComputedStyle !== "function" || typeof document === "undefined") return 1200;
      const cs = getComputedStyle(document.documentElement);
      const each = parseFloat(cs.getPropertyValue("--flash-blink"));
      const many = parseFloat(cs.getPropertyValue("--flash-blinks"));
      if (!(each > 0) || !(many > 0)) return 1200;
      return each * many + 200;
    } catch {
      return 1200;
    }
  };

  const flashRow = (b) => {
    if (!b || !b.classList) return;
    b.classList.remove("flash");
    // ⚠️ READING `offsetWidth` FORCES A REFLOW, and it is the whole trick: without it the browser
    // coalesces "remove then add" into no change at all and a SECOND tap flashes nothing.
    void b.offsetWidth;
    b.classList.add("flash");
    // ⚠️⚠️ THE CLASS COMES OFF ON A TIMER, NOT ON `animationend` — and that is a FAULT FIXED, not a
    // preference (v424). ⚠️ Under `prefers-reduced-motion: reduce` the stylesheet sets
    // `animation: none`, and **an animation that never runs never fires `animationend`** — so the mark
    // stayed on that row FOR GOOD, and tapping a second place left the first one lit as well. It was
    // shipped that way in v423 and found by reading the rule back rather than by anyone hitting it:
    // **the reader it would have hit is the one who asked for less movement.** ⭐ A timer always fires.
    // ⚠️ And the previous timer is cleared first, so a quick second tap cannot have the FIRST tap's
    // timer pull the class off the flash it has only just started.
    if (typeof b._flashTimer !== "undefined") clearTimeout(b._flashTimer);
    b._flashTimer = setTimeout(() => {
      b.classList.remove("flash");
      b._flashTimer = undefined;
    }, flashMs());
  };

// ---------------------------------------------------------------------------------
// ★★ IS THIS PAGE THE NEWEST ONE? (v492)
//
// Her words: __"just build the shop warning"__.
//
// ⭐ THE DECISION ITSELF LIVES IN `store/build.js`, ALONE AND PURE — a comparison of two numbers
// needs no page to be true, and it can be pinned by a test that way (this file cannot: it calls
// `render()` at the top level, so no test can import it at all). **Everything in this block is the
// asking; everything worth proving is over there.**
//
// ⚠️ NONE OF IT WAS HERE BEFORE, AND IT IS NOT ONLY HER: the backoffice has carried a
// "you are on an old build" strip since v255, and the shop — the page a CUSTOMER uses, who has no
// way of knowing and whose order is real money — had nothing. **It asks the site which build it is
// serving, with `cache: "no-store"` so the browser cannot answer out of its own copy, and compares
// it with this page's own build.** One small file, one number compared; nothing about the customer,
// nothing sent anywhere.
// ---------------------------------------------------------------------------------

// ⚠️ THE SECOND STATE EXISTS BECAUSE THE FIRST ONE CANNOT ALWAYS WORK. Pressing Reload asks the
// browser to fetch the page again — and a browser still holding the old script will happily serve
// it, so the customer lands back here with the same notice and a button that did nothing. **The
// backoffice's strip learned this at v256 and stops offering the press; this does the same, and it
// remembers across the reload through `sessionStorage`** (a page reload wipes memory, and that is
// the whole problem being solved). ⚠️ Every use is guarded: a browser that refuses storage simply
// loses the memory, and the worst case is that a press which did not work is offered once more.
function buildTried() {
  try { return sessionStorage.getItem(BUILD_TRIED_KEY) === String(SHOP_BUILD); }
  catch { return false; }
}
function rememberBuildTried() {
  try { sessionStorage.setItem(BUILD_TRIED_KEY, String(SHOP_BUILD)); }
  catch { /* no storage — the press is simply offered again next time */ }
}

// ★★★ AND THE STRIP'S OWN HEIGHT IS WRITTEN DOWN, SO THE PAGE ALWAYS HAS ROOM FOR IT (v504).
//
// ⚠️⚠️ HER WORDS: __"i want it to be consistant with the app"__ — ⭐ **the app's strip is pinned above its
// tab bar, and its screens reserve room for it.** That reservation is what makes a pinned bar livable:
// **the customer can always scroll a control clear of it.** ⚠️ **Without the reservation, a control that
// happens to sit at the foot of the page is covered FOR GOOD** — which is exactly what she reported
// (__"why the step 3, self collection choice not clear?"__ — measured: "Self collect" 23px behind it,
// "Courier delivery" 87px).
// ⚠️ Measured AFTER the words are in and after the language is applied, because the sentence's length is what
// decides whether the strip is one row or two — and it is a different length in 中文 and Malay.
// ⚠️ Zero while it is hidden, so a page with no notice is the height it always was.
export function measureUpdateStrip() {
  if (typeof document === "undefined" || !document.documentElement) return;
  const box = document.getElementById("build-notice");
  let h = 0;
  if (box && !box.hidden && typeof box.getBoundingClientRect === "function") {
    try { h = Math.max(0, Math.round(box.getBoundingClientRect().height)); } catch { h = 0; }
  }
  try { document.documentElement.style.setProperty("--strip-h", `${h}px`); }
  catch { /* no inline styles on this page — the padding simply stays as it was */ }
}

function paintBuildNotice() {
  const box = typeof document === "undefined" ? null : document.getElementById("build-notice");
  if (!box) return;
  box.hidden = false;
  // ⚠️ AFTER the unhiding, so its real height can be read — a hidden element measures as nothing.
  measureUpdateStrip();
  const tried = buildTried();
  const say = document.getElementById("build-say");
  const stuck = document.getElementById("build-stuck");
  const btn = document.getElementById("build-reload");
  // ⚠️ THE PRESS GOES ON THE SECOND STATE, AND NEVER BEFORE: a customer who has not yet tried has
  // something useful to press, and one who has is told what actually works. **A dead button is
  // worse than no button** — this page's own rule, and the reason a closed day and a sold-out line
  // say their state in words instead of going grey.
  if (say) say.hidden = tried;
  if (stuck) stuck.hidden = !tried;
  if (btn) btn.hidden = tried;
}

async function checkBuild() {
  if (typeof document === "undefined") return;
  // ⚠️ ONCE THE NOTICE IS UP THERE IS NOTHING MORE TO LEARN, and this runs on every 30-second beat
  // — re-asking would be a request every half minute for an answer already known. It clears itself
  // when the customer reloads.
  const box = document.getElementById("build-notice");
  if (box && !box.hidden) return;
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res || !res.ok) return;
    const text = await res.text();
    // ⚠️⚠️ `SHOP_BUILD`, NAMED EXPLICITLY — **the build THIS FILE is**, which is the only thing a page can
    // honestly claim about itself. Letting `newerBuild` fall back to an imported default was the fault
    // v496 fixes: the page then measured itself with the SITE's number.
    if (newerBuild(text, SHOP_BUILD)) paintBuildNotice();
  } catch { /* offline, or a stub — say nothing rather than guess */ }
}

export function render() {
  renderStatic(CONFIG);
  const dateWrap = document.getElementById("dates");
  const menu = document.getElementById("menu");
  const cart = new Map();

  // ★★ THE MENU'S OWN ANSWER, FOR THE REORDER (v638). `offerOf` lives inside `renderMenu` because that is
  // where the day's numbers arrive; this holds the last computed lookup so "add my last order again" asks
  // the SAME question the cards ask. ⚠️ Reassigned on every menu render; a stale one can never add something
  // the menu is currently refusing.
  let offerByName = () => null;

  // ⚠️ The customer's own phone. Best effort everywhere: a private window has no storage and must not break
  // the shop.
  const shopStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);
  let lastBasket = readLastBasket(shopStorage());
  // ⚠️ A second `render()` must not lose it: the first capture wins, and if the line has been torn out of
  // the page since, the node we already hold is the one that goes back.
  stepNoteEl = stepNoteEl || document.getElementById("step-note");
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
  // ★★ HAS THE CUSTOMER ACTUALLY CHOSEN A DAY? (v434) ⚠️⚠️ NOT THE SAME QUESTION AS "is a day
  // selected" — the first open day is chosen FOR him on load, deliberately, so that ordering can
  // never be blocked by forgetting to tap. But the step circle means **"you have done this"**, and
  // crediting him with a choice the page made is the same fault step 3 was already built to avoid
  // (`fulfilled._picked` — *"the page does not credit him with a choice he did not make"*).
  // ⭐ Her words: __"the 1,2,3 in the same round ball"__ — and on load they now all are, because
  // none of them claims anything he has not done.
  let dayPicked = false;
  // ★★ THE ONE VOICE FOR "NOT YET — DO THIS FIRST" (v453). Every locked step says it the same way, and
  // scrolls to the step it is naming, so he is never told to finish something he cannot see.

// ★★★ A MISSING FIELD MARKS ITSELF (v455). Her words: __"or the missing field turn red embossed, or how a
// form filling would behave"__ ⭐ **This is ordinary form behaviour: the input that is wrong takes the red
// edge, and its reason sits directly under it.** ⚠️ **Not a pop-up over the shop and no scroll** — the
// message belongs where the thing that is missing lives.
function markField(input, key, extraKey = null) {
  if (!input) return;
  input.classList.add("bad");
  // ⚠️⚠️ AND IT IS TIED TO THE BOX, NOT ONLY SITTING UNDER IT (v455). The skill, 1.6: *"status shown by
  // colour alone"* and *"a label not tied with `for`"* are the two most-missed hand-written-site faults.
  // ⭐ **`aria-describedby` is what makes a screen reader announce the reason WITH the box** — the visible
  // line and the announced line are the same line, or only sighted people get it.
  input.setAttribute("aria-describedby", `${input.id}-note`);
  input.setAttribute("aria-invalid", "true");
  const id = `${input.id}-note`;
  let said = document.getElementById(id);
  if (!said) {
    said = el("p", { class: "field-note", id, role: "status" });
    if (input.parentNode && input.parentNode.appendChild) input.parentNode.appendChild(said);
  }
  // ⚠️ A SECOND SENTENCE WHEN THE FIRST ONE IS NOT THE WHOLE STORY (v493). The WhatsApp box's reason used
  // to be a two-part banner at the foot of the page — *"Please add your WhatsApp number."* then *"We use it
  // to confirm your order and send your payment QR."* ⭐ **The banner is retired and the box says it now, so
  // both sentences have to come with it** — otherwise the customer is told what is missing and not why the
  // bakery needs it.
  said.textContent = extraKey ? `${t(key)} ${t(extraKey)}` : t(key);
  said.hidden = false;
  // ★★★ AND THE REASON BLINKS (v462). Her report: __"i skip step 3, go for step4, not warning"__ — ⚠️ **the
  // warning WAS there: the box turned red with its reason underneath it.** ⭐ **But it was a still red edge,
  // a screen up from the button she had just pressed, and nothing about it moved.** ⭐⭐ **So it read as no
  // warning at all.** ⭐ It goes through the shop's one flash, so a missing box and a locked step blink the
  // same way and there is still only one set of numbers.
  flashRow(said);
  // ★★★ AND THE PAGE GOES TO THE THING THAT IS MISSING (v462) — ⚠️⚠️ **AND THIS DELIBERATELY REVERSES PART
  // OF v455'S JUDGEMENT, AT HER INSTRUCTION.**
  // Her report: __"i skip step 3, go for step4, not warning"__. ⭐ **Measured: pressing Place order put the
  // reason 825 PIXELS ABOVE the button she had pressed** — and a flashing line she cannot see is still a
  // line she cannot see.
  // ⚠️ v455's rule was *"the page does not move"*, and it was right for a message appearing **on its own**
  // (the v423 parked place, the step line). ⭐⭐ **THIS IS NOT THAT: she PRESSED a button and the form is
  // answering her.** ⭐ **A press may carry the page — v99's "Next available" line already scrolls the
  // calendar.** ⚠️ What must never happen is the page moving while she is doing something else.
  // ⭐ `block: "center"` so the box lands in the middle rather than under the bar fixed to the foot.
  if (input.focus) input.focus({ preventScroll: true });
  if (input.scrollIntoView) {
    try { input.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch { try { input.scrollIntoView(); } catch { /* a page that refuses is not a reason to fail */ } }
  }
}
function clearFieldMarks() {
  for (const input of document.querySelectorAll(".input.bad")) {
    input.classList.remove("bad");
    input.removeAttribute("aria-describedby");
    input.removeAttribute("aria-invalid");
    const said = input.id ? document.getElementById(`${input.id}-note`) : null;
    if (said) { said.hidden = true; said.textContent = ""; }
  }
}

  // ★★★ THE ONE VOICE FOR "NOT YET — DO THIS FIRST" (v453) — AND SINCE v493 IT IS THE ONLY ONE.
  //
  // Her words, and they are the whole of this version: __"we should cleanup the store behavior, there is 4
  // steps ordering process, 1. step 1 not fill up. no matter the user is clicking on step 2, step3 or step
  // 4, the screen should scroll to step1, and below step one flashing the warning meaasge. 2. step 2 is not
  // fill up, and step 1 complete. The user clicking on step 3 or 4, the screen should scroll to step2, and
  // below step 2 flashing the warning message, 3. step 3 not fill up, step1 &2 done, clicking step 4,
  // screen will scroll to the field below it and flash the warning, Any other warning message serve the
  // purpose if not behave in such a way should be retired"__
  //
  // ⭐⭐ SO THE WARNING BELONGS TO THE STEP, NOT TO WHATEVER HE HAPPENED TO TOUCH. The line is put
  // **directly under the heading of the step it names**, and the page is carried to it. Two earlier
  // judgements are reversed here, at her instruction, and it is worth saying which:
  //
  //   * v455 — *"it does not move the page"*, after her report __"the message show in the wrong place and
  //     the screen jump"__. ⚠️ **That was right for a line appearing ON ITS OWN. It is not this: he
  //     PRESSED something and the page is answering him** — the same distinction `markField` settled at
  //     v462, where she reported a warning sitting **825 pixels above** the button she had pressed.
  //   * v459 — the line was put **directly above the control that refused**, so it would land on the screen
  //     he was already looking at. ⚠️ **Measured then: with the customer at the menu, a line under step 1
  //     sat 262 pixels ABOVE the top of the screen.** ⭐ Putting the line at the step fixes the same fault
  //     from the other end: **the line stays where it belongs, and the PAGE comes to it.**
  //
  // ⚠️ AND THE PAGE IS ONLY MOVED WHEN THERE IS SOMETHING TO MOVE TO. If the step is already fully on
  // screen, nothing scrolls — a page that jumps while he is looking straight at the thing being named is
  // the fault v423 settled for the parked place.
  //
  // ⚠️⚠️ THE HELD NODE, NOT A LOOKUP (v460). **Once the line had been torn out of the page by a menu
  // rebuild, `getElementById` could never find it again** — that is why her warning "never came back".
  // ⭐ That can no longer happen: the line now lives under a step HEADING, and the headings are static
  // markup that no repaint replaces. **The re-hanging machinery that v460 needed (`placeStepNote`) is
  // therefore retired in this version** — it existed only because the line used to be hung inside the menu.
  let stepNoteStep = null;   // which step the line is currently speaking about — see `paintSteps`

  // ⚠️ MOVES THE PAGE ONLY IF THE THING IS NOT ALREADY ON IT. A customer tapping + on a card who can
  // already see the step being named must not be thrown up the page for nothing.
  // ★★★ HOW LONG THE RECEIPT STAYS (v495, and her number twice — v509). ⚠️ ONE NUMBER, IN ONE PLACE: the
  // only thing anyone would ever want to change, and changing it must not mean touching the code that uses
  // it. ⭐ Her words, when the number was a minute: __"after the order confirmation, and waited for 1min,
  // the page should reset itself"__ — and then, once the receipt was the last thing left: __"make it 20sec
  // instead of 1min"__.
  const RECEIPT_LIFE_MS = 20000;
  // ★★★ WHEN THE RECEIPT WENT UP. ⚠️⚠️ **IT EXISTS BECAUSE A TIMER IS NOT ENOUGH, AND HER PHONE PROVED IT.**
  //
  // Her report: __"footer say v496, but no offer to reload"__ — ⭐ the code was current and the offer still
  // never came. **MEASURED ON THE LIVE PAGE: `document.visibilityState` was `hidden`, and the sixty-second
  // timer simply never fired.** ⚠️ A hidden tab has its timers frozen or throttled to the minute — **and a
  // customer who has just placed an order puts the phone down or switches to WhatsApp.** ⭐⭐ **So the one
  // moment this whole feature is for — the next customer picking the phone up — is exactly when the timer
  // has not run.** The receipt waited on a clock nobody was winding.
  // ⭐ Zero means **no order is on screen**: cleared by `hideReceipt` when the receipt goes (v509) and by
  // `retirePreviousOrder` when the next order begins (v499), so it never claims an order that has gone.
  let orderedAt = 0;

  // ⚠️⚠️ A TIMER THAT ONLY PAINTS MUST NEVER BE THE REASON A PAGE IS KEPT ALIVE. In a browser this is a
  // no-op — `setTimeout` hands back a number, which has no `unref`. ⭐ In Node, where this shop's own tests
  // run, it is the difference between the runner exiting and a sixty-second timer holding it open: measured,
  // the whole suite timed out at 20 seconds with the plain `setTimeout`.
  function shopTimer(fn, ms) {
    const id = setTimeout(fn, ms);
    if (id && typeof id.unref === "function") id.unref();
    return id;
  }

  // ★★★ THE RECEIPT GOES BY ITSELF, TWENTY SECONDS AFTER THE ORDER (v509).
  //
  // ⚠️⚠️ HER WORDS: __"it is good to see the page cleared. So i think we should remove the order to reload.
  // Just need to make the green Order Received! message vanish after 1min, can?"__ — and then the number:
  // __"make it 20sec instead of 1min"__.
  // ⭐⭐ **AND SHE IS RIGHT, AND IT IS SIMPLER THAN WHAT WAS HERE.** The offer — a card with "Clear the page"
  // and "Not now" — was doing three jobs at once: saying the page was clear, offering a reload, and then
  // **standing on the receipt as a live reload button over whatever the next customer was typing.** ⚠️ **All
  // of it existed because the page did NOT clear itself. It does now** (v465, and the whole of step 3 since
  // v506) — ⭐ **so the only thing left is for the receipt to go, and it can do that on its own.**
  //
  // ⚠️ THE ONE COST, NAMED ONCE AND THEN DROPPED: **the order number and the tracking code are on that
  // receipt**, so twenty seconds after the order they are off the screen. ⭐ Her number, her call — and the
  // bakery confirms every order by hand on WhatsApp, where the customer keeps it in writing.
  // ⚠️ AND IT IS ARMED IN THE RECEIPT'S OWN CALLBACK, never before it — **a timer armed before the receipt
  // exists would fire against nothing**, which is the ordering fault v495 spent a whole version on.
  function hideReceipt() {
    const box = document.getElementById("confirm-msg");
    if (!box || box.hidden) return;      // ⚠️ already gone, or never up — there is nothing to do
    box.hidden = true;
    box.replaceChildren();
    orderedAt = 0;                       // ⭐ one order, one disappearance
  }

  // ★★★ AND THE PREVIOUS ORDER'S RECEIPT GOES THE MOMENT A NEW ORDER BEGINS (v499).
  //
  // ⚠️⚠️ HER QUESTION, AND IT IS THE RIGHT ONE: __"is automatic reloading of store a good idea? … What i try
  // is adding customer details in it, the offer still shows"__ — ⭐ **NO, IT IS NOT, and her own test found
  // why: she was entering the NEXT customer's details with the previous order's live Reload button still on
  // screen.**
  //
  // ⭐⭐ **AND THE AUTO-RELOAD WAS NEVER NEEDED.** The FORM has cleared itself on the order since v465 — the
  // basket, the notes, the name, the number, the address, the door pin, the code and the bake day. **The next
  // customer already starts fresh.** ⚠️ What lingers is the RECEIPT, and **a new customer arriving IS the
  // reset** — there is nothing to force.
  //
  // ⭐ SO THE RULE IS READ OFF THE SHOP'S OWN STATE, in one place, and it needs no listener on any control:
  // **when step 1 or step 2 becomes done again, a new order has begun.** ⚠️ It cannot fire on the order just
  // placed, because the reset sets both of them back to false as the receipt goes up. ⚠️ And step 3 needs no
  // rule of its own: it cannot be reached without 1 and 2.
  function retirePreviousOrder() {
    const box = document.getElementById("confirm-msg");
    if (box && !box.hidden) { box.hidden = true; box.replaceChildren(); }
    // ⚠️⚠️ AND THE ORDER IS FORGOTTEN TOO (v500). ⭐ The receipt has gone, so there is nothing for the clock
    // to measure from — and **a state that says an order is still live after its receipt has gone is a state
    // that lies**, because the next person to read `orderedAt` would have no way to know.
    orderedAt = 0;
  }

  // ★★★ AND THE PAGE BEING LOOKED AT AGAIN IS THE TRIGGER THAT MATTERS (v497).
  //
  // ⚠️⚠️ HER REPORT, AND THE MEASUREMENT BEHIND IT: __"footer say v496, but no offer to reload"__ — the code
  // was current, and on the live page `document.visibilityState` was **`hidden`** with the sixty-second
  // timer never having fired. ⭐ **A timer in a hidden tab is frozen; a customer who has just ordered puts
  // the phone down.** ⚠️ **So the shop cannot wait to be told the minute is up — it has to look at the clock
  // when someone looks at IT.**
  //
  // ⭐ It answers the same question the timer does, at the moment the answer actually matters, and it is
  // deliberately BOTH: the timer serves a customer sitting there watching, and this serves the next customer
  // picking the phone up — which is the ordinary case.
  // ⚠️ Neither can fire before its time: both ask the clock, so a page that comes back after ten seconds
  // is left alone.
  shopLookedAgain = (now) => {
    if (!orderedAt) return;                       // ⚠️ no order on screen — nothing to take away
    // ⭐ The timer due to take the receipt down may never have run, so ask the clock.
    if (Number(now) - orderedAt >= RECEIPT_LIFE_MS) hideReceipt();
  };

  // ⚠️⚠️ AND `autoReset` IS GONE — NOT DISABLED, NOT GUARDED, GONE (v499). ⭐ It was the "if nobody attends
  // to it, the shop does it by itself" half, and **her next question retired it:**
  // __"is automatic reloading of store a good idea? … What i try is adding customer details in it, the offer
  // still shows"__ — ⚠️ **a live Reload button sitting over a page someone is typing into.** ⭐ The guard it
  // used to carry (has the page been scrolled?) was a proxy for "is anyone using this", **and a proxy is
  // exactly the wrong tool for a question whose wrong answer destroys a customer's details.**
  // ⭐ **Nothing on this page reloads on a timer.** The form has cleared itself on the order since v465 · the
  // receipt goes by itself twenty seconds later (v509) · and `retirePreviousOrder` takes the last one's
  // receipt away the moment a new order begins.

  // ⚠️ AND THE OTHER THING A BREATH-TAKING PAINT ONCE DID — `scrollPageToTop` — IS GONE TOO, and it never
  // belonged here: it came out of a genuine build with a genuine problem behind it, ⭐ **measured: a smooth
  // scroll did not move the page at all while an instant one to the same place worked** — and that answer is
  // still the right one for the REFUSAL line, which asks the same way through `bringIntoView` below.

  function bringIntoView(what) {
    if (!what) return;
    if (typeof what.getBoundingClientRect !== "function" || typeof what.scrollIntoView !== "function") return;
    let onScreen = false;
    try {
      const r = what.getBoundingClientRect();
      const h = (typeof window !== "undefined" && window.innerHeight) || 0;
      // ⚠️ NO HEIGHT MEANS NOTHING CAN BE INSIDE IT (a collapsed pane, a stub) — so it falls through to
      // moving, which is the behaviour that needs no measurement to be right.
      onScreen = h > 0 && r.top >= 0 && r.bottom <= h;
    } catch { onScreen = false; }
    if (onScreen) return;
    // ⚠️ CENTRED, LIKE `markField` — **the line is what he must read, so it goes in the MIDDLE of the
    // screen rather than under the bar fixed to the foot of the page.** ⚠️ `block: "start"` was the first
    // thing I wrote, and it put a step-1 line at the very top with the calendar it is about still below it:
    // on a long menu the sentence simply fell off the bottom.
    //
    // ⚠️⚠️ AND THE MOVE IS ASKED FOR SMOOTHLY, THEN CHECKED (v493). **MEASURED IN THE PREVIEW PANE: an
    // instant `scrollIntoView` on the line moved the page (1947 → 985, the line landing 367px down an
    // 812px screen) — and the SAME CALL with `behavior: "smooth"` did not move it at all.** ⭐ A smooth
    // scroll is an ANIMATION, and an animation the browser declines to run (a backgrounded tab, a phone
    // under load, a pane that is not painting) **leaves the customer looking at nothing, which is the whole
    // fault this feature exists to fix.** ⚠️ So the smooth move is asked for first — it is gentler, and it
    // is what `markField` has used since v462 — and then the page is asked whether it actually moved. **If
    // it has not moved by the time the animation should be under way, it is done instantly.**
    const before = (typeof window !== "undefined" && Number(window.scrollY)) || 0;
    try { what.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch { try { what.scrollIntoView({ block: "center" }); } catch { /* a page that refuses */ } }
    if (typeof setTimeout !== "function") return;
    setTimeout(() => {
      if (!what) return;
      const now = (typeof window !== "undefined" && Number(window.scrollY)) || 0;
      if (now !== before) return;               // ⭐ it moved — the smooth move is running
      let stillOff = false;
      try {
        const r = what.getBoundingClientRect();
        const h = (typeof window !== "undefined" && window.innerHeight) || 0;
        stillOff = h > 0 && (r.top < 0 || r.bottom > h);
      } catch { stillOff = true; }
      if (!stillOff) return;
      try { what.scrollIntoView({ block: "center" }); }
      catch { /* a page that refuses is not a reason to fail */ }
    }, 350);
  }

  // ⭐ WHERE EACH STEP'S LINE BELONGS: DIRECTLY BELOW THE FIELD THAT STEP IS FILLED IN WITH (v493).
  // Her words, in three messages as she followed the build: __"the screen should scroll to step1, and below
  // step one flashing the warning meaasge"__ · __"the field and steps should be in sequence, the appropriate
  // warning should be below that field"__ · and then the last piece: __"step3 is a big step, can be a very
  // tall step window, then it shold go by field."__
  // ⭐ **So it is not the heading and it is not the control he touched: it is the foot of the field that is
  // missing, in the order the page already reads.**
  // ⚠️ AND STEP 3 IS THE ONE THAT MAKES THAT MATTER. It is the tall one — a name, a number, the two ways to
  // get the order and the address — so "the foot of step 3" is a screen and a half below the thing he must
  // actually fix. ⭐ Its line hangs under **the two cards**, which is the field that refusal is about; the
  // name and the number do not come here at all — they mark themselves, with their reason under the box
  // (`markField`), which is the same rule read one field further in.
  const STEP_FIELD = { step1: "dates", step2: "menu", step3: "fulfillment" };

  function sayStepFirst(titleKey, bodyKey, stepId, bodyText = null) {
    const note = stepNoteEl || document.getElementById("step-note");
    if (!note) return;
    stepNoteEl = note;
    // ⚠️ `previousSibling`, not `nextSibling`: if the line is already sitting in the right place, moving it
    // again would be work done for nothing — and it would show up as a second copy in a naive shim.
    const field = document.getElementById(STEP_FIELD[stepId] || stepId);
    if (field && field.parentNode && typeof field.parentNode.insertBefore === "function"
        && note.previousSibling !== field) {
      field.parentNode.insertBefore(note, field.nextSibling);
    }
    stepNoteStep = stepId;
    // ⚠️ `bodyText` IS FOR THE ONE REFUSAL WHOSE WORDS ARE BUILT, NOT KEYED — the day that closed while
    // the page sat open, whose sentence names the cut-off time (v493's cleanup brought it here too).
    note.replaceChildren(el("strong", {}, t(titleKey)), " ", bodyText == null ? t(bodyKey) : bodyText);
    note.hidden = false;
    note.classList.add("on");
    // ★★★ AND IT BLINKS (v461). Her question, and it is the right one: __"did you blink the warning?"__
    // ⚠️ **It did not — the line simply appeared**, and her report a moment earlier was __"it just dont
    // allow, but no warning"__. ⭐ It goes through the shop's OWN flash, so the blink length, the number of
    // blinks and the moment the mark comes off are **one fact in one place** (v427).
    flashRow(note);
    // ⭐ AND THE PAGE COMES TO IT (v493) — after the words are in, so the distance measured is the real one.
    // ⚠️ THE LINE ITSELF IS WHAT MOVES INTO VIEW, not the field above it: the field can be long (a five-week
    // calendar, a menu of every product), and the sentence at its foot is the thing he must read.
    bringIntoView(note);
  }
  let avail = null;      // { 'YYYY-MM-DD': slots_left } — day-level, for the calendar
  let prodAvail = null;  // { 'YYYY-MM-DD': { product: slots_left } } — for the item stamps
  let dayRows = null;    // published delivery-date rows — the real dates win
  let dates = upcomingDates(CONFIG);
  // A product's date rules (closes X days before delivery / a from–to window) compare each delivery date to
  // today. ⚠️⚠️ AND "TODAY" IS RE-READ ON EVERY REPAINT (v595): ⚠️ it was fixed at load while the page redraws
  // at midnight — ⚠️ **a close-days rule kept counting from yesterday, and bread needing four days' notice was
  // sold at 00:10.** ⭐ `rerender` sets it before resolving the dates.
  let todayKey = dateKey(new Date());

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
  const promoRotor = document.getElementById("promo-rotor");
  const promoDots = document.getElementById("promo-dots");
  const promoClear = document.getElementById("promo-clear");
  // ★ The same fact, said again where the money is (v408) — and the spacer that has to grow
  // with it. See paintPromo.
  const promoBar = document.getElementById("promo-bar");

  // ── The standing offers, and how they turn (v292; the jump fixed in v295) ──
  //
  // More than one code can be running at once, and the strip used to show only the
  // first. Now they turn. The pattern is the homepage's own carousel
  // (reviews.js buildCarousel) — stop while the pointer is over it, stop while the
  // tab is hidden, and under two items nothing moves — with these deliberate
  // differences, each for a reason:
  //
  //   · A FADE IN PLACE, not a sliding track. That carousel slides review CARDS;
  //     this is one line of message, and sliding a single line sideways reads as
  //     a glitch rather than as a second offer.
  //   · With ONE code the timer is never armed at all. The homepage arms its
  //     interval even for a single slide, where it ticks to no effect.
  //   · A PRESS holds it still for a while. There is no hover on a phone, so a
  //     tap is the only pause a customer there has — and a pause that ended the
  //     moment the finger came up would be no pause at all. It starts again by
  //     itself, so a tap can never leave the strip stuck on one offer.
  //   · 1.5 seconds between offers, which is her number, not the homepage's six.
  //
  // ★ EVERY OFFER IS DRAWN AT ONCE, STACKED, AND ONLY THE CURRENT ONE IS LIT (v295).
  //
  // v292 wrote each offer into ONE pair of lines as the turn came round, so the strip
  // was exactly as tall as the message it happened to be showing. Two codes where only
  // one carries a sentence of her own are two different heights — so every turn made
  // the whole page below the strip jump. Her words: "when the message switch, the page
  // is like jumping up and down repeatedly… The window should be fix, base on the
  // tallest message."
  //
  // So the offers are built as slides and STACKED IN ONE GRID CELL. A grid row is as
  // tall as its tallest item, which makes the strip exactly as tall as the TALLEST
  // message — worked out by the browser, at whatever font, language and text size the
  // customer actually has, with no number of ours that can go stale. Turning then only
  // moves which slide is lit, and nothing under the strip moves at all.
  // ★ 2 SECONDS, HER NUMBER, GIVEN 2026-10-05 (v317). It was 1.5s, chosen back when the line
  // was mostly a short code, and she reported the result as too fast: __"maybe the scrolling is
  // too fast and hardly see the results"__.
  //
  // ⚠️ **AND IT IS THE STILLNESS THAT WAS TOO SHORT, NOT THE MOVE.** The slide itself takes
  // 0.4s, which is already the top of the house band (250–400ms for a state change) — slowing
  // the animation would only make it draggy without buying a second of reading. At 1.5s an
  // offer sat still for about **1.1s**; at 2s it sits for **1.6s**.
  //
  // ⚠️ **MEASURED ON HER OWN SHOP, SO THE CEILING IS ON THE RECORD:** her offers run to **38
  // words** (the code's line plus her own sentence in the chalk hand), which wants about 11
  // seconds at a comfortable pace; the short one is 14 words, about 4. **She was shown those
  // numbers and chose 2 seconds anyway** — her line, her shop. If she says so again, this is
  // the one number to change, and nothing else needs touching.
  const TURN_MS = 2000;

  let turnTimer = null;
  let turnsDone = 0;        // how many turns have COMPLETED (see armTurn)
  let lastTurnError = "";   // and the message if one ever threw
  let liveCodes = [];   // what the strip is turning through right now
  let shownCodes = [];  // ...and what it was turning through when it last drew
  let codeAt = 0;       // which of them is on screen
  let overStrip = false;
  let slides = [];      // one per offer, all in the strip at once
  let dots = [];        // ...and one dot per offer, under them
  let litAt = -1;       // which slide is lit, so a repaint can skip a pointless repaint

  // Whether the offers may turn RIGHT NOW. Read fresh on every tick rather than tearing
  // the timer down and rebuilding it on every hover, so a pointer moving over the strip
  // can never leave two timers running.
  //
  // ⚠️ THERE IS DELIBERATELY NO PRESS-HOLD HERE (v297). v292 paused the turn for twenty
  // seconds on any `pointerdown`, meant as the only pause a phone had. It was a trap: a
  // CUSTOMER WHO CLICKED THE STRIP — or a dot on it — froze it for twenty seconds, and
  // moving the pointer away could not release it, because the hold was a clock rather than
  // the pointer. Her report: "once we put mouse over it or click it, the flip stop… move
  // the mouse outside the window, the flip should be back." The pointer being OVER the
  // strip is the whole of the pause now, so leaving always starts it again.
  // ⚠️⚠️ A POINTER MAY HOLD THE STRIP **ONLY WHERE A POINTER CAN HOVER** (v320).
  //
  // `overStrip` is a LATCH: set on `pointerenter`, cleared on `pointerleave` or
  // `pointercancel` — and **ON A TOUCH SCREEN NEITHER OF THOSE IS GUARANTEED TO FIRE.** A
  // finger that lands on the strip sets the latch, and if the matching leave never arrives
  // the strip is held **for the whole life of the page**: the timer still ticks, `mayTurn()`
  // says no, and **the offers never change again.** That is indistinguishable from a broken
  // strip, and it is the one mechanism in here that can stop the turning dead.
  //
  // Her report: *"the text never changes at all"* — with two dots showing, so the turning
  // should have been running.
  //
  // The pause exists so a reader can hold the message and finish it. **That only means
  // anything where a pointer rests**, which is a mouse. On a touch screen there is nothing
  // to rest, so there is nothing to hold — and the latch is simply not set.
  function canHover() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(hover: hover)").matches;
  }

  function mayTurn() {
    return !document.hidden && !(overStrip && canHover());
  }

  // One offer, as its own slide. Two lines: the app's line, which names the code, and
  // her own sentence underneath it when she has written one — never instead of it, because
  // a customer who cannot type the code cannot use it. A code she has written nothing for
  // is simply a SHORTER slide; it does not make the strip shorter, because the tallest one
  // decides that.
  function slideEl(c) {
    const own = ownWords(c);
    return el("div", { class: "promo-slide" },
      el("p", { class: "promo-offer" }, sub(t("promoToday"), clauseWords(c), c.code)),
      own ? el("p", { class: "promo-words" }, own) : null);
  }

  // Build the whole set at once, and light the first. Called only when the offers
  // themselves have changed — a repaint from the cart must not rebuild the slides, or
  // the cross-fade would restart under a customer who did nothing.
  function buildSlides(list) {
    slides = list.map(slideEl);
    if (promoRotor) promoRotor.replaceChildren(...slides);
    // HER ASK: "there should be 2 dot if there is 2 message, 3 dot if 3 message." One dot
    // per offer, under the strip — and none at all for a single offer, which is the same
    // rule that leaves the timer unarmed: one offer is a statement, not a carousel.
    dots = list.map((c, i) => el("button", {
      class: "promo-dot", type: "button",
      "aria-label": `${i + 1} / ${list.length}`,
      // A dot is a way IN, never a way to stop: pressing one goes to that offer and lets
      // the turn carry on. It used to also freeze the strip for twenty seconds — see mayTurn.
      onclick: () => { showSlide(i); armTurn(); },
    }));
    if (promoDots) promoDots.replaceChildren(...dots);
    litAt = -1;
  }

  // Light one slide and extinguish the rest. The wording is drawn once, at build time and
  // never again — this only moves a class, which is what makes the strip's height
  // unmovable: nothing here can change how tall the content is.
  //
  // ★ THE LEAVING MESSAGE GOES UP, AND THE NEXT FOLLOWS IT (v318). Every other slide waits a
  // full panel BELOW the window; the one that has just been replaced is sent up through the
  // TOP. Her words, which are the whole spec: __"Maybe you box up each message, when 1st
  // message start to scroll up, the 2nd message is following, So effectively you see 2
  // message, one follow by another, it scroll up, stop 2sec, scroll again until mouse over."__
  //
  // ⚠️ THE CLASS NAMES NEVER CHANGE — `is-on` and `is-left` mean the same two things they did
  // when this was a fade, then a flip, then a sideways slide (this one is showing / that one
  // has just gone). Three motions, one set of names, so nothing in this file had to be
  // rewritten and the dot, the pause and the timer are untouched.
  // ⚠️⚠️ THE LEAVING SLIDE IS THE ONE THAT WAS LIT, NOT "THE PREVIOUS INDEX" (v319).
  //
  // This used to derive the outgoing slide arithmetically — `left = (i - 1 + n) % n` — which
  // came down from the 3D flip, where two panels going out by opposite doors made sense.
  // **IT IS WRONG THE MOMENT A SHOP RUNS EXACTLY TWO OFFERS.** With n = 2 the "previous index"
  // IS the arriving slide, so the message about to come in was parked where the message that
  // had just gone sits — ABOVE the window — and it then travelled back DOWN into place.
  // Nothing was ever left waiting below, so "one message following another" could not happen
  // at all. **Measured on the real stylesheet at 375, two offers: at rest `[0, -66]` — nothing
  // below — and after a step the arriving slide came from -66. With three offers it read
  // `[0, 66, -66]` and the arriving one came up from below, which is why the fault hid.**
  //
  // So there are now two steps, and the second one is the whole fix:
  //
  // 1. **PARK EVERY SLIDE EXCEPT THE ONE BEING REPLACED, WITH NO TRANSITION** (`is-parked`).
  //    Every waiting message is put back to its place below instantly. This is what stops a
  //    message that has just left through the top from travelling back DOWN through the window
  //    when its turn comes round again — a jump with the transition off paints only its ends.
  // 2. **THEN hand out the classes.** The arriving message animates UP from below (her words:
  //    "when 1st message start to scroll up, the 2nd message is following"), and the one being
  //    replaced leaves through the top.
  //
  // The leaving slide is deliberately NOT parked: it is sitting in the window, and parking it
  // would send it to the bottom first and then sweep it the whole way up through the window.
  function showSlide(at) {
    codeAt = at;
    const i = Number(at) || 0;
    if (i === litAt && slides.length) return;
    const was = litAt;          // the slide being replaced — -1 on the very first paint
    litAt = i;

    slides.forEach((s, k) => {
      if (k === was) return;
      s.classList.add("is-parked");
      s.classList.remove("is-on", "is-left");
    });
    // Force the park to land BEFORE anything is animated, or the two happen in one frame and
    // the browser animates from wherever the slide happened to be.
    if (slides[0]) void slides[0].offsetHeight;

    slides.forEach((s, k) => {
      s.classList.remove("is-parked");
      s.classList.toggle("is-on", k === i);
      s.classList.toggle("is-left", k === was && k !== i);
      // The offers nobody is reading must not be read aloud either. They are stacked
      // behind the lit one, so a screen reader would otherwise take all of them in turn.
      s.setAttribute("aria-hidden", k === i ? "false" : "true");
    });
    dots.forEach((d, k) => {
      d.classList.toggle("is-on", k === i);
      // ⚠️ AND WHICH OFFER IS SHOWING IS SAID (v598) — the review dots have done this since v597.
      if (d.setAttribute) d.setAttribute("aria-pressed", k === i ? "true" : "false");
    });
  }

  // Stand the turning down. There is no fade to undo any more — the move is a CSS transition
  // on the slides themselves, so a repaint landing mid-move cannot leave a blank strip behind.
  function stopTurn() {
    if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
  }

  // Arm the turning from scratch. Called on every repaint, so there is never a
  // second timer — and no timer at all when there is nothing to turn to.
  function armTurn() {
    stopTurn();
    if (!promoToday || !turnsAtAll(liveCodes.length)) return;
    turnTimer = setInterval(() => {
      if (!mayTurn()) return;
      // ⚠️⚠️ THE TURN IS COUNTED AND ANY THROW IS CAUGHT, AND THAT CLOSES A HOLE IN MY OWN
      // REASONING. `showSlide` sets `codeAt` on its FIRST line, so watching `showing` flip
      // proves only that the callback ran — **NOT that the rest of `showSlide` completed.**
      // A throw after that line produces every symptom she reported: the number changes, the
      // classes never do, and the words on screen never move. Catching it here means either
      // it is fine (and `turns` climbs) or the message is printed in the debug line instead
      // of vanishing into the console of a phone nobody is looking at.
      try {
        showSlide(standingNext(liveCodes.length, codeAt));
        turnsDone += 1;
      } catch (e) {
        lastTurnError = String((e && e.message) || e);
      }
    }, TURN_MS);
  }

  // A repaint must not throw the code the customer is reading back to the top of
  // the list. The order is kept while the offers themselves are unchanged; the
  // day one is added, ended or paused, the strip starts again from the first.
  function sameOffers(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i].code !== b[i].code) return false;
    return true;
  }

  if (promoToday) {
    // ⚠️ THE LATCH IS ONLY SET WHERE A POINTER CAN HOVER (v320) — see `canHover` above.
    // On a touch screen these listeners are never attached, so a finger cannot hold the
    // strip for ever. `matchMedia` is read ONCE here rather than per event: it is a
    // constant of the device, and a second read could disagree with the first.
    if (canHover()) {
      promoToday.addEventListener("pointerenter", () => { overStrip = true; });
      promoToday.addEventListener("pointerleave", () => { overStrip = false; });
    }
    // Belt and braces for the exact case she reported — "move the mouse outside the window,
    // the flip should be back". A pointer that leaves the whole document without passing
    // through the strip's own leave event must not leave the turn held for ever. These only
    // ever CLEAR the latch, so they are safe to keep on every device.
    document.addEventListener("pointerleave", () => { overStrip = false; });
    document.addEventListener("pointercancel", () => { overStrip = false; });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopTurn();
      else armTurn();
    });
  }

  // ⚠️ `?debug=offers` — ONE LINE THAT SAYS WHY THE STRIP IS OR IS NOT TURNING.
  //
  // IT EXISTS BECAUSE I COULD NOT SEE HER PHONE, and saying "verified" three times without
  // ever watching it move is how two versions in a row were handed over broken. Every check
  // I could make was on a browser pane that reports itself HIDDEN, and a hidden tab runs no
  // animation at all — so my readings could only ever be about where things ENDED UP.
  //
  // With this, the next report is a reading rather than a guess. It appears **only** when
  // the shop's address carries `?debug=offers`, so no customer ever sees it.
  if (promoToday && (() => {
    const q = String((typeof location !== "undefined" && location.search) || "");
    return q.indexOf("debug=offers") > -1;
  })()) {
    const node = el("p", { class: "promo-debug" });
    // ⚠️ WHAT IT PRINTS IS CHOSEN TO SPLIT THE FAULT IN TWO, because her reading already did
    // that much: **`showing` FLIPS, so `showSlide` IS running and the classes ARE being
    // toggled — and the text on screen never changes.** So the next question is whether the
    // panels MOVE (a drawing fault) or never move at all (the transform is being ignored),
    // and whether the two panels are even the same height (a short panel parked at
    // `translateY(100%)` of ITSELF only moves its own little height, so it never leaves the
    // window the tallest panel sized).
    //
    // It is deliberately ONE line: she reads it off a phone screen.
    const paint = () => {
      const cls = slides.map((s) => (s.classList.contains("is-on") ? "on"
        : s.classList.contains("is-left") ? "left" : "-")).join(",");
      const y = slides.map((s) => {
        const m = getComputedStyle(s).transform.match(/-?[\d.]+/g);
        return m ? Math.round(Number(m[5])) : 0;
      }).join(",");
      const tall = slides.map((s) => Math.round(s.getBoundingClientRect().height)).join(",");
      const box = promoRotor ? Math.round(promoRotor.getBoundingClientRect().height) : 0;
      node.textContent =
        `offers ${liveCodes.length} · timer ${turnTimer ? "armed" : "OFF"}`
        + ` · pause ${overStrip ? "ON" : "off"} · hover ${canHover() ? "yes" : "no"}`
        + ` · tab ${document.hidden ? "hidden" : "visible"}`
        + ` · showing ${codeAt} · lit ${litAt} · cls ${cls} · y ${y} · h ${tall} in ${box}`
        + ` · turns ${turnsDone}${lastTurnError ? ` · ERR ${lastTurnError}` : ""}`;
    };
    paint();
    setInterval(paint, 500);
    if (promoToday.parentNode) promoToday.parentNode.insertBefore(node, promoToday.nextSibling);
  }

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
  //
  // EVERY ONE OF THEM, not just the first (v292). This was `.find()`, which took
  // the first live public code and dropped the rest without a word — so a bakery
  // running three offers advertised one and hid two behind it. The turning is
  // below; this is only the choosing, and it is pure so it is judged here rather
  // than by looking at a phone.
  function standingCodes() {
    return standingToday(publishedCodes(), dateKey(new Date()));
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
    // ★★★ A CODE THE PAGE HAS ALREADY JUDGED IS JUDGED AGAIN (v549).
    //
    // ⚠️⚠️ The refusal was stored ONCE and reprinted on every repaint, with the shortfall frozen into
    // it — ⭐ **so "Add RM14.00 more to use it" stayed on screen after the customer had added the RM14**,
    // and the code they qualified for was never applied. ⚠️ And a **`?promo=` link** is judged at boot,
    // before the codes have arrived, so a perfectly good code was refused and **never looked at again**
    // even when the codes landed a second later. ⭐ The applied code has always been re-judged here; the
    // REFUSED one was not, which is the same rule applied to half the page.
    const boxed = promoInput ? tidyCode(promoInput.value) : "";
    if (promoRefusal && boxed) {
      const again = judge(boxed, total);
      if (again.kind === "no") promoRefusal = again;
      else { promoApplied = again.code; promoRefusal = null; }
    }

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
      const list = promoApplied ? [] : standingCodes();
      // Keep the offer the customer is already reading across a repaint — this runs
      // on every cart change — and start from the top only when the offers themselves
      // have changed. The SLIDES are rebuilt only then too: rebuilding them on every
      // cart change would restart their cross-fade under a customer who did nothing.
      const changed = !sameOffers(list, shownCodes);
      if (changed) codeAt = 0;
      liveCodes = list;
      shownCodes = list.slice();
      promoToday.hidden = !list.length;
      if (!list.length) {
        stopTurn();
        if (promoRotor) promoRotor.replaceChildren();
        if (promoDots) promoDots.replaceChildren();
        slides = [];
        dots = [];
        litAt = -1;
        codeAt = 0;
      } else {
        if (changed || !slides.length) buildSlides(list);
        if (codeAt >= list.length) codeAt = 0;
        showSlide(codeAt);
        armTurn();
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
    // ★★ AND THE SAME FACT IS SAID AGAIN AT THE BUTTON (v408). Her words: __"If there is promo
    // coupon attached, say it on top of Place Order"__.
    //
    // ⭐ The line under the code box already says the code will come off at the confirmation, and
    // it is UP THE PAGE. Here the customer is looking at ONE figure — the total on the bar, which
    // is the GOODS and is never discounted (see renderBar) — and this is the moment they commit.
    // ⚠️ THE CODE IS NAMED BACK TO THEM, because "your code" is abstract ten minutes into a page.
    // ⚠️ IT IS HIDDEN UNLESS A CODE IS ACTUALLY ON THE ORDER, so an ordinary order's bar is the
    // bar it has always been, and nothing is added to its height.
    if (promoBar) {
      promoBar.hidden = !promoApplied;
      promoBar.textContent = promoApplied ? sub(t("promoBar"), promoApplied) : "";
    }
    // ⚠️⚠️ AND THE SPACER THAT STOPS THE FIXED BAR EATING THE PAGE MUST GROW WITH IT. `.bar-spacer`
    // is a measured 126px — right for the bar's TWO rows, and wrong the moment a third appears.
    // ⭐ Measured HERE rather than guessed again, because the third row's height is not one number:
    // it depends on the language and on the width, which is exactly how the 126px reading was
    // arrived at (see app.css) and exactly the sort of reading that goes stale in silence.
    syncBarSpacer();
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

  const renderMenuCards = () => {
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
    // ★★ WHAT A PRODUCT OFFERS ON THIS DAY, COMPUTED ONCE (v638). ⚠️ The card needs it, and "add my last
    // order again" needs the very same answer — **two computations of one rule is how a reorder came to be
    // able to add something the card says is sold out.** ⭐ One function, two readers.
    const offerOf = (p) => {
      const { closed, kept, shown } = menuGate(p);
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
      return { shown, group, caps, reason, unavailable, left, qty, soldOut: left != null && left <= 0 };
    };

    offerByName = (name) => {
      const hit = (CONFIG.products || []).find((x) => x && x.name === name);
      return hit ? offerOf(hit) : null;
    };

    const cardFor = (p) => {
      const facts = offerOf(p);
      if (!facts.shown) return null;
      const { reason, unavailable, left, qty, soldOut } = facts;
      // ⚠️ THE UPPER BOUND IS DECLARED UP HERE NOW (v458) — above the typed box as well as the "+". It used
      // to sit between the two buttons, which was fine while "+" was the only thing that wanted it.
      const cap = left != null && left > 0 ? left : 99;
      // ★★★ AND THE QUANTITY CAN BE TYPED, NOT ONLY PRESSED (v458). Her words: __"for qty field i should be
      // allow to key in qty also instead of just press the + & -"__ — ⭐ **a customer ordering twenty is
      // twenty presses, and on this phone, with the loaf in his other hand, that is the whole sale.**
      // ⚠️⚠️ AND TYPING MUST NOT REBUILD THE CARD. `redraw()` below ends in `renderMenu()`, which rebuilds
      // this row — so repainting on every keystroke would delete the box out from under his thumb and eat
      // the second digit. ⭐ **That is the fault she reported on the PO card and on the Refund box**, and it
      // is the one this file's own note-box code was already written to avoid (see `redraw`, below).
      // ⭐ THE BASKET IS UPDATED ON EVERY KEYSTROKE, so the count and the total at the bottom keep up; only
      // the REBUILD waits until he has finished with the box.
      const qtyBox = el("input", {
        class: "stepper-val", type: "number", inputmode: "numeric", min: "1", max: String(cap),
        step: "1", value: String(qty), "aria-label": t("qtyAria"),
        oninput: function () {
          // ⚠️⚠️ AND THE BAKE DAY COMES FIRST HERE TOO (v458) — **this is the line that touches the basket,
          // and the guard was only on `onchange` below.** ⭐ My own test caught it: a customer could TYPE
          // bread into the basket with no day chosen, because `change` does not fire until he leaves the
          // box — by which time the item was already in and the lock had been walked straight past.
          // ⭐ **A typed number is the same act as a tap, and v454 refused the tap.**
          if (!dayPicked) { sayStepFirst("needDayTitle", "needDayBody", "step1"); return; }
          const n = parseInt(this.value, 10);
          if (!Number.isFinite(n) || n < 1) return;   // ⚠️ an empty box mid-edit is not an order for zero
          cart.set(p.name, Math.min(cap, n));
          renderBar();
          paintSteps();
        },
        // ⚠️ AND WHEN HE IS DONE, IT SETTLES — and the BAKE DAY COMES FIRST, exactly as the two presses
        // have it since v454. **A typed number is the same act as a tap, and a step that refuses one must
        // refuse the other**, or the lock would have a door in it that nobody had noticed.
        onchange: function () {
          if (!dayPicked) {
            sayStepFirst("needDayTitle", "needDayBody", "step1");
            this.value = String(cart.get(p.name) || 0);
            return;
          }
          const n = Math.max(1, Math.min(cap, Math.round(Number(this.value) || 1)));
          cart.set(p.name, n);
          this.value = String(n);
          redraw();
        },
      });
      // ⚠️ AND THE CARD HE TOUCHED IS NO LONGER WHERE A MISSING BAKE DAY IS SPOKEN ABOUT (v493) — the
      // sentence belongs to STEP 1 and the page is carried to it, so the `here()` thunk that used to find
      // this product's card is gone with the rest of the "speak where he is looking" machinery.
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
        // ⚠️ AND AFTER A QUANTITY CHANGE TOO — step 2 turns green the moment the basket stops being
        // empty, which happens here and not in `rerender`.
        paintSteps();
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
      const dec = el("button", { class: "step-btn", "aria-label": t("qtyLess"), onclick: () => {
        const q = Math.max(0, (cart.get(p.name) || 0) - 1);
        if (q === 0) cart.delete(p.name); else cart.set(p.name, q);
        qtyBox.value = String(q);
        redraw();
      } }, "−");
      const inc = el("button", { class: "step-btn", "aria-label": t("qtyMore"), onclick: () => {
        // ★★★ STEP 1 BEFORE STEP 2 IS ALLOWED (v453) — HER OWN MODEL, WHICH I BUILT THE WRONG SHAPE OF
        // FIRST TIME. Her words: __"complet step1 before step2 is allow, and so forth"__ — then, asked how
        // a locked step should read: __"dont allow and a message inform about why"__.
        //
        // ⚠️⚠️ SO IT IS NOT A MESSAGE ON PLACE ORDER — it is the STEP refusing, and saying why. My earlier
        // version let him load the basket in any order and only told him at the end, which **reports a
        // problem instead of preventing it** — and that is not what she asked for.
        // ⭐ AND A LOCKED CONTROL THAT EXPLAINS ITSELF is the whole of her instruction: "dont allow" is the
        // lock, "a message" is why it is not a dead end.
        // ★★★ STEP 1 BEFORE STEP 2 IS ALLOWED (v454) — THE LINE THAT MAKES IT A GATE, NOT A MESSAGE.
        // ⚠️⚠️ HER WORDS, AND SHE ASKED TWICE: __"complet step1 before step2 is allow, and so forth"__ ·
        // __"dont allow and a message inform about why"__ · __"ask user to tap on the bake day to confirm
        // it"__. ⭐ **`sayStepFirst` was defined and NEVER CALLED** — the helper, the three message pairs and
        // the comment above all sat here as DEAD CODE, which is why the shop behaved as if none of it existed.
        if (!dayPicked) { sayStepFirst("needDayTitle", "needDayBody", "step1"); return; }
        const q = Math.min(cap, (cart.get(p.name) || 0) + 1);
        cart.set(p.name, q);
        qtyBox.value = String(q);
        redraw();
      } }, "+");
      // ⚠️ AND THE TYPED BOX IS DISABLED WITH THEM (v458) — **a sold-out card whose number could still be
      // typed into would be a door beside a locked gate**, and the two presses already refuse.
      if (soldOut) { dec.disabled = true; inc.disabled = true; qtyBox.disabled = true; }
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
              dayPicked = true;      // and they asked for it, so step 1 is theirs (v434)
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
          // ★★ THE ITEM AS A ROW (v633_2): what it is on the left, what it costs and how many on the right.
          // ⚠️ THE PRICE MOVED OUT OF THE UNIT LINE and gained its own weight — `RM16.00 / loaf` read as one
          // quiet fact, and a price is the third thing a customer looks for. The unit stays beside the name,
          // where it describes the bread rather than the money.
          el("div", { class: "card-head" },
            el("div", { class: "card-words" },
              el("p", { class: "card-title" }, nameFor(p, lang)),
              el("p", { class: "card-sub" }, unitFor(p, lang)),
              stamp,
              desc ? el("p", { class: "prod-desc" }, desc) : null,
              // ★★ THIS PRODUCT'S OWN FACTS (v639) — ⚠️ her words, drawn only when she has written them, and
              // labelled so a customer knows what they are reading. Blank means no line at all: the shop must
              // never fill a food fact in itself.
              p.allergens ? el("p", { class: "prod-fact" },
                `${t("allergenLabel")}: ${String(p.allergens).trim()}`) : null,
              p.keeping ? el("p", { class: "prod-fact" },
                `${t("keepingLabel")}: ${String(p.keeping).trim()}`) : null),
            el("div", { class: "card-side" },
              el("p", { class: "card-price" }, `RM${p.price.toFixed(2)}`),
              el("div", { class: "stepper" }, dec, qtyBox, inc))),
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
      // ⚠️⚠️ WHEN THERE IS NO MENU AT ALL, "PICK ANOTHER DAY" IS WRONG ADVICE (v598). ⚠️ An emptied published
      // product list is adopted since v581, so every visitor was told to pick another bake day — ⚠️ **no day
      // would help.** ⭐ Two sentences: a day that is full, and a menu that is empty.
      menu.replaceChildren(el("p", { class: "card-sub" },
        (CONFIG.products || []).length ? t("noMenuToday") : t("noMenu")));
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

  // ⚠️⚠️ `placeStepNote` USED TO LIVE HERE, AND v493 RETIRED IT. It re-hung the refusal line inside the
  // menu after every rebuild, because v459 had put the line directly above a product card — **and the card
  // is rebuilt from scratch on every quantity change, which is what took the line with it**: her report was
  // __"if i press -, the warning disappear and never come back again??"__, and the fix held the node and put
  // it back by the product's name.
  // ⭐ **The line now lives under a step HEADING, and no repaint touches the headings — so the machinery
  // that existed only to survive a rebuild is gone rather than left to look load-bearing.** The held node
  // (`stepNoteEl`) stays; the re-hanging does not need to.
  const renderMenu = () => renderMenuCards();

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

  // ★★ "YOUR LAST ORDER" (v638) — the regular's way back in, and the reassurance that comes with it.
  // ⚠️ It offers only what TODAY allows: `planReorder` asks `offerByName` — the same answer the cards draw —
  // and anything the shop would refuse is NAMED, not silently dropped. ⭐ And it says where the memory lives,
  // because a shop that remembers you should say so, and give you the way out in the same breath.
  function renderAgain() {
    const slot = document.getElementById("again-slot");
    if (!slot) return;
    lastBasket = readLastBasket(shopStorage());
    if (!lastBasket) { slot.replaceChildren(); return; }
    const lines = lastBasket.items.map((i) => {
      const prod = (CONFIG.products || []).find((x) => x && x.name === i.name);
      return `${prod ? nameFor(prod, loadLang()) : i.name} ×${i.qty}`;
    });
    slot.replaceChildren(el("div", { class: "card again-card" },
      el("p", { class: "card-title" }, t("againTitle")),
      el("p", { class: "card-sub" }, lines.join(" · ")
        + (lastBasket.at ? ` — ${sub(t("againWhen"), fmtDay(new Date(`${lastBasket.at}T00:00:00`)))}` : "")),
      el("div", { class: "again-actions" },
        el("button", {
          type: "button", class: "again-add",
          onclick: () => {
            // ⚠️ THE DAY COMES FIRST, exactly as it does for a stepper press (v454): a basket for a day he has
            // not chosen is the door beside the gate that the step lock exists to close.
            if (!dayPicked) { sayStepFirst("needDayTitle", "needDayBody", "step1"); return; }
            const plan = planReorder(lastBasket, offerByName);
            for (const a of plan.add) cart.set(a.name, a.qty);
            renderMenu();
            renderBar();
            paintSteps();
            if (plan.skipped.length) {
              menuNotice(plan.skipped.map((s) => sub(t(s.why === "gone" ? "againGone" : "againFull"), s.name)).join(" "));
            } else if (plan.add.length) {
              menuNotice(sub(t("againAdded"), plan.add.length));
            }
          },
        }, t("againAdd")),
        el("button", {
          type: "button", class: "again-forget",
          onclick: () => { forgetLastBasket(shopStorage()); renderAgain(); },
        }, t("againForget"))),
      el("p", { class: "card-sub again-saved" }, t("againSaved"))));
  }

  function reconcileCart() {
    const notes = [];
    if (!selected) {
      const box = document.getElementById("menu-note");
      if (box) { box.hidden = true; box.replaceChildren(); }
      return notes;
    }
    // ★★★ A PRODUCT THAT LEFT THE MENU LEAVES THE BASKET TOO (v548).
    // ⚠️⚠️ The menu is replaced wholesale on the 30-second refresh. When the bakery renamed or removed a
    // product, the card vanished and **the basket kept the old name** — so at Place order `lines` came out
    // EMPTY while step ② still read done, `refuseAtFirstMissing` found nothing to name, ⭐ **and the press
    // did nothing at all: no order, no message, no idea.** ⭐ A basket that cannot become an order must
    // empty itself and say why.
    for (const [name, q] of [...cart]) {
      if ((q || 0) <= 0) continue;
      if (!CONFIG.products.some((p) => p.name === name)) {
        cart.delete(name);
        notes.push(sub(t("fixGone"), name));
      }
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

  // ⚠️⚠️ THE DAY THE CUSTOMER TAPPED, SO FOCUS CAN GO BACK TO IT (v593). ⚠️ The tap rebuilds the whole grid,
  // and `replaceChildren` removes the focused cell — ⚠️ **focus fell to the body and the next Tab started at the
  // top of the page.** ⭐ The rebuilt cell with the same date takes the keyboard.
  let focusIso = null;

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
  // ★★ THE FULL DAY THE CUSTOMER TAPPED (v631_2), a YYYY-MM-DD key or null. ⚠️ MEASURED: a day with no
  // pans left was a struck-through number **and a dead tap** — the customer could not tell whether the shop
  // was closed, broken, or simply full, and nothing told them the next day they could have bread. ⭐ It is
  // remembered here rather than on the day's record so a live refresh (which rebuilds every cell) keeps the
  // answer on screen until the customer taps elsewhere.
  let fullIso = null;

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
    // ⚠️ AND THE DAY THEY PICKED GOING IS THE DAY THEY HAVE NOT PICKED (v434): the choice they made
    // is no longer on offer, so the next open day stands in FOR them — and step 1 does not claim
    // they chose it. Everything else about this fallback is untouched.
    if (selected && !specs.some((s) => dateKey(s.date) === selected && !s.soldOut)) { selected = null; dayPicked = false; }
    if (!selected) selected = open.length ? dateKey(open[0].date) : null;

    if (!specs.length) {
      // ⚠️ AND A STALE DAY IS NOT FOCUSED LATER (v597) — the key is cleared wherever the grid cannot draw it.
      focusIso = null;
      dateWrap.replaceChildren(el("p", { class: "muted" }, t("noDates")));
      return;
    }
    if (!open.length) {
      focusIso = null;   // ⚠️ the same rule as the branch above (v598)
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
      // ★★ A FULL DAY SAYS SO IN A WORD, BELOW THE NUMBER (v631_2). ⚠️ The strike-through alone left three
      // states looking alike — open, full and not a bake day — and a word survives a customer who cannot tell
      // the colours apart. ⚠️ It sits UNDER the number, never over it: the date is what the customer came to read.
      if (full && !past) kids.push(el("span", { class: "cal-stamp", "aria-hidden": "true" }, t("calFull")));
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
      // ★★ AND A FULL DAY IS A PRESS TOO (v631_2). ⚠️ It was a `<span>` — a dead tap on a day a customer can
      // clearly see something is wrong with. ⭐ It still chooses nothing; it ANSWERS and names the next day.
      // ⚠️⚠️ EVERY DAY WAS A BUTTON WHOSE ONLY NAME WAS ITS NUMBER (v583) ⭐ The name is the date a person says.
      const dayName = fmtDay(new Date(`${iso}T00:00:00`));
      if (open || named || askable || closed || (full && !past)) {
        return el("button", {
          class: cls + (open || askable || closed || (full && !past) ? " tappable" : "")
            + (named ? " tippable" : "") + (full && !past ? " tapfull" : ""),
          "aria-label": full ? `${dayName}, ${t("soldOut")}` : dayName,
          "aria-pressed": isSel ? "true" : "false",
          dataset: { iso },
          onclick: () => {
            if (named) tipIso = iso;
            // ⚠️ ONE ANSWER AT A TIME: choosing an open day puts the full day's note away, and asking about a
            // full day does not steal the chosen day from him.
            if (full && !past) fullIso = iso;
            else fullIso = null;
            if (open) { selected = iso; dayPicked = true; } // their own tap (v434)
            // Choosing a real day takes the answer away with it; asking about
            // another day it cannot take replaces it. The one tap can never be
            // both, because a day she posts is not askable.
            missIso = askable || closed ? iso : null;
            missClosed = closed;
            focusIso = iso;
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
        // ★★★ WHAT THE GREEN CIRCLE MEANS (v512). Her words: __"simple note that date in green circle are
        // bake dates"__.
        // ⚠️⚠️ THE SYMBOL WAS NEVER EXPLAINED ANYWHERE. A customer met a month of dates where some wear a
        // green ring and some do not, and the only thing that said what the ring meant was the day he
        // finally TAPPED, in the line below. ⭐ **A symbol a stranger has to tap to decode has not been
        // explained** — and this is the one fact the whole grid turns on.
        // ⚠️ The ring is DRAWN beside the words (`.cal-key-dot`) rather than only named, so the sentence
        // and the thing it describes cannot drift apart, and it is `aria-hidden` so a screen reader reads
        // the words alone rather than an empty span.
        el("p", { class: "cal-key" },
          el("span", { class: "cal-key-dot", "aria-hidden": "true" }),
          t("calKey")),
        // The day, in words — the one line under the grid. ⚠️ AND IT SAYS WHICH OF THE TWO
        // HAPPENED (v434). A day is always chosen here, but only sometimes BY HIM: the first open
        // day is picked for him so an order is never blocked by forgetting to tap, and **a page
        // that does something on his behalf has to say so** rather than let a highlight imply he
        // did it. Her words: __"say, moonday was selectted for you, just click on the prefered
        // date if you have one"__.
        el("p", { class: "cal-chosen" },
          dayPicked
            ? sub(t("calChosen"), fmtDay(new Date(`${selected}T00:00:00`)))
            : sub(t("calChosenFor"), fmtDay(new Date(`${selected}T00:00:00`)))),
        // ★★ A DAY THEY TAPPED THAT IS FULL ANSWERS THEM (v631_2); otherwise the line names every full day in
        // the window. ⚠️ ONE AT A TIME: two sentences about the same day would read as two different facts.
        fullIso ? fullNote(specs, weeks) : soldOutLine(specs, new Set(weeks.flat())),
        // The answer to a tap the grid could not act on, last because it is the reply to what they just did.
        missNote(specs)));
    // ⚠️⚠️ AND THE DAY THE CUSTOMER TAPPED TAKES THE KEYBOARD BACK (v593). ⚠️ `replaceChildren` removed the
    // cell that had focus — ⚠️ **it fell to the body and the next Tab started at the top of the shop.** ⭐ The
    // rebuilt cell for the same date is focused, without scrolling.
    if (focusIso) {
      const want = focusIso;
      focusIso = null;
      const node = dateWrap.querySelector && dateWrap.querySelector(`[data-iso="${want}"]`);
      if (node && typeof node.focus === "function") {
        try { node.focus({ preventScroll: true }); } catch { node.focus(); }
      }
    }
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

  // ★★ "TELL ME WHEN THIS DAY FREES" (v648). ⚠️ The number is the only thing that matters — a name is optional
  // and the day is the one they tapped. ⭐ Every refusal says which thing is wrong, in the place they pressed.
  function waitForm(iso, dayText) {
    const store = shopStorage();
    if (!iso) return null;
    if (hasAsked(store, iso)) {
      return el("p", { class: "full-note-next", style: "margin:10px 0 0" }, t("waitAlready"));
    }
    const name = el("input", { class: "input", type: "text", maxlength: "60", placeholder: t("waitName") });
    const phone = el("input", { class: "input", type: "tel", inputmode: "tel", placeholder: t("waitPhone") });
    // ⚠️ SET AS A PROPERTY (v643's rule): in this file `el()` writes attributes, so `hidden: true` would work
    // but `hidden: false` would not — one spelling, so nobody has to remember which values are safe.
    const said = el("p", { class: "full-note-next", style: "margin:8px 0 0" });
    said.hidden = true;
    const say = (text) => { said.textContent = text; said.hidden = false; };
    const ask = el("button", {
      type: "button",
      class: "full-note-go",
      style: "margin-top:8px",
      onclick: async () => {
        const row = waitRow({ day: iso, name: name.value, whatsapp: phone.value }, waNumber);
        if (!row) return say(t("waitBad"));
        ask.disabled = true;
        const ok = await postWait(row);
        ask.disabled = false;
        if (!ok) return say(t("waitFail"));
        rememberAsked(store, iso);
        ask.hidden = true; name.hidden = true; phone.hidden = true;
        say(t("waitDone"));
      },
    }, t("waitAsk"));
    return el("div", { class: "wait-ask" },
      el("p", { class: "full-note-say", style: "margin:12px 0 6px" }, t("waitTitle")),
      el("div", { style: "display:grid;gap:6px" }, name, phone),
      ask, said);
  }

  // ⚠️ WRITE-ONLY, and it answers true only when the row really landed — a waitlist request that silently
  // vanished is a customer who thinks she was told.
  async function postWait(row) {
    const sb = CONFIG.supabase || {};
    const base = String(sb.url || "").replace(/\/+$/, "");
    if (!base || !sb.anonKey) return false;
    try {
      const res = await fetch(`${base}/rest/v1/waitlist`, {
        method: "POST",
        headers: { apikey: sb.anonKey, Authorization: `Bearer ${sb.anonKey}`, "Content-Type": "application/json",
          Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      return !!(res && res.ok);
    } catch { return false; }
  }

  // ★★ WHAT A TAPPED FULL DAY ANSWERS (v631_2). Her rule that a control which cannot act must say why, in the
  // place it was tapped — and a customer's real question is not "why can't I?" but **"when can I?"**, so the
  // next open day is named AND offered as a press. ⚠️ `next` is read from the SAME `specs` the grid is drawn
  // from, so the day named here and the day that gets chosen cannot disagree.
  function fullNote(specs, weeks) {
    // ⭐ ONE RULE, ONE CALLER: `fullDayAnswer` says whether the day is still full and which day comes next.
    const answer = fullDayAnswer(specs, fullIso);
    // The day stopped being full (a cancellation, a refresh) — say what the window actually holds.
    if (!answer.full) {
      fullIso = null;
      return soldOutLine(specs, new Set(weeks.flat()));
    }
    const day = fmtDay(new Date(`${fullIso}T00:00:00`));
    // ⭐ THE SAME RULE THE PRESS USES — one search, so the day named and the day chosen cannot differ.
    const next = answer.next;
    return el("div", { class: "full-note", role: "status" },
      el("p", { class: "full-note-say" }, sub(t("fullDaySay"), day)),
      el("p", { class: "full-note-next" },
        next ? sub(t("fullDayNext"), fmtDay(next.date)) : t("fullDayNone")),
      next
        ? el("button", {
          type: "button",
          class: "full-note-go",
          onclick: () => {
            selected = dateKey(next.date);
            dayPicked = true;   // their own choice, made by pressing this
            fullIso = null;
            rerender();
          },
        }, sub(t("fullDayChoose"), shortDay(dateKey(next.date))))
        : null,
      // ★★ "TELL ME WHEN THIS DAY FREES" (v648) — P5, the customer plan's last level.
      // ⚠️ IT IS WRITE-ONLY: the shop may ADD a request and can never read the list back, because every row is
      // somebody else's number (see supabase/waitlist.sql). ⚠️ And one ask per day per phone, latched here, so a
      // second press cannot fill her list.
      waitForm(fullIso, day));
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
  // ★★ THE CIRCLES TURN GREEN AS THE CUSTOMER FINISHES (v406).
  //
  // ⚠️⚠️ HER WORDS, AFTER THE TRIAL WENT OUT: __"the 1,2,3 turn green after customer done with it"__.
  // **I had drawn the green state and never wired it** — the rule was in `app.css` from the first day and
  // nothing ever set the class, so the circles stayed terracotta through the whole order. ⭐ A step marker
  // that never moves is decoration, and decoration is what this was supposed to replace.
  //
  // ⚠️ EACH STEP IS DONE BY SOMETHING THE CUSTOMER DID, not by a screen being reached: a day is chosen, a
  // basket has something in it, and their name and number are filled in. ⚠️ The third turns green as they
  // finish typing it — which is the moment before they press Place order, which is exactly when a nervous
  // customer wants to be told they have done everything.
  // ★★ WHICH STEPS ARE DONE — ONE RULE, TWO READERS (v493).
  //
  // ⚠️⚠️ HER WORDS: __"when step 1 is skip, it should always go back to step1"__. ⭐ **That is a rule about
  // the FIRST thing missing, not about the control he happened to press** — and until this version each
  // refusal named the step its own control belonged to, so a customer who had not chosen a bake day and
  // pressed a DELIVERY CARD was sent to step 2, and one who pressed PLACE ORDER was sent to step 2 as well.
  // ⭐⭐ **He would be told about step 2 while step 1 was the thing he had not done.**
  //
  // ⚠️ AND IT IS THE SAME QUESTION THE CIRCLES ALREADY ASK. The `done` list below was computed inside
  // `paintSteps` and read by nothing else — **so the circles could say "step 1 is not done" while the
  // sentence on the screen named step 2.** ⭐ One rule with two readers is the only way those two can never
  // disagree, and this file has already paid for splitting one fact across two places (v427: a duration in
  // CSS and a moment in JS).
  // ★★ THE FOUR STEPS AS A BAR (v633_2). ⚠️ THE LABELS ARE READ FROM THE STEP HEADINGS THEMSELVES — never
  // typed a second time here — so the bar cannot name a step differently from the step under it, and each of
  // the three languages arrives with its own heading. ⚠️ The words are rewritten only when a heading's text has
  // actually changed (a language switch), because rebuilding the bar on every stepper press would restart the
  // page's layout for a line that has not moved.
  function paintStepBar(done) {
    const bar = document.getElementById("stepbar");
    if (!bar || typeof bar.replaceChildren !== "function") return;
    // ⚠️ THREE OF THE FOUR STEPS HAVE A HEADING; THE FOURTH IS THE PLACE ORDER PRESS ITSELF — her own layout
    // ("number 4 should not be inside the button, it should sit beside"), so its words come from the button.
    const heads = [1, 2, 3].map((n) => document.querySelector(`#step${n} h2`))
      .concat([document.getElementById("order-btn")]);
    if (heads.some((h) => !h)) return;
    const words = heads.map((h) => String(h.textContent || "").trim());
    const shown = [...bar.children].map((n) => n.textContent);
    if (!shown.length || shown.join("\u0000") !== words.join("\u0000")) {
      bar.replaceChildren(...words.map((w) => el("span", { class: "stepbar-item" }, w)));
    }
    const current = done.findIndex((d) => !d);
    [...bar.children].forEach((n, i) => {
      n.className = "stepbar-item" + (done[i] ? " done" : "") + (i === current ? " on" : "");
    });
  }

  function stepsDone() {
    const nameEl = document.getElementById("name-input");
    const waEl = document.getElementById("whatsapp-input");
    // ★★ AND THE THIRD STEP IS NOT DONE UNTIL HE HAS SAID HOW HE IS GETTING IT (v415). Her words:
    // __"only by clicking either self collect or delivery, the number 3 change color"__.
    // ⚠️⚠️ IT CANNOT BE READ OFF THE METHOD ITSELF — that is set to Self collect the moment the page
    // loads, so a rule that asked "is a method chosen" would be true before a customer had touched
    // anything. ⭐ **What it asks is whether HE chose**, which is the same distinction the places
    // above now keep: **the page does not credit him with a choice he did not make.**
    const fulfilled = document.getElementById("fulfillment");
    return [
      // ⚠️⚠️ `dayPicked`, NOT `!!selected` (v434). A day is ALWAYS selected — the first open one is
      // chosen for him on load — so asking "is a day selected" turned this circle green before he
      // had touched anything, and it was the only one of the three that did. **All three now read
      // the same question: has HE done this?** That is the rule step 3 below already kept, and the
      // reason the three circles carry one colour until he starts.
      dayPicked,
      cart.size > 0,
      !!(fulfilled && fulfilled._picked === true)
        && !!(nameEl && String(nameEl.value || "").trim())
        && !!(waEl && String(waEl.value || "").trim()),
    ];
  }

  // ⭐ THE FIRST STEP THAT IS NOT DONE, and `null` when there is nothing left to do.
  // ⚠️⚠️ IT IS THE ONLY PLACE THAT ANSWERS THIS QUESTION. Every refusal in this shop goes through it, so a
  // press can never be answered with a step later than the one that is actually outstanding — her rule:
  // __"when step 1 is skip, it should always go back to step1"__.
  function firstMissingStep() {
    const done = stepsDone();
    for (let i = 0; i < done.length; i++) if (!done[i]) return `step${i + 1}`;
    return null;
  }

  // ⭐ AND EACH STEP REFUSES IN ITS OWN WORDS — the sentence belongs to the step, so the WORDS have to be
  // chosen by the same answer that chose the step.
  const STEP_SAY = {
    step1: ["needDayTitle", "needDayBody"],
    step2: ["needItemTitle", "needItemBody"],
    step3: ["fulfilAskTitle", "fulfilAskBody"],
  };
  function refuseAtFirstMissing() {
    const step = firstMissingStep();
    if (!step) return false;              // ⚠️ nothing is missing — there is nothing to refuse
    const [titleKey, bodyKey] = STEP_SAY[step];
    sayStepFirst(titleKey, bodyKey, step);
    return true;
  }

  function paintSteps() {
    const done = stepsDone();
    for (let i = 0; i < done.length; i++) {
      const head = document.getElementById(`step${i + 1}`);
      if (head && head.classList) head.classList.toggle("done", done[i]);
    }
    paintStepBar(done);
    // ★★★ AND THE PREVIOUS ORDER'S RECEIPT GOES THE MOMENT A NEW ORDER BEGINS (v499).
    //
    // ⚠️⚠️ READ OFF THE SHOP'S OWN STATE, IN ONE PLACE, AND WITH NO LISTENER ON ANY CONTROL. ⭐ **Step 1 done
    // (a bake day tapped) or step 2 done (something in the basket) IS the next customer starting** — and
    // `paintSteps` is already the one function every step change funnels through (the day tapped, the ±
    // pressed, a quantity typed, the 30-second refresh), **so there is no eighth call site to forget.**
    // ⚠️ It cannot fire on the order just placed: the reset sets both of them back to false as the receipt
    // goes up. ⚠️ And step 3 needs no rule of its own — it cannot be reached without 1 and 2.
    if (done[0] || done[1]) retirePreviousOrder();
    // ★★★ AND THE STEP'S OWN LINE GOES THE MOMENT HE FIXES IT (v455). ⚠️ **A form error does not outlive
    // its cause** — her words were *"or how a form filling would behave"*, and a line still telling him to
    // pick a day, after he has picked one, would be the page arguing with itself.
    // ⚠️ THE HELD NODE HERE TOO (v460) — a lookup would answer `null` after a rebuild had torn the line out,
    // and this is the code that is supposed to CLEAR it, so it would have cleared nothing.
    // ⚠️⚠️ AND IT ASKS ABOUT THE STEP THE LINE IS ACTUALLY SPEAKING ABOUT (v493). Until this version the
    // test was `dayPicked` — **which is only step 1's question.** ⭐ That was correct while step 1 was the
    // only step that could refuse; the moment the line can speak about step 2 or step 3, **a customer who
    // had already picked his day would have the answer to a step-2 refusal wiped by the next repaint.**
    // ⭐ v455's rule is kept exactly, and scoped to what it was always about: a form error does not outlive
    // ITS cause — which is the step it names, not whichever step happens to be checked first.
    const note = stepNoteEl || document.getElementById("step-note");
    const speakingAbout = stepNoteStep == null ? -1 : Number(String(stepNoteStep).replace("step", "")) - 1;
    if (note && !note.hidden && speakingAbout >= 0 && done[speakingAbout]) {
      note.hidden = true;
      note.classList.remove("on");
      note.replaceChildren();
      stepNoteStep = null;
    }

    // ★★★ AND STEP 3 DOES NOT OPEN UNTIL STEP 2 HAS SOMETHING IN IT (v456). Her words: __"i skip step 2 and
    // filled up step 3, it should not allow me to do step 3 at all?"__ ⚠️⚠️ **and she is right — the first
    // lock was built for one step and stopped, when her instruction was "and so forth".**
    // ⭐ **So his name and number are inert while the basket is empty**, and the page says why rather than
    // letting him fill a form for an order that has nothing in it. ⚠️ **They are DISABLED, which is the
    // honest state — they genuinely cannot be used yet — and the reason is on the page beside them, so this
    // is not the "disabled with no explanation" fault the skill warns about.**
    const fulfilled = document.getElementById("fulfillment");
    const open3 = cart.size > 0;
    for (const id of ["name-input", "whatsapp-input"]) {
      const box = document.getElementById(id);
      if (!box) continue;
      // ★★★ IT LOOKS SHUT, AND IT IS NOT SWITCHED OFF (v461). Her report: __"i do step 3 skipping step 2,
      // it just dont allow, but no warning"__ — ⚠️⚠️ **and there was no warning because the box was
      // `disabled`, and a disabled control never receives the tap at all.** Measured on the live shop
      // before this: tapping the name box did not even move the focus, and the line stayed hid.
      // ⭐⭐ **AND THAT IS v452'S RULE. I QUOTED IT MYSELF TWENTY LINES BELOW, TO JUSTIFY THE TWO DELIVERY
      // CARDS REFUSING INSTEAD OF BEING SWITCHED OFF — AND THEN SWITCHED THESE TWO FIELDS OFF ANYWAY.**
      // ⚠️ **The worst of both, and worse than either: the boxes looked entirely normal in the screenshot
      // AND were dead, so he tapped a box that looked ready and was told nothing.**
      // ⭐ `readonly` is the honest middle — **it still cannot be typed into and it LOOKS shut, and it can
      // be tapped, so it can answer.** A phone does not even raise the keyboard for it.
      box.readOnly = !open3;
      if (box.classList) box.classList.toggle("locked", !open3);
    }
    // ★★★ AND THE TWO DELIVERY CARDS ARE THE SAME STEP, SO THEY OBEY THE SAME LOCK (v456). Her words:
    // __"lock the 2 delivery cards too"__ — ⚠️ **after I had locked only the two boxes she named and not
    // the two cards beside them, which is the "and so forth" of her instruction read too narrowly.**
    // ⚠️⚠️ **IT REFUSES IN WORDS RATHER THAN DISABLING THEM, AND THAT IS v452'S OWN RULE.** This file
    // already settled it, and its test says so out loud — *"the button is dead on an empty basket again —
    // it must answer instead"* — because **a disabled control on a phone does not even acknowledge the
    // tap**, so a customer is told nothing at all. The two cards therefore stay live and say why.
    // ⚠️ AND IT IS A SEAM, NOT A DIRECT CALL: `wireFulfillment` builds the press, and **it cannot see
    // `cart` or `sayStepFirst` — both live in here.** ⭐ The same direction as `_resetFulfillment`,
    // which this file already sends the other way for the same reason.
    if (fulfilled) {
      fulfilled._mayChooseWay = () => cart.size > 0;
      // ⚠️ AND IT TAKES THE CARD THAT REFUSED (v459), so the line lands directly above the card he pressed
      // rather than under a heading a screen or two away — her report, and the whole of this version.
      // ⚠️⚠️ AND IT NAMES THE FIRST STEP THAT IS MISSING, WHICH IS NOT ALWAYS THE CARD'S OWN STEP (v493).
      // Her words: __"when step 1 is skip, it should always go back to step1"__. ⭐ A customer who has not
      // chosen a bake day and presses a delivery card was being sent to step 2 — **told about the basket
      // while the bake day was the thing he had not done.**
      fulfilled._refuseWay = () => refuseAtFirstMissing();
    }
  }
  // ⚠️ AND THE THIRD STEP IS TYPED, NOT TAPPED, so it needs listeners of its own — nothing else on this
  // page fires while a customer fills their name in. ⚠️ They live here, beside the rule they serve,
  // rather than down in the form's own wiring: a listener added in one place for a rule that lives in
  // another is how the two drift.
  for (const id of ["name-input", "whatsapp-input"]) {
    const field = document.getElementById(id);
    if (!field || !field.addEventListener) continue;
    // ★★★ AND IT ANSWERS THE TAP (v461) — **the whole of her report.** ⚠️ A `disabled` box received no tap
    // at all, so it could not say anything; this one is `readonly`, so it can, and the sentence lands
    // directly above the row he touched (v459's rule).
    // ⚠️ BOTH `focus` AND `click`, because on a phone the tap that raises the focus and the click are not
    // the same event everywhere — and `sayStepFirst` is idempotent, so arriving twice costs nothing.
    // ⚠️⚠️ AND IT NAMES THE FIRST STEP THAT IS MISSING (v493), NOT "step 2 because this is a step-3 field".
    // ⭐ Tapping his name with no bake day chosen sends him to STEP 1 now — her words: __"when step 1 is
    // skip, it should always go back to step1"__.
    // ⚠️ AND IT STILL ONLY SPEAKS WHILE THE BOX IS SHUT. The box is held shut on an empty basket (v456),
    // and that is the only state in which it has anything to explain. ⭐ **With an order in the basket the
    // box is open and usable, and tapping it must say nothing** — its own emptiness is `markField`'s
    // business at the moment he tries to place the order, which is where the page already asks for it by
    // name. (Measured: without this guard a customer with one item in the basket and his name already
    // typed was sent to step 3 for tapping a box that was perfectly open.)
    const sayWhyNotYet = () => {
      if (cart.size > 0) return;   // ⚠️ step 2 is done — there is nothing to explain and nothing to block
      refuseAtFirstMissing();
    };
    // ⚠️⚠️ ONE LISTENER EACH, NOT ONE PER RENDER (v461). ⭐ **`render()` runs these lines every time it is
    // called, and the element is the SAME ELEMENT** — so they accumulated. ⭐⭐ Measured in this suite's own
    // page: **73 focus handlers on one box.** ⚠️ **And every one of them closes over the `cart` of ITS OWN
    // render — so the earlier ones answer with a basket that no longer exists**, which is exactly how a
    // step that is already done started telling him off again.
    // ⭐ The verdicts are re-pointed on the element instead, and the ONE listener reads the current one.
    field._sayWhyNotYet = sayWhyNotYet;
    field._paintSteps = paintSteps;
    if (!field._stepWired) {
      field._stepWired = true;
      const onTouch = () => { if (field._sayWhyNotYet) field._sayWhyNotYet(); };
      field.addEventListener("input", () => { if (field._paintSteps) field._paintSteps(); });
      field.addEventListener("focus", onTouch);
      field.addEventListener("click", onTouch);
    }
  }
  // ⭐ The handle the fulfilment picker uses — see `paintStepsForFulfillment` beside `repaintPromo`.
  paintStepsForFulfillment = paintSteps;

  // ★★★ THE DAY THE PAGE WAS LAST DRAWN FOR (v513).
  //
  // ⚠️⚠️ HER QUESTION, AFTER THE APP'S OWN DATE WENT STALE: __"will it happen on storefront?"__ — and the
  // answer, MEASURED, is **YES, and it was already happening.** ⭐ The shop re-checks the DATA every 30
  // seconds and on coming back to the tab, and it redraws when that data changed — ⚠️ **but the DATE
  // moving is not a data change**, so a shop left open (or resumed from the background) overnight kept
  // **yesterday's "today"** on the grid. ⭐ **Measured: with the clock moved to 17 Oct and the customer
  // coming back to the tab, the green "today" halo was still on 16** — while the availability requests
  // went out on every beat, so the polling was running.
  // ⚠️ **The one thing it DID already catch was a day crossing its 6pm cut-off** — that drops a day from
  // the list, which is a change — ⭐ **so the cut-off was honest and the calendar was not**, which is
  // exactly the kind of half-covered thing that is hard to notice.
  let drawnDay = "";
  const rerender = () => {
    todayKey = dateKey(new Date());
    dates = resolveDates(upcomingDates(CONFIG), dayRows, dateKey(new Date()))
      .filter((d) => isOpen(CONFIG, d));
    // Fix the cart first so the calendar/menu repaint with honest quantities: an
    // item the customer chose may have sold out (or dropped to fewer than they
    // asked for) since the last refresh or since they picked this day.
    reconcileCart();
    buildCalendar();
    // ⚠️⚠️ AND THE ANSWER BOX IS REPAINTED FROM THE SAME LIST (v590) — after `buildCalendar`, because that is
    // where `dates` and `avail` have just settled. ⭐ A day that has closed, sold out or been removed can no
    // longer go on being named under a deadline that already passed.
    paintDayAnswer(CONFIG, cutoffText(CONFIG.cutoff), firstOpenSpec(dates, avail),
      Array.isArray(dayRows) && dayRows.length
        ? dayRows.some((r) => r && r.date === todayKey)
        : undefined);
    renderMenu();
    // ★★ AND THE REGULAR'S WAY BACK IN (v638) — repainted with the menu, because what it may offer depends on
    // the day that has just settled.
    renderAgain();
    // ⚠️ LAST, and here rather than anywhere else, because EVERYTHING funnels through `rerender`: the day
    // tapped, the menu rebuilt, the 30-second refresh, the availability arriving. One call site covers
    // them all, and the one that is missed is the one that leaves a circle green on a day that has gone.
    paintSteps();
    // ★★ AND THE COLLECT-FROM LIST IS READ ON THE DAY JUST SETTLED (v420). Her words: __"selecting a
    // bake day the point is not active will grey out that point"__.
    //
    // ⚠️⚠️ IT GOES HERE, AT THE END, AND NOT BESIDE THE OTHER `refreshPointList` CALLS. `selected` is
    // not final until `buildCalendar` has run — it can be cleared when the day the customer had is
    // sold out or has closed — so a list drawn earlier would be judged against YESTERDAY'S day and
    // grey the wrong places. ⭐ **`renderBar` is called rather than `refreshPointList` because the
    // basket total the list is also judged against lives there**, and calling the list directly with
    // no total would quietly read every place with a smallest basket as too small.
    const fulfil = document.getElementById("fulfillment");
    if (fulfil) fulfil._day = selected;
    renderBar();
    // ★★★ WHICH DAY THIS PAGE WAS DRAWN FOR (v513) — see `drawnDay` above. ⭐ Written HERE, at the one
    // place every repaint funnels through, so it can never claim a repaint that did not happen.
    drawnDay = dateKey(new Date());
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
            // The Points arrive with this row too, long after the page first drew, so the
            // Collect-from list is built here rather than waiting for the customer to touch
            // the fulfilment picker. Before this moment she has none open as far as the page
            // knows, and the field stays hidden — which is why a shop with no Points is
            // unchanged.
            refreshPointList();
            // The codes are in hand NOW, which is the first moment a visit can be judged
            // against them (v288). Called here and nowhere else, so the count can only ever
            // follow the arrival of the list it is checked against — and latched inside, so
            // the 30-second poll below cannot count the same open again.
            countLabelOpen(location.search, publishedCodes(), CONFIG.supabase);
          } catch { /* corrupt config → keep the local one */ }
        }
      }
      // A day can cross its cut-off with no data change — drop closed days from
      // the row even when the payload is otherwise identical.
      const next = resolveDates(upcomingDates(CONFIG), dayRows, dateKey(new Date()))
        .filter((d) => isOpen(CONFIG, d));
      const daysChanged = next.length !== dates.length
        || next.some((d, i) => dateKey(d) !== dateKey(dates[i]));
      // ★★★ AND THE DATE IS A REASON TO REDRAW ON ITS OWN (v513) — see `drawnDay`. ⚠️ The line above
      // catches a day crossing its cut-off; **it cannot catch midnight**, because the list of orderable
      // days is identical on both sides of it. ⭐ So "today" is asked here too, and it costs one string
      // comparison on a beat that is already running.
      const movedDay = dateKey(new Date()) !== drawnDay;
      if (changed || daysChanged || movedDay) rerender();
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
      // ★★ AND THE OTHER HALF OF "IS THIS PAGE HONEST?" (v492) — not only "is the bread still
      // today's", but "is this the newest page". The same 30-second beat, the same coming-back-
      // to-the-tab moment, because the answer can change while a customer sits on the shop.
      checkBuild();
    };
    if (hasVisibility) {
      const listen = (t, type, fn) => { if (t && typeof t.addEventListener === "function") t.addEventListener(type, fn); };
      listen(doc, "visibilitychange", () => { if (doc.visibilityState === "visible") poll(); });
      listen(win, "focus", poll);
      listen(win, "online", poll);
      setInterval(poll, 30000);
      // ⚠️ ONCE ON ARRIVAL TOO, AND NOT WAITED ON: an order must never be held up by a question
      // about which build the phone is on. This is also the moment that matters most — a customer
      // who has just opened the shop is the one most likely to be holding a ten-minute-old page.
      checkBuild();
    }
  }

  // ★★★ THE SEND IS A STATE THAT OUTLIVES A REPAINT (v548).
  //
  // ⚠️⚠️ The press disables the button while the order is in flight, and this bar set it back to ENABLED on
  // every repaint — ⭐ **so a language tap, a "+", or the 30-second refresh landing during a slow send turned
  // it back on, and a second press posted the SAME ORDER AGAIN.** ⭐ `var`, not `let`, because a repaint can
  // legitimately run before this line is reached textually and a `let` would throw on the way.
  var sending = false;

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
    // ⚠️⚠️ THE FOURTH STEP WEARS ITS NUMBER (v434) — and it is drawn by the STYLESHEET, not written
    // into the button. Her words: __"it is actually a 4 steps ordering process. not 3. the 4th is
    // place order."__ ⭐ **The line above the steps says four, and this button IS the fourth thing he
    // does** — so the number sits on it rather than the page promising a step it never shows.
    // ⚠️ WHY `::before` AND NOT A SPAN: **this line overwrites the button on every render**, so a
    // span typed into store/index.html would be wiped; and building one here would put the label in
    // a child, which the test shims read differently from their own. **The number is a decoration —
    // it needs no translating and no screen reader — so it belongs to the stylesheet, and this line
    // goes on setting exactly the label it always did.**
    // ⚠️ A REPAINT DURING A SEND KEEPS THE BUTTON AS IT WAS (v548) — see `sending` above.
    document.getElementById("order-btn").textContent = sending ? t("sending") : t("placeOrder");
    // ★★★ AND IT IS NEVER DISABLED FOR AN EMPTY BASKET (v452).
    // ⚠️⚠️ THE RULE WAS ALREADY WRITTEN DOWN TWENTY LINES FURTHER ON, IN THE PRESS'S OWN COMMENT:
    // *"THE BUTTON IS NEVER DISABLED (her standing rule — a site rule must not hide or block a sale)"* —
    // **and this line contradicted it.** Two places holding one rule, disagreeing, which is the fault this
    // whole day has been made of.
    // ⭐ Her words: __"if the previous step not completed user should be inform accordingly"__ — and a
    // DISABLED button cannot inform anybody: on a phone it does not even acknowledge the tap. **So it stays
    // live and the press ANSWERS**, naming the first thing outstanding. The four circles already say where
    // he is; the button now says what to do about it.
    // ⚠️ The one disable that remains is the one in the press itself, WHILE the order is being sent — that
    // is what stops a slow network making him tap twice and posting two orders.
    // ⚠️ `sending`, not a flat `false`: a repaint mid-send must not re-open the press (v548).
    document.getElementById("order-btn").disabled = !!sending;
    // ⚠️⚠️ AND THE BALL IS NOT TOUCHED HERE (v439). v438 dimmed it with an empty basket; her phone
    // showed the result — ④ pale, ② and ③ solid. **A step marker is not a state**, so nothing on
    // this repaint changes it: it keeps ①②③'s colour whether the basket is empty or full.
    // The promo lines ride on the same repaint, because the basket is part of
    // their judgement: a percentage's money moves with the total, and so does
    // whether a code's minimum is met.
    paintPromo(total);
    // ★ AND THE COLLECT-FROM LIST, for the same reason and on the same repaint (v306): whether a
    // Point will take this basket is part of the basket's judgement, so a customer who adds an
    // item watches Farlim become choosable — and one who removes one watches it say why not.
    refreshPointList(total);
    // ★★★ AND THE BAR'S REAL HEIGHT IS WRITTEN DOWN, FOR THE UPDATE STRIP TO SIT ON (v502).
    //
    // ⚠️⚠️ `--bar-h` WAS USED IN EXACTLY ONE PLACE WITH A FALLBACK OF 92px AND **WAS NEVER SET BY ANYTHING** —
    // so the page's own bottom padding was a guess, and the guess is wrong the moment the bar grows (the
    // promo line under Place order is one extra row, and the privacy notice is another).
    // ⭐ Her words: __"appp had the message pin together with the bottom menu, so it appaer regardless of the
    // scroll, but not store"__ — ⭐ **and a strip pinned above the bar cannot be pinned correctly to a number
    // nobody measures.** So the bar is measured, here, on the one repaint every basket change already
    // passes through, **and the same number the strip pins itself to is the number the page pads its foot
    // with.** One reading, two uses.
    // ⚠️ Guarded: a page with no bar (or a test shim with no layout) simply keeps the fallback.
    const barEl = document.querySelector(".order-bar");
    if (barEl && typeof barEl.getBoundingClientRect === "function"
        && typeof document !== "undefined" && document.documentElement) {
      try {
        const h = Math.round(barEl.getBoundingClientRect().height);
        if (h > 0) document.documentElement.style.setProperty("--bar-h", `${h}px`);
      } catch { /* no layout — the fallback stands, and it is a sane one */ }
    }
    return total;
  }

  // Keep `.bar-spacer` at the closed bar's REAL height (v408). Hoisted for the same reason
  // renderBar is: the first repaint happens before this line is reached textually.
  //
  // ⚠️ THE FIXED BAR IS A COST PAID ON EVERY SCREEN, and the spacer is the only thing stopping it
  // swallowing the last row of the shop. app.css carries a MEASURED 126px for the two-row bar and
  // a note on how it was taken; the promo line makes a third row, on one order in however many,
  // and its height is not a number — it is a sentence that wraps differently in English, Chinese
  // and Bahasa Malaysia, and differently again at 320px. ⭐ So it is read off the element rather
  // than measured by hand a second time.
  //
  // ⚠️ THE CLOSED HEIGHT IS THE WHOLE HEIGHT: the privacy panel is `position: absolute` (see
  // app.css), so opening it does not change `offsetHeight` and cannot make the spacer jump.
  // ⚠️ It only ever WRITES a height; a browser that gives no reading leaves the CSS floor as it
  // is, so nothing can end up with a zero-height spacer.
  function syncBarSpacer() {
    const bar = document.querySelector && document.querySelector(".order-bar");
    const spacer = document.getElementById("bar-spacer");
    if (!bar || !spacer || !bar.offsetHeight) return;
    spacer.style.height = `${bar.offsetHeight}px`;
  }

  // ★★ THE FOURTH BALL TURNS GREEN WHEN THE ORDER IS PLACED (v451).
  //
  // ⚠️⚠️ HER WORDS: __"on the store front, when customer press place an order, the number 4 never have the
  // chance to turn green, why not allow it to turn green for 1 sec"__
  //
  // ⭐ AND SHE IS RIGHT ABOUT WHY IT NEVER DID, AND IT IS MY OWN DOING. v438 moved that number OUT of the
  // button and into its own ball, and v439 then removed its dimmed state — with a test forbidding any script
  // from touching it at all, on the reasoning that **a label is not a state**. ⚠️ **But ④ IS a step, the
  // fourth one, and ①②③ all turn green when the customer finishes their step** (her own v434 rule: a circle
  // greens only when HE has done that part). The ball was left as **the one step number that could never
  // report itself** — while the three beside it do. **The v439 rule was right about the BASKET and wrong
  // about the STEP**, and this narrows it to what it actually meant.
  //
  // ⚠️⚠️ AND THE SALE IS NEVER WAITED ON. The ball greens the instant he presses — **before `placeOrder` is
  // even called** — so it paints while the order is being sent, and NOTHING here defers the order by a
  // millisecond. The hold below happens only once the bakery's app has the order: **the sale is already
  // made, so holding a colour costs nothing.**
  // ⚠️ HER NUMBER, IN ONE PLACE (the v427/v428 lesson — a duration in CSS and a moment in JS are two
  // numbers for one fact, and they can only disagree one way).
  const GREEN_HOLD_MS = 1000;
  function greenBarStep(on) {
    const ball = document.getElementById("bar-step");
    if (ball && ball.classList) ball.classList.toggle("done", !!on);
  }

  const orderBtn = document.getElementById("order-btn");
  orderBtn.onclick = async () => {
    if (orderBtn.disabled) return; // one tap only — no double orders
    const lines = [];
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      // ⚠️ THE PRICE IS A MONEY AMOUNT, SO IT IS KEPT TO THE CENT (v577) — a 3-decimal product price shown
      // as "RM0.01" and stored as 0.005 made one sale carry two different totals on paper.
      const line = { name: n, qty: q, price: Math.round(Number(p.price) * 100) / 100 };
      // The customer's own words for this item (v236), when they wrote any. The
      // key is written only when there IS something to send, so an order with no
      // notes posts byte-for-byte the payload this page has always posted — the
      // same "absent means nothing" spelling the pin and the referral stamp use.
      const noteText = lineNoteOf(lineNotes.get(n));
      if (noteText) line.note = noteText;
      lines.push(line);
    }
    // ★★★ THE FIRST THING STILL OUTSTANDING, SAID IN HIS OWN ORDER (v452).
    //
    // ⚠️⚠️ THIS LINE USED TO BE A SILENT `return`. Her words: __"when we proceed order step by step, one
    // after another, if the previous step not completed user should be inform accordingly"__ — and she is
    // describing a customer who taps Place order and is told NOTHING, because the button was disabled and a
    // disabled button does not answer a tap.
    //
    // ⭐ SO ONE GUARD, WALKING THE STEPS IN THE ORDER THE PAGE PUTS THEM — the basket, his name, his number,
    // then how he gets it — **and it stops at the FIRST one missing.** ⚠️ That order is the point: a message
    // about step 3 shown to somebody who has not done step 2 sends him backwards down the page to fix
    // something the page was not yet asking him for.
    // ★★★ A BASKET WHOSE PRODUCTS HAVE ALL LEFT THE MENU (v548). ⚠️⚠️ The menu is replaced wholesale on a
    // refresh; when the bakery renamed or removed what he had picked, `lines` came out EMPTY while step ②
    // still read done — and `refuseAtFirstMissing` had nothing to name, ⭐ **so the press did nothing at
    // all: no order, no message, no clue.** ⭐ Clearing the basket and SAYING SO is the only honest answer:
    // what he chose is gone, and he must pick again from what is actually there.
    if (!lines.length && cart.size) {
      const gone = [...cart.keys()];
      cart.clear();
      renderBar();
      showConfirm([
        el("p", { class: "confirm-title" }, t("confirmChangedTitle")),
        ...gone.map((n) => el("p", { class: "confirm-body" }, sub(t("fixGone"), n))),
      ], "warn");
      return;
    }
    if (!lines.length) {
      // ★★★ THE SAME LINE AS EVERY OTHER REFUSAL, AT STEP 2 (v493) — and the banner at the foot of the page
      // is RETIRED with its own competing scroll. ⚠️ **Those two fought, exactly as the closed-day banner
      // did in v463: the page was carried to step 2's heading and then `showConfirm` carried it again, to a
      // banner that sits BELOW everything — including the Track-your-order card.** ⭐⭐ **So the customer
      // was told "pick something from the menu ABOVE" while the page flew past the menu, downwards.**
      // ⚠️ AND IT NAMES THE FIRST STEP THAT IS MISSING, WHICH MAY NOT BE STEP 2 (v493) — her words:
      // __"when step 1 is skip, it should always go back to step1"__. ⭐ Pressing Place order without ever
      // tapping a bake day goes to STEP 1; with the day chosen it goes to step 2, which is the basket.
      refuseAtFirstMissing();
      return;
    }
    // ⚠️⚠️ NO DAY TO ORDER FOR MUST BE SAID, NOT SWALLOWED (v592). ⚠️ With every upcoming day full or removed,
    // `selected` is null — and this was a SILENT return: ⚠️ **a customer with a full basket pressed Place
    // order and nothing at all happened — no message, no scroll, no order.** ⭐ The day step refuses, in the
    // all-days-full words.
    if (!selected) {
      sayStepFirst("needDayTitle", "needDayBody", "step1", t("noOpenDates"));
      return;
    }
    // ★ AND HIS NAME IS ASKED FOR BEFORE HIS NUMBER, because the page asks them in that order (v452). It is
    // REQUIRED — she decided it: without it an order has no name on it, and she confirms every order by hand.
    const nameInput = document.getElementById("name-input");
    if (!nameInput || !String(nameInput.value || "").trim()) {
      // ★ THE BOX TURNS RED AND SAYS WHY, UNDER ITSELF (v455) — see `markField`. No pop-up, no scroll.
      clearFieldMarks();
      markField(nameInput, "confirmAddNameTitle");
      return;
    }
    clearFieldMarks();
    // The baker confirms every order (and sends the payment QR) over WhatsApp,
    // so the customer's number is required to place the order at all.
    // ★★★ AND HIS NUMBER IS THE SAME KIND OF THING AS HIS NAME, SO IT ANSWERS THE SAME WAY (v493). ⚠️⚠️
    // Her rule 3 is the whole reason: __"step 3 not fill up … screen will scroll to the field below it and
    // flash the warning"__. ⭐ **The name box has done exactly that since v455/v462 — red edge, its reason
    // underneath, a blink, and the page carried to it. The number box used a BANNER at the very foot of the
    // page instead**, so one step had two different ways of saying the same sentence. ⚠️ **That banner is
    // retired here, and the box now behaves exactly as the box above it does.** ⭐ Both sentences come with
    // it (`extraKey`) so the customer is told what is missing AND why the bakery needs it.
    const waInput = document.getElementById("whatsapp-input");
    const whatsapp = waNumber(waInput && waInput.value);
    if (!whatsapp) {
      clearFieldMarks();
      markField(waInput, "confirmAddWaTitle", "confirmAddWaBody");
      return;
    }
    // ⚠️⚠️ AND A NUMBER THAT CANNOT BE ANSWERED IS REFUSED AT THE SAME BOX (v565). ⭐ Her rule that the
    // press is never disabled holds — it answers, in the same red edge and the same blink, because a
    // one-digit number is a typo the customer can fix in a second, and the order is useless without it.
    if (!waPlausible(whatsapp)) {
      clearFieldMarks();
      markField(waInput, "confirmAddWaShape");
      return;
    }
    // Posting is the default way to receive an order, so a full postal address
    // is required unless the customer chose to collect locally.
    const fulEl = document.getElementById("fulfillment");
    const fulfillment = (fulEl && fulEl._value) || "courier";
    const address = (document.getElementById("address-input").value || "").trim();
    // ★★★ AND THE ADDRESS ANSWERS THE WAY THE NAME AND THE NUMBER DO (v548). ⚠️ Its refusal used to be a
    // banner at the foot of the page — a third way of saying one sentence inside one step. ⭐ The box is
    // marked, its reason underneath, and the page carried to it.
    // ⭐ A typed address OR a dropped pin is a door (the pin's own save treats the pair as sufficient).
    // Requiring the text as well would refuse a customer who marked the place on the map.
    if (fulfillment === "courier" && !address && !doorPin) {
      const addrInput = document.getElementById("address-input");
      clearFieldMarks();
      markField(addrInput, "confirmAddrTitle", "confirmAddrBody");
      return;
    }
    // Cutoff guard: a customer may have the page open across the deadline, so
    // re-check the selected day at the moment they tap Place order.
    // ★★★ AND THE DAY THAT CLOSED IS A STEP-1 PROBLEM, SO IT SPEAKS AT STEP 1 (v493). ⚠️ **This was the
    // third banner, and the one v463 already caught fighting the page:** it carries him to step 1, says
    // __"That day's orders are closed … please pick a new bake day"__ — ⭐ **which is step 1's instruction,
    // word for word — and the words name the cut-off, so the explanation is not lost by the move.**
    // ⚠️ Its sentence is BUILT (the cut-off time is substituted in), which is why `sayStepFirst` takes the
    // words as well as the keys.
    if (!isOpen(CONFIG, new Date(`${selected}T00:00:00`))) {
      sayStepFirst("confirmClosedTitle", "confirmClosedBody", "step1",
        sub(t("confirmClosedBody"), clockWords(CONFIG.cutoff)));
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
      // ⚠️⚠️ THE FALLBACK IS POST (nationwide), AND IT MUST MATCH THE GATE ABOVE. This line said
      // `|| "collect"` — the bakery's default — while the press refuses on `_value || "courier"`.
      // **Two places holding one rule and disagreeing**, so an order placed with an empty `_value`
      // was checked as Post and WRITTEN as collect: the customer would have been told to post it
      // and the backoffice would have read it as a collection. Caught by the test that places an
      // order with no way chosen. Munchies' default is Post — she confirmed it on 2026-10-12.
      fulfillment: (document.getElementById("fulfillment") || {})._value || "courier",
      // WHERE a collection order is collected from (v299). The kitchen is the EMPTY id — it is
      // not a Point and has no record — and the NAME rides beside the id so that deleting the
      // Point later never rewrites where this order went. A courier order carries neither.
      pointId: (document.getElementById("fulfillment") || {})._pointId || "",
      pointName: (document.getElementById("fulfillment") || {})._pointName || "",
      address: document.getElementById("address-input").value.trim(),

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
    sending = true;          // ⚠️ survives the repaints that follow (v548)
    orderBtn.disabled = true;
    orderBtn.textContent = t("sending");
    // ★ The step is DONE the moment he places it — painted here, so it shows during the send.
    greenBarStep(true);
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
      // ★★ AND THE FRIEND'S NUMBER LEAVES THE ADDRESS (v325). It is on the order record now, so
      // from here it is only a phone number sitting in someone else's address bar. **This is the
      // one path where the order really landed** — the same reason `rememberShopOrder` is here and
      // nowhere else — and an order that fell back to WhatsApp keeps its stamp on purpose.
      forgetVia();
      // ⭐ AND WHAT THEY ORDERED, on their own phone (v638) — the regular's way back in. Saved HERE because
      // this is the one path where the order really landed; a fallback to WhatsApp reached no record.
      saveLastBasket(shopStorage(), [...cart].map(([name, qty]) => ({ name, qty })), dateKey(new Date()));
      sending = false;       // the order landed — the next customer may order (v548)
      cart.clear();
      // ★★★ AND THE MENU IS REBUILT, NOT JUST THE BAR (v549). ⚠️⚠️ The reset emptied the basket and left
      // every card's stepper reading the last customer's number: the bar said **"0 items / RM0.00"** while
      // the Focaccia card still showed **1**. ⭐ Two things on one screen saying different numbers is the
      // fault this shop has fixed more times than any other, and the steppers are built from `cart`, so
      // they are rebuilt from it here.
      renderMenu();
      renderAgain();
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
      // Reset the delivery method to self collect for the next customer.
      // ⚠️⚠️ THROUGH THE SAME SEAM EVERYTHING ELSE USES (v412). This used to write `_value` and the
      // `active` class BY HAND — and it had been wrong since v410 put the edge on the CARD rather
      // than the press, so a second order from the same phone would light the wrong element and leave
      // the fold wherever the last customer left it. ⭐ **A second way to set one thing is a second
      // thing to keep right**, so it calls the one the picker already owns.
      const fulEl = document.getElementById("fulfillment");
      if (fulEl && typeof fulEl._resetFulfillment === "function") fulEl._resetFulfillment();
      // ⭐⭐⭐ AND ④ GOES OUT (v506). Her words: __"and why no4 still green?"__ — ⭐ **the third of the same
      // fault she had to hand me, and the reason I could not fix it in the reset is the point worth keeping:
      // `greenBarStep` is not in `wireFulfillment`'s scope at all — it belongs to THIS function.**
      // ⚠️ **THE STATE IS SPREAD ACROSS TWO SCOPES AND ONLY ONE OF THEM IS "THE RESET".** ⭐ I found the scope
      // by trying it in the reset, watching fourteen tests fail, and taking it out again — **which is what a
      // test suite is for.**
      const addrField = document.getElementById("address-field");
      if (addrField) addrField.hidden = false;
      resetPin(); // the next customer does not inherit this one's front door
      // ★★★ AND THE NEXT CUSTOMER DOES NOT INHERIT HIS BAKE DAY (v465). Her question: __"and user after
      // placing an order, how should their storefront go back to default?"__
      // ⚠️⚠️ **MEASURED IN THE CODE FIRST, AND IT DID NOT GO BACK: `dayPicked` is cleared in exactly ONE
      // place in this whole file — when the day that was chosen stops being on offer — and NEVER here.**
      // ⭐ So the next customer arrived at a shop where **step ① was ALREADY GREEN and the menu was ALREADY
      // OPEN, for a day HE never chose.** ⚠️ **That is precisely the fault v434 fixed** (*"step 1 was GREEN
      // before he touched anything ⟹ one colour till he acts"*), coming back through a door it never closed.
      // ⭐ `selected = null` first, so the calendar re-offers the first open day **for** him exactly as it
      // does on arrival — and `rerender()` is what rebuilds the circles and the line under the calendar, so
      // there is no second way to set any of this. **`dayPicked` stays false because only a TAP sets it**,
      // which is the rule v434 turns on.
      selected = null;
      dayPicked = false;
      // ⚠️ `buildCalendar` AND NOT `rerender()` — the calendar is the piece that OWNS `selected` and the
      // line under it, so it is the piece that puts the next customer's day on offer again. ⚠️ **The full
      // `rerender()` was the first thing I reached for and it broke two of this shop's own tests outright**
      // — it rebuilds the menu and the bar too, which is more than this reset needs and more than some of
      // the pages this code runs on can take. ⭐ The circles follow from `paintSteps`.
      buildCalendar();
      paintSteps();
      // ⚠️⚠️ AND THERE IS NO SCROLL TO THE TOP HERE ANY MORE (v489).
      //
      // Her words, asked twice: __"after the press of place order button, the screen scrolls, what is this
      // for?"__ ⭐ **THE HONEST ANSWER WAS THAT THERE WERE TWO SCROLLS AND THEY FOUGHT:** this one took the
      // page to the TOP, and ~1 second later `showConfirm` scrolled the notice into the middle of the
      // view — ⚠️ **and the notice is the LAST element on the page, so a customer watched the whole shop
      // fly past him upward and then all the way back down.** ⭐ **The wobble was mine.**
      //
      // ⭐⭐ SO THE NOTICE'S OWN SCROLL IS THE ONLY ONE. It is the thing he must read, and it is where the
      // page comes to rest. ⚠️ **The shop is already reset behind it** — the next customer scrolls up into
      // a fresh shop with step ① at the top, which is exactly what the top-scroll was for, without the
      // round trip. ⭐ ONE `scrollIntoView`, in `showConfirm`, and nothing to fight it.
      //
      // ⚠️⚠️ AND NOTHING ELSE EVER MOVES THE PAGE (v499, v509). Her question was __"how to make the
      // storefront page reset itself, after place order"__ — ⭐ **and the answer turned out to be that it
      // already did.** EVERY FORM FIELD HAS GONE BY THIS LINE (v465): the basket, the notes, the name, the
      // number, the address, the door pin, the code and the bake day. ⚠️ **What lingered was the RECEIPT,
      // not the shop** — so the two things built to deal with it (a scroll a minute later, and then a card
      // offering to clear the page) are both gone. ⭐ **The receipt simply goes by itself** (v509), and the
      // fresh shop is one flick upward, which is where the customer was going anyway.
      // ⚠️ AND THE CLOCK STARTS HERE (v497) — at the RECEIPT, not at the order, because the receipt is what
      // goes. ⭐ **It is a timestamp and not only a timer**, so the shop can still answer "has the twenty

      // seconds passed?" after a phone has been asleep and its timers frozen.
      orderedAt = Date.now();
      renderBar();
      // ⚠️ `renderBar` empties the bar for the next customer, so the green is set AGAIN here — and then
      // HELD for her one second **before the received notice covers it**. ⭐ The order is already in the
      // bakery's app, so this waits on nothing: it is time to SEE the step finish, not time the sale spends
      // in the post. They are the same `done` class ①②③ wear, so it is the same green and the same meaning.
      greenBarStep(true);
      // ⚠️⚠️ AND IT GOES OUT ONE SECOND LATER, IN THE RECEIPT'S OWN CALLBACK (v508) — **NOT HERE.** ⭐ Her
      // screenshot showed ④ STILL GREEN after the order, and the reason is the line above: **the green is set
      // twice in this function, and I had put the clearing between them**, so the shop's own "let her SEE the
      // step finish" put it straight back. ⚠️ **A reset is only a reset if it is the LAST word** — the same
      // class as `greenBarStep` not being in the other scope's reach, twice in one version.
      // ⭐ It belongs here, where the customer has had his second of green and is reading his receipt: **the
      // notice covers the bar a moment later anyway, so putting it out is invisible to him and honest to the
      // next customer.**
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
      // ⚠️⚠️ AND THE NOTICE FOLLOWS ON A TIMER, NOT ON AN AWAIT. Holding the press handler open for her one
      // second hung the promise the whole way — the store's own tests caught it (`cancelledByParent`), and
      // the same shape would hold any caller that awaits the press. ⭐ **The order has already landed, so
      // there is nothing to wait FOR: the green is simply held while the handler returns.** The figures
      // above are computed now, at the moment of the sale, and only the SHOWING is late.
      setTimeout(() => {
        showConfirm([
        el("p", { class: "confirm-title" }, t("orderRecvTitle")),
        el("p", { class: "confirm-body" },
          order.customer ? sub(t("orderRecvThanksBody"), order.customer, CONFIG.name) : sub(t("orderRecvBody"), CONFIG.name)),
        el("p", { class: "confirm-body" }, sub(t("orderRecvLine"), dayLabel, items, total.toFixed(2))),
        cancelLine,
        el("p", { class: "confirm-sub" }, t("orderRecvSub")),
      ], "ok");
        // ★★★ AND THE RECEIPT'S LIFE IS ARMED FROM IN HERE, NOT FROM THE ORDER (v495) — **because it is
        // about the RECEIPT, and the receipt is what this callback has just put on the page.** ⚠️⚠️ Arming
        // it when the order landed *looked* equivalent and was not: **at that moment the receipt is not up
        // yet**, so any page where this second ran late would arm a clock against nothing and never try
        // again.
        // ⚠️ AND THIS WAS WRITTEN WRONG ONCE, IN THE OBVIOUS WAY: the call was put on the line AFTER the
        // closing `), GREEN_HOLD_MS);` — **which reads as "inside the callback" and is not.** ⭐ The test
        // that asks *whether anything is armed before the receipt exists* caught it on its first run.
        // ⭐ AND THE RECEIPT GETS A LIFE (v509) — armed HERE, where the receipt exists.
        shopTimer(hideReceipt, RECEIPT_LIFE_MS);
        // ⭐ AND ④ GOES OUT NOW (v508) — the customer has had his second of green, and the next customer must
        // not find the shop claiming a step is done before he has done anything (the fault v434 fixed for ①).
        greenBarStep(false);
      }, GREEN_HOLD_MS);
    } else {
      // ⚠️ IT DID NOT LAND, SO THE STEP IS NOT DONE. The page falls back to WhatsApp, and a green ball
      // sitting over an order the bakery never received would be the worst thing this ball could say.
      greenBarStep(false);
      // The order could not reach the bakery's app — hand it over on WhatsApp
      // instead so it isn't lost (this is the only time WhatsApp opens, and the
      // baker sees the customer's own number on the message). Best-effort: the
      // cart stays intact if it can't open.
      const url = CONFIG.whatsapp ? waUrl(order, dayLabel) : null;
      const opened = url ? tryOpenWa(url) : false;
      sending = false;
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
  // ★★★ AND THE BUILD NOTICE'S PRESS, bound here for the same reason: `render()` runs once per
  // page load, while `renderStatic()` runs again on every render and every language switch —
  // **a listener bound there is a listener repeated, and a repeated toggle cancels itself out.**
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
  // ⚠️ English only until v565 — the dictionary carries it in all three languages now.
  const root = el("div", { class: "tj", role: "group", "aria-label": t("journeyAria") });
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

// One row of the customer's money block (v277): the words on the left, the figure flush
// right, so the figures form a single column the eye can add up the way it does on a
// receipt. Her report, 2 Oct 2026: "the format still not as clear as a receipt, the
// money have to align up ... line up in one column".
//
// The row is CUT OUT OF THE TRANSLATED SENTENCE rather than built from a second set of
// label strings. Every money label in store-lang.js already writes its figure as %1 (and
// a promo's code as %1 with its money as %2), so splitting on the placeholder means a
// translation edited in one place cannot leave this card reading a different word from
// the message. The punctuation that joined the two halves is dropped — a receipt has no
// colon — and a `-` written in front of the figure stays with the figure, because the
// sign belongs to the money and not to the words.
function moneyRow(tpl, figures, cls) {
  const n = figures.length;
  const cut = tpl.indexOf(`%${n}`);
  let label = cut === -1 ? tpl : tpl.slice(0, cut);
  // Anything written AFTER the figure is a rider on it, not part of the label — the COD
  // charge is the only one, and it has to say where the money goes.
  const tail = (cut === -1 ? "" : tpl.slice(cut + 2)).trim().replace(/^[-–—]\s*/, "");
  // Any placeholder before the figure belongs to the WORDS — a promo's code.
  for (let i = 1; i < n; i++) label = label.split(`%${i}`).join(String(figures[i - 1]));
  const sign = /[-–—]\s*$/.test(label) ? "-" : "";
  label = label.replace(/[\s:：\-–—]+$/, "");
  return el("p", { class: `money-row${cls ? ` ${cls}` : ""}` },
    el("span", { class: "money-label" }, tail ? `${label} — ${tail}` : label),
    el("span", { class: "money-val" }, sign + String(figures[n - 1])));
}

// The money, as the same lines the customer's WhatsApp message carries (v199, 25 Sep
// 2026): what they ordered, its subtotal, the courier's charge when there is one, and the
// total — so the card and the message cannot be read side by side and disagree.
//
// The subtotal has to be worked out here rather than read, because only the total is
// published as a figure the card can print: a charge the CUSTOMER bears is inside that
// total UNLESS the courier collects it at the door, so the goods are the total less that
// part. `courier_fee` is the whole charge either way, which is why the COD flag decides
// whether it comes off.
//
// A total that cannot be read as a number falls back to the single line this card has
// always drawn.
function moneyEls(row) {
  const read = readMoney(row && row.total);
  const items = String((row && row.items) || "");
  if (!read) return [el("p", {}, `${items} — ${String((row && row.total) || "")}`)];
  const fee = Number(row && row.courier_fee) || 0;
  const inside = fee > 0 && !(row && row.courier_cod) ? fee : 0;
  // The code, and what it took off. Published as an amount rather than worked out here,
  // because a code she has since deleted is no longer in the published list and would
  // leave the card unable to price an order it is showing (v272).
  const off = Number(row && row.promo_rm) || 0;
  const code = String((row && row.promo_code) || "").trim();
  const rows = [
    // The subtotal is the total less the charge inside it, and ADD BACK the discount —
    // the published total is already net of the promo, so without this the goods would
    // be printed RM10 short of what they cost.
    moneyRow(t("itemsTotal"), [moneyText(read.sym, read.n - inside + off)]),
  ];
  if (fee > 0) {
    rows.push(moneyRow(t(row.courier_cod ? "courierCod" : "courierCharge"),
      [moneyText(read.sym, fee)], "track-fee"));
  }
  if (off > 0) {
    // ★ A DISCOUNT WITH NO CODE IS THE BRING-A-FRIEND ONE (v323). The app refuses to let a
    // promo code be labelled without a name, so `off > 0 && !code` can only be the friend's
    // first-order discount — and it gets its own words rather than printing "Promo : -RM3".
    // Until this the card showed the LOWER TOTAL with nothing saying why, which is the one
    // thing this app never lets a figure do.
    rows.push(code
      ? moneyRow(t("promoLine"), [code, moneyText(read.sym, off)], "track-promo")
      // ⚠️⚠️ AND WHICH ONE IT WAS (v571). ⭐ A referrer spending the reward they EARNED was told it was a
      // coupon somebody sent them — the figures were right and the words were about a different person.
      // ⚠️ A card published before this carries no role and reads exactly as it did.
      : moneyRow(t(String(row.promo_role || "") === "reward" ? "promoReward" : "promoFriend"),
          [moneyText(read.sym, off)], "track-promo"));
  }
  rows.push(moneyRow(t("trkTotal"), [moneyText(read.sym, read.n)], "track-total"));
  return [
    // The goods themselves, under the label the message uses, so the list above a stack
    // of figures is unmistakably what those figures are about.
    el("p", {}, sub(t("trkItems"), items)),
    // The workings are muted and the total is not: the same reading order the message
    // gives with a blank line and bold, done here the way a page does it.
    el("div", { class: "money" }, ...rows),
  ].filter(Boolean);
}

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
      : kind === "needPhone" ? t("trackNeedPhone")
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
      // A CODE AND THE FRIEND'S COUPON CAN NEVER BOTH APPLY (v322), so an amount with no
      // code is the friend's discount — and it is NAMED, because the promise was money off
      // and a lower total with nothing saying why is the one thing this card never does.
      : row.promo_rm > 0
        ? el("p", { class: "track-note track-promo" },
            sub(t("promoFriend"), `RM${Number(row.promo_rm).toFixed(2)}`))
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

export async function trackOrder(code, phone = "") {
  if (!document.getElementById("track-result")) return;
  const clean = String(code || "").trim().replace(/^#/, "").toUpperCase();
  if (!clean) {
    lastTrack = { kind: "enter", code: "" };
    return paintTrack();
  }
  // ★★★ AND THE PHONE THE ORDER WAS PLACED WITH (v558) — the SECOND key.
  // ⚠️⚠️ A six-character code is about 16.7 million values and this lookup is open to anyone. At a few
  // hundred orders a stranger making requests could reach a real order and read **that customer's name,
  // delivery address and driver's phone.** ⭐ The phone is not published anywhere public, so a guess must
  // now know BOTH. ⭐ Digits only, so 012-345 6789 and 60123456789 are the same number.
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  if (!digits) {
    lastTrack = { kind: "needPhone", code: clean };
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
    // ⚠️ THE LOOKUP IS A FUNCTION, NOT A TABLE READ (v345, 7 Oct 2026). It used to
    // be a PostgREST select on order_tracking, and that table was readable by
    // ANYONE: the anon key is public by design, and a `using (true)` read policy
    // meant a single request returned every customer's name and delivery address
    // — the shop asked for one code, but nothing enforced it. RLS cannot express
    // "only if you know the code", because a policy sees a row and never the
    // question. So the match moved into supabase/tracking.sql's `track_order`
    // function, which returns ONE row and is the only door left on that table.
    //
    // ⚠️ AND THE COLUMN LIST MOVED WITH IT — it is now the `returns table (...)`
    // in that function, and it is still load-bearing for the same reason it
    // always was: PostgREST returns only what that list names, and a column the
    // backoffice publishes which the list omits is a line this card can never
    // draw, failing silently with nothing anywhere saying why. test/store-trip
    // reads the SQL file to prove every column the card needs is named there.
    //
    // ⚠️ JERKY'S OWN `postage_quoted` IS IN THAT LIST. It is not in the bakery's and
    // nobody else will miss it — without it this card cannot tell an order whose
    // delivery cost is still to be quoted from one with nothing left to pay, and would
    // quietly say neither. Added to supabase/tracking.sql by this project.
    const res = await fetch(`${base}/rest/v1/rpc/track_order`, {
      method: "POST",
      headers: { apikey: sb.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: clean, p_phone: digits }),
      cache: "no-store",
    });
    // ⚠️⚠️ A FAILED LOOK-UP IS NOT "NO SUCH ORDER" (v595). ⚠️ A 404 (SQL not run), a 500 or a 429 all read as
    // "We couldn't find order #X with that phone number" — ⚠️ **the customer was blamed and retried for ever.** ⭐
    // The shop says the service is unavailable, as it already does when the request throws.
    if (!res.ok) {
      lastTrack = { kind: "unavailable", code: clean };
      paintTrack();
      return;
    }
    const rows = await res.json().catch(() => null);
    const row = Array.isArray(rows) && rows[0];
    lastTrack = row ? { kind: "row", code: clean, row } : { kind: "notfound", code: clean };
    paintTrack();
  } catch {
    lastTrack = { kind: "unavailable", code: clean };
    paintTrack();
  }
}

// The Self collection Points she has open (v299), exactly as the shop was given them. Guarded
// like the codes next door: the storefront lands asynchronously, so before it does there is
// nothing to offer and the shop must look exactly as it did before this version.
function publishedPoints() {
  return Array.isArray(CONFIG.points) ? CONFIG.points : [];
}

// Where a Self collect order is collected FROM, as rows a customer picks between.
//
// ★★ THE KITCHEN IS FIRST — AND IS NOW ONLY INVENTED WHEN SHE HAS NOT MARKED ONE (v407).
// ⚠️⚠️ THIS ROW USED TO BE UNCONDITIONAL, and since v406 that printed her kitchen TWICE: the
// kitchen is a Point she marks, `publishPoints` sends it like any other, and this line then
// added a second row for the same place above it — two choices, one place, under two different
// names. Her words at v406: __"I want all self collection thru collection point, not from the
// kitchen"__ — **every collection is a Point, including the one that is her kitchen.**
//
// ⭐ SO THE INVENTED ROW IS A FALLBACK, which is the job it was always meant to do: it stands in
// for the kitchen only while no Point is marked as one. Two reasons it must not simply be
// deleted, and both are orders rather than tidiness: an app with no kitchen marked and no Points
// must still let a customer collect at all, and **every order taken before v406 carries no
// `pointId` — the EMPTY id IS the kitchen**, so the row that posts that empty id has to survive.
//
// The whole field is hidden while she has no Point open, so a shop that never uses them is
// byte-for-byte the shop it was.
// ★★ THE DAYS A PLACE IS SERVED, SAID IN THE CUSTOMER'S OWN LANGUAGE (v419).
//
// Her words: __"every point listed in store, just that if that point only for friday, then mention
// it"__. ⚠️⚠️ **NOTHING IS FILTERED, GREYED OR HIDDEN** — every Place draws exactly where it drew
// before, and this only ADDS a line to the ones she has restricted. ⚠️ And it adds a line to exactly
// the Places that published a `days`, so a page nobody has touched is byte-for-byte what it was.
//
// ⚠️ NO NEW STRING IN ANY LANGUAGE, AND THAT IS DELIBERATE. It reuses **`closedWeekday` ("Only
// available on %1")**, which is already translated in all three languages and already joined by
// `listJoin` in the page's own — so the dictionary, its key-parity test and its placeholder test are
// all untouched by this version.
// ⭐ THE COUPLING IS REAL AND INTENDED: that string is also the product card's own "only available
// on" line. Both mean the same one thing — *this is not on offer every day* — so a change to one
// MUST be a change to both, and a second copy of the sentence is exactly how the two would come to
// say different things.
function pointDaysLine(p) {
  const days = Array.isArray(p && p.days) ? p.days : [];
  if (!days.length) return "";
  const names = days.map((n) => dayName(Number(n))).filter(Boolean);
  return names.length ? sub(t("closedWeekday"), listJoin(names)) : "";
}

// The weekday of a "YYYY-MM-DD" key, or null when the page has not settled on a day yet.
function weekdayOf(iso) {
  const s = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

// ★★ IS THIS PLACE SERVED ON THAT DAY? (v420). Her words: __"selecting a bake day the point is not
// active will grey out that point"__.
//
// ⚠️⚠️ A MISSING `days` MEANS EVERY DAY, NOT NO DAY — the admin only publishes the key when she has
// actually restricted the place, so a Place she has never touched, an older published payload and a
// page that has not settled on a day yet ALL answer "yes". Getting this the wrong way round would
// take every unrestricted Place off the page, which is the opposite of what she asked for.
function servedOn(p, dayNum) {
  const days = Array.isArray(p && p.days) ? p.days.map(Number) : [];
  if (!days.length || dayNum === null) return true;
  return days.includes(dayNum);
}

function renderPointList(wrap, total = 0) {
  const list = document.getElementById("point-list");
  if (!list || !wrap) return;
  const points = publishedPoints();
  // ⚠️ NO FIELD TO HIDE ANY MORE (v410): the list lives INSIDE the Self collect card, so an empty
  // one draws nothing rather than hiding a labelled box — and a card holding no places simply
  // reads as its two lines, which is the shop she had before she opened any Points.
  // ⚠️ AND THE CARD'S OWN FOLD IS NOT DECIDED HERE (v412) — `refreshPointList` owns it, because it
  // is about the METHOD and this function is about the places. Two places deciding one thing is how
  // they come to disagree.
  if (!points.length) {
    // ⚠️⚠️ NO POINTS MEANS NO CHOSEN POINT (v596). ⚠️ This returned before the "a choice no longer open falls
    // away" rule, so a customer kept "Sg Ara" after she deleted her last Point and the order still named it.
    wrap._pointId = "";
    wrap._pointName = "";
    list.replaceChildren();
    return;
  }
  // The Point she marked as the kitchen, if she has one. ⚠️ Read from the published list rather
  // than assumed: an older storefront payload predates the flag and simply has no marked kitchen,
  // which is exactly the fallback case below.
  const kit = points.find((p) => p && p.isKitchen === true) || null;

  const choose = (id, name) => {
    wrap._pointId = id;
    wrap._pointName = name;
    for (const b of list.children) {
      // ⚠️⚠️ ONLY THE PLACES. ⭐ **The area HEADINGS are children of this list too, and they carry no
      // `data-point-id`** — so `(b.dataset.pointId || "") === ""` matched THEM every time nothing was
      // chosen, and the headings were handed the "active" class on a card with no place picked. ⚠️
      // It drew nothing wrong (`.point-area` has no active style), which is exactly why it lived
      // from v410 unnoticed — **a wrong class with no styling is a wrong class nobody sees.** A row
      // is a row because it HAS an id.
      if (!b || !b.classList || !b.dataset || b.dataset.pointId === undefined) continue;
      const on = b.dataset.pointId === id;
      b.classList.toggle("active", on);
      // ⚠️⚠️ THE CHOSEN PLACE WAS SAID BY COLOUR ALONE (v583). ⭐ `aria-pressed` is the same fact in words,
      // so a screen reader says which place is chosen.
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    // ★★ AND THE INSTRUCTION GOES THE MOMENT HE PICKS ONE — HERE, not only in the repaint (v415).
    // ⚠️⚠️ THIS IS THE ONLY PLACE THAT KNOWS A PLACE WAS JUST CHOSEN, and `refreshPointList` does NOT
    // run when the method is already correct — **which is exactly the tap this line is for**: a page
    // that opened on Self collect, where tapping a place changes nothing about the method and so
    // repaints nothing. Without this the line stayed under his thumb telling him to do what he had
    // just done. ⭐ Found by asserting it, which is the only way this one was ever going to show.
    const note = document.getElementById("point-pick");
    if (note) note.hidden = !!id;
  };
  // ★★ TAPPING A PLACE **IS** CHOOSING TO COLLECT (v410), which is what her "one piece" means:
  // there is no longer a world where the customer has picked self collect but no place, or has a
  // place but has not said they are collecting. Choosing from this list settles both at once.
  // ⚠️ IT ONLY SWITCHES THE METHOD, never re-chooses the place — otherwise this page would fight
  // the customer's own tap on the place rows.
  // ⚠️ AND IT DOES NOT RUN WHILE ALREADY COLLECTING, which is not just tidiness: this function is
  // called from the repaint that the method switch triggers, so an unguarded call would ask for a
  // repaint that asks for a repaint, for ever.
  const pickCollect = (then) => {
    if (typeof wrap._pickCollect === "function" && wrap._value !== "collect") wrap._pickCollect(then);
    // ⚠️ ALREADY COLLECTING: there is no way to change, so the place is simply taken — and it is
    // taken HERE rather than by the caller, so the two paths cannot drift.
    else if (then) then();
  };
  // ★ A SHORT BASKET IS SHOWN AND REFUSED, not hidden (v306). `short` is a POINT that asks for a
  // smallest basket this basket has not reached: it stays on the page with the reason in its own
  // line, because a Point that simply vanished below RM30 would read as a broken page rather than
  // as her rule — and the customer can act on a shortfall they can see.
  //
  // The rule is HERS, typed on her own Point, so the shop honours it rather than merely stating
  // it: this is not the app's own rule being turned into a gate, which is the thing her standing
  // instruction forbids.
  // ★★ AND A TAP ON A PARKED PLACE MAKES ITS OWN WARNING FLASH — IT DOES NOT MOVE THE PAGE (v423).
  //
  // Her words: __"when customer click on unavailable point, just flash the warning Only available on,
  // xxx. The screen jump is not desired"__.
  //
  // ⚠️⚠️ THE JUMP WAS `showConfirm`'s OWN `scrollIntoView`, and it was never this screen's decision:
  // `showConfirm` scrolls the box into the middle of the view every time it is called, which is right
  // for the ORDER guards (he pressed Place order and has to be told why not) and **wrong for a place
  // he merely touched** — the page leapt away from the list he was reading. ⭐ So a parked place no
  // longer opens the box at all.
  //
  // ⭐ AND NOTHING NEW IS SAID, OR NEEDED: **the warning is already on the row** — "Only available on
  // Fri" for a place not served that day, and the smallest-basket sentence for one his basket has not
  // reached. The tap draws his eye to the line he already has, which is the whole of what he needs.
  // ⚠️ **BOTH PARKED REASONS FLASH**, because two rows that look alike must behave alike
  // ([[feedback-affordances]]) — only one of them moving the page would be the fault she calls a bug.
  // ★★ HOW LONG THE FLASH LASTS IS ASKED OF THE STYLESHEET, NOT WRITTEN HERE (v427).
  //
  // Her words: __"can you flash the red twice or trice"__ — ⚠️ and asking for MORE blinks is exactly
  // what exposed the coupling: how long the flashing runs lives in `--flash-blink` and
  // `--flash-blinks` (store/app.css), while the moment the mark comes OFF lives in this timer.

  const row = (id, name, sub, { short = false, off = false, address = "", days = "" } = {}) => {
    // ⚠️ `short` AND `off` MEAN THE SAME THING TO A TAP — this place is on the page, and it is not
    // open to you right now — so both wear the same PARKED look and both explain themselves rather
    // than doing nothing. ⚠️ They are two classes with one set of rules rather than one class doing
    // two jobs, so the stylesheet can say which is which.
    const closed = short || off;
    const b = el("button", {
      class: `point-opt${closed ? (off ? " off" : " short") : ""}`, type: "button", "data-point-id": id,
      "aria-pressed": "false",
      onclick: () => {
        if (closed) { flashRow(b); return; }
        // ★★ THE PLACE TRAVELS WITH THE CHANGE (v436). ⚠️ It used to be chosen FIRST and the way
        // switched after — which, once a change can be REFUSED, would leave a customer who pressed
        // "keep delivery" holding a chosen place with a courier order: exactly the state v410
        // abolished. ⭐ **Both commit together, or neither does.**
        pickCollect(() => choose(id, name));
      },
    }, el("span", { class: "point-name" }, name), el("span", { class: "point-sub" }, sub),
    // ★★ AND WHERE IT IS, WHEN SHE HAS SAID A CUSTOMER MAY SEE IT (v410). A line of its own under
    // the description, not folded into it: the description says what the place IS ("where we bake",
    // "we message the exact spot"), and the address is a fact she has chosen to publish, so the two
    // reading as one sentence would make the switch look like it had changed her words too.
    // ⚠️ Absent for every Point she has not ticked, so nothing on this page changes for them.
    address ? el("span", { class: "point-sub point-addr" }, address) : null,
    // ★★ AND WHICH DAYS IT IS SERVED (v419). Her words: __"every point listed in store, just that if
    // that point only for friday, then mention it"__. ⚠️⚠️ **A LINE OF ITS OWN, NOT FOLDED INTO THE
    // ONE ABOVE** — the same reason the address got its own line at v410: the description says what
    // the place IS ("where we bake"), and "only available on Fri" is a fact about WHEN, so reading
    // as one sentence would make her own words look as if they said it.
    // ⚠️ Absent for every Place she has not restricted, so nothing on this page moves for them.
    days ? el("span", { class: "point-sub point-days" }, days) : null);
    return b;
  };

  // ★★ THE BAKE DAY THIS LIST IS BEING READ ON (v420). ⚠️⚠️ NOTHING IS TAKEN OFF THE PAGE — the
  // place is still listed, still named, still in its own area; it simply cannot be PICKED on a day
  // it is not served, and it says why in the same sentence it already carries underneath.
  const dayNum = weekdayOf(wrap && wrap._day);
  const basket = Number(total) || 0;
  const judged = points.map((p) => {
    const need = pointShortfall(p, basket);
    return { p, short: need > 0, need, off: !servedOn(p, dayNum) };
  });

  // ⚠️ THE INVENTED KITCHEN ROW IS OMITTED WHEN SHE HAS MARKED ONE (v407) — the marked Point is
  // already in `judged`, under the name she gave it, so adding this one would offer the same
  // place twice. One row per place, always.
  //
  // ⚠️⚠️ AND THE MARKED KITCHEN WEARS THE KITCHEN'S OWN LINE, NOT A POINT'S (v408). v407 dropped
  // the invented row without giving the real one its words, so her own kitchen went on reading
  // __"Self collection Point — we message the exact spot…"__ — **true, and useless**: it told a
  // customer collecting AT THE BAKERY exactly what it would tell him about a friend's shop.
  // ⭐ Found by LOOKING at her live shop, where the kitchen is a Point called Sg Ara.
  // ⚠️ The KITCHEN'S line and the POINT's line are different facts and this is the one place the
  // two are chosen between; a Point's smallest basket is the only other thing that ever replaces
  // a sub, and the kitchen has none (see kitchenExempt), so the two can never both apply.
  // ★★ AND THE AREA HEADINGS (v410). Her words: __"top level is Penang Island & Prai. Under Penang
  // Island will be Area like Sg Ara, Balik Pulau, Farlim, Georgetown"__ — so a customer finds his
  // own neighbourhood instead of reading three places that name streets he has never heard of.
  //
  // ⚠️ THE HEADING IS THE AREA'S OWN NAME, drawn as her data. **No new string, in any language** —
  // which is not a shortcut but the same rule the Point names already follow (a customer reads
  // "Sg Ara" in English on a page set to Mandarin today), and it leaves the three-language
  // dictionary and its key-parity test entirely alone.
  //
  // ⚠️⚠️ IT IS DRAWN FROM THE ORDER THE LIST ARRIVES IN — the page walks the published Points and
  // puts a heading in front of the FIRST one belonging to each area. That is why the app publishes
  // the Points in the shop's own order (`shopPointOrder`): **the order and the headings are one
  // decision, taken on the other side, and this page only has to read them out.**
  // ⚠️ A Point no area carries simply draws with no heading above it, in its place at the top. It
  // is a real place a customer can collect from, so it is never hidden for want of filing.
  const areaRows = Array.isArray(CONFIG.pointAreas) ? CONFIG.pointAreas : [];
  // The first Point each area row will draw, or -1 when it draws none.
  const firstAt = new Array(areaRows.length).fill(-1);
  judged.forEach((j, i) => areaRows.forEach((a, k) => {
    if (firstAt[k] < 0 && (a.points || []).indexOf(j.p.id) >= 0) firstAt[k] = i;
  }));
  // ⚠️⚠️ AND A HEADING THAT CARRIES NOTHING OF ITS OWN STILL DRAWS (v410), which is the whole
  // reason the app sends it. **"Penang Island" holds no Point; "Sg Ara" inside it does** — and the
  // first version of this drew a heading only in front of a Point that belonged to it, so the
  // island vanished and **Sg Ara came out indented one step with nothing to be indented from**.
  // ⭐ Found by LOOKING at the page, not by a test — the fixture I had written gave every heading a
  // Point of its own, so every test passed. The app's own `groupPointsByArea` had this right from
  // the start and this page did not, which is exactly what two readers of one rule will do.
  // ⚠️ The payload already carries the depth, so a child's position folds up into its nearest
  // shallower ancestor without needing the tree here: rows are in tree order, and a row of depth
  // <= this one ends the subtree.
  for (let k = areaRows.length - 1; k >= 0; k--) {
    if (firstAt[k] >= 0) continue;
    for (let j = k + 1; j < areaRows.length; j++) {
      if (areaRows[j].depth <= areaRows[k].depth) break;
      if (firstAt[j] >= 0) { firstAt[k] = firstAt[j]; break; }
    }
  }
  const headAt = new Map();
  areaRows.forEach((a, k) => {
    if (firstAt[k] < 0) return;
    const list = headAt.get(firstAt[k]) || [];
    list.push(a);
    headAt.set(firstAt[k], list);
  });

  const out = [];
  if (!kit) out.push(row("", t("ourKitchen"), t("kitchenSub")));
  judged.forEach(({ p, short, need, off }, i) => {
    // ⚠️ Ancestors first: the rows are in tree order, so an outer heading is pushed before the
    // inner one it contains.
    for (const a of headAt.get(i) || []) {
      out.push(el("div", {
        class: "point-area",
        ...(a.depth ? { style: `--depth:${a.depth}` } : {}),
      }, a.name));
    }
    // ★★ HER OWN WORDS COME FIRST (v412). Her words: __"make the point description custmable in
    // point card"__ — so the line under a Point is hers when she has written one, and the shop's own
    // sentence when she has not. ⭐ **The standard line is the FALLBACK, not the default**: a Point
    // she has said nothing about reads exactly as it does today, so this cannot change a page by
    // being added. ⚠️ And her words replace the KITCHEN's line too — she outranks the app's own
    // wording about her own front door.
    // ⚠️ A SHORT BASKET still speaks for itself: a Point the basket has not reached says WHY on its
    // own line, because that is the one thing she can act on and her description cannot know it.
    const own = String(p.description || "").trim();
    const daysLine = pointDaysLine(p);
    out.push(row(p.id, p.name,
      short ? sub(t("pointMin"), pointMinOrder(p).toFixed(2), basket.toFixed(2))
        : (own || (p.isKitchen === true ? t("kitchenSub") : t("pointSub"))),
      // ⚠️ NO `why` ANY MORE (v423): the tap used to read the reason OUT in a box of its own, and it
      // now flashes the line the row already carries instead — so there is one place a reason is
      // said, and the page can never say one thing on the row and another on the tap.
      { short, off, address: String(p.address || ""), days: daysLine }));
  });
  list.replaceChildren(...out);

  // ⚠️ A POINT SHE PAUSED OR DELETED MUST NOT STAY CHOSEN. A customer may have picked it
  // before she took it off, and the shop cannot then post an order to a place she is no
  // longer offering — so a choice that is no longer open falls back to the kitchen, which is
  // always there. Re-applied on every repaint, so the picker and the order cannot disagree.
  const want = String(wrap._pointId || "");
  // ⚠️ AND A CHOICE THAT IS NO LONGER OPEN FALLS AWAY — including one whose SMALLEST BASKET the
  // basket has dropped below, ⚠️ AND ONE HE IS NO LONGER ABLE TO PICK BECAUSE HE MOVED THE BAKE DAY
  // (v420). A customer who chose Farlim and then switched to a Wednesday when Farlim is a Friday
  // place is not left holding somewhere he cannot collect — the same rule, on the third reason a
  // place can stop being open. ⭐ And it is the reason the day is re-read on every repaint rather
  // than only when the list is tapped: **the day can change underneath a choice already made.**
  const open = judged.find((j) => j.p.id === want && !j.short && !j.off);
  // ★★ AND NOTHING IS CHOSEN UNTIL HE TAPS ONE (v415). Her words: __"the self collect have to have
  // message follow, click to choose point, without click it should not highlight"__.
  //
  // ⚠️⚠️ IT USED TO ARRIVE WITH A PLACE ALREADY LIT — the kitchen, or the Point she marked as one —
  // and that is what her v413 picture was about: **a place wearing the panel reads as a place the
  // customer has PICKED**, and he has picked nothing. ⭐ So the picker opens on a plain list with an
  // instruction over it, **and the highlight only ever means a real tap.**
  //
  // ⚠️ AN ORDER PLACED WITHOUT CHOOSING IS UNCHANGED AND STILL WORKS: `_pointId` stays the EMPTY id,
  // which is exactly how every order has said "collect from the bakery" since long before there were
  // Points — and the card already tells him the place is messaged to him. ⭐ Nothing is refused and
  // nothing is blocked: **this is a page that stops pretending, not a page that asks a new
  // question** (her standing rule — never a gate).
  // ⚠️ A CHOICE THAT IS STILL OPEN IS RE-APPLIED, so a repaint cannot lose the one he did make.
  choose(open ? want : "", open ? open.p.name : "");
}

function refreshPointList(total = 0) {
  const wrap = document.getElementById("fulfillment");
  const list = document.getElementById("point-list");
  renderPointList(wrap, total);
  // ★★ AND THE CARD SHOWS ITS PLACES ONLY WHILE IT IS OPEN (v412). Her words: __"i want the self
  // collect card at store to be folded as default"__, and __"when it expend the unselected with a
  // white background is like a hole, and like confusing"__ — ⚠️ **which is exactly what an open
  // card full of white place rows does while the customer has already chosen the courier.**
  // ⚠️ `_open` is on the wrapper so a repaint cannot lose it, and it starts as NOTHING, so the shop
  // a customer opens shows two lines and nothing else until they act.
  // ⚠️⚠️ AND "THIS CARD IS THE CHOSEN ONE" IS PART OF THE SAME FACT, not a rule the tap has to
  // remember. Her hole was an open card of white rows in the way the customer did NOT take — and a
  // fold only the tap enforced would come back the first time anything else repainted the page.
  // **A state that must never occur is kept out of the DRAWING rather than out of the one way in.**
  // ⭐ AND SINCE v412 BOTH CARDS WORK THIS WAY — the places inside the collect card and the address
  // inside the courier's are one rule, because they are one thing: what a choice needs is part of
  // the choice. Her words: __"courier delivery and address should be one piece"__.
  const open = wrap ? wrap._open : null;
  const chosen = wrap ? wrap._value : "collect";
  if (list) list.hidden = open !== "collect" || chosen !== "collect" || !publishedPoints().length;
  // ★★ AND THE INSTRUCTION STANDS EXACTLY WHERE THE HIGHLIGHT USED TO (v415) — over the places,
  // while the card is open and NOTHING is picked. ⚠️ It goes the moment he taps one, which is the
  // rule the address list already keeps: **a page must not go on telling him to do something he has
  // just done.** ⚠️ It is authored in the markup with its own `data-i18n`, so its three languages
  // come from the dictionary and nothing here writes a word of it.
  const pickNote = document.getElementById("point-pick");
  if (pickNote) pickNote.hidden = !list || list.hidden || !!wrap._pointId;
  // ★★ AND THE PROMPT UNDER THE QUESTION STANDS WHILE NEITHER WAY IS CHOSEN (v416). ⚠️ With no card
  // edged, the two of them read as two DESCRIPTIONS rather than as two things to pick — so the
  // prompt covers the question, not one of the answers, which is why it is up there and not inside
  // a card. ⚠️ It goes the moment he picks one, the same rule the places follow.
  const prompt = document.getElementById("fulfil-pick");
  if (prompt) prompt.hidden = !!chosen;
  const addr = document.getElementById("address-field");
  if (addr) addr.hidden = open !== "courier" || chosen !== "courier";
  paintCarets();
}

// A caret is the ONLY hint that there is anything behind a line, so the one place that decides the
// folds turns both of them over — beside the thing each describes.
function paintCarets() {
  const wrap = document.getElementById("fulfillment");
  const open = wrap ? wrap._open : null;
  const set = (id, way) => {
    const caret = document.getElementById(id);
    if (caret) caret.textContent = open === way ? "▾" : "▸";
  };
  set("collect-caret", "collect");
  set("courier-caret", "courier");
}

// ★★ THE SHOP ASKS BEFORE IT TAKES SOMETHING AWAY (v436). Her words: __"a confirmation pop up,
// asking whether customer intend to change to delivery? the point selection will be cleared, vise
// versa"__ — ⭐ **the same rule she gave me for taking a bake day off at v404: taking something away
// always asks first.**
//
// ⚠️⚠️ AND THE REASON IT EXISTS IS WHAT THE CUSTOMER IS LEFT LOOKING AT. A customer who picked a
// collection point and then switched to delivery was left with **the point still selected and
// nothing saying whether it still applied to his order** — the fault v416 named, of a page that has
// answered its own question. ⭐ **The question NAMES what is lost**, the same shape as a refund that
// names the money it leaves.
//
// ⚠️ IT IS ASKED ONLY WHEN SOMETHING WOULD ACTUALLY BE CLEARED. A question guarding nothing is
// noise on a page that already carries four notices a customer must read — so `wireFulfillment`
// decides that, and this only ever draws the question.
//
// ⚠️ CANCEL IS THE SAFE ANSWER AND IT IS EVERYWHERE: the quiet button, a press on the dark area, and
// Escape all leave the page exactly as it was. ⭐ The press that OPENED the question must not
// half-apply — see `commit` in wireFulfillment, which is the only thing that changes anything.
function askSwitch({ title, body, yes, no }, onGo) {
  const scrim = document.getElementById("ask-scrim");
  const tEl = document.getElementById("ask-title");
  const bEl = document.getElementById("ask-body");
  const keep = document.getElementById("ask-keep");
  const go = document.getElementById("ask-change");
  if (!scrim || !tEl || !bEl || !keep || !go) return;   // a page without the markup says nothing

  tEl.textContent = title;
  bEl.textContent = body;
  keep.textContent = no;
  go.textContent = yes;
  // ⚠️⚠️ THE QUESTION HOLDS THE KEYBOARD AND HANDS IT BACK (v591). ⚠️ The card claims `aria-modal` but Tab
  // walked into the shop behind it and focus never returned to the control that asked — ⚠️ **a keyboard
  // customer was left at the top of the page after answering.** ⭐ The safe answer takes focus first, Tab
  // cycles the two answers, and the opener gets the keyboard back.
  const opener = (typeof document !== "undefined" && document.activeElement) || null;
  scrim.hidden = false;
  try { keep.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }

  const restore = () => {
    try { if (opener && opener.focus && opener.isConnected !== false) opener.focus({ preventScroll: true }); } catch { /* gone */ }
  };
  const close = ({ hand = true } = {}) => {
    scrim.hidden = true;
    scrim.removeEventListener("click", onScrim);
    document.removeEventListener("keydown", onKey);
    keep.removeEventListener("click", onKeep);
    go.removeEventListener("click", onGoPress);
    if (hand) restore();
  };
  // ⚠️ "AWAY" IS THE DARK AREA ITSELF — a press on the CARD must not close it, or a customer
  // aiming at a button would dismiss the question with a near miss.
  function onScrim(e) { if (e.target === scrim) close(); }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const list = [keep, go];
    const i = list.indexOf(document.activeElement);
    const at = e.shiftKey
      ? (i <= 0 ? list.length - 1 : i - 1)
      : (i === list.length - 1 || i < 0 ? 0 : i + 1);
    try { list[at].focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
  }
  function onKeep() { close(); }
  // ⚠️⚠️ THE ACTION RUNS BEFORE FOCUS IS HANDED BACK (v598). ⚠️ `close()` focused the Place row, then the
  // change rebuilt the list and removed it — ⚠️ **focus fell to the body mid-checkout.** ⭐ Close, act, restore.
  function onGoPress() { close({ hand: false }); try { onGo(); } finally { restore(); } }

  scrim.addEventListener("click", onScrim);
  document.addEventListener("keydown", onKey);
  keep.addEventListener("click", onKeep);
  go.addEventListener("click", onGoPress);
  // ⚠️⚠️ THE SAFE ANSWER KEEPS THE KEYBOARD (v595). ⚠️ This line focused the DESTRUCTIVE "Change" button,
  // overriding the safe focus above — ⚠️ **Enter/Space straight after the question cleared the customer's
  // address and place.** ⭐ The keep button was focused on open; nothing else takes it.
}

// Wire the Self collect / Courier picker. The choice is stored on the wrapper node so the
// order handler reads it back; courier reveals the address field, and collecting carries its
// own list of places inside the card.
function wireFulfillment() {
  const wrap = document.getElementById("fulfillment");
  if (!wrap) return;
  const buttons = (wrap.querySelectorAll && wrap.querySelectorAll(".seg-btn")) || [];
  // ★★ BOTH CARDS FOLD, AND `_open` IS WHICH ONE IS UNFOLDED — "collect", "courier" or null for
  // neither (v412). Her words: __"i want the self collect card at store to be folded as default"__,
  // and then __"courier delivery and address should be one piece"__ — ⭐ **one state, because only one
  // card may be open at a time**: choosing a way is what opens it, and the other closes behind it, so
  // the fields of the way the customer did NOT take are never standing open.
  if (wrap._open !== null && wrap._open !== "collect" && wrap._open !== "courier") wrap._open = null;
  const apply = (value) => {
    // ⚠️⚠️ NOTHING IS REFUSED HERE, AND THAT IS DELIBERATE (v456). `apply` is not only the press: it is
    // **also the shop's own start-up** (`apply("")` at the foot of this function) and **the after-order
    // reset** (`_resetFulfillment`). ⭐ The reset runs with an EMPTY basket — the order has just been
    // placed — so a guard in here would put "add something first" on a customer's screen at the moment
    // their order succeeded. **The refusal belongs on the PRESS; setting the state belongs here.**
    wrap._value = value;
    // ⚠️ THE OTHER CARD SHUTS. ⭐ This is the "hole" she described: an open card full of white rows —
    // or an address box — in the way the customer has already turned down.
    if (wrap._open && wrap._open !== value) wrap._open = null;
    // ⚠️ THE EDGE GOES ON THE CARD, NOT THE PRESS (v410) — the card is the choice AND what it needs
    // (the places, or the address), and a border around only the words would draw a line between one
    // decision and the thing it decides. See .seg-opt in app.css.
    for (const b of buttons) {
      const card = b.closest ? b.closest(".seg-opt") : null;
      const on = b.dataset.fulfillment === value;
      if (card) card.classList.toggle("active", on);
      else b.classList.toggle("active", on);
      // ⚠️ AND THE CHOSEN WAY IS SAID IN WORDS TOO (v583) — colour alone tells a screen reader nothing.
      if (b.setAttribute) b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    refreshPointList();
  };
  // What a tap on a PLACE calls — see renderPointList. Kept here because this is where the method
  // actually lives, and the list must not grow a second copy of that rule.
  // ★★ AND A PLACE TAP IS THE SAME CHANGE FROM THE OTHER SIDE (v436). v410 made the places PART of
  // choosing to collect, and this file's own test says it: __"there is no longer a world where
  // somebody has picked a place but has not said they are collecting."__ ⚠️ **So it goes through the
  // same question** — otherwise the page would keep a SECOND, silent door into the very state she
  // asked me to prevent: an address typed, a place picked, and the order carrying both.
  // ⚠️ IT IS REACHED ONLY BY A CUSTOMER'S TAP ON A PLACE ROW — `pickCollect` guards
  // `_value !== "collect"`, so the shop's own fallback to the kitchen never asks him anything.
  wrap._pickCollect = (then) => {
    const go = () => { if (then) then(); apply("collect"); };
    const loss = leavingFor("collect");
    if (!loss) { go(); return; }
    askSwitch({ title: loss.title, body: loss.body, yes: loss.yes, no: loss.no },
      () => { clearFor(loss.what); go(); });
  };
  // And what the AFTER-ORDER RESET calls, so putting the shop back to self collect goes through the
  // same seam as every other change — see the order handler.
  wrap._applyFulfillment = apply;
  // ⚠️ AND THE AFTER-ORDER RESET CLEARS THE PICK TOO, which is a different thing from setting the
  // method back: `_picked` is set in the TAP handler, and the reset does not go through a tap — so
  // without this a second order from the same phone would open with step 3 already green, crediting
  // the next customer with the last one's choice.
  // ★★★ AND THE CHOSEN COLLECTION CENTRE GOES WITH IT (v505).
  //
  // ⚠️⚠️ HER REPORT, AND IT IS EXACT: __"After i place order, the screen response with order confirmation, and
  // page reseted. But the earlier order, step 3 choice of self collection centre still engaged. Why it is
  // so?"__ ⭐ **THE ANSWER IS THIS ONE LINE: it cleared `_picked` and set the way back to collect — and it
  // NEVER CLEARED `_pointId`, which is WHICH CENTRE he chose.**
  // ⭐⭐ **SO THE NEXT CUSTOMER OPENED STEP 3 WITH THE LAST CUSTOMER'S COLLECTION POINT STILL CHOSEN** — and
  // because the order carries that id, **an order could be stamped with a centre the customer never picked.**
  // ⚠️ That is not a cosmetic fault, which is why it deserved a line of its own rather than being folded into
  // `apply("collect")`.
  // ⭐ AND IT USES THE SHOP'S OWN `clearFor("point")` — which clears the id AND the name AND re-marks the
  // cards — **rather than a second clearing written here.** ⚠️ **Two ways to clear one thing is two things to
  // keep right**, which this very file learned at v412 about setting the way in the first place.
  wrap._resetFulfillment = () => {
    wrap._picked = false;
    // ⚠️⚠️ AND THE WAY STAYS "collect" — I CHANGED THIS AND PUT IT BACK (v506). ⭐ Her words were about the
    // CARD, not the way: __"you clear the self collect choosen point, way not collapse the card?"__ — and I
    // read "the way" as the choice of way and made it neutral, **which broke fourteen tests and broke the
    // ORDER PATH for anybody coming back to the shop.** ⭐ **A change with a blast radius that size, made on my
    // own reading of one word, is the fault this whole day has been made of.** So the way is left exactly as
    // the shop has always left it, and what she actually named is fixed below.
    // ⚠️⚠️ JERKY RESETS TO POST (nationwide) — ITS OWN MODEL, AND WHAT ITS SHOP OPENS WITH.
    // The bakery's line reads `apply("collect")`; taking it would change how an order is placed on
    // this shop, so the default is deliberately kept. Everything ELSE the bakery added here (the
    // collection centre, the folded cards, the address, the step-4 green) comes across unchanged.
    apply("courier");
    clearFor("point");     // ⭐ no collection centre (v505)
    wrap._open = null;     // ⭐ and BOTH CARDS FOLDED (v506) — her words: __"way not collapse the card?"__
    clearFor("address");   // ⭐ and no address (v506) — the same class: the reset cleared the value and left
                           //   the rest of step 3 as the last customer had it.
    // ⭐⭐⭐ AND THE ④ BESIDE PLACE ORDER GOES OUT (v506). Her words: __"and why no4 still green?"__ — ⭐
    // **the third one she had to hand me, and the same fault again:** the green ball is set after an order
    // and nothing put it back, so **the next customer arrived at a shop with step 4 already lit** — a page
    // claiming a step is done before he has done anything, which is the fault v434 fixed for ①.
    // ⚠️ It is set HERE rather than in the order handler so that ONE function puts step 3, step 4 AND the
    // way back — **the reset is the only thing that has to be complete, and it is the only place to look.**
  };
  // ⚠️ WHAT IS ABOUT TO BE LOST, IN WORDS THAT NAME IT — or null when the change costs him nothing,
  // which is the case that must NOT be interrupted. ⭐ The name is the point he picked: "you chose to
  // collect from Bayan Lepas, Sg Ara… " is a sentence he can check against what he meant, and a
  // question that named no place would be asking him to remember.
  const leavingFor = (to) => {
    if (to === "courier" && wrap._pointId) {
      return {
        what: "point",
        title: t("askToDeliveryTitle"),
        // ⚠️⚠️ THE POINT'S OWN NAME ENDS WITH A FULL STOP — it is her record, and the shop prints it
        // as a sentence under each place. Quoting one inside another sentence produced
        // **"…Lengkok Kenari.. Changing to delivery"** on screen, seen in the driver. ⭐ So the stop
        // is trimmed HERE, where it is quoted, and **never in her record** — the same rule that
        // stops a fix in one place rewriting the thing it quotes.
        // ⚠️ ALL THREE STOPS, because a name may be written in any of the shop's languages: a plain
        // `.`, the Chinese `。` and the halfwidth `｡`.
        body: sub(t("askToDeliveryBody"), String(wrap._pointName || "").trim().replace(/[.。｡]+$/, "")),
        yes: t("askToDeliveryYes"),
        no: t("askToDeliveryNo"),
      };
    }
    if (to === "collect") {
      const box = document.getElementById("address-input");
      if ((box && String(box.value || "").trim()) || doorPin) {
        return {
          what: "address",
          title: t("askToCollectTitle"),
          body: t("askToCollectBody"),
          yes: t("askToCollectYes"),
          no: t("askToCollectNo"),
        };
      }
    }
    return null;
  };
  // ⚠️ AND THE CLEARING. Leaving collect takes the point with it; leaving courier takes the address
  // **AND the door pin he dropped FOR that address** — a pin is the door of a delivery, so an
  // address cleared without it would leave the map still answering a question he has taken back.
  const clearFor = (what) => {
    if (what === "point") {
      wrap._pointId = "";
      wrap._pointName = "";
      refreshPointList();   // ⚠️ re-applies the marker, so the place stops wearing it
      return;
    }
    const box = document.getElementById("address-input");
    if (box) box.value = "";
    doorPin = null;
    paintPin();             // ⚠️ repaints FROM `doorPin`, so the card stops showing a pin
  };

  // ★★ WHAT A PRESS ON ONE OF THE TWO WAYS DOES — the whole of it, in one function, so the DECISION
  // can be driven without the markup. ⚠️ **This shim carries no static HTML, so the two `.seg-btn`
  // rows do not exist to press** — and a test that drove a COPY of this rule would prove nothing
  // about the press. ⭐ Same seam, and the same reason, as `_pickCollect` below.
  const pressWay = (want) => {
    // ★★★ AND A WAY IS NOT CHOSEN FOR AN ORDER WITH NOTHING IN IT (v456). Her words: __"i skip step 2
    // and filled up step 3, it should not allow me to do step 3 at all?"__ — and then, when I had
    // locked only the typed boxes: __"lock the 2 delivery cards too"__.
    // ⚠️ **THAT WAS THE SAME SHAPE OF MISTAKE TWICE: I locked the thing she named and not the things
    // that sit beside it.** ⭐ Step 3 is ONE step — the name, the number AND how they get the order —
    // so locking two thirds of it is not locking it. The two cards were still pressable, and the
    // customer could still choose how to receive an order he had not placed.
    // ⭐ **AND IT IS ON THE PRESS, NOT IN `apply`, BECAUSE `apply` ALSO SETS STATE THE SHOP ITSELF
    // NEEDS** — the start-up default and the after-order reset both run with an empty basket, and
    // refusing there would tell a customer who just placed an order to add something first.
    // ⚠️⚠️ AND IT READS THE BASKET THROUGH THE PICKER'S OWN SEAM, because **this function was built
    // outside `render` and can see neither `cart` nor `sayStepFirst`.** ⭐ A direct call here is a
    // `ReferenceError` on the press and nowhere else — which is exactly how the first draft of this
    // guard failed, and why the three v436 tests caught it rather than the shop did.
    if (wrap._mayChooseWay && !wrap._mayChooseWay()) {
      // ⚠️ AND IT NO LONGER HANDS OVER THE CARD HE PRESSED (v493). It used to walk the buttons to find the
      // one that matched `want` and put the line directly above it; ⭐ **the sentence belongs to STEP 3 and
      // the page is carried to it, so which card was pressed stopped being part of the answer.**
      if (wrap._refuseWay) wrap._refuseWay();
      return;
    }
    // ⚠️ EACH LINE IS BOTH THE CHOICE AND ITS OWN FOLD'S HANDLE. Tapping the line of the way already
    // chosen therefore opens and shuts what it holds rather than doing nothing — **the second tap is
    // how a customer puts it away again**, which is the state she asked to arrive in.
    // ⚠️ AND IT ASKS NOTHING: nothing is being taken away, so there is nothing to confirm.
    if (wrap._value === want) {
      wrap._open = wrap._open === want ? null : want;
      refreshPointList();
      return;
    }
    // ★★ AND THIS IS THE TAP THAT SETTLES IT (v415) — both for the places above and for the third
    // step circle. ⚠️ `_value` already says "collect" before anyone has touched the page, so **the
    // only honest record of a customer's choice is a press.**
    // ⚠️⚠️ SO IT IS WRITTEN HERE AND NOT ON THE PRESS. A press that only OPENS A QUESTION must not
    // credit him with a choice he has not made yet — and if he answers "keep", a step circle left
    // green behind him would be exactly that fault arriving through a new door.
    const commit = () => {
      wrap._picked = true;
      if (paintStepsForFulfillment) paintStepsForFulfillment();
      // ⚠️ AND ANY OTHER TAP CHOOSES THAT WAY **AND OPENS IT** — picking one is exactly when the
      // customer needs what it asks for, so opening it is not a second favour.
      wrap._open = want;
      apply(want);
    };
    const loss = leavingFor(want);
    if (!loss) { commit(); return; }               // nothing to lose: no question at all
    askSwitch({ title: loss.title, body: loss.body, yes: loss.yes, no: loss.no },
      () => { clearFor(loss.what); commit(); });
  };
  wrap._pressWay = pressWay;

  for (const b of buttons) {
    b.addEventListener("click", () => pressWay(b.dataset.fulfillment));
  }
  // ★★★ AND THIS IS "STEP 3 AS A NEW CUSTOMER FINDS IT" — ONE FUNCTION, TWO CALLERS (v506).
  //
  // ⚠️⚠️ HER WORDS: __"you clear the self collect choosen point, way not collapse the card?"__ — ⭐ **and she
  // is pointing at a CLASS of fault, not one control: the after-order reset cleared the VALUE and the PICK and
  // left the FOLDED/OPEN state, and the address, exactly as they were.** ⚠️ **A page can be "reset" and still
  // arrive with the last customer's card hanging open in front of the next one.**
  // ⭐⭐ SO ARRIVING AND RESETTING ARE NOW THE SAME CALL — **and the two had ALREADY drifted**: arriving chose
  // NO way (v416's rule, __"self collect should not be default"__) while the after-order reset chose Self
  // collect, so a shop that opened neutral came back ENGAGED — which is the tinted card in her screenshot.
  // ⚠️ **A second way to put step 3 back is a second thing to keep right.**
  // ⚠️ AND IT IS DEFINED HERE, AFTER `clearFor`, ON PURPOSE: it is CALLED immediately below, and a call before
  // `clearFor` exists would leave the whole shop uninitialised — **which is exactly what happened the first
  // time I wrote it, and the order tests all failed at once.**
  // ⚠️⚠️ AND THE ARRIVAL ITSELF IS UNCHANGED — the three lines the page has always opened with. **Calling the
  // full `arriveFresh` here threw at start-up**, because `clearFor` reaches for the pin and the address list
  // before they exist, and the shop's own wiring never finished: **every order test failed at once, which is
  // how a start-up throw announces itself.** ⭐ So the ARRIVING job stays here, and the RESET does the full
  // job — **the reset has something to clear and the arrival does not**, which is the whole difference between
  // the two callers.
  // ⚠️ JERKY STARTS WITH POST (nationwide) CHOSEN — its own model, and what its shop does today.
  // The bakery's v416 starts with NEITHER chosen; taking that would change how an order is placed on
  // this shop, so it is left as her shop has it. The markup carries `active` on the courier card so
  // the first paint already agrees with this line. ⚠️ ARRIVAL AND RESET NOW AGREE: both say Post.
  apply("courier");
  wrap._open = null; // ⭐ and arrive with BOTH cards folded, whatever the default way is
  refreshPointList();
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
  // ⭐ AND THE OFFER COMES BACK WITH IT (v437) — the map is shut, so the way to open it is not.
  const ask = document.getElementById("pin-ask");
  if (ask) ask.hidden = false;
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
  // ★★ AND THE LINE THAT OFFERED IT GOES (v437). ⚠️ **The press does not close the box** — pressing
  // it again rebuilds the same map — so a line still saying "Door hard to find? Pin on the map"
  // while the map is open would be **a control that visibly does nothing.** ⭐ The door disappears
  // while you are through it, and comes back when the box shuts.
  const ask = document.getElementById("pin-ask");
  if (ask) ask.hidden = true;
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

function wirePin() {
  const mapBtn = document.getElementById("pin-map");
  const keep = document.getElementById("pin-keep");
  const cancel = document.getElementById("pin-cancel");
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
// The point for the suggestion the customer tapped, and then the ordinary path. ⚠️ The
// box may have moved on while the point was in the air, and that is the same staleness rule
// the geocoded rows obey: a pin is only ever an answer to the words under it.
async function resolveSuggestion(hit) {
  const input = document.getElementById("address-input");
  const q = lookupQuery(input ? input.value : "");
  const place = await lookup.detail(hit.placeId);
  if (!place) { paintPin("addrFailed"); return; }
  const now = lookupQuery(input ? input.value : "");
  if (now !== q) { paintPin("addrStale"); return; }
  takeHit({ lat: place.lat, lng: place.lng, label: String(place.label || hit.label || "") });
}

// pinWasAt is moved onto the choice as well, which is the one line here that is not
// obvious: Cancel puts the pin back to whatever it was when the map session began, and
// after this the session began at the address they just chose. Without it, picking an
// address and then pressing Cancel would throw the address away and restore the pin
// they had before they started typing — a customer undoing a decision they did not make.
function takeHit(hit) {
  // ★★ A SUGGESTION IS NOT A DOOR YET (v650). A type-ahead row carries a description and an
  // id; the point arrives only when Google is asked for that one place. ⚠️ Treating its words
  // as a door is exactly how a pin lands in the middle of a street — the fault this feature
  // was built to end — so the point is fetched first and the ordinary path runs on it.
  if (hit && hit.placeId) { resolveSuggestion(hit); return; }
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
  // ★★ AND IT DOES NOT OPEN THE MAP FOR HIM (v437). Her words: __"We should not let the map drop
  // down automatically, it should upon clicking only"__ — ⚠️ **the row tap used to unfold the whole
  // map under the button**, which is a lot of screen to hand someone who has just told us his
  // address: it pushed the rest of the page down and covered Place order with it.
  // ⭐ **THE PIN IS STILL SET — that is the line below — and `paintPin` says so in words.** The map
  // opens when he presses "Pin on the map" and not before, which also means **the map's own code and
  // tiles are not fetched at all** for the customer who never adjusts the pin. That is most of them.
  if (pinMap) pinMap.goTo(p);
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
  const phoneInput = document.getElementById("track-phone");
  const btn = document.getElementById("track-btn");
  if (!input || !btn) return;
  const go = () => trackOrder(input.value, phoneInput ? phoneInput.value : "");
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  // ⚠️ Enter in the phone box looks the order up too — the customer's hands are already there.
  if (phoneInput) phoneInput.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  // The confirmation link opens this page as /store/?track=CODE — prefill and
  // look the order up right away so the customer sees their status instantly.
  if (typeof location !== "undefined" && location.search) {
    const params = new URLSearchParams(location.search);
    const code = params.get("track");
    if (code) {
      input.value = code.replace(/^#/, "").toUpperCase();
      // ⚠️⚠️ THE LINK NO LONGER OPENS THE ORDER ON THE CODE ALONE (v558). ⭐ It fills the number in and puts
      // the cursor in the phone box: the customer still has ONE more thing to type, and that one thing is
      // what keeps a stranger from reading their address. ⚠️ The link still does its job — it lands them on
      // the card with half the answer already written.
      trackOrder(code, phoneInput ? phoneInput.value : "");
      if (phoneInput) phoneInput.focus();
      revealTrack(); // the link she tapped IS the card she should land on
      // ★★ AND THE CODE COMES OFF THE ADDRESS BAR (v324). Her report: __"when a customer track
      // his order, his store version became associated with that order code."__
      //
      // The link opens as `/store/?track=CODE` and that code used to STAY there. So the next
      // time that page was opened — a bookmark, a history entry, a link re-shared — it landed
      // back on that ONE order's card instead of on the shop, and the customer could not get
      // to the menu without knowing to strip the address themselves. **The page belonged to an
      // order rather than to the bakery.**
      //
      // ⚠️ **THE CARD ITSELF STAYS UP for this visit** — the link still does what it is for, it
      // is only the address that is cleaned. The cost is that a REFRESH now lands on the shop
      // rather than the card, which is the direction she asked for: a customer coming back to
      // order should get the shop. Their code is in their WhatsApp, and the input box takes it.
      //
      // ⚠️ **ONLY `track` IS REMOVED.** The other parameter this page carries is `via`, the
      // friend's referral stamp, and stripping that would silently break bring-a-friend for
      // anyone who arrived by a link and then tracked an order.
      if (typeof history !== "undefined" && history.replaceState) {
        const rest = new URLSearchParams(location.search);
        rest.delete("track");
        const q = rest.toString();
        try {
          history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
        } catch { /* a browser that refuses is not a reason to fail the lookup */ }
      }
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
  // ⭐ AND THE CHOSEN LANGUAGE WITH IT (v588) — the same fact in words, not only in colour.
  paintPillsHook = (l) => pills.forEach((b) => {
    const on = b.dataset.lang === l;
    b.classList.toggle("is-on", on);
    if (b.setAttribute) b.setAttribute("aria-pressed", String(on));
  });
  applyTo(document, STORE, loadLang());
  paintPillsHook(loadLang());
  pills.forEach((b) => b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    measureUpdateStrip();
  }));
  // ⚠️ And on a resize, for the same reason: a narrower window wraps the sentence onto another line.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", measureUpdateStrip);
  }
  measureUpdateStrip();
  // ⚠️⚠️ AND THE STRIP IS MEASURED AGAIN ON A LANGUAGE SWITCH (v504). ⭐ The sentence decides whether it is
  // one row or two, **and it is a different length in 中文 and Malay** — so a switch that made it taller
  // would leave the page's reserved room short and the strip would cover the foot again.
  // ⚠️ AND THE PILLS ARE WIRED ON THE LINE ABOVE: an earlier version of this deleted that line along with
  // the measuring, and this suite's own language test caught it. **Removing a block is not the same as
  // removing the lines you meant to remove.**

  // ★★★ SOMEONE LOOKING AT THE PAGE AGAIN (v497) — the trigger that actually happens.
  //
  // ⚠️⚠️ BOUND HERE, ONCE, IN THE SAME BLOCK THE PRIVACY NOTICE USES, AND FOR THE SAME REASON: **a listener
  // added inside a repaint is a listener repeated**, and an even number of them cancel out — the v350/v351
  // fault, where a control looked dead until the language was switched. ⭐ These two events never change for
  // the life of the page, so one binding each lasts it.
  //
  // ⭐ `visibilitychange` IS THE PHONE BEING PICKED UP — **the moment this whole feature is for** — and
  // `focus` is the tab or the window coming back, which on a laptop is the same act. ⚠️ Both are needed
  // because a phone and a desktop do not agree on which one fires.
  // ⚠️ A HIDDEN page is ignored: `visibilitychange` fires on the way OUT as well, and asking the clock then
  // would raise the offer onto a screen nobody is looking at.
  const shopLookedAt = () => { if (shopLookedAgain) shopLookedAgain(Date.now()); };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      shopLookedAt();
    });
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("focus", shopLookedAt);
  }
  // ⚠️⚠️ AND A FINGER ON THE PAGE COUNTS TOO — WHICH IS THE SIGNAL THAT CANNOT MISS (v498).
  //
  // ⚠️ Her report after v497: __"still no offer"__. ⭐ And v497's own mechanism was proved working — driven
  // on a HIDDEN page with the timer frozen, a `focus` brought the offer up on the receipt. **So what is left
  // is that `focus` and `visibilitychange` are not things a phone can be relied on to deliver: which of them
  // fires, and when, differs by browser, by version, and by whether the page came back from the back/forward
  // cache.**
  // ⭐ **The one signal no phone can fail to send is a finger on the glass.** A customer picking the phone up
  // touches it before they can read anything — so the first press anywhere on the page asks the clock too.
  // ⭐ It is deliberately the SAME question the other two ask (`shopLookedAgain`), so this can only ever make
  // the offer arrive, never change what it says, and never make it arrive early: **the minute is still the
  // minute.**
  // ⚠️ `pointerdown` and not `click`: a click can be swallowed by a control that stops propagation, and the
  // shop has plenty of those. A pointer going down is the plainest event there is.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("pointerdown", shopLookedAt);
  }

  // ★★ THE NOTICE'S OWN PRESS (v492) — bound here, ONCE, for the same reason the privacy notice
  // below is: the markup is static HTML that is never replaced, so one binding lasts the life of
  // the page.
  // ⚠️ IT REMEMBERS FIRST, THEN RELOADS. A browser still holding the old script serves it straight
  // back — so if this press did nothing, the remembered flag is what turns the second sight of this
  // notice into the honest "close the page completely and open it again" instead of **the same
  // button quietly doing nothing a second time.**
  // ⚠️⚠️ RELOAD STARTS THE PAGE AGAIN: the bake day, the basket and every box are gone. ⭐ Measured: a
  // customer who had picked a day, added a loaf and typed his name, number and address lost all of it to
  // one tap of the amber strip — **nothing asked, and nothing was recoverable.** ⚠️ The strip is offered
  // while he is mid-order by design, so the warning is not a nicety.
  // ⭐ ONE press warns and says what will go; a SECOND press updates, so the offer still works and nobody
  // is trapped. ⭐ Only when there is something to lose — an empty page reloads on the first press.
  let buildWarned = false;
  function orderInProgress() {
    const typed = ["name-input", "whatsapp-input", "address-input", "note-input"].some((id) => {
      const n = typeof document !== "undefined" ? document.getElementById(id) : null;
      return !!(n && String(n.value || "").trim());
    });
    if (typed) return true;
    const count = typeof document !== "undefined" ? document.getElementById("bar-count") : null;
    const n = Number(String((count && count.textContent) || "").replace(/[^\d]+/g, ""));
    return Number.isFinite(n) && n > 0;
  }
  function warnBuildOnce(btn) {
    if (buildWarned || !orderInProgress()) return false;
    buildWarned = true;
    showConfirm([
      el("p", { class: "confirm-title" }, t("buildWarnTitle")),
      el("p", { class: "confirm-body" }, t("buildWarnBody")),
    ], "warn");
    try { btn.textContent = t("buildAnyway"); } catch { /* a read-only button: the press still warned */ }
    return true;
  }

  const buildBtn = document.getElementById("build-reload");
  // ★★★ AND IT WARNS BEFORE IT THROWS AN ORDER AWAY (v555) — see `warnBuildOnce` below.
  if (buildBtn) buildBtn.addEventListener("click", () => {
    if (warnBuildOnce(buildBtn)) return;
    rememberBuildTried();
    paintBuildNotice();
    if (typeof location !== "undefined" && typeof location.reload === "function") location.reload();
  });

  // ---------------------------------------------------------------------------------
  // THE PRIVACY NOTICE UNDER PLACE ORDER — bound ONCE, here, and nowhere else.
  //
  // ⚠️ IT MUST NOT LIVE IN renderStatic(). That function runs again on every render and on
  // every language switch (its own comment says so, line ~944), so a TOGGLE bound inside it
  // is bound every time it runs. An even number of bindings cancel out and the press looks
  // DEAD; an odd number works. That is exactly what shipped in v350 and v351: pressing the
  // words did nothing on a freshly loaded shop and opened it after one language switch.
  // Anything wired here must be wired once, because the bar's markup is static HTML that is
  // never replaced — one binding lasts the life of the page.
  //
  // It opens on a CLICK and closes when the customer clicks AWAY (her words, v352: "make it
  // expend only when i click on it, away, colapse"). It opened on hover for one version and
  // she changed it the same day — and a press is the better behaviour anyway, because hover
  // does not exist on a touchscreen, so a hover-opened notice needed a second, hidden path
  // to work at all on the phones this shop is ordered from.
  //
  // ⚠️ "AWAY" MEANS OUTSIDE THE NOTICE, not outside the words. The panel lives in the same
  // wrapper, so a press on the paragraphs or on the WhatsApp link inside it leaves it open;
  // only a press outside the wrapper closes it.
  // ---------------------------------------------------------------------------------
  // ★★ ONE BEHAVIOUR, TWO PANELS (v636_2). ⚠️ The privacy notice and "Good to know" are the same kind of
  // thing — a press to open, a press away to close, Escape to close — so they share one wiring. ⭐ A second
  // copy of this logic is a second thing to keep working, and the shop has paid for that before.
  const sheet = (openId, sheetId, zoneId) => {
    const open = document.getElementById(openId);
    const panel = document.getElementById(sheetId);
    if (!open || !panel) return;
    const zone = zoneId ? document.getElementById(zoneId) : null;
    const setOpen = (o) => {
      panel.hidden = !o;
      open.setAttribute("aria-expanded", o ? "true" : "false");
    };
    const isOpen = () => open.getAttribute("aria-expanded") === "true";

    open.addEventListener("click", () => setOpen(!isOpen()));

    // ⚠️ "AWAY" IS OUTSIDE THE WORDS **AND** THE PANEL: a press on a link inside the panel must not count as
    // away, or the notice would shut while it is being read.
    document.addEventListener("click", (e) => {
      const inZone = zone ? zone.contains(e.target) : false;
      // ⚠️⚠️ THE LANGUAGE PILL IS NOT "AWAY" (v636_2). ⭐ MEASURED: reading "Good to know" and switching to
      // 中文 SHUT the panel — ⭐ **so a customer reading in the wrong language had to open it again to read the
      // same words.** A language press changes the words; it is not a press elsewhere on the page.
      const changingLanguage = e.target && e.target.closest && e.target.closest(".lang-switch");
      if (isOpen() && !inZone && !panel.contains(e.target) && e.target !== open && !changingLanguage) setOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) setOpen(false);
    });
  };

  sheet("privacy-open", "privacy-sheet", "privacy-zone");
  sheet("facts-open", "facts-sheet", null);
}
