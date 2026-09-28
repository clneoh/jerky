// test/orders-autocollect.test.js — Engine v190: the courier saying a parcel has been
// picked up moves the order itself, and one press puts it back.
//
// This is the FIRST time anything in this app changes an order's stage with nobody's
// hand on it, and the whole release is built on it being SEEN rather than trusted. So
// this file walks the real path rather than a stand-in for it: the Orders screen is
// rendered for real, the Note / tracking card is opened by pressing its own button, the
// courier's answer is the only thing stubbed, and every assertion below reads the row
// that was actually drawn.
//
// Three rules, and each has a way of being wrong that nothing on screen would show:
//
//   • The move is a TRANSITION, not a state. The guard is a stamp this rule wrote
//     (`courierJob.autoAt`), so looking again cannot move the row twice — and, more to
//     the point, cannot re-move it after she has undone it. A guard that read the trip's
//     own phase would put the status straight back on the next check, and an Undo that a
//     look undoes has undone nothing.
//   • The stage carries MONEY. Moving past Paid without the money recorded is how this
//     app has always said "this order is owed money", so the auto-move inherits that and
//     the Undo has to put the flag back exactly as it was — including the case where the
//     order had no flag at all, which must come back as no flag rather than as `false`
//     (an absent key is what keeps her older orders from lighting up as unhandled).
//   • The Undo is drawn only when there is something to undo. A button that sat on every
//     row and did nothing is the dead-control class this app has been caught by before.
//
// "Now" is frozen at Thu 10 Sep 2026, as in orders-view.test.js.

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
      // A REAL DOM DETACHES the children it drops — their parentNode becomes null — and
      // the courier's price panel decides whether its one-second clock keeps running by
      // asking its own node `wrap.isConnected`. A shim that left a dropped child pointing
      // at this parent would answer "still connected" for a box that has been thrown
      // away, and a timer nobody can stop is an event loop that never drains: the run
      // sits until the test timeout instead of failing. Found here because the Edit card
      // rebuilds its body, which the Note / tracking card does not.
      for (const old of this.children) {
        if (old && old.nodeType === 1 && old.parentNode === this) old.parentNode = null;
      }
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      for (const c of this.children) this._adopt(c);
    },
    // The courier price panel asks `wrap.isConnected` before it does anything at all,
    // and re-asks it after every await — a shim with no parent links would make the
    // whole path unreachable and every assertion below would pass over an empty screen.
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

// The layer every pop-up lives in has to be ON the page before anything opens one: the
// courier panel refuses to work while it is not connected, so a card held in mid-air
// would make the checks below pass over a screen that never drew.
doc.body.append(doc.getElementById("popup-layer"));

const { renderOrders, autoCollect } = await import("../admin/js/views/orders.js");
// What this device has already published is remembered in memory, so a suite that
// publishes the same card twice from identical fixtures would have the second write
// skipped as redundant — and a test asserting the write happened would fail on the app
// being RIGHT. Cleared where it matters, below.
const { forgetPublishedCards } = await import("../admin/js/supabase.js");
const { orderCode } = await import("../admin/js/state.js"); // the code the card is published under

const PRODUCT = { id: "p1", name: "Focaccia", limit: 12, active: true, recipe: [], unit: "pc" };

// An order on a live courier trip, mid-journey, with the money NOT recorded — which is
// the state that makes the move past Paid dangerous and therefore the one worth walking.
function tripOrder(extra = {}) {
  return {
    id: "o1", deliveryDateId: "d10", productId: "p1", qty: 2, price: 22,
    customerName: "Mei Ling", whatsapp: "60123456789", fulfillment: "courier",
    address: "12 Jalan Bunga, 10450 Penang", orderDate: "2026-09-25",
    status: "baking",
    courierJob: {
      provider: "lalamove", jobId: "o-trip-1", quoteId: "q-1", service: "CAR",
      name: "Car", amount: 14, currency: "MYR", status: "ON_GOING",
      statusAt: "2026-09-25T02:00:00.000Z", phase: "on_the_way", done: false,
      bookedAt: "2026-09-25T01:00:00.000Z", link: "https://x.y/z",
    },
    ...extra,
  };
}

