// store/app.js — customer order page: pick a date, add items, place an order.
// Orders go straight to the backoffice (Supabase incoming_orders) and fall back
// to a WhatsApp message if that fails. The name, menu and WhatsApp number are
// published by the backoffice (Settings → Storefront) and override the static
// config.js fallback at runtime.
import { CONFIG } from "./config.js";
import { poolCaps, poolGroups, clampPool, groupFor, poolPieces, closedReason } from "./pool.js";
import { loadLang, pick, rememberLang, nameFor, descFor, unitFor, applyTo } from "../i18n.js";
import { STORE } from "../store-lang.js";

// Day/month short names per site language. English is today's authoring default;
// fmtDay and the "Posting days" info card read by the visitor's language so a
// date pill or that row shows in 中文/BM too.
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const DAYS_MS = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
const MONTHS_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];

// The store re-loads when a visitor switches language, so reading the saved
// choice fresh on every lookup is right — and these helpers stay DOM-free, so
// the Node tests (which default to English) keep asserting today's strings.
function t(key) { return pick(STORE, loadLang(), key); }

// Fill %1, %2, … placeholders left-to-right.
function sub(s) {
  const args = Array.prototype.slice.call(arguments, 1);
  let out = String(s);
  for (let i = 0; i < args.length; i++) out = out.split(`%${i + 1}`).join(String(args[i]));
  return out;
}

function dayName(n) {
  const lang = loadLang();
  if (lang === "zh") return DAYS_ZH[n] || "";
  if (lang === "ms") return DAYS_MS[n] || "";
  return DAYS_EN[n] || "";
}

