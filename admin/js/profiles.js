// profiles.js — the customer database. A person's name and WhatsApp number are
// held in ONE place and kept in step: edit them on the saved profile or on any
// of their orders and the other side follows, so whichever the baker touched
// last is what every screen shows. The profile also holds the lasting facts
// about them (their dog's name/photo, what they like or avoid, notes) that order
// history can't derive — the reusable knowledge a future AI chat would draw on.
// Pure module: no DOM, runs under Node for tests.
//
// A profile lives in state.customers, one per person, keyed EXACTLY like an
// order row is keyed (keyOf: whatsapp number, else name, else the order id) so a
// profile always joins the same people the Customers list shows. Because that
// key is DERIVED from the order's own fields, changing a person's name or number
// is a re-key AND a rewrite: applyContact writes the new details onto every one
// of their orders in the same step, so the profile can never drift off them.

import { keyOf, phoneDigits } from "./customers.js";
import { newId, save, waNumber } from "./state.js";

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

// ── name + WhatsApp: one saved copy, written through to the orders ──────────

// The name and number a person's orders currently carry. One order is enough:
// keyOf is derived from these very fields, so everyone under one key holds the
// same pair.
function contactOnOrders(state, key) {
  const o = (state.orders || []).find((x) => x && keyOf(x) === key);
  return {
    name: String((o && o.customerName) || "").trim(),
    whatsapp: String((o && o.whatsapp) || "").trim(),
  };
}

// Referral credits are held by the number's digits (see referrals.js), so they
// don't follow a number change on their own — they'd be stranded on a number
// nobody owns any more.
function repointCredits(state, fromWhatsapp, toWhatsapp, name) {
  const from = waNumber(fromWhatsapp);
  const to = waNumber(toWhatsapp);
  if (!from || !to || from === to) return;
  for (const c of state.credits || []) {
    if (!c || waNumber(c.holder) !== from) continue;
    c.holder = to;
    if (name) c.holderName = name;
  }
}

// Two profiles landing on one key means the same person now exists twice. The
// profile being edited wins on the contact details and keeps the fields it
// already has; the duplicate only fills the blanks in, then goes.
function mergeDuplicateProfiles(state, base) {
  const list = state.customers || [];
  const clash = list.find((p) => p !== base && p && p.key === base.key);
  if (!clash) return;
  for (const f of ["dogName", "dogPhoto", "likes", "avoid", "notes"]) {
    if (!base[f] && clash[f]) base[f] = clash[f];
  }
  const i = list.indexOf(clash);
  if (i >= 0) list.splice(i, 1);
}

// When you last touched a record, by the same authority customerRowName
// uses to pick between a disagreeing card and order.
function touchedAt(p) {
  return Date.parse((p && (p.orderEditAt || p.updatedAt)) || "") || 0;
}

// Fill every blank on `base` from `other` — the contact details included. This
// is NOT mergeDuplicateProfiles: that one deliberately keeps the contact you
// just typed, because a hand edit must win. Here neither record was just
// edited by anyone, so the only rule that cannot lose what you know is "never
// throw away a value only one of them has".
function foldProfileInto(base, other) {
  for (const f of ["name", "whatsapp", "dogName", "dogPhoto", "likes", "avoid", "notes"]) {
    if (!base[f] && other[f]) base[f] = other[f];
  }
  if (other.createdAt && (!base.createdAt || other.createdAt < base.createdAt)) {
    base.createdAt = other.createdAt;
  }
}

// Fold every group of profiles that now share one key down to a single record.
// Grouped up front rather than walking the list, so removing a record can never
// shift an index out from under the loop.
function collapseByKey(list) {
  const groups = new Map();
  for (const p of list) {
    if (!p || !p.key) continue;
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key).push(p);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Keep the most recently touched record — its name is the one already on
    // screen, so the person you see does not change identity under you.
    group.sort((a, b) => touchedAt(b) - touchedAt(a));
    const keep = group[0];
    for (const other of group.slice(1)) {
      foldProfileInto(keep, other);
      const i = list.indexOf(other);
      if (i >= 0) list.splice(i, 1);
    }
  }
}

// One-time catch-up (v120). Until now a person was identified by their number's
// exact spelling, so a profile saved as "+60123456789" and one saved as
// "60123456789" were two people and the Customers list showed them twice. Bring
// the whole book onto the digits rule once: re-key each saved record, fold the
// ones that collapse together (keeping dog photos, likes and notes), and write
// the canonical number onto the orders so what is displayed matches what is
// dialled. Idempotent — a second run changes nothing, which the sync layer
// depends on. Returns how many values moved.
export function canonicaliseCustomers(state) {
  let moved = 0;
  const list = Array.isArray(state.customers) ? state.customers : [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    // The record's OWN number must be canonical too, not just its key: the card
    // seeds its box from this value, and a raw one left here would be written
    // back onto the orders on your next save.
    const digits = phoneDigits(p.whatsapp);
    if (digits && digits !== p.whatsapp) { p.whatsapp = digits; moved++; }
    const next = keyOf({ whatsapp: p.whatsapp, customerName: p.name, id: p.id });
    if (next && p.key !== next) { p.key = next; moved++; }
  }
  collapseByKey(list);
  for (const o of state.orders || []) {
    if (!o || typeof o !== "object") continue;
    const digits = phoneDigits(o.whatsapp);
    if (digits && digits !== o.whatsapp) { o.whatsapp = digits; moved++; }
  }
  return moved;
}

