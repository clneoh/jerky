// taster/app.js — the page a printed label opens (`/taster/?c=CODE`).
//
// It exists for one reason: a shop hands a customer a sample with a QR on it, and
// this is what that square opens. It says hello, states what the label offers,
// asks whether the pet is a dog or a cat (so the shop learns something it can use
// later), counts the visit, and sends the customer on to the shop with the code —
// and the friend's number, on a bring-a-friend label — still attached so the order
// that follows is credited to the right label and the right person.
//
// It holds no data of its own and writes nothing but a visit: everything it shows
// comes from what Settings → Storefront publishes, and the shop itself is the one
// place an order can be placed. That is also why the page reads the same
// storefront_config row the shop reads, with the same public key — there is no
// second copy of the settings to go stale.
//
// Never a CDN, never a framework: the same hand-written ES modules as the rest of
// the site, so the page works on a phone with a poor connection and nothing has to
// be trusted to a third party.

import { applyTo, pick, loadLang, rememberLang, isLang } from "../i18n.js";
import { STORE } from "../store-lang.js";
import { TASTER } from "../taster-lang.js";
import { CONFIG } from "../store/config.js";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const MONTHS_MS = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];

// ── words ─────────────────────────────────────────────────────────────────

// The page's own wording, falling back to the shop's dictionary for anything the
// two share. `codeOff` / `codeMin` / `codeNew` / `codeUntil` / `codeFrom` are
// shared on purpose: a label's offer reads identically here and on the shop
// banner the customer meets a moment later, and neither copy can drift.
export function t(key, lang = loadLang()) {
  return pick(TASTER, lang, key) || pick(STORE, lang, key);
}

// "30 Sep" / "9月30日" — the same short form the shop's banner uses for a label's
// end date.
export function shortDay(iso, lang = loadLang()) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  const m = (lang === "zh" ? MONTHS_ZH : lang === "ms" ? MONTHS_MS : MONTHS_EN)[d.getMonth()];
  return lang === "zh" ? `${m}${d.getDate()}日` : `${d.getDate()} ${m}`;
}

// ── the link ──────────────────────────────────────────────────────────────

// The label's code from the address bar. Upper-cased, so a link written in
// lower case (`?c=k3x9`) is the same label — the code's own alphabet has no
// lower-case letters, so nothing can be lost by it.
export function parseCode(search) {
  const raw = new URLSearchParams(String(search || "")).get("c");
  return String(raw || "").trim().toUpperCase();
}

// The friend's number from a bring-a-friend label (`&via=`). Digits only, and
// deliberately NOT validated here: the shop owns what a number means, and this
// page only has to hand it on untouched rather than decide whether it is real.
export function parseVia(search) {
  return String(new URLSearchParams(String(search || "")).get("via") || "").trim();
}

// Where the customer goes next: the shop, with the label and (if there was one)
// the friend's number still attached.
export function storeLink(code, via) {
  const q = new URLSearchParams();
  if (code) q.set("c", String(code).trim().toUpperCase());
  if (via) q.set("via", via);
  const s = q.toString();
  return `../store/${s ? `?${s}` : ""}`;
}

// ── the published copy ────────────────────────────────────────────────────

// What the page knows before the cloud answers: its own words, and the shop name
// from the local config. Everything here is overridden by what Settings →
// Storefront publishes, so a page that cannot reach Supabase is still a working
// page with the right name on it.
export function localCopy(cfg = CONFIG) {
  return {
    shop: String((cfg && cfg.name) || "").trim(),
    whatsapp: String((cfg && cfg.whatsapp) || "").trim(),
    instagram: String((cfg && cfg.instagram) || "").trim(),
    askPet: true,
    follow: true,
  };
}

