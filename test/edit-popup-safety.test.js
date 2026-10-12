// test/edit-popup-delete-safety.test.js — an edit may only ever remove the lines SHE removed.
//
// Her report, and it is about lost orders:
//
//   "there is few orders that when jien enters, say she want to enter but she break it to.
//    became 20, 10 & 2, So what i want to do is change one to 3 then delete the 10 & 2,
//    in the process, other order get deleted"
//
// ⚠️⚠️ THE EDIT POP-UP'S SAVE IS THE ONE PLACE IN THIS APP WHERE CHANGING ONE ORDER CAN TAKE
// ROWS AWAY THAT THE POP-UP NEVER SHOWED HER. It decided what to delete like this:
//
//     const keptIds = new Set(chosen.map((l) => l.id).filter(Boolean));
//     const dropIds = new Set(group.orders.filter((o) => !keptIds.has(o.id)).map((o) => o.id));
//     if (dropIds.size) state.orders = state.orders.filter((o) => !dropIds.has(o.id));
//
// …and that last line sweeps the WHOLE ORDER BOOK, not the day on screen. Two things in it can
// take the wrong rows, and each is pinned below:
//
//   1. `chosen` is `lines.filter((l) => l.productId)` — **a line the picker cannot name was read
//      as "she deleted it"**, so its row went with no ✕ ever pressed on it.
//   2. `.filter(Boolean)` on the kept ids is the author saying, in code, that a row can have no
//      `id`. When a DROPPED row has none, `dropIds` holds `undefined` — and the sweep above then
//      takes **every id-less order in the whole book** out with it, from an edit that never
//      mentioned them. ⭐ Deleting what cannot be named is not a deletion, it is a sweep.
//
// ⚠️ WHAT THIS FILE DOES **NOT** CLAIM: that either of these was what happened on her phone. She
// has not been able to say which orders went, and no test can answer that — the point here is that
// a Save can no longer remove a row the pop-up did not show her, whichever door the fault came
// through. (She is looking at More → Backup & safety → View, whose bottom group, "Not on a bake
// day", lists every order that has lost its day.)
//
// Everything is driven through renderOrders and the real modules — the screen is rendered for
// real, the Edit pop-up is opened by pressing the row's own Edit button, a line's own ✕ is
// pressed, and "Save changes" is pressed. The only thing stubbed is the network. "Now" is frozen
// at Thu 10 Sep 2026.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this._adopt(c); if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) { if (c == null) continue; this._adopt(c); this.children.push(c); } },
    replaceChildren(...cs) {
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    _adopt(c) { if (c && c.nodeType === 1) c.parentNode = this; },
    get isConnected() {
      for (let n = this; n; n = n.parentNode) if (n === doc.body) return true;
      return false;
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
  return node;
}
const layers = {};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.document = doc;
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", clipboard: null }, configurable: true, writable: true,
});

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 10, 10, 0, 0); }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

doc.body.append(doc.getElementById("popup-layer"));

const { renderOrders } = await import("../admin/js/views/orders.js");

// The one thing stubbed is the network — every sync and publish is answered with an empty list,
// so nothing here can depend on reaching Supabase.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" });

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttons = (root) => all(root).filter((n) => n.tagName === "BUTTON");
const buttonByText = (root, text) => buttons(root).find((n) => n.textContent.includes(text));
// A line's own ✕. The inbox rows carry the same class, so the pop-up is searched, never `root`.
const lineStrips = (popup) => buttons(popup).filter((b) => b.textContent.trim() === "✕"
  && String(b.className).includes("inbox-del"));
const press = (btn) => btn._listeners.click[0]();
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1)); };

function makeState(orders) {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-30" }, { id: "d11", date: "2026-10-02" }],
    products: [{ id: "p1", name: "Focaccia", limit: 99, active: true, recipe: [], unit: "pc" }],
    orders,
    ingredients: [], occasions: [], customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 99, currency: "RM", deliveryDays: [3, 4],
      supabase: { url: "", anonKey: "" },
      storefront: { name: "Jienluv2bake", whatsapp: "016 960 1268" },
    },
  };
}