function makeState(order = tripOrder()) {
  return {
    deliveryDates: [{ id: "d10", date: "2026-09-30" }],
    products: [PRODUCT], orders: [order], ingredients: [], occasions: [], customers: [],
    settings: {
      cutoff: "18:00", defaultCapacity: 12, currency: "RM", deliveryDays: [4],
      supabase: { url: "https://demo.supabase.co" },
      storefront: { name: "Munchies Furkidz", whatsapp: "016 960 1268" },
      pickupPlace: { lat: 5.4141, lng: 100.3288, label: "8 Lebuh Pantai" },
    },
  };
}

// The channel, stood in for the way courier-booking.test.js stands in for it: the ONE
// thing stubbed is the network, never a function under test. `trip` is the status the
// courier reports, which is the single input every case below turns on.
//
// The price half is answered properly rather than left to fail, because the trip card
// shares a card with it and lives behind the same fold: the panel is opened to reach the
// check at all, and it asks its own questions on the way in.
function stubChannel(trip = "PICKED_UP") {
  const real = globalThis.fetch;
  const asked = [];
  const writes = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("/functions/v1/courier")) {
      const said = JSON.parse(opts.body || "{}");
      asked.push(said.action);
      const body = said.action === "geocode"
        ? { ok: true, place: { lat: 5.42, lng: 100.33, label: "12 Jalan Bunga" } }
        : said.action === "vehicles"
          ? { ok: true, services: [{ key: "CAR" }] }
          : said.action === "quote"
            ? { ok: true, quotes: [{ quotationId: "q-car", serviceType: "CAR", priceBreakdown: { total: 14, currency: "MYR" },
                stops: [{ stopId: "s-bakery", coordinates: { lat: 5.4141, lng: 100.3288 } },
                  { stopId: "s-mei", coordinates: { lat: 5.42, lng: 100.33 } }] }], failed: [] }
            : { ok: true, order: { orderId: "o-trip-1", status: trip, shareLink: "https://x.y/z" } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    // Everything else the screen might reach for is answered as an empty success — but
    // RECORDED rather than discarded, because the customer's own card is written down
    // this branch. A stub that only counted the courier's own calls could not tell a
    // card that was published from one that never left the phone.
    writes.push({ url: String(url), method: String((opts && opts.method) || "GET"), body: String((opts && opts.body) || "") });
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  };
  return { asked, writes, restore() { globalThis.fetch = real; } };
}

const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
};
const buttonByText = (root, text) =>
  all(root).find((n) => n.tagName === "BUTTON" && n.textContent.includes(text));
const row = (root) => all(root).find((n) => n.dataset && n.dataset.order === "o1");
const rowUndo = (root) => {
  const r = row(root);
  return (r && all(r).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "Undo")) || null;
};
const rowText = (root) => { const r = row(root); return r ? r.textContent : ""; };

// Boot the screen and walk to the check exactly as she does: a card off the order's own
// row — the Note / tracking one, or the Edit one, which both carry the same delivery
// section — the delivery panel opened inside it (the trip card is drawn as part of that
// panel and is not built until it is first opened), then Check the trip.
//
// Nothing here reaches past a button: the two presses are her two presses, and the only
// thing standing in for reality is the courier's own answer.
async function walkToCheck(state, trip = "PICKED_UP", door = "note") {
  const s = stubChannel(trip);
  const root = createEl("div");
  const popup = layers["popup-layer"];
  // THE PANEL HAS TO BE SHUT BEFORE THIS FILE IS DONE, whatever happened above. It runs a
  // one-second clock while it is open — that is what keeps "read just now" honest on her
  // screen — and an interval left ticking is an event loop that never drains, so a run
  // that forgot this would sit until the test timeout instead of failing fast. Closing it
  // is what she does anyway, and it is what stops its own clock.
  const shut = () => {
    const hide = buttonByText(popup, "Hide the delivery price");
    if (hide) hide._listeners.click[0]();
    popup.replaceChildren();
  };
  try {
    store.set("bakeadmin.supabase", JSON.stringify({ access_token: "t", expires_at: Date.now() + 3_600_000 }));
    renderOrders(root, state, new URLSearchParams({ date: "d10" }));
    buttonByText(root, door === "edit" ? "Edit" : "Note / tracking")._listeners.click[0]();
    buttonByText(popup, "Get a delivery price")._listeners.click[0]();
    const check = buttonByText(popup, "Check the trip");
    assert.ok(check, "the trip card drew with its own check press on it");
    check._listeners.click[0]();
    // The courier answers over the network and the row is redrawn from it.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
  } finally {
    s.restore();
    shut();
  }
  return { root, asked: s.asked };
}

