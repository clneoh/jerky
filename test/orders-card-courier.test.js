// test/orders-card-courier.test.js — v237: a courier order can be taken, priced and
// charged in ONE pass through the ＋ New order card.
//
// Until this version the card could not record a courier charge, a tracking number or a
// parcel carrier at all: those four things lived only in the Edit pop-up, so every courier
// order had to be added and then found and reopened. The card now carries them, and the
// whole point is that it writes them AFTER the order exists.
//
// WHERE THE DANGER IS. writeCourierCharge keys the Delivery & fuel expense on the order's
// own code, and orderCode() answers a DRAFT with the literal "??????" — a string that gets
// past applyCourierCharge's `!!code` guard. A charge written while the card is still a
// draft therefore orphans an expense row that no order will ever point at, and the money
// sits in her books attached to nothing. The first test below is that trap, and its
// counterfactual is asserted rather than assumed.
//
// Everything is driven through renderOrders and the real modules: the screens sit behind
// the sign-in, and this is as close as anything gets to her thumb. "Now" is frozen at
// Thu 10 Sep 2026.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, parentNode: null, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { return this.append(c); },
    append(...cs) {
      for (const c of cs) {
        const n = c && c.nodeType ? c : { nodeType: 3, text: String(c) };
        this.children.push(n);
        if (n.nodeType === 1) n.parentNode = this;
      }
    },
    // Faithful on purpose, the rule test/no-null-text.test.js carries: the real
    // replaceChildren has NO null filter — `el()` does, a DOM method does not — and
    // stringifies every argument, so a bare `?: null` left in a list prints the word
    // "null" on the screen. A shim that dropped it would render a card with the defect
    // already removed, and the "no stray null" assertion below would pass over anything.
    replaceChildren(...cs) {
      for (const old of this.children) if (old && old.nodeType === 1) old.parentNode = null;
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) if (c.nodeType === 1) c.parentNode = this;
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  // A node is connected exactly when walking up from it reaches the page. The quote
  // section asks its own node this before writing a slow reply into it.
  Object.defineProperty(node, "isConnected", {
    get() {
      let n = this;
      while (n) { if (n.__root) return true; n = n.parentNode; }
      return false;
    },
  });
  return node;
}
const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= Object.assign(createEl("div"), { __root: true })),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
};
globalThis.document.body.__root = true;
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };

// The phone's storage, so save() writes somewhere real rather than into its own catch.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0); // Thu 10 Sep 2026
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");
const { orderCode } = await import("../admin/js/state.js");

const CARRIER = { id: "pc1", name: "J&T Express" };

function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    parcelCouriers: [CARRIER],
    orders: [],
    ingredients: [],
    occasions: [],
    expenses: [],
    customers: [],
    // No supabase config on purpose: every sync path stays asleep, so nothing here
    // schedules a timer or reaches for a wire.
    settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM" },
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
// The class TOKEN, not a substring: an `.add-item` row wraps an `.add-item-ctl` control
// strip, and `includes` would hand back the strip when a test asks for the row.
const rowsOf = (root, token) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(token));
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));
const type = (box, text) => {
  box.value = text;
  (box._listeners.input || []).forEach((f) => f.call(box));
};
const choose = (sel, value) => {
  sel.value = value;
  (sel._listeners.change || []).forEach((f) => f.call(sel));
};
// The last toast is the one on screen: the shim's querySelector finds none, so toast()
// builds a fresh node each time and appends it to the body.
const lastToast = () => {
  const t = document.body.children.filter((n) => String(n.className).includes("toast")).pop();
  return t ? t.textContent : "";
};

const selWith = (root, label) => all(root).find((n) => n.tagName === "SELECT"
  && (n.children || []).some((o) => o.tagName === "OPTION" && o.textContent === label));

// ── her way in ─────────────────────────────────────────────────────────────
//
// The card, opened; Fulfillment switched to Courier delivery, which is what unfolds the
// address, the tracking number, the parcel, the charge and the price block; one item
// picked and priced. Every test starts here, so every test starts where she does.

function openCard(st) {
  const root = Object.assign(createEl("div"), { __root: true });
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  return root;
}

function pickCourier(root) {
  choose(selWith(root, "Post (nationwide)"), "courier");
  return root;
}

function pickProduct(root, qty = 1) {
  const row = rowsOf(root, "add-item")[0];
  choose(all(row).find((n) => n.tagName === "SELECT"), "p1");
  const stepper = all(byClass(root, "add-item")).find((n) => String(n.className).includes("stepper"));
  for (let i = 1; i < qty; i += 1) tap(stepper.children[2]);
  return root;
}

function chargeBox(root) {
  return all(root).find((n) => n.attrs && n.attrs["aria-label"] === "Courier charge");
}
const trackingBox = (root) =>
  all(root).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === "e.g. JT123456789");
