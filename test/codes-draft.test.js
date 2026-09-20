// test/codes-draft.test.js — the working copy a sales-code label is edited on.
//
// One rule here is invisible when it is wrong, which is why it is pinned: a
// label's `trOverride` is an ARRAY of variant names, and the pop-up copies it so
// a box the owner types in and then abandons cannot mark the record underneath.
// Copying an array with an object spread ({...arr}) yields {"0":"headingZh"} —
// and isOverridden() only reads an array, so every box she had typed by hand
// would read as machine text again and the next Fill 中文 / BM would overwrite
// her words. The screen has no other coverage; this is the part a test can hold.

import { test } from "node:test";
import assert from "node:assert/strict";

// The views import the DOM helpers at module scope, so a minimal shim has to be
// in place before the dynamic import (the same shape test/no-null-text.test.js
// uses). Nothing below touches a real node.
function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, scrollHeight: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) {
      for (const c of cs) this.children.push(c && c.nodeType ? c : { nodeType: 3, text: String(c) });
    },
    replaceChildren(...cs) {
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

const layers = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (layers[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollingElement: createEl("html"),
  body: createEl("body"),
  documentElement: createEl("html"),
};
globalThis.window = { open() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.history = { replaceState() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.confirm = () => false;
globalThis.prompt = () => null;

const { codeDraft } = await import("../admin/js/views/codes.js");
const { isOverridden, markManual } = await import("../admin/js/translate.js");

const TASTER = { offerType: "rm", offerValue: 5, offerMin: 30, validDays: 30 };

function stateWith(codes) {
  return { codes, products: [], partners: [], settings: { taster: TASTER } };
}

test("an edit copies the label's hand-typed boxes as an array, not an object", () => {
  const code = {
    id: "c1", code: "MILO", kind: "shop", active: true,
    heading: "New here?", headingZh: "新手?", headingMs: "Baru di sini?",
    trOverride: ["headingZh", "headingMs"],
    trSrc: { bodyZh: "Say hi at the counter" },
    offer: { type: "rm", value: 5 },
  };
  const draft = codeDraft(code, stateWith([code]), TASTER, "2026-09-20");

  assert.ok(Array.isArray(draft.trOverride), "trOverride must stay an array");
  assert.deepEqual(draft.trOverride, ["headingZh", "headingMs"]);
  // The point of the copy: those boxes still read as hers in the pop-up.
  assert.equal(isOverridden(draft, "headingZh"), true);
  assert.equal(isOverridden(draft, "headingMs"), true);
  assert.equal(isOverridden(draft, "bodyZh"), false);
});

test("touching one box in the pop-up keeps the label's other hand-typed boxes hers", () => {
  const code = { id: "c1", code: "MILO", kind: "shop", active: true,
    trOverride: ["headingZh"], trSrc: { bodyMs: "Say hi" } };
  const draft = codeDraft(code, stateWith([code]), TASTER, "2026-09-20");
  markManual(draft, "bodyZh"); // she clears or types the 中文 paragraph

  assert.deepEqual([...draft.trOverride].sort(), ["bodyZh", "headingZh"]);
  assert.equal(isOverridden(draft, "headingZh"), true, "the earlier box must survive");
  assert.deepEqual(draft.trSrc, { bodyMs: "Say hi" }, "clearing one box keeps the others' source");
});

test("nothing typed in the pop-up reaches the record until Save", () => {
  const code = { id: "c1", code: "MILO", kind: "shop", active: true,
    heading: "New here?", trOverride: ["headingZh"], trSrc: { bodyMs: "Say hi" },
    offer: { type: "rm", value: 5 } };
  const draft = codeDraft(code, stateWith([code]), TASTER, "2026-09-20");
  draft.heading = "Something else";
  draft.headingZh = "别的";
  draft.offer.value = 9;
  markManual(draft, "bodyZh");

  assert.equal(code.heading, "New here?", "the label underneath is untouched");
  assert.equal("headingZh" in code ? code.headingZh : undefined, undefined);
  assert.equal(code.offer.value, 5, "the offer is copied too");
  assert.deepEqual(code.trOverride, ["headingZh"]);
  assert.deepEqual(code.trSrc, { bodyMs: "Say hi" });
});

test("a label with no hand-typed boxes starts from an empty list", () => {
  const plain = codeDraft({ id: "c2", code: "K3X9", kind: "plain" }, stateWith([]), TASTER, "2026-09-20");
  assert.deepEqual(plain.trOverride, []);
  assert.deepEqual(plain.trSrc, {});
  // A record carrying the wrong shape must not leak it through either.
  const odd = codeDraft({ id: "c3", code: "K3X9", trOverride: { 0: "headingZh" } }, stateWith([]), TASTER, "2026-09-20");
  assert.deepEqual(odd.trOverride, []);
});

test("a new label gets its own code and the shared page's default offer", () => {
  const draft = codeDraft(null, stateWith([{ code: "MILO" }]), TASTER, "2026-09-20");
  assert.ok(draft.id, "a new label has an id");
  assert.equal(draft.code.length, 5, "a fresh 5-character code");
  assert.notEqual(draft.code, "MILO", "never a code already on a printed label");
  assert.deepEqual(draft.offer, { type: "rm", value: 5, minSpend: 30, from: "2026-09-20", to: "2026-10-20" });
});
