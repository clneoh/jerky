// test/orders-view.test.js — the shape of the Orders screen's ＋ New order card
// (admin/js/views/orders.js): it arrives folded, and when it is opened it reads
// the day calendar first, then the customer, then the items.
//
// The screens it lives on sit behind the sign-in, so this is the closest anyone
// gets to tapping it here: the card is built for real and then walked.
//
// "Now" is frozen at Thu 10 Sep 2026, as in orders-cal.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  // textContent is a real DOM property, not a string sitting beside the children:
  // the caret is written with `caret.textContent = "▾"`, and it has to read back
  // as what was written, and as the child it was built with before that.
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) {
      this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }];
    },
  });
  return node;
}
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
// selectDate writes the current date into the URL without firing the router.
globalThis.history = { replaceState() {} };

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders, productOptions } = await import("../admin/js/views/orders.js");

const STATE = {
  deliveryDates: [
    { id: "d7", date: "2026-09-07" },
    { id: "d10", date: "2026-09-10" },
  ],
  products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" }],
  orders: [],
  ingredients: [],
  occasions: [],
  settings: { cutoff: "18:00", defaultCapacity: 12 },
};
const PARAMS = () => new URLSearchParams({ date: "d7" });

// Every node under a root, so the card can be found wherever it has been placed.
function all(node, out = []) {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
}
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
// el() puts a boolean attribute through setAttribute, while the code later flips
// `hidden` as a DOM property (which drops the attribute in a browser) — so both
// have to be read.
const isHidden = (n) => (n.hidden === undefined ? n.attrs.hidden === "true" : n.hidden === true);
const labelOf = (n) => {
  const l = all(n).find((c) => c.tagName === "LABEL");
  return l && l.children[0].text;
};

function build() {
  const root = createEl("div");
  const teardown = renderOrders(root, STATE, PARAMS());
  return { root, teardown };
}

test("renderOrders hands the router a teardown for the cards it opened", () => {
  const { teardown } = build();
  assert.equal(typeof teardown, "function", "so a later tap cannot reach a card that has gone");
  teardown();
});

test("the ＋ New order card arrives folded", () => {
  const { root } = build();
  const body = byClass(root, "fold-body");
  assert.ok(body, "the card has a body to fold away");
  assert.equal(isHidden(body), true, "and starts with it shut");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▸",
    "the caret points at what is hidden");
});

test("its title opens and shuts it, and the caret follows", () => {
  const { root } = build();
  const head = byClass(root, "fold-head");
  assert.equal(head.tagName, "BUTTON", "the title is the control");

  head._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), false, "a tap opens it");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▾", "and the caret turns over");

  head._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), true, "a second tap shuts it again");
  assert.equal(byClass(root, "fold-caret").children[0].text, "▸");
});

test("opened, it reads the day calendar first, then the customer, then the items", () => {
  const { root } = build();
  const body = byClass(root, "fold-body");
  const dayIdx = body.children.findIndex((n) => labelOf(n) === "Delivery day");
  const customerIdx = body.children.findIndex((n) => labelOf(n) === "Customer");
  const itemsIdx = body.children.findIndex((n) => labelOf(n) === "Items");
  const addIdx = body.children.findIndex((n) => String(n.className).includes("block"));

  assert.equal(dayIdx, 0, "which day she is adding to comes first");
  assert.equal(body.children[0].children[1].className, "cal-wrap",
    "and under it is the month calendar, the same one the shop shows");
  assert.ok(customerIdx > dayIdx, "who the order is for comes after the day");
  assert.ok(itemsIdx > customerIdx, "and what they want comes after that");
  assert.ok(addIdx > itemsIdx, "with Add order last");
});

test("a rebuild around an open card leaves it open, and a fresh visit folds it", () => {
  const { root } = build();
  byClass(root, "fold-head")._listeners.click[0]();

  // Tapping a day in the calendar at the top rebuilds the day area underneath —
  // including the card — with no fresh visit to the screen.
  const dayCell = all(byClass(root, "cal-wrap"))
    .find((n) => n.tagName === "BUTTON" && String(n.className).includes("cal-cell"));
  assert.ok(dayCell, "the screen's own calendar offers a day to open");
  dayCell._listeners.click[0]();
  assert.equal(isHidden(byClass(root, "fold-body")), false, "the open card comes back open");

  // Coming back to the screen later starts folded again.
  renderOrders(root, STATE, PARAMS());
  assert.equal(isHidden(byClass(root, "fold-body")), true);
});

