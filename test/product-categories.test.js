// test/product-categories.test.js — the Categories screen, driven through its
// real buttons and pointer events under a DOM shim.
//
// The shim is deliberately UNFORGIVING where it matters. The reorder is the one
// new gesture in this app, and its whole job is reading the DOM back — which row
// is a brother, where the bar is, where the row lands. A shim with a stubbed
// classList (as the older editor tests use) would report every row as "not a
// cat-row" and every drag as a no-op that still passed, so classList here is
// backed by the same className the code writes, parentElement and
// nextElementSibling are real, and getBoundingClientRect answers with geometry
// the test sets. Anything the drag reads, the test can set and then read back.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim ---
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
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    scrollTop: 0,
    parentElement: null,
    _listeners: {},
    _rect: null,
    appendChild(c) {
      if (c == null) return c;
      if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      c.parentElement = this;
      this.children.push(c);
      return c;
    },
    insertBefore(c, ref) {
      if (c == null) return c;
      if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      c.parentElement = this;
      const at = ref == null ? this.children.length : this.children.indexOf(ref);
      this.children.splice(at < 0 ? this.children.length : at, 0, c);
      return c;
    },
    append(...cs) { for (const c of cs) if (c != null) this.appendChild(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.appendChild(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() { for (const f of this._listeners.click || []) f({}); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() {
      return this._rect || { top: 0, left: 0, right: 300, bottom: 60, width: 300, height: 60 };
    },
    querySelector(sel) {
      const wantId = sel.startsWith("#");
      const wantClass = sel.startsWith(".");
      const key = wantId ? sel.slice(1) : wantClass ? sel.slice(1) : "";
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.nodeType !== 1) continue;
          if (wantId && c.attrs && c.attrs.id === key) return c;
          if (wantClass && c._classes.has(key)) return c;
          if (!wantId && !wantClass && c.tagName === sel.toUpperCase()) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
    get nextElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      return p.children[p.children.indexOf(this) + 1] || null;
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
  // A real query, not a null: `toast()` looks for an existing `.toast` and
  // reuses it. A stub that always says "none" would hand it a fresh node every
  // time, and the assertions below — which read the message off the node — would
  // be reading the FIRST message ever, not the one just raised.
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: () => [],
  body,
};
globalThis.document = doc;
globalThis.window = { scrollY: 0, scrollTo(x, y) { this.scrollY = y; } };
globalThis.setTimeout = (fn) => { fn(); return 1; };
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

import { renderProductCategories } from "../admin/js/views/productCategories.js";

// --- reading the rendered screen ---
const titleOf = (n) => (n.children[0] && n.children[0].nodeType === 3 ? n.children[0].text : "");
const catList = (root) => root.querySelector(".cat-list");
const rows = (root) => (catList(root) ? catList(root).children : []);
const rowIds = (root) => rows(root).map((n) => n.dataset.id);
const rowTitles = (root) => rows(root).map((n) => titleOf(n.children[1].children[0]));
const subOf = (n) => titleOf(n.children[1].children[1]);
// Whatever the screen last said to her. Reads the message, not the container, so
// an assertion here fails if the sentence itself changes.
const said = () => (body.querySelector(".toast") || { textContent: "" }).textContent;
// The drag's own classes, so "leaves no mark" means the drag's marks and not
// "somehow has no card/cat-row class at all".
const DRAG_CLASSES = ["dragging", "row-dim", "row-above", "row-below"];
const marked = (n) => DRAG_CLASSES.filter((c) => n._classes.has(c));

// A `.field` in the add card, found by its label rather than by position — the
// labels are the thing the baker reads, so a test that navigates by the label
// fails when the label is wrong, which is the point.
function fieldInput(card, label) {
  const field = card.children.find((c) => c._classes.has("field") && titleOf(c.children[0]) === label);
  assert.ok(field, `the add card has a "${label}" field`);
  return field.children[1];
}
const addButton = (card) => card.children.find((c) => c.tagName === "BUTTON");

const newCard = (root) => root.children[0];
const confirmCard = () => document.getElementById("confirm-layer").children[0];
const clickConfirm = () => confirmCard().children[1].children[1]._listeners.click[0]();

// Give every row the geometry a phone would: 60px tall, 80px apart down the
// page. The drag measures against these and nothing else.
function lay(rs, top = 0, height = 60, gap = 80) {
  rs.forEach((n, i) => { n._rect = { top: top + i * gap, left: 0, width: 300, height, bottom: top + i * gap + height, right: 300 }; });
}

function freshState(cats = [], products = []) {
  return { productCategories: cats, products };
}

function mount(state) {
  const root = createEl("div");
  renderProductCategories(root, state);
  lay(rows(root));          // an empty shop draws no list at all, so this may be []
  return root;
}

// --- tests ---

test("a shop with no categories says so, and the add card is there to fix it", () => {
  const state = freshState();
  const root = mount(state);
  assert.deepEqual(rowIds(root), [], "no rows");
  // The empty card is [icon, h3 title, hint], so the heading is child 1.
  assert.match(titleOf(root.children[2].children[1]), /No categories yet/);
  assert.equal(titleOf(newCard(root).children[0]), "New category");
});

test("Add category files a top-level category, last among the ones already there", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
  ]);
  const root = mount(state);
  const card = newCard(root);
  fieldInput(card, "Name").value = "Snack";
  addButton(card)._listeners.click[0]();

  const added = state.productCategories.find((c) => c.name === "Snack");
  assert.ok(added, "the category was saved");
  assert.equal(added.parentId, "", "top level when Sits under is left alone");
  assert.equal(added.sort, 2, "it goes after the two already there, not into the middle of them");
  assert.match(added.id, /^cat_/, "with the id prefix the sync and the shop expect");
  assert.deepEqual(rowTitles(root), ["Food", "Drink", "Snack"], "and the list redraws in her order");
});

