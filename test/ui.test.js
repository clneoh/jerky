// test/ui.test.js — el()/select() DOM-building behavior.
// Guards the select() helper: exactly ONE option may be selected. A
// `selected: false` value must never be set as an attribute — in a real browser
// "selected" is a boolean attribute, so any presence (even ="false") selects
// the option, and with every option selected the browser falls back to showing
// the LAST one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, selected: false, disabled: false,
    // A real element always answers these, so the shim must too: a pop-up body
    // that reports scrollTop as undefined would let a scroll bug pass unnoticed.
    scrollTop: 0, hidden: false,
    _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; }
    },
    // A real node walks up its own ancestors, so the shim keeps a parent link and
    // walks the same way. The drag handle asks whether a press landed on a button
    // or a field (`closest`), and a shim without it would answer "no control here"
    // for every press — including the ones on the close button, which is the one
    // press that must never start a drag.
    closest(sel) {
      const want = String(sel).split(",").map((s) => s.trim().toUpperCase());
      let n = this;
      while (n && n.nodeType === 1) {
        if (want.includes(String(n.tagName).toUpperCase())) return n;
        n = n.parent;
      }
      return null;
    },
    // Recorded, not dropped: select() paints the picker on change, and the only
    // way to prove that here is to fire the handler the caller would fire.
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }; },
  };
}
// By id, and the SAME node every time — a real getElementById does not hand back
// a fresh element per call, and showPopup() fills the one shared #popup-layer.
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};

import { select, showPopup, el } from "../admin/js/ui.js";

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

// ── Engine v121/v122 — the product picker's tones and its sections ───────────
// The product picker hands each choice a tone (on the shop / sold out today /
// taken down) and names its section. The closed box wears the tone — the only
// part of a native list a page can reach — and each section becomes an
// <optgroup>, which every platform draws as its own headed block.
const TONED = [
  { value: "a", label: "Focaccia", tone: "ok", group: "On the shop" },
  { value: "b", label: "Ciabatta", tone: "warn", group: "Sold out" },
  { value: "c", label: "Pandan", tone: "off", group: "Taken down" },
];

test("select() wears the tone of the option it holds", () => {
  assert.equal(select(TONED, "a", () => {}).className, "toned tone-ok");
  assert.equal(select(TONED, "b", () => {}).className, "toned tone-warn");
  assert.equal(select(TONED, "c", () => {}).className, "toned tone-off");
});

test("select() with no choice, or a toneless one, wears no colour", () => {
  assert.equal(select(TONED, "", () => {}, "Product…").className, "toned",
    "a toned menu with nothing picked yet is marked, but uncoloured");
  assert.equal(select(STATUSES, "new", () => {}).className, "", "a toneless list stays plain");
});

test("select() repaints on change, and a caller's own class survives it", () => {
  const s = select(TONED, "a", () => {}, "Product…");
  s.className = "input";            // the status filter does exactly this
  s.value = "b";
  s._listeners.change[0]();         // what the browser fires when she picks
  assert.equal(s.className, "input toned tone-warn", "the tone follows the choice, the class stays");
  s.value = "";
  s._listeners.change[0]();
  assert.equal(s.className, "input toned", "and a repaint with no tone drops just the colour");
});

test("select() turns each run of options into a headed section", () => {
  const s = select(TONED, "a", () => {}, "Product…");
  assert.deepEqual(s.children.map((c) => c.tagName), ["OPTION", "OPTGROUP", "OPTGROUP", "OPTGROUP"],
    "the placeholder stays outside, one group per section");
  assert.deepEqual(s.children.slice(1).map((g) => [g.attrs.label, g.className, g.children.length]), [
    ["On the shop", "tone-ok", 1],
    ["Sold out", "tone-warn", 1],
    ["Taken down", "tone-off", 1],
  ], "each section is named and carries the tone it is drawn in");
  assert.equal(s.children[1].children[0].value, "a", "and holds its own options");
});

test("select() leaves a one-section menu alone — a lone heading is noise", () => {
  const s = select([
    { value: "a", label: "Focaccia", tone: "ok", group: "On the shop" },
    { value: "b", label: "Sourdough", tone: "ok", group: "On the shop" },
  ], "a", () => {});
  assert.deepEqual(s.children.map((c) => c.tagName), ["OPTION", "OPTION"], "no heading at all");
  assert.equal(s.className, "toned tone-ok", "but the box is still tinted");
});

test("select() keeps a menu of plain options flat", () => {
  const s = select(STATUSES, "new", () => {});
  assert.deepEqual(s.children.map((c) => c.tagName), ["OPTION", "OPTION", "OPTION"]);
});

// The Scenario planner's module editor is a card taller than a phone — fifteen
// boxes, a row per cycle, a box per batch — so a repaint while she is working
// down it must not throw her back to the top. showPopup() rebuilds by emptying
// the body, and emptying it is exactly what used to reset the scroll.
test("a pop-up repaint keeps the scroll where she was reading (v141)", () => {
  let refresh = null;
  showPopup("A tall card", (r) => { refresh = r; return el("div", { class: "field" }, "a box"); });
  const layer = document.getElementById("popup-layer");
  const body = layer.children[0].children[1];
  assert.equal(body.className, "popup-body", "the pop-up body is the thing that scrolls");

  body.scrollTop = 420;
  refresh();

  assert.equal(body.children.length, 1, "the repaint really did rebuild the body");
  assert.equal(body.scrollTop, 420, "and left the card where she was reading");
});

