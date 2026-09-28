// test/orders-day-sum.test.js — the "Set day's availability" pop-up shows HOW the
// day adds up: one line per product on sale that day, ending on the number the
// order page itself uses. The owner asked for it on 15 Sep 2026 after the day's
// chip read "1/42" with no way to see where the 42 came from, or why a product she
// does not sell that day was inside it.
//
// The screens sit behind the sign-in, so this builds the pop-up for real and holds
// its arithmetic against effectiveCapacity — the function the shop's numbers come
// from. "Now" is frozen at Thu 10 Sep 2026, as in orders-cal.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, parentNode: null, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } },
    replaceChildren(...cs) {
      // The children it drops are ORPHANED, not merely forgotten. A pop-up closes by
      // emptying its layer, and a screen inside that pop-up asks whether it is still
      // connected before writing into it — so a node left pointing at the layer it was
      // taken out of would go on answering "yes, still here" for the rest of the run.
      for (const old of this.children) if (old && old.nodeType === 1) old.parentNode = null;
      this.children = [];
      for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  // isConnected, MODELLED RATHER THAN ASSUMED. A screen that opens a card and then
  // writes into it asks its own node whether it is still on the page — the courier
  // panel does, to stop a slow reply landing in a pop-up she has already closed. A
  // stand-in that answered `undefined` would send every such write down the "it is
  // gone" path and every test would pass for the wrong reason. So a node is connected
  // exactly when walking UP from it reaches the document, and a node that is merely
  // built and never appended is not — which is the unforgiving direction.
  Object.defineProperty(node, "isConnected", {
    get() {
      let n = this;
      while (n) { if (n.__root) return true; n = n.parentNode; }
      return false;
    },
  });
  return node;
}
// A layer registry, so the pop-up held in "popup-layer" can be read back after it
// has been built. A layer is a real element of index.html, so it is a root.
const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= Object.assign(createEl("div"), { __root: true })),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
};
globalThis.document.body.__root = true;
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(2026, 8, 10, 10, 0, 0); // Thu 10 Sep 2026
  }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");
const { effectiveCapacity } = await import("../admin/js/bom.js");
const { orderCode, orderLinePrice } = await import("../admin/js/state.js");
const { forgetPublishedCards } = await import("../admin/js/supabase.js");

// Focaccia sells every day; the Saturday loaf is marked Saturdays only, and the
// day on screen (Thu 10 Sep) is not one of them. One order is already booked.
function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }],
    products: [
      { id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" },
      { id: "p2", name: "Saturday loaf", limit: 8, active: true, recipe: [], unit: "pc",
        sellRules: [{ days: [6] }] },
    ],
    orders: [{ id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2 }],
    ingredients: [],
    occasions: [],
    settings: { cutoff: "18:00", defaultCapacity: 12, currency: "RM" },
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const byClass = (root, name) => all(root).find((n) => String(n.className).includes(name));
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
// One pop-up now holds several dropdowns (who paid the courier, how they paid her),
// so a select is picked by an option it offers rather than by being the only one.
const selWith = (root, label) => all(root).find((n) => n.tagName === "SELECT"
  && all(n).some((o) => o.tagName === "OPTION" && o.textContent === label));

function openPopup(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Set day's availability")._listeners.click[0]();
  return layers["popup-layer"];
}

// The add-up table as plain lines: "· 12 Focaccia", "= 12 what the order page…".
const sumLines = (pop) => all(byClass(pop, "cost-grid"))
  .filter((n) => String(n.className).includes("cost-row"))
  .map((r) => `${byClass(r, "cost-op").textContent} ${byClass(r, "cost-val").textContent} ${byClass(r, "cost-name").textContent}`);
const totalOf = (pop) => Number(byClass(byClass(pop, "cost-total-row"), "cost-val").textContent);

test("the pop-up shows what each product contributes, ending on the shop's number", () => {
  const st = state();
  const pop = openPopup(st);

  assert.equal(byClass(pop, "cost-sum-title").textContent, "How the day adds up:");
  assert.deepEqual(sumLines(pop), [
    "· 12 Focaccia",
    "= 12 what the order page can take that day",
  ]);
  assert.equal(totalOf(pop), effectiveCapacity(st, "2026-09-10"),
    "the sum on screen IS the number the order page uses — one computation, no drift");
  assert.equal(effectiveCapacity(st, "2026-09-10"), 12, "the Saturday loaf adds nothing to a Thursday");
});

test("a product not sold that day is named as not counted, not silently dropped", () => {
  const pop = openPopup(state());
  const notes = all(pop).filter((n) => String(n.className).includes("card-sub")).map((n) => n.textContent);
  const notCounted = notes.find((t) => t.startsWith("Not counted:"));
  assert.ok(notCounted, "the pop-up says why a product it lists is not in the total");
  assert.match(notCounted, /^Not counted: Saturday loaf — not sold on this day/);

  // Its own row is still there to be adjusted — the pop-up lists every product
  // with a daily limit, and only the SUM leaves out the ones off sale.
  const rows = all(byClass(pop, "day-adj-rows")).filter((n) => String(n.className).includes("day-adjust-row"));
  assert.equal(rows.length, 2, "both products keep their row");
});

test("typing a change moves the sum and the total as she types", () => {
  const st = state();
  const pop = openPopup(st);
  const inputs = all(pop).filter((n) => String(n.className).includes("day-adj-input"));

  inputs[0].value = "3"; // Focaccia: 12 + 3
  inputs[0]._listeners.input[0]();

  assert.deepEqual(sumLines(pop), [
    "· 15 Focaccia",
    "= 15 what the order page can take that day",
  ]);
  assert.match(all(pop).map((n) => n.textContent).join(" "), /order page can still take 13/,
    "and the line under it reads against what is already booked (2)");
});

test("nothing on sale that day has a limit → the Settings default, never 0", () => {
  const st = state();
  st.products = st.products.filter((p) => p.id !== "p1"); // only the Saturday loaf is left
  const pop = openPopup(st);

  assert.equal(totalOf(pop), 12, "the day's default capacity, exactly as effectiveCapacity gives it");
  assert.equal(effectiveCapacity(st, "2026-09-10"), 12);
  assert.deepEqual(sumLines(pop), [
    "= 12 the day's default capacity (Settings) — nothing on sale this day has a daily limit",
  ]);
});

// ── v97: the tracking number lives in the Edit pop-up too ────────────────────
test("the Edit pop-up shows the tracking number and writes a new one back", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].trackingNo = "JT123";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  const pop = layers["popup-layer"];
  const box = all(pop).find((n) => n.tagName === "INPUT" && n.attrs.placeholder === "e.g. JT123456789");
  assert.ok(box, "the pop-up carries a box for the courier's number");
  assert.equal(box.value, "JT123", "opened on the number already saved");

  box.value = "JT999 888";
  box._listeners.input[0](); // the draft follows as she types
  buttonByText(pop, "Save changes")._listeners.click[0]();
  assert.equal(st.orders[0].trackingNo, "JT999 888", "and it reaches the order on save");
});

