// test/store.pool.dom.test.js — the storefront's shared-pool UI end to end:
// a value pack is gated on too-near delivery dates (sold out + note), shares a
// cap with its base's singles on a far date, and an order carries the pool
// pieces it consumes. Uses the same DOM shim as store.avail.test.js.
//
// The pack never has a live test product on the real shop, so this file
// publishes one through the same storefront_config the backoffice uses.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
}
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };

// Freeze "now": Tue 1 Sep 2026, 10:00 AM. Delivery days Mon/Wed/Fri, cutoff
// 6pm the day before → Wed 2 Sep is the first open day. The pack's own rule
// needs a date >= today+14; Sep 17 (a published far date) qualifies, Sep 2
// does not.
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

import { CONFIG } from "../store/config.js";

const NEAR = "2026-09-02"; // +1 → packs locked (advance-order note)
const FAR = "2026-09-17";  // +16 → packs orderable, shared pool live

// The backoffice publishes: Focaccia (the base, limit 12), a 4-piece value
// pack sharing that pool, and an unrelated Sandwich. The pack carries its own
// closeDays (14) — under the per-product model that is what makes it an
// advance-order item; a pack left blank would sell on any open date.
const published = {
  products: [
    { name: "Focaccia", price: 15, unit: "loaf" },
    { name: "Sandwich", price: 8, unit: "piece" },
    { name: "Focaccia Family (4 pcs)", price: 54, unit: "box", component: { name: "Focaccia", qty: 4 }, closeDays: 14 },
  ],
};

const dayRows = [
  { date: NEAR, slots_left: 6 },
  { date: FAR, slots_left: 6 },
];
const prodRows = [];
for (const date of [NEAR, FAR]) {
  prodRows.push({ date, product: "Focaccia", slots_left: 12 });
  prodRows.push({ date, product: "Focaccia Family (4 pcs)", slots_left: 3 }); // floor(12÷4)
  prodRows.push({ date, product: "Sandwich", slots_left: 5 });
}

const calls = [];
globalThis.fetch = async (url, opts) => {
  const method = (opts && opts.method) || "GET";
  if (String(url).includes("/rest/v1/incoming_orders") && method === "POST") {
    calls.push(JSON.parse(opts.body)); // storefront posts [{ data: "<json>" }]
    return { ok: true, text: async () => "" };
  }
  if (String(url).includes("product_availability")) return { ok: true, json: async () => prodRows };
  if (String(url).includes("storefront_config")) return { ok: true, json: async () => [{ data: JSON.stringify(published) }] };
  return { ok: true, json: async () => dayRows }; // day-level availability
};

await import("../store/app.js"); // renders the page (reads globalThis.fetch/CONFIG)
assert.equal(dateKeyFor(new Date()), "2026-09-01", "freeze holds");

function dateKeyFor(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Let the initial availability/config fetches settle so the menu repaints with
// the published pack on the near (auto-selected) day.
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 0));

const flush = () => new Promise((r) => setTimeout(r, 0));

function menuCards() {
  return registry["menu"].children;
}
// Card layout: .menu-item > [.card-head > [div > [p.title, p.sub], stamp],
// stepper, (prod-note)]. Titles are the p element; its text node is one deeper.
function titleOf(card) {
  const t = card.children[0].children[0].children[0];
  return t && t.children[0] ? t.children[0].text : "";
}
function cardOf(title) {
  return menuCards().find((c) => titleOf(c) === title);
}
function stampOf(card) {
  const s = card.children[0].children[1];
  return s && s.children[0] ? s.children[0].text : "";
}
function stepperOf(card) { return card.children[1]; }
function qtyOf(card) {
  const label = stepperOf(card).children[1];
  return label.children[0] ? label.children[0].text : label.textContent;
}
function tap(card, which) {
  stepperOf(card).children[which]._listeners.click[0]();
}

test("value pack is gated on a near delivery date and freed on a far one", async () => {
  // Two published dates become the pills; the near day is auto-selected.
  const pills = registry["dates"].children;
  assert.equal(pills.length, 2);

  // Near day: the pack reads Sold out, stepper disabled, with the note under it.
  const nearPack = cardOf("Focaccia Family (4 pcs)");
  assert.ok(nearPack, "pack card is on the menu (advance orders stay visible)");
  assert.equal(stampOf(nearPack), "Sold out");
  assert.equal(stepperOf(nearPack).children[0].disabled, true);
  assert.equal(stepperOf(nearPack).children[2].disabled, true);
  assert.ok(nearPack.children[2] && nearPack.children[2].className.includes("prod-note"),
    "gated pack carries the advance-order note");
  assert.match(nearPack.children[2].children[0].text, /close 14 days before the posting day/i);
  // The base single is unaffected on the same day.
  assert.equal(stampOf(cardOf("Focaccia")), "Only 12 left");

  // Pick the far day (+16): the pack is orderable at floor(12 ÷ 4) = 3.
  const farPill = pills[1];
  farPill._listeners.click[0]({ currentTarget: farPill });
  const farPack = cardOf("Focaccia Family (4 pcs)");
  assert.equal(stampOf(farPack), "Only 3 left");
  assert.equal(stepperOf(farPack).children[2].disabled, false);
  assert.equal(farPack.children.length, 2, "no advance-order note on an allowed date");
});

