// productState.js — a product's three states: On the shop (live), Draft (still
// being built, not yet for sale) and Hidden (taken down). Pure module so tests
// and every view agree on what a product's state means.
//
// Storage: a draft is written draft:true AND active:false — active:false keeps
// it out of every "for sale" list (storefront payload, availability, Home
// counts, order pickers) even before the draft flag is read. Hidden is
// active:false with no draft flag; a live product has neither.

export function isDraft(p) {
  return !!(p && p.draft === true);
}

export function isHidden(p) {
  return !!(p && p.draft !== true && p.active === false);
}

export function isLive(p) {
  return !!(p && p.draft !== true && p.active !== false);
}

export function stateOf(p) {
  if (!p) return "hidden";
  if (p.draft === true) return "draft";
  return p.active === false ? "hidden" : "live";
}

// A brand-new product starts as a draft — built but never on the shop (and
// never orderable) until the baker publishes it.
export function newDraftRow() {
  return { active: false, draft: true };
}
