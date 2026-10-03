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
//
// It carries what a real publish carries: two headings in the baker's order, a
// nested one, a product filed under two of them, a product filed nowhere, and a
// thumbnail on exactly one product. The shop's shape is then asserted whole
// below rather than in pieces, because "which heading is over which card" is
// the thing this version changes.
const THUMB = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const remote = {
  name: "Munchies Furkidz",
  tagline: "Jerky & treats, Penang",
  whatsapp: "60111223344",
  instagram: "munchies_furkidz",
  facebook: "",
  deliveryDays: [2, 4],
  cutoff: "15:00",
  capacity: 20,
  policy: "Orders are not refundable; they may be moved to another day.",
  products: [
    { name: "Chocolate Cake", price: 55, unit: "whole", description: "Rich dark ganache, 3 layers", thumb: THUMB },
    { name: "Brownies", price: 10, unit: "box" },
    { name: "Sourdough", price: 12, unit: "loaf" },
    { name: "Muffin", price: 6, unit: "piece" },
    { name: "Cinnamon Roll", price: 7, unit: "piece", sort: 1 },
    // Two more she has not filed. They are LAST in this array and FIRST in the
    // order she dragged them into, so where they are drawn can only come from
    // the `sort` on each — which is the whole point of it.
    { name: "Kaya Toast", price: 5, unit: "piece", sort: 0 },
    { name: "Roti Bakar", price: 4, unit: "piece" },
  ],
  categories: [
    { name: "Cakes", depth: 0, products: ["Chocolate Cake", "Brownies"] },
    { name: "For Dog", depth: 0, products: [] },
    { name: "Treats", depth: 1, products: ["Sourdough"] },
    { name: "Bestsellers", depth: 0, products: ["Muffin"] },
    { name: "Gone Today", depth: 0, products: ["Nobody Sells This"] },
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

// The menu as a shape rather than as node paths: "H:" for a heading and its
// words, "P:" for a product card and its name. Read as a list it says the whole
// thing at once — her order, which heading owns which card, and what is left
// over at the end — and it fails loudly if a heading is dropped, a card moves
// under the wrong one, or the tail disappears.
const shapeOf = (node) => {
  if (node.tagName === "H3") return `H:${node.children[0].text}`;
  // The photo, when there is one, is the card's own first column; the body is
  // the child that holds the words. Found by name rather than by index, so a
  // card with and a card without a photo read the same way here.
  const body = node.children.find((c) => c.className === "card-body");
  const words = body.children[0].children[0];
  return `P:${words.children[0].children[0].text}`;
};
const cardsIn = (menu) => menu.filter((n) => n.tagName !== "H3");
const cardNamed = (menu, name) =>
  cardsIn(menu).find((n) => shapeOf(n) === `P:${name}`);

test("published config overrides the header and menu at runtime", async () => {
  await settle();

  assert.equal(registry["name"].textContent, "Munchies Furkidz");
  assert.equal(registry["tagline"].textContent, "Jerky & treats, Penang");
  assert.equal(registry["delivery-days"].textContent, "Tue, Thu");
  assert.equal(registry["cutoff"].textContent, "3pm the day before posting");
  assert.equal(registry["social"].children.length, 1, "only Instagram links (facebook blank)");
});

test("the shop lists the published products under her headings, in her order", async () => {
  await settle();
  const menu = registry["menu"].children;

  assert.deepEqual(menu.map(shapeOf), [
    "H:Cakes",
    "P:Chocolate Cake",
    "P:Brownies",
    // A heading whose own products have all gone keeps its place when something
    // nested under it survives — otherwise the whole branch vanishes with it.
    "H:For Dog",
    "H:For Dog › Treats",
    "P:Sourdough",
    "H:Bestsellers",
    "P:Muffin",
    // "Gone Today" named a product that does not exist, so it is dropped rather
    // than drawn as an empty shelf.
    // …and a product she has not filed lands last, under one plain heading, so
    // nothing she has not got round to filing can disappear from her shop.
    "H:More items",
    // The tail is the one list a product orders ITSELF in: Kaya Toast is last in
    // the published array and was dragged to the front, and Roti Bakar, which she
    // has never dragged, keeps the order it arrived in — behind the two she set.
    "P:Kaya Toast",
    "P:Cinnamon Roll",
    "P:Roti Bakar",
  ]);

  const names = cardsIn(menu).map((n) => shapeOf(n).slice(2));
  assert.equal(names.length, new Set(names).size,
    "every product is on the page once — a card lives in one place, so a heading cannot repeat one");
});

test("a card carries its photo as its own left column, beside a body of everything else", async () => {
  await settle();
  const menu = registry["menu"].children;

  // Card layout: .menu-item > [(.menu-thumb), .card-body > [.card-head >
  // [.card-words > [p.title, p.sub, (.prod-desc)], stamp], stepper, (prod-note),
  // (prod-next), (prod-cancel)]]. The photo is a SIBLING of the body, not a child
  // of the head — that is what lets it stretch the card's full height instead of
  // stopping above the stepper. Asserted at each level rather than assumed,
  // because a path that silently lands one level out reads as an empty string,
  // not an error.
  const withPhoto = cardNamed(menu, "Chocolate Cake");
  const thumb = withPhoto.children[0];
  assert.equal(thumb.className, "menu-thumb", "the photo is the card's first column");
  assert.equal(thumb.attrs.src, THUMB, "and it is the baker's own image");
  assert.equal(thumb.attrs.alt, "", "decorative here — the name is right beside it");
  const body = withPhoto.children[1];
  assert.equal(body.className, "card-body", "everything else stacks beside the photo");
  const head = body.children[0];
  assert.equal(head.className, "card-head", "the card head");
  const words = head.children[0];
  assert.equal(words.className, "card-words", "the name and price column");
  const title = words.children[0];
  assert.equal(title.className, "card-title");
  const sub = words.children[1];
  assert.equal(title.children[0].text, "Chocolate Cake");
  assert.equal(sub.children[0].text, "RM55.00 / whole");
  const desc = words.children[2];
  assert.equal(desc.className, "prod-desc");
  assert.equal(desc.children[0].text, "Rich dark ganache, 3 layers");

  // A product with no photo is the same shape, one column shorter: the body is
  // the card's only child and nothing else moved.
  const noPhoto = cardNamed(menu, "Brownies");
  const plain = noPhoto.children[0];
  assert.equal(plain.className, "card-body", "no photo → the body is the first child");
  assert.equal(noPhoto.children.length, 1, "and it is the only one");
  const plainWords = plain.children[0].children[0];
  assert.equal(plainWords.className, "card-words");
  assert.equal(plainWords.children[0].children[0].text, "Brownies");
  assert.equal(plainWords.children.length, 2, "no description → no extra line under the price");
});



test("the published Policies wording is shown on the page, and hidden when blank", async () => {
  await settle();
  assert.equal(registry["policy-text"].textContent, "Orders are not refundable; they may be moved to another day.");
  assert.equal(registry["policy-box"].hidden, false, "a written policy shows its box");
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

test("mergeStorefront adopts a product's marks, dropping anything malformed", () => {
  const base = { name: "A", products: [{ name: "X", price: 1, unit: "u" }] };
  const out = mergeStorefront(base, {
    products: [
      { name: "Y", price: 2, unit: "u",
        sellRules: [{ days: [6, 0], from: "2026-12-01", to: "2026-12-24" },
          { days: [], from: "nope", to: "nope" }] },
      { name: "Z", price: 3, unit: "u", sellRules: [] },
      { name: "W", price: 4, unit: "u", sellRules: "nonsense" },
    ],
  });
  assert.deepEqual(out.products[0].sellRules, [{ days: [0, 6], from: "2026-12-01", to: "2026-12-24" }],
    "the good mark is adopted; the one whose ends are not dates is dropped");
  assert.ok(!("sellRules" in out.products[1]), "an empty list publishes no key, which reads as every day");
  assert.ok(!("sellRules" in out.products[2]), "nonsense is not adopted at all");
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

test("mergeStorefront keeps the shop product names (中文/BM) and the developer credit", () => {
  const base = { name: "A", products: [{ name: "Chicken Jerky", price: 5, unit: "pouch" }] };
  const out = mergeStorefront(base, {
    products: [
      { name: "Chicken Jerky", price: 5, unit: "pouch", nameZh: "鸡肉干", nameMs: "Jerky Ayam" },
      { name: "Turkey Jerky", price: 4, unit: "pouch", nameZh: "   ", nameMs: "Jerky Turki" },
    ],
    developerName: "  Dev Studio  ",
    developerEmails: ["a@b.com", "  ", "c@d.com"],
    developerWhatsapp: " 012-345 6789 ",
  });
  const chicken = out.products.find((p) => p.name === "Chicken Jerky");
  const turkey = out.products.find((p) => p.name === "Turkey Jerky");
  assert.equal(chicken.nameZh, "鸡肉干");
  assert.equal(chicken.nameMs, "Jerky Ayam");
  assert.equal(turkey.nameMs, "Jerky Turki");
  assert.equal("nameZh" in turkey, false, "a blank 中文 name is dropped — English shows instead");
  assert.equal(out.developerName, "Dev Studio");
  assert.deepEqual(out.developerEmails, ["a@b.com", "c@d.com"], "blank developer emails are dropped");
  assert.equal(out.developerWhatsapp, "012-345 6789", "the developer's WhatsApp number is kept");
  assert.equal("nameZh" in base.products[0], false, "base is not mutated");
  assert.equal("developerName" in base, false, "developer keys only appear when the remote sets them");

  // A remote without the WhatsApp number leaves the merged config without one
  // (the local fallback never carries developer keys, so none leak through).
  const noWa = mergeStorefront({ name: "A" }, { developerName: "X" });
  assert.equal("developerWhatsapp" in noWa, false, "a blank/absent remote number is not copied over");
});

test("mergeStorefront keeps the auto-translated description + selling unit (中文/BM)", () => {
  const base = { name: "A", products: [{ name: "Focaccia", price: 15, unit: "loaf" }] };
  const out = mergeStorefront(base, {
    products: [
      { name: "Focaccia", price: 15, unit: "loaf",
        descZh: "香脆空心", descMs: "   ", unitZh: "条", unitMs: "" },
    ],
  });
  const foc = out.products[0];
  assert.equal(foc.descZh, "香脆空心");
  assert.equal("descMs" in foc, false, "a blank BM description is dropped — the card keeps English");
  assert.equal(foc.unitZh, "条");
  assert.equal("unitMs" in foc, false, "a blank BM unit word is dropped — the card reads '/ loaf'");
  assert.equal("descZh" in base.products[0], false, "base is not mutated");
});

test("mergeStorefront keeps the change/cancel window and the Policies wording", () => {
  const base = {
    name: "A",
    products: [{ name: "Focaccia", price: 15, unit: "loaf" }],
    policy: "",
  };
  const out = mergeStorefront(base, {
    products: [
      { name: "Focaccia", price: 15, unit: "loaf", cancelDays: 2, alwaysListed: true },
      { name: "Brownie", price: 6, unit: "piece" },
    ],
    policy: "  Orders are not refundable; they may be moved to another day.  ",
    policyZh: "  款项不退还。  ",
    policyMs: "",
  });
  assert.equal(out.products.find((p) => p.name === "Focaccia").cancelDays, 2);
  assert.equal("cancelDays" in out.products.find((p) => p.name === "Brownie"), false,
    "a blank window keeps the product without a cancelDays key");
  assert.equal(out.products.find((p) => p.name === "Focaccia").alwaysListed, true,
    "the keep-listed switch reaches the shop");
  assert.equal("alwaysListed" in out.products.find((p) => p.name === "Brownie"), false,
    "a product that never had the switch on gains no key — the shop reads that as off");
  assert.equal(out.policy, "Orders are not refundable; they may be moved to another day.",
    "the policy text is adopted and trimmed");
  assert.equal(out.policyZh, "款项不退还。", "a non-empty 中文 policy is kept");
  assert.equal("policyMs" in out, false,
    "a blank BM policy is dropped — policyFor falls back to the English wording");

  // A remote that says nothing about the policy leaves the base's own value be.
  const keep = mergeStorefront({ name: "A", policy: "My own words" }, { name: "B" });
  assert.equal(keep.policy, "My own words");
  assert.equal("policy" in base.products[0], false, "base products are not mutated");
});

test("mergeStorefront adopts the per-item note switch only on a literal true", () => {
  // The shop re-checks every field on this boundary for itself, and this one decides
  // whether a text box is drawn on a card — so "yes", 1, "true" and a missing key all
  // have to read as "do not ask". A truthy test here would put a note box on products
  // the baker never switched on, and a customer's words would arrive for an item she
  // is not expecting them on.
  const out = mergeStorefront({ name: "A", products: [] }, {
    products: [
      { name: "Focaccia", price: 15, unit: "loaf", askNote: true },
      { name: "Brownie", price: 6, unit: "piece", askNote: "yes" },
      { name: "Cookies", price: 6, unit: "piece", askNote: 1 },
      { name: "Scone", price: 5, unit: "piece", askNote: "true" },
      { name: "Tart", price: 5, unit: "piece" },
    ],
  });
  const by = (n) => out.products.find((p) => p.name === n);
  assert.equal(by("Focaccia").askNote, true, "a literal true reaches the shop");
  for (const n of ["Brownie", "Cookies", "Scone", "Tart"]) {
    assert.equal("askNote" in by(n), false,
      `${n} gains no key — anything but a literal true reads as do not ask`);
  }
});

test("mergeStorefront adopts the category headings, dropping a half-formed row", () => {
  const base = { name: "A", products: [] };
  const out = mergeStorefront(base, {
    categories: [
      { name: "  Bread  ", depth: 2, products: ["  Focaccia ", "", null, 42], nameZh: " 面包 " },
      { name: "Treats", depth: "deep", products: "nonsense" },
      { name: "   " },
      null,
      { name: "Deep", depth: 99, products: [] },
    ],
  });

  assert.deepEqual(out.categories, [
    { name: "Bread", depth: 2, products: ["Focaccia", "42"], nameZh: "面包" },
    { name: "Treats", depth: 0, products: [] },
    { name: "Deep", depth: 31, products: [] },
  ], "names trimmed, a depth the shop cannot draw reads as top level, a nonsense product list as none, "
   + "a nameless row is dropped, and depth is capped at the deepest indent the stylesheet draws");
  assert.equal(out.categories[1].depth, 0, "a depth that is not a whole number is top level, not NaN");
  assert.equal(out.categories[0].nameMs, undefined, "a language name is only kept when it is written");
});

test("mergeStorefront sends the headings it was given, never a merged or partial set", () => {
  const base = {
    name: "A", products: [],
    categories: [{ name: "Old", depth: 0, products: ["X"] }],
  };
  // An empty list is a real instruction — she deleted her last category — so it
  // must clear the headings an open page is still showing.
  assert.deepEqual(mergeStorefront(base, { categories: [] }).categories, []);
  // Saying nothing at all, on the other hand, leaves the local list alone.
  assert.deepEqual(mergeStorefront(base, { name: "B" }).categories, base.categories);
});

test("mergeStorefront adopts a product's thumbnail, dropping junk and anything oversized", () => {
  const big = `data:image/jpeg;base64,${"A".repeat(40001)}`;
  const out = mergeStorefront({ name: "A", products: [] }, {
    products: [
      { name: "Good", price: 1, unit: "u", thumb: THUMB },
      { name: "Blanks", price: 1, unit: "u", thumb: "   " },
      { name: "NotAnImage", price: 1, unit: "u", thumb: "https://example.com/x.jpg" },
      { name: "WrongType", price: 1, unit: "u", thumb: "data:image/png;base64,AAAA" },
      { name: "Huge", price: 1, unit: "u", thumb: big },
      { name: "Absent", price: 1, unit: "u" },
    ],
  });
  const by = (n) => out.products.find((p) => p.name === n);
  assert.equal(by("Good").thumb, THUMB, "a small JPEG data URL is adopted as-is");
  for (const bad of ["Blanks", "NotAnImage", "WrongType", "Huge", "Absent"]) {
    assert.equal("thumb" in by(bad), false,
      `${bad}: the shop drops it rather than drawing a broken or heavy image`);
  }
});
