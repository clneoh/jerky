// test/profit.test.js — the books (v105). She asked for accounting software, so
// what this pins is the accounting: sales at the price sold, cost of sales from the
// recipes (NOT the packs bought), running costs by category, and the owner's own
// money kept out of profit entirely.

import { test } from "node:test";
import assert from "node:assert/strict";

const { profitBetween, monthSpan, orderDay, lineCost, expenseRows } = await import("../admin/js/profit.js");
const { classOfCategory, categoryLabels, DEFAULT_CATEGORIES } = await import("../admin/js/accounts.js");

// Flour at 1 sen a gram; a Focaccia's recipe uses 100 g, so a loaf costs RM1.00 to
// bake and sells at RM15.
function state() {
  return {
    settings: { currency: "RM" },
    uoms: [],
    ingredients: [{ id: "g1", name: "Flour", unit: "g", costPerUnit: 0.01, active: true }],
    products: [{
      id: "p1", name: "Focaccia", price: 15, active: true,
      recipe: [{ ingredientId: "g1", qty: 100 }],
    }],
    deliveryDates: [{ id: "d1", date: "2026-09-10" }],
    orders: [],
    expenses: [],
    deposits: [],
  };
}
const order = (extra = {}) => ({
  id: "o1", deliveryDateId: "d1", deliveryDate: "2026-09-10", productId: "p1", qty: 2, ...extra,
});

test("sales, cost of sales and gross profit come from what was sold", () => {
  const st = state();
  st.orders = [order()]; // 2 loaves: RM30 of sales, RM2.00 of ingredients
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.sales, 30);
  assert.equal(pl.cost, 2);
  assert.equal(pl.gross, 28);
  assert.equal(pl.lines, 1);
  assert.equal(pl.uncosted, 0, "the recipe prices this product");
});

test("a price she changed on the order is what the sale counts", () => {
  const st = state();
  st.orders = [order({ unitPrice: 12.5 })];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.sales, 25, "2 × RM12.50, not the menu's RM15");
});

test("an order outside the stretch is not in it", () => {
  const st = state();
  st.orders = [order(), order({ id: "o2", deliveryDate: "2026-10-02" })];
  const sept = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(sept.lines, 1);
  assert.equal(sept.sales, 30);
  assert.equal(profitBetween(st, "2026-10-01", "2026-10-31").sales, 30);
});

test("an order whose delivery date was deleted still counts on its own snapshot", () => {
  const st = state();
  st.deliveryDates = [];
  st.orders = [order({ deliveryDateId: "gone" })];
  assert.equal(orderDay(st, st.orders[0]), "2026-09-10");
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").sales, 30);
});

test("a line with no recipe cost is counted as nothing, and said so", () => {
  const st = state();
  st.products = [{ id: "p1", name: "Mystery", price: 15, active: true, recipe: [] }];
  st.orders = [order()];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.cost, 0);
  assert.equal(pl.uncosted, 1, "so the screen can tell her to check the recipe");
  assert.equal(lineCost(st, st.orders[0]), 0);
});

test("running costs are listed by category, in the chart's order", () => {
  const st = state();
  st.expenses = [
    { id: "e1", date: "2026-09-05", amount: 18, category: "Packaging" },
    { id: "e2", date: "2026-09-06", amount: 30, category: "Utilities" },
    { id: "e3", date: "2026-09-07", amount: 12, category: "Packaging" },
  ];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.expensesTotal, 60);
  assert.deepEqual(pl.expenses.map((e) => e.label).slice(0, 3), ["Packaging", "Rent", "Utilities"]);
  assert.equal(pl.expenses.find((e) => e.label === "Packaging").amount, 30, "same category, added up");
  assert.equal(pl.expenses.find((e) => e.label === "Rent").amount, 0, "a category with nothing still shows");
});

test("stock bought, and her own money, never touch profit", () => {
  const st = state();
  st.orders = [order()];
  st.expenses = [
    { id: "x", date: "2026-09-05", amount: 250, category: "Ingredients & shopping", poId: "po1" },
    { id: "y", date: "2026-09-05", amount: 100, category: "My own withdrawal" },
  ];
  st.deposits = [{ id: "d", date: "2026-09-04", amount: 300, method: "cash" }];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.expensesTotal, 0, "a flour run is cash and the shelf, not a cost of trading");
  assert.equal(pl.net, 28, "so the month's trading is untouched by either");
  assert.equal(pl.drawings, 100, "her withdrawal is a drawing, reported apart");
  assert.equal(pl.capital, 300, "and her money in is capital, not income");
});

