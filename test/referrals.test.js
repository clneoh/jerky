// test/referrals.test.js — bring-a-friend scheme numbers + the credit ledger
// behind "one coupon per NEW friend". Pure module, no DOM needed.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  schemeOf, referralLink, expiryDate, shareMessage, followupMessage,
  referrerName, referralFlag, creditRows, validCredits, creditStatus,
  giveCredits, markOneUsed, markCreditUsed, setCreditExpiry, removeCredit,
  addManualCredit, ROLE_LABEL,
} from "../admin/js/referrals.js";

const T = "2026-09-05"; // a fixed "today" so expiry math is deterministic

// A minimal order row: real order rows carry {id, groupId, customerName,
// whatsapp, referredBy, createdAt, productId, qty, ...}. groupId hex so
// orderCode() is deterministic.
function order(over = {}) {
  return {
    id: "o" + (over.id || "aaaa01"),
    groupId: over.groupId || "gaaaa01",
    customerName: over.customerName ?? "Aisyah",
    whatsapp: over.whatsapp ?? "60123456789",
    referredBy: over.referredBy ?? "",
    createdAt: over.createdAt ?? "2026-09-01T08:00:00.000Z",
    productId: over.productId ?? "p1",
    qty: over.qty ?? 1,
    status: over.status ?? "new",
    ...over,
  };
}

function baseState() {
  return {
    settings: { currency: "RM", referrals: { enabled: true, friendRM: 3, referrerRM: 3, validDays: 90 } },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    orders: [],
    credits: [],
  };
}

// ── schemeOf ───────────────────────────────────────────────────────────────

test("schemeOf returns defaults when referrals never set", () => {
  const s = schemeOf({ settings: {} });
  assert.deepEqual(s, { enabled: false, friendRM: 3, referrerRM: 3, validDays: 90 });
});

test("schemeOf clamps junk and honours a hand-set scheme", () => {
  const s = schemeOf({
    settings: { referrals: { enabled: true, friendRM: -2, referrerRM: "abc", validDays: "x" } },
  });
  assert.equal(s.enabled, true);
  assert.equal(s.friendRM, 3, "negative falls back to default");
  assert.equal(s.referrerRM, 3, "non-number falls back to default");
  assert.equal(s.validDays, 90);
});

test("schemeOf: blank validDays means never expire", () => {
  const s = schemeOf({ settings: { referrals: { validDays: "" } } });
  assert.equal(s.validDays, "");
});

// ── referralLink / expiryDate ──────────────────────────────────────────────

test("referralLink normalises digits into the share URL", () => {
  assert.equal(referralLink("https://jienluv2bake.com.my", "012-345 6789"),
    "https://jienluv2bake.com.my/store/?via=60123456789");
  assert.equal(referralLink("https://jienluv2bake.com.my/", "+60123456789"),
    "https://jienluv2bake.com.my/store/?via=60123456789");
});

test("referralLink returns '' for blank digits so callers can guard", () => {
  assert.equal(referralLink("https://x.com", ""), "");
  assert.equal(referralLink("", "60123456789"), "/store/?via=60123456789");
});

test("expiryDate counts validDays from today, '' when never", () => {
  assert.equal(expiryDate(90, T), "2026-12-04");
  assert.equal(expiryDate("", T), "");
  assert.equal(expiryDate(null, T), "");
  assert.equal(expiryDate(0, T), "");
});

// ── referrerName ───────────────────────────────────────────────────────────

test("referrerName finds the first saved name on any of their orders", () => {
  const st = baseState();
  st.orders = [
    order({ whatsapp: "60139876543", customerName: "Mei Ling" }),
    order({ whatsapp: "60139876543", customerName: "" }),
  ];
  assert.equal(referrerName(st, "60139876543"), "Mei Ling");
  assert.equal(referrerName(st, "60111111111"), "", "no orders → blank");
});

// ── referralFlag ───────────────────────────────────────────────────────────

function groupOf(...orders) {
  return { orders };
}

