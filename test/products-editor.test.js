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

// Freeze "now" so the Availability card's calendar is deterministic: Tue
// 1 September 2026. September 2026 opens with two blank cells, its Mondays are
// the 7th, 14th, 21st and 28th, and its Saturdays are the 5th, 12th, 19th, 26th.
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 1, 10, 0, 0);
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

import { renderProducts } from "../admin/js/views/products.js";

// A state with just enough to render the editor: a count unit to pick, and no
// products yet (the always-visible New product card).
function freshState() {
  return {
    settings: { currency: "RM", supabase: {}, deliveryDays: [1, 3, 5] },
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
  return {
    name: byPlaceholder("e.g. Chicken Jerky"),
    unit: nodes.find((n) => n.tagName === "SELECT"),
    desc: nodes.find((n) => n.tagName === "TEXTAREA"),
    closeDays: byPlaceholder("e.g. 14"),
    cancelDays: byPlaceholder("e.g. 2"),
    add: nodes.find((n) => n.tagName === "BUTTON"
      && (n.children || []).some((c) => c.text === "Add product")),
  };
}

const fire = (node) => (node._listeners.click || []).forEach((f) => f());

test("saving a product keeps its two date rules (close days + marked sell days)", () => {
  doc.body.replaceChildren();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  assert.ok(f.closeDays, "new-product card shows the Orders-close box");

  f.name.value = "CNY Gift Set";
  f.unit.value = "u_loaf";
  f.closeDays.value = "14";
  openAvail(root);
  fire(dowBtn(root, 6)); // the Saturday heading
  fire(dowBtn(root, 0)); // the Sunday heading
  fire(f.add);

  assert.equal(state.products.length, 1);
  const saved = state.products[0];
  assert.equal(saved.name, "CNY Gift Set");
  assert.equal(saved.closeDays, 14, "typed close days round-trip onto the product");
  assert.deepEqual(byDow(saved.sellRules), [
    { days: [0], from: "2026-09-01", to: "2026-09-30" },
    { days: [6], from: "2026-09-01", to: "2026-09-30" },
  ], "each heading marks that weekday for the month shown, and nothing beyond it");
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
  doc.body.replaceChildren();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal(state.products.length, 1);
  const saved = state.products[0];
  assert.equal(saved.closeDays, undefined, "blank close box = no early close");
  assert.equal(saved.sellRules, undefined, "no marks at all = every delivery day");
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

test("an older product's from–to window opens in the card as one mark, and a save writes it back as one", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.products = [{ id: "p1", name: "CNY Gift Set", unit: "u_loaf", active: true,
    validFrom: "2026-12-01", validTo: "2026-12-24" }];
  const root = render(state);
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];

  const a = availHandles(pop);
  assert.equal(a.summary.textContent, "1-24 Dec 2026",
    "the header reads the old window without the card ever being opened");

  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));

  const saved = state.products[0];
  assert.deepEqual(saved.sellRules, [{ days: [], from: "2026-12-01", to: "2026-12-24" }]);
  assert.equal(saved.validFrom, undefined, "the old pair is dropped — its period survives as a mark");
  assert.equal(saved.validTo, undefined);
});

