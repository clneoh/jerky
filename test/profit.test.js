// test/profit.test.js — the books (v105). She asked for accounting software, so
// what this pins is the accounting: sales at the price sold, cost of sales from the
// recipes (NOT the packs bought), running costs by category, and the owner's own
// money kept out of profit entirely.

import { test } from "node:test";
import assert from "node:assert/strict";

const { profitBetween, monthSpan, orderDay, lineCost, orderLineCost, expenseRows, tradingRows } = await import("../admin/js/profit.js");
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

// ── ★★ the cost is FROZEN onto the sale (v380) ──────────────────────────────
// Her words: "when i change the ingredient cost, for age orders, will its COS
// change?" — and it did, because everything below was worked out afresh from
// TODAY's ingredient prices on every read. "yes, freeze the cost onto the order".

test("★★ changing an ingredient price does NOT move an order already taken", () => {
  const st = state();
  st.orders = [order({ unitCost: 1 })]; // frozen at the moment the loaves were sold
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").cost, 2);
  st.ingredients[0].costPerUnit = 0.5; // flour goes up fifty-fold
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").cost, 2,
    "September's profit is what it was, not today's flour price");
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").gross, 28,
    "and so is the gross profit the whole statement turns on");
});

test("an order with NO frozen cost still follows the live recipe — this is not a global freeze", () => {
  const st = state();
  st.orders = [order()];
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").cost, 2);
  st.ingredients[0].costPerUnit = 0.02;
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").cost, 4,
    "an order that never froze a cost moves with the recipe exactly as it always did");
});

test("a cost she typed on the line beats both the frozen cost and the live recipe", () => {
  const st = state();
  st.orders = [order({ unitCost: 3.5 })]; // "this batch cost me more than the recipe says"
  assert.equal(orderLineCost(st, st.orders[0]), 3.5, "her own figure is the one the books use");
  assert.equal(lineCost(st, st.orders[0]), 7, "2 loaves at her figure");
  assert.equal(profitBetween(st, "2026-09-01", "2026-09-30").cost, 7);
  st.ingredients[0].costPerUnit = 0.5;
  assert.equal(lineCost(st, st.orders[0]), 7, "and it does not move when flour does");
});

