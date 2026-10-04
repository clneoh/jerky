// test/store.occasions.test.js — how a standard day the bakery marked is drawn on
// the customer's calendar, and the bubble that names it. What the shop publishes
// here is the privacy boundary of the whole feature, so the render side is pinned:
// only the standard days that arrive in CONFIG.occasions may draw anything, and
// nothing draws at all when the list is empty.
//
// The marks are drawn in the bakery's OWN calendar's language, so a day looks the
// same on both sides of the shop: a mark running over several days is a translucent
// band across those days (never a per-day square), and a single-day mark is a solid
// box on its own day. Neither is a class on the day cell — the bands are separate
// absolutely-placed grid children, so the geometry is what these tests inspect.
//
// The name is never listed — the day-by-day caption under the grid was removed — so
// these tests also pin the one route that is left: the name waits in a hidden bubble
// and comes out when the day is tapped.
//
// Its own file because store/app.js renders once, at import: this one hands CONFIG
// its days before that import, where store.avail.test.js renders a calendar with no
// marks at all.
//
// "Now" is frozen at Tue 1 Sep 2026 (as in store.avail.test.js), so the September
// 2026 grid is the one under test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rollingWeeks } from "../store/calendar.js";

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
  // The REAL document has these. A shim without them is not a smaller DOM, it is a
  // different one: the shop registers a visibilitychange listener at start-up (v292),
  // and a missing method is a TypeError at import — every store test dies at once.
  _docListeners: {},
  addEventListener(t, f) { (this._docListeners[t] ||= []).push(f); },
  removeEventListener() {},
};
globalThis.window = { open() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { CONFIG } = await import("../store/config.js");
// Sorted by start date, as the app publishes them. Every shape the drawing has to
// tell apart is here: a single day; a stretch; a stretch that starts in the month
// before this one, whose early days are therefore already past; a single day sitting
// INSIDE a stretch (which must still draw its own box and win the name); and one in a
// month that is not on screen at all, which must draw nothing.
CONFIG.occasions = [
  { label: "Hungry Ghost", from: "2026-08-30", to: "2026-09-02", colour: "grey" },
  { label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
  { label: "School break", from: "2026-09-19", to: "2026-09-27", colour: "orange" },
  { label: "Mid-Autumn", from: "2026-09-25", to: "2026-09-25", colour: "blue" },
  { label: "Christmas", from: "2026-12-25", to: "2026-12-25", colour: "green" },
];

await import("../store/app.js");

const cal = () => registry["dates"].children[0];
const grid = () => cal().children.find((c) => c.className === "cal-grid");
// The day cells only — the day-of-week headings and the occasion bands are their
// own children of the grid.
const cells = () => grid().children.filter((c) => String(c.className).includes("cal-cell"));
const bands = () => grid().children.filter((c) => String(c.className).includes("occ-paper"));
// The picker draws a rolling five-week window that follows today (Tue 1 Sep
// 2026) — the week just gone is the first row, this week the second — so a day
// is found by its own place in that window, not by padding in front of the 1st.
const windowCell = (iso) => rollingWeeks("2026-09-01").flat().indexOf(iso);
const cell = (day) => {
  const i = windowCell(`2026-09-${String(day).padStart(2, "0")}`);
  assert.ok(i >= 0, `${day} Sep is inside the window on screen`);
  return cells()[i];
};
const tipOf = (c) => c.children.find((x) => String(x.className).includes("cal-tip"));
const bandAt = (area) => bands().find((b) => String(b.attrs.style).includes(area));
// Every node under the calendar, so a caption can never hide somewhere unexpected.
function all(node, out = []) {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
}

test("a single day the bakery marked is a wash box in its own colour", () => {
  const c = cell(16);
  assert.ok(c.className.includes("sol"), "Malaysia Day draws the box");
  assert.ok(c.className.includes("occ-red"), "in the colour she gave it");
  assert.ok(c.className.includes("occ-strong"),
    "a one-day mark wears the deepest wash, exactly as a short band does");
  const plain = cell(18);
  assert.ok(!plain.className.includes("sol") && !plain.className.includes("occ-"),
    "a plain day in the same month draws no box");
  assert.equal(c.children[0].children[0].text, "16", "the number is still the cell's first child");
});

test("a mark running over several days is a band, not a square per day", () => {
  // Hungry Ghost is 4 days, but only the 1st and 2nd of September are still to
  // come — the 30th and 31st of August are on screen too and already past — so
  // the band covers columns 3–4 of the row holding 1 Sep.
  const ghost = bandAt("--gr:3;--gc1:3;--gc2:5");
  assert.ok(ghost, "the days still to come are covered by one band");
  assert.ok(ghost.className.includes("occ-grey"), "in the mark's own colour");
  assert.ok(ghost.className.includes("occ-mid"), "4 days is a mid-strength mark");
  // A day the band covers carries no colour class of its own — the band IS the mark.
  // (25 Sep is left out: Mid-Autumn is a single day of its own inside the break, and
  // that day draws its own box — see the test below.)
  for (const day of [1, 2, 20, 26]) {
    assert.ok(!String(cell(day).className).includes("occ-"), `${day} Sep is not tinted per day`);
  }
  for (const day of [14, 18]) {
    assert.ok(!String(cell(day).className).includes("occ-"), `${day} Sep falls outside every mark`);
  }
});

test("a stretch crossing week rows becomes one band per row it touches", () => {
  // 19–27 Sep: Saturday of one row, the whole of the next. The 27th is the Sunday
  // after both, and it falls past the last day of the window, so nothing is drawn
  // for it — a mark can only be painted on days the customer can actually see.
  assert.ok(bandAt("--gr:5;--gc1:7;--gc2:8"), "the 19th closes its row");
  assert.ok(bandAt("--gr:6;--gc1:1;--gc2:8"), "the full week is one unbroken band");
  assert.equal(bands().length, 3, "and nothing else is banded");
  assert.ok(bands().every((b) => String(b.className).includes("occ-orange")
    || String(b.className).includes("occ-grey")), "no mark colour outside the marks she set");
});

test("a mark that is not in the month on screen draws nothing", () => {
  assert.ok(!String(grid().children.map((c) => c.className).join(" ")).includes("occ-green"),
    "December's mark leaves September alone");
  assert.ok(!bands().some((b) => String(b.attrs.style).includes("--gc2:0")),
    "and no empty band is emitted for it");
});

test("a single day inside a stretch still draws its box, and wins the name", () => {
  const c = cell(25);
  assert.ok(c.className.includes("sol") && c.className.includes("occ-blue"),
    "Mid-Autumn draws its own box on the 25th");
  assert.ok(c.className.includes("occ-strong"),
    "the box is deeper than the school break it sits in");
  assert.equal(tipOf(c).children[0].text, "Mid-Autumn",
    "the shorter mark names the day, not the break around it");
  assert.equal(tipOf(cell(20)).children[0].text, "School break",
    "a day of the break alone is named by the break");
});

test("the name is never listed — it waits in a hidden bubble and comes out on a tap", () => {
  const nodes = all(cal());
  assert.equal(nodes.filter((c) => String(c.className).includes("cal-note-label")).length, 0,
    "the Holidays caption is gone");
  assert.equal(nodes.filter((c) => String(c.className).includes("cal-note-item")).length, 0,
    "and no day is listed anywhere else either");

  const c = cell(16);
  const tip = tipOf(c);
  assert.ok(tip, "the marked day carries a bubble");
  assert.equal(tip.children[0].text, "Malaysia Day", "holding the name she loaded");
  assert.equal(tip.hidden, true, "shut until the day is tapped");

  // The tap rebuilds the grid, so the same day has to be read again.
  c._listeners.click[0]();
  const after = cell(16);
  assert.equal(tipOf(after).hidden, false, "the tap opens it");
  assert.equal(tipOf(after).children[0].text, "Malaysia Day");
  assert.equal(tipOf(cell(18)), undefined, "and a plain day still has no bubble");
});
