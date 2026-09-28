// test/board-view.test.js — the Production line screen as a BOARD (v176).
//
// Her words, 23 September 2026: "can we simplify the productioon portion, it ask for
// alot of key in" and then "maybe one function for production line, 1. copy the chart
// into Prodcution line, but should not be editable, it become a dashboard for worker,
// give the worker good inform of what next for them, how long, and others".
//
// Three things this file exists to hold, and each of them is a claim that would be
// silent if it broke:
//
//   1. A board does not write. Opening the Production line must put nothing into her
//      settings — not her scenario, not her plan — because the sync engine would carry
//      it to her other phone as though she had said it. This is the whole safety of
//      the screen, so it is measured over every tap the board offers, not asserted.
//
//   2. The board IS the planner's chart, not a second drawing of it. Two renderers of
//      one day drift, and this app's rule is that two screens may not disagree about
//      the same day. Where the two DO differ, the difference is deliberate and is
//      pinned here as a difference: a board's tooltip describes, the planner's invites
//      ("tap to move it"); a board has no ladder and no shelf; a board has one button.
//
//   3. The clock is the REAL clock. `placeNow` has no press behind it on a board — a
//      dashboard nobody has touched still has to say what time it is — and it parks at
//      the day's own edge rather than wrapping when the real clock is outside her day.
//
// The stand-in screen below is test/scenario-view.test.js's, copied rather than
// shared, with four additions and no subtractions:
//
//   - `isConnected`, walking up to document.body. `placeNow` asks the ruler whether it
//     is on the page before trusting its offset, and a shim that could not answer would
//     have made the real placement path unreachable from every test in this file.
//   - `offsetLeft`, so the ruler's own origin is a number a test can set rather than a
//     constant the assertion has to be written around.
//   - a frozen `Date` CLASS and not only `Date.now`. A board reads the wall clock
//     through `new Date()`, so freezing only the static left the now-line's minute to
//     the machine the suite happens to run on — an assertion that would pass or fail
//     by the time of day.
//   - a count of `replaceChildren` calls. "A tick repaints nothing" is the rule that
//     keeps a chart she is reading from being redrawn under her scroll, and the only
//     way to assert a repaint did not happen is to count them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// How many subtrees have been rebuilt through `replaceChildren` since the last reset.
// Kept here rather than on a node because a repaint can happen at any depth.
let replaceCount = 0;

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    // scrollLeft is here with scrollTop, and for the same reason the disabled and
    // data-* reflections are: the pane scroll-sync READS a scroll position back off
    // a node, so a shim without one hands the writer undefined and every assertion
    // about the two windows moving together is vacuous. The widths start at zero —
    // a node with no box, as a detached one has — and a test that wants a day wider
    // than its window says so.
    scrollTop: 0, scrollLeft: 0, scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0,
    hidden: false, _listeners: {},
    // A real node is on the page or it is not, and `placeNow` will not trust an
    // offset read off a node that is not: the chart is assembled before it is
    // attached, and a detached element answers every measurement with zero. Walked
    // up to document.body, which is what appendChild and remove keep true.
    get isConnected() {
      for (let n = this; n; n = n.parent || null) if (n === globalThis.document.body) return true;
      return false;
    },
    // A real element's position in its offset parent. Deliberately a plain property
    // a test writes, because the one thing it is here for is being a number the
    // assertion can hold `placeNow` to.
    offsetLeft: 0, offsetTop: 0,
    // A real node, asked to describe itself — which is exactly what Node does to the
    // `actual` of an assertion that fails — answers with its tag and its class and nothing
    // else: a handful of characters. A shim without this is described by the default
    // inspector, which walks it, and walking one node walks the whole document through the
    // `parent` each child keeps: a failing assertion handed a shim node has been measured
    // here at a 135,447,648-character dump and a killed run. This is not a convenience, it
    // is the same fidelity rule the rest of this stand-in is built on — the browser prints
    // no more than this either, and a failure message nobody can read is no evidence.
    //
    // The assertion library does not ask for this — it inspects the value it was handed
    // with `customInspect: false`, deliberately, so a value cannot lie about itself in a
    // failure message. What makes the message short is the property below it: a real node
    // does not offer its PARENT as one of its own fields for anybody to walk up, and this
    // one no longer does either. Keep both: this is what a person reads when the assertion
    // is printed by hand, and the un-walkable parent is what keeps the library's own
    // inspector from climbing the whole document out of one failed comparison.
    [Symbol.for("nodejs.util.inspect.custom")]() {
      const id = this.attrs && (this.attrs.id || this.attrs["data-id"]);
      return `<${this.tagName.toLowerCase()}${this.className ? ` class="${this.className}"` : ""}${id ? ` id="${id}"` : ""}>`;
    },
    // Every real node has one, and the view walks UP through it: the clock balloon is
    // placed against the box it is drawn in and the window that box is looked through,
    // and it reads both off `parentNode`.
    get parentNode() { return this.parent || null; },
    // And the other half of that walk: a test that asks whether a repaint rebuilt the
    // screen asks it through this.
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    // Faithful on purpose, and this is the one place it matters most: the real
    // `replaceChildren` does NOT skip a null the way `el()` skips a null child — it
    // converts every argument with String(), so `replaceChildren(ask, readout)` with
    // `ask` left null puts the literal word "null" on the screen. A shim that quietly
    // dropped it would hide exactly that from every test in this file.
    replaceChildren(...cs) {
      replaceCount += 1;
      this.children = [];
      for (const c of cs) {
        if (c && c.nodeType) { this.children.push(c); if (c.nodeType === 1) c.parent = this; }
        else this.children.push(globalThis.document.createTextNode(String(c)));
      }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    // A listener in a browser is handed an EVENT, not a bag of fields, and the calls
    // the chart makes on one — preventDefault, for the right-press pan and for the
    // browser's own menu — are on the event because the browser put them there.
    dispatchEvent(ev) {
      if (!ev.preventDefault) ev.preventDefault = () => { ev.defaultPrevented = true; };
      if (!ev.stopPropagation) ev.stopPropagation = () => {};
      (this._listeners[ev.type] || []).forEach((f) => f(ev));
      return true;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "hidden") this.hidden = true;
      // The style string the view hands `el`, taken apart so the two views of one
      // style — the attribute and the property — cannot disagree.
      if (k === "style") {
        for (const part of String(v).split(";")) {
          const i = part.indexOf(":");
          if (i > 0) css[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
      }
      // A real DOM reflects its boolean attributes onto the properties a view reads
      // back. A shim that kept only the attribute made a switched-off press read as
      // live — a stub more forgiving than the browser it stands in for.
      if (k === "disabled" || k === "selected" || k === "checked") this[k] = true;
      // A real DOM exposes a data-* attribute on `dataset`, and the timeline's tap
      // reads which batch it hit off `hit.dataset.k`.
      const m = /^data-(.+)$/.exec(k);
      if (m) this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    // A real getBoundingClientRect returns a DOMRect, which carries right and bottom
    // as well, and a box without them is a stub more forgiving than the browser it
    // stands in for. A rect is measured from the window, so scrolling a box the node
    // is INSIDE moves the node's box and the node itself does not.
    getBoundingClientRect() {
      const r = this._rect || { left: 0, top: 0, width: 600, height: 400 };
      let left = r.left;
      let top = r.top;
      for (let n = this.parent || null; n; n = n.parent || null) {
        left -= Number(n.scrollLeft) || 0;
        top -= Number(n.scrollTop) || 0;
      }
      return { left, top, width: r.width, height: r.height, right: left + r.width, bottom: top + r.height };
    },
    focus() {}, click() {},
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
    querySelector() { return null; },
    // A real node can be asked for the nearest ancestor of a kind, and the view asks
    // exactly that to tell a press on a bar from a press on the row it sits in. A shim
    // with no `closest` answers `undefined` to a question the browser answers.
    //
    // And it takes a SELECTOR, of which the ordinary spelling here is a compound one:
    // `.tl-row.train` asks for the element carrying BOTH classes, because the board's
    // two people-shaped windows both draw `.tl-row` and only one of them is the train.
    // A stand-in that compared the whole string against one class name answered that
    // question with nothing — so on a board the drag was wired to a row no gesture could
    // begin on, and "when we drag to the right, the train move to right" could not be
    // tested at all. A stub LESS capable than the browser hides a rule as surely as one
    // that is more forgiving.
    closest(sel) {
      const tests = String(sel || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => ({
        tag: (/^[A-Za-z][\w-]*/.exec(s) || [""])[0].toUpperCase(),
        cls: (s.match(/\.[\w-]+/g) || []).map((c) => c.slice(1)),
      }));
      for (let n = this; n; n = n.parent || null) {
        if (n.nodeType !== 1) continue;
        const own = String(n.className || "").split(/\s+/).filter(Boolean);
        for (const t of tests) {
          if (t.tag && n.tagName !== t.tag) continue;
          if (t.cls.every((c) => own.includes(c))) return n;
        }
      }
      return null;
    },
  };
  // A real element's `style` and its style ATTRIBUTE are one thing seen twice: writing
  // `node.style.left` changes what `getAttribute("style")` answers, and setting the
  // attribute changes what `node.style.left` reads. The stub that keeps a plain object
  // beside the attribute makes one of the two invisible, and this screen is placed
  // entirely through `style.left` — the now-line, both of them, and its own label. A
  // shim with the two adrift would have said the line was never placed at all.
  const css = {};
  function syncStyle() {
    node.attrs.style = Object.keys(css).map((k) => `${k}:${css[k]}`).join("; ");
  }
  // A real CSSStyleDeclaration is not a bag of keys, and a CUSTOM property is the one
  // place where that matters: `style.setProperty("--coach-w", "36px")` sets it, while
  // `style["--coach-w"] = "36px"` sets nothing at all — a browser makes an expando on
  // the style object and leaves the declarations alone, which is exactly what the stub
  // used to accept. It hid a real fault: the board asked for its coach widths through
  // the wrong door, every `--coach-w` fell through to the stylesheet's 34px fallback,
  // and six coaches filled a line the plan says four fill, at 34px against the 36px
  // floor her own rule about a tap target asks for. So both doors are here as a browser
  // has them, and a value asked for through the wrong one reads back empty.
  const loose = {};
  const isCustom = (k) => typeof k === "string" && k.startsWith("--");
  const methods = {
    getPropertyValue(k) { return k in css ? css[k] : ""; },
    setProperty(k, v) { css[k] = String(v); syncStyle(); },
    removeProperty(k) { delete css[k]; syncStyle(); },
  };
  node.style = new Proxy(methods, {
    get(t, k) { return k in t ? t[k] : (k in css ? css[k] : loose[k]); },
    set(t, k, v) {
      if (isCustom(k)) { loose[k] = String(v); return true; }
      css[k] = String(v); syncStyle(); return true;
    },
    has(t, k) { return k in t || k in css || k in loose; },
  });
  // A real DOM's textContent REPLACES the children when it is written, and a shim
  // where it merely adds a string beside them lets a node read as saying two things at
  // once: the fold caret came back as "▾ ▸" — the new mark and the old one together —
  // so a card that had opened looked like one that had not. Read off the children, as
  // a browser does, and never kept as a second copy of them.
  let own = "";
  Object.defineProperty(node, "textContent", {
    get() {
      let s = own;
      for (const c of node.children) s += c.nodeType === 3 ? c.text : (c.textContent || "");
      return s;
    },
    set(v) { own = v == null ? "" : String(v); node.children = []; },
    configurable: true,
  });
  // The class attribute, which classList writes through to.
  const list = () => String(node.className || "").split(/\s+/).filter(Boolean);
  const put = (names) => { node.className = names.join(" "); };
  node.classList = {
    add(...names) { put([...new Set([...list(), ...names.filter(Boolean)])]); },
    remove(...names) { put(list().filter((c) => !names.includes(c))); },
    contains(c) { return list().includes(c); },
    toggle(c, force) {
      const on = force === undefined ? !list().includes(c) : Boolean(force);
      if (on) node.classList.add(c); else node.classList.remove(c);
      return on;
    },
  };
  // A real node does not offer its PARENT or its CHILDREN as fields of its own for anybody
  // to walk. This one did, and that made a single node unprintable: the assertion library
  // inspects the value it was handed with `customInspect: false` — deliberately, so a value
  // cannot lie about itself in a failure message — and a walk that starts at one node and
  // follows `parent` up into the document, or `children` down into it, was measured here at
  // a 135,447,648-character dump and a killed run: a test reporting nothing at all, which
  // is worse than one that fails. Held in WeakMaps behind non-enumerable accessors instead,
  // so a node prints as its own fields and stops — 132 characters measured for the same
  // 200-deep chain — which is what a real element prints too.
  //
  // It answers exactly what it answered before. `n.parent`, `n.parentNode` and `n.children`
  // are read and written all over this file and the view, through these same accessors.
  const PARENT = new WeakMap();
  const KIDS = new WeakMap();
  Object.defineProperty(node, "parent", {
    get() { return PARENT.get(node) || null; },
    set(v) { PARENT.set(node, v); },
    enumerable: false, configurable: true,
  });
  Object.defineProperty(node, "children", {
    get() {
      if (!KIDS.has(node)) KIDS.set(node, []);
      return KIDS.get(node);
    },
    set(v) { KIDS.set(node, v); },
    enumerable: false, configurable: true,
  });
  return node;
}
const layers = { "confirm-layer": createEl("div"), "popup-layer": createEl("div") };
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => layers[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  // A real document keeps its listeners, and this one has to as well. The board's
  // clause 10 — "when i click outside the person window, the clock back to center" — is
  // a press that no handler INSIDE the window can ever see, so it is listened for on the
  // document in the capture phase. The two no-ops that stood here swallowed it: the rule
  // could not be reached from a test at all, and a rule no test can reach is a rule that
  // ships unproven.
  _listeners: {},
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
  removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
  dispatchEvent(ev) {
    if (!ev.preventDefault) ev.preventDefault = () => { ev.defaultPrevented = true; };
    if (!ev.stopPropagation) ev.stopPropagation = () => {};
    (this._listeners[ev.type] || []).forEach((f) => f(ev));
    return true;
  },
  body: createEl("body"),
};
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
globalThis.window = { innerWidth: 1000, innerHeight: 800 };
const frames = [];
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
const flushFrames = () => {
  for (let i = 0; i < 20 && frames.length; i += 1) {
    for (const fn of frames.splice(0, frames.length)) fn();
  }
};
// The board's beat, and the planner's, are a real interval in a browser — they go on
// firing until they are stopped — so they are a live set here and not a queue that
// empties itself. A queue would have let the second minute of a test be driven by a
// callback the first minute had already eaten, and the rule that matters most about
// this clock is what the SECOND beat does.
const beats = new Set();
globalThis.setInterval = (fn) => { beats.add(fn); return fn; };
globalThis.clearInterval = (h) => { beats.delete(h); };
const flushTicks = () => { for (const fn of [...beats]) fn(); };

// The wall clock, frozen WHOLE — the class and not only the static. `boardNow` reads
// the clock through `new Date()`, so patching `Date.now` alone would have left the
// now-line's minute decided by the machine the suite runs on.
const REAL_DATE = Date;
let NOW = REAL_DATE.parse("2026-09-22T09:00:00");
class FrozenDate extends REAL_DATE {
  constructor(...args) { if (!args.length) super(NOW); else super(...args); }
  static now() { return NOW; }
}
globalThis.Date = FrozenDate;
const setNow = (iso) => { NOW = typeof iso === "number" ? iso : REAL_DATE.parse(iso); };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { renderScenario, renderBoard, trainScale, coachGeom, lineWidth, trainPlacement, panRange, minsWords } =
  await import("../admin/js/views/scenario.js");
const { renderProduction } = await import("../admin/js/views/production.js");
const { ONE_BAKER_SCENARIO, computeScenario, scenarioPlanPatch, jobKey, PX_PER_MIN_CHOICES } =
  await import("../admin/js/scenario.js");
const { computeLine, planOf } = await import("../admin/js/production.js");
const { defaultState } = await import("../admin/js/state.js");

// Every element under `root`, depth-first, in document order.
function walk(root, out = []) {
  for (const c of root.children || []) {
    if (c.nodeType !== 1) continue;
    out.push(c);
    walk(c, out);
  }
  return out;
}
// The shim's `textContent` is the real DOM's: every character under the node, in
// order, whether it arrived from `el`'s children or from a later write.
function textOf(n) {
  return String(n.textContent || "").replace(/\s+/g, " ").trim();
}
const hasClass = (n, cls) => new RegExp(`(^|\\s)${cls}(\\s|$)`).test(n.className || "");
// A px value out of the inline style string the view writes.
function px(node, key) {
  const m = new RegExp(`${key}:(-?\\d+(?:\\.\\d+)?)px`).exec(node.attrs.style || "");
  return m ? Number(m[1]) : null;
}
const labelOf = (n) => {
  const m = /(^|\s)btn(\s|$)/.test(n.className || "") ? n : null;
  return m ? textOf(n).trim() : null;
};

// The word a `replaceChildren` writes when it is handed a null, read off the NODES
// rather than the flattened text: the word arrives with its neighbour's text welded
// straight onto it ("nullNext up"), so a word-boundary test cannot see it. Used by
// both the first paint and the strip's rebuild, because both hand a child list
// straight to `replaceChildren` with no `el()` in between to skip a null.
const BLANK_WORD = /^(null|undefined|false|NaN|\[object Object\])$/;
function strayWord(n) {
  for (const c of n.children || []) {
    if (c.nodeType === 3 && BLANK_WORD.test(String(c.text).trim())) return String(c.text).trim();
    const deeper = strayWord(c);
    if (deeper) return deeper;
  }
  return null;
}

// What a SCREEN shows, as against what the document holds. `textOf` reads `textContent`,
// and `textContent` — the shim's and the real browser's alike — walks straight through a
// `hidden` subtree, so every claim in this file about a shut card saying nothing was
// being made against text the browser never paints. This reader stops at a hidden node
// the way the screen does. It is the same lesson this file already carries about a
// stand-in that is more forgiving than the real thing: a fold test that cannot tell
// folded from unfolded is not a fold test.
function shownText(n) {
  if (n.hidden) return "";
  let out = "";
  for (const c of n.children || []) {
    out += c.nodeType === 3 ? String(c.text) : shownText(c);
  }
  return out.replace(/\s+/g, " ").trim();
}

// The scenario the board is drawn against: her own day, exactly as the planner's
// tests use it. `plan` is what the two folded cards read and write, and it is seeded
// from the app's OWN default rather than from numbers invented here — the fields show
// what a brand-new phone shows, so a test about a box being empty is about the app
// and not about this file.
function makeState(overrides = {}, plan = {}) {
  const scen = {
    ...ONE_BAKER_SCENARIO,
    modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, cycles: (m.cycles || []).map((c) => ({ ...c })) })),
    ...overrides,
  };
  return {
    settings: {
      currency: "RM", deliveryDays: [1, 3, 5],
      scenario: scen, scenarios: [],
      production: { ...defaultState().settings.production, ...plan },
    },
    uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
  };
}

// A rendered board, attached to the stand-in page — attached, because the real
// placement path asks whether the ruler is on the page before it trusts its offset.
// Every live beat is stopped first, so whatever a render schedules is exactly what is
// running: without that, a test about the clock would be driving another test's timer.
function render(which, state) {
  beats.clear();
  // The screen that was here is taken down before the next one is built, which is what
  // the app itself does when she opens another page — and on a board it is the only
  // thing that puts the document's own listener away. A stand-in page that kept every
  // board's listener would have let a press fire into a screen that is gone, and the
  // teardown could not be tested at all.
  if (screen && screen.teardown) screen.teardown();
  document._listeners = {};
  document.body.replaceChildren();
  const root = createEl("div");
  const teardown = which(root, state);
  document.body.append(root);
  layers["popup-layer"].replaceChildren();
  screen = { root, state, teardown: typeof teardown === "function" ? teardown : null };
  return screen;
}
// The screen currently on the stand-in page, so the next one can take it down.
let screen = null;
const board = (state = makeState()) => render(renderBoard, state);
const line = (state = makeState()) => render(renderProduction, state);

// What the Next-up strip says, and nothing else. Read from the strip's own card rather
// than from the whole board, because every module's name is written on the day chart
// below it too — so a test about what the strip names would otherwise be answered by
// the chart.
const stripText = (root) => {
  const card = walk(root).find((n) => hasClass(n, "bd-top"));
  return card ? textOf(card) : "";
};

const bars = (root) => walk(root).filter((n) => hasClass(n, "tl-bar"));
const nowLines = (root) => walk(root).filter((n) => hasClass(n, "tl-now"));
// A tap on a bar, as the chart really receives it: the click lands on the track and
// bubbles up from the bar, which is why the event carries its own target.
function tapBar(bar) {
  const track = bar.closest(".tl-track");
  assert.ok(track, "the bar is inside a track");
  const ev = { type: "click", button: 0, target: bar, stopPropagation() {}, preventDefault() {} };
  for (const f of track._listeners.click || []) f(ev);
}
// The input of the field labelled `label`, and a keystroke in it.
function fieldInput(root, label) {
  const f = walk(root).find((n) => hasClass(n, "field") && textOf(n).includes(label));
  assert.ok(f, `no field labelled ${label}`);
  const input = f.children.find((c) => c.nodeType === 1 && c.tagName === "INPUT");
  assert.ok(input, `the field ${label} has no input`);
  return input;
}
function type(input, value) {
  input.value = String(value);
  for (const f of input._listeners.input || []) f();
}

// ── 1. A board does not write ──────────────────────────────────────────────

test("opening the board writes nothing into her settings", () => {
  const state = makeState();
  state.settings.scenario.startDelta = undefined;
  const before = JSON.stringify(state.settings);
  const { root } = board(state);
  assert.ok(bars(root).length > 0, "the board drew a day");
  assert.equal(JSON.stringify(state.settings), before, "a render wrote to her settings");
});

test("and it does so with no day of her own — no scenario is seeded", () => {
  // The trap this closes: `ensureScenario` would seed a whole default scenario into
  // `settings.scenario` merely by the screen being opened, and the sync engine would
  // carry it to her other phone as though she had built it.
  const state = makeState();
  delete state.settings.scenario;
  board(state);
  assert.equal("scenario" in state.settings, false, "a board seeded a scenario into her settings");
});