const checkTrip = (state) => walkToCheck(state, "PICKED_UP");

// ── the move ────────────────────────────────────────────────────────────────
test("the courier's own word for a picked-up parcel moves the order, and the row says who did it", async () => {
  const state = makeState();
  const { root, asked } = await checkTrip(state);

  // The panel asks its own questions on the way in (a point, the vehicles, a price), so
  // what is asserted is the check itself: it was asked, and it was asked ONCE — a screen
  // that never reached the courier would pass every assertion below over an empty picture.
  assert.equal(asked.filter((a) => a === "job").length, 1,
    `the check really asked the courier once (${asked.join(", ")})`);
  const o = state.orders[0];
  assert.equal(o.status, "delivered", "the order moved to Collected / Shipped");
  assert.equal(o.courierJob.phase, "collected", "and the trip's own reading came with it");
  // The money rule the stage has always carried, inherited rather than re-decided:
  // moving past Paid without the money recorded means this order is OWED money.
  assert.equal(o.paidReceived, false, "an unrecorded payment is now marked as owed, not as paid");

  // The row is what makes the move visible. The note names WHO and WHEN, so the row can
  // never read as something she did and cannot remember doing.
  assert.ok(rowUndo(root), "the row offers the Undo");
  assert.match(rowText(root), /Lalamove says it collected/, "and names who moved it");
  assert.match(rowText(root), /at 10:00 am/, "and when, in the app's own clock format");
  assert.match(rowText(root), /this row moved itself\. Put it back if that is not right\./,
    "and says plainly that it was not her");
});

test("the Undo puts the stage and the money flag back — including a flag that was never there", async () => {
  const state = makeState();
  const { root } = await checkTrip(state);
  const before = state.orders[0].courierJob.autoFrom;
  assert.deepEqual(before, { status: "baking", paidReceived: undefined },
    "what the row was is remembered whole, key and all");

  rowUndo(root)._listeners.click[0]();

  const o = state.orders[0];
  assert.equal(o.status, "baking", "the stage is back");
  // THE HALF THAT MATTERS. `paidReceived: false` here would be a claim she never made —
  // it is the flag that says this order owes money, and an order that never carried it
  // must come back without it. An absent key is what keeps her older orders from
  // lighting up as unhandled, so "back where it was" has to mean exactly that.
  assert.equal("paidReceived" in o, false, "and the money flag is ABSENT again, not false");
  assert.equal("autoAt" in o.courierJob, false, "the stamp is gone");
  assert.equal("collectedAt" in o.courierJob, false, "so is the time");
  assert.equal("autoFrom" in o.courierJob, false, "and so is the memory of what it was");
  assert.equal(rowUndo(root), null, "with nothing left to undo, the press is gone");
  assert.doesNotMatch(rowText(root), /this row moved itself/, "and the note went with it");
});

