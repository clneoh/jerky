// test/press-everything.test.js — ★★ THE PRESS-EVERYTHING PASS.
//
// Ported from the bakery's own pass (v334, widened in v335) — the answer to the owner's
// question, 5 Oct 2026: __"you work is not checked, how can you improve?"__ The honest
// answer was **the tests check what I BUILT, not what SHE DOES.**
//
// ★ EVERY FAULT THAT DAY WAS THE SAME SHAPE:
//   · v332's remove button — asserted PRESENT and correctly placed, and NEVER PRESSED. It was
//     wired to a variable that does not exist there, so it threw and removed nothing.
//   · v326 and v327 — tested green, verified in a real browser, on **a state I invented**.
//     Wrong about her fault twice, and two pushes.
//   · a literal "null" printed on a card, found by a SCREENSHOT, not by a test.
//
// **So this file does the one thing those all failed to do: IT PRESSES EVERY CONTROL ON EVERY
// SCREEN AND LETS ANYTHING THROWN BE A FAILURE.** A handler that is present, looks right, and
// throws when used is exactly what it catches, and no amount of asserting a button EXISTS can.
//
// ⚠️⚠️ AND EVERY PRESS RUNS ON A FRESH COPY OF THE STATE AND A FRESH RENDER. A pass that pressed
// 40 controls into one live state would be pressing Remove, Save and Delete in sequence and
// reporting the wreckage as faults.
//
// ⚠️ IT FOLLOWS THE APP'S OWN WIRING. The routes and their renderers are read out of
// `admin/js/app.js` — the route table and the import block — so a screen is covered the moment it
// is given a route. A hand-written list of screens goes stale silently; that is the trap
// `test/more-menu.test.js` was written for.
//
// ⚠️ THE FIXTURE CARRIES ONE OF EVERYTHING: an order carrying a bring-a-friend coupon, one with a
// promo code, a parcel, a Self collection Point, **an order whose delivery day was deleted** (the
// v332 fault), a draft product, occasions, a PO, money in and out. **A fault that only fires for a
// day holding a coupon was invisible to thousands of green tests** because no fixture had one.
//
// ⚠️ THE CEILING, SAID PLAINLY: a shim is not a browser. It walks fewer branches than her phone
// does. **It is a floor, not a proof** — it sees a thrown error, never whether a thing looks right
// or moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultState } from "../admin/js/state.js";

// ── the DOM, modelled the way a view that reaches into the page needs it ──────
//
// ⚠️⚠️ AND ITS `querySelector` REALLY SEARCHES (rule 7). Most shims in this suite return null,
// and that is usually right — a test that only drives a view does not need a matcher. **But this
// pass presses every control on every screen, and a screen that reaches into the page for an
// element takes its "not there" path when the shim lies to it.** The bakery's first run reported
// four faults that were the STAND-IN's, not the app's (`null.focus()`, `null.replaceChildren`,
// `null.textContent`). **When the shim cannot express what the view does, fix the shim.**
const STYLE_PROPS = Symbol("style-props");
function createStyle() {
  const style = { cssText: "" };
  const props = {};
  style.setProperty = (k, v) => { props[k] = String(v); style[k] = String(v); };
  style.getPropertyValue = (k) => (props[k] !== undefined ? props[k] : "");
  style.removeProperty = (k) => { delete props[k]; delete style[k]; };
  style[STYLE_PROPS] = props;
  return style;
}