// Join two records you have told us are one person. `keepKey` is the row
// you opened (the one that stays), `absorbKey` is the duplicate you picked. The
// absorbed person's orders are rewritten onto the kept contact, so they stop
// being a separate row — that is the whole point, and it is not reversible from
// inside the app.
//
// The kept contact is filled from the absorbed one's blanks first: joining a
// person saved by name only with a numbered duplicate would otherwise take the
// name but not the number, and leave them split anyway.
export function mergeCustomers(state, keepKey, absorbKey) {
  const keep = String(keepKey || "").trim();
  const absorb = String(absorbKey || "").trim();
  if (!keep || !absorb || keep === absorb) return null;

  const keepProf = profileFor(state, keep);
  const absorbProf = profileFor(state, absorb);
  const keepHeld = contactOnOrders(state, keep);
  const absorbHeld = contactOnOrders(state, absorb);

  const name = String((keepProf && keepProf.name) || "").trim() || keepHeld.name
    || String((absorbProf && absorbProf.name) || "").trim() || absorbHeld.name;
  const whatsapp = String((keepProf && keepProf.whatsapp) || "").trim() || keepHeld.whatsapp
    || String((absorbProf && absorbProf.whatsapp) || "").trim() || absorbHeld.whatsapp;

  // Moves the absorbed person's orders under the kept details, and re-points any
  // referral credit their number was holding.
  const contact = applyContact(state, absorb, { name, whatsapp });

  // The kept side's own orders can be keyed by their NAME — someone saved before
  // they ever had a number. Writing the merged contact across only the absorbed
  // orders would leave the two halves split, which is the bug this join exists
  // to fix. A no-op whenever the kept orders already carry these details.
  applyContact(state, keep, { name: contact.name, whatsapp: contact.whatsapp });

  if (keepProf && absorbProf) {
    foldProfileInto(keepProf, absorbProf);
    const i = (state.customers || []).indexOf(absorbProf);
    if (i >= 0) state.customers.splice(i, 1);
  }
  // One saved record survives, under the kept key — and if only the absorbed
  // side had one, it becomes the kept person's rather than going in the bin with
  // their dog photo.
  const prof = keepProf || absorbProf;
  if (prof) {
    prof.key = contact.newKey || keep;
    prof.name = contact.name;
    prof.whatsapp = contact.whatsapp;
    prof.updatedAt = new Date().toISOString();
    prof.orderEditAt = prof.updatedAt;
  }
  save(state);
  return prof;
}

// The write-through in action: take the details the baker typed, resolve them
// against what the orders already hold, and rewrite every order belonging to the
// person at `oldKey`. Returns the details now in force and the key they now sit
// under, so the caller can store exactly those.
//
// A blank box never overwrites a value the orders already hold — emptying the
// WhatsApp box means "I'm not changing this", not "delete the number the
// confirmations, payment QR and message drafts depend on".
export function applyContact(state, oldKey, { name, whatsapp } = {}) {
  const key = String(oldKey || "").trim();
  const held = contactOnOrders(state, key);
  const nextName = String(name || "").trim() || held.name;
  const nextWhatsapp = String(whatsapp || "").trim() || held.whatsapp;
  const newKey = keyOf({ whatsapp: nextWhatsapp, customerName: nextName }) || key;

  for (const o of state.orders || []) {
    if (!o || keyOf(o) !== key) continue;
    if (o.customerName !== nextName) o.customerName = nextName;
    if (o.whatsapp !== nextWhatsapp) o.whatsapp = nextWhatsapp;
  }

  const prof = profileFor(state, key);
  repointCredits(state, held.whatsapp || (prof && prof.whatsapp), nextWhatsapp, nextName);
  return { oldKey: key, newKey, name: nextName, whatsapp: nextWhatsapp };
}

// Orders → Edit. The baker fixed a name or a number on an order; carry it to
// the person's other orders and to their saved record, so the order screen is
// never a second, disagreeing copy. Creates no profile — someone with no saved
// record has nothing to keep in step.
export function syncContactFromOrder(state, fromKey, { customerName, whatsapp } = {}) {
  const key = String(fromKey || "").trim();
  if (!key) return null;
  const prof = profileFor(state, key);
  const contact = applyContact(state, key, { name: customerName, whatsapp });
  if (prof) {
    prof.key = contact.newKey || prof.key;
    prof.name = contact.name;
    prof.whatsapp = contact.whatsapp;
    prof.updatedAt = new Date().toISOString();
    // The order side made this edit, so it wins if a stale copy ever disagrees.
    prof.orderEditAt = prof.updatedAt;
    mergeDuplicateProfiles(state, prof);
  }
  save(state);
  return contact;
}

