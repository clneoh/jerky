// test/bring-friend.test.js — bring-a-friend is its own screen under The shop
// (v314), and the offer is no longer buried in Settings.
//
// Her words: __"can be brought to The Shop, rather than in Settings."__ and
// __"can we make to more seamless with other promo?"__ → **"One place, read as a
// family"**.
//
// ★ THE TWO THINGS THIS HAS TO HOLD:
//   1. **The move is a MOVE, not a rewrite.** The switch and the three numbers
//      still write the SAME `settings.referrals` keys, because the shop's `via`
//      links, the Give-credit press and the reward's "brought in" count all read
//      them. A screen that looked right and wrote somewhere else would break
//      three features silently.
//   2. **Settings no longer carries it**, or the offer has simply been copied and
//      there are now two places to change one number.
//
// ⚠️ The route and the menu row are held by `test/more-menu.test.js`, which walks
// the app's own route table — this file does not repeat that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    _listeners: {}, placeholder: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: createEl("body"),
};
globalThis.window = { open() {}, scrollTo() {}, addEventListener() {} };
globalThis.location = { hash: "#/bring-a-friend", reload() {} };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};

const { renderReferrals } = await import("../admin/js/views/referrals.js");

const walk = (root, out = []) => {
  for (const c of root.children || []) { out.push(c); walk(c, out); }
  return out;
};

function state(over = {}) {
  return {
    settings: { currency: "RM", supabase: {}, referrals: { enabled: false, friendRM: 3, referrerRM: 3, validDays: 90, ...over } },
    uoms: [], products: [], ingredients: [], orders: [], deliveryDates: [],
    purchaseOrders: [], customers: [], productCategories: [], suppliers: [], wishList: [],
  };
}

function draw(st) {
  const root = createEl("div");
  renderReferrals(root, st);
  return root;
}

const inputsOf = (root) => walk(root).filter((n) => n.tagName === "INPUT");
const textsOf = (root) => walk(root).filter((n) => n.nodeType === 1).map((n) => n.textContent).join(" | ");

const fire = (node) => (node._listeners.change || node._listeners.click || []).forEach((f) => f());

// ── ★ THE MOVE WROTE THE SAME KEYS ─────────────────────────────────────────

test("the switch writes settings.referrals.enabled — the same key everything else reads", () => {
  const st = state();
  const root = draw(st);
  const box = inputsOf(root).find((n) => n.attrs.type === "checkbox");
  assert.ok(box, "the screen draws its on/off switch");
  box.checked = true;
  fire(box);
  assert.equal(st.settings.referrals.enabled, true,
    "the switch must write the key the shop's via links and Give credit read");
});

test("the three numbers write the same keys, and a blank duration means never", () => {
  const st = state();
  const root = draw(st);
  const nums = inputsOf(root).filter((n) => n.attrs.type === "number");
  assert.equal(nums.length, 3, "three boxes: friend's discount, referrer's credit, valid for days");

  nums[0].value = "5"; fire(nums[0]);
  nums[1].value = "7"; fire(nums[1]);
  nums[2].value = ""; fire(nums[2]);
  assert.deepEqual(
    { friendRM: st.settings.referrals.friendRM, referrerRM: st.settings.referrals.referrerRM, validDays: st.settings.referrals.validDays },
    { friendRM: 5, referrerRM: 7, validDays: "" },
    "a blank duration is her choosing NEVER, which is not the same as never having set one");
});

test("a nonsense number is refused rather than saved", () => {
  const st = state();
  const root = draw(st);
  const nums = inputsOf(root).filter((n) => n.attrs.type === "number");
  nums[0].value = "0"; fire(nums[0]);
  assert.equal(st.settings.referrals.friendRM, 3, "0 falls back to the default, never a RM0 offer");
});

// ── ★ AND THE NUMBERS ARE SHOWN BEING USED ─────────────────────────────────

test("the screen shows the exact sentence the customer forwards, with her numbers in it", () => {
  // The numbers are the whole reason the card exists — they appear in the message
  // a customer SENDS ON to their friend. A screen that collected them without
  // ever showing where they land would let her set a number the app does not use.
  const root = draw(state({ friendRM: 4, referrerRM: 6, validDays: 30 }));
  const text = textsOf(root);
  assert.ok(text.includes("RM 4.00"), `the friend's discount is shown in words (got: ${text.slice(0, 200)})`);
  assert.ok(text.includes("RM 6.00"), "the referrer's credit is shown in words");
  assert.ok(text.includes("30 days"), "the credit's life is shown in words");
});

test("a credit that never runs out says so, rather than saying '0 days'", () => {
  const text = textsOf(draw(state({ validDays: "" })));
  assert.ok(text.includes("never runs out"), "blank duration reads as never, not as zero");
});

