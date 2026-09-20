// test/codes-lib.test.js — the pure half of the sales-code feature: the code a
// label carries, the URL it stands for, the words an offer is stated in, and what
// a code has actually brought in. No DOM, no network.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ALPHABET, CODE_LENGTH, KINDS, KIND_LABEL, kindOf, makeCode, tasterUrl,
  shopUrl, labelUrl, offerText, offerMinText, offerLine, codeStats, codeCustomers,
  sheetLabels, visitTally, publishCodes, publishTaster, promoOf,
} from "../admin/js/codes.js";

function order(over = {}) {
  return {
    id: "o" + (over.id || "aaaa01"),
    groupId: over.groupId || "gaaaa01",
    customerName: over.customerName ?? "Aisyah",
    whatsapp: over.whatsapp ?? "60123456789",
    productId: over.productId ?? "p1",
    productName: over.productName ?? "Chicken Jerky 100g",
    unitPrice: over.unitPrice ?? 22,
    qty: over.qty ?? 1,
    promoCode: over.promoCode ?? "",
    createdAt: over.createdAt ?? "2026-09-01T08:00:00.000Z",
    status: "new",
    ...over,
  };
}

const state = (orders = []) => ({ orders, products: [] });

// ── the code itself ──────────────────────────────────────────────────────

test("a printed code never contains a character people misread", () => {
  // It may be typed by hand off a label, so 0/O and 1/I/L are out.
  for (const ch of "01OIL") {
    assert.equal(CODE_ALPHABET.includes(ch), false, `${ch} is too easy to misread`);
  }
  assert.ok(CODE_ALPHABET.length > 20, "but there is still plenty of room");
});

test("a fresh code is the expected shape and never repeats one in use", () => {
  const taken = [];
  for (let i = 0; i < 300; i++) {
    const c = makeCode(taken);
    assert.equal(c.length, CODE_LENGTH);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch), `${ch} is outside the alphabet`);
    assert.equal(taken.includes(c), false, "a printed label must never be handed out twice");
    taken.push(c);
  }
  assert.equal(new Set(taken).size, 300, "300 codes, 300 different strings");
});

test("makeCode accepts either whole code records or plain strings as taken", () => {
  // The caller has a list of records; a test has a list of strings. Both work.
  const taken = [];
  for (let i = 0; i < 60; i++) taken.push({ code: makeCode(taken) });
  const next = makeCode(taken);
  assert.equal(taken.some((t) => t.code === next), false);
  assert.equal(taken.some((t) => t.code === makeCode(taken.map((t) => t.code))), false);
});

// ── the URL a QR carries ─────────────────────────────────────────────────

test("the URL a scan lands on is built from the origin it was printed from", () => {
  assert.equal(tasterUrl("k3x9", "https://munchies.com.my"), "https://munchies.com.my/taster/?c=K3X9");
  assert.equal(tasterUrl("K3X9", "http://localhost:8462"), "http://localhost:8462/taster/?c=K3X9");
});

test("a trailing slash on the origin does not double up", () => {
  assert.equal(tasterUrl("K3X9", "https://munchies.com.my/"), "https://munchies.com.my/taster/?c=K3X9");
});

test("the shop link is the same code, one path over", () => {
  assert.equal(shopUrl("k3x9", "https://munchies.com.my"), "https://munchies.com.my/store/?c=K3X9");
});

test("an empty code still builds a well-formed link rather than a broken one", () => {
  assert.equal(tasterUrl("", "https://munchies.com.my"), "https://munchies.com.my/taster/?c=");
  assert.equal(tasterUrl(null, "https://munchies.com.my"), "https://munchies.com.my/taster/?c=");
});

// ── the words an offer is stated in ──────────────────────────────────────

test("an offer reads the way it would be said out loud", () => {
  assert.equal(offerText({ type: "rm", value: 5 }), "RM5 off");
  assert.equal(offerText({ type: "pct", value: 10 }), "10% off");
  assert.equal(offerText({ type: "pct", value: 12.5 }), "12.5% off");
  assert.equal(offerText({ type: "rm", value: 3.5 }), "RM3.5 off");
});

test("there is nothing to state when there is no offer", () => {
  assert.equal(offerText(null), "");
  assert.equal(offerText({ type: "rm", value: 0 }), "");
  assert.equal(offerText({ type: "rm", value: -5 }), "");
  assert.equal(offerText({ type: "free", value: 5 }), "", "an unknown type is not guessed at");
  assert.equal(offerText({ type: "rm", value: "abc" }), "");
});