// The selectors this app actually uses, and no more: a tag, a class, an id, a tag with an
// attribute, and one descendant step. grep's list, not the CSS standard.
function matchesSimple(node, sel) {
  const m = String(sel).match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!m) return false;
  const parts = [];
  if (m[1]) parts.push(["tag", m[1].toUpperCase()]);
  for (const tok of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (tok[0] === ".") parts.push(["class", tok.slice(1)]);
    else if (tok[0] === "#") parts.push(["id", tok.slice(1)]);
    else {
      const [k, v] = tok.slice(1, -1).split("=");
      parts.push(["attr", k.trim(), v === undefined ? undefined : v.replace(/^["']|["']$/g, "")]);
    }
  }
  return parts.every(([kind, a, b]) => {
    if (kind === "tag") return node.tagName === a;
    if (kind === "class") return String(node.className).split(/\s+/).includes(a);
    if (kind === "id") return node.attrs.id === a || node.id === a;
    return node.attrs[a] !== undefined && (b === undefined || String(node.attrs[a]) === b);
  });
}
function matches(node, selector) {
  const sel = String(selector).trim();
  if (sel.includes(",")) return sel.split(",").some((s) => matches(node, s));
  const steps = sel.split(/\s+/).filter(Boolean);
  if (steps.length === 1) return matchesSimple(node, steps[0]);
  if (!matchesSimple(node, steps[steps.length - 1])) return false;
  let n = node.parentNode;
  while (n) { if (matchesSimple(n, steps[0])) return true; n = n.parentNode; }
  return false;
}

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: createStyle(), value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, parentNode: null, _listeners: {}, __root: false, id: "",
    _collect(tagName, out) {
      for (const c of this.children || []) {
        if (!c || c.nodeType !== 1) continue;
        if (tagName === "*" || c.tagName === tagName) out.push(c);
        c._collect(tagName, out);
      }
      return out;
    },
    querySelector(sel) { return (this.querySelectorAll(sel)[0] || null); },
    querySelectorAll(sel) {
      const out = [];
      this._collect("*", out).filter((n) => matches(n, sel)).forEach((n) => out.push(n));
      return out.filter((n, i, arr) => arr.indexOf(n) === i);
    },
    classList: {
      add(c) { const s = new Set(String(node.className).split(/\s+/).filter(Boolean)); s.add(c); node.className = [...s].join(" "); },
      remove(c) { const s = new Set(String(node.className).split(/\s+/).filter(Boolean)); s.delete(c); node.className = [...s].join(" "); },
      toggle(c, on) { if (on === undefined ? !node.classList.contains(c) : on) node.classList.add(c); else node.classList.remove(c); },
      contains(c) { return String(node.className).split(/\s+/).includes(c); },
    },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; } },
    replaceChildren(...cs) {
      // The children it drops are ORPHANED: a card that asks whether it is still connected must
      // get the truth (see orders-day-sum.test.js).
      for (const old of this.children) if (old && old.nodeType === 1) old.parentNode = null;
      this.children = [];
      for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parentNode = this; }
    },
    insertBefore(c) { this.children.unshift(c); if (c && c.nodeType === 1) c.parentNode = this; return c; },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    contains() { return this === arguments[0] || this.querySelectorAll("*").includes(arguments[0]); },
    closest() { return null; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, remove() {},
    setSelectionRange() {}, select() {}, setRangeText() {}, showPicker() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  Object.defineProperty(node, "isConnected", {
    get() { let n = this; while (n) { if (n.__root) return true; n = n.parentNode; } return false; },
  });
  Object.defineProperty(node, "firstChild", { get() { return this.children[0] || null; } });
  Object.defineProperty(node, "lastChild", { get() { return this.children[this.children.length - 1] || null; } });
  return node;
}

const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  createDocumentFragment: () => createEl("fragment"),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  documentElement: createEl("html"),
  body: createEl("body"),
  activeElement: null,
  hidden: false,
  visibilityState: "visible",
  _docListeners: {},
  addEventListener(t, f) { (this._docListeners[t] ||= []).push(f); },
  removeEventListener() {},
};
globalThis.window = {
  open() {}, print() {}, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerWidth: 375, innerHeight: 812, scrollTo() {},
};
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", onLine: true, clipboard: { writeText: async () => {} },
    share: undefined, canShare: () => false, userAgent: "node" },
  configurable: true, writable: true,
});
globalThis.matchMedia = globalThis.window.matchMedia;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
globalThis.location = { hash: "#/dashboard", search: "", pathname: "/admin/", href: "http://x/admin/", reload() {} };
globalThis.history = { replaceState() {}, pushState() {}, back() {} };
globalThis.print = () => {};