// Walk to the Save exactly as she does: the Orders screen for real, the row's own Edit button,
// then — only where a case asks for it — a line's own ✕, then "Save changes".
async function editAndSave(state, { strip = -1 } = {}) {
  const root = createEl("div");
  const popup = layers["popup-layer"];
  renderOrders(root, state, new URLSearchParams({ date: "d10" }));
  const edit = buttonByText(root, "Edit");
  assert.ok(edit, "the row drew its own Edit button");
  press(edit);
  if (strip >= 0) {
    const strips = lineStrips(popup);
    assert.ok(strips[strip], `the pop-up drew a ✕ on line ${strip} (it drew ${strips.length} of them)`);
    press(strips[strip]);
  }
  const save = buttonByText(popup, "Save changes");
  assert.ok(save, "the pop-up drew its own Save changes button");
  press(save);
  await settle();
  return { root, popup };
}
const ids = (state) => state.orders.map((o) => o.id);

// Her own shape: ONE customer order, three lines, sharing one group id.
function threeLines() {
  return [
    { id: "o20", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-30", orderDate: "2026-09-20",
      productId: "p1", qty: 20, customerName: "Jien", whatsapp: "60123456789", status: "new" },
    { id: "o10", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-30", orderDate: "2026-09-20",
      productId: "p1", qty: 10, customerName: "Jien", whatsapp: "60123456789", status: "new" },
    { id: "o2", groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-30", orderDate: "2026-09-20",
      productId: "p1", qty: 2, customerName: "Jien", whatsapp: "60123456789", status: "new" },
    // ⚠️ An order on ANOTHER bake day, for someone else. Nothing in the pop-up above can name it,
    // so nothing in that Save may touch it.
    { id: "oOther", deliveryDateId: "d11", deliveryDate: "2026-10-02", orderDate: "2026-09-21",
      productId: "p1", qty: 5, customerName: "Mei Ling", whatsapp: "60199999999", status: "confirmed" },
  ];
}

test("★★ the ✕ removes the line she pressed it on, and the pop-up still saves the rest", async () => {
  // The plain case, and the one she was doing: remove the 10 and the 2, keep the 20.
  const state = makeState(threeLines());
  await editAndSave(state, { strip: 1 }); // the second line's ✕
  assert.deepEqual(ids(state).sort(), ["o2", "o20", "oOther"].sort(),
    `removing one line took a row it was not pressed on — left: ${ids(state).join(", ")}`);
  const kept = state.orders.find((o) => o.id === "o20");
  assert.equal(kept.qty, 20, "the line she kept was changed by the removal of another");
  assert.ok(state.orders.some((o) => o.id === "oOther"),
    "★ an order on another bake day — a different customer, never named by this pop-up — was taken");
});

test("★★ a line the picker cannot name is NOT read as 'she deleted it'", async () => {
  // ⚠️ `chosen` is `lines.filter((l) => l.productId)`, and the Save used to delete every row of
  // the group that was not in it — so a row whose line carried no product went with the Save
  // **without any ✕ being pressed on it**. That is a row on the same day, in the same group,
  // that the pop-up DREW on screen: it is the exact shape of "other order get deleted".
  const rows = threeLines();
  rows[1].productId = ""; // a line the picker cannot name — the shape `o.productId || ""` allows
  const state = makeState(rows);
  await editAndSave(state); // no ✕ pressed at all
  assert.ok(state.orders.some((o) => o.id === "o10"),
    "★ a line she never removed was deleted — the Save read an unnamed product as her deletion");
  assert.deepEqual(ids(state).sort(), ["o10", "o2", "o20", "oOther"],
    "the Save added or removed rows of its own");
});

