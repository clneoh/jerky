// test/more-menu.test.js — the More screen's grouping (v312), and the same
// three screens offered from the Products screen itself.
//
// ★ THE ONE THING THIS HAS TO CATCH: **A ROW DROPPED IN A REGROUP IS SILENT.**
// The screen still exists, its address still works, and every other test in the
// suite still passes — it has simply become unreachable, because the menu is the
// only way to it. So the route table is read out of `app.js` ITSELF and walked
// against the menu: every route the app can draw must appear, exactly once, or
// this fails by name.
//
// ⚠️ Reading the routes out of the source rather than listing them here is the
// point. A hand-written list of expected rows would be a SECOND place a route
// lives, and a route added to `app.js` would leave the menu silently short while
// this test stayed green — which is the exact fault it exists to stop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- DOM shim ---------------------------------------------------------------
// ⚠️ Its `textContent` WALKS its children, so a heading built as
// `el("h2", {}, "Logistic")` reads back as "Logistic". The v311 lesson: a shim
// that cannot express what the view builds reports a drawn thing as missing.
function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    _listeners: {},
    classList: {
      _c: new Set(),
      add(c) { this._c.add(c); },
      remove(c) { this._c.delete(c); },
      toggle(c, on) { if (on === undefined ? !this._c.has(c) : on) this._c.add(c); else this._c.delete(c); },
      contains(c) { return this._c.has(c); },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {}, querySelectorAll() { return []; },
    // Finds a descendant by id — the recipe card looks its own cost line up this
    // way. Without it the Products screen throws before it draws, which is a
    // shim that is too small rather than a fault in the view.
    querySelector(sel) {
      const wantId = sel.startsWith("#");
      const find = (n) => {
        for (const c of n.children || []) {
          if (c.nodeType !== 1) continue;
          if (wantId ? (c.attrs && c.attrs.id === sel.slice(1)) : c.tagName === sel.toUpperCase()) return c;
          const hit = find(c);
          if (hit) return hit;
        }
        return null;
      };
      return find(this);
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join("");
    },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
const layers = { "confirm-layer": createEl("div"), "popup-layer": createEl("div") };
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => layers[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: createEl("body"),
};
globalThis.document = doc;
globalThis.window = { open() {}, scrollTo() {}, addEventListener() {} };
globalThis.location = { hash: "#/more", reload() {} };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
if (typeof crypto === "undefined" || !crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => "00000000-0000-4000-8000-000000000000" };
}

const { renderMore } = await import("../admin/js/views/more.js");
const { renderProducts } = await import("../admin/js/views/products.js");

