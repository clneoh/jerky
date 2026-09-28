// test/parcel-order.test.js — recording a parcel on a courier order (v226).
//
// The second KIND of courier, driven through the real Edit pop-up: which carrier took
// it, whether it has been handed over, and the one line that names a product which
// probably should not go in a parcel network. The advisory is the point of the whole
// screen — it NAMES a line and never removes, hides or disables a control, because no
// app rule may block a sale she takes by hand (feedback_guide_not_gate).

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim (mirrors test/ingredients-editor.test.js, plus the layers the Orders
// --- screen reaches for: the pop-up layer, the confirm layer, history and a frozen
// --- clock so the delivery-day calendar is deterministic). ---
function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {}, _val: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    // Faithful on purpose, the same rule test/board-view.test.js:106 carries: the real
    // `replaceChildren` has NO null filter — `el()` does, a DOM method does not — it
    // converts every argument with String(), so a bare `?: null` left in a list prints
    // the literal word "null" on the screen. v226 shipped exactly that on the Parcel
    // couriers screen and a forgiving shim said it was clean, so this one is strict.
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) this.appendChild(c && c.nodeType ? c : { nodeType: 3, text: String(c) });
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 375, bottom: 812, width: 375, height: 812 }),
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
  Object.defineProperty(node, "value", {
    get() {
      // A real <select> reports whichever option is SELECTED, which is why a fresh
      // `select(options, value)` reads back correctly even though nothing set the
      // element's own value — the builder marks the option instead.
      if (node.tagName !== "SELECT") return node._val;
      const opts = walkAll(node).filter((n) => n.tagName === "OPTION");
      const sel = opts.find((o) => o.selected);
      return sel ? sel.value : "";
    },
    set(v) {
      node._val = String(v);
      // And setting it MOVES the selection, rather than layering a second source of
      // truth over a stale `selected` flag — a shim that let the two disagree would
      // read back the old choice after a change, which is how a real select never
      // behaves and exactly how it would hide a writer that never fired.
      if (node.tagName !== "SELECT") return;
      for (const o of walkAll(node).filter((n) => n.tagName === "OPTION")) {
        o.selected = String(o._val) === String(v);
      }
    },
  });
  return node;
}
function walkAll(root, out = []) {
  for (const c of root.children || []) { out.push(c); walkAll(c, out); }
  return out;
}

const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
let uuidSeq = 0;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: { randomUUID: () => `${String(++uuidSeq).padStart(12, "0")}-0000-4000-8000-000000000000` },
});
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 28, 10, 0, 0); }
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

const { renderOrders } = await import("../admin/js/views/orders.js");

// ── the world ──────────────────────────────────────────────────────────────

function freshState() {
  return {
    version: 1,
    settings: { currency: "RM", cutoff: "18:00", defaultCapacity: 12, deliveryDays: [1, 3, 5], supabase: {} },
    uoms: [],
    deliveryDates: [{ id: "d1", date: "2026-09-30" }],
    // One line that may travel as a parcel and one that may not — which is what makes
    // the advisory able to say anything at all.
    products: [
      { id: "prd_biscuit", name: "Almond biscuits", price: 18, active: true, unit: "pc", parcel: true },
      { id: "prd_focaccia", name: "Fresh Focaccia", price: 15, active: true, unit: "pc" },
    ],
    parcelCouriers: [
      { id: "pc_jt", name: "J&T Express" },
      { id: "pc_ninja", name: "Ninja Van" },
    ],
    ingredients: [], occasions: [], expenses: [], customers: [],
    orders: [{
      id: "ord_1", groupId: "g1", deliveryDateId: "d1", fulfillment: "courier",
      status: "paid", createdAt: "2026-09-20T02:00:00.000Z",
      address: "1 Jalan A", whatsapp: "+60 12-111 1111", customerName: "Ain",
      productId: "prd_biscuit", qty: 2, trackingNo: "",
    }],
  };
}

function render(state) {
  const root = createEl("div");
  root.__root = true;
  const teardown = renderOrders(root, state, new URLSearchParams({ date: "d1" }));
  return { root, teardown: typeof teardown === "function" ? teardown : () => {} };
}

const all = walkAll;
// The browser calls a listener with the element as `this`, so the shim does too — a
// listener written as an arrow still loses it, exactly as it does in a browser, which
// is the whole reason admin/js/ui.js has to hand the select to its own `onchange`.
const fire = (node) => (node._listeners.click || []).forEach((f) => f.call(node, { preventDefault() {}, target: node }));
const change = (node, value) => { node.value = value; (node._listeners.change || []).forEach((f) => f.call(node, { target: node })); };
const buttonByText = (root, text) => all(root)
  .find((n) => n.tagName === "BUTTON" && textOf(n).trim() === text);
function textOf(n) {
  if (!n) return "";
  if (n.nodeType === 3) return n.text ?? "";
  if (n.textContent) return n.textContent;
  return (n.children || []).map(textOf).join("");
}
const popup = () => registry["popup-layer"];

