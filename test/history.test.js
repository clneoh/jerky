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
// ── ★★ undoing ONE SHOP's Bought (v393) ──────────────────────────────────────
//
// Her words: __"that delete is for deleting the whole po, what if i only want to delete one bought
// only"__ — and, on what to call it, __"call it undo is more appropriate than delete"__.

test("★★ a bought shop carries an Undo, and it puts BOTH halves back", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.bought = true;
  po.boughtAt = "2026-10-09T03:42:00.000Z";
  po.boughtShops = { Mydin: { at: "2026-10-09T03:42:00.000Z" } };
  state.ingredients[0].onHand = 3000; // the packs the Bought press added
  state.expenses = [{ id: "e1", date: "2026-10-09", amount: 48.9,
    category: "Ingredients & shopping", method: "TNG", poId: "p1", note: "Mydin" }];

  const root = mountHistory(state, "po=p1");
  assert.ok(shopBtn(root, "Mydin", "Undo"),
    "⚠️ a shop she has bought offers her no way back — the gap she reported");

  fireClick(shopBtn(root, "Mydin", "Undo"));
  const layer = registry["confirm-layer"];
  assert.ok(textOf(layer).includes("48.90"),
    "⚠️ the confirm does not name the money it is about to take off her books");
  assert.ok(textOf(layer).includes("Flour"),
    "⚠️ the confirm does not say what is about to happen to her stock");

  fireClick(findBtn(layer, "Undo"));
  assert.equal(state.ingredients[0].onHand, 0, "the packs did not come back off the shelf");
  assert.equal(state.expenses.length, 0, "⚠️ the money stayed on her books after an undo");
  assert.equal(po.boughtShops.Mydin, undefined, "the shop is still marked bought");
  assert.equal(po.bought, false, "the list still reads as finished");
  assert.ok(shopBtn(root, "Mydin", "Bought ✓"), "the shop cannot be bought again");
  // ⚠️ AND THE REVERSAL IS ON THE CARD, so the journal still explains the figure it sits under.
  assert.match((state.ingredients[0].stockLog || []).map((e) => e.what).join(" "), /Un-bought — Mydin/,
    "the stock card was not told what moved");
});

test("⚠️ undoing ONE shop leaves the OTHER shops bought and their stock alone", () => {
  const state = freshState();
  const po = twoShopPO(state);
  po.boughtShops = { Mydin: { at: "2026-10-09T03:42:00.000Z" },
    "Yen Grocer": { at: "2026-10-09T03:43:00.000Z" } };
  state.ingredients[0].onHand = 3000;
  state.ingredients.find((i) => i.id === "ing_s").onHand = 2000;
  state.expenses = [
    { id: "e1", date: "2026-10-09", amount: 48.9, category: "Ingredients & shopping",
      method: "TNG", poId: "p1", note: "Mydin" },
    { id: "e2", date: "2026-10-09", amount: 12.5, category: "Ingredients & shopping",
      method: "TNG", poId: "p1", note: "Yen Grocer" },
  ];

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Undo"));
  fireClick(findBtn(registry["confirm-layer"], "Undo"));

  const sugar = state.ingredients.find((i) => i.id === "ing_s");
  assert.equal(state.ingredients[0].onHand, 0, "Mydin's packs did not come back off");
  assert.equal(sugar.onHand, 2000, "⚠️⚠️ undoing Mydin took YEN GROCER's stock with it");
  assert.deepEqual(state.expenses.map((e) => e.note), ["Yen Grocer"],
    "⚠️ the wrong shop's money came off her books");
  assert.ok(po.boughtShops["Yen Grocer"], "the other shop was un-bought as well");
  assert.equal(po.bought, false, "the list is finished again");
});