// --- The app's own route table, read from the source ------------------------
const APP_SRC = readFileSync(new URL("../admin/js/app.js", import.meta.url), "utf8");
const ROUTES = [...APP_SRC.matchAll(/^\s*"(\/[a-z-]+)":\s*\{\s*title:/gm)].map((m) => m[1]);

// The four daily tabs and the More screen itself are reached from the tab bar,
// so the menu is not where they belong.
const REACHED_FROM_THE_TAB_BAR = ["/dashboard", "/orders", "/products", "/customers", "/more"];
const SHOULD_BE_IN_THE_MENU = ROUTES.filter((r) => !REACHED_FROM_THE_TAB_BAR.includes(r));

// --- Reading the rendered menu ---------------------------------------------
const walk = (root, out = []) => {
  for (const c of root.children || []) { out.push(c); walk(c, out); }
  return out;
};

// "Logistic" and its rows, one entry per heading on the screen, in the order
// they are drawn.
function groupsOf(root) {
  const out = [];
  for (const top of root.children) {
    if (top.nodeType !== 1 || top.tagName !== "DIV") continue;
    const heading = (top.children || []).find((c) => c.tagName === "H2" && c.className.includes("section"));
    const card = (top.children || []).find((c) => c.tagName === "DIV" && c.className.includes("card"));
    if (!heading || !card) continue;
    out.push({
      name: heading.textContent,
      hrefs: card.children.filter((c) => c.className === "menu-item").map((c) => c.attrs.href),
    });
  }
  return out;
}

function drawMore() {
  const root = createEl("div");
  renderMore(root, state());
  return root;
}

function state() {
  return {
    settings: { currency: "RM", supabase: {}, deliveryDays: [1, 3, 5] },
    uoms: [{ id: "u_loaf", name: "loaf", family: "count" }],
    products: [],
    ingredients: [],
    orders: [],
    deliveryDates: [],
    purchaseOrders: [],
    customers: [],
    productCategories: [],
    suppliers: [],
    wishList: [],
  };
}

// ── ★ THE GUARD ─────────────────────────────────────────────────────────────

test("every screen the app can draw is reachable from the More menu", () => {
  const drawn = groupsOf(drawMore()).flatMap((g) => g.hrefs).map((h) => h.replace(/^#/, ""));
  const missing = SHOULD_BE_IN_THE_MENU.filter((r) => !drawn.includes(r));
  assert.deepEqual(missing, [],
    "a regroup dropped a screen — these cannot be reached any more");
});

test("no screen is offered twice", () => {
  const drawn = groupsOf(drawMore()).flatMap((g) => g.hrefs);
  const dupes = drawn.filter((h, i) => drawn.indexOf(h) !== i);
  assert.deepEqual(dupes, [], "a row appears under two headings");
});

test("the routing table really was read — the guard is not vacuous", () => {
  // If app.js is ever reformatted so the regex stops matching, the two tests
  // above would compare an empty list against an empty list and pass forever.
  assert.ok(ROUTES.length >= 20,
    `read ${ROUTES.length} routes out of app.js — the route table has moved or changed shape`);
  assert.ok(SHOULD_BE_IN_THE_MENU.includes("/points") && SHOULD_BE_IN_THE_MENU.includes("/promo"),
    "the routes the menu is supposed to carry were not read");
});

// ── The grouping itself ─────────────────────────────────────────────────────

test("the headings are her words, in the order she reads them", () => {
  const names = groupsOf(drawMore()).map((g) => g.name);
  assert.deepEqual(names, [
    "Logistic",
    "Products & ingredients",
    "Buying",
    "Money",
    "The kitchen",
    "The shop",
    "Settings & this app",
  ]);
});

test("'Logistic' is her own word for the delivery set, and carries all four", () => {
  // ⚠️ **"SEND A VAN", AND THE TWO KINDS ARE SAID APART (v309, v315).** The van row
  // sits directly above **Parcel couriers**, and those two must never blur: a parcel
  // is something she POSTS, a van is a trip she BOOKS. v309 gave the two kinds her own
  // words and the order cards say them.
  const logistic = groupsOf(drawMore()).find((g) => g.name === "Logistic");
  assert.deepEqual(logistic.hrefs,
    ["#/run", "#/send-van", "#/points", "#/parcel-couriers"],
    "an order leaving the kitchen is one job — every way it leaves is under Logistic");
});

test("★ Bake days sits under 'The shop', where the customer meets it (v339)", () => {
  // Her word: *"i think the bake days should not be at logistic, it should be in the Shop."* And the
  // reason it is right is worth keeping: a bake day is the day the SHOP offers — the storefront's own
  // calendar offers those days and only those — while Logistic is the four ways an order LEAVES the
  // kitchen. Before v339 the row sat under Logistic, which is a list of journeys, not of opening days.
  const shop = groupsOf(drawMore()).find((g) => g.name === "The shop");
  assert.equal(shop.hrefs[0], "#/deliveries",
    "and it leads the group: which days you are open comes before what you are advertising");
  const logistic = groupsOf(drawMore()).find((g) => g.name === "Logistic");
  assert.equal(logistic.hrefs.includes("#/deliveries"), false, "and it is no longer under Logistic");
});

test("the three she named sit together, under the name of the screen they belong to", () => {
  // Her report: "when i work on Products, i have to alway go into Others to
  // find, ingredient, unit, category."
  const group = groupsOf(drawMore()).find((g) => g.name === "Products & ingredients");
  assert.deepEqual(group.hrefs, ["#/product-categories", "#/units", "#/ingredients"]);
});

test("no screen is left under a heading that carries only itself", () => {
  // One row under one heading is a heading that says nothing — the shape this
  // regroup replaced. "Settings & this app" is the exception: it is the app
  // itself, and its card carries the change history and the developer rows too.
  for (const g of groupsOf(drawMore())) {
    if (g.name === "Settings & this app") continue;
    assert.ok(g.hrefs.length >= 2, `"${g.name}" carries a single row`);
  }
});

// ── The same three, on the Products screen itself ───────────────────────────
//
// ⚠️ **BOTH PATHS, AND THE BITE IS WHY.** A screen with no products and a screen
// with some are two separate `replaceChildren` calls in products.js, and the
// first version of this test only ever rendered the EMPTY one. Putting the card
// back above the fold therefore left it green — an assertion nobody had seen
// fail, guarding a path it did not reach. The everyday screen is the one with
// products on it, so that is the one that must be driven.

const liveProduct = () => ({
  id: "p1", name: "Focaccia", unit: "loaf", price: 18,
  active: true, draft: false, hidden: false, recipe: [],
});

function drawProducts(products) {
  const root = createEl("div");
  renderProducts(root, { ...state(), products });
  return root;
}

for (const [what, products] of [["with products on it", [liveProduct()]], ["with none yet", []]]) {
  test(`the Products screen ${what} offers the three it needs, so the trip out is not needed`, () => {
    const hrefs = walk(drawProducts(products))
      .filter((n) => n.className === "menu-item")
      .map((n) => n.attrs.href);
    assert.deepEqual(hrefs, ["#/product-categories", "#/units", "#/ingredients"],
      "the Products screen no longer offers Categories, Units and Ingredients");
  });

  test(`the card sits below the ＋ New product fold, ${what}`, () => {
    // The fold is why she opens the screen. A navigation card above it would put
    // something she reads once ahead of the thing she came to do.
    const nodes = walk(drawProducts(products));
    const firstFold = nodes.findIndex((n) => n.className === "fold-head");
    const card = nodes.findIndex((n) => n.className === "menu-item");
    assert.ok(firstFold !== -1 && card !== -1, "the fold or the card was not drawn");
    assert.ok(firstFold < card, "the Products card was drawn above the New product fold");
  });
}
