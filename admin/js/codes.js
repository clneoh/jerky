// codes.js — sales codes: the tiny string that goes on a printed label, the URL
// it stands for, and what that code has actually brought in. Pure module, no DOM
// and no network, so the counting can be tested the same way the rest of the
// books are.
//
// A code is one label. It may point at a shop (whose samples it came from), carry
// a promotion, or just be a bring-a-friend link a customer can share. The label
// text is separate from the code so a printed card can read "Shop A" beside a QR
// whose link is only 5 characters — that is what makes two labels tellable apart
// by eye at arm's length.

import {
  groupOrders, orderLinePrice, liveOffer, waNumber, findPage,
  findCode, codeLabel, isNewCustomer,
} from "./state.js";
import { todayISO } from "./dates.js";

// What a code can be. The first kind is the default a new code starts as.
export const KINDS = [
  ["shop", "Shop", "A pet shop handing out samples. What its scans and orders bring in is counted here."],
  ["promo", "Offer", "A promotion on a product: a % or an amount off, with its own end date."],
  ["intro", "Bring a friend", "A customer shares this instead of a WhatsApp link. The credit scheme does the rest."],
  ["plain", "Plain", "Just the page, with nothing attached."],
];

export const KIND_LABEL = Object.fromEntries(KINDS.map(([id, label]) => [id, label]));

export function kindOf(code) {
  const k = String((code && code.kind) || "").trim();
  return KIND_LABEL[k] ? k : "plain";
}

// The alphabet a code is cut from. Deliberately missing 0/O/1/I/L: a customer or
// the owner may type the code by hand off a printed label, and those pairs are
// the ones people get wrong.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 5;

function randomChars(n) {
  const out = [];
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out.push(CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]);
    return out.join("");
  }
  // Same fallback the unit list uses, so nothing here depends on crypto existing.
  for (let i = 0; i < n; i++) {
    out.push(CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]);
  }
  return out.join("");
}

// A fresh code that is not already in use. `taken` is any iterable of codes —
// what matters is that a printed label is never reused for something else.
export function makeCode(taken = []) {
  const used = new Set(
    [...taken].map((c) => String((c && c.code) || c || "").trim().toUpperCase())
  );
  for (let attempt = 0; attempt < 200; attempt++) {
    const c = randomChars(CODE_LENGTH);
    if (!used.has(c)) return c;
  }
  // 31^5 is 28.6M, so reaching here means `taken` is not what we think it is.
  // Fall back to a longer code rather than ever handing back a duplicate.
  for (let attempt = 0; attempt < 200; attempt++) {
    const c = randomChars(CODE_LENGTH + 3);
    if (!used.has(c)) return c;
  }
  return randomChars(CODE_LENGTH + 6);
}

// The page a scan lands on. Built from the same origin the referral and track
// links use, so a sandbox points at the sandbox and the live site at the domain.
export function tasterUrl(code, origin = "") {
  const c = String(code || "").trim().toUpperCase();
  const base = String(origin || (typeof location !== "undefined" ? location.origin : "") || "")
    .replace(/\/+$/, "");
  return `${base}/taster/?c=${encodeURIComponent(c)}`;
}

// The owner's own quick way in to a shop that already carries a code (the shop's
// own basket, so she can place an order for it over the counter). Same shape as
// tasterUrl, one path over.
export function shopUrl(code, origin = "") {
  const c = String(code || "").trim().toUpperCase();
  const base = String(origin || (typeof location !== "undefined" ? location.origin : "") || "")
    .replace(/\/+$/, "");
  return `${base}/store/?c=${encodeURIComponent(c)}`;
}

// The URL that goes in a printed QR. It is tasterUrl for every kind, except a
// bring-a-friend label, which also carries the friend's own number as `?via=`.
//
// The number travels in the LINK, not in anything published: `?via=` is the very
// stamp the referral link already uses, so the store stamps `order.referredBy`
// and the credit scheme fires with no change to the shop and no customer number
// ever leaving the app in the published settings. It is the referring customer
// who hands that label out, exactly as they would hand out their own link.
export function labelUrl(code, origin = "") {
  const c = code || {};
  const url = tasterUrl(c.code, origin);
  const via = kindOf(c) === "intro" ? waNumber(c.referrerDigits) : "";
  return via ? `${url}&via=${encodeURIComponent(via)}` : url;
}