test("⚠️ an OLD already-bought list offers no Undo — nothing can be put back with confidence", () => {
  // ⚠️ A list bought before v389 carries the whole thing as one flag and may have no money row at all.
  // This app does not invent a reversal it cannot account for.
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.bought = true; // the pre-v389 shape: one flag, no boughtShops
  po.boughtAt = "2026-10-03T02:00:00.000Z";

  const root = mountHistory(state, "po=p1");
  assert.equal(shopBtn(root, "Mydin", "Undo"), undefined,
    "⚠️ an undo was offered over a record the app cannot fully account for");
});

test("⚠️ a shop marked Not buying offers no Undo — it moved nothing, and she chose it as final", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.boughtShops = { Mydin: { at: "2026-10-09T03:42:00.000Z", skipped: true } };

  const root = mountHistory(state, "po=p1");
  assert.equal(shopBtn(root, "Mydin", "Undo"), undefined,
    "an undo was offered on a shop that never moved anything");
  assert.ok(textOf(root).includes("Not buying"), "and it still says what she decided");
});

// ── ★★ deleting a list does NOT take the money with it (v391) ────────────────
//
// Her words: __"when we delete a po, money paid dont reverse out?"__ — a fair question, and the honest
// answer was that **nothing said so**. Deleting a saved list has never touched the money recorded
// through it, and has never touched the packs either; what was wrong was only that the box stayed
// silent, so the money appeared to vanish along with the list.

test("★★⚠️ deleting a bought list SAYS the money stays — and does not quietly take it", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  // ⚠️ TWO ROWS, because since v389 a run over two shops writes one each — so this is the SUM.
  state.expenses = [
    { id: "exp1", date: "2026-10-09", amount: 48.9, category: "Ingredients & shopping",
      method: "TNG", poId: "p1", note: "Mydin" },
    { id: "exp2", date: "2026-10-09", amount: 12.5, category: "Ingredients & shopping",
      method: "TNG", poId: "p1", note: "Yen Grocer" },
    { id: "exp9", date: "2026-10-09", amount: 99, category: "Delivery & fuel", method: "Cash",
      poId: "some_other_po", note: "" },
  ];

  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Delete"));

  const layer = registry["confirm-layer"];
  assert.ok(textOf(layer).includes("RM 61.40"),
    "⚠️ the box does not name the money this list wrote — both shops, summed");
  assert.ok(textOf(layer).includes("stays on your books"),
    "⚠️ it does not say the money stays, which is how the money looked like it vanished with the list");

  fireClick(findBtn(layer, "Delete"));
  assert.equal(state.purchaseOrders.length, 0, "the list should be gone");
  assert.equal(state.expenses.length, 3,
    "⚠️⚠️ deleting the list removed money from her books — tidying a document rewrote her accounts");
  const left = state.expenses.filter((e) => e.poId === "p1")
    .reduce((n, e) => n + e.amount, 0);
  assert.equal(left, 61.4, "⚠️ the two rows it wrote should still add up to what she paid");
});

test("⚠️ an ordinary list nobody bought from says nothing about money", () => {
  // ⚠️ A warning about RM 0.00 on every delete is noise she learns to skip — and a warning she skips is
  // a warning that is not there. The sentence is added only when there is money behind it.
  const state = freshState();
  addPO(state, "p1", ["del_a"]);
  const root = mountHistory(state, "po=p1");
  fireClick(findBtn(root, "Delete"));
  assert.ok(!textOf(registry["confirm-layer"]).includes("stays on your books"),
    "an ordinary delete was given a money warning for a list with no money on it");
});

function boughtItem() {
  return {
    ingredientId: "ing_f", ingredientName: "Flour", unit: "g", totalQty: 3000,
    needText: "3000g", buyText: "3 × 1000g", supplier: "Mydin", supplierWhatsapp: "",
    packDisplay: "1000g", packs: 3, estCost: 0, costPerUnit: 0, lines: [],
    onHand: 0, openBase: 3000, addBase: 3000, covered: false,
  };
}