function openEdit(root) {
  const edit = buttonByText(all(root).find((n) => String(n.className).includes("li-main")) || root, "Edit")
    || buttonByText(root, "Edit");
  assert.ok(edit, "the order row offers Edit");
  fire(edit);
  return popup();
}

// The carrier picker: the one select offering "Not a parcel — nothing recorded".
function carrierSelect(root) {
  return all(root).find((n) => n.tagName === "SELECT"
    && all(n).some((o) => o.tagName === "OPTION" && /Not a parcel/.test(textOf(o))));
}
const advisoryIn = (root) => all(root).find((n) => String(n.className).includes("hint")
  && textOf(n).includes("Not marked as able to travel as a parcel"));

// ── the picker is offered, and the advisory only warns ─────────────────────

test("a courier order offers the carrier picker, and a line that may not travel is NAMED, not removed", () => {
  const state = freshState();
  state.orders[0].productId = "prd_focaccia"; // fresh bread: not parcel-able
  const { root } = render(state);
  const pop = openEdit(root);

  const sel = carrierSelect(pop);
  assert.ok(sel, "the Edit pop-up offers a carrier");
  const offered = all(sel).filter((n) => n.tagName === "OPTION").map((o) => textOf(o).trim());
  assert.ok(offered.includes("J&T Express") && offered.includes("Ninja Van"), "with every carrier she has");
  assert.equal(offered[0], "Not a parcel — nothing recorded", "and a way to record none");
  // Nothing is said before she has named a carrier — she is not sending anything yet,
  // and a line that fires on every courier order just to scold would be noise.
  assert.equal(advisoryIn(pop), undefined, "no advisory for an order that is not a parcel yet");

  // THE RULE: once she names a carrier the advisory names the line — and changes
  // nothing else. The picker is still enabled and the hand-over is still offered,
  // because no app rule may block a sale she takes by hand.
  change(sel, "pc_jt");
  const hint = advisoryIn(pop);
  assert.ok(hint, "the pop-up says which line is not marked");
  assert.match(textOf(hint), /Fresh Focaccia/);
  assert.match(textOf(hint), /You can still send it this way/);
  const sel2 = carrierSelect(pop);
  assert.equal(sel2.disabled, false, "and the picker is still there to use");
  assert.ok(buttonByText(pop, "Handed to the carrier"), "with the hand-over she came for");
  assert.ok(buttonByText(pop, "Save changes"), "and the Save she came for");
});

test("the advisory is what a chosen carrier ADDS — an order whose lines can all travel draws none", () => {
  const state = freshState(); // prd_biscuit is ticked parcel-able
  const { root } = render(state);
  const pop = openEdit(root);
  change(carrierSelect(pop), "pc_jt");
  assert.ok(carrierSelect(pop), "the picker is still offered");
  assert.equal(advisoryIn(pop), undefined, "nothing to warn about, so nothing is said");
  assert.ok(buttonByText(pop, "Handed to the carrier"), "and the rest of the section is exactly as it was");
});

// ── recording the parcel ───────────────────────────────────────────────────

