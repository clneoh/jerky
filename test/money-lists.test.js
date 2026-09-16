// test/money-lists.test.js — the two lists are hers to shape (v106+), and they are
// edited WHERE THE MONEY IS, not in a separate Settings card (16 Sep 2026: "dont put
// the setting separately, it should be at where it suppose to be"). So this drives
// the Money screen: the line under the cards, the list it opens, and the ＋ chip on
// the expense form. Renaming is the one that touches data — a row stores the words it
// was written with — so that is pinned extra hard.

import { test } from "node:test";
import assert from "node:assert/strict";

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
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };
globalThis.location = { hash: "#/money", reload() {} };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { renderMoney } = await import("../admin/js/views/money.js");
const { entryForm } = await import("../admin/js/views/accountsEditor.js");

function freshState() {
  return {
    version: 1,
    settings: { currency: "RM", categories: [], payMethods: [] },
    products: [], ingredients: [], suppliers: [], uoms: [], deliveryDates: [], orders: [],
    customers: [], purchaseOrders: [], expenses: [], deposits: [], credits: [], occasions: [],
  };
}
const walk = (n, out = []) => {
  for (const c of n.children || []) { out.push(c); walk(c, out); }
  return out;
};
// A click carrying an event: the ✕ inside an editable row stops the tap from reaching
// the row beneath it, so its handler expects one.
const fire = (node, ev = { stopPropagation() {} }) =>
  (node._listeners.click || []).forEach((f) => f(ev));
const byText = (root, text) =>
  walk(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === text);
const managerRow = (label) => walk(registry["popup-layer"])
  .filter((n) => String(n.className).includes("info-row"))
  .find((r) => r.children[0].textContent === label);
// The entry form's own box — by its label, not simply the first input, because the
// expense form behind it has an amount box of its own.
const editorBox = () => walk(registry["popup-layer"])
  .find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Name");

function mount(state) {
  const root = createEl("div");
  renderMoney(root, state);
  return root;
}
// Open the manager from the Money screen's own line.
function openManager(state) {
  const root = mount(state);
  fire(byText(root, "Edit"));
  return root;
}

test("the Money screen says what the two lists hold, and a loan is among them", () => {
  const root = mount(freshState());
  const line = walk(root).find((n) => (n.children || []).some((c) => String(c.className).includes("card-title")
    && c.textContent === "Categories & ways to pay"));
  assert.ok(line, "the lists are on the money screen, not tucked away in Settings");
  assert.match(line.textContent, /11 categories/);
  assert.match(line.textContent, /Cash, TNG, Loan/, "with the third choice she asked for");
});

test("Edit opens the lists, and every line can be opened to change it", () => {
  const state = freshState();
  openManager(state);
  const listed = walk(registry["popup-layer"]).filter((n) => String(n.className).includes("info-row"));
  const names = listed.map((r) => r.children[0].textContent);
  assert.ok(names.includes("Rent") && names.includes("Salary (you)"), "the chart, by name");
  assert.ok(names.includes("Cash") && names.includes("TNG") && names.includes("Loan"), "and the ways to pay");
  assert.match(managerRow("Loan").children[1].textContent, /not from the purse/,
    "with a loan marked as money that never went near it");
  assert.ok(String(managerRow("Rent").className).includes("tappable"), "a line says it can be opened");
});

test("renaming a category moves what was already recorded under it", () => {
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 18, category: "Packaging" }];
  openManager(state);
  fire(managerRow("Packaging"));

  const box = editorBox();
  assert.equal(box.value, "Packaging", "open on the name being changed");
  box.value = "Packing";
  fire(byText(registry["popup-layer"], "Save"));

  assert.ok(state.settings.categories.some((c) => c.label === "Packing"));
  assert.ok(!state.settings.categories.some((c) => c.label === "Packaging"));
  assert.equal(state.expenses[0].category, "Packing",
    "her history moved with the name instead of splitting in two");
});

test("renaming a way to pay moves its entries, in and out", () => {
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 250, category: "Ingredients & shopping", method: "Loan" }];
  state.deposits = [{ id: "d1", date: "2026-09-09", amount: 100, method: "Loan" }];
  openManager(state);
  fire(managerRow("Loan"));
  editorBox().value = "Bank OD";
  fire(byText(registry["popup-layer"], "Save"));

  assert.ok(state.settings.payMethods.includes("Bank OD"));
  assert.equal(state.expenses[0].method, "Bank OD", "the spending follows");
  assert.equal(state.deposits[0].method, "Bank OD", "and so does the money that came in");
});

test("a category she does not want can go, and its records are kept", () => {
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 30, category: "Utilities" }];
  openManager(state);
  fire(managerRow("Utilities"));
  fire(byText(registry["popup-layer"], "Delete"));
  fire(byText(registry["confirm-layer"], "Delete"));

  assert.ok(!state.settings.categories.some((c) => c.label === "Utilities"), "gone from the list");
  assert.equal(state.expenses[0].category, "Utilities",
    "the record keeps the name it was written with, and still counts");
});

test("a way to pay can be added, and the last one cannot be deleted", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "Edit")); // the lists
  fire(byText(registry["popup-layer"], "＋ New way to pay"));
  editorBox().value = "Bank OD"; // the form opens in place, under the list
  fire(byText(registry["popup-layer"], "Add"));
  assert.equal(state.settings.payMethods.at(-1), "Bank OD", "added to the list");
  assert.equal(state.settings.payMethods.length, 4, "beside the three that were there");

  // Down to one, and the last cannot be removed: there must always be a way to pay.
  state.settings.payMethods = ["Cash"];
  const one = entryForm(state, { kind: "method", current: "Cash" });
  fire(byText(one, "Delete"));
  assert.deepEqual(state.settings.payMethods, ["Cash"], "kept — there is always a way to pay");
  assert.equal(walk(registry["confirm-layer"]).length, 0,
    "and it does not even open a confirm box: there is nothing she could confirm");
});

test("the expense form can add a category without leaving the form", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const form = registry["popup-layer"];
  const typed = walk(form).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount");
  typed.value = "30"; // half-typed spending, which must survive
  fire(byText(form, "＋ New category"));

  // The form opens IN PLACE — a pop-up from inside a pop-up would wipe the expense
  // she is part-way through (the app has one shared layer).
  const box = editorBox();
  assert.ok(box, "the small form opens inside the expense form");
  box.value = "Baking class";
  fire(byText(form, "A running cost"));
  fire(byText(form, "Add"));

  assert.equal(state.settings.categories.at(-1).label, "Baking class");
  assert.equal(state.settings.categories.at(-1).cls, "expense");
  const again = walk(registry["popup-layer"]);
  assert.equal(again.find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value, "30",
    "what she had typed is still there");
  const picked = again.filter((n) => String(n.className).includes("cal-mode-on")).map((b) => b.textContent.trim());
  assert.ok(picked.includes("Baking class"), "and the new category comes back picked, so she can carry on");
});
