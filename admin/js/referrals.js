// referrals.js — bring-a-friend: scheme numbers, a customer's share link, and
// the credit ledger behind "one RM3 coupon per NEW friend". Pure module (no DOM,
// no localStorage) so the views call these + ui.js and Node tests cover the
// rules.
//
// How it stays honest with a guest-checkout shop: the storefront never reads
// order history and never discounts — it only stamps `referredBy` (the
// referrer's WhatsApp digits) on the order. Whether the friend is NEW is decided
// here in the admin, where the full history exists, and the owner stays the
// decider: one tap Give credit / Skip. She applies the actual RM amounts herself
// when she confirms each order on WhatsApp.

import { fmtRM, groupOrders, isNewCustomer, newId, orderCode, round2, waNumber } from "./state.js";
import { codesOf, normCode } from "./promo.js";
import { addDays, todayISO } from "./dates.js";
import { nameFor, servingFor } from "../../i18n.js";
import { FOLLOWUP, fmtFollowup } from "./followup-lang.js";

const DEFAULT_SCHEME = { enabled: false, friendRM: 3, referrerRM: 3, validDays: 90 };

export const ROLE_LABEL = {
  reward: "Referral coupon",
  friendOff: "Friend's discount",
};

// The scheme the owner set (More → Settings → Referrals). Never lets a
// hand-edited or half-synced value crash the screens: missing/blank fields fall
// back to the defaults. `validDays` is a number of days, or "" = never expires.
// A missing validDays (never configured) means the default; a stored "" is the
// owner explicitly choosing never.
export function schemeOf(state) {
  const s = ((state && state.settings && state.settings.referrals) || {});
  const amount = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? round2(n) : fallback;
  };
  const rawDays = s.validDays;
  let validDays = DEFAULT_SCHEME.validDays;
  if (rawDays === "") validDays = "";
  else if (rawDays != null) {
    const n = Number(rawDays);
    if (Number.isInteger(n) && n > 0) validDays = n;
  }
  return {
    enabled: s.enabled === true,
    friendRM: amount(s.friendRM, DEFAULT_SCHEME.friendRM),
    referrerRM: amount(s.referrerRM, DEFAULT_SCHEME.referrerRM),
    validDays,
  };
}