test("a cost she TYPED as zero is honoured — only the automatic stamp refuses one", () => {
  // ⚠️ The asymmetry is deliberate. `stampOrderLine` declines a 0 because it cannot
  // tell a free recipe from a recipe nobody has built (see test/order-line.test.js).
  // Here a person has said it, so "this cost me nothing" is a fact and it stands.
  const st = state();
  st.orders = [order({ unitCost: 0 })];
  assert.equal(orderLineCost(st, st.orders[0]), 0);
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");
  assert.equal(pl.cost, 0);
  // ⚠️ AND IT STILL READS AS AN UNCOSTED LINE. `uncosted` is about the FIGURE
  // contributing nothing — not about whether a person typed it — and a 0 on the
  // cost side reports a profit that is too high however it got there, so the
  // journal goes on marking the row. Pinned so nobody "fixes" it into silence.
  assert.equal(pl.uncosted, 1, "a zero cost is still a row the statement flags");
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

// ── Sales and Cost of sales open too (v280) ───────────────────────────────────
// 2 Oct 2026: "at the profit section, can the sales and cost of sales be clickable to
// reveal its journal". Both lines are made of the same order rows, so one journal serves
// them — and it has to add up to the line, the way the spending journals do.
test("the trading journal adds up to both lines it is opened from", () => {
  const st = state();
  st.orders = [
    order({ id: "o1", qty: 2 }),                                  // 2 × RM15 = RM30, RM2.00 to bake
    order({ id: "o2", qty: 1, unitPrice: 12.5 }),                 // 1 × RM12.50 = RM12.50, RM1.00
  ];
  const rows = tradingRows(st, "2026-09-01", "2026-09-30");
  const pl = profitBetween(st, "2026-09-01", "2026-09-30");

  assert.equal(rows.reduce((s, r) => s + r.sales, 0), pl.sales,
    "the sales journal adds up to the Sales line");
  assert.equal(rows.reduce((s, r) => s + r.cost, 0), pl.cost,
    "and the same rows add up to Cost of sales — one list read from two sides");
});

test("a trading row names what was sold, how many, and who bought it", () => {
  const st = state();
  st.orders = [order({ qty: 3, customerName: "Aisyah" })];
  const [r] = tradingRows(st, "2026-09-01", "2026-09-30");
  assert.equal(r.what, "Focaccia × 3", "the product, with the quantity sold");
  assert.equal(r.customer, "Aisyah", "and the customer it went to");
  assert.equal(r.date, "2026-09-10", "on the day it is delivered");
});

test("a frozen name is what the journal calls the loaf, not the live one", () => {
  const st = state();
  st.products[0].name = "Focaccia (renamed)";
  st.orders = [order({ productName: "Focaccia", qty: 1 })];
  const [r] = tradingRows(st, "2026-09-01", "2026-09-30");
  assert.equal(r.what, "Focaccia × 1",
    "a product renamed after the sale still reads as the loaf that was sold");
});

test("a trading journal is this month, oldest first, like a book", () => {
  const st = state();
  st.orders = [
    order({ id: "later", deliveryDate: "2026-09-20" }),
    order({ id: "aug", deliveryDate: "2026-08-31" }),
    order({ id: "earlier", deliveryDate: "2026-09-02" }),
    order({ id: "oct", deliveryDate: "2026-10-01" }),
  ];
  assert.deepEqual(tradingRows(st, "2026-09-01", "2026-09-30").map((r) => r.id),
    ["earlier", "later"], "the month's two, in the order she lived them");
});

test("a line with no recipe cost is marked, not silently reading zero", () => {
  const st = state();
  st.products.push({ id: "p0", name: "Mystery loaf", price: 20, active: true, recipe: [] });
  st.orders = [order({ id: "priced" }), order({ id: "bare", productId: "p0", qty: 1 })];
  const rows = tradingRows(st, "2026-09-01", "2026-09-30");
  assert.equal(rows.find((r) => r.id === "bare").uncosted, true,
    "a recipe that prices to nothing is flagged, so a 0.00 row is never read as a missing one");
  assert.equal(rows.find((r) => r.id === "bare").sales, 20,
    "and it still counts as a sale — the money came in");
  assert.equal(rows.find((r) => r.id === "priced").uncosted, false);
});

test("a line nothing can price is marked as unpriced, not as free", () => {
  const st = state();
  st.products[0].price = ""; // she sells it, but no menu price is set anywhere
  st.orders = [order({ qty: 2 })];
  const [r] = tradingRows(st, "2026-09-01", "2026-09-30");
  assert.equal(r.price, null, "no price anywhere is null, not 0 — the distinction the app keeps");
  assert.equal(r.sales, 0, "and the line counts as nothing, as profitBetween counts it");
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

test("Sales and Cost of sales open, and each lands on its own line's figure", () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [
    order({ id: "o1", deliveryDate: from, qty: 2, customerName: "Aisyah" }),
    order({ id: "o2", deliveryDate: from, qty: 1, customerName: "Wei", unitPrice: 12.5 }),
  ];

  const root = document.createElement("div");
  renderProfit(root, st);
  const line = (label) => walkAll(root).find((n) => String(n.className).includes("pl-row")
    && n.children[0].textContent === label);
  const pop = () => walkAll(document.getElementById("popup-layer")).map((n) => n.textContent).join(" ");

  assert.ok(String(line("Sales").className).includes("tappable"), "Sales opens");
  assert.ok(String(line("Cost of sales").className).includes("tappable"), "and so does Cost of sales");
  assert.ok(!String(line("Gross profit").className).includes("tappable"),
    "while the statement's own totals stay figures, not doors — gross and net alike");
  assert.equal(line("Sales").children[1].textContent, "RM 42.50");

  line("Sales")._listeners.click.forEach((f) => f());
  const sales = pop();
  assert.match(sales, /Sales journal/);
  assert.match(sales, /Focaccia × 2 · Aisyah/, "each row names what sold, how many, and to whom");
  assert.match(sales, /Focaccia × 1 · Wei/);
  assert.ok(sales.includes("RM 42.50"), "and the journal lands on the Sales line's own figure");
  assert.match(sales, /RM 12.50/, "the second sale at the price she sold it at");

  document.getElementById("popup-layer").replaceChildren(); // close the first book
  line("Cost of sales")._listeners.click.forEach((f) => f());
  const cost = pop();
  assert.match(cost, /Cost of sales journal/);
  assert.ok(cost.includes("RM -3.00"), "2 loaves + 1 loaf at RM1.00 each to bake");
  assert.ok(!cost.includes("RM 42.50"), "and the cost side quotes the cost, not the sale");
});

test("an empty trading journal opens and says so, like every spending line", () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }]; // a month with nothing in it

  const root = document.createElement("div");
  renderProfit(root, st);
  const line = (label) => walkAll(root).find((n) => String(n.className).includes("pl-row")
    && n.children[0].textContent === label);
  assert.equal(line("Sales").children[1].textContent, "RM 0.00");

  line("Sales")._listeners.click.forEach((f) => f());
  const text = walkAll(document.getElementById("popup-layer")).map((n) => n.textContent).join(" ");
  assert.match(text, /Nothing was sold in /, "the empty line names itself and the month");
  assert.match(text, /RM 0\.00/, "and still lands on a total of nothing rather than going dead");
});

