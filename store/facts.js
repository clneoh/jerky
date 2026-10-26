// store/facts.js — the "Good to know" bullets, which are HER words when she has written them.
//
// ⭐ v641: the block was written into this page by me; now it can be edited in the backoffice (Settings →
// Storefront) and published with everything else. ⚠️ **Blank falls back to the shop's own wording**, so the
// panel can never end up empty, and a customer always reads something true.

// ★★ THE SHOP'S OWN FIVE LINES (v642) — the SAME words the panel draws when she has written nothing.
// ⚠️ Her words: __"the Good to know dont reflex what is in the store, what is in the store is better words"__ —
// ⭐ so the box in Settings opens holding **exactly these**, not a paraphrase typed into the editor. One list,
// two readers: the shop falls back to it, and the editor shows it.
// ⚠️ The courier's name lives HERE, in the shop, and not in the editor's own file — the screen never names a
// courier; the storefront copy is where that word belongs.
import { STORE } from "../store-lang.js";

const FACT_KEYS = ["factBake", "factCutoff", "factGet", "factPay", "factChange"];
export const DEFAULT_FACTS = FACT_KEYS
  .map((k) => String((STORE && STORE.en && STORE.en[k]) || "").trim())
  .filter(Boolean);

export const FACTS_MAX_LINES = 12;
export const FACTS_MAX_CHARS = 600;

/**
 * The bullets to draw.
 * @param {{facts?: string, factsZh?: string, factsMs?: string}|null} published what the backoffice published
 * @param {string} lang "en" | "zh" | "ms"
 * @param {string[]} fallback the shop's own lines, already translated
 * @returns {string[]}
 */
export function factsLines(published, lang, fallback) {
  const pick = (v) => (typeof v === "string" ? v : "");
  const en = pick(published && published.facts).trim();
  // ⚠️ A COUNTRY'S OWN WORDS FIRST, THEN hers in English, THEN the shop's default. ⭐ Her English is better than
  // a default she has replaced — a reader in 中文 gets her sentence rather than a sentence she no longer stands by.
  const own = lang === "zh" ? (pick(published && published.factsZh).trim() || en)
    : lang === "ms" ? (pick(published && published.factsMs).trim() || en)
      : en;
  const lines = own
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, FACTS_MAX_LINES);
  if (lines.length) return lines;
  return (Array.isArray(fallback) ? fallback : []).filter((s) => typeof s === "string" && s.trim());
}

/** The text a box should hold: her saved words, or the shop's own as a starting point. */
export function factsBoxText(published, lang = "en", fallback = []) {
  const key = lang === "zh" ? "factsZh" : lang === "ms" ? "factsMs" : "facts";
  const own = published && typeof published[key] === "string" ? published[key].trim() : "";
  return own || (Array.isArray(fallback) ? fallback.join("\n") : "");
}
