// test/order-address-suggest.test.js — v228: the delivery address box offers what she
// might be typing, from Google, and a tap fills the whole address in.
//
// Both forms are module-private (orderForm / popupEditBody), so this drives them through
// renderOrders and the pop-up layer, exactly as customer-suggest.test.js does.
//
// IT DRIVES THE REAL CHANNEL, NOT A STUB OF IT. The wire below answers the same POST
// `callCourier` would make, so `suggestAddresses`, the request shape and the reply
// reading are all exercised — only the two ends that need a real server (the Google key
// and the owner's session) are stood in for. "Now" is frozen at Thu 10 Sep 2026.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    // Faithful on purpose, the same rule customer-suggest.test.js carries: the real
    // `append` and `replaceChildren` have NO null filter and convert every argument with
    // String(), so a bare `?: null` left in a list prints the literal word "null". v226
    // shipped exactly that behind a forgiving shim, so this one does not quietly drop it.
    append(...cs) { for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) }); },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) });
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
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
globalThis.history = { replaceState() {} };

// The phone's storage, carrying a signed-in session. Only the TOKEN matters to the
// channel; the Shared-data settings below deliberately stop short of a working sync
// config, so nothing but the address suggester reaches for the wire.
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
globalThis.localStorage.setItem("bakeadmin.supabase", JSON.stringify({
  access_token: "test-token-not-real", expires_at: 4102444800000,
}));

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

// ── the wire ───────────────────────────────────────────────────────────────
//
// Every autocomplete ask is HELD rather than answered, so a test can decide what lands
// and in which order — which is the only way to drive "a stale answer" and "an answer
// after a tap" honestly. Any other action (there should be none, since sync is off)
// answers with a plain ok.
//
// `drain()` exists so no test leaves a held promise behind: an unanswered ask would leave
// callCourier's own 8s abort timer running, and the suite would sit on it.
function stubWire() {
  const real = globalThis.fetch;
  const asks = [];    // every autocomplete query, in order
  const pending = []; // { query, resolve }
  globalThis.fetch = async (url, opts = {}) => {
    const body = JSON.parse(String(opts.body || "{}"));
    if (body.action !== "autocomplete") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    asks.push(String(body.payload.query));
    return new Promise((resolve) => { pending.push({ query: String(body.payload.query), resolve }); });
  };
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  return {
    asks, pending,
    // Answer the ask at `i` (0 = the oldest still waiting) with these suggestion rows.
    settle(i, texts) {
      const [p] = pending.splice(i, 1);
      p.resolve(reply({ ok: true, places: texts.map((t, n) => ({ text: t, placeId: `ChIJ${n}` })) }));
    },
    // Answer it the way a server that could not help would.
    refuse(i, reason = "The address suggester could not be reached.") {
      const [p] = pending.splice(i, 1);
      p.resolve(reply({ ok: false, reason }));
    },
    drain() { while (pending.length) pending.pop().resolve(reply({ ok: true, places: [] })); },
    restore() { globalThis.fetch = real; },
  };
}

async function withWire(fn) {
  const wire = stubWire();
  try { return await fn(wire); } finally { wire.drain(); wire.restore(); }
}

// ── the app ────────────────────────────────────────────────────────────────

function state() {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-10" }, { id: "d20", date: "2026-09-20" }],
    products: [{ id: "p1", name: "Focaccia", price: 18, limit: 50, active: true, recipe: [], unit: "pc" }],
    orders: [
      { id: "o1", deliveryDateId: "d10", deliveryDate: "2026-09-10", orderDate: "2026-09-01",
        productId: "p1", qty: 2, customerName: "Aunty Bee", whatsapp: "012-345 6789",
        address: "9 Jalan Lama, Penang" },
    ],
    ingredients: [],
    occasions: [],
    // A URL and nothing else: `courierFunctionUrl` needs it, and `ready()` needs the rest
    // — so the courier channel is open while every sync path stays asleep.
    settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM",
      supabase: { url: "https://demo-project.supabase.co" } },
  };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
// Found by its PLACEHOLDER, not its label: this app words the box
// "Postal address (for posting)" where the bakery says "Delivery address (if courier)".
const ADDRESS_BOX = "Postal address (for posting)";
const addrBox = (root) => all(root).find((n) => n.tagName === "INPUT" && n.attrs.placeholder === ADDRESS_BOX);
// `.sugg-panel` is a shared style worn by the customer list too, so the marker is what
// names THIS one.
const addressPanel = (root) => all(root).find((n) => n.attrs && n.attrs["data-sugg"] === "address");
const offered = (root) => (addressPanel(root) ? addressPanel(root).children : []);
const screenText = (root) => all(root).map((n) => (n.nodeType === 3 ? n.text : n.textContent)).join("");
const type = (box, text) => {
  box.value = text;
  (box._listeners.input || []).forEach((f) => f.call(box));
};
const tap = (node) => (node._listeners.click || []).forEach((f) => f.call(node));

