// test/storefront.config.test.js — the backoffice-published config overrides the
// static store/config.js at runtime, plus the order-intake POST. DOM shim mirrors
// store.test.js so store/app.js can render at import time.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
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
  body: createEl("body"),
};
globalThis.window = { open() {} };
const realFetch = globalThis.fetch;

// A config the backoffice might publish (Settings → Storefront). The
// storefront_config fetch returns it, so the page should re-render to it.
const remote = {
  name: "Jienluv2bake Cakes",
  tagline: "Cakes & more, Penang",
  whatsapp: "60111223344",
  instagram: "jienluv2bake",
  facebook: "",
  deliveryDays: [2, 4],
  cutoff: "15:00",
  capacity: 20,
  products: [
    { name: "Chocolate Cake", price: 55, unit: "whole", description: "Rich dark ganache, 3 layers" },
    { name: "Brownies", price: 10, unit: "box" },
  ],
};

globalThis.fetch = async (url) => {
  if (String(url).includes("storefront_config")) {
    return { ok: true, json: async () => [{ data: JSON.stringify(remote) }] };
  }
  return { ok: true, json: async () => [] }; // availability + product_availability
};

const { mergeStorefront, placeOrder } = await import("../store/app.js");
const { CONFIG } = await import("../store/config.js");

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

test("published config overrides the header and menu at runtime", async () => {
  await settle();

  assert.equal(registry["name"].textContent, "Jienluv2bake Cakes");
  assert.equal(registry["tagline"].textContent, "Cakes & more, Penang");
  assert.equal(registry["delivery-days"].textContent, "Tue, Thu");
  assert.equal(registry["cutoff"].textContent, "15:00 the day before");
  assert.equal(registry["social"].children.length, 1, "only Instagram links (facebook blank)");

  const cards = registry["menu"].children;
  assert.equal(cards.length, 2, "menu replaced with the published products");
  const title = cards[0].children[0].children[0].children[0];
  const sub = cards[0].children[0].children[0].children[1];
  const desc = cards[0].children[0].children[0].children[2];
  assert.equal(title.children[0].text, "Chocolate Cake");
  assert.equal(sub.children[0].text, "RM55.00 / whole");
  assert.ok(desc, "a published description renders under the price");
  assert.equal(desc.className, "prod-desc");
  assert.equal(desc.children[0].text, "Rich dark ganache, 3 layers");
  const bInner = cards[1].children[0].children[0];
  assert.equal(bInner.children[0].children[0].text, "Brownies");
  assert.equal(bInner.children.length, 2, "no description → no extra line under the name/price");
});

test("mergeStorefront replaces arrays wholesale and never touches supabase", () => {
  const base = {
    name: "A", deliveryDays: [1, 3, 5], capacity: 12, upcomingCount: 3,
    products: [{ name: "X", price: 1, unit: "u" }],
    supabase: { url: "u" },
  };
  const out = mergeStorefront(base, {
    name: "B",
    products: [{ name: "Y", price: 2, unit: "u", description: "Two lines\nthat wrap" },
      { name: "Z", price: 3, unit: "", description: "   " }],
    deliveryDays: [2, 4],
    supabase: { url: "EVIL" },
  });
  assert.equal(out.name, "B");
  assert.deepEqual(out.deliveryDays, [2, 4], "deliveryDays replaced, not key-merged");
  assert.deepEqual(out.products, [
    { name: "Y", price: 2, unit: "u", description: "Two lines\nthat wrap" },
    { name: "Z", price: 3, unit: "piece" },
  ], "a written description survives adoption; a blank one is dropped");
  assert.deepEqual(out.supabase, { url: "u" }, "the Supabase connection is never overridden");
  assert.equal(base.supabase.url, "u", "base is not mutated");
});

test("mergeStorefront ignores null and malformed values", () => {
  const base = { name: "A", cutoff: "18:00", capacity: 12, products: [{ name: "X", price: 1, unit: "u" }] };
  assert.deepEqual(mergeStorefront(base, null), base);
  assert.deepEqual(mergeStorefront(base, {}), base);
  const messy = mergeStorefront(base, {
    cutoff: "", whatsapp: "   ", name: 42, capacity: 0,
    deliveryDays: [8, 1.5, "x"],
    products: [{ name: "  " }, null],
  });
  assert.deepEqual(messy, base, "malformed fields fall back to the local values");
});

test("placeOrder posts the order to incoming_orders", async () => {
  CONFIG.supabase = { url: "https://x.supabase.co", anonKey: "anon" };
  let call = null;
  globalThis.fetch = async (url, opts) => {
    call = { url, opts };
    return { ok: true };
  };
  try {
    const r = await placeOrder({ customer: "A", date: "2026-09-02", lines: [{ name: "X", qty: 1, price: 5 }], total: 5 });
    assert.deepEqual(r, { ok: true });
    assert.ok(call.url.includes("/rest/v1/incoming_orders"));
    assert.equal(call.opts.method, "POST");
    assert.equal(call.opts.headers.apikey, "anon");
    const body = JSON.parse(call.opts.body);
    assert.equal(body.length, 1);
    const payload = JSON.parse(body[0].data);
    assert.equal(payload.customer, "A");
    assert.equal(payload.date, "2026-09-02");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("placeOrder returns {ok:false} when the fetch rejects (offline)", async () => {
  CONFIG.supabase = { url: "https://x.supabase.co", anonKey: "anon" };
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    assert.deepEqual(await placeOrder({}), { ok: false });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("placeOrder returns {ok:false} when no Supabase is configured", async () => {
  CONFIG.supabase = { url: "", anonKey: "" };
  assert.deepEqual(await placeOrder({}), { ok: false });
});