// One-time catch-up for customers renamed before this version. Their saved
// record holds the name they should have while their orders still carry the old
// one, so labels and messages would keep printing it. Touches only people whose
// profile already joins their orders — an orphaned profile is left alone rather
// than guessed at, since merging the wrong two people is worse than leaving it.
// Returns how many order fields moved, so the caller can skip a pointless save.
export function reconcileContacts(state) {
  let moved = 0;
  for (const p of state.customers || []) {
    if (!p || !p.key) continue;
    const name = String(p.name || "").trim();
    const whatsapp = String(p.whatsapp || "").trim();
    if (!name && !whatsapp) continue;
    for (const o of state.orders || []) {
      if (!o || keyOf(o) !== p.key) continue;
      if (name && o.customerName !== name) { o.customerName = name; moved++; }
      if (whatsapp && o.whatsapp !== whatsapp) { o.whatsapp = whatsapp; moved++; }
    }
  }
  return moved;
}

// Save (create or update) a profile from an edited draft. Matching is by id when
// the draft carries one, else by the person's current key. The contact details
// are written through to their orders first (applyContact), then the profile is
// re-keyed to match, so the two move together and can't drift apart.
export function upsertProfile(state, draft, fromKey) {
  if (!draft || typeof draft !== "object") return null;
  const list = Array.isArray(state.customers) ? state.customers : [];
  const now = new Date().toISOString();

  const existing = draft.id
    ? list.find((p) => p.id === draft.id)
    : null;

  // Which person is this? The row the form was opened from, else the profile's
  // own key, else whatever the typed details already match.
  const key = String(fromKey || "").trim()
    || (existing && existing.key)
    || keyOf({ whatsapp: draft.whatsapp, customerName: draft.name })
    || "";

  const contact = applyContact(state, key, { name: draft.name, whatsapp: draft.whatsapp });
  // A profile keyed only by an order id (no name or number anywhere) can never
  // be found again — the caller should have gated that away. Keep the invariant:
  // never create a profile with nothing to key it by.
  if (!existing && !contact.name && !contact.whatsapp) return null;

  const base = existing || { id: newId("cus"), key: "", createdAt: now };
  base.key = contact.newKey || base.key || base.id;
  base.name = contact.name;
  base.whatsapp = contact.whatsapp;
  base.dogName = String(draft.dogName || "").trim();
  base.dogPhoto = String(draft.dogPhoto || "");
  base.likes = String(draft.likes || "").trim();
  base.avoid = String(draft.avoid || "").trim();
  base.notes = String(draft.notes || "").trim();
  base.updatedAt = now;

  if (!list.some((p) => p.id === base.id)) list.push(base);
  if (!Array.isArray(state.customers)) state.customers = list;
  mergeDuplicateProfiles(state, base);
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

// The name to show for a derived customer row (one from customerList, with its
// profile attached). The saved record and the orders hold one shared name — a
// fix in either place is written through to the other — so they normally agree
// and the question doesn't arise. When they do disagree (data saved before the
// two were kept in step, or a storefront order arriving with a different
// spelling) the side the baker edited last is the one shown: a name typed on the
// order after the saved card is used, otherwise the saved card's. With neither
// side carrying a real edit time the order's own name is preferred, and with no
// name anywhere the row reads "(no name)".
export function customerRowName(row) {
  const prof = (row && row.profile) || null;
  const saved = String((prof && prof.name) || "").trim();
  const raw = String((row && row.name) || "").trim();
  const orderName = raw === "(no name)" ? "" : raw;
  if (!saved) return orderName || "(no name)";
  if (!orderName || orderName === saved) return saved;
  const cardAt = Date.parse((prof && prof.updatedAt) || "") || 0;
  const orderAt = Date.parse((prof && prof.orderEditAt) || "") || 0;
  return orderAt >= cardAt ? orderName : saved;
}

// The order form's name box: a person matches when the name shown for them, or
// their number, contains what was typed. Deliberately narrower than the finder
// below — that one is free to answer "whose pet is called Milo", because you
// opened a search box. This box answers "who is this", so a hit whose own title
// does not contain the query would read as a wrong answer rather than a clever
// one. A person with no name at all is never a match: you could not recognise
// the row, so offering it only wastes a tap.
export function customerNameMatches(row, query) {
  const clean = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ");
  const q = clean(query).trim();
  if (!q) return false;
  const name = customerRowName(row);
  if (name === "(no name)") return false;
  // The orders and the saved record hold one shared number, but a profile saved
  // before the two were kept in step can carry the only copy.
  const whatsapp = String((row && row.whatsapp) || ((row && row.profile && row.profile.whatsapp) || ""));
  if (clean(name).includes(q) || clean(whatsapp).includes(q)) return true;
  const qDigits = q.replace(/[^\d]/g, "");
  if (qDigits.length < 2 || !/^[\d\s\-().+]+$/.test(q)) return false;
  return whatsapp.replace(/[^\d]/g, "").includes(qDigits);
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
