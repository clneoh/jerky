// test/app.test.js — smoke tests for the bootstrap + shared-data gate.
// js/app.js boots into the DOM, so this shims a minimal document (like the
// store tests) and imports it fresh per scenario. Verifies the no-cloud path is
// unchanged and that the cloud gate appears/disappears as expected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const realLocalStorage = globalThis.localStorage;
const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    // ★★★ AND IT PARENTS WHAT IT IS GIVEN (v520). ⚠️⚠️ IT DID NOT, so `parentElement` was **always null**
    // and **no node here had an ancestor at all** — ⭐ which meant the shim could not tell a node inside the
    // scrolling page from one outside it, and **a test about the page's own scroll could not be written.**
    // ⭐ The real DOM sets it, and the shop's own shim has set it since v459 for exactly this reason.
    appendChild(c) { if (c != null) { c.parentElement = this; this.children.push(c); } return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) if (c != null) this.children.push(c);
      // ★★★ AND EMPTYING THE VIEW DROPS THE PAGE'S SCROLL, WHICH IS WHAT A BROWSER DOES (v520).
      // ⚠️⚠️ WITHOUT THIS THE SHIM CANNOT SEE THE FAULT AT ALL: it has no layout, so the window's scroll
      // simply stays where it was and **a test asserting "she kept her place" passes whether the app puts
      // it back or not.** ⭐ MEASURED on the real app: scrolled to 400, `replaceChildren()` on the view,
      // **0** — the document loses its height for an instant and the browser clamps the scroll.
      // ⭐ **A shim that cannot express what the view does cannot test it** — the same rule this file has
      // already paid for with `hidden`, `classList`, `parentNode` and `insertBefore`.
      const sc = globalThis.document && globalThis.document.scrollingElement;
      if (!sc) return;
      for (let n = this; n; n = n.parentElement) if (n === sc) { sc.scrollTop = 0; return; }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

// ui.el() puts text in nodeType-3 children (never innerHTML), so walking the
// element tree with .text nodes collects everything a view painted.
function collectText(node, out = []) {
  if (node && node.nodeType === 3 && node.text != null) out.push(node.text);
  for (const c of (node && node.children) || []) collectText(c, out);
  return out.join("");
}

// Fresh DOM per scenario so repeated app.js imports don't see stale children.
function freshDOM() {
  const registry = {};
  const documentShim = {
    createElement: createEl,
    createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
    getElementById: (id) => (registry[id] ||= createEl("div")),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: createEl("body"),
  };
  // ★★★ AND THE SHIM CAN NOW EXPRESS A SCROLL AND A ROUTE CHANGE (v520).
  // ⚠️⚠️ It captured NOTHING: `addEventListener` was a no-op and there was no scrolling element at all — ⭐
  // **so the page's own scroll could not be observed, and a repaint's effect on it could not be asserted.**
  // ⭐ **A shim that cannot express what the view does cannot test it** — the rule this file has already paid
  // for with `hidden`, `classList`, `parentNode` and `insertBefore`.
  const winListeners = {};
  const docListeners = {};
  documentShim.addEventListener = (t, f) => { (docListeners[t] ||= []).push(f); };
  documentShim.removeEventListener = () => {};
  documentShim._listeners = docListeners;
  documentShim.scrollingElement = createEl("html");   // ⚠️ what actually scrolls: the DOCUMENT, not #view
  // ⚠️ AND THE VIEW HANGS UNDER IT, so emptying the view can be seen to drop the page's scroll — the
  // real page has #view inside <body> inside the scrolling element, and the model has to match.
  documentShim.scrollingElement.appendChild(documentShim.body);
  documentShim.body.appendChild(documentShim.getElementById("view"));
  globalThis.document = documentShim;
  globalThis.window = {
    addEventListener(t, f) { (winListeners[t] ||= []).push(f); },
    _listeners: winListeners,
    location: { hash: "#/dashboard" },
  };
  globalThis.location = globalThis.window.location;
  globalThis.history = { replaceState() {} };
  // Keep the app's 30s sync / 60s countdown timers from keeping the test alive.
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  return registry;
}