test("a minimum spend is only mentioned when one was given", () => {
  assert.equal(offerMinText({ type: "rm", value: 5, minSpend: 30 }), "on RM30 and above");
  assert.equal(offerMinText({ type: "rm", value: 5 }), "");
  assert.equal(offerMinText({ type: "rm", value: 5, minSpend: 0 }), "");
  assert.equal(offerMinText(null), "");
});

test("the one-line offer carries its window and its audience", () => {
  assert.equal(
    offerLine({ type: "rm", value: 5, minSpend: 30, to: "2026-10-31" }, "RM", "2026-09-20"),
    "RM5 off · on RM30 and above · until 2026-10-31");
  assert.equal(
    offerLine({ type: "pct", value: 10, newOnly: true }, "RM", "2026-09-20"),
    "10% off · new customers only");
  assert.equal(
    offerLine({ type: "rm", value: 5, to: "2026-09-01" }, "RM", "2026-09-20"),
    "RM5 off · ended", "a finished offer says so rather than quietly vanishing");
  assert.equal(offerLine(null, "RM", "2026-09-20"), "");
});

// ── what a code has brought in ───────────────────────────────────────────

test("orders a customer placed through the shop are counted against the code", () => {
  const s = state([
    order({ id: "aaaa01", groupId: "g1", promoCode: "K3X9", qty: 2 }),
    order({ id: "aaaa02", groupId: "g2", promoCode: "K3X9", qty: 1, unitPrice: 22 }),
    order({ id: "aaaa03", groupId: "g3", promoCode: "OTHER", qty: 9 }),
  ]);
  const st = codeStats(s, { code: "K3X9" });
  assert.equal(st.orders, 2, "two separate orders");
  assert.equal(st.units, 3);
  assert.equal(st.sales, 66, "2 x 22 + 1 x 22");
});

test("one order of three items counts as one order, not three", () => {
  // A shop order arrives as several rows sharing a groupId.
  const s = state([
    order({ id: "aaaa01", groupId: "gsame", promoCode: "K3X9", qty: 1 }),
    order({ id: "aaaa02", groupId: "gsame", promoCode: "K3X9", qty: 1 }),
    order({ id: "aaaa03", groupId: "gsame", promoCode: "K3X9", qty: 1 }),
  ]);
  const st = codeStats(s, { code: "K3X9" });
  assert.equal(st.orders, 1, "three rows, one order");
  assert.equal(st.units, 3, "but three things sold");
  assert.equal(st.sales, 66);
});

test("an order typed in by hand is not evidence of what a label did", () => {
  // A counter sale carries no stamp, so it must not show up against a code.
  const s = state([order({ promoCode: "" }), order({ id: "aaaa02", promoCode: undefined })]);
  assert.deepEqual(codeStats(s, { code: "K3X9" }),
    { orders: 0, units: 0, sales: 0, firstAt: "", lastAt: "" });
});

test("the frozen price is what the sale counted, not today's menu price", () => {
  const s = { orders: [order({ promoCode: "K3X9", qty: 1, unitPrice: 18 })], products: [{ id: "p1", price: 99 }] };
  assert.equal(codeStats(s, { code: "K3X9" }).sales, 18, "the price it was sold at");
});

test("the stats span the orders they were counted from", () => {
  const s = state([
    order({ id: "aaaa01", groupId: "g1", promoCode: "K3X9", createdAt: "2026-09-20T10:00:00.000Z" }),
    order({ id: "aaaa02", groupId: "g2", promoCode: "K3X9", createdAt: "2026-09-02T10:00:00.000Z" }),
  ]);
  const st = codeStats(s, { code: "K3X9" });
  assert.equal(st.firstAt, "2026-09-02T10:00:00.000Z");
  assert.equal(st.lastAt, "2026-09-20T10:00:00.000Z");
});

test("a code with no orders, or no code at all, counts nothing", () => {
  assert.equal(codeStats(state([]), { code: "K3X9" }).orders, 0);
  assert.equal(codeStats(state([order({ promoCode: "K3X9" })]), null).orders, 0);
  assert.equal(codeStats(state([order({ promoCode: "K3X9" })]), { code: "" }).orders, 0);
});

