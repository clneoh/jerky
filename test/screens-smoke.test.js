// test/screens-smoke.test.js — EVERY admin screen, built for real, twice (v368).
//
// ★ WHY THIS EXISTS, IN HER WORDS: __"if you can build check list why not check yourself"__.
//
// She is right, and this is the honest answer: a browser pane into the admin app is refused
// to this session, so the ONE thing that cannot be done here is looking at a screen. But
// almost everything a checklist would ask a person to do — does it open, does it throw, does
// it draw anything at all — is checkable by building the real view and pressing it. That is
// what this file does, for all twenty-six screens, on a fresh install and on a busy one.
//
// ⚠️ WHAT THIS PROVES AND WHAT IT DOES NOT. It proves a screen CONSTRUCTS and DRAWNS. It
// proves nothing about how it LOOKS — spacing, contrast, whether a press is reachable by a
// thumb, whether the words are ones she would use. Those still need her eyes on a phone, and
// saying so is the point of the file rather than a gap in it.
//
// ⚠️ AND IT IS A TRIPWIRE FOR THE CHEAPEST-FIXING BUG THERE IS: a missing import or a crash
// on data a screen does not expect. Three of this session's own mistakes were exactly that
// (a missing `button` import on the referrals screen, a `cur` bound to the wrong object, a
// stray paren), and all three were caught only because a test happened to build that screen.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the smallest DOM the views are happy with ───────────────────────────────
//
// ⚠️⚠️ A SHIM MUST BE AS UNFORGIVING AS THE REAL DOM — BUT IT MUST ALSO BE AS CAPABLE, AND
// THE FIRST RUN OF THIS FILE PROVED THE SECOND HALF. Three screens "failed" and every one of
// them was this shim, not the app: `querySelector` answered `null` for selectors a real
// document would have found, and `style` had no `setProperty`. A shim that cannot express
// what a view does manufactures faults, which is as useless as one that hides them.
function styleBag() {
  const bag = {
    setProperty(k, v) { bag[k] = String(v); },
    getPropertyValue(k) { return bag[k] || ""; },
    removeProperty(k) { delete bag[k]; },
  };
  return bag;
}

// A small, honest selector matcher: a tag, `.class`, `#id`, `[attr]`, `[attr="v"]`, and any
// compound of those. Enough for every selector the views use, and it THROWS on anything it
// does not understand rather than quietly matching nothing — the failure mode a permissive
// matcher would hide.
function matches(node, sel) {
  const parts = String(sel).trim().match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(#[\w-]+)|(\[[^\]]+\])/g);
  if (!parts) throw new Error(`the shim cannot understand the selector "${sel}"`);
  return parts.every((p) => {
    if (p.startsWith(".")) return String(node.className || "").split(/\s+/).includes(p.slice(1));
    if (p.startsWith("#")) return node.attrs.id === p.slice(1) || node.id === p.slice(1);
    if (p.startsWith("[")) {
      const m = p.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/);
      if (!m) throw new Error(`the shim cannot understand the attribute test "${p}"`);
      const got = node.attrs[m[1]];
      if (got === undefined) return false;
      return m[2] === undefined || String(got) === m[2];
    }
    return String(node.tagName).toLowerCase() === p.toLowerCase();
  });
}

function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of (n && n.children) || []) {
      if (c && c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); }
    }
  };
  walk(root);
  return out;
}

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: styleBag(), value: "", checked: false, disabled: false, hidden: false,
    id: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0,
    textContent: "", innerHTML: "", _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    prepend(...cs) { this.children.unshift(...cs.filter((c) => c != null)); },
    insertBefore(c) { this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() {}, replaceWith() {},
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    closest: () => null,
    contains: () => false,
    focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    scrollIntoView() {},
  };
  return node;
}

const registry = new Map();
const nodeFor = (id) => { if (!registry.has(id)) registry.set(id, createEl(id === "confirm-layer" || id === "popup-layer" ? "div" : "div")); return registry.get(id); };