// ── ★ THE OFFER IS NOT IN TWO PLACES ───────────────────────────────────────

// ⚠️ COMMENTS ARE STRIPPED FIRST, AND THAT IS THE WHOLE ASSERTION. The first cut
// of this test looked for the word anywhere in the file and went RED on the note
// that explains the move — a test reading the documentation instead of the code.
// What has to be absent is the MACHINERY: the state it writes and the controls
// that write it.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("Settings no longer carries bring-a-friend — it MOVED, it was not copied", () => {
  const code = stripComments(readFileSync(new URL("../admin/js/views/settings.js", import.meta.url), "utf8"));
  assert.equal(/referrals/i.test(code), false,
    "Settings still reaches into settings.referrals — the offer now has two homes and one number to keep in step");
  assert.equal(/bring-a-friend/i.test(code), false, "Settings still builds the bring-a-friend card");
});

// ── ★ THE FAMILY, READ TOGETHER ────────────────────────────────────────────

test("the screen says what the other half is, and points at it", () => {
  const root = draw(state());
  const hrefs = walk(root).filter((n) => n.className === "menu-item").map((n) => n.attrs.href);
  assert.ok(hrefs.includes("#/promo"), "it points at the code half");
  assert.ok(hrefs.includes("#/customers"), "and at where a customer's own link is copied");

  const text = textsOf(root);
  assert.ok(text.includes("A link, or a code"),
    "the family card is the point of the move — it must say what differs between the two");
  assert.ok(text.includes("travels"), "the distinction is the artefact: a link travels, a code is printed");
});

// ── ★★ v322: THE DISCOUNT ACTUALLY COMES OFF ────────────────────────────────
//
// Her report: __"the bring a friend discount used but not really create a discount for that
// new customer."__ **And she was right.** `giveCredits` wrote the friend a coupon and then
// **nothing read it** — `customerTotal` knew about promo CODES and nothing else, so the order
// was priced as though the coupon did not exist, while pressing Apply coupon said *"already
// taken off this order"* about a figure nothing had ever taken off.
//
// It had been built that way on purpose (the scheme's first rule was "the app records what is
// owed; you apply it yourself"), which stopped being right the moment a CODE came off by
// itself — the code comes off, names itself in every message and shows its working, and the
// coupon did none of those.
//
// **NOTHING CAUGHT IT, for the whole life of the feature**, because every test asked what the
// coupon SAID and none asked what it DID.

const { couponOn, giveCredits } = await import("../admin/js/referrals.js");
const { customerTotal, moneyLines } = await import("../admin/js/courier.js");
const { orderCode } = await import("../admin/js/state.js");
const { trackingSnapshot } = await import("../admin/js/supabase.js");

const P22 = {
  settings: { currency: "RM", storefront: { name: "Jien Luv 2 Bake" }, referrals: { enabled: true, friendRM: 3, referrerRM: 3, validDays: 90 } },
  products: [{ id: "p1", name: "Focaccia", price: 15 }],
  deliveryDates: [{ id: "d18", date: "2026-09-18" }],
  promoCodes: [], credits: [], customers: [],
};
const orderFor = (extra = {}) => ([{
  id: "ordabc123", groupId: "ordgabc123", deliveryDateId: "d18", deliveryDate: "2026-09-18",
  fulfillment: "collect", whatsapp: "60123456789",
  productId: "p1", qty: 2, productName: "Focaccia", unitPrice: 15, status: "new", ...extra,
}]);
const friendCoupon = (over = {}) => ({
  id: "crd1", holder: "60123456789", holderName: "Mei", amountRM: 3, role: "friendOff",
  earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "", usedAt: null,
  orderCode: "A3F9C2", note: "First order", ...over,
});

test("the friend's coupon comes OFF the total, and the message names it", () => {
  const st = { ...P22, credits: [], orders: orderFor() };
  const g = { orders: st.orders };
  // ⚠️ THE ORDER CODE COMES FROM THE APP ITSELF, never from the fixture — the coupon is tied
  // to an order by that code, and a fixture that invented one would be testing its own guess.
  st.credits = [friendCoupon({ orderCode: orderCode(st.orders[0]) })];
  const parts = customerTotal(st, g);
  assert.equal(parts.items, 30, "two loaves at RM15");
  assert.equal(parts.coupon, 3, "★ the RM3 the message promises is actually taken off");
  assert.equal(parts.total, 27, "and the total she asks for is the lower figure");

  const lines = moneyLines(st, parts).join("\n");
  assert.match(lines, /Bring-a-friend you were sent: -RM 3\.00/,
    "the customer can SEE the discount, which is the whole complaint");
});

