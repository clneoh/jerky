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
    // ⚠️ AND A BOOLEAN ATTRIBUTE IS READ BACK AS A PROPERTY (v411). `el("div", { hidden: true })`
    // writes the ATTRIBUTE — and a browser reflects that onto `.hidden`, so `body.hidden` is true.
    // This shim did not, so a card `el()` had built hidden read as visible here and the assertion
    // was about the shim rather than the view. **A boolean attribute is the same fact however it is
    // asked for**, and `hidden` is the one this screen leans on for every folded card.
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "hidden") this.hidden = true;
    },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; if (k === "hidden") this.hidden = false; },
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

// ── v410: what is actually IN the payload ───────────────────────────────────
//
// ⚠️ THIS FILE'S OWN HEADER CALLED IT: *"It is a WHOLE-CLASS bug, not one bug: the next list that
// reaches the shop will forget the same call unless something fails when it does."* The collection
// areas are that next list — so the payload is now READ rather than only counted, and a forgotten
// line fails here instead of going quiet.

const { storefrontPayload } = await import("../admin/js/supabase.js");

function areaState({ areas = [], points = [] } = {}) {
  const st = liveState(points);
  st.pointAreas = areas;
  return st;
}

test("★★ the published payload carries the AREAS, and the Points in the order the shop draws them", () => {
  const st = areaState({
    areas: [
      { id: "pa_island", name: "Penang Island", parentId: "", sort: 0 },
      { id: "pa_prai", name: "Prai", parentId: "", sort: 1 },
      { id: "pa_sgara", name: "Sg Ara", parentId: "pa_island", sort: 0 },
    ],
    // ⚠️⚠️ THE `createdAt` DATES ARE DELIBERATELY IN THE OPPOSITE ORDER TO THE AREAS, and must stay
    // that way. A Point has two possible orders: **hers** (`shopPointOrder`, loose first then each
    // area in tree order) and **the one they were opened in** (`activePoints` sorts by `createdAt`).
    // If the fixture's dates happened to agree with her order, this test would pass whichever one
    // the payload used — a test of nothing. Inverted here so only the right one can pass.
    points: [
      { id: "pt_loose", name: "Somewhere unfiled", feeRM: 0.5, createdAt: "2026-10-03T00:00:00.000Z" },
      { id: "pt_sgara", name: "Sg Ara", areaId: "pa_sgara", feeRM: 0.5, createdAt: "2026-10-02T00:00:00.000Z" },
      { id: "pt_prai", name: "Chai Leng Park", areaId: "pa_prai", feeRM: 0.5, createdAt: "2026-10-01T00:00:00.000Z" },
    ],
  });
  const out = storefrontPayload(st);

  // ⭐ The headings: her names, her depths, and the IDS of what each carries. The island is sent
  // even though it carries no Point of its own, because Sg Ara under it does — an indent with
  // nothing to be indented from is not a tree.
  assert.deepEqual(out.pointAreas, [
    { name: "Penang Island", depth: 0, points: [] },
    { name: "Sg Ara", depth: 1, points: ["pt_sgara"] },
    { name: "Prai", depth: 0, points: ["pt_prai"] },
  ], "her areas, in her order, carrying ids");

  // ⚠️ AND THE ORDER IS THE ONE THE HEADINGS ARE READ AGAINST. The customer page walks this list
  // and puts a heading in front of the first Point under it, so **the order and the headings have
  // to be one decision** — taken by shopPointOrder, not by the order the records happen to sit in.
  // ⭐ The loose Point is FIRST: a Point is a real place a customer can go, and burying one below
  // her headings because she has not filed it yet helps nobody.
  assert.deepEqual(out.points.map((p) => p.id), ["pt_loose", "pt_sgara", "pt_prai"]);
});

test("★ and the payload still carries every key it carried before", () => {
  // ⚠️ A new key added to a payload that is REPLACED WHOLE is exactly how a list goes missing.
  const out = storefrontPayload(areaState());
  for (const k of ["name", "whatsapp", "deliveryDays", "cutoff", "products", "points", "pointAreas"]) {
    assert.ok(k in out, `the payload still carries ${k}`);
  }
  assert.deepEqual(out.pointAreas, [], "no areas is an empty list, not a missing key");
});

test("★ a Point she ticks publishes its address, and one she does not, does not", () => {
  const st = areaState({
    points: [
      { ...FARLIM, id: "pt_shown", name: "Shown", showAddress: true, areaId: "" },
      { ...FARLIM, id: "pt_hidden", name: "Hidden", showAddress: false, areaId: "" },
    ],
  });
  const rows = storefrontPayload(st).points;
  const by = (id) => rows.find((r) => r.id === id);
  assert.equal(by("pt_shown").address, "Lebuhraya Thean Teik", "the ticked one carries its address");
  assert.equal("address" in by("pt_hidden"), false, "and the other carries no address key at all");
  assert.equal(JSON.stringify(rows).includes("Aunty Lim"), false, "the receiver still never leaves");
});