// ── v98/v101: Note / tracking / payment — the short way in, without Edit ────
test("Note / tracking opens just those fields, and save writes them onto the order", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].note = "no nuts";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Note / tracking")._listeners.click[0]();
  const pop = layers["popup-layer"];
  assert.match(all(pop).find((n) => String(n.className).includes("popup-title-row")).textContent,
    /^Note \/ tracking \/ courier \/ payment/, "a pop-up of its own, not the whole Edit form (with the order code beside it)");
  const inputs = all(pop).filter((n) => n.tagName === "INPUT");
  assert.equal(inputs.length, 3, "the note, the number and the courier's charge — nothing else to scroll past");
  assert.equal(inputs[0].value, "no nuts", "the note as it stands");
  assert.equal(inputs[1].attrs.placeholder, "e.g. JT123456789", "and the courier's number");
  assert.equal(inputs[2].attrs.placeholder, "e.g. 8.00", "and what the courier charged");
  const paidSel = selWith(pop, "TNG transfer");
  assert.ok(paidSel, "with how it was paid");
  assert.deepEqual(paidSel.children.map((o) => o.children[0].text),
    ["Not recorded", "Cash", "TNG transfer"], "as a three-way choice, not recorded by default");

  inputs[0].value = "extra sauce";
  inputs[1].value = " JT999 888 ";
  paidSel.value = "cash";
  buttonByText(pop, "Save")._listeners.click[0]();
  assert.equal(st.orders[0].note, "extra sauce", "the note reaches the order");
  assert.equal(st.orders[0].trackingNo, "JT999 888", "and so does the number, trimmed at the ends");
  assert.equal(st.orders[0].paidMethod, "cash", "and how it was paid is recorded for reconciling");

  // "Not recorded" is the absent key, not an empty string, so a row that never had
  // a method reads exactly as it did before this existed.
  const root2 = createEl("div");
  renderOrders(root2, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root2, "Note / tracking")._listeners.click[0]();
  const pop2 = layers["popup-layer"];
  selWith(pop2, "TNG transfer").value = "";
  buttonByText(pop2, "Save")._listeners.click[0]();
  assert.equal("paidMethod" in st.orders[0], false, "choosing Not recorded deletes the key");
});

// ── v124: the courier's charge, and who bore it ────────────────────────────
// The pop-up she pointed at ("the paid by in the notes/courier Tracking is for
// courier charges") now carries the charge itself. What these pin is the split she
// chose — "off profit only if I paid it" — reaching the order AND her books from the
// one Save.
const inputWithPlaceholder = (pop, ph) =>
  all(pop).find((n) => n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === ph);
const feeInput = (pop) => inputWithPlaceholder(pop, "e.g. 8.00");

test("the courier charge reaches every row, and only she paying makes it an expense", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].groupId = "ordgabc123";
  st.orders.push({ ...st.orders[0], id: "o2", qty: 1 }); // a second item of one order
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Note / tracking")._listeners.click[0]();
  let pop = layers["popup-layer"];
  assert.equal(selWith(pop, "Loan"), undefined,
    "how she paid is not asked until she says she paid it");
  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box); // the handler reads this.value
  const payerSel = selWith(pop, "I paid it");
  payerSel.value = "me";
  payerSel._listeners.change[0]();

  pop = layers["popup-layer"]; // the body was rebuilt to reveal the question
  const methodSel = selWith(pop, "Loan");
  assert.ok(methodSel, "now it asks how she paid the courier");
  methodSel.value = "TNG";
  buttonByText(pop, "Save")._listeners.click[0]();

  assert.equal(st.orders.length, 2, "still one order of two items");
  for (const o of st.orders) {
    assert.equal(o.courierFee, 8, "the charge belongs to the order, so every row carries it");
    assert.equal(o.courierPaidBy, "me");
  }
  assert.equal(st.expenses.length, 1, "and it became exactly one expense for that order");
  assert.equal(st.expenses[0].amount, 8);
  assert.equal(st.expenses[0].category, "Delivery & fuel");
  assert.equal(st.expenses[0].method, "TNG", "filed in the book she said she paid from");
});

test("a charge the customer bears is tagged on the row and writes nothing to her books", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const tag = all(root).find((n) => String(n.className).includes("paid-tag courier"));
  assert.ok(tag, "the charge is on the row, in the paid-tag's own family");
  assert.equal(tag.textContent, "Courier RM 8.00 · customer");
  assert.equal(String(tag.className).includes("mine"), false,
    "and wears no amber — it is not her money going out");
  assert.equal((st.expenses || []).length, 0, "nor is it an expense: it never touched her purse");
});

test("a charge she bore wears the amber tag, because it is already off her profit", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "me";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  const tag = all(root).find((n) => String(n.className).includes("paid-tag courier"));
  assert.equal(tag.textContent, "Courier RM 8.00 · me");
  assert.ok(String(tag.className).includes("mine"), "told apart at a glance from one she did not pay");
});

test("an item swapped out through Edit leaves the courier charge on the order", () => {
  // The charge belongs to the ORDER, not to any one item — so replacing the only
  // item must not take it with it. Edit has no courier control of its own; it carries
  // the two fields into the row it creates here, which is the only path where they
  // would otherwise be dropped.
  const st = state();
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "me";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  let pop = layers["popup-layer"];
  all(pop).find((n) => String(n.className).includes("inbox-del"))._listeners.click[0](); // ✕ that item
  pop = layers["popup-layer"];
  buttonByText(pop, "＋ Add another item")._listeners.click[0]();
  pop = layers["popup-layer"];
  const prodSel = selWith(pop, "Product…");
  prodSel.value = "p1";
  prodSel._listeners.change[0]();
  pop = layers["popup-layer"];
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders.length, 1, "one order of one item — the old line really was replaced");
  assert.equal(st.orders[0].courierFee, 8, "and the order kept the charge it had");
  assert.equal(st.orders[0].courierPaidBy, "me", "including who bore it");
});

// ── v101: the price she types on an order is what that order is sold at ─────
test("a price changed in the Edit pop-up is frozen onto that order", () => {
  const st = state();
  st.products[0].price = 15; // Focaccia, RM15
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  const pop = layers["popup-layer"];
  const box = all(pop).find((n) => String(n.className).includes("line-price"));
  assert.ok(box, "each item line carries its selling price");
  assert.equal(String(box.value), "15", "and it opens on the price the order is sold at");

  box.value = "12.50";
  box._listeners.input.forEach((f) => f.call(box)); // the handler reads this.value
  assert.match(all(pop).map((n) => n.textContent).join(" "), /Order total: RM 25.00/,
    "2 × RM12.50 — the total follows the price she typed");

  buttonByText(pop, "Save changes")._listeners.click[0]();
  assert.equal(st.orders[0].unitPrice, 12.5, "the order is sold at the price she typed");
  // A menu price changed later never rewrites the sale.
  st.products[0].price = 22;
  assert.equal(orderLinePrice(st, st.orders[0]), 12.5, "and it stays that price afterwards");
});

// ── v125/v126: the total the charge lands in, on HER side of the app ───────
// "if customer were to paid courier, the total is not shown to me and to
// customer" (19 Sep 2026). The reminder, the shipped message and the track card
// had it from the first save; the two figures SHE reads did not.
const popText = (pop) => all(pop).map((n) => n.textContent).join(" | ");

