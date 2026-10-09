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
const { classOfCategory } = await import("../admin/js/accounts.js");

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

test("the Money screen says what the lists hold, and a loan is among them", () => {
  // ⚠️ THE TITLE NAMES ALL THREE LISTS NOW (v394). It read "Categories & ways to pay", which stopped
  // being true the moment a third list joined them — **and a heading missing one of the things under
  // it is how she fails to find that thing.**
  const root = mount(freshState());
  const line = walk(root).find((n) => (n.children || []).some((c) => String(c.className).includes("card-title")
    && c.textContent === "Categories, ways to pay & sources"));
  assert.ok(line, "the lists are on the money screen, not tucked away in Settings");
  assert.match(line.textContent, /11 categories/);
  assert.match(line.textContent, /Cash, TNG, Loan/, "with the third choice she asked for");
  assert.match(line.textContent, /2 sources/, "⚠️ and the third list is not mentioned at all");
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

// ── ★★ the third list: where her own money came from (v394) ───────────────────
// Her words, looking at the Put money in form: __"should have additional field : from xxx"__ — and,
// asked whether it should be typed or picked, __"Which pot it came from — picked"__.

test("★★ the sources list is on the screen she edits the other two on", () => {
  const state = freshState();
  openManager(state);
  const names = walk(registry["popup-layer"])
    .filter((n) => String(n.className).includes("info-row"))
    .map((r) => r.children[0].textContent);
  assert.ok(names.includes("My own pocket") && names.includes("Savings"),
    "⚠️ the third list is not on the screen she edits the other two on");
});

test("★★ renaming a source moves the money-in rows already recorded under it", () => {
  // ⚠️ A row stores the words it was WRITTEN with, so a rename that only changed the list would split
  // her history across two spellings of one pot — the rule the other two lists already keep.
  const state = freshState();
  state.deposits = [{ id: "d1", date: "2026-09-10", amount: 50, method: "Cash", source: "Savings" }];
  openManager(state);
  fire(managerRow("Savings"));
  editorBox().value = "Maybank savings";
  fire(byText(registry["popup-layer"], "Save"));
  assert.equal(state.deposits[0].source, "Maybank savings",
    "⚠️ renaming the pot left the rows she recorded under it on the old name");
});

test("⚠️ the pot she picks on the money-in form is saved onto the row", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Put money in"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you put in").value = "200";
  fire(byText(layer, "Savings"));
  fire(byText(layer, "Save"));
  assert.equal(state.deposits.length, 1, "the money-in row was not written");
  assert.equal(state.deposits[0].source, "Savings", "⚠️ the pot she picked was not saved on the row");
});

// ── ★★ moving money between her own pots (v395) ───────────────────────────────
// Her words: __"if its for sometimes we want to transfer money from tnG to cash, or to bank"__.

test("★★ a transfer writes BOTH sides — out of one pot and into the other", () => {
  // ⚠️⚠️ ONE SIDE ALONE IS THE WHOLE FAULT: a deposit on its own would count her own RM200 as money
  // IN, and moving money between two pockets of hers would inflate the figures she reads her takings
  // from. The two rows are what make it a movement rather than new money.
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  fire(byText(layer, "Save"));

  assert.equal(state.expenses.length, 1, "nothing left the pot it came from");
  assert.equal(state.deposits.length, 1, "the money never arrived in the other pot");
  assert.equal(state.expenses[0].method, "Cash", "the out-side is not out of the pot it came from");
  assert.equal(state.deposits[0].method, "TNG", "the in-side did not land in the other pot");
  assert.equal(state.deposits[0].source, "Cash", "the row does not say where the money came from");
  assert.equal(state.deposits[0].transfer, true, "so it would read as money arriving from outside");
  // ⚠️⚠️ AND IT IS NOT A COST. An ordinary category would put moving her own money on the profit
  // statement as a cost of trading — which is why the out-side goes under the DRAWINGS category, the
  // same thing `Pay back a pocket` does and for the same reason.
  assert.equal(classOfCategory(state, state.expenses[0].category), "drawing",
    "⚠️ a transfer put a cost on the profit statement");
});