test("a backwards pair is swapped rather than refused — a drag may go either way", () => {
  doc.body.replaceChildren();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Backwards Window";
  f.unit.value = "u_loaf";
  openAvail(root);
  tapCell(root, 5);                       // one-day mark, 5 Sep 2026
  pickDate(root, "Ends", "1");            // stretch its end back before its start
  fire(f.add);

  assert.equal(state.products.length, 1, "the product is saved, not refused");
  assert.deepEqual(state.products[0].sellRules, [{ days: [], from: "2026-09-01", to: "2026-09-05" }],
    "the two ends are read the way round they actually are");
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

// Her report: "after publish a product, only delete is allow, it should not be."
// A product that is on the shop has to be takeable off it without destroying the
// recipe, so Hide is on every live row — history/use only decides whether Delete
// sits beside it. Hide is reversible, so like Publish and Unhide it takes one tap.
test("a freshly published product offers Hide beside Delete; Hide keeps the recipe, Delete really deletes", () => {
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
  p.recipe = [{ ingredientId: "ing_flour", qty: 50, unit: "g" }];

  root = render(state);
  assert.ok(buttonByText(root, "Hide"), "a live product can always be taken off the shop");
  assert.ok(buttonByText(root, "Delete"), "and a clean one can still be deleted outright");

  fire(buttonByText(root, "Hide"));
  assert.equal(p.active, false, "Hide takes it off the shop");
  assert.notEqual(p.draft, true, "hidden is not a draft");
  assert.equal(state.products.length, 1, "Hide never removes the product");
  assert.deepEqual(p.recipe, [{ ingredientId: "ing_flour", qty: 50, unit: "g" }],
    "the recipe survives Hide — that is the whole reason Delete must not be the only way off the shop");
  root = render(state);
  assert.deepEqual(groupHeadings(root),
    ["On the shop (0)", "Draft — not on the shop yet (0)", "Hidden — taken down (1)"],
    "it reads in the Hidden list");

  fire(buttonByText(root, "Unhide"));
  root = render(state);
  fire(buttonByText(root, "Delete"));
  const yes = walk(layers["confirm-layer"]).find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "Delete"));
  assert.ok(yes, "a clean product's Delete asks first");
  fire(yes);
  assert.equal(state.products.length, 0, "and then really removes it");
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

  // History keeps Delete off the row (it would break the PO and the history), so
  // Hide is the only way down — and it is still there.
  state.orders = [{ id: "o1", productId: p.id, qty: 1, customerName: "Aisyah", whatsapp: "60123456789" }];
  root = render(state);
  assert.ok(buttonByText(root, "Hide"), "a product with orders can be hidden");
  assert.ok(!buttonByText(root, "Delete"), "a product with orders is never deleted, so Delete is not offered");
  fire(buttonByText(root, "Hide"));
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
    assert.equal(nameZh.placeholder, "e.g. T:Focaccia",
      "the greyed text is the wording on offer, and nothing that a one-line box would cut off");
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

// The greyed words on an empty line ARE an offer, and the → is how it is taken.
// So the two are set together and can never disagree: a line showing machine
// words must have the arrow over them, and a line with no arrow must not be
// dangling words nothing will take. A line the baker has made hers — typed into,
// or emptied on purpose — is left alone, with the ↻ as her way back.
const BLANK_HINT = "Left blank — English shows.";

test("a line she emptied by hand goes quiet: no greyed machine words, and no → over them", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    // Blank, and recorded as HERS: the baker deleted the Chinese on purpose, so
    // the shop shows the English for this line.
    state.products = [{ id: "p1", name: "Focaccia", unit: "u_loaf", active: true,
      trOverride: ["nameZh"] }];
    const root = render(state);

    fire(buttonByText(root, "Edit"));
    const pop = layers["popup-layer"];
    fire(transHead(pop));
    await settle();

    const nameZh = trBox(pop, "nameZh");
    assert.equal(nameZh.value, "", "the box is still blank — nothing was put back");
    assert.equal(nameZh.dataset.suggest, undefined, "no → on a line she emptied herself");
    assert.equal(nameZh.placeholder, BLANK_HINT,
      "the line says what blank means, rather than offering words with no arrow to take them");
    assert.equal(trRegen(pop, "nameZh").hidden, false, "the ↻ stays as her way back to a translation");
  });
});

test("typing into a line and then emptying it leaves the hint and the → agreeing", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const root = render(freshState());
    const f = formHandles(root);
    f.name.value = "Focaccia";
    f.unit.value = "u_loaf";
    fire(transHead(root));
    await settle();

    const nameZh = trBox(root, "nameZh");
    assert.equal(nameZh.dataset.suggest, "T:Focaccia", "an untouched line is offered the words");

    nameZh.value = "佛卡夏"; // her own words
    nameZh.dispatchEvent(new Event("input"));
    nameZh.value = "";       // and then she changes her mind
    nameZh.dispatchEvent(new Event("input"));

    assert.equal(nameZh.value, "", "the box is empty again");
    assert.equal(nameZh.dataset.suggest, undefined, "the → does not come back with the words");
    assert.equal(nameZh.placeholder, BLANK_HINT,
      "nor does the greyed translation, which the missing arrow could not have taken");
    assert.equal(trRegen(root, "nameZh").hidden, false, "the ↻ is left as the way back");
  });
});

test("a line she emptied whose English also went blank still asks for the English", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    // The Chinese line was emptied by hand, and there is no description either —
    // so there is nothing to translate and nothing for the customer to fall back
    // to. The line must say so rather than promise an English that does not exist.
    state.products = [{ id: "p1", name: "Focaccia", unit: "u_loaf", active: true,
      trOverride: ["descZh"] }];
    const root = render(state);

    fire(buttonByText(root, "Edit"));
    const pop = layers["popup-layer"];
    fire(transHead(pop));
    await settle();

    const descZh = trBox(pop, "descZh");
    assert.equal(descZh.placeholder, "Needs the English above first",
      "no English means nothing to offer and nothing to fall back to");
    assert.equal(descZh.dataset.suggest, undefined, "and nothing for the → to take");
  });
});