test("referralFlag: no stamp → none", () => {
  const st = baseState();
  assert.equal(referralFlag(st, groupOf(order({ referredBy: "" }))), "none");
});

test("referralFlag: ordering through your own link → self (never a credit)", () => {
  const st = baseState();
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60123456789" }));
  assert.equal(referralFlag(st, grp), "self");
});

test("referralFlag: number already in history (outside this order) → existing", () => {
  const st = baseState();
  st.orders = [order({ id: "aaaaaa", groupId: "gbbbb1", whatsapp: "60123456789", referredBy: "" })];
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60139876543" }));
  assert.equal(referralFlag(st, grp), "existing");
});

test("referralFlag: multi-item cart (same group) is not its own prior order → new", () => {
  const st = baseState();
  // The cart arrives as several order rows sharing one groupId; the scan must
  // skip this group entirely so the friend still counts as NEW.
  const grp = groupOf(
    order({ id: "oa1111", groupId: "gcccc1", whatsapp: "60123456789", referredBy: "60139876543" }),
    order({ id: "oa2222", groupId: "gcccc1", whatsapp: "60123456789", referredBy: "60139876543" }));
  assert.equal(referralFlag(st, grp), "new");
});

test("referralFlag: truly never ordered before → new", () => {
  const st = baseState();
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60139876543" }));
  assert.equal(referralFlag(st, grp), "new");
});

// ── creditStatus / creditRows / validCredits ───────────────────────────────