test("the chart of accounts covers what she named, and is hers to change", () => {
  const st = state();
  const labels = categoryLabels(st);
  for (const label of ["Rent", "Utilities", "Salary (you)", "EPF / SOCSO", "Delivery & fuel"]) {
    assert.ok(labels.includes(label), `${label} is a category`);
  }
  assert.equal(classOfCategory(st, "My own withdrawal"), "drawing");
  assert.equal(classOfCategory(st, "Ingredients & shopping"), "stock");
  assert.equal(classOfCategory(st, "Rent"), "expense");
  assert.equal(classOfCategory(st, "Something an old phone typed"), "expense",
    "an unknown label counts as an expense rather than vanishing");

  // A category she adds is hers; one she deletes still classifies its old rows.
  st.settings.categories = [...DEFAULT_CATEGORIES.map((c) => ({ ...c })), { label: "Baking class", cls: "expense" }];
  assert.ok(categoryLabels(st).includes("Baking class"));
  st.settings.categories = st.settings.categories.filter((c) => c.label !== "Rent");
  assert.ok(!categoryLabels(st).includes("Rent"), "gone from the picker");
  assert.equal(classOfCategory(st, "Rent"), "expense",
    "but the rows already written under it still count as a cost");
  assert.ok(profitBetween(st, "2026-09-01", "2026-09-30").expenses.every((e) => e.label !== "Rent"),
    "and the statement stops printing a line for it");
});