test("a line the baker emptied stays empty: the save keeps it blank and hers", async () => {
  await online(async () => {
    doc.body.replaceChildren();
    resetLayers();
    const state = freshState();
    state.products = [{ id: "p1", name: "Focaccia", unit: "u_loaf", active: true,
      nameZh: "佛卡夏", trSrc: { nameZh: "Focaccia" } }];
    const root = render(state);

    fire(buttonByText(root, "Edit"));
    const pop = layers["popup-layer"];
    fire(transHead(pop));
    await settle();

    const nameZh = trBox(pop, "nameZh");
    assert.equal(nameZh.value, "佛卡夏", "the saved translation is in the box");
    nameZh.value = ""; // she deletes it
    nameZh.dispatchEvent(new Event("input"));

    // The shim's <select> never reports the selected option the way a browser
    // does, so give it the value the loaded product would have put there.
    walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
    fire(buttonByText(pop, "Update product"));
    await settle(200); // drain the update's auto-fill — see the note above

    const saved = state.products[0];
    assert.equal(saved.nameZh, undefined, "the translation is gone from the saved product");
    assert.deepEqual(saved.trOverride, ["nameZh"], "and the line is recorded as hers");
    assert.ok(!(saved.trSrc && "nameZh" in saved.trSrc),
      "with no machine provenance left on the line she emptied");
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

// ── Engine v82: the Availability card — a product's sell days, marked on a calendar ──
//
// The clock is frozen to Tue 1 September 2026 (see MockDate above), so the calendar
// opens on a month whose Mondays are the 7th/14th/21st/28th and whose Saturdays are
// the 5th/12th/19th/26th, and every day from the 1st on is tappable.

// The card itself: header button, body, header summary. `open` is separate because
// the body is only built once the header is tapped.
const availHead = (root) => walk(root).find((n) => n.className === "fold-head"
  && walk(n).some((c) => c.className === "avail-sum"));
const availHandles = (root) => ({
  head: availHead(root),
  summary: walk(availHead(root)).find((n) => n.className === "avail-sum"),
  body: walk(root).find((n) => n.className === "fold-body avail-body"),
});
const openAvail = (root) => { const a = availHandles(root); fire(a.head); return a; };

// The month grid, re-read every time: every gesture repaints the card from scratch,
// so a handle kept across a gesture would be pointing at a detached node.
const availGrid = (root) => walk(root).find((n) => n.className === "cal-grid");
const dowBtn = (root, dow) => availGrid(root).children
  .filter((c) => (c.className || "").includes("avail-dow"))[dow];
const cellBtn = (root, dayNum) => availGrid(root).children
  .find((c) => (c.className || "").includes("cal-cell") && (c.children[0] || {}).text === String(dayNum));
// The "Marked periods" rows: the label button and its ✕.
const markRows = (root) => walk(root)
  .filter((n) => (n.className || "").split(" ").includes("avail-row"));
const markLabels = (root) => markRows(root).map((r) => r.children[0].children[0].text);

// The shim's elementFromPoint stand-in: whatever cell the next gesture is over.
let hitCell = null;
doc.elementFromPoint = () => (hitCell
  ? { closest: (sel) => (sel === ".cal-cell.tappable" ? hitCell : null) }
  : null);

function gesture(root, fromDay, toDay) {
  const grid = availGrid(root);
  const down = grid._listeners.pointerdown[0];
  const move = grid._listeners.pointermove[0];
  const up = grid._listeners.pointerup[0];
  hitCell = cellBtn(root, fromDay);
  down({ target: { closest: () => null }, clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} });
  if (toDay != null) {
    hitCell = cellBtn(root, toDay);
    move({ clientX: 0, clientY: 0, pointerId: 1 });
  }
  up({ clientX: 0, clientY: 0, pointerId: 1 });
  hitCell = null;
}
const tapCell = (root, dayNum) => gesture(root, dayNum, null);

// The Ends date field, opened by its button and answered by tapping a day number
// (the datepicker's cells carry no date of their own — this is the free-date field,
// where every day of the month is offered).
function pickDate(root, label, dayNum) {
  const field = walk(root).find((n) => n.className === "field"
    && (n.children[0] || {}).tagName === "LABEL"
    && (n.children[0].children[0] || {}).text === label);
  assert.ok(field, `the card offers a ${label} field`);
  fire(walk(field).find((n) => (n.className || "").includes("datepick-btn")));
  const panel = walk(field).find((n) => n.className === "datepick-panel");
  const cell = walk(panel).find((n) => n.tagName === "BUTTON"
    && (n.className || "").includes("cal-cell")
    && (n.children[0] || {}).text === String(dayNum));
  assert.ok(cell, `the ${label} calendar offers day ${dayNum}`);
  fire(cell);
}

// Marks compared by weekday first, so the order tidy() settled on never matters.
const byDow = (rules) => (rules || []).slice()
  .sort((a, b) => (a.days[0] ?? 9) - (b.days[0] ?? 9) || (a.from || "").localeCompare(b.from || ""));

test("the Availability card folds away, and an untouched product reads Every day", () => {
  doc.body.replaceChildren();
  resetLayers();
  const root = render(freshState());
  const a = availHandles(root);

  assert.ok(a.head, "the card has a fold-away header");
  assert.equal(a.head.children[0].children[0].text, "Availability");
  assert.equal(a.summary.textContent, "Every day", "nothing marked is the honest answer");
  assert.equal(a.body.hidden, true, "it starts closed — this is setup, not daily use");

  fire(a.head);
  assert.equal(a.body.hidden, false, "the header is a button and opens it");
  assert.ok(availGrid(root), "and the calendar is drawn");
  assert.equal(dowBtn(root, 1).children[0].text, "M", "the weekday headings are buttons");
  assert.equal(cellBtn(root, 28).dataset.date, "2026-09-28", "each day cell knows its own date");

  fire(a.head);
  assert.equal(a.body.hidden, true, "a second tap closes it again");
});

test("a tap outside the card folds it away; a tap on the calendar leaves it open", () => {
  doc.body.replaceChildren();
  resetLayers();
  const root = render(freshState());
  fire(availHead(root));
  assert.equal(availHandles(root).body.hidden, false, "open");

  fireDoc("pointerdown", { target: cellBtn(root, 10) });
  assert.equal(availHandles(root).body.hidden, false, "a tap on the calendar keeps it open");

  fireDoc("pointerdown", { target: doc.body });
  assert.equal(availHandles(root).body.hidden, true, "a tap anywhere outside folds it shut");
});

test("a weekday heading marks every one of that weekday in the month shown, and takes it back", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);

  fire(dowBtn(root, 1)); // M
  assert.deepEqual(markLabels(root), ["Mon · 1-30 Sep 2026"], "one mark, bounded by the month");
  assert.ok((dowBtn(root, 1).className || "").includes("avail-dow-on"), "the M heading shows it is marked");
  assert.ok((cellBtn(root, 7).className || "").includes("avail-on"), "and so does the Monday itself");
  assert.equal(cellBtn(root, 8).className.includes("avail-on"), false, "a Tuesday is untouched");

  fire(dowBtn(root, 1)); // M again
  assert.deepEqual(markLabels(root), [], "a second tap on the same heading takes it back");
  assert.equal(cellBtn(root, 7).className.includes("avail-on"), false);
});

test("tapping one day marks just that day", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);
  tapCell(root, 12);

  assert.deepEqual(markLabels(root), ["12 Sep 2026"], "a one-day mark, not the month");
  assert.ok((cellBtn(root, 12).className || "").includes("avail-on"));
  assert.equal(cellBtn(root, 19).className.includes("avail-on"), false, "the same weekday is not caught");
});

