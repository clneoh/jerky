import { test } from "node:test";
import assert from "node:assert/strict";
import { generateUpcomingDates } from "../admin/js/dates.js";
import { computeSlots, computeProductSlots, syncAvailability, login, syncStorefront, pullIncoming, publishTracking, trackingSnapshot, refreshStorefront, pendingReviewCount } from "../admin/js/supabase.js";
import { groupOrders, orderCode } from "../admin/js/state.js";

const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;

function baseSettings() {
  return { defaultCapacity: 12, deliveryDays: [1, 3, 5], cutoff: "18:00", currency: "RM" };
}

// A state whose deliveryDates match the next 10 real upcoming delivery days
// (the sync horizon), so computeSlots yields one row per real date.
function makeState(ordersByDate = {}) {
  const settings = baseSettings();
  const dates = generateUpcomingDates(settings, 10);
  const deliveryDates = dates.map((date, i) => ({
    id: `del_${i}`,
    date,
    notes: "",
  }));
  const orders = [];
  let n = 0;
  for (const [date, qtys] of Object.entries(ordersByDate)) {
    const del = deliveryDates.find((d) => d.date === date);
    for (const qty of qtys) {
      orders.push({
        id: `ord_${n++}`,
        deliveryDateId: del.id,
        productId: "prd_1",
        qty,
        customerName: "Test",
        note: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }
  }
  return { version: 1, settings, ingredients: [], products: [{ id: "prd_1", name: "Focaccia", active: true }], deliveryDates, orders, purchaseOrders: [] };
}

test("computeSlots maps orders to slots_left, clamping at 0", () => {
  const dates = generateUpcomingDates(baseSettings(), 4);
  const state = makeState({ [dates[0]]: [3, 2], [dates[1]]: [5, 5, 5] });

  const rows = computeSlots(state, 10);
  assert.equal(rows.length, 10); // horizon
  const row0 = rows.find((r) => r.date === dates[0]);
  const row1 = rows.find((r) => r.date === dates[1]);
  const row2 = rows.find((r) => r.date === dates[2]);
  const row3 = rows.find((r) => r.date === dates[3]);
  assert.deepEqual(row0, { date: dates[0], slots_left: 7, capacity: 12 }); // 12 - (3+2)
  assert.deepEqual(row1, { date: dates[1], slots_left: 0, capacity: 12 }); // over → clamped to 0
  assert.deepEqual(row2, { date: dates[2], slots_left: 12, capacity: 12 }); // nothing booked → default capacity
  assert.deepEqual(row3, { date: dates[3], slots_left: 12, capacity: 12 }); // no deliveryDates entry → default
});

test("computeSlots sums product daily limits into the day capacity", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState({ [dates[0]]: [3, 2] });
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
  ];

  const rows = computeSlots(state, 10);
  const row0 = rows.find((r) => r.date === dates[0]);
  const row1 = rows.find((r) => r.date === dates[1]);
  assert.deepEqual(row0, { date: dates[0], slots_left: 19, capacity: 24 }); // 24 - (3+2)
  assert.equal(row1.capacity, 24);
});

test("computeSlots dedupes duplicate delivery dates and sums their bookings", () => {
  const date = generateUpcomingDates(baseSettings(), 1)[0];
  const state = makeState();
  state.deliveryDates = [
    { id: "del_a", date, notes: "" },
    { id: "del_b", date, notes: "" },
  ];
  state.orders = [
    { id: "o1", deliveryDateId: "del_a", productId: "prd_1", qty: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "o2", deliveryDateId: "del_b", productId: "prd_1", qty: 2, createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const rows = computeSlots(state, 10);
  const dups = rows.filter((r) => r.date === date);
  assert.equal(dups.length, 1, "one published row per date despite duplicate deliveryDates");
  assert.deepEqual(dups[0], { date, slots_left: 7, capacity: 12 }, "bookings on both ids count");
});

test("product limits are ignored when no product has one (default capacity)", () => {
  const dates = generateUpcomingDates(baseSettings(), 1);
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true }, // no limit
  ];
  const rows = computeSlots(state, 10);
  const row = rows.find((r) => r.date === dates[0]);
  assert.deepEqual(row, { date: dates[0], slots_left: 12, capacity: 12 }); // falls back to the default capacity
});

