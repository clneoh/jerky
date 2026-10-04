// test/history.test.js — saved-PO snapshots: list, multi-day detail, Regenerate
// reopen, and (new) Delete. Renders the real views under a tiny DOM shim and
// drives the confirm pop-up, so removing a snapshot works as the baker would
// touch it. history.js deliberately imports no app.js (it sets location.hash
// directly), which is what lets this view run under Node — same trick as po.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, todayISO, longDate, weekdayName } from "../admin/js/dates.js";
import { ordersFingerprint } from "../admin/js/bom.js";

// --- DOM shim (po.test.js plus a getElementById registry so confirmDialog works) ---
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.document = doc;
globalThis.window = { print() {}, open() {} };
// Keep toast timers from stalling the test run.
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
globalThis.location = { hash: "" };

import { renderHistory } from "../admin/js/views/history.js";
import { renderPO } from "../admin/js/views/po.js";

// Two upcoming bake days, each with one order. Snapshots are added per test so
// the delete assertions start from a known list.
function freshState() {
  const a = addDays(todayISO(), 2);
  const b = addDays(todayISO(), 4);
  return {
    settings: { defaultCapacity: 12, currency: "RM", supabase: {} },
    uoms: [{ id: "u_g", name: "g", family: "weight", toBase: 1 }],
    suppliers: [],
    ingredients: [{ id: "ing_f", name: "Flour", unit: "g", uomId: "u_g", costPerUnit: 0.001 }],
    products: [{ id: "prd_x", name: "Loaf", unit: "loaf", active: true,
      recipe: [{ ingredientId: "ing_f", qty: 100, unit: "g" }] }],
    deliveryDates: [
      { id: "del_a", date: a, notes: "" },
      { id: "del_b", date: b, notes: "" },
    ],
    orders: [
      { id: "ord_a", deliveryDateId: "del_a", productId: "prd_x", qty: 1 },
      { id: "ord_b", deliveryDateId: "del_b", productId: "prd_x", qty: 1 },
    ],
    purchaseOrders: [],
  };
}

// Add a snapshot over the given day ids. `accurate` records the true per-day
// fingerprints so the day reads as "saved" to the PO picker; otherwise the date
// entries carry empty fingerprints (legacy-style, still fine for history).
function addPO(state, id, dayIds, { accurate = false } = {}) {
  const recs = dayIds.map((did) => state.deliveryDates.find((d) => d.id === did));
  const po = {
    id,
    deliveryDateId: recs[0].id,
    deliveryDate: recs[0].date,
    generatedAt: "2026-09-07T09:00:00.000Z",
    items: [],
    dates: recs.map((r) => ({ id: r.id, date: r.date,
      fp: accurate ? ordersFingerprint(state, r.date) : "" })),
    summary: { totalUnits: recs.length },
    orderIds: [],
    warnings: [],
  };
  state.purchaseOrders.unshift(po);
  return po;
}

function walk(n, out = []) {
  for (const c of n.children || []) {
    out.push(c);
    walk(c, out);
  }
  return out;
}

function textOf(n) {
  if (!n) return "";
  if (n.nodeType === 3) return n.text ?? "";
  if (n.textContent) return n.textContent;
  return (n.children || []).map(textOf).join("");
}

const fireClick = (node) => (node._listeners.click || []).forEach((f) => f());

function findBtn(root, label) {
  return walk(root).find((n) => n.nodeType === 1 && n.tagName === "BUTTON" && textOf(n).trim() === label);
}
function findFirst(root, clsPart) {
  return walk(root).find((n) => n.nodeType === 1 && String(n.className).includes(clsPart));
}

function mountHistory(state, params = "") {
  const root = doc.createElement("div");
  renderHistory(root, state, new URLSearchParams(params));
  return root;
}
function mountPO(state) {
  const root = doc.createElement("div");
  renderPO(root, state, new URLSearchParams(""));
  return root;
}
function poRows(root) {
  return walk(root).filter((n) => n.nodeType === 1 && String(n.className).includes("po-day-row"));
}