test("and no tap the board offers on the day itself writes either — every bar, every tag, every module row (v184)", () => {
  // The modules' window, and deliberately only it. What the workers' window offers is a
  // coach, and a coach is the ONE tap on this screen that writes on purpose — her words,
  // 24 September: "Person should click on their work to turn it green" — and it is
  // covered by its own two tests below. Everything in the window above it is still
  // read-only, and this is the proof: not one bar, not one tag, not one module row
  // writes a byte of her settings.
  const state = makeState();
  const { root } = board(state);
  const before = JSON.stringify(state.settings);
  const proc = walk(root).find((n) => hasClass(n, "tl-pane-proc"));
  assert.ok(proc, "the board draws no modules' window, so this test would be tapping nothing");
  const targets = walk(proc).filter((n) => hasClass(n, "tl-bar") || hasClass(n, "tl-btag") || hasClass(n, "tl-row"));
  assert.ok(targets.length > 8, "there is a screen to tap");
  for (const n of targets) {
    const track = n.closest(".tl-track");
    const row = n.closest(".tl-row");
    const ev = { type: "click", button: 0, target: n, stopPropagation() {}, preventDefault() {} };
    // The chart's taps are wired to the TRACK and to the ROW, not to the bar itself,
    // so a faithful tap walks the same path a bubbling click would.
    for (const f of (track && track._listeners.click) || []) f(ev);
    for (const f of (row && row._listeners.click) || []) f(ev);
  }
  assert.equal(JSON.stringify(state.settings), before, "a tap on the board wrote to her settings");
});

test("her own scenario comes back byte-identical after a full pass of taps", () => {
  const state = makeState();
  const before = JSON.stringify(state.settings.scenario);
  const { root } = board(state);
  for (const n of bars(root)) tapBar(n);
  assert.equal(JSON.stringify(state.settings.scenario), before, "the board rewrote her day");
});

// ── 2. A board is the planner's chart, with the differences pinned ─────────

test("the board draws the day chart and the next-up strip, under the day's own name (v186)", () => {
  const { root } = board();
  const all = walk(root);
  assert.ok(all.some((n) => hasClass(n, "tl-row")), "no chart");
  assert.ok(all.some((n) => hasClass(n, "tl-pane-proc")), "no modules window");
  assert.ok(all.some((n) => hasClass(n, "bd-top")), "no next-up strip");
  // Her clause 1 — "Keep the Next Up" — as words on the screen, not merely as a card
  // that happens to be drawn: the plan's three jobs are here and they are NAMED.
  const head = all.find((n) => hasClass(n, "bd-head"));
  assert.ok(head, "the next-up strip has lost its title");
  assert.equal(textOf(head), "Next up", `the strip is titled "${textOf(head)}"`);
  // Her clause 7 — "Name of the scenario should be on Top of page" — and the name is the
  // SCENARIO's own, not a label true of every day on earth. Read off the heading node:
  // the words also appear in the person card's own text, so a flat search proves nothing.
  const title = all.find((n) => hasClass(n, "bd-title"));
  assert.ok(title, "the day has no name at the top of the page");
  const sc = makeState().settings.scenario;
  assert.equal(textOf(title), String(sc.name || "").trim(), "the top of the page names something other than her day");
  assert.match(textOf(root), /Next up/);
});

test("and not one word of nothing is written onto it", () => {
  // Found live on the real screen rather than reasoned about: the board withholds the
  // planner's ask strip, and it was withheld by handing `replaceChildren` a null. A real
  // `replaceChildren` does not skip a null — it converts every argument with String() —
  // so the first thing above the day read "null". Nothing in this file could see it,
  // because the stand-in screen quietly dropped nulls, which is the very fault the shim's
  // own notes warn about: a stub more forgiving than the browser it stands in.
  //
  // Read off the NODES and not the flattened text: the word arrives with the strip's own
  // text welded straight onto it ("nullNext up"), so a word-boundary test cannot see it —
  // it would have been the very check that missed the fault on the real screen too.
  for (const [what, which] of [["board", board], ["line", line]]) {
    const wrote = strayWord(which().root);
    assert.equal(wrote, null, `the ${what} writes the word "${wrote}" onto the screen`);
  }
});

test("and it draws none of the cards that change the day", () => {
  const { root } = board();
  const text = textOf(root);
  assert.doesNotMatch(text, /Your scenarios/, "the shelf of saved days is on a board");
  assert.doesNotMatch(text, /What it makes/, "the answer card is on a board");
  assert.doesNotMatch(text, /The climb|The way down/, "the ladder is on a board");
  assert.doesNotMatch(text, /Not in this scenario/, "the unmapped card is on a board");
  // "Start the day now" WAS in this list and is not any more: v186's clause 5 puts the
  // three walk controls on the board on purpose — "Button 'START THE DAY NOW', 'STOP',
  // 'The N Called'". What the board still refuses is the PLANNER's day-changing cards,
  // and the four above are those. So the last line is not a blank check but its own
  // claim: the shelf's own press, which would load another day under a running shift,
  // is still nowhere on this screen.
  assert.doesNotMatch(text, /Open this day|Load this day/, "the shelf's own press is on a board");
});

test("it has exactly two controls, and the Clear press is quiet until there is something to clear (v184)", () => {
  // One is the offer to make sound; the other, new at v184, is the one press that takes
  // every tick off the board. It is drawn at every width of the day rather than coming
  // and going — a control that appears only sometimes reads as a fault — so on a board
  // nobody has touched it is here and DISABLED, which is what stops a press that would
  // do nothing from looking like a press that failed.
  const { root } = board();
  const buttons = walk(root).filter((n) => n.tagName === "BUTTON" && hasClass(n, "btn"));
  const said = buttons.map((b) => textOf(b).trim());
  assert.deepEqual(said, ["Start calling", "Clear the board"], `a board's buttons are ${JSON.stringify(said)}`);
  const clear = buttons.find((b) => /Clear the board/.test(textOf(b)));
  assert.equal(clear.disabled, true, "the Clear press is live on a board where nothing has been marked as taken");
  assert.match(textOf(root), /Nothing is marked as taken, so there is nothing to clear yet\./,
    "the board does not say why its Clear press is quiet");
});

test("a bar's tip describes the batch on a board and invites a move in the planner", () => {
  const b = board();
  const tags = walk(b.root).filter((n) => hasClass(n, "tl-btag"));
  assert.ok(tags.length, "no batch numbers on the chart");
  for (const t of tags) {
    assert.ok(t.attrs.title, "a batch number with no tip");
    assert.doesNotMatch(t.attrs.title, /tap to move it/,
      `a board's tip advertises a move it will refuse: ${t.attrs.title}`);
  }
  // The twin, so the guard cannot be satisfied by the string having been deleted
  // everywhere: the planner's own chart still says it.
  const p = render(renderScenario, makeState());
  const pTags = walk(p.root).filter((n) => hasClass(n, "tl-btag"));
  assert.ok(pTags.some((t) => /tap to move it/.test(t.attrs.title || "")),
    "the planner's tip no longer invites the move, so the board's silence proves nothing");
});

test("a tap on a bar opens a card naming the batch, and moves nothing", () => {
  const state = makeState();
  const { root } = board(state);
  const before = JSON.stringify(state.settings.scenario);
  const bar = bars(root)[0];
  tapBar(bar);
  const body = walk(layers["popup-layer"]).find((n) => hasClass(n, "bd-card"));
  assert.ok(body, "the tap opened no read-only card");
  const title = textOf(walk(layers["popup-layer"]).find((n) => hasClass(n, "popup-title")) || createEl("div"));
  assert.match(title, /batch 1 of/, `the card does not name the batch: ${title}`);
  assert.match(textOf(body), /When/, "the card does not say when");
  assert.equal(JSON.stringify(state.settings.scenario), before, "opening a card moved the day");
});

test("a row's card is a read-only card and not the module editor", () => {
  const { root } = board();
  const row = walk(root).find((n) => hasClass(n, "tl-row") && n._listeners.click);
  assert.ok(row, "no module row on the board");
  for (const f of row._listeners.click) f({ type: "click", button: 0, target: row, stopPropagation() {}, preventDefault() {} });
  const inner = walk(layers["popup-layer"]);
  assert.ok(inner.some((n) => hasClass(n, "bd-card")), "the row opened no read-only card");
  // No input of any kind: a read-only card can never acquire a control.
  assert.equal(walk(layers["popup-layer"]).filter((n) => n.tagName === "INPUT" || n.tagName === "SELECT").length, 0,
    "a board's card carries a control");
});

// ── 3. The clock ───────────────────────────────────────────────────────────

// The day the fixture plans: a 4 am start, and 570 minutes of it (endMin).
const DAY_START = ONE_BAKER_SCENARIO.dayStartMin;         // 240
const PX_PER_MIN = computeScenario(ONE_BAKER_SCENARIO).pxPerMin;
const END_MIN = computeScenario(ONE_BAKER_SCENARIO).endMin;
const RULER_LEFT = 156;
// Every track at one origin, because the view takes its origin from the clock row's
// own track and a test cannot reach into that closure to name it.
const setRulerLeft = (root, left) => {
  for (const t of walk(root).filter((n) => hasClass(n, "tl-track"))) t.offsetLeft = left;
};
const placeTheLine = (root) => { setRulerLeft(root, RULER_LEFT); flushTicks(); return nowLines(root); };

test("the now-line stands where the real clock falls in her day", () => {
  setNow("2026-09-22T09:00:00");                 // 540 real, an hour inside a 4 am day
  const { root } = board();
  const lines = placeTheLine(root);
  assert.ok(lines.length >= 2, "the line is not drawn in both windows");
  const want = Math.round(RULER_LEFT + (540 - DAY_START) * PX_PER_MIN);
  for (const l of lines) {
    assert.equal(px(l, "left"), want, "the line is not where the clock is");
    assert.equal(textOf(l.children[0]), "9:00 am", "the line names the wrong minute");
  }
  // Drawn is not the same as shown. The line is hidden unless a walk-through is
  // running, and a board never runs one — so without its own reason to be shown the
  // whole clock would be drawn inside a hidden element and a worker would see none.
  // It is shown in the MODULES window, which is a strip of time and the one place on
  // the board where a minute is a position at all.
  assert.equal(lines[0].hidden, false, "the line is drawn but hidden, so the board shows no clock");
  // And not in the people's window, which since v184 is a strip of WORK: a coach does
  // not sit under the minute it happens at, so a minute line down that window would be
  // pointing at a place that does not mean what it says. What carries the clock there
  // is the CENTRE line, which is the one thing on that axis that has a position — see
  // "the train's clock is one line at the centre of the people's window".
  assert.equal(lines[1].hidden, true, "the board drew a minute line down a window that has no minute axis");
});

test("and the planner's own line is still hidden until she starts the day", () => {
  // The twin of the rule above, and the reason the board needed a flag of its own
  // rather than the line simply never being hidden: the planner draws the same
  // element on a screen that has not started walking anything, and it must stay out
  // of sight there until she presses Start.
  setNow("2026-09-22T09:00:00");
  const { root } = render(renderScenario, makeState());
  setRulerLeft(root, RULER_LEFT);
  flushTicks();
  const lines = nowLines(root);
  assert.ok(lines.length >= 2, "the planner draws no now-line at all");
  for (const l of lines) {
    assert.equal(l.hidden, true, "the planner is showing a clock for a day it is not walking");
  }
});

test("and it is parked at the left edge, saying so, before her day has begun", () => {
  // An 11 pm day, so at 9 am the real clock is nearly a whole day EARLY rather than
  // late — the case a wrap would have quietly turned into the middle of the day.
  setNow("2026-09-22T09:00:00");
  const { root } = board(makeState({ dayStartMin: 1380 }));
  const lines = placeTheLine(root);
  for (const l of lines) {
    assert.equal(px(l, "left"), RULER_LEFT, "the line is not parked at the day's left edge");
    assert.equal(textOf(l.children[0]), "day starts 11:00 pm", "the line does not say why it is parked");
  }
  // And the strip says the same thing in a sentence, from the same minute.
  assert.match(textOf(root), /day starts 11:00 pm|your day starts 11:00 pm/,
    "nothing on the board explains why the line is at the edge");
});

test("and at the right edge, saying so, after her day has ended", () => {
  setNow("2026-09-22T16:00:00");                 // 960 real, well past a day that ends at 1:30 pm
  const { root } = board();
  const lines = placeTheLine(root);
  const want = Math.round(RULER_LEFT + END_MIN * PX_PER_MIN);
  for (const l of lines) {
    assert.equal(px(l, "left"), want, "the line is not parked at the day's right edge");
    assert.equal(textOf(l.children[0]), "day ended 1:30 pm", "the line does not say why it is parked");
  }
});

test("a day the clock has passed is not a day with nobody on it", () => {
  // The strip's list is built from what is still AHEAD, so past the day's end it comes
  // out empty for the opposite of the reason its fallback sentence gives: the day is
  // full of hands, they have simply all been and gone. Read together with the foot,
  // which counts the day's rows, the old wording said both at once.
  setNow("2026-09-22T16:00:00");                 // 960 real, past a day that ends at 1:30 pm
  const { root } = board();
  placeTheLine(root);
  const text = textOf(root);
  assert.match(text, /The day is finished/, "nothing on the board says the day has been and gone");
  assert.doesNotMatch(text, /Nothing on this day needs hands/,
    "the board says a day it has already run has no hands on it");
});

test("and a board with no hands on it at all still says exactly that", () => {
  // The twin, and the reason the sentence above was not simply replaced: a day whose
  // hand-work has been taken off it is a real state, and it reads correctly. Built by
  // emptying every cycle's load and unload rather than by switching modules off, because
  // a module switched off is still drawn and still holds its minutes — only the cycles'
  // own touches are what the day's calls are made of.
  setNow("2026-09-22T09:00:00");
  const bare = {
    ...ONE_BAKER_SCENARIO,
    modules: ONE_BAKER_SCENARIO.modules.map((m) => ({
      ...m, cycles: (m.cycles || []).map((c) => ({ ...c, load: 0, unload: 0 })),
    })),
  };
  const { root } = board(makeState({ modules: bare.modules }));
  placeTheLine(root);
  const text = stripText(root);
  assert.doesNotMatch(text, /The day is finished/, "a day still running is called finished");
  assert.match(text, /Nothing on this day needs hands/, "a day with no hands left on it no longer says so");
});

test("and the offer to make a sound goes with the day, because it would ring for nobody", () => {
  // Not a matter of taste: `boardCallsStart` seeds `lastMin` from the minute the board
  // is standing on, and the board is standing on the day's last minute — so the button
  // would make its audio context and then call no one, all evening. The sentence the
  // strip carries is the whole of the explanation.
  //
  // What changed at v184 is the row it stood in. It used to be withdrawn with the button,
  // because an emptied row left standing read as a fault. The Clear press now lives in
  // that row and must stay there — a finished day can still be carrying ticks nothing
  // will ever answer — so the row stays and the offering BUTTON is what goes. The claim
  // is therefore narrowed rather than dropped: no offer to start calling, and no word
  // promising a sound either way.
  setNow("2026-09-22T16:00:00");
  const { root } = board();
  placeTheLine(root);
  assert.equal(walk(root).filter((n) => n.tagName === "BUTTON" && /Start calling/.test(textOf(n))).length, 0,
    "the board still offers to start calling a day that is over");
  const foot = walk(root).filter((n) => hasClass(n, "bd-foot"));
  assert.equal(foot.length, 1, "the row that carries the Clear press has gone with the day");
  assert.equal(walk(root).filter((n) => n.tagName === "BUTTON" && /Clear the board/.test(textOf(n))).length, 1,
    "a finished day can still be carrying ticks, and the Clear press went with the offer to call");
  assert.doesNotMatch(textOf(root), /would be called|Calling \d/,
    "the board still says people would be called on a day that has finished");
  assert.match(textOf(root), /The day is finished/, "nothing tells a worker why the offer has gone");
});

test("but calls she turned on earlier can always still be turned off", () => {
  // The one thing the withdrawal above must not take with it. Calls are switched on
  // inside the day, and the clock then passes the end — which is exactly an evening on
  // the board, and a phone that cannot be silenced is worse than one that cannot ring.
  setNow("2026-09-22T09:10:00");
  globalThis.window.AudioContext = class { constructor() {} close() {} };
  const { root } = board();
  placeTheLine(root);
  const start = walk(root).find((n) => n.tagName === "BUTTON" && /Start calling/.test(textOf(n)));
  for (const f of start._listeners.click || []) f({ type: "click", target: start });

  setNow("2026-09-22T16:00:00");
  flushTicks();
  const stop = walk(root).find((n) => n.tagName === "BUTTON" && /Stop calling/.test(textOf(n)));
  assert.ok(stop, "a board whose calls are on past the day's end cannot be silenced");
  assert.match(textOf(root), /Calling is on, but this day is finished/,
    "the board does not say calls are on over a day that is over");
  for (const f of stop._listeners.click || []) f({ type: "click", target: stop });
  assert.equal(walk(root).filter((n) => n.tagName === "BUTTON" && /calling/i.test(textOf(n))).length, 0,
    "pressing Stop calling left the offer up");
});

test("the strip says what is next AGAIN once the clock has passed a job", () => {
  // The whole promise of the screen, and the reason the strip is the one box on a board
  // that is not the plan: a strip drawn once when the board was opened would go on
  // naming a job that finished hours ago, and a worker reading it would be sent to the
  // bench for something already done. At 9:00 the day's next three are the packing
  // (8:57), a rest (9:12) and the oiling (9:18); ten minutes later the packing has been
  // and gone.
  setNow("2026-09-22T09:00:00");
  const { root } = board();
  placeTheLine(root);
  assert.match(stripText(root), /Cutting and packing/, "the strip does not name the job that is next");
  assert.doesNotMatch(stripText(root), /The oven swap and the bake/, "a job two ahead is named as next");

  setNow("2026-09-22T09:10:00");                 // past the packing's own end at 9:09
  flushTicks();
  const text = stripText(root);
  assert.doesNotMatch(text, /Cutting and packing/, "the strip still names a job the clock has passed");
  assert.match(text, /The oven swap and the bake/, "the strip does not name what came next");

  // And it is said again only then. The beat runs every second, so a strip that rebuilt
  // on every beat would put a fresh card under a worker's eyes sixty times a minute.
  const before = replaceCount;
  setNow("2026-09-22T09:10:30");
  flushTicks();
  assert.equal(replaceCount, before, "the strip was rebuilt with nothing different to say");

  // The rebuild hands its children straight to `replaceChildren`, so it is the same
  // road to the word "null" the first paint took — walked here rather than assumed.
  assert.equal(strayWord(root), null, "the rebuild wrote a word of nothing onto the board");
});

test("and the parked sentence keeps the wall clock honest, because it names the hour", () => {
  // The one thing on a board that is a reading of the real clock rather than of the
  // plan, and the reason the live minute rides on the strip's key while the line is
  // parked. Left out, the sentence would still be saying "It is 4:00 pm now" at
  // midnight — the only kind of clock on this screen that could be wrong.
  setNow("2026-09-22T16:00:00");
  const { root } = board();
  placeTheLine(root);
  assert.match(stripText(root), /It is 4:00 pm now/, "the parked sentence does not name the hour");

  setNow("2026-09-22T17:00:00");
  flushTicks();
  assert.match(stripText(root), /It is 5:00 pm now/, "the parked sentence's clock has stopped");
  // And the parked half of the rebuild is the half that CAN hand a null over: that
  // sentence is the one child the strip sometimes has and sometimes has not.
  assert.equal(strayWord(root), null, "the parked rebuild wrote a word of nothing onto the board");
});

test("a minute of the clock repaints nothing", () => {
  setNow("2026-09-22T09:00:00");
  const { root } = board();
  placeTheLine(root);
  const before = replaceCount;
  setNow("2026-09-22T09:01:00");
  flushTicks();
  assert.equal(replaceCount, before, "the minute's beat redrew the screen under her scroll");
  // The line still moved, which is the half that makes the count mean something.
  const lines = nowLines(root);
  assert.equal(px(lines[0], "left"), Math.round(RULER_LEFT + (541 - DAY_START) * PX_PER_MIN));
});

// ── 4. Calls ───────────────────────────────────────────────────────────────

test("nothing is announced until a real finger has turned calls on", () => {
  setNow("2026-09-22T09:10:00");                 // minute 310 of her day
  const { root } = board();
  placeTheLine(root);
  setNow("2026-09-22T09:11:00");                 // a call is due at 311
  flushTicks();
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-call")).length, 0,
    "a board announced a call with calls switched off");
  assert.match(textOf(root), /would be called/, "the board does not offer the count");
});

test("pressing Start calling makes the sound and cannot fire a backlog", () => {
  setNow("2026-09-22T09:10:00");
  const made = [];
  globalThis.window.AudioContext = class { constructor() { made.push(1); } close() {} };
  const { root } = board();
  placeTheLine(root);
  const start = walk(root).find((n) => n.tagName === "BUTTON" && /Start calling/.test(textOf(n)));
  assert.ok(start, "no Start calling button");
  for (const f of start._listeners.click || []) f({ type: "click", target: start });
  assert.equal(made.length, 1, "pressing Start calling made no audio context, so a phone stays silent");
  assert.match(textOf(root), /Calling 1 person/, "the board does not say calls are on");

  // Whatever was due in the minute she pressed is already answered for: the whole
  // morning's 20-odd calls must not arrive at once.
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-call")).length, 0, "pressing started a backlog");

  // One minute on, exactly one call — the one due at minute 311 and no other.
  const after = nowLines(root);
  setNow("2026-09-22T09:11:00");
  flushTicks();
  const cards = walk(root).filter((n) => hasClass(n, "tl-call"));
  assert.equal(cards.length, 1, `${cards.length} calls were announced for one minute`);
  // A call sounds a minute BEFORE the job (callWindows' `at = from - 1`), and the card
  // names the clock the JOB starts at: the call due at minute 311 names 9:12 am.
  assert.match(textOf(cards[0]), /9:12 am/, "the call does not name the time she has to be there");
  assert.ok(after.length >= 2, "the line is still drawn in both windows");
});