test("the courier box says what the customer owes, and moves the moment they bear it", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15; // 2 × RM15 of bread
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Note / tracking")._listeners.click[0]();
  let pop = layers["popup-layer"];
  assert.match(popText(pop), /The customer owes RM 30\.00/,
    "the box says what the order comes to before any charge is typed");
  assert.deepEqual(openedOn(selWith(pop, "The customer paid it")), ["The customer paid it"],
    "and the payer question opens on The customer paid it — her ask, 27 Sep 2026 (v216)");

  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box); // the handler reads this.value
  assert.match(popText(pop), /The customer owes RM 38\.00 — items total RM 30\.00 \+ courier charge RM 8\.00/,
    "so a typed amount is theirs without any further answer — that is what the default means");

  const unowned = selWith(pop, "The customer paid it");
  unowned.value = "";                  // back to "Not recorded"
  unowned._listeners.change[0]();
  assert.match(popText(pop), /The customer owes RM 30\.00/,
    "and taking the answer back off it leaves an amount nobody owns — the customer owes the bread alone");

  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  pop = layers["popup-layer"]; // the body repaints on the payer, as the method line does
  assert.match(popText(pop), /The customer owes RM 38\.00 — items total RM 30\.00 \+ courier charge RM 8\.00/,
    "now it is their money: the bread, the charge, and the sum she will ask for, told apart");

  const mine = selWith(pop, "I paid it");
  mine.value = "me";
  mine._listeners.change[0]();
  pop = layers["popup-layer"];
  assert.match(popText(pop), /The customer owes RM 30\.00/,
    "a charge she bears is her own cost — what the customer owes never moves for it");
});

test("an order that already records a payer opens on THAT payer, not on the default (v216)", () => {
  // The default is a default and never an overwrite. An order she already answered is
  // opened showing the answer she gave — otherwise merely looking at an old charge would
  // be enough to re-attribute it to the customer, and the next Save would move her money.
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "me";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Note / tracking")._listeners.click[0]();
  const payer = selWith(layers["popup-layer"], "The customer paid it");
  assert.deepEqual(openedOn(payer), ["I paid it"],
    "the charge she bore is still shown as hers, however the default is set");

  buttonByText(layers["popup-layer"], "Save")._listeners.click[0]();
  assert.equal(st.orders[0].courierPaidBy, "me",
    "and saving without touching it leaves the payer exactly as it was");
});

test("the Edit pop-up's order total counts a charge the customer bears, and names it", () => {
  const st = state();
  st.products[0].price = 15;
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  assert.match(popText(layers["popup-layer"]),
    /Order total: RM 38\.00 — items total RM 30\.00 \+ courier charge RM 8\.00/,
    "the figure she reads as the order's worth includes what the customer pays the courier");
});

test("a charge she bore stays out of the Edit order total", () => {
  const st = state();
  st.products[0].price = 15;
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "me";
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  const text = popText(layers["popup-layer"]);
  assert.match(text, /Order total: RM 30\.00/, "her own cost is not something the customer owes");
  assert.doesNotMatch(text, /Order total: RM 38/,
    "nor may it be added to the total she reads as the order's worth");
});

// ── v127: deleting the charge takes the tag off the row ────────────────────
// "why i delete courier charges and the tag is not remove?" (19 Sep 2026).
// The row's charge tag is the paid-tag wearing "courier" — NOT the fulfillment tag,
// which also says "Courier" on a courier order.
const rowTag = (root) => all(root).find((n) =>
  String(n.className).includes("paid-tag") && String(n.className).includes("courier"));

// Open the Note / tracking box on the first order of `st` and hand back both the
// rendered day and the popped-up body.
function courierBox(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Note / tracking")._listeners.click[0]();
  return { root, pop: layers["popup-layer"] };
}

const charged = () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  return st;
};

test("clearing the amount takes the charge, and its tag, off the row", () => {
  const st = charged();
  const { root, pop } = courierBox(st);
  assert.ok(rowTag(root), "the charge is tagged to start with");

  const box = feeInput(pop);
  box.value = "";                      // she deletes the amount
  box._listeners.input[0].call(box);
  buttonByText(pop, "Save")._listeners.click[0]();

  assert.equal(st.orders[0].courierFee, undefined, "the field is gone");
  assert.equal(rowTag(root), undefined, "and so is the tag");
});

test("setting the payer back to Not recorded deletes the charge rather than tagging it as the customer's", () => {
  const st = charged();
  const { root, pop } = courierBox(st);

  const sel = selWith(pop, "The customer paid it");
  sel.value = "";                      // back to "Not recorded"
  sel._listeners.change[0]();
  buttonByText(layers["popup-layer"], "Save")._listeners.click[0]();

  assert.equal(st.orders[0].courierPaidBy, undefined, "nobody bears it any more");
  assert.equal(st.orders[0].courierFee, undefined,
    "and the amount goes with the payer — a charge nobody owns is not a charge");
  assert.equal(rowTag(root), undefined, "so the row is left clean");
});

test("an amount recorded without a payer is never tagged as the customer's", () => {
  // A charge from an older backup, or half-filled in by hand: the amount is there but
  // nobody said who owed it. The row may not fill that blank in as "customer" — she
  // never said so, and it would tell the customer they owe money they do not.
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  assert.equal(rowTag(root), undefined, "no payer, no tag");
});

// The customer's track card carries the charge, so CLEARING one has to reach the card
// too. Publishing only fired for a new charge, which left the customer looking at a
// courier line she had just deleted (19 Sep 2026).
test("clearing the charge republishes the customer's card without it", async () => {
  const st = charged();
  st.products[0].price = 15;           // 2 × RM15 of bread, so the total is worth reading
  st.settings.supabase = { enabled: true, url: "https://project.test",
    anonKey: "anon", email: "a@b.c", password: "pw" };
  const { pop } = courierBox(st);

  const box = feeInput(pop);
  box.value = "";
  box._listeners.input[0].call(box);

  const posts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("order_tracking")) posts.push(JSON.parse(opts.body)[0]);
    if (String(url).includes("/auth/v1/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    buttonByText(pop, "Save")._listeners.click[0]();
    for (let i = 0; i < 20 && !posts.length; i++) await new Promise((r) => setTimeout(r, 0));
  } finally { globalThis.fetch = real; }

  assert.equal(posts.length, 1, "the card is republished when the charge goes");
  assert.equal(posts[0].courier_fee, null, "and it no longer names a charge");
  assert.equal(posts[0].total, "RM 30.00", "nor has it the charge inside the total");
});

// ── v128: Courier COD — the charge the courier collects at the door ─────────
// "courier charges can be collect, that means customer pay courier upon collect"
// (19 Sep 2026). Same charge, same customer bears it — settled at the door instead
// of with the order. Two failures this section exists to catch: the same RM8 asked
// for twice (the total), and switching ONLY the mode leaving the customer's card
// quoting a figure that no longer holds.
const COD_LABEL = "COD - the courier collects it on delivery";
const codSelIn = (pop) => selWith(pop, COD_LABEL);
// Which option a dropdown OPENS on. select() marks the choice with the `selected`
// property rather than the node's value — the first paint happens before a browser
// has settled which option that is (ui.js:71) — so the marked option is what the
// customer's phone will actually show, and the only honest thing to assert on.
const openedOn = (sel) =>
  sel.children.filter((o) => o.selected).map((o) => o.children[0].text);

