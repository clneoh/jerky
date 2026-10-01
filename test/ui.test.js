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

// ── A map stays inside its own box, and the fixed layers keep their order (v254) ──
//
// Her words, 30 September 2026: "sometime pop up like half at back layer". Measured at
// 375px: with a live Leaflet map in the ＋ New order card's door block, the map painted
// squarely over the lower half of the confirm dialog — her question cut off mid-sentence,
// both buttons hidden, and a tap in that band landing on `a.leaflet-control-zoom-out`.
//
// Leaflet's own layers go up to 1000 (tiles 200, the marker 600, the zoom control's corner
// 1000), and it sets only `position: relative; z-index: auto` on the box it is given — which
// creates NO stacking context. So every one of those layers was competing in the ROOT
// context against this app's fixed layers, which sit between 20 and 80.
//
// This is a regression guard, not the proof: the proof is the grid measurement in
// `marketing/harness-v254.html`, which went from 16 dirty rows of 24 to 0 when this rule
// landed. What the guard is for is the day someone tidies `.place-map` and drops the pair
// as if it were decoration, and nothing else on screen would say so.
test("a map's layers cannot leave their own box, and the fixed layers keep their order (v254)", () => {
  const css = read("admin/css/app.css");
  // Comments FIRST: the rules below carry long explanatory notes that quote other rungs'
  // numbers ("at 60, under the pop-up layer's 65"), and a regex reading a rule body would
  // otherwise find those digits and pin the wrong value.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  // One class and nothing else — `.toast`, not `.toast.show`, and `.confirm-layer`, not
  // `.confirm-layer[hidden]`. The second of each pair is the same box in another state.
  const own = (cls) => blocks.filter((b) => b.sel === `.${cls}`);
  const rung = (cls) => {
    const mine = own(cls).filter((b) => /z-index/.test(b.body));
    assert.equal(mine.length, 1, `expected one rule carrying .${cls}'s z-index, found ${mine.length}`);
    const z = mine[0].body.match(/z-index:\s*(-?\d+)/);
    assert.ok(z, `.${cls} has no plain z-index, so its rung cannot be read`);
    return Number(z[1]);
  };

  // The ladder, bottom to top. Each pair is a fault that has actually happened or that the
  // numbers exist to prevent: the confirm was once at 60, under the pop-up's 65, and every
  // point of its own box belonged to the card that asked the question (23 September 2026).
  const ladder = [["topbar", 20], ["tabbar", 30], ["tl-call", 60], ["popup-layer", 65],
    ["toast", 70], ["confirm-layer", 72], ["lock-layer", 80]];
  for (let i = 0; i < ladder.length; i++) {
    const [cls, was] = ladder[i];
    assert.equal(rung(cls), was,
      `.${cls} moved off ${was}. If that was deliberate, the rungs above and below it have to be re-read too — this list is what says a question is never buried by the thing that asked it.`);
    if (i) {
      const [below, belowWas] = ladder[i - 1];
      assert.ok(rung(below) < rung(cls),
        `.${below} sits at ${rung(below)} and .${cls} at ${rung(cls)}, so the layer that must win is painted underneath`);
    }
  }

  // And the map. `position: relative` with a z-index of 0 is what makes this box a stacking
  // context; Leaflet's `z-index: auto` on its own does not, and the 1000 inside it is then
  // in the ROOT context, over every rung above. Both halves are needed — the position to
  // have something for the z-index to apply to, and a real (not `auto`) number to create
  // the context. Zero is enough and is preferred: it changes nothing inside the map.
  const map = own("place-map").filter((b) => /z-index/.test(b.body));
  assert.equal(map.length, 1, `expected one rule carrying .place-map's z-index, found ${map.length}`);
  assert.match(map[0].body, /position:\s*relative/,
    ".place-map has no position, so a z-index on it does nothing and Leaflet's panes are back in the root context");
  const mz = map[0].body.match(/z-index:\s*(-?\d+)/);
  assert.ok(mz, ".place-map has no z-index, so it creates no stacking context and a live map can paint over the confirm");
  assert.ok(Number(mz[1]) < rung("lock-layer"),
    `.place-map sits at ${mz[1]}, which is not below the app's own fixed layers — the point of trapping the map is that NOTHING inside it can reach them`);
});