// ── the statement says which kind of cost it is showing (v281) ────────────────
// Cost of sales is a RECIPE cost, read from the recipe and the ingredient prices she has
// recorded — not money she actually spent. It is said on the screen because a figure that
// disagrees with the Money screen and does not explain itself reads as a fault (3 Oct 2026).
//
// ⚠️⚠️ AND THE CLAIM IT USED TO MAKE IS NOW WITHDRAWN (v380). It said the figure was read
// fresh each time, so editing a recipe or a price "moves past months too" — which was true
// then and is FALSE from v380, because the cost is frozen onto the order. A note still
// claiming a figure can move is a note nobody can trust, so the assertion changed with the
// behaviour rather than being deleted. This is the sentence that would rot silently.
test("the statement says the cost is a recipe cost, and that it is FROZEN onto the order", () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from, qty: 2 })];

  const root = document.createElement("div");
  renderProfit(root, st);
  const text = walkAll(root).map((n) => n.textContent).join(" ");

  assert.match(text, /built from the recipe and the ingredient prices you have recorded/,
    "the screen says what the cost figure is made of");
  assert.match(text, /frozen onto each order when you take it/,
    "★ and that it is frozen, so a later price change does not rewrite a sale already made");
  assert.match(text, /does not rewrite a sale already made/,
    "★★ and the PROMISE ITSELF is on the screen, not only the absence of the old claim — "
    + "a note that merely stopped saying something leaves her no way to know what it does now");
  assert.doesNotMatch(text, /moves past months too|as they stand today/,
    "⚠️ the withdrawn claim is GONE — the screen must not still say a closed month can move");
  assert.match(text, /Orders taken before this was introduced were pinned at the cost they were already showing/,
    "⚠️ and it admits what the older orders' frozen cost actually is, rather than implying it is history");
  assert.match(text, /not what you actually spent/,
    "so the figure is never read as money she paid out");
  assert.match(text, /the Money screen is where the cash is/,
    "and she is sent to the screen that does hold the cash");
});

