// test/datepicker.test.js — the inline free date field behind the app's order
// date (admin/js/datepicker.js). The screens it serves sit behind the sign-in,
// so these are the rules that would otherwise only be found by tapping: which
// days are tappable, which months the arrows reach, and what the button says.
//
// The delivery-day calendar it used to share this module with moved to the
// Orders screen and is covered by test/orders-cal.test.js.
//
// "Now" is frozen at Tue 1 Sep 2026 so the grid is deterministic, as in
// store.avail.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    _listeners: {},
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
globalThis.document = { createElement: createEl, createTextNode: (s) => ({ nodeType: 3, text: String(s) }) };

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { dateField } = await import("../admin/js/datepicker.js");

// ── reading the widget ───────────────────────────────────────────────────────
const btn = (w) => w.children[0];
const panel = (w) => w.children[1];
const label = (w) => btn(w).children[0].children[0].text;
const toggle = (w) => btn(w)._listeners.click[0]();

function grid(w) {
  const g = panel(w).children.find((c) => c.className === "cal-grid");
  return g.children.filter((c) => !c.className.includes("cal-dow"));
}
// The cell for day N of whichever month is showing: the leading padding cells
// differ per month, so count from the first real day rather than assuming.
function cell(w, day) {
  const g = grid(w);
  return g[g.findIndex((c) => !c.className.includes("blank")) + (day - 1)];
}
const head = (w) => panel(w).children.find((c) => c.className === "cal-head");
const arrows = (w) => [head(w).children[0], head(w).children[2]];
const title = (w) => head(w).children[1].children[0].text;

// ── the free date field ─────────────────────────────────────────────────────
test("a date field offers every day of the month, with a Today shortcut", () => {
  const picked = [];
  const w = dateField("2026-09-10", (iso) => picked.push(iso));
  assert.equal(label(w), "10 Sep 2026", "the button writes the date out in full");
  toggle(w);

  assert.equal(cell(w, 3).tagName, "BUTTON", "any day is tappable — a date field records history too");
  assert.ok(cell(w, 1).className.includes("today"), "today is ringed");

  // September has no day behind us — today is the 1st — so step back a month to
  // see the days that are.
  arrows(w)[0]._listeners.click[0]();
  assert.equal(title(w), "August 2026");
  assert.ok(cell(w, 20).className.includes("past"), "a day already gone is dimmed");
  assert.equal(cell(w, 20).tagName, "BUTTON", "…but still tappable: a past order must be recordable");
  arrows(w)[1]._listeners.click[0]();
  assert.equal(title(w), "September 2026");

  const foot = panel(w).children.find((c) => c.className === "datepick-foot");
  assert.ok(foot, "the field carries the Today shortcut a picker does not need");
  foot.children[0]._listeners.click[0]();
  assert.deepEqual(picked, ["2026-09-01"], "Today hands back today's ISO date");
  assert.equal(label(w), "1 Sep 2026");
});

test("a date field's arrows reach a year either way from today", () => {
  const w = dateField("2026-09-10", () => {});
  toggle(w);
  const [prev, next] = arrows(w);
  assert.equal(prev.disabled, false, "September 2026 is not the earliest month offered");
  assert.equal(next.disabled, false);

  for (let i = 0; i < 12; i++) next._listeners.click[0]();
  assert.equal(title(w), "September 2027", "twelve months forward");
  // Each repaint builds fresh arrows, so the ones to read are the new ones.
  assert.equal(arrows(w)[1].disabled, true, "and that is as far as it goes");
  for (let i = 0; i < 24; i++) arrows(w)[0]._listeners.click[0]();
  assert.equal(title(w), "September 2025", "twelve months back from today");
  assert.equal(arrows(w)[0].disabled, true);
});

test("a date field with nothing chosen opens on today", () => {
  const w = dateField("", () => {});
  assert.equal(label(w), "Choose a date…");
  toggle(w);
  assert.equal(title(w), "September 2026");
});

// A free date field is still a calendar, and she marks her holidays on a calendar:
// what she is recording or setting a date against should sit in front of them.
test("a date field draws the baker's occasion marks when it is given them", () => {
  const occasions = [
    { id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
    { id: "y", label: "School break", from: "2026-09-21", to: "2026-09-30", colour: "blue" },
  ];
  const w = dateField("2026-09-10", () => {}, { occasions });
  toggle(w);

  const day = cell(w, 16);
  assert.ok(day.className.includes("sol"), "a one-day holiday is a wash box on its day");
  assert.ok(day.className.includes("occ-red occ-strong"), "in the mark's own colour and depth");
  assert.equal(cell(w, 15).className.includes("sol"), false, "an unmarked day stays plain");

  const bands = grid(w).filter((c) => c.className.includes("occ-paper"));
  assert.equal(bands.length, 2, "the 10-day mark bands the two week rows it crosses");
  assert.ok(bands.every((b) => b.className.includes("occ-blue occ-mid")));
});

test("a date field with no occasions to hand draws a plain calendar", () => {
  const w = dateField("2026-09-10", () => {});
  toggle(w);
  assert.equal(grid(w).filter((c) => c.className.includes("occ-paper")).length, 0);
  assert.equal(grid(w).filter((c) => c.className.includes("sol")).length, 0);
});

test("tapping the button again folds the calendar without picking anything", () => {
  const picked = [];
  const w = dateField("2026-09-10", (iso) => picked.push(iso));
  toggle(w);
  assert.ok(panel(w).children.length, "open");
  toggle(w);
  assert.equal(panel(w).children.length, 0, "shut");
  assert.deepEqual(picked, [], "nothing was picked");
});
