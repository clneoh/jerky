// test/deliveries-sync.test.js — a holiday marked on the Delivery Dates screen
// is something the CUSTOMER's calendar draws, so changing one has to reach the
// storefront row and not only the shared-data sync.
//
// Regression this pins (found 14 Sep 2026): the three mark paths called
// maybeSync(), which publishes delivery dates and slots — never the storefront
// config. So Malaysia Day sat on her own calendar and the shop had never been
// told about it; the marks only reached the shop when some unrelated product or
// setting happened to be saved. The cheap correct fix is to run both syncs.
//
// The shim mirrors test/app.test.js: importing the view pulls in app.js, which
// boots into the DOM.

import { test } from "node:test";
import assert from "node:assert/strict";

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
    focus() {}, click() {},
  };
}

const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: createEl("body"),
};
globalThis.window = { addEventListener() {}, open() {}, location: { hash: "#/deliveries" } };
globalThis.location = globalThis.window.location;
globalThis.history = { replaceState() {} };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

// The cloud writes are debounced 2s (see supabase.js maybeSync / maybeSyncStorefront).
// Running the callback at once keeps the test honest about WHICH syncs fired
// without making it wait, and leaves a real macrotask for the awaited fetches.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { realSetTimeout(fn, 0); return 0; };

const posted = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes("/auth/v1/token")) {
    return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
  }
  if (opts.method === "POST") posted.push(String(url));
  return { ok: true, json: async () => [], text: async () => "" };
};

const { saveMarks } = await import("../admin/js/views/deliveries.js");

function cloudState() {
  return {
    version: 1,
    settings: {
      defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00",
      supabase: { enabled: true, url: "https://x.supabase.co", anonKey: "anon",
        email: "a@b.com", password: "p" },
      cloud: { enabled: true },
    },
    ingredients: [], products: [], deliveryDates: [], orders: [], purchaseOrders: [],
    credits: [], occasions: [],
  };
}

// Let the two syncs finish: each awaits a login + a POST.
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => realSetTimeout(r, 0)); };

test("a mark on the Delivery Dates screen publishes the shop's calendar too", async () => {
  const state = cloudState();
  state.occasions.push({ id: "occ1", from: "2026-09-16", to: "2026-09-16",
    label: "Malaysia Day", colour: "red" });

  posted.length = 0;
  saveMarks(state);
  await settle();

  assert.ok(posted.some((u) => u.includes("/rest/v1/storefront_config")),
    "the storefront snapshot is republished, so the customer's calendar gets the mark");
  assert.ok(posted.some((u) => u.includes("/rest/v1/availability")),
    "and the shared-data sync still runs, exactly as before");
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("bakeadmin.v1")).occasions,
    state.occasions, "the mark is still saved to this phone");
});

test("an empty mark list still publishes, so a removed mark leaves the shop", async () => {
  const state = cloudState(); // no marks at all
  state.occasions = [];
  posted.length = 0;
  saveMarks(state);
  await settle();
  assert.ok(posted.some((u) => u.includes("/rest/v1/storefront_config")),
    "the shop is told the calendar is now empty rather than being left wearing the old marks");
});