test("the sell-day calendar draws the baker's occasion marks too", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.occasions = [
    { id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
    { id: "y", label: "School break", from: "2026-09-21", to: "2026-09-30", colour: "blue" },
  ];
  const root = render(state);
  openAvail(root);

  const day = cellBtn(root, 16);
  assert.ok(day.className.includes("sol"), "a one-day holiday is a wash box on its own day");
  assert.ok(day.className.includes("occ-red"), "in the mark's own colour");
  assert.ok(day.className.includes("occ-strong"), "at the depth a mark that short gets");
  assert.equal(cellBtn(root, 15).className.includes("sol"), false, "an unmarked day stays plain");

  const bands = availGrid(root).children
    .filter((c) => (c.className || "").includes("occ-paper"));
  assert.equal(bands.length, 2, "the 10-day mark bands the two week rows it crosses");
  assert.ok(bands.every((b) => (b.className || "").includes("occ-blue")),
    "in the mark's own colour");
  assert.ok(bands.every((b) => (b.className || "").includes("occ-mid")),
    "at the depth a mark that long gets");
});

// Her ask: a marked day says its own name when tapped, on every calendar in the
// app. Here the tap does its usual job as well — marking the sell day — which is
// exactly the shop page's rule ("a day is tapped to read its name AND to choose
// it"), and the bubble is built into the cell so the card's repaint redraws it.
test("tapping a marked day on the availability calendar names it as well as marking it", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.occasions = [
    { id: "x", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
  ];
  const root = render(state);
  openAvail(root);

  const tipOf = (dayNum) => (cellBtn(root, dayNum).children || [])
    .find((c) => c.className === "cal-tip");
  assert.ok(tipOf(16), "a marked day carries its name, waiting to be asked for");
  assert.equal(tipOf(16).hidden, true, "and says nothing until it is tapped");
  assert.equal(tipOf(16).children[0].text, "Malaysia Day");
  assert.equal(tipOf(15), undefined, "an unmarked day has no name to give");

  tapCell(root, 16);
  assert.ok((cellBtn(root, 16).className || "").includes("avail-on"), "the tap still marks the day");
  assert.equal(tipOf(16).hidden, false, "and now it says what the day is");

  tapCell(root, 20); // an unmarked day: nothing to say
  assert.equal(tipOf(16).hidden, true, "tapping another day puts the name away again");
  assert.equal(tipOf(20), undefined);
});

test("sliding across days marks the run", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);
  gesture(root, 7, 11);

  assert.deepEqual(markLabels(root), ["7-11 Sep 2026"]);
  assert.ok((cellBtn(root, 9).className || "").includes("avail-on"), "every day of the run sells");
  assert.equal(cellBtn(root, 12).className.includes("avail-on"), false, "the day after the run does not");
});