test("an order that was already marked paid is never un-paid by the move, and comes back paid", async () => {
  // The other half of the money rule, and the one that would cost her real money to get
  // wrong. "Moving past Paid without the money recorded means owed" is written as an
  // ELSE — it only ever sets the flag when it is not already true — so an order she had
  // recorded the money on must travel through the move and back out of the Undo still
  // saying it was paid. A restore that always wrote `false` would turn a settled order
  // into one that looks owed.
  const paidState = makeState(tripOrder({ status: "baking", paidReceived: true }));
  const paid = await checkTrip(paidState);
  assert.equal(paidState.orders[0].paidReceived, true, "the move left the recorded payment alone");
  assert.deepEqual(paidState.orders[0].courierJob.autoFrom, { status: "baking", paidReceived: true },
    "and it wrote down what it found");
  rowUndo(paid.root)._listeners.click[0]();
  assert.equal(paidState.orders[0].paidReceived, true, "the Undo gives the true back");
  assert.equal(paidState.orders[0].status, "baking");

  // And an order already carrying an OWED flag keeps carrying it — the key is present
  // both before and after, which is the difference between "owed" and "nobody said".
  const owedState = makeState(tripOrder({ status: "baking", paidReceived: false }));
  const owed = await checkTrip(owedState);
  assert.equal(owedState.orders[0].paidReceived, false, "the move leaves an owed order owed");
  rowUndo(owed.root)._listeners.click[0]();
  assert.equal(owedState.orders[0].paidReceived, false, "and the Undo leaves it owed");
  assert.equal("paidReceived" in owedState.orders[0], true, "as a recorded no, not as a blank");
  assert.equal(owedState.orders[0].status, "baking");
});

// ── the guards ──────────────────────────────────────────────────────────────
test("an order she had already marked Collected / Shipped is left exactly where it was", async () => {
  // A trip booked on an order that is already finished needs no help from anybody, and
  // moving it would be the app claiming a transition that never happened — which would
  // put an Undo on a row she had set herself.
  const state = makeState(tripOrder({ status: "delivered", paidReceived: true }));
  const { root } = await checkTrip(state);

  assert.equal(state.orders[0].status, "delivered", "the stage is untouched");
  assert.equal(state.orders[0].paidReceived, true, "and so is the money");
  assert.equal("autoAt" in state.orders[0].courierJob, false, "nothing was stamped");
  assert.equal(rowUndo(root), null, "and no Undo was invented for a move that did not happen");
  assert.doesNotMatch(rowText(root), /this row moved itself/, "nor a note claiming one");
});

test("looking again never moves the row a second time, and never overwrites what it was", async () => {
  // THE GUARD, and the reason it is a stamp rather than the trip's own phase. The trip
  // stays `collected` for the rest of the delivery, so a state-based guard would move the
  // row on every check — and, worse, would move it straight back the moment she undid it.
  // Here the order is checked, undone, and checked a second time: the second check has to
  // leave it alone, because the Undo has to survive her looking again.
  const state = makeState();
  const { root } = await checkTrip(state);
  rowUndo(root)._listeners.click[0]();
  assert.equal(state.orders[0].status, "baking", "undone");

  const second = await checkTrip(state);
  assert.equal(state.orders[0].status, "baking",
    "the second check left it where the Undo put it, rather than putting it back");
  assert.equal("autoAt" in state.orders[0].courierJob, false, "and wrote no stamp");
  assert.equal(rowUndo(second.root), null, "so the row carries no Undo it has not earned");
});