// ── v97/v98: the last stage, and the courier's tracking number ───────────────
test("the last stage wears one label — Collected / Posted — on every order", () => {
  const order = (extra) => ({
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", ...extra,
  });
  const labelsFor = (extra) => {
    const root = createEl("div");
    renderOrders(root, { ...STATE, orders: [order(extra)] }, PARAMS());
    return all(root).filter((n) => String(n.className) === "oj-label").map((n) => n.children[0].text);
  };

  // v97 named this stage per order (Collected here, Shipped there). She asked for
  // the pair itself instead, so both endings read the same label (v98).
  assert.equal(labelsFor({ fulfillment: "courier" })[5], "Collected / Posted",
    "a posted order");
  assert.equal(labelsFor({ fulfillment: "collect" })[5], "Collected / Posted",
    "one the customer fetches");

  // The dropdown and the filter offer the same word, so nothing says Delivered.
  const root = createEl("div");
  renderOrders(root, { ...STATE, orders: [order({ fulfillment: "courier" })] }, PARAMS());
  const opts = all(root).filter((n) => n.tagName === "OPTION").map((n) => n.children[0].text);
  assert.ok(opts.includes("Collected / Posted"), "the status list offers the pair");
  assert.ok(!opts.includes("Delivered"), "and nothing still offers Delivered");
  assert.ok(!opts.includes("Shipped"), "nor a bare Shipped on its own");
});

test("every order offers Note / tracking beside Edit, and the message for how it leaves", () => {
  const root = createEl("div");
  renderOrders(root, { ...STATE, orders: [{
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", fulfillment: "courier", trackingNo: "JT123",
  }] }, PARAMS());
  const labels = all(root).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.ok(labels.includes("Note / tracking"),
    "the two fields she reaches for most have their own way in, without the whole Edit form");
  assert.ok(labels.includes("Edit"), "Edit stays for everything else");
  assert.ok(labels.includes("Send posted message"), "and the message that carries the number");

  const collect = createEl("div");
  renderOrders(collect, { ...STATE, orders: [{
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "ready", fulfillment: "collect",
  }] }, PARAMS());
  const collectLabels = all(collect).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.ok(collectLabels.includes("Note / tracking"), "the same button on a self-collect order");
  assert.ok(collectLabels.includes("Send pickup reminder"), "which keeps the pickup reminder instead");
});

// ── v101: which way the money came in ────────────────────────────────────────
test("Paid · Cash and Paid · TNG each mark it paid and record which, and when", () => {
  // `paidReceived: false` is what the app itself writes when Paid is picked in the dropdown:
  // the order is on the money stage and the money has not landed yet (which is also why the
  // Paid buttons have to be here).
  const state = { ...STATE, orders: [{
    id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
    whatsapp: "60123456789", status: "paid", paidReceived: false,
  }] };
  const root = createEl("div");
  renderOrders(root, state, PARAMS());

  const labels = all(root).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.ok(labels.includes("Paid · Cash") && labels.includes("Paid · TNG"),
    "one tap each — no pop-up for something she does twenty times a week");

  all(root).find((n) => n.tagName === "BUTTON" && n.textContent === "Paid · TNG")._listeners.click[0]();
  assert.equal(state.orders[0].paidReceived, true, "the order is paid");
  assert.equal(state.orders[0].paidMethod, "tng", "and the row remembers how");
  assert.ok(state.orders[0].paidAt, "stamped when the money landed, which is what the Money screen counts");

  const again = createEl("div");
  renderOrders(again, state, PARAMS());
  const tag = all(again).find((n) => String(n.className).split(/\s+/).includes("paid-tag"));
  assert.equal(tag.children[0].text, "TNG", "and the row says so beside its status");
});

test("the day header carries its own till — cash, TNG, still to collect", () => {
  const state = { ...STATE, orders: [
    { id: "a", deliveryDateId: "d7", productId: "p1", qty: 1, unitPrice: 15,
      status: "ready", paidReceived: true, paidMethod: "cash" },
    { id: "b", deliveryDateId: "d7", productId: "p1", qty: 2, unitPrice: 15,
      status: "confirmed", paidReceived: false },
  ] };
  const root = createEl("div");
  renderOrders(root, state, PARAMS());
  const line = all(root).find((n) => String(n.className).split(/\s+/).includes("money-line"));
  assert.ok(line, "the day shows what came in");
  assert.equal(line.children[0].text, "Cash RM 15.00 · 1 to collect",
    "what is collected, and how many orders are still to pay — nothing invented for the rest");

  // A day with nothing on it has no till to show.
  const empty = createEl("div");
  renderOrders(empty, { ...STATE }, PARAMS());
  assert.equal(all(empty).find((n) => String(n.className).split(/\s+/).includes("money-line")),
    undefined, "no orders, no money line");
});

