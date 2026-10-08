// test/receipt-register-view.test.js — the receipt register SCREEN (v366).
//
// ⚠️ WHY A VIEW TEST AND NOT JUST THE PURE ONE. `registerRows` is proven in receipts.test.js;
// what this file proves is the one thing the pure tests cannot reach — **that a register which
// could not be read is never drawn as a register with nothing in it.** On this screen those
// two look identical and mean opposite things, and it is the mistake that would actually
// matter: an empty run reads as "no receipts exist", which is the opposite of true.
//
// The screen is behind the sign-in, so this is the closest anyone gets to opening it here:
// the view is built for real and then walked.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
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
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = {};
// ⚠️ The view navigates with `location.hash` directly (the choice history.js documents), so the
// address has to exist for a press to be provable at all.
globalThis.location = { hash: "" };

// ⚠️ A LIVE SESSION IS SEEDED so the read never tries to log in — a test that let it would
// be measuring the auth flow instead of the register.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
store.set("bakeadmin.supabase",
  JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600000 }));

const { renderReceiptRegister } = await import("../admin/js/views/receipt_register.js");

const state = () => ({
  settings: {
    currency: "RM",
    supabase: { enabled: true, url: "https://proj.supabase.co", anonKey: "anon",
      email: "a@b.c", password: "p" },
  },
  orders: [{ id: "o_c2fda5", groupId: "o_c2fda5", customerName: "Uncle Tan" }],
});

const all = (n) => [n, ...((n && n.children) || []).flatMap(all)];
const txt = (n) => all(n).map((x) => (x.nodeType === 3 ? x.text : "")).join(" ");
const row = (n, code, extra = {}) => ({
  number: n, order_code: code, issued_at: `2026-10-08T0${n}:15:00.000Z`,
  refunded_at: null, ...extra,
});

// The view reads asynchronously; one microtask turn is enough for the stubbed fetch.
const settle = () => new Promise((r) => setTimeout(r, 0));

test("★ a register that could NOT be read says so — it is never drawn as an empty one", async () => {
  const st = state();
  globalThis.fetch = async () => { throw new Error("no signal"); };
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  assert.match(said, /Could not read the receipts/,
    `an unreadable register drew no explanation: "${said.slice(0, 240)}"`);
  // ⚠️ AND IT MUST NOT SAY "none". That is the whole fault this test exists for: a phone that
  // cannot reach Supabase would otherwise tell her she has issued no receipts at all.
  assert.equal(/No receipt has been issued yet/.test(said), false,
    `an unreachable register was drawn as an EMPTY one, which reads as "no receipts exist": "${said.slice(0, 240)}"`);
  assert.match(said, /Nothing has been changed/,
    "the failure does not say whether anything was touched");
});

test("a register that reads empty says THAT, and says what draws the first number", async () => {
  const st = state();
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  assert.match(said, /No receipt has been issued yet/);
  assert.match(said, /Paid · Cash or Paid · TNG/,
    "an empty register does not say what issues the first number, so it reads as broken");
});

