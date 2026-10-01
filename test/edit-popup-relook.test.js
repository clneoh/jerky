// test/edit-popup-relook.test.js — pressing the door block's own press inside the EDIT
// pop-up must not throw the pop-up away.
//
// Her report, and it is the first one of this family that is about the Edit card rather
// than the ＋ New order card:
//
//   "when i edit order, go in and press look this address up again, it exit the page and
//    go into the order list and without allowing me to get a price from lalamove"
//
// THE FAULT IS A NAME, NOT A RULE. `popupEditBody` declares its own `const save` (the
// "Save changes" button) at the top of its body. The module also imports the STORE's
// `save` from state.js. A function-scoped `const` shadows a module import for the whole
// body, so the line inside `courierQuoteSection`'s `onCommit` that reads `save(state)` —
// written to persist the tracking link a booking wrote onto the order — was never
// calling the store at all. It was pressing the pop-up's own Save:
//
//     applyPopupEdits(...)  →  writes the order  →  toast("Order updated")  →  close()
//
// So the reset succeeded, the card closed itself, and `renderAll` dropped her on the
// Orders list with no price asked. That is also why she once described it as the press
// that "make the page exit with order updated" — "Order updated" is that toast.
//
// The ＋ New order card passes NO `onCommit` at all (price-only mode), which is why five
// releases of fixing that card never touched this one.
//
// Everything here is driven through renderOrders and the real modules: the screen is
// rendered for real, the Edit pop-up is opened by pressing the row's own Edit button,
// the door's own press is pressed, and the only thing stubbed is the network. "Now" is
// frozen at Thu 10 Sep 2026.

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
    // A REAL DOM detaches the children it drops, and the courier price panel decides
    // whether its one-second clock keeps running by asking its own node `wrap.isConnected`
    // — a shim that left a dropped child pointing at this parent would keep a timer alive
    // and the run would sit until the test timeout instead of failing.
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
  constructor(...args) { if (args.length) super(...args); else super(2026, 8, 10, 10, 0, 0); } // Thu 10 Sep 2026
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

// The pop-up layer has to be ON the page before anything opens one — the courier panel
// refuses to work while it is not connected, and a card held in mid-air would make every
// assertion below pass over a screen that never drew.
doc.body.append(doc.getElementById("popup-layer"));

const { renderOrders } = await import("../admin/js/views/orders.js");

// THE ONE THING STUBBED IS THE NETWORK. The geocode answer is deliberately a DIFFERENT
// point from the customer's pin, so the reset really moves the door and the press can be
// seen to have done its job rather than to have silently stopped.
function stubChannel() {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("/functions/v1/courier")) {
      const said = JSON.parse(opts.body || "{}");
      asked.push(said.action);
      const body = said.action === "geocode"
        ? { ok: true, place: { lat: 5.43, lng: 100.34, label: "12 Jalan Bunga" } }
        : { ok: true, services: [], quotes: [], failed: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  };
  return { asked, restore() { globalThis.fetch = real; } };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const press = (btn) => btn._listeners.click[0]();
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1)); };

// An order the customer pinned themselves, on a courier delivery with an address — the
// state in which the door's press is offered AND the press is the one that asks first.
function makeState() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-30" }],
    products: [{ id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" }],
    orders: [{
      id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2, price: 22,
      customerName: "Mei Ling", whatsapp: "60123456789", fulfillment: "courier",
      address: "12 Jalan Bunga, 10450 Penang", orderDate: "2026-09-25",
      status: "baking",
      customerPlace: { lat: 5.42, lng: 100.33 },
    }],
    ingredients: [], occasions: [], customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4],
      supabase: { url: "https://demo.supabase.co" },
      storefront: { name: "Munchies Furkidz", whatsapp: "016 960 1268" },
      pickupPlace: { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" },
    },
  };
}

// Walk to the press exactly as she does: the Orders screen for real, the row's own Edit
// button, then the door block's own press inside the pop-up. Where the press asks first,
// the confirmation is answered — that is her second tap, not a shortcut past one.
async function openEditAndPress(state) {
  const s = stubChannel();
  const root = createEl("div");
  const popup = layers["popup-layer"];
  try {
    store.set("bakeadmin.supabase",
      JSON.stringify({ access_token: "t", expires_at: Date.now() + 3_600_000 }));
    renderOrders(root, state, new URLSearchParams({ date: "d10" }));
    const edit = buttonByText(root, "Edit");
    assert.ok(edit, "the row drew its own Edit button");
    press(edit);

    const look = buttonByText(popup, "Look this address up again")
      || buttonByText(popup, "Reset the pin from the address");
    assert.ok(look, "the door block drew its own press inside the Edit pop-up");
    assert.equal(look.hidden, false, "the press is offered — there is a door and an address");
    press(look);

    // The confirmation is the press's own question (the door here is the customer's pin),
    // so answering it is the same two taps she makes.
    const yes = buttonByText(layers["confirm-layer"], "Reset the pin");
    if (yes) press(yes);
    await settle();
  } finally {
    s.restore();
  }
  return { root, popup, asked: s.asked };
}

test("a reset inside the Edit pop-up leaves the Edit pop-up open (the press must not close it)", async () => {
  const state = makeState();
  const { popup, asked } = await openEditAndPress(state);

  // The press really ran: a check that never reaches the branch cannot clear it. Without
  // this the whole test could pass over a card that never drew a door block.
  assert.ok(asked.includes("geocode"),
    `the press really asked the geocoder (${asked.join(", ")})`);

  assert.equal(popup.hidden, false,
    "the Edit pop-up was closed by the door's own press — she is dropped on the Orders list");
  assert.ok(buttonByText(popup, "Save changes"),
    "the Edit form is still there to carry on with, including the price press");
});

test("the reset still writes the door it found — the press is not made silent to stop the exit", async () => {
  const state = makeState();
  await openEditAndPress(state);
  // The door is the customer's pin, so the reset is a fresh look-up of the address; it has
  // to have landed, or "the pop-up stayed open" would be satisfied by a press that did
  // nothing at all.
  const { doorSpotOf } = await import("../admin/js/courier_place.js");
  const spot = doorSpotOf(state, state.orders[0]);
  assert.equal(spot.lat, 5.43, "the looked-up point is the door now");
  assert.equal(spot.lng, 100.34, "and it is the whole point, not the latitude alone");
});