// "RM5 off" / "10% off", plus what has to be spent for it — the words that go on
// a label and on the shop's banner. Returns "" when there is no offer to state,
// so every caller can just leave a blank where there is nothing to say.
export function offerText(offer, cur = "RM") {
  if (!offer || typeof offer !== "object") return "";
  const value = Number(offer.value);
  if (!(value > 0)) return "";
  if (offer.type === "pct") return `${trimNum(value)}% off`;
  if (offer.type === "rm") return `${cur}${trimNum(value)} off`;
  return "";
}

// "on RM30 and above" — only when a minimum was actually given.
export function offerMinText(offer, cur = "RM") {
  const min = Number((offer && offer.minSpend) || 0);
  if (!(min > 0)) return "";
  return `on ${cur}${trimNum(min)} and above`;
}

// The whole offer in one line for a row's sub-line, e.g.
// "RM5 off on RM30 and above · until 31 Oct". "" when there is nothing to state.
export function offerLine(offer, cur = "RM", today = "") {
  const text = offerText(offer, cur);
  if (!text) return "";
  const bits = [text];
  const min = offerMinText(offer, cur);
  if (min) bits.push(min);
  if (offer.newOnly) bits.push("new customers only");
  const to = String(offer.to || "");
  if (to) bits.push(today && today > to ? "ended" : `until ${to}`);
  return bits.join(" · ");
}

function trimNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return String(Math.round(v * 100) / 100);
}

// What the label an order came in on promised, and the two things about it only
// the book can answer. Display only, always: this states; it never works out a
// discount or touches a figure any money reader looks at. The customer's page
// takes no money off either, so the amount she takes off at confirmation is hers
// to decide — exactly how a bring-a-friend credit is already applied.
//
// The code is resolved LIVE through the code list rather than copied onto the
// order, because an order deliberately carries only the code and its kind: a
// label she has since renamed reads right here, and a code she has since deleted
// still leaves the kind the order recorded at the time.
//
// The name is the label's own (`codeLabel`). A code record holds only the ids of
// the shop and product it was made for — their names are written onto the
// published payload for the customer's page and never stored here — so naming
// them from this module would be reading a shape the app does not write.
//
// `overMin` and `newCustomer` both read TRUE when they do not apply, so the view
// only ever has to test for a warning. `newCustomer` is the whole reason the
// customer's page cannot decide any of this: "new customers only" needs every
// other order in the book, which only this app has.
//
// `total`, when given, is used instead of the order's own: the Edit pop-up is
// mid-edit there, and a minimum warning measured off the saved items would
// disagree with the "Order total:" line she is watching. Returns null when the
// order carries no code at all.
export function promoOf(state, group, today = todayISO(), total = null) {
  const rows = (group && group.orders) || (Array.isArray(group) ? group : []);
  const first = rows[0];
  const code = String((first && first.promoCode) || "").trim().toUpperCase();
  if (!code) return null;

  const cur = (state.settings && state.settings.currency) || "RM";
  const sum = total == null
    ? rows.reduce((acc, o) => acc + (Number(o.qty) || 0) * (orderLinePrice(state, o) || 0), 0)
    : Number(total) || 0;

  const rec = findCode(state, code);
  if (!rec) {
    // She deleted the code (or it never synced to this phone). The order still
    // records what the customer came in on, so the line names it and says so
    // rather than going blank.
    return {
      code, kind: kindOf({ kind: first.codeKind }), name: "", offer: null, live: null,
      retired: false, gone: true, total: sum, cur, overMin: true, newCustomer: true,
    };
  }

  const offer = rec.offer || null;
  const live = liveOffer(rec, today);
  const name = codeLabel(rec);
  const min = live ? Number(live.minSpend) || 0 : 0;
  // isNewCustomer reads a number-less order as "not new" (there is nothing to key
  // on, so the offer stays off there). The question HERE is only whether to warn
  // her, and a warning she cannot act on is worse than none — so an order with no
  // number gets no verdict rather than a wrong one. A shop order always carries
  // one, which leaves this to the hand-typed corner.
  const keyable = Boolean(waNumber(first && first.whatsapp));

  return {
    code, kind: kindOf(rec), name, offer, live,
    retired: rec.active === false,
    gone: false,
    total: sum, cur,
    overMin: !(min > 0) || sum >= min,
    newCustomer: !live || live.newOnly !== true || !keyable
      || isNewCustomer(state, { orders: rows }),
  };
}