// ── the month arrows (v115) ──────────────────────────────────────────────────
// "the profit month can move earlier but cannot move later" (17 Sep 2026). The arrows'
// state was worked out once when the screen was opened and then reused on every redraw, so
// after stepping back a month the "›" arrow was still disabled as it had been on the month
// she started on — one-way traffic.
// ⚠️⚠️ REWRITTEN AT v403, NOT DELETED — the FAULT it was written for is still the fault to watch for.
// Her words: __"same thing for Profit"__, so the month-at-a-time stepper became the four-way chooser
// Money and the invoice use, and the arrows moved from `.cal-nav`/`.cal-title` to `.range-nav`/
// `.range-label`. ⚠️ What the test is FOR is unchanged — **17 Sep 2026: "the profit month can move
// earlier but cannot move later"**, because the arrows were computed once before `draw` ran, so after
// stepping back the `›` stayed disabled and she was stuck in the past. **That is why `canGoForward()` is
// a live function called on every draw, and this is the test that keeps it one.**
test("the arrows let her come back forward after stepping back — she is never stuck in the past", () => {
  const walkAll = screenOf();
  const arrows = (root) => walkAll(root).filter((n) => String(n.className).includes("range-nav"));
  const title = (root) => walkAll(root).find((n) => String(n.className).includes("range-label")).textContent;
  const press = (n) => n._listeners.click.forEach((f) => f());

  const root = document.createElement("div");
  renderProfit(root, state());
  const now = new Date();
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const thisMonth = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  // ⚠️ It still OPENS on this month — "A month" is the default, as it always was.
  assert.equal(title(root), thisMonth, "it no longer opens on this month");
  // ⚠️ AND `›` IS NOT DRAWN AT ALL when there is nothing to step forward to — an arrow that is present
  // but does nothing reads as a fault, so the bound is expressed by the arrow being absent.
  assert.equal(arrows(root).length, 1, "⚠️ a forward arrow is offered on the current month");

  press(arrows(root)[0]); // ‹
  assert.notEqual(title(root), thisMonth, "‹ does not step back a month");
  assert.equal(arrows(root).length, 2, "⚠️ and › must come alive again, or she is stuck in the past");

  press(arrows(root)[1]); // ›
  assert.equal(title(root), thisMonth, "› does not step forward again");
  assert.equal(arrows(root).length, 1, "⚠️ and it stops at this month, not a future one");
});

// ── the statement can leave the screen (v282) ─────────────────────────────────
// "those journals in profits and other journals should be printable and able to be shared"
// (3 Oct 2026). She chose that the Profit and loss card gets the pair too — a journal alone
// is half a document. What this pins is that what leaves is the WHOLE statement, and that
// every figure on the paper is the figure on the screen, not a second sum of the books.
test("the Profit and loss card prints and shares the whole statement, figure for figure", async () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from, qty: 2, customerName: "Aisyah" })];
  st.expenses = [{ id: "e1", date: from, amount: 18, category: "Packaging", method: "Cash" }];

  const root = document.createElement("div");
  renderProfit(root, st);

  // The pair sits under the statement card herself, not floating at the foot of the screen.
  const card = walkAll(root).find((n) => String(n.className).includes("card")
    && String(n.children?.[0]?.textContent || "") === "Profit and loss");
  assert.ok(card, "the Profit and loss card is there");
  const press = (label) => walkAll(card).find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === label);
  assert.ok(press("Print"), "the card wears the same pair every journal wears");
  assert.ok(press("Share"));

  let shared = null;
  globalThis.navigator.share = (p) => { shared = p; return Promise.resolve(); };
  try {
    await press("Share")._listeners.click[0]();
    assert.equal(shared.title, "Profit and loss");

    // Every line of the statement, at the figure the screen is showing — read off the
    // screen's own rows, so a paper that quietly dropped or re-summed one cannot pass.
    const onScreen = Object.fromEntries(
      rowsOf(root).map((r) => [r.slice(0, r.lastIndexOf("=")), r.slice(r.lastIndexOf("=") + 1)]));
    for (const label of ["Sales", "Cost of sales", "Gross profit", "Total expenses", "Net profit"]) {
      const onPaper = shared.text.split("\n").find((l) => l.startsWith(label));
      assert.ok(onPaper, `${label} reaches the paper`);
      assert.ok(onPaper.endsWith(onScreen[label]),
        `${label}: the paper says "${onPaper}" where the screen says "${onScreen[label]}"`);
    }

    // A page has no section wording to lean on, so where trading ends has to be said.
    assert.ok(shared.text.split("\n").includes("Running costs"),
      "Running costs is a heading of its own, with no figure padded onto it");
    assert.match(shared.text, /^Packaging\s+RM -18\.00$/m, "and the running costs are listed under it");

    // The reader of Gross profit on paper needs the same warning the screen gives.
    assert.match(shared.text, /built from the recipe and the ingredient prices you have recorded/,
      "the statement explains its own cost figure on paper too");
    assert.match(shared.text, /the Money screen is where the cash is/);
  } finally { delete globalThis.navigator.share; }
});

