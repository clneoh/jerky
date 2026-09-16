// test/store-track-jump.test.js — Engine v93: the "Track your order" link in the
// WhatsApp confirmation opens /store/?track=CODE, and the page used to land at
// the top with the card somewhere below the fold — the customer had to hunt for
// the very thing they tapped. Now the card is scrolled to and lit, and the glow
// is ended by the pointer ARRIVING on it, not by a clock: the same rule the
// backoffice uses when it jumps to an order (admin/js/views/orders.js).

import { test } from "node:test";
import assert from "node:assert/strict";

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