// Normalize a customer's WhatsApp number to the digits-only international form
// wa.me links require (local leading "0" → "+60"). Mirror of admin/js/state.js,
// kept here so the store has no dependency on the moved backoffice modules.
export function waNumber(n) {
  const digits = String(n || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
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

// Which dates the pills show. When the backoffice has published real delivery
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

// Map upcoming dates → what each day pill should say, given the live
// day-level availability map ({ 'YYYY-MM-DD': slots_left }). Open days show
// just the date; only a fully-booked day is flagged "Sold out" (greyed + a
// watermark stamp via CSS). Per-product counts live on the product cards.
export function pillSpecs(dates, availMap = {}) {
  return dates.map((d) => {
    const day = fmtDay(d);
    const left = availMap[dateKey(d)];
    const soldOut = left != null && left <= 0;
    return { date: d, day, left, soldOut, avail: soldOut ? t("soldOut") : "", label: soldOut ? `${day} ${t("soldOut")}` : day };
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
  for (const key of ["whatsapp", "name", "tagline", "instagram", "facebook", "cutoff", "tngQr"]) {
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

export function render() {
  renderStatic(CONFIG);
  const dateWrap = document.getElementById("dates");
  const menu = document.getElementById("menu");
  const cart = new Map();
  let selected = null;
  let avail = null;      // { 'YYYY-MM-DD': slots_left } — day-level, for the pills
  let prodAvail = null;  // { 'YYYY-MM-DD': { product: slots_left } } — for the item stamps
  let dayRows = null;    // published delivery-date rows — the real dates win
  let dates = upcomingDates(CONFIG);
  // A product's date rules (closes X days before delivery / a from–to window)
  // compare each delivery date to today, so its reference is fixed at load.
  const todayKey = dateKey(new Date());

  const renderMenu = () => {
    const byProduct = prodAvail && selected ? prodAvail[selected] || {} : {};
    const groups = poolGroups(CONFIG.products);
    menu.replaceChildren(...CONFIG.products.map((p) => {
      const lang = loadLang();
      const group = groupFor(groups, p);
      const baseLeft = group && byProduct[group.baseName] != null
        ? Number(byProduct[group.baseName]) : undefined;
      const caps = group && Number.isFinite(baseLeft) ? poolCaps(group, baseLeft, cart) : null;
      // A product's own date rules can make it unorderable on this date — it
      // reads sold out with the reason under it. A blank product (value pack
      // included) has no early close, so it sells on any open date.
      const reason = closedReason(p, selected, todayKey);

      // `left` drives the stamp + stepper cap. A live pool member is capped by
      // the shared pool (its pieces compete with every other pack/single in the
      // cart); a gated product on a too-near/out-of-window date reads as sold
      // out regardless. Anything else keeps its own published row.
      const ownLeft = byProduct[p.name] != null ? Number(byProduct[p.name]) : undefined;
      const left = reason ? 0 : (caps ? caps.get(p.name) : ownLeft);
      const qty = cart.get(p.name) || 0;
      const soldOut = left != null && left <= 0;
      const qtyLabel = el("span", { class: "stepper-val" }, String(qty));
      // A pool card repaints the whole menu when its stepper moves — every
      // sibling's cap/stamp depends on this quantity. The bar must refresh
      // either way (count/total/button), so it runs alongside the menu paint.
      const redraw = () => { if (group) renderMenu(); renderBar(); };
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
        ? el("span", { class: soldOut ? "prod-stamp soldout" : "prod-stamp" }, soldOut ? t("soldOut") : sub(t("onlyLeft"), left))
        : null;
      const note = reason ? el("p", { class: "prod-note" }, reason) : null;
      // The card reads in the visitor's language: translated name/description/
      // unit when the product has them, else the English text.
      const desc = p && descFor(p, lang);
      return el("div", { class: `card menu-item${soldOut ? " soldout" : ""}` },
        el("div", { class: "card-head" },
          el("div", {},
            el("p", { class: "card-title" }, nameFor(p, lang)),
            el("p", { class: "card-sub" }, `RM${p.price.toFixed(2)} / ${unitFor(p, lang)}`),
            desc ? el("p", { class: "prod-desc" }, desc) : null),
          stamp),
        el("div", { class: "stepper" }, dec, qtyLabel, inc),
        note);
    }));
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
          notes.push(`${m.name} just sold out — removed from your order.`);
        } else {
          cart.set(m.name, to);
          notes.push(`${m.name}: only ${to} can fit with the rest of your order now — we changed your ${from} to ${to}.`);
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
      const why = reason.split("—")[0].trim().replace(/\.$/, "");
      notes.push(`${p.name}: ${why} — we removed it.`);
    }

    // Everything else keeps the old per-product clamp against its own row.
    for (const [name, q] of [...cart]) {
      if (handled.has(name)) continue;
      const left = availNow(name);
      if (left == null) continue;
      if (left <= 0) {
        cart.delete(name);
        notes.push(`${name} just sold out — removed from your order.`);
      } else if (q > left) {
        cart.set(name, left);
        notes.push(`${name}: only ${left} left now — we changed your ${q} to ${left}.`);
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

  const buildPills = () => {
    const specs = pillSpecs(dates, avail || {});
    if (!specs.length) {
      dateWrap.replaceChildren(el("p", { class: "muted" }, t("noDates")));
      return;
    }
    const open = specs.filter((s) => !s.soldOut);
    // `selected` is a YYYY-MM-DD key so it survives a rerender that rebuilds
    // the Date objects (availability/config can arrive after the user taps).
    if (selected && !specs.some((s) => dateKey(s.date) === selected && !s.soldOut)) selected = null;
    if (!selected) selected = open.length ? dateKey(open[0].date) : null;

    if (!open.length) {
      dateWrap.replaceChildren(el("p", { class: "muted" }, t("noOpenDates")));
      return;
    }
    dateWrap.replaceChildren(...specs.map((s) => {
      const attrs = {
        class: `pill${dateKey(s.date) === selected ? " active" : ""}${s.soldOut ? " soldout" : ""}`,
        onclick: () => {
          if (s.soldOut) return;
          selected = dateKey(s.date);
          // Rebuild pills + menu together so the active pill and the quantities
          // the customer chose are re-checked against this day's availability.
          rerender();
        },
      };
      if (s.soldOut) attrs.disabled = "true";
      return el("button", attrs,
        el("span", { class: "pill-date" }, s.day),
        el("span", { class: "pill-sub" }, s.soldOut ? t("soldOut") : ""));
    }));
  };

  // Recompute the dates + rebuild pills and menu. Called on first paint and
  // again when the availability data or the published storefront config
  // arrives — arrival order doesn't matter because both funnel through here.
  const rerender = () => {
    dates = resolveDates(upcomingDates(CONFIG), dayRows, dateKey(new Date()))
      .filter((d) => isOpen(CONFIG, d));
    // Fix the cart first so the pills/menu repaint with honest quantities: an
    // item the customer chose may have sold out (or dropped to fewer than they
    // asked for) since the last refresh or since they picked this day.
    reconcileCart();
    // Keep the date-pill row's sideways scroll where the customer had it — the
    // refresh rebuilds the chips but must not fling the row back to the start.
    const sx = dateWrap.scrollLeft;
    buildPills();
    if (dateWrap.scrollLeft !== sx) dateWrap.scrollLeft = sx;
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
    // date pills and the product cards only — the customer's typed details
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
  function renderBar() {
    let count = 0, total = 0;
    for (const [n, q] of cart) {
      const p = CONFIG.products.find((x) => x.name === n);
      if (!p) continue;
      count += q;
      total += q * p.price;
    }
    document.getElementById("bar-count").textContent = count === 1 ? t("oneItem") : sub(t("items"), count);
    document.getElementById("bar-total").textContent = `RM${total.toFixed(2)}`;
    document.getElementById("order-btn").textContent = t("placeOrder");
    document.getElementById("order-btn").disabled = count === 0;
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
    // came through. The bakery decides (new vs repeat) and applies the discount.
    const via = currentVia();
    if (via) order.referredBy = via;
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
      showConfirm([
        el("p", { class: "confirm-title" }, t("orderRecvTitle")),
        el("p", { class: "confirm-body" },
          order.customer ? sub(t("orderRecvThanksBody"), order.customer, CONFIG.name) : sub(t("orderRecvBody"), CONFIG.name)),
        el("p", { class: "confirm-body" }, sub(t("orderRecvLine"), dayLabel, items, total.toFixed(2))),
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

  renderBar();
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
  ["delivered", "trkDelivered"],
];

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
  let end = 0; // first index NOT done; steps before it are green
  for (let i = 0; i < JOURNEY.length; i++) {
    let done;
    if (i < at) done = true;                          // already moved past
    else if (i === at) done = i === 0 ? true          // New: done on arrival
      : i === 1 ? confirmedDone                       // Confirmed: after Send confirmation
      : i === 2 ? paidDone                            // Paid: after the Paid button
      : true;                                         // Preparing/Packed/Delivered: on selection
    else done = false;
    if (!done) break;
    end = i + 1;
  }
  const root = el("div", { class: "tj", "aria-label": "Order status journey" });
  JOURNEY.forEach(([id, labelKey], i) => {
    const state = i < end ? "done" : i === end ? "now" : "todo";
    const mark =
      state === "done" ? el("span", { class: "tj-check" }, "✓")
      : state === "now" ? el("span", { class: "tj-dot" }) : null;
    root.append(el("div", { class: `tj-step ${state}` }, [
      el("div", { class: "tj-track" }, [el("div", { class: "tj-node" }, mark)]),
      el("div", { class: "tj-label" }, t(labelKey)),
    ]));
  });
  return root;
}

export async function trackOrder(code) {
  const box = document.getElementById("track-result");
  if (!box) return;
  const clean = String(code || "").trim().replace(/^#/, "").toUpperCase();
  box.hidden = false;
  const sb = CONFIG.supabase;
  if (!clean) {
    box.replaceChildren(el("p", { class: "track-note" }, t("trackEnter")));
    return;
  }
  if (!sb || !sb.url || !sb.anonKey) {
    box.replaceChildren(el("p", { class: "track-note" }, t("trackUnavailable")));
    return;
  }
  box.replaceChildren(el("p", { class: "track-note" }, t("trackLooking")));
  const base = String(sb.url).replace(/\/+$/, "");
  try {
    // cache: no-store so a repeated lookup (e.g. re-checking the same order
    // after the baker updates it) always gets the current status, never a
    // cached one from the phone's HTTP cache.
    const res = await fetch(
      `${base}/rest/v1/order_tracking?select=status,confirmed_sent,paid_received,delivery,items,total,updated_at&code=eq.${clean}&limit=1`,
      { headers: { apikey: sb.anonKey }, cache: "no-store" });
    const rows = res.ok ? await res.json() : null;
    const row = Array.isArray(rows) && rows[0];
    if (!row) {
      box.replaceChildren(el("p", { class: "track-note" }, sub(t("trackNotFound"), clean)));
      return;
    }
    // The card reads like a parcel tracker: order code, the journey progress
    // line (reached stages green, current highlighted), then the delivery and
    // item details underneath.
    const codeLine = el("p", { class: "track-code" }, sub(t("orderCode"), clean));
    const journey = journeyEl(row);
    const details = el("div", { class: "track-details" }, [
      el("p", {}, row.delivery),
      el("p", {}, `${row.items} — ${row.total}`),
    ]);
    const kids = [
      codeLine,
      journey,
      details,
      row.customer ? el("p", { class: "track-note" }, sub(t("forCustomer"), row.customer)) : null,
    ];
    box.replaceChildren(...kids.filter(Boolean));
  } catch {
    box.replaceChildren(el("p", { class: "track-note" }, t("trackUnavailable")));
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
    }
  }
}

render();
renderReferralBanner();
wireFulfillment();
wireTrack();

// ── Site language (EN / 中文 / BM) ────────────────────────────────────────
// The store rebuilds everything in render()'s local closures, so a switch
// remembers the choice and reloads rather than trying to re-render in place.
// Only a real browser reaches this block (Node tests have no documentElement).
if (typeof document !== "undefined" && document.documentElement) {
  const bootLang = loadLang();
  applyTo(document, STORE, bootLang);
  document.documentElement.lang = bootLang;
  const pills = document.querySelectorAll("#lang-switch .lang-pill");
  pills.forEach((b) => b.classList.toggle("is-on", b.dataset.lang === bootLang));
  pills.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === loadLang()) return;
    rememberLang(b.dataset.lang);
    window.location.reload();
  }));
}
