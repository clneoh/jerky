// test/ui.test.js — el()/select() DOM-building behavior.
// Guards the select() helper: exactly ONE option may be selected. A
// `selected: false` value must never be set as an attribute — in a real browser
// "selected" is a boolean attribute, so any presence (even ="false") selects
// the option, and with every option selected the browser falls back to showing
// the LAST one.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, selected: false, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
  };
}
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => createEl("div"),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};

import { select } from "../admin/js/ui.js";

const STATUSES = [
  { value: "new", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "delivered", label: "Delivered" },
];

test("select() marks exactly the matching option selected, no stray attributes", () => {
  const s = select(STATUSES, "confirmed", () => {});
  assert.equal(s.children.length, 3);

  assert.equal(s.children[1].selected, true, "matching option is selected");
  assert.equal(s.children[1].attrs.selected, undefined, "selected set as a property, not an attribute");

  for (const [i, o] of s.children.entries()) {
    if (i === 1) continue;
    assert.equal(o.selected, false, `option ${i} is not selected`);
    assert.equal(o.attrs.selected, undefined, `option ${i} carries no selected attribute`);
  }
});

test("select() with no match leaves every option unselected", () => {
  const s = select(STATUSES, "zzz", () => {});
  for (const o of s.children) {
    assert.equal(o.selected, false);
    assert.equal(o.attrs.selected, undefined);
  }
});

test("select() placeholder is selected when the value is empty", () => {
  const s = select([{ value: "a", label: "A" }], "", () => {}, "All statuses");
  assert.equal(s.children[0].selected, true, "placeholder selected when value is empty");
  assert.equal(s.children[1].selected, false, "real option not selected");
  assert.equal(s.children[1].attrs.selected, undefined);
});
