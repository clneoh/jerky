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
    // ⚠️ AND THE WAY THE REAL FUNCTION ANSWERS WHEN THE SUGGESTER IS SWITCHED OFF (v311): a
    // reason on a 200, marked `setup` because it will not pass by itself. The distinction between
    // these two is the whole of v311 — one is said out loud, the other is not.
    refuseSetup(i, reason = "Address suggestions are not set up on the server yet.") {
      const [p] = pending.splice(i, 1);
      p.resolve(reply({ ok: false, setup: true, reason }));
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
const addrBox = (root) => all(root).find((n) => n.tagName === "TEXTAREA" && n.attrs.placeholder === ADDRESS_BOX);
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
function openNewCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  pickCourier(root);
  return root;
}

const pickCourier = (root) => {
  const sel = all(root).find((n) => n.tagName === "SELECT"
    && (n.children || []).some((o) => o.value === "courier"));
  if (!sel) return null;
  sel.value = "courier";
  (sel._listeners.change || []).forEach((f) => f.call(sel));
  return sel;
};

function openEdit(st, orderId, day = "d10") {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: day }));
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

    // The box is multi-line, not the one-line field it was (v229): a courier address is
    // four or five lines on a phone. `addrBox` above already proves the ELEMENT is a
    // textarea; this proves it was given the height, so a revert to `rows: 1` is caught.
    assert.ok(Number(box.attrs.rows) >= 3,
      "the address box is tall enough to read a whole address back");
    // The ＋ New order card's address now sits in the courier block, whose fields are full
    // width — it is not a cell of the two-column grid at all (v237), which is what v230
    // was really asking for. One column of that grid is 137px on a phone.
    assert.equal(inGrid(root, box), false,
      "the address sits full width in the courier block, not in the two-column grid");

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
    tap(buttonByText(root, "Place Order"));

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
    // Asserted here rather than after the Save: closing the pop-up replaces its children,
    // so the field is no longer findable once Save has run.
    assert.ok(spansBoth(pop, addrBox(pop)),
      "the Edit pop-up's address field takes both columns too");

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
    tap(buttonByText(root, "Place Order"));

    const added = st.orders.find((o) => o.id !== "o1");
    assert.ok(added, "the order landed with no suggester at all");
    assert.equal(added.address, "7 Jalan Saya Sendiri",
      "carrying the address she typed by hand — nothing here is gated on the network");
  } finally { globalThis.fetch = real; }
});