// ⚠️⚠️ A PRESS CAN START A TIMER, AND AN UNREF'D TIMER IS THE ONLY WAY THIS PASS CAN FINISH
// (rule 5). A view that sets an interval leaves the event loop holding a handle, and
// `node --test` then reports a TIMEOUT — **for a pass that had already finished its work**, the
// most confusing kind of red. `unref()` keeps the callback live while the loop is busy and lets
// the process exit when it is not.
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setTimeout = (fn, ms, ...args) => { const h = realSetTimeout(fn, ms, ...args); if (h && h.unref) h.unref(); return h; };
globalThis.setInterval = (fn, ms, ...args) => { const h = realSetInterval(fn, ms, ...args); if (h && h.unref) h.unref(); return h; };
// ⚠️ NO NETWORK. Any view that tries is answered an empty list rather than a real call — the pass
// must never touch her live project.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" });
// ⚠️ `globalThis.crypto` IS GETTER-ONLY on this Node (rule 6) — assigning to it throws before a
// single test runs. Nothing to do: `crypto.randomUUID` is built in, which is what `newId` wants.

const RealDate = globalThis.Date;
class MockDate extends RealDate {
  constructor(...a) { a.length ? super(...a) : super(2026, 9, 10, 10, 0, 0); } // Thu 10 Sep 2026
  static now() { return new MockDate().getTime(); }
}
globalThis.Date = MockDate;

// ── the app's OWN wiring, read out of its own source (rule 1) ────────────────
const APP = readFileSync(new URL("../admin/js/app.js", import.meta.url), "utf8");

const ROUTES = [...APP.matchAll(/"(\/[a-z-]+)":\s*\{\s*title:[^,]+,\s*tab:[^,]+,\s*render:\s*([A-Za-z0-9_]+)/g)]
  .map((m) => ({ path: m[1], render: m[2] }));
const IMPORTS = new Map();
for (const m of APP.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
  for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
    IMPORTS.set(name, m[2]);
  }
}
const resolve = (name) => new URL(`../admin/js/${IMPORTS.get(name).replace(/^\.\//, "")}`, import.meta.url);

