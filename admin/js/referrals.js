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

import { fmtRM, newId, orderCode, round2, waNumber } from "./state.js";
import { addDays, todayISO } from "./dates.js";

const DEFAULT_SCHEME = { enabled: false, friendRM: 3, referrerRM: 3, validDays: 90 };

export const ROLE_LABEL = {
  reward: "Referral credit",
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
    ? "Your credit never expires."
    : `Each credit is valid ${scheme.validDays} days from when your friend orders.`;

  const lines = [];
  if (name) lines.push(`Hi ${name}! ${bakery} has a bring-a-friend deal 🐾`);
  else lines.push(`${bakery} has a bring-a-friend deal 🐾`);
  lines.push("");
  lines.push(`• A friend who is NEW to us gets ${fmtRM(scheme.friendRM, cur)} off their FIRST order`);
  lines.push(`• For every friend who orders, you get ${fmtRM(scheme.referrerRM, cur)} off a future order`);
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
export function followupMessage(state, r, product, origin) {
  const scheme = schemeOf(state);
  const digits = waNumber(r && r.whatsapp);
  const link = referralLink(origin, digits);
  const name = r && r.name && r.name !== "(no name)" ? r.name : "";
  const cur = (state.settings && state.settings.currency) || "RM";
  const validity = scheme.validDays === "" || scheme.validDays == null
    ? "Your credit never expires."
    : `Each credit is valid ${scheme.validDays} days from when your friend orders.`;
  const pname = String((product && typeof product === "object" && product.name) || product || "").trim();
  const serve = product && typeof product === "object"
    ? String(product.servingTip || "").trim() : "";

  const lines = [];
  if (pname) {
    lines.push(`${name ? `Hi ${name}! ` : ""}How did the ${pname} go? Hope you enjoyed it 😊`);
    if (serve) lines.push(`Feeding tip: ${serve}`);
  } else {
    lines.push(`${name ? `Hi ${name}! ` : ""}Hope your order was lovely 😊`);
  }
  lines.push("");
  lines.push(`If you liked it, why not share your personal link below? A friend who is NEW to us gets ${fmtRM(scheme.friendRM, cur)} off their FIRST order — and you get ${fmtRM(scheme.referrerRM, cur)} off a future order for every friend who orders through your link.`);
  lines.push("");
  lines.push("Your link to share:");
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
// "new" (never ordered → earns a credit). No stamp → "none". The history scan
// skips the order's own rows so one multi-item cart never looks like a previous
// order of its own.
export function referralFlag(state, group) {
  const orders = (group && group.orders) || [];
  const first = orders[0];
  if (!first) return "none";
  const via = waNumber(first.referredBy);
  if (!via) return "none";
  const me = waNumber(first.whatsapp);
  if (me && me === via) return "self";
  const ownIds = new Set(orders.map((o) => o.id));
  for (const o of state.orders || []) {
    if (ownIds.has(o.id)) continue;
    if (first.groupId && o.groupId === first.groupId) continue;
    if (me && waNumber(o.whatsapp) === me) return "existing";
  }
  return me ? "new" : "none";
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
    rows.push({
      id: newId("crd"),
      holder: friend,
      holderName: friendName,
      amountRM: scheme.friendRM,
      role: "friendOff",
      earnedAt,
      expiresAt: exp,
      usedAt: null,
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
