// test/profiles.test.js — the customer database: profile CRUD, its join to the
// derived customer rows, and the finder matcher.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { customerList, keyOf } from "../admin/js/customers.js";
import { attachProfiles, canonicaliseCustomers, customerMatches, customerNameMatches, customerRowName, mergeCustomers, profileFor, profileForOrder, reconcileContacts, syncContactFromOrder, upsertProfile } from "../admin/js/profiles.js";

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
  assert.equal(p.key, "6012111"); // the number's digits, exactly keyOf's rule
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
  const bee = rows.find((r) => r._key === "6012111");
  const lim = rows.find((r) => r._key === "6013222");
  assert.equal(bee.profile && bee.profile.dogName, "Coco");
  assert.equal(lim.profile, null, "no saved profile stays null");
});

test("customerRowName names a nameless order from the saved profile, else '(no name)'", () => {
  // The order carried no name (so the derived row reads "(no name)"), but the
  // baker named the person in their profile — the row must show that name.
  const anonymous = { _key: "6012-111", name: "(no name)", whatsapp: "6012-111", profile: { name: "Aunty Bee" } };
  assert.equal(customerRowName(anonymous), "Aunty Bee");

  // With no saved name the orders' own name is used...
  assert.equal(customerRowName({ name: "Mr Lim", profile: null }), "Mr Lim");
  // ...and the derived label when there is no name anywhere.
  assert.equal(customerRowName({ name: "(no name)", profile: null }), "(no name)");
  // A profile with a blank name does not invent one.
  assert.equal(customerRowName({ name: "(no name)", profile: { name: "  " } }), "(no name)");
  // A blank derived name with a saved profile name still resolves (older rows).
  assert.equal(customerRowName({ name: "", profile: { name: "Nurul" } }), "Nurul");
});

