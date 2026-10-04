// test/points-publish.test.js — every change to a Point has to reach the shop.
//
// HER REPORT, 2026-10-04: "the point added still not able to appear on store?"
// And she was right. A Point travels to the shop inside the published storefront
// row, so saving one on this phone is only HALF of it — and views/points.js only
// ever called save(). Every other screen whose change the shop can see ends its
// save with maybeSyncStorefront: Promo codes, Products, Product categories,
// Settings, and Delivery dates' saveMarks (which gained it on 14 Sep 2026 for
// exactly this fault — Malaysia Day sat on her calendar and the shop had never
// been told). Points was the last hole, and it shipped as v298–v301 without it.
//
// So this file drives the card's real buttons and counts the publishes. It is a
// WHOLE-CLASS bug, not one bug: the next list that reaches the shop will forget
// the same call unless something fails when it does.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim ---
// Unforgiving where it matters: classList is backed by the className the code
// writes (the card is found by its class), the toast is REUSED rather than
// re-created (a shim that always says "no .toast" would hand every message a
// fresh node), and replaceChildren is variadic like the real one.
function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(),
    nodeType: 1,
    children: [],
    attrs: {},
    dataset: {},
    _classes: new Set(),
    style: {},
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    scrollTop: 0,
    parentElement: null,
    _listeners: {},
    appendChild(c) {
      if (c == null) return c;
      if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      c.parentElement = this;
      this.children.push(c);
      return c;
    },
    append(...cs) { for (const c of cs.flat()) if (c != null) this.appendChild(c); },
    replaceChildren(...cs) {
      for (const c of this.children || []) c.parentElement = null;
      this.children = [];
      for (const c of cs.flat()) if (c != null) this.appendChild(c);
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() {},
    click() { for (const f of this._listeners.click || []) f({}); },
    getBoundingClientRect() { return { top: 0, left: 0, right: 300, bottom: 60, width: 300, height: 60 }; },
    querySelector(sel) {
      const wantId = sel.startsWith("#");
      const wantClass = sel.startsWith(".");
      const key = wantId || wantClass ? sel.slice(1) : "";
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.nodeType !== 1) continue;
          if (wantId && c.attrs.id === key) return c;
          if (wantClass && c._classes.has(key)) return c;
          if (!wantId && !wantClass && c.tagName === sel.toUpperCase()) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
    get classList() {
      const self = this;
      return {
        add(...cs) { for (const c of cs) self._classes.add(c); },
        remove(...cs) { for (const c of cs) self._classes.delete(c); },
        contains(c) { return self._classes.has(c); },
        toggle(c, on) {
          if (on === undefined) self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c);
          else if (on) self._classes.add(c);
          else self._classes.delete(c);
        },
      };
    },
  };
  Object.defineProperty(node, "className", {
    get() { return [...node._classes].join(" "); },
    set(v) { node._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    enumerable: true,
  });
  return node;
}

const registry = {};
const body = createEl("body");
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: () => [],
  body,
  documentElement: createEl("html"),
};
globalThis.document = doc;
globalThis.window = { scrollY: 0, scrollTo(x, y) { this.scrollY = y; }, innerWidth: 375 };
globalThis.clearTimeout = () => {};
if (typeof crypto === "undefined" || !crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => "00000000-0000-4000-8000-000000000000" };
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { renderPoints } = await import("../admin/js/views/points.js");

// --- reading the rendered card ---
function walk(n, out = []) {
  for (const c of n.children || []) { out.push(c); walk(c, out); }
  return out;
}
// The whole subtree's words, so a card can be found by something WRITTEN inside
// it — a Point's name sits three levels down, and a shallow read would find
// nothing and blame the card.
const deepText = (n) => (n.nodeType === 3
  ? String(n.text)
  : (n.children || []).map(deepText).join(" ")).replace(/\s+/g, " ").trim();
const textOf = deepText;
const findButton = (node, label) => walk(node).find((n) => n.tagName === "BUTTON" && deepText(n) === label);
const cardFor = (root, name) => root.children.find((c) => c._classes.has("card") && deepText(c).includes(name));
const fieldIn = (card, label) => {
  const field = card.children.find((c) => c._classes.has("field")
    && c.children[0] && c.children[0].children && textOf(c.children[0].children[0]) === label);
  assert.ok(field, `the card has a "${label}" field`);
  return field.children[1];
};
const press = (node) => { for (const f of node._listeners.click || []) f({}); };

// The publish is the ONLY 2000 ms timer this screen sets — the toast has a
// 2200 ms one of its own — so counting those counts publishes and nothing else.
const publishes = (timers) => timers.filter((t) => t.ms === 2000).length;
// Whatever the card last said to her, read off the toast node itself.
const said = () => (body.querySelector(".toast") || { textContent: "" }).textContent;

function mount(state) {
  const root = createEl("div");
  renderPoints(root, state);
  return root;
}