test("★ the Points screen draws her areas as headings, and the unfiled ones first", () => {
  const st = areaState({
    areas: [
      { id: "pa_island", name: "Penang Island", parentId: "", sort: 0 },
      { id: "pa_sgara", name: "Sg Ara", parentId: "pa_island", sort: 0 },
    ],
    points: [
      { ...FARLIM, id: "pt_loose", name: "Somewhere unfiled", areaId: "" },
      { ...FARLIM, id: "pt_sgara", name: "A place in the village", areaId: "pa_sgara" },
    ],
  });
  const root = mount(st);
  // ⚠️ Matched on the exact class TOKENS, not on a substring: `.point-row-body` contains
  // "point-row", so a substring match finds every card twice and reads the body as a row. And a
  // row's own text starts with the grip glyph, so the name is read off its `.card-title`.
  const has = (n, c) => !!(n._classes && n._classes.has(c));
  // ⚠️ The name lives on the card's FOLD HEAD since v411, and that line carries the status chips
  // after it ("… Active") plus the caret — none of which this test is about, so they are stripped.
  // A chip changing must not be able to make the ORDER assertion look wrong.
  const titleOf = (row) => deepText(walk(row).find((x) => has(x, "fold-head")))
    .replace(/\s*(🏠 The kitchen)?\s*(Active|Paused)?\s*[▸▾]?$/, "").trim();
  const seq = walk(root)
    .filter((n) => has(n, "point-area-head") || has(n, "point-row"))
    .map((n) => (has(n, "point-area-head") ? `# ${deepText(n)}` : `· ${titleOf(n)}`));
  assert.deepEqual(seq, [
    "# No area yet",           // ⚠️ FIRST — a Point is a real place a customer can go, so an
    "· Somewhere unfiled",     //    unfiled one is never buried below her headings
    "# Penang Island",         // ⭐ kept although it carries nothing itself, because Sg Ara under
    "# Sg Ara",                //    it does — an indent needs something to be indented from
    "· A place in the village",
  ], "heading, then its Points — the unfiled ones first, then each area in her order");

  // ⚠️ AND NO AREAS AT ALL IS THE SCREEN IT HAS ALWAYS BEEN, bar the one "No area yet" heading —
  // so nothing jumps under her the day this version opens on a phone with no areas built yet.
  const bare = mount(liveState([{ ...FARLIM }]));
  assert.deepEqual(walk(bare).filter((n) => has(n, "point-area-head")).map(deepText),
    ["No area yet"], "one heading, and every Point under it");
  assert.equal(walk(bare).filter((n) => has(n, "point-row")).length, 1, "and her Point is still there");
});

test("★★ a Point card arrives FOLDED, and stays open once she opens it", () => {
  // Her words: __"can the point fold up by default?"__ — with an area or two above them, a screen of
  // fully-opened Points is a long scroll with the list she came to read buried in it.
  const st = liveState([{ ...FARLIM }]);
  const root = mount(st);
  const has = (n, c) => !!(n._classes && n._classes.has(c));
  const row = walk(root).find((n) => has(n, "point-row"));
  const head = walk(row).find((n) => has(n, "fold-head"));
  const body = walk(row).find((n) => has(n, "fold-body"));
  assert.ok(head && body, "the card has a head to press and a body to fold");
  assert.equal(body.hidden, true, "⚠️ and it arrives SHUT — that is the whole request");

  // ⚠️ WHAT THE FOLDED CARD STILL SAYS. A list of names alone would be a list she had to open row by
  // row, so the head carries the name, its chips, and the one line she reads at a glance.
  const headText = deepText(head);
  assert.ok(headText.includes("Farlim, Air Itam"), `the name is on the head: ${headText}`);
  assert.ok(headText.includes("Active"), "and its status chip");
  const summary = deepText(walk(row).find((n) => has(n, "card-sub")));
  assert.ok(/Aunty Lim/.test(summary) && /RM0\.50 per order/.test(summary),
    `and the line under it says who receives and what it costs her: ${summary}`);

  // A tap opens it, and the detail is one tap away rather than gone.
  press(head);
  assert.equal(body.hidden, false, "tapping the head opens the card");

  // ⚠️⚠️ AND IT IS STILL OPEN AFTER A REDRAW. Every change on this screen repaints the whole list —
  // pausing, editing, dragging — so without remembering what she opened, the card she was working in
  // would snap shut the moment she used it.
  // ⚠️ THE SAME ROOT, re-rendered — not `mount(st)`, which builds a SECOND root and leaves this one
  // alone. Written that way the assertion read a card nobody had redrawn and passed whatever the
  // code did: a test of nothing, found by biting it.
  renderPoints(root, st);
  const again = walk(root).find((n) => has(n, "point-row"));
  assert.equal(walk(again).find((n) => has(n, "fold-body")).hidden, false,
    "a redraw leaves the card she opened open");

  press(walk(again).find((n) => has(n, "fold-head"))); // put it back, so the next test starts folded
  assert.equal(walk(again).find((n) => has(n, "fold-body")).hidden, true, "and tapping again shuts it");
});
