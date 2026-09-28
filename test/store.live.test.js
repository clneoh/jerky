// test/store.live.test.js — the storefront's live auto-refresh: while the page
// is on screen it re-checks availability every 30s (or when the tab regains
// focus) and repaints the delivery calendar + product stamps, WITHOUT touching
// what the customer has already typed or chosen.

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
const docListeners = {};
const winListeners = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
  visibilityState: "visible",
  body: createEl("body"),
};
globalThis.window = { open() {}, addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); } };

// Freeze "now" so the calendar dates are deterministic: Tue 1 Sep 2026, 10:00 AM.
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

// Capture the 30s poll instead of letting it keep the process alive.
let intervalCb = null;
globalThis.setInterval = (fn) => { intervalCb = fn; return 1; };
globalThis.clearInterval = () => {};

const { CONFIG } = await import("../store/config.js");
const { rollingWeeks } = await import("../store/calendar.js");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function upcomingDates(cfg) {
  const out = [];
  const now = new Date();
  for (let i = 1; out.length < cfg.upcomingCount && i < 365; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (cfg.deliveryDays.includes(d.getDay())) out.push(d);
  }
  return out;
}
const dates = upcomingDates(CONFIG);
const k = (d) => dateKey(d);

let dayData = [
  { date: k(dates[0]), slots_left: 0 }, // Wed — sold out
  { date: k(dates[1]), slots_left: 2 }, // Fri — open, auto-selected
  { date: k(dates[2]), slots_left: 5 }, // Mon — open
];
let prodData = []; // per-product counts; tests fill it in when they need one
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  fetchCalls++;
  const u = String(url);
  if (u.includes("product_availability")) return { ok: true, json: async () => prodData };
  if (u.includes("storefront_config")) return { ok: true, json: async () => [] };
  return { ok: true, json: async () => dayData };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const { fmtDay } = await import("../store/app.js");

// The calendar as painted: the grid's cells with the weekday headings dropped,
// and the one line under the grid naming the chosen day. The picker draws a
// rolling window that follows today — the week just gone is the first row, this
// week the second — so a day is found by its own place in that window rather
// than by the old "two padding cells in front of the 1st" of a month grid.
const cells = () =>
  registry["dates"].children[0]
    .children.find((c) => c.className === "cal-grid").children
    .filter((c) => !c.className.includes("cal-dow"));
const TODAY = dateKey(new Date());
const cell = (day) => {
  const i = rollingWeeks(TODAY).flat().indexOf(`${TODAY.slice(0, 8)}${String(day).padStart(2, "0")}`);
  assert.ok(i >= 0, `day ${day} is inside the window on screen`);
  return cells()[i];
};
const chosenText = () =>
  registry["dates"].children[0]
    .children.find((c) => c.className === "cal-chosen").children[0].text;
const grid = () =>
  registry["dates"].children[0]
    .children.find((c) => String(c.className).includes("cal-grid"));
const head = () =>
  registry["dates"].children[0].children.find((c) => c.className === "cal-head");
// The arrows sit either side of the title and only exist when there is somewhere to
// go, so "the last child is a nav button" is what "there is a week after this one"
// means — there is no disabled arrow to read instead.
const navArrow = (which) => {
  const kids = head().children;
  const c = which === "next" ? kids.at(-1) : kids[0];
  return c && String(c.className).includes("cal-nav") ? c : null;
};
const title = () => head().children.find((c) => c.className === "cal-title").children[0].text;
// Where today's own cell has ended up: index 9 puts it in the second row of an
// unpaged window, index 2 in the first row of the window one week on.
const todayIndex = () => cells().findIndex((c) => String(c.className).includes("today"));

