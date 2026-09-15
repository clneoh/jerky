// test/orders-cal.test.js — the delivery-day calendar at the top of the Orders
// screen (deliveryCal in admin/js/views/orders.js). It replaced the sideways
// strip of date pills, so what these pin is the vocabulary the strip used to
// carry, now on a month grid: which days can be opened, what each one says about
// how booked it is, and how far the arrows reach.
//
// "Now" is frozen at Thu 10 Sep 2026 so the grid is deterministic, as in
// store.avail.test.js and datepicker.test.js.

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
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { deliveryCal } = await import("../admin/js/views/orders.js");

// One limited product (12 a day → every day's capacity is 12) and four delivery
// days: the 2nd, 4th and 7th have gone by, the 10th is today and its orders shut
// at 18:00 yesterday, and the 7th of November is still to come.
const DAY_LIST = [
  { id: "d2", date: "2026-09-02" },
  { id: "d4", date: "2026-09-04" },
  { id: "d7", date: "2026-09-07" },
  { id: "d10", date: "2026-09-10" },
  { id: "dN", date: "2026-11-07" },
];
const STATE = {
  deliveryDates: DAY_LIST,
  products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [] }],
  orders: [
    { id: "o1", deliveryDateId: "d2", productId: "p1", qty: 3 },   // a day with room
    { id: "o2", deliveryDateId: "d4", productId: "p1", qty: 12 },  // a day at capacity
  ],
  ingredients: [],
  occasions: [],
  settings: { cutoff: "18:00", defaultCapacity: 12 },
};

let activeId = "d7";
const picked = [];
function build() {
  picked.length = 0;
  return deliveryCal({
    state: STATE,
    days: DAY_LIST,
    getActiveId: () => activeId,
    month: { year: 2026, month: 8 }, // September 2026; paging mutates this in place
    onPick: (id) => picked.push(id),
    noteMisses: true, // what the Orders screen itself passes
  });
}

const head = (cal) => cal.el.children.find((c) => c.className === "cal-head");
const grid = (cal) => cal.el.children.find((c) => c.className === "cal-grid");
const title = (cal) => head(cal).children[1].children[0].text;
const arrows = (cal) => [head(cal).children[0], head(cal).children[2]];
const cells = (cal) => grid(cal).children.filter((c) => !String(c.className).includes("cal-dow"));
// The cell for day N: the leading padding cells differ per month, so count from
// the first real day rather than assuming how many blanks September has.
function cell(cal, day) {
  const list = cells(cal);
  const first = list.findIndex((c) => !String(c.className).includes("blank"));
  return list[first + (day - 1)];
}
const countOf = (c) => (c.children.find((x) => String(x.className) === "cal-count") || {}).children?.[0]?.text;
const fire = (node) => (node._listeners.click || []).forEach((f) => f());

test("a delivery day is tappable and carries its booking under the number", () => {
  const cal = build();
  assert.equal(title(cal), "September 2026", "it opens on the day on screen's month");

  const d2 = cell(cal, 2);
  assert.equal(d2.tagName, "BUTTON", "a day the bakery delivers opens on a tap");
  assert.ok(d2.className.includes("deliv"), "and is drawn as a delivery day");
  assert.equal(d2.children[0].children[0].text, "2", "the number is still the cell's first child");
  assert.equal(countOf(d2), "3/12", "with how many of the day's places are taken");

  d2._listeners.click[0]();
  assert.deepEqual(picked, ["d2"], "and hands back the delivery date's id, not its date");
});

test("the day on screen is marked, and an ordinary day of the month is quiet", () => {
  const cal = build();
  assert.ok(cell(cal, 7).className.includes("sel"), "the day being looked at is marked");

  const plain = cell(cal, 20);
  assert.equal(plain.tagName, "BUTTON", "a day the bakery does not deliver can still be asked about");
  assert.ok(plain.className.includes("off"), "and is drawn quietly");
  assert.equal(countOf(plain), undefined, "with nothing said about it");
  assert.equal(plain.children[0].children[0].text, "20", "though its number is still there");

  // A day already gone has nothing to add to it, so it is asked nothing at all.
  assert.equal(cell(cal, 3).tagName, "SPAN", "a past day that is not delivered cannot be tapped");
});

test("a day at capacity says FULL and is still opened", () => {
  const cal = build();
  const d4 = cell(cal, 4);
  assert.ok(d4.className.includes("full"), "the day is flagged as full");
  assert.equal(countOf(d4), "FULL");
  assert.equal(d4.tagName, "BUTTON", "a full day must still open — she may raise its limit");
  d4._listeners.click[0]();
  assert.deepEqual(picked, ["d4"]);
});

test("a day already gone is dimmed but still opens, and a closed day is flagged", () => {
  const cal = build();
  const d2 = cell(cal, 2);
  assert.ok(d2.className.includes("past"), "a past delivery day is dimmed");
  assert.equal(d2.tagName, "BUTTON", "…and still opens: she backfills and reviews old days");

  const d10 = cell(cal, 10);
  assert.ok(d10.className.includes("today"), "today is marked");
  assert.ok(d10.className.includes("closed"), "and its orders have already shut");
  assert.ok(!d10.className.includes("past"), "a day whose orders closed is not also 'past'");
});