test("how they settle the charge is asked only when the customer bears it", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  const { pop } = courierBox(st);
  // v216: the payer question opens on The customer paid it, so the question that follows
  // it is on the card from the first paint — she has already given the answer that
  // summons it. It is drawn WITH its parent, not ahead of it.
  assert.deepEqual(openedOn(selWith(pop, "The customer paid it")), ["The customer paid it"],
    "the payer question opens on The customer paid it — her ask, 27 Sep 2026");
  assert.ok(codSelIn(pop), "and how they settle it is asked with it, on the customer's own branch");

  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  assert.ok(codSelIn(pop), "typing the amount only makes clearer what the question is about");

  const mine = selWith(pop, "I paid it");
  mine.value = "me";
  mine._listeners.change[0]();
  assert.equal(codSelIn(layers["popup-layer"]), undefined,
    "a charge she paid has nothing for anyone to collect at the door");

  const unowned = selWith(layers["popup-layer"], "The customer paid it");
  unowned.value = "";                  // back to "Not recorded"
  unowned._listeners.change[0]();
  assert.equal(codSelIn(layers["popup-layer"]), undefined,
    "and an amount on its own owns nobody — who bears it decides");

  const theirs = selWith(layers["popup-layer"], "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  const sel = codSelIn(layers["popup-layer"]);
  assert.ok(sel, "now it asks how they settle it, on the same branch it asks how she paid hers");
  assert.deepEqual(sel.children.map((o) => o.children[0].text), ["With their order (in the total)", COD_LABEL],
    "two ways, and with the order is the first — the way every charge already recorded was settled");
  assert.deepEqual(openedOn(sel), ["With their order (in the total)"],
    "and it opens on the old behaviour rather than re-labelling a charge already recorded");
});

test("the box names what the courier collects, and keeps it out of the total she asks for", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  const { pop } = courierBox(st);
  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  let pop2 = layers["popup-layer"];
  assert.match(popText(pop2), /The customer owes RM 38\.00 — items total RM 30\.00 \+ courier charge RM 8\.00/,
    "with the order, the charge is inside what she asks for, exactly as v126 read it");

  const sel = codSelIn(pop2);
  sel.value = "cod";
  sel._listeners.change[0]();
  assert.match(popText(layers["popup-layer"]),
    /The customer owes RM 30\.00 — items total RM 30\.00, plus RM 8\.00 collected by the courier on delivery/,
    "COD: the bread is what she asks for, and the charge is named as the courier's to take — never added in, or she asks for the RM8 twice");
});

test("a COD charge is written onto every row of the order, and goes with the mode", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].groupId = "ordgabc123";
  st.orders.push({ ...st.orders[0], id: "o2", qty: 1 }); // a second item of one order
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Note / tracking")._listeners.click[0]();
  let pop = layers["popup-layer"];
  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  pop = layers["popup-layer"];
  const sel = codSelIn(pop);
  sel.value = "cod";
  sel._listeners.change[0]();
  buttonByText(pop, "Save")._listeners.click[0]();

  for (const o of st.orders) {
    assert.equal(o.courierFee, 8, "the charge belongs to the order, so every row carries it");
    assert.equal(o.courierPaidBy, "customer");
    assert.equal(o.courierCod, true, "and the mode belongs to the order too");
  }
  assert.equal((st.expenses || []).length, 0, "a COD charge never reaches her books either way it is settled");

  // Back to with the order: the flag goes, because the charge is no longer collected.
  const root3 = createEl("div");
  renderOrders(root3, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root3, "Note / tracking")._listeners.click[0]();
  let pop3 = layers["popup-layer"];
  const back = codSelIn(pop3);
  assert.deepEqual(openedOn(back), [COD_LABEL],
    "the box opens on the mode she saved, not back on the default — a re-save must not quietly undo it");
  back.value = "";
  back._listeners.change[0]();
  buttonByText(layers["popup-layer"], "Save")._listeners.click[0]();
  for (const o of st.orders) {
    assert.equal("courierCod" in o, false, "with the order again, so the flag is deleted rather than left behind");
    assert.equal(o.courierFee, 8, "the charge itself is untouched — only how it is settled moved");
  }
});

test("the row tag says COD, so she knows the courier takes it rather than looking in her tin", () => {
  const st = charged();
  st.orders[0].courierCod = true;
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  assert.equal(rowTag(root).textContent, "Courier RM 8.00 · customer · COD",
    "both halves the v127 tag kept, plus which way the money moves");
});

test("clearing the payer takes the COD flag with the rest of the charge", () => {
  const st = charged();
  st.orders[0].courierCod = true;
  const { root, pop } = courierBox(st);

  const sel = selWith(pop, "The customer paid it");
  sel.value = "";                      // back to "Not recorded"
  sel._listeners.change[0]();
  buttonByText(layers["popup-layer"], "Save")._listeners.click[0]();

  assert.equal("courierFee" in st.orders[0], false, "a charge nobody owns is not a charge");
  assert.equal("courierCod" in st.orders[0], false,
    "and a COD flag on no charge would tell a customer the courier is collecting nothing");
  assert.equal(rowTag(root), undefined, "so the row is left clean");
});

test("a charge she bore is never marked COD", () => {
  // The flag is only ever true of a charge the CUSTOMER bears. Setting the payer to
  // herself must take it with it, or a charge she has already paid would be read as
  // one the courier is still going to collect.
  const st = charged();
  st.orders[0].courierCod = true;
  const { pop } = courierBox(st);

  const mine = selWith(pop, "I paid it");
  mine.value = "me";
  mine._listeners.change[0]();
  buttonByText(layers["popup-layer"], "Save")._listeners.click[0]();

  assert.equal(st.orders[0].courierPaidBy, "me");
  assert.equal("courierCod" in st.orders[0], false, "her own charge has nothing for anyone to collect at the door");
});

test("an item swapped out through Edit leaves a COD charge on the order", () => {
  const st = state();
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  st.orders[0].courierCod = true;
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));

  buttonByText(root, "Edit")._listeners.click[0]();
  let pop = layers["popup-layer"];
  all(pop).find((n) => String(n.className).includes("inbox-del"))._listeners.click[0](); // ✕ that item
  pop = layers["popup-layer"];
  buttonByText(pop, "＋ Add another item")._listeners.click[0]();
  pop = layers["popup-layer"];
  const prodSel = selWith(pop, "Product…");
  prodSel.value = "p1";
  prodSel._listeners.change[0]();
  pop = layers["popup-layer"];
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders[0].courierCod, true,
    "Edit rewrites the whole row, so the mode rides along or editing quietly drops it");
  assert.equal(st.orders[0].courierFee, 8);
  assert.equal(st.orders[0].courierPaidBy, "customer");
});