// Shared data ON, because maybeSyncStorefront deliberately does nothing at all
// while it is off — with FOUR placeholder fields it gates on, so this test can
// say "a publish was scheduled" without a real login anywhere. None of these is,
// or ever was, a credential.
function liveState(points = []) {
  return {
    orders: [], points, uoms: [], products: [], deliveryDates: [], customers: [],
    credits: [], rewards: [], expenses: [], deposits: [], purchaseOrders: [], promoCodes: [],
    settings: { currency: "RM", supabase: {
      enabled: true, url: "https://example.invalid", anonKey: "test-anon-key",
      email: "test@example.invalid", password: "placeholder-not-a-credential" } },
  };
}

const FARLIM = { id: "pt_f", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik",
  receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5, paused: false,
  createdAt: "2026-10-12T00:00:00.000Z" };

test("every change to a Point is published to the shop", () => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const state = liveState([{ ...FARLIM }]);
    const root = mount(state);
    assert.equal(publishes(timers), 0, "opening the screen publishes nothing on its own");

    // 1. a Point she adds, from the card at the top
    const add = root.children[0];
    fieldIn(add, "Point name").value = "Bukit Mertajam";
    fieldIn(add, "Address").value = "Jalan Baru";
    fieldIn(add, "Who receives").value = "Mr Ooi";
    fieldIn(add, "Their phone").value = "019-777 3344";
    press(findButton(add, "Add Point"));
    assert.equal(state.points.length, 2, "the Point landed");
    assert.equal(publishes(timers), 1, "a new Point reaches the shop");

    // 2. pause — the shop must STOP offering it, which means another publish
    press(findButton(cardFor(root, "Farlim, Air Itam"), "Pause"));
    assert.equal(state.points[0].paused, true, "it really paused");
    assert.equal(publishes(timers), 2, "pausing one reaches the shop");

    // 3. and bring it back
    press(findButton(cardFor(root, "Farlim, Air Itam"), "Resume"));
    assert.equal(state.points[0].paused, false, "it really came back");
    assert.equal(publishes(timers), 3, "resuming one reaches the shop");

    // 4. a correction, through the Edit pop-up
    press(findButton(cardFor(root, "Farlim, Air Itam"), "Edit"));
    const popup = document.getElementById("popup-layer");
    assert.ok(popup.children.length, "the Edit card opened");
    const nameField = walk(popup).find((n) => n.tagName === "INPUT"
      && n.value === "Farlim, Air Itam");
    assert.ok(nameField, "the Edit card offers the Point's name");
    nameField.value = "Farlim, Air Itam — Aunty Lim's shop";
    press(findButton(popup, "Update Point"));
    assert.match(state.points[0].name, /Aunty Lim's shop/, "the rename landed");
    assert.equal(publishes(timers), 4, "an edited Point reaches the shop");

    // 5. delete — she answers the confirmation, so this is the real path
    press(findButton(cardFor(root, "Aunty Lim's shop"), "Delete"));
    const layer = document.getElementById("confirm-layer");
    assert.ok(layer.children.length, "Delete asks first");
    press(findButton(layer, "Delete"));
    assert.equal(state.points.length, 1, "the Point is gone");
    assert.equal(publishes(timers), 5, "a deleted Point reaches the shop — the shop must stop offering it");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("a screen nothing has changed on publishes nothing", () => {
  // The floor under the test above: without it, a screen that published on every
  // repaint would pass every count there. `renderPoints` runs on every redraw,
  // and a redraw is not a change.
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const state = liveState([{ ...FARLIM }]);
    const root = mount(state);
    mount(state);
    renderPoints(root, state);
    assert.equal(publishes(timers), 0, "drawing the card is not a change to it");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// ── v304: WHAT THE CARD WRITES ─────────────────────────────────────────────
// The section above drives the real card to prove it PUBLISHES; this one drives it to prove the
// two time boxes reach the Point. Same card, same buttons, same shim.
//
// The window is stored as the app's ONE packed string (see time_window.js), so the boxes are
// packed on the way in and unpicked on the way back out — and a Point with no hours must carry
// NOTHING rather than an empty promise.

// Found by the label she reads, through deepText: a label's words are a TEXT NODE child, so
// reading `.textContent` off it finds undefined and blames the card.
// What a picker SHOWS. A browser makes `select.value` follow the option marked selected; this
// shim does not, so the option wearing `selected` is the honest read.
const selectedValue = (sel) => {
  const opt = (sel.children || []).find((c) => c.selected === true);
  return opt ? opt.value : "";
};
const setSel = (sel, value) => {
  sel.value = value;
  (sel._listeners.change || []).forEach((f) => f.call(sel));
};

const fieldNamed = (card, label) => {
  const field = walk(card).find((n) => String(n.className || "").split(/\s+/).includes("field")
    && n.children[0] && deepText(n.children[0]) === label);
  assert.ok(field, `the card has a "${label}" field`);
  return field.children[1];
};

test("the card takes the hours she types and stores them as one window (v304)", () => {
  const st = liveState([]);
  const root = mount(st);
  const add = root.children[0];
  fieldNamed(add, "Point name").value = "Farlim, Air Itam";
  fieldNamed(add, "Customers can collect from").value = "14:00";
  fieldNamed(add, "and until").value = "18:00";
  press(findButton(add, "Add Point"));

  assert.equal(st.points.length, 1, "the Point landed");
  assert.equal(st.points[0].collectWindow, "14:00-18:00",
    "packed into the one value the app stores a window as");
  assert.ok(/Collect 2-6 pm/.test(deepText(root)), "and the row says it");
});

test("a Point opened with no hours carries none, and the row says so (v304)", () => {
  const st = liveState([]);
  const root = mount(st);
  const add = root.children[0];
  fieldNamed(add, "Point name").value = "Farlim, Air Itam";
  fieldNamed(add, "Customers can collect from").value = "";
  fieldNamed(add, "and until").value = "";
  press(findButton(add, "Add Point"));
  assert.equal(st.points[0].collectWindow, "",
    "empty means she has not said — never an empty promise, which would read as open all day");
  assert.ok(/No collection window/.test(deepText(root)), "and the row says the customers get the day only");
});

test("a window that ends before it starts is refused, in the run screen's own words (v304)", () => {
  const st = liveState([]);
  const root = mount(st);
  const add = root.children[0];
  fieldNamed(add, "Point name").value = "Farlim, Air Itam";
  fieldNamed(add, "Customers can collect from").value = "18:00";
  fieldNamed(add, "and until").value = "14:00";
  press(findButton(add, "Add Point"));
  assert.equal(st.points.length, 0, "the Point is not created on a promise that cannot be kept");
  assert.match(said(), /ends before it starts/,
    "and the card says why rather than doing nothing");
});

test("the Edit card opens on the hours already stored, and can clear them (v304)", () => {
  const st = liveState([{ ...FARLIM, collectWindow: "14:00-18:00" }]);
  const root = mount(st);
  press(findButton(cardFor(root, "Farlim, Air Itam"), "Edit"));
  const popup = document.getElementById("popup-layer");
  assert.equal(fieldNamed(popup, "Customers can collect from").value, "14:00", "opened on what it holds");
  assert.equal(fieldNamed(popup, "and until").value, "18:00");

  fieldNamed(popup, "Customers can collect from").value = "";
  fieldNamed(popup, "and until").value = "";
  press(findButton(popup, "Update Point"));
  assert.equal(st.points[0].collectWindow, "", "emptying the boxes takes the hours back off");
  assert.ok(/No collection window/.test(deepText(root)), "and the row goes quiet about the time");
});

// ── v306: the smallest basket, on the card ─────────────────────────────────
// The same switch the Promo codes screen already uses — "No minimum" / "Only on a basket of at
// least" — because a minimum is a minimum, and learning a second shape for one idea is how two
// screens come to mean two different things by one word.

test("the card takes a smallest basket, and the switch decides whether it applies (v306)", () => {
  const st = liveState([]);
  const root = mount(st);
  const add = root.children[0];
  fieldNamed(add, "Point name").value = "Farlim, Air Itam";
  const on = fieldNamed(add, "Minimum order");
  assert.equal(selectedValue(on), "none", "a new Point has NO minimum — where every Point starts");

  setSel(on, "amount");
  fieldNamed(add, "Smallest basket (RM)").value = "30";
  press(findButton(add, "Add Point"));

  assert.equal(st.points.length, 1, "the Point landed");
  assert.equal(st.points[0].minOrderRM, 30, "with its smallest basket");
  assert.ok(/Minimum order RM30\.00/.test(deepText(root)), "and the row says it");
});

test("switching the minimum OFF stores no minimum at all (v306)", () => {
  const st = liveState([{ ...FARLIM, minOrderRM: 30 }]);
  const root = mount(st);
  press(findButton(cardFor(root, "Farlim, Air Itam"), "Edit"));
  const popup = document.getElementById("popup-layer");
  assert.equal(selectedValue(fieldNamed(popup, "Minimum order")), "amount", "opened on the switch as set");
  assert.equal(fieldNamed(popup, "Smallest basket (RM)").value, "30");

  setSel(fieldNamed(popup, "Minimum order"), "none");
  press(findButton(popup, "Update Point"));
  assert.equal(st.points[0].minOrderRM, 0, "switched off IS no minimum");
  assert.ok(/No minimum order/.test(deepText(root)), "and the row says so");
});

test("a Point with no minimum keeps the sentence it has always had (v306)", () => {
  // One loaf still goes, and the card says so rather than leaving a blank — the same promise
  // she made when she opened the first Point.
  const st = liveState([{ ...FARLIM }]);
  const root = mount(st);
  assert.ok(/No minimum order — one loaf still goes\./.test(deepText(root)), deepText(root).slice(0, 200));
});
