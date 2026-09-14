// test/products-editor.test.js — the Products editor's per-product date rules
// ("Orders close (days before delivery)" + "Available for delivery dates").
// Renders the real view under a tiny DOM shim and drives the Add button, so the
// two optional boxes the owner fills in on her phone actually land on the saved
// product — and a backwards from/to pair is refused without saving.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim (mirrors test/orders.test.js, plus a querySelector that finds a
// descendant by id, which the recipe card needs) ---
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {},
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    // Walk up the parent chain, so a tap can be judged as inside or outside a
    // card the way the real DOM does.
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; },
    // Hand the event to this node's own listeners (the view attaches them
    // directly, so bubbling has nothing to do here).
    dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    // The real DOM reflects the boolean `hidden` attribute onto the property,
    // so the shim must too or a `hidden: true` field reads back as visible.
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
    querySelector(sel) {
      const wantId = sel.startsWith("#");
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.nodeType !== 1) continue;
          if (wantId ? (c.attrs && c.attrs.id === sel.slice(1)) : c.tagName === sel.toUpperCase()) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
  };
}
// The layer divs that confirmDialog / showPopup fill and hide. There is no real
// <body> here, so getElementById hands back these stand-ins (nothing in the
// existing tests called getElementById, so this only enables new behaviour).
const layers = {
  "confirm-layer": createEl("div"),
  "popup-layer": createEl("div"),
};
// Document-level listeners (the translation card's tap-outside rule installs one
// on `document`, which is why the real shim needs a place to keep them).
const docListeners = {};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => layers[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
  removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter((x) => x !== f); },
  body: createEl("body"),
};
// Fire a document-level event, standing in for a tap anywhere on the screen.
const fireDoc = (type, ev) => (docListeners[type] || []).forEach((f) => f(ev || {}));
globalThis.document = doc;
// Keep toast/save timers from stalling the test run.
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

// A state with just enough to render the editor: a count unit to pick, and no
// products yet (the always-visible New product card).
function freshState() {
  return {
    settings: { currency: "RM", supabase: {} },
    uoms: [
      { id: "u_loaf", name: "loaf", family: "count" },
      { id: "u_g", name: "g", family: "weight" },
    ],
    ingredients: [],
    products: [],
    orders: [],
    deliveryDates: [],
  };
}

// Every node under `root`, depth-first, in document order.
function walk(root, out = []) {
  for (const c of root.children || []) {
    out.push(c);
    walk(c, out);
  }
  return out;
}

function render(state) {
  const root = doc.createElement("div");
  renderProducts(root, state);
  return root;
}

// The New product card is always root.children[0]. Returns handles to the fields.
function formHandles(root) {
  const nodes = walk(root.children[0]);
  const byPlaceholder = (ph) => nodes.find((n) => n.tagName === "INPUT" && n.attrs.placeholder === ph);
  const dates = nodes.filter((n) => n.tagName === "INPUT" && n.attrs.type === "date");
  return {
    name: byPlaceholder("e.g. Chicken Jerky"),
    unit: nodes.find((n) => n.tagName === "SELECT"),
    desc: nodes.find((n) => n.tagName === "TEXTAREA"),
    closeDays: byPlaceholder("e.g. 14"),
    cancelDays: byPlaceholder("e.g. 2"),
    validFrom: dates[0],
    validTo: dates[1],
    add: nodes.find((n) => n.tagName === "BUTTON"
      && (n.children || []).some((c) => c.text === "Add product")),
  };
}

const fire = (node) => (node._listeners.click || []).forEach((f) => f());

test("saving a product keeps its two date rules (close days + from–to window)", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  assert.ok(f.closeDays, "new-product card shows the Orders-close box");
  assert.ok(f.validFrom && f.validTo, "new-product card shows From and To date pickers");

  f.name.value = "CNY Gift Set";
  f.unit.value = "u_loaf";
  f.closeDays.value = "14";
  f.validFrom.value = "2026-12-01";
  f.validTo.value = "2026-12-24";
  fire(f.add);

  assert.equal(state.products.length, 1);
  const saved = state.products[0];
  assert.equal(saved.name, "CNY Gift Set");
  assert.equal(saved.closeDays, 14, "typed close days round-trip onto the product");
  assert.equal(saved.validFrom, "2026-12-01");
  assert.equal(saved.validTo, "2026-12-24");
});