test("★★ the net does not move when money moves between her own pots", () => {
  const netOf = (s) => {
    const rows = walk(mount(s)).filter((n) => String(n.className).includes("info-row"));
    return rows.find((r) => r.children[0].textContent === "Net").children[1].textContent;
  };
  const outOf = (s) => {
    const rows = walk(mount(s)).filter((n) => String(n.className).includes("info-row"));
    return rows.find((r) => r.children[0].textContent === "Cash out").children[1].textContent;
  };
  const state = freshState();
  const before = netOf(state);

  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  fire(byText(layer, "Save"));

  assert.equal(outOf(state), "RM 200.00", "the pot it came from did not go down");
  assert.equal(netOf(state), before,
    "⚠️⚠️ moving her own money changed what should be with her — nothing entered or left the business");
});

test("⚠️ the transfer cannot pick the SAME pot on both sides", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  // From defaults to Cash; the first pill of each row is Cash, so pressing both "To"s second pill
  // is not enough — drive it through the documented rule instead: picking the pot already chosen on
  // the other side must not leave a double.
  const pills = walk(layer).filter((n) => n.tagName === "BUTTON" && n.textContent.trim() === "Cash");
  fire(pills[pills.length - 1]); // pick Cash as the destination too
  fire(byText(layer, "Save"));
  assert.notEqual(state.expenses.length && state.expenses[0].method,
    state.deposits.length && state.deposits[0].method,
    "⚠️ a transfer to the same pot went through — that is not a movement at all");
});

test("★★ the Money screen carries her investment as its own account", () => {
  // ⚠️ Her words: __"we are able to generate investment account.?"__ — and it must name BOTH sides, or
  // it answers only half of what she asked for.
  const state = freshState();
  state.deposits = [{ id: "d1", date: "2026-09-01", amount: 500, method: "Cash" }];
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 50,
    category: "My own withdrawal", method: "Cash" }];
  const root = mount(state);
  const line = walk(root).find((n) => (n.children || []).some((c) =>
    String(c.className).includes("card-title") && c.textContent === "Your investment"));
  assert.ok(line, "⚠️ her investment is not on the Money screen at all");
  assert.match(line.textContent, /Put in RM 500\.00/, "the money she put in is not named");
  assert.match(line.textContent, /taken back RM 50\.00/, "⚠️ money taken back out is not named");
  assert.match(line.textContent, /all time/, "⚠️ and nothing says it is a balance, not this stretch");
});

// ── ★★ whose money paid for it (v397) ─────────────────────────────────────────
// Her words: __"When i enter an expenses, like buying equipment, should i allow to credit investment
// account?"__ — and, asked how the app should tell the two apart, she chose to say so on the expense.

test("★★ the expense form asks whose money paid — and only when a POCKET did", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value = "500";

  // ⚠️ Cash paid, so the till's own money is in question — nothing is owed and nothing is invested.
  assert.equal(byText(layer, "It is my investment"), undefined,
    "⚠️ she is being asked whose money paid when the till paid it");

  // Pay from one of her own pockets and the question appears.
  fire(byText(layer, "Loan"));
  assert.ok(byText(layer, "It is my investment"),
    "⚠️ paying from her own pocket asks nothing about whose money it was");
  // ⚠️ ASSERTION ON USER-VISIBLE COPY, so it moves with the string: jerky says "the business".
  assert.ok(byText(layer, "The business owes me"), "and the debt it already was must still be offered");

  fire(byText(layer, "It is my investment"));
  fire(byText(layer, "Save"));
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].invested, true, "⚠️ the choice she made was not saved on the row");
});

test("★★ a withdrawal asks WHOSE investment it comes out of — an ordinary cost does not", () => {
  // ⚠️ Only a withdrawal reduces somebody's share of the bakery. An ordinary cost is not anyone's money
  // going back to them, so the question must not be put to it.
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value = "300";

  assert.equal(byText(layer, "My own pocket"), undefined,
    "⚠️ an ordinary cost is being asked whose investment it comes out of");

  fire(byText(layer, "My own withdrawal"));
  assert.ok(byText(layer, "My own pocket"),
    "⚠️ taking her own money out asks nothing about whose it is — no owner's balance can be right");

  fire(byText(layer, "Savings"));
  fire(byText(layer, "Save"));
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].source, "Savings",
    "⚠️ the owner she picked was not saved on the withdrawal");
});
