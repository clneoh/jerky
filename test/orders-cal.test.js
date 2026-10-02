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
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

// ── the past is ONE grey, the shop's own ─────────────────────────────────────
//
// The baker asked for the store calendar's look on every admin calendar: one
// shade for every day already gone, whether or not the bakery delivers that day.
// The admin grid used to answer that in two ways — .off (a half-transparent
// --muted) for a day she does not deliver and .past (a half-transparent --muted
// too, but at a different opacity) for a day she does — so the past came out in
// two shades side by side in the same row. Now every past day takes `past`, and
// `past` is the shop's flat colour.
//
// v261 put `past` in the right place but left `.off`'s `opacity: .6` standing, and
// opacity multiplies whatever colour the cell finally lands on — so the test below
// it passed while the grid still drew the past in two shades. The baker saw it
// ("the greyed and the non grey contrast is not big") and the browser measurement
// agreed: `.off` + `.past` composited to #ebe6df against `.past`'s own #ded6cd.
// The last test here composites the two rules the way a browser does, which is the
// check the first one could not make.

test("every past day wears `past`, delivered or not; a future quiet day does not", () => {
  const cal = build();

  // 5 Sep is behind us and is not one of the bakery's delivery days. It used to
  // carry only `off`, at a different opacity from the past days around it.
  const quietPast = dayCell(cal, 5);
  assert.ok(quietPast.className.includes("past"), "a past day she does not deliver is `past` too");
  assert.ok(quietPast.className.includes("off"), "…and keeps `off`: it is still not a delivery day");

  // 2 Sep is behind us and IS delivered — it was the only kind that looked right.
  const delivPast = dayCell(cal, 2);
  assert.ok(delivPast.className.includes("past"), "a past delivery day is `past`");
  assert.ok(!delivPast.className.includes("off"), "…and is not a quiet day");

  // 16 Sep is ahead of us and not delivered: the past mark must not leak forward.
  const futureQuiet = dayCell(cal, 16);
  assert.ok(futureQuiet.className.includes("off"), "a future day she does not deliver is `off`");
  assert.ok(!futureQuiet.className.includes("past"), "…and is NOT `past` — nothing ahead of today is");
});