test("the code is matched whatever case it was stored in", () => {
  const s = state([order({ promoCode: "k3x9" })]);
  assert.equal(codeStats(s, { code: "K3X9" }).orders, 1);
});

test("the same person ordering twice is one customer, two orders", () => {
  const s = state([
    order({ id: "aaaa01", groupId: "g1", promoCode: "K3X9", whatsapp: "012-345 6789" }),
    order({ id: "aaaa02", groupId: "g2", promoCode: "K3X9", whatsapp: "+60 12-345 6789" }),
    order({ id: "aaaa03", groupId: "g3", promoCode: "K3X9", whatsapp: "60199999999", customerName: "Bala" }),
  ]);
  const people = codeCustomers(s, { code: "K3X9" });
  assert.equal(people.length, 2, "the two spellings of one number are one person");
  assert.equal(people[0].orders, 2, "the most frequent customer leads");
  assert.equal(people[1].name, "Bala");
});

test("a customer with no number on the order is still listed once", () => {
  const s = state([
    order({ id: "aaaa01", groupId: "g1", promoCode: "K3X9", whatsapp: "" }),
    order({ id: "aaaa02", groupId: "g2", promoCode: "K3X9", whatsapp: "" }),
  ]);
  const people = codeCustomers(s, { code: "K3X9" });
  assert.equal(people.length, 1, "an unknown number is one unknown person, not two");
  assert.equal(people[0].orders, 2);
});

// ── the printed sheet ────────────────────────────────────────────────────

test("a sheet repeats one label, and every copy carries the code", () => {
  const sheet = sheetLabels({ code: "K3X9" }, 12);
  assert.equal(sheet.length, 12);
  assert.ok(sheet.every((c) => c.code === "K3X9"), "a sheet of labels is one label, repeated");
});

test("an impossible sheet size is brought back to something printable", () => {
  assert.equal(sheetLabels({ code: "K3X9" }, 0).length, 1, "never a blank page");
  assert.equal(sheetLabels({ code: "K3X9" }, -5).length, 1);
  assert.equal(sheetLabels({ code: "K3X9" }, "abc").length, 1);
  assert.equal(sheetLabels({ code: "K3X9" }, 9999).length, 60, "capped, so a typo cannot ask for a ream");
  assert.equal(sheetLabels({ code: "K3X9" }, 7).length, 7);
});

// ── what the landing page recorded ───────────────────────────────────────

test("visits are tallied per code and by which pet answered", () => {
  const t = visitTally([
    { code: "K3X9", pet: "dog" },
    { code: "K3X9", pet: "cat" },
    { code: "k3x9", pet: "" },
    { code: "SHOPB", pet: "dog" },
  ]);
  assert.equal(t.total, 4);
  assert.equal(t.byCode.get("K3X9"), 3, "case-insensitive, same as everywhere else");
  assert.equal(t.byCode.get("SHOPB"), 1);
  assert.deepEqual(t.pets, { dog: 2, cat: 1, none: 1 });
});

test("a visit with no code or no answer still counts as a visit", () => {
  const t = visitTally([{ code: "", pet: "" }, { pet: "dog" }, null, undefined]);
  assert.equal(t.total, 4);
  assert.equal(t.byCode.size, 0);
  assert.equal(t.pets.dog, 1);
  assert.equal(t.pets.none, 3);
});

test("no rows at all is an empty tally, not a crash", () => {
  const t = visitTally(null);
  assert.equal(t.total, 0);
  assert.equal(t.byCode.size, 0);
  assert.deepEqual(t.pets, { dog: 0, cat: 0, none: 0 });
});

// ── kinds ────────────────────────────────────────────────────────────────

test("every kind the screen offers has a label, and a strange one falls back", () => {
  for (const [id] of KINDS) assert.equal(kindOf({ kind: id }), id);
  assert.equal(kindOf({ kind: "shop" }), "shop");
  assert.equal(kindOf({ kind: "nonsense" }), "plain");
  assert.equal(kindOf({}), "plain");
  assert.equal(kindOf(null), "plain");
  assert.equal(KIND_LABEL.shop, "Shop");
});

// ── the URL that goes in a printed QR ────────────────────────────────────

test("a plain label's QR is the landing page, with nothing else on it", () => {
  const url = labelUrl({ code: "k3x9", kind: "shop" }, "https://munchies.com.my");
  assert.equal(url, "https://munchies.com.my/taster/?c=K3X9");
});

