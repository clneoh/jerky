// test/store-code.test.js — the customer's half of the sales-code feature: what a
// page opened from a printed label says, and what the order it produces carries.
// A separate file from store.test.js because the page reads ?c= once at boot, and
// a Node module is imported once — so the boot search has to be set before the
// import, and a language switch is used to repaint the banner for the next case.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM shim, the same one the other store tests define inline.
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {},
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

// The page the label opened, before the module is imported.
globalThis.location = { search: "?c=milo" };

// What Settings → Storefront has published. Only the two keys this feature adds —
// the rest of the page keeps its local fallback, so the boot render is the one the
// other store tests already exercise.
const published = {
  name: "Munchies Furkidz",
  codes: [
    // Far future on purpose: the shop honours the offer's end date now, so a
    // near date would make these tests start failing on its own. The asserted
    // wording is unchanged either way — shortDay prints only the day and month.
    { code: "MILO", kind: "promo", productName: "Chicken Jerky",
      offer: { type: "pct", value: 10, minSpend: 30, to: "2030-09-30", newOnly: true, cur: "RM" } },
    { code: "PSHOP", kind: "shop", partnerName: "Paw Shop" },
    { code: "RM5OFF", kind: "promo",
      offer: { type: "rm", value: 5, cur: "RM", minSpend: 0, to: "", newOnly: false } },
    { code: "OLD1", kind: "promo", productName: "Chicken Jerky",
      offer: { type: "pct", value: 10, minSpend: 30, to: "2020-01-01", cur: "RM" } },
    { code: "GONE", kind: "promo" },
    { code: "FRIEND", kind: "intro" },
  ],
  taster: { heading: "A treat for your cat", askPet: true, follow: true },
};

const stubFetch = async (url, opts) => {
  if (opts && opts.method === "POST") return { ok: true };
  if (String(url).includes("storefront_config")) {
    return { ok: true, json: async () => [{ data: JSON.stringify(published) }] };
  }
  return { ok: true, json: async () => [] };
};
globalThis.fetch = stubFetch;

const { parseCode, setLang, mergeStorefront } = await import("../store/app.js");
const { CONFIG } = await import("../store/config.js");

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

const banner = () => registry["code-banner"];
const note = () => registry["code-note"];
const menuCard = () => registry["menu"].children[0];

// The boot render reads ?c= once. A language switch repaints the banner from the
// current search — which is also what a customer sees when they tap 中文 — so the
// next case moves the search and asks for a repaint. The sequence always contains
// a change whatever language the machine's own locale suggests, and it ends on
// English, the language the shim's lookups read.
//
// The typed-code box is emptied first: a value left in it outranks the link's own
// code, so it would otherwise leak into every later case.
async function withSearch(search) {
  globalThis.location = { search };
  registry["code-input"].value = "";
  setLang("en");
  setLang("zh");
  setLang("en");
  await settle();
  return banner();
}

// What a customer typing in the box does: put the letters in and press Apply.
// Unlike a code from the link, this repaints the line rather than reloading.
function typeCode(code) {
  registry["code-input"].value = code;
  registry["code-btn"]._listeners.click[0]();
}

// Drive the basket to exactly `n` of the menu's first product. A repaint does not
// empty the basket (rerender only reconciles it against what is left), so a case
// that needs an exact total has to set one rather than assume a clean start. The
// count is read off the bar, which renderBar keeps true, and the repaint at the
// end is the one a customer gets from Apply.
function basketTo(n) {
  const total = () => Number((/RM([\d.]+)/.exec(registry["bar-total"].textContent) || [])[1] || 0);
  const step = (dir) => {
    const s = menuCard().children.find((c) => c.className === "stepper");
    (dir > 0 ? s.children[2] : s.children[0])._listeners.click[0]();
  };
  // The stepper caps at what is left (unlimited here — the availability fetch is
  // stubbed empty), so the guard is only against a runaway loop.
  let guard = 0;
  while (total() > 0 && guard++ < 40) step(-1);
  for (let i = 0; i < n; i++) step(+1);
  registry["code-btn"]._listeners.click[0]();
  return total();
}

