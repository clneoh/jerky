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
// `nameZh` / `nameMs` typed by the baker; the English name shows until she
// gives a product its Chinese/Malay name.
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
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

// A DOM-free lookup a JS-driven part uses for its own strings: dict[lang][key],
// falling back to English when the language or key is missing.
export function pick(dict, lang, key) {
  const t = (dict && dict[lang]) || {};
  if (typeof t[key] === "string") return t[key];
  const en = (dict && dict.en) || {};
  return typeof en[key] === "string" ? en[key] : "";
}