test("the change/cancel window saves as a number and is absent when left blank", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  assert.ok(f.cancelDays, "new-product card shows the Changes-or-cancellations box");

  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  f.cancelDays.value = "2";
  fire(f.add);
  assert.equal(state.products[0].cancelDays, 2, "typed window round-trips onto the product");

  // A second product, left blank, states no window at all.
  const f2 = formHandles(render(state));
  f2.name.value = "Brownie";
  f2.unit.value = "u_loaf";
  fire(f2.add);
  assert.equal(state.products[1].cancelDays, undefined, "blank window = no window stated");
});

test("leaving both boxes blank saves a product that is open any day", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal(state.products.length, 1);
  const saved = state.products[0];
  assert.equal(saved.closeDays, undefined, "blank close box = no early close");
  assert.equal(saved.validFrom, undefined, "blank window = every open day");
  assert.equal(saved.validTo, undefined);
  assert.equal(saved.description, undefined, "blank description shows nothing on the shop");
});

test("typing a description saves it for customers to read (multiline kept)", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  assert.ok(f.desc, "the new-product card shows the Description box");
  f.name.value = "Rosemary Focaccia";
  f.unit.value = "u_loaf";
  f.desc.value = "Crisp rosemary crust,\nairy crumb";
  fire(f.add);

  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].description, "Crisp rosemary crust,\nairy crumb",
    "typed description round-trips onto the product, line breaks intact");

  const listCard = walk(root).find((n) => n.className === "product-desc");
  assert.ok(listCard, "the product's list card shows the description on the Products page");
  assert.equal(listCard.children[0].text, "Crisp rosemary crust,\nairy crumb",
    "what she typed reads back on the card");
});

test("a from-date after the to-date is refused and nothing is saved", () => {
  doc.body.replaceChildren();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Backwards Window";
  f.unit.value = "u_loaf";
  f.validFrom.value = "2026-12-24";
  f.validTo.value = "2026-12-01";
  fire(f.add);

  assert.equal(state.products.length, 0, "the bad product is not added");
  const toastNode = doc.body.children.at(-1);
  assert.ok(toastNode && /from.*to|swap/i.test(toastNode.textContent), "the owner is told to swap the dates");
});

test("each recipe line shows its working, the header adds them up, and the list below lands on the same total", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.ingredients = [
    { id: "ing_flour", name: "Strong flour", unit: "g", active: true, costPerUnit: 0.01 },
    { id: "ing_water", name: "Water", unit: "ml", active: true }, // no cost set
  ];
  const root = render(state);
  const nodes = walk(root.children[0]);
  const addIng = nodes.find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add ingredient"));
  assert.ok(addIng, "the recipe card offers + Add ingredient");
  fire(addIng);
  fire(addIng); // two lines

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const box = () => walk(root.children[0]).find((n) => n.attrs && n.attrs.id === "recipe-lines");
  const row = (i) => box().children[i];
  const sel = (i) => row(i).children.find((c) => c.tagName === "SELECT");
  const qty = (i) => row(i).children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");
  const caption = (i) => {
    const c = row(i).children.find((n) => n.nodeType === 1 && n.className === "line-cost");
    return c && c.children[0] ? c.children[0].text : "";
  };

  // No breakdown table before any line is filled.
  assert.ok(!walk(root.children[0]).some((n) => n.className === "cost-sum"),
    "nothing filled yet → no add-up list");

  sel(0).value = "ing_flour"; fireType(sel(0), "change");
  qty(0).value = "100"; fireType(qty(0), "change");
  sel(1).value = "ing_water"; fireType(sel(1), "change");
  qty(1).value = "200"; fireType(qty(1), "change");

  assert.equal(caption(0), "100 g × RM 0.01 = RM 1.00", "flour line shows the amount × its price");
  assert.equal(caption(1), "no cost set", "water has no cost typed yet");
  const total = walk(root.children[0]).find((n) => typeof n.textContent === "string"
    && n.textContent.startsWith("Est. ingredient cost"));
  assert.equal(total.textContent, "Est. ingredient cost / unit: RM 1.00", "the two lines add up on the header");

  const costSum = walk(root.children[0]).find((n) => n.className === "cost-sum");
  assert.ok(costSum, "the add-up list appears once lines are filled");
  const grid = costSum.children.find((n) => n.className === "cost-grid");
  const childText = (n) => (n.children && n.children[0] && n.children[0].text != null ? n.children[0].text : "");
  const kids = grid.children.flatMap((row) => row.children.map(childText));
  assert.deepEqual(kids,
    ["·", "RM 1.00", "Strong flour", "100%",
     "+", "RM 0.00", "Water  (no cost set)", "0%",
     "=", "RM 1.00", "100%"],
    "each line shows its own RM and its % of the total; the no-cost line reads 0%, and the list lands on the RM 1.00 header total");
});

