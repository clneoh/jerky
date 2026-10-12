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

test("★★ a void row can say WHEN it left — and never says by whom (v443)", async () => {
  // ⚠️⚠️ THE QUESTION THE SCREEN COULD ONLY POSE. *"Not in this phone's orders"* is true of an order she
  // removed on purpose, an order a fault swept away, and an order this phone never had — and on
  // 11 Oct 2026 three paid receipts sat like that with nobody able to say which.
  // ⭐ Her own instruction: __"you should say that something entered abt 8am, is deleted later in the
  // afternoon, by me or by the system error itself"__ — **a WINDOW, and both possible removers named,
  // neither chosen.**
  const st = state();                            // holds o_c2fda5 only; the receipt is for another order
  // ⚠️⚠️ THE SAVED COPIES ARE READ THROUGH THE SHARED-DATA SWITCH (`backups.auth` needs `cloud.on`), so a
  // fixture without it makes the press answer "there are no saved copies" — which is exactly the wrong
  // sentence, and how this test caught the view saying it.
  st.settings.cloud = { enabled: true };
  const inCopy = { id: "ord_a1b2d06d27" };       // the number it wore before grouping was #D06D27
  const NEWEST = { id: "s2", kind: "daily", created_at: "2026-10-11T17:30:00.000Z" };  // it is gone by here
  const OLDER = { id: "s1", kind: "daily", created_at: "2026-10-11T08:20:00.000Z" };   // still here
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = [];
    if (u.includes("receipt_numbers")) body = [row(9, "D06D27")];
    else if (u.includes("backup_snapshots") && u.includes("id=eq.s1")) {
      body = [{ data: JSON.stringify({ orders: [inCopy] }), kind: "daily", created_at: OLDER.created_at }];
    } else if (u.includes("backup_snapshots") && u.includes("id=eq.s2")) {
      body = [{ data: JSON.stringify({ orders: [] }), kind: "daily", created_at: NEWEST.created_at }];
    } else if (u.includes("backup_snapshots")) body = [NEWEST, OLDER];
    return { ok: true, json: async () => body };
  };
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();
  assert.match(txt(root), /not in this phone's orders/, "the fixture did not draw a void row");

  const ask = all(root).find((n) => n.tagName === "BUTTON" && /last here/i.test(txt(n)));
  assert.ok(ask, "★ a void row did not offer the question it is the only row able to answer");
  ask._listeners.click[0]();
  for (let i = 0; i < 12; i++) await settle();

  const said = txt(root);
  const { localWhen } = await import("../admin/js/backups.js");
  // ⭐ THE TWO EDGES OF THE WINDOW, each read off the function the screen itself uses — so this asserts
  // the MEANING and not a date format.
  assert.match(said, /Still in your data in the copy saved/,
    `the window's earlier edge is not stated — the row reads: "${said.slice(0, 400)}"`);
  assert.ok(said.includes(localWhen(OLDER.created_at)),
    `★ the copy that still held the order was not named: "${said.slice(0, 300)}"`);
  assert.match(said, /gone from the copy saved/, "the window's later edge is not stated");
  assert.ok(said.includes(localWhen(NEWEST.created_at)),
    `★ the copy that shows it already gone was not named: "${said.slice(0, 300)}"`);
  assert.match(said, /removed between those two/,
    "★ the two edges were given without saying what they bracket");
  // ⚠️⚠️ AND THE CAUSE IS LEFT OPEN. The data cannot tell her removal from the app's own, and a sentence
  // that picked one would be the same fault as reading "this fits" as "this is it" — written into her records.
  assert.match(said, /by you or by the app itself/,
    "★ the row did not name both possible removers");
  assert.doesNotMatch(said, /you removed it|the app removed it|a fault removed/,
    "★ the row chose a cause the data cannot support");
});

test("★★ a voided row still SHOWS, still wears its number, and offers the way back (v448)", async () => {
  // ⚠️⚠️ THE ASSERTION THAT MATTERS IS THE ONE ABOUT THE ROW STILL BEING THERE. Her words: __"can you have
  // me to clear the invoice, or rearrange it"__ — and **the answer is mark, never delete.** A register you
  // can edit is not a register; this one exists because she once removed a paid order and watched `#000001`
  // stay spent. **If a void mark ever made the row disappear, that would be the delete in a different word.**
  const st = state();
  st.voidedReceipts = [{ no: 3, code: "999999", at: "2026-10-12T09:00:00.000Z", reason: "trial order" }];
  globalThis.fetch = async () => ({ ok: true,
    json: async () => [row(1, "C2FDA5"), row(3, "999999")] });
  const root = createEl("div");
  renderReceiptRegister(root, st);
  await settle();

  const said = txt(root);
  // ⚠️ THE SERIAL IS STILL ON THE PAGE — it is never given back and never re-used.
  assert.match(said, /000003/, "★ a voided receipt vanished from the run");
  assert.match(said, /void/i, "the row is not marked as void");
  assert.match(said, /trial order/, "★ her own reason is not on the row she explained it on");
  assert.match(said, /Put it back/, "★ a mark with no way back is a delete wearing a different word");
  // ⚠️ AND THE ROW NO LONGER READS AS A MYSTERY — the count and the sentence both drop it.
  assert.doesNotMatch(said, /1 number above is for an order that is not/,
    "an explained receipt is still being recited as unaccounted for");
  // and the other receipt is untouched
  assert.match(said, /Uncle Tan/, "the void mark disturbed a receipt that is perfectly fine");
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