test("and the minute she switches calls on has already been answered for", () => {
  // The seeding's real job, and the one the test above cannot see: a call is due at
  // minute 311, so a finger that switches calls on AT 9:11 is standing on a call the
  // morning has already made. Without the seed the very next beat announces it, a bell
  // for a job that started the minute she pressed.
  setNow("2026-09-22T09:11:00");                 // exactly minute 311, where a call is due
  globalThis.window.AudioContext = class { constructor() {} close() {} };
  const { root } = board();
  placeTheLine(root);
  const start = walk(root).find((n) => n.tagName === "BUTTON" && /Start calling/.test(textOf(n)));
  for (const f of start._listeners.click || []) f({ type: "click", target: start });
  flushTicks();                                  // the beat inside the minute she pressed
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-call")).length, 0,
    "pressing on a call's own minute rang for a job that had already started");
});

// ── 5. The two folded cards ────────────────────────────────────────────────

test("both cards start folded, and folding is done in place", () => {
  const { root } = line();
  const cards = walk(root).filter((n) => hasClass(n, "fold-body"));
  assert.equal(cards.length, 2, `the screen has ${cards.length} folded cards`);
  for (const c of cards) assert.equal(c.hidden, true, "a folded card started open");
  const heads = walk(root).filter((n) => hasClass(n, "fold-head"));
  assert.equal(heads.length, 2);
  const caret = heads[0].children.find((c) => hasClass(c, "fold-caret"));
  assert.equal(textOf(caret).trim(), "▸", "a shut card does not wear the shut caret");
  const bodyBefore = cards[0];
  const before = replaceCount;
  for (const f of heads[0]._listeners.click || []) f({ type: "click" });
  assert.equal(cards[0], bodyBefore, "opening a card rebuilt it, so the board above lost its scroll");
  assert.equal(cards[0].hidden, false, "the card did not open");
  assert.equal(textOf(caret).trim(), "▾", "the caret did not change");
  assert.equal(replaceCount, before, "opening a card repainted something");
  // The shut/open flag is the module's, so it outlives this test exactly as it outlives
  // a visit. A test puts the screen back as it found it.
  for (const f of heads[0]._listeners.click || []) f({ type: "click" });
  assert.equal(cards[0].hidden, true, "the card did not shut again");
});

test("a card being open is the screen's business and is never written into her settings", () => {
  // The flag lives in the module, which is what makes a fresh page load — and so a
  // worker's next visit — come back shut. The trap the flag guards against is the other
  // way round: a card's open state leaking into her stored settings, which would be a
  // write to her data caused by reading a screen.
  const state = makeState();
  const { root } = line(state);
  const before = JSON.stringify(state.settings);
  const head = walk(root).find((n) => hasClass(n, "fold-head"));
  const body = () => walk(root).filter((n) => hasClass(n, "fold-body"))[0];
  assert.equal(body().hidden, true, "the card did not start shut");
  for (const f of head._listeners.click || []) f({ type: "click" });
  assert.equal(body().hidden, false, "the card did not open");
  assert.equal(JSON.stringify(state.settings), before, "opening a card wrote into her settings");
  // Only the module holds it — which is exactly what a fresh visit reads.
  const src = read("admin/js/views/production.js");
  assert.match(src, /const LINE_FOLD = \{ open: false \}/, "the line card's shut state is not the screen's own");
  assert.match(src, /const TIME_FOLD = \{ open: false \}/, "the timetable card's shut state is not the screen's own");
  // Put it back, because the flag outlives this test the way it outlives a visit.
  for (const f of head._listeners.click || []) f({ type: "click" });
  assert.equal(body().hidden, true, "the card did not shut again");
});

test("the line card answers with a number while it is shut, and the number is computed", () => {
  const state = makeState();
  const { root } = line(state);
  const card = walk(root).find((n) => hasClass(n, "card") && textOf(n).includes("The line behind this day"));
  assert.ok(card, "no line card");
  // The answer sits between the head and the body, so it is readable shut.
  const head = card.children.find((c) => hasClass(c, "fold-head"));
  const body = card.children.find((c) => hasClass(c, "fold-body"));
  const answer = card.children[card.children.indexOf(head) + 1];
  assert.notEqual(answer, body, "the answer is inside the fold, so a shut card says nothing");
  assert.match(textOf(answer), /\d+ pans? today/, "the shut card does not give a capacity");
  assert.match(textOf(answer), /holds it back/, "the shut card does not name the wall");
  // And it is computed from the day, not stored: her settings came back untouched.
  assert.equal(state.settings.production.capacity, undefined);
});

test("the capacity sentence names the station as the station names itself", () => {
  // Both directions, because one of them alone would pass on a sentence that named the
  // wrong station and got the verb right by luck. With no day of her own the plan is
  // hers alone, so what the arithmetic decided is knowable from here — and the expected
  // wording is built from the arithmetic's own station object, not typed out.
  const cases = [
    { plan: { prooferPans: 1 }, wall: "proofer" },                  // 0.74 pans an hour
    { plan: { prooferPans: 400, ovenPans: 400 }, wall: "hands" },   // nothing holds her but her own hands
  ];
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  for (const c of cases) {
    const state = makeState({}, c.plan);
    delete state.settings.scenario;
    const r = computeLine(planOf(state.settings.production));
    assert.equal(r.bottleneck.key, c.wall, "the fixture no longer puts the wall where this test expects");
    const card = walk(line(state).root)
      .find((n) => hasClass(n, "card") && textOf(n).includes("The line behind this day"));
    const want = `${lower(r.bottleneck.name)} ${r.bottleneck.plural ? "are" : "is"} the wall that holds it back`;
    assert.ok(textOf(card).includes(want),
      `the sentence does not read "${want}": ${textOf(card).slice(0, 160)}`);
  }
});

test("with no day of her own the line is computed from her plan and not from a day it invented", () => {
  // The gate, measured at the screen. An empty scenario is not an empty day — the model
  // falls back to a full ten-module default one — so a screen that derived whenever a
  // scenario object merely EXISTED would read a day she never built. Deleted and empty
  // are the two shapes of "no day of her own", and both must come out at her own number.
  const mine = computeLine(planOf(makeState().settings.production)).dayCapacity;
  const invented = computeLine({
    ...makeState().settings.production,
    ...scenarioPlanPatch({}, makeState().settings.production).patch,
  }).dayCapacity;
  assert.notEqual(mine, invented, "the two days no longer tell apart, so this test sees nothing");
  for (const shape of ["deleted", "empty"]) {
    const state = makeState();
    if (shape === "deleted") delete state.settings.scenario;
    else state.settings.scenario = {};
    const text = textOf(line(state).root);
    assert.ok(text.includes(`${mine} pans today`),
      `a board with a ${shape} scenario read a day it invented: ${text.match(/\d+ pans today/) || "no capacity at all"}`);
    assert.ok(!text.includes(`${invented} pans today`),
      `a board with a ${shape} scenario read the invented default day`);
    if (shape === "deleted") {
      assert.equal("scenario" in state.settings, false, "the screen seeded a day into her settings");
    } else {
      assert.deepEqual(state.settings.scenario, {}, "the screen filled in the day she had left empty");
    }
  }
});

test("and with a day of her own the line IS read off it, so the gate is not simply off", () => {
  // The twin of the rule above: a screen that never derived would pass the gate test by
  // never deriving anything, and she would be back to typing numbers her planner already
  // knows. Her own day moves the line, and the number comes from the derivation.
  const state = makeState();
  const hers = computeLine(planOf(state.settings.production)).dayCapacity;
  const derived = computeLine({
    ...state.settings.production,
    ...scenarioPlanPatch(state.settings.scenario, state.settings.production).patch,
  }).dayCapacity;
  assert.notEqual(hers, derived, "her own day no longer changes the line, so this proves nothing");
  const text = textOf(line(state).root);
  assert.ok(text.includes(`${derived} pans today`),
    `the board did not read her own day: it says ${text.match(/\d+ pans today/) || "nothing"}`);
});

test("typing one of the four numbers changes exactly that number", () => {
  const state = makeState();
  const { root } = line(state);
  const before = JSON.stringify(state.settings.production);
  type(fieldInput(root, "Baking pans you own"), 20);
  const after = JSON.parse(JSON.stringify(state.settings.production));
  const changed = Object.keys(after).filter((k) => after[k] !== JSON.parse(before)[k]);
  assert.deepEqual(changed, ["pans"], `typing one box changed ${JSON.stringify(changed)}`);
  assert.equal(after.pans, 20);
});

test("a cleared box is mid-typing and holds the last good number", () => {
  const state = makeState();
  const { root } = line(state);
  type(fieldInput(root, "Baking pans you own"), "");
  assert.equal(state.settings.production.pans, 12, "a cleared box wrote a number nobody asked for");
});

test("the eight numbers the timetable works from are all reachable, and folded", () => {
  const { root } = line();
  const body = walk(root).filter((n) => hasClass(n, "fold-body"))[1];
  const labels = walk(body).filter((n) => n.tagName === "LABEL").map((l) => textOf(l).trim());
  assert.equal(labels.length, 8, `the timetable card carries ${labels.length} fields`);
  for (const l of labels) assert.ok(l.length > 6, `a field is labelled "${l}", which names no unit`);
});

test("the timetable still works the day back from the oven", () => {
  const { root } = line();
  const card = walk(root).find((n) => hasClass(n, "card") && textOf(n).includes("The last moment each stage may start"));
  assert.ok(card, "no timetable card");
  const head = card.children.find((c) => hasClass(c, "fold-head"));
  const body = card.children.find((c) => hasClass(c, "fold-body"));
  // Shut, this card is its own head and nothing else. The timetable is a page of advice,
  // not a glance, so a caret promising "there is more" must not be sitting over the whole
  // of what there is — which is what it was doing while the answer sat outside the fold.
  assert.equal(body.hidden, true, "the timetable card did not start shut");
  assert.match(shownText(card), /last moment each stage may start/, "the shut card lost its own title");
  assert.doesNotMatch(shownText(card), /\d{1,2}:\d\d (am|pm)/,
    "a shut timetable card is already showing its clock times, so its caret lies");
  for (const f of head._listeners.click || []) f({ type: "click" });
  const text = shownText(card);
  assert.match(text, /last moment that stage may start/, "the timetable lost its own explanation");
  assert.match(text, /\d{1,2}:\d\d (am|pm)/, "the timetable names no clock times");
  assert.match(text, /stretch and fold|rest/i, "the timetable lost its stages");
  assert.match(text, /tub/, "the timetable lost the tub it is anchored to");
  for (const f of head._listeners.click || []) f({ type: "click" });
  assert.equal(body.hidden, true, "the card did not shut again");
});

test("a stage start that is a time of day is written back as a clock", () => {
  const state = makeState();
  const { root } = line(state);
  const input = fieldInput(root, "Minutes after midnight the first 6 pans must be at the oven");
  assert.match(textOf(input.parentNode), /That is 8:00 am\./, "the time field does not read back as a clock");
  type(input, "510");
  assert.match(textOf(input.parentNode), /That is 8:30 am\./);
});

// ── 6. The field count, and the thing that left ─────────────────────────────

const lineCardOf = (root) => walk(root).find((n) => hasClass(n, "card") && textOf(n).includes("The line behind this day"));
const timeCardOf = (root) => walk(root).find((n) => hasClass(n, "card") && textOf(n).includes("The last moment each stage may start"));
const inputsIn = (card) => walk(card).filter((n) => n.tagName === "INPUT");

test("the screen asks for twelve numbers where it used to ask for twenty-one", () => {
  const { root } = line();
  const all = walk(root).filter((n) => n.tagName === "INPUT");
  assert.equal(all.length, 12, `the screen asks for ${all.length} numbers`);
  // Four are hers, in the line card; eight are what the timetable works from, behind
  // the second fold.
  assert.equal(inputsIn(lineCardOf(root)).length, 4, "the line card is not four numbers");
  assert.equal(inputsIn(timeCardOf(root)).length, 8, "the timetable card is not eight numbers");
});

test("nothing she has to type is on the board with both cards shut", () => {
  // A worker opens this screen and reads; she opens a card to type. So with the screen
  // as it comes, not one box is out on it — what the line SAYS is not behind a fold,
  // and what she has to type is. The card answers, and the answer is readable shut.
  const { root } = line();
  const shown = walk(root).filter((n) => n.tagName === "INPUT" && !n.closest(".fold-body"));
  assert.equal(shown.length, 0, `${shown.length} boxes are out on the board`);
  assert.match(textOf(root), /\d+ pans? today/, "the answer is behind the fold too, so a shut screen says nothing");
});

test("the manual load row is gone, not merely hidden", () => {
  assert.doesNotMatch(read("admin/js/views/production.js"), /Load \$\{moves\}/,
    "the manual load row is still in the file");
  assert.doesNotMatch(read("admin/js/views/production.js"), /previewLoad|loadCard/,
    "the load card is still in the file");
});

// ── 7. The board and the planner are one drawing ────────────────────────────

// The modules window of a rendered screen. Since v184 the board's two windows are no
// longer the same kind of drawing — the modules are a strip of time and the people are
// a strip of work — so "the same day" is a claim about the modules, and the people are
// compared by their own test below.
const procPane = (root) => walk(root).find((n) => hasClass(n, "tl-pane-proc"));

test("the board and the planner draw the same day, bar for bar", () => {
  const b = board();
  const p = render(renderScenario, makeState());
  const shape = (root) => bars(procPane(root)).map((n) => `${n.attrs.style}|${textOf(n).trim()}`);
  assert.ok(shape(b.root).length > 8, "the board drew too little to compare");
  assert.deepEqual(shape(b.root), shape(p.root), "the two screens disagree about the same day");
});

test("and the people's window is the one place the two screens are drawn differently (v184)", () => {
  // The board's people window is a train — a coach per job, joined in the order the
  // jobs happen — and the planner's is still the time-true strip of bars she lays her
  // day out on. Both halves are asserted, because either one alone can be satisfied by
  // breaking the other: a board that lost its coaches and a planner that lost its bars
  // would pass a test that only looked at the board.
  const b = board();
  const p = render(renderScenario, makeState());
  const people = (root) => walk(root).find((n) => hasClass(n, "tl-pane-people"));
  assert.ok(bars(people(p.root)).length > 0, "the planner's people window lost the bars it lays the day out with");
  assert.equal(bars(people(b.root)).length, 0, "the board's people window is still drawn as a strip of time");
  assert.ok(walk(people(b.root)).some((n) => hasClass(n, "tl-coach")), "the board's people window has no coaches on it");
  assert.equal(walk(people(p.root)).filter((n) => hasClass(n, "tl-coach")).length, 0,
    "the planner is drawing the board's train");
});

test("the board draws the hours she typed and nothing the app worked out for her (v182)", () => {
  // The board is the same day drawn by the same code, so whatever band the planner
  // carries arrives on it for free — and that is exactly what this asserts, because a
  // second drawing is how the two screens would come to disagree. Her rule of 24
  // September retired the computed shade: "shade should just follow what i set, not
  // other consideration." So a day with nobody's hours typed is drawn with no band on
  // either screen, and a worker's card no longer claims a stretch of the day nobody set.
  const root = createEl("div");
  const state = makeState();
  const teardown = renderProduction(root, state);
  document.body.append(root);
  layers["popup-layer"].replaceChildren();
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-work")).length, 0,
    "the worker's board still draws a working stretch worked out from the day");
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-shift")).length, 0,
    "a day with nobody's hours typed draws a band on the board anyway");
  const row = walk(root).find((n) => hasClass(n, "tl-row")
    && walk(n).some((x) => hasClass(x, "tl-coach")));
  assert.ok(row, "the board drew no person row with work on it");
  row.dispatchEvent({ type: "click" });
  assert.doesNotMatch(textOf(layers["popup-layer"]), /Working/,
    "the worker's card still says Working … about a stretch no band stands for");
  assert.ok(state.settings.scenario.shifts == null,
    "opening a worker's card wrote hours onto her stored day");
  teardown();

  // And where she HAS typed the hours, the board still draws NO band — and that changed
  // in v184, deliberately. The band is drawn at `startMin x pxPerMin`, which is
  // arithmetic on the day's minute axis, and the people's window on a board no longer
  // has one: a coach does not sit under the minute it happens at, so the same band
  // stretched across the strip would be a quiet lie of exactly the kind this app's own
  // notes refuse. The hours are still said, twice, where they always were — on the
  // row's own tip and on the worker's card — and neither is allowed to go quiet here.
  const typed = makeState({ shifts: { 1: { startMin: 60, endMin: 300 } } });
  const root2 = createEl("div");
  const teardown2 = renderProduction(root2, typed);
  document.body.append(root2);
  layers["popup-layer"].replaceChildren();
  const person = walk(root2).find((n) => hasClass(n, "tl-row")
    && walk(n).some((x) => hasClass(x, "tl-coach")) && textOf(n).includes("Person 1"));
  assert.ok(person, "the board drew no row for the person whose hours she typed");
  assert.equal(walk(procPane(root2)).filter((n) => hasClass(n, "tl-shift")).length, 0,
    "the board drew a band on a window with no minute axis");
  const hours = /Here \d{1,2}:\d{2} (am|pm) → \d{1,2}:\d{2} (am|pm)/;
  assert.match(textOf(person), hours,
    "the row's own tip stopped saying the hours she set, so the typed hours left the board");
  person.dispatchEvent({ type: "click" });
  const card = textOf(layers["popup-layer"]);
  assert.match(card, hours, "the worker's card does not say the hours she set for them");
  assert.doesNotMatch(card, /Working/,
    "the worker's card still carries the computed line beside her own hours");
  assert.deepEqual(typed.settings.scenario.shifts, { 1: { startMin: 60, endMin: 300 } },
    "opening a worker's card rewrote the hours she typed");
  // And the board's clock is let go of here, so a screen left open by this test cannot
  // go on beating behind the one that follows it.
  teardown2();
});

test("the board widens the view and the tab bar, and puts both back on leaving", () => {
  const tabbar = createEl("div");
  tabbar.id = "tabbar";
  const real = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => (id === "tabbar" ? tabbar : layers[id] || null);
  const root = createEl("div");
  const teardown = renderBoard(root, makeState());
  assert.ok(hasClass(root, "wide"), "a board is drawn in the narrow column");
  assert.ok(hasClass(tabbar, "wide"), "the tab bar still draws the narrow strip");
  teardown();
  assert.equal(hasClass(root, "wide"), false, "the wide class outlives the screen");
  assert.equal(hasClass(tabbar, "wide"), false);
  globalThis.document.getElementById = real;
});

test("leaving the board stops its clock", () => {
  setNow("2026-09-22T09:00:00");
  const root = createEl("div");
  const teardown = renderBoard(root, makeState());
  document.body.append(root);
  assert.equal(beats.size, 1, "the board did not start its beat");
  // First prove the beat is a live one — a set that was never populated would make the
  // assertion after the teardown true for the wrong reason.
  const lit = () => px(nowLines(root)[0], "left");
  const at9 = lit();
  setNow("2026-09-22T09:05:00");
  flushTicks();
  assert.ok(lit() > at9, "the board's beat does not move its clock, so this test proves nothing");
  teardown();
  assert.equal(beats.size, 0, "leaving the screen left its beat running");
  const before = replaceCount;
  const parked = lit();
  setNow("2026-09-22T09:10:00");
  flushTicks();
  assert.equal(replaceCount, before, "the clock went on running behind another screen");
  assert.equal(lit(), parked, "the line moved behind a screen she had left");
});

// ── the train's geometry (v193) ───────────────────────────────────────────
//
// v184 gave every person their own piecewise map — a coach was one fixed width whatever
// its minutes, and the clock was pinned to the middle of the window. The consequence was
// that one minute of her morning landed at a DIFFERENT pixel in each person's row, so
// the three trains could not be read against each other. She named that as the fault:
//
//   "So the 3 person's train head, should be timed and position relatively to each
//    other, when time start, 3 train started together."   (25 September 2026)
//
// v193 replaces all of it with ONE linear axis for the whole day — a minute is that
// minute times the day's own scale, in every row, so two people's rulers agreeing is
// arithmetic rather than coincidence. Nothing else on this screen fails as quietly: a
// scale that has drifted still draws a train, it just draws the wrong one.

const near = (a, b) => Math.abs(a - b) < 1e-9;
// A scale from the app's own six stops, so the numbers below are numbers she can pick.
const K = 2.4;

test("one scale for the day: a coach stands at its own minute times that scale (v193)", () => {
  // Her second sentence: "Make the coach width relative to its duration".
  const g = coachGeom({ from: 30, to: 42 }, K);
  assert.ok(near(g.left, 30 * K), `a coach stood at ${g.left}, not at its own minute`);
  assert.ok(near(g.width, 12 * K), `a twelve-minute job was drawn ${g.width}px wide`);
  // Where a coach STANDS depends on the minute it starts at and on the scale, and on
  // nothing else — not on how long it lasts. That is what lets two people's rows be read
  // against each other, which is her third sentence.
  assert.ok(near(g.left, coachGeom({ from: 30, to: 90 }, K).left), "a coach's place moved with its length");
  // A job of nought minutes — a fold that takes no time at all to name — is drawn one
  // pixel rather than not at all: a coach that is not drawn is a job she cannot see.
  assert.equal(coachGeom({ from: 30, to: 30 }, K).width, 1, "a job of no minutes vanished");
});

test("a coach is exactly as wide as its own minutes: a one-minute fold is a hairline (v193)", () => {
  // Her answer, asked what a short job should look like: "and if it is not show as no
  // space big enough, just dont show, as we have another place shown it under person's
  // name". So no floor: at the closest scale a one-minute fold is 7.2 pixels and looks
  // like it.
  assert.equal(coachGeom({ from: 10, to: 11 }, 7.2).width, 7.2, "a short job was inflated to something readable");
  assert.equal(coachGeom({ from: 10, to: 40 }, 1.2).width, 36);
  // Longer is wider, always and in proportion — twice the minutes is twice the coach.
  const one = coachGeom({ from: 0, to: 20 }, K).width;
  const two = coachGeom({ from: 0, to: 40 }, K).width;
  assert.ok(near(two, one * 2), "twice the minutes was not twice the coach");
});

test("every coach sits on the one line, so a coach's far edge is the next minute's pixel (v193)", () => {
  const jobs = [{ from: 0, to: 12 }, { from: 15, to: 21 }, { from: 26, to: 28 }];
  const g = jobs.map((j) => coachGeom(j, K));
  assert.equal(g[0].left, 0, "the day's first job did not start at the line's own left edge");
  // The wait before a job is drawn as the LINE showing through, not as a link of its own:
  // the second coach begins at minute 15 x k, which is where minute 15 is.
  assert.ok(near(g[1].left, 15 * K), "a coach did not stand at its own minute");
  assert.ok(near(g[2].left, 26 * K));
  // And the line runs to the day's own end, not to the last job's.
  assert.equal(lineWidth(240, K), 240 * K);
  assert.ok(lineWidth(240, K) > g[2].left + g[2].width, "the line stopped at the last coach instead of the day's end");
});