const carrierSel = (root) => selWith(root, "J&T Express");
const addOrder = (root) => tap(buttonByText(root, "Add order"));

// ── the trap ───────────────────────────────────────────────────────────────

test("a charge taken on the card lands on the DELIVERY she is adding, not on the draft", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 2);
  type(chargeBox(root), "8");
  choose(selWith(root, "I paid it"), "me");

  // The counterfactual, asserted rather than assumed: a draft has no id, and this is
  // exactly the string a charge written one step too early would key its expense on.
  assert.equal(orderCode({}), "??????", "a draft's code is the literal trap this guards");

  addOrder(root);

  assert.equal(st.orders.length, 1, "the order exists");
  assert.equal(st.expenses.length, 1, "and the charge became one Delivery & fuel row");
  const exp = st.expenses[0];
  assert.equal(exp.courierFor, orderCode(st.orders[0]),
    "keyed on the order that now exists");
  assert.notEqual(exp.courierFor, "??????", "never on the draft's placeholder code");
  assert.equal(exp.amount, 8, "for the amount she typed");
  assert.equal(st.orders[0].courierFee, 8, "and the same charge is on the order itself");
  assert.equal(st.orders[0].courierPaidBy, "me", "with who bore it");
});

test("nothing taken yet writes no charge and no expense", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  addOrder(root);
  assert.equal(st.orders.length, 1, "the plain order still goes through");
  assert.equal(st.expenses.length, 0, "a courier order with no charge adds nothing to her books");
  assert.equal("courierFee" in st.orders[0], false, "and carries no empty charge keys");
});

test("a self-collect order never carries a courier charge, whatever the card once held", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  type(chargeBox(root), "8");
  choose(selWith(root, "I paid it"), "me");
  // Switching back to Self collect takes the whole courier half off the card, and with it
  // any charge she had started.
  choose(selWith(root, "Collect (local)"), "collect");
  addOrder(root);

  assert.equal(st.orders.length, 1);
  assert.equal(st.expenses.length, 0, "the charge went with the block she closed");
  assert.equal("courierFee" in st.orders[0], false);
  assert.equal(st.orders[0].fulfillment, "collect");
});

// ── the group twin ─────────────────────────────────────────────────────────

test("two items, one charge, one expense on the order's SHARED code", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 2);
  tap(buttonByText(root, "Add another item"));
  // The new second row is the LAST add-item; pick a product on it too, or it is dropped.
  const rows = rowsOf(root, "add-item");
  assert.equal(rows.length, 2, "the button added a second item row");
  const second = rows[rows.length - 1];
  choose(all(second).find((n) => n.tagName === "SELECT"), "p1");
  type(chargeBox(root), "12");
  choose(selWith(root, "I paid it"), "me");

  addOrder(root);

  assert.equal(st.orders.length, 2, "one customer order, two rows");
  assert.equal(st.orders[0].groupId, st.orders[1].groupId, "sharing one group id");
  assert.equal(st.expenses.length, 1, "ONE expense for the one trip, not one per row");
  assert.equal(st.expenses[0].courierFor, orderCode(st.orders[0]),
    "keyed on the group's shared code");
  assert.equal(st.orders[0].courierFor, undefined, "the charge is not copied onto the row");
});

// ── the refusal happens before anything exists ─────────────────────────────

test("an amount with nobody down as the payer is refused, and leaves no half-written order", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  type(chargeBox(root), "8");
  // The box opens on "The customer paid it" (her ask, 27 Sep 2026). Setting it back to
  // "Not recorded" is the one combination that would lose money in silence: a charge that
  // reads back as nothing, saved with a message saying it had been saved.
  choose(selWith(root, "Not recorded"), "");

  addOrder(root);

  assert.equal(st.orders.length, 0, "nothing was created");
  assert.equal(st.expenses.length, 0, "and nothing reached her books");
  assert.match(lastToast(), /nobody is down as the payer/,
    "and she is told why, in the app's own words for it");
});

// ── the tracking number and the parcel ─────────────────────────────────────

test("a tracking number typed on the card is on the order", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  type(trackingBox(root), "JT123456789");
  addOrder(root);
  assert.equal(st.orders[0].trackingNo, "JT123456789");
  assert.equal(st.orders[0].fulfillment, "courier");
});

test("a parcel carrier recorded on the card freezes its name onto the order", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  choose(carrierSel(root), CARRIER.id);
  addOrder(root);

  assert.equal(st.orders[0].parcel.carrierId, CARRIER.id);
  assert.equal(st.orders[0].parcel.carrierName, "J&T Express",
    "the name is frozen, so renaming the carrier later cannot rewrite what the customer was told");

  // And the freeze is the point: drop the carrier from her list and the order still says
  // who it went with.
  st.parcelCouriers = [];
  assert.equal(st.orders[0].parcel.carrierName, "J&T Express");
});

