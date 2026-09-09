// profiles.js — the customer database. A saved profile adds lasting facts about
// a person (their dog's name/photo, what they like or avoid, notes) on top of
// what order history already derives — the reusable knowledge a future AI chat
// would draw on. Pure module: no DOM, runs under Node for tests.
//
// A profile lives in state.customers, one per person, keyed EXACTLY like an
// order row is keyed (keyOf: whatsapp number, else name, else the order id) so a
// profile always joins the same people the Customers list shows. Because the key
// is whatsapp-first, editing a person's profile never needs to rewrite their old
// orders — the join is recomputed, never stored on orders.

import { keyOf } from "./customers.js";
import { newId, save } from "./state.js";

// The saved profile for a derived row (by its _key), or null.
export function profileFor(state, rowKey) {
  if (!rowKey) return null;
  return (state.customers || []).find((p) => p && p.key === rowKey) || null;
}

// The profile for a raw order object — its keyOf is the same one customerList
// would give it, so the stored profile is found without building the list.
export function profileForOrder(state, o) {
  if (!o) return null;
  return profileFor(state, keyOf(o));
}

// Save (create or update) a profile from an edited draft. Matching is by key:
// an existing profile for the same person is updated in place (keeps its id and
// createdAt), otherwise a new profile is created. The draft may change the
// person's name/whatsapp — the key is recomputed from the NEW details, so later
// edits and later orders with the new number both land on this profile.
export function upsertProfile(state, draft) {
  if (!draft || typeof draft !== "object") return null;
  const list = Array.isArray(state.customers) ? state.customers : [];
  const now = new Date().toISOString();

  const existing = draft.id
    ? list.find((p) => p.id === draft.id)
    : null;

  const base = existing || {
    id: newId("cus"),
    key: "", // set below, from the (possibly new) contact details
    createdAt: now,
  };

  const name = String(draft.name || "").trim();
  const whatsapp = String(draft.whatsapp || "").trim();
  // Re-key from the NEW contact details when any survive an edit; an edit that
  // blanked both keeps the old key so the profile isn't orphaned off its person.
  base.key = name || whatsapp
    ? keyOf({ whatsapp, customerName: name }) || base.key || base.id
    : base.key || base.id;
  base.name = name;
  base.whatsapp = whatsapp;
  base.dogName = String(draft.dogName || "").trim();
  base.dogPhoto = String(draft.dogPhoto || "");
  base.likes = String(draft.likes || "").trim();
  base.avoid = String(draft.avoid || "").trim();
  base.notes = String(draft.notes || "").trim();
  base.updatedAt = now;

  if (!existing) {
    // A profile keyed only by an order id (no name or number on the draft) can
    // never be found again — the caller should have gated that away. Still, keep
    // the invariant: never create a profile whose key is a brand-new random id
    // unless it came from a real person row.
    if (!name && !whatsapp) return null;
    if (!list.some((p) => p.id === base.id)) list.push(base);
  }
  if (!Array.isArray(state.customers)) state.customers = list;
  save(state);
  return base;
}

// Copy any saved profile fields onto matching derived rows (matched by _key),
// returning the rows untouched when nothing is stored. The view then shows
// avatar/dog facts straight from each row's `.profile`.
export function attachProfiles(state, rows) {
  const out = [];
  for (const r of rows || []) {
    out.push({ ...r, profile: profileFor(state, r && r._key) });
  }
  return out;
}

// A person matches the query when any of their fields contains it — the finder
// looks across name, whatsapp number, dog name, what they like/avoid, notes and
// their favourite product. Case- and space-insensitive on both sides. A number
// typed without its spacing or country-code formatting still finds the person:
// a digits-only query ("6012 345 678") is also compared digit-to-digit, like
// the Orders finder, so it finds "+60 12-345 6789".
export function customerMatches(row, query) {
  const cleanTxt = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ");
  const q = cleanTxt(query).trim();
  if (!q) return true;
  const hay = (row && row.profile) || {};
  const fields = [
    row && row.name, row && row.whatsapp,
    hay.dogName, hay.likes, hay.avoid, hay.notes,
    row && row.fav,
  ];
  if (fields.some((f) => cleanTxt(f).includes(q))) return true;
  // Only a query that is itself a number (spaces/dashes/parens/plus aside) gets
  // the digit comparison — mixing words and digits stays a plain text search.
  const qDigits = q.replace(/[^\d]/g, "");
  if (qDigits.length >= 2 && /^[\d\s\-().+]+$/.test(q)) {
    return fields.some((f) => String(f || "").replace(/[^\d]/g, "").includes(qDigits));
  }
  return false;
}