test("switching only the mode republishes the customer's card", async () => {
  // The trap: the charge itself does not move when she switches the mode, but the
  // published TOTAL does, by the whole charge. A republish keyed only on the charge
  // would leave the customer reading a total she is no longer asked for.
  const st = charged();                 // RM8, the customer bears it, with the order
  st.products[0].price = 15;            // 2 × RM15 of bread
  st.settings.supabase = { enabled: true, url: "https://project.test",
    anonKey: "anon", email: "a@b.c", password: "pw" };
  const { pop } = courierBox(st);

  const sel = codSelIn(pop);
  assert.ok(sel, "the box opens on the mode the charge is already settled in");
  sel.value = "cod";
  sel._listeners.change[0]();

  const posts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("order_tracking")) posts.push(JSON.parse(opts.body)[0]);
    if (String(url).includes("/auth/v1/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    buttonByText(pop, "Save")._listeners.click[0]();
    for (let i = 0; i < 20 && !posts.length; i++) await new Promise((r) => setTimeout(r, 0));
  } finally { globalThis.fetch = real; }

  assert.equal(posts.length, 1, "the card is republished even though the charge did not change");
  assert.equal(posts[0].courier_cod, true, "carrying the flag the card needs to word the line");
  assert.equal(posts[0].total, "RM 30.00", "and the total that no longer holds the charge");
  assert.equal(posts[0].courier_fee, 8, "the RM8 is still named — the card tells them to pay the courier, not her");
});

test("a save that changes nothing publishes once, then leaves the card alone", async () => {
  // The box now offers the card the new version on every save and lets the card decide
  // (19 Sep 2026). Nothing has been published in this session yet, so the first save
  // writes one row — the safe direction to be wrong in, because the other way costs the
  // customer an order that never catches up. The second save is byte-identical, so it
  // writes nothing at all.
  const st = charged();
  st.orders[0].courierCod = true;
  st.settings.supabase = { enabled: true, url: "https://project.test",
    anonKey: "anon", email: "a@b.c", password: "pw" };
  const { pop } = courierBox(st);

  const posts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("order_tracking")) posts.push(JSON.parse(opts.body)[0]);
    if (String(url).includes("/auth/v1/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    forgetPublishedCards(); // nothing is on the customer's card yet
    // Held on to: the save closes the box and rebuilds the screen, so the button cannot
    // be looked up again — but it is the same box, with the same answers in it.
    const save = buttonByText(pop, "Save");
    save._listeners.click[0]();
    for (let i = 0; i < 20 && !posts.length; i++) await new Promise((r) => setTimeout(r, 0));
    const afterFirst = posts.length;
    save._listeners.click[0](); // the same box, saved again
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(afterFirst, 1, "the first save writes the card she has never published");
    assert.equal(posts.length, 1, "and the identical second save writes nothing");
  } finally { globalThis.fetch = real; }
});

// ── v130: the courier charge's questions are under Edit too ─────────────────
// "edit a courier related now only at one button, we should make edit an order able
// to alter details for courier" (19 Sep 2026). The charge is part of what an order IS,
// and Edit is where she changes what an order is — so the same questions are asked
// there, built by ONE shared block (courierControls) so the two doors cannot word or
// write the charge differently.
//
// Two traps this section exists to catch. The charge travels BESIDE the row fields,
// never among them: the row fields are copied onto every order with Object.assign, so a
// charge riding in there would be saved onto the row as a field of its own. And Edit's
// own total has to move as she types the fee here, or the figure she reads is one she
// cannot check until after a save.
const noteInput = (pop) => all(pop).find((n) =>
  n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === "Note (optional)");
const trackingInput = (pop) => all(pop).find((n) =>
  n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === "e.g. JT123456789");

function editOn(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "Edit")._listeners.click[0]();
  return { root, pop: layers["popup-layer"] };
}

test("Edit asks the courier charge's questions, and one Save writes the order and her books together", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  const { pop } = editOn(st);

  const box = feeInput(pop);
  assert.ok(box, "the amount is askable from Edit, not only from the Note / tracking box");
  box.value = "8";
  box._listeners.input[0].call(box);

  const mine = selWith(pop, "I paid it");
  mine.value = "me";
  mine._listeners.change[0]();
  const methodSel = selWith(pop, "Loan");
  assert.ok(methodSel, "and how she paid the courier, once she says she did");
  methodSel.value = "TNG";
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders[0].courierFee, 8, "the charge reaches the order");
  assert.equal(st.orders[0].courierPaidBy, "me");
  assert.equal("courier" in st.orders[0], false,
    "and the charge itself is never saved onto the row as a field of its own — it rides beside the row, not in it");
  assert.equal(st.expenses.length, 1, "her own charge is a Delivery & fuel row, the same call the box makes");
  assert.equal(st.expenses[0].amount, 8);
  assert.equal(st.expenses[0].category, "Delivery & fuel");
  assert.equal(st.expenses[0].method, "TNG", "filed in the book she said she paid from");
  assert.equal(st.expenses[0].courierFor, orderCode(st.orders[0]), "and back-linked to this order");
});

test("Edit opens on the charge the order already carries, in all its parts", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  st.orders[0].courierCod = true;
  const { pop } = editOn(st);

  assert.equal(feeInput(pop).value, "8", "the amount she recorded is in the box");
  assert.deepEqual(openedOn(selWith(pop, "The customer paid it")),
    ["The customer paid it"], "and who bore it is what the dropdown opens on");
  assert.deepEqual(openedOn(codSelIn(pop)), [COD_LABEL],
    "and how they settle it — a re-save from here must not quietly put a COD charge back into their total");
});

test("Edit's own total follows the fee box as she types, and names the charge", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;                 // 2 × RM15 of bread
  const { pop } = editOn(st);
  assert.match(popText(pop), /Order total: RM 30\.00/,
    "no charge yet, so the total is the items and nothing else");

  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  assert.match(popText(pop),
    /Order total: RM 38\.00 — items total RM 30\.00 \+ courier charge RM 8\.00/,
    "the figure she reads here moves with the box — a total that only moved after a save is one she cannot check");

  const sel = codSelIn(pop);
  sel.value = "cod";
  sel._listeners.change[0]();
  assert.match(popText(pop),
    /Order total: RM 30\.00 — items total RM 30\.00, plus RM 8\.00 collected by the courier on delivery/,
    "COD: the courier takes it, so it is named under the total rather than added into it");
});

test("a charge cleared through Edit leaves no key behind, and republishes the card", async () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "customer";
  st.orders[0].courierCod = true;
  st.products[0].price = 15;
  st.settings.supabase = { enabled: true, url: "https://project.test",
    anonKey: "anon", email: "a@b.c", password: "pw" };
  const { pop } = editOn(st);

  const box = feeInput(pop);
  box.value = "";
  box._listeners.input[0].call(box);

  const posts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("order_tracking")) posts.push(JSON.parse(opts.body)[0]);
    if (String(url).includes("/auth/v1/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    buttonByText(pop, "Save changes")._listeners.click[0]();
    for (let i = 0; i < 20 && !posts.length; i++) await new Promise((r) => setTimeout(r, 0));
  } finally { globalThis.fetch = real; }

  for (const key of ["courierFee", "courierPaidBy", "courierCod"]) {
    assert.equal(key in st.orders[0], false,
      `${key} is deleted, not left at 0 — a cleared charge is no charge`);
  }
  assert.equal(posts.length, 1, "and the customer's card is republished, because its total just moved");
  assert.equal(posts[0].courier_fee, null, "without the charge on it");
  assert.equal(posts[0].total, "RM 30.00");
});

