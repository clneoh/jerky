// test/po.test.js — the consolidated PO: tick several bake days → one combined
// shopping list. Renders the real view under a tiny DOM shim and drives the
// checkboxes + Generate button, so the multi-date merge, the "✓ saved / orders
// changed" memory and the explicit ?dates= reopen all work as the baker would
// touch them. po.js deliberately imports no app.js (it sets location.hash
// directly), which is what lets this view run under Node at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, todayISO, shortDate } from "../admin/js/dates.js";

// --- DOM shim (mirrors test/products-editor.test.js) ---
function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {}, parentNode: null,
    // ⚠️⚠️ THIS WAS A NO-OP UNTIL v387 — `add() {}`, and `contains()` always FALSE. **A shim that cannot
    // remember a class cannot test any code that sets one**, and the per-shop print is exactly that
    // code. Same rule as everywhere else in this suite: when the stand-in cannot express what the view
    // does, the stand-in is what is wrong.
    classList: {
      add(c) { const set = new Set(String(node.className).split(/\s+/).filter(Boolean)); set.add(c); node.className = [...set].join(" "); },
      remove(c) { node.className = String(node.className).split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains(c) { return String(node.className).split(/\s+/).includes(c); },
      toggle(c, on) { if (on === undefined ? !this.contains(c) : on) this.add(c); else this.remove(c); },
    },
    // ⚠️ `parentNode` IS SET ON APPEND, because `closest()` below walks up it. Without it the per-shop
    // print could not find its own section and would silently do nothing.
    appendChild(c) { if (c != null) { if (c.nodeType === 1) c.parentNode = node; node.children.push(c); } return c; },
    append(...cs) { for (const c of cs) if (c != null) { if (c.nodeType === 1) c.parentNode = node; node.children.push(c); } },
    replaceChildren(...cs) { node.children = []; for (const c of cs) if (c != null) { if (c.nodeType === 1) c.parentNode = node; node.children.push(c); } },
    addEventListener(t, f) { (node._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { node._listeners[t] = (node._listeners[t] || []).filter((x) => x !== f); },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return node.attrs[k]; },
    closest(sel) {
      const want = String(sel || "").toUpperCase();
      let at = node;
      while (at) { if (at.tagName === want) return at; at = at.parentNode; }
      return null;
    },
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
  return node;
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
// ⚠️⚠️ `location.hash` IS BACKED BY A VARIABLE AND ITS WRITES ARE COUNTED (v388). Setting
// `location.hash` is what FIRES the app's hashchange and therefore its router; `history.replaceState`
// is what does NOT. The two must be told apart by a test, and a plain `{ hash: "" }` object — which
// cannot say whether anyone wrote to it — cannot tell them apart.
let hashValue = "";
const hashWrites = [];
globalThis.location = {
  get hash() { return hashValue; },
  set hash(v) { hashValue = String(v); hashWrites.push(hashValue); },
};
// ⚠️ AND A BARE `history` REFERENCE THROWS IN NODE, so this is not optional: without it every path
// that reaches the line is a ReferenceError rather than a pass. The rest of this suite shims it for
// exactly this reason; this file did not need it until the PO stopped navigating to change its URL.
const replacedUrls = [];
globalThis.history = {
  replaceState(_s, _t, url) { replacedUrls.push(String(url == null ? "" : url)); },
};
// ⚠️ NO `window` EXISTED HERE BEFORE, because nothing this suite rendered had ever called one — the
// fixture had no suppliers, so the Copy/Message buttons never drew. The per-shop Print does need it,
// and the spy is what lets a test prove the press really ASKED the browser to print rather than
// quietly doing nothing.
const printed = [];
globalThis.window = {
  _listeners: {},
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
  removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
  open() {},
  print() { printed.push(true); },
};

import { renderPO, manualPO } from "../admin/js/views/po.js";
import * as poTableModule from "../admin/js/views/poTable.js";
import { readFileSync } from "node:fs";

const P = { id: "prd_loaf", name: "Sourdough", unit: "loaf", active: true,
  recipe: [{ ingredientId: "ing_flour", qty: 500, unit: "g" }] };
const ING = { id: "ing_flour", name: "Strong flour", unit: "g", uomId: "u_g", costPerUnit: 0.006 };

// Two upcoming bake days, each with one Sourdough order. Returns fresh ids each
// call so tests that "save then reopen" don't share order objects.
function freshState() {
  const a = addDays(todayISO(), 2);
  const b = addDays(todayISO(), 4);
  return {
    settings: { defaultCapacity: 12, currency: "RM", supabase: {} },
    uoms: [{ id: "u_g", name: "g", family: "weight", toBase: 1 }],
    suppliers: [],
    ingredients: [ING],
    products: [P],
    deliveryDates: [
      { id: "del_a", date: a, notes: "" },
      { id: "del_b", date: b, notes: "" },
    ],
    orders: [
      { id: "ord_a1", deliveryDateId: "del_a", productId: "prd_loaf", qty: 1 },
      { id: "ord_b1", deliveryDateId: "del_b", productId: "prd_loaf", qty: 1 },
    ],
    purchaseOrders: [],
  };
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
const fireChange = (node) => (node._listeners.change || []).forEach((f) => f());

// The date-sorted tick rows under root: each row's first child is its checkbox.
function rows(root) {
  return walk(root).filter((n) => n.nodeType === 1 && String(n.className).includes("po-day-row"));
}
function rowTag(row) {
  const tag = (row.children || []).find((c) => c.nodeType === 1 && String(c.className).includes("po-day-tag"));
  return tag ? textOf(tag).trim() : "";
}
function nodeTexts(root) {
  return textOf(root);
}
function findBtn(root, label) {
  return walk(root).find((n) => n.nodeType === 1 && n.tagName === "BUTTON" && textOf(n).trim() === label);
}
function findClass(root, clsPart) {
  return walk(root).find((n) => n.nodeType === 1 && String(n.className).includes(clsPart));
}

function render(state, query = "") {
  const root = doc.createElement("div");
  renderPO(root, state, new URLSearchParams(query));
  return root;
}

function genButton(root) {
  return walk(root).find((n) => n.tagName === "BUTTON"
    && (n.children || []).some((c) => c.text === "💾 Generate & Save"));
}

test("default ticks two uncovered future days and shows ONE combined list that adds them up", () => {
  const state = freshState();
  const root = render(state);

  const r = rows(root);
  assert.equal(r.length, 2, "one tick row per delivery date");
  assert.equal(r[0].children[0].checked, true, "day A has orders & nothing saved → default ticked");
  assert.equal(r[1].children[0].checked, true, "day B likewise");

  const all = nodeTexts(root);
  assert.ok(all.includes("2 units planned across 2 posting days · Sourdough ×2"),
    "the sub-line announces the combined need across both days");
  assert.ok(all.includes("RM 6.00"), "1000 g flour × RM 0.006 = RM 6.00 grand total in the table");

  const labelA = shortDate(state.deliveryDates[0].date);
  const breakdown = walk(root).find((n) => String(n.className).includes("po-breakdown"));
  assert.ok(textOf(breakdown).includes(`${labelA}: Sourdough ×1 = 500g`),
    "each contributing day is named on its own breakdown line");
});

test("Generate & Save records one snapshot over both days; reopening leaves both as ✓ saved", () => {
  const state = freshState();
  const root = render(state);

  fireClick(genButton(root));
  assert.equal(state.purchaseOrders.length, 1);
  const po = state.purchaseOrders[0];
  assert.equal(po.dates.length, 2, "snapshot lists both covered days");
  assert.equal(po.deliveryDateId, "del_a", "backward-compatible single-day pointer keeps the first day");
  assert.equal(po.deliveryDate, state.deliveryDates[0].date);
  assert.equal(po.summary.capacity, 24, "capacity = the two days' effective capacity summed (12 + 12)");

  // A fresh screen with no URL defaults to NOTHING ticked (both days shopped).
  const reopen = render(state);
  const r = rows(reopen);
  assert.equal(r[0].children[0].checked, false, "day A no longer default-ticked");
  assert.equal(r[1].children[0].checked, false, "day B no longer default-ticked");
  assert.equal(rowTag(r[0]), "✓ saved");
  assert.equal(rowTag(r[1]), "✓ saved");
  assert.ok(nodeTexts(reopen).includes("Those days are already shopped ✓"),
    "an empty selection explains that everything is already saved");
});

test("an order change after saving flips that day to \"orders changed\" but keeps it OUT of the list", () => {
  const state = freshState();
  fireClick(genButton(render(state))); // save an accurate snapshot for both days
  assert.equal(state.purchaseOrders.length, 1);

  state.orders[1].qty = 2; // day B's order changes after the list was saved

  const root = render(state);
  const r = rows(root);
  assert.equal(r[0].children[0].checked, false, "unchanged day A stays unticked");
  assert.equal(rowTag(r[0]), "✓ saved");
  assert.equal(r[1].children[0].checked, false, "changed day B does NOT re-tick — no whole-day re-buy");
  assert.equal(rowTag(r[1]), "orders changed");
  assert.ok(!nodeTexts(root).includes("Ingredients to buy"), "nothing re-lists on its own");
  assert.ok(nodeTexts(root).includes("A day has a new order since you shopped"),
    "the empty state points the baker at the day to review");
});

test("explicit ?dates= reopens an already-saved day (the history Regenerate path)", () => {
  const state = freshState();
  render(state);
  fireClick(genButton(render(state)));

  const root = render(state, `dates=${state.deliveryDates[0].id}`);
  const r = rows(root);
  assert.equal(r[0].children[0].checked, true, "the requested saved day is ticked");
  assert.equal(r[1].children[0].checked, false, "the other day is not pulled in");
  assert.ok(nodeTexts(root).includes("Ingredients to buy"), "its list builds despite being saved");
});

test("legacy single-date snapshots fall back to order-id matching (add/remove = changed)", () => {
  const state = freshState();
  const [a, b] = state.deliveryDates;
  // Simulate a PO saved by an older build: no dates[], just deliveryDate+orderIds.
  state.purchaseOrders.push({
    id: "po_legacy", deliveryDateId: a.id, deliveryDate: a.date,
    generatedAt: new Date().toISOString(), items: [], summary: {}, orderIds: ["ord_a1"], warnings: [],
  });

  let root = render(state);
  assert.equal(rows(root)[0].children[0].checked, false, "matching order ids → still saved");
  assert.equal(rowTag(rows(root)[0]), "✓ saved");

  state.orders.push({ id: "ord_a2", deliveryDateId: "del_a", productId: "prd_loaf", qty: 1 });
  root = render(state);
  assert.equal(rowTag(rows(root)[0]), "orders changed", "a new order id no longer matches");
  assert.equal(rows(root)[0].children[0].checked, false, "the stale legacy day stays OUT of the list until reviewed");
});

test("a legacy ?date= single selection still works", () => {
  const state = freshState();
  const root = render(state, `date=${state.deliveryDates[1].id}`);
  const r = rows(root);
  assert.equal(r[1].children[0].checked, true, "the legacy param selects that day");
  assert.equal(r[0].children[0].checked, false);
  assert.ok(nodeTexts(root).includes("Ingredients to buy"));
});

test("ticking an extra day updates the combined list and grand total live", () => {
  const state = freshState();
  fireClick(genButton(render(state))); // cover both days accurately

  // Reopen just day A, then tick day B in place — the list must grow live.
  const root = render(state, `dates=del_a`);
  const r = rows(root);
  assert.equal(r[1].children[0].checked, false);

  r[1].children[0].checked = true;
  fireChange(r[1].children[0]);

  const all = nodeTexts(root);
  assert.ok(all.includes("2 units planned across 2 posting days · Sourdough ×2"),
    "day B's 500 g joined the combined need");
  assert.ok(all.includes("RM 6.00"), "grand total now covers both days");
});

// ★★⚠️ TICKING A DAY MUST NOT FIRE THE ROUTER (v388). Her words: __"the po page when click, the page
// jump, rerender"__.
//
// ⚠️⚠️ THE FAULT IS NOT VISIBLE IN THE RENDERED TEXT — after a tick the list is correct either way.
// What differed was HOW the address got written: `location.hash = …` fires the app's hashchange, the
// router empties #view, rebuilds the whole screen and leaves the document scrolled to the top, so a
// tick near the bottom of a long day list threw her back up the page. So this test asserts on the
// ADDRESS MECHANISM, which is the thing that actually broke — asserting on the list would have passed
// over the fault and pinned nothing.
test("⚠️ ticking a day writes the address instead of navigating — so the screen is never torn down", () => {
  const state = freshState();
  const root = render(state, `dates=del_a`);

  hashWrites.length = 0;   // the initial render is allowed to be wherever it is; the TICK is what matters
  replacedUrls.length = 0;

  const r = rows(root);
  r[1].children[0].checked = true;
  fireChange(r[1].children[0]);   // tick day B

  assert.equal(hashWrites.length, 0,
    "a tick must NOT assign location.hash — that fires hashchange and the router wipes the screen");
  assert.equal(replacedUrls.length, 1,
    "a tick must rewrite the address exactly once, so a shared or reopened PO still knows its days");
  assert.equal(replacedUrls[0], `#/po?dates=del_a,del_b`,
    "the address names exactly the ticked days");

  // ⚠️ AND THE LIST STILL UPDATED — the point of the fix is that she keeps her place, not that the
  // screen stopped working.
  assert.ok(nodeTexts(root).includes("RM 6.00"), "the combined total still redrew in place");
});

// ⚠️ UNTICKING EVERYTHING still has to write the address, and it has to be an EMPTY ?dates= rather
// than a bare #/po — a bare one silently re-defaults to every day, which is the trap the original
// comment named. The mechanism changed; that rule did not.
test("⚠️ unticking every day writes an empty ?dates=, never a bare #/po that would re-default", () => {
  const state = freshState();
  const root = render(state);          // opens with both days ticked
  replacedUrls.length = 0;

  for (const row of rows(root)) {
    const box = row.children[0];
    if (box.checked) { box.checked = false; fireChange(box); }
  }

  assert.equal(replacedUrls.at(-1), "#/po?dates=",
    "the last write must be an explicitly empty list, not #/po");
  assert.ok(!replacedUrls.includes("#/po"), "a bare #/po would silently re-tick every day");
});

test("tapping an \"orders changed\" day reveals the new order and its extra need", () => {
  const state = freshState();
  fireClick(genButton(render(state)));
  state.orders[1].qty = 2; // day B gains one more Sourdough after saving

  const root = render(state);
  const dayB = rows(root)[1];
  assert.equal(rowTag(dayB), "orders changed");
  fireClick(dayB); // open the reveal panel

  const all = nodeTexts(root);
  assert.ok(all.includes("What changed on"), "the panel is headed with the day");
  assert.ok(all.includes("+1 Sourdough"), "names the added order");
  assert.ok(all.includes("Strong flour 500g"), "and its extra ingredient need");
  assert.ok(findBtn(root, "Save extra-only list"), "big orders get the extra-only action");
  assert.ok(findBtn(root, "Ignore — keep it saved"), "small ones can be ignored");
});

test("Ignoring a change returns the day to \"✓ saved\" until another new order lands", () => {
  const state = freshState();
  fireClick(genButton(render(state)));
  state.orders[1].qty = 2; // day B changed
  const root = render(state);
  fireClick(rows(root)[1]);
  fireClick(findBtn(root, "Ignore — keep it saved"));

  const after = rows(render(state));
  assert.equal(rowTag(after[1]), "✓ saved", "day B reads saved again");
  assert.ok(!nodeTexts(render(state)).includes("A day has a new order since you shopped"),
    "no review nudge left once handled");
  assert.equal(state.deliveryDates[1].poAck, "prd_loaf:2", "the ack records the ignored fingerprint");

  state.orders.push({ id: "ord_b2", deliveryDateId: "del_b", productId: "prd_loaf", qty: 1 });
  const again = rows(render(state));
  assert.equal(rowTag(again[1]), "orders changed", "a further new order re-flags the day");
  assert.equal(again[1].children[0].checked, false, "and still doesn't re-tick it");
});

test("Save extra-only list makes a small separate snapshot of just the new orders; the day reads saved", () => {
  const state = freshState();
  fireClick(genButton(render(state))); // regular combined snapshot for both days
  state.orders[1].qty = 2; // day B changed
  const root = render(state);
  fireClick(rows(root)[1]);
  fireClick(findBtn(root, "Save extra-only list"));

  assert.equal(state.purchaseOrders.length, 2, "one extra-only snapshot was added");
  const extra = state.purchaseOrders[0];
  assert.equal(extra.topup, true, "flagged as an extra-only list");
  assert.equal(extra.dates.length, 0, "it does not claim to cover the day");
  assert.equal(extra.deliveryDateId, "del_b");
  assert.equal(extra.summary.totalUnits, 1);
  assert.deepEqual(extra.summary.productLines, [{ productId: "prd_loaf", productName: "Sourdough", qty: 1 }]);
  const flour = extra.items.find((i) => i.ingredientId === "ing_flour");
  assert.equal(flour.totalQty, 500, "covers only the added unit's ingredient need");
  assert.equal(location.hash, `#/history?po=${extra.id}`, "opens the new list in history");
  assert.equal(state.deliveryDates[1].poAck, "prd_loaf:2", "the day is acked exactly like an Ignore");

  const after = rows(render(state));
  assert.equal(rowTag(after[1]), "✓ saved", "day B reads saved now");

  // An extra-only list must never act as day coverage by itself: removing the
  // original regular snapshot puts the day back to not-yet-shopped.
  state.purchaseOrders = state.purchaseOrders.filter((p) => p.topup); // only the extra list remains
  const uncovered = rows(render(state));
  assert.equal(uncovered[1].children[0].checked, true,
    "with only an extra-only list left, day B is unshopped again");
});

test("a day whose orders were cut reveals the removal and offers no extra-to-buy action", () => {
  const state = freshState();
  fireClick(genButton(render(state)));
  state.orders = state.orders.filter((o) => o.id !== "ord_b1"); // day B's order cancelled

  const root = render(state);
  fireClick(rows(root)[1]); // the row is still tappable to review
  const all = nodeTexts(root);
  assert.ok(all.includes("1 fewer Sourdough"), "calls out the removed order");
  assert.ok(!findBtn(root, "Save extra-only list"), "no extra-only action when nothing was added");
});

test("saving an extra-only list closes that round; a later new order opens the NEXT round showing only its change", () => {
  const state = freshState();
  fireClick(genButton(render(state))); // round 1: regular snapshot covers both days
  state.orders[1].qty = 2; // day B gains one Sourdough after round 1
  const root1 = render(state);
  fireClick(rows(root1)[1]);
  fireClick(findBtn(root1, "Save extra-only list")); // round 2 saved for the +1
  assert.equal(state.deliveryDates[1].poAck, "prd_loaf:2", "round 2's baseline is the ack");
  assert.equal(rowTag(rows(render(state))[1]), "✓ saved", "day B reads saved once round 2 is saved");

  state.orders.push({ id: "ord_b2", deliveryDateId: "del_b", productId: "prd_loaf", qty: 1 }); // day B: +1 more
  const root2 = render(state);
  const dayB = rows(root2)[1];
  assert.equal(rowTag(dayB), "orders changed", "round 3 opens with the next new order");
  assert.equal(state.purchaseOrders.length, 2, "nothing saved yet — round 3 is just open");
  fireClick(dayB);
  const all = nodeTexts(root2);
  assert.ok(all.includes("+1 Sourdough"), "round 3 reveals only the NEW single unit");
  assert.ok(!all.includes("+2 Sourdough"), "round 2's already-saved unit is NOT counted again");
  assert.ok(all.includes("Strong flour 500g"), "the extra need is just that one unit's 500 g");
});

test("regenerating a full list after an Ignore clears the stale ack, so the new snapshot is the baseline", () => {
  const state = freshState();
  fireClick(genButton(render(state)));
  state.orders[1].qty = 2; // day B changed
  const root1 = render(state);
  fireClick(rows(root1)[1]);
  fireClick(findBtn(root1, "Ignore — keep it saved")); // ack = prd_loaf:2
  assert.equal(state.deliveryDates[1].poAck, "prd_loaf:2");

  const root2 = render(state, `dates=${state.deliveryDates[1].id}`); // history Regenerate path
  fireClick(genButton(root2));
  assert.equal(state.deliveryDates[1].poAck, undefined, "the regenerate supersedes the old ignore");
  assert.equal(rowTag(rows(render(state))[1]), "✓ saved", "the fresh snapshot is accurate");

  state.orders.push({ id: "ord_b3", deliveryDateId: "del_b", productId: "prd_loaf", qty: 1 }); // one more
  const root3 = render(state);
  fireClick(rows(root3)[1]);
  assert.ok(nodeTexts(root3).includes("+1 Sourdough"), "reveals against the regenerated snapshot, not the old ignore");
  assert.ok(!nodeTexts(root3).includes("+2 Sourdough"));
});

test("an ingredient she never buys is left off the list, and the list says so", () => {
  // "certain ingredient we dont purchase, in ingredient we can set that as a non
  // purchase item, like labour and electricity" (16 Sep 2026). Flour is still bought;
  // Labour is a cost inside the recipe and nothing to shop for.
  const state = freshState();
  state.ingredients.push({ id: "ing_labour", name: "Labour", unit: "hr", uomId: "u_g",
    costPerUnit: 8, notPurchased: true });
  state.products[0].recipe.push({ ingredientId: "ing_labour", qty: 0.25, unit: "hr" });

  const root = render(state);
  const table = findClass(root, "po-table");
  assert.ok(!textOf(table).includes("Labour"), "a not-bought ingredient never reaches the buy table");
  assert.ok(textOf(table).includes("Strong flour"), "while the one she does buy is untouched");
  assert.ok(nodeTexts(root).includes("Not on this list: Labour"),
    "and the list names it rather than looking as if it forgot");
});

// ── ★★ one shopping list per shop, on its own (v387) ──────────────────────────
// Her words: __"now the PO, lump together all supplier in one po is not practical"__, then, asked
// which problem she meant, __"i want a separate list per shop"__.
//
// ⚠️ THE GROUPING ALREADY EXISTED — heading, subtotal, Copy and Message, one section per shop. **The
// only exit still SHARED was the printer**: Print gave her every shop on one sheet, so she could not
// take Mydin's page to Mydin. These tests are about that gap and nothing else.

// A run that splits two ways — each ingredient cheapest at a DIFFERENT shop, which is what makes a PO
// have more than one section at all.
function shopState() {
  const st = freshState();
  st.suppliers = [
    { id: "sup_m", name: "Mydin", whatsapp: "60123456789" },
    { id: "sup_y", name: "Yen Grocer", whatsapp: "60199999999" },
  ];
  st.ingredients = [
    // cheapest at Mydin: RM22 for 4000 g beats RM27.50 for 3000 g per gram
    { id: "ing_flour", name: "Strong flour", unit: "g", uomId: "u_g", costPerUnit: 0.006,
      supplierPrices: [{ supplierId: "sup_m", qty: 4000, uomId: "u_g", price: 22 },
                       { supplierId: "sup_y", qty: 3000, uomId: "u_g", price: 27.5 }] },
    // and cheapest at Yen Grocer
    { id: "ing_butter", name: "Butter", unit: "g", uomId: "u_g", costPerUnit: 0.05,
      supplierPrices: [{ supplierId: "sup_y", qty: 500, uomId: "u_g", price: 18 },
                       { supplierId: "sup_m", qty: 250, uomId: "u_g", price: 12 }] },
  ];
  st.products = [{ ...P, recipe: [
    { ingredientId: "ing_flour", qty: 500, unit: "g" },
    { ingredientId: "ing_butter", qty: 20, unit: "g" },
  ] }];
  return st;
}

const shopPresses = (root) => walk(root).filter((n) =>
  n.nodeType === 1 && n.tagName === "BUTTON" && textOf(n).trim() === "🖨 Print this shop");
const sections = (root) => walk(root).filter((n) => n.nodeType === 1 && n.tagName === "TBODY");

test("★★ each shop's heading carries its OWN Print, beside its Copy and Message", () => {
  const root = render(shopState());
  const heads = walk(root).filter((n) => n.nodeType === 1 && String(n.className).includes("po-supplier"));
  assert.equal(heads.length, 2, `the run should split two ways, it drew ${heads.length} section(s)`);
  assert.equal(shopPresses(root).length, 2,
    "⚠️ a shop's list cannot leave on paper on its own — the printer is still shared");
  assert.equal(findBtn(root, "⧉ Copy order") !== undefined, true, "the per-shop Copy is still there");

  // ⚠️⚠️ AND ONE SECTION PER SHOP IS WHAT THE WHOLE THING RESTS ON. It used to be ONE `<tbody>` holding
  // every shop, which is exactly why a single sheet could not be separated — there was nothing in the
  // markup to hide. **A bite found this gap: merging the sections back into one broke no test at all**,
  // because the presses still existed and the CSS still matched nothing. The structure IS the feature.
  assert.equal(sections(root).length, 2,
    "⚠️ the shops share one section, so there is nothing to print one of them on its own");
});

test("⚠️ the saved list in History offers NO per-shop Print — a record is not a shopping run", () => {
  // ⚠️ History renders through the same table with `interactive:false`. A saved list is a RECORD of
  // what was bought, so it gains the per-shop sections but must not sprout buttons.
  const { poTableEl } = poTableModule;
  const st = shopState();
  const table = poTableEl(st, [
    { ingredientId: "ing_flour", ingredientName: "Strong flour", unit: "g", estCost: 22,
      supplierId: "sup_m", supplier: "Mydin", packQty: 4000, packUomName: "g" },
  ], { interactive: false, dateTitle: "Mon" });
  assert.equal(shopPresses(table).length, 0, "a saved list grew a shopping-run press");
});

test("★★⚠️ printing one shop marks THAT section — and cleans up after, never leaving a class behind", () => {
  // ⚠️⚠️ THE TRAP, AND IT IS THE ONE THAT WOULD DAMAGE SOMETHING ELSE SILENTLY. `printActiveLabel`'s own
  // comment names it: *"a leftover class can never blank a later PO print."* So this pins BOTH halves —
  // the class goes on, and it comes off again.
  //
  // ⚠️ THIS FILE STUBS `setTimeout` TO RUN IMMEDIATELY (to stop toast timers stalling the run), which
  // would fire the cleanup during the press and hide the whole thing. A deferred stub is what models a
  // browser, where the cleanup happens LATER.
  const realST = globalThis.setTimeout;
  const pending = [];
  globalThis.setTimeout = (fn) => { pending.push(fn); return 1; };
  printed.length = 0;
  try {
    const root = render(shopState());
    const presses = shopPresses(root);
    const myshop = presses[0].closest("tbody");
    assert.ok(myshop, "the press could not find its own section — it would silently do nothing");

    presses[0]._listeners.click[0]();

    assert.equal(doc.body.classList.contains("po-shop-print"), true,
      "⚠️ the press did not mark the page for printing, so Print would print EVERY shop");
    assert.equal(myshop.classList.contains("print-shop"), true,
      "⚠️ the press did not mark ITS OWN section, so the one-shop sheet would be blank");
    assert.equal(printed.length, 1, "the press never asked the browser to print");

    // ⚠️ AND NOW THE HALF THAT MATTERS MOST: the cleanup, the way a browser delivers it.
    const afterprint = (globalThis.window._listeners.afterprint || [])[0];
    assert.ok(afterprint, "nothing is listening for the print finishing — a leftover class would blank a later PO print");
    afterprint();
    assert.equal(doc.body.classList.contains("po-shop-print"), false,
      "⚠️⚠️ THE BODY CLASS WAS LEFT BEHIND — the next ordinary PO print would come out blank");
    assert.equal(myshop.classList.contains("print-shop"), false, "the section marker was left behind");
  } finally {
    globalThis.setTimeout = realST;
  }
});

test("⚠️ every other shop's section is the ONE that gets hidden, and the run's total goes with it", () => {
  // ⚠️ A rule about hiding two of three sections cannot be proved by pressing one — this reads the CSS
  // that does the hiding, so "print one shop" cannot quietly become "print them all" or "print none".
  const css = readFileSync(new URL("../admin/css/print.css", import.meta.url), "utf8");
  const block = /@media print \{[\s\S]*?body\.po-shop-print[\s\S]*?\n\}/.exec(css);
  assert.ok(block, "print.css has no body.po-shop-print block — the press would print every shop");
  assert.match(block[0], /tbody:not\(\.print-shop\)\s*\{\s*display:\s*none/,
    "⚠️ the OTHER shops are not hidden, so a one-shop print still carries every shop");
  assert.match(block[0], /tfoot\s*\{\s*display:\s*none/,
    "⚠️ the whole run's total is printed on a one-shop sheet — it is not that shop's total");
  // ⚠️ AND NOTHING WITHOUT THE BODY CLASS. Every rule is scoped, so a leaked marker cannot hide
  // anything on its own.
  assert.equal(/^\s*tbody:not/m.test(css), false, "an unscoped hiding rule would blank the ordinary PO print");
});

// ── ★★ A LIST WRITTEN BY HAND — NO BAKE DAY BEHIND IT (v401) ──────────────────
// Her words: __"I want to add a manual PO issuing, the rest of the po process follow what we already
// have for po processing. I think a thing only different is it dont tie to specific bake date"__

test("★★⚠️ a hand-written list carries NO bake day — so it cannot mark one as shopped", () => {
  // ⚠️⚠️ THE WHOLE FEATURE IS AN ABSENCE, AND IT IS TESTED AS ONE. `coveringPO` matches a saved list to
  // a date by `dates[]`/`deliveryDate` and nothing else, so the way to prove "this never marks a day
  // shopped" is to prove **neither key is written at all**. An assertion that merely checked "the day is
  // not shopped" would pass for a list that happened to cover a different day.
  const bom = { totalUnits: 21, orders: [{ productId: "prd_loaf" }], productLines: [], warnings: [] };
  const po = manualPO(bom, [{ ingredientId: "ing_flour" }], 75);

  assert.equal(po.manual, true, "nothing marks this as the hand-written kind");
  assert.equal(Object.prototype.hasOwnProperty.call(po, "dates"), false,
    "⚠️⚠️ a hand-written list recorded a `dates` array — it can now claim a bake day as shopped");
  assert.equal(Object.prototype.hasOwnProperty.call(po, "deliveryDate"), false,
    "⚠️⚠️ and a legacy `deliveryDate`, which `coveringPO` reads the same way");

  // ⭐ AND THE REST OF THE SHAPE IS AN ORDINARY LIST'S, which is what makes every downstream step —
  // Buy, Undo, Amend, Print, the stock push — work on it unchanged.
  assert.equal(po.summary.totalUnits, 21);
  assert.equal(po.summary.buyTotal, 75);
  assert.deepEqual(po.productIds, ["prd_loaf"], "the products she picked are not recorded on it");
  assert.ok(Array.isArray(po.items) && Array.isArray(po.warnings));
});

test("★★ a hand-written list leaves every bake day exactly as it was", () => {
  // ⚠️ The end the absence is FOR: with the hand-written list sitting in her history, the PO screen must
  // still offer every day as un-shopped — otherwise writing a list would quietly cost her a day's shop.
  const state = freshState();
  const bom = { totalUnits: 4, orders: [{ productId: "prd_loaf" }], productLines: [], warnings: [] };
  state.purchaseOrders = [manualPO(bom, [{ ingredientId: "ing_flour" }], 20)];

  const root = render(state);
  const r = rows(root);
  assert.equal(r.length, 2, "the two bake days are not on the screen");
  for (const row of r) {
    assert.equal(row.children[0].checked, true,
      "⚠️⚠️ a hand-written list ticked a bake day off by itself");
    assert.equal(rowTag(row), "",
      `⚠️⚠️ a hand-written list made a bake day read as "${rowTag(row)}" — it is not tied to any day`);
  }
});
