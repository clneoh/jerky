// test/referral-clear-view.test.js — the "clear the book" press (v367).
//
// ⚠️ WHY THIS FILE EXISTS AT ALL. The pure rules are proven in referrals.test.js. What this
// proves is that the SCREEN actually wires to them — the lesson from v359, where a test that
// read a node's `type` could never fail, and from the register screen, where a missing import
// is a crash on a screen nobody in this session can open. A press that is never driven is a
// press nobody knows works.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
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
    remove() {},
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

// ⚠️ A REGISTRY, NOT A FRESH NODE PER CALL. The confirm dialog lives in "confirm-layer", and
// a shim that handed back a NEW div every time would let every press look successful while
// the question went nowhere — the fault the strict-shim rule exists for.
const nodes = new Map();
const nodeFor = (id) => {
  if (!nodes.has(id)) nodes.set(id, createEl("div"));
  return nodes.get(id);
};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: nodeFor,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = {};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { renderReferrals } = await import("../admin/js/views/referrals.js");

const all = (n) => [n, ...((n && n.children) || []).flatMap(all)];
const txt = (n) => all(n).map((x) => (x.nodeType === 3 ? x.text : "")).join(" ");
const presses = (n) => all(n).filter((x) => x.tagName === "BUTTON");
const byText = (n, s) => presses(n).find((b) => txt(b).includes(s));

const state = () => ({
  settings: { currency: "RM", referrals: { enabled: true, friendRM: 3, referrerRM: 3, validDays: 90 } },
  products: [{ id: "p1", name: "Focaccia", price: 15 }],
  orders: [],
  credits: [
    // On no order at all — the stale one that put "Apply coupon" on an aged order.
    { id: "c_orphan", holder: "60111111111", amountRM: 3, role: "reward",
      earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "", usedAt: null, orderCode: "ZZZZZZ" },
  ],
});

test("★ the screen is built at all, and the clear press is on it", () => {
  // ⚠️ A MISSING IMPORT IS A CRASH ON A SCREEN NOBODY HERE CAN OPEN. This is that tripwire:
  // if the view stops building, this fails by name rather than on her phone.
  const st = state();
  const root = createEl("div");
  renderReferrals(root, st);
  const said = txt(root);
  assert.match(said, /Bring a friend/, "the screen did not build");
  assert.match(said, /Coupons not on any order/, "the clear card is not on the screen");
  assert.ok(byText(root, "Remove the coupons on no order"), "the clear press is not on the card");
});

test("★★ the press asks first, names the count and the money, and is dressed as danger", () => {
  const st = state();
  const root = createEl("div");
  renderReferrals(root, st);

  const layer = nodeFor("confirm-layer");
  layer.replaceChildren();
  const press = byText(root, "Remove the coupons on no order");
  press._listeners.click[0]();

  assert.equal(layer.hidden, false, "the clear press removed coupons with no question at all");
  const question = txt(layer);
  assert.match(question, /Remove 1 coupon\?/, `the question does not say how many: "${question}"`);
  assert.match(question, /worth RM\s*3\.00/, `the question does not say what it is worth: "${question}"`);
  assert.match(question, /no longer have it honoured/, "the question does not say what a customer loses");
  assert.match(question, /cannot be undone from here/, "the question does not say it is final");
  assert.ok(presses(layer).some((b) => b.className.includes("danger")),
    "an irreversible press was not dressed as one");

  // Cancel changes nothing.
  byText(layer, "Cancel")._listeners.click[0]();
  assert.equal(st.credits.length, 1, "cancelling the clear removed a coupon anyway");
});

test("★★ the yes press removes the orphan and leaves the order's coupon alone", () => {
  const st = state();
  // And one that IS coming off an order.
  st.orders = [{
    id: "oaaaa01", groupId: "gaaaa01", customerName: "Aisyah", whatsapp: "60123456789",
    productId: "p1", qty: 1, status: "new", createdAt: "2026-09-01T08:00:00.000Z",
  }];
  st.credits.push({
    id: "c_on_order", holder: "60123456789", amountRM: 3, role: "friendOff",
    earnedAt: "2026-09-01T00:00:00.000Z", expiresAt: "", usedAt: null, orderCode: "AAAA01",
  });

  const root = createEl("div");
  renderReferrals(root, st);
  const layer = nodeFor("confirm-layer");
  layer.replaceChildren();
  byText(root, "Remove the coupons on no order")._listeners.click[0]();
  byText(layer, "Remove them")._listeners.click[0]();

  assert.equal(st.credits.length, 1, `the wrong number of coupons went: ${JSON.stringify(st.credits)}`);
  assert.equal(st.credits[0].id, "c_on_order", "the coupon that IS on an order was removed");
});

test("with nothing to clear the press is quiet and says so rather than asking", () => {
  const st = state();
  st.credits = [];
  const root = createEl("div");
  renderReferrals(root, st);
  assert.match(txt(root), /Nothing to clear/, "an empty book does not say it is empty");
  const layer = nodeFor("confirm-layer");
  layer.replaceChildren();
  byText(root, "Remove the coupons on no order")._listeners.click[0]();
  assert.equal(/Remove \d+ coupon/.test(txt(layer)), false,
    "an empty book still offered to remove coupons");
});
