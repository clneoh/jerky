// test/codes.test.js — the sales-code state model: the shops you hand samples
// to, the printed labels, the landing-page copy, and the two questions every
// reader asks of them ("is this offer live?" / "has this number ever bought?").
// Pure module, no DOM needed.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultState, normalize, isNewCustomer, liveOffer, findCode, codeLabel,
} from "../admin/js/state.js";

// A fixed "today" so the offer windows are deterministic.
const T = "2026-09-20";

function order(over = {}) {
  return {
    id: "o" + (over.id || "aaaa01"),
    groupId: over.groupId || "gaaaa01",
    customerName: over.customerName ?? "Aisyah",
    whatsapp: over.whatsapp ?? "60123456789",
    createdAt: over.createdAt ?? "2026-09-01T08:00:00.000Z",
    status: over.status ?? "new",
    ...over,
  };
}

function code(over = {}) {
  return {
    id: "c1",
    code: "K3X9",
    label: "",
    kind: "plain",
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

// ── defaults and the round-trip through normalize ─────────────────────────

test("a fresh state carries both new lists and the landing-page copy", () => {
  const d = defaultState();
  assert.deepEqual(d.partners, [], "the shops list starts empty");
  assert.deepEqual(d.codes, [], "so does the label list");
  const t = d.settings.taster;
  assert.equal(t.askPet, true, "the dog/cat question is on by default");
  assert.equal(t.follow, true, "and so is the follow line");
  assert.equal(t.offerType, "rm");
  assert.equal(t.offerValue, 5);
  assert.equal(t.offerMin, 30);
  assert.equal(t.validDays, 30);
  assert.equal(t.heading, "", "the copy starts blank, so the page falls back to its own");
});

test("normalize keeps the lists and the copy — it is the only thing that does", () => {
  // Without these lines normalize() drops both lists and the copy on every load,
  // which is how a v1 field silently disappears from a phone.
  const s = defaultState();
  s.partners.push({ id: "pt1", name: "Pet Shop Alpha", whatsapp: "60123456789" });
  s.codes.push(code({ kind: "shop", partnerId: "pt1" }));
  s.settings.taster.heading = "Your Furkid Tried Munchies!";
  s.settings.taster.askPet = false;

  const out = normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(out.partners.length, 1);
  assert.equal(out.partners[0].name, "Pet Shop Alpha");
  assert.equal(out.codes.length, 1);
  assert.equal(out.codes[0].kind, "shop");
  assert.equal(out.codes[0].partnerId, "pt1");
  assert.equal(out.settings.taster.heading, "Your Furkid Tried Munchies!");
  assert.equal(out.settings.taster.askPet, false);
});

test("an older save with neither list loads clean instead of crashing", () => {
  const out = normalize({ version: 1, settings: {}, orders: [] });
  assert.deepEqual(out.partners, []);
  assert.deepEqual(out.codes, []);
  assert.equal(out.settings.taster.offerType, "rm", "the untouched copy fills back in");
  assert.equal(typeof out.settings.taster.heading, "string");
});

test("a hand-edited save with a junk taster keeps the shape the app reads", () => {
  const out = normalize({
    version: 1,
    settings: { taster: { askPet: "yes", offerValue: null } },
    orders: [],
  });
  assert.equal(out.settings.taster.askPet, "yes", "a stored value is not invented over");
  assert.equal(out.settings.taster.offerType, "rm", "a missing key still comes from the defaults");
});

// ── new customer: one definition, shared with the referral scheme ────────

test("a number that has never ordered is new", () => {
  const s = { orders: [order({ whatsapp: "60111111111" })] };
  assert.equal(isNewCustomer(s, { orders: [order({ whatsapp: "60222222222" })] }), true);
});

test("a number that has ordered before is not new", () => {
  const s = { orders: [order({ id: "aaaa02", groupId: "gbbbb02", whatsapp: "60123456789" })] };
  const g = { orders: [order({ whatsapp: "60123456789" })] };
  assert.equal(isNewCustomer(s, g), false);
});

test("the same number written differently is still the same person", () => {
  // The owner's rule keys on the WhatsApp number, so "+60 12-345 6789" and
  // "0123456789" have to be one customer, not two.
  const s = { orders: [order({ id: "aaaa02", groupId: "gbbbb02", whatsapp: "012-345 6789" })] };
  const g = { orders: [order({ whatsapp: "+60 12-345 6789" })] };
  assert.equal(isNewCustomer(s, g), false);
});

test("a multi-item cart is not its own previous order", () => {
  // One shop order arrives as several rows sharing a groupId. Scanning the
  // book for the number would find the cart's own sibling rows and call a
  // genuine first-time buyer an existing customer.
  const g = {
    orders: [
      order({ id: "aaaa01", groupId: "gsame01" }),
      order({ id: "aaaa02", groupId: "gsame01" }),
      order({ id: "aaaa03", groupId: "gsame01" }),
    ],
  };
  const s = { orders: [...g.orders] };
  assert.equal(isNewCustomer(s, g), true, "the cart's own rows are skipped");
});

test("no number at all is never new — there is nothing to key on", () => {
  const s = { orders: [order({ whatsapp: "60111111111" })] };
  assert.equal(isNewCustomer(s, { orders: [order({ whatsapp: "" })] }), false);
  assert.equal(isNewCustomer(s, { orders: [] }), false, "an empty group is not a new customer");
  assert.equal(isNewCustomer(s, null), false);
});

// ── the offer window ─────────────────────────────────────────────────────

test("an offer with no window always shows", () => {
  const off = liveOffer(code({ offer: { type: "rm", value: 5 } }), T);
  assert.equal(off.type, "rm");
  assert.equal(off.value, 5);
  assert.equal(off.newOnly, false, "an offer is for everyone unless it says otherwise");
  assert.equal(off.minSpend, 0, "no minimum spend stated means none");
});

test("an offer shows from its start date and stops the day after its end", () => {
  const c = code({ offer: { type: "pct", value: 10, from: "2026-09-15", to: "2026-10-15" } });
  assert.equal(liveOffer(c, "2026-09-14"), null, "the day before it opens");
  assert.equal(liveOffer(c, "2026-09-15").value, 10, "the first day, inclusive");
  assert.equal(liveOffer(c, "2026-10-15").value, 10, "the last day, inclusive");
  assert.equal(liveOffer(c, "2026-10-16"), null, "the day after it closes");
});

test("an open-ended offer only has the end it was given", () => {
  assert.equal(liveOffer(code({ offer: { type: "rm", value: 3, to: "2026-09-19" } }), T), null);
  assert.equal(liveOffer(code({ offer: { type: "rm", value: 3, from: "2026-09-01" } }), T).value, 3);
});

test("a retired code offers nothing, whatever it carries", () => {
  const c = code({ active: false, offer: { type: "rm", value: 5 } });
  assert.equal(liveOffer(c, T), null, "taking a code down has to stop its offer at once");
});

test("an offer with no real discount shows nothing", () => {
  assert.equal(liveOffer(code({ offer: null }), T), null);
  assert.equal(liveOffer(code({}), T), null);
  assert.equal(liveOffer(code({ offer: { type: "rm", value: 0 } }), T), null, "0 off is not an offer");
  assert.equal(liveOffer(code({ offer: { type: "pct", value: -5 } }), T), null);
  assert.equal(liveOffer(code({ offer: { type: "free", value: 5 } }), T), null, "an unknown type is refused, not guessed at");
  assert.equal(liveOffer(code({ offer: { type: "rm", value: "abc" } }), T), null);
  assert.equal(liveOffer(null, T), null);
});

test("the offer a caller gets back is a copy with the numbers worked out", () => {
  const c = code({ offer: { type: "rm", value: "5", minSpend: "30", newOnly: true } });
  const off = liveOffer(c, T);
  assert.equal(off.value, 5, "a number typed as text still reads as a number");
  assert.equal(off.minSpend, 30);
  assert.equal(off.newOnly, true);
  c.offer.value = 99;
  assert.equal(off.value, 5, "the returned offer does not follow edits behind its back");
});

// ── finding a code and its printed label ─────────────────────────────────

test("a code is found whatever case the customer typed", () => {
  const s = { codes: [code({ code: "K3X9" })] };
  assert.equal(findCode(s, "K3X9").code, "K3X9");
  assert.equal(findCode(s, "k3x9").code, "K3X9", "a printed label may be typed in lower case");
  assert.equal(findCode(s, " K3X9 ").code, "K3X9", "and with stray spaces");
});

test("a code that is not there comes back null, not a crash", () => {
  const s = { codes: [code({ code: "K3X9" })] };
  assert.equal(findCode(s, "NOPE"), null);
  assert.equal(findCode(s, ""), null, "no code in the link is not a lookup for everything");
  assert.equal(findCode(s, null), null);
  assert.equal(findCode({}, "K3X9"), null, "a state without the list yet");
});

test("every code has something to print beside its QR", () => {
  assert.equal(codeLabel(code({ code: "K3X9", label: "Shop A" })), "Shop A");
  assert.equal(codeLabel(code({ code: "K3X9", label: "" })), "K3X9", "falls back to the code itself");
  assert.equal(codeLabel(code({ code: "K3X9" })), "K3X9");
  assert.equal(codeLabel(code({ code: "K3X9", label: "   " })), "K3X9", "blank spaces are not a label");
  assert.equal(codeLabel(null), "", "nothing to label");
});
