// store/full_day.js — what a tapped FULL bake day answers.
//
// ⚠️ WHY THIS IS ITS OWN FILE. The answer is one sentence and one press, and the press must choose the SAME
// day the sentence names — so the day is found ONCE, here, and returned for both. ⭐ It is also the only part
// of the refinement that can be tested without a browser, and a rule that lives in a page nobody can import
// is a rule nobody can pin.
//
// The spec shape is the shop's own: `{ date: Date, soldOut: boolean }`, straight out of `daySpecs()`.

const pad = (n) => String(n).padStart(2, "0");

// The shop's own key format (a local calendar date, never UTC — a UTC key would shift the day for every
// customer in Malaysia after 8am, which is the class of bug this app has already paid for).
export function isoOf(d) {
  if (!d || typeof d.getFullYear !== "function") return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The next day AFTER `iso` that can still be ordered, or null.
 * ⚠️ "After" is strictly later: the full day itself is never offered back as its own answer.
 * ⚠️ A day with no `soldOut` flag is treated as open, because that is what the shop draws — a spec always
 * carries the flag, and guessing the other way would invent a refusal.
 */
export function nextOpenAfter(specs, iso) {
  const list = Array.isArray(specs) ? specs : [];
  let best = null;
  let bestKey = "";
  for (const s of list) {
    if (!s || s.soldOut) continue;
    const key = isoOf(s.date);
    if (!key || key <= iso) continue;
    if (!best || key < bestKey) { best = s; bestKey = key; }
  }
  return best;
}

/**
 * The whole answer for a tapped day: whether it really is full, and the day to offer next.
 * ⚠️ `{ full: false }` means the day is no longer full (a cancellation, or a refresh that changed the
 * availability) — the caller then stops showing the note rather than leaving a sentence that has gone stale.
 */
export function fullDayAnswer(specs, iso) {
  const list = Array.isArray(specs) ? specs : [];
  const spec = list.find((s) => s && isoOf(s.date) === iso) || null;
  if (!spec || !spec.soldOut) return { full: false, next: null };
  return { full: true, next: nextOpenAfter(list, iso) };
}