test("the ruler sweeps in from the left and stops at the middle, and then the line moves (v193)", () => {
  // Her own third design, in her own words: "the ruler sweeps, untill reach center, it
  // stop, then the train move. The advantage of this is we see more coaches queues yet
  // to come... Start left is convenient in this way."
  const win = 300;
  const span = lineWidth(240, K); // 576
  // The day's start: the day's OWN LEFT EDGE is the window's left edge, and the ruler is
  // standing on it. This is the "start left hand side, not centred" she asked for first.
  const atStart = trainPlacement(0, K, win, 0, span);
  assert.equal(atStart.s, 0, "the day's start was not glued to the window's left edge");
  assert.equal(atStart.ruler, 0, "the ruler did not start at the day's first minute");
  // Still sweeping: nothing has moved but the ruler.
  const sweeping = trainPlacement(30, K, win, 0, span);
  assert.equal(sweeping.s, 0, "the line moved before the ruler reached the middle");
  assert.equal(sweeping.ruler, 30 * K);
  // Reaching the middle: from here the ruler stops and the line slides under it.
  const arrived = trainPlacement(75, K, win, 0, span); // 180px, past the 150px middle
  assert.equal(arrived.ruler, win / 2, "the ruler did not stop at the middle of the window");
  assert.equal(arrived.s, 180 - win / 2, "the line did not take up the sweep");
  // An hour later: the ruler is still at the middle and the line has slid further.
  const later = trainPlacement(135, K, win, 0, span); // 324px
  assert.equal(later.ruler, win / 2, "the ruler left the middle as the day went on");
  assert.ok(later.s > arrived.s, "the line did not keep moving after the ruler stopped");
});

test("the day's end parks the ruler at the window's edge rather than off the paper (v193)", () => {
  // The window cannot slide past the end of the line's own paper, so near the day's end
  // the ruler has to leave the centre and make for the right edge. A clock standing on a
  // minute the day does not have would be worse than a ruler that is not centred.
  const win = 300;
  const span = lineWidth(240, K);
  const end = trainPlacement(240, K, win, 0, span);
  assert.equal(end.s, span - win, "the window slid past the end of the line");
  assert.equal(end.ruler, win, "the day's last minute was not at the window's right edge");
  // And a day being WALKED past its own end does not run off it either: the ruler parks.
  const walked = trainPlacement(400, K, win, 0, span);
  assert.equal(walked.xNow, span, "a walked day carried the ruler past the line's own end");
  assert.equal(walked.ruler, win);
});

test("a drag can reach every part of the line, and nought is always one of the places it can be (v193)", () => {
  // `panRange` is what her own hand is clamped to, and it ALWAYS contains nought —
  // which is the whole reason "Back to now" and a press off the window are ways home
  // rather than wishes.
  const win = 300;
  const span = lineWidth(240, K);
  for (const nowMin of [0, 20, 75, 150, 240, 400]) {
    const range = panRange(nowMin, K, win, span);
    assert.ok(range.lo <= 0 && range.hi >= 0, `no way home at minute ${nowMin}: [${range.lo}, ${range.hi}]`);
    assert.ok(range.lo <= range.hi, `an empty range at minute ${nowMin}`);
  }
  // And no drag, however hard, can carry the minute she is reading off the window: a
  // ruler pushed off the edge would leave her looking at a line with no clock on it.
  for (const pan of [-9999, -400, -12, 0, 12, 400, 9999]) {
    const p = trainPlacement(150, K, win, pan, span);
    assert.ok(p.ruler >= 0 && p.ruler <= win, `a drag of ${pan} put the ruler at ${p.ruler}`);
  }
});

test("a countdown under a person's name is to the second, not rounded to the minute (v193)", () => {
  // Her ask: "can the time show under their names, accurate to 5m 55s?" A countdown
  // rounded to the minute is wrong by up to fifty-nine seconds at exactly the minute the
  // answer matters. The link's own countdown reads through this same function, so the
  // screen can never state one instant two ways.
  assert.equal(minsWords(5 + 55 / 60), "5m 55s");
  assert.equal(minsWords(6), "6m 0s");
  assert.equal(minsWords(55 / 60), "55s", "under a minute did not read as seconds");
  assert.equal(minsWords(0), "0s");
  // A minute that is not a number, or is in the past, is nought rather than "NaNm".
  assert.equal(minsWords(-3), "0s");
  assert.equal(minsWords(NaN), "0s");
  assert.equal(minsWords(undefined), "0s");
});

test("a scale that is missing or nonsense falls back to the app's own widest stop (v193)", () => {
  // The scale is read off her scenario, and a scenario being read is not always a
  // scenario that has one — a day saved before this release has whatever `pxPerMin` the
  // planner wrote, and a fresh one has none until she presses Scale.
  assert.equal(trainScale({ pxPerMin: 3.2 }), 3.2);
  assert.equal(trainScale({}), PX_PER_MIN_CHOICES[0]);
  assert.equal(trainScale(null), PX_PER_MIN_CHOICES[0]);
  assert.equal(trainScale({ pxPerMin: 0 }), PX_PER_MIN_CHOICES[0], "a scale of nought was accepted");
  assert.equal(trainScale({ pxPerMin: -4 }), PX_PER_MIN_CHOICES[0]);
  assert.equal(trainScale({ pxPerMin: "wide" }), PX_PER_MIN_CHOICES[0]);
});

// ── the board's train (v184) ──────────────────────────────────────────────
//
// What the workers' window on a board actually IS, as against the arithmetic above:
// one coach a job, all the same width, the countdown on the links between them, and a
// row that says who it is and what that person is on. Every one of these can be wrong
// while the screen still draws something that looks like a train, which is why each
// claim is counted from the drawing rather than trusted to it.