// ── ONE OF EVERYTHING — built on the app's OWN default state, so the shape is the app's ──────
const FIXTURE = () => {
  const st = defaultState();
  Object.assign(st.settings, {
    storefront: { ...st.settings.storefront, name: "Munchies Furkidz", whatsapp: "60189136389",
      tagline: "Handmade dehydrated pet treats", postageRM: 8, postageSet: true },
    referrals: { enabled: true, friendRM: 3, referrerRM: 3, validDays: 90 },
    mailingAddress: "Munchies Furkidz\n12 Jalan Bunga\n11600 Pulau Pinang\n012-345 6789",
    messageStyle: "greeting",
  });
  st.products = [
    { id: "prd_chick", name: "Chicken Jerky", price: 29, unit: "pouch", limit: 12, active: true,
      recipe: [{ ingredientId: "ing_chicken", qty: 160, unit: "g" }] },
    { id: "prd_draft", name: "Draft treat", price: 9, unit: "pack", active: true, draft: true, recipe: [] },
    { id: "prd_hidden", name: "Hidden treat", price: 5, unit: "pack", active: false, recipe: [] },
  ];
  st.productCategories = [{ id: "cat_1", name: "Jerky", products: ["prd_chick"] }];
  st.ingredients = [
    { id: "ing_chicken", name: "Chicken breast", unit: "g", costPerUnit: 0.013, active: true,
      onHand: 4000, keepAtLeast: 2000, supplierPrices: [], priceLog: [] },
  ];
  st.suppliers = [{ id: "sup_1", name: "Wet market", phone: "041234567", packs: [] }];
  st.uoms = [{ id: "uom_g", name: "g", family: "mass", toBase: 1 }, { id: "uom_kg", name: "kg", family: "mass", toBase: 1000 }];
  st.parcelCouriers = [{ id: "jnt", name: "J&T", divisor: 5000 }];
  st.deliveryDates = [
    { id: "del_a", date: "2026-09-10" },
    { id: "del_b", date: "2026-09-12" },
  ];
  st.orders = [
    // ★ an order carrying a bring-a-friend coupon (the shape that crashed a whole day in the bakery)
    { id: "ord_c2fda5", groupId: "ord_c2fda5", status: "new", deliveryDateId: "del_a",
      deliveryDate: "2026-09-10", productId: "prd_chick", productName: "Chicken Jerky", qty: 2, unitPrice: 29,
      customerName: "Aisyah", whatsapp: "60123456789", fulfillment: "collect",
      note: "gate code 1234", lineNote: "no salt", orderDate: "2026-09-08",
      createdAt: "2026-09-08T10:00:00", referredBy: "60123456789" },
    // a promo code used on it
    { id: "ord_fresh10", groupId: "ord_fresh10", status: "confirmed", deliveryDateId: "del_a",
      deliveryDate: "2026-09-10", productId: "prd_chick", productName: "Chicken Jerky", qty: 1, unitPrice: 29,
      customerName: "Bala", whatsapp: "60122223333", fulfillment: "courier",
      address: "12 Jalan Bunga, Penang", promo: "FRESH10", orderDate: "2026-09-08",
      createdAt: "2026-09-08T11:00:00" },
    // ★ AN ORDER WHOSE DELIVERY DAY WAS DELETED — the orphan (the v332 fault), and it is NEW so the
    //   inbox draws it
    { id: "ord_orphan", groupId: "ord_orphan", status: "new", deliveryDateId: "del_gone",
      deliveryDate: "2026-09-01", productId: "prd_chick", productName: "Chicken Jerky", qty: 1, unitPrice: 29,
      customerName: "Maya", whatsapp: "60165557777", fulfillment: "collect",
      orderDate: "2026-09-01", createdAt: "2026-09-01T09:00:00" },
    // a parcel, on a day still to come
    { id: "ord_parcel", groupId: "ord_parcel", status: "ready", deliveryDateId: "del_b",
      deliveryDate: "2026-09-12", productId: "prd_chick", productName: "Chicken Jerky", qty: 1, unitPrice: 29,
      customerName: "Chong", whatsapp: "60122111222", fulfillment: "courier",
      address: "1 Jalan Baru, Penang", parcel: { carrierId: "jnt", trackingNo: "JT123" },
      orderDate: "2026-09-09", createdAt: "2026-09-09T09:00:00" },
    // a Self collection Point order
    { id: "ord_point", groupId: "ord_point", status: "confirmed", deliveryDateId: "del_b",
      deliveryDate: "2026-09-12", productId: "prd_chick", productName: "Chicken Jerky", qty: 1, unitPrice: 29,
      customerName: "Devi", whatsapp: "60123334444", fulfillment: "collect",
      pointId: "pt_1", pointName: "Farlim", orderDate: "2026-09-09", createdAt: "2026-09-09T10:00:00" },
  ];
  st.customers = [{ id: "cus_1", key: "60123456789", whatsapp: "60123456789", name: "Aisyah",
    dogName: "Milo", note: "allergic to chicken", reward: "a free pouch", rewardEvery: 5 }];
  st.credits = [
    { id: "cr_1", role: "friendOff", orderCode: "C2FDA5", holder: "60123456789", amountRM: 3,
      status: "valid", earnedAt: "2026-09-08" },
    { id: "cr_2", role: "referrer", holder: "60122223333", amountRM: 3, status: "valid", earnedAt: "2026-09-08" },
  ];
  st.rewards = [{ id: "rw_1", holder: "60123456789", what: "free pouch", givenAt: "2026-09-09" }];
  st.promoCodes = [{ id: "pc_1", code: "FRESH10", state: "live", vis: "public", who: { type: "all" },
    when: { from: "", to: "" }, basket: { type: "none", amount: 0 }, gives: { type: "rm", value: 10, cap: 0 },
    often: { type: "unlimited", n: 0, maxRM: 0 }, beside: { type: "anything" }, say: "", used: 1, given: 0 }];
  st.points = [{ id: "pt_1", name: "Farlim", address: "Farlim, Air Itam, Penang", active: true,
    place: { lat: 5.4, lng: 100.28, label: "Farlim" }, collectWindow: "14:00-18:00", minBasket: 20 }];
  st.occasions = [{ id: "occ_1", from: "2026-09-12", to: "2026-09-12", label: "Holiday" }];
  st.purchaseOrders = [{ id: "po_1", deliveryDateId: "del_a", lines: [], bought: false, generatedAt: "2026-09-08T09:00:00" }];
  st.expenses = [{ id: "ex_1", date: "2026-09-08", amount: 25, category: "Ingredients", what: "chicken" }];
  st.deposits = [{ id: "dp_1", date: "2026-09-08", amount: 100 }];
  st.production = {};
  st.wishList = [{ id: "w_1", label: "A wish", done: false }];
  return st;
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// ⚠️⚠️ A SCREEN CAN FILL ITSELF FROM AN ANSWER, AND THE PASS MUST WAIT FOR IT (rule 4). Some
// screens draw their presses only when a reply lands, so a pass that looked the instant the render
// returned would report them as having nothing to press. **That is a class — anything from a
// `fetch` behaves this way.** One turn of the loop is enough for a stubbed fetch to settle.
// ⚠️ AND IT MUST USE THE *REAL* TIMER: the shim unrefs every timer so a view's interval cannot
// hold the process open — and an unref'd timer does NOT keep the loop alive, so awaiting one here
// never resolves.
const settle = () => new Promise((r) => realSetTimeout(r, 0));

// ── pressing ─────────────────────────────────────────────────────────────────
const all = (node, out = []) => {
  for (const c of node.children || []) { out.push(c); if (c && c.nodeType === 1) all(c, out); }
  return out;
};
const labelOf = (n) => {
  const t = String(n.textContent || n.attrs?.placeholder || n.attrs?.["aria-label"] || "").replace(/\s+/g, " ").trim();
  return t.slice(0, 48) || n.tagName;
};

const inputType = (n) => (n.tagName === "INPUT" ? String(n.attrs.type || "text").toLowerCase() : "");
const isTyping = (n) => n.tagName === "TEXTAREA" || (n.tagName === "INPUT"
  && !["checkbox", "radio", "submit", "button", "file", "range", "color"].includes(inputType(n)));
const isToggling = (n) => n.tagName === "INPUT" && ["checkbox", "radio"].includes(inputType(n));

// What can be pressed on a rendered screen: every button, every link with a handler, every select,
// every text box, every tick box. ⚠️ A DISABLED control is skipped — pressing one is not a fault,
// and this app disables a press it cannot honour on purpose.
const pressesOn = (root) => all(root).filter((n) => {
  if (n.disabled || n.attrs?.disabled !== undefined) return false;
  if (isToggling(n)) return true;
  if (isTyping(n)) return true;
  if (n.tagName === "SELECT") return true;
  if (n.tagName === "BUTTON") return true;
  if (n.tagName === "A" && (n._listeners?.click || []).length) return true;
  if (n._listeners?.click?.length) return true;
  return false;
});

// ★★ AND TYPING IS A PRESS (rule 3). The first bakery pass walked what was ON the screen — and the
// button she reported, the ✕ on a search result, **only exists once something has been typed into
// the finder**. A pass that cannot type is blind to every control behind an input: the finder's
// rows, the customer suggester's panel, the address look-up's list.
const TYPE_TEXT = "C2FDA5"; // an order code: short, and it makes the finder look things up
const TYPE_NUMBER = "2";

function press(node) {
  // ⚠️⚠️ A CHECKBOX IS A PRESS, AND A NUMBER BOX IS A PRESS — the bakery's first pass walked
  // neither, and reported THREE SCREENS AS HAVING NOTHING TO PRESS. They were full of controls;
  // the pass was blind to the two kinds they are made of. **The bring-a-friend switch, the
  // Purchase Order's day ticks, the product toggles and every sort of "tick this" is a checkbox**,
  // and a switch whose handler throws is exactly the fault this file exists to find.
  if (isToggling(node)) {
    node.checked = !node.checked;
    for (const f of node._listeners.change || []) f.call(node, { target: node, preventDefault() {} });
    return "toggle";
  }
  if (isTyping(node)) {
    node.value = inputType(node) === "number" ? TYPE_NUMBER : TYPE_TEXT;
    for (const f of node._listeners.input || []) f.call(node, { target: node, preventDefault() {} });
    for (const f of node._listeners.change || []) f.call(node, { target: node, preventDefault() {} });
    return inputType(node) === "number" ? "number" : "type";
  }
  if (node.tagName === "SELECT") {
    const opts = all(node).filter((o) => o.tagName === "OPTION");
    const other = opts.map((o) => o.attrs.value ?? o.value).find((v) => v !== node.value);
    if (other !== undefined) node.value = other;
    for (const f of node._listeners.change || []) f.call(node, { target: node, preventDefault() {} });
    return "change";
  }
  const ev = { preventDefault() {}, stopPropagation() {}, target: node, type: "click" };
  for (const f of node._listeners.click || []) f.call(node, ev);
  return "click";
}

// ⚠️ IT IS BOUNDED — but the ceiling is set where it never bites. **It is kept as a ceiling rather
// than removed, because a screen that grows a runaway list should slow the pass down loudly rather
// than hang it** — and reaching it is REPORTED, never silent, because a pass that quietly stops
// walking a screen is the "nothing found" shape this whole file exists to avoid.
const PER_SCREEN = Number(process.env.PRESS_PER || 200);
const TOTAL_CAP = Number(process.env.PRESS_TOTAL || 20000);
const skipped = [];
const failures = [];
let pressed = 0;
let reported = false;

// ── the pass ────────────────────────────────────────────────────────────────
test("★ every screen renders, and every control on it can be pressed without throwing", async () => {
  // ⚠️ A VACUITY GUARD (rule 8): a reader that has gone stale would walk nothing, and a pass over
  // nothing passes.
  assert.ok(ROUTES.length >= 15,
    `the route table was read from app.js and found only ${ROUTES.length} screens — the reader has gone stale, and a pass over nothing passes`);
  assert.equal(IMPORTS.size > 10, true, "and the import block with it, or no renderer could be located");

  for (const { path, render } of ROUTES) {
    const mod = await import(resolve(render).href);
    const fn = mod[render];
    if (typeof fn !== "function") { failures.push([path, render, "not exported by its own module"]); continue; }

    // 1 · it RENDERS at all
    const root = createEl("div"); root.__root = true;
    let first = null;
    try {
      fn(root, clone(FIXTURE()), new URLSearchParams());
      await settle();
      first = pressesOn(root);
    } catch (err) {
      failures.push([path, "(rendering)", String(err && err.message || err)]);
      reported = true;
      continue;
    }
    // A screen with nothing to press is REPORTED rather than asserted on: an empty state is a
    // legitimate screen. **The honest guard is the one below it — that the WHOLE pass walks enough
    // to mean something.**
    if (!first.length) { reported = true; skipped.push(`${path} (nothing to press)`); continue; }

    // 2 · every control, each from a FRESH state and a FRESH render, so one press cannot set up
    //     another (pressing Remove then Save would report the wreckage as a fault).
    const take = Math.min(first.length, PER_SCREEN);
    if (first.length > take) skipped.push(`${path} (${first.length - take} of ${first.length} controls past the ceiling)`);
    for (let i = 0; i < take; i += 1) {
      if (pressed >= TOTAL_CAP) { skipped.push(`${path} (stopped at the overall ceiling)`); break; }
      const fresh = createEl("div"); fresh.__root = true;
      const state = clone(FIXTURE());
      for (const id of ["popup-layer", "confirm-layer", "lock-layer", "print-layer"]) layers[id] = createEl("div");
      let node;
      try {
        fn(fresh, state, new URLSearchParams());
        await settle();
        node = pressesOn(fresh)[i];
      } catch (err) {
        failures.push([path, `#${i} (re-render)`, String(err && err.message || err)]);
        reported = true;
        continue;
      }
      if (!node) continue;
      const how = isToggling(node) ? "toggle" : isTyping(node) ? "type"
        : node.tagName === "SELECT" ? "change" : "click";
      const label = `${node.tagName} "${labelOf(node)}"`;
      try {
        press(node);
        pressed += 1;
      } catch (err) {
        failures.push([path, `${label} (${how})`, String(err && err.message || err)]);
        reported = true;
        continue;
      }
      // 3 · whatever the press OPENED gets pressed too — one level, which is where a card's own
      //     controls live (a confirmation's yes, a pop-up's save, and the rows a typed query
      //     reveals).
      //
      // ⚠️⚠️ AND A REVEAL IS NOT ALWAYS A LAYER. The bakery's ✕ lives on a row that appears in
      // the SCREEN when something is typed — **its first pass only re-scanned the pop-up layers,
      // and it MISSED that fault entirely** (found by putting the fault back and watching the pass
      // stay green, which is the only way to know a check checks). So a press also re-scans the
      // screen, by IDENTITY, so a screen rebuilt from scratch does not count as a hundred
      // revelations.
      const revealed = new Set();
      for (const layerId of ["popup-layer", "confirm-layer"]) {
        const layer = layers[layerId];
        if (!layer || layer.hidden) continue;
        for (const inner of pressesOn(layer)) revealed.add({ node: inner, where: layerId });
      }
      if (how === "type" || how === "number" || how === "toggle") {
        for (const n of pressesOn(fresh)) if (!first.includes(n)) revealed.add({ node: n, where: "revealed" });
      }
      for (const { node: inner, where } of revealed) {
        if (pressed >= TOTAL_CAP) break;
        const innerLabel = `${where} → ${inner.tagName} "${labelOf(inner)}"`;
        try { press(inner); pressed += 1; } catch (err) {
          failures.push([path, `${innerLabel} (after ${label})`, String(err && err.message || err)]);
          reported = true;
        }
      }
    }
  }

  // A pass that pressed nothing must not pass quietly.
  assert.ok(pressed > 150,
    `the pass pressed only ${pressed} controls — it is not walking the screens, and a pass over nothing reports nothing`);
  if (skipped.length) console.log(`★ press-everything: not walked — ${skipped.join(" · ")}`);

  if (failures.length) {
    const lines = failures.slice(0, 25).map(([p, what, err]) => `  ${p}  ${what}\n      ${err}`);
    assert.fail(`${failures.length} control(s) threw when pressed:\n${lines.join("\n")}`
      + (failures.length > 25 ? `\n  …and ${failures.length - 25} more` : ""));
  }
  console.log(`★ press-everything: ${ROUTES.length} screens, ${pressed} presses, 0 throws`);
});

// ── the Guide's own emphasis ────────────────────────────────────────────────
// The Guide's cards are written with **double asterisks** round the words that should stand out —
// and for as long as the Guide has existed, nothing rendered them, so the screen showed the
// asterisks THEMSELVES on every card that used them (37 paragraphs by 7 Oct 2026). A pass that
// presses every control cannot see this: the screen renders fine, it just reads wrong. This pins
// the renderer that fixes it, so a card written that way can never go back to printing its markup.
test("★ the Guide renders every **pair** as real emphasis, never as literal asterisks", async () => {
  const mod = await import(resolve("renderGuide").href);
  const root = createEl("div"); root.__root = true;
  mod.renderGuide(root, clone(FIXTURE()), new URLSearchParams());
  await settle();

  const words = all(root).filter((n) => n.nodeType === 3).map((n) => String(n.text || ""));
  const prints = words.filter((t) => t.includes("**"));
  assert.deepEqual(prints, [], "no paragraph on the Guide may print its own ** markers");

  // And the other half: the asterisks are gone because they became emphasis, not because the
  // sentences were edited down to nothing. A guard that only counts asterisks would pass on an
  // empty screen (rule 8 — a pass over nothing passes).
  const bold = all(root).filter((n) => n.tagName === "STRONG");
  assert.ok(bold.length > 20,
    `the Guide's cards use **bold** throughout, so the screen must carry real emphasis — found ${bold.length}`);
  assert.ok(bold.every((n) => String(n.textContent).length > 0), "and none of it may be empty");
});