test("an order with no coupon at all is priced exactly as before", () => {
  // The control. Adding a discount to the one money function must not move a single order
  // that has nothing to do with bring-a-friend.
  const st = { ...P22, credits: [], orders: orderFor() };
  const parts = customerTotal(st, { orders: st.orders });
  assert.equal(parts.coupon, 0, "no coupon, no line");
  assert.equal(parts.total, 30, "and the plain items total, untouched");
  assert.doesNotMatch(moneyLines(st, parts).join("\n"), /Bring-a-friend/,
    "and nothing about a discount is said to a customer who had none");
});

test("a code on the order wins, and the friend's coupon is NOT spent", () => {
  // Her rule from v314: one coupon per order. The code is what the customer typed and can
  // see, so it takes the total — and the friend's coupon must survive for their next order
  // rather than being quietly burned.
  const st = { ...P22, credits: [], orders: orderFor({ referredBy: "60199999999", promo: "FRESH10" }) };
  const r = giveCredits(st, { orders: st.orders }, st.settings.referrals);
  const friend = r.rows.find((c) => c.role === "friendOff");
  assert.ok(friend, "the friend's coupon is still written");
  assert.equal(friend.usedAt, null, "but NOT spent — a code paid for this order, not the coupon");
});

test("with no code, the friend's coupon is spent the moment it is made", () => {
  const st = { ...P22, credits: [], orders: orderFor({ referredBy: "60199999999" }) };
  const r = giveCredits(st, { orders: st.orders }, st.settings.referrals);
  assert.ok(r.rows, `giveCredits bailed out instead of writing the couple: ${r.reason}`);
  const friend = r.rows.find((c) => c.role === "friendOff");
  assert.ok(friend.usedAt, "it comes off THIS order, so it is spent on it");
  assert.ok(friend.orderCode, "and it records which order it was spent on");
});

test("the discount cannot leak onto another order", () => {
  const st = { ...P22, credits: [], orders: orderFor() };
  const g = { orders: st.orders };
  const born = couponOn(st, g);
  // A coupon tied to a DIFFERENT order — the friend's second order, say — must not apply.
  st.credits = [friendCoupon({ orderCode: born.code === "ZZZZZZ" ? "other" : "ZZZZZZ" })];
  assert.equal(couponOn(st, g).amount, 0,
    "a coupon born on another order must never discount this one");
  assert.equal(customerTotal(st, g).total, 30, "so the total is untouched");
});

test("giving a coupon republishes the customer's card", () => {
  // ★ HER REPORT: __"there store front copy still hold the discount in cache."__ The give
  // path saved and synced — but **it never republished the customer's own card**, and every
  // OTHER door that changes what a customer sees does. `maybePublishTracking`'s own note says
  // why that matters: *"a list of doors kept by hand is what let an edit that changed the
  // items, the price or the address walk straight past it, leaving the customer reading the
  // order it used to be."* **This door was not on the list**, and giving a coupon is exactly
  // an edit that changes the price.
  const src = readFileSync(new URL("../admin/js/views/orders.js", import.meta.url), "utf8");
  const at = src.indexOf("const give = () => {");
  assert.ok(at > -1, "the give-coupon press was not found");
  const body = src.slice(at, src.indexOf("const skip = () => {", at));
  assert.match(body, /maybePublishTracking\(state, group\)/,
    "giving a coupon changes the order's total — the customer's card must be republished with it");
});

test("the order says the bring-a-friend discount is already in its total", () => {
  // The coupon is spent the moment it is given, so it no longer shows as a "ready" coupon
  // with a press beside it — which would leave the Total RM3 lower with nothing on the order
  // explaining why. An unexplained figure is the fault this app treats as a bug everywhere.
  const src = readFileSync(new URL("../admin/js/views/orders.js", import.meta.url), "utf8");
  assert.match(src, /couponOn\(state, group\.orders\)/,
    "the order does not ask whether a discount is already in its total");
  assert.match(src, /already off this order's total/,
    "and nothing on the order says so");
});

test("the customer's tracking card carries the discount, with no code on it", () => {
  // ★ Her third report, and the last piece: the card showed the LOWER TOTAL with nothing
  // saying why. **It reuses `promo_rm` rather than adding a column, and the app's own note
  // says why: a column that does not exist yet kills publishing for EVERY order, silently.**
  // `promo_rm` already means "the discount on this order", and a code and the friend's coupon
  // can never both apply — so it holds the one discount, whichever it is.
  const st = { ...P22, credits: [], orders: orderFor() };
  st.credits = [friendCoupon({ orderCode: orderCode(st.orders[0]) })];
  const row = trackingSnapshot(st, { orders: st.orders });
  assert.equal(row.promo_rm, 3, "the card is told the RM3 came off");
  assert.equal(row.promo_code, null,
    "and carries NO code — which is exactly what tells the shop to use the bring-a-friend words");
});

