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

import { renderPO } from "../admin/js/views/po.js";

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