test("Edit can mark a customer's charge COD, and it stays out of her books either way", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  const { pop } = editOn(st);

  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();
  const sel = codSelIn(pop);
  sel.value = "cod";
  sel._listeners.change[0]();
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders[0].courierFee, 8);
  assert.equal(st.orders[0].courierPaidBy, "customer");
  assert.equal(st.orders[0].courierCod, true, "the courier collects it at the door");
  assert.equal("courier" in st.orders[0], false, "still never saved as a field on the row");
  assert.equal((st.expenses || []).length, 0, "and a customer's charge never writes to her books");
});

test("changing who paid the courier keeps the note and the tracking number she was part-way through", () => {
  // Both doors ask the same questions now, and the block repaints only ITSELF when the
  // payer changes. Rebuilding the whole pop-up for that would throw away whatever she
  // had typed in the boxes beside it (19 Sep 2026).
  const st = state();
  st.orders[0].fulfillment = "courier";
  const { pop } = courierBox(st);

  const note = noteInput(pop);
  const tracking = trackingInput(pop);
  note.value = "no nuts";
  tracking.value = "JT999 888";

  const theirs = selWith(pop, "The customer paid it");
  theirs.value = "customer";
  theirs._listeners.change[0]();

  assert.equal(noteInput(pop), note, "the note box is the one she was typing in, not a rebuilt one");
  assert.equal(note.value, "no nuts", "so what she typed is still there");
  assert.equal(tracking.value, "JT999 888", "and so is the tracking number");

  buttonByText(pop, "Save")._listeners.click[0]();
  assert.equal(st.orders[0].note, "no nuts", "and both of them still reach the order on save");
  assert.equal(st.orders[0].trackingNo, "JT999 888");
});

// ── v131: the customer's card keeps up with the order ───────────────────────
// "add new order and edit order din sync?" (19 Sep 2026). Her own two phones were never
// the problem — an order is a synced record. The customer's track card was: it was only
// published when a day moved, the tracking number moved or the charge moved, so an edit
// that changed the ITEMS, the price, the address or the name moved nothing, and a card
// she had already sent the link for went on quoting the order it used to be. Adding an
// order published no card at all.
//
// The fix is not a longer list of fields — that list is what failed. Every door now hands
// the card the whole new version and the card itself decides, so a field the card shows
// can never be left out of the decision again.
const drain = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const cloud = (st) => {
  st.settings.supabase = { enabled: true, url: "https://project.test",
    anonKey: "anon", email: "a@b.c", password: "pw" };
};
function publishSpy() {
  const posts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("order_tracking")) posts.push(JSON.parse(opts.body)[0]);
    if (String(url).includes("/auth/v1/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  return { posts, stop: () => { globalThis.fetch = real; } };
}
// One item line picked, ready for "＋ Add order" — the item row's dropdown reads its own
// value, which the shim cannot type into, so it is set and then fired by hand. A product
// option is labelled with the day's count as well as the name ("Focaccia — 10 left"), so
// the line is found by the name it starts with.
const productSel = (root, name) => all(root).find((n) => n.tagName === "SELECT"
  && all(n).some((o) => o.tagName === "OPTION" && o.textContent.startsWith(name)));
function pickItem(root, productId, name) {
  const sel = productSel(root, name);
  sel.value = productId;
  sel._listeners.change[0].call(sel);
}
// Press Add order, answering the backfill question the same way she does. A day whose
// 6pm cutoff has passed asks before it takes the order, so a test that only pressed the
// button would be testing the question rather than the add.
function pressAdd(root) {
  const layer = layers["confirm-layer"];
  if (layer) layer.replaceChildren(); // an earlier test's dialog cannot answer this one
  buttonByText(root, "＋ Add order")._listeners.click[0]();
  const yes = buttonByText(layers["confirm-layer"], "Add anyway");
  if (yes) yes._listeners.click[0]();
}

test("adding an order gives the customer's card something to be", async () => {
  const st = state();
  cloud(st);
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  pickItem(root, "p1", "Focaccia");

  const spy = publishSpy();
  try {
    forgetPublishedCards();
    pressAdd(root);
    await drain();
  } finally { spy.stop(); }

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order is in her list");
  assert.equal(added.customerName, "", "with no name typed, as she added it");
  assert.equal(spy.posts.length, 1, "and the card exists from the moment the order does");
  assert.equal(spy.posts[0].code, orderCode(added), "keyed on the code her tracking link carries");
  assert.equal(spy.posts[0].status, "new", "reading what the order is, not what a later tap made it");
  assert.equal(spy.posts[0].items, "Focaccia ×1");
});

test("a multi-item add publishes one card for the whole order", async () => {
  // The group has one code, so it has one card — the same rule a storefront order follows.
  const st = state();
  cloud(st);
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  buttonByText(root, "＋ Add another item")._listeners.click[0]();
  const pickers = all(root).filter((n) => n.tagName === "SELECT"
    && all(n).some((o) => o.tagName === "OPTION" && o.textContent.startsWith("Focaccia")));
  assert.equal(pickers.length, 2, "the card offers two item lines");
  for (const sel of pickers) { sel.value = "p1"; sel._listeners.change[0].call(sel); }

  const spy = publishSpy();
  try {
    forgetPublishedCards();
    pressAdd(root);
    await drain();
  } finally { spy.stop(); }

  const added = st.orders.filter((o) => o.id !== "o1");
  assert.equal(added.length, 2, "both lines are on the order");
  assert.equal(added[0].groupId, added[1].groupId, "sharing one group, so one code");
  assert.equal(spy.posts.length, 1, "and one card, not one per line");
  assert.equal(spy.posts[0].code, orderCode(added[0]));
  assert.match(spy.posts[0].items, /Focaccia ×1, Focaccia ×1/);
});

test("the price she types in Edit reaches the card the customer is reading", async () => {
  // The gap she asked about, in its plainest form: the card's total comes from the rows,
  // and a hand-kept list of "what the card shows" did not include the price.
  const st = state();
  st.products[0].price = 15;
  st.orders[0].unitPrice = 15;
  cloud(st);
  const { pop } = editOn(st);

  const box = byClass(pop, "line-price");
  box.value = "20";
  box._listeners.input[0].call(box);

  const spy = publishSpy();
  try {
    forgetPublishedCards();
    buttonByText(pop, "Save changes")._listeners.click[0]();
    await drain();
  } finally { spy.stop(); }

  assert.equal(st.orders[0].unitPrice, 20, "the order is sold at what she typed");
  assert.equal(spy.posts.length, 1, "and the customer's card is brought up to date");
  assert.equal(spy.posts[0].total, "RM 40.00", "with the total their order now comes to");
  assert.equal(spy.posts[0].items, "Focaccia ×2", "and the quantity, which did not change");
});

test("an edit that changes nothing the card shows leaves it alone", async () => {
  // The other half of the bargain: the door hands the card over on every save, so the
  // card has to be the one that knows when there is nothing to say. The WhatsApp number
  // is on the order but not on the card, so editing it writes no card at all.
  const st = state();
  st.products[0].price = 15;
  st.orders[0].unitPrice = 15;
  cloud(st);
  const spy = publishSpy();
  try {
    forgetPublishedCards();
    const first = editOn(st);
    buttonByText(first.pop, "Save changes")._listeners.click[0]();
    await drain();
    assert.equal(spy.posts.length, 1, "the first save is the card's first version");

    const again = editOn(st);
    const wa = all(again.pop).find((n) =>
      n.tagName === "INPUT" && n.attrs && n.attrs.placeholder === "e.g. 012-345 6789");
    assert.ok(wa, "the WhatsApp box is there to change");
    wa.value = "60111222333";
    wa._listeners.input[0].call(wa);
    buttonByText(again.pop, "Save changes")._listeners.click[0]();
    await drain();
  } finally { spy.stop(); }

  assert.equal(st.orders[0].whatsapp, "60111222333", "her own copy of the order did take the change");
  assert.equal(spy.posts.length, 1, "and the customer's card was not written for a number it does not show");
});

// ── v188: a courier's price becomes the charge on the order ──────────────────
// Phase one of the courier work, and the one path through it she has to be able to
// trust: a quoted delivery fee becoming the charge on the order. The panel builds its
// own price rows, and its [Use this fee] calls the charge box's own `set` — so a quoted
// amount and a typed one are the same kind of answer, and the payer and the COD
// questions under them behave identically whichever door the number came through.
//
// THE FAULT THESE TWO TESTS ARE WRITTEN AGAINST is this app's most repeated one: a tap
// that moves the picture and skips the write. The button's toast is not the evidence —
// the amount in the box and the customer's total below it are. The second test is the
// same fault seen from the other side, and it is the reason `set` answers whether it
// wrote: a courier can price a trip at nothing, and a zero is not a charge.

// The courier function, stood in for. It answers the two actions the panel asks — the
// fleet, and a price per vehicle — with the reply SHAPES the real function returns
// (see supabase/functions/courier/index.ts), read off the wire the way the app reads
// it. The fetch boundary is the only thing replaced; nothing under test is stubbed.
const wireReply = (total) => (body) => {
  if (body.action === "vehicles") {
    return { ok: true, services: [
      { key: "MOTORCYCLE", name: "Motorcycle" },
      { key: "7FT_VAN", name: "7ft Van" },
    ] };
  }
  if (body.action === "quote") {
    return { ok: true, quotes: [{
      serviceType: "MOTORCYCLE",
      priceBreakdown: { total, currency: "MYR" },
      distance: { value: 4.2, unit: "km" },
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    }], failed: [] };
  }
  return { ok: false, reason: `the stand-in was asked for "${body.action}", which this test did not plan for` };
};

// A courier order with both doors pinned, so the panel prices it rather than looking
// anything up. The pins are written by the app's own functions, so the state a price is
// asked of is the state the app would really hold.
async function courierState() {
  const { setPickupPlace, setDropPlace } = await import("../admin/js/courier_place.js");
  const st = state();
  const o = st.orders[0];
  o.fulfillment = "courier";
  o.customerName = "Mei Ling";
  o.whatsapp = "0169601268";
  o.address = "12 Jalan Bunga, 10450 Penang";
  st.products[0].price = 15;                       // 2 × 15 = RM 30 of bread
  st.settings.supabase = { enabled: true, url: "https://project.test", anonKey: "anon" };
  setPickupPlace(st, { lat: 5.4141, lng: 100.3288 });
  setDropPlace(st, o, { lat: 5.41, lng: 100.32, label: "12 Jalan Bunga" });
  return st;
}

// The wire, and the phone's own session, for the length of one test and not a moment
// longer. The client refuses to call anything without a session (couriers/api.js says so
// in words rather than throwing), and the session lives in storage — so both are put in
// and taken away here, rather than left behind for the test that runs next.
async function withCourierWire(total, run, { holdFor = null } = {}) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const before = globalThis.localStorage;
  globalThis.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  globalThis.localStorage.setItem("bakeadmin.supabase",
    JSON.stringify({ access_token: "test-session", expires_at: Date.now() + 3600_000 }));
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const said = JSON.parse(opts.body || "{}");
    // `holdFor(action)` is a reply that has not arrived yet — a phone on one bar of
    // signal. It is how a test gets ONE particular request in flight and then does
    // something while it is out; the action is passed in because holding the wrong one
    // changes the answer entirely.
    const wait = holdFor ? holdFor(said.action) : null;
    if (wait) await wait;
    const text = JSON.stringify(await wireReply(total)(said));
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
    if (had) globalThis.localStorage = before; else delete globalThis.localStorage;
  }
}

