// test/app.test.js — smoke tests for the bootstrap + shared-data gate.
// js/app.js boots into the DOM, so this shims a minimal document (like the
// store tests) and imports it fresh per scenario. Verifies the no-cloud path is
// unchanged and that the cloud gate appears/disappears as expected.

import { test } from "node:test";
import assert from "node:assert/strict";

const realLocalStorage = globalThis.localStorage;
const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
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
  globalThis.document = documentShim;
  globalThis.window = { addEventListener() {}, location: { hash: "#/dashboard" } };
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
