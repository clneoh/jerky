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
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => null,
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
      { id: "u_g", name: "g", family: "weight" },
      { id: "u_kg", name: "kg", family: "weight" },
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
