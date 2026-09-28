// test/products-order.test.js — the Products screen as the SHOP arranges it:
// her headings in her order inside each of the three state lists, the products
// she has not filed last under "More items", and the grip that moves a product
// among the others it is listed with.
//
// The shim is the unforgiving one the Categories screen's tests use, for the
// same reason: the reorder's whole job is reading the DOM back — which rows are
// kin, where the bar is, where the row lands — so classList is backed by the
// className the code writes, parentElement and nextElementSibling are real, and
// getBoundingClientRect answers with geometry the test sets. A stubbed classList
// would report every drag as a no-op that still passed.

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
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    focus() {},
    click() { for (const f of this._listeners.click || []) f({}); },
    setPointerCapture() {},
    releasePointerCapture() {},
    contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; },
    closest(sel) {
      const want = sel.startsWith(".") ? sel.slice(1) : "";
      for (let x = this; x; x = x.parentElement) if (want && x._classes.has(want)) return x;
      return null;
    },
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
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
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

import { renderProducts } from "../admin/js/views/products.js";

// --- reading the rendered screen ---
const textOf = (n) => (n && n.children[0] && n.children[0].nodeType === 3 ? n.children[0].text : "");
// The three state lists' headlines, and her headings under them, in the order
// the screen draws them — everything root holds that is a heading of either rank.
const headings = (root) => root.children.filter((n) => n.tagName === "H2" || n.tagName === "H3");
const slugs = (root) => headings(root).map((n) => ({
  level: n.tagName,
  text: textOf(n),
  tail: n._classes.has("cat-head-tail"),
}));

// Every product card on the screen, in document order, across all three lists.
const cards = (root) => walk(root).filter((n) => n._classes.has("prod-row"));
function walk(n, out = []) {
  for (const c of n.children || []) { if (c.nodeType === 1) { out.push(c); walk(c, out); } }
  return out;
}
const cardIds = (root) => cards(root).map((n) => n.dataset.id);
// The headings that CARRY something. An empty state list still prints its own
// headline and a line telling her what it is for (asserted on its own below), so
// it is left out here to keep each arrangement readable.
const carrying = (root) => slugs(root).filter((s) => !/\(0\)$/.test(s.text));
const mainOf = (c) => c.children.find((n) => n._classes.has("card-row"))
  .children.find((n) => n._classes.has("prod-row-main"));
const titleOf = (c) => {
  const m = mainOf(c);
  return textOf(m.children[m.children.length - 1].children[0]);
};
const cardTitles = (root) => cards(root).map(titleOf);
const handleOf = (c) => c.children.find((n) => n._classes.has("card-row"))
  .children.find((n) => n._classes.has("prod-handle")) || null;
const marked = (n) => ["dragging", "row-dim", "row-above", "row-below"].filter((c) => n._classes.has(c));

function freshState(products = [], categories = []) {
  return {
    settings: { currency: "RM", supabase: {}, deliveryDays: [1, 3, 5] },
    uoms: [{ id: "u_loaf", name: "loaf", family: "count" }],
    ingredients: [],
    products,
    productCategories: categories,
    orders: [],
    deliveryDates: [],
  };
}

// Stack the cards down the page so a drag has real geometry to measure against:
// each card is 60px tall and starts where the one before it ended.
function layout(root) {
  cards(root).forEach((c, i) => { c._rect = { top: 60 * i, left: 0, right: 300, bottom: 60 * i + 60, width: 300, height: 60 }; });
  return root;
}
function render(state) {
  const root = createEl("div");
  renderProducts(root, state);
  return layout(root);
}

// One press, one move, one release on a card's grip. `dy` is how far down the
// page the finger travels; a card is 60px, so ±90 crosses one neighbour.
function dragCard(root, id, dy) {
  const card = cards(root).find((c) => c.dataset.id === id);
  const handle = handleOf(card);
  const base = card._rect.top;
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: base + 10, preventDefault() {} });
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: base + 10 + dy });
  handle._listeners.pointerup[0]({ pointerId: 1 });
  return card;
}