// The colour is read out of each stylesheet rather than repeated here, so the
// admin grid and the shop can never drift to two different greys without this
// failing. Same idiom as the email sender name in test/email-sender-name.test.js.
const ruleBody = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} must exist`);
  const from = at + selector.length;
  return css.slice(css.indexOf("{", from) + 1, css.indexOf("}", from));
};
const colorOf = (body) => (body.match(/color\s*:\s*([^;]+)/) || [])[1]?.trim();

test("the admin past grey IS the shop's past grey, flat, and declared after .off", () => {
  const admin = read("admin/css/app.css");
  const shop = read("store/app.css");

  const shopPast = colorOf(ruleBody(shop, ".cal-cell.past"));
  const adminPast = colorOf(ruleBody(admin, ".cal-cell.past"));
  assert.ok(shopPast, "the shop declares a past colour to copy");
  assert.equal(adminPast, shopPast, "the admin past grey is the shop's own colour, not a lookalike");

  // Flat: the shop fades nothing, and neither may the admin — an opacity here is
  // what made the past read as two greys depending on whether she delivers.
  assert.equal(/opacity\s*:/.test(ruleBody(admin, ".cal-cell.past")), false,
    "the admin past rule carries no opacity — the colour is the whole of it");

  // Both selectors are two classes (0,2,0), so source order alone decides which
  // one a past non-delivery day gets. Below .off is what makes `past` win.
  assert.ok(admin.indexOf(".cal-cell.past {") > admin.indexOf(".cal-cell.off {"),
    "`.cal-cell.past` is declared after `.cal-cell.off`, or a past quiet day keeps the wrong grey");
});

// Compositing, the way a browser does it: the cell's colour comes from whichever
// rule won (`.past`, being declared later at equal specificity), and the cell's
// opacity from whichever rule set one — and `.off` applies to the whole cell, so
// its opacity lands on `.past`'s colour too. Rendered = opacity × colour over the
// card the calendar sits on.
const parseColor = (cssColor) => {
  if (cssColor.startsWith("#")) {
    const h = cssColor.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return (cssColor.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
};
const opacityOf = (body) => {
  const m = body.match(/opacity\s*:\s*([\d.]+)/);
  return m ? Number(m[1]) : 1;
};
const over = (color, alpha, bg) => color.map((c, i) => alpha * c + (1 - alpha) * bg[i]);
const round = (rgb) => rgb.map((c) => Math.round(c));

test("a quiet day is solid, and both kinds of past day land on the same pixel", () => {
  const admin = read("admin/css/app.css");
  const shop = read("store/app.css");

  // The quiet-day rule must not fade the cell at all. This is the assertion v261
  // lacked: `past` carrying no opacity is not enough while the rule it ties with
  // carries one, because opacity multiplies the colour that won.
  const offBody = ruleBody(admin, ".cal-cell.off");
  assert.equal(opacityOf(offBody), 1,
    "`.cal-cell.off` carries no opacity — fading the whole cell is what put the past back into two shades");

  // The card the calendar sits on — `.cal-wrap` paints `--surface`, so that is the
  // colour every composite below is measured over. Read, not assumed.
  const surface = (admin.match(/--surface\s*:\s*([^;]+)/) || [])[1]?.trim();
  assert.ok(surface, "the app declares the surface the calendar sits on");
  const card = parseColor(surface);

  const pastColor = colorOf(ruleBody(admin, ".cal-cell.past"));
  const deliveredPast = round(over(parseColor(pastColor), opacityOf(ruleBody(admin, ".cal-cell.past")), card));
  const quietPast = round(over(parseColor(pastColor), opacityOf(offBody), card));
  assert.deepEqual(quietPast, deliveredPast,
    "a past day she delivers and a past day she does not are the SAME grey on screen");

  // And the shop's own past cell — which carries no opacity either — must agree,
  // or "the shop's grey" is only true of the stylesheet, not of the screen.
  const shopPast = round(over(parseColor(colorOf(ruleBody(shop, ".cal-cell.past"))),
    opacityOf(ruleBody(shop, ".cal-cell.past")), card));
  assert.deepEqual(shopPast, deliveredPast, "the admin past cell paints exactly what the shop's does");
});

// ── how solid a quiet day has to be ──────────────────────────────────────────
//
// Removing the opacity (v262) left the quiet day at flat `--muted`, 3.50:1 against
// the card. That was measurable progress and still not enough to look at: the baker
// asked for it again ("can make the quite day more solid?"), and by then "solid"
// had a number attached, so the ask is written down here as a floor rather than
// left to the eye. The floor is 6:1 — the quiet day is not a whisper any more.
//
// The ceiling matters as much as the floor. A quiet day has to stay clearly lighter
// than a delivery day, or the calendar loses the one distinction it draws in colour;
// and on the product availability calendar the same rule separates "you can sell
// here" (plain --ink) from "you cannot", so letting the quiet grey drift up to ink
// would quietly delete that answer too.
const luminance = (rgb) => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
// The colour may be written as a literal or as a token, and this test is about the
// ratio, not the syntax. Resolving `var(--x)` here means putting the quiet day back
// on --muted fails on the number it should fail on, rather than on a parse error.
const tokenOf = (css, name) => (css.match(new RegExp(`--${name}\\s*:\\s*([^;]+)`)) || [])[1]?.trim();
const resolve = (css, value) => {
  const ref = (value || "").trim().match(/^var\(\s*--([\w-]+)\s*\)$/);
  return ref ? tokenOf(css, ref[1]) || "" : (value || "").trim();
};

test("a quiet day is solidly darker than the paper, and still lighter than a delivery day", () => {
  const admin = read("admin/css/app.css");
  const card = parseColor(tokenOf(admin, "surface"));
  const ink = parseColor(tokenOf(admin, "ink"));

  const offBody = ruleBody(admin, ".cal-cell.off");
  const quiet = round(over(parseColor(resolve(admin, colorOf(offBody))), opacityOf(offBody), card));
  const quietRatio = contrast(quiet, card);
  const deliverRatio = contrast(ink, card);

  assert.ok(quietRatio >= 6,
    `a quiet day is solid against the card (measured ${quietRatio.toFixed(2)}:1) — flat --muted was 3.50:1, which is the value the baker looked at and asked to have made darker`);

  // Strictly lighter than a delivery day, with room to see it: at least a full
  // point of ratio apart, so no future nudge upward can quietly close the gap.
  assert.ok(deliverRatio - quietRatio >= 1,
    `a delivery day still reads as the darker of the two (quiet ${quietRatio.toFixed(2)}:1 vs delivery ${deliverRatio.toFixed(2)}:1)`);
});