// The first `.tl-pane-people` on the page. On a board that is the TRAIN — it is built
// first, above the planner's own two windows (v185) — and on the planner it is the
// people's window, there being only one. So every reader that means "the train on a
// board, the people's window on the planner" keeps working unchanged.
const peoplePaneOf = (root) => walk(root).find((n) => hasClass(n, "tl-pane-people"));
// The planner's own people's window, on EITHER screen. On a board it is the second
// `.tl-pane-people`, underneath the train; on the planner it is the only one, and the
// two readers agree there. Kept apart from the train because the two windows have
// opposite rules about scrolling and about the day's own line.
const peopleWinOf = (root) => walk(root).find((n) => hasClass(n, "tl-pane-people") && !hasClass(n, "train"));
const trainPaneOf = (root) => walk(root).find((n) => hasClass(n, "tl-pane-people") && hasClass(n, "train"));
const procPaneOf = (root) => walk(root).find((n) => hasClass(n, "tl-pane-proc"));
const peopleRows = (root) => walk(peoplePaneOf(root)).filter((n) => hasClass(n, "tl-row"));
const kidEls = (n) => (n.children || []).filter((c) => c.nodeType === 1);
const coachesOf = (row) => walk(row).filter((n) => hasClass(n, "tl-coach"));
const coachTipsOf = (row) => kidEls(row).filter((n) => hasClass(n, "tl-tip-coach"));
const partOf = (n, cls) => walk(n).find((x) => hasClass(x, cls));
// A coach's own span, in minutes from the day's own start, read off the clocks the strip
// says in full — the TIP's pair, which carries am/pm, and not the face's, which has no
// room for one. The tip is also the only place on a board where a job's END is written,
// which is what lets a test rebuild a row's own strip from what the row itself says.
function tipSpan(tip) {
  const m = /(\d{1,2}):(\d{2}) (am|pm) → (\d{1,2}):(\d{2}) (am|pm)/.exec(textOf(tip));
  assert.ok(m, `a coach's tip does not name the job's span: "${textOf(tip)}"`);
  const mins = (h, mi, ap) => (((Number(h) % 12) + (ap === "pm" ? 12 : 0)) * 60)
    + Number(mi) - ONE_BAKER_SCENARIO.dayStartMin;
  return { from: mins(m[1], m[2], m[3]), to: mins(m[4], m[5], m[6]) };
}
function coachStartMin(tip) {
  return tipSpan(tip).from;
}
const cssBody = (sel) => {
  const m = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(read("admin/css/app.css"));
  assert.ok(m, `${sel} has no rule of its own`);
  return m[1];
};
// The body of the ONE rule whose selector is exactly this, and nothing else.
//
// `cssBody` above answers with the first rule its pattern reaches, and a pattern for a
// class also matches that class as the LAST part of somebody else's selector — so
// `cssBody("\\.tl-cname")` came back with `.tl-coach.due .tl-cicon, .tl-coach.due
// .tl-cwhen, .tl-coach.due .tl-cname { color: var(--red) }`, the shared tone rule three
// lines above the one being asked about. A test that read the wrong rule is worse than
// one with no rule at all: it fails pointing at a fault that does not exist, and it would
// pass just as happily on a value nobody wrote. Comments go first, because a comment
// sitting between a rule and the one before it is part of neither.
function cssRule(sel) {
  const css = read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].split(",").some((s) => s.trim() === sel)) return m[2];
  }
  assert.fail(`no rule in the stylesheet has ${sel} as its own selector`);
}
// The board's own strip of work: the element every coach is a child of, and the thing
// that is translated to hold the clock at its centre.
const stripOf = (row) => partOf(row, "tl-train");
// Where that strip has been placed, in pixels, as the drawing itself says it — the only
// honest source for a claim about placement, since a strip that is never placed reads as
// an empty string and not as a wrong number.
function placedLeft(row) {
  const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(stripOf(row).style.transform || "");
  assert.ok(m, `a row's strip was never placed: "${stripOf(row).style.transform}"`);
  return Number(m[1]);
}
// The clock the workers read the line against, and the label it carries.
// The workers' rulers — one per person's line — and the ONE face the window carries at
// its head. Her clause 3 asks for the rulers on the second and later lines with no face
// on them, so the two are deliberately different things and the readers keep them apart.
const theClock = (root) => walk(root).filter((n) => hasClass(n, "tl-clock"));
const theClockHead = (root) => walk(root).find((n) => hasClass(n, "tl-clock-head"));
const clockLabOf = (clock) => walk(clock).find((n) => hasClass(n, "tl-clock-lab"));
// Where a ruler stands, in its own track's pixels, as the drawing says it — the
// left it was written. The rulers are drawn INSIDE their tracks (see .tl-clock), so
// these are counted from each track's own left edge and every track is one width.
function rulerPx(ruler) {
  const v = Number.parseFloat(ruler.style.left);
  assert.ok(Number.isFinite(v), `a ruler was never placed: "${ruler.style.left}"`);
  return v;
}
// A press anywhere on the page. It is fired at the DOCUMENT because that is where the
// board listens for it — in the capture phase, so that a press which is not on the
// workers' line is answered before the thing it landed on opens a card over that line.
// `target` is what the press landed on, which is the whole of what the listener asks.
function pressAnywhere(target, type = "pointerdown", x = 10, y = 10) {
  globalThis.document.dispatchEvent({
    type, button: 0, clientX: x, clientY: y, target,
    preventDefault() {}, stopPropagation() {},
  });
}
const docPresses = () => (globalThis.document._listeners.pointerdown || []).length;
// The name column's own width, read out of the stylesheet: the one declared number on
// this strip, and the width the tests hold the measured column and the width budget to.
const trainNameW = () => Number(/width:\s*(\d+)px/.exec(cssBody("\\.tl-row\\.train\\s*>\\s*\\.tl-name"))[1]);
// The board's own rule for its clock line — and the one thing it must not carry, which
// is a rung of its own (see the v174 note on .tl-wrap: nothing here climbs a ladder).
const clockCss = () => cssBody("\\.tl-clock(?![\\w-])");
// The clock string for a minute of her day, worked out here rather than imported from the
// view: a test that formatted its expectations with the function it is checking would
// pass whatever that function did. Twelve-hour, no leading zero, "am"/"pm" — the format
// the whole app reads out in.
function clockAtMinute(min, dayStartMin = ONE_BAKER_SCENARIO.dayStartMin) {
  const total = ((((dayStartMin + Math.round(min)) % 1440) + 1440) % 1440);
  const h24 = Math.floor(total / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(total % 60).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}
// One coach in the board whose tip names `needle`, with the row it sits on — because a
// claim about a coach is a claim about one job in one person's day, and step three of the
// clock is a claim about a coach AFTER its own job has ended.
function coachFor(root, needle) {
  for (const row of peopleRows(root)) {
    const tips = coachTipsOf(row);
    const at = tips.findIndex((t) => textOf(t).includes(needle));
    if (at >= 0) return { row, coach: coachesOf(row)[at], tip: tips[at] };
  }
  return null;
}
// A gesture, fired at the pane as a browser fires it: the event carries its own target,
// and every listener the pane has for that type runs, in the order it was added.
//
// `more` carries the fields a particular gesture is made of — button 2 for the right press
// that reads the line, `pointerType: "touch"` and a `pointerId` for the two-finger one.
// Kept as an extra bag rather than a wider signature so that every gesture already written
// against this reader still fires exactly the event it fired before.
function gesture(pane, type, x, y, target, more) {
  const ev = {
    type, button: 0, clientX: x, clientY: y, target,
    ...more,
    preventDefault() {}, stopPropagation() {},
  };
  for (const f of pane._listeners[type] || []) f(ev);
}
// A tap on a coach, fired at the coach itself as a browser fires it — a plain left
// press, no movement, and the event carrying its own target. `stopped` records whether
// the handler kept the event from reaching the row, because the row's own handler opens
// the person's card: a tap that both ticked a job and opened a card under it would be two
// answers to one tap.
function tapCoach(coach) {
  const said = { stopped: 0 };
  const ev = {
    type: "click", button: 0, target: coach,
    preventDefault() {}, stopPropagation() { said.stopped += 1; },
  };
  for (const f of coach._listeners.click || []) f(ev);
  return said;
}
// The last thing the app said back to her. `toast` builds a fresh `.toast` node on
// document.body every time — the shim's `querySelector` answers null, so the real one's
// reuse-the-node path is never taken here — which makes the newest toast the last one.
function lastToast() {
  const ts = (globalThis.document.body.children || [])
    .filter((n) => n.nodeType === 1 && hasClass(n, "toast"));
  return ts.length ? textOf(ts[ts.length - 1]) : null;
}
// The labels of the buttons on whatever is in the app's confirm layer, and a way to press
// one of them — the only path by which a confirm in this app is answered.
function confirmButtons() {
  return walk(layers["confirm-layer"]).filter((n) => n.tagName === "BUTTON");
}
function pressConfirm(label) {
  const b = confirmButtons().find((n) => textOf(n).trim() === label);
  assert.ok(b, `the confirm card offers no "${label}": ${confirmButtons().map((n) => textOf(n).trim()).join(", ")}`);
  for (const f of b._listeners.click || []) f({ type: "click", button: 0, target: b });
}
// Every string the board puts on the screen OR into a style, scanned for the two words a
// broken number leaves behind. Text alone is not enough here: the whole strip is placed
// by a transform, and `translateX(NaNpx)` is a train that has vanished with not one
// character of text to show for it.
function boardStrays(root) {
  for (const n of walk(root)) {
    for (const [k, v] of Object.entries(n.attrs || {})) {
      if (/NaN|undefined/.test(String(v))) return `${k}="${v}"`;
    }
    for (const c of n.children || []) {
      if (c.nodeType === 3 && /NaN|undefined/.test(String(c.text))) return `"${c.text}"`;
    }
  }
  return null;
}

// A day with TWO hands on it, so "all the same width" is a claim about two rows and
// not about one. Untouched, her scenario names nobody and the automatic pass puts the
// whole morning on one person's row.
const TWO_HANDS = { modules: ONE_BAKER_SCENARIO.modules.map((m, i) => ({ ...m, person: i < 4 ? 1 : 2 })) };

test("one coach a job, and every coach drawn to its own minutes at one scale (v193)", () => {
  // The planner's screen is drawn FIRST and the board's second, because a render wipes
  // the beats the one before it started — and this test drives the board's own beat to
  // re-measure the trains at the width of her own phone.
  const p = render(renderScenario, makeState(TWO_HANDS));
  const b = board(makeState(TWO_HANDS));
  const countIn = (rows, cls) => rows.reduce((n, r) => n + walk(r).filter((x) => hasClass(x, cls)).length, 0);
  // One coach a job, counted against the OTHER screen. The claim is an identity between
  // the two drawings of one day — the planner still draws a time-true bar per job — so
  // a number invented in this file could not be the evidence for it.
  const jobs = countIn(peopleRows(p.root), "tl-bar");
  assert.ok(jobs > 3, "her day drew too few jobs for a coach count to mean anything");
  assert.equal(countIn(peopleRows(b.root), "tl-coach"), jobs,
    "a coach is not a job: the board and the planner disagree about how many jobs the day holds");

  // The day's own scale, read OFF THE DRAWING rather than assumed. `--hour-w` is the one
  // number the chart declares about its own axis, and the train must be drawn from that
  // same number or the two windows above and below each other disagree about the morning.
  const k = px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  assert.ok(k > 0, "the chart declares no hour width, so its own scale cannot be read");
  assert.ok(PX_PER_MIN_CHOICES.some((c) => Math.abs(c - k) < 0.01),
    `the day's scale reads ${k}px a minute, which is not one of the app's six stops`);

  const pane = trainPaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();

  const rows = peopleRows(b.root);
  assert.ok(rows.length >= 2, "the board drew fewer than two people, so nothing here can be compared");
  let coaches = 0;
  for (const row of rows) {
    const cs = coachesOf(row);
    const ts = coachTipsOf(row);
    assert.equal(ts.length, cs.length, "a coach has no tip, or a tip was drawn for a coach that is not on the strip");
    for (let i = 0; i < cs.length; i++) {
      // The minutes come off the coach's OWN tip — the one place a job's span is written
      // in full — and the pixels off the drawn element, so the arithmetic is measured
      // rather than trusted.
      const span = tipSpan(ts[i]);
      const mins = span.to - span.from;
      const w = px(cs[i], "width");
      const left = px(cs[i], "left");
      assert.ok(Number.isFinite(w) && w > 0, `a coach was drawn with no width ("${cs[i].attrs.style}")`);
      // Her second sentence, on the element: "Make the coach width relative to its
      // duration". No floor and no ceiling — a one-minute job is a hairline and is meant
      // to look like one, which is the width v184 refused her in as many words.
      assert.ok(near(w, Math.max(1, mins * k)),
        `a ${mins}-minute job was drawn ${w}px wide, and ${mins} minutes of this day is ${mins * k}px`);
      // And where it stands is its own first minute, times the SAME scale — no per-row
      // map anywhere. This is her third sentence as arithmetic: "the 3 person's train
      // head, should be timed and position relatively to each other". It is also what
      // makes the trains comparable at all, and what a per-row map could never give.
      assert.ok(near(left, span.from * k),
        `a coach whose first minute is ${span.from} stood at ${left}px, and that minute is ${span.from * k}px along the line`);
      // One of two colours and no more: her "The coach should have 2 color only."
      assert.doesNotMatch(String(cs[i].className || ""), /ptone-\d/,
        `a coach wears one of the eight person tones ("${cs[i].className}") — the tones belong on the row's rail`);
      for (const bad of String(cs[i].className || "").split(/\s+/)) {
        if (!bad) continue;
        assert.ok(["tl-coach", "coming", "due", "ack", "here"].includes(bad),
          `a coach carries the class "${bad}", which is not one of this screen's own states`);
      }
      // A taken coach is green with a tick and not a third shade.
      if (hasClass(cs[i], "ack")) {
        assert.ok(partOf(cs[i], "tl-cack"), "a coach sitting in its taken state carries no tick");
      }
      coaches += 1;
    }
  }
  assert.ok(coaches > 3, "too few coaches were drawn for the widths above to mean anything");

  // The wait between two jobs is drawn TRUE to its own minutes — a gap widened to hold a
  // number would push every coach after it off the minute it belongs to — and the
  // countdown is written on it only where those minutes left the room to read one.
  const GAP_MIN = 22; // the view's own GAP_MIN_W, mirrored here as the spec number
  let gaps = 0;
  for (const row of rows) {
    const ts = coachTipsOf(row).map(tipSpan);
    const links = walk(partOf(row, "tl-track")).filter((n) => hasClass(n, "tl-link"));
    for (let i = 0; i + 1 < ts.length; i++) {
      const gap = ts[i + 1].from - ts[i].to;
      const link = links.find((l) => near(px(l, "left"), ts[i].to * k));
      if (gap <= 0) {
        assert.ok(!link, "a gap was drawn between two jobs that run back to back");
        continue;
      }
      gaps += 1;
      assert.ok(link, `the ${gap} minutes of waiting before a job were not drawn at all`);
      assert.ok(near(px(link, "width"), gap * k),
        `a ${gap}-minute wait was drawn ${px(link, "width")}px wide, which is not ${gap} minutes of this day`);
      const count = partOf(link, "tl-count");
      if (px(link, "width") < GAP_MIN) {
        assert.ok(!count, `a ${px(link, "width")}px gap carries a countdown, and the words would not fit`);
      } else {
        assert.ok(count, "a gap wide enough for its countdown carries none");
        assert.match(textOf(count), /^(✓|due|\d+m \d+s|\d+s)$/,
          `the countdown on a gap reads "${textOf(count)}", which is not a countdown`);
      }
    }
  }
  assert.ok(gaps > 0, "the board drew no wait at all, so nothing above was tested");
  // The countdown is never on a coach — her "numbers ... Only on the links".
  assert.equal(walk(pane).filter((n) => hasClass(n, "tl-coach") && walk(n).some((x) => hasClass(x, "tl-count"))).length, 0,
    "a countdown was drawn on a coach, and a coach is a job rather than the wait before one");

  // The stylesheet: a coach is placed, not sized, and there is no width rule here to
  // become a second answer to a question the view has already answered.
  const coachCss = cssRule(".tl-coach");
  assert.match(coachCss, /position:\s*absolute/, "a coach is not absolutely placed, so a minute of the day is not a pixel of the line");
  assert.doesNotMatch(coachCss, /(^|[;{\s])width\s*:/, "the stylesheet gives a coach a width of its own, so its length is not its minutes");
  assert.doesNotMatch(coachCss, /--tone-(ink|wash)/, "a coach is painted from the person's tone, and her rule is two colours only");
  assert.match(cssRule(".tl-coach.due"), /background:\s*var\(--red-bg\)/, "a coach whose hand is needed is not the light red");
  assert.doesNotMatch(cssRule(".tl-coach.due"), /transition/,
    "the fade is declared on the state rather than on the coach, so the way OUT of red is instant — her 'not sudden' is both ways");
  for (const sel of [".tl-coach", ".tl-cface", ".tl-cname"]) {
    assert.match(cssRule(sel), /transition:[^;]*(background-color|color)[^;]*\.45s/,
      `${sel} declares no fade, so the colour change is the jump she asked not to feel`);
  }
  // The hairline is still a hairline and still pressable: the width stays true and the
  // PRESS is widened, which is the one way both of her answers can hold at once.
  assert.match(cssRule(".tl-coach::before"), /width:\s*max\(100%,\s*36px\)/,
    "a coach's press area is not at least the app's own 36px, so a one-minute fold cannot be tapped");
  assert.match(cssRule(".tl-link"), /position:\s*absolute/, "a wait is not placed by its own minutes");
  assert.match(cssRule(".tl-count"), /font-variant-numeric:\s*tabular-nums/,
    "the countdown's digits are not tabular, so it jitters as it counts");
});

test("the coach face shows meaning, never a clipped word, and the tip carries the rest (v184)", () => {
  const rows = peopleRows(board().root);
  assert.ok(rows.length > 0, "the board drew nobody");
  // The word stays. Her refinement — "if the coach box is too smalll to house the full
  // words, then just show meaningful" — was first read here as "drop the name and keep
  // the icon", and that is what this used to assert. Reading the drawn board is what
  // showed the cost. What v193 pins instead is where a coach that really has no room
  // gives up: the WHOLE FACE stands aside at once, never the word alone, and never by
  // shrinking the type until it cannot be read.
  assert.doesNotMatch(read("admin/css/app.css"), /\.tl-cname\s*\{[^}]*display:\s*none/,
    "a coach's word is hidden on its own, so a phone shows an icon and a clock and nothing that says what the job is");
  assert.match(cssRule(".tl-coach"), /container-type:\s*inline-size/,
    "a coach does not ask how wide it is, so a face with no room has no way to stand aside");
  assert.match(read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, ""),
    /@container\s*\(max-width:\s*43px\)\s*\{\s*\.tl-cface,\s*\.tl-cack\s*\{\s*display:\s*none/,
    "a coach too narrow for its face still draws one, so its words are clipped in a box that has no room for them");
  assert.match(cssBody("\\.tl-tip-coach"), /white-space:\s*normal/,
    "the coach's tip is held to one line, so the full name it carries is clipped in its turn");
  assert.match(read("admin/css/app.css"),
    /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*\.tl-tip-coach\.on\s*\{\s*display:\s*block/,
    "the coach's tip is shown by a rule a phone can reach, so a tap means two things at once");

  let faces = 0;
  for (const row of rows) {
    const cs = coachesOf(row);
    const ts = coachTipsOf(row);
    assert.equal(ts.length, cs.length, "a coach has no tip, or a tip was drawn for a coach that is not on the strip");
    for (let i = 0; i < cs.length; i++) {
      const icon = partOf(cs[i], "tl-cicon");
      const when = partOf(cs[i], "tl-cwhen");
      assert.ok(icon && textOf(icon), "a coach's face carries no icon, so it is a blank box");
      assert.match(textOf(when), /^\d{1,2}:\d{2}$/, `a coach's face does not name its own clock: "${textOf(when)}"`);
      // The tip is a child of the ROW and not of the coach: the strip is translated and
      // the track clips, so a box opened inside one would be dragged off and cut.
      assert.ok(hasClass(ts[i].parent, "tl-row"), "the coach's tip is inside the strip, where a clipped translated box would cut it off");
      const tip = textOf(ts[i]);
      assert.match(tip, /\d{1,2}:\d{2} (am|pm) → \d{1,2}:\d{2} (am|pm) · \d+ min/,
        `the tip does not carry the job's own clocks and length: "${tip}"`);
      assert.match(tip, /👤 \S/, "the tip does not name the person the job belongs to");
      assert.match(tip, /Taken|Due now|Running now|Coming up/,
        `the tip does not say in words where the job stands: "${tip}"`);
      const name = partOf(cs[i], "tl-cname");
      if (!name) continue;
      faces += 1;
      const word = textOf(name);
      assert.ok(word && !/…|\.\.\./.test(word), `a coach's face is showing a clipped word: "${word}"`);
      assert.match(word, /^\S+$/, `a coach's face is showing more than one word: "${word}"`);
      assert.ok(tip.includes(word), `the face says "${word}" and the tip does not carry the job it belongs to`);
      // And it is opened by hand, because a `:hover` selector cannot reach a box that is
      // a sibling of the thing being hovered. Fired as the browser fires it — every
      // listener on the coach, in the order it was added — rather than by reaching for
      // one of them, since the coach carries two.
      const open = cs[i]._listeners.mouseenter || [];
      const shut = cs[i]._listeners.mouseleave || [];
      assert.ok(open.length, "the coach has no way to open its own tip");
      assert.ok(shut.length, "the coach has no way to shut its own tip");
      for (const f of open) f();
      assert.ok(ts[i].classList.contains("on"), "hovering a coach does not open its tip");
      for (const f of shut) f();
      assert.equal(ts[i].classList.contains("on"), false, "the tip stays open after the pointer has left the coach");
    }
  }
  assert.ok(faces > 0, "not one coach carried a word, so the face was never tested");

  // The word is DERIVED, not the first word and not a cut one. "The oven swap and the
  // bake" is the case that decides it: its first word means nothing at all, so a face
  // reading "The" would be showing a word and saying nothing — and the word that means
  // it, "oven", is the second one, not the first.
  const faceFor = (needle) => {
    const row = rows.find((r) => coachTipsOf(r).some((t) => textOf(t).includes(needle)));
    assert.ok(row, `her day has no job called ${needle}`);
    const at = coachTipsOf(row).findIndex((t) => textOf(t).includes(needle));
    return textOf(partOf(coachesOf(row)[at], "tl-cname"));
  };
  assert.equal(faceFor("The oven swap and the bake"), "oven",
    '"The oven swap and the bake" is not shown as the word that means it');
  assert.equal(faceFor("Cutting and packing"), "Cutting",
    '"Cutting and packing" is not shown as the word that means it');
  assert.equal(faceFor("The rests and the stretch and folds"), "rests",
    '"The rests and the stretch and folds" is not shown as the word that means it');
});

test("a coach's word goes with the punctuation that is not part of it (v184)", () => {
  // Found by reading the drawn board rather than by reasoning. The stock module "Wash,
  // oil and fill" named its coach "Wash," — a comma on the face. Her refinement refuses
  // a clipped word, and a word with the sentence's punctuation still welded to it is cut
  // wrong in exactly that way: the box was not too small, the word was simply cut wrong.
  // The stop-word test already strips punctuation to READ a word; the word handed back
  // now gets the same treatment at both ends. Tested through a drawn board whose day
  // carries those names, because the punctuation is the app's own reader's, not this
  // file's.
  const day = makeState({
    modules: [
      { id: "m_wash", icon: "🥘", name: "Wash, oil and fill", on: true, person: 0,
        cycles: [{ name: "Wash", min: 6, load: 6, unload: 0 }],
        batch: 6, everyMin: 87, repeats: 1, startMin: 0, people: 1 },
      { id: "m_retard", icon: "❄️", name: "(overnight) retard", on: true, person: 0,
        cycles: [{ name: "Retard", min: 30, load: 2, unload: 0 }],
        batch: 6, everyMin: 87, repeats: 1, startMin: 30, people: 1 },
    ],
  });
  const drawn = board(day);
  const words = [];
  for (const row of peopleRows(drawn.root)) {
    for (const c of coachesOf(row)) {
      const name = partOf(c, "tl-cname");
      if (name) words.push(textOf(name));
    }
  }
  assert.ok(words.length, "the day drew no coach face to read");
  for (const w of words) {
    assert.match(w, /^[A-Za-z0-9]+$/,
      `a coach's face carries punctuation that belongs to the sentence rather than to the word: "${w}"`);
  }
  assert.ok(words.includes("Wash"),
    `"Wash, oil and fill" did not read Wash: ${JSON.stringify(words)}`);
  assert.ok(words.includes("overnight"),
    `"(overnight) retard" did not read overnight: ${JSON.stringify(words)}`);
});

test("the row says who is on it and what is next (v184)", () => {
  // After the day is over with nothing ticked, two facts that are NOT the same sentence
  // have to be told apart. A row with work on it has work nobody has taken — and those
  // coaches are red and STAY red (her clause 3: "the coach can pass the current timeline,
  // but stay red, click it turn green") — so the row counts what is left instead of
  // telling a worker they have finished something they have never touched. A row with no
  // work on it never started, and says that instead.
  setNow("2026-09-22T14:00:00");
  const over = board();
  const rowsOver = peopleRows(over.root);
  assert.ok(rowsOver.length > 0, "the board drew nobody");
  for (const row of rowsOver) {
    const cell = kidEls(row)[0];
    assert.ok(hasClass(cell, "tl-name"), "a row does not begin with its person's own cell");
    assert.match(textOf(cell), /👤 \S/, "the row does not say who is on it");
    const next = walk(row).find((n) => hasClass(n, "tl-next"));
    assert.ok(next, "the row does not say what is next");
    assert.equal(next.parent, cell, "what is next is not part of the person's own cell, so a phone cannot read it without a tap");
    const said = textOf(next);
    assert.match(said, /^(All done|Nothing on|\d+ not taken|Now: .+|Due: .+|Next (?:\d+m )?\d+s)$/, `the row's next line reads "${said}"`);
    const n = coachesOf(row).length;
    if (!n) {
      assert.equal(said, "Nothing on", "a row with no work on it no longer says so");
      continue;
    }
    assert.equal(said, `${n} not taken`,
      "a row whose every coach is red and untaken reads as finished, which is the board talking a worker out of the tap her clause 3 asks for");
    assert.ok(hasClass(next, "due"), "the row's line about untaken work is not drawn as urgent");
  }

  // And the count gives up as the work is taken. Tick every coach on ONE row and read
  // that row's own line back off the redrawn screen: it alone turns quiet, and the rows
  // nobody touched keep saying what is left — so the count is read from the acks and not
  // from the clock, which has not moved at all. Then untick one coach: the count comes
  // back at one, which is what tells "All done" from "the last tick was taken off".
  const live = board();
  // By POSITION, because the row is rebuilt by every tap and a node held across one is
  // a node that is no longer on the screen. The rows keep their order: the redraw puts
  // the same people in the same places.
  const rowsAt = (root) => peopleRows(root);
  const at = rowsAt(live.root).findIndex((r) => coachesOf(r).length > 1);
  assert.ok(at >= 0, "no row on her day carries more than one job, so this proves nothing");
  const mine = coachesOf(rowsAt(live.root)[at]).length;
  const saidAt = (i) => textOf(walk(rowsAt(live.root)[i]).find((n) => hasClass(n, "tl-next")));
  const otherAt = rowsAt(live.root).findIndex((r, i) => i !== at && coachesOf(r).length > 0);
  const otherSaid = otherAt >= 0 ? saidAt(otherAt) : null;
  for (let i = 0; i < mine - 1; i += 1) tapCoach(coachesOf(rowsAt(live.root)[at])[i]);
  assert.equal(saidAt(at), "1 not taken",
    "ticking every coach but one on a row did not leave the row saying what is left");
  tapCoach(coachesOf(rowsAt(live.root)[at])[mine - 1]);
  const done = walk(rowsAt(live.root)[at]).find((n) => hasClass(n, "tl-next"));
  assert.equal(textOf(done), "All done", "a row whose every coach is green still says work is left");
  assert.ok(!hasClass(done, "due"), "a row with nothing left to take is still drawn as urgent");
  if (otherAt >= 0) {
    assert.equal(saidAt(otherAt), otherSaid,
      "ticking one person's row changed the line of a row nobody touched");
  }
  // And the tick that turns the row quiet is undone by the same tap: the count is back.
  tapCoach(coachesOf(rowsAt(live.root)[at])[mine - 1]);
  assert.equal(saidAt(at), "1 not taken",
    "taking a tick off did not put the row's count of what is left back");

  // And mid-morning, where there IS a next thing: the countdown the row shows is the gap
  // to that row's OWN next job, read back off the same strip the coaches are drawn on.
  //
  // And it is read to the SECOND — her ask of 25 September 2026, "can the time show under
  // their names, accurate to 5m 55s?" The clock is therefore set with seconds on it, so a
  // countdown rounded back to the whole minute cannot pass this: at 4:30:55 a job five
  // minutes and five seconds away reads "Next 5m 5s", and a formatter that dropped the 5
  // would answer "Next 5m" and be fifty-five seconds into the past.
  const countdownSec = (said) => {
    const m = /^Next (?:(\d+)m )?(\d+)s$/.exec(said);
    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
  };
  const nowMin = 30 + 55 / 60; // 4:30:55 against her 4:00 am start, the subtraction boardNow makes
  setNow("2026-09-22T04:30:55");
  const mid = board();
  let counted = 0;
  for (const row of peopleRows(mid.root)) {
    const said = textOf(walk(row).find((n) => hasClass(n, "tl-next")));
    const secs = countdownSec(said);
    if (secs === null) continue;
    counted += 1;
    const ahead = coachTipsOf(row).map(coachStartMin).filter((v) => v > nowMin).sort((a, b) => a - b);
    assert.ok(ahead.length, `the row says a job is ${secs} seconds away and its own strip has none after the clock`);
    assert.ok(Math.abs(secs - (ahead[0] - nowMin) * 60) <= 1,
      `the row counts ${said} to its next job and its own strip puts that job ${((ahead[0] - nowMin) * 60).toFixed(1)} seconds away`);
  }
  assert.ok(counted > 0, "no row was counting down at all, so this proves nothing about the countdown");

  // And a BEAT alone walks that countdown down — the half a worker standing at a bench
  // actually reads, with nobody touching the screen. The count is read on the same board
  // and the same node, because that is the claim: the number comes down without the line
  // being rebuilt around it, which is the app's own rule (a beat repaints nothing, so a
  // scroll is never thrown away). A countdown that only moved on a tap would sit frozen
  // all morning, and the line would be answering with the minute it was drawn at.
  setNow("2026-09-22T04:31:00");
  const ticking = board();
  const countedRow = peopleRows(ticking.root).find((r) => {
    const secs = countdownSec(textOf(walk(r).find((n) => hasClass(n, "tl-next"))));
    return secs !== null && secs >= 180;
  });
  assert.ok(countedRow, "no row is counting down three minutes or more, so a beat has nothing to bring down");
  const cell = walk(countedRow).find((n) => hasClass(n, "tl-next"));
  const before = countdownSec(textOf(cell));
  const repaints = replaceCount;
  setNow("2026-09-22T04:32:00");
  flushTicks();
  assert.equal(countdownSec(textOf(cell)), before - 60,
    `a minute of the clock moved the row's own countdown from ${before} seconds to "${textOf(cell)}"`);
  assert.equal(replaceCount, repaints,
    "the minute's beat rebuilt the screen to bring a countdown down, which throws away a worker's place");
});

test("a coach turns red at its own job and STAYS red once the clock has gone past it (v184)", () => {
  // Her clause 3, in her own words: "The coach can pass the current timeline, but stay
  // red, click it turn green." So there is no upper bound on the due test — a job nobody
  // has taken is exactly the thing a board exists to show, and a job that goes quiet an
  // hour later is a job nobody sees.
  setNow("2026-09-22T04:00:00");
  const b = board();
  const found = coachFor(b.root, "The oven swap and the bake");
  assert.ok(found, "her day has no oven job on the board");
  const { from, to } = tipSpan(found.tip);
  assert.ok(from >= 5 && to > from, `the oven job runs ${from} to ${to}, too near the day's own edge to watch it turn`);
  // The day's own clock, driven a minute at a time through the board's own beat. One
  // board throughout: a claim about a coach going red and STAYING red is a claim about
  // the same coach, and a second render would be a second coach.
  const at = (min) => { setNow(REAL_DATE.parse("2026-09-22T04:00:00") + (min * 60000)); flushTicks(); };
  at(from - 2);
  assert.equal(hasClass(found.coach, "due"), false,
    `a coach is red ${from - (from - 2)} minutes before its own job starts, so red means nothing at all`);
  // The app's own call minute, which is one before the job starts (see callAtOf) — the
  // same minute the bell rings, so a coach turning red and a call going out cannot
  // disagree about when a job is due.
  at(from - 1);
  assert.equal(hasClass(found.coach, "due"), true,
    "a coach does not turn red on the minute its own job is called");
  at(from);
  assert.equal(hasClass(found.coach, "due"), true, "a coach is not red while its own job is running");
  at(to + 5);
  assert.equal(hasClass(found.coach, "due"), true,
    "a coach the clock has passed goes quiet, so the job nobody has taken can no longer be seen");
});

test("every person's line carries its own red ruler at the centre, and the window carries ONE face (v186)", () => {
  // Her clauses 3 and 9, in her own words: "the 2nd person and subsequent person have the
  // centered red ruler, but the 2nd and other don have to show the clock face", and "Each
  // of the person line has a clock line at centre of line". The two halves are one rule
  // and this test holds both: a RULER on every line, a FACE on none of them — the window
  // carries one face, at its head, beside the controls.
  setNow("2026-09-22T04:30:00");
  const nowMin = 30; // 4:30 am against her 4:00 am start, which is the subtraction boardNow makes
  const b = board(makeState(TWO_HANDS));
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();

  const rows = peopleRows(b.root);
  assert.ok(rows.length >= 2, "the board drew one row, so this proves nothing about the second person");

  // One ruler per line, and each one inside its OWN line's track — which is what makes it
  // that person's line and not the window's. It also lives inside the clip line, which is
  // the only reason a translated train cannot run under the name column while the ruler
  // stays where it was put.
  const rulers = theClock(b.root);
  assert.equal(rulers.length, rows.length,
    `the board drew ${rulers.length} rulers for ${rows.length} people's lines`);
  for (const row of rows) {
    const track = partOf(row, "tl-track");
    assert.equal(rulers.filter((z) => z.parent === track).length, 1,
      "a person's line does not carry exactly one red ruler of its own");
  }
  // And NOT ONE of them has a face on it. A column of four identical time labels down one
  // window is four answers to one question, and her clause 3 asks for the second and later
  // lines to be drawn WITHOUT one.
  for (const z of rulers) {
    assert.equal(clockLabOf(z), undefined,
      "a person's line carries its own clock face, so the same minute is printed once per person");
  }
  // The one face, at the head of the window, holding exactly one reading.
  const head = theClockHead(b.root);
  assert.ok(head, "the window carries no clock face at all");
  assert.equal(head.parent, partOf(pane, "tl-people"), "the face is not at the head of the window, over the lines it names");
  const labs = walk(b.root).filter((n) => hasClass(n, "tl-clock-lab"));
  assert.equal(labs.length, 1, `the window carries ${labs.length} faces, not one`);
  assert.equal(labs[0].parent, head, "the face is not the window's own head, so it belongs to a line rather than to all of them");

  // Where they stand — and this is the claim v193 strengthens rather than the test's
  // subject changing. Under v184 each row had a map of its own and the ruler was pinned to
  // the middle of the window, so one minute of the day stood at a DIFFERENT pixel in every
  // row and the most this could say was that each row put the same minute on the station.
  // There is now one axis for the whole day, so the claim is the stronger one: the rulers
  // stand at ONE pixel, and that pixel is where the minute the morning is at actually is.
  //
  // At 4:30 against her 4:00 start the morning has not yet reached the middle of the line,
  // so the ruler is SWEEPING: 30 minutes along the line, and the line not moved at all.
  // That is her own third design — "the ruler sweeps, untill reach center, it stop, then the
  // train move" — measured on the drawn board rather than asserted from the code.
  const inner = pane.clientWidth;
  const nameW = trainNameW();
  const trackW = inner - nameW;
  const k = px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  const lineW = px(stripOf(rows[0]), "width");
  const at = trainPlacement(nowMin, k, trackW, 0, lineW);
  assert.ok(at.xNow <= trackW / 2, "this minute was meant to be inside the sweep, and it is past the middle");
  assert.equal(at.s, 0, "the line moved before the ruler had reached the middle of the window");
  assert.equal(at.ruler, nowMin * k, "the ruler is not standing on the minute the morning is actually at");

  // One number, two coordinate spaces: a ruler is drawn INSIDE its track and is told a
  // pixel counted from the track's left edge; the face is drawn in the window and is told
  // the same pixel counted from the window's. The distance between the two is the name
  // column and nothing else.
  assert.equal(px(labs[0], "left"), Math.round(nameW + at.ruler),
    `the face stands at ${px(labs[0], "left")}px, not over the minute the morning is at (${Math.round(nameW + at.ruler)}px of a ${inner}px window)`);
  const places = new Set();
  for (const z of rulers) {
    places.add(rulerPx(z));
    assert.equal(rulerPx(z), Math.round(at.ruler),
      `a ruler stands at ${rulerPx(z)}px along its own line, not at the minute the day is at (${Math.round(at.ruler)}px)`);
  }
  // Two people, one pixel — her third sentence, "the 3 person's train head, should be timed
  // and position relatively to each other". This is the ONE thing a per-row map could not
  // give, and the reason every ruler above is compared to one number rather than to a
  // station of its own.
  assert.equal(places.size, 1, `the rows put their rulers at ${[...places].join("px and ")}px, so the clock is not shared`);

  // And every train is placed from that ONE placement, so the minute the morning is at
  // lands under the face on every row: the line begins at the name column, the minute is
  // `nowMin` times the scale along it, and the strip has been slid back by `s`.
  // `|| 0` on both sides for one reason and it is not a convenience: a line that has not
  // moved is written `translateX(0px)` while `-at.s` is a SIGNED nought, and the two are
  // the same pixel. An assertion about the screen should not turn on which nought it is.
  for (const row of rows) {
    assert.equal(placedLeft(row) || 0, Math.round(-at.s) || 0,
      `a row's train stands at ${placedLeft(row)}px, where the one placement puts it at ${Math.round(-at.s)}px`);
    const onScreen = nameW + placedLeft(row) + (nowMin * k);
    assert.ok(Math.abs(onScreen - px(labs[0], "left")) <= 1,
      `the minute the day is at lands at ${Math.round(onScreen)}px and the face says ${px(labs[0], "left")}px`);
  }

  // The face reads the CLOCK TIME and never the word "now": the modules window above still
  // draws the day's own now-line with its own label, and two lines on one screen both
  // saying "now" would be two answers to one question.
  assert.match(textOf(labs[0]), /^\d{1,2}:\d{2} [ap]m$/, `the face reads "${textOf(labs[0])}"`);
  assert.ok(!/now/i.test(textOf(labs[0])), "the workers' clock claims to be now, which the day's own line above already says");
  assert.equal(textOf(labs[0]), clockAtMinute(nowMin), "the face does not read the minute the day is actually at");
  // Absolute, and no longer sticky: at v184 the label rode the ruler at the top of the
  // window; it now belongs to the head, which is a band of its own above the lines.
  assert.match(cssBody("\\.tl-clock-lab"), /position:\s*absolute/,
    "the window's face is not placed against its own head");
  assert.match(cssBody("\\.tl-clock-lab"), /font-variant-numeric:\s*tabular-nums/,
    "the clock's digits are not tabular, so the label shuffles as it counts");
  // A ruler is RED at all times, and there is no second colour for it to take. v185 gave
  // the line a brown "reading" state because a drag in that build moved the line alone and
  // left it reading a minute the day was not at; here the trains move WITH the line, so the
  // ruler is always standing on the minute the morning is actually at. Keeping the colour
  // would leave a rule that can only ever fire wrongly.
  assert.match(clockCss(), /background:\s*var\(--red\)/, "a person's ruler is not the colour of the line");
  assert.ok(!/^\.tl-clock\.reading/m.test(read("admin/css/app.css")),
    "the dead brown reading state is back in the stylesheet, so a ruler can be told it is reading a minute the day is not at");
  assert.ok(!/z-index/.test(clockCss()),
    "a ruler declares a rung of its own, which is the v174 fault: an element that climbs here covers her pinned names");
  assert.ok(!/z-index/.test(cssBody("\\.tl-clock-head")),
    "the clock's head declares a rung of its own, which is the v174 fault again");

  // And nothing on the screen says a word of nothing once it is placed.
  assert.equal(boardStrays(b.root), null, "a beat put a broken number on the board");
});

test("a right press carries the whole picture, and a press off the window puts it back (v193)", () => {
  // Her clause 9, in her own words: "when we drag to the right, the train move to right and
  // the clock and red ruler move relatively." So the whole picture moves by ONE number —
  // every train, every ruler and the face — and the ruler therefore goes on naming the
  // minute the morning is at. Her clause 10 says how it comes home: "When i click outside
  // the person window, the clock back to center."
  //
  // WHAT BEGINS IT changed at v193, on her instruction of 25 September 2026: "and the drag,
  // should be by right mouse button hold down". A plain left press no longer reads the line
  // at all, because on this screen a left press is the tap on the coach under her finger
  // ("I'm on it") and the tap on a person's name. On a phone the same reading is TWO
  // fingers, her other answer: "handphone can accept double finger gesture".
  setNow("2026-09-22T04:30:00");
  const nowMin = 30; // 4:30 am against her 4:00 am start, which is the subtraction boardNow makes
  const b = board(makeState(TWO_HANDS));
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();
  const rows = peopleRows(b.root);
  const rulers = theClock(b.root);
  const lab = walk(b.root).find((n) => hasClass(n, "tl-clock-lab"));
  const restFace = px(lab, "left");
  const restRuler = rulerPx(rulers[0]);
  const restTrains = rows.map((row) => placedLeft(row));
  const live = textOf(lab);
  const trackW = pane.clientWidth - trainNameW();
  const coach = coachesOf(rows[0])[0];
  // The travel her hand has, from the day's OWN numbers rather than from a number chosen
  // in this file: the scale off the chart's own hour width, the line off the strip the
  // view drew, and then `panRange` — which is the same answer the view clamps her to.
  const k = px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  const lineW = px(stripOf(rows[0]), "width");
  const range = panRange(nowMin, k, trackW, lineW);
  assert.ok(range.lo < 0 || range.hi > 0, "there is nowhere at all for this hand to carry the line");

  // Both gestures, written once each so that every claim below is about the real event.
  const RIGHT = { button: 2, buttons: 2, pointerId: 7 };
  const right = (type, x, y, target = coach) => gesture(pane, type, x, y, target, RIGHT);
  const TOUCH = { button: 0, buttons: 1, pointerType: "touch" };
  const twoFinger = (type, x, y) => {
    for (const id of [1, 2]) gesture(pane, type, x + (id === 2 ? 80 : 0), y, coach, { ...TOUCH, pointerId: id });
  };

  // A LEFT press carries nothing. It is the tap on the work, and the same gesture must not
  // also be a reading of the line — one finger, one meaning.
  gesture(pane, "pointerdown", 120, 20, coach);
  gesture(pane, "pointermove", 60, 21, coach);
  gesture(pane, "pointerup", 60, 21, coach);
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains,
    "a left press carried the trains, and a left press on a coach is how a job is acknowledged");
  // And one finger on a phone carries nothing either, for the same reason.
  gesture(pane, "pointerdown", 140, 20, coach, { ...TOUCH, pointerId: 1 });
  gesture(pane, "pointermove", 80, 20, coach, { ...TOUCH, pointerId: 1 });
  gesture(pane, "pointerup", 80, 20, coach, { ...TOUCH, pointerId: 1 });
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains,
    "one finger on the line carried the train, and on a phone one finger is a tap on the work");

  // The right press, held. A four-pixel slop first, so a twitch is never read as a reading
  // — and the hand must go further sideways than up or down, so a page-scrolling finger is
  // not one either.
  right("pointerdown", 120, 20);
  right("pointermove", 118, 21);
  assert.equal(px(lab, "left"), restFace, "a two-pixel twitch moved the clock");
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains, "a twitch moved the trains");

  // TWENTY PIXELS TO THE LEFT, which is the direction that reads further into the morning
  // — the whole reason she wanted this gesture ("we see more coaches queues yet to come").
  // Small enough to be inside the travel measured above, so nothing here is a clamp.
  const dx = -20;
  right("pointermove", 120 + dx, 22);
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains.map((v) => v + dx),
    "a right press along the line did not carry the trains with it, so the clock and the train have come apart");
  for (const z of rulers) {
    assert.equal(rulerPx(z), restRuler + dx, "a right press moved the trains but left this person's ruler behind");
  }
  assert.equal(px(lab, "left"), restFace + dx, "a right press moved the line but not the face that names it");
  // The paper follows the hand — her clause 9, "when we drag to the right, the train move to
  // right" — so the picture moves by exactly what the hand moved by, and not against it.
  assert.equal(placedLeft(rows[0]) - restTrains[0], dx,
    "the paper did not move by what the hand moved by, so the line goes the way the hand does not");
  // And the reading on the face is UNCHANGED, because the ruler is still standing on the
  // minute the morning is at — the press moved where that minute stands on the line and
  // nothing else. That is the difference from v184, where the label moved with the line and
  // had to change to stay honest.
  assert.equal(textOf(lab), live, "a press changed what the clock says, so the line has been left reading a minute the day is not at");
  // Letting go LEAVES it where she put it — her own hand is over the part of the line she is
  // trying to see, so a reading that snapped back on release would show her nothing.
  right("pointerup", 120 + dx, 22);
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains.map((v) => v + dx),
    "letting go snapped the trains back, so the end of the line she was reading is gone again");

  // A press anywhere off the workers' line — her clause 10 — is what puts it home.
  pressAnywhere(createEl("div"));
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains, "a press off the window left the trains where the press put them");
  for (const z of rulers) {
    assert.equal(rulerPx(z), restRuler, "a press off the window left a person's ruler out on the line");
  }
  assert.equal(px(lab, "left"), restFace, "a press off the window did not bring the clock home");
  assert.equal(textOf(lab), live, "the clock came home reading a minute that is not now");

  // A press ON the line is NOT that gesture: it is where a reading begins, so the line stays
  // exactly where it is until she moves it.
  right("pointerdown", 120, 20);
  right("pointermove", 120 + dx, 21);
  right("pointerup", 120 + dx, 21);
  pressAnywhere(coach);
  assert.equal(px(lab, "left"), restFace + dx,
    "a press on a coach was answered as a press off the window, so a reading cannot be started at all");
  pressAnywhere(createEl("div"));

  // The two-finger reading, on a phone: the same picture moving by the same number.
  twoFinger("pointerdown", 120, 20);
  twoFinger("pointermove", 120 + dx, 20);
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains.map((v) => v + dx),
    "two fingers did not carry the trains, so a phone has no way to read the line");
  assert.equal(px(lab, "left"), restFace + dx, "a two-finger reading moved the trains but not the face");
  twoFinger("pointerup", 120 + dx, 20);
  pressAnywhere(createEl("div"));
  assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains, "a press off the window left a two-finger reading in place");

  // And the travel is bounded by the line AND by the minute she is reading: she may carry
  // the window as far as the paper allows and not one pixel further, so the minute the
  // clock is on is always a minute the line can show. `panRange` is what says so, and this
  // is it measured — the clamp at both ends, from the day's own numbers.
  for (const [far, end] of [[9999, range.lo], [-9999, range.hi]]) {
    right("pointerdown", 120, 20);
    right("pointermove", 120 + far, 21);
    right("pointerup", 120 + far, 21);
    assert.equal(placedLeft(rows[0]) || 0, -Math.round(end) || 0,
      `a press of ${far}px carried the line to ${placedLeft(rows[0])}px, past the travel it has (${-Math.round(end)}px)`);
    assert.ok(rulerPx(rulers[0]) >= 0 && rulerPx(rulers[0]) <= trackW,
      `a press of ${far}px carried the ruler off the window, to ${rulerPx(rulers[0])}px of ${trackW}px`);
    pressAnywhere(createEl("div"));
    assert.deepEqual(rows.map((row) => placedLeft(row)), restTrains, "a press off the window did not put an over-carried line back");
  }
});