// ── v117: a regular pays at pickup ───────────────────────────────────────────
// "Some close customer prefer to pay either by TnG or Cash when they puck up" (17 Sep 2026).
// Their order goes Confirmed -> Preparing without ever passing through Paid, and the money is
// handed over at the counter — so the Paid step is left off that row's map, and the two
// buttons stay on wherever the order has got to until the money is recorded.
const withOrder = (extra) => ({ ...STATE, orders: [{
  id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
  whatsapp: "60123456789", ...extra,
}] });
const buttons = (root) => all(root).filter((n) => n.tagName === "BUTTON").map((n) => n.textContent);
const press = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent === text)._listeners.click[0]();

test("a bypassed order's Paid step wears an X, in its own place", () => {
  const root = createEl("div");
  renderOrders(root, withOrder({ status: "baking", paidReceived: false }), PARAMS());
  const steps = all(root).filter((n) => String(n.className).includes("oj-step"));
  assert.equal(steps.length, 6, "all six steps stay, so every order's route reads alike");
  const paid = steps.find((s) => s.children[1].children[0].text === "Paid");
  assert.ok(String(paid.className).includes("skipped"), "Paid wears the skipped mark");
  // The glyph is inside the node's mark span: el() appends a text node for it.
  assert.equal(all(paid).find((n) => String(n.className).includes("oj-cross")).children[0].text,
    "✕", "an X, not a tick");
  assert.ok(!String(paid.className).includes("done"), "and it is never green while money is owed");
  assert.equal(steps.filter((s) => String(s.className).includes("now")).length, 1,
    "with exactly one step still flashing");

  // The same order once the money is in: the X becomes the ordinary green tick.
  const paidRoot = createEl("div");
  renderOrders(paidRoot, withOrder({ status: "baking", paidReceived: true, paidMethod: "cash" }), PARAMS());
  const after = all(paidRoot).filter((n) => String(n.className).includes("oj-step"))
    .find((s) => s.children[1].children[0].text === "Paid");
  assert.ok(String(after.className).includes("done"), "a recorded payment turns it green");
  assert.equal(all(after).find((n) => String(n.className).includes("oj-check")).children[0].text,
    "✓", "with the tick it always had");
});

test("Paid · Cash and Paid · TNG stay on at every stage from Paid onwards, until paid", () => {
  for (const status of ["paid", "baking", "ready", "delivered"]) {
    const root = createEl("div");
    renderOrders(root, withOrder({ status, paidReceived: false }), PARAMS());
    assert.ok(buttons(root).includes("Paid · Cash") && buttons(root).includes("Paid · TNG"),
      `the money can be recorded at ${status} — that is when she collects it`);
  }

  // Once it is recorded they go: there is nothing left to press, and the row wears the tag.
  const done = createEl("div");
  renderOrders(done, withOrder({ status: "ready", paidReceived: true, paidMethod: "tng" }), PARAMS());
  assert.ok(!buttons(done).includes("Paid · Cash"), "no buttons on an order that is already paid");
  assert.ok(all(done).some((n) => String(n.className).split(/\s+/).includes("paid-tag")),
    "the row says how it was paid instead");

  // And an order that has not reached the money stage yet is left alone.
  const early = createEl("div");
  renderOrders(early, withOrder({ status: "confirmed", confirmedSent: true }), PARAMS());
  assert.ok(!buttons(early).includes("Paid · Cash"),
    "no Paid buttons before the order is at least on the money stage");
});

test("taking the money at the counter records it where the order already is", () => {
  const state = withOrder({ status: "ready", paidReceived: false });
  const root = createEl("div");
  renderOrders(root, state, PARAMS());
  press(root, "Paid · Cash");

  assert.equal(state.orders[0].status, "ready", "the order stays packed — the money does not move it back");
  assert.equal(state.orders[0].paidReceived, true);
  assert.equal(state.orders[0].paidMethod, "cash");
  assert.ok(state.orders[0].paidAt, "stamped when the money landed, which is the day the Money screen counts");
});

