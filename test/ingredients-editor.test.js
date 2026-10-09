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

import { renderIngredients, stockCardSheet } from "../admin/js/views/ingredients.js";
import { stockLogOf } from "../admin/js/stock.js";

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

  // ★★ AND THE SAME PRESS WRITES THE STOCK JOURNAL (v385). Her words: __"why only show when there is
  // price movement, qty movement cannot?"__ — a stocktake is a quantity movement like any other, so it
  // is recorded through the SAME control this test already drives. ⚠️ Asserted on the ROW, not merely
  // that a log grew: its reason, its signed amount, and the words naming both figures.
  const log = stockLogOf(ing);
  assert.equal(log.length, 1, "the stocktake wrote no stock row");
  assert.equal(log[0].why, "stocktake");
  assert.equal(log[0].delta, 1500, "the row does not carry what actually changed");
  assert.match(log[0].what, /1\.5 kg/,
    "the row does not say what the amount was set to — a bare number would not explain the figure");
});

// --- "Not something I buy" (v110) -------------------------------------------
// "certain ingredient we dont purchase, in ingredient we can set that as a non purchase
// item, like labour and electricity" (16 Sep 2026). The flag is written ONLY when on and
// DELETED when off, so an unticked switch leaves the ingredient exactly as it was.

const change = (node) => (node._listeners.change || []).forEach((f) => f({ target: node }));
function switchBox(state, root) {
  return walk(root.children[0]).find((n) => n.tagName === "INPUT" && n.attrs.type === "checkbox");
}

test("ticking Not something I buy saves the flag, and the card wears it instead of stock", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);

  const box = switchBox(state, root);
  assert.ok(box, "the new-ingredient form offers the switch");
  assert.equal(box.checked, false, "and it starts off — every existing ingredient is still bought");

  f.name.value = "Labour";
  box.checked = true;
  change(box);
  fire(f.add);

  assert.equal(state.ingredients[0].notPurchased, true, "saved as a cost that is never bought");
  const card = walk(root).find((n) => String(n.className).includes("card")
    && textOf(n).includes("Labour") && textOf(n).includes("Not bought"));
  assert.ok(card, "the card says so");
  assert.ok(textOf(card).includes("never on a shopping list"));
  assert.ok(!textOf(card).includes("On hand"), "and shows no shelf it will never have");
});

test("an ingredient saved without the switch carries no key at all", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Sea salt";
  fire(f.add);
  assert.equal(state.ingredients[0].notPurchased, undefined,
    "absent — nothing that exists changes until she ticks it");
});