test("Add category nests it under the one picked, and renumbers only that group", () => {
  const state = freshState([
    { id: "a", name: "For Dog", parentId: "", sort: 0 },
    { id: "b", name: "Treats", parentId: "a", sort: 0 },
    { id: "c", name: "Food", parentId: "a", sort: 1 },
  ]);
  const root = mount(state);
  const card = newCard(root);
  fieldInput(card, "Name").value = "Pork";
  fieldInput(card, "Sits under").value = "b";
  addButton(card)._listeners.click[0]();

  const added = state.productCategories.find((c) => c.name === "Pork");
  assert.equal(added.parentId, "b");
  assert.equal(added.sort, 0, "first child of its own parent, which has none yet");
  assert.deepEqual(rowTitles(root), ["For Dog", "Treats", "Pork", "Food"],
    "drawn depth-first, under the parent it was filed to");
  assert.equal(rows(root)[2].attrs.style, "--depth:2", "inset by its own depth");
  assert.match(subOf(rows(root)[2]), /in For Dog › Treats/, "and it says where it hangs from");
});

test("a row counts what the shop shows under it, and names the ticks that went elsewhere", () => {
  // Brownies is ticked into Snack first and Food second, so the shop draws it
  // under Snack. Food's row must not claim it — "2 products" over a heading the
  // customer page draws one product under reads as a bug she would report.
  const state = freshState(
    [{ id: "a", name: "Food", parentId: "", sort: 0 },
     { id: "b", name: "Snack", parentId: "", sort: 1 }],
    [{ id: "p1", name: "Focaccia", categories: ["a"] },
     { id: "p2", name: "Brownies", categories: ["b", "a"] }],
  );
  const root = mount(state);
  assert.equal(subOf(rows(root)[0]), "1 product · 1 more ticked here, listed elsewhere");
  assert.equal(subOf(rows(root)[1]), "1 product", "Snack carries it, so it says so plainly");
});

test("Add category refuses a blank name and a name already taken", () => {
  const state = freshState([{ id: "a", name: "Food", parentId: "", sort: 0 }]);
  const root = mount(state);
  const card = newCard(root);

  fieldInput(card, "Name").value = "   ";
  addButton(card)._listeners.click[0]();
  assert.equal(state.productCategories.length, 1, "nothing added for a blank name");

  fieldInput(card, "Name").value = "food";
  addButton(card)._listeners.click[0]();
  assert.equal(state.productCategories.length, 1, "and nothing added for a name already used");
});

test("Delete refuses a category that has sub-categories, and says how many", () => {
  const state = freshState([
    { id: "a", name: "For Dog", parentId: "", sort: 0 },
    { id: "b", name: "Treats", parentId: "a", sort: 0 },
  ]);
  const root = mount(state);
  const del = rows(root)[0].children[2].children[1];
  del._listeners.click[0]();
  assert.equal(state.productCategories.length, 2, "the branch is not cut off");
  assert.equal(document.getElementById("confirm-layer").children.length, 0, "and it never even asks");
  assert.match(said(), /it has 1 sub-category/);
});