// ── ★★ v389: buying a saved list ONE SHOP AT A TIME ──────────────────────────
//
// Her words: __"the po when bought pressed, it push all ingredient into stock immediately, before i
// enter how much to pay and by what method, it should not like that, it is a lump sum total, it should
// allow individual supplier bought and after pay only push into stock"__.
//
// ⚠️⚠️ THE FAULT WAS AN ORDERING, AND THE FINISHED SCREEN LOOKS THE SAME EITHER WAY. A test written
// against the list after the press would have passed straight over it — what differed was that **the
// shelf moved while the pay box was still open**, so a box she closed left stock in and no money
// written down. Every assertion that matters below is therefore made AT THAT MOMENT.

const shopHead = (root, name) => walk(root).find((n) =>
  n.nodeType === 1 && String(n.className).includes("po-suprow") && textOf(n).includes(name));
const shopBtn = (root, name, label) => {
  const h = shopHead(root, name);
  return h ? walk(h).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === label) : undefined;
};
const popBtn = (label) => walk(registry["popup-layer"])
  .find((n) => n.tagName === "BUTTON" && textOf(n).trim() === label);
// ⚠️ "Not buying" is the ONE press on this screen that asks first — it takes effect on the tap and
// cannot be taken back, so a stray finger must not settle a shop (the same guard Delete keeps).
const confirmYes = (label) => fireClick(findBtn(registry["confirm-layer"], label));

// Two shops on one saved list — the case the old single press got wrong.
function twoShopPO(state) {
  state.ingredients.push({ id: "ing_s", name: "Sugar", unit: "g", uomId: "u_g", costPerUnit: 0.001 });
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [
    boughtItem(),
    { ...boughtItem(), ingredientId: "ing_s", ingredientName: "Sugar",
      supplier: "Yen Grocer", supplierId: "s_yen", addBase: 2000, estCost: 12 },
  ];
  return po;
}

test("★ every shop on a saved list carries its OWN Bought press", () => {
  const state = freshState();
  twoShopPO(state);
  const root = mountHistory(state, "po=p1");

  assert.ok(shopBtn(root, "Mydin", "Bought ✓"), "the first shop can be bought on its own");
  assert.ok(shopBtn(root, "Yen Grocer", "Bought ✓"), "and so can the second");
  assert.ok(!findBtn(root, "Bought ✓ — add to stock"),
    "the one press that claimed the whole run is gone");
  assert.ok(textOf(root).includes("Nothing goes into your stock until you do"),
    "and the card says when the shelf moves");
});

// ⚠️⚠️ AND A LIST WITH NO SUPPLIER PRICES IS STILL SOMETHING TO BUY (v389). Every line in it groups
// under ONE muted "No supplier price (estimate)" heading — and a single such group used to draw **no
// header row at all**, so there would have been nowhere to put the press. That list is the whole of
// one shop, and its packs still have to be able to go into stock.
test("⚠️ a list of loose estimates is still one shop that can be bought", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [{ ingredientId: "ing_f", ingredientName: "Flour", unit: "g", totalQty: 3000,
    needText: "3000g", estCost: 9, addBase: 3000 }];

  const root = mountHistory(state, "po=p1");
  assert.ok(findBtn(root, "Bought ✓"),
    "⚠️ no supplier name — but still a shop's worth of packs to put away");

  fireClick(findBtn(root, "Bought ✓"));
  fireClick(popBtn("Skip the money"));
  assert.equal(state.ingredients[0].onHand, 3000, "and buying it still puts them on the shelf");
});

test("★★ pressing Bought adds NOTHING — the shelf waits for her answer", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));

  assert.ok(registry["popup-layer"], "the money question opens");
  assert.equal(state.ingredients[0].onHand || 0, 0,
    "⚠️⚠️ nothing on the shelf yet — the packs go in when she answers, and this IS the fault");
  assert.equal((state.expenses || []).length, 0, "and nothing is written down");
  assert.equal(po.bought, undefined, "and the shop is not marked done");
});

