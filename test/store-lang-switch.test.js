// test/store-lang-switch.test.js — Engine v71: the shop's EN / 中文 / BM pills
// switch the page IN PLACE. Nothing reloads, nothing re-fetches, and the
// customer's basket is never thrown away. Before v71 each pill press called
// window.location.reload(), so every tap re-downloaded the page and re-fetched
// the menu, the slots-left numbers and the product photos from Supabase — the
// pause a customer feels on a phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STORE } from "../store-lang.js";

const SRC = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");

// ── Minimal DOM shim (same shape as test/store.test.js, plus a real classList
// so a pill's lit state can be asserted, and a documentElement so the language
// boot block runs — that is the code under test). ────────────────────────────
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
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
}

const registry = {};
const pills = ["en", "zh", "ms"].map((lang) => {
  const b = createEl("button");
  b.dataset.lang = lang;
  return b;
});
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  // The boot block is the only caller that names the pills; every other selector
  // (the data-i18n tags) has no node in this shim, so [] is right.
  querySelectorAll: (sel) => (String(sel).includes("lang-pill") ? pills : []),
  documentElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
// Pin the browser locale: loadLang() seeds the language from navigator.language
// when the device has no saved choice, so an OS on 中文 must not move the
// starting point of this test. (globalThis.navigator is getter-only in Node, so
// it has to be redefined rather than assigned.)
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
// module-level render() from reaching the network (and the live project).
let fetchCount = 0;
globalThis.fetch = async () => { fetchCount += 1; return { ok: true, json: async () => [] }; };

const { setLang, trackOrder } = await import("../store/app.js");

// ── helpers ─────────────────────────────────────────────────────────────────
const btn = () => registry["order-btn"];
const barTotal = () => registry["bar-total"].textContent;
const litPill = () => pills.find((p) => p.classList.contains("is-on"));
const firstCardStepper = () =>
  registry["menu"].children[0].children.find((c) => c.className === "stepper");
const pillDateText = () => registry["dates"].children[0].children[0].children[0].text;

test("the shop starts in English and the EN pill is lit", () => {
  assert.equal(document.documentElement.lang, "en");
  assert.equal(litPill(), pills[0], "EN is the lit pill on a fresh visit");
  assert.equal(btn().textContent, STORE.en.placeOrder);
  assert.equal(btn().disabled, true, "empty basket leaves the button disabled");
});

test("switching to 中文 repaints in place and keeps the basket", () => {
  // Put one Chicken Jerky in the basket (RM22) through the real stepper.
  firstCardStepper().children[2]._listeners.click[0]();
  assert.equal(barTotal(), "RM22.00", "the basket has one Chicken Jerky");
  assert.equal(btn().disabled, false);

  const before = fetchCount;
  assert.equal(setLang("zh"), true, "the switch reports that it changed the language");

  assert.equal(btn().textContent, "提交订单", "the order button is Chinese");
  assert.equal(barTotal(), "RM22.00", "the basket survived the switch");
  assert.equal(btn().disabled, false, "and the button is still usable");
  assert.equal(litPill(), pills[1], "the 中文 pill is now lit");
  assert.equal(document.documentElement.lang, "zh", "the page declares its language");
  assert.equal(localStorage.getItem("siteLang"), "zh", "the choice is remembered on the device");
  assert.match(pillDateText(), /月/, "the date pills read in Chinese (month name)");
  assert.match(pillDateText(), /日/, "…and the day");
  assert.equal(fetchCount, before, "the switch re-reads nothing over the network");
});

test("the rebuilt menu card still shows the chosen quantity", () => {
  // The switch rebuilds every card; the cart lives in a closure the rebuild
  // reads, so the stepper must come back counting the same item. (The shim
  // keeps textContent separate from the appended text nodes — read the node.)
  assert.equal(firstCardStepper().children[1].children[0].text, "1");
});

test("a repeat tap on the language already showing does nothing", () => {
  const before = fetchCount;
  assert.equal(setLang("zh"), false, "no change → the pill does not even repaint");
  assert.equal(btn().textContent, "提交订单");
  assert.equal(fetchCount, before);
});

test("an unknown language is ignored", () => {
  assert.equal(setLang("de"), false);
  assert.equal(setLang(""), false);
  assert.equal(setLang(null), false);
  assert.equal(btn().textContent, "提交订单", "still Chinese");
  assert.equal(localStorage.getItem("siteLang"), "zh");
});

test("switching 中文 → BM relabels the page and the order button", () => {
  assert.equal(setLang("ms"), true);
  assert.equal(btn().textContent, "Hantar tempahan");
  assert.equal(litPill(), pills[2], "the BM pill is lit");
  assert.equal(barTotal(), "RM22.00", "the basket is still there");
});

test("the track card repaints in the chosen language with no network", async () => {
  const box = registry["track-result"];

  await trackOrder("");          // "enter your order number" card, no fetch
  assert.equal(box.children[0].children[0].text, STORE.ms.trackEnter, "the card is Malay");

  const before = fetchCount;
  assert.equal(setLang("en"), true);
  assert.equal(box.children[0].children[0].text, STORE.en.trackEnter,
    "the same card re-reads in English, from the cached lookup — not a new fetch");
  assert.equal(fetchCount, before, "repainting the track card hits no network");
  assert.equal(btn().textContent, STORE.en.placeOrder, "and the order button is back to English");
  assert.equal(barTotal(), "RM22.00", "the basket is untouched by every switch");
});

test("the language pills are wired to the in-place switch", () => {
  // Drive the pill's own click handler (the wiring the visitor actually taps).
  pills[1]._listeners.click[0]();
  assert.equal(btn().textContent, "提交订单", "tapping 中文 switches the page in place");
  assert.equal(litPill(), pills[1]);
  assert.equal(barTotal(), "RM22.00", "the basket is still intact after a pill tap");
});

test("store/app.js never reloads the page for a language change", () => {
  // A regression guard for the v71 fix: the switch must stay in place.
  assert.equal(/location\s*\.\s*reload\s*\(/.test(SRC), false);
  assert.equal(/window\s*\.\s*location\s*\.\s*reload\s*\(/.test(SRC), false);
});