test("on the far date, packs and singles share one budget in the same cart", () => {
  // Build up to the whole pool in packs: 3 × 4 = 12 pieces.
  const pack = cardOf("Focaccia Family (4 pcs)");
  tap(pack, 2); // +
  assert.equal(qtyOf(cardOf("Focaccia Family (4 pcs)")), "1");
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  // 3 packs take every piece → singles are sold out and disabled.
  const single = cardOf("Focaccia");
  assert.equal(stampOf(single), "Sold out");
  assert.equal(stepperOf(single).children[2].disabled, true);
  // Drop to 2 packs (8 pieces) → 4 single pieces open back up.
  tap(cardOf("Focaccia Family (4 pcs)"), 0); // −
  assert.equal(stampOf(cardOf("Focaccia")), "Only 4 left");
  assert.equal(stepperOf(cardOf("Focaccia")).children[2].disabled, false);
});

test("placing a pack order sends the pool pieces separately from its line", async () => {
  // Far date still selected with 2 packs from the test above. A loose single
  // squeezes the packs: 2 packs + 1 single = 9 pieces, so a 3rd pack (13) is
  // refused by the + cap — the cart can't oversell the pool.
  tap(cardOf("Focaccia"), 2); // single 0 → 1
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  assert.equal(qtyOf(cardOf("Focaccia Family (4 pcs)")), "2",
    "a 3rd pack can't fit next to the single — + is a no-op");

  // Drop the single, then fill the whole pool with packs (3 × 4 = 12): the 4th
  // pack is refused the same way.
  tap(cardOf("Focaccia"), 0); // single 1 → 0
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  tap(cardOf("Focaccia Family (4 pcs)"), 2);
  assert.equal(qtyOf(cardOf("Focaccia Family (4 pcs)")), "3");

  // The inputs are only read at submit time, so nothing has created them yet.
  const waInput = (registry["whatsapp-input"] ||= createEl("input"));
  const nameInput = (registry["name-input"] ||= createEl("input"));
  waInput.value = "60123456789";
  nameInput.value = "Ain";
  (registry["fulfillment"] ||= createEl("div"))._value = "collect"; // pickup — no postal address needed
  registry["order-btn"].onclick();
  await flush();
  await flush();

  assert.equal(calls.length, 1, "one order was placed");
  const payload = JSON.parse(calls[0][0].data);
  assert.deepEqual(payload.lines, [
    { name: "Focaccia Family (4 pcs)", qty: 3, price: 54 },
  ]);
  assert.equal(payload.total, 162, "3 × 54 — pool pieces never add to the total");
  assert.deepEqual(payload.pool, [{ name: "Focaccia", qty: 12 }], "3 packs consume 3 × 4 = 12 base pieces");
});

// Engine v72: the advance-order note is composed from store-lang.js rather than
// baked into pool.js, so a 中文 or BM visitor reads it in their own language —
// including the date, which goes through the already-localized fmtDay. Jerky
// wording ("the posting day"), so this check exists here and not in the bakery.
test("the advance-order note reads in the visitor's own language", async () => {
  // The page reads the chosen language back from storage on every repaint, so
  // the harness needs the storage a browser would have.
  globalThis.localStorage = {
    _v: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  };
  const app = await import("../store/app.js");
  const nearPill = registry["dates"].children[0];
  nearPill._listeners.click[0]({ currentTarget: nearPill }); // back to the gated near day
  const note = () => {
    const c = cardOf("Focaccia Family (4 pcs)");
    return c.children[2] && c.children[2].children[0] ? c.children[2].children[0].text : "";
  };

  assert.match(note(), /close 14 days before the posting day/i);

  app.setLang("zh");
  assert.match(note(), /需在发货日前 14 天下单/, "中文 visitor reads the reason in Chinese");
  assert.ok(!/[A-Za-z]{3,}/.test(note()), "no English word leaks into the Chinese note");

  app.setLang("ms");
  assert.match(note(), /Tempahan ditutup 14 hari sebelum hari pos/, "BM visitor reads it in Bahasa Malaysia");

  app.setLang("en");
  assert.match(note(), /close 14 days before the posting day/i, "English is word for word as it was");
});