test("history list shows one card per saved snapshot with the multi-day tail", () => {
  const state = freshState();
  addPO(state, "p_multi", ["del_a", "del_b"]);
  addPO(state, "p_single", ["del_a"], { accurate: true });

  const root = mountHistory(state);
  const all = textOf(root);
  const [a] = state.deliveryDates;
  assert.ok(all.includes("Purchase orders (2)"), "header counts the snapshots");
  assert.ok(all.includes(`${weekdayName(a.date)}, ${longDate(a.date)}`), "headline names the first day");
  assert.ok(all.includes("more day"), "multi-day snapshot carries the '+1 more day' tail");
});

test("tapping a history card opens that snapshot's detail", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);

  const root = mountHistory(state);
  const card = findFirst(root, "tappable");
  fireClick(card);
  assert.equal(location.hash, `#/history?po=${po.id}`);
});

test("a multi-day detail shows the extra-day tail, Regenerate reopens both days, and Delete is present", () => {
  const state = freshState();
  addPO(state, "p1", ["del_a", "del_b"]);

  const root = mountHistory(state, "po=p1");
  assert.ok(textOf(root).includes("more day"), "detail headline spans both days");
  assert.ok(textOf(root).includes("Ingredients to buy"), "detail still builds its table");

  const regen = findBtn(root, "Regenerate");
  assert.ok(regen, "detail offers Regenerate");
  fireClick(regen);
  assert.equal(location.hash, "#/po?dates=del_a,del_b", "reopens the exact saved days");

  const detail = mountHistory(state, "po=p1");
  assert.ok(findBtn(detail, "Delete"), "detail offers Delete");
});

test("Delete asks first, and confirming Yes removes the snapshot and leaves history", () => {
  const state = freshState();
  addPO(state, "p1", ["del_a", "del_b"]);
  addPO(state, "p2", ["del_a"]);

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Delete"));
  const layer = registry["confirm-layer"];
  assert.ok(textOf(layer).includes("Delete this saved shopping list?"), "the confirm pop-up appears");

  fireClick(findBtn(layer, "Delete"));
  assert.equal(state.purchaseOrders.length, 1, "only the confirmed snapshot is removed");
  assert.equal(state.purchaseOrders[0].id, "p2", "the other snapshot is untouched");
  assert.equal(location.hash, "#/history", "returns to the list after deleting");
});

test("Delete -> Cancel leaves the snapshot in place", () => {
  const state = freshState();
  addPO(state, "p1", ["del_a"]);

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Delete"));
  fireClick(findBtn(registry["confirm-layer"], "Cancel"));
  assert.equal(state.purchaseOrders.length, 1, "cancel changes nothing");
});

test("deleting the only saved list for a day marks that day not-yet-shopped again on the PO tab", () => {
  const state = freshState();
  addPO(state, "p1", ["del_a"], { accurate: true });

  const before = mountPO(state);
  assert.equal(poRows(before)[0].children[0].checked, false, "covered day is saved, so not default-ticked");

  // Remove it the way the owner does: open history detail, confirm Delete.
  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Delete"));
  fireClick(findBtn(registry["confirm-layer"], "Delete"));

  const after = mountPO(state);
  assert.equal(poRows(after)[0].children[0].checked, true,
    "with no saved list left, the day rejoins the default tick list");
});

// --- "Bought" adds a saved snapshot's packs to stock -------------------------

// A snapshot item as priceItems would have written it for a supplier-priced
// ingredient with no on-hand: 3000 g of Flour to buy, so a Bought tap should
// put 3000 g (in base units) onto the shelf.
function boughtItem() {
  return {
    ingredientId: "ing_f", ingredientName: "Flour", unit: "g", totalQty: 3000,
    needText: "3000g", buyText: "3 × 1000g", supplier: "Mydin", supplierWhatsapp: "",
    packDisplay: "1000g", packs: 3, estCost: 0, costPerUnit: 0, lines: [],
    onHand: 0, openBase: 3000, addBase: 3000, covered: false,
  };
}

