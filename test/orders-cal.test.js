// test/orders-cal.test.js — the delivery-day calendar at the top of the Orders
// screen (deliveryCal in admin/js/views/orders.js). It replaced the sideways
// strip of date pills, so what these pin is the vocabulary the strip used to
// carry, now on the shop's rolling window: which days can be opened, what each
// one says about how booked it is, and how far the arrows reach.
//
// Since v243 the grid is five Sun-first weeks that FOLLOW TODAY rather than a
// month, so a cell is addressed by its own date and never by counting along from
// the first of the month — the same position holds a different day every week.
//
// "Now" is frozen at Thu 10 Sep 2026 so the grid is deterministic, as in
// store.avail.test.js and datepicker.test.js. Today's own week is 6–12 Sep, so
// the opening window is Sun 30 Aug – Sat 3 Oct.

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
let view = null; // the caller's own { offset }, paged in place — as the screen holds it
const picked = [];
// `active` is a parameter so a test that moves the day on screen cannot leak it
// into the next one — the day is read at paint time, so it has to be set here.
function build(active = "d7") {
  activeId = active;
  picked.length = 0;
  view = { offset: null }; // unsettled: the calendar opens it on the day on screen
  return deliveryCal({
    state: STATE,
    days: DAY_LIST,
    getActiveId: () => activeId,
    view,
    onPick: (id) => picked.push(id),
    noteMisses: true, // what the Orders screen itself passes
  });
}

const head = (cal) => cal.el.children.find((c) => String(c.className).includes("cal-head"));
const gridEl = (cal) => cal.el.children.find((c) => String(c.className).includes("cal-grid"));
const title = (cal) => head(cal).children[1].children[0].text;
const arrows = (cal) => [head(cal).children[0], head(cal).children[2]];
// The grid holds the weekday header, the 35 day cells, and the occasion bands
// laid over them — so a "cell" is a .cal-cell and nothing else.
const cells = (cal) => gridEl(cal).children.filter((c) => String(c.className).includes("cal-cell"));
const bands = (cal) => gridEl(cal).children.filter((c) => String(c.className).includes("occ-paper"));
const countOf = (c) => (c.children.find((x) => String(x.className) === "cal-count") || {}).children?.[0]?.text;
const fire = (node) => (node._listeners.click || []).forEach((f) => f());
// A cell is asked for by its own DATE, which is the only honest way to address one
// on a grid that rolls — counting along from the first cell would name a different
// day the moment the window moved.
const cellOn = (cal, iso) => cells(cal).find((c) => c.dataset.date === iso);
const dayCell = (cal, d) => cellOn(cal, `2026-09-${String(d).padStart(2, "0")}`);
const datesOn = (cal) => cells(cal).map((c) => c.dataset.date);
const nextWeek = (cal) => fire(arrows(cal)[1]);
const prevWeek = (cal) => fire(arrows(cal)[0]);

test("the grid is five whole weeks following today, and today sits in the second row", () => {
  const cal = build();
  const dates = datesOn(cal);
  assert.equal(dates.length, 35, "five rows of seven");
  assert.ok(dates.every(Boolean), "every cell is a real date — nothing padded, nothing blank");
  assert.equal(dates[0], "2026-08-30", "the top-left cell is the Sunday of the week just gone");
  assert.equal(dates[34], "2026-10-03", "and the window closes three weeks later");
  assert.equal(dates[7], "2026-09-06", "the second row starts on today's own Sunday");
  assert.ok(dates.slice(7, 14).includes("2026-09-10"), "so today is always in the second row");
  assert.equal(dates[6], "2026-09-05", "the row above today is last week, to its Saturday");
});

test("a delivery day is tappable and carries its booking under the number", () => {
  const cal = build();
  assert.equal(title(cal), "30 Aug – 3 Oct", "the title is the span it covers, not a month name");

  const d2 = dayCell(cal, 2);
  assert.equal(d2.tagName, "BUTTON", "a day the bakery delivers opens on a tap");
  assert.ok(d2.className.includes("deliv"), "and is drawn as a delivery day");
  assert.equal(d2.children[0].children[0].text, "2", "the number is still the cell's first child");
  assert.equal(countOf(d2), "3/12", "with how many of the day's places are taken");

  d2._listeners.click[0]();
  assert.deepEqual(picked, ["d2"], "and hands back the delivery date's id, not its date");
});