// The newest toast on the page. A toast is not evidence that a write happened — it is
// evidence of what the screen TOLD her, which is the thing that must not lie.
const lastToast = () => all(globalThis.document.body)
  .filter((n) => n.className === "toast").pop();
const owesLine = (pop) => all(pop)
  .find((n) => String(n.textContent).startsWith("The customer owes"));

// Close the card, and give its own clock the tick it needs to notice. The price panel
// counts each quotation down on a one-second interval and stops it the moment its node
// is off the page — so a test that leaves the card open leaves a live interval behind,
// and Node will not exit while one is running. This is not tidiness: it is the same
// self-clearing rule the panel ships, exercised rather than assumed.
const closeCard = async (pop) => {
  const x = buttonByText(pop, "✕");
  if (x) x._listeners.click[0]();
  await new Promise((r) => setTimeout(r, 1100));
};

test("a price from the courier lands in the charge box, and the customer's total moves with it", async () => {
  let pop = null;
  await withCourierWire(12.5, async () => {
    const st = await courierState();
    ({ pop } = courierBox(st));
    const open = buttonByText(pop, "Get a delivery price");
    assert.ok(open, "the price panel is reachable from the courier charge's own card");
    open._listeners.click[0]();
    await drain();

    const row = all(pop).find((n) => String(n.className).includes("quote-row"));
    assert.ok(row, "a price came back and is on screen");
    assert.match(row.textContent, /Motorcycle/, "and it wears the vehicle's own name");
    assert.match(row.textContent, /RM 12\.50/, "and the price the courier gave");

    const use = buttonByText(pop, "Use this fee");
    assert.ok(use, "with a way to take it");
    use._listeners.click[0]();
  });

  const box = feeInput(pop);
  assert.equal(box.value, "12.5",
    "the quoted amount is IN the box — the button does not merely say it wrote one");

  // The payer question is under it, opening on The customer paid it (v216) — so the
  // quoted fee is theirs the moment it lands, and the total moves with it. It is still
  // hers to change: that is why the question is drawn at all.
  const payer = selWith(pop, "The customer paid it");
  assert.ok(payer, "the payer is still hers to answer");
  assert.deepEqual(openedOn(payer), ["The customer paid it"], "and it opens on The customer paid it (v216)");
  assert.equal(owesLine(pop).textContent,
    "The customer owes RM 42.50 — items total RM 30.00 + courier charge RM 12.50",
    "the same number she would have got by typing 12.50 into the box herself");

  payer.value = "me";
  payer._listeners.change[0]();
  assert.match(owesLine(pop).textContent, /RM 30\.00$/,
    "and answering otherwise takes the charge straight back out of what the customer owes");

  await closeCard(pop);
});