test("a set line shows qty × its own cost per unit, and counts as one row in the add-up list", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.ingredients = [
    { id: "ing_flour", name: "Strong flour", unit: "g", active: true, costPerUnit: 0.01 },
  ];
  state.products = [
    { id: "prd_foc", name: "Focaccia", unit: "loaf", active: true,
      recipe: [{ ingredientId: "ing_flour", qty: 100, unit: "g" }] }, // RM 1.00 per loaf
  ];
  const root = render(state);
  const nodes = walk(root.children[0]);
  const addProd = nodes.find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add product"));
  assert.ok(addProd, "the recipe card offers + Add product");
  fire(addProd);

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const row = () => walk(root.children[0])
    .find((n) => n.attrs && n.attrs.id === "recipe-lines").children[0];
  const sel = row().children.find((c) => c.tagName === "SELECT");
  const qty = row().children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");
  const caption = () => {
    const c = row().children.find((n) => n.nodeType === 1 && n.className === "line-cost");
    return c && c.children[0] ? c.children[0].text : "";
  };

  sel.value = "prd_foc"; fireType(sel, "change");
  qty.value = "2"; fireType(qty, "change");

  assert.equal(caption(), "2 × RM 1.00 = RM 2.00", "the set line shows qty × the pack's per-unit cost");
  const costSum = walk(root.children[0]).find((n) => n.className === "cost-sum");
  const grid = costSum.children.find((n) => n.className === "cost-grid");
  const childText = (n) => (n.children && n.children[0] && n.children[0].text != null ? n.children[0].text : "");
  const kids = grid.children.flatMap((row) => row.children.map(childText));
  assert.deepEqual(kids, ["·", "RM 2.00", "Focaccia", "100%", "=", "RM 2.00", "100%"],
    "one + row for the set — it is 100% of its own total, landing on RM 2.00");
});

test("an ingredient priced per pack (no fallback cost) prices its recipe line from the pack", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.suppliers = [{ id: "sup_mydin", name: "Mydin", active: true }];
  state.ingredients = [
    { id: "ing_salt", name: "Sea salt", unit: "g", active: true, uomId: "u_g",
      supplierPrices: [{ supplierId: "sup_mydin", qty: 500, uomId: "u_g", price: 4 }] }, // RM 4 / 500 g box
  ];
  const root = render(state);
  const nodes = walk(root.children[0]);
  const addIng = nodes.find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add ingredient"));
  assert.ok(addIng, "the recipe card offers + Add ingredient");
  fire(addIng);

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const row = () => walk(root.children[0])
    .find((n) => n.attrs && n.attrs.id === "recipe-lines").children[0];
  const sel = row().children.find((c) => c.tagName === "SELECT");
  const qty = row().children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");
  const caption = () => {
    const c = row().children.find((n) => n.nodeType === 1 && n.className === "line-cost");
    return c && c.children[0] ? c.children[0].text : "";
  };

  sel.value = "ing_salt"; fireType(sel, "change");
  qty.value = "5"; fireType(qty, "change");

  assert.equal(caption(), "5 g × RM 0.008 = RM 0.04",
    "the line works the RM 4 / 500 g pack back to per gram (no cost box needed)");
  const total = walk(root.children[0]).find((n) => typeof n.textContent === "string"
    && n.textContent.startsWith("Est. ingredient cost"));
  assert.equal(total.textContent, "Est. ingredient cost / unit: RM 0.04");

  const costSum = walk(root.children[0]).find((n) => n.className === "cost-sum");
  const grid = costSum.children.find((n) => n.className === "cost-grid");
  const childText = (n) => (n.children && n.children[0] && n.children[0].text != null ? n.children[0].text : "");
  assert.deepEqual(grid.children.flatMap((row) => row.children.map(childText)), ["·", "RM 0.04", "Sea salt", "100%", "=", "RM 0.04", "100%"],
    "the pack-priced salt is 100% of its own RM 0.04 total");
});