test("creditStatus: used stays used, expired after its day, still valid ON the day", () => {
  assert.equal(creditStatus({ usedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-12-04" }, T), "used");
  assert.equal(creditStatus({ expiresAt: "2026-09-05" }, T), "valid", "valid through its own expiry day");
  assert.equal(creditStatus({ expiresAt: "2026-09-04" }, T), "expired");
  assert.equal(creditStatus({ expiresAt: "" }, T), "valid", "no expiry never expires");
});

test("creditRows sorts valid (soonest expiry first) → used → expired, newest earned first within a bucket", () => {
  const st = baseState();
  st.credits = [
    { id: "c1", holder: "60123456789", amountRM: 3, role: "reward", expiresAt: "2026-12-04", usedAt: null, earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
    { id: "c2", holder: "60123456789", amountRM: 3, role: "reward", expiresAt: "2026-11-01", usedAt: null, earnedAt: "2026-09-02T00:00:00.000Z", orderCode: "" },
    { id: "c3", holder: "60123456789", amountRM: 3, role: "reward", expiresAt: "2026-08-01", usedAt: null, earnedAt: "2026-09-03T00:00:00.000Z", orderCode: "" },
    { id: "c4", holder: "60123456789", amountRM: 3, role: "reward", expiresAt: "2026-12-04", usedAt: "2026-09-04T00:00:00.000Z", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
    { id: "c5", holder: "60123456789", amountRM: 3, role: "reward", expiresAt: "2026-10-01", usedAt: null, earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
  ];
  const rows = creditRows(st, "60123456789", T).map((c) => c.id);
  assert.deepEqual(rows, ["c5", "c2", "c1", "c4", "c3"]);
  assert.deepEqual(creditRows(st, "60199999999", T), [], "other holder → nothing");
});

test("validCredits only returns usable credits", () => {
  const st = baseState();
  st.credits = [
    { id: "c1", holder: "60123456789", expiresAt: "2026-12-04", usedAt: null, amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
    { id: "c2", holder: "60123456789", expiresAt: "2026-08-01", usedAt: null, amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
    { id: "c3", holder: "60123456789", expiresAt: "", usedAt: "2026-09-02T00:00:00.000Z", amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
  ];
  const v = validCredits(st, "60123456789", T);
  assert.equal(v.length, 1);
  assert.equal(v[0].id, "c1");
});

// ── giveCredits ────────────────────────────────────────────────────────────

test("giveCredits creates a reward for the referrer and a friend discount", () => {
  const st = baseState();
  st.orders = [
    order({ whatsapp: "60139876543", customerName: "Mei Ling" }), // so the referrer has a saved name
  ];
  const grp = groupOf(order({ whatsapp: "60123456789", customerName: "Nadia", referredBy: "60139876543" }));
  const r = giveCredits(st, grp, schemeOf(st), T);
  assert.equal(r.created, true);
  assert.equal(st.credits.length, 2);

  const reward = st.credits.find((c) => c.role === "reward");
  assert.equal(reward.holder, "60139876543");
  assert.equal(reward.holderName, "Mei Ling");
  assert.equal(reward.amountRM, 3);
  assert.equal(reward.expiresAt, "2026-12-04");
  assert.equal(reward.usedAt, null);
  assert.equal(reward.orderCode, order({ whatsapp: "60123456789", referredBy: "60139876543" }).groupId.slice(-6).toUpperCase());
  assert.match(reward.note, /Nadia/);

  const off = st.credits.find((c) => c.role === "friendOff");
  assert.equal(off.holder, "60123456789");
  assert.equal(off.holderName, "Nadia");
  assert.equal(off.amountRM, 3);
  assert.equal(off.expiresAt, "2026-12-04");
});

test("giveCredits is idempotent: a second tap never double-gives", () => {
  const st = baseState();
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60139876543" }));
  const first = giveCredits(st, grp, schemeOf(st), T);
  assert.equal(first.created, true);
  const again = giveCredits(st, grp, schemeOf(st), T);
  assert.equal(again.created, false);
  assert.equal(st.credits.length, 2, "no extra rows");
});

test("giveCredits: referrer with no saved name still gets a credit by digits", () => {
  const st = baseState();
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60139876543" }));
  const r = giveCredits(st, grp, schemeOf(st), T);
  assert.equal(r.created, true);
  const reward = st.credits.find((c) => c.role === "reward");
  assert.match(reward.holderName, /\(new\)/);
});

test("giveCredits: a credit can carry no expiry when the scheme says never", () => {
  const st = baseState();
  st.settings.referrals.validDays = "";
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60139876543" }));
  giveCredits(st, grp, schemeOf(st), T);
  assert.ok(st.credits.every((c) => c.expiresAt === ""), "blank expiry written, not a date");
});

test("giveCredits: a self-referral earns nothing", () => {
  const st = baseState();
  const grp = groupOf(order({ whatsapp: "60123456789", referredBy: "60123456789" }));
  const r = giveCredits(st, grp, schemeOf(st), T);
  assert.equal(r.created, false);
  assert.equal(st.credits.length, 0);
});

// ── mark used / expiry / remove ────────────────────────────────────────────

test("markOneUsed marks the oldest valid credit and returns it", () => {
  const st = baseState();
  st.credits = [
    { id: "c1", holder: "60123456789", expiresAt: "2026-12-04", usedAt: null, amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
    { id: "c2", holder: "60123456789", expiresAt: "2026-11-01", usedAt: null, amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
  ];
  const used = markOneUsed(st, "60123456789", "2026-09-06T10:00:00.000Z");
  assert.equal(used.id, "c2", "soonest-expiring valid credit first");
  assert.equal(used.usedAt, "2026-09-06T10:00:00.000Z");
  assert.equal(st.credits.find((c) => c.id === "c2").usedAt, "2026-09-06T10:00:00.000Z",
    "the state row really was marked, not a throwaway copy");
  const second = markOneUsed(st, "60123456789", "2026-09-06T11:00:00.000Z");
  assert.equal(second.id, "c1", "next valid credit follows");
  assert.equal(markOneUsed(st, "60123456789"), null, "nothing left to use");
});

test("markCreditUsed stamps one by id; setCreditExpiry changes or clears it; removeCredit deletes it", () => {
  const st = baseState();
  st.credits = [
    { id: "c1", holder: "60123456789", expiresAt: "2026-12-04", usedAt: null, amountRM: 3, role: "reward", earnedAt: "2026-09-01T00:00:00.000Z", orderCode: "" },
  ];
  markCreditUsed(st, "c1", "2026-09-06T10:00:00.000Z");
  assert.equal(st.credits[0].usedAt, "2026-09-06T10:00:00.000Z");

  setCreditExpiry(st, "c1", "2026-10-01");
  assert.equal(st.credits[0].expiresAt, "2026-10-01");
  setCreditExpiry(st, "c1", "");
  assert.equal(st.credits[0].expiresAt, "", "blank → never expires");
  setCreditExpiry(st, "c1", "not-a-date");
  assert.equal(st.credits[0].expiresAt, "", "malformed → never expires");

  removeCredit(st, "c1");
  assert.equal(st.credits.length, 0);
});

test("addManualCredit stores a hand-given credit (e.g. an offline referral)", () => {
  const st = baseState();
  const c = addManualCredit(st, {
    whatsapp: "012-345 6789", name: "Aisyah", amountRM: 3, validDays: "30", note: "friend from the stall", today: T,
  });
  assert.equal(c.holder, "60123456789");
  assert.equal(c.holderName, "Aisyah");
  assert.equal(c.role, "reward");
  assert.equal(c.amountRM, 3);
  assert.equal(c.expiresAt, "2026-10-05");
  assert.equal(c.orderCode, "");
  assert.equal(st.credits.length, 1);

  assert.equal(addManualCredit(st, { whatsapp: "", amountRM: 3 }), null, "no number → nothing stored");
});

// ── shareMessage / followupMessage ─────────────────────────────────────────

test("shareMessage quotes the live scheme numbers and the customer's link", () => {
  const st = baseState();
  st.settings.referrals = { enabled: true, friendRM: 5, referrerRM: 2, validDays: "" };
  const r = { name: "Aisyah", whatsapp: "60123456789" };
  const msg = shareMessage(st, r, "https://jienluv2bake.com.my");
  assert.match(msg, /Hi Aisyah!/);
  assert.match(msg, /RM 5\.00 off their FIRST order/);
  assert.match(msg, /you get RM 2\.00 off a future order/);
  assert.match(msg, /https:\/\/jienluv2bake\.com\.my\/store\/\?via=60123456789/);
  assert.match(msg, /never expires/);
});

test("shareMessage falls back when the customer has no name yet", () => {
  const st = baseState();
  const msg = shareMessage(st, { whatsapp: "60123456789" }, "https://x.com");
  assert.doesNotMatch(msg, /Hi !/);
  assert.match(msg, /bring-a-friend deal/);
});

test("followupMessage personalises with the product they just bought + its feeding tip", () => {
  const st = baseState();
  const r = { name: "Aisyah", whatsapp: "60123456789" };
  const msg = followupMessage(st, r, { name: "Chicken Jerky", servingTip: "Tear into small pieces for small dogs" }, "https://munchiesfurkidz.example");
  assert.match(msg, /Hi Aisyah! How did the Chicken Jerky go/);
  assert.match(msg, /Feeding tip: Tear into small pieces for small dogs/);
  assert.match(msg, /RM 3\.00 off their FIRST order/);
  assert.match(msg, /RM 3\.00 off a future order/);
  assert.match(msg, /\?via=60123456789/);

  // A product with no feeding tip stays clean — no blank "Feeding tip:" line.
  const plain = followupMessage(st, r, { name: "Chicken Jerky", servingTip: "" }, "https://x.com");
  assert.doesNotMatch(plain, /Feeding tip/);
});

test("followupMessage without a known product asks generally instead", () => {
  const st = baseState();
  const msg = followupMessage(st, { name: "Mei", whatsapp: "60123456789" }, null, "https://x.com");
  assert.match(msg, /Hope your order was lovely/);
  assert.doesNotMatch(msg, /How did the/);
});

test("ROLE_LABEL covers the two credit kinds", () => {
  assert.equal(ROLE_LABEL.reward, "Referral credit");
  assert.equal(ROLE_LABEL.friendOff, "Friend's discount");
});