// ── Engine v121/v122 — the product picker's three kinds, in her order ────────
// On the shop, then unavailable, then taken down. Each choice carries the tone
// the picker wears, so the order and the colour come from one decision and
// cannot disagree.
//
// "Unavailable" is ONE bucket on purpose (v122, 18 Sep 2026): an item sold out
// for the day and an item the shop does not sell that day are both active
// products she may still sell from the fridge, so splitting them told her
// nothing. The picker is a guide while she sells, never a gate — and the shop's
// order-by deadline is deliberately not asked, since it stops a stranger
// ordering and says nothing about what she may sell by hand.
const prod = (id, name, extra = {}) => ({ id, name, limit: 12, active: true, recipe: [], unit: "pc", ...extra });

function picker(products, orders = []) {
  return {
    // A Monday — so a Sat & Sun product is off-day for it.
    deliveryDates: [{ id: "d7", date: "2026-09-07" }],
    products, orders, ingredients: [], occasions: [], dayAdjustments: [],
    settings: { cutoff: "18:00", defaultCapacity: 12 },
  };
}
// A day where `id` is fully booked — its whole limit taken in one order.
const booking = (id, qty = 12) => ({ id: `o_${id}`, deliveryDateId: "d7", productId: id, qty, status: "new" });
// Sat & Sun only, the way a weekend-only special is marked on its card.
const WEEKEND = { sellRules: [{ days: [6, 0] }] };

test("the picker reads on-the-shop first, then unavailable, then taken down", () => {
  const state = picker(
    [prod("p3", "Pandan", { active: false }), prod("p2", "Ciabatta"), prod("p1", "Focaccia")],
    [booking("p2")]);

  const opts = productOptions(state, "d7");
  assert.deepEqual(opts.map((o) => [o.label, o.tone, o.group]), [
    ["Focaccia — 12 left", "ok", "On the shop"],
    ["Ciabatta — sold out", "warn", "Unavailable"],
    ["Pandan — 12 left (hidden)", "off", "Taken down"],
  ], "listed in the order she reaches for them, each labelled and sectioned");
});

test("a product the shop does not sell that day is unavailable, named by its sell days", () => {
  const state = picker([prod("p1", "Focaccia"), prod("p2", "Pizza", WEEKEND)]);
  const opts = productOptions(state, "d7");
  assert.deepEqual(opts.map((o) => [o.label, o.tone, o.group]), [
    ["Focaccia — 12 left", "ok", "On the shop"],
    // Mon 7 Sep is not one of Pizza's sell days, so the shop offers none for it
    // — and the label says which days it IS sold instead of a count for a day
    // it was never on.
    ["Pizza — only Sat & Sun", "warn", "Unavailable"],
  ]);
});

test("an off-day product that is also fully booked is not called sold out", () => {
  // Its count for a day it is not sold on means nothing — naming it "sold out"
  // would send her looking for stock that was never on the menu that day.
  const state = picker([prod("p1", "Pizza", WEEKEND)], [booking("p1")]);
  const [o] = productOptions(state, "d7");
  assert.equal(o.tone, "warn");
  assert.equal(o.label, "Pizza — only Sat & Sun", "the sell days are the reason, not the count");
});

test("a product with no sell marks is on the shop every day", () => {
  // The regression this guards: "no marks" means every delivery day, so such a
  // product must never fall into the unavailable bucket.
  const state = picker([prod("p1", "Focaccia")]);
  assert.equal(productOptions(state, "d7")[0].tone, "ok");
});

test("an unknown delivery date falls back to the old behaviour", () => {
  // No date to ask the sell-day rule about, so nothing is called off-day.
  const state = picker([prod("p1", "Focaccia"), prod("p2", "Pizza", WEEKEND)]);
  assert.deepEqual(productOptions(state, "nope").map((o) => o.tone), ["ok", "ok"]);
});

test("taken down outranks sold out — a hidden product sits with the hidden ones", () => {
  const state = picker([prod("p1", "Pandan", { active: false })], [booking("p1")]);
  assert.equal(productOptions(state, "d7")[0].tone, "off",
    "off the menu is off the menu, whatever the day's count says");
});

test("a product with no daily limit is on the shop however many are ordered", () => {
  const state = picker([prod("p1", "Focaccia", { limit: undefined })], [booking("p1", 99)]);
  const [o] = productOptions(state, "d7");
  assert.equal(o.tone, "ok");
  assert.equal(o.label, "Focaccia", "and it has never shown a count");
});

test("a draft is left out of the picker entirely", () => {
  const state = picker([prod("p1", "Focaccia"), prod("p2", "Still baking", { active: false, draft: true })]);
  assert.deepEqual(productOptions(state, "d7").map((o) => o.value), ["p1"]);
});