test("tapping a marked day takes back only that day, leaving the rest of the run", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);
  gesture(root, 7, 11);
  tapCell(root, 9); // middle of the run

  assert.deepEqual(byDow([
    { days: [], from: "2026-09-07", to: "2026-09-08" },
    { days: [], from: "2026-09-10", to: "2026-09-11" },
  ]), byDow([
    { days: [], from: "2026-09-07", to: "2026-09-08" },
    { days: [], from: "2026-09-10", to: "2026-09-11" },
  ]));
  assert.deepEqual(markLabels(root), ["7-8 Sep 2026", "10-11 Sep 2026"],
    "the run is split around the day she took back");
  assert.equal(cellBtn(root, 9).className.includes("avail-on"), false);
});

test("a weekday heading and a single day write different rules", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);
  fire(dowBtn(root, 1)); // every Monday in September
  tapCell(root, 15);     // then a single Tuesday

  assert.deepEqual(markLabels(root).slice().sort(),
    ["15 Sep 2026", "Mon · 1-30 Sep 2026"].sort(),
    "the heading writes a month-long weekday mark; the day writes just that day");
  assert.equal(cellBtn(root, 15).className.includes("avail-on"), true);
  assert.equal(cellBtn(root, 1).className.includes("avail-on"), false, "the 1st is a Tuesday, not the 15th");
});

test("a mark's two ends can be cleared, making it run on from here or up to here", () => {
  doc.body.replaceChildren();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  openAvail(root);
  tapCell(root, 12);
  fire(buttonByText(root, "Clear end"));
  fire(f.add);

  assert.deepEqual(state.products[0].sellRules, [{ days: [], from: "2026-09-12", to: "" }],
    "an open end is how a mark says 'from here on' without naming a second date");
});

test("the ✕ takes a mark out of the list", () => {
  doc.body.replaceChildren();
  const root = render(freshState());
  openAvail(root);
  fire(dowBtn(root, 1));
  fire(dowBtn(root, 6));
  assert.equal(markLabels(root).length, 2);

  fire(markRows(root)[0].children[1]); // the first row's ✕
  assert.equal(markLabels(root).length, 1, "only the mark that was tapped goes");
});

test("a mark that has already ended is kept — a dated special stays dated", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.products = [{ id: "p1", name: "CNY Gift Set", unit: "u_loaf", active: true,
    validFrom: "2026-08-01", validTo: "2026-08-15" }]; // a finished window, before today
  const root = render(state);
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];
  assert.equal(availHandles(pop).summary.textContent, "1-15 Aug 2026", "the finished mark is what the product holds");

  fire(availHead(pop));
  tapCell(pop, 20);
  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));

  assert.deepEqual(byDow(state.products[0].sellRules), [
    { days: [], from: "2026-08-01", to: "2026-08-15" },
    { days: [], from: "2026-09-20", to: "2026-09-20" },
  ], "the finished mark is kept: dropping it would leave no marks, and no marks means every day");
});

test("taking the last mark off is the one way back to selling every delivery day", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.products = [{ id: "p1", name: "CNY Gift Set", unit: "u_loaf", active: true,
    sellRules: [{ days: [], from: "2026-09-10", to: "2026-09-20" }] }];
  const root = render(state);
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];
  fire(availHead(pop));
  assert.equal(markLabels(pop).length, 1);

  fire(markRows(pop)[0].children[1]); // the ✕
  assert.deepEqual(markLabels(pop), [], "the card says so plainly");
  assert.equal(availHandles(pop).summary.textContent, "Every day");

  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));
  assert.equal(state.products[0].sellRules, undefined,
    "and the saved product carries no marks at all, which the shop reads as every delivery day");
});

// ── Engine v90: the "keep it on the shop" switch ─────────────────────────────

// The switch's real <input>, under `.avail-listed`. Every gesture rebuilds the
// body, so read it fresh — never hold a handle across a repaint.
const listedSwitch = (root) => {
  const row = walk(root).find((n) => n.className === "avail-listed");
  assert.ok(row, "the Availability card carries the keep-it-listed switch");
  const box = walk(row).find((n) => n.tagName === "INPUT");
  assert.equal(box.attrs.type, "checkbox", "a real checkbox underneath, like every other boolean");
  return box;
};
// The shim does not flip .checked on a tap, so a tick is set and then announced.
const setSwitch = (root, on) => {
  const box = listedSwitch(root);
  box.checked = on;
  (box._listeners.change || []).forEach((f) => f({ target: box }));
};