// ── the pin picker's list takes no space, so nothing can be shoved (v256) ──
//
// Her words, 30 September 2026, after v255 had already tried to answer the same press:
// "it is still the same, press look up this address again make it exit the page we are
// working in, why?"
//
// v255 held the MAP still, which with the list in the flow means scrolling the pop-up
// body by the list's own height — measured at 375×812 against four candidates, the
// list appears 223 pixels tall and the body scrolls 269. That scroll carries the button
// she pressed from top 248 to top −21, above the body's own top edge of 68: the control
// under her thumb leaves the card. There is no anchor that survives a list this tall —
// holding the button still shoves the map down by the same 223. The list has to stop
// taking the space at all, which is what `.sugg-drop` is.
//
// This is a regression guard, not the proof: the proof is `marketing/harness-v256.html`,
// whose `pickerLook({rows: 4})` went from 269 / −269 / +269 (map / button / body scroll)
// to 0 / 0 / 0 when this rule and the anchor change landed.
test("the pin picker's list floats, so no control above it can be pushed off the card (v256)", () => {
  const css = read("admin/css/app.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const rule = (sel) => {
    const mine = blocks.filter((b) => b.sel === sel);
    assert.equal(mine.length, 1, `expected exactly one rule for \`${sel}\`, found ${mine.length}`);
    return mine[0].body;
  };

  // The row that holds "Look it up" is the positioning context, so `top: 100%` is the
  // few pixels under the thumb she pressed rather than under the whole field.
  assert.match(rule(".btn-row.sugg-host"), /position:\s*relative/,
    ".sugg-host is not positioned, so the floating list has no box to hang from and falls back to the pop-up itself");

  const drop = rule(".sugg-drop");
  assert.match(drop, /position:\s*absolute/,
    ".sugg-drop is not absolute, so the list is in the flow again — and in the flow it takes 223 pixels off the card and shoves everything under it down by that much");
  assert.match(drop, /top:\s*100%/,
    "the list no longer drops from the bottom of the button's row, so it is pinned somewhere it was never measured");
  // Over the map, which is the only thing it may cover: the map is where she checks the
  // pin, and it is directly under this row. Leaflet's panes are sealed inside
  // .place-map's z-index 0 (v254), so a sibling at 2 wins without a rung-by-rung fight.
  const z = drop.match(/z-index:\s*(-?\d+)/);
  assert.ok(z && Number(z[1]) > 0,
    ".sugg-drop has no z-index above the map's 0, so the map paints over the list and the rows cannot be seen, let alone tapped");
  assert.match(drop, /max-height:\s*\d+px/,
    "the list is unbounded, so a long answer could run past the pop-up body's edge and be clipped mid-row");
  assert.match(drop, /overflow-y:\s*auto/,
    "the list cannot scroll itself, so the rows past max-height are unreachable");

  // AND THE SHARED PANEL IS UNTOUCHED. `.sugg-panel` is also the customer suggester's, drawn
  // by views/orders.js inside a .form-grid — where floating would be wrong for the reason
  // place_map.js has recorded all along: that body scrolls, and a floating panel is clipped
  // at its edge. The float must live on the picker's own modifier, never on the shared class.
  const shared = blocks.filter((b) => b.sel === ".sugg-panel").map((b) => b.body).join("\n");
  assert.doesNotMatch(shared, /position:\s*(absolute|fixed)/,
    ".sugg-panel is positioned, so the customer suggester in the order forms floats too — and that one is clipped by the pop-up body it lives in");
});