test("the order she is editing does not count against its own product", () => {
  const state = picker([prod("p1", "Focaccia")], [booking("p1")]);
  assert.equal(productOptions(state, "d7")[0].tone, "warn", "a full day reads sold out");
  assert.equal(productOptions(state, "d7", "o_p1")[0].tone, "ok",
    "but the order being edited gives its own slots back");
});

// ---- the label an order came in on ---------------------------------------
// What she needs to know about the printed card behind an order: which card, what
// it promised, and the two things only this app can check. It states; it never
// takes anything off — the customer's page states the offer and does not apply it
// either, so the amount she quotes back is hers.

const promoOrder = (over = {}) => ({
  id: "o_promo1", groupId: "g_promo1", deliveryDateId: "d7",
  customerName: "Aisyah", whatsapp: "60123456789",
  productId: "p1", productName: "Focaccia", unitPrice: 22, qty: 2,
  promoCode: "MILO", codeKind: "promo", status: "new",
  ...over,
});

function promoState(over = {}) {
  return {
    ...picker([prod("p1", "Focaccia")], over.orders || [promoOrder()]),
    codes: over.codes === undefined ? [{
      code: "MILO", kind: "promo", productName: "Focaccia",
      offer: { type: "pct", value: 10, minSpend: 30, to: "2030-09-30", newOnly: true, cur: "RM" },
    }] : over.codes,
  };
}

function promoBlock(state) {
  const { root } = (() => {
    const r = createEl("div");
    renderOrders(r, state, PARAMS());
    return { root: r };
  })();
  return byClass(root, "promo-block");
}

test("an order that came in on a label says what to take off it", () => {
  const block = promoBlock(promoState());
  assert.ok(block, "the row carries a line about the label");
  assert.equal(block.textContent,
    "🎟 MILO — Focaccia — 10% off · on RM30 and above · new customers only · until 2030-09-30" +
    " — take it off when you confirm.");
});

test("an order with no label on it says nothing about one", () => {
  assert.equal(promoBlock(promoState({ orders: [promoOrder({ promoCode: "", codeKind: "" })] })),
    undefined, "no code, no line");
});

test("a returning customer is warned, because only this app can see that", () => {
  // The whole reason the shop is not allowed to apply the discount: the customer's
  // own page cannot see the order history that answers this.
  const state = promoState({
    orders: [promoOrder()],
  });
  state.orders.push({ ...promoOrder({ id: "o_earlier", groupId: "g_earlier" }) });
  const block = promoBlock(state);
  assert.ok(block.textContent.includes("⚠️ Not a new customer — this offer is for new customers only."));
  assert.equal(byClass(block, "promo-warn") !== undefined, true, "and it is marked as a warning");
});

test("an order under the label's minimum is named with both figures", () => {
  // Both figures through fmtRM, the app's one money formatter, so they read the
  // same way every other amount on this screen does.
  const state = promoState({ orders: [promoOrder({ qty: 1, unitPrice: 22 })] });
  const block = promoBlock(state);
  assert.ok(block.textContent.includes("⚠️ This order is RM 22.00 — under the RM 30.00 minimum."));
});

test("a label whose offer has ended says so, and offers nothing to take off", () => {
  const state = promoState({
    codes: [{
      code: "MILO", kind: "promo", productName: "Focaccia",
      offer: { type: "pct", value: 10, minSpend: 30, to: "2020-01-01", cur: "RM" },
    }],
  });
  const block = promoBlock(state);
  assert.equal(block.textContent,
    "🎟 MILO — Focaccia — 10% off · on RM30 and above · ended — nothing to take off.");
  assert.equal(byClass(block, "promo-warn"), undefined, "no verdict she cannot act on");
});

test("a label she has retired is said out loud, not left blank", () => {
  const state = promoState({
    codes: [{ code: "MILO", kind: "promo", productName: "Focaccia", active: false }],
  });
  assert.equal(promoBlock(state).textContent,
    "🎟 MILO — Focaccia — you retired this code. The order still records it.");
});

test("a label she has deleted is still named, with the kind the order kept", () => {
  // The order carries only the code and its kind, so a shop label can still be
  // called a shop label after the record itself is gone.
  const state = promoState({
    orders: [promoOrder({ promoCode: "PAW1", codeKind: "shop" })],
    codes: [],
  });
  assert.equal(promoBlock(state).textContent,
    "🎟 PAW1 — no longer in your code list (a shop label). The order still records it.");
});

test("a label that never carried an offer says exactly that", () => {
  const state = promoState({ codes: [{ code: "MILO", kind: "plain" }] });
  assert.equal(promoBlock(state).textContent,
    "🎟 MILO — a label with no offer on it.");
});