test("a courier pricing a trip at nothing does not put a charge in the box, and the screen says so", async () => {
  // A total of zero is a REAL reply — Lalamove answered, and the answer was nothing —
  // and it is the case a `set` that returns nothing cannot tell apart from success. The
  // box refuses it (a charge of RM 0.00 is not a charge), and the toast has to report
  // the refusal rather than the write it did not make.
  let pop = null;
  await withCourierWire(0, async () => {
    const st = await courierState();
    ({ pop } = courierBox(st));
    buttonByText(pop, "Get a delivery price")._listeners.click[0]();
    await drain();
    const use = buttonByText(pop, "Use this fee");
    assert.ok(use, "the row is still offered — the price is real, it is just nothing");
    use._listeners.click[0]();
  });

  assert.equal(feeInput(pop).value, "", "nothing was put in the charge box");
  assert.match(lastToast().textContent, /is not a charge/,
    "and the screen says that, rather than claiming a write it did not make");
  assert.equal(lastToast().textContent.includes("put in the charge box"), false,
    "the success line is not the one she is shown");
  assert.match(owesLine(pop).textContent, /RM 30\.00$/, "the customer's total did not move either");

  await closeCard(pop);
});

// ── v215: an amount with no payer is REFUSED, not dropped in silence ─────────
// Her report, 27 Sep 2026: "The selected courier charges cannot save" — after she
// pressed [Use this fee] and then Save. The amount was in the box, the payer question
// under it was still on "Not recorded", and `courierPayQuestions.read()` settles those
// two together: no payer means no charge, so the Save wrote NOTHING — no charge, no
// expense — and still said "Order updated". The amount vanished with no word about why.
//
// A save that reports a write it did not make is the same fault as a tap that moves the
// picture and skips the write. The fix is a refusal in words, answered from the one
// place that knows what would really be written, and asked by BOTH doors into the charge
// box so neither can lose her money. These tests pin the refusal, the amount still in
// the box, the card still open — and that answering the payer saves exactly as before.

test("taking a courier's price and pressing Save with no payer is refused in words, not dropped (v215)", async () => {
  let pop = null;
  await withCourierWire(12.5, async () => {
    const st = await courierState();
    ({ pop } = courierBox(st));
    buttonByText(pop, "Get a delivery price")._listeners.click[0]();
    await drain();
    buttonByText(pop, "Use this fee")._listeners.click[0]();
    assert.equal(feeInput(pop).value, "12.5", "her press put the quoted price in the box");
    assert.deepEqual(openedOn(selWith(pop, "The customer paid it")), ["The customer paid it"],
      "and the payer question opens on The customer paid it (v216)");

    // v216: with the question opening on an answer, the ONLY way left to leave an amount
    // with nobody down for it is to take that answer back deliberately. That press is
    // exactly the state that used to lose her money in silence, so it is still refused.
    const cleared = selWith(pop, "The customer paid it");
    cleared.value = "";
    cleared._listeners.change[0]();

    buttonByText(pop, "Save")._listeners.click[0]();

    assert.equal(st.orders[0].courierFee, undefined, "the amount is NOT written without a payer");
    assert.equal((st.expenses || []).length, 0, "and her books are untouched");
    assert.match(lastToast().textContent, /RM 12\.50/,
      "the refusal names the amount that would have gone missing");
    assert.match(lastToast().textContent, /nobody is down as the payer/, "and it gives the reason");
    assert.ok(buttonByText(pop, "Save"), "the card stays open, so the answer can still be given");
    assert.equal(feeInput(pop).value, "12.5", "with the amount still in the box, not cleared under her");

    // The way out — and the proof the guard is not a blanket gate: answer the payer and
    // the very same press writes the charge.
    const payer = selWith(pop, "The customer paid it");
    payer.value = "customer";
    payer._listeners.change[0]();
    buttonByText(pop, "Save")._listeners.click[0]();
  });

  await closeCard(pop);
});

test("the Edit form refuses the same charge in the same words, so neither door can lose it (v215)", () => {
  const st = state();
  st.orders[0].fulfillment = "courier";
  st.products[0].price = 15;
  const { pop } = editOn(st);

  const box = feeInput(pop);
  box.value = "8";
  box._listeners.input[0].call(box);
  const cleared = selWith(pop, "The customer paid it");
  cleared.value = "";                  // the one way left to leave an amount unowned (v216)
  cleared._listeners.change[0]();
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders[0].courierFee, undefined, "an amount with no payer is not written here either");
  assert.equal((st.expenses || []).length, 0, "and no expense row is filed");
  assert.match(lastToast().textContent, /RM 8\.00/, "the refusal names the amount");
  assert.match(lastToast().textContent, /nobody is down as the payer/,
    "in the same words the Note / tracking card uses — one shared answer, not two opinions");
  assert.ok(buttonByText(pop, "Save changes"), "the card stays open to be answered");

  const mine = selWith(pop, "I paid it");
  mine.value = "me";
  mine._listeners.change[0]();
  buttonByText(pop, "Save changes")._listeners.click[0]();

  assert.equal(st.orders[0].courierFee, 8, "answering the payer saves exactly as it always did");
  assert.equal(st.expenses.length, 1, "including the Delivery & fuel row her own charge makes");
});

test("the fee's own toast says what still has to happen, and that a booking is not it (v215)", async () => {
  // Her question, 27 Sep 2026: "should i book?" Booking is not what saves a charge — the
  // payer question is — and the moment the fee lands is the only moment worth saying so.
  let pop = null;
  await withCourierWire(12.5, async () => {
    const st = await courierState();
    ({ pop } = courierBox(st));
    buttonByText(pop, "Get a delivery price")._listeners.click[0]();
    await drain();
    buttonByText(pop, "Use this fee")._listeners.click[0]();
  });

  assert.match(lastToast().textContent, /who paid the courier/,
    "the toast names the one thing still outstanding");
  assert.match(lastToast().textContent, /Booking a trip is separate/,
    "and says plainly that a booking is not what makes the charge save");

  await closeCard(pop);
});

test("a price that lands after she has closed the card is not written into it", async () => {
  // A price takes seconds — eight quotations, one per vehicle — and she is standing in
  // a kitchen, not waiting on a screen. So she closes the card, and the reply arrives
  // afterwards. Every write in the panel asks its own node whether it is still on the
  // page before it makes one, and this is the test that holds that rule up: without it
  // the reply lands in a card that is no longer anywhere, and the fault is invisible —
  // nothing on screen changes, because there is no screen to change.
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  let card = null;

  await withCourierWire(12.5, async () => {
    const st = await courierState();
    const { pop } = courierBox(st);
    buttonByText(pop, "Get a delivery price")._listeners.click[0]();
    await drain();                     // the ask is out on the wire, waiting
    card = pop.children[0];            // held on to ACROSS its own closing
    const x = buttonByText(pop, "✕");
    assert.ok(x, "the card can be closed");
    x._listeners.click[0]();
    release();                         // and only now does the courier answer
    await drain();
    // The QUOTE is held, not the fleet: the fleet is answered first and the panel's
    // guard for it has already passed, so holding that one would let a later guard
    // catch the reply and prove nothing about the one this test is named for.
  }, { holdFor: (action) => (action === "quote" ? held : null) });

  assert.equal(all(card).filter((n) => String(n.className).includes("quote-row")).length, 0,
    "no price row was painted into the card she had already closed");
  assert.equal(feeInput(card).value, "", "and no charge was written into the box inside it");
});
