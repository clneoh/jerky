// admin/js/nudge.js — the quiet nudge: this week's bake, said once, to the people who have bought before
// and have gone quiet.
//
// ⭐ FROM THE CUSTOMER PLAN (marketing/customer-levels-plan.md, P4): *"a reason to come back, quietly"*.
// ⚠️⚠️ THREE THINGS SHAPE IT, ALL HERS:
//   1 · **NO DISCOUNT, NO "SPECIAL", NO ANNOUNCEMENT.** Her standing rule. The nudge names the bake day and the
//       cut-off and stops — ⭐ **an offer would make it a campaign, and she does not run campaigns.**
//   2 · **NEVER SOMEONE WHO ASKED TO BE FORGOTTEN.** An order with a `redactedKey` is a person whose details were
//       deleted at their request; their sale is kept for the books, and they are never messaged again.
//   3 · **NOT SOMEONE WHO IS ALREADY COMING.** A customer with an order for an upcoming bake day does not need
//       telling that a bake day exists.

import { keyOf, orderDateOf } from "./customers.js";
import { groupOrders } from "./state.js";
import { PROJECT_URL } from "./devmail.js";

export const QUIET_DAYS = 56; // the default: eight weeks — long enough to be quiet, short enough to still be a customer
// ★★ THE CRITERIA ARE HERS TO SET (v647). Stored in `settings.nudge`, so they travel to her other phone with
// every other setting. ⚠️ Clamped: a nudge every week is not a nudge, and "at least 0 orders" would include
// people who never bought.
export const NUDGE_LIMITS = { weeks: { min: 2, max: 52 }, minOrders: { min: 1, max: 20 } };
export const NUDGE_DEFAULTS = { weeks: 8, minOrders: 1 };
// ★★ THE SENTENCE IS HERS TOO (v647). `{day}`, `{by}` and `{link}` are filled from her own settings; ⚠️ if she
// writes it a different way it is sent EXACTLY as typed, tokens or not — ⭐ her words, not a template's.
export const NUDGE_TEXT = "we're baking on {day}. If you'd like some, order by {by} the day before — {link}";

export function nudgeCfg(state) {
  const raw = (state && state.settings && state.settings.nudge) || {};
  const pick = (v, lim, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, n)) : dflt;
  };
  return {
    weeks: pick(raw.weeks, NUDGE_LIMITS.weeks, NUDGE_DEFAULTS.weeks),
    minOrders: pick(raw.minOrders, NUDGE_LIMITS.minOrders, NUDGE_DEFAULTS.minOrders),
    text: typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : NUDGE_TEXT,
  };
}

const addDays = (iso, n) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

const has = (v) => typeof v === "string" && v.trim() !== "";

/**
 * The people to nudge: at least one past order, no order for an upcoming day, quiet for `quietDays`.
 * @returns {Array<{key:string, name:string, whatsapp:string, lastPlaced:string, days:number}>}
 *          oldest first — the longest-quiet are the ones most worth remembering.
 */
export function quietCustomers(state, { today = "", quietDays, minOrders } = {}) {
  const cfg = nudgeCfg(state);
  const quiet = Number.isFinite(quietDays) && quietDays > 0 ? quietDays : cfg.weeks * 7;
  const atLeast = Number.isFinite(minOrders) && minOrders > 0 ? minOrders : cfg.minOrders;
  if (!has(today)) return [];
  const groups = groupOrders((state && state.orders) || []);
  const byKey = new Map();
  for (const g of groups) {
    const o = g.orders[0];
    if (!o || o.redactedKey) continue;                 // ⚠️ a person who asked to be forgotten
    if (!has(o.whatsapp)) continue;                    // nothing to message
    const key = keyOf(o);
    if (!key) continue;
    const placed = orderDateOf(o);
    const day = String(o.deliveryDate || "").trim();
    const rec = byKey.get(key) || {
      key, name: String(o.customerName || "").trim(), whatsapp: String(o.whatsapp).trim(),
      lastPlaced: "", upcoming: false, orders: 0,
    };
    rec.orders += 1;
    if (placed && placed > rec.lastPlaced) rec.lastPlaced = placed;
    // ⚠️ ANY row in the family for an upcoming day counts: a two-line order is one sale, and either line
    // proves they are already coming.
    if (day && day >= today) rec.upcoming = true;
    byKey.set(key, rec);
  }
  const cutoff = addDays(today, -Math.max(1, quiet));
  return [...byKey.values()]
    .filter((r) => r.orders >= atLeast && r.lastPlaced && r.lastPlaced < cutoff && !r.upcoming)
    .map((r) => ({ key: r.key, name: r.name, whatsapp: r.whatsapp, lastPlaced: r.lastPlaced,
      days: Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${r.lastPlaced}T00:00:00`)) / 864e5) }))
    .sort((a, b) => a.lastPlaced.localeCompare(b.lastPlaced));
}

/** "18:00" → "6pm", "06:30" → "6.30am"; anything else is left exactly as she typed it. */
export function clockWords(cutoff) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cutoff || "").trim());
  if (!m) return String(cutoff || "").trim();
  let h = Number(m[1]);
  const mins = m[2];
  const tail = h >= 12 ? "pm" : "am";
  h %= 12;
  if (h === 0) h = 12;
  return mins === "00" ? `${h}${tail}` : `${h}.${mins}${tail}`;
}

/**
 * The words. ⚠️ The bake day and the cut-off are READ, never typed — the same two facts the shop states.
 * ⭐ No coupon, no urgency, no "special": a customer who has bought before is being told the week, not sold to.
 */
export function nudgeText({ dayText = "", cutoff = "", url = `${PROJECT_URL}/store/`, template = "" } = {}) {
  const when = String(dayText || "").trim();
  const by = clockWords(cutoff);
  if (!when) return "";
  const own = typeof template === "string" && template.trim() ? template.trim() : "";
  if (own) {
    // ⭐ HER SENTENCE, filled where she asked. ⚠️ A template with no tokens is sent exactly as written.
    return own.replace(/\{day\}/g, when).replace(/\{by\}/g, by || "the day before")
      .replace(/\{link\}/g, url).replace(/\s+—\s+$/, "").trim();
  }
  return by
    // ⚠️ LOWERCASE START, ON PURPOSE: this sentence is written to follow a greeting — the app's own composer
    // builds "Hi {name}, {body}", so a capital here reads as "Hi Mei, We're baking…". ⭐ One convention, and the
    // preview shows exactly how it will arrive.
    ? `we're baking on ${when}. If you'd like some, order by ${by} the day before — ${url}`
    : `we're baking on ${when}. If you'd like some, order the day before — ${url}`;
}
