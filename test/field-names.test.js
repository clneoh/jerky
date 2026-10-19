// test/field-names.test.js — every box is announced by the words printed beside it (v566).
//
// ⚠️⚠️ THE FAULT: the app had 246 `<label>` elements and **not one `for=`**, and about 178 boxes carried no
// `aria-label`. ⭐ The words were always on screen, but a label that is only NEAR a box is not attached to
// it — so a screen reader said "edit text" for every one, and voice control could not name them.
//
// ⭐ `nameFields` does it once, after each render, from the label the app already draws.

import { test } from "node:test";
import assert from "node:assert/strict";

const { nameFields } = await import("../admin/js/ui.js");

// The smallest tree `nameFields` needs: elements with attributes, siblings and a query. ⚠️ Deliberately not
// a full DOM — this file tests the naming rule, and a bigger stand-in would only hide which part is used.
const tag = (name, attrs = {}, children = []) => {
  const node = {
    nodeType: 1, tagName: name.toUpperCase(), attrs: { ...attrs }, children, parentNode: null,
    get textContent() { return this.children.map((c) => (c.textContent != null ? c.textContent : "")).join(" "); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    },
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 && this.parentNode.children[i - 1].nodeType === 1 ? this.parentNode.children[i - 1] : null;
    },
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      const next = this.parentNode.children[i + 1];
      return next && next.nodeType === 1 ? next : null;
    },
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    append(...cs) { for (const c of cs) { if (c && c.nodeType) { c.parentNode = this; this.children.push(c); } } },
    querySelector(sel) {
      for (const c of this.children) {
        if (c.nodeType === 1 && c.tagName.toLowerCase() === sel.split("[")[0].toLowerCase()) return c;
        const d = c.querySelector ? c.querySelector(sel) : null;
        if (d) return d;
      }
      return null;
    },
    querySelectorAll(sel) {
      const want = sel.split(",").map((x) => x.trim().toLowerCase());
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.nodeType === 1 && want.includes(c.tagName.toLowerCase())) out.push(c);
          if (c.children) walk(c);
        }
      };
      walk(this);
      return out;
    },
  };
  for (const c of children) c.parentNode = node;
  return node;
};
const text = (s) => ({ nodeType: 3, textContent: s });

test("★★★ a box with a label before it is NAMED by that label", () => {
  const input = tag("input", { type: "number" });
  const field = tag("div", { class: "field" }, [tag("label", {}, [text("Capacity / day")]), input]);
  const root = tag("div", {}, [field]);
  assert.equal(nameFields(root), 1);
  assert.equal(input.getAttribute("aria-label"), "Capacity / day");
});

test("★★★ a label that WRAPS the box names it — never the row above (v568)", () => {
  // ⚠️⚠️ THE REGRESSION THIS PINS. The first `labelFor` skipped a wrapping label and took the PREVIOUS
  // sibling's, so the bake-day rows read Sun→"Bake days", Mon→"Sun", Tue→"Mon" … ⭐ **and because
  // `aria-label` overrides the implicit name, controls that were already right were relabelled wrong.**
  const mk = (word) => {
    const input = tag("input", { type: "checkbox" });
    return tag("label", { class: "daycheck" }, [input, text(word)]);
  };
  const rows = ["Mon", "Tue", "Wed"].map(mk);
  const root = tag("div", {}, [tag("div", {}, [tag("span", {}, [text("Bake days")]), ...rows])]);
  nameFields(root);
  assert.deepEqual(rows.map((l) => l.children[0].getAttribute("aria-label")), ["Mon", "Tue", "Wed"],
    "★ a box inside a label was named by the row above it — **an aria-label overrides the right answer**");
});

test("★★★ and a name already on the box is never overwritten", () => {
  const input = tag("input", { "aria-label": "The bakery's number" });
  const root = tag("div", {}, [tag("div", {}, [tag("label", {}, [text("WhatsApp number")]), input])]);
  assert.equal(nameFields(root), 0);
  assert.equal(input.getAttribute("aria-label"), "The bakery's number");
});

test("★★★ a box whose label is AFTER it still gets the name — the app draws both ways", () => {
  const input = tag("input", { type: "text" });
  const root = tag("div", {}, [tag("div", {}, [input, tag("label", {}, [text("Note (optional)")])])]);
  nameFields(root);
  assert.equal(input.getAttribute("aria-label"), "Note (optional)");
});