// Place one order off the current page state and hand back what the shop POSTed.
// The search is set first: a repaint rebuilds the menu, so the stepper is read
// fresh each time. `code`, when given, is typed into the box after the search
// lands — the customer who was told the code rather than handed the link.
async function ordering(search, whatsapp = "60123456789", code = "") {
  await withSearch(search);
  if (code) typeCode(code);
  const stepper = menuCard().children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0](); // "+" — one more item in the basket
  document.getElementById("whatsapp-input").value = whatsapp;
  document.getElementById("fulfillment")._value = "collect"; // no postal address needed
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = JSON.parse(opts.body)[0].data; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    await registry["order-btn"].onclick();
  } finally {
    globalThis.fetch = stubFetch;
  }
  return posted === null ? null : JSON.parse(posted);
}

await settle();

test("parseCode reads the label's code off the link, however it was typed", () => {
  assert.equal(parseCode("?c=milo"), "MILO");
  assert.equal(parseCode("?c=MILO"), "MILO");
  assert.equal(parseCode("?via=60139876543&c=k3x9"), "K3X9");
  assert.equal(parseCode("?c=%20milo%20"), "MILO");
  assert.equal(parseCode("?track=A3F9C2"), "");
  assert.equal(parseCode(""), "");
  assert.equal(parseCode(null), "");
});

test("a scanned label states its offer, in words", async () => {
  const box = await withSearch("?c=milo");
  assert.equal(box.hidden, false);
  // The code was written lower-case in the link and still resolves.
  assert.equal(box.textContent,
    "🎁 10% off · on RM30 and above · new customers only · valid until 30 Sep");
});

test("an amount-off label reads in ringgit, and says only what was set", async () => {
  const box = await withSearch("?c=RM5OFF");
  assert.equal(box.textContent, "🎁 RM5 off", "no minimum and no end date, so neither is said");
});

test("a shop's label says where the treat came from, and nothing more", async () => {
  const box = await withSearch("?c=pshop");
  assert.equal(box.textContent, "🎁 from Paw Shop");
});

test("a code with nothing to say leaves the page exactly as it was", async () => {
  // OLD1 is the expiry case: an offer that was published and whose end date has
  // since passed is published as no offer at all, so the shop says nothing —
  // the same answer the landing page gives it.
  for (const search of ["?c=GONE", "?c=FRIEND", "?c=NOSUCHCODE", "?c=OLD1", ""]) {
    const box = await withSearch(search);
    assert.equal(box.hidden, true, `${search || "(no code)"} shows no banner`);
    assert.equal(box.textContent, "", "and writes nothing into it");
  }
});

test("an order placed from a label carries the code and what kind of label it was", async () => {
  const payload = await ordering("?c=pshop");
  assert.ok(payload, "the order was placed");
  assert.equal(payload.promoCode, "PSHOP");
  assert.equal(payload.codeKind, "shop");
  // The shop behind the code is read back from the code record, never copied onto
  // the order where a later rename would leave two disagreeing answers.
  assert.equal("partnerName" in payload, false);
});

test("an offer is stated on the page and never subtracted from the order", async () => {
  // The rule the whole feature rests on: an order freezes the price it was sold
  // at, and Money and Profit read that. So the page tells the customer what the
  // label offers, and the amount comes off by hand at the WhatsApp confirmation.
  const payload = await ordering("?c=milo");
  const gross = payload.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  assert.ok(gross > 0);
  assert.equal(payload.total, gross, "the shop charges the full price");
  assert.equal(payload.promoCode, "MILO", "and still records which label it came in on");
});

test("a ?c= the app never published is not treated as a label", async () => {
  const payload = await ordering("?c=NOTREAL");
  assert.equal(payload.promoCode, undefined, "a made-up code is not written into the books");
  assert.equal(payload.codeKind, undefined);
});