test("a new product's switch sits above the sell-day calendar, off, and writes nothing", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Signature Focaccia";
  f.unit.value = "u_loaf";
  const a = openAvail(root);

  assert.equal(listedSwitch(root).checked, false, "absent on the product means off — today's behaviour");
  // It reads above the marks: the switch decides whether the card survives a day
  // it cannot be ordered on, the calendar decides which days those are.
  assert.equal(a.body.children[0].className, "avail-listed", "the switch is the first thing in the card");
  assert.ok(a.body.children.findIndex((c) => c.className === "cal-grid") > 0, "…and above the calendar");

  fire(f.add);
  assert.equal("alwaysListed" in state.products[0], false,
    "an untouched switch writes no key at all — no product she never opens changes");
});

test("ticking the switch saves it, and the folded header reads the state", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Signature Focaccia";
  f.unit.value = "u_loaf";
  const a = openAvail(root);

  setSwitch(root, true);
  assert.equal(a.summary.textContent, "Every day · kept on the shop",
    "the header says it without opening the card again");
  fire(f.add);
  assert.equal(state.products[0].alwaysListed, true, "and it is saved on the product");
});

test("a kept product opens with the switch on, survives a repaint, and saves off again", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.products = [{ id: "p1", name: "Signature Focaccia", unit: "u_loaf", active: true, alwaysListed: true }];
  const root = render(state);
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];
  openAvail(pop);

  assert.equal(listedSwitch(pop).checked, true, "the saved choice comes back on");
  assert.equal(availHandles(pop).summary.textContent, "Every day · kept on the shop");

  // A repaint rebuilds the whole body from the closure — the switch must come
  // back still on, not reset to a fresh, unchecked node.
  fire(dowBtn(pop, 6));
  assert.equal(listedSwitch(pop).checked, true, "marking a day neither loses nor flips the switch");
  assert.match(availHandles(pop).summary.textContent, /· kept on the shop$/,
    "and the header keeps saying so beside the new mark");

  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));
  assert.equal(state.products[0].alwaysListed, true, "kept, alongside the mark it just gained");

  // Now take it off. The key goes entirely, so an absent key reads as off — the
  // product returns to byte-for-byte today's behaviour.
  fire(buttonByText(root, "Edit"));
  const pop2 = layers["popup-layer"];
  openAvail(pop2);
  setSwitch(pop2, false);
  assert.equal(availHandles(pop2).summary.textContent.includes("kept on the shop"), false,
    "the header drops the suffix with the switch");
  walk(pop2).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop2, "Update product"));
  assert.equal("alwaysListed" in state.products[0], false, "the key is deleted, not set to false");
});

// ── Engine v226: "Can travel as a parcel" ────────────────────────────────────
// The second KIND of courier is a parcel she books herself and the app only records.
// This tick is deliberately not a switch the app obeys: it changes NOTHING about what
// an order can do, and it is written only when ON, so a
// product she never opens is byte-for-byte unchanged.

// Found by its OWN field label, never by walking order: the page now carries two
// `.avail-listed` switches, and a helper that took the first one would quietly
// measure the availability switch in one test and the parcel tick in the next.
const parcelField = (root) => walk(root).find((n) => n.nodeType === 1
  && String(n.className).includes("field")
  && walk(n).some((c) => c.tagName === "LABEL" && (c.children || []).some((x) => x.text === "Can travel as a parcel")));
const parcelSwitch = (root) => {
  const f = parcelField(root);
  assert.ok(f, "the editor offers a Can travel as a parcel tick");
  return walk(f).find((n) => n.tagName === "INPUT");
};
const setParcel = (root, on) => {
  const box = parcelSwitch(root);
  box.checked = on;
  (box._listeners.change || []).forEach((fn) => fn({ target: box }));
};

test("the parcel tick is its own field, below the calendar, and OFF writes nothing", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Almond biscuits";
  f.unit.value = "u_loaf";

  assert.equal(parcelSwitch(root).checked, false, "absent on the product means not parcel-able");
  // The availability switch is still the FIRST `.avail-listed` on the page: adding
  // this second one must not have moved the switch that was already there.
  assert.ok(walk(walk(root).find((n) => n.className === "avail-listed")).includes(listedSwitch(root)),
    "the first .avail-listed on the page is still the keep-it-listed switch, so nothing that read it by order moved");
  assert.ok(walk(parcelField(root)).some((n) => String(n.className).includes("avail-listed-text")
    && (n.children || []).some((c) => String(c.text || "").includes("never blocks an order"))),
    "and it says in words that it gates nothing");

  fire(f.add);
  assert.equal("parcel" in state.products[0], false,
    "an untouched tick writes no key at all — no product she never opens changes");
});

test("ticking the parcel box saves it, and unticking takes the key back off", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Almond biscuits";
  f.unit.value = "u_loaf";
  setParcel(root, true);
  fire(f.add);
  assert.equal(state.products[0].parcel, true, "saved on the product");

  // Now take it off. The key goes entirely, so an absent key reads as "not
  // parcel-able" — the product returns to byte-for-byte today's shape.
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];
  assert.equal(parcelSwitch(pop).checked, true, "the saved choice comes back on");
  setParcel(pop, false);
  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));
  assert.equal("parcel" in state.products[0], false, "the key is deleted, not set to false");
});