test("★★★ words are collapsed, and an empty label names nothing", () => {
  const a = tag("input");
  const b = tag("input");
  const root = tag("div", {}, [
    tag("div", {}, [tag("label", {}, [text("  Cost\n   per   unit  (RM) ")]), a]),
    tag("div", {}, [tag("label", {}, [text("   ")]), b]),
  ]);
  nameFields(root);
  assert.equal(a.getAttribute("aria-label"), "Cost per unit (RM)");
  assert.equal(b.getAttribute("aria-label"), null, "★ a blank label named the box nothing at all");
});

test("★★★ a SWITCH whose words sit BESIDE it is named by them (v591)", () => {
  // ⚠️⚠️ MEASURED: the markup is `<label class=switch><input><span><span></label>` with the description in
  // the NEXT sibling — ⚠️ **so the label's own text was empty and the box got NO name at all: a screen
  // reader said just "checkbox", and voice control could not name it.** ⭐ The words beside the switch are
  // its name.
  const box = tag("input", { type: "checkbox" });
  const label = tag("label", { class: "switch" }, [
    box,
    tag("span", { class: "switch-track" }, [tag("span", { class: "switch-knob" })]),
  ]);
  const words = tag("span", { class: "avail-listed-text" }, [text("Keep it on the shop when it can't be ordered")]);
  const root = tag("div", {}, [tag("div", { class: "avail-listed" }, [label, words])]);
  nameFields(root);
  assert.equal(box.getAttribute("aria-label"), "Keep it on the shop when it can't be ordered",
    "★ a switch with its words next to it was left with no name — **a screen reader says just checkbox**");
});

test("★★★ an input with no label anywhere is left alone rather than given a wrong name", () => {
  const input = tag("input", { type: "search" });
  const root = tag("div", {}, [tag("div", {}, [input])]);
  assert.equal(nameFields(root), 0);
  assert.equal(input.getAttribute("aria-label"), null);
});


test("★★★ a div with a click is a BUTTON, and Enter presses it (v566)", async () => {
  // ⚠️⚠️ Twenty-four controls were a div or a span with an onclick and nothing else — the Home tiles, a
  // delivery day, a history row — ⭐ so a keyboard could not reach them at all. ⭐ The upgrade lives in `el()`,
  // so every one of them and every one written tomorrow is a button without touching a call site.
  const realDoc = globalThis.document;
  globalThis.document = {
    createElement: (t) => tag(t, {}),
    createTextNode: (x) => ({ nodeType: 3, textContent: String(x) }),
  };
  try {
    const { el } = await import("../admin/js/ui.js");
    let pressed = 0;
    const tile = el("div", { class: "tile", onclick: () => { pressed += 1; } }, "Home");
    assert.equal(tile.getAttribute("role"), "button", "★ a clickable div is not announced as pressable");
    assert.equal(tile.getAttribute("tabindex"), "0", "★ a clickable div cannot be reached by a keyboard");
    const key = (tile.listeners.keydown || []).find(Boolean);
    assert.ok(key, "★ the tab stop is a dead end — no Enter key handling");
    key({ key: "Enter", target: tile, preventDefault() {} });
    assert.equal(pressed, 1, "★ Enter does not press it");

    // ⚠️ And a caller who says what it is keeps its own answer.
    const given = el("div", { role: "listitem", onclick: () => {} }, "Row");
    assert.equal(given.getAttribute("role"), "listitem");

    // ⚠️⚠️ AND A KEY PRESSED ON A CHILD DOES NOT RUN THE PARENT (v568): a chip that contains a ✕ must let
    // the ✕ take its own Enter, or the ✕ would paste the chip's name back instead of removing it.
    let parent = 0;
    const chip = el("div", { onclick: () => { parent += 1; } }, "Chip");
    const inner = el("button", { onclick: () => {} }, "✕");
    const chipKey = (chip.listeners.keydown || [])[0];
    chipKey({ key: "Enter", target: inner, preventDefault() {} });
    assert.equal(parent, 0, "★ a key pressed on the child ran the parent's press — **the ✕ cannot work**");

    // ⚠️ A real button is untouched: it is already one.
    const btn = el("button", { onclick: () => {} }, "Save");
    assert.equal(btn.getAttribute("role"), null);
    assert.equal(btn.getAttribute("tabindex"), null);
  } finally {
    if (realDoc === undefined) delete globalThis.document; else globalThis.document = realDoc;
  }
});
