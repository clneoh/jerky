// test/profiles.test.js — the customer database: profile CRUD, its join to the
// derived customer rows, and the finder matcher.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { customerList } from "../admin/js/customers.js";
import { attachProfiles, customerMatches, customerRowName, profileFor, profileForOrder, upsertProfile } from "../admin/js/profiles.js";

// A tiny app-password hash constant unused here — kept to match sibling files.

function state(orders = [], customers = []) {
  return { orders, customers, deliveryDates: [] };
}

test("upsertProfile creates a profile and keys it like the orders do (whatsapp first)", () => {
  const st = state([
    { id: "o1", customerName: "Aunty Bee", whatsapp: "6012-111", qty: 1 },
  ]);
  const p = upsertProfile(st, { name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco", likes: "banana" });
  assert.ok(p && p.id.startsWith("cus_"));
  assert.equal(p.key, "6012-111"); // normed whatsapp, exactly keyOf's rule
  assert.equal(st.customers.length, 1);

  // The same person's derived row joins straight to that profile.
  const [row] = customerList(st);
  const prof = profileFor(st, row._key);
  assert.equal(prof && prof.id, p.id);
  assert.equal(prof.dogName, "Coco");
});

test("upsertProfile updates the same person instead of duplicating", () => {
  const st = state([], []);
  const first = upsertProfile(st, { name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco", likes: "banana" });
  // The edit form always sends every field, so the second save overwrites whole.
  const second = upsertProfile(st, { id: first.id, name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco", likes: "nuts", notes: "loves the focaccia" });
  assert.equal(st.customers.length, 1, "editing keeps one profile, never a second");
  assert.equal(second.id, first.id);
  assert.equal(second.dogName, "Coco");
  assert.equal(second.likes, "nuts");
  assert.equal(second.createdAt, first.createdAt, "createdAt is kept from the original");
  assert.ok(second.updatedAt >= first.updatedAt);
});

test("upsertProfile without a name or number refuses to create an anonymous profile", () => {
  const st = state([]);
  const p = upsertProfile(st, { likes: "cake" });
  assert.equal(p, null);
  assert.equal(st.customers.length, 0);
});

test("a profile keyed by name joins orders that share the name but no number", () => {
  const st = state([
    { id: "o1", customerName: "Walk-in regular", qty: 1 },
  ]);
  const p = upsertProfile(st, { name: "Walk-in regular", dogName: "Milo" });
  assert.equal(p.key, "walk-in regular");
  const [row] = customerList(st);
  assert.equal(profileFor(st, row._key).dogName, "Milo");
});

test("keyOf trims + lowercases both sides, so a casey name still joins", () => {
  const st = state([
    { id: "o1", customerName: "  Aunty Bee ", qty: 1 },
  ]);
  const p = upsertProfile(st, { name: "Aunty Bee", dogName: "Coco" });
  const [row] = customerList(st);
  assert.equal(profileFor(st, row._key).dogName, "Coco",
    "outer spaces and capital letters on either side still key to one person");
  assert.equal(p.key, "aunty bee");
});

test("attachProfiles copies each saved profile onto its matching derived row", () => {
  const st = state([
    { id: "o1", customerName: "Aunty Bee", whatsapp: "6012-111", qty: 1 },
    { id: "o2", customerName: "Mr Lim", whatsapp: "6013-222", qty: 1 },
  ]);
  upsertProfile(st, { name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco" });
  const rows = attachProfiles(st, customerList(st));
  const bee = rows.find((r) => r._key === "6012-111");
  const lim = rows.find((r) => r._key === "6013-222");
  assert.equal(bee.profile && bee.profile.dogName, "Coco");
  assert.equal(lim.profile, null, "no saved profile stays null");
});

test("customerRowName names a no-name customer from their saved profile", () => {
  // The order carried no name (so the derived row reads "(no name)"), but the
  // baker named the person in their profile — the row must show that name.
  const anonymous = { _key: "6012-111", name: "(no name)", whatsapp: "6012-111", profile: { name: "Aunty Bee" } };
  assert.equal(customerRowName(anonymous), "Aunty Bee");

  // The order's own name still wins when there is one.
  assert.equal(customerRowName({ name: "Mr Lim", profile: { name: "Aunty Bee" } }), "Mr Lim");
  // No name anywhere falls back to the derived label.
  assert.equal(customerRowName({ name: "(no name)", profile: null }), "(no name)");
  // A profile with a blank name does not invent one.
  assert.equal(customerRowName({ name: "(no name)", profile: { name: "  " } }), "(no name)");
  // A blank derived name with a saved profile name still resolves (older rows).
  assert.equal(customerRowName({ name: "", profile: { name: "Nurul" } }), "Nurul");
});

test("customerMatches searches the person, their dog, likes, avoids, notes and favourite", () => {
  const base = { _key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", fav: "Sourdough" };
  const prof = { dogName: "Coco", likes: "banana, extra cocoa", avoid: "coconut", notes: "collects Saturdays" };
  const row = { ...base, profile: prof };
  assert.equal(customerMatches(row, "bee"), true);
  assert.equal(customerMatches(row, "6012"), true);
  assert.equal(customerMatches(row, "coco"), true);
  assert.equal(customerMatches(row, "cocoa"), true); // likes
  assert.equal(customerMatches(row, "coconut"), true); // avoid
  assert.equal(customerMatches(row, "saturdays"), true); // notes
  assert.equal(customerMatches(row, "sourdough"), true); // favourite product
  assert.equal(customerMatches(row, "zoey"), false);
  assert.equal(customerMatches(row, ""), true, "empty query matches everyone");
  assert.equal(customerMatches(row, "  "), true, "blank query matches everyone");
});

test("customerMatches finds a number typed without its formatting or country code", () => {
  const row = { _key: "6012-111", name: "Aunty Bee", whatsapp: "+60 12-345 6789", fav: "Sourdough" };
  assert.equal(customerMatches(row, "60123456789"), true); // all digits, no spacing
  assert.equal(customerMatches(row, "6016"), false); // wrong exchange must not match
  const namey = { _key: "6012-111", name: "Aunty Bee", whatsapp: "+60 12-345 6789" };
  assert.equal(customerMatches(namey, "aisha6012"), false, "unrelated text + shared digits stays a miss");
  assert.equal(customerMatches({ _key: "x", name: "Raj", fav: "Sourdough" }, "6016"), false, "no number on the row");
});

test("profileForOrder finds the profile from a raw order (same keyOf)", () => {
  const st = state([{ id: "o1", customerName: "Bee", whatsapp: "6012-111", qty: 1 }], []);
  upsertProfile(st, { name: "Bee", whatsapp: "6012-111", likes: "rosemary" });
  const o = st.orders[0];
  assert.equal(profileForOrder(st, o).likes, "rosemary");
});