test("Delete refuses a category that products are filed in, and says how many", () => {
  const state = freshState(
    [{ id: "a", name: "Food", parentId: "", sort: 0 }],
    [{ id: "p1", name: "Focaccia", categories: ["a"] }, { id: "p2", name: "Sandwich", categories: ["a"] }],
  );
  const root = mount(state);
  rows(root)[0].children[2].children[1]._listeners.click[0]();
  assert.equal(state.productCategories.length, 1, "still there");
  assert.match(said(), /2 products are filed here/);
});

test("Delete takes an empty category away once she confirms", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
  ]);
  const root = mount(state);
  rows(root)[0].children[2].children[1]._listeners.click[0]();
  assert.equal(confirmCard().children[0].children[0].text, 'Delete category "Food"?');
  clickConfirm();
  assert.deepEqual(state.productCategories.map((c) => c.id), ["b"]);
  assert.deepEqual(rowIds(root), ["b"]);
});

// ── the drag ────────────────────────────────────────────────────────────────

// One press, one move, one release on a row's grip.
function dragRow(root, from, dy) {
  const row = rows(root)[from];
  const handle = row.children[0];
  const base = row._rect.top;
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: base + 10, preventDefault() {} });
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: base + 10 + dy });
  handle._listeners.pointerup[0]({ pointerId: 1 });
  return row;
}

test("dragging a row down past the others puts it last, in the model and on the screen", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
    { id: "c", name: "Snack", parentId: "", sort: 2 },
  ]);
  const root = mount(state);
  dragRow(root, 0, 200);

  const order = state.productCategories
    .slice().sort((x, y) => x.sort - y.sort).map((c) => c.id);
  assert.deepEqual(order, ["b", "c", "a"], "the model carries the new order as sort 0,1,2");
  assert.deepEqual(state.productCategories.map((c) => c.sort), [2, 0, 1], "renumbered, not appended");
  assert.deepEqual(rowIds(root), ["b", "c", "a"], "and the rows were moved to match, not redrawn");
});

test("dragging a row up puts it first, and lands on the slot the bar was showing", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
    { id: "c", name: "Snack", parentId: "", sort: 2 },
  ]);
  const root = mount(state);
  dragRow(root, 2, -200);
  assert.deepEqual(rowIds(root), ["c", "a", "b"]);
  assert.deepEqual(state.productCategories.map((c) => c.sort), [1, 2, 0]);
});

test("a drag reorders only among brothers, and dims the rows it cannot reach", () => {
  const state = freshState([
    { id: "a", name: "For Dog", parentId: "", sort: 0 },
    { id: "b", name: "Treats", parentId: "a", sort: 0 },
    { id: "c", name: "Food", parentId: "a", sort: 1 },
    { id: "d", name: "For Cat", parentId: "", sort: 1 },
  ]);
  const root = mount(state);
  const row = rows(root)[1];
  const handle = row.children[0];
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: 90, preventDefault() {} });

  // The sibling under the same parent may be dropped past…
  assert.equal(rows(root)[2]._classes.has("row-dim"), false, "a brother stays lit");
  // …but a row in another branch, and a top-level heading, may not.
  assert.equal(rows(root)[0]._classes.has("row-dim"), true, "the parent dims");
  assert.equal(rows(root)[3]._classes.has("row-dim"), true, "another branch dims");
  assert.equal(rows(root)[1]._classes.has("row-dim"), false, "the row in her hand is not dimmed");

  // A long move that would pass the top-level row lands only after its brother.
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: 400 });
  assert.equal(rows(root)[2]._classes.has("row-below"), true, "the bar shows the end of its own group");
  handle._listeners.pointerup[0]({ pointerId: 1 });

  assert.deepEqual(rowIds(root), ["a", "c", "b", "d"], "it moved among its brothers and stopped there");
  assert.equal(state.productCategories.find((c) => c.id === "b").parentId, "a", "and never changed parent");
});

test("a cancelled drag puts everything back and changes nothing", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
  ]);
  const root = mount(state);
  const handle = rows(root)[0].children[0];
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault() {} });
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: 200 });
  handle._listeners.pointercancel[0]({ pointerId: 1 });

  assert.deepEqual(rowIds(root), ["a", "b"], "no row moved");
  assert.deepEqual(state.productCategories.map((c) => c.sort), [0, 1], "and no sort changed");
  assert.deepEqual(marked(rows(root)[0]), [], "the row in the hand wears nothing of the drag");
  assert.deepEqual(marked(rows(root)[1]), [], "nor does the row it passed");
});

