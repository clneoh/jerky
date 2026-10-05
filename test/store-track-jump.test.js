// test/store-track-jump.test.js — Engine v93: the "Track your order" link in the
// WhatsApp confirmation opens /store/?track=CODE, and the page used to land at
// the top with the card somewhere below the fold — the customer had to hunt for
// the very thing they tapped. Now the card is scrolled to and lit, and the glow
// is ended by the pointer ARRIVING on it, not by a clock: the same rule the
// backoffice uses when it jumps to an order (admin/js/views/orders.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── Minimal DOM shim (same shape as test/store-lang-switch.test.js, plus a real
// removeEventListener and a scrollIntoView spy, which is what this file checks) ─
function createEl(tag) {
  const classes = new Set();
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollLeft: 0, _listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined ? !classes.has(c) : on) classes.add(c);
        else classes.delete(c);
      },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    scrollIntoView(opts) { this.scrolled = opts; this.aims = (this.aims || 0) + 1; },
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
  documentElement: createEl("html"),
  body: createEl("body"),
  // The REAL document has these. A shim without them is not a smaller DOM, it is a
  // different one: the shop registers a visibilitychange listener at start-up (v292),
  // and a missing method is a TypeError at import — every store test dies at once.
  _docListeners: {},
  addEventListener(t, f) { (this._docListeners[t] ||= []).push(f); },
  removeEventListener() {},
};
globalThis.window = { open() {} };
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US" }, configurable: true, writable: true,
});
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// store/config.js carries the real Supabase URL/anon key; the stub keeps the
// module-level render() and the lookup off the network (and off the live project).
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

// The link the customer taps in their WhatsApp message.
globalThis.location = { search: "?track=a3f9c2" };

await import("../store/app.js");

// The shop's own data (published config, the day's counts) lands a moment after
// the script runs, and the page grows with it — the same thing the browser did.
// Let every boot task finish before reading the page.
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
await settle();

const section = () => registry["track-section"];
const fire = (node, type) => (node._listeners[type] || []).forEach((f) => f({ type }));

test("the track link opens with the card under the customer's eye, and prefilled", () => {
  assert.equal(registry["track-input"].value, "A3F9C2", "the code from the link is in the box");
  assert.equal(section().classList.contains("hit"), true, "the card arrives lit");
  assert.deepEqual(section().scrolled, { block: "start", behavior: "smooth" },
    "and the page is scrolled to it — the card, with its heading above it");
});

test("the aim follows the page as the shop's own data lands", async () => {
  // Boot aims; the data then makes the page taller, and the second aim finishes
  // the job. Without it the card lands part-way down the screen instead of at the
  // top (measured at 375px: 113px short).
  assert.equal(section().aims >= 2, true, "aimed once at boot and once when the data landed");
  assert.equal(section().classList.contains("hit"), true, "still lit throughout — nothing re-aims after this");
});

test("the glow is ended by the customer reaching the card, not by the clock", () => {
  assert.equal(section().classList.contains("hit"), true, "still lit while the page settles");
  for (const type of ["pointerenter", "pointermove", "pointerdown", "mouseenter", "touchstart"]) {
    assert.ok((section()._listeners[type] || []).length, `the glow ends on ${type}`);
  }

  fire(section(), "pointerenter");
  assert.equal(section().classList.contains("hit"), false, "the pointer arriving puts it out");
  assert.equal((section()._listeners.pointerenter || []).length, 0,
    "and nothing is left listening once it has");
});

test("the order code comes OFF the address bar, and the friend's stamp stays", async () => {
  // ★ v324. Her report: __"when a customer track his order, his store version became associated
  // with that order code."__ The link opens `/store/?track=CODE` and that code used to stay in
  // the address — so the next time that page was opened, from a bookmark or from history, it
  // landed back on that ONE order's card instead of on the shop. **The page belonged to an
  // order rather than to the bakery.**
  //
  // ⚠️ **AND `via` MUST SURVIVE.** That is the friend's referral stamp, and a customer can
  // arrive BY a referral link and then track an order — stripping the whole query string
  // would silently break bring-a-friend for exactly that person.
  const calls = [];
  globalThis.history = { replaceState: (a, b, url) => calls.push(url) };
  globalThis.location = { search: "?track=a3f9c2&via=60123456789", pathname: "/store/", hash: "" };

  await import("../store/app.js?trackclean");

  assert.equal(calls.length, 1, "the address is rewritten exactly once");
  assert.equal(calls[0].includes("track"), false, "the order code is gone from the address");
  assert.ok(calls[0].includes("via=60123456789"), `the friend's stamp is kept: ${calls[0]}`);
  assert.ok(calls[0].startsWith("/store/"), `and the page is still the shop: ${calls[0]}`);
});

test("a customer who just opens the shop gets no glow", async () => {
  // Clear what the deep link did, then boot the SAME page with no ?track= in the
  // address: the card is a section of the page like any other, and nothing moves.
  // (The module is cached, so the fresh boot is imported under a new specifier;
  // the shim hands back the same node for the same id either way.)
  const box = section();
  box.scrolled = undefined;
  box.classList.remove("hit");
  globalThis.location = { search: "" };

  await import("../store/app.js?notrack");

  assert.equal(box.classList.contains("hit"), false, "no link, no glow");
  assert.equal(box.scrolled, undefined, "and the page is left where it opened");
});

test("the friend's number comes off the address once the order is placed — and only then", async () => {
  // ★ v325. Her question: __"for new customer clicking link from his friend, after he place an
  // order have you remove his page linking his friend phone number?"__ **It did not, and it
  // should.** `?via=60123456789` is the FRIEND'S OWN NUMBER, and it sat in the new customer's
  // address bar, their history, and anything they copied out of the address to pass on.
  //
  // ⚠️⚠️ **NOT WHEN THE PAGE OPENS.** A customer may arrive by the link and browse for ten
  // minutes before ordering; taking the stamp off on arrival would lose the referral entirely.
  // The safe moment is the one `placeOrder` already marks — **the path where the order really
  // landed** — so this drives the helper directly, and separately asserts WHERE it is called.
  const { forgetVia } = await import("../store/app.js?viatest");

  const calls = [];
  globalThis.history = { replaceState: (a, b, url) => calls.push(url) };
  globalThis.location = { search: "?via=60123456789&track=a3f9c2", pathname: "/store/", hash: "" };
  assert.equal(forgetVia(), true, "it reports that it did something");
  assert.equal(calls[0].includes("via"), false, "the friend's number is gone");
  assert.ok(calls[0].includes("track=a3f9c2"), `and an old order's code is left for its own rule: ${calls[0]}`);

  // Nothing to remove is not a rewrite of the address.
  calls.length = 0;
  globalThis.location = { search: "?track=a3f9c2", pathname: "/store/", hash: "" };
  assert.equal(forgetVia(), false, "no stamp, no work");
  assert.equal(calls.length, 0, "and the address is untouched");

  // And it is called on the placed-order path, NOWHERE else.
  // ⚠️ ANCHORED ON `rememberShopOrder` RATHER THAN ON `if (r.ok)`, because that is the line whose
  // own comment says it is on "the one path where the order really landed" — two comments and two
  // clean-ups about the same moment sit together, and a count of characters between a vague anchor
  // and the call is a measurement of the file's line length rather than of the code.
  const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  const at = src.indexOf("rememberShopOrder(promoApplied)");
  assert.ok(at > -1, "the placed-order branch was not found");
  const next = src.indexOf("forgetVia()", at);
  assert.ok(next > at && next - at < 500,
    "the stamp must come off on the branch where the order really landed, beside rememberShopOrder");
});
