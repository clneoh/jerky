// test/cal-naming.test.js — a marked day says its own name when it is tapped.
//
// Her ask (14 Sep 2026): "Name it when you tap the day", on "Every calendar in
// the app". A tap names the day in a small bubble above it AND does that day's
// usual job — the rule the customer's shop page has followed since v80, where a
// day can be both orderable and marked. A tap anywhere else puts it away.
//
// Two things worth pinning here beyond the bubble appearing:
//   • on most calendars the tap that names a day is also the tap that rebuilds
//     the calendar it was named on (opening an order, marking a sell day), so the
//     name has to survive that rebuild — that is why it is kept in occgrid.js and
//     not on the screen;
//   • on the Delivery Dates grids, which paint their own cells in place, the
//     bubbles already built into those cells are shown without a repaint, which
//     would drop the ring the same gesture just painted.
//
// "Now" is frozen at Thu 10 Sep 2026 so the grids are deterministic, as in
// orders-cal.test.js and datepicker.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}, click() {},
  };
}

// The document listeners live here, so the "a tap anywhere puts it away" handler
// installed by occgrid.js can be fired the way a real tap would.
const docListeners = {};
// What document.querySelectorAll(".cal-tip") answers with. The harness fills this
// from the nodes it has just built — the shim has no DOM tree to walk.
let tips = [];
const fireDoc = (type, ev) => (docListeners[type] || []).forEach((f) => f(ev || {}));

const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: (sel) => (sel === ".cal-tip" ? tips : []),
  addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
  removeEventListener() {},
  elementFromPoint: () => null,
  body: createEl("body"),
};
globalThis.window = { open() {}, addEventListener() {}, location: { hash: "#/orders" } };
globalThis.location = globalThis.window.location;
globalThis.history = { replaceState() {} };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.fetch = async () => ({ ok: true, json: async () => [], text: async () => "" });

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
const { dateField } = await import("../admin/js/datepicker.js");
const { renderDeliveries } = await import("../admin/js/views/deliveries.js");

// Every node under `root`, depth-first, in document order.
function walk(root, out = []) {
  for (const c of root.children || []) {
    out.push(c);
    walk(c, out);
  }
  return out;
}
const fire = (node) => (node._listeners.click || []).forEach((f) => f());
const tipIn = (cell) => (cell.children || []).find((c) => c.className === "cal-tip");
// The live bubbles, for the document handler to hide (see `tips` above).
const collect = (root) => { tips = walk(root).filter((n) => n.className === "cal-tip"); };
const MALAYSIA_DAY = { id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" };

// ── the Orders screen's delivery calendar ────────────────────────────────────
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
  orders: [],
  ingredients: [],
  occasions: [],
  settings: { cutoff: "18:00", defaultCapacity: 12 },
};

const picked = [];
function build() {
  picked.length = 0;
  return deliveryCal({
    state: STATE,
    days: DAY_LIST,
    getActiveId: () => "d7",
    month: { year: 2026, month: 8 },
    onPick: (id) => picked.push(id),
    noteMisses: true, // what the Orders screen itself passes
  });
}
const grid = (cal) => cal.el.children.find((c) => c.className === "cal-grid");
const cells = (cal) => grid(cal).children.filter((c) => !String(c.className).includes("cal-dow"));
function cell(cal, day) {
  const list = cells(cal);
  const first = list.findIndex((c) => !String(c.className).includes("blank"));
  return list[first + (day - 1)];
}

test("a marked day the bakery does not deliver still says its name when tapped", () => {
  STATE.occasions = [MALAYSIA_DAY];
  const cal = build();

  const day = cell(cal, 16);
  assert.ok(day.className.includes("tippable"), "the marked day can be tapped for its name");
  assert.ok(day.className.includes("off"), "though it is not a day she delivers");
  assert.equal(tipIn(day).children[0].text, "Malaysia Day");
  assert.equal(tipIn(day).hidden, true, "and it says nothing until she asks");
  assert.equal(cell(cal, 15).tagName, "BUTTON",
    "the unmarked day beside it is tappable — the calendar answers that tap with a note, not a name");
  assert.equal(tipIn(cell(cal, 15)), undefined, "but it has no name to give: a name needs a mark");

  fire(day);
  assert.deepEqual(picked, [], "naming a day is not opening it — there is no day there to open");
  assert.equal(tipIn(cell(cal, 16)).hidden, false, "and the name is now showing");
  STATE.occasions = [];
});