function installStorage(seed) {
  const store = new Map();
  for (const [k, v] of Object.entries(seed || {})) store.set(k, String(v));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return store;
}

function stateJSON(overrides = {}) {
  return JSON.stringify({
    version: 1,
    settings: {
      defaultCapacity: 12,
      deliveryDays: [1, 3, 5],
      cutoff: "18:00",
      currency: "RM",
      supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" },
      cloud: { enabled: false },
    },
    ingredients: [],
    products: [],
    deliveryDates: [],
    orders: [],
    purchaseOrders: [],
    ...overrides,
  });
}

function tokenJSON(token = "tok") {
  return JSON.stringify({ access_token: token, expires_at: Date.now() + 3600000 });
}

function restore() {
  if (realLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = realLocalStorage;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.location;
}

// Keep real fetch (Node's) from hitting the network if a scenario logs in.
globalThis.fetch = async (url) => {
  if (String(url).includes("/auth/v1/token")) {
    return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
  }
  return { ok: true, json: async () => [], text: async () => "" };
};

test("cloud off: app boots straight to the dashboard, no gate, no sync calls", async () => {
  freshDOM();
  installStorage({ "bakeadmin.v1": stateJSON() });
  try {
    await import("../admin/js/app.js?case=off");

    const view = document.getElementById("view");
    assert.ok(view.children.length > 0, "dashboard rendered into #view");
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz");
    assert.equal(document.getElementById("tabbar").hidden, false, "tab bar visible");
    assert.equal(document.getElementById("view-title-text").textContent === "Sign in", false, "not the sign-in screen");
  } finally { restore(); }
});

test("cloud off with orders: Home shows the at-a-glance tiles and weekly to-do", async () => {
  const today = new Date();
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const delivery = new Date(); delivery.setDate(delivery.getDate() + 4);
  freshDOM();
  installStorage({ "bakeadmin.v1": stateJSON({
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d1", date: iso(delivery), notes: "" }],
    orders: [{ id: "o1", groupId: "g1", productId: "p1", qty: 2, status: "new",
      deliveryDateId: "d1", deliveryDate: iso(delivery), orderDate: iso(today),
      customerName: "Ain", whatsapp: "60123456789", fulfillment: "collect",
      createdAt: today.toISOString() }],
  }) });
  try {
    await import("../admin/js/app.js?case=ataglance");

    const text = collectText(document.getElementById("view"));
    assert.match(text, /1 new order to confirm/, "needs-you tile counts the New group");
    assert.match(text, /Next batch/, "next-batch tile present");
    assert.match(text, /×2/, "next-bake line shows the product × qty");
    assert.match(text, /2 items/, "next-bake footer totals the batch");
    assert.match(text, /This week/, "numbers tile present");
    assert.match(text, /RM 30\.00/, "est. value = 2 × RM 15");
    assert.match(text, /Coming 4 weeks/, "forecast card shows when future delivery dates exist");
    assert.match(text, /This week's to-do/, "weekly to-do card present");
    assert.match(text, /0\/6/, "fresh week, nothing ticked yet");
  } finally { restore(); }
});

test("cloud on without a session: the sign-in gate owns the screen", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        supabase: { url: "https://x.supabase.co", anonKey: "anon" },
        cloud: { enabled: true },
      },
    }),
  });
  try {
    await import("../admin/js/app.js?case=gate");

    assert.equal(document.getElementById("tabbar").hidden, true, "tab bar hidden while signing in");
    assert.equal(document.getElementById("view-title-text").textContent, "Sign in");
    const view = document.getElementById("view");
    assert.ok(view.children.length > 0, "login card rendered");
  } finally { restore(); }
});

test("cloud on with a valid session: straight into the app", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        supabase: { url: "https://x.supabase.co", anonKey: "anon" },
        cloud: { enabled: true },
      },
    }),
    "bakeadmin.supabase": tokenJSON(),
  });
  try {
    await import("../admin/js/app.js?case=token");
    assert.equal(document.getElementById("tabbar").hidden, false, "no gate — session valid");
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz");
  } finally { restore(); }
});