test("a self-collect order records no parcel", () => {
  const st = state();
  const root = pickProduct(openCard(st), 1);
  addOrder(root);
  assert.equal("parcel" in st.orders[0], false);
});

// ── the block only exists when it should ───────────────────────────────────

test("the courier fields are there for a courier order and gone again the moment it is not", () => {
  const st = state();
  const root = openCard(st);
  pickProduct(root, 1);

  assert.equal(chargeBox(root), undefined, "a self-collect order asks for no courier charge");
  assert.equal(trackingBox(root), undefined, "and no tracking number");

  pickCourier(root);
  assert.ok(chargeBox(root), "choosing Post (nationwide) unfolds the charge box");
  assert.ok(trackingBox(root), "and the tracking number");
  assert.ok(all(root).find((n) => n.tagName === "TEXTAREA"
    && n.attrs.placeholder === "Postal address (for posting)"), "and the address");

  choose(selWith(root, "Collect (local)"), "collect");
  assert.equal(chargeBox(root), undefined, "and switching back folds it all away again");
});

test("switching back to courier REBUILDS the block rather than re-showing a dead one", () => {
  const st = state();
  const root = openCard(st);
  pickCourier(root);
  const first = chargeBox(root);
  choose(selWith(root, "Collect (local)"), "collect");
  pickCourier(root);
  const second = chargeBox(root);
  assert.ok(second, "the block is back");
  assert.notEqual(second, first,
    "a price section built while Fulfillment said self-collect keeps a dead map and dead quotes for life, so the block is built fresh every change");
});

// ── the day line, and the draft under it ───────────────────────────────────

test("the day line keeps what she has typed, and its grid, across the rebuild a day tap causes", () => {
  const st = state();
  const root = openCard(st);
  const body = byClass(root, "fold-body");
  const dayLine = body.children[0].children[1];

  type(all(body).find((n) => n.tagName === "INPUT"
    && n.attrs.placeholder === "Customer name (optional)"), "Aunty Bee");
  pickProduct(root, 3);
  assert.equal(byClass(root, "stepper-val").textContent, "3");

  // Open the grid — the one under the day line, not the month at the top of the screen.
  tap(dayLine.children[0]);
  const panel = dayLine.children[1];
  assert.equal(dayLine.children[0].attrs["aria-expanded"], "true");
  assert.ok(all(panel).some((n) => String(n.className).includes("cal-cell")), "the grid is drawn");

  // Pick the day it is already on: the tap still SWITCHES THE SCREEN, which rebuilds the
  // whole card from the draft.
  const cell = all(panel).find((n) => String(n.className).includes("cal-cell deliv"));
  tap(cell);

  const body2 = byClass(root, "fold-body");
  assert.ok(body2, "the card is still open after the rebuild");
  assert.equal(body2.children[0].children[1].children[0].attrs["aria-expanded"], "false",
    "and the grid has shut rather than springing open under her");
  assert.equal(body2.children[0].children[1].children[1].children.length, 0, "with nothing under it");
  assert.equal(all(body2).find((n) => n.tagName === "INPUT"
    && n.attrs.placeholder === "Customer name (optional)").value, "Aunty Bee",
    "the name she typed survives");
  assert.equal(byClass(root, "stepper-val").textContent, "3",
    "and so do the item rows — a day tap used to wipe them back to one empty line");
});

test("a finished add starts the next order clean", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 2);
  type(chargeBox(root), "8");
  choose(selWith(root, "I paid it"), "me");
  addOrder(root);
  assert.equal(st.orders.length, 1);

  // The screen was rebuilt by the add, so this is a genuinely fresh card.
  const body = byClass(root, "fold-body");
  const qty = byClass(root, "stepper-val");
  if (qty) assert.equal(qty.textContent, "1", "the quantity is back to one");
  assert.equal(chargeBox(root), undefined, "and the courier half is shut again");
  assert.ok(body, "the card itself is still there for the next customer");
});

// ── no bare "null" on the new block ────────────────────────────────────────

test("nothing on the courier block prints the literal word null", () => {
  const st = state();
  const root = pickProduct(pickCourier(openCard(st)), 1);
  // Every control on it, in every state it can be left in — an unfilled carrier list, a
  // charge box that has never been typed in, a price section with nothing quoted.
  const text = all(byClass(root, "fold-body")).map((n) => n.textContent).join(" ");
  assert.ok(!/\bnull\b/.test(text), `a bare null is on the card: ${text.slice(0, 200)}`);
  assert.ok(!/\bundefined\b/.test(text), "and no undefined either");
});