test("a delivery day she taps is opened AND named, and the rebuilt calendar keeps the name", () => {
  STATE.occasions = [{ ...MALAYSIA_DAY, from: "2026-09-10", to: "2026-09-10" }];
  const cal = build();

  assert.equal(tipIn(cell(cal, 10)).hidden, true, "nothing named yet");
  fire(cell(cal, 10));
  assert.deepEqual(picked, ["d10"], "the tap still opens the day, exactly as before");

  // Opening a day re-renders the whole screen in the app, so the calendar she is
  // left looking at is a NEW one: it has to draw the name from what it was told.
  cal.repaint();
  assert.equal(tipIn(cell(cal, 10)).hidden, false, "the rebuilt calendar says the name again");
  assert.equal(tipIn(cell(cal, 10)).children[0].text, "Malaysia Day");
  STATE.occasions = [];
});

test("a day that carries two marks takes the name of the shorter one", () => {
  STATE.occasions = [
    { id: "y", label: "School break", from: "2026-09-15", to: "2026-09-17", colour: "blue" },
    MALAYSIA_DAY,
  ];
  const cal = build();

  fire(cell(cal, 16));
  assert.equal(tipIn(cell(cal, 16)).children[0].text, "Malaysia Day",
    "the day's own holiday names it, not the break it sits inside");
  fire(cell(cal, 15));
  assert.equal(tipIn(cell(cal, 15)).children[0].text, "School break",
    "and a day only the break covers takes the break's name");

  // A day already gone is never named — no mark is drawn on a past day either.
  assert.equal(cell(cal, 7).className.includes("tippable"), false);
  STATE.occasions = [];
});

test("one tap anywhere puts the name away, and a repaint does not bring it back", () => {
  STATE.occasions = [MALAYSIA_DAY];
  const cal = build();

  fire(cell(cal, 16));
  assert.equal(tipIn(cell(cal, 16)).hidden, false, "named");
  collect(cal.el);
  fireDoc("pointerdown", {});
  assert.equal(tips[0].hidden, true, "a tap outside hides every bubble showing");
  cal.repaint();
  assert.equal(tipIn(cell(cal, 16)).hidden, true,
    "and the day it was on is forgotten, so a later repaint leaves it quiet");
  STATE.occasions = [];
});

// ── the free date fields ─────────────────────────────────────────────────────
// A date field's calendar folds the moment a day is picked, so a bubble inside
// the grid would never be read. The name hangs off the DATE instead, and the
// field is rebuilt from the same named day — which is what makes it work on a
// product's Starts/Ends boxes, redrawn from scratch on every pick.
const valTip = (w) => tipIn(w.children[0].children[0]);
const openField = (w) => fire(w.children[0]);
function fieldCell(w, dayNum) {
  const panel = w.children[1];
  const list = walk(panel).filter((c) => (c.className || "").includes("cal-cell")
    && !(c.className || "").includes("blank"));
  return list[dayNum - 1];
}

test("a date field names the marked day it records, and a rebuilt field names it too", () => {
  const pickedDates = [];
  const w = dateField("2026-09-10", (iso) => pickedDates.push(iso), { occasions: [MALAYSIA_DAY] });
  assert.equal(valTip(w), undefined, "a day with no mark has no name to give");

  openField(w);
  fire(fieldCell(w, 16));
  assert.deepEqual(pickedDates, ["2026-09-16"], "the day is recorded as always");
  assert.equal(valTip(w).children[0].text, "Malaysia Day", "and the field says what the day is");
  assert.equal(valTip(w).hidden, false);

  // The product card's Ends box is rebuilt by the very paint that follows a pick:
  // a field built fresh from the same date says the same thing.
  const rebuilt = dateField("2026-09-16", () => {}, { occasions: [MALAYSIA_DAY] });
  assert.equal(valTip(rebuilt).hidden, false, "a rebuilt field still names its own date");

  const other = dateField("2026-09-15", () => {}, { occasions: [MALAYSIA_DAY] });
  assert.equal(valTip(other), undefined, "a date with no mark stays quiet");
});