test("the rule itself refuses a row it has already moved, and never re-stamps what it was", () => {
  // THE SECOND GUARD, tested where it is stated and in the only state that isolates it.
  // The other guard — a row already sitting on Collected / Shipped is left alone — is what
  // answers a second call made straight after the first, so it hides this one completely;
  // press the courier's check twice and it is that rule, not this one, that says no.
  //
  // The state that isolates this one is reachable, and she is the one who reaches it: the
  // rule moves the row, and she then sets the stage back by hand because she disagrees with
  // it. The stamp stays — it is the Undo that clears it, not the drop-down — so the row now
  // reads "Baked", carries a trip the courier has collected, and remembers that the rule
  // moved it once already.
  //
  // The harm the guard prevents is specific. The moment this function moves a row it writes
  // down what the row WAS, so the Undo can put it back. A second move would write the
  // stage the row is on now over that memory, and the Undo would then restore the row to
  // where the courier had already put it — an Undo that undoes nothing, on the one release
  // where a machine moves her orders.
  const state = makeState();
  const group = { orders: state.orders };
  const o = state.orders[0];
  assert.equal(autoCollect(state, group, o, {}), true, "the first call moves the row");
  assert.equal(o.courierJob.autoFrom.status, "baking", "and writes down what it was");
  const stamp = o.courierJob.autoAt;
  assert.ok(stamp, "with the moment it happened");

  o.status = "baking"; // her own hand, after the move — the drop-down, not the Undo
  assert.equal(autoCollect(state, group, o, {}), false, "the second call is refused rather than moving it again");
  assert.equal(o.status, "baking", "and leaves the stage exactly where she put it");
  assert.equal(o.courierJob.autoFrom.status, "baking",
    "the memory of what the row was survives, so the Undo still puts it back where SHE left it");
  assert.equal(o.courierJob.autoFrom.paidReceived, undefined,
    "including the flag that was never there — a second move would have recorded one");
  assert.equal(o.courierJob.autoAt, stamp, "and the moment is not re-stamped");
});

test("a status that only says the trip is on its way moves nothing at all", async () => {
  // The move is for the ONE transition the courier reports as collected. Every other
  // reading of a healthy trip — a driver still being found, a driver on the road — must
  // leave the order exactly where she left it, or the app would be finishing her orders
  // for her.
  for (const trip of ["ASSIGNING_DRIVER", "ON_GOING"]) {
    const state = makeState();
    const { root } = await walkToCheck(state, trip);
    assert.equal(state.orders[0].status, "baking", `${trip} left the stage alone`);
    assert.equal(state.orders[0].paidReceived, undefined, `${trip} left the money flag alone`);
    assert.equal(rowUndo(root), null, `${trip} put no Undo on the row`);
    // The trip's own reading still arrived — so this is not passing on a failed call.
    assert.ok(state.orders[0].courierJob.phase, `${trip} was still read off the courier`);
    // And the driver's own line is what the reading put there, so the check is not
    // silently failing either.
    assert.equal(state.orders[0].courierJob.status, trip, "the courier's status landed on the record");
  }
});

test("a check made after the parcel has arrived still moves the order", async () => {
  // The courier reports the journey as it happens, and she does not stand over the screen
  // waiting for it: the check she actually makes is often the one at the end of the day,
  // when the trip already reads delivered. A parcel cannot have arrived without being
  // collected first, so `delivered` moves the order exactly as `collected` does — without
  // this, an order whose collection she was never told about would sit on Baked for ever,
  // and the app would look like it had missed the trip entirely.
  const state = makeState();
  const { root } = await walkToCheck(state, "COMPLETED");
  assert.equal(state.orders[0].courierJob.phase, "delivered", "the trip really does read as arrived");
  assert.equal(state.orders[0].courierJob.done, true, "and the trip is over");
  assert.equal(state.orders[0].status, "delivered", "the order still moved");
  assert.ok(rowUndo(root), "and the Undo is on the row, because this is still the app's move and not hers");
});

// ── the other door, and the one they both walk through ──────────────────────
test("the Edit card's own door moves the row exactly as the Note / tracking card does", async () => {
  // There are TWO ways into the delivery section — the Edit card and the Note / tracking
  // card — and the whole reason `onCollectedMove` is one function is that they must not
  // drift apart. A section that was wired up at one call site and forgotten at the other
  // would look perfectly healthy from the door that was done: every test above would pass
  // and her own Edit button would quietly do nothing.
  const state = makeState();
  const { root } = await walkToCheck(state, "PICKED_UP", "edit");
  const o = state.orders[0];
  assert.equal(o.status, "delivered", "the stage moved through the other door too");
  assert.equal(o.courierJob.phase, "collected", "on the same reading of the trip");
  assert.ok(o.courierJob.autoAt, "the stamp that says this rule moved the row is on it");
  assert.equal(o.courierJob.autoFrom.status, "baking", "with what it was before, so it can be put back");
  assert.equal(o.courierJob.autoFrom.paidReceived, undefined, "the absent money flag captured as absent");
  assert.ok(rowUndo(root), "the same Undo is on the row");
  // And the Undo works from here too: it is the same rule, reached the same way.
  buttonByText(row(root), "Undo")._listeners.click[0]();
  assert.equal(o.status, "baking", "the row is back where the courier found it");
  assert.equal(rowUndo(root), null, "with nothing left to undo");
});