test("choosing a carrier and saving records the parcel on the order, with the name frozen", () => {
  const state = freshState();
  const { root } = render(state);
  const pop = openEdit(root);

  const sel = carrierSelect(pop);
  change(sel, "pc_jt");
  assert.ok(buttonByText(pop, "Handed to the carrier"), "a press appears once a carrier is chosen");
  const tracking = all(pop).find((n) => n.tagName === "INPUT"
    && /JT123456789/.test(String(n.attrs.placeholder || "")));
  assert.ok(tracking, "and the consignment number goes in the box that is already there");
  tracking.value = "JT123456789";
  fire(buttonByText(pop, "Save changes"));

  const saved = state.orders[0];
  assert.deepEqual(saved.parcel, { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" });
  assert.equal(saved.trackingNo, "JT123456789", "the number rides the order's own tracking slot");
});

test("Handed to the carrier is what fills the hand-over moment, and it can be undone", () => {
  const state = freshState();
  const { root } = render(state);
  const pop = openEdit(root);
  change(carrierSelect(pop), "pc_jt");

  fire(buttonByText(pop, "Handed to the carrier"));
  assert.ok(buttonByText(pop, "Undo — not handed over yet"), "the press turns into its own undo");
  fire(buttonByText(pop, "Save changes"));
  assert.match(state.orders[0].parcel.handedAt, /^2026-09-28T/, "the moment is recorded");

  // And taking it back leaves the carrier on the order — only the moment goes.
  const pop2 = openEdit(root);
  change(carrierSelect(pop2), "pc_jt");
  fire(buttonByText(pop2, "Undo — not handed over yet"));
  fire(buttonByText(pop2, "Save changes"));
  assert.equal(state.orders[0].parcel.handedAt, "");
  assert.equal(state.orders[0].parcel.carrierId, "pc_jt", "the carrier is still recorded");
});

test("switching carrier forgets the hand-over, because a different carrier has not been handed it", () => {
  const state = freshState();
  const { root } = render(state);
  const pop = openEdit(root);
  change(carrierSelect(pop), "pc_jt");
  fire(buttonByText(pop, "Handed to the carrier"));
  fire(buttonByText(pop, "Save changes"));
  assert.ok(state.orders[0].parcel.handedAt, "handed to J&T");

  const pop2 = openEdit(root);
  const sel = carrierSelect(pop2);
  assert.equal(sel.value, "pc_jt", "the pop-up reopens on the carrier in force");
  change(sel, "pc_ninja");
  assert.equal(buttonByText(pop2, "Undo — not handed over yet"), undefined,
    "the moment is dropped the instant the carrier changes");
  fire(buttonByText(pop2, "Save changes"));
  assert.equal(state.orders[0].parcel.carrierName, "Ninja Van");
  assert.equal(state.orders[0].parcel.handedAt, "");
});

test("a group records the parcel on ONE row, and every other row of it is cleared", () => {
  // An order group reads as one thing, so the carrier is recorded once — on the first
  // row — rather than on each line, which is what the shared-field spread would do.
  const state = freshState();
  state.orders.push({ ...state.orders[0], id: "ord_2", productId: "prd_biscuit", qty: 1 });
  state.orders[0].parcel = { carrierId: "pc_ninja", carrierName: "Ninja Van", handedAt: "" };
  const { root } = render(state);
  const pop = openEdit(root);
  change(carrierSelect(pop), "pc_jt");
  fire(buttonByText(pop, "Save changes"));

  assert.equal(state.orders[0].parcel.carrierId, "pc_jt");
  assert.equal(state.orders[1].parcel, undefined,
    "the second line carries no parcel of its own — one group, one record");
});

test("choosing Not a parcel clears the record rather than leaving a stale one behind", () => {
  const state = freshState();
  state.orders[0].parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "2026-09-27T00:00:00.000Z" };
  state.orders[0].trackingNo = "JT123456789";
  const { root } = render(state);
  const pop = openEdit(root);

  assert.equal(carrierSelect(pop).value, "pc_jt", "it reopens on the record in force");
  change(carrierSelect(pop), "");
  fire(buttonByText(pop, "Save changes"));

  assert.equal(state.orders[0].parcel, undefined, "the record goes entirely");
  assert.equal(state.orders[0].trackingNo, "JT123456789",
    "and the consignment number she typed is left exactly where it is");
});

test("a carrier deleted from her list that an order still names is shown, not silently dropped", () => {
  const state = freshState();
  state.parcelCouriers = [{ id: "pc_ninja", name: "Ninja Van" }]; // J&T has been deleted
  state.orders[0].parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" };
  const { root } = render(state);
  const pop = openEdit(root);

  const offered = all(carrierSelect(pop)).filter((n) => n.tagName === "OPTION").map((o) => textOf(o).trim());
  assert.ok(offered.some((t) => /J&T Express \(deleted from your list\)/.test(t)),
    "the order's own carrier is offered back, labelled for what happened to it");
  assert.equal(carrierSelect(pop).value, "pc_jt", "and it is what the pop-up opens on");
});

test("the order row shows one quiet line once a parcel is recorded", () => {
  const state = freshState();
  state.orders[0].parcel = { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "2026-09-28T02:00:00.000Z" };
  state.orders[0].trackingNo = "JT123456789";
  const { root } = render(state);

  const line = all(root).find((n) => String(n.className).includes("li-sub") && textOf(n).includes("J&T Express"));
  assert.ok(line, "the row names the carrier");
  assert.match(textOf(line), /JT123456789/, "with the consignment number");
  assert.match(textOf(line), /handed over/, "and whether it is already with them");
});

test("a row with no parcel carries no parcel line at all", () => {
  const { root } = render(freshState());
  assert.equal(all(root).some((n) => String(n.className).includes("li-sub") && textOf(n).includes("📦")), false,
    "an order that is not a parcel is drawn exactly as it was before any of this existed");
});

// ── the note / tracking pop-up is the same door ────────────────────────────

test("the Note / tracking pop-up records a parcel the same way, because the two rows look alike", () => {
  // Both pop-ups carry an identical "Courier tracking number (optional)" box, and two
  // rows that look alike must behave alike (feedback_affordances). One shared builder
  // and one shared writer is what keeps them from drifting apart.
  const state = freshState();
  const { root } = render(state);
  const note = buttonByText(root, "Note / tracking");
  assert.ok(note, "the row offers Note / tracking beside Edit");
  fire(note);
  const pop = popup();

  const sel = carrierSelect(pop);
  assert.ok(sel, "the same carrier picker is here");
  change(sel, "pc_jt");
  fire(buttonByText(pop, "Handed to the carrier"));
  fire(buttonByText(pop, "Save"));

  assert.deepEqual(state.orders[0].parcel,
    { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: state.orders[0].parcel.handedAt });
  assert.ok(state.orders[0].parcel.handedAt, "recorded from this door just as from Edit");
});