test("a saved snapshot that still has amounts to add shows the Bought button with a hint", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];

  const root = mountHistory(state, "po=p1");
  assert.ok(findBtn(root, "Bought ✓ — add to stock"), "Bought shows while the packs are still un-bought");
  assert.ok(textOf(root).includes("to add these to your stock"), "hint says when to tap it");
});

test("tapping Bought adds the packs to stock once and replaces the button with a note", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));

  assert.equal(state.ingredients[0].onHand, 3000, "the whole pack amount lands on the shelf");
  assert.equal(po.bought, true, "marked so a second tap can't double-add");
  assert.ok(po.boughtAt, "records when she tapped");
  assert.ok(!findBtn(root, "Bought ✓ — add to stock"), "button is gone after one tap");
  assert.ok(textOf(root).includes("added to your stock"), "the note confirms the stock move");
  assert.ok(findBtn(root, "Regenerate"), "the other actions stay available");
});

// --- v285: the list is amendable at the shop --------------------------------

// Every line the amend card edits carries these; boughtItem() above predates them.
function pricedItem(over = {}) {
  return {
    ...boughtItem(),
    supplierId: "s_mydin", packPrice: 25.5, packQty: 1000, packUomId: "u_g",
    packUomName: "g", cookBase: 1, ...over,
  };
}

function amendInputs(layer) {
  return walk(layer).filter((n) => n.nodeType === 1 && String(n.className).includes("amend-num"));
}

function typeInto(node, value) {
  node.value = String(value);
  for (const f of node._listeners.input || []) f();
}

function openAmend(state, po) {
  const root = mountHistory(state, `po=${po.id}`);
  fireClick(findBtn(root, "Amend"));
  return { root, layer: registry["popup-layer"] };
}

test("the What-did-you-pay box is pre-filled from the list's own summary total", () => {
  // This had NEVER worked. A snapshot carries its estimate as `summary.buyTotal`, and the box
  // read a top-level `po.buyTotal` no snapshot has ever had — so on every real shopping list
  // it opened blank and its sentence dropped the "the list came to RM…" half. The earlier
  // tests missed it because they set `po.buyTotal` by hand instead of saving a list.
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.summary = { totalUnits: 1, totalEstCost: 76.5, buyTotal: 76.5 };

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));

  const layer = registry["popup-layer"];
  const amount = walk(layer).find((n) => n.nodeType === 1 && String(n.className).includes("input"));
  assert.ok(amount, "the amount box is on screen");
  assert.equal(amount.value, "76.5", "pre-filled from summary.buyTotal, not left blank");
  assert.ok(textOf(layer).includes("the list came to"), "and the sentence names the total");
});

test("Amend is offered while the list is un-bought, and gone once it is bought", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];

  const root = mountHistory(state, "po=p1");
  assert.ok(findBtn(root, "Amend"), "she can correct the list at the shop");

  fireClick(findBtn(root, "Bought ✓ — add to stock"));
  assert.ok(!findBtn(root, "Amend"),
    "once the packs are on the shelf the list records what happened, it is not edited");
});

test("amending rewrites the line and the list total, and leaves the day fingerprints alone", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"], { accurate: true });
  po.items = [pricedItem()];
  po.summary = { totalUnits: 1, totalEstCost: 76.5, buyTotal: 76.5 };
  const datesBefore = JSON.stringify(po.dates);
  const stampedAt = po.generatedAt;

  const { layer } = openAmend(state, po);
  const boxes = amendInputs(layer);
  assert.equal(boxes.length, 2, "the packs box and the price box, one line");
  assert.equal(boxes[0].value, "3", "the packs it was generated with");
  assert.equal(boxes[1].value, "25.5", "and the price it was generated at");

  typeInto(boxes[1], 30);
  fireClick(findBtn(layer, "Save the corrected list"));

  assert.equal(po.items[0].packPrice, 30, "the corrected price is on the saved line");
  assert.equal(po.items[0].estCost, 90, "3 packs × RM 30");
  assert.equal(po.summary.buyTotal, 90, "and both summary totals follow it");
  assert.equal(po.summary.totalEstCost, 90);
  assert.equal(JSON.stringify(po.dates), datesBefore,
    "dates[].fp is UNTOUCHED — the 'orders changed' rounds are matched against it");
  assert.equal(po.generatedAt, stampedAt,
    "and generatedAt is kept, because coveringPO sorts snapshots on it");
  assert.ok(po.amendedAt, "while the correction is stamped so the card can say it happened");
  assert.equal(typeof po.items[0]._pricedAt, "undefined", "the working field is never saved");
});