test("unticking the switch on an edit takes the flag back off the ingredient", () => {
  const state = freshState();
  state.ingredients.push({ id: "ing_labour", name: "Labour", unit: "hr", costPerUnit: 8, notPurchased: true });
  const root = render(state);

  const card = walk(root).find((n) => String(n.className).includes("card") && textOf(n).includes("Labour"));
  fire(walk(card).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Edit"));
  const layer = registry["popup-layer"];
  const box = walk(layer).find((n) => n.tagName === "INPUT" && n.attrs.type === "checkbox");
  assert.equal(box.checked, true, "opened on the fact that it is not bought");
  box.checked = false;
  change(box);
  fire(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Update ingredient"));

  assert.equal(state.ingredients[0].notPurchased, undefined, "the key goes, rather than being saved as false");
});

// ── v285: the ingredient's own price journal ────────────────────────────────
// *"ingredient price journaled … So an ingredient need a journals."*

function journalledIng(over = {}) {
  return {
    id: "ing_f", name: "Strong flour", unit: "g", uomId: "u_g", costPerUnit: 0.001,
    supplierPrices: [{ supplierId: "s_mydin", qty: 3000, uomId: "u_g", price: 27.5 }],
    priceLog: [
      { at: "2026-10-03", supplierId: "s_mydin", supplierName: "Mydin", qty: 3000,
        uomId: "u_g", uomName: "g", price: 27.5, was: 25.5, poId: "po_1", source: "po" },
      { at: "2026-09-12", supplierId: "s_mydin", supplierName: "Mydin", qty: 3000,
        uomId: "u_g", uomName: "g", price: 25.5, was: 24, poId: "po_0", source: "po" },
    ],
    ...over,
  };
}

test("★★ it is called STOCK CARD and it is on EVERY ingredient", () => {
  // ⚠️⚠️ THIS TEST SAID THE OPPOSITE UNTIL v386, AND IT WAS RIGHT AT THE TIME: the press was hidden
  // until something had moved, because an empty page would read as a fault. **Her words ended that —
  // __"i want stock card"__, after two rounds of __"cannot find it"__.** The record she wanted existed;
  // it was called "Journal" and hidden behind a condition. **A card she cannot find is a card that does
  // not exist.** ⚠️ The behaviour changed on purpose, so the assertion changed with it rather than
  // being deleted — and it now pins the opposite, which is the whole point of v386.
  const state = freshState();
  state.ingredients.push({ id: "ing_f", name: "Strong flour", unit: "g", uomId: "u_g", costPerUnit: 0.001 });
  const cardOf = (root) => walk(root).find((n) =>
    String(n.className).includes("card") && textOf(n).includes("Strong flour"));
  const cardPress = (root) => walk(cardOf(root))
    .find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Stock card");

  assert.ok(cardPress(render(state)),
    "⚠️ an ingredient with no history of any kind still offers no Stock card — the hunt she was sent on");

  state.ingredients[0].priceLog = journalledIng().priceLog;
  assert.ok(cardPress(render(state)), "and it is still there once something has happened");

  // ⚠️ AND THE OLD WORD IS GONE. "Journal" is not a word in her kitchen, and leaving both would be two
  // names for one card.
  assert.equal(walk(cardOf(render(state))).some((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Journal"),
    false, "⚠️ an old Journal press was left beside the Stock card");
});

test("the PRICE section lists the moves oldest first, with the price now at the top", () => {
  // ⚠️ EXTENDED AT v385, not replaced. The sheet used to hold the price journal alone; it now holds a
  // PRICE section and a STOCK one — her words: __"why only show when there is price movement, qty
  // movement cannot?"__ So the same assertions are made one line further in, past the heading, and
  // what they were protecting — oldest first, each row carrying the price it moved TO and what it was
  // before — is unchanged.
  const state = freshState();
  state.suppliers = [{ id: "s_mydin", name: "Mydin", active: true }];
  const sheet = stockCardSheet(state, journalledIng());

  assert.equal(sheet.lines[0].heading, true, "the price rows need a heading now that a second section exists");
  assert.equal(sheet.lines[0].what, "Price");
  const priceRows = sheet.lines.filter((l) => !l.heading);
  assert.equal(priceRows.length, 2, "one row per move, and nothing else — no purchases, and no stock");
  assert.ok(priceRows[0].what.startsWith("12 Sep 2026"),
    "oldest first, so the page reads as a history rather than a feed");
  assert.equal(priceRows[0].amount, 25.5, "each row carries the price it moved TO");
  assert.equal(priceRows[1].amount, 27.5);
  assert.ok(priceRows[0].what.includes("was RM 24.00"),
    "and says what it was before, which is the whole point of a price journal");
  assert.match(sheet.subtitle, /Price now: RM 27\.50 per 3000g pack · Mydin/,
    "the price she is actually on, at the top — the half a movement list alone would lose");
  assert.equal(sheet.totals.length, 0, "a price history has no total to add up");
});

test("an ingredient that has never moved and never stocked draws the empty line, not a blank page", () => {
  // ⚠️ The empty line now covers BOTH logs, so an ingredient with neither is still told plainly what
  // is missing rather than shown a page with nothing on it.
  const state = freshState();
  const sheet = stockCardSheet(state, journalledIng({ priceLog: [], stockLog: [] }));
  assert.equal(sheet.lines.length, 0, "no rows AND no headings — a heading over nothing is a fault");
  // ⚠️ IT NAMES THE CARD AND SAYS WHAT WILL FILL IT — that line is what replaces the hiding rule
  // (v386). An empty card that says nothing reads as a fault; one that says what it is for reads as a
  // card waiting, which is what it is.
  assert.match(sheet.empty, /Nothing on this card yet/);
  assert.match(sheet.empty, /the first time you bake with this/i,
    "the empty card does not tell her what will fill it");
  assert.match(sheet.subtitle, /On hand:/, "⚠️ a stock card must lead with the amount on the shelf");
  // ⚠️ AND AN EMPTY CARD EXPLAINS ITSELF ONCE, NOT TWICE — found by LOOKING at it. The empty sentence
  // and the footer note say overlapping things, so both together are a wall she has to wade through.
  // A card with rows keeps the note, where it explains the columns.
  assert.equal(sheet.note, "", "an empty card still carries the footer note, so it says the same thing twice");
});

test("★★⚠️ the STOCK section carries its quantity as a QUANTITY, never dressed as money", () => {
  // ⚠️⚠️ THE RULE THAT MATTERS MOST ON THIS SHEET. `amount` is formatted by `money()` in the screen,
  // the paper, the shared text and the PDF alike — so 500 grams in it would print as "RM 500.00". The
  // quantity goes in its own `val` CELL, the money cell is left EMPTY (`amount: null`, which draws as
  // an em dash), and `what` still spells the whole thing out as a sentence for the paper and the PDF.
  const state = freshState();
  const sheet = stockCardSheet(state, journalledIng({ stockLog: [
    { at: "2026-10-05", delta: -500, why: "baked", what: "Baked — Rosemary Focaccia ×2", ref: "o1" },
    { at: "2026-10-01", delta: 5000, why: "bought", what: "Bought — 1 Oct 2026 list", ref: "po_2" },
  ] }));

  const stockRows = sheet.lines.filter((l) => !l.heading && !l.head && l.amount === null);
  assert.equal(stockRows.length, 2, "one row per stock movement");
  const heading = sheet.lines.find((l) => l.heading && l.what === "Stock");
  assert.ok(heading, "the stock rows are under a heading of their own");

  // ★★ THESE ROWS WERE ONE COMPOSED SENTENCE UNTIL v390, AND THAT IS WHAT CHANGED. ⚠️ NOT a change of
  // mind about the lesson behind it — a fix to the CAUSE.
  //
  // v385 tried the journal's `cols` first and **a phone rendered it unreadable**: `.journal-cols`
  // widths are fixed for the FILING page's five columns (a 3.5em date, a 4.6em order code), so a stock
  // row came out "1 Oct…" and "Stockta…" — cut off. **A test asserting a cell's TEXT cannot see a
  // column that truncates it**, so the fix then was to avoid columns altogether.
  //
  // Her words, at v390: __"a stock card should be as clear as a table with row and column"__. The card
  // now carries its OWN column scope (`.stock-journal` in app.css), sized for its own three columns,
  // with the middle one WRAPPING rather than ellipsising — so a column row is honest here in a way it
  // could not be at v385. ⚠️ `what` is still built, so the paper, the shared text and the PDF print
  // exactly what they printed before: **arranged differently, never a different value.**
  // Oldest first, like the price rows — a book reads as a history.
  assert.deepEqual(stockRows[0].cols, ["1 Oct", "Bought — 1 Oct 2026 list"],
    "the date and the reason are cells of their own — the table she asked for");
  assert.equal(stockRows[0].val, "+5 kg",
    "⚠️ the amount has a cell of its own, and is a QUANTITY there — not money");
  assert.equal(stockRows[1].val, "−500 g", "signed, with the typographic minus so a column lines up");
  assert.match(stockRows[1].cols[1], /Baked — Rosemary Focaccia ×2/,
    "and WHAT moved it — a bare number would not answer 'where did my flour go'");
  for (const r of stockRows) {
    assert.equal(r.amount, null,
      "⚠️⚠️ a stock row put a figure in the MONEY column — grams would print as ringgit");
    assert.ok(!/RM/.test(r.val) && !/RM/.test(r.what), "⚠️ a stock row's figures carry money");
    assert.ok(/·/.test(r.what),
      "⚠️ the sentence the PAPER reads went missing — `cols` is an arrangement, never a replacement");
  }
  // ⚠️ AND THE COLUMNS ARE NAMED — three stacks of text are not a table.
  const head = sheet.lines.find((l) => l.head);
  assert.deepEqual(head.cols, ["When", "What happened"], "the first two columns are not named");
  assert.equal(head.val, "Change", "and the third is not named");
  assert.equal(sheet.lines[0].heading, true, "the stock section still leads the page");
});

test("★★⚠️ a stock row BUILDS its ✕ when the card is drawn — it does not delete anything", () => {
  // ⚠️⚠️ FOUND BY LOOKING AT THE RENDERED SCREEN, NOT BY A TEST, and nothing here would have caught it:
  // the row's `action` was wired straight to the delete, so **drawing the card called it once per row**
  // — opening a confirm over every line the moment she opened the card, and leaving no button on any
  // row at all. A function that performs its effect when it is *built* cannot be caught by asserting the
  // sheet's data, which is why this asserts on what the row's `action` RETURNS.
  const state = freshState();
  const ing = journalledIng({ onHand: 7500, stockLog: [
    { at: "2026-10-01", delta: 8000, why: "bought", what: "Bought — 1 Oct 2026 list", ref: "po_2" },
  ] });
  const sheet = stockCardSheet(state, ing, () => {});
  const row = sheet.lines.find((l) => !l.heading && !l.head);
  assert.equal(typeof row.action, "function", "a stock row carries no way to take it off the card");
  const node = row.action();
  assert.equal(node.tagName, "BUTTON", "⚠️⚠️ the row's action RAN instead of building a control");
  assert.equal(ing.onHand, 7500, "⚠️⚠️ DRAWING the card moved her stock");
});

test("⚠️ and a card drawn WITHOUT a way to redraw offers no ✕ at all", () => {
  // ⚠️ The paper and the PDF read the same sheet through a renderer that passes no `actions`, and the
  // printed card must carry no press. A row built with no `refresh` therefore carries no action — so a
  // printed sheet cannot show a ✕ even by accident.
  const state = freshState();
  const ing = journalledIng({ stockLog: [
    { at: "2026-10-01", delta: 8000, why: "bought", what: "Bought — 1 Oct 2026 list", ref: "po_2" },
  ] });
  const sheet = stockCardSheet(state, ing); // no refresh — the paper's path
  const row = sheet.lines.find((l) => !l.heading && !l.head);
  assert.equal(row.action, null, "a card with no way to redraw still offered a control");
});

test("★★ an ingredient whose PRICE never moved still gets a real card — and STOCK leads it", () => {
  // ⚠️ The press itself is now on everything (the test above), so what this pins is the CONTENTS: an
  // ingredient whose price has never changed still has a card worth opening, because its stock moved.
  // ★★ AND **STOCK LEADS** (v386) — she asked for a stock CARD, so the shelf is the first thing on it.
  const state = freshState();
  state.ingredients.push({ id: "ing_f", name: "Strong flour", unit: "g", uomId: "u_g", costPerUnit: 0.001,
    stockLog: [{ at: "2026-10-05", delta: -500, why: "baked", what: "Baked — Focaccia ×2", ref: "o1" }] });
  const sheet = stockCardSheet(state, state.ingredients[0]);
  assert.equal(sheet.lines[0].heading, true);
  assert.equal(sheet.lines[0].what, "Stock",
    "⚠️ the price section is leading a card she opened for stock");
  assert.equal(sheet.lines.filter((l) => l.heading).length, 1,
    "a Price heading over no price rows reads as a fault");
  assert.match(sheet.subtitle, /On hand: 0 g/, "the card does not say what is on the shelf");

  // ★★ AND WITH **BOTH** SECTIONS PRESENT, STOCK STILL LEADS. ⚠️ A bite found this gap: the test above
  // has only a stock log, so swapping the two sections changed nothing it could see. **A rule about the
  // ORDER of two things cannot be proved with one of them missing.**
  const both = stockCardSheet(state, { ...state.ingredients[0],
    priceLog: [{ at: "2026-09-12", supplierName: "Mydin", qty: 3000, uomName: "g", price: 25.5, was: 24, source: "po" }] });
  const headings = both.lines.filter((l) => l.heading).map((l) => l.what);
  assert.deepEqual(headings, ["Stock", "Price"],
    "⚠️ a stock card must lead with Stock even when it carries a price history too");
  assert.match(both.title, /stock card/, "the card does not carry her own name for it");
});

test("opening the journal shows the price now on the SCREEN, not only on the page", () => {
  // `journalBodyEl` deliberately does not draw a sheet's subtitle — every other journal leans
  // on the section wording above its card. But her answer was "only when the price moves,
  // PLUS TODAY", and a movement list cannot carry "today" by itself: without this line the
  // screen would show the history and never the price she is actually on.
  const state = freshState();
  state.suppliers = [{ id: "s_mydin", name: "Mydin", active: true }];
  state.ingredients.push(journalledIng());

  const root = render(state);
  const card = walk(root).find((n) => String(n.className).includes("card") && textOf(n).includes("Strong flour"));
  fire(walk(card).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Stock card"));

  const layer = registry["popup-layer"];
  assert.match(textOf(layer), /stock card/, "the card does not carry her own name for it");
  assert.match(textOf(layer), /On hand: [^·]+· Price now:/,
    "⚠️ the card leads with the PRICE on a card she opened for STOCK");
  assert.match(textOf(layer), /Price now: RM 27\.50 per 3000g pack · Mydin/,
    "the price she is on is on the card");
  assert.ok(textOf(layer).includes("was RM 25.50"), "and so is what it moved from");
  assert.ok(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Print"),
    "and the journal leaves the screen like every other one");
});