// Adopt the published copy over the local one. Two rules, both about not losing
// something she wrote:
//
//   · a heading or sentence is adopted only when it was actually filled in, so an
//     empty box never blanks the page's own words;
//   · the two switches are carried only when they say `false`, so a phone still
//     running an older payload (which has neither key) keeps today's behaviour.
export function mergeTaster(base, remote) {
  const out = { ...base };
  const r = remote && typeof remote === "object" ? remote : {};
  for (const k of ["shop", "instagram", "whatsapp", "heading", "body",
    "headingZh", "headingMs", "bodyZh", "bodyMs"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  for (const k of ["askPet", "follow"]) {
    if (r[k] === false) out[k] = false;
  }
  return out;
}

// The heading and the sentence, in the visitor's language, from the decided copy.
// A translation that was never written falls back to the English one — never to a
// blank line.
export function copyFor(cfg, key, lang = loadLang()) {
  const c = cfg || {};
  if (lang === "zh") return String(c[`${key}Zh`] || "").trim() || String(c[key] || "").trim();
  if (lang === "ms") return String(c[`${key}Ms`] || "").trim() || String(c[key] || "").trim();
  return String(c[key] || "").trim();
}

// The words THIS label puts on the page: the shared copy with the code's own lines
// laid over it. A code that says nothing for itself — or says it in English only —
// keeps the shared page's line for that language, and never blanks the rest. Each
// language resolves on its own, which is what makes that promise keepable: a blank
// reflects the missing line, never the missing language.
export function codeCopy(shared, info) {
  const out = { ...(shared || {}) };
  const own = info || {};
  for (const k of ["heading", "body"]) {
    for (const key of [k, `${k}Zh`, `${k}Ms`]) {
      const v = typeof own[key] === "string" ? own[key].trim() : "";
      if (v) out[key] = v;
    }
  }
  return out;
}

// The published record for the code in the address bar, or null. Read from the
// config the shop itself reads — this page never invents a code, so a link
// carrying a code she has retired or never made resolves to nothing.
export function findCode(cfg, code) {
  const list = Array.isArray(cfg && cfg.codes) ? cfg.codes : [];
  const want = String(code || "").trim().toUpperCase();
  if (!want) return null;
  return list.find((c) => c && String(c.code || "").toUpperCase() === want) || null;
}

// What the label says, in words, as a list of short phrases. Empty when the label
// has nothing to state — a plain label, a bring-a-friend label (its reward is the
// credit the referral scheme already pays), or an offer whose end date has passed
// since the page's settings were published.
export function offerWords(info, lang = loadLang(), today = todayISO()) {
  const parts = [];
  const off = info && info.offer;
  if (off && off.to && today > off.to) return parts; // ran out while the settings aged
  if (off) {
    const cur = off.cur || "RM";
    const amount = off.type === "pct" ? `${off.value}%` : `${cur}${off.value}`;
    parts.push(t("codeOff", lang).replace("%1", amount));
    if (Number(off.minSpend) > 0) parts.push(t("codeMin", lang).replace("%1", `${cur}${off.minSpend}`));
    if (off.newOnly) parts.push(t("codeNew", lang));
    if (off.to) parts.push(t("codeUntil", lang).replace("%1", shortDay(off.to, lang)));
  } else if (info && info.partnerName) {
    parts.push(t("codeFrom", lang).replace("%1", info.partnerName));
  }
  return parts;
}

// A local YYYY-MM-DD. Written out here rather than imported from the backoffice's
// date module, which the public pages have never depended on.
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ── the visit ─────────────────────────────────────────────────────────────

// The row a visit writes. `pet` is "dog" / "cat" / "" (unanswered), `code` is ""
// for a page opened without a label, and both are capped by the table's own
// checks — so the payload is shaped here rather than trusted there.
export function visitPayload({ code = "", pet = "", lang = "en" } = {}) {
  const p = String(pet || "").toLowerCase();
  const l = String(lang || "").toLowerCase();
  return {
    code: String(code || "").trim().toUpperCase().slice(0, 16),
    pet: p === "dog" || p === "cat" ? p : "",
    lang: isLang(l) ? l : "en",
  };
}

// ── the page ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

// Everything the page needs to draw itself, in one place, so a language switch can
// repaint without re-fetching anything.
export function createView({ search = "", now = new Date() } = {}) {
  return {
    code: parseCode(search),
    via: parseVia(search),
    copy: localCopy(CONFIG),
    codes: Array.isArray(CONFIG.codes) ? CONFIG.codes : [],
    info: null,
    pet: "",
    today: todayISO(now),
    recorded: false,
  };
}

// The visit is written once per page view, and only when there is an answer worth
// counting: the dog-or-cat reply, or — with that question switched off — the page
// opening itself. A visitor who leaves without answering is not counted, which the
// table's own comment says; the alternative (a row on open, then a second row on
// answer) would count one visitor twice.
async function recordVisit(v) {
  if (v.recorded) return;
  const sb = CONFIG.supabase || {};
  if (!sb.url || !sb.anonKey) return; // no cloud: the page is still a page
  v.recorded = true;
  try {
    await fetch(`${String(sb.url).replace(/\/+$/, "")}/rest/v1/taster_visits`, {
      method: "POST",
      headers: { apikey: sb.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify([visitPayload({ code: v.code, pet: v.pet, lang: loadLang() })]),
    });
  } catch {
    // A visit that fails to record is not the customer's problem, and telling them
    // would be a lie about what the offer is. Swallowed on purpose.
  }
}

// Fetch what Settings → Storefront published — the same row, and the same public
// key, that the shop reads. A failure leaves the page on its local copy.
async function loadPublished() {
  const sb = CONFIG.supabase || {};
  if (!sb.url || !sb.anonKey) return null;
  try {
    const res = await fetch(
      `${String(sb.url).replace(/\/+$/, "")}/rest/v1/storefront_config?select=data&id=eq.default&limit=1`,
      { headers: { apikey: sb.anonKey } });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) && rows[0];
    const text = row && typeof row.data === "string" ? row.data : "";
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function boot() {
  const v = createView({ search: typeof location !== "undefined" ? location.search : "" });
  let pillPaint = null;

  const paint = () => {
    const lang = loadLang();
    // Whatever this label wants to say for itself, over the shared page's words.
    const c = codeCopy(v.copy, v.info);
    const shop = $("brand");
    if (shop) shop.textContent = c.shop;
    const title = $("heading");
    if (title) title.textContent = copyFor(c, "heading", lang) || t("heading", lang);
    const body = $("body");
    if (body) body.textContent = copyFor(c, "body", lang) || t("body", lang);
    document.title = t("title", lang) + (c.shop ? ` · ${c.shop}` : "");

    // The label's own card — whose it is, what it is for, and what it offers.
    const card = $("label-card");
    const who = $("label-who");
    const prod = $("label-product");
    const offer = $("label-offer");
    if (card && who && prod && offer) {
      who.textContent = v.info && v.info.kind === "intro" ? t("friend", lang) : "";
      who.hidden = !who.textContent;
      prod.textContent = (v.info && v.info.productName) || "";
      prod.hidden = !prod.textContent;
      // An offer whose day has passed since the settings were published is not
      // re-stated — the label shows nothing rather than a number that is no
      // longer true. (The app stops publishing an offer the moment it ends, so
      // this is the rare case of a config that aged while the page held it.)
      const stale = !!(v.info && v.info.offer && v.info.offer.to && v.today > v.info.offer.to);
      const parts = stale ? [] : offerWords(v.info, lang, v.today);
      offer.textContent = stale ? t("ended", lang) : parts.join(" · ");
      offer.className = stale ? "t-offer is-ended" : "t-offer";
      offer.hidden = !offer.textContent;
      card.hidden = !(v.info && (who.textContent || prod.textContent || offer.textContent));
    }

    // The dog-or-cat question, only while it is unanswered.
    const ask = $("ask");
    if (ask) {
      ask.hidden = !c.askPet || !!v.pet;
      const thanks = $("ask-thanks");
      if (thanks) thanks.hidden = !v.pet;
    }

    // The way on: always the shop, with the label (and the friend) attached.
    const go = $("go");
    if (go) {
      go.href = storeLink(v.code, v.via);
      go.textContent = t("go", lang);
    }
    const hint = $("go-hint");
    if (hint) hint.textContent = t("goHint", lang);

    // The code box: the way in for a link that carried no code, or one we do not
    // know. It stays put while there is anything typed in it — taking a box away
    // from under someone's thumbs because the settings finally arrived would lose
    // the code they were part-way through entering, which is worse than an extra
    // box on screen.
    const manual = $("manual");
    if (manual) {
      const typed = String(($("code-input") || {}).value || "").trim();
      manual.hidden = !!v.info && !typed;
      const msg = $("code-msg");
      if (msg) {
        msg.hidden = !v.badCode;
        msg.textContent = v.badCode ? t("badCode", lang) : "";
      }
      const input = $("code-input");
      if (input) input.placeholder = t("codePh", lang);
    }

    const social = $("social");
    if (social) {
      social.replaceChildren();
      if (c.follow !== false) {
        if (c.instagram) {
          social.append(el("a", { class: "t-social-link", href: instagramUrl(c.instagram), target: "_blank",
            rel: "noopener" }, `Instagram · ${c.instagram}`));
        }
        if (c.whatsapp) {
          social.append(el("a", { class: "t-social-link", href: `https://wa.me/${digits(c.whatsapp)}`,
            target: "_blank", rel: "noopener" }, "WhatsApp"));
        }
      }
      social.hidden = !social.children.length;
    }

    applyTo(document, TASTER, lang);
    if (pillPaint) pillPaint(lang);
  };

  // The dog/cat answer: remembered for the visit and for nothing else.
  const answer = (pet) => {
    v.pet = pet === "cat" ? "cat" : "dog";
    paint();
    recordVisit(v);
  };
  const dog = $("pet-dog");
  const cat = $("pet-cat");
  if (dog) dog.addEventListener("click", () => answer("dog"));
  if (cat) cat.addEventListener("click", () => answer("cat"));

  // Type a code by hand.
  const go2 = $("code-go");
  const input = $("code-input");
  const tryCode = () => {
    const want = String((input && input.value) || "").trim().toUpperCase();
    if (!want) return;
    v.badCode = false;
    // With the settings in hand we can answer straight away; if they never
    // arrived, hand the code to the shop, which resolves it the same way.
    const found = v.codes.length ? findCode(CONFIG, want) : null;
    if (v.codes.length && !found) { v.badCode = true; paint(); return; }
    location.href = storeLink(want, v.via);
  };
  if (go2) go2.addEventListener("click", tryCode);
  if (input) {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryCode(); });
  }

  // The site language, exactly as the homepage and the shop do it: the choice is
  // remembered under the same key, so a visitor who picks 中文 here is already in
  // 中文 on the shop a tap later. The page repaints in place rather than
  // reloading, so nothing is re-fetched and nothing they typed is lost.
  if (typeof document !== "undefined" && document.documentElement) {
    const pills = Array.from(document.querySelectorAll("#lang-switch .lang-pill"));
    pillPaint = (l) => pills.forEach((b) => b.classList.toggle("is-on", b.dataset.lang === l));
    pills.forEach((b) => b.addEventListener("click", () => {
      if (!isLang(b.dataset.lang) || b.dataset.lang === loadLang()) return;
      rememberLang(b.dataset.lang);
      paint();
    }));
  }

  // Draw with what we have — the local shop name and the page's own words — so the
  // page is never blank while the cloud is being asked. With the dog-or-cat
  // question switched off there is nothing to wait for, so the visit is written
  // now; otherwise it waits for the answer (see recordVisit).
  if (v.copy.askPet === false) recordVisit(v);
  paint();

  loadPublished().then((remote) => {
    // No settings reached us: the page still works, and a code in the link is
    // still handed on to the shop — which reads the same row itself and is the
    // one that finally resolves it. Nothing here is broken, so nothing is said.
    if (!remote) return;
    v.copy = mergeTaster(v.copy, remote.taster || {});
    v.codes = Array.isArray(remote.codes) ? remote.codes : [];
    v.info = findCode({ codes: v.codes }, v.code);
    if (v.copy.askPet === false && !v.pet) recordVisit(v);
    paint();
  });
  return v;
}

function digits(n) {
  return String(n || "").replace(/[^0-9]/g, "");
}

function instagramUrl(handle) {
  const h = String(handle || "").trim().replace(/^@/, "");
  return /^https?:\/\//i.test(h) ? h : `https://instagram.com/${h}`;
}

if (typeof document !== "undefined" && document.documentElement) boot();
