// test/ingredients-editor.test.js — the Ingredients editor's private Note box.
// Renders the real view under a tiny DOM shim and drives the Add button, so the
// optional note the owner types actually lands on the saved ingredient and on
// its card — and a blank note saves cleanly (the note is private to the card:
// it never rides into a product recipe, which this view never renders anyway).

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim (mirrors test/products-editor.test.js) ---
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {},
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
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
const registry = {};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  // By id so the shared pop-up layer (ui.js showPopup) has somewhere to fill.
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
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

import { renderIngredients } from "../admin/js/views/ingredients.js";

// A state with just enough to render the Ingredients master: a weight unit to
// cook in, no suppliers/products, and no ingredients yet.
function freshState() {
  return {
    settings: { currency: "RM", supabase: {} },
    uoms: [
      { id: "u_g", name: "g", family: "weight", toBase: 1 },
      { id: "u_kg", name: "kg", family: "weight", toBase: 1000 },
    ],
    suppliers: [],
    ingredients: [],
    products: [],
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
  renderIngredients(root, state);
  return root;
}

// The New ingredient card is always root.children[0].
function formHandles(root) {
  const nodes = walk(root.children[0]);
  const byPlaceholder = (ph) => nodes.find((n) => n.tagName === "INPUT" && n.attrs.placeholder === ph);
  return {
    name: byPlaceholder("e.g. Strong flour"),
    note: byPlaceholder("e.g. brand or grade, or where you buy it (optional)"),
    add: nodes.find((n) => n.tagName === "BUTTON"
      && (n.children || []).some((c) => c.text === "Add ingredient")),
  };
}

const fire = (node) => (node._listeners.click || []).forEach((f) => f());

test("a note typed on a new ingredient saves and shows on its card alone", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  assert.ok(f.note, "the new-ingredient card shows the optional Note box");

  f.name.value = "Strong flour";
  f.note.value = "bread flour 12.5% protein — gold label";
  fire(f.add);

  assert.equal(state.ingredients.length, 1);
  const saved = state.ingredients[0];
  assert.equal(saved.purchaseNote, "bread flour 12.5% protein — gold label",
    "typed note round-trips onto the saved ingredient");

  const noteP = walk(root)
    .find((n) => n.tagName === "P" && (n.children || []).some((c) => c.text === saved.purchaseNote));
  assert.ok(noteP, "the ingredient card shows the note on its own line");
  assert.ok(String(noteP.className).includes("card-sub"), "the note reads as a card subtitle, not a recipe line");
});

test("an ingredient with no note saves cleanly (purchaseNote stays empty)", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);

  f.name.value = "Sea salt";
  fire(f.add);

  assert.equal(state.ingredients.length, 1);
  assert.equal(state.ingredients[0].name, "Sea salt");
  assert.equal(state.ingredients[0].purchaseNote, undefined, "no note typed → no note saved");
});

// --- On-hand stock strip + set-stock popup ----------------------------------

function textOf(n) {
  if (!n) return "";
  if (n.nodeType === 3) return n.text ?? "";
  if (n.textContent) return n.textContent;
  return (n.children || []).map(textOf).join("");
}

function addIngredient(state, root, name) {
  const f = formHandles(root);
  f.name.value = name;
  fire(f.add);
  return state.ingredients[state.ingredients.length - 1];
}

test("a new ingredient's card reads On hand 0 and the strip opens the stock popup", () => {
  const state = freshState();
  const root = render(state);
  addIngredient(state, root, "Strong flour");

  const strip = walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("stockline"));
  assert.ok(strip, "the card carries an On hand strip");
  assert.ok(String(strip.className).includes("empty"), "a brand-new ingredient has no stock yet");
  const qty = walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("stockline-qty"));
  assert.equal(textOf(qty), "0", "reads zero until she sets it");

  fire(strip);
  const layer = registry["popup-layer"];
  assert.ok(textOf(layer).includes("On hand — Strong flour"), "the popup opens over the screen");
});

test("typing 1.5 kg in the popup stores 1500 base grams and the card rereads it", () => {
  const state = freshState();
  const root = render(state);
  const ing = addIngredient(state, root, "Strong flour");
  assert.equal(ing.onHand, undefined);

  const strip = walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("stockline"));
  fire(strip);

  const layer = registry["popup-layer"];
  const input = walk(layer).find((n) => n.tagName === "INPUT");
  const unitSel = walk(layer).find((n) => n.tagName === "SELECT");
  unitSel.value = "u_kg";                       // she thinks in kg
  (unitSel._listeners.change || []).forEach((f) => f());
  input.value = "1.5";                          // one and a half kilos

  const save = walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Save stock");
  fire(save);

  assert.equal(ing.onHand, 1500, "1.5 kg of flour lands as 1500 base grams");
  const qty = walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("stockline-qty"));
  assert.equal(textOf(qty), "1.5 kg", "the card now shows the friendly amount");
  const strip2 = walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("stockline"));
  assert.ok(String(strip2.className).includes("has-stock"), "the strip flips to the has-stock style");
});