test("live refresh updates sold-out days but never clears what the customer typed", async () => {
  await settle(); await settle(); await settle(); // boot + first live refresh

  assert.ok(cell(2).className.includes("full"), "Wed stays sold out");
  assert.ok(cell(4).className.includes("avail") && !cell(4).className.includes("full"),
    "Fri is the auto-selected open day");
  assert.ok(cell(4).className.includes("sel"));

  // The customer has started filling the order form…
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("note-input").value = "no onions please";
  const before = cell(4);

  // …then Fri sells out while the page is open. The next poll repaints.
  dayData = [
    { date: k(dates[0]), slots_left: 0 },
    { date: k(dates[1]), slots_left: 0 }, // now sold out too
    { date: k(dates[2]), slots_left: 5 },
  ];
  const callsBefore = fetchCalls;
  await intervalCb();
  await settle(); await settle(); await settle();

  assert.ok(cell(4).className.includes("full"), "Fri now shows sold out after the refresh");
  assert.ok(cell(7).className.includes("sel") && !cell(7).className.includes("full"),
    "selection moves to Mon, the next open day");
  assert.notEqual(cell(4), before, "the sold-out day was repainted");
  assert.ok(fetchCalls > callsBefore, "the poll really did re-check the live data");

  // The form the customer typed into is untouched by any of that.
  assert.equal(document.getElementById("name-input").value, "Aunty Bee");
  assert.equal(document.getElementById("whatsapp-input").value, "60123456789");
  assert.equal(document.getElementById("note-input").value, "no onions please");
});

test("no data change means no repaint — and a hidden tab stops polling", async () => {
  await settle(); await settle(); await settle();

  const before = cell(4);
  const callsBefore = fetchCalls;

  // Identical data on the next poll → nothing rebuilds.
  await intervalCb();
  await settle(); await settle(); await settle();
  assert.equal(cell(4), before, "no DOM churn when nothing changed");

  // Background the tab → the poll no longer fetches.
  document.visibilityState = "hidden";
  const callsHidden = fetchCalls;
  await intervalCb();
  await settle();
  assert.equal(fetchCalls, callsHidden, "no fetch while the tab is hidden");
  document.visibilityState = "visible";
});

test("the calendar draws every posting day and names the chosen one", () => {
  assert.equal(cell(2).children[0].children[0].text, "2");
  assert.equal(cell(4).children[0].children[0].text, "4");
  assert.equal(cell(7).children[0].children[0].text, "7");
  assert.equal(chosenText(), `Your posting day: ${fmtDay(dates[2])}`);
});

test("a refresh that depletes an ordered item fixes the cart, bar and tells the customer", async () => {
  // Earlier tests left Fri sold out — restore a clean state: Fri orderable,
  // no per-product counts yet (so the steppers aren't capped).
  dayData = [
    { date: k(dates[0]), slots_left: 0 },
    { date: k(dates[1]), slots_left: 2 },
    { date: k(dates[2]), slots_left: 5 },
  ];
  prodData = [];
  await intervalCb();
  await settle(); await settle(); await settle();
  cell(4)._listeners.click[0](); // select Fri
  assert.ok(cell(4).className.includes("sel"), "Fri is the selected day");

  const cards = registry["menu"].children;
  // The shim renders text as a child node (el() sets .text, not .textContent);
  // a click updates .textContent. Read whichever source is populated.
  const labelVal = (labelEl) => (labelEl.textContent !== ""
    ? String(labelEl.textContent)
    : (labelEl.children.find((c) => c && c.nodeType === 3) || {}).text ?? "");
  // The photo, when a card has one, is the card's own first column — so the
  // stepper lives in the body, one level in. Found by name rather than by index.
  const bodyOf = (card) => {
    const b = card.children.find((c) => c.className === "card-body");
    assert.ok(b, "the card body");
    return b;
  };
  const qty = (i) => labelVal(bodyOf(cards[i]).children[1].children[1]);
  const clickInc = (i) => bodyOf(cards[i]).children[1].children[2]._listeners.click[0];
  clickInc(0)(); clickInc(0)();        // Focaccia ×2
  clickInc(1)(); clickInc(1)(); clickInc(1)(); // Sandwich ×3
  assert.equal(qty(0), "2");
  assert.equal(qty(1), "3");
  document.getElementById("name-input").value = "Aunty Bee";

  // Next poll: Focaccia sold out, Sandwich down to 1 — more than she asked for
  // on the first, more than is left on the second.
  prodData = [
    { date: k(dates[1]), product: CONFIG.products[0].name, slots_left: 0 },
    { date: k(dates[1]), product: CONFIG.products[1].name, slots_left: 1 },
  ];
  const callsBefore = fetchCalls;
  await intervalCb();
  await settle(); await settle(); await settle();
  assert.ok(fetchCalls > callsBefore, "the poll re-checked the live data");

  const cards2 = registry["menu"].children;
  assert.equal(labelVal(bodyOf(cards2[0]).children[1].children[1]), "0",
    "the sold-out item is removed from the cart");
  assert.equal(labelVal(bodyOf(cards2[1]).children[1].children[1]), "1",
    "a quantity above what's left is clamped down");
  assert.equal(document.getElementById("bar-count").textContent, "1 item",
    "the bar reflects the corrected cart");

  const note = document.getElementById("menu-note");
  assert.equal(note.hidden, false, "a notice tells the customer what changed");
  const text = note.children.map((p) => p.children[0].text).join(" · ");
  assert.ok(text.includes(CONFIG.products[0].name) && text.includes("sold out"),
    "notice names the sold-out item");
  assert.ok(text.includes(CONFIG.products[1].name) && text.includes("only 1"),
    "notice explains the clamped quantity");

  assert.equal(document.getElementById("name-input").value, "Aunty Bee",
    "the typed name survives the fixing refresh");
});