test("a month spans its own days, leap years included", () => {
  assert.deepEqual(monthSpan(2026, 8), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(monthSpan(2024, 1), { from: "2024-02-01", to: "2024-02-29" });
});

// ── the statement on screen ──────────────────────────────────────────────────
function domShim() {
  const registry = {};
  const createEl = (tag) => {
    const node = {
      tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
      className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
      _listeners: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild(c) { if (c != null) this.children.push(c); return c; },
      append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
      replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
      addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
      removeEventListener() {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      focus() {}, click() {},
    };
    Object.defineProperty(node, "textContent", {
      get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
      set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
    });
    return node;
  };
  globalThis.document = {
    createElement: createEl,
    createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
    getElementById: (id) => (registry[id] ||= createEl("div")),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: createEl("body"),
  };
  return registry;
}
const { renderProfit } = await import("../admin/js/views/profit.js");
domShim();
const rowsOf = (root) => (function walk(n, out = []) {
  for (const c of n.children || []) { out.push(c); walk(c, out); }
  return out;
})(root).filter((n) => String(n.className).includes("pl-row"))
  .map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`);

test("the statement reads down from sales to what the month left", () => {
  const st = state();
  st.orders = [order()];
  st.expenses = [{ id: "e1", date: "2026-09-05", amount: 18, category: "Packaging" }];
  // The screen opens on THIS month, so the month is set by naming its days.
  const now = new Date();
  const { from, to } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from })];
  st.expenses = [{ id: "e1", date: from, amount: 18, category: "Packaging" }];

  const root = document.createElement("div");
  renderProfit(root, st);
  const rows = rowsOf(root);
  assert.ok(rows.includes("Sales=RM 30.00"), "sales at the top");
  assert.ok(rows.includes("Cost of sales=RM -2.00"), "what baking them cost, shown as a subtraction");
  assert.ok(rows.includes("Gross profit=RM 28.00"));
  assert.ok(rows.includes("Packaging=RM -18.00"), "the running costs, by category");
  assert.ok(rows.includes("Rent=RM 0.00"), "with the empty ones still shown");
  assert.ok(rows.includes("Total expenses=RM -18.00"));
  assert.ok(rows.includes("Net profit=RM 10.00"), "the bottom line");
  assert.ok(rows.includes("Capital you put in=RM 0.00") && rows.includes("Drawings you took out=RM 0.00"),
    "and her own money reported apart from the trading");
  assert.match(String(root.textContent), /Cost of sales|your recipes|recipes/,
    "the screen explains where the ingredient cost came from");
});

test("a month with nothing in it reads as zeroes, not blanks", () => {
  const st = state();
  const root = document.createElement("div");
  renderProfit(root, st);
  const rows = rowsOf(root);
  assert.ok(rows.includes("Sales=RM 0.00") && rows.includes("Net profit=RM 0.00"));
  assert.match(String(root.textContent), /0 order lines in this month/);
});

// --- the journal behind a statement line (v111) ------------------------------
// "the expenses items in Profit & Loss should reveal its journals" (17 Sep 2026). A
// line on a statement is a total; these are the transactions it is made of. What
// matters is that they always ADD UP to the line above them — otherwise the journal
// would quietly disagree with the statement it was opened from.

test("a line's journal lists what made it up, in date order, with what and how paid", () => {
  const st = state();
  st.expenses = [
    { id: "e1", date: "2026-09-07", amount: 12, category: "Packaging", method: "Cash", note: "boxes" },
    { id: "e2", date: "2026-09-05", amount: 18, category: "Packaging", method: "TNG" },
    { id: "e3", date: "2026-09-06", amount: 30, category: "Utilities" },
  ];
  const rows = expenseRows(st, "2026-09-01", "2026-09-30", "Packaging");
  assert.deepEqual(rows.map((r) => r.id), ["e2", "e1"], "oldest first, so the month reads like a book");
  assert.equal(rows[0].what, "Packaging", "no note written → the category stands in for it");
  assert.equal(rows[0].method, "TNG", "and how it was paid comes along");
  assert.equal(rows[1].what, "boxes", "her own note is what names the row when there is one");

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(total, pl.expenses.find((e) => e.label === "Packaging").amount,
    "the journal adds up to the line it was opened from");
});

test("the Total line's journal is every running cost at once, and still adds up", () => {
  const st = state();
  st.orders = [order()];
  st.expenses = [
    { id: "e1", date: "2026-09-05", amount: 18, category: "Packaging" },
    { id: "e2", date: "2026-09-06", amount: 30, category: "Utilities" },
    { id: "e3", date: "2026-09-07", amount: 45.5, category: "Delivery & fuel" },
    { id: "stock", date: "2026-09-04", amount: 250, category: "Ingredients & shopping" },
    { id: "mine", date: "2026-09-04", amount: 100, category: "My own withdrawal" },
  ];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  const rows = expenseRows(st, "2026-09-01", "2026-09-30", null);
  assert.equal(rows.length, 3, "a shopping run and her own withdrawal are not running costs");
  assert.equal(rows.reduce((s, r) => s + r.amount, 0), pl.expensesTotal,
    "and the total is exactly the statement's own Total expenses");
});

test("a month's journal holds that month only", () => {
  const st = state();
  st.expenses = [
    { id: "aug", date: "2026-08-31", amount: 99, category: "Rent" },
    { id: "sep", date: "2026-09-01", amount: 50, category: "Rent" },
    { id: "oct", date: "2026-10-01", amount: 77, category: "Rent" },
  ];
  const rows = expenseRows(st, "2026-09-01", "2026-09-30", "Rent");
  assert.deepEqual(rows.map((r) => r.id), ["sep"], "a statement is a month, and so is its journal");
});

test("a category she deleted still opens, because its rows still count", () => {
  const st = state();
  st.settings.categories = [{ label: "Packaging", cls: "expense" }];
  st.expenses = [{ id: "e1", date: "2026-09-05", amount: 18, category: "Packing" }];
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  const line = pl.otherExpenses.find((e) => e.label === "Packing");
  assert.ok(line, "the old label gets its own line rather than vanishing");
  assert.deepEqual(expenseRows(st, "2026-09-01", "2026-09-30", "Packing").map((r) => r.id), ["e1"],
    "so the line she can see has a journal she can open");
});

// ── every spending line opens, empty or not (v114) ────────────────────────────
// "in profit the expenses is not clickable, is that a bug?" (17 Sep 2026). A line reading
// 0.00 was deliberately dead, but it looked EXACTLY like the live line above it — so a tap
// that did nothing read as a broken screen. Now every spending line opens, and an empty one
// says so in her own words.
const screenOf = () => {
  const walkAll = (n, out = []) => { for (const c of n.children || []) { out.push(c); walkAll(c, out); } return out; };
  return walkAll;
};

test("every expense line on the statement can be opened, 0.00 included", () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from })];
  st.expenses = [{ id: "e1", date: from, amount: 18, category: "Packaging", method: "Cash" }];

  const root = document.createElement("div");
  renderProfit(root, st);
  const line = (label) => walkAll(root).find((n) => String(n.className).includes("pl-row")
    && n.children[0].textContent === label);

  assert.ok(String(line("Packaging").className).includes("tappable"), "a line with money in it opens");
  assert.ok(String(line("Rent").className).includes("tappable"),
    "and so does one reading 0.00 — the two must not look different");
  assert.ok(String(line("Total expenses").className).includes("tappable"));
  assert.ok(!String(line("Net profit").className).includes("tappable"),
    "while the statement's own totals stay figures, not doors");

  // Tapping the empty one says so, and names the category and the month.
  line("Rent")._listeners.click.forEach((f) => f());
  const text = walkAll(document.getElementById("popup-layer")).map((n) => n.textContent).join(" ");
  assert.match(text, /Nothing recorded under Rent in /, "an empty line opens and explains itself");
  assert.match(text, /It will fill up on its own/, "and says how it comes to have something in it");
});

test("the journal behind a line adds up to the figure on the statement", () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from })];
  st.expenses = [
    { id: "e1", date: from, amount: 18, category: "Packaging", method: "Cash", note: "bags" },
    { id: "e2", date: from, amount: 12, category: "Packaging", method: "TNG", note: "boxes" },
    { id: "e3", date: from, amount: 45, category: "Utilities", method: "Loan" },
  ];

  const root = document.createElement("div");
  renderProfit(root, st);
  const line = (label) => walkAll(root).find((n) => String(n.className).includes("pl-row")
    && n.children[0].textContent === label);
  assert.equal(line("Packaging").children[1].textContent, "RM -30.00");

  line("Packaging")._listeners.click.forEach((f) => f());
  const pop = walkAll(document.getElementById("popup-layer"));
  const text = pop.map((n) => n.textContent).join(" ");
  assert.match(text, /· bags · Cash/, "each row carries her note and how it was paid");
  assert.match(text, /· boxes · TNG/);
  assert.ok(text.includes("RM -30.00"), "and the journal lands on the line's own figure");
  assert.ok(!text.includes("Utilities"), "with nothing from another category in it");

  // The Total journal mixes categories, so there the category has to travel with the row —
  // "1 Sep · boxes" alone is a line with nothing to attach it to.
  document.getElementById("popup-layer").replaceChildren(); // close the first book
  line("Total expenses")._listeners.click.forEach((f) => f());
  const all = walkAll(document.getElementById("popup-layer")).map((n) => n.textContent).join(" ");
  assert.match(all, /Packaging — bags/, "the total names the category each row belongs to");
  assert.match(all, /Utilities/, "including one with no note of its own");
  assert.ok(all.includes("RM -75.00"), "and ends on the month's whole spending: 18 + 12 + 45");
});

// ── the month arrows (v115) ──────────────────────────────────────────────────
// "the profit month can move earlier but cannot move later" (17 Sep 2026). The arrows'
// state was worked out once when the screen was opened and then reused on every redraw, so
// after stepping back a month the "›" arrow was still disabled as it had been on the month
// she started on — one-way traffic.
test("the month arrows let her come back forward after stepping back", () => {
  const walkAll = screenOf();
  const arrows = (root) => walkAll(root).filter((n) => String(n.className).includes("cal-nav"));
  const title = (root) => walkAll(root).find((n) => String(n.className).includes("cal-title")).textContent;
  const press = (n) => n._listeners.click.forEach((f) => f());

  const root = document.createElement("div");
  renderProfit(root, state());
  const now = new Date();
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const thisMonth = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  assert.equal(title(root), thisMonth, "it opens on this month");
  assert.equal(arrows(root)[1].disabled, true, "and › is off: there are no numbers after today");

  press(arrows(root)[0]); // ‹
  assert.notEqual(title(root), thisMonth, "‹ steps back a month");
  assert.equal(arrows(root)[1].disabled, false, "and › must come alive again, or she is stuck");

  press(arrows(root)[1]); // ›
  assert.equal(title(root), thisMonth, "› steps forward again");
  assert.equal(arrows(root)[1].disabled, true, "and stops at this month, not a future one");
  press(arrows(root)[1]);
  assert.equal(title(root), thisMonth, "pressing it there does nothing at all");
});