// ── Delivery Dates: the two grids that paint themselves in place ─────────────
const DSTATE = () => ({
  settings: { cutoff: "18:00", defaultCapacity: 12, deliveryDays: [1, 3, 5], currency: "RM" },
  products: [],
  orders: [],
  ingredients: [],
  credits: [],
  deliveryDates: [{ id: "d16", date: "2026-09-16" }, { id: "d20", date: "2026-09-20" }],
  occasions: [MALAYSIA_DAY],
});
const addGrid = (root) => walk(root).find((n) => (n.className || "").includes("cal-grid"));
// A day's number, whether the cell is a bare number or a delivery day's pill.
const cellNum = (c) => {
  const num = (c.children || []).find((x) => String(x.className).includes("num"));
  return num ? num.children[0].text : ((c.children[0] || {}).text);
};
const gridCell = (root, dayNum) => addGrid(root).children
  .find((c) => String(c.className).includes("cal-cell") && cellNum(c) === String(dayNum));
const addButton = (root) => walk(root).find((n) => n.tagName === "BUTTON"
  && String((n.children[0] || {}).text).startsWith("Add selected"));

// The screen redraws ITSELF after a tap (renderAll(view(), state)), so the harness
// has to redraw the tree it is holding the same way before reading it back.
function redraw(root, state) {
  root.replaceChildren();
  renderDeliveries(root, state);
}
// A named day lasts until she touches something — that is the rule the shop has
// always followed, and the module keeps it across screens. Inside one test file
// that means a test that wants "nothing named yet" has to say so by touching.
function quiet() {
  fireDoc("pointerdown", {});
}

test("a holiday that IS a delivery date is named AND taken back off by the same tap", () => {
  quiet();
  const root = createEl("div");
  const state = DSTATE();
  renderDeliveries(root, state);

  const day = gridCell(root, 16);
  assert.equal(day.tagName, "BUTTON", "a delivery day can be tapped");
  assert.ok(day.className.includes("added"), "and is drawn as one of her delivery dates");
  fire(day);
  redraw(root, state);
  assert.deepEqual(state.deliveryDates.map((d) => d.id), ["d20"],
    "the tap takes the date back off — the calendar is where she both adds and removes");
  assert.equal(tipIn(gridCell(root, 16)).hidden, false,
    "and a marked day still names itself on the way out");
  assert.ok(gridCell(root, 20).className.includes("tappable"),
    "a delivery day is removable whether or not it carries a mark");
  // A date already gone keeps its pill but is not removable from the calendar: past
  // dates are managed in the Past dates group.
  state.deliveryDates = [{ id: "d01", date: "2026-09-01" }];
  redraw(root, state);
  assert.equal(gridCell(root, 1).tagName, "SPAN", "a past delivery date is not tappable here");
});

test("taking a date off asks first when that day already holds orders", () => {
  quiet();
  const root = createEl("div");
  const state = DSTATE();
  state.orders = [{ id: "o1", deliveryDateId: "d16", lines: [] }];
  renderDeliveries(root, state);

  fire(gridCell(root, 16));
  const layer = registry["confirm-layer"];
  assert.ok(layer.children.length, "a question is put to her rather than a silent removal");
  assert.deepEqual(state.deliveryDates.map((d) => d.id), ["d16", "d20"],
    "and nothing is removed while she is being asked");

  const yes = walk(layer).find((n) => n.tagName === "BUTTON" && (n.children[0] || {}).text === "Delete");
  fire(yes);
  redraw(root, state);
  assert.deepEqual(state.deliveryDates.map((d) => d.id), ["d20"], "confirming takes it off");
});