test("the day on screen is marked, and a day with no order on it is quiet", () => {
  const cal = build();
  assert.ok(dayCell(cal, 7).className.includes("sel"), "the day being looked at is marked");

  const plain = dayCell(cal, 20);
  assert.equal(plain.tagName, "BUTTON", "a day the bakery does not deliver can still be asked about");
  assert.ok(plain.className.includes("off"), "and is drawn quietly");
  assert.equal(countOf(plain), undefined, "with nothing said about it");
  assert.equal(plain.children[0].children[0].text, "20", "though its number is still there");

  // A day already gone has nothing to add to it, so it is asked nothing at all.
  assert.equal(dayCell(cal, 3).tagName, "SPAN", "a past day that is not delivered cannot be tapped");
});

test("a day at capacity says FULL and is still opened", () => {
  const cal = build();
  const d4 = dayCell(cal, 4);
  assert.ok(d4.className.includes("full"), "the day is flagged as full");
  assert.equal(countOf(d4), "FULL");
  assert.equal(d4.tagName, "BUTTON", "a full day must still open — she may raise its limit");
  d4._listeners.click[0]();
  assert.deepEqual(picked, ["d4"]);
});

test("a day already gone is dimmed but still opens, and a closed day is flagged", () => {
  const cal = build();
  const d2 = dayCell(cal, 2);
  assert.ok(d2.className.includes("past"), "a past delivery day is dimmed");
  assert.equal(d2.tagName, "BUTTON", "…and still opens: she backfills and reviews old days");

  const d10 = dayCell(cal, 10);
  assert.ok(d10.className.includes("today"), "today is marked");
  assert.ok(d10.className.includes("closed"), "and its orders have already shut");
  assert.ok(!d10.className.includes("past"), "a day whose orders closed is not also 'past'");
});

test("a day the bakery does not deliver answers the tap: the date, and where to add it", () => {
  const cal = build();
  const noteIn = () => cal.el.children.find((c) => c.className === "cal-miss");

  fire(dayCell(cal, 20)); // Sunday 20 Sep — not one of the bakery's delivery days
  assert.ok(noteIn(), "the calendar answers a tap it cannot act on");
  assert.equal(noteIn().children[0].text,
    "Sun, 20 Sep is not a delivery day. Add it in More → Delivery Dates.");
  assert.deepEqual(picked, [], "nothing is opened — there is no day there to open");

  // A day that IS delivered is what she meant, so the answer to the other tap goes
  // on the tap itself — the grid does not wait for the screen around it to repaint.
  fire(dayCell(cal, 10));
  assert.deepEqual(picked, ["d10"]);
  assert.equal(noteIn(), undefined, "opening a real day takes the note away");
});