test("a day the bakery does not deliver answers the tap: the date, and where to add it", () => {
  const cal = build();
  const noteIn = () => cal.el.children.find((c) => c.className === "cal-miss");

  fire(cell(cal, 20)); // Sunday 20 Sep — not one of the bakery's delivery days
  assert.ok(noteIn(), "the calendar answers a tap it cannot act on");
  assert.equal(noteIn().children[0].text,
    "Sun, 20 Sep is not a delivery day. Add it in More → Delivery Dates.");
  assert.deepEqual(picked, [], "nothing is opened — there is no day there to open");

  // A day that IS delivered is what she meant, so the answer to the other tap goes
  // on the tap itself — the grid does not wait for the screen around it to repaint.
  fire(cell(cal, 10));
  assert.deepEqual(picked, ["d10"]);
  assert.equal(noteIn(), undefined, "opening a real day takes the note away");
});

test("a marked day off the delivery week names itself AND says why no order goes on it", () => {
  // 15 Sep 2026: she had marked Malaysia Day, tapped it, was told the holiday's
  // name and nothing else — with no way of knowing why no order could go on it.
  STATE.occasions = [{ id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" }];
  const cal = build();

  fire(cell(cal, 16));
  const tip = cell(cal, 16).children.find((c) => c.className === "cal-tip");
  assert.equal(tip.hidden, false, "the day still says its name");
  assert.equal(tip.children[0].text, "Malaysia Day");
  assert.equal(cal.el.children.find((c) => c.className === "cal-miss").children[0].text,
    "Wed, 16 Sep is not a delivery day. Add it in More → Delivery Dates.",
    "and the calendar says what the name alone left her guessing at");
  STATE.occasions = [];
});

test("the arrows reach only the months the delivery days span", () => {
  const cal = build();
  assert.equal(arrows(cal)[0].disabled, true, "September is the earliest month anything sits in");
  assert.equal(arrows(cal)[1].disabled, false, "November is still ahead");

  arrows(cal)[1]._listeners.click[0]();
  assert.equal(title(cal), "October 2026", "one month forward");
  assert.equal(cell(cal, 3).tagName, "BUTTON",
    "a month with no delivery day opens nothing, but a tap in it is still answered");
  assert.ok(cell(cal, 3).className.includes("off"), "…and every day of it is drawn quietly");
  assert.equal(cell(cal, 3).children[0].children[0].text, "3", "…with its number");

  // Each page builds fresh arrows, so the ones to read are the new ones.
  arrows(cal)[1]._listeners.click[0]();
  assert.equal(title(cal), "November 2026");
  const dN = cell(cal, 7);
  assert.equal(dN.tagName, "BUTTON", "the November day is offered here");
  assert.equal(countOf(dN), "0/12");
  assert.equal(arrows(cal)[1].disabled, true, "and November is the end of the line");

  arrows(cal)[0]._listeners.click[0]();
  arrows(cal)[0]._listeners.click[0]();
  assert.equal(title(cal), "September 2026");
  assert.equal(arrows(cal)[0].disabled, true, "September is the other end");
});

// The marks she made on the Delivery Dates screen are on the calendar she opens
// every morning too — the same two shapes, from the same module (occgrid.js).
test("the baker's occasion marks are drawn on the orders calendar", () => {
  STATE.occasions = [
    { id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
    { id: "y", label: "School break", from: "2026-09-21", to: "2026-09-30", colour: "blue" },
  ];
  const cal = build();

  // The 16th is not one of this state's delivery days, so it is a quiet cell —
  // and it still carries its mark, which is the only way a holiday on a day the
  // bakery does not deliver can be seen at all.
  const day = cell(cal, 16);
  assert.ok(day.className.includes("off"), "the 16th is not a delivery day");
  assert.ok(day.className.includes("sol"), "and still a wash box on its own day");
  assert.ok(day.className.includes("occ-red occ-strong"), "in the mark's own colour and depth");
  assert.equal(cell(cal, 15).className.includes("sol"), false, "an unmarked day stays plain");

  const bands = cells(cal).filter((c) => String(c.className).includes("occ-paper"));
  assert.equal(bands.length, 2, "the 10-day mark bands the two week rows it crosses");
  assert.ok(bands.every((b) => String(b.className).includes("occ-blue occ-mid")));
  STATE.occasions = [];
});

test("a repaint marks whichever day is on screen then, not the one it was built with", () => {
  const cal = build();
  assert.ok(cell(cal, 7).className.includes("sel"), "the day it was built for");
  activeId = "d2";
  cal.repaint();
  assert.ok(cell(cal, 2).className.includes("sel"), "the day asked for at paint time");
  assert.ok(!cell(cal, 7).className.includes("sel"), "and the one before it is no longer marked");
  activeId = "d7"; // leave the module as we found it
});