test("a price corrected at the shop is written onto the ingredient and journaled", () => {
  const state = freshState();
  state.suppliers = [{ id: "s_mydin", name: "Mydin", active: true }];
  state.ingredients[0].supplierPrices = [{ supplierId: "s_mydin", qty: 1000, uomId: "u_g", price: 25.5 }];
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];
  po.summary = { totalUnits: 1, totalEstCost: 76.5, buyTotal: 76.5 };

  const { layer } = openAmend(state, po);
  typeInto(amendInputs(layer)[1], 30);
  fireClick(findBtn(layer, "Save the corrected list"));

  assert.equal(state.ingredients[0].supplierPrices[0].price, 30,
    "the ingredient now costs what she actually paid");
  assert.equal(state.ingredients[0].priceLog.length, 1, "and the move is on its journal");
  assert.equal(state.ingredients[0].priceLog[0].was, 25.5);
  assert.equal(state.ingredients[0].priceLog[0].price, 30);
  assert.equal(state.ingredients[0].priceLog[0].poId, po.id, "naming the trip that moved it");
});

test("a line she did NOT reprice leaves the ingredient alone", () => {
  // The one that would quietly undo her: a price she has since corrected by hand must not be
  // stamped back to a stale value just because she opened the card and pressed Save.
  const state = freshState();
  state.suppliers = [{ id: "s_mydin", name: "Mydin", active: true }];
  state.ingredients[0].supplierPrices = [{ supplierId: "s_mydin", qty: 1000, uomId: "u_g", price: 33 }];
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];
  po.summary = { totalUnits: 1, totalEstCost: 76.5, buyTotal: 76.5 };

  const { layer } = openAmend(state, po);
  typeInto(amendInputs(layer)[0], 4);            // ONLY the packs move
  fireClick(findBtn(layer, "Save the corrected list"));

  assert.equal(po.items[0].packs, 4, "the count she changed is saved");
  assert.equal(po.items[0].estCost, 102, "4 × the price the list was built at");
  assert.equal(state.ingredients[0].supplierPrices[0].price, 33,
    "and the ingredient keeps the price she corrected by hand");
  assert.equal((state.ingredients[0].priceLog || []).length, 0, "no movement to record");
});

test("the amend card will not offer an ingredient that is already on the list", () => {
  // applyBought sums by ingredient id, so a second line would not double the STOCK — but it
  // would show her the same shopping twice and price it twice, and a list that reads as two of
  // something is a list she cannot trust.
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];

  const { layer } = openAmend(state, po);
  assert.ok(textOf(layer).includes("Everything you can buy is already on this list."),
    "the only ingredient is already on it, so there is nothing to add");
});

test("a line the shelf already covers is shown, not dropped, and can still be bought", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem({ covered: true, packs: 0, addBase: 0, buyText: null })];
  po.summary = { totalUnits: 1, totalEstCost: 0, buyTotal: 0 };

  const { layer } = openAmend(state, po);
  assert.ok(textOf(layer).includes("already on your shelf"),
    "the line is still drawn, so nothing looks forgotten");
  assert.equal(amendInputs(layer).length, 0, "it has no pack to edit, so it offers none");
  const buy = findBtn(layer, "＋ buy some");
  assert.ok(buy, "and it is not a dead end");

  fireClick(buy);
  const boxes = amendInputs(registry["popup-layer"]);
  assert.equal(boxes.length, 2, "it becomes an ordinary line, priced from the supplier");
});