test("every journal behind a statement line wears the pair, and shares its own book", async () => {
  const walkAll = screenOf();
  const st = state();
  const now = new Date();
  const { from } = monthSpan(now.getFullYear(), now.getMonth());
  st.deliveryDates = [{ id: "d1", date: from }];
  st.orders = [order({ deliveryDate: from, qty: 2, customerName: "Aisyah" })];
  st.expenses = [{ id: "e1", date: from, amount: 18, category: "Packaging", method: "Cash", note: "2 boxes" }];

  const root = document.createElement("div");
  renderProfit(root, st);
  const line = (label) => walkAll(root).find((n) => String(n.className).includes("pl-row")
    && n.children[0].textContent === label);
  const popup = () => walkAll(document.getElementById("popup-layer"));
  const press = (label) => popup().find((n) => n.tagName === "BUTTON" && String(n.textContent).trim() === label);

  // Every door on the statement — a category, the Total, and both trading lines.
  for (const label of ["Packaging", "Total expenses", "Sales", "Cost of sales"]) {
    document.getElementById("popup-layer").replaceChildren();
    line(label)._listeners.click.forEach((f) => f());
    assert.ok(press("Print") && press("Share"), `${label}'s journal wears the same two presses`);
  }

  let shared = null;
  globalThis.navigator.share = (p) => { shared = p; return Promise.resolve(); };
  try {
    document.getElementById("popup-layer").replaceChildren();
    line("Sales")._listeners.click.forEach((f) => f());
    await press("Share")._listeners.click[0]();
    assert.equal(shared.title, "Sales journal");
    assert.match(shared.text, /Focaccia × 2 · Aisyah/, "what leaves is the journal she opened");
    assert.ok(shared.text.split("\n").find((l) => l.startsWith("Total")).endsWith("RM 30.00"),
      "and it lands on that line's own figure");
    assert.match(shared.text, /From More → Profit\./, "with where it came from on it");
  } finally { delete globalThis.navigator.share; }
});

// ── ★★ Profit's own "All" (v403) ──────────────────────────────────────────────
test("★★⚠️ Profit's 'All' counts a sale from long ago — it read ZERO before this was fixed", () => {
  // ⚠️⚠️ FOUND BY DRIVING THE SCREEN, NOT BY A TEST. Money's range rule was fixed first, and Profit kept
  // reading **Sales RM 0.00 for "All"** beside a month of real orders — because `profit.js` had written
  // its OWN copy of the range comparison, and an empty bound (`"" <= ""` fails) matched nothing. **A
  // green suite said everything was fine.** The rule now lives once, in `dates.js`, and this is the
  // assertion that keeps Profit pointed at it.
  const st = state();
  st.deliveryDates = [{ id: "d_old", date: "2026-01-05", notes: "" }];
  st.orders = [{ id: "o_old", deliveryDateId: "d_old", productId: "prd_f", qty: 4,
    status: "delivered", unitPrice: 15, paidReceived: true, paidMethod: "cash" }];
  const all = profitBetween(st, "", "");
  assert.equal(all.sales, 60,
    "⚠️⚠️ Profit's 'All' does not reach an old sale — it is reading zero for a window with no bounds");
});
