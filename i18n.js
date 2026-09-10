// i18n.js — tiny shared language helper for the homepage (root index.html) and
// the store (store/). The site reads English by default and lets visitors switch
// to 中文 or Bahasa Malaysia; the choice is remembered on their device.
//
// Text lives in the per-page dictionaries (home-lang.js, store-lang.js). Static
// nodes carry data-i18n="key" (plain text), data-i18n-ph="key" (placeholder),
// data-i18n-html="key" (inner HTML, for nodes with <br>/<strong>) or
// data-i18n-aria="key" (aria-label). English is also authored in the HTML, so a
// page reads fine even before this script runs.
//
// Everything except applyTo is DOM-free so it runs under Node for tests.

export const LANGS = ["en", "zh", "ms"];
export const LANG_LABELS = { en: "EN", zh: "中文", ms: "BM" };
const KEY = "siteLang";

export function isLang(l) {
  return LANGS.includes(l);
}

// The visitor's current UI language: their saved choice, else English. Only a
// browser whose own language is one of ours and who has no saved choice starts
// elsewhere; everyone else gets English.
export function loadLang() {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(KEY);
      if (isLang(saved)) return saved;
    }
    if (typeof navigator !== "undefined") {
      const nav = String((navigator.language || "").slice(0, 2)).toLowerCase();
      if (isLang(nav)) return nav;
    }
  } catch { /* storage can be unavailable; English is fine */ }
  return "en";
}

export function rememberLang(l) {
  if (!isLang(l)) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, l);
  } catch { /* best effort */ }
}

// The localized display name for a shop product. A shop product carries a
// canonical English `name` (used for ordering/availability) and optional
// `nameZh` / `nameMs` (typed by the baker or auto-translated); the English name
// shows until a Chinese/Malay name exists.
export function nameFor(product, lang) {
  const p = product && typeof product === "object" ? product : null;
  if (!p) return "";
  if (lang === "zh") {
    const z = p.nameZh;
    if (typeof z === "string" && z.trim()) return z.trim();
  }
  if (lang === "ms") {
    const m = p.nameMs;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return String(p.name || "").trim();
}

// The translated boxes are named after a SHORT stem, not the full English field:
// descZh/descMs (not descriptionZh), servingZh/servingMs (not servingTipZh);
// name and unit happen to share their stem with the English field. map the full
// field name down so the right box is read.
const VARIANT_STEM = { description: "desc", servingTip: "serving", name: "name", unit: "unit" };

// The same pick-a-language fallback for the product's other customer-facing
// lines. `key` is the English field ("description", "unit", "servingTip") and
// the translated boxes are <stem>Zh / <stem>Ms (descZh, unitMs, …). English
// always shows until a translation exists.
function fieldFor(product, lang, key, fallback) {
  const p = product && typeof product === "object" ? product : null;
  if (!p) return fallback || "";
  const stem = VARIANT_STEM[key] || key;
  if (lang === "zh") {
    const z = p[`${stem}Zh`];
    if (typeof z === "string" && z.trim()) return z.trim();
  }
  if (lang === "ms") {
    const m = p[`${stem}Ms`];
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  const en = p[key];
  if (typeof en === "string" && en.trim()) return en.trim();
  return fallback || "";
}

// The description line a customer reads under the product on the shop.
export function descFor(product, lang) {
  return fieldFor(product, lang, "description", "");
}

// The serving tip used in the baker's localized follow-up message.
export function servingFor(product, lang) {
  return fieldFor(product, lang, "servingTip", "");
}

// The selling unit word shown after the price ("RM15.00 / loaf") — translated
// on the shop; English (or "piece") is the fallback.
export function unitFor(product, lang) {
  return fieldFor(product, lang, "unit", "piece");
}

// Apply `dict[lang]` to a tagged subtree: sets text, placeholders, inner HTML
// and aria-labels from their keys. Nodes missing from the dictionary keep what
// the HTML already says (an English authoring default).
export function applyTo(root, dict, lang) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const table = (dict && dict[lang]) || {};
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = table[el.getAttribute("data-i18n")];
    if (typeof v === "string") el.textContent = v;
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const v = table[el.getAttribute("data-i18n-html")];
    if (typeof v === "string") el.innerHTML = v;
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const v = table[el.getAttribute("data-i18n-ph")];
    if (typeof v === "string") el.placeholder = v;
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const v = table[el.getAttribute("data-i18n-aria")];
    if (typeof v === "string") el.setAttribute("aria-label", v);
  });
  const title = root.querySelector && root.querySelector("title");
  const tv = title && table.title;
  if (typeof tv === "string") title.textContent = tv;
  // Tell the browser the page language (screen readers, CJK font selection).
  // Guarded because a non-browser caller may have no documentElement.
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = lang;
  }
}

// A DOM-free lookup a JS-driven part uses for its own strings: dict[lang][key],
// falling back to English when the language or key is missing.
export function pick(dict, lang, key) {
  const t = (dict && dict[lang]) || {};
  if (typeof t[key] === "string") return t[key];
  const en = (dict && dict.en) || {};
  return typeof en[key] === "string" ? en[key] : "";
}