test("★★ closing the pay box without answering leaves the shelf exactly as it was", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  fireClick(popBtn("✕")); // the close a card she walks away from uses

  assert.equal(state.ingredients[0].onHand || 0, 0, "a box she closed changed nothing");
  assert.equal((state.expenses || []).length, 0, "no money either");
  assert.ok(shopBtn(root, "Mydin", "Bought ✓"), "and the shop is still there to buy");
});

test("★ Save puts THAT shop's packs on the shelf and records what she paid", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  const box = walk(registry["popup-layer"])
    .find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "What you paid");
  box.value = "48.90";
  fireClick(popBtn("TNG"));
  fireClick(popBtn("Save"));

  assert.equal(state.ingredients[0].onHand, 3000, "the pack amount lands on the shelf");
  assert.equal(po.bought, true, "the only shop is done, so the list is done");
  assert.ok(po.boughtAt, "and it records when");
  assert.ok(po.boughtShops.Mydin, "the shop itself is marked bought");
  assert.equal(state.expenses.length, 1, "exactly one money row");
  assert.equal(state.expenses[0].amount, 48.9);
  assert.equal(state.expenses[0].method, "TNG");
  assert.equal(state.expenses[0].poId, "p1");
  assert.equal(state.expenses[0].note, "Mydin",
    "⚠️ the shop goes in the note, so a run's rows can be told apart in her books");
  assert.ok(!shopBtn(root, "Mydin", "Bought ✓"), "the press becomes a state, not a button");
  assert.ok(textOf(root).includes("Bought ✓"), "the heading says which shop is done");
  assert.ok(findBtn(root, "Regenerate"), "the other actions stay available");
});

test("★ Skip the money still adds the stock and records nothing — her choice, not a default", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  fireClick(popBtn("Skip the money"));

  assert.equal(state.ingredients[0].onHand, 3000, "the packs are still on the shelf");
  assert.equal((state.expenses || []).length, 0, "and no money was written down");
});

test("★★ buying one shop leaves the other shops and their stock alone", () => {
  const state = freshState();
  const po = twoShopPO(state);
  const root = mountHistory(state, "po=p1");

  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  fireClick(popBtn("Skip the money"));

  const sugar = state.ingredients.find((i) => i.id === "ing_s");
  assert.equal(state.ingredients[0].onHand, 3000, "Mydin's flour is on the shelf");
  assert.equal(sugar.onHand || 0, 0,
    "⚠️⚠️ and Yen Grocer's sugar is NOT — one press bought one shop, not the run");
  assert.ok(shopBtn(root, "Yen Grocer", "Bought ✓"), "the second shop is still offered");
  assert.equal(po.bought, false, "and the list is not finished");
  assert.ok(textOf(root).includes("still to buy: Yen Grocer"), "the card says what is left");
});

test("★ Not buying closes a shop with no stock and no money, and lets the list finish", () => {
  const state = freshState();
  const po = twoShopPO(state);
  const root = mountHistory(state, "po=p1");

  fireClick(shopBtn(root, "Yen Grocer", "Not buying"));

  // ⚠️ IT ASKS FIRST, and nothing has happened yet.
  assert.ok(textOf(registry["confirm-layer"]).includes("Mark Yen Grocer as not buying?"),
    "a soft tap must not settle a shop for good");
  assert.equal(po.boughtShops, undefined, "and asking changed nothing");
  confirmYes("Not buying");

  const sugar = state.ingredients.find((i) => i.id === "ing_s");
  assert.equal(sugar.onHand || 0, 0, "nothing came into stock from a shop she did not buy from");
  assert.equal((state.expenses || []).length, 0, "and no money was recorded");
  assert.equal(po.boughtShops["Yen Grocer"].skipped, true, "recorded as a decision, not a gap");
  assert.ok(!shopBtn(root, "Yen Grocer", "Bought ✓"), "the shop is closed");

  // …and once the other shop is bought the LIST can finish, rather than waiting for ever on a shop
  // she has decided against.
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  fireClick(popBtn("Skip the money"));
  assert.equal(po.bought, true, "a skipped shop still lets the run be finished");
  assert.ok(textOf(root).includes("1 not buying"),
    "and the card says so rather than claiming everything was added");
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
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));

  const layer = registry["popup-layer"];
  const amount = walk(layer).find((n) => n.nodeType === 1 && String(n.className).includes("input"));
  assert.ok(amount, "the amount box is on screen");
  assert.equal(amount.value, "76.5", "pre-filled from summary.buyTotal, not left blank");
  assert.ok(textOf(layer).includes("the list came to"), "and the sentence names the total");
});