test("a tap on a coach marks the job as taken, turns it green, and names the job (v184)", () => {
  // Her words, 24 September 2026: "Person should click on their work to turn it green
  // indicating acknowledgement." So the tap WRITES, the coach turns green under the
  // finger, and the same tap takes it back again — a finger that slipped must not need a
  // second control to undo itself.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const b = board(state);
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();
  const found = coachFor(b.root, "Cutting and packing");
  assert.ok(found, "no coach for the job this test is about");
  const { tip, row } = found;
  const at = ONE_BAKER_SCENARIO.dayStartMin + coachStartMin(tip);
  assert.equal("boardAcks" in state.settings, false,
    "the board wrote a tick into her settings before anything was tapped");
  assert.ok(!hasClass(found.coach, "ack"), "a coach is green before anybody has touched it");
  const when = clockAtMinute(coachStartMin(tip));

  const popBefore = (layers["popup-layer"].children || []).length;
  const said = tapCoach(found.coach);

  // One: green, and green in the stylesheet's own words rather than in this file's. The
  // coach is read off the SCREEN again rather than held from before the tap: a tick says
  // the screen again (the heading's own count and the Clear press's own state move with
  // it), so the claim is about what a worker is looking at now.
  const after = coachFor(b.root, "Cutting and packing");
  assert.ok(hasClass(after.coach, "ack"), "a tap on a coach did not mark the job as taken");
  assert.ok(!hasClass(after.coach, "due"), "a coach is drawn both taken and due at once");
  // Under v193 a taken coach is deliberately NOT a third colour: her point 5 is two colours
  // only, and green already means "nothing outstanding", which is exactly what a taken job
  // is. So the tick is the whole of the difference and there must be no `.tl-coach.ack` rule
  // for it to hide in — a third shade would arrive without anybody deciding to add one.
  assert.match(cssRule(".tl-coach"), /--green-bg/, "the coach's own colour is not the green her clause three asks for");
  assert.ok(!/\.tl-coach\.ack[^{]*\{/.test(read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, "")),
    "a taken coach has a colour of its own, so the two colours she asked for are three");
  assert.ok(walk(after.coach).some((n) => hasClass(n, "tl-cack")),
    "a taken coach carries no tick, so nothing on the line says the work was taken");
  // Two: written down, in her settings, under exactly one key.
  const acks = state.settings.boardAcks;
  assert.ok(acks, "the tap was drawn and never written, so nothing about it reaches her other phone");
  assert.equal(Object.keys(acks).length, 1, `one tap wrote ${Object.keys(acks).length} ticks`);
  assert.equal(Object.values(acks)[0], 1, "the tick was written as something other than taken");
  // And written down means SAVED, not just changed in memory: the object above is the
  // live state the app holds, and a tap that moved it and never persisted would look
  // exactly the same on the screen until the phone was next opened. So the claim is read
  // back off the store — the same place the app's own save() puts it — where a tap that
  // skipped the write is visible.
  const stored = JSON.parse(localStorage.getItem("bakeadmin.v1") || "null");
  assert.ok(stored && stored.settings && stored.settings.boardAcks,
    "the tap marked the job taken on screen and never saved it, so the tick dies with the phone");
  assert.deepEqual(Object.keys(stored.settings.boardAcks), Object.keys(acks),
    "the tick that was saved is not the tick that was shown");
  // Three: the job is named, back to her, in the words the rest of the app names it by —
  // and with the clock time, because a module running two batches gives two coaches and
  // the time is the only thing that tells them apart.
  const told = lastToast();
  assert.ok(told, "the tap said nothing back");
  assert.ok(told.includes("Cutting and packing"), `the tap named the job as "${told}"`);
  assert.ok(told.includes(when), `the tap did not say which of the day's jobs it was about: "${told}"`);
  assert.match(told, /marked as taken\./, `the tap read as "${told}"`);
  // Four: and it said the coach, not the card under it. The row's own handler opens the
  // person's card, so a tap that reached it would tick a job AND open a card over it.
  assert.equal(said.stopped, 1, "a tap on a coach was left to reach the row, which opens the person's card under it");
  assert.equal((layers["popup-layer"].children || []).length, popBefore,
    "a tap on a coach opened the person's card over the job it had just ticked");
  // And the tip — the one place a coach's state is written in words — agrees with the
  // coach it belongs to.
  assert.match(textOf(after.tip), /taken/i, `a taken coach's tip still reads "${textOf(after.tip)}"`);

  // The same tap takes it back, and takes the empty map with it: a job nobody has taken
  // leaves nothing behind to explain in her stored settings.
  tapCoach(coachFor(b.root, "Cutting and packing").coach);
  assert.ok(!hasClass(coachFor(b.root, "Cutting and packing").coach, "ack"),
    "the second tap did not take the tick off");
  assert.equal("boardAcks" in state.settings, false,
    "taking the last tick off left an empty tick map in her settings");
  assert.match(lastToast(), /not marked as taken any more/, "the undo did not say what it had done");

  // And the key names the PERSON, which is what makes a job handed to somebody else start
  // unanswered again — the safe reading at a bench, and the one the CHANGELOG says out
  // loud. Checked on the shared spelling, because the view, the tap and this test have to
  // key one job one way.
  const one = { who: 1, module: "m", batch: 0, slot: 0, cycle: 0 };
  assert.notEqual(jobKey(one), jobKey({ ...one, who: 2 }),
    "the tick's key does not name the person, so handing a job on would carry the tick with it");
});

test("a tick is kept by the screen being drawn again, on the person it was made for (v184)", () => {
  // The tick reaches the drawing through the same settings the rest of the app saves, so
  // the proof that it was written — rather than remembered in the closure — is a screen
  // built fresh from those settings.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const first = board(state);
  const pane = peoplePaneOf(first.root);
  pane.clientWidth = 375;
  flushTicks();
  const found = coachFor(first.root, "Cutting and packing");
  const ownerName = /👤\s*([^A-Z]*\S)/.exec(textOf(found.row))[0];
  tapCoach(found.coach);

  const again = board(state);
  flushTicks();
  const greenRows = peopleRows(again.root)
    .filter((r) => walk(r).filter((n) => hasClass(n, "tl-coach") && hasClass(n, "ack")).length);
  assert.equal(greenRows.length, 1, `the second screen drew ${greenRows.length} green rows, not one`);
  assert.ok(greenRows[0].textContent.includes(ownerName),
    `the tick came back on a row that is not ${ownerName}'s`);
  assert.match(textOf(greenRows[0]), /Cutting/, "the tick came back on the wrong job of the right person");
  assert.equal(Object.keys(state.settings.boardAcks).length, 1, "drawing the board again changed what was ticked");
});

test("the click that ends a reading is not a tap on the work (v193)", () => {
  // A reading along the line can end with a click on whatever the finger was over, which
  // on this screen is usually a coach. That click is the end of a reading and not a worker
  // saying "I'm on it" — see run.scrubbed — so it must leave the job exactly as it was.
  //
  // WHICH GESTURE, restated at v193. The reading is no longer a left press: on a computer
  // it is a right-button hold and on a phone it is two fingers ("handphone can accept
  // double finger gesture"), because a plain left press and one finger are now the tap on
  // the work — see the right-press test above, which measures that they carry nothing. So
  // the gesture driven here is the phone's, which is the one a browser can still follow
  // with a synthesized click.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const b = board(state);
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();
  const row = peopleRows(b.root)[0];
  const coach = coachesOf(row)[0];
  const TOUCH = { button: 0, buttons: 1, pointerType: "touch" };
  // Two fingertips, eighty pixels apart, moved together — the mean of the two is what the
  // gesture reads, so this is a sixty-pixel reading to the left.
  const twoFinger = (type, x, y) => {
    for (const id of [1, 2]) {
      gesture(pane, type, x + (id === 2 ? 80 : 0), y, coach, { ...TOUCH, pointerId: id });
    }
  };

  twoFinger("pointerdown", 120, 20);
  twoFinger("pointermove", 60, 20);
  tapCoach(coach);
  assert.equal("boardAcks" in state.settings, false,
    "the click that ended a reading was taken as a tap on the work");

  // The next real press clears the flag and ticks as it always did, so a reading can cost
  // at most its own one click. A plain left press, because that is the tap on the work.
  twoFinger("pointerup", 60, 20);
  gesture(pane, "pointerdown", 120, 20, coach);
  gesture(pane, "pointerup", 120, 20, coach);
  tapCoach(coach);
  assert.equal(Object.keys(state.settings.boardAcks || {}).length, 1,
    "the press after a reading no longer marks the job as taken");
});

test("Clear the board asks first, clears everything, and writes the empty rather than deleting it (v184)", () => {
  // The one control on this screen that throws information away, and the one whose
  // storage shape is not the obvious one: the sync engine tells a phone with no opinion
  // from a phone that has decided to empty a key by whether the key is SPOKEN in what it
  // publishes (see the v181 rules in sync.js). Deleting would make the clear silent, and
  // the other phone's rule 3 would put every cleared tick straight back.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const b = board(state);
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();

  // Drawn and quiet while there is nothing to clear, rather than absent.
  const buttonOf = (label) => walk(b.root).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === label);
  const clear = () => buttonOf("Clear the board");
  assert.ok(clear(), "the Clear press is not on the board at all");
  assert.equal(clear().disabled, true, "the Clear press is live with nothing marked as taken");
  assert.match(textOf(b.root), /Nothing is marked as taken, so there is nothing to clear yet\./,
    "the board does not say why its Clear press is quiet");

  // One tap on each row's first job. Each row is read off the live screen rather than
  // held across the previous tap, because a tick says the screen again.
  tapCoach(coachesOf(peopleRows(b.root)[0])[0]);
  tapCoach(coachesOf(peopleRows(b.root)[1])[0]);
  const ticked = Object.keys(state.settings.boardAcks).length;
  assert.equal(ticked, 2, `two taps on two rows marked ${ticked} jobs`);
  flushTicks();
  assert.equal(clear().disabled, false, "the Clear press is still quiet with jobs marked as taken");
  assert.ok(walk(b.root).filter((n) => hasClass(n, "tl-coach") && hasClass(n, "ack")).length >= 2,
    "the ticked coaches are not drawn green");

  // It asks, and the question names what it is about to throw away.
  for (const f of clear()._listeners.click || []) f({ type: "click", button: 0, target: clear() });
  const question = textOf(layers["confirm-layer"]);
  assert.match(question, /Clear the board\?/, `the Clear press asks nothing: "${question}"`);
  assert.match(question, /2 jobs are marked as taken/, `the question does not say what it will clear: "${question}"`);
  assert.ok(confirmButtons().some((n) => hasClass(n, "danger")),
    "the press that discards real information is not dressed as one");
  // Cancel leaves everything exactly as it was.
  pressConfirm("Cancel");
  assert.equal(Object.keys(state.settings.boardAcks).length, 2, "cancelling the Clear press cleared something anyway");

  // And answering it clears every coach, writes the EMPTY map, and never deletes the key.
  for (const f of clear()._listeners.click || []) f({ type: "click", button: 0, target: clear() });
  pressConfirm("Clear the board");
  assert.equal("boardAcks" in state.settings, true, "the Clear press deleted the tick map, so the other phone reads the clear as ignorance and puts every tick back");
  assert.deepEqual(state.settings.boardAcks, {}, `the cleared board holds ${JSON.stringify(state.settings.boardAcks)}`);
  // And the empty map is SAVED, which is the whole point of writing it rather than
  // deleting: a clear that only emptied the object in memory and never reached the store
  // would leave the phone's own saved file holding every tick, and reading it back would
  // put the whole board green again. Read off the store for that reason.
  const saved = JSON.parse(localStorage.getItem("bakeadmin.v1") || "null");
  assert.ok(saved && saved.settings, "the Clear press saved nothing at all");
  assert.equal("boardAcks" in saved.settings, true,
    "the clear reached the screen and not the store, so reopening the app reads every tick back");
  assert.deepEqual(saved.settings.boardAcks, {},
    `the saved board still holds ${JSON.stringify(saved.settings.boardAcks)} after it was cleared`);
  // Read what it said BEFORE the screen is drawn again: a redraw starts the page's body
  // over, and the app's own toast is a child of it, so the words are gone with the redraw.
  assert.match(lastToast(), /every job is unanswered again/, "the Clear press did not say what it had done");
  const after = board(state);
  flushTicks();
  assert.equal(walk(after.root).filter((n) => hasClass(n, "tl-coach") && hasClass(n, "ack")).length, 0,
    "a coach is still green after the board was cleared");
});

