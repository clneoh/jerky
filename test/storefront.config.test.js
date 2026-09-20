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

  assert.equal(registry["name"].textContent, "Munchies Furkidz");
  assert.equal(registry["tagline"].textContent, "Jerky & treats, Penang");
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

test("mergeStorefront adopts the published codes, dropping anything half-written", () => {
  const out = mergeStorefront({ name: "A" }, {
    codes: [
      { code: " pshop ", kind: "shop", partnerName: "  Paw Shop ", headline: "New here?" },
      { code: "milo", kind: "promo", productName: "Chicken Jerky",
        offer: { type: "pct", value: 10, minSpend: 30, to: "2026-09-30", newOnly: true, cur: "RM" } },
      // A malformed offer is dropped whole, never half-adopted: a wrong number in
      // front of a customer is worse than saying nothing.
      { code: "BAD1", kind: "promo", offer: { type: "pct", value: 0 } },
      { code: "BAD2", kind: "promo", offer: { type: "free", value: 5 } },
      { code: "BAD3", kind: "promo", offer: { type: "rm", value: 5, to: "31 Oct" } },
      { code: "ODD1", kind: "nonsense" },
      { code: "  " },
      null,
      "not an object",
    ],
  });
  assert.deepEqual(out.codes.map((c) => c.code), ["PSHOP", "MILO", "BAD1", "BAD2", "BAD3", "ODD1"]);
  const shop = out.codes[0];
  assert.equal(shop.partnerName, "Paw Shop");
  assert.equal(shop.headline, "New here?");
  assert.equal("offer" in shop, false, "a code with no offer carries no offer key");
  const milo = out.codes[1];
  assert.equal(milo.productName, "Chicken Jerky");
  assert.deepEqual(milo.offer, {
    type: "pct", value: 10, minSpend: 30, to: "2026-09-30", newOnly: true, cur: "RM",
  });
  assert.equal("offer" in out.codes[2], false, "a zero amount states nothing");
  assert.equal("offer" in out.codes[3], false, "an unknown offer type states nothing");
  assert.equal(out.codes[4].offer.to, "",
    "a date that is not an ISO day is dropped rather than half-read");
  assert.equal(out.codes[5].kind, "plain", "a strange kind reads as plain");
});

test("mergeStorefront replaces the whole code list — a retired code really goes", () => {
  const base = { name: "A", codes: [{ code: "OLD1", kind: "shop" }, { code: "KEEP", kind: "plain" }] };
  const out = mergeStorefront(base, { codes: [{ code: "KEEP", kind: "plain" }] });
  assert.deepEqual(out.codes.map((c) => c.code), ["KEEP"],
    "the app publishes a complete snapshot, so a code it stopped sending is gone");
  assert.deepEqual(base.codes.map((c) => c.code), ["OLD1", "KEEP"], "base is not mutated");

  // A remote that says nothing about codes leaves whatever the page already has.
  assert.deepEqual(mergeStorefront(base, { name: "B" }).codes, base.codes);
});

test("mergeStorefront adopts the landing page's copy, and never a blank line over it", () => {
  const out = mergeStorefront({ name: "A" }, {
    taster: {
      heading: "  A treat for your cat  ", body: "Scan, say hi",
      headingZh: "   ", headingMs: "Hadiah untuk kucing anda",
      instagram: " munchies_furkidz ", shop: "Munchies Furkidz",
      askPet: false, follow: "yes",
    },
  });
  assert.equal(out.taster.heading, "A treat for your cat");
  assert.equal(out.taster.body, "Scan, say hi");
  assert.equal("headingZh" in out.taster, false, "a blank box falls back to English");
  assert.equal(out.taster.headingMs, "Hadiah untuk kucing anda");
  assert.equal(out.taster.shop, "Munchies Furkidz");
  assert.equal(out.taster.askPet, false, "a switched-off dog/cat question is carried");
  assert.equal("follow" in out.taster, false, "only an explicit false turns the follow row off");
});