test("a bring-a-friend label carries the referrer's number as ?via=", () => {
  const url = labelUrl(
    { code: "FRIEND", kind: "intro", referrerDigits: "012-345 6789" },
    "https://munchies.com.my");
  // The same digits-only shape the referral link already uses, so the store's
  // own ?via= reader stamps order.referredBy with no change to the shop.
  assert.equal(url, "https://munchies.com.my/taster/?c=FRIEND&via=60123456789");
});

test("the number only rides on a bring-a-friend label, and only when there is one", () => {
  const at = "https://munchies.com.my";
  // A shop label that happens to hold a number must not leak it: only `intro`
  // points the credit at anyone, and a shop's QR is handed to strangers.
  assert.equal(labelUrl({ code: "S1", kind: "shop", referrerDigits: "60123456789" }, at),
    `${at}/taster/?c=S1`);
  assert.equal(labelUrl({ code: "S2", kind: "intro", referrerDigits: "" }, at), `${at}/taster/?c=S2`);
  assert.equal(labelUrl({ code: "S3", kind: "intro", referrerDigits: "not a number" }, at),
    `${at}/taster/?c=S3`);
});

// ── what leaves the app ──────────────────────────────────────────────────

function fullState() {
  return {
    settings: { currency: "RM",
      storefront: { name: "Munchies Furkidz", instagram: "munchies_furkidz" },
      taster: { heading: "A treat for your cat", headingZh: "给猫咪的零食",
        body: "Scan, say hi", follow: false, askPet: true, offerType: "pct" } },
    partners: [{ id: "pa1", name: "Paw Shop", whatsapp: "60111111111",
      commissionPct: 10, samplesGiven: 12, notes: "asks for duck", active: true }],
    products: [{ id: "pr1", name: "Chicken Jerky 100g", price: 22 }],
    codes: [
      { id: "c1", code: "pshop", kind: "shop", partnerId: "pa1", label: "Paw Shop",
        heading: "New here?", body: "Say hi at the counter", headingMs: "  ", active: true },
      { id: "c2", code: "milo", kind: "promo", productId: "pr1", active: true,
        offer: { type: "pct", value: 10, minSpend: 30, from: "2026-09-01", to: "2026-09-30", newOnly: true } },
      { id: "c3", code: "gone", kind: "promo", productId: "pr1", active: true,
        offer: { type: "rm", value: 5, from: "2026-08-01", to: "2026-08-31" } },
      { id: "c4", code: "oldy", kind: "plain", active: false },
      { id: "c5", code: "friend", kind: "intro", referrerDigits: "60123456789", active: true },
      { id: "c6", code: "", kind: "plain", active: true },
    ],
  };
}

test("only the codes a customer may resolve are published, and a retired one is not", () => {
  const rows = publishCodes(fullState(), "2026-09-20");
  assert.deepEqual(rows.map((r) => r.code), ["PSHOP", "MILO", "GONE", "FRIEND"]);
});

test("a shop's card names the shop, and nothing else about it", () => {
  const shop = publishCodes(fullState(), "2026-09-20").find((r) => r.code === "PSHOP");
  assert.equal(shop.partnerName, "Paw Shop");
  // This label's own words for the page, in the same shape the shared page's copy
  // is published in — which is what lets a blank line fall back per language.
  assert.equal(shop.heading, "New here?");
  assert.equal(shop.body, "Say hi at the counter");
  assert.equal("headingMs" in shop, false, "a blank translation is left out, not blanked");
  // The contact, the rate and her own notes are for her phones, never the page.
  const blob = JSON.stringify(shop);
  for (const secret of ["60111111111", "commissionPct", "samplesGiven", "asks for duck"]) {
    assert.equal(blob.includes(secret), false, `${secret} must not be published`);
  }
});

test("a label that says nothing for itself publishes no wording at all", () => {
  // Not an empty string: a key that is absent is what tells the page to use the
  // shared line, and an empty one would blank the page instead.
  const plain = publishCodes(fullState(), "2026-09-20").find((r) => r.code === "MILO");
  for (const k of ["heading", "body", "headingZh", "bodyZh", "headingMs", "bodyMs"]) {
    assert.equal(k in plain, false, `${k} must not be published when blank`);
  }
  const shared = publishTaster(fullState());
  assert.equal(shared.heading, "A treat for your cat");
  assert.equal(shared.headingZh, "给猫咪的零食");
  assert.equal("headingMs" in shared, false);
});