test("cloud on with stored credentials: silent auto-login, no gate flash", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        supabase: { url: "https://x.supabase.co", anonKey: "anon", email: "owner@x.com", password: "pw" },
        cloud: { enabled: true },
      },
    }),
  });
  try {
    await import("../admin/js/app.js?case=auto");
    // render() runs synchronously in boot, before the async login resolves —
    // so the app must be showing, never the gate.
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz");
    assert.equal(document.getElementById("tabbar").hidden, false);
    await new Promise((r) => setTimeout(r, 10)); // let the login + pull settle
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz", "still the app after login");
  } finally { restore(); }
});

test("app password lock: the lock layer owns the screen until the PIN is correct", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" },
        cloud: { enabled: false },
        lock: { enabled: true, pinHash: HASH_1234 },
      },
    }),
  });
  try {
    await import("../admin/js/app.js?case=lock1");
    const layer = document.getElementById("lock-layer");
    const view = document.getElementById("view");
    assert.equal(layer.hidden, false, "lock layer is up on boot");
    assert.equal(view.children.length, 0, "nothing painted behind the lock");
    assert.equal(document.getElementById("view-title-text").textContent, "", "title not rewritten");

    // Wrong PIN → still locked, error shown.
    layer._pin.value = "9999";
    await layer._btn._listeners.click[0]();
    assert.equal(layer.hidden, false, "still locked after a wrong PIN");
    assert.ok(String(layer._err.textContent || "").length > 0, "shows the wrong-password error");
    assert.equal(view.children.length, 0, "still nothing behind the lock");

    // Correct PIN → lock dismissed and the dashboard paints.
    layer._pin.value = "1234";
    await layer._btn._listeners.click[0]();
    assert.equal(layer.hidden, true, "lock layer dismissed");
    assert.ok(view.children.length > 0, "dashboard rendered after unlock");
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz");
  } finally { restore(); }
});

test("lock 'enabled' with no stored PIN never gates the app", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        supabase: { enabled: false, url: "", anonKey: "", email: "", password: "" },
        cloud: { enabled: false },
        lock: { enabled: true, pinHash: "" },
      },
    }),
  });
  try {
    await import("../admin/js/app.js?case=lock2");
    assert.equal(document.getElementById("lock-layer").hidden, true, "no lock layer");
    assert.ok(document.getElementById("view").children.length > 0, "straight to the dashboard");
    assert.equal(document.getElementById("view-title-text").textContent, "Munchies Furkidz");
  } finally { restore(); }
});

test("lock + cloud-on-no-session: the PIN comes first, the sign-in gate second", async () => {
  freshDOM();
  installStorage({
    "bakeadmin.v1": stateJSON({
      settings: {
        defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM",
        supabase: { url: "https://x.supabase.co", anonKey: "anon" },
        cloud: { enabled: true },
        lock: { enabled: true, pinHash: HASH_1234 },
      },
    }),
  });
  try {
    await import("../admin/js/app.js?case=lock3");
    const layer = document.getElementById("lock-layer");
    assert.equal(layer.hidden, false, "PIN gate appears first");
    layer._pin.value = "1234";
    await layer._btn._listeners.click[0]();
    assert.equal(layer.hidden, true, "PIN gate dismissed");
    assert.equal(document.getElementById("view-title-text").textContent, "Sign in", "sign-in gate follows the unlock");
    assert.equal(document.getElementById("tabbar").hidden, true);
  } finally { restore(); }
});

// ── Engine v70 — the one-time price/name catch-up ────────────────────────────