test("★★ adding a second item does not change the order's NUMBER (v441)", async () => {
  // ⚠️⚠️ THE ORDER NUMBER IS A KEY, NOT A LABEL. Her words: __"the randon order number is a plus
  // point in our system, it is a unique identify of an order. Even the merchant dont control. Giving
  // this to a customer is like giving a key to a customer, we know and customer know. delivery man
  // will not know, a stranger trying to take advantage, will not be able to do so."__
  //
  // ⚠️ AND IT USED TO MOVE, SILENTLY, ON THIS SCREEN. A one-item order has no groupId, so its code
  // was drawn from its own id — and giving it a second item invented a group name, which the code was
  // then drawn from instead. Measured on a real screen before the fix: **one item `#1`, a second item
  // added, `#55568B`.** ⭐ Everything downstream of that is the same fault: a receipt already written
  // reads "not in this phone's orders" for ever, a customer's confirmation quotes a code that now
  // belongs to nobody, and searching the code you gave them finds nothing.
  const state = makeState([{ id: "o1", deliveryDateId: "d10", deliveryDate: "2026-09-30",
    orderDate: "2026-09-20", productId: "p1", qty: 20, customerName: "Jien",
    whatsapp: "60123456789", status: "new" }]);
  const root = createEl("div");
  const popup = layers["popup-layer"];
  renderOrders(root, state, new URLSearchParams({ date: "d10" }));

  const codeShown = (r) => {
    const el = all(r).find((n) => String(n.className).includes("ord-code"));
    return el ? el.textContent.trim() : null;
  };
  const before = codeShown(root);
  assert.match(before, /^#[0-9A-F]{1,6}$/, `the row did not draw its own order number (drew ${before})`);

  press(buttonByText(root, "Edit"));
  // ⚠️ THE NEW LINE IS FOUND BY WHAT IT IS, NOT BY A CLASS NAME. `add-item-ctl` contains the text
  // "add-item" too, so a substring match picks up the control row — and the last of those holds no
  // picker at all. Counting the product pickers is both exact and a real assertion: if the press did
  // not add a line, there is nothing here to fill in and the test must say so rather than pass.
  const pickers = () => all(popup).filter((n) => n.tagName === "SELECT");
  const before2 = pickers().length;
  press(buttonByText(popup, "Add another item"));
  const after2 = pickers();
  assert.ok(after2.length > before2,
    `the press did not add a line to the pop-up (${before2} picker(s) before, ${after2.length} after)`);
  const sel = after2[after2.length - 1];
  // ⚠️ The line's own handler reads `prodSel.value`, so setting the value and firing its own change is
  // the one thing needed — no options have to be modelled in the shim.
  sel.value = "p1";
  sel._listeners.change[0]();
  press(buttonByText(popup, "Save changes"));
  await settle();
  // ⚠️ The confirmation layer only EXISTS once something has drawn one — 20 + 1 items over a
  // capacity of 99 stays under it, so there may be no layer to look in at all.
  const cl = layers["confirm-layer"];
  const yes = cl ? buttonByText(cl, "Save anyway") : null;
  if (yes) { press(yes); await settle(); }

  // ⚠️ THE BRANCH MUST HAVE BEEN TAKEN, or this test proves nothing about the fault.
  assert.ok(state.orders[0].groupId,
    "the order never gained a group name, so the moment the number used to move was never reached");
  assert.equal(state.orders.length, 2, "the second item did not land on the order");
  const after = codeShown(root);
  assert.equal(after, before,
    `★ the order's number moved when a second item was added: ${before} → ${after}`);
});

test("★★ a row with no id is never swept up by an unrelated edit", async () => {
  // ⚠️⚠️ THE SWEEP. `keptIds` is built with `.filter(Boolean)`, so a dropped row with no id puts
  // `undefined` into `dropIds` — and `state.orders.filter((o) => !dropIds.has(o.id))` then removes
  // **every id-less order in the book**, on every day, for every customer.
  // ⭐ A search-and-destroy keyed on a value that can be absent destroys everything that carries
  // the absence.
  const rows = threeLines();
  // A legacy row with no id, inside the group being edited…
  rows.splice(1, 0, { groupId: "g1", deliveryDateId: "d10", deliveryDate: "2026-09-30",
    orderDate: "2026-09-20", productId: "p1", qty: 7, customerName: "Jien",
    whatsapp: "60123456789", status: "new" });
  // …and another, on another day, for someone else, that this pop-up cannot even see.
  rows.push({ groupId: "g2", deliveryDateId: "d11", deliveryDate: "2026-10-02",
    orderDate: "2026-09-19", productId: "p1", qty: 3, customerName: "Ravi",
    whatsapp: "60177777777", status: "confirmed" });
  const state = makeState(rows);
  assert.equal(state.orders.filter((o) => !o.id).length, 2, "the fixture holds two id-less rows");
  await editAndSave(state, { strip: 0 }); // remove the FIRST line, which does carry an id
  assert.equal(state.orders.filter((o) => !o.id).length, 2,
    "★ an order with no id was swept away by an edit that never named it — a drop keyed on an id that can be absent");
  assert.ok(!ids(state).includes("o20"), "the line she did remove is still there");
});