// Longer than the suggester's own 400 ms pause, so a test that waits here is waiting for
// the debounce to expire and nothing else.
const afterPause = () => new Promise((r) => setTimeout(r, 500));

function openNewCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  return root;
}

function openEdit(st, orderId) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  const row = all(root).find((n) => n.dataset && n.dataset.order === orderId);
  tap(buttonByText(row, "Edit"));
  return root;
}

const pickProduct = (root) => {
  const sel = all(root).find((n) => n.tagName === "SELECT" && n.children.some((o) => o.value === "p1"));
  sel.value = "p1";
  (sel._listeners.change || []).forEach((f) => f.call(sel));
};

// ── the pause, the floor, and one ask per burst ─────────────────────────────

test("nothing is asked until she stops typing, and a burst of keystrokes is one ask", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    const box = addrBox(root);

    // Four keystrokes in a row, faster than the pause: a real typist, not a metronome.
    type(box, "12 J");
    type(box, "12 Ja");
    type(box, "12 Jal");
    type(box, "12 Jalan");
    assert.equal(wire.asks.length, 0, "nothing goes out while she is still typing");

    await afterPause();
    assert.deepEqual(wire.asks, ["12 Jalan"], "one ask, for what she settled on");
  });
});

test("three characters is not a search, and asks nobody", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    type(addrBox(root), "12 ");
    await afterPause();
    assert.equal(wire.asks.length, 0, "a house number alone matches half a town");
    assert.equal(offered(root).length, 0);

    // And the same words, typed more fully, do ask — the box is not wedged.
    type(addrBox(root), "12 Jalan");
    await afterPause();
    assert.deepEqual(wire.asks, ["12 Jalan"]);
  });
});

// ── what she taps ──────────────────────────────────────────────────────────

test("a tap puts the whole address in the box and closes the list", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();

    wire.settle(0, ["12, Jalan Bunga, Taman Sejahtera, 11200 George Town, Pulau Pinang, Malaysia",
      "12, Jalan Bungee, 10450 George Town, Pulau Pinang, Malaysia"]);
    await afterPause();

    const rows = offered(root);
    assert.equal(rows.length, 2, "both of Google's answers are offered");
    assert.equal(rows[0].textContent,
      "12, Jalan Bunga, Taman Sejahtera, 11200 George Town, Pulau Pinang, Malaysia",
      "with the words to read and nothing else");

    tap(rows[0]);
    assert.equal(addrBox(root).value,
      "12, Jalan Bunga, Taman Sejahtera, 11200 George Town, Pulau Pinang, Malaysia",
      "the box becomes the address she picked — the tap IS the instruction");
    assert.equal(offered(root).length, 0, "and the list closes on a pick");
  });
});

test("the picked address is what the order is saved with", async () => {
  const st = state();
  await withWire(async (wire) => {
    const root = openNewCard(st);
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Pulau Pinang, Malaysia"]);
    await afterPause();

    tap(offered(root)[0]);
    pickProduct(root);
    tap(buttonByText(root, "Add order"));

    const added = st.orders.find((o) => o.id !== "o1");
    assert.ok(added, "the order landed");
    assert.equal(added.address, "12, Jalan Bunga, 11200 George Town, Pulau Pinang, Malaysia");
  });
});

test("a tap on the Edit pop-up's own list fills that box, and Save writes it onto the order", async () => {
  const st = state();
  await withWire(async (wire) => {
    const root = openEdit(st, "o1");
    const pop = layers["popup-layer"];

    type(addrBox(pop), "12 Jalan Bunga");
    await afterPause();
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Pulau Pinang, Malaysia"]);
    await afterPause();
    tap(offered(pop)[0]);

    assert.equal(addrBox(pop).value, "12, Jalan Bunga, 11200 George Town, Pulau Pinang, Malaysia");
    tap(buttonByText(pop, "Save changes"));
    assert.equal(st.orders.find((o) => o.id === "o1").address,
      "12, Jalan Bunga, 11200 George Town, Pulau Pinang, Malaysia",
      "the address she chose is the one the order carries");
    return root;
  });
});

// ── an answer that arrives too late ────────────────────────────────────────

test("an answer that lands after she has typed on is discarded, not painted", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());

    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    type(addrBox(root), "12 Jalan Bunga Lane"); // she carried on
    await afterPause();
    assert.equal(wire.asks.length, 2, "two asks went out — she asked two different things");

    // The FIRST one answers now, for words she has already moved past.
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Malaysia"]);
    await afterPause();
    assert.equal(offered(root).length, 0, "a superseded answer must not put a list under her thumb");

    wire.settle(0, ["12, Jalan Bunga Lane, 11200 George Town, Malaysia"]);
    await afterPause();
    assert.equal(offered(root).length, 1, "and the answer she IS waiting for still arrives");
    assert.match(offered(root)[0].textContent, /Jalan Bunga Lane/);
  });
});