test("the parcel tick is not a gate: an unticked product is still sold and still orderable", () => {
  // The tick exists to make ONE sentence possible — the advisory on a courier order
  // naming a line that probably should not go in a parcel network. If it ever grew a
  // second job, it would show up here as an availability mark or an inactive product.
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.products = [{ id: "p1", name: "Fresh Focaccia", unit: "u_loaf", price: 15, active: true }];
  const root = render(state);
  fire(buttonByText(root, "Edit"));
  const pop = layers["popup-layer"];
  walk(pop).find((n) => n.tagName === "SELECT").value = "u_loaf";
  fire(buttonByText(pop, "Update product"));

  const p = state.products[0];
  assert.notEqual(p.active, false, "it is still on the shop");
  assert.equal("parcel" in p, false);
  assert.equal(p.sellRules, undefined, "and no sell-day rule was written on its behalf");
  assert.ok(buttonByText(root, "Hide"), "it can still be taken off the shop the ordinary way");
});

// ── the New product card folds away (v91) ────────────────────────────────────
// The card is the screen's setup part, and left open it pushed the three product
// lists she came to read off the bottom of the page. It now arrives as one line
// ("＋ New product") and opens on its own title, exactly like the ＋ New order
// card on Orders.
const newCard = (root) => root.children[0];
const newHead = (root) => newCard(root).children[0];
const newBody = (root) => newCard(root).children[1];
const newCaret = (root) => newHead(root).children[1];

test("the New product card arrives folded, and its own title opens it", () => {
  const root = render(freshState());
  assert.equal(newHead(root).tagName, "BUTTON", "the title is the control, as everywhere else");
  assert.equal(newHead(root).children[0].children[0].text, "＋ New product");
  assert.equal(newBody(root).hidden, true, "and the add form is folded away to begin with");
  assert.equal(newCaret(root).children[0].text, "▸", "the caret points right, as on every folded card");

  fire(newHead(root));
  assert.equal(newBody(root).hidden, false, "tapping the title opens it");
  assert.equal(newCaret(root).textContent, "▾");

  fire(newHead(root));
  assert.equal(newBody(root).hidden, true, "tapping it again folds it back");
  assert.equal(newCaret(root).textContent, "▸", "and the caret turns back with it");
});

test("a tap outside folds it, a tap inside does not, and adding a product leaves it open", () => {
  const state = freshState();
  const root = render(state);
  fire(newHead(root));

  fireDoc("pointerdown", { target: walk(root.children[0]).find((n) => n.tagName === "INPUT") });
  assert.equal(newBody(root).hidden, false, "a tap inside the form does not fold it under her");

  fireDoc("pointerdown", { target: doc.body });
  assert.equal(newBody(root).hidden, true, "a tap anywhere else folds it away");

  // Adding a product re-renders the card around her: it must not slam shut
  // mid-flow, so the next one can be typed straight away.
  fire(newHead(root));
  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);
  assert.equal(state.products.length, 1);
  assert.equal(newBody(root).hidden, false, "the card stays open after a product is saved");

  // …and coming back to the screen later starts it folded again.
  const fresh = doc.createElement("div");
  renderProducts(fresh, state);
  assert.equal(newBody(fresh).hidden, true, "a fresh visit folds it away");
});

// ── The category picker ──────────────────────────────────────────────────────
// Written after a real bug: the categories block in collect() referenced `values`
// before its own `const values = {...}` line, which is only a crash when the
// branch RUNS — and no test had ever ticked a category, so nothing ran it. The
// editor had no coverage here at all, which is how it got through.

const catPicks = (root) => walk(root).filter((n) => n.tagName === "INPUT"
  && n.parent && String(n.parent.className).startsWith("cat-pick"));

// The shim's change event carries nothing the view reads — the handler closes
// over its own box — so setting `checked` first is the whole of the gesture.
const tick = (node, on = true) => {
  node.checked = on;
  (node._listeners.change || []).forEach((f) => f({ target: node }));
};

// The line under a product's name on the Products page, which is where she reads
// off what a customer will see. Its words are a text CHILD, not `.textContent`:
// el() appends a text node, and the shim does not merge those into a string.
const catLine = (root) => {
  const p = walk(root).find((n) => String(n.className).includes("po-breakdown"));
  return p ? (p.children || []).map((c) => c.text ?? "").join("") : null;
};

test("the product card names the heading it is listed under, and the ticks that lost", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [
    { id: "cat_food", name: "Food", parentId: "", sort: 0 },
    { id: "cat_savoury", name: "Savoury", parentId: "cat_food", sort: 0 },
    { id: "cat_snack", name: "Snack", parentId: "", sort: 1 },
  ];
  state.products = [{ id: "p1", name: "Brownies", unit: "u_loaf", price: 25,
    categories: ["cat_snack", "cat_food", "cat_savoury"] }];

  const root = render(state);
  assert.equal(catLine(root), "🗂 Snack · also ticked: Food, Food › Savoury",
    "the heading it lists under first, then every other tick NAMED — a bare count leaves her to go and find which one");
});