test("a code still publishes as a code, not as the friend's discount", () => {
  const st = { ...P22, credits: [], orders: orderFor({ promo: "FRESH10" }) };
  st.promoCodes = [{
    id: "c1", code: "FRESH10", state: "live", vis: "public", frozen: false,
    who: { type: "all" }, when: { from: "", to: "" }, basket: { type: "none", amount: 0 },
    gives: { type: "rm", value: 10, cap: 0 }, often: { type: "unlimited", n: 0, maxRM: 0 },
    beside: { type: "anything" }, say: "", sayZh: "", sayMs: "", used: 0, given: 0,
  }];
  const row = trackingSnapshot(st, { orders: st.orders });
  assert.equal(row.promo_code, "FRESH10", "the code still names itself on the card");
  assert.equal(row.promo_rm, 10, "and the discount is unchanged by this version");
});

test("Promo codes points back, so the two are reachable from each other", () => {
  const src = readFileSync(new URL("../admin/js/views/promo.js", import.meta.url), "utf8");
  assert.ok(src.includes('"#/bring-a-friend"'),
    "the Promo screen no longer offers the other half — the family is one-way");
});

// ── ★ ONE COUPON PER ORDER (v314) ──────────────────────────────────────────
//
// Her reasoning, and the fault it fixes: __"if we state only credit of ringgit,
// there might be confusion of how much credit to apply, but we can state, only
// one coupon apply for each purchase."__
//
// **THE AMBIGUITY WAS REAL AND IT WAS TWO PLACES.** On a customer's card with two
// RM3 coupons the chip read "2 ready" while the line beneath it read "you still
// owe RM3.00 off an order" — because that figure came from the FIRST valid
// coupon only. On an order the line read "RM3.00 credit available" beside a
// button reading "Apply credit (2)", and the press spent exactly one. Three
// numbers, none of them saying how much to take off.
//
// The fix is not arithmetic — it is her rule, stated. So every place she applies
// a coupon must SAY it, and no place may show a running balance.

const srcOf = (p) => stripComments(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

test("every place she applies a coupon states the one-per-order rule", () => {
  for (const [path, where] of [
    ["admin/js/views/customers.js", "a customer's card"],
    ["admin/js/views/orders.js", "an order that carries one"],
    ["admin/js/views/referrals.js", "the scheme screen"],
    ["admin/js/referrals.js", "the message a customer forwards"],
  ]) {
    assert.match(srcOf(path), /one (coupon )?per order/,
      `${where} does not state the rule — that is where the "how much do I take off?" question comes back`);
  }
});

test("no screen turns coupons into a running balance any more", () => {
  // The old sentence, and the only shape that produced it: one coupon's amount
  // presented as what the customer is owed in total.
  assert.doesNotMatch(srcOf("admin/js/views/customers.js"), /you still owe/,
    "the customer's card is showing an amount due again — a coupon is a thing, never a balance");
});

test("the customer's card counts what is ready, and says what is not", () => {
  const code = srcOf("admin/js/views/customers.js");
  assert.match(code, /ready — one per order/, "the count is named as a count of ready coupons");
  assert.match(code, /none ready/, "and all-used reads as none ready, not as a zero");
});

// ── ★★ THE FORGET BUTTON IS OFFERED WHERE IT CAN WORK (v325) ─────────────────
test("Forget is offered on a hand-added person, and never on a customer with orders", () => {
  // Her own rule about dead controls: **two rows that look alike must behave alike, and a press
  // that cannot do what it says must say why or not be there at all.** A customer's row is built
  // from their ORDERS, so a Forget button on one would either do nothing or silently throw away
  // their reward and note while leaving the row standing. It is offered on `r.manual` only.
  const src = readFileSync(new URL("../admin/js/views/customers.js", import.meta.url), "utf8");
  const at = src.indexOf('"🗑 Forget"');
  assert.ok(at > -1, "the Forget press is gone");
  assert.match(src.slice(Math.max(0, at - 900), at), /r\.manual\s*\?/,
    "Forget must be gated on the person having been added by hand");
  assert.match(src, /removeProfile\(state, r\._key\)/, "and it must remove the record by the row's key");
  // And the question it asks has to say what goes and what does not — a bare "Are you sure?" is
  // not something she can weigh.
  assert.match(src, /never ordered — so this removes the name, the number, any reward and any note/,
    "the confirmation must name what is removed");
  assert.match(src, /Nothing else in your book is touched/,
    "and say plainly what is NOT");
});