test("a marked day off the delivery week names itself AND says why no order goes on it", () => {
  // 15 Sep 2026: she had marked Malaysia Day, tapped it, was told the holiday's
  // name and nothing else — with no way of knowing why no order could go on it.
  STATE.occasions = [{ id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" }];
  const cal = build();

  fire(dayCell(cal, 16));
  const tip = dayCell(cal, 16).children.find((c) => c.className === "cal-tip");
  assert.equal(tip.hidden, false, "the day still says its name");
  assert.equal(tip.children[0].text, "Malaysia Day");
  assert.equal(cal.el.children.find((c) => c.className === "cal-miss").children[0].text,
    "Wed, 16 Sep is not a delivery day. Add it in More → Delivery Dates.",
    "and the calendar says what the name alone left her guessing at");
  STATE.occasions = [];
});

// ── the window itself: where it opens, how far it goes, what a press does ─────

test("it opens on the week of the day on screen, not on today", () => {
  // The day she is working on is the one that must be on screen: an Edit pop-up
  // left on today would show nothing of the order whose day she came to move.
  const cal = build("dN"); // 7 Nov, eight weeks out
  assert.ok(datesOn(cal).includes("2026-11-07"), "the day on screen is on the grid");
  assert.equal(view.offset, 5, "and that is the far end of the days she has set");
  assert.equal(arrows(cal)[1].tagName, "SPAN", "so there is nowhere further forward to go");
});

test("a day already on screen leaves the window exactly where she put it", () => {
  const cal = build();
  nextWeek(cal);
  assert.equal(view.offset, 1, "she paged forward a week");
  assert.ok(datesOn(cal).includes("2026-09-14"), "and that week is in front of her");
  cal.repaint();
  assert.equal(view.offset, 1, "an ordinary repaint does not move the week");
  assert.ok(datesOn(cal).includes("2026-09-14"), "…it is the same week afterwards");
});

test("the arrows slide one week and are GONE at the ends, never greyed", () => {
  const cal = build();
  assert.equal(view.offset, 0, "it opens on today's own week — the earliest day she has set");
  assert.equal(arrows(cal)[0].tagName, "SPAN", "so the back arrow is not drawn at all");
  assert.ok(arrows(cal)[0].className.includes("cal-slot"), "in its place is a plain spacer");
  assert.equal(arrows(cal)[1].tagName, "BUTTON", "November is still ahead, so forward is live");

  nextWeek(cal);
  assert.equal(view.offset, 1, "one press, one week");
  assert.equal(title(cal), "6 Sep – 10 Oct", "and the title follows the window");
  assert.equal(arrows(cal)[0].tagName, "BUTTON", "now there is a week behind her to go back to");

  // Forward to the far end: the last day she has set can always be reached.
  for (let i = 0; i < 4; i++) nextWeek(cal);
  assert.equal(view.offset, 5, "eight weeks out is the last window worth drawing");
  assert.ok(datesOn(cal).includes("2026-11-07"), "the November day is on it");
  assert.equal(countOf(cellOn(cal, "2026-11-07")), "0/12", "and is offered");
  assert.equal(arrows(cal)[1].tagName, "SPAN", "with nothing further forward");

  for (let i = 0; i < 5; i++) prevWeek(cal);
  assert.equal(view.offset, 0, "and back to where it started");
  assert.equal(title(cal), "30 Aug – 3 Oct");
});

test("the new week only animates when an arrow was pressed", () => {
  const cal = build();
  assert.equal(gridEl(cal).dataset.slide, undefined, "the opening grid does not slide in");
  cal.repaint();
  assert.equal(gridEl(cal).dataset.slide, undefined, "nor does an ordinary repaint");

  nextWeek(cal);
  assert.equal(gridEl(cal).dataset.slide, "up", "a forward press brings the week up from below");
  cal.repaint();
  assert.equal(gridEl(cal).dataset.slide, undefined,
    "…and only that one grid carried it: the redraw after is still");

  prevWeek(cal);
  assert.equal(gridEl(cal).dataset.slide, "down", "a back press brings the week down from above");
});

test("a press at an end of the days she has set moves nothing", () => {
  const cal = build("dN");
  assert.equal(view.offset, 5, "at the far end");
  const before = datesOn(cal);
  // There is no arrow to press here, but the guard is what makes that safe rather
  // than the absent button alone: paging past the end must leave the window alone.
  fire(arrows(cal)[1]);
  assert.equal(view.offset, 5, "still the same window");
  assert.deepEqual(datesOn(cal), before, "and the same days on it");
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
  const day = dayCell(cal, 16);
  assert.ok(day.className.includes("off"), "the 16th is not a delivery day");
  assert.ok(day.className.includes("sol"), "and still a wash box on its own day");
  assert.ok(day.className.includes("occ-red occ-strong"), "in the mark's own colour and depth");
  assert.equal(dayCell(cal, 15).className.includes("sol"), false, "an unmarked day stays plain");

  const papers = bands(cal);
  assert.equal(papers.length, 2, "the 10-day mark bands the two week rows it crosses");
  assert.ok(papers.every((b) => String(b.className).includes("occ-blue occ-mid")));
  STATE.occasions = [];
});

test("a repaint marks whichever day is on screen then, not the one it was built with", () => {
  const cal = build();
  assert.ok(dayCell(cal, 7).className.includes("sel"), "the day it was built for");
  activeId = "d2";
  cal.repaint();
  assert.ok(dayCell(cal, 2).className.includes("sel"), "the day asked for at paint time");
  assert.ok(!dayCell(cal, 7).className.includes("sel"), "and the one before it is no longer marked");
});

test("a screen with no delivery days at all still draws today, and offers no arrows", () => {
  const solo = { offset: null }; // a caller of its own — not the module-level view
  const cal = deliveryCal({
    state: { ...STATE, deliveryDates: [], orders: [] },
    days: [],
    getActiveId: () => null,
    view: solo,
    onPick: () => {},
    noteMisses: true,
  });
  assert.equal(solo.offset, 0, "the window it settles on is its own caller's, not another's");
  assert.equal(datesOn(cal).length, 35, "the window is still five whole weeks");
  assert.ok(datesOn(cal).includes("2026-09-10"), "today is still on it");
  assert.equal(arrows(cal)[0].tagName, "SPAN", "with nowhere back");
  assert.equal(arrows(cal)[1].tagName, "SPAN", "and nowhere forward");
  assert.ok(dayCell(cal, 10).className.includes("today"), "and today is still marked");
});