test("an ingredient line's typed description saves onto that line, blank leaves no key", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.ingredients = [
    { id: "ing_flour", name: "Strong flour", unit: "g", active: true, costPerUnit: 0.01 },
    { id: "ing_water", name: "Water", unit: "ml", active: true }, // no note typed
  ];
  const root = render(state);
  const nodes = walk(root.children[0]);
  const addIng = nodes.find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add ingredient"));
  assert.ok(addIng, "the recipe card offers + Add ingredient");
  fire(addIng);
  fire(addIng); // two lines

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const row = (i) => walk(root.children[0])
    .find((n) => n.attrs && n.attrs.id === "recipe-lines").children[i];
  const sel = (i) => row(i).children.find((c) => c.tagName === "SELECT");
  const qty = (i) => row(i).children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");
  const note = (i) => row(i).children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.placeholder
    && c.attrs.placeholder.startsWith("Describe this ingredient"));

  assert.ok(!note(0), "an empty row shows no note box yet");
  sel(0).value = "ing_flour"; fireType(sel(0), "change");
  assert.ok(note(0), "picking an ingredient reveals its note box under the row");
  qty(0).value = "500"; fireType(qty(0), "change");
  note(0).value = "high-protein bread flour"; fireType(note(0), "change");

  sel(1).value = "ing_water"; fireType(sel(1), "change");
  qty(1).value = "350"; fireType(qty(1), "change");

  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal(state.products.length, 1);
  const rec = state.products[0].recipe;
  assert.equal(rec.length, 2);
  assert.equal(rec[0].description, "high-protein bread flour", "typed note round-trips onto the flour line");
  assert.equal(rec[1].description, undefined, "the water line has no note");
  assert.ok(!("description" in rec[1]), "and a blank note leaves no stray key on the saved line");
  assert.deepEqual(Object.keys(rec[1]).sort(), ["ingredientId", "qty", "unit"],
    "untouched lines keep exactly their old shape");
});

test("two products share one ingredient, each keeping its own description", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.ingredients = [
    { id: "ing_flour", name: "Strong flour", unit: "g", active: true, costPerUnit: 0.01 },
  ];
  const root = render(state);

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const addIng = () => walk(root.children[0]).find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add ingredient"));
  const row = () => walk(root.children[0])
    .find((n) => n.attrs && n.attrs.id === "recipe-lines").children[0];
  const sel = () => row().children.find((c) => c.tagName === "SELECT");
  const qty = () => row().children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");
  const note = () => row().children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.placeholder
    && c.attrs.placeholder.startsWith("Describe this ingredient"));

  // Product 1: Focaccia, flour = "high-protein bread flour".
  fire(addIng());
  sel().value = "ing_flour"; fireType(sel(), "change");
  qty().value = "500"; fireType(qty(), "change");
  note().value = "high-protein bread flour"; fireType(note(), "change");
  let f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);
  assert.equal(state.products.length, 1);

  // Product 2: Sandwich, same flour ingredient, its own wording.
  fire(addIng());
  sel().value = "ing_flour"; fireType(sel(), "change");
  qty().value = "250"; fireType(qty(), "change");
  note().value = "soft all-purpose"; fireType(note(), "change");
  f = formHandles(root);
  f.name.value = "Sandwich";
  f.unit.value = "u_loaf";
  fire(f.add);
  assert.equal(state.products.length, 2);

  const foc = state.products.find((p) => p.name === "Focaccia");
  const snd = state.products.find((p) => p.name === "Sandwich");
  assert.equal(foc.recipe[0].description, "high-protein bread flour",
    "Focaccia's flour line keeps its own note");
  assert.equal(snd.recipe[0].description, "soft all-purpose",
    "Sandwich's flour line keeps a different note for the same ingredient");
});