// Last in the file on purpose: it leaves a fourth published date behind.
test("a date beyond the window brings an arrow, and paging slides the week the way it moved", async () => {
  // None of the three dates above reaches past today's own five weeks, so there is
  // nowhere to page. Only a date the baker has published beyond them makes the
  // arrows exist at all — and this is the one place in the suite they are driven.
  const far = "2026-11-02"; // nine whole weeks out
  dayData = [
    { date: k(dates[0]), slots_left: 0 }, // Wed — sold out
    { date: k(dates[1]), slots_left: 2 }, // Fri — open, auto-selected
    { date: k(dates[2]), slots_left: 5 }, // Mon — open
    { date: far, slots_left: 5 },         // far out, past the window
  ];
  await intervalCb();
  await settle(); await settle(); await settle();

  assert.ok(navArrow("next"), "there is an arrow forward: 2 Nov is past this window");
  assert.equal(navArrow("prev"), null, "and none back — nothing is ever on offer behind today");
  assert.equal(grid().dataset.slide, undefined, "a live refresh moves nothing");
  assert.equal(todayIndex(), 9, "today still sits in the second row");
  const opening = title();

  // Forward: the grid arrives from below, and today moves up a row.
  navArrow("next")._listeners.click[0]();
  assert.equal(grid().dataset.slide, "up", "going later, the rows travel up");
  assert.notEqual(title(), opening, "the window has moved a whole week on");
  assert.equal(todayIndex(), 2, "and today has moved up into the top row");
  assert.ok(navArrow("prev"), "now there is a week to come back to as well");

  // Back: the other way, to the window it opened on.
  navArrow("prev")._listeners.click[0]();
  assert.equal(grid().dataset.slide, "down", "coming back, the rows travel down");
  assert.equal(title(), opening, "and the window is the one it opened on");
  assert.equal(todayIndex(), 9);

  // The published date is reachable rather than published and hidden — the promise
  // windowBounds makes, driven to the end. Paging stops when there is nothing
  // further to see, which is the far date's own window.
  let guard = 0;
  while (navArrow("next") && guard++ < 20) navArrow("next")._listeners.click[0]();
  assert.equal(title(), "4 Oct – 7 Nov", "the last window is the one holding 2 Nov");
  assert.equal(cells().filter((c) => String(c.className).includes("avail")).length, 1,
    "and 2 Nov is the only day left to book there — it was never paged past");
  assert.equal(cells().findIndex((c) => String(c.className).includes("avail")), 29,
    "it sits in the bottom row, where the far end of the window puts it");
});