test("a bring-a-friend code publishes no number at all", () => {
  const pick = publishCodes(fullState(), "2026-09-20").find((r) => r.code === "FRIEND");
  assert.equal(pick.kind, "intro");
  assert.equal(JSON.stringify(pick).includes("60123456789"), false);
  // The number travels in the printed link instead — see labelUrl.
  assert.equal(JSON.stringify([pick]).includes("referrer"), false);
});

test("an offer is published with its own numbers while it is inside its window", () => {
  const live = publishCodes(fullState(), "2026-09-20").find((r) => r.code === "MILO");
  assert.equal(live.productName, "Chicken Jerky 100g");
  assert.deepEqual(live.offer, {
    type: "pct", value: 10, minSpend: 30, to: "2026-09-30", newOnly: true, cur: "RM",
  });
});

test("an ended offer is not stated, but the label still answers", () => {
  // The card is already in someone's hand, so the code has to keep resolving —
  // it simply states nothing, exactly as if it had never carried an offer.
  const rows = publishCodes(fullState(), "2026-09-20");
  const ended = rows.find((r) => r.code === "GONE");
  assert.ok(ended, "a code with an expired offer is still published");
  assert.equal("offer" in ended, false);
});

test("a code that has not started yet states nothing either", () => {
  const st = fullState();
  st.codes.push({ id: "c7", code: "SOON", kind: "promo", active: true,
    offer: { type: "rm", value: 3, from: "2026-10-01", to: "2026-10-31" } });
  const soon = publishCodes(st, "2026-09-20").find((r) => r.code === "SOON");
  assert.equal("offer" in soon, false);
});

test("the landing page's own copy is published, and a blank box stays blank", () => {
  const t = publishTaster(fullState());
  assert.equal(t.heading, "A treat for your cat");
  assert.equal(t.headingZh, "给猫咪的零食");
  assert.equal(t.follow, false);
  assert.equal(t.askPet, true);
  assert.equal(t.shop, "Munchies Furkidz");
  assert.equal(t.instagram, "munchies_furkidz");
  // Nothing was written for BM, so the page falls back to English rather than
  // publishing an empty line over it.
  assert.equal("headingMs" in t, false);
});

test("a page with no copy of its own still publishes its switches", () => {
  const t = publishTaster({ settings: {} });
  assert.deepEqual(t, { askPet: true, follow: true, instagram: "", shop: "" });
});

// ── the label an order came in on ────────────────────────────────────────
// What the app tells her about the label behind an order. It states; it never
// works out a discount. The two verdicts below are the ones only this app can
// make — "new customers only" needs every other order in the book, which is why
// the customer's own page is not allowed to decide any of this.

// The real shape of a stored code: the label printed beside the QR, and the ids of
// the shop/product it was made for. Their NAMES are never stored here — they are
// written onto the published payload the customer's page reads — so the name the
// app shows is the label's own.
const PROMO = {
  code: "MILO", kind: "promo", label: "Chicken Jerky card",
  offer: { type: "pct", value: 10, minSpend: 30, to: "2030-09-30", newOnly: true },
};

const promoState = (over = {}) => ({
  orders: [],
  products: [],
  codes: over.codes || [PROMO],
  ...over,
});

test("an order with no label on it says nothing at all", () => {
  assert.equal(promoOf(promoState(), { orders: [order()] }), null);
});

test("a live label is named, and its offer stated in the label's own words", () => {
  const group = { orders: [order({ promoCode: "milo", qty: 2 })] };
  const p = promoOf(promoState(), group, "2026-09-20");
  assert.equal(p.code, "MILO", "looked up however the stamp was typed");
  assert.equal(p.name, "Chicken Jerky card", "the label's own name");
  assert.equal(p.live.value, 10);
  assert.equal(p.total, 44, "the order's own frozen price, not the menu's");
  assert.equal(p.gone, false);
  assert.equal(p.retired, false);
  assert.equal(p.overMin, true, "RM44 clears the RM30 minimum");
  assert.equal(p.newCustomer, true);
});

test("a second order from the same number is not a new customer", () => {
  // The whole reason the shop cannot validate a code: this needs order history.
  const group = { orders: [order({ promoCode: "MILO" })] };
  const state = promoState({ orders: [order({ id: "bbbb02", groupId: "gbbbb02" })] });
  assert.equal(promoOf(state, group, "2026-09-20").newCustomer, false);
});