// Everything a code has brought in, counted off the orders themselves.
//
// The stamp is `order.promoCode`, written when the customer's own order is built
// from the shop (see store/app.js) and carried into the book by importIncoming.
// Orders she types in by hand carry no stamp, which is deliberate: a counter
// sale is not evidence of what a printed label did.
export function codeStats(state, code) {
  const want = String((code && code.code) || "").trim().toUpperCase();
  const empty = { orders: 0, units: 0, sales: 0, firstAt: "", lastAt: "" };
  if (!want) return empty;
  const mine = (state.orders || []).filter(
    (o) => String((o && o.promoCode) || "").trim().toUpperCase() === want
  );
  if (!mine.length) return empty;

  let sales = 0;
  let units = 0;
  let firstAt = "";
  let lastAt = "";
  for (const o of mine) {
    sales += (Number(o.qty) || 0) * (orderLinePrice(state, o) || 0);
    units += Number(o.qty) || 0;
    const at = String(o.createdAt || o.deliveryDate || "");
    if (at && (!firstAt || at < firstAt)) firstAt = at;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }
  return { orders: groupOrders(mine).length, units, sales, firstAt, lastAt };
}

// How many distinct people a code has reached: the WhatsApp numbers on its
// orders, counted the digits-only way so one person does not read as three.
export function codeCustomers(state, code) {
  const want = String((code && code.code) || "").trim().toUpperCase();
  if (!want) return [];
  const seen = new Map();
  for (const o of state.orders || []) {
    if (String((o && o.promoCode) || "").trim().toUpperCase() !== want) continue;
    const key = waNumber(o.whatsapp) || "?";
    if (!seen.has(key)) seen.set(key, { key, name: String(o.customerName || "").trim(), orders: 0 });
    seen.get(key).orders += 1;
  }
  return [...seen.values()].sort((a, b) => b.orders - a.orders);
}

// The labels for one printed sheet, in the order they should be cut. The owner
// asked for a small label she can eye-identify, so every one carries its own
// code in small type beside the QR — never a sheet of identical-looking squares.
export function sheetLabels(code, count, max = 60) {
  const n = Math.max(1, Math.min(Number(count) || 1, max));
  return Array.from({ length: n }, () => code);
}

// Visits recorded on the landing page, for one code or for all of them. `rows`
// are the {code, pet} rows /taster/ writes; anything without a code counts only
// towards the total, so a page opened by a typed link is still a visit.
export function visitTally(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byCode = new Map();
  const pets = { dog: 0, cat: 0, none: 0 };
  for (const r of list) {
    const c = String((r && r.code) || "").trim().toUpperCase();
    if (c) byCode.set(c, (byCode.get(c) || 0) + 1);
    const pet = String((r && r.pet) || "").trim().toLowerCase();
    if (pet === "dog" || pet === "cat") pets[pet] += 1;
    else pets.none += 1;
  }
  return { total: list.length, byCode, pets };
}

// ── what leaves the app ──────────────────────────────────────────────────
// The published half of this feature. Everything below is deliberately narrow:
// a customer's page may see a code, what it offers and the name of the shop that
// handed it out — never a shop's WhatsApp number, its commission rate, or any
// note you keep about it. Those stay in the app, on her own phones.