test("the face names the clock and never the word now, and the day's own line is not on the train (v186)", () => {
  setNow("2026-09-22T04:30:00");
  const b = board(makeState(TWO_HANDS));
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();
  const lab = walk(b.root).find((n) => hasClass(n, "tl-clock-lab"));
  assert.ok(lab, "the window carries no clock face");
  const row = peopleRows(b.root)[0];
  const coach = coachesOf(row)[0];
  const live = textOf(lab);

  // The face reads the CLOCK TIME, in words, and NOT a sentence about where the day is.
  // A board parked before her day or after it has a `nowNote` of its own ("day starts…"),
  // and that sentence belongs to the modules' window above; a face that borrowed it would
  // be saying the day has not begun while the line is standing in the middle of it.
  assert.match(textOf(lab), /^\d{1,2}:\d{2} [ap]m$/, `the face says "${textOf(lab)}", which is not a clock time`);
  assert.ok(!/now|day (starts|ended)/i.test(textOf(lab)), `the face borrows the day's own sentence: "${textOf(lab)}"`);
  // And a drag does not make it say anything else — the reading is `live` at every point of
  // the gesture, because the trains move WITH the ruler and the minute it names never
  // changes. See the drag test, which holds that from the other side.
  gesture(pane, "pointerdown", 150, 20, coach);
  gesture(pane, "pointermove", 200, 21, coach);
  assert.equal(textOf(lab), live, "a drag put a different minute on the face, so the line is reading a minute the day is not at");
  assert.equal(lab.classList.contains("reading"), false,
    "the face still takes a state of its own while she drags, which is the v185 rule that went with the line that moved alone");
  assert.ok(!/^\.tl-clock\.reading/m.test(read("admin/css/app.css")),
    "the dead brown reading state is back in the stylesheet");
  assert.ok(!/var\(--brown\)/.test(clockCss()),
    "a person's ruler can still be painted the colour of a reading, which red on this chart must never mean");

  // The board's own now-line is not drawn down the TRAIN at all: the axis under that strip
  // is WORK and not time, so a line placed at a minute would point at nothing. It is not
  // hidden inside the train either — it is simply not there. What the train carries is a
  // RULER on every line and one face at its head, and nothing that says "now".
  assert.equal(walk(pane).filter((n) => hasClass(n, "tl-now")).length, 0,
    "the day's own line is drawn down the train, which has no minute axis to stand it on");
  assert.equal(walk(pane).filter((n) => hasClass(n, "tl-clock")).length, peopleRows(b.root).length,
    "the train does not carry a ruler on every person's line");
  // The day's line lives in the planner's own people's window, which a board draws BELOW
  // the train and unchanged — her "we keep it original". On a board that window carries the
  // line the same way the planner's does: present in the DOM, and shown exactly when the
  // day is being walked, so nothing has to remember which screen it is on.
  const win = peopleWinOf(b.root);
  assert.ok(win, "the board no longer draws the planner's people's window");
  assert.ok(walk(win).find((n) => hasClass(n, "tl-now")), "the planner's window on the board lost the day's own line");
});

test("the board puts the person's train first, and the planner's two windows under it unchanged (v185)", () => {
  // Her layout, 24 September: "the production page start with the person's window the
  // train inside, after the N person, we have the 2windows that we bring in from scenario
  // planning, we keep it original." So the page reads top to bottom: the train, then the
  // modules' window, then the people's window — and the last two are the planner's own
  // drawings, borrowed rather than re-drawn.
  const b = board();
  const p = render(renderScenario, makeState());
  const wrapOf = (root) => walk(root).find((n) => hasClass(n, "tl-wrap"));
  const order = (root) => kidEls(wrapOf(root)).map((n) => ((hasClass(n, "tl-pane-people") && hasClass(n, "train")) ? "train"
    : hasClass(n, "tl-pane-proc") ? "modules"
      : hasClass(n, "tl-pane-people") ? "people" : `other:${n.className}`));
  assert.deepEqual(order(b.root), ["train", "modules", "people"],
    "the board's windows are not the person's train, then the planner's two, in that order");
  assert.deepEqual(order(p.root), ["modules", "people"],
    "the planner's own page changed, so the windows the board borrows are not the ones she kept");

  // And the two borrowed windows ARE the planner's: the same bars, from the same rows,
  // drawn by the same code. A board that re-drew them would be a second renderer of one
  // day, which is the thing this file exists to refuse.
  const barsOf = (pane) => walk(pane).filter((n) => hasClass(n, "tl-bar"));
  assert.equal(barsOf(peopleWinOf(b.root)).length, barsOf(peopleWinOf(p.root)).length,
    "the people's window on the board draws a different number of bars from the planner's, so it is not the same window");
  assert.equal(barsOf(procPaneOf(b.root)).length, barsOf(procPaneOf(p.root)).length,
    "the modules' window on the board draws a different number of bars from the planner's");
  assert.equal(walk(peopleWinOf(b.root)).filter((n) => hasClass(n, "tl-coach")).length, 0,
    "the planner's people's window on the board is drawing coaches, so it was not kept original");
  assert.equal(walk(peopleWinOf(b.root)).filter((n) => hasClass(n, "tl-row")).length,
    walk(peopleWinOf(p.root)).filter((n) => hasClass(n, "tl-row")).length,
    "the planner's people's window on the board has a different number of rows from the planner's");
  // The train's rows are its own: coaches and no bars, so the two people-shaped windows on
  // one page can never be mistaken for each other.
  assert.equal(walk(trainPaneOf(b.root)).filter((n) => hasClass(n, "tl-bar")).length, 0,
    "the train is drawing the day's bars as well as its coaches");
  assert.ok(walk(trainPaneOf(b.root)).filter((n) => hasClass(n, "tl-coach")).length,
    "the train drew no coaches");

  // And a worker can see where the train ends. The modules' window opens the planner's
  // page and so has no top edge of its own; under the train it needs one, or the board
  // reads as one continuous block of rows and the borrowed windows are indistinguishable
  // from the coaches above them. The rule is a seam on the wrapper ONLY — nothing inside
  // either borrowed window is re-styled, which is what "keep it original" means.
  assert.match(read("admin/css/app.css"),
    /\.tl-pane-people\.train\s*\+\s*\.tl-pane-proc\s*\{[^}]*border-top:\s*1px solid var\(--line\)/,
    "the modules' window has no seam above it on the board, so the train and the day's map run together");
});

test("the train's strip never SCROLLS sideways, while the planner's own two windows still pan together — on both screens (v186)", () => {
  // The train is placed by translating it against a centre, so a pane that could also be
  // SCROLLED sideways would have two ways to move the line — and the centre would leave
  // the middle the moment a worker scrolled. That is the rule here, and it is what keeps
  // the drag of her clause 9 unambiguous: a finger on the line moves the line by the pan
  // and by nothing else.
  //
  // v184 took the pan off the board's people's window too, because the train had replaced
  // it. She has put that window back — "we keep it original" — and it is the planner's
  // window, on the planner's minute axis, so it scrolls with the modules' window on BOTH
  // screens now. What stays off is the train's own scroll, and only that.
  const b = board();
  const p = render(renderScenario, makeState());
  // The class is on the PANE and not on the row, because it is the window that scrolls —
  // and because `.tl-pane-people.train` is the one selector the whole train block hangs
  // off, so a screen without it is a screen drawing the planner's rows.
  assert.ok(hasClass(trainPaneOf(b.root), "train"), "the board's train does not say it is a train");
  assert.equal(trainPaneOf(p.root), undefined, "the planner is drawing a train, so its rows are no longer the day's own axis");
  assert.match(cssBody("\\.tl-pane-people\\.train"), /overflow-x:\s*hidden/,
    "the train's strip may be panned sideways, so the centre the clock stands at is not the centre of the line");
  // And the planner's window keeps its own pan untouched, on both screens: the pan is the
  // rule every window shares, and a guard that took it off a board by taking it off every
  // window would be a board fixed by breaking the screen it was copied from.
  assert.match(cssBody("\\.tl(?![\\w-])"), /overflow:\s*auto/,
    "the pan every window shares has gone, so the planner can no longer move its day");
  assert.ok(!/overflow-x:\s*hidden/.test(cssBody("\\.tl-pane-people(?![\\w.-])")),
    "the planner's window has lost its sideways pan along with the train's");
  // The trains are drawn nowhere but the board: a row on the planner is a strip of time.
  assert.equal(walk(p.root).filter((n) => hasClass(n, "tl-train")).length, 0,
    "the planner is drawing trains, so its rows are no longer the day's own axis");

  // And the tie is in the WIRING, not only in the stylesheet — the stylesheet cannot stop
  // a write the panes' own code makes. The two TIME windows share one position on both
  // screens: whichever one carries the hand brings the other. The train is nobody's
  // follower and nobody's leader — v193 gave it a hand of its own (a right press on a row,
  // see the drag test above) and that hand reaches the train and nothing else.
  const procOf = (root) => walk(root).find((n) => hasClass(n, "tl-pane-proc"));
  const scrolls = (from, to) => { from.scrollLeft = 300; from.dispatchEvent({ type: "scroll" }); flushFrames(); return to.scrollLeft; };
  const rightPress = (pane) => { pane.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 40, clientY: 20, pointerId: 7, target: pane }); return pane.classList.contains("tl-dragging"); };
  for (const win of [trainPaneOf(b.root), peopleWinOf(b.root), peopleWinOf(p.root), procOf(b.root), procOf(p.root)]) win.clientWidth = 375;
  assert.equal(scrolls(peopleWinOf(p.root), procOf(p.root)), 300,
    "the planner's two windows no longer move together, so the guard took the pan off the screen it was copied from");
  const bProc = procOf(b.root);
  assert.equal(scrolls(peopleWinOf(b.root), bProc), 300,
    "the board's planner window no longer moves with the modules' window, though they share one minute axis");
  // Reset first: the line above has just left 300 on this very node, and reading it back
  // after the train's scroll would report that 300 as though the train had written it.
  bProc.scrollLeft = 0;
  assert.equal(scrolls(trainPaneOf(b.root), bProc), 0,
    "a scroll on the train moved the modules' window, which shares no axis with it");
  assert.equal(rightPress(peopleWinOf(b.root)), true,
    "the board's planner window no longer takes a right-press pan");
  // A right press that lands on the train's WINDOW but on no row starts nothing: the
  // gesture is claimed by a row, so a press in the gap between two people — or above the
  // first one — cannot quietly move every train on the board. (That a right press ON a row
  // does carry the line is the drag test's own claim.)
  assert.equal(rightPress(trainPaneOf(b.root)), false,
    "a right press on the train that landed on no row started something anyway");
  // The third tie-up, and the one a stylesheet cannot make either — the reading drawn in
  // both windows at once. A pointer moved along the modules' window puts a hairline in
  // the people's too, on both screens now; the train has no hairline at all, because it
  // has no minutes for one to stand on.
  const hairline = (root) => walk(peopleWinOf(root)).find((n) => hasClass(n, "tl-cursor"));
  const readOver = (root) => {
    const proc = procOf(root);
    proc.dispatchEvent({ type: "pointermove", clientX: 200, clientY: 20, target: proc });
    return hairline(root).hidden;
  };
  assert.equal(readOver(p.root), false, "the planner's reading is no longer drawn in both windows at once");
  assert.equal(readOver(b.root), false, "the board's planner window is no longer drawn a reading, though it shares the axis");
  assert.equal(walk(trainPaneOf(b.root)).filter((n) => hasClass(n, "tl-cursor")).length, 0,
    "a hairline is drawn down the train, which has no minutes under it");
});

test("no beat puts a word of nothing on the board, whichever minute it is standing at (v186)", () => {
  // A board's beat runs once a second all morning, and the two ways it can go wrong are
  // both silent: a strip placed at `translateX(NaNpx)` is a train that has vanished, and a
  // countdown that reads "undefinedm" is a number nobody can act on. Driven here at a
  // minute inside the day, at one before it, and at the middle of the night after it —
  // the three places boardNow parks the clock at an edge, where a map that was asked for
  // a minute outside the row's own strip has to answer with a number.
  setNow("2026-09-22T04:00:00");
  const b = board(makeState(TWO_HANDS));
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  const at = (iso) => { setNow(iso); flushTicks(); };
  for (const iso of ["2026-09-22T03:00:00", "2026-09-22T04:13:00", "2026-09-22T04:45:00",
    "2026-09-22T06:03:00", "2026-09-22T14:00:00", "2026-09-22T23:30:00"]) {
    at(iso);
    assert.equal(boardStrays(b.root), null, `the board put a broken number on itself at ${iso}`);
    // And every train is placed by a real number at every one of them — a transform that
    // is missing is as blank a screen as one that says NaN, and reads as "never placed".
    for (const row of peopleRows(b.root)) placedLeft(row);
    // Every ruler too, and they all stand at the same place on their own lines: the number
    // is written by the same pass, so a ruler left unplaced is a line with no clock on it.
    const rulers = theClock(b.root);
    assert.equal(rulers.length, peopleRows(b.root).length, `the board lost a ruler at ${iso}`);
    for (const z of rulers) rulerPx(z);
    assert.equal(new Set(rulers.map(rulerPx)).size, 1,
      `the rulers stand at different places on the same line at ${iso}, so they are not one station`);
    // And the one face is there and reads a clock.
    assert.match(textOf(walk(b.root).find((n) => hasClass(n, "tl-clock-lab"))), /^\d{1,2}:\d{2} [ap]m$/,
      `the clock reads nothing a worker can use at ${iso}`);
  }
});

test("every number the board draws a train from answers with a number, whatever it is asked (v193)", () => {
  // This is the guard that matters most on a live screen: a `translateX(NaNpx)` is a train
  // that has vanished, not an error anybody is shown. v184 asked its two maps; v193 has no
  // maps but a scale, a coach, a line, a placement and a travel, and the whole of a train's
  // geometry is arithmetic on THOSE — any one of which can arrive as nothing at all on the
  // first beat of a window that has not been measured yet. So each is asked for a minute
  // that is not a number, a scale that is not a scale, a pane with no width, and a value
  // past the end of everything, and every one of them must come back a finite number.
  const nonsense = [undefined, null, NaN, Infinity, -Infinity, "", "abc", {}, [], -30, 1e9];
  const asks = [
    ["trainScale", (v) => trainScale(v)],
    ["trainScale/scenario", (v) => trainScale({ pxPerMin: v })],
    ["lineWidth", (v) => lineWidth(v, K)],
    ["lineWidth/scale", (v) => lineWidth(240, v)],
    ["coachGeom", (v) => coachGeom({ from: v, to: v }, K)],
    ["coachGeom/scale", (v) => coachGeom({ from: 30, to: 42 }, v)],
    ["coachGeom/no job", (v) => coachGeom(v, K)],
    ["trainPlacement", (v) => trainPlacement(v, K, 300, 0, 600)],
    ["trainPlacement/scale", (v) => trainPlacement(60, v, 300, 0, 600)],
    ["trainPlacement/window", (v) => trainPlacement(60, K, v, 0, 600)],
    ["trainPlacement/pan", (v) => trainPlacement(60, K, 300, v, 600)],
    ["trainPlacement/line", (v) => trainPlacement(60, K, 300, 0, v)],
    ["panRange", (v) => panRange(v, K, 300, 600)],
    ["panRange/window", (v) => panRange(60, K, v, 600)],
    ["panRange/line", (v) => panRange(60, K, 300, v)],
  ];
  for (const v of nonsense) {
    for (const [name, ask] of asks) {
      const got = ask(v);
      const nums = typeof got === "number" ? [got] : Object.values(got || {});
      assert.ok(nums.length, `${name} answered nothing at all for ${String(v)}`);
      for (const n of nums) {
        assert.ok(Number.isFinite(n), `${name} answered ${JSON.stringify(got)} for ${String(v)}`);
      }
    }
    // And the words a countdown is written in are always words, never "undefinedm".
    assert.match(minsWords(v), /^(?:\d+m \d+s|\d+s)$/, `minsWords answered "${minsWords(v)}" for ${String(v)}`);
  }
  // The one case with a right answer beyond "not NaN": a clock standing before her day or
  // long after it is parked at an edge of the window rather than off the paper. A ruler at
  // a negative pixel is a clock the worker cannot see, on the one screen that exists to be
  // read at a glance.
  const before = trainPlacement(-30, K, 300, 0, 600);
  assert.equal(before.ruler, 0, "an hour before her day did not park the ruler at the line's own start");
  const after = trainPlacement(900, K, 300, 0, 600);
  assert.equal(after.ruler, after.win,
    `the middle of the night put the ruler at ${after.ruler}px of a ${after.win}px window`);
});