test("one multi-item order is not history — its own other rows are not a repeat", () => {
  const rows = [order({ promoCode: "MILO" }), order({ id: "aaaa02", promoCode: "MILO" })];
  assert.equal(promoOf(promoState(), { orders: rows }, "2026-09-20").newCustomer, true);
});

test("an order with no number gets no verdict rather than a wrong one", () => {
  // The book cannot tell a number-less order apart from a first-time customer,
  // and isNewCustomer answers "not new" for it. That answer is right for giving a
  // credit and wrong as a warning — she cannot act on it — so no warning is shown.
  const group = { orders: [order({ promoCode: "MILO", whatsapp: "" })] };
  assert.equal(promoOf(promoState(), group, "2026-09-20").newCustomer, true);
});

test("an order under the label's minimum says so, and one over it does not", () => {
  const short = promoState({
    codes: [{ ...PROMO, offer: { ...PROMO.offer, newOnly: false } }],
  });
  const p = promoOf(short, { orders: [order({ promoCode: "MILO", unitPrice: 22 })] }, "2026-09-20");
  assert.equal(p.total, 22);
  assert.equal(p.overMin, false, "RM22 is under RM30");
  assert.equal(p.newCustomer, true, "and with no newOnly rule there is nothing to warn about");
});

test("an offer whose end date has passed is kept, but is no longer live", () => {
  const state = promoState({
    codes: [{ ...PROMO, offer: { ...PROMO.offer, to: "2020-01-01" } }],
  });
  const p = promoOf(state, { orders: [order({ promoCode: "MILO" })] }, "2026-09-20");
  assert.equal(p.live, null);
  assert.ok(p.offer, "the record still holds it, so the line can say it ended");
  assert.equal(p.gone, false);
});

test("the shop's words apply only once the date reaches the offer's start", () => {
  const state = promoState({
    codes: [{ ...PROMO, offer: { ...PROMO.offer, from: "2026-10-01", to: "2026-10-31" } }],
  });
  const group = { orders: [order({ promoCode: "MILO" })] };
  assert.equal(promoOf(state, group, "2026-09-20").live, null, "not started yet");
  assert.equal(promoOf(state, group, "2026-10-05").live.value, 10);
});

test("a retired label is marked retired, and keeps its name", () => {
  const state = promoState({ codes: [{ ...PROMO, active: false }] });
  const p = promoOf(state, { orders: [order({ promoCode: "MILO" })] }, "2026-09-20");
  assert.equal(p.retired, true);
  assert.equal(p.gone, false);
  assert.equal(p.name, "Chicken Jerky card", "the code is still in her list, so it still reads right");
});

test("a label she has deleted keeps the kind the order recorded at the time", () => {
  // The order carries only the code and its kind, so a deleted shop label can
  // still be named as a shop label rather than a generic one.
  const group = { orders: [order({ promoCode: "PAW1", codeKind: "shop" })] };
  const p = promoOf(promoState(), group, "2026-09-20");
  assert.equal(p.gone, true);
  assert.equal(p.kind, "shop");
  assert.equal(p.name, "", "there is no record left to name it from");
  assert.equal(p.offer, null);
});

test("a label she never named falls back to the code itself", () => {
  const state = promoState({ codes: [{ code: "HELLO", kind: "plain" }] });
  const p = promoOf(state, { orders: [order({ promoCode: "HELLO" })] }, "2026-09-20");
  assert.equal(p.name, "HELLO");
});

test("a total given by the caller is used instead of the order's own", () => {
  // The Edit pop-up is mid-edit, so the line has to answer for the items she is
  // looking at rather than the ones already saved.
  const group = { orders: [order({ promoCode: "MILO", unitPrice: 22 })] };
  assert.equal(promoOf(promoState(), group, "2026-09-20").total, 22);
  assert.equal(promoOf(promoState(), group, "2026-09-20", 44).total, 44);
  assert.equal(promoOf(promoState(), group, "2026-09-20", 44).overMin, true);
});

test("the currency comes off her settings, so a non-ringgit book still reads right", () => {
  const state = { ...promoState(), settings: { currency: "S$" } };
  const p = promoOf(state, { orders: [order({ promoCode: "MILO" })] }, "2026-09-20");
  assert.equal(p.cur, "S$");
});
