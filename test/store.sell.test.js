// test/store.sell.test.js — the shop's side of a product's sell days (engine
// v82). A product that is not sold on the chosen delivery day is not on the menu
// at all — no card, no note, nothing to want and not have. The one exception is
// the baker's advance notice: that product IS sold on the day, it only has to be
// ordered earlier, so it stays with its note.
//
// The clock is frozen to Tue 1 Sep 2026, 10:00 (before Wednesday's 6pm cut-off),
// so the three delivery days on offer are Wed 2, Fri 4 and Mon 7 September.

import { test } from "node:test";
import assert from "node:assert/strict";

// DOM shim (same as test/store.avail.test.js) so store/app.js can render at import time.
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
    scrollIntoView(opts) { this.scrolled = opts; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
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

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

// Nothing live is published for these dates, so every delivery day has room and
// the day-level sold-out logic stays out of the way of the sell-day tests.
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { CONFIG } = await import("../store/config.js");
// Focaccia only on Mondays; the Weekend Cake only over 5-6 Sep; the Brownie Box
// needs 5 days' notice; the Sandwich is sold every delivery day.
CONFIG.products = [
  { name: "Focaccia", price: 15, unit: "loaf",
    sellRules: [{ days: [1], from: "2026-09-01", to: "2026-09-30" }] },
  { name: "Sandwich", price: 8, unit: "piece" },
  { name: "Brownie Box", price: 20, unit: "box", closeDays: 5 },
  { name: "Weekend Cake", price: 30, unit: "cake",
    sellRules: [{ days: [], from: "2026-09-05", to: "2026-09-06" }] },
];

const { render } = await import("../store/app.js");

// ── reading what the shop drew ───────────────────────────────────────────────

const settle = async () => { for (let i = 0; i < 6; i++) await null; };

// Elements only: `el()` puts the words in text nodes, and a text node has no
// `children`, so a walk that kept them would break any `.children[0]` read.
function walk(root, out = []) {
  for (const c of root.children || []) {
    if (c.nodeType !== 1) continue;
    out.push(c);
    walk(c, out);
  }
  return out;
}
const menuCards = () => registry["menu"].children;
const titleOf = (card) => {
  const t = walk(card).find((n) => n.className === "card-title");
  return t && t.children[0] ? t.children[0].text : "";
};
const menuNames = () => menuCards().map(titleOf).filter(Boolean);
const cardFor = (name) => menuCards().find((c) => titleOf(c) === name);
const cardNotes = (name) => walk(cardFor(name))
  .filter((n) => (n.className || "").includes("prod-note"))
  .map((n) => n.children[0].text);
// Day N of the September 2026 grid. The 1st is a Tuesday, so two padding cells
// sit in front of it.
function cell(day) {
  const grid = registry["dates"].children[0].children.find((c) => c.className === "cal-grid");
  const cells = grid.children.filter((c) => (c.className || "").includes("cal-cell"));
  const c = cells[2 + (day - 1)];
  assert.ok(c, `the grid holds a cell for ${day} Sep`);
  return c;
}
const tapDay = (day) => cell(day)._listeners.click[0]();
const menuNote = () => registry["menu-note"];

test("a product not sold on the chosen day is not on the menu at all", async () => {
  await settle();

  // Wed 2 Sep is chosen for them: Focaccia is a Monday product, the Weekend Cake
  // is only sold over 5-6 Sep, and the Brownie Box needs 5 days' notice.
  assert.deepEqual(menuNames(), ["Sandwich", "Brownie Box"],
    "only the products sold that day are there — nothing to want and not have");

  const brownie = cardNotes("Brownie Box");
  assert.equal(brownie.length, 1, "the advance-notice note stays: that product IS sold that day");
  assert.match(brownie[0], /5 days before the posting day/);
  assert.match(brownie[0], /later/, "and it says what to do about it");
  assert.deepEqual(cardNotes("Sandwich"), [], "a product with no rules reads plainly");
});

test("choosing a later day brings back the products that sell then", async () => {
  tapDay(7); // Mon 7 Sep
  assert.deepEqual(menuNames(), ["Focaccia", "Sandwich", "Brownie Box"],
    "Monday is a Focaccia day, and the advance notice is satisfied six days out");
  assert.deepEqual(cardNotes("Brownie Box"), [], "the note goes when the notice is met");
});

test("an item already in the basket leaves it when the day changes, and says why", async () => {
  const focaccia = menuCards()[0];
  focaccia.children[1].children[2]._listeners.click[0](); // the +
  assert.equal(registry["bar-count"].textContent, "1 item", "it is in the basket");

  tapDay(2); // back to Wed 2 Sep, when Focaccia is not sold
  assert.deepEqual(menuNames(), ["Sandwich", "Brownie Box"], "it is off the menu");
  assert.equal(registry["bar-count"].textContent, "0 items", "and out of the basket");

  assert.equal(menuNote().hidden, false, "the shop tells the customer rather than silently dropping it");
  const said = walk(menuNote()).map((n) => n.children[0].text).join("");
  assert.match(said, /Focaccia/);
  assert.match(said, /Only available on Mon/, "and says which day it is sold on");
});

// ── the "keep it on the shop" switch (v90) ───────────────────────────────────

test("a product she keeps listed stays on a day it isn't sold, stamped Unavailable", async () => {
  CONFIG.products.find((p) => p.name === "Focaccia").alwaysListed = true;
  render();
  await settle();

  assert.deepEqual(menuNames(), ["Focaccia", "Sandwich", "Brownie Box"],
    "the kept product stays where it would otherwise vanish");
  const card = cardFor("Focaccia");
  const stamp = walk(card).find((n) => (n.className || "").includes("prod-stamp"));
  assert.ok(stamp.className.includes("soldout"), "greyed exactly like a sold-out card");
  assert.equal(stamp.children[0].text, "Unavailable",
    "…but its own word — a day it is never sold is not the same as a day it ran out");
  assert.equal(card.children[1].children[2].disabled, true, "and there is nothing to order");

  const notes = cardNotes("Focaccia");
  assert.equal(notes.length, 2, "the reason, then the date to come back for");
  assert.match(notes[0], /Only available on Mon/, "the sentence the marking card carries");
  assert.equal(notes[1], "Next available: Mon, 7 Sep",
    "nothing is published for these dates, so the date comes with no count");
});

test("switching it off puts the shop back exactly as it was", async () => {
  CONFIG.products.find((p) => p.name === "Focaccia").alwaysListed = false;
  render();
  await settle();

  assert.deepEqual(menuNames(), ["Sandwich", "Brownie Box"],
    "an absent flag is today's behaviour — gone from the menu, no card, no note");
});

test("a kept product that cannot be ordered today keeps its Sold out stamp and gains the date", async () => {
  CONFIG.products.find((p) => p.name === "Brownie Box").alwaysListed = true;
  render();
  await settle();

  const card = cardFor("Brownie Box");
  const stamp = walk(card).find((n) => (n.className || "").includes("prod-stamp"));
  assert.equal(stamp.children[0].text, "Sold out",
    "the switch only ever ADDS — a sold-out stamp stays exactly as it reads today");
  assert.ok(stamp.className.includes("soldout"));

  const notes = cardNotes("Brownie Box");
  assert.equal(notes.length, 2);
  assert.match(notes[0], /5 days before the posting day/, "the notice it already carried");
  assert.match(notes[0], /later/, "…and its advice");
  assert.equal(notes[1], "Next available: Mon, 7 Sep",
    "the one line the switch buys: the next day the notice is met");
});

// ── v99: the line takes the day it names ─────────────────────────────────────
test("tapping Next available orders for that day, and shows the customer where it took them", async () => {
  CONFIG.products.find((p) => p.name === "Focaccia").alwaysListed = true;
  registry["dates"].scrolled = undefined;
  render();
  await settle();

  const chip = walk(cardFor("Focaccia")).find((n) => (n.className || "").includes("prod-next"));
  assert.ok(chip, "the greyed card offers the next date it can be had");
  assert.equal(chip.tagName, "BUTTON", "and the line is a control, not a label");
  assert.equal(chip.children[0].text, "Next available: Mon, 7 Sep");

  chip._listeners.click[0]();
  await settle();

  assert.deepEqual(menuNames(), ["Focaccia", "Sandwich", "Brownie Box"],
    "the tap took the day — Wednesday for Monday — so the product is on the menu now");
  assert.deepEqual(cardNotes("Focaccia"), [],
    "and the card stops telling her to come back later");
  assert.deepEqual(registry["dates"].scrolled, { block: "start", behavior: "smooth" },
    "the calendar above is brought into view, where the chosen day is written out");
});

test("with something in the basket the Next available line is a label, not a control", async () => {
  CONFIG.products.find((p) => p.name === "Focaccia").alwaysListed = true;
  registry["dates"].scrolled = undefined;
  render();
  await settle();

  // Something in the basket for the day already chosen (the Sandwich sells every
  // delivery day, so Wednesday takes it).
  const plus = walk(cardFor("Sandwich")).find((n) => n.tagName === "BUTTON" && n.children[0].text === "+");
  plus._listeners.click[0]();
  await settle();
  assert.equal(registry["bar-count"].textContent, "1 item", "the basket has a day in hand");

  const chip = walk(cardFor("Focaccia")).find((n) => (n.className || "").includes("prod-next"));
  assert.ok(chip.className.includes("off"), "the line says it is not taking a day now");
  assert.equal(registry["menu-note"].hidden, true, "and nothing is said until the customer tries");

  chip._listeners.click[0]();
  await settle();

  assert.equal(registry["menu-note"].hidden, false, "the tap answers rather than staying quiet");
  assert.match(registry["menu-note"].children[0].children[0].text, /Your basket is for Wed, 2 Sep/);
  assert.equal(registry["dates"].scrolled, undefined, "nothing was taken, so nothing moved");
  const chosen = registry["dates"].children[0].children.find((c) => c.className === "cal-chosen");
  assert.match(chosen.children[0].text, /Wed, 2 Sep/, "the day in hand is still the day");
  assert.deepEqual(cardNotes("Focaccia").length, 2, "and the card still offers the date, plainly");
});

test("a day where nothing at all is sold says so instead of showing a blank space", async () => {
  // A shop with nothing that sells on Wednesday. Re-rendered from the top, so
  

// this runs last: it replaces the fixture the tests above were reading.
  CONFIG.products = [
    { name: "Focaccia", price: 15, unit: "loaf",
      sellRules: [{ days: [1], from: "2026-09-01", to: "2026-09-30" }] },
    { name: "Weekend Cake", price: 30, unit: "cake",
      sellRules: [{ days: [], from: "2026-09-05", to: "2026-09-06" }] },
  ];
  render();
  await settle();

  assert.deepEqual(menuNames(), [], "no product is on Wednesday's menu");
  assert.equal(menuCards().length, 1, "one line stands in for the menu");
  assert.match(menuCards()[0].children[0].text, /Nothing is on the menu/);

  tapDay(7); // Monday has the Focaccia, so the shop is not empty after all
  assert.deepEqual(menuNames(), ["Focaccia"]);
});