// ⚠️ AND THE PRE-FILL MUST NOT HAND A SINGLE SHOP THE WHOLE RUN'S COST (v389). On a multi-shop list
// the run's estimate is every shop put together, so offering it at one shop's box would pre-fill
// Mydin with what Mydin AND Yen Grocer came to. The run estimate answers only when there is one shop.
test("⚠️ a shop's box is pre-filled with THAT shop's subtotal, never the whole run's", () => {
  const state = freshState();
  const po = twoShopPO(state);
  po.summary = { totalUnits: 2, totalEstCost: 88.5, buyTotal: 88.5 };

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Yen Grocer", "Bought ✓"));
  const box = walk(registry["popup-layer"])
    .find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "What you paid");
  assert.equal(String(box.value), "12",
    "⚠️ Yen Grocer's own RM12, not the RM88.50 the whole run came to");
});

test("Amend is offered while nothing has landed, and gone once something has", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];

  const root = mountHistory(state, "po=p1");
  assert.ok(findBtn(root, "Amend"), "she can correct the list at the shop");

  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
  assert.ok(findBtn(root, "Amend"), "⚠️ a pay box she has not answered has changed nothing");

  fireClick(popBtn("Skip the money"));
  assert.ok(!findBtn(root, "Amend"),
    "once the packs are on the shelf the list records what happened, it is not edited");
});

// ⚠️ AND "NOT BUYING" LOCKS IT TOO — the list must not be rewritten under a shop she has already
// decided about, even though no stock moved for it.
test("⚠️ marking a shop not buying locks Amend as well", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [pricedItem()];

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Not buying"));
  confirmYes("Not buying");

  assert.ok(!findBtn(root, "Amend"), "a settled shop means the list is what happened");
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
  assert.equal(shopBtn(root, "Mydin", "Bought ✓"), undefined,
    "no addBase anywhere means there is nothing to add, exactly as before the feature");
});

// ⚠️⚠️ AN OLD SNAPSHOT ALREADY MARKED BOUGHT MUST NOT OFFER TO BUY IT AGAIN (v389). Before this
// version the whole list was ONE boolean, so an old `po.bought` means every shop on it was bought —
// reading it as un-bought would put the same packs on her shelf a second time.
test("⚠️ an old snapshot already marked Bought offers no press at all", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.bought = true;                      // the pre-v389 shape: one flag for the whole list
  po.boughtAt = "2026-10-03T02:00:00.000Z";

  const root = mountHistory(state, "po=p1");
  assert.equal(shopBtn(root, "Mydin", "Bought ✓"), undefined,
    "⚠️ there is nothing left to buy on it");
  assert.equal(shopBtn(root, "Mydin", "Not buying"), undefined, "and nothing to skip");
  assert.ok(textOf(root).includes("these packs are on your stock"),
    "and it still says plainly what happened to it");
});

// --- v103: the Bought tap now asks what she paid, and records it ---------------
test("Bought asks what she paid, pre-filled with the list's own total", () => {
  const state = freshState();
  const po = addPO(state, "p1", ["del_a"]);
  po.items = [boughtItem()];
  po.buyTotal = 52.5;

  const root = mountHistory(state, "po=p1");
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));

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
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
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
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
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
  fireClick(shopBtn(root, "Mydin", "Bought ✓"));
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