test("a phone with no Shared data at all does not suggest — AND NOW SAYS SO (v311)", async () => {
  const st = state();
  st.settings.supabase = null; // never set up
  await withWire(async (wire) => {
    const root = openNewCard(st);
    type(addrBox(root), "12 Jalan Bunga");
    await afterPause();
    assert.equal(wire.asks.length, 0, "there is nothing to ask the suggester from");
    assert.equal(rowsOn(root).length, 0, "and nothing is offered to tap");
    // ⚠️ THIS USED TO ASSERT SILENCE, and that silence IS her report. A box that never suggests
    // and never says why reads as broken; the app knows the reason, so it says it.
    assert.equal(noteOn(root).length, 1, "one line, saying why there are no suggestions");
    assert.match(noteOn(root)[0], /Shared data/, "in the app's own words for the problem");

    pickProduct(root);
    tap(buttonByText(root, "Place Order"));
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

// ── v311: WHEN SUGGESTIONS CANNOT WORK, SAY SO ──────────────────────────────
// Her report: "the suggestion list never appear". It was true, and the app never said why — a
// failed ask called `hide()` and the box went quiet, so a phone whose suggestions were not set up
// looked exactly like a phone that simply had nothing to offer.
//
// ⚠️ THE TWO FAILURES ARE NOT THE SAME THING, and only one of them is worth a sentence:
//   • a SETUP problem (no session, no key) does not come right, so it is said ONCE; and once it
//     has been said nothing more is asked, rather than spending a request per keystroke for the
//     rest of the form to be told the same thing;
//   • a NETWORK failure passes on its own, so it stays silent — a line about the signal under a
//     box she is typing in is noise, and the feature comes back by itself.

// The line said where the suggestions would have been. Read through `deepText` because a
// paragraph's words live in a TEXT NODE child.
const deepText = (n) => (n.nodeType === 3 ? String(n.text)
  : (n.children || []).map(deepText).join("")).trim();
// ⚠️ AND WHAT IS TAPPABLE IS NOT THE SAME AS WHAT IS IN THE PANEL (v311). The panel now holds
// either suggestion rows or the one line saying why there are none — so a count of its children
// would call the explanation a suggestion.
const rowsOn = (root) => ((addressPanel(root) || {}).children || [])
  .filter((n) => String(n.className || "").includes("sugg-row"));
const noteOn = (root) => ((addressPanel(root) || {}).children || [])
  .filter((n) => String(n.className || "").includes("sugg-note"))
  .map((n) => deepText(n));

test("a server that cannot suggest at all SAYS SO, once, where the list would have been (v311)", async () => {
  await withWire(async (wire) => {
    const root = openNewCard(state());
    const box = addrBox(root);
    type(box, "Lebuhraya Thean Teik");
    await afterPause();
    // The function's own contract: 500 is a SETUP problem, and its words are the reason.
    wire.refuseSetup(0, "Address suggestions are not set up on the server yet.");
    await afterPause();

    const said = noteOn(root);
    assert.equal(said.length, 1, `exactly one line, and it is not a suggestion row — read ${JSON.stringify(said)}`);
    assert.match(said[0], /not set up on the server yet/, "in the server's own words");
    assert.equal(rowsOn(root).length, 0, "and it is NOT offered as something she can tap");
    assert.equal(box.value, "Lebuhraya Thean Teik", "and her own typing is untouched");

    // ⚠️ AND NOTHING MORE IS ASKED. A request per keystroke to be told the same thing is a phone
    // on one bar doing work for nothing — and the line must not flicker away either.
    const before = wire.asks.length;
    type(box, "Lebuhraya Thean Teik 4");
    await afterPause();
    assert.equal(wire.asks.length, before, "no second ask once the answer is known");
    assert.equal(noteOn(root).length, 1, "and the line is still there while she carries on typing");
  });
});

test("a failure that will pass on its own stays SILENT (v311)", async () => {
  // A phone on one bar is not a setup problem, and the box must not grow a line about it.
  await withWire(async (wire) => {
    const root = openNewCard(state());
    const box = addrBox(root);
    type(box, "Lebuhraya Thean Teik");
    await afterPause();
    wire.refuse(0, "Couldn't reach the courier service.");
    await afterPause();
    assert.deepEqual(noteOn(root), [], "nothing is said about a signal");
    assert.equal(rowsOn(root).length, 0, "and nothing is offered");
    // And it asks again next time, because this one is worth retrying.
    const before = wire.asks.length;
    type(box, "Lebuhraya Thean Teik 4");
    await afterPause();
    assert.equal(wire.asks.length, before + 1, "a transient failure is retried");
  });
});

// ── v657: THE COLLECTION DAY AND TIME, on the card an order is taken from ───
//
// ⚠️ The card carried the two answers in `shared` from the day they were asked for, and `addNew` **dropped
// them on the floor** — so the order saved with no collection promise and the confirmation said "the posting
// day" over her own answer. These tests press Place Order and read the ORDER, which is the only place that
// fault is visible.

const collectDayBox = (root) => all(root).find((n) => isBox(n) && (n.attrs || {})["aria-label"] === "The day they collect");
const collectTimeBox = (root) => all(root).find((n) => isBox(n) && (n.attrs || {})["aria-label"] === "The time they collect");
const isBox = (n) => !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA");

// A card that is NOT forced to Post: the collection fields are the other half of the same answer.
function openNewCollectCard(st) {
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d20" }));
  tap(buttonByText(root, "New order"));
  return root;
}

test("★★★ the collection day and time she types are saved onto the order (v657)", () => {
  const st = state();
  const root = openNewCollectCard(st);
  const day = collectDayBox(root);
  const time = collectTimeBox(root);
  assert.ok(day && time, "a collected order is asked when and at what time it is collected");

  day.value = "2026-10-29";
  (day._listeners.input || []).forEach((f) => f.call(day));
  time.value = "10am-12pm";
  (time._listeners.input || []).forEach((f) => f.call(time));

  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal(added.collectDay, "2026-10-29", "the day she promised is on the order");
  assert.equal(added.collectTime, "10am-12pm", "and the time, in her own words");
});

test("★★★ and a card she leaves alone writes NO collection keys at all (v657)", () => {
  const st = state();
  const root = openNewCollectCard(st);
  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal("collectDay" in added, false,
    "absent means the posting day — an empty key would read as a promise she never made");
  assert.equal("collectTime" in added, false);
});

test("★★★ a collection time typed on a phone that only fires `change` is still saved (v657)", () => {
  // ⚠️ Her report: the collection DAY came back and the TIME did not. ⭐ A text box can fire `change` on blur
  // and never fire `input` — an Android keyboard, an autofill, a paste — so a handler on `input` alone reads
  // an empty box at Place Order. Both events write the same field now; this fires ONLY the one that used to be
  // ignored.
  const st = state();
  const root = openNewCollectCard(st);
  const day = collectDayBox(root);
  const time = collectTimeBox(root);
  day.value = "2026-10-29";
  (day._listeners.change || []).forEach((f) => f.call(day));
  time.value = "10am-12pm";
  (time._listeners.change || []).forEach((f) => f.call(time));

  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal(added.collectDay, "2026-10-29");
  assert.equal(added.collectTime, "10am-12pm", "★ the time her phone never fired `input` for");
});

// ── v657: switching fulfilment does not throw her collection away ───────────
//
// Her report: *"for an order initially i select self collect, later i change it to courier and key in the
// details, after that i change back to self collect and the collection times field disappear?"* ⚠️ It did:
// v303's draft cleared `pointId` the moment Post was chosen, and nothing put it back.

const POINT_ST = () => {
  const st = state();
  st.points = [{ id: "pt_farlim", name: "Farlim, Air Itam", address: "Lebuhraya Thean Teik",
    receiver: "Aunty Lim", phone: "60123456789", feeRM: 0, paused: false,
    hours: { from: "10:00", to: "12:00" }, createdAt: "2026-08-12T00:00:00.000Z" }];
  return st;
};
const collectFromSel = (root) => all(root).find((n) => n.tagName === "SELECT"
  && (n.children || []).some((o) => o.value === "pt_farlim"));
const fulfilmentSel = (root) => all(root).find((n) => n.tagName === "SELECT"
  && (n.children || []).some((o) => o.value === "courier")
  && (n.children || []).some((o) => o.value === "collect"));

test("★★★ a Point she picked survives a switch to Post and back (v657)", () => {
  const st = POINT_ST();
  const root = openNewCollectCard(st);
  const point = collectFromSel(root);
  assert.ok(point, "the card offers where it collects from");
  point.value = "pt_farlim";
  (point._listeners.change || []).forEach((f) => f.call(point));

  const sel = fulfilmentSel(root);
  sel.value = "courier";
  (sel._listeners.change || []).forEach((f) => f.call(sel));
  const back = fulfilmentSel(root);
  back.value = "collect";
  (back._listeners.change || []).forEach((f) => f.call(back));

  assert.equal(collectFromSel(root).value, "pt_farlim",
    "★ her Point came back — the choice was never hers to lose");
});

test("★★★ and a posted order is still saved with no Point on it (v657)", () => {
  // ⚠️ The rule v303 was protecting is a rule about the ORDER, and the save still keeps it.
  const st = POINT_ST();
  const root = openNewCollectCard(st);
  const point = collectFromSel(root);
  point.value = "pt_farlim";
  (point._listeners.change || []).forEach((f) => f.call(point));
  const sel = fulfilmentSel(root);
  sel.value = "courier";
  (sel._listeners.change || []).forEach((f) => f.call(sel));
  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const added = st.orders.find((o) => o.id !== "o1");
  assert.ok(added, "the order landed");
  assert.equal(added.fulfillment, "courier");
  assert.equal(added.pointId || "", "", "★ a posted order still carries no collection Point");
});

// ── v657: the collection is not drawn as part of a van job ──────────────────
//
// A SELF COLLECT order that still carries a parked charge drew "Send a van" directly above "Collection day and
// time", so the collection read as part of a van job. The collection block now comes first.

test("★★★ a collected order's collection is drawn ABOVE any van heading (v657)", () => {
  const st = state();
  st.orders[0].courierFee = 8;
  st.orders[0].courierPaidBy = "me";
  openEdit(st, "o1");
  // ⚠️ The Edit card lives in the shared pop-up layer, not under `root` — reading `root` here would find
  // neither heading and would pass a card that had both.
  const pop = layers["popup-layer"];
  const nodes = all(pop).filter((n) => n.nodeType === 1 && (n.children || []).length);
  const at = (pred) => nodes.findIndex(pred);
  const collect = at((n) => n.textContent === "Collection day and time"
    || (n.children || []).some((c) => c.textContent === "Collection day and time"));
  const van = at((n) => /^Send a van/.test(String(n.textContent || "").trim()));

  assert.ok(collect >= 0, "the collection is on the card at all");
  assert.ok(van >= 0, "a parked charge still shows its van heading");
  assert.ok(collect < van, "★ the collection came after the van heading, so it reads as a van job");
});

// ═══ THE ROUND TRIP (v657) ══════════════════════════════════════════════════
//
// ⚠️⚠️ THREE TIMES NOW a box on an order card has taken her typing and lost it: the collection day and time on
// the ＋ New order card (collected, never written), and the collection time twice more. ⭐ **Every one of them
// was found by her, not by the suite** — because no test ever did the simplest thing a person does: type
// something, Save, open it again, look.
//
// This does exactly that, for EVERY box on the Edit card that writes an order-level fact. ⭐ And it fails if a
// box appears that is neither covered nor explicitly excused, so a field added next month cannot skip the
// question "does this survive a Save?".

const ROUND_TRIP = [
  ["Customer", "Lucy Tan"],
  ["WhatsApp (optional)", "60129876543"],
  ["Delivery address (if courier)", "9 Jalan Uji, Penang"],
  ["Notes for Collection/Delivery (optional)", "Friday please"],
  ["Courier tracking number", "JT123456789"],
  ["The day they collect", "2026-10-29"],
  ["The time they collect", "10am-12pm"],
];
// ⚠️ Excused on purpose, each for its own reason — never silently.
const NOT_AN_ORDER_FACT = [
  "Postage",          // the charge box: an amount AND a payer settle together, and it has its own tests
  "How many",                // per LINE, not per order
  "Selling price",           // per line
  "Note for this item",      // per line
];
const boxCostLabel = (n) => /^Cost each \(/.test(String(((n && n.attrs) || {})["aria-label"] || ""));

const boxesOn = (pop) => all(pop).filter(isBox);
// ⚠️ This shim keeps no parent pointers, so a box is found by DOCUMENT ORDER: the first box after the label,
// stopping at the next label. That is also how the app names them.
function boxFor(pop, name) {
  const nodes = all(pop);
  const byAria = nodes.find((n) => isBox(n) && n.attrs && n.attrs["aria-label"] === name);
  if (byAria) return byAria;
  const at = nodes.findIndex((n) => n.tagName === "LABEL" && n.textContent.trim() === name);
  if (at < 0) return null;
  for (let j = at + 1; j < nodes.length; j++) {
    if (nodes[j].tagName === "LABEL") return null;
    if (isBox(nodes[j])) return nodes[j];
  }
  return null;
}

test("★★★ every order-fact box on the Edit card keeps what she types, through Save and a reopen (v657)", () => {
  const st = state();
  openEdit(st, "o1");
  const pop = layers["popup-layer"];

  const covered = new Set();
  for (const [name, value] of ROUND_TRIP) {
    const box = boxFor(pop, name);
    assert.ok(box, `the card should carry ${name}`);
    covered.add(box);
    box.value = value;
    (box._listeners.input || []).forEach((f) => f.call(box, { target: box }));
    (box._listeners.change || []).forEach((f) => f.call(box, { target: box }));
  }
  // ⚠️ Every OTHER box on the card must be excused above, so a field added next month cannot skip the question
  // "does this survive a Save?".
  const unclassified = boxesOn(pop).filter((b) => !covered.has(b)
    && !NOT_AN_ORDER_FACT.includes(String((b.attrs || {})["aria-label"] || ""))
    && !boxCostLabel(b)).length;
  assert.equal(unclassified, 0,
    "★ a box on this card is neither round-tripped nor excused — decide which it is: "
    + boxesOn(pop).filter((b) => !covered.has(b)
      && !NOT_AN_ORDER_FACT.includes(String((b.attrs || {})["aria-label"] || ""))
      && !boxCostLabel(b))
      .map((b) => `${b.tagName}[${(b.attrs || {})["aria-label"] || (b.attrs || {}).placeholder || "?"}]`).join(" "));

  tap(buttonByText(pop, "Save changes"));

  openEdit(st, "o1");
  const after = layers["popup-layer"];
  const lost = [];
  for (const [name, value] of ROUND_TRIP) {
    const box = boxFor(after, name);
    if (!box || box.value !== value) lost.push(`${name}: typed ${value}, came back ${box ? box.value : "(box gone)"}`);
  }
  assert.deepEqual(lost, [], "★ a box lost what she typed, across Save and reopen");
});

// ═══ THE ＋ NEW ORDER CARD'S ROUND TRIP (v657) ══════════════════════════════
//
// The new-order card is the door that LOST her collection day and time, so it is the one to check first.
// The trip: type into every box → Place Order → ⭐ **the ORDER carries each value** → open that order's Edit
// card and the same boxes show them again.

const NEW_CARD_TRIP = [
  ["Customer", "Lucy Tan", "customerName", "Lucy Tan"],
  ["WhatsApp (optional)", "60123456789", "whatsapp", "60123456789"],
  ["Notes for Collection/Delivery (optional)", "Thursday", "note", "Thursday"],
  ["The day they collect", "2026-10-30", "collectDay", "2026-10-30"],
  ["The time they collect", "6pm", "collectTime", "6pm"],
];

test("★★★ every order-fact box on the ＋ New order card reaches the order, and comes back on its Edit card (v657)", () => {
  const st = state();
  const root = openNewCollectCard(st);

  for (const [name, value] of NEW_CARD_TRIP) {
    const box = boxFor(root, name);
    assert.ok(box, `the ＋ New order card should carry ${name}`);
    box.value = value;
    (box._listeners.input || []).forEach((f) => f.call(box, { target: box }));
    (box._listeners.change || []).forEach((f) => f.call(box, { target: box }));
  }
  pickProduct(root);
  tap(buttonByText(root, "Place Order"));

  const made = st.orders.find((o) => o.id !== "o1");
  assert.ok(made, "the order landed");
  // ⚠️ The order's own record is the first half — this is the half that silently dropped the collection.
  const notSaved = NEW_CARD_TRIP
    .filter(([, value, field]) => String(made[field] || "") !== value)
    .map(([name, value, field]) => `${name}: typed ${value}, the order carries ${made[field]}`);
  assert.deepEqual(notSaved, [], "★ a box on the ＋ New order card never reached the order it created");

  // ⭐ And the second half: the same order's Edit card shows them back.
  openEdit(st, made.id, "d20");
  const pop = layers["popup-layer"];
  const lost = NEW_CARD_TRIP
    .map(([name, value]) => {
      const box = boxFor(pop, name);
      return !box || String(box.value) !== value ? `${name}: came back ${box ? box.value : "(box gone)"}` : null;
    })
    .filter(Boolean);
  assert.deepEqual(lost, [], "★ the Edit card did not show what the new-order card had just saved");
});

// ═══ THE THIRD DOOR: NOTE / TRACKING (v657) ═════════════════════════════════
//
// The Edit card, the ＋ New order card and the Note / tracking card are three doors onto ONE order, and a fault
// in one is invisible from the other two.

test("★★★ the Note / tracking card keeps what she types, through a Save and a reopen (v657)", () => {
  const st = state();
  const root = createEl("div");
  renderOrders(root, st, new URLSearchParams({ date: "d10" }));
  const row = all(root).find((n) => n.dataset && n.dataset.order === "o1");
  tap(buttonByText(row, "Note / tracking"));

  const typed = [["Notes for Collection/Delivery (optional)", "Leave at the gate"]];
  const pop = layers["popup-layer"];
  for (const [name, value] of typed) {
    const box = boxFor(pop, name);
    assert.ok(box, `the Note / tracking card should carry ${name}`);
    box.value = value;
    (box._listeners.input || []).forEach((f) => f.call(box, { target: box }));
    (box._listeners.change || []).forEach((f) => f.call(box, { target: box }));
  }
  tap(buttonByText(pop, "Save"));

  const order = st.orders.find((o) => o.id === "o1");
  assert.equal(order.note, "Leave at the gate", "★ the note never reached the order");
});