const prod = (id, name, extra = {}) => ({ id, name, price: 10, unit: "u_loaf", ...extra });
const cat = (id, name, sort, parentId = "") => ({ id, name, parentId, sort });

// ── the arrangement ─────────────────────────────────────────────────────────

test("with no headings built, the list is drawn flat — a lone \"More items\" would say nothing", () => {
  const state = freshState([prod("p1", "Focaccia"), prod("p2", "Tea")]);
  const root = render(state);
  assert.deepEqual(carrying(root), [
    { level: "H2", text: "On the shop (2)", tail: false },
  ], "the state headline, and no heading under it");
  assert.deepEqual(cardTitles(root), ["Focaccia", "Tea"]);
});

test("products are listed under her headings in her order, unfiled ones last", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Tea", { categories: ["drink"] }),
     prod("p3", "Muffin")],
    [cat("food", "Food", 0), cat("drink", "Drink", 1)]);
  const root = render(state);
  assert.deepEqual(carrying(root), [
    { level: "H2", text: "On the shop (3)", tail: false },
    { level: "H3", text: "Food", tail: false },
    { level: "H3", text: "Drink", tail: false },
    { level: "H3", text: "More items", tail: true },
  ]);
  assert.deepEqual(cardTitles(root), ["Focaccia", "Tea", "Muffin"]);
});

test("a nested heading carries its whole path, so a deep row still says where it hangs", () => {
  const state = freshState(
    [prod("p1", "Pork Treat", { categories: ["pork"] })],
    [cat("dog", "For Dog", 0), cat("treats", "Treats", 0, "dog"), cat("pork", "Pork", 0, "treats")]);
  const root = render(state);
  assert.deepEqual(carrying(root).map((s) => s.text), ["On the shop (1)", "For Dog › Treats › Pork"]);
});

test("a heading she has no products under is left out, rather than drawn empty", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] })],
    [cat("food", "Food", 0), cat("drink", "Drink", 1)]);
  const root = render(state);
  assert.deepEqual(carrying(root).map((s) => s.text), ["On the shop (1)", "Food"],
    "Drink holds nothing on the shop, so it is not a heading here");
});

test("the three state lists are each arranged the same way, inside their own list", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Brownies", { categories: ["snack"], draft: true, active: false }),
     prod("p3", "Old Cake", { categories: ["snack"], active: false }),
     prod("p4", "Tea", { categories: ["drink"] })],
    [cat("food", "Food", 0), cat("drink", "Drink", 1), cat("snack", "Snack", 2)]);
  const root = render(state);
  assert.deepEqual(carrying(root).map((s) => s.text), [
    "On the shop (2)", "Food", "Drink",
    "Draft — not on the shop yet (1)", "Snack",
    "Hidden — taken down (1)", "Snack",
  ]);
  assert.deepEqual(cardTitles(root), ["Focaccia", "Tea", "Brownies", "Old Cake"]);
});

test("an empty state list still says its name and what it is for", () => {
  const state = freshState([prod("p1", "Focaccia")]);
  const root = render(state);
  assert.deepEqual(carrying(root).map((s) => s.text), ["On the shop (1)"]);
  const all = slugs(root).map((s) => s.text);
  assert.deepEqual(all, [
    "On the shop (1)",
    "Draft — not on the shop yet (0)",
    "Hidden — taken down (0)",
  ], "the three headlines always appear, empty or not");
  // The guidance line under an empty headline, which is the only thing telling
  // her what that section is for.
  const hints = root.children.filter((n) => n.tagName === "P").map(textOf);
  assert.ok(hints.some((h) => h.includes("New products start here as drafts")), "and the draft section explains itself");
});

// ── the grip ────────────────────────────────────────────────────────────────