test("the product card says a nested heading by its whole path", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [
    { id: "cat_food", name: "Food", parentId: "", sort: 0 },
    { id: "cat_savoury", name: "Savoury", parentId: "cat_food", sort: 0 },
  ];
  state.products = [{ id: "p1", name: "Sourdough", unit: "u_loaf", price: 18,
    categories: ["cat_savoury"] }];

  assert.equal(catLine(render(state)), "🗂 Food › Savoury",
    "\"Savoury\" alone would not say which parent it hangs from");
});

test("the product card of a product filed nowhere says where it goes instead", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [{ id: "cat_food", name: "Food", parentId: "", sort: 0 }];
  state.products = [{ id: "p1", name: "Muffin", unit: "u_loaf", price: 6 }];

  assert.equal(catLine(render(state)),
    "Not in a category yet — listed last on the shop, under “More items”.");
});

test("a tick pointing at a category that is gone is not named on the card", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [{ id: "cat_food", name: "Food", parentId: "", sort: 0 }];
  state.products = [{ id: "p1", name: "Ghosted", unit: "u_loaf", price: 5,
    categories: ["cat_food", "cat_vanished"] }];

  assert.equal(catLine(render(state)), "🗂 Food",
    "a heading deleted on the other phone must not be read back to her here");
});

test("a product is filed under the FIRST category ticked, and the tick order is kept", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [
    { id: "cat_food", name: "Food", parentId: "", sort: 0 },
    { id: "cat_drink", name: "Drink", parentId: "", sort: 1 },
    { id: "cat_snack", name: "Snack", parentId: "", sort: 2 },
  ];
  const root = render(state);
  const picks = catPicks(root);
  assert.equal(picks.length, 3, "one box per category, in the order she built them");

  // Ticked in a deliberate order that is NOT the list's order: Snack, then Food.
  tick(picks[2]);
  tick(picks[0]);

  const f = formHandles(root);
  f.name.value = "Focaccia";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal(state.products.length, 1);
  assert.deepEqual(state.products[0].categories, ["cat_snack", "cat_food"],
    "stored in the order she ticked them, because the first is the heading it lands under");
});

test("a product filed nowhere carries no categories key at all", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [{ id: "cat_food", name: "Food", parentId: "", sort: 0 }];
  const root = render(state);
  assert.equal(catPicks(root).length, 1);

  const f = formHandles(root);
  f.name.value = "Plain Loaf";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal("categories" in state.products[0], false,
    "absent, so the shop reads it as unfiled and lists it last rather than hiding it");
});

test("unticking the only category forgets the key again", () => {
  doc.body.replaceChildren();
  const state = freshState();
  state.productCategories = [{ id: "cat_food", name: "Food", parentId: "", sort: 0 }];
  const root = render(state);
  const picks = catPicks(root);
  tick(picks[0]);
  tick(picks[0], false);   // changed her mind before saving

  const f = formHandles(root);
  f.name.value = "Plain Loaf";
  f.unit.value = "u_loaf";
  fire(f.add);

  assert.equal("categories" in state.products[0], false);
});

test("editing a saved product reopens with its own category already ticked", () => {
  doc.body.replaceChildren();
  resetLayers();
  const state = freshState();
  state.productCategories = [
    { id: "cat_food", name: "Food", parentId: "", sort: 0 },
    { id: "cat_drink", name: "Drink", parentId: "", sort: 1 },
  ];
  state.products = [{ id: "prd_1", name: "Focaccia", price: 5, unit: "loaf",
    categories: ["cat_drink"] }];

  const root = render(state);
  // The product row's Edit button opens the pop-up; its fields live in the
  // popup layer, which is where the picker is rendered from.
  const edit = walk(root).find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "Edit"));
  fire(edit);

  const picks = catPicks(layers["popup-layer"]);
  assert.equal(picks.length, 2);
  assert.equal(picks[0].checked, false, "Food is not ticked");
  assert.equal(picks[1].checked, true, "Drink is, because that is where it is filed");

  // The unit menu, set the way the neighbouring edit test sets it: the shim's
  // select() tracks the choice on the closure rather than on the node, so a
  // pop-up opened in the shim reads back an empty unit and its save is refused
  // before anything is written.
  walk(layers["popup-layer"]).find((n) => n.tagName === "SELECT").value = "u_loaf";

  // Ticking Food as well: Drink is still the first, so the heading does not move.
  tick(picks[0]);
  const saves = walk(layers["popup-layer"]).filter((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "Update product"));
  assert.equal(saves.length, 1, "exactly one Update button in the layer");
  fire(saves[0]);

  assert.deepEqual(state.products[0].categories, ["cat_drink", "cat_food"],
    "the heading it already had stays first — ticking another does not displace it");
});