test("a stage she picks by hand reaches the customer's card, because both doors finish the same way", async () => {
  // The guard for the refactor, and the one that matters most in this release. Every door
  // to an order's stage now ends in `stageWritten`, whose publish is the only thing that
  // tells the customer's page the order moved. A door that took the new status and skipped
  // the publish would leave a customer reading the stage their order USED to be on — with
  // nothing on her screen saying so, because the save, the sync and the badge all still
  // happen. So this is measured off the wire rather than off the code: the press is hers
  // (the row's own drop-down), and what is asserted is the write that left the phone.
  const state = makeState();
  const s = stubChannel("ON_GOING");
  const root = createEl("div");
  try {
    // Publishing needs a signed-in cloud, and the fixture is signed OUT — so a state that
    // is going to prove a press reaches the customer has to be given one. Left off by
    // default for the reason it is off in the real app: with no cloud there is nowhere to
    // publish to, and this test would then pass on a call that was never made.
    state.settings.supabase = {
      enabled: true, url: "https://project.test",
      anonKey: "anon", email: "a@b.c", password: "pw",
    };
    forgetPublishedCards(); // nothing of this order is on the customer's card yet
    store.set("bakeadmin.supabase", JSON.stringify({ access_token: "t", expires_at: Date.now() + 3_600_000 }));
    renderOrders(root, state, new URLSearchParams({ date: "d10" }));

    const dropdown = all(row(root)).find((n) => n.tagName === "SELECT");
    assert.ok(dropdown, "the row carries its own status drop-down");
    dropdown.value = "delivered"; // she picks Collected / Shipped by hand
    dropdown._listeners.change[0]();
    // TWO writes leave this press and both are waited for, rather than slept past. One is
    // the customer's card, which is the point. The other is `maybeSync`'s publish of the
    // day's availability, which this screen schedules on a TWO-SECOND debounce
    // (admin/js/supabase.js) — and putting the real fetch back before that timer fires
    // hands it to the network, where it fails and is reported as activity after the test
    // ended. A signed-out fixture schedules no timer at all, which is why only the two
    // tests in this file that need a signed-in cloud have to know about this.
    const wrote = (part) => s.writes.some((w) => w.url.includes(part));
    for (let i = 0; i < 3000 && !(wrote("/rest/v1/order_tracking") && wrote("/rest/v1/availability")); i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1)); // and the rest of each chain
  } finally { s.restore(); }

  assert.equal(state.orders[0].status, "delivered", "the stage she picked is on the order");
  const posts = s.writes.filter((w) => w.url.includes("/rest/v1/order_tracking") && w.method === "POST");
  assert.equal(posts.length, 1, `the customer's card was published once: ${JSON.stringify(s.writes.map((w) => w.url))}`);
  const published = JSON.parse(posts[0].body)[0];
  assert.equal(published.status, "delivered", "carrying the stage the customer is now on");
  assert.equal(published.code, orderCode(state.orders[0]), "under this order's own code");
  // Moving past Paid without the money recorded is this app's own way of saying the order
  // is owed, and it is published with the stage — one press, and the customer's card and
  // her own books say the same thing.
  assert.equal(published.paid_received, false, "and the money flag her rule wrote with it");
  // A move SHE made is not the courier's, so there is nothing to put back and no Undo is
  // invented for it — the dead-control rule.
  assert.equal(state.orders[0].courierJob.autoAt, undefined, "her own move writes no stamp");
  assert.equal(rowUndo(root), null, "so no Undo appears on the row");
});