test("v70 catch-up stamps pre-existing orders with today's name and price once", async () => {
  freshDOM();
  const store = installStorage({ "bakeadmin.v1": stateJSON({
    products: [{ id: "p1", name: "Focaccia", price: 15, active: true }],
    orders: [
      { id: "o1", productId: "p1", qty: 2, status: "new", deliveryDateId: "d1",
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
      { id: "o2", productId: "gone", qty: 1, status: "new", deliveryDateId: "d1",
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
    ],
  }) });
  try {
    await import("../admin/js/app.js?case=v70");

    const saved = JSON.parse(store.get("bakeadmin.v1"));
    const o1 = saved.orders.find((o) => o.id === "o1");
    assert.equal(o1.productName, "Focaccia", "the live name is frozen onto the old order");
    assert.equal(o1.unitPrice, 15, "the live price is frozen onto the old order");
    assert.equal(saved.settings.migratedV70, true, "the catch-up is marked done");

    const o2 = saved.orders.find((o) => o.id === "o2");
    assert.equal(o2.productName, undefined, "a vanished product is left alone, never guessed at");
    assert.equal(o2.unitPrice, undefined);
  } finally { restore(); }
});

// ── ★ Engine v380 — the one-time COST catch-up ───────────────────────────────
// ⚠️⚠️ THIS IS THE ONE CATCH-UP THAT REWRITES HER ORDER ROWS. It writes to every
// order she has, in one save, which then syncs to her other phone — so what it
// writes, what it refuses to write, and what it must never overwrite all matter.
// Her words: "yes, freeze the cost onto the order".

test("v380 catch-up freezes today's recipe cost onto orders already taken, once", async () => {
  freshDOM();
  const store = installStorage({ "bakeadmin.v1": stateJSON({
    // Flour at 1 sen a gram, 100 g in a Focaccia ⇒ RM1.00 to bake one.
    ingredients: [{ id: "g1", name: "Flour", unit: "g", costPerUnit: 0.01, active: true }],
    products: [
      { id: "p1", name: "Focaccia", price: 15, active: true, recipe: [{ ingredientId: "g1", qty: 100 }] },
      { id: "p2", name: "Bare", price: 5, active: true }, // a recipe nobody has built yet
    ],
    orders: [
      { id: "o1", productId: "p1", qty: 2, status: "new", deliveryDateId: "d1",
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
      { id: "o2", productId: "p1", qty: 1, status: "new", deliveryDateId: "d1", unitCost: 9,
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
      { id: "o3", productId: "p2", qty: 1, status: "new", deliveryDateId: "d1",
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
      { id: "o4", productId: "gone", qty: 1, status: "new", deliveryDateId: "d1",
        customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
    ],
  }) });
  try {
    await import("../admin/js/app.js?case=v380");

    const saved = JSON.parse(store.get("bakeadmin.v1"));
    const byId = (id) => saved.orders.find((o) => o.id === id);
    assert.equal(saved.settings.migratedV380, true, "the catch-up is marked done, so it never runs twice");
    assert.equal(byId("o1").unitCost, 1, "today's recipe cost is locked onto an order already taken");
    assert.equal(byId("o2").unitCost, 9,
      "⚠️ a cost she adjusted BY HAND is never overwritten by the catch-up");
    assert.equal(byId("o3").unitCost, undefined,
      "⚠️ a recipe that prices to nothing writes NO cost, so it can gain one later");
    assert.equal(byId("o4").unitCost, undefined, "a vanished product is left alone, never guessed at");
    assert.equal(saved.orders.length, 4, "no order was removed or invented");
    // ⚠️ And the price half of the SAME record is untouched by this version: the
    // v70 block has already run in this fixture, so these carry the live name/price.
    assert.equal(byId("o1").unitPrice, 15, "the freeze added a cost without disturbing the price");
  } finally { restore(); }
});

test("v380 catch-up writes the cost the books were ALREADY reading, so no figure moves", async () => {
  // ⚠️⚠️ THE CLAIM THE CHANGELOG MAKES, PINNED. The cost it locks on is exactly what
  // the live recipe was giving the books a moment earlier — so on the day this ships,
  // not one number on any screen changes. If this ever stops being true, the whole
  // "safe to deploy" sentence in the changelog is a lie.
  const { profitBetween } = await import("../admin/js/profit.js");
  const ingredients = [{ id: "g1", name: "Flour", unit: "g", costPerUnit: 0.01, active: true }];
  const products = [{ id: "p1", name: "Focaccia", price: 15, active: true, recipe: [{ ingredientId: "g1", qty: 100 }] }];
  const orders = [
    { id: "o1", productId: "p1", qty: 2, status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-10",
      customerName: "Ain", whatsapp: "60123456789", createdAt: new Date().toISOString() },
    { id: "o2", productId: "p1", qty: 3, status: "new", deliveryDateId: "d1", deliveryDate: "2026-09-12",
      customerName: "Bee", whatsapp: "60123456789", createdAt: new Date().toISOString() },
  ];
  const live = { settings: { currency: "RM" }, uoms: [], ingredients, products, deliveryDates: [{ id: "d1", date: "2026-09-10" }], orders, expenses: [], deposits: [] };
  const before = profitBetween(live, "2026-09-01", "2026-09-30");

  freshDOM();
  const store = installStorage({ "bakeadmin.v1": stateJSON({ ingredients, products, orders }) });
  try {
    await import("../admin/js/app.js?case=v380-same");
    const saved = JSON.parse(store.get("bakeadmin.v1"));
    assert.equal(saved.orders.every((o) => o.unitCost === 1), true, "every line froze at RM1.00");
    const after = profitBetween(
      { ...live, orders: saved.orders }, "2026-09-01", "2026-09-30");
    assert.equal(after.cost, before.cost, "⚠️ cost of sales is IDENTICAL either side of the catch-up");
    assert.equal(after.sales, before.sales, "and so are the sales");
    assert.equal(after.gross, before.gross, "and the gross profit the statement turns on");
  } finally { restore(); }
});

// ── ★★ Engine v383 — a phone that is behind reloads BEFORE the lock ─────────
// Her report: __"some app user after keying in pin, but login to an old version app"__. The warning
// that should have told them was painted UNDER the lock screen, so the reload was moved to the boot.
// ⚠️⚠️ THIS IS THE WIRING, AND UNTIL NOW NOTHING TESTED IT: `test/freshness.test.js` proves the rule,
// but deleting the one line that CALLS it from `boot()` broke no test at all — and her users would go
// straight back to landing in an old build. It is asserted here, in the boot, where the fix lives.

async function bootWith({ seed, deployedVersion }) {
  freshDOM();
  const store = installStorage(seed || { "bakeadmin.v1": stateJSON({}) });
  const sess = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (sess.has(k) ? sess.get(k) : null),
    setItem: (k, v) => sess.set(k, String(v)),
    removeItem: (k) => sess.delete(k),
  };
  const asked = [];
  let reloads = 0;
  globalThis.location = {
    href: "https://bakery.test/admin/", hash: "#/dashboard",
    reload: () => { reloads += 1; },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return { ok: true, text: async () => `export const ENGINE_VERSION = "${deployedVersion}";` };
  };
  const caseName = `v383-${deployedVersion}-${Math.random()}`;
  try {
    await import(`../admin/js/app.js?case=${caseName}`);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.sessionStorage;
  }
  return { store, sess, asked, reloads, lock: document.getElementById("lock-layer"), lockShown: document.getElementById("lock-layer").children.length > 0 };
}

test("★★ a phone that is BEHIND reloads itself before the lock, so one PIN gets it the new build", async () => {
  const r = await bootWith({ deployedVersion: "999" });
  assert.equal(r.reloads, 1, "a phone on an older build did NOT reload — its owner lands in the old app");
  assert.equal(r.lockShown, false,
    "the lock was drawn before the reload, which is the whole thing this is meant to avoid");
  assert.equal(r.sess.get("bakeadmin.updateTried"), "999",
    "the build it tried was not recorded, so the next boot would reload again for ever");
  restore();
});

test("★ and a phone that is CURRENT boots straight to the lock, with no reload", async () => {
  const r = await bootWith({ deployedVersion: "382" });
  assert.equal(r.reloads, 0, "a current phone flashed a reload for nothing");
  restore();
});

// ── Engine v120 — the one-time customer-identity catch-up ────────────────────

test("v120 catch-up joins a customer who was split by a '+' on their number, once", async () => {
  freshDOM();
  const store = installStorage({ "bakeadmin.v1": stateJSON({
    orders: [
      { id: "o1", productId: "p1", qty: 1, status: "new", deliveryDateId: "d1",
        customerName: "Neoh Choo Leong", whatsapp: "60123456789", createdAt: new Date().toISOString() },
      { id: "o2", productId: "p1", qty: 2, status: "new", deliveryDateId: "d1",
        customerName: "Neoh Choo Leong", whatsapp: "+60123456789", createdAt: new Date().toISOString() },
    ],
    customers: [
      { id: "cus_a", key: "60123456789", name: "Neoh Choo Leong", whatsapp: "60123456789", dogName: "Coco" },
      { id: "cus_b", key: "+60123456789", name: "Neoh Choo Leong", whatsapp: "+60123456789", notes: "allergic to nuts" },
    ],
  }) });
  try {
    await import("../admin/js/app.js?case=v120");

    const saved = JSON.parse(store.get("bakeadmin.v1"));
    assert.equal(saved.settings.migratedV120, true, "the catch-up is marked done, so it never runs twice");
    assert.equal(saved.customers.length, 1, "the duplicate saved record is gone");
    assert.equal(saved.customers[0].key, "60123456789");
    assert.equal(saved.customers[0].dogName, "Coco", "what one side knew is kept");
    assert.equal(saved.customers[0].notes, "allergic to nuts", "and so is what the other knew");
    assert.equal(saved.orders.length, 2, "no order was removed or invented");
    assert.equal(saved.orders.every((o) => o.whatsapp === "60123456789"), true,
      "both orders now carry the one spelling, so she sees one row");
  } finally { restore(); }
});

// ── v513: the date on screen follows the calendar, not the page load ─────────
test("★★★ the day is re-checked whenever the page is come back to — and never on a path that cannot run (v513)", () => {
  // ⚠️⚠️ HER REPORT: __"it is the 1st time that i saw the app date not updated until i reload? Why?"__
  // ⭐ The app drew its date when the SCREEN was drawn and never looked at the clock again, so an app
  // left open overnight kept yesterday's date. ⭐ MEASURED on the real app: the clock said Sat 17 Oct,
  // the hero still said Fri 16 Oct, and picking the phone up changed nothing.
  const SRC = readFileSync(new URL("../admin/js/app.js", import.meta.url), "utf8");

  assert.match(SRC, /function dayMoved\(\)/,
    "the day-rollover check is gone — **the app's date goes stale again for anyone who leaves it open "
    + "overnight**, which is the whole of her report");

  // ⭐⭐ AND WHERE IT IS REGISTERED IS THE WHOLE BUG. This app has two ways in — the cloud sign-in, and
  // **"Use without cloud sync", which sets `loggedOut = false` and renders and calls nothing else.**
  // ⚠️⚠️ **"No listener at all" had to be guarded in BOTH loops, because the day check must be in
  // NEITHER: `startSync` and `startIntake` are both only reached from `bootApp()` after a sign-in, and
  // `onOffline` calls neither.** ⭐ **My first attempt put the check inside `startIntake()`'s own
  // `go()` — and it read as correct.** ⚠️ **And my first draft of THIS test guarded `startSync`
  // instead, which the bite proved was watching the wrong one: the fault went in and NOTHING fired.
  // A guard on the wrong function looks exactly like a guard that works.**
  for (const fn of ["startSync", "startIntake"]) {
    const at = SRC.indexOf(`function ${fn}()`);
    assert.ok(at > 0, `${fn} has been renamed — this guard is no longer watching the right code`);
    const body = SRC.slice(at, SRC.indexOf("\nfunction ", at + 1));
    assert.equal(/checkDay|dayMoved/.test(body), false,
      `the day check is back inside \`${fn}()\` — ⚠️ **the "Use without cloud sync" path never calls `
      + "it**, so the check would never run for exactly the state she reported from");
  }

  // ⭐ It belongs beside the router's own listener, which runs for EVERY session.
  assert.ok(SRC.indexOf('window.addEventListener("hashchange", render)') > 0,
    "the router's own listener has moved — this guard is watching the wrong seam");
  assert.match(SRC, /document\.addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) checkDay\(\); \}\)/,
    "the day is no longer checked when the page becomes visible — on a phone this is THE ordinary case: "
    + "the phone is put down overnight and picked up in the morning");
  assert.match(SRC, /window\.addEventListener\("focus", checkDay\)/,
    "the day is no longer checked on focus — **v497's lesson: a timer in a hidden page does not run**");

  // ⚠️⚠️ AND THE TIMER MUST NOT HOLD THE SUITE OPEN. ⭐ MEASURED, and this one cost me: registered
  // plainly, a module-scope `setInterval` in Node keeps the PROCESS alive, and
  // `test/customer-history-door.test.js` and `test/customer-payment-truth.test.js` each **hung for the
  // full 20-second timeout and reported as failures — every test inside them passed, and the FILE was
  // `not ok`.** ⭐ **Neither of those files names `app.js` in its own imports**, which is why the guard
  // belongs on the TIMER rather than on any one test file.
  const timerAt = SRC.indexOf("setInterval(checkDay, 30000)");
  assert.ok(timerAt > 0, "the 30-second day beat is gone — a phone left on the screen at midnight would never roll over");
  assert.match(SRC.slice(timerAt, timerAt + 220), /unref\(\)/,
    "the day timer is not `unref`'d — ⚠️ MEASURED: that alone makes two test FILES hang for the full "
    + "20-second timeout and report as failures while every test inside them passes");

  // ★★ AND THE SHOP HAD THE SAME HOLE. Her question: __"will it happen on storefront?"__ ⚠️ **It was
  // already happening** — MEASURED: with the clock moved to 17 Oct and the customer returning to the
  // tab, the green "today" halo was still on 16, while the availability requests went out on every
  // beat. ⭐ **The storefront redrew only when the DATA changed, and the date moving is not a data
  // change** — ⚠️ the one thing it DID already catch was a day crossing its 6pm cut-off, which does
  // change the list, **so the cut-off was honest and the calendar was not.**
  const shop = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  assert.match(shop, /const movedDay = dateKey\(new Date\(\)\) !== drawnDay;/,
    "the shop no longer asks whether the day moved — a shop left open overnight keeps yesterday's "
    + "\"today\" on the grid");
  assert.match(shop, /if \(changed \|\| daysChanged \|\| movedDay\) rerender\(\);/,
    "the shop asks the question and then does not act on it, which is worse than not asking");
});

// ── v520: a repaint must not move her ────────────────────────────────────────

test("★★★ a repaint keeps her place — the page does not jump to the top (v520)", async () => {
  // ⚠️⚠️ HER REPORT: __"when i look at screen, at after a while it rerender and the screen jump up"__.
  // ⭐ MEASURED on the real app before this: scrolled to 400, repainted, **0**. ⚠️ The cause is
  // `viewEl.replaceChildren()` — **the view is emptied, the document loses its height for an instant, and
  // the browser clamps the window's scroll.** ⭐⭐ And it is not really a jump: **the scroll is LOST.**
  // ⚠️ It only ever happens while she is looking, because the 30-second sync tick repaints the moment a
  // pulled change lands — ⭐ **that is the whole of "after a while".**
  freshDOM();
  installStorage({ "bakeadmin.v1": stateJSON() });
  try {
    await import("../admin/js/app.js?case=repaint");

    const scroller = document.scrollingElement;
    // ⚠️ EVERY listener the app registered, not `[0]` — ⭐ **a real route change runs them all**, and taking
    // the first one made this test pass whether the app put the scroll back or not.
    const listeners = window._listeners.hashchange || [];
    assert.ok(listeners.length, "the app does not listen for a route change — this test cannot drive a repaint");
    const repaint = () => listeners.forEach((f) => f());
    assert.ok(scroller, "the shim has no scrolling element, so nothing here can be observed");

    // ⭐ She is reading something, and the sync brings a change.
    scroller.scrollTop = 400;
    repaint();
    assert.equal(scroller.scrollTop, 400,
      "★ the page was dropped to the top by a repaint she did not ask for — **she was reading that part of "
      + "the screen and the sync took it away**");

    // ⚠️⚠️ AND THE OTHER HALF — that a repaint she DID ask for can still move her — **cannot be asserted
    // here, and is deliberately not pretended at.** A view that scrolls itself does it DURING its own
    // render (the receipt in `showConfirm`, the refusal line), and this shim has no layout, so there is
    // nothing for it to scroll to. ⭐ **An assertion that would pass either way is worse than none** — it
    // says a thing is watched when it is not.
    // ⭐ That half is MEASURED ON THE REAL APP instead: scrolled to 400 on the Orders screen, the sync's
    // repaint left it at 400, and a NAVIGATION to another screen behaved exactly as it did before.
  } finally { restore(); }
});