test("opening a pop-up starts it at the top", () => {
  showPopup("Another card", () => el("div", {}, "a box"));
  const body = document.getElementById("popup-layer").children[0].children[1];
  assert.equal(body.scrollTop, 0, "a card opened fresh is not inheriting a scroll position");
});

// ── Engine v159 — a card can be pushed aside by its title bar ────────────────
//
// The card's own box, and nothing else, is the geometry the drag clamps against,
// so the shim is told the card's real size rather than handed the same box for
// everything. Its rect has to move with the transform the way a browser's does:
// that is what proves the drag reads the box ONCE at the start. A card that
// re-read its own translated rect mid-drag would count the offset twice and walk
// away from her finger, and a shim that reported the untransformed box every time
// would never show it.
function openCard(title, wide) {
  showPopup(title, () => el("div", {}, "a box"), { wide });
  const layer = document.getElementById("popup-layer");
  const card = layer.children[0];
  const head = card.children[0];
  const base = { left: 15, top: 14, width: 345, height: 300 };
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, right: 375, bottom: 812, width: 375, height: 812 });
  card.getBoundingClientRect = () => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(card.style.transform || "");
    const dx = m ? Number(m[1]) : 0;
    const dy = m ? Number(m[2]) : 0;
    return {
      left: base.left + dx, top: base.top + dy, width: base.width, height: base.height,
      right: base.left + dx + base.width, bottom: base.top + dy + base.height,
    };
  };
  return { layer, card, head, base };
}

function press(node, at, target) {
  for (const f of node._listeners.pointerdown || []) {
    f({ target: target || node, clientX: at[0], clientY: at[1], pointerId: 7, preventDefault() {} });
  }
}
function moveTo(node, at) {
  for (const f of node._listeners.pointermove || []) f({ clientX: at[0], clientY: at[1] });
}
function release(node) {
  for (const f of node._listeners.pointerup || []) f({});
}

test("a card follows the title bar she drags it by", () => {
  const { card, head } = openCard("A batch clock");
  press(head, [200, 100]);
  moveTo(head, [200, 300]);
  release(head);
  assert.equal(card.style.transform, "translate(0px, 200px)",
    "the card moves by the pointer's own delta, down the day it is covering");
});

test("a second drag of the same card does not run away from her finger", () => {
  const { card, head } = openCard("A batch clock");
  press(head, [200, 100]);
  moveTo(head, [200, 300]);
  release(head);
  // The card is now 200px down, so its own rect has moved with it. Read again
  // without subtracting that offset, the next 50px would be counted as 250.
  press(head, [400, 400]);
  moveTo(head, [400, 450]);
  release(head);
  assert.equal(card.style.transform, "translate(0px, 250px)");
});

test("a card cannot be pushed out of the layer it is drawn in", () => {
  const { card, head, base } = openCard("A batch clock");
  press(head, [200, 100]);
  moveTo(head, [600, 2000]);
  release(head);
  assert.equal(card.style.transform, "translate(9px, 492px)",
    "held inside the layer, so the drag adds the layer no scroll surface");
  // And the whole box, not just the title bar: a control parked below the fold
  // is a control she cannot press.
  const at = card.getBoundingClientRect();
  assert.ok(at.left >= 0 && at.right <= 375, "the card's whole width stays on screen");
  assert.ok(at.top >= 0 && at.bottom <= 812, "and its whole height, Save button and all");
});

test("a press on the close button does not drag the card", () => {
  const { card, head } = openCard("A batch clock");
  const x = head.children[1];
  assert.equal(x.tagName, "BUTTON", "the close button really is on the strip");
  press(head, [300, 20], x);
  moveTo(head, [340, 260]);
  release(head);
  assert.equal(card.style.transform, undefined,
    "a press on a control is a press on that control, and the ✕ keeps its own click");
});

test("the next card opens where cards have always opened", () => {
  const first = openCard("A batch clock");
  press(first.head, [200, 100]);
  moveTo(first.head, [200, 300]);
  release(first.head);
  assert.equal(first.card.style.transform, "translate(0px, 200px)", "this one really did move");

  const second = openCard("Another batch clock");
  assert.equal(second.card.style.transform, undefined,
    "nothing is remembered: a card opened later is not inheriting a position");
});

test("the handle and its grip are declared as file text (v159)", () => {
  const css = read("admin/css/app.css");
  const head = css.slice(css.indexOf(".popup-head {"), css.indexOf(".popup-head.dragging"));
  assert.match(head, /cursor:\s*grab/, "the pointer says the strip can be held");
  assert.match(head, /touch-action:\s*none/,
    "a finger on the strip drags the card rather than scrolling the layer");
  assert.match(head, /-webkit-touch-callout:\s*none/,
    "no long-press callout on iOS, which would cancel the drag in her hand");
  // A pseudo-element and not a node: a real child of this flex row would become a
  // flex item and push the title across, and a new node would move the card's own
  // children under the positional tests above.
  assert.match(css, /\.popup-head::after\s*\{[^}]*content:/s, "the grip is drawn, not added");
});