test("★ the run is drawn as a column, with the number, the code and the date", async () => {
  const st = state();
  globalThis.fetch = async () => ({ ok: true,
    json: async () => [row(2, "999999"), row(1, "C2FDA5")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  assert.match(said, /#000001/, "the first receipt is not on the screen");
  assert.match(said, /#000002/);
  // ⚠️ `\s+` AROUND THE SEPARATOR, and it is the HELPER's doing rather than the DOM's: `txt`
  // joins every text node with a space, and the name, the " · " and the order link are three
  // nodes (the link is a node of its own so it can be pressed — v381). A browser renders them
  // flush, which is what the eye sees.
  assert.match(said, /Uncle Tan\s+·\s+Order #C2FDA5/,
    `an order that IS on this phone was not named against its receipt: "${said.slice(0, 300)}"`);
  assert.match(said, /Order #999999/, "the second receipt's order code is missing");
  // Oldest first, and the register says why it is safe to print: nothing here changes anything.
  assert.ok(said.indexOf("#000001") < said.indexOf("#000002"), "the run is not drawn in number order");
  assert.match(said, /Nothing on this screen changes anything/,
    "a read-only screen does not say that it is one");
});

test("★ a receipt whose order is gone is shown and MARKED, never dropped", async () => {
  const st = state();
  globalThis.fetch = async () => ({ ok: true, json: async () => [row(1, "C2FDA5"), row(2, "999999")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  assert.match(said, /Order #999999 — not in this phone's orders/,
    "a receipt with no order behind it was not marked");
  // ⚠️ THE NUMBER IS STILL THERE. Dropping the row would hide the very thing she asked to see.
  assert.match(said, /#000002/, "a void receipt's number was left off the screen");
  assert.match(said, /The receipt stands, the money moved, and the number stays spent/,
    "the screen does not say what happens to a receipt whose order was removed");

  // ⚠️⚠️ AND THERE IS NO PRESS ON THAT ROW (v381). The order is not on this phone, so there is
  // nothing to open — and a press that landed on the Orders screen and opened nothing is the
  // very control this screen refused to draw for three versions. One press, on the one row
  // that can be opened; none here.
  const presses = all(root).filter((n) => n.tagName === "A" && String(n.className).includes("ord-open"));
  assert.equal(presses.length, 1, "a press was offered on a row with no order behind it");
  assert.equal(presses[0].textContent, "Order #C2FDA5", "the press is on the wrong row");
});

test("★★ the order number on a receipt OPENS that order (v381)", async () => {
  // Her words: __"can make the order number clickable to bring us to the order so i can admen
  // it, or look at it detail"__. ⚠️ The register told her to retype the code into the Orders
  // screen's own finder; this is that sentence retired.
  const st = state();
  globalThis.fetch = async () => ({ ok: true, json: async () => [row(1, "C2FDA5")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const a = all(root).find((n) => n.tagName === "A" && String(n.className).includes("ord-open"));
  assert.ok(a, "the order number is not pressable — she would still be retyping the code");
  assert.equal(a.attrs.href, "#/orders?order=C2FDA5", "the press does not carry the order's address");
  assert.equal(a.textContent, "Order #C2FDA5", "the press does not read as the order number");
  // ⚠️ A REAL `href`, not only a handler: that is what makes it a link she can long-press or
  // copy, and what makes it survive a reload.
  assert.doesNotMatch(txt(root), /To open one of these orders, search its code/,
    "the screen still tells her to go and search the code herself");

  globalThis.location.hash = "#/more/receipts";
  a._listeners.click[0]({ preventDefault() {} });
  assert.equal(globalThis.location.hash, "#/orders?order=C2FDA5", "pressing it went nowhere");
});

test("a missing number wears a banner of its own, and says it can never be filled in", async () => {
  const st = state();
  globalThis.fetch = async () => ({ ok: true, json: async () => [row(1, "C2FDA5"), row(3, "999999")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  assert.match(said, /1 number missing from the run: #000002/,
    `the gap is not named on the screen: "${said.slice(0, 300)}"`);
  assert.match(said, /cannot be filled in afterwards/,
    "the screen reports the gap without saying what it means");

  // And a clean run does NOT wear the banner — a warning shown where it does not apply is
  // noise, and noise is what makes a real one unreadable.
  globalThis.fetch = async () => ({ ok: true, json: async () => [row(1, "C2FDA5"), row(2, "999999")] });
  const clean = createEl("div");
  renderReceiptRegister(clean, st);
  await settle();
  assert.equal(/missing from the run/.test(txt(clean)), false,
    "a run with no holes still wore the missing-number banner");
});

test("the screen offers no press that could change a number", async () => {
  // ⚠️ A REGISTER YOU CAN EDIT IS NOT A REGISTER. The one guarantee this run exists for is
  // that no number is ever re-used or removed — including by her, by accident.
  const st = state();
  globalThis.fetch = async () => ({ ok: true, json: async () => [row(1, "C2FDA5")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const presses = all(root).filter((n) => n.tagName === "BUTTON").map((n) => txt(n).trim());
  assert.deepEqual(presses, ["Read again"],
    `the register offers a press beyond re-reading it: ${JSON.stringify(presses)}`);
  // ⚠️⚠️ AND THE LINKS ARE COUNTED TOO (v381). This assertion used to look at BUTTONS alone,
  // which made it blind the moment the order numbers became anchors — a control that could
  // touch a number would not have to be a button to break the one guarantee this screen exists
  // for. Every anchor on this page opens an order and can do nothing else.
  const links = all(root).filter((n) => n.tagName === "A");
  // ⚠️⚠️ THE COUNT IS THE POINT OF THIS ASSERTION, NOT A DETAIL. `[].every(...)` is TRUE, so the
  // two `every` checks below would pass over a screen with NO links at all — including one where
  // the doors had quietly vanished. **A bite caught exactly that**: emptying this list broke no
  // test until the count was asserted. One receipt, one door.
  assert.equal(links.length, 1, "the doors on this screen are not one per openable receipt");
  assert.equal(links.every((a) => String(a.className).includes("ord-open")), true,
    `the register carries a link that is not an order door: ${JSON.stringify(links.map((a) => a.attrs.href))}`);
  assert.equal(links.every((a) => /^#\/orders\?order=/.test(String(a.attrs.href))), true,
    "an order number links somewhere other than the order it names");
});