test("syncAvailability returns ok:false when not configured", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  try {
    const r = await syncAvailability(makeState());
    assert.deepEqual(r, { ok: false, reason: "Supabase not configured" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("login posts credentials and returns the token", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ access_token: "tok_abc", expires_in: 3600 }) };
  };
  try {
    const token = await login("https://x.supabase.co/", "anonkey", "a@b.c", "pw");
    assert.equal(token, "tok_abc");
    assert.ok(calls[0].url.includes("/auth/v1/token?grant_type=password"));
    assert.equal(calls[0].opts.headers.apikey, "anonkey");
    assert.equal(JSON.parse(calls[0].opts.body).email, "a@b.c");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("syncAvailability upserts rows with auth headers", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncAvailability(state);
    assert.ok(r.ok);
    assert.equal(r.pushed, 10);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/availability"));
    assert.ok(upsert.url.includes("?on_conflict=date"));
    assert.equal(upsert.opts.headers.apikey, "anon");
    assert.equal(upsert.opts.headers.Authorization, "Bearer tok");
    assert.equal(upsert.opts.headers.Prefer, "resolution=merge-duplicates,return=minimal");
    const body = JSON.parse(upsert.opts.body);
    assert.ok(Array.isArray(body) && body.length === 10);
    assert.ok(body.every((r) => typeof r.date === "string" && typeof r.slots_left === "number"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("second sync reuses the cached token instead of logging in again", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  let authCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/auth/v1/token")) { authCalls++; return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) }; }
    return { ok: true, text: async () => "" };
  };
  try {
    const r1 = await syncAvailability(state);
    const r2 = await syncAvailability(state);
    assert.ok(r1.ok && r2.ok);
    assert.equal(authCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("computeProductSlots returns per-product rows only for products with a limit", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState({ [dates[0]]: [3, 2] });
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
    { id: "prd_3", name: "Cookie", active: true }, // no limit → unlimited, no row
  ];

  const rows = computeProductSlots(state, 10);
  assert.equal(rows.length, 20); // 2 limited products × 10 days
  const f0 = rows.find((r) => r.date === dates[0] && r.product === "Focaccia");
  const s0 = rows.find((r) => r.date === dates[0] && r.product === "Sandwich");
  assert.deepEqual(f0, { date: dates[0], product: "Focaccia", slots_left: 7, capacity: 12 }); // 12 - (3+2)
  assert.deepEqual(s0, { date: dates[0], product: "Sandwich", slots_left: 12, capacity: 12 });
  assert.ok(rows.every((r) => r.product !== "Cookie"));
});

test("syncAvailability upserts per-product rows when products have limits", async () => {
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncAvailability(state);
    assert.ok(r.ok);
    assert.equal(r.pushed, 10);
    assert.equal(r.pushedProducts, 20);
    const day = calls.find((c) => c.url.includes("/rest/v1/availability?"));
    assert.ok(day.url.includes("?on_conflict=date"));
    const prod = calls.find((c) => c.url.includes("/rest/v1/product_availability"));
    assert.ok(prod.url.includes("?on_conflict=date,product"));
    const body = JSON.parse(prod.opts.body);
    assert.equal(body.length, 20);
    assert.ok(body.every((r) => typeof r.date === "string" && typeof r.product === "string" && typeof r.slots_left === "number"));
    assert.ok(body.every((r) => r.capacity === 12));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("syncAvailability publishes every real delivery date, not just the nearest 10", async () => {
  const state = makeState();
  const wide = generateUpcomingDates(baseSettings(), 14);
  state.deliveryDates = wide.map((date, i) => ({ id: `del_${i}`, date, notes: "" }));
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncAvailability(state);
    assert.ok(r.ok);
    assert.equal(r.pushed, 14, "one day row per real date, no 10-date cap");
    assert.equal(r.pushedProducts, 28); // 2 limited products × 14 days
    const day = calls.find((c) => c.url.includes("/rest/v1/availability?"));
    const prod = calls.find((c) => c.url.includes("/rest/v1/product_availability"));
    assert.equal(JSON.parse(day.opts.body).length, 14);
    assert.equal(JSON.parse(prod.opts.body).length, 28);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("syncAvailability pushes value-pack rows as a separate uniform batch (no PGRST102)", async () => {
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    // A 4-piece value pack: one product line, no limit of its own → poolable.
    { id: "prd_2", name: "Focaccia Family (4 pcs)", active: true, recipe: [{ productId: "prd_1", qty: 4, unit: "box" }] },
    { id: "prd_3", name: "Sandwich", active: true, limit: 12 },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncAvailability(state);
    assert.ok(r.ok);
    assert.equal(r.pushedProducts, 30); // 2 bases + 1 pack × 10 dates
    const upserts = calls.filter((c) => c.url.includes("on_conflict=date,product"));
    assert.equal(upserts.length, 2, "plain rows and value-pack rows are two separate upserts");
    const [plain, pack] = upserts;
    const plainBody = JSON.parse(plain.opts.body);
    const packBody = JSON.parse(pack.opts.body);
    assert.equal(plainBody.length, 20);
    assert.equal(packBody.length, 10);
    assert.ok(plainBody.every((row) => !("pool_base" in row)), "plain batch never carries pool keys");
    assert.ok(packBody.every((row) => "pool_base" in row && "pool_qty" in row), "pack batch carries pool keys");
    const keyShape = (rows) => new Set(rows.map((row) => Object.keys(row).sort().join(",")));
    assert.equal(keyShape(plainBody).size, 1, "all plain rows share one key shape");
    assert.equal(keyShape(packBody).size, 1, "all pack rows share one key shape");
    const plainKeys = [...keyShape(plainBody)][0];
    const packKeys = [...keyShape(packBody)][0];
    assert.equal(packKeys, plainKeys.split(",").concat("pool_base", "pool_qty").sort().join(","));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("syncStorefront returns ok:false when not configured", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  try {
    const r = await syncStorefront(makeState());
    assert.deepEqual(r, { ok: false, reason: "Supabase not configured" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("syncStorefront publishes the whole config to storefront_config", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.settings.storefront = {
    whatsapp: "60123456789", name: "Jienluv2bake", tagline: "Focaccia & sandwiches",
    instagram: "jen", facebook: "jenbakes", tngQr: "https://img/tng.png",
  };
  // The storefront menu comes from the backoffice product list (single source
  // of truth) — state.products.price/unit feed the published menu.
  state.products = [{ id: "prd_1", name: "Focaccia", price: 15, unit: "loaf", active: true,
    description: "Crisp rosemary crust, airy crumb" }];
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncStorefront(state);
    assert.ok(r.ok);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/storefront_config"));
    assert.ok(upsert.url.includes("?on_conflict=id"));
    assert.equal(upsert.opts.headers.Authorization, "Bearer tok");
    assert.equal(upsert.opts.headers.Prefer, "resolution=merge-duplicates,return=minimal");
    const body = JSON.parse(upsert.opts.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "default");
    const payload = JSON.parse(body[0].data);
    assert.equal(payload.whatsapp, "60123456789");
    assert.equal(payload.name, "Jienluv2bake");
    assert.equal(payload.tngQr, "https://img/tng.png");
    assert.ok(!("setDays" in payload), "no global value-pack window — date rules live on each product");
    assert.deepEqual(payload.deliveryDays, [1, 3, 5]);
    assert.equal(payload.capacity, 12);
    assert.deepEqual(payload.products,
      [{ name: "Focaccia", price: 15, unit: "loaf", description: "Crisp rosemary crust, airy crumb" }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("storefront payload publishes the set's component and its per-product date rules", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.settings.storefront = { whatsapp: "60123456789", name: "Jienluv2bake" };
  state.products = [
    { id: "prd_1", name: "Focaccia", price: 15, unit: "loaf", active: true, limit: 12 },
    { id: "prd_2", name: "Focaccia Value Pack (4)", price: 54, unit: "set", active: true,
      recipe: [{ productId: "prd_1", qty: 4 }], closeDays: 3, validFrom: "2026-12-01", validTo: "2026-12-24" },
  ];
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncStorefront(state);
    assert.ok(r.ok);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/storefront_config"));
    const payload = JSON.parse(JSON.parse(upsert.opts.body)[0].data);
    assert.deepEqual(payload.products.find((p) => p.name === "Focaccia Value Pack (4)"),
      { name: "Focaccia Value Pack (4)", price: 54, unit: "set", component: { name: "Focaccia", qty: 4 },
        closeDays: 3, validFrom: "2026-12-01", validTo: "2026-12-24" });
    // A product without rules publishes no date keys at all — the storefront's
    // pack default (14) is applied on its side.
    const base = payload.products.find((p) => p.name === "Focaccia");
    assert.ok(!("closeDays" in base) && !("validFrom" in base) && !("validTo" in base));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("storefront payload carries the product's shop names (中文/BM) and the developer credit", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.settings.storefront = { whatsapp: "60123456789", name: "Munchies Furkidz" };
  state.settings.developer = { name: "  Dev Studio  ", emails: ["a@b.com", "   ", "c@d.com"], whatsapp: " 012-345 6789 " };
  state.products = [
    { id: "prd_1", name: "Chicken Jerky", price: 15, unit: "pouch", active: true, nameZh: "鸡肉干", nameMs: "Jerky Ayam" },
    { id: "prd_2", name: "Turkey Jerky", price: 8, unit: "pouch", active: true, nameZh: "  " },
  ];
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncStorefront(state);
    assert.ok(r.ok);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/storefront_config"));
    const payload = JSON.parse(JSON.parse(upsert.opts.body)[0].data);
    const chicken = payload.products.find((p) => p.name === "Chicken Jerky");
    const turkey = payload.products.find((p) => p.name === "Turkey Jerky");
    assert.equal(chicken.nameZh, "鸡肉干");
    assert.equal(chicken.nameMs, "Jerky Ayam");
    assert.ok(!("nameMs" in turkey), "a blank BM name is not published — the shop falls back to English");
    assert.ok(!("nameZh" in turkey), "a blank 中文 name is not published either");
    assert.equal(payload.developerName, "Dev Studio");
    assert.deepEqual(payload.developerEmails, ["a@b.com", "c@d.com"], "blank developer emails are dropped");
    assert.equal(payload.developerWhatsapp, "012-345 6789", "the developer's WhatsApp number is published");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("storefront payload omits the developer keys until a name + email are set", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.settings.storefront = { whatsapp: "60123456789", name: "Munchies Furkidz" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await syncStorefront(state);
    assert.ok(r.ok);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/storefront_config"));
    const payload = JSON.parse(JSON.parse(upsert.opts.body)[0].data);
    assert.ok(!("developerName" in payload), "no developer key before it is configured");
    assert.ok(!("developerEmails" in payload));
    assert.ok(!("developerWhatsapp" in payload), "a blank WhatsApp number is not published either");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pullIncoming is a no-op when not configured", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    const r = await pullIncoming(makeState());
    assert.deepEqual(r, { ok: false, imported: [] });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

function storageShim(store) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

test("pullIncoming imports storefront orders, marks and deletes the rows", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true },
    { id: "prd_2", name: "Sandwich", active: true },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = {
    id: "abc-123",
    data: JSON.stringify({
      customer: "Ain", date: "2026-09-04", total: 30,
      lines: [{ name: "Focaccia", qty: 2, price: 15 }],
      note: "no rosemary",
    }),
  };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || "GET" });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) return { ok: true, json: async () => [row] };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    assert.deepEqual(r.imported, ["abc-123"]);
    assert.equal(state.orders.length, 1);
    const o = state.orders[0];
    assert.equal(o.status, "new");
    assert.equal(o.source, "storefront");
    assert.equal(o.productId, "prd_1");
    assert.equal(o.qty, 2);
    assert.equal(o.customerName, "Ain");
    assert.equal(o.note, "no rosemary");
    assert.equal(o.fulfillment, "collect", "no method sent → self collect");
    assert.equal(o.address, "");
    assert.equal(o.deliveryDate, "2026-09-04");
    const del = state.deliveryDates.find((d) => d.date === "2026-09-04");
    assert.ok(del, "delivery date exists");
    assert.equal(o.deliveryDateId, del.id);
    const mark = calls.find((c) => c.method === "PATCH" && c.url.includes("incoming_orders"));
    assert.ok(mark, "row is marked imported first");
    const gone = calls.find((c) => c.method === "DELETE" && c.url.includes("incoming_orders"));
    assert.ok(gone, "row is deleted after import");
    assert.ok(gone.url.includes("id=eq.abc-123"));
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("pullIncoming groups a multi-item storefront order under one groupId", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true },
    { id: "prd_2", name: "Sandwich", active: true },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = {
    id: "abc-456",
    data: JSON.stringify({
      customer: "Ain", date: "2026-09-04", total: 30,
      lines: [{ name: "Focaccia", qty: 2, price: 15 }, { name: "Sandwich", qty: 1, price: 8 }],
    }),
  };
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) return { ok: true, json: async () => [row] };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    assert.equal(state.orders.length, 2, "each item is its own row for availability math");
    const [o1, o2] = state.orders;
    assert.equal(o1.productId, "prd_1");
    assert.equal(o2.productId, "prd_2");
    assert.ok(o1.groupId, "multi-item order gets a groupId");
    assert.equal(o2.groupId, o1.groupId, "both items share the group");
    assert.equal(o1.createdAt, o2.createdAt);
    assert.equal(groupOrders(state.orders).length, 1, "they count as one customer order");
    assert.equal(o2.qty, 1);
    assert.equal(o1.customerName, "Ain");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("pullIncoming skips items with no matching backoffice product", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [{ id: "prd_1", name: "Focaccia", active: true }];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = { id: "abc", data: JSON.stringify({ customer: "X", date: "2099-01-05", lines: [{ name: "Cookies", qty: 3, price: 5 }] }) };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || "GET" });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) return { ok: true, json: async () => [row] };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    assert.deepEqual(r.imported, []);
    assert.equal(state.orders.length, 0);
    assert.equal(calls.some((c) => c.method === "PATCH" && c.url.includes("incoming_orders")), false,
      "unimportable row is not claimed — it stays in the queue to retry later");
    assert.equal(calls.some((c) => c.method === "DELETE" && c.url.includes("incoming_orders")), false,
      "unimportable row is not deleted");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("pullIncoming copies fulfillment, address and whatsapp from the order", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [{ id: "prd_1", name: "Focaccia", active: true }];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = {
    id: "abc-789",
    data: JSON.stringify({
      customer: "Ain", date: "2026-09-04", total: 30,
      lines: [{ name: "Focaccia", qty: 2, price: 15 }],
      whatsapp: "60123456789", fulfillment: "courier", address: "12 Jalan Bunga, Penang",
    }),
  };
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) return { ok: true, json: async () => [row] };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    const o = state.orders[0];
    assert.equal(o.whatsapp, "60123456789");
    assert.equal(o.fulfillment, "courier");
    assert.equal(o.address, "12 Jalan Bunga, Penang");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("pullIncoming skips a row another phone already claimed (no double import)", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [{ id: "prd_1", name: "Focaccia", active: true }];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = { id: "abc-dup", data: JSON.stringify({ customer: "Ain", date: "2026-09-04", lines: [{ name: "Focaccia", qty: 1, price: 15 }] }) };
  let claims = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    // The claim matches nothing — another phone already flipped it to imported.
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) { claims++; return { ok: true, json: async () => [] }; }
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    assert.deepEqual(r.imported, []);
    assert.equal(state.orders.length, 0, "a row already claimed elsewhere is not imported twice");
    assert.equal(claims, 1, "the claim was attempted exactly once");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("trackingSnapshot renders one customer order into one published row", () => {
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", price: 15, active: true },
    { id: "prd_2", name: "Sandwich", price: 8, active: true },
  ];
  const date = state.deliveryDates[0];
  const group = { orders: [
    { id: "ord_1", groupId: "ordg_112233445566", deliveryDateId: date.id, productId: "prd_1", qty: 2,
      customerName: "Ain", fulfillment: "collect", status: "baking", createdAt: "2026-09-01T14:32:00" },
    { id: "ord_2", groupId: "ordg_112233445566", deliveryDateId: date.id, productId: "prd_2", qty: 1,
      customerName: "Ain", fulfillment: "collect", status: "baking", createdAt: "2026-09-01T14:32:00" },
  ] };
  const snap = trackingSnapshot(state, group);
  assert.equal(snap.code, "445566", "group id drives the shared code");
  assert.equal(snap.status, "baking");
  assert.equal(snap.items, "Focaccia ×2, Sandwich ×1");
  assert.equal(snap.total, "RM 38.00"); // 2×15 + 1×8
  assert.ok(snap.delivery.includes("Collect (local)"));
  assert.equal(snap.customer, "Ain");
  assert.ok(snap.updated_at, "snapshot is stamped");
  assert.equal(snap.confirmed_sent, true, "a baking order's confirmation is behind it (no flag = done)");
  assert.equal(snap.paid_received, true, "a baking order's payment is behind it (no flag = done)");
});

test("trackingSnapshot includes the courier address in delivery", () => {
  const state = makeState();
  state.products = [{ id: "prd_1", name: "Focaccia", price: 15, active: true }];
  const date = state.deliveryDates[0];
  const group = { orders: [{
    id: "ord_1", deliveryDateId: date.id, productId: "prd_1", qty: 1,
    fulfillment: "courier", address: "12 Jalan Bunga, Penang", status: "ready", createdAt: "2026-09-01T14:32:00",
  }] };
  const snap = trackingSnapshot(state, group);
  assert.ok(snap.delivery.includes("Post (nationwide)"));
  assert.ok(snap.delivery.includes("12 Jalan Bunga, Penang"));
});

test("publishTracking upserts the order's row keyed on the code", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.products = [{ id: "prd_1", name: "Focaccia", price: 15, active: true }];
  const date = state.deliveryDates[0];
  const group = { orders: [{
    id: "ord_ab12cd34ef56", deliveryDateId: date.id, productId: "prd_1", qty: 2,
    customerName: "Ain", whatsapp: "60123456789", fulfillment: "courier", address: "12 Jalan Bunga, Penang",
    status: "confirmed", createdAt: "2026-09-01T14:32:00",
  }] };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    await publishTracking(state, group);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/order_tracking"));
    assert.ok(upsert, "publishes to order_tracking");
    assert.ok(upsert.url.includes("?on_conflict=code"));
    assert.equal(upsert.opts.headers.Authorization, "Bearer tok");
    assert.equal(upsert.opts.headers.Prefer, "resolution=merge-duplicates,return=minimal");
    const body = JSON.parse(upsert.opts.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].code, orderCode(group.orders[0]));
    assert.equal(body[0].status, "confirmed");
    assert.ok(body[0].delivery.includes("Post (nationwide)"));
    assert.equal(body[0].items, "Focaccia ×2");
    assert.equal(body[0].total, "RM 30.00");
    assert.equal(body[0].customer, "Ain");
    assert.equal(body[0].confirmed_sent, true, "legacy confirmed order without a flag publishes as sent");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("trackingSnapshot publishes false flags while a stage waits on the baker", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  state.products = [{ id: "prd_1", name: "Focaccia", price: 15, active: true }];
  const date = state.deliveryDates[0];
  const group = { orders: [{
    id: "ord_ab12cd34ef56", deliveryDateId: date.id, productId: "prd_1", qty: 2,
    customerName: "Ain", fulfillment: "collect", status: "confirmed",
    confirmedSent: false, // picked Confirmed but "Send confirmation" not pressed yet
    createdAt: "2026-09-01T14:32:00",
  }] };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, text: async () => "" };
  };
  try {
    await publishTracking(state, group);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/order_tracking"));
    const body = JSON.parse(upsert.opts.body);
    assert.equal(body[0].confirmed_sent, false, "Confirmation not sent → publishes false so the customer's map still flashes Confirmed");
    assert.equal(body[0].paid_received, true, "paid not reached yet → flag reads as done/true");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("publishTracking is a silent no-op when tracking is unconfigured", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    await publishTracking(makeState(), { orders: [{ id: "ord_1" }] });
    assert.equal(called, false, "no fetch when Supabase is off");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("refreshStorefront adopts the latest published storefront into the phone's state", async () => {
  storageShim(new Map());
  const state = makeState();
  state.settings.supabase = { url: "https://x.supabase.co", anonKey: "anon" };
  state.settings.storefront = { name: "", whatsapp: "", tagline: "", instagram: "", facebook: "", tngQr: "", products: [] };
  const remote = {
    name: "Jienluv2bake Cakes", whatsapp: "60111223344", tagline: "Cakes & more",
    instagram: "jienluv2bake", facebook: "", tngQr: "https://img/qr.png",
  };
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).includes("storefront_config"), "reads the published config row");
    assert.equal(opts.headers.apikey, "anon", "public read — anon key only, no login needed");
    return { ok: true, json: async () => [{ data: JSON.stringify(remote) }] };
  };
  try {
    const adopted = await refreshStorefront(state);
    assert.equal(adopted, true);
    assert.equal(state.settings.storefront.name, "Jienluv2bake Cakes");
    assert.equal(state.settings.storefront.whatsapp, "60111223344");
    assert.equal(state.settings.storefront.tagline, "Cakes & more");
    assert.equal(state.settings.storefront.instagram, "jienluv2bake");
    assert.equal(state.settings.storefront.facebook, "");
    assert.equal(state.settings.storefront.tngQr, "https://img/qr.png");
    assert.equal(state.settings.storefront.products.length, 0, "the menu is not adopted — it stays managed per phone");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("refreshStorefront keeps the local copy when the published row is missing or nameless", async () => {
  storageShim(new Map());
  const state = makeState();
  state.settings.supabase = { url: "https://x.supabase.co", anonKey: "anon" };
  state.settings.storefront = { name: "Local", whatsapp: "60111111111", tagline: "", instagram: "", facebook: "", tngQr: "", products: [] };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => [] }; };
  try {
    assert.equal(await refreshStorefront(state), false, "no row → keep local");
    assert.equal(state.settings.storefront.name, "Local", "local copy untouched");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }

  calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => [{ data: JSON.stringify({ tagline: "no name" }) }] }; };
  try {
    assert.equal(await refreshStorefront(state), false, "published row without a name → keep local");
    assert.equal(state.settings.storefront.name, "Local");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("refreshStorefront is a silent no-op when Supabase url/anon are missing", async () => {
  storageShim(new Map());
  const state = makeState();
  state.settings.supabase = { url: "", anonKey: "" };
  state.settings.storefront = { name: "Local", whatsapp: "", tagline: "", instagram: "", facebook: "", tngQr: "", products: [] };
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    assert.equal(await refreshStorefront(state), false);
    assert.equal(called, false, "no fetch when there is nothing to read");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

test("computeProductSlots publishes derived pack rows that floor the base pool", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState({ [dates[0]]: [3, 2] }); // 5 single focaccia pieces booked
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    // A 4-piece value pack: one product line, no limit of its own → poolable.
    { id: "prd_2", name: "Focaccia Family (4 pcs)", active: true, recipe: [{ productId: "prd_1", qty: 4, unit: "box" }] },
    { id: "prd_3", name: "Sandwich", active: true, limit: 12 }, // separate base, no pack
  ];

  const rows = computeProductSlots(state, 10);
  assert.equal(rows.length, 30, "2 bases + 1 derived row × 10 days");
  const d0 = dates[0];
  const base = rows.find((r) => r.date === d0 && r.product === "Focaccia");
  const pack = rows.find((r) => r.date === d0 && r.product === "Focaccia Family (4 pcs)");
  const snd = rows.find((r) => r.date === d0 && r.product === "Sandwich");
  assert.deepEqual(base, { date: d0, product: "Focaccia", slots_left: 7, capacity: 12 });
  // 12 − 5 booked = 7 pieces → floor(7 ÷ 4) = 1 pack; capacity floors too.
  assert.deepEqual(pack, {
    date: d0, product: "Focaccia Family (4 pcs)",
    slots_left: 1, capacity: 3, pool_base: "Focaccia", pool_qty: 4,
  });
  assert.deepEqual(snd, { date: d0, product: "Sandwich", slots_left: 12, capacity: 12 });
  // Derived rows never outnumber their base's date rows, and the base product
  // itself has no pool markers (it IS the pool).
  assert.ok(rows.filter((r) => r.product === "Focaccia").every((r) => !("pool_base" in r)));
  assert.ok(rows.filter((r) => r.product === "Focaccia Family (4 pcs)").every((r) => r.pool_qty === 4));
});

test("computeProductSlots: pack orders draw the base pool down in whole pieces", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState({ [dates[0]]: [3, 2] }); // 5 single focaccia pieces booked
  const del = state.deliveryDates.find((d) => d.date === dates[0]);
  state.orders.push({
    id: "ord_pack", deliveryDateId: del.id, productId: "prd_2", qty: 1,
    customerName: "Test", note: "", createdAt: "2026-01-01T00:00:00.000Z",
  });
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Focaccia Family (4 pcs)", active: true, recipe: [{ productId: "prd_1", qty: 4, unit: "box" }] },
    { id: "prd_3", name: "Sandwich", active: true, limit: 12 },
  ];

  const rows = computeProductSlots(state, 10);
  const d0 = dates[0];
  const base = rows.find((r) => r.date === d0 && r.product === "Focaccia");
  const pack = rows.find((r) => r.date === d0 && r.product === "Focaccia Family (4 pcs)");
  // 12 − 5 singles − 1 pack × 4 pieces = 3 pieces → base 3, pack floor(3 ÷ 4) = 0.
  assert.equal(base.slots_left, 3);
  assert.equal(pack.slots_left, 0);
});

test("computeSlots day capacity reflects a delta on one date and leaves others alone", () => {
  const dates = generateUpcomingDates(baseSettings(), 3);
  const state = makeState({ [dates[0]]: [2] }); // 2 pieces booked on the first date
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
  ];
  const del0 = state.deliveryDates.find((d) => d.date === dates[0]);
  del0.dayAdj = { prd_1: 5 }; // raise Focaccia by 5 for this day only
  const rows = computeSlots(state, 10);
  assert.deepEqual(rows.find((r) => r.date === dates[0]),
    { date: dates[0], slots_left: 27, capacity: 29 }, "17 + 12 − 2 booked");
  assert.deepEqual(rows.find((r) => r.date === dates[1]),
    { date: dates[1], slots_left: 24, capacity: 24 }, "the next date keeps its baseline");
});

test("computeSlots publishes a closed day (capacity 0) when every product is paused", () => {
  const dates = generateUpcomingDates(baseSettings(), 1);
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Sandwich", active: true, limit: 12 },
  ];
  const del0 = state.deliveryDates.find((d) => d.date === dates[0]);
  del0.dayAdj = { prd_1: -12, prd_2: -12 }; // nothing baked that day
  const rows = computeSlots(state, 10);
  const r0 = rows.find((r) => r.date === dates[0]);
  assert.equal(r0.capacity, 0, "day capacity closes");
  assert.equal(r0.slots_left, 0);
});

test("computeProductSlots derives pack rows from a day-adjusted base", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState({ [dates[0]]: [2] }); // 2 single focaccia pieces booked
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
    { id: "prd_2", name: "Focaccia Family (4 pcs)", active: true, recipe: [{ productId: "prd_1", qty: 4, unit: "box" }] },
  ];
  const del0 = state.deliveryDates.find((d) => d.date === dates[0]);
  del0.dayAdj = { prd_1: 5 }; // 17 pieces that day
  const rows = computeProductSlots(state, 10);
  assert.equal(rows.length, 20, "1 base + 1 derived pack × 10 days");
  assert.deepEqual(rows.find((r) => r.date === dates[0] && r.product === "Focaccia"),
    { date: dates[0], product: "Focaccia", slots_left: 15, capacity: 17 });
  assert.deepEqual(rows.find((r) => r.date === dates[0] && r.product === "Focaccia Family (4 pcs)"),
    { date: dates[0], product: "Focaccia Family (4 pcs)", slots_left: 3, capacity: 4,
      pool_base: "Focaccia", pool_qty: 4 },
    "17 → floor(÷4) = 4 packs on offer; 15 left → 3 packs");
  assert.equal(rows.find((r) => r.date === dates[1] && r.product === "Focaccia").capacity, 12,
    "the next day stays at the usual 12");
});

test("computeProductSlots publishes zeros for a paused product's day", () => {
  const dates = generateUpcomingDates(baseSettings(), 2);
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true, limit: 12 },
  ];
  const del0 = state.deliveryDates.find((d) => d.date === dates[0]);
  del0.dayAdj = { prd_1: -12 }; // paused just for this day
  const rows = computeProductSlots(state, 10);
  assert.deepEqual(rows.find((r) => r.date === dates[0] && r.product === "Focaccia"),
    { date: dates[0], product: "Focaccia", slots_left: 0, capacity: 0 }, "paused → sold out");
  assert.equal(rows.find((r) => r.date === dates[1] && r.product === "Focaccia").capacity, 12);
});

test("pullIncoming imports a value-pack order and ignores its pool array", async () => {
  storageShim(new Map());
  const state = makeState();
  state.products = [
    { id: "prd_1", name: "Focaccia", active: true },
    { id: "prd_2", name: "Focaccia Family (4 pcs)", active: true },
  ];
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const row = {
    id: "abc-pack",
    data: JSON.stringify({
      customer: "Ain", date: "2026-09-04", total: 54,
      // lines carry the pack the customer sees; pool is only for the database
      // availability math and must never become an extra order row.
      lines: [{ name: "Focaccia Family (4 pcs)", qty: 1, price: 54 }],
      pool: [{ name: "Focaccia", qty: 4 }],
    }),
  };
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/incoming_orders") && !(opts && opts.method)) return { ok: true, json: async () => [row] };
    if (url.includes("/rest/v1/incoming_orders") && (opts && opts.method === "PATCH")) return { ok: true, json: async () => [row] };
    return { ok: true, text: async () => "" };
  };
  try {
    const r = await pullIncoming(state);
    assert.ok(r.ok);
    assert.deepEqual(r.imported, ["abc-pack"]);
    assert.equal(state.orders.length, 1, "the pool key adds no extra order rows");
    const o = state.orders[0];
    assert.equal(o.productId, "prd_2");
    assert.equal(o.qty, 1);
    assert.equal(o.groupId, null, "a single line order stays its own order");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLocalStorage;
  }
});

// ── pendingReviewCount — "how many reviews are waiting to be published" ──────
// Reviews aren't in local state; screens that want to hint "N waiting" ask the
// cloud. null means "don't know / off the cloud" (show nothing); 0 means none.

test("pendingReviewCount returns null when Supabase isn't configured (no fetch)", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    const n = await pendingReviewCount(makeState()); // makeState has no supabase cfg
    assert.equal(n, null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pendingReviewCount counts only unpublished reviews, authenticated", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/rest/v1/reviews")) return { ok: true, json: async () => [{ id: 1 }, { id: 2 }, { id: 3 }] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const n = await pendingReviewCount(state);
    assert.equal(n, 3);
    const rev = calls.find((c) => c.url.includes("/rest/v1/reviews"));
    assert.ok(rev, "asked the reviews table");
    assert.ok(rev.url.includes("published=eq.false"), "counts only the unpublished");
    assert.equal(rev.opts.headers.apikey, "anon");
    assert.equal(rev.opts.headers.Authorization, "Bearer tok");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pendingReviewCount returns 0 when nothing is waiting", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  globalThis.fetch = async (url) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, json: async () => [] };
  };
  try {
    assert.equal(await pendingReviewCount(state), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pendingReviewCount returns null on an HTTP failure", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  globalThis.fetch = async (url) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: false, status: 500 };
  };
  try {
    assert.equal(await pendingReviewCount(state), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pendingReviewCount returns null on an unreadable body", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  globalThis.fetch = async (url) => {
    if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    return { ok: true, json: async () => { throw new Error("bad json"); } };
  };
  try {
    assert.equal(await pendingReviewCount(state), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("pendingReviewCount returns null when the network throws", async () => {
  const state = makeState();
  state.settings.supabase = { enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" };
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    assert.equal(await pendingReviewCount(state), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