test("each line's share of the total shows as a rounded %, and no-cost lines read 0%", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.ingredients = [
    { id: "ing_flour", name: "Strong flour", unit: "g", active: true, costPerUnit: 0.01 }, // RM 1.00
    { id: "ing_cheese", name: "Cheddar", unit: "g", active: true, costPerUnit: 0.009 },    // RM 0.45
    { id: "ing_yeast", name: "Yeast", unit: "g", active: true },                           // no cost set
  ];
  const root = render(state);
  const nodes = walk(root.children[0]);
  const addIng = nodes.find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "＋ Add ingredient"));
  fire(addIng);
  fire(addIng);
  fire(addIng); // three lines

  const fireType = (n, t) => (n._listeners[t] || []).forEach((f) => f());
  const row = (i) => walk(root.children[0])
    .find((n) => n.attrs && n.attrs.id === "recipe-lines").children[i];
  const sel = (i) => row(i).children.find((c) => c.tagName === "SELECT");
  const qty = (i) => row(i).children.find((c) => c.tagName === "INPUT" && c.attrs && c.attrs.type === "number");

  sel(0).value = "ing_flour"; fireType(sel(0), "change"); qty(0).value = "100"; fireType(qty(0), "change");
  sel(1).value = "ing_cheese"; fireType(sel(1), "change"); qty(1).value = "50"; fireType(qty(1), "change");
  sel(2).value = "ing_yeast"; fireType(sel(2), "change"); qty(2).value = "10"; fireType(qty(2), "change");

  const costSum = walk(root.children[0]).find((n) => n.className === "cost-sum");
  const grid = costSum.children.find((n) => n.className === "cost-grid");
  const childText = (n) => (n.children && n.children[0] && n.children[0].text != null ? n.children[0].text : "");
  assert.deepEqual(grid.children.flatMap((row) => row.children.map(childText)),
    ["·", "RM 1.00", "Strong flour", "69%",
     "+", "RM 0.45", "Cheddar", "31%",
     "+", "RM 0.00", "Yeast  (no cost set)", "0%",
     "=", "RM 1.45", "100%"],
    "flour and cheddar split the RM 1.45 total (68.97→69% and 31.03→31%), and the no-cost yeast reads 0%");
});

// ── Engine v66: Draft / Publish / Hidden states ────────────────────────────

const buttonByText = (root, text) => walk(root).find((n) => n.tagName === "BUTTON"
  && (n.children || []).some((c) => c.text === text));
const groupHeadings = (root) => walk(root)
  .filter((n) => n.tagName === "H2" && n.className === "section")
  .map((n) => (n.children[0] ? n.children[0].text : ""));
const resetLayers = () => {
  for (const id of Object.keys(layers)) { layers[id].hidden = true; layers[id].replaceChildren(); }
};

test("a brand-new product starts as a Draft, sitting in its own list, never on the shop", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal(state.products.length, 1);
  const saved = state.products[0];
  assert.equal(saved.draft, true, "new products start as a draft");
  assert.equal(saved.active, false, "active:false keeps it out of every for-sale list automatically");

  assert.deepEqual(groupHeadings(root),
    ["On the shop (0)", "Draft — not on the shop yet (1)", "Hidden — taken down (0)"],
    "the screen shows three separate lists with counts");
  assert.ok(buttonByText(root, "Publish"), "the draft card offers Publish");
  assert.ok(!buttonByText(root, "Hide"), "a draft is not on the shop, so nothing to hide");
});

test("Publish moves a draft onto the shop — draft cleared, active true, re-listed live", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);
  const p = state.products[0];

  fire(buttonByText(root, "Publish"));

  assert.equal(p.active, true, "published products are active");
  assert.notEqual(p.draft, true, "the draft flag is cleared");
  assert.deepEqual(groupHeadings(root),
    ["On the shop (1)", "Draft — not on the shop yet (0)", "Hidden — taken down (0)"],
    "the published product now reads On the shop");
  assert.ok(!buttonByText(root, "Publish"), "a live product has nothing left to publish");
});

