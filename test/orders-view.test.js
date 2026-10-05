// test/orders-view.test.js — the shape of the Orders screen's ＋ New order card
// (admin/js/views/orders.js): it arrives folded, and when it is opened it reads
// the day on one line, then the items, then the customer.
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

test("opened, it reads the day on one line, then the items, then the customer", () => {
  const { root } = build();
  const body = byClass(root, "fold-body");
  const dayIdx = body.children.findIndex((n) => labelOf(n) === "Delivery day");
  const itemsIdx = body.children.findIndex((n) => labelOf(n) === "Items");
  const customerIdx = body.children.findIndex((n) => labelOf(n) === "Customer");
  const addIdx = body.children.findIndex((n) => String(n.className).includes("block"));

  assert.equal(dayIdx, 0, "which day she is adding to comes first");

  // The day is ONE line and its month grid is SHUT until that line is tapped (v237).
  // The card stands on every delivery day, so a full grid in front of the first thing
  // she has to type was mostly a wall of dates she did not need.
  const dayLine = body.children[0].children[1];
  assert.ok(String(dayLine.className).includes("datepick"), "the day is the one-line control");
  const dayBtn = dayLine.children[0];
  assert.match(dayBtn.textContent, /^Delivering /, "and it names the day already chosen");
  assert.equal(dayBtn.attrs["aria-expanded"], "false", "shut at first");
  assert.equal(dayLine.children[1].children.length, 0, "with nothing drawn under it");
  assert.equal(all(body).some((n) => String(n.className).includes("cal-wrap")), false,
    "so the month calendar is not on screen");

  dayBtn._listeners.click[0]();
  assert.equal(dayBtn.attrs["aria-expanded"], "true", "tapping the line unfolds it");
  assert.ok(all(dayLine).some((n) => String(n.className).includes("cal-wrap")),
    "onto the same calendar the top of the screen shows");

  assert.ok(itemsIdx > dayIdx, "what they want comes after the day");
  assert.ok(customerIdx > itemsIdx, "and who ordered it comes after that");
  assert.ok(addIdx > customerIdx, "with Place Order last");
});