test("a group of two or more has a grip on every row; a group of one has none", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Sourdough", { categories: ["food"] }),
     prod("p3", "Tea", { categories: ["drink"] }),
     prod("p4", "Muffin")],
    [cat("food", "Food", 0), cat("drink", "Drink", 1)]);
  const root = render(state);
  const byId = (id) => cards(root).find((c) => c.dataset.id === id);
  assert.ok(handleOf(byId("p1")), "Food holds two, so both may be moved among each other");
  assert.ok(handleOf(byId("p2")));
  assert.equal(handleOf(byId("p3")), null, "Drink holds only Tea — there is nothing to move it among");
  assert.equal(handleOf(byId("p4")), null, "and Muffin is alone under More items");
});

test("with no headings at all the whole list is one group, so every row is draggable", () => {
  const state = freshState([prod("p1", "Focaccia"), prod("p2", "Tea"), prod("p3", "Muffin")]);
  const root = render(state);
  assert.equal(cards(root).filter(handleOf).length, 3, "all three, because they are one list");
});

test("dragging a product down inside its heading lands it there, and writes the order on the heading", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Sourdough", { categories: ["food"] }),
     prod("p3", "Tea", { categories: ["drink"] })],
    [cat("food", "Food", 0), cat("drink", "Drink", 1)]);
  const root = render(state);
  dragCard(root, "p1", 90);

  assert.deepEqual(state.productCategories.find((c) => c.id === "food").productOrder, ["p2", "p1"],
    "the whole order is stored on the heading");
  assert.equal(state.productCategories.find((c) => c.id === "drink").productOrder, undefined,
    "and nothing was written on a heading the drop could not reach");
  assert.deepEqual(cardTitles(root), ["Sourdough", "Focaccia", "Tea"], "the rows moved to match");
});

test("a drag may not leave its own heading — the cards under the next one dim and stay put", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Sourdough", { categories: ["food"] }),
     prod("p3", "Tea", { categories: ["drink"] }),
     prod("p4", "Coffee", { categories: ["drink"] })],
    [cat("food", "Food", 0), cat("drink", "Drink", 1)]);
  const root = render(state);
  const card = cards(root).find((c) => c.dataset.id === "p1");
  const handle = handleOf(card);
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault() {} });

  const byId = (id) => cards(root).find((c) => c.dataset.id === id);
  assert.equal(marked(byId("p2")).includes("row-dim"), false, "its own heading stays lit");
  assert.ok(marked(byId("p3")).includes("row-dim"), "the next heading's cards dim — a drop among them would do nothing");
  assert.ok(marked(byId("p4")).includes("row-dim"));
  assert.equal(marked(byId("p1")).includes("row-dim"), false, "the card in her hand is not dimmed");

  // A long drag past both of them still lands it at the end of its own heading.
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: 400 });
  assert.ok(byId("p2")._classes.has("row-below"), "the bar shows the end of its own group");
  handle._listeners.pointerup[0]({ pointerId: 1 });

  assert.deepEqual(cardTitles(root), ["Sourdough", "Focaccia", "Tea", "Coffee"], "it stopped inside Food");
  assert.deepEqual(state.productCategories.find((c) => c.id === "food").productOrder, ["p2", "p1"]);
});

test("a cancelled drag puts every mark back and changes nothing", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] }),
     prod("p2", "Sourdough", { categories: ["food"] })],
    [cat("food", "Food", 0)]);
  const root = render(state);
  const card = cards(root).find((c) => c.dataset.id === "p1");
  const handle = handleOf(card);
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault() {} });
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: 200 });
  handle._listeners.pointercancel[0]({ pointerId: 1 });

  assert.deepEqual(marked(card), [], "no mark survives a cancelled drag");
  assert.deepEqual(cards(root).map(marked), [[], []], "and no other row was left dimmed either");
  assert.equal(state.productCategories[0].productOrder, undefined, "nothing was written");
});

// ── the tail: the one list a product orders itself in ────────────────────────