// A referrer's personal link, e.g. https://your-domain/store/?via=60123456789.
// Mirrors the order-tracking link shape so the shop's `via` and `track` share
// one URL pattern. Blank digits → "" (callers guard on it).
export function referralLink(origin, digits) {
  const d = waNumber(digits);
  if (!d) return "";
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/store/?via=${d}`;
}

// The expiry date a new credit gets: `validDays` days after `today`, or "" when
// the scheme says never (blank). A blank value means no expiry is ever written.
export function expiryDate(validDays, today) {
  if (validDays === "" || validDays == null) return "";
  const n = Number(validDays);
  if (!(n > 0)) return "";
  return addDays(today, Math.floor(n));
}

// The ready-to-send WhatsApp text the owner copies for a customer, built from
// the live scheme numbers and that customer's own link. Amounts are fine here —
// this is the owner talking to her referrer, and she is in control of both.
export function shareMessage(state, r, origin) {
  const scheme = schemeOf(state);
  const digits = waNumber(r && r.whatsapp);
  const link = referralLink(origin, digits);
  const name = r && r.name && r.name !== "(no name)" ? r.name : "";
  const bakery = String((state.settings && state.settings.storefront
    && state.settings.storefront.name) || "Munchies Furkidz").trim();
  const cur = (state.settings && state.settings.currency) || "RM";
  const validity = scheme.validDays === "" || scheme.validDays == null
    ? "Your coupon never expires."
    : `Each coupon is valid ${scheme.validDays} days from when your friend orders.`;

  const lines = [];
  if (name) lines.push(`Hi ${name}! ${bakery} has a bring-a-friend deal 🐾`);
  else lines.push(`${bakery} has a bring-a-friend deal 🐾`);
  lines.push("");
  lines.push(`• A friend who is NEW to us gets ${fmtRM(scheme.friendRM, cur)} off their FIRST order`);
  // ★ THE RULE IS STATED WHERE SHE PROMISES IT (v314). Her words: __"we can
  // state, only one coupon apply for each purchase."__ A friend forwarding this
  // is the first place the deal is written down, so it is where the rule belongs.
  lines.push(`• For every friend who orders, you get a ${fmtRM(scheme.referrerRM, cur)} coupon for a future order — one coupon per order`);
  lines.push("");
  lines.push("Your personal link to share:");
  lines.push(link);
  lines.push("");
  lines.push(validity);
  return lines.join("\n");
}

// A warmer follow-up variant for the "are you happy with the {product}?"
// check-in after a delivery — personalised with the thing they just bought,
// a serving recommendation from the product's Serving tip, and the same scheme
// numbers + link as shareMessage, phrased as a chat. No product → the message
// asks generally about their order instead. `product` may be a product row or
// just its name.
//
// `lang` ("en" | "zh" | "ms") picks the language the whole message is written
// in — the baker copies it to a customer who reads that language. The product
// name and serving tip use the product's own 中文 / BM text when written (nameFor
// / servingFor fall back to English). English stays the default and reads
// byte-for-byte as it always did.
export function followupMessage(state, r, product, origin, lang = "en") {
  const scheme = schemeOf(state);
  const digits = waNumber(r && r.whatsapp);
  const link = referralLink(origin, digits);
  const name = r && r.name && r.name !== "(no name)" ? r.name : "";
  const cur = (state.settings && state.settings.currency) || "RM";
  const t = FOLLOWUP[lang] || FOLLOWUP.en;
  const validity = scheme.validDays === "" || scheme.validDays == null
    ? t.neverExpires
    : fmtFollowup(t.validDays, { n: scheme.validDays });
  const pname = String((product && typeof product === "object" && product.name) || product || "").trim();
  const serve = product && typeof product === "object"
    ? String(product.servingTip || "").trim() : "";
  // Localized product name + serving tip when the customer's language has its
  // own words for them; otherwise the English text rides along.
  const isRow = !!(product && typeof product === "object");
  const langName = (isRow && lang !== "en" && nameFor(product, lang)) || pname;
  const langServe = (isRow && lang !== "en" && servingFor(product, lang)) || serve;

  const lines = [];
  const greeting = name ? `${t.hi} ${name}! ` : "";
  if (pname) {
    lines.push(`${greeting}${fmtFollowup(t.howProduct, { p: langName })}`);
    if (langServe) lines.push(fmtFollowup(t.serving, { tip: langServe }));
  } else {
    lines.push(`${greeting}${fmtFollowup(t.howOrder)}`);
  }
  lines.push("");
  lines.push(fmtFollowup(t.pitch, {
    off: fmtRM(scheme.friendRM, cur),
    ref: fmtRM(scheme.referrerRM, cur),
  }));
  lines.push("");
  lines.push(t.yourLink);
  lines.push(link);
  lines.push("");
  lines.push(validity);
  return lines.join("\n");
}

// A referrer's saved name (first non-blank customer name on any of their
// orders), or "" when they have never ordered / aren't saved yet.
export function referrerName(state, digits) {
  const d = waNumber(digits);
  if (!d) return "";
  for (const o of state.orders || []) {
    if (waNumber(o.whatsapp) === d) {
      const n = String(o.customerName || "").trim();
      if (n) return n;
    }
  }
  return "";
}

// Where an order with a `referredBy` stamp sits: "self" (they used their own
// link), "existing" (the friend already ordered before → not a NEW friend), or
// "new" (never ordered → earns a credit). No stamp → "none". Whether the friend
// is new is `isNewCustomer`'s question, defined once in state.js and shared with
// every sales code marked "new customers only".
export function referralFlag(state, group) {
  const orders = (group && group.orders) || [];
  const first = orders[0];
  if (!first) return "none";
  const via = waNumber(first.referredBy);
  if (!via) return "none";
  const me = waNumber(first.whatsapp);
  if (me && me === via) return "self";
  if (!me) return "none";
  return isNewCustomer(state, group) ? "new" : "existing";
}

// The credit rows for one holder (by WhatsApp digits), most useful first: valid
// credits with the soonest expiry on top, then used, then expired. Rows carry a
// `status` field so views can chip them without a second scan.
export function creditRows(state, whatsapp, today = todayISO()) {
  const holder = waNumber(whatsapp);
  if (!holder) return [];
  const mine = (state.credits || [])
    .filter((c) => c && waNumber(c.holder) === holder)
    .map((c) => ({ ...c, status: creditStatus(c, today) }));
  const rank = { valid: 0, used: 1, expired: 2 };
  mine.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r) return r;
    if (a.status === "valid") {
      const ea = a.expiresAt || "9999";
      const eb = b.expiresAt || "9999";
      if (ea !== eb) return ea < eb ? -1 : 1;
    }
    return String(b.earnedAt || "").localeCompare(String(a.earnedAt || ""));
  });
  return mine;
}

export function validCredits(state, whatsapp, today = todayISO()) {
  return creditRows(state, whatsapp, today).filter((c) => c.status === "valid");
}

// ★★ THE FRIEND'S DISCOUNT, ON THE ORDER ITSELF (v322).
//
// ⚠️⚠️ **IT WAS NEVER TAKING ANYTHING OFF, AND THAT WAS THE WHOLE FAULT.** `giveCredits`
// wrote the friend a coupon — *"First order — via X's link"* — and then **nothing read it**:
// the order's Total, the confirmation and the three later messages are all worked out by
// `customerTotal`, which knew about promo CODES and nothing else. So the coupon was
// recorded, the order was priced as if it did not exist, and pressing **Apply coupon** said
// *"already taken off this order"* about a figure nothing had ever taken off. Her words:
// **"the bring a friend discount used but not really create a discount for that new
// customer."**
//
// It was built that way on purpose — the scheme's first rule was *"the app records what is
// owed; you apply the real discount yourself when you confirm"* — which made sense until the
// app learned to take a CODE off by itself (v272). A code comes off, shows its working in
// every message and names itself; the friend's coupon did none of those.
//
// **THE MATCH IS BY ORDER CODE, NOT BY "THE CUSTOMER'S VALID COUPONS".** The coupon is born
// ON this order, so `orderCode` is already on it, and matching by that is exact — it cannot
// pick up the referrer's reward (which is for a LATER order), it cannot leak the discount
// onto the friend's second order, and it does not care whether the coupon reads as used,
// because being spent on this order is exactly what it is.
export function couponOn(state, orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const first = rows[0];
  if (!first) return { amount: 0, id: "", code: "" };
  const code = orderCode(first);
  if (!code) return { amount: 0, id: "", code: "" };
  const friend = waNumber(first.whatsapp);
  const hit = (state.credits || []).find((c) => c
    && c.role === "friendOff"
    && String(c.orderCode || "") === code
    && Number(c.amountRM) > 0
    // ⚠️ The holder is checked as well, and deliberately: `orderCode` is unique by
    // construction, so this can only ever fail on a hand-edited record — and a discount
    // landing on the wrong person's order is the one outcome worth guarding against twice.
    && (!friend || waNumber(c.holder) === friend));
  if (!hit) return { amount: 0, id: "", code: "" };
  return { amount: round2(Number(hit.amountRM)), id: hit.id, code };
}

// The live state of one credit. A used credit stays used; an expired credit is
// greyed; "" expiry never expires. Still valid ON its expiry day (compares the
// full ISO dates, so "2026-12-04" is fine until 2026-12-05).
export function creditStatus(credit, today = todayISO()) {
  if (!credit) return "used";
  if (credit.usedAt) return "used";
  const exp = credit.expiresAt;
  if (exp && String(exp) < today) return "expired";
  return "valid";
}

// Give the two credits a NEW referred order earns: a `reward` for the referrer
// and a `friendOff` for the friend, both expiring per the scheme. Idempotent by
// order code, so a re-render or a double tap can never double-give. Returns
// {created, rows|reason}.
export function giveCredits(state, group, scheme = schemeOf(state), today = todayISO()) {
  const first = (group && group.orders && group.orders[0]) || null;
  if (!first) return { created: false, reason: "no order" };
  const referrer = waNumber(first.referredBy);
  if (!referrer) return { created: false, reason: "no referrer on the order" };
  const friend = waNumber(first.whatsapp);
  if (friend && friend === referrer) {
    return { created: false, reason: "they ordered through their own link" };
  }
  const code = orderCode(first);
  if ((state.credits || []).some((c) => c.orderCode === code)) {
    return { created: false, reason: "already given" };
  }
  const exp = expiryDate(scheme.validDays, today);
  const earnedAt = first.createdAt || new Date().toISOString();
  const referrerNameStr = referrerName(state, referrer) || `${referrer} (new)`;
  const friendName = String(first.customerName || "").trim() || `${friend} (new)`;
  const rows = [];
  if (Number(scheme.referrerRM) > 0) {
    rows.push({
      id: newId("crd"),
      holder: referrer,
      holderName: referrerNameStr,
      amountRM: scheme.referrerRM,
      role: "reward",
      earnedAt,
      expiresAt: exp,
      usedAt: null,
      orderCode: code,
      note: `Brought ${friendName} as a new customer`,
    });
  }
  if (Number(scheme.friendRM) > 0 && friend) {
    // ★★ AND IT IS SPENT THE MOMENT IT IS MADE, because it comes off THIS order (v322).
    // Her complaint was that it was recorded and never taken off; the other half of making
    // it come off is that it must not come off TWICE — once on this order, and again as a
    // "ready" coupon on the customer's card where she would reasonably press Apply a second
    // time.
    //
    // ⚠️ **UNLESS THE ORDER CARRIED A CODE.** Her rule is one coupon per order (v314), and if
    // a code is on the order the CODE wins the Total (see `customerTotal`) — so the friend's
    // coupon was not spent, and is left UNUSED and valid, theirs to use on the next order.
    // Reading `first.promo` here rather than calling `promoOn` is deliberate: importing
    // courier.js would make a cycle, and whether a code is ON the order is all this needs.
    const codeWins = !!String(first.promo || "").trim();
    rows.push({
      id: newId("crd"),
      holder: friend,
      holderName: friendName,
      amountRM: scheme.friendRM,
      role: "friendOff",
      earnedAt,
      expiresAt: exp,
      usedAt: codeWins ? null : (first.createdAt || new Date().toISOString()),
      orderCode: code,
      note: `First order — via ${referrerNameStr}’s link`,
    });
  }
  if (rows.length) (state.credits ||= []).push(...rows);
  return { created: rows.length > 0, rows };
}

// Apply a credit: marks the holder's oldest valid unused credit as used and
// returns it (the owner has applied that RM off in WhatsApp). Nothing to use →
// null. Finds the original state row (creditRows returns copies, so mutating
// them would never persist).
export function markOneUsed(state, whatsapp, now = new Date().toISOString()) {
  const sorted = validCredits(state, whatsapp);
  if (!sorted.length) return null;
  const row = (state.credits || []).find((c) => c.id === sorted[0].id);
  if (row) row.usedAt = now;
  return row || null;
}

export function markCreditUsed(state, id, now = new Date().toISOString()) {
  const c = (state.credits || []).find((x) => x.id === id);
  if (c && !c.usedAt) c.usedAt = now;
  return c || null;
}

// Change (or clear) one credit's expiry. A blank / malformed date means "never
// expires" — the owner can shorten or drop an expiry whenever she wants.
export function setCreditExpiry(state, id, date) {
  const c = (state.credits || []).find((x) => x.id === id);
  if (!c) return null;
  c.expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : "";
  return c;
}

export function removeCredit(state, id) {
  state.credits = (state.credits || []).filter((x) => x.id !== id);
}

// A manual credit for an offline referral the owner brought in herself (role
// "reward"). expiry from validDays, "" when never.
export function addManualCredit(state, { whatsapp, name = "", amountRM, validDays = "", note = "", today = todayISO() }) {
  const holder = waNumber(whatsapp);
  if (!holder) return null;
  const credit = {
    id: newId("crd"),
    holder,
    holderName: String(name || "").trim() || (holder + " (new)"),
    amountRM: Math.max(0, round2(Number(amountRM) || 0)),
    role: "reward",
    earnedAt: today,
    expiresAt: expiryDate(validDays, today),
    usedAt: null,
    orderCode: "",
    note: String(note || "").trim(),
  };
  (state.credits ||= []).push(credit);
  return credit;
}

// ── the reward, exercised (v291) ───────────────────────────────────────────
//
// The reward itself is her own words on the profile (`reward`) plus a NUMBER
// (`rewardEvery`). The number is its own box and is NEVER parsed out of her
// sentence: a parser that misread "every five friends" would tell her a partner
// is owed a loaf she is not, and every one of these is settled by hand.
//
// This section derives two things and records one:
//   · broughtIn — how many people the advocate actually brought, recounted from
//                 her own orders every time, so nothing can ever double-count.
//   · grants    — how many rewards she has already handed over. RECORDS, one per
//                 hand-out, so two phones can never overwrite each other's.
//
// WHICH IS THE WHOLE POINT OF THE SHAPE. A count kept on the profile would be a
// single value under the sync layer's last-write-wins, so the phone that saved
// last would silently discard the other's grant. A LIST of records cannot lose
// an update — the same reason the credit ledger above is a list.

// The carts an advocate is responsible for, as a Set of group keys.
//
// THE TWO TIERS ARE ONE UNION, not two sums, because the same person can be in
// both — a friend who shared a link AND a partner whose code is on a card — and
// one cart could arrive carrying both. Counting each tier separately would let
// that cart count twice.
function broughtGroups(state, digits, theirCodes) {
  const out = new Set();
  for (const group of groupOrders((state && state.orders) || [])) {
    const first = (group.orders || [])[0];
    if (!first) continue;
    const byCode = theirCodes.size > 0 && theirCodes.has(normCode(first.promo));
    // `referralFlag` is the SAME rule the Give-credit button reads, so a cart
    // that only counts as "existing" there cannot count as a new customer here.
    const byLink = !!digits && waNumber(first.referredBy) === digits
      && referralFlag(state, group) === "new";
    if (byCode || byLink) out.add(String(first.groupId || first.id || ""));
  }
  return out;
}

// How many people this advocate brought in — one number whether they arrived as
// a friend with a link or a partner with a code. Identity is the DIGITS for a
// link (that is what `referredBy` holds) and the profile's own stable `id` for a
// code (v289: `keyOf` moves when a number is corrected, so it cannot hold this).
export function broughtIn(state, { whatsapp = "", profileId = "" } = {}) {
  const digits = waNumber(whatsapp);
  const theirCodes = new Set(
    (profileId ? codesOf(state) : [])
      .filter((c) => c.holder && c.holder.id === profileId && c.code)
      .map((c) => c.code));
  if (!digits && !theirCodes.size) return 0;
  return broughtGroups(state, digits, theirCodes).size;
}

// Every reward handed to this person, newest first — so the Undo press beside
// the count always undoes the last thing she did.
export function rewardGrants(state, profileId) {
  const id = String(profileId || "");
  if (!id) return [];
  return (state.rewards || [])
    .filter((x) => x && x.profileId === id)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

// Everything the profile card needs, in one place: what they brought in, how
// many they have been given, and how many are due.
//
// `every` of 0 means she has not set a number ("a favour, whenever") — the words
// still show and the count is still honest, there is simply nothing to divide by
// and so nothing is ever due. `due` never goes negative: giving early is allowed
// and settles the favour, it does not put her in the customer's debt.
export function rewardStanding(state, profile, { whatsapp = "" } = {}) {
  const every = Math.floor(Number((profile && profile.rewardEvery) || 0)) || 0;
  const came = broughtIn(state, { whatsapp, profileId: (profile && profile.id) || "" });
  const grants = rewardGrants(state, (profile && profile.id) || "");
  const earned = every > 0 ? Math.floor(came / every) : 0;
  return { every, came, given: grants.length, earned, due: Math.max(0, earned - grants.length), grants };
}

// Hand over a reward: push ONE record. `came` snapshots what they had brought in
// at that moment, so the record still reads honestly after later orders arrive
// and the count has moved on.
export function giveReward(state, { profileId, holder = "", holderName = "", what = "", came = 0, note = "" }, now = new Date().toISOString()) {
  const id = String(profileId || "");
  if (!id) return null;
  const rec = {
    id: newId("rwd"),
    profileId: id,
    holder: waNumber(holder) || "",
    holderName: String(holderName || "").trim(),
    what: String(what || "").trim(),
    came: Math.max(0, Math.floor(Number(came) || 0)),
    at: now,
    note: String(note || "").trim(),
  };
  (state.rewards ||= []).push(rec);
  return rec;
}

// Take a hand-out back — a mis-tap, or a reward handed over and then returned.
export function removeRewardGrant(state, id) {
  const want = String(id || "");
  if (!want) return false;
  const before = (state.rewards || []).length;
  state.rewards = (state.rewards || []).filter((x) => !x || x.id !== want);
  return state.rewards.length < before;
}
