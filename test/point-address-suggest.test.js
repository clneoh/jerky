// test/point-address-suggest.test.js — v303: the SELF COLLECTION POINT's own address box
// offers what she might be typing, from Google, and a tap fills the whole address in.
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

const { renderPoints } = await import("../admin/js/views/points.js");

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
// The field wrapper the box sits in, so its grid span can be asserted. The shim carries no
// parentNode, so this walks down to it rather than up.
const fieldOf = (node, box) => {
  for (const c of node.children || []) {
    if (c === box) return node;
    const found = fieldOf(c, box);
    if (found) return found;
  }
  return null;
};
// The address is the longest field in the form, so it takes BOTH grid columns (v230).
// One column of the two-column grid is 137px on a phone, with an empty cell beside it.
const spansBoth = (root, box) => String(fieldOf(root, box).className).includes("span2");
// Is this box a cell of the card's two-column grid? The ＋ New order card's address is not
// (v237): it moved into the courier block, where every field is full width.
const inGrid = (root, box) => {
  const grid = all(root).find((n) => String(n.className).includes("form-grid"));
  return !!grid && all(grid).includes(box);
};
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

// The ＋ New order card holds the delivery address inside its courier half, which unfolds
// only when Fulfillment says Courier delivery (v237). Every address assertion therefore
// goes through here, so all of them stay about the address and none about the gate.




// ── the pause, the floor, and one ask per burst ─────────────────────────────

// ── v303: the SELF COLLECTION POINT's own address box ───────────────────────
//
// HER QUESTION, mid-build: "there is no address auto complete for collection point?" She was
// right, and then she said the sharper half — "why not make the point consistent with the
// customer card?" So the suggester that was written inside views/orders.js for the order's
// delivery address is now a shared module, and BOTH boxes are driven by the same wire in this
// one file. A Point's address is what a driver is sent to and what its pin is looked up from,
// so a correctly typed postcode matters here at least as much as on an order.
//
// The bottom half of that consistency is the promise the shared helper carries: NOTHING HERE
// BLOCKS A SAVE. A failed ask shows nothing at all, and the box keeps every word she typed.

const POINT_ADDR_PH = "Where it is, for the driver — a street, a shop name, a landmark";
const pointAddrBox = (root) => all(root)
  .find((n) => n.tagName === "TEXTAREA" && n.attrs.placeholder === POINT_ADDR_PH);
// The same Supabase URL the order suite's own state carries: the courier channel needs it to
// open at all, while `ready()` needs the rest — so the suggest wire is live and every sync path
// stays asleep. A settings object without it makes `suggestAddresses` return early, and the ask
// then never leaves — which is exactly how this test first failed.
const pointState = (points = []) => ({ points, orders: [], products: [], deliveryDates: [],
  settings: { cutoff: "18:00", defaultCapacity: 50, currency: "RM",
    supabase: { url: "https://demo-project.supabase.co" } } });
function openPoints(points = []) {
  const root = createEl("div");
  renderPoints(root, pointState(points));
  return root;
}
const POINT = {
  id: "pt_a", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik", receiver: "Aunty Lim",
  phone: "60123456789", feeRM: 0.5, paused: false, createdAt: "2026-08-12T00:00:00.000Z",
};

test("the New Point card's address box asks Google as she types, and a tap fills it in (v303)", async () => {
  await withWire(async (wire) => {
    const root = openPoints();
    const box = pointAddrBox(root);
    assert.ok(box, "the New Point card has an address box");

    // Below the helper's own floor, so nothing is asked and nothing is offered.
    type(box, "Leb");
    await afterPause();
    assert.equal(wire.asks.length, 0, "three characters is not enough to ask Google with");
    assert.equal(offered(root).length, 0, "and nothing is offered");

    type(box, "Lebuhraya Thean Teik");
    await afterPause();
    assert.deepEqual(wire.asks, ["Lebuhraya Thean Teik"], "one ask, after she stopped typing");

    wire.settle(0, ["Lebuhraya Thean Teik, 11500 Air Itam, Penang",
      "Lebuhraya Thean Teik 4, 11500 Air Itam, Penang"]);
    await afterPause();
    const rows = offered(root);
    assert.equal(rows.length, 2, "both suggestions are offered under the box");
    assert.ok(rows[0].textContent.includes("11500 Air Itam"), "with the postcode, which is the point");

    tap(rows[0]);
    assert.equal(box.value, "Lebuhraya Thean Teik, 11500 Air Itam, Penang",
      "the tap REPLACES the box with the address she picked");
    assert.equal(offered(root).length, 0, "and the list closes behind it");
  });
});

test("the Edit Point card's address box behaves the same way (v303)", async () => {
  await withWire(async (wire) => {
    const root = openPoints([POINT]);
    tap(buttonByText(root, "Edit"));
    const pop = layers["popup-layer"] || document.getElementById("popup-layer");
    const box = pointAddrBox(pop);
    assert.ok(box, "the Edit card has the same box");
    assert.equal(box.value, "Lebuhraya Thean Teik", "opened on what the Point already holds");

    type(box, "Jalan Baru Bukit Mertajam");
    await afterPause();
    wire.settle(0, ["Jalan Baru, 14000 Bukit Mertajam, Penang"]);
    await afterPause();
    tap(offered(pop)[0]);
    assert.equal(box.value, "Jalan Baru, 14000 Bukit Mertajam, Penang",
      "and a tap fills it here too — one helper, so the two boxes cannot drift apart");
  });
});

test("a Point saves the words she typed whatever the lookup does (v303)", async () => {
  // The load-bearing property the shared helper has carried since v228, now on this box too,
  // and the one that matters most here: a Point she cannot save because Google is unreachable
  // would be a website rule standing between her and her own list.
  await withWire(async (wire) => {
    const st = pointState();
    const root = createEl("div");
    renderPoints(root, st);
    const box = pointAddrBox(root);
    type(box, "Kedai Ah Seng, Jalan Baru");
    await afterPause();
    wire.refuse(0, "The address suggester could not be reached.");
    await afterPause();

    assert.equal(offered(root).length, 0, "a failed ask shows nothing rather than an error");
    assert.equal(box.value, "Kedai Ah Seng, Jalan Baru", "and her own words are untouched");

    type(all(root).find((n) => n.tagName === "INPUT" && n.attrs.placeholder === "e.g. Farlim, Air Itam"),
      "Chai Leng Park, Prai");
    tap(buttonByText(root, "Add Point"));
    assert.equal(st.points.length, 1, "the Point was saved");
    assert.equal(st.points[0].address, "Kedai Ah Seng, Jalan Baru",
      "carrying the address she typed, with the lookup having failed");
  });
});