const body = createEl("body");
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  // ⚠️ A REAL PAGE HAS THIS, AND A STAND-IN THAT DOES NOT INVENTS A FAULT. The Guide builds its
  // emphasis by way of a fragment; without this the pass reported the Guide as broken on a fresh
  // install, and the app was fine. (The bakery's own v368 body says the same thing about its first
  // run — "a harness that cannot express what a screen does invents faults".) A fragment is a real
  // element here, which is what `appendChild`/`replaceChild` already handle.
  createDocumentFragment: () => createEl("fragment"),
  getElementById: nodeFor,
  querySelector: (sel) => queryAll(body, sel)[0] || null,
  querySelectorAll: (sel) => queryAll(body, sel),
  addEventListener() {}, removeEventListener() {},
  body,
  documentElement: createEl("html"),
  activeElement: null,
};
globalThis.window = {
  innerWidth: 375, innerHeight: 812, open() {},
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  location: { origin: "http://localhost:8451", href: "http://localhost:8451/admin/", hash: "" },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
};
globalThis.location = globalThis.window.location;
globalThis.history = { replaceState() {}, pushState() {} };
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => { try { fn(0); } catch { /* a frame that throws is not this test's subject */ } return 1; };
globalThis.cancelAnimationFrame = () => {};
// ⚠️ TIMERS ARE SWALLOWED, NOT RUN. Several screens start a clock; letting it fire would put
// an interval on the test process and the suite would never exit.
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.fetch = async () => ({ ok: false, json: async () => [], text: async () => "" });

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// ── the state a screen is built against ─────────────────────────────────────
const { defaultState } = await import("../admin/js/state.js");

// A BUSY state, because half of every screen only exists once there is something to show —
// and a screen that crashes on real data is the crash that reaches her, not the empty one.
function busyState() {
  const st = defaultState();
  st.settings.currency = "RM";
  st.settings.referrals = { enabled: true, friendRM: 3, referrerRM: 3, validDays: 90 };
  st.settings.lock = { enabled: true, pinHash: "x" };
  st.products = [
    { id: "p1", name: "Focaccia", price: 16, active: true, recipe: [{ ingredientId: "i1", qty: 400, unit: "g" }] },
    { id: "p2", name: "Sourdough", price: 18, active: true, recipe: [] },
  ];
  st.ingredients = [{ id: "i1", name: "Flour", unit: "g", active: true, packQty: 1000, packPrice: 4, onHand: 5000 }];
  st.deliveryDates = [{ id: "d1", date: "2026-10-12", capacity: 12, extra: {} }];
  st.orders = [
    { id: "o_c2fda5", groupId: "o_c2fda5", status: "paid", paidReceived: true, paidAt: "2026-10-08T02:00:00.000Z",
      receiptNo: 1, deliveryDateId: "d1", deliveryDate: "2026-10-12", productId: "p1", qty: 2, unitPrice: 16,
      customerName: "Uncle Tan", whatsapp: "60162223333", referredBy: "", createdAt: "2026-10-08T01:00:00", orderDate: "2026-10-08" },
    { id: "o_new01", groupId: "o_new01", status: "new", deliveryDateId: "d1", deliveryDate: "2026-10-12",
      productId: "p1", qty: 1, unitPrice: 16, customerName: "Aisyah", whatsapp: "60123456789",
      replicatedBy: "", createdAt: "2026-10-08T01:30:00", orderDate: "2026-10-08" },
  ];
  st.credits = [
    { id: "c1", holder: "60123456789", amountRM: 3, role: "reward", earnedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "", usedAt: null, orderCode: "ZZZZZZ", note: "" },
  ];
  st.purchaseOrders = [{ id: "po1", date: "2026-10-08", lines: [], status: "open" }];
  st.customers = [{ id: "cus_p", key: "60123456789", name: "Aisyah", whatsapp: "60123456789" }];
  st.accounts = [{ id: "a1", name: "Cash", kind: "cash", active: true }];
  return st;
}

const all = (n) => [n, ...((n && n.children) || []).flatMap(all)];
const drewSomething = (root) => all(root).length > 1;

// ── every screen, by the name the menu gives it ─────────────────────────────
const SCREENS = [
  ["Home", "dashboard", "renderDashboard"],
  ["Orders", "orders", "renderOrders"],
  ["Products", "products", "renderProducts"],
  ["Customers", "customers", "renderCustomers"],
  ["More", "more", "renderMore"],
  ["Ingredients", "ingredients", "renderIngredients"],
  ["Purchase Order", "po", "renderPO"],
  ["PO history", "history", "renderHistory"],
  ["Bake days", "deliveries", "renderDeliveries"],
  ["Delivery run", "run", "renderDeliveryRun"],
  ["Send a van", "send-van", "renderSendVan"],
  ["Parcel couriers", "parcel-couriers", "renderParcelCouriers"],
  ["Self collection Points", "points", "renderPoints"],
  ["Promo codes", "promo", "renderPromoCodes"],
  ["Bring a friend", "bring-a-friend", "renderReferrals"],
  ["Message style", "message-style", "renderMessageStyle"],
  ["Money", "money", "renderMoney"],
  ["Profit", "profit", "renderProfit"],
  ["Receipt register", "receipts", "renderReceiptRegister"],
  ["Consolidated invoice", "consolidated", "renderConsolidated"],
  ["Production line", "production", "renderProduction"],
  ["Scenario planner", "scenario", "renderScenario"],
  ["Units", "units", "renderUnits"],
  ["Categories", "product-categories", "renderProductCategories"],
  ["Reviews", "reviews", "renderReviews"],
  // ⚠️ JERKY-ONLY SCREEN, AND THIS LIST IS WHY IT IS NAMED HERE. The route-table check below
  // fails by name when the app has a screen this pass does not cover — which is exactly what
  // happened when this file arrived from the bakery, whose app has no /guide.
  ["Guide", "guide", "renderGuide"],
  ["Suppliers", "suppliers", "renderSuppliers"],
  ["Settings", "settings", "renderSettings"],
];