test("a live product with order history Hides into the Hidden list, and Unhide brings it back", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  let root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);
  const p = state.products[0];
  fire(buttonByText(root, "Publish"));

  // History makes the live card offer Hide instead of Delete (Delete is guarded).
  state.orders = [{ id: "o1", productId: p.id, qty: 1, customerName: "Aisyah", whatsapp: "60123456789" }];
  root = render(state);
  assert.ok(buttonByText(root, "Hide"), "a product with orders can be hidden, never deleted");
  fire(buttonByText(root, "Hide"));

  // The Hide confirm asks, and the yes tap actually hides.
  const yes = walk(layers["confirm-layer"]).find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "Hide it"));
  assert.ok(yes, "the confirm offers 'Hide it'");
  fire(yes);
  assert.equal(p.active, false, "hidden products are inactive");
  assert.notEqual(p.draft, true, "and are not drafts");
  root = render(state);
  assert.deepEqual(groupHeadings(root),
    ["On the shop (0)", "Draft — not on the shop yet (0)", "Hidden — taken down (1)"],
    "the hidden product reads in the Hidden list");

  fire(buttonByText(root, "Unhide"));
  assert.equal(p.active, true, "unhiding puts it back on the shop");
  root = render(state);
  assert.deepEqual(groupHeadings(root),
    ["On the shop (1)", "Draft — not on the shop yet (0)", "Hidden — taken down (0)"]);
});

// ── Engine v76: the translated lines fold away, offered as a suggestion ─────
// The card is shut until its title is tapped and shuts again on a tap outside;
// each empty line is translated for her and offered as the app's ordinary grey
// suggestion, which the → takes and the ↻ (in its place) refreshes.

import { acceptSuggestion } from "../admin/js/suggest.js";

// The translation gate is off under node (translate.js only translates in a real
// online browser), so a test that exercises it turns it on for itself and puts
// it back afterwards — left on, the save paths would reach MyMemory for real.
async function online(fn) {
  const realNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const realFetch = globalThis.fetch;
  // Answer with the English that was sent, so a line's suggested words prove
  // which source text produced them.
  globalThis.fetch = async (url) => {
    const q = decodeURIComponent(String(url).split("q=")[1].split("&")[0]);
    return { ok: true, json: async () => ({ responseData: { translatedText: `T:${q}` } }) };
  };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  try {
    await fn();
  } finally {
    if (realNav) Object.defineProperty(globalThis, "navigator", realNav);
    else delete globalThis.navigator;
    globalThis.fetch = realFetch;
  }
}

// Let the translations an open triggers settle. The file's setTimeout is a
// synchronous stub, so only real microtasks count.
const settle = async (ticks = 25) => { for (let i = 0; i < ticks; i++) await null; };

const transHead = (root) => walk(root).find((n) => n.className === "trans-head");
const transBody = (root) => walk(root).find((n) => n.className === "trans-body");
// The field wrapper carries the same dataset.variant, so match the input itself.
const trBox = (root, variant) => walk(root).find((n) =>
  (n.tagName === "INPUT" || n.tagName === "TEXTAREA") && n.dataset && n.dataset.variant === variant);
const trRegen = (root, variant) => {
  const box = trBox(root, variant);
  return box ? (box.parent.children || []).find((c) => c.className === "tr-regen") : null;
};

test("the translated lines sit folded away and open on a tap of their title", () => {
  doc.body.replaceChildren();
  resetLayers();
  const root = render(freshState());

  assert.equal(transBody(root).hidden, true, "closed until it is asked for");
  fire(transHead(root));
  assert.equal(transBody(root).hidden, false, "tapping the title opens it");
  fire(transHead(root));
  assert.equal(transBody(root).hidden, true, "and tapping it again folds it back");
});

test("opening the card works out each line's translation and offers it as a suggestion", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const root = render(freshState());
    const f = formHandles(root);
    f.name.value = "Focaccia";
    f.unit.value = "u_loaf";
    f.desc.value = "Rosemary focaccia — golden, airy crumb";

    fire(transHead(root));
    await settle();

    const nameZh = trBox(root, "nameZh");
    assert.equal(nameZh.value, "", "the words are offered, never taken for her");
    assert.equal(nameZh.dataset.suggest, "T:Focaccia", "the → would insert the translation");
    assert.equal(nameZh.placeholder, "e.g. T:Focaccia……if blank, it will be filled with English",
      "the greyed text carries the wording and what blank means");
    assert.equal(trRegen(root, "nameZh").hidden, true, "no ↻ while the → is on offer");
    assert.equal(trBox(root, "descZh").dataset.suggest, "T:Rosemary focaccia — golden, airy crumb",
      "each line is translated from its own English");
  });
});