test("dropping a line takes it off the saved list", () => {
  const state = freshState();
  state.ingredients.push({ id: "ing_s", name: "Salt", unit: "g", uomId: "u_g", costPerUnit: 0.002 });
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem(), pricedItem({ ingredientId: "ing_s", ingredientName: "Salt" })];
  po.summary = { totalUnits: 1, totalEstCost: 153, buyTotal: 153 };

  const { layer } = openAmend(state, po);
  const removes = walk(layer)
    .filter((n) => n.nodeType === 1 && n.tagName === "BUTTON" && textOf(n).trim() === "Remove");
  assert.equal(removes.length, 2, "one per line, and none of them the card's own ✕");
  fireClick(removes[1]);                                  // take the Salt line off
  fireClick(findBtn(registry["popup-layer"], "Save the corrected list"));

  assert.equal(po.items.length, 1, "only the line she kept is on the saved list");
  assert.equal(po.items[0].ingredientId, "ing_f", "and it is the one she did not remove");
});

test("a legacy snapshot saved before stock carries no buy amounts, so no Bought button", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [{
    ingredientId: "ing_f", ingredientName: "Flour", unit: "g", totalQty: 3000,
    needText: "3000g", buyText: "3 × 1000g", supplier: "Mydin", estCost: 0,
  }];

  const root = mountHistory(state, "po=p1");
  assert.equal(findBtn(root, "Bought ✓ — add to stock"), undefined,
    "no addBase anywhere means there is nothing to add, exactly as before the feature");
});

// --- v103: the Bought tap now asks what she paid, and records it ---------------
test("Bought asks what she paid, pre-filled with the list's own total", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));

  const pop = registry["popup-layer"];
  const box = walk(pop).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "What you paid");
  assert.ok(box, "the money question opens over the page");
  assert.equal(String(box.value), "52.5", "pre-filled with what the list came to");
  assert.equal((state.expenses || []).length, 0, "and nothing is recorded until she says so");
});

test("saving records money out, with the day and how she paid", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));
  const pop = registry["popup-layer"];
  const box = walk(pop).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "What you paid");
  box.value = "48.90"; // what she really paid
  fireClick(walk(pop).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "TNG"));
  fireClick(walk(pop).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Save"));

  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].amount, 48.9);
  assert.equal(state.expenses[0].method, "TNG", "stored as the label she picked — the same string old rows read back as");
  assert.equal(state.expenses[0].poId, "p1", "linked to the shopping run it came from");
  assert.equal(state.expenses[0].category, "Ingredients & shopping");
  assert.match(state.expenses[0].date, /^\d{4}-\d{2}-\d{2}$/, "stamped with the day she paid it");
});

test("Skip the money adds the stock and records nothing, as the app always did", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));
  const pop = registry["popup-layer"];
  fireClick(walk(pop).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Skip the money"));

  assert.equal(state.ingredients[0].onHand, 3000, "the packs are still on the shelf");
  assert.equal((state.expenses || []).length, 0, "and no money was written down");
});

test("what she paid with comes from her own list, loan included (v106)", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Bought ✓ — add to stock"));
  const pop = registry["popup-layer"];
  const pills = walk(pop).filter((n) => n.tagName === "BUTTON").map((b) => textOf(b).trim());
  assert.ok(pills.includes("Cash") && pills.includes("TNG"), "the two a customer uses");
  assert.ok(pills.includes("Loan"),
    "and the third she asked for — a flour run can go on the loan or the overdraft");

  const box = walk(pop).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "What you paid");
  box.value = "250";
  fireClick(walk(pop).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Loan"));
  fireClick(walk(pop).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Save"));
  assert.equal(state.expenses[0].method, "Loan", "recorded as she chose");
});