test("the card's calendar unfolds on the day the card is on, and re-homes each time", () => {
  // A day a season out. The card's calendar must show the week THAT day is in and
  // not the week today is in — unfolding it has one job, which is to say where this
  // order is going — and it is a different order from the one the screen is on, so
  // the two calendars must settle independently.
  const far = {
    ...STATE,
    deliveryDates: [{ id: "d7", date: "2026-09-07" }, { id: "dF", date: "2026-11-07" }],
  };
  const root = createEl("div");
  renderOrders(root, far, new URLSearchParams({ date: "dF" }));

  const dayLine = byClass(root, "fold-body").children[0].children[1];
  const panel = dayLine.children[1];
  const dayBtn = dayLine.children[0];
  const onPanel = (iso) => all(panel).some((n) => n.dataset && n.dataset.date === iso);
  const arrowIn = (glyph) => all(panel).find((n) => n.tagName === "BUTTON"
    && String(n.className).includes("cal-nav") && n.children[0].text === glyph);

  dayBtn._listeners.click[0]();
  assert.ok(onPanel("2026-11-07"), "unfolded, it shows the day this order is on");
  assert.equal(arrowIn("›"), undefined, "at the far end of the days she has set");

  // Page a week back, then shut and open the fold again.
  arrowIn("‹")._listeners.click[0]();
  assert.equal(onPanel("2026-11-07"), false, "the week behind it does not hold that day");
  dayBtn._listeners.click[0]();
  dayBtn._listeners.click[0]();
  assert.ok(onPanel("2026-11-07"), "and unfolding re-homes it, rather than reopening on that week");

  // Paging the card's own calendar is the card's business: the screen's calendar
  // above it is left exactly where it was.
  const inPanel = all(panel);
  const top = all(root).find((n) => String(n.className).includes("cal-wrap") && !inPanel.includes(n));
  assert.ok(top, "the screen keeps its own calendar above the card");
  assert.ok(all(top).some((n) => n.dataset && n.dataset.date === "2026-11-07"),
    "still showing the day the screen is on, where the card's own paging left it");
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

// ── v268: opening WhatsApp is not sending the message ────────────────────────
// Pressing Send confirmation put the message into WhatsApp's box and, in the same tap,
// marked the order SENT — so the Confirmed step went green, and so did the customer's own
// track card, which reads the same flag (supabase.js confirmed_sent), on a message still
// sitting unsent in that box. The press now records the draft and nothing else, and the
// green comes from a second press she makes on her way back. Her instruction, 1 Oct 2026:
// green only once she says it has gone.
test("Send confirmation drafts the message; I have sent it is what turns it green", () => {
  const state = withOrder({ status: "confirmed", confirmedSent: false });
  const opens = [];
  const realOpen = globalThis.window.open;
  const realLocation = globalThis.location;
  globalThis.window.open = (url) => { opens.push(url); };
  globalThis.location = { origin: "https://munchies.com.my" };
  try {
    const root = createEl("div");
    renderOrders(root, state, PARAMS());
    assert.equal(opens.length, 0, "nothing opens until she presses");
    assert.ok(buttons(root).includes("Send confirmation"), "and the press is offered");

    press(root, "Send confirmation");
    assert.equal(opens.length, 1, "the message opens in WhatsApp");
    assert.match(opens[0], /^https:\/\/wa\.me\/60123456789\?text=/, "addressed to the customer");
    assert.equal("confirmedSent" in state.orders[0] ? state.orders[0].confirmedSent : false, false,
      "and the order is NOT marked sent");
    assert.equal(state.orders[0].confirmedOpened, true, "only that the message has been drafted");

    // The map keeps flashing Confirmed — nothing has gone to the customer yet.
    const drafted = createEl("div");
    renderOrders(drafted, state, PARAMS());
    const waiting = all(drafted).find((n) => String(n.className).includes("oj-step")
      && n.children[1].children[0].text === "Confirmed");
    assert.ok(!String(waiting.className).includes("done"), "Confirmed is still waiting, not green");
    // ... and the row asks for the half of it the app cannot see for itself.
    assert.ok(buttons(drafted).includes("I have sent it"), "so it asks whether the message has gone");

    press(drafted, "I have sent it");
    assert.equal(state.orders[0].confirmedSent, true, "that press is what marks it sent");
    assert.equal("confirmedOpened" in state.orders[0], false, "and the draft mark goes with it");

    const sent = createEl("div");
    renderOrders(sent, state, PARAMS());
    const done = all(sent).find((n) => String(n.className).includes("oj-step")
      && n.children[1].children[0].text === "Confirmed");
    assert.ok(String(done.className).includes("done"), "Confirmed is green now");
    assert.ok(!buttons(sent).includes("I have sent it"), "and it stops asking once it has an answer");
  } finally {
    globalThis.window.open = realOpen;
    if (realLocation === undefined) delete globalThis.location;
    else globalThis.location = realLocation;
  }
});

test("landing on Confirmed again clears the draft, so an old draft is never answered for", () => {
  // An order that was drafted, moved on, and then brought back to Confirmed has its
  // Confirmed step started afresh (setStage) — so a draft mark left behind must not offer
  // "I have sent it" for a message nobody has opened this time round.
  const state = withOrder({ status: "baking", confirmedSent: true });
  state.orders[0].confirmedOpened = true; // drafted during an earlier visit
  const root = createEl("div");
  renderOrders(root, state, PARAMS());

  // The row's own status control, found by its class — the day's status filter is a
  // select too, and carries the same stage names.
  const stSel = all(root).find((n) => n.tagName === "SELECT" && String(n.className).includes("sel-small"));
  assert.ok(stSel, "the row's own status control");
  stSel.value = "confirmed";
  stSel._listeners.change[0]();

  assert.equal(state.orders[0].status, "confirmed", "the order is back on Confirmed");
  assert.equal(state.orders[0].confirmedSent, false, "with the step started again");
  assert.equal("confirmedOpened" in state.orders[0], false, "and the stale draft mark gone with it");

  const again = createEl("div");
  renderOrders(again, state, PARAMS());
  assert.ok(!buttons(again).includes("I have sent it"), "so it is asking for a message to be opened, not answered for");
  assert.ok(buttons(again).includes("Send confirmation"), "and the normal press is what it offers");
});

// ── v270: the code a customer ordered with, read where the order is read ─────
// She reported it the day after v269: "i dont see the promo code fresh10 send over
// to app together with the order". It had been ON the order since v269 — the shop
// stamps it, the app's import keeps it — but nothing ever DREW it, so the one place
// she looks for an order was the one place it did not appear. A code that arrives
// and cannot be read is a code that did not arrive.
const promoCodeOrder = (extra) => ({ ...STATE, orders: [{
  id: "o1", deliveryDateId: "d7", productId: "p1", qty: 1, customerName: "Ain",
  whatsapp: "60123456789", status: "new", source: "storefront", ...extra,
}] });
// The order's OWN row on the delivery day — the row this screen is worked from,
// and the only row that carries `dataset.order`. Found by that marker rather than
// by "anything on the page", so the chip has to be on the row she reads an order
// on and cannot pass by turning up somewhere else on the screen.
const dayRow = (root) => all(root).find((n) => n.dataset && n.dataset.order === "o1");
const promoTags = (n) =>
  all(n).filter((c) => String(c.className).split(/\s+/).includes("promo-tag"));

test("an order placed with a code says WHICH code, on the row she reads it on", () => {
  const root = createEl("div");
  renderOrders(root, promoCodeOrder({ promo: "FRESH10" }), PARAMS());

  const row = dayRow(root);
  assert.ok(row, "the order's own row is on the screen");
  const tags = promoTags(row);
  assert.equal(tags.length, 1, "the code travels onto the row, rather than sitting in her data unseen");
  assert.equal(tags[0].children[0].text, "🎟 FRESH10",
    "and the row names the code itself — she takes the money off by hand, so which code it was is what tells her how much");
});

test("a code is read back in the one spelling the engine recognises it by", () => {
  const root = createEl("div");
  renderOrders(root, promoCodeOrder({ promo: "  fresh10 " }), PARAMS());
  assert.equal(promoTags(dayRow(root))[0].children[0].text, "🎟 FRESH10",
    "however an older record spelled it, the row cannot show two spellings of one code");
});

test("an order with no code shows no chip, so its row is the row this screen always drew", () => {
  for (const extra of [{}, { promo: "" }, { promo: undefined }]) {
    const root = createEl("div");
    renderOrders(root, promoCodeOrder(extra), PARAMS());
    assert.equal(promoTags(dayRow(root)).length, 0,
      `${JSON.stringify(extra)} — a row with nothing to say about a code says nothing`);
  }
});

// ── v277: the order's own money, on the row ──────────────────────────────────
// Her report, 2 Oct 2026, on the v276 receipt: "the format still not as clear as a
// receipt, the money have to align up" — and, asked where, "non at all in the order
// list". The list she works from all day was the one surface an order's total never
// reached, so a row read "×2" and stopped. Every row now ends with its total in one
// right-hand column, in the app's own label-and-figure shape (.info-row / .info-val),
// so a list of orders can be read down the figures the way a column of receipts can.
const moneyRows = (n) =>
  all(n).filter((c) => String(c.className).split(/\s+/).includes("li-money"));

const priced = (extra) => {
  const st = promoCodeOrder(extra);
  st.products = [{ ...STATE.products[0], price: 15 }];
  return st;
};

test("every order row carries its own total, so the money is on the list she works from", () => {
  const root = createEl("div");
  renderOrders(root, priced({}), PARAMS());

  const row = dayRow(root);
  const lines = moneyRows(row);
  assert.equal(lines.length, 1, "one row of money on the order's own row — no more, no fewer");
  const [label, figure] = lines[0].children;
  assert.equal(label.textContent, "Order total", "the words on the left, the same ones every order uses");
  assert.equal(figure.textContent, "RM 15.00",
    "and the figure is the order's own — 1 × RM15, the same sum the receipt in the pop-up prices");
});

test("the money is a line of its OWN, not a chip wedged in beside the qty", () => {
  const root = createEl("div");
  renderOrders(root, priced({ promo: "FRESH10" }), PARAMS());

  const row = dayRow(root);
  const line = moneyRows(row)[0];
  assert.ok(row.children.includes(line),
    "the money row hangs directly off the LIST ITEM, not off .li-right — beside the chips it would sit at whatever x they happened to leave free, and a list of orders would read as a ragged edge instead of a column");
  assert.ok(String(line.className).includes("info-row"),
    "and it is the app's own .info-row, so an order's money on the list, in the pop-ups, on the Money screen and in the Profit statement are all one shape");
  assert.ok(String(line.children[1].className).includes("info-val"),
    "with the figure in the app's own .info-val, which is what right-aligns it");
});

test("an order nobody has priced says nothing, rather than claiming it is worth nothing", () => {
  const st = promoCodeOrder({});
  st.products = [{ ...STATE.products[0], price: undefined }];
  const root = createEl("div");
  renderOrders(root, st, PARAMS());
  assert.equal(moneyRows(dayRow(root)).length, 0,
    "an unpriced order is not an order worth RM 0.00 — the row would be the app inventing a figure");
});

test("the day you tap is the day you get, even if two days share one id", () => {
  // ★ v326. Her report, 5 Oct 2026: "the order calander not able to select
  // 7/10/26 … clicking that date, the date turn red, but the SET day's avaibility
  // not changing to 7/10/26." The cell is drawn from the day's OWN row of the
  // calendar's `byDate` map, so the red mark followed her tap. The panel under it
  // was drawn from `byId`, which answers with the FIRST record holding that id —
  // and when two days share one id, that is a different day. So the screen could
  // disagree with itself, and nothing said so.
  //
  // ⚠️ THE STATE HERE HAS NOT BEEN THROUGH normalize, ON PURPOSE. The load-time
  // repair in state.js (splitSharedDateIds) is the other half of this fix; this
  // test is the half that has to hold the instant she taps, on a screen whose
  // data was loaded before the repair existed.
  const st = {
    ...STATE,
    deliveryDates: [
      { id: "shared", date: "2026-09-07" }, // holds the id; byId answers with this one
      { id: "shared", date: "2026-09-10" }, // the day that could never be opened
      { id: "own", date: "2026-09-07" }, // …which is why 7 Sep's cell is drawn from its own id
    ],
  };
  const root = createEl("div");
  renderOrders(root, st, PARAMS());

  const titleNow = () => (all(root).find((n) => String(n.className).includes("card-title"))
    || { textContent: "(no day card)" }).textContent;

  const cell = all(root).find((n) => n.dataset && n.dataset.date === "2026-09-10"
    && n.tagName === "BUTTON");
  assert.ok(cell, "10 Sep is a delivery day, so its cell is a button");
  (cell._listeners.click || []).forEach((f) => f.call(cell));

  assert.equal(titleNow(), "Thu, 10 Sep 2026",
    "the panel opens the day whose cell she tapped — never the other record holding that id");
  const sel = all(root).filter((n) => String(n.className).includes("cal-cell")
    && String(n.className).includes("sel")).map((n) => n.dataset.date);
  assert.deepEqual(sel, ["2026-09-10"],
    "and the red mark is on that one day, as it was on her screen");
});

test("the day survives the screen rebuilding itself from the address", () => {
  // ★ v327, and it is the half v326 missed. v326 made the TAP carry the day's own
  // date, which is right — but the address it writes carries only the ID, and the
  // screen rebuilds itself from that address whenever the cloud answers, a pull
  // lands, or the app regains focus (app.js's onSyncChanged -> render()). On that
  // rebuild there is no date, only the id, and an id can be shared by two days —
  // so the panel went back to the other one. Nothing flashes: the rebuild happens
  // in a microtask, before the browser paints, so the wrong panel is the ONLY
  // picture she ever sees. That is exactly her recording: the red mark moves and
  // the panel does not, with the panel's pixels unchanged to the byte.
  const st = {
    ...STATE,
    deliveryDates: [
      { id: "shared", date: "2026-09-07" },
      { id: "shared", date: "2026-09-10" },
      { id: "own", date: "2026-09-07" },
    ],
  };
  const root = createEl("div");
  const titleNow = () => (all(root).find((n) => String(n.className).includes("card-title"))
    || { textContent: "(no day card)" }).textContent;

  let address = "";
  globalThis.history = { replaceState: (a, b, url) => { address = url; } };

  renderOrders(root, st, PARAMS());
  const cell = all(root).find((n) => n.dataset && n.dataset.date === "2026-09-10"
    && n.tagName === "BUTTON");
  (cell._listeners.click || []).forEach((f) => f.call(cell));
  assert.equal(titleNow(), "Thu, 10 Sep 2026", "the tap opens the day whose cell she pressed");

  // The address the press wrote, read back the way app.js's router reads it.
  const query = address.split("?")[1] || "";
  renderOrders(root, st, new URLSearchParams(query));
  assert.equal(titleNow(), "Thu, 10 Sep 2026",
    "and a rebuild from that address still shows the day she tapped — the address must carry the day, not only its id");
});

test("a status change does not send the day back", () => {
  // ★ v327. Thirteen places inside views/orders.js re-render the screen with the id
  // they were working on and nothing else — a status change, a save, a day's
  // availability. Each one is a rebuild with an id and no date, so with a shared id
  // the panel would open the other day: the same fault, arriving by a different door
  // and at a moment she would never connect to it. `ordersDayById` is what closes
  // all thirteen at once.
  const st = {
    ...STATE,
    deliveryDates: [
      { id: "shared", date: "2026-09-07" },
      { id: "shared", date: "2026-09-10" },
      { id: "own", date: "2026-09-07" },
    ],
    orders: [
      { id: "o1", deliveryDateId: "shared", deliveryDate: "2026-09-10", productId: "p1",
        qty: 2, customerName: "Uncle Tan", whatsapp: "0162223333", status: "new" },
    ],
  };
  const root = createEl("div");
  const titleNow = () => (all(root).find((n) => String(n.className).includes("card-title"))
    || { textContent: "(no day card)" }).textContent;

  renderOrders(root, st, PARAMS());
  const cell = all(root).find((n) => n.dataset && n.dataset.date === "2026-09-10"
    && n.tagName === "BUTTON");
  (cell._listeners.click || []).forEach((f) => f.call(cell));
  assert.equal(titleNow(), "Thu, 10 Sep 2026", "she is on 10 Sep");

  // The row's own status control — setStage re-renders the whole screen with the id.
  const stSel = all(root).find((n) => n.tagName === "SELECT" && String(n.className).includes("sel-small"));
  assert.ok(stSel, "the order's status control is on the day she opened");
  stSel.value = "confirmed";
  stSel._listeners.change[0]();

  assert.equal(titleNow(), "Thu, 10 Sep 2026",
    "and the screen is still on 10 Sep afterwards — a rebuild must not swap the day out from under her");
});

test("a day that cannot be drawn says so, and does not move the mark", () => {
  // ★ v328. Her fault survived two rounds of fixing from the outside — the red
  // square moved and the panel did not — because the reason was in ONE day's data
  // and nothing on screen ever named it. So the day is now built BEFORE the mark
  // moves: if it cannot be built, the mark stays where it was and the reason takes
  // the day's place. **A red square over another day's panel is the one thing this
  // screen must never show**, and it is exactly what she has been looking at.
  const boom = () => { throw new Error("orders.test: this day's orders cannot be read"); };
  const bad = { id: "o9", deliveryDateId: "d_ten", deliveryDate: "2026-09-10",
    productId: "p1", qty: 2, customerName: "Uncle Tan", whatsapp: "0162223333", status: "confirmed" };
  // ⚠️ THE LEVER MATTERS. It must break ONLY the day it is on: the calendar's own
  // count (`explodeBom`), the inbox and the cloud all read other fields, and a
  // property they read would fail the whole screen instead of one day. `customerName`
  // is read by the order ROW alone, which only that day's panel builds.
  Object.defineProperty(bad, "customerName", { get: boom, enumerable: true, configurable: true });

  const st = {
    ...STATE,
    deliveryDates: [{ id: "d7", date: "2026-09-07" }, { id: "d_ten", date: "2026-09-10" }],
    orders: [bad],
  };
  const root = createEl("div");
  renderOrders(root, st, PARAMS()); // opens on 7 Sep, which is fine
  const text = () => all(root).map((n) => (n.nodeType === 3 ? n.text : n.textContent)).join("");
  assert.ok(text().includes("Mon, 7 Sep 2026"), "the screen opens on its normal day");

  const cell = all(root).find((n) => n.dataset && n.dataset.date === "2026-09-10"
    && n.tagName === "BUTTON");
  assert.ok(cell, "10 Sep is a delivery day");
  (cell._listeners.click || []).forEach((f) => f.call(cell));

  assert.ok(text().includes("This day could not be opened"), "the day says it could not be drawn");
  assert.ok(text().includes("orders.test: this day's orders cannot be read"),
    "and names the reason, so it can be read out instead of guessed at");
  assert.ok(text().includes("Nothing has been changed"), "and says her day is still safe");
  const sel = all(root).filter((n) => String(n.className).includes("cal-cell")
    && String(n.className).includes("sel")).map((n) => n.dataset.date);
  assert.deepEqual(sel, ["2026-09-07"],
    "the red mark did NOT move — a red day sitting over another day's panel is the fault itself");
  assert.equal(st.deliveryDates.length, 2, "and her days are untouched");
});

test("a day whose order was given a bring-a-friend coupon still opens", () => {
  // ★ v329, AND THIS IS THE FAULT ITSELF. `referralBlockEl` used `cur` in the line
  // that names the friend's discount, but `cur` was only declared in the two
  // functions AFTER it — so building the row for an order that carries a
  // bring-a-friend coupon threw `ReferenceError: cur is not defined`. The calendar
  // square had already repainted by then, so the day turned red and the panel under
  // it kept the previous day. Her report, verbatim: "the day like hang".
  //
  // ⚠️ IT IS ONE DAY'S OWN DATA, WHICH IS WHY THREE VERSIONS MISSED IT: every day
  // without a coupon was perfectly fine, and every test fixture was without one.
  const id = "aa11bb22cc33"; // orderCode takes the last 6 hex → 22CC33
  const st = {
    ...STATE,
    deliveryDates: [{ id: "d7", date: "2026-09-07" }, { id: "d10", date: "2026-09-10" }],
    orders: [
      { id, groupId: id, deliveryDateId: "d10", deliveryDate: "2026-09-10", productId: "p1",
        qty: 2, customerName: "Uncle Tan", whatsapp: "0162223333", status: "confirmed" },
    ],
    credits: [{ id: "c1", role: "friendOff", orderCode: "22CC33", holder: "0162223333",
      amountRM: 3, status: "valid", earnedAt: "2026-09-10" }],
    settings: { ...STATE.settings, referrals: { enabled: true, friendRM: 3, referrerRM: 3, days: 90 } },
  };
  const root = createEl("div");
  renderOrders(root, st, PARAMS());
  const text = () => all(root).map((n) => (n.nodeType === 3 ? n.text : n.textContent)).join("");

  const cell = all(root).find((n) => n.dataset && n.dataset.date === "2026-09-10"
    && n.tagName === "BUTTON");
  assert.ok(cell, "10 Sep is a delivery day");
  (cell._listeners.click || []).forEach((f) => f.call(cell));

  assert.equal((all(root).find((n) => String(n.className).includes("card-title"))
    || { textContent: "" }).textContent, "Thu, 10 Sep 2026",
    "the day opens — it must not throw while building the order's row");
  assert.ok(text().includes("Bring-a-friend"), "and the discount names itself on the row");
  assert.ok(text().includes("RM 3.00"), "with its figure");
});