test("the drag leaves no mark behind once it is done", () => {
  const state = freshState([
    { id: "a", name: "Food", parentId: "", sort: 0 },
    { id: "b", name: "Drink", parentId: "", sort: 1 },
  ]);
  const root = mount(state);
  dragRow(root, 0, 200);
  for (const n of rows(root)) assert.deepEqual(marked(n), [], "every row comes out clean");
});

test("a redraw keeps her place on the page", () => {
  const state = freshState([{ id: "a", name: "Food", parentId: "", sort: 0 }]);
  const root = mount(state);
  globalThis.window.scrollY = 400;
  const card = newCard(root);
  fieldInput(card, "Name").value = "Drink";
  addButton(card)._listeners.click[0]();
  assert.equal(globalThis.window.scrollY, 400, "adding a category does not throw her back to the top");
});

// --- reaching the shop -------------------------------------------------------
// Every change to a heading has to reach the customer page, and until v220 none
// of them did: the screen saved the new tree to this phone and published nothing,
// so a heading she built, renamed, reordered or deleted stayed invisible on her
// shop until some unrelated change happened to publish. Three of the four call
// sites sit on paths this file already drives (add, reorder, delete); the rename
// comes in through the Edit pop-up, which is exercised here too rather than left
// as the one path nothing checks.

// Any node, not just a direct child — the pop-up's fields are nested one level
// deeper than the add card's.
function walk(n, out = []) {
  for (const c of n.children || []) { out.push(c); walk(c, out); }
  return out;
}
const textOf = (n) => (n.children || [])
  .map((c) => (c.nodeType === 3 ? String(c.text) : String(c.textContent || ""))).join("").trim();
const findButton = (node, label) => walk(node).find((n) => n.tagName === "BUTTON" && textOf(n) === label);
// The publish is the ONLY 2000 ms timer this screen sets (the toast has its own,
// shorter one), so counting those counts publishes and nothing else.
const publishes = (timers) => timers.filter((t) => t.ms === 2000).length;
function findField(node, label) {
  const field = walk(node)
    .find((n) => n._classes && n._classes.has("field") && n.children[0] && titleOf(n.children[0]) === label);
  return field ? field.children[1] : null;
}

test("every change to a heading is published to the shop", () => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const state = freshState([
      { id: "a", name: "Food", parentId: "", sort: 0 },
      { id: "b", name: "Drink", parentId: "", sort: 1 },
    ]);
    // Shared data ON, because maybeSyncStorefront deliberately does nothing at
    // all while it is off — and placeholders for the four fields it gates on, so
    // this test can say "a publish was scheduled" without a real login anywhere.
    state.settings = { supabase: {
      enabled: true, url: "https://example.invalid", anonKey: "test-anon-key",
      email: "test@example.invalid", password: "placeholder-not-a-credential" } };
    const root = mount(state);
    assert.equal(publishes(timers), 0, "opening the screen publishes nothing on its own");

    // 1. a heading she builds
    const card = newCard(root);
    fieldInput(card, "Name").value = "Snack";
    addButton(card)._listeners.click[0]();
    assert.equal(publishes(timers), 1, "a new heading reaches the shop");

    // 2. a heading she renames, through the Edit pop-up
    rows(root)[0].children[2].children[0]._listeners.click[0]();
    const popup = document.getElementById("popup-layer");
    const nameField = findField(popup, "Name");
    assert.ok(nameField, "the Edit pop-up offers the Name field");
    nameField.value = "Bread";
    const update = findButton(popup, "Update category");
    assert.ok(update, "and its confirm button");
    update._listeners.click[0]();
    assert.equal(state.productCategories.find((c) => c.id === "a").name, "Bread", "the rename landed");
    assert.equal(publishes(timers), 2, "a renamed heading reaches the shop");

    // 3. a heading she reorders. The rename redrew the screen, so the rows are
    // new nodes with no geometry yet — a phone's rows always have some.
    lay(rows(root));
    dragRow(root, 0, 200);
    assert.equal(publishes(timers), 3, "the order she just set reaches the shop");

    // 4. a heading she deletes
    const del = rows(root).find((r) => r.dataset.id === "b").children[2].children[1];
    del._listeners.click[0]();
    clickConfirm();
    assert.equal(state.productCategories.some((c) => c.id === "b"), false, "the heading is gone");
    assert.equal(publishes(timers), 4, "and the shop stops drawing it");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