test("a ?c= and a ?via= can ride together on one link", async () => {
  // How a bring-a-friend label's QR reads. The number travels in the link, so the
  // existing credit scheme fires with no change to the shop and no customer number
  // ever leaving the app in the published settings.
  const payload = await ordering("?c=FRIEND&via=60123456789", "60139999999");
  assert.equal(payload.referredBy, "60123456789");
  assert.equal(payload.promoCode, "FRIEND");
  assert.equal(payload.codeKind, "intro");
});

test("the landing page's copy reaches the shop without disturbing anything else", () => {
  const out = mergeStorefront({ name: "A" }, { taster: published.taster, codes: published.codes });
  assert.equal(out.taster.heading, "A treat for your cat");
  assert.equal(out.name, "A", "a config that says nothing about the name leaves the page's own alone");
  assert.equal(CONFIG.codes.length, published.codes.length, "the boot merge adopted the list");
  assert.equal(CONFIG.taster.heading, "A treat for your cat");
});

// ---- the line under the offer ---------------------------------------------
// The customer's confirmation comes on WhatsApp, not on this page, so the page has
// to say what happens next — and it must never touch the bar's total, because the
// price an order was sold at is frozen and Money and Profit read that.

test("a live offer says the money comes off at the confirmation", async () => {
  await withSearch("?c=milo");
  basketTo(2); // 2 x the first product clears the RM30 minimum
  assert.equal(note().hidden, false);
  assert.equal(note().textContent,
    "We'll take this off when we confirm on WhatsApp — the total shown is before the discount.");
});

test("a basket under the minimum is told exactly how much more to add", async () => {
  await withSearch("?c=milo");
  basketTo(0);
  assert.equal(note().textContent, "Add RM30.00 more to use it.",
    "an empty basket needs the whole minimum");

  const one = basketTo(1);
  const unit = one; // one of the first product, so its own price
  assert.equal(note().textContent, `Add RM${(30 - unit).toFixed(2)} more to use it.`);
  assert.equal(registry["bar-total"].textContent, `RM${unit.toFixed(2)}`,
    "and the bar still shows the full price");

  basketTo(2);
  assert.ok(note().textContent.startsWith("We'll take this off"),
    "two clears the minimum, so the line becomes the confirmation notice");
  assert.equal(registry["bar-total"].textContent, `RM${(unit * 2).toFixed(2)}`,
    "with nothing taken off it");
});

test("a code the customer types in is answered, and one off the link is not", async () => {
  // A label already in someone's hand is not nagged at for having expired; a code
  // typed into the box is the customer's own doing and gets an answer.
  await withSearch("?c=OLD1");
  assert.equal(note().hidden, true, "the label's own expired code has nothing to say");

  await withSearch("?c=GONE");
  assert.equal(note().hidden, true, "nor does a label that never carried an offer");
  typeCode("GONE");
  assert.equal(note().textContent, "Saved — that code has no discount on it.");

  await withSearch("?c=milo");
  typeCode("NOSUCH");
  assert.equal(note().textContent, "We don't know that code — check the letters and try again.");
  assert.equal(banner().hidden, true, "and a code the app never published states no offer");
});

test("typing a code replaces the one the label carried", async () => {
  const box = await withSearch("?c=milo");
  assert.equal(box.textContent,
    "🎁 10% off · on RM30 and above · new customers only · valid until 30 Sep");
  typeCode("pshop");
  assert.equal(banner().textContent, "🎁 from Paw Shop", "the typed code wins, lower case and all");
});

test("a code typed in is honoured the same as one that was scanned", async () => {
  const payload = await ordering("", "60123456789", "pshop");
  assert.equal(payload.promoCode, "PSHOP");
  assert.equal(payload.codeKind, "shop");
});

test("a code typed in replaces the label's own on the order it produces", async () => {
  const payload = await ordering("?c=milo", "60123456789", "pshop");
  assert.equal(payload.promoCode, "PSHOP", "what the customer ended up using is what is recorded");
  const gross = payload.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  assert.equal(payload.total, gross, "and the shop still charges the full price");
});

test("a typed code the app never published is not written into the books", async () => {
  const payload = await ordering("", "60123456789", "NOTREAL");
  assert.equal(payload.promoCode, undefined, "a made-up code is not a label");
  assert.equal(payload.codeKind, undefined);
});