// The landing page's own words: a heading, and the paragraph under it, each in
// English / 中文 / BM. Deliberately the SAME shape whether the words come from the
// shared page's settings or from one code — that is what lets the page treat a
// code's blank line as "use the shared page's line" rather than as an empty line,
// resolved separately per language (see codeCopy in /taster/).
// The landing page a label reads, or null when it reads the shared page. A label
// whose page was deleted resolves to null, so its words fall back rather than
// disappearing — the page is only ever a layer over the shared one.
export function pageOf(state, code) {
  return findPage(state, code && code.pageId);
}

// How many labels read a page. Shown on the page's row and in the confirm that
// deletes it, because deleting a page moves every one of those labels back to the
// shared page's words.
export function pageStats(state, pageId) {
  const want = String(pageId || "").trim();
  if (!want) return { labels: 0 };
  return {
    labels: (Array.isArray(state.codes) ? state.codes : [])
      .filter((c) => c && String(c.pageId || "").trim() === want).length,
  };
}

// The words a label reads when it says nothing for itself, as one object: the page
// it picked laid over the shared page. The same three layers publishCodes resolves,
// in the same order, so the greyed line the editor shows in an empty box is exactly
// the line a customer would read — and a page's own blank line shows the shared
// page's line rather than an empty box.
export function linesFor(state, code, shared) {
  const out = { ...(shared || {}) };
  pageLines(pageOf(state, code), out);
  return out;
}

function pageLines(src, out = {}) {
  const t = src || {};
  for (const k of ["heading", "body"]) {
    const en = String(t[k] || "").trim();
    if (en) out[k] = en;
    // A translated box is published only when it was actually filled, so an
    // untranslated line shows the English rather than nothing.
    for (const suf of ["Zh", "Ms"]) {
      const v = String(t[k + suf] || "").trim();
      if (v) out[k + suf] = v;
    }
  }
  return out;
}

// The active codes a customer's page may resolve. A retired code is left out — its
// link still opens, but it resolves to nothing, which is what retiring it means.
// A code whose offer has run out is NOT left out: the label is already in someone's
// hand, so the page still answers it, stating no offer (liveOffer returns null and
// no `offer` key is published at all).
export function publishCodes(state, today = todayISO()) {
  const cur = (state.settings && state.settings.currency) || "RM";
  return (Array.isArray(state.codes) ? state.codes : [])
    .filter((c) => c && c.active !== false && String(c.code || "").trim())
    .map((c) => {
      const out = { code: String(c.code).trim().toUpperCase(), kind: kindOf(c) };
      // The words a customer reads, in the order they override each other: the
      // page this label picked first, then whatever the label wants to say for
      // itself. Only non-blank lines are written, so a blank one falls through to
      // the shared page's line rather than blanking it — and the page id itself is
      // never published, so the customer's page still sees one flat shape.
      pageLines(pageOf(state, c), out);
      pageLines(c, out);
      // A shop's card says which shop it came from — by NAME only.
      if (out.kind === "shop") {
        const p = (state.partners || []).find((x) => x && x.id === c.partnerId);
        const name = p && p.active !== false && String(p.name || "").trim();
        if (name) out.partnerName = name;
      }
      // An offer names the product it is for, so the page can say what it applies to.
      if (out.kind === "promo") {
        const prod = (state.products || []).find((x) => x && x.id === c.productId);
        const name = prod && String(prod.name || "").trim();
        if (name) out.productName = name;
      }
      const off = liveOffer(c, today);
      if (off) {
        out.offer = {
          type: off.type,
          value: off.value,
          minSpend: off.minSpend,
          to: off.to,
          newOnly: off.newOnly,
          cur,
        };
      }
      return out;
    });
}

// The landing page's own copy, in whatever she has written. Blank stays blank —
// the page carries its own fallback wording, so an empty box here never leaves a
// customer staring at nothing, and the app keeps no second copy of the words.
export function publishTaster(state) {
  const t = (state.settings && state.settings.taster) || {};
  const sf = (state.settings && state.settings.storefront) || {};
  const out = {
    askPet: t.askPet !== false,
    follow: t.follow !== false,
    instagram: String(sf.instagram || "").trim(),
    shop: String(sf.name || "").trim(),
  };
  return pageLines(t, out);
}
