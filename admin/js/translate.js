// translate.js — auto-translate a product's shop-facing text (name, description
// line, selling unit word, serving tip) into Chinese and Bahasa Malaysia with
// the free MyMemory web translator, plus the provenance rules that decide when
// a translation is machine-filled and when the baker owns it by hand.
//
// Pure module: no DOM, and no network at import. The views call translateTo with
// their own fetcher (the browser's fetch); Node tests inject a stub. The single
// online/offline gate is translateAllowed(), which is always false under
// node --test (no navigator), so automatic translation is a no-op in tests.

// Which two-character language each translated box belongs to, and which English
// field of the product it is translated FROM.
export const LANG_OF = {
  nameZh: "zh", descZh: "zh", unitZh: "zh", servingZh: "zh",
  nameMs: "ms", descMs: "ms", unitMs: "ms", servingMs: "ms",
};
export const SRC_OF = {
  nameZh: "name", descZh: "description", unitZh: "unit", servingZh: "servingTip",
  nameMs: "name", descMs: "description", unitMs: "unit", servingMs: "servingTip",
};
export const VARIANT_KEYS = Object.keys(LANG_OF);
export const ZH_VARIANTS = ["nameZh", "descZh", "unitZh", "servingZh"];
export const MS_VARIANTS = ["nameMs", "descMs", "unitMs", "servingMs"];

// MyMemory's free endpoint speaks en→zh-CN (Simplified — the site's 中文) and
// en→ms.
const PAIRS = { zh: "en|zh-CN", ms: "en|ms" };
// The free API is happiest under ~450 characters per request.
export const MAX_CHUNK = 440;

const asStr = (v) => (typeof v === "string" ? v : "");

export function valueOf(p, variant) {
  return asStr(p && p[variant]).trim();
}

// The current English text a variant translates ("" when that field is blank).
export function srcTextOf(p, variant) {
  return asStr(p && p[SRC_OF[variant]]).trim();
}

// The English source text the current machine value was made FROM, or "" when
// the value was not machine-made (typed by hand, cleared, or never filled).
function madeFrom(p, variant) {
  const s = p && p.trSrc && p.trSrc[variant];
  return typeof s === "string" ? s : "";
}

function overrideSet(p) {
  return new Set(Array.isArray(p && p.trOverride) ? p.trOverride : []);
}

export function isOverridden(p, variant) {
  return overrideSet(p).has(variant);
}

// The baker decided this box by typing (or clearing) it — automatic translation
// never touches it again.
export function markManual(p, variant) {
  const set = overrideSet(p);
  set.add(variant);
  p.trOverride = [...set];
  if (p.trSrc) delete p.trSrc[variant];
}

// Record that a box holds machine translation made from `src` (English).
export function markAuto(p, variant, src) {
  const set = overrideSet(p);
  set.delete(variant);
  if (set.size) p.trOverride = [...set];
  else delete p.trOverride;
  if (!p.trSrc) p.trSrc = {};
  p.trSrc[variant] = src;
}

// Why a box reads what it does:
//   "manual"   — hand-typed by the baker (never auto-touched)
//   "cleared"  — deliberately left blank by the baker
//   "auto"     — machine translation, current with its English
//   "stale"    — machine translation made from an older English line
//   "missing"  — English exists but there is no translation yet
//   "none"     — nothing to translate (English field is blank)
export function translationStatus(p, variant) {
  const cur = valueOf(p, variant);
  const made = madeFrom(p, variant);
  const src = srcTextOf(p, variant);
  if (isOverridden(p, variant)) return cur ? "manual" : "cleared";
  if (cur && !made) return "manual"; // legacy hand-typed value (v64)
  if (!src) return made ? "cleared" : "none"; // English removed / never written
  if (!made) return "missing";
  return made === src ? "auto" : "stale";
}

// What a translation pass should do for each variant:
//   "translate" — fill/replace the machine value from current English
//   "clear"     — English was deleted; drop the stale machine value
//   "adopt"     — a legacy hand-typed value (v64): mark it manual, don't touch
// Overridden variants (typed or cleared by hand) are never listed.
export function planTranslations(p) {
  const actions = [];
  for (const variant of VARIANT_KEYS) {
    if (isOverridden(p, variant)) continue;
    const cur = valueOf(p, variant);
    const made = madeFrom(p, variant);
    const src = srcTextOf(p, variant);
    if (!src) {
      if (made) actions.push({ variant, action: "clear" });
      continue;
    }
    if (cur && !made) {
      actions.push({ variant, action: "adopt" });
      continue;
    }
    if (made === src) continue;
    actions.push({ variant, action: "translate" });
  }
  return actions;
}

// The online/offline gate. Automatic translation only runs in a real browser
// that is online. Under node --test there is no browser navigator (Node's own
// global navigator has no onLine property), so this is false and auto-translate
// is a no-op in tests.
export function translateAllowed() {
  return typeof navigator === "object"
    && typeof navigator.onLine === "boolean"
    && navigator.onLine
    && typeof fetch === "function";
}

// Split text for the API's per-request size limit, preferring word boundaries.
export function chunkForSend(text) {
  const s = asStr(text).trim();
  if (!s) return [];
  const words = s.split(/\s+/);
  const out = [];
  let buf = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${buf} ${words[i]}`;
    if (next.length <= MAX_CHUNK) { buf = next; continue; }
    out.push(buf);
    buf = words[i];
  }
  out.push(buf);
  return out;
}

function decodeEntities(s) {
  return s
    .split("&amp;").join("&")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .split("&lt;").join("<")
    .split("&gt;").join(">");
}

async function fetchLang(fetcher, text, pair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
  const r = await fetcher(url);
  if (!r || !r.ok) return "";
  const j = await r.json();
  const t = j && j.responseData && j.responseData.translatedText;
  return typeof t === "string" ? decodeEntities(t).trim() : "";
}

// Translate one English string into a language ("zh" | "ms"). Any failure
// quietly returns "" — the caller keeps whatever was there before.
export async function translateTo(fetcher, text, lang) {
  const s = asStr(text).trim();
  const pair = PAIRS[lang];
  if (!s || !pair) return "";
  const out = [];
  for (const chunk of chunkForSend(s)) {
    const t = await fetchLang(fetcher, chunk, pair);
    if (t) out.push(t);
  }
  return out.join(" ").trim();
}

// Run the translation plan over one product row (mutating it in place) and
// return the variant keys that actually changed. Adopted legacy values change
// nothing. A failed translation ("" from the API) leaves the box as it was, so
// the next pass simply retries.
export async function autoTranslateProduct(p, fetcher) {
  const plan = planTranslations(p);
  const changed = [];
  for (const step of plan) {
    const { variant, action } = step;
    if (action === "adopt") {
      markManual(p, variant);
      continue;
    }
    if (action === "clear") {
      if (p) delete p[variant];
      if (p && p.trSrc) delete p.trSrc[variant];
      if (p && p.trSrc && !Object.keys(p.trSrc).length) delete p.trSrc;
      changed.push(variant);
      continue;
    }
    const src = srcTextOf(p, variant);
    const t = await translateTo(fetcher, src, LANG_OF[variant]);
    if (t) {
      p[variant] = t;
      markAuto(p, variant, src);
      changed.push(variant);
    }
  }
  return changed;
}