test("taking a suggested translation keeps the line machine text", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    const root = render(state);
    const f = formHandles(root);
    f.name.value = "Focaccia";
    f.unit.value = "u_loaf";
    fire(transHead(root));
    await settle();

    const nameZh = trBox(root, "nameZh");
    assert.equal(acceptSuggestion(nameZh), true, "the → takes the offered words");
    assert.equal(nameZh.value, "T:Focaccia");
    assert.equal(trRegen(root, "nameZh").hidden, false, "→ gives way to the ↻");
    assert.equal(nameZh.dataset.suggest, undefined, "nothing left on offer");

    fire(f.add);
    const saved = state.products[0];
    assert.equal(saved.nameZh, "T:Focaccia");
    assert.deepEqual(saved.trSrc, { nameZh: "Focaccia" },
      "recorded as machine text made from that English");
    assert.equal(saved.trOverride, undefined,
      "not recorded as hers — the auto-fill may still refresh this line");
    // Let the save's own quiet auto-fill finish while the stub is still in
    // place — otherwise it would run on for real once the gate is put back.
    await settle(200);
  });
});

test("typing a line's own words makes it hers and the ↻ goes away", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    const root = render(state);
    const f = formHandles(root);
    f.name.value = "Focaccia";
    f.unit.value = "u_loaf";
    fire(transHead(root));
    await settle();

    const nameZh = trBox(root, "nameZh");
    nameZh.value = "佛卡夏";
    nameZh.dispatchEvent(new Event("input"));
    assert.equal(trRegen(root, "nameZh").hidden, true, "her words are not a translation to redo");

    fire(f.add);
    const saved = state.products[0];
    assert.deepEqual(saved.trOverride, ["nameZh"], "the line is recorded as hers");
    assert.equal(saved.trSrc, undefined, "and not as machine text");
    assert.equal(saved.nameZh, "佛卡夏");
    await settle(200); // drain the save's auto-fill — see the note above
  });
});

test("the ↻ translates a line again in place and the line stays machine text", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    state.products = [{ id: "p1", name: "Focaccia", unit: "u_loaf", active: true,
      nameZh: "佛卡夏", trSrc: { nameZh: "Focaccia" } }];
    const root = render(state);

    fire(buttonByText(root, "Edit"));
    const pop = layers["popup-layer"];
    const nameZh = trBox(pop, "nameZh");
    assert.equal(nameZh.value, "佛卡夏", "the saved translation is in the box");
    assert.equal(trRegen(pop, "nameZh").hidden, false, "a line with words offers ↻");

    fire(trRegen(pop, "nameZh"));
    await settle();
    assert.equal(nameZh.value, "T:Focaccia", "↻ puts fresh words in the box");
    assert.equal(trRegen(pop, "nameZh").hidden, false, "and the line is still machine text");

    // The shim's <select> never reports the selected option the way a browser
    // does, so give it the value the loaded product would have put there.
    walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
    fire(buttonByText(pop, "Update product"));
    assert.equal(state.products[0].nameZh, "T:Focaccia");
    assert.deepEqual(state.products[0].trSrc, { nameZh: "Focaccia" });
    assert.equal(state.products[0].trOverride, undefined, "regenerating never freezes the line");
    await settle(200); // drain the update's auto-fill — see the note above
  });
});

test("a tap outside the card folds it away; a tap on a line leaves it open", () => {
  doc.body.replaceChildren();
  resetLayers();
  const root = render(freshState());
  fire(transHead(root));
  assert.equal(transBody(root).hidden, false, "open");

  fireDoc("pointerdown", { target: trBox(root, "nameZh") });
  assert.equal(transBody(root).hidden, false, "a tap on one of its lines keeps it open");

  fireDoc("pointerdown", { target: doc.body });
  assert.equal(transBody(root).hidden, true, "a tap anywhere outside folds it shut");
});