test("the past dates are one folded group, holding every one of them", () => {
  quiet();
  const root = createEl("div");
  const state = DSTATE();
  // Twelve, so "all of them" cannot be mistaken for the last ten.
  const PAST = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`, date: `2026-08-${String(i + 1).padStart(2, "0")}`,
  }));
  state.deliveryDates = [...PAST, { id: "d20", date: "2026-09-20" }];
  renderDeliveries(root, state);

  const head = () => walk(root).find((n) => String(n.className).includes("past-head"));
  const body = () => walk(root).find((n) => String(n.className).includes("fold-body"));
  const cards = () => walk(body()).filter((n) => String(n.className).split(" ").includes("card"));
  const words = walk(root).map((n) => (n.nodeType === 3 ? n.text : "")).join(" | ");
  assert.equal(head().children[0].children[0].text, "Past dates (12)", "every past date is counted");

  // The fold is remembered while the screen is open, so put it back to how she
  // finds it before asserting that it starts folded.
  if (body().attrs.hidden !== "true") { fire(head()); redraw(root, state); }
  assert.equal(body().attrs.hidden, "true", "she arrives with the group folded away");
  assert.equal(cards().length, 12, "though every one of the 12 is already inside");

  fire(head());
  redraw(root, state);
  assert.equal(body().attrs.hidden, undefined, "and one tap unfolds them");
  assert.equal(cards().length, 12);

  // The calendar is the whole list of what is still to come: nothing below it
  // repeats the dates she can see (and untick) on it.
  assert.equal(words.includes("Upcoming"), false, "no Upcoming heading");
  assert.equal(gridCell(root, 20).className.includes("added"), true,
    "the one date still to come is on the calendar, where she can take it off");
});

test("a marked day she has not added yet is named and ticked by the same tap", () => {
  quiet(); // a named day lasts until she touches something — see the test above it
  const root = createEl("div");
  const state = DSTATE();
  state.deliveryDates = []; // nothing added yet
  renderDeliveries(root, state);

  const day = gridCell(root, 16);
  assert.ok(day.className.includes("tappable"), "it is the ordinary add-a-date tap");
  assert.equal(tipIn(day).hidden, true);
  fire(day);
  redraw(root, state);
  assert.equal(tipIn(gridCell(root, 16)).hidden, false, "the tap names the day");
  assert.equal(addButton(root).children[0].text, "Add selected (1)", "and ticks it as before");
});

test("the mark grid names a tapped day in place, without repainting itself", () => {
  quiet();
  const root = createEl("div");
  const state = DSTATE();
  renderDeliveries(root, state); // paints in add-dates mode
  fire(walk(root).find((n) => (((n.children || [])[0]) || {}).text === "Mark an occasion"));

  const root2 = createEl("div");
  renderDeliveries(root2, state); // the mark grid, as the screen now draws it
  const g = addGrid(root2);
  assert.ok(g, "the mark grid is up");
  const day = g.children.find((c) => (c.dataset || {}).date === "2026-09-16");
  assert.ok(day, "the 16th is on it");
  assert.equal(tipIn(day).hidden, true, "nothing named yet");

  // The grid's own pointer gesture: down on a day, up on the same day (no drag).
  globalThis.document.elementFromPoint = () => ({ closest: (sel) => (sel === ".occ-cell" ? day : null) });
  const ev = { clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} };
  (g._listeners.pointerdown || []).forEach((f) => f(ev));
  (g._listeners.pointerup || []).forEach((f) => f(ev));

  assert.equal(tipIn(day).hidden, false, "the day is named where it sits, rings and all");
  assert.equal(tipIn(day).children[0].text, "Malaysia Day");
});

// ── the two rules that keep this from drifting ───────────────────────────────
// Five calendars draw her marks and all five must be able to name one, so the
// bubble is built in one place: a screen that grew its own copy would be the
// screen that quietly stops matching the others.
const CALENDARS = [
  ["Delivery Dates", "admin/js/views/deliveries.js"],
  ["Orders", "admin/js/views/orders.js"],
  ["a product's Availability card", "admin/js/views/products.js"],
  ["the free date fields", "admin/js/datepicker.js"],
];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every calendar asks occgrid.js what a day is called", () => {
  assert.match(read("admin/js/occgrid.js"), /export function tipEl/,
    "the bubble is built in occgrid.js");
  for (const [name, file] of CALENDARS) {
    assert.ok(read(file).includes("tipEl"), `${name}: asks for the bubble`);
    assert.ok(!read(file).includes('class: "cal-tip"'),
      `${name}: never builds one itself`);
  }
});

// A tooltip with a cursor means hover, so the app shows the bubble on hover too —
// but ONLY where a pointer can actually hover. The app's grids are DRAG SURFACES: a
// bubble that appeared under the finger while a run was swept would sit on top of
// the days being swept, and a touch screen reports (hover: none).
test("the app's bubble is shown on hover where a mouse is, and only there", () => {
  const css = read("admin/css/app.css");
  assert.ok(css.includes(".cal-tip {"), "the app has the bubble");
  assert.match(css, /@media \(hover: hover\) \{\s*\.cal-cell:hover \.cal-tip \{ display: block; \}/,
    "a mouse resting on a marked day shows its name");
  // The rule must not exist outside that query, or a finger would get it too.
  const withoutHoverBlock = css.replace(/@media \(hover: hover\) \{[^}]*\}/, "");
  assert.ok(!/\.cal-cell:hover \.cal-tip/.test(withoutHoverBlock),
    "every hover rule sits inside the (hover: hover) query");
});