test("the day can be walked from the workers' own window: Start, Stop, the bell, Back to now and the speed (v186)", () => {
  // Her clause 5, in her words: "I need walk the day, Button 'START THE DAY NOW',
  // 'STOP' , 'The N Called', these button are for the person's windows" — and her
  // clause 11 for the two simulation presses: "left buttton make the clock back to
  // current, Right button, when clicked, dropdown a choice list, slow, Mid, fast. This
  // button is to make the chart move faster for simulation purpose."
  //
  // So this test is about the five controls being WHERE she asked and each one being
  // what it says it is. The one claim that needs a clock is the walk itself: Start has
  // to move the day's own start to the minute she pressed it, which is the only way the
  // day can be read from now — and that is proved by walking six seconds at 10x and
  // reading a minute the real clock has not reached.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const b = board(state);
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();

  const btn = (label) => walk(b.root).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === label);
  const face = () => textOf(walk(b.root).find((n) => hasClass(n, "tl-clock-lab")));
  const ctlOf = () => walk(b.root).find((n) => hasClass(n, "tr-ctl"));
  // Read afresh at every step rather than held: a press on this screen repaints it, and
  // every node a repaint replaces is a new one. Holding the old row would have this test
  // looking for the speed in a row that is no longer on the page.
  const rowa = () => kidEls(ctlOf()).filter((n) => hasClass(n, "tr-ctl-row"));

  // The row of presses is inside the WORKERS' window, standing next to the lines it
  // works, and not up in the day chart.
  const ctl = ctlOf();
  assert.ok(ctl, "the walk's controls are not on the board at all");
  assert.ok(walk(pane).includes(ctl), "the walk's controls are not in the workers' window, which is the window they work");
  assert.equal(walk(partOf(b.root, "tl-pane-proc")).filter((n) => hasClass(n, "tr-ctl")).length, 0,
    "the walk's controls were drawn in the day chart, which is not where she asked for them");
  const rows = rowa();
  assert.equal(rows.length, 3, `the walk's controls are drawn as ${rows.length} rows and not three`);
  // The three groups, in her order: the day's own two presses with the bell; the two
  // simulation presses; and the Scale, which v193 added because the train now obeys it.
  const labelsa = rows.map((z) => kidEls(z).map((n) => textOf(n)).join(" "));
  assert.match(labelsa[2], /Scale/, `the walk's third row is not the Scale: "${labelsa[2]}"`);

  // Start and Stop, drawn as a PAIR with exactly one of them live — which is also what
  // tells her at a glance which of the two the day is doing. A day standing still has
  // Start live; a button that vanished on being pressed would leave her wondering
  // whether the press had been taken.
  const start = btn("▶ Start the day now");
  const stop = btn("■ Stop");
  assert.ok(start && stop, "Start and Stop are not both drawn, so one of them comes and goes");
  assert.ok(kidEls(rows[0]).includes(start) && kidEls(rows[0]).includes(stop),
    "Start and Stop are not side by side in the walk's own row");
  assert.equal(start.disabled, false, "Start is inert while the day is standing still");
  assert.equal(stop.disabled, true, "Stop is live while the day is standing still");

  // Her "The N Called": the bell is in that row too, it names how many people it would
  // ring for, and it says which way it is thrown.
  const bell = kidEls(rows[0]).find((n) => hasClass(n, "tl-chip") && /🔔/.test(textOf(n)));
  assert.ok(bell, "the bell that names how many people would be called is not in the walk's row");
  assert.match(textOf(bell), /^🔔 (\d+ called|Nobody to call)$/,
    `the bell reads "${textOf(bell)}", which names neither a count nor nobody`);
  assert.equal(hasClass(bell, "on"), false, "the bell is drawn throwing a call the board is not making");
  const wouldCall = Number(/^🔔 (\d+) called$/.exec(textOf(bell))?.[1] || 0);
  if (wouldCall) {
    for (const f of bell._listeners.click || []) f({ type: "click", target: bell });
    const on = walk(b.root).find((n) => hasClass(n, "tl-chip") && /🔔/.test(textOf(n)));
    assert.equal(textOf(on), `🔔 Calling ${wouldCall}`, "the bell was thrown and its label still names the state it is not in");
    assert.equal(hasClass(on, "on"), true, "the bell is calling and is not drawn as calling");
    for (const f of on._listeners.click || []) f({ type: "click", target: on });
    const off = walk(b.root).find((n) => hasClass(n, "tl-chip") && /🔔/.test(textOf(n)));
    assert.equal(textOf(off), `🔔 ${wouldCall} called`, "the bell was thrown back and its label did not come back with it");
  }

  // Her right button: the speed. A drop-down of three, the value the day is actually
  // walking at marked as the chosen one — and changing it repaints NOTHING, because
  // nothing on the screen says the speed yet.
  const speedBox = walk(b.root).find((n) => hasClass(n, "tr-ctl-speed"));
  assert.ok(speedBox, "the walk's speed is not drawn");
  assert.ok(kidEls(rowa()[1]).includes(speedBox), "the speed is not in the walk's second row, beside Back to now");
  assert.match(textOf(partOf(speedBox, "tr-ctl-lab")), /walk speed/i, "the speed drop-down does not name what it sets");
  const sel = kidEls(speedBox).find((n) => n.tagName === "SELECT");
  assert.ok(sel, "the walk's speed is not a drop-down");
  const options = kidEls(sel).filter((n) => n.tagName === "OPTION");
  assert.deepEqual(options.map((o) => textOf(o)), ["Slow 1×", "Mid 10×", "Fast 60×"],
    `the speed drop-down offers ${options.map((o) => textOf(o)).join(", ")}, which are not her three speeds`);
  // Exactly one option is marked chosen, and it is Slow — her own morning's pace. Read
  // off `selected` rather than off the node's `value`, because `selected` is what a
  // browser both writes and honours for a menu nobody has opened yet.
  const chosen = options.filter((o) => o.selected);
  assert.deepEqual(chosen.map((o) => o.value), ["1"], "the walk does not begin at her own morning's pace");
  const before = replaceCount;
  sel.value = "10";
  for (const f of sel._listeners.change || []) f({ type: "change", target: sel });
  assert.match(lastToast(), /Mid 10×/, `the speed she picked is not the one the board says it will walk at: ${lastToast()}`);
  assert.equal(replaceCount, before, "changing the speed repainted the screen, which moves the scroll she is reading for nothing");

  // Start. It moves the day's own start to the minute she pressed it, so the whole day
  // is read from now — and it walks from nought, so the ruler comes in from the left.
  for (const f of start._listeners.click || []) f({ type: "click", target: start });
  assert.match(lastToast(), /Walking the day from 4:30 am, Mid 10×/,
    `Start did not say what it was doing: ${lastToast()}`);
  assert.equal(btn("▶ Start the day now").disabled, true, "Start is still live after the day was started");
  assert.equal(btn("■ Stop").disabled, false, "Stop is inert after the day was started");

  // Six seconds of the wall clock at 10x is ONE MINUTE of her day, and that minute is
  // the proof the day is being walked rather than read: at 04:30:06 the real clock is
  // six seconds into 4:30 am, so a board reading the wall clock would still say 4:30 —
  // while a walked one says 4:31, because the day's own start moved to the press.
  setNow("2026-09-22T04:30:06");
  flushTicks();
  assert.equal(face(), clockAtMinute(1, 270), `the walked day reads ${face()} at 04:30:06, so the day's start did not move to the minute she pressed Start`);

  // Stop puts the line back on the real clock, the day's own labels with it — and it does
  // so on the REPAINT ITSELF, with no beat allowed to repair it afterwards. That is the
  // claim the press makes: the screen it draws is already the real clock, rather than a
  // second of the walk's own minute standing there until the next beat comes round. So
  // nothing is flushed between the press and the reading. A last press, tap or Clear on
  // this screen repaints it, and a repaint that leaves the trains at the left edge and the
  // face blank for a second is the same fault from the other side — see the walk of the
  // strip below, which is read on a fresh screen with no beat run either.
  for (const f of btn("■ Stop")._listeners.click || []) f({ type: "click", target: btn("■ Stop") });
  assert.match(lastToast(), /Stopped — the line is back on the real clock/,
    `Stop did not say what it had done: ${lastToast()}`);
  assert.equal(face(), clockAtMinute(30.1, 240),
    `the repaint after Stop reads ${face()} at 04:30:06, so the day is still being labelled from the minute the walk began`);
  assert.equal(btn("■ Stop").disabled, true, "Stop is still live after the walk was stopped");
  assert.equal(btn("▶ Start the day now").disabled, false, "Start is inert after the walk was stopped");

  // And a minute later it is still the real clock: the walk is genuinely over and not
  // merely out-labelled by the beat. At 10x the day would have gained five minutes of
  // itself in those thirty seconds; on the wall clock it gains thirty seconds.
  setNow("2026-09-22T04:31:00");
  flushTicks();
  assert.equal(face(), clockAtMinute(31, 240),
    `the day is still being walked after Stop: ${face()} at 04:31:00`);

  // Her left button, and her clause 10 as a press. With nothing to put back it SAYS so
  // rather than sitting there doing nothing quietly — a press that answers with silence
  // reads as a press that did not work.
  const back = btn("⟲ Back to now");
  assert.ok(back, "the left button that puts the clock back to the current time is not drawn");
  assert.ok(kidEls(rowa()[1]).includes(back), "Back to now is not in the walk's second row");
  for (const f of back._listeners.click || []) f({ type: "click", target: back });
  assert.match(lastToast(), /already at the current time/, `Back said nothing when there was nothing to put back: ${lastToast()}`);

  // And with the line away from the current time it brings the trains AND the rulers
  // home, both by the same gesture's worth — her "when we drag to the right, the train
  // move to right and the clock and red ruler move relatively". The reading is the right
  // button's, per her correction of 25 September 2026 ("and the drag, should be by right
  // mouse button hold down"), so the line is carried with a right press.
  const pane2 = peoplePaneOf(b.root);
  pane2.clientWidth = 375;
  flushTicks();
  const row = peopleRows(b.root)[0];
  const restTrain = placedLeft(row);
  const restRuler = rulerPx(theClock(b.root)[0]);
  // How far this hand may travel, off the day's own numbers — the same figure the drag
  // test above measures — so the carry below is a real carry and not a clamp read back.
  const k69 = px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  const travel = panRange(31, k69, pane2.clientWidth - trainNameW(), px(stripOf(row), "width"));
  const far = Math.min(20, travel.hi);
  assert.ok(far > 0, `there is nowhere at all for this hand to carry the line: ${JSON.stringify(travel)}`);
  const READING = { button: 2, buttons: 2, pointerId: 7 };
  gesture(pane2, "pointerdown", 210, 20, coachesOf(row)[0], READING);
  gesture(pane2, "pointermove", 210 - far, 21, coachesOf(row)[0], READING);
  assert.equal(restTrain - placedLeft(row), far, "the drag did not carry the line, so there is nothing for Back to put back");
  for (const f of back._listeners.click || []) f({ type: "click", target: back });
  assert.equal(placedLeft(peopleRows(b.root)[0]), restTrain, "Back to now left the trains where the drag put them");
  assert.equal(rulerPx(theClock(b.root)[0]), restRuler, "Back to now put the trains back and left the rulers away from the current time");

  // And the last of the two, on a screen of its own because it tears the one above down:
  // a repaint places the line. Every strip carries a transform and every ruler a position
  // the moment the screen is drawn, without waiting for the beat — which is the standing
  // rule here: a repaint must never move what she is looking at, and a strip left unplaced
  // is the whole train sitting at the left edge of its line with the face saying no minute
  // at all, until the next second comes round to put it right.
  //
  // The beat is taken away BEFORE the repaint, so nothing but the repaint itself can have
  // placed anything: a repaint rebuilds every one of these nodes, so a fresh strip has no
  // transform and a fresh ruler no left, and with the beat gone there is no later second to
  // paper over the omission. Read as a PLACEMENT and not as a number, deliberately: the
  // stand-in screen has no layout, so a pane it rebuilds measures nought, and a number read
  // off it here would be the stand-in's own arithmetic rather than the board's. The numbers
  // are pinned where they mean something — the beat's own reads above, and the pure geometry
  // tests — while what only a repaint can get wrong is whether the line is placed at all.
  // `placedLeft` and `rulerPx` both refuse an unplaced node by name, so a measure-only job
  // stops this test on "a row's strip was never placed" rather than on a wrong number.
  const drawn = board(makeState(TWO_HANDS));
  const fresh = peoplePaneOf(drawn.root);
  fresh.clientWidth = 375;
  flushTicks();
  // Every strip is read as a PLACEMENT here (`placedLeft` refuses an unplaced one by name),
  // and the number worth keeping is the ruler's. Under v193 a strip at nought is not an
  // unplaced strip: at 4:31 the morning has not yet reached the middle of the window, so
  // her own third design glues the day's start to the left edge and `s` really is nought —
  // "the ruler sweeps, untill reach center, it stop, then the train move". The RULER is the
  // one a repaint could leave unwritten, so it is the one this guard is about.
  const restingStrip = peopleRows(drawn.root).map((z) => placedLeft(z));
  assert.ok(restingStrip.length, "no person's line is drawn at all");
  const restingRuler = theClock(drawn.root).map(rulerPx);
  assert.ok(restingRuler.length, "no ruler is drawn on the person's own lines at all");
  assert.equal(new Set(restingRuler).size, 1, "the rulers do not all stand at one station before the repaint");
  assert.ok(restingRuler[0] > 0,
    "every ruler is parked at the line's own start even after a beat, so nothing here is measuring a placement worth keeping");
  beats.clear();

  const lastCoach = coachesOf(peopleRows(drawn.root)[0])[0];
  assert.ok(lastCoach, "the first person's line carries no coach to tap, so nothing here can repaint the board");
  tapCoach(lastCoach);
  assert.equal(boardStrays(drawn.root), null, "the repaint after a tick put a broken number on the board");
  for (const z of peopleRows(drawn.root)) placedLeft(z);
  for (const z of theClock(drawn.root)) rulerPx(z);
  assert.equal(face(), clockAtMinute(31, 240),
    `the repaint after a tick left the clock face saying "${face()}", which is not the minute it was naming`);
});

test("the person's window is taller, and a coach too narrow for its words gives them up rather than shrinking them (v193)", () => {
  // Her clause 8: "The person's window be taller, so that coach size better fit
  // wordings". A height is not something the stand-in screen can measure — every node
  // in it answers with the same box — so the evidence for this is the stylesheet's own
  // declared numbers, read as the file writes them, plus one measurement off the DRAWN
  // board: the width a coach actually gets.
  //
  // What v193 changes here is the answer to "and when the box is still too narrow?".
  // v186 stepped the TYPE down (11px to 9px) and gave up the side padding; she chose
  // otherwise, in her own words: "and if it is not show as no space big enough, just dont
  // show, as we have another place shown it under person's name". The face and the tick
  // are therefore not DRAWN below the width at which the column stops being readable, and
  // there is no type step-down left anywhere.
  const rowRule = cssRule(".tl-row.train");
  assert.match(rowRule, /min-height:\s*72px/,
    `the person's row is not the taller line she asked for: ${rowRule}`);
  const coachRule = cssRule(".tl-coach");
  assert.match(coachRule, /height:\s*52px/,
    `the coach is not the taller box the words need: ${coachRule}`);
  // The band is ONE height. The link between two coaches takes the track's own height
  // rather than a number of its own, so nothing joining a coach to its neighbours can be
  // a different size from the coach itself — and the STUB at each end of a row is gone
  // with the uniform-width budget it existed to pad. A coach now stands at its own minute,
  // so there is nothing left over at either end of the line for a stub to fill.
  assert.match(cssRule(".tl-link"), /height:\s*100%/,
    "the link between two coaches is not the height of the band it joins");
  const css = read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.tl-stub[^{]*\{/.test(css),
    "the stylesheet still carries a stub for the uniform width budget the board no longer keeps");
  // The rule her answer asks for, and the whole of it: the face and the tick are given up
  // together, as one box's worth of words rather than one word at a time.
  const at = css.indexOf("@container (max-width: 43px)");
  assert.ok(at >= 0, "the face is no longer given up at all at a narrow box");
  // The whole block, counted brace for brace. A container query HOLDS rules, so the first
  // `}` after it opens is the end of the first rule inside it and not of the query — a
  // body read that way would stop before the rule it is here to check.
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", at); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") { depth -= 1; if (!depth) { end = i; break; } }
  }
  assert.ok(end > 0, "the narrow-box rule has no body");
  const small = css.slice(css.indexOf("{", at) + 1, end);
  assert.match(small, /\.tl-cface\s*,\s*\.tl-cack\s*\{\s*display:\s*none/,
    `the narrow-box rule does not give the face up whole: ${small.trim()}`);
  assert.doesNotMatch(small, /font-size/,
    "the narrow-box rule still steps the TYPE down, which is the answer she refused");
  // And no rule anywhere else hides a part of a coach's face: the tick is the only thing
  // named beside the face, so a rule that hides the name alone cannot have got in here.
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/\.tl-c/.test(sel) || !/display:\s*none/.test(m[2])) continue;
    assert.match(sel, /\.tl-cack/,
      `a rule hides part of a coach's face rather than giving the face up whole: ${sel}`);
  }

  // And the rule is LOAD-BEARING on her own day rather than a precaution — which is the one
  // thing v186 could assert the other way about. Her shortest job is a one-minute fold, and
  // at her own Scale that draws a coach narrower than the 43 pixels: measured off the board
  // she would actually be shown, and read as its own minutes against the day's own scale,
  // so a width that happened to be small cannot pass.
  const b = board(makeState(TWO_HANDS));
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();
  const k = px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  let narrow = 0;
  let total = 0;
  for (const row of peopleRows(b.root)) {
    const cs = coachesOf(row);
    const tips = coachTipsOf(row);
    assert.equal(cs.length, tips.length, "a row's coaches and the tips that describe them are no longer one for one");
    cs.forEach((c, i) => {
      total += 1;
      const w = px(c, "width");
      const span = tipSpan(tips[i]);
      assert.ok(near(w, Math.max(1, (span.to - span.from) * k)),
        `a coach stands ${w}px wide for ${span.to - span.from} minutes at ${k} pixels a minute`);
      if (w <= 43) narrow += 1;
    });
  }
  assert.ok(total > 0, "the board drew no coaches at all");
  assert.ok(narrow > 0,
    `none of the ${total} coaches on her own day is narrow enough to give its face up, so her answer is never reached on the screen she reads`);

  // And the WINDOW is taller too, which is what her clause 8 asks for in its own words:
  //
  // "The person's window be taller". A taller ROW is not a taller WINDOW, and v186 first
  // shipped exactly that mistake. The base rule caps a people's window at
  // min(20vh, 190px) — a ceiling written for the planner's five 35-pixel rows, where 190
  // IS five rows. The board's own rows are 72, so on a 375-pixel phone those four rows
  // need 406 pixels and were given 162: persons 2, 3 and 4 sat inside a box that scrolled,
  // with no sign on screen that there was anything to scroll to. Her clause 2, "Create
  // windows for each person", was answered by one window on screen and three behind a
  // scrollbar nobody could see. A ceiling is the one thing a taller window cannot have.
  //
  // Read as the FILE writes it, because the stand-in screen cannot see this: it answers
  // every node with the same box — clientHeight 0 and scrollHeight 0 alike — so a window
  // that is too short is indistinguishable in it from one that fits, and no measurement a
  // test could take off that screen would ever have caught this. Only the declared numbers
  // can, and only if a test asks for them by name.
  assert.match(cssRule(".tl-pane-people.train"), /max-height:\s*none/,
    "the board's person window still carries a ceiling, so the persons below the first are inside a box that scrolls");
  // And the planner's own window keeps its ceiling — the second half of the rule, so this
  // cannot be satisfied by deleting the cap everywhere and leaving the screen these windows
  // were borrowed from unbounded. The planner still has five 35-pixel rows and still needs
  // the cap that was written for them.
  assert.match(cssRule(".tl-pane-people"), /max-height:\s*min\(20vh,\s*190px\)/,
    "the planner's people's window has lost the ceiling that was written for its own five rows");

  // And the four lines of the face, each with its own size — the room is only worth
  // having if the type is what uses it.
  assert.match(cssRule(".tl-cicon"), /font-size:\s*15px/, "the coach's icon did not take the taller box");
  assert.match(cssRule(".tl-cname"), /font-size:\s*11px/, "the coach's word did not take the taller box");
  assert.match(cssRule(".tl-cwhen"), /font-size:\s*11px/, "the coach's clock did not take the taller box");
  assert.match(cssRule(".tl-cbatch"), /font-size:\s*10px/, "the coach's batch number did not take the taller box");
});

test("the board's own Scale step redraws the coaches to the new size and stops at its six ends (v193)", () => {
  // Her answer of 25 September 2026, asked because the board had no way to change it:
  // "Yes, add Scale to the board." It had to be asked for — before this release the train
  // did not obey the Scale at all, so there was nothing on this screen for a Scale to
  // move. Now it does, so the step writes the one setting the planner's own Scale step
  // already saves (`sc.pxPerMin`), which is why there is no new stored key and no SQL.
  //
  // The claim that matters is not that a number changed but that the DRAWING changed with
  // it: a Scale that moved the setting and left the coaches where they were would be the
  // screen lying about the size it is showing. So every width drawn is compared with the
  // SAME job's width before the press, by the ratio the day's own scale moved by.
  setNow("2026-09-22T04:30:00");
  const state = makeState(TWO_HANDS);
  const b = board(state);
  const pane = peoplePaneOf(b.root);
  pane.clientWidth = 375;
  flushTicks();

  // Read afresh at every step rather than held: a Scale press repaints this screen, and
  // every node a repaint replaces is a new one.
  const scaleRow = () => kidEls(walk(b.root).find((n) => hasClass(n, "tr-ctl")))
    .filter((n) => hasClass(n, "tr-ctl-row"))[2];
  const group = () => partOf(scaleRow(), "tl-ctl-group");
  const stepName = () => textOf(partOf(group(), "tl-step-name"));
  const stepBtns = () => kidEls(group()).filter((n) => hasClass(n, "tl-step"));
  const press = (n) => { for (const f of n._listeners.click || []) f({ type: "click", target: n }); };
  const kNow = () => px(partOf(b.root, "tl-wrap"), "--hour-w") / 60;
  // Every coach on the board, in drawing order, as its own drawn width.
  const widths = () => peopleRows(b.root).flatMap((row) => coachesOf(row).map((c) => px(c, "width")));

  // The row is the THIRD of the walk's three, and it wears the same shape as the planner's
  // own step — one label, a minus, the name of the stop it is standing on, and a plus — so
  // the two screens' Scales are the same control in the same order.
  assert.ok(scaleRow(), "the board draws no third control row, so it has no Scale at all");
  assert.equal(textOf(partOf(group(), "tl-ctl-lab")), "Scale", "the board's Scale row does not name what it sets");
  assert.deepEqual(stepBtns().map((n) => textOf(n)), ["−", "+"],
    `the board's Scale step is drawn as ${stepBtns().map((n) => textOf(n)).join(", ")}, which is not a minus and a plus`);

  const k0 = kNow();
  const name0 = stepName();
  const w0 = widths();
  const lineW0 = px(stripOf(peopleRows(b.root)[0]), "width");
  assert.ok(w0.length, "the board drew no coaches, so nothing here can be resized");
  assert.ok(k0 > 0, `the day is drawn at ${k0} pixels a minute`);
  // The name is the day's OWN stop and not a number invented here: the drawing's own scale
  // has to be one of the app's six, so a step that wrote some other figure would be caught
  // before any press is made.
  assert.ok(PX_PER_MIN_CHOICES.some((v) => Math.abs(v - k0) < 1e-9),
    `the day is drawn at ${k0} pixels a minute, which is not one of the app's own six stops`);

  // A press of + draws the day bigger, and the SCREEN is redrawn to do it — which is the
  // opposite of the speed box, where a repaint would cost her the scroll for nothing.
  const before = replaceCount;
  const plus = stepBtns()[1];
  assert.equal(plus.disabled, false, "the board's Scale cannot be stepped up at all");
  press(plus);
  assert.ok(replaceCount > before, "stepping the Scale did not redraw the board, so the coaches cannot have changed size");
  const k1 = kNow();
  const w1 = widths();
  assert.ok(k1 > k0, `stepping the Scale up moved the day from ${k0} to ${k1} pixels a minute`);
  assert.notEqual(stepName(), name0, "the Scale moved and its own label still names the stop it has left");
  assert.equal(w1.length, w0.length, "stepping the Scale changed how many coaches are drawn");
  // Every coach, not the first one: the ratio is the same for all of them because the day
  // has ONE scale, and a coach that did not move would be a job the Scale left behind.
  w1.forEach((w, i) => {
    assert.ok(near(w, w0[i] * (k1 / k0)),
      `a coach drawn ${w0[i]}px stands at ${w}px after the day moved from ${k0} to ${k1} pixels a minute`);
  });
  // And the line itself is drawn from the same figure, so a Scale press cannot leave the
  // coaches at one size on paper of another — the whole point of one day having one scale.
  assert.ok(near(px(stripOf(peopleRows(b.root)[0]), "width"), Math.round(lineW0 * (k1 / k0))),
    "the line grew by a different figure from the coaches, so the paper and the work are at two scales");
  // The setting her planner already saves is the one that moved, so the two screens cannot
  // come to hold two different Scales for one day.
  assert.equal(state.settings.scenario.pxPerMin, k1,
    "stepping the board's Scale did not write the setting the planner's own Scale writes");

  // The STEP UP stops at the top of the six rather than running past them. Read twice: the
  // button is drawn inert at the end, and a press that got through anyway changes nothing —
  // because this app's rule for a control that cannot act is that it must look inert rather
  // than quietly refuse, and a press is what proves it is refusing on purpose.
  let guard = 0;
  while (!stepBtns()[1].disabled && guard < PX_PER_MIN_CHOICES.length + 2) { press(stepBtns()[1]); guard += 1; }
  const kTop = kNow();
  const nameTop = stepName();
  assert.equal(stepBtns()[1].disabled, true, "the board's Scale can be stepped up past the app's widest stop");
  assert.equal(kTop, PX_PER_MIN_CHOICES[PX_PER_MIN_CHOICES.length - 1],
    `the board's Scale topped out at ${kTop} pixels a minute rather than at the app's widest stop`);
  press(stepBtns()[1]);
  assert.equal(kNow(), kTop, "a press past the top of the Scale moved the board anyway");
  assert.equal(stepName(), nameTop, "a press past the top of the Scale renamed the stop anyway");

  // And the STEP DOWN stops at the bottom, which is the end that must NOT be where a day
  // began: the ends are disabled rather than absent, and the widest stop is a real stop she
  // can reach rather than a wall she discovers by pressing.
  guard = 0;
  while (!stepBtns()[0].disabled && guard < PX_PER_MIN_CHOICES.length + 2) { press(stepBtns()[0]); guard += 1; }
  const kBottom = kNow();
  assert.equal(stepBtns()[0].disabled, true, "the board's Scale can be stepped down past the app's widest stop");
  assert.equal(kBottom, PX_PER_MIN_CHOICES[0],
    `the board's Scale bottomed out at ${kBottom} pixels a minute rather than at the app's widest stop`);
  press(stepBtns()[0]);
  assert.equal(kNow(), kBottom, "a press past the bottom of the Scale moved the board anyway");
  // And down there the day is smaller than it began, not larger — the direction of the two
  // presses is the other thing a step can get backwards.
  assert.ok(kBottom < k0, `stepping the Scale down drew the day bigger: ${k0} to ${kBottom} pixels a minute`);
});