test("customerRowName: when the card and the order disagree, the side edited last wins", () => {
  const card = { name: "Mr Lim", profile: { name: "Aunty Bee" } };
  // The card was saved after the order was last touched — the card's name shows.
  assert.equal(customerRowName({ ...card, profile: { ...card.profile, updatedAt: "2026-09-10T10:00:00Z", orderEditAt: "2026-09-10T09:00:00Z" } }), "Aunty Bee");
  // The order was fixed after the card — the order's name shows, card or not.
  assert.equal(customerRowName({ ...card, profile: { ...card.profile, updatedAt: "2026-09-10T09:00:00Z", orderEditAt: "2026-09-10T10:00:00Z" } }), "Mr Lim");
  // No edit times recorded (older data): the order's own name is preferred, so
  // the card is never the automatic winner.
  assert.equal(customerRowName(card), "Mr Lim");
  // Equal times — the two carry one value, so either resolves the same.
  assert.equal(customerRowName({ name: "Aunty Bee", profile: { name: "Aunty Bee", updatedAt: "2026-09-10T10:00:00Z", orderEditAt: "2026-09-10T10:00:00Z" } }), "Aunty Bee");
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

// ---- customerNameMatches: the order form's name box (18 Sep 2026) ----
// A narrower cousin of customerMatches. The finder below answers "who has a dog
// called Milo"; this box answers "who is this", so a hit whose own title does not
// contain the query would read as a wrong answer rather than a clever one.

test("customerNameMatches searches the name shown, not a stale one underneath", () => {
  // The saved card was touched more recently than the orders, so the row is shown
  // under the card's name. What she can see is what she can type.
  const row = {
    _key: "k", name: "Bob", whatsapp: "012-345 6789",
    profile: { name: "Aisha", updatedAt: "2026-09-10T10:00:00Z", orderEditAt: "2026-09-01T00:00:00Z" },
  };
  assert.equal(customerRowName(row), "Aisha");
  assert.equal(customerNameMatches(row, "aisha"), true);
  assert.equal(customerNameMatches(row, "bob"), false, "a spelling she cannot see is not offered");
});

test("customerNameMatches finds the number, with or without its formatting", () => {
  const row = { _key: "k", name: "Aunty Bee", whatsapp: "+60 12-345 6789" };
  assert.equal(customerNameMatches(row, "bee"), true);
  assert.equal(customerNameMatches(row, "  aunty   bee "), true, "spacing on either side is ignored");
  assert.equal(customerNameMatches(row, "012-345"), true);
  assert.equal(customerNameMatches(row, "60123456789"), true, "the digits alone still find them");
  assert.equal(customerNameMatches(row, "6016"), false, "a wrong exchange is not a hit");
  // A record saved before the two copies of a number were kept in step can hold
  // the only one there is.
  const cardOnly = { _key: "k", name: "Aunty Bee", whatsapp: "", profile: { whatsapp: "012-999 8888" } };
  assert.equal(customerNameMatches(cardOnly, "012-999"), true);
});

test("customerNameMatches stays on the name and number — it is not the finder", () => {
  const row = {
    _key: "k", name: "Aunty Bee", whatsapp: "6012-111", fav: "Sourdough",
    profile: { dogName: "Coco", likes: "banana", avoid: "coconut", notes: "collects Saturdays" },
  };
  assert.equal(customerNameMatches(row, "bee"), true);
  assert.equal(customerNameMatches(row, "coco"), false, "the dog belongs to the finder, not this box");
  assert.equal(customerNameMatches(row, "banana"), false);
  assert.equal(customerNameMatches(row, "coconut"), false);
  assert.equal(customerNameMatches(row, "saturdays"), false);
  assert.equal(customerNameMatches(row, "sourdough"), false);
});

test("customerNameMatches never offers a person with no name, and has no answer for a blank box", () => {
  const anon = { _key: "o1", name: "(no name)", whatsapp: "012-345 6789" };
  assert.equal(customerNameMatches(anon, "012"), false, "she could not recognise the row");
  const row = { _key: "k", name: "Aunty Bee", whatsapp: "6012-111" };
  assert.equal(customerNameMatches(row, ""), false,
    "unlike the finder, a blank box suggests nobody; the form does the length gate");
});

test("profileForOrder finds the profile from a raw order (same keyOf)", () => {
  const st = state([{ id: "o1", customerName: "Bee", whatsapp: "6012-111", qty: 1 }], []);
  upsertProfile(st, { name: "Bee", whatsapp: "6012-111", likes: "rosemary" });
  const o = st.orders[0];
  assert.equal(profileForOrder(st, o).likes, "rosemary");
});

// ── the saved record is the single source of truth for name + number ─────────
// Before this, an edit in the profile was ignored whenever the orders already
// carried a name, and renaming someone with no number re-keyed the profile
// clean off their orders (their new name then showed nowhere at all).

test("renaming a customer with no number re-keys the profile AND their orders, so they stay one person", () => {
  const st = state([
    { id: "o1", customerName: "Walk-in aunty", qty: 1 },
    { id: "o2", customerName: "Walk-in aunty", qty: 2 },
  ]);
  const p = upsertProfile(st, { name: "Walk-in aunty" }, "walk-in aunty");
  assert.equal(p.key, "walk-in aunty");

  upsertProfile(st, { id: p.id, name: "Aunty Bee" }, "walk-in aunty");

  assert.equal(st.customers.length, 1, "still one profile — not orphaned, not duplicated");
  assert.equal(st.customers[0].key, "aunty bee", "re-keyed to the name the baker typed");
  assert.deepEqual(st.orders.map((o) => o.customerName), ["Aunty Bee", "Aunty Bee"]);

  // And the customer book still shows them once, under their whole history.
  const rows = attachProfiles(st, customerList(st));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._key, "aunty bee");
  assert.equal(rows[0].orders, 2);
  assert.equal(customerRowName(rows[0]), "Aunty Bee");
  assert.equal(profileFor(st, rows[0]._key).id, p.id, "the same profile still owns them");
});

test("renaming one customer writes through to all their orders and to nobody else's", () => {
  const st = state([
    { id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1, groupId: "g1" },
    { id: "o2", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1, groupId: "g1" },
    { id: "o3", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 },
    { id: "o4", customerName: "Mr Lim", whatsapp: "6013-222", qty: 1 },
  ]);
  const p = upsertProfile(st, { name: "Ah Girl", whatsapp: "6012-111" }, "6012111");

  upsertProfile(st, { id: p.id, name: "Tan Siew Ling", whatsapp: "6012-111" }, "6012111");

  assert.deepEqual(st.orders.slice(0, 3).map((o) => o.customerName),
    ["Tan Siew Ling", "Tan Siew Ling", "Tan Siew Ling"]);
  assert.equal(st.orders[3].customerName, "Mr Lim", "another customer is untouched");
  assert.equal(st.customers[0].key, "6012111", "a number-first key doesn't move when only the name changes");
});

test("emptying the WhatsApp box keeps the number the orders already have", () => {
  const st = state([{ id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 }]);
  const p = upsertProfile(st, { name: "Ah Girl", whatsapp: "6012-111" }, "6012111");

  upsertProfile(st, { id: p.id, name: "Tan Siew Ling", whatsapp: "" }, "6012111");

  assert.equal(st.orders[0].whatsapp, "6012-111", "the number the confirmations need is never wiped by a blank box");
  assert.equal(st.customers[0].whatsapp, "6012-111", "the profile keeps the value too, so the two still agree");
  assert.equal(st.customers[0].key, "6012111", "and the person is not re-keyed off their orders");
  assert.equal(st.orders[0].customerName, "Tan Siew Ling", "the name they did type still lands");
});

test("naming someone onto an existing customer merges the two records into one", () => {
  const st = state([
    { id: "o1", customerName: "Ah Girl", qty: 1 },
    { id: "o2", customerName: "Aunty Bee", qty: 1 },
  ]);
  const girl = upsertProfile(st, { name: "Ah Girl", dogName: "Coco" }, "ah girl");
  const bee = upsertProfile(st, { name: "Aunty Bee", likes: "banana" }, "aunty bee");
  assert.equal(st.customers.length, 2);

  // The baker decides these two were the same person all along.
  upsertProfile(st, { id: girl.id, name: "Aunty Bee", dogName: "Coco" }, "ah girl");

  assert.equal(st.customers.length, 1, "one record, not two");
  assert.equal(st.customers[0].id, girl.id, "the profile being edited survives");
  assert.equal(st.customers[0].dogName, "Coco", "it keeps its own fields");
  assert.equal(st.customers[0].likes, "banana", "and takes in the ones only the other had");
  assert.equal(st.customers.some((p) => p.id === bee.id), false, "the duplicate is gone");
  assert.equal(customerList(st).length, 1, "and the customer book shows them once");
});

test("fixing a name on one order carries to that person's other orders and their record", () => {
  const st = state([
    { id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 },
    { id: "o2", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 },
  ]);
  upsertProfile(st, { name: "Ah Girl", whatsapp: "6012-111", dogName: "Coco" }, "6012111");

  syncContactFromOrder(st, "6012111", { customerName: "Tan Siew Ling", whatsapp: "6012-111" });

  assert.deepEqual(st.orders.map((o) => o.customerName), ["Tan Siew Ling", "Tan Siew Ling"]);
  assert.equal(profileFor(st, "6012111").name, "Tan Siew Ling", "the saved record keeps up");
  assert.equal(profileFor(st, "6012111").dogName, "Coco", "and its extra facts are left alone");
  // The order side was the last editor, so it is remembered as the newest — a
  // stale copy on either side would resolve to this name.
  assert.ok(profileFor(st, "6012111").orderEditAt, "the order edit is remembered as the newest");
  const [row] = attachProfiles(st, customerList(st));
  assert.equal(customerRowName(row), "Tan Siew Ling", "the corrected name is what the book shows");
  assert.equal(customerRowName({ name: "Ah Girl", profile: { ...row.profile, updatedAt: "2026-09-10T09:00:00Z", orderEditAt: "2026-09-10T10:00:00Z" } }), "Ah Girl", "…and a newer order edit beats an older card copy");
});

test("fixing details on an order never invents a customer record", () => {
  const st = state([{ id: "o1", customerName: "Ah Girl", qty: 1 }]);

  syncContactFromOrder(st, "ah girl", { customerName: "Tan Siew Ling", whatsapp: "6012-111" });

  assert.equal(st.orders[0].customerName, "Tan Siew Ling");
  assert.equal(st.orders[0].whatsapp, "6012-111");
  assert.equal(st.customers.length, 0, "someone with no saved record has nothing to keep in step");
});

test("a customer's referral credits follow their number when it is corrected", () => {
  const st = state([{ id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 }]);
  st.credits = [{ id: "c1", holder: "6012111", holderName: "Ah Girl", amountRM: 5, status: "valid" }];
  const p = upsertProfile(st, { name: "Ah Girl", whatsapp: "6012-111" }, "6012111");

  upsertProfile(st, { id: p.id, name: "Ah Girl", whatsapp: "6012-999" }, "6012111");

  assert.equal(st.orders[0].whatsapp, "6012-999");
  assert.equal(st.credits[0].holder, "6012999", "the credit is not stranded on a number nobody owns");
  assert.equal(st.credits[0].holderName, "Ah Girl");
});

test("credits stay put when the number is blanked rather than changed", () => {
  const st = state([{ id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 }]);
  st.credits = [{ id: "c1", holder: "6012111", holderName: "Ah Girl", amountRM: 5, status: "valid" }];
  const p = upsertProfile(st, { name: "Ah Girl", whatsapp: "6012-111" }, "6012111");

  upsertProfile(st, { id: p.id, name: "Ah Girl", whatsapp: "" }, "6012111");

  assert.equal(st.credits[0].holder, "6012111", "there is no new number to point them at");
  assert.equal(st.orders[0].whatsapp, "6012-111");
});

test("the one-time catch-up brings orders in line with a saved name, and leaves strangers alone", () => {
  const st = state(
    [
      { id: "o1", customerName: "Ah Girl", whatsapp: "6012-111", qty: 1 },
      { id: "o2", customerName: "Mr Lim", whatsapp: "6013-222", qty: 1 },
    ],
    [
      { id: "cus_1", key: "6012111", name: "Tan Siew Ling", whatsapp: "6012-111" },
      { id: "cus_2", key: "orphan", name: "Nobody", whatsapp: "" },
    ]);

  const moved = reconcileContacts(st);

  assert.equal(moved, 1);
  assert.equal(st.orders[0].customerName, "Tan Siew Ling", "the renamed customer's order catches up");
  assert.equal(st.orders[1].customerName, "Mr Lim", "an unrelated order is left alone");
});

// ── Engine v120 — a person is identified by the digits of their number ───────
// The reported bug: one real customer, "Neoh Choo Leong", shown as two rows
// because one copy of the number was saved with a "+" in front of it.

test("keyOf reads a number by its digits, so every spelling of one number is one person", () => {
  const spellings = ["+60123456789", "60123456789", "012-345 6789", "60 12-345 6789", "+60 (12) 345 6789"];
  for (const w of spellings) {
    assert.equal(keyOf({ whatsapp: w }), "60123456789", `${w} keys as its digits`);
  }
  const st = state(spellings.map((w, i) => ({ id: `o${i}`, customerName: "Neoh Choo Leong", whatsapp: w, qty: 1 })));
  assert.equal(customerList(st).length, 1, "five spellings are one customer — this is the duplicate she saw");
});

test("keyOf still keys a person by their name when there is no number", () => {
  assert.equal(keyOf({ customerName: "  Aunty Bee " }), "aunty bee");
  assert.equal(keyOf({ customerName: "Aunty Bee", whatsapp: "" }), "aunty bee");
  assert.equal(keyOf({ customerName: "Aunty Bee", whatsapp: "   " }), "aunty bee");
});

test("keyOf falls back to the order id with neither a name nor a number", () => {
  assert.equal(keyOf({ id: "ord_1" }), "ord_1");
});

test("keyOf never reduces a value that is not shaped like a number to a bare digit", () => {
  assert.equal(keyOf({ whatsapp: "aunty1@gmail.com" }), "aunty1@gmail.com");
  assert.notEqual(keyOf({ whatsapp: "a1@x" }), keyOf({ whatsapp: "b1@y" }),
    "two different non-numbers must not collide on the digit they both contain");
  // An object with no whatsapp/customerName/id at all — a per-product sell rule
  // is passed through here — still yields undefined, exactly as it always has.
  assert.equal(keyOf({ days: [1], from: "2026-09-01", to: "2026-09-30" }), undefined);
});

test("the v120 catch-up re-keys a plus-signed record and merges the duplicate it was hiding", () => {
  const st = state(
    [
      { id: "o1", customerName: "Neoh Choo Leong", whatsapp: "60123456789", qty: 1 },
      { id: "o2", customerName: "Neoh Choo Leong", whatsapp: "+60123456789", qty: 2 },
    ],
    [
      { id: "cus_a", key: "60123456789", name: "Neoh Choo Leong", whatsapp: "60123456789", dogName: "Coco", updatedAt: "2026-09-01T00:00:00Z" },
      { id: "cus_b", key: "+60123456789", name: "Neoh Choo Leong", whatsapp: "+60123456789", notes: "allergic to nuts", updatedAt: "2026-09-10T00:00:00Z" },
    ]);

  canonicaliseCustomers(st);

  assert.equal(customerList(st).length, 1, "the two rows become one");
  assert.equal(st.customers.length, 1, "and one saved record, not two");
  assert.equal(st.customers[0].key, "60123456789");
  assert.equal(st.customers[0].whatsapp, "60123456789", "the record's own number is canonical too, not just its key");
  assert.equal(st.customers[0].dogName, "Coco", "what one side knew is kept");
  assert.equal(st.customers[0].notes, "allergic to nuts", "and so is what the other knew");
  assert.equal(st.orders.every((o) => o.whatsapp === "60123456789"), true,
    "the orders are rewritten, so the row she looks at shows the number without the +");
});

test("the v120 catch-up folds a three-way collision completely, not just one pair", () => {
  const st = state([], [
    { id: "cus_1", key: "6012-111", name: "Aunty Bee", whatsapp: "6012-111", dogName: "Coco" },
    { id: "cus_2", key: "+6012111", name: "Aunty Bee", whatsapp: "+6012111", likes: "banana" },
    { id: "cus_3", key: "012-111", name: "Aunty Bee", whatsapp: "012-111", notes: "a third copy" },
  ]);

  canonicaliseCustomers(st);

  assert.equal(st.customers.length, 1, "three records, one person");
  assert.equal(st.customers[0].dogName, "Coco");
  assert.equal(st.customers[0].likes, "banana");
  assert.equal(st.customers[0].notes, "a third copy");
});

test("the v120 catch-up leaves a name-keyed person and a stranger's order alone", () => {
  const st = state(
    [
      { id: "o1", customerName: "Walk-in regular", qty: 1 },
      { id: "o2", customerName: "Mr Lim", whatsapp: "6013222", qty: 1 },
    ],
    [{ id: "cus_1", key: "walk-in regular", name: "Walk-in regular", whatsapp: "", dogName: "Milo" }]);

  canonicaliseCustomers(st);

  assert.equal(st.customers.length, 1);
  assert.equal(st.customers[0].key, "walk-in regular", "someone with no number keeps their name key");
  assert.equal(st.customers[0].dogName, "Milo");
  assert.equal(st.orders[1].whatsapp, "6013222", "an unrelated order is untouched");
});

test("the v120 catch-up changes nothing on a second run", () => {
  const st = state(
    [{ id: "o1", customerName: "Neoh Choo Leong", whatsapp: "+60123456789", qty: 1 }],
    [{ id: "cus_a", key: "+60123456789", name: "Neoh Choo Leong", whatsapp: "+60123456789" }]);

  assert.ok(canonicaliseCustomers(st) > 0, "the first pass has work to do");
  const after = JSON.parse(JSON.stringify(st));

  // The sync layer diffs whole records and saves again on every pull, so a
  // second pass that moved something would loop forever.
  assert.equal(canonicaliseCustomers(st), 0, "a second pass has nothing left to move");
  assert.deepEqual(JSON.parse(JSON.stringify(st)), after, "and the data is byte-identical");
});

test("mergeCustomers folds a duplicate into the row the baker kept", () => {
  const st = state(
    [
      { id: "o1", customerName: "Neoh Choo Leong", whatsapp: "60123456789", qty: 1 },
      { id: "o2", customerName: "Neoh Choo L.", whatsapp: "60111111111", qty: 3 },
    ],
    [
      { id: "cus_a", key: "60123456789", name: "Neoh Choo Leong", whatsapp: "60123456789", dogName: "Coco" },
      { id: "cus_b", key: "60111111111", name: "Neoh Choo L.", whatsapp: "60111111111", likes: "banana" },
    ]);

  mergeCustomers(st, "60123456789", "60111111111");

  assert.equal(st.customers.length, 1, "one saved record survives");
  assert.equal(st.customers[0].dogName, "Coco", "the kept record keeps its own facts");
  assert.equal(st.customers[0].likes, "banana", "and takes in the ones only the other had");
  assert.equal(st.orders.every((o) => keyOf(o) === "60123456789"), true,
    "both orders now sit under the kept person");
  assert.equal(customerList(st).length, 1, "so the customer book shows them once");
});

test("mergeCustomers gives a name-only keeper the other's number, so they really become one", () => {
  const st = state(
    [
      { id: "o1", customerName: "Walk-in regular", qty: 1 },
      { id: "o2", customerName: "Walk-in regular", whatsapp: "60123456789", qty: 2 },
    ],
    [{ id: "cus_a", key: "walk-in regular", name: "Walk-in regular", whatsapp: "" }]);

  mergeCustomers(st, "walk-in regular", "60123456789");

  assert.equal(st.orders.every((o) => keyOf(o) === "60123456789"), true,
    "the kept person's own orders move under the number too, not just the duplicate's");
  assert.equal(customerList(st).length, 1, "which is what makes them one row");
  assert.equal(st.customers.length, 1, "and their own saved record is the one that survives");
});

test("mergeCustomers refuses to join a person to themselves", () => {
  const st = state([{ id: "o1", customerName: "Aunty Bee", whatsapp: "6012111", qty: 1 }], []);
  assert.equal(mergeCustomers(st, "6012111", "6012111"), null);
  assert.equal(mergeCustomers(st, "6012111", ""), null);
  assert.equal(customerList(st).length, 1, "and nothing moved");
});