test("an answer that lands after a tap does not put the list back", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());

    type(addrBox(root), "12 Jalan Bunga");       // the ask she moves past
    await afterPause();
    type(addrBox(root), "12 Jalan Bunga Lane");  // the ask she is waiting for
    await afterPause();
    assert.equal(wire.pending.length, 2, "both asks are still in the air");

    // The words she is actually waiting for answer first, and she taps one.
    wire.settle(1, ["12, Jalan Bunga Lane, 11200 George Town, Malaysia"]);
    await afterPause();
    tap(offered(root)[0]);
    const picked = addrBox(root).value;
    assert.equal(offered(root).length, 0, "the list closes on the pick");

    // NOW the superseded ask answers — for words she typed BEFORE the ones she tapped.
    // Ungated, this is what repaints a list under her thumb after she has chosen.
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Malaysia", "12, Jalan Bungee, Malaysia"]);
    await afterPause();
    assert.equal(offered(root).length, 0, "an answer landing after a tap must not reopen the list");
    assert.equal(addrBox(root).value, picked, "nor touch the address she has chosen");
  });
});

test("re-typing the words she already paused on costs no second ask", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Malaysia"]);
    await afterPause();

    // A rebuild re-fires nothing, but a keystroke does: the same words are already
    // answered, so the ask count must not move.
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    assert.equal(wire.asks.length, 1, "the one-slot cache answered for her");
    assert.equal(offered(root).length, 1, "and the list she already had is still there");
  });
});

test("a list for words she has deleted does not appear", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();

    // She thinks better of it and rubs the box back down to a house number — which is
    // under the floor, so it is not a query, and the list must simply go.
    type(addrBox(root), "12 ");
    await afterPause();

    // The ask for the long words answers now. She stopped asking it two keystrokes ago,
    // and a list for words that are no longer in the box is a list she never asked for.
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Malaysia"]);
    await afterPause();
    assert.equal(offered(root).length, 0, "nothing appears for words she has deleted");
  });
});

// ── when nothing works, nothing breaks ─────────────────────────────────────

test("a suggester that cannot answer shows nothing at all, and says nothing", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    wire.refuse(0);
    await afterPause();

    assert.equal(offered(root).length, 0, "no list");
    assert.equal(/undefined|null|\[object/.test(screenText(root)), false,
      "and no stray word where the list would have been");
  });
});

test("with the suggestion server unreachable, the order still saves with her own typing", async () => {
  const st = state();
  const real = globalThis.fetch;
  // Not a slow server: a wire that fails outright, which is what a phone with no signal
  // looks like to this code.
  globalThis.fetch = async () => { throw new Error("Failed to fetch"); };
  try {
    const root = openNewCard(st);
    type(addrBox(root), "7 Jalan Saya Sendiri");
    await afterPause();
    assert.equal(offered(root).length, 0);

    pickProduct(root);
    tap(buttonByText(root, "Add order"));

    const added = st.orders.find((o) => o.id !== "o1");
    assert.ok(added, "the order landed with no suggester at all");
    assert.equal(added.address, "7 Jalan Saya Sendiri",
      "carrying the address she typed by hand — nothing here is gated on the network");
  } finally { globalThis.fetch = real; }
});

test("a phone with no Shared data at all simply does not suggest", async () => {
  const st = state();
  st.settings.supabase = null; // never set up
  await withWire(async (wire) => {
    const root = openNewCard(st);
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    assert.equal(wire.asks.length, 0, "there is nothing to ask the suggester from");
    assert.equal(offered(root).length, 0);

    pickProduct(root);
    tap(buttonByText(root, "Add order"));
    assert.equal(st.orders.find((o) => o.id !== "o1").address, "12 Jalan Bunga",
      "and her typing is still what the order carries");
  });
});

// ── the draft stays a draft ────────────────────────────────────────────────

test("nothing the suggester needs is parked on the draft, so nothing lands on her orders", async () => {
  const st = state();
  await withWire(async (wire) => {
    const root = openEdit(st, "o1");
    const pop = layers["popup-layer"];

    type(addrBox(pop), "12 Jalan Bunga");
    await afterPause();
    wire.settle(0, ["12, Jalan Bunga, 11200 George Town, Malaysia"]);
    await afterPause();
    tap(offered(pop)[0]);
    tap(buttonByText(pop, "Save changes"));

    const saved = st.orders.find((o) => o.id === "o1");
    // `applyPopupEdits` Object.assigns the draft onto the order row, so a controller, a
    // generation counter or a panel parked on the draft would be SAVED as a field of the
    // order. The module-level counter exists so that cannot happen; this is the guard.
    const stray = Object.keys(saved).filter((k) => /gen|timer|asked|panel|sugg|abort/i.test(k));
    assert.deepEqual(stray, [], `the order carries no suggestion state, but has ${stray.join(", ")}`);
    assert.equal(saved.address, "12, Jalan Bunga, 11200 George Town, Malaysia");
    return root;
  });
});