test("dragging an unfiled product writes the order onto the products, not on a heading", () => {
  const state = freshState([prod("p1", "Focaccia"), prod("p2", "Tea")]);
  const root = render(state);
  dragCard(root, "p2", -90);

  assert.deepEqual(state.products.map((p) => [p.id, p.sort]), [["p1", 1], ["p2", 0]],
    "every unfiled product carries its own place");
  assert.deepEqual(cardTitles(root), ["Tea", "Focaccia"], "the rows moved to match");
});

test("the tail's order is ONE order, shared by all three state lists", () => {
  const state = freshState([
    prod("p1", "Focaccia"),
    prod("p2", "Brownies", { draft: true, active: false }),
    prod("p3", "Tea"),
  ]);
  const root = render(state);
  // Dragging in the On-the-shop tail — Brownies is a draft and is not drawn in
  // that list, but it is still in the order she is rearranging.
  dragCard(root, "p3", -90);
  assert.deepEqual(state.products.map((p) => [p.id, p.sort]), [["p1", 1], ["p2", 2], ["p3", 0]]);

  const after = render(state);
  assert.deepEqual(cardTitles(after), ["Tea", "Focaccia", "Brownies"],
    "the draft list below follows the same order, rather than keeping its own");
});

test("a drag reorders the rows themselves; it never redraws the list", () => {
  const state = freshState([prod("p1", "Focaccia"), prod("p2", "Tea")]);
  const root = render(state);
  const first = cards(root)[0];
  const second = cards(root)[1];
  dragCard(root, "p2", -90);
  // Identity, not equality: a redraw would build NEW nodes and this would fail.
  // (`assert.ok` on the comparison rather than `assert.equal`, because a failed
  // equal would try to print two shim nodes and their parent links, and the
  // message alone would take the whole run down with it.)
  assert.ok(cards(root)[0] === second, "the very same node, moved — a redraw would throw her scroll back to the top");
  assert.ok(cards(root)[1] === first, "and the other node kept its identity too");
});

test("a group of one is left alone: its grip is absent rather than dead", () => {
  const state = freshState(
    [prod("p1", "Focaccia", { categories: ["food"] })],
    [cat("food", "Food", 0)]);
  const root = render(state);
  assert.equal(handleOf(cards(root)[0]), null, "no grip at all, so nothing looks movable that is not");
});

// ── The row is a customer's view, not the recipe ────────────────────────────
// Her words: "we dont need ingredient and cost price for products in app". The
// ingredient cost per unit and the recipe's own lines came OFF every row on the
// Products screen; both are still on the product's Edit screen, where she builds
// the recipe. Asserted as an ABSENCE, because the absence IS the change — and
// putting either one back would otherwise leave every existing test green.

const textAll = (n, out = []) => {
  for (const c of n.children || []) {
    if (c.nodeType === 1) textAll(c, out);
    else if (c.nodeType === 3 && c.text != null) out.push(c.text);
  }
  return out.join("");
};
const subOf = (c) => {
  const n = walk(mainOf(c)).find((x) => x._classes.has("card-sub"));
  return n ? textAll(n) : "";
};

test("a product row shows the SELL price, and neither the ingredient cost nor the recipe", () => {
  const state = freshState([prod("p1", "Focaccia", {
    price: 16, recipe: [{ ingredientId: "ing_flour", qty: 50, unit: "g" }],
  })]);
  // 50 g x RM 0.006 = RM 0.30, the exact figure the row used to print beside the
  // sell price.
  state.ingredients = [{ id: "ing_flour", name: "Flour", cost: 0.006 }];
  const root = render(state);
  const card = cards(root)[0];
  assert.ok(card, "the product has to be on the screen for this to prove anything");
  assert.match(subOf(card), /RM 16\.00 sell/,
    "the price a customer pays is the figure she reads off this row");
  assert.doesNotMatch(subOf(card), /\/\s*unit/,
    "the ingredient cost per unit is gone from the sub-line");
  assert.doesNotMatch(textAll(card), /Flour/,
    "the recipe's own ingredient lines are gone from the row — the recipe lives on the Edit screen");
});