// ⚠️ IMPORTED BY THE EXPORT NAME THE ROUTE TABLE USES, so a rename in a view file that nobody
// updated in `app.js` fails here rather than as a blank screen on her phone.
const VIEW_FILES = {
  renderDashboard: "../admin/js/views/dashboard.js",
  renderOrders: "../admin/js/views/orders.js",
  renderProducts: "../admin/js/views/products.js",
  renderCustomers: "../admin/js/views/customers.js",
  renderMore: "../admin/js/views/more.js",
  renderIngredients: "../admin/js/views/ingredients.js",
  renderPO: "../admin/js/views/po.js",
  renderHistory: "../admin/js/views/history.js",
  renderDeliveries: "../admin/js/views/deliveries.js",
  renderDeliveryRun: "../admin/js/views/delivery_run.js",
  renderSendVan: "../admin/js/views/send_van.js",
  renderParcelCouriers: "../admin/js/views/parcelCouriers.js",
  renderPoints: "../admin/js/views/points.js",
  renderPromoCodes: "../admin/js/views/promo.js",
  renderReferrals: "../admin/js/views/referrals.js",
  renderMessageStyle: "../admin/js/views/message_style.js",
  renderMoney: "../admin/js/views/money.js",
  renderProfit: "../admin/js/views/profit.js",
  renderReceiptRegister: "../admin/js/views/receipt_register.js",
  renderConsolidated: "../admin/js/views/consolidated.js",
  renderProduction: "../admin/js/views/production.js",
  renderScenario: "../admin/js/views/scenario.js",
  renderUnits: "../admin/js/views/units.js",
  renderProductCategories: "../admin/js/views/productCategories.js",
  renderReviews: "../admin/js/views/reviews.js",
  renderGuide: "../admin/js/views/guide.js",
  renderSuppliers: "../admin/js/views/suppliers.js",
  renderSettings: "../admin/js/views/settings.js",
};
const modules = {};
for (const [fn, path] of Object.entries(VIEW_FILES)) {
  const mod = await import(path);
  assert.equal(typeof mod[fn], "function", `${path} does not export ${fn}`);
  modules[fn] = mod[fn];
}

// ── ★★ THE ROUTE TABLE IS THE INVITATION LIST, NOT THIS FILE ────────────────
test("★★ every route in the app is covered by this smoke pass", async () => {
  const src = await (await import("node:fs/promises")).readFile(
    new URL("../admin/js/app.js", import.meta.url), "utf8");
  const routed = [...src.matchAll(/"(\/[a-z0-9-]*)":\s*\{\s*title:\s*"[^"]*",\s*tab:\s*"[^"]*",\s*render:\s*(\w+)/g)]
    .map((m) => m[2]);
  assert.ok(routed.length >= 20, `only ${routed.length} routes were found — the pattern has drifted`);
  const covered = new Set(SCREENS.map(([, , fn]) => fn));
  const missing = routed.filter((fn) => !covered.has(fn));
  assert.deepEqual(missing, [],
    `these screens are in the app but are NOT smoke-tested: ${missing.join(", ")}`);
});

// ── the pass itself ─────────────────────────────────────────────────────────
for (const [label, path, fn] of SCREENS) {
  test(`★ ${label} builds on a FRESH install`, () => {
    const root = createEl("div");
    let err = null;
    try { modules[fn](root, defaultState(), new URLSearchParams({ date: "d1" })); }
    catch (e) { err = e; }
    assert.equal(err, null, `${label} (#/${path}) threw on a fresh install: ${err && err.message}`);
    assert.ok(drewSomething(root), `${label} (#/${path}) drew NOTHING — a blank screen, not an empty one`);
  });

  test(`★ ${label} builds with real data in it`, () => {
    const root = createEl("div");
    let err = null;
    try { modules[fn](root, busyState(), new URLSearchParams({ date: "d1" })); }
    catch (e) { err = e; }
    assert.equal(err, null, `${label} (#/${path}) threw with real data: ${err && err.message}`);
    assert.ok(drewSomething(root), `${label} (#/${path}) drew NOTHING with real data in it`);
  });
}
